// Derived, per-town statistics shared by the Town Report and the Town Finder.
import { townNet, TownNet } from './internet';
import { Data, Facility, FutureTown, Muni, NormalsStation, Smoke, TrailTown, km, trailingMedianPrice } from './data';

/** A climate-normal value borrowed from the nearest station that reports it. */
export type NormalPick = { v: number; name: string; dist: number };
export type NormalVar = 'sun' | 'wetDays' | 'frostDays' | 'snow';
// Only 8 island stations measure sunshine, so allow a longer reach for it than for the others.
const NORMAL_REACH: Record<NormalVar, number> = { sun: 60, wetDays: 40, frostDays: 40, snow: 40 };

/** A trip to a hospital/ER; `min` is null when only straight-line distance is known. */
export type CareTrip = { name: string; city: string; ed: Facility['ed']; min: number | null; km: number; ferry: boolean };

export type TownMetrics = {
  muni: Muni;
  price: number | null; // trailing 12-month median transfer value
  priceYear: string | null;
  priceChange5y: number | null; // ratio - 1
  pop: number | null;
  popYear: number | null;
  popGrowth10y: number | null;
  s65: number | null;
  csi: number | null;
  csiYear: string | null;
  fires15km: number; // ignitions within 15 km since 1990
  burnedHa25km: number; // perimeter area within 25 km since 1950
  quakes75km: number; // M4+ within 75 km since 1970
  shaking: { pga2: number; pga10: number } | null; // NRCan 2020 hazard at the town centre, g (site class C)
  climate: { name: string; dist: number; meanTemp: number; precip: number | null; trend: number | null } | null;
  river: { name: string; dist: number; floodShare: number; record: { year: string; ratio: number } } | null;
  feels: Record<NormalVar, NormalPick | null>; // climate normals from the nearest reporting station
  er: CareTrip | null; // nearest round-the-clock emergency room, without a ferry if any can be reached that way
  care: CareTrip | null; // nearest hospital or ER of any kind (may be limited hours or need a ferry)
  smoke: SmokePick | null; // high-PM2.5 days a year at the nearest monitor with a recent record
  future: FutureTown | null; // CMIP6 projections at the nearest grid cell: var -> scenario -> [period][p10, p50, p90]
  outdoors: TrailTown | null; // footpath km within 10 km, waterfalls within 30 km, nearest named falls and routes (OpenStreetMap)
  internet: TownNet | null; // advertised 50/10 and mobile for the town's hexagon (ISED), measured speeds within 5 km (Ookla)
};

/**
 * Average days a year with daily PM2.5 over the BC objective, at the nearest monitoring station with
 * at least SMOKE_MIN_YEARS complete years in the last decade of data. A shared window keeps towns
 * comparable: a station that closed before the smoky late 2010s would otherwise look clean.
 */
export type SmokePick = { name: string; dist: number; avg: number; season: number; years: number; from: number; to: number };
const SMOKE_REACH = 75;
const SMOKE_MIN_YEARS = 5;

/** Nearest station reporting `k` (and every field in `also`, so paired values come from one place). */
function nearestNormal(stations: NormalsStation[], m: Muni, k: NormalVar, also: NormalVar[] = []): NormalPick | null {
  let best: NormalPick | null = null;
  for (const s of stations) {
    const v = s[k];
    if (v == null || also.some((a) => s[a] == null)) continue;
    const d = km(m.lon, m.lat, s.lon, s.lat);
    if (d <= NORMAL_REACH[k] && (!best || d < best.dist)) best = { v, name: s.name, dist: d };
  }
  return best;
}

function nearestSmoke(smoke: Smoke, m: Muni): SmokePick | null {
  const to = smoke.island.at(-1)![0], from = to - 9;
  let best: SmokePick | null = null;
  for (const s of smoke.stations) {
    const ys = Object.entries(s.y).filter(([y, v]) => +y >= from && v[0] != null);
    if (ys.length < SMOKE_MIN_YEARS) continue;
    const d = km(m.lon, m.lat, s.lon, s.lat);
    if (d > SMOKE_REACH || (best && d >= best.dist)) continue;
    const avg = ys.reduce((a, [, v]) => a + v[0]!, 0) / ys.length;
    const season = ys.reduce((a, [, v]) => a + (v[3] ?? 0), 0) / ys.length;
    best = { name: s.name, dist: d, avg, season, years: ys.length, from, to };
  }
  return best;
}

