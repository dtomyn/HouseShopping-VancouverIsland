// Windstorms: a century-scale record of the island's big blows from Environment and Climate Change Canada's daily
// climate observations (the day's peak wind gust, km/h, and its direction). Run as the `wind` stage of fetch-data.mjs.
//
// Source: ECCC climate-daily and climate-stations collections on api.weather.gc.ca (MSC GeoMet OGC API), Open
// Government Licence – Canada. Only some stations measure gusts (airports, lighthouses and the automatic stations that
// replaced them). Until mid-2018 a calm day was recorded as 0 and a missing one left empty, so a station-year counts
// once it has 300 days with a gust value; since then (and at some stations always) calm days are left empty too, so a
// year also counts once it has gust readings in at least 11 of its 12 months. Stations that moved a short way and changed their name (VICTORIA INT'L A and VICTORIA INTL A,
// GONZALES HTS and GONZALES CS) are joined into one record.
//
// A storm day is a gust of 90 km/h or more, Environment Canada's wind-warning line for most of the BC coast (gusts that
// bring down trees and power lines); a gale day 70 km/h or more. Lighthouses and other exposed headlands and islets see
// far more of both than a sheltered town, so stations are marked exposed and the town figures prefer a sheltered one.
//
// Writes wind.json: stations with per-year counts and their storm days, the island's yearly figure, the biggest
// storm days across the network, and each town's nearest representative station.

const STORM = 90, GALE = 70; // km/h
const MIN_DAYS = 300; // days with a gust value for a station-year to count (before calm days went blank in 2018)
const MIN_MONTHS = 11;
const TOWN_KM = 40;
const RECENT_YEARS = 30;
const EXPOSED = /\b(ISLAND|ISLANDS|POINT|PT|ROCKS|HEAD|CAPE|LIGHT|LIGHTHOUSE|LIGHTSTATION|BULL HARBOUR|ESTEVAN|PACHENA|AMPHITRITE|LENNARD|CARMANAH|SCARLETT)\b/;

