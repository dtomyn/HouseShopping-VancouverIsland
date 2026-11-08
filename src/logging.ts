// A century of logging: every mapped cutblock on the islands flashes in the year it was cut, lies as bare ground for
// a few years, then greens over as the forest grows back. Blocks approved or being logged now outline in pink at
// "today", and parks and protected areas show what is set aside. Also the Town Report's "Logging & parks nearby" row.
// Data from scripts/neighbours.mjs (logging.json, logging-blocks.json loaded on first use, neighbours.json).
import * as d3 from 'd3';
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, LoggingBlocks, fmt, km, loadLoggingBlocks, lowerBound } from './data';
import type { AtlasLayer, Ctx, TimedEvent } from './layers';
import { barChart, lineChart, ChartHandle } from './charts';
import { esc } from './html';

export const LOG_COLOR = '#e9b872';
const PLAN_COLOR = '#ff5ca8';
const PARK_COLOR = '#2dd4bf';

type RGBA = [number, number, number, number];
const ADDITIVE = { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false } as const;
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
const filterExt = [new DataFilterExtension({ filterSize: 1 })];
const glowWindow = (speed: number) => Math.max(0.25, speed * 0.9);

/** How a cutblock looks by age, drawn as stacked layers whose fade is done on the GPU by a soft filter range. */
const STAGES = [
  { label: 'Cut this year', c: '#fff3c4' },
  { label: 'Bare ground, 0–3 years', c: '#c98a4e' },
  { label: 'Regrowing, 3–20 years', c: '#9bbf4a' },
  { label: 'Young forest, 20–45 years', c: '#4f8f3a' },
  { label: 'Logged before that', c: '#2f5c33' },
];

type Block = { i: number; t: number; ha: number; cc: number; ring: [number, number][]; c: [number, number] };
type PlanBlock = { kind: 1 | 2; date: number; ha: number; who: string; id: string; c: [number, number]; ring: [number, number][] };
type Park = { name: string; kind: string; ha: number; ring: [number, number][] };

const decode = (enc: number[], west: number, south: number, q: number) => {
  const ring: [number, number][] = [];
  let x = 0, y = 0;
  for (let k = 0; k < enc.length; k += 2) { x += enc[k]; y += enc[k + 1]; ring.push([x / q + west, y / q + south]); }
  return ring;
};
const centre = (ring: [number, number][]): [number, number] => { let x = 0, y = 0; for (const p of ring) { x += p[0]; y += p[1]; } return [x / ring.length, y / ring.length]; };

function nearest(data: Data, lon: number, lat: number) {
  let best = data.munis[0], bd = Infinity;
  for (const m of data.munis) { const d = km(lon, lat, m.lon, m.lat); if (d < bd) { bd = d; best = m; } }
  return { town: best, km: bd };
}
const nearText = (data: Data, lon: number, lat: number) => { const { town, km: d } = nearest(data, lon, lat); return d < 4 ? `at ${town.name}` : `${Math.round(d)} km from ${town.name}`; };

