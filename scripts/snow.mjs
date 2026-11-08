// Snowpack: the BC River Forecast Centre's snow surveys on Vancouver Island. Run as the `snow` stage of fetch-data.mjs,
// after `island`, whose outline it clips to.
//
// Sources (all Open Government Licence – British Columbia, BC Ministry of Water, Land and Resource Stewardship):
//   - Manual snow survey data (archive + current season): allmss_archive.csv / allmss_current.csv. Surveyors measure
//     a snow course's depth and water equivalent around the 1st of each month, Jan–Jun; some island courses go back
//     to 1954.
//   - Automated snow weather station data: SW_DailyArchive.csv (daily snow water equivalent from snow pillows, since
//     1967) and SD_Archive.csv (hourly snow depth, since 2003).
//   - Station locations: BC Data Catalogue WFS layers SSL_SNOW_MSS_LOCS_SP (manual courses) and SSL_SNOW_ASWS_STNS_SP
//     (automated stations).
//
// Writes snow.json: each station's 1 April snow water equivalent (and depth) by year, its own normal (median 1 April
// SWE, 1991–2020 where it has 15+ of those years), and the island's median "% of normal" by year.

import { pager } from './neighbours.mjs';

const DATA = 'https://www.env.gov.bc.ca/wsd/data_searches/snow/asws/data';
const UA = { 'User-Agent': 'IslandAtlas/1.0 (open-data atlas; personal use)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NORMAL = [1991, 2020];
const MIN_YEARS = 5; // a station needs this many 1 April values to be shown
const MIN_NORMAL_MM = 100; // stations whose normal 1 April pack is thinner than this stay out of the island "% of normal"

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function getText(cached, name, url) {
  const buf = await cached(`snow/${name}`, async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(600_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const b = Buffer.from(await res.arrayBuffer());
        if (!/^\s*[A-Za-z"]/.test(b.toString('utf8', 0, 40)) || b.length < 1000) throw new Error('not a CSV');
        return b;
      } catch (e) {
        if (attempt >= 4) throw new Error(`${e.message} for ${url}`);
        await sleep(3000 * attempt);
      }
    }
  });
  return buf.toString('utf8');
}

/** "3B17P Wolf River Upper" -> "3B17P" */
const colId = (h) => h.trim().split(/\s+/)[0];

/** A wide CSV (DATE(UTC), one column per station) → for each wanted station, its value on 1 April (or the nearest
 *  reading within `days` days), keyed by year: { id: { year: [value, 'MM-DD'] } }. */
function aprilFirst(text, wanted, { days = 2, hour = 16 } = {}) {
  const lines = text.split(/\r?\n/);
  const head = lines[0].split(',');
  const cols = head.map((h, i) => [colId(h), i]).filter(([id]) => wanted.has(id));
  // candidate rows: late March to early April, keep the reading closest to 1 April at `hour` UTC (08:00 PST)
  const best = {};
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})/.exec(ln);
    if (!m || (m[2] !== '03' && m[2] !== '04')) continue;
    const y = +m[1];
    const off = (Date.UTC(y, +m[2] - 1, +m[3], +m[4]) - Date.UTC(y, 3, 1, hour)) / 36e5; // hours from 1 April
    if (Math.abs(off) > days * 24) continue;
    const f = ln.split(',');
    for (const [id, c] of cols) {
      const v = f[c];
      if (v === '' || v == null || Number.isNaN(+v)) continue;
      const cur = best[id]?.[y];
      if (!cur || Math.abs(off) < cur.off) ((best[id] ??= {})[y] = { off: Math.abs(off), v: Math.max(0, +v), d: `${m[2]}-${m[3]}` });
    }
  }
  return Object.fromEntries(Object.entries(best).map(([id, ys]) => [id, Object.fromEntries(Object.entries(ys).map(([y, b]) => [y, [b.v, b.d]]))]));
}

