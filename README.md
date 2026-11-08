# Island Atlas — Vancouver Island in data

An animated, WebGL-powered atlas of a century of Vancouver Island history, built to help answer one question: **where on the island should we live?**

**▶ Try it: <https://dtomyn.github.io/HouseShopping-VancouverIsland/>** (nothing to install)

Press play and watch 100+ years unfold: wildfires flare and leave burn scars, earthquakes ripple out from their true depth beneath the island, rivers surge in flood years, weather stations redden as the climate warms, and towns grow, age, get pricier and (sometimes) safer. Click any town for its report card, rank the towns by what matters to you, or search every large rural parcel on the island.

## Run it on your own machine

It's a static web app with all of its data committed to the repository, so it runs locally in a couple of minutes. There's no backend, database or API key.

**You need:** [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/) **22 or newer** (the version the published site is built with; check with `node -v`). It works on Windows, macOS and Linux.

```bash
git clone https://github.com/dtomyn/HouseShopping-VancouverIsland.git
cd HouseShopping-VancouverIsland
npm install
npm run dev
```

Then open **<http://localhost:5173>** in a current browser with WebGL (Chrome, Edge, Firefox or Safari). The page reloads as you edit the code.

- **An internet connection is still needed while you use it**, for the basemap, terrain, satellite imagery and waterfall photos. Those are streamed from public tile servers; the atlas's own data is local.
- **The production build** is what GitHub Pages serves. To try it locally, run `npm run build`, then `npm run preview`, and open <http://localhost:4173>.
- **If port 5173 is taken**, Vite picks the next free port and prints the address. An error mentioning `Node.js version` means Node is older than 22.

Optional extras, all covered below:
- **Refresh the data** from the original sources: `npm run data`. It needs `curl` on your PATH, which Windows 10+, macOS and Linux all include.
- **The dev container**, for a ready-made Linux environment in VS Code.
- **The explainer videos**, which are rendered from the app. This works on Windows only, and needs Microsoft Edge and Python.

## Features

