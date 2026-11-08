// A century of logging, and what's next door to every parcel. Two stages of fetch-data.mjs:
//
//   logging     BC consolidated cutblocks (every mapped harvest, with its year) and forest-tenure cutblocks that are
//               approved or being logged now → public/data/logging.json (yearly totals, the share of the islands
//               logged) and logging-blocks.json (simplified shapes, loaded when the layer is first shown).
//   neighbours  rasterizes ownership (Generalized Forest Cover Ownership: Crown, parks, private), provincial and
//               national parks, lakes and the logging history onto a 50 m grid, then measures what surrounds every
//               Land Finder parcel and every town → public/data/land-neighbours.json and neighbours.json.
//               Reads island, logging-blocks and land outputs, so it runs after the land stage. It never rewrites
//               land.json: parcels are matched by their order there, checked with a hash of the PID column.

import fs from 'node:fs/promises';
import path from 'node:path';

const LAT0 = 49.5;
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MY = 110540; // metres per degree, locally (as land.mjs)
const UA = { 'User-Agent': 'IslandAtlas/1.0 (open-data atlas; personal use)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Q = 1e4; // shapes are stored as 1e-4 degree integers (about 7 × 11 m)

const nowYear = () => { const d = new Date(); const y = d.getUTCFullYear(); return y + (d - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)); };
const fracYear = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(+d)) return null;
  const y = d.getUTCFullYear();
  return y + (d - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
};
const ringsOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const ringArea = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a / 2); };
const toM = ([lon, lat]) => [lon * MX, lat * MY];

/** BC WFS pages, cached only once the body is real JSON: when busy the server answers 200 with an XML error page. */
function pager({ log, cached, WFS, BBOX }) {
  const getJSON = async (name, url) => JSON.parse((await cached(name, async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(400_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        let j;
        try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error(`not JSON (${buf.toString('utf8', 0, 400).match(/ExceptionText>([^<]{0,90})/)?.[1] ?? 'server busy'})`); }
        if (!Array.isArray(j.features)) throw new Error('no features in the answer');
        return buf;
      } catch (e) {
        if (attempt >= 10) throw new Error(`${e.message} for ${url.slice(0, 160)}`);
        log(`  ${name}: ${e.message}; trying again in ${4 * attempt}s`);
        await sleep(4000 * attempt);
      }
    }
  })).toString('utf8'));

  /** Every feature of a layer: inside BBOX (bbox: true) or matching a CQL filter, in pages sorted by `sortBy`. */
  return async function wfs(typeName, { cql, bbox, props, sortBy = 'OBJECTID', pageSize = 10000, cacheKey }) {
    const out = [];
    for (let start = 0; ; start += pageSize) {
      const q = new URLSearchParams({
        service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName: `pub:${typeName}`, outputFormat: 'application/json',
        srsName: 'EPSG:4326', count: String(pageSize), startIndex: String(start), sortBy,
      });
      if (bbox) q.set('bbox', `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east},urn:ogc:def:crs:EPSG:4326`);
      if (cql) q.set('CQL_FILTER', cql);
      if (props) q.set('propertyName', props.join(','));
      const page = await getJSON(`neighbours/${cacheKey}-${start}.json`, `${WFS}?${q}`);
      out.push(...page.features);
      log(`  ${cacheKey}: ${out.length}/${page.numberMatched ?? '?'}`);
      if (page.features.length < pageSize) break;
    }
    return out;
  };
}

/** Douglas-Peucker on a closed ring of [x, y] metres. */
function simplifyRing(pts, tol) {
  if (pts.length < 6) return pts;
  let far = 1, best = -1;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; far = i; } }
  const line = (p) => {
    if (p.length < 3) return p;
    const keep = new Uint8Array(p.length);
    keep[0] = keep[p.length - 1] = 1;
    const stack = [[0, p.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let max = 0, idx = -1;
      const [ax, ay] = p[a], [bx, by] = p[b];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / len; if (d > max) { max = d; idx = i; } }
      if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return p.filter((_, i) => keep[i]);
  };
  return [...line(pts.slice(0, far + 1)).slice(0, -1), ...line(pts.slice(far))];
}

