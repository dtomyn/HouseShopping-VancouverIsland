// The richer pieces of the hike and waterfall cards in the Trails panel: a satellite "portrait" of a
// route with its line drawing itself in, the grade mix, what the climb is worth, a daylight planner,
// a waterfall's height next to familiar things, and when its stream usually runs hardest.
// Pure string builders: trails.ts places them and wires the clicks.
import { fmt } from './data';
import { esc } from './html';

type Pt = [number, number];

// ---------------------------------------------------------------------------------------------
// satellite backdrop: Esri World Imagery tiles laid out in web-mercator pixels

const TILE = 256;
const wx = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const wy = (lat: number, z: number) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; };
const SAT = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const SAT_CREDIT = 'Imagery © Esri, Maxar, Earthstar Geographics';

type Frame = { px: (p: Pt) => Pt; tiles: string; mPerPx: number };

/** The (fractional) zoom that fits every point inside W×H less padding, and the tiles that cover it, drawn from the next whole zoom up. */
function satFrame(pts: Pt[], W: number, H: number, pad: number, maxZ = 15): Frame {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of pts) { w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y); }
  const fit = (span: number, room: number) => (span > 0 ? Math.log2(Math.max(1, room) / span) : Infinity);
  const zf = Math.max(3, Math.min(maxZ, fit(wx(e, 0) - wx(w, 0), W - 2 * pad), fit(wy(s, 0) - wy(n, 0), H - 2 * pad)));
  const z = Math.ceil(zf), k = 2 ** (zf - z);
  const cx = (wx(w, z) + wx(e, z)) / 2, cy = (wy(n, z) + wy(s, z)) / 2;
  const X = (v: number) => (v - cx) * k + W / 2, Y = (v: number) => (v - cy) * k + H / 2;
  const N = 2 ** z, size = TILE * k + 0.6;
  let tiles = '';
  for (let ty = Math.floor((cy - H / 2 / k) / TILE); ty <= Math.floor((cy + H / 2 / k) / TILE); ty++) {
    if (ty < 0 || ty >= N) continue;
    for (let tx = Math.floor((cx - W / 2 / k) / TILE); tx <= Math.floor((cx + W / 2 / k) / TILE); tx++)
      tiles += `<image href="${SAT(z, ((tx % N) + N) % N, ty)}" x="${X(tx * TILE).toFixed(1)}" y="${Y(ty * TILE).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}"/>`;
  }
  const lat = (s + n) / 2;
  return { px: ([lon, la]) => [X(wx(lon, z)), Y(wy(la, z))], tiles, mPerPx: (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zf };
}

/** A scale bar between ~40 and ~110 px long. */
function scaleBar(f: Frame, x: number, y: number) {
  const nice = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
  const m = nice.find((v) => v / f.mPerPx >= 40) ?? nice[nice.length - 1];
  const len = m / f.mPerPx;
  return `<g class="trh-scale" transform="translate(${x},${y})"><path d="M0,-4V0H${len.toFixed(1)}V-4"/><text x="${(len + 6).toFixed(1)}" y="0">${m >= 1000 ? `${m / 1000} km` : `${m} m`}</text></g>`;
}

/** An SVG path through points, dropping any closer than a pixel to the last one kept. */
function pathD(pts: Pt[], f: Frame) {
  let d = '', lx = -1e9, ly = -1e9;
  pts.forEach((p, i) => {
    const [x, y] = f.px(p);
    if (i && i < pts.length - 1 && Math.hypot(x - lx, y - ly) < 1.2) return;
    d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    lx = x; ly = y;
  });
  return d;
}

let uid = 0;

