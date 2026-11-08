# 28 — Check internet and cell coverage

## Intent
As someone who wants to work from home on rural land, I want to see where fast internet and mobile service
really reach, and how that has changed, so that I don't buy a beautiful acreage in a dead zone.

## Where
Layer menu → *Towns & living* → **Internet & cell**. A time layer, quarter by quarter from 2019.
Also in the Town Report, the Town Finder and the Land Finder's *Within reach* section.

## Inputs & controls
| Control | Effect |
|---|---|
| **Home internet (measured)** chip (default) | Columns show the average home download speed Speedtest users got over the past year |
| **Mobile (measured)** chip | The same for phone connections |
| **Advertised 50/10** chip | Columns show the share of homes providers say can get 50/10 Mbps (ISED bands) |
| Timeline ▶ / scrub / arrows | Plays the measured views quarter by quarter, 2019 to the latest published quarter; arrows step a month |
| Hover / click a hexagon | Tooltip, then a details panel with its homes, 50/10 band, mobile, providers and a chart of its speeds (clickable while the layer is the picked one) |

## Behaviour (as implemented)
- **Grid**: ISED's National Broadband Data hexagons (about 25 km² each) that touch the islands, 843 of them. Each
  carries ISED's 2021 home estimate, its 50/10 band (none, under 25%, 25–50%, 50–75%, over 75% of homes), whether
  75%+ get 5/1, and the providers reporting service there by technology.
- **Map**: every cell as faint glass on the ground; populated cells where providers report neither 50/10 nor
  mobile service lie **dark red** (dead zones). In the measured views each cell with tests rises as a glowing
  column, height and colour by the past-year average download (dim red under 10 Mbps, amber 25–50, teal around
  100, ice-white past 500), eased between quarters. The largest towns, one per 15 km, are labelled with their speed.
- **Measured speeds**: Ookla's open ~600 m tiles, pooled into the hexagons and averaged by number of tests over
  the last four quarters.
- **Panel**: headline numbers for the time on the timeline (island home and mobile download, share of homes in
  tested cells averaging 100+ Mbps, dead-zone cells and homes); a chart of the island's average home and mobile
  download by quarter with a playhead; **Biggest jumps since 2019** (towns, 2019 → latest, within 5 km of the
  centre); **Still slow** (towns under 50 Mbps); **Dead zones** (the most-populated ones, by distance to the
  nearest atlas town, with the technologies listed); a speed ramp; a callout comparing advertised and measured.
- **Events**: the island's average home download first passing 200 and 300 Mbps, and the towns whose past-year
  speed first doubled their 2019 level (the four biggest jumps); each event's panel charts that town's speeds.
- **Town Report**: *Internet* — measured home download within 5 km over the past year (and its 2019 level), the
  dwelling-weighted share of homes within 5 km offered 50/10, and mobile service at the town's hexagon.
- **Town Finder**: *Fast internet* (weight 1) ranks towns by that measured home download; towns with fewer than
  20 tests within 5 km are skipped, not penalized.
- **Land Finder**: *50/10 Mbps internet* (any / 25%+ of homes / over half / over 75%) and *Mobile coverage* (any
  / reported), both off by default, in *Within reach*; the parcel report shows the band, the measured speed and
  mobile service for the parcel's hexagon. Parcels are looked up in the hexagons in the browser, so `land.json`
  is unchanged.

## Acceptance criteria
- With nothing else changed, turning on the layer shows columns for the latest quarter; dragging the timeline
  back to 2019 lowers and reddens them (Gold River ~6 Mbps in 2019, ~256 now).
- The Advertised chip swaps to band-coloured columns; the measured chips bring the speeds back.
- Every hexagon tooltip keeps the `<b>Title</b>` + `tk`/`tv` shape; clicking one opens its panel.
- Land Finder: *Show everything*, then *Over 75%*, lowers the count (29,046 → 25,033 at the time of writing).
- `npm run data internet` works from an empty `.cache/` (about 4 minutes).

## Decisions
- **One grid for both sources.** Ookla tiles are pooled into ISED's hexagons so advertised and measured line up
  cell for cell, and the map is a few hundred columns instead of tens of thousands of tiles.
- **Range reads, not downloads.** Ookla publishes one ~200 MB global file per type and quarter. They are sorted by
  quadkey and the islands come early, so the stage fetches only that prefix of each column (20–40 MB).
- **Past-year averages.** Single quarters are noisy in quiet rural cells; four quarters weighted by tests are
  steadier and say "what people got over the last year".
- **Per-parcel values computed in the browser**, as the trails measures are, so parallel work on `land.json`
  doesn't collide and the values always match `internet.json`.
- **Licence.** Ookla's data are CC BY-NC-SA 4.0: allowed for this non-commercial personal atlas with attribution.

## Limits
- A hexagon's 50/10 band covers the whole cell; a parcel in a "50–75%" cell may or may not be served. Ask the
  provider about the address.
- Home counts are ISED's 2021 ranges, so totals are approximate.
- Measured speeds depend on the plans people bought and their Wi-Fi; cells with few tests flicker in and out.
- Starlink and other satellite tests count as home internet in Ookla's data and can't be separated; ISED lists
  satellite providers but doesn't count them toward 50/10.
- Upload and latency are in the source rows but not shown yet.

## Source
`src/internet.ts` (`internetLayer`, `townNet`, `parcelNet`, `internetMetric`), `src/metrics.ts` (`internet`,
*Fast internet*), `src/land.ts` (`net`, `cell` filters), `scripts/internet.mjs`, `public/data/internet.json` from
the `internet` stage.
