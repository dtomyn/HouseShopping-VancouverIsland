// Water access and camping: two small point layers for the Outdoors menu. Run as the `water` and `camping`
// stages of fetch-data.mjs, after `island`, whose outline they clip to.
//
//   water    beaches, named public beach accesses, boat launches and marinas from OpenStreetMap (Overpass, ODbL),
//            and Fisheries and Oceans Canada's Small Craft Harbours (ArcGIS REST, OGL-Canada). Writes water.json:
//            every point, which island it is on, and each town's nearest beach, boat launch and moorage.
//   camping  Recreation Sites and Trails BC sites (BC Data Catalogue WFS, OGL-BC) and campgrounds from OpenStreetMap
//            (tourism=camp_site|caravan_site), sorted into BC Parks, national park, rec site and other campgrounds
//            by the park boundaries the `neighbours` stage also reads (same WFS cache). Writes camping.json.
//
// Distances are straight lines, and a town or parcel on one of the small islands only counts points on its own
// island (a beach across the channel isn't a walk away). The Land Finder works out its per-parcel distances from
// water.json in the browser, so there's no per-parcel file.

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import simplify from '@turf/simplify';
import { overpassClient, uaFetch } from './trails.mjs';
import { pager } from './neighbours.mjs';

const DFO = 'https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/open_data_donnees_ouvertes/small_craft_harbours_en/MapServer';
const NEAR_TOWN_KM = 3; // points off the atlas's islands are kept only this close to a town centre (Alert Bay's Cormorant Island)
const NUDGE = 0.006; // ~500 m: shoreline points (a slipway, a marina's centre over the water) count for the island beside them

export const WATER_KINDS = [
  { id: 'beach', label: 'Sea beach' },
  { id: 'lake', label: 'Lake or river beach' },
  { id: 'access', label: 'Beach access' },
  { id: 'launch', label: 'Boat launch' },
  { id: 'marina', label: 'Marina' },
  { id: 'harbour', label: 'Public harbour (DFO)' },
];
export const CAMP_KINDS = [
  { id: 'park', label: 'BC Parks campground' },
  { id: 'national', label: 'National park campground' },
  { id: 'rec', label: 'Recreation site campground' },
  { id: 'other', label: 'Private, regional or other campground' },
  { id: 'day', label: 'Recreation site (day use)' },
];

const blocked = (t) => /^(private|no)$/.test(t.access ?? '');
const int = (v) => (v != null && /^\d+$/.test(String(v).trim()) ? +String(v).trim() : null);
const clean = (s, max = 400) => {
  if (s == null) return null;
  const t = String(s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
};
const title = (s) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);
/** Drop null and empty fields, so the JSON stays small. */
const compact = (o) => { const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '')); return Object.keys(out).length ? out : null; };
const osmRef = (e) => `${e.type[0]}${e.id}`;
const at = (e) => (e.type === 'node' ? [e.lon, e.lat] : e.center ? [e.center.lon, e.center.lat] : null);

