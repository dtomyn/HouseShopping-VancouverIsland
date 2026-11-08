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
import { MUNICIPALITIES, ISLAND_COMMUNITIES, PLACES, MUNI_BY_KEY, PTT_CODES, ISLAND_BY_RCMP, normalizeMuniName } from './municipalities.mjs';

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

/** Great-circle distance in km. */
function distKm(aLon, aLat, bLon, bLat) {
  const r = Math.PI / 180;
  const s = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

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
// island outline (used for clipping and for the glowing coastline in the app): Vancouver Island
// plus the shortlisted Gulf and Discovery islands, as one MultiPolygon

let island;
async function getIsland() {
  if (island) return island;
  const names = ['Vancouver Island', ...ISLAND_COMMUNITIES.map((c) => c.fwa)];
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: 'pub:WHSE_BASEMAPPING.FWA_ISLANDS_POLY',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    CQL_FILTER: `GNIS_NAME_1 IN (${names.map((n) => `'${n}'`).join(',')})`,
  });
  const fc = await cachedJSON(`wfs/islands-${names.length}.json`, `${WFS}?${q}`);
  const missing = names.filter((n) => !fc.features.some((f) => f.properties.GNIS_NAME_1 === n));
  if (missing.length) throw new Error(`island outline missing: ${missing.join(', ')}`);
  // Display outline: light simplification keeps inlets readable but small. Clipping outline:
  // coarser, fast for point-in-polygon tests. Small islands get a finer tolerance so they keep
  // their shape.
  const merge = (opts) => {
    const polys = fc.features.flatMap((f) => {
      const big = f.properties.GNIS_NAME_1 === 'Vancouver Island';
      const g = simplify(f, { ...opts(big), mutate: false }).geometry;
      return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    });
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } };
  };
  const display = merge((big) => ({ tolerance: big ? 0.004 : 0.0015, highQuality: true }));
  const clip = merge((big) => ({ tolerance: big ? 0.01 : 0.003, highQuality: false }));
  // one feature per island, for assigning census areas to the island they lie on
  const parts = new Map(fc.features.map((f) => [f.properties.GNIS_NAME_1, f]));
  island = { display, clip, parts };
  for (const c of ISLAND_COMMUNITIES)
    if (!booleanPointInPolygon([c.lon, c.lat], parts.get(c.fwa))) log(`  warning: ${c.name} centre is not on ${c.fwa}`);
  return island;
}

/** Point on (or within ~`tol` degrees of) Vancouver Island or one of the shortlisted islands. */
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
// census counts for the island communities

/**
 * BC Stats only estimates municipalities, so island communities use the 2021 Census: every
 * dissemination area (DA) with at least 30% of its land on the island, summed. (Some DAs also take
 * in small, thinly settled neighbours, e.g. Thetis with Valdes, Gabriola with Mudge.) DA counts
 * for 2016 aren't published, so these rows are a single 2021 snapshot in BC Stats' shape.
 */
const CENSUS_PROFILE = 'https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data/STC_CP';