- **Thirteen layers**, from open government data and OpenStreetMap:

  | Layer | What you see | Years |
  |---|---|---|
  | 🔥 Wildfires | Every mapped fire perimeter + every recorded ignition, flaring then cooling to burn scars | 1919 → today |
  | ◉ Earthquakes | M2.5+ quakes drawn at their real depth (×3), with surface shockwaves; tilt the map to look underground | 1900 → today |
  | ∿ Shaking hazard | NRCan 2020 building-code hazard model as a colour surface: peak shaking with a 2% chance in 50 years, % of gravity, contoured every 10%; town values while it's the picked layer | 2020 model (static) |
  | ≋ River floods | Annual peak flow at 64 river gauges vs. each river's normal peak | 1958 → today |
  | ☁ Wildfire smoke | Air monitors as columns: fire-season (May–Oct) days with 24-hour PM2.5 over BC's 25 µg/m³ objective; a brown haze over the map in the smokiest years | 1998 → 2025 |
  | 🌡 Climate | Homogenized temperature anomalies at 20 long-record stations + warming stripes | 1902 → 2020 |
  | ☀ Climate normals | 30-year averages per station, switchable: sunshine hours, rain days, frost days, snowfall | 1981–2010 average |
  | ⇡ Future climate | Downscaled CMIP6 projections as a hatched colour surface (marked “projection, not a record”): hot days over 30 °C, mean temperature, frost days or summer rain, for a moderate (SSP2-4.5) or high (SSP5-8.5) scenario, as a value or as change from the same models' 1991–2020; towns ranked with 10th–90th-percentile model range bars | 2021–2050 and 2041–2070 projections (static) |
  | ◍ Population & age | Municipal population with share aged 65+, including projections | 2001 → 2046 |
  | ⌂ Home prices | Monthly median sale value from BC Property Transfer Tax data | 2017 → today |
  | ◆ Crime severity | Statistics Canada Crime Severity Index by police service | 1998 → today |
  | ✚ Hospital access | Hospitals and ERs (24/7 highlighted); town columns = drive minutes to the nearest 24/7 ER; hover a town for its road routes | today (static) |
  | ⇣ Wells & groundwater | Every registered water well (about 35,000, from BC's GWELLS registry) drawn as a drill hole going down beneath the map to its real depth (×10, ×30 or ×100), coloured by the yield the driller measured, with low-yield wells as hollow rings and the standing water level marked; tilt the map to look at a forest of drill holes. The timeline drills them by construction year. Mapped aquifers lie flat underneath, coloured by productivity. The panel ranks every town and island by typical depth and yield, and shows how much drier the small islands are | 1900 → today |
  | ⛰ Trails & waterfalls | Every mapped footpath as a glowing web with hikers moving along it; named hiking routes coloured by effort; waterfalls as beams of falling water, as tall as their drop where it's known. Click a route or any footpath for its elevation profile and a **3D flight** along it over satellite imagery on real terrain; click a waterfall to **orbit it in 3D**; **Waterfall tour** flies to each photographed fall in turn; a **Satellite** switch lays imagery over the map | mapped today (static) |

- **The Layer menu**: the atlas starts on just the island. Each layer's switch puts it on the map or takes it off. Clicking a layer's name makes it the *picked* layer, whose story fills the side panel and whose years drive the timeline; the other layers stay on. Switching off the picked layer takes its timeline away too, and *Clear the map* at the top turns everything off. The `+N` on the Layer button counts the other layers on the map.
- **Static layers** (Shaking hazard, Climate normals, Future climate, Hospital access, Trails & waterfalls) don't change over time. While one is the picked layer the timeline dims, and any time-based layers that are on keep playing underneath.
- **The timeline** has play/pause, speeds, a sparkline of the picked layer, and markers for key moments: big fires, the 1946 Vancouver Island earthquake, the 1964 Port Alberni tsunami, the 2021 heat dome and more. As playback passes one, a line with **Details** appears above the timeline.
- **Click anything for details.** A timeline marker, an event's **Details**, a layer's **Key moments**, or anything you can point at on the map opens a panel on the right. Map features include an earthquake, a fire, a river gauge, a weather or air-quality station, a hospital, a well or aquifer, a footpath, or a spot on the hazard and future-climate maps. Each panel has:
  - its own numbers and, for gauges and stations, a chart of its record;
  - the layer year by year with that moment marked, and what else was happening on other layers at the time;
  - the closest towns, and the moments before and after;
  - sources, and a button that puts its layers on the map at that date.

  Towns open their report.
- **Town Report**: click any town for a report card. It covers:
  - prices, population, the 65+ share and crime;
  - nearby wildfire and quake history, the official earthquake shaking hazard, and smoke days;
  - local climate and warming trend, and the nearest river's flood record;
  - the drive to the nearest 24/7 emergency room;
  - projected hot days, temperature, frost and summer rain for the 2050s, with model ranges;
  - the trails and waterfalls nearby, each opening on the map;
  - the wells nearby (within 5 km, or the whole island for the small islands): median depth and yield, the share of low-yield wells, and every well drawn as a drill hole, shallowest to deepest.
- **Town Finder**: weight what matters to you and every municipality is ranked and raised as 3D columns on the map. The criteria are affordability, low crime, low wildfire exposure, lower shaking hazard, low quake activity, mild & warm, sunnier, little snow & frost, close to a hospital, not ferry-dependent, clean air, mild future summers, trails & waterfalls nearby, retiree community, and services & amenities. Presets set them all at once, and your weights are remembered in your browser.
- **Gulf and Discovery islands**: Salt Spring, Galiano, Thetis, Gabriola, Lasqueti, Denman and Quadra are included alongside the island's municipalities (list in `scripts/municipalities.mjs`). Every map layer is clipped to them too. They are unincorporated, so a few figures come from other sources and are labelled in their reports:
  - population and 65+ share from the 2021 Census (dissemination areas on each island)
  - crime from the island's rural RCMP detachment (Salt Spring, Gabriola, Quadra; Galiano shares the Outer Gulf Islands detachment)
  - sale prices are estimates: each island's 2021 Census average home value, scaled to match transfer-tax medians and moved since with its rural area's sales
  - ER access through the ferry route when there is no ER on the island; the Town Finder adds half the gap between sailings for the wait
  - ferry links (weekday sailings, last boat home, crossing time, car ferry or not) feed the *Not ferry-dependent* criterion. BC Ferries links are counted from the operator's GTFS timetable feed on a typical weekday in the next two weeks, so `npm run data ferries` picks up each new season; Lasqueti's passenger ferry has no feed and is typed into `scripts/municipalities.mjs`
- **Land Finder** (button top right, or `#land` in the URL): every private parcel of 5+ acres on Vancouver Island and the shortlisted islands (about 29,000, from ParcelMap BC), filtered live. Every criterion is a slider or switch, starting from our brief: 10+ acres, waterfront, within 45 minutes' drive of health care, groceries and gas, quiet, and safe:
  - **The land**: size, slope, Agricultural Land Reserve share, Vancouver Island or the small islands
  - **Waterfront**: ocean, lake or river frontage (boundary within 35 m of the Freshwater Atlas shoreline) and how much, or distance to water
  - **Within reach**: drive minutes to the nearest clinic or hospital (or 24/7 ER), grocery store and gas station (OSRM on OpenStreetMap roads)
  - **Quiet**: distance from the quietest spot on the land to a busy road, from airports and float bases, and from industry and quarries
  - **Safety**: BC Wildfire Service strategic threat rating on or within 500 m of the parcel, fire starts nearby since 1990, mapped floodplains, highest ground above sea level, earthquake shaking hazard
  - **Water supply**: median yield and depth of the registered wells within 1 km, the share of them that gave under 2 US gallons a minute, and whether the parcel sits over a mapped aquifer (all off by default; the per-parcel figures are in `public/data/land-wells.json`)
  - **Trails & waterfalls**: km of mapped footpath within 3 km, and distance to the nearest waterfall (both off by default)
  - **Budget**: BC publishes no per-parcel prices, so the budget checks the asking prices you add to shortlisted parcels; each parcel links to listings near it

  Behind every slider is a histogram of the parcels that value would let through given all the other filters, and a funnel along the bottom shows how each step narrows the island and which one cuts the most. Matches glow on the map and rank by a score. A parcel's report has a radar chart of its strengths, drive-time arcs to the places it relies on, satellite imagery, its water supply (the nearby wells drawn as drill holes, the aquifer under it, and any well registered on its PID), and a shortlist for your notes and asking price, kept in the browser.
- **Data & sources** (button top right, `S`, or `#sources` in the URL): every source drawn as a cedar round. Each wedge is a source, each ring a year from 1900 at the pith to today at the bark, lit by that source's own record for the year, with projections as a hatched halo out to 2070. Cards give each source's publisher, dataset, the endpoint read, record counts (counted from the loaded data), licence and refresh status, plus what the atlas works out itself.
- **Getting around**: drag to pan, scroll to zoom, right-drag (or Ctrl-drag) to tilt and turn the map.
  - **Keys:** `L` opens the Layer menu, `Space` plays and pauses, `←`/`→` step a year (or a month), `P` hides the side panel, `S` opens Data & sources, and `Esc` closes things.
  - **Links:** `#trails`, `#wells`, `#land` and `#sources` in the URL open straight to those views.

## Tech

- [MapLibre GL JS](https://maplibre.org/) basemap (CARTO Dark Matter) with shaded relief from open terrain tiles, and 3D terrain with Esri satellite imagery for the trail flights
- [deck.gl](https://deck.gl/) interleaved WebGL layers: GPU time filtering (`DataFilterExtension`), additive-blended glows, extruded columns and polygons
- [d3](https://d3js.org/) for the panel charts
- Vite + TypeScript, no backend: the site is fully static

| Command | What it does |
|---|---|
| `npm run dev` | Development server at <http://localhost:5173> |
| `npm run build` | Type-checks and builds the static site into `dist/` |
| `npm run preview` | Serves the built `dist/` at <http://localhost:4173> |
| `npm run data [stage…]` | Rebuilds `public/data/` from the original sources (see below) |

### Refreshing the data

The data in `public/data/` (about 10 MB) is committed, so this is only needed to pull in newer records:

```bash
npm run data              # every source
npm run data fires crime  # just some
npm run data trails       # trails, routes and waterfalls (about 7 minutes from an empty cache)
npm run data ferries      # ferry links from BC Ferries' timetable feed (re-run when the season changes)
```

The stages are `island`, `ferries`, `fires`, `quakes`, `rivers`, `climate`, `normals`, `population`, `housing`, `crime`, `hospitals`, `seismic`, `smoke`, `future`, `trails`, `land` and `wells` (which reads `land.json` and writes the parcels' well figures to their own `land-wells.json`). `scripts/fetch-data.mjs` downloads from the sources below, clips everything to the island, and writes compact JSON to `public/data/`.

- **Caching:** raw downloads are cached in `.cache/`, so re-runs are quick. Delete it to fetch everything fresh.
- **When a source is down:** that layer keeps its existing data, and **Data & sources** in the app shows its status.
- **First run:** a full run from an empty cache downloads several gigabytes and takes a while. The smoke stage alone streams about 100 MB a year from the province's FTP server through `curl`.

### Dev container (optional)

`.devcontainer/devcontainer.json` gives you a ready-made Linux environment with Node 22 and `curl` for the data pipeline. With Docker Desktop running, open the folder in VS Code and run **Dev Containers: Reopen in Container**.
- It installs dependencies with `npm ci` into its own `node_modules` volume, so your local copy is left alone.
- `npm run dev`, `npm run build` and `npm run data` all work inside it, and port 5173 is forwarded to your browser.
- The explainer videos can't be rendered in the container; they need Windows with Edge and a GPU.

### Deploying to GitHub Pages

A workflow is included at `.github/workflows/deploy.yml`. In your repository's **Settings → Pages**, set the source to **GitHub Actions**, then push to `main`. It builds with Node 22 and publishes `dist/`. The build is relative to its folder, so it works from any Pages sub-path.

## The explainer videos

Narrated how-to films are recorded from the real app by script, so they can be re-rendered after any change to the app or the data. `video/render.py` plays each film's scenes against the built app inside a framed "stage" (`video/stage/`), with a virtual clock stepped one frame at a time. It adds:
- a moving cursor with click sounds, Screen Studio–style zooms, titles, step tags and on-screen click hints;
- a synthesized music bed that ducks under the voice;
- narration read by [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) running locally.

The films:
- **How to use Island Atlas** (`video/storyboard.py`, the default): where to click. It covers the screen, moving the map, layers, the timeline and events, town reports, Town Finder, Land Finder, sources and shortcuts.
- **Trails & waterfalls** (`video/storyboard_trails.py`, `--film trails`): the trails layer in depth, from 3D flights to the waterfall tour.
- **A film for every layer** (`video/storyboard_layers.py`, `--film layer-<id>`): about a minute each, with a "wow" moment of its own. Examples are a century of fire sweeping the island, earthquakes hanging at their true depths, and the 2021 atmospheric river spiking the gauges.
- **The overview** (`--film overview`): every layer for a few seconds, each pointing to its own film.

The overview and `--film all` read the app's own layer list as they film. A layer added later gets a generic film built from its name, headline and numbers; add an entry to `SPECS` for a proper hook and wow scene. The narration's numbers are computed from the app's data by `video/layer_facts.js`.

**Setup (Windows, once).** You need [Microsoft Edge](https://www.microsoft.com/edge) (it renders the WebGL map on the GPU) and [uv](https://docs.astral.sh/uv/) for Python:

```bash
uv venv .venv --python 3.12
uv pip install --python .venv/Scripts/python.exe playwright imageio-ffmpeg kokoro-onnx soundfile numpy
```

Put `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the [kokoro-onnx releases](https://github.com/thewh1teagle/kokoro-onnx/releases) in `.venv/kokoro`. Then:

```bash
.venv/Scripts/python.exe video/render.py --check                    # fill in every narration line from the data, without filming (seconds)
.venv/Scripts/python.exe video/render.py --storyboard               # storyboard page with real frames, script, captions, YouTube text
.venv/Scripts/python.exe video/render.py --preview                  # quick 960×540 cut with sound
.venv/Scripts/python.exe video/render.py                            # 2560×1440 master + 1080p copy + all of the above
.venv/Scripts/python.exe video/render.py --film overview            # any film: main, trails, overview, layer-<id>, or all
.venv/Scripts/python.exe video/render.py --film layer-fires,layer-quakes --video-only   # several films, master only (still writes captions and script)
```

Rendering takes about 15–25 seconds of real time per second of film, so a one-minute layer film takes 20–30 minutes.

- **Output:** everything lands in `video/out/`. That's `island-atlas-explainer.mp4` (1440p) and its `-1080p.mp4` copy, plus `storyboard.html`, `script.md`, `.srt` captions and `youtube.txt`. The other films are named `island-atlas-<film>*`.
- **Other options:** `--only <scene>` renders one scene, `--stills 10,60` saves test frames, and `--url` puts the site's address on the end card.
- **Narration:** a line's voice is only regenerated when its text changes. Drop a real recording at `video/out/vo/recorded/<line-id>.wav`, and the picture retimes to fit it.
- **YouTube links:** put each published film's link in `video/films.json` (`{"island-atlas-fires": "https://…"}`), and the films' YouTube descriptions link to one another.
- **The `?film` handle:** the app exposes `window.atlas` for the renderer only when loaded with `?film`.

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
| Ferries | BC Ferries GTFS timetable feed, maintained by Trillium Solutions (`data.trilliumtransit.com/gtfs/bcferries-bc-ca/bcferries-bc-ca.zip`, re-fetched each month); Lasqueti from Western Pacific Marine's timetable, typed by hand | Public feed, no licence stated |
| Land Finder parcels | ParcelMap BC parcel fabric (private parcels of 5+ acres) | OGL – British Columbia |
| Land Finder water, hazards and rules | Freshwater Atlas coastline, lakes and rivers; BC Wildfire Service Provincial Strategic Threat Analysis; BC floodplain maps; Agricultural Land Reserve; BC airports | OGL – British Columbia |
| Trails & waterfalls | OpenStreetMap via Overpass: `route=hiking`/`foot` relations, footpaths (`highway=path`, `bridleway` and unpaved `footway`), `waterway=waterfall`; photos and heights from Wikidata (P18, P2048) and photos geotagged on Wikimedia Commons whose file name matches the fall; elevations from Mapzen / AWS terrain tiles; satellite imagery from Esri World Imagery | ODbL; Wikidata CC0; photos under their own Commons licences; imagery © Esri, Maxar, Earthstar Geographics |
| Wells & groundwater | BC Ministry of Water, Land and Resource Stewardship: GWELLS groundwater wells (`WHSE_WATER_MANAGEMENT.GW_WATER_WELLS_WRBC_SVW`) and the aquifer classification (`GW_AQUIFERS_CLASSIFICATION_SVW`), BC Data Catalogue WFS; depths converted from feet, yields kept in US gallons a minute | OGL – British Columbia |
| Land Finder services and roads | OpenStreetMap via Overpass (grocery stores, gas, clinics, busy roads, industry); drive times from the OSRM demo router; terrain from Mapzen / AWS terrain tiles | ODbL; public terrain tiles |

Basemap © OpenStreetMap contributors © CARTO. Terrain tiles: Mapzen / AWS Open Data.

## Roadmap

Built so far from the original plan: climate normals, hospital access, wildfire smoke, future climate and earthquake shaking hazard. Still open: a century of logging, a guided story mode, sea level, tsunami zones and a Cascadia scenario, ongoing costs (property tax and rent), and Indigenous territories and place names. The details and a suggested build order are in [ROADMAP.md](ROADMAP.md). [MAP-ATLAS-BLUEPRINT.md](MAP-ATLAS-BLUEPRINT.md) describes how to build a new atlas in the same style for another region.

## Caveats

This is an exploration tool, not professional advice:
- Property-transfer medians include all property types, so they run below single-family listing prices.
- River-gauge ratios describe high water, not flooded area.
- Hazard counts describe history, not risk forecasts.
- Trails can be closed, overgrown, on private land or seasonal.
- Well yields are the driller's short test when each well was finished, not a long-term supply, and nearby wells are a guide, not a promise for a new well. Older wells are under-counted, and the registry's 0 yields are treated as not recorded.

For a specific property, check the official floodplain, tsunami and wildfire-interface maps.
