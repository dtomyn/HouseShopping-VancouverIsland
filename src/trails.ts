// Trails & waterfalls: the island's whole footpath network as a living web of light (with hikers
// travelling every path), the named hiking routes with elevation profiles, and every mapped waterfall
// as a beam of falling water. A route can be flown in 3D over the real terrain, a waterfall orbited,
// and the photographed falls toured one after another. Data from scripts/trails.mjs.
import * as d3 from 'd3';
import * as maplibregl from 'maplibre-gl';
import { ColumnLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, TrailNet, TrailRoute, Trails, Waterfall, fmt, km, loadTrailNet } from './data';
import type { AtlasLayer, PanelHandle } from './layers';
import { esc, safeUrl } from './html';

type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };
const ADDITIVE = { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false } as const;
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;

export const TRAIL_COLOR = '#34d399';
const FALL_COLOR = '#8be3ff';
const LEVEL = { 1: { name: 'Easy', c: '#6ee7b7' }, 2: { name: 'Moderate', c: '#fcd34d' }, 3: { name: 'Hard', c: '#fb7185' } } as const;
const SAC_NAME = ['', 'hiking trail', 'mountain hiking', 'demanding / alpine'];
const photo = (file: string, w = 640) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${w}`;
const commonsPage = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`;
/** An OSM/Wikidata "lang:Title" tag as a Wikipedia link, or null when the language code isn't one. */
const wikiUrl = (w: string) => { const [lang, ...t] = w.split(':'); return /^[a-z]{2,3}(-[a-z]+)*$/i.test(lang) && t.length ? `https://${lang.toLowerCase()}.wikipedia.org/wiki/${encodeURIComponent(t.join(':').replace(/ /g, '_'))}` : null; };
/** The page for a fall: its OpenStreetMap node/way, or its Wikidata item when only Wikidata maps it. */
const fallPage = (f: Waterfall) => (f.osm.startsWith('wikidata/') ? { url: `https://www.wikidata.org/wiki/${encodeURIComponent(f.osm.slice(9))}`, label: 'Wikidata' } : { url: `https://www.openstreetmap.org/${f.osm.split('/').map(encodeURIComponent).join('/')}`, label: 'OpenStreetMap' });
const fallName = (f: Waterfall) => f.name ?? 'Unnamed waterfall';
/** Falls with a photo, one per photo (a fall mapped twice can share one). */
const photographed = (falls: Waterfall[]) => { const seen = new Set<string>(); return falls.filter((f) => f.img && !seen.has(f.img) && !!seen.add(f.img)); };
const hrsText = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 10 ? `${h.toFixed(1).replace(/\.0$/, '')} h` : `${Math.round(h / 7)}–${Math.ceil(h / 6)} days`);

// ---------------------------------------------------------------------------------------------
// geometry along a route's ordered line

