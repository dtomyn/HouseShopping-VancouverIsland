// WATER ACCESS and CAMPING — two static point layers in the Outdoors group (scripts/outdoors.mjs builds water.json and
// camping.json). Water: sea and lake beaches, named beach accesses, boat launches, marinas and DFO small craft harbours.
// Camping: BC Parks, national park, recreation site and other campgrounds, plus day-use recreation sites. Both share
// one point-layer builder; the Town Report rows and the Land Finder's distances live here too.
import * as d3 from 'd3';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Camping, Data, Muni, OutRow, Water, fmt, km } from './data';
import type { AtlasEvent, AtlasLayer } from './layers';
import { esc, safeUrl } from './html';

type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };
type Style = { c: string; glyph?: string; size: number; ring?: boolean };
type Metric = (l: string, dot: string, v: string, sub: string) => string;

export const WATER_COLOR = '#38bdf8';
export const CAMP_COLOR = '#a3e635';
/** Marker per water kind, in water.json's kinds order: beach, lake, access, launch, marina, harbour. */
const WATER_STYLE: Record<string, Style> = {
  beach: { c: '#f6d58e', size: 4 },
  lake: { c: '#7ee0b5', size: 4 },
  access: { c: '#f6d58e', size: 3.5, ring: true },
  launch: { c: '#22d3ee', glyph: '▲', size: 15 },
  marina: { c: '#7aa2ff', glyph: '◆', size: 15 },
  harbour: { c: '#ffffff', glyph: '■', size: 12 },
};
/** Marker per camping kind: park, national, rec, other, day. Backcountry and paddle-in sites get the hollow tent. */
const CAMP_STYLE: Record<string, Style> = {
  park: { c: '#4ade80', glyph: '▲', size: 15 },
  national: { c: '#2dd4bf', glyph: '▲', size: 15 },
  rec: { c: '#fbbf24', glyph: '▲', size: 14 },
  other: { c: '#c4b5fd', glyph: '▲', size: 13 },
  day: { c: '#fbbf24', size: 3.5, ring: true },
};