export function latestYear(series?: Record<string, number>, maxYear = Infinity) {
  if (!series) return null;
  const ys = Object.keys(series).map(Number).filter((y) => y <= maxYear).sort((a, b) => a - b);
  return ys.length ? ys[ys.length - 1] : null;
}

export function slope(points: [number, number][]) {
  const n = points.length;
  if (n < 10) return null;
  const mx = points.reduce((a, p) => a + p[0], 0) / n;
  const my = points.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of points) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? num / den : null;
}

export function islandAnomalies(data: Data) {
  const out: Record<number, number> = {};
  if (!data.climate) return out;
  const acc: Record<number, number[]> = {};
  for (const s of data.climate.stations) for (const [y, v] of Object.entries(s.temp)) (acc[+y] ??= []).push(v - s.baseline);
  for (const [y, arr] of Object.entries(acc)) if (arr.length >= 3) out[+y] = arr.reduce((a, b) => a + b, 0) / arr.length;
  return out;
}

let cache: TownMetrics[] | null = null;

export function townMetrics(data: Data): TownMetrics[] {
  if (cache) return cache;
  const nowYear = new Date().getFullYear();
  cache = data.munis.map((m) => {
    // housing
    let price: number | null = null, priceYear: string | null = null, priceChange5y: number | null = null;
    const hs = data.housing?.munis[m.key];
    if (hs) {
      const months = Object.keys(hs).sort();
      const last = months[months.length - 1];
      const [ly, lm] = last.split('-').map(Number);
      const t = ly + (lm - 1) / 12;
      price = trailingMedianPrice(hs, t);
      priceYear = `12 mo. to ${last}`;
      const before = trailingMedianPrice(hs, t - 5);
      if (price && before) priceChange5y = price / before - 1;
    }
    // population
    const ps = data.population?.munis[m.key];
    let pop: number | null = null, popYear: number | null = null, popGrowth10y: number | null = null, s65: number | null = null;
    if (ps) {
      const est = latestYear(ps.pop, (ps.firstProjection ?? nowYear + 1) - 1);
      if (est) {
        pop = ps.pop[est]; popYear = est; s65 = ps.s65[est];
        const p10 = ps.pop[est - 10];
        if (p10) popGrowth10y = pop / p10 - 1;
      }
    }
    // crime
    const cs = data.crime?.munis[m.key]?.csi;
    // ignore series that stopped years ago (e.g. a police force that merged)
    const cyAny = latestYear(cs);
    const cy = cyAny && cyAny >= nowYear - 4 ? cyAny : null;
    const csi = cy ? cs![cy] : null;

    // hazards
    let fires15km = 0, burnedHa25km = 0, quakes75km = 0;
    if (data.fires) {
      for (const p of data.fires.points) if (p[2] >= 1990 && km(m.lon, m.lat, p[0], p[1]) <= 15) fires15km++;
      const seen = new Set<string>();
      for (const p of data.fires.perimeters) {
        if (p.year < 1950 || seen.has(p.id)) continue;
        if (km(m.lon, m.lat, p.c[0], p.c[1]) <= 25) { burnedHa25km += p.ha; seen.add(p.id); }
      }
    }
    if (data.quakes) for (const q of data.quakes.rows) if (q[3] >= 4 && q[4] >= 1970 && km(m.lon, m.lat, q[0], q[1]) <= 75) quakes75km++;

    // nearest long-record climate station with recent data
    let climate: TownMetrics['climate'] = null;
    if (data.climate) {
      let best: { s: (typeof data.climate.stations)[number]; d: number } | null = null;
      for (const s of data.climate.stations) {
        const recent = Object.keys(s.temp).filter((y) => +y >= 2000).length;
        if (recent < 8) continue;
        const d = km(m.lon, m.lat, s.lon, s.lat);
        if (!best || d < best.d) best = { s, d };
      }
      if (best) {
        const s = best.s;
        const recentYears = Object.keys(s.temp).map(Number).filter((y) => y >= 1991);
        const meanTemp = recentYears.reduce((a, y) => a + s.temp[y], 0) / recentYears.length;
        const pYears = Object.keys(s.precip).map(Number).filter((y) => y >= 1981);
        const precip = pYears.length >= 5 ? pYears.reduce((a, y) => a + s.precip[y], 0) / pYears.length : null;
        const tr = slope(Object.entries(s.temp).filter(([y]) => +y >= 1950).map(([y, v]) => [+y, v]));
        climate = { name: s.name, dist: best.d, meanTemp, precip, trend: tr == null ? null : tr * 10 };
      }
    }

    // nearest gauged river within 12 km
    let river: TownMetrics['river'] = null;
    if (data.rivers) {
      let best: { s: (typeof data.rivers.stations)[number]; d: number } | null = null;
      for (const s of data.rivers.stations) {
        const d = km(m.lon, m.lat, s.lon, s.lat);
        if (d <= 12 && (!best || d < best.d)) best = { s, d };
      }
      if (best) {
        const vals = Object.entries(best.s.peaks);
        const high = vals.filter(([, v]) => v >= 1.5 * best!.s.median).length;
        const rec = vals.reduce((a, b) => (b[1] > a[1] ? b : a));
        river = { name: best.s.name, dist: best.d, floodShare: high / vals.length, record: { year: rec[0], ratio: rec[1] / best.s.median } };
      }
    }

    const sz = data.seismic?.towns[m.key];
    const shaking = sz ? { pga2: sz[0], pga10: sz[1] } : null;

    const ns = data.normals?.stations ?? [];
    // frost and snow come from the same station so the "little snow & frost" score is consistent
    const feels: TownMetrics['feels'] = {
      sun: nearestNormal(ns, m, 'sun'),
      wetDays: nearestNormal(ns, m, 'wetDays'),
      frostDays: nearestNormal(ns, m, 'frostDays', ['snow']),
      snow: nearestNormal(ns, m, 'snow', ['frostDays']),
    };

    // hospitals: trips were ranked in the pipeline, fastest first
    let er: CareTrip | null = null, care: CareTrip | null = null;
    if (data.hospitals) {
      const fac = data.hospitals.facilities;
      const trips = (data.hospitals.towns[m.key] ?? []).map((c) => ({ name: fac[c.f].name, city: fac[c.f].city, ed: fac[c.f].ed, min: c.min, km: c.km, ferry: !!c.ferry }));
      care = trips[0] ?? null;
      // islands without their own ER fall back to the ferry route
      er = trips.find((c) => c.ed === '24/7' && !c.ferry) ?? trips.find((c) => c.ed === '24/7') ?? null;
    }

    const smoke = data.smoke ? nearestSmoke(data.smoke, m) : null;
    const future = data.future?.towns[m.key] ?? null;
    const outdoors = data.trails?.towns[m.key] ?? null;
    const internet = data.internet ? townNet(data.internet, m) : null;

    return { muni: m, price, priceYear, priceChange5y, pop, popYear, popGrowth10y, s65, csi, csiYear: cy ? String(cy) : null, fires15km, burnedHa25km, quakes75km, shaking, climate, river, feels, er, care, smoke, future, outdoors, internet };
  });
  return cache;
}