/** A satellite portrait of a route: its line draws itself in behind a hiker, falls and the summit marked. */
export function routeHero(o: { W: number; H: number; parts: Pt[][]; line: Pt[]; falls: Pt[]; summit: { p: Pt; m: number } | null; color: string; loop: boolean; still: boolean; secs: number; path?: boolean }) {
  const { W, H } = o;
  const f = satFrame(o.parts.flat().concat(o.line), W, H, 34);
  const id = `trh${++uid}`;
  const line = pathD(o.line, f);
  const parts = o.parts.map((p) => pathD(p, f)).join('');
  const [sx, sy] = f.px(o.line[0]);
  const [ex, ey] = f.px(o.line[o.line.length - 1]);
  const fallDots = o.falls.map((p) => { const [x, y] = f.px(p); return `<g class="trh-fall" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle class="ring" r="5"/><circle r="4"/></g>`; }).join('');
  let summit = '';
  if (o.summit) {
    const [x, y] = f.px(o.summit.p);
    const right = x < W - 70;
    summit = `<g class="trh-summit" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><path d="M0,-9L6,1H-6Z"/><text x="${right ? 9 : -9}" y="0" text-anchor="${right ? 'start' : 'end'}">${fmt.int(o.summit.m)} m</text></g>`;
  }
  const dur = o.secs.toFixed(1);
  return `<svg class="trh${o.path ? ' path' : ''}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Satellite view of the route" style="--c:${o.color};--dur:${dur}s">
    <defs>
      <linearGradient id="${id}v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#060a12" stop-opacity=".35"/><stop offset=".45" stop-color="#060a12" stop-opacity="0"/><stop offset="1" stop-color="#090e1a" stop-opacity=".92"/></linearGradient>
      <filter id="${id}g" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.5"/></filter>
    </defs>
    <g class="trh-sat">${f.tiles}</g>
    <rect width="${W}" height="${H}" fill="url(#${id}v)"/>
    <path class="trh-parts" d="${parts}"/>
    <path class="trh-glow" d="${line}" filter="url(#${id}g)"/>
    <path class="trh-line" d="${line}" pathLength="1"/>
    ${fallDots}
    ${summit}
    ${o.loop ? '' : `<g class="trh-end" transform="translate(${ex.toFixed(1)},${ey.toFixed(1)})"><circle r="5"/></g>`}
    <g class="trh-start" transform="translate(${sx.toFixed(1)},${sy.toFixed(1)})"><circle class="ring" r="6"/><circle r="3.5"/></g>
    ${o.still ? '' : `<g class="trh-hiker"><circle class="halo" r="9"/><circle r="4.5"/><animateMotion dur="${dur}s" repeatCount="indefinite" path="${line}"/></g>`}
    ${scaleBar(f, 14, H - 12)}
    <text class="trh-cr" x="${W - 8}" y="${H - 8}" text-anchor="end">${SAT_CREDIT}</text>
  </svg>`;
}

/** A close satellite view of a waterfall with ripples spreading from it (for falls with no photo). */
export function fallHero(o: { W: number; H: number; p: Pt; still: boolean }) {
  const { W, H } = o;
  const f = satFrame([o.p], W, H, 0, 15);
  const [x, y] = f.px(o.p);
  const id = `trh${++uid}`;
  const ring = (k: number) => o.still ? '' : `<circle class="rp" r="8"><animate attributeName="r" from="6" to="70" dur="3s" begin="${k}s" repeatCount="indefinite"/><animate attributeName="opacity" from=".9" to="0" dur="3s" begin="${k}s" repeatCount="indefinite"/></circle>`;
  return `<svg class="trh fall" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Satellite view around the waterfall">
    <defs><linearGradient id="${id}v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#060a12" stop-opacity=".2"/><stop offset=".5" stop-color="#060a12" stop-opacity="0"/><stop offset="1" stop-color="#090e1a" stop-opacity=".92"/></linearGradient></defs>
    <g class="trh-sat">${f.tiles}</g>
    <rect width="${W}" height="${H}" fill="url(#${id}v)"/>
    <g class="trh-pin" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">${ring(0)}${ring(1)}${ring(2)}<circle class="core" r="6"/></g>
    ${scaleBar(f, 14, H - 12)}
    <text class="trh-cr" x="${W - 8}" y="${H - 8}" text-anchor="end">${SAT_CREDIT}</text>
  </svg>`;
}

// ---------------------------------------------------------------------------------------------
// the route's character

const MIX = [
  { k: 'Steep climb', c: '#fb7185', t: 'over 12%' },
  { k: 'Climb', c: '#fcd34d', t: '5–12%' },
  { k: 'Rolling', c: '#6ee7b7', t: 'within ±5%' },
  { k: 'Descent', c: '#7dd3fc', t: '5–12% down' },
  { k: 'Steep descent', c: '#a78bfa', t: 'over 12% down' },
];