const mapsLink = (r: OutRow) => {
  const ref = r[6];
  const m = /^([nwr])(\d+)$/.exec(ref) ?? /^([nwr])(\d+)$/.exec(String(r[5]?.osm ?? ''));
  return m ? { label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[m[1]]}/${m[2]}` } : null;
};
const nearestMuni = (munis: Muni[], lon: number, lat: number) => munis.reduce((b, m) => { const d = km(lon, lat, m.lon, m.lat); return d < b.d ? { m, d } : b; }, { m: munis[0], d: Infinity });
const where = (data: Data, r: OutRow) => { const n = nearestMuni(data.munis, r[0], r[1]); return n.d < 2 ? `in ${n.m.name}` : `${Math.round(n.d)} km from ${n.m.name}`; };
const kmText = (d: number) => (d < 1 ? `${Math.round(d * 1000 / 50) * 50} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`);
const yesNo = (v: unknown) => (v === 1 ? 'yes' : v === 0 ? 'no' : null);

type Cfg = {
  id: 'water' | 'camping'; name: string; icon: string; color: string; period: string;
  P: Water | Camping | null; styles: Record<string, Style>;
  /** extra tooltip lines (already escaped) */
  lines: (r: OutRow) => [string, string][];
  describe: (r: OutRow) => AtlasEvent;
  panel: (el: HTMLElement, hidden: Set<number>, chips: string) => void;
};

/** The shared point layer: dots and ringed dots for the many small things, glyphs for the few bigger ones. */
function pointLayer(cfg: Cfg): AtlasLayer {
  const P = cfg.P;
  const rows = P?.rows ?? [];
  const styleOf = (r: OutRow) => cfg.styles[P!.kinds[r[2]].id] ?? { c: '#cbd5e1', size: 4 };
  const hidden = new Set<number>();
  let memo = '', dots: OutRow[] = [], rings: OutRow[] = [], marks: OutRow[] = [];
  const split = () => {
    const key = [...hidden].sort().join(',');
    if (key === memo && (dots.length || rings.length || marks.length)) return;
    memo = key;
    const shown = rows.filter((r) => !hidden.has(r[2]));
    dots = shown.filter((r) => !styleOf(r).glyph && !styleOf(r).ring);
    rings = shown.filter((r) => !styleOf(r).glyph && styleOf(r).ring);
    marks = shown.filter((r) => styleOf(r).glyph);
  };
  const glyphOf = (r: OutRow) => (r[5]?.back ? '△' : styleOf(r).glyph!);
  const chips = () => P ? `<div class="chips od-chips">${P.kinds.map((k, i) => {
    const s = cfg.styles[k.id], n = rows.filter((r) => r[2] === i).length;
    return n ? `<button class="chip${hidden.has(i) ? '' : ' on'}" data-k="${i}" style="--c:${s.c}"><span class="od-sw${s.glyph ? '' : s.ring ? ' ring' : ' dot'}" style="color:${s.c}">${s.glyph ?? ''}</span>${esc(k.label)} <small>${fmt.int(n)}</small></button>` : '';
  }).join('')}</div>` : '';

  const l: AtlasLayer = {
    id: cfg.id, name: cfg.name, icon: cfg.icon, color: cfg.color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: cfg.period,
    available: rows.length > 0,
    unavailable: `The ${cfg.name.toLowerCase()} data hasn’t been built yet. Run <code>npm run data ${cfg.id}</code>, then reload.`,
    build({ focusedId }) {
      if (!P) return [];
      split();
      const f = focusedId === cfg.id, a = f ? 255 : 190, k = f ? 1 : 0.8;
      const out: Layer[] = [
        // radius in pixels, so the island's 900 beaches read as a coastline of sand at any zoom
        new ScatterplotLayer<OutRow>({
          id: `${cfg.id}-dots`, data: dots,
          getPosition: (r) => [r[0], r[1]], radiusUnits: 'pixels', getRadius: (r: OutRow) => styleOf(r).size * k,
          getFillColor: (r) => rgb(styleOf(r).c, a),
          stroked: true, getLineColor: [6, 10, 18, 200], lineWidthMinPixels: 1,
          updateTriggers: { getFillColor: a, getRadius: k },
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
        new ScatterplotLayer<OutRow>({
          id: `${cfg.id}-rings`, data: rings,
          getPosition: (r) => [r[0], r[1]], radiusUnits: 'pixels', getRadius: (r: OutRow) => styleOf(r).size * k,
          filled: true, getFillColor: [6, 10, 18, 160], stroked: true, getLineColor: (r) => rgb(styleOf(r).c, a), lineWidthMinPixels: 1.5,
          updateTriggers: { getLineColor: a, getRadius: k },
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
        new TextLayer<OutRow>({
          id: `${cfg.id}-marks`, data: marks,
          getPosition: (r) => [r[0], r[1]], getText: glyphOf,
          getSize: (r) => styleOf(r).size * k, getColor: (r) => rgb(styleOf(r).c, a),
          characterSet: [...new Set(Object.values(cfg.styles).map((s) => s.glyph).filter(Boolean).concat('△'))].join(''),
          fontFamily: 'Inter, "Segoe UI Symbol", sans-serif', fontWeight: 700,
          outlineWidth: 4, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true, buffer: 6 },
          updateTriggers: { getColor: a, getSize: k },
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
      ];
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      if (!P) {
        el.innerHTML = `<div class="kicker" style="--c:${cfg.color}">${esc(cfg.name)}</div><h2>${esc(cfg.name)}</h2><div class="unavail">${l.unavailable}</div>`;
        return { update() {} };
      }
      cfg.panel(el, hidden, chips());
      const wire = () => el.querySelectorAll<HTMLButtonElement>('.od-chips [data-k]').forEach((b) => b.addEventListener('click', () => {
        const k = +b.dataset.k!;
        if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
        b.classList.toggle('on', !hidden.has(k));
      }));
      wire();
      el.querySelectorAll<HTMLElement>('.rank-list li[data-key]').forEach((li) => li.addEventListener('click', () => window.dispatchEvent(new CustomEvent('atlas:town', { detail: li.dataset.key }))));
      return { update() {} };
    },
    describe(info: PickingInfo) {
      if (!P || !info.object || !info.layer?.id.startsWith(`${cfg.id}-`)) return null;
      return cfg.describe(info.object as OutRow);
    },
    tooltip(info: PickingInfo) {
      if (!P || !info.object || !info.layer?.id.startsWith(`${cfg.id}-`)) return null;
      const r = info.object as OutRow;
      const kind = P.kinds[r[2]].label;
      const lines = [['Type', kind] as [string, string], ...cfg.lines(r)];
      return `<b>${esc(r[4] ?? `Unnamed ${kind.toLowerCase()}`)}</b><br>${lines.map(([k, v]) => `<span class="tk">${esc(k)}</span> <span class="tv">${v}</span>`).join('<br>')}`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// water access

export function waterLayer(data: Data): AtlasLayer {
  const W = data.water;
  const count = (...ids: string[]) => (W?.rows ?? []).filter((r) => ids.includes(W!.kinds[r[2]].id)).length;
  const lines = (r: OutRow): [string, string][] => {
    const d = r[5] ?? {}, out: [string, string][] = [];
    if (d.htype) out.push(['Harbour', esc(`${d.htype}${d.by ? ` · run by ${d.by}` : ''}`)]);
    if (d.aka) out.push(['Also', esc(d.aka)]);
    if (d.access) out.push(['Access', esc(d.access)]);
    if (d.fee) out.push(['Fee', esc(d.fee)]);
    if (d.berths) out.push(['Berths', esc(d.berths)]);
    if (d.surface) out.push(['Surface', esc(d.surface)]);
    out.push(['Where', esc(where(data, r))]);
    return out;
  };
  return pointLayer({
    id: 'water', name: 'Water access', icon: '⚓', color: WATER_COLOR, period: 'beaches, launches and moorage today', P: W, styles: WATER_STYLE, lines,
    describe(r) {
      const d = r[5] ?? {}, kind = W!.kinds[r[2]];
      const web = safeUrl(String(d.web ?? '')), by = safeUrl(String(d.byUrl ?? '')), osm = mapsLink(r);
      const facts = [
        d.fee ? `Fee: ${d.fee}.` : '', d.berths ? `${d.berths} berths.` : '', d.fuel ? 'Fuel dock.' : '', d.pump ? 'Sewage pump-out.' : '', d.power ? 'Shore power.' : '',
        d.surface ? `Surface: ${d.surface}.` : '', d.dog ? `Dogs: ${d.dog}.` : '', d.nude ? 'Clothing optional.' : '',
      ].filter(Boolean).join(' ');
      const what: Record<string, string> = {
        beach: 'A beach on the sea, as mapped in OpenStreetMap.',
        lake: 'A beach on a lake or river, as mapped in OpenStreetMap.',
        access: 'A named public path or stair to the shore, as mapped in OpenStreetMap. Many more small accesses are signed on the ground but not mapped.',
        launch: 'A ramp for putting a boat in the water (a slipway), as mapped in OpenStreetMap. Check the tide range, trailer parking and any launch fee locally.',
        marina: 'A marina, as mapped in OpenStreetMap: moorage for visiting or monthly boats. Many keep waiting lists for permanent slips.',
        harbour: 'A small craft harbour owned by Fisheries and Oceans Canada and run by a local harbour authority: public wharves and floats with moorage for fishing and recreational boats.',
      };
      return {
        layer: 'water', kind: kind.label, lon: r[0], lat: r[1], zoom: 13.5,
        title: r[4] ?? `Unnamed ${kind.label.toLowerCase()}`,
        body: `${where(data, r)[0].toUpperCase()}${where(data, r).slice(1)}. ${what[kind.id] ?? ''}${d.aka ? ` OpenStreetMap calls it ${d.aka}.` : ''}${d.access ? ` Access is marked ${d.access}.` : ''}`,
        stats: [
          ...(d.htype ? [{ v: String(d.htype), l: 'DFO harbour type' }] : []),
          ...(d.berths ? [{ v: String(d.berths), l: 'berths' }] : []),
          ...(d.fee ? [{ v: String(d.fee), l: 'fee' }] : []),
        ],
        sections: [
          ...(facts ? [{ title: 'What the map says', text: facts }] : []),
          ...(d.note ? [{ title: 'Description', text: String(d.note) }] : []),
          ...(d.by ? [{ title: 'Harbour authority', text: String(d.by) }] : []),
        ],
        sources: [
          ...(web ? [{ label: 'Website', url: web }] : []),
          ...(by ? [{ label: 'DFO harbour authority listing', url: by }] : []),
          ...(osm ? [osm] : []),
        ],
        layers: ['water'],
      };
    },
    panel(el, _hidden, chips) {
      const T = W!.towns;
      const rows = data.munis.flatMap((m) => (T[m.key] ? [{ m, t: T[m.key] }] : []));
      rows.sort((a, b) => (a.t.launch?.[1] ?? 99) - (b.t.launch?.[1] ?? 99));
      const max = Math.max(1, ...rows.map((r) => Math.min(30, r.t.launch?.[1] ?? 30)));
      const close = rows.filter((r) => r.t.launch && r.t.launch[1] <= 5).length;
      el.innerHTML = `<div class="kicker" style="--c:${WATER_COLOR}">Water access · beaches, boat launches and moorage today</div>
        <h2>Where can you get on the water?</h2>
        <p class="lede">Every <b>beach</b>, named <b>beach access</b>, <b>boat launch</b> and <b>marina</b> mapped in OpenStreetMap on Vancouver Island and the shortlisted islands, with the <b>public harbours</b> Fisheries and Oceans Canada owns. Sand dots are sea beaches, green dots lake and river beaches; ▲ boat launches, ◆ marinas, ■ public harbours.</p>
        <div class="hero">
          <div class="stat"><div class="v">${fmt.int(count('beach', 'lake'))}</div><div class="l">beaches (${fmt.int(count('lake'))} on lakes and rivers)</div></div>
          <div class="stat"><div class="v">${fmt.int(count('launch'))}</div><div class="l">public boat launches</div></div>
          <div class="stat"><div class="v">${fmt.int(count('marina', 'harbour'))}</div><div class="l">marinas and public harbours</div></div>
          <div class="stat"><div class="v">${close} of ${rows.length}</div><div class="l">towns with a launch within 5 km</div></div>
        </div>
        ${chips}
        <h3>Towns by nearest boat launch</h3>
        <ol class="rank-list">${rows.map((r, i) => {
          const L = r.t.launch, b = r.t.beach, mo = r.t.moor;
          const sub = [b ? `beach ${kmText(b[1])}` : 'no sea beach mapped', mo ? `moorage ${kmText(mo[1])}` : 'no moorage'].join(' · ');
          return `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${L ? esc(W!.rows[L[0]][4] ?? 'unnamed launch') + ' · ' : ''}${sub}</span></span><span><div class="bar"><i style="width:${Math.round((Math.min(30, L?.[1] ?? 30) / max) * 100)}%;background:${WATER_STYLE.launch.c}"></i></div><div class="bar-v">${L ? kmText(L[1]) : '—'}</div></span></li>`;
        }).join('')}</ol>
        <p class="note">Distances are straight lines from the town centre; a town on one of the small islands only counts what is on its own island. OpenStreetMap is volunteer-mapped: beaches and launches are well covered, but only beach accesses someone has named “Beach Access” are here, and private ramps and docks are left out. Lake beaches are told apart from sea beaches by distance from the coast, so a few on lagoons may be sorted wrongly. Launch fees, tide limits and trailer parking vary: check locally.</p>
        <div class="source">Source: ${esc(W!.source)}. Built ${esc(W!.asOf)}.</div>`;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// camping

export function campingLayer(data: Data): AtlasLayer {
  const C = data.camping;
  const count = (...ids: string[]) => (C?.rows ?? []).filter((r) => ids.includes(C!.kinds[r[2]].id)).length;
  const lines = (r: OutRow): [string, string][] => {
    const d = r[5] ?? {}, out: [string, string][] = [];
    if (d.park) out.push(['Park', esc(d.park)]);
    if (d.sites) out.push(['Campsites', esc(d.sites)]);
    if (d.fee) out.push(['Fee', esc(d.charge ?? d.fee)]);
    if (d.season) out.push(['Open', esc(d.season)]);
    if (d.back) out.push(['Access', d.back === 2 ? 'paddle-in (BC Marine Trails)' : 'walk-in or backcountry']);
    else if (d.access) out.push(['Access', esc(d.access)]);
    if (d.closed) out.push(['Notice', esc(String(d.closed).slice(0, 80))]);
    out.push(['Where', esc(where(data, r))]);
    return out;
  };
  return pointLayer({
    id: 'camping', name: 'Camping & rec sites', icon: '⛺', color: CAMP_COLOR, period: 'campgrounds and recreation sites today', P: C, styles: CAMP_STYLE, lines,
    describe(r) {
      const d = r[5] ?? {}, kind = C!.kinds[r[2]];
      const web = safeUrl(String(d.web ?? '')), osm = mapsLink(r);
      const amen = [['toilets', yesNo(d.toilets)], ['drinking water', yesNo(d.water)], ['showers', d.shower ? 'yes' : null], ['power hook-ups', d.power ? 'yes' : null], ['RVs', d.rv ? 'yes (RV park)' : null]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
      const what: Record<string, string> = {
        park: `A campground inside ${d.park ?? 'a BC park'} (from OpenStreetMap, placed in the park by BC’s park boundaries). BC Parks campgrounds are booked through BC Parks reservations in summer.`,
        national: `A campground inside ${d.park ?? 'a national park'} (Parks Canada), from OpenStreetMap.`,
        rec: 'A Recreation Sites and Trails BC site: rustic Crown-land camping, usually first-come, often run by a local operator who collects a nightly fee.',
        other: 'A campground outside the parks, from OpenStreetMap: private RV parks and campgrounds, regional and municipal sites, First Nations campgrounds.',
        day: 'A Recreation Sites and Trails BC day-use site (trailhead, beach, lake access or viewpoint) with no camping listed.',
      };
      return {
        layer: 'camping', kind: kind.label, lon: r[0], lat: r[1], zoom: 13,
        title: r[4] ?? `Unnamed ${kind.label.toLowerCase()}`,
        body: `${where(data, r)[0].toUpperCase()}${where(data, r).slice(1)}. ${what[kind.id] ?? ''}${d.back === 2 ? ' A paddle-in site on the BC Marine Trails network.' : d.back ? ' Walk-in or backcountry: no car access to the pitches.' : ''}`,
        stats: [
          { v: d.sites ? String(d.sites) : '–', l: 'campsites' },
          ...(d.fee ? [{ v: String(d.fee), l: 'fee' }] : []),
          ...(d.maint ? [{ v: String(d.maint).replace(/^Maintained to Standard$/, 'Maintained'), l: 'upkeep' }] : []),
          ...(d.since ? [{ v: String(d.since), l: 'established' }] : []),
        ],
        sections: [
          ...(d.closed ? [{ title: 'Closure notice (when the data was built)', text: String(d.closed) }] : []),
          ...(d.desc ? [{ title: 'About the site', text: String(d.desc) }] : []),
          ...(d.note ? [{ title: 'Description', text: String(d.note) }] : []),
          ...(d.acts ? [{ title: 'Activities', text: String(d.acts) }] : []),
          ...(amen ? [{ title: 'Facilities', text: amen }] : []),
          ...(d.season || d.res || d.charge ? [{ title: 'Season and booking', text: [d.season ? `Open: ${d.season}.` : '', d.res ? `Reservations: ${d.res}.` : '', d.charge ? `Charge: ${d.charge}.` : ''].filter(Boolean).join(' ') }] : []),
          ...(d.op ? [{ title: 'Operator', text: String(d.op) }] : []),
        ],
        sources: [
          ...(web ? [{ label: 'Website', url: web }] : []),
          ...(kind.id === 'rec' || kind.id === 'day' ? [{ label: `Recreation Sites and Trails BC (${r[6]})`, url: 'https://www.sitesandtrailsbc.ca/' }] : []),
          ...(osm ? [osm] : []),
        ],
        layers: ['camping'],
      };
    },
    panel(el, _hidden, chips) {
      const T = C!.towns;
      const rows = data.munis.flatMap((m) => (T[m.key] ? [{ m, t: T[m.key], n: T[m.key].n25.reduce((a, b) => a + b, 0) }] : []));
      rows.sort((a, b) => b.n - a.n || (a.t.near?.[1] ?? 99) - (b.t.near?.[1] ?? 99));
      const max = Math.max(1, ...rows.map((r) => r.n));
      const sites = (C!.rows).filter((r) => r[2] === 0 && r[5]?.sites).length;
      el.innerHTML = `<div class="kicker" style="--c:${CAMP_COLOR}">Camping &amp; recreation sites · today</div>
        <h2>Where can you pitch a tent?</h2>
        <p class="lede">Campgrounds on Vancouver Island and the shortlisted islands: <b>BC Parks</b> and <b>national park</b> campgrounds, rustic <b>Recreation Sites and Trails BC</b> sites on Crown land, and <b>private, regional and First Nations</b> campgrounds and RV parks. A hollow △ is walk-in, backcountry or paddle-in; a ring is a day-use recreation site.</p>
        <div class="hero">
          <div class="stat"><div class="v">${fmt.int(count('park', 'national'))}</div><div class="l">park campgrounds (${count('national')} national)</div></div>
          <div class="stat"><div class="v">${fmt.int(count('rec'))}</div><div class="l">recreation sites with camping</div></div>
          <div class="stat"><div class="v">${fmt.int(count('other'))}</div><div class="l">private, regional and other</div></div>
          <div class="stat"><div class="v">${fmt.int(count('day'))}</div><div class="l">day-use recreation sites</div></div>
        </div>
        ${chips}
        <h3>Towns by campgrounds within ${C!.townKm} km</h3>
        <ol class="rank-list">${rows.map((r, i) => {
          const p = r.t.park, nr = r.t.near;
          const sub = [nr ? `nearest ${esc(C!.rows[nr[0]][4] ?? 'campground')} ${kmText(nr[1])}` : 'none on the island', p ? `park ${esc(String(C!.rows[p[0]][5]?.park ?? C!.rows[p[0]][4] ?? ''))} ${kmText(p[1])}` : ''].filter(Boolean).join(' · ');
          return `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${sub}</span></span><span><div class="bar"><i style="width:${Math.round((r.n / max) * 100)}%;background:${CAMP_COLOR}"></i></div><div class="bar-v">${r.n}</div></span></li>`;
        }).join('')}</ol>
        <p class="note">BC Parks doesn’t publish its campgrounds as open data, so park campgrounds are the ones mapped in OpenStreetMap, placed in a park by BC’s park boundaries; big parks may show a campground and its group sites separately. Campsite counts, fees and seasons appear only where the source has them (${sites} of the park campgrounds list a count). Recreation site closure notices are as of ${esc(C!.asOf)}. Distances are straight lines; a town on a small island only counts its own island.</p>
        <div class="source">Source: ${esc(C!.source)}. Built ${esc(C!.asOf)}.</div>`;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Town Report rows

const nameOf = (P: Water | Camping, n: [number, number]) => { const r = P.rows[n[0]]; return r[4] ?? `unnamed ${P.kinds[r[2]].label.toLowerCase()}`; };

export function waterTownRow(data: Data, key: string, metric: Metric) {
  const W = data.water, t = W?.towns[key];
  if (!W || !t) return '';
  const na = '<span style="color:var(--ink-3)">none</span>';
  const one = (n: [number, number] | null, what: string) => (n ? `${esc(nameOf(W, n))}${W.rows[n[0]][5]?.htype ? ' (DFO)' : ''}` : `no ${what} on the island`);
  return `<h3>Water access</h3>
    <div class="metric-grid">
      ${metric('Beach', WATER_STYLE.beach.c, t.beach ? kmText(t.beach[1]) : na, `${one(t.beach, 'sea beach')}${t.lake ? ` · lake beach ${kmText(t.lake[1])}` : ''}`)}
      ${metric('Boat launch', WATER_STYLE.launch.c, t.launch ? kmText(t.launch[1]) : na, one(t.launch, 'public launch'))}
      ${metric('Moorage', WATER_STYLE.marina.c, t.moor ? kmText(t.moor[1]) : na, one(t.moor, 'marina or public harbour'))}
      ${metric(`Within ${W.townKm} km`, WATER_COLOR, `${t.n10[0]} · ${t.n10[1]} · ${t.n10[2]}`, 'beaches · launches · marinas and harbours')}
    </div>
    <button class="tr-fall" data-layer="water" style="margin-top:8px">⚓ Beaches, launches and moorage on the map ›</button>`;
}

export function campingTownRow(data: Data, key: string, metric: Metric) {
  const C = data.camping, t = C?.towns[key];
  if (!C || !t) return '';
  const na = '<span style="color:var(--ink-3)">none</span>';
  const [park, nat, rec, other] = t.n25;
  return `<h3>Camping nearby</h3>
    <div class="metric-grid">
      ${metric('Nearest campground', CAMP_COLOR, t.near ? kmText(t.near[1]) : na, t.near ? `${esc(nameOf(C, t.near))} · ${esc(C.kinds[C.rows[t.near[0]][2]].label.toLowerCase())}` : 'none on the island')}
      ${metric('Park campground', CAMP_STYLE.park.c, t.park ? kmText(t.park[1]) : na, t.park ? esc(String(C.rows[t.park[0]][5]?.park ?? nameOf(C, t.park))) : 'no BC or national park campground on the island')}
      ${metric(`Within ${C.townKm} km`, CAMP_STYLE.rec.c, String(park + nat + rec + other), `${park + nat} in parks · ${rec} rec sites · ${other} other`)}
    </div>
    <button class="tr-fall" data-layer="camping" style="margin-top:8px">⛺ Campgrounds and recreation sites on the map ›</button>`;
}

// ---------------------------------------------------------------------------------------------
// Land Finder: straight-line km from a parcel to the nearest point of some kinds, on the parcel's own island

/**
 * For each parcel: km to the nearest point of the given kinds and its row index (NaN / -1 where there's none on
 * the parcel's island). `isle` is the parcel's island name ('Vancouver Island' also takes the "Other" points).
 */
export function nearestFor(P: Water | Camping, ids: string[], lon: Float32Array, lat: Float32Array, isle: (i: number) => string) {
  const n = lon.length;
  const dist = new Float32Array(n).fill(NaN), idx = new Int32Array(n).fill(-1);
  const kinds = new Set(ids.map((id) => P.kinds.findIndex((k) => k.id === id)));
  const other = P.islands.length - 1;
  const pts = P.rows.map((r, i) => ({ r, i })).filter(({ r }) => kinds.has(r[2]));
  const byIsle = new Map<number, typeof pts>();
  for (const p of pts) { const k = p.r[3] === other ? 0 : p.r[3]; if (!byIsle.has(k)) byIsle.set(k, []); byIsle.get(k)!.push(p); }
  const kx = 111.32 * Math.cos((49.5 * Math.PI) / 180), ky = 110.54;
  for (let i = 0; i < n; i++) {
    const k = P.islands.indexOf(isle(i));
    const cand = byIsle.get(k < 0 ? 0 : k) ?? [];
    let bd = Infinity, bi = -1;
    for (const { r, i: j } of cand) { const d = Math.hypot((r[0] - lon[i]) * kx, (r[1] - lat[i]) * ky); if (d < bd) { bd = d; bi = j; } }
    if (bi >= 0) { dist[i] = Math.round(bd * 10) / 10; idx[i] = bi; }
  }
  return { dist, idx };
}
export { kmText as outKm, nameOf as outName };
