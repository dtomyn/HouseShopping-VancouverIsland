// Winter sun: how many hours of direct sun a place gets on the shortest days once the hills are in the way. Run as
// the `sun` stage of fetch-data.mjs, after `land` (it reads land.json).
//
// A south-facing bench gets the whole short winter day; a lot at the foot of a north slope, or deep in a valley,
// can go weeks without the sun clearing the ridge. The stage traces each spot's skyline from terrain (Mapzen
// Terrarium tiles at z11, ~50 m pixels, the same tiles the Land Finder's slope and elevation come from): 61 rays,
// east through south to west, out to 25 km, with the earth's curvature and normal refraction. Then it walks the
// sun across the sky on four dates and counts the minutes it is above both the horizon and that skyline.
//
// Dates (by the sun's declination): 21 December (−23.44°), late January and late November (−20°), late February and
// late October (−10.5°), and the equinoxes (0°). Trees, buildings and cloud are not counted: this is the sun the
// land itself lets through, the most a spot could get.
//
// Outputs:
//  - land-sun.json: per Land Finder parcel (in land.json's order, checked with a hash of its PIDs), the hours at the
//    sunniest of up to 7 spots on the parcel on each date, in tenths of an hour
//  - sun.json: per town, the median 21 December hours over the ground within 1.5 km of the centre, the share of that
//    ground with under an hour, and the centre itself

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeTerrarium } from './land.mjs';
import { uaFetch } from './trails.mjs';

const Z = 11;
const N = 2 ** Z;
const AZ0 = 90, AZ_STEP = 3, AZ_N = 61; // rays every 3° from east (90°) through south to west (270°)
const MAX_D = 25000; // m
const EYE = 2; // m above the ground: a person, or a ground-floor window
const PEAK = 2200; // m, above the island's highest summit: past this angle nothing further out can rise
const R_EFF = 6371000 / 0.87; // earth radius stretched for normal refraction
export const SUN_DATES = [
  { id: 'dec', label: '21 December', decl: -23.44 },
  { id: 'jan', label: 'late January and November', decl: -20 },
  { id: 'feb', label: 'late February and October', decl: -10.5 },
  { id: 'mar', label: 'the equinoxes', decl: 0 },
];
const H_STEP = 1; // degrees of hour angle (4 minutes)
const rad = Math.PI / 180;

const tileX = (lon) => ((lon + 180) / 360) * N;
const tileY = (lat) => { const r = lat * rad; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };

