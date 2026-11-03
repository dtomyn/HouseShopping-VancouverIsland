# Island Atlas — Vancouver Island in data

An animated, WebGL-powered atlas of a century of Vancouver Island history, built to help answer one question: **where on the island should we retire?**

Press play and watch 100+ years unfold: wildfires flare and leave burn scars, earthquakes ripple out from their true depth beneath the island, rivers surge in flood years, weather stations redden as the climate warms, and towns grow, age, get pricier and (sometimes) safer.

## Features

- **Seven historical layers**, all from open government data:
  | Layer | What you see | Years |
  |---|---|---|
  | 🔥 Wildfires | Every mapped fire perimeter + every recorded ignition, flaring then cooling to burn scars | 1919 → today |
  | ◉ Earthquakes | M2.5+ quakes drawn at their real depth (×3), with surface shockwaves | 1900 → today |
  | ≋ River floods | Annual peak flow at ~60 river gauges vs. each river's normal peak | 1950s → today |
  | 🌡 Climate | Homogenized temperature anomalies at 20 long-record stations + warming stripes | 1900 → 2020 |
  | ◍ Population & age | Municipal population with share aged 65+, including projections | 2001 → 2046 |
  | ⌂ Home prices | Monthly median sale value from BC Property Transfer Tax data | 2017 → today |
  | ◆ Crime severity | Statistics Canada Crime Severity Index by police service | 1998 → today |
- **Timeline** with play/pause, speeds, a sparkline of the focused layer, and clickable historic events (the 1946 M7.3 quake, the 1964 Port Alberni tsunami, the 2021 heat dome…). Events pop up as toasts and send a shockwave across the map as playback passes them.
- **Town Report** — click any town for a report card: prices, population, 65+ share, crime, nearby wildfire and quake history, local climate and warming trend, and nearest river's flood record.
- **Town Finder** — weight what matters to you (affordability, safety, wildfire exposure, quakes, warmth, dryness, retiree community, services) and every municipality is ranked and raised as 3D columns on the map. Weights persist in your browser.
- Overlay multiple layers, hover anything for details, tilt/rotate the 3D map (right-drag or Ctrl-drag), keyboard: `Space` play/pause, `←`/`→` step.

## Tech

- [MapLibre GL JS](https://maplibre.org/) basemap (CARTO Dark Matter) with shaded relief from open terrain tiles
- [deck.gl](https://deck.gl/) interleaved WebGL layers — GPU time filtering (`DataFilterExtension`), additive-blended glows, extruded columns and polygons
- [d3](https://d3js.org/) for the panel charts
- Vite + TypeScript, no backend — the site is fully static

## Getting started

```bash
npm install
npm run dev
```

The pre-built data in `public/data/` is committed, so the app runs immediately.

### Refreshing the data

```bash
npm run data              # all sources
npm run data fires crime  # just some
```

`scripts/fetch-data.mjs` downloads from the sources below, clips everything to Vancouver Island, and writes compact JSON to `public/data/`. Raw downloads are cached in `.cache/` (delete it to force a refresh). If a source is down, that layer is left as it was and the app shows its status in **Data & sources**.

### Deploying to GitHub Pages

A workflow is included at `.github/workflows/deploy.yml`. In your repo's **Settings → Pages**, set the source to **GitHub Actions**, then push to `main`.

## Data sources

| Layer | Source | Licence |
|---|---|---|
| Wildfires | BC Wildfire Service — historical & current fire perimeters and incident points (BC Data Catalogue WFS) | OGL – British Columbia |
| Earthquakes | USGS ComCat FDSN event service | Public domain |
| River floods | ECCC HYDAT annual peaks via `api.weather.gc.ca` | OGL – Canada |
| Climate | ECCC Adjusted & Homogenized Canadian Climate Data (AHCCD) via `api.weather.gc.ca` | OGL – Canada |
| Population | BC Stats sub-provincial population estimates & projections | OGL – British Columbia |
| Home prices | BC Ministry of Finance, Property Transfer Tax data | OGL – British Columbia |
| Crime | Statistics Canada Table 35-10-0063-01 | Statistics Canada Open Licence |
| Coastline | BC Freshwater Atlas islands | OGL – British Columbia |

Basemap © OpenStreetMap contributors © CARTO. Terrain tiles: Mapzen / AWS Open Data.

## Roadmap

Planned additions (hospital access, future climate, logging history, sea level, story mode and more) and a suggested build order are in [ROADMAP.md](ROADMAP.md).

## Caveats

This is an exploration tool, not professional advice. Property-transfer medians include all property types (so they run below single-family listing prices); river-gauge ratios describe high water, not flooded area; hazard counts describe history, not risk forecasts. For a specific property, check official floodplain, tsunami and wildfire-interface maps.
