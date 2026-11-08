// DROUGHT — how low the island's rivers ran each summer, from the Water Survey of Canada's gauges (scripts/drought.mjs).
// Each gauge's upstream basin is shaded by where this summer ranks in that gauge's own record: dark red for the lowest
// on record, amber for below normal, pale for normal, blue for a wet summer. June to October it steps month by month
// (each month's mean flow); the rest of the year it holds the summer's lowest 7-day flow. BC's official drought levels
// (0–5) aren't open data, so this is built from the gauges instead, and goes back as far as each one does.
import * as d3 from 'd3';
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Drought, DroughtGauge, DroughtMap, MONTHS, fmt, loadDroughtMap } from './data';
import { barChart, rampCSS, ChartHandle } from './charts';
import type { AtlasEvent, AtlasLayer, Ctx, TimedEvent } from './layers';
import { esc } from './html';

export const DROUGHT_COLOR = '#e8743b';
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };

/** Rank in the gauge's own record (0 lowest, 100 highest): deep red → amber → pale → blue. */
export const rankColor = d3.scaleLinear<string>().domain([0, 10, 25, 50, 75, 100]).range(['#8f1d0e', '#e0562a', '#f2b04a', '#e6e1cc', '#8cbbe0', '#3a74c4']).clamp(true);
/** "Driest 10%": the gauge's own bottom tenth of summers. */
export const SEVERE = 10;
/** A 7-day low under this share of the river's mean annual flow counts as running nearly dry (a screening line). */
export const NEAR_DRY = 0.02;
/** A river whose usual summer low stays above this share of its average flow is held up by a big lake or a dam. */
const STORED = 0.15;
const RECENT = 20; // summers in the "lately" window
const ISLAND_EVENT_MIN = 20; // gauges reporting before a year can be a "driest summer" event
const SUMMER_MONTHS = [5, 6, 7, 8, 9]; // Jun–Oct, 0-based

export const rankWord = (p: number) => (p === 0 ? 'lowest on record' : p < SEVERE ? 'driest 10%' : p < 25 ? 'below normal' : p <= 75 ? 'normal' : 'above normal');
/** 1 → "1st", 22 → "22nd", 13 → "13th" */
const ord = (n: number) => { const r = Math.round(n), t = r % 100, u = r % 10; return `${r}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`; };
const flow = (v: number) => (v >= 10 ? `${fmt.int(Math.round(v))} m³/s` : v >= 1 ? `${v.toFixed(1)} m³/s` : `${fmt.int(Math.round(v * 1000))} L/s`);
const pct = (v: number) => (v < 1 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`);
/** Day of year → "Sep 12". */
const dayLabel = (y: number, d: number) => { const dt = new Date(Date.UTC(y, 0, d)); return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`; };
const yearsOf = (g: DroughtGauge) => Object.keys(g.years).map(Number).sort((a, b) => a - b);
const worstYears = (g: DroughtGauge, n = 3) => yearsOf(g).sort((a, b) => g.years[a][0] - g.years[b][0]).slice(0, n);

/** How a town's nearest long-record gauge has fared: near-dry share of summers, recent driest-10% summers, worst years. */
export type TownDrought = { g: DroughtGauge; d: number; n: number; nearDry: number | null; recentN: number; recentSevere: number; worst: number[]; stored: boolean };
export function townDrought(data: Data, key: string): TownDrought | null {
  const D = data.drought;
  const t = D?.towns[key];
  if (!D || !t) return null;
  const g = D.gauges[t[0]];
  const ys = yearsOf(g);
  const recent = ys.filter((y) => y > D.lastYear - RECENT);
  return {
    g, d: t[1], n: ys.length,
    nearDry: g.mad ? (100 * ys.filter((y) => g.years[y][0] < NEAR_DRY * g.mad!).length) / ys.length : null,
    recentN: recent.length,
    recentSevere: recent.filter((y) => g.years[y][2] < SEVERE).length,
    worst: worstYears(g),
    stored: !!g.mad && g.normalLow / g.mad > STORED,
  };
}

