// House-hunting trip planner: turns the Land Finder shortlist into a day of viewings. The visiting order and the
// drives come from the public OSRM demo router's trip service (the same router the pipeline uses for drive times),
// called from the browser only when the user presses "Plan the route": the stops' coordinates and the start town go
// to router.project-osrm.org, nothing else. The plan is drawn on the map in pink (the matches use the cyan-to-yellow
// ramp) and can be opened in Google Maps or copied.
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { esc, safeUrl } from './html';

const OSRM = 'https://router.project-osrm.org';
const STORE = 'island-atlas:trip';
/** Google Maps' directions links take a start, an end and up to nine stops in between. */
const GMAPS_MAX_WAYPOINTS = 9;
/** OSRM's demo server caps a trip at 25 or so coordinates; a viewing day never needs that many. */
export const TRIP_MAX_STOPS = 12;

export type TripStop = { key: string; label: string; lon: number; lat: number };
export type TripStart = { key: string; name: string; lon: number; lat: number };
export type TripOpts = { start: string; depart: string; view: number; back: boolean };
type Leg = { min: number; km: number; ferry: boolean };
export type Trip = {
  opts: TripOpts; start: TripStart; stops: TripStop[];
  /** stops in visiting order (indices into `stops`) */
  order: number[];
  /** one leg per drive: start → first stop, …, last stop → start when it's a round trip */
  legs: Leg[];
  path: [number, number][];
};

export let tripOpts: TripOpts = { start: '', depart: '09:30', view: 45, back: true };
try {
  const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  if (s && typeof s === 'object') {
    if (typeof s.start === 'string') tripOpts.start = s.start;
    if (typeof s.depart === 'string' && /^\d{1,2}:\d{2}$/.test(s.depart)) tripOpts.depart = s.depart;
    if (Number.isFinite(s.view) && s.view >= 0 && s.view <= 240) tripOpts.view = s.view;
    if (typeof s.back === 'boolean') tripOpts.back = s.back;
  }
} catch { /* storage unavailable */ }
const saveOpts = () => { try { localStorage.setItem(STORE, JSON.stringify(tripOpts)); } catch { /* ignore */ } };

/** The plan on screen, if any (drawn by tripLayers while the shortlist is showing). */
export let trip: Trip | null = null;

/** Asks the router for the best order and the drives between the stops. */
async function planTrip(start: TripStart, stops: TripStop[], opts: TripOpts): Promise<Trip> {
  const coords = [start, ...stops].map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const q = new URLSearchParams({ source: 'first', roundtrip: String(opts.back), overview: 'full', geometries: 'geojson', steps: 'true' });
  if (!opts.back) q.set('destination', 'any');
  const res = await fetch(`${OSRM}/trip/v1/driving/${coords}?${q}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`the router answered ${res.status}`);
  const j = await res.json();
  if (j.code !== 'Ok' || !j.trips?.length) throw new Error(j.message ?? j.code ?? 'no route found');
  const t = j.trips[0];
  // waypoint i (0 = the start) sits at position waypoint_index in the trip
  const pos: number[] = j.waypoints.map((w: { waypoint_index: number }) => w.waypoint_index);
  const order = stops.map((_, i) => i).sort((a, b) => pos[a + 1] - pos[b + 1]);
  const legs: Leg[] = t.legs.map((l: { duration: number; distance: number; steps?: { mode?: string }[] }) => ({
    min: Math.max(1, Math.round(l.duration / 60)), km: Math.round(l.distance / 100) / 10,
    ferry: (l.steps ?? []).some((s) => s.mode === 'ferry'),
  }));
  return { opts: { ...opts }, start, stops, order, legs, path: t.geometry.coordinates };
}

const hhmm = (m: number) => { const d = Math.round(m) % 1440; return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`; };
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const dur = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);

/** The itinerary: one row per stop with arrival and leaving times, then the drive home. */
function itinerary(t: Trip) {
  let clock = toMin(t.opts.depart);
  const rows: { at: string; until?: string; label: string; leg: Leg; n?: number }[] = [];
  t.order.forEach((si, k) => {
    const leg = t.legs[k];
    clock += leg.min;
    const at = hhmm(clock);
    clock += t.opts.view;
    rows.push({ at, until: hhmm(clock), label: t.stops[si].label, leg, n: k + 1 });
  });
  const home = t.opts.back ? t.legs[t.order.length] : null;
  if (home) { clock += home.min; rows.push({ at: hhmm(clock), label: `Back in ${esc(t.start.name)}`, leg: home }); }
  const driving = t.legs.reduce((s, l) => s + l.min, 0), km = t.legs.reduce((s, l) => s + l.km, 0);
  return { rows, end: clock, driving, km, ferry: t.legs.some((l) => l.ferry) };
}

