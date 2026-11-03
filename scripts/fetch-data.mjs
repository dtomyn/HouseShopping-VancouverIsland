#!/usr/bin/env node
// Island Atlas data pipeline.
// Pulls historical open data for Vancouver Island from public government APIs, clips it to the
// island, and writes compact JSON files to public/data/ for the static web app.
//
//   node scripts/fetch-data.mjs                # all sources
//   node scripts/fetch-data.mjs fires quakes   # selected sources
//
// Raw downloads are cached in .cache/ so re-runs are quick. Delete it to force a refresh.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import simplify from '@turf/simplify';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { MUNICIPALITIES, MUNI_BY_KEY, normalizeMuniName } from './municipalities.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, '.cache');

// Generous box around Vancouver Island (lon/lat).
const BBOX = { west: -128.6, south: 48.2, east: -123.0, north: 51.0 };
// Wider box for earthquakes: offshore Cascadia + Juan de Fuca plate events matter.
const QUAKE_BBOX = { west: -130.5, south: 47.5, east: -122.5, north: 51.5 };

const WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs';
const OGC = 'https://api.weather.gc.ca/collections';

// ---------------------------------------------------------------------------------------------
// helpers

const log = (...a) => console.log('·', ...a);
const round = (v, d = 4) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

async function cached(name, producer) {
  const file = path.join(CACHE, name);
  try {
    return await fs.readFile(file);
  } catch {
    const buf = await producer();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
  }
}