type Geo = { cum: number[]; total: number; fallsAt: { i: number; d: number }[] };
const geoCache = new Map<TrailRoute, Geo>();
const kx = Math.cos((49.5 * Math.PI) / 180) * 111.32, ky = 110.54;
function geoOf(r: TrailRoute, falls: Waterfall[]): Geo {
  let g = geoCache.get(r);
  if (g) return g;
  const cum = [0];
  for (let i = 1; i < r.line.length; i++) cum.push(cum[i - 1] + Math.hypot((r.line[i][0] - r.line[i - 1][0]) * kx, (r.line[i][1] - r.line[i - 1][1]) * ky));
  const total = cum[cum.length - 1] || 1;
  const fallsAt = r.falls.map((i) => {
    const f = falls[i];
    let best = 0, bd = Infinity;
    r.line.forEach((p, k) => { const d = Math.hypot((p[0] - f.lon) * kx, (p[1] - f.lat) * ky); if (d < bd) { bd = d; best = k; } });
    return { i, d: cum[best] };
  });
  g = { cum, total, fallsAt };
  geoCache.set(r, g);
  return g;
}
function along(r: TrailRoute, g: Geo, d: number): [number, number] {
  d = Math.max(0, Math.min(g.total, d));
  let lo = 1, hi = g.cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (g.cum[m] < d) lo = m + 1; else hi = m; }
  const a = r.line[lo - 1], b = r.line[lo];
  const f = (d - g.cum[lo - 1]) / (g.cum[lo] - g.cum[lo - 1] || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
const elevAt = (r: TrailRoute, g: Geo, d: number) => {
  const x = (Math.max(0, Math.min(g.total, d)) / g.total) * (r.prof.length - 1);
  const i = Math.floor(x), f = x - i;
  return r.prof[i] + ((r.prof[Math.min(r.prof.length - 1, i + 1)] ?? r.prof[i]) - r.prof[i]) * f;
};
const bearingOf = (a: [number, number], b: [number, number]) => (Math.atan2((b[0] - a[0]) * kx, (b[1] - a[1]) * ky) * 180) / Math.PI;
const lerpAngle = (a: number, b: number, k: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * k;
function boundsOf(pts: [number, number][]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of pts) { w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}

// ---------------------------------------------------------------------------------------------
// the footpath network, decoded on first use

type NetPath = { path: [number, number][]; name: number; sac: number };
type FlowPath = { path: [number, number][]; ts: number[] };
let net: { paths: NetPath[]; flow: FlowPath[]; names: string[] } | null = null;
let netState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
const FLOW_PERIOD = 4200; // metres of "hiking" per loop
function decodeNet(j: TrailNet) {
  const paths: NetPath[] = [];
  const flow: FlowPath[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const w of j.ways) {
    const path: [number, number][] = [];
    let x = 0, y = 0;
    for (let k = 2; k < w.length; k += 2) { x += w[k]; y += w[k + 1]; path.push([j.west + x / j.q, j.south + y / j.q]); }
    if (path.length < 2) continue;
    paths.push({ path, name: w[0], sac: w[1] });
    // timestamps in metres along the path, chunked so each piece fits inside one loop
    let piece: [number, number][] = [path[0]], ts = [0], run = 0;
    const flush = () => { if (piece.length > 1) { const off = rand() * Math.max(0, FLOW_PERIOD - run); flow.push({ path: piece, ts: ts.map((t) => t + off) }); } };
    for (let k = 1; k < path.length; k++) {
      run += Math.hypot((path[k][0] - path[k - 1][0]) * kx, (path[k][1] - path[k - 1][1]) * ky) * 1000;
      piece.push(path[k]); ts.push(run);
      if (run > FLOW_PERIOD * 0.7) { flush(); piece = [path[k]]; ts = [0]; run = 0; }
    }
    flush();
  }
  return { paths, flow, names: j.names };
}

// ---------------------------------------------------------------------------------------------
// module state

type View = { kind: 'overview' } | { kind: 'route'; i: number } | { kind: 'fall'; i: number };
let T: Trails | null = null;
let view: View = { kind: 'overview' };
let levels = new Set<number>([1, 2, 3]);
let sortBy: 'featured' | 'long' | 'climb' | 'falls' = 'featured';
let showAll = false;
let hoverRoute: number | null = null;
let hoverD: number | null = null; // km along the open route under the profile cursor
let panelEl: HTMLElement | null = null;
let panelChart: { setPlayhead: (d: number | null) => void } | null = null;
let host: { map: maplibregl.Map; openTown: (key: string) => void; setCinema: (on: boolean) => void } | null = null;

/** Set once the map exists. */
export function bindTrails(h: typeof host) { host = h; }
/** True while the camera is flying a route or touring falls over 3D terrain: deck.gl layers stand down. */
export const trailsCinema = () => !!flight || !!tour || !!orbit;
/** Open a route or a waterfall in the trails panel (the caller focuses the layer). */
export function setTrailView(v: View) { view = v; }

// ---------------------------------------------------------------------------------------------
// the layer

export function trailsLayer(data: Data): AtlasLayer {
  T = data.trails;
  const routes = T?.routes ?? [];
  const falls = T?.falls ?? [];
  const named = falls.filter((f) => f.name);
  // waterfalls drawn as beams: the named ones, and any with a measured drop
  const beams = falls.filter((f) => f.name || f.h);
  let beamScale = 1;
  const beamTop = (f: Waterfall) => (600 + Math.sqrt(f.h ?? 10) * 900) * beamScale;
  const notable = beams.slice(0, 70);
  const routeColor = (r: TrailRoute) => LEVEL[r.level].c;

  const l: AtlasLayer = {
    id: 'trails',
    name: 'Trails & waterfalls',
    icon: '⛰',
    color: TRAIL_COLOR,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'mapped today',
    available: !!T,
    unavailable: 'The OpenStreetMap trail and waterfall data could not be downloaded when this copy of the data was built. Run <code>npm run data trails</code>, then reload.',
    build({ clock, focusedId }) {
      if (!T) return [];
      const focused = focusedId === 'trails';
      if (netState === 'idle') {
        netState = 'loading';
        loadTrailNet().then((j) => { if (j) { net = decodeNet(j); netState = 'ready'; } else netState = 'failed'; });
      }
      const out: Layer[] = [];
      const sel = view.kind === 'route' ? view.i : null;
      const dim = sel != null || hoverRoute != null;

      if (net) {
        out.push(
          new PathLayer<NetPath>({
            id: 'trails-net-base',
            data: net.paths,
            getPath: (p) => p.path,
            getColor: (p) => (p.sac >= 2 ? [252, 211, 77, 70] : [52, 211, 153, p.name >= 0 ? 85 : 55]),
            getWidth: 1,
            widthUnits: 'pixels',
            widthMinPixels: 0.8,
            pickable: focused,
            parameters: ADDITIVE,
          } as any),
          new TripsLayer<FlowPath>({
            id: 'trails-net-flow',
            data: net.flow,
            getPath: (p) => p.path,
            getTimestamps: (p) => p.ts,
            getColor: [190, 255, 225],
            currentTime: (clock * 0.32) % FLOW_PERIOD,
            trailLength: 260,
            fadeTrail: true,
            widthMinPixels: 1.8,
            capRounded: true,
            jointRounded: true,
            opacity: dim ? 0.35 : 0.8,
            parameters: ADDITIVE,
          } as any),
        );
      }

      const shown = routes.map((r, i) => ({ r, i })).filter((x) => levels.has(x.r.level));
      const parts = shown.flatMap(({ r, i }) => r.parts.map((p) => ({ p, r, i })));
      const isHot = (i: number) => i === sel || i === hoverRoute;
      out.push(
        new PathLayer<any>({
          id: 'trails-routes-glow',
          data: parts,
          getPath: (d) => d.p,
          getColor: (d) => rgb(isHot(d.i) ? '#ffffff' : routeColor(d.r), isHot(d.i) ? 90 : dim ? 18 : 46),
          getWidth: (d) => (isHot(d.i) ? 16 : 9),
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          updateTriggers: { getColor: [sel, hoverRoute], getWidth: [sel, hoverRoute] },
          parameters: ADDITIVE,
        } as any),
        new PathLayer<any>({
          id: 'trails-routes',
          data: parts,
          getPath: (d) => d.p,
          getColor: (d) => rgb(isHot(d.i) ? '#ffffff' : routeColor(d.r), isHot(d.i) ? 255 : dim ? 90 : 230),
          getWidth: (d) => (isHot(d.i) ? 3.6 : 2.2),
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          pickable: true,
          updateTriggers: { getColor: [sel, hoverRoute], getWidth: [sel, hoverRoute] },
          parameters: NO_DEPTH,
        } as any),
      );

      // the open route carries a train of light along its line
      if (sel != null) {
        const r = routes[sel], g = geoOf(r, falls);
        const n = Math.max(3, Math.min(14, Math.round(g.total / 2.5)));
        const loop = Math.max(6, g.total);
        const cum = g.cum;
        out.push(
          new TripsLayer<any>({
            id: 'trails-sel-flow',
            data: Array.from({ length: n }, (_, k) => ({ off: (k * loop) / n })),
            getPath: () => r.line,
            getTimestamps: (d: any) => cum.map((c) => c + d.off),
            getColor: [255, 255, 255],
            currentTime: ((clock / 1000) * Math.max(0.4, g.total / 16)) % loop + loop * 0.999,
            trailLength: Math.max(0.3, g.total / 24),
            fadeTrail: true,
            widthMinPixels: 4,
            capRounded: true,
            parameters: ADDITIVE,
            updateTriggers: { getTimestamps: sel },
          } as any),
        );
        // repeat the train past the end of the line so it loops seamlessly
        out.push(
          new TripsLayer<any>({
            id: 'trails-sel-flow2',
            data: Array.from({ length: n }, (_, k) => ({ off: (k * loop) / n })),
            getPath: () => r.line,
            getTimestamps: (d: any) => cum.map((c) => c + d.off + loop),
            getColor: [255, 255, 255],
            currentTime: ((clock / 1000) * Math.max(0.4, g.total / 16)) % loop + loop * 0.999,
            trailLength: Math.max(0.3, g.total / 24),
            fadeTrail: true,
            widthMinPixels: 4,
            capRounded: true,
            parameters: ADDITIVE,
            updateTriggers: { getTimestamps: sel },
          } as any),
        );
        if (hoverD != null) {
          const p = along(r, g, hoverD);
          out.push(new ScatterplotLayer<any>({
            id: 'trails-cursor',
            data: [p],
            getPosition: (d) => d,
            getRadius: 7,
            radiusUnits: 'pixels',
            getFillColor: [255, 255, 255, 255],
            stroked: true,
            getLineColor: rgb(TRAIL_COLOR),
            lineWidthMinPixels: 3,
            parameters: NO_DEPTH,
          } as any));
        }
        // trailheads
        out.push(new ScatterplotLayer<any>({
          id: 'trails-ends',
          data: r.loop ? [r.line[0]] : [r.line[0], r.line[r.line.length - 1]],
          getPosition: (d) => d,
          getRadius: 6,
          radiusUnits: 'pixels',
          getFillColor: [6, 10, 18, 255],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2.5,
          parameters: NO_DEPTH,
        } as any));
      }

      // waterfalls: a beam for each, water falling down it, mist rippling at the foot
      const fsel = view.kind === 'fall' ? falls[view.i] : null;
      // beams shrink as you zoom in so a tall fall doesn't swallow the valley it's in
      const zs = Math.max(0.07, Math.min(1, 2 ** (8.6 - (host?.map.getZoom() ?? 8))));
      beamScale = Math.round(zs * 50) / 50;
      out.push(
        new ColumnLayer<Waterfall>({
          id: 'trails-falls-beam',
          data: beams,
          getPosition: (f) => [f.lon, f.lat],
          radius: 150,
          diskResolution: 10,
          extruded: true,
          getElevation: (f) => beamTop(f),
          getFillColor: (f) => (f === fsel ? [255, 255, 255, 150] : rgb(FALL_COLOR, f.h ? 85 : 50)),
          material: { ambient: 1, diffuse: 0.2, shininess: 0 },
          updateTriggers: { getFillColor: fsel, getElevation: beamScale },
          parameters: ADDITIVE,
        } as any),
      );
      const ph = clock / 1600;
      const drops = notable.flatMap((f) => Array.from({ length: 9 }, (_, k) => ({ f, q: (ph * (0.8 + (f.h ?? 10) / 300) + k / 9) % 1 })));
      out.push(
        new ScatterplotLayer<any>({
          id: 'trails-falls-drops',
          data: drops,
          getPosition: (d) => [d.f.lon, d.f.lat, beamTop(d.f) * (1 - d.q * d.q)],
          getRadius: 120,
          radiusMinPixels: 1.2,
          radiusMaxPixels: 3,
          getFillColor: (d) => [220, 248, 255, 255 * Math.sin(Math.PI * d.q)],
          billboard: true,
          updateTriggers: { getPosition: ph, getFillColor: ph },
          parameters: ADDITIVE,
        } as any),
        new ScatterplotLayer<any>({
          id: 'trails-falls-mist',
          data: notable.slice(0, 40).flatMap((f) => [0, 0.5].map((o) => ({ f, q: (clock / 2600 + o + (f.lon * 13) % 1) % 1 }))),
          getPosition: (d) => [d.f.lon, d.f.lat],
          getRadius: (d) => 300 + d.q * 2600,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1.2,
          getLineColor: (d) => rgb(FALL_COLOR, 160 * (1 - d.q)),
          updateTriggers: { getRadius: clock, getLineColor: clock },
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<Waterfall>({
          id: 'trails-falls-dots',
          data: falls,
          getPosition: (f) => [f.lon, f.lat],
          getRadius: (f) => (f.name ? 420 : 260),
          radiusMinPixels: (2.5),
          radiusMaxPixels: 9,
          getFillColor: (f) => (f === fsel ? [255, 255, 255, 255] : f.name ? [225, 248, 255, 250] : [139, 227, 255, 150]),
          stroked: true,
          getLineColor: rgb('#0b6e99', 255),
          lineWidthMinPixels: 1,
          pickable: true,
          updateTriggers: { getFillColor: fsel },
          parameters: NO_DEPTH,
        } as any),
        new TextLayer<Waterfall>({
          id: 'trails-falls-labels',
          data: focused ? named.slice(0, fsel ? 0 : 16).concat(fsel ? [fsel] : []) : [],
          getPosition: (f) => [f.lon, f.lat, beamTop(f)],
          getText: (f) => `${fallName(f)}${f.h ? ` · ${Math.round(f.h)} m` : ''}`,
          getSize: (f) => (f === fsel ? 15 : 11.5),
          updateTriggers: { getPosition: beamScale, getSize: fsel },
          getColor: [225, 248, 255, 255],
          getPixelOffset: [0, -8],
          getAlignmentBaseline: 'bottom',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 600,
          characterSet: 'auto',
          outlineWidth: 3,
          outlineColor: [6, 10, 18, 230],
          fontSettings: { sdf: true },
          parameters: { depthCompare: 'always' },
        } as any),
      );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      panelEl = el;
      renderPanel(el, data);
      return { update() {} } as PanelHandle;
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      const o: any = info.object;
      if (!o) return null;
      if (id === 'trails-routes') {
        const r = o.r as TrailRoute;
        return `<b>${esc(r.name)}</b><br><span class="tk">${LEVEL[r.level].name}</span> <span class="tv">${r.km} km · ↑${fmt.int(r.up)} m</span><br><span class="tk">about ${hrsText(r.hrs)}${r.loop ? ', loop' : ' one way'}${r.falls.length ? ` · ${r.falls.length} waterfall${r.falls.length > 1 ? 's' : ''}` : ''}</span><br><span class="tk">Click for the profile and the 3D flight</span>`;
      }
      if (id === 'trails-falls-dots') {
        const f = o as Waterfall;
        return `<b>${esc(fallName(f))}</b>${f.h ? `<br><span class="tk">Drop</span> <span class="tv">${Math.round(f.h)} m</span>` : ''}<br><span class="tk">${fmt.int(f.elev)} m above sea level${f.path != null && f.path < 2000 ? ` · ${f.path < 60 ? 'on a mapped trail' : `${fmt.int(f.path)} m from a trail`}` : ' · off-trail'}</span>${f.img ? '<br><span class="tk">📷 photo · click to open</span>' : '<br><span class="tk">Click for details</span>'}`;
      }
      if (id === 'trails-net-base' && net) {
        const p = o as NetPath;
        return `<b>${p.name >= 0 ? esc(net.names[p.name]) : 'Footpath'}</b>${p.sac ? `<br><span class="tk">${SAC_NAME[p.sac]}</span>` : ''}`;
      }
      return null;
    },
  };
  l.click = (info: PickingInfo) => {
    const id = info.layer?.id ?? '';
    const o: any = info.object;
    if (!o) return false;
    if (id === 'trails-routes') { go({ kind: 'route', i: o.i }, data); return true; }
    if (id === 'trails-falls-dots') { go({ kind: 'fall', i: falls.indexOf(o) }, data); return true; }
    return false;
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// panels

function go(v: View, data: Data, fly = true) {
  view = v;
  hoverD = null;
  if (fly && host) {
    const m = host.map;
    if (v.kind === 'route') {
      const r = T!.routes[v.i];
      m.fitBounds(boundsOf(r.parts.flat()), { padding: { top: 90, bottom: 150, left: 60, right: document.body.classList.contains('no-panel') ? 60 : 440 }, pitch: 50, bearing: m.getBearing(), duration: 1800, maxZoom: 13.5, essential: true });
    } else if (v.kind === 'fall') {
      const f = T!.falls[v.i];
      m.flyTo({ center: [f.lon, f.lat], zoom: Math.max(m.getZoom(), 12.2), pitch: 60, duration: 1800, essential: true });
    }
  }
  if (!panelEl) return;
  const p = panelEl;
  p.classList.add('swap');
  setTimeout(() => { p.scrollTop = 0; renderPanel(p, data); p.classList.remove('swap'); }, 160);
}

function renderPanel(el: HTMLElement, data: Data) {
  panelChart = null;
  if (!T) {
    el.innerHTML = `<div class="kicker" style="--c:${TRAIL_COLOR}">Trails &amp; waterfalls</div><h2>Trails and waterfalls</h2><div class="unavail">The OpenStreetMap trail and waterfall data could not be downloaded when this copy of the data was built. Run <code>npm run data trails</code>, then reload.</div>`;
    return;
  }
  if (view.kind === 'route') return renderRoute(el, data, view.i);
  if (view.kind === 'fall') return renderFall(el, data, view.i);
  renderOverview(el, data);
}

/** A small inline elevation silhouette, scaled to a shared relief so flat walks look flat. */
function miniProfile(r: TrailRoute, w = 92, h = 26) {
  const relief = Math.max(r.hi - r.lo, 1);
  const scale = Math.min(1, relief / 900);
  const pts = r.prof.filter((_, i) => i % Math.max(1, Math.floor(r.prof.length / 46)) === 0);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => h - 2 - ((v - r.lo) / relief) * (h - 4) * Math.max(0.12, scale);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return `<svg class="tr-mini" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="--c:${LEVEL[r.level].c}"><path class="a" d="${line}L${w},${h}L0,${h}Z"/><path class="l" d="${line}"/></svg>`;
}

function townScores(data: Data) {
  const rows = data.munis.flatMap((m) => { const t = T!.towns[m.key]; return t ? [{ m, t }] : []; });
  const rk = (vals: number[]) => { const s = [...vals].sort((a, b) => a - b); return (v: number) => s.findIndex((x) => x >= v) / Math.max(1, s.length - 1); };
  const a = rk(rows.map((r) => r.t.km10)), b = rk(rows.map((r) => r.t.named30)), c = rk(rows.map((r) => r.t.routes.length));
  return rows.map((r) => ({ ...r, s: 0.45 * a(r.t.km10) + 0.35 * b(r.t.named30) + 0.2 * c(r.t.routes.length) })).sort((x, y) => y.s - x.s);
}

function renderOverview(el: HTMLElement, data: Data) {
  const routes = T!.routes, falls = T!.falls;
  const named = falls.filter((f) => f.name).length;
  const tallest = falls.filter((f) => f.h).sort((a, b) => b.h! - a.h!)[0];
  const photos = photographed(falls);
  const famous = (r: TrailRoute) => ({ iwn: 4, nwn: 3, rwn: 2, lwn: 1 } as Record<string, number>)[r.net ?? ''] ?? 0;
  const order = routes.map((r, i) => ({ r, i })).filter((x) => levels.has(x.r.level));
  const key = {
    featured: (x: { r: TrailRoute }) => -(famous(x.r) * 40 + Math.log1p(x.r.km) * 10 + x.r.falls.length * 6 + Math.log1p(x.r.up) * 2),
    long: (x: { r: TrailRoute }) => -x.r.km,
    climb: (x: { r: TrailRoute }) => -x.r.up,
    falls: (x: { r: TrailRoute }) => -(x.r.falls.length * 1000 + x.r.km),
  }[sortBy];
  order.sort((a, b) => key(a) - key(b));
  const list = showAll ? order : order.slice(0, 18);
  const towns = townScores(data).slice(0, 8);
  const longest = [...routes].sort((a, b) => b.km - a.km)[0];

  el.innerHTML = `
    <div class="kicker" style="--c:${TRAIL_COLOR}">Trails &amp; waterfalls · OpenStreetMap, mapped today</div>
    <h2>Where the island goes walking</h2>
    <p class="lede">Every footpath mapped on the island glows, with a spark for each hiker on the move. <b>Bright lines</b> are the ${routes.length} named hiking routes, coloured by effort; the <b>beams of light</b> are waterfalls, as tall as their drop where it’s been measured. Click any route for its elevation profile and a <b>3D flight</b> along it, or any waterfall to orbit it.</p>
    <div class="hero">
      <div class="stat"><div class="v">${fmt.int(T!.netKm)}</div><div class="l">km of mapped footpath</div></div>
      <div class="stat"><div class="v">${routes.length}</div><div class="l">named hiking routes</div></div>
      <div class="stat"><div class="v">${fmt.int(falls.length)}</div><div class="l">waterfalls (${named} named)</div></div>
      <div class="stat"><div class="v">${tallest ? `${Math.round(tallest.h!)} m` : '–'}</div><div class="l">${tallest ? `tallest: ${esc(fallName(tallest))}` : ''}</div></div>
    </div>
    <div class="tr-cta">
      ${photos.length >= 3 ? `<button class="tr-big" data-act="tour"><span class="tr-big-ic">▶</span><span><b>Waterfall tour</b><br><small>Fly to ${Math.min(photos.length, 12)} photographed falls in 3D</small></span></button>` : ''}
      ${longest ? `<button class="tr-big alt" data-act="fly-longest"><span class="tr-big-ic">✈</span><span><b>Fly ${esc(longest.name)}</b><br><small>${longest.km} km over the real terrain</small></span></button>` : ''}
    </div>
    <h3>Hiking routes</h3>
    <div class="chip-row"><span class="chip-k">Effort</span><div class="chips">${([1, 2, 3] as const).map((k) => `<button class="chip${levels.has(k) ? ' on' : ''}" data-level="${k}" style="--c:${LEVEL[k].c}">${LEVEL[k].name} · ${routes.filter((r) => r.level === k).length}</button>`).join('')}</div></div>
    <div class="chip-row"><span class="chip-k">Sort</span><div class="chips">${(['featured', 'long', 'climb', 'falls'] as const).map((k) => `<button class="chip${sortBy === k ? ' on' : ''}" data-sort="${k}" style="--c:${TRAIL_COLOR}">${{ featured: 'Featured', long: 'Longest', climb: 'Most climbing', falls: 'Waterfalls' }[k]}</button>`).join('')}</div></div>
    <ol class="tr-routes">${list.map(({ r, i }) => `<li data-route="${i}" style="--c:${LEVEL[r.level].c}"><span class="tr-lv"></span><span class="tr-nm"><b>${esc(r.name)}</b><small>${r.km} km · ↑${fmt.int(r.up)} m · ${hrsText(r.hrs)}${r.loop ? ' · loop' : ''}${r.falls.length ? ` · <span class="tr-fc">💧${r.falls.length}</span>` : ''}</small></span>${miniProfile(r)}</li>`).join('')}</ol>
    ${order.length > 18 ? `<button class="chip tr-more" data-act="more">${showAll ? 'Show fewer' : `Show all ${order.length} routes`}</button>` : ''}
    ${photos.length ? `<h3>Waterfalls with photos</h3><div class="tr-gallery">${photos.slice(0, 12).map((f) => `<button class="tr-ph" data-fall="${falls.indexOf(f)}"><img loading="lazy" alt="" src="${photo(f.img!, 360)}"><span><b>${esc(fallName(f))}</b>${f.h ? `<small>${Math.round(f.h)} m drop</small>` : ''}</span></button>`).join('')}</div>` : ''}
    <h3>More named waterfalls</h3>
    <div class="tr-falls">${falls.filter((f) => f.name && !photos.slice(0, 12).includes(f)).slice(0, 40).map((f) => `<button class="tr-fall" data-fall="${falls.indexOf(f)}"><span class="tr-drop"></span>${esc(f.name!)}${f.h ? ` <small>${Math.round(f.h)} m</small>` : ''}</button>`).join('')}</div>
    <h3>Towns closest to the outdoors</h3>
    <ol class="rank-list">${towns.map((x, k) => `<li data-town="${esc(x.m.key)}"><span class="rk">${k + 1}</span><span><span class="nm">${esc(x.m.name)}</span><br><span class="rd">${fmt.int(x.t.km10)} km of path within 10 km · ${x.t.named30} named falls within 30 km</span></span><span><div class="bar"><i style="width:${Math.round(x.s * 100)}%;background:${TRAIL_COLOR}"></i></div><div class="bar-v">${Math.round(x.s * 100)}</div></span></li>`).join('')}</ol>
    <div class="legend"><span><i class="sw" style="background:${LEVEL[1].c}"></i>easy</span><span><i class="sw" style="background:${LEVEL[2].c}"></i>moderate</span><span><i class="sw" style="background:${LEVEL[3].c}"></i>hard</span><span><i class="sw" style="background:${FALL_COLOR}"></i>waterfall</span><span><i class="sw" style="background:#fcd34d;opacity:.6"></i>alpine path</span></div>
    <p class="note">Effort is estimated from length and climbing (Naismith’s rule: 4.5 km an hour plus an hour for every 600 m up), one way unless it’s a loop. Climbing is worked out from ~50 m terrain tiles, so short steep pitches are smoothed out. OpenStreetMap is mapped by volunteers: trails can be closed, overgrown, on private land or seasonal. Check BC Parks, Recreation Sites and Trails BC or the local trail society before you go.</p>
    <div class="source">Source: ${T!.source}.${netState === 'failed' ? ' The full path network could not be loaded.' : ''}</div>`;

  el.querySelectorAll<HTMLElement>('[data-level]').forEach((b) => b.addEventListener('click', () => {
    const k = +b.dataset.level!;
    if (levels.has(k) && levels.size > 1) levels.delete(k); else levels.add(k);
    renderOverview(el, data);
  }));
  el.querySelectorAll<HTMLElement>('[data-sort]').forEach((b) => b.addEventListener('click', () => { sortBy = b.dataset.sort as typeof sortBy; renderOverview(el, data); }));
  el.querySelector('[data-act="more"]')?.addEventListener('click', () => { showAll = !showAll; renderOverview(el, data); });
  el.querySelector('[data-act="tour"]')?.addEventListener('click', () => startTour(data));
  el.querySelector('[data-act="fly-longest"]')?.addEventListener('click', () => { view = { kind: 'route', i: routes.indexOf(longest) }; renderPanel(el, data); startFlight(data, routes.indexOf(longest)); });
  const ul = el.querySelector('.tr-routes')!;
  ul.addEventListener('click', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('[data-route]'); if (li) go({ kind: 'route', i: +li.dataset.route! }, data); });
  ul.addEventListener('mouseover', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('[data-route]'); hoverRoute = li ? +li.dataset.route! : null; });
  ul.addEventListener('mouseleave', () => { hoverRoute = null; });
  el.querySelectorAll<HTMLElement>('[data-fall]').forEach((b) => b.addEventListener('click', () => go({ kind: 'fall', i: +b.dataset.fall! }, data)));
  el.querySelectorAll<HTMLElement>('[data-town]').forEach((b) => b.addEventListener('click', () => host?.openTown(b.dataset.town!)));
}

function backBar(label = 'All trails & waterfalls') {
  return `<button class="ld-back tr-back">‹ ${label}</button>`;
}

function renderRoute(el: HTMLElement, data: Data, i: number) {
  const r = T!.routes[i], falls = T!.falls, g = geoOf(r, falls);
  const lv = LEVEL[r.level];
  const near = data.munis.map((m) => ({ m, d: km(m.lon, m.lat, r.line[0][0], r.line[0][1]) })).sort((a, b) => a.d - b.d)[0];
  const osm = `https://www.openstreetmap.org/relation/${Number(r.id)}`;
  const web = safeUrl(r.web), wiki = r.wiki ? wikiUrl(r.wiki) : null;
  el.innerHTML = `
    ${backBar()}
    <div class="kicker" style="--c:${lv.c}">${lv.name} · ${r.loop ? 'loop' : 'one way'}${r.net ? ` · ${({ iwn: 'international', nwn: 'national', rwn: 'regional', lwn: 'local' } as Record<string, string>)[r.net] ?? esc(r.net)} route` : ''}</div>
    <h2>${esc(r.name)}</h2>
    ${r.desc ? `<p class="lede">${esc(r.desc)}</p>` : ''}
    <div class="metric-grid">
      <div class="metric"><div class="mk"><span class="dot" style="background:${lv.c}"></span>Distance</div><div class="mv">${r.km} km</div><div class="ms">${r.loop ? 'round trip' : 'one way'}${r.parts.length > 1 ? ` · mapped in ${r.parts.length} pieces` : ''}</div></div>
      <div class="metric"><div class="mk"><span class="dot" style="background:${lv.c}"></span>Time</div><div class="mv">${hrsText(r.hrs)}</div><div class="ms">walking, by Naismith’s rule</div></div>
      <div class="metric"><div class="mk"><span class="dot" style="background:#fcd34d"></span>Climbing</div><div class="mv">↑ ${fmt.int(r.up)} m</div><div class="ms">↓ ${fmt.int(r.down)} m down</div></div>
      <div class="metric"><div class="mk"><span class="dot" style="background:#e9eef7"></span>Highest point</div><div class="mv">${fmt.int(r.hi)} m</div><div class="ms">lowest ${fmt.int(r.lo)} m above sea level</div></div>
    </div>
    <h3>Elevation profile</h3>
    <div class="tr-prof"></div>
    <button class="tr-fly"><span>▶</span> Fly this trail in 3D</button>
    ${r.falls.length ? `<h3>Waterfalls along the way</h3><div class="tr-falls">${g.fallsAt.sort((a, b) => a.d - b.d).map(({ i: fi, d }) => `<button class="tr-fall" data-fall="${fi}"><span class="tr-drop"></span>${esc(fallName(falls[fi]))} <small>km ${d.toFixed(1)}${falls[fi].h ? ` · ${Math.round(falls[fi].h!)} m` : ''}</small></button>`).join('')}</div>` : ''}
    <div class="ld-actions">
      ${web ? `<a class="ld-btn" target="_blank" rel="noopener noreferrer" href="${esc(web)}">Website ↗</a>` : ''}
      ${wiki ? `<a class="ld-btn" target="_blank" rel="noopener" href="${esc(wiki)}">Wikipedia ↗</a>` : ''}
      <a class="ld-btn" target="_blank" rel="noopener" href="${osm}">OpenStreetMap ↗</a>
      <a class="ld-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${r.line[0][1].toFixed(5)},${r.line[0][0].toFixed(5)}">Directions to the trailhead ↗</a>
    </div>
    <p class="note">${near ? `Trailhead is ${near.d.toFixed(0)} km from ${esc(near.m.name)}. ` : ''}${r.op ? `Managed by ${esc(r.op)}. ` : ''}Elevations from ~50 m terrain tiles along the mapped line${r.parts.length > 1 ? ' (gaps between mapped pieces are bridged in a straight line)' : ''}. Hover the profile to find a spot on the map.</p>`;
  el.querySelector('.tr-back')!.addEventListener('click', () => go({ kind: 'overview' }, data, false));
  el.querySelector('.tr-fly')!.addEventListener('click', () => startFlight(data, i));
  el.querySelectorAll<HTMLElement>('[data-fall]').forEach((b) => b.addEventListener('click', () => go({ kind: 'fall', i: +b.dataset.fall! }, data)));
  requestAnimationFrame(() => { panelChart = profileChart(el.querySelector<HTMLElement>('.tr-prof')!, r, g, falls, { height: 150, onHover: (d) => { hoverD = d; } }); });
}

function renderFall(el: HTMLElement, data: Data, i: number) {
  const f = T!.falls[i];
  const near = data.munis.map((m) => ({ m, d: km(m.lon, m.lat, f.lon, f.lat) })).sort((a, b) => a.d - b.d)[0];
  const wiki = f.wiki ? wikiUrl(f.wiki) : null, page = fallPage(f);
  const access = f.path == null || f.path > 2000 ? 'No mapped path within 2 km: off-trail or by water' : f.path < 60 ? 'Right on a mapped trail' : `${fmt.int(f.path)} m from the nearest mapped path`;
  el.innerHTML = `
    ${backBar()}
    ${f.img ? `<a class="tr-hero" href="${commonsPage(f.img)}" target="_blank" rel="noopener"><img alt="${esc(fallName(f))}" src="${photo(f.img, 760)}"><span>Photo: Wikimedia Commons ↗</span></a>` : `<div class="tr-hero none"><div class="tr-hero-fx"></div></div>`}
    <div class="kicker" style="--c:${FALL_COLOR}">Waterfall${near ? ` · ${near.d.toFixed(0)} km from ${esc(near.m.name)}` : ''}</div>
    <h2>${esc(fallName(f))}</h2>
    <div class="metric-grid">
      <div class="metric"><div class="mk"><span class="dot" style="background:${FALL_COLOR}"></span>Drop</div><div class="mv">${f.h ? `${Math.round(f.h)} m` : '—'}</div><div class="ms">${f.h ? `about ${Math.round(f.h * 3.28)} ft` : 'height not recorded'}</div></div>
      <div class="metric"><div class="mk"><span class="dot" style="background:#e9eef7"></span>Elevation</div><div class="mv">${fmt.int(f.elev)} m</div><div class="ms">above sea level</div></div>
      <div class="metric" style="grid-column:1/-1"><div class="mk"><span class="dot" style="background:${TRAIL_COLOR}"></span>Getting there</div><div class="mv" style="font-size:15px">${access}</div><div class="ms">${f.routes.length ? `on or near ${f.routes.length} named route${f.routes.length > 1 ? 's' : ''}` : 'not on a named route'}</div></div>
    </div>
    <button class="tr-fly"><span>⟳</span> Orbit it in 3D</button>
    ${f.routes.length ? `<h3>Routes that pass it</h3><ol class="tr-routes">${f.routes.map((ri) => { const r = T!.routes[ri]; return `<li data-route="${ri}" style="--c:${LEVEL[r.level].c}"><span class="tr-lv"></span><span class="tr-nm"><b>${esc(r.name)}</b><small>${r.km} km · ↑${fmt.int(r.up)} m · ${hrsText(r.hrs)}</small></span>${miniProfile(r)}</li>`; }).join('')}</ol>` : ''}
    <div class="ld-actions">
      ${wiki ? `<a class="ld-btn" target="_blank" rel="noopener" href="${esc(wiki)}">Wikipedia ↗</a>` : ''}
      <a class="ld-btn" target="_blank" rel="noopener" href="${esc(page.url)}">${page.label} ↗</a>
      <a class="ld-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/@${f.lat},${f.lon},1200m/data=!3m1!1e3">Satellite ↗</a>
    </div>
    <p class="note">Waterfall locations and names from OpenStreetMap${f.img || f.h ? '; photo and height from the linked Wikidata item where OpenStreetMap had none' : ''}. Many falls are on steep, slippery ground: stay behind barriers and off wet rock.</p>`;
  el.querySelector('.tr-back')!.addEventListener('click', () => go({ kind: 'overview' }, data, false));
  el.querySelector('.tr-fly')!.addEventListener('click', () => startOrbit(i));
  el.querySelectorAll<HTMLElement>('[data-route]').forEach((b) => b.addEventListener('click', () => go({ kind: 'route', i: +b.dataset.route! }, data)));
}

// ---------------------------------------------------------------------------------------------
// elevation profile (panel and flight HUD)

function profileChart(el: HTMLElement, r: TrailRoute, g: Geo, falls: Waterfall[], opts: { height: number; onHover?: (d: number | null) => void; compact?: boolean }) {
  const W = el.clientWidth || 340, H = opts.height;
  const m = { t: 10, r: 8, b: opts.compact ? 6 : 20, l: opts.compact ? 6 : 36 };
  const x = d3.scaleLinear().domain([0, g.total]).range([m.l, W - m.r]);
  const lo = Math.max(0, r.lo - 40), hi = Math.max(r.hi + 40, lo + 150);
  const y = d3.scaleLinear().domain([lo, hi]).range([H - m.b, m.t]).nice();
  const pts = r.prof.map((v, i) => [(i / (r.prof.length - 1)) * g.total, v] as [number, number]);
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('class', 'tr-prof-svg');
  const id = `trg${Math.random().toString(36).slice(2, 8)}`;
  const grad = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#e9fff6').attr('stop-opacity', 0.55);
  grad.append('stop').attr('offset', '45%').attr('stop-color', TRAIL_COLOR).attr('stop-opacity', 0.35);
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#0b4f6c').attr('stop-opacity', 0.05);
  const area = d3.area<[number, number]>().x((d) => x(d[0])).y0(H - m.b).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  const line = d3.line<[number, number]>().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX);
  if (!opts.compact) {
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickFormat((v) => `${v} km`) as any).call((s) => s.select('.domain').remove()).selectAll('text').attr('fill', '#7d8aa3').attr('font-size', 10).attr('dy', 10);
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat((v) => `${v}`) as any).call((s) => s.select('.domain').remove()).call((s) => s.selectAll('line').attr('stroke', 'rgba(148,170,210,.1)')).selectAll('text').attr('fill', '#7d8aa3').attr('font-size', 10);
  }
  svg.append('path').datum(pts).attr('d', area).attr('fill', `url(#${id})`);
  // the climbing sections get a warm edge
  const stroke = svg.append('g');
  for (let i = 1; i < pts.length; i++) {
    const grade = (pts[i][1] - pts[i - 1][1]) / Math.max(0.001, (pts[i][0] - pts[i - 1][0]) * 1000);
    const c = grade > 0.12 ? '#fb7185' : grade > 0.05 ? '#fcd34d' : grade < -0.08 ? '#7dd3fc' : '#bff5dc';
    stroke.append('path').datum([pts[i - 1], pts[i]]).attr('d', line as any).attr('stroke', c).attr('stroke-width', 2).attr('fill', 'none');
  }
  const path = svg.append('path').datum(pts).attr('d', line).attr('fill', 'none').attr('stroke', 'transparent');
  void path;
  // waterfalls on the route
  for (const fa of g.fallsAt) {
    const fx = x(fa.d), fy = y(elevAt(r, g, fa.d));
    svg.append('circle').attr('cx', fx).attr('cy', fy).attr('r', 4).attr('fill', FALL_COLOR).attr('stroke', '#06101a').attr('stroke-width', 1.5).append('title').text(fallName(falls[fa.i]));
  }
  // summit
  const top = r.prof.indexOf(r.hi);
  if (!opts.compact && top >= 0) svg.append('text').attr('x', x(pts[top][0])).attr('y', y(r.hi) - 4).attr('text-anchor', 'middle').attr('fill', '#e9eef7').attr('font-size', 10).attr('font-weight', 600).text(`▲ ${fmt.int(r.hi)} m`);

  const head = svg.append('g').style('display', 'none');
  head.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', '#fff').attr('stroke-opacity', 0.6);
  head.append('circle').attr('r', 5).attr('fill', '#fff').attr('stroke', TRAIL_COLOR).attr('stroke-width', 2.5);
  const lab = head.append('text').attr('fill', '#fff').attr('font-size', 10.5).attr('font-weight', 600).attr('y', m.t + 10);
  const set = (d: number | null) => {
    if (d == null) { head.style('display', 'none'); return; }
    const e = elevAt(r, g, d);
    head.style('display', null).attr('transform', `translate(${x(d)},0)`);
    head.select('circle').attr('cy', y(e));
    if (!opts.compact) lab.text(`${d.toFixed(1)} km · ${Math.round(e)} m`).attr('text-anchor', x(d) > W - 90 ? 'end' : 'start').attr('dx', x(d) > W - 90 ? -6 : 6);
  };
  if (opts.onHover) {
    svg.on('pointermove', (ev: PointerEvent) => { const [px] = d3.pointer(ev); const d = Math.max(0, Math.min(g.total, x.invert(px))); set(d); opts.onHover!(d); })
      .on('pointerleave', () => { set(null); opts.onHover!(null); });
  }
  return { setPlayhead: set };
}

// ---------------------------------------------------------------------------------------------
// 3D: terrain, flights, orbits, the waterfall tour

function terrainOn(exaggeration = 1.4) {
  const m = host!.map;
  if (!m.getSource('dem-terrain'))
    m.addSource('dem-terrain', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium', maxzoom: 13 } as any);
  m.setTerrain({ source: 'dem-terrain', exaggeration });
  // satellite imagery draped over the relief, a touch darker so the glowing route reads on top
  clearTimeout(imageryTimer);
  if (!m.getSource('tr-imagery')) {
    m.addSource('tr-imagery', { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    const before = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    m.addLayer({ id: 'tr-imagery', type: 'raster', source: 'tr-imagery', paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 1200 }, 'raster-brightness-max': 0.82, 'raster-saturation': 0.1, 'raster-contrast': 0.08 } as any }, before);
  }
  requestAnimationFrame(() => { if (m.getLayer('tr-imagery')) m.setPaintProperty('tr-imagery', 'raster-opacity', 1); });
}
let imageryTimer = 0;
function terrainOff() {
  const m = host!.map;
  try { m.setTerrain(null as any); } catch { /* already off */ }
  if (m.getLayer('tr-imagery')) m.setPaintProperty('tr-imagery', 'raster-opacity', 0);
  // drop the imagery once faded so it stops loading tiles and its credit leaves the map
  imageryTimer = window.setTimeout(() => {
    if (trailsCinema()) return;
    if (m.getLayer('tr-imagery')) m.removeLayer('tr-imagery');
    if (m.getSource('tr-imagery')) m.removeSource('tr-imagery');
  }, 1400);
}

let flight: { stop: () => void } | null = null;
let orbit: { stop: () => void } | null = null;
let tour: { stop: () => void } | null = null;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function setCinema(on: boolean) {
  document.body.classList.toggle('cinema', on);
  host?.setCinema(on);
}

function escKeys(handler: (e: KeyboardEvent) => void) {
  const fn = (e: KeyboardEvent) => { handler(e); };
  window.addEventListener('keydown', fn, true);
  return () => window.removeEventListener('keydown', fn, true);
}

function startFlight(data: Data, i: number) {
  if (!host) return;
  stopAll();
  const m = host.map;
  const r = T!.routes[i], g = geoOf(r, T!.falls);
  terrainOn(1.5);
  setCinema(true);

  const geo: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.line } };
  m.addSource('fly-route', { type: 'geojson', data: geo, lineMetrics: true } as any);
  m.addLayer({ id: 'fly-route-glow', type: 'line', source: 'fly-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': TRAIL_COLOR, 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.55 } });
  m.addLayer({ id: 'fly-route-line', type: 'line', source: 'fly-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 4, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#ffffff', 1, TRAIL_COLOR] } as any });
  const fallsGeo: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: g.fallsAt.map(({ i: fi }) => ({ type: 'Feature', properties: { name: fallName(T!.falls[fi]) }, geometry: { type: 'Point', coordinates: [T!.falls[fi].lon, T!.falls[fi].lat] } })) };
  m.addSource('fly-falls', { type: 'geojson', data: fallsGeo });
  m.addLayer({ id: 'fly-falls', type: 'circle', source: 'fly-falls', paint: { 'circle-radius': 7, 'circle-color': FALL_COLOR, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map' } });
  m.addLayer({ id: 'fly-falls-label', type: 'symbol', source: 'fly-falls', layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-offset': [0, -1.4], 'text-font': ['Open Sans Semibold', 'Noto Sans Regular'] } as any, paint: { 'text-color': '#e0f7ff', 'text-halo-color': '#06101a', 'text-halo-width': 2 } });

  const dot = document.createElement('div');
  dot.className = 'tr-hiker';
  const marker = new maplibregl.Marker({ element: dot }).setLngLat(r.line[0]).addTo(m);

  const hud = document.createElement('div');
  hud.className = 'tr-hud glass';
  hud.innerHTML = `
    <div class="th-top"><div><div class="th-k" style="color:${LEVEL[r.level].c}">Flying the trail · ${LEVEL[r.level].name}</div><div class="th-nm">${esc(r.name)}</div></div>
      <div class="th-ctl"><button class="th-play" aria-label="Pause">❚❚</button>${[1, 2, 4].map((s) => `<button class="th-sp${s === 1 ? ' on' : ''}" data-s="${s}">${s}×</button>`).join('')}<button class="th-x" aria-label="Stop flight">✕</button></div></div>
    <div class="th-stats"><div><b class="th-km">0.0</b><span>km of ${g.total.toFixed(1)}</span></div><div><b class="th-el">–</b><span>m elevation</span></div><div><b class="th-up">0</b><span>m climbed</span></div><div><b class="th-t">0:00</b><span>walking time</span></div></div>
    <div class="th-prof"></div>
    <div class="th-hint">Drag to look around · Space pause · Esc exit</div>`;
  document.body.appendChild(hud);
  const chart = profileChart(hud.querySelector<HTMLElement>('.th-prof')!, r, g, T!.falls, { height: 64, compact: true });

  // the flight: ~25 s for a short walk, longer routes go faster but cap at two minutes
  const duration = Math.min(120, 24 + g.total * 1.1);
  let speed = 1, paused = false, d = 0, last = performance.now(), raf = 0, done = false;
  let bearing = bearingOf(r.line[0], along(r, g, Math.min(g.total, 0.5)));
  let climbed = 0, lastE = elevAt(r, g, 0);
  const zoom = g.total > 60 ? 12.4 : g.total > 20 ? 13 : 13.8;
  const look = Math.max(0.35, g.total / 40);
  const fmtT = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  let userTilt = 0;
  const onDrag = () => { userTilt = performance.now(); };
  m.on('dragstart', onDrag);

  const step = (now: number) => {
    // a slow frame still advances the clock (bounded, so a background tab doesn't leap ahead)
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!paused && !done) {
      d = Math.min(g.total, d + (g.total / duration) * dt * speed);
      const pos = along(r, g, d);
      const ahead = along(r, g, Math.min(g.total, d + look));
      if (d < g.total - 0.01) bearing = lerpAngle(bearing, bearingOf(pos, ahead), Math.min(1, dt * 1.3));
      marker.setLngLat(pos);
      if (now - userTilt > 2500) m.jumpTo({ center: pos, bearing, pitch: 64, zoom });
      else m.jumpTo({ center: pos });
      const e = elevAt(r, g, d);
      if (e > lastE) climbed += e - lastE;
      lastE = e;
      chart.setPlayhead(d);
      (hud.querySelector('.th-km') as HTMLElement).textContent = d.toFixed(1);
      (hud.querySelector('.th-el') as HTMLElement).textContent = fmt.int(e);
      (hud.querySelector('.th-up') as HTMLElement).textContent = fmt.int(Math.min(climbed, r.up * 1.15));
      (hud.querySelector('.th-t') as HTMLElement).textContent = fmtT((d / Math.max(0.1, g.total)) * r.hrs);
      m.setPaintProperty('fly-route-line', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, '#ffffff', Math.max(0.0001, Math.min(0.9998, d / g.total)), '#ffffff', Math.min(0.9999, d / g.total + 0.0001), TRAIL_COLOR, 1, TRAIL_COLOR] as any);
      if (d >= g.total) {
        done = true;
        hud.classList.add('done');
        m.fitBounds(boundsOf(r.line), { padding: 120, pitch: 55, bearing: bearing - 30, duration: 3500, essential: true });
      }
    }
    raf = requestAnimationFrame(step);
  };

  const playBtn = hud.querySelector<HTMLButtonElement>('.th-play')!;
  const setPaused = (p: boolean) => { paused = p; playBtn.textContent = p ? '▶' : '❚❚'; playBtn.setAttribute('aria-label', p ? 'Play' : 'Pause'); };
  playBtn.addEventListener('click', () => { if (done) { done = false; d = 0; climbed = 0; lastE = elevAt(r, g, 0); hud.classList.remove('done'); } setPaused(!paused && !done); });
  hud.querySelectorAll<HTMLButtonElement>('.th-sp').forEach((b) => b.addEventListener('click', () => { speed = +b.dataset.s!; hud.querySelectorAll('.th-sp').forEach((x) => x.classList.toggle('on', x === b)); }));
  hud.querySelector('.th-x')!.addEventListener('click', () => stopAll());
  const unkey = escKeys((e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopAll(); }
    else if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); setPaused(!paused); }
    else if (/^(l|L|p|P|s|S|ArrowLeft|ArrowRight)$/.test(e.key)) e.stopImmediatePropagation();
  });

  // swoop in to the trailhead, then go
  m.flyTo({ center: r.line[0], zoom, pitch: 64, bearing, duration: calm() ? 0 : 3200, essential: true });
  m.once('moveend', () => { last = performance.now(); raf = requestAnimationFrame(step); });

  flight = {
    stop() {
      cancelAnimationFrame(raf);
      unkey();
      m.off('dragstart', onDrag);
      marker.remove();
      hud.remove();
      for (const id of ['fly-falls-label', 'fly-falls', 'fly-route-line', 'fly-route-glow']) if (m.getLayer(id)) m.removeLayer(id);
      for (const id of ['fly-falls', 'fly-route']) if (m.getSource(id)) m.removeSource(id);
      terrainOff();
      setCinema(false);
      flight = null;
      m.fitBounds(boundsOf(r.parts.flat()), { padding: { top: 90, bottom: 150, left: 60, right: 440 }, pitch: 45, duration: 1600, maxZoom: 13, essential: true });
    },
  };
}

