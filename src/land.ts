// Land Finder: filter every private parcel of 5+ acres on the islands by size, water, drive time to
// care, groceries and gas, quiet and safety. The filter rail shows, behind each slider, how many
// parcels its value would let through given every other filter (a crossfilter), and the funnel shows
// which filter is doing the most cutting. Data from scripts/land.mjs (public/data/land.json).
import * as d3 from 'd3';
import type * as maplibregl from 'maplibre-gl';
import { ArcLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Internet, Trails, Water, Wells, fmt } from './data';
import { BANDS, NET_COLOR, parcelNet } from './internet';
import { trailMetresNear } from './trails';
import { esc } from './html';
import { gpmText, lpm, wellStrip, wellsNear, yieldColor } from './wells';
import { NB_CLASSES, Neighbours, loadNeighbours, ringSvg } from './nextdoor';
import { nearestFor, outKm, outName } from './outdoors';

let trails: Trails | null = null;
/** Trail density and waterfalls for the Outdoors filters (from the atlas's trails.json). */
export function setLandTrails(t: Trails | null) { trails = t; }
let wells: Wells | null = null;
/** The well registry, for the parcel report's chart of nearby wells (from the atlas's wells.json). */
export function setLandWells(w: Wells | null) { wells = w; }
type LandWells = { km: number; lowGpm: number; count: number; pid: string[]; n: number[]; depth: (number | null)[]; gpm: (number | null)[]; low: (number | null)[]; aq: number[]; own: number[] };
let landWells: LandWells | null = null;
let internet: Internet | null = null;
/** Broadband hexagons for the internet filters (from the atlas's internet.json). */
export function setLandInternet(i: Internet | null) { internet = i; }
let water: Water | null = null;
/** Beaches, boat launches and moorage for the Outdoors filters (from the atlas's water.json). */
export function setLandWater(w: Water | null) { water = w; }

type Cat = 'care' | 'er' | 'grocery' | 'gas';
type Poi = [string, number, number];
type LandJson = {
  source: string; count: number; threat: string[]; waterKinds: string[];
  names: { place: string[]; island: string[]; water: string[] };
  pois: Record<Cat, Poi[]>;
  cols: Record<string, (number | null)[]> & { pid: string[] };
  shapes: number[][][];
};

// ---------------------------------------------------------------------------------------------
// data, decoded to typed arrays (NaN = no value)

type Land = {
  n: number; json: LandJson; pid: string[];
  /** what's next door (land-neighbours.json), or null when it's missing or no longer lines up with land.json */
  nb: Neighbours | null;
  num: Record<string, Float32Array>;
  polys: { i: number; ring: [number, number][] }[];
  bounds: [number, number, number, number][];
};
let L: Land | null = null;
let loading: Promise<Land> | null = null;

const NUM = ['acres', 'lon', 'lat', 'place', 'island', 'town', 'townKm', 'water', 'front', 'waterM', 'waterName', 'elevLo', 'elevHi', 'slope', 'threat', 'flood', 'alr', 'pga', 'fires5', 'burn5', 'roadKm', 'airKm', 'indKm', 'sun', 'frost', 'care', 'careI', 'er', 'erI', 'grocery', 'groceryI', 'gas', 'gasI'];

async function load(): Promise<Land> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/land.json`);
  if (!res.ok) throw new Error(`land.json: HTTP ${res.status}`);
  const json = (await res.json()) as LandJson;
  const n = json.count;
  const num: Record<string, Float32Array> = {};
  for (const k of NUM) {
    const a = new Float32Array(n);
    const src = json.cols[k] ?? [];
    for (let i = 0; i < n; i++) a[i] = src[i] == null ? NaN : (src[i] as number);
    num[k] = a;
  }
  const polys: Land['polys'] = [];
  const bounds: Land['bounds'] = [];
  json.shapes.forEach((rings, i) => {
    let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const enc of rings) {
      const ring: [number, number][] = [];
      let x = 0, y = 0;
      for (let k = 0; k < enc.length; k += 2) {
        x += enc[k]; y += enc[k + 1];
        const p: [number, number] = [x / 1e5, y / 1e5];
        ring.push(p);
        b = [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])];
      }
      polys.push({ i, ring });
    }
    bounds.push(b);
  });
  // outdoors, worked out here from the trails data: km of footpath within 3 km, nearest waterfall
  const trail3 = new Float32Array(n).fill(NaN), fallKm = new Float32Array(n).fill(NaN), fallI = new Float32Array(n).fill(NaN);
  if (trails) {
    const kx = 111.32 * Math.cos((49.5 * Math.PI) / 180), ky = 110.54;
    const F = trails.falls;
    for (let i = 0; i < n; i++) {
      const lon = num.lon[i], lat = num.lat[i];
      trail3[i] = Math.round(trailMetresNear(trails, lon, lat, 3) / 100) / 10;
      let bd = Infinity, bi = -1;
      for (let k = 0; k < F.length; k++) { const d = Math.hypot((F[k].lon - lon) * kx, (F[k].lat - lat) * ky); if (d < bd) { bd = d; bi = k; } }
      if (bi >= 0) { fallKm[i] = Math.round(bd * 10) / 10; fallI[i] = bi; }
    }
  }
  num.trail3 = trail3; num.fallKm = fallKm; num.fallI = fallI;
  // water access, worked out here from water.json: straight-line km to the nearest beach, boat launch and moorage on the parcel's island
  for (const [k, ids] of [['beach', ['beach', 'lake', 'access']], ['launch', ['launch']], ['moor', ['marina', 'harbour']]] as const) {
    num[`${k}Km`] = new Float32Array(n).fill(NaN); num[`${k}I`] = new Float32Array(n).fill(NaN);
    if (!water) continue;
    const r = nearestFor(water, [...ids], num.lon, num.lat, (i) => json.names.island[num.island[i]] ?? 'Vancouver Island');
    for (let i = 0; i < n; i++) if (r.idx[i] >= 0) { num[`${k}Km`][i] = r.dist[i]; num[`${k}I`][i] = r.idx[i]; }
  }
  // well prospects (scripts/wells.mjs writes them to their own file, lined up with land.json by PID)
  const wl: Record<string, Float32Array> = Object.fromEntries(['wN', 'wDepth', 'wGpm', 'wLow', 'wAq', 'wOwn'].map((k) => [k, new Float32Array(n).fill(NaN)]));
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/land-wells.json`);
    const lw = res.ok ? ((await res.json()) as LandWells) : null;
    if (lw) {
      // same order as land.json, or (if land.json was rebuilt since) matched up by PID
      const same = lw.count === n && lw.pid.every((p, i) => p === json.cols.pid[i]);
      const at = same ? null : new Map(lw.pid.filter(Boolean).map((p, j) => [p, j]));
      for (let i = 0; i < n; i++) {
        const j = same ? i : json.cols.pid[i] ? at!.get(json.cols.pid[i]) : undefined;
        if (j == null) continue;
        const v = (a: (number | null)[]) => (a[j] == null ? NaN : (a[j] as number));
        wl.wN[i] = lw.n[j]; wl.wDepth[i] = v(lw.depth); wl.wGpm[i] = v(lw.gpm); wl.wLow[i] = v(lw.low); wl.wAq[i] = lw.aq[j]; wl.wOwn[i] = lw.own[j];
      }
      landWells = lw;
    }
  } catch { /* no well prospects: the Water supply filters stay at Any */ }
  Object.assign(num, wl);
  // internet, looked up here in the broadband hexagons: the 50/10 band (0–4), mobile service (0/1), measured home Mbps
  const net50 = new Float32Array(n).fill(NaN), cell = new Float32Array(n).fill(NaN), netMbps = new Float32Array(n).fill(NaN);
  if (internet) for (let i = 0; i < n; i++) {
    const p = parcelNet(internet, num.lon[i], num.lat[i]);
    if (p) { net50[i] = p.band; cell[i] = p.mobile ? 1 : 0; if (p.fixed != null) netMbps[i] = p.fixed; }
  }
  num.net50 = net50; num.cell = cell; num.netMbps = netMbps;
  await loadTsunami(json, num);
  // next door: parks, Crown land and logging around each parcel (optional; NaN where missing)
  const nb = await loadNeighbours(json.cols.pid);
  for (const k of ['parkM', 'parkI', 'crownM', 'planM', 'planK', 'lastCut', 'onCut', 'cut10'] as const) {
    const a = new Float32Array(n).fill(NaN);
    if (nb) for (let i = 0; i < n; i++) { const v = nb.cols[k][i]; if (v != null) a[i] = v; }
    num[k] = a;
  }
  // years since the last cutblock within 1 km; 100 when none is recorded
  num.since = new Float32Array(n).fill(NaN);
  if (nb) for (let i = 0; i < n; i++) num.since[i] = Number.isNaN(num.lastCut[i]) ? 100 : Math.max(0, Math.floor(nb.asOf) - num.lastCut[i]);
  return { n, json, pid: json.cols.pid, nb, num, polys, bounds };
}

/**
 * Per-parcel tsunami measures live in their own file (the `tsunami` stage), aligned with land.json's parcel
 * order and checked against a hash of its PIDs; if it's missing or stale the values stay NaN, so the
 * filter lets every parcel through. tsuLo: % of the parcel on low coastal ground; tsuHaz: % inside a
 * published hazard map (NaN where none covers it); tsuZone: notification zone index (A–E) of the nearest coast.
 */
