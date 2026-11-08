// SNOWPACK: the BC River Forecast Centre's snow courses and snow pillows on the islands. Each station is a column as
// tall as its 1 April snow water equivalent, coloured by how that compares with the station's own normal; the timeline
// plays the years from the first surveys in the 1950s. The sparkline is the island's median "% of normal".
// Data from scripts/snow.mjs (public/data/snow.json).
import * as d3 from 'd3';
import { ColumnLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, SnowStation, fmt, km } from './data';
import { barChart, rampCSS, ChartHandle } from './charts';
import type { AtlasEvent, AtlasLayer, TimedEvent } from './layers';
import { esc } from './html';

export const SNOW_COLOR = '#bfe3ff';
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };

/** Share of normal: bare-ground amber through ice-white at normal to deep blue for a big year. */
const pctColor = d3.scaleLinear<string>().domain([0, 0.5, 1, 1.5, 2.5]).range(['#c8553d', '#e9b872', '#eef6ff', '#7cc4ff', '#2f6fd6']).clamp(true);
/** A station without a normal (too short a record) is drawn plain. */
const PLAIN = '#9fb3c8';
/** metres of column per mm of water */
const M_PER_MM = 7;
const MIN_EVENT_N = 5; // island records need this many stations reporting

const pctOf = (s: SnowStation, v: number) => (s.normal && s.normal > 0 ? v / s.normal : null);
const pctTxt = (r: number) => `${Math.round(r * 100)}%`;
const mm = (v: number) => `${fmt.int(Math.round(v))} mm`;
const median = (xs: number[]) => (xs.length ? d3.median(xs)! : null);

