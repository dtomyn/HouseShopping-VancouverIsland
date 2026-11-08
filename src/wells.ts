// GROUNDWATER: every registered water well on the islands (BC's GWELLS registry), drawn as a drill hole going
// down beneath the map to its real depth (exaggerated), coloured by the yield the driller measured. The timeline
// plays the wells appearing by construction year, so rural settlement spreads across the island; the mapped
// aquifers lie flat under them. Also the shared well charts and figures used by the Town Report and the Land Finder.
// Data from scripts/wells.mjs (public/data/wells.json).
import * as d3 from 'd3';
import { LineLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Aquifer, Data, Muni, WellRow, WellStats, Wells, fmt, km, lowerBound } from './data';
import { barChart, rampCSS } from './charts';
import type { AtlasLayer, PanelHandle, TimedEvent } from './layers';
import { esc } from './html';

export const WELL_COLOR = '#19d3c5';
const NOW = new Date().getFullYear();
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
const ADDITIVE = { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false, depthCompare: 'always' } as const;
const filterExt = [new DataFilterExtension({ filterSize: 1 })];
type RGBA = [number, number, number, number];

// ---------------------------------------------------------------------------------------------
// shared: colours, units, and "wells near a point"

/** Yield (US gpm) on a ramp from ember (barely a trickle) through amber (low) to aqua and ice (plenty). */
const yieldRamp = d3.scaleLinear<string>().domain([0, 0.5, 2, 6, 20, 60].map((v) => Math.log1p(v))).range(['#ff2e63', '#ff5f6d', '#ffb347', '#19d3c5', '#4cc9f0', '#e8fbff']).clamp(true);
export const yieldColor = (gpm: number | null) => (gpm == null ? '#7d8aa3' : yieldRamp(Math.log1p(gpm)));
const yieldRGB = (gpm: number | null, a: number): RGBA => { const c = d3.rgb(yieldColor(gpm)); return [c.r, c.g, c.b, gpm == null ? a * 0.45 : a]; };
export const gpmText = (g: number) => `${g < 10 ? g.toFixed(g < 1 ? 2 : 1).replace(/\.?0+$/, '') : Math.round(g)} gpm`;
/** US gallons a minute to litres a minute. */
export const lpm = (g: number) => g * 3.785;
const island = (w: Wells, r: WellRow) => (r[8] >> 1) - 1; // index into w.islands, -1 on Vancouver Island

let wellsData: Wells | null = null;
let grid: Map<string, number[]> | null = null;
const CELL = 0.02;
/** Indexes of wells within `r` km of a point, nearest first. */
export function wellsNear(w: Wells, lon: number, lat: number, r: number): number[] {
  if (wellsData !== w || !grid) {
    wellsData = w;
    grid = new Map();
    w.rows.forEach((row, i) => {
      const k = `${Math.floor(row[0] / CELL)},${Math.floor(row[1] / CELL)}`;
      let a = grid!.get(k);
      if (!a) grid!.set(k, (a = []));
      a.push(i);
    });
  }
  const rx = Math.ceil(r / (111.32 * Math.cos((lat * Math.PI) / 180) * CELL)), ry = Math.ceil(r / (110.54 * CELL));
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  const out: [number, number][] = [];
  for (let x = cx - rx; x <= cx + rx; x++)
    for (let y = cy - ry; y <= cy + ry; y++)
      for (const i of grid.get(`${x},${y}`) ?? []) { const d = km(lon, lat, w.rows[i][0], w.rows[i][1]); if (d <= r) out.push([i, d]); }
  return out.sort((a, b) => a[1] - b[1]).map(([i]) => i);
}

/** The wells a town's figures come from: within `townKm` of the centre, or every well on a small island. */
export function townWells(w: Wells, m: Muni): number[] {
  const k = w.islands.indexOf(m.key);
  if (k < 0) return wellsNear(w, m.lon, m.lat, w.townKm);
  const out: number[] = [];
  w.rows.forEach((r, i) => { if (island(w, r) === k) out.push(i); });
  return out;
}

/**
 * A row of drill holes: each well a line from the ground down to its depth, coloured by yield, with its standing
 * water level marked; sorted shallow to deep, so the spread of depths reads at a glance. Hover for a well's numbers.
 */
