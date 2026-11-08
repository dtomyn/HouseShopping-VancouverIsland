# 30 — Know where a tsunami could reach

## Intent
As someone drawn to waterfront property, I want to see which coasts are exposed to a tsunami, how low the ground
near a town or parcel is, and how little warning a Cascadia tsunami would give, so that I can buy where there is
high ground to build on and walk to.

## Where
Layer menu → *Hazard & climate outlook* → **Tsunami zones** (next to *Shaking hazard*). A static layer
([02](02-travel-through-time.md)). Also in the Town Report ([19](19-read-a-town-report.md)), the Town Finder
([20](20-rank-towns.md)) and Land Finder ([22](22-search-for-land.md), [23](23-inspect-and-shortlist-a-parcel.md)).

## Inputs & controls
| Control | Effect |
|---|---|
| **↻ Replay the wave** (panel) | Restarts the sweep from the open Pacific. |
| Hover / click a zone, a mapped area, low ground or a town dot | Tooltip; a click opens its details panel (a town opens its report). |
| Key moments → *1964 — Tsunami floods Port Alberni* | Opens the event: the map flies up Alberni Inlet, with its story, numbers and sources. |

## Behaviour (as implemented)
- **Notification zones**: BC's tsunami notification zones near the island (B north-east, C outer west coast, D Juan
  de Fuca Strait, E Strait of Georgia) as tinted bands over the sea, each in its own colour. A BC tsunami alert
  names the zones that must act.
- **Mapped hazard areas** (outlined in white, filled): only maps published as open data. Strathcona Regional
  District's Cascadia scenario from Nootka Sound to Quatsino Sound (its Alaska scenario is outlined in amber), and
  the City of Victoria's 2021 hazard zone.
- **Low coastal ground** everywhere else: ground under 20 m above sea level within 1 km of the sea, on ~100 m
  terrain, drawn as translucent glowing water columns (5× taller than the water would stand, so they read at
  island scale). While the layer is the picked one, a **wave sweeps in from the open Pacific** along the sea route,
  fills the low ground as it passes (a bright crest at its edge) and the water rises; it repeats every 14 s. When
  another layer is picked, the water stays filled and still.
- **Town dots** (while picked) are coloured by zone and labelled with zone and low-ground share (e.g. `C · 24%`).
- **Panel**: the ~20-minute Cascadia figure for the outer north-west coast, towns on the outer coast, km² of low
  coastal ground, towns with a published map; local versus distant tsunamis; the zones with their towns; the mapped
  studies with publisher and licence; where to find the maps that can't be shown; towns ranked by low coastal
  ground within 2 km; how the screening measure works. Key moments lists the 1964 event.
- **1964 event**: the Great Alaska Earthquake's tsunami reached Tofino and ran up Alberni Inlet, striking Port
  Alberni twice: water rising ~30 cm a minute to ~3 m above high water, 55 homes washed away, 375 damaged. Sections
  explain the inlet's funnelling and distant versus local warning; "Show it on the map" turns on Earthquakes and
  Tsunami zones at March 1964.
- **Town Report**: *Tsunami*: the zone, the share of ground within 2 km that is low coastal ground, whether the
  centre is inside a mapped hazard area (where one covers it), and for Zone C the outer-coast Cascadia figure with
  "no published time for this town".
- **Town Finder**: *Low tsunami exposure* (weight 1 by default): less low coastal ground within 2 km is better;
  inland towns score best.
- **Land Finder → Safety → Tsunami hazard**: *Room to build outside* (the brief's default: at least 1 acre of the
  parcel outside the hazard), *Fully outside*, or *Any*. The hazard is the published map where one covers the
  parcel, else its low coastal ground. The parcel report shows the share, the zone and the acres outside it.

## Acceptance criteria
- `npm run data tsunami` from an empty `.cache/` writes `tsunami.json`, `tsunami-map.json` and `land-tsunami.json`
  without touching `land.json`.
- No per-town arrival time is shown anywhere; the only arrival figure is the cited outer-coast one.
- Every Land Finder parcel has a tsunami value, or (if `land-tsunami.json` is missing or doesn't match
  `land.json`'s parcels) the filter says so and lets every parcel through.
- Inland towns (Lake Cowichan) show no zone and 0% low coastal ground.

## Decisions
- **No invented arrival times.** No openly published per-town Cascadia arrival table could be checked, so the
  roadmap's fallback applies: zones, mapped areas and the 1964 story, plus Ocean Networks Canada's ~20 minutes to
  the outer north-west coast (and ~3 hours to Boundary Bay) quoted as statements. The sweep shows the order the
  coast is reached along the sea, not modelled timing, and the panel says so.
- **Only open maps.** The Capital Region's full hazard-zone service (2021 study) forbids redistribution, so only the
  City of Victoria's open copy is drawn and the panel links to the regional portal. Port Alberni, Tofino, Ucluelet
  and the east-coast districts publish PDFs only.
- **A screening measure fills the gaps.** 20 m sits above the ~12 m run-up ONC estimates for the north-west coast;
  it's labelled as screening, not an official map, everywhere it appears.
- **Parcel values in their own file**, keyed by `land.json`'s parcel order and checked with a hash of its PIDs, so
  the land stage and the parallel parcel measures don't conflict.

## Limits
- ~100 m terrain misses small bluffs, dykes and seawalls; inlets that funnel water (Alberni Inlet) can run higher
  than 20 m, and sheltered shores lower.
- The town measure looks within 2 km of the centre: a town whose centre is inland can still have low waterfront.
- Notification zones are drawn over the sea; towns and parcels take the zone of the nearest coast (within 15 km and
  3 km).
- Published maps cover only Victoria and the north-west coast.

## Source
`scripts/tsunami.mjs` (`tsunami` stage), `src/tsunami.ts` (`tsunamiLayer`), `src/layers.ts` (`CURATED_EVENTS`),
`src/metrics.ts` (`tsunami` metric and criterion), `src/panels.ts` (`tsunamiMetric`), `src/land.ts`
(`loadTsunami`, `renderTsunami`, `tsunamiTile`), `public/data/tsunami.json`, `tsunami-map.json`,
`land-tsunami.json`.