/** A Google Maps directions link: the start, the stops in order (up to nine in between), and home or the last stop. */
function gmapsUrl(t: Trip) {
  const pts = t.order.map((i) => `${t.stops[i].lat.toFixed(5)},${t.stops[i].lon.toFixed(5)}`);
  const origin = `${t.start.lat.toFixed(5)},${t.start.lon.toFixed(5)}`;
  const dest = t.opts.back ? origin : pts.pop()!;
  const way = pts.slice(0, GMAPS_MAX_WAYPOINTS);
  const q = new URLSearchParams({ api: '1', origin, destination: dest, travelmode: 'driving' });
  if (way.length) q.set('waypoints', way.join('|'));
  return safeUrl(`https://www.google.com/maps/dir/?${q}`);
}

function plainText(t: Trip) {
  const it = itinerary(t);
  return [
    `House-hunting trip from ${t.start.name}, leaving ${t.opts.depart}`,
    ...it.rows.map((r) => `${r.at}${r.until ? `–${r.until}` : ''}  ${r.n ? `${r.n}. ` : ''}${r.label.replace(/<[^>]+>/g, '')}  (${dur(r.leg.min)}, ${r.leg.km.toFixed(1)} km${r.leg.ferry ? ', ferry' : ''})`),
    `Driving ${dur(it.driving)}, ${Math.round(it.km)} km${it.ferry ? ' (ferry crossings timed on the water only)' : ''}`,
  ].join('\n');
}

/**
 * The planner section of the shortlist: start town, departure, minutes per viewing, round trip; then the plan.
 * `onChange` redraws the map; labels in `stops` are already escaped HTML.
 */