// ---------------------------------------------------------------------------------------------
// Town Finder scoring

/** Minutes added to ferry-dependent ER trips in the ranking when the timetable isn't known. */
export const FERRY_WAIT = 30;
/** Hours a day the ferries run, for turning sailings a day into a typical gap between boats. */
const SERVICE_HOURS = 18;
/** The last boat home counts against an island for each hour it leaves before this hour. */
const LATE_BOAT = 23;

/** Average wait for the next sailing (half the typical gap between boats), in minutes. */
export function ferryWait(m: Muni) {
  return m.ferry ? Math.round((SERVICE_HOURS * 60) / m.ferry.sailings / 2) : FERRY_WAIT;
}

/** Wait added to a routed ER trip that needs a ferry. The router only uses car ferries, so a
 * passenger-only island's timetable says nothing about the route it found. */
export function erFerryWait(m: Muni) {
  return m.ferry?.car ? ferryWait(m) : FERRY_WAIT;
}

/**
 * Ferry dependence as rough minutes: the crossing, the average wait for a boat, and 15 minutes
 * for each hour the last boat home leaves before 11 pm; doubled when no car ferry runs.
 * Places on Vancouver Island score 0.
 */
export function ferryBurden(m: Muni) {
  const f = m.ferry;
  if (!f) return 0;
  const [h, mm] = f.last.split(':').map(Number);
  const early = Math.max(0, LATE_BOAT - (h + mm / 60)) * 15;
  return (f.min + ferryWait(m) + early) * (f.car ? 1 : 2);
}

