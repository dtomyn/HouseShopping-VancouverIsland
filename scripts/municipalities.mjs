// `ferry` is a place's link to Vancouver Island. BC Ferries places get theirs from the timetable feed
// (the `ferries` stage, scripts/ferries.mjs, writes ferries.json and the app merges it in). Lasqueti's
// passenger ferry publishes no feed, so its link is typed here from Western Pacific Marine's timetable:
// sailings = departures to Vancouver Island on a weekday; last = the last weekday departure back
// (24 h clock); min = shortest crossing in minutes. Re-read it when the timetable changes.

// Incorporated municipalities on Vancouver Island, with approximate town-centre coordinates.
// `key` is the normalized name used to join BC Stats, BC Property Transfer Tax and StatCan tables.
export const MUNICIPALITIES = [
  { key: 'victoria', name: 'Victoria', rd: 'Capital', lon: -123.3656, lat: 48.4284 },
  { key: 'saanich', name: 'Saanich', rd: 'Capital', lon: -123.381, lat: 48.484 },
  { key: 'oak bay', name: 'Oak Bay', rd: 'Capital', lon: -123.317, lat: 48.4265 },
  { key: 'esquimalt', name: 'Esquimalt', rd: 'Capital', lon: -123.413, lat: 48.432 },
  { key: 'central saanich', name: 'Central Saanich', rd: 'Capital', lon: -123.418, lat: 48.585 },
  { key: 'north saanich', name: 'North Saanich', rd: 'Capital', lon: -123.418, lat: 48.665 },
  { key: 'sidney', name: 'Sidney', rd: 'Capital', lon: -123.399, lat: 48.65 },
  { key: 'view royal', name: 'View Royal', rd: 'Capital', lon: -123.433, lat: 48.452 },
  { key: 'colwood', name: 'Colwood', rd: 'Capital', lon: -123.495, lat: 48.4235 },
  { key: 'langford', name: 'Langford', rd: 'Capital', lon: -123.505, lat: 48.45 },
  { key: 'metchosin', name: 'Metchosin', rd: 'Capital', lon: -123.537, lat: 48.382 },
  { key: 'highlands', name: 'Highlands', rd: 'Capital', lon: -123.505, lat: 48.513 },
  { key: 'sooke', name: 'Sooke', rd: 'Capital', lon: -123.727, lat: 48.374 },
  { key: 'duncan', name: 'Duncan', rd: 'Cowichan Valley', lon: -123.7079, lat: 48.7787 },
  { key: 'north cowichan', name: 'North Cowichan', rd: 'Cowichan Valley', lon: -123.72, lat: 48.82 },
  { key: 'lake cowichan', name: 'Lake Cowichan', rd: 'Cowichan Valley', lon: -124.054, lat: 48.825 },
  { key: 'ladysmith', name: 'Ladysmith', rd: 'Cowichan Valley', lon: -123.818, lat: 48.9975 },
  { key: 'nanaimo', name: 'Nanaimo', rd: 'Nanaimo', lon: -123.9401, lat: 49.1659 },
  { key: 'lantzville', name: 'Lantzville', rd: 'Nanaimo', lon: -124.075, lat: 49.25 },
  { key: 'parksville', name: 'Parksville', rd: 'Nanaimo', lon: -124.312, lat: 49.319 },
  { key: 'qualicum beach', name: 'Qualicum Beach', rd: 'Nanaimo', lon: -124.443, lat: 49.348 },
  { key: 'port alberni', name: 'Port Alberni', rd: 'Alberni-Clayoquot', lon: -124.8055, lat: 49.2339 },
  { key: 'tofino', name: 'Tofino', rd: 'Alberni-Clayoquot', lon: -125.9066, lat: 49.153 },
  { key: 'ucluelet', name: 'Ucluelet', rd: 'Alberni-Clayoquot', lon: -125.546, lat: 48.942 },
  { key: 'courtenay', name: 'Courtenay', rd: 'Comox Valley', lon: -124.9936, lat: 49.6866 },
  { key: 'comox', name: 'Comox', rd: 'Comox Valley', lon: -124.9022, lat: 49.6733 },
  { key: 'cumberland', name: 'Cumberland', rd: 'Comox Valley', lon: -125.026, lat: 49.619 },
  { key: 'campbell river', name: 'Campbell River', rd: 'Strathcona', lon: -125.2733, lat: 50.0331 },
  { key: 'gold river', name: 'Gold River', rd: 'Strathcona', lon: -126.051, lat: 49.779 },
  { key: 'sayward', name: 'Sayward', rd: 'Strathcona', lon: -125.96, lat: 50.383 },
  { key: 'tahsis', name: 'Tahsis', rd: 'Strathcona', lon: -126.658, lat: 49.917 },
  { key: 'zeballos', name: 'Zeballos', rd: 'Strathcona', lon: -126.845, lat: 49.98 },
  { key: 'port hardy', name: 'Port Hardy', rd: 'Mount Waddington', lon: -127.497, lat: 50.724 },
  { key: 'port mcneill', name: 'Port McNeill', rd: 'Mount Waddington', lon: -127.085, lat: 50.59 },
  { key: 'port alice', name: 'Port Alice', rd: 'Mount Waddington', lon: -127.455, lat: 50.386 },
  { key: 'alert bay', name: 'Alert Bay', rd: 'Mount Waddington', lon: -126.931, lat: 50.585 },
];