let tsunamiOk = false;
let tsunamiScreen = 20;
async function loadTsunami(json: LandJson, num: Record<string, Float32Array>) {
  const n = json.count;
  for (const k of ['tsuLo', 'tsuHaz', 'tsuZone']) num[k] = new Float32Array(n).fill(NaN);
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/land-tsunami.json`);
    if (!res.ok) return;
    const t = (await res.json()) as { count: number; check: string; screenM: number; zone: number[]; lo: number[]; haz: (number | null)[] };
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(json.cols.pid.join('|'))))).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
    if (t.count !== n || t.check !== hash) { console.warn('land-tsunami.json is out of step with land.json: run `npm run data tsunami`'); return; }
    for (let i = 0; i < n; i++) {
      num.tsuLo[i] = t.lo[i];
      num.tsuHaz[i] = t.haz[i] ?? NaN;
      num.tsuZone[i] = t.zone[i] >= 0 ? t.zone[i] : NaN;
    }
    tsunamiOk = true;
    tsunamiScreen = t.screenM;
  } catch { /* optional data */ }
}
/** Share of a parcel in tsunami hazard: the published map where one covers it, else low coastal ground. */
const tsuShare = (i: number) => { const n = L!.num; return Number.isNaN(n.tsuHaz[i]) ? n.tsuLo[i] : n.tsuHaz[i]; };
/** Acres of the parcel outside it. */
const tsuDry = (i: number) => L!.num.acres[i] * (1 - tsuShare(i) / 100);
const TSU_ROOM_ACRES = 1;

// ---------------------------------------------------------------------------------------------
// filters

type WaterMode = 'any' | 'front' | 'near';
type F = {
  acres: number; water: WaterMode; kinds: [boolean, boolean, boolean]; front: number; near: number;
  care: number; careKind: 'any' | 'er'; grocery: number; gas: number;
  road: number; air: number; ind: number;
  threat: number; unrated: boolean; flood: boolean; high: number; pga: number; fires: number; tsunami: 'any' | 'room' | 'clear';
  slope: number; alr: 'any' | 'avoid' | 'only'; islands: 'any' | 'main' | 'islands';
  trail: number; fall: number; beach: number; launch: number;
  wGpm: number; wDepth: number; wLow: number; aquifer: 'any' | 'over';
  net: 'any' | '25' | '50' | '75'; cell: 'any' | 'yes';
  park: 'any' | 'only'; crown: 'any' | 'only'; logged: number; plan: 'any' | 'avoid';
  budget: number;
};
/** "Backs onto": the land is within this many metres of the parcel (the 50 m grid, and a road or creek between). */
const NEXT_DOOR_M = 100;
const ANY_MIN = 120, ANY_FIRES = 200, ANY_SLOPE = 45, ANY_PGA = 100, ANY_FALL = 40, ANY_SHORE = 30, ANY_WDEPTH = 250, ANY_WLOW = 100;
const BRIEF: F = {
  acres: 10, water: 'front', kinds: [true, true, true], front: 30, near: 500,
  care: 45, careKind: 'any', grocery: 45, gas: 45,
  road: 0.3, air: 3, ind: 1,
  threat: 2, unrated: true, flood: true, high: 10, pga: ANY_PGA, fires: ANY_FIRES, tsunami: 'room',
  slope: ANY_SLOPE, alr: 'any', islands: 'any',
  trail: 0, fall: ANY_FALL, beach: ANY_SHORE, launch: ANY_SHORE,
  wGpm: 0, wDepth: ANY_WDEPTH, wLow: ANY_WLOW, aquifer: 'any',
  net: 'any', cell: 'any',
  park: 'any', crown: 'any', logged: 0, plan: 'any',
  budget: 2_000_000,
};
const LOOSE: F = { ...BRIEF, acres: 5, water: 'any', care: ANY_MIN, grocery: ANY_MIN, gas: ANY_MIN, road: 0, air: 0, ind: 0, threat: 4, flood: false, high: 0, tsunami: 'any' };
const STORE = 'island-atlas:land-filters';
const SHORT = 'island-atlas:shortlist';

let f: F = { ...BRIEF, kinds: [...BRIEF.kinds] }; // own copy: the water-kind buttons toggle it in place
// Saved filters from an older version may lack keys or carry stale ones: keep only known keys whose
// type still matches, so a bad entry falls back to the brief instead of breaking the rail.
try {
  const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  if (s && typeof s === 'object') {
    for (const k of Object.keys(BRIEF) as (keyof F)[]) {
      const v = s[k], d = BRIEF[k];
      if (Array.isArray(d) ? Array.isArray(v) && v.length === d.length && v.every((x: unknown) => typeof x === 'boolean') : typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v))) (f as any)[k] = v;
    }
  }
} catch { /* storage unavailable */ }
const saveF = () => { try { localStorage.setItem(STORE, JSON.stringify(f)); } catch { /* ignore */ } };

type Short = Record<string, { price?: number; note?: string; t: number }>;
let shortlist: Short = {};
try { const s = JSON.parse(localStorage.getItem(SHORT) ?? '{}'); if (s && typeof s === 'object' && !Array.isArray(s)) shortlist = s; } catch { /* ignore */ }
const saveShort = () => { try { localStorage.setItem(SHORT, JSON.stringify(shortlist)); } catch { /* ignore */ } };
const keyOf = (i: number) => L!.pid[i] || `${L!.num.lon[i].toFixed(5)},${L!.num.lat[i].toFixed(5)}`;

/** One bit per filter; the funnel groups them into stages. */
const BIT = { acres: 0, water: 1, care: 2, grocery: 3, gas: 4, road: 5, air: 6, ind: 7, threat: 8, flood: 9, high: 10, pga: 11, fires: 12, slope: 13, alr: 14, islands: 15, trail: 16, fall: 17, wGpm: 18, wDepth: 19, wLow: 20, aquifer: 21, net: 22, cell: 23, tsunami: 24, park: 25, crown: 26, logged: 27, plan: 28, beach: 29, launch: 30 } as const;
type Bit = keyof typeof BIT;
const STAGES: { id: string; label: string; icon: string; bits: Bit[]; c: string }[] = [
  { id: 'size', label: 'Size', icon: '◇', bits: ['acres'], c: '#a3e635' },
  { id: 'water', label: 'Water', icon: '≋', bits: ['water'], c: '#38bdf8' },
  { id: 'reach', label: 'Reach', icon: '✚', bits: ['care', 'grocery', 'gas', 'net', 'cell'], c: '#818cf8' },
  { id: 'quiet', label: 'Quiet', icon: '☾', bits: ['road', 'air', 'ind'], c: '#c084fc' },
  { id: 'safe', label: 'Safe', icon: '⛨', bits: ['threat', 'flood', 'tsunami', 'high', 'pga', 'fires'], c: '#fb923c' },
  { id: 'wells', label: 'Wells', icon: '⇣', bits: ['wGpm', 'wDepth', 'wLow', 'aquifer'], c: '#19d3c5' },
  { id: 'outdoors', label: 'Outdoors', icon: '⛰', bits: ['trail', 'fall', 'beach', 'launch'], c: '#34d399' },
  { id: 'next', label: 'Next door', icon: '❦', bits: ['park', 'crown', 'logged', 'plan'], c: '#e9b872' },
  { id: 'rules', label: 'Place', icon: '⌂', bits: ['slope', 'alr', 'islands'], c: '#f472b6' },
];

const mins = (i: number, cat: Cat) => L!.num[cat][i];
const careMin = (i: number) => (f.careKind === 'er' ? mins(i, 'er') : mins(i, 'care'));
/** The lowest ISED 50/10 band each internet chip accepts (bands: 1 under 25%, 2 25–50%, 3 50–75%, 4 over 75% of homes). */
const NET_BAND = { '25': 2, '50': 3, '75': 4 } as const;
const fails = (v: number, max: number, any: number) => max < any && !(v <= max); // NaN fails unless "any"

function maskOf(i: number): number {
  const n = L!.num;
  let m = 0;
  if (!(n.acres[i] >= f.acres)) m |= 1 << BIT.acres;
  if (f.water !== 'any') {
    const k = n.water[i];
    const ok = f.water === 'front' ? k > 0 && f.kinds[k - 1] && n.front[i] >= f.front : n.waterM[i] <= f.near && (n.water[i] === 0 || f.kinds[n.water[i] - 1]);
    if (!ok) m |= 1 << BIT.water;
  }
  if (fails(careMin(i), f.care, ANY_MIN)) m |= 1 << BIT.care;
  if (fails(mins(i, 'grocery'), f.grocery, ANY_MIN)) m |= 1 << BIT.grocery;
  if (fails(mins(i, 'gas'), f.gas, ANY_MIN)) m |= 1 << BIT.gas;
  if (n.roadKm[i] < f.road) m |= 1 << BIT.road;
  if (n.airKm[i] < f.air) m |= 1 << BIT.air;
  if (n.indKm[i] < f.ind) m |= 1 << BIT.ind;
  const t = n.threat[i];
  if (Number.isNaN(t) ? !f.unrated : t > f.threat) m |= 1 << BIT.threat;
  if (f.flood && n.flood[i] > 0) m |= 1 << BIT.flood;
  if (f.high > 0 && !(n.elevHi[i] >= f.high)) m |= 1 << BIT.high;
  // missing values (data not built) pass, never penalized
  if (f.tsunami !== 'any' && !Number.isNaN(tsuShare(i)) && (f.tsunami === 'clear' ? tsuShare(i) > 0 : tsuDry(i) < TSU_ROOM_ACRES)) m |= 1 << BIT.tsunami;
  if (fails(n.pga[i], f.pga, ANY_PGA)) m |= 1 << BIT.pga;
  if (fails(n.fires5[i], f.fires, ANY_FIRES)) m |= 1 << BIT.fires;
  if (fails(n.slope[i], f.slope, ANY_SLOPE)) m |= 1 << BIT.slope;
  if ((f.alr === 'avoid' && n.alr[i] >= 50) || (f.alr === 'only' && n.alr[i] < 50)) m |= 1 << BIT.alr;
  if ((f.islands === 'main' && n.island[i] !== 0) || (f.islands === 'islands' && n.island[i] === 0)) m |= 1 << BIT.islands;
  if (f.trail > 0 && !(n.trail3[i] >= f.trail)) m |= 1 << BIT.trail;
  if (fails(n.fallKm[i], f.fall, ANY_FALL)) m |= 1 << BIT.fall;
  if (fails(n.beachKm[i], f.beach, ANY_SHORE)) m |= 1 << BIT.beach;
  if (fails(n.launchKm[i], f.launch, ANY_SHORE)) m |= 1 << BIT.launch;
  if (f.wGpm > 0 && !(n.wGpm[i] >= f.wGpm)) m |= 1 << BIT.wGpm;
  if (fails(n.wDepth[i], f.wDepth, ANY_WDEPTH)) m |= 1 << BIT.wDepth;
  if (fails(n.wLow[i], f.wLow, ANY_WLOW)) m |= 1 << BIT.wLow;
  if (f.aquifer === 'over' && !(n.wAq[i] >= 0)) m |= 1 << BIT.aquifer;
  if (f.net !== 'any' && !(n.net50[i] >= NET_BAND[f.net])) m |= 1 << BIT.net;
  if (f.cell === 'yes' && !(n.cell[i] > 0)) m |= 1 << BIT.cell;
  if (L!.nb) {
    if (f.park === 'only' && !(n.parkM[i] <= NEXT_DOOR_M)) m |= 1 << BIT.park;
    if (f.crown === 'only' && !(n.crownM[i] <= NEXT_DOOR_M)) m |= 1 << BIT.crown;
    if (f.logged > 0 && n.since[i] < f.logged) m |= 1 << BIT.logged;
    if (f.plan === 'avoid' && !Number.isNaN(n.planM[i])) m |= 1 << BIT.plan;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// scoring: how comfortably a parcel clears the bar, for ranking and for the height of its column

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const nz = (v: number, d: number) => (Number.isNaN(v) ? d : v);
function parts(i: number) {
  const n = L!.num;
  const reachMin = Math.max(nz(careMin(i), 120), nz(mins(i, 'grocery'), 120), nz(mins(i, 'gas'), 120));
  const t = n.threat[i];
  return {
    size: clamp01(Math.log(n.acres[i] / 5) / Math.log(40)),
    water: n.water[i] > 0 ? 0.6 + 0.4 * clamp01(n.front[i] / 400) : 0.35 * clamp01(1 - n.waterM[i] / 1500),
    reach: clamp01(1 - (reachMin - 10) / 80),
    quiet: 0.5 * clamp01(n.roadKm[i] / 2) + 0.25 * clamp01(n.airKm[i] / 10) + 0.25 * clamp01(n.indKm[i] / 5),
    safety: 0.45 * (Number.isNaN(t) ? 0.7 : [1, 0.9, 0.65, 0.3, 0][t]) + 0.15 * (n.flood[i] ? 0 : 1) + 0.15 * clamp01(nz(n.elevHi[i], 0) / 30) + 0.15 * clamp01(1 - nz(n.fires5[i], 0) / 40) + 0.1 * clamp01(1 - (nz(n.pga[i], 50) - 30) / 50),
    sun: clamp01((nz(n.sun[i], 1750) - 1650) / 500),
  };
}
const W = { size: 0.15, water: 0.2, reach: 0.2, quiet: 0.15, safety: 0.22, sun: 0.08 };
const scoreOf = (i: number) => { const p = parts(i); return Math.round(100 * (Object.keys(W) as (keyof typeof W)[]).reduce((s, k) => s + W[k] * p[k], 0)); };

// ---------------------------------------------------------------------------------------------
// state of a run of the finder

let masks = new Uint32Array(0);
let scores = new Uint8Array(0);
let matches: number[] = [];
let stageCounts: number[] = [];
let version = 0;
let selected: number | null = null;
let hovered: number | null = null;
let tab: 'matches' | 'short' = 'matches';
let satellite = false;
let opened = false;
let ctx: { map: maplibregl.Map; panel: HTMLElement; beforeId?: string; onClose: () => void } | null = null;

function recompute() {
  const n = L!.n;
  if (masks.length !== n) { masks = new Uint32Array(n); scores = new Uint8Array(n); }
  matches = [];
  const stageMask = STAGES.map((_, s) => STAGES.slice(0, s + 1).flatMap((st) => st.bits).reduce((m, b) => m | (1 << BIT[b]), 0));
  stageCounts = STAGES.map(() => 0);
  for (let i = 0; i < n; i++) {
    const m = maskOf(i);
    masks[i] = m;
    for (let s = 0; s < STAGES.length; s++) { if (m & stageMask[s]) break; stageCounts[s]++; }
    if (!m) { scores[i] = scoreOf(i); matches.push(i); }
  }
  matches.sort((a, b) => scores[b] - scores[a] || L!.num.acres[b] - L!.num.acres[a]);
  version++;
}

// ---------------------------------------------------------------------------------------------
// map layers

const RAMP = d3.scaleLinear<string>().domain([30, 60, 85]).range(['#22d3ee', '#a3e635', '#fde047']).clamp(true);
const rgb = (s: number, a = 255): [number, number, number, number] => { const c = d3.rgb(RAMP(s)); return [c.r, c.g, c.b, a]; };
const CAT_COLOR: Record<Cat, [number, number, number]> = { care: [129, 140, 248], er: [244, 114, 182], grocery: [74, 222, 128], gas: [251, 191, 36] };
const CAT_LABEL: Record<Cat, string> = { care: 'Health care', er: '24/7 emergency', grocery: 'Groceries', gas: 'Gas' };
const CAT_ICON: Record<Cat, string> = { care: '✚', er: '✱', grocery: '🛒', gas: '⛽' };

let cache: { v: number; sel: number | null; hov: number | null; zoomBand: number; layers: Layer[] } | null = null;
// layer data kept between rebuilds, so hovering doesn't make deck.gl re-upload every parcel
let allIdx: number[] = [];
let matchPolys: { v: number; data: Land['polys'] } = { v: -1, data: [] };

export function landLayers(): Layer[] {
  if (!L || !opened) return [];
  const zoom = ctx!.map.getZoom();
  const zoomBand = zoom < 9.5 ? 0 : zoom < 12 ? 1 : 2;
  if (cache && cache.v === version && cache.sel === selected && cache.hov === hovered && cache.zoomBand === zoomBand) return withPulse(cache.layers);
  const n = L.num;
  if (allIdx.length !== L.n) allIdx = Array.from({ length: L.n }, (_, i) => i);
  if (matchPolys.v !== version) { const set = new Set(matches); matchPolys = { v: version, data: L.polys.filter((p) => set.has(p.i)) }; }
  const top = matches.slice(0, 12);
  const out: Layer[] = [
    // every parcel as dust, so the matches read as a selection from the whole island
    new ScatterplotLayer<number>({
      id: 'land-dust', data: allIdx,
      getPosition: (i) => [n.lon[i], n.lat[i]], getRadius: 60, radiusMinPixels: 1.1, radiusMaxPixels: 2.2,
      getFillColor: [150, 170, 210, 55], parameters: { depthCompare: 'always' } as any, visible: zoomBand < 2,
    }),
    new PolygonLayer<Land['polys'][number]>({
      id: 'land-lines', data: L.polys, getPolygon: (d) => d.ring, filled: false, stroked: true,
      getLineColor: [170, 190, 230, 70], lineWidthMinPixels: 0.6, visible: zoomBand === 2, pickable: true,
    }),
    new PolygonLayer<Land['polys'][number]>({
      id: 'land-match', data: matchPolys.data, getPolygon: (d) => d.ring,
      // columns at mid zoom, where a parcel is a few pixels across; flat and see-through up close
      extruded: zoomBand === 1, wireframe: false, getElevation: (d) => 15 + scores[d.i] ** 1.5 * 0.45,
      getFillColor: (d) => rgb(scores[d.i], zoomBand === 2 ? (d.i === selected ? 40 : 70) : 170), getLineColor: (d) => rgb(scores[d.i], 255),
      lineWidthUnits: 'pixels', getLineWidth: zoomBand === 2 ? 2 : 1,
      stroked: true, lineWidthMinPixels: 1, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 90],
      material: { ambient: 0.55, diffuse: 0.6, shininess: 60 },
      transitions: { getElevation: { duration: 700, easing: d3.easeCubicOut, enter: () => [0] }, getFillColor: 500 },
      updateTriggers: { getElevation: version, getFillColor: [version, selected, zoomBand], getLineColor: version, getLineWidth: zoomBand },
      visible: zoomBand > 0,
    }),
    // glowing points for the matches, sized by acreage: a soft halo and a bright core
    new ScatterplotLayer<number>({
      id: 'land-halo', data: matches, getPosition: (i) => [n.lon[i], n.lat[i]],
      getRadius: (i) => 260 + Math.sqrt(n.acres[i]) * 90, radiusMinPixels: 5, radiusMaxPixels: 26,
      getFillColor: (i) => rgb(scores[i], 46), parameters: { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false, depthCompare: 'always' } as any,
      transitions: { getRadius: { duration: 900, easing: d3.easeBackOut, enter: () => [0] } }, updateTriggers: { getFillColor: version },
      visible: zoomBand < 2,
    }),
    new ScatterplotLayer<number>({
      id: 'land-core', data: matches, getPosition: (i) => [n.lon[i], n.lat[i]],
      getRadius: (i) => 90 + Math.sqrt(n.acres[i]) * 25, radiusMinPixels: 2.2, radiusMaxPixels: 8,
      getFillColor: (i) => rgb(scores[i], 240), stroked: true, getLineColor: [6, 10, 18, 220], lineWidthMinPixels: 0.8,
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 255],
      parameters: { depthCompare: 'always' } as any,
      transitions: { getRadius: { duration: 900, easing: d3.easeBackOut, enter: () => [0] } }, updateTriggers: { getFillColor: version },
      visible: zoomBand < 2,
    }),
    new TextLayer<number>({
      id: 'land-ranks', data: top, getPosition: (i) => [n.lon[i], n.lat[i]], getText: (i) => String(top.indexOf(i) + 1),
      getSize: 12, getColor: [8, 12, 20, 255], background: true, getBackgroundColor: (i) => rgb(scores[i], 245), backgroundPadding: [5, 2],
      fontFamily: 'Inter, sans-serif', fontWeight: 800, getPixelOffset: [0, -16], parameters: { depthCompare: 'always' } as any,
      updateTriggers: { getText: version, getBackgroundColor: version }, characterSet: '0123456789',
    } as any),
  ];

  const focus = selected ?? hovered;
  if (focus != null) {
    out.push(new PolygonLayer<Land['polys'][number]>({
      id: 'land-focus', data: L.polys.filter((p) => p.i === focus), getPolygon: (d) => d.ring, filled: true, stroked: true,
      getFillColor: [255, 255, 255, 30], getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 2.5, parameters: { depthCompare: 'always' } as any,
    }));
  }
  if (selected != null) {
    const i = selected;
    const src: [number, number] = [n.lon[i], n.lat[i]];
    const trips = (['care', 'er', 'grocery', 'gas'] as Cat[]).map((cat) => {
      const k = L!.num[`${cat}I`][i];
      const p = Number.isNaN(k) ? null : L!.json.pois[cat][k];
      return p ? { cat, p, min: mins(i, cat) } : null;
    }).filter(Boolean) as { cat: Cat; p: Poi; min: number }[];
    out.push(
      new ArcLayer<(typeof trips)[number]>({
        id: 'land-arcs', data: trips, getSourcePosition: () => src, getTargetPosition: (d) => [d.p[1], d.p[2]],
        getSourceColor: [255, 255, 255, 230], getTargetColor: (d) => [...CAT_COLOR[d.cat], 255] as any, getWidth: 3, getHeight: 0.6,
        greatCircle: false, transitions: { getHeight: { duration: 900, enter: () => [0] } } as any,
      }),
      new ScatterplotLayer<(typeof trips)[number]>({
        id: 'land-pois', data: trips, getPosition: (d) => [d.p[1], d.p[2]], getRadius: 200, radiusMinPixels: 6,
        getFillColor: (d) => [...CAT_COLOR[d.cat], 255] as any, stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 2,
        parameters: { depthCompare: 'always' } as any,
      }),
      new TextLayer<(typeof trips)[number]>({
        id: 'land-poi-labels', data: trips, getPosition: (d) => [d.p[1], d.p[2]], getText: (d) => `${CAT_LABEL[d.cat]} · ${d.min} min\n${d.p[0]}`,
        getSize: 12, getColor: [240, 244, 252, 255], outlineWidth: 3, outlineColor: [6, 10, 18, 240], fontSettings: { sdf: true },
        fontFamily: 'Inter, sans-serif', fontWeight: 600, characterSet: 'auto', getPixelOffset: [0, -24], getTextAnchor: 'middle', parameters: { depthCompare: 'always' } as any,
      } as any),
    );
  }
  cache = { v: version, sel: selected, hov: hovered, zoomBand, layers: out };
  return withPulse(out);
}

/** A ring pulsing around the selected parcel, rebuilt each frame. */
function withPulse(layers: Layer[]): Layer[] {
  if (selected == null || !L) return layers;
  const p = (performance.now() % 1800) / 1800;
  return [...layers, new ScatterplotLayer<number>({
    id: 'land-pulse', data: [selected], getPosition: (i) => [L!.num.lon[i], L!.num.lat[i]],
    getRadius: 150 + p * 900, filled: false, stroked: true, lineWidthMinPixels: 2, getLineColor: [255, 255, 255, 255 * (1 - p)],
    updateTriggers: { getRadius: p, getLineColor: p }, parameters: { depthCompare: 'always' } as any,
  })];
}

const pickIndex = (info: PickingInfo): number | null => {
  const o: any = info.object;
  if (o == null || !info.layer?.id.startsWith('land-')) return null;
  return typeof o === 'number' ? o : typeof o.i === 'number' ? o.i : null;
};

export function landHover(info: PickingInfo): string | null {
  const i = pickIndex(info);
  if (i !== hovered) { hovered = i; highlightCard(i); }
  if (i == null) return null;
  const n = L!.num;
  const ok = masks[i] === 0;
  return `<b>${n.acres[i].toFixed(1)} acres${n.water[i] ? ` · ${L!.json.waterKinds[n.water[i]]} frontage` : ''}</b><br>
    <span class="tk">${placeOf(i)}</span><br>
    <span class="tk">✚</span> <span class="tv">${minText(careMin(i))}</span> <span class="tk">🛒</span> <span class="tv">${minText(mins(i, 'grocery'))}</span> <span class="tk">⛽</span> <span class="tv">${minText(mins(i, 'gas'))}</span><br>
    ${ok ? `<span class="tk">Score</span> <span class="tv">${scores[i]}</span> · <span class="tk">click for details</span>` : `<span class="tk">Filtered out by: ${failedNames(i).join(', ')}</span>`}`;
}

export function landClick(info: PickingInfo): boolean {
  const i = pickIndex(info);
  if (i == null) return false;
  select(i);
  return true;
}

// ---------------------------------------------------------------------------------------------
// text helpers (they return HTML: place, water and shop names come from OpenStreetMap, so they're escaped)

const minText = (v: number) => (Number.isNaN(v) ? 'no road' : `${v} min`);
const placeOf = (i: number) => {
  const n = L!.num, names = L!.json.names;
  const island = names.island[n.island[i]], town = esc(names.place[n.town[i]]);
  const near = n.townKm[i] < 1.5 ? `in ${town}` : `${n.townKm[i].toFixed(0)} km from ${town}`;
  return island === 'Vancouver Island' ? near : `${esc(island)} · ${near}`;
};
const waterText = (i: number) => {
  const n = L!.num, names = L!.json;
  const name = n.waterName[i] >= 0 ? esc(names.names.water[n.waterName[i]]) : '';
  if (n.water[i] > 0) return `${names.waterKinds[n.water[i]]} frontage${name && name !== 'Ocean' ? ` on ${name}` : ''}`;
  return n.waterM[i] < 3000 ? `${fmtDist(n.waterM[i])} to water${name && name !== 'Ocean' ? ` (${name})` : ''}` : 'no water within 3 km';
};
const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
const BIT_NAME: Record<Bit, string> = {
  acres: 'size', water: 'water', care: 'health care', grocery: 'groceries', gas: 'gas', road: 'busy road', air: 'airport', ind: 'industry',
  threat: 'wildfire threat', flood: 'floodplain', high: 'high ground', pga: 'shaking', fires: 'fire history', slope: 'slope', alr: 'farmland reserve', islands: 'island', trail: 'trails nearby', fall: 'waterfall distance', beach: 'beach distance', launch: 'boat launch distance', tsunami: 'tsunami hazard',
  wGpm: 'well yield', wDepth: 'well depth', wLow: 'low-yield wells', aquifer: 'aquifer', net: '50/10 internet', cell: 'mobile service',
  park: 'park next door', crown: 'Crown land next door', logged: 'recent logging nearby', plan: 'planned logging nearby',
};
const failedNames = (i: number) => (Object.keys(BIT) as Bit[]).filter((b) => masks[i] & (1 << BIT[b])).map((b) => BIT_NAME[b]);

// ---------------------------------------------------------------------------------------------
// the filter rail: every row is a control plus a crossfilter histogram

type Row =
  | { kind: 'range'; bit: Bit; key: keyof F; label: string; hint: string; min: number; max: number; step: number; log?: boolean; dir: 'min' | 'max'; any?: number; value: (i: number) => number; show: (v: number) => string }
  | { kind: 'chips'; bit: Bit; key: keyof F; label: string; hint?: string; options: [string, string][] }
  | { kind: 'custom'; bit: Bit; label: string; hint?: string; render: (el: HTMLElement) => void };
type Section = { id: string; title: string; icon: string; c: string; rows: Row[] };

const minutesRow = (bit: Bit, key: 'care' | 'grocery' | 'gas', label: string, hint: string, value: (i: number) => number): Row => ({
  kind: 'range', bit, key, label, hint, min: 10, max: ANY_MIN, step: 5, dir: 'max', any: ANY_MIN, value, show: (v) => (v >= ANY_MIN ? 'Any' : `≤ ${v} min`),
});

const SECTIONS: Section[] = [
  {
    id: 'size', title: 'The land', icon: '◇', c: '#a3e635', rows: [
      { kind: 'range', bit: 'acres', key: 'acres', label: 'Size', hint: 'Parcel area from ParcelMap BC', min: 5, max: 640, step: 1, log: true, dir: 'min', value: (i) => L!.num.acres[i], show: (v) => `≥ ${Math.round(v)} acres` },
      { kind: 'range', bit: 'slope', key: 'slope', label: 'Gentle ground', hint: 'Average slope across the parcel (terrain at ~50 m)', min: 2, max: ANY_SLOPE, step: 1, dir: 'max', any: ANY_SLOPE, value: (i) => L!.num.slope[i], show: (v) => (v >= ANY_SLOPE ? 'Any' : `≤ ${v}° slope`) },
      { kind: 'chips', bit: 'alr', key: 'alr', label: 'Farmland reserve', hint: 'Agricultural Land Reserve: farming protected, building and subdividing restricted', options: [['any', 'Either'], ['avoid', 'Avoid ALR'], ['only', 'ALR only']] },
      { kind: 'chips', bit: 'islands', key: 'islands', label: 'Island', hint: 'The Gulf and Discovery islands need a ferry for most trips', options: [['any', 'Anywhere'], ['main', 'Vancouver Island'], ['islands', 'Small islands']] },
    ],
  },
  {
    id: 'water', title: 'Waterfront', icon: '≋', c: '#38bdf8', rows: [
      { kind: 'custom', bit: 'water', label: 'Water', render: renderWater },
    ],
  },
  {
    id: 'reach', title: 'Within reach', icon: '✚', c: '#818cf8', rows: [
      minutesRow('care', 'care', 'Health care', 'Drive to the nearest hospital, health centre or clinic (or 24/7 ER), on OpenStreetMap roads', careMin),
      { kind: 'chips', bit: 'care', key: 'careKind', label: '', options: [['any', 'Any clinic or hospital'], ['er', '24/7 emergency room']] },
      minutesRow('grocery', 'grocery', 'Groceries', 'Drive to the nearest supermarket or grocery store', (i) => mins(i, 'grocery')),
      minutesRow('gas', 'gas', 'Gas', 'Drive to the nearest gas station', (i) => mins(i, 'gas')),
      { kind: 'chips', bit: 'net', key: 'net', label: '50/10 Mbps internet', hint: 'Share of homes in the parcel’s ~25 km² hexagon that providers say can get 50/10 Mbps (ISED National Broadband Data)', options: [['any', 'Any'], ['25', '25%+ of homes'], ['50', 'Over half'], ['75', 'Over 75%']] },
      { kind: 'chips', bit: 'cell', key: 'cell', label: 'Mobile coverage', hint: 'A mobile (LTE/5G) provider reports service in the parcel’s hexagon (ISED National Broadband Data)', options: [['any', 'Any'], ['yes', 'Mobile reported']] },
    ],
  },
  {
    id: 'quiet', title: 'Quiet', icon: '☾', c: '#c084fc', rows: [
      { kind: 'range', bit: 'road', key: 'road', label: 'Away from busy roads', hint: 'From the quietest spot on the land to the nearest highway or main road', min: 0, max: 3, step: 0.1, dir: 'min', value: (i) => L!.num.roadKm[i], show: (v) => (v <= 0 ? 'Any' : `≥ ${v.toFixed(1)} km`) },
      { kind: 'range', bit: 'air', key: 'air', label: 'Away from airports', hint: 'Airports, airstrips and float-plane bases (BC airports list)', min: 0, max: 20, step: 0.5, dir: 'min', value: (i) => L!.num.airKm[i], show: (v) => (v <= 0 ? 'Any' : `≥ ${v} km`) },
      { kind: 'range', bit: 'ind', key: 'ind', label: 'Away from industry', hint: 'Industrial land and quarries mapped in OpenStreetMap', min: 0, max: 8, step: 0.5, dir: 'min', value: (i) => L!.num.indKm[i], show: (v) => (v <= 0 ? 'Any' : `≥ ${v} km`) },
    ],
  },
  {
    id: 'safe', title: 'Safety', icon: '⛨', c: '#fb923c', rows: [
      { kind: 'custom', bit: 'threat', label: 'Wildfire threat', hint: 'BC Wildfire Service Provincial Strategic Threat Analysis: the worst rating on the parcel or in the forest within 500 m of it', render: renderThreat },
      { kind: 'range', bit: 'fires', key: 'fires', label: 'Fire history nearby', hint: 'Wildfire starts within 5 km since 1990', min: 0, max: ANY_FIRES, step: 1, dir: 'max', any: ANY_FIRES, value: (i) => L!.num.fires5[i], show: (v) => (v >= ANY_FIRES ? 'Any' : `≤ ${v} starts`) },
      { kind: 'custom', bit: 'flood', label: 'Floodplain', hint: 'Designated floodplain maps (BC, mostly 1980s–90s; not every river is mapped)', render: renderFlood },
      { kind: 'custom', bit: 'tsunami', label: 'Tsunami', render: renderTsunami },
      { kind: 'range', bit: 'high', key: 'high', label: 'High ground', hint: 'Highest point on the parcel above sea level: room to build above storm surge, tsunami run-up and sea-level rise', min: 0, max: 60, step: 1, dir: 'min', value: (i) => L!.num.elevHi[i], show: (v) => (v <= 0 ? 'Any' : `≥ ${v} m`) },
      { kind: 'range', bit: 'pga', key: 'pga', label: 'Earthquake shaking', hint: 'NRCan 2020 hazard: peak shaking with a 2% chance in 50 years, % of gravity', min: 30, max: ANY_PGA, step: 1, dir: 'max', any: ANY_PGA, value: (i) => L!.num.pga[i], show: (v) => (v >= ANY_PGA ? 'Any' : `≤ ${v}% g`) },
    ],
  },
  {
    id: 'wells', title: 'Water supply', icon: '⇣', c: '#19d3c5', rows: [
      { kind: 'range', bit: 'wGpm', key: 'wGpm', label: 'Well yield nearby', hint: 'Median yield, when drilled, of registered wells within 1 km of the parcel (GWELLS); parcels with no tested well nearby drop out', min: 0, max: 20, step: 0.5, dir: 'min', value: (i) => L!.num.wGpm[i], show: (v) => (v <= 0 ? 'Any' : `≥ ${v} gpm`) },
      { kind: 'range', bit: 'wDepth', key: 'wDepth', label: 'Well depth nearby', hint: 'Median depth of registered wells within 1 km: deeper wells cost more to drill and pump', min: 10, max: ANY_WDEPTH, step: 5, dir: 'max', any: ANY_WDEPTH, value: (i) => L!.num.wDepth[i], show: (v) => (v >= ANY_WDEPTH ? 'Any' : `≤ ${v} m`) },
      { kind: 'range', bit: 'wLow', key: 'wLow', label: 'Few low-yield wells', hint: 'Share of tested wells within 1 km that gave under 2 US gallons a minute when drilled', min: 0, max: ANY_WLOW, step: 5, dir: 'max', any: ANY_WLOW, value: (i) => L!.num.wLow[i], show: (v) => (v >= ANY_WLOW ? 'Any' : `≤ ${v}% low`) },
      { kind: 'chips', bit: 'aquifer', key: 'aquifer', label: 'Mapped aquifer', hint: 'The parcel centre lies over an aquifer mapped by the province', options: [['any', 'Either'], ['over', 'Over a mapped aquifer']] },
    ],
  },
  {
    id: 'outdoors', title: 'Outdoors', icon: '⛰', c: '#34d399', rows: [
      { kind: 'range', bit: 'trail', key: 'trail', label: 'Trails to walk', hint: 'Km of mapped footpath and hiking trail within 3 km of the parcel (OpenStreetMap)', min: 0, max: 40, step: 0.5, dir: 'min', value: (i) => L!.num.trail3[i], show: (v) => (v <= 0 ? 'Any' : `≥ ${v.toFixed(v < 10 ? 1 : 0)} km within 3 km`) },
      { kind: 'range', bit: 'fall', key: 'fall', label: 'A waterfall nearby', hint: 'Straight-line distance to the nearest mapped waterfall (OpenStreetMap)', min: 0.5, max: ANY_FALL, step: 0.5, dir: 'max', any: ANY_FALL, value: (i) => L!.num.fallKm[i], show: (v) => (v >= ANY_FALL ? 'Any' : `within ${v.toFixed(v < 10 ? 1 : 0)} km`) },
      { kind: 'range', bit: 'beach', key: 'beach', label: 'A beach nearby', hint: 'Straight-line distance to the nearest mapped public beach or beach access, sea or lake, on the parcel’s own island (OpenStreetMap)', min: 0.5, max: ANY_SHORE, step: 0.5, dir: 'max', any: ANY_SHORE, value: (i) => L!.num.beachKm[i], show: (v) => (v >= ANY_SHORE ? 'Any' : `within ${v.toFixed(v < 10 ? 1 : 0)} km`) },
      { kind: 'range', bit: 'launch', key: 'launch', label: 'A boat launch nearby', hint: 'Straight-line distance to the nearest mapped public boat launch on the parcel’s own island (OpenStreetMap)', min: 0.5, max: ANY_SHORE, step: 0.5, dir: 'max', any: ANY_SHORE, value: (i) => L!.num.launchKm[i], show: (v) => (v >= ANY_SHORE ? 'Any' : `within ${v.toFixed(v < 10 ? 1 : 0)} km`) },
    ],
  },
  {
    id: 'next', title: 'Next door', icon: '❦', c: '#e9b872', rows: [
      { kind: 'custom', bit: 'park', label: '', render: renderNextDoorNote },
      { kind: 'chips', bit: 'park', key: 'park', label: 'A park next door', hint: 'Backs onto a provincial, national or regional park, ecological reserve or protected area: land that stays wild', options: [['any', 'Either'], ['only', 'Backs onto a park']] },
      { kind: 'chips', bit: 'crown', key: 'crown', label: 'Crown land next door', hint: 'Backs onto provincial Crown land (Generalized Forest Cover Ownership). Good for privacy, but Crown land can be logged, leased or sold', options: [['any', 'Either'], ['only', 'Backs onto Crown land']] },
      { kind: 'range', bit: 'logged', key: 'logged', label: 'No recent logging nearby', hint: 'Years since the last mapped cutblock within 1 km of the parcel or on it (BC consolidated cutblocks). The far right is no logging on record', min: 0, max: 60, step: 1, dir: 'min', value: (i) => L!.num.since[i], show: (v) => (v <= 0 ? 'Any' : `none in ${Math.round(v)} yrs`) },
      { kind: 'chips', bit: 'plan', key: 'plan', label: 'Planned logging', hint: 'Cutblocks approved or being logged on Crown forest tenures within 1 km (private forest plans are not published)', options: [['any', 'Either'], ['avoid', 'None within 1 km']] },
    ],
  },
];

const BINS = 44;
type Hist = { row: Extract<Row, { kind: 'range' }>; bin: Uint8Array; all: Uint32Array; el?: HTMLElement };
let hists: Hist[] = [];
const toT = (row: Extract<Row, { kind: 'range' }>, v: number) => (row.log ? Math.log(v / row.min) / Math.log(row.max / row.min) : (v - row.min) / (row.max - row.min));
const fromT = (row: Extract<Row, { kind: 'range' }>, t: number) => {
  const v = row.log ? row.min * (row.max / row.min) ** t : row.min + t * (row.max - row.min);
  return Math.round(v / row.step) * row.step;
};

function buildHists() {
  hists = SECTIONS.flatMap((s) => s.rows).filter((r): r is Extract<Row, { kind: 'range' }> => r.kind === 'range').map((row) => {
    const bin = new Uint8Array(L!.n);
    const all = new Uint32Array(BINS);
    for (let i = 0; i < L!.n; i++) {
      const v = row.value(i);
      const b = Number.isNaN(v) ? 255 : Math.max(0, Math.min(BINS - 1, Math.floor(clamp01(toT(row, v)) * BINS * 0.9999)));
      bin[i] = b;
      if (b !== 255) all[b]++;
    }
    return { row, bin, all };
  });
}

/** Parcels passing every filter but this row's, per bin: what this slider could let through. */
function crossCounts(h: Hist): Uint32Array {
  const out = new Uint32Array(BINS);
  const bit = 1 << BIT[h.row.bit];
  for (let i = 0; i < L!.n; i++) {
    if ((masks[i] & ~bit) !== 0 || h.bin[i] === 255) continue;
    out[h.bin[i]]++;
  }
  return out;
}

let railEl: HTMLElement | null = null, funnelEl: HTMLElement | null = null;

function buildRail() {
  railEl?.remove();
  const rail = (railEl = document.createElement('aside'));
  rail.className = 'land-rail';
  rail.innerHTML = `
    <div class="lr-head">
      <div class="kicker" style="--c:#5eead4">Land Finder</div>
      <h2>Find your acreage</h2>
      <div class="lr-count"><b id="lr-n">0</b><span>parcels match<br><i id="lr-of"></i></span></div>
      <div class="chips lr-presets">
        <button class="chip" data-preset="brief" title="Waterfront, 10+ acres, within 45 minutes of care, groceries and gas, quiet and safe">★ Our brief</button>
        <button class="chip" data-preset="loose" title="Turn every filter off">Show everything</button>
      </div>
    </div>
    ${SECTIONS.map((s) => `
      <details class="lr-sec" open style="--c:${s.c}" data-sec="${s.id}">
        <summary><span class="lr-ic">${s.icon}</span><span class="lr-t">${s.title}</span><span class="lr-st" data-st="${s.id}"></span></summary>
        <div class="lr-rows">${s.rows.map((r, k) => `<div class="lr-row" data-row="${s.id}-${k}"></div>`).join('')}</div>
      </details>`).join('')}
    <details class="lr-sec" open style="--c:#fde047">
      <summary><span class="lr-ic">$</span><span class="lr-t">Budget</span></summary>
      <div class="lr-rows lr-budget"></div>
    </details>
    <p class="note lr-fine">Parcels are private lots of 5+ acres in ParcelMap BC. Drive times are free-flow estimates from the OSRM router on OpenStreetMap roads, from a point within about a kilometre; island trips include the ferry crossing but not the wait. Internet is what providers report for the parcel’s ~25 km² hexagon, not the address: confirm with the provider. Hazard layers describe mapped history and models, not a guarantee. Check zoning, title, water rights, septic and official hazard maps with the local government before buying.</p>`;
  document.body.appendChild(rail);

  SECTIONS.forEach((s) => s.rows.forEach((r, k) => renderRow(rail.querySelector<HTMLElement>(`[data-row="${s.id}-${k}"]`)!, r)));
  renderBudget(rail.querySelector<HTMLElement>('.lr-budget')!);
  rail.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    f = { ...(b.dataset.preset === 'brief' ? BRIEF : LOOSE), kinds: [...(b.dataset.preset === 'brief' ? BRIEF : LOOSE).kinds] as F['kinds'] };
    refreshAll();
  }));
}

function renderRow(el: HTMLElement, r: Row) {
  if (r.kind === 'custom') { el.innerHTML = ''; r.render(el); return; }
  if (r.kind === 'chips') {
    el.innerHTML = `${r.label ? `<div class="lr-lab"><span title="${r.hint ?? ''}">${r.label}</span></div>` : ''}<div class="chips">${r.options.map(([v, t]) => `<button class="chip${f[r.key] === v ? ' on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>`;
    el.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.addEventListener('click', () => { (f as any)[r.key] = b.dataset.v; refreshAll(); }));
    return;
  }
  const h = hists.find((x) => x.row === r)!;
  h.el = el;
  el.innerHTML = `
    <div class="lr-lab"><span title="${r.hint}">${r.label}</span><b class="lr-v"></b></div>
    <div class="lr-slide">
      <svg class="lr-hist" viewBox="0 0 ${BINS * 6} 40" preserveAspectRatio="none"></svg>
      <div class="lr-shade"></div>
      <input type="range" min="0" max="1000" step="1" aria-label="${r.label}">
    </div>
    <div class="lr-hint">${r.hint}</div>`;
  const input = el.querySelector<HTMLInputElement>('input')!;
  input.value = String(Math.round(clamp01(toT(r, f[r.key] as number)) * 1000));
  input.addEventListener('input', () => { (f as any)[r.key] = fromT(r, +input.value / 1000); scheduleRefresh(); });
}

