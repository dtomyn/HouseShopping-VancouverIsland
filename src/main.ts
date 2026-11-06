import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import * as d3 from 'd3';
import { Data, MONTHS, clamp, loadAll } from './data';
import { AtlasEvent, AtlasLayer, CURATED_EVENTS, Ctx, PanelHandle, buildLayers } from './layers';
import { loadWeights, renderFinder, renderTownReport } from './panels';
import { openSources, sourcesOpen } from './sources';
import { Ranked } from './metrics';
import { closeLand, landClick, landHover, landKey, landLayers, openLand, setLandTrails } from './land';
import { bindTrails, setTrailView, stopAll as stopTrails, trailsCinema } from './trails';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const INTRO_FROM = { center: [-126.2, 50.4] as [number, number], zoom: 5.1, pitch: 0, bearing: 0 };
const HOME = { center: [-125.25, 49.55] as [number, number], zoom: 7.15, pitch: 48, bearing: -18 };
const MUNI_LAYERS = new Set(['population', 'housing', 'crime']);
// static layers that draw town columns only while focused
const MUNI_WHEN_FOCUSED = new Set(['hospitals', 'seismic', 'future']);
// layer menu sections; any layer not listed lands in the last group
const LAYER_GROUPS: { name: string; ids: string[] }[] = [
  { name: 'Base map', ids: ['island'] },
  { name: 'History on the timeline', ids: ['fires', 'quakes', 'rivers', 'climate', 'smoke'] },
  { name: 'Towns & living', ids: ['population', 'housing', 'crime', 'hospitals'] },
  { name: 'Outdoors', ids: ['trails'] },
  { name: 'Hazard & climate outlook', ids: ['seismic', 'normals', 'future'] },
];

type Mode = 'layer' | 'town' | 'finder' | 'land';

const state = {
  time: 1919,
  playing: false,
  speed: 2,
  focused: 'island',
  // the timeline belongs to the last focused time-based layer; static layers leave it alone
  timeLayer: 'fires',
  visible: new Set<string>(),
  // layers the user overlaid with a menu switch; they stay on when another layer is picked
  pinned: new Set<string>(),
  selected: null as string | null,
  hovered: null as string | null,
  mode: 'layer' as Mode,
  ranked: null as Ranked[] | null,
  beacons: [] as { ev: AtlasEvent; born: number }[],
};

let data: Data;
let layers: AtlasLayer[] = [];
let byId: Record<string, AtlasLayer> = {};
let events: AtlasEvent[] = [];
let map: maplibregl.Map;
let overlay: MapboxOverlay;
let panelHandle: PanelHandle | null = null;
let firstLabelLayer: string | undefined;

const ctx = (): Ctx => ({ time: state.time, speed: state.speed, data, selected: state.selected, hovered: state.hovered, focusedId: state.focused, clock: performance.now() });
const focusedLayer = () => byId[state.focused];
const timeLayer = () => byId[state.timeLayer];

// ---------------------------------------------------------------------------------------------
// map

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    ...INTRO_FROM,
    maxPitch: 75,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true },
  } as any);
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

  map.on('load', () => {
    const style = map.getStyle();
    firstLabelLayer = style.layers.find((l) => l.type === 'symbol')?.id;
    const waterLayer = style.layers.find((l) => /water/.test(l.id) && l.type === 'fill')?.id;

    // shaded relief from open terrain tiles, tucked under the water so the sea stays flat
    map.addSource('dem', {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 12,
      attribution: 'Terrain: Mapzen / AWS Terrain Tiles',
    });
    map.addLayer(
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-exaggeration': 0.55,
          'hillshade-shadow-color': '#02040a',
          'hillshade-highlight-color': 'rgba(150,175,215,0.22)',
          'hillshade-accent-color': '#0b1424',
          'hillshade-illumination-direction': 315,
        },
      },
      waterLayer,
    );

    if (data.island) {
      map.addSource('island', { type: 'geojson', data: data.island });
      map.addLayer({ id: 'coast-glow', type: 'line', source: 'island', paint: { 'line-color': '#4cc9f0', 'line-width': 10, 'line-blur': 10, 'line-opacity': 0.16 } }, firstLabelLayer);
      map.addLayer({ id: 'coast-line', type: 'line', source: 'island', paint: { 'line-color': '#8fdcff', 'line-width': 0.8, 'line-opacity': 0.5 } }, firstLabelLayer);
    }
    try {
      (map as any).setSky?.({ 'sky-color': '#060a12', 'horizon-color': '#12233d', 'fog-color': '#060a12', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 });
    } catch { /* older renderers */ }

    overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      // a few pixels of slack, so a thin trail line is easy to point at
      pickingRadius: 6,
      onHover,
      onClick,
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    } as any);
    map.addControl(overlay as any);
    bindTrails({
      map,
      openTown,
      setCinema: (on) => { if (on) { setPlaying(false); setMenu(false); $('tooltip').hidden = true; } },
    });

    $('loader').classList.add('done');
    setTimeout(() => {
      map.flyTo({ ...HOME, duration: 4200, curve: 1.6, essential: true });
    }, 300);
  });
}

