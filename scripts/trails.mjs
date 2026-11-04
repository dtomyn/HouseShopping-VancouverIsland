// Trails & waterfalls: every mapped footpath on Vancouver Island and the shortlisted islands, the named
// hiking routes with elevation profiles worked out from terrain tiles, and every mapped waterfall (with
// Wikidata photos and heights where OpenStreetMap links one). Run as the `trails` stage of fetch-data.mjs,
// after `island`, whose outline it clips to.
//
// Sources: OpenStreetMap via Overpass (ODbL): route=hiking/foot relations, highway=path/footway/bridleway
// ways, waterway=waterfall nodes. Wikidata (CC0) for photos (P18) and heights (P2048). Mapzen / AWS
// terrain tiles for elevations.
//
// Writes trails.json (routes, waterfalls, per-town summaries, a trail-density grid for the Land Finder)
// and trails-net.json (the whole path network, delta-encoded; loaded only when the layer is opened).

import { dpLine, decodeTerrarium } from './land.mjs';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
// Wikimedia's API policy asks for a User-Agent with a way to reach the operator; without one it answers 429
const UA = { 'User-Agent': 'IslandAtlas/1.0 (https://github.com/dtomyn; open-data atlas build script)', Accept: 'application/json' };
const DEM_ZOOM = 11;
const LAT0 = 49.5;
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MY = 110540; // metres per degree, locally
const Q = 1e4; // network coordinates in 1e-4 degree units
const GRID = 0.01; // trail-density grid cell, degrees
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function buildTrails(h) {
  const { log, cached, writeOut, round, distKm, pool, BBOX, getIsland, onIsland, PLACES } = h;
  await getIsland();
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;

  const fetchBuf = async (url, opts = {}) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(opts.timeout ?? 240_000) });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, wait: +(res.headers.get('retry-after') ?? 0) });
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        if (attempt >= (opts.retries ?? 4)) throw new Error(`${e.message} for ${url.slice(0, 120)}`);
        // rate limited: honour Retry-After, else back off hard
        await sleep(e.status === 429 ? Math.max(e.wait * 1000, 15000 * attempt) : 3000 * attempt);
      }
    }
  };

  async function overpass(name, query) {
    return JSON.parse((await cached(`trails/osm-${name}.json`, async () => {
      let last;
      for (let r = 0; r < 4; r++)
        for (const url of OVERPASS) {
          try {
            // some mirrors drop long POSTs; alternate with GET
            const buf = r % 2 ? await fetchBuf(`${url}?data=${encodeURIComponent(query)}`, { retries: 1, timeout: 400_000 }) : await fetchBuf(url, { method: 'POST', body: new URLSearchParams({ data: query }), retries: 1, timeout: 400_000 });
            let j;
            try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('busy (not JSON)'); }
            if (!Array.isArray(j.elements) || /runtime error|timed out|out of memory/i.test(j.remark ?? '')) throw new Error(`busy (${j.remark ?? 'no elements'})`);
            return buf;
          } catch (e) { last = e; log(`  overpass ${name}: ${e.message}, trying again`); await sleep(8000); }
        }
      throw last;
    })).toString('utf8'));
  }

  // ---------------------------------------------------------------------------------------------
  // 1. downloads

  log('  overpass: hiking routes');
  const osmRoutes = await overpass('routes', `[out:json][timeout:300];relation["route"~"^(hiking|foot)$"](${bbox});out geom;`);
  log('  overpass: path network');
  const osmNet = await overpass('network', `[out:json][timeout:400];way["highway"~"^(path|footway|bridleway)$"]["footway"!~"^(sidewalk|crossing|access_aisle)$"]["access"!~"^(private|no)$"](${bbox});out geom qt;`);
  log('  overpass: waterfalls');
  const osmFalls = await overpass('falls', `[out:json][timeout:200];nwr["waterway"="waterfall"](${bbox});out center;`);
  log(`  ${osmRoutes.elements.length} routes, ${osmNet.elements.length} paths, ${osmFalls.elements.length} waterfalls in the box`);

  const onIsl = (lon, lat) => onIsland(lon, lat, 0.002);
  const toM = ([lon, lat]) => [lon * MX, lat * MY];
  const fromM = ([x, y]) => [x / MX, y / MY];
  const lenM = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot((pts[i][0] - pts[i - 1][0]) * MX, (pts[i][1] - pts[i - 1][1]) * MY); return s; };
  const simplifyLL = (pts, tol) => dpLine(pts.map(toM), tol).map(fromM);

  // ---------------------------------------------------------------------------------------------
  // 2. the path network (clipped, simplified, delta-encoded)

  const UNPAVED = /^(unpaved|dirt|ground|earth|grass|gravel|fine_gravel|compacted|mud|sand|rock|wood|woodchips|pebblestone)$/;
  const SAC = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3, alpine_hiking: 3, demanding_alpine_hiking: 3, difficult_alpine_hiking: 3 };
  const names = [];
  const nameIdx = new Map();
  const ways = [];
  const segs = []; // [lon, lat, metres] midpoints, for the grids and town sums
  for (const w of osmNet.elements) {
    if (w.type !== 'way' || !w.geometry?.length) continue;
    const t = w.tags ?? {};
    // footways in town are mostly sidewalks and plazas; keep them only when they read as trails
    if (t.highway === 'footway' && !(UNPAVED.test(t.surface ?? '') || /trail|path|loop|walk|lookout|track/i.test(t.name ?? ''))) continue;
    const pts = w.geometry.map((g) => [g.lon, g.lat]);
    const mid = pts[pts.length >> 1];
    if (!onIsl(mid[0], mid[1])) continue;
    const s = pts.length > 2 ? simplifyLL(pts, 10) : pts;
    const m = lenM(pts);
    if (m < 15) continue;
    let ni = -1;
    if (t.name) { ni = nameIdx.get(t.name) ?? -1; if (ni < 0) { ni = names.length; names.push(t.name); nameIdx.set(t.name, ni); } }
    const sac = SAC[t.sac_scale] ?? 0;
    const enc = [ni, sac];
    let px = 0, py = 0;
    for (const [lon, lat] of s) {
      const x = Math.round((lon - BBOX.west) * Q), y = Math.round((lat - BBOX.south) * Q);
      enc.push(x - px, y - py);
      px = x; py = y;
    }
    ways.push(enc);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      segs.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot((b[0] - a[0]) * MX, (b[1] - a[1]) * MY)]);
    }
  }
  const netKm = segs.reduce((s, x) => s + x[2], 0) / 1000;
  log(`  network: ${ways.length} paths, ${Math.round(netKm)} km on the islands`);

  // trail-density grid: metres of path per GRID cell (sparse)
  const gnx = Math.ceil((BBOX.east - BBOX.west) / GRID);
  const dens = new Map();
  for (const [lon, lat, m] of segs) {
    const k = Math.floor((lat - BBOX.south) / GRID) * gnx + Math.floor((lon - BBOX.west) / GRID);
    dens.set(k, (dens.get(k) ?? 0) + m);
  }

  // ---------------------------------------------------------------------------------------------
  // 3. elevation from terrain tiles (bilinear)

  const tiles = new Map();
  const tileXY = (lon, lat) => {
    const n = 2 ** DEM_ZOOM, r = (lat * Math.PI) / 180;
    return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
  };
  async function loadTiles(points) {
    const want = new Set();
    for (const [lon, lat] of points) { const [tx, ty] = tileXY(lon, lat); want.add(`${Math.floor(tx)}/${Math.floor(ty)}`); }
    const missing = [...want].filter((k) => !tiles.has(k));
    log(`  terrain: ${missing.length} tiles at z${DEM_ZOOM}`);
    await pool(missing, 6, async (k) => {
      // the Land Finder caches the same tiles
      const buf = await cached(`land/dem/${DEM_ZOOM}-${k.replace('/', '-')}.png`, () => fetchBuf(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_ZOOM}/${k}.png`, { headers: { Accept: 'image/png' } }));
      tiles.set(k, decodeTerrarium(buf));
    });
  }
  const px = (tx, ty) => {
    const t = tiles.get(`${Math.floor(tx)}/${Math.floor(ty)}`);
    if (!t) return null;
    return t[Math.min(255, Math.floor((ty % 1) * 256)) * 256 + Math.min(255, Math.floor((tx % 1) * 256))];
  };
  const elevAt = (lon, lat) => {
    const [tx, ty] = tileXY(lon, lat);
    const fx = tx * 256 - 0.5, fy = ty * 256 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const g = (x, y) => px(x / 256 + 1e-9, y / 256 + 1e-9);
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    if (a == null || b == null || c == null || d == null) return g(Math.round(fx), Math.round(fy));
    return a * (1 - ax) * (1 - ay) + b * ax * (1 - ay) + c * (1 - ax) * ay + d * ax * ay;
  };

  // ---------------------------------------------------------------------------------------------
  // 4. named routes: stitch member ways into chains, then into one ordered line for profile & flight

  const near = (a, b, m = 40) => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY) < m;
  function stitch(lines) {
    const chains = [];
    const left = lines.map((l) => l.slice());
    while (left.length) {
      let c = left.pop();
      for (let grew = true; grew; ) {
        grew = false;
        for (let i = 0; i < left.length; i++) {
          const l = left[i];
          const s = c[0], e = c[c.length - 1], ls = l[0], le = l[l.length - 1];
          if (near(e, ls)) c = c.concat(l.slice(1));
          else if (near(e, le)) c = c.concat(l.slice(0, -1).reverse());
          else if (near(s, le)) c = l.concat(c.slice(1));
          else if (near(s, ls)) c = l.slice().reverse().concat(c.slice(1));
          else continue;
          left.splice(i, 1); i--; grew = true;
        }
      }
      chains.push(c);
    }
    return chains.sort((a, b) => lenM(b) - lenM(a));
  }
  /** Joins chains into one line: start from the longest, keep attaching the chain whose end is nearest. */
  function order(chains) {
    const rest = chains.slice(1);
    let line = chains[0].slice();
    let bridged = 0;
    while (rest.length) {
      let best = -1, bd = Infinity, how = 0;
      for (let i = 0; i < rest.length; i++) {
        const c = rest[i], s = line[0], e = line[line.length - 1];
        const opts = [[e, c[0], 0], [e, c[c.length - 1], 1], [s, c[c.length - 1], 2], [s, c[0], 3]];
        for (const [p, q, k] of opts) { const d = Math.hypot((p[0] - q[0]) * MX, (p[1] - q[1]) * MY); if (d < bd) { bd = d; best = i; how = k; } }
      }
      const c = rest.splice(best, 1)[0];
      if (bd > 3000) continue; // far-flung pieces (a ferry hop, a mapping stray) stay drawn but out of the line
      bridged += bd;
      if (how === 0) line = line.concat(c);
      else if (how === 1) line = line.concat(c.slice().reverse());
      else if (how === 2) line = c.concat(line);
      else line = c.slice().reverse().concat(line);
    }
    return { line, bridged };
  }

  const rawRoutes = [];
  for (const r of osmRoutes.elements) {
    const t = r.tags ?? {};
    const name = t.name ?? t['name:en'] ?? t.ref;
    if (!name || r.type !== 'relation') continue;
    const lines = [];
    for (const m of r.members ?? []) {
      if (m.type !== 'way' || !m.geometry?.length || /platform|stop/.test(m.role ?? '')) continue;
      const pts = m.geometry.filter(Boolean).map((g) => [g.lon, g.lat]);
      const mid = pts[pts.length >> 1];
      if (pts.length > 1 && onIsl(mid[0], mid[1])) lines.push(pts);
    }
    if (!lines.length) continue;
    const km = lines.reduce((s, l) => s + lenM(l), 0) / 1000;
    if (km < 0.6) continue;
    rawRoutes.push({ id: r.id, t, name, lines, km });
  }
  // the same trail is sometimes mapped twice (a route and its "foot" twin); keep the longer
  rawRoutes.sort((a, b) => b.km - a.km);
  const seen = new Set();
  const routesIn = rawRoutes.filter((r) => { const k = r.name.toLowerCase().replace(/\s+/g, ' '); if (seen.has(k)) return false; seen.add(k); return true; });

  const stitched = routesIn.map((r) => ({ r, chains: stitch(r.lines) }));
  for (const s of stitched) s.ord = order(s.chains);
  await loadTiles(stitched.flatMap((s) => s.ord.line.filter((_, i) => i % 4 === 0)));

  const routes = stitched.map(({ r, chains, ord }) => {
    const line = ord.line;
    const lineKm = lenM(line) / 1000;
    // elevations every ~40 m along the ordered line for the climbing totals; the stored profile keeps ≤ 400 of them
    const N = Math.max(40, Math.min(30000, Math.round(lineKm * 25)));
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot((line[i][0] - line[i - 1][0]) * MX, (line[i][1] - line[i - 1][1]) * MY));
    const total = cum[cum.length - 1];
    const prof = [];
    let k = 1;
    for (let i = 0; i < N; i++) {
      const d = (total * i) / (N - 1);
      while (k < cum.length - 1 && cum[k] < d) k++;
      const f = (d - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
      const a = line[k - 1], b = line[k];
      prof.push(Math.max(0, elevAt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) ?? 0));
    }
    // ascent on a lightly smoothed profile (~120 m window), ignoring wiggles under 5 m (the DEM is ~50 m pixels)
    const sm = prof.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 1); j <= Math.min(prof.length - 1, i + 1); j++) { s += prof[j]; n++; } return s / n; });
    let up = 0, down = 0, ref = sm[0];
    for (const v of sm) { if (v - ref > 5) { up += v - ref; ref = v; } else if (ref - v > 5) { down += ref - v; ref = v; } }
    const M = Math.min(400, prof.length);
    const stored = Array.from({ length: M }, (_, i) => prof[Math.round((i * (prof.length - 1)) / (M - 1))]);
    const km = r.km;
    const t = r.t;
    const ends = [line[0], line[line.length - 1]];
    const loop = near(ends[0], ends[1], 300);
    // effort: Naismith's rule, 4.5 km/h plus an hour per 600 m of climbing (one way, or the loop)
    const hrs = km / 4.5 + up / 600;
    const sac = SAC[t.sac_scale] ?? 0;
    const level = sac >= 2 || hrs > 8 || up > 900 ? 3 : hrs > 3.5 || up > 400 ? 2 : 1;
    return {
      id: r.id,
      name: r.name,
      km: round(km, 1),
      up: Math.round(up),
      down: Math.round(down),
      hi: Math.round(Math.max(...prof)),
      lo: Math.round(Math.min(...prof)),
      hrs: round(hrs, 1),
      level,
      loop,
      net: t.network ?? null,
      op: t.operator ?? null,
      web: t.website ?? t.url ?? null,
      wiki: t.wikipedia ?? null,
      desc: t.description ?? t.note ?? null,
      ref: t.ref && t.ref !== r.name ? t.ref : null,
      // drawn pieces (a few metres of detail) and the ordered line the camera flies
      parts: chains.map((c) => simplifyLL(c, 6).map(([lon, lat]) => [round(lon, 5), round(lat, 5)])),
      line: simplifyLL(line, 20).map(([lon, lat]) => [round(lon, 5), round(lat, 5)]),
      lineKm: round(lineKm, 1),
      prof: stored.map((v) => Math.round(v)),
    };
  });
  log(`  routes: ${routes.length} named routes, ${Math.round(routes.reduce((s, r) => s + r.km, 0))} km`);

  // ---------------------------------------------------------------------------------------------
  // 5. waterfalls, with Wikidata photos and heights where linked

  let falls = [];
  for (const f of osmFalls.elements) {
    const lon = f.lon ?? f.center?.lon, lat = f.lat ?? f.center?.lat;
    if (lon == null || !onIsl(lon, lat)) continue;
    const t = f.tags ?? {};
    const hNum = parseFloat(String(t.height ?? '').replace(',', '.'));
    falls.push({ osm: `${f.type}/${f.id}`, name: t.name ?? null, lon: round(lon, 5), lat: round(lat, 5), h: Number.isFinite(hNum) && hNum > 0 && hNum < 600 ? round(hNum, 1) : null, wd: t.wikidata ?? null, wiki: t.wikipedia ?? null, img: t.wikimedia_commons?.startsWith('File:') ? t.wikimedia_commons.slice(5) : t.image?.match(/File:(.+)$/)?.[1] ?? null });
  }
  // the same fall is sometimes a node and a way; merge within 60 m
  falls = falls.filter((f, i) => !falls.some((g, j) => j < i && near([f.lon, f.lat], [g.lon, g.lat], 60) && (!f.name || f.name === g.name)));

  const qids = [...new Set(falls.map((f) => f.wd).filter((q) => /^Q\d+$/.test(q ?? '')))];
  const wd = {};
  for (let i = 0; i < qids.length; i += 45) {
    const ids = qids.slice(i, i + 45);
    try {
      const j = JSON.parse((await cached(`trails/wikidata-${ids[0]}-${ids.length}.json`, () => fetchBuf(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|sitelinks&ids=${ids.join('|')}`))).toString('utf8'));
      Object.assign(wd, j.entities ?? {});
    } catch (e) { log(`  wikidata: ${e.message}`); }
  }
  for (const f of falls) {
    const e = f.wd && wd[f.wd];
    if (!e) continue;
    const img = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (img && !f.img) f.img = img;
    const hc = e.claims?.P2048?.[0]?.mainsnak?.datavalue?.value;
    if (hc && !f.h) {
      let v = parseFloat(hc.amount);
      if (/Q3710$/.test(hc.unit)) v *= 0.3048; // feet
      if (v > 0 && v < 600) f.h = round(v, 1);
    }
    if (!f.wiki && e.sitelinks?.enwiki) f.wiki = `en:${e.sitelinks.enwiki.title}`;
  }

  // Wikidata knows some falls OpenStreetMap doesn't link (and a few it hasn't mapped): match by place
  try {
    const sparql = `SELECT ?f ?fLabel ?coord ?img ?h ?hu ?enwiki WHERE { SERVICE wikibase:box { ?f wdt:P625 ?coord. bd:serviceParam wikibase:cornerSouthWest "Point(${BBOX.west} ${BBOX.south})"^^geo:wktLiteral. bd:serviceParam wikibase:cornerNorthEast "Point(${BBOX.east} ${BBOX.north})"^^geo:wktLiteral. } ?f wdt:P31/wdt:P279* wd:Q34038. OPTIONAL { ?f wdt:P18 ?img. } OPTIONAL { ?f p:P2048/psv:P2048 [ wikibase:quantityAmount ?h; wikibase:quantityUnit ?hu ]. } OPTIONAL { ?enwiki schema:about ?f; schema:isPartOf <https://en.wikipedia.org/>. } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
    const j = JSON.parse((await cached('trails/wikidata-falls.json', () => fetchBuf(`https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}`, { headers: { Accept: 'application/sparql-results+json' } }))).toString('utf8'));
    let added = 0, matched = 0;
    for (const b of j.results?.bindings ?? []) {
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? '');
      if (!m) continue;
      const lon = +m[1], lat = +m[2], name = b.fLabel?.value;
      if (!onIsl(lon, lat) || !name || /^Q\d+$/.test(name) || /park/i.test(name)) continue;
      const img = b.img?.value ? decodeURIComponent(b.img.value.split('/').pop()).replace(/_/g, ' ') : null;
      let h = b.h ? parseFloat(b.h.value) : null;
      if (h && /Q3710$/.test(b.hu?.value ?? '')) h *= 0.3048;
      const wiki = b.enwiki?.value ? `en:${decodeURIComponent(b.enwiki.value.split('/wiki/')[1]).replace(/_/g, ' ')}` : null;
      const hit = falls.find((f) => (f.name && f.name.toLowerCase() === name.toLowerCase() && near([f.lon, f.lat], [lon, lat], 3000)) || near([f.lon, f.lat], [lon, lat], 400));
      if (hit) { matched++; hit.img ??= img; hit.h ??= h && h > 0 && h < 600 ? round(h, 1) : null; hit.wiki ??= wiki; hit.name ??= name; }
      else { added++; falls.push({ osm: `wikidata/${b.f.value.split('/').pop()}`, name, lon: round(lon, 5), lat: round(lat, 5), h: h && h > 0 && h < 600 ? round(h, 1) : null, wd: null, wiki, img }); }
    }
    log(`  wikidata: ${matched} matched, ${added} added`);
  } catch (e) { log(`  wikidata falls: ${e.message}`); }

  // photos geotagged on Wikimedia Commons right at a named fall, whose file name says it's that fall
  const needPhoto = falls.filter((f) => f.name && !f.img);
  // one request at a time, gently: the Commons API rate-limits bursts
  await pool(needPhoto, 1, async (f) => {
    try {
      const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=geosearch&gsnamespace=6&gslimit=30&gsradius=600&gscoord=${f.lat}|${f.lon}`;
      const j = JSON.parse((await cached(`trails/commons-${f.lat}-${f.lon}.json`, async () => { await sleep(400); return fetchBuf(url, { retries: 6 }); })).toString('utf8'));
      const key = f.name.toLowerCase().replace(/\b(falls?|waterfalls?|cascades?|upper|lower|the)\b/g, '').trim().split(/\s+/).filter((w) => w.length > 2);
      // the file must be named for the fall itself, not a plant, view or trail photographed near it
      const words = key.map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
      const nameRe = new RegExp(words.join('\\W+(?:\\w+\\W+)?') + '\\W+(?:(?:river|creek|upper|lower)\\W+)*(?:falls|waterfall|cascade)');
      const pick = (j.query?.geosearch ?? []).find((g) => { const t = g.title.toLowerCase().replace(/^file:/, ''); return /\.(jpe?g|png|webp)$/.test(t) && key.length > 0 && nameRe.test(t) && !/\b(trail|from|lily|plicata|tree|sign|map|bridge|parking|campground)\b/.test(t); });
      if (pick) f.img = pick.title.replace(/^File:/, '');
    } catch (e) { log(`  commons ${f.name}: ${e.message}`); }
  });
  log(`  commons: photos for ${needPhoto.filter((f) => f.img).length} more falls`);

  // one named fall mapped twice (top and foot, or node and Wikidata point): keep the better-documented one
  const score = (f) => (f.img ? 4 : 0) + (f.h ? 2 : 0) + (f.wiki ? 1 : 0);
  falls = falls.filter((f) => !f.name || !falls.some((g) => g !== f && g.name === f.name && near([f.lon, f.lat], [g.lon, g.lat], 1500) && (score(g) > score(f) || (score(g) === score(f) && falls.indexOf(g) < falls.indexOf(f)))));

  await loadTiles(falls.map((f) => [f.lon, f.lat]));
  // nearest mapped path to each fall, via a coarse grid of path midpoints
  const pidx = new Map();
  const cellOf = (lon, lat) => `${Math.floor(lon / 0.01)},${Math.floor(lat / 0.01)}`;
  for (const s of segs) { const k = cellOf(s[0], s[1]); (pidx.get(k) ?? pidx.set(k, []).get(k)).push(s); }
  const nearestPath = (lon, lat) => {
    let best = Infinity;
    const cx = Math.floor(lon / 0.01), cy = Math.floor(lat / 0.01);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++)
      for (const s of pidx.get(`${cx + dx},${cy + dy}`) ?? []) best = Math.min(best, Math.hypot((s[0] - lon) * MX, (s[1] - lat) * MY));
    return best;
  };
  const routeNear = (lon, lat, m) => routes.flatMap((r, i) => (r.parts.some((p) => p.some((q) => Math.hypot((q[0] - lon) * MX, (q[1] - lat) * MY) < m)) ? [i] : []));
  for (const f of falls) {
    f.elev = Math.round(Math.max(0, elevAt(f.lon, f.lat) ?? 0));
    const d = nearestPath(f.lon, f.lat);
    f.path = Number.isFinite(d) ? Math.round(d) : null;
    f.routes = routeNear(f.lon, f.lat, 600);
  }
  // most notable first: photographed, named, measured, close to a trail
  const fame = (f) => (f.img ? 4 : 0) + (f.wiki ? 3 : 0) + (f.name ? 3 : 0) + (f.h ? Math.min(3, f.h / 30) : 0) + (f.path != null && f.path < 200 ? 1 : 0) + (f.routes.length ? 1 : 0);
  falls.sort((a, b) => fame(b) - fame(a));
  for (const f of falls) { delete f.wd; }
  for (const r of routes) r.falls = falls.flatMap((f, i) => (f.routes.includes(routes.indexOf(r)) ? [i] : []));
  log(`  waterfalls: ${falls.length} on the islands, ${falls.filter((f) => f.name).length} named, ${falls.filter((f) => f.img).length} with photos, ${falls.filter((f) => f.h).length} with heights`);

  // ---------------------------------------------------------------------------------------------
  // 6. per-town summaries

  const towns = {};
  for (const m of PLACES) {
    let k10 = 0;
    for (const [lon, lat, len] of segs) if (Math.abs(lat - m.lat) < 0.1 && Math.abs(lon - m.lon) < 0.15 && distKm(m.lon, m.lat, lon, lat) <= 10) k10 += len;
    const fn = falls.map((f, i) => ({ i, d: distKm(m.lon, m.lat, f.lon, f.lat) })).filter((x) => x.d <= 30).sort((a, b) => a.d - b.d);
    const rn = routes.map((r, i) => ({ i, d: Math.min(...r.parts.flatMap((p) => p.filter((_, j) => j % 3 === 0).map((q) => distKm(m.lon, m.lat, q[0], q[1])))) })).filter((x) => x.d <= 25).sort((a, b) => a.d - b.d);
    towns[m.key] = {
      km10: Math.round(k10 / 1000),
      falls30: fn.length,
      named30: fn.filter((x) => falls[x.i].name).length,
      falls: fn.filter((x) => falls[x.i].name).slice(0, 4).map((x) => [x.i, round(x.d, 1)]),
      routes: rn.slice(0, 6).map((x) => [x.i, round(x.d, 1)]),
    };
  }

  await writeOut('trails', {
    source: 'OpenStreetMap contributors via the Overpass API (ODbL): hiking and foot route relations, footpaths (highway=path, bridleway and unpaved footways) and waterfall nodes; photos and heights from Wikidata (CC0) where OpenStreetMap links an item; elevations from Mapzen / AWS terrain tiles',
    netKm: Math.round(netKm),
    netPaths: ways.length,
    routes,
    falls,
    towns,
    grid: { west: BBOX.west, south: BBOX.south, d: GRID, nx: gnx, cells: [...dens].filter(([, v]) => v >= 20).map(([k, v]) => [k, Math.round(v)]) },
  });
  await writeOut('trails-net', { west: BBOX.west, south: BBOX.south, q: Q, names, ways });
}