export async function buildWind(h) {
  const { log, writeOut, round, distKm, BBOX, getIsland, onIsland, ogcAll, PLACES } = h;
  await getIsland();
  const bbox = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
  const lastYear = new Date().getFullYear() - 1; // the last complete year

  // -------------------------------------------------------------------------------------------
  // 1. which stations on (or just off) the islands have ever recorded a gust: sample two days a year across the network

  const all = await ogcAll('climate-stations', { bbox }, 'wind-climate-stations');
  const byId = new Map(all.map((f) => [f.properties.CLIMATE_IDENTIFIER, f]));
  const gusty = new Set();
  // since 2018 a calm day has no value, so later years need more probes to catch the sheltered stations on a windy day
  const probes = [];
  for (let y = 1953; y <= lastYear; y += 2) probes.push(`${y}-01-15`, `${y}-07-15`);
  for (let y = 2016; y <= lastYear; y++) for (let mo = 1; mo <= 12; mo++) probes.push(`${y}-${String(mo).padStart(2, '0')}-05`, `${y}-${String(mo).padStart(2, '0')}-20`);
  for (const ymd of probes) {
    const rows = await ogcAll('climate-daily', { bbox, LOCAL_DATE: `${ymd} 00:00:00`, properties: 'CLIMATE_IDENTIFIER,SPEED_MAX_GUST' }, `wind-probe-${ymd}`);
    for (const r of rows) if (r.properties.SPEED_MAX_GUST != null) gusty.add(r.properties.CLIMATE_IDENTIFIER);
  }
  const cand = [...gusty].map((id) => byId.get(id)).filter((f) => f?.geometry && onIsland(f.geometry.coordinates[0], f.geometry.coordinates[1], 0.06));
  log(`  ${gusty.size} stations in the box have recorded gusts; ${cand.length} on or just off the islands`);

  // -------------------------------------------------------------------------------------------
  // 2. their daily peak gusts, joined into one record per site

  const stem = (name) => name.toUpperCase().replace(/INT'L/g, 'INTL').replace(/[()'.]/g, ' ').replace(/\b(A|AUT|CS|HTS|HEIGHTS|CCG|AIRPORT|CLIMATE|INTL)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const sites = [];
  for (const f of cand) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    let s = sites.find((x) => x.stem === stem(p.STATION_NAME) && distKm(x.lon, x.lat, lon, lat) < 6);
    if (!s) { s = { stem: stem(p.STATION_NAME), names: [], ids: [], lon, lat, days: new Map() }; sites.push(s); }
    s.names.push(p.STATION_NAME); s.ids.push(p.CLIMATE_IDENTIFIER);
    const rows = await ogcAll('climate-daily', { CLIMATE_IDENTIFIER: p.CLIMATE_IDENTIFIER, properties: 'LOCAL_DATE,SPEED_MAX_GUST,DIRECTION_MAX_GUST', sortby: 'LOCAL_DATE' }, `wind-daily-${p.CLIMATE_IDENTIFIER}`);
    for (const r of rows) {
      const g = r.properties.SPEED_MAX_GUST;
      if (g == null || g < 0) continue;
      const d = r.properties.LOCAL_DATE.slice(0, 10);
      const prev = s.days.get(d);
      if (!prev || g > prev[0]) s.days.set(d, [g, r.properties.DIRECTION_MAX_GUST ?? null]);
    }
  }
  const title = (t) => t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bIntl\b/, 'International').replace(/\bCs\b/, '').replace(/\bA\b$/, 'Airport').replace(/\(Aut\)/, '').replace(/\s+/g, ' ').trim();

  // -------------------------------------------------------------------------------------------
  // 3. per site and year: days with a gust value, storm days, gale days, the year's top gust

  const stations = [];
  for (const s of sites) {
    const years = {};
    for (const [d, [g, dir]] of s.days) {
      const y = +d.slice(0, 4);
      if (y > lastYear) continue;
      const Y = (years[y] ??= { n: 0, months: new Set(), storm: 0, gale: 0, max: -1, on: null, dir: null });
      Y.n++;
      Y.months.add(d.slice(5, 7));
      if (g >= STORM) Y.storm++;
      if (g >= GALE) Y.gale++;
      if (g > Y.max) { Y.max = g; Y.on = d.slice(5); Y.dir = dir; }
    }
    // some stations never wrote calm days as 0, so the month rule applies to any year
    for (const [, Y] of Object.entries(years)) Y.ok = Y.n >= MIN_DAYS || Y.months.size >= MIN_MONTHS;
    const valid = Object.entries(years).filter(([, Y]) => Y.ok).map(([y]) => +y);
    if (valid.length < 8) continue;
    const big = [...s.days].filter(([d, [g]]) => g >= STORM && +d.slice(0, 4) <= lastYear).sort((a, b) => a[0].localeCompare(b[0]));
    const record = [...s.days].filter(([d]) => +d.slice(0, 4) <= lastYear).reduce((a, b) => (b[1][0] > a[1][0] ? b : a));
    const name = title(s.names.reduce((a, b) => (a.length <= b.length ? a : b)));
    stations.push({
      name, ids: s.ids, lon: round(s.lon, 4), lat: round(s.lat, 4),
      exposed: EXPOSED.test(s.stem) || !onIsland(s.lon, s.lat, 0),
      from: Math.min(...valid), to: Math.max(...valid), n: valid.length,
      record: [record[1][0], record[0], record[1][1]],
      // year -> [1 if the year counts (enough readings), storm days, gale days, top gust, its date (MM-DD)]
      years: Object.fromEntries(Object.entries(years).map(([y, Y]) => [y, [Y.ok ? 1 : 0, Y.storm, Y.gale, Y.max, Y.on]])),
      // every storm day: [YYYY-MM-DD, gust, direction (tens of degrees)]
      big: big.map(([d, [g, dir]]) => [d, g, dir]),
    });
  }
  stations.sort((a, b) => b.lat - a.lat);
  log(`  ${stations.length} gust records: ${stations.map((s) => `${s.name}${s.exposed ? '*' : ''} ${s.from}–${s.to}`).join(', ')}`);
  if (stations.length < 6) throw new Error(`only ${stations.length} usable gust records on the islands`);

  // -------------------------------------------------------------------------------------------
  // 4. the island each year: storm days per reporting station (sheltered and exposed alike), and how many reported

  const island = {};
  for (let y = 1953; y <= lastYear; y++) {
    const rows = stations.filter((s) => s.years[y]?.[0] === 1);
    if (rows.length < 3) continue;
    island[y] = [round(rows.reduce((t, s) => t + s.years[y][1], 0) / rows.length, 2), rows.length, round(rows.filter((s) => !s.exposed).reduce((t, s) => t + s.years[y][1], 0) / Math.max(1, rows.filter((s) => !s.exposed).length), 2)];
  }

  // -------------------------------------------------------------------------------------------
  // 5. the biggest storm days: how many stations reached storm force, against how many were reporting

  // stations "reporting" on a day: those whose year counts (a blank day in a counted year is a calm one)
  const days = new Map();
  stations.forEach((s, k) => {
    const site = sites.find((x) => x.ids[0] === s.ids[0]);
    for (const [d, [g, dir]] of site.days) {
      if (+d.slice(0, 4) > lastYear || s.years[d.slice(0, 4)]?.[0] !== 1) continue;
      const D = days.get(d) ?? days.set(d, { storm: 0, at: [] }).get(d);
      if (g >= STORM) D.storm++;
      if (g >= 60) D.at.push([k, g, dir]);
    }
  });
  const repOn = (d) => island[d.slice(0, 4)]?.[1] ?? 0;
  const cands = [...days].map(([d, D]) => ({ d, rep: repOn(d), storm: D.storm, at: D.at.sort((a, b) => b[1] - a[1]) }))
    .filter((D) => D.storm >= 2 && D.rep >= 4);
  // the network was 4–6 stations in the 1960s and 15+ now, so keep both the days with the most stations at storm
  // force and the days with the largest share of them (then the strongest gust)
  const byCount = [...cands].sort((a, b) => b.storm - a.storm || b.at[0][1] - a.at[0][1]).slice(0, 30);
  const byShare = [...cands].sort((a, b) => b.storm / b.rep - a.storm / a.rep || b.at[0][1] - a.at[0][1]).slice(0, 30);
  const storms = [...new Map([...byCount, ...byShare].map((x) => [x.d, x])).values()].sort((a, b) => b.storm - a.storm || b.at[0][1] - a.at[0][1]);
  log(`  biggest storm days: ${storms.slice(0, 10).map((s) => `${s.d} (${s.storm}/${s.rep} stations, peak ${s.at[0][1]} km/h at ${stations[s.at[0][0]].name})`).join('; ')}`);

  // -------------------------------------------------------------------------------------------
  // 6. towns: the nearest sheltered station with 15+ years (else the nearest of any kind), its last 30 years

  const towns = {};
  for (const m of PLACES) {
    const near = stations.map((s, k) => ({ s, k, d: distKm(m.lon, m.lat, s.lon, s.lat) })).filter((x) => x.d <= TOWN_KM && x.s.n >= 15).sort((a, b) => a.d - b.d);
    const pick = near.find((x) => !x.s.exposed) ?? near[0];
    if (!pick) continue;
    const ys = Object.entries(pick.s.years).filter(([y, v]) => v[0] === 1 && +y > lastYear - RECENT_YEARS).map(([, v]) => v);
    if (ys.length < 8) continue;
    towns[m.key] = {
      st: pick.k, km: round(pick.d, 1), years: ys.length,
      storm: round(ys.reduce((t, v) => t + v[1], 0) / ys.length, 1),
      gale: round(ys.reduce((t, v) => t + v[2], 0) / ys.length, 1),
    };
  }
  const tv = Object.entries(towns).sort((a, b) => b[1].storm - a[1].storm);
  log(`  towns, most storm days a year: ${tv.slice(0, 6).map(([k, v]) => `${k} ${v.storm} (${stations[v.st].name})`).join(', ')}; fewest: ${tv.slice(-4).map(([k, v]) => `${k} ${v.storm}`).join(', ')}`);

  await writeOut('wind', {
    source: 'Environment and Climate Change Canada, daily climate observations (peak gust and direction) via api.weather.gc.ca, Open Government Licence – Canada',
    storm: STORM, gale: GALE, minDays: MIN_DAYS, recentYears: RECENT_YEARS, lastYear,
    stations, island, storms, towns,
  });
}
