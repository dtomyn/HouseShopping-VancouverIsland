# 15 — See the climate the next 25 years could bring

## Intent
As someone buying for the long term, I want to see what climate models project for each town by the 2030s and
2050s, with their uncertainty, so that I don't choose a place that will become uncomfortably hot or lose its winters.

## Where
Layer menu → *Hazard & climate outlook* → **Future climate**. A static layer, badged **Projection, not a record**.

## Inputs & controls
| Chip row | Options |
|---|---|
| Show | Hot days (over 30 °C), Mean temp, Frost days, Summer rain (June–August) |
| Scenario | Moderate (SSP2-4.5), High (SSP5-8.5); disabled for Today |
| Period | Today (1991–2020, modelled), 2030s (2021–2050), 2050s (2041–2070) |
| Map | Projected value, Change from today; disabled for Today |

## Behaviour (as implemented)
- **Map**: CanDCS-U6 projections (26 CMIP6 models downscaled to ~10 km, the data behind ClimateData.ca) as a hatched
  colour surface plus town values.
- Every number comes as a range: the median model and the spread from the 10th to the 90th percentile. "Today" is
  the same models' 1991–2020 run, so comparisons are like with like.
- **Panel**: headline numbers (island town median for the period, the 10th–90th range, today's value, the top town or
  biggest change); towns ranked with range bars; "Reading the scenarios".
- **Elsewhere**: Town Report's "By the 2050s" (hot days, temperature, frost, summer rain with ranges); the Town
  Finder's *Mild future summers* criterion uses 2041–2070 hot days, moderate scenario, median model.

## Limits
Projections are 30-year averages: they say nothing about any single summer (the 2021 heat dome is far above them).

## Source
`src/layers.ts` (`futureLayer`, `FUTURE_SCEN`, `FUTURE_PERIOD`), `public/data/future.json` from the `future` stage.