export function loggingLayer(data: Data): AtlasLayer {
  const L = data.logging;
  const N = data.neighbours;
  const years = L ? Object.keys(L.years).map(Number).sort((a, b) => a - b) : [];
  const haOf = (y: number) => L?.years[y]?.[0] ?? 0;
  const nOf = (y: number) => L?.years[y]?.[1] ?? 0;
  const asOf = L?.asOf ?? new Date().getFullYear();
  const y0 = Math.max(1900, years[0] ?? 1900);
  const y1 = Math.floor(asOf);
  const footAt = (y: number) => { let v = 0; for (const [yy, ha] of L?.footprint ?? []) { if (yy > y) break; v = ha; } return v; };
  const share = (y: number) => (L ? footAt(y) / L.landHa : 0);
  const decades = d3.range(Math.floor(y0 / 10) * 10, y1 + 1, 10).map((d) => ({ d, ha: d3.sum(d3.range(d, d + 10), haOf) }));
  const ranked = years.filter((y) => y <= y1).sort((a, b) => haOf(b) - haOf(a));
  const parkHa = d3.sum(N?.parks ?? [], (p) => p[2]);

  const parks: Park[] = N ? N.shapes.flatMap(([pi, rings]) => rings.map((enc) => ({ name: N.parks[pi][0], kind: N.parks[pi][1], ha: N.parks[pi][2], ring: decode(enc, N.west, N.south, N.q) }))) : [];

  // the shapes arrive on first use
  let blocks: Block[] = [];
  let plans: PlanBlock[] = [];
  let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  const onReady: (() => void)[] = [];
  const ensure = () => {
    if (state !== 'idle') return;
    state = 'loading';
    loadLoggingBlocks().then((j: LoggingBlocks | null) => {
      if (!j) { state = 'failed'; onReady.forEach((f) => f()); return; }
      const out: Block[] = [];
      j.t.forEach((t, i) => { for (const enc of j.shapes[i]) { const ring = decode(enc, j.west, j.south, j.q); out.push({ i, t, ha: j.ha[i], cc: j.cc[i], ring, c: centre(ring) }); } });
      blocks = out.sort((a, b) => a.t - b.t);
      plans = j.plan.rows.flatMap((r, k) => j.plan.shapes[k].map((enc) => ({ kind: r[0] as 1 | 2, date: r[1], ha: r[2], who: j.plan.who[r[3]] ?? '', id: r[4], c: [r[5], r[6]] as [number, number], ring: decode(enc, j.west, j.south, j.q) })));
      state = 'ready';
      onReady.forEach((f) => f());
    }).catch(() => { state = 'failed'; });
  };

  const rgba = (c: string, a: number): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };
  const stageLayer = (id: string, color: string, alpha: number, range: (t: number) => [number, number], soft: (t: number) => [number, number], time: number) =>
    new PolygonLayer<Block>({
      id, data: blocks, getPolygon: (d) => d.ring, getFillColor: rgba(color, alpha),
      stroked: false, pickable: id === 'logging-scars', extensions: filterExt, getFilterValue: (d: Block) => d.t,
      filterRange: range(time), filterSoftRange: soft(time), parameters: NO_DEPTH,
    } as any);

  const l: AtlasLayer = {
    id: 'logging',
    name: 'Logging',
    icon: '🪓',
    color: LOG_COLOR,
    range: [y0, y1 + 0.99],
    available: !!L,
    unavailable: 'npm run data logging',
    build({ time, speed, clock }: Ctx) {
      ensure();
      const out: Layer[] = [];
      if (parks.length) out.push(new PolygonLayer<Park>({
        id: 'logging-parks-base', data: parks, getPolygon: (d) => d.ring, getFillColor: [45, 212, 191, 30], getLineColor: [45, 212, 191, 150],
        lineWidthUnits: 'pixels', getLineWidth: 1, pickable: true, parameters: NO_DEPTH,
      }));
      if (state !== 'ready') return out;
      const W = glowWindow(speed);
      // stacked by age: a faint mark that stays, young forest that fades out by 45 years, bare ground that fades by 15
      out.push(
        stageLayer('logging-scars', STAGES[4].c, 80, (t) => [1800, t], (t) => [1800, t], time),
        stageLayer('logging-young-scars', STAGES[3].c, 150, (t) => [t - 45, t], (t) => [t - 20, t], time),
        stageLayer('logging-regrow-scars', STAGES[2].c, 150, (t) => [t - 20, t], (t) => [t - 6, t], time),
        stageLayer('logging-fresh-scars', STAGES[1].c, 215, (t) => [t - 9, t], (t) => [t - 3, t], time),
      );
      const lo = lowerBound(blocks, time - W * 1.3, (b) => b.t), hi = lowerBound(blocks, time, (b) => b.t);
      const cutting = blocks.slice(lo, hi);
      out.push(
        new PolygonLayer<Block>({
          id: 'logging-cutting', data: cutting, getPolygon: (d) => d.ring, extruded: true, wireframe: false,
          getElevation: (d) => (1 - (time - d.t) / (W * 1.3)) * (250 + Math.sqrt(d.ha) * 45),
          getFillColor: (d) => {
            const a = Math.min(1, (time - d.t) / (W * 1.3));
            const c = d3.rgb(d3.interpolateRgb(STAGES[0].c, '#ff9a3c')(a));
            return [c.r, c.g, c.b, 240 - a * 170];
          },
          material: false, pickable: true, parameters: ADDITIVE, updateTriggers: { getElevation: time, getFillColor: time },
        } as any),
        new ScatterplotLayer<Block>({
          id: 'logging-sawdust', data: cutting.filter((b) => time - b.t < W), getPosition: (d) => d.c,
          getRadius: (d) => (500 + Math.sqrt(d.ha) * 70) * (0.3 + ((time - d.t) / W) * 1.7), radiusMinPixels: 2,
          filled: false, stroked: true, lineWidthMinPixels: 1.5,
          getLineColor: (d) => [255, 224, 160, 230 * (1 - (time - d.t) / W) ** 1.4] as RGBA,
          parameters: ADDITIVE, updateTriggers: { getRadius: time, getLineColor: time },
        }),
      );
      // what's on the books now, shown once the timeline reaches the present
      if (time >= y1 && plans.length) {
        const pulse = 0.55 + 0.45 * Math.sin(clock * 3.2);
        out.push(new PolygonLayer<PlanBlock>({
          id: 'logging-plan', data: plans, getPolygon: (d) => d.ring,
          getFillColor: (d) => (d.kind === 2 ? [255, 92, 168, 120] : [255, 92, 168, 45]) as RGBA,
          getLineColor: [255, 140, 200, Math.round(255 * pulse)], lineWidthUnits: 'pixels', getLineWidth: 1.6,
          pickable: true, parameters: NO_DEPTH, updateTriggers: { getLineColor: Math.round(pulse * 20) },
        }));
      }
      return out;
    },
    spark: () => d3.range(y0, y1 + 1).map((x) => ({ x, y: haOf(x) })),
    events(): TimedEvent[] {
      if (!L) return [];
      const out: TimedEvent[] = [];
      // the busiest years
      ranked.slice(0, 5).forEach((y, k) => {
        const [ha, n, lon, lat] = L.years[y];
        out.push({
          t: y + 0.5, layer: 'logging', kind: 'Logging year',
          title: k === 0 ? `${y}: the busiest logging year on record` : `${y}: ${fmt.ha(ha)} logged`,
          body: `${fmt.int(n)} cutblocks were logged across the islands in ${y}, ${k === 0 ? 'more area than in any other year' : `the ${['', 'second', 'third', 'fourth', 'fifth'][k]} busiest year`} in BC's consolidated harvest record. The map shows them flashing as they are cut.`,
          stats: [{ v: fmt.ha(ha), l: 'logged' }, { v: fmt.int(n), l: 'cutblocks' }, { v: `#${k + 1}`, l: `busiest of ${years.length} years` }],
          lon: lon ?? undefined, lat: lat ?? undefined, zoom: 7.6,
          detail: (el) => {
            el.insertAdjacentHTML('beforeend', '<h3>Hectares logged per year</h3>');
            const box = el.appendChild(document.createElement('div'));
            requestAnimationFrame(() => barChart(box, { data: d3.range(y0, y1 + 1).map((x) => ({ x, y: haOf(x), color: x === y ? '#ffffff' : undefined })), xDomain: [y0, y1], color: LOG_COLOR, height: 120, tooltip: (d) => `<b>${d.x}</b><br>${fmt.ha(d.y)} logged` }));
          },
        });
      });
      // milestones: each tenth of the islands' land logged at least once
      let next = 0.1;
      for (const [y, ha] of L.footprint) {
        while (ha / L.landHa >= next && next < 1) {
          out.push({
            t: y + 0.95, layer: 'logging', kind: 'Milestone',
            title: `${Math.round(next * 100)}% of the islands logged`,
            body: `By the end of ${y}, ${Math.round(next * 100)}% of the land on Vancouver Island and the shortlisted islands had been logged at least once, counting land that was logged again only once.`,
            stats: [{ v: fmt.ha(ha), l: 'logged at least once' }, { v: fmt.ha(L.landHa), l: 'of land' }],
          });
          next += 0.1;
        }
      }
      return out.sort((a, b) => a.t - b.t);
    },
    panel(el, ctx) {
      const busiestDecade = [...decades].sort((a, b) => b.ha - a.ha)[0];
      el.innerHTML = `<div class="kicker" style="--c:${LOG_COLOR}">Logging history · ${y0} → today</div>
        <h2>A century of logging</h2>
        <p class="lede">Every mapped cutblock on the islands. Press play to watch the forest being cut: each block flashes in the year it was logged, lies as bare ground for a few years, then greens over as the forest grows back. Pink outlines at today's date are blocks approved or being logged now; teal is parks and protected areas.</p>`;
      if (!L) { el.insertAdjacentHTML('beforeend', '<div class="unavail">Run <code>npm run data logging</code> to build <code>public/data/logging.json</code>.</div>'); return { update() {} }; }
      const hero = el.appendChild(document.createElement('div'));
      hero.className = 'hero';
      hero.innerHTML = Array.from({ length: 4 }, () => '<div class="stat"><div class="v">–</div><div class="l"></div></div>').join('');
      const cells = [...hero.querySelectorAll('.stat')].map((s) => ({ v: s.querySelector('.v')!, l: s.querySelector('.l')! }));
      const set = (i: number, v: string, lab: string) => { if (cells[i].v.textContent !== v) cells[i].v.textContent = v; if (cells[i].l.textContent !== lab) cells[i].l.textContent = lab; };
      const loadNote = el.appendChild(document.createElement('p'));
      loadNote.className = 'note';
      const showLoad = () => { loadNote.textContent = state === 'ready' ? '' : state === 'failed' ? 'The cutblock shapes could not be loaded (run npm run data logging).' : 'Loading every cutblock’s shape…'; loadNote.hidden = state === 'ready'; };
      showLoad();
      onReady.push(showLoad);
      el.insertAdjacentHTML('beforeend', '<h3>Hectares logged per year</h3>');
      const charts: (ChartHandle | null)[] = [null, null];
      const yearBox = el.appendChild(document.createElement('div'));
      el.insertAdjacentHTML('beforeend', '<h3>Per decade</h3>');
      const decBox = el.appendChild(document.createElement('div'));
      decBox.className = 'lg-decades';
      const maxDec = Math.max(...decades.map((d) => d.ha), 1);
      decBox.innerHTML = decades.map((d) => `<div class="lg-dec" data-d="${d.d}" title="${d.d}s: ${fmt.ha(d.ha)} logged"><i style="height:${Math.max(2, Math.round((d.ha / maxDec) * 100))}%"></i><b>${d.ha >= 1000 ? `${Math.round(d.ha / 1000)}K` : Math.round(d.ha)}</b><span>${d.d % 100 === 0 ? d.d : `’${String(d.d).slice(2)}`}</span></div>`).join('');
      el.insertAdjacentHTML('beforeend', '<h3>Share of the islands logged at least once</h3>');
      const shareBox = el.appendChild(document.createElement('div'));
      requestAnimationFrame(() => {
        charts[0] = barChart(yearBox, { data: l.spark(), xDomain: [y0, y1], color: LOG_COLOR, height: 120, tooltip: (d) => `<b>${d.x}</b><br>${fmt.ha(d.y)} logged<br>${fmt.int(nOf(d.x))} cutblocks` });
        const pts = L.footprint.filter(([y]) => y >= y0 && y <= y1).map(([x, ha]) => ({ x, y: (ha / L.landHa) * 100 }));
        charts[1] = lineChart(shareBox, { height: 110, xDomain: [y0, y1], yFormat: (v) => `${v}%`, valueFormat: (v) => `${v.toFixed(1)}%`, series: [{ key: 's', label: 'Logged at least once', color: LOG_COLOR, values: pts }] });
      });
      const b0 = ranked[0];
      el.insertAdjacentHTML('beforeend', `
        <div class="callout" style="--c:${LOG_COLOR}"><b>${fmt.pct(L.loggedHa / L.landHa)}</b> of the islands' land has been logged at least once in the record (${fmt.ha(L.loggedHa)} of ${fmt.ha(L.landHa)}). The busiest decade was the <b>${busiestDecade.d}s</b> (${fmt.ha(busiestDecade.ha)}); the busiest year, <b>${b0}</b> (${fmt.ha(haOf(b0))}).</div>
        <div class="callout" style="--c:${PLAN_COLOR}">On the books now: <b>${fmt.int(L.plan.n)}</b> approved cutblocks not yet started (${fmt.ha(L.plan.ha)}) and <b>${fmt.int(L.plan.active)}</b> being logged (${fmt.ha(L.plan.activeHa)}), on Crown forest tenures.</div>
        ${N ? `<div class="callout" style="--c:${PARK_COLOR}">Named parks and protected areas cover <b>${fmt.ha(parkHa)}</b> of the islands' land (${fmt.pct(parkHa / L.landHa)}).</div>` : ''}
        <h3>How to read the map</h3>
        <div class="legend">${STAGES.map((s) => `<span><i class="sw" style="background:${s.c}"></i>${s.label}</span>`).join('')}<span><i class="sw" style="background:transparent;border:1.5px solid ${PLAN_COLOR}"></i>Approved or being logged now</span><span><i class="sw" style="background:${PARK_COLOR}55;border:1px solid ${PARK_COLOR}"></i>Park or protected area</span></div>
        <p class="note">The record merges what licensees report (RESULTS), forest-tenure maps, the forest inventory and satellite change detection; logging before the 1950s and on private land before satellite mapping is only partly recorded, so early decades are undercounts. Colours by age are an illustration of regrowth, not a measure of today's forest. Approved and active blocks are Crown forest tenures only: harvest plans on private forest land aren't published.</p>
        <div class="source">Source: ${esc(L.source)}${N ? `; parks: ${esc(N.source)}` : ''}</div>`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          set(0, fmt.ha(haOf(y)), `logged in ${y}`);
          set(1, fmt.int(nOf(y)), `cutblocks in ${y}`);
          set(2, fmt.pct(share(y)), `of the islands logged by ${y}`);
          set(3, time >= y1 ? fmt.int(L.plan.n + L.plan.active) : fmt.ha(d3.sum(d3.range(Math.floor(y / 10) * 10, y + 1), haOf)), time >= y1 ? 'blocks approved or being logged now' : `logged in the ${Math.floor(y / 10) * 10}s so far`);
          charts[0]?.setPlayhead(time); charts[1]?.setPlayhead(time);
          decBox.querySelectorAll<HTMLElement>('.lg-dec').forEach((e) => { const d = +e.dataset.d!; e.classList.toggle('on', y >= d && y < d + 10); e.classList.toggle('past', y >= d + 10); });
        },
      };
    },
    describe(info) {
      const o: any = info.object, id = info.layer?.id ?? '';
      if (!o) return null;
      if (id === 'logging-plan') {
        const p = o as PlanBlock;
        return {
          layer: 'logging', kind: p.kind === 2 ? 'Being logged now' : 'Approved cutblock', lon: p.c[0], lat: p.c[1], zoom: 12,
          title: `${p.kind === 2 ? 'A cutblock being logged' : 'An approved cutblock'} ${nearText(data, p.c[0], p.c[1])}`,
          body: p.kind === 2 ? `Logging started here in ${Math.floor(p.date)} and has no end date yet in the forest tenure record.` : `Approved for harvest on a Crown forest tenure and not started yet. Approval doesn't mean it will be cut soon: licensees can hold blocks for years.`,
          stats: [{ v: fmt.ha(p.ha), l: 'planned area' }, { v: p.kind === 2 ? `since ${Math.floor(p.date)}` : String(Math.floor(p.date)), l: p.kind === 2 ? 'logging' : 'latest planning date' }, ...(p.who ? [{ v: p.who, l: 'licensee' }] : []), ...(p.id ? [{ v: p.id, l: 'timber mark and block' }] : [])],
          sources: [{ label: 'Forest Tenure Cutblock Polygons (BC Data Catalogue)', url: 'https://catalogue.data.gov.bc.ca/dataset/forest-tenure-cutblock-polygons-fta-4-0' }],
        };
      }
      if (id === 'logging-parks-base') {
        const p = o as Park;
        const c = centre(p.ring);
        return {
          layer: 'logging', kind: p.kind, lon: c[0], lat: c[1], zoom: 10, title: p.name || p.kind,
          body: `${p.kind} ${nearText(data, c[0], c[1])}. Protected land can't be logged or built on, so it is the surest kind of neighbour.`,
          stats: [{ v: fmt.ha(p.ha), l: 'of land' }],
          sources: [{ label: 'BC Parks, Ecological Reserves and Protected Areas (BC Data Catalogue)', url: 'https://catalogue.data.gov.bc.ca/dataset/bc-parks-ecological-reserves-and-protected-areas' }],
        };
      }
      if (id.startsWith('logging-')) {
        const b = o as Block;
        const y = Math.floor(b.t), age = Math.floor(asOf) - y;
        return {
          t: b.t, layer: 'logging', kind: 'Cutblock', lon: b.c[0], lat: b.c[1], zoom: 12,
          title: `${fmt.ha(b.ha)} logged ${nearText(data, b.c[0], b.c[1])} in ${y}`,
          body: `${b.cc >= 90 ? 'A clearcut' : b.cc <= 10 ? 'A partial cut (some trees left standing)' : `A cut that cleared ${b.cc}% of the block`}, logged in ${y}. ${age <= 3 ? 'It is likely still bare ground or freshly replanted.' : age <= 20 ? `It has been regrowing for about ${age} years.` : `About ${age} years of regrowth: young forest now, not old growth.`}`,
          stats: [{ v: String(y), l: 'logged' }, { v: fmt.ha(b.ha), l: 'area' }, { v: `${b.cc}%`, l: 'clearcut' }, { v: `${age} yrs`, l: 'of regrowth' }],
          sources: [{ label: 'Harvested Areas of BC (Consolidated Cutblocks), BC Data Catalogue', url: 'https://catalogue.data.gov.bc.ca/dataset/harvested-areas-of-bc-consolidated-cutblocks-' }],
        };
      }
      return null;
    },
    tooltip(info) {
      const o: any = info.object, id = info.layer?.id ?? '';
      if (!o) return null;
      if (id === 'logging-plan') return `<b>${o.kind === 2 ? 'Being logged now' : 'Approved cutblock'}</b><br><span class="tk">Area</span> <span class="tv">${fmt.ha(o.ha)}</span><br>${o.who ? `<span class="tk">Licensee</span> <span class="tv">${esc(o.who)}</span>` : ''}`;
      if (id === 'logging-parks-base') return `<b>${esc(o.name || o.kind)}</b><br><span class="tk">Kind</span> <span class="tv">${esc(o.kind)}</span><br><span class="tk">Area</span> <span class="tv">${fmt.ha(o.ha)}</span>`;
      if (id.startsWith('logging-')) return `<b>Cutblock, ${Math.floor(o.t)}</b><br><span class="tk">Area</span> <span class="tv">${fmt.ha(o.ha)}</span><br><span class="tk">Clearcut</span> <span class="tv">${o.cc}%</span>`;
      return null;
    },
  };
  return l;
}