/** A lon/lat ring as 1e-4 degree integers from (west, south): the first point, then deltas. */
function encodeRing(ring, BBOX) {
  const pts = ring.map(([lon, lat]) => [Math.round((lon - BBOX.west) * Q), Math.round((lat - BBOX.south) * Q)]);
  const out = [pts[0][0], pts[0][1]];
  for (let i = 1; i < pts.length; i++) { const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1]; if (dx || dy) out.push(dx, dy); }
  return out;
}
function decodeRing(enc, BBOX) {
  const ring = [];
  let x = 0, y = 0;
  for (let k = 0; k < enc.length; k += 2) { x += enc[k]; y += enc[k + 1]; ring.push([x / Q + BBOX.west, y / Q + BBOX.south]); }
  return ring;
}

/** Simplified outer rings of a polygon geometry, as lon/lat, dropping slivers under `minHa`. */
function simpleOuterRings(geom, tolM, minHa) {
  const out = [];
  for (const poly of ringsOf(geom)) {
    const m = poly[0].map(toM);
    if (ringArea(m) < minHa * 1e4) continue;
    const s = simplifyRing(m, tolM);
    if (s.length >= 4) out.push(s.map(([x, y]) => [x / MX, y / MY]));
  }
  return out;
}

/** A grid over BBOX with `cell`-metre cells, and an even-odd scanline fill of polygons onto it. */
function grid(BBOX, cell) {
  const x0 = BBOX.west * MX, y0 = BBOX.south * MY;
  const nx = Math.ceil((BBOX.east * MX - x0) / cell), ny = Math.ceil((BBOX.north * MY - y0) / cell);
  const fx = (lon) => (lon * MX - x0) / cell - 0.5, fy = (lat) => (lat * MY - y0) / cell - 0.5;
  return {
    nx, ny, cell, fx, fy,
    /** calls set(index) for every cell whose centre is inside the polygon (rings: lon/lat, outer + holes) */
    fill(rings, set) {
      const rows = new Map();
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ax = fx(ring[j][0]), ay = fy(ring[j][1]), bx = fx(ring[i][0]), by = fy(ring[i][1]);
          if (ay === by) continue;
          const lo = Math.max(0, Math.ceil(Math.min(ay, by))), hi = Math.min(ny - 1, Math.ceil(Math.max(ay, by)) - 1);
          for (let r = lo; r <= hi; r++) {
            const x = ax + ((r - ay) * (bx - ax)) / (by - ay);
            (rows.get(r) ?? rows.set(r, []).get(r)).push(x);
          }
        }
      }
      for (const [r, xs] of rows) {
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const a = Math.max(0, Math.ceil(xs[k])), b = Math.min(nx - 1, Math.floor(xs[k + 1]));
          for (let c = a; c <= b; c++) set(r * nx + c);
        }
      }
    },
  };
}