/** The Town Report row. */
export function droughtTownRow(data: Data, key: string, metric: (l: string, dot: string, v: string, sub: string) => string) {
  const D = data.drought;
  if (!D) return '';
  const t = townDrought(data, key);
  if (!t) return metric('Summer river lows', DROUGHT_COLOR, '<span style="color:var(--ink-3)">n/a</span>', `no long-record river gauge within 40 km`);
  const where = `${esc(t.g.name)} (${t.d.toFixed(0)} km), ${t.n} summers ${t.g.from}–${t.g.to}`;
  const v = t.nearDry != null ? `${Math.round(t.nearDry)}% of summers` : `${t.recentSevere} of ${t.recentN}`;
  const sub = t.nearDry != null
    ? `ran nearly dry (7-day low under ${NEAR_DRY * 100}% of its average flow) · ${where}${t.stored ? '; a lake or dam holds it up in summer' : ''}. Driest-10% summers in the last ${t.recentN}: ${t.recentSevere} (about ${Math.round(t.recentN / 10)} expected); driest ${t.worst.join(', ')}.`
    : `recent summers in its driest 10% · ${where}; driest ${t.worst.join(', ')}.`;
  return metric('Summer river lows', DROUGHT_COLOR, v, `${sub} Nearest gauge, not the town’s water supply.<br><button class="tr-fall" data-layer="drought" style="margin-top:6px">☀ Drought &amp; low rivers ›</button>`);
}

type Shade = { g: DroughtGauge; p: number; poly: [number, number][][] };

