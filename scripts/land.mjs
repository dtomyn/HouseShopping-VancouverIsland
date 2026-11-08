// Land Finder data: every private parcel of 5+ acres on Vancouver Island and the shortlisted islands,
// with what a buyer looking for safe, quiet acreage wants to know about it. Run as the `land` stage
// of fetch-data.mjs (after island, fires, hospitals, seismic and normals, whose outputs it reads).
//
// Sources: ParcelMap BC parcel fabric; Freshwater Atlas coastline, lakes and rivers; BC Wildfire
// Service Provincial Strategic Threat Analysis (local use only, see below); BC floodplain maps; Agricultural Land Reserve;
// BC airports; Mapzen terrain tiles; OpenStreetMap (busy roads, industry, groceries, gas, clinics)
// via Overpass; drive times from the public OSRM demo router.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzlibSync } from 'fflate';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import simplify from '@turf/simplify';

const MIN_SQM = 20234; // 5 acres
const SQM_PER_ACRE = 4046.8564;
const LAT0 = 49.5;
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MY = 110540; // metres per degree, locally
const WATER_TOUCH = 35; // m: a parcel edge this close to water counts as frontage
const SAMPLE_STEP = 40; // m between boundary samples
const DEM_ZOOM = 11; // ~50 m pixels at this latitude
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const OSRM = 'https://router.project-osrm.org';
const UA = { 'User-Agent': 'IslandAtlas/1.0 (open-data retirement atlas; personal use)', Accept: 'application/json' };
const THREAT = { 'No Threat': 0, Water: 0, Low: 1, Moderate: 2, High: 3, Extreme: 4 };
// The Provincial Strategic Threat Analysis fire-threat rating is published "Access Only" (Province of BC copyright,
// no redistribution without permission), so the per-parcel ratings derived from it go to their own file,
// land-threat.json, which .gitignore keeps out of the repository and so out of the published site. land.json, which
// is published, carries no threat column. A local `npm run data land` fills the Land Finder's wildfire threat filter.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function buildLand(h) {
  const { log, cached, writeOut, round, distKm, WFS, BBOX, getIsland, onIsland, OUT } = h;
  const isl = await getIsland();
  const readOut = async (name) => JSON.parse(await fs.readFile(path.join(OUT, `${name}.json`), 'utf8'));
  // BC layers name their geometry SHAPE or GEOMETRY (Freshwater Atlas, ALR, floodplains)
  const bb = (geom = 'SHAPE') => `BBOX(${geom},${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north},'EPSG:4326')`;
  const bboxCql = bb();

  const fetchJson = async (url, opts = {}) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(opts.timeout ?? 240_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        if (attempt >= (opts.retries ?? 4)) throw new Error(`${e.message} for ${url.slice(0, 120)}`);
        await sleep(3000 * attempt);
      }
    }
  };
  const cachedJson = async (name, url, opts) => JSON.parse((await cached(name, () => fetchJson(url, opts))).toString('utf8'));

  /** Pages through a BC WFS layer with a CQL filter. */
  async function wfs(typeName, { cql, props, geom = 'SHAPE', sortBy = 'OBJECTID', pageSize = 5000, cacheKey }) {
    const out = [];
    for (let start = 0; ; start += pageSize) {
      const q = new URLSearchParams({
        service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName: `pub:${typeName}`, outputFormat: 'application/json',
        srsName: 'EPSG:4326', count: String(pageSize), startIndex: String(start), sortBy, CQL_FILTER: cql,
      });
      if (props) q.set('propertyName', [...props, geom].join(','));
      const page = await cachedJson(`land/${cacheKey}-${start}.json`, `${WFS}?${q}`);
      out.push(...page.features);
      log(`  ${cacheKey}: ${out.length}/${page.numberMatched ?? '?'}`);
      if (page.features.length < pageSize) break;
    }
    return out;
  }

  /** Overpass query, tried on each mirror in turn (they are often busy). */
  async function overpass(name, query) {
    return JSON.parse((await cached(`land/osm-${name}.json`, async () => {
      let last;
      for (let round_ = 0; round_ < 4; round_++)
        for (const url of OVERPASS) {
          try {
            const buf = await fetchJson(`${url}?data=${encodeURIComponent(query)}`, { retries: 1, timeout: 300_000 });
            let j;
            try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('busy (not JSON)'); }
            if (!Array.isArray(j.elements) || /runtime error|timed out|out of memory/i.test(j.remark ?? '')) throw new Error(`busy (${j.remark ?? 'no elements'})`);
            return buf;
          } catch (e) { last = e; log(`  overpass ${name}: ${e.message}, trying again`); await sleep(8000); }
        }
      throw last;
    })).toString('utf8'));
  }

  // ---------------------------------------------------------------------------------------------
  // geometry helpers, in local metres

  const toM = ([lon, lat]) => [lon * MX, lat * MY];
  const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  const inRing = (x, y, ring) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  /** polygon (array of rings in metres, first outer) contains point */
  const inPoly = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((r) => inRing(x, y, r));
  /**
   * Large rings (some threat polygons have ~500k vertices) get their edges bucketed into 200 m
   * bands of y, so a ray-casting test only looks at the edges that span the point's latitude.
   */
  const BAND = 200;
  const banded = (ring) => {
    if (ring.length < 400) return ring;
    const bands = new Map();
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const y0 = Math.min(ring[i][1], ring[j][1]), y1 = Math.max(ring[i][1], ring[j][1]);
      for (let b = Math.floor(y0 / BAND); b <= Math.floor(y1 / BAND); b++) (bands.get(b) ?? bands.set(b, []).get(b)).push(ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
    }
    return { bands };
  };
  const inBanded = (x, y, r) => {
    if (Array.isArray(r)) return inRing(x, y, r);
    const e = r.bands.get(Math.floor(y / BAND));
    if (!e) return false;
    let c = false;
    for (let k = 0; k < e.length; k += 4) {
      const xj = e[k], yj = e[k + 1], xi = e[k + 2], yi = e[k + 3];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const bboxOf = (pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  };

  /** Grid index of segments: query(x, y, r) gives segments with an end within the cells r reaches. */
  function segIndex(cell) {
    const grid = new Map();
    const key = (i, j) => i * 100003 + j;
    return {
      add(a, b, tag) {
        const [x0, y0, x1, y1] = bboxOf([a, b]);
        for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
          for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) {
            const k = key(i, j);
            (grid.get(k) ?? grid.set(k, []).get(k)).push([a[0], a[1], b[0], b[1], tag]);
          }
      },
      /** nearest segment within maxR metres: [distance, tag] or [Infinity, null] */
      nearest(x, y, maxR) {
        let best = Infinity, tag = null;
        const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
        for (let r = 0; r * cell <= maxR + cell; r++) {
          for (let i = ci - r; i <= ci + r; i++)
            for (let j = cj - r; j <= cj + r; j++) {
              if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
              for (const s of grid.get(key(i, j)) ?? []) {
                const d = segDist(x, y, s[0], s[1], s[2], s[3]);
                if (d < best) { best = d; tag = s[4]; }
              }
            }
          if (best <= (r - 1) * cell) break; // nothing closer can be further out
        }
        return best <= maxR ? [best, tag] : [Infinity, null];
      },
    };
  }

  /** Grid index of polygons (metres) by bounding box, for point-in-polygon lookups. */
  function polyIndex(cell) {
    const grid = new Map();
    const key = (i, j) => i * 100003 + j;
    return {
      add(poly, value) {
        const b = bboxOf(poly[0]);
        const item = { poly: poly.map(banded), b, value };
        for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[2] / cell); i++)
          for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++) {
            const k = key(i, j);
            (grid.get(k) ?? grid.set(k, []).get(k)).push(item);
          }
      },
      at(x, y) {
        for (const it of grid.get(key(Math.floor(x / cell), Math.floor(y / cell))) ?? [])
          if (x >= it.b[0] && x <= it.b[2] && y >= it.b[1] && y <= it.b[3] && inBanded(x, y, it.poly[0]) && !it.poly.slice(1).some((r) => inBanded(x, y, r))) return it.value;
        return undefined;
      },
    };
  }

  /** Point index for counting/nearest searches. */
  function pointIndex(cell) {
    const grid = new Map();
    const key = (i, j) => i * 100003 + j;
    return {
      add(x, y, v) { const k = key(Math.floor(x / cell), Math.floor(y / cell)); (grid.get(k) ?? grid.set(k, []).get(k)).push([x, y, v]); },
      within(x, y, r) {
        const out = [];
        const ci = Math.floor(x / cell), cj = Math.floor(y / cell), n = Math.ceil(r / cell);
        for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++)
          for (const p of grid.get(key(i, j)) ?? []) if (Math.hypot(p[0] - x, p[1] - y) <= r) out.push(p);
        return out;
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // 1. parcels

  const parcelsRaw = await wfs('WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW', {
    cql: `OWNER_TYPE='Private' AND PARCEL_STATUS='Active' AND FEATURE_AREA_SQM>=${MIN_SQM} AND ${bboxCql}`,
    props: ['PARCEL_FABRIC_POLY_ID', 'PID_FORMATTED', 'PARCEL_CLASS', 'MUNICIPALITY', 'REGIONAL_DISTRICT', 'FEATURE_AREA_SQM'],
    sortBy: 'PARCEL_FABRIC_POLY_ID', cacheKey: 'parcels',
  });

  // Which island each parcel is on: simplified outlines of each one, for speed.
  const islandParts = [...isl.parts.entries()].map(([name, f]) => ({ name, f: simplify(f, { tolerance: name === 'Vancouver Island' ? 0.003 : 0.001, mutate: false }) }));
  const parcels = [];
  for (const f of parcelsRaw) {
    const rings = ringsOf(f.geometry);
    if (!rings.length) continue;
    // the parcel's largest polygon carries its centroid
    const polys = rings.map((r) => r.map((ring) => ring.map(toM)));
    const areaOf = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a / 2); };
    polys.sort((a, b) => areaOf(b[0]) - areaOf(a[0]));
    const outer = polys[0][0];
    let cx = 0, cy = 0, A = 0;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const cr = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
      A += cr; cx += (outer[j][0] + outer[i][0]) * cr; cy += (outer[j][1] + outer[i][1]) * cr;
    }
    cx /= 3 * A; cy /= 3 * A;
    const lon = cx / MX, lat = cy / MY;
    if (!onIsland(lon, lat, 0.004)) continue;
    const islandName = islandParts.find((p) => booleanPointInPolygon([lon, lat], p.f))?.name ?? 'Vancouver Island';
    parcels.push({ f, polys, cx, cy, lon, lat, island: islandName, sqm: f.properties.FEATURE_AREA_SQM });
  }
  log(`  ${parcels.length} private parcels of 5+ acres on the islands (${parcelsRaw.length} in the box)`);

  // Sample points: the boundary every SAMPLE_STEP metres, and a grid of interior points.
  for (const p of parcels) {
    const edge = [];
    for (const poly of p.polys) for (const ring of poly)
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SAMPLE_STEP));
        for (let k = 0; k < n; k++) edge.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, Math.hypot(bx - ax, by - ay) / n]);
      }
    p.edge = edge.length > 1500 ? edge.filter((_, i) => i % Math.ceil(edge.length / 1500) === 0) : edge;
    p.edgeStep = p.edge === edge ? 1 : Math.ceil(edge.length / 1500);
    const inner = [[p.cx, p.cy]];
    for (const poly of p.polys) {
      const [x0, y0, x1, y1] = bboxOf(poly[0]);
      const step = Math.max(25, Math.sqrt(((x1 - x0) * (y1 - y0)) / 40));
      for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (inPoly(x, y, poly)) inner.push([x, y]);
    }
    p.inner = inner;
  }

  // ---------------------------------------------------------------------------------------------
  // 2. water: ocean shoreline, lakes of 2+ ha and double-line rivers

  // fine cells to find shoreline along a parcel's edge, coarse ones for distances to water
  const water = segIndex(100), waterFar = segIndex(1000);
  const waterNames = ['Ocean'];
  const nameId = (n) => { if (!n) return -1; let i = waterNames.indexOf(n); if (i < 0) { i = waterNames.length; waterNames.push(n); } return i; };
  const addLines = (coords, tag) => {
    for (let i = 1; i < coords.length; i++) { const a = toM(coords[i - 1]), b = toM(coords[i]); water.add(a, b, tag); waterFar.add(a, b, tag); }
  };
  const coast = await wfs('WHSE_BASEMAPPING.FWA_COASTLINES_SP', { cql: bb('GEOMETRY'), props: ['LINEAR_FEATURE_ID'], geom: 'GEOMETRY', sortBy: 'LINEAR_FEATURE_ID', cacheKey: 'coast' });
  for (const f of coast) for (const line of f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates) addLines(line, [1, 0]);
  const lakes = await wfs('WHSE_BASEMAPPING.FWA_LAKES_POLY', { cql: `AREA_HA>=2 AND ${bb('GEOMETRY')}`, props: ['WATERBODY_POLY_ID', 'GNIS_NAME_1', 'AREA_HA'], geom: 'GEOMETRY', sortBy: 'WATERBODY_POLY_ID', cacheKey: 'lakes' });
  for (const f of lakes) for (const poly of ringsOf(f.geometry)) for (const ring of poly) addLines(ring, [2, nameId(f.properties.GNIS_NAME_1)]);
  const rivers = await wfs('WHSE_BASEMAPPING.FWA_RIVERS_POLY', { cql: bb('GEOMETRY'), props: ['WATERBODY_POLY_ID', 'GNIS_NAME_1'], geom: 'GEOMETRY', sortBy: 'WATERBODY_POLY_ID', cacheKey: 'rivers' });
  for (const f of rivers) for (const poly of ringsOf(f.geometry)) for (const ring of poly) addLines(ring, [3, nameId(f.properties.GNIS_NAME_1)]);
  log(`  water: ${coast.length} coastline pieces, ${lakes.length} lakes, ${rivers.length} river polygons`);

  for (const p of parcels) {
    let best = Infinity, tag = null;
    const front = { 1: 0, 2: 0, 3: 0 }, frontName = {};
    const every = Math.max(1, Math.floor(p.edge.length / 32));
    for (let i = 0; i < p.edge.length; i += every) {
      const [d, t] = waterFar.nearest(p.edge[i][0], p.edge[i][1], Math.min(best, 3000));
      if (d < best) { best = d; tag = t; }
    }
    if (best <= 400)
      for (const [x, y, len] of p.edge) {
        const [d, t] = water.nearest(x, y, WATER_TOUCH);
        if (d < best) { best = d; tag = t; }
        if (t) { front[t[0]] += len * p.edgeStep; frontName[t[0]] = t[1]; }
      }
    const kind = [1, 2, 3].sort((a, b) => front[b] - front[a])[0];
    p.waterM = Number.isFinite(best) ? Math.round(best) : 3000;
    p.front = Math.round(front[kind]);
    p.waterKind = p.front > 0 ? kind : 0;
    p.waterName = p.front > 0 ? frontName[kind] : tag && best < 3000 ? tag[1] : -1;
    p.nearKind = tag ? tag[0] : 0;
  }
  log(`  waterfront parcels: ${parcels.filter((p) => p.waterKind).length}`);

  // ---------------------------------------------------------------------------------------------
  // 3. hazards and land rules: wildfire threat, floodplain, ALR

  const threatIdx = polyIndex(1000);
  const psta = await wfs('WHSE_LAND_AND_NATURAL_RESOURCE.PROT_PSTA_FIRE_THREAT_RTG_SP', { cql: bboxCql, props: ['FIRE_THREAT_CLASS_DESC'], cacheKey: 'psta' });
  for (const f of psta) { const v = THREAT[f.properties.FIRE_THREAT_CLASS_DESC]; if (v == null) continue; for (const poly of ringsOf(f.geometry)) threatIdx.add(poly.map((r) => r.map(toM)), v); }
  const floodIdx = polyIndex(1000);
  const flood = await wfs('WHSE_BASEMAPPING.CWB_FLOODPLAINS_BC_AREA_SVW', { cql: bb('GEOMETRY'), props: ['FLOODPLAIN_NAME'], geom: 'GEOMETRY', cacheKey: 'floodplains' });
  for (const f of flood) for (const poly of ringsOf(f.geometry)) floodIdx.add(poly.map((r) => r.map(toM)), f.properties.FLOODPLAIN_NAME || 'Floodplain');
  const alrIdx = polyIndex(1000);
  const alr = await wfs('WHSE_LEGAL_ADMIN_BOUNDARIES.OATS_ALR_POLYS', { cql: `STATUS='ALR' AND ${bb('GEOMETRY')}`, props: ['STATUS'], geom: 'GEOMETRY', cacheKey: 'alr' });
  for (const f of alr) for (const poly of ringsOf(f.geometry)) alrIdx.add(poly.map((r) => r.map(toM)), 1);
  log(`  ${psta.length} fire-threat polygons, ${flood.length} floodplains, ${alr.length} ALR polygons`);

  let done = 0;
  for (const p of parcels) {
    let tmax = -1, rated = 0, inAlr = 0, fl = null;
    // a dozen spread-out points is plenty for ratings that come in large polygons
    const pts = p.inner.length <= 13 ? p.inner : p.inner.filter((_, i) => i === 0 || i % Math.ceil(p.inner.length / 12) === 0);
    // The threat analysis rates mostly Crown forest, not private land, and fire reaches a home from
    // the fuel around it: so the rating counts the worst threat on the parcel or within 500 m of it.
    const [x0, y0, x1, y1] = bboxOf(p.polys[0][0]);
    const reach = Math.hypot(x1 - x0, y1 - y0) / 2 + 500;
    for (let k = 0; k < 12; k++) {
      const t = threatIdx.at(p.cx + Math.cos((k / 12) * Math.PI * 2) * reach, p.cy + Math.sin((k / 12) * Math.PI * 2) * reach);
      if (t != null) { rated++; if (t > tmax) tmax = t; }
    }
    for (const [x, y] of pts) {
      const t = threatIdx.at(x, y);
      if (t != null) { rated++; if (t > tmax) tmax = t; }
      if (alrIdx.at(x, y)) inAlr++;
      fl ??= floodIdx.at(x, y) ?? null;
    }
    p.threat = rated ? tmax : null; // null: not rated (often farmland or developed land)
    p.alr = Math.round((inAlr / pts.length) * 100);
    p.flood = fl;
    if (++done % 5000 === 0) log(`  hazards ${done}/${parcels.length}`);
  }

  // ---------------------------------------------------------------------------------------------
  // 4. elevation and slope from terrain tiles

  const tiles = new Map();
  const tileXY = (lon, lat) => {
    const n = 2 ** DEM_ZOOM, r = (lat * Math.PI) / 180;
    return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
  };
  const wanted = new Set();
  for (const p of parcels) for (const [x, y] of p.inner) { const [tx, ty] = tileXY(x / MX, y / MY); wanted.add(`${Math.floor(tx)}/${Math.floor(ty)}`); }
  log(`  terrain: ${wanted.size} tiles at z${DEM_ZOOM}`);
  let got = 0;
  await h.pool([...wanted], 6, async (k) => {
    const buf = await cached(`land/dem/${DEM_ZOOM}-${k.replace('/', '-')}.png`, () => fetchJson(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_ZOOM}/${k}.png`, { headers: { Accept: 'image/png' } }));
    tiles.set(k, decodeTerrarium(buf));
    if (++got % 100 === 0) log(`  terrain ${got}/${wanted.size}`);
  });
  const elevAt = (lon, lat) => {
    const [tx, ty] = tileXY(lon, lat);
    const t = tiles.get(`${Math.floor(tx)}/${Math.floor(ty)}`);
    if (!t) return null;
    const px = Math.min(255, Math.floor((tx % 1) * 256)), py = Math.min(255, Math.floor((ty % 1) * 256));
    return t[py * 256 + px];
  };
  const pixM = (40075016 * Math.cos((LAT0 * Math.PI) / 180)) / 2 ** DEM_ZOOM / 256;
  for (const p of parcels) {
    let lo = Infinity, hi = -Infinity, slopes = 0, n = 0;
    for (const [x, y] of p.inner) {
      const lon = x / MX, lat = y / MY;
      const e = elevAt(lon, lat);
      if (e == null) continue;
      lo = Math.min(lo, e); hi = Math.max(hi, e);
      const ex = elevAt(lon + pixM / MX, lat), ey = elevAt(lon, lat + pixM / MY);
      if (ex != null && ey != null) { slopes += (Math.atan(Math.hypot(ex - e, ey - e) / pixM) * 180) / Math.PI; n++; }
    }
    p.elevLo = Number.isFinite(lo) ? Math.max(0, Math.round(lo)) : null;
    p.elevHi = Number.isFinite(hi) ? Math.max(0, Math.round(hi)) : null;
    p.slope = n ? round(slopes / n, 1) : null;
  }

  // ---------------------------------------------------------------------------------------------
  // 5. quiet: busy roads, airports, industry and quarries

  const osmRoads = await overpass('busy-roads', `[out:json][timeout:240];way["highway"~"^(motorway|trunk|primary|secondary)(_link)?$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});out geom qt;`);
  const roads = segIndex(2000);
  for (const w of osmRoads.elements) if (w.geometry) for (let i = 1; i < w.geometry.length; i++) roads.add(toM([w.geometry[i - 1].lon, w.geometry[i - 1].lat]), toM([w.geometry[i].lon, w.geometry[i].lat]), 1);
  const airportsRaw = await wfs('WHSE_IMAGERY_AND_BASE_MAPS.GSR_AIRPORTS_SVW', { cql: bboxCql, props: ['AIRPORT_NAME', 'DESCRIPTION'], sortBy: 'SEQUENCE_ID', cacheKey: 'airports' });
  // hospital helipads are rare and short; airports, airstrips and float-plane bases are the noise
  const airports = airportsRaw.filter((f) => !/heliport|helipad/i.test(`${f.properties.AIRPORT_NAME} ${f.properties.DESCRIPTION}`)).map((f) => ({ name: f.properties.AIRPORT_NAME, xy: toM(f.geometry.coordinates) }));
  const osmIndustry = await overpass('industry', `[out:json][timeout:240];(way["landuse"~"^(industrial|quarry)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});relation["landuse"~"^(industrial|quarry)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center qt;`);
  const industry = osmIndustry.elements.filter((e) => e.center).map((e) => toM([e.center.lon, e.center.lat]));
  log(`  quiet: ${osmRoads.elements.length} busy-road ways, ${airports.length} airports and water aerodromes, ${industry.length} industrial sites and quarries`);
  const nearestPt = (x, y, pts) => { let b = Infinity; for (const [a, c] of pts) { const d = Math.hypot(a - x, c - y); if (d < b) b = d; } return b; };
  for (const p of parcels) {
    // the quietest spot on the land: the interior point furthest from a busy road
    let quiet = 0;
    const every = Math.max(1, Math.floor(p.inner.length / 16));
    for (let i = 0; i < p.inner.length; i += every) quiet = Math.max(quiet, roads.nearest(p.inner[i][0], p.inner[i][1], 8000)[0]);
    p.roadKm = round(Math.min(quiet, 8000) / 1000, 2);
    p.airKm = round(Math.min(...airports.map((a) => Math.hypot(a.xy[0] - p.cx, a.xy[1] - p.cy))) / 1000, 1);
    p.indKm = round(Math.min(nearestPt(p.cx, p.cy, industry), 20000) / 1000, 1);
  }

  // ---------------------------------------------------------------------------------------------
  // 6. history and climate from the atlas's own data

  const fires = await readOut('fires');
  const ign = pointIndex(2000), burns = pointIndex(4000);
  for (const [lon, lat, t] of fires.points) if (t >= 1990) { const [x, y] = toM([lon, lat]); ign.add(x, y, 1); }
  for (const f of fires.perimeters) if (f.year >= 1950) { const [x, y] = toM(f.c); burns.add(x, y, f.ha); }
  const seismic = await readOut('seismic');
  const normals = await readOut('normals');
  const munis = await readOut('municipalities');
  for (const p of parcels) {
    p.fires5 = ign.within(p.cx, p.cy, 5000).length;
    p.burn5 = Math.round(burns.within(p.cx, p.cy, 5000).reduce((s, b) => s + b[2], 0));
    const g = seismic.grid;
    const i = Math.round((p.lon - g.west) / g.dx), j = Math.round((p.lat - g.south) / g.dy);
    let pga = null;
    for (let r = 0; r <= 2 && pga == null; r++)
      for (let dj = -r; dj <= r && pga == null; dj++) for (let di = -r; di <= r && pga == null; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < g.nx && jj < g.ny) pga = g.pga[jj * g.nx + ii];
      }
    p.pga = pga == null ? null : Math.round(pga * 100);
    const sunny = normals.stations.filter((s) => s.sun).map((s) => [s, distKm(p.lon, p.lat, s.lon, s.lat)]).sort((a, b) => a[1] - b[1])[0];
    p.sun = sunny && sunny[1] < 60 ? Math.round(sunny[0].sun) : null;
    const frosty = normals.stations.filter((s) => s.frostDays).map((s) => [s, distKm(p.lon, p.lat, s.lon, s.lat)]).sort((a, b) => a[1] - b[1])[0];
    p.frost = frosty && frosty[1] < 40 ? Math.round(frosty[0].frostDays) : null;
    const town = munis.map((m) => [m, distKm(p.lon, p.lat, m.lon, m.lat)]).sort((a, b) => a[1] - b[1])[0];
    p.town = town[0].name; p.townKm = round(town[1], 1);
  }

  // ---------------------------------------------------------------------------------------------
  // 7. drive times to health care, 24/7 ERs, groceries and gas

  const hosp = await readOut('hospitals');
  const osmPois = await overpass('services', `[out:json][timeout:240];(nwr["shop"~"^(supermarket|grocery)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});nwr["amenity"="fuel"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});nwr["amenity"~"^(clinic|doctors|hospital)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
  const at = (e) => (e.lat != null ? [e.lon, e.lat] : e.center ? [e.center.lon, e.center.lat] : null);
  const poi = (e, fallback) => { const c = at(e); return c && onIsland(c[0], c[1], 0.01) ? [e.tags.name || fallback, round(c[0], 5), round(c[1], 5)] : null; };
  const POIS = {
    er: hosp.facilities.filter((f) => f.ed === '24/7').map((f) => [f.name, f.lon, f.lat]),
    care: [
      ...hosp.facilities.filter((f) => f.hospital || f.ed).map((f) => [f.name, f.lon, f.lat]),
      ...osmPois.elements.filter((e) => /^(clinic|doctors|hospital)$/.test(e.tags.amenity ?? '') && !/dentist|dental|vet|optom|chiro|physio|massage|counsel|cosmetic|laser/i.test(`${e.tags.name} ${e.tags.healthcare ?? ''} ${e.tags['healthcare:speciality'] ?? ''}`)).map((e) => poi(e, 'Clinic')).filter(Boolean),
    ],
    grocery: osmPois.elements.filter((e) => /^(supermarket|grocery)$/.test(e.tags.shop ?? '')).map((e) => poi(e, 'Grocery store')).filter(Boolean),
    gas: osmPois.elements.filter((e) => e.tags.amenity === 'fuel').map((e) => poi(e, 'Gas station')).filter(Boolean),
  };
  log(`  services: ${Object.entries(POIS).map(([k, v]) => `${v.length} ${k}`).join(', ')}`);

  // Parcels share an origin per ~1 km cell (drive times differ by a minute or two inside one).
  const CELL = 0.012;
  const origins = new Map();
  for (const p of parcels) {
    const k = `${Math.floor(p.lon / CELL)},${Math.floor(p.lat / CELL)}`;
    const o = origins.get(k) ?? origins.set(k, { k, lon: 0, lat: 0, n: 0, i: Math.floor(p.lon / CELL), j: Math.floor(p.lat / CELL) }).get(k);
    o.lon += p.lon; o.lat += p.lat; o.n++;
    p.origin = o;
  }
  const originList = [...origins.values()].map((o) => Object.assign(o, { lon: round(o.lon / o.n, 5), lat: round(o.lat / o.n, 5) }));
  // z-order so each batch is a compact patch and shares its candidate destinations
  const z = (i, j) => { let v = 0; for (let b = 0; b < 16; b++) v |= (((i >> b) & 1) << (2 * b)) | (((j >> b) & 1) << (2 * b + 1)); return v; };
  originList.sort((a, b) => z(a.i + 20000, a.j) - z(b.i + 20000, b.j));
  log(`  routing from ${originList.length} origins`);

  let calls = 0;
  for (const [cat, list] of Object.entries(POIS)) {
    const near = (o) => list.map((d, idx) => [idx, distKm(o.lon, o.lat, d[1], d[2])]).sort((a, b) => a[1] - b[1]).slice(0, 4).map((x) => x[0]);
    const batches = [];
    let cur = { o: [], d: new Set() };
    for (const o of originList) {
      const cand = near(o);
      const union = new Set([...cur.d, ...cand]);
      if (cur.o.length && (cur.o.length >= 70 || union.size > 30)) { batches.push(cur); cur = { o: [], d: new Set() }; }
      cur.o.push(o); cand.forEach((c) => cur.d.add(c));
    }
    if (cur.o.length) batches.push(cur);
    let b = 0;
    for (const batch of batches) {
      const dst = [...batch.d];
      const coords = [...batch.o.map((o) => `${o.lon},${o.lat}`), ...dst.map((d) => `${list[d][1]},${list[d][2]}`)].join(';');
      const url = `${OSRM}/table/v1/driving/${coords}?sources=${batch.o.map((_, i) => i).join(';')}&destinations=${dst.map((_, i) => batch.o.length + i).join(';')}&annotations=duration`;
      const name = `land/osrm/${cat}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.json`;
      let fresh = false;
      const table = JSON.parse((await cached(name, async () => { fresh = true; await sleep(1100); return fetchJson(url, { retries: 6 }); })).toString('utf8'));
      if (fresh) calls++;
      batch.o.forEach((o, i) => {
        let best = null, at_ = null;
        (table.durations?.[i] ?? []).forEach((s, k) => { if (s != null && (best == null || s < best)) { best = s; at_ = dst[k]; } });
        o[cat] = best == null ? null : Math.max(1, Math.round(best / 60));
        o[`${cat}I`] = at_;
      });
      if (++b % 25 === 0) log(`  ${cat}: ${b}/${batches.length} batches (${calls} new router calls)`);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // 8. write it out, columnar, with shapes simplified to ~8 m

  const placeNames = [], placeId = (n) => { let i = placeNames.indexOf(n); if (i < 0) { i = placeNames.length; placeNames.push(n); } return i; };
  const islandNames = [...new Set(parcels.map((p) => p.island))].sort((a, b) => (a === 'Vancouver Island' ? -1 : b === 'Vancouver Island' ? 1 : a.localeCompare(b)));
  const cleanPlace = (s) => (s || '').replace(/^(Regional District of|Municipality of|District of|City of|Town of|Village of)\s+/i, '').replace(/,\s*(Regional District of|Municipality of|District of|City of|Town of|Village of)$/i, '').replace(/\s+Regional District$/i, '');
  parcels.sort((a, b) => b.sqm - a.sqm);
  const cols = {
    pid: [], acres: [], lon: [], lat: [], place: [], island: [], town: [], townKm: [],
    water: [], front: [], waterM: [], waterName: [], elevLo: [], elevHi: [], slope: [],
    flood: [], alr: [], pga: [], fires5: [], burn5: [],
    roadKm: [], airKm: [], indKm: [], sun: [], frost: [],
    care: [], careI: [], er: [], erI: [], grocery: [], groceryI: [], gas: [], gasI: [],
  };
  const shapes = [];
  for (const p of parcels) {
    const pr = p.f.properties;
    cols.pid.push(pr.PID_FORMATTED || '');
    cols.acres.push(round(p.sqm / SQM_PER_ACRE, 1));
    cols.lon.push(round(p.lon, 5)); cols.lat.push(round(p.lat, 5));
    cols.place.push(placeId(pr.MUNICIPALITY ? cleanPlace(pr.MUNICIPALITY) : `${cleanPlace(pr.REGIONAL_DISTRICT)} (rural)`));
    cols.island.push(islandNames.indexOf(p.island));
    cols.town.push(placeId(p.town)); cols.townKm.push(p.townKm);
    cols.water.push(p.waterKind); cols.front.push(p.front); cols.waterM.push(p.waterM); cols.waterName.push(p.waterName);
    cols.elevLo.push(p.elevLo); cols.elevHi.push(p.elevHi); cols.slope.push(p.slope);
    cols.flood.push(p.flood ? 1 : 0); cols.alr.push(p.alr); cols.pga.push(p.pga);
    cols.fires5.push(p.fires5); cols.burn5.push(p.burn5);
    cols.roadKm.push(p.roadKm); cols.airKm.push(p.airKm); cols.indKm.push(p.indKm); cols.sun.push(p.sun); cols.frost.push(p.frost);
    for (const cat of ['care', 'er', 'grocery', 'gas']) { cols[cat].push(p.origin[cat] ?? null); cols[`${cat}I`].push(p.origin[`${cat}I`] ?? null); }
    // up to three polygons' outer rings, simplified, as 1e-5 degree integer deltas
    const rings = [];
    for (const poly of p.polys.slice(0, 3)) {
      const ring = dp(poly[0], 8).map(([x, y]) => [Math.round((x / MX) * 1e5), Math.round((y / MY) * 1e5)]);
      if (ring.length < 4) continue;
      const enc = [ring[0][0], ring[0][1]];
      for (let i = 1; i < ring.length; i++) enc.push(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
      rings.push(enc);
    }
    shapes.push(rings);
  }
  const count = (fn) => parcels.filter(fn).length;
  log(`  ${count((p) => p.sqm >= 10 * SQM_PER_ACRE)} of 10+ acres, ${count((p) => p.waterKind && p.sqm >= 10 * SQM_PER_ACRE)} of them waterfront; ${count((p) => p.threat == null)} not fire-threat rated`);

  await writeOut('land', {
    source: 'ParcelMap BC parcel fabric (private parcels of 5+ acres); Freshwater Atlas coastline, lakes and rivers; BC floodplain maps; Agricultural Land Commission ALR; BC airports; Mapzen terrain tiles; OpenStreetMap via Overpass (ODbL); drive times from the OSRM demo router',
    count: parcels.length,
    waterKinds: ['', 'Ocean', 'Lake', 'River'],
    names: { place: placeNames, island: islandNames, water: waterNames },
    pois: POIS,
    cols,
    shapes,
  });
  // local use only (see THREAT above): never committed, never deployed
  await writeOut('land-threat', {
    source: 'BC Wildfire Service, Provincial Strategic Threat Analysis fire threat rating (Access Only: Province of BC copyright, no redistribution without permission). Local use only.',
    count: parcels.length,
    check: crypto.createHash('sha1').update(cols.pid.join('|')).digest('hex').slice(0, 12),
    names: ['None', 'Low', 'Moderate', 'High', 'Extreme'],
    threat: parcels.map((p) => p.threat),
  });
}

/** Douglas-Peucker on a ring of [x, y] metres. A closed ring is split at its farthest point first. */
function dp(pts, tol) {
  if (pts.length < 5) return pts;
  const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
  if (fx === lx && fy === ly) {
    let far = 1, best = -1;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - fx, pts[i][1] - fy); if (d > best) { best = d; far = i; } }
    return [...dpLine(pts.slice(0, far + 1), tol).slice(0, -1), ...dpLine(pts.slice(far), tol)];
  }
  return dpLine(pts, tol);
}

export function dpLine(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Terrarium PNG tile -> Float32Array of 256x256 elevations in metres. */
export function decodeTerrarium(buf) {
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8, width = 0, height = 0, ctype = 0;
  const idat = [];
  while (pos < u8.length) {
    const len = (u8[pos] << 24) | (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3];
    const type = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
    const data = u8.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]; height = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]; ctype = data[9]; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  const all = new Uint8Array(idat.reduce((s, d) => s + d.length, 0));
  let o = 0;
  for (const d of idat) { all.set(d, o); o += d.length; }
  const raw = unzlibSync(all);
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 0 ? 1 : 4;
  const stride = width * bpp;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = px[i * bpp] * 256 + px[i * bpp + 1] + px[i * bpp + 2] / 256 - 32768;
  return out;
}