/** How much of the route climbs, rolls or drops, and its steepest kilometre (or half, on a short walk). */
export function gradeMix(prof: number[], totalKm: number) {
  const step = (totalKm * 1000) / Math.max(1, prof.length - 1);
  const m = [0, 0, 0, 0, 0];
  for (let i = 1; i < prof.length; i++) {
    const g = (prof[i] - prof[i - 1]) / step;
    m[g > 0.12 ? 0 : g > 0.05 ? 1 : g >= -0.05 ? 2 : g >= -0.12 ? 3 : 4] += step;
  }
  const sum = m.reduce((a, b) => a + b, 0) || 1;
  const winM = Math.min(1000, (totalKm * 1000) / 2);
  const w = Math.max(1, Math.round(winM / step));
  let best = -Infinity, at = 0;
  for (let i = 0; i + w < prof.length; i++) { const g = (prof[i + w] - prof[i]) / (w * step); if (g > best) { best = g; at = i; } }
  const html = `<div class="tr-mix" role="img" aria-label="${MIX.map((x, i) => `${x.k} ${Math.round((m[i] / sum) * 100)}%`).join(', ')}">${MIX.map((x, i) => (m[i] / sum > 0.004 ? `<i style="flex:${(m[i] / sum).toFixed(4)};background:${x.c}" title="${x.k} (${x.t}): ${Math.round((m[i] / sum) * 100)}%"></i>` : '')).join('')}</div>
    <div class="tr-mix-k">${MIX.map((x, i) => (m[i] / sum > 0.004 ? `<span><i style="background:${x.c}"></i>${x.k} <b>${Math.round((m[i] / sum) * 100)}%</b></span>` : '')).join('')}</div>
    ${best > 0.02 ? `<div class="tr-steep"><span class="tr-steep-v">${Math.round(best * 100)}%</span><span>average grade over the steepest ${winM >= 1000 ? 'kilometre' : `${Math.round(winM)} m`}, starting <b>${((at * step) / 1000).toFixed(1)} km</b> in${best > 0.2 ? ' — hands-on-knees steep' : best > 0.12 ? ' — a proper grind' : ''}</span></div>` : ''}`;
  return html;
}

/** What the climb and the distance add up to, for a 70 kg walker. */
export function effortTiles(kmTotal: number, up: number) {
  const floors = Math.round(up / 3);
  const kcal = Math.round((56 * kmTotal + 0.66 * up) / 10) * 10;
  const steps = Math.round((kmTotal * 1350) / 100) * 100;
  const tile = (ic: string, v: string, l: string) => `<div class="tr-eq-t"><span class="tr-eq-ic">${ic}</span><b>${v}</b><small>${l}</small></div>`;
  return `<div class="tr-eq">
    ${tile('🪜', fmt.int(floors), floors === 1 ? 'storey of stairs' : 'storeys of stairs')}
    ${tile('👣', fmt.int(steps), 'steps, roughly')}
    ${tile('🔥', fmt.int(kcal), 'kcal for a 70 kg hiker')}
  </div>`;
}

// ---------------------------------------------------------------------------------------------
// daylight planner

const TZ = 'America/Vancouver';
const rad = Math.PI / 180;

/** Sunrise and sunset (with refraction) on a date at a place; null in polar day or night. Per the suncalc algorithm. */
export function sunTimes(date: Date, lat: number, lon: number): { rise: Date; set: Date } | null {
  const J2000 = 2451545;
  const toDays = (ms: number) => ms / 864e5 - 0.5 + 2440588 - J2000;
  const fromJ = (j: number) => new Date((j + 0.5 - 2440588) * 864e5);
  const lw = -lon * rad, phi = lat * rad;
  const d0 = toDays(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 20));
  const n = Math.round(d0 - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));
  const transit = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cw = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cw < -1 || cw > 1) return null;
  const w = Math.acos(cw);
  const set = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { rise: fromJ(transit - (set - transit)), set: fromJ(set) };
}

const clockFmt = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'short', timeZone: TZ });
/** Hours since local midnight on the island. */
const localH = (d: Date) => { const p = Object.fromEntries(clockFmt.formatToParts(d).map((x) => [x.type, x.value])); return (+p.hour % 24) + +p.minute / 60; };
const hm = (h: number) => { h = ((h % 24) + 24) % 24; const m = Math.round(h * 60); return `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`; };
const dur = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };

