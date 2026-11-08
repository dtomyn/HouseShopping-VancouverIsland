// Drought: how low the island's rivers ran each summer, from Water Survey of Canada daily flows. Run as the `drought`
// stage of fetch-data.mjs, after `island`, whose outline it clips to.
//
// BC's own Drought Levels (0–5 by basin, 2015 on) are published "Access Only" (Province of BC copyright, no
// redistribution without written permission), so they are not used. Instead this stage measures drought the way the
// River Forecast Centre's low-flow maps do, from the gauges themselves, and goes back as far as each gauge's record.
//
// Sources (both Environment and Climate Change Canada, Open Government Licence – Canada):
//   - HYDAT daily mean discharge for every hydrometric station on the islands (api.weather.gc.ca, collection
//     hydrometric-daily-mean). HYDAT is published once a year, so the record ends with its last year.
//   - Hydrometric Network Basin Polygons: each gauge's upstream drainage basin (collaboration.cmc.ec.gc.ca, region 08
//     GeoJSON, ~80 MB zipped, one feature per line; only the island's gauges are kept).
//
// For each gauge and summer (1 June – 31 October): the lowest 7-day average flow and the day it ended; each summer
// month's mean flow; and from those, where each year ranks against the gauge's own record (a percentile, 0 driest).
// Writes drought.json (gauges, island median by year, each town's nearest long-record gauge) and drought-map.json
// (basin outlines, loaded the first time the layer is shown).

import { unzipSync } from 'fflate';
import simplify from '@turf/simplify';

const OGC = 'https://api.weather.gc.ca/collections';
const BASINS = 'https://collaboration.cmc.ec.gc.ca/cmc/hydrometrics/www/HydrometricNetworkBasinPolygons/geojson/MDA_ADP_08.zip';
const MIN_SUMMERS = 10; // a gauge needs this many complete summers to be shown
const TOWN_MIN_SUMMERS = 20; // and this many, still measured in the last few HYDAT years, to speak for a town
const TOWN_MAX_KM = 40;
const MIN_ISLAND = 5; // gauges reporting before a year gets an island figure
const MONTHS = [6, 7, 8, 9, 10];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** 3 significant figures: flows run from litres to hundreds of cubic metres a second. */
const sig = (v) => (v == null ? null : v === 0 ? 0 : +v.toPrecision(3));
const distKm = (aLon, aLat, bLon, bLat) => {
  const r = Math.PI / 180;
  const s = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
};
const title = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);

/** Where `v` ranks among `all` (the same gauge's years, itself included), 0–100: 0 is the lowest on record, 100 the
 *  highest, ties share their middle rank. */
const pctRank = (v, all) => {
  const below = all.filter((x) => x < v).length, eq = all.filter((x) => x === v).length;
  return all.length > 1 ? Math.round((100 * (below + (eq - 1) / 2)) / (all.length - 1)) : 50;
};

async function getJSON(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 4) throw new Error(`${e.message} for ${url}`);
      await sleep(2000 * attempt);
    }
  }
}

/** Every daily mean discharge of one gauge, as [['YYYY-MM-DD', m3/s], …], cached per gauge. */
async function dailyFlows(cached, id) {
  const buf = await cached(`drought/daily-${id}.json`, async () => {
    const rows = [];
    const limit = 10000;
    for (let offset = 0; ; offset += limit) {
      const q = new URLSearchParams({ f: 'json', limit: String(limit), offset: String(offset), STATION_NUMBER: id, properties: 'DATE,DISCHARGE', sortby: 'DATE', skipGeometry: 'true' });
      const page = await getJSON(`${OGC}/hydrometric-daily-mean/items?${q}`);
      for (const f of page.features) if (f.properties.DISCHARGE != null) rows.push([String(f.properties.DATE).slice(0, 10), f.properties.DISCHARGE]);
      if (page.features.length < limit) break;
    }
    return Buffer.from(JSON.stringify(rows));
  });
  return JSON.parse(buf.toString('utf8'));
}

