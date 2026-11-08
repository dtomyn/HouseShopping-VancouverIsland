// Tsunami zones: run as the `tsunami` stage of fetch-data.mjs, after `land` (it reads land.json).
//
// Sources, all openly licensed:
//  - BC tsunami notification zones (EMCR, BC Data Catalogue WFS, Open Government Licence – BC)
//  - Strathcona Regional District's West Coast tsunami inundation models: a Cascadia (local) and an
//    Alaska (distant) earthquake scenario from Nootka Sound to Quatsino Sound (Open
//    Government Licence – Canada)
//  - City of Victoria's Tsunami Hazard Zone and Safe Zone (2021 model, City of Victoria Open Data Licence)
//  - Mapzen/AWS Terrarium terrain tiles, for the low coastal ground everywhere else
//
// Left out on purpose: the Capital Region's own hazard-zone service (from the same 2021 study) is
// published with terms that forbid redistribution, so only the City of Victoria's open copy is used.
// Port Alberni, Tofino, Ucluelet and the east-coast districts publish their maps as PDFs only.
//
// No arrival times per town: the only published, checkable figure is Ocean Networks Canada's ~20
// minutes to the outer coast of north-west Vancouver Island for a magnitude 9 Cascadia quake (Kouhi
// et al. 2023, Oceanography 36 suppl. 1), which the app quotes as a statement, not a per-town value.
//
// Outputs:
//  - tsunami.json: zone and study names, per-town exposure (small; loaded with the app)
//  - tsunami-map.json: zone and hazard-area shapes, low coastal ground cells and the sweep order
//    (loaded when the layer is first shown)
//  - land-tsunami.json: per-parcel measures, aligned with land.json's parcel order (loaded by Land Finder)

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import simplify from '@turf/simplify';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { decodeTerrarium } from './land.mjs';

const SCREEN_M = 20; // screening height for "low coastal ground", in metres above sea level
const NEAR_SEA_M = 1000; // low ground counts only within this distance of the sea
const TOWN_R_M = 2000; // town exposure: ground within this radius of the town centre
const UA = { 'User-Agent': 'IslandAtlas/1.0 (open-data retirement atlas; personal use)' };
const ZONE_COLORS = { A: '#a78bfa', B: '#818cf8', C: '#ff5d73', D: '#ff9f43', E: '#2dd4bf' };

const ARC = [
  {
    id: 'srd-cascadia', kind: 'local', name: 'Cascadia scenario, north-west coast', where: 'Nootka Sound to Quatsino Sound',
    url: 'https://services1.arcgis.com/Uj11SaUIGBo5JYFY/arcgis/rest/services/West_Coast_Tsunami_Models/FeatureServer/0',
    publisher: 'Strathcona Regional District, West Coast Tsunami Inundation Models (Northwest Vancouver Island Tsunami Risk Assessment, with Ocean Networks Canada and Northwest Hydraulic Consultants)',
    licence: 'Open Government Licence – Canada', reach: 3000,
  },
  {
    id: 'srd-alaska', kind: 'distant', name: 'Alaska scenario, north-west coast', where: 'Nootka Sound to Quatsino Sound',
    url: 'https://services1.arcgis.com/Uj11SaUIGBo5JYFY/arcgis/rest/services/West_Coast_Tsunami_Models/FeatureServer/1',
    publisher: 'Strathcona Regional District, West Coast Tsunami Inundation Models', licence: 'Open Government Licence – Canada', reach: 0,
  },
  {
    id: 'victoria', kind: 'local', name: 'City of Victoria hazard zone, 2021 model', where: 'the City of Victoria',
    url: 'https://maps.victoria.ca/server/rest/services/OpenData/OpenData_EmergencyServices/MapServer/6',
    safe: 'https://maps.victoria.ca/server/rest/services/OpenData/OpenData_EmergencyServices/MapServer/8',
    publisher: 'City of Victoria Open Data, Tsunami Hazard Zone (2021 model), from the Capital Region Coastal Flood Inundation Mapping study', licence: 'City of Victoria Open Data Licence',
  },
];

