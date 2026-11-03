// Loads the pre-built JSON files in public/data and shapes them for rendering.

export type Muni = { key: string; name: string; rd: string; lon: number; lat: number };

export type FirePerimeter = { id: string; year: number; t: number; ha: number; cause: number; c: [number, number]; polygon: number[][][] };
/** lon, lat, t (fractional year), hectares, cause (0 lightning, 1 person, 2 unknown) */
export type FirePoint = [number, number, number, number, number];
/** lon, lat, depth km, magnitude, t, place */
export type Quake = [number, number, number, number, number, string];

export type RiverStation = {
  id: string; name: string; lon: number; lat: number; area: number; median: number;
  peaks: Record<string, number>; peakDates: Record<string, string>;
};
export type ClimateStation = {
  id: string; name: string; lon: number; lat: number; baseline: number;
  temp: Record<string, number>; precip: Record<string, number>;
};
/** One station's 30-year climate normals (annual values; fields missing where the station doesn't report them). */
export type NormalsStation = {
  id: string; name: string; lon: number; lat: number; yrs: number;
  sun?: number; wetDays?: number; frostDays?: number; snow?: number; precip?: number;
  tMean?: number; tJan?: number; tJul?: number; wet?: [number, number];
};
export type PopSeries = { pop: Record<string, number>; s65: Record<string, number>; firstProjection: number | null };
/** month "YYYY-MM" -> [median FMV, mean FMV, transactions] */
export type HousingSeries = Record<string, [number, number, number]>;
/** A hospital or emergency room. `ed`: 24/7 ER, 24/7 but "call ahead", limited hours, or none listed. */
export type Facility = { name: string; city: string; lon: number; lat: number; hospital: boolean; ed: '24/7' | 'call' | 'limited' | null; hours: string | null };
/** One town -> facility trip: facility index, drive minutes (null if straight-line only), km, ferry on the fastest route, road line. */
export type Trip = { f: number; min: number | null; km: number; ferry?: boolean; line?: [number, number][] };
/**
 * NRCan 2020 seismic hazard (site class C). `grid.pga` is row-major from the south-west corner
 * (null away from the island); towns: key -> [PGA 2%/50yr, PGA 10%/50yr, Sa(0.2) 2%/50yr], in g.
 */
export type Seismic = {
  source: string; model: string; site: string;
  grid: { west: number; south: number; dx: number; dy: number; nx: number; ny: number; pga: (number | null)[] };
  towns: Record<string, [number, number, number]>;
};
/**
 * BC ENV verified hourly PM2.5, reduced to station-years. y: year -> [days with a daily mean over
 * `threshold`, highest daily mean µg/m³, share of days with data, days over in May–Oct]; the counts
 * are null when under 75% of the year had data.
 */
export type SmokeStation = { id: string; name: string; lon: number; lat: number; y: Record<string, [number | null, number | null, number, number | null]> };
export type Smoke = {
  source: string; threshold: number; basis: string;
  /** [year, mean days over per station, stations with a complete year, most at one station, mean and most in May–Oct] */
  island: [number, number, number, number, number, number][];
  stations: SmokeStation[];
};
/**
 * CanDCS-U6 downscaled CMIP6 projections (ClimateData.ca 30-year index averages). Every series is
 * [period][p10, p50, p90] over `periods` (recent 1991–2020, then 2021–2050 and 2041–2070), per
 * scenario ("ssp245", "ssp585"). Grid values line up with `grid.cells` (j*nx+i from the south-west).
 */
export type FutureVar = 'hot' | 'temp' | 'frost' | 'summerRain';
export type FutureRange = [number, number, number];
export type FutureTown = { km: number } & { [V in FutureVar]: Record<string, FutureRange[]> };
export type Future = {
  source: string; periods: string[]; scenarios: string[]; percentiles: number[];
  grid: { west: number; south: number; dx: number; dy: number; nx: number; ny: number; cells: number[] };
  vals: { [V in FutureVar]: Record<string, (number | null)[][][]> };
  towns: Record<string, FutureTown>;
};
export type CrimeSeries = { csi?: Record<string, number>; vcsi?: Record<string, number>; nvcsi?: Record<string, number> };