/** Town Report: logging within 5 km in the last 10 years, what's on the books, and the parks nearby. */
export function loggingTownRow(data: Data, key: string, metric: (l: string, dot: string, v: string, sub: string) => string) {
  const t = data.neighbours?.towns[key];
  if (!t || !t.land5) return '';
  const pct = (v: number) => `${Math.round((v / t.land5) * 100)}%`;
  const kindShort = (k: string) => k.replace(/^Provincial Park$/i, 'provincial park').replace(/^Ecological Reserve$/i, 'ecological reserve').toLowerCase();
  return `<h3>Logging &amp; parks nearby</h3>
    <div class="metric-grid">
      ${metric('Recent logging', LOG_COLOR, fmt.ha(t.cut10), `within 5 km in the last 10 years · ${pct(t.everCut)} of the land within 5 km has been logged since records began`)}
      ${metric('On the books', PLAN_COLOR, t.plan ? fmt.ha(t.plan) : 'None', 'approved or being logged within 5 km (Crown tenures)')}
      ${metric('Parks within 5 km', PARK_COLOR, pct(t.park5), `of the land: ${fmt.ha(t.park5)} that can't be logged or built on`)}
    </div>
    ${t.parks.length ? `<div class="tr-falls" style="margin-top:8px">${t.parks.map(([name, kind, d, ha]) => `<span class="tr-fall lg-park"><span class="lg-dot"></span>${esc(name || kind)} <small>${name ? `${esc(kindShort(kind))} · ` : ''}${fmt.ha(ha)} · ${d < 1 ? 'in town' : `${d.toFixed(0)} km`}</small></span>`).join('')}</div>` : ''}
    <button class="tr-fall lg-open" data-layer="logging" style="margin-top:8px">🪓 See a century of logging on the map ›</button>`;
}
