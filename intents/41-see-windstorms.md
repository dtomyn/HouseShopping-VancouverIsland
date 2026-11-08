# 41 — See the windstorms

## Intent
As someone choosing between a sheltered valley and an open shore, I want to see where and how often the island's
big windstorms hit, so that I know what a place means for trees, power cuts and storm prep.

## Where
Layer menu → *History on the timeline* → **Windstorms** (after *Wildfire smoke*). A time-based layer
([02](02-travel-through-time.md)) with timeline events ([04](04-read-the-story-of-a-moment.md)). Also a
*Windstorms* row in the Town Report ([19](19-read-a-town-report.md)) and a Town Finder criterion
([20](20-rank-towns.md)).

## Inputs & controls
| Control | Effect |
|---|---|
| Timeline / play | Columns change with each year's storm days; a ring flares at a station on each storm day as the playhead crosses it. |
| Hover / click a station | Tooltip (that year's storm and gale days, top gust, record gust); a click opens the station's details with its storm days by year. |
| **🌀 Windstorms ›** (Town Report) | Opens the layer. |

## Behaviour (as implemented)
- **Data**: the `wind` stage finds every station in the box that has recorded a gust (sampling two days a year
  since 1953 and two a month since 2016 across the network), keeps those on or just off the islands, downloads
  their daily peak gust and direction, and joins records of the same site under a new name (Victoria
  International, Gonzales, Port Hardy, Tofino, Estevan Point). A station-year counts once it has 300 days with a
  reading or readings in 11 of 12 months (since 2018 a calm day has been left blank). Stations are marked exposed
  (lighthouses, points, islets) by name or by sitting off the island outline.
- **Map**: a column per station for the year, its height the square root of the storm days (gusts of 90 km/h or
  more, the coast's wind-warning line), coloured by the year's top gust (slate 60 → ice blue 90 → yellow 110 →
  orange 130 → magenta 150 km/h). Exposed stations are hollow dots with paler columns. Storm-day counts are labelled
  while the layer is picked.
- **Timeline**: the sparkline is storm days per sheltered station. Events: the five days with the most stations at
  storm force, the three with the largest share of the stations reporting, and any of the 1962 Columbus Day storm,
  the 2006 Hanukkah Eve storm and the December 2018 storm the stations caught (with a line of context and a link).
  Each event lists every station's gust that day.
- **Panel**: storm days per sheltered station this year, stations reporting, the stormiest year since 1995 and the
  record gust; the chart; a *Not a trend* callout comparing the long airport records' first and last 20 years and
  why that drop can't be read as fewer storms; what wind means for a house (power, trees, exposure); every station
  with its years, recent storm days and record.
- **Town Report**: *Windstorms*: storm days a year (and gale days, 70+) over the last 30 years at the nearest
  sheltered station with 15+ counted years within 40 km (or the nearest exposed one, flagged), with its distance.
- **Town Finder**: *Sheltered from windstorms* (weight 0 by default): fewer storm days is better.

## Acceptance criteria
- `npm run data wind` from an empty `.cache/ogc` rebuilds `wind.json` (~130 KB).
- Every storm day counted comes from a station-year that counts; the "stations reporting" figure for an event is
  the number of counted stations that year.
- The island chart and the town figures never mix in lighthouses unflagged.

## Decisions
- **Daily peak gust from ECCC, not BC Hydro outages.** Outage history isn't open data; the gusts are.
- **Per sheltered station.** The network grew from 4–6 stations in the 1960s to 15+ now, mostly automated
  lighthouses, which would swing a total or an all-station average.
- **No trend claim.** The airports' storm days fall sharply through the 1980s and 1990s in step with new
  instruments and automated reporting; the records aren't homogenized for wind.

## Limits
- Gusts are point measurements: a sheltered street a few kilometres from a windy airport may see a fraction of it.
- Some big storms knocked instruments out (much of the island has no reading for 15 December 2006).
- Nanaimo's airport record counts only in 1962–1966 and since 2019 (in between, too few days carry a gust); the
  Gulf Islands have no gust stations of their own, so their towns use the nearest Vancouver Island one.

## Source
`scripts/wind.mjs` (`wind` stage), `src/wind.ts` (`windLayer`, `windTownRow`), `src/metrics.ts` (`wind` metric and
criterion), `public/data/wind.json`.
