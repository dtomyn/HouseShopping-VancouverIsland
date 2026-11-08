// Radon: run as the `radon` stage of fetch-data.mjs.
//
// Sources, both open:
//  - Health Canada, Cross-Canada Survey of Radon Concentrations in Homes (open.canada.ca, Open Government Licence –
//    Canada): one row per home tested, roughly 14,000 homes tested for three months or more in 2009–2011, with the
//    home's 2007 health region and the first three characters of its postal code (FSA). Results under 15 Bq/m³ are
//    published as "<15".
//  - BC Data Catalogue, Health Service Delivery Area Boundaries (WHSE_ADMIN_BOUNDARIES.BCHA_HEALTH_SERV_DEL_AREA_SP,
//    Open Government Licence – British Columbia): the outlines of those health regions. BC's 2007 health regions
//    (codes 5911–5953) are its health service delivery areas (codes 11–53); the outlines are today's.
//
// The finer BC Radon Data Repository (BCCDC) is released only on approved data requests, so it isn't used. The survey
// is the open, downloadable measure: ~270 homes across the island's three health areas, so the numbers are area-level
// only and say nothing about any one street or house.
//
// Outputs:
//  - radon.json: the three island areas (stats, every test value, tests by postal area), every BC health area's stats
//    for comparison, BC and Canada totals, and each town's area (small; loaded with the app)
//  - radon-map.json: the three areas' outlines, in the same order (loaded when the layer is first shown)

import simplify from '@turf/simplify';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { pager } from './neighbours.mjs';

const DATASET = 'https://open.canada.ca/data/en/dataset/b3bad1b0-32d4-4656-8a64-59b43900d482';
const CSV_URL = 'https://open.canada.ca/data/dataset/b3bad1b0-32d4-4656-8a64-59b43900d482/resource/1bf4724b-8f38-4932-9c32-e11a45011dcf/download/radon-concentration.csv';
const ISLAND_CODES = ['41', '42', '43']; // South, Central and North Vancouver Island
const LOD = 15; // results below this were published as "<15"

/** One CSV line into fields, honouring double quotes (some health region names contain commas). */
function splitCSV(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const ringDeg2 = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a / 2); };

/** Summary of a list of results (below-detection results counted as 0). */
function summarize(vals) {
  const v = [...vals].sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return {
    n: v.length,
    over200: v.filter((x) => x > 200).length,
    over600: v.filter((x) => x > 600).length,
    belowLod: v.filter((x) => x < LOD).length,
    median: v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null,
    p90: v.length ? q(0.9) : null,
    max: v.length ? v[v.length - 1] : null,
  };
}

