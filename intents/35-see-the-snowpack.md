# 35 — See the snowpack

## Intent
As someone choosing a town whose skiing, summer rivers or water supply depend on the mountains, I want to see how
much snow the island's high country holds each spring, year by year, so that I know how variable it is, whether it
is thinning, and what a bad year like 2015 looked like.

## Where
Layer menu → *Outdoors* → **Snowpack**. A time-based layer (1955 → today).

## Inputs & controls
| Control | Effect |
|---|---|
| Timeline | Each station's column shows that year's 1 April reading (held for the year, no blending between years). |
| Hover a column or station dot | Tooltip: name, snow course or pillow, station id and elevation, that year's 1 April water and % of the station's normal, its normal and period, years of record. |
| Click a column or dot | Details panel: what kind of station it is (operator for pillows), still measured or retired, normal, latest, deepest and thinnest years, latest snow depth, a bar chart of every year's 1 April water coloured by % of normal (tooltip adds depth and the survey date when it wasn't 1 April), and any survey codes. |

## Behaviour (as implemented)
- The `snow` stage (`scripts/snow.mjs`) reads the BC River Forecast Centre's manual snow survey archive and current
  season (`allmss_archive.csv`, `allmss_current.csv`; the "01-Apr" survey of each year, depth and water equivalent),
  the automated stations' daily snow water equivalent (`SW_DailyArchive.csv`) and hourly snow depth
  (`SD_Archive.csv`) at the reading closest to 1 April 08:00 PST (within 2 days for water, 1 for depth), and the
  station locations from the BC Data Catalogue WFS (`SSL_SNOW_MSS_LOCS_SP`, `SSL_SNOW_ASWS_STNS_SP`). Stations
  inside the island outline with 5+ years of 1 April water are kept: 22 snow courses (1954–2026) and 5 pillows
  (Wolf River Upper since 1988, Jump Creek, Heather Mountain Upper, Mount Arrowsmith, Survey Mountain).
- Each station's **normal** is its median 1 April water over 1991–2020 when it has 15+ of those years, otherwise
  over its whole record (10+ years); shorter records have none.
- The **island figure** for a year is the median, across stations with a normal of 100 mm or more, of that year's
  reading ÷ the station's normal, when 2+ stations report. It is the sparkline and the panel's bar chart.
- **Map**: a column per station as tall as its 1 April water (7 m per mm), coloured from amber (bare) through white
  (normal) to blue (2.5×); grey for stations without a usable normal. While it is the picked layer each column is
  labelled with its % of normal (or mm). A pillow on the same spot as a snow course is drawn just east of it.
- **Panel**: this year's island % of normal, stations measured that year, the thinnest and deepest years; the
  island chart; the colour scale; the long-record stations' median 1 April water in the first 30 years of the record
  against the last 30; what the snowpack means here (ski season, summer river flows, town water supplies that start
  in snow country, wells recharged by rain); the station list; coverage notes.
- **Events**: the three thinnest and two deepest years among those with 5+ stations reporting (2015 "snow drought",
  2005, 1981; 1999, 1974), each naming the long-record stations' readings.

## Acceptance criteria
- 27 stations; the island figure runs 1955–2026; 2015 is the thinnest year (median 0% of normal, 8 stations) and
  1999 the deepest (about 257%).
- Forbidden Plateau shows 71 years (1955–2026) with a normal of about 1,458 mm and 30 mm in 2015.
- Without `snow.json` the layer says to run `npm run data snow`.
- The stage rebuilds from an empty `.cache/snow/`.

## Limits
- Few stations, most retired, and different ones in different decades: the island figure is a median of shares of
  each station's own normal, not an average depth, and its early years rest on 2–4 stations.
- Snow courses are measured by hand within a few days of 1 April; pillows weigh the snow automatically. Survey codes
  ("problem", "early/late", "trace") are shown, not interpreted.
- Low stations (Elk River at 270 m, Survey Mountain) are usually bare and stay out of the island figure.
- No Town Report row, Town Finder criterion or Land Finder filter: no town's home buying depends on a station in a
  way the data can show honestly.

## Source
`scripts/snow.mjs` (`buildSnow`), `src/snow.ts` (`snowLayer`); data `public/data/snow.json` from the `snow` stage.