/** A label card and ripples pinned to a waterfall on the 3D terrain. */
function fallMarker(f: Waterfall, card = true) {
  const el = document.createElement('div');
  el.className = 'tr-fallpin';
  el.innerHTML = `<i></i><i></i><i></i>${card ? `<div class="tr-fallpin-card"><b>${esc(fallName(f))}</b>${f.h ? `<span>${Math.round(f.h)} m drop · ${fmt.int(f.elev)} m up</span>` : `<span>${fmt.int(f.elev)} m above sea level</span>`}</div>` : ''}`;
  return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([f.lon, f.lat]).addTo(host!.map);
}

function startOrbit(i: number) {
  if (!host) return;
  stopAll();
  const m = host.map, f = T!.falls[i];
  terrainOn(1.6);
  document.body.classList.add('orbiting');
  host.setCinema(true);
  const mk = fallMarker(f);
  let raf = 0, last = 0, spinning = false;
  const spin = (now: number) => {
    if (last) m.setBearing(m.getBearing() + ((now - last) / 1000) * 7);
    last = now;
    raf = requestAnimationFrame(spin);
  };
  m.flyTo({ center: [f.lon, f.lat], zoom: 14.6, pitch: 68, bearing: m.getBearing() - 40, duration: calm() ? 0 : 4200, essential: true });
  m.once('moveend', () => { if (!calm() && orbit) { spinning = true; raf = requestAnimationFrame(spin); } });
  const halt = () => { if (spinning) { cancelAnimationFrame(raf); spinning = false; } };
  m.on('mousedown', halt); m.on('touchstart', halt); m.on('wheel', halt);
  const bar = document.createElement('div');
  bar.className = 'tr-orbit-bar glass';
  bar.innerHTML = `<span>⟳ Orbiting <b>${esc(fallName(f))}</b> in 3D · drag to look around</span><button>Back to the map</button>`;
  document.body.appendChild(bar);
  bar.querySelector('button')!.addEventListener('click', () => stopAll());
  const unkey = escKeys((e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopAll(); } });
  orbit = {
    stop() {
      halt(); unkey();
      m.off('mousedown', halt); m.off('touchstart', halt); m.off('wheel', halt);
      mk.remove(); bar.remove();
      terrainOff();
      document.body.classList.remove('orbiting');
      host!.setCinema(false);
      orbit = null;
      m.easeTo({ pitch: 55, zoom: 12, duration: 1400 });
    },
  };
}

