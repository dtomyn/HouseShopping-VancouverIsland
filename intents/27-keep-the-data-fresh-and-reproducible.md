# 27 — Keep the data fresh and reproducible

## Intent
As the maintainer, I want to rebuild every dataset from its original public source with one command, so that the
atlas can be refreshed any time and anyone can check how each number was made.

## Where
`npm run data [stage…]` (the `scripts/` folder).

## Inputs & controls
| Command | Effect |
|---|---|
| `npm run data` | Every stage, in order: `island ferries fires quakes rivers climate normals population housing crime hospitals seismic smoke future trails internet land wells tsunami flood firehalls sun logging neighbours water camping snow radon drought wind`. |
| `npm run data fires crime` | Just those stages. |
| Delete `.cache/` | Forces every download to be fetched again. |

## Behaviour (as implemented)
- Each stage downloads from its public source (BC Data Catalogue WFS, `api.weather.gc.ca`, USGS, Statistics Canada,
  NRCan, PAVICS THREDDS, BC's FTP server, OpenStreetMap Overpass, BC Ferries GTFS, OSRM), clips to the island's
  bounding box, and writes compact JSON to `public/data/`.
- Raw downloads are cached in `.cache/`, so re-runs are quick.
- **A failing source doesn't break the rest**: its JSON is left as it was, and `manifest.json` records the error and
  the attempt time, which Data & sources then shows ([24](24-see-where-the-numbers-come-from.md)).
- **No manual steps**: every dataset comes from a stage; the only hand-typed data is the list of places and
  Lasqueti's ferry in `scripts/municipalities.mjs`. A full run must work from an empty `.cache/`.
- Ferry links are re-counted from the timetable feed on a typical weekday in the next two weeks, so re-running
  `ferries` picks up each new season.

## Acceptance criteria
- `rm -rf .cache && npm run data` completes with no manual steps, and `npm run build` passes on the result.
- A stage that throws leaves its previous JSON untouched and marks `ok: false` with `lastError`.

## Limits
A full first run downloads several gigabytes (the smoke stage alone streams ~100 MB a year through `curl`), and the
trails stage takes about 7 minutes.

## Source
`scripts/fetch-data.mjs` (`SOURCES`, `order`, manifest), `scripts/trails.mjs`, `scripts/land.mjs`, `scripts/wells.mjs`,
`scripts/ferries.mjs`, `scripts/municipalities.mjs`.
