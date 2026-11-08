# 09 — See how often wildfire smoke reaches each town

## Intent
As someone with health in mind, I want to know how many smoky days a place gets, so that I account for
smoke even in towns that never burn.

## Where
Layer menu → *History on the timeline* → **Wildfire smoke**.

## Behaviour (as implemented)
- **Map**: provincial air monitors as columns: the number of fire-season (May–October) days when the 24-hour average
  of PM2.5 topped BC's 25 µg/m³ objective. A brown haze settles over the map in the island's smokiest years.
- **Fire season only**: winter wood-stove smoke pooling in valleys crosses the same threshold, so the map counts
  May–October; all-year counts stay in tooltips and the Town Report.
- **Panel**: headline numbers (days over the objective at the average monitor, the most at one station, stations with
  a full year, the smokiest year); fire-season days per year; the smokiest years named; station coverage.
- **Events**: the smokiest years, placed at the station with the most days.
- **Details**: click a monitor for its record and chart ([03](03-get-details-on-anything.md)).
- **Elsewhere**: Town Report shows smoky days a year at the nearest monitor; the Town Finder's *Clean air* criterion
  uses any-season days over the last 10 years (towns over 75 km from a monitor skipped).

## Limits
Counts need at least 75% of a year's data; incomplete years are left out.

## Source
`src/layers.ts` (`smokeLayer`), `public/data/smoke.json` from the `smoke` stage.
