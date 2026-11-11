# Island Atlas — Vancouver Island in data

An animated, WebGL-powered atlas of a century of Vancouver Island history, built to help answer one question: **where on the island should we live?**

**▶ Try it: <https://dtomyn.github.io/vancouver-island-atlas/>** (nothing to install)

Press play and watch 100+ years unfold: wildfires flare and leave burn scars, earthquakes ripple out from their true depth beneath the island, rivers surge in flood years, weather stations redden as the climate warms, and towns grow, age, get pricier and (sometimes) safer. Click any town for its report card, rank the towns by what matters to you, or search every large rural parcel on the island.

## Run it on your own machine

It's a static web app with all of its data committed to the repository, so it runs locally in a couple of minutes. There's no backend, database or API key.

**You need:** [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/) **22 or newer** (the version the published site is built with; check with `node -v`). It works on Windows, macOS and Linux.

```bash
git clone https://github.com/dtomyn/vancouver-island-atlas.git
cd vancouver-island-atlas
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

- **Fourteen layers**, from open government data and OpenStreetMap:

  | Layer | What you see | Years |
  |---|---|---|
  | 🔥 Wildfires | Every mapped fire perimeter + every recorded ignition, flaring then cooling to burn scars | 1919 → today |
  | 🪓 Logging | Every mapped cutblock flashes in the year it was cut, lies as bare ground, then greens over as the forest regrows; blocks approved or being logged now pulse pink at today; parks and protected areas in teal. Panel: hectares per year and per decade, and the share of the islands logged at least once (about 18% in the record) | 1900 → today |
  | ◉ Earthquakes | M2.5+ quakes drawn at their real depth (×3), with surface shockwaves; tilt the map to look underground | 1900 → today |
  | ∿ Shaking hazard | NRCan 2020 building-code hazard model as a colour surface: peak shaking with a 2% chance in 50 years, % of gravity, contoured every 10%; town values while it's the picked layer | 2020 model (static) |
  | ≋ Tsunami zones | BC's tsunami notification zones as tinted bands over the sea; openly published hazard maps (Strathcona RD's Cascadia scenario from Nootka to Quatsino Sound, the City of Victoria's 2021 zone); low coastal ground everywhere else (under 20 m, within 1 km of the sea) as glowing water that fills as a wave sweeps in from the open Pacific; towns labelled with zone and low-ground share. No invented arrival times: only Ocean Networks Canada's ~20 minutes to the outer north-west coast is quoted | today (static) |
  | ≈ Floodplains | BC's designated 200-year floodplains on the 17 island rivers and lakes the province mapped (1978–1997), with the Oyster River's alluvial fan and dashed lines where each study stopped; click one for its year, age, report and the river gauges' flood record (linked to River floods). The panel says plainly that unmapped is not safe and the maps are old, and ranks towns by the share of ground within 2 km inside a floodplain | designated 1978–1997 (static) |
  | ☢ Radon | Health Canada's home radon survey (2009–2011) for the island's three health areas, shaded by the share of tested homes over Canada's 200 Bq/m³ guideline (3 of 270 island homes, against 8% across BC); every home's result as a dot strip, BC's health areas compared, tests by postal area. The panel's point: low here, but test any house you buy (~$30–60 kit) | tested 2009–2011 (static) |
  | ≋ River floods | Annual peak flow at 64 river gauges vs. each river's normal peak | 1958 → today |
  | 🌀 Windstorms | Every station that measures gusts as a column rising with that year's storm days (gusts of 90 km/h or more, the coast's wind-warning line), coloured by the year's top gust; a ring flares on each storm day as it plays. Lighthouses and exposed points are drawn hollow. The sparkline is storm days per sheltered station; events mark the days the most stations hit storm force (and the Columbus Day and December 2018 storms). Panel: what wind means for power, trees and exposure, every station's record, and why the airports' falling counts are not a trend (new instruments and automated reporting) | 1957 → 2025 |
  | ☁ Wildfire smoke | Air monitors as columns: fire-season (May–Oct) days with 24-hour PM2.5 over BC's 25 µg/m³ objective; a brown haze over the map in the smokiest years | 1998 → 2025 |
  | 🌡 Climate | Homogenized temperature anomalies at 20 long-record stations + warming stripes | 1902 → 2020 |
  | ☀ Climate normals | 30-year averages per station, switchable: sunshine hours, rain days, frost days, snowfall | 1981–2010 average |
  | ⇡ Future climate | Downscaled CMIP6 projections as a hatched colour surface (marked “projection, not a record”): hot days over 30 °C, mean temperature, frost days or summer rain, for a moderate (SSP2-4.5) or high (SSP5-8.5) scenario, as a value or as change from the same models' 1991–2020; towns ranked with 10th–90th-percentile model range bars | 2021–2050 and 2041–2070 projections (static) |
  | ◍ Population & age | Municipal population with share aged 65+, including projections | 2001 → 2046 |
  | ⌂ Home prices | Monthly median sale value from BC Property Transfer Tax data | 2017 → today |
  | ◆ Crime severity | Statistics Canada Crime Severity Index by police service | 1998 → today |
  | ✚ Hospital access | Hospitals and ERs (24/7 highlighted); town columns = drive minutes to the nearest 24/7 ER; hover a town for its road routes | today (static) |
  | ⇣ Wells & groundwater | Every registered water well (about 35,000, from BC's GWELLS registry) drawn as a drill hole going down beneath the map to its real depth (×10, ×30 or ×100), coloured by the yield the driller measured, with low-yield wells as hollow rings and the standing water level marked; tilt the map to look at a forest of drill holes. The timeline drills them by construction year. Mapped aquifers lie flat underneath, coloured by productivity. The panel ranks every town and island by typical depth and yield, and shows how much drier the small islands are | 1900 → today |
  | ☀ Drought & low rivers | Every river gauge's basin shaded by how low the river ran against its own record: dark red its lowest summer ever, amber its driest 10%, pale normal, blue wet; month by month from June to October, the summer's lowest week the rest of the year. The sparkline is the island median; events mark the driest summers (2023, 2015, 2014, 1992, 1985). Click a gauge for its summer lows year by year. Panel: what BC's drought levels are (not open data, so this is built from the gauges), why low rivers matter for a parcel on a well or a town on a small reservoir (linked to Wells and Snowpack), and the gauges with the most driest-10% summers in the last 20 | 1913 → 2025 |
  | ⌁ Internet & cell | The islands as glowing 3D hexagon columns (~25 km² each): height and colour are the average download Speedtest users measured over the past year, home or mobile, playing quarter by quarter; dark red cells are homes where providers report neither 50/10 Mbps nor mobile service; an *Advertised 50/10* view shows what providers report to ISED. The panel names the towns whose speeds jumped most and the dead zones | 2019 → today (quarterly) |
  | ⛰ Trails & waterfalls | Every mapped footpath as a glowing web with hikers moving along it; named hiking routes coloured by effort; waterfalls as beams of falling water, as tall as their drop where it's known. Click a route or any footpath for its elevation profile and a **3D flight** along it over satellite imagery on real terrain; click a waterfall to **orbit it in 3D**; **Waterfall tour** flies to each photographed fall in turn; a **Satellite** switch lays imagery over the map | mapped today (static) |
  | ⚓ Water access | Every mapped beach (sand dots on the sea, green on lakes and rivers), named beach access, public boat launch (▲), marina (◆) and DFO small craft harbour (■). Chips show or hide each kind; the panel ranks the towns by the nearest boat launch, with their nearest beach and moorage | mapped today (static) |
  | ⛺ Camping & rec sites | BC Parks and national park campgrounds, Recreation Sites and Trails BC sites, and private, regional and First Nations campgrounds as tents coloured by kind (hollow for walk-in or paddle-in sites, rings for day-use rec sites); click one for campsites, fees, season, facilities and any closure notice. The panel ranks towns by campgrounds within 25 km | mapped today (static) |
  | ❄ Snowpack | The BC River Forecast Centre's snow courses and snow pillows in the island's mountains as columns as tall as each station's 1 April snow water, coloured by how that compares with the station's own normal (amber thin, white normal, blue deep). The sparkline is the island's median % of normal; events mark the thinnest and deepest years (2015's snow drought, 1999). Panel: what the snowpack means for ski season, summer rivers and town water, the long-record stations' first and last 30 years, and honest coverage notes | 1955 → today |

- **The Layer menu**: the atlas starts on just the island. Each layer's switch puts it on the map or takes it off. Clicking a layer's name makes it the *picked* layer, whose story fills the side panel and whose years drive the timeline; the other layers stay on. Switching off the picked layer takes its timeline away too, and *Clear the map* at the top turns everything off. The `+N` on the Layer button counts the other layers on the map.
- **Static layers** (Shaking hazard, Tsunami zones, Floodplains, Radon, Climate normals, Future climate, Hospital access, Trails & waterfalls, Water access, Camping & rec sites) don't change over time. While one is the picked layer the timeline dims, and any time-based layers that are on keep playing underneath.
- **The timeline** has play/pause, speeds, a sparkline of the picked layer, and markers for key moments: big fires, the 1946 Vancouver Island earthquake, the 1964 Port Alberni tsunami, the 2021 heat dome and more. As playback passes one, a line with **Details** appears above the timeline.
- **Click anything for details.** A timeline marker, an event's **Details**, a layer's **Key moments**, or anything you can point at on the map opens a panel on the right. Map features include an earthquake, a fire, a river gauge, a weather or air-quality station, a hospital, a well or aquifer, a footpath, or a spot on the hazard and future-climate maps. Each panel has:
  - its own numbers and, for gauges and stations, a chart of its record;
  - the layer year by year with that moment marked, and what else was happening on other layers at the time;
  - the closest towns, and the moments before and after;
  - sources, and a button that puts its layers on the map at that date.

  Towns open their report.
- **Town Report**: click any town for a report card. It covers:
  - prices, population, the 65+ share and crime;
  - nearby wildfire and quake history, the official earthquake shaking hazard, the tsunami notification zone and low coastal ground nearby, the share of ground within 2 km in a mapped floodplain (and which study), the share of radon tests over the guideline in its health area (with the sample size), how often the nearest long-record river gauge ran nearly dry in summer, and smoke days;
  - local climate and warming trend, and the nearest river's flood record;
  - the drive to the nearest 24/7 emergency room;
  - projected hot days, temperature, frost and summer rain for the 2050s, with model ranges;
  - the trails and waterfalls nearby, each opening on the map;
  - the nearest beach, boat launch and marina or public harbour, and the nearest campground and park campground (straight-line, own island for the small islands);
  - the wells nearby (within 5 km, or the whole island for the small islands): median depth and yield, the share of low-yield wells, and every well drawn as a drill hole, shallowest to deepest.
  - measured home internet speed within 5 km (and in 2019), the share of homes nearby offered 50/10 Mbps, and mobile service.
  - winter sun: the median hours of direct sun on 21 December over the ground within 1.5 km once the hills are in the way, against the day's daylight;
  - windstorms: storm days (gusts of 90 km/h+) and gale days (70+) a year at the nearest sheltered gust station, last 30 years.
- **Town Finder**: weight what matters to you and every municipality is ranked and raised as 3D columns on the map. The criteria are affordability, low crime, low wildfire exposure, lower shaking hazard, low tsunami exposure, out of mapped floodplains (off by default), low radon (area survey, off by default), rarely in severe drought (off by default), sheltered from windstorms (off by default), low quake activity, mild & warm, sunnier, winter sun (off by default), little snow & frost, close to a hospital, not ferry-dependent, clean air, mild future summers, trails & waterfalls nearby, fast internet, retiree community, and services & amenities. Presets set them all at once, and your weights are remembered in your browser.
  - logging within 5 km in the last 10 years, approved or active cutblocks, the share of nearby land in parks, and the nearest parks.
- **Gulf and Discovery islands**: Salt Spring, Galiano, Thetis, Gabriola, Lasqueti, Denman and Quadra are included alongside the island's municipalities (list in `scripts/municipalities.mjs`). Every map layer is clipped to them too. They are unincorporated, so a few figures come from other sources and are labelled in their reports:
  - population and 65+ share from the 2021 Census (dissemination areas on each island)
  - crime from the island's rural RCMP detachment (Salt Spring, Gabriola, Quadra; Galiano shares the Outer Gulf Islands detachment)
  - sale prices are estimates: each island's 2021 Census average home value, scaled to match transfer-tax medians and moved since with its rural area's sales
  - ER access through the ferry route when there is no ER on the island; the Town Finder adds half the gap between sailings for the wait
  - ferry links (weekday sailings, last boat home, crossing time, car ferry or not) feed the *Not ferry-dependent* criterion. BC Ferries links are counted from the operator's GTFS timetable feed on a typical weekday in the next two weeks, so `npm run data ferries` picks up each new season; Lasqueti's passenger ferry has no feed and is typed into `scripts/municipalities.mjs`
- **Land Finder** (button top right, or `#land` in the URL): every private parcel of 5+ acres on Vancouver Island and the shortlisted islands (about 29,000, from ParcelMap BC), filtered live. Every criterion is a slider or switch, starting from our brief: 10+ acres, waterfront, within 45 minutes' drive of health care, groceries and gas, quiet, and safe, with at least an acre outside the tsunami hazard and outside any mapped floodplain:
  - **The land**: size, slope, winter sun (hours of direct sun on 21 December at the sunniest spot on the parcel once the hills are in the way, worked out from terrain; off by default), Agricultural Land Reserve share, Vancouver Island or the small islands
  - **Waterfront**: ocean, lake or river frontage (boundary within 35 m of the Freshwater Atlas shoreline) and how much, or distance to water
  - **Within reach**: drive minutes to the nearest clinic or hospital (or 24/7 ER), grocery store and gas station (OSRM on OpenStreetMap roads); the share of homes offered 50/10 Mbps internet and whether mobile service is reported, for the parcel's ~25 km² broadband hexagon (both off by default)
  - **Quiet**: distance from the quietest spot on the land to a busy road, from airports and float bases, and from industry and quarries
  - **Safety**: BC Wildfire Service strategic threat rating on or within 500 m of the parcel (local copies only, see the data sources), road distance to the nearest fire hall on its island (within 8 km, the line insurers use for a protected rating, within 13 km, or any; off by default), fire starts nearby since 1990, mapped floodplains (BC's 1978–1997 maps: room to build outside them, fully outside, or any), tsunami hazard (a published hazard map where one covers the parcel, else its low coastal ground: room to build outside it, fully outside, or any), highest ground above sea level, earthquake shaking hazard
  - **Water supply**: median yield and depth of the registered wells within 1 km, the share of them that gave under 2 US gallons a minute, and whether the parcel sits over a mapped aquifer (all off by default; the per-parcel figures are in `public/data/land-wells.json`)
  - **Outdoors**: km of mapped footpath within 3 km, and straight-line distance to the nearest waterfall, beach or beach access, and public boat launch on the parcel's own island (all off by default)
  - **Next door**: backs onto a park or protected area, backs onto Crown land, no logging within 1 km in the last N years, no approved or active cutblock within 1 km (all off by default)
  - **Budget**: BC publishes no per-parcel prices, so the budget checks the asking prices you add to shortlisted parcels; each parcel links to listings near it

  Behind every slider is a histogram of the parcels that value would let through given all the other filters, and a funnel along the bottom shows how each step narrows the island and which one cuts the most. Matches glow on the map and rank by a score. A parcel's report has a radar chart of its strengths, a ring of what surrounds it out to 1 km (parks, Crown land, water, logging by age, planned cutblocks), drive-time arcs to the places it relies on (and its fire hall), its winter sun through the year against flat ground, satellite imagery, its water supply (the nearby wells drawn as drill holes, the aquifer under it, and any well registered on its PID), and a shortlist for your notes and asking price, kept in the browser. With two or more parcels shortlisted, **Plan a viewing trip** puts them in the quickest driving order from a town you pick, with arrival times for a day of viewings, the route on the map, ferry legs and a late-finish warning flagged, and a Google Maps link; planning sends the parcels' coordinates (not your notes or prices) to the public OSRM router.
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
npm run data logging neighbours  # cutblocks, then parks, Crown land and logging around every parcel and town
npm run data water camping       # beaches, launches, marinas and harbours; campgrounds and rec sites
npm run data snow                # snow courses and snow pillows (about 100 MB of CSVs on first run)
npm run data firehalls           # road distance from every parcel to its nearest fire hall (~160 OSRM calls on first run, ~5 min)
npm run data sun                 # winter sun at every parcel and town, from terrain (~860 terrain tiles on first run)
npm run data wind                # daily peak gusts at every island gust station (~300 small API calls on first run)
npm run data flood               # BC floodplain maps, per town and per parcel (after land)
npm run data radon               # Health Canada's home radon survey by health area
npm run data drought             # summer low flows at every island river gauge (about 80 MB of basin outlines on first run)
```

The stages are `island`, `ferries`, `fires`, `quakes`, `rivers`, `climate`, `normals`, `population`, `housing`, `crime`, `hospitals`, `seismic`, `smoke`, `future`, `trails`, `internet`, `land`, `wells`, `tsunami`, `flood`, `firehalls`, `sun`, `logging`, `neighbours`, `water`, `camping`, `snow`, `radon`, `drought` and `wind` (`wells`, `tsunami`, `flood`, `firehalls` and `sun` read `land.json` and write their parcel figures to their own `land-wells.json`, `land-tsunami.json`, `land-flood.json`, `land-fire.json` and `land-sun.json`). `scripts/fetch-data.mjs` downloads from the sources below, clips everything to the island, and writes compact JSON to `public/data/`.

- **Caching:** raw downloads are cached in `.cache/`, so re-runs are quick. Delete it to fetch everything fresh.
- **When a source is down:** that layer keeps its existing data, and **Data & sources** in the app shows its status.
- **First run:** a full run from an empty cache downloads several gigabytes and takes a while. The smoke stage alone streams about 100 MB a year from the province's FTP server through `curl`. The internet stage reads only the island's rows of Ookla's global quarterly files with HTTP range requests (20–40 MB per file instead of ~200 MB; about 4 minutes in all).

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
| Tsunami zones | EMCR, *Tsunami Notification Zones for BC* (BC Data Catalogue WFS); Strathcona Regional District, *West Coast Tsunami Inundation Models* (Cascadia and Alaska scenarios, ArcGIS REST); City of Victoria, *Tsunami Hazard Zone* and *Safe Zone* (2021 model, ArcGIS REST); low coastal ground from Mapzen / AWS terrain tiles (z10). The Capital Region's regional service is not used: its terms forbid redistribution | OGL – British Columbia; OGL – Canada; City of Victoria Open Data Licence |
| Floodplains | BC Ministry of Water, Land and Resource Stewardship, *Mapped Floodplains in BC (Historical)* (`WHSE_BASEMAPPING.CWB_FLOODPLAINS_BC_AREA_SVW`), its *Study Area Limits* (`CWB_FLOODPLAINS_LIMIT_LINE_SP`) and *Mapsheets Index with Links to Reports in EcoCat* (`WHSE_WATER_MANAGEMENT.FLDP_FLOODPLAIN_PROJ_REPORT_SP`), BC Data Catalogue WFS. Newer regional studies are not used: none found is published under an open licence | OGL – British Columbia |
| Radon | Health Canada, *Cross-Canada Survey of Radon Concentrations in Homes* (2009–2011; one row per home, `radon-concentration.csv` on open.canada.ca); island health area outlines from BC's *Health Service Delivery Area Boundaries* (`WHSE_ADMIN_BOUNDARIES.BCHA_HEALTH_SERV_DEL_AREA_SP`, BC Data Catalogue WFS). The BCCDC's BC Radon Data Repository is not used: it releases data only on request | OGL – Canada; OGL – British Columbia |
| River floods | ECCC HYDAT annual peaks via `api.weather.gc.ca` | OGL – Canada |
| Drought & low rivers | ECCC Water Survey of Canada HYDAT daily mean discharge via `api.weather.gc.ca` (`hydrometric-daily-mean`); ECCC *Hydrometric Network Basin Polygons* (region 08 GeoJSON, `collaboration.cmc.ec.gc.ca`). BC's *Drought Levels* and *Historical Drought Levels* are not used: they are published "Access Only" (Province of BC copyright, no redistribution) | OGL – Canada |
| Windstorms | Environment and Climate Change Canada daily climate observations (peak gust speed and direction) and station list via `api.weather.gc.ca` (`climate-daily`, `climate-stations`) | OGL – Canada |
| Fire halls | OpenStreetMap fire stations (`amenity=fire_station`, via Overpass) and road distances from the OSRM demo router. BC publishes no open fire-hall or fire-protection-area layer | ODbL |
| Wildfire smoke | BC Ministry of Environment, *Air Quality and Climate Monitoring: Verified Hourly Data* — yearly PM2.5 CSVs on `ftp.env.gov.bc.ca/pub/outgoing/AIR/AnnualSummary` (streamed through `curl`, island rows only; ~100 MB per year on first run) | OGL – British Columbia |
| Climate | ECCC Adjusted & Homogenized Canadian Climate Data (AHCCD) via `api.weather.gc.ca` | OGL – Canada |
| Climate normals | ECCC Canadian Climate Normals 1981–2010 (`climate-normals` collection) via `api.weather.gc.ca` | OGL – Canada |
| Future climate | CanDCS-U6: CMIP6 projections statistically downscaled by PCIC (BCCAQv2, 26 models, ~10 km), as 30-year index averages with 10th/50th/90th model percentiles published for ClimateData.ca — read over OPeNDAP from the PAVICS THREDDS server (`pavics.ouranos.ca`, `…/cmip6/climatedata_ca/CanDCS-U6/ensemble_statistics/30yAvg`) | OGL – Canada |
| Population | BC Stats sub-provincial population estimates & projections | OGL – British Columbia |
| Home prices | BC Ministry of Finance, Property Transfer Tax data | OGL – British Columbia |
| Crime | Statistics Canada Table 35-10-0063-01 | Statistics Canada Open Licence |
| Hospital access | BC Ministry of Health / HealthLinkBC “Hospitals in BC” + “Emergency Rooms in BC” (BC Data Catalogue); drive times from the public OSRM demo router on OpenStreetMap roads | OGL – British Columbia; routes © OpenStreetMap contributors (ODbL) |
| Internet & cell (advertised) | ISED Canada *National Broadband Data*: 50/10 Mbps availability bands, 5/1 availability, 2021 dwellings and providers by technology for each ~25 km² hexagon (`ised-isde.canada.ca/app/scr/sittibc/web/api/openData`, `Map_Data_CSV.zip` and `Map_Data_Shapefile.zip`) | OGL – Canada |
| Internet & cell (measured) | Speedtest® by Ookla® *Global Fixed and Mobile Network Performance Maps*: quarterly zoom-16 tiles since 2019 (`ookla-open-data.s3.amazonaws.com/parquet/performance`), island rows read by HTTP range request and pooled into the ISED hexagons | CC BY-NC-SA 4.0 (non-commercial; this atlas is) |
| Coastline | BC Freshwater Atlas islands | OGL – British Columbia |
| Ferries | BC Ferries GTFS timetable feed, maintained by Trillium Solutions (`data.trilliumtransit.com/gtfs/bcferries-bc-ca/bcferries-bc-ca.zip`, re-fetched each month); Lasqueti from Western Pacific Marine's timetable, typed by hand | Public feed, no licence stated |
| Land Finder parcels | ParcelMap BC parcel fabric (private parcels of 5+ acres) | OGL – British Columbia |
| Land Finder water, hazards and rules | Freshwater Atlas coastline, lakes and rivers; BC floodplain maps; Agricultural Land Reserve; BC airports | OGL – British Columbia |
| Land Finder wildfire threat (local only) | BC Wildfire Service *Provincial Strategic Threat Analysis* fire threat rating (`PROT_PSTA_FIRE_THREAT_RTG_SP`). Published "Access Only" (Province of BC copyright, no redistribution without permission), so the `land` stage writes the per-parcel ratings to `public/data/land-threat.json`, which is git-ignored and never deployed: the filter works in a local copy after `npm run data land` and is switched off on the public site | Access Only |
| Trails & waterfalls | OpenStreetMap via Overpass: `route=hiking`/`foot` relations, footpaths (`highway=path`, `bridleway` and unpaved `footway`), `waterway=waterfall`; photos and heights from Wikidata (P18, P2048) and photos geotagged on Wikimedia Commons whose file name matches the fall; elevations from Mapzen / AWS terrain tiles; satellite imagery from Esri World Imagery | ODbL; Wikidata CC0; photos under their own Commons licences; imagery © Esri, Maxar, Earthstar Geographics |
| Wells & groundwater | BC Ministry of Water, Land and Resource Stewardship: GWELLS groundwater wells (`WHSE_WATER_MANAGEMENT.GW_WATER_WELLS_WRBC_SVW`) and the aquifer classification (`GW_AQUIFERS_CLASSIFICATION_SVW`), BC Data Catalogue WFS; depths converted from feet, yields kept in US gallons a minute | OGL – British Columbia |
| Water access | OpenStreetMap via Overpass: `natural=beach`, `leisure=slipway`, `leisure=marina` and features named “Beach Access”; Fisheries and Oceans Canada, Small Craft Harbours Locations and Information (ArcGIS REST service on open.canada.ca) | ODbL; OGL – Canada |
| Camping & rec sites | Recreation Sites and Trails BC, Recreation Sites Subset (`WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW`, BC Data Catalogue WFS); OpenStreetMap `tourism=camp_site`/`caravan_site` via Overpass, sorted by BC parks (`TA_PARK_ECORES_PA_SVW`) and national parks (`CLAB_NATIONAL_PARKS`) | OGL – British Columbia; ODbL |
| Snowpack | BC River Forecast Centre (BC Ministry of Water, Land and Resource Stewardship): Archive and Current Season Manual Snow Survey Data (`allmss_archive.csv`, `allmss_current.csv`), Archive Automated Snow Weather Station Data (`SW_DailyArchive.csv`, `SD_Archive.csv`) from `env.gov.bc.ca/wsd/data_searches/snow/asws/data`; station locations `SSL_SNOW_MSS_LOCS_SP` and `SSL_SNOW_ASWS_STNS_SP` (BC Data Catalogue WFS) | OGL – British Columbia |
| Logging | BC Ministry of Forests — Harvested Areas of BC (Consolidated Cutblocks, `VEG_CONSOLIDATED_CUT_BLOCKS_SP`) and Forest Tenure Cutblock Polygons (`FTEN_CUT_BLOCK_POLY_SVW`), BC Data Catalogue WFS | OGL – British Columbia |
| Parks, Crown land (Next door) | BC Parks, Ecological Reserves and Protected Areas (`TA_PARK_ECORES_PA_SVW`); national parks (`CLAB_NATIONAL_PARKS`); Generalized Forest Cover Ownership (`F_OWN`: Crown, park, private); Freshwater Atlas lakes; measured on a 50 m grid | OGL – British Columbia |
| Land Finder services and roads | OpenStreetMap via Overpass (grocery stores, gas, clinics, busy roads, industry); drive times from the OSRM demo router; terrain from Mapzen / AWS terrain tiles | ODbL; public terrain tiles |

Basemap © OpenStreetMap contributors © CARTO. Terrain tiles: Mapzen / AWS Open Data.

## Roadmap

Built so far from the original plan: climate normals, a century of logging (with what's next door to every parcel), hospital access, wildfire smoke, future climate, earthquake shaking hazard, and tsunami zones (the Cascadia scenario without invented arrival times); since then, internet and cell coverage, well water, water access and camping, the snowpack, floodplains, radon, drought, fire protection, winter sun and windstorms. Still open: a guided story mode, sea level, ongoing costs (property tax and rent), and Indigenous territories and place names. The details and a suggested build order are in [ROADMAP.md](ROADMAP.md). [MAP-ATLAS-BLUEPRINT.md](MAP-ATLAS-BLUEPRINT.md) describes how to build a new atlas in the same style for another region.

## Caveats

This is an exploration tool, not professional advice:
- Property-transfer medians include all property types, so they run below single-family listing prices.
- River-gauge ratios describe high water, not flooded area.
- Hazard counts describe history, not risk forecasts.
- Floodplain maps (the Floodplains layer) date from 1978–1997 and cover only 17 island rivers and lakes; outside them is "not mapped", not "safe".
- Drought ranks (the Drought & low rivers layer) compare each river gauge with its own record, not with BC's official drought levels; many island rivers are regulated, "nearly dry" (under 2% of average flow) is a screening line, and a town's gauge is the nearest one, not its water supply.
- Radon figures (the Radon layer) are one area-wide number per health area from ~55–110 volunteer homes tested in 2009–2011; they can't tell one house from the next, so test any house you buy.
- The trip planner's drive times are free-flow estimates from the public OSRM router, to each parcel's centre point: no traffic or ferry waits.
- Fire hall distance (Land Finder) is the drive to the nearest OpenStreetMap fire hall; a protected insurance rating also needs the house inside a fire protection area, which isn't mapped here. Ask the regional district and an insurer.
- Winter sun counts the hills' shadow from ~50 m terrain only: trees and buildings can take more.
- Storm days come from a handful of gust stations, many of them airports and lighthouses; the falling counts at the airports since the 1980s line up with instrument and reporting changes, so they are not a trend.
- Low coastal ground (the tsunami layer) is a screening measure from ~100 m terrain, not an official hazard map; published maps exist only for Victoria and the north-west coast.
- Trails can be closed, overgrown, on private land or seasonal.
- Well yields are the driller's short test when each well was finished, not a long-term supply, and nearby wells are a guide, not a promise for a new well. Older wells are under-counted, and the registry's 0 yields are treated as not recorded.
- Internet availability is what providers report for a ~25 km² hexagon, not a specific address; measured speeds depend on the plans people bought and their Wi-Fi. Ask the provider about the address before buying.
- The logging record undercounts early and private-land harvesting; approved cutblocks cover Crown tenures only, and Crown land next door can still be logged, leased or sold.

For a specific property, check the official floodplain, tsunami and wildfire-interface maps.
