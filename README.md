# Island Atlas — Vancouver Island in data

An animated, WebGL-powered atlas of a century of Vancouver Island history, built to help answer one question: **where on the island should we retire?**

Press play and watch 100+ years unfold: wildfires flare and leave burn scars, earthquakes ripple out from their true depth beneath the island, rivers surge in flood years, weather stations redden as the climate warms, and towns grow, age, get pricier and (sometimes) safer.

## Features

- **Seven historical layers**, all from open government data:
  | Layer | What you see | Years |
  |---|---|---|
  | 🔥 Wildfires | Every mapped fire perimeter + every recorded ignition, flaring then cooling to burn scars | 1919 → today |
  | ◉ Earthquakes | M2.5+ quakes drawn at their real depth (×3), with surface shockwaves | 1900 → today |
  | ∿ Shaking hazard | NRCan 2020 building-code hazard model as a colour surface: peak shaking with a 2% chance in 50 years, % of gravity, contoured every 10%; town values when focused | 2020 model (static) |
  | ≋ River floods | Annual peak flow at ~60 river gauges vs. each river's normal peak | 1950s → today |
  | ☁ Wildfire smoke | Air monitors as columns: fire-season (May–Oct) days with 24-hour PM2.5 over BC's 25 µg/m³ objective; a brown haze over the map in the smokiest years | 1998 → 2025 |
  | 🌡 Climate | Homogenized temperature anomalies at 20 long-record stations + warming stripes | 1900 → 2020 |
  | ☀ Climate normals | 30-year averages per station, switchable: sunshine hours, rain days, frost days, snowfall | 1981–2010 average |
  | ⇡ Future climate | Downscaled CMIP6 projections as a hatched colour surface (marked “projection, not a record”): hot days over 30 °C, mean temperature, frost days or summer rain, for a moderate (SSP2-4.5) or high (SSP5-8.5) scenario, as a value or as change from the same models' 1991–2020; towns ranked with 10th–90th-percentile model range bars | 2021–2050 and 2041–2070 projections (static) |
  | ◍ Population & age | Municipal population with share aged 65+, including projections | 2001 → 2046 |
  | ⌂ Home prices | Monthly median sale value from BC Property Transfer Tax data | 2017 → today |
  | ◆ Crime severity | Statistics Canada Crime Severity Index by police service | 1998 → today |
  | ✚ Hospital access | Hospitals and ERs (24/7 highlighted); town columns = drive minutes to the nearest 24/7 ER; hover/click a town for its road routes | today (static) |
  | ⛰ Trails & waterfalls | Every mapped footpath as a glowing web with hikers moving along it; named hiking routes coloured by effort; waterfalls as beams of falling water, as tall as their drop where it's known. Click a route for its elevation profile and a **3D flight** along it over satellite imagery on real terrain; click a waterfall to **orbit it in 3D**; **Waterfall tour** flies to each photographed fall in turn | mapped today (static) |
- **Starts on just the island** — nothing is overlaid until you pick a layer. Picking a layer replaces the one on the map; flip a layer's switch in the menu to keep it on while you pick others, and pick *Just the island* to clear everything.
- **Static layers** (Hospital access, Climate normals, Shaking hazard, Future climate, Trails & waterfalls) don't change over time: focusing one dims the timeline, and any other visible layers keep playing underneath.
- **Timeline** with play/pause, speeds, a sparkline of the focused layer, and clickable historic events (the 1946 M7.3 quake, the 1964 Port Alberni tsunami, the 2021 heat dome…). Events pop up as toasts and send a shockwave across the map as playback passes them.
- **Town Report** — click any town for a report card: prices, population, 65+ share, crime, nearby wildfire and quake history, official earthquake shaking hazard, local climate and warming trend, nearest river's flood record, drive time to the nearest 24/7 emergency room, projected hot days, temperature, frost and summer rain for the 2050s (with model ranges), and the trails and waterfalls nearby (each opens on the map).
- **Town Finder** — weight what matters to you (affordability, safety, wildfire exposure, shaking hazard, past quakes, warmth, sunshine, snow & frost, hospital access, mild future summers, trails & waterfalls nearby, retiree community, services) and every municipality is ranked and raised as 3D columns on the map. Weights persist in your browser.
- **Gulf and Discovery islands** — Salt Spring, Galiano, Thetis, Penelakut (Kuper), Gabriola, Lasqueti, Denman and Quadra are included alongside the island's municipalities (list in `scripts/municipalities.mjs`). Every map layer is clipped to them too. They are unincorporated, so a few figures come from other sources and are labelled in their reports:
  - population and 65+ share from the 2021 Census (dissemination areas on each island)
  - crime from the island's rural RCMP detachment (Salt Spring, Gabriola, Quadra; Galiano shares the Outer Gulf Islands detachment)
  - sale prices are estimates: each island's 2021 Census average home value, scaled to match transfer-tax medians and moved since with its rural area's sales
  - ER access through the ferry route when there is no ER on the island; the Town Finder adds half the gap between sailings for the wait
  - ferry links (weekday sailings, last boat home, crossing time, car ferry or not) feed a *Not ferry-dependent* factor in the Town Finder
