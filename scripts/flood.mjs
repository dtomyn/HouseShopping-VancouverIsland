// Floodplains: run as the `flood` stage of fetch-data.mjs, after `land` (it reads land.json).
//
// Sources, all from the BC Data Catalogue under the Open Government Licence – British Columbia:
//  - Mapped Floodplains in BC (Historical): the designated 200-year floodplains of the provincial
//    Floodplain Mapping Program (WHSE_BASEMAPPING.CWB_FLOODPLAINS_BC_AREA_SVW), with each map's
//    drawing number and designation date
//  - Mapped Floodplains in BC (Historical) - Study Area Limits: where each study stopped mapping
//    (WHSE_BASEMAPPING.CWB_FLOODPLAINS_LIMIT_LINE_SP)
//  - Mapped Floodplains in BC (Historical) - Mapsheets Index: each map sheet's publication date and its
//    report in the Aquatic Report Catalogue (EcoCat) (WHSE_WATER_MANAGEMENT.FLDP_FLOODPLAIN_PROJ_REPORT_SP)
//
// These are historical maps, digitized from paper 1:5,000 sheets: on the islands they date from 1978 to 1997. Newer
// regional and municipal flood mapping (searched: Cowichan Valley, Comox Valley, Strathcona/Campbell River,
// Nanaimo, North Cowichan) is only in viewer-only web maps or services without an open licence, several reusing
// this provincial layer, so none is copied here. An unmapped river is not a safe river.
//
// Outputs:
//  - flood.json: the island's floodplain studies (name, drawing, year, area, report link) and per-town
//    exposure (small; loaded with the app)
//  - flood-map.json: floodplain shapes and the study-limit lines (loaded when the layer is first shown)
//  - land-flood.json: per-parcel share inside a mapped floodplain, aligned with land.json's parcel order

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import simplify from '@turf/simplify';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { pager } from './neighbours.mjs';

const TOWN_R_M = 2000; // town exposure: ground within this radius of the town centre
const TOWN_STEP_M = 50; // sample spacing for the town disc
const LAT0 = 49.5;
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MY = 110540; // metres per degree, locally

const ringsOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const bboxOf = (poly) => {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of poly[0]) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return b;
};
const ringAreaM2 = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * MX + ring[i][0] * MX) * (ring[j][1] * MY - ring[i][1] * MY); return Math.abs(a / 2); };
const polyAreaM2 = (poly) => ringAreaM2(poly[0]) - poly.slice(1).reduce((s, r) => s + ringAreaM2(r), 0);