export type Criterion = {
  id: string;
  label: string;
  hint: string;
  value: (t: TownMetrics) => number | null;
  higherIsBetter: boolean;
  defaultWeight: number;
};

export const CRITERIA: Criterion[] = [
  { id: 'afford', label: 'Affordability', hint: 'Lower median transfer price (islands: estimated from 2021 Census home values)', value: (t) => t.price, higherIsBetter: false, defaultWeight: 3 },
  { id: 'safety', label: 'Low crime', hint: 'Lower Crime Severity Index', value: (t) => t.csi, higherIsBetter: false, defaultWeight: 3 },
  { id: 'fire', label: 'Low wildfire exposure', hint: 'Fewer ignitions within 15 km since 1990', value: (t) => t.fires15km, higherIsBetter: false, defaultWeight: 2 },
  // The official hazard model is the better guide to future shaking; past quake counts mostly track
  // where seismometers and offshore faults are, so that criterion is off by default.
  { id: 'seismic', label: 'Lower shaking hazard', hint: 'Lower expected peak shaking, 2% chance in 50 years (NRCan 2020 hazard model)', value: (t) => t.shaking?.pga2 ?? null, higherIsBetter: false, defaultWeight: 2 },
  { id: 'quake', label: 'Low quake activity', hint: 'Fewer M4+ quakes within 75 km since 1970 (past record)', value: (t) => t.quakes75km, higherIsBetter: false, defaultWeight: 0 },
  { id: 'warm', label: 'Mild & warm', hint: 'Higher mean annual temperature (1991+)', value: (t) => t.climate?.meanTemp ?? null, higherIsBetter: true, defaultWeight: 2 },
  // Sunshine hours from the nearest of the 8 island stations that measure it (within 60 km). That
  // covers all but a few remote villages (which are skipped, not penalized) and separates the sunny
  // east coast from the cloudy west and north better than rainfall did, so no rainfall fallback.
  { id: 'dry', label: 'Sunnier', hint: 'More bright-sunshine hours a year (nearest of 8 stations that measure it; remote villages skipped)', value: (t) => t.feels.sun?.v ?? null, higherIsBetter: true, defaultWeight: 2 },
  { id: 'snow', label: 'Little snow & frost', hint: 'Fewer frost days + cm of snowfall a year (30-yr normals)', value: (t) => (t.feels.frostDays && t.feels.snow ? t.feels.frostDays.v + t.feels.snow.v : null), higherIsBetter: false, defaultWeight: 1 },
  // The router times the crossing but not the wait for a sailing, so ferry trips add half the gap between boats.
  { id: 'hospital', label: 'Close to a hospital', hint: 'Fewer minutes’ drive to the nearest 24/7 emergency room (trips needing a ferry add the average wait for a sailing)', value: (t) => (t.er ? (t.er.min ?? t.er.km) + (t.er.ferry ? erFerryWait(t.muni) : 0) : null), higherIsBetter: false, defaultWeight: 2 },
  // Every Vancouver Island town ties at the top; islands rank below by how much the ferry constrains daily life.
  { id: 'ferry', label: 'Not ferry-dependent', hint: 'Off-island trips need no ferry; for islands, fewer sailings, an earlier last boat home and a longer crossing count against it, and no car ferry counts double', value: (t) => ferryBurden(t.muni), higherIsBetter: false, defaultWeight: 1 },
  { id: 'air', label: 'Clean air (fewer smoke days)', hint: 'Fewer days a year with PM2.5 over 25 µg/m³ at the nearest air monitor, any season (wildfire and wood-stove smoke; last 10 years; towns over 75 km from a monitor skipped)', value: (t) => t.smoke?.avg ?? null, higherIsBetter: false, defaultWeight: 1 },
  // Projection, not history: median of 26 downscaled CMIP6 models for 2041–2070 under the moderate
  // scenario. The range is wide, so it starts at a modest weight.
  { id: 'future', label: 'Mild future summers', hint: 'Fewer projected days over 30 °C in 2041–2070 (moderate emissions, SSP2-4.5, median of 26 climate models)', value: (t) => t.future?.hot.ssp245[2][1] ?? null, higherIsBetter: false, defaultWeight: 1 },
  // A named waterfall counts as much as 10 km of footpath; both from OpenStreetMap.
  { id: 'outdoors', label: 'Trails & waterfalls nearby', hint: 'More km of mapped footpath within 10 km, plus named waterfalls within 30 km (each counted like 10 km of trail)', value: (t) => (t.outdoors ? t.outdoors.km10 + 10 * t.outdoors.named30 : null), higherIsBetter: true, defaultWeight: 2 },
  // Measured, not advertised: what Speedtest users within 5 km got at home over the past year. Towns with
  // fewer than 20 tests nearby are skipped.
  { id: 'internet', label: 'Fast internet', hint: 'Faster measured home download within 5 km of the centre over the past year (Speedtest by Ookla; towns with too few tests skipped)', value: (t) => t.internet?.fixed ?? null, higherIsBetter: true, defaultWeight: 1 },
  { id: 'seniors', label: 'Retiree community', hint: 'Higher share of residents 65+', value: (t) => t.s65, higherIsBetter: true, defaultWeight: 1 },
  { id: 'services', label: 'Services & amenities', hint: 'Larger town (hospitals, shops, transit)', value: (t) => (t.pop ? Math.log10(t.pop) : null), higherIsBetter: true, defaultWeight: 2 },
];

