// Internet & cell coverage: what providers say is available, and what people actually measured.
// Run as the `internet` stage of fetch-data.mjs.
//
// Advertised: ISED's National Broadband Data (Open Government Licence – Canada). Canada is divided
// into hexagons of about 25 km²; for each one ISED publishes the share of homes offered 50/10 Mbps
// (in 25-point bands), whether over 75% are offered 5/1, its estimated dwellings (2021), and every
// provider reporting service there with its technology (fibre, cable, DSL, fixed wireless, mobile,
// satellite). Hex geometry comes from the shapefile (Lambert conformal conic, NAD83), attributes from
// the CSV package.
//
// Measured: Ookla's Speedtest open data (CC BY-NC-SA 4.0): fixed and mobile results averaged over
// ~600 m web-mercator tiles (zoom 16), one global parquet file per type and quarter since 2019. The
// files are sorted by quadkey and island tiles sit within the first few percent of rows, so only a
// prefix of each needed column chunk is fetched (HTTP range requests through hyparquet): about 20–40
// MB per quarter instead of ~200 MB. Tiles are then pooled into the ISED hexagons, so both sources
// share one grid.
//
// Writes internet.json:
//   hex: { r, angle }                      circumradius (m) and rotation (° from east) of the grid's hexagons
//   hexes: [lon, lat, dwellings, a50, a5, tech, isps, id][]
//       a50: share of homes offered 50/10 Mbps, 0 none, 1 under 25%, 2 25–50%, 3 50–75%, 4 over 75%
//       a5: over 75% of homes offered 5/1 Mbps (0/1); tech: bitmask (TECH below); isps: providers (not satellite)
//   quarters: ['2019-Q1', …]
//   fixed / mobile: { d: (Mbps | null)[q][hex], n: tests[q][hex] }  tests-weighted average download speed

import { unzipSync, strFromU8 } from 'fflate';
import { parquetMetadataAsync, parquetRead } from 'hyparquet';

const ISED = 'https://ised-isde.canada.ca/app/scr/sittibc/web/api/openData';
const OOKLA = 'https://ookla-open-data.s3.amazonaws.com/parquet/performance';
const FIRST_YEAR = 2019;

/** Technology bits, in the order the app lists them. */
export const TECH = { 'Fibre to the home': 1, 'Coaxial Cable': 2, DSL: 4, 'Fixed Wireless': 8, 'Mobile Wireless': 16, Satellite: 32, 'High Capacity Transport Services': 64 };
const DWELLINGS = { '<5': 2, '5-25': 15, '26-50': 38, '51-100': 75, '101-250': 175, '251-500': 375, '501+': 700 };

// ---------------------------------------------------------------------------------------------
// Lambert conformal conic (2SP) on GRS80, as in the shapefile's .prj

function lcc({ lat1, lat2, lat0, lon0, fe, fn }) {
  const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f), r = Math.PI / 180;
  const m = (p) => Math.cos(p) / Math.sqrt(1 - (e * Math.sin(p)) ** 2);
  const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const [p1, p2, p0] = [lat1 * r, lat2 * r, lat0 * r];
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * t(p1) ** n);
  const rho0 = a * F * t(p0) ** n;
  return (x, y) => {
    const dx = x - fe, dy = rho0 - (y - fn);
    const rho = Math.sign(n) * Math.hypot(dx, dy);
    const theta = Math.atan2(dx, dy);
    const tt = (rho / (a * F)) ** (1 / n);
    let phi = Math.PI / 2 - 2 * Math.atan(tt);
    for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2));
    return [(theta / n) / r + lon0, phi / r];
  };
}

const prjParam = (prj, name) => Number(new RegExp(`PARAMETER\\["${name}",(-?[\\d.]+)\\]`).exec(prj)?.[1]);

