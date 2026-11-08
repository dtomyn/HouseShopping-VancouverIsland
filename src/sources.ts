// The sources view: a cross-section of a western red cedar. Each data source owns a wedge, each
// year is a ring from the pith (1900) out to the bark (today), and a ring glows as bright as that
// source's own record for the year. Projections grow past the bark as a hatched halo. Every number
// here is counted from the loaded data, not typed in.
import * as d3 from 'd3';
import { Data, fmt } from './data';
import { islandAnomalies } from './metrics';
import { esc } from './html';

type Ring = { v: number; label: string; proj?: boolean };
type Source = {
  id: string; key: string; name: string; color: string; group: string;
  owner: string; title: string; url: string; endpoint: string; licence: string;
  gives: string; read: (d: Data) => { n: number; what: string } | null;
  rings: (d: Data) => Record<number, Ring>;
};
type BarkSource = { name: string; key?: string; owner: string; title: string; url: string; licence: string; gives: string; read?: (d: Data) => string };

const Y0 = 1900;
const NOW = new Date().getFullYear();
const FUT = 2070;
const OGL_BC = 'OGL – British Columbia';
const OGL_CA = 'OGL – Canada';

const norm = (rows: Record<number, number>, f: (v: number, max: number) => number) => {
  const max = Math.max(...Object.values(rows), 1e-9);
  return (y: number) => Math.max(0, Math.min(1, f(rows[y], max)));
};
const span = (rings: Record<number, Ring>) => {
  const ys = Object.keys(rings).map(Number);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const climateDiv = d3.scaleLinear<string>().domain([-1.5, -0.4, 0, 0.4, 1.5]).range(['#2b6cb0', '#7fb3e6', '#9aa3b2', '#f4a08a', '#e0312b']).clamp(true);

const SOURCES: Source[] = [
  {
    id: 'fires', key: 'fires', name: 'Wildfires', color: '#ff8a3d', group: 'Hazards',
    owner: 'BC Wildfire Service', title: 'Fire perimeters and fire incident locations, historical and current', url: 'https://catalogue.data.gov.bc.ca/dataset/fire-perimeters-historical',
    endpoint: 'WFS openmaps.gov.bc.ca · PROT_HISTORICAL_FIRE_POLYS_SP, PROT_HISTORICAL_INCIDENTS_SP', licence: OGL_BC,
    gives: 'Every mapped burn on the island and every recorded ignition point.',
    read: (d) => {
      if (!d.fires) return null;
      const perims = new Set(d.fires.perimeters.map((p) => p.id)).size, odd = d.fires.points.filter((p) => p[2] < Y0).map((p) => Math.floor(p[2]));
      return { n: perims + d.fires.points.length, what: `${fmt.int(perims)} fire perimeters and ${fmt.int(d.fires.points.length)} ignition points${odd.length ? ` (${odd.length} dated ${odd.join(' and ')} in the source, left out of the rings)` : ''}` };
    },
    rings: (d) => {
      if (!d.fires) return {};
      const ha: Record<number, number> = {}, n: Record<number, number> = {}, seen = new Set<string>();
      for (const p of d.fires.perimeters) if (!seen.has(p.id)) { seen.add(p.id); ha[p.year] = (ha[p.year] ?? 0) + p.ha; }
      for (const p of d.fires.points) { const y = Math.floor(p[2]); n[y] = (n[y] ?? 0) + 1; }
      const lh = norm(ha, (v, m) => Math.log1p(v ?? 0) / Math.log1p(m)), ln = norm(n, (v, m) => Math.sqrt((v ?? 0) / m));
      const out: Record<number, Ring> = {};
      for (const y of new Set([...Object.keys(ha), ...Object.keys(n)].map(Number))) out[y] = { v: Math.max(lh(y), ln(y) * 0.7), label: `${fmt.ha(ha[y] ?? 0)} burned · ${fmt.int(n[y] ?? 0)} ignitions` };
      return out;
    },
  },
  {
    id: 'quakes', key: 'quakes', name: 'Earthquakes', color: '#f9d65c', group: 'Hazards',
    owner: 'U.S. Geological Survey', title: 'ANSS Comprehensive Earthquake Catalog (ComCat)', url: 'https://earthquake.usgs.gov/fdsnws/event/1/',
    endpoint: 'earthquake.usgs.gov/fdsnws/event/1/query · M2.5+', licence: 'Public domain',
    gives: 'Magnitude 2.5+ earthquakes with their true depth beneath the island.',
    read: (d) => d.quakes && { n: d.quakes.rows.length, what: `${fmt.int(d.quakes.rows.length)} earthquakes` },
    rings: (d) => {
      const n: Record<number, number> = {};
      for (const q of d.quakes?.rows ?? []) { const y = Math.floor(q[4]); n[y] = (n[y] ?? 0) + 1; }
      const f = norm(n, (v, m) => Math.sqrt(v / m));
      return Object.fromEntries(Object.keys(n).map((y) => [y, { v: f(+y), label: `${n[+y]} earthquake${n[+y] === 1 ? '' : 's'} M2.5+` }]));
    },
  },
  {
    id: 'seismic', key: 'seismic', name: 'Shaking hazard', color: '#e86cff', group: 'Hazards',
    owner: 'Natural Resources Canada', title: '2020 National Seismic Hazard Model (NBC 2020)', url: 'https://earthquakescanada.nrcan.gc.ca/hazard-alea/interpolat/nbc-cnb-en.php',
    endpoint: 'earthquakescanada.nrcan.gc.ca/api/canshm/graphql · PGA, site class C', licence: OGL_CA,
    gives: 'Peak ground shaking with a 2% chance in 50 years, on a ~7 km grid and at every town.',
    read: (d) => d.seismic && { n: d.seismic.grid.pga.filter((v) => v != null).length + Object.keys(d.seismic.towns).length, what: `${fmt.int(d.seismic.grid.pga.filter((v) => v != null).length)} grid points and ${Object.keys(d.seismic.towns).length} towns sampled` },
    rings: (d) => {
      if (!d.seismic) return {};
      // A 2020 model of the chance of shaking over the next 50 years: one ring, then a halo.
      const out: Record<number, Ring> = { 2020: { v: 0.9, label: 'Model published for the 2020 building code' } };
      for (let y = NOW + 1; y <= FUT; y++) out[y] = { v: 0.35, proj: true, label: '2% chance in 50 years: the model looks ahead to 2070' };
      return out;
    },
  },
  {
    id: 'tsunami', key: 'tsunami', name: 'Tsunami zones', color: '#38e1ff', group: 'Hazards',
    owner: 'Emergency Management and Climate Readiness BC', title: 'Tsunami Notification Zones for BC', url: 'https://catalogue.data.gov.bc.ca/dataset/tsunami-notification-zones-for-bc',
    endpoint: 'WFS openmaps.gov.bc.ca · ADM_TSUNAMI_NOTIFY_ZONES_SP', licence: OGL_BC,
    gives: 'The zones a BC tsunami alert names, assigned to every town and parcel by its nearest coast.',
    read: (d) => d.tsunami && { n: d.tsunami.zones.length + Object.keys(d.tsunami.towns).length, what: `${d.tsunami.zones.length} notification zones around the island, ${Object.keys(d.tsunami.towns).length} towns placed in them` },
    rings: (d): Record<number, Ring> => (d.tsunami ? { 2021: { v: 0.55, label: 'Victoria’s hazard zone modelled (2021)' }, [NOW]: { v: 0.9, label: 'Notification zones as published today' } } : {}),
  },
  {
    id: 'rivers', key: 'rivers', name: 'River floods', color: '#4cc9f0', group: 'Hazards',
    owner: 'Environment and Climate Change Canada', title: 'HYDAT national water data archive: annual peak flows', url: 'https://api.weather.gc.ca/collections/hydrometric-annual-peaks',
    endpoint: 'api.weather.gc.ca/collections/hydrometric-annual-peaks', licence: OGL_CA,
    gives: 'Each year’s highest flow at river gauges, compared with the river’s normal peak.',
    read: (d) => d.rivers && { n: sum(d.rivers.stations.map((s) => Object.keys(s.peaks).length)), what: `${fmt.int(sum(d.rivers.stations.map((s) => Object.keys(s.peaks).length)))} annual peaks from ${d.rivers.stations.length} gauges` },
    rings: (d) => {
      const r: Record<number, number[]> = {};
      for (const s of d.rivers?.stations ?? []) for (const [y, v] of Object.entries(s.peaks)) if (s.median) (r[+y] ??= []).push(v / s.median);
      return Object.fromEntries(Object.entries(r).map(([y, xs]) => {
        const m = sum(xs) / xs.length;
        return [y, { v: Math.max(0.12, Math.min(1, (m - 0.6) / 0.9)), label: `peaks averaged ${Math.round(m * 100)}% of normal at ${xs.length} gauges` }];
      }));
    },
  },
  {
    id: 'smoke', key: 'smoke', name: 'Smoke days', color: '#c9a27e', group: 'Hazards',
    owner: 'BC Ministry of Environment', title: 'Air Quality and Climate Monitoring: verified hourly PM2.5', url: 'https://catalogue.data.gov.bc.ca/dataset/air-quality-and-climate-monitoring-verified-hourly-air-quality-and-meteorological-data',
    endpoint: 'ftp.env.gov.bc.ca/pub/outgoing/AIR/AnnualSummary · PM25.csv', licence: OGL_BC,
    gives: 'Fire-season days when fine-particle smoke broke BC’s 24-hour objective.',
    read: (d) => d.smoke && { n: sum(d.smoke.stations.map((s) => Object.keys(s.y).length)), what: `${fmt.int(sum(d.smoke.stations.map((s) => Object.keys(s.y).length)))} station-years of hourly readings from ${d.smoke.stations.length} monitors` },
    rings: (d) => {
      const rows: Record<number, number> = Object.fromEntries((d.smoke?.island ?? []).map((r) => [r[0], r[1]]));
      const f = norm(rows, (v, m) => Math.sqrt(v / m));
      return Object.fromEntries(Object.keys(rows).map((y) => [y, { v: Math.max(0.1, f(+y)), label: `${rows[+y].toFixed(1)} days over ${d.smoke!.threshold} µg/m³ per monitor` }]));
    },
  },
  {
    id: 'climate', key: 'climate', name: 'Climate', color: '#f25f5c', group: 'Climate',
    owner: 'Environment and Climate Change Canada', title: 'Adjusted and Homogenized Canadian Climate Data (AHCCD)', url: 'https://api.weather.gc.ca/collections/ahccd-annual',
    endpoint: 'api.weather.gc.ca/collections/ahccd-annual', licence: OGL_CA,
    gives: 'A century of station temperatures, corrected for moves and instrument changes.',
    read: (d) => d.climate && { n: sum(d.climate.stations.map((s) => Object.keys(s.temp).length)), what: `${fmt.int(sum(d.climate.stations.map((s) => Object.keys(s.temp).length)))} station-years from ${d.climate.stations.length} stations` },
    rings: (d) => {
      if (!d.climate) return {};
      const a = islandAnomalies(d);
      return Object.fromEntries(Object.entries(a).map(([y, v]) => [y, { v, label: `${fmt.signed(v, 2)} °C against ${d.climate!.baselinePeriod}` }]));
    },
  },
  {
    id: 'normals', key: 'normals', name: 'Climate normals', color: '#c5e86c', group: 'Climate',
    owner: 'Environment and Climate Change Canada', title: 'Canadian Climate Normals', url: 'https://api.weather.gc.ca/collections/climate-normals',
    endpoint: 'api.weather.gc.ca/collections/climate-normals', licence: OGL_CA,
    gives: 'Thirty-year averages of sunshine, rain days, frost days and snowfall.',
    read: (d) => d.normals && { n: d.normals.stations.length, what: `${d.normals.stations.length} stations’ ${d.normals.period} normals` },
    rings: (d) => {
      if (!d.normals) return {};
      const [a, b] = d.normals.period.split(/[–-]/).map(Number);
      const out: Record<number, Ring> = {};
      for (let y = a; y <= b; y++) out[y] = { v: 0.55, label: `inside the ${d.normals.period} averaging period` };
      return out;
    },
  },
  {
    id: 'future', key: 'future', name: 'Future climate', color: '#ffb86b', group: 'Climate',
    owner: 'Pacific Climate Impacts Consortium · ClimateData.ca', title: 'CanDCS-U6 downscaled CMIP6 projections (26 models)', url: 'https://climatedata.ca/',
    endpoint: 'pavics.ouranos.ca THREDDS/OPeNDAP · CanDCS-U6/ensemble_statistics/30yAvg', licence: OGL_CA,
    gives: 'Projected hot days, temperature, frost and summer rain for the 2030s and 2050s.',
    read: (d) => {
      const f = d.future;
      if (!f) return null;
      const n = f.grid.cells.length * Object.keys(f.vals).length * f.scenarios.length * f.periods.length * f.percentiles.length;
      return { n, what: `${fmt.int(n)} grid values: ${f.grid.cells.length} cells × ${Object.keys(f.vals).length} indices × ${f.scenarios.length} scenarios × ${f.periods.length} periods × ${f.percentiles.length} percentiles` };
    },
    rings: (d) => {
      const f = d.future;
      if (!f) return {};
      const towns = Object.values(f.towns);
      const hot = (p: number) => sum(towns.map((t) => t.hot.ssp245[p][1])) / towns.length;
      const out: Record<number, Ring> = {};
      for (let y = NOW + 1; y <= FUT; y++) {
        const h = y <= 2040 ? hot(1) : y > 2050 ? hot(2) : (hot(1) + hot(2)) / 2;
        out[y] = { v: Math.min(1, 0.25 + h / 12), proj: true, label: `about ${h.toFixed(1)} days over 30 °C a year (median model, moderate scenario)` };
      }
      return out;
    },
  },
  {
    id: 'population', key: 'population', name: 'Population', color: '#3ecf8e', group: 'People & money',
    owner: 'BC Stats', title: 'Sub-provincial population estimates and projections', url: 'https://catalogue.data.gov.bc.ca/dataset/bc-sub-provincial-population-estimates-and-projections',
    endpoint: 'catalogue.data.gov.bc.ca · municipality-population.csv', licence: OGL_BC,
    gives: 'People and the share aged 65+ in every town, with projections to 2046.',
    read: (d) => d.population && { n: sum(Object.values(d.population.munis).map((m) => Object.keys(m.pop).length)), what: `${fmt.int(sum(Object.values(d.population.munis).map((m) => Object.keys(m.pop).length)))} town-years for ${Object.keys(d.population.munis).length} places` },
    rings: (d) => {
      const tot: Record<number, number> = {};
      const series = Object.values(d.population?.munis ?? {}).filter((m) => !m.census);
      for (const m of series) for (const [y, v] of Object.entries(m.pop)) tot[+y] = (tot[+y] ?? 0) + v;
      const first = Math.min(...series.map((m) => m.firstProjection ?? Infinity));
      const f = norm(tot, (v, m) => v / m);
      return Object.fromEntries(Object.keys(tot).map((y) => [y, { v: 0.15 + 0.85 * f(+y) ** 2, proj: +y >= first, label: `${fmt.int(tot[+y])} people in the atlas’s municipalities${+y >= first ? ' (projected)' : ''}` }]));
    },
  },
  {
    id: 'housing', key: 'housing', name: 'Home prices', color: '#b388ff', group: 'People & money',
    owner: 'BC Ministry of Finance', title: 'Property Transfer Tax data, monthly by municipality', url: 'https://catalogue.data.gov.bc.ca/dataset?q=property+transfer+tax+data',
    endpoint: 'catalogue.data.gov.bc.ca/api/3/action/package_search · Property Transfer Tax Data', licence: OGL_BC,
    gives: 'The monthly median sale value in each town.',
    read: (d) => {
      if (!d.housing) return null;
      const rows = Object.values(d.housing.munis).flatMap((s) => Object.values(s));
      return { n: rows.length, what: `${fmt.int(rows.length)} town-months covering ${fmt.int(sum(rows.map((r) => r[2])))} property transfers` };
    },
    rings: (d) => {
      const n: Record<number, number> = {};
      for (const s of Object.values(d.housing?.munis ?? {})) for (const [k, v] of Object.entries(s)) n[+k.slice(0, 4)] = (n[+k.slice(0, 4)] ?? 0) + v[2];
      const f = norm(n, (v, m) => v / m);
      return Object.fromEntries(Object.keys(n).map((y) => [y, { v: 0.2 + 0.8 * f(+y), label: `${fmt.int(n[+y])} property transfers` }]));
    },
  },
  {
    id: 'crime', key: 'crime', name: 'Crime severity', color: '#ff4d8d', group: 'People & money',
    owner: 'Statistics Canada', title: 'Table 35-10-0063-01: Crime Severity Index by police service', url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3510006301',
    endpoint: 'www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/35100063', licence: 'Statistics Canada Open Licence',
    gives: 'How serious and how frequent police-reported crime is, by police service.',
    read: (d) => d.crime && { n: sum(Object.values(d.crime.munis).map((m) => Object.keys(m.csi ?? {}).length)), what: `${fmt.int(sum(Object.values(d.crime.munis).map((m) => Object.keys(m.csi ?? {}).length)))} police-service years for ${Object.keys(d.crime.munis).length} places` },
    rings: (d) => {
      const csi: Record<number, number> = Object.fromEntries(Object.entries(d.crime?.bc.csi ?? {}).map(([y, v]) => [+y, v]));
      const f = norm(csi, (v, m) => v / m);
      return Object.fromEntries(Object.keys(csi).map((y) => [y, { v: 0.15 + 0.85 * f(+y) ** 2, label: `BC-wide Crime Severity Index ${csi[+y].toFixed(1)}` }]));
    },
  },
  {
    id: 'hospitals', key: 'hospitals', name: 'Hospital access', color: '#6c8cff', group: 'People & money',
    owner: 'BC Ministry of Health · HealthLinkBC', title: 'Hospitals in BC and Emergency Rooms in BC', url: 'https://catalogue.data.gov.bc.ca/dataset/emergency-rooms-in-bc',
    endpoint: 'WFS openmaps.gov.bc.ca · drive times from router.project-osrm.org', licence: `${OGL_BC}; routes ODbL`,
    gives: 'Where the hospitals and ERs are, and how long the drive is from each town.',
    read: (d) => d.hospitals && { n: d.hospitals.facilities.length + sum(Object.values(d.hospitals.towns).map((t) => t.length)), what: `${d.hospitals.facilities.length} hospitals and ERs, ${fmt.int(sum(Object.values(d.hospitals.towns).map((t) => t.length)))} routed drives` },
    rings: (d) => d.hospitals ? { [NOW]: { v: 1, label: `${d.hospitals.facilities.length} hospitals and ERs as listed today` } } : {},
  },
  {
    id: 'wells', key: 'wells', name: 'Wells & aquifers', color: '#19d3c5', group: 'Land & water',
    owner: 'BC Ministry of Water, Land and Resource Stewardship', title: 'GWELLS groundwater wells and the BC aquifer classification', url: 'https://catalogue.data.gov.bc.ca/dataset/groundwater-wells',
    endpoint: 'WFS openmaps.gov.bc.ca · GW_WATER_WELLS_WRBC_SVW, GW_AQUIFERS_CLASSIFICATION_SVW', licence: OGL_BC,
    gives: 'Every registered water well with its depth, yield and water level when drilled, and the mapped aquifers with their productivity and vulnerability.',
    read: (d) => d.wells && { n: d.wells.rows.length + d.wells.aquifers.length, what: `${fmt.int(d.wells.rows.length)} water wells (${fmt.int(d.wells.rows.filter((r) => r[4] != null).length)} with a yield) and ${d.wells.aquifers.length} mapped aquifers` },
    rings: (d) => {
      if (!d.wells) return {};
      const n: Record<number, number> = {};
      for (const r of d.wells.rows) if (r[2] != null) n[Math.floor(r[2])] = (n[Math.floor(r[2])] ?? 0) + 1;
      const f = norm(n, (v, m) => Math.sqrt((v ?? 0) / m));
      return Object.fromEntries(Object.keys(n).map(Number).map((y) => [y, { v: f(y), label: `${fmt.int(n[y])} wells drilled` }]));
    },
  },
  {
    id: 'internet', key: 'internet', name: 'Advertised internet', color: '#7dd3fc', group: 'People & money',
    owner: 'Innovation, Science and Economic Development Canada', title: 'National Broadband Data', url: 'https://open.canada.ca/data/en/dataset/00a331db-121b-445d-b119-35dbbe3eedd9',
    endpoint: 'ised-isde.canada.ca/app/scr/sittibc/web/api/openData · Map_Data_CSV.zip, Map_Data_Shapefile.zip', licence: OGL_CA,
    gives: 'For every ~25 km² hexagon: the share of homes providers say can get 50/10 Mbps, mobile service, and who serves it with what.',
    read: (d) => d.internet && { n: d.internet.hexes.length, what: `${fmt.int(d.internet.hexes.length)} hexagons on the islands, ${fmt.int(sum(d.internet.hexes.map((h) => h[6])))} provider listings (not counting satellite)` },
    rings: (d) => d.internet ? { [NOW]: { v: 1, label: `${fmt.int(d.internet.hexes.length)} hexagons as providers report them today` } } : {},
  },
  {
    id: 'internet', key: 'internet', name: 'Measured speeds', color: '#38bdf8', group: 'People & money',
    owner: 'Ookla', title: 'Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps', url: 'https://github.com/teamookla/ookla-open-data',
    endpoint: 'ookla-open-data.s3.amazonaws.com/parquet/performance · fixed and mobile tiles by quarter (range reads)', licence: 'CC BY-NC-SA 4.0',
    gives: 'Average download speeds people measured on home and mobile connections, every quarter since 2019, pooled into the broadband hexagons.',
    read: (d) => {
      if (!d.internet) return null;
      const n = (k: 'fixed' | 'mobile') => sum(d.internet![k].n.map((row) => sum(row)));
      return { n: n('fixed') + n('mobile'), what: `${fmt.int(n('fixed'))} home and ${fmt.int(n('mobile'))} mobile speed tests over ${d.internet.quarters.length} quarters` };
    },
    rings: (d) => {
      if (!d.internet) return {};
      const I = d.internet, tests: Record<number, number> = {};
      I.quarters.forEach((q, i) => { const y = +q.slice(0, 4); tests[y] = (tests[y] ?? 0) + sum(I.fixed.n[i]) + sum(I.mobile.n[i]); });
      const f = norm(tests, (v, m) => Math.sqrt(v / m));
      return Object.fromEntries(Object.keys(tests).map((y) => [y, { v: Math.max(0.15, f(+y)), label: `${fmt.int(tests[+y])} speed tests` }]));
    },
  },
  {
    id: 'trails', key: 'trails', name: 'Trails & waterfalls', color: '#34d399', group: 'Outdoors',
    owner: 'OpenStreetMap contributors · Wikidata', title: 'OpenStreetMap footpaths, hiking routes and waterfalls', url: 'https://www.openstreetmap.org/copyright',
    endpoint: 'overpass-api.de · route=hiking|foot, highway=path|footway|bridleway, waterway=waterfall; wikidata.org wbgetentities (P18 photo, P2048 height)', licence: 'ODbL; Wikidata CC0; photos under their Commons licences',
    gives: 'Every mapped footpath, the named hiking routes with elevation profiles, and every mapped waterfall, with photos and heights where linked.',
    read: (d) => d.trails && { n: d.trails.netPaths + d.trails.routes.length + d.trails.falls.length, what: `${fmt.int(d.trails.netPaths)} footpaths (${fmt.int(d.trails.netKm)} km), ${d.trails.routes.length} named routes, ${fmt.int(d.trails.falls.length)} waterfalls (${d.trails.falls.filter((f) => f.img).length} with photos)` },
    // OpenStreetMap is a map of today, so one ring at the bark
    rings: (d) => d.trails ? { [NOW]: { v: 1, label: `${fmt.int(d.trails.netKm)} km of footpath and ${fmt.int(d.trails.falls.length)} waterfalls as mapped today` } } : {},
  },  {
    id: 'logging', key: 'logging', name: 'Logging', color: '#e9b872', group: 'Outdoors',
    owner: 'BC Ministry of Forests', title: 'Harvested Areas of BC (Consolidated Cutblocks) and Forest Tenure Cutblock Polygons', url: 'https://catalogue.data.gov.bc.ca/dataset/harvested-areas-of-bc-consolidated-cutblocks-',
    endpoint: 'WFS openmaps.gov.bc.ca · VEG_CONSOLIDATED_CUT_BLOCKS_SP, FTEN_CUT_BLOCK_POLY_SVW', licence: OGL_BC,
    gives: 'Every mapped cutblock with the year it was logged, and the blocks approved or being logged now on Crown tenures.',
    read: (d) => {
      if (!d.logging) return null;
      const n = sum(Object.values(d.logging.years).map((y) => y[1])), p = d.logging.plan;
      return { n: n + p.n + p.active, what: `${fmt.int(n)} cutblocks logged since ${Math.min(...Object.keys(d.logging.years).map(Number))} and ${fmt.int(p.n + p.active)} approved or being logged now` };
    },
    rings: (d) => {
      if (!d.logging) return {};
      const ha: Record<number, number> = {};
      for (const [y, v] of Object.entries(d.logging.years)) ha[+y] = v[0];
      const f = norm(ha, (v, m) => Math.sqrt((v ?? 0) / m));
      return Object.fromEntries(Object.keys(ha).map((y) => [y, { v: f(+y), label: `${fmt.ha(ha[+y])} logged in ${d.logging!.years[y][1]} cutblocks` }]));
    },
  },
];

const BARK: BarkSource[] = [
  { name: 'Coastline', key: 'island', owner: 'GeoBC', title: 'Freshwater Atlas islands', url: 'https://catalogue.data.gov.bc.ca/dataset/freshwater-atlas-islands', licence: OGL_BC, gives: 'The outline every layer is clipped to: Vancouver Island and the shortlisted Gulf and Discovery islands.' },
  { name: 'Ferries', key: 'ferries', owner: 'BC Ferries (feed by Trillium Solutions) · Western Pacific Marine', title: 'BC Ferries GTFS timetable feed; Lasqueti’s timetable typed by hand', url: 'https://www.transit.land/feeds/f-c0-bcferries~bc~ca', licence: 'Public GTFS feed (no licence stated)', gives: 'Weekday sailings, the last boat home and crossing times, counted from a typical weekday in the feed; Lasqueti’s passenger ferry has no feed, so it is typed into scripts/municipalities.mjs.', read: (d) => `${d.munis.filter((m) => m.ferry).length} ferry links${d.ferries ? `, feed valid to ${d.ferries.source.end.slice(0, 4)}-${d.ferries.source.end.slice(4, 6)}-${d.ferries.source.end.slice(6)}` : ''}` },
  { name: 'Census 2021', key: 'population', owner: 'Statistics Canada', title: '2021 Census of Population, dissemination areas', url: 'https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm', licence: 'Statistics Canada Open Licence', gives: 'Population, 65+ share and average home value for the unincorporated islands.', read: (d) => `${d.munis.filter((m) => m.island).length} island communities` },
  { name: 'Roads', key: 'hospitals', owner: 'OpenStreetMap contributors · OSRM', title: 'OSRM demo router on OpenStreetMap roads', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', gives: 'The road routes and free-flow drive times to the nearest ER.' },
  { name: 'Tsunami maps', key: 'tsunami', owner: 'Strathcona Regional District · City of Victoria', title: 'West Coast Tsunami Inundation Models; Tsunami Hazard Zone (2021 model)', url: 'https://storymaps.arcgis.com/stories/ee3f568154ed46d8b3ee3b6be04f9c8a', licence: 'OGL – Canada · City of Victoria Open Data Licence', gives: 'Published hazard areas: Cascadia and Alaska scenarios from Nootka Sound to Quatsino Sound, and the City of Victoria’s 2021 hazard zone.', read: (d) => `${d.tsunami?.areas.reduce((a, x) => a + x.polygons, 0) ?? 0} mapped polygons` },
  { name: 'Parks & ownership', key: 'neighbours', owner: 'BC Parks · Parks Canada · BC Ministry of Forests · GeoBC', title: 'Parks, ecological reserves and protected areas; national parks; Generalized Forest Cover Ownership; Freshwater Atlas lakes', url: 'https://catalogue.data.gov.bc.ca/dataset/generalized-forest-cover-ownership', licence: OGL_BC, gives: 'What is next door to every Land Finder parcel and town: parks, Crown land, water and logging, measured on a 50 m grid.', read: (d) => (d.neighbours ? `${d.neighbours.parks.length} named parks and protected areas, ${Object.keys(d.neighbours.towns).length} towns measured` : 'not built yet') },
  { name: 'Basemap', owner: 'CARTO · OpenStreetMap contributors', title: 'Dark Matter vector basemap', url: 'https://carto.com/attributions', licence: 'ODbL / CARTO terms', gives: 'The dark map, place names and roads under every layer.' },
  { name: 'Terrain', owner: 'Mapzen · AWS Open Data', title: 'Terrain Tiles (terrarium)', url: 'https://registry.opendata.aws/terrain-tiles/', licence: 'Open, with attribution', gives: 'The shaded relief of the island’s mountains, the 3D terrain for trail flights and waterfall orbits, trail elevations, and the low coastal ground on the tsunami layer.' },
];

const DERIVED = [
  ['Island warming', 'the climate anomaly is the average of every station’s difference from its own 1961–90 baseline.'],
  ['Smoke days', 'counted here from hourly PM2.5: a day whose mean passes 25 µg/m³, needing 75% of the year on record.'],
  ['Island prices', 'are estimates: each island’s 2021 Census average home value, scaled to transfer-tax medians and moved with its rural area’s sales.'],
  ['Ferry waits', 'add half the gap between weekday sailings to the drive when an island has no ER.'],
  ['Borrowed stations', 'a town without its own sunshine or climate station uses the nearest one within 60 km, and its report names it.'],
  ['Future values', 'come from the model grid cell nearest each town, within 15 km.'],
  ['Well prospects', 'for a town are medians of the wells within 5 km (or on the whole island); for a parcel, of the wells within 1 km. A yield under 2 US gallons a minute counts as low.'],
  ['Trail climbing and times', 'are worked out here: elevations sampled from terrain tiles along each route, and walking time by Naismith’s rule (4.5 km/h plus an hour per 600 m up).'],
  ['Low coastal ground', 'is a tsunami screening measure worked out here from ~100 m terrain: ground under 20 m within 1 km of the sea. Published hazard maps take its place where they exist.'],
  ['Share of the islands logged', 'counts land logged at least once on a 100 m grid, so land logged twice counts once.'],
  ['Next door', 'is measured on a 50 m grid out to 1 km from each parcel; Crown land and parks narrower than 250 m (road allowances, trail corridors) don’t count.'],
  ['Town Finder scores', 'are this atlas’s own blend of the numbers above, weighted by you.'],
];

// ---------------------------------------------------------------------------------------------

let root: HTMLElement | null = null;
export const sourcesOpen = () => !!root;

export function closeSources() {
  if (!root) return;
  const el = root;
  root = null;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 260);
  if (location.hash === '#sources') history.replaceState(null, '', location.pathname + location.search);
}

export function openSources(data: Data, opts: { onShow: (layerId: string) => void }) {
  if (root) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // a few source rows carry impossible dates; they stay off the round
  const rings = SOURCES.map((s) => Object.fromEntries(Object.entries(s.rings(data)).filter(([y]) => +y >= Y0 && +y <= FUT)));
  const reads = SOURCES.map((s) => s.read(data));
  const live = SOURCES.map((_, i) => Object.keys(rings[i]).length > 0);
  const records = sum(reads.map((r) => r?.n ?? 0));
  const owners = new Set([...SOURCES, ...BARK].flatMap((s) => s.owner.split(' · ')));
  const licences = d3.rollups([...SOURCES, ...BARK], (v) => v.length, (s) => s.licence.split(';')[0]).sort((a, b) => b[1] - a[1]);
  const oldest = Math.min(...rings.map((r) => span(r)?.[0] ?? Infinity));
  const status = (key?: string) => {
    const m = key ? data.manifest[key] : null;
    if (!key) return '<span class="src-st">loaded live by the map</span>';
    if (!m?.ok) return `<span class="src-st bad">not available${m?.lastError ? ` · ${esc(m.lastError)}` : ''}</span>`;
    return `<span class="src-st ok">refreshed ${m.updated ? new Date(m.updated).toLocaleDateString('en-CA') : ''}</span>`;
  };

  root = document.createElement('div');
  root.className = 'sources';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'src-title');
  root.innerHTML = `
    <button class="close-x" aria-label="Close sources">×</button>
    <div class="src-stage">
      <div class="src-intro">
        <div class="kicker">Data &amp; sources</div>
        <h2 id="src-title">Every ring has a source</h2>
        <p>A cross-section of the atlas, read like a cedar round. Each wedge is one source, each ring one year from ${Y0} at the pith to ${NOW} at the bark, and a ring glows as strongly as that source’s own record for the year. Projections grow past the bark, hatched. Hover to read a ring; click to open its source.</p>
        <dl class="src-stats">
          <div><dd data-count="${SOURCES.length + BARK.length}">0</dd><dt>sources</dt></div>
          <div><dd data-count="${owners.size}">0</dd><dt>publishers</dt></div>
          <div><dd data-count="${records}">0</dd><dt>records read</dt></div>
          <div><dd data-count="${NOW - oldest + 1}">0</dd><dt>years of rings</dt></div>
        </dl>
      </div>
      <div class="src-round">
        <canvas aria-label="Tree-ring chart: one wedge per data source, one ring per year from ${Y0} to ${NOW}, projections beyond to ${FUT}"></canvas>
        <div class="src-year" aria-hidden="true"></div>
        <div class="src-tip" hidden></div>
      </div>
    </div>
    <div class="src-list">
      ${['Hazards', 'Climate', 'People & money', 'Land & water', 'Outdoors'].map((g) => `<h3>${g}</h3>${SOURCES.map((s, i) => s.group !== g ? '' : `
        <article class="src-card${live[i] ? '' : ' off'}" data-i="${i}" tabindex="0" style="--c:${s.color}">
          <header><span class="src-dot"></span><b>${s.name}</b>${status(s.key)}</header>
          <div class="src-owner">${esc(s.owner)}</div>
          <a class="src-title" href="${s.url}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>
          <p>${s.gives}</p>
          ${reads[i] ? `<div class="src-read"><b data-count="${reads[i]!.n}">0</b> records · ${esc(reads[i]!.what)}${span(rings[i]) ? ` · rings ${span(rings[i])!.join('–')}` : ''}</div>` : ''}
          <code>${esc(s.endpoint)}</code>
          <footer><span class="src-lic">${esc(s.licence)}</span>${live[i] ? `<button class="src-go" data-id="${s.id}">See it on the map →</button>` : ''}</footer>
        </article>`).join('')}`).join('')}
      <h3>The bark: what everything sits on</h3>
      ${BARK.map((b, i) => `
        <article class="src-card bark" data-b="${i}" tabindex="0">
          <header><span class="src-dot"></span><b>${b.name}</b>${status(b.key)}</header>
          <div class="src-owner">${esc(b.owner)}${b.read ? ` · ${b.read(data)}` : ''}</div>
          <a class="src-title" href="${b.url}" target="_blank" rel="noopener">${esc(b.title)} ↗</a>
          <p>${b.gives}</p>
          <footer><span class="src-lic">${esc(b.licence)}</span></footer>
        </article>`).join('')}
      <h3>What this atlas worked out itself</h3>
      <ul class="src-derived">${DERIVED.map(([k, v]) => `<li><b>${k}</b> ${v}</li>`).join('')}</ul>
      <h3>Licences</h3>
      <div class="src-lics">${licences.map(([l, n]) => `<span>${esc(l)} <b>×${n}</b></span>`).join('')}</div>
      <p class="note">Contains information licensed under the Open Government Licence – British Columbia and the Open Government Licence – Canada. Refresh everything with <code>npm run data</code>; a source that fails keeps its last good copy and shows it above. This is a personal exploration tool, not real-estate, insurance or hazard advice.</p>
      <button class="src-cite">Copy a citation</button>
    </div>`;
  document.body.appendChild(root);
  if (location.hash !== '#sources') history.replaceState(null, '', '#sources');

  const el = root;
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>('canvas'), ctx = canvas.getContext('2d')!;
  const tip = $('.src-tip'), yearEl = $('.src-year'), list = $('.src-list');
  const cards = [...el.querySelectorAll<HTMLElement>('.src-card:not(.bark)')];
  const barkCards = [...el.querySelectorAll<HTMLElement>('.src-card.bark')];

  // ---- geometry
  let S = 0, c = 0, rPith = 0, rBark = 0, barkW = 0, rHalo = 0, dpr = 1;
  const GAP = 0.022;
  const wedge = (i: number) => {
    const w = (Math.PI * 2) / SOURCES.length;
    const a = -Math.PI / 2 + i * w;
    return [a + GAP / 2, a + w - GAP / 2];
  };
  const R = (y: number) => y <= NOW + 1
    ? rPith + ((y - Y0) / (NOW + 1 - Y0)) * (rBark - rPith)
    : rBark + barkW + ((y - NOW - 1) / (FUT - NOW)) * (rHalo - rBark - barkW);
  const yearAtR = (r: number) => r <= rBark
    ? Math.floor(Y0 + ((r - rPith) / (rBark - rPith)) * (NOW + 1 - Y0))
    : Math.floor(NOW + 1 + ((r - rBark - barkW) / (rHalo - rBark - barkW)) * (FUT - NOW));

  // a seeded wobble so the wood grain is the same on every redraw
  const rand = d3.randomLcg(42);
  const grain = d3.range(Y0, NOW + 1).map(() => rand());
  const barkNoise = d3.range(240).map(() => rand());

  const wood = document.createElement('canvas'), glow = document.createElement('canvas');
  let hatch: Record<string, CanvasPattern> = {};

  function resize() {
    const box = canvas.parentElement!.getBoundingClientRect();
    // closing (or a hidden parent) reports an empty box; keep the last size rather than draw with negative radii
    if (Math.min(box.width, box.height || box.width) < 80) return;
    S = Math.floor(Math.min(box.width, box.height || box.width));
    dpr = Math.min(2, devicePixelRatio || 1);
    for (const k of [canvas, wood, glow]) { k.width = S * dpr; k.height = S * dpr; }
    canvas.style.width = canvas.style.height = `${S}px`;
    c = S / 2;
    labelsOn = S > 520;
    const labels = labelsOn ? 34 : 8;
    rHalo = c - labels;
    rBark = rHalo * 0.8;
    barkW = Math.max(6, rHalo * 0.035);
    rPith = rHalo * 0.045;
    hatch = {};
    paintWood();
    scene = null;
  }

  function pattern(color: string) {
    if (hatch[color]) return hatch[color];
    const p = document.createElement('canvas');
    p.width = p.height = 8 * dpr;
    const g = p.getContext('2d')!;
    g.strokeStyle = color; g.lineWidth = 2.2 * dpr;
    g.beginPath(); g.moveTo(0, 8 * dpr); g.lineTo(8 * dpr, 0); g.moveTo(-4 * dpr, 4 * dpr); g.lineTo(4 * dpr, -4 * dpr); g.moveTo(4 * dpr, 12 * dpr); g.lineTo(12 * dpr, 4 * dpr); g.stroke();
    return (hatch[color] = ctx.createPattern(p, 'repeat')!);
  }

  function paintWood() {
    const g = wood.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    // heartwood to sapwood
    const fill = g.createRadialGradient(c, c, 0, c, c, rBark);
    fill.addColorStop(0, '#3a2414'); fill.addColorStop(0.55, '#2a190e'); fill.addColorStop(0.92, '#20140c'); fill.addColorStop(1, '#2c1d12');
    g.fillStyle = fill;
    g.beginPath(); g.arc(c, c, rBark, 0, Math.PI * 2); g.fill();
    // one ring per year: a dark latewood line, stronger each decade
    for (let y = Y0 + 1; y <= NOW; y++) {
      const r = R(y), k = grain[y - Y0];
      g.strokeStyle = y % 10 === 0 ? 'rgba(255, 214, 170, 0.13)' : `rgba(8, 4, 2, ${0.25 + k * 0.35})`;
      g.lineWidth = y % 10 === 0 ? 1 : 0.5 + k * 0.8;
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    }
    // bark, with a rough outer edge
    g.beginPath();
    for (let i = 0; i <= barkNoise.length; i++) {
      const a = (i / barkNoise.length) * Math.PI * 2, r = rBark + barkW * (0.75 + barkNoise[i % barkNoise.length] * 0.5);
      i ? g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r) : g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.arc(c, c, rBark, 0, Math.PI * 2, true);
    g.fillStyle = '#4a3020'; g.fill('evenodd');
    // drying checks between the wedges
    g.strokeStyle = 'rgba(6, 9, 16, 0.95)'; g.lineWidth = 2;
    for (let i = 0; i < SOURCES.length; i++) {
      const a = wedge(i)[0] - GAP / 2;
      g.beginPath(); g.moveTo(c + Math.cos(a) * rPith * 1.6, c + Math.sin(a) * rPith * 1.6); g.lineTo(c + Math.cos(a) * (rBark + barkW), c + Math.sin(a) * (rBark + barkW)); g.stroke();
    }
    // the future, not grown yet
    g.setLineDash([2, 5]); g.strokeStyle = 'rgba(180, 191, 210, 0.22)'; g.lineWidth = 1;
    for (const y of [2050, FUT]) { g.beginPath(); g.arc(c, c, R(y), 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]);
  }

  // ---- scene: wood + glowing rings up to `upTo`, halo faded by `halo`
  let scene: HTMLCanvasElement | null = null;
  function paintScene(upTo: number, halo: number) {
    const g = glow.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    SOURCES.forEach((s, i) => {
      const [a0, a1] = wedge(i);
      for (const [ys, ring] of Object.entries(rings[i])) {
        const y = +ys;
        if (ring.proj ? halo <= 0 : y > upTo) continue;
        const r0 = R(y), r1 = y === NOW ? rBark + barkW : R(y + 1) - (y > NOW ? 0.6 : 0.25);
        g.beginPath(); g.arc(c, c, r1, a0, a1); g.arc(c, c, Math.max(rPith, r0), a1, a0, true); g.closePath();
        if (ring.proj) {
          g.globalAlpha = halo * (0.35 + 0.65 * ring.v);
          g.fillStyle = pattern(s.color);
        } else {
          const climate = s.id === 'climate';
          g.globalAlpha = climate ? 0.95 : 0.12 + 0.88 * ring.v;
          g.fillStyle = climate ? climateDiv(ring.v) : s.color;
        }
        g.fill();
      }
    });
    g.globalAlpha = 1;
    const out = document.createElement('canvas');
    out.width = out.height = S * dpr;
    const o = out.getContext('2d')!;
    o.drawImage(wood, 0, 0);
    o.globalCompositeOperation = 'lighter';
    o.filter = `blur(${7 * dpr}px)`; o.globalAlpha = 0.75; o.drawImage(glow, 0, 0);
    o.filter = 'none'; o.globalAlpha = 0.9; o.drawImage(glow, 0, 0);
    return out;
  }

  // ---- interaction state
  type Hit = { i: number; y: number } | { b: number } | null;
  let hover: Hit = null;
  let pinned: number | null = null;
  let labelsOn = true;

  function draw() {
    if (!scene) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scene, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const active = hover && 'i' in hover ? hover.i : pinned;
    // dim every wedge but the active one
    if (active != null) {
      ctx.fillStyle = 'rgba(4, 7, 13, 0.62)';
      SOURCES.forEach((_, i) => {
        if (i === active) return;
        const [a0, a1] = wedge(i);
        ctx.beginPath(); ctx.arc(c, c, rHalo, a0 - GAP / 2, a1 + GAP / 2); ctx.arc(c, c, rPith * 0.9, a1 + GAP / 2, a0 - GAP / 2, true); ctx.closePath(); ctx.fill();
      });
    }
    // the hovered year, across every source
    if (hover && 'y' in hover) {
      const r = (R(hover.y) + R(hover.y + 1)) / 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
    }
    if (hover && 'b' in hover) {
      const w = (Math.PI * 2) / BARK.length, a0 = -Math.PI / 2 + hover.b * w;
      ctx.strokeStyle = '#ffd9a8'; ctx.lineWidth = barkW + 4;
      ctx.beginPath(); ctx.arc(c, c, rBark + barkW / 2, a0, a0 + w); ctx.stroke();
    }
    // year ticks up the top check
    ctx.font = '500 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const y of [1925, 1950, 1975, 2000, NOW, 2050, FUT]) {
      const r = y === NOW ? rBark + barkW / 2 : R(y), t = y === NOW ? 'today' : String(y);
      ctx.fillStyle = 'rgba(6, 10, 18, 0.8)';
      ctx.fillRect(c + 5, c - r - 7, ctx.measureText(t).width + 8, 14);
      ctx.fillStyle = y > NOW ? '#b4bfd2' : '#e9eef7';
      ctx.fillText(t, c + 9, c - r);
    }
    // source names around the rim
    if (labelsOn) {
      ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      SOURCES.forEach((s, i) => {
        const [a0, a1] = wedge(i), a = (a0 + a1) / 2;
        const flip = Math.sin(a) > 0.05;
        ctx.save();
        ctx.translate(c + Math.cos(a) * (rHalo + 16), c + Math.sin(a) * (rHalo + 16));
        ctx.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
        ctx.fillStyle = active == null || active === i ? s.color : 'rgba(180, 191, 210, 0.35)';
        ctx.fillText(s.name, 0, 0);
        ctx.restore();
      });
    }
  }

  function pick(ev: PointerEvent): Hit {
    const b = canvas.getBoundingClientRect();
    const x = ev.clientX - b.left - c, y = ev.clientY - b.top - c;
    const r = Math.hypot(x, y);
    let a = Math.atan2(y, x) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    if (r >= rBark && r <= rBark + barkW + 2) return { b: Math.floor(a / ((Math.PI * 2) / BARK.length)) };
    if (r < rPith || r > rHalo) return null;
    return { i: Math.min(SOURCES.length - 1, Math.floor(a / ((Math.PI * 2) / SOURCES.length))), y: yearAtR(r) };
  }

  function showTip(ev: PointerEvent) {
    if (!hover) { tip.hidden = true; return; }
    let html: string;
    if ('b' in hover) {
      const b = BARK[hover.b];
      html = `<b>${b.name}</b> · the bark<br>${esc(b.owner)}`;
    } else {
      const s = SOURCES[hover.i], ring = rings[hover.i][hover.y];
      html = `<b style="color:${s.color}">${s.name}</b> · ${hover.y}<br>${ring ? esc(ring.label) : '<span class="dim">no record this year</span>'}`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const b = canvas.parentElement!.getBoundingClientRect();
    const x = ev.clientX - b.left, y = ev.clientY - b.top;
    tip.style.transform = `translate(${Math.min(x + 14, b.width - tip.offsetWidth - 4)}px, ${y + 16}px)`;
  }

  const focusCard = (card: HTMLElement | undefined) => {
    if (!card) return;
    el.querySelectorAll('.src-card.on').forEach((k) => k.classList.remove('on'));
    card.classList.add('on');
    card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'nearest' });
  };

  canvas.addEventListener('pointermove', (ev) => {
    hover = pick(ev);
    canvas.style.cursor = hover ? 'pointer' : 'default';
    showTip(ev);
    draw();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; draw(); });
  canvas.addEventListener('click', (ev) => {
    const h = pick(ev as PointerEvent);
    if (!h) { pinned = null; el.querySelectorAll('.src-card.on').forEach((k) => k.classList.remove('on')); draw(); return; }
    if ('b' in h) { pinned = null; focusCard(barkCards[h.b]); }
    else { pinned = h.i; focusCard(cards[h.i]); }
    draw();
  });
  cards.forEach((card, i) => {
    card.addEventListener('pointerenter', () => { pinned = i; draw(); });
    card.addEventListener('focus', () => { pinned = i; draw(); });
  });
  barkCards.forEach((card, i) => card.addEventListener('pointerenter', () => { hover = { b: i }; draw(); }));
  list.addEventListener('pointerleave', () => { if (hover && 'b' in hover) hover = null; draw(); });
  el.querySelectorAll<HTMLButtonElement>('.src-go').forEach((btn) => btn.addEventListener('click', () => { closeSources(); opts.onShow(btn.dataset.id!); }));
  $('.close-x').addEventListener('click', closeSources);
  const cite = $<HTMLButtonElement>('.src-cite');
  cite.addEventListener('click', async () => {
    const text = `Island Atlas: Vancouver Island in data (${NOW}). Compiled from ${[...owners].join(', ')}. ${licences.map(([l]) => l).join('; ')}. Accessed ${new Date().toLocaleDateString('en-CA')}.`;
    try { await navigator.clipboard.writeText(text); cite.textContent = 'Citation copied'; } catch { cite.textContent = text; }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSources(); }
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('.src-card')) (e.target as HTMLElement).querySelector<HTMLAnchorElement>('.src-title')?.click();
  });

  // ---- growth: the round grows from the pith to today, then the halo of projections appears
  const counters = [...el.querySelectorAll<HTMLElement>('[data-count]')];
  const count = (p: number) => counters.forEach((k) => (k.textContent = fmt.int(+k.dataset.count! * p)));
  const ro = new ResizeObserver(() => { resize(); if (grown) { scene = paintScene(NOW, 1); draw(); } });
  let grown = false;
  resize();
  ro.observe(canvas.parentElement!);
  const GROW = calm ? 0 : 2600, HALO = calm ? 0 : 900, t0 = performance.now();
  const ease = d3.easeCubicOut;
  const step = (now: number) => {
    if (root !== el) { ro.disconnect(); return; }
    const t = now - t0;
    const g = GROW ? ease(Math.min(1, t / GROW)) : 1;
    const h = HALO ? Math.max(0, Math.min(1, (t - GROW) / HALO)) : 1;
    const y = Math.floor(Y0 + g * (NOW - Y0));
    scene = paintScene(y, h);
    draw();
    count(g);
    yearEl.textContent = h < 1 ? String(y) : '';
    yearEl.classList.toggle('done', g >= 1);
    if (g < 1 || h < 1) requestAnimationFrame(step);
    else grown = true;
  };
  requestAnimationFrame(step);
  el.querySelector<HTMLElement>('.close-x')!.focus({ preventScroll: true });
}