export type Ranked = { t: TownMetrics; score: number; parts: Record<string, number | null> };

/** Percentile-rank each criterion across towns (robust to outliers), then weight-average. */
export function rankTowns(towns: TownMetrics[], weights: Record<string, number>): Ranked[] {
  const parts: Record<string, Map<string, number>> = {};
  for (const c of CRITERIA) {
    const vals = towns.map((t) => ({ k: t.muni.key, v: c.value(t) })).filter((x) => x.v != null) as { k: string; v: number }[];
    vals.sort((a, b) => a.v - b.v);
    const m = new Map<string, number>();
    vals.forEach((x, i) => {
      // ties share their average rank
      let j = i;
      while (j + 1 < vals.length && vals[j + 1].v === x.v) j++;
      const r = vals.length > 1 ? (i + j) / 2 / (vals.length - 1) : 0.5;
      m.set(x.k, c.higherIsBetter ? r : 1 - r);
    });
    parts[c.id] = m;
  }
  return towns
    .map((t) => {
      let sum = 0, wsum = 0;
      const p: Record<string, number | null> = {};
      for (const c of CRITERIA) {
        const s = parts[c.id].get(t.muni.key);
        p[c.id] = s ?? null;
        const w = weights[c.id] ?? 0;
        if (s != null && w > 0) { sum += s * w; wsum += w; }
      }
      return { t, score: wsum ? sum / wsum : 0, parts: p };
    })
    .sort((a, b) => b.score - a.score);
}