/** The island gauges' basin outlines from the national basin-polygon file (scanned line by line; 376 MB unzipped). */
async function basinOutlines(cached, ids, log) {
  const buf = await cached('drought/basins-island.json', async () => {
    const zip = await cached('drought/MDA_ADP_08.zip', async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(BASINS, { signal: AbortSignal.timeout(900_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        } catch (e) {
          if (attempt >= 3) throw new Error(`${e.message} for ${BASINS}`);
          await sleep(5000 * attempt);
        }
      }
    });
    const files = unzipSync(new Uint8Array(zip), { filter: (f) => /DrainageBasin/i.test(f.name) });
    const bytes = Object.values(files)[0];
    if (!bytes) throw new Error('no drainage basin file in the basin polygon zip');
    const dec = new TextDecoder();
    const out = {};
    let start = 0;
    while (start < bytes.length) {
      let end = bytes.indexOf(10, start);
      if (end < 0) end = bytes.length;
      const m = /"StationNum":\s*"(\w+)"/.exec(dec.decode(bytes.subarray(start, Math.min(end, start + 200))));
      if (m && ids.has(m[1])) {
        const f = JSON.parse(dec.decode(bytes.subarray(start, end)).replace(/,\s*$/, ''));
        out[m[1]] = simplify(f, { tolerance: 0.002, highQuality: false }).geometry;
      }
      start = end + 1;
    }
    log(`  ${Object.keys(out).length} island basin outlines`);
    return Buffer.from(JSON.stringify(out));
  });
  return JSON.parse(buf.toString('utf8'));
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const doy = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;

/** One gauge's daily record → summers (7-day low, its day, monthly means) and its mean annual flow. */
function summarize(rows) {
  const byYear = new Map();
  for (const [date, q] of rows) {
    const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
    let Y = byYear.get(y);
    if (!Y) byYear.set(y, (Y = { days: new Map(), sum: 0, n: 0 }));
    Y.days.set(doy(y, m, d), q);
    Y.sum += q;
    Y.n++;
  }
  const summers = {};
  const annual = [];
  for (const [y, Y] of byYear) {
    if (Y.n >= (isLeap(y) ? 366 : 365) - 10) annual.push(Y.sum / Y.n);
    const a = doy(y, 6, 1), b = doy(y, 10, 31);
    let have = 0;
    for (let i = a; i <= b; i++) if (Y.days.has(i)) have++;
    if (have < 0.95 * (b - a + 1)) continue;
    // lowest 7-day average ending inside the window, needing all 7 days
    let low = Infinity, lowDay = null;
    for (let e = a + 6; e <= b; e++) {
      let s = 0, ok = true;
      for (let i = e - 6; i <= e; i++) { const q = Y.days.get(i); if (q == null) { ok = false; break; } s += q; }
      if (ok && s / 7 < low) { low = s / 7; lowDay = e; }
    }
    if (lowDay == null) continue;
    const mon = MONTHS.map((m) => {
      const ma = doy(y, m, 1), mb = m === 12 ? doy(y, 12, 31) : doy(y, m + 1, 1) - 1;
      const qs = [];
      for (let i = ma; i <= mb; i++) if (Y.days.has(i)) qs.push(Y.days.get(i));
      return qs.length >= 25 ? qs.reduce((x, v) => x + v, 0) / qs.length : null;
    });
    summers[y] = { low, lowDay, mon };
  }
  return { summers, mad: annual.length >= 5 ? annual.reduce((x, v) => x + v, 0) / annual.length : null, madYears: annual.length };
}

export async function buildDrought(h) {
  const { log, cached, writeOut, round, BBOX, getIsland, onIsland, ogcAll, PLACES } = h;
  await getIsland();
  // the `rivers` stage's station list (shared cache)
  const stations = (await ogcAll('hydrometric-stations', { bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}` }, 'hydro-stations'))
    .filter((f) => f.geometry && onIsland(...f.geometry.coordinates, 0.01));
  log(`  ${stations.length} hydrometric stations on the islands`);

  const gauges = [];
  const months = {};
  let done = 0;
  const queue = [...stations];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let s; (s = queue.shift()); ) {
      const p = s.properties;
      const rows = await dailyFlows(cached, p.STATION_NUMBER);
      if (++done % 25 === 0) log(`  daily flows: ${done}/${stations.length}`);
      if (rows.length < 365 * MIN_SUMMERS) continue;
      const { summers, mad, madYears } = summarize(rows);
      const years = Object.keys(summers).map(Number).sort((a, b) => a - b);
      if (years.length < MIN_SUMMERS) continue;
      const lows = years.map((y) => summers[y].low);
      const monAll = MONTHS.map((_, i) => years.map((y) => summers[y].mon[i]).filter((v) => v != null));
      gauges.push({
        id: p.STATION_NUMBER,
        name: title(p.STATION_NAME),
        lon: round(s.geometry.coordinates[0]),
        lat: round(s.geometry.coordinates[1]),
        area: p.DRAINAGE_AREA_GROSS != null ? round(p.DRAINAGE_AREA_GROSS, 1) : null,
        rhbn: p.RHBN ? 1 : 0,
        active: /active/i.test(p.STATUS_EN) ? 1 : 0,
        from: years[0],
        to: years.at(-1),
        n: years.length,
        mad: sig(mad),
        madYears,
        normalLow: sig(median(lows)),
        // year: [7-day low m3/s, day of year it ended, its percentile]
        years: Object.fromEntries(years.map((y) => [y, [sig(summers[y].low), summers[y].lowDay, pctRank(summers[y].low, lows)]])),
      });
      // Jun–Oct monthly mean flow percentiles (null where a month is missing), for the map's month-by-month shading
      months[p.STATION_NUMBER] = Object.fromEntries(years.map((y) => [y, summers[y].mon.map((v, i) => (v == null ? null : pctRank(v, monAll[i])))]));
    }
  }));
  gauges.sort((a, b) => a.id.localeCompare(b.id));
  log(`  ${gauges.length} gauges with ${MIN_SUMMERS}+ complete summers`);
  const lastYear = Math.max(...gauges.map((g) => g.to));

  // island median percentile by year (gauges with 20+ summers only, so short records don't swing it)
  const island = {};
  for (let y = Math.min(...gauges.map((g) => g.from)); y <= lastYear; y++) {
    const ps = gauges.filter((g) => g.n >= TOWN_MIN_SUMMERS && g.years[y]).map((g) => g.years[y][2]);
    if (ps.length >= MIN_ISLAND) island[y] = [median(ps), ps.length];
  }

  // each town's nearest long-record gauge still measured near the end of HYDAT
  const towns = {};
  const long = gauges.map((g, i) => ({ g, i })).filter(({ g }) => g.n >= TOWN_MIN_SUMMERS && g.to >= lastYear - 3);
  for (const p of PLACES) {
    let best = null;
    for (const { g, i } of long) {
      const d = distKm(p.lon, p.lat, g.lon, g.lat);
      if (d <= TOWN_MAX_KM && (!best || d < best[1])) best = [i, round(d, 1)];
    }
    if (best) towns[p.key] = best;
  }

  const basins = await basinOutlines(cached, new Set(gauges.map((g) => g.id)), log);
  const polys = {};
  for (const g of gauges) {
    const geom = basins[g.id];
    if (!geom) continue;
    const rings = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    polys[g.id] = rings.map((poly) => poly.map((ring) => ring.map(([x, y]) => [round(x), round(y)])));
  }

  await writeOut('drought', {
    source: 'Environment and Climate Change Canada, Water Survey of Canada HYDAT daily mean discharge (api.weather.gc.ca) and Hydrometric Network Basin Polygons',
    lastYear,
    window: 'June 1 – October 31',
    minSummers: MIN_SUMMERS,
    townMinSummers: TOWN_MIN_SUMMERS,
    gauges,
    island,
    towns,
  });
  await writeOut('drought-map', { basins: polys, months });
}
