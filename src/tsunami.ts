// TSUNAMI ZONES — BC's tsunami notification zones, the openly published hazard maps (Strathcona Regional
// District's Cascadia and Alaska scenarios on the north-west coast, the City of Victoria's 2021 hazard zone),
// and low coastal ground everywhere else, which fills with glowing water as a wave sweeps in from the open
// Pacific. A static layer: nothing here changes over time.
import * as d3 from 'd3';
import { ColumnLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Muni, TsunamiMap, TsunamiTown, km, loadTsunamiMap } from './data';
import type { AtlasLayer, Ctx } from './layers';
import { esc } from './html';

type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
const ADDITIVE = { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false } as const;
const filter = [new DataFilterExtension({ filterSize: 1 })];

/** Published figures quoted in the panel and the Town Report (never per-town arrival times: none are published openly). */
export const TSUNAMI_REFS = {
  onc: { label: 'Kouhi et al. (2023), Assessment of tsunami hazard along British Columbia coastlines from coseismic sources, Oceanography 36 (suppl. 1), Ocean Networks Canada', url: 'https://tos.org/oceanography/article/assessment-of-tsunami-hazard-along-british-columbia-coastlines-from-coseismic-sources' },
  crd: { label: 'Capital Region Tsunami Information Portal (CRD and EMCR)', url: 'https://capital-region-tsunami-information-portal-bcgov03.hub.arcgis.com/' },
  srd: { label: 'Northwest Vancouver Island Tsunami Risk Assessment (Strathcona Regional District)', url: 'https://storymaps.arcgis.com/stories/ee3f568154ed46d8b3ee3b6be04f9c8a' },
  zones: { label: 'Tsunami Notification Zones for BC (BC Data Catalogue)', url: 'https://catalogue.data.gov.bc.ca/dataset/tsunami-notification-zones-for-bc' },
};
/** The one published Cascadia arrival figure for the island: Ocean Networks Canada's modelling for the outer north-west coast. */
export const CASCADIA_OUTER_COAST_MIN = 20;

const ZONE_NOTE: Record<string, string> = {
  B: 'the north-east island and Queen Charlotte Strait, sheltered from the open Pacific',
  C: 'the outer west coast, facing the open Pacific and the Cascadia fault: the most exposed',
  D: 'Juan de Fuca Strait, from Port Renfrew to Victoria and the Saanich Peninsula',
  E: 'the Strait of Georgia, behind the island',
};
export const zoneName = (z: string | null | undefined) => (z ? `Zone ${z}` : 'No zone');

type Cell = { p: [number, number, number]; e: number; s: number };
type Area = { id: string; kind: 'local' | 'distant'; name: string; poly: [number, number][][] };
type Zone = { zone: string; label: string; color: string; poly: [number, number][][] };
type Decoded = { cells: Cell[]; sea: Cell[]; zones: Zone[]; areas: Area[]; maxS: number };

function decode(j: TsunamiMap, data: Data): Decoded {
  const N = 2 ** j.z;
  const lonOf = (x: number) => ((j.x0 + (x + 0.5) / 256) / N) * 360 - 180;
  const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (j.y0 + (y + 0.5) / 256)) / N))) * 180) / Math.PI;
  const at = (i: number): [number, number, number] => { const x = i % j.w; return [lonOf(x), latOf((i - x) / j.w), 0]; };
  let i = 0;
  const cells = j.ground.idx.map((d, k) => ({ p: at((i += d)), e: j.ground.e[k], s: j.ground.s[k] }));
  i = 0;
  const sea = j.wave.idx.map((d, k) => ({ p: at((i += d)), e: 0, s: j.wave.s[k] }));
  const meta = new Map((data.tsunami?.areas ?? []).map((a) => [a.id, a]));
  return {
    // the sweep ends when the last island shore is reached, not the far mainland inlets
    cells, sea, maxS: cells.reduce((m, c) => Math.max(m, c.s), 1),
    zones: j.zones.flatMap((z) => z.polys.map((poly) => ({ zone: z.zone, label: z.label, color: z.color, poly }))),
    areas: j.areas.flatMap((a) => a.polys.map((poly) => ({ id: a.id, kind: meta.get(a.id)?.kind ?? 'local', name: meta.get(a.id)?.name ?? a.id, poly }))),
  };
}

const SWEEP_MS = 9000, HOLD_MS = 5000, RISE = 5; // water heights drawn 5x so they read at island scale

