// Internet & cell coverage: the islands as a field of glowing hexagon columns, one per ~25 km² cell of
// ISED's National Broadband Data grid. In the measured views a column's height and colour are the
// average download speed Speedtest users got there over the past year (Ookla open data), playing
// quarter by quarter since 2019; populated cells that providers say get neither 50/10 Mbps nor mobile
// service lie dark on the ground. The advertised view shows what providers report to ISED instead.
// Also the per-town and per-parcel lookups used by the Town Report, Town Finder and Land Finder.
// Data from scripts/internet.mjs (public/data/internet.json).
import * as d3 from 'd3';
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Internet, Muni, km } from './data';
import type { AtlasLayer, TimedEvent } from './layers';
import { lineChart, rampCSS, ChartHandle } from './charts';
import { esc } from './html';

type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };
const ADDITIVE = { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false } as const;
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;

export const NET_COLOR = '#7dd3fc';
/** Technology bits in internet.json, in display order. */
export const TECHS: [number, string][] = [[1, 'Fibre'], [2, 'Cable'], [4, 'DSL'], [8, 'Fixed wireless'], [16, 'Mobile (LTE/5G)'], [32, 'Satellite']];
const MOBILE = 16;
/** ISED's 50/10 bands: share of homes in the hexagon offered 50/10 Mbps. */
export const BANDS = ['none', 'under 25%', '25–50%', '50–75%', 'over 75%'];
const BAND_MID = [0, 0.125, 0.375, 0.625, 0.875];
const BAND_COLOR = ['#4a1428', '#a3324a', '#e07a3e', '#e8c15a', '#5eead4'];
/** Measured download speed, Mbps → colour: dim red under 10, amber at 25–50, teal at 100, ice-white past 500. */
export const speedRamp = d3.scaleLog<string>().domain([5, 25, 50, 100, 250, 600]).range(['#5a1730', '#d9483b', '#f2a33a', '#5eead4', '#38bdf8', '#e8f7ff']).clamp(true);
const elevOf = (mbps: number) => Math.sqrt(mbps) * 460;
/** Town speeds pool hexagons within this distance of the centre. */
const TOWN_KM = 5;
const KX = 111.32 * Math.cos((49.5 * Math.PI) / 180), KY = 110.54;

type Kind = 'fixed' | 'mobile';
type Mode = Kind | 'advertised';

// ---------------------------------------------------------------------------------------------
// derived series, worked out once per data file

type Derived = {
  I: Internet;
  /** past-year (4-quarter) tests-weighted download per quarter and hexagon, NaN where nobody tested */
  roll: Record<Kind, Float32Array[]>;
  rollN: Record<Kind, Float32Array[]>;
  /** island-wide tests-weighted average download per quarter (that quarter only) */
  island: Record<Kind, (number | null)[]>;
  t0: number; t1: number;
};
let derivedFor: Internet | null = null, D: Derived | null = null;

/** Mid-quarter as a fractional year: '2021-Q3' → 2021.625. */
const qMid = (q: string) => +q.slice(0, 4) + (+q.slice(6) - 1) / 4 + 0.125;

function derive(I: Internet): Derived {
  if (derivedFor === I && D) return D;
  const H = I.hexes.length, Q = I.quarters.length;
  const roll = { fixed: [] as Float32Array[], mobile: [] as Float32Array[] }, rollN = { fixed: [] as Float32Array[], mobile: [] as Float32Array[] };
  const island = { fixed: [] as (number | null)[], mobile: [] as (number | null)[] };
  for (const k of ['fixed', 'mobile'] as Kind[]) {
    const { d, n } = I[k];
    for (let q = 0; q < Q; q++) {
      const out = new Float32Array(H).fill(NaN), tn = new Float32Array(H);
      for (let h = 0; h < H; h++) {
        let s = 0, w = 0;
        for (let p = Math.max(0, q - 3); p <= q; p++) { const v = d[p][h]; if (v != null) { s += v * n[p][h]; w += n[p][h]; } }
        if (w) { out[h] = s / w; tn[h] = w; }
      }
      roll[k].push(out); rollN[k].push(tn);
      let s = 0, w = 0;
      for (let h = 0; h < H; h++) { const v = d[q][h]; if (v != null) { s += v * n[q][h]; w += n[q][h]; } }
      island[k].push(w ? s / w : null);
    }
  }
  const t0 = +I.quarters[0].slice(0, 4) + (+I.quarters[0].slice(6) - 1) / 4;
  const last = I.quarters[Q - 1];
  const t1 = +last.slice(0, 4) + +last.slice(6) / 4 - 0.001;
  derivedFor = I;
  return (D = { I, roll, rollN, island, t0, t1 });
}