/** Which of the atlas's islands a point is on (0 Vancouver Island, then the small islands in ISLAND_COMMUNITIES order). */
async function islandFinder(h) {
  const { getIsland, ISLAND_COMMUNITIES, PLACES, distKm } = h;
  const isl = await getIsland();
  const names = ['Vancouver Island', ...ISLAND_COMMUNITIES.map((c) => c.fwa)];
  const parts = names.map((name) => {
    const f = simplify(isl.parts.get(name), { tolerance: name === 'Vancouver Island' ? 0.002 : 0.0008, highQuality: false, mutate: false });
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polys) for (const [x, y] of poly[0]) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    return { name, f, polys, b: [b[0] - NUDGE, b[1] - NUDGE, b[2] + NUDGE, b[3] + NUDGE] };
  });
  // the small islands first: their boxes sit inside Vancouver Island's
  const order = [...parts.keys()].slice(1).concat(0);
  const OTHER = names.length;
  const on = (k, lon, lat) => {
    const p = parts[k];
    if (lon < p.b[0] || lon > p.b[2] || lat < p.b[1] || lat > p.b[3]) return false;
    if (booleanPointInPolygon([lon, lat], p.f)) return true;
    for (const [dx, dy] of [[NUDGE, 0], [-NUDGE, 0], [0, NUDGE], [0, -NUDGE], [NUDGE, NUDGE], [-NUDGE, -NUDGE], [NUDGE, -NUDGE], [-NUDGE, NUDGE]])
      if (booleanPointInPolygon([lon + dx, lat + dy], p.f)) return true;
    return false;
  };
  /** island index, OTHER for a point near a town but off the atlas's islands, -1 to drop it */
  const isleOf = (lon, lat) => {
    for (const k of order) if (on(k, lon, lat)) return k;
    return PLACES.some((m) => distKm(lon, lat, m.lon, m.lat) <= NEAR_TOWN_KM) ? OTHER : -1;
  };
  const placeIsle = (m) => (m.fwa ? names.indexOf(m.fwa) : 0);

  // shoreline segments of every island, bucketed, for "how far is this from the sea"
  const CELL = 0.05, segs = new Map();
  for (const p of parts) for (const poly of p.polys) {
    const ring = poly[0];
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
      for (let x = Math.floor(Math.min(ax, bx) / CELL); x <= Math.floor(Math.max(ax, bx) / CELL); x++)
        for (let y = Math.floor(Math.min(ay, by) / CELL); y <= Math.floor(Math.max(ay, by) / CELL); y++) {
          const k = `${x},${y}`;
          if (!segs.has(k)) segs.set(k, []);
          segs.get(k).push([ax, ay, bx, by]);
        }
    }
  }
  const KX = 111.32 * Math.cos((49.5 * Math.PI) / 180), KY = 110.54;
  /** km to the nearest coastline of the atlas's islands (searched up to ~5 km) */
  const coastKm = (lon, lat) => {
    let best = Infinity;
    const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (const [ax, ay, bx, by] of segs.get(`${x},${y}`) ?? []) {
          const ux = (bx - ax) * KX, uy = (by - ay) * KY, px = (lon - ax) * KX, py = (lat - ay) * KY;
          const L = ux * ux + uy * uy, t = L ? Math.max(0, Math.min(1, (px * ux + py * uy) / L)) : 0;
          best = Math.min(best, Math.hypot(px - t * ux, py - t * uy));
        }
    return best;
  };
  return { names, OTHER, isleOf, placeIsle, coastKm };
}

/** The nearest row (of the given kinds) to a place, on the same island; [index, km] or null. */
function nearest(rows, kinds, lon, lat, isle, OTHER, distKm) {
  let bi = -1, bd = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!kinds.includes(r[2])) continue;
    if (isle === 0 ? r[3] !== 0 && r[3] !== OTHER : r[3] !== isle) continue;
    const d = distKm(lon, lat, r[0], r[1]);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi < 0 ? null : [bi, Math.round(bd * 10) / 10];
}
const countWithin = (rows, kinds, lon, lat, isle, OTHER, km, distKm) =>
  rows.filter((r) => kinds.includes(r[2]) && (isle === 0 ? r[3] === 0 || r[3] === OTHER : r[3] === isle) && distKm(lon, lat, r[0], r[1]) <= km).length;