export function wellStrip(el: HTMLElement, w: Wells, idx: number[], opts: { height?: number; max?: number } = {}) {
  const rows = idx.map((i) => w.rows[i]).filter((r) => r[3] != null).sort((a, b) => a[3]! - b[3]!);
  if (!rows.length) { el.innerHTML = '<p class="note">No well depths recorded here.</p>'; return; }
  // a big set is thinned evenly along the sorted order, which keeps the shape of the distribution
  const cap = opts.max ?? 160;
  const shown = rows.length > cap ? d3.range(cap).map((k) => rows[Math.round((k * (rows.length - 1)) / (cap - 1))]) : rows;
  const W = el.clientWidth || 340, H = opts.height ?? 150, m = { t: 14, r: 8, b: 16, l: 40 };
  const maxD = Math.max(30, d3.quantile(rows.map((r) => r[3]!), 0.97)!);
  const x = d3.scaleBand<number>().domain(d3.range(shown.length)).range([m.l, W - m.r]).paddingInner(0.25);
  const y = d3.scaleLinear().domain([0, maxD]).nice().range([m.t, H - m.b]);
  const med = d3.median(rows, (r) => r[3]!)!;
  const svg = d3.select(el).html('').classed('chart well-strip', true).append('svg').attr('width', W).attr('height', H);
  svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'url(#ws-ground)');
  const grad = svg.append('defs').append('linearGradient').attr('id', 'ws-ground').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
  grad.append('stop').attr('offset', 0).attr('stop-color', 'rgba(150,120,90,.10)');
  grad.append('stop').attr('offset', 1).attr('stop-color', 'rgba(60,70,110,.18)');
  const ax = svg.append('g').attr('class', 'axis');
  for (const t of y.ticks(4)) {
    ax.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t)).attr('stroke', 'var(--line)');
    ax.append('text').attr('x', m.l - 6).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(t ? `${t} m` : 'ground');
  }
  const bw = Math.max(1, x.bandwidth());
  const g = svg.append('g');
  shown.forEach((r, k) => {
    const cx = x(k)! + bw / 2, d = Math.min(r[3]!, maxD);
    const c = yieldColor(r[4]);
    const hole = g.append('g').attr('class', 'ws-hole');
    hole.append('line').attr('x1', cx).attr('x2', cx).attr('y1', y(0)).attr('y2', y(d)).attr('stroke', c).attr('stroke-width', bw).attr('stroke-opacity', r[4] == null ? 0.35 : 0.85);
    if (r[5] != null && r[5] >= 0 && r[5] < d) hole.append('line').attr('x1', cx - bw / 2 - 1).attr('x2', cx + bw / 2 + 1).attr('y1', y(r[5])).attr('y2', y(r[5])).attr('stroke', '#9cc7ff').attr('stroke-width', 1.5);
    hole.append('title').text(`Well ${r[7]}${r[2] != null ? `, drilled ${Math.floor(r[2])}` : ''}\n${Math.round(r[3]!)} m deep · ${r[4] != null ? `${gpmText(r[4])} (${Math.round(lpm(r[4]))} L/min)` : 'yield not recorded'}${r[5] != null ? `\nwater stands ${Math.round(r[5])} m down` : ''}`);
  });
  svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(med)).attr('y2', y(med)).attr('stroke', '#fff').attr('stroke-dasharray', '3 3').attr('opacity', 0.7);
  svg.append('text').attr('x', W - m.r).attr('y', y(med) - 4).attr('text-anchor', 'end').attr('class', 'ws-med').text(`median ${Math.round(med)} m`);
  svg.append('text').attr('x', m.l).attr('y', H - 3).attr('class', 'ws-cap').text(`${fmt.int(rows.length)} wells by depth${rows.length > shown.length ? `, ${shown.length} shown` : ''}${rows.some((r) => r[3]! > maxD) ? ', deepest cut off' : ''}`);
}

/** Legend for the yield colours (the same everywhere wells are drawn). */
export const yieldLegend = (low: number) => `
  <div class="ramp" style="background:${rampCSS((t) => yieldRamp(t * Math.log1p(60)))}"></div>
  <div class="ramp-labels"><span>trickle</span><span>${low} gpm</span><span>6</span><span>20</span><span>60+ gpm</span></div>
  <div class="legend"><span><i class="sw" style="background:#7d8aa3"></i>yield not recorded</span><span><i class="sw" style="background:#9cc7ff;height:3px"></i>where the water stands</span></div>`;

