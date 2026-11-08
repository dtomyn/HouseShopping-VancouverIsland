// Each "atlas layer" bundles: deck.gl layers for a moment in time, a timeline sparkline,
// notable events, a story panel, and map tooltips.
import * as d3 from 'd3';
import { BitmapLayer, ColumnLayer, LineLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { DataFilterExtension, PathStyleExtension } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, FutureTown, FutureVar, Facility, FirePerimeter, FirePoint, MONTHS, Muni, NormalsStation, Quake, SmokeStation, Trip, fmt, interpYearly, km, lowerBound, trailingMedianPrice } from './data';
import { barChart, lineChart, rampCSS, scatterChart, stripes, ChartHandle } from './charts';
import { NormalVar, islandAnomalies, slope, townMetrics } from './metrics';
import { trailsLayer } from './trails';
import { wellsLayer } from './wells';
import { internetLayer } from './internet';
import { tsunamiLayer } from './tsunami';
import { floodLayer } from './flood';
import { loggingLayer } from './logging';
import { campingLayer, waterLayer } from './outdoors';
import { snowLayer } from './snow';
import { esc } from './html';

/** `hovered` is the municipality key under the pointer (town pin or column), if any. */
export type Ctx = { time: number; speed: number; data: Data; selected: string | null; hovered: string | null; focusedId: string; clock: number };
/**
 * A moment on the timeline. Only `t`, `layer` ('*' for island-wide), `title` and `body` are required; everything else
 * deepens the event's own view in the side panel (src/events.ts), so an event can be given more detail later without
 * touching the panel. Text fields are plain text (escaped when shown); only `detail` can draw HTML or charts.
 */
export type AtlasEvent = {
  /** when it happened; left out for a place or thing on the map (a river gauge, a station, a hospital) */
  t?: number;
  layer: string; title: string; body: string;
  /** what it is, shown above the title ("River gauge", "Earthquake"); defaults to the layer's name */
  kind?: string;
  /** where the map flies when the event opens */
  lon?: number; lat?: number; zoom?: number;
  /** when it ended, for events that ran a while (a fire season, a closure) */
  end?: number;
  /** headline numbers, shown as tiles */
  stats?: { v: string; l: string }[];
  /** further reading inside the panel: a heading and paragraphs */
  sections?: { title: string; text: string }[];
  /** a photo (http(s) only) with its credit */
  image?: { src: string; credit: string; href?: string };
  /** where to read more */
  sources?: { label: string; url: string }[];
  /** layers that tell this story; "Show it on the map" switches them on (defaults to the event's own layer) */
  layers?: string[];
  /** anything richer a layer wants to draw in the event's panel (a chart, a table), below the headline numbers */
  detail?: (el: HTMLElement) => void;
};
/** A timeline event: one with a date. Layers' events() and CURATED_EVENTS are always these. */
export type TimedEvent = AtlasEvent & { t: number };
export type PanelHandle = { update: (ctx: Ctx) => void };

export interface AtlasLayer {
  id: string;
  name: string;
  icon: string;
  color: string;
  range: [number, number];
  monthly?: boolean;
  /**
   * Doesn't change over time (hospitals, hazard zones, 30-year normals). When focused, the timeline
   * dims and keeps the last time-based layer's range and time, so other visible layers keep animating.
   * `build` should ignore `ctx.time`; `spark` and `events` may return [].
   */
  static?: boolean;
  /** Rail caption for a static layer instead of the year range, e.g. "1981–2010 average". */
  period?: string;
  available: boolean;
  unavailable?: string;
  build: (ctx: Ctx) => Layer[];
  spark: () => { x: number; y: number; color?: string }[];
  events: () => TimedEvent[];
  /**
   * What clicking a feature of this layer on the map opens in the side panel (a quake, a gauge, a station), in the
   * same shape as an event. Optional: a layer without it still gets a panel, built from its tooltip.
   */
  describe?: (info: PickingInfo) => AtlasEvent | null;
  panel: (el: HTMLElement, ctx: Ctx) => PanelHandle;
  tooltip: (info: PickingInfo) => string | null;
  /** Handles a click on one of its own map objects; true if it did. */
  click?: (info: PickingInfo) => boolean;
}

// ---------------------------------------------------------------------------------------------
// shared bits

type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => {
  const o = d3.rgb(c);
  return [o.r, o.g, o.b, a];
};
const ADDITIVE = { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false } as const;
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
const filterExt = [new DataFilterExtension({ filterSize: 1 })];

/** How long (in timeline years) a "new" event keeps glowing; tied to playback speed so it reads the same at any speed. */
const glowWindow = (speed: number, k = 1) => Math.max(0.25, speed * 0.9 * k);

/** A fractional year (2021.49) as a date, "2021-06-28". */
const isoDate = (t: number) => new Date(Date.UTC(Math.floor(t), 0, 1) + (t % 1) * 365.25 * 864e5).toISOString().slice(0, 10);
/** A detail chart for a map feature's panel: a heading and a bar chart, drawn once the panel has its width. */
function detailBars(title: string, data: { x: number; y: number; color?: string }[], color: string, yFormat: (v: number) => string, tip: (d: { x: number; y: number }) => string) {
  return (el: HTMLElement) => {
    if (!data.length) return;
    el.insertAdjacentHTML('beforeend', `<h3>${esc(title)}</h3>`);
    const box = el.appendChild(document.createElement('div'));
    box.className = 'ev-chart';
    const xs = data.map((d) => d.x);
    requestAnimationFrame(() => barChart(box, { data, xDomain: [Math.min(...xs), Math.max(...xs)], color, height: 120, yFormat, tooltip: tip, diverging: data.some((d) => d.y < 0) }));
  };
}

export function nearestTown(munis: Muni[], lon: number, lat: number) {
  let best = munis[0], bd = Infinity;
  for (const m of munis) {
    const d = km(lon, lat, m.lon, m.lat);
    if (d < bd) { bd = d; best = m; }
  }
  return { town: best, km: bd };
}

const kicker = (l: AtlasLayer, text: string) => `<div class="kicker" style="--c:${l.color}">${text}</div>`;
const sourceLine = (s: string) => `<div class="source">Source: ${esc(s)}</div>`;
const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

function heroStats(el: HTMLElement, n: number) {
  const wrap = mk('div', 'hero');
  const cells = Array.from({ length: n }, () => {
    const s = mk('div', 'stat', '<div class="v">–</div><div class="l"></div>');
    wrap.appendChild(s);
    return { v: s.querySelector('.v') as HTMLElement, l: s.querySelector('.l') as HTMLElement };
  });
  el.appendChild(wrap);
  return (i: number, v: string, l: string) => {
    if (cells[i].v.textContent !== v) cells[i].v.textContent = v;
    if (cells[i].l.textContent !== l) cells[i].l.textContent = l;
  };
}

/** Builds charts after the panel is in the DOM (they need a measured width). */
function deferChart(el: HTMLElement, make: (el: HTMLElement) => ChartHandle) {
  let h: ChartHandle | null = null;
  requestAnimationFrame(() => (h = make(el)));
  return (t: number) => h?.setPlayhead(t);
}

// ---------------------------------------------------------------------------------------------
// WILDFIRES