/** 2021 Census Profile values, summed per characteristic over the given areas (DF_DA or DF_CSD). */
async function censusProfile(flow, dguids, chars, cacheName) {
  const csv = (await cached(`census/${cacheName}.csv`, async () => {
    const res = await fetch(`${CENSUS_PROFILE},${flow}/A5.${dguids.join('+')}.1.${chars.join('+')}.1`, { headers: { Accept: 'application/vnd.sdmx.data+csv;version=1.0.0', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from the census profile API`);
    return Buffer.from(await res.text());
  })).toString('utf8').split(/\r?\n/).filter(Boolean);
  const h = csv[0].split(',');
  const iA = h.indexOf('REF_AREA'), iC = h.indexOf('CHARACTERISTIC'), iV = h.indexOf('OBS_VALUE');
  // area -> characteristic -> value (null where suppressed)
  const out = {};
  for (const line of csv.slice(1)) {
    const r = line.split(',');
    (out[r[iA]] ??= {})[r[iC]] = r[iV] === '' ? null : Number(r[iV]);
  }
  return out;
}

/** The 2021 dissemination areas that lie mostly on each shortlisted island, by island key. */
let islandDAsMemo = null;
async function islandDAs() {
  if (islandDAsMemo) return islandDAsMemo;
  const { parts } = await getIsland();
  const DA = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/12/query';
  const out = {};
  for (const c of ISLAND_COMMUNITIES) {
    const isl = parts.get(c.fwa);
    const ring = (isl.geometry.type === 'Polygon' ? [isl.geometry.coordinates] : isl.geometry.coordinates).flat(2);
    const env = { xmin: Math.min(...ring.map((p) => p[0])), ymin: Math.min(...ring.map((p) => p[1])), xmax: Math.max(...ring.map((p) => p[0])), ymax: Math.max(...ring.map((p) => p[1])), spatialReference: { wkid: 4326 } };
    const q = new URLSearchParams({ geometry: JSON.stringify(env), geometryType: 'esriGeometryEnvelope', spatialRel: 'esriSpatialRelIntersects', outFields: 'DAUID,DGUID,LANDAREA', returnGeometry: 'true', outSR: '4326', geometryPrecision: '5', f: 'geojson' });
    const fc = await cachedJSON(`census/da-${c.key.replace(/ /g, '_')}.json`, `${DA}?${q}`);
    // DA polygons run out over the water, so compare the DA's land on this island (sampled on a
    // grid) with its official land area.
    out[c.key] = fc.features.filter((f) => {
      const pts = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flat(2);
      const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
      const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
      const step = Math.max((x1 - x0) / 60, (y1 - y0) / 60, 0.0003);
      const cellKm2 = step * 111.32 * Math.cos(((y0 + y1) / 2) * (Math.PI / 180)) * step * 111.32;
      let on = 0;
      for (let x = x0 + step / 2; x < x1; x += step)
        for (let y = y0 + step / 2; y < y1; y += step)
          if (booleanPointInPolygon([x, y], f) && booleanPointInPolygon([x, y], isl)) on++;
      return on * cellKm2 >= 0.3 * f.properties.LANDAREA;
    }).map((f) => f.properties.DGUID);
  }
  return (islandDAsMemo = out);
}

async function islandCensus() {
  const das = await islandDAs();
  const out = {};
  for (const c of ISLAND_COMMUNITIES) {
    const ids = das[c.key];
    if (!ids.length) { log(`  population: no census areas found on ${c.fwa}`); continue; }
    // characteristics: 1 = population 2021, 24 = aged 65 and over
    const vals = Object.values(await censusProfile('DF_DA', ids, [1, 24], `profile-${c.key.replace(/ /g, '_')}`));
    const sum = (k) => vals.reduce((a, v) => a + (v[k] ?? 0), 0);
    const pop = sum(1), s65 = sum(24);
    if (!pop) { log(`  population: census returned no count for ${c.name}`); continue; }
    out[c.key] = { pop: { 2021: pop }, s65: { 2021: round(s65 / pop, 4) }, firstProjection: null, census: true };
    log(`  ${c.name}: ${ids.length} census areas, ${pop} people in 2021, ${Math.round((s65 / pop) * 100)}% 65+`);
  }
  return out;
}

/** Median of a series' monthly medians over [from, to] ("YYYY-MM"), months with sales only. */
function medianOver(series, from, to) {
  const v = Object.entries(series).filter(([m, x]) => m >= from && m <= to && x[2] > 0 && x[0] > 0).map(([, x]) => x[0]).sort((a, b) => a - b);
  return v.length >= 6 ? v[Math.floor(v.length / 2)] : null;
}

/**
 * Island sales are only published inside wider rural jurisdictions that are mostly Vancouver
 * Island acreage, so each island gets its own price level from the 2021 Census: owners' own
 * estimate of their home's value, averaged over the island's dissemination areas. Owners' values
 * and transfer-tax medians differ in kind, so the census average is scaled by the typical ratio
 * between the two across the municipalities (both measured around census day, May 2021). The
 * rural jurisdiction's sales then carry that level forward month by month, so the island's trend
 * is the rural area's trend. Replaces munis[key] in place; returns how each estimate was built.
 */
async function islandPrices(munis) {
  const AROUND = ['2020-11', '2021-11']; // 12 months around census day
  const OWNERS = 1468, AVG_VALUE = 1475;

  // ratio of transfer-tax median to census average value, per municipality
  const csdQ = new URLSearchParams({ where: "PRUID='59'", outFields: 'CSDUID,CSDNAME,CSDTYPE,DGUID', returnGeometry: 'false', f: 'json', resultRecordCount: '2000' });
  const csds = (await cachedJSON('census/csd-bc.json', `https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/9/query?${csdQ}`)).features.map((f) => f.attributes);
  const csdOf = new Map();
  for (const c of csds) {
    // municipalities only, not electoral areas or reserves
    if (/^(RDA|IRI|IGD|TAL)$/.test(c.CSDTYPE)) continue;
    const k = normalizeMuniName(c.CSDNAME);
    if (MUNI_BY_KEY.has(k)) csdOf.set(k, c.DGUID);
  }
  const csdVals = await censusProfile('DF_CSD', [...csdOf.values()], [AVG_VALUE], 'value-municipalities');
  const ratios = [];
  for (const [k, dguid] of csdOf) {
    const census = csdVals[dguid]?.[AVG_VALUE];
    const ptt = munis[k] && medianOver(munis[k], ...AROUND);
    if (census && ptt) ratios.push(ptt / census);
  }
  ratios.sort((a, b) => a - b);
  const calib = ratios[Math.floor(ratios.length / 2)];
  log(`  sale median ÷ census value across ${ratios.length} municipalities: median ${calib.toFixed(2)} (range ${ratios[0].toFixed(2)}–${ratios.at(-1).toFixed(2)})`);

  const das = await islandDAs();
  const out = {};
  for (const c of ISLAND_COMMUNITIES.filter((c) => c.ptt)) {
    const rural = munis[c.key];
    const vals = Object.values(await censusProfile('DF_DA', das[c.key], [OWNERS, AVG_VALUE], `value-${c.key.replace(/ /g, '_')}`));
    // owner-weighted average over the areas that report a value
    let owners = 0, total = 0;
    for (const v of vals) if (v[OWNERS] && v[AVG_VALUE]) { owners += v[OWNERS]; total += v[OWNERS] * v[AVG_VALUE]; }
    const base = rural && medianOver(rural, ...AROUND);
    if (!owners || !base) { delete munis[c.key]; log(`  ${c.name}: no census home values or rural sales, left blank`); continue; }
    const census = total / owners;
    const k = (census * calib) / base;
    munis[c.key] = Object.fromEntries(Object.entries(rural).map(([m, [med, mean, n]]) => [m, [Math.round(med * k), Math.round(mean * k), n]]));
    out[c.key] = { area: c.pttName, census: Math.round(census), owners, calib: round(calib, 3), factor: round(k, 3) };
    log(`  ${c.name}: census average $${Math.round(census / 1000)}K over ${owners} owners → ${round(k, 2)}× ${c.pttName} sales`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// sources

const SOURCES = {
  async island() {
    const { display } = await getIsland();
    await writeOut('island', { type: 'Feature', properties: {}, geometry: quantizeCoords(display.geometry) });
    await writeOut('municipalities', PLACES);
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

  // ECCC Canadian Climate Normals — 30-year averages of everyday weather per station. The OGC API
  // publishes the 1981–2010 normals (1991–2020 are not in it yet); we take whatever period it serves.
  async normals() {
    await getIsland();
    const bbox = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
    // NORMAL_ID -> output field. MONTH 13 is the annual value.
    const ANNUAL = { 102: 'sun', 69: 'wetDays', 41: 'frostDays', 54: 'snow', 56: 'precip', 1: 'tMean' };
    const annual = await ogcAll('climate-normals', { bbox, MONTH: '13' }, 'normals-annual');
    // monthly mean temperature (January / July) and monthly precipitation (wettest month)
    const monthlyT = await ogcAll('climate-normals', { bbox, NORMAL_ID: '1' }, 'normals-temp-monthly');
    const monthlyP = await ogcAll('climate-normals', { bbox, NORMAL_ID: '56' }, 'normals-precip-monthly');

    const title = (s) => s.toLowerCase().split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ').replace(/\bCda\b/, 'CDA');
    const byStn = new Map();
    const stn = (f) => {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      if (!byStn.has(p.CLIMATE_IDENTIFIER))
        byStn.set(p.CLIMATE_IDENTIFIER, { id: p.CLIMATE_IDENTIFIER, name: title(p.STATION_NAME), lon: round(lon), lat: round(lat), yrs: 99, period: `${p.PERIOD_BEGIN}–${p.PERIOD_END}`, wet: null });
      return byStn.get(p.CLIMATE_IDENTIFIER);
    };
    // ECCC codes each normal by completeness (A = 30 yrs … D = 15 yrs, E/F fewer). Keep values with
    // at least 10 years behind them and record the weakest count so the app can flag thin records.
    const usable = (p) => p.VALUE != null && (p.YEAR_COUNT_NORMAL_PERIOD ?? 0) >= 10;
    for (const f of annual) {
      const p = f.properties;
      const field = ANNUAL[p.NORMAL_ID];
      if (!field || !usable(p) || !f.geometry) continue;
      const s = stn(f);
      s[field] = round(p.VALUE, 1);
      s.yrs = Math.min(s.yrs, p.YEAR_COUNT_NORMAL_PERIOD);
    }
    for (const f of monthlyT) {
      const p = f.properties;
      if (!usable(p) || !f.geometry || (p.MONTH !== 1 && p.MONTH !== 7)) continue;
      stn(f)[p.MONTH === 1 ? 'tJan' : 'tJul'] = round(p.VALUE, 1);
    }
    for (const f of monthlyP) {
      const p = f.properties;
      if (!usable(p) || !f.geometry || p.MONTH > 12) continue;
      const s = stn(f);
      if (!s.wet || p.VALUE > s.wet[1]) s.wet = [p.MONTH, round(p.VALUE, 0)];
    }

    // Island and nearby Gulf Islands only (not the Sunshine Coast or Lower Mainland).
    const stations = [...byStn.values()]
      .filter((s) => onIsland(s.lon, s.lat, 0.1))
      .filter((s) => ['sun', 'wetDays', 'frostDays', 'snow'].some((k) => s[k] != null))
      .sort((a, b) => b.lat - a.lat);
    for (const s of stations) if (!s.wet) delete s.wet;
    const periods = [...new Set(stations.map((s) => s.period))];
    log(`  ${stations.length} normals stations near island (${stations.filter((s) => s.sun != null).length} with sunshine), period ${periods.join(', ')}`);
    await writeOut('normals', {
      source: 'Environment and Climate Change Canada, Canadian Climate Normals (api.weather.gc.ca climate-normals collection)',
      period: periods.length === 1 ? periods[0] : periods.join(', '),
      stations: stations.map(({ period, ...s }) => s),
    });
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
    Object.assign(result, await islandCensus());
    await writeOut('population', {
      source: 'BC Stats sub-provincial population estimates & projections (BC Data Catalogue); island communities: Statistics Canada 2021 Census of Population, dissemination areas',
      munis: result,
    });
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
        // Municipalities by name; the islands' rural jurisdictions by code ("768 - Nanaimo Rural" -> "#768").
        const key = normalizeMuniName(v[cMuni]);
        const code = String(v[cMuni] ?? '').match(/^\s*(\d+)\s*-/)?.[1];
        const keys = MUNI_BY_KEY.has(key) ? [key] : PTT_CODES.has(code) ? [`#${code}`] : [];
        if (!keys.length) return;
        for (let c = cStat + 1; c < header.length; c++) {
          const m = String(header[c] ?? '').match(/(20\d\d)[-/ ]?(\d\d)/);
          const val = Number(typeof v[c] === 'object' && v[c] ? v[c].result : v[c]);
          if (!m || v[c] == null || v[c] === '' || !Number.isFinite(val)) continue;
          const month = `${m[1]}-${m[2]}`;
          for (const k of keys) {
            const slot = ((acc[k] ??= {})[month] ??= { n: 0, res: 0, sum: 0, medW: 0, medN: 0 });
            if (field === 'median') { slot.medW += val * 1; slot.medN += 1; }
            else slot[field] += val;
          }
        }
      });
    }
    // An island's jurisdictions are pooled like school-district splits.
    for (const c of ISLAND_COMMUNITIES.filter((c) => c.ptt)) {
      const pooled = (acc[c.key] = {});
      for (const code of c.ptt) {
        for (const [month, x] of Object.entries(acc[`#${code}`] ?? {})) {
          const slot = (pooled[month] ??= { n: 0, res: 0, sum: 0, medW: 0, medN: 0 });
          for (const k in slot) slot[k] += x[k];
        }
      }
    }
    for (const k of Object.keys(acc)) if (k.startsWith('#')) delete acc[k];
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
    const islands = await islandPrices(munis);
    const missing = PLACES.filter((m) => !munis[m.key]).map((m) => m.name);
    if (missing.length) log('  housing: no match for', missing.join(', '));
    await writeOut('housing', {
      source: 'BC Ministry of Finance, Property Transfer Tax Data (BC Data Catalogue) — monthly fair-market value of all property transfers; island estimates also use the Statistics Canada 2021 Census of Population (value of owned dwellings)',
      fields: ['median FMV', 'mean FMV', 'transactions'],
      munis,
      islands,
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
      // A service lists the years before it existed (or stopped reporting) as 0; no real police service has an
      // index of 0, and taking those zeros as values would also overwrite a town's earlier series in the splice below.
      if (!stat || c[iVal] === '' || Number(c[iVal]) === 0) continue;
      const geo = c[iGeo];
      const year = c[iDate].slice(0, 4);
      if (/^British Columbia/.test(geo)) { ((bc[stat] ??= {})[year] = Number(c[iVal])); continue; }
      // e.g. "Nanaimo, British Columbia, Royal Canadian Mounted Police, municipal [59904]"
      // Island communities use their rural RCMP detachment (e.g. "Gabriola Island, …, rural").
      const parts = geo.replace(/\s*\[.*\]$/, '').split(/,\s*/);
      const name = normalizeMuniName(parts[0]);
      const key = parts.at(-1) === 'municipal' && MUNI_BY_KEY.has(name) ? name : parts.at(-1) === 'rural' ? ISLAND_BY_RCMP.get(name)?.key : null;
      if (!key) continue;
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
    const missing = PLACES.filter((m) => !munis[m.key]).map((m) => m.name);
    if (missing.length) log('  crime: no own police series for', missing.join(', '));
    await writeOut('crime', {
      source: 'Statistics Canada, Table 35-10-0063-01 (Crime severity index, police services in British Columbia)',
      bc,
      munis,
    });
  },

  // HealthLinkBC directory (BC Ministry of Health): "Hospitals in BC" + "Emergency Rooms in BC", then
  // drive times from each municipality to its nearest few facilities via the public OSRM demo server.
  async hospitals() {
    const DS = 'https://catalogue.data.gov.bc.ca/dataset';
    const HOSP = `${DS}/383eaf98-afd7-436a-9556-67ecf14f64a7/resource/5ff82cf4-0448-4063-804a-7321f0f2b4c6/download/hlbc_hospitals.csv`;
    const ER = `${DS}/88e982b2-0799-4e17-b000-9961ea05b0f0/resource/4b834874-089f-4512-b001-8534e597a1b6/download/hlbc_emergencyrooms.csv`;
    const parse = (l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
    const rows = async (name, url) => {
      const lines = (await cached(`hospitals/${name}`, () => fetchBuf(url))).toString('utf8').split(/\r?\n/).filter(Boolean);
      const h = parse(lines[0]);
      // Island Health runs every hospital and ER on Vancouver Island and the Gulf Islands
      return lines.slice(1).map((l) => Object.fromEntries(parse(l).map((v, i) => [h[i], v]))).filter((r) => r.RG_NAME === 'Island Health');
    };
    const hosp = await rows('hlbc_hospitals.csv', HOSP);
    const ers = await rows('hlbc_emergencyrooms.csv', ER);

    // The ER list carries opening hours but no facility names; join it to hospitals by location.
    // ER-only sites (small health centres) are named after their community.
    const edOf = (hours) => (!/24 hours/i.test(hours) ? 'limited' : /call ahead/i.test(hours) ? 'call' : '24/7');
    const facilities = hosp.map((r) => ({ name: r.SV_NAME, city: r.CITY, lon: round(+r.LONGITUDE), lat: round(+r.LATITUDE), hospital: true, ed: null, hours: null }));
    for (const r of ers) {
      const lon = +r.LONGITUDE, lat = +r.LATITUDE;
      let f = facilities.find((x) => distKm(lon, lat, x.lon, x.lat) < 0.3);
      if (!f) facilities.push((f = { name: `${r.CITY} emergency services`, city: r.CITY, lon: round(lon), lat: round(lat), hospital: false, ed: null, hours: null }));
      f.ed = edOf(r.HOURS);
      f.hours = r.HOURS;
    }
    facilities.sort((a, b) => b.lat - a.lat);
    log(`  ${facilities.length} Island Health facilities (${facilities.filter((f) => f.ed === '24/7').length} with a 24/7 ER listed)`);

    // Drive times. One OSRM `table` call ranks every facility for every town; then one `route` call
    // per kept pair gives the road line and tells us whether the fastest route uses a ferry.
    const OSRM = 'https://router.project-osrm.org';
    const gentle = async (name, url) => JSON.parse((await cached(`osrm/${name}.json`, async () => {
      await new Promise((r) => setTimeout(r, 1100));
      return fetchBuf(url, { timeout: 60_000 });
    })).toString('utf8'));
    const coords = [...PLACES, ...facilities].map((p) => `${p.lon},${p.lat}`).join(';');
    const src = PLACES.map((_, i) => i).join(';');
    const dst = facilities.map((_, i) => i + PLACES.length).join(';');
    let table = null;
    try {
      table = await gentle(`table-${PLACES.length}x${facilities.length}`, `${OSRM}/table/v1/driving/${coords}?sources=${src}&destinations=${dst}&annotations=duration,distance`);
      if (table.code !== 'Ok') throw new Error(table.message ?? table.code);
    } catch (e) {
      log('  OSRM routing unavailable, falling back to straight-line distance:', e.message);
      table = null;
    }

    const towns = {};
    for (const [i, m] of PLACES.entries()) {
      // OSRM returns null where there is no route (e.g. Lasqueti, which has no car ferry).
      const cand = facilities.map((f, j) => ({
        f: j,
        min: table ? (table.durations[i][j] == null ? null : table.durations[i][j] / 60) : null,
        km: table ? (table.distances[i][j] == null ? null : table.distances[i][j] / 1000) : distKm(m.lon, m.lat, f.lon, f.lat),
      })).filter((c) => c.km != null && (c.min != null || !table));
      cand.sort((a, b) => (table ? a.min - b.min : a.km - b.km));
      // nearest three, plus the nearest round-the-clock ER if it isn't among them
      const keep = cand.slice(0, 3);
      const ed = cand.find((c) => facilities[c.f].ed === '24/7');
      if (ed && !keep.includes(ed)) keep.push(ed);
      towns[m.key] = [];
      for (const c of keep) {
        const f = facilities[c.f];
        const out = { f: c.f, min: c.min == null ? null : Math.round(c.min), km: round(c.km, 1) };
        if (table) {
          try {
            const r = await gentle(`route-${m.key.replace(/ /g, '_')}-${f.lon},${f.lat}`, `${OSRM}/route/v1/driving/${m.lon},${m.lat};${f.lon},${f.lat}?overview=simplified&geometries=geojson&steps=true`);
            const rt = r.routes?.[0];
            if (rt) {
              out.min = Math.round(rt.duration / 60);
              out.km = round(rt.distance / 1000, 1);
              if (rt.legs.some((lg) => lg.steps.some((s) => s.mode === 'ferry'))) out.ferry = true;
              const line = [];
              for (const [x, y] of rt.geometry.coordinates) {
                const p = [round(x, 3), round(y, 3)];
                if (!line.length || p[0] !== line.at(-1)[0] || p[1] !== line.at(-1)[1]) line.push(p);
              }
              out.line = line;
            }
          } catch (e) { log(`  route ${m.name} -> ${f.name} failed: ${e.message}`); }
        }
        towns[m.key].push(out);
      }
      towns[m.key].sort((a, b) => (a.min ?? a.km) - (b.min ?? b.km));
    }
    const far = Object.entries(towns).map(([k, v]) => [k, v.find((c) => facilities[c.f].ed === '24/7' && !c.ferry)?.min]).sort((a, b) => (b[1] ?? 999) - (a[1] ?? 999));
    log('  farthest from a 24/7 ER by road:', far.slice(0, 4).map(([k, v]) => `${k} ${v ?? '?'} min`).join(', '));

    await writeOut('hospitals', {
      source: 'BC Ministry of Health / HealthLinkBC, “Hospitals in BC” and “Emergency Rooms in BC” (BC Data Catalogue, Open Government Licence – BC)',
      routing: table ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
      routingSource: table ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
      facilities,
      towns,
    });
  },

  // NRCan 2020 National Seismic Hazard Model (6th generation, the NBC 2020 values) via Earthquakes
  // Canada's public GraphQL web service, the documented API behind its Seismic Hazard Tool. It only
  // answers per point, so we sample a ~7 km grid over the island (plus a coastal fringe so the
  // surface can be interpolated to the shoreline) and each town centre, in gentle batches.
  async seismic() {
    await getIsland();
    const API = 'https://www.earthquakescanada.nrcan.gc.ca/api/canshm/graphql';
    // site class C (firm ground / soft rock, the code's reference site), 2% and 10% in 50 years
    const FIELDS = 'XC: siteDesignationsXs(siteClass: C, poe50: [2.0, 10.0]){ poe50 pga sa0p2 }';
    const query = async (name, pts) => {
      const q = `query{ ${pts.map((p, i) => `p${i}: NBC2020(latitude: ${p.lat}, longitude: ${p.lon}){ ${FIELDS} }`).join(' ')} }`;
      const buf = await cached(`seismic/${name}.json`, async () => {
        await new Promise((r) => setTimeout(r, 1000));
        for (let attempt = 1; ; attempt++) {
          try {
            const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(120_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status} from the seismic hazard service`);
            const j = await res.json();
            if (j.errors?.length) throw new Error(j.errors[0].message);
            return Buffer.from(JSON.stringify(j));
          } catch (e) {
            if (attempt >= 3) throw e;
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        }
      });
      const j = JSON.parse(buf.toString('utf8'));
      return pts.map((_, i) => {
        const rows = j.data[`p${i}`]?.XC ?? [];
        const at = (poe) => rows.find((r) => r.poe50 === poe);
        return { pga2: at(2)?.pga ?? null, pga10: at(10)?.pga ?? null, sa2: at(2)?.sa0p2 ?? null };
      });
    };

    // regular grid; nodes far from the island are left null
    const g = { west: -128.6, south: 48.2, dx: 0.1, dy: 0.065, nx: 57, ny: 44 };
    const nodes = [];
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const lon = round(g.west + i * g.dx, 3), lat = round(g.south + j * g.dy, 3);
        if (onIsland(lon, lat, 0.14)) nodes.push({ idx: j * g.nx + i, lon, lat });
      }
    log(`  ${nodes.length} grid points over the island`);
    const BATCH = 50;
    const pga = new Array(g.nx * g.ny).fill(null);
    for (let b = 0; b < nodes.length; b += BATCH) {
      const pts = nodes.slice(b, b + BATCH);
      const vals = await query(`grid-${g.dx}x${g.dy}-n${nodes.length}-${b}`, pts);
      vals.forEach((v, k) => (pga[pts[k].idx] = v.pga2 == null ? null : round(v.pga2, 3)));
    }

    const towns = {};
    const tv = await query(`towns-${PLACES.length}`, PLACES);
    PLACES.forEach((m, k) => { if (tv[k].pga2 != null) towns[m.key] = [tv[k].pga2, tv[k].pga10, tv[k].sa2]; });
    const sorted = Object.entries(towns).sort((a, b) => b[1][0] - a[1][0]);
    log(`  PGA 2%/50yr: highest ${sorted[0]?.[0]} ${sorted[0]?.[1][0]} g, lowest ${sorted.at(-1)?.[0]} ${sorted.at(-1)?.[1][0]} g`);

    await writeOut('seismic', {
      source: 'Natural Resources Canada, 2020 National Seismic Hazard Model (CanadaSHM6, NBC 2020 values) via the Earthquakes Canada seismic hazard web service (earthquakescanada.nrcan.gc.ca/api/canshm/graphql), Open Government Licence – Canada',
      model: 'NBC 2020',
      site: 'C',
      grid: { ...g, pga },
      // town key -> [PGA 2%/50yr, PGA 10%/50yr, Sa(0.2) 2%/50yr], all in g
      towns,
    });
  },

  // Wildfire smoke days: BC ENV verified hourly PM2.5, one ~100 MB all-BC CSV per year on the
  // ministry's FTP server. Node has no FTP client, so each file is streamed through curl (shipped
  // with Windows, macOS and Linux) and only Vancouver Island rows are kept. The per-year cache
  // holds station-day sums, a few hundred KB, so the big CSVs are never written to disk.
  async smoke() {
    await getIsland();
    const { spawn } = await import('node:child_process');
    const readline = await import('node:readline');
    const FTP = 'ftp://ftp.env.gov.bc.ca/pub/outgoing/AIR/AnnualSummary';
    const curl = (url) => spawn('curl', ['-s', '-S', '--fail', '--retry', '3', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    const curlText = (url) => new Promise((resolve, reject) => {
      const p = curl(url); const out = []; let err = '';
      p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => (code ? reject(new Error(`curl ${code} for ${url}: ${err.trim()}`)) : resolve(Buffer.concat(out))));
    });
    // Minimal CSV row splitter (quoted fields, no embedded newlines in these files).
    const splitCSV = (line) => {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"') q = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out;
    };

    // Years with PM2.5 on the island start in the late 1990s (Victoria Topaz opened May 1998).
    const listing = (await curlText(`${FTP}/`)).toString('utf8');
    const years = [...listing.matchAll(/<DIR>\s+(\d{4})\s*$/gm)].map((m) => +m[1]).filter((y) => y >= 1998).sort();

    const REGION = '01 - Vancouver Island';
    const stationMeta = new Map(); // EMS_ID -> { lon, lat } from the yearly station lists (latest wins)
    const perYear = [];
    for (const year of years) {
      // station-days: { ems: { name, days: { 'YYYY-MM-DD': [sum of hourly means, hours] } } }
      const buf = await cached(`smoke/pm25-${year}.json`, async () => {
        log(`  streaming ${year}/PM25.csv …`);
        const p = curl(`${FTP}/${year}/PM25.csv`);
        let err = '';
        p.stderr.on('data', (d) => (err += d));
        const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity });
        let cols = null;
        const hours = new Map(); // ems|date|hh -> [sum, n] (stations can run two instruments at once)
        const names = new Map(); // ems -> Map(name -> count)
        for await (const line of rl) {
          if (!cols) { cols = splitCSV(line); continue; }
          if (!line.includes(REGION)) continue; // cheap pre-filter before parsing
          const r = splitCSV(line);
          const get = (k) => r[cols.indexOf(k)];
          if (get('REGION') !== REGION) continue;
          const v = parseFloat(get('RAW_VALUE'));
          if (!Number.isFinite(v)) continue;
          // DATE_PST is hour-ending: 01:00 … 24:00 (or 00:00 of the next day) belong to DATE.
          const [d, t] = String(get('DATE_PST')).split(' ');
          let date = get('DATE') || d;
          let hh = parseInt(t, 10);
          if (hh === 0) {
            if (d === date) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); date = x.toISOString().slice(0, 10); }
            hh = 24;
          }
          const ems = get('EMS_ID');
          const key = `${ems}|${date}|${hh}`;
          const h = hours.get(key) ?? [0, 0];
          h[0] += v; h[1]++;
          hours.set(key, h);
          const nm = names.get(ems) ?? new Map();
          const name = get('STATION_NAME');
          nm.set(name, (nm.get(name) ?? 0) + 1);
          names.set(ems, nm);
        }
        const code = await new Promise((r) => (p.exitCode != null ? r(p.exitCode) : p.on('close', r)));
        if (code) throw new Error(`curl ${code} for ${year}/PM25.csv: ${err.trim()}`);
        const out = {};
        for (const [key, [s, n]] of hours) {
          const [ems, date] = key.split('|');
          out[ems] ??= { name: [...names.get(ems)].sort((a, b) => b[1] - a[1])[0][0], days: {} };
          const day = (out[ems].days[date] ??= [0, 0]);
          day[0] = round(day[0] + s / n, 3);
          day[1]++;
        }
        return Buffer.from(JSON.stringify(out));
      });
      perYear.push([year, JSON.parse(buf.toString('utf8'))]);

      const list = await cached(`smoke/stations-${year}.csv`, () => curlText(`${FTP}/${year}/bc_air_monitoring_stations.csv`)).catch(() => null);
      if (list) {
        const rows = list.toString('utf8').split(/\r?\n/).filter(Boolean).map(splitCSV);
        const h = rows[0];
        for (const r of rows.slice(1)) {
          const lat = parseFloat(r[h.indexOf('LAT')]), lon = parseFloat(r[h.indexOf('LONG')]);
          if (Number.isFinite(lat) && Number.isFinite(lon)) stationMeta.set(r[h.indexOf('EMS_ID')], { lon, lat });
        }
      }
    }

    // BC Ambient Air Quality Objective for PM2.5: 25 µg/m³ as a 24-hour average (adopted 2009).
    // A day counts when it has ≥ 18 valid hours (75%), and a station-year counts when ≥ 75% of
    // its days are valid, the same completeness rules the CAAQS use.
    const THRESHOLD = 25;
    const stations = new Map();
    for (const [year, data] of perYear) {
      const nDays = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 864e5;
      for (const [ems, { name, days }] of Object.entries(data)) {
        const m = stationMeta.get(ems);
        if (!m || !onIsland(m.lon, m.lat, 0.1)) continue;
        // Wildfire smoke arrives May–October; winter exceedances are mostly home wood-burning
        // trapped under inversions, so the fire-season share is kept separately.
        let valid = 0, smoky = 0, season = 0, max = 0;
        for (const [date, [s, n]] of Object.entries(days)) {
          if (!date.startsWith(String(year)) || n < 18) continue;
          const mean = s / n;
          valid++;
          const month = +date.slice(5, 7);
          if (mean > THRESHOLD) { smoky++; if (month >= 5 && month <= 10) season++; }
          if (mean > max) max = mean;
        }
        if (!stations.has(ems)) stations.set(ems, { id: ems, name, lon: round(m.lon), lat: round(m.lat), y: {} });
        const st = stations.get(ems);
        st.name = name; // latest name wins
        // [days over, highest daily mean, share of days with data, days over in May–Oct];
        // partial years are kept only for the coverage notes
        st.y[year] = valid / nDays >= 0.75 ? [smoky, round(max, 1), round(valid / nDays, 2), season] : [null, null, round(valid / nDays, 2), null];
      }
    }
    const list = [...stations.values()].filter((s) => Object.values(s.y).some((v) => v[0] != null));
    // island-wide: mean smoke days across stations with a complete year
    const mean = (v) => round(v.reduce((a, b) => a + b, 0) / v.length, 1);
    const island = years.map((year) => {
      const ok = list.filter((s) => s.y[year]?.[0] != null).map((s) => s.y[year]);
      return ok.length ? [year, mean(ok.map((v) => v[0])), ok.length, Math.max(...ok.map((v) => v[0])), mean(ok.map((v) => v[3])), Math.max(...ok.map((v) => v[3]))] : null;
    }).filter(Boolean);
    log(`  ${list.length} island stations with complete years; ${island.length} years`);
    const worst = [...island].sort((a, b) => b[4] - a[4]).slice(0, 3);
    log(`  smokiest fire seasons: ${worst.map((r) => `${r[0]} (${r[4]} d)`).join(', ')}`);

    await writeOut('smoke', {
      source: 'BC Ministry of Environment and Climate Change Strategy, Air Quality and Climate Monitoring: Verified Hourly Air Quality and Meteorological Data (PM2.5), ftp.env.gov.bc.ca/pub/outgoing/AIR/AnnualSummary, Open Government Licence – BC',
      threshold: THRESHOLD,
      basis: 'BC Ambient Air Quality Objective for PM2.5, 24-hour average (adopted April 2009)',
      // [year, mean days over per station, stations with a complete year, most at one station, then the same two for May–Oct]
      island,
      // y: year -> [smoke days, max daily mean µg/m³, data coverage 0–1]; smoke days null when coverage < 75%
      stations: list,
    });
  },

  // Future climate: CanDCS-U6, the CMIP6 projections statistically downscaled by PCIC (BCCAQv2, 26
  // models, ~10 km grid) with ClimateData.ca's ready-made 30-year index averages and ensemble
  // percentiles. These are the numbers ClimateData.ca shows; we read them from the PAVICS THREDDS
  // server behind it over OPeNDAP, cutting out just the island window in one request per variable.
  async future() {
    await getIsland();
    const DODS = 'https://pavics.ouranos.ca/twitcher/ows/proxy/thredds/dodsC/datasets/simulations/bias_adjusted/cmip6/climatedata_ca/CanDCS-U6/ensemble_statistics/30yAvg';
    // 30-year horizons in the files: 1951-1980 … 2071-2100, one every 10 years (seasonal files have
    // four seasons per horizon, starting with MAM, so JJA is 4h+1).
    const HORIZONS = ['1951-1980', '1961-1990', '1971-2000', '1981-2010', '1991-2020', '2001-2030', '2011-2040', '2021-2050', '2031-2060', '2041-2070', '2051-2080', '2061-2090', '2071-2100'];
    const PERIODS = ['1991-2020', '2021-2050', '2041-2070']; // recent, "2030s", "2050s"
    const hIdx = PERIODS.map((p) => HORIZONS.indexOf(p)); // 4, 7, 9
    const VARS = [
      { id: 'hot', name: 'txgt_30', file: 'annual', d: 1 }, // days with Tmax > 30 °C
      { id: 'temp', name: 'tg_mean', file: 'annual', d: 1, k: true }, // annual mean of daily mean temperature (K in the files, °C here)
      { id: 'frost', name: 'frost_days', file: 'annual', d: 1 }, // days with Tmin < 0 °C
      { id: 'summerRain', name: 'prcptot', file: 'seasonal', d: 0 }, // JJA total, mm
    ];
    const SCEN = ['ssp245', 'ssp585'];
    const PCT = ['p10', 'p50', 'p90'];
    // Native grid: cell centres at 41.0416667 + j/12 °N, -140.9583333 + i/12 °E (510 × 1068).
    const LAT0 = 41.041666665, LON0 = -140.958333335, STEP = 1 / 12;
    const j0 = 86, j1 = 120, i0 = 147, i1 = 214; // ≈ 48.2–51.0 °N, 128.7–123.1 °W
    const nx = i1 - i0 + 1, ny = j1 - j0 + 1;

    // OPeNDAP ASCII: a "name[t][lat][lon]" line at the start of a line, then one "[t][j], v, v, …"
    // line per row.
    const parseGrid = (text, v) => {
      const start = text.indexOf(`\n${v}[`) + 1;
      if (start < 1) throw new Error(`${v} missing from OPeNDAP response`);
      const out = [];
      for (const line of text.slice(start).split('\n').slice(1)) {
        const m = line.match(/^\[(\d+)\]\[(\d+)\], (.*)$/);
        if (!m) break;
        (out[+m[1]] ??= [])[+m[2]] = m[3].split(', ').map(Number);
      }
      return out; // [t][j][i]
    };

    const cube = {}; // `${scen}_${var}_${pct}` -> [period][j][i]
    for (const sv of VARS) {
      const seasonal = sv.file === 'seasonal';
      const t = hIdx.map((h) => (seasonal ? 4 * h + 1 : h));
      // the periods aren't evenly spaced (4, 7, 9), so pull the whole span and pick afterwards
      const span = `[${t[0]}:${seasonal ? 4 : 1}:${t.at(-1)}]`;
      const names = SCEN.flatMap((s) => PCT.map((p) => `${s}_${sv.name}_${p}`));
      const q = names.map((n) => `${n}.${n}${span}[${j0}:1:${j1}][${i0}:1:${i1}]`).join(',');
      const url = `${DODS}/${sv.file}_CanDCS-U6_climindices_ensemble_percentiles_30yAvg.ncml.ascii?${q}`;
      const text = (await cached(`future/${sv.file}-${sv.name}-${j0}-${j1}-${i0}-${i1}.txt`, async () => {
        log(`  OPeNDAP ${sv.file} ${sv.name}`);
        await new Promise((r) => setTimeout(r, 1000));
        return fetchBuf(url, { timeout: 300_000 });
      })).toString('utf8');
      for (const n of names) {
        const g = parseGrid(text, n);
        // keep only the three wanted periods from the pulled span
        cube[n] = t.map((tt) => g[(tt - t[0]) / (seasonal ? 4 : 1)]);
        if (sv.k) for (const rows of cube[n]) for (const row of rows) row.forEach((v, i) => (row[i] = v - 273.15));
      }
    }

    // Grid for the map surface: island cells plus a coastal fringe so the bitmap reaches the shore.
    const cellLon = (i) => LON0 + (i0 + i) * STEP, cellLat = (j) => LAT0 + (j0 + j) * STEP;
    const keep = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) keep.push(onIsland(cellLon(i), cellLat(j), 0.09));
    // Only island cells that have data are stored: `cells` holds their j*nx+i indices and every
    // value array lines up with it. The surface needs less precision than the town figures.
    const cells = [];
    for (let k = 0; k < nx * ny; k++) if (keep[k] && Number.isFinite(cube.ssp245_txgt_30_p50[0][Math.floor(k / nx)]?.[k % nx])) cells.push(k);
    const vals = {}; // var -> scen -> [period][p10, p50, p90] -> values per cell
    for (const sv of VARS) {
      vals[sv.id] = {};
      for (const s of SCEN) {
        vals[sv.id][s] = PERIODS.map((_, pi) => PCT.map((p) => {
          const g = cube[`${s}_${sv.name}_${p}`][pi];
          return cells.map((k) => round(g[Math.floor(k / nx)][k % nx], sv.id === 'frost' || sv.id === 'summerRain' ? 0 : 1));
        }));
      }
    }
    log(`  ${nx}×${ny} grid, ${cells.length} island cells`);

    // Towns: nearest grid cell that has data (town centres on the shore can fall in ocean cells).
    const towns = {};
    for (const m of PLACES) {
      let best = null;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (!Number.isFinite(cube.ssp245_txgt_30_p50[0][j]?.[i])) continue;
        const d = distKm(m.lon, m.lat, cellLon(i), cellLat(j));
        if (!best || d < best.d) best = { i, j, d };
      }
      if (!best || best.d > 15) continue;
      // var -> scen -> [period][p10, p50, p90]
      const t = { km: round(best.d, 1) };
      for (const sv of VARS) {
        t[sv.id] = {};
        for (const s of SCEN) t[sv.id][s] = PERIODS.map((_, pi) => PCT.map((p) => round(cube[`${s}_${sv.name}_${p}`][pi][best.j][best.i], sv.d)));
      }
      towns[m.key] = t;
    }
    const hot = Object.entries(towns).map(([k, t]) => [k, t.hot.ssp245[2][1]]).sort((a, b) => b[1] - a[1]);
    log(`  hot days 2041-2070 SSP2-4.5 median: most ${hot[0]?.[0]} ${hot[0]?.[1]}, fewest ${hot.at(-1)?.[0]} ${hot.at(-1)?.[1]}`);

    await writeOut('future', {
      source: 'CanDCS-U6 statistically downscaled CMIP6 projections (PCIC, BCCAQv2, 26 models; Canadian Centre for Climate Services), 30-year climate index averages and ensemble percentiles as published on ClimateData.ca, read via the PAVICS THREDDS/OPeNDAP server (pavics.ouranos.ca), Open Government Licence – Canada',
      periods: PERIODS,
      scenarios: SCEN,
      percentiles: [10, 50, 90],
      // cell centres: lon = west + i*dx, lat = south + j*dy, row-major from the south-west
      grid: { west: round(cellLon(0), 5), south: round(cellLat(0), 5), dx: round(STEP, 6), dy: round(STEP, 6), nx, ny, cells },
      // var -> scen -> [period][p10, p50, p90] -> one value per grid.cells entry
      vals,
      // town key -> { km to the grid cell used, var -> scen -> [period][p10, p50, p90] }
      towns,
    });
  },

  // Ferries: each island's weekday link to Vancouver Island from BC Ferries' GTFS feed (scripts/ferries.mjs).
  async ferries() {
    const { buildFerries } = await import('./ferries.mjs');
    await buildFerries({ log, cached, writeOut });
  },

  // Trails & waterfalls: OpenStreetMap footpaths, named hiking routes with elevation profiles, and every
  // mapped waterfall with Wikidata photos (scripts/trails.mjs).
  async trails() {
    const { buildTrails } = await import('./trails.mjs');
    await buildTrails({ log, cached, writeOut, round, distKm, pool, BBOX, getIsland, onIsland, PLACES });
  },

  // Internet & cell coverage: ISED's advertised availability by hexagon, and Ookla's measured speeds
  // by quarter pooled into the same hexagons (scripts/internet.mjs).
  async internet() {
    const { buildInternet } = await import('./internet.mjs');
    await buildInternet({ log, cached, writeOut, round, pool, BBOX, getIsland, onIsland });
  },

  // Land Finder: private parcels of 5+ acres, scored for waterfront, quiet, safety and drive times to
  // health care, groceries and gas (scripts/land.mjs). Reads the island, fires, hospitals, seismic and
  // normals outputs, so it runs last.
  async land() {
    const { buildLand } = await import('./land.mjs');
    await buildLand({ log, cached, writeOut, round, distKm, pool, WFS, BBOX, getIsland, onIsland, OUT });
  },

  // Groundwater: GWELLS water wells and mapped aquifers, per-town well figures, and per-parcel well
  // prospects for the Land Finder in their own file (scripts/wells.mjs). Reads land.json, so it runs after land.
  async wells() {
    const { buildWells } = await import('./wells.mjs');
    await buildWells({ log, writeOut, round, distKm, wfsAll, getIsland, onIsland, OUT, PLACES, ISLAND_COMMUNITIES });
  },

  // Tsunami: BC notification zones, openly published inundation/hazard maps, low coastal ground from
  // terrain, and per-parcel measures for Land Finder (scripts/tsunami.mjs). Reads land.json, so it
  // runs after land and writes its parcel values to its own land-tsunami.json.
  async tsunami() {
    const { buildTsunami } = await import('./tsunami.mjs');
    await buildTsunami({ log, cached, writeOut, round, pool, BBOX, getIsland, PLACES, OUT });
  },

  // Floodplains: BC's designated floodplain maps (1978–1997), their study limits and report sheets, per-town and per-parcel
  // shares inside them (scripts/flood.mjs). Reads land.json, so it runs after land; parcel values go to land-flood.json.
  async flood() {
    const { buildFlood } = await import('./flood.mjs');
    await buildFlood({ log, cached, writeOut, round, WFS, BBOX, getIsland, PLACES, OUT });
  },

  // Water access: beaches, beach accesses, boat launches and marinas (OpenStreetMap) and DFO small craft harbours,
  // with each town's nearest (scripts/outdoors.mjs).
  async water() {
    const { buildWater } = await import('./outdoors.mjs');
    await buildWater({ log, cached, writeOut, round, distKm, BBOX, WFS, getIsland, PLACES, ISLAND_COMMUNITIES });
  },

  // Camping & recreation sites: Recreation Sites and Trails BC, and OpenStreetMap campgrounds sorted by the park they
  // sit in (scripts/outdoors.mjs).
  async camping() {
    const { buildCamping } = await import('./outdoors.mjs');
    await buildCamping({ log, cached, writeOut, round, distKm, BBOX, WFS, getIsland, PLACES, ISLAND_COMMUNITIES });
  },

  // Snowpack: BC River Forecast Centre snow courses and snow pillows on the islands, each station's 1 April snow water
  // equivalent by year against its own normal (scripts/snow.mjs).
  async snow() {
    const { buildSnow } = await import('./snow.mjs');
    await buildSnow({ log, cached, writeOut, round, WFS, BBOX, getIsland, onIsland });
  },

  // Radon: Health Canada's Cross-Canada Survey of Radon Concentrations in Homes (2009–2011), every home's result by
  // health area, with the island's three health service delivery areas drawn from the BC Data Catalogue (scripts/radon.mjs).
  async radon() {
    const { buildRadon } = await import('./radon.mjs');
    await buildRadon({ log, cached, writeOut, round, WFS, BBOX, PLACES });
  },

  // A century of logging: every mapped cutblock with its harvest year, plus blocks approved or being logged now
  // (scripts/neighbours.mjs).
  async logging() {
    const { buildLogging } = await import('./neighbours.mjs');
    await buildLogging({ log, cached, writeOut, round, WFS, BBOX, getIsland, onIsland });
  },

  // What's next door: parks, Crown land, water and logging around every Land Finder parcel and town, on a 50 m grid
  // (scripts/neighbours.mjs). Reads the logging and land outputs, so it runs after both.
  async neighbours() {
    const { buildNeighbours } = await import('./neighbours.mjs');
    await buildNeighbours({ log, cached, writeOut, round, WFS, BBOX, getIsland, OUT, PLACES });
  },
};

// ---------------------------------------------------------------------------------------------

const wanted = process.argv.slice(2);
const order = ['island', 'ferries', 'fires', 'quakes', 'rivers', 'climate', 'normals', 'population', 'housing', 'crime', 'hospitals', 'seismic', 'smoke', 'future', 'trails', 'internet', 'land', 'wells', 'tsunami', 'flood', 'logging', 'neighbours', 'water', 'camping', 'snow', 'radon'];
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