- **Land Finder** (button top right, or `#land` in the URL) — every private parcel of 5+ acres on Vancouver Island and the shortlisted islands (about 29,000, from ParcelMap BC), filtered live. Every criterion is a slider or switch, starting from our brief: 10+ acres, waterfront, within 45 minutes' drive of health care, groceries and gas, quiet, and safe:
  - **The land**: size, slope, Agricultural Land Reserve share, Vancouver Island or the small islands
  - **Waterfront**: ocean, lake or river frontage (boundary within 35 m of the Freshwater Atlas shoreline) and how much, or distance to water
  - **Within reach**: drive minutes to the nearest clinic or hospital (or 24/7 ER), grocery store and gas station (OSRM on OpenStreetMap roads)
  - **Quiet**: distance from the quietest spot on the land to a busy road, from airports and float bases, and from industry and quarries
  - **Safety**: BC Wildfire Service strategic threat rating on or within 500 m of the parcel, fire starts nearby since 1990, mapped floodplains, highest ground above sea level, earthquake shaking hazard
  - **Trails & waterfalls**: km of mapped footpath within 3 km, and distance to the nearest waterfall (both off by default)
  - **Budget**: BC publishes no per-parcel prices, so the budget checks the asking prices you add to shortlisted parcels; each parcel links to listings near it

  Behind every slider is a histogram of the parcels that value would let through given all the other filters, and a funnel along the bottom shows how each step narrows the island and which one cuts the most. Matches glow on the map and rank by a score; a parcel's report has a radar of its strengths, drive-time arcs to the places it relies on, satellite imagery, and a shortlist with your notes and asking price (kept in the browser).
- **Data & sources** (button top right, `S`, or `#sources` in the URL): every source drawn as a cedar round. Each wedge is a source, each ring a year from 1900 at the pith to today at the bark, lit by that source's own record for the year, with projections as a hatched halo out to 2070. Cards give each source's publisher, dataset, the endpoint read, record counts (counted from the loaded data), licence and refresh status, plus what the atlas works out itself.
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

### Dev container (optional)

`.devcontainer/devcontainer.json` gives you a ready-made Linux environment with Node 22 (the version the GitHub Pages build uses) and `curl` for the data pipeline. With Docker Desktop running, open the folder in VS Code and run **Dev Containers: Reopen in Container**. It installs dependencies with `npm ci` into its own `node_modules` volume, so the Windows copy is left alone. `npm run dev`, `npm run build` and `npm run data` all work inside it, and port 5173 is forwarded to your browser. The explainer video isn't set up in the container because it needs Microsoft Edge with a real GPU, so render it on Windows as described below.

### Refreshing the data

```bash
npm run data              # all sources
npm run data fires crime  # just some
npm run data trails       # trails, routes and waterfalls (about 7 minutes from an empty cache)
```

`scripts/fetch-data.mjs` downloads from the sources below, clips everything to Vancouver Island, and writes compact JSON to `public/data/`. Raw downloads are cached in `.cache/` (delete it to force a refresh). If a source is down, that layer is left as it was and the app shows its status in **Data & sources**.

### Deploying to GitHub Pages

A workflow is included at `.github/workflows/deploy.yml`. In your repo's **Settings → Pages**, set the source to **GitHub Actions**, then push to `main`.

### The explainer video

A narrated, step-by-step how-to video is filmed from the real app by script, so it can be re-rendered after any change to the app or the data. It walks through where to click (the screen, moving the map, layers, the timeline, town reports, Town Finder, Land Finder, sources and shortcuts) without commenting on the data. The scenes, narration, camera moves and sounds are in `video/storyboard.py`; `video/render.py` plays them against the built app inside a framed "stage" (`video/stage/`) with a virtual clock stepped one frame at a time. It adds a moving cursor with click sounds, Screen Studio–style zooms, titles, step tags and on-screen click hints, and a synthesized music bed that ducks under the voice. The narration is read by [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) running locally.

One-time setup (needs Microsoft Edge for GPU rendering):

```bash
uv venv .venv --python 3.12
uv pip install --python .venv/Scripts/python.exe playwright imageio-ffmpeg kokoro-onnx soundfile numpy
```

