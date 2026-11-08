// FLOODPLAINS — BC's designated 200-year floodplain maps on the island's rivers (the provincial Floodplain Mapping
// Program, 1978–1997), with the line where each study stopped mapping. A static layer: the maps are as old as they
// are, and the panel says so. Linked to River floods for the gauges' own record of high water.
import * as d3 from 'd3';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Flood, FloodMap, FloodStudy, FloodTown, Muni, RiverStation, floodYear, fmt, km, loadFloodMap } from './data';
import type { AtlasEvent, AtlasLayer, Ctx } from './layers';
import { esc, safeUrl } from './html';

type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
const dash = [new PathStyleExtension({ dash: true })];

export const FLOOD_COLOR = '#5b8cff';
const FAN_COLOR = '#b48cff';
export const FLOOD_REFS = {
  catalogue: { label: 'Mapped Floodplains in BC (Historical), BC Data Catalogue', url: 'https://catalogue.data.gov.bc.ca/dataset/mapped-floodplains-in-bc-historical' },
  program: { label: 'Floodplain mapping in BC (Government of BC)', url: 'https://www2.gov.bc.ca/gov/content/environment/air-land-water/water/drought-flooding-dikes-dams/integrated-flood-hazard-management/flood-hazard-land-use-management/floodplain-mapping' },
};

/** "Courtenay, Puntledge, Tsolum Rivers" → the river names in it, for matching a gauge. */
const riverWords = (s: FloodStudy) => s.name.replace(/\b(Rivers?|Lake|Creek|and)\b/g, ' ').split(/[\s,·]+/).filter((w) => w.length > 2);

/** The river gauges that tell this study's flood history: on one of its named rivers within 25 km, else the nearest within 8 km. */
export function studyGauges(data: Data, s: FloodStudy): RiverStation[] {
  const all = data.rivers?.stations ?? [];
  const words = riverWords(s);
  const named = all.filter((g) => words.some((w) => g.name.startsWith(`${w} `)) && km(g.lon, g.lat, s.centre[0], s.centre[1]) <= 25);
  if (named.length) return named.sort((a, b) => Object.keys(b.peaks).length - Object.keys(a.peaks).length).slice(0, 2);
  const near = all.map((g) => ({ g, d: km(g.lon, g.lat, s.centre[0], s.centre[1]) })).filter((x) => x.d <= 8).sort((a, b) => a.d - b.d);
  return near.slice(0, 1).map((x) => x.g);
}
/** A gauge's record year and how often it ran at 1.5× its normal peak. */
function gaugeRecord(g: RiverStation) {
  const ys = Object.keys(g.peaks);
  const rec = ys.reduce((a, y) => (g.peaks[y] > g.peaks[a] ? y : a), ys[0]);
  return { years: ys.length, rec, ratio: g.peaks[rec] / g.median, high: ys.filter((y) => g.peaks[y] / g.median >= 1.5).length, date: g.peakDates[rec] ?? rec };
}
const gaugeLine = (g: RiverStation) => {
  const r = gaugeRecord(g);
  return `<b>${esc(g.name)}</b>: record peak ${r.ratio.toFixed(1)}× its normal annual high (${esc(r.date)}); 1.5× or more in ${r.high} of ${r.years} years`;
};

export const studyLabel = (s: FloodStudy) => `${s.name} (${floodYear(s) ?? 'undated'})`;

/** The Town Report row: share of the ground near the centre in a mapped floodplain, and which study. */
export function floodTownRow(data: Data, key: string, metric: (l: string, dot: string, v: string, sub: string) => string) {
  const F = data.flood;
  if (!F) return '';
  const t = F.towns[key];
  if (!t) return metric('Mapped floodplain', FLOOD_COLOR, '<span style="color:var(--ink-3)">n/a</span>', '');
  const r = F.townRadiusM / 1000;
  const s = t.studies.length ? F.studies[t.studies[0]] : null;
  const near = t.near != null ? F.studies[t.near] : null;
  const sub = s
    ? `of the ground within ${r} km of the centre${t.centre != null ? ' (the centre included)' : ''} · ${esc(studyLabel(s))}${t.studies.length > 1 ? ` and ${t.studies.length - 1} more` : ''}`
    : near && t.nearKm != null && t.nearKm <= 5
      ? `none within ${r} km; nearest mapped: ${esc(studyLabel(near))}, ${t.nearKm.toFixed(1)} km`
      : 'no mapped floodplain within 5 km: no river near here was mapped, which is not the same as safe';
  return metric('Mapped floodplain', FLOOD_COLOR, t.pct > 0 ? `${t.pct >= 10 ? Math.round(t.pct) : t.pct.toFixed(1)}%` : 'None mapped', `${sub}<br><button class="tr-fall" data-layer="flood" style="margin-top:6px">≈ Floodplain maps ›</button>`);
}

