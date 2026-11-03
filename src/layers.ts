// Each "atlas layer" bundles: deck.gl layers for a moment in time, a timeline sparkline,
// notable events, a story panel, and map tooltips.
import * as d3 from 'd3';
import { ColumnLayer, LineLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, FirePerimeter, FirePoint, Muni, Quake, fmt, interpYearly, km, lowerBound, trailingMedianPrice } from './data';
import { barChart, lineChart, rampCSS, scatterChart, stripes, ChartHandle } from './charts';
import { islandAnomalies, slope } from './metrics';

export type Ctx = { time: number; speed: number; data: Data; selected: string | null; focusedId: string; clock: number };
export type AtlasEvent = { t: number; layer: string; title: string; body: string; lon?: number; lat?: number; zoom?: number };
export type PanelHandle = { update: (ctx: Ctx) => void };

export interface AtlasLayer {
  id: string;
  name: string;
  icon: string;
  color: string;
  range: [number, number];
  monthly?: boolean;
  available: boolean;
  unavailable?: string;
  build: (ctx: Ctx) => Layer[];
  spark: () => { x: number; y: number; color?: string }[];
  events: () => AtlasEvent[];
  panel: (el: HTMLElement, ctx: Ctx) => PanelHandle;
  tooltip: (info: PickingInfo) => string | null;
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

export function nearestTown(munis: Muni[], lon: number, lat: number) {
  let best = munis[0], bd = Infinity;
  for (const m of munis) {
    const d = km(lon, lat, m.lon, m.lat);
    if (d < bd) { bd = d; best = m; }
  }
  return { town: best, km: bd };
}

const kicker = (l: AtlasLayer, text: string) => `<div class="kicker" style="--c:${l.color}">${text}</div>`;
const sourceLine = (s: string) => `<div class="source">Source: ${s}</div>`;
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
      return big.map((f) => {
        const { town, km: d } = nearestTown(data.munis, f.c[0], f.c[1]);
        return {
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
          data: rows.map((q) => ({ x: q[4], y: q[3], r: Math.max(1.2, (q[3] - 2) ** 1.6 * 0.8), color: depthColor(q[2]), label: `<b>M${q[3]}</b> · ${Math.floor(q[4])}<br>${q[5]}<br><span class="tk">depth</span> <span class="tv">${q[2]} km</span>` })),
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
    tooltip(info) {
      const q = info.object as Quake;
      if (!q || !info.layer?.id.startsWith('quakes')) return null;
      const d = new Date(Date.UTC(Math.floor(q[4]), 0, 1) + (q[4] % 1) * 365.25 * 864e5);
      return `<b>M${q[3]} earthquake</b><br>${q[5]}<br><span class="tk">Date</span> <span class="tv">${d.toISOString().slice(0, 10)}</span><br><span class="tk">Depth</span> <span class="tv">${q[2]} km</span>`;
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
      const ev: AtlasEvent[] = ys
        .filter((y) => share[y].n >= 8 && share[y].high / share[y].n >= 0.4)
        .map((y) => ({ t: y + 0.05, layer: 'rivers', title: `${y}: island-wide high water`, body: `${share[y].high} of ${share[y].n} gauged rivers peaked at 1.5× their normal annual high or more.` }));
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
        <div class="legend" style="display:grid;gap:6px">${records.map((d) => `<span><b>${d.r.toFixed(1)}×</b> · ${d.s.name} <span class="tk">(${d.s.peakDates[d.y] ?? d.y})</span></span>`).join('')}</div>
        <h3>Peak flow vs. normal</h3>
        <div class="ramp" style="background:${rampCSS((t) => ratioColor(0.4 + t * 2.1))}"></div>
        <div class="ramp-labels"><span>0.4×</span><span>1×</span><span>1.5×</span><span>2.5×+</span></div>
        <p class="note">Gauges measure river flow, not flooded area — a high ratio means high water, not necessarily property damage. For a specific property, check the regional district’s floodplain maps.</p>
        ${sourceLine(data.rivers?.source ?? '')}`);
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
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('rivers')) return null;
      const s = o.s ?? o;
      const rec = Object.entries(s.peaks as Record<string, number>).reduce((a, b) => (b[1] > a[1] ? b : a));
      return `<b>${s.name}</b><br><span class="tk">Gauge</span> <span class="tv">${s.id}</span>${o.r != null ? `<br><span class="tk">This year</span> <span class="tv">${o.r.toFixed(2)}× normal</span>` : ''}<br><span class="tk">Normal annual peak</span> <span class="tv">${s.median} m³/s</span><br><span class="tk">Record</span> <span class="tv">${rec[1]} m³/s (${rec[0]})</span>`;
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
    events: () => [{ t: warmest + 0.5, layer: 'climate', title: `${warmest}: warmest year in the island record`, body: `Island-average temperature ran ${fmt.signed(anomalies[warmest])} °C above the 1961–1990 normal.` }],
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
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('climate')) return null;
      const s = o.s;
      const yrs = Object.keys(s.temp);
      return `<b>${s.name}</b><br><span class="tk">This year</span> <span class="tv">${fmt.signed(o.a, 2)} °C vs normal</span><br><span class="tk">1961–90 normal</span> <span class="tv">${s.baseline.toFixed(1)} °C</span><br><span class="tk">Record</span> <span class="tv">${yrs[0]}–${yrs.at(-1)}</span>`;
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
  const ramp = d3.scaleSequential(d3.interpolateRgb('#0e4d3a', '#b8ffde')).domain([0.12, 0.42]).clamp(true);
  const allYears = new Set<number>();
  Object.values(pop).forEach((p) => Object.keys(p.pop).forEach((y) => allYears.add(+y)));
  const ys = [...allYears].sort((a, b) => a - b);
  const firstProj = Math.min(...Object.values(pop).map((p) => p.firstProjection ?? 9999));
  const total = (y: number) => d3.sum(Object.values(pop), (p) => p.pop[y] ?? 0);
  const seniors = (y: number) => d3.sum(Object.values(pop), (p) => (p.pop[y] ?? 0) * (p.s65[y] ?? 0)) / (total(y) || 1);
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
      const keys = Object.keys(pop);
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
        <p class="note">Covers the island’s ${keys.length} incorporated municipalities; rural electoral areas are not shown. Projections after ${firstProj - 1} are BC Stats’ P.E.O.P.L.E. scenario, not forecasts of certainty.</p>
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
      return `<b>${o.m.name}</b><br><span class="tk">Population</span> <span class="tv">${fmt.int(o.v)}</span><br><span class="tk">Aged 65+</span> <span class="tv">${fmt.pct(interpYearly(p.s65, shownTime) ?? 0)}</span><br><span class="tk">Click for town report</span>`;
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
        <p class="note">Only municipalities with their own police service series are shown; smaller villages are folded into rural RCMP detachments. Victoria Police also serves Esquimalt, whose own series ends when the forces merged. Regional service hubs (e.g. Duncan) score high partly because many non-residents shop and work there.</p>
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

/** Curated events that aren’t derivable from the datasets. */
export const CURATED_EVENTS: AtlasEvent[] = [
  { t: 1964.24, layer: '*', title: '1964 — Tsunami floods Port Alberni', body: 'Waves from the Great Alaska Earthquake funnelled up Alberni Inlet overnight on 27–28 March, damaging hundreds of homes in Port Alberni.', lon: -124.81, lat: 49.23, zoom: 9.5 },
  { t: 2021.49, layer: '*', title: 'June 2021 — The heat dome', body: 'A record-shattering heat wave sets all-time temperature highs across BC in late June; the following weeks bring a severe wildfire season.', lon: -124.5, lat: 49.4, zoom: 7 },
  { t: 2021.87, layer: '*', title: 'November 2021 — Atmospheric river', body: 'Torrential rain causes catastrophic flooding across southern BC; washouts close the Malahat Highway, cutting Victoria off by road from the rest of the island.', lon: -123.55, lat: 48.55, zoom: 9.5 },
  { t: 2023.45, layer: '*', title: 'June 2023 — Cameron Bluffs wildfire', body: 'A wildfire above Cameron Lake closes Highway 4 — the only road to Port Alberni, Tofino and Ucluelet — for weeks.', lon: -124.6, lat: 49.29, zoom: 10 },
];

export function buildLayers(data: Data): AtlasLayer[] {
  return [firesLayer(data), quakesLayer(data), riversLayer(data), climateLayer(data), populationLayer(data), housingLayer(data), crimeLayer(data)];
}