export function renderTripPlanner(el: HTMLElement, towns: TripStart[], stops: TripStop[], onChange: () => void) {
  if (stops.length < 2) { el.innerHTML = ''; trip = null; return; }
  const use = stops.slice(0, TRIP_MAX_STOPS);
  if (!towns.some((t) => t.key === tripOpts.start)) {
    // default: the town nearest the first shortlisted parcel
    const s0 = use[0];
    tripOpts.start = towns.reduce((a, t) => (Math.hypot(t.lon - s0.lon, t.lat - s0.lat) < Math.hypot(a.lon - s0.lon, a.lat - s0.lat) ? t : a), towns[0])?.key ?? '';
  }
  // a plan for a different set of stops is stale
  if (trip && (trip.stops.length !== use.length || trip.stops.some((s, i) => s.key !== use[i].key))) trip = null;
  const sorted = [...towns].sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `
    <h3>Plan a viewing trip</h3>
    <div class="tp-form">
      <label>Start from <select data-k="start">${sorted.map((t) => `<option value="${esc(t.key)}"${t.key === tripOpts.start ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label>Leave at <input type="time" data-k="depart" value="${tripOpts.depart}"></label>
      <label>Minutes at each <input type="number" data-k="view" min="0" max="240" step="5" value="${tripOpts.view}"></label>
      <label class="tp-check"><input type="checkbox" data-k="back"${tripOpts.back ? ' checked' : ''}> Back to the start</label>
    </div>
    <button class="ld-btn tp-go">${trip ? '↻ Re-plan' : '⇢ Plan the route'}</button>
    <p class="note">Puts your ${use.length} shortlisted parcels${stops.length > TRIP_MAX_STOPS ? ` (the first ${TRIP_MAX_STOPS} of ${stops.length})` : ''} in the quickest order. Planning sends the stops’ map coordinates and the start town to the public OSRM router (router.project-osrm.org); your notes and prices stay in this browser.</p>
    <div class="tp-out"></div>`;
  const out = el.querySelector<HTMLElement>('.tp-out')!;
  const show = () => {
    if (!trip) { out.innerHTML = ''; return; }
    const it = itinerary(trip);
    const late = it.end > 16 * 60 + 30;
    out.innerHTML = `
      <ol class="tp-list">
        <li class="tp-start"><b>${trip.opts.depart}</b><span>Leave ${esc(trip.start.name)}</span></li>
        ${it.rows.map((r) => `<li${r.n ? ` data-n="${r.n}"` : ' class="tp-start"'}><b>${r.at}${r.until ? `<i>–${r.until}</i>` : ''}</b><span>${r.n ? `<em>${r.n}</em>` : ''}${r.label}<small>${dur(r.leg.min)} · ${r.leg.km.toFixed(1)} km${r.leg.ferry ? ' · <span class="tp-ferry">⛴ ferry</span>' : ''}</small></span></li>`).join('')}
      </ol>
      <div class="tp-sum">Driving <b>${dur(it.driving)}</b> · ${Math.round(it.km)} km · done by <b>${hhmm(it.end)}</b></div>
      ${it.ferry ? '<div class="callout" style="--c:#38bdf8">The route takes a ferry: the router times the crossing, not the wait or the sailing schedule. Check BC Ferries before you go.</div>' : ''}
      ${late ? '<div class="callout" style="--c:#fde047">That runs past 4:30 pm, when it is dark by late autumn and winter: drop a stop, shorten the viewings or split it over two days.</div>' : ''}
      <div class="ld-actions">
        <a class="ld-btn" target="_blank" rel="noopener" href="${esc(gmapsUrl(trip) ?? '')}">Open in Google Maps ↗</a>
        <button class="ld-btn tp-copy">Copy the itinerary</button>
      </div>
      ${trip.order.length > GMAPS_MAX_WAYPOINTS + (trip.opts.back ? 0 : 1) ? `<p class="note">Google Maps links take ${GMAPS_MAX_WAYPOINTS} stops in between, so the last ones are left off the link.</p>` : ''}`;
    out.querySelector('.tp-copy')?.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      try { await navigator.clipboard.writeText(plainText(trip!)); b.textContent = 'Copied ✓'; } catch { b.textContent = 'Copy failed'; }
    });
  };
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.k as keyof TripOpts;
    if (k === 'back') tripOpts.back = (inp as HTMLInputElement).checked;
    else if (k === 'view') tripOpts.view = Math.max(0, Math.min(240, Math.round(+inp.value || 0)));
    else if (k === 'depart') tripOpts.depart = /^\d{1,2}:\d{2}$/.test(inp.value) ? inp.value : tripOpts.depart;
    else tripOpts.start = inp.value;
    saveOpts();
  }));
  const go = el.querySelector<HTMLButtonElement>('.tp-go')!;
  go.addEventListener('click', async () => {
    const start = towns.find((t) => t.key === tripOpts.start);
    if (!start) return;
    go.disabled = true; go.textContent = 'Planning…';
    try {
      trip = await planTrip(start, use, tripOpts);
      show();
      onChange();
    } catch (e) {
      out.innerHTML = `<div class="callout" style="--c:#f87171">Couldn’t plan the route: ${esc((e as Error).message)}. The public router is sometimes busy; try again in a minute.</div>`;
    } finally {
      go.disabled = false; go.textContent = trip ? '↻ Re-plan' : '⇢ Plan the route';
    }
  });
  show();
}

/** The planned route and numbered stops on the map. */
let drawn: { t: Trip; layers: Layer[] } | null = null;
export function tripLayers(): Layer[] {
  if (!trip) return [];
  // the frame loop asks every frame: build once per plan, so deck.gl doesn't re-upload the route
  if (drawn?.t === trip) return drawn.layers;
  const t = trip;
  const pts = t.order.map((si, k) => ({ p: [t.stops[si].lon, t.stops[si].lat] as [number, number], n: String(k + 1) }));
  const layers = [
    new PathLayer<{ path: [number, number][] }>({
      id: 'land-trip-glow', data: [{ path: t.path }], getPath: (d) => d.path, getColor: [255, 95, 162, 80], getWidth: 10, widthUnits: 'pixels',
      capRounded: true, jointRounded: true, parameters: { depthCompare: 'always' } as any,
    }),
    new PathLayer<{ path: [number, number][] }>({
      id: 'land-trip', data: [{ path: t.path }], getPath: (d) => d.path, getColor: [255, 95, 162, 240], getWidth: 3, widthUnits: 'pixels',
      capRounded: true, jointRounded: true, parameters: { depthCompare: 'always' } as any,
    }),
    new ScatterplotLayer<{ p: [number, number] }>({
      id: 'land-trip-start', data: [{ p: [t.start.lon, t.start.lat] }], getPosition: (d) => d.p, getRadius: 260, radiusMinPixels: 7,
      getFillColor: [6, 10, 18, 255], stroked: true, getLineColor: [255, 95, 162, 255], lineWidthMinPixels: 2.5, parameters: { depthCompare: 'always' } as any,
    }),
    new TextLayer<(typeof pts)[number]>({
      id: 'land-trip-stops', data: pts, getPosition: (d) => d.p, getText: (d) => d.n, getSize: 13, getColor: [8, 12, 20, 255],
      background: true, getBackgroundColor: [255, 95, 162, 250], backgroundPadding: [6, 3], fontFamily: 'Inter, sans-serif', fontWeight: 800,
      characterSet: '0123456789', parameters: { depthCompare: 'always' } as any,
    } as any),
  ];
  drawn = { t, layers };
  return layers;
}