export async function buildTsunami(h) {
  const { log, cached, writeOut, round, BBOX, getIsland, PLACES, OUT, pool } = h;
  const island = await getIsland();
  const readOut = async (name) => JSON.parse(await fs.readFile(path.join(OUT, `${name}.json`), 'utf8'));
  const fetchBuf = async (url) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(240_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        if (attempt >= 4) throw new Error(`${e.message} for ${url.slice(0, 140)}`);
        await new Promise((r) => setTimeout(r, 2500 * attempt));
      }
    }
  };
  const cachedJson = async (name, url) => JSON.parse((await cached(name, () => fetchBuf(url))).toString('utf8'));
  const polysOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  const q = (rings) => rings.map((ring) => ring.map(([x, y]) => [round(x, 5), round(y, 5)]));
  const bboxOf = (poly) => {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of poly[0]) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    return b;
  };

  // -------------------------------------------------------------------------------------------
  // 1. BC tsunami notification zones (polygons over the coastal sea, one MultiPolygon per zone)

  const zq = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName: 'pub:WHSE_LEGAL_ADMIN_BOUNDARIES.ADM_TSUNAMI_NOTIFY_ZONES_SP',
    outputFormat: 'application/json', srsName: 'EPSG:4326',
    bbox: `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east},urn:ogc:def:crs:EPSG:4326`,
  });
  const zfc = await cachedJson('tsunami/notify-zones.json', `https://openmaps.gov.bc.ca/geo/pub/wfs?${zq}`);
  if (!zfc.features?.length) throw new Error('no tsunami notification zones returned');
  const zones = [];
  const zonePolys = []; // full detail, for town/parcel lookups
  for (const f of zfc.features) {
    const p = f.properties;
    const zone = p.TSUNAMI_ZONE_CLASSIFICATION;
    const label = String(p.TSUNAMI_ZONE_LABEL ?? '').replace(/^Zone [A-E] - /, '');
    const keep = polysOf(f.geometry).filter((poly) => {
      const b = bboxOf(poly);
      return b[2] > BBOX.west && b[0] < BBOX.east && b[3] > BBOX.south && b[1] < BBOX.north;
    });
    if (!keep.length) continue;
    for (const poly of keep) zonePolys.push({ zone, poly, b: bboxOf(poly) });
    const g = simplify({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: keep } }, { tolerance: 0.005, highQuality: false, mutate: false }).geometry;
    const polys = polysOf(g).filter((poly) => poly[0].length >= 4).map((poly) => q(poly).map((r) => r.map(([x, y]) => [round(x, 3), round(y, 3)])));
    zones.push({ zone, label, color: ZONE_COLORS[zone] ?? '#94a3b8', polys });
  }
  zones.sort((a, b) => a.zone.localeCompare(b.zone));
  log(`  notification zones near the island: ${zones.map((z) => z.zone).join(', ')}`);

  /** Nearest notification zone to a point (zones are drawn over the sea), within `maxKm`. */
  const KX = 111.32 * Math.cos((49.5 * Math.PI) / 180), KY = 110.54;
  const zoneAt = (lon, lat, maxKm = 12) => {
    let best = null, bd = maxKm;
    for (const z of zonePolys) {
      const [w, s, e, n] = z.b;
      const dx = Math.max(w - lon, 0, lon - e) * KX, dy = Math.max(s - lat, 0, lat - n) * KY;
      if (Math.hypot(dx, dy) > bd) continue;
      if (booleanPointInPolygon([lon, lat], { type: 'Polygon', coordinates: z.poly })) return { zone: z.zone, km: 0 };
      for (const ring of z.poly) for (let k = 0; k < ring.length; k += 2) {
        const d = Math.hypot((ring[k][0] - lon) * KX, (ring[k][1] - lat) * KY);
        if (d < bd) { bd = d; best = { zone: z.zone, km: d }; }
      }
    }
    return best;
  };

  // -------------------------------------------------------------------------------------------
  // 2. mapped hazard areas from published studies (ArcGIS REST, as GeoJSON in lon/lat)

  const arcQuery = async (key, url) => {
    const qs = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', returnGeometry: 'true', geometryPrecision: '6', f: 'geojson' });
    const fc = await cachedJson(`tsunami/${key}.json`, `${url}/query?${qs}`);
    if (fc.error) throw new Error(`${key}: ${fc.error.message}`);
    return fc.features ?? [];
  };
  const areas = [];
  const hazardPolys = []; // for parcel/town lookups: { study, kind, poly, b }
  const coverPolys = []; // where a study answers "safe" too (Victoria's hazard + safe zones)
  for (const s of ARC) {
    const feats = await arcQuery(s.id, s.url);
    const polys = feats.flatMap((f) => polysOf(f.geometry));
    if (!polys.length) throw new Error(`${s.id}: no polygons`);
    for (const poly of polys) hazardPolys.push({ study: s.id, kind: s.kind, poly, b: bboxOf(poly) });
    if (s.safe) {
      const safe = (await arcQuery(`${s.id}-safe`, s.safe)).flatMap((f) => polysOf(f.geometry));
      for (const poly of [...polys, ...safe]) coverPolys.push({ study: s.id, poly, b: bboxOf(poly) });
    }
    const g = simplify({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } }, { tolerance: 0.00015, highQuality: false, mutate: false }).geometry;
    const out = polysOf(g).filter((poly) => poly[0].length >= 4).map(q);
    areas.push({ id: s.id, kind: s.kind, name: s.name, where: s.where, publisher: s.publisher, licence: s.licence, polys: out });
    log(`  ${s.id}: ${polys.length} polygons`);
  }
  const inPolys = (list, lon, lat, study) => list.some((p) => (!study || p.study === study) && lon >= p.b[0] && lon <= p.b[2] && lat >= p.b[1] && lat <= p.b[3] && booleanPointInPolygon([lon, lat], { type: 'Polygon', coordinates: p.poly }));
  /** Which study, if any, maps this point (in its hazard area or confirmed outside it). */
  const coveredBy = (lon, lat) => {
    if (inPolys(coverPolys, lon, lat)) return 'victoria';
    for (const s of ARC) {
      if (!s.reach || s.kind !== 'local') continue;
      for (const p of hazardPolys) {
        if (p.study !== s.id) continue;
        const dx = Math.max(p.b[0] - lon, 0, lon - p.b[2]) * KX * 1000, dy = Math.max(p.b[1] - lat, 0, lat - p.b[3]) * KY * 1000;
        if (Math.hypot(dx, dy) > s.reach) continue;
        for (const ring of p.poly) for (let k = 0; k < ring.length; k += 3)
          if (Math.hypot((ring[k][0] - lon) * KX, (ring[k][1] - lat) * KY) * 1000 <= s.reach) return s.id;
      }
    }
    return null;
  };
  const inLocalHazard = (lon, lat) => hazardPolys.some((p) => p.kind === 'local' && lon >= p.b[0] && lon <= p.b[2] && lat >= p.b[1] && lat <= p.b[3] && booleanPointInPolygon([lon, lat], { type: 'Polygon', coordinates: p.poly }));

  // -------------------------------------------------------------------------------------------
  // 3. terrain: z10 Terrarium (~100 m) over the whole box, for the sea mask, the route in from the
  //    open Pacific and low coastal ground

  const Z = 10, N = 2 ** Z;
  const txOf = (lon) => ((lon + 180) / 360) * N;
  const tyOf = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };
  const lonOf = (tx) => (tx / N) * 360 - 180;
  const latOf = (ty) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / N))) * 180) / Math.PI;
  const X0 = Math.floor(txOf(BBOX.west)), X1 = Math.floor(txOf(BBOX.east)), Y0 = Math.floor(tyOf(BBOX.north)), Y1 = Math.floor(tyOf(BBOX.south));
  const W = (X1 - X0 + 1) * 256, H = (Y1 - Y0 + 1) * 256;
  const elev = new Float32Array(W * H);
  const keys = [];
  for (let ty = Y0; ty <= Y1; ty++) for (let tx = X0; tx <= X1; tx++) keys.push([tx, ty]);
  log(`  terrain: ${keys.length} tiles at z${Z} (${W}×${H} cells)`);
  await pool(keys, 6, async ([tx, ty]) => {
    const buf = await cached(`tsunami/dem/${Z}-${tx}-${ty}.png`, () => fetchBuf(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`));
    const t = decodeTerrarium(buf);
    const ox = (tx - X0) * 256, oy = (ty - Y0) * 256;
    for (let y = 0; y < 256; y++) elev.set(t.subarray(y * 256, y * 256 + 256), (oy + y) * W + ox);
  });
  const cellLon = (x) => lonOf(X0 + (x + 0.5) / 256), cellLat = (y) => latOf(Y0 + (y + 0.5) / 256);
  const cellM = (40075016 * Math.cos((49.5 * Math.PI) / 180)) / N / 256; // ~99 m
  const sea = (i) => elev[i] <= 0;

  // Route in from the open Pacific: breadth-first through the sea from the west edge and the open
  // ocean on the south and north edges, then on up to NEAR_SEA_M into ground below SCREEN_M. The
  // step count orders the app's sweep; it is a path length, not a travel time.
  const route = new Int32Array(W * H).fill(-1);
  let queue = new Int32Array(W * H), qh = 0, qt = 0;
  const seed = (x, y) => { const i = y * W + x; if (sea(i) && route[i] < 0) { route[i] = 0; queue[qt++] = i; } };
  for (let y = 0; y < H; y++) seed(0, y);
  for (let x = 0; x < W; x++) {
    if (cellLon(x) < -124.75) seed(x, H - 1); // open Pacific off the Olympic coast, not Juan de Fuca Strait
    if (cellLon(x) < -127.6) seed(x, 0); // Queen Charlotte Sound
  }
  const landStep = new Uint8Array(W * H); // steps taken over land, for the near-sea limit
  const maxLand = Math.round(NEAR_SEA_M / cellM);
  while (qh < qt) {
    const i = queue[qh++], x = i % W, y = (i - x) / W, d = route[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (route[j] >= 0) continue;
      if (sea(j)) {
        if (!sea(i)) continue; // no portages: sea is only reached through sea
        route[j] = d + 1; queue[qt++] = j;
      } else if (elev[j] < SCREEN_M) {
        const ls = sea(i) ? 1 : landStep[i] + 1;
        if (ls > maxLand) continue;
        landStep[j] = ls; route[j] = d + 1; queue[qt++] = j;
      }
    }
  }
  queue = null;

  // The atlas's islands as a cell mask (even-odd scanline fill of the display outline, grown by a
  // cell so the shoreline itself counts).
  const isl = new Uint8Array(W * H);
  {
    const edges = [];
    for (const poly of polysOf(island.display.geometry)) for (const ring of poly)
      for (let k = 0; k < ring.length - 1; k++) {
        const ax = (txOf(ring[k][0]) - X0) * 256, ay = (tyOf(ring[k][1]) - Y0) * 256;
        const bx = (txOf(ring[k + 1][0]) - X0) * 256, by = (tyOf(ring[k + 1][1]) - Y0) * 256;
        if (ay !== by) edges.push(ay < by ? [ay, by, ax, (bx - ax) / (by - ay)] : [by, ay, bx, (ax - bx) / (ay - by)]);
      }
    edges.sort((a, b) => a[0] - b[0]);
    const xs = [];
    for (let y = 0; y < H; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (const [y0, y1, x0, sl] of edges) { if (y0 > yc) break; if (y1 > yc) xs.push(x0 + (yc - y0) * sl); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(W, xs[k + 1] - 0.5); x++) isl[y * W + x] = 1;
    }
    const grown = isl.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!isl[i] && (isl[i - 1] || isl[i + 1] || isl[i - W] || isl[i + W])) grown[i] = 1;
    }
    isl.set(grown);
  }

  // Low coastal ground cells on the atlas's islands, plus a sparse lattice of sea cells for the wave.
  const ground = { idx: [], e: [], s: [] };
  let gPrev = 0, maxRoute = 0;
  for (let i = 0; i < W * H; i++) if (route[i] > maxRoute) maxRoute = route[i];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (route[i] < 0 || sea(i) || !isl[i]) continue;
    ground.idx.push(i - gPrev); gPrev = i;
    ground.e.push(Math.max(0, Math.round(elev[i])));
    ground.s.push(route[i]);
  }
  const SEA_STEP = 10;
  const wave = { idx: [], s: [] };
  let wPrev = 0;
  for (let y = 0; y < H; y += SEA_STEP) for (let x = (y / SEA_STEP) % 2 ? SEA_STEP / 2 : 0; x < W; x += SEA_STEP) {
    const i = y * W + x;
    if (route[i] < 0 || !sea(i)) continue;
    wave.idx.push(i - wPrev); wPrev = i;
    wave.s.push(route[i]);
  }
  const groundKm2 = (ground.e.length * cellM * cellM) / 1e6;
  log(`  low coastal ground (< ${SCREEN_M} m, within ${NEAR_SEA_M} m of the sea): ${ground.e.length} cells, ${groundKm2.toFixed(0)} km²; ${wave.s.length} sea cells for the wave`);

  const cellOf = (lon, lat) => {
    const x = Math.floor((txOf(lon) - X0) * 256), y = Math.floor((tyOf(lat) - Y0) * 256);
    return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
  };
  const lowAt = (i) => i >= 0 && route[i] >= 0 && !sea(i) && isl[i] === 1;

  // -------------------------------------------------------------------------------------------
  // 4. towns: zone, share of the ground near the centre that is low coastal ground, mapped areas

  const towns = {};
  const r = Math.round(TOWN_R_M / cellM);
  for (const m of PLACES) {
    const c = cellOf(m.lon, m.lat);
    if (c < 0) continue;
    const cx = c % W, cy = (c - cx) / W;
    let land = 0, low = 0, mapped = 0, mappedHaz = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (sea(i)) continue;
      land++;
      if (route[i] >= 0) low++; // not limited to the outline: Alert Bay's island isn't in it
      const lon = cellLon(x), lat = cellLat(y);
      if ((dx + dy) % 2 === 0 && coveredBy(lon, lat)) { mapped++; if (inLocalHazard(lon, lat)) mappedHaz++; }
    }
    const z = zoneAt(m.lon, m.lat, 15);
    const study = coveredBy(m.lon, m.lat);
    towns[m.key] = {
      zone: z?.zone ?? null,
      low: land ? round((100 * low) / land, 1) : 0,
      lowKm2: round((low * cellM * cellM) / 1e6, 2),
      centreM: Math.max(0, Math.round(elev[c])),
      ...(study ? { study, inHazard: inLocalHazard(m.lon, m.lat), mappedHaz: mapped ? round((100 * mappedHaz) / mapped, 1) : 0 } : {}),
    };
  }
  const tv = Object.entries(towns).sort((a, b) => b[1].low - a[1].low);
  log(`  towns: most low coastal ground ${tv.slice(0, 4).map(([k, v]) => `${k} ${v.low}%`).join(', ')}`);

  // -------------------------------------------------------------------------------------------
  // 5. parcels: share below the screening height near the sea, share inside a mapped hazard area,
  //    in land.json's own order

  const land = await readOut('land');
  const n = land.count;
  const zoneIdx = (z) => (z ? 'ABCDE'.indexOf(z) : -1);
  const P = { zone: [], lo: [], haz: [] };
  const MX = 111320 * Math.cos((49.5 * Math.PI) / 180), MY = 110540, STEP = 25;
  let coastal = 0, mappedN = 0;
  for (let k = 0; k < n; k++) {
    const rings = land.shapes[k].map((enc) => {
      const ring = [];
      let x = 0, y = 0;
      for (let j = 0; j < enc.length; j += 2) { x += enc[j]; y += enc[j + 1]; ring.push([x / 1e5, y / 1e5]); }
      return ring;
    });
    const lon0 = land.cols.lon[k], lat0 = land.cols.lat[k];
    const elevLo = land.cols.elevLo[k];
    const z = zoneAt(lon0, lat0, 3);
    P.zone.push(zoneIdx(z?.zone));
    const study = coveredBy(lon0, lat0);
    if ((elevLo != null && elevLo >= SCREEN_M + 10) && !study) { P.lo.push(0); P.haz.push(null); continue; }
    // sample the parcel on a ~25 m grid (coarser for big parcels)
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of rings) for (const [x, y] of ring) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    const areaM2 = (b[2] - b[0]) * MX * (b[3] - b[1]) * MY;
    const step = Math.max(STEP, Math.sqrt(areaM2 / 4000));
    let tot = 0, low = 0, haz = 0;
    for (let y = b[1] + step / MY / 2; y < b[3]; y += step / MY) for (let x = b[0] + step / MX / 2; x < b[2]; x += step / MX) {
      if (!rings.some((ring) => booleanPointInPolygon([x, y], { type: 'Polygon', coordinates: [ring] }))) continue;
      tot++;
      if (lowAt(cellOf(x, y))) low++;
      if (study && inLocalHazard(x, y)) haz++;
    }
    if (!tot) { tot = 1; if (lowAt(cellOf(lon0, lat0))) low = 1; if (study && inLocalHazard(lon0, lat0)) haz = 1; }
    if (low) coastal++;
    if (study) mappedN++;
    P.lo.push(Math.round((100 * low) / tot));
    P.haz.push(study ? Math.round((100 * haz) / tot) : null);
  }
  log(`  parcels: ${coastal} with low coastal ground, ${mappedN} inside a mapped study area`);
  const check = crypto.createHash('sha1').update(land.cols.pid.join('|')).digest('hex').slice(0, 12);

  // -------------------------------------------------------------------------------------------

  const sources = [
    'Emergency Management and Climate Readiness BC, Tsunami Notification Zones for BC (BC Data Catalogue, Open Government Licence – British Columbia)',
    ...ARC.filter((s) => s.id !== 'srd-alaska').map((s) => `${s.publisher} (${s.licence})`),
    `Mapzen/AWS Terrarium terrain tiles (z${Z}, ~${Math.round(cellM)} m) for low coastal ground`,
  ];
  await writeOut('tsunami', {
    source: sources.join('; '),
    screenM: SCREEN_M, nearSeaM: NEAR_SEA_M, townRadiusM: TOWN_R_M,
    zones: zones.map(({ zone, label, color }) => ({ zone, label, color })),
    areas: areas.map(({ polys, ...a }) => ({ ...a, polygons: polys.length })),
    groundKm2: round(groundKm2, 0),
    // town key -> { zone, low: % of ground within 2 km below the screening height near the sea, lowKm2, centreM, study?, inHazard?, mappedHaz? }
    towns,
  });
  await writeOut('tsunami-map', {
    zones, areas: areas.map(({ id, polys }) => ({ id, polys })),
    // cells of the z10 Web Mercator pixel grid starting at tile (x0, y0); idx is delta-encoded row-major;
    // s = steps along the sea route in from the open Pacific (a path length, not a travel time)
    z: Z, x0: X0, y0: Y0, w: W, maxS: maxRoute,
    ground, wave,
  });
  await writeOut('land-tsunami', {
    source: 'Worked out from tsunami.json and the Land Finder parcels: notification zone of the nearest coast, share of the parcel on low coastal ground, share inside a mapped hazard area',
    count: n, check, screenM: SCREEN_M,
    zone: P.zone, lo: P.lo, haz: P.haz,
  });
}