// ---------------------------------------------------------------------------------------------
// deck layers per frame

function render() {
  if (!overlay) return;
  // flights and orbits over 3D terrain draw with the map's own layers
  if (trailsCinema()) { overlay.setProps({ layers: [] }); return; }
  // the Land Finder shows only its parcels
  if (state.mode === 'land') { overlay.setProps({ layers: landLayers() }); return; }
  const c = ctx();
  const out: Layer[] = [];
  for (const l of layers) {
    if (!l.available || !state.visible.has(l.id)) continue;
    for (const dl of l.build(c)) {
      // flat layers go under the basemap labels; 3D columns stay on top
      const flat = /scars|embers|base|stems/.test(dl.id);
      out.push(flat && firstLabelLayer ? dl.clone({ beforeId: firstLabelLayer } as any) : dl);
    }
  }

  const anyMuni = [...state.visible].some((id) => (MUNI_LAYERS.has(id) || (MUNI_WHEN_FOCUSED.has(id) && id === state.focused)) && byId[id]?.available);
  if (state.mode === 'finder' && state.ranked) {
    const ramp = d3.scaleSequential(d3.interpolateRgb('#2b1f6b', '#7dffc4')).domain([0.2, 0.85]).clamp(true);
    const rk = state.ranked.map((r, i) => ({ ...r, i }));
    out.push(
      new ColumnLayer<any>({
        id: 'finder-cols',
        data: rk,
        getPosition: (r) => [r.t.muni.lon, r.t.muni.lat],
        radius: 1900,
        diskResolution: 32,
        extruded: true,
        getElevation: (r) => 800 + r.score ** 1.6 * 45000,
        getFillColor: (r) => { const c2 = d3.rgb(ramp(r.score)); return [c2.r, c2.g, c2.b, r.i < 5 ? 250 : 170]; },
        material: { ambient: 0.6, diffuse: 0.6, shininess: 80 },
        pickable: true,
        transitions: { getElevation: { duration: 600, easing: d3.easeCubicOut }, getFillColor: 600 },
        updateTriggers: { getElevation: state.ranked, getFillColor: state.ranked },
      }),
      new TextLayer<any>({
        id: 'finder-labels',
        data: rk.slice(0, 10),
        getPosition: (r) => [r.t.muni.lon, r.t.muni.lat, 800 + r.score ** 1.6 * 45000 + 3000],
        getText: (r) => `${r.i + 1} · ${r.t.muni.name}`,
        getSize: (r) => (r.i < 3 ? 15 : 12),
        getColor: [240, 244, 252, 255],
        fontFamily: 'Inter, sans-serif',
        fontWeight: 700,
        outlineWidth: 3,
        outlineColor: [6, 10, 18, 230],
        fontSettings: { sdf: true },
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        updateTriggers: { getPosition: state.ranked, getText: state.ranked },
        parameters: { depthCompare: 'always' },
      } as any),
    );
  } else if (!anyMuni) {
    // clickable town pins whenever no municipal layer is showing
    out.push(
      new ScatterplotLayer<any>({
        id: 'towns-pins',
        data: data.munis,
        getPosition: (m) => [m.lon, m.lat],
        getRadius: 650,
        radiusMinPixels: 3.5,
        radiusMaxPixels: 7,
        getFillColor: [235, 242, 255, 210],
        stroked: true,
        getLineColor: [6, 10, 18, 255],
        lineWidthMinPixels: 1.2,
        pickable: true,
        parameters: { depthCompare: 'always' },
      } as any),
    );
  }

  // pulsing ring on the selected town
  if (state.selected) {
    const m = data.munis.find((x) => x.key === state.selected);
    if (m) {
      const p = (performance.now() % 1600) / 1600;
      out.push(
        new ScatterplotLayer<any>({
          id: 'selected-ring',
          data: [m],
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 2500 + p * 7000,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 2,
          getLineColor: [255, 255, 255, 255 * (1 - p)],
          updateTriggers: { getRadius: p, getLineColor: p },
          parameters: { depthCompare: 'always' },
        } as any),
      );
    }
  }

  // event beacons: a shockwave where a historic event happened
  const now = performance.now();
  state.beacons = state.beacons.filter((b) => now - b.born < 3500);
  if (state.beacons.length)
    out.push(
      new ScatterplotLayer<any>({
        id: 'beacons',
        data: state.beacons.flatMap((b) => [0, 0.33, 0.66].map((o) => ({ b, o }))),
        getPosition: (d) => [d.b.ev.lon, d.b.ev.lat],
        getRadius: (d) => { const a = ((now - d.b.born) / 3500 + d.o) % 1; return 2000 + a * 40000; },
        stroked: true,
        filled: false,
        lineWidthMinPixels: 2,
        getLineColor: (d) => { const a = ((now - d.b.born) / 3500 + d.o) % 1; return [255, 255, 255, 220 * (1 - a) * (1 - (now - d.b.born) / 3500)]; },
        updateTriggers: { getRadius: now, getLineColor: now },
        parameters: { depthCompare: 'always' },
      } as any),
    );

  overlay.setProps({ layers: out });
}

