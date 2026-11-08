// WINDSTORMS: the island's big blows from Environment Canada's daily peak gusts. Each gust-measuring station is a column
// as tall as that year's storm days (a gust of 90 km/h or more, the coast's wind-warning line), coloured by the year's
// strongest gust; a ring flares at a station on each storm day as the timeline plays through it. The sparkline is storm
// days per reporting station. Lighthouses and other exposed points are drawn hollow: they see far more wind than a
// town. Data from scripts/wind.mjs (public/data/wind.json).
import * as d3 from 'd3';
import { ColumnLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Wind, WindStation, fmt } from './data';
import { barChart, rampCSS, ChartHandle } from './charts';
import type { AtlasEvent, AtlasLayer, TimedEvent } from './layers';
import type { TownMetrics } from './metrics';
import { esc } from './html';

export const WIND_COLOR = '#7dd3fc';
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };

/** The year's top gust, km/h: breezy slate through ice blue to storm yellow, hurricane-force magenta. */
const gustColor = d3.scaleLinear<string>().domain([60, 90, 110, 130, 150]).range(['#64748b', '#7dd3fc', '#fde047', '#fb923c', '#f0abfc']).clamp(true);
/** column height: square-root, so a lighthouse with 60 storm days doesn't dwarf a town station with 3 */
const colM = (days: number) => 7000 * Math.sqrt(days);
const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
const fromDir = (tens: number | null) => (tens == null || tens <= 0 ? null : COMPASS[Math.round(((tens * 10) % 360) / 22.5) % 16]);
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateTxt = (d: string) => `${+d.slice(8, 10)} ${MONTH[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
/** YYYY-MM-DD -> timeline years (mid-day). */
const tOf = (d: string) => {
  const y = +d.slice(0, 4), start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (Date.UTC(y, +d.slice(5, 7) - 1, +d.slice(8, 10)) + 43200000 - start) / (end - start);
};

/**
 * Storms people on the coast still name. Only the wording is added here: whether one appears, and its numbers, come
 * from the stations' own records.
 */
const NAMED: Record<string, { title: string; text: string; url: string; label: string }> = {
  '1962-10-12': { title: 'the Columbus Day storm', text: 'The remains of Typhoon Freda, the strongest windstorm in the Pacific Northwest’s record. It tore through Oregon and Washington and reached the south of the island that evening.', label: 'Wikipedia: Columbus Day storm of 1962', url: 'https://en.wikipedia.org/wiki/Columbus_Day_storm_of_1962' },
  '2006-12-15': { title: 'the Hanukkah Eve storm', text: 'The storm that flattened large stretches of Vancouver’s Stanley Park. Many island stations missed it: their records for the day are blank.', label: 'Wikipedia: Hanukkah Eve windstorm of 2006', url: 'https://en.wikipedia.org/wiki/Hanukkah_Eve_windstorm_of_2006' },
  '2018-12-20': { title: 'the December 2018 windstorm', text: 'BC Hydro called it the most damaging storm in its history: about 750,000 customers lost power, many on the south island and the Gulf Islands for days.', label: 'Wikipedia: December 2018 British Columbia windstorm', url: 'https://en.wikipedia.org/wiki/2018_British_Columbia_windstorm' },
};

export function windLayer(data: Data): AtlasLayer {
  const W = data.wind;
  const stations = W?.stations ?? [];
  const I = W?.island ?? {};
  const ys = Object.keys(I).map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 1955, y1 = W?.lastYear ?? 2025;
  const storm = W?.storm ?? 90, gale = W?.gale ?? 70;
  // every storm day at every station, on the timeline
  const flares = stations.flatMap((s) => s.big.map(([d, g, dir]) => ({ s, d, t: tOf(d), g, dir }))).sort((a, b) => a.t - b.t);
  const counts = (s: WindStation, y: number) => (s.years[y]?.[0] === 1 ? s.years[y] : null);
  // The island figure is storm days per sheltered (town and airport) station: lighthouses joined and left the network
  // over the decades and would swing an all-station average. "Stormiest" is taken from 1995 on, once 7+ stations reported.
  const MODERN = 1995;
  const sh = (y: number) => I[y][2];
  const stormiest = ys.filter((y) => y >= MODERN).sort((a, b) => sh(b) - sh(a))[0];
  const record = stations.reduce<WindStation | null>((a, s) => (!a || s.record[0] > a.record[0] ? s : a), null);
  // the biggest storm days, a week apart at least, plus the named ones the stations caught
  // (the network grew from 4–6 stations to 15+, so take the days with the most stations at storm force and the days
  // with the largest share of the few that were reporting)
  const picked: Wind['storms'] = [];
  const take = (list: Wind['storms'], n: number) => {
    let k = 0;
    for (const s of list) {
      if (k >= n) break;
      if (picked.some((p) => Math.abs(tOf(p.d) - tOf(s.d)) < 7 / 365)) continue;
      picked.push(s); k++;
    }
  };
  const all = W?.storms ?? [];
  take(all, 5);
  take([...all].sort((a, b) => b.storm / b.rep - a.storm / a.rep || b.at[0][1] - a.at[0][1]), 3);
  for (const s of all) if (NAMED[s.d] && !picked.includes(s)) picked.push(s);

  const stormEvent = (s: Wind['storms'][number]): TimedEvent => {
    const [k, g, dir] = s.at[0];
    const top = stations[k];
    const named = NAMED[s.d];
    const lon = d3.mean(s.at.filter((a) => a[1] >= storm), (a) => stations[a[0]].lon) ?? top.lon;
    const lat = d3.mean(s.at.filter((a) => a[1] >= storm), (a) => stations[a[0]].lat) ?? top.lat;
    return {
      t: tOf(s.d), layer: 'wind', kind: 'Windstorm',
      title: `${dateTxt(s.d)}: ${named ? named.title : 'a windstorm across the island'}`,
      body: `${s.storm} of the ${s.rep} island stations measuring gusts that year reached storm force (${storm} km/h or more). The strongest gust was ${g} km/h at ${top.name}${fromDir(dir) ? `, from the ${fromDir(dir)}` : ''}.`,
      lon, lat, zoom: 7.4,
      stats: [{ v: `${g} km/h`, l: `peak gust, ${top.name}` }, { v: `${s.storm} of ${s.rep}`, l: `stations at ${storm}+ km/h` }],
      sections: [
        ...(named ? [{ title: 'What it was', text: named.text }] : []),
        { title: 'At the stations', text: `${s.at.map(([j, gg, dd]) => `${stations[j].name} ${gg} km/h${fromDir(dd) ? ` (${fromDir(dd)})` : ''}`).join('; ')}.` },
      ],
      sources: [
        ...(named ? [{ label: named.label, url: named.url }] : []),
        { label: 'Environment and Climate Change Canada: historical climate data', url: 'https://climate.weather.gc.ca/' },
      ],
    };
  };

  const l: AtlasLayer = {
    id: 'wind',
    name: 'Windstorms',
    icon: '🌀',
    color: WIND_COLOR,
    range: [y0, y1 + 0.99],
    available: !!W,
    unavailable: 'Run <code>npm run data wind</code> to build <code>public/data/wind.json</code>.',
    build({ time, focusedId, speed }) {
      const y = Math.floor(time);
      const live = stations.map((s) => ({ s, c: counts(s, y) })).filter((d) => d.c && d.c[1] > 0) as { s: WindStation; c: NonNullable<ReturnType<typeof counts>> }[];
      // a storm day glows for a few weeks of timeline (longer at higher speeds), fading as it goes
      const win = Math.max(0.06, speed * 0.25);
      const hot = flares.filter((f) => f.t <= time && f.t > time - win);
      const layers: Layer[] = [
        new ScatterplotLayer<WindStation>({
          id: 'wind-base',
          data: stations,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: 1500,
          radiusMinPixels: 3,
          filled: true,
          getFillColor: (s) => (s.exposed ? [125, 211, 252, 0] : counts(s, y) ? [125, 211, 252, 150] : [125, 211, 252, 40]),
          stroked: true,
          lineWidthMinPixels: 1.4,
          getLineColor: (s) => (counts(s, y) ? [125, 211, 252, 230] : [125, 211, 252, 70]),
          pickable: true,
          updateTriggers: { getFillColor: y, getLineColor: y },
          parameters: NO_DEPTH,
        }),
        new ColumnLayer<(typeof live)[number]>({
          id: 'wind-cols',
          data: live,
          getPosition: (d) => [d.s.lon, d.s.lat],
          radius: 1400,
          diskResolution: 12,
          extruded: true,
          getElevation: (d) => colM(d.c[1]),
          getFillColor: (d) => rgb(gustColor(d.c[3]), d.s.exposed ? 150 : 235),
          material: { ambient: 0.6, diffuse: 0.6, shininess: 40 },
          pickable: true,
          updateTriggers: { getElevation: y, getFillColor: y },
        }),
        new ScatterplotLayer<(typeof hot)[number]>({
          id: 'wind-flare',
          data: hot,
          getPosition: (f) => [f.s.lon, f.s.lat],
          getRadius: (f) => 3000 + ((time - f.t) / win) * (f.g - 60) * 450,
          filled: false,
          stroked: true,
          lineWidthMinPixels: 2,
          getLineColor: (f) => rgb(gustColor(f.g), 255 * (1 - (time - f.t) / win)),
          updateTriggers: { getRadius: time, getLineColor: time },
          parameters: NO_DEPTH,
        }),
      ];
      if (focusedId === 'wind')
        layers.push(
          new TextLayer<(typeof live)[number]>({
            id: 'wind-labels',
            data: live,
            getPosition: (d) => [d.s.lon, d.s.lat, colM(d.c[1]) + 2200] as [number, number, number],
            getText: (d) => `${d.c[1]}`,
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
    spark: () => ys.map((x) => ({ x, y: sh(x), color: gustColor(60 + Math.min(1, sh(x) / 6) * 70) })),
    events: () => picked.map(stormEvent).sort((a, b) => a.t - b.t),
    panel(el) {
      el.innerHTML = `<div class="kicker" style="--c:${WIND_COLOR}">Peak gusts · ${y0} → ${y1}</div>
        <h2>Windstorms</h2>
        <p class="lede">Each column is a weather station that measures gusts, rising with that year's storm days: days with a gust of ${storm} km/h or more, when Environment Canada warns of wind on this coast and trees and power lines start coming down. Colour is the year's strongest gust. Hollow rings are lighthouses and exposed points, which catch far more wind than a town. Press play and a ring flares on every storm day.</p>`;
      if (!W) { el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`); return { update() {} }; }
      const hero = el.appendChild(document.createElement('div'));
      hero.className = 'hero';
      hero.innerHTML = Array.from({ length: 4 }, () => '<div class="stat"><div class="v">–</div><div class="l"></div></div>').join('');
      const cells = [...hero.querySelectorAll('.stat')].map((s) => ({ v: s.querySelector('.v')!, l: s.querySelector('.l')! }));
      const set = (i: number, v: string, lab: string) => { if (cells[i].v.textContent !== v) cells[i].v.textContent = v; if (cells[i].l.textContent !== lab) cells[i].l.textContent = lab; };
      el.insertAdjacentHTML('beforeend', `<h3>Storm days per sheltered station, each year</h3>`);
      const box = el.appendChild(document.createElement('div'));
      let chart: ChartHandle | null = null;
      requestAnimationFrame(() => (chart = barChart(box, { data: l.spark(), xDomain: [y0, y1], color: WIND_COLOR, height: 120, yFormat: (v) => v.toFixed(1), tooltip: (d) => `<b>${d.x}</b><br>${sh(d.x).toFixed(1)} storm days per sheltered station<br>${I[d.x][0].toFixed(1)} counting the exposed ones too<br>${I[d.x][1]} stations reporting` })));
      // the same sheltered stations compared with themselves: their first 20 counted years against their last 20
      const longRun = stations.filter((s) => !s.exposed).map((s) => {
        const yrs = Object.keys(s.years).map(Number).filter((y) => s.years[y][0] === 1).sort((a, b) => a - b);
        if (yrs.length < 45) return null;
        const avg = (a: number[]) => d3.mean(a, (y) => s.years[y][1])!;
        return { s, a: avg(yrs.slice(0, 20)), b: avg(yrs.slice(-20)), ra: [yrs[0], yrs[19]], rb: [yrs.at(-20)!, yrs.at(-1)!] };
      }).filter(Boolean) as { s: WindStation; a: number; b: number; ra: number[]; rb: number[] }[];
      const sheltered = stations.filter((s) => !s.exposed), exposed = stations.filter((s) => s.exposed);
      const avgRecent = (s: WindStation) => { const v = Object.entries(s.years).filter(([y, c]) => c[0] === 1 && +y > y1 - 30).map(([, c]) => c[1]); return v.length ? d3.mean(v)! : null; };
      const row = (s: WindStation) => { const a = avgRecent(s); return `<span><b>${esc(s.name)}</b> <span class="tk">${s.exposed ? 'exposed · ' : ''}${s.from}–${s.to} · ${a == null ? '' : `${a.toFixed(1)} storm days a year lately · `}record ${s.record[0]} km/h, ${dateTxt(s.record[1])}</span></span>`; };
      el.insertAdjacentHTML('beforeend', `
        <div class="ramp" style="background:${rampCSS((t) => gustColor(60 + t * 90))}"></div>
        <div class="ramp-labels"><span>60</span><span>90</span><span>110</span><span>130</span><span>150 km/h</span></div>
        ${longRun.length ? `<div class="callout" style="--c:${WIND_COLOR}"><b>Not a trend.</b> The long airport records, first 20 years against the last 20: ${longRun.map((d) => `${esc(d.s.name)} <b>${d.a.toFixed(1)} → ${d.b.toFixed(1)}</b> storm days a year (${d.ra[0]}–${d.ra[1]} vs ${d.rb[0]}–${d.rb[1]})`).join('; ')}. Much of that drop through the 1980s and 1990s lines up with new instruments, moved masts and automated gust reporting rather than with the weather alone, and these records are not adjusted for it. Use them to compare places over the same years and to find the big storms, not to say storms have faded.</div>` : ''}
        <h3>What it means for a house</h3>
        <ul class="howto">
          <li><b>Power.</b> Most island outages come from trees on lines in a southeasterly gale. Rural roads on long feeders can be dark for days after a big one: a generator or battery and a wood stove are common for a reason.</li>
          <li><b>Trees.</b> Tall second-growth Douglas-fir and alder near a house, especially on a freshly cleared edge, are the usual damage. An arborist's look before you buy is cheap.</li>
          <li><b>Exposure.</b> Southeast-facing shores and headlands (Victoria's waterfront, the Strait of Georgia side, the open west coast) take the brunt; a sheltered valley a few kilometres inland can see a fraction of it. A station here is a guide to the area, not to a lot.</li>
        </ul>
        <h3>Stations (${sheltered.length} sheltered, ${exposed.length} exposed)</h3>
        <div class="legend" style="display:grid;gap:4px">${[...sheltered, ...exposed].map(row).join('')}</div>
        <p class="note">From each station's daily peak gust. A station-year counts once it has 300 days with a reading, or readings in 11 of 12 months (since 2018 a calm day is left blank rather than written as 0). Stations that moved a little and took a new name (Victoria International's two identifiers, Gonzales Heights and Gonzales climate station, Port Hardy and Tofino airports) are joined into one record. The network has grown from 4–6 stations in the 1960s to 15 or more today, many of them automated lighthouses, which is why the island figure is per sheltered station, not a total. Days with no reading at a station (some big storms knocked instruments out) don't count.</p>
        <div class="source">Source: ${esc(W.source)}</div>`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const iy = I[y];
          set(0, iy ? iy[2].toFixed(1) : '–', iy ? `storm days per sheltered station in ${y}` : `no island figure for ${y}`);
          set(1, iy ? String(iy[1]) : '–', `stations reporting in ${y}`);
          set(2, stormiest != null ? String(stormiest) : '–', stormiest != null ? `stormiest year since ${MODERN} (${sh(stormiest).toFixed(1)} per sheltered station)` : 'stormiest year');
          set(3, record ? `${record.record[0]}` : '–', record ? `km/h record gust, ${record.name}, ${record.record[1].slice(0, 4)}` : 'record gust');
          chart?.setPlayhead(time);
        },
      };
    },
    describe(info: PickingInfo): AtlasEvent | null {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('wind')) return null;
      const s: WindStation = o.s ?? o;
      if (!s.years) return null;
      const yrs = Object.keys(s.years).map(Number).filter((y) => s.years[y][0] === 1).sort((a, b) => a - b);
      const worst = yrs.reduce((a, y) => (s.years[y][1] > s.years[a][1] ? y : a), yrs[0]);
      const recent = yrs.filter((y) => y > y1 - 30);
      const avg = recent.length ? d3.mean(recent, (y) => s.years[y][1])! : null;
      const avgG = recent.length ? d3.mean(recent, (y) => s.years[y][2])! : null;
      return {
        layer: 'wind', kind: s.exposed ? 'Weather station (exposed)' : 'Weather station', lon: s.lon, lat: s.lat, zoom: 9.5,
        title: s.name,
        body: `${s.exposed ? 'A lighthouse or exposed point: it catches the full force of the wind off the water, so it shows what the coast can do rather than what a sheltered house would feel. ' : ''}Daily peak gusts from ${s.from} to ${s.to}, ${yrs.length} counted years (Environment Canada ${s.ids.length > 1 ? `identifiers ${s.ids.join(', ')}` : `identifier ${s.ids[0]}`}).`,
        stats: [
          { v: `${s.record[0]} km/h`, l: `strongest gust, ${dateTxt(s.record[1])}${fromDir(s.record[2]) ? ` from the ${fromDir(s.record[2])}` : ''}` },
          ...(avg != null ? [{ v: avg.toFixed(1), l: `storm days a year (${storm}+ km/h), last ${recent.length} years` }] : []),
          ...(avgG != null ? [{ v: avgG.toFixed(1), l: `gale days a year (${gale}+ km/h)` }] : []),
          ...(worst != null ? [{ v: String(worst), l: `stormiest year, ${s.years[worst][1]} storm days` }] : []),
        ],
        detail: (el) => {
          el.insertAdjacentHTML('beforeend', `<h3>Storm days a year (gusts of ${storm} km/h or more)</h3>`);
          const box = el.appendChild(document.createElement('div'));
          box.className = 'ev-chart';
          const pts = yrs.map((y) => ({ x: y, y: s.years[y][1], color: gustColor(s.years[y][3]) }));
          requestAnimationFrame(() => barChart(box, { data: pts, xDomain: [yrs[0], yrs.at(-1)!], color: WIND_COLOR, height: 120, yFormat: (v) => fmt.int(v), tooltip: (d) => `<b>${d.x}</b> · ${d.y} storm days, ${s.years[d.x][2]} gale days<br>top gust ${s.years[d.x][3]} km/h${s.years[d.x][4] ? ` on ${+s.years[d.x][4]!.slice(3)} ${MONTH[+s.years[d.x][4]!.slice(0, 2) - 1]}` : ''}` }));
        },
        sources: [{ label: 'Environment and Climate Change Canada: historical climate data', url: 'https://climate.weather.gc.ca/' }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('wind')) return null;
      const s: WindStation = o.s ?? o;
      if (!s.years) return null;
      const c: WindStation['years'][string] | undefined = o.c;
      return `<b>${esc(s.name)}</b><br><span class="tk">${s.exposed ? 'Exposed station' : 'Station'}</span> <span class="tv">${s.from}–${s.to}</span>${c ? `<br><span class="tk">Storm days</span> <span class="tv">${c[1]} (${gale}+ km/h: ${c[2]})</span><br><span class="tk">Top gust</span> <span class="tv">${c[3]} km/h</span>` : ''}<br><span class="tk">Record</span> <span class="tv">${s.record[0]} km/h, ${dateTxt(s.record[1])}</span>`;
    },
  };
  return l;
}

/** The Town Report's windstorm row: storm days a year at the nearest sheltered gust record. */
export function windTownRow(t: TownMetrics, metric: (l: string, dot: string, v: string, sub: string) => string) {
  const w = t.wind;
  if (!w) return '';
  return metric(
    'Windstorms', WIND_COLOR,
    `${w.storm.toFixed(1)} days`,
    `a year with gusts of 90 km/h or more (and ${w.gale.toFixed(1)} of 70+) at ${esc(w.name)}, ${w.km < 1 ? 'in town' : `${w.km.toFixed(0)} km away`}${w.exposed ? ' (an exposed station: a sheltered street sees less)' : ''}, last ${w.years} years.<br><button class="tr-fall" data-layer="wind" style="margin-top:6px">🌀 Windstorms ›</button>`,
  );
}
