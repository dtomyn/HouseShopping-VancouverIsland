// Fire protection: how far each Land Finder parcel is from a fire hall by road. Run as the `firehalls` stage of
// fetch-data.mjs, after `land` (it reads land.json).
//
// Home insurers in BC rate a house by the Fire Underwriters Survey's grades, which start from the drive to the
// nearest responding fire hall: within about 8 km by road (and inside a fire protection area) a house can get a
// "protected" rating; beyond about 13 km it is usually rated unprotected, with higher premiums and fewer insurers
// willing. BC publishes no open layer of fire halls or fire protection areas (the catalogue's only candidates are
// "Access Only"), so the halls come from OpenStreetMap (amenity=fire_station, ODbL) and the distances from the
// public OSRM demo router on OpenStreetMap roads, both of which the Land Finder already uses.
//
// Writes land-fire.json: the halls, and per parcel (in land.json's order, checked with a hash of its PIDs) the road
// distance and drive time to the nearest hall on the parcel's own island, and which hall.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import simplify from '@turf/simplify';
import { overpassClient, uaFetch } from './trails.mjs';

const OSRM = 'https://router.project-osrm.org';
const CELL = 0.004; // parcels share a routing origin per ~300–450 m cell
const CANDIDATES = 4; // halls tried per origin, nearest first in a straight line
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function buildFireHalls(h) {
  const { log, cached, writeOut, round, distKm, BBOX, getIsland, OUT } = h;
  const isl = await getIsland();
  const land = JSON.parse(await fs.readFile(path.join(OUT, 'land.json'), 'utf8'));
  const overpass = overpassClient({ log, cached });

  // -------------------------------------------------------------------------------------------
  // 1. fire halls from OpenStreetMap, on the atlas's islands

  const osm = await overpass('firehalls/osm-fire-stations.json', `[out:json][timeout:240];nwr["amenity"="fire_station"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});out center tags qt;`);
  const islandNames = land.names.island;
  const parts = islandNames.map((name) => {
    const g = isl.parts.get(name);
    return g ? simplify(g, { tolerance: name === 'Vancouver Island' ? 0.002 : 0.0008, highQuality: false, mutate: false }) : null;
  });
  // a hall's point can sit just off the simplified shore: try it, then nudged ~400 m each way; small islands first
  const order = [...islandNames.keys()].slice(1).concat(0);
  const islandOf = (lon, lat) => {
    for (const d of [[0, 0], [0.005, 0], [-0.005, 0], [0, 0.004], [0, -0.004]])
      for (const k of order) if (parts[k] && booleanPointInPolygon([lon + d[0], lat + d[1]], parts[k])) return k;
    return -1;
  };
  const halls = [];
  const seen = new Set();
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    const c = e.type === 'node' ? [e.lon, e.lat] : e.center ? [e.center.lon, e.center.lat] : null;
    if (!c) continue;
    // wildfire bases, forestry and airport crash crews don't answer a house fire
    const text = `${t.name ?? ''} ${t.operator ?? ''} ${t['fire_station:type'] ?? ''}`;
    if (/wildfire|forest|BCWS|airport|aircraft|crash/i.test(text) || t.disused === 'yes' || t['disused:amenity'] || /^(no|private)$/.test(t.access ?? '')) continue;
    const island = islandOf(c[0], c[1]);
    if (island < 0) continue;
    // one point per hall: a building and its site are often both tagged
    const key = `${Math.round(c[0] / 0.002)},${Math.round(c[1] / 0.002)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    halls.push({ name: (t.name || t.operator || 'Fire hall').replace(/\s+/g, ' ').trim(), lon: round(c[0], 5), lat: round(c[1], 5), island });
  }
  if (halls.length < 40) throw new Error(`only ${halls.length} fire halls found on the islands: is OpenStreetMap's answer complete?`);
  log(`  ${halls.length} fire halls on the islands (${osm.elements.length} fire_station features in the box)`);

  // -------------------------------------------------------------------------------------------
  // 2. road distance from each parcel's cell to the nearest halls on its own island

  const n = land.count;
  const C = land.cols;
  const origins = new Map();
  const originOf = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${C.island[i]}:${Math.floor(C.lon[i] / CELL)},${Math.floor(C.lat[i] / CELL)}`;
    let o = origins.get(k);
    if (!o) { o = { island: C.island[i], lon: 0, lat: 0, n: 0, i: Math.floor(C.lon[i] / CELL), j: Math.floor(C.lat[i] / CELL) }; origins.set(k, o); }
    o.lon += C.lon[i]; o.lat += C.lat[i]; o.n++;
    originOf[i] = o;
  }
  const list = [...origins.values()].map((o) => Object.assign(o, { lon: round(o.lon / o.n, 5), lat: round(o.lat / o.n, 5) }));
  // z-order, so each batch is a compact patch sharing its candidate halls
  const z = (i, j) => { let v = 0; for (let b = 0; b < 16; b++) v |= (((i >> b) & 1) << (2 * b)) | (((j >> b) & 1) << (2 * b + 1)); return v; };
  list.sort((a, b) => z(a.i + 40000, a.j) - z(b.i + 40000, b.j));
  for (const o of list) {
    o.cand = halls.map((hh, k) => [k, hh.island === o.island ? distKm(o.lon, o.lat, hh.lon, hh.lat) : Infinity]).filter((x) => Number.isFinite(x[1])).sort((a, b) => a[1] - b[1]).slice(0, CANDIDATES).map((x) => x[0]);
  }
  const batches = [];
  let cur = { o: [], d: new Set() };
  for (const o of list) {
    const union = new Set([...cur.d, ...o.cand]);
    if (cur.o.length && (cur.o.length >= 80 || union.size > 30)) { batches.push(cur); cur = { o: [], d: new Set() }; }
    cur.o.push(o); o.cand.forEach((c) => cur.d.add(c));
  }
  if (cur.o.length) batches.push(cur);
  log(`  routing from ${list.length} origins in ${batches.length} batches`);

  let calls = 0, b = 0;
  for (const batch of batches) {
    const dst = [...batch.d];
    if (!dst.length) continue;
    const coords = [...batch.o.map((o) => `${o.lon},${o.lat}`), ...dst.map((d) => `${halls[d].lon},${halls[d].lat}`)].join(';');
    const url = `${OSRM}/table/v1/driving/${coords}?sources=${batch.o.map((_, i) => i).join(';')}&destinations=${dst.map((_, i) => batch.o.length + i).join(';')}&annotations=duration,distance`;
    const name = `firehalls/osrm/${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.json`;
    let fresh = false;
    const table = JSON.parse((await cached(name, async () => { fresh = true; await sleep(1100); return uaFetch(url, { retries: 6 }); })).toString('utf8'));
    if (fresh) calls++;
    if (table.code && table.code !== 'Ok') throw new Error(`OSRM: ${table.code} ${table.message ?? ''}`);
    batch.o.forEach((o, i) => {
      let best = null;
      dst.forEach((d, k) => {
        if (halls[d].island !== o.island) return;
        const m = table.distances?.[i]?.[k], s = table.durations?.[i]?.[k];
        if (m == null || s == null) return;
        // the router snaps a point to the nearest road; a long snap means no road reaches it
        if (!best || m < best.m) best = { m, s, d };
      });
      if (best) { o.km = round(best.m / 1000, 1); o.min = Math.max(1, Math.round(best.s / 60)); o.hall = best.d; }
    });
    if (++b % 25 === 0) log(`  ${b}/${batches.length} batches (${calls} new router calls)`);
  }

  // -------------------------------------------------------------------------------------------
  // 3. per parcel, in land.json's order

  const out = { km: [], min: [], hall: [] };
  for (let i = 0; i < n; i++) {
    const o = originOf[i];
    out.km.push(o.km ?? null); out.min.push(o.min ?? null); out.hall.push(o.hall ?? -1);
  }
  const km = out.km.filter((v) => v != null);
  const share = (f) => Math.round((100 * km.filter(f).length) / Math.max(1, km.length));
  log(`  parcels within 8 km of a hall by road: ${share((v) => v <= 8)}%, 8–13 km: ${share((v) => v > 8 && v <= 13)}%, over 13 km: ${share((v) => v > 13)}%, no route: ${n - km.length}`);
  const check = crypto.createHash('sha1').update(C.pid.join('|')).digest('hex').slice(0, 12);
  await writeOut('land-fire', {
    source: 'Fire halls from OpenStreetMap (amenity=fire_station, ODbL); road distances from the OSRM demo router on OpenStreetMap roads',
    count: n, check,
    halls: halls.map((hh) => [hh.name, hh.lon, hh.lat]),
    km: out.km, min: out.min, hall: out.hall,
  });
}