// ---------------------------------------------------------------------------------------------
// interaction

const tooltipEl = () => $('tooltip');

function onHover(info: PickingInfo) {
  const t = tooltipEl();
  const o: any = info.object;
  state.hovered = o ? o.m?.key ?? o.t?.muni?.key ?? (info.layer?.id.startsWith('towns') ? o.key : null) : null;
  if (state.mode === 'land' && (!info.object || !info.layer)) landHover(info);
  if (!info.object || !info.layer) { t.hidden = true; return; }
  let html: string | null = null;
  const id = info.layer.id;
  if (state.mode === 'land') {
    html = landHover(info);
  } else if (id.startsWith('finder')) {
    const r = info.object as Ranked & { i: number };
    html = `<b>#${r.i + 1} ${r.t.muni.name}</b><br><span class="tk">Score</span> <span class="tv">${Math.round(r.score * 100)}</span><br><span class="tk">Click for town report</span>`;
  } else if (id.startsWith('towns')) {
    html = `<b>${info.object.name}</b><br><span class="tk">Click for town report</span>`;
  } else {
    const owner = layers.find((l) => id.startsWith(l.id));
    html = owner?.tooltip(info) ?? null;
  }
  if (!html) { t.hidden = true; return; }
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = `${Math.min(info.x, window.innerWidth - r.width - 30)}px`;
  t.style.top = `${Math.min(info.y, window.innerHeight - r.height - 30)}px`;
}

function onClick(info: PickingInfo) {
  if (state.mode === 'land') { landClick(info); return; }
  const o: any = info.object;
  if (!o) return;
  const owner = info.layer ? layers.find((l) => info.layer!.id.startsWith(l.id)) : null;
  if (owner?.click?.(info)) return;
  const key = o.m?.key ?? o.t?.muni?.key ?? (info.layer?.id.startsWith('towns') ? o.key : null);
  if (key) openTown(key);
}

function openTown(key: string) {
  state.selected = key;
  const m = data.munis.find((x) => x.key === key)!;
  const prevMode = state.mode === 'town' ? 'layer' : state.mode;
  state.mode = 'town';
  let rank: { pos: number; of: number; score: number } | undefined;
  if (state.ranked) {
    const i = state.ranked.findIndex((r) => r.t.muni.key === key);
    if (i >= 0) rank = { pos: i + 1, of: state.ranked.length, score: state.ranked[i].score };
  }
  swapPanel(() => {
    panelHandle = null;
    renderTownReport($('panel'), data, key, {
      rank,
      onClose: () => { state.selected = null; prevMode === 'finder' ? openFinder() : showLayerPanel(); },
    });
  });
  map.flyTo({ center: [m.lon, m.lat], zoom: Math.max(map.getZoom(), 9.2), pitch: 55, duration: 1600, essential: true });
}