function firesLayer(data: Data): AtlasLayer {
  const color = '#ff8a3d';
  const fires = data.fires;
  const perims: FirePerimeter[] = fires ? [...fires.perimeters].sort((a, b) => a.t - b.t) : [];
  const points: FirePoint[] = fires?.points ?? [];
  const CAUSE = [
    { name: 'Lightning', c: '#ffe08a' },
    { name: 'Human', c: '#ff6a3d' },
    { name: 'Unknown', c: '#ffb36b' },
  ];
  const causeRGB = CAUSE.map((c) => rgb(c.c));

  // per-year totals (perimeters are listed once per fire, but flattened into parts)
  const haByYear: Record<number, number> = {};
  const seen = new Set<string>();
  const fireTotals = new Map<string, FirePerimeter & { total: number }>();
  for (const p of perims) {
    if (!seen.has(p.id)) { seen.add(p.id); haByYear[p.year] = (haByYear[p.year] ?? 0) + p.ha; fireTotals.set(p.id, { ...p, total: p.ha }); }
  }
  const countByYear: Record<number, number> = {};
  const causeByYear: Record<number, number[]> = {};
  for (const p of points) {
    const y = Math.floor(p[2]);
    countByYear[y] = (countByYear[y] ?? 0) + 1;
    (causeByYear[y] ??= [0, 0, 0])[p[4]]++;
  }
  const y0 = perims.length ? perims[0].year : 1919;
  const y1 = Math.max(perims.at(-1)?.year ?? 2026, Math.floor(points.at(-1)?.[2] ?? 2026));

  const l: AtlasLayer = {
    id: 'fires',
    name: 'Wildfires',
    icon: '🔥',
    color,
    range: [Math.min(y0, 1919), y1 + 0.99],
    available: !!fires,
    build({ time, speed }) {
      const W = glowWindow(speed);
      const lo = lowerBound(perims, time - W * 2.2, (p) => p.t);
      const hi = lowerBound(perims, time, (p) => p.t);
      const burning = perims.slice(lo, hi);
      const plo = lowerBound(points, time - W, (p) => p[2]);
      const phi = lowerBound(points, time, (p) => p[2]);
      const flashing = points.slice(plo, phi);
      return [
        new PolygonLayer<FirePerimeter>({
          id: 'fires-scars',
          data: perims,
          getPolygon: (d) => d.polygon,
          getFillColor: (d) => (d.year >= 2000 ? [168, 46, 20, 95] : [120, 34, 18, 75]),
          getLineColor: [255, 120, 60, 120],
          lineWidthUnits: 'pixels',
          getLineWidth: 0.6,
          pickable: true,
          extensions: filterExt,
          getFilterValue: (d) => d.t,
          filterRange: [1800, time],
          parameters: NO_DEPTH,
        } as any),
        new PolygonLayer<FirePerimeter>({
          id: 'fires-burning',
          data: burning,
          getPolygon: (d) => d.polygon,
          extruded: true,
          wireframe: false,
          getElevation: (d) => {
            const a = (time - d.t) / (W * 2.2);
            return (1 - a) * (600 + Math.sqrt(d.ha) * 40);
          },
          getFillColor: (d) => {
            const a = Math.min(1, (time - d.t) / (W * 2.2));
            const c = d3.rgb(d3.interpolateRgb('#fff3b0', '#ff3d00')(a));
            return [c.r, c.g, c.b, 235 - a * 150];
          },
          material: false,
          updateTriggers: { getElevation: time, getFillColor: time },
          pickable: true,
          parameters: ADDITIVE,
        } as any),
        new ScatterplotLayer<FirePoint>({
          id: 'fires-embers',
          data: points,
          getPosition: (d) => [d[0], d[1]],
          getRadius: (d) => 180 + Math.sqrt(d[3]) * 40,
          radiusMinPixels: 1,
          getFillColor: (d) => [...causeRGB[d[4]].slice(0, 3), 70] as RGBA,
          extensions: filterExt,
          getFilterValue: (d) => d[2],
          filterRange: [1800, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<FirePoint>({
          id: 'fires-flash',
          data: flashing,
          getPosition: (d) => [d[0], d[1]],
          getRadius: (d) => {
            const a = (time - d[2]) / W;
            return (900 + Math.sqrt(d[3]) * 120) * (0.4 + a * 1.6);
          },
          radiusMinPixels: 2,
          getFillColor: (d) => {
            const a = (time - d[2]) / W;
            const c = causeRGB[d[4]];
            return [c[0], c[1], c[2], 255 * (1 - a) ** 1.5] as RGBA;
          },
          updateTriggers: { getRadius: time, getFillColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
    spark: () => d3.range(l.range[0], y1 + 1).map((x) => ({ x, y: haByYear[x] ?? 0 })),
    events() {
      const big = [...fireTotals.values()].filter((f) => f.total >= 5000).sort((a, b) => a.t - b.t);
      const bySize = [...fireTotals.values()].sort((a, b) => b.total - a.total);
      return big.map((f) => {
        const { town, km: d } = nearestTown(data.munis, f.c[0], f.c[1]);
        return {
          stats: [
            { v: fmt.ha(f.total), l: 'burned' },
            { v: CAUSE[f.cause].name, l: 'cause' },
            { v: `#${bySize.indexOf(f) + 1}`, l: `largest of ${fmt.int(bySize.length)} mapped fires` },
          ],
          t: f.t,
          layer: 'fires',
          title: `${fmt.ha(f.total)} wildfire ${d < 8 ? 'at' : 'near'} ${town.name}`,
          body: `${CAUSE[f.cause].name}-caused fire${d >= 8 ? `, about ${Math.round(d)} km from ${town.name}` : ''}. One of the largest mapped fires on the island.`,
          lon: f.c[0], lat: f.c[1], zoom: 9,
        };
      });
    },
    panel(el, ctx) {
      el.innerHTML = `${kicker(l, 'Wildfire history · 1919 → today')}
        <h2>Where the island has burned</h2>
        <p class="lede">Every mapped fire perimeter since 1919 and every recorded ignition since 1950. Watch new fires flare, then settle into the landscape as burn scars. Most island fires are small and human-caused near roads and towns; the big ones are rarer — but they cluster in hot, dry summers.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Area burned per year (mapped perimeters)</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, { data: l.spark(), xDomain: [l.range[0], y1], color, height: 130, yFormat: (v) => d3.format('~s')(v), tooltip: (d) => `<b>${d.x}</b><br>${fmt.ha(d.y)} burned<br>${countByYear[d.x] ?? 0} ignitions` }),
      );
      const top = Object.entries(haByYear).sort((a, b) => b[1] - a[1]).slice(0, 3);
      el.insertAdjacentHTML('beforeend', `
        <div class="callout" style="--c:${color}">Worst years on record: ${top.map(([y, v]) => `<b>${y}</b> (${fmt.ha(v)})`).join(', ')}.</div>
        <h3>Ignition cause</h3>
        <div class="legend">${CAUSE.map((c) => `<span><i class="sw" style="background:${c.c}"></i>${c.name}</span>`).join('')}</div>
        <p class="note">Glowing dots are ignitions, sized by final fire size. Shaded shapes are mapped perimeters — BC Wildfire Service maps perimeters mainly for larger fires, so perimeter totals understate small-fire activity.</p>
        ${sourceLine(fires?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const cz = causeByYear[y] ?? [0, 0, 0];
          hero(0, fmt.int(countByYear[y] ?? 0), `ignitions in ${y}`);
          hero(1, fmt.ha(haByYear[y] ?? 0), `mapped burn area in ${y}`);
          const tot = cz[0] + cz[1] + cz[2];
          hero(2, tot ? `${Math.round((cz[1] / tot) * 100)}%` : '–', `human-caused in ${y}`);
          let cum = 0;
          for (const [yy, v] of Object.entries(haByYear)) if (+yy <= y) cum += v;
          hero(3, fmt.ha(cum), `burned since ${l.range[0]}`);
          set(time);
        },
      };
    },
    describe(info) {
      const o: any = info.object;
      const id = info.layer?.id ?? '';
      if (!o) return null;
      if (id.startsWith('fires-scars') || id.startsWith('fires-burning')) {
        const f = fireTotals.get(o.id) ?? { ...o, total: o.ha };
        const { town, km: d } = nearestTown(data.munis, f.c[0], f.c[1]);
        const bigger = [...fireTotals.values()].filter((x) => x.total > f.total).length;
        return {
          t: f.t, layer: 'fires', kind: 'Mapped wildfire', lon: f.c[0], lat: f.c[1], zoom: 10,
          title: `${fmt.ha(f.total)} wildfire ${d < 8 ? 'at' : 'near'} ${town.name}`,
          body: `Fire ${f.id}, mapped by the BC Wildfire Service in ${f.year}${d >= 8 ? `, about ${Math.round(d)} km from ${town.name}` : ''}.`,
          stats: [{ v: fmt.ha(f.total), l: 'burned' }, { v: CAUSE[f.cause].name, l: 'cause' }, { v: `#${bigger + 1}`, l: `largest of ${fmt.int(fireTotals.size)} mapped fires` }, { v: String(f.year), l: 'year' }],
          sources: [{ label: 'BC Wildfire Service fire perimeters (BC Data Catalogue)', url: 'https://catalogue.data.gov.bc.ca/dataset/fire-perimeters-historical' }],
        };
      }
      if (Array.isArray(o)) {
        const [lon, lat, t, ha, cause] = o as FirePoint;
        const { town, km: d } = nearestTown(data.munis, lon, lat);
        return {
          t, layer: 'fires', kind: 'Fire ignition', lon, lat, zoom: 10,
          title: `${ha < 1 ? 'A spot fire' : `A ${fmt.ha(ha)} fire`} ${d < 4 ? 'in' : 'near'} ${town.name}`,
          body: `Where a recorded fire started${d >= 4 ? `, about ${Math.round(d)} km from ${town.name}` : ''}. Most island fires are small and caught early.`,
          stats: [{ v: isoDate(t), l: 'started' }, { v: ha < 1 ? 'under 1 ha' : fmt.ha(ha), l: 'final size' }, { v: CAUSE[cause].name, l: 'cause' }],
          sources: [{ label: 'BC Wildfire Service fire incidents (BC Data Catalogue)', url: 'https://catalogue.data.gov.bc.ca/dataset/fire-incident-locations-historical' }],
        };
      }
      return null;
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o) return null;
      if (info.layer?.id.startsWith('fires-scars') || info.layer?.id.startsWith('fires-burning')) {
        const total = fireTotals.get(o.id)?.total ?? o.ha;
        return `<b>Fire ${o.id}</b><br><span class="tk">Size</span> <span class="tv">${fmt.ha(total)}</span><br><span class="tk">Cause</span> ${CAUSE[o.cause].name}`;
      }
      if (Array.isArray(o)) {
        const d = new Date(Date.UTC(Math.floor(o[2]), 0, 1) + (o[2] % 1) * 365.25 * 864e5);
        return `<b>Fire ignition</b><br><span class="tk">Date</span> <span class="tv">${d.toISOString().slice(0, 10)}</span><br><span class="tk">Final size</span> <span class="tv">${o[3] < 1 ? '<1 ha' : fmt.ha(o[3])}</span><br><span class="tk">Cause</span> ${CAUSE[o[4]].name}`;
      }
      return null;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// EARTHQUAKES

function quakesLayer(data: Data): AtlasLayer {
  const color = '#f9d65c';
  const rows: Quake[] = data.quakes?.rows ?? [];
  const EXAG = 3;
  const depthColor = d3.scaleSequential(d3.interpolateRgbBasis(['#fff1a8', '#ffb347', '#ff5f6d', '#b14aed', '#5b3cc4'])).domain([0, 45]).clamp(true);
  const depthRGB = (d: number, a: number) => rgb(depthColor(d), a);
  const radius = (m: number) => 600 * 1.9 ** (m - 2.5);
  const big = rows.filter((q) => q[3] >= 4);
  const countByYear: Record<number, number> = {};
  const maxByYear: Record<number, Quake> = {};
  for (const q of rows) {
    const y = Math.floor(q[4]);
    countByYear[y] = (countByYear[y] ?? 0) + 1;
    if (!maxByYear[y] || q[3] > maxByYear[y][3]) maxByYear[y] = q;
  }

  const l: AtlasLayer = {
    id: 'quakes',
    name: 'Earthquakes',
    icon: '◉',
    color,
    range: [1900, 2026.99],
    available: !!data.quakes,
    build({ time, speed }) {
      const W = glowWindow(speed, 1.4);
      const lo = lowerBound(rows, time - W, (q) => q[4]);
      const hi = lowerBound(rows, time, (q) => q[4]);
      const fresh = rows.slice(lo, hi);
      return [
        new LineLayer<Quake>({
          id: 'quakes-stems',
          data: big,
          getSourcePosition: (q) => [q[0], q[1], 0],
          getTargetPosition: (q) => [q[0], q[1], -q[2] * 1000 * EXAG],
          getColor: (q) => depthRGB(q[2], 60),
          getWidth: 1,
          extensions: filterExt,
          getFilterValue: (q) => q[4],
          filterRange: [1800, time],
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<Quake>({
          id: 'quakes-all',
          data: rows,
          getPosition: (q) => [q[0], q[1], -q[2] * 1000 * EXAG],
          getRadius: (q) => radius(q[3]) * 0.55,
          radiusMinPixels: 1.5,
          getFillColor: (q) => depthRGB(q[2], 150),
          stroked: true,
          getLineColor: [10, 14, 24, 160],
          lineWidthMinPixels: 0.5,
          pickable: true,
          extensions: filterExt,
          getFilterValue: (q) => q[4],
          filterRange: [1800, time],
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<Quake>({
          id: 'quakes-ripples',
          data: fresh.filter((q) => q[3] >= 3),
          getPosition: (q) => [q[0], q[1], 0],
          getRadius: (q) => radius(q[3]) * (0.5 + 5 * ((time - q[4]) / W)),
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1.5,
          getLineWidth: (q) => 300 + q[3] * 150,
          getLineColor: (q) => depthRGB(q[2], 255 * (1 - (time - q[4]) / W)),
          updateTriggers: { getRadius: time, getLineColor: time },
          parameters: ADDITIVE,
        }),
        new ScatterplotLayer<Quake>({
          id: 'quakes-flash',
          data: fresh,
          getPosition: (q) => [q[0], q[1], -q[2] * 1000 * EXAG],
          getRadius: (q) => radius(q[3]) * (1.6 - (time - q[4]) / W),
          radiusMinPixels: 3,
          getFillColor: (q) => [255, 250, 220, 255 * (1 - (time - q[4]) / W)],
          updateTriggers: { getRadius: time, getFillColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
    spark: () => d3.range(1900, 2027).map((x) => ({ x, y: countByYear[x] ?? 0 })),
    events() {
      return rows
        .filter((q) => q[3] >= 6.3 && nearestTown(data.munis, q[0], q[1]).km < 160)
        .map((q) => ({
          stats: [{ v: `M${q[3]}`, l: 'magnitude' }, { v: `${Math.round(q[2])} km`, l: 'deep' }, { v: `${Math.round(nearestTown(data.munis, q[0], q[1]).km)} km`, l: `from ${nearestTown(data.munis, q[0], q[1]).town.name}` }],
          t: q[4],
          layer: 'quakes',
          title: /1946/.test(q[5]) ? `M${q[3]} — the 1946 Vancouver Island earthquake` : `M${q[3]} earthquake`,
          body: /1946/.test(q[5])
            ? 'Canada’s largest recorded onshore earthquake. Chimneys toppled across the island; landslides and a small tsunami followed.'
            : `${q[5]} · depth ${q[2]} km.`,
          lon: q[0], lat: q[1], zoom: 7.4,
        }));
    },
    panel(el) {
      el.innerHTML = `${kicker(l, 'Seismic record · 1900 → today')}
        <h2>The restless coast</h2>
        <p class="lede">Vancouver Island sits above the Cascadia Subduction Zone, where the Juan de Fuca plate dives beneath North America. Each dot is an earthquake of magnitude 2.5+, drawn at its true location and <b>depth (×${EXAG} exaggeration)</b> — tilt the map to look underground.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Magnitude over time</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        scatterChart(c, {
          data: rows.map((q) => ({ x: q[4], y: q[3], r: Math.max(1.2, (q[3] - 2) ** 1.6 * 0.8), color: depthColor(q[2]), label: `<b>M${q[3]}</b> · ${Math.floor(q[4])}<br>${esc(q[5])}<br><span class="tk">depth</span> <span class="tv">${q[2]} km</span>` })),
          xDomain: [1900, 2027], yDomain: [2.5, 8], height: 150, yFormat: (v) => `M${v}`,
        }),
      );
      el.insertAdjacentHTML('beforeend', `
        <h3>Depth</h3>
        <div class="ramp" style="background:${rampCSS((t) => depthColor(t * 45))}"></div>
        <div class="ramp-labels"><span>surface</span><span>15 km</span><span>30 km</span><span>45+ km</span></div>
        <div class="callout" style="--c:${color}">The big one isn’t in this chart: on 26 January 1700 a magnitude ~9 Cascadia megathrust quake struck offshore, sending a tsunami across the Pacific to Japan. Geologists estimate such events recur every few hundred years.</div>
        <p class="note">The apparent rise in small quakes after the 1970s reflects better seismometers, not more shaking. Ripples mark new quakes as the timeline passes them.</p>
        ${sourceLine(data.quakes?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          hero(0, fmt.int(countByYear[y] ?? 0), `quakes M2.5+ in ${y}`);
          const m = maxByYear[y];
          hero(1, m ? `M${m[3]}` : '–', m ? `largest in ${y}` : `largest in ${y}`);
          const n = lowerBound(rows, time, (q) => q[4]);
          hero(2, fmt.int(n), `recorded since 1900`);
          let n4 = 0;
          for (const q of big) if (q[4] <= time) n4++;
          hero(3, fmt.int(n4), 'M4+ since 1900');
          set(time);
        },
      };
    },
    describe(info) {
      const q = info.object as Quake;
      if (!Array.isArray(q) || !info.layer?.id.startsWith('quakes')) return null;
      const near = nearestTown(data.munis, q[0], q[1]);
      const stronger = rows.filter((r) => r[3] > q[3]).length;
      const weaker = rows.filter((r) => r[3] < q[3]).length;
      const ord = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
      // the biggest few get their rank; "stronger than 100%" would just be rounding
      const rank = stronger < 10 ? `${stronger === 0 ? 'The strongest' : `The ${ord(stronger + 1)} strongest`} of the ${fmt.int(rows.length)} quakes recorded around the island since 1900.`
        : `Stronger than ${Math.floor((weaker / Math.max(1, rows.length)) * 100)}% of the ${fmt.int(rows.length)} quakes recorded around the island since 1900.`;
      const depth = q[2] < 20 ? 'Shallow quakes are felt most strongly close to where they strike.'
        : q[2] > 35 ? 'Deep quakes like this one, inside the sinking ocean plate, tend to be felt over a wide area.' : '';
      return {
        t: q[4], layer: 'quakes', kind: 'Earthquake', lon: q[0], lat: q[1], zoom: 8,
        // the catalogue's own place names can be odd ("km SW of Vernon"), so lead with the nearest atlas town
        title: `M${q[3]} earthquake`, body: `${near.km < 3 ? `At ${near.town.name}` : `About ${Math.round(near.km)} km from ${near.town.name}`}, ${q[2]} km deep. The USGS catalogue lists it as “${q[5]}”.`,
        stats: [{ v: `M${q[3]}`, l: 'magnitude' }, { v: `${q[2]} km`, l: 'deep' }, { v: isoDate(q[4]), l: 'date (UTC)' }, { v: `${Math.round(near.km)} km`, l: `from ${near.town.name}` }],
        sections: [{ title: 'How it compares', text: `${rank} ${depth}`.trim() }],
        sources: [{ label: 'USGS earthquake catalogue', url: 'https://earthquake.usgs.gov/earthquakes/search/' }],
      };
    },
    tooltip(info) {
      const q = info.object as Quake;
      if (!q || !info.layer?.id.startsWith('quakes')) return null;
      const d = new Date(Date.UTC(Math.floor(q[4]), 0, 1) + (q[4] % 1) * 365.25 * 864e5);
      return `<b>M${q[3]} earthquake</b><br>${esc(q[5])}<br><span class="tk">Date</span> <span class="tv">${d.toISOString().slice(0, 10)}</span><br><span class="tk">Depth</span> <span class="tv">${q[2]} km</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// SHAKING HAZARD — NRCan's 2020 seismic hazard model as a static colour surface under the quakes

type HazardPick = { lon: number; lat: number; v: number };
/** A bitmap whose pick reports the hazard value under the pointer (bitmaps have no objects of their own). */
class HazardBitmap extends BitmapLayer<{ valueAt: (lon: number, lat: number) => number | null }> {
  static layerName = 'HazardBitmap';
  getPickingInfo(params: any) {
    const info: any = super.getPickingInfo(params);
    const [lon, lat] = info.coordinate ?? [];
    const v = lon != null ? (this.props as any).valueAt(lon, lat) : null;
    info.object = v != null ? ({ lon, lat, v } as HazardPick) : null;
    return info;
  }
}

function seismicLayer(data: Data): AtlasLayer {
  const color = '#e86cff';
  const S = data.seismic;
  const ramp = d3.scaleSequential(d3.interpolateRgbBasis(['#24406a', '#5a4fcf', '#b356e0', color, '#ffd6f2'])).domain([0.3, 1.1]).clamp(true);
  const pct = (g: number) => `${Math.round(g * 100)}%`;
  type Row = { m: Muni; v: number; v10: number };
  const rows: Row[] = S ? data.munis.flatMap((m) => (S.towns[m.key] ? [{ m, v: S.towns[m.key][0], v10: S.towns[m.key][1] }] : [])) : [];
  rows.sort((a, b) => b.v - a.v);

  // bilinear interpolation of the model grid; edge cells average whichever corners exist
  const G = S?.grid;
  const valueAt = (lon: number, lat: number): number | null => {
    if (!G) return null;
    const fx = (lon - G.west) / G.dx, fy = (lat - G.south) / G.dy;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= G.nx - 1 || j >= G.ny - 1) return null;
    const tx = fx - i, ty = fy - j;
    let sum = 0, w = 0;
    for (const [di, dj, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const v = G.pga[(j + dj) * G.nx + i + di];
      if (v != null) { sum += v * wt; w += wt; }
    }
    return w > 0.15 ? sum / w : null;
  };
  // Web Mercator y, since the bitmap is stretched linearly in projected space
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const bounds: [number, number, number, number] = G ? [G.west, G.south, G.west + (G.nx - 1) * G.dx, G.south + (G.ny - 1) * G.dy] : [0, 0, 0, 0];
  let mask: Uint8ClampedArray | null = null;
  let image: HTMLCanvasElement | null = null;
  const W = 2048;
  const H = Math.round((W * (merc(bounds[3]) - merc(bounds[1]))) / (((bounds[2] - bounds[0]) * Math.PI) / 180));
  const px = (lon: number) => ((lon - bounds[0]) / (bounds[2] - bounds[0])) * W;
  const py = (lat: number) => ((merc(bounds[3]) - merc(lat)) / (merc(bounds[3]) - merc(bounds[1]))) * H;
  /** Paints the surface once: colour by value, faint 10%-g contour steps, clipped to the coastline. */
  const paint = () => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d')!;
    const img = c2.createImageData(W, H);
    const lut = d3.range(256).map((k) => d3.rgb(ramp(0.3 + (k / 255) * 0.8)));
    const m0 = merc(bounds[3]), m1 = merc(bounds[1]);
    const vals = new Float32Array(W * H).fill(NaN);
    for (let y = 0; y < H; y++) {
      const lat = (Math.atan(Math.exp(m0 - ((y + 0.5) / H) * (m0 - m1))) * 360) / Math.PI - 90;
      for (let x = 0; x < W; x++) vals[y * W + x] = valueAt(bounds[0] + ((x + 0.5) / W) * (bounds[2] - bounds[0]), lat) ?? NaN;
    }
    const band = (i: number) => Math.floor(vals[i] * 10);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, v = vals[i];
        if (Number.isNaN(v)) continue;
        const k = Math.max(0, Math.min(255, Math.round(((v - 0.3) / 0.8) * 255)));
        const c = lut[k];
        // thin bright line where the value crosses a 10%-of-gravity step
        const b = band(i);
        let edge = false;
        for (let d = 1; d <= 2 && !edge; d++)
          edge = (x + d < W && band(i + d) > b) || (y + d < H && band(i + d * W) > b) || (x >= d && band(i - d) > b) || (y >= d && band(i - d * W) > b);
        const o = i * 4;
        img.data[o] = edge ? 255 : c.r;
        img.data[o + 1] = edge ? 240 : c.g;
        img.data[o + 2] = edge ? 252 : c.b;
        img.data[o + 3] = edge ? 175 : 92 + k * 0.32;
      }
    }
    c2.putImageData(img, 0, 0);
    // keep only the island
    const geom = data.island?.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined;
    if (geom) {
      c2.globalCompositeOperation = 'destination-in';
      c2.beginPath();
      for (const poly of geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)
        for (const ring of poly) ring.forEach(([lon, lat], k) => (k ? c2.lineTo(px(lon), py(lat)) : c2.moveTo(px(lon), py(lat))));
      c2.fill('evenodd');
      c2.globalCompositeOperation = 'source-over';
    }
    mask = c2.getImageData(0, 0, W, H).data;
    image = cv;
  };
  const onLand = (lon: number, lat: number) => {
    if (!mask) return false;
    const x = Math.floor(px(lon)), y = Math.floor(py(lat));
    return x >= 0 && y >= 0 && x < W && y < H && mask[(y * W + x) * 4 + 3] > 0;
  };

  const l: AtlasLayer = {
    id: 'seismic',
    name: 'Shaking hazard',
    icon: '∿',
    color,
    range: [2020, 2020.99],
    static: true,
    period: '2020 building-code model',
    available: !!S,
    unavailable: 'Natural Resources Canada’s seismic hazard service could not be reached when this copy of the data was built. Run <code>npm run data seismic</code>, then reload.',
    build({ focusedId, hovered, selected }) {
      if (!S) return [];
      if (!image) paint();
      const focused = focusedId === 'seismic';
      const out: Layer[] = [
        new HazardBitmap({
          id: 'seismic-base',
          image: image!,
          bounds,
          valueAt: (lon: number, lat: number) => (onLand(lon, lat) ? valueAt(lon, lat) : null),
          opacity: focused ? 1 : 0.8,
          pickable: focused,
          parameters: NO_DEPTH,
        } as any),
      ];
      if (focused) {
        const hot = hovered ?? selected;
        out.push(
          new ScatterplotLayer<Row>({
            id: 'seismic-towns',
            data: rows,
            getPosition: (r) => [r.m.lon, r.m.lat],
            getRadius: (r) => (r.m.key === hot ? 1500 : 800),
            radiusMinPixels: 4,
            radiusMaxPixels: 11,
            getFillColor: (r) => rgb(ramp(r.v)),
            stroked: true,
            getLineColor: (r) => (r.m.key === hot ? [255, 255, 255, 255] : [6, 10, 18, 230]),
            lineWidthMinPixels: 1.5,
            pickable: true,
            updateTriggers: { getRadius: hot, getLineColor: hot },
            parameters: { depthCompare: 'always' },
          } as any),
          new TextLayer<Row>({
            id: 'seismic-labels',
            data: rows,
            getPosition: (r) => [r.m.lon, r.m.lat],
            getText: (r) => pct(r.v),
            getSize: (r) => (r.m.key === hot ? 13 : 10.5),
            getColor: [245, 236, 252, 235],
            getPixelOffset: [0, -12],
            getAlignmentBaseline: 'bottom',
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 220],
            fontSettings: { sdf: true },
            updateTriggers: { getSize: hot },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Shaking hazard · NRCan 2020 model')}
        <h2>How hard could the ground shake?</h2>`;
      if (!S) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const hi = rows[0], lo = rows.at(-1);
      // the west-coast signature: rare shaking far above the "1-in-10" level
      const spread = [...rows].sort((a, b) => b.v / b.v10 - a.v / a.v10);
      const wide = spread[0], narrow = rows.find((r) => r.m.key === 'victoria') ?? spread.at(-1);
      let peak = { v: 0, lon: 0, lat: 0 };
      G!.pga.forEach((v, k) => { if (v != null && v > peak.v) peak = { v, lon: G!.west + (k % G!.nx) * G!.dx, lat: G!.south + Math.floor(k / G!.nx) * G!.dy }; });
      const peakNear = nearestTown(data.munis, peak.lon, peak.lat);
      el.insertAdjacentHTML('beforeend', `<p class="lede">This is the official forecast behind Canada’s building code, not a record of past quakes. The colour shows the <b>peak ground shaking that has a 2% chance of being exceeded in any 50 years</b> (about a 1-in-2,500-year event), measured as a <b>share of gravity</b>. At 100% the ground accelerates sideways as hard as gravity pulls down. Turn on <i>Earthquakes</i> to see the history on top.</p>`);
      const hero = heroStats(el, 4);
      hero(0, hi ? pct(hi.v) : '–', hi ? `highest town: ${hi.m.name}` : '');
      hero(1, lo ? pct(lo.v) : '–', lo ? `lowest town: ${lo.m.name}` : '');
      hero(2, hi && lo ? `${(hi.v / lo.v).toFixed(1)}×` : '–', 'difference across the island');
      hero(3, '1 in 2,475', 'chance per year');
      const max = rows[0]?.v ?? 1;
      el.insertAdjacentHTML('beforeend', `
        <div class="ramp" style="background:${rampCSS((t) => ramp(0.3 + t * 0.8))}"></div>
        <div class="ramp-labels"><span>30% of gravity</span><span>70%</span><span>110%+</span></div>
        <p class="note">Bright lines step every 10% of gravity. As a rough guide, shaking of a few percent is felt by everyone and knocks things off shelves; tens of percent topples chimneys and damages older, unreinforced buildings. Buildings designed to the current code are meant to ride out this level of shaking without collapsing.</p>
        <h3>Why it differs across the island</h3>
        <p class="note" style="margin-top:0">Three kinds of earthquake feed the model. <b>Deep quakes inside the sinking Juan de Fuca plate</b> (like Nisqually, 2001) and <b>shallow faults</b> are concentrated under the south island and the Salish Sea, which is why Greater Victoria tops the list. <b>The Cascadia megathrust</b> offshore is rarer but enormous (about magnitude 9, last in 1700); it dominates the west coast. Farther north the subducting plate ends, and the hazard falls off toward Campbell River and Port Hardy. The single highest value on the island is on the north-west coast near ${peakNear.town.name} (${pct(peak.v)}), close to where the plates meet offshore.</p>
        ${wide && narrow ? `<div class="callout" style="--c:${color}">Compare the more likely <b>10%-in-50-years</b> level: at ${wide.m.name} it is ${pct(wide.v10)}, but the rare level is <b>${(wide.v / wide.v10).toFixed(1)}×</b> higher (${pct(wide.v)}). At ${narrow.m.name} the gap is only ${(narrow.v / narrow.v10).toFixed(1)}×. That jump is the Cascadia signature: west-coast quakes are rare but very large.</div>` : ''}
        <h3>Towns, highest to lowest hazard</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${r.m.name}</span><br><span class="rd">10% in 50 yrs: ${pct(r.v10)}</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${ramp(r.v)}"></i></div><div class="bar-v">${pct(r.v)}</div></span></li>`).join('')}</ol>
        <p class="note">Values are for firm ground (the code’s reference “site class C”) at the town centre. Soft soil, fill and river deltas can shake harder and may liquefy; solid rock shakes less. This is a long-term hazard estimate, not a prediction, and not advice about any particular building. Engineers use the full NBC values at <a href="https://earthquakescanada.nrcan.gc.ca/hazard-alea/interpolat/nbc-cnb-en.php" target="_blank" rel="noopener">Earthquakes Canada’s hazard tool</a>.</p>
        ${sourceLine(S.source)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('seismic')) return null;
      if (id === 'seismic-base') {
        const o = info.object as HazardPick;
        const near = nearestTown(data.munis, o.lon, o.lat);
        return `<b>Shaking hazard here</b><br><span class="tk">2% in 50 yrs</span> <span class="tv">${pct(o.v)} of gravity</span><br><span class="tk">${Math.round(near.km)} km from ${near.town.name}</span>`;
      }
      const r = info.object as Row;
      return `<b>${r.m.name}</b><br><span class="tk">2% in 50 yrs</span> <span class="tv">${pct(r.v)} of gravity</span><br><span class="tk">10% in 50 yrs</span> <span class="tv">${pct(r.v10)}</span><br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// FUTURE CLIMATE — downscaled CMIP6 projections (CanDCS-U6, as on ClimateData.ca): a static
// surface for one variable / scenario / period, with the model spread shown wherever a number is

export const FUTURE_SCEN: Record<string, { chip: string; label: string }> = {
  ssp245: { chip: 'Moderate', label: 'moderate emissions (SSP2-4.5)' },
  ssp585: { chip: 'High', label: 'high emissions (SSP5-8.5)' },
};
/** Index into `Future.periods`: 0 is the recent (modelled) baseline. */
export const FUTURE_PERIOD = [
  { chip: 'Today', label: '1991–2020', short: 'today' },
  { chip: '2030s', label: '2021–2050', short: 'the 2030s' },
  { chip: '2050s', label: '2041–2070', short: 'the 2050s' },
];

function futureLayer(data: Data): AtlasLayer {
  const color = '#ffb86b';
  const F = data.future;
  /** `drops`: in the change view, rank the biggest decrease first (fewer frost days, drier summers). */
  type Var = { key: FutureVar; chip: string; label: string; unit: string; d: number; value: string[]; change: string[]; symmetric?: boolean; drops?: boolean; rankTitle: (p: string, change: boolean) => string };
  const VARS: Var[] = [
    { key: 'hot', chip: 'Hot days', label: 'Days a year over 30 °C', unit: 'days', d: 0, value: ['#1d2a44', '#5b3a6e', '#c2493d', '#ff9f43', '#ffe08a'], change: ['#2a2f3d', '#7a3b52', '#e0533b', '#ffb347', '#fff0b0'], rankTitle: (p, c) => (c ? `Biggest rise in hot days by ${p}` : `Most hot days by ${p}`) },
    { key: 'temp', chip: 'Mean temp', label: 'Average temperature over the year', unit: '°C', d: 1, value: ['#203a6b', '#3f7fb3', '#8cc9a8', '#ffd36b', '#ff7a45'], change: ['#2a2f3d', '#7a4b3b', '#e0773b', '#ffc061', '#fff2c4'], rankTitle: (p, c) => (c ? `Most warming by ${p}` : `Warmest by ${p}`) },
    { key: 'frost', chip: 'Frost days', label: 'Days a year with a low below 0 °C', unit: 'days', d: 0, value: ['#2f3d55', '#4f86b5', '#a9dbf5', '#ffffff'], change: ['#ffb347', '#c76a4a', '#5b5f7a', '#2f3d55'], drops: true, rankTitle: (p, c) => (c ? `Biggest drop in frost days by ${p}` : `Most frost days in ${p}`) },
    { key: 'summerRain', chip: 'Summer rain', label: 'June–August rain', unit: 'mm', d: 0, value: ['#6b4a2b', '#b48a55', '#8fc3d6', '#2f6fb3'], change: ['#c0662b', '#e3a35f', '#3b3f4a', '#6fb0e0', '#2f6fb3'], symmetric: true, drops: true, rankTitle: (p, c) => (c ? `Biggest drop in summer rain by ${p}` : `Wettest summers in ${p}`) },
  ];
  let cur = VARS[0], scen = 'ssp245', per = 2, change = false;
  /** The change view only means something for a future period. */
  const chg = () => change && per > 0;
  const fmtV = (v: number, x = cur) => (x.key === 'hot' && v < 10 ? v.toFixed(1) : v.toFixed(x.d));
  const fmtC = (v: number, x = cur) => `${v >= 0 ? '+' : '−'}${fmtV(Math.abs(v), x)}`;
  const unitOf = (x = cur) => (x.unit === '°C' ? ' °C' : ` ${x.unit}`);

  // dense [ny*nx] median grids per var/scenario/period, NaN off the island
  const G = F?.grid;
  const dense = new Map<string, Float32Array>();
  const grid = (v: FutureVar, s: string, p: number, pct = 1) => {
    const k = `${v}|${s}|${p}|${pct}`;
    let a = dense.get(k);
    if (!a && G) {
      a = new Float32Array(G.nx * G.ny).fill(NaN);
      const src = F!.vals[v][s][p][pct];
      G.cells.forEach((c, n) => { if (src[n] != null) a![c] = src[n]!; });
      dense.set(k, a);
    }
    return a!;
  };
  const sample = (a: Float32Array, lon: number, lat: number): number | null => {
    if (!G) return null;
    const fx = (lon - G.west) / G.dx, fy = (lat - G.south) / G.dy;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= G.nx - 1 || j >= G.ny - 1) return null;
    const tx = fx - i, ty = fy - j;
    let sum = 0, w = 0;
    for (const [di, dj, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const v = a[(j + dj) * G.nx + i + di];
      if (!Number.isNaN(v)) { sum += v * wt; w += wt; }
    }
    return w > 0.15 ? sum / w : null;
  };
  /** What the surface shows: the projected median, or its change from the same models' 1991–2020. */
  const shown = (lon: number, lat: number, v = cur, s = scen, p = per, ch = chg()) => {
    const x = sample(grid(v.key, s, p), lon, lat);
    if (x == null || !ch) return x;
    const b = sample(grid(v.key, s, 0), lon, lat);
    return b == null ? null : x - b;
  };

  // colour domains span every scenario and period so switching chips compares like with like
  const domains = new Map<string, [number, number]>();
  const domain = (v = cur, ch = chg()): [number, number] => {
    const k = `${v.key}|${ch}`;
    let d = domains.get(k);
    if (!d) {
      const all: number[] = [];
      if (F) for (const s of F.scenarios) for (let p = ch ? 1 : 0; p < F.periods.length; p++) {
        const a = F.vals[v.key][s][p][1], b = F.vals[v.key][s][0][1];
        a.forEach((x, n) => { if (x != null && b[n] != null) all.push(ch ? x - b[n]! : x); });
      }
      all.sort((a, b) => a - b);
      let lo = d3.quantile(all, 0.01) ?? 0, hi = d3.quantile(all, 0.99) ?? 1;
      if (ch && v.symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)); lo = -m; hi = m; }
      else if (ch) { if (hi <= 0) hi = 0; else lo = Math.min(0, lo); if (lo >= 0) lo = 0; }
      else if (v.key === 'hot' || v.key === 'frost') lo = 0;
      d = [lo, hi === lo ? lo + 1 : hi];
      domains.set(k, d);
    }
    return d;
  };
  const ramp = (v = cur, ch = chg()) => {
    const [lo, hi] = domain(v, ch);
    return d3.scaleSequential(d3.interpolateRgbBasis(ch ? v.change : v.value)).domain([lo, hi]).clamp(true);
  };

  // bitmap surface, one per variable/scenario/period/view (painted on demand, then cached)
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const bounds: [number, number, number, number] = G ? [G.west, G.south, G.west + (G.nx - 1) * G.dx, G.south + (G.ny - 1) * G.dy] : [0, 0, 0, 0];
  const W = 1400;
  const H = Math.round((W * (merc(bounds[3]) - merc(bounds[1]))) / (((bounds[2] - bounds[0]) * Math.PI) / 180));
  const px = (lon: number) => ((lon - bounds[0]) / (bounds[2] - bounds[0])) * W;
  const py = (lat: number) => ((merc(bounds[3]) - merc(lat)) / (merc(bounds[3]) - merc(bounds[1]))) * H;
  let mask: Uint8ClampedArray | null = null;
  const images = new Map<string, HTMLCanvasElement>();
  const clip = (c2: CanvasRenderingContext2D) => {
    const geom = data.island?.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined;
    if (!geom) return;
    c2.globalCompositeOperation = 'destination-in';
    c2.beginPath();
    for (const poly of geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)
      for (const ring of poly) ring.forEach(([lon, lat], k) => (k ? c2.lineTo(px(lon), py(lat)) : c2.moveTo(px(lon), py(lat))));
    c2.fill('evenodd');
    c2.globalCompositeOperation = 'source-over';
  };
  const paint = () => {
    const key = `${cur.key}|${scen}|${per}|${chg()}`;
    let cv = images.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d')!;
    const img = c2.createImageData(W, H);
    const r = ramp();
    const [lo, hi] = domain();
    const lut = d3.range(256).map((k) => d3.rgb(r(lo + (k / 255) * (hi - lo))));
    const m0 = merc(bounds[3]), m1 = merc(bounds[1]);
    for (let y = 0; y < H; y++) {
      const lat = (Math.atan(Math.exp(m0 - ((y + 0.5) / H) * (m0 - m1))) * 360) / Math.PI - 90;
      for (let x = 0; x < W; x++) {
        const v = shown(bounds[0] + ((x + 0.5) / W) * (bounds[2] - bounds[0]), lat);
        if (v == null) continue;
        const c = lut[Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255)))];
        // faint diagonal hatching marks the surface as a projection, not a measurement
        const hatch = per > 0 && (x + y) % 11 === 0;
        const o = (y * W + x) * 4;
        img.data[o] = hatch ? Math.min(255, c.r + 50) : c.r;
        img.data[o + 1] = hatch ? Math.min(255, c.g + 50) : c.g;
        img.data[o + 2] = hatch ? Math.min(255, c.b + 50) : c.b;
        img.data[o + 3] = hatch ? 230 : 185;
      }
    }
    c2.putImageData(img, 0, 0);
    clip(c2);
    if (!mask) mask = c2.getImageData(0, 0, W, H).data;
    images.set(key, cv);
    return cv;
  };
  const onLand = (lon: number, lat: number) => {
    if (!mask) return false;
    const x = Math.floor(px(lon)), y = Math.floor(py(lat));
    return x >= 0 && y >= 0 && x < W && y < H && mask[(y * W + x) * 4 + 3] > 0;
  };

  // towns
  type Row = { m: Muni; t: FutureTown };
  const rows: Row[] = F ? data.munis.flatMap((m) => (F.towns[m.key] ? [{ m, t: F.towns[m.key] }] : [])) : [];
  const rng = (r: Row, v = cur, s = scen, p = per) => r.t[v.key][s][p];
  const townShown = (r: Row, v = cur, s = scen, p = per, ch = chg()) => rng(r, v, s, p)[1] - (ch ? rng(r, v, s, 0)[1] : 0);
  const ranked = () => [...rows].sort((a, b) => (chg() && cur.drops ? townShown(a) - townShown(b) : townShown(b) - townShown(a)));
  const scenLabel = () => (per === 0 ? 'modelled recent climate' : FUTURE_SCEN[scen].label);
  const perLabel = (p = per) => `${FUTURE_PERIOD[p].chip === 'Today' ? 'today' : FUTURE_PERIOD[p].chip} (${FUTURE_PERIOD[p].label})`;

  const l: AtlasLayer = {
    id: 'future',
    name: 'Future climate',
    icon: '⇡',
    color,
    range: [2041, 2070.99],
    static: true,
    period: 'projections to 2041–2070',
    available: !!F,
    unavailable: 'The ClimateData.ca projection server (PAVICS THREDDS) could not be reached when this copy of the data was built. Run <code>npm run data future</code>, then reload.',
    build({ focusedId, hovered, selected }) {
      if (!F) return [];
      const image = paint();
      const focused = focusedId === 'future';
      const out: Layer[] = [
        new HazardBitmap({
          id: 'future-base',
          image,
          bounds,
          valueAt: (lon: number, lat: number) => (onLand(lon, lat) ? shown(lon, lat) : null),
          opacity: focused ? 1 : 0.75,
          pickable: focused,
          parameters: NO_DEPTH,
          updateTriggers: { valueAt: `${cur.key}|${scen}|${per}|${chg()}` },
        } as any),
      ];
      if (focused) {
        const hot = hovered ?? selected;
        const key = `${cur.key}|${scen}|${per}|${chg()}|${hot}`;
        const r = ramp();
        out.push(
          new ScatterplotLayer<Row>({
            id: 'future-towns',
            data: rows,
            getPosition: (d) => [d.m.lon, d.m.lat],
            getRadius: (d) => (d.m.key === hot ? 1500 : 800),
            radiusMinPixels: 4,
            radiusMaxPixels: 11,
            getFillColor: (d) => rgb(r(townShown(d))),
            stroked: true,
            getLineColor: (d) => (d.m.key === hot ? [255, 255, 255, 255] : [6, 10, 18, 230]),
            lineWidthMinPixels: 1.5,
            pickable: true,
            updateTriggers: { getRadius: key, getLineColor: key, getFillColor: key },
            parameters: { depthCompare: 'always' },
          } as any),
          new TextLayer<Row>({
            id: 'future-labels',
            data: rows,
            getPosition: (d) => [d.m.lon, d.m.lat],
            getText: (d) => (chg() ? fmtC(townShown(d)) : fmtV(townShown(d))),
            getSize: (d) => (d.m.key === hot ? 13 : 10.5),
            getColor: [255, 240, 225, 235],
            getPixelOffset: [0, -12],
            getAlignmentBaseline: 'bottom',
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 220],
            fontSettings: { sdf: true },
            updateTriggers: { getSize: key, getText: key },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Future climate · CMIP6 projections')}
        <h2>What the next 25 years could bring</h2>`;
      if (!F) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const chipRow = (name: string, items: [string, string][]) =>
        `<div class="chip-row"><span class="chip-k">${name}</span><div class="chips">${items.map(([v, t]) => `<button class="chip" data-${name.toLowerCase()}="${v}" style="--c:${color}">${t}</button>`).join('')}</div></div>`;
      el.insertAdjacentHTML('beforeend', `<div class="proj-badge" style="--c:${color}">Projection, not a record</div>
        <p class="lede">Every other layer shows what has happened. This one shows what <b>climate models project</b>: 26 global models, downscaled to a ~10 km grid for Canada (CanDCS-U6, the data behind ClimateData.ca). The models disagree, so every number comes with a range: the middle model (median) and the spread from the 10th to the 90th percentile of models. “Today” is the same models’ 1991–2020, so the comparison is like with like.</p>
        ${chipRow('Show', VARS.map((v) => [v.key, v.chip]))}
        ${chipRow('Scenario', Object.entries(FUTURE_SCEN).map(([k, s]) => [k, s.chip]))}
        ${chipRow('Period', FUTURE_PERIOD.map((p, i) => [String(i), p.chip]))}
        ${chipRow('Map', [['abs', 'Projected value'], ['chg', 'Change from today']])}`);
      const hero = heroStats(el, 4);
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-show]').forEach((b) => b.classList.toggle('on', b.dataset.show === cur.key));
        el.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) => { b.classList.toggle('on', b.dataset.scenario === scen); b.disabled = per === 0; });
        el.querySelectorAll<HTMLButtonElement>('[data-period]').forEach((b) => b.classList.toggle('on', b.dataset.period === String(per)));
        el.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) => { b.classList.toggle('on', b.dataset.map === (change ? 'chg' : 'abs')); b.disabled = per === 0; });
        const ch = chg();
        const r = ranked();
        const isl = (p: number, pct: number) => d3.median(rows, (d) => rng(d, cur, scen, p)[pct]) ?? 0;
        const u = unitOf();
        hero(0, `${fmtV(isl(per, 1))}${u}`, `island town median, ${perLabel()}`);
        hero(1, `${fmtV(isl(per, 0))}–${fmtV(isl(per, 2))}`, `town median of the 10th–90th % of models`);
        hero(2, `${fmtV(isl(0, 1))}${u}`, 'today (1991–2020, modelled)');
        const hi = r[0];
        hero(3, hi ? (ch ? fmtC(townShown(hi)) : fmtV(townShown(hi))) + u : '–', hi ? `${ch ? (cur.drops ? 'biggest drop' : 'biggest rise') : 'top town'}: ${hi.m.name}` : '');
        const max = d3.max(rows, (d) => Math.max(rng(d)[2], rng(d, cur, scen, 0)[2])) ?? 1;
        const min = cur.key === 'temp' || cur.key === 'summerRain' ? (d3.min(rows, (d) => Math.min(rng(d)[0], rng(d, cur, scen, 0)[0])) ?? 0) * 0.9 : 0;
        const pos = (v: number) => `${(((v - min) / (max - min)) * 100).toFixed(1)}%`;
        const rp = ramp(cur, ch);
        const [lo, hiD] = domain(cur, ch);
        const big = rows.map((d) => ({ d, a: rng(d, cur, 'ssp245', 2)[1], b: rng(d, cur, 'ssp585', 2)[1] })).sort((a, b) => b.b - a.b)[0];
        body.innerHTML = `
          <div class="ramp" style="background:${rampCSS((t) => rp(lo + t * (hiD - lo)))}"></div>
          <div class="ramp-labels"><span>${ch ? fmtC(lo) : fmtV(lo)}${u}</span><span>${ch ? 'change from 1991–2020, median model' : `${cur.label.toLowerCase()}, median model`}</span><span>${ch ? fmtC(hiD) : fmtV(hiD)}${u}</span></div>
          <h3>${per ? cur.rankTitle(FUTURE_PERIOD[per].short, ch) : `${cur.chip} today (1991–2020, modelled)`}<br><span style="font-weight:400;color:var(--ink-3);font-size:11.5px">${scenLabel()} · bar = 10th–90th percentile of models, tick = median, grey tick = today</span></h3>
          <ol class="rank-list">${r.map((d, i) => {
            const [a, m, b] = rng(d), now = rng(d, cur, scen, 0)[1];
            return `<li data-key="${d.m.key}"><span class="rk">${i + 1}</span><span><span class="nm">${d.m.name}</span><br><span class="rd">${per ? `today ${fmtV(now)} → ${fmtV(m)}${u}` : `${fmtV(m)}${u}`}</span></span><span><div class="rbar"><b style="left:${pos(a)};width:calc(${pos(b)} - ${pos(a)});background:${rp(townShown(d, cur, scen, per, ch))}"></b>${per ? `<s style="left:${pos(now)}"></s>` : ''}<i style="left:${pos(m)}"></i></div><div class="bar-v">${fmtV(a)}–${fmtV(b)}</div></span></li>`;
          }).join('')}</ol>
          ${big && per ? `<div class="callout" style="--c:${color}">The scenario matters most late in the period. By the 2050s, ${big.d.m.name} is projected at about <b>${fmtV(big.a)}${u}</b> under moderate emissions and <b>${fmtV(big.b)}${u}</b> under high emissions (medians), against ${fmtV(rng(big.d, cur, 'ssp245', 0)[1])}${u} today.</div>` : ''}`;
      };
      el.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.chip');
        if (!b || b.disabled) return;
        if (b.dataset.show) cur = VARS.find((v) => v.key === b.dataset.show) ?? cur;
        if (b.dataset.scenario) scen = b.dataset.scenario;
        if (b.dataset.period) per = +b.dataset.period;
        if (b.dataset.map) change = b.dataset.map === 'chg';
        draw();
      });
      draw();
      el.insertAdjacentHTML('beforeend', `
        <h3>Reading the scenarios</h3>
        <p class="note" style="margin-top:0"><b>Moderate (SSP2-4.5)</b> is roughly where today’s policies lead. <b>High (SSP5-8.5)</b> assumes emissions keep climbing fast; it is a plausible upper end, not a forecast. The two barely differ by the 2030s because that warming is already locked in; they pull apart by the 2050s. Neither is a prediction of any single year: these are 30-year averages, and individual summers like the 2021 heat dome will still swing far above them.</p>
        <p class="note">Values come from the grid cell nearest each town centre (~6 × 9 km), so a coastal town can share a cell with its warmer or cooler hinterland. Hot days are counted when the daily high exceeds 30 °C; frost days when the low drops below 0 °C. Because they are model estimates, today’s figures differ a little from the station <i>Climate normals</i>, which are measurements.</p>
        ${sourceLine(F.source)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('future')) return null;
      const u = unitOf();
      const head = `<span class="tk">${perLabel()}${per ? ` · ${FUTURE_SCEN[scen].chip.toLowerCase()} scenario` : ''}</span>`;
      if (id === 'future-base') {
        const o = info.object as HazardPick;
        const near = nearestTown(data.munis, o.lon, o.lat);
        const a = sample(grid(cur.key, scen, per, 0), o.lon, o.lat), m = sample(grid(cur.key, scen, per, 1), o.lon, o.lat), b = sample(grid(cur.key, scen, per, 2), o.lon, o.lat);
        const now = sample(grid(cur.key, scen, 0, 1), o.lon, o.lat);
        if (a == null || m == null || b == null || now == null) return null;
        return `<b>${cur.label} here</b><br>${head}<br><span class="tk">Median model</span> <span class="tv">${fmtV(m)}${u}</span><br><span class="tk">Range (10–90%)</span> <span class="tv">${fmtV(a)}–${fmtV(b)}</span>${per ? `<br><span class="tk">Today (1991–2020)</span> <span class="tv">${fmtV(now)}${u}</span>` : ''}<br><span class="tk">${Math.round(near.km)} km from ${near.town.name}</span>`;
      }
      const d = info.object as Row;
      const [a, m, b] = rng(d);
      return `<b>${d.m.name}</b><br>${head}<br><span class="tk">${cur.chip}</span> <span class="tv">${fmtV(m)}${u} (${fmtV(a)}–${fmtV(b)})</span>${per ? `<br><span class="tk">Today (1991–2020)</span> <span class="tv">${fmtV(rng(d, cur, scen, 0)[1])}${u}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// RIVER FLOODS

function riversLayer(data: Data): AtlasLayer {
  const color = '#4cc9f0';
  const stations = data.rivers?.stations ?? [];
  const ratio = (s: (typeof stations)[number], y: number) => (s.peaks[y] != null ? s.peaks[y] / s.median : null);
  const ratioColor = d3.scaleLinear<string>().domain([0.4, 1, 1.5, 2.5]).range(['#123a5c', '#1f78b4', '#4cc9f0', '#f1fbff']).clamp(true);
  const years = new Set<number>();
  for (const s of stations) for (const y of Object.keys(s.peaks)) years.add(+y);
  const ys = [...years].sort((a, b) => a - b);
  const share: Record<number, { n: number; high: number }> = {};
  for (const y of ys) {
    let n = 0, high = 0;
    for (const s of stations) { const r = ratio(s, y); if (r != null) { n++; if (r >= 1.5) high++; } }
    share[y] = { n, high };
  }
  const y0 = ys.find((y) => share[y].n >= 3) ?? 1914;
  const y1 = ys.at(-1) ?? 2024;
  // when in the year each station's peak happened (for ripple timing)
  const peakT = (s: (typeof stations)[number], y: number) => {
    const d = s.peakDates[y];
    if (!d) return y + 0.9;
    const dt = new Date(d);
    return y + (dt.getUTCMonth() + dt.getUTCDate() / 31) / 12;
  };

  const l: AtlasLayer = {
    id: 'rivers',
    name: 'River floods',
    icon: '≋',
    color,
    range: [y0, y1 + 0.99],
    available: !!data.rivers,
    build({ time, speed }) {
      const y = Math.floor(time);
      const W = glowWindow(speed, 1.2);
      const live = stations.map((s) => ({ s, r: interpYearly(Object.fromEntries(Object.entries(s.peaks).map(([k, v]) => [k, v / s.median])), time) }));
      const ripples = stations
        .map((s) => ({ s, r: ratio(s, y), t: peakT(s, y) }))
        .filter((d) => d.r != null && d.r >= 1.5 && time >= d.t && time - d.t < W);
      return [
        new ScatterplotLayer<any>({
          id: 'rivers-base',
          data: stations,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: 700,
          radiusMinPixels: 2,
          getFillColor: [76, 201, 240, 60],
          pickable: true,
          parameters: NO_DEPTH,
        }),
        new ColumnLayer<any>({
          id: 'rivers-cols',
          data: live.filter((d) => d.r != null),
          getPosition: (d) => [d.s.lon, d.s.lat],
          radius: 1300,
          diskResolution: 24,
          extruded: true,
          getElevation: (d) => d.r * 9000,
          getFillColor: (d) => rgb(ratioColor(d.r), 235),
          material: { ambient: 0.6, diffuse: 0.6, shininess: 40 },
          pickable: true,
          updateTriggers: { getElevation: time, getFillColor: time },
        }),
        new ScatterplotLayer<any>({
          id: 'rivers-ripples',
          data: ripples,
          getPosition: (d) => [d.s.lon, d.s.lat],
          getRadius: (d) => 1500 + ((time - d.t) / W) * 9000 * Math.min(d.r, 4),
          stroked: true,
          filled: false,
          lineWidthMinPixels: 2,
          getLineColor: (d) => [190, 240, 255, 255 * (1 - (time - d.t) / W)],
          updateTriggers: { getRadius: time, getLineColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
    spark: () => ys.filter((y) => y >= y0).map((x) => ({ x, y: share[x].n >= 3 ? share[x].high / share[x].n : 0 })),
    events() {
      const ev: TimedEvent[] = ys
        .filter((y) => share[y].n >= 8 && share[y].high / share[y].n >= 0.4)
        .map((y) => ({ stats: [{ v: `${share[y].high} of ${share[y].n}`, l: 'gauges at 1.5× normal or more' }, { v: `${Math.round((share[y].high / share[y].n) * 100)}%`, l: 'of gauged rivers' }], t: y + 0.05, layer: 'rivers', title: `${y}: island-wide high water`, body: `${share[y].high} of ${share[y].n} gauged rivers peaked at 1.5× their normal annual high or more.` }));
      return ev;
    },
    panel(el) {
      el.innerHTML = `${kicker(l, 'River gauges · HYDAT')}
        <h2>When the rivers rise</h2>
        <p class="lede">Each column is a river gauge. Its height is that year’s highest flow compared with the river’s typical annual peak — a column at 2× means the river ran at double its usual flood-season high. Ripples mark years a river hit 1.5× or more.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Share of gauges at 1.5× normal peak or higher</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, {
          data: l.spark(), xDomain: [y0, y1], color, height: 120, yFormat: (v) => `${Math.round(v * 100)}%`,
          tooltip: (d) => `<b>${d.x}</b><br>${share[d.x].high} of ${share[d.x].n} gauges ≥1.5× normal`,
        }),
      );
      const records = stations
        .flatMap((s) => Object.entries(s.peaks).map(([y, v]) => ({ s, y, r: v / s.median })))
        .sort((a, b) => b.r - a.r)
        .filter((d, i, arr) => arr.findIndex((x) => x.s === d.s) === i)
        .slice(0, 5);
      el.insertAdjacentHTML('beforeend', `
        <h3>Most extreme peaks on record</h3>
        <div class="legend" style="display:grid;gap:6px">${records.map((d) => `<span><b>${d.r.toFixed(1)}×</b> · ${esc(d.s.name)} <span class="tk">(${esc(d.s.peakDates[d.y] ?? d.y)})</span></span>`).join('')}</div>
        <h3>Peak flow vs. normal</h3>
        <div class="ramp" style="background:${rampCSS((t) => ratioColor(0.4 + t * 2.1))}"></div>
        <div class="ramp-labels"><span>0.4×</span><span>1×</span><span>1.5×</span><span>2.5×+</span></div>
        <p class="note">Gauges measure river flow, not flooded area — a high ratio means high water, not necessarily property damage. For a specific property, check the regional district’s floodplain maps.</p>
        ${data.flood ? `<button class="tr-fall" data-layer="flood" type="button" style="margin-top:4px">≈ Floodplains: where BC mapped these rivers to flood ›</button>` : ''}
        ${sourceLine(data.rivers?.source ?? '')}`);
      el.querySelector<HTMLElement>('[data-layer="flood"]')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:layer', { detail: 'flood' })));
      return {
        update({ time }) {
          const y = Math.floor(time);
          const sh = share[y];
          hero(0, sh ? `${sh.high}` : '–', sh ? `of ${sh.n} gauges ≥1.5× in ${y}` : `no gauge data in ${y}`);
          let best: { s: any; r: number } | null = null;
          for (const s of stations) { const r = ratio(s, y); if (r != null && (!best || r > best.r)) best = { s, r }; }
          hero(1, best ? `${best.r.toFixed(1)}×` : '–', best ? `${best.s.name.split(/ (at|near|above|below) /i)[0]} in ${y}` : 'biggest relative peak');
          hero(2, fmt.int(stations.length), 'gauges with 8+ years');
          hero(3, String(y0), 'first year with 3+ gauges');
          set(time);
        },
      };
    },
    describe(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('rivers')) return null;
      const st = o.s ?? o;
      const years = Object.keys(st.peaks).map(Number).sort((a, b) => a - b);
      if (!years.length) return null;
      const rec = years.reduce((a, y) => (st.peaks[y] > st.peaks[a] ? y : a), years[0]);
      const high = years.filter((y) => st.peaks[y] / st.median >= 1.5).length;
      return {
        layer: 'rivers', kind: 'River gauge', lon: st.lon, lat: st.lat, zoom: 9.5,
        title: st.name, body: `Water Survey of Canada gauge ${st.id}, ${years.length} years of record (${years[0]}–${years.at(-1)}). Each bar is a year's highest flow against the river's normal annual peak.`,
        stats: [{ v: `${st.median} m³/s`, l: 'normal annual peak' }, { v: `${(st.peaks[rec] / st.median).toFixed(1)}×`, l: `record, ${rec}` }, { v: `${high} of ${years.length}`, l: 'years at 1.5× normal or more' }, ...(st.area ? [{ v: `${fmt.int(st.area)} km²`, l: 'drains' }] : [])],
        detail: detailBars('Peak flow each year, against normal', years.map((y) => ({ x: y, y: st.peaks[y] / st.median, color: ratioColor(st.peaks[y] / st.median) })), color, (v) => `${v.toFixed(1)}×`, (d) => `<b>${d.x}</b> · ${d.y.toFixed(2)}× normal`),
        sources: [{ label: 'HYDAT, Environment and Climate Change Canada', url: 'https://wateroffice.ec.gc.ca/' }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('rivers')) return null;
      const s = o.s ?? o;
      const rec = Object.entries(s.peaks as Record<string, number>).reduce((a, b) => (b[1] > a[1] ? b : a));
      return `<b>${esc(s.name)}</b><br><span class="tk">Gauge</span> <span class="tv">${esc(s.id)}</span>${o.r != null ? `<br><span class="tk">This year</span> <span class="tv">${o.r.toFixed(2)}× normal</span>` : ''}<br><span class="tk">Normal annual peak</span> <span class="tv">${s.median} m³/s</span><br><span class="tk">Record</span> <span class="tv">${rec[1]} m³/s (${rec[0]})</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// CLIMATE

function climateLayer(data: Data): AtlasLayer {
  const color = '#f25f5c';
  const stations = data.climate?.stations ?? [];
  const div = d3.scaleLinear<string>().domain([-1.5, -0.4, 0, 0.4, 1.5]).range(['#2b6cb0', '#7fb3e6', '#9aa3b2', '#f4a08a', '#e0312b']).clamp(true);
  const anomalies = islandAnomalies(data);
  const ys = Object.keys(anomalies).map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 1900, y1 = ys.at(-1) ?? 2020;
  const warmest = ys.reduce((a, b) => (anomalies[b] > anomalies[a] ? b : a), y0);
  const trend = slope(ys.filter((y) => y >= 1950).map((y) => [y, anomalies[y]]));

  const l: AtlasLayer = {
    id: 'climate',
    name: 'Climate',
    icon: '🌡',
    color,
    range: [y0, y1 + 0.99],
    available: !!data.climate,
    build({ time, focusedId }) {
      const live = stations
        .map((s) => {
          const series = Object.fromEntries(Object.entries(s.temp).map(([k, v]) => [k, v - s.baseline]));
          return { s, a: interpYearly(series, time) };
        })
        .filter((d) => d.a != null) as { s: (typeof stations)[number]; a: number }[];
      const layers: Layer[] = [
        new ColumnLayer<any>({
          id: 'climate-cols',
          data: live,
          getPosition: (d) => [d.s.lon, d.s.lat],
          radius: 2600,
          diskResolution: 6,
          extruded: true,
          getElevation: (d) => 1200 + Math.abs(d.a) * 16000,
          getFillColor: (d) => rgb(div(d.a), 240),
          material: { ambient: 0.65, diffuse: 0.5 },
          pickable: true,
          updateTriggers: { getElevation: time, getFillColor: time },
        }),
      ];
      if (focusedId === 'climate')
        layers.push(
          new TextLayer<any>({
            id: 'climate-labels',
            data: live,
            getPosition: (d) => [d.s.lon, d.s.lat, 1200 + Math.abs(d.a) * 16000 + 2500],
            getText: (d) => `${d.a >= 0 ? '+' : '−'}${Math.abs(d.a).toFixed(1)}°`,
            getSize: 12,
            getColor: [235, 240, 248, 230],
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 220],
            fontSettings: { sdf: true },
            billboard: true,
            updateTriggers: { getText: time, getPosition: time },
            parameters: NO_DEPTH,
          } as any),
        );
      return layers;
    },
    spark: () => ys.map((x) => ({ x, y: anomalies[x], color: div(anomalies[x]) })),
    events: () => [{ stats: [{ v: `${fmt.signed(anomalies[warmest])} °C`, l: 'above the 1961–1990 normal' }, { v: `${stations.length}`, l: 'stations averaged' }], t: warmest + 0.5, layer: 'climate', title: `${warmest}: warmest year in the island record`, body: `Island-average temperature ran ${fmt.signed(anomalies[warmest])} °C above the 1961–1990 normal.` }],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Homogenized temperature record')}
        <h2>A warming island</h2>
        <p class="lede">Annual mean temperature at ${stations.length} long-running weather stations, shown as the difference from each station’s 1961–1990 average. Columns grow and redden as years run warm; blue means cooler than normal.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Island warming stripes (${y0}–${y1})</h3>`);
      const setA = deferChart(el.appendChild(mk('div')), (c) =>
        stripes(c, { cells: ys.map((x) => ({ x, color: div(anomalies[x]), label: `<b>${x}</b><br>${fmt.signed(anomalies[x], 2)} °C vs 1961–90` })), xDomain: [y0, y1], height: 50 }),
      );
      el.insertAdjacentHTML('beforeend', `<h3>Anomaly by year (°C)</h3>`);
      const setB = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, { data: l.spark(), xDomain: [y0, y1], color, height: 120, diverging: true, yFormat: (v) => fmt.signed(v, 1), tooltip: (d) => `<b>${d.x}</b><br>${fmt.signed(d.y, 2)} °C vs 1961–90` }),
      );
      el.insertAdjacentHTML('beforeend', `
        <div class="ramp" style="background:${rampCSS((t) => div(-1.5 + t * 3))}"></div>
        <div class="ramp-labels"><span>−1.5 °C</span><span>normal</span><span>+1.5 °C</span></div>
        <div class="callout" style="--c:${color}">Since 1950 the island has warmed about <b>${trend != null ? (trend * 10).toFixed(2) : '–'} °C per decade</b>. In late June 2021 a “heat dome” smashed all-time temperature records across BC — just after this homogenized series ends.</div>
        <p class="note">AHCCD data are adjusted by Environment and Climate Change Canada to remove artificial jumps from station moves and instrument changes, so long-term trends are comparable. Series currently end in ${y1}.</p>
        ${sourceLine(data.climate?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const a = anomalies[y];
          hero(0, a != null ? `${fmt.signed(a)}°` : '–', `island anomaly ${y}`);
          hero(1, String(warmest), `warmest year (${fmt.signed(anomalies[warmest])}°)`);
          const recent = ys.filter((x) => x > y1 - 10).map((x) => anomalies[x]);
          hero(2, `${fmt.signed(d3.mean(recent) ?? 0)}°`, `${y1 - 9}–${y1} average`);
          hero(3, trend != null ? `${fmt.signed(trend * 10, 2)}°` : '–', 'per decade since 1950');
          setA(time); setB(time);
        },
      };
    },
    describe(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('climate')) return null;
      const st = o.s;
      const ys = Object.keys(st.temp).map(Number).sort((a, b) => a - b);
      if (!ys.length) return null;
      const an = (y: number) => st.temp[y] - st.baseline;
      const warm = ys.reduce((a, y) => (an(y) > an(a) ? y : a), ys[0]);
      const recent = ys.filter((y) => y >= ys.at(-1)! - 9);
      const recentMean = recent.reduce((a, y) => a + an(y), 0) / recent.length;
      return {
        layer: 'climate', kind: 'Weather station', lon: st.lon, lat: st.lat, zoom: 9,
        title: st.name, body: `Annual mean temperature, ${ys[0]}–${ys.at(-1)}, as the difference from this station's 1961–1990 normal of ${st.baseline.toFixed(1)} °C. Blue years ran cool, red years warm.`,
        stats: [{ v: `${st.baseline.toFixed(1)} °C`, l: '1961–1990 normal' }, { v: `${fmt.signed(recentMean)} °C`, l: `average, last ${recent.length} years` }, { v: String(warm), l: `warmest year (${fmt.signed(an(warm))} °C)` }, { v: String(ys.length), l: 'years of record' }],
        detail: detailBars('Each year against normal (°C)', ys.map((y) => ({ x: y, y: an(y), color: div(an(y)) })), color, (v) => fmt.signed(v), (d) => `<b>${d.x}</b> · ${fmt.signed(d.y, 2)} °C`),
        sources: [{ label: 'ECCC Adjusted and Homogenized Canadian Climate Data', url: 'https://api.weather.gc.ca/collections/ahccd-annual' }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('climate')) return null;
      const s = o.s;
      const yrs = Object.keys(s.temp);
      return `<b>${esc(s.name)}</b><br><span class="tk">This year</span> <span class="tv">${fmt.signed(o.a, 2)} °C vs normal</span><br><span class="tk">1961–90 normal</span> <span class="tv">${s.baseline.toFixed(1)} °C</span><br><span class="tk">Record</span> <span class="tv">${yrs[0]}–${yrs.at(-1)}</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// CLIMATE NORMALS — a 30-year average, so the layer is the same at every point of its range

function normalsLayer(data: Data): AtlasLayer {
  const color = '#c5e86c';
  const stations = data.normals?.stations ?? [];
  const [p0, p1] = (data.normals?.period.match(/\d{4}/g) ?? ['1981', '2010']).map(Number);
  type Var = { key: NormalVar; chip: string; label: string; unit: string; best: string; low: boolean; ramp: (v: number) => string; domain: [number, number] };
  const scale = (domain: [number, number], a: string, b: string) => d3.scaleSequential(d3.interpolateRgb(a, b)).domain(domain).clamp(true);
  const VARS: Var[] = [
    { key: 'sun', chip: 'Sunshine', label: 'Bright sunshine', unit: 'h', best: 'Sunniest', low: false, domain: [1400, 2150], ramp: scale([1400, 2150], '#4b4a3a', '#fff07a') },
    { key: 'wetDays', chip: 'Rain days', label: 'Days with rain or snow (≥0.2 mm)', unit: 'days', best: 'Fewest rain days', low: true, domain: [140, 250], ramp: scale([140, 250], '#bfe3ff', '#1d4f91') },
    { key: 'frostDays', chip: 'Frost days', label: 'Days with a low of 0 °C or below', unit: 'days', best: 'Fewest frost days', low: true, domain: [10, 100], ramp: scale([10, 100], '#2f7a8a', '#dff4ff') },
    { key: 'snow', chip: 'Snowfall', label: 'Snowfall', unit: 'cm', best: 'Least snow', low: true, domain: [10, 105], ramp: scale([10, 105], '#5d7184', '#ffffff') },
  ];
  let cur = VARS[0];
  const val = (s: NormalsStation, v = cur) => s[v.key] ?? null;
  const fmtV = (v: number, x = cur) => `${fmt.int(v)} ${x.unit}`;
  const ranked = (v = cur) => stations.filter((s) => val(s, v) != null).sort((a, b) => (v.low ? val(a, v)! - val(b, v)! : val(b, v)! - val(a, v)!));
  const liveCache: Partial<Record<NormalVar, NormalsStation[]>> = {};
  const height = (v: number) => 1500 + ((v - cur.domain[0] * 0.6) / (cur.domain[1] - cur.domain[0] * 0.6)) * 30000;

  const l: AtlasLayer = {
    id: 'normals',
    name: 'Climate normals',
    icon: '☀',
    color,
    range: [p0, p1 + 0.99],
    static: true,
    period: `${p0}–${p1} average`,
    available: stations.length > 0,
    unavailable: 'Environment Canada’s climate-normals service could not be reached when this copy of the data was built. Run <code>npm run data normals</code>, then reload.',
    build({ focusedId }) {
      const live = (liveCache[cur.key] ??= stations.filter((s) => val(s) != null));
      const layers: Layer[] = [
        new ScatterplotLayer<NormalsStation>({
          id: 'normals-base',
          data: stations,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: 900,
          radiusMinPixels: 2,
          getFillColor: [197, 232, 108, 70],
          pickable: true,
          parameters: NO_DEPTH,
        }),
        new ColumnLayer<NormalsStation>({
          id: 'normals-cols',
          data: live,
          getPosition: (s) => [s.lon, s.lat],
          radius: 2200,
          diskResolution: 20,
          extruded: true,
          getElevation: (s) => height(val(s)!),
          getFillColor: (s) => rgb(cur.ramp(val(s)!), 240),
          material: { ambient: 0.6, diffuse: 0.55, shininess: 40 },
          pickable: true,
          updateTriggers: { getElevation: cur.key, getFillColor: cur.key },
        }),
      ];
      if (focusedId === 'normals')
        layers.push(
          new TextLayer<NormalsStation>({
            id: 'normals-labels',
            data: live,
            getPosition: (s) => [s.lon, s.lat, height(val(s)!) + 2500],
            getText: (s) => fmt.int(val(s)!),
            getSize: 11,
            getColor: [235, 240, 248, 230],
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 220],
            fontSettings: { sdf: true },
            billboard: true,
            updateTriggers: { getText: cur.key, getPosition: cur.key },
            parameters: NO_DEPTH,
          } as any),
        );
      return layers;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, `Climate normals · ${p0}–${p1} average`)}
        <h2>What a town feels like</h2>`;
      if (!data.normals) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Annual temperature hides the differences you feel day to day. These are Environment Canada’s <b>30-year averages (${p0}–${p1})</b> at ${stations.length} weather stations, so this layer has no timeline: other layers keep playing underneath. Pick what the columns show:</p>
        <div class="chips" style="margin:2px 0 10px">${VARS.map((v) => `<button class="chip" data-v="${v.key}" style="--c:${color}">${v.chip}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === cur.key));
        const r = ranked();
        const lo = r.at(-1), hi = r[0];
        hero(0, hi ? fmtV(val(hi)!) : '–', hi ? `${cur.best.toLowerCase()}: ${hi.name}` : '');
        hero(1, lo ? fmtV(val(lo)!) : '–', lo ? `other extreme: ${lo.name}` : '');
        hero(2, String(r.length), `stations report ${cur.chip.toLowerCase()}`);
        const med = d3.median(r, (s) => val(s)!);
        hero(3, med != null ? fmtV(med) : '–', 'island median');
        const max = d3.max(r, (s) => val(s)!) ?? 1;
        body.innerHTML = `<h3>${cur.best} · ${cur.label}</h3>
          <ol class="rank-list">${r.map((s, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${esc(s.name)}</span>${s.yrs < 20 ? `<br><span class="rd">${s.yrs} yrs of record</span>` : ''}</span><span><div class="bar"><i style="width:${Math.round((val(s)! / max) * 100)}%;background:${cur.ramp(val(s)!)}"></i></div><div class="bar-v">${fmt.int(val(s)!)}</div></span></li>`).join('')}</ol>
          <div class="ramp" style="background:${rampCSS((t) => cur.ramp(cur.domain[0] + t * (cur.domain[1] - cur.domain[0])))}"></div>
          <div class="ramp-labels"><span>${cur.domain[0]} ${cur.unit}</span><span>${cur.domain[1]}+ ${cur.unit}</span></div>
          ${cur.key === 'sun' ? `<div class="callout" style="--c:${color}">Only ${r.length} island stations measure sunshine. The Town Report and Town Finder borrow the nearest one (within 60 km) and name it.</div>` : ''}`;
      };
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-v]')?.dataset.v;
        const v = VARS.find((x) => x.key === k);
        if (v) { cur = v; draw(); }
      });
      draw();
      el.insertAdjacentHTML('beforeend', `
        <p class="note">A “normal” is the average of ${p1 - p0 + 1} years of daily observations, the standard climate reference period. Some stations have gaps; those with under 20 years behind a value are flagged. Newer ${p0 + 10}–${p1 + 10} normals are not yet in Environment Canada’s open API.</p>
        ${sourceLine(data.normals.source)}`);
      return { update() {} };
    },
    tooltip(info) {
      const o = info.object as NormalsStation;
      if (!o || !info.layer?.id.startsWith('normals')) return null;
      const row = (k: string, v: string | null) => (v ? `<br><span class="tk">${k}</span> <span class="tv">${v}</span>` : '');
      const n = (v: number | undefined, u: string) => (v != null ? `${fmt.int(v)} ${u}` : null);
      return `<b>${esc(o.name)}</b>${row('Sunshine', n(o.sun, 'h/yr'))}${row('Rain days', n(o.wetDays, '/yr'))}${row('Frost days', n(o.frostDays, '/yr'))}${row('Snowfall', n(o.snow, 'cm/yr'))}${row('Precipitation', n(o.precip, 'mm/yr'))}${row('Jan / Jul mean', o.tJan != null && o.tJul != null ? `${o.tJan.toFixed(1)} / ${o.tJul.toFixed(1)} °C` : null)}${row('Wettest month', o.wet ? `${MONTHS[o.wet[0] - 1]} (${fmt.int(o.wet[1])} mm)` : null)}<br><span class="tk">${p0}–${p1} normals${o.yrs < 20 ? ` · ${o.yrs} yrs of record` : ''}</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// MUNICIPAL LAYERS (population, housing, crime) share a column renderer

function townColumns(id: string, munis: Muni[], value: (m: Muni) => number | null, height: (v: number) => number, colorOf: (v: number, m: Muni) => RGBA, time: number, selected: string | null) {
  const live = munis.map((m) => ({ m, v: value(m) })).filter((d) => d.v != null) as { m: Muni; v: number }[];
  return [
    new ColumnLayer<any>({
      id: `${id}-cols`,
      data: live,
      getPosition: (d) => [d.m.lon, d.m.lat],
      radius: 1700,
      diskResolution: 28,
      extruded: true,
      getElevation: (d) => height(d.v),
      getFillColor: (d) => colorOf(d.v, d.m),
      getLineColor: [255, 255, 255, 200],
      material: { ambient: 0.55, diffuse: 0.65, shininess: 60 },
      pickable: true,
      updateTriggers: { getElevation: time, getFillColor: [time, selected] },
    }),
  ];
}

function populationLayer(data: Data): AtlasLayer {
  const color = '#3ecf8e';
  const pop = data.population?.munis ?? {};
  // Totals, the timeline and the charts use BC Stats' annual municipal series; island communities
  // are a single 2021 Census snapshot, shown as columns in 2021 only.
  const muniPop = Object.fromEntries(Object.entries(pop).filter(([, p]) => !p.census));
  const islandKeys = Object.keys(pop).filter((k) => pop[k].census);
  const ramp = d3.scaleSequential(d3.interpolateRgb('#0e4d3a', '#b8ffde')).domain([0.12, 0.42]).clamp(true);
  const allYears = new Set<number>();
  Object.values(muniPop).forEach((p) => Object.keys(p.pop).forEach((y) => allYears.add(+y)));
  const ys = [...allYears].sort((a, b) => a - b);
  const firstProj = Math.min(...Object.values(muniPop).map((p) => p.firstProjection ?? 9999));
  const total = (y: number) => d3.sum(Object.values(muniPop), (p) => p.pop[y] ?? 0);
  const seniors = (y: number) => d3.sum(Object.values(muniPop), (p) => (p.pop[y] ?? 0) * (p.s65[y] ?? 0)) / (total(y) || 1);
  const y0 = ys[0] ?? 2001, y1 = ys.at(-1) ?? 2046;
  let shownTime = y0;

  const l: AtlasLayer = {
    id: 'population',
    name: 'Population & age',
    icon: '◍',
    color,
    range: [y0, y1 + 0.99],
    available: !!data.population,
    build({ time, selected }) {
      shownTime = time;
      return townColumns(
        'population', data.munis,
        (m) => interpYearly(pop[m.key]?.pop, time),
        (v) => Math.sqrt(v) * 85,
        (_v, m) => {
          const s = interpYearly(pop[m.key]?.s65, time) ?? 0.2;
          return rgb(ramp(s), time >= firstProj ? 150 : 240);
        },
        time, selected,
      );
    },
    spark: () => ys.map((x) => ({ x, y: total(x), color: x >= firstProj ? 'rgba(62,207,142,.45)' : undefined })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'BC Stats estimates & projections')}
        <h2>Who lives here — and how old</h2>
        <p class="lede">Column height shows each municipality’s population; colour shows the share of residents aged 65+ (brighter = older). From ${firstProj} on, figures are BC Stats <i>projections</i> and columns turn translucent.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Share of residents aged 65+</h3>`);
      const keys = Object.keys(muniPop);
      const highlight = new Set(['victoria', 'nanaimo', 'qualicum beach', 'sidney', 'courtenay', 'langford']);
      const palette = ['#3ecf8e', '#4cc9f0', '#ffd166', '#ff8a3d', '#b388ff', '#ff5d8f'];
      let pi = 0;
      const series = keys.map((k) => {
        const m = data.munis.find((x) => x.key === k)!;
        const hl = highlight.has(k);
        return { key: k, label: m.name, color: hl ? palette[pi++ % palette.length] : '#5d6b84', muted: !hl, width: hl ? 2 : 1, values: Object.entries(pop[k].s65).map(([y, v]) => ({ x: +y, y: v })) };
      });
      const set = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [y0, y1], height: 160, yFormat: (v) => `${Math.round(v * 100)}%`, yZero: false }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.filter((s) => !s.muted).map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join('')}<span><i class="sw" style="background:#5d6b84"></i>other towns</span></div>`);
      el.insertAdjacentHTML('beforeend', `
        <h3>Colour: share aged 65+</h3>
        <div class="ramp" style="background:${rampCSS((t) => ramp(0.12 + t * 0.3))}"></div>
        <div class="ramp-labels"><span>12%</span><span>27%</span><span>42%+</span></div>
        <p class="note">Covers the island’s ${keys.length} incorporated municipalities; rural electoral areas are not shown.${islandKeys.length ? ` The ${islandKeys.length} shortlisted islands (${islandKeys.map((k) => data.munis.find((m) => m.key === k)?.name ?? k).join(', ')}) only have a 2021 Census count, so their columns appear in 2021 and they are left out of the totals.` : ''} Projections after ${firstProj - 1} are BC Stats’ P.E.O.P.L.E. scenario, not forecasts of certainty.</p>
        ${sourceLine(data.population?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          hero(0, fmt.int(total(y)), `municipal residents ${y}${y >= firstProj ? ' (proj.)' : ''}`);
          hero(1, fmt.pct(seniors(y)), `aged 65+ in ${y}`);
          const t0 = total(y0);
          hero(2, `${fmt.signed(((total(y) / t0) - 1) * 100, 0)}%`, `growth since ${y0}`);
          const oldest = keys.filter((k) => pop[k].pop[y] > 1000).sort((a, b) => (pop[b].s65[y] ?? 0) - (pop[a].s65[y] ?? 0))[0];
          const om = data.munis.find((m) => m.key === oldest);
          hero(3, om?.name ?? '–', `oldest town ${y} (${oldest ? fmt.pct(pop[oldest].s65[y]) : ''} 65+)`);
          set(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('population')) return null;
      const p = pop[o.m.key];
      return `<b>${o.m.name}</b><br><span class="tk">Population${p.census ? ' (2021 Census)' : ''}</span> <span class="tv">${fmt.int(o.v)}</span><br><span class="tk">Aged 65+</span> <span class="tv">${fmt.pct(interpYearly(p.s65, shownTime) ?? 0)}</span><br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

function housingLayer(data: Data): AtlasLayer {
  const color = '#b388ff';
  const hs = data.housing?.munis ?? {};
  const ramp = d3.scaleSequential(d3.interpolateRgb('#2a1b5c', '#f0e2ff')).domain([350_000, 1_300_000]).clamp(true);
  const months = [...new Set(Object.values(hs).flatMap((s) => Object.keys(s)))].sort();
  const first = months[0] ?? '2017-01';
  const last = months.at(-1) ?? '2026-09';
  const toT = (m: string) => +m.slice(0, 4) + (+m.slice(5, 7) - 1) / 12;
  const t0 = toT(first), t1 = toT(last);
  const price = (key: string, t: number) => trailingMedianPrice(hs[key], t, 6);
  const big = ['victoria', 'saanich', 'nanaimo', 'langford', 'courtenay', 'campbell river', 'port alberni', 'parksville'];
  const typical = (t: number) => d3.median(big.map((k) => price(k, t)).filter((v): v is number => v != null)) ?? null;

  const l: AtlasLayer = {
    id: 'housing',
    name: 'Home prices',
    icon: '⌂',
    color,
    range: [t0 + 0.4, t1 + 1 / 12],
    monthly: true,
    available: !!data.housing,
    build({ time, selected }) {
      return townColumns('housing', data.munis, (m) => price(m.key, time), (v) => v * 0.034, (v) => rgb(ramp(v), 240), time, selected);
    },
    spark: () => months.filter((_, i) => i % 1 === 0).map((m) => ({ x: toT(m), y: typical(toT(m)) ?? 0 })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, `Property transfers · ${first.slice(0, 4)} → ${last}`)}
        <h2>What homes really sell for</h2>
        <p class="lede">The median fair-market value of every property sale recorded for BC’s Property Transfer Tax, town by town, month by month. Columns are a 6-month rolling median so small towns don’t flicker.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Median sale value (6-month rolling)</h3>`);
      const palette = ['#b388ff', '#4cc9f0', '#ffd166', '#3ecf8e', '#ff8a3d', '#ff5d8f'];
      const hl = ['victoria', 'nanaimo', 'langford', 'courtenay', 'campbell river', 'port alberni'];
      const series = Object.keys(hs).map((k) => {
        const m = data.munis.find((x) => x.key === k)!;
        const i = hl.indexOf(k);
        const values = months.map((mm) => ({ x: toT(mm), y: price(k, toT(mm)) })).filter((v) => v.y != null) as { x: number; y: number }[];
        return { key: k, label: m.name, color: i >= 0 ? palette[i] : '#5d6b84', muted: i < 0, width: i >= 0 ? 2 : 1, values };
      });
      const set = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [t0, t1], height: 170, yFormat: (v) => `$${d3.format('~s')(v)}`, valueFormat: fmt.money, yZero: false }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.filter((s) => !s.muted).map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join('')}<span><i class="sw" style="background:#5d6b84"></i>other towns</span></div>
        <h3>Colour: median value</h3>
        <div class="ramp" style="background:${rampCSS((t) => ramp(350_000 + t * 950_000))}"></div>
        <div class="ramp-labels"><span>$350K</span><span>$825K</span><span>$1.3M+</span></div>
        <p class="note">Includes all market transfers (houses, condos, land, some commercial), so it runs lower than single-family listing prices. It’s best for comparing towns and seeing trends — not for valuing a specific home.</p>
        ${data.housing?.islands && Object.keys(data.housing.islands).length ? `<p class="note">Island columns are estimates. Island sales are only published inside wider rural areas that are mostly Vancouver Island acreage, so each island’s level comes from what its owners valued their homes at in the 2021 Census, scaled by the typical ratio of sale medians to census values across the municipalities (${data.housing.islands[Object.keys(data.housing.islands)[0]].calib.toFixed(2)}). Its ups and downs since then follow the rural area’s sales.</p>` : ''}
        ${sourceLine(data.housing?.source ?? '')}`);
      return {
        update({ time }) {
          const tt = Math.min(Math.max(time, t0), t1);
          const v = typical(tt);
          hero(0, v ? fmt.money(v) : '–', 'typical across major towns');
          const ref = typical(t0 + 0.5);
          hero(1, v && ref ? `${fmt.signed((v / ref - 1) * 100, 0)}%` : '–', `vs ${Math.floor(t0)}`);
          const ranked = data.munis.map((m) => ({ m, p: price(m.key, tt) })).filter((d) => d.p != null && (hs[d.m.key] ? true : false)) as { m: Muni; p: number }[];
          ranked.sort((a, b) => a.p - b.p);
          const cheap = ranked.find((r) => (data.population?.munis[r.m.key]?.pop?.[Math.floor(tt)] ?? 0) > 5000);
          hero(2, cheap ? fmt.money(cheap.p) : '–', cheap ? `lowest (5K+ pop): ${cheap.m.name}` : '');
          const dear = ranked.at(-1);
          hero(3, dear ? fmt.money(dear.p) : '–', dear ? `highest: ${dear.m.name}` : '');
          set(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('housing')) return null;
      return `<b>${o.m.name}</b><br><span class="tk">Median sale value</span> <span class="tv">${fmt.money(o.v)}</span><br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

function crimeLayer(data: Data): AtlasLayer {
  const color = '#ff4d8d';
  const cr = data.crime?.munis ?? {};
  const ramp = d3.scaleSequential(d3.interpolateRgb('#4a0f2b', '#ffd1e3')).domain([30, 180]).clamp(true);
  const ys = [...new Set(Object.values(cr).flatMap((c) => Object.keys(c.csi ?? {})))].map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 1998, y1 = ys.at(-1) ?? 2024;
  const bc = data.crime?.bc?.csi ?? {};
  const meanCSI = (y: number) => d3.mean(Object.values(cr).map((c) => c.csi?.[y]).filter((v): v is number => v != null));

  const l: AtlasLayer = {
    id: 'crime',
    name: 'Crime severity',
    icon: '◆',
    color,
    range: [y0, y1 + 0.99],
    available: !!data.crime,
    unavailable: `Statistics Canada’s download service was offline when this copy of the data was built. Run <code>npm run data crime</code> to fetch the Crime Severity Index, then reload.`,
    build({ time, selected }) {
      return townColumns('crime', data.munis, (m) => interpYearly(cr[m.key]?.csi, time), (v) => v * 140, (v) => rgb(ramp(v), 240), time, selected);
    },
    spark: () => ys.map((x) => ({ x, y: meanCSI(x) ?? 0 })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Police-reported crime')}
        <h2>How safe is each town?</h2>`;
      if (!data.crime) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Statistics Canada’s Crime Severity Index weights each crime by how serious it is, so one robbery counts for more than several thefts. 100 = Canada’s 2006 level. Lower is safer.</p>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Crime Severity Index by police service</h3>`);
      const palette = ['#ff4d8d', '#4cc9f0', '#ffd166', '#3ecf8e', '#b388ff'];
      const hl = ['victoria', 'nanaimo', 'courtenay', 'campbell river', 'port alberni'];
      const series = Object.keys(cr).map((k) => {
        const m = data.munis.find((x) => x.key === k)!;
        const i = hl.indexOf(k);
        return { key: k, label: m.name, color: i >= 0 ? palette[i] : '#5d6b84', muted: i < 0, width: i >= 0 ? 2 : 1, values: Object.entries(cr[k].csi ?? {}).map(([y, v]) => ({ x: +y, y: v })) };
      });
      if (Object.keys(bc).length) series.push({ key: 'bc', label: 'BC average', color: '#ffffff', muted: false, width: 1.5, dashed: true, values: Object.entries(bc).map(([y, v]) => ({ x: +y, y: v })) } as any);
      const set = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [y0, y1], height: 170, yFormat: (v) => String(Math.round(v)) }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.filter((s) => !s.muted).map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
        <div class="ramp" style="background:${rampCSS((t) => ramp(30 + t * 150))}"></div>
        <div class="ramp-labels"><span>30</span><span>105</span><span>180+</span></div>
        <p class="note">Only municipalities with their own police service series are shown; smaller villages are folded into rural RCMP detachments. Victoria Police also serves Esquimalt, whose own series ends when the forces merged. Regional service hubs (e.g. Duncan) score high partly because many non-residents shop and work there. Salt Spring, Gabriola and Quadra have their own rural RCMP detachments; Galiano shares the Outer Gulf Islands detachment with Mayne, Pender and Saturna.</p>
        ${sourceLine(data.crime?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.min(Math.floor(time), y1);
          const m = meanCSI(y);
          hero(0, m ? m.toFixed(0) : '–', `average island CSI ${y}`);
          hero(1, bc[y] ? bc[y].toFixed(0) : '–', `BC CSI ${y}`);
          const rows = Object.entries(cr).map(([k, c]) => ({ k, v: c.csi?.[y] })).filter((r) => r.v != null) as { k: string; v: number }[];
          rows.sort((a, b) => a.v - b.v);
          const nm = (k: string) => data.munis.find((m) => m.key === k)?.name ?? k;
          hero(2, rows[0] ? rows[0].v.toFixed(0) : '–', rows[0] ? `lowest: ${nm(rows[0].k)}` : '');
          hero(3, rows.at(-1) ? rows.at(-1)!.v.toFixed(0) : '–', rows.at(-1) ? `highest: ${nm(rows.at(-1)!.k)}` : '');
          set(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('crime')) return null;
      return `<b>${o.m.name}</b><br><span class="tk">Crime Severity Index</span> <span class="tv">${o.v.toFixed(1)}</span><br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// HOSPITAL ACCESS — a static layer: where emergency care is today, and how long the drive takes

const dashExt = [new PathStyleExtension({ dash: true })];

function hospitalsLayer(data: Data): AtlasLayer {
  const color = '#6c8cff';
  const H = data.hospitals;
  const fac: Facility[] = H?.facilities ?? [];
  const routed = !!H && H.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  const er = new Map((H ? townMetrics(data) : []).map((t) => [t.muni.key, t.er]));
  // minutes to the nearest 24/7 ER, avoiding ferries where possible (km if no drive times could be computed)
  const val = (key: string) => { const e = er.get(key); return e ? e.min ?? e.km : null; };
  const ramp = d3.scaleLinear<string>().domain([5, 30, 90]).range(['#e3f1ff', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 1200 + Math.min(v, 150) * 260;
  const ED_LABEL = { '24/7': '24/7 emergency room', call: '24/7, call ahead to confirm', limited: 'limited hours' } as const;
  const edColor = (f: Facility) => (f.ed === '24/7' ? color : f.ed === 'call' ? '#a9b6ff' : '#7d879c');
  const tripText = (t: Trip) => (t.min != null ? `${t.min} min${t.ferry ? ' + ferry' : ''}` : `${Math.round(t.km)} km (straight line)`);

  // road lines for the hovered / selected town, with cumulative lengths for the travelling pulse
  type Row = { t: Trip; i: number; path: [number, number][]; cum: number[] };
  let memoKey: string | null = null;
  let memoRows: Row[] = [];
  const rowsFor = (key: string | null) => {
    if (key === memoKey) return memoRows;
    memoKey = key;
    const m = data.munis.find((x) => x.key === key);
    memoRows = !m || !H ? [] : (H.towns[m.key] ?? []).map((t, i) => {
      const path: [number, number][] = t.line ?? [[m.lon, m.lat], [fac[t.f].lon, fac[t.f].lat]];
      const cum = [0];
      for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], (path[k][1] - path[k - 1][1]) * 1.5));
      return { t, i, path, cum };
    });
    return memoRows;
  };
  const along = (r: Row, q: number): [number, number] => {
    const d = q * r.cum[r.cum.length - 1];
    const k = Math.max(1, lowerBound(r.cum, d, (c) => c));
    if (k >= r.path.length) return r.path[r.path.length - 1];
    const f = (d - r.cum[k - 1]) / (r.cum[k] - r.cum[k - 1] || 1);
    return [r.path[k - 1][0] + (r.path[k][0] - r.path[k - 1][0]) * f, r.path[k - 1][1] + (r.path[k][1] - r.path[k - 1][1]) * f];
  };

  const l: AtlasLayer = {
    id: 'hospitals',
    name: 'Hospital access',
    icon: '✚',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'emergency care today',
    available: fac.length > 0,
    unavailable: 'The HealthLinkBC hospital and emergency-room lists could not be downloaded when this copy of the data was built. Run <code>npm run data hospitals</code>, then reload.',
    build({ selected, hovered, focusedId, clock }) {
      const focused = focusedId === 'hospitals';
      const out: Layer[] = [];
      if (focused) out.push(...townColumns('hospitals', data.munis, (m) => val(m.key), height, (v) => rgb(ramp(v), 235), 0, selected));

      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        const q = (clock % 2600) / 2600;
        out.push(
          new PathLayer<Row>({
            id: 'hospitals-trips',
            data: rows,
            getPath: (r) => r.path,
            getColor: (r) => (r.i === 0 ? rgb('#ffffff', 235) : rgb(color, 200)),
            getWidth: (r) => (r.i === 0 ? 4 : 2.5),
            widthUnits: 'pixels',
            capRounded: true,
            jointRounded: true,
            extensions: dashExt,
            getDashArray: (r) => (r.t.ferry || !r.t.line ? [3, 2] : [0, 0]),
            dashJustified: true,
            parameters: NO_DEPTH,
          } as any),
          new ScatterplotLayer<Row>({
            id: 'hospitals-pulse',
            data: rows,
            getPosition: (r) => along(r, q),
            getRadius: 900,
            radiusMinPixels: 3,
            getFillColor: (r) => (r.i === 0 ? [255, 255, 255, 230] : rgb(color, 230)),
            updateTriggers: { getPosition: q },
            parameters: ADDITIVE,
          }),
          new TextLayer<Row>({
            id: 'hospitals-mins',
            data: rows,
            getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${tripText(r.t)}\n${fac[r.t.f].name}`,
            getSize: (r) => (r.i === 0 ? 13 : 11),
            getColor: (r) => (r.i === 0 ? [255, 255, 255, 255] : [214, 222, 255, 235]),
            getPixelOffset: [0, -14],
            getAlignmentBaseline: 'bottom',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            characterSet: 'auto',
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 230],
            fontSettings: { sdf: true },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }

      // round-the-clock ERs breathe; smaller sites are drawn dimmer
      const p = (clock % 2400) / 2400;
      out.push(
        new ScatterplotLayer<Facility>({
          id: 'hospitals-halo',
          data: fac.filter((f) => f.ed === '24/7'),
          getPosition: (f) => [f.lon, f.lat],
          getRadius: 1400 + p * 5200,
          radiusMinPixels: 5,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1.5,
          getLineColor: rgb(color, 210 * (1 - p)),
          updateTriggers: { getRadius: p, getLineColor: p },
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<Facility>({
          id: 'hospitals-sites',
          data: fac,
          getPosition: (f) => [f.lon, f.lat],
          getRadius: (f) => (f.hospital ? 1200 : 850),
          radiusMinPixels: focused ? 5 : 4,
          radiusMaxPixels: 13,
          getFillColor: (f) => (f.ed === '24/7' ? [255, 255, 255, 255] : [16, 22, 38, 235]),
          stroked: true,
          getLineColor: (f) => rgb(edColor(f)),
          lineWidthMinPixels: 2.5,
          pickable: true,
          parameters: { depthCompare: 'always' },
        } as any),
      );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Hospital access · emergency care today')}
        <h2>How far to emergency care?</h2>`;
      if (!H) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const n24 = fac.filter((f) => f.ed === '24/7').length;
      el.insertAdjacentHTML('beforeend', `<p class="lede">The ${fac.length} hospitals and emergency rooms Island Health lists in the provincial HealthLinkBC directory (${n24} open around the clock). Column height shows the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each town centre to its nearest <b>24/7 emergency room</b>, avoiding ferries where a road route exists. Islands without their own ER use the ferry route; the time covers the crossing but not the wait for a sailing. Hover or click a town to see its routes.</p>`);
      const hero = heroStats(el, 4);
      const rows = data.munis.flatMap((m) => { const e = er.get(m.key), v = val(m.key); return e && v != null ? [{ m, v, e }] : []; });
      rows.sort((a, b) => a.v - b.v);
      const near = routed ? 20 : 15;
      hero(0, String(n24), '24/7 emergency rooms');
      hero(1, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, 'median town to a 24/7 ER');
      hero(2, `${rows.filter((r) => r.v <= near).length} of ${rows.length}`, `towns within ${near} ${unit}`);
      const far = rows.at(-1);
      hero(3, far ? `${Math.round(far.v)} ${unit}` : '–', far ? `farthest: ${far.m.name}` : '');
      const max = d3.max(rows, (r) => r.v) ?? 1;
      const small = fac.filter((f) => f.ed !== '24/7');
      el.insertAdjacentHTML('beforeend', `
        <h3>${routed ? 'Drive' : 'Distance'} to the nearest 24/7 emergency room</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${r.m.name}</span><br><span class="rd">${esc(r.e.name)} · ${Math.round(r.e.km)} km${r.e.ferry ? " · by ferry, plus the wait" : ""}</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${ramp(r.v)}"></i></div><div class="bar-v">${Math.round(r.v)}</div></span></li>`).join('')}</ol>
        <div class="ramp" style="background:${rampCSS((t) => ramp(5 + t * 85))}"></div>
        <div class="ramp-labels"><span>5 ${unit}</span><span>30</span><span>90+ ${unit}</span></div>
        <div class="legend"><span><i class="sw" style="background:#fff;box-shadow:0 0 0 2px ${color}"></i>24/7 ER</span><span><i class="sw" style="background:#101626;box-shadow:0 0 0 2px #a9b6ff"></i>24/7, call ahead</span><span><i class="sw" style="background:#101626;box-shadow:0 0 0 2px #7d879c"></i>limited hours</span><span>dashed route = ferry</span></div>
        ${small.length ? `<div class="callout" style="--c:${color}">Smaller sites: ${small.map((f) => `<b>${esc(f.city)}</b> (${esc(f.hours)})`).join('; ')}. They are left out of the ranking above.</div>` : ''}
        <p class="note">${routed ? 'Drive times are the OSRM router’s estimate for normal free-flowing traffic on OpenStreetMap roads, from the town centre. They don’t include ferry waits, winter driving, or closures such as Highway 4 or the Malahat.' : 'No routing service was reachable when this data was built, so these are straight-line distances, not drive times.'} Opening hours are as listed by HealthLinkBC; rural ERs sometimes close temporarily for staffing, and services (surgery, maternity, cardiac care) differ by hospital — check Island Health before relying on one.</p>
        ${sourceLine(`${H.source}. ${H.routingSource ?? 'Straight-line distances.'}`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('hospitals')) return null;
      if (id === 'hospitals-sites') {
        const f = info.object as Facility;
        return `<b>${esc(f.name)}</b><br><span class="tk">${f.hospital ? 'Hospital' : 'Health centre'} · ${esc(f.city)}</span><br><span class="tk">Emergency</span> <span class="tv">${f.ed ? ED_LABEL[f.ed] : 'none listed'}</span>${f.hours && f.ed !== '24/7' ? `<br><span class="tk">${esc(f.hours)}</span>` : ''}`;
      }
      const o: any = info.object;
      const e = er.get(o.m?.key);
      if (!e) return null;
      return `<b>${o.m.name}</b><br><span class="tk">Nearest 24/7 ER</span> <span class="tv">${e.min != null ? `${e.min} min` : `${Math.round(e.km)} km`}</span><br><span class="tk">${esc(e.name)} · ${Math.round(e.km)} km by ${e.min != null ? 'road' : 'straight line'}</span><br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// WILDFIRE SMOKE — days a year when fine particulates (PM2.5) top the BC 24-hour objective

function smokeLayer(data: Data): AtlasLayer {
  const color = '#c9a27e';
  const S = data.smoke;
  const stations: SmokeStation[] = S?.stations ?? [];
  const thr = S?.threshold ?? 25;
  const isl = new Map((S?.island ?? []).map((r) => [r[0], r]));
  const ys = [...isl.keys()].sort((a, b) => a - b);
  const y0 = ys[0] ?? 2000, y1 = ys.at(-1) ?? 2025;
  const ramp = d3.scaleLinear<string>().domain([0, 3, 10, 20]).range(['#6e665d', '#a8875e', '#e8a14b', '#ffd79a']).clamp(true);
  // The map counts fire-season (May–Oct) days only: in winter the same threshold is crossed by
  // wood-stove smoke pooling in valleys (Duncan, Port Alberni, Courtenay), which would bury the
  // wildfire signal. All-year counts stay in the tooltips and the Town Report.
  const series = stations.map((s) => ({ s, d: Object.fromEntries(Object.entries(s.y).filter(([, v]) => v[3] != null).map(([y, v]) => [y, v[3]!])) }));
  const islandMean = Object.fromEntries(ys.map((y) => [y, isl.get(y)![4]]));
  const peak = d3.max(ys, (y) => islandMean[y]) || 1;
  const worst = [...ys].sort((a, b) => islandMean[b] - islandMean[a]).filter((y) => islandMean[y] >= 1).slice(0, 4);
  const topStation = (y: number) => {
    let best: { s: SmokeStation; v: [number | null, number | null, number, number | null] } | null = null;
    for (const s of stations) { const v = s.y[y]; if (v?.[3] != null && (!best || v[3] > best.v[3]! || (v[3] === best.v[3] && (v[1] ?? 0) > (best.v[1] ?? 0)))) best = { s, v }; }
    return best;
  };
  const elev = (d: number) => 900 + d * 1700;
  let shownYear = y0; // for tooltips
  const short = (n: string) => n.replace(/ (Elementary|School|Firehall|Fire Hall|Health Centre|Community Hall).*$/i, '');

  const l: AtlasLayer = {
    id: 'smoke',
    name: 'Wildfire smoke',
    icon: '☁',
    color,
    range: [y0, y1 + 0.99],
    available: !!S,
    unavailable: `The BC Ministry of Environment air-quality file server couldn’t be reached when this copy of the data was built. Run <code>npm run data smoke</code> to fetch the PM2.5 record, then reload.`,
    build({ time, focusedId }) {
      const y = (shownYear = Math.floor(time));
      const live = series.map(({ s, d }) => ({ s, v: interpYearly(d, time) })).filter((x) => x.v != null) as { s: SmokeStation; v: number }[];
      // a warm haze over the whole map, as thick as the island's smoke that year
      const haze = interpYearly(islandMean, time) ?? 0;
      const a = Math.min(1, haze / peak) ** 1.4;
      const layers: Layer[] = [
        new PolygonLayer<any>({
          id: 'smoke-haze-base',
          data: a > 0.02 ? [[[-131, 46.5], [-120, 46.5], [-120, 52.5], [-131, 52.5]]] : [],
          getPolygon: (p) => p,
          getFillColor: [176, 140, 96, Math.round(a * 80)],
          stroked: false,
          updateTriggers: { getFillColor: time },
          parameters: NO_DEPTH,
        }),
        new ScatterplotLayer<any>({
          id: 'smoke-glow',
          data: live.filter((d) => d.v >= 0.5),
          getPosition: (d) => [d.s.lon, d.s.lat],
          getRadius: (d) => 2500 + Math.sqrt(d.v) * 2600,
          getFillColor: (d) => rgb(ramp(d.v), Math.min(110, 30 + d.v * 6)),
          updateTriggers: { getRadius: time, getFillColor: time },
          parameters: ADDITIVE,
        }),
        new ScatterplotLayer<any>({
          id: 'smoke-sites',
          data: stations.filter((s) => s.y[y]),
          getPosition: (s) => [s.lon, s.lat],
          getRadius: 600,
          radiusMinPixels: 2,
          getFillColor: [201, 162, 126, 90],
          pickable: true,
          parameters: NO_DEPTH,
        }),
        new ColumnLayer<any>({
          id: 'smoke-cols',
          data: live,
          getPosition: (d) => [d.s.lon, d.s.lat],
          radius: 1400,
          diskResolution: 20,
          extruded: true,
          getElevation: (d) => elev(d.v),
          getFillColor: (d) => rgb(ramp(d.v), 235),
          material: { ambient: 0.65, diffuse: 0.5 },
          pickable: true,
          updateTriggers: { getElevation: time, getFillColor: time },
        }),
      ];
      if (focusedId === 'smoke')
        layers.push(
          new TextLayer<any>({
            id: 'smoke-labels',
            data: live.filter((d) => Math.round(d.v) > 0),
            getPosition: (d) => [d.s.lon, d.s.lat, elev(d.v) + 2500],
            getText: (d) => String(Math.round(d.v)),
            getSize: 12,
            getColor: [245, 236, 222, 230],
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 220],
            fontSettings: { sdf: true },
            billboard: true,
            updateTriggers: { getText: time, getPosition: time },
            parameters: NO_DEPTH,
          } as any),
        );
      return layers;
    },
    spark: () => ys.map((x) => ({ x, y: islandMean[x], color: ramp(islandMean[x]) })),
    events: () =>
      worst.map((y) => {
        const r = isl.get(y)!, top = topStation(y);
        return {
          stats: [{ v: r[4].toFixed(1), l: `fire-season days over ${thr} µg/m³, average monitor` }, { v: `${r[2]}`, l: 'monitors with a full year' }, ...(top ? [{ v: `${top.v[3]}`, l: `days at ${top.s.name}` }] : [])],
          t: y + 0.62, layer: 'smoke', title: `${y}: a smoky year`,
          body: `Between May and October, island air monitors averaged ${r[4].toFixed(1)} days with PM2.5 over ${thr} µg/m³ (${r[2]} stations).${top ? ` Most at ${top.s.name}: ${top.v[3]} days; its worst day averaged ${Math.round(top.v[1] ?? 0)} µg/m³.` : ''}`,
          ...(top ? { lon: top.s.lon, lat: top.s.lat, zoom: 8 } : {}),
        };
      }),
    panel(el) {
      el.innerHTML = `${kicker(l, 'Air quality · fine particulates (PM2.5)')}
        <h2>Smoke on the wind</h2>`;
      if (!S) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Wildfire smoke drifts hundreds of kilometres, so towns that never burn still breathe it — and fine particles are hardest on older hearts and lungs. Each column is a provincial air monitor; its height is the number of days between May and October — fire season — when the 24-hour average of PM2.5 topped <b>${thr} µg/m³</b>. A brown haze settles over the map in the island’s smokiest years.</p>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Fire-season days over ${thr} µg/m³, average island monitor</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, {
          data: l.spark(), xDomain: [y0, y1], color, height: 130, yFormat: (v) => String(Math.round(v)),
          tooltip: (d) => {
            const r = isl.get(d.x)!;
            return `<b>${d.x}</b><br>${r[4].toFixed(1)} days May–Oct on average (${r[1].toFixed(1)} all year)<br>most at one station: ${r[5]} (${r[3]} all year)<br>${r[2]} station${r[2] === 1 ? '' : 's'} with a full year`;
          },
        }),
      );
      // coverage: complete years per station, oldest first
      const cov = stations
        .map((s) => { const full = Object.keys(s.y).filter((y) => s.y[y][0] != null).map(Number); return { s, a: d3.min(full)!, b: d3.max(full)!, n: full.length }; })
        .sort((p, q) => p.a - q.a || q.n - p.n);
      el.insertAdjacentHTML('beforeend', `
        <h3>Smokiest years</h3>
        <div class="legend" style="display:grid;gap:6px">${worst.map((y) => { const r = isl.get(y)!, top = topStation(y); return `<span><b>${y}</b> · ${r[4].toFixed(1)} days on average${top ? ` <span class="tk">(${esc(short(top.s.name))}: ${top.v[3]} days, worst day ${Math.round(top.v[1] ?? 0)} µg/m³)</span>` : ''}</span>`; }).join('')}</div>
        <h3>Fire-season days over the objective</h3>
        <div class="ramp" style="background:${rampCSS((t) => ramp(t * 20))}"></div>
        <div class="ramp-labels"><span>0</span><span>3</span><span>10</span><span>20+</span></div>
        <div class="callout" style="--c:${color}"><b>Why ${thr} µg/m³?</b> It is British Columbia’s Ambient Air Quality Objective for PM2.5 averaged over 24 hours, adopted in 2009. (BC judges compliance on the 98th-percentile day of a year; here we simply count every day above it.) The map counts May–October only, when it is mostly wildfire smoke. Several valley towns also cross it in winter from wood-stove smoke trapped under cold air — hover a column, or open a Town Report, for all-year counts.</div>
        <h3>Station coverage</h3>
        <div class="legend" style="display:grid;gap:4px;font-size:12px">${cov.map((c) => `<span>${esc(c.s.name)} <span class="tk">${c.a === c.b ? c.a : `${c.a}–${c.b}`} · ${c.n} yr${c.n === 1 ? '' : 's'}</span></span>`).join('')}</div>
        <p class="note">Monitors are few, cluster on the east coast, and opened in different years, so the island average mixes different sets of stations — early years rest on Victoria alone and the west coast and north island are barely measured. A station-year counts only when at least 75% of its days have data (and a day needs 18 of 24 hours). Instruments changed over time; older TEOM monitors tended to read low in smoke and cold weather, so early years may undercount.</p>
        ${sourceLine(S.source)}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const r = isl.get(y);
          hero(0, r ? r[4].toFixed(1) : '–', r ? `fire-season days over ${thr}, avg monitor ${y}` : `no full-year data in ${y}`);
          const top = topStation(y);
          hero(1, top ? String(top.v[3]) : '–', top?.v[3] ? `most: ${short(top.s.name)}` : 'most at one station');
          hero(2, r ? String(r[2]) : '0', `stations with a full year`);
          hero(3, worst[0] ? String(worst[0]) : '–', worst[0] ? `smokiest year (${islandMean[worst[0]].toFixed(1)} days)` : 'smokiest year');
          set(time);
        },
      };
    },
    describe(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('smoke')) return null;
      const st: SmokeStation = o.s ?? o;
      const ys = Object.keys(st.y).map(Number).filter((y) => st.y[y][3] != null).sort((a, b) => a - b);
      const worstYear = ys.reduce((a, y) => (st.y[y][3]! > (st.y[a]?.[3] ?? -1) ? y : a), ys[0]);
      const worstDay = Math.max(0, ...Object.values(st.y).map((v) => v[1] ?? 0));
      return {
        layer: 'smoke', kind: 'Air monitor', lon: st.lon, lat: st.lat, zoom: 9.5,
        title: st.name, body: `Days each fire season (May–October) when fine particles (PM2.5) averaged over ${thr} µg/m³, the provincial objective, at this monitor.`,
        stats: [
          ...(ys.length ? [{ v: String(worstYear), l: `smokiest season (${st.y[worstYear][3]} days)` }, { v: `${ys.length}`, l: `full years (${ys[0]}–${ys.at(-1)})` }] : [{ v: 'none', l: 'full years of data' }]),
          ...(worstDay ? [{ v: `${Math.round(worstDay)} µg/m³`, l: 'worst daily average' }] : []),
        ],
        detail: detailBars('Smoky fire-season days, year by year', ys.map((y) => ({ x: y, y: st.y[y][3]!, color: ramp(st.y[y][3]!) })), color, (v) => `${Math.round(v)}`, (d) => `<b>${d.x}</b> · ${d.y} days over ${thr} µg/m³`),
        sources: [{ label: 'BC verified air quality data (BC Data Catalogue)', url: 'https://catalogue.data.gov.bc.ca/dataset/air-quality-monitoring-verified-hourly-data-and-station-data' }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('smoke')) return null;
      const s: SmokeStation = o.s ?? o;
      const full = Object.keys(s.y).filter((y) => s.y[y][0] != null);
      const yr = shownYear, v = s.y[yr];
      const now = v ? (v[0] != null ? `<br><span class="tk">${yr}</span> <span class="tv">${v[3]} days over ${thr} in May–Oct (${v[0]} all year)</span><br><span class="tk">Worst day</span> <span class="tv">${v[1]} µg/m³</span>` : `<br><span class="tk">${yr}</span> <span class="tv">only ${Math.round(v[2] * 100)}% of days measured</span>`) : '';
      return `<b>${esc(s.name)}</b>${now}<br><span class="tk">Full years</span> <span class="tv">${full.length ? `${full.length} (${full[0]}–${full.at(-1)})` : 'none'}</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------

/** Curated events that aren’t derivable from the datasets. */
export const CURATED_EVENTS: TimedEvent[] = [
  {
    t: 1964.24, layer: '*', kind: 'Tsunami', title: '1964 — Tsunami floods Port Alberni',
    body: 'Waves from the Great Alaska Earthquake reached Tofino, then ran some 40 km up Alberni Inlet and struck Port Alberni twice overnight on 27–28 March, washing away 55 homes and damaging 375 more.',
    // looking up Alberni Inlet from its mouth toward Port Alberni at the head
    lon: -124.87, lat: 49.16, zoom: 9.5,
    stats: [{ v: 'M9.2', l: 'the Great Alaska Earthquake, 27 March, 5:36 p.m. Alaska time' }, { v: '55', l: 'homes washed away in Port Alberni' }, { v: '375', l: 'more homes damaged' }, { v: '3 m', l: 'above the high-water mark' }],
    sections: [
      { title: 'What happened', text: 'The earthquake struck Prince William Sound, Alaska, nearly 2,000 km away in a straight line. Its tsunami crossed the Gulf of Alaska, reached the exposed west coast at Tofino and travelled up the long, narrow Alberni Inlet to Port Alberni at its head. There the water rose about 30 cm in a minute, to about 3 m above the high-water mark, and the town was hit twice. About 375 homes were damaged and 55 washed away, yet no one was hurt. Damage across British Columbia was estimated at about CA$10 million.' },
      { title: 'Why Alberni Inlet funnels a tsunami', text: 'The inlet is a fjord about 40 km long that narrows and shallows toward Port Alberni. A wave entering its mouth is squeezed into less and less water, so it grows taller as it goes, and the inlet’s length lets the water slosh back and forth for hours. Ocean Networks Canada’s modelling still names Port Alberni, with Boundary Bay and the north-west coast, as where a local Cascadia tsunami would hit hardest.' },
      { title: 'Distant versus local', text: 'In 1964 the danger came from far away, so there were hours between the quake and the waves. A Cascadia earthquake just off the coast would bring the first waves to the outer north-west coast in about 20 minutes (Ocean Networks Canada, 2023): the shaking itself is the warning. Turn on Tsunami zones to see the notification zones and the low ground near the sea.' },
    ],
    sources: [
      { label: '1964 Alaska earthquake (Wikipedia)', url: 'https://en.wikipedia.org/wiki/1964_Alaska_earthquake' },
      { label: 'Port Alberni: history (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Port_Alberni' },
      { label: 'Kouhi et al. (2023), tsunami hazard along BC coastlines, Ocean Networks Canada', url: 'https://tos.org/oceanography/article/assessment-of-tsunami-hazard-along-british-columbia-coastlines-from-coseismic-sources' },
    ],
    layers: ['quakes', 'tsunami'],
  },
  {
    t: 2021.49, layer: '*', title: 'June 2021 — The heat dome',
    body: 'A record-shattering heat wave sets all-time temperature highs across BC in late June; the following weeks bring a severe wildfire season.',
    lon: -124.5, lat: 49.4, zoom: 7,
    stats: [{ v: '49.6 °C', l: 'at Lytton, Canada’s highest ever (29 June)' }, { v: '619', l: 'heat-related deaths in BC' }],
    sections: [{ title: 'What followed', text: 'The heat dried the forests out ahead of a severe fire season across the province, and smoke reached island towns that never burned. Switch on Wildfires and Wildfire smoke to see that summer.' }],
    sources: [{ label: '2021 Western North America heat wave (Wikipedia)', url: 'https://en.wikipedia.org/wiki/2021_Western_North_America_heat_wave' }],
    layers: ['fires', 'smoke'],
  },
  {
    t: 2021.87, layer: '*', title: 'November 2021 — Atmospheric river',
    body: 'Torrential rain causes catastrophic flooding across southern BC; washouts close the Malahat Highway, cutting Victoria off by road from the rest of the island.',
    lon: -123.55, lat: 48.55, zoom: 9.5,
    stats: [{ v: '15 Nov', l: 'the Malahat closed by washouts' }],
    sections: [{ title: 'Why it matters here', text: 'The Malahat (Highway 1) is the only highway between Greater Victoria and the rest of the island. When it closes, the ways round are the Mill Bay–Brentwood Bay ferry or the long Pacific Marine Circle Route.' }],
    sources: [{ label: 'November 2021 Pacific Northwest floods (Wikipedia)', url: 'https://en.wikipedia.org/wiki/November_2021_Pacific_Northwest_floods' }],
    layers: ['rivers'],
  },
  {
    t: 2023.45, layer: '*', title: 'June 2023 — Cameron Bluffs wildfire',
    body: 'A wildfire above Cameron Lake closes Highway 4 — the only road to Port Alberni, Tofino and Ucluelet — for weeks.',
    lon: -124.6, lat: 49.29, zoom: 10,
    sections: [{ title: 'Why it matters here', text: 'Highway 4 is the only paved road to the island’s west coast. While it was closed, Port Alberni, Tofino and Ucluelet were reached by a long gravel detour, and deliveries, commutes and the summer tourist season all felt it.' }],
    layers: ['fires', 'smoke'],
  },
];

// ---------------------------------------------------------------------------------------------
// JUST THE ISLAND — the plain map the atlas opens on, with nothing overlaid

function islandLayer(data: Data): AtlasLayer {
  const l: AtlasLayer = {
    id: 'island',
    name: 'Just the island',
    icon: '◌',
    color: '#4cc9f0',
    range: [1900, 2026],
    static: true,
    period: 'no data overlaid',
    available: true,
    build: () => [],
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Start here')}
        <h2>Vancouver Island, plain</h2>
        <p class="lede">Nothing is overlaid yet. The dots are the ${data.munis.length} towns and islands in the atlas.</p>
        <ol class="howto">
          <li><b>Click a town dot</b> for its report card.</li>
          <li><b>Layer</b> (top left, or press <kbd>L</kbd>): flip a switch to put a data set on the map, and click its name for its story and timeline. <i>Clear the map</i> turns them all off.</li>
          <li>On a history layer, press <b>▶</b> (or <kbd>Space</kbd>) on the timeline to play the years.</li>
          <li><b>Town Finder</b> ranks towns by what matters to you; <b>Land Finder</b> filters every parcel of 5+ acres.</li>
          <li><b>Data &amp; sources</b> shows where every number comes from.</li>
        </ol>
        <p class="note">Drag to pan, scroll to zoom, right-drag (or Ctrl-drag) to tilt and turn the map.</p>`;
      return { update() {} };
    },
    tooltip: () => null,
  };
  return l;
}

export function buildLayers(data: Data): AtlasLayer[] {
  return [islandLayer(data), firesLayer(data), quakesLayer(data), seismicLayer(data), tsunamiLayer(data), floodLayer(data), riversLayer(data), climateLayer(data), normalsLayer(data), futureLayer(data), populationLayer(data), housingLayer(data), crimeLayer(data), hospitalsLayer(data), smokeLayer(data), wellsLayer(data), internetLayer(data), trailsLayer(data), waterLayer(data), campingLayer(data), snowLayer(data), loggingLayer(data)];
}