export async function buildRadon(h) {
  const { log, cached, writeOut, round, WFS, BBOX, PLACES } = h;

  // ---- the survey: every home's result
  const csv = (await cached('radon/radon-concentration.csv', async () => {
    const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${CSV_URL}`);
    return Buffer.from(await res.arrayBuffer());
  })).toString('utf8').replace(/^﻿/, '');
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = splitCSV(lines[0]).map((s) => s.trim());
  const col = (name) => {
    const i = head.findIndex((x) => x.replace(/\s/g, '').toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`radon CSV has no ${name} column (found: ${head.join(', ')})`);
    return i;
  };
  const iProv = col('ProvinceTerritory'), iCode = col('HealthRegionCode2007'), iName = col('HealthRegion2007'), iFsa = col('ForwardSortationAreaCodes'), iVal = col('AverageRadonConcentrationInBqPerM3');
  const rows = [];
  let bad = 0;
  for (const line of lines.slice(1)) {
    const f = splitCSV(line);
    const raw = (f[iVal] ?? '').trim();
    const v = raw.startsWith('<') ? 0 : Number(raw);
    if (!raw || !Number.isFinite(v)) { bad++; continue; }
    rows.push({ prov: f[iProv].trim(), code: f[iCode].trim(), name: f[iName].trim(), fsa: (f[iFsa] ?? '').trim(), v });
  }
  log(`  radon survey: ${rows.length} homes (${bad} rows without a result)`);
  if (rows.length < 10000) throw new Error(`only ${rows.length} radon results parsed`);

  const bcRows = rows.filter((r) => r.prov === 'BC' && /^59\d\d$/.test(r.code));
  const byCode = new Map();
  for (const r of bcRows) {
    const k = r.code.slice(2);
    if (!byCode.has(k)) byCode.set(k, { name: r.name, vals: [], rows: [] });
    byCode.get(k).vals.push(r.v);
    byCode.get(k).rows.push(r);
  }
  for (const c of ISLAND_CODES) if (!byCode.has(c)) throw new Error(`no radon results for health area 59${c}`);

  // ---- health service delivery area outlines
  const wfs = pager({ log, cached, WFS, BBOX }, 'radon');
  const feats = await wfs('WHSE_ADMIN_BOUNDARIES.BCHA_HEALTH_SERV_DEL_AREA_SP', {
    cql: `HLTH_SERVICE_DLVR_AREA_CODE IN (${ISLAND_CODES.map((c) => `'${c}'`).join(',')})`,
    cacheKey: 'hsda',
  });
  const shapes = new Map();
  for (const f of feats) {
    // islets under ~2 km² are left out of the drawing (towns are placed against the full outline)
    const g = simplify(f, { tolerance: 0.008, highQuality: true, mutate: false }).geometry;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
      .filter((p) => p[0].length >= 4 && ringDeg2(p[0]) > 0.0003)
      .map((p) => [p[0].map(([x, y]) => [round(x, 3), round(y, 3)])]);
    shapes.set(f.properties.HLTH_SERVICE_DLVR_AREA_CODE, { name: f.properties.HLTH_SERVICE_DLVR_AREA_NAME, polys, feature: f });
  }
  for (const c of ISLAND_CODES) if (!shapes.has(c)) throw new Error(`no outline for health area ${c}`);

  // ---- towns: the health area each town centre is in (nearest outline vertex if a coastal centre falls just outside)
  const towns = {};
  const inArea = (c, lon, lat) => booleanPointInPolygon([lon, lat], shapes.get(c).feature);
  for (const p of PLACES) {
    let code = ISLAND_CODES.find((c) => inArea(c, p.lon, p.lat));
    if (!code) {
      let best = Infinity;
      for (const c of ISLAND_CODES)
        for (const poly of shapes.get(c).polys)
          for (const [x, y] of poly[0]) {
            const d = (x - p.lon) ** 2 + ((y - p.lat) * 1.5) ** 2;
            if (d < best) { best = d; code = c; }
          }
      log(`  ${p.name}: centre outside the outlines, using the nearest (${shapes.get(code).name})`);
    }
    towns[p.key] = ISLAND_CODES.indexOf(code);
  }

  const areas = ISLAND_CODES.map((c) => {
    const { name, vals, rows: rs } = byCode.get(c);
    const fsas = {};
    for (const r of rs) (fsas[r.fsa && r.fsa !== '*' ? r.fsa : 'withheld'] ??= []).push(r.v);
    const members = PLACES.filter((p) => ISLAND_CODES[towns[p.key]] === c);
    return {
      code: `59${c}`, name: shapes.get(c).name || name, surveyName: name,
      ...summarize(vals),
      values: [...vals].sort((a, b) => a - b),
      fsas: Object.entries(fsas).map(([fsa, v]) => ({ fsa, n: v.length, over200: v.filter((x) => x > 200).length, max: Math.max(...v) })).sort((a, b) => b.n - a.n),
      label: members.length ? [round(members.reduce((a, p) => a + p.lon, 0) / members.length, 3), round(members.reduce((a, p) => a + p.lat, 0) / members.length, 3)] : null,
    };
  });
  const bc = [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, { name, vals }]) => {
    const s = summarize(vals);
    return { code: `59${k}`, name, n: s.n, over200: s.over200, median: s.median, island: ISLAND_CODES.includes(k) ? 1 : 0 };
  });
  const tot = (vals) => ({ n: vals.length, over200: vals.filter((x) => x > 200).length });
  for (const a of areas) log(`  ${a.name}: ${a.n} homes, ${a.over200} over 200 Bq/m³, median ${a.median < LOD ? `<${LOD}` : a.median}, max ${a.max}`);

  await writeOut('radon', {
    source: 'Health Canada, Cross-Canada Survey of Radon Concentrations in Homes (2009–2011), open.canada.ca; health area outlines from the BC Data Catalogue',
    url: DATASET,
    years: '2009–2011',
    lod: LOD,
    guideline: 200,
    areas,
    bc,
    totals: { island: tot(areas.flatMap((a) => a.values)), bc: tot(bcRows.map((r) => r.v)), canada: tot(rows.map((r) => r.v)) },
    towns,
  });
  await writeOut('radon-map', { areas: ISLAND_CODES.map((c) => shapes.get(c).polys) });
}