function openFinder() {
  state.mode = 'finder';
  $('finder-btn').classList.add('active');
  const weights = loadWeights();
  swapPanel(() => {
    panelHandle = null;
    renderFinder($('panel'), data, weights, {
      onChange: (ranked) => { state.ranked = ranked; },
      onPick: (key) => openTown(key),
      onClose: () => closeFinder(),
    });
  });
  if (map.getZoom() > 8.5) map.flyTo({ ...HOME, duration: 1400 });
}

/** Opens a trail route or waterfall from elsewhere (the Town Report). */
function openOutdoors(kind: 'route' | 'fall', i: number) {
  if (!byId.trails?.available) return;
  if (state.mode === 'land') closeLandFinder();
  if (state.mode === 'finder') closeFinder();
  state.selected = null;
  state.mode = 'layer';
  setTrailView({ kind, i });
  if (state.focused === 'trails') showLayerPanel(); else focus('trails');
  const t = data.trails!;
  if (kind === 'fall') { const f = t.falls[i]; map.flyTo({ center: [f.lon, f.lat], zoom: 12.2, pitch: 60, duration: 1800, essential: true }); }
  else { const pts = t.routes[i].parts.flat(); const b = pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [180, 90, -180, -90]); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 90, bottom: 150, left: 60, right: 440 }, pitch: 50, duration: 1800, maxZoom: 13.5 }); }
}

function openLandFinder() {
  if (state.mode === 'land') return;
  stopTrails();
  setPlaying(false);
  setMenu(false);
  if (state.mode === 'finder') { state.ranked = null; $('finder-btn').classList.remove('active'); }
  state.mode = 'land';
  state.selected = null;
  $('land-btn').classList.add('active');
  setPanelOpen(true);
  $('tooltip').hidden = true;
  openLand({ map, panel: $('panel'), beforeId: firstLabelLayer, onClose: closeLandFinder });
}

function closeLandFinder() {
  if (state.mode !== 'land') return;
  closeLand();
  $('land-btn').classList.remove('active');
  $('tooltip').hidden = true;
  state.mode = 'layer';
  showLayerPanel();
  map.flyTo({ ...HOME, duration: 1800, essential: true });
}

function closeFinder() {
  state.mode = 'layer';
  state.ranked = null;
  state.selected = null;
  $('finder-btn').classList.remove('active');
  showLayerPanel();
}

function swapPanel(fill: () => void) {
  const p = $('panel');
  if (state.mode !== 'layer') setPanelOpen(true);
  p.classList.add('swap');
  setTimeout(() => {
    p.scrollTop = 0;
    fill();
    p.classList.remove('swap');
  }, 160);
}

function showLayerPanel() {
  state.mode = state.mode === 'finder' ? 'finder' : 'layer';
  if (state.mode === 'finder') return;
  const l = focusedLayer();
  swapPanel(() => {
    const p = $('panel');
    p.style.setProperty('--c', l.color);
    panelHandle = l.panel(p, ctx());
    panelHandle.update(ctx());
  });
}

// ---------------------------------------------------------------------------------------------
// layer menu

const menuEl = () => $('layer-menu');
const menuOpen = () => !menuEl().hidden;

function setMenu(open: boolean) {
  menuEl().hidden = !open;
  $('layers-btn').setAttribute('aria-expanded', String(open));
  if (open) menuEl().querySelector<HTMLElement>('.layer-row.focused')?.focus({ preventScroll: true });
}

