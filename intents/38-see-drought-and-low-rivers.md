# 38 — See drought and low rivers

## Intent
As someone choosing a town or a rural parcel that may depend on a well, a creek or a small reservoir, I want to see
how low the island's rivers have run in dry summers, year by year and basin by basin, so that I know how often
severe drought comes, whether it is coming more often, and how close the streams near a place get to running dry.

## Where
Layer menu → *History on the timeline* → **Drought & low rivers** (after Wells & groundwater). A time-based layer
(1913 → the last HYDAT year). Also a Town Report row and a Town Finder criterion.

## Inputs & controls
| Control | Effect |
|---|---|
| Timeline | June–October: each basin shows that month's mean flow ranked against the gauge's own record for that month. November–May: the summer's lowest 7-day flow (Nov–Dec this year's summer, Jan–May last year's). |
| Hover a basin or gauge dot | Tooltip: gauge name, id and drainage area, the current rank in words and as a percentile, its usual summer low, years of record. |
| Click a basin or gauge | Details panel: drainage area and record; usual summer low, average flow, usual low as a share of average, lowest summer, summers under 2% of average flow, driest-10% summers in the last 20; the five driest summers with the week each low ended; a note for rivers held up by storage (usual low over 15% of average) and for Reference Hydrometric Basin Network gauges; a bar chart of every summer's 7-day low coloured by rank; link to the Water Office page. |
| Panel gauge list | Clicking a gauge opens its details. *Well water* and *Snowpack* buttons open those layers. |
| Town Report → *Summer river lows* | The nearest long-record gauge's share of summers nearly dry, recent driest-10% summers and driest years; a button opens this layer. |
| Town Finder → *Rarely in severe drought* | Weight 0 by default. |

## Behaviour (as implemented)
- The `drought` stage (`scripts/drought.mjs`) takes the island's hydrometric stations (the `rivers` stage's station
  list, inside the island outline) and pages each one's full HYDAT daily mean discharge from `api.weather.gc.ca`
  (`hydrometric-daily-mean`, geometry skipped), cached per gauge. For each summer (1 June – 31 October) with 95% of
  days measured it finds the lowest 7-day average flow and the day that week ended, and each month's mean flow (25+
  days). Each summer's low and each month's flow is ranked 0–100 against the same gauge's other summers (0 = lowest
  on record). The mean annual flow uses calendar years with all but 10 days measured (5+ years).
- Gauges with 10+ complete summers are kept: 81, from 1913 to 2025. The island figure for a year is the median rank
  of the gauges with 20+ summers, when 5+ report. Each town gets its nearest gauge with 20+ summers still measured
  in the last 4 HYDAT years, within 40 km (41 of 43 places).
- Basin outlines come from ECCC's Hydrometric Network Basin Polygons (region 08 GeoJSON, ~80 MB zipped, scanned
  line by line for the island's gauges, simplified) and go to `drought-map.json` with the monthly ranks, loaded the
  first time the layer is shown.
- **Map**: each gauge's basin shaded from dark red (lowest on record) through amber (driest 10%, below normal) and
  pale (normal) to blue (wet), bigger basins underneath smaller ones; gauge dots in the same colour, a white ring and
  a "record low" label (picked layer only, 20+ summer gauges) at a record low.
- **Panel**: the median gauge's rank now, gauges in their driest 10%, record lows, the driest summer; a chart of
  every year (bars up = drier than usual); the colour scale; the five driest summers (years with 20+ gauges) and how
  many came in the last 15 years; what BC's 0–5 drought levels are and why they aren't used; why it matters for a
  parcel on a well (button to Well water), a town on a small reservoir or creek, and the snowpack (button to
  Snowpack); gauges still measured ranked by driest-10% summers in the last 20 (about 2 expected by chance);
  coverage, regulation and HYDAT notes.
- **Events**: the five driest summers by island median among years with 20+ gauges (1985, 1992, 2014, 2015, 2023),
  each at the typical day of that summer's low, naming the long-record gauges' lows and any record lows.
- **Town Report** *Summer river lows*: the share of the nearest gauge's summers whose 7-day low fell under 2% of its
  mean annual flow ("nearly dry"), its name, distance and record, a storage note where it applies, driest-10%
  summers in the last 20 against about 2 expected, and its three driest summers. Labelled as the nearest gauge, not
  the town's water supply.
- **Town Finder** *Rarely in severe drought*: fewer nearly-dry summers at the nearest gauge is better; weight 0.

## Acceptance criteria
- 81 gauges; the island chart runs 1913–2025; 2023 is the driest summer by island median (9th percentile, 24 of 45
  long-record gauges in their driest 10%), then 2015 (14th).
- Gold River Below Ucona River: 68 summers (1956–2024), usual low about 6.2 m³/s, lowest 2022.
- North Cowichan's row names Bings Creek Near The Mouth (3 km), nearly dry in about a third of 62 summers.
- Without `drought.json` the layer says to run `npm run data drought`.
- The stage rebuilds from an empty `.cache/drought/`.

## Limits
- BC's official Drought Levels (0–5 by basin, 2015 on) are published "Access Only" with no right to redistribute,
  so they are not shown; the ranks here are a gauge-by-gauge measure of the same thing, not BC's levels.
- Each gauge is compared only with itself, so ranks say how unusual a summer was for that river, not how much water
  there was. Many island rivers are regulated (dams, weirs, diversions, lake outlets), and a river whose management
  changed can rank differently before and after.
- Different gauges ran in different decades; early years rest on a handful of rivers. HYDAT is published once a
  year, so the record ends with its last year (fewer gauges in that year), and the current summer is not shown.
- "Nearly dry" (under 2% of mean annual flow) is a screening line chosen here, not an official threshold. The town's
  gauge is the nearest one, which may be a small creek or a different watershed (the Gulf Islands use a Vancouver
  Island gauge 6–28 km away).
- No watering-restriction stages: municipalities and regional districts publish them only as web pages.
- No Land Finder filter: one gauge per basin says little about a single parcel's well; the Water supply filters
  (intent 29) do that.

## Source
`scripts/drought.mjs` (`buildDrought`), `src/drought.ts` (`droughtLayer`, `townDrought`, `droughtTownRow`); data
`public/data/drought.json` and `drought-map.json` from the `drought` stage.
