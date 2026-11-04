// Town Report and Town Finder side panels.
import * as d3 from 'd3';
import { Data, fmt, trailingMedianPrice } from './data';
import { lineChart } from './charts';
import { CRITERIA, TownMetrics, erFerryWait, rankTowns, townMetrics } from './metrics';

const STORE_KEY = 'island-atlas:weights';

export function loadWeights(): Record<string, number> {
  const def = Object.fromEntries(CRITERIA.map((c) => [c.id, c.defaultWeight]));
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (saved && typeof saved === 'object') return { ...def, ...saved };
  } catch { /* storage unavailable */ }
  return def;
}
function saveWeights(w: Record<string, number>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(w)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------------------------

export function renderTownReport(el: HTMLElement, data: Data, key: string, opts: { onClose: () => void; rank?: { pos: number; of: number; score: number } }) {
  const t = townMetrics(data).find((x) => x.muni.key === key);
  if (!t) return;
  const m = t.muni;
  const metric = (label: string, dot: string, v: string, sub: string) =>
    `<div class="metric"><div class="mk"><span class="dot" style="background:${dot}"></span>${label}</div><div class="mv">${v}</div><div class="ms">${sub}</div></div>`;
  const na = '<span style="color:var(--ink-3)">n/a</span>';
  const census = !!data.population?.munis[key]?.census;
  const popSub = census ? `2021 Census${m.areas?.pop ? ` · ${m.areas.pop}` : ''}` : t.popGrowth10y != null ? `${fmt.signed(t.popGrowth10y * 100, 0)}% in 10 yrs (${t.popYear})` : '';
  const priceSub = t.price ? `${t.priceChange5y != null ? `${fmt.signed(t.priceChange5y * 100, 0)}% over 5 yrs` : (t.priceYear ?? '')}${m.areas?.housing ? `<br>${m.areas.housing}` : ''}` : m.island ? 'no open-market sales' : (t.priceYear ?? 'no transfer data');
  const csiSub = t.csi != null ? `index, ${t.csiYear} (lower = safer)${m.areas?.crime ? `<br>${m.areas.crime}` : ''}` : m.island ? 'no island-level police series' : 'no municipal police series';

  el.innerHTML = `
    <button class="close-x" aria-label="Close town report">×</button>
    <div class="kicker" style="--c:#ffffff">${m.island ? 'Island community' : 'Town report'} · ${m.rd} Regional District</div>
    <h2>${m.name}</h2>
    ${m.note ? `<div class="callout" style="--c:#4cc9f0">${m.note}</div>` : ''}
    ${opts.rank ? `<p class="lede">Ranks <b>#${opts.rank.pos} of ${opts.rank.of}</b> in your Town Finder (score ${Math.round(opts.rank.score * 100)}).</p>` : ''}
    <div class="metric-grid">
      ${metric(m.areas?.housing ? 'Est. median sale value' : 'Median sale value', '#b388ff', t.price ? fmt.money(t.price) : na, priceSub)}
      ${metric('Population', '#3ecf8e', t.pop ? fmt.int(t.pop) : na, popSub)}
      ${metric('Aged 65+', '#3ecf8e', t.s65 != null ? fmt.pct(t.s65) : na, census ? 'share of residents, 2021 Census' : 'share of residents')}
      ${metric('Crime Severity', '#ff4d8d', t.csi != null ? t.csi.toFixed(0) : na, csiSub)}
      ${metric('Wildfire starts', '#ff8a3d', fmt.int(t.fires15km), 'within 15 km since 1990')}
      ${metric('Area burned nearby', '#ff8a3d', fmt.ha(t.burnedHa25km), 'mapped within 25 km since 1950')}
      ${metric('Felt-size quakes', '#f9d65c', fmt.int(t.quakes75km), 'M4+ within 75 km since 1970')}
      ${data.seismic ? metric('Shaking hazard', '#e86cff', t.shaking ? `${Math.round(t.shaking.pga2 * 100)}% of g` : na, t.shaking ? 'peak ground shaking with a 2% chance in 50 years (NRCan 2020)' : '') : ''}
      ${metric('Climate', '#f25f5c', t.climate ? `${t.climate.meanTemp.toFixed(1)} °C` : na, t.climate ? `${t.climate.precip ? `${Math.round(t.climate.precip)} mm/yr · ` : ''}${t.climate.name} (${Math.round(t.climate.dist)} km)` : '')}
      ${erMetric(t, data, metric, na)}
      ${smokeMetric(t, data, metric, na)}
      ${ferryMetric(t, metric)}
    </div>
    ${feelsRow(t, data, metric, na)}
    ${futureRow(t, data, metric)}
    ${outdoorsRow(t, data, metric)}
    ${t.climate?.trend != null ? `<div class="callout" style="--c:#f25f5c">Nearest long-term station (${t.climate.name}) has warmed <b>${fmt.signed(t.climate.trend, 2)} °C per decade</b> since 1950.</div>` : ''}
    ${t.river ? `<div class="callout" style="--c:#4cc9f0"><b>${t.river.name}</b> (${t.river.dist.toFixed(0)} km away) reached 1.5× its normal peak in ${Math.round(t.river.floodShare * 100)}% of years; its record was ${t.river.record.ratio.toFixed(1)}× in ${t.river.record.year}.</div>` : ''}
    ${census ? '' : '<h3>Population (dashed = projection)</h3><div id="tr-pop"></div>'}
    ${t.price ? `<h3>Median sale value${m.areas?.housing ? ` · estimated, following ${data.housing?.islands?.[key]?.area ?? 'the rural area'}` : ''}</h3><div id="tr-price"></div>` : ''}
    ${t.csi != null ? '<h3>Crime Severity Index</h3><div id="tr-crime"></div>' : ''}
    <p class="note">Distances are from the town centre. Hazard counts describe history, not a forecast — check official floodplain, tsunami and wildfire-interface maps for any specific property.</p>`;
  el.querySelector('.close-x')!.addEventListener('click', opts.onClose);
  el.querySelectorAll<HTMLElement>('[data-out]').forEach((b) => b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:outdoors', { detail: { kind: b.dataset.out, i: +b.dataset.i! } }))));

  requestAnimationFrame(() => {
    const p = data.population?.munis[key];
    if (p && !census) {
      const fp = p.firstProjection ?? 9999;
      const all = Object.entries(p.pop).map(([y, v]) => ({ x: +y, y: v }));
      lineChart(el.querySelector('#tr-pop')!, {
        height: 110,
        xDomain: [all[0].x, all.at(-1)!.x],
        yZero: false,
        series: [
          { key: 'e', label: 'Estimate', color: '#3ecf8e', values: all.filter((d) => d.x < fp) },
          { key: 'p', label: 'Projection', color: '#3ecf8e', dashed: true, values: all.filter((d) => d.x >= fp - 1) },
        ],
        valueFormat: fmt.int,
      });
    }
    const h = data.housing?.munis[key];
    if (h && t.price) {
      const months = Object.keys(h).sort();
      const vals = months.map((mm) => {
        const tt = +mm.slice(0, 4) + (+mm.slice(5, 7) - 1) / 12;
        return { x: tt, y: trailingMedianPrice(h, tt, 6) };
      }).filter((d) => d.y != null) as { x: number; y: number }[];
      if (vals.length)
        lineChart(el.querySelector('#tr-price')!, { height: 110, xDomain: [vals[0].x, vals.at(-1)!.x], yZero: false, yFormat: (v) => `$${d3.format('~s')(v)}`, valueFormat: fmt.money, series: [{ key: 'p', label: '6-mo median', color: '#b388ff', values: vals }] });
    }
    // the chart box is only there when the series is recent enough for a crime figure
    const c = data.crime?.munis[key]?.csi;
    if (c && el.querySelector('#tr-crime')) {
      const vals = Object.entries(c).map(([y, v]) => ({ x: +y, y: v }));
      const bc = Object.entries(data.crime?.bc?.csi ?? {}).map(([y, v]) => ({ x: +y, y: v }));
      lineChart(el.querySelector('#tr-crime')!, { height: 110, xDomain: [vals[0].x, vals.at(-1)!.x], series: [{ key: 'c', label: m.name, color: '#ff4d8d', values: vals }, { key: 'bc', label: 'BC', color: '#ffffff', dashed: true, width: 1.5, values: bc }] });
    }
  });
}

/** Trails and waterfalls near the town (OpenStreetMap); each named one opens on the Trails layer. */
function outdoorsRow(t: TownMetrics, data: Data, metric: (l: string, dot: string, v: string, sub: string) => string) {
  const o = t.outdoors, T = data.trails;
  if (!o || !T) return '';
  const c = '#34d399';
  const fall = (i: number, d: number) => { const f = T.falls[i]; return `<button class="tr-fall" data-out="fall" data-i="${i}"><span class="tr-drop"></span>${f.name}${f.h ? ` <small>${Math.round(f.h)} m</small>` : ''} <small>· ${d.toFixed(0)} km</small></button>`; };
  const route = (i: number, d: number) => { const r = T.routes[i]; return `<button class="tr-fall tr-rt" data-out="route" data-i="${i}" style="--c:${['', '#6ee7b7', '#fcd34d', '#fb7185'][r.level]}"><span class="tr-lv"></span>${r.name} <small>${r.km} km · ${d < 1 ? 'in town' : `${d.toFixed(0)} km`}</small></button>`; };
  return `<h3>Trails &amp; waterfalls nearby</h3>
    <div class="metric-grid">
      ${metric('Footpaths', c, `${o.km10.toLocaleString('en-CA')} km`, 'of mapped trail and path within 10 km')}
      ${metric('Waterfalls', '#8be3ff', `${o.falls30}`, `within 30 km · ${o.named30} named`)}
    </div>
    ${o.routes.length ? `<div class="tr-falls" style="margin-top:8px">${o.routes.slice(0, 5).map(([i, d]) => route(i, d)).join('')}</div>` : ''}
    ${o.falls.length ? `<div class="tr-falls" style="margin-top:6px">${o.falls.map(([i, d]) => fall(i, d)).join('')}</div>` : ''}`;
}

/** The ferry link for an island (or Alert Bay); towns on Vancouver Island show nothing. */
function ferryMetric(t: TownMetrics, metric: (l: string, dot: string, v: string, sub: string) => string) {
  const f = t.muni.ferry;
  if (!f) return '';
  const v = f.car ? `${f.sailings} sailings a day` : 'No car ferry';
  return metric('Ferry', '#4cc9f0', v, `last boat home ${f.last} · ${f.min} min crossing<br>${f.routes}`);
}

/** Nearest 24/7 emergency room by road, from the pipeline's OSRM drive times. */
function erMetric(t: TownMetrics, data: Data, metric: (l: string, dot: string, v: string, sub: string) => string, na: string) {
  if (!data.hospitals) return '';
  const e = t.er, c = '#6c8cff';
  const extra = t.care && t.care !== e && t.care.city !== e?.city ? `<br>Closer: ${t.care.city} (${t.care.ed === 'limited' ? 'limited hours' : t.care.ed === 'call' ? 'call ahead' : 'via ferry'}${t.care.min != null ? `, ${t.care.min} min` : ''})` : '';
  if (!e) return metric('Emergency room', c, na, t.muni.island ? 'no route by road or car ferry' : 'no 24/7 ER reachable without a ferry');
  if (e.ferry && e.min != null) return metric('Emergency room', c, `${e.min} min + ferry wait`, `drive and crossing to ${e.name} · ${Math.round(e.km)} km; the Town Finder adds ${erFerryWait(t.muni)} min for the wait${extra}`);
  return e.min != null
    ? metric('Emergency room', c, `${e.min} min`, `drive to ${e.name} · ${Math.round(e.km)} km${extra}`)
    : metric('Emergency room', c, `${Math.round(e.km)} km`, `straight line to ${e.name} (no drive times)${extra}`);
}

/** Days a year over the BC 24-hour PM2.5 objective at the nearest air monitor. */
function smokeMetric(t: TownMetrics, data: Data, metric: (l: string, dot: string, v: string, sub: string) => string, na: string) {
  if (!data.smoke) return '';
  const s = t.smoke, c = '#c9a27e';
  if (!s) return metric('Smoky days', c, na, 'no air monitor with 5+ recent years within 75 km');
  return metric('Smoky days', c, `${s.avg.toFixed(1)} /yr`, `PM2.5 over ${data.smoke.threshold} µg/m³ (${s.season.toFixed(1)} in May–Oct) · ${s.name} (${Math.round(s.dist)} km), ${s.years} yrs of ${s.from}–${s.to}`);
}

/** "What it feels like": 30-year climate normals, each from the nearest station that reports it. */
function feelsRow(t: TownMetrics, data: Data, metric: (l: string, dot: string, v: string, sub: string) => string, na: string) {
  if (!data.normals) return '';
  const f = t.feels;
  const from = (p: TownMetrics['feels']['sun']) => (p ? `${p.name} (${Math.round(p.dist)} km)` : 'no station nearby');
  const c = '#c5e86c';
  return `<h3>What it feels like · ${data.normals.period} normals</h3>
    <div class="metric-grid">
      ${metric('Sunshine', c, f.sun ? `${fmt.int(f.sun.v)} h` : na, `a year · ${from(f.sun)}`)}
      ${metric('Rain days', c, f.wetDays ? fmt.int(f.wetDays.v) : na, `≥0.2 mm a year · ${from(f.wetDays)}`)}
      ${metric('Frost days', c, f.frostDays ? fmt.int(f.frostDays.v) : na, `low ≤0 °C · ${from(f.frostDays)}`)}
      ${metric('Snowfall', c, f.snow ? `${fmt.int(f.snow.v)} cm` : na, `a year · ${from(f.snow)}`)}
    </div>`;
}

/** Downscaled CMIP6 projections for 2041–2070 at the town's grid cell, always with the model range. */
function futureRow(t: TownMetrics, data: Data, metric: (l: string, dot: string, v: string, sub: string) => string) {
  const f = t.future;
  if (!data.future || !f) return '';
  const c = '#ffb86b';
  // [period][p10, p50, p90]; period 0 is the models' 1991–2020, 2 is 2041–2070
  const n = (v: number, d: number) => (d === 0 && v < 10 ? v.toFixed(1) : v.toFixed(d));
  const cell = (label: string, k: keyof Omit<typeof f, 'km'>, unit: string, d: number) => {
    const [a, m, b] = f[k].ssp245[2], now = f[k].ssp245[0][1], high = f[k].ssp585[2];
    return metric(label, c, `${n(m, d)}${unit}`, `range ${n(a, d)}–${n(b, d)} · today ${n(now, d)} · high scenario ${n(high[1], d)} (${n(high[0], d)}–${n(high[2], d)})`);
  };
  const [ha, hm, hb] = f.hot.ssp245[2];
  return `<h3>By the 2050s · climate projections (2041–2070)</h3>
    <div class="callout" style="--c:${c}">By the 2050s (moderate scenario): about <b>${n(hm, 0)} hot days a year</b> over 30 °C (range ${n(ha, 0)}–${n(hb, 0)} across models), today ${n(f.hot.ssp245[0][1], 0)}. These are model projections, not records; “today” is the same models’ 1991–2020.</div>
    <div class="metric-grid">
      ${cell('Hot days > 30 °C', 'hot', ' /yr', 0)}
      ${cell('Mean temperature', 'temp', ' °C', 1)}
      ${cell('Frost days', 'frost', ' /yr', 0)}
      ${cell('Summer rain', 'summerRain', ' mm', 0)}
    </div>`;
}

// ---------------------------------------------------------------------------------------------

export function renderFinder(
  el: HTMLElement,
  data: Data,
  weights: Record<string, number>,
  opts: { onChange: (ranked: ReturnType<typeof rankTowns>) => void; onPick: (key: string) => void; onClose: () => void },
) {
  const towns: TownMetrics[] = townMetrics(data);
  el.innerHTML = `
    <button class="close-x" aria-label="Close Town Finder">×</button>
    <div class="kicker" style="--c:#a99bff">Town Finder</div>
    <h2>Where should we retire?</h2>
    <p class="lede">Tell the atlas what matters to you. Every municipality and shortlisted island is ranked on each factor from the historical data, then blended using your weights. Columns on the map show the overall score.</p>
    <div class="weights"></div>
    <div class="chips" style="margin:6px 0 4px">
      <button class="chip" data-preset="balanced">Balanced</button>
      <button class="chip" data-preset="budget">On a budget</button>
      <button class="chip" data-preset="sun">Sun &amp; safety</button>
      <button class="chip" data-preset="quiet">Quiet &amp; low-risk</button>
    </div>
    <h3>Your ranking</h3>
    <ol class="rank-list"></ol>
    <p class="note">Scores are relative (0–100 = worst to best among island towns on your criteria). Missing data (e.g. no crime series for a village) is skipped rather than penalized. Island sale prices are estimates: each island’s 2021 Census home values, carried forward with its wider rural area’s sales. Your weights are saved in this browser.</p>`;
  el.querySelector('.close-x')!.addEventListener('click', opts.onClose);

  const wEl = el.querySelector('.weights')!;
  for (const c of CRITERIA) {
    const row = document.createElement('label');
    row.className = 'weight';
    row.title = c.hint;
    row.innerHTML = `<span>${c.label}<br><span style="color:var(--ink-3);font-size:11px">${c.hint}</span></span><input type="range" min="0" max="5" step="1" value="${weights[c.id]}" data-id="${c.id}"><span class="wv">${weights[c.id]}</span>`;
    wEl.appendChild(row);
  }
  const list = el.querySelector('.rank-list')!;

  const PRESETS: Record<string, Record<string, number>> = {
    balanced: Object.fromEntries(CRITERIA.map((c) => [c.id, c.defaultWeight])),
    budget: { afford: 5, safety: 3, fire: 1, seismic: 1, quake: 0, warm: 1, dry: 1, snow: 1, hospital: 2, air: 1, future: 1, seniors: 1, services: 2 },
    sun: { afford: 1, safety: 5, fire: 2, seismic: 1, quake: 0, warm: 4, dry: 5, snow: 3, hospital: 2, air: 2, future: 1, seniors: 1, services: 2 },
    quiet: { afford: 2, safety: 4, fire: 5, seismic: 4, quake: 1, warm: 1, dry: 1, snow: 2, hospital: 3, air: 4, future: 2, seniors: 3, services: 0 },
  };

  const refresh = () => {
    const ranked = rankTowns(towns, weights);
    list.innerHTML = ranked
      .map((r, i) => `<li data-key="${r.t.muni.key}"><span class="rk">${i + 1}</span><span><span class="nm">${r.t.muni.name}</span><br><span class="rd">${r.t.price ? fmt.money(r.t.price) : '—'} · ${r.t.pop ? fmt.int(r.t.pop) + ' people' : ''}</span></span><span><div class="bar"><i style="width:${Math.round(r.score * 100)}%"></i></div><div class="bar-v">${Math.round(r.score * 100)}</div></span></li>`)
      .join('');
    opts.onChange(ranked);
  };
  wEl.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    weights[inp.dataset.id!] = +inp.value;
    inp.nextElementSibling!.textContent = inp.value;
    saveWeights(weights);
    refresh();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      Object.assign(weights, PRESETS[b.dataset.preset!]);
      wEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.value = String(weights[i.dataset.id!]); i.nextElementSibling!.textContent = i.value; });
      saveWeights(weights);
      refresh();
    }),
  );
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (li) opts.onPick(li.dataset.key!);
  });
  refresh();
}