// ---------------------------------------------------------------------------------------------
// Town Report: the wells around a town

/** Metric tiles for the Town Report (empty when there's no well data). `metric` is the report's own tile builder. */
export function wellsTownRow(data: Data, key: string, metric: (l: string, dot: string, v: string, sub: string) => string) {
  const w = data.wells, s = w?.towns[key];
  if (!w || !s) return '';
  const na = '<span style="color:var(--ink-3)">n/a</span>';
  const where = s.area === 'island' ? 'on the island' : `within ${w.townKm} km`;
  return `<h3>Wells &amp; groundwater</h3>
    <div class="metric-grid">
      ${metric('Well depth', WELL_COLOR, s.depth ? `${s.depth[1]} m` : na, s.depth ? `median of ${fmt.int(s.nDepth)} wells ${where}; half between ${s.depth[0]} and ${s.depth[2]} m` : `no wells recorded ${where}`)}
      ${metric('Well yield', '#4cc9f0', s.gpm ? gpmText(s.gpm[1]) : na, s.gpm ? `median of ${fmt.int(s.nYield)} tested · ${Math.round(lpm(s.gpm[1]))} L/min` : 'no yields recorded')}
      ${metric('Low-yield wells', '#ffb347', s.low != null ? `${Math.round(s.low * 100)}%` : na, s.low != null ? `gave under ${w.lowGpm} gpm when drilled (Vancouver Island: ${Math.round(w.summary.vancouverIsland.low! * 100)}%)` : '')}
    </div>
    <div id="tr-wells" class="tr-wells"></div>`;
}
export function drawTownWells(el: HTMLElement, data: Data, m: Muni) {
  const box = el.querySelector<HTMLElement>('#tr-wells');
  if (box && data.wells) wellStrip(box, data.wells, townWells(data.wells, m), { height: 130 });
}

// ---------------------------------------------------------------------------------------------
// the layer

const PROD: Record<string, string> = { High: '#19d3c5', Moderate: '#4c8dff', Low: '#ffb347' };
const prodRGB = (a: Aquifer, alpha: number): RGBA => { const c = d3.rgb(PROD[a.prod ?? ''] ?? '#7d8aa3'); return [c.r, c.g, c.b, alpha]; };
type AqPoly = { a: number; poly: [number, number][][] };
type FreshWell = { r: WellRow; age: number };