export async function buildSun(h) {
  const { log, cached, writeOut, round, pool, BBOX, onIsland, OUT, PLACES } = h;
  await h.getIsland();
  const land = JSON.parse(await fs.readFile(path.join(OUT, 'land.json'), 'utf8'));

  // -------------------------------------------------------------------------------------------
  // 1. one elevation mosaic over the whole box (the Land Finder's tiles are reused from the same cache)

  const x0 = Math.floor(tileX(BBOX.west)), x1 = Math.floor(tileX(BBOX.east));
  const y0 = Math.floor(tileY(BBOX.north)), y1 = Math.floor(tileY(BBOX.south));
  const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
  const dem = new Float32Array(W * H);
  const keys = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push([x, y]);
  log(`  terrain: ${keys.length} tiles at z${Z} (${W}×${H} px)`);
  let got = 0;
  await pool(keys, 6, async ([x, y]) => {
    const buf = await cached(`land/dem/${Z}-${x}-${y}.png`, () => uaFetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`, { headers: { Accept: 'image/png' } }));
    const t = decodeTerrarium(buf);
    const ox = (x - x0) * 256, oy = (y - y0) * 256;
    for (let r = 0; r < 256; r++) dem.set(t.subarray(r * 256, r * 256 + 256), (oy + r) * W + ox);
    if (++got % 100 === 0) log(`  terrain ${got}/${keys.length}`);
  });
  const elev = (lon, lat) => {
    const px = Math.floor((tileX(lon) - x0) * 256), py = Math.floor((tileY(lat) - y0) * 256);
    if (px < 0 || py < 0 || px >= W || py >= H) return 0;
    return Math.max(0, dem[py * W + px]); // the sea is at 0
  };

  // -------------------------------------------------------------------------------------------
  // 2. the sun's path on each date, per 0.05° band of latitude: [altitude°, ray index (fractional)] every 4 minutes

  const paths = new Map();
  const sunPath = (lat) => {
    const band = Math.round(lat / 0.05);
    let p = paths.get(band);
    if (p) return p;
    const phi = band * 0.05 * rad;
    p = SUN_DATES.map(({ decl }) => {
      const d = decl * rad, pts = [];
      for (let Hd = -180; Hd <= 180; Hd += H_STEP) {
        const Hr = Hd * rad;
        const alt = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(Hr)) / rad;
        if (alt <= -0.5) continue; // allow for refraction at the horizon
        const az = (Math.atan2(Math.sin(Hr), Math.cos(Hr) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) / rad + 180 + 360) % 360;
        pts.push(alt, Math.max(0, Math.min(AZ_N - 1, (az - AZ0) / AZ_STEP)));
      }
      return Float32Array.from(pts);
    });
    paths.set(band, p);
    return p;
  };

  // -------------------------------------------------------------------------------------------
  // 3. a spot's skyline and its hours of sun

  const SIN = Float64Array.from({ length: AZ_N }, (_, k) => Math.sin((AZ0 + k * AZ_STEP) * rad));
  const COS = Float64Array.from({ length: AZ_N }, (_, k) => Math.cos((AZ0 + k * AZ_STEP) * rad));
  const sky = new Float32Array(AZ_N);
  /** hours of direct sun at a spot on each date (unrounded) */
  function hoursAt(lon, lat) {
    const e0 = elev(lon, lat) + EYE;
    // march in mosaic pixels: Mercator's scale hardly changes over 25 km
    const gx = (tileX(lon) - x0) * 256, gy = (tileY(lat) - y0) * 256;
    const s = (N * 256) / (40075016.686 * Math.cos(lat * rad)); // pixels per metre
    for (let k = 0; k < AZ_N; k++) {
      let best = -1;
      const sx = SIN[k] * s, sy = -COS[k] * s;
      for (let d = 40; d < MAX_D; d += Math.max(40, d * 0.07)) {
        if ((PEAK - e0) / d <= best) break;
        const px = Math.floor(gx + d * sx), py = Math.floor(gy + d * sy);
        const e = px < 0 || py < 0 || px >= W || py >= H ? 0 : Math.max(0, dem[py * W + px]);
        const t = (e - e0 - (d * d) / (2 * R_EFF)) / d;
        if (t > best) best = t;
      }
      sky[k] = Math.atan(best) / rad;
    }
    return sunPath(lat).map((pts) => {
      let n = 0;
      for (let j = 0; j < pts.length; j += 2) {
        const f = pts[j + 1], k = Math.floor(f), w = f - k;
        const horizon = Math.max(-0.5, k + 1 < AZ_N ? sky[k] * (1 - w) + sky[k + 1] * w : sky[k]);
        if (pts[j] > horizon) n++;
      }
      return (n * H_STEP * 4) / 60;
    });
  }

  // -------------------------------------------------------------------------------------------
  // 4. parcels: the sunniest of the centre and up to six spots spread over the land

  const n = land.count;
  const cols = Object.fromEntries(SUN_DATES.map((s) => [s.id, []]));
  const inRing = (x, y, ring) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const enc = land.shapes[i][0];
    const spots = [[land.cols.lon[i], land.cols.lat[i]]];
    if (enc) {
      const ring = [];
      let x = 0, y = 0;
      for (let j = 0; j < enc.length; j += 2) { x += enc[j]; y += enc[j + 1]; ring.push([x / 1e5, y / 1e5]); }
      let b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [px, py] of ring) b = [Math.min(b[0], px), Math.min(b[1], py), Math.max(b[2], px), Math.max(b[3], py)];
      // a 3×3 lattice over the bounding box, keeping the points that fall on the land (at most six)
      for (let a = 1; a <= 3 && spots.length < 7; a++) for (let c = 1; c <= 3 && spots.length < 7; c++) {
        if (a === 2 && c === 2) continue;
        const px = b[0] + ((b[2] - b[0]) * a) / 4, py = b[1] + ((b[3] - b[1]) * c) / 4;
        if (inRing(px, py, ring)) spots.push([px, py]);
      }
    }
    let best = null;
    for (const [lon, lat] of spots) {
      const hrs = hoursAt(lon, lat);
      if (!best || hrs[0] > best[0] + 1e-6 || (Math.abs(hrs[0] - best[0]) < 1e-6 && hrs[3] > best[3])) best = hrs;
    }
    SUN_DATES.forEach((s, k) => cols[s.id].push(Math.round(best[k] * 10)));
    if ((i + 1) % 5000 === 0) log(`  parcels ${i + 1}/${n} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  const dec = cols.dec.map((v) => v / 10).sort((a, b) => a - b);
  const q = (p) => dec[Math.floor(p * (dec.length - 1))];
  log(`  parcels, 21 December at the sunniest spot: median ${q(0.5)} h, 10th percentile ${q(0.1)} h; ${dec.filter((v) => v < 1).length} parcels under an hour`);

  // -------------------------------------------------------------------------------------------
  // 5. towns: the ground within 1.5 km of the centre, on a 250 m grid

  const towns = {};
  for (const m of PLACES) {
    const mx = 111320 * Math.cos(m.lat * rad);
    const vals = [];
    for (let dy = -1500; dy <= 1500; dy += 250) for (let dx = -1500; dx <= 1500; dx += 250) {
      if (dx * dx + dy * dy > 1500 * 1500) continue;
      const lon = m.lon + dx / mx, lat = m.lat + dy / 110540;
      if (!onIsland(lon, lat)) continue;
      vals.push(hoursAt(lon, lat)[0]);
    }
    const centre = hoursAt(m.lon, m.lat);
    vals.sort((a, b) => a - b);
    const flat = flatHours(m.lat, SUN_DATES[0].decl);
    towns[m.key] = {
      dec: vals.length ? round(vals[Math.floor(vals.length / 2)], 1) : round(centre[0], 1),
      under1: vals.length ? Math.round((100 * vals.filter((v) => v < 1).length) / vals.length) : null,
      centre: centre.map((v) => round(v, 1)),
      flat: round(flat, 1),
      n: vals.length,
    };
  }
  const tv = Object.entries(towns).sort((a, b) => a[1].dec - b[1].dec);
  log(`  towns, least winter sun: ${tv.slice(0, 6).map(([k, v]) => `${k} ${v.dec} h`).join(', ')}; most: ${tv.slice(-4).map(([k, v]) => `${k} ${v.dec} h`).join(', ')}`);

  const check = crypto.createHash('sha1').update(land.cols.pid.join('|')).digest('hex').slice(0, 12);
  const source = 'Worked out from Mapzen Terrarium terrain tiles (z11, ~50 m) and the sun’s path: hours of direct sun once the hills’ skyline is in the way; trees, buildings and cloud not counted';
  await writeOut('land-sun', { source, count: n, check, dates: SUN_DATES, ...cols });
  await writeOut('sun', { source, dates: SUN_DATES, towns });
}

/** Hours the sun is up on flat open ground (the same 4-minute steps, so it compares like for like). */
function flatHours(lat, decl) {
  const phi = lat * rad, d = decl * rad;
  let n = 0;
  for (let Hd = -180; Hd <= 180; Hd += H_STEP) {
    const alt = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(Hd * rad)) / rad;
    if (alt > -0.5) n++;
  }
  return (n * H_STEP * 4) / 60;
}