function renderLayerMenu() {
  const f = focusedLayer();
  $('picker-ic').textContent = f.icon;
  $('picker-nm').textContent = f.name;
  const extra = [...state.visible].filter((id) => id !== f.id && byId[id]?.available).length;
  const ex = $('picker-extra');
  ex.hidden = !extra;
  ex.textContent = `+${extra}`;
  ex.title = `${extra} more layer${extra > 1 ? 's' : ''} overlaid`;

  const menu = menuEl();
  const listed = new Set(LAYER_GROUPS.flatMap((g) => g.ids));
  const groups = LAYER_GROUPS.map((g, i) => ({ name: g.name, items: layers.filter((l) => g.ids.includes(l.id) || (i === LAYER_GROUPS.length - 1 && !listed.has(l.id))) }));
  menu.innerHTML = '';
  for (const g of groups) {
    if (!g.items.length) continue;
    const sec = document.createElement('div');
    sec.className = 'menu-group';
    sec.innerHTML = `<div class="menu-gh">${g.name}</div>`;
    for (const l of g.items) {
      const row = document.createElement('div');
      row.className = `layer-row${l.id === state.focused ? ' focused' : ''}${l.available ? '' : ' unavailable'}`;
      row.style.setProperty('--c', l.color);
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const [a, b] = l.range;
      row.innerHTML = `<div class="ic">${l.icon}</div><div><div class="nm">${l.name}</div><div class="rg">${!l.available ? 'data unavailable' : l.static ? l.period ?? 'no timeline' : `${Math.floor(a)}–${Math.floor(b)}`}</div></div>${l.id === 'island' ? '' : `<button class="eye${state.pinned.has(l.id) ? ' on' : ''}" aria-label="Overlay ${l.name} on map" title="Keep on the map while you pick other layers"></button>`}`;
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('eye')) {
          // the switch keeps a layer on while others are picked; the picked layer always shows
          if (state.pinned.has(l.id)) { state.pinned.delete(l.id); if (l.id !== state.focused) state.visible.delete(l.id); }
          else { state.pinned.add(l.id); state.visible.add(l.id); }
          renderLayerMenu();
          if (focusedLayer().static) setupTimeline();
          return;
        }
        focus(l.id);
        setMenu(false);
      });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { focus(l.id); setMenu(false); $('layers-btn').focus(); } });
      sec.appendChild(row);
    }
    menu.appendChild(sec);
  }
  menu.insertAdjacentHTML('beforeend', `<div class="menu-hint">Pick a layer to put it on the map; picking another replaces it. Flip a switch to keep a layer on while you pick others. <i>Just the island</i> clears everything. Click any town on the map for its report card.</div>`);
}

// ---------------------------------------------------------------------------------------------
// story panel visibility

function setPanelOpen(open: boolean) {
  $('panel').classList.toggle('collapsed', !open);
  document.body.classList.toggle('no-panel', !open);
  const btn = $('panel-btn');
  btn.classList.toggle('on', open);
  btn.setAttribute('aria-pressed', String(open));
  btn.title = open ? 'Hide the story panel (P)' : 'Show the story panel (P)';
  requestAnimationFrame(drawSpark);
  setTimeout(drawSpark, 300);
}

function focus(id: string) {
  const l = byId[id];
  if (id !== 'trails') stopTrails();
  const changed = state.focused !== id;
  state.focused = id;
  // Focusing shows the layer; other layers stay on only if the user switched them on themselves.
  // "Just the island" clears the map, switches included.
  if (id === 'island') state.pinned.clear();
  state.visible = new Set([...state.pinned, ...(id === 'island' ? [] : [id])]);
  if (changed) {
    // a static layer keeps the current time, so other visible layers carry on where they were
    if (!l.static && state.timeLayer !== id) {
      state.timeLayer = id;
      const [a, b] = l.range;
      if (state.time < a || state.time > b) state.time = a;
    }
    if (state.mode !== 'finder') { state.mode = 'layer'; state.selected = null; }
  }
  document.documentElement.style.setProperty('--accent', l.color);
  renderLayerMenu();
  setupTimeline();
  if (state.mode !== 'finder') showLayerPanel();
}

// ---------------------------------------------------------------------------------------------
// timeline

const scrub = () => $<HTMLInputElement>('scrub');

function setupTimeline() {
  const l = timeLayer();
  const f = focusedLayer();
  $('timeline').classList.toggle('static', !!f.static);
  const note = $('static-note');
  note.hidden = !f.static;
  if (f.static) {
    // other visible time-based layers keep playing on the last timeline
    const others = layers.filter((x) => !x.static && x.available && state.visible.has(x.id)).map((x) => x.name);
    note.innerHTML = f.id === 'island' && !others.length ? `<div>No history layer on the map</div><span>Open <b>Layer</b> and pick one, like Wildfires, to travel through time</span>` : `<div><b>${f.name}</b> doesn’t change over time</div><span>${others.length ? `${others.join(', ')} shown at <i id="static-year">${Math.floor(state.time)}</i> · Space to play` : 'Pick a timeline layer to travel through history'}</span>`;
  }
  const [a, b] = l.range;
  const s = scrub();
  s.min = String(a);
  s.max = String(b);
  s.step = l.monthly ? String(1 / 12) : '0.01';
  $('t-min').textContent = String(Math.floor(a));
  $('t-max').textContent = String(Math.floor(b));
  $('t-label').textContent = l.name;
  drawSpark();
  drawEvents();
}

