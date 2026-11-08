# 08 — See how much the island has warmed

## Intent
As someone thinking decades ahead, I want to see a century of temperature records across the island,
so that I can see how much it has already warmed and where.

## Where
Layer menu → *History on the timeline* → **Climate**.

## Behaviour (as implemented)
- **Map**: 20 long-record stations (ECCC homogenized data, 1902–2020) as columns whose height and colour show that
  year's difference from each station's own 1961–1990 average: blue when cool, red when warm.
- **Panel**: headline numbers (island anomaly for the year, warmest year, 2011–2020 average, warming per decade since
  1950); island warming stripes; anomaly by year as a chart; a note that the homogenized series end in 2020.
- **Events**: the warmest year in the island record.
- **Details**: click a station for its own century chart ([03](03-get-details-on-anything.md)).
- **Elsewhere**: Town Report shows the nearest station's mean temperature and warming trend; the Town Finder's
  *Mild & warm* criterion uses the mean since 1991.

## Limits
The adjusted and homogenized series currently end in 2020.

## Source
`src/layers.ts` (`climateLayer`), `src/metrics.ts` (`islandAnomalies`, `slope`), `public/data/climate.json`
from the `climate` stage.