export function tsunamiLayer(data: Data): AtlasLayer {
  const color = '#38e1ff';
  const T = data.tsunami;
  let map: Decoded | null = null;
  let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  let start = 0; // when the current sweep began (performance.now)
  type Row = { m: Muni; t: TsunamiTown };
  const rows: Row[] = T ? data.munis.flatMap((m) => (T.towns[m.key] ? [{ m, t: T.towns[m.key] }] : [])) : [];
  rows.sort((a, b) => b.t.low - a.t.low);
  const zoneColor = (z: string | null) => T?.zones.find((x) => x.zone === z)?.color ?? '#94a3b8';
  const depth = d3.scaleLinear<string>().domain([0, 10, 20]).range(['#e0fbff', '#38e1ff', '#1d6fd8']).clamp(true);
  const ensure = () => {
    if (state !== 'idle') return;
    state = 'loading';
    loadTsunamiMap().then((j) => { if (j) { map = decode(j, data); state = 'ready'; start = performance.now(); } else state = 'failed'; });
  };
  /** Sweep position (in route steps) and how far the water has risen (0–1), for this frame. */
  const phase = (clock: number, focused: boolean) => {
    if (!map || !focused) return { front: Infinity, rise: 1, sweeping: false };
    const t = (clock - start) % (SWEEP_MS + HOLD_MS);
    const p = Math.min(1, t / SWEEP_MS);
    const e = d3.easeCubicInOut(p);
    return { front: e * map.maxS * 1.02, rise: d3.easeCubicOut(Math.min(1, t / (SWEEP_MS * 0.9))), sweeping: p < 1 };
  };

  const l: AtlasLayer = {
    id: 'tsunami',
    name: 'Tsunami zones',
    icon: '≋',
    color,
    range: [2026, 2026.99],
    static: true,
    period: 'notification zones and mapped hazard areas',
    available: !!T,
    unavailable: 'The tsunami data hasn’t been built yet. Run <code>npm run data tsunami</code>, then reload.',
    build({ focusedId, hovered, selected, clock }: Ctx) {
      if (!T) return [];
      ensure();
      if (!map) return [];
      const focused = focusedId === 'tsunami';
      const { front, rise, sweeping } = phase(clock, focused);
      const soft = map.maxS * 0.035;
      const out: Layer[] = [
        new PolygonLayer<Zone>({
          id: 'tsunami-zones-base',
          data: map.zones,
          getPolygon: (z) => z.poly,
          getFillColor: (z) => rgb(z.color, focused ? 22 : 12),
          getLineColor: (z) => rgb(z.color, focused ? 150 : 70),
          lineWidthMinPixels: 1,
          stroked: true,
          pickable: focused,
          parameters: NO_DEPTH,
        } as any),
        new PolygonLayer<Area>({
          id: 'tsunami-areas-base',
          data: map.areas,
          getPolygon: (a) => a.poly,
          getFillColor: (a) => (a.kind === 'local' ? [150, 240, 255, focused ? 120 : 70] : [0, 0, 0, 0]),
          getLineColor: (a) => (a.kind === 'local' ? [225, 252, 255, 220] : [255, 200, 120, 230]),
          lineWidthMinPixels: 1.2,
          stroked: true,
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new ColumnLayer<Cell>({
          id: 'tsunami-water',
          data: map.cells,
          getPosition: (c) => c.p,
          diskResolution: 4,
          angle: 45,
          radius: 72,
          extruded: true,
          getElevation: (c) => Math.max(0.5, T.screenM - c.e),
          elevationScale: RISE * rise,
          getFillColor: (c) => rgb(depth(c.e), focused ? 120 : 80),
          material: { ambient: 0.55, diffuse: 0.5, shininess: 60, specularColor: [190, 240, 255] },
          getFilterValue: (c: Cell) => c.s,
          filterRange: [-1, front],
          filterSoftRange: [-1, front - soft],
          extensions: filter,
          pickable: true,
        } as any),
      ];
      if (sweeping) {
        out.push(
          new ScatterplotLayer<Cell>({
            id: 'tsunami-wave',
            data: map.sea,
            getPosition: (c) => c.p,
            getRadius: 520,
            radiusMinPixels: 1,
            getFillColor: [110, 215, 255, 60],
            getFilterValue: (c: Cell) => c.s,
            filterRange: [front - soft * 1.6, front],
            filterSoftRange: [front - soft * 0.4, front],
            extensions: filter,
            parameters: ADDITIVE,
          } as any),
          new ScatterplotLayer<Cell>({
            id: 'tsunami-crest',
            data: map.cells,
            getPosition: (c) => [c.p[0], c.p[1], (T.screenM - c.e) * RISE * rise + 4],
            getRadius: 110,
            getFillColor: [235, 253, 255, 200],
            getFilterValue: (c: Cell) => c.s,
            filterRange: [front - soft, front],
            filterSoftRange: [front - soft * 0.25, front],
            extensions: filter,
            parameters: ADDITIVE,
          } as any),
        );
      }
      if (focused) {
        const hot = hovered ?? selected;
        out.push(
          new ScatterplotLayer<Row>({
            id: 'tsunami-towns',
            data: rows,
            getPosition: (r) => [r.m.lon, r.m.lat],
            getRadius: (r) => (r.m.key === hot ? 1500 : 800),
            radiusMinPixels: 4,
            radiusMaxPixels: 11,
            getFillColor: (r) => rgb(zoneColor(r.t.zone)),
            stroked: true,
            getLineColor: (r) => (r.m.key === hot ? [255, 255, 255, 255] : [6, 10, 18, 230]),
            lineWidthMinPixels: 1.5,
            pickable: true,
            updateTriggers: { getRadius: hot, getLineColor: hot },
            parameters: { depthCompare: 'always' },
          } as any),
          new TextLayer<Row>({
            id: 'tsunami-labels',
            data: rows,
            getPosition: (r) => [r.m.lon, r.m.lat],
            getText: (r) => `${r.t.zone ?? '–'} · ${Math.round(r.t.low)}%`,
            getSize: (r) => (r.m.key === hot ? 13 : 10.5),
            getColor: [232, 250, 255, 235],
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
      el.innerHTML = `<div class="kicker" style="--c:${color}">Tsunami zones · BC notification zones and mapped hazard areas</div>
        <h2>Where could a tsunami reach?</h2>`;
      if (!T) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const outer = rows.filter((r) => r.t.zone === 'C');
      const mapped = rows.filter((r) => r.t.study);
      const max = Math.max(1, rows[0]?.t.low ?? 1);
      const zoneRows = T.zones.map((z) => {
        const n = rows.filter((r) => r.t.zone === z.zone).length;
        return `<li style="--c:${z.color}"><span class="tz-sw"></span><span><b>Zone ${esc(z.zone)}</b> · ${esc(z.label)}<br><span class="rd">${esc(ZONE_NOTE[z.zone] ?? '')}${n ? ` · ${n} town${n > 1 ? 's' : ''}` : ''}</span></span></li>`;
      }).join('');
      const studies = T.areas.map((a) => `<li><b>${esc(a.name)}</b> <span class="rd">(${a.kind === 'local' ? 'local quake' : 'distant quake'})</span><br><span class="rd">${esc(a.publisher)} · ${esc(a.licence)}</span></li>`).join('');
      el.insertAdjacentHTML('beforeend', `
        <p class="lede">The coloured bands over the sea are <b>BC’s five tsunami notification zones</b>: when a warning is issued it names the zones that must act. On land, <b>glowing water fills the low ground near the sea</b> (below ${T.screenM} m, within ${T.nearSeaM / 1000} km of the shore), and a wave sweeps in from the open Pacific. Where a published study has mapped the hazard in detail, its area is outlined in white.</p>`);
      const hero = el.appendChild(document.createElement('div'));
      hero.className = 'hero';
      const stat = (v: string, lab: string) => `<div class="stat"><div class="v">${v}</div><div class="l">${lab}</div></div>`;
      hero.innerHTML = [
        stat(`~${CASCADIA_OUTER_COAST_MIN} min`, 'Cascadia: first waves on the outer north-west coast (ONC, 2023)'),
        stat(String(outer.length), `towns on the outer coast (Zone C)`),
        stat(`${Math.round(T.groundKm2)} km²`, `low coastal ground on the atlas’s islands`),
        stat(String(mapped.length), `towns with an openly published hazard map`),
      ].join('');
      el.insertAdjacentHTML('beforeend', `
        <button class="pill-btn tz-replay" type="button">↻ Replay the wave</button>
        <div class="callout" style="--c:${color}"><b>Local versus distant.</b> A great Cascadia earthquake just offshore would send first waves to the outer coast of north-west Vancouver Island in about <b>${CASCADIA_OUTER_COAST_MIN} minutes</b> and to Boundary Bay in about <b>3 hours</b> (Ocean Networks Canada modelling of a magnitude 9). The shaking is the warning: go to high ground on foot, without waiting for an alert. A distant quake gives hours: the 1964 Alaska tsunami reached Port Alberni overnight, long after the shaking in Alaska.</div>
        <h3>The notification zones</h3>
        <ul class="tz-zones">${zoneRows}</ul>
        <h3>Mapped hazard areas</h3>
        <ul class="tz-studies">${studies}</ul>
        <p class="note" style="margin-top:6px">Only these are published as open data. Greater Victoria’s full regional map (same 2021 study) is on the <a href="${TSUNAMI_REFS.crd.url}" target="_blank" rel="noopener">Capital Region Tsunami Information Portal</a>, whose terms don’t allow copying it here. Port Alberni, Tofino, Ucluelet and the east-coast districts publish their maps as PDFs: check your district’s map before buying low-lying land.</p>
        <h3>Towns by low coastal ground nearby</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${zoneName(r.t.zone)}${r.t.study ? ` · mapped${r.t.inHazard ? ', centre in hazard area' : ''}` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.t.low / max) * 100)}%;background:${zoneColor(r.t.zone)}"></i></div><div class="bar-v">${Math.round(r.t.low)}%</div></span></li>`).join('')}</ol>
        <p class="note">Low coastal ground is a <b>screening measure</b>, not an official hazard map: ground under ${T.screenM} m above sea level and within ${T.nearSeaM / 1000} km of the sea, on ~100 m terrain, counted within ${T.townRadiusM / 1000} km of each town centre. ${T.screenM} m sits above the 12 m run-up Ocean Networks Canada estimates for the north-west coast. Real reach depends on the shape of the bays and inlets: funnel-shaped inlets such as Alberni Inlet pile water higher. Water heights are drawn ${RISE}× taller so they read at island scale, and the sweep follows the sea route in from the open Pacific: it shows the order the coast is reached, not modelled timing.</p>
        <div class="source">Source: ${esc(T.source)}. Arrival times: <a href="${TSUNAMI_REFS.onc.url}" target="_blank" rel="noopener">${esc(TSUNAMI_REFS.onc.label)}</a>.</div>`);
      el.querySelector('.tz-replay')!.addEventListener('click', () => { start = performance.now(); });
      return { update() {} };
    },
    tooltip(info: PickingInfo) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('tsunami') || !T) return null;
      if (id === 'tsunami-zones-base') {
        const z = info.object as Zone;
        return `<b>Tsunami notification Zone ${esc(z.zone)}</b><br><span class="tk">Coast</span> <span class="tv">${esc(z.label)}</span><br><span class="tk">${esc(ZONE_NOTE[z.zone] ?? '')}</span>`;
      }
      if (id === 'tsunami-areas-base') {
        const a = info.object as Area;
        const m = T.areas.find((x) => x.id === a.id);
        return `<b>${esc(a.name)}</b><br><span class="tk">Scenario</span> <span class="tv">${a.kind === 'local' ? 'local (Cascadia) quake' : 'distant (Alaska) quake'}</span><br><span class="tk">Mapped by</span> <span class="tv">${esc(m?.publisher.split(',')[0] ?? '')}</span>`;
      }
      if (id === 'tsunami-water') {
        const c = info.object as Cell;
        const near = data.munis.reduce((b, m) => { const d = km(c.p[0], c.p[1], m.lon, m.lat); return d < b.d ? { m, d } : b; }, { m: data.munis[0], d: Infinity });
        return `<b>Low coastal ground</b><br><span class="tk">Ground height</span> <span class="tv">about ${c.e} m above sea level</span><br><span class="tk">Near</span> <span class="tv">${Math.round(near.d)} km from ${esc(near.m.name)}</span><br><span class="tk">A screening measure, not an official map</span>`;
      }
      const r = info.object as Row;
      return `<b>${esc(r.m.name)}</b><br><span class="tk">Notification zone</span> <span class="tv">${zoneName(r.t.zone)}</span><br><span class="tk">Low coastal ground within ${T.townRadiusM / 1000} km</span> <span class="tv">${Math.round(r.t.low)}%</span><br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}
