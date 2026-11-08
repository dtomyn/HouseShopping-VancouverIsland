// Loads the pre-built JSON files in public/data and shapes them for rendering.

/**
 * A municipality, or (island: true) an unincorporated island community. `areas` says what a
 * figure covers when it isn't the place itself (a shared rural sales area, an RCMP detachment).
 */
export type Muni = {
  key: string; name: string; rd: string; lon: number; lat: number;
  island?: boolean; note?: string; areas?: { housing?: string; crime?: string; pop?: string };
  ferry?: Ferry;
};
/**
 * A place's ferry link to Vancouver Island (weekday timetable): departures a day toward Vancouver
 * Island, the last departure back ("HH:MM"), the shortest crossing in minutes, and whether cars go.
 */
export type Ferry = { car: boolean; sailings: number; last: string; min: number; routes: string; schedule: string };
/** ferries.json: BC Ferries links worked out from the operator's GTFS timetable feed. */
export type Ferries = { source: { url: string; version: string; start: string; end: string; dates: string[] }; places: Record<string, Ferry> };
/** How an island's price was estimated: 2021 Census average owner value, scaled onto a rural sales area. */
export type IslandPrice = { area: string; census: number; owners: number; calib: number; factor: number };

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
/** `census`: a single 2021 Census snapshot (island communities) rather than BC Stats' annual series. */
export type PopSeries = { pop: Record<string, number>; s65: Record<string, number>; firstProjection: number | null; census?: boolean };
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
 * Tsunami exposure (scripts/tsunami.mjs). Towns: BC notification zone of the nearest coast; `low`, the % of ground
 * within `townRadiusM` of the centre that is low coastal ground (below `screenM`, within `nearSeaM` of the sea);
 * `study`/`inHazard`/`mappedHaz` where a published hazard map covers the town.
 */
export type TsunamiTown = { zone: string | null; low: number; lowKm2: number; centreM: number; study?: string; inHazard?: boolean; mappedHaz?: number };
export type TsunamiArea = { id: string; kind: 'local' | 'distant'; name: string; where: string; publisher: string; licence: string; polygons: number };
export type Tsunami = {
  source: string; screenM: number; nearSeaM: number; townRadiusM: number; groundKm2: number;
  zones: { zone: string; label: string; color: string }[];
  areas: TsunamiArea[];
  towns: Record<string, TsunamiTown>;
};
/**
 * Mapped floodplains (scripts/flood.mjs): BC's designated 200-year floodplain maps, 1978–1997. Studies are indexed by
 * position. Towns: `pct`, the % of ground within `townRadiusM` of the centre inside a mapped floodplain; `studies` by
 * share; `centre`, the study at the centre; `near`/`nearKm`, the nearest mapped floodplain within 30 km.
 */
export type FloodStudy = { name: string; projects: string[]; drawing: string | null; designated: number | null; published: number | null; sheets: number; report: string | null; ha: number; fanHa?: number; centre: [number, number] };
export type FloodTown = { pct: number; km2: number; studies: number[]; centre?: number; near?: number; nearKm?: number };
export type Flood = { source: string; townRadiusM: number; studies: FloodStudy[]; towns: Record<string, FloodTown> };
/** The floodplain layer's shapes, loaded the first time it is shown: polygons with their study index, and study-limit lines. */
export type FloodMap = { polys: { s: number; fan?: 1; poly: [number, number][][] }[]; limits: [number, number][][] };
/** The year a floodplain study is dated by: its designation, else its report sheets' publication. */
export const floodYear = (s: FloodStudy) => s.designated ?? s.published;
/**
 * Radon (scripts/radon.mjs): Health Canada's Cross-Canada Survey of Radon Concentrations in Homes (2009–2011), one
 * long-term test per volunteer home. Areas are the island's three health service delivery areas (South, Central, North
 * Vancouver Island), in that order; `values` is every home's result in Bq/m³, sorted, with results under `lod` as 0;
 * `median` likewise (0 means under `lod`). `fsas` counts tests by postal-code prefix ('withheld' where the survey
 * suppressed it). `bc` is every BC health area for comparison; `towns` maps a town key to its area's index.
 */