export type Data = {
  island: GeoJSON.Feature | null;
  munis: Muni[];
  fires: { perimeters: FirePerimeter[]; points: FirePoint[]; source: string } | null;
  quakes: { rows: Quake[]; source: string } | null;
  rivers: { stations: RiverStation[]; source: string } | null;
  climate: { stations: ClimateStation[]; source: string; baselinePeriod: string } | null;
  normals: { stations: NormalsStation[]; source: string; period: string } | null;
  population: { munis: Record<string, PopSeries>; source: string } | null;
  housing: { munis: Record<string, HousingSeries>; source: string } | null;
  crime: { munis: Record<string, CrimeSeries>; bc: CrimeSeries; source: string } | null;
  hospitals: { facilities: Facility[]; towns: Record<string, Trip[]>; source: string; routing: string; routingSource: string | null } | null;
  seismic: Seismic | null;
  smoke: Smoke | null;
  future: Future | null;
  manifest: Record<string, { ok: boolean; updated?: string; lastError?: string }>;
};

const base = import.meta.env.BASE_URL;

async function load<T>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`${base}data/${name}.json`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadAll(): Promise<Data> {
  const [island, munis, fires, quakes, rivers, climate, normals, population, housing, crime, hospitals, seismic, smoke, future, manifest] = await Promise.all([
    load<GeoJSON.Feature>('island'),
    load<Muni[]>('municipalities'),
    load<any>('fires'),
    load<any>('quakes'),
    load<any>('rivers'),
    load<any>('climate'),
    load<any>('normals'),
    load<any>('population'),
    load<any>('housing'),
    load<any>('crime'),
    load<any>('hospitals'),
    load<Seismic>('seismic'),
    load<Smoke>('smoke'),
    load<Future>('future'),
    load<any>('manifest'),
  ]);

  // Flatten multipolygon perimeters so each render item is a single polygon.
  if (fires) {
    const flat: FirePerimeter[] = [];
    for (const p of fires.perimeters) {
      const polys = p.g.type === 'Polygon' ? [p.g.coordinates] : p.g.coordinates;
      for (const polygon of polys) flat.push({ id: p.id, year: p.year, t: p.t, ha: p.ha, cause: p.cause, c: p.c, polygon });
    }
    fires.perimeters = flat;
  }
  // Crime is only useful if at least one municipality matched.
  const crimeOk = crime && Object.keys(crime.munis ?? {}).length > 0 ? crime : null;

  return { island, munis: munis ?? [], fires, quakes, rivers, climate, normals, population, housing, crime: crimeOk, hospitals, seismic, smoke: smoke?.island?.length ? smoke : null, future: future?.grid?.cells?.length ? future : null, manifest: manifest ?? {} };
}

// ---------------------------------------------------------------------------------------------
// shared helpers

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function km(aLon: number, aLat: number, bLon: number, bLat: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** First index i with get(arr[i]) >= v, for arrays sorted ascending by get. */
export function lowerBound<T>(arr: T[], v: number, get: (d: T) => number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (get(arr[mid]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation inside a sparse {year: value} series; null outside its range. */
export function interpYearly(series: Record<string, number> | undefined, t: number, { hold = 0.999 } = {}): number | null {
  if (!series) return null;
  const y0 = Math.floor(t);
  const a = series[y0];
  const b = series[y0 + 1];
  if (a != null && b != null) return a + (b - a) * (t - y0);
  if (a != null && t - y0 <= hold) return a;
  return null;
}

/** Interpolates monthly "YYYY-MM" series at fractional year t; uses the given tuple index. */
export function interpMonthly(series: HousingSeries | undefined, t: number, idx = 0): number | null {
  if (!series) return null;
  const m = Math.floor((t - Math.floor(t)) * 12);
  const key = (y: number, mm: number) => `${y}-${String(mm + 1).padStart(2, '0')}`;
  const y = Math.floor(t);
  const k0 = key(y, m);
  const k1 = m === 11 ? key(y + 1, 0) : key(y, m + 1);
  const a = series[k0]?.[idx];
  const b = series[k1]?.[idx];
  const f = (t - y) * 12 - m;
  if (a != null && b != null) return a + (b - a) * f;
  return a ?? null;
}

/** Rolling 12-month median of monthly medians ending at fractional year t — smooths small-town noise. */
export function trailingMedianPrice(series: HousingSeries | undefined, t: number, months = 12): number | null {
  if (!series) return null;
  const vals: number[] = [];
  const end = Math.floor(t * 12 + 1e-6);
  for (let i = end - months + 1; i <= end; i++) {
    const y = Math.floor(i / 12);
    const m = i - y * 12;
    const v = series[`${y}-${String(m + 1).padStart(2, '0')}`];
    if (v && v[2] > 0) vals.push(v[0]);
  }
  if (vals.length < Math.min(4, months)) return null;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

export const fmt = {
  int: (v: number) => Math.round(v).toLocaleString('en-CA'),
  money: (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}K`),
  ha: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K ha` : `${Math.round(v)} ha`),
  pct: (v: number) => `${(v * 100).toFixed(1)}%`,
  signed: (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`,
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
