// Derived, per-town statistics shared by the Town Report and the Town Finder.
import { Data, Muni, km, trailingMedianPrice } from './data';

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
  climate: { name: string; dist: number; meanTemp: number; precip: number | null; trend: number | null } | null;
  river: { name: string; dist: number; floodShare: number; record: { year: string; ratio: number } } | null;
};

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

    return { muni: m, price, priceYear, priceChange5y, pop, popYear, popGrowth10y, s65, csi, csiYear: cy ? String(cy) : null, fires15km, burnedHa25km, quakes75km, climate, river };
  });
  return cache;
}

// ---------------------------------------------------------------------------------------------
// Town Finder scoring

export type Criterion = {
  id: string;
  label: string;
  hint: string;
  value: (t: TownMetrics) => number | null;
  higherIsBetter: boolean;
  defaultWeight: number;
};

export const CRITERIA: Criterion[] = [
  { id: 'afford', label: 'Affordability', hint: 'Lower median transfer price', value: (t) => t.price, higherIsBetter: false, defaultWeight: 3 },
  { id: 'safety', label: 'Low crime', hint: 'Lower Crime Severity Index', value: (t) => t.csi, higherIsBetter: false, defaultWeight: 3 },
  { id: 'fire', label: 'Low wildfire exposure', hint: 'Fewer ignitions within 15 km since 1990', value: (t) => t.fires15km, higherIsBetter: false, defaultWeight: 2 },
  { id: 'quake', label: 'Low quake activity', hint: 'Fewer M4+ quakes within 75 km since 1970', value: (t) => t.quakes75km, higherIsBetter: false, defaultWeight: 1 },
  { id: 'warm', label: 'Mild & warm', hint: 'Higher mean annual temperature (1991+)', value: (t) => t.climate?.meanTemp ?? null, higherIsBetter: true, defaultWeight: 2 },
  { id: 'dry', label: 'Drier & sunnier', hint: 'Less annual precipitation', value: (t) => t.climate?.precip ?? null, higherIsBetter: false, defaultWeight: 2 },
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