/** "94/09", "92/09/30", "April 90", "Sept 91", "May 78" → a four-digit year. */
function yearOf(s) {
  const t = String(s ?? '').trim();
  const m = t.match(/^(\d{2})\//) ?? t.match(/(\d{2})$/);
  if (!m) return null;
  const yy = +m[1];
  return yy < 30 ? 2000 + yy : 1900 + yy;
}

export async function buildFlood(h) {
  const { log, cached, writeOut, round, WFS, BBOX, getIsland, PLACES, OUT } = h;
  const island = await getIsland();
  const wfs = pager({ log, cached, WFS, BBOX }, 'flood');
  const readOut = async (name) => JSON.parse(await fs.readFile(path.join(OUT, `${name}.json`), 'utf8'));
  const onIslands = (lon, lat) => booleanPointInPolygon([lon, lat], island.display);

  // -------------------------------------------------------------------------------------------
  // 1. floodplain polygons, report sheets and study-limit lines inside the box

  const areaF = await wfs('WHSE_BASEMAPPING.CWB_FLOODPLAINS_BC_AREA_SVW', { bbox: true, cacheKey: 'areas' });
  const sheetF = await wfs('WHSE_WATER_MANAGEMENT.FLDP_FLOODPLAIN_PROJ_REPORT_SP', { bbox: true, cacheKey: 'sheets' });
  const limitF = await wfs('WHSE_BASEMAPPING.CWB_FLOODPLAINS_LIMIT_LINE_SP', { bbox: true, cacheKey: 'limits' });
  if (!areaF.length) throw new Error('no floodplain polygons returned');

  // Keep the polygons on the atlas's islands (the box also takes in Squamish, Whistler and the Lillooet). Each is a
  // 200-year floodplain or an alluvial fan; polygons named "Nothing" are ground the study left out of the floodplain
  // (high ground inside it), kept apart as dry islands.
  const polys = []; // { name, drawing, designated, kind, poly, b }
  const dry = []; // { poly, b }
  for (const f of areaF) {
    const p = f.properties;
    const feature = String(p.FEATURE_NAME ?? '').trim();
    for (const poly of ringsOf(f.geometry)) {
      const b = bboxOf(poly);
      const pts = poly[0];
      const inside = pts.filter((_, k) => k % 7 === 0).filter(([x, y]) => onIslands(x, y)).length;
      if (inside < Math.ceil(pts.length / 7) * 0.3) continue;
      if (feature === 'Nothing' || (!p.DRAWING_NO && !p.FLOODPLAIN_NAME)) { dry.push({ poly, b }); continue; }
      polys.push({ name: String(p.FLOODPLAIN_NAME ?? '').trim(), drawing: String(p.DRAWING_NO ?? '').trim(), designated: p.DESIGNATION_DATE ?? null, kind: /fan/i.test(feature) ? 'fan' : 'floodplain', poly, b });
    }
  }
  if (!polys.length) throw new Error('no floodplain polygons on the islands');

  // Dry islands inside a floodplain become holes in it for drawing (the lookups below test them directly).
  const inPoly = (pt, poly) => booleanPointInPolygon(pt, { type: 'Polygon', coordinates: poly });
  for (const d of dry) {
    const host = polys.find((p) => inPoly(d.poly[0][0], [p.poly[0]]));
    if (host) host.poly = [...host.poly, d.poly[0]];
  }
  log(`  ${dry.length} dry islands inside the floodplains`);

  // Studies, one per drawing number, with the report sheets that share its drawing number.
  const sheets = sheetF.map((f) => ({ drawing: String(f.properties.DRAWING_NO ?? ''), name: f.properties.PROJECT_NAME, published: f.properties.PUBLISHED_DATE, url: f.properties.ACAT_REPORT_URL }));
  const studies = [];
  const byDrawing = new Map();
  for (const p of polys) {
    const key = p.drawing || 'unnamed';
    let s = byDrawing.get(key);
    if (!s) {
      const mine = sheets.filter((x) => p.drawing && (x.drawing === p.drawing || x.drawing.startsWith(`${p.drawing}-`)));
      const pub = mine.map((x) => +String(x.published).slice(0, 4)).filter(Number.isFinite);
      const url = mine.find((x) => x.url)?.url ?? null;
      s = {
        id: key, drawing: p.drawing || null, names: new Set(), designated: yearOf(p.designated),
        published: pub.length ? Math.max(...pub) : null,
        sheets: mine.length, report: url ? url.replace(/^http:\/\//, 'https://') : null,
        areaM2: 0, b: [Infinity, Infinity, -Infinity, -Infinity],
      };
      byDrawing.set(key, s);
      studies.push(s);
    }
    if (p.name) s.names.add(p.name);
    if (p.kind === 'fan') s.fanM2 = (s.fanM2 ?? 0) + polyAreaM2(p.poly);
    s.areaM2 += polyAreaM2(p.poly);
    s.b = [Math.min(s.b[0], p.b[0]), Math.min(s.b[1], p.b[1]), Math.max(s.b[2], p.b[2]), Math.max(s.b[3], p.b[3])];
    p.study = s;
  }
  const yearOfStudy = (s) => s.designated ?? s.published;
  studies.sort((a, b) => (yearOfStudy(a) ?? 0) - (yearOfStudy(b) ?? 0) || a.id.localeCompare(b.id));
  // tidy the source's 30-character names ("Courtenay,Puntledge,Tsolum Riv"): spaces after commas, a cut-off "Riv"
  const tidy = (t) => t.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').replace(/ Riv$/, ' Rivers').replace(/ & /g, ' and ');
  studies.forEach((s, i) => {
    s.idx = i;
    s.name = [...s.names].map(tidy).join(' · ') || 'Unnamed floodplain';
    // the map sheets' own project titles (e.g. "Cowichan Koksilah R at Duncan"), distinct ones only
    s.projects = [...new Set(sheets.filter((x) => s.drawing && (x.drawing === s.drawing || x.drawing.startsWith(`${s.drawing}-`))).map((x) => String(x.name ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  });
  log(`  ${polys.length} floodplain polygons in ${studies.length} studies on the islands: ${studies.map((s) => `${s.name} (${yearOfStudy(s)})`).join(', ')}`);

  // Study-limit lines near an island floodplain.
  const pad = 2000 / MX;
  const near = (x, y) => studies.some((s) => x >= s.b[0] - pad && x <= s.b[2] + pad && y >= s.b[1] - pad && y <= s.b[3] + pad);
  const limits = [];
  for (const f of limitF) {
    const g = f.geometry;
    const lines = !g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      const mid = line[Math.floor(line.length / 2)];
      if (near(mid[0], mid[1])) limits.push(line.map(([x, y]) => [round(x, 5), round(y, 5)]));
    }
  }
  log(`  ${limits.length} study-limit lines`);

  const isDry = (lon, lat) => dry.some((d) => lon >= d.b[0] && lon <= d.b[2] && lat >= d.b[1] && lat <= d.b[3] && inPoly([lon, lat], d.poly));
  const inFlood = (lon, lat) => {
    if (isDry(lon, lat)) return null;
    for (const p of polys) {
      if (lon < p.b[0] || lon > p.b[2] || lat < p.b[1] || lat > p.b[3]) continue;
      if (booleanPointInPolygon([lon, lat], { type: 'Polygon', coordinates: p.poly })) return p.study;
    }
    return null;
  };

  // -------------------------------------------------------------------------------------------
  // 2. towns: share of the ground within 2 km of the centre inside a mapped floodplain, which study, and
  //    the nearest mapped floodplain

  const towns = {};
  const r = Math.round(TOWN_R_M / TOWN_STEP_M);
  for (const m of PLACES) {
    let land = 0, wet = 0;
    const hits = new Map();
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const lon = m.lon + (dx * TOWN_STEP_M) / MX, lat = m.lat + (dy * TOWN_STEP_M) / MY;
      const s = inFlood(lon, lat);
      if (!s && !onIslands(lon, lat)) continue; // sea
      land++;
      if (s) { wet++; hits.set(s.idx, (hits.get(s.idx) ?? 0) + 1); }
    }
    // nearest mapped floodplain edge (vertex distance), in km
    let nearKm = Infinity, nearS = null;
    for (const p of polys) {
      const ddx = Math.max(p.b[0] - m.lon, 0, m.lon - p.b[2]) * MX, ddy = Math.max(p.b[1] - m.lat, 0, m.lat - p.b[3]) * MY;
      if (Math.hypot(ddx, ddy) / 1000 > Math.min(nearKm, 30)) continue;
      for (const ring of p.poly) for (const [x, y] of ring) {
        const d = Math.hypot((x - m.lon) * MX, (y - m.lat) * MY) / 1000;
        if (d < nearKm) { nearKm = d; nearS = p.study; }
      }
    }
    const centre = inFlood(m.lon, m.lat);
    const t = {
      pct: land ? round((100 * wet) / land, 1) : 0,
      km2: round((wet * TOWN_STEP_M * TOWN_STEP_M) / 1e6, 2),
      studies: [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i),
    };
    if (centre) t.centre = centre.idx;
    if (nearS && nearKm <= 30) { t.nearKm = round(centre ? 0 : nearKm, 1); t.near = nearS.idx; }
    towns[m.key] = t;
  }
  const tv = Object.entries(towns).sort((a, b) => b[1].pct - a[1].pct);
  log(`  towns: most floodplain within ${TOWN_R_M / 1000} km ${tv.slice(0, 6).map(([k, v]) => `${k} ${v.pct}%`).join(', ')}`);

  // -------------------------------------------------------------------------------------------
  // 3. parcels: share of each Land Finder parcel inside a mapped floodplain, in land.json's own order

  const land = await readOut('land');
  const n = land.count;
  const P = { pct: [], study: [] };
  const STEP = 20;
  let touched = 0;
  for (let k = 0; k < n; k++) {
    const rings = land.shapes[k].map((enc) => {
      const ring = [];
      let x = 0, y = 0;
      for (let j = 0; j < enc.length; j += 2) { x += enc[j]; y += enc[j + 1]; ring.push([x / 1e5, y / 1e5]); }
      return ring;
    });
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of rings) for (const [x, y] of ring) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    const cand = polys.filter((p) => p.b[0] <= b[2] && b[0] <= p.b[2] && p.b[1] <= b[3] && b[1] <= p.b[3]);
    if (!cand.length) { P.pct.push(0); P.study.push(-1); continue; }
    const areaM2 = (b[2] - b[0]) * MX * (b[3] - b[1]) * MY;
    const step = Math.max(STEP, Math.sqrt(areaM2 / 5000));
    let tot = 0, wet = 0;
    const hits = new Map();
    const test = (x, y) => {
      if (isDry(x, y)) return null;
      for (const p of cand) {
        if (x < p.b[0] || x > p.b[2] || y < p.b[1] || y > p.b[3]) continue;
        if (booleanPointInPolygon([x, y], { type: 'Polygon', coordinates: p.poly })) return p.study;
      }
      return null;
    };
    for (let y = b[1] + step / MY / 2; y < b[3]; y += step / MY) for (let x = b[0] + step / MX / 2; x < b[2]; x += step / MX) {
      if (!rings.some((ring) => booleanPointInPolygon([x, y], { type: 'Polygon', coordinates: [ring] }))) continue;
      tot++;
      const s = test(x, y);
      if (s) { wet++; hits.set(s.idx, (hits.get(s.idx) ?? 0) + 1); }
    }
    if (!tot) { tot = 1; const s = test(land.cols.lon[k], land.cols.lat[k]); if (s) { wet = 1; hits.set(s.idx, 1); } }
    const pct = Math.round((100 * wet) / tot);
    const top = [...hits.entries()].sort((a, c) => c[1] - a[1])[0];
    P.pct.push(wet && !pct ? 1 : pct); // a sliver still counts as touching
    P.study.push(top ? top[0] : -1);
    if (wet) touched++;
  }
  log(`  parcels: ${touched} of ${n} touch a mapped floodplain`);
  const check = crypto.createHash('sha1').update(land.cols.pid.join('|')).digest('hex').slice(0, 12);

  // -------------------------------------------------------------------------------------------

  const source = 'Ministry of Water, Land and Resource Stewardship, Mapped Floodplains in BC (Historical), its Study Area Limits and Mapsheets Index (BC Data Catalogue, Open Government Licence – British Columbia)';
  await writeOut('flood', {
    source, townRadiusM: TOWN_R_M,
    studies: studies.map((s) => ({
      name: s.name, projects: s.projects, drawing: s.drawing, designated: s.designated, published: s.published, sheets: s.sheets, report: s.report,
      ha: Math.round(s.areaM2 / 1e4), ...(s.fanM2 ? { fanHa: Math.round(s.fanM2 / 1e4) } : {}), centre: [round((s.b[0] + s.b[2]) / 2, 4), round((s.b[1] + s.b[3]) / 2, 4)],
    })),
    // town key -> { pct: % of ground within 2 km inside a mapped floodplain, km2, studies (by share), centre?: study at the
    // town centre, near?/nearKm?: nearest mapped floodplain within 30 km }
    towns,
  });
  await writeOut('flood-map', {
    // floodplain polygons (outer ring + holes, lon/lat at 5 decimals) with their study index
    polys: polys.map((p) => {
      const g = simplify({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: p.poly } }, { tolerance: 0.00004, highQuality: false, mutate: false }).geometry;
      return { s: p.study.idx, ...(p.kind === 'fan' ? { fan: 1 } : {}), poly: g.coordinates.filter((ring) => ring.length >= 4).map((ring) => ring.map(([x, y]) => [round(x, 5), round(y, 5)])) };
    }).filter((p) => p.poly.length),
    limits,
  });
  await writeOut('land-flood', {
    source: 'Worked out from Mapped Floodplains in BC (Historical) and the Land Finder parcels: share of each parcel inside a mapped floodplain, and the study that mapped it',
    count: n, check,
    studies: studies.map((s) => ({ name: s.name, year: yearOfStudy(s) })),
    pct: P.pct, study: P.study,
  });
}