export type RadonArea = {
  code: string; name: string; surveyName: string;
  n: number; over200: number; over600: number; belowLod: number; median: number; p90: number; max: number;
  values: number[];
  fsas: { fsa: string; n: number; over200: number; max: number }[];
  label: [number, number] | null;
};
export type Radon = {
  source: string; url: string; years: string; lod: number; guideline: number;
  areas: RadonArea[];
  bc: { code: string; name: string; n: number; over200: number; median: number; island: number }[];
  totals: Record<'island' | 'bc' | 'canada', { n: number; over200: number }>;
  towns: Record<string, number>;
};
/** The radon areas' outlines, in `Radon.areas` order, loaded the first time the layer is shown. */
export type RadonMap = { areas: [number, number][][][][] };
/** The tsunami layer's shapes and cells, loaded the first time it is shown. Cells index a z`z` Web Mercator pixel grid from tile (x0, y0), delta-encoded. */
export type TsunamiMap = {
  zones: { zone: string; label: string; color: string; polys: [number, number][][][] }[];
  areas: { id: string; polys: [number, number][][][] }[];
  z: number; x0: number; y0: number; w: number; maxS: number;
  ground: { idx: number[]; e: number[]; s: number[] };
  wave: { idx: number[]; s: number[] };
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
/**
 * A named hiking route from OpenStreetMap. `parts` are the mapped pieces as drawn; `line` is one
 * ordered line through them (for the elevation profile and the fly-through), `prof` its elevations
 * in metres at even steps over `lineKm`. `level`: 1 easy, 2 moderate, 3 hard (from length, climb and
 * any sac_scale). `falls`: indexes into Trails.falls within 600 m of the route.
 */
export type TrailRoute = {
  id: number; name: string; km: number; up: number; down: number; hi: number; lo: number; hrs: number; level: 1 | 2 | 3; loop: boolean;
  net: string | null; op: string | null; web: string | null; wiki: string | null; desc: string | null; ref: string | null;
  parts: [number, number][][]; line: [number, number][]; lineKm: number; prof: number[]; falls: number[];
};
/** A mapped waterfall: height in m where tagged (OSM or Wikidata), ground elevation, metres to the nearest mapped path, routes within 600 m, a Commons photo file name. */
export type Waterfall = { osm: string; name: string | null; lon: number; lat: number; h: number | null; elev: number; path: number | null; routes: number[]; wiki: string | null; img: string | null };
/** Per town: km of footpath within 10 km, waterfalls (and named ones) within 30 km, the nearest named falls and routes as [index, km]. */
export type TrailTown = { km10: number; falls30: number; named30: number; falls: [number, number][]; routes: [number, number][] };
export type Trails = {
  source: string; netKm: number; netPaths: number;
  routes: TrailRoute[]; falls: Waterfall[]; towns: Record<string, TrailTown>;
  /** metres of footpath per grid cell (sparse [cell index, metres]; index = row * nx + col from the south-west) */
  grid: { west: number; south: number; d: number; nx: number; cells: [number, number][] };
};
/** The whole footpath network (trails-net.json, loaded on demand): each way is [name index or -1, sac 0–3, x0, y0, dx, dy, …] in 1/q degrees from west/south. */
export type TrailNet = { west: number; south: number; q: number; names: string[]; ways: number[][] };

/**
 * GWELLS water wells (wells.json): [lon, lat, t (fractional year, null if undated), depth m, yield US gpm,
 * static water level m below ground, aquifer index (-1 none), well tag number, flags (bit 0 artesian;
 * flags >> 1 = 1 + index into `islands` for a small-island well, 0 on Vancouver Island)], sorted by t.
 */
export type WellRow = [number, number, number | null, number | null, number | null, number | null, number, number, number];
export type Aquifer = {
  id: number; name: string | null; loc: string | null; material: string | null; subtype: string | null;
  prod: string | null; vuln: string | null; demand: string | null; quality: string | null; year: number | null;
  polys: [number, number][][][];
};
/** Well figures for a town or area: quartiles [p25, median, p75] of depth (m) and yield (US gpm), the share of low-yield wells (< lowGpm). */
export type WellStats = { n: number; nDepth: number; nYield: number; depth: [number, number, number] | null; gpm: [number, number, number] | null; low: number | null; area?: string };
export type Wells = {
  source: string; lowGpm: number; townKm: number; islands: string[];
  rows: WellRow[]; aquifers: Aquifer[]; towns: Record<string, WellStats>;
  summary: { vancouverIsland: WellStats; smallIslands: WellStats };
};
/**
 * internet.json: ISED National Broadband Data hexagons (~25 km²) on the islands and Ookla Speedtest results pooled into
 * them by quarter. hexes: [lon, lat, homes (2021 estimate), 50/10 band 0–4, over 75% offered 5/1 (0/1), technology
 * bitmask, providers (not satellite), hexagon id]; fixed/mobile: tests-weighted average download (Mbps) and tests, [quarter][hexagon].
 */
export type Internet = {
  source: string; hex: { r: number; angle: number };
  hexes: [number, number, number, number, number, number, number, string][];
  quarters: string[];
  fixed: { d: (number | null)[][]; n: number[][] };
  mobile: { d: (number | null)[][]; n: number[][] };
};
/**
 * logging.json: BC's consolidated cutblocks on the islands. years: year -> [hectares logged, cutblocks, area-weighted
 * lon, lat]; footprint: [year, hectares of land logged at least once by then]; plan: forest-tenure blocks approved
 * but not started (n, ha) and being logged now (active, activeHa).
 */
export type Logging = {
  source: string; asOf: number; landHa: number; loggedHa: number;
  years: Record<string, [number, number, number | null, number | null]>;
  footprint: [number, number][];
  plan: { n: number; ha: number; active: number; activeHa: number };
};
/**
 * logging-blocks.json (loaded when the layer is first shown): every cutblock's time, hectares, % clearcut and outer
 * rings as 1e-4 degree integer deltas from (west, south); plan rows are [1 planned | 2 being logged, date, ha,
 * licensee index, block id, lon, lat].
 */
export type LoggingBlocks = {
  source: string; west: number; south: number; q: number;
  t: number[]; ha: number[]; cc: number[]; shapes: number[][][];
  plan: { who: string[]; rows: [number, number, number, number, string, number, number][]; shapes: number[][][] };
};
/** Per town, within 5 km (ha): land, logged in the last 10 years, ever logged, approved or being logged, parks; parks nearby as [name, kind, km, ha]. */
export type NeighbourTown = { land5: number; cut10: number; everCut: number; plan: number; park5: number; parks: [string, string, number, number][] };
/** neighbours.json: per-town logging and parks, and named park outlines ([park index, rings]) for the map. */
export type Neighbours = {
  source: string; asOf: number; towns: Record<string, NeighbourTown>;
  parks: [string, string, number][]; shapes: [number, number[][]][]; west: number; south: number; q: number;
};

export type CrimeSeries = { csi?: Record<string, number>; vcsi?: Record<string, number>; nvcsi?: Record<string, number> };

/**
 * Water access (water.json) and camping (camping.json) points, from scripts/outdoors.mjs. A row is
 * [lon, lat, kind (index into kinds), island (index into islands; the last is "Other": off the atlas's islands but
 * near a town), name (null: unnamed), details (only the fields the source has), ref (OSM element, DFO harbour, rec site)].
 */
export type OutRow = [number, number, number, number, string | null, Record<string, string | number> | null, string];
/** [row index, km in a straight line], or null when there's none on the town's island */
export type Nearest = [number, number] | null;
export type WaterTown = { beach: Nearest; lake: Nearest; launch: Nearest; moor: Nearest; n10: [number, number, number] };
export type CampTown = { near: Nearest; park: Nearest; rec: Nearest; n25: number[] };
type Points<T> = { source: string; asOf: string; islands: string[]; kinds: { id: string; label: string }[]; cols: string[]; rows: OutRow[]; towns: Record<string, T> };
export type Water = Points<WaterTown> & { townKm: number };
export type Camping = Points<CampTown> & { townKm: number };

/**
 * Snow surveys (snow.json, scripts/snow.mjs): BC River Forecast Centre snow courses (measured by hand around 1 April)
 * and snow pillows (read automatically on 1 April). `swe` is 1 April snow water equivalent in mm by year, `depth` the
 * snow depth in cm; `date` only lists years when the reading wasn't taken on 1 April ('MM-DD'), `flag` the survey
 * code when there was one ('problem', 'early/late', 'trace'…). `normal` is the station's own median 1 April SWE over
 * `normalPeriod` (null with under 10 years of record).
 */
export type SnowStation = {
  id: string; kind: 'course' | 'pillow'; name: string; elev: number; lon: number; lat: number; active: boolean; operator: string | null;
  from: number; to: number; n: number; normal: number | null; normalPeriod: string | null;
  swe: Record<string, number>; depth: Record<string, number>; date?: Record<string, string>; flag?: Record<string, string>;
};
/** `island`: year -> [median of the stations' 1 April SWE ÷ their own normal, stations counted] */
export type Snow = { source: string; asOf: string; normalYears: [number, number]; minNormalMm: number; stations: SnowStation[]; island: Record<string, [number, number]> };

export type Data = {
  island: GeoJSON.Feature | null;
  munis: Muni[];
  fires: { perimeters: FirePerimeter[]; points: FirePoint[]; source: string } | null;
  quakes: { rows: Quake[]; source: string } | null;
  rivers: { stations: RiverStation[]; source: string } | null;
  climate: { stations: ClimateStation[]; source: string; baselinePeriod: string } | null;
  normals: { stations: NormalsStation[]; source: string; period: string } | null;
  population: { munis: Record<string, PopSeries>; source: string } | null;
  housing: { munis: Record<string, HousingSeries>; islands?: Record<string, IslandPrice>; source: string } | null;
  crime: { munis: Record<string, CrimeSeries>; bc: CrimeSeries; source: string } | null;
  hospitals: { facilities: Facility[]; towns: Record<string, Trip[]>; source: string; routing: string; routingSource: string | null } | null;
  seismic: Seismic | null;
  tsunami: Tsunami | null;
  flood: Flood | null;
  smoke: Smoke | null;
  future: Future | null;
  trails: Trails | null;
  ferries: Ferries | null;
  wells: Wells | null;
  internet: Internet | null;
  logging: Logging | null;
  neighbours: Neighbours | null;
  water: Water | null;
  camping: Camping | null;
  snow: Snow | null;
  radon: Radon | null;
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
  const internet = load<Internet>('internet');
  const flood = load<Flood>('flood');
  const water = load<Water>('water'), camping = load<Camping>('camping'), snow = load<Snow>('snow'), radon = load<Radon>('radon');
  const [island, munis, fires, quakes, rivers, climate, normals, population, housing, crime, hospitals, seismic, smoke, future, trails, ferries, wells, logging, neighbours, manifest, tsunami] = await Promise.all([
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
    load<Trails>('trails'),
    load<Ferries>('ferries'),
    load<Wells>('wells'),
    load<Logging>('logging'),
    load<Neighbours>('neighbours'),
    load<any>('manifest'),
    load<Tsunami>('tsunami'),
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
  // Timetable-feed ferry links replace any typed into the place list (only Lasqueti's is typed now).
  for (const m of munis ?? []) if (ferries?.places[m.key]) m.ferry = ferries.places[m.key];

  // Crime is only useful if at least one municipality matched.
  const crimeOk = crime && Object.keys(crime.munis ?? {}).length > 0 ? crime : null;

  return { island, munis: munis ?? [], fires, quakes, rivers, climate, normals, population, housing, crime: crimeOk, hospitals, seismic, tsunami: tsunami?.towns ? tsunami : null, flood: (await flood)?.studies?.length ? await flood : null, smoke: smoke?.island?.length ? smoke : null, future: future?.grid?.cells?.length ? future : null, trails: trails?.routes?.length || trails?.falls?.length ? trails : null, ferries, wells: wells?.rows?.length ? wells : null, internet: (await internet)?.hexes?.length ? await internet : null, logging: logging?.footprint?.length ? logging : null, neighbours, water: (await water)?.rows?.length ? await water : null, camping: (await camping)?.rows?.length ? await camping : null, snow: (await snow)?.stations?.length ? await snow : null, radon: (await radon)?.areas?.length ? await radon : null, manifest: manifest ?? {} };
}

let netPromise: Promise<TrailNet | null> | null = null;
/** The full footpath network is a few MB, so it loads the first time the trails layer is shown. */
export const loadTrailNet = () => (netPromise ??= load<TrailNet>('trails-net'));
let blocksPromise: Promise<LoggingBlocks | null> | null = null;
/** Every cutblock's shape is a few MB, so it loads the first time the logging layer is shown. */
export const loadLoggingBlocks = () => (blocksPromise ??= load<LoggingBlocks>('logging-blocks'));

let floodMapPromise: Promise<FloodMap | null> | null = null;
/** The floodplain shapes and study limits (~230 KB), loaded the first time the layer is shown. */
export const loadFloodMap = () => (floodMapPromise ??= load<FloodMap>('flood-map'));

let radonMapPromise: Promise<RadonMap | null> | null = null;
/** The radon health areas' outlines (~50 KB), loaded the first time the layer is shown. */
export const loadRadonMap = () => (radonMapPromise ??= load<RadonMap>('radon-map'));

let tsunamiMapPromise: Promise<TsunamiMap | null> | null = null;
/** The tsunami layer's shapes and low-ground cells (~1.5 MB), loaded the first time the layer is shown. */
export const loadTsunamiMap = () => (tsunamiMapPromise ??= load<TsunamiMap>('tsunami-map'));

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
    // early months can list sales with no valuation (0): those aren't prices
    if (v && v[2] > 0 && v[0] > 0) vals.push(v[0]);
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