export function wellsLayer(data: Data): AtlasLayer {
  const W = data.wells;
  const rows = W?.rows ?? [];
  const range: [number, number] = [1900, NOW + 0.99];
  // undated wells (a sixth of the registry, mostly old records) join the map at the end of the timeline
  const tOf = (r: WellRow) => r[2] ?? NOW + 0.5;
  const dated = rows.filter((r) => r[2] != null);
  const deep = rows.filter((r) => r[3] != null);
  const aqPolys: AqPoly[] = (W?.aquifers ?? []).flatMap((a, k) => a.polys.map((poly) => ({ a: k, poly })));
  const byYear: Record<number, number> = {};
  for (const r of dated) byYear[Math.floor(r[2]!)] = (byYear[Math.floor(r[2]!)] ?? 0) + 1;
  let exag = 30;
  let showAquifers = true;

  const l: AtlasLayer = {
    id: 'wells',
    name: 'Wells & groundwater',
    icon: '⇣',
    color: WELL_COLOR,
    range,
    available: !!W,
    unavailable: 'The GWELLS well registry could not be downloaded when this copy of the data was built. Run <code>npm run data wells</code>, then reload.',
    build({ time, speed, focusedId }) {
      if (!W) return [];
      const focused = focusedId === 'wells';
      const z = (d: number | null) => -(d ?? 0) * exag;
      const win = Math.max(0.35, speed * 0.9);
      const lo = lowerBound(dated, time - win, (r) => r[2]!), hi = lowerBound(dated, time, (r) => r[2]!);
      const fresh: FreshWell[] = dated.slice(lo, hi).slice(-400).map((r) => ({ r, age: (time - r[2]!) / win }));
      const out: Layer[] = [];
      if (showAquifers)
        out.push(new PolygonLayer<AqPoly>({
          id: 'wells-base', data: aqPolys, getPolygon: (d) => d.poly as any,
          getFillColor: (d) => prodRGB(W.aquifers[d.a], focused ? 26 : 14), getLineColor: (d) => prodRGB(W.aquifers[d.a], focused ? 120 : 60),
          stroked: true, lineWidthMinPixels: 0.7, filled: true,
          // aquifers cover much of the island, so they only catch clicks while this layer is active
          pickable: focused, autoHighlight: focused, highlightColor: [255, 255, 255, 30],
          updateTriggers: { getFillColor: focused, getLineColor: focused },
        }));
      out.push(
        // the drill holes: ground to the bottom of the well
        new LineLayer<WellRow>({
          id: 'wells-stems', data: deep,
          getSourcePosition: (r) => [r[0], r[1], 0], getTargetPosition: (r) => [r[0], r[1], z(r[3])],
          getColor: (r) => yieldRGB(r[4], 150), getWidth: 1.6, widthUnits: 'pixels', widthMinPixels: 1,
          extensions: filterExt, getFilterValue: tOf, filterRange: [1800, time],
          updateTriggers: { getTargetPosition: exag }, parameters: NO_DEPTH,
        } as any),
        // where the water stands in each hole
        new ScatterplotLayer<WellRow>({
          id: 'wells-level', data: deep.filter((r) => r[5] != null && r[5] > 0 && r[5] < r[3]!),
          getPosition: (r) => [r[0], r[1], z(r[5])], getRadius: 30, radiusMinPixels: 1.2, radiusMaxPixels: 3,
          getFillColor: [156, 199, 255, 200], visible: focused,
          extensions: filterExt, getFilterValue: tOf, filterRange: [1800, time],
          updateTriggers: { getPosition: exag }, parameters: NO_DEPTH,
        } as any),
        // the bottom of each well, sized by its yield; low-yield wells are hollow rings
        new ScatterplotLayer<WellRow>({
          id: 'wells-bottoms', data: deep,
          getPosition: (r) => [r[0], r[1], z(r[3])], getRadius: (r) => 50 + Math.sqrt(r[4] ?? 1) * 22, radiusMinPixels: 1.4, radiusMaxPixels: 7,
          filled: true, stroked: true, lineWidthMinPixels: 1,
          getFillColor: (r) => (r[4] != null && r[4] < W.lowGpm ? [0, 0, 0, 0] : yieldRGB(r[4], 220)), getLineColor: (r) => yieldRGB(r[4], 255),
          pickable: true, extensions: filterExt, getFilterValue: tOf, filterRange: [1800, time],
          updateTriggers: { getPosition: exag }, parameters: NO_DEPTH,
        } as any),
        // the wellheads at the surface, so a flat map can still be hovered
        new ScatterplotLayer<WellRow>({
          id: 'wells-heads', data: rows,
          getPosition: (r) => [r[0], r[1], 0], getRadius: 25, radiusMinPixels: 1, radiusMaxPixels: 2.5,
          getFillColor: (r) => yieldRGB(r[4], 170), pickable: true,
          extensions: filterExt, getFilterValue: tOf, filterRange: [1800, time], parameters: NO_DEPTH,
        } as any),
        // a new well flashes down its hole and rings at the surface as the timeline passes it
        new LineLayer<FreshWell>({
          id: 'wells-drill', data: fresh,
          getSourcePosition: (d) => [d.r[0], d.r[1], 0], getTargetPosition: (d) => [d.r[0], d.r[1], z((d.r[3] ?? 30) * Math.min(1, d.age * 2.5))],
          getColor: (d) => [255, 250, 225, 255 * (1 - d.age)], getWidth: 3, widthUnits: 'pixels',
          updateTriggers: { getTargetPosition: [time, exag], getColor: time }, parameters: ADDITIVE,
        } as any),
        new ScatterplotLayer<FreshWell>({
          id: 'wells-ripples', data: fresh,
          getPosition: (d) => [d.r[0], d.r[1], 0], getRadius: (d) => 80 + 900 * d.age, filled: false, stroked: true,
          lineWidthMinPixels: 1.2, getLineColor: (d) => yieldRGB(d.r[4], 230 * (1 - d.age)),
          updateTriggers: { getRadius: time, getLineColor: time }, parameters: ADDITIVE,
        }),
      );
      return out;
    },
    spark: () => d3.range(1900, NOW + 1).map((x) => ({ x, y: byYear[x] ?? 0 })),
    events() {
      if (!W || !dated.length) return [];
      const evs: TimedEvent[] = [];
      const busiest = Object.entries(byYear).sort((a, b) => b[1] - a[1])[0];
      if (busiest) {
        const y = +busiest[0];
        const inYear = dated.filter((r) => Math.floor(r[2]!) === y);
        const c = inYear.reduce((a, r) => [a[0] + r[0], a[1] + r[1]], [0, 0]).map((v) => v / inYear.length);
        evs.push({
          t: y + 0.5, layer: 'wells', title: `${fmt.int(busiest[1])} wells drilled in ${y}`, kind: 'Groundwater',
          body: `The busiest year in the registry: ${fmt.int(busiest[1])} new water wells across the islands as rural lots filled in.`,
          stats: [{ v: fmt.int(busiest[1]), l: `wells drilled in ${y}` }, { v: `${Math.round(d3.median(inYear, (r) => r[3] ?? undefined) ?? 0)} m`, l: 'median depth' }],
          lon: c[0], lat: c[1], zoom: 7.6,
        });
      }
      const deepest = dated.filter((r) => r[3] != null).sort((a, b) => b[3]! - a[3]!)[0];
      if (deepest) {
        const near = nearestMuni(data.munis, deepest[0], deepest[1]);
        evs.push({
          t: deepest[2]!, layer: 'wells', title: `The deepest well: ${fmt.int(deepest[3]!)} m`, kind: 'Groundwater',
          body: `Well ${deepest[7]}, about ${Math.round(near.km)} km from ${near.m.name}, was drilled ${fmt.int(deepest[3]!)} m down${deepest[4] != null ? ` for ${gpmText(deepest[4])}` : ''}. The median well on the islands is ${Math.round(d3.median(deep, (r) => r[3]!)!)} m.`,
          stats: [{ v: `${fmt.int(deepest[3]!)} m`, l: 'deep' }, { v: deepest[4] != null ? gpmText(deepest[4]) : '—', l: 'yield' }],
          sources: [{ label: `GWELLS well ${deepest[7]}`, url: `https://apps.nrs.gov.bc.ca/gwells/well/${deepest[7]}` }],
          lon: deepest[0], lat: deepest[1], zoom: 11,
        });
      }
      return evs;
    },
    panel(el: HTMLElement): PanelHandle {
      el.innerHTML = `<div class="kicker" style="--c:${WELL_COLOR}">Groundwater · 1900 → today</div>
        <h2>The wells beneath the island</h2>`;
      if (!W) { el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`); return { update() {} }; }
      const vi = W.summary.vancouverIsland, sm = W.summary.smallIslands;
      el.insertAdjacentHTML('beforeend', `<p class="lede">Outside the towns, most homes drink from their own well. Each line is a registered water well, drawn down to its <b>real depth (×<span class="w-ex">${exag}</span>)</b> and coloured by the yield the driller measured. <b>Tilt the map</b> to look up at a forest of drill holes from under the island.</p>`);
      const hero = heroRow(el);
      el.insertAdjacentHTML('beforeend', `
        <div class="chip-row w-ctl"><span class="chip-k">Depth ×</span><div class="chips">${[10, 30, 100].map((v) => `<button class="chip${v === exag ? ' on' : ''}" data-ex="${v}" style="--c:${WELL_COLOR}">${v}</button>`).join('')}</div>
        <label class="lr-switch" style="--c:${WELL_COLOR};margin-left:auto"><input type="checkbox" class="w-aq" ${showAquifers ? 'checked' : ''}><span class="sw"></span><span>Aquifers</span></label></div>
        <h3>Wells drilled each year</h3>`);
      const chartBox = el.appendChild(document.createElement('div'));
      let chart: { setPlayhead: (t: number) => void } | null = null;
      requestAnimationFrame(() => (chart = barChart(chartBox, { data: d3.range(1900, NOW + 1).map((x) => ({ x, y: byYear[x] ?? 0 })), xDomain: [1900, NOW], color: WELL_COLOR, height: 110, tooltip: (d) => `<b>${d.x}</b><br>${fmt.int(d.y)} wells drilled` })));
      const ranked = data.munis.map((m) => ({ m, s: W.towns[m.key] })).filter((d) => d.s?.depth && d.s.nDepth >= 15).sort((a, b) => b.s.depth![1] - a.s.depth![1]);
      el.insertAdjacentHTML('beforeend', `
        <h3>Yield when drilled</h3>
        ${yieldLegend(W.lowGpm)}
        <div class="callout" style="--c:#ffb347"><b>The small islands are drier.</b> On the Gulf and Discovery islands, <b>${Math.round(sm.low! * 100)}%</b> of tested wells gave under ${W.lowGpm} gallons a minute, against <b>${Math.round(vi.low! * 100)}%</b> on Vancouver Island; the median well gives <b>${gpmText(sm.gpm![1])}</b> there and <b>${gpmText(vi.gpm![1])}</b> here. ${rockText(W)} And a small island has no rivers flowing in from elsewhere: its groundwater is only the rain that falls on it.</div>
        <h3>Typical well by area</h3>
        <table class="w-table"><thead><tr><th>Area</th><th>Wells</th><th>Depth</th><th>Yield</th><th>Low</th></tr></thead><tbody>
        ${ranked.map(({ m, s }) => `<tr class="${m.island ? 'isl' : ''}" data-town="${esc(m.key)}"><td>${esc(m.name)}</td><td>${fmt.int(s.n)}</td><td>${s.depth![1]} m</td><td style="color:${yieldColor(s.gpm?.[1] ?? null)}">${s.gpm ? gpmText(s.gpm[1]) : '–'}</td><td>${s.low != null ? `${Math.round(s.low * 100)}%` : '–'}</td></tr>`).join('')}
        </tbody></table>
        <p class="note">Medians; towns use wells within ${W.townKm} km of the centre, the small islands (highlighted) every well on the island. Low = under ${W.lowGpm} US gallons a minute (${Math.round(lpm(W.lowGpm))} L/min) when drilled: below that a home usually needs a storage tank to get through the day. Click a row for the town's report.</p>
        <h3>Mapped aquifers</h3>
        <div class="legend">${Object.entries(PROD).map(([k, c]) => `<span><i class="sw" style="background:${c}"></i>${k} productivity · ${W.aquifers.filter((a) => a.prod === k).length}</span>`).join('')}</div>
        <p class="note">${W.aquifers.length} aquifers mapped by the province reach the islands; ${W.aquifers.filter((a) => a.vuln === 'High').length} are rated highly vulnerable to contamination from the surface. Click one (while this layer is active) for its details.</p>
        <p class="note">Yields are the driller's short test when the well was finished, not a guarantee of long-term supply, and dry summers draw levels down. Drillers have only had to report every new well to the province since 2016, so older wells are under-counted, and ${fmt.int(rows.length - dated.length)} records with no date join the map at today. The registry uses 0 both for dry holes and for untested wells, so a 0 counts as not recorded.</p>
        <div class="source">Source: ${esc(W.source)}</div>`);
      el.querySelectorAll<HTMLButtonElement>('[data-ex]').forEach((b) => b.addEventListener('click', () => {
        exag = +b.dataset.ex!;
        el.querySelectorAll('[data-ex]').forEach((x) => x.classList.toggle('on', x === b));
        el.querySelector('.w-ex')!.textContent = String(exag);
      }));
      el.querySelector<HTMLInputElement>('.w-aq')!.addEventListener('change', (e) => { showAquifers = (e.target as HTMLInputElement).checked; });
      el.querySelectorAll<HTMLElement>('[data-town]').forEach((tr) => tr.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:town', { detail: tr.dataset.town }))));
      return {
        update({ time }) {
          const y = Math.floor(time);
          const n = lowerBound(dated, time, (r) => r[2]!);
          hero(0, fmt.int(n), `wells drilled by ${y}`);
          hero(1, fmt.int(byYear[y] ?? 0), `drilled in ${y}`);
          const recent = dated.slice(lowerBound(dated, time - 10, (r) => r[2]!), n);
          const md = d3.median(recent, (r) => r[3] ?? undefined);
          hero(2, md != null ? `${Math.round(md)} m` : '–', `median depth, ${y - 9}–${y}`);
          const ys = recent.filter((r) => r[4] != null);
          hero(3, ys.length ? `${Math.round((ys.filter((r) => r[4]! < W.lowGpm).length / ys.length) * 100)}%` : '–', `low-yield, ${y - 9}–${y}`);
          chart?.setPlayhead(time);
        },
      };
    },
    describe(info) {
      if (!W || !info.layer?.id.startsWith('wells')) return null;
      const o: any = info.object;
      if (o && typeof o.a === 'number') return describeAquifer(W.aquifers[o.a]);
      if (!Array.isArray(o)) return null;
      return describeWell(data, W, o as WellRow);
    },
    tooltip(info) {
      if (!W || !info.layer?.id.startsWith('wells')) return null;
      const o: any = info.object;
      if (o && typeof o.a === 'number') {
        const a = W.aquifers[o.a];
        return `<b>Aquifer ${a.id}${a.name ? ` · ${esc(a.name)}` : ''}</b><br>${a.loc ? `${esc(a.loc)}<br>` : ''}<span class="tk">Material</span> <span class="tv">${esc(a.material ?? '–')}</span><br><span class="tk">Productivity</span> <span class="tv">${esc(a.prod ?? '–')}</span><br><span class="tk">Vulnerability</span> <span class="tv">${esc(a.vuln ?? '–')}</span>`;
      }
      if (!Array.isArray(o)) return null;
      const r = o as WellRow;
      return `<b>Well ${r[7]}</b><br><span class="tk">Drilled</span> <span class="tv">${r[2] != null ? Math.floor(r[2]) : 'date not recorded'}</span><br><span class="tk">Depth</span> <span class="tv">${r[3] != null ? `${Math.round(r[3])} m` : '–'}</span><br><span class="tk">Yield</span> <span class="tv">${r[4] != null ? gpmText(r[4]) : 'not recorded'}</span>${r[5] != null ? `<br><span class="tk">Water level</span> <span class="tv">${Math.round(r[5])} m down</span>` : ''}`;
    },
  };
  return l;
}

/** What the wells draw from, counted from the aquifers they're linked to. */
function rockText(W: Wells) {
  const share = (small: boolean, test: (a: Aquifer) => boolean) => {
    const linked = W.rows.filter((r) => r[6] >= 0 && ((r[8] >> 1) > 0) === small);
    return linked.length ? Math.round((linked.filter((r) => test(W.aquifers[r[6]])).length / linked.length) * 100) : null;
  };
  const rock = share(true, (a) => a.material === 'Bedrock'), gravel = share(false, (a) => a.material === 'Sand and Gravel');
  return rock == null || gravel == null ? '' : `Of the small-island wells linked to a mapped aquifer, <b>${rock}%</b> draw from fractured bedrock, where water moves only through cracks; on Vancouver Island ${gravel}% tap sand and gravel, which holds far more.`;
}

function heroRow(el: HTMLElement) {
  const wrap = el.appendChild(document.createElement('div'));
  wrap.className = 'hero';
  const cells = Array.from({ length: 4 }, () => {
    const s = wrap.appendChild(document.createElement('div'));
    s.className = 'stat';
    s.innerHTML = '<div class="v">–</div><div class="l"></div>';
    return { v: s.querySelector('.v') as HTMLElement, l: s.querySelector('.l') as HTMLElement };
  });
  return (i: number, v: string, l: string) => {
    if (cells[i].v.textContent !== v) cells[i].v.textContent = v;
    if (cells[i].l.textContent !== l) cells[i].l.textContent = l;
  };
}

function nearestMuni(munis: Muni[], lon: number, lat: number) {
  let best = munis[0], bd = Infinity;
  for (const m of munis) { const d = km(lon, lat, m.lon, m.lat); if (d < bd) { bd = d; best = m; } }
  return { m: best, km: bd };
}

const pctRank = (vals: number[], v: number) => Math.round((vals.filter((x) => x < v).length / Math.max(1, vals.length)) * 100);

function describeWell(data: Data, W: Wells, r: WellRow) {
  const near = nearestMuni(data.munis, r[0], r[1]);
  const around = wellsNear(W, r[0], r[1], 2).filter((i) => W.rows[i] !== r);
  const depths = around.map((i) => W.rows[i][3]).filter((v): v is number => v != null);
  const yields = around.map((i) => W.rows[i][4]).filter((v): v is number => v != null);
  const aq = r[6] >= 0 ? W.aquifers[r[6]] : null;
  const compare = [
    r[3] != null && depths.length >= 5 ? `Deeper than ${pctRank(depths, r[3])}% of the ${depths.length} wells within 2 km (their median is ${Math.round(d3.median(depths)!)} m).` : '',
    r[4] != null && yields.length >= 5 ? `Its yield beats ${pctRank(yields, r[4])}% of theirs (median ${gpmText(d3.median(yields)!)}).` : '',
  ].filter(Boolean).join(' ');
  return {
    t: r[2] ?? undefined, layer: 'wells', kind: 'Water well', lon: r[0], lat: r[1], zoom: 12.5,
    title: `Well ${r[7]}`,
    body: `${near.km < 2 ? `In ${near.m.name}` : `About ${Math.round(near.km)} km from ${near.m.name}`}${r[2] != null ? `, drilled in ${Math.floor(r[2])}` : ', date not recorded'}. ${r[4] != null ? (r[4] < W.lowGpm ? `A low-yield well: ${gpmText(r[4])} (${Math.round(lpm(r[4]))} litres a minute) when drilled.` : `It gave ${gpmText(r[4])} (${Math.round(lpm(r[4]))} litres a minute) when drilled.`) : 'No yield was recorded.'}${r[8] & 1 ? ' It is artesian: the water rose and flowed at the surface.' : ''}`,
    stats: [
      { v: r[3] != null ? `${Math.round(r[3])} m` : '–', l: 'deep' },
      { v: r[4] != null ? gpmText(r[4]) : '–', l: 'yield when drilled' },
      { v: r[5] != null ? `${Math.round(r[5])} m` : '–', l: 'down to the water' },
      { v: aq ? `#${aq.id}` : 'none mapped', l: aq ? `aquifer · ${aq.prod ?? '?'} productivity` : 'aquifer' },
    ],
    sections: [
      ...(compare ? [{ title: 'Against its neighbours', text: compare }] : []),
      ...(aq ? [{ title: `Aquifer ${aq.id}`, text: `${aq.material ?? 'Unclassified'}${aq.subtype ? ` (${aq.subtype.toLowerCase()})` : ''}${aq.loc ? `, ${aq.loc}` : ''}. Productivity ${(aq.prod ?? 'unknown').toLowerCase()}, vulnerability to contamination ${(aq.vuln ?? 'unknown').toLowerCase()}, demand ${(aq.demand ?? 'unknown').toLowerCase()}.` }] : []),
    ],
    sources: [{ label: `GWELLS record for well ${r[7]}`, url: `https://apps.nrs.gov.bc.ca/gwells/well/${r[7]}` }],
    detail: (el: HTMLElement) => {
      const idx = wellsNear(W, r[0], r[1], 1);
      if (idx.length < 2) return;
      el.insertAdjacentHTML('beforeend', `<h3>Wells within 1 km</h3>`);
      const box = el.appendChild(document.createElement('div'));
      requestAnimationFrame(() => wellStrip(box, W, idx, { height: 130 }));
    },
  };
}

function describeAquifer(a: Aquifer) {
  let x = 0, y = 0, n = 0;
  for (const [lon, lat] of a.polys[0][0]) { x += lon; y += lat; n++; }
  return {
    layer: 'wells', kind: 'Aquifer', lon: x / n, lat: y / n, zoom: 10,
    title: `Aquifer ${a.id}${a.name ? ` · ${a.name}` : ''}`,
    body: `${a.material ?? 'An'} aquifer${a.subtype ? ` in ${a.subtype.toLowerCase()}` : ''}${a.loc ? ` under ${a.loc}` : ''}, mapped by the province${a.year ? ` in ${a.year}` : ''}.`,
    stats: [
      { v: a.prod ?? '–', l: 'productivity' },
      { v: a.vuln ?? '–', l: 'vulnerability' },
      { v: a.demand ?? '–', l: 'demand on it' },
      { v: a.quality ?? 'none noted', l: 'quality concerns' },
    ],
    sections: [{ title: 'What these mean', text: 'Productivity is how much water the aquifer can give a well. Vulnerability is how easily contamination from the surface (septic fields, spills, farming) could reach it. Demand is how heavily it is already pumped.' }],
    sources: [{ label: `GWELLS aquifer ${a.id}`, url: `https://apps.nrs.gov.bc.ca/gwells/aquifers/${a.id}` }],
  };
}
