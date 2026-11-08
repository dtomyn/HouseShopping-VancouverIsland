# 32 — Check what's next door

## Intent
As a buyer of rural land or a home in a small town, I want to know what surrounds a place: a park that will stay
wild, Crown land with no neighbours, recent clearcuts, or logging that's approved and coming, so that I'm not
surprised by the view, the noise or the logging trucks after we buy.

## Where
- Land Finder → filter rail → **Next door** (a funnel stage of the same name).
- Land Finder → a parcel's report → **Next door** (a ring of what surrounds it, and four measures).
- Town Report → **Logging & parks nearby**.

## Inputs & controls
| Control | Effect |
|---|---|
| A park next door: *Either* / *Backs onto a park* | Keeps parcels within 100 m of a provincial, national or regional park, ecological reserve, conservancy or protected area. |
| Crown land next door: *Either* / *Backs onto Crown land* | Keeps parcels within 100 m of provincial Crown land. |
| No recent logging nearby (slider, 0–60 years, with a crossfilter histogram) | Keeps parcels with no mapped cutblock within 1 km, or on the parcel, in the last N years. The far right of the histogram is parcels with no logging on record. |
| Planned logging: *Either* / *None within 1 km* | Drops parcels with an approved or active Crown cutblock within 1 km. |

All four start off, so the *Our brief* preset and its matches are unchanged.

## Behaviour (as implemented)
- The `neighbours` stage draws the islands onto a 50 m grid: land and water (Freshwater Atlas islands and lakes of
  4+ ha), ownership from Generalized Forest Cover Ownership (Crown, park, private and other), named parks from BC's
  parks layer and Parks Canada, the latest harvest year from the cutblocks and the approved and active blocks.
- Crown land and park strips under 250 m wide (road allowances, foreshore, rail-trail corridors) are removed with a
  morphological opening, so "backs onto" means a real tract, not a road allowance.
- For each Land Finder parcel it measures, out to 1 km from the parcel's edge: the distance to a park (and which),
  to Crown land, to an approved or active block and to water; the latest harvest year within 1 km (and on the parcel
  itself); hectares logged within 1 km in the last 10 years; and a ring of 16 directions × 3 bands (0–250 m,
  250–500 m, 500 m–1 km), each showing what covers most of it: private or other land, water, park, Crown land,
  logged in the last 10 years, 10–30 years ago, over 30 years ago, or approved or being logged.
- The parcel report draws that ring around the parcel (north up, sweeping in), with a key of each kind's share, and
  four tiles: park, Crown land, last logged nearby, planned logging. A tile is marked when it fails an active filter.
- For each town it measures, within 5 km of the centre: hectares logged in the last 10 years, the share ever logged,
  approved or active blocks, the share in parks; and the nearest named parks within 20 km (and the nearest large
  regional park), shown as chips in the Town Report.
- `land.json` is never rewritten: `land-neighbours.json` follows its parcel order and carries a hash of its PID
  column; if the hash doesn't match, the app ignores the file and the Next door filters say to rebuild it.

## Acceptance criteria
- With the file present, *Backs onto a park* keeps about 2,600 of 29,000 parcels and *Backs onto Crown land* about
  3,400; about 1,300 have an approved or active block within 1 km.
- Every number in the ring and tiles comes from `land-neighbours.json`; the Town Report row from `neighbours.json`.
- Without `land-neighbours.json` (or with a stale one), the Land Finder works as before and the section says to run
  `npm run data logging neighbours`.

## Limits
- Generalized Forest Cover Ownership is generalized: small Crown parcels, recent land deals and First Nations
  treaty lands may be out of date. Regional and local parks come from it and have no names.
- "Backs onto" allows 100 m for the 50 m grid and the gap of a road or creek; check the survey and title.
- Crown land is good for privacy but not guaranteed: it can be logged, leased or sold.
- Planned logging covers Crown tenures only; private forest land's harvest plans aren't public.
- Logging history inherits the record's gaps ([31](31-see-a-century-of-logging.md)).

## Source
`scripts/neighbours.mjs` (`buildNeighbours`, `openMask`, `pidHash`), `src/nextdoor.ts` (`loadNeighbours`,
`ringSvg`, `NB_CLASSES`), `src/land.ts` (*Next door* section, `nextDoorDetail`), `src/logging.ts`
(`loggingTownRow`); data `public/data/land-neighbours.json` and `neighbours.json` from the `neighbours` stage.