/** Drop a point that repeats one of the same kind within `m` metres (a slipway mapped as a node and a way), keeping the named one. */
function dedupe(rows, m, distKm) {
  const out = [];
  for (const r of [...rows].sort((a, b) => (b[4] ? 1 : 0) - (a[4] ? 1 : 0))) {
    if (out.some((o) => o[2] === r[2] && distKm(o[0], o[1], r[0], r[1]) * 1000 < m && (!o[4] || !r[4] || o[4] === r[4]))) continue;
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// water access

export async function buildWater(h) {
  const { log, cached, writeOut, round, distKm, BBOX, PLACES } = h;
  const isl = await islandFinder(h);
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const osm = overpassClient(h);
  const j = await osm('outdoors/osm-water.json', `[out:json][timeout:300];(nwr["natural"="beach"](${bbox});nwr["leisure"="slipway"](${bbox});nwr["leisure"="marina"](${bbox});nwr["name"~"[Bb]each [Aa]ccess"](${bbox}););out center tags;`);
  log(`  ${j.elements.length} OpenStreetMap beaches, slipways, marinas and beach accesses in the box`);

  const K = Object.fromEntries(WATER_KINDS.map((k, i) => [k.id, i]));
  let rows = [], skipped = 0, dropped = 0;
  for (const e of j.elements) {
    const t = e.tags ?? {};
    const p = at(e);
    if (!p) continue;
    let kind;
    if (t.leisure === 'slipway') kind = K.launch;
    else if (t.leisure === 'marina') kind = K.marina;
    else if (t.natural === 'beach') kind = K.beach;
    else if (/beach access/i.test(t.name ?? '')) kind = K.access;
    else continue;
    // private slipways, beaches and accesses aren't access; a private marina still sells moorage, so it stays (marked)
    if (kind !== K.marina && blocked(t)) { skipped++; continue; }
    const isle = isl.isleOf(p[0], p[1]);
    if (isle < 0) { dropped++; continue; }
    if (kind === K.beach) {
      const c = isl.coastKm(p[0], p[1]);
      if (c > 1 || (/\b(lake|river|creek)\b/i.test(t.name ?? '') && c > 0.3)) kind = K.lake;
    }
    const detail = compact({
      surface: t.surface, fee: t.fee, op: t.operator, web: t.website ?? t['contact:website'] ?? t.url,
      access: kind === K.marina && blocked(t) ? 'private' : t.access && !/^(yes|public|permissive)$/.test(t.access) ? t.access : null,
      berths: int(t.capacity), fuel: t.fuel === 'yes' || t['seamark:small_craft_facility:category']?.includes('fuel_station') ? 1 : null,
      pump: t.sanitary_dump_station === 'yes' || t['waste:sewage'] === 'yes' ? 1 : null, power: t.power_supply === 'yes' ? 1 : null,
      dog: t.dog, nude: t.nudism === 'yes' || t.nudism === 'designated' ? 1 : null, note: clean(t.description, 200),
    });
    rows.push([round(p[0], 4), round(p[1], 4), kind, isle, t.name?.trim() || null, detail, osmRef(e)]);
  }
  rows = dedupe(rows, 60, distKm);
  log(`  kept ${rows.length} (${skipped} private, ${dropped} off the atlas's islands)`);

  // Fisheries and Oceans Canada's small craft harbours: core and non-core fishing harbours and recreational harbours
  let harbours = 0, merged = 0;
  for (const layer of [0, 1, 2]) {
    const q = new URLSearchParams({ where: "Province='BC'", outFields: '*', outSR: '4326', f: 'geojson' });
    const fc = JSON.parse((await cached(`outdoors/dfo-sch-${layer}.json`, async () => {
      const buf = await uaFetch(`${DFO}/${layer}/query?${q}`);
      const t = JSON.parse(buf.toString('utf8'));
      if (!Array.isArray(t.features)) throw new Error(`DFO small craft harbours layer ${layer}: ${t.error?.message ?? 'no features'}`);
      return buf;
    })).toString('utf8'));
    for (const f of fc.features) {
      const [lon, lat] = f.geometry.coordinates;
      const isle = isl.isleOf(lon, lat);
      if (isle < 0) continue;
      const p = f.properties;
      // an OSM marina at the same wharf is the same place: the DFO record wins, with the marina's name kept as an aka
      const dup = rows.findIndex((r) => r[2] === K.marina && distKm(lon, lat, r[0], r[1]) < 0.3);
      const aka = dup >= 0 ? rows[dup][4] : null;
      const extra = dup >= 0 ? rows[dup][5] : null;
      if (dup >= 0) { rows.splice(dup, 1); merged++; }
      const name = String(p.Harbour_Name ?? '').trim().replace(/\s+-\s+/g, ' – ');
      rows.push([round(lon, 4), round(lat, 4), K.harbour, isle, name || null, compact({ ...(extra ?? {}), aka: aka && aka !== name ? aka : null, htype: p.Harbour_Type, by: p.Managed_by?.trim(), byUrl: p.Managed_by_URL, no: p.Harbour_number }), `dfo${p.Harbour_number}`]);
      harbours++;
    }
  }
  log(`  ${harbours} DFO small craft harbours on the islands (${merged} matched an OpenStreetMap marina)`);
  rows.sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  const counts = WATER_KINDS.map((k, i) => `${rows.filter((r) => r[2] === i).length} ${k.id}`).join(', ');
  log(`  ${counts}`);
  if (rows.filter((r) => r[2] === K.launch).length < 50) throw new Error('too few boat launches: the Overpass query probably changed');

  const towns = {};
  for (const m of PLACES) {
    const isle = isl.placeIsle(m);
    const near = (kinds) => nearest(rows, kinds, m.lon, m.lat, isle, isl.OTHER, distKm);
    const n = (kinds) => countWithin(rows, kinds, m.lon, m.lat, isle, isl.OTHER, 10, distKm);
    towns[m.key] = {
      beach: near([K.beach, K.access]), lake: near([K.lake]), launch: near([K.launch]), moor: near([K.marina, K.harbour]),
      n10: [n([K.beach, K.lake, K.access]), n([K.launch]), n([K.marina, K.harbour])],
    };
  }

  await writeOut('water', {
    source: 'OpenStreetMap contributors via the Overpass API (ODbL): natural=beach, leisure=slipway, leisure=marina and features named “Beach Access”; Fisheries and Oceans Canada, Small Craft Harbours Locations and Information (Open Government Licence – Canada)',
    asOf: new Date().toISOString().slice(0, 10), islands: [...isl.names, 'Other'], kinds: WATER_KINDS, townKm: 10,
    cols: ['lon', 'lat', 'kind', 'island', 'name', 'detail', 'ref'], rows, towns,
  });
}

// ---------------------------------------------------------------------------------------------
// camping & recreation sites

export async function buildCamping(h) {
  const { log, writeOut, round, distKm, BBOX, PLACES } = h;
  const isl = await islandFinder(h);
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const K = Object.fromEntries(CAMP_KINDS.map((k, i) => [k.id, i]));

  // Recreation Sites and Trails BC: established sites (camping or day use), with their campsite counts
  const rec = await pager(h, 'outdoors')('WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW', { bbox: true, cacheKey: 'rec-sites' });
  // BC and national park boundaries: the same requests (and cache) as the neighbours stage
  const parksWfs = pager(h);
  const prov = await parksWfs('WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW', { bbox: true, cacheKey: 'parks-bc' });
  const nat = await parksWfs('WHSE_ADMIN_BOUNDARIES.CLAB_NATIONAL_PARKS', { bbox: true, cacheKey: 'parks-national' });
  const parks = [
    ...prov.map((f) => ({ f, name: title(String(f.properties.PROTECTED_LANDS_NAME ?? '').trim()), kind: K.park, des: f.properties.PROTECTED_LANDS_DESIGNATION })),
    ...nat.map((f) => ({ f, name: String(f.properties.ENGLISH_NAME ?? '').replace(/ of Canada$/, '').trim(), kind: K.national })),
  ].filter((p) => p.f.geometry).map((p) => {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    const polys = p.f.geometry.type === 'Polygon' ? [p.f.geometry.coordinates] : p.f.geometry.coordinates;
    for (const poly of polys) for (const [x, y] of poly[0]) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    return { ...p, b };
  });
  const parkAt = (lon, lat) => parks.find((p) => lon >= p.b[0] && lon <= p.b[2] && lat >= p.b[1] && lat <= p.b[3] && booleanPointInPolygon([lon, lat], p.f));

  let rows = [];
  for (const f of rec) {
    const p = f.properties, c = f.geometry?.coordinates;
    if (!c) continue;
    const isle = isl.isleOf(c[0], c[1]);
    if (isle < 0) continue;
    const acts = [p.ACTIVITY_DESC1, p.ACTIVITY_DESC2, p.ACTIVITY_DESC3].filter(Boolean);
    const sites = p.NUM_CAMP_SITES > 0 ? p.NUM_CAMP_SITES : null;
    const camping = sites != null || acts.includes('Camping');
    rows.push([round(c[0], 4), round(c[1], 4), camping ? K.rec : K.day, isle, title(String(p.PROJECT_NAME ?? '').trim()) || null, compact({
      sites, maint: p.MAINTAIN_STD_DESC, access: p.ACCESS_DESC1?.replace(/\s*\(.*\)$/, ''), acts: acts.join(', ') || null,
      // a person's name is left out; an organisation's is kept
      op: p.OPERATOR_LEGAL_FIRST_NAME ? null : title(p.OPERATOR_CLIENT_NAME), closed: clean(p.CLOSURE_DESCRIPTION, 200), desc: clean(p.PROJECT_DESCRIPTION, 360),
      since: p.PROJECT_ESTABLISHED_DATE ? +String(p.PROJECT_ESTABLISHED_DATE).slice(0, 4) : null,
    }), p.FOREST_FILE_ID]);
  }
  const recN = rows.length;
  log(`  ${recN} recreation sites on the islands (${rows.filter((r) => r[2] === K.rec).length} with camping)`);

  const osm = overpassClient(h);
  const j = await osm('outdoors/osm-camping.json', `[out:json][timeout:300];nwr["tourism"~"^(camp_site|caravan_site)$"](${bbox});out center tags;`);
  let merged = 0, dropped = 0;
  const osmRows = [];
  for (const e of j.elements) {
    const t = e.tags ?? {};
    const p = at(e);
    if (!p || blocked(t) || t.group_only === 'yes') { dropped++; continue; }
    const isle = isl.isleOf(p[0], p[1]);
    if (isle < 0) { dropped++; continue; }
    const marine = Object.keys(t).some((k) => k.endsWith(':bcmt')) || /marine trail/i.test(`${t.operator ?? ''} ${t.website ?? ''}`);
    const d = {
      sites: int(t.capacity) ?? int(t['capacity:pitches']) ?? int(t['capacity:tents']),
      fee: t.fee ?? (t.charge ? 'yes' : null), charge: clean(t.charge, 80), season: clean(t.opening_hours ?? (t.seasonal && t.seasonal !== 'no' ? `seasonal (${t.seasonal})` : null), 80),
      res: t.reservation, web: t.website ?? t['contact:website'] ?? t.url, op: t.operator,
      toilets: t.toilets === 'yes' ? 1 : t.toilets === 'no' ? 0 : null, water: t.drinking_water === 'yes' ? 1 : t.drinking_water === 'no' ? 0 : null,
      shower: t.shower === 'yes' || t.shower === 'hot' ? 1 : null, power: t.power_supply === 'yes' ? 1 : null,
      rv: t.tourism === 'caravan_site' ? 1 : null, back: marine ? 2 : t.backcountry === 'yes' || t.camp_site === 'basic' ? 1 : null,
      note: clean(t.description, 200),
    };
    // a rec site mapped in OpenStreetMap too: the FFID tag or the same spot (within 400 m) merges them
    const ffid = t['ref:FFID'];
    const dup = rows.findIndex((r, i) => i < recN && (ffid ? r[6] === ffid : distKm(p[0], p[1], r[0], r[1]) < 0.4));
    if (dup >= 0) {
      const r = rows[dup];
      // the official record wins where both have a value
      r[5] = compact({ ...d, ...(r[5] ?? {}), osm: osmRef(e) });
      if (r[2] === K.day) r[2] = K.rec; // OSM says people camp there
      merged++;
      continue;
    }
    const park = parkAt(p[0], p[1]);
    const name = t.name?.trim() || null;
    osmRows.push([round(p[0], 4), round(p[1], 4), park ? park.kind : K.other, isle, name, compact({ ...d, park: park?.name }), osmRef(e)]);
  }
  // the same campground mapped twice (a camp_site and a caravan_site, or a node inside a way)
  const kept = dedupe(osmRows, 250, distKm);
  rows.push(...kept);
  log(`  OpenStreetMap: ${j.elements.length} campgrounds in the box, ${merged} merged into rec sites, ${osmRows.length - kept.length} duplicates, ${dropped} private or off the islands`);
  rows.sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  log(`  ${CAMP_KINDS.map((k, i) => `${rows.filter((r) => r[2] === i).length} ${k.id}`).join(', ')}`);
  if (rows.filter((r) => r[2] === K.park).length < 10) throw new Error('too few park campgrounds: a query probably changed');

  const CAMP = [K.park, K.national, K.rec, K.other];
  const towns = {};
  for (const m of PLACES) {
    const isle = isl.placeIsle(m);
    towns[m.key] = {
      near: nearest(rows, CAMP, m.lon, m.lat, isle, isl.OTHER, distKm),
      park: nearest(rows, [K.park, K.national], m.lon, m.lat, isle, isl.OTHER, distKm),
      rec: nearest(rows, [K.rec], m.lon, m.lat, isle, isl.OTHER, distKm),
      n25: CAMP.map((k) => countWithin(rows, [k], m.lon, m.lat, isle, isl.OTHER, 25, distKm)),
    };
  }

  await writeOut('camping', {
    source: 'Recreation Sites and Trails BC, FTEN_REC_SITE_POINTS_SVW, and BC parks and protected areas (TA_PARK_ECORES_PA_SVW) and national parks (CLAB_NATIONAL_PARKS) via the BC Data Catalogue WFS (Open Government Licence – British Columbia); campgrounds from OpenStreetMap contributors via the Overpass API (ODbL)',
    asOf: new Date().toISOString().slice(0, 10), islands: [...isl.names, 'Other'], kinds: CAMP_KINDS, townKm: 25,
    cols: ['lon', 'lat', 'kind', 'island', 'name', 'detail', 'ref'], rows, towns,
  });
}