export async function buildSnow(h) {
  const { log, cached, writeOut, round, WFS, BBOX, getIsland, onIsland } = h;
  await getIsland();
  const wfs = pager({ log, cached, WFS, BBOX }, 'snow');

  // ---------------------------------------------------------------------------------------------
  // where the stations are

  const courseFeats = await wfs('WHSE_WATER_MANAGEMENT.SSL_SNOW_MSS_LOCS_SP', { bbox: true, cacheKey: 'mss-locs', pageSize: 1000 });
  const pillowFeats = await wfs('WHSE_WATER_MANAGEMENT.SSL_SNOW_ASWS_STNS_SP', { bbox: true, cacheKey: 'asws-stns', pageSize: 1000 });
  const sites = [];
  for (const [kind, feats] of [['course', courseFeats], ['pillow', pillowFeats]]) {
    for (const f of feats) {
      const p = f.properties, c = f.geometry?.coordinates;
      if (!c || !onIsland(c[0], c[1], 0.01)) continue;
      sites.push({ id: p.LOCATION_ID, kind, name: p.LOCATION_NAME, elev: p.ELEVATION, lon: round(c[0], 4), lat: round(c[1], 4), active: p.STATUS === 'Active', operator: kind === 'pillow' ? p.OPERATOR ?? null : null });
    }
  }
  log(`  ${sites.filter((s) => s.kind === 'course').length} snow courses and ${sites.filter((s) => s.kind === 'pillow').length} automated stations on the islands`);

  // ---------------------------------------------------------------------------------------------
  // manual snow courses: the "01-Apr" survey of each year

  const courses = new Map(sites.filter((s) => s.kind === 'course').map((s) => [s.id, s]));
  const mss = {};
  for (const [name, url] of [['allmss_archive.csv', `${DATA}/allmss_archive.csv`], ['allmss_current.csv', `${DATA}/allmss_current.csv`]]) {
    const text = await getText(cached, name, url);
    for (const ln of text.split(/\r?\n/).slice(1)) {
      // Snow Course Name, Number, Elev. metres, Date of Survey, Snow Depth cm, Water Equiv. mm, Survey Code, Snow Line Elev. m, Density %, Survey Period
      const f = ln.split(',');
      if (f.length < 10) continue;
      const id = f[1].trim();
      if (!courses.has(id) || f[9].trim() !== '01-Apr') continue;
      const [y, mo, d] = f[3].trim().split('/');
      const swe = f[5].trim(), depth = f[4].trim(), code = f[6].trim();
      if (swe === '' || Number.isNaN(+swe) || /NOT MEASURED/.test(code)) continue;
      (mss[id] ??= {})[+y] = { swe: +swe, depth: depth === '' || Number.isNaN(+depth) ? null : +depth, date: `${mo}-${d}`, code: code || null };
    }
  }

  // ---------------------------------------------------------------------------------------------
  // automated stations: snow pillow water equivalent on 1 April, and snow depth on the same morning

  const pillowIds = new Set(sites.filter((s) => s.kind === 'pillow').map((s) => s.id));
  const sw = aprilFirst(await getText(cached, 'SW_DailyArchive.csv', `${DATA}/SW_DailyArchive.csv`), pillowIds);
  const sd = aprilFirst(await getText(cached, 'SD_Archive.csv', `${DATA}/SD_Archive.csv`), pillowIds, { days: 1 });

  // ---------------------------------------------------------------------------------------------
  // per station: 1 April series and its own normal

  const stations = [];
  for (const s of sites) {
    const swe = {}, depth = {}, date = {}, flag = {};
    if (s.kind === 'course') {
      for (const [y, r] of Object.entries(mss[s.id] ?? {})) {
        swe[y] = r.swe;
        if (r.depth != null) depth[y] = r.depth;
        if (r.date !== '04-01') date[y] = r.date;
        if (r.code && r.code !== 'N') flag[y] = r.code.toLowerCase();
      }
    } else {
      for (const [y, [v, d]] of Object.entries(sw[s.id] ?? {})) { swe[y] = Math.round(v); if (d !== '04-01') date[y] = d; }
      for (const [y, [v]] of Object.entries(sd[s.id] ?? {})) if (swe[y] != null) depth[y] = Math.round(v);
    }
    const ys = Object.keys(swe).map(Number).sort((a, b) => a - b);
    if (ys.length < MIN_YEARS) continue;
    const inNormal = ys.filter((y) => y >= NORMAL[0] && y <= NORMAL[1]).map((y) => swe[y]);
    let normal = null, normalPeriod = null;
    if (inNormal.length >= 15) { normal = median(inNormal); normalPeriod = `${NORMAL[0]}–${NORMAL[1]}`; }
    else if (ys.length >= 10) { normal = median(ys.map((y) => swe[y])); normalPeriod = `${ys[0]}–${ys.at(-1)}`; }
    stations.push({ ...s, from: ys[0], to: ys.at(-1), n: ys.length, normal: normal != null ? Math.round(normal) : null, normalPeriod, swe, depth, ...(Object.keys(date).length ? { date } : {}), ...(Object.keys(flag).length ? { flag } : {}) });
  }
  stations.sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));

  // ---------------------------------------------------------------------------------------------
  // the island's year: median of each station's 1 April pack as a share of its own normal

  const byYear = {};
  for (const s of stations) {
    if (!s.normal || s.normal < MIN_NORMAL_MM) continue;
    for (const [y, v] of Object.entries(s.swe)) (byYear[y] ??= []).push(v / s.normal);
  }
  const island = {};
  for (const [y, xs] of Object.entries(byYear)) if (xs.length >= 2) island[y] = [round(median(xs), 3), xs.length];
  const iy = Object.keys(island).map(Number).sort((a, b) => a - b);
  log(`  ${stations.length} stations with ${MIN_YEARS}+ years of 1 April data (${stations.filter((s) => s.kind === 'course').length} courses, ${stations.filter((s) => s.kind === 'pillow').length} pillows); island index ${iy[0]}–${iy.at(-1)}`);
  const ranked = iy.filter((y) => island[y][1] >= 3).sort((a, b) => island[a][0] - island[b][0]);
  log(`  lowest: ${ranked.slice(0, 5).map((y) => `${y} ${Math.round(island[y][0] * 100)}% (n${island[y][1]})`).join(', ')}`);
  log(`  highest: ${ranked.slice(-4).reverse().map((y) => `${y} ${Math.round(island[y][0] * 100)}% (n${island[y][1]})`).join(', ')}`);

  await writeOut('snow', {
    source: 'BC River Forecast Centre snow survey data (manual snow courses since 1954, automated snow pillows since 1988) and station locations, BC Ministry of Water, Land and Resource Stewardship, Open Government Licence – British Columbia',
    asOf: new Date().toISOString().slice(0, 10),
    normalYears: NORMAL,
    minNormalMm: MIN_NORMAL_MM,
    stations,
    // year -> [median of station 1 April SWE ÷ that station's normal, stations counted]
    island,
  });
}