/** Past-year download at hexagon h for fractional year t, eased between quarter midpoints; null if untested. */
function speedAt(d: Derived, k: Kind, h: number, t: number): number | null {
  const Q = d.I.quarters.length;
  const f = (t - d.t0) * 4 - 0.5;
  const q0 = Math.max(0, Math.min(Q - 1, Math.floor(f))), q1 = Math.min(Q - 1, q0 + 1);
  const a = d.roll[k][q0][h], b = d.roll[k][q1][h];
  const w = Math.max(0, Math.min(1, f - q0));
  if (Number.isNaN(a) && Number.isNaN(b)) return null;
  if (Number.isNaN(a)) return w > 0.5 ? b : null;
  if (Number.isNaN(b)) return w < 0.5 ? a : null;
  return a + (b - a) * w;
}
const quarterAt = (d: Derived, t: number) => Math.max(0, Math.min(d.I.quarters.length - 1, Math.floor((t - d.t0) * 4)));
const qLabel = (q: string) => `${q.slice(5)} ${q.slice(0, 4)}`;

// ---------------------------------------------------------------------------------------------
// lookups for towns and parcels

const gridCache = new WeakMap<Internet, Map<string, number[]>>();
const CELL = 0.05;
function hexGrid(I: Internet) {
  let g = gridCache.get(I);
  if (!g) {
    g = new Map();
    I.hexes.forEach((h, i) => { const k = `${Math.floor(h[0] / CELL)},${Math.floor(h[1] / CELL)}`; (g!.get(k) ?? g!.set(k, []).get(k)!).push(i); });
    gridCache.set(I, g);
  }
  return g;
}
/** The hexagon a point falls in (nearest centre within one circumradius), or -1. */
export function hexAt(I: Internet, lon: number, lat: number): number {
  const g = hexGrid(I), gx = Math.floor(lon / CELL), gy = Math.floor(lat / CELL);
  let best = -1, bd = (I.hex.r / 1000) * 1.02;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of g.get(`${gx + dx},${gy + dy}`) ?? []) {
    const h = I.hexes[i], d = Math.hypot((h[0] - lon) * KX, (h[1] - lat) * KY);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export type TownNet = {
  /** the hexagon holding the town centre */
  hex: number; band: number; a5: boolean; mobile: boolean; tech: number; isps: number;
  /** dwelling-weighted share of homes within TOWN_KM offered 50/10 (from band midpoints) */
  share50: number | null;
  /** past-year tests-weighted download within TOWN_KM, latest quarter and the first full year (2019) */
  fixed: number | null; mobile4: number | null; fixedTests: number; mobileTests: number;
  fixed0: number | null; mobile0: number | null; latest: string; first: string;
};

/** Internet at a town centre: what providers report for its hexagon, and what people measured nearby. */
const townCache = new WeakMap<Internet, Map<string, TownNet | null>>();
export function townNet(I: Internet, m: Muni): TownNet | null {
  let c = townCache.get(I);
  if (!c) townCache.set(I, (c = new Map()));
  if (!c.has(m.key)) c.set(m.key, townNetOf(I, m));
  return c.get(m.key)!;
}
function townNetOf(I: Internet, m: Muni): TownNet | null {
  const d = derive(I);
  const h = hexAt(I, m.lon, m.lat);
  if (h < 0) return null;
  const near: number[] = [];
  I.hexes.forEach((x, i) => { if (km(m.lon, m.lat, x[0], x[1]) <= TOWN_KM) near.push(i); });
  let dw = 0, dws = 0;
  for (const i of near) { dw += I.hexes[i][2] * BAND_MID[I.hexes[i][3]]; dws += I.hexes[i][2]; }
  const Q = I.quarters.length;
  const pooled = (k: Kind, q: number) => {
    let s = 0, w = 0;
    for (const i of near) { const v = d.roll[k][q][i]; if (!Number.isNaN(v)) { s += v * d.rollN[k][q][i]; w += d.rollN[k][q][i]; } }
    return { v: w >= 20 ? s / w : null, n: w };
  };
  const f = pooled('fixed', Q - 1), mo = pooled('mobile', Q - 1);
  const q0 = Math.min(3, Q - 1);
  const x = I.hexes[h];
  return {
    hex: h, band: x[3], a5: !!x[4], mobile: !!(x[5] & MOBILE), tech: x[5], isps: x[6],
    share50: dws ? dw / dws : null,
    fixed: f.v, mobile4: mo.v, fixedTests: f.n, mobileTests: mo.n,
    fixed0: pooled('fixed', q0).v, mobile0: pooled('mobile', q0).v,
    latest: I.quarters[Q - 1], first: I.quarters[q0],
  };
}

export type ParcelNet = { band: number; mobile: boolean; fixed: number | null };
/** Per-parcel values for the Land Finder: the 50/10 band and mobile service of the hexagon, and its past-year measured speed. */
export function parcelNet(I: Internet, lon: number, lat: number): ParcelNet | null {
  const h = hexAt(I, lon, lat);
  if (h < 0) return null;
  const d = derive(I);
  const v = d.roll.fixed[I.quarters.length - 1][h];
  return { band: I.hexes[h][3], mobile: !!(I.hexes[h][5] & MOBILE), fixed: Number.isNaN(v) ? null : v };
}

const techList = (mask: number) => TECHS.filter(([b]) => mask & b).map(([, n]) => n);
const mbps = (v: number | null) => (v == null ? '—' : v >= 100 ? `${Math.round(v)} Mbps` : `${v.toFixed(v < 10 ? 1 : 0)} Mbps`);

/** The Town Report's internet line. */
export function internetMetric(data: Data, m: Muni, metric: (l: string, dot: string, v: string, sub: string) => string, na: string) {
  if (!data.internet) return '';
  const t = townNet(data.internet, m);
  if (!t) return metric('Internet', NET_COLOR, na, 'outside the broadband map’s hexagons');
  const share = t.share50 != null ? `${Math.round(t.share50 * 100)}%` : BANDS[t.band];
  const jump = t.fixed != null && t.fixed0 ? ` (${Math.round(t.fixed0)} Mbps in ${t.first.slice(0, 4)})` : '';
  return metric('Internet', NET_COLOR, t.fixed != null ? mbps(t.fixed) : na,
    `${t.fixed != null ? `measured home download, past year within ${TOWN_KM} km${jump}<br>` : 'too few home speed tests nearby<br>'}~${share} of homes nearby offered 50/10 Mbps · mobile ${t.mobile ? `yes${t.mobile4 != null ? `, ${mbps(t.mobile4)} measured` : ''}` : 'not reported'}`);
}

// ---------------------------------------------------------------------------------------------
// the layer

let mode: Mode = 'fixed';

export function internetLayer(data: Data): AtlasLayer {
  const color = NET_COLOR;
  const I = data.internet;
  const d = I ? derive(I) : null;
  const H = I?.hexes.length ?? 0;
  const near = (lon: number, lat: number) => {
    let best = data.munis[0], bd = Infinity;
    for (const m of data.munis) { const x = km(lon, lat, m.lon, m.lat); if (x < bd) { bd = x; best = m; } }
    return { m: best, km: bd };
  };
  // hexagon outlines, shrunk a little so neighbours read as separate columns with dark seams
  const ring = (i: number, s: number): [number, number][] => {
    const [lon, lat] = I!.hexes[i];
    const r = (I!.hex.r / 1000) * s, a0 = (I!.hex.angle * Math.PI) / 180;
    return Array.from({ length: 6 }, (_, k) => { const a = a0 + (k * Math.PI) / 3; return [lon + (Math.cos(a) * r) / KX, lat + (Math.sin(a) * r) / KY] as [number, number]; });
  };
  const idx = Array.from({ length: H }, (_, i) => i);
  const cols = I ? idx.map((i) => ({ i, poly: ring(i, 0.8) })) : [];
  const ground = I ? idx.map((i) => ({ i, poly: ring(i, 0.97) })) : [];
  const homes = (i: number) => I!.hexes[i][2];
  /** Populated, and providers report neither 50/10 Mbps nor mobile service. */
  const dead = (i: number) => homes(i) > 0 && I!.hexes[i][3] === 0 && !(I!.hexes[i][5] & MOBILE);
  const deadIdx = idx.filter(dead);
  const homesTotal = d3.sum(idx, homes);
  const homes50 = d3.sum(idx, (i) => homes(i) * BAND_MID[I!.hexes[i][3]]);
  const homesMobile = d3.sum(idx, (i) => (I!.hexes[i][5] & MOBILE ? homes(i) : 0));
  const homesDead = d3.sum(deadIdx, homes);

  // towns: past-year speeds within TOWN_KM at every quarter, for the jumps and the events
  const towns = I ? data.munis.map((m) => ({ m, t: townNet(I, m) })).filter((x) => x.t && x.t.fixed != null && x.t.fixed0 != null) : [];
  const jumps = towns.map((x) => ({ m: x.m, a: x.t!.fixed0!, b: x.t!.fixed!, r: x.t!.fixed! / x.t!.fixed0! })).sort((p, q) => q.r - p.r);
  const townSeries = (m: Muni, k: Kind) => {
    const nearI = idx.filter((i) => km(m.lon, m.lat, I!.hexes[i][0], I!.hexes[i][1]) <= TOWN_KM);
    return I!.quarters.map((q, qi) => {
      let s = 0, w = 0;
      for (const i of nearI) { const v = d!.roll[k][qi][i]; if (!Number.isNaN(v)) { s += v * d!.rollN[k][qi][i]; w += d!.rollN[k][qi][i]; } }
      return { x: qMid(q), y: w >= 20 ? s / w : null };
    });
  };
  // towns to label on the map: the busiest hexagons first, none within 15 km of one already labelled
  const labelTowns: { m: Muni; hex: number }[] = [];
  for (const x of towns.map((x) => ({ m: x.m, hex: x.t!.hex })).sort((a, b) => homes(b.hex) - homes(a.hex)))
    if (!labelTowns.some((y) => km(x.m.lon, x.m.lat, y.m.lon, y.m.lat) < 15)) labelTowns.push(x);
  /** When a town's past-year speed first passed double its 2019 level. */
  const doubledAt = (m: Muni, base: number) => townSeries(m, 'fixed').find((p, qi) => qi >= 4 && p.y != null && p.y >= 2 * base);

  let shownT = d?.t1 ?? 2026;
  const l: AtlasLayer = {
    id: 'internet',
    name: 'Internet & cell',
    icon: '⌁',
    color,
    range: d ? [d.t0, d.t1] : [2019, 2026.99],
    monthly: true,
    available: !!I,
    unavailable: 'The broadband data hasn’t been built yet. Run <code>npm run data internet</code> to fetch ISED’s National Broadband Data and Ookla’s speed tests, then reload.',
    build({ time, focusedId }) {
      if (!I || !d) return [];
      shownT = time;
      const t = Math.min(d.t1, Math.max(d.t0, time));
      const sp = mode === 'advertised' ? null : idx.map((i) => speedAt(d, mode as Kind, i, t));
      const valueOf = (i: number) => (sp ? sp[i] : homes(i) > 0 && I.hexes[i][3] > 0 ? I.hexes[i][3] : null);
      const elev = (i: number) => { const v = valueOf(i); return v == null ? 0 : sp ? elevOf(v) : 900 + v * 1500; };
      const colOf = (i: number) => { const v = valueOf(i)!; return sp ? speedRamp(v) : BAND_COLOR[v]; };
      const live = cols.filter((c) => valueOf(c.i) != null);
      const trig = mode === 'advertised' ? 'adv' : `${mode}|${Math.round(t * 48)}`;
      const layers: Layer[] = [
        // the whole grid as faint glass on the ground; dead zones as dark ember-red cells
        new PolygonLayer<any>({
          id: 'internet-base',
          data: ground,
          getPolygon: (c) => c.poly,
          stroked: true,
          filled: true,
          getFillColor: (c) => (dead(c.i) ? [120, 22, 48, 120] : homes(c.i) > 0 ? [125, 211, 252, 14] : [125, 211, 252, 5]),
          getLineColor: (c) => (dead(c.i) ? [255, 90, 120, 120] : [125, 211, 252, 34]),
          lineWidthMinPixels: 0.5,
          // it covers the islands, so it would swallow clicks meant for other layers unless this one is active
          pickable: focusedId === 'internet',
          parameters: NO_DEPTH,
        }),
        // a soft glow under every fast cell
        new ScatterplotLayer<any>({
          id: 'internet-glow',
          data: live,
          getPosition: (c) => [I.hexes[c.i][0], I.hexes[c.i][1]],
          getRadius: I.hex.r * 1.15,
          getFillColor: (c) => rgb(colOf(c.i), sp ? Math.min(70, 8 + Math.sqrt(valueOf(c.i)!) * 3) : 22 + valueOf(c.i)! * 8),
          updateTriggers: { getFillColor: trig },
          parameters: ADDITIVE,
        }),
        new PolygonLayer<any>({
          id: 'internet-cols',
          data: live,
          getPolygon: (c) => c.poly,
          extruded: true,
          wireframe: false,
          getElevation: (c) => elev(c.i),
          getFillColor: (c) => rgb(colOf(c.i), 238),
          material: { ambient: 0.62, diffuse: 0.55, shininess: 60, specularColor: [200, 230, 255] },
          pickable: true,
          transitions: mode === 'advertised' ? { getElevation: { duration: 600, easing: d3.easeCubicOut } } : undefined,
          updateTriggers: { getElevation: trig, getFillColor: trig },
        }),
      ];
      if (focusedId === 'internet' && sp) {
        const lab = labelTowns.map((x) => ({ m: x.m, v: speedAt(d, mode as Kind, x.hex, t) })).filter((x) => x.v != null);
        layers.push(new TextLayer<any>({
          id: 'internet-labels',
          data: lab,
          getPosition: (x) => [x.m.lon, x.m.lat, elevOf(x.v!) + 1800],
          getText: (x) => `${x.m.name} ${Math.round(x.v!)}`,
          getSize: 12,
          getColor: [235, 248, 255, 235],
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 600,
          outlineWidth: 3,
          outlineColor: [6, 10, 18, 220],
          fontSettings: { sdf: true },
          billboard: true,
          updateTriggers: { getText: trig, getPosition: trig },
          parameters: NO_DEPTH,
        } as any));
      }
      return layers;
    },
    spark: () => (d ? I!.quarters.map((q, i) => ({ x: qMid(q), y: d.island.fixed[i] ?? 0, color: speedRamp(d.island.fixed[i] ?? 5) })) : []),
    events() {
      if (!I || !d) return [];
      const out: TimedEvent[] = [];
      // the island's average home download first passing round numbers
      for (const mark of [100, 200, 300]) {
        const qi = d.island.fixed.findIndex((v) => v != null && v >= mark);
        if (qi > 0) out.push({
          t: qMid(I.quarters[qi]), layer: 'internet', title: `Island home internet passes ${mark} Mbps`,
          body: `In ${qLabel(I.quarters[qi])}, the average Speedtest result on a home connection across the islands reached ${Math.round(d.island.fixed[qi]!)} Mbps, against ${Math.round(d.island.fixed[0] ?? 0)} Mbps in ${qLabel(I.quarters[0])}.`,
          stats: [{ v: `${Math.round(d.island.fixed[qi]!)} Mbps`, l: `average home download, ${qLabel(I.quarters[qi])}` }, { v: `${Math.round(d.island.fixed[0] ?? 0)} Mbps`, l: qLabel(I.quarters[0]) }],
          lon: -124.9, lat: 49.4, zoom: 7,
        });
      }
      // the towns whose measured speeds jumped most
      for (const j of jumps.filter((x) => x.r >= 2).slice(0, 4)) {
        const at = doubledAt(j.m, j.a);
        if (!at) continue;
        out.push({
          t: at.x, layer: 'internet', title: `${j.m.name}: home internet speeds double`,
          body: `Within ${TOWN_KM} km of ${j.m.name}, the average home Speedtest over the past year passed ${Math.round(at.y!)} Mbps, twice its 2019 level of ${Math.round(j.a)} Mbps. It now stands at ${Math.round(j.b)} Mbps.`,
          stats: [{ v: `${Math.round(j.a)} → ${Math.round(j.b)}`, l: 'Mbps, 2019 to the latest year' }, { v: `×${j.r.toFixed(1)}`, l: 'faster' }],
          lon: j.m.lon, lat: j.m.lat, zoom: 9.5,
          detail: (el) => seriesChart(el, `Past-year download near ${j.m.name}`, townSeries(j.m, 'fixed'), townSeries(j.m, 'mobile')),
        });
      }
      return out;
    },
    panel(el) {
      el.innerHTML = `<div class="kicker" style="--c:${color}">Internet &amp; cell · advertised and measured</div>
        <h2>Who gets fast internet</h2>`;
      if (!I || !d) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const Q = I.quarters.length;
      el.insertAdjacentHTML('beforeend', `<p class="lede">Working from home on acreage lives or dies on the connection. Each hexagon is about 25 km². In the measured views a column’s <b>height and colour are the average download speed</b> people actually got on Speedtest over the past year; press ▶ to watch it spread from 2019. Dark red cells are homes where providers report <b>neither 50/10 Mbps nor mobile service</b>.</p>
        <div class="chips net-mode" style="margin:2px 0 10px">${([['fixed', 'Home internet (measured)'], ['mobile', 'Mobile (measured)'], ['advertised', 'Advertised 50/10']] as [Mode, string][]).map(([k, t]) => `<button class="chip${k === mode ? ' on' : ''}" data-mode="${k}" style="--c:${color}">${t}</button>`).join('')}</div>`);
      const heroEl = document.createElement('div');
      heroEl.className = 'hero';
      heroEl.innerHTML = Array.from({ length: 4 }, () => '<div class="stat"><div class="v">–</div><div class="l"></div></div>').join('');
      el.appendChild(heroEl);
      const cells = [...heroEl.querySelectorAll('.stat')].map((s) => ({ v: s.querySelector('.v') as HTMLElement, l: s.querySelector('.l') as HTMLElement }));
      const hero = (i: number, v: string, lab: string) => { if (cells[i].v.textContent !== v) cells[i].v.textContent = v; if (cells[i].l.textContent !== lab) cells[i].l.textContent = lab; };
      el.insertAdjacentHTML('beforeend', '<h3>Average download across the islands, by quarter</h3>');
      const chartBox = el.appendChild(document.createElement('div'));
      let chart: ChartHandle | null = null;
      requestAnimationFrame(() => {
        chart = lineChart(chartBox, {
          height: 130, xDomain: [qMid(I.quarters[0]), qMid(I.quarters[Q - 1])], yFormat: (v) => `${v}`, valueFormat: (v) => `${Math.round(v)} Mbps`,
          series: [
            { key: 'f', label: 'Home internet', color: '#5eead4', values: I.quarters.map((q, i) => ({ x: qMid(q), y: d.island.fixed[i] ?? NaN })).filter((p) => !Number.isNaN(p.y)) },
            { key: 'm', label: 'Mobile', color: '#f2a33a', values: I.quarters.map((q, i) => ({ x: qMid(q), y: d.island.mobile[i] ?? NaN })).filter((p) => !Number.isNaN(p.y)) },
          ],
        });
      });
      const top = jumps.slice(0, 6);
      const deadTop = [...deadIdx].sort((a, b) => homes(b) - homes(a)).slice(0, 6).map((i) => ({ i, n: near(I.hexes[i][0], I.hexes[i][1]) }));
      const slow = towns.filter((x) => x.t!.fixed! < 50).sort((a, b) => a.t!.fixed! - b.t!.fixed!).slice(0, 4);
      el.insertAdjacentHTML('beforeend', `
        <h3>Biggest jumps since 2019 <span class="tk">home download within ${TOWN_KM} km of the centre</span></h3>
        <div class="legend" style="display:grid;gap:5px">${top.map((j) => `<span><b>${esc(j.m.name)}</b> · ${Math.round(j.a)} → <b style="color:${speedRamp(j.b)}">${Math.round(j.b)} Mbps</b> <span class="tk">×${j.r.toFixed(1)}</span></span>`).join('')}</div>
        ${slow.length ? `<h3>Still slow</h3><div class="legend" style="display:grid;gap:5px">${slow.map((x) => `<span><b>${esc(x.m.name)}</b> · <b style="color:${speedRamp(x.t!.fixed!)}">${mbps(x.t!.fixed)}</b> <span class="tk">past year, ~${x.t!.share50 != null ? Math.round(x.t!.share50 * 100) : '?'}% of homes offered 50/10</span></span>`).join('')}</div>` : ''}
        <h3>Dead zones <span class="tk">homes with no 50/10 and no mobile reported</span></h3>
        ${deadTop.length ? `<div class="legend" style="display:grid;gap:5px">${deadTop.map((x) => `<span>~${homes(x.i)} homes · <b>${Math.round(x.n.km)} km from ${esc(x.n.m.name)}</b> <span class="tk">${esc(techList(I.hexes[x.i][5]).join(', ') || 'no provider listed')}</span></span>`).join('')}</div>` : '<p class="note">None: every populated hexagon has 50/10 or mobile service reported.</p>'}
        <h3>Measured download speed</h3>
        <div class="ramp" style="background:${rampCSS((x) => speedRamp(5 * 120 ** x))}"></div>
        <div class="ramp-labels"><span>5</span><span>25</span><span>100</span><span>600 Mbps</span></div>
        <div class="callout" style="--c:${color}"><b>Advertised is not measured.</b> Providers report to ISED where they can offer a speed; Speedtest shows what people got, which also depends on the plan they bought and their Wi-Fi. Across the islands about <b>${Math.round((homes50 / homesTotal) * 100)}%</b> of homes are offered 50/10 Mbps and ${homesTotal - homesMobile < 0.005 * homesTotal ? `all but about <b>${Math.round(homesTotal - homesMobile).toLocaleString('en-CA')}</b> live where mobile service is reported` : `<b>${Math.round((homesMobile / homesTotal) * 100)}%</b> live where mobile service is reported`}, while about <b>${Math.round(homesDead).toLocaleString('en-CA')}</b> homes sit in ${deadIdx.length} hexagons with neither.</div>
        <p class="note">Hexagon shares are ISED’s bands (none, under 25%, 25–50%, 50–75%, over 75% of homes), and home counts are its 2021 estimates, so totals are approximate. A hexagon’s 50/10 band covers the whole cell, so a parcel in a “50–75%” cell may or may not be served: ask the provider for the address. Speedtest averages weight each ~600 m tile by its number of tests over the past four quarters; cells need at least one test, so quiet rural cells flicker in and out. Starlink and other satellite tests count as home internet in Ookla’s data; ISED lists satellite providers but does not count them toward 50/10.</p>
        <div class="source">Source: ${esc(I.source)}. Speedtest® data © Ookla, used under CC BY-NC-SA 4.0 for this non-commercial atlas.</div>`);
      el.querySelector('.net-mode')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
        if (!b) return;
        mode = b.dataset.mode as Mode;
        el.querySelectorAll<HTMLElement>('.net-mode .chip').forEach((c) => c.classList.toggle('on', c.dataset.mode === mode));
      });
      return {
        update({ time }) {
          const t = Math.min(d.t1, Math.max(d.t0, time));
          const qi = quarterAt(d, t);
          const yr = (k: Kind) => { let s = 0, w = 0; for (let h = 0; h < H; h++) { const v = d.roll[k][qi][h]; if (!Number.isNaN(v)) { s += v * d.rollN[k][qi][h]; w += d.rollN[k][qi][h]; } } return w ? s / w : null; };
          const f = yr('fixed'), m = yr('mobile');
          let fast = 0, tested = 0;
          for (let h = 0; h < H; h++) { const v = d.roll.fixed[qi][h]; if (!Number.isNaN(v) && homes(h) > 0) { tested += homes(h); if (v >= 100) fast += homes(h); } }
          hero(0, mbps(f), `home download, year to ${qLabel(I.quarters[qi])}`);
          hero(1, mbps(m), 'mobile download, same year');
          hero(2, tested ? `${Math.round((fast / tested) * 100)}%` : '–', 'of homes in tested cells get 100+ Mbps on average');
          hero(3, `${deadIdx.length}`, `dead-zone cells (~${Math.round(homesDead).toLocaleString('en-CA')} homes)`);
          chart?.setPlayhead(t);
        },
      };
    },
    describe(info) {
      const c: any = info.object;
      if (!I || !d || c?.i == null || !info.layer?.id.startsWith('internet')) return null;
      const i: number = c.i, x = I.hexes[i], n = near(x[0], x[1]);
      const series = (k: Kind) => I.quarters.map((q, qi) => ({ x: qMid(q), y: Number.isNaN(d.roll[k][qi][i]) ? null : d.roll[k][qi][i] }));
      const Q = I.quarters.length;
      const f = d.roll.fixed[Q - 1][i], m = d.roll.mobile[Q - 1][i];
      return {
        layer: 'internet', kind: 'Broadband hexagon (~25 km²)', lon: x[0], lat: x[1], zoom: 10,
        title: `${Math.round(n.km)} km from ${n.m.name}`,
        body: `${x[2] ? `About ${x[2]} homes (2021). ` : 'No homes counted here in 2021. '}Providers report ${BANDS[x[3]] === 'none' ? 'no 50/10 Mbps service' : `50/10 Mbps for ${BANDS[x[3]]} of homes`}${x[5] & MOBILE ? ' and mobile service' : ' and no mobile service'}${dead(i) ? ': a dead zone' : ''}.`,
        stats: [
          { v: Number.isNaN(f) ? '—' : mbps(f), l: `home download, past year (${Math.round(d.rollN.fixed[Q - 1][i])} tests)` },
          { v: Number.isNaN(m) ? '—' : mbps(m), l: `mobile download, past year (${Math.round(d.rollN.mobile[Q - 1][i])} tests)` },
          { v: BANDS[x[3]], l: 'of homes offered 50/10 Mbps' },
          { v: `${x[6]}`, l: `provider${x[6] === 1 ? '' : 's'} besides satellite · ${techList(x[5]).join(', ') || 'none listed'}` },
        ],
        detail: (el) => seriesChart(el, 'Past-year download in this hexagon', series('fixed'), series('mobile')),
        sources: [
          { label: 'National Broadband Data (Open Government Portal)', url: 'https://open.canada.ca/data/en/dataset/00a331db-121b-445d-b119-35dbbe3eedd9' },
          { label: 'Ookla open data (GitHub)', url: 'https://github.com/teamookla/ookla-open-data' },
        ],
      };
    },
    tooltip(info) {
      const c: any = info.object;
      if (!I || !d || c?.i == null || !info.layer?.id.startsWith('internet')) return null;
      const i: number = c.i, x = I.hexes[i], n = near(x[0], x[1]);
      const t = Math.min(d.t1, Math.max(d.t0, shownT)), qi = quarterAt(d, t);
      const f = d.roll.fixed[qi][i], m = d.roll.mobile[qi][i];
      return `<b>${Math.round(n.km)} km from ${esc(n.m.name)}</b>${dead(i) ? ' · dead zone' : ''}
        <br><span class="tk">Homes (2021)</span> <span class="tv">${x[2] ? `~${x[2]}` : 'none counted'}</span>
        <br><span class="tk">Offered 50/10</span> <span class="tv">${x[3] ? `${BANDS[x[3]]} of homes` : 'no homes'}</span>
        <br><span class="tk">Mobile</span> <span class="tv">${x[5] & MOBILE ? 'reported' : 'not reported'}</span>
        <br><span class="tk">Home, year to ${qLabel(I.quarters[qi])}</span> <span class="tv">${Number.isNaN(f) ? 'no tests' : `${mbps(f)} (${Math.round(d.rollN.fixed[qi][i])} tests)`}</span>
        <br><span class="tk">Mobile, same year</span> <span class="tv">${Number.isNaN(m) ? 'no tests' : `${mbps(m)} (${Math.round(d.rollN.mobile[qi][i])} tests)`}</span>`;
    },
  };
  return l;
}

/** A small chart of past-year home and mobile download for an event or a hexagon's panel. */
function seriesChart(el: HTMLElement, title: string, fixed: { x: number; y: number | null }[], mobile: { x: number; y: number | null }[]) {
  const f = fixed.filter((p) => p.y != null) as { x: number; y: number }[], m = mobile.filter((p) => p.y != null) as { x: number; y: number }[];
  if (!f.length && !m.length) return;
  el.insertAdjacentHTML('beforeend', `<h3>${esc(title)}</h3>`);
  const box = el.appendChild(document.createElement('div'));
  box.className = 'ev-chart';
  const xs = [...f, ...m].map((p) => p.x);
  requestAnimationFrame(() => lineChart(box, {
    height: 120, xDomain: [Math.min(...xs), Math.max(...xs)], valueFormat: (v) => `${Math.round(v)} Mbps`,
    series: [{ key: 'f', label: 'Home internet', color: '#5eead4', values: f }, { key: 'm', label: 'Mobile', color: '#f2a33a', values: m }],
  }));
}
