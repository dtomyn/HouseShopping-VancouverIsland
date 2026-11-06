// Ferries: each island's link to Vancouver Island on a typical weekday, worked out from BC Ferries'
// published GTFS timetable feed (maintained for BC Ferries by Trillium Solutions). Run as the
// `ferries` stage of fetch-data.mjs. Lasqueti's passenger ferry (Western Pacific Marine) publishes
// no feed, so it stays hand-typed in scripts/municipalities.mjs.
//
// For each place: sailings = departures a weekday toward Vancouver Island, summed over routes; last =
// the last departure from Vancouver Island that reaches the island; min = the shortest crossing.
// The feed splits multi-stop runs into one trip per leg, so legs are chained back into runs (same
// route, the next leg leaves the terminal the last one reached within 20 minutes) before counting.
//
// Writes ferries.json: { source, places: { [placeKey]: Ferry } }, merged into the places by the app.

import { unzipSync, strFromU8 } from 'fflate';

const FEED = 'https://data.trilliumtransit.com/gtfs/bcferries-bc-ca/bcferries-bc-ca.zip';
const CHAIN_MIN = 20;
const WINDOW_DAYS = 14;

// Terminals by GTFS stop name. `side` is 'vi' (Vancouver Island), 'main' (the mainland), or the key
// of the shortlisted place the terminal serves; `isle` names the island for "calling at" notes.
const TERMINALS = [
  [/Swartz Bay/, 'Swartz Bay', 'vi'],
  [/^Crofton/, 'Crofton', 'vi'],
  [/^Chemainus/, 'Chemainus', 'vi'],
  [/^Nanaimo Harbour/, 'Nanaimo Harbour', 'vi'],
  [/^Buckley Bay/, 'Buckley Bay', 'vi'],
  [/^Campbell River/, 'Campbell River', 'vi'],
  [/^Port McNeill/, 'Port McNeill', 'vi'],
  [/Tsawwassen/, 'Tsawwassen', 'main'],
  [/^Fulford Harbour/, 'Fulford Harbour', 'salt spring island'],
  [/^Vesuvius Bay/, 'Vesuvius Bay', 'salt spring island'],
  [/Long Harbour/, 'Long Harbour', 'salt spring island'],
  [/Sturdies Bay/, 'Sturdies Bay', 'galiano island'],
  [/^Thetis Island/, 'Preedy Harbour', 'thetis island', 'Thetis'],
  [/^Penelakut Island/, 'Telegraph Harbour', null, 'Penelakut'],
  [/^Gabriola Island/, 'Descanso Bay', 'gabriola island'],
  [/^Denman Island \(West\)/, 'Denman West', 'denman island'],
  [/^Quadra Island \(Quathiaski/, 'Quathiaski Cove', 'quadra island'],
  [/^Alert Bay/, 'Alert Bay', 'alert bay'],
  [/Mayne Island/, 'Village Bay', null, 'Mayne'],
  [/Pender Island/, 'Otter Bay', null, 'Pender'],
  [/Saturna Island/, 'Lyall Harbour', null, 'Saturna'],
  [/^Sointula/, 'Sointula', null, 'Sointula'],
];
export const FERRY_PLACES = [...new Set(TERMINALS.map((t) => t[2]).filter((s) => s && s !== 'vi' && s !== 'main'))];

/** A GTFS CSV file as an array of row objects (quoted fields may hold commas). */
function csv(files, name) {
  const [head, ...lines] = strFromU8(files[name]).replace(/^﻿/, '').trim().split(/\r?\n/);
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
  return lines.map((l) => Object.fromEntries(split(l).map((v, i) => [cols[i], v])));
}

const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const clock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const pretty = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}T12:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export async function buildFerries(h) {
  const { log, cached, writeOut } = h;
  // A new month fetches the feed again, so seasonal changes come in on the next run.
  const month = new Date().toISOString().slice(0, 7);
  const zip = await cached(`ferries/bcferries-${month}.zip`, async () => {
    const res = await fetch(FEED, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${FEED}`);
    const b = Buffer.from(await res.arrayBuffer());
    if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error('BC Ferries GTFS feed was not a zip');
    return b;
  });
  const files = unzipSync(new Uint8Array(zip));
  const info = csv(files, 'feed_info.txt')[0];
  log(`feed ${info.feed_version}, service ${info.feed_start_date}–${info.feed_end_date}`);

  // Stops -> terminal (by the stop's own name, falling back to its parent station's).
  const stops = csv(files, 'stops.txt');
  const byId = new Map(stops.map((s) => [s.stop_id, s]));
  const term = new Map();
  for (const s of stops) {
    const names = [s.stop_name, byId.get(s.parent_station)?.stop_name].filter(Boolean);
    const hit = TERMINALS.find(([re]) => names.some((n) => re.test(n)));
    if (hit) term.set(s.stop_id, { name: hit[1], side: hit[2], isle: hit[3] });
  }
  for (const p of FERRY_PLACES) if (![...term.values()].some((t) => t.side === p)) throw new Error(`no terminal in the feed for ${p}`);

  const calendar = csv(files, 'calendar.txt');
  const exceptions = csv(files, 'calendar_dates.txt');
  const trips = csv(files, 'trips.txt');
  const legsOf = new Map();
  for (const s of csv(files, 'stop_times.txt')) {
    const t = term.get(s.stop_id);
    if (!t) continue; // a route that touches none of our terminals
    (legsOf.get(s.trip_id) ?? legsOf.set(s.trip_id, []).get(s.trip_id)).push({ seq: +s.stop_sequence, ...t, arr: minutes(s.arrival_time), dep: minutes(s.departure_time) });
  }

  /** Every place's ferry link on one service date, or {} if nothing runs that day. */
  function day(date) {
    const dow = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T12:00Z`).getUTCDay()];
    const active = new Set(calendar.filter((c) => c[dow] === '1' && c.start_date <= date && c.end_date >= date).map((c) => c.service_id));
    for (const e of exceptions) if (e.date === date) (e.exception_type === '1' ? active.add(e.service_id) : active.delete(e.service_id));

    // Legs running today, deduplicated (the feed repeats some trips under several services).
    const seen = new Set();
    const legs = [];
    for (const t of trips) {
      const visits = active.has(t.service_id) && legsOf.get(t.trip_id)?.sort((a, b) => a.seq - b.seq);
      if (!visits || visits.length < 2) continue;
      const key = `${t.route_id}|${visits.map((v) => `${v.name}@${v.dep}`).join('>')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      legs.push({ route: t.route_id, visits, next: null, prev: null });
    }
    // Chain each leg to the one that carries on from where it ended, so multi-stop runs are whole.
    legs.sort((a, b) => a.visits[0].dep - b.visits[0].dep);
    for (const leg of legs) {
      const start = leg.visits[0];
      let best = null;
      for (const p of legs) {
        const end = p.visits.at(-1);
        if (p === leg || p.next || p.route !== leg.route || end.name !== start.name) continue;
        if (end.arr > start.dep || start.dep - end.arr > CHAIN_MIN) continue;
        if (!best || end.arr > best.visits.at(-1).arr) best = p;
      }
      if (best) { best.next = leg; leg.prev = best; }
    }
    const runs = legs.filter((l) => !l.prev).map((l) => {
      const v = [];
      for (let x = l; x; x = x.next) {
        // where two legs meet, the boat arrives on the first and leaves on the second
        if (v.length) v[v.length - 1] = { ...v.at(-1), dep: x.visits[0].dep };
        v.push(...x.visits.slice(v.length ? 1 : 0).map((s) => ({ ...s })));
      }
      return v;
    });

    const out = {};
    for (const place of FERRY_PLACES) {
      const out_ = new Map(); // boardings on the island: "from@dep" -> sailing
      let last = -1;
      for (const v of runs) {
        for (let i = 0; i < v.length; i++) {
          if (v[i].side === place) {
            // ride on to the first Vancouver Island or mainland terminal; a later stop on the same island is the better boarding
            let j = i + 1;
            while (j < v.length && v[j].side !== 'vi' && v[j].side !== 'main' && v[j].side !== place) j++;
            if (j >= v.length || v[j].side === place) continue;
            const via = [...new Set(v.slice(i + 1, j).map((x) => x.isle).filter(Boolean))];
            out_.set(`${v[i].name}@${v[i].dep}`, { from: v[i].name, to: v[j].name, side: v[j].side, dep: v[i].dep, min: v[j].arr - v[i].dep, via });
          } else if (v[i].side === 'vi') {
            let j = i + 1;
            while (j < v.length && v[j].side !== 'vi' && v[j].side !== place) j++;
            if (j < v.length && v[j].side === place) last = Math.max(last, v[i].dep);
          }
        }
      }
      // Drop sailings nobody would take: another from the same terminal leaves no earlier and arrives no later
      // (on the Southern Gulf Islands route a slow run round Mayne and Saturna can be overtaken).
      const cand = [...out_.values()];
      const all = cand
        .filter((s) => !cand.some((t) => t !== s && t.from === s.from && t.to === s.to && t.dep >= s.dep && t.dep + t.min <= s.dep + s.min && (t.dep > s.dep || t.dep + t.min < s.dep + s.min)))
        .sort((a, b) => a.dep - b.dep);
      const toVI = all.filter((s) => s.side === 'vi');
      if (!toVI.length) continue;
      if (process.env.FERRY_DEBUG === place) for (const s of all) log(`    ${date} ${clock(s.dep)} ${s.from} → ${s.to} ${s.min} min${s.via.length ? ` via ${s.via.join(', ')}` : ''}`);
      out[place] = { toVI, toMain: all.filter((s) => s.side === 'main'), last };
    }
    return out;
  }

  // Every weekday in the next two weeks that the feed covers; each place takes its most common day,
  // so a holiday or a one-off change doesn't stand in for the regular timetable.
  const start = new Date(Math.max(Date.now(), Date.parse(`${info.feed_start_date.slice(0, 4)}-${info.feed_start_date.slice(4, 6)}-${info.feed_start_date.slice(6)}T12:00Z`)));
  const dates = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = new Date(start.getTime() + i * 86400_000);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && ymd(d) <= info.feed_end_date) dates.push(ymd(d));
  }
  if (!dates.length) throw new Error(`the feed ends ${info.feed_end_date}; no weekdays left to read (has BC Ferries published the next season?)`);
  const days = dates.map((d) => [d, day(d)]);

  const places = {};
  for (const place of FERRY_PLACES) {
    const tally = new Map();
    for (const [d, res] of days) {
      const r = res[place];
      if (!r) continue;
      const sig = `${r.toVI.length}|${r.last}|${Math.min(...r.toVI.map((s) => s.min))}`;
      const e = tally.get(sig) ?? tally.set(sig, { n: 0, d, r }).get(sig);
      e.n++;
    }
    const best = [...tally.values()].sort((a, b) => b.n - a.n)[0];
    if (!best) throw new Error(`no weekday sailings found for ${place}`);
    const { r, d } = best;
    places[place] = {
      car: true,
      sailings: r.toVI.length,
      last: clock(r.last),
      min: Math.min(...r.toVI.map((s) => s.min)),
      routes: describe(r),
      schedule: `BC Ferries timetable feed, weekday of ${pretty(d)}`,
    };
    log(`  ${place}: ${places[place].sailings} a day, last back ${places[place].last}, ${places[place].min} min — ${places[place].routes}`);
  }

  await writeOut('ferries', {
    source: { url: FEED, version: info.feed_version, start: info.feed_start_date, end: info.feed_end_date, dates },
    places,
  });
}

/** "Vesuvius Bay–Crofton (12 a day) and Fulford Harbour–Swartz Bay (8 a day); also 2 a day from Long Harbour to Tsawwassen" */
function describe({ toVI, toMain }) {
  const group = (list) => {
    const g = new Map();
    for (const s of list) (g.get(`${s.from}|${s.to}`) ?? g.set(`${s.from}|${s.to}`, []).get(`${s.from}|${s.to}`)).push(s);
    return [...g.values()].sort((a, b) => b.length - a.length);
  };
  const detail = (ss) => {
    const bits = [`${ss.length} a day`];
    const calling = ss.filter((s) => s.via.length);
    if (calling.length) {
      const isles = [...new Set(calling.flatMap((s) => s.via))];
      const share = calling.length === ss.length ? 'all' : calling.length * 2 > ss.length ? 'most' : 'some';
      bits.push(`${share} calling at ${isles.length > 1 ? `${isles.slice(0, -1).join(', ')} or ${isles.at(-1)}` : isles[0]}`);
    }
    const lo = Math.min(...ss.map((s) => s.min)), hi = Math.max(...ss.map((s) => s.min));
    if (hi - lo >= 10) bits.push(`${lo}–${hi} min`);
    return bits.join(', ');
  };
  const vi = group(toVI).map((ss) => `${ss[0].from}–${ss[0].to} (${detail(ss)})`);
  let text = vi.length > 1 ? `${vi.slice(0, -1).join(', ')} and ${vi.at(-1)}` : vi[0];
  const main = group(toMain);
  if (main.length) {
    const froms = new Set(main.map((ss) => ss[0].from));
    const total = main.reduce((n, ss) => n + ss.length, 0);
    text += `; also ${total} a day${froms.size === 1 && toVI.some((s) => !froms.has(s.from)) ? ` from ${[...froms][0]}` : ''} to Tsawwassen`;
  }
  return text;
}