/** Polygon centres and first vertices from a .shp, with each record's first text field from the .dbf. */
function readHexShapes(shp, dbf) {
  const sv = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  const dv = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const nRec = dv.getUint32(4, true), headLen = dv.getUint16(8, true), recLen = dv.getUint16(10, true);
  const fields = [];
  for (let p = 32, off = 1; dbf[p] !== 0x0d; p += 32) {
    const name = strFromU8(dbf.subarray(p, p + 11)).replace(/\0.*$/, '');
    fields.push({ name, off, len: dbf[p + 16] });
    off += dbf[p + 16];
  }
  const idField = fields.find((f) => /^HEXuid/i.test(f.name));
  if (!idField) throw new Error(`hex shapefile: no HEXuid field (${fields.map((f) => f.name).join(', ')})`);
  const out = [];
  let o = 100;
  for (let k = 0; k < nRec && o < shp.length; k++) {
    const len = sv.getInt32(o + 4, false) * 2;
    const type = sv.getInt32(o + 8, true);
    if (type === 5) {
      const nParts = sv.getInt32(o + 44, true), nPts = sv.getInt32(o + 48, true);
      const p0 = o + 52 + 4 * nParts;
      const pts = [];
      for (let i = 0; i < nPts; i++) pts.push([sv.getFloat64(p0 + i * 16, true), sv.getFloat64(p0 + i * 16 + 8, true)]);
      const ring = pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1] ? pts.slice(0, -1) : pts;
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const r0 = headLen + k * recLen;
      const id = strFromU8(dbf.subarray(r0 + idField.off, r0 + idField.off + idField.len)).trim();
      out.push({ id, c: [cx, cy], v: ring[0] });
    }
    o += 8 + len;
  }
  return out;
}

/** A quoted CSV (fields may hold commas) as row objects. */
function csv(text) {
  const [head, ...lines] = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const split = (l) => {
    const out = [];
    let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const cols = split(head);
  return lines.map((l) => { const v = split(l); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
}

const bandOf = (s) => {
  const m = /^>(\d+)%/.exec((s ?? '').trim());
  if (!m) return 0;
  return { 0: 1, 25: 2, 50: 3, 75: 4 }[m[1]] ?? 0;
};

// ---------------------------------------------------------------------------------------------
// Ookla tiles: web-mercator zoom 16, keyed by quadkey

const Z = 16, N = 2 ** Z;
const tileX = (lon) => Math.floor(((lon + 180) / 360) * N);
const tileY = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N); };
const quadkey = (x, y) => { let s = ''; for (let i = Z; i > 0; i--) { const m = 1 << (i - 1); s += ((x & m) ? 1 : 0) + ((y & m) ? 2 : 0); } return s; };
const fromQuadkey = (k) => { let x = 0, y = 0; for (const c of k) { const d = c.charCodeAt(0) - 48; x = x * 2 + (d & 1); y = y * 2 + (d >> 1); } return [x, y]; };
const tileCentre = (x, y) => {
  const lon = ((x + 0.5) / N) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / N))) * 180) / Math.PI;
  return [lon, lat];
};

