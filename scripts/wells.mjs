// Groundwater: every water-supply well in BC's GWELLS registry on Vancouver Island and the shortlisted
// islands (location, depth, yield, water level, construction year, aquifer), the mapped aquifers with
// their productivity and vulnerability, per-town well statistics, and per-parcel "well prospects" for
// the Land Finder. Run as the `wells` stage of fetch-data.mjs. It reads land.json (when there is one)
// for the parcel list, so it runs after `land`; it never writes land.json, only its own files:
//
//   wells.json       wells, aquifers and per-town figures for the map layer and the Town Report
//   land-wells.json  per-parcel figures for the Land Finder, keyed by PID in land.json's order
//
// GWELLS records depths and water levels in feet below ground and yields in US gallons a minute. The
// atlas keeps yields in US gpm (the unit drillers, lenders and listings use in BC) and turns depths into
// metres like everything else in the app.

import fs from 'node:fs/promises';
import path from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import simplify from '@turf/simplify';

const FT = 0.3048;
const LOW_GPM = 2; // under this a home usually needs a storage tank to get through the day
const PARCEL_KM = 1; // "nearby" for a parcel
const TOWN_KM = 5; // "nearby" for a town (islands use the whole island)
const SUPPLY = new Set(['Water Supply', 'Unknown', null, '']);

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quant = (s, q) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];