// Gulf and Discovery islands on the shortlist. All are unincorporated, so municipal tables don't
// cover them: `fwa` names the BC Freshwater Atlas island (outline, clipping, census areas), `ptt`
// the BC Assessment rural jurisdiction(s) whose Property Transfer Tax sales include the island,
// `rcmp` the rural RCMP detachment in the StatCan crime table. `areas` says what those cover.
export const ISLAND_COMMUNITIES = [
  {
    key: 'salt spring island', name: 'Salt Spring Island', rd: 'Capital', lon: -123.4985, lat: 48.8528, fwa: 'Saltspring Island',
    ptt: ['764'], pttName: 'Gulf Islands Rural', rcmp: 'saltspring island',
    areas: { crime: 'Salt Spring Island RCMP' },
  },
  {
    key: 'galiano island', name: 'Galiano Island', rd: 'Capital', lon: -123.3226, lat: 48.8775, fwa: 'Galiano Island',
    ptt: ['764'], pttName: 'Gulf Islands Rural', rcmp: 'outer gulf islands',
    areas: { crime: 'Outer Gulf Islands RCMP — Galiano, Mayne, Pender and Saturna' },
  },
  {
    key: 'thetis island', name: 'Thetis Island', rd: 'Cowichan Valley', lon: -123.673, lat: 48.997, fwa: 'Thetis Island', ptt: ['765', '766'], pttName: 'Duncan Rural',
    areas: { pop: 'census area also takes in Valdes and other small neighbouring islands' },
  },
  {
    key: 'gabriola island', name: 'Gabriola Island', rd: 'Nanaimo', lon: -123.852, lat: 49.17, fwa: 'Gabriola Island', ptt: ['768'], pttName: 'Nanaimo Rural', rcmp: 'gabriola island',
    areas: { crime: 'Gabriola Island RCMP' },
  },
  {
    key: 'lasqueti island', name: 'Lasqueti Island', rd: 'Nanaimo', lon: -124.3515, lat: 49.4965, fwa: 'Lasqueti Island', ptt: ['768'], pttName: 'Nanaimo Rural',
    note: 'No car ferry: a passenger ferry runs from French Creek, and the island is off the power grid.',
    ferry: { car: false, sailings: 2, last: '17:30', min: 60, routes: 'passenger-only False Bay–French Creek (14 round trips a week off-peak; freight by arrangement, vehicles by private barge)', schedule: 'Western Pacific Marine, 2026 non-peak timetable (typed by hand)' },
  },
  {
    key: 'denman island', name: 'Denman Island', rd: 'Comox Valley', lon: -124.799, lat: 49.534, fwa: 'Denman Island', ptt: ['771', '784'], pttName: 'Courtenay Rural',
  },
  {
    key: 'quadra island', name: 'Quadra Island', rd: 'Strathcona', lon: -125.2135, lat: 50.0445, fwa: 'Quadra Island', ptt: ['772'], pttName: 'Campbell River Rural', rcmp: 'quadra island',
    areas: { crime: 'Quadra Island RCMP' },
  },
].map((c) => ({
  ...c,
  island: true,
  // Island sales are only published inside the rural jurisdiction, so the price is an estimate.
  ...(c.ptt && { areas: { ...c.areas, housing: `Estimate: the island's 2021 Census home values, moved with ${c.pttName} sales since` } }),
}));

/** Every place the atlas reports on: the island's municipalities, then the island communities. */
export const PLACES = [...MUNICIPALITIES, ...ISLAND_COMMUNITIES];

const PREFIX = /^(the\s+)?(corporation of the\s+)?(city|district|town|township|village|resort municipality|district municipality)\s+of\s+/i;

/** "234 - City of Victoria", "District of Saanich (SD61)", "Victoria (CY)" -> "victoria" */
export function normalizeMuniName(raw) {
  return String(raw)
    .replace(/^\s*\d+\s*-\s*/, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(PREFIX, '')
    .replace(/[^a-z ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export const MUNI_BY_KEY = new Map(MUNICIPALITIES.map((m) => [m.key, m]));
export const PTT_CODES = new Set(ISLAND_COMMUNITIES.flatMap((c) => c.ptt ?? []));
export const ISLAND_BY_RCMP = new Map(ISLAND_COMMUNITIES.filter((c) => c.rcmp).map((c) => [c.rcmp, c]));