async function rangeGet(url, a, b) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` }, signal: AbortSignal.timeout(180_000) });
      if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = await res.arrayBuffer();
      return res.status === 200 ? buf.slice(a, b) : buf;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/**
 * Island-box rows of one Ookla parquet file: [quadkey, download kbps, upload kbps, latency ms, tests, devices].
 * Reads rows 0…R of the first row group, fetching only about the same fraction of each column chunk
 * (plus a margin), and doubles R until the rows read run past the box's last quadkey. A prefix too
 * short to decode throws inside hyparquet, which also doubles R.
 */
async function ooklaIsland(url, size, BBOX) {
  const x0 = tileX(BBOX.west), x1 = tileX(BBOX.east), y0 = tileY(BBOX.north), y1 = tileY(BBOX.south);
  const lo = quadkey(x0, y0), hi = quadkey(x1, y1);
  const tailLen = Math.min(size, 1 << 20);
  const tail = await rangeGet(url, size - tailLen, size);
  const base = size - tailLen;
  const fromTail = (a, b) => (a >= base ? Promise.resolve(tail.slice(a - base, b - base)) : null);
  const meta = await parquetMetadataAsync({ byteLength: size, slice: (a, b = size) => fromTail(a, b) ?? rangeGet(url, a, b) });
  const rg = meta.row_groups[0];
  const qs = rg.columns.find((c) => c.meta_data.path_in_schema[0] === 'quadkey')?.meta_data.statistics;
  if (qs?.min_value > hi) return [];
  const groupRows = Number(rg.num_rows);
  for (let frac = 0.06; frac <= 1; frac *= 2) {
    const R = Math.min(groupRows, Math.ceil(groupRows * frac));
    const file = {
      byteLength: size,
      slice: (a, b = size) => fromTail(a, b) ?? rangeGet(url, a, Math.min(b, a + Math.ceil((b - a) * Math.min(1, frac * 1.4)) + 262144)),
    };
    let rows = null;
    try {
      await parquetRead({ file, metadata: meta, columns: ['quadkey', 'avg_d_kbps', 'avg_u_kbps', 'avg_lat_ms', 'tests', 'devices'], rowStart: 0, rowEnd: R, onComplete: (r) => { rows = r; } });
    } catch { continue; }
    const complete = rows && rows.length === R && rows.every((r) => r.every((v) => v != null));
    if (!complete || (R < groupRows && !(rows[R - 1][0] > hi))) continue;
    const out = [];
    for (const r of rows) {
      if (r[0] < lo || r[0] > hi) continue;
      const [x, y] = fromQuadkey(r[0]);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      out.push([r[0], Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5])]);
    }
    return out;
  }
  throw new Error(`could not read the island rows of ${url}`);
}

async function headSize(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Number(res.headers.get('content-length'));
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// ---------------------------------------------------------------------------------------------

export async function buildInternet({ log, cached, writeOut, round, pool, BBOX, getIsland, onIsland }) {
  await getIsland();

  // --- ISED hexagons
  const csvZip = await cached('internet/nbd-map-csv.zip', () => fetchAll(`${ISED}/Map_Data_CSV.zip`));
  const csvFiles = unzipSync(new Uint8Array(csvZip), { filter: (f) => /^(Data_Hex|ISP_Hex)/i.test(f.name) });
  const pick = (re) => { const k = Object.keys(csvFiles).find((n) => re.test(n)); if (!k) throw new Error(`NBD CSV package: no file matching ${re}`); return strFromU8(csvFiles[k]); };
  const shpZip = await cached('internet/nbd-map-shapefile.zip', () => fetchAll(`${ISED}/Map_Data_Shapefile.zip`));
  const shpFiles = unzipSync(new Uint8Array(shpZip), { filter: (f) => /^Data_Hex_Donnees\.(shp|dbf|prj)$/i.test(f.name) });
  const shpPart = (ext) => { const k = Object.keys(shpFiles).find((n) => n.toLowerCase().endsWith(ext)); if (!k) throw new Error(`NBD shapefile package: no Data_Hex_Donnees${ext}`); return shpFiles[k]; };
  const prj = strFromU8(shpPart('.prj'));
  if (!/Lambert_Conformal_Conic/.test(prj)) throw new Error('NBD hexagons: unexpected projection');
  const inv = lcc({ lat1: prjParam(prj, 'standard_parallel_1'), lat2: prjParam(prj, 'standard_parallel_2'), lat0: prjParam(prj, 'latitude_of_origin'), lon0: prjParam(prj, 'central_meridian'), fe: prjParam(prj, 'false_easting'), fn: prjParam(prj, 'false_northing') });
  const shapes = readHexShapes(shpPart('.shp'), shpPart('.dbf')).filter((s) => s.id.startsWith('BC'));
  log(`  ${shapes.length} BC hexagons in the shapefile`);

  // Size and rotation of the hexagons around the island, in local metres.
  const kx = 111320 * Math.cos((49.5 * Math.PI) / 180), ky = 110540;
  const rs = [], angles = [];
  const geo = [];
  for (const s of shapes) {
    const [lon, lat] = inv(s.c[0], s.c[1]);
    if (lon < BBOX.west || lon > BBOX.east || lat < BBOX.south || lat > BBOX.north) continue;
    const [vl, va] = inv(s.v[0], s.v[1]);
    const ex = (vl - lon) * kx, ny = (va - lat) * ky;
    // Keep a hexagon if its centre or any of six points two-thirds of the way to its corners is on land.
    const r = Math.hypot(ex, ny), a0 = Math.atan2(ny, ex);
    const pts = [[lon, lat], ...Array.from({ length: 6 }, (_, i) => { const a = a0 + (i * Math.PI) / 3; return [lon + (Math.cos(a) * r * 0.66) / kx, lat + (Math.sin(a) * r * 0.66) / ky]; })];
    if (!pts.some(([x, y]) => onIsland(x, y))) continue;
    rs.push(r);
    angles.push((((a0 * 180) / Math.PI) % 60 + 60) % 60);
    geo.push({ id: s.id, lon, lat });
  }
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const hexR = Math.round(med(rs)), hexAngle = round(med(angles), 1);
  log(`  ${geo.length} hexagons on the islands (circumradius ${hexR} m, rotated ${hexAngle}°)`);

  const attrs = new Map(csv(pick(/^Data_Hex/i)).map((r) => [r.HEXuid_HEXidu, r]));
  const providers = new Map();
  for (const r of csv(pick(/^ISP_Hex/i))) {
    const id = r.HEXuid_HEXidu;
    if (!id?.startsWith('BC')) continue;
    let p = providers.get(id);
    if (!p) providers.set(id, (p = { tech: 0, names: new Set() }));
    const bit = TECH[r.Technology];
    if (bit == null) continue;
    p.tech |= bit;
    if (bit !== TECH.Satellite) p.names.add(r.Name_Nom);
  }
  const hexes = geo.map((g) => {
    const a = attrs.get(g.id);
    const p = providers.get(g.id);
    return [round(g.lon, 4), round(g.lat, 4), DWELLINGS[a?.SumURD_2021_SommeRH] ?? 0, bandOf(a?.Expr2), a?.Expr1 === 'T' ? 1 : 0, p?.tech ?? 0, p?.names.size ?? 0, g.id];
  });
  const missing = geo.filter((g) => !attrs.has(g.id)).length;
  if (missing > geo.length * 0.2) throw new Error(`NBD CSV: ${missing} of ${geo.length} island hexagons have no attributes`);

  // --- Ookla quarters, 2019 to the latest published
  const quarters = [];
  const now = new Date();
  for (let y = FIRST_YEAR; y <= now.getUTCFullYear(); y++) for (let q = 1; q <= 4; q++) if (Date.UTC(y, (q - 1) * 3 + 3, 1) <= +now) quarters.push({ y, q });
  const fileUrl = (type, { y, q }) => `${OOKLA}/type=${type}/year=${y}/quarter=${q}/${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01_performance_${type}_tiles.parquet`;
  const jobs = quarters.flatMap((qq) => ['fixed', 'mobile'].map((type) => ({ type, ...qq })));
  const got = await pool(jobs, 3, async (j) => {
    const name = `internet/ookla-${j.type}-${j.y}q${j.q}.json`;
    try {
      const buf = await cached(name, async () => {
        const url = fileUrl(j.type, j);
        const size = await headSize(url);
        if (size == null) throw Object.assign(new Error('not published'), { notPublished: true });
        const rows = await ooklaIsland(url, size, BBOX);
        log(`  Ookla ${j.type} ${j.y} Q${j.q}: ${rows.length} tiles in the island box`);
        return Buffer.from(JSON.stringify(rows));
      });
      return JSON.parse(buf.toString('utf8'));
    } catch (e) {
      if (e.notPublished) return null;
      throw e;
    }
  });
  // Keep quarters up to the last one with both files published.
  let last = -1;
  quarters.forEach((_, i) => { if (got[2 * i] && got[2 * i + 1]) last = i; });
  if (last < 0) throw new Error('no Ookla quarters could be read');
  const qs = quarters.slice(0, last + 1);

  // Pool tiles into hexagons: nearest centre (the hexagons tile the plane, so the nearest centre is
  // the hexagon a point falls in), within one circumradius.
  const cell = 0.05, grid = new Map();
  hexes.forEach((h, i) => { const k = `${Math.floor(h[0] / cell)},${Math.floor(h[1] / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)).push(i); });
  const hexOf = new Map();
  const nearestHex = (lon, lat) => {
    const gx = Math.floor(lon / cell), gy = Math.floor(lat / cell);
    let best = -1, bd = hexR * 1.02;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
      const d = Math.hypot((hexes[i][0] - lon) * kx, (hexes[i][1] - lat) * ky);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const series = (type, off) => {
    const d = [], n = [];
    qs.forEach((_, qi) => {
      const sumD = new Float64Array(hexes.length), tests = new Float64Array(hexes.length);
      for (const r of got[2 * qi + off]) {
        let h = hexOf.get(r[0]);
        if (h == null) { const [x, y] = fromQuadkey(r[0]); const [lon, lat] = tileCentre(x, y); h = nearestHex(lon, lat); hexOf.set(r[0], h); }
        if (h < 0) continue;
        sumD[h] += r[1] * r[4]; tests[h] += r[4];
      }
      d.push(Array.from(sumD, (s, i) => (tests[i] ? Math.round((s / tests[i]) / 100) / 10 : null)));
      n.push(Array.from(tests));
    });
    const total = n.reduce((a, row) => a + row.reduce((x, y) => x + y, 0), 0);
    log(`  ${type}: ${total.toLocaleString('en-CA')} tests pooled into hexagons over ${qs.length} quarters`);
    return { d, n };
  };
  const fixed = series('fixed', 0), mobile = series('mobile', 1);

  await writeOut('internet', {
    source: 'ISED Canada, National Broadband Data (Open Government Licence – Canada); Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps, 2019–present (CC BY-NC-SA 4.0)',
    hex: { r: hexR, angle: hexAngle },
    hexes,
    quarters: qs.map(({ y, q }) => `${y}-Q${q}`),
    fixed,
    mobile,
  });
}

async function fetchAll(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