/** Today's light at the trailhead on a 24-hour bar, with the latest start that still finishes by sunset. */
export function daylightCard(hrs: number, loop: boolean, lat: number, lon: number, now = new Date()) {
  const t = sunTimes(now, lat, lon);
  if (!t) return '';
  const rise = localH(t.rise), set = localH(t.set), light = set - rise;
  const nowH = localH(now);
  const pct = (h: number) => `${((h / 24) * 100).toFixed(2)}%`;
  const multi = hrs >= 10;
  const both = !loop && hrs * 2 < light;
  const fits = hrs <= light;
  const start = set - hrs;
  const june = sunTimes(new Date(Date.UTC(now.getUTCFullYear(), 5, 21)), lat, lon);
  const juneLight = june ? localH(june.set) - localH(june.rise) : null;
  let msg: string;
  if (multi) msg = `A multi-day trip: at this time of year you get <b>${dur(light)}</b> of walking light a day, so plan camps around sunset at ${hm(set)}.`;
  else if (fits) msg = `Leave the trailhead by <b>${hm(Math.max(rise, start))}</b> to finish ${loop ? 'the loop' : 'one way'} before sunset${both ? `, or by <b>${hm(set - hrs * 2)}</b> to walk there and back` : ''}.`;
  else msg = `It needs about ${hrsShort(hrs)}, more than today’s ${dur(light)} of light. Bring a headlamp${juneLight && juneLight > hrs ? `, or come back around 21 June, when there’s ${dur(juneLight)}` : ''}.`;
  const block = !multi && fits ? `<i class="tr-sun-hike" style="left:${pct(Math.max(rise, start))};width:${pct(Math.min(hrs, light))}"></i>${both ? `<i class="tr-sun-hike two" style="left:${pct(set - hrs * 2)};width:${pct(hrs * 2)}"></i>` : ''}` : '';
  return `<div class="tr-sun">
    <div class="tr-sun-top"><span>☀ ${dayFmt.format(now)} at the trailhead</span><span><b>${dur(light)}</b> of daylight</span></div>
    <div class="tr-sun-bar"><i class="tr-sun-day" style="left:${pct(rise)};width:${pct(light)}"></i>${block}<i class="tr-sun-now" style="left:${pct(nowH)}" title="now"></i></div>
    <div class="tr-sun-ax"><span>0:00</span><span style="left:${pct(rise)}">↑ ${hm(rise)}</span><span style="left:${pct(set)}">↓ ${hm(set)}</span><span>24:00</span></div>
    <p>${msg}</p>
  </div>`;
}
const hrsShort = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1).replace(/\.0$/, '')} h`);

// ---------------------------------------------------------------------------------------------
// waterfalls

/** The fall's drop drawn next to a person, a house, Niagara and the island's tallest, picking the ones near its size. */
export function heightCompare(h: number, name: string, tallest: { name: string; h: number } | null, W = 340) {
  type Ref = { n: string; h: number; kind: 'person' | 'house' | 'fall'; me?: boolean };
  const refs: Ref[] = [
    { n: 'You', h: 1.8, kind: 'person' },
    { n: 'House', h: 8, kind: 'house' },
    { n: 'Niagara', h: 51, kind: 'fall' },
  ];
  if (tallest && tallest.h > 60 && Math.abs(tallest.h - h) > 1) refs.push({ n: tallest.name, h: tallest.h, kind: 'fall' });
  const below = refs.filter((r) => r.h < h).slice(-2);
  const above = refs.find((r) => r.h > h);
  const items: Ref[] = [...below, { n: name, h, kind: 'fall', me: true }, ...(above ? [above] : [])];
  if (!items.some((r) => r.kind === 'person')) items.unshift(refs[0]);
  const H = 178, top = 34, base = H - 22;
  const max = Math.max(...items.map((r) => r.h));
  const y = (v: number) => (v / max) * (base - top);
  const colW = W / items.length;
  const id = `hc${++uid}`;
  const cols = items.map((r, i) => {
    const cx = colW * i + colW / 2, hh = Math.max(r.kind === 'person' ? 6 : 2, y(r.h)), bw = Math.min(44, colW * 0.5);
    let shape = '';
    if (r.kind === 'person') { const s = hh; shape = `<g class="hc-person" transform="translate(${cx},${base})"><circle cx="0" cy="${-s * 0.88}" r="${Math.max(1.2, s * 0.12)}"/><path d="M0,${-s * 0.76}V${-s * 0.38}M0,${-s * 0.38}L${-s * 0.16},0M0,${-s * 0.38}L${s * 0.16},0M${-s * 0.2},${-s * 0.62}H${s * 0.2}"/></g>`; }
    else if (r.kind === 'house') shape = `<path class="hc-house" d="M${cx - bw / 2},${base}V${base - hh * 0.62}L${cx},${base - hh}L${cx + bw / 2},${base - hh * 0.62}V${base}Z"/>`;
    else shape = `<rect class="hc-fall${r.me ? ' me' : ''}" x="${cx - bw / 2}" y="${base - hh}" width="${bw}" height="${hh}" rx="2" fill="url(#${id}${r.me ? 'm' : 'o'})"/>${r.me ? `<ellipse class="hc-mist" cx="${cx}" cy="${base}" rx="${bw * 0.8}" ry="5"/>` : ''}`;
    const ly = Math.max(14, base - hh - 8);
    return `${shape}<text class="hc-v${r.me ? ' me' : ''}" x="${cx}" y="${ly}" text-anchor="middle">${r.h < 10 ? r.h.toFixed(1).replace(/\.0$/, '') : Math.round(r.h)} m</text><text class="hc-n${r.me ? ' me' : ''}" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(trunc(r.n, Math.floor(colW / 6.2)))}</text>`;
  }).join('');
  const stripes = (k: string, a: number) => `<pattern id="${id}${k}" width="8" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="16" fill="rgba(139,227,255,${a * 0.5})"/><rect x="1" width="2" height="9" fill="rgba(235,250,255,${a})"/><rect x="5" y="7" width="2" height="7" fill="rgba(235,250,255,${a * 0.8})"/><animateTransform attributeName="patternTransform" type="translate" from="0 0" to="0 16" dur="${k === 'm' ? 0.55 : 0.9}s" repeatCount="indefinite"/></pattern>`;
  const storeys = Math.round(h / 3);
  const line = h > 60 ? `That’s <b>${(h / 51).toFixed(1)}×</b> the drop of Niagara’s Horseshoe Falls, or a <b>${fmt.int(storeys)}-storey</b> tower.` : h > 9 ? `As tall as a <b>${storeys}-storey</b> building${h > 40 ? ', near enough Niagara’s 51 m Horseshoe Falls' : ''}.` : `About <b>${Math.max(1, Math.round(h / 1.8))}</b> people standing on each other’s shoulders.`;
  return `<svg class="hc" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(name)} is ${Math.round(h)} m tall"><defs>${stripes('m', 0.95)}${stripes('o', 0.35)}</defs><line class="hc-base" x1="0" x2="${W}" y1="${base}" y2="${base}"/>${cols}</svg><p class="tr-flow-p">${line}</p>`;
}
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(3, n - 1))}…` : s);

const MONTHS = 'JFMAMJJASOND';
/** When the stream usually runs hardest: winter rain for low falls, spring snowmelt for high ones. A rule of thumb, not a gauge. */
export function flowCalendar(elev: number, now = new Date()) {
  const snow = elev >= 700;
  const lv = snow ? [1, 1, 1, 2, 3, 3, 2, 1, 1, 2, 2, 1] : [3, 3, 3, 2, 2, 1, 1, 0, 1, 2, 3, 3];
  const mo = now.getMonth();
  return `<div class="tr-flow" role="img" aria-label="Usual flow by month">${lv.map((v, i) => `<div class="${i === mo ? 'now' : ''}" style="--k:${i}"><i style="height:${[14, 38, 68, 100][v]}%;opacity:${[0.35, 0.55, 0.8, 1][v]}"></i><span>${MONTHS[i]}</span></div>`).join('')}</div>
    <p class="tr-flow-p">${snow ? `At ${fmt.int(elev)} m this stream is likely <b>snow-fed</b>: it tends to roar in the May–June melt, run low in a winter freeze and dwindle by late summer.` : `A low, <b>rain-fed</b> coastal stream: it tends to run hardest in the November–March storms and can shrink to a trickle by August.`} ${[snow ? [4, 5] : [10, 11, 0, 1, 2]].flat().includes(mo) ? 'You’re in peak season now.' : ''}</p>`;
}