function drawSpark() {
  const l = timeLayer();
  const cv = $<HTMLCanvasElement>('spark');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  if (!l.available) return;
  const pts = l.spark();
  if (!pts.length) return;
  const [a, b] = l.range;
  const x = (v: number) => ((v - a) / (b - a)) * w;
  const max = Math.max(...pts.map((p) => Math.abs(p.y))) || 1;
  const diverging = pts.some((p) => p.y < 0);
  const step = l.monthly ? 1 / 12 : 1;
  const bw = Math.max(1, (w / ((b - a) / step)) - (l.monthly ? 0.3 : 1));
  for (const p of pts) {
    const past = p.x <= state.time;
    g.fillStyle = p.color ?? l.color;
    g.globalAlpha = past ? 0.95 : 0.3;
    if (diverging) {
      const mid = h / 2 + 1;
      const hh = (Math.abs(p.y) / max) * (h / 2 - 2);
      g.fillRect(x(p.x), p.y >= 0 ? mid - hh : mid, bw, Math.max(1, hh));
    } else {
      const hh = (p.y / max) * (h - 4);
      g.fillRect(x(p.x), h - hh, bw, Math.max(p.y > 0 ? 1 : 0, hh));
    }
  }
  g.globalAlpha = 1;
}

function drawEvents() {
  const l = timeLayer();
  const [a, b] = l.range;
  const el = $('events');
  el.innerHTML = '';
  for (const ev of events) {
    if (ev.t < a || ev.t > b || (ev.layer !== '*' && ev.layer !== l.id)) continue;
    const d = document.createElement('div');
    d.className = 'ev';
    d.style.left = `${((ev.t - a) / (b - a)) * 100}%`;
    d.style.background = ev.layer === '*' ? '#fff' : byId[ev.layer].color;
    d.title = ev.title;
    d.addEventListener('click', () => {
      setTime(ev.t - 0.02);
      setPlaying(false);
      toast(ev);
      if (ev.lon != null) map.flyTo({ center: [ev.lon, ev.lat!], zoom: ev.zoom ?? 8.5, duration: 1500 });
      setTimeout(() => setTime(ev.t + 0.01), 50);
    });
    el.appendChild(d);
  }
}

function setTime(t: number) {
  const [a, b] = timeLayer().range;
  state.time = clamp(t, a, b);
}

function setPlaying(p: boolean) {
  state.playing = p;
  $('play').classList.toggle('playing', p);
  $('play').setAttribute('aria-label', p ? 'Pause' : 'Play');
  if (p) {
    const [a, b] = timeLayer().range;
    if (state.time >= b - 0.01) state.time = a;
  }
}

let lastSparkYear = -1;
function syncTimelineUI() {
  const l = timeLayer();
  const [a, b] = l.range;
  const s = scrub();
  if (document.activeElement !== s || state.playing) s.value = String(state.time);
  s.style.setProperty('--p', `${((state.time - a) / (b - a)) * 100}%`);
  $('year').textContent = String(Math.floor(state.time));
  $('month').textContent = l.monthly || state.speed <= 1 ? MONTHS[Math.floor((state.time % 1) * 12)] : '';
  const y = Math.floor(state.time * (l.monthly ? 12 : 1));
  if (y !== lastSparkYear) {
    lastSparkYear = y;
    drawSpark();
    const sy = document.getElementById('static-year');
    if (sy) sy.textContent = String(Math.floor(state.time));
  }
}

// ---------------------------------------------------------------------------------------------
// historic event toasts

function toast(ev: AtlasEvent) {
  const stack = $('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--c', ev.layer === '*' ? '#ffffff' : byId[ev.layer]?.color ?? '#fff');
  const yr = Math.floor(ev.t);
  const mo = MONTHS[Math.floor((ev.t % 1) * 12)];
  // Event text is plain (some of it built from data, like quake places), so it goes in as text.
  for (const [cls, text] of [['td', `${mo} ${yr}`], ['tt', ev.title], ['tb', ev.body]]) {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    el.appendChild(d);
  }
  stack.prepend(el);
  while (stack.children.length > 3) stack.lastElementChild!.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 6500);
  if (ev.lon != null) state.beacons.push({ ev, born: performance.now() });
}