Put `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the kokoro-onnx releases in `.venv/kokoro`. Then:

```bash
.venv/Scripts/python.exe video/render.py --storyboard   # storyboard page with real frames, script, captions, YouTube text
.venv/Scripts/python.exe video/render.py --preview      # quick 960×540 cut with sound
.venv/Scripts/python.exe video/render.py                # 2560×1440 master + 1080p copy
```

Everything lands in `video/out/`: `island-atlas-explainer.mp4` (1440p), `-1080p.mp4`, `storyboard.html`, `script.md`, `.srt` captions and `youtube.txt`. `--only finder` renders one scene, `--stills 10,60` saves test frames, `--url` puts the site's address on the end card. A line's voice is only regenerated when its text changes; drop a real recording at `video/out/vo/recorded/<line-id>.wav` and the picture retimes to fit it. The app exposes `window.atlas` for the renderer only when loaded with `?film`.

A supplemental film covers just the Trails & waterfalls layer (turning it on, reading the map, opening and orbiting a waterfall, a route's elevation profile, the 3D trail flight, the waterfall tour, and trails in town reports and both finders), in the same voice and style. Its scenes are in `video/storyboard_trails.py`; every option above works with `--film trails`, and its files are named `island-atlas-trails*`:

```bash
.venv/Scripts/python.exe video/render.py --film trails            # 1440p master, 1080p copy, storyboard, script, captions
.venv/Scripts/python.exe video/render.py --film trails --preview  # quick 960×540 cut with sound
```

## Data sources

| Layer | Source | Licence |
|---|---|---|
| Wildfires | BC Wildfire Service — historical & current fire perimeters and incident points (BC Data Catalogue WFS) | OGL – British Columbia |
| Earthquakes | USGS ComCat FDSN event service | Public domain |
| Shaking hazard | Natural Resources Canada 2020 National Seismic Hazard Model (NBC 2020; PGA, site class C, 2% and 10% in 50 years), sampled on a ~7 km grid via the Earthquakes Canada hazard web service (`earthquakescanada.nrcan.gc.ca/api/canshm/graphql`) | OGL – Canada |
| River floods | ECCC HYDAT annual peaks via `api.weather.gc.ca` | OGL – Canada |
| Wildfire smoke | BC Ministry of Environment, *Air Quality and Climate Monitoring: Verified Hourly Data* — yearly PM2.5 CSVs on `ftp.env.gov.bc.ca/pub/outgoing/AIR/AnnualSummary` (streamed through `curl`, island rows only; ~100 MB per year on first run) | OGL – British Columbia |
| Climate | ECCC Adjusted & Homogenized Canadian Climate Data (AHCCD) via `api.weather.gc.ca` | OGL – Canada |
| Climate normals | ECCC Canadian Climate Normals 1981–2010 (`climate-normals` collection) via `api.weather.gc.ca` | OGL – Canada |
| Future climate | CanDCS-U6: CMIP6 projections statistically downscaled by PCIC (BCCAQv2, 26 models, ~10 km), as 30-year index averages with 10th/50th/90th model percentiles published for ClimateData.ca — read over OPeNDAP from the PAVICS THREDDS server (`pavics.ouranos.ca`, `…/cmip6/climatedata_ca/CanDCS-U6/ensemble_statistics/30yAvg`) | OGL – Canada |
| Population | BC Stats sub-provincial population estimates & projections | OGL – British Columbia |
| Home prices | BC Ministry of Finance, Property Transfer Tax data | OGL – British Columbia |
| Crime | Statistics Canada Table 35-10-0063-01 | Statistics Canada Open Licence |
| Hospital access | BC Ministry of Health / HealthLinkBC “Hospitals in BC” + “Emergency Rooms in BC” (BC Data Catalogue); drive times from the public OSRM demo router on OpenStreetMap roads | OGL – British Columbia; routes © OpenStreetMap contributors (ODbL) |
| Coastline | BC Freshwater Atlas islands | OGL – British Columbia |
| Land Finder parcels | ParcelMap BC parcel fabric (private parcels of 5+ acres) | OGL – British Columbia |
| Land Finder water, hazards and rules | Freshwater Atlas coastline, lakes and rivers; BC Wildfire Service Provincial Strategic Threat Analysis; BC floodplain maps; Agricultural Land Reserve; BC airports | OGL – British Columbia |
| Trails & waterfalls | OpenStreetMap via Overpass: `route=hiking`/`foot` relations, footpaths (`highway=path`, `bridleway` and unpaved `footway`), `waterway=waterfall`; photos and heights from Wikidata (P18, P2048) and photos geotagged on Wikimedia Commons whose file name matches the fall; elevations from Mapzen / AWS terrain tiles; 3D-view imagery from Esri World Imagery | ODbL; Wikidata CC0; photos under their own Commons licences; imagery © Esri, Maxar, Earthstar Geographics |
| Land Finder services and roads | OpenStreetMap via Overpass (grocery stores, gas, clinics, busy roads, industry); drive times from the OSRM demo router; terrain from Mapzen / AWS terrain tiles | ODbL; public terrain tiles |

Basemap © OpenStreetMap contributors © CARTO. Terrain tiles: Mapzen / AWS Open Data.

## Roadmap

Planned additions (hospital access, future climate, logging history, sea level, story mode and more) and a suggested build order are in [ROADMAP.md](ROADMAP.md).

## Caveats

This is an exploration tool, not professional advice. Property-transfer medians include all property types (so they run below single-family listing prices); river-gauge ratios describe high water, not flooded area; hazard counts describe history, not risk forecasts. For a specific property, check official floodplain, tsunami and wildfire-interface maps.