type Poly = { s: number; fan?: 1; poly: [number, number][][] };
type Row = { m: Muni; t: FloodTown };

export function floodLayer(data: Data): AtlasLayer {
  const color = FLOOD_COLOR;
  const F: Flood | null = data.flood;
  let map: FloodMap | null = null;
  let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  const ensure = () => {
    if (state !== 'idle') return;
    state = 'loading';
    loadFloodMap().then((j) => { if (j) { map = j; state = 'ready'; } else state = 'failed'; });
  };
  const studies = F?.studies ?? [];
  const rows: Row[] = F ? data.munis.flatMap((m) => (F.towns[m.key] ? [{ m, t: F.towns[m.key] }] : [])) : [];
  rows.sort((a, b) => b.t.pct - a.t.pct || (a.t.nearKm ?? 99) - (b.t.nearKm ?? 99));
  const years = studies.map(floodYear).filter((y): y is number => y != null);
  const NOW = new Date().getFullYear();

  const describeStudy = (s: FloodStudy, at?: [number, number]): AtlasEvent => {
    const y = floodYear(s);
    const gauges = studyGauges(data, s);
    const report = safeUrl(s.report);
    const townsIn = rows.filter((r) => r.t.studies.includes(studies.indexOf(s))).map((r) => r.m.name);
    return {
      layer: 'flood', kind: 'Floodplain map', title: s.name,
      body: `BC designated floodplain${s.drawing ? `, drawing ${s.drawing}` : ''}: the land the province mapped as flooding in a 1-in-200-year flood${s.fanHa ? ' or as an alluvial fan' : ''} on the ${s.name}.${townsIn.length ? ` It reaches within 2 km of ${townsIn.join(', ')}.` : ''}`,
      lon: at?.[0] ?? s.centre[0], lat: at?.[1] ?? s.centre[1], zoom: 11.5,
      stats: [
        { v: y ? String(y) : '—', l: s.designated ? 'designated' : 'report published' },
        { v: y ? `${NOW - y} yrs` : '—', l: 'since it was mapped' },
        { v: fmt.ha(s.ha), l: 'mapped floodplain' },
        ...(s.sheets ? [{ v: String(s.sheets), l: `map sheet${s.sheets > 1 ? 's' : ''}${s.published && s.published !== s.designated ? `, published ${s.published}` : ''}` }] : []),
      ],
      sections: [
        ...(s.fanHa ? [{ title: 'An alluvial fan', text: `${fmt.ha(s.fanHa)} of this study is mapped as an alluvial fan (drawn in violet): the cone of gravel a river or creek has built where it leaves the hills. Floods there can jump channel suddenly and carry debris, so a fan is a hazard area even where the water looks far away.` }] : []),
        { title: 'What the blue area means', text: 'Land the provincial engineers expected a 200-year flood (a 0.5% chance in any year) to cover, from the river surveys and hydrology of the day. Local governments use floodplain maps in their bylaws: building in one can require the floor raised above a flood construction level and a setback from the river.' },
        { title: 'Old map, changing river', text: `This map is ${y ? `${NOW - y} years old` : 'undated'}. Rivers move, gravel builds up, dikes are built or fail, land is filled, and the climate is changing, so the real floodplain may now be wider or narrower. Outside the blue is only "not mapped here", never "safe". Ask the regional district or town for any newer study and the flood construction level before buying.` },
        ...(gauges.length ? [{ title: 'High water on this river', text: gauges.map((g) => { const r = gaugeRecord(g); return `${g.name}: record peak ${r.ratio.toFixed(1)}× its normal annual high (${r.date}); 1.5× or more in ${r.high} of ${r.years} years.`; }).join(' ') + ' Show River floods to watch its peaks year by year.' }] : []),
      ],
      sources: [
        ...(report ? [{ label: `Floodplain mapping report for ${s.projects[0] ?? s.name} (Aquatic Report Catalogue, EcoCat)`, url: report }] : []),
        FLOOD_REFS.catalogue,
      ],
      layers: gauges.length ? ['flood', 'rivers'] : ['flood'],
    };
  };

  const l: AtlasLayer = {
    id: 'flood',
    name: 'Floodplains',
    icon: '≈',
    color,
    range: [2026, 2026.99],
    static: true,
    period: years.length ? `designated ${Math.min(...years)}–${Math.max(...years)}` : 'designated floodplain maps',
    available: !!F,
    unavailable: 'The floodplain data hasn’t been built yet. Run <code>npm run data flood</code>, then reload.',
    build({ focusedId, hovered, selected }: Ctx) {
      if (!F) return [];
      ensure();
      if (!map) return [];
      const focused = focusedId === 'flood';
      const out: Layer[] = [
        new PolygonLayer<Poly>({
          id: 'flood-areas-base',
          data: map.polys,
          getPolygon: (p) => p.poly,
          getFillColor: (p) => rgb(p.fan ? FAN_COLOR : color, focused ? 120 : 80),
          getLineColor: [200, 220, 255, focused ? 230 : 150],
          lineWidthMinPixels: 1,
          stroked: true,
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new PathLayer<[number, number][]>({
          id: 'flood-limits',
          data: map.limits,
          getPath: (p) => p,
          getColor: [255, 214, 120, focused ? 230 : 140],
          getWidth: 2,
          widthUnits: 'pixels',
          getDashArray: [4, 3],
          dashJustified: true,
          extensions: dash,
          parameters: NO_DEPTH,
        } as any),
      ];
      if (focused) {
        const hot = hovered ?? selected;
        const lit = rows.filter((r) => r.t.pct > 0 || r.t.centre != null);
        out.push(
          // a soft ring round each study, so the small mapped areas can be found at island scale
          new ScatterplotLayer<FloodStudy>({
            id: 'flood-study-rings',
            data: studies,
            getPosition: (s) => s.centre,
            getRadius: (s) => 900 + Math.sqrt(s.ha) * 45,
            radiusMinPixels: 6,
            radiusMaxPixels: 16,
            stroked: true,
            filled: false,
            lineWidthMinPixels: 1.5,
            getLineColor: rgb(color, 170),
            parameters: { depthCompare: 'always' },
          } as any),
          new ScatterplotLayer<Row>({
            id: 'flood-towns',
            data: lit,
            getPosition: (r) => [r.m.lon, r.m.lat],
            getRadius: (r) => (r.m.key === hot ? 1400 : 750),
            radiusMinPixels: 4,
            radiusMaxPixels: 11,
            getFillColor: [255, 255, 255, 235],
            stroked: true,
            getLineColor: (r) => (r.m.key === hot ? rgb(color) : [6, 10, 18, 230]),
            lineWidthMinPixels: 1.5,
            pickable: true,
            updateTriggers: { getRadius: hot, getLineColor: hot },
            parameters: { depthCompare: 'always' },
          } as any),
          new TextLayer<Row>({
            id: 'flood-town-labels',
            data: lit,
            getPosition: (r) => [r.m.lon, r.m.lat],
            getText: (r) => `${Math.round(r.t.pct)}%`,
            getSize: (r) => (r.m.key === hot ? 13 : 10.5),
            getColor: [235, 242, 255, 240],
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
      el.innerHTML = `<div class="kicker" style="--c:${color}">Floodplains · BC designated floodplain maps</div>
        <h2>Where the rivers were mapped to flood</h2>`;
      if (!F) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const wet = rows.filter((r) => r.t.pct > 0);
      const max = Math.max(1, rows[0]?.t.pct ?? 1);
      const totalHa = studies.reduce((a, s) => a + s.ha, 0);
      const stat = (v: string, lab: string) => `<div class="stat"><div class="v">${v}</div><div class="l">${lab}</div></div>`;
      const byYear = [...studies].sort((a, b) => (floodYear(a) ?? 0) - (floodYear(b) ?? 0));
      const studyRows = byYear.map((s) => {
        const report = safeUrl(s.report);
        const gauges = studyGauges(data, s);
        return `<li data-study="${studies.indexOf(s)}" style="cursor:pointer"><b>${esc(s.name)}</b> <span class="rd">· ${floodYear(s) ?? 'undated'} · ${fmt.ha(s.ha)}</span><br>
          <span class="rd">${s.projects.length ? `${esc(s.projects.join('; '))} · ` : ''}${s.drawing ? `drawing ${esc(s.drawing)}` : ''}${report ? ` · <a href="${esc(report)}" target="_blank" rel="noopener">report</a>` : ''}</span>
          ${gauges.length ? `<br><span class="rd">${gauges.map(gaugeLine).join('<br>')}</span>` : ''}</li>`;
      }).join('');
      el.insertAdjacentHTML('beforeend', `
        <p class="lede">The blue areas are <b>BC’s designated floodplains</b>: the land the province mapped as flooding in a <b>200-year flood</b> (a 0.5% chance in any year) on ${studies.length} of the island’s rivers and lakes. ${studies.some((s) => s.fanHa) ? `Violet marks an alluvial fan (${esc(studies.filter((s) => s.fanHa).map((s) => s.name).join(', '))}). ` : ''}The dashed gold lines mark where each study stopped mapping. Click an area for its study, its age and its report.</p>`);
      const hero = el.appendChild(document.createElement('div'));
      hero.className = 'hero';
      hero.innerHTML = [
        stat(String(studies.length), 'rivers and lakes mapped on the islands'),
        stat(years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '—', 'when they were mapped'),
        stat(fmt.ha(totalHa), 'of mapped floodplain'),
        stat(String(wet.length), `towns with mapped floodplain within ${F.townRadiusM / 1000} km`),
      ].join('');
      el.insertAdjacentHTML('beforeend', `
        <div class="callout" style="--c:#ffd678"><b>Unmapped is not safe, and the maps are old.</b> These are the province’s historical maps, digitized from paper 1:5,000 sheets: the newest here is from ${years.length ? Math.max(...years) : 'the 1990s'}, the oldest from ${years.length ? Math.min(...years) : 'the 1970s'}, and only some rivers were ever mapped. Rivers have moved and the climate has changed since. Most creeks, every coastal shoreline (storm surge and sea-level rise) and the Gulf Islands have no map at all here. Regional districts and towns may hold newer studies that aren’t published as open data: ask the regional district for the current floodplain map and flood construction level for any property.</div>
        <button class="tr-fall" data-layer="rivers" type="button" style="margin:8px 0 2px">≋ River floods: a century of high water at the gauges ›</button>
        <h3>The floodplain studies, oldest first</h3>
        <ul class="tz-studies">${studyRows}</ul>
        <h3>Towns by mapped floodplain nearby</h3>
        <ol class="rank-list">${rows.filter((r) => r.t.pct > 0 || (r.t.nearKm ?? 99) <= 5).map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${r.t.studies.length ? esc(studies[r.t.studies[0]].name) : r.t.near != null ? `nearest: ${esc(studies[r.t.near].name)}, ${r.t.nearKm?.toFixed(1)} km` : ''}${r.t.centre != null ? ' · centre inside' : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.t.pct / max) * 100)}%;background:${color}"></i></div><div class="bar-v">${Math.round(r.t.pct)}%</div></span></li>`).join('')}</ol>
        <p class="note">Share of the ground within ${F.townRadiusM / 1000} km of each town centre (sea left out) inside a mapped floodplain, sampled every 50 m. It includes river channels where the maps do. Towns not listed have no mapped floodplain within 5 km, which says nothing about creeks or the shore.</p>
        <div class="source">Source: ${esc(F.source)}. <a href="${FLOOD_REFS.program.url}" target="_blank" rel="noopener">About BC floodplain mapping</a>.</div>`);
      el.querySelectorAll<HTMLElement>('[data-layer]').forEach((b) => b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:layer', { detail: b.dataset.layer }))));
      el.querySelectorAll<HTMLElement>('.rank-list li[data-key]').forEach((li) => li.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:town', { detail: li.dataset.key }))));
      el.querySelectorAll<HTMLElement>('[data-study]').forEach((li) => li.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        const s = studies[+li.dataset.study!];
        if (s) window.dispatchEvent(new CustomEvent('atlas:event', { detail: describeStudy(s) }));
      }));
      return { update() {} };
    },
    describe(info: PickingInfo) {
      if (!F || !info.object) return null;
      if (info.layer?.id === 'flood-areas-base') {
        const p = info.object as Poly;
        const s = studies[p.s];
        return s ? describeStudy(s, info.coordinate as [number, number] | undefined) : null;
      }
      return null;
    },
    tooltip(info: PickingInfo) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('flood') || !F) return null;
      if (id === 'flood-areas-base') {
        const s = studies[(info.object as Poly).s];
        if (!s) return null;
        const y = floodYear(s);
        return `<b>${esc(s.name)} ${(info.object as Poly).fan ? 'alluvial fan' : 'floodplain'}</b><br><span class="tk">Mapped</span> <span class="tv">${y ?? 'undated'}${y ? ` (${NOW - y} years ago)` : ''}</span><br><span class="tk">Flood</span> <span class="tv">200-year (0.5% a year)</span><br><span class="tk">Area</span> <span class="tv">${fmt.ha(s.ha)}</span>`;
      }
      const r = info.object as Row;
      if (!r.m) return null;
      const s = r.t.studies.length ? studies[r.t.studies[0]] : null;
      return `<b>${esc(r.m.name)}</b><br><span class="tk">In a mapped floodplain within ${F.townRadiusM / 1000} km</span> <span class="tv">${r.t.pct}%</span>${s ? `<br><span class="tk">Study</span> <span class="tv">${esc(studyLabel(s))}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}