export function droughtLayer(data: Data): AtlasLayer {
  const D: Drought | null = data.drought;
  const gauges = D?.gauges ?? [];
  let map: DroughtMap | null = null;
  let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  const ensure = () => {
    if (state !== 'idle') return;
    state = 'loading';
    loadDroughtMap().then((j) => { if (j) { map = j; state = 'ready'; } else state = 'failed'; });
  };
  // bigger basins first so the smaller ones nested in them stay visible on top
  const byArea = [...gauges].sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
  const I = D?.island ?? {};
  const ys = Object.keys(I).map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 1913, y1 = D?.lastYear ?? 2025;
  const counted = ys.filter((y) => I[y][1] >= ISLAND_EVENT_MIN);
  const driest = [...counted].sort((a, b) => I[a][0] - I[b][0]).slice(0, 5);
  const recordLows = (y: number) => gauges.filter((g) => g.years[y]?.[2] === 0 && g.n >= (D?.townMinSummers ?? 20));
  const longGauges = gauges.filter((g) => g.n >= (D?.townMinSummers ?? 20));

  /** Which value shades the map at `time`: a summer month's flow rank (Jun–Oct, once the monthly ranks are loaded),
   *  else the summer's 7-day low (Nov–Dec this year's, Jan–May last year's). */
  const pick = (time: number) => {
    const y = Math.floor(time), mi = Math.floor((time - y) * 12);
    if (map && SUMMER_MONTHS.includes(mi)) return { y, mi, label: `${MONTHS[mi]} ${y} flow` };
    const sy = mi < 5 ? y - 1 : y;
    return { y: sy, mi: -1, label: `summer ${sy} low` };
  };
  const rankAt = (g: DroughtGauge, at: { y: number; mi: number }) =>
    at.mi >= 0 ? map?.months[g.id]?.[at.y]?.[at.mi - 5] ?? null : g.years[at.y]?.[2] ?? null;

  const yearSentence = (y: number) => {
    const rows = longGauges.filter((g) => g.years[y]).sort((a, b) => g2(a, y) - g2(b, y)).slice(0, 4);
    return rows.map((g) => `${g.name} ${flow(g.years[y][0])} (${rankWord(g.years[y][2])})`).join('; ');
  };
  const g2 = (g: DroughtGauge, y: number) => g.years[y][2];
  const islandEvent = (y: number): TimedEvent => {
    const [p, n] = I[y];
    const recs = recordLows(y);
    const days = longGauges.filter((g) => g.years[y]).map((g) => g.years[y][1]).sort((a, b) => a - b);
    const mid = days[days.length >> 1] ?? 250;
    const severe = longGauges.filter((g) => g.years[y] && g.years[y][2] < SEVERE).length;
    return {
      t: y + Math.min(0.95, mid / 365), layer: 'drought', kind: 'Drought',
      title: `${y}: one of the lowest summers for the island’s rivers`,
      body: `In ${y} the median long-record gauge’s lowest 7-day summer flow ranked at the ${ord(p)} percentile of its own record (0 is its lowest ever). ${severe} of ${n} gauges were in their driest 10%${recs.length ? `, and ${recs.length} set ${recs.length > 1 ? 'their' : 'its'} lowest on record` : ''}.`,
      lon: -125.0, lat: 49.4, zoom: 7.4,
      stats: [
        { v: `${ord(p)}`, l: 'percentile, median gauge' },
        { v: `${severe} of ${n}`, l: 'gauges in their driest 10%' },
        ...(recs.length ? [{ v: String(recs.length), l: 'record lows' }] : []),
        { v: dayLabel(y, mid), l: 'typical day of the low' },
      ],
      sections: [
        { title: 'At the gauges', text: `${yearSentence(y)}.` },
        ...(recs.length ? [{ title: 'Lowest on record', text: `${recs.map((g) => `${g.name} (${g.n} summers since ${g.from})`).join('; ')}.` }] : []),
      ],
      sources: [{ label: 'Water Survey of Canada: historical hydrometric data (HYDAT)', url: 'https://wateroffice.ec.gc.ca/search/historical_e.html' }],
      layers: ['drought'],
    };
  };

  const describeGauge = (g: DroughtGauge): AtlasEvent => {
    const yrs = yearsOf(g);
    const worst = worstYears(g, 5);
    const recent = yrs.filter((y) => y > (D?.lastYear ?? y1) - RECENT);
    const sev = recent.filter((y) => g.years[y][2] < SEVERE);
    const ratio = g.mad ? g.normalLow / g.mad : null;
    const dry = g.mad ? yrs.filter((y) => g.years[y][0] < NEAR_DRY * g.mad!).length : null;
    return {
      layer: 'drought', kind: 'River gauge (low flows)', lon: g.lon, lat: g.lat, zoom: 9.5,
      title: g.name,
      body: `Water Survey of Canada gauge ${g.id}${g.area ? `, draining ${fmt.int(Math.round(g.area))} km²` : ''}; ${g.n} complete summers (${g.from}–${g.to})${g.active ? '' : ', no longer measured'}. Each summer’s lowest 7-day average flow between June and October, ranked against the gauge’s own record.`,
      stats: [
        { v: flow(g.normalLow), l: 'usual summer low (median)' },
        ...(g.mad ? [{ v: flow(g.mad), l: `average flow (${g.madYears} full years)` }] : []),
        ...(ratio != null ? [{ v: pct(ratio * 100), l: 'usual low as share of average' }] : []),
        { v: String(worst[0]), l: `lowest, ${flow(g.years[worst[0]][0])}` },
        ...(dry != null ? [{ v: `${dry} of ${g.n}`, l: `summers under ${NEAR_DRY * 100}% of average flow` }] : []),
        { v: `${sev.length} of ${recent.length}`, l: `driest-10% summers, last ${recent.length}` },
      ],
      sections: [
        { title: 'Driest summers', text: worst.map((y) => `${y}: ${flow(g.years[y][0])}, the week to ${dayLabel(y, g.years[y][1])}`).join('; ') + '.' },
        ...(ratio != null && ratio > STORED ? [{ title: 'A river with storage', text: `Its usual summer low is ${pct(ratio * 100)} of its average flow, far above the island’s rain-fed creeks (1–3%). That is the mark of a river fed by a big lake or held up by a dam or weir: storage keeps it running through dry summers, and its lows say more about how the water is managed than about the weather.` }] : []),
        ...(g.rhbn ? [{ title: 'A natural reference basin', text: 'This gauge is in Canada’s Reference Hydrometric Basin Network: a basin with little regulation or development, kept for watching climate. Its lows are the weather’s, not a dam’s.' }] : []),
        { title: 'Reading the colours', text: `0 is the lowest summer this gauge has recorded and 100 the highest; under ${SEVERE} is its driest tenth. A gauge is compared only with itself, so a short record or a river whose management changed (a new dam, a new water licence) can shift its ranks.` },
      ],
      detail: (el) => {
        el.insertAdjacentHTML('beforeend', `<h3>Lowest 7-day summer flow by year</h3>`);
        const box = el.appendChild(document.createElement('div'));
        box.className = 'ev-chart';
        const pts = yrs.map((y) => ({ x: y, y: g.years[y][0], color: rankColor(g.years[y][2]) }));
        requestAnimationFrame(() => barChart(box, { data: pts, xDomain: [yrs[0], yrs.at(-1)!], color: DROUGHT_COLOR, height: 120, yFormat: (v) => (v >= 1 ? d3.format('~s')(v) : d3.format('.2~f')(v)), tooltip: (d) => `<b>${d.x}</b> · ${flow(d.y)}<br>${rankWord(g.years[d.x][2])} (${ord(g.years[d.x][2])} percentile)<br>week to ${dayLabel(d.x, g.years[d.x][1])}` }));
      },
      sources: [
        { label: `Water Survey of Canada: ${g.id} on the Water Office`, url: `https://wateroffice.ec.gc.ca/report/historical_e.html?stn=${encodeURIComponent(g.id)}` },
      ],
      layers: ['drought'],
    };
  };

  const l: AtlasLayer = {
    id: 'drought',
    name: 'Drought & low rivers',
    icon: '☀',
    color: DROUGHT_COLOR,
    range: [y0, y1 + 0.99],
    available: !!D,
    unavailable: 'Run <code>npm run data drought</code> to build <code>public/data/drought.json</code>.',
    build({ time, focusedId }: Ctx) {
      if (!D) return [];
      ensure();
      const focused = focusedId === 'drought';
      const at = pick(time);
      const key = `${at.y}:${at.mi}:${state}`;
      const shades: Shade[] = [];
      if (map) for (const g of byArea) {
        const p = rankAt(g, at);
        const polys = map.basins[g.id];
        if (p == null || !polys) continue;
        for (const poly of polys) shades.push({ g, p, poly });
      }
      const pts = gauges.map((g) => ({ g, p: rankAt(g, at) })).filter((d): d is { g: DroughtGauge; p: number } => d.p != null);
      const out: Layer[] = [
        new PolygonLayer<Shade>({
          id: 'drought-basins-base',
          data: shades,
          getPolygon: (s) => s.poly,
          getFillColor: (s) => rgb(rankColor(s.p), focused ? 150 : 105),
          getLineColor: [10, 14, 22, 160],
          lineWidthMinPixels: 0.6,
          stroked: true,
          pickable: true,
          updateTriggers: { getFillColor: [key, focused] },
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<{ g: DroughtGauge; p: number }>({
          id: 'drought-gauges',
          data: pts,
          getPosition: (d) => [d.g.lon, d.g.lat],
          getRadius: (d) => (d.p === 0 ? 1500 : 900),
          radiusMinPixels: 3,
          radiusMaxPixels: 9,
          getFillColor: (d) => rgb(rankColor(d.p), 245),
          stroked: true,
          getLineColor: (d) => (d.p === 0 ? [255, 255, 255, 255] : [6, 10, 18, 220]),
          lineWidthMinPixels: 1.2,
          pickable: true,
          updateTriggers: { getFillColor: key, getRadius: key, getLineColor: key },
          parameters: NO_DEPTH,
        } as any),
      ];
      if (focused) {
        const low = pts.filter((d) => d.p === 0 && d.g.n >= D.townMinSummers); // only record lows, so the labels stay readable
        out.push(new TextLayer<{ g: DroughtGauge; p: number }>({
          id: 'drought-labels',
          data: low,
          getPosition: (d) => [d.g.lon, d.g.lat],
          getText: () => 'record low',
          getSize: 10.5,
          getColor: [255, 226, 205, 240],
          getPixelOffset: [0, -11],
          getAlignmentBaseline: 'bottom',
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 600,
          outlineWidth: 3,
          outlineColor: [6, 10, 18, 220],
          fontSettings: { sdf: true },
          updateTriggers: { getText: key },
          parameters: NO_DEPTH,
        } as any));
      }
      return out;
    },
    // how dry: positive bars are summers below the median gauge's normal
    spark: () => ys.map((x) => ({ x, y: 50 - I[x][0], color: rankColor(I[x][0]) })),
    events: () => driest.map(islandEvent).sort((a, b) => a.t - b.t),
    panel(el) {
      el.innerHTML = `<div class="kicker" style="--c:${DROUGHT_COLOR}">River gauges · ${y0} → ${y1}</div>
        <h2>Drought and low rivers</h2>
        <p class="lede">Each shaded area is the basin above a river gauge, coloured by how low the river ran against <b>its own record</b>: dark red is its lowest summer ever, amber below normal, pale normal, blue a wet summer. From June to October the map steps month by month; the rest of the year it holds the summer’s lowest week. Press play to run a century of summers.</p>`;
      if (!D) { el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`); return { update() {} }; }
      const hero = el.appendChild(document.createElement('div'));
      hero.className = 'hero';
      hero.innerHTML = Array.from({ length: 4 }, () => '<div class="stat"><div class="v">–</div><div class="l"></div></div>').join('');
      const cells = [...hero.querySelectorAll('.stat')].map((s) => ({ v: s.querySelector('.v')!, l: s.querySelector('.l')! }));
      const set = (i: number, v: string, lab: string) => { if (cells[i].v.textContent !== v) cells[i].v.textContent = v; if (cells[i].l.textContent !== lab) cells[i].l.textContent = lab; };
      el.insertAdjacentHTML('beforeend', '<h3>How dry each summer was (island median, bars up = drier than usual)</h3>');
      const box = el.appendChild(document.createElement('div'));
      let chart: ChartHandle | null = null;
      requestAnimationFrame(() => (chart = barChart(box, { data: l.spark(), xDomain: [y0, y1], color: DROUGHT_COLOR, height: 120, diverging: true, yFormat: (v) => String(Math.round(50 - v)), tooltip: (d) => `<b>${d.x}</b><br>median gauge at the ${ord(I[d.x][0])} percentile of its record<br>${I[d.x][1]} gauges` })));
      const rows = longGauges.filter((g) => g.to >= y1 - 3).map((g) => {
        const r = yearsOf(g).filter((y) => y > y1 - RECENT);
        return { g, sev: r.filter((y) => g.years[y][2] < SEVERE).length, n: r.length, worst: worstYears(g) };
      }).sort((a, b) => b.sev - a.sev || a.g.name.localeCompare(b.g.name));
      const expected = Math.round(RECENT / 10);
      el.insertAdjacentHTML('beforeend', `
        <div class="ramp" style="background:${rampCSS((t) => rankColor(t * 100))}"></div>
        <div class="ramp-labels"><span>lowest</span><span>10th</span><span>normal</span><span>75th</span><span>highest</span></div>
        <div class="legend"><span><i class="sw" style="background:${rankColor(0)}"></i>lowest on record</span><span><i class="sw" style="background:${rankColor(5)}"></i>driest 10%</span><span><i class="sw" style="background:${rankColor(18)}"></i>below normal (10–25th)</span><span><i class="sw" style="background:${rankColor(50)}"></i>normal</span><span><i class="sw" style="background:${rankColor(90)}"></i>above normal</span></div>
        <div class="callout" style="--c:${DROUGHT_COLOR}">The driest summers on the record, by the island median (years with ${ISLAND_EVENT_MIN}+ gauges): ${driest.map((y) => `<b>${y}</b> (${ord(I[y][0])})`).join(', ')}. ${driest.filter((y) => y >= y1 - 14).length} of those ${driest.length} came in the last 15 years.</div>
        <h3>What “drought” means here</h3>
        <p>BC rates drought from 0 (normal) to 5 (adverse impacts almost certain) for each basin, mostly from how low the rivers run against their normal. Those ratings are published only for viewing (2015 on), not as open data, so this layer measures the same thing straight from the gauges: each summer’s lowest 7-day flow, ranked against that river’s whole record. Summers like the driest tenth here are when BC raises its levels, and when water restrictions, fishing closures and orders to cut water use tend to follow.</p>
        <h3>Why it matters for a home</h3>
        <ul class="howto">
          <li><b>A rural parcel on a well.</b> Most island wells draw from the same rain-fed ground water that keeps creeks running, and shallow wells and those in small bedrock aquifers (the Gulf Islands, the east-coast lowlands) are the first to falter late in a dry summer. Check the wells around a parcel and their yields. <button class="tr-fall" data-layer="wells" type="button" style="margin-top:6px">💧 Well water ›</button></li>
          <li><b>A town on a small reservoir or creek.</b> Towns drawing from a big lake or a dammed river (the Comox Valley’s Comox Lake, Campbell River’s BC Hydro lakes, Greater Victoria’s Sooke Lake) ride out a dry summer far better than those on a small creek or shallow lake, which go to watering restrictions first. Rivers held up by storage show here as a usual summer low well above the rain-fed creeks’ 1–3% of their average flow.</li>
          <li><b>The snowpack.</b> A thin 1 April snowpack (2015) means less melt to carry rivers into July, so a low summer often starts in the mountains in spring. <button class="tr-fall" data-layer="snow" type="button" style="margin-top:6px">❄ Snowpack ›</button></li>
        </ul>
        <h3>Gauges still measured: driest-10% summers in the last ${RECENT}</h3>
        <p class="note">By chance a gauge would have about ${expected} in ${RECENT}. More than that is a run of dry summers; fewer can mean new storage (a dam or weir added) as much as wetter weather.</p>
        <ol class="rank-list">${rows.map((r, i) => `<li data-g="${esc(r.g.id)}" style="cursor:pointer"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.g.name)}</span><br><span class="rd">since ${r.g.from} · driest ${r.worst.join(', ')}${r.g.rhbn ? ' · natural basin' : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.sev / Math.max(1, rows[0]?.sev ?? 1)) * 100)}%;background:${DROUGHT_COLOR}"></i></div><div class="bar-v">${r.sev}/${r.n}</div></span></li>`).join('')}</ol>
        <p class="note">${gauges.length} gauges with ${D.minSummers}+ complete summers (June–October with 95% of days measured) are shown; the island median uses the ${longGauges.length} with ${D.townMinSummers}+. Different gauges ran in different decades, so early years rest on a handful of rivers. Many island rivers are regulated by dams, weirs or diversions (the Campbell, Puntledge, Cowichan, Stamp/Somass, Englishman and others), so their lows partly reflect how the water was managed. HYDAT, the national archive, is published once a year: the record ends in ${y1}, with fewer gauges in the final year. No water-restriction stages are shown: towns publish them only as web pages, not open data.</p>
        <div class="source">Source: ${esc(D.source)}.</div>`);
      el.querySelectorAll<HTMLElement>('[data-layer]').forEach((b) => b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:layer', { detail: b.dataset.layer }))));
      el.querySelectorAll<HTMLElement>('[data-g]').forEach((li) => li.addEventListener('click', () => {
        const g = gauges.find((x) => x.id === li.dataset.g);
        if (g) window.dispatchEvent(new CustomEvent('atlas:event', { detail: describeGauge(g) }));
      }));
      return {
        update({ time }) {
          const at = pick(time);
          const now = gauges.map((g) => rankAt(g, at)).filter((p): p is number => p != null);
          const med = now.length ? d3.median(now)! : null;
          set(0, med != null ? `${ord(med)}` : '–', med != null ? `percentile, median gauge · ${at.label}` : `no gauges · ${at.label}`);
          set(1, String(now.filter((p) => p < SEVERE).length), `of ${now.length} gauges in their driest 10%`);
          set(2, String(now.filter((p) => p === 0).length), at.mi >= 0 ? `at their lowest ${MONTHS[at.mi]} on record` : 'at their lowest summer on record');
          set(3, driest[0] != null ? String(driest[0]) : '–', driest[0] != null ? `driest summer (${ord(I[driest[0]][0])})` : 'driest summer');
          chart?.setPlayhead(time);
        },
      };
    },
    describe(info: PickingInfo) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('drought')) return null;
      return o.g ? describeGauge(o.g) : null;
    },
    tooltip(info: PickingInfo) {
      const o: any = info.object;
      if (!o?.g || !info.layer?.id.startsWith('drought')) return null;
      const g: DroughtGauge = o.g;
      const p: number = o.p;
      return `<b>${esc(g.name)}</b><br><span class="tk">${info.layer.id === 'drought-basins-base' ? 'Basin above gauge' : 'River gauge'}</span> <span class="tv">${esc(g.id)}${g.area ? ` · ${fmt.int(Math.round(g.area))} km²` : ''}</span><br><span class="tk">Now</span> <span class="tv">${rankWord(p)} (${ord(p)} percentile)</span><br><span class="tk">Usual summer low</span> <span class="tv">${flow(g.normalLow)}</span><br><span class="tk">Record</span> <span class="tv">${g.from}–${g.to}, ${g.n} summers</span>`;
    },
  };
  return l;
}