export async function buildWells(h) {
  const { log, writeOut, round, distKm, wfsAll, getIsland, onIsland, OUT, PLACES, ISLAND_COMMUNITIES } = h;
  const isl = await getIsland();

  // ---------------------------------------------------------------------------------------------
  // wells

  const props = ['WELL_TAG_NUMBER', 'WELL_CLASS', 'WELL_STATUS', 'INTENDED_WATER_USE', 'FINISHED_WELL_DEPTH', 'TOTAL_DEPTH_DRILLED', 'YIELD', 'STATIC_WATER_LEVEL', 'ARTESIAN_FLOW', 'CONSTRUCTION_START_DATE', 'CONSTRUCTION_END_DATE', 'AQUIFER_ID', 'LEGAL_PID', 'GEOMETRY', 'OBJECTID'];
  const feats = await wfsAll('WHSE_WATER_MANAGEMENT.GW_WATER_WELLS_WRBC_SVW', { props, cacheKey: 'gwells' });
  log(`  ${feats.length} registry wells in the box`);

  const classes = {};
  const year = (s) => {
    if (!s) return null;
    // legacy records carry placeholder dates: 1 January 1900 or 1950 means "not recorded"
    if (/^(1900|1950)-01-01/.test(s)) return null;
    const d = new Date(s.replace(/Z$/, ''));
    if (Number.isNaN(+d)) return null;
    const y = d.getUTCFullYear();
    if (y < 1880 || y > new Date().getFullYear()) return null;
    return y + (d - Date.UTC(y, 0, 1)) / (365.25 * 864e5);
  };
  const raw = [];
  for (const f of feats) {
    const p = f.properties;
    const c = f.geometry?.coordinates;
    if (!c) continue;
    classes[p.WELL_CLASS ?? 'none'] = (classes[p.WELL_CLASS ?? 'none'] ?? 0) + 1;
    // monitoring holes, geotechnical holes, dewatering points and heat-exchange loops aren't water wells
    if (!SUPPLY.has(p.WELL_CLASS)) continue;
    if (p.WELL_STATUS === 'Decommission' || p.WELL_STATUS === 'Closure') continue;
    const [lon, lat] = c;
    if (!onIsland(lon, lat, 0.01)) continue;
    const ft = p.FINISHED_WELL_DEPTH ?? p.TOTAL_DEPTH_DRILLED;
    const depth = ft > 0 && ft < 3000 ? ft * FT : null;
    // a yield of 0 is not a dry hole: legacy records use 0 for "not tested" (well 1010 reads "ample supply"
    // with a yield of 0), and dry holes are rarely registered as water-supply wells, so 0 counts as unknown
    const gpm = p.YIELD != null && p.YIELD > 0 && p.YIELD < 5000 ? p.YIELD : null;
    const swl = p.STATIC_WATER_LEVEL != null && p.STATIC_WATER_LEVEL > -300 && p.STATIC_WATER_LEVEL < 3000 ? p.STATIC_WATER_LEVEL * FT : null;
    raw.push({
      lon: round(lon, 4), lat: round(lat, 4), t: year(p.CONSTRUCTION_END_DATE) ?? year(p.CONSTRUCTION_START_DATE),
      depth, gpm, swl, aq: p.AQUIFER_ID ?? null, tag: p.WELL_TAG_NUMBER, pid: p.LEGAL_PID ?? null,
      artesian: (p.ARTESIAN_FLOW ?? 0) > 0,
    });
  }
  log(`  classes: ${Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  log(`  ${raw.length} water-supply wells on the islands; ${raw.filter((w) => w.t != null).length} dated, ${raw.filter((w) => w.depth != null).length} with a depth, ${raw.filter((w) => w.gpm != null).length} with a yield`);
  if (raw.length < 1000) throw new Error(`only ${raw.length} wells on the islands: the registry query probably changed`);

  // ---------------------------------------------------------------------------------------------
  // aquifers

  const aqFeats = await wfsAll('WHSE_WATER_MANAGEMENT.GW_AQUIFERS_CLASSIFICATION_SVW', {
    props: ['AQUIFER_ID', 'NAME', 'LOCATION', 'MATERIAL', 'SUBTYPE', 'PRODUCTIVITY', 'VULNERABILITY', 'DEMAND', 'QUALITY_CONCERN', 'MAPPING_YEAR', 'GEOMETRY', 'OBJECTID'],
    pageSize: 1000, cacheKey: 'aquifers',
  });
  const aquifers = [];
  for (const f of aqFeats) {
    if (!f.geometry) continue;
    const g = simplify(f, { tolerance: 0.0006, highQuality: false, mutate: false }).geometry;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((poly) => poly.map((ring) => ring.map(([x, y]) => [round(x, 4), round(y, 4)])));
    // keep aquifers that reach the islands: any vertex on land
    const hit = polys.some((poly) => poly[0].some(([x, y], k) => k % 3 === 0 && onIsland(x, y, 0.005)));
    if (!hit) continue;
    const p = f.properties;
    aquifers.push({
      id: p.AQUIFER_ID, name: p.NAME && p.NAME !== String(p.AQUIFER_ID) ? p.NAME : null, loc: p.LOCATION ?? null,
      material: p.MATERIAL ?? null, subtype: p.SUBTYPE ?? null, prod: p.PRODUCTIVITY ?? null, vuln: p.VULNERABILITY ?? null,
      demand: p.DEMAND ?? null, quality: p.QUALITY_CONCERN ?? null, year: p.MAPPING_YEAR ?? null, polys,
    });
  }
  aquifers.sort((a, b) => a.id - b.id);
  const aqIndex = new Map(aquifers.map((a, i) => [a.id, i]));
  const aqBounds = aquifers.map((a) => {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of a.polys) for (const [x, y] of poly[0]) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    return b;
  });
  const aquiferAt = (lon, lat) => {
    for (let i = 0; i < aquifers.length; i++) {
      const b = aqBounds[i];
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      const geom = { type: 'MultiPolygon', coordinates: aquifers[i].polys };
      if (booleanPointInPolygon([lon, lat], geom)) return i;
    }
    return -1;
  };
  log(`  ${aquifers.length} mapped aquifers reach the islands`);

  // ---------------------------------------------------------------------------------------------
  // rows, sorted by construction date (undated wells last)

  raw.sort((a, b) => (a.t ?? 9999) - (b.t ?? 9999));
  // [lon, lat, t | null, depth m | null, yield US gpm | null, static water level m | null, aquifer index | -1, tag, flags]
  // flags: 1 = artesian (flows at the surface); the small island is added below
  const rows = raw.map((w) => [w.lon, w.lat, w.t == null ? null : round(w.t, 3), w.depth == null ? null : round(w.depth, 1), w.gpm == null ? null : round(w.gpm, 2), w.swl == null ? null : round(w.swl, 1), w.aq != null && aqIndex.has(w.aq) ? aqIndex.get(w.aq) : -1, w.tag, w.artesian ? 1 : 0]);

  // a grid index for "wells within r km"
  const CELL = 0.02;
  const grid = new Map();
  rows.forEach((r, i) => {
    const k = `${Math.floor(r[0] / CELL)},${Math.floor(r[1] / CELL)}`;
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  });
  const near = (lon, lat, km) => {
    const out = [];
    const rx = Math.ceil(km / (111.32 * Math.cos((lat * Math.PI) / 180) * CELL)), ry = Math.ceil(km / (110.54 * CELL));
    const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
    for (let x = cx - rx; x <= cx + rx; x++)
      for (let y = cy - ry; y <= cy + ry; y++)
        for (const i of grid.get(`${x},${y}`) ?? []) if (distKm(lon, lat, rows[i][0], rows[i][1]) <= km) out.push(i);
    return out;
  };
  const stats = (idx) => {
    const d = idx.map((i) => rows[i][3]).filter((v) => v != null).sort((a, b) => a - b);
    const y = idx.map((i) => rows[i][4]).filter((v) => v != null).sort((a, b) => a - b);
    return {
      n: idx.length, nDepth: d.length, nYield: y.length,
      depth: d.length ? [round(quant(d, 0.25), 0), round(median(d), 0), round(quant(d, 0.75), 0)] : null,
      gpm: y.length ? [round(quant(y, 0.25), 1), round(median(y), 1), round(quant(y, 0.75), 1)] : null,
      low: y.length ? round(y.filter((v) => v < LOW_GPM).length / y.length, 3) : null,
    };
  };

  // ---------------------------------------------------------------------------------------------
  // towns: wells within 5 km of the centre; an island community uses every well on its island

  const towns = {};
  // which shortlisted small island each well is on (-1: Vancouver Island), with a bounding-box check first
  const smalls = ISLAND_COMMUNITIES.map((c) => {
    const part = isl.parts.get(c.fwa);
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    const polys = part.geometry.type === 'Polygon' ? [part.geometry.coordinates] : part.geometry.coordinates;
    for (const poly of polys) for (const [x, y] of poly[0]) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    return { key: c.key, part, b: [b[0] - 0.01, b[1] - 0.01, b[2] + 0.01, b[3] + 0.01] };
  });
  const onSmall = rows.map((r) => {
    for (let k = 0; k < smalls.length; k++) {
      const { b, part } = smalls[k];
      if (r[0] < b[0] || r[0] > b[2] || r[1] < b[1] || r[1] > b[3]) continue;
      if (booleanPointInPolygon([r[0], r[1]], part) || onIslandPart(part, r[0], r[1])) return k;
    }
    return -1;
  });
  for (const m of PLACES) {
    const k = smalls.findIndex((s) => s.key === m.key);
    const idx = k >= 0 ? rows.map((_, i) => i).filter((i) => onSmall[i] === k) : near(m.lon, m.lat, TOWN_KM);
    towns[m.key] = { ...stats(idx), area: k >= 0 ? 'island' : `${TOWN_KM} km` };
  }
  // flags: bit 0 = artesian; bits 1+ = 1 + the small island's index in ISLAND_COMMUNITIES (0: Vancouver Island)
  rows.forEach((r, i) => { r[8] |= (onSmall[i] + 1) << 1; });
  const islandIdx = rows.map((_, i) => i).filter((i) => onSmall[i] < 0);
  const smallIdx = rows.map((_, i) => i).filter((i) => onSmall[i] >= 0);
  const summary = { vancouverIsland: stats(islandIdx), smallIslands: stats(smallIdx) };
  log(`  Vancouver Island: median ${summary.vancouverIsland.depth?.[1]} m, ${summary.vancouverIsland.gpm?.[1]} gpm, ${Math.round(summary.vancouverIsland.low * 100)}% low · small islands: median ${summary.smallIslands.depth?.[1]} m, ${summary.smallIslands.gpm?.[1]} gpm, ${Math.round(summary.smallIslands.low * 100)}% low`);

  await writeOut('wells', {
    source: 'BC Ministry of Water, Land and Resource Stewardship: GWELLS groundwater wells registry (WHSE_WATER_MANAGEMENT.GW_WATER_WELLS_WRBC_SVW) and the BC aquifer classification (GW_AQUIFERS_CLASSIFICATION_SVW), via the BC Data Catalogue WFS, Open Government Licence – British Columbia',
    units: { depth: 'm below ground', yield: 'US gallons a minute (driller’s estimate)', level: 'm below ground' },
    lowGpm: LOW_GPM, townKm: TOWN_KM, islands: ISLAND_COMMUNITIES.map((c) => c.key),
    cols: ['lon', 'lat', 't', 'depth', 'gpm', 'level', 'aquifer', 'tag', 'flags'],
    rows, aquifers, towns, summary,
  });

  // ---------------------------------------------------------------------------------------------
  // parcels: well prospects within 1 km of each Land Finder parcel, in land.json's order

  let land;
  try { land = JSON.parse(await fs.readFile(path.join(OUT, 'land.json'), 'utf8')); } catch { log('  no land.json yet: skipping land-wells.json'); return; }
  const { pid, lon, lat } = land.cols;
  const own = new Map();
  for (const w of raw) if (w.pid) own.set(w.pid, (own.get(w.pid) ?? 0) + 1);
  const out = { n: [], depth: [], gpm: [], low: [], aq: [], own: [] };
  for (let i = 0; i < land.count; i++) {
    const idx = near(lon[i], lat[i], PARCEL_KM);
    const s = stats(idx);
    out.n.push(idx.length);
    out.depth.push(s.depth?.[1] ?? null);
    out.gpm.push(s.gpm?.[1] ?? null);
    out.low.push(s.low == null ? null : Math.round(s.low * 100));
    out.aq.push(aquiferAt(lon[i], lat[i]));
    out.own.push(own.get(Number(String(pid[i] ?? '').replace(/-/g, ''))) ?? 0);
  }
  log(`  parcels: ${out.n.filter((v) => v > 0).length}/${land.count} have wells within ${PARCEL_KM} km, ${out.aq.filter((v) => v >= 0).length} sit over a mapped aquifer, ${out.own.filter((v) => v > 0).length} have a registered well of their own`);
  await writeOut('land-wells', {
    source: 'GWELLS wells within 1 km of each parcel’s centre and BC mapped aquifers (BC Data Catalogue, OGL-BC); parcels from land.json',
    km: PARCEL_KM, lowGpm: LOW_GPM, count: land.count,
    // pid lines up with land.json's cols.pid, so a reader can check the order still matches
    pid, ...out,
  });
}

/** Fast-enough test for a point on one island polygon (used only to catch wells just offshore by GPS error). */
function onIslandPart(part, lon, lat) {
  for (const [dx, dy] of [[0.004, 0], [-0.004, 0], [0, 0.004], [0, -0.004]]) if (booleanPointInPolygon([lon + dx, lat + dy], part)) return true;
  return false;
}