function startTour(data: Data) {
  if (!host) return;
  stopAll();
  const m = host.map;
  const stops = photographed(T!.falls).slice(0, 12);
  if (!stops.length) return;
  terrainOn(1.6);
  setCinema(true);
  const card = document.createElement('div');
  card.className = 'tr-tour';
  document.body.appendChild(card);
  let k = -1, raf = 0, timer = 0, mk: maplibregl.Marker | null = null, token = 0, paused = false;
  const cancelSpin = () => cancelAnimationFrame(raf);
  // preload the photos so each card appears with its picture
  stops.forEach((f) => { const im = new Image(); im.src = photo(f.img!, 760); });

  const show = (n: number) => {
    k = (n + stops.length) % stops.length;
    const f = stops[k], my = ++token;
    cancelSpin(); clearTimeout(timer); mk?.remove();
    card.innerHTML = `
      <div class="tt-img"><img alt="" src="${photo(f.img!, 760)}"></div>
      <div class="tt-body">
        <div class="tt-k">Waterfall ${k + 1} of ${stops.length}</div>
        <div class="tt-nm">${esc(fallName(f))}</div>
        <div class="tt-st">${f.h ? `<span><b>${Math.round(f.h)} m</b> drop</span>` : ''}<span><b>${fmt.int(f.elev)} m</b> above the sea</span><span>${f.path != null && f.path < 2000 ? (f.path < 60 ? 'on a trail' : `${fmt.int(f.path)} m from a trail`) : 'off-trail'}</span></div>
        <div class="tt-dots">${stops.map((_, j) => `<i class="${j === k ? 'on' : ''}"></i>`).join('')}</div>
        <div class="tt-ctl"><button data-a="prev" aria-label="Previous">‹</button><button data-a="pause">${paused ? '▶' : '❚❚'}</button><button data-a="next" aria-label="Next">›</button><button data-a="open">Details</button><button data-a="x" aria-label="End tour">✕</button></div>
        <div class="tt-cr">Photo: Wikimedia Commons</div>
      </div>`;
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    card.querySelector('[data-a="prev"]')!.addEventListener('click', () => show(k - 1));
    card.querySelector('[data-a="next"]')!.addEventListener('click', () => show(k + 1));
    card.querySelector('[data-a="pause"]')!.addEventListener('click', (e) => { paused = !paused; (e.target as HTMLElement).textContent = paused ? '▶' : '❚❚'; if (!paused) timer = window.setTimeout(() => show(k + 1), 4000); else clearTimeout(timer); });
    card.querySelector('[data-a="open"]')!.addEventListener('click', () => { const i = T!.falls.indexOf(f); stopAll(); view = { kind: 'fall', i }; if (panelEl) renderPanel(panelEl, data); });
    card.querySelector('[data-a="x"]')!.addEventListener('click', () => stopAll());
    mk = fallMarker(f, false);
    m.flyTo({ center: [f.lon, f.lat], zoom: 14.4, pitch: 66, bearing: (k * 67) % 360 - 180, duration: calm() ? 0 : 5200, curve: 1.7, essential: true });
    m.once('moveend', () => {
      if (my !== token || !tour) return;
      let last = 0;
      const spin = (now: number) => { if (last) m.setBearing(m.getBearing() + ((now - last) / 1000) * 9); last = now; raf = requestAnimationFrame(spin); };
      if (!calm()) raf = requestAnimationFrame(spin);
      if (!paused) timer = window.setTimeout(() => show(k + 1), 6500);
    });
  };
  const unkey = escKeys((e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopAll(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); show(k + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); show(k - 1); }
    else if (e.code === 'Space' || /^(l|L|p|P|s|S)$/.test(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
  });
  tour = {
    stop() {
      token++; cancelSpin(); clearTimeout(timer); unkey(); mk?.remove(); card.remove();
      terrainOff();
      setCinema(false);
      tour = null;
    },
  };
  show(0);
}

export function stopAll() {
  flight?.stop();
  orbit?.stop();
  tour?.stop();
}

// ---------------------------------------------------------------------------------------------
// shared with the Town Report and the Land Finder

/** Metres of mapped footpath within `r` km of a point, from the density grid. */
export function trailMetresNear(trails: Trails, lon: number, lat: number, rKm = 3) {
  const G = trails.grid;
  if (!gridMap || gridMap.src !== G) gridMap = { src: G, m: new Map(G.cells) };
  const cx = Math.floor((lon - G.west) / G.d), cy = Math.floor((lat - G.south) / G.d);
  const rx = Math.ceil(rKm / (G.d * kx)), ry = Math.ceil(rKm / (G.d * ky));
  let s = 0;
  for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
    if (Math.hypot(dx * G.d * kx, dy * G.d * ky) > rKm) continue;
    s += gridMap.m.get((cy + dy) * G.nx + cx + dx) ?? 0;
  }
  return s;
}
let gridMap: { src: Trails['grid']; m: Map<number, number> } | null = null;

export { fallName, hrsText, LEVEL };