function renderWater(el: HTMLElement) {
  el.innerHTML = `
    <div class="chips lr-water">${([['front', 'Waterfront'], ['near', 'Near water'], ['any', 'Either']] as [WaterMode, string][]).map(([v, t]) => `<button class="chip${f.water === v ? ' on' : ''}" data-w="${v}">${t}</button>`).join('')}</div>
    <div class="lr-kinds">${['Ocean', 'Lake', 'River'].map((t, k) => `<button class="kind${f.kinds[k] ? ' on' : ''}" data-k="${k}" ${f.water === 'any' ? 'disabled' : ''}><span class="kd k${k + 1}"></span>${t}<i data-kc="${k}"></i></button>`).join('')}</div>
    <div class="lr-lab"><span>${f.water === 'near' ? 'Within' : 'Shoreline along the lot'}</span><b class="lr-v" id="lr-wv"></b></div>
    <input type="range" class="lr-plain" min="0" max="1000" ${f.water === 'any' ? 'disabled' : ''} aria-label="Water distance">
    <div class="lr-hint">${f.water === 'near' ? 'Closest point of the lot to the sea, a lake of 2+ ha or a large river' : 'Length of the lot boundary within 35 m of the high-water line (Freshwater Atlas)'}</div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => b.addEventListener('click', () => { f.water = b.dataset.w as WaterMode; renderWater(el); refreshAll(); }));
  el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => { const k = +b.dataset.k!; f.kinds[k] = !f.kinds[k]; if (!f.kinds.some(Boolean)) f.kinds[k] = true; b.classList.toggle('on', f.kinds[k]); refreshAll(); }));
  const r = el.querySelector<HTMLInputElement>('input')!;
  const near = f.water === 'near';
  r.value = String(near ? Math.round((f.near / 2000) * 1000) : Math.round((f.front / 600) * 1000));
  const show = () => (el.querySelector('#lr-wv')!.textContent = f.water === 'any' ? 'Any' : near ? `≤ ${fmtDist(f.near)}` : f.front ? `≥ ${f.front} m` : 'Any length');
  show();
  r.addEventListener('input', () => {
    if (near) f.near = Math.max(50, Math.round(((+r.value / 1000) * 2000) / 50) * 50);
    else f.front = Math.round(((+r.value / 1000) * 600) / 10) * 10;
    show(); scheduleRefresh();
  });
}

function renderThreat(el: HTMLElement) {
  const names = ['Low', 'Moderate', 'High', 'Any'];
  el.innerHTML = `
    <div class="lr-lab"><span title="BC Wildfire Service Provincial Strategic Threat Analysis: the worst rating on the parcel or in the forest within 500 m of it">Wildfire threat, at most</span></div>
    <div class="lr-threat">${names.map((t, k) => `<button class="th th${k + 1}${f.threat === k + 1 || (k === 3 && f.threat >= 4) ? ' on' : ''}" data-t="${k + 1}">${t}</button>`).join('')}</div>
    <label class="lr-check"><input type="checkbox" ${f.unrated ? 'checked' : ''}> Include parcels with no rating <span class="dim">(no rated land on or near it: mostly farms and built-up areas)</span></label>`;
  el.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.addEventListener('click', () => { f.threat = +b.dataset.t!; renderThreat(el); refreshAll(); }));
  el.querySelector<HTMLInputElement>('input')!.addEventListener('change', (e) => { f.unrated = (e.target as HTMLInputElement).checked; refreshAll(); });
}

function renderNextDoorNote(el: HTMLElement) {
  el.innerHTML = L!.nb ? '' : '<div class="lr-hint">No next-door data yet: run <code>npm run data logging neighbours</code> to build <code>public/data/land-neighbours.json</code>. These filters do nothing until then.</div>';
}

/** The parcel report's "Next door": a ring of what lies around it, and the nearest park, Crown land and logging. */
function nextDoorDetail(i: number, m: (label: string, dot: string, v: string, sub: string, good?: boolean | null) => string) {
  const nb = L!.nb, n = L!.num;
  if (!nb) return '';
  const park = Number.isNaN(n.parkI[i]) ? null : nb.parks[n.parkI[i]];
  const parkName = park ? esc(park[0] || park[1]) : '';
  const dist = (v: number) => (v <= NEXT_DOOR_M ? 'Next door' : fmtDist(v));
  const asOf = Math.floor(nb.asOf);
  const last = n.lastCut[i], on = n.onCut[i];
  return `<h3>Next door</h3>
    ${ringSvg(nb.cols.ring[i], nb)}
    <div class="metric-grid">
      ${m('Park', NB_CLASSES[2].c, Number.isNaN(n.parkM[i]) ? 'None' : dist(n.parkM[i]), Number.isNaN(n.parkM[i]) ? 'no park or protected area within 1 km' : `${parkName}${park && park[0] ? ` (${esc(park[1].toLowerCase())})` : ''}`, f.park === 'only' ? n.parkM[i] <= NEXT_DOOR_M : null)}
      ${m('Crown land', NB_CLASSES[3].c, Number.isNaN(n.crownM[i]) ? 'None' : dist(n.crownM[i]), Number.isNaN(n.crownM[i]) ? 'none within 1 km' : 'provincial Crown land: no neighbours, but it can be logged or leased', f.crown === 'only' ? n.crownM[i] <= NEXT_DOOR_M : null)}
      ${m('Last logged nearby', NB_CLASSES[4].c, Number.isNaN(last) ? 'Not on record' : String(last), Number.isNaN(last) ? 'no cutblock within 1 km in the record' : `${asOf - last} years ago, within 1 km${n.cut10[i] ? ` · ${fmt.ha(n.cut10[i])} logged within 1 km in the last 10 years` : ''}${Number.isNaN(on) ? '' : ` · the parcel itself was logged in ${on}`}`, f.logged > 0 ? n.since[i] >= f.logged : null)}
      ${m('Planned logging', NB_CLASSES[7].c, Number.isNaN(n.planM[i]) ? 'None' : dist(n.planM[i]), Number.isNaN(n.planM[i]) ? 'no approved or active cutblock within 1 km' : n.planK[i] === 2 ? 'a cutblock being logged now' : 'an approved cutblock, not started yet', f.plan === 'avoid' ? Number.isNaN(n.planM[i]) : null)}
    </div>`;
}

function renderFlood(el: HTMLElement) {
  el.innerHTML = `<label class="lr-switch"><input type="checkbox" ${f.flood ? 'checked' : ''}><span class="sw"></span><span>Outside mapped floodplains</span></label>`;
  el.querySelector('input')!.addEventListener('change', (e) => { f.flood = (e.target as HTMLInputElement).checked; refreshAll(); });
}

function renderTsunami(el: HTMLElement) {
  const opts: [F['tsunami'], string][] = [['room', 'Room to build outside'], ['clear', 'Fully outside'], ['any', 'Any']];
  el.innerHTML = `
    <div class="lr-lab"><span>Tsunami hazard</span></div>
    <div class="chips">${opts.map(([v, t]) => `<button class="chip${f.tsunami === v ? ' on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>
    <div class="lr-hint">${tsunamiOk
      ? `Where a published hazard map covers the parcel (Victoria; Nootka Sound to Quatsino Sound) its area counts; elsewhere, ground under ${tsunamiScreen} m within 1 km of the sea (a screening measure). <i>Room to build</i>: at least ${TSU_ROOM_ACRES} acre outside it.`
      : 'Tsunami data not built for these parcels yet (<code>npm run data tsunami</code>): every parcel passes.'}</div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.addEventListener('click', () => { f.tsunami = b.dataset.v as F['tsunami']; renderTsunami(el); refreshAll(); }));
}

function renderBudget(el: HTMLElement) {
  const listed = Object.values(shortlist).filter((s) => s.price);
  const under = listed.filter((s) => s.price! <= f.budget).length;
  el.innerHTML = `
    <div class="lr-lab"><span>Up to</span><b class="lr-v">${fmt.money(f.budget)}</b></div>
    <input type="range" class="lr-plain" min="250000" max="5000000" step="50000" value="${f.budget}" aria-label="Budget">
    <div class="callout" style="--c:#fde047">BC doesn't publish sale or asking prices for single parcels, so the budget applies to parcels you shortlist: add an asking price from a listing and they're checked against it.${listed.length ? ` <b>${under} of ${listed.length}</b> priced shortlist parcels are within budget.` : ''}</div>`;
  el.querySelector<HTMLInputElement>('input')!.addEventListener('input', (e) => {
    f.budget = +(e.target as HTMLInputElement).value;
    el.querySelector('.lr-v')!.textContent = fmt.money(f.budget);
    saveF();
    if (tab === 'short') renderPanel();
  });
}

let pending = 0;
function scheduleRefresh() {
  if (pending) return;
  pending = requestAnimationFrame(() => { pending = 0; refreshAll(false); });
}

let panelTimer = 0;
function refreshAll(rerenderRows = true) {
  recompute();
  saveF();
  if (rerenderRows) SECTIONS.forEach((s) => s.rows.forEach((r, k) => { if (r.kind !== 'range') renderRow(railEl!.querySelector<HTMLElement>(`[data-row="${s.id}-${k}"]`)!, r); }));
  updateRail();
  updateFunnel();
  // while a slider is dragged, the results wait until it settles
  clearTimeout(panelTimer);
  panelTimer = window.setTimeout(() => renderPanel(), rerenderRows ? 0 : 250);
}

function updateRail() {
  const rail = railEl!;
  animateCount(rail.querySelector<HTMLElement>('#lr-n')!, matches.length);
  rail.querySelector('#lr-of')!.textContent = `of ${fmt.int(L!.n)} private parcels of 5+ acres`;
  for (const h of hists) {
    if (!h.el) continue;
    const r = h.row, v = f[r.key] as number;
    const cross = crossCounts(h);
    const max = Math.max(1, ...h.all);
    const t = clamp01(toT(r, v));
    const cut = Math.floor(t * BINS * 0.9999);
    const isAny = (r.any != null && v >= r.any) || (r.dir === 'min' && v <= r.min);
    const bars = Array.from({ length: BINS }, (_, b) => {
      const kept = isAny || (r.dir === 'min' ? b >= cut : b <= cut);
      const ha = Math.sqrt(h.all[b] / max) * 38, hc = Math.sqrt(cross[b] / max) * 38;
      return `<rect x="${b * 6}" y="${40 - ha}" width="5" height="${ha}" class="hb-all"/><rect x="${b * 6}" y="${40 - hc}" width="5" height="${hc}" class="hb-x${kept ? ' kept' : ''}"/>`;
    }).join('');
    h.el.querySelector('svg')!.innerHTML = bars;
    const shade = h.el.querySelector<HTMLElement>('.lr-shade')!;
    shade.style.left = r.dir === 'min' ? '0' : `${t * 100}%`;
    shade.style.right = r.dir === 'min' ? `${(1 - t) * 100}%` : '0';
    shade.hidden = isAny;
    h.el.querySelector('.lr-v')!.textContent = r.show(v);
  }
  // water kind counts: parcels passing everything else with each kind of frontage
  const wbit = 1 << BIT.water;
  const kc = [0, 0, 0];
  for (let i = 0; i < L!.n; i++) if ((masks[i] & ~wbit) === 0 && L!.num.water[i] > 0) kc[L!.num.water[i] - 1]++;
  rail.querySelectorAll<HTMLElement>('[data-kc]').forEach((e) => (e.textContent = fmt.int(kc[+e.dataset.kc!])));
  for (const s of SECTIONS) {
    const bits = s.rows.map((r) => 1 << BIT[r.bit]).reduce((a, b) => a | b, 0);
    let cut = 0;
    for (let i = 0; i < L!.n; i++) if ((masks[i] & bits) && !(masks[i] & ~bits)) cut++;
    rail.querySelector(`[data-st="${s.id}"]`)!.textContent = cut ? `−${fmt.int(cut)}` : '';
  }
}

// Counts up on its own frames: d3 transitions patch d3.selection as a side effect, which the
// production build drops (d3 is marked side-effect free), so .interrupt() and .transition() don't exist there.
const counting = new WeakMap<HTMLElement, number>();
function animateCount(el: HTMLElement, to: number) {
  const from = +(el.textContent ?? '').replace(/[^\d.-]/g, '') || +(el.dataset.v ?? 0);
  el.dataset.v = String(to);
  cancelAnimationFrame(counting.get(el) ?? 0);
  const t0 = performance.now(), ms = 650;
  const tick = () => {
    const t = Math.min(1, (performance.now() - t0) / ms);
    el.textContent = fmt.int(from + (to - from) * d3.easeCubicOut(t));
    if (t < 1) counting.set(el, requestAnimationFrame(tick));
  };
  tick();
}

// ---------------------------------------------------------------------------------------------
// the funnel strip: how each stage narrows the island down

function buildFunnel() {
  funnelEl?.remove();
  const el = (funnelEl = document.createElement('div'));
  el.className = 'land-funnel';
  el.innerHTML = `<div class="lf-stage lf-all"><span class="lf-l">All lots</span><b data-f="all">0</b><span class="lf-bar"><i style="width:100%"></i></span></div>${STAGES.map((s) => `
    <div class="lf-arrow">›</div>
    <div class="lf-stage" style="--c:${s.c}" data-stage="${s.id}"><span class="lf-l"><span class="lf-ic">${s.icon}</span>${s.label}</span><b data-f="${s.id}">0</b><span class="lf-bar"><i></i></span><span class="lf-cut"></span></div>`).join('')}`;
  document.body.appendChild(el);
  el.querySelectorAll<HTMLElement>('[data-stage]').forEach((st) => st.addEventListener('click', () => {
    const sec = railEl!.querySelector<HTMLDetailsElement>(`[data-sec="${st.dataset.stage === 'rules' ? 'size' : st.dataset.stage}"]`);
    if (sec) { sec.open = true; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash'); }
  }));
}

function updateFunnel() {
  const el = funnelEl!;
  animateCount(el.querySelector<HTMLElement>('[data-f="all"]')!, L!.n);
  const scale = (v: number) => (v ? Math.log(v + 1) / Math.log(L!.n + 1) : 0);
  let prev = L!.n, worst = -1, worstCut = 0;
  STAGES.forEach((s, k) => { const cut = prev - stageCounts[k]; if (cut > worstCut) { worstCut = cut; worst = k; } prev = stageCounts[k]; });
  prev = L!.n;
  STAGES.forEach((s, k) => {
    const st = el.querySelector<HTMLElement>(`[data-stage="${s.id}"]`)!;
    animateCount(st.querySelector<HTMLElement>('b')!, stageCounts[k]);
    st.querySelector<HTMLElement>('.lf-bar i')!.style.width = `${scale(stageCounts[k]) * 100}%`;
    const cut = prev - stageCounts[k];
    st.querySelector('.lf-cut')!.textContent = cut ? `−${fmt.int(cut)}` : 'no cut';
    st.classList.toggle('tight', k === worst && worstCut > 0);
    st.classList.toggle('last', k === STAGES.length - 1);
    st.title = k === worst ? `${s.label} is cutting the most parcels at this step. Click to adjust it.` : `Click to adjust ${s.label.toLowerCase()}`;
    prev = stageCounts[k];
  });
}

// ---------------------------------------------------------------------------------------------
// right panel: ranked matches, the shortlist, and a parcel's report

function renderPanel() {
  const p = ctx!.panel;
  p.scrollTop = 0;
  if (selected != null) { renderDetail(selected); return; }
  const keys = Object.keys(shortlist);
  const shortIdx = keys.map((k) => findByKey(k)).filter((i): i is number => i != null);
  const list = tab === 'matches' ? matches.slice(0, 80) : shortIdx;
  p.innerHTML = `
    <button class="close-x" aria-label="Close Land Finder">×</button>
    <div class="kicker" style="--c:#5eead4">Land Finder</div>
    <h2>${tab === 'matches' ? (matches.length ? 'Best matches' : 'Nothing matches yet') : 'Your shortlist'}</h2>
    <div class="ld-tabs"><button class="${tab === 'matches' ? 'on' : ''}" data-tab="matches">Matches <i>${fmt.int(matches.length)}</i></button><button class="${tab === 'short' ? 'on' : ''}" data-tab="short">★ Shortlist <i>${keys.length}</i></button></div>
    ${tab === 'matches' && !matches.length ? `<p class="lede">No parcel clears every filter. The funnel below shows which step cuts the most; loosen that one first.</p>` : ''}
    ${tab === 'short' && !keys.length ? `<p class="lede">Star parcels from their report to keep them here, with your notes and the asking price from any listing.</p>` : ''}
    <ol class="ld-list">${list.map((i, r) => card(i, r)).join('')}</ol>
    ${tab === 'matches' && matches.length > 80 ? `<p class="note">Showing the top 80 of ${fmt.int(matches.length)}. Tighten a filter to narrow it down.</p>` : ''}`;
  p.querySelector('.close-x')!.addEventListener('click', () => ctx!.onClose());
  p.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab as typeof tab; renderPanel(); }));
  p.querySelectorAll<HTMLElement>('.ld-card').forEach((c) => {
    const i = +c.dataset.i!;
    c.addEventListener('click', () => select(i));
    c.addEventListener('mouseenter', () => { hovered = i; });
    c.addEventListener('mouseleave', () => { if (hovered === i) hovered = null; });
  });
}

function findByKey(k: string): number | null {
  for (let i = 0; i < L!.n; i++) if (keyOf(i) === k) return i;
  return null;
}

function ring(score: number, size = 42) {
  const r = size / 2 - 4, c = 2 * Math.PI * r;
  return `<svg class="ld-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="rg-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="rg-fg" stroke="${RAMP(score)}" stroke-dasharray="${(score / 100) * c} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle">${score}</text></svg>`;
}

function card(i: number, rank: number) {
  const n = L!.num;
  const s = masks[i] === 0 ? scores[i] : scoreOf(i);
  const sh = shortlist[keyOf(i)];
  const over = sh?.price && sh.price > f.budget;
  const meter = (v: number, c: string) => `<span class="ld-meter"><i style="width:${Math.round(v * 100)}%;background:${c}"></i></span>`;
  const pr = parts(i);
  return `<li class="ld-card${masks[i] ? ' out' : ''}" data-i="${i}" style="--c:${RAMP(s)};animation-delay:${Math.min(rank, 20) * 28}ms">
    <div class="ld-rank">${tab === 'matches' ? rank + 1 : '★'}</div>
    <div class="ld-body">
      <div class="ld-title"><b>${n.acres[i] >= 100 ? Math.round(n.acres[i]) : n.acres[i].toFixed(1)} ac</b>${n.water[i] ? `<span class="wb k${n.water[i]}">${L!.json.waterKinds[n.water[i]]}${n.front[i] ? ` · ${n.front[i]} m` : ''}</span>` : ''}${sh ? '<span class="star">★</span>' : ''}</div>
      <div class="ld-place">${placeOf(i)}</div>
      <div class="ld-trips"><span>✚ ${minText(careMin(i))}</span><span>🛒 ${minText(mins(i, 'grocery'))}</span><span>⛽ ${minText(mins(i, 'gas'))}</span></div>
      <div class="ld-meters"><span>Quiet</span>${meter(pr.quiet, '#c084fc')}<span>Safe</span>${meter(pr.safety, '#fb923c')}</div>
      ${sh?.price ? `<div class="ld-price${over ? ' over' : ''}">${fmt.money(sh.price)}${over ? ' · over budget' : ' · within budget'}</div>` : ''}
      ${masks[i] ? `<div class="ld-price over">Filtered out: ${failedNames(i).join(', ')}</div>` : ''}
    </div>
    ${ring(s)}
  </li>`;
}

function highlightCard(i: number | null) {
  ctx?.panel.querySelectorAll<HTMLElement>('.ld-card').forEach((c) => c.classList.toggle('hot', +c.dataset.i! === i));
}

function select(i: number | null) {
  selected = i;
  if (i == null) { renderPanel(); return; }
  const b = L!.bounds[i];
  const map = ctx!.map;
  const cam = b.every(Number.isFinite) ? map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 140, bottom: 160, left: 420, right: 440 }, maxZoom: 15.2 }) : null;
  map.flyTo({ center: cam?.center ?? [L!.num.lon[i], L!.num.lat[i]], zoom: Math.min(15, Math.max(11.5, cam?.zoom ?? 13)), pitch: 55, bearing: map.getBearing() + 12, duration: 2200, curve: 1.5, essential: true });
  renderDetail(i);
}

function tsunamiTile(i: number, m: (label: string, dot: string, v: string, sub: string, good?: boolean | null) => string) {
  const n = L!.num, share = tsuShare(i), mapped = !Number.isNaN(n.tsuHaz[i]);
  const zone = Number.isNaN(n.tsuZone[i]) ? null : 'ABCDE'[n.tsuZone[i]];
  const dry = tsuDry(i);
  const what = mapped ? 'inside the published hazard map' : `on low coastal ground (under ${tsunamiScreen} m, near the sea)`;
  const sub = share > 0 ? `${what}; ${dry >= 10 ? Math.round(dry) : dry.toFixed(1)} acres outside it` : mapped ? 'outside the published hazard map' : `no ground under ${tsunamiScreen} m near the sea`;
  return m('Tsunami', '#38e1ff', `${Math.round(share)}%${zone ? ` · Zone ${zone}` : ''}`, sub, share === 0 ? true : dry >= TSU_ROOM_ACRES ? null : false);
}

function renderDetail(i: number) {
  const n = L!.num, J = L!.json;
  const p = ctx!.panel;
  const k = keyOf(i);
  const sh = shortlist[k];
  const s = masks[i] === 0 ? scores[i] : scoreOf(i);
  const pr = parts(i);
  const threat = Number.isNaN(n.threat[i]) ? 'Not rated' : J.threat[n.threat[i]];
  const m = (label: string, dot: string, v: string, sub: string, good?: boolean | null) =>
    `<div class="metric${good === false ? ' warn' : ''}"><div class="mk"><span class="dot" style="background:${dot}"></span>${label}</div><div class="mv">${v}</div><div class="ms">${sub}</div></div>`;
  const trip = (cat: Cat) => {
    const ix = n[`${cat}I`][i];
    const poi = Number.isNaN(ix) ? null : J.pois[cat][ix];
    const v = mins(i, cat);
    const limit = cat === 'grocery' ? f.grocery : cat === 'gas' ? f.gas : f.care;
    const ok = Number.isNaN(v) ? false : limit >= ANY_MIN || v <= limit;
    return `<div class="ld-trip${ok ? '' : ' warn'}" style="--c:rgb(${CAT_COLOR[cat].join(',')})"><span class="ti">${CAT_ICON[cat]}</span><span class="tn"><b>${CAT_LABEL[cat]}</b><br>${poi ? esc(poi[0]) : 'no road route'}</span><span class="tm">${Number.isNaN(v) ? '—' : v}<small>${Number.isNaN(v) ? '' : 'min'}</small></span></div>`;
  };
  const lat = n.lat[i].toFixed(5), lon = n.lon[i].toFixed(5);
  p.innerHTML = `
    <div class="ld-detail">
    <button class="ld-back">‹ ${tab === 'short' ? 'Shortlist' : 'Matches'}</button>
    <button class="close-x" aria-label="Close Land Finder">×</button>
    <div class="ld-hero" style="--c:${RAMP(s)}">
      <div>
        <div class="kicker" style="--c:${RAMP(s)}">${masks[i] ? 'Outside your filters' : `Match #${matches.indexOf(i) + 1} of ${fmt.int(matches.length)}`}</div>
        <h2>${n.acres[i].toFixed(1)} acres${n.water[i] ? `<br><span class="wb k${n.water[i]}">${waterText(i)}</span>` : ''}</h2>
        <div class="ld-place">${placeOf(i)} · ${esc(J.names.place[n.place[i]])}</div>
        ${L!.pid[i] ? `<div class="ld-pid">PID ${esc(L!.pid[i])}</div>` : ''}
      </div>
      ${ring(s, 74)}
    </div>
    ${masks[i] ? `<div class="callout" style="--c:#f87171">Filtered out by ${failedNames(i).join(', ')}.</div>` : ''}
    <div class="ld-radar"></div>
    <div class="ld-actions">
      <button class="ld-btn star${sh ? ' on' : ''}">${sh ? '★ Shortlisted' : '☆ Shortlist'}</button>
      <button class="ld-btn sat${satellite ? ' on' : ''}">◐ Satellite</button>
      <a class="ld-btn" target="_blank" rel="noopener" href="https://www.realtor.ca/map#ZoomLevel=14&Center=${lat}%2C${lon}&view=list&TransactionTypeId=2">Listings near here ↗</a>
      <a class="ld-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/@${lat},${lon},800m/data=!3m1!1e3">Google Maps ↗</a>
    </div>
    ${sh ? `<div class="ld-notes"><label>Asking price <input type="text" inputmode="numeric" placeholder="e.g. 1,850,000" value="${sh.price ? sh.price.toLocaleString('en-CA') : ''}"></label>${sh.price ? `<span class="ld-price${sh.price > f.budget ? ' over' : ''}">${sh.price > f.budget ? `${fmt.money(sh.price - f.budget)} over budget` : `${fmt.money(f.budget - sh.price)} under budget`}</span>` : ''}<textarea placeholder="Notes: listing link, viewing date, well, septic…">${esc(sh.note)}</textarea></div>` : ''}
    <h3>Within reach</h3>
    <div class="ld-trip-list">${trip(f.careKind === 'er' ? 'er' : 'care')}${f.careKind === 'er' ? trip('care') : trip('er')}${trip('grocery')}${trip('gas')}</div>
    ${internet && !Number.isNaN(n.net50[i]) ? `<div class="metric-grid">
      ${m('50/10 internet', NET_COLOR, BANDS[n.net50[i]], 'of homes in this ~25 km² hexagon offered 50/10 Mbps (ISED)', f.net === 'any' ? null : n.net50[i] >= NET_BAND[f.net])}
      ${m('Measured speed', NET_COLOR, Number.isNaN(n.netMbps[i]) ? '—' : `${Math.round(n.netMbps[i])} Mbps`, Number.isNaN(n.netMbps[i]) ? 'no home speed tests in the hexagon last year' : `average home download in the hexagon, past year (Ookla)`)}
      ${m('Mobile', '#f2a33a', n.cell[i] ? 'Reported' : 'Not reported', 'LTE/5G service in the hexagon, as providers report it (ISED)', f.cell === 'yes' ? n.cell[i] > 0 : null)}
    </div>` : ''}
    <h3>The land</h3>
    <div class="metric-grid">
      ${m('Waterfront', '#38bdf8', n.water[i] ? `${n.front[i]} m` : fmtDist(n.waterM[i]), n.water[i] ? waterText(i) : 'to the nearest water', n.water[i] > 0)}
      ${m('High ground', '#5eead4', Number.isNaN(n.elevHi[i]) ? '—' : `${n.elevHi[i]} m`, `above sea level at its highest${Number.isNaN(n.elevLo[i]) ? '' : `; lowest ${n.elevLo[i]} m`}`, f.high <= 0 || n.elevHi[i] >= f.high)}
      ${m('Slope', '#a3e635', Number.isNaN(n.slope[i]) ? '—' : `${n.slope[i].toFixed(1)}°`, n.slope[i] < 8 ? 'gentle, easy to build on' : n.slope[i] < 16 ? 'rolling' : 'steep in places')}
      ${m('Farmland reserve', '#f472b6', `${n.alr[i]}%`, n.alr[i] >= 50 ? 'mostly in the ALR: farming protected, building limited' : n.alr[i] > 0 ? 'partly in the ALR' : 'outside the ALR')}
      ${m('Sunshine', '#fde047', Number.isNaN(n.sun[i]) ? '—' : `${fmt.int(n.sun[i])} h`, 'a year, nearest station that measures it')}
      ${m('Frost days', '#93c5fd', Number.isNaN(n.frost[i]) ? '—' : `${n.frost[i]}`, 'a year, 1981–2010 normals')}
    </div>
    <h3>Safety</h3>
    <div class="metric-grid">
      ${m('Wildfire threat', '#fb923c', threat, 'worst rating on or within 500 m of the parcel (BCWS)', Number.isNaN(n.threat[i]) ? null : n.threat[i] <= f.threat)}
      ${m('Fire history', '#f97316', `${n.fires5[i]} starts`, `within 5 km since 1990; ${fmt.ha(n.burn5[i])} burned within 5 km since 1950`)}
      ${m('Floodplain', '#38bdf8', n.flood[i] ? 'Mapped' : 'Not mapped', n.flood[i] ? 'part of the parcel is in a designated floodplain' : 'outside designated floodplain maps', !n.flood[i])}
      ${m('Earthquake shaking', '#e86cff', Number.isNaN(n.pga[i]) ? '—' : `${n.pga[i]}% g`, '2% chance in 50 years (NRCan 2020)')}
      ${tsunamiOk ? tsunamiTile(i, m) : ''}
    </div>
    ${trails && !Number.isNaN(n.trail3[i]) ? `<h3>Trails &amp; waterfalls</h3>
    <div class="metric-grid">
      ${m('Trails to walk', '#34d399', `${n.trail3[i].toFixed(n.trail3[i] < 10 ? 1 : 0)} km`, 'of mapped footpath within 3 km', f.trail <= 0 || n.trail3[i] >= f.trail)}
      ${(() => { const fl = Number.isNaN(n.fallI[i]) ? null : trails!.falls[n.fallI[i]]; return m('Nearest waterfall', '#8be3ff', Number.isNaN(n.fallKm[i]) ? '—' : `${n.fallKm[i].toFixed(1)} km`, fl ? `${esc(fl.name ?? 'unnamed')}${fl.h ? `, ${Math.round(fl.h)} m drop` : ''}` : '', f.fall >= ANY_FALL || n.fallKm[i] <= f.fall); })()}
    </div>` : ''}
    ${waterDetail(i, m)}
    ${wellsDetail(i, m)}
    ${nextDoorDetail(i, m)}
    <h3>Quiet</h3>
    <div class="metric-grid">
      ${m('Busy road', '#c084fc', `${n.roadKm[i].toFixed(1)} km`, 'from the quietest spot on the land', n.roadKm[i] >= f.road)}
      ${m('Airport', '#c084fc', `${n.airKm[i].toFixed(1)} km`, 'nearest airport, airstrip or float base', n.airKm[i] >= f.air)}
      ${m('Industry', '#c084fc', `${n.indKm[i].toFixed(1)} km`, 'nearest industrial land or quarry', n.indKm[i] >= f.ind)}
      ${m('Nearest town', '#94a3b8', `${n.townKm[i].toFixed(0)} km`, esc(J.names.place[n.town[i]]))}
    </div>
    <p class="note">Score ${s}/100 blends size ${Math.round(pr.size * 100)}, water ${Math.round(pr.water * 100)}, reach ${Math.round(pr.reach * 100)}, quiet ${Math.round(pr.quiet * 100)}, safety ${Math.round(pr.safety * 100)} and sun ${Math.round(pr.sun * 100)}. Boundaries from ParcelMap BC are for orientation, not survey. Drive times are free-flow estimates.</p>
    </div>`;
  p.querySelector('.close-x')!.addEventListener('click', () => ctx!.onClose());
  p.querySelector('.ld-back')!.addEventListener('click', () => { selected = null; renderPanel(); ctx!.map.flyTo({ zoom: Math.min(ctx!.map.getZoom(), 9.6), pitch: 45, duration: 1600 }); });
  p.querySelector('.star')!.addEventListener('click', () => {
    if (shortlist[k]) delete shortlist[k]; else shortlist[k] = { t: Date.now() };
    saveShort(); renderDetail(i); renderBudget(railEl!.querySelector<HTMLElement>('.lr-budget')!);
  });
  p.querySelector('.sat')!.addEventListener('click', () => { setSatellite(!satellite); p.querySelector('.sat')!.classList.toggle('on', satellite); });
  const priceIn = p.querySelector<HTMLInputElement>('.ld-notes input');
  priceIn?.addEventListener('change', () => {
    const v = Number(priceIn.value.replace(/[^\d.]/g, ''));
    shortlist[k].price = v > 0 ? (v < 100_000 ? v * 1000 : v) : undefined;
    saveShort(); renderDetail(i); renderBudget(railEl!.querySelector<HTMLElement>('.lr-budget')!);
  });
  p.querySelector<HTMLTextAreaElement>('.ld-notes textarea')?.addEventListener('input', (e) => { shortlist[k].note = (e.target as HTMLTextAreaElement).value; saveShort(); });
  drawRadar(p.querySelector<HTMLElement>('.ld-radar')!, pr, RAMP(s));
  const ws = p.querySelector<HTMLElement>('.ld-wells');
  if (ws && wells) wellStrip(ws, wells, wellsNear(wells, n.lon[i], n.lat[i], landWells?.km ?? 1), { height: 120 });
}

/** The parcel report's water access: nearest beach, boat launch and moorage on its island, in a straight line. */
function waterDetail(i: number, m: (label: string, dot: string, v: string, sub: string, good?: boolean | null) => string) {
  const n = L!.num;
  if (!water) return '';
  const tile = (label: string, dot: string, k: 'beach' | 'launch' | 'moor', none: string, max: number | null) => {
    const d = n[`${k}Km`][i], j = n[`${k}I`][i];
    return m(label, dot, Number.isNaN(d) ? '—' : outKm(d), Number.isNaN(d) ? none : esc(outName(water!, [j, d])), max == null || max >= ANY_SHORE ? null : d <= max);
  };
  return `<h3>Water access</h3>
    <div class="metric-grid">
      ${tile('Nearest beach', '#f6d58e', 'beach', 'none mapped on this island', f.beach)}
      ${tile('Boat launch', '#22d3ee', 'launch', 'no public launch mapped on this island', f.launch)}
      ${tile('Moorage', '#7aa2ff', 'moor', 'no marina or public harbour on this island', null)}
    </div>`;
}

/** The parcel report's water supply: well prospects within 1 km, the aquifer under it, and the nearby wells drawn as drill holes. */
function wellsDetail(i: number, m: (label: string, dot: string, v: string, sub: string, good?: boolean | null) => string) {
  const n = L!.num;
  if (!landWells || Number.isNaN(n.wN[i])) return '';
  const r = landWells.km, low = landWells.lowGpm;
  const aq = n.wAq[i] >= 0 ? wells?.aquifers[n.wAq[i]] : null;
  const own = n.wOwn[i];
  const gpm = Number.isNaN(n.wGpm[i]) ? null : n.wGpm[i];
  return `<h3>Water supply</h3>
    <div class="metric-grid">
      ${m('Well yield', yieldColor(gpm), gpm == null ? '—' : gpmText(gpm), gpm == null ? `no tested well within ${r} km` : `median of wells within ${r} km · ${Math.round(lpm(gpm))} L/min`, f.wGpm <= 0 ? null : gpm != null && gpm >= f.wGpm)}
      ${m('Well depth', '#19d3c5', Number.isNaN(n.wDepth[i]) ? '—' : `${n.wDepth[i]} m`, n.wN[i] ? `median of ${n.wN[i]} wells within ${r} km` : `no registered well within ${r} km`, f.wDepth >= ANY_WDEPTH ? null : n.wDepth[i] <= f.wDepth)}
      ${m('Low-yield wells', '#ffb347', Number.isNaN(n.wLow[i]) ? '—' : `${n.wLow[i]}%`, `of tested wells nearby gave under ${low} gpm when drilled`, f.wLow >= ANY_WLOW ? null : n.wLow[i] <= f.wLow)}
      ${m('Aquifer', '#4c8dff', aq ? `#${aq.id}` : n.wAq[i] >= 0 ? 'Mapped' : 'None mapped', aq ? `${esc(aq.material ?? '')}${aq.prod ? ` · ${esc(aq.prod.toLowerCase())} productivity` : ''}${aq.vuln ? ` · ${esc(aq.vuln.toLowerCase())} vulnerability` : ''}` : 'no provincially mapped aquifer under the centre', f.aquifer === 'over' ? n.wAq[i] >= 0 : null)}
    </div>
    ${own ? `<div class="callout" style="--c:#19d3c5">The registry lists <b>${own} well${own > 1 ? 's' : ''}</b> under this parcel's PID. Ask the seller for the well record and a recent flow test.</div>` : ''}
    ${wells && n.wN[i] ? `<div class="ld-wells"></div><p class="note">Each line is a registered well within ${r} km, drawn to its depth and coloured by its yield when drilled; the blue tick is where the water stood. Yields nearby are a guide, not a promise for a new well here.</p>` : ''}`;
}

function drawRadar(el: HTMLElement, pr: ReturnType<typeof parts>, color: string) {
  const axes: [keyof typeof pr, string][] = [['size', 'Size'], ['water', 'Water'], ['reach', 'Reach'], ['quiet', 'Quiet'], ['safety', 'Safety'], ['sun', 'Sun']];
  const W_ = el.clientWidth || 340, H_ = 190, cx = W_ / 2, cy = H_ / 2 + 4, R = 70;
  const ang = (k: number) => -Math.PI / 2 + (k / axes.length) * Math.PI * 2;
  const svg = d3.select(el).html('').append('svg').attr('width', W_).attr('height', H_);
  for (const lv of [0.25, 0.5, 0.75, 1])
    svg.append('polygon').attr('points', axes.map((_, k) => `${cx + Math.cos(ang(k)) * R * lv},${cy + Math.sin(ang(k)) * R * lv}`).join(' ')).attr('class', 'rd-grid');
  axes.forEach(([key, lab], k) => {
    svg.append('line').attr('x1', cx).attr('y1', cy).attr('x2', cx + Math.cos(ang(k)) * R).attr('y2', cy + Math.sin(ang(k)) * R).attr('class', 'rd-axis');
    svg.append('text').attr('x', cx + Math.cos(ang(k)) * (R + 16)).attr('y', cy + Math.sin(ang(k)) * (R + 14)).attr('text-anchor', 'middle').attr('dominant-baseline', 'middle').attr('class', 'rd-lab').text(`${lab} ${Math.round(pr[key] * 100)}`);
  });
  const pts = (scale: number) => axes.map(([key], k) => `${cx + Math.cos(ang(k)) * R * Math.max(0.04, pr[key]) * scale},${cy + Math.sin(ang(k)) * R * Math.max(0.04, pr[key]) * scale}`).join(' ');
  const shape = svg.append('polygon').attr('points', pts(0.05)).attr('fill', color).attr('fill-opacity', 0.25).attr('stroke', color).attr('stroke-width', 2).style('filter', `drop-shadow(0 0 8px ${color})`);
  // grows on its own frames (see animateCount for why not a d3 transition)
  const t0 = performance.now();
  const grow = () => {
    const t = Math.min(1, (performance.now() - t0) / 900);
    shape.attr('points', pts(0.05 + 0.95 * d3.easeBackOut(t)));
    if (t < 1 && shape.node()!.isConnected) requestAnimationFrame(grow);
  };
  requestAnimationFrame(grow);
}

// ---------------------------------------------------------------------------------------------
// satellite imagery under the parcels

function setSatellite(on: boolean) {
  satellite = on;
  const map = ctx!.map;
  if (on && !map.getSource('esri-imagery')) {
    map.addSource('esri-imagery', { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    map.addLayer({ id: 'esri-imagery', type: 'raster', source: 'esri-imagery', paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 700 } } as any }, ctx!.beforeId);
  }
  if (map.getLayer('esri-imagery')) map.setPaintProperty('esri-imagery', 'raster-opacity', on ? 0.92 : 0);
  // once faded out, drop the imagery so it stops loading tiles and its credit leaves the map
  if (!on) setTimeout(() => {
    if (satellite) return;
    if (map.getLayer('esri-imagery')) map.removeLayer('esri-imagery');
    if (map.getSource('esri-imagery')) map.removeSource('esri-imagery');
  }, 800);
}

// ---------------------------------------------------------------------------------------------
// open and close

export async function openLand(c: NonNullable<typeof ctx>) {
  ctx = c;
  opened = true;
  selected = null; hovered = null; tab = 'matches';
  document.body.classList.add('land-mode');
  c.panel.innerHTML = `<div class="kicker" style="--c:#5eead4">Land Finder</div><h2>Surveying the island…</h2><div class="ld-loading"><i></i><i></i><i></i></div><p class="lede">Loading every private parcel of 5+ acres with its water, drive times, quiet and hazards.</p>`;
  try {
    L ??= await (loading ??= load());
  } catch (e) {
    c.panel.innerHTML = `<button class="close-x" aria-label="Close">×</button><div class="kicker">Land Finder</div><h2>No parcel data yet</h2><div class="unavail">Run <code>npm run data land</code> to build <code>public/data/land.json</code>. (${esc((e as Error).message)})</div>`;
    c.panel.querySelector('.close-x')!.addEventListener('click', () => c.onClose());
    return;
  }
  if (!opened) return;
  if (!hists.length) buildHists();
  recompute();
  buildRail();
  buildFunnel();
  updateRail();
  updateFunnel();
  renderPanel();
  c.map.flyTo({ center: [-124.75, 49.45], zoom: 7.6, pitch: 42, bearing: -14, duration: 2400, curve: 1.4, essential: true });
}

export function closeLand() {
  opened = false;
  selected = null; hovered = null;
  railEl?.remove(); railEl = null;
  funnelEl?.remove(); funnelEl = null;
  document.body.classList.remove('land-mode');
  if (satellite) setSatellite(false);
  cache = null;
}

export const landOpen = () => opened;
export function landKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && selected != null) { selected = null; renderPanel(); return true; }
  return false;
}