async function fetchBuf(url, { retries = 3, timeout = 180_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const fetchJSON = async (url, opts) => JSON.parse((await fetchBuf(url, opts)).toString('utf8'));
const cachedJSON = async (name, url) => JSON.parse((await cached(name, () => fetchBuf(url))).toString('utf8'));

async function writeOut(name, data) {
  await fs.mkdir(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.json`);
  const text = JSON.stringify(data);
  await fs.writeFile(file, text);
  log(`wrote ${name}.json (${(text.length / 1024).toFixed(0)} KB)`);
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

/** Page through a BC Data Catalogue WFS layer inside BBOX. */
async function wfsAll(typeName, { props, pageSize = 5000, cacheKey }) {
  const features = [];
  for (let start = 0; ; start += pageSize) {
    const q = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeName: `pub:${typeName}`,
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      count: String(pageSize),
      startIndex: String(start),
      sortBy: 'OBJECTID',
      bbox: `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east},urn:ogc:def:crs:EPSG:4326`,
    });
    if (props) q.set('propertyName', props.join(','));
    const page = await cachedJSON(`wfs/${cacheKey}-${start}.json`, `${WFS}?${q}`);
    features.push(...page.features);
    log(`  ${typeName}: ${features.length}/${page.numberMatched ?? '?'}`);
    if (page.features.length < pageSize) break;
  }
  return features;
}

/** Page through an MSC GeoMet OGC API collection. */
async function ogcAll(collection, params, cacheKey) {
  const features = [];
  const limit = 10000;
  for (let offset = 0; ; offset += limit) {
    const q = new URLSearchParams({ f: 'json', limit: String(limit), offset: String(offset), ...params });
    const page = await cachedJSON(`ogc/${cacheKey}-${offset}.json`, `${OGC}/${collection}/items?${q}`);
    features.push(...page.features);
    if (page.features.length < limit) break;
  }
  return features;
}

// ---------------------------------------------------------------------------------------------
// island outline (used for clipping and for the glowing coastline in the app)

let island;
async function getIsland() {
  if (island) return island;
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: 'pub:WHSE_BASEMAPPING.FWA_ISLANDS_POLY',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    CQL_FILTER: "GNIS_NAME_1='Vancouver Island'",
  });
  const fc = await cachedJSON('wfs/vancouver-island.json', `${WFS}?${q}`);
  const raw = fc.features[0];
  // Display outline: light simplification keeps inlets readable but small.
  const display = simplify(raw, { tolerance: 0.004, highQuality: true, mutate: false });
  // Clipping outline: coarser, fast for point-in-polygon tests.
  const clip = simplify(raw, { tolerance: 0.01, highQuality: false, mutate: false });
  island = { display, clip };
  return island;
}

/** Point on (or within ~`tol` degrees of) Vancouver Island. */
function onIsland(lon, lat, tol = 0) {
  const poly = island.clip;
  if (booleanPointInPolygon([lon, lat], poly)) return true;
  if (!tol) return false;
  for (const [dx, dy] of [[tol, 0], [-tol, 0], [0, tol], [0, -tol], [tol, tol], [-tol, -tol], [tol, -tol], [-tol, tol]]) {
    if (booleanPointInPolygon([lon + dx, lat + dy], poly)) return true;
  }
  return false;
}

function quantizeCoords(geom, d = 4) {
  const q = (c) => (typeof c[0] === 'number' ? [round(c[0], d), round(c[1], d)] : c.map(q));
  return { type: geom.type, coordinates: q(geom.coordinates) };
}

function centroid(geom) {
  const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
  let x = 0, y = 0;
  for (const [a, b] of ring) { x += a; y += b; }
  return [x / ring.length, y / ring.length];
}

const fracYear = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  const y = d.getUTCFullYear();
  return y + (d - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
};

// ---------------------------------------------------------------------------------------------
// sources

const SOURCES = {
  async island() {
    const { display } = await getIsland();
    await writeOut('island', { type: 'Feature', properties: {}, geometry: quantizeCoords(display.geometry) });
    await writeOut('municipalities', MUNICIPALITIES);
  },

  // BC Wildfire Service: historical + current fire perimeters and ignition points.
  async fires() {
    await getIsland();
    const causeCode = (c) => (/lightning/i.test(c) ? 0 : /person|human/i.test(c) ? 1 : 2);

    const polyProps = ['FIRE_NUMBER', 'FIRE_YEAR', 'FIRE_CAUSE', 'FIRE_SIZE_HECTARES', 'FIRE_DATE', 'SHAPE'];
    const hist = await wfsAll('WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP', { props: polyProps, pageSize: 2000, cacheKey: 'fire-polys' });
    let current = [];
    try {
      current = await wfsAll('WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP', { pageSize: 2000, cacheKey: 'fire-polys-current' });
    } catch (e) { log('  current perimeters unavailable:', e.message); }

    const seen = new Set();
    const perimeters = [];
    for (const f of [...current, ...hist]) {
      const p = f.properties;
      if (!f.geometry) continue;
      const year = p.FIRE_YEAR;
      const id = `${year}-${p.FIRE_NUMBER}`;
      if (seen.has(id)) continue;
      const [cx, cy] = centroid(f.geometry);
      if (!onIsland(cx, cy, 0.02)) continue;
      seen.add(id);
      const g = simplify(f, { tolerance: 0.0006, highQuality: false }).geometry;
      const t = (p.FIRE_DATE && fracYear(p.FIRE_DATE)) || year + 0.55;
      perimeters.push({
        id,
        year,
        t: round(t, 3),
        ha: round(p.FIRE_SIZE_HECTARES ?? p.FIRE_SIZE_HA ?? 0, 1),
        cause: causeCode(p.FIRE_CAUSE ?? ''),
        c: [round(cx), round(cy)],
        g: quantizeCoords(g),
      });
    }
    perimeters.sort((a, b) => a.t - b.t);

    const ptProps = ['FIRE_NUMBER', 'FIRE_YEAR', 'IGNITION_DATE', 'FIRE_CAUSE', 'CURRENT_SIZE', 'FIRE_TYPE', 'SHAPE'];
    const histPts = await wfsAll('WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_INCIDENTS_SP', { props: ptProps, cacheKey: 'fire-pts' });
    let curPts = [];
    try {
      curPts = await wfsAll('WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_PNTS_SP', { pageSize: 2000, cacheKey: 'fire-pts-current' });
    } catch (e) { log('  current incidents unavailable:', e.message); }

    const seenPts = new Set();
    const points = [];
    for (const f of [...curPts, ...histPts]) {
      const p = f.properties;
      if (!f.geometry || (p.FIRE_TYPE && !/fire/i.test(p.FIRE_TYPE))) continue;
      const [lon, lat] = f.geometry.coordinates;
      const year = p.FIRE_YEAR;
      const id = `${year}-${p.FIRE_NUMBER}`;
      if (seenPts.has(id) || !onIsland(lon, lat, 0.015)) continue;
      seenPts.add(id);
      const t = (p.IGNITION_DATE && fracYear(p.IGNITION_DATE)) || year + 0.55;
      // compact row: lon, lat, time (fractional year), hectares, cause
      points.push([round(lon), round(lat), round(t, 3), round(p.CURRENT_SIZE ?? 0, 2), causeCode(p.FIRE_CAUSE ?? '')]);
    }
    points.sort((a, b) => a[2] - b[2]);

    await writeOut('fires', {
      source: 'BC Wildfire Service via BC Data Catalogue (PROT_HISTORICAL_FIRE_POLYS_SP, PROT_HISTORICAL_INCIDENTS_SP, current-year layers)',
      perimeters,
      points,
    });
  },

  // USGS ComCat earthquakes M2.5+ since 1900.
  async quakes() {
    const q = new URLSearchParams({
      format: 'geojson',
      starttime: '1900-01-01',
      minmagnitude: '2.5',
      minlatitude: String(QUAKE_BBOX.south),
      maxlatitude: String(QUAKE_BBOX.north),
      minlongitude: String(QUAKE_BBOX.west),
      maxlongitude: String(QUAKE_BBOX.east),
      orderby: 'time-asc',
    });
    const fc = await fetchJSON(`https://earthquake.usgs.gov/fdsnws/event/1/query?${q}`);
    const rows = fc.features.map((f) => {
      const [lon, lat, depth] = f.geometry.coordinates;
      return [round(lon), round(lat), round(depth ?? 0, 1), round(f.properties.mag, 1), round(fracYear(f.properties.time), 4), f.properties.place ?? ''];
    });
    await writeOut('quakes', { source: 'USGS ComCat (earthquake.usgs.gov FDSN event service)', rows });
  },

  // ECCC HYDAT annual peak discharge for every hydrometric station on the island.
  async rivers() {
    await getIsland();
    const stations = (await ogcAll('hydrometric-stations', { bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}` }, 'hydro-stations'))
      .filter((f) => f.geometry && onIsland(...f.geometry.coordinates, 0.01));
    log(`  ${stations.length} hydrometric stations on island`);

    const out = [];
    await pool(stations, 6, async (s) => {
      const id = s.properties.STATION_NUMBER;
      const peaks = await ogcAll('hydrometric-annual-peaks', { STATION_NUMBER: id }, `peaks-${id}`);
      const byYear = {};
      for (const f of peaks) {
        const p = f.properties;
        if (!/discharge/i.test(p.DATA_TYPE_EN) || !/max/i.test(p.PEAK_CODE_EN) || p.PEAK == null) continue;
        const y = Number(String(p.DATE).slice(0, 4));
        if (!p.DATE || !Number.isFinite(y)) continue;
        byYear[y] = round(p.PEAK, 2);
      }
      const years = Object.keys(byYear).map(Number);
      if (years.length < 8) return;
      const sorted = Object.values(byYear).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      out.push({
        id,
        name: s.properties.STATION_NAME.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
        lon: round(s.geometry.coordinates[0]),
        lat: round(s.geometry.coordinates[1]),
        area: round(s.properties.DRAINAGE_AREA_GROSS, 1),
        median,
        peaks: byYear,
        peakDates: Object.fromEntries(
          peaks
            .filter((f) => /discharge/i.test(f.properties.DATA_TYPE_EN) && /max/i.test(f.properties.PEAK_CODE_EN) && f.properties.DATE)
            .map((f) => [String(f.properties.DATE).slice(0, 4), String(f.properties.DATE).slice(0, 10)]),
        ),
      });
    });
    out.sort((a, b) => a.id.localeCompare(b.id));
    log(`  ${out.length} stations with ≥8 years of peak flow`);
    await writeOut('rivers', { source: 'Environment and Climate Change Canada, HYDAT annual peaks (api.weather.gc.ca)', stations: out });
  },

  // ECCC Adjusted & Homogenized Canadian Climate Data — long, quality-controlled temperature records.
  async climate() {
    await getIsland();
    const stations = (await ogcAll('ahccd-stations', { bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}` }, 'ahccd-stations'))
      .filter((f) => f.properties.measurement_type__type_mesure === 'temp_mean' && onIsland(...f.geometry.coordinates, 0.06));
    log(`  ${stations.length} AHCCD temperature stations near island`);
    const out = [];
    await pool(stations, 6, async (s) => {
      const id = s.properties.station_id__id_station;
      const rows = await ogcAll('ahccd-annual', { station_id__id_station: id }, `ahccd-${id}`);
      const temp = {}, precip = {};
      for (const f of rows) {
        const p = f.properties;
        if (p.period_group__groupe_periode !== 'Annual') continue;
        if (p.temp_mean__temp_moyenne != null && p.temp_mean__temp_moyenne > -50) temp[p.year__annee] = p.temp_mean__temp_moyenne;
        if (p.total_precip__precip_totale != null && p.total_precip__precip_totale >= 0) precip[p.year__annee] = round(p.total_precip__precip_totale, 0);
      }
      const base = Object.entries(temp).filter(([y]) => y >= 1961 && y <= 1990).map(([, v]) => v);
      if (Object.keys(temp).length < 20 || base.length < 15) return;
      const baseline = base.reduce((a, b) => a + b, 0) / base.length;
      out.push({
        id,
        name: s.properties.station_name__nom_station.replace(/_+/g, ' ').trim().replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
        lon: round(s.geometry.coordinates[0]),
        lat: round(s.geometry.coordinates[1]),
        baseline: round(baseline, 2),
        temp,
        precip,
      });
    });
    out.sort((a, b) => b.lat - a.lat);
    await writeOut('climate', { source: 'ECCC Adjusted and Homogenized Canadian Climate Data (AHCCD) via api.weather.gc.ca', baselinePeriod: '1961–1990', stations: out });
  },

  // BC Stats municipal population estimates (1971→) and projections, by single year of age.
  async population() {
    const url = 'https://catalogue.data.gov.bc.ca/dataset/86839277-986a-4a29-9f70-fa9b1166f6cb/resource/0e15d04d-127c-457a-b999-20800c929927/download/municipality-population.csv';
    const csv = (await cached('bcstats-municipality-population.csv', () => fetchBuf(url))).toString('utf8');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const parse = (l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
    const header = parse(lines[0]);
    const iName = header.indexOf('Region.Name'), iYear = header.indexOf('Year'), iType = header.indexOf('Type'), iG = header.indexOf('Gender'), iT = header.indexOf('Total');
    const i65 = header.indexOf('65');
    const result = {};
    for (const line of lines.slice(1)) {
      const c = parse(line);
      if (c[iG] !== 'T') continue;
      const key = normalizeMuniName(c[iName]);
      if (!MUNI_BY_KEY.has(key)) continue;
      const total = Number(c[iT]);
      let seniors = 0;
      for (let i = i65; i < c.length; i++) seniors += Number(c[i]) || 0;
      const r = (result[key] ??= { pop: {}, s65: {}, firstProjection: null });
      r.pop[c[iYear]] = total;
      r.s65[c[iYear]] = round(seniors / total, 4);
      if (c[iType] === 'Projection' && (r.firstProjection == null || Number(c[iYear]) < r.firstProjection)) r.firstProjection = Number(c[iYear]);
    }
    const missing = MUNICIPALITIES.filter((m) => !result[m.key]).map((m) => m.name);
    if (missing.length) log('  population: no match for', missing.join(', '));
    await writeOut('population', { source: 'BC Stats sub-provincial population estimates & projections (BC Data Catalogue)', munis: result });
  },

  // BC Property Transfer Tax data: monthly fair-market-value statistics per municipality, 2016→.
  async housing() {
    const pkg = await fetchJSON('https://catalogue.data.gov.bc.ca/api/3/action/package_search?q=title:%22Property%20Transfer%20Tax%20Data%22&rows=50');
    const resources = [];
    for (const p of pkg.result.results) {
      const year = Number((p.title.match(/(20\d\d)/) || [])[1]);
      const r = p.resources.find((x) => /munic/i.test(x.name) && /month/i.test(x.name) && /xlsx?$/i.test(x.url));
      // 2016 is published for aggregated sub-regions, not individual municipalities.
      if (year >= 2017 && r) resources.push({ year, url: r.url });
    }
    resources.sort((a, b) => a.year - b.year);
    log(`  property transfer workbooks: ${resources.map((r) => r.year).join(', ')}`);

    const WANT = {
      'TOTAL MARKET TRANSACTIONS (COUNT)': 'n',
      'RESIDENTIAL TOTAL (COUNT)': 'res',
      'FMV SUM ($ SUM)': 'sum',
      'FMV MEDIAN ($ MEDIAN)': 'median',
    };
    // acc[key][month][field] -> summed across school-district splits
    const acc = {};
    for (const { year, url } of resources) {
      const buf = await cached(`ptt/municipal-monthly-${year}.xlsx`, () => fetchBuf(url));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      let header = null, cMuni = -1, cStat = -1;
      ws.eachRow((row) => {
        const v = row.values;
        if (!header) {
          const idx = v.findIndex((x) => /^municipality$/i.test(String(x ?? '').trim()));
          if (idx > 0) { header = v; cMuni = idx; cStat = v.findIndex((x) => /^statistics?$/i.test(String(x ?? '').trim())); }
          return;
        }
        // Workbook years differ in letter case and spacing of the statistic labels.
        const field = WANT[String(v[cStat] ?? '').toUpperCase().replace(/\s+/g, ' ').trim()];
        if (!field) return;
        const key = normalizeMuniName(v[cMuni]);
        if (!MUNI_BY_KEY.has(key)) return;
        for (let c = cStat + 1; c < header.length; c++) {
          const m = String(header[c] ?? '').match(/(20\d\d)[-/ ]?(\d\d)/);
          const val = Number(typeof v[c] === 'object' && v[c] ? v[c].result : v[c]);
          if (!m || v[c] == null || v[c] === '' || !Number.isFinite(val)) continue;
          const month = `${m[1]}-${m[2]}`;
          const slot = ((acc[key] ??= {})[month] ??= { n: 0, res: 0, sum: 0, medW: 0, medN: 0 });
          if (field === 'median') { slot.medW += val * 1; slot.medN += 1; }
          else slot[field] += val;
        }
      });
    }
    const munis = {};
    for (const [key, months] of Object.entries(acc)) {
      const series = {};
      for (const [month, s] of Object.entries(months).sort()) {
        if (!s.n) continue;
        // School-district splits (e.g. Saanich SD61/SD63) are combined: mean of their medians.
        series[month] = [Math.round(s.medN ? s.medW / s.medN : s.sum / s.n), Math.round(s.sum / s.n), s.n];
      }
      munis[key] = series;
    }
    const missing = MUNICIPALITIES.filter((m) => !munis[m.key]).map((m) => m.name);
    if (missing.length) log('  housing: no match for', missing.join(', '));
    await writeOut('housing', {
      source: 'BC Ministry of Finance, Property Transfer Tax Data (BC Data Catalogue) — monthly fair-market value of all property transfers',
      fields: ['median FMV', 'mean FMV', 'transactions'],
      munis,
    });
  },

  // Statistics Canada Table 35-10-0063-01: Crime Severity Index by police service in BC.
  async crime() {
    const meta = await fetchJSON('https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/35100063/en');
    const zip = await cached('statcan-35100063.zip', async () => {
      const b = await fetchBuf(meta.object, { timeout: 600_000 });
      if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error('Statistics Canada returned a non-zip response (site may be down for maintenance)');
      return b;
    });
    const files = unzipSync(new Uint8Array(zip));
    const csvName = Object.keys(files).find((n) => /^\d+\.csv$/.test(n));
    const lines = strFromU8(files[csvName]).split(/\r?\n/).filter(Boolean);
    const parse = (l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
    const header = parse(lines[0]).map((h) => h.replace(/^﻿/, ''));
    const iDate = header.indexOf('REF_DATE'), iGeo = header.indexOf('GEO'), iStat = header.indexOf('Statistics'), iVal = header.indexOf('VALUE');
    const STATS = { 'Crime severity index': 'csi', 'Violent crime severity index': 'vcsi', 'Non-violent crime severity index': 'nvcsi' };
    const byGeo = {}; // geo -> { key, stats }
    let bc = {};
    for (const line of lines.slice(1)) {
      const c = parse(line);
      const stat = STATS[c[iStat]];
      if (!stat || c[iVal] === '') continue;
      const geo = c[iGeo];
      const year = c[iDate].slice(0, 4);
      if (/^British Columbia/.test(geo)) { ((bc[stat] ??= {})[year] = Number(c[iVal])); continue; }
      // e.g. "Nanaimo, British Columbia, Royal Canadian Mounted Police, municipal [59904]"
      const parts = geo.replace(/\s*\[.*\]$/, '').split(/,\s*/);
      if (parts.at(-1) !== 'municipal') continue;
      const key = normalizeMuniName(parts[0]);
      if (!MUNI_BY_KEY.has(key)) continue;
      const g = (byGeo[geo] ??= { key, stats: {} });
      (g.stats[stat] ??= {})[year] = Number(c[iVal]);
    }
    // Some towns switched police services (e.g. municipal force -> RCMP) and so have two series;
    // splice them, letting the most recently reported series win where years overlap.
    const munis = {};
    const lastYear = (g) => Math.max(...Object.keys(g.stats.csi ?? { 0: 0 }).map(Number));
    const geos = Object.entries(byGeo).sort((a, b) => lastYear(a[1]) - lastYear(b[1]));
    for (const [, g] of geos) for (const [stat, ys] of Object.entries(g.stats)) Object.assign(((munis[g.key] ??= {})[stat] ??= {}), ys);
    const geosSeen = geos.map(([geo, g]) => `${geo} -> ${g.key}`);
    log('  crime series:', [...geosSeen].join(' | '));
    const missing = MUNICIPALITIES.filter((m) => !munis[m.key]).map((m) => m.name);
    if (missing.length) log('  crime: no municipal police series for', missing.join(', '));
    await writeOut('crime', {
      source: 'Statistics Canada, Table 35-10-0063-01 (Crime severity index, police services in British Columbia)',
      bc,
      munis,
    });
  },
};

// ---------------------------------------------------------------------------------------------

const wanted = process.argv.slice(2);
const order = ['island', 'fires', 'quakes', 'rivers', 'climate', 'population', 'housing', 'crime'];
const run = wanted.length ? order.filter((n) => wanted.includes(n)) : order;

let manifest = {};
try { manifest = JSON.parse(await fs.readFile(path.join(OUT, 'manifest.json'), 'utf8')); } catch { /* first run */ }

let failures = 0;
for (const name of run) {
  const t0 = Date.now();
  console.log(`\n▶ ${name}`);
  try {
    await SOURCES[name]();
    manifest[name] = { ok: true, updated: new Date().toISOString() };
    log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    failures++;
    manifest[name] = { ...(manifest[name] ?? {}), ok: manifest[name]?.ok ?? false, lastError: e.message, lastAttempt: new Date().toISOString() };
    console.error(`✖ ${name} failed: ${e.message}`);
  }
}
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(failures ? `\nFinished with ${failures} failed source(s).` : '\nAll sources fetched.');