/** FNV-1a over the PID column, so the app can tell that land-neighbours.json still lines up with land.json. */
export function pidHash(pids) {
  let h = 0x811c9dc5;
  for (const p of pids) {
    for (let i = 0; i < p.length; i++) { h ^= p.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= 124; h = Math.imul(h, 0x01000193) >>> 0; // '|'
  }
  return h.toString(16);
}

// ---------------------------------------------------------------------------------------------
// logging

export async function buildLogging(h) {
  const { log, writeOut, round, BBOX, getIsland, onIsland } = h;
  const isl = await getIsland();
  const wfs = pager(h);
  const asOf = nowYear();

  const raw = await wfs('WHSE_FOREST_VEGETATION.VEG_CONSOLIDATED_CUT_BLOCKS_SP', {
    bbox: true, pageSize: 5000, cacheKey: 'cutblocks',
    props: ['VCCB_SYSID', 'OPENING_ID', 'HARVEST_START_DATE', 'HARVEST_START_YEAR_CALENDAR', 'PERCENT_CLEARCUT', 'AREA_HA', 'DATA_SOURCE', 'SHAPE'],
  });

  // 100 m grid: the islands' land, and the first year each cell was logged, for an honest "share logged"
  const G = grid(BBOX, 100);
  const land = new Uint8Array(G.nx * G.ny);
  for (const f of isl.parts.values()) for (const poly of ringsOf(f.geometry)) G.fill(poly, (i) => (land[i] = 1));
  const first = new Uint16Array(G.nx * G.ny);

  const blocks = [];
  const years = {};
  const openings = new Set();
  const sources = {};
  for (const f of raw) {
    const p = f.properties;
    const year = p.HARVEST_START_YEAR_CALENDAR;
    const polys = ringsOf(f.geometry);
    if (!year || !polys.length) continue;
    // where it is: the centre of its biggest piece
    const outer = polys.map((pp) => pp[0]).sort((a, b) => ringArea(b.map(toM)) - ringArea(a.map(toM)))[0];
    let cx = 0, cy = 0;
    for (const [x, y] of outer) { cx += x; cy += y; }
    cx /= outer.length; cy /= outer.length;
    if (!onIsland(cx, cy, 0.01)) continue;
    if (p.OPENING_ID) openings.add(p.OPENING_ID);
    sources[p.DATA_SOURCE] = (sources[p.DATA_SOURCE] ?? 0) + 1;
    let t = fracYear(p.HARVEST_START_DATE);
    if (t == null || Math.floor(t) !== year) t = year + 0.5;
    for (const poly of polys) G.fill(poly, (i) => { if (land[i] && (!first[i] || first[i] > year)) first[i] = year; });
    // every block counts in the totals; slivers too small to draw are left off the map
    const ha = p.AREA_HA ?? 0;
    const y = (years[year] ??= [0, 0, 0, 0]);
    y[0] += ha; y[1]++; y[2] += cx * ha; y[3] += cy * ha;
    const shape = simpleOuterRings(f.geometry, 40, 0.4);
    if (!shape.length) continue;
    blocks.push({ t, year, ha, cc: p.PERCENT_CLEARCUT ?? 100, c: [cx, cy], shape });
  }
  blocks.sort((a, b) => a.t - b.t);
  log(`  ${Object.values(years).reduce((a, y) => a + y[1], 0)} cutblocks on the islands, ${blocks.length} big enough to draw (${raw.length} in the box); sources: ${Object.entries(sources).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  // yearly totals [ha, blocks, area-weighted lon, lat], for the chart and the busiest-year events
  for (const [k, y] of Object.entries(years)) years[k] = [round(y[0], 0), y[1], y[0] ? round(y[2] / y[0], 3) : null, y[0] ? round(y[3] / y[0], 3) : null];

  // cumulative footprint: land logged at least once by each year (re-logged land counts once)
  let landCells = 0;
  const firstCount = {};
  for (let i = 0; i < land.length; i++) {
    if (!land[i]) continue;
    landCells++;
    if (first[i]) firstCount[first[i]] = (firstCount[first[i]] ?? 0) + 1;
  }
  let cum = 0;
  const footprint = Object.keys(firstCount).map(Number).sort((a, b) => a - b).map((y) => [y, Math.round((cum += firstCount[y]))]);
  log(`  islands: ${landCells} ha of land; logged at least once: ${cum} ha (${((cum / landCells) * 100).toFixed(1)}%)`);

  // forest-tenure blocks that are approved but not started, or started recently and not finished
  const ften = await wfs('WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW', {
    cql: `LIFE_CYCLE_STATUS_CODE<>'RETIRED' AND BBOX(GEOMETRY,${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north},'EPSG:4326')`,
    props: ['OPENING_ID', 'CUT_BLOCK_ID', 'TIMBER_MARK', 'BLOCK_STATUS_CODE', 'BLOCK_STATUS_DATE', 'PLANNED_HARVEST_DATE', 'PLANNED_GROSS_BLOCK_AREA', 'DISTURBANCE_START_DATE', 'DISTURBANCE_END_DATE', 'LIFE_CYCLE_STATUS_CODE', 'CLIENT_NAME', 'GEOMETRY'],
    cacheKey: 'ften',
  });
  const why = {};
  const plan = [];
  const who = [], whoId = (n) => { const s = (n || '').trim(); let i = who.indexOf(s); if (i < 0) { i = who.length; who.push(s); } return i; };
  for (const f of ften) {
    const p = f.properties;
    const polys = ringsOf(f.geometry);
    const tally = (k) => { why[k] = (why[k] ?? 0) + 1; };
    if (!polys.length) { tally('no shape'); continue; }
    const [cx, cy] = polys[0][0].reduce((a, q) => [a[0] + q[0] / polys[0][0].length, a[1] + q[1] / polys[0][0].length], [0, 0]);
    if (!onIsland(cx, cy, 0.01)) { tally('off the islands'); continue; }
    const st = p.BLOCK_STATUS_CODE;
    if (st === 'HX') { tally('cancelled'); continue; }
    if (p.DISTURBANCE_END_DATE || st === 'LC' || st === 'S') { tally('logged'); continue; }
    if (p.OPENING_ID && openings.has(p.OPENING_ID)) { tally('already in the cutblock record'); continue; }
    const start = fracYear(p.DISTURBANCE_START_DATE);
    const status = fracYear(p.BLOCK_STATUS_DATE), planned = fracYear(p.PLANNED_HARVEST_DATE);
    let kind;
    if (start != null) {
      if (asOf - start > 3) { tally('started over 3 years ago, no end date'); continue; }
      kind = 2; // being logged
    } else {
      // approved and not started: only recent approvals, since stale ones linger un-retired for years
      const latest = Math.max(status ?? 0, planned ?? 0);
      if (asOf - latest > 5) { tally('approved over 5 years ago, never started'); continue; }
      kind = 1;
    }
    tally(kind === 2 ? 'being logged' : 'planned');
    const shape = simpleOuterRings(f.geometry, 15, 0.1);
    if (!shape.length) continue;
    plan.push({ kind, st, date: round(start ?? planned ?? status, 2), ha: round(p.PLANNED_GROSS_BLOCK_AREA ?? ringArea(shape[0].map(toM)) / 1e4, 1), who: whoId(p.CLIENT_NAME), id: `${p.TIMBER_MARK ?? ''} ${p.CUT_BLOCK_ID ?? ''}`.trim(), c: [round(cx), round(cy)], shape });
  }
  log(`  forest-tenure blocks not retired: ${ften.length}; ${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  const source = 'BC Ministry of Forests: Harvested Areas of BC (Consolidated Cutblocks, VEG_CONSOLIDATED_CUT_BLOCKS_SP) and Forest Tenure Cutblock Polygons (FTEN_CUT_BLOCK_POLY_SVW), BC Data Catalogue, OGL-BC';
  await writeOut('logging', {
    source, asOf: round(asOf, 2), landHa: landCells, loggedHa: cum,
    years, footprint,
    plan: { n: plan.filter((b) => b.kind === 1).length, ha: round(plan.filter((b) => b.kind === 1).reduce((s, b) => s + b.ha, 0), 0), active: plan.filter((b) => b.kind === 2).length, activeHa: round(plan.filter((b) => b.kind === 2).reduce((s, b) => s + b.ha, 0), 0) },
  });
  await writeOut('logging-blocks', {
    source, west: BBOX.west, south: BBOX.south, q: Q,
    t: blocks.map((b) => round(b.t, 2)), ha: blocks.map((b) => round(b.ha, 1)), cc: blocks.map((b) => b.cc),
    shapes: blocks.map((b) => b.shape.map((r) => encodeRing(r, BBOX))),
    plan: {
      who,
      rows: plan.map((b) => [b.kind, b.date, b.ha, b.who, b.id, b.c[0], b.c[1]]),
      shapes: plan.map((b) => b.shape.map((r) => encodeRing(r, BBOX))),
    },
  });
}

// ---------------------------------------------------------------------------------------------
// neighbours

const CELL = 50;
const OWN = { WATER: 0, PRIVATE: 1, CROWN: 2, PARK: 3 };
/** what a ring cell shows, by priority (see classOf) */
const CLASSES = ['Private or other land', 'Water', 'Park or protected area', 'Crown land', 'Logged in the last 10 years', 'Logged 10–30 years ago', 'Logged over 30 years ago (regrowing)', 'Active or planned cutblock'];
const SECTORS = 16, BANDS = [250, 500, 1000];
const OPEN_M = 250;

/**
 * Morphological opening of a 0/1 mask with a square of (2r+1) cells: erode, then dilate. Keeps every area at least
 * that wide in its original shape and drops anything narrower. Separable, with running sums along rows and columns.
 */
function openMask(mask, nx, ny, r) {
  const pass = (src, horizontal, need) => {
    const out = new Uint8Array(src.length);
    const lines = horizontal ? ny : nx, len = horizontal ? nx : ny;
    const at = horizontal ? (l, k) => l * nx + k : (l, k) => k * nx + l;
    for (let l = 0; l < lines; l++) {
      let sum = 0;
      for (let k = 0; k < Math.min(r, len); k++) sum += src[at(l, k)];
      for (let k = 0; k < len; k++) {
        if (k + r < len) sum += src[at(l, k + r)];
        if (k - r - 1 >= 0) sum -= src[at(l, k - r - 1)];
        // erode: the whole window is set (cells off the grid count as unset); dilate: any of it is
        if (need ? sum === 2 * r + 1 : sum > 0) out[at(l, k)] = 1;
      }
    }
    return out;
  };
  const eroded = pass(pass(mask, true, true), false, true);
  return pass(pass(eroded, true, false), false, false);
}

export async function buildNeighbours(h) {
  const { log, writeOut, round, BBOX, getIsland, OUT, PLACES } = h;
  const readOut = async (name) => { try { return JSON.parse(await fs.readFile(path.join(OUT, `${name}.json`), 'utf8')); } catch { return null; } };
  const isl = await getIsland();
  const wfs = pager(h);
  const bb = (geom) => `BBOX(${geom},${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north},'EPSG:4326')`;

  const blocksJ = await readOut('logging-blocks');
  const loggingJ = await readOut('logging');
  if (!blocksJ || !loggingJ) throw new Error('run the logging stage first (public/data/logging-blocks.json is missing)');
  const asOf = loggingJ.asOf, asOfY = Math.floor(asOf);

  const G = grid(BBOX, CELL);
  const N = G.nx * G.ny;
  log(`  ${G.nx} × ${G.ny} grid of ${CELL} m cells`);
  const own = new Uint8Array(N); // 0 water, 1 private/other, 2 Crown, 3 park
  const parkOf = new Uint16Array(N); // index + 1 into parks
  const cut = new Uint16Array(N); // latest harvest year
  const planOf = new Uint8Array(N); // 1 planned, 2 being logged

  // land, then ownership on it
  for (const f of isl.parts.values()) for (const poly of ringsOf(f.geometry)) G.fill(poly, (i) => (own[i] = OWN.PRIVATE));
  const ownRaw = await wfs('WHSE_FOREST_VEGETATION.F_OWN', { cql: `OWN NOT IN (40,80) AND ${bb('GEOMETRY')}`, props: ['OWN', 'SCHEDULE', 'OWNERSHIP_DESCRIPTION', 'GEOMETRY'], cacheKey: 'f-own' });
  const parks = []; // { name, kind, cells }
  const parkIdx = new Map();
  const addPark = (name, kind) => { const k = `${kind}|${name ?? ''}`; if (name && parkIdx.has(k)) return parkIdx.get(k); parks.push({ name, kind, cells: 0 }); const i = parks.length; if (name) parkIdx.set(k, i); return i; };
  const tidy = (s) => (s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bOf\b/g, 'of').replace(/\bAnd\b/g, 'and').replace(/'S\b/g, "'s").trim();
  let crownN = 0, parkN = 0;
  for (const f of ownRaw) {
    const { OWN: code, SCHEDULE: sch, OWNERSHIP_DESCRIPTION: desc } = f.properties;
    let cls = null, pid = 0;
    if (code === 60 || code === 81) { cls = OWN.PARK; pid = addPark(null, code === 81 ? 'Regional or local park' : (desc || 'Provincial protected area').trim()); parkN++; }
    else if ([61, 62, 64, 65, 69].includes(code) || ([72, 77, 79].includes(code) && sch === 'B')) { cls = OWN.CROWN; crownN++; }
    if (cls == null) continue;
    for (const poly of ringsOf(f.geometry)) G.fill(poly, (i) => { if (own[i]) { own[i] = cls; if (pid) parkOf[i] = pid; } });
  }
  log(`  ownership: ${crownN} Crown and ${parkN} park polygons (of ${ownRaw.length} non-private)`);

  // named parks over the top: provincial parks, ecological reserves, protected areas, conservancies; national parks
  const prov = await wfs('WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW', { bbox: true, cacheKey: 'parks-bc' });
  const nat = await wfs('WHSE_ADMIN_BOUNDARIES.CLAB_NATIONAL_PARKS', { bbox: true, cacheKey: 'parks-national' });
  const named = [
    ...prov.map((f) => ({ g: f.geometry, name: tidy(f.properties.PROTECTED_LANDS_NAME), kind: tidy(f.properties.PROTECTED_LANDS_DESIGNATION) || 'Provincial park' })),
    ...nat.map((f) => ({ g: f.geometry, name: (f.properties.ENGLISH_NAME || '').replace(/ of Canada$/, '').trim(), kind: 'National park' })),
  ];
  const parkShapes = [];
  for (const p of named) {
    const pid = addPark(p.name, p.kind);
    let cells = 0;
    for (const poly of ringsOf(p.g)) G.fill(poly, (i) => { if (own[i]) { own[i] = OWN.PARK; parkOf[i] = pid; cells++; } });
    if (cells) parkShapes.push({ pid, g: p.g });
  }
  // lakes are water, not Crown land
  const lakes = await wfs('WHSE_BASEMAPPING.FWA_LAKES_POLY', { cql: `AREA_HA>=4 AND ${bb('GEOMETRY')}`, props: ['WATERBODY_POLY_ID', 'AREA_HA', 'GEOMETRY'], sortBy: 'WATERBODY_POLY_ID', cacheKey: 'lakes' });
  for (const f of lakes) for (const poly of ringsOf(f.geometry)) G.fill(poly, (i) => { own[i] = OWN.WATER; parkOf[i] = 0; });
  log(`  ${prov.length} provincial and ${nat.length} national park polygons, ${lakes.length} lakes`);
  // Ownership maps carry long thin strips (road allowances, foreshore, rail-trail corridors) that would make
  // nearly every parcel "back onto" Crown land or a park. A morphological opening keeps only land at least
  // OPEN_M across; the strips become "other land".
  for (const cls of [OWN.CROWN, OWN.PARK]) {
    const mask = new Uint8Array(N);
    let before = 0, after = 0;
    for (let i = 0; i < N; i++) if (own[i] === cls) { mask[i] = 1; before++; }
    const kept = openMask(mask, G.nx, G.ny, Math.floor(OPEN_M / CELL / 2));
    for (let i = 0; i < N; i++) if (mask[i]) { if (kept[i]) after++; else { own[i] = OWN.PRIVATE; parkOf[i] = 0; } }
    log(`  ${cls === OWN.CROWN ? 'Crown land' : 'parks'}: ${Math.round(((before - after) / Math.max(1, before)) * 1000) / 10}% of cells were strips under ${OPEN_M} m wide`);
  }
  for (let i = 0; i < N; i++) if (parkOf[i]) parks[parkOf[i] - 1].cells++;

  // logging history and blocks on the books
  const dec = (enc) => decodeRing(enc, BBOX);
  blocksJ.t.forEach((t, k) => { const y = Math.floor(t); for (const enc of blocksJ.shapes[k]) G.fill([dec(enc)], (i) => { if (cut[i] < y) cut[i] = y; }); });
  blocksJ.plan.rows.forEach((r, k) => { for (const enc of blocksJ.plan.shapes[k]) G.fill([dec(enc)], (i) => { planOf[i] = Math.max(planOf[i], r[0]); }); });

  const classOf = (i) => {
    if (planOf[i]) return 7;
    const c = cut[i], age = c ? asOfY - c : Infinity;
    if (age <= 10) return 4;
    if (age <= 30) return 5;
    if (own[i] === OWN.WATER) return 1;
    if (own[i] === OWN.PARK) return 2;
    if (c) return 6;
    if (own[i] === OWN.CROWN) return 3;
    return 0;
  };

  // ---- parcels
  const landJ = await readOut('land');
  let parcelsOut = null;
  if (!landJ) log('  no land.json: skipping parcels');
  else {
    const n = landJ.count;
    const cols = { parkM: [], parkI: [], crownM: [], planM: [], planK: [], waterM: [], lastCut: [], onCut: [], cut10: [], ring: [] };
    const usedParks = new Map();
    const parkRef = (pid) => { if (!usedParks.has(pid)) usedParks.set(pid, usedParks.size); return usedParks.get(pid); };
    const R = Math.ceil(BANDS.at(-1) / CELL) + 2;
    const D = Math.SQRT2;
    for (let p = 0; p < n; p++) {
      // the parcel's rings (as in land.json: 1e-5 degree integer deltas)
      const rings = landJ.shapes[p].map((enc) => { const r = []; let x = 0, y = 0; for (let k = 0; k < enc.length; k += 2) { x += enc[k]; y += enc[k + 1]; r.push([x / 1e5, y / 1e5]); } return r; });
      const lon = landJ.cols.lon[p], lat = landJ.cols.lat[p];
      let fx0 = G.fx(lon), fx1 = fx0, fy0 = G.fy(lat), fy1 = fy0;
      for (const r of rings) for (const [a, b] of r) { const x = G.fx(a), y = G.fy(b); fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x); fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
      const c0 = Math.max(0, Math.floor(fx0) - R), c1 = Math.min(G.nx - 1, Math.ceil(fx1) + R);
      const r0 = Math.max(0, Math.floor(fy0) - R), r1 = Math.min(G.ny - 1, Math.ceil(fy1) + R);
      const w = c1 - c0 + 1, hgt = r1 - r0 + 1;
      // distance (in cells) from the parcel: seeds inside it, then a two-pass chamfer
      const dist = new Float32Array(w * hgt).fill(1e9);
      const seed = (gi) => { const c = (gi % G.nx) - c0, r = Math.floor(gi / G.nx) - r0; if (c >= 0 && c < w && r >= 0 && r < hgt) dist[r * w + c] = 0; };
      for (const r of rings) { G.fill([r], seed); for (const [a, b] of r) { const c = Math.round(G.fx(a)), rr = Math.round(G.fy(b)); if (c >= 0 && rr >= 0 && c < G.nx && rr < G.ny) seed(rr * G.nx + c); } }
      seed(Math.round(G.fy(lat)) * G.nx + Math.round(G.fx(lon)));
      for (let r = 0; r < hgt; r++) for (let c = 0; c < w; c++) {
        const k = r * w + c; let d = dist[k];
        if (c > 0) d = Math.min(d, dist[k - 1] + 1);
        if (r > 0) { d = Math.min(d, dist[k - w] + 1); if (c > 0) d = Math.min(d, dist[k - w - 1] + D); if (c < w - 1) d = Math.min(d, dist[k - w + 1] + D); }
        dist[k] = d;
      }
      for (let r = hgt - 1; r >= 0; r--) for (let c = w - 1; c >= 0; c--) {
        const k = r * w + c; let d = dist[k];
        if (c < w - 1) d = Math.min(d, dist[k + 1] + 1);
        if (r < hgt - 1) { d = Math.min(d, dist[k + w] + 1); if (c < w - 1) d = Math.min(d, dist[k + w + 1] + D); if (c > 0) d = Math.min(d, dist[k + w - 1] + D); }
        dist[k] = d;
      }
      const cx = G.fx(lon), cy = G.fy(lat);
      let parkM = Infinity, parkP = 0, crownM = Infinity, planM = Infinity, planK = 0, waterM = Infinity, lastCut = 0, onCut = 0, cut10 = 0;
      const tally = new Uint16Array(SECTORS * BANDS.length * CLASSES.length);
      for (let r = 0; r < hgt; r++) for (let c = 0; c < w; c++) {
        const dm = dist[r * w + c] * CELL;
        if (dm > BANDS.at(-1)) continue;
        const gi = (r + r0) * G.nx + (c + c0);
        const y = cut[gi];
        if (y) { if (y > lastCut) lastCut = y; if (asOfY - y <= 10 && own[gi]) cut10++; }
        if (dm === 0) { if (y > onCut) onCut = y; continue; }
        const o = own[gi];
        if (o === OWN.PARK && dm < parkM) { parkM = dm; parkP = parkOf[gi]; }
        if (o === OWN.CROWN && dm < crownM) crownM = dm;
        if (o === OWN.WATER && dm < waterM) waterM = dm;
        if (planOf[gi] && dm < planM) { planM = dm; planK = planOf[gi]; }
        const ang = Math.atan2(c + c0 - cx, r + r0 - cy); // 0 = north, clockwise
        const s = Math.floor((((ang / (2 * Math.PI)) * SECTORS + 0.5) % SECTORS + SECTORS) % SECTORS);
        const b = dm <= BANDS[0] ? 0 : dm <= BANDS[1] ? 1 : 2;
        tally[(s * BANDS.length + b) * CLASSES.length + classOf(gi)]++;
      }
      let ring = '';
      for (let s = 0; s < SECTORS; s++) for (let b = 0; b < BANDS.length; b++) {
        let best = 1, bn = 0;
        for (let k = 0; k < CLASSES.length; k++) { const v = tally[(s * BANDS.length + b) * CLASSES.length + k]; if (v > bn) { bn = v; best = k; } }
        ring += best;
      }
      const m = (v) => (Number.isFinite(v) ? Math.round(v) : null);
      cols.parkM.push(m(parkM)); cols.parkI.push(parkP ? parkRef(parkP) : null);
      cols.crownM.push(m(crownM)); cols.planM.push(m(planM)); cols.planK.push(planK || null); cols.waterM.push(m(waterM));
      cols.lastCut.push(lastCut || null); cols.onCut.push(onCut || null); cols.cut10.push(round((cut10 * CELL * CELL) / 1e4, 1));
      cols.ring.push(ring);
      if ((p + 1) % 5000 === 0) log(`  parcels: ${p + 1}/${n}`);
    }
    const parkList = [...usedParks.keys()].map((pid) => [parks[pid - 1].name ?? '', parks[pid - 1].kind]);
    const count = (k, f) => cols[k].filter(f).length;
    log(`  ${count('parkM', (v) => v != null && v <= 100)} parcels back onto a park, ${count('crownM', (v) => v != null && v <= 100)} onto Crown land, ${count('planM', (v) => v != null)} have an active or planned cutblock within 1 km`);
    parcelsOut = {
      source: 'Generalized Forest Cover Ownership (F_OWN); BC parks, ecological reserves and protected areas (TA_PARK_ECORES_PA_SVW); national parks (CLAB_NATIONAL_PARKS); Freshwater Atlas lakes; consolidated and forest-tenure cutblocks; BC Data Catalogue, OGL-BC',
      asOf, count: n, check: pidHash(landJ.cols.pid), cell: CELL, sectors: SECTORS, bands: BANDS, classes: CLASSES,
      parks: parkList, cols,
    };
  }

  // ---- towns: logging within 5 km, parks nearby
  const towns = {};
  for (const t of PLACES) {
    const cx = G.fx(t.lon), cy = G.fy(t.lat);
    const R5 = 5000 / CELL, R20 = 20000 / CELL;
    let land5 = 0, cut10 = 0, everCut = 0, planHa = 0, park5 = 0;
    const near = new Map();
    for (let r = Math.max(0, Math.floor(cy - R20)); r <= Math.min(G.ny - 1, Math.ceil(cy + R20)); r++)
      for (let c = Math.max(0, Math.floor(cx - R20)); c <= Math.min(G.nx - 1, Math.ceil(cx + R20)); c++) {
        const d = Math.hypot(c - cx, r - cy);
        if (d > R20) continue;
        const gi = r * G.nx + c;
        if (parkOf[gi]) { const k = parkOf[gi]; if (!near.has(k) || near.get(k) > d) near.set(k, d); }
        if (d > R5 || !own[gi]) continue;
        land5++;
        if (own[gi] === OWN.PARK) park5++;
        if (cut[gi]) { everCut++; if (asOfY - cut[gi] <= 10) cut10++; }
        if (planOf[gi]) planHa++;
      }
    const ha = (cells) => round((cells * CELL * CELL) / 1e4, 0);
    // nearest named parks first, then the nearest unnamed one of each kind
    const list = [...near.entries()].map(([pid, d]) => ({ p: parks[pid - 1], km: (d * CELL) / 1000 })).filter((x) => x.p.cells >= (x.p.name ? 8 : 80)).sort((a, b) => a.km - b.km);
    const pick = [...list.filter((x) => x.p.name).slice(0, 4)];
    const regional = list.find((x) => !x.p.name && /regional/i.test(x.p.kind));
    if (regional && pick.length < 5) pick.push(regional);
    pick.sort((a, b) => a.km - b.km);
    towns[t.key] = {
      land5: ha(land5), cut10: ha(cut10), everCut: ha(everCut), plan: ha(planHa), park5: ha(park5),
      parks: pick.map((x) => [x.p.name ?? '', x.p.kind, round(x.km, 1), ha(x.p.cells)]),
    };
  }

  // park outlines for the map, simplified hard
  const parkOut = parkShapes.map(({ pid, g }) => ({ pid, rings: simpleOuterRings(g, 60, 2) })).filter((x) => x.rings.length);
  const pIdx = new Map();
  const parkTable = [];
  for (const x of parkOut) if (!pIdx.has(x.pid)) { pIdx.set(x.pid, parkTable.length); const p = parks[x.pid - 1]; parkTable.push([p.name ?? '', p.kind, round((p.cells * CELL * CELL) / 1e4, 0)]); }

  await writeOut('neighbours', {
    source: 'BC parks, ecological reserves and protected areas (TA_PARK_ECORES_PA_SVW); national parks (CLAB_NATIONAL_PARKS); Generalized Forest Cover Ownership (F_OWN); consolidated and forest-tenure cutblocks; BC Data Catalogue, OGL-BC',
    asOf, towns,
    parks: parkTable,
    shapes: parkOut.map((x) => [pIdx.get(x.pid), x.rings.map((r) => encodeRing(r, BBOX))]),
    west: BBOX.west, south: BBOX.south, q: Q,
  });
  if (parcelsOut) await writeOut('land-neighbours', parcelsOut);
}