function fireCrossedEvents(prev: number, now: number) {
  if (now <= prev || now - prev > 1.5) return;
  // island-wide events only pop up while some history layer is on the map
  const anyTime = layers.some((l) => !l.static && l.available && state.visible.has(l.id));
  for (const ev of events) {
    if (ev.t > prev && ev.t <= now && (ev.layer === '*' ? anyTime : state.visible.has(ev.layer))) toast(ev);
  }
}

// ---------------------------------------------------------------------------------------------
// main loop

let lastFrame = performance.now();
let lastPanel = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.playing) {
    const prev = state.time;
    const [, b] = timeLayer().range;
    state.time = Math.min(b, state.time + dt * state.speed);
    fireCrossedEvents(prev, state.time);
    if (state.time >= b) setPlaying(false);
  }
  render();
  syncTimelineUI();
  if (panelHandle && now - lastPanel > 90) { lastPanel = now; panelHandle.update(ctx()); }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------------------

function bindControls() {
  $('play').addEventListener('click', () => setPlaying(!state.playing));
  scrub().addEventListener('input', () => { state.time = +scrub().value; });
  scrub().addEventListener('pointerdown', () => setPlaying(false));
  $<HTMLSelectElement>('speed-sel').addEventListener('change', (e) => { state.speed = +(e.target as HTMLSelectElement).value; });
  $('finder-btn').addEventListener('click', () => { if (state.mode === 'land') closeLandFinder(); state.mode === 'finder' ? closeFinder() : openFinder(); });
  $('land-btn').addEventListener('click', () => (state.mode === 'land' ? closeLandFinder() : openLandFinder()));
  $('about-btn').addEventListener('click', showSources);
  $('layers-btn').addEventListener('click', () => setMenu(!menuOpen()));
  $('panel-btn').addEventListener('click', () => setPanelOpen($('panel').classList.contains('collapsed')));
  document.addEventListener('pointerdown', (e) => { if (menuOpen() && !(e.target as HTMLElement).closest('.layer-picker')) setMenu(false); });
  window.addEventListener('resize', () => { drawSpark(); });
  window.addEventListener('keydown', (e) => {
    if (sourcesOpen() || (e.target as HTMLElement).matches('input, select, textarea')) return;
    if (state.mode === 'land') { if (!landKey(e) && e.key === 'Escape') closeLandFinder(); return; }
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
    const step = timeLayer().monthly ? 1 / 12 : 1;
    if (e.key === 'ArrowRight') { setPlaying(false); setTime(Math.floor(state.time / step + 1e-6) * step + step); }
    if (e.key === 'ArrowLeft') { setPlaying(false); setTime(Math.ceil(state.time / step - 1e-6) * step - step); }
    if (e.key === 'Escape') { if (menuOpen()) { setMenu(false); $('layers-btn').focus(); } else $('modal').hidden = true; }
    if (e.key === 'l' || e.key === 'L') setMenu(!menuOpen());
    if (e.key === 'p' || e.key === 'P') setPanelOpen($('panel').classList.contains('collapsed'));
    if (e.key === 's' || e.key === 'S') showSources();
  });
}

function showSources() {
  setPlaying(false);
  setMenu(false);
  openSources(data, { onShow: focus });
}

async function boot() {
  data = await loadAll();
  layers = buildLayers(data);
  setLandTrails(data.trails);
  byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  events = [...layers.flatMap((l) => (l.available ? l.events() : [])), ...CURATED_EVENTS].sort((a, b) => a.t - b.t);
  state.time = byId.fires.range[0];
  initMap();
  bindControls();
  focus('island');
  requestAnimationFrame(frame);
  window.addEventListener('atlas:outdoors', (e) => { const d = (e as CustomEvent).detail; openOutdoors(d.kind, d.i); });
  if (location.hash === '#sources') showSources();
  if (location.hash === '#trails') map.once('load', () => setTimeout(() => focus('trails'), 600));
  if (location.hash === '#land') map.once('load', () => setTimeout(openLandFinder, 600));
  // The explainer video (video/render.py) drives the atlas through this handle; only set with ?film.
  if (new URLSearchParams(location.search).has('film'))
    (window as any).atlas = { map, state, data, layers, focus, openTown, openFinder, openLandFinder, closeLandFinder, setPlaying, setTime, setPanelOpen, setMenu, showSources, openOutdoors, HOME };
}

boot();