export function snowLayer(data: Data): AtlasLayer {
  const S = data.snow;
  const stations = S?.stations ?? [];
  const minN = S?.minNormalMm ?? 100;
  // a pillow on the same spot as a snow course sits a little east of it, so both columns show
  const pos = new Map<SnowStation, [number, number]>();
  for (const s of stations) {
    const twin = s.kind === 'pillow' && stations.some((c) => c.kind === 'course' && km(c.lon, c.lat, s.lon, s.lat) < 1);
    pos.set(s, [s.lon + (twin ? 0.018 : 0), s.lat]);
  }
  const I = S?.island ?? {};
  const ys = Object.keys(I).map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 1955, y1 = ys.at(-1) ?? 2026;
  const counted = ys.filter((y) => I[y][1] >= MIN_EVENT_N);
  const lows = [...counted].sort((a, b) => I[a][0] - I[b][0]).slice(0, 3);
  const highs = [...counted].sort((a, b) => I[b][0] - I[a][0]).slice(0, 2);
  // long-record stations compared with themselves: the first 30 years of surveys against the last 30
  const early: [number, number] = [y0, y0 + 29], late: [number, number] = [y1 - 29, y1];
  const inWin = (s: SnowStation, [a, b]: [number, number]) => Object.entries(s.swe).filter(([y]) => +y >= a && +y <= b).map(([, v]) => v);
  const longRun = stations
    .filter((s) => s.normal && s.normal >= minN && inWin(s, early).length >= 15 && inWin(s, late).length >= 15)
    .map((s) => ({ s, a: median(inWin(s, early))!, b: median(inWin(s, late))! }));

  // 1 April is one reading a year, so a station holds it until the next (no blending between years)
  const live = (time: number) =>
    stations
      .map((s) => ({ s, v: s.swe[Math.floor(time)] ?? null }))
      .filter((d): d is { s: SnowStation; v: number } => d.v != null)
      .map((d) => ({ ...d, r: pctOf(d.s, d.v) }));

  const yearSentence = (y: number) => {
    const rows = stations.filter((s) => s.swe[y] != null && s.normal && s.normal >= minN);
    return rows.sort((a, b) => b.n - a.n).slice(0, 4).map((s) => `${s.name} ${mm(s.swe[y])} (${pctTxt(s.swe[y] / s.normal!)} of normal)`).join('; ');
  };
  const islandEvent = (y: number, low: boolean): TimedEvent => {
    const [r, n] = I[y];
    const snowDrought = y === 2015;
    return {
      t: y + 0.25, layer: 'snow', kind: 'Snowpack',
      title: snowDrought ? '2015: the snow drought' : `${y}: ${low ? 'one of the thinnest' : 'one of the deepest'} snowpacks on record`,
      body: `On 1 April ${y} the median island snow station held ${pctTxt(r)} of its normal snow water equivalent (${n} stations reporting).`,
      lon: -125.1, lat: 49.5, zoom: 7.6,
      stats: [{ v: pctTxt(r), l: 'of normal, island median' }, { v: String(n), l: 'stations measured' }],
      sections: [
        { title: 'At the stations', text: `${yearSentence(y)}.` },
        ...(snowDrought ? [{ title: 'Why it matters', text: 'A warm winter brought the usual precipitation as rain instead of snow, so by April most courses were bare. With little melt to come, rivers and reservoirs went into a dry summer low, and the Pacific Northwest called it a "snow drought": not a lack of precipitation, a lack of snow.' }] : []),
      ],
      sources: [{ label: 'BC River Forecast Centre: snow survey data', url: 'https://www2.gov.bc.ca/gov/content/environment/air-land-water/water/drought-flooding-dikes-dams/river-forecast-centre/snow-survey-water-supply-bulletin' }],
    };
  };

  const l: AtlasLayer = {
    id: 'snow',
    name: 'Snowpack',
    icon: '❄',
    color: SNOW_COLOR,
    range: [y0, y1 + 0.99],
    available: !!S,
    unavailable: 'Run <code>npm run data snow</code> to build <code>public/data/snow.json</code>.',
    build({ time, focusedId }) {
      const y = Math.floor(time);
      const cols = live(time);
      const layers: Layer[] = [
        new ScatterplotLayer<SnowStation>({
          id: 'snow-base',
          data: stations,
          getPosition: (s) => pos.get(s)!,
          getRadius: 900,
          radiusMinPixels: 2.5,
          getFillColor: (s) => (s.swe[y] != null ? [191, 227, 255, 120] : [191, 227, 255, 45]),
          stroked: true,
          lineWidthMinPixels: 1,
          getLineColor: (s) => (s.kind === 'pillow' ? [191, 227, 255, 200] : [191, 227, 255, 90]),
          pickable: true,
          updateTriggers: { getFillColor: y },
          parameters: NO_DEPTH,
        }),
        new ColumnLayer<(typeof cols)[number]>({
          id: 'snow-cols',
          data: cols,
          getPosition: (d) => pos.get(d.s)!,
          radius: 1100,
          diskResolution: 6,
          angle: 30,
          extruded: true,
          getElevation: (d) => Math.max(60, d.v * M_PER_MM),
          getFillColor: (d) => rgb(d.r != null && d.s.normal! >= minN ? pctColor(d.r) : PLAIN, 240),
          material: { ambient: 0.65, diffuse: 0.55, shininess: 30 },
          pickable: true,
          updateTriggers: { getElevation: y, getFillColor: y },
        }),
      ];
      if (focusedId === 'snow')
        layers.push(
          new TextLayer<(typeof cols)[number]>({
            id: 'snow-labels',
            data: cols,
            getPosition: (d) => [...pos.get(d.s)!, Math.max(60, d.v * M_PER_MM) + 1800] as [number, number, number],
            getText: (d) => (d.r != null && d.s.normal! >= minN ? pctTxt(d.r) : mm(d.v)),
            getSize: 11,
            getColor: [235, 244, 255, 230],
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 220],
            fontSettings: { sdf: true },
            billboard: true,
            updateTriggers: { getText: y, getPosition: y },
            parameters: NO_DEPTH,
          } as any),
        );
      return layers;
    },
    spark: () => ys.map((x) => ({ x, y: I[x][0], color: pctColor(I[x][0]) })),
    events: () => [...lows.map((y) => islandEvent(y, true)), ...highs.map((y) => islandEvent(y, false))].sort((a, b) => a.t - b.t),
    panel(el) {
      el.innerHTML = `<div class="kicker" style="--c:${SNOW_COLOR}">Snow surveys · ${y0} → ${y1}</div>
        <h2>Snowpack on the mountains</h2>
        <p class="lede">Each column is a snow station in the island's mountains, as tall as the water held in its snow on 1 April, about when the pack peaks. Colour compares that with the station's own normal: white is a normal year, amber a thin one, blue a deep one. Press play to run the years from the first snow courses in the 1950s.</p>`;
      if (!S) { el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`); return { update() {} }; }
      const hero = el.appendChild(document.createElement('div'));
      hero.className = 'hero';
      hero.innerHTML = Array.from({ length: 4 }, () => '<div class="stat"><div class="v">–</div><div class="l"></div></div>').join('');
      const cells = [...hero.querySelectorAll('.stat')].map((s) => ({ v: s.querySelector('.v')!, l: s.querySelector('.l')! }));
      const set = (i: number, v: string, lab: string) => { if (cells[i].v.textContent !== v) cells[i].v.textContent = v; if (cells[i].l.textContent !== lab) cells[i].l.textContent = lab; };
      el.insertAdjacentHTML('beforeend', '<h3>1 April snowpack, island median (% of each station’s normal)</h3>');
      const box = el.appendChild(document.createElement('div'));
      let chart: ChartHandle | null = null;
      requestAnimationFrame(() => (chart = barChart(box, { data: l.spark(), xDomain: [y0, y1], color: SNOW_COLOR, height: 120, yFormat: (v) => pctTxt(v), tooltip: (d) => `<b>${d.x}</b><br>${pctTxt(d.y)} of normal<br>${I[d.x][1]} stations` })));
      const trend = longRun.length
        ? `<div class="callout" style="--c:${SNOW_COLOR}">Stations measured in both the first and last 30 years of the record, median 1 April water ${early[0]}–${early[1]} against ${late[0]}–${late[1]}: ${longRun.map((d) => `${esc(d.s.name)} <b>${mm(d.a)} → ${mm(d.b)}</b> (${d.b >= d.a ? '+' : '−'}${Math.round(Math.abs(d.b / d.a - 1) * 100)}%)`).join('; ')}. Years go up and down a lot; ${lows.filter((y) => y >= late[0]).length} of the 3 thinnest years on record came in the last 30.</div>`
        : '';
      const list = [...stations].sort((a, b) => b.n - a.n);
      el.insertAdjacentHTML('beforeend', `
        <div class="ramp" style="background:${rampCSS((t) => pctColor(t * 2.5))}"></div>
        <div class="ramp-labels"><span>bare</span><span>50%</span><span>normal</span><span>150%</span><span>250%+</span></div>
        ${trend}
        <h3>What the snowpack means here</h3>
        <p>Island winters are mild and wet, and low down most winter precipitation falls as rain (the Elk River course, at 270 m, is usually bare by 1 April), so the snowpack is a high-country thing, on the Forbidden Plateau and Strathcona, Mount Arrowsmith and the hills behind Nanaimo and the Cowichan Valley. It matters to a home buyer in three ways.</p>
        <ul class="howto">
          <li><b>Ski season.</b> Mount Washington's runs rise from the same high country as the Forbidden Plateau course; a thin 1 April pack there means a short season.</li>
          <li><b>Summer rivers.</b> Melt from April to June keeps rivers and lakes up into early summer. A thin pack means an earlier, lower, warmer late-summer river, hard on salmon and on anyone who draws water from a creek.</li>
          <li><b>Town water.</b> Some supplies start high in snow country: Comox Lake (Comox Valley), BC Hydro's Campbell River reservoirs (Campbell River; BC Hydro runs the Wolf River pillow upstream), Jump Lake and the South Nanaimo River (Nanaimo; the Jump Creek pillow sits above them) and Sooke Lake (Greater Victoria; the regional district runs the Survey Mountain pillow above it). They are mostly rain-fed, but snowmelt is what tops them up as the dry season starts. Homes on wells are recharged mainly by winter rain, not snow.</li>
        </ul>
        <h3>Stations (${stations.length})</h3>
        <div class="legend" style="display:grid;gap:4px">${list.map((s) => `<span><b>${esc(s.name)}</b> <span class="tk">${s.kind === 'course' ? 'snow course' : 'snow pillow'} · ${fmt.int(s.elev)} m · ${s.from}–${s.to}${s.normal ? ` · normal ${mm(s.normal)}` : ''}</span></span>`).join('')}</div>
        <p class="note">Coverage is thin and uneven: a few dozen stations over 70 years, most of them retired, and different ones in different decades. That is why each station is compared with its own normal (median 1 April water, ${S.normalYears[0]}–${S.normalYears[1]} where it has 15 of those years, otherwise its whole record) and the island figure is the median of those shares, not an average depth. Stations whose normal is under ${minN} mm (low sites that are often bare) and those with under 10 years have no normal and are left out of it; their columns are grey. Snow courses are measured by hand within a few days of 1 April; pillows weigh the snow automatically. Some surveys carry a "problem" or "early/late" code, shown in a station's details.</p>
        <div class="source">Source: ${esc(S.source)}</div>`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const iy = I[y];
          set(0, iy ? pctTxt(iy[0]) : '–', iy ? `of normal on 1 April ${y}` : `no island figure for ${y}`);
          const n = stations.filter((s) => s.swe[y] != null).length;
          set(1, String(n), `stations measured in ${y}`);
          set(2, lows[0] != null ? String(lows[0]) : '–', lows[0] != null ? `thinnest year (${pctTxt(I[lows[0]][0])})` : 'thinnest year');
          set(3, highs[0] != null ? String(highs[0]) : '–', highs[0] != null ? `deepest year (${pctTxt(I[highs[0]][0])})` : 'deepest year');
          chart?.setPlayhead(time);
        },
      };
    },
    describe(info: PickingInfo): AtlasEvent | null {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('snow')) return null;
      const s: SnowStation = o.s ?? o;
      const yrs = Object.keys(s.swe).map(Number).sort((a, b) => a - b);
      if (!yrs.length) return null;
      const hi = yrs.reduce((a, y) => (s.swe[y] > s.swe[a] ? y : a), yrs[0]);
      const lo = yrs.reduce((a, y) => (s.swe[y] < s.swe[a] ? y : a), yrs[0]);
      const last = yrs.at(-1)!;
      const useR = !!s.normal && s.normal >= minN;
      const flagged = Object.entries(s.flag ?? {});
      return {
        layer: 'snow', kind: s.kind === 'course' ? 'Snow course' : 'Snow pillow', lon: s.lon, lat: s.lat, zoom: 10,
        title: s.name,
        body: `${s.kind === 'course' ? 'A manual snow course: surveyors measure depth and water content around 1 April.' : `An automated snow pillow weighing the snow${s.operator ? `, run by ${s.operator}` : ''}.`} Station ${s.id}, ${fmt.int(s.elev)} m up, ${s.active ? 'still measured' : 'no longer measured'}; ${yrs.length} years of 1 April readings (${yrs[0]}–${last}).`,
        stats: [
          ...(s.normal != null ? [{ v: mm(s.normal), l: `normal 1 April water (${s.normalPeriod})` }] : [{ v: '–', l: 'too short a record for a normal' }]),
          { v: mm(s.swe[last]), l: `${last}${useR ? `, ${pctTxt(s.swe[last] / s.normal!)} of normal` : ''}` },
          { v: mm(s.swe[hi]), l: `deepest, ${hi}` },
          { v: mm(s.swe[lo]), l: `thinnest, ${lo}` },
          ...(s.depth[last] != null ? [{ v: `${fmt.int(s.depth[last])} cm`, l: `snow depth, ${last}` }] : []),
        ],
        sections: flagged.length ? [{ title: 'Survey notes', text: `Readings with a survey code: ${flagged.map(([y, c]) => `${y} (${c})`).join(', ')}. These are the River Forecast Centre's own survey codes: "problem" means the surveyors flagged something about that measurement, so read it with some caution; "early/late" means it was taken well before or after 1 April.` }] : undefined,
        detail: (el) => {
          el.insertAdjacentHTML('beforeend', `<h3>1 April snow water equivalent (mm)</h3>`);
          const box = el.appendChild(document.createElement('div'));
          box.className = 'ev-chart';
          const pts = yrs.map((y) => ({ x: y, y: s.swe[y], color: useR ? pctColor(s.swe[y] / s.normal!) : PLAIN }));
          requestAnimationFrame(() => barChart(box, { data: pts, xDomain: [yrs[0], last], color: SNOW_COLOR, height: 120, yFormat: (v) => fmt.int(v), tooltip: (d) => `<b>${d.x}</b> · ${mm(d.y)}${useR ? ` · ${pctTxt(d.y / s.normal!)} of normal` : ''}${s.depth[d.x] != null ? `<br>${fmt.int(s.depth[d.x])} cm deep` : ''}${s.date?.[d.x] ? `<br>measured ${s.date[d.x]}` : ''}` }));
        },
        sources: [{ label: 'BC River Forecast Centre: snow survey data', url: 'https://www2.gov.bc.ca/gov/content/environment/air-land-water/water/drought-flooding-dikes-dams/river-forecast-centre/snow-survey-water-supply-bulletin' }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('snow')) return null;
      const s: SnowStation = o.s ?? o;
      const v: number | undefined = o.v;
      const useR = !!s.normal && s.normal >= minN;
      return `<b>${esc(s.name)}</b><br><span class="tk">${s.kind === 'course' ? 'Snow course' : 'Snow pillow'}</span> <span class="tv">${esc(s.id)} · ${fmt.int(s.elev)} m</span>${v != null ? `<br><span class="tk">1 April water</span> <span class="tv">${mm(v)}${useR ? ` (${pctTxt(v / s.normal!)} of normal)` : ''}</span>` : ''}${s.normal != null ? `<br><span class="tk">Normal</span> <span class="tv">${mm(s.normal)} (${esc(s.normalPeriod ?? '')})</span>` : ''}<br><span class="tk">Record</span> <span class="tv">${s.from}–${s.to}, ${s.n} years</span>`;
    },
  };
  return l;
}
