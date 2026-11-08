# Roadmap

Ideas for making Island Atlas more educational, with a focus on what matters when choosing where to retire. Each one uses real open data, following the same pattern as the existing layers:

- a **source** in `scripts/fetch-data.mjs` that downloads the data and writes compact JSON to `public/data/`
- an **`AtlasLayer`** in `src/layers.ts` with map layers, a timeline sparkline, a story panel and tooltips
- optionally, a **Town Report metric** and **Town Finder criterion** in `src/metrics.ts`

Data sources marked *(verify)* still need their exact dataset, licence and download format confirmed before building.

---

## Suggested build order

The order puts quick wins that reuse existing code first, then the most decision-relevant features, then the larger or more delicate pieces.

| # | Feature | Why at this point | Effort |
|---|---|---|---|
| 1 | ✅ [Climate normals: what a town feels like](#3-climate-normals-what-a-town-feels-like) | Uses the climate API the pipeline already calls; adds strong Town Finder criteria (sunshine, rain days) | Small |
| 2 | ✅ [A century of logging](#6-a-century-of-logging) | Same BC WFS paging and the same "flare then scar" animation as wildfires; the most dramatic new visual | Small–medium |
| 3 | ✅ [Getting to a hospital](#1-getting-to-a-hospital) | The most important retirement factor missing today; adds the first "static" (non-timeline) layer | Medium |
| 4 | ✅ [Static-layer support](#static-layers) | Needed by items 3, 8 and 9; small refactor done once | Small |
| 5 | [Guided story mode](#10-guided-story-mode) | Best done once several layers exist, so tours can tie them together | Medium |
| 6 | [Sea level: Victoria vs. Tofino](#7-sea-level-victoria-vs-tofino) | Short, surprising story; small dataset; good first story-mode tour | Small–medium |
| 7 | ✅ [Wildfire smoke days](#4-wildfire-smoke-days) | Health-relevant; larger download to process | Medium |
| 8 | ✅ [Future climate (2030s–2050s)](#2-future-climate-2030s2050s) | High value, but projection data and uncertainty need careful presentation | Medium–large |
| 9 | ✅ [Earthquake shaking hazard](#5-earthquake-shaking-hazard) | Static layer that complements the quake history | Medium |
| 10 | ✅ [Tsunami zones and a Cascadia scenario](#9-tsunami-zones-and-a-cascadia-scenario) | Builds on items 4 and 9; arrival times must come from published modelling | Medium–large |
| 11 | [Ongoing costs: property tax and rent](#11-ongoing-costs-property-tax-and-rent) | Useful, but rent data may need a manual export step | Medium |
| 12 | [Indigenous territories and place names](#8-indigenous-territories-and-original-place-names) | Important, but needs the most care with sources, permissions and wording | Medium |
| 13 | ✅ [Internet and cell coverage](#13-internet-and-cell-coverage) | Rural buyers can't judge working from home without it | Medium |
| 14 | ✅ [Water access and camping](#14-water-access-and-camping) | A coastal retirement is about getting on the water; two small point layers beside Trails | Small–medium |
| 15 | ✅ [Snowpack](#15-snowpack) | Ski season, summer rivers and town water start in the mountains; a small timeline layer from open CSVs | Small |
| 16 | ✅ [Floodplains](#16-floodplains) | Riverside towns and acreages: where the province mapped a 200-year flood, how old the map is, and how much of a town or parcel is inside | Small–medium |
| 17 | ✅ [Radon](#17-radon) | Every house purchase should include a radon test; shows how low the island is against BC, honestly at health-area grain | Small |
| 18 | ✅ [Drought and low rivers](#18-drought-and-low-rivers) | Wells, creeks and small reservoirs falter in dry summers; a century of river lows shows how often, and whether it's getting worse | Small–medium |

### Static layers

✅ **Built.** `AtlasLayer.static?: boolean` plus an optional `period` caption for the rail. Focusing a static layer dims the timeline with a "doesn't change over time" note; the timeline stays on the last focused time-based layer (`state.timeLayer` in `main.ts`), so other visible layers keep playing. `Ctx.hovered` gives layers the town under the pointer. Hospital access and Climate normals are static.

Hospitals, seismic hazard and tsunami zones don't change over time. Before adding them, extend `AtlasLayer` with an optional `static: true` flag so that:

- the timeline hides or dims when a static layer is focused, instead of showing a meaningless range
- static layers can be overlaid while another layer animates (for example, tsunami zones under the earthquake history)

---

## Decision-relevant features

### 1. Getting to a hospital

✅ **Built.** `hospitals` source → `public/data/hospitals.json`; static "Hospital access" layer; *Emergency room* in the Town Report; Town Finder *Close to a hospital*. Facilities come from HealthLinkBC's "Hospitals in BC" joined by location to "Emergency Rooms in BC", whose hours say which ERs are 24/7, which are "call ahead" (Port Alice, Gold River) and which keep limited hours (Tahsis, Zeballos). Drive times come from the public OSRM demo server (one `table` call plus one `route` call per town-facility pair, cached in `.cache/osrm/`). Routes that use a ferry are flagged and don't count as the nearest 24/7 ER.

**What it teaches:** how far each town really is from emergency care. Some attractive towns are 1–2 hours from an emergency department.

- **Data:** hospital and emergency-department locations from the BC Data Catalogue *(verify: health facility / hospital layer)*. Drive times computed once in the pipeline with an open routing engine such as OSRM or openrouteservice, from each municipality to its nearest few hospitals.
- **Map:** hospital markers (emergency departments highlighted), plus animated "drive-time rings" or lines from the selected town to its nearest hospitals.
- **Town Report:** nearest emergency department and drive time.
- **Town Finder:** new criterion, *Close to a hospital*.
- **Watch out for:** public routing servers have usage limits, so cache results in `.cache/`. Drive times are typical, not winter or ferry-dependent.

### 2. Future climate (2030s–2050s)

✅ **Built.** `future` source → `public/data/future.json`; static "Future climate" layer; *By the 2050s* row in the Town Report; Town Finder *Mild future summers* (fewer projected hot days, default weight 1). Data are CanDCS-U6 (PCIC's BCCAQv2 downscaling of 26 CMIP6 models), using the ready-made 30-year index averages and 10th/50th/90th model percentiles that ClimateData.ca publishes; the pipeline reads them over OPeNDAP from the PAVICS THREDDS server (`…/cmip6/climatedata_ca/CanDCS-U6/ensemble_statistics/30yAvg`), one island-window request per variable, cached in `.cache/future/`. Variables: days with Tmax > 30 °C (`txgt_30`), mean temperature (`tg_mean`, stored in K, converted), frost days, and June–August precipitation (seasonal file; its units attribute says mm/day but the values are seasonal totals in mm). Periods 1991–2020 (the models' own "today"), 2021–2050 and 2041–2070; SSP2-4.5 and SSP5-8.5. Rather than extending the timeline, it is a static layer: a hatched, coastline-clipped surface (value or change from 1991–2020, median model) with scenario/period/variable chips, and a town ranking with 10th–90th-percentile range bars. api.weather.gc.ca's CanDCS-U6 collections only carry temperature and precipitation, and its climate-index collections are CMIP5, hence PAVICS. Frost-free season (`frost_free_season`) is also in the files if wanted later.

**What it teaches:** what the next 25 years are likely to bring, which matters more for retirement than the past century.

- **Data:** downscaled climate projections for BC from ClimateData.ca or the Pacific Climate Impacts Consortium (PCIC) *(verify: API vs. bulk download, variables available)*.
- **Variables:** days above 30 °C, summer rainfall, frost-free days, mean temperature, for a mid-range and a high emissions scenario.
- **Map:** extend the timeline past today into a visibly different "projection" zone (dashed sparkline, translucent columns, as population projections already do).
- **Town Report:** "By the 2050s: about X hot days a year (today: Y)".
- **Watch out for:** always show a range, not a single number, and label scenarios plainly.

### 3. Climate normals: what a town feels like

✅ **Built.** `normals` source → `public/data/normals.json`; "Climate normals" layer; "What it feels like" row in the Town Report; Town Finder *Sunnier* (sunshine hours) and *Little snow & frost*. `api.weather.gc.ca` only serves the **1981–2010** normals (1991–2020 aren't in the API yet); 8 island stations report sunshine.

**What it teaches:** day-to-day weather. Annual temperature hides the big differences, such as roughly twice the sunshine in Victoria compared with the west coast.

- **Data:** Environment Canada 1991–2020 climate normals via `api.weather.gc.ca` *(verify: collection name and which stations report sunshine)*.
- **Variables:** sunshine hours, days with rain, frost days, snowfall, wettest-month rainfall.
- **Map:** one column per station, switchable between variables; a small "climate card" per station.
- **Town Finder:** replace the current rainfall-based *Drier & sunnier* criterion with real sunshine hours where available, and add *Little snow / frost*.
- **Watch out for:** only some stations record sunshine, so fall back to the nearest station that does and say so.

### 4. Wildfire smoke days

✅ **Built.** `smoke` source → `public/data/smoke.json`; time-based "Wildfire smoke" layer (columns at air monitors, map-wide haze tracking the island average); *Smoky days* in the Town Report; Town Finder *Clean air (fewer smoke days)*. Data are BC ENV's verified hourly PM2.5, one ~100 MB all-BC CSV per year on `ftp.env.gov.bc.ca`, streamed through `curl` (Node has no FTP client) and reduced to Vancouver Island station-days in `.cache/smoke/`. A smoke day = daily mean over 25 µg/m³, BC's 24-hour PM2.5 objective (adopted 2009); days need 18+ hours and station-years 75%+ of days. The map, sparkline and events count May–October days only, since winter exceedances (Duncan, Port Alberni, Courtenay) are mostly wood-stove smoke; the Town Report and *Clean air* use all-year days. The town metric averages the nearest monitor's last 10 years (needs 5 complete years, within 75 km) so stations that closed before the smoky late 2010s don't look clean.

**What it teaches:** smoke is a growing health issue for older lungs, even in towns that never burn.

- **Data:** BC air-quality monitoring, historical fine-particle (PM2.5) readings *(verify: BC Data Catalogue verified hourly data)*.
- **Measure:** days per year where daily PM2.5 exceeds a health threshold, per monitoring station.
- **Map:** columns per station over time, with a haze effect over the map in bad smoke years.
- **Town Report and Finder:** average smoke days per year at the nearest station; criterion *Clean air*.
- **Watch out for:** monitoring stations are few and start in different years; show coverage honestly.

### 5. Earthquake shaking hazard

✅ **Built.** `seismic` source → `public/data/seismic.json`; static "Shaking hazard" layer; *Shaking hazard* in the Town Report; Town Finder *Lower shaking hazard* (the past-quake-count criterion stays but now defaults to weight 0). No downloadable grid exists on open.canada.ca: the only listing is the NBC 2020/2025 Seismic Hazard Tool, whose documented public GraphQL API (`earthquakescanada.nrcan.gc.ca/api/canshm/graphql`) answers per point, so the pipeline samples a 0.1° × 0.065° grid (~950 points over the island and a coastal fringe) plus each town centre, 50 points per request, cached in `.cache/seismic/`. Values are NBC 2020 PGA for site class C at 2% and 10% in 50 years. The app interpolates the grid into a translucent bitmap clipped to the coastline (deck id `seismic-base`, under labels).

**What it teaches:** why expected ground shaking differs across the island, and what "2% chance in 50 years" means.

- **Data:** Natural Resources Canada 2020 seismic hazard model, as used by the National Building Code *(verify: downloadable grid on open.canada.ca)*.
- **Map:** a smooth colour surface of expected shaking under the existing earthquake history.
- **Town Report:** the hazard value with a plain-English explanation.
- **Town Finder:** replace or supplement *Low quake activity* (which counts past quakes) with the official hazard value.

---

### 13. Internet and cell coverage

✅ **Built.** `internet` source (`scripts/internet.mjs`) → `public/data/internet.json`; time-based "Internet & cell" layer (`src/internet.ts`); *Internet* in the Town Report; Town Finder *Fast internet*; Land Finder *50/10 Mbps internet* and *Mobile coverage* in *Within reach*.

- **Advertised:** ISED's National Broadband Data (OGL – Canada), the open data behind the National Broadband Internet Service Availability Map. The CSV package gives each ~25 km² hexagon's 50/10 band (none, under 25%, 25–50%, 50–75%, over 75% of homes), whether 75%+ get 5/1, 2021 dwellings in ranges, and a row per provider and technology; geometry comes from the shapefile package (Lambert conformal conic, inverted in the script). Mobile coverage = a mobile-wireless provider listed for the hexagon. ISED also publishes per-pseudo-household speeds (`NBD_PHH_Speeds.zip`, 186 MB, with an LTE flag); not used yet because each point needs the separate PHH locations file.
- **Measured:** Ookla open data (CC BY-NC-SA 4.0; fine for this non-commercial personal atlas with attribution; derived data stay under the same licence). The global parquet files are sorted by quadkey, and the island's tiles sit in the first few percent of rows, so hyparquet reads only that prefix of each column chunk over HTTP range requests (20–40 MB per file); the clipped rows are cached per quarter in `.cache/internet/`. Tiles are pooled into the ISED hexagons (nearest centre) so both sources share one grid. If the atlas ever went commercial, the measured views would have to go.
- **Per parcel:** the Land Finder looks each parcel up in the hexagons in the browser (as it does for trails), so `land.json` is unchanged.
- **Still open:** address-level availability (the PHH file), upload speeds and latency (in the Ookla rows, not yet shown), and separating Starlink from wired home internet (Ookla's open tiles don't).

### 14. Water access and camping

✅ **Built.** `water` and `camping` stages (`scripts/outdoors.mjs`) → `public/data/water.json` and `camping.json`; static *Water access* and *Camping & rec sites* layers in the *Outdoors* group (`src/outdoors.ts`); *Water access* and *Camping nearby* in the Town Report; Land Finder *A beach nearby* and *A boat launch nearby* in *Outdoors*, worked out per parcel in the browser.

- **Water access:** OpenStreetMap beaches, slipways, marinas and features named “Beach Access” (ODbL), with Fisheries and Oceans Canada's small craft harbours (OGL – Canada). Lake and river beaches are told apart by distance from the coast. Distances are straight lines, own island only for the small islands.
- **Camping:** Recreation Sites and Trails BC's site points (OGL – BC) and OpenStreetMap campgrounds, merged where they are the same site and sorted by the BC and national park boundaries the `neighbours` stage already downloads.
- **Still open:** BC Parks doesn't publish its campgrounds (or their capacities, fees and reservations) as open data, so park campgrounds come from OpenStreetMap and only carry what volunteers tagged; municipal beach-access inventories (e.g. Saanich, Nanaimo, the CRD) are separate per-council datasets and only accesses named in OpenStreetMap appear; walking or driving times to the water instead of straight lines; no Town Finder criterion yet.

### 15. Snowpack

✅ **Built.** `snow` stage (`scripts/snow.mjs`) → `public/data/snow.json` (32 KB); time-based *Snowpack* layer in the *Outdoors* group (`src/snow.ts`). The BC River Forecast Centre's manual snow course archive and current season, the automated stations' daily snow water equivalent and hourly snow depth archives, and both station-location layers (all OGL – BC). 22 courses and 5 pillows inside the island outline with 5+ years of 1 April data; each compared with its own normal (median 1 April water, 1991–2020 where it has 15 of those years); the island figure is the median of those shares. Events for the thinnest (2015, 2005, 1981) and deepest (1999, 1974) years.

- **Still open:** coverage is thin (8 stations measured in 2026, 5 of them counted in the island figure; most courses retired) and the early island figure rests on a few stations; no Town Report row, since no town's water or home can honestly be tied to one station; the CRD's Sooke watershed pillows other than Survey Mountain, and BC Wildfire's low weather stations, have no snow water in the archive; mid-winter (1 February, 1 March) and 15 May surveys are in the data but not shown; the River Forecast Centre's published basin indices and normals are not used (the atlas computes its own from the station records).

### 16. Floodplains

✅ **Built.** `flood` stage (`scripts/flood.mjs`, after `land`) → `public/data/flood.json` (7 KB, per study and town), `flood-map.json` (229 KB, loaded on first show) and `land-flood.json` (143 KB, per parcel in `land.json`'s order with a PID hash); static *Floodplains* layer in *Hazard & climate outlook* after Tsunami zones (`src/flood.ts`). Sources: BC's *Mapped Floodplains in BC (Historical)*, its *Study Area Limits* and *Mapsheets Index* with EcoCat report links (all OGL – BC). 17 studies on the islands, designated 1978–1997 (Shawnigan Lake to the Cowichan, Somass and Little Qualicum); one alluvial fan (Oyster River) and one dry island kept out. Town Report *Mapped floodplain* (share of ground within 2 km and which study), Town Finder *Out of mapped floodplains* (weight 0), Land Finder Safety *Mapped floodplain* (room to build outside: an acre / fully outside / any), parcel report tile. Each study is tied to the River floods gauges on its river, and the two layers link to each other.

- **Still open:** newer regional and municipal flood mapping (searched for the Cowichan Valley, Comox Valley, Strathcona/Campbell River, Nanaimo and North Cowichan) turned up only viewer-only web maps or services with no open licence, several of them reusing the provincial layer, so none is shown; coastal flooding (storm surge, sea-level rise; see item 7) and creeks are unmapped here; flood construction levels from the map sheets are not digitized; the town share is a 2 km disc round the centre, not the town's residential area.

### 17. Radon

✅ **Built.** `radon` stage (`scripts/radon.mjs`) → `public/data/radon.json` (5 KB: the island's three health areas with every home's result and tests by postal area, BC's 16 health areas, BC and Canada totals, each town's area) and `radon-map.json` (46 KB of outlines, loaded on first show); static *Radon* layer in *Hazard & climate outlook* after Floodplains (`src/radon.ts`). Sources: Health Canada's *Cross-Canada Survey of Radon Concentrations in Homes* (2009–2011, one row per home, OGL – Canada) and BC's *Health Service Delivery Area Boundaries* (OGL – BC). 270 island homes: 3 over 200 Bq/m³ (1.1%; South 1 of 55, Central 1 of 109, North 1 of 106), against 7.9% across BC and 11% across Canada. Town Report *Radon (area survey)* with the sample size; Town Finder *Low radon (area survey)* (weight 0). No Land Finder filter: three areas can't say anything about a parcel.

- **Still open:** the BCCDC's BC Radon Data Repository (40,000+ tests, behind the BC Radon Map) and BC Lung's community testing summaries would be finer, but the repository releases data only on approved requests and the community results are published only as PDF reports, not open data, so neither is used; postal areas hold 2–30 tests each on the island, too few to map, so they are only listed; no geological proxy (NRCan airborne gamma-ray uranium) is drawn, since it measures rock rather than homes; the survey is 15 years old and volunteer-based.

### 18. Drought and low rivers

✅ **Built.** `drought` stage (`scripts/drought.mjs`) → `public/data/drought.json` (84 KB: 81 gauges with each summer's lowest 7-day flow, the day it ended and its rank in the gauge's own record, the island median by year, each town's nearest long-record gauge) and `drought-map.json` (200 KB: basin outlines and June–October monthly ranks, loaded on first show); time-based *Drought & low rivers* layer in *History on the timeline* after Wells (`src/drought.ts`). Sources: ECCC Water Survey of Canada HYDAT daily mean discharge (`api.weather.gc.ca`) and the Hydrometric Network Basin Polygons (both OGL – Canada). 1913–2025; the driest summers by island median (years with 20+ gauges) are 2023, 2015, 1992, 2014 and 1985. Town Report *Summer river lows* (share of summers the nearest gauge ran nearly dry, under 2% of its average flow; driest-10% summers in the last 20); Town Finder *Rarely in severe drought* (weight 0). Panel links to Wells and Snowpack.

- **Still open:** BC's own Drought Levels (0–5 by basin) and their 2015–2025 archive are published only "Access Only" (Province of BC copyright, no redistribution without written permission), so they are not used and the layer ranks gauge flows instead; watering-restriction stages (CRD, Nanaimo, Comox Valley, etc.) exist only as web pages, not open data, so none are shown; HYDAT ends with its last published year, so the current summer is missing (ECCC's real-time feed keeps only recent weeks); regulated rivers aren't flagged from data (HYDAT's regulation table is only in the full ~1 GB database), only by the usual-low-to-average ratio; no Land Finder filter, since one gauge per basin says little about a parcel's well; the Gulf Islands have no gauges with recent records, so their towns use a Vancouver Island gauge.

## Explaining the island's history

### 6. A century of logging

✅ **Built.** `logging` stage → `public/data/logging.json` (yearly totals, the share of the islands logged at least once on a 100 m grid, what's on the books) and `logging-blocks.json` (about 42,000 cutblock outlines simplified to 40 m, about 4 MB, loaded the first time the layer is shown). Time-based "Logging" layer: blocks flash as they're cut, then age through bare ground, regrowth and young forest using stacked layers with soft GPU filter ranges (no per-frame colour updates). Forest-tenure blocks approved but not started, or started in the last 3 years with no end date, pulse pink at today (Crown tenures only; blocks already in the harvest record, cancelled ones and approvals over 5 years old are left out). Events: the five busiest years and each 10% of the islands logged. The `neighbours` stage adds **what's next door**: ownership (Generalized Forest Cover Ownership, `F_OWN`), BC and national parks, lakes and the cutblocks on a 50 m grid, with Crown and park strips under 250 m wide removed by a morphological opening; per parcel → `land-neighbours.json` (parcel order of `land.json`, checked with a PID hash; `land.json` itself isn't touched), per town → `neighbours.json`. Land Finder *Next door* filters and a ring of what surrounds each parcel; Town Report *Logging & parks nearby*.

Still open: private managed forest land (the E&N grant lands on the east coast) has no open layer, so its harvest plans can't be shown; regional parks from `F_OWN` have no names; the record undercounts logging before the 1950s.

**What it teaches:** how much of the island's forest was cut and when. That helps explain today's landscape, river flooding and wildfire behaviour.

- **Data:** BC consolidated cutblocks (`WHSE_FOREST_VEGETATION.VEG_CONSOLIDATED_CUT_BLOCKS_SP`) with harvest year, via the same WFS paging the wildfire source uses.
- **Map:** cutblocks appear in their harvest year, flash, then settle into a "logged" tint that slowly greens as forest regrows. This reuses the wildfire flare-then-scar approach.
- **Panel:** hectares harvested per year and per decade; share of the island logged since 1900.
- **Watch out for:** a large dataset. Simplify geometry hard, and consider aggregating to a hexagon grid at low zoom.

### 7. Sea level: Victoria vs. Tofino

**What it teaches:** sea level is rising at Victoria but falling at Tofino, because the land there is being pushed up by the Cascadia fault.

- **Data:** monthly mean sea level from Fisheries and Oceans Canada tide gauges, or from the Permanent Service for Mean Sea Level (PSMSL), which has long records for both *(verify: station IDs and record lengths)*.
- **Map:** animated water-level "gauges" at each tide station, plus an optional "+1 m sea level" overlay from the terrain data for coastal areas.
- **Panel:** the two trend lines side by side, with a short explanation of land uplift.
- **Watch out for:** a 1 m overlay from a coarse elevation model is illustrative only. Label it so and link to official coastal flood maps.

### 8. Indigenous territories and original place names

**What it teaches:** whose traditional territory each town sits on, and the original names of places.

- **Data:** candidates are Native Land Digital, BC First Nations consultative areas, and BC Geographical Names *(verify each licence and terms of use; Native Land's maps are explicitly approximate)*.
- **Map:** soft territory outlines with names; original place names alongside English ones.
- **Town Report:** "Located in the traditional territory of …", with links to the Nations' own websites.
- **Watch out for:** territories overlap and are not legal boundaries. Use each Nation's preferred names, avoid implying precision, and prefer sources the Nations themselves publish or endorse.

### 9. Tsunami zones and a Cascadia scenario

✅ **Built.** `tsunami` stage (`scripts/tsunami.mjs`, runs after `land`) → `public/data/tsunami.json` (zones, studies, per-town exposure; small), `tsunami-map.json` (shapes and cells, loaded when the layer is first shown) and `land-tsunami.json` (per-parcel values in `land.json`'s order, checked by a hash of its PIDs, so `land.json` is untouched). Static "Tsunami zones" layer beside Shaking hazard; *Tsunami* in the Town Report; Town Finder *Low tsunami exposure* (weight 1); Land Finder *Tsunami hazard* under Safety (the brief asks for at least an acre outside it); the curated 1964 Port Alberni event now has its numbers, the inlet's funnelling, sources and a fly-up of Alberni Inlet. Sources: BC's tsunami notification zones (BC Data Catalogue WFS, OGL-BC), Strathcona Regional District's West Coast inundation models (Cascadia and Alaska scenarios, Nootka Sound to Quatsino Sound, OGL-Canada) and the City of Victoria's 2021 hazard zone (City open-data licence); everywhere else a screening measure from z10 Terrarium terrain: ground under 20 m within 1 km of the sea, reached along the sea from the open Pacific (that route also orders the wave sweep, which is labelled as order, not timing). **No per-town arrival times**: no openly published table could be checked, so the fallback applies; the only figures quoted are Ocean Networks Canada's (Kouhi et al. 2023) ~20 minutes to the outer north-west coast and ~3 hours to Boundary Bay for a magnitude 9 Cascadia quake.

Still open:
- The Capital Region's regional hazard-zone service (same 2021 study as Victoria's) forbids redistribution; ask the CRD for an open licence, or link only.
- Port Alberni (ACRD), Tofino, Ucluelet, the Comox Valley, Nanaimo and Cowichan publish tsunami maps as PDFs only; add each as it appears as open data.
- Per-town Cascadia arrival times, if a regional study publishes them openly (the ShakeOut BC FAQ table could not be retrieved to check).

**What it teaches:** which coasts are exposed, and how little warning a Cascadia tsunami would give compared with a distant one like 1964.

- **Data:** BC tsunami notification zones *(verify: Emergency Management BC / BC Data Catalogue)*, and published modelled arrival times from government or regional-district tsunami studies *(verify sources)*.
- **Map:** zones as a static layer; an animated wavefront that uses published arrival times only, never invented values.
- **Town Report:** tsunami zone and approximate first-wave arrival time for a Cascadia event.
- **Watch out for:** if no published arrival-time data can be found, show the zones and the 1964 historical story instead of a scenario.

---

## Turning the atlas into a guide

### 10. Guided story mode

**What it teaches:** turns the map into something you learn from, not just look at.

- **How it works:** a tour is a list of steps; each step sets the visible layers, timeline position and speed, camera position, and a short caption. Tours are stored as JSON so new ones need no code.
- **First tours:**
  - The 1938 Bloedel fire
  - The 1946 earthquake and why Cascadia matters
  - Why Duncan's crime index is high
  - The West Coast vs. the Saanich Peninsula
  - Victoria vs. Tofino: rising and falling seas (after item 6 in the build order)
- **UI:** a "Tours" button, a caption card with next/back, and an exit that returns to free exploration.
- **Watch out for:** every factual claim in a caption needs a source; add a "source" field to each step.

### 11. Ongoing costs: property tax and rent

**What it teaches:** the cheapest towns to buy in aren't always the cheapest to live in.

- **Data:** municipal property tax rates from BC Local Government Statistics *(verify: schedule number and format)*; average rents from CMHC's Rental Market Survey *(verify: may need a manual export, as CMHC has no simple open API)*.
- **Town Report:** estimated annual property tax on the town's median-priced home; average rent for comparison.
- **Town Finder:** fold into *Affordability*, or add *Low ongoing costs*.

---

## Gulf and Discovery islands

✅ **Built.** The shortlisted islands (Salt Spring, Galiano, Thetis, Gabriola, Lasqueti, Denman, Quadra) are `ISLAND_COMMUNITIES` in `scripts/municipalities.mjs`, merged into one MultiPolygon outline so every spatial source clips to them. Per-place joins: 2021 Census dissemination areas (StatCan boundary service + Census Profile API) for population; rural RCMP detachments for crime.

✅ **Island sale prices**. BC Assessment and the realtor boards publish nothing finer than "Gulf Islands" or rural areas, so each island gets its own level from the 2021 Census instead: the owner-weighted average home value over its dissemination areas, scaled by the median ratio of transfer-tax medians to census values across the municipalities (both around census day). Its rural jurisdiction's sales (Gulf Islands Rural, Duncan Rural, Nanaimo Rural, Courtenay Rural, Campbell River Rural) carry it forward month by month, so the trend is the rural area's. Checked against BC Assessment's 2026 single-family medians: Gabriola about $610K vs $708K assessed, Denman $829K vs $796K (the atlas figure covers all transfers, land included, so it isn't a like-for-like match).

✅ **Ferry dependence** is a Town Finder factor (*Not ferry-dependent*, weight 1) and a Town Report line. Weekday sailings, the last boat home and crossing time are transcribed by hand from BC Ferries' fall–winter 2026 schedules and Western Pacific Marine's Lasqueti timetable into `scripts/municipalities.mjs` (BC Ferries' site is behind a queue page, so the pipeline can't fetch it). Alert Bay is included. The ER factor now adds half the gap between sailings instead of a flat 30 minutes.

✅ **Ferry timetables from a feed.** The `ferries` stage (`scripts/ferries.mjs`) reads BC Ferries' official GTFS feed (published by Trillium Solutions), chains the feed's per-leg trips back into whole runs, and counts each island's weekday sailings to Vancouver Island, last boat home, shortest crossing and route summary. It takes the most common result over the weekdays of the next two weeks, so holidays don't count. Results match the hand-typed fall 2026 figures, except where the hand-typed ones were off or out of date: Salt Spring's last boat home is 22:00 from Crofton (not 21:00) and its shortest crossing 20 min (not 25), and Quadra has 28 sailings (not 27). Only Lasqueti (Western Pacific Marine, no feed) is still typed by hand. The current feed runs to 31 March 2027; after that the stage fails with a clear message until BC Ferries publishes the next season.

Still open:
- **Lasqueti's timetable** is still typed by hand; re-read it when Western Pacific Marine changes seasons.
- **Population trend**: dissemination-area counts are 2021 only. 2016 and 2026 Census counts by island would give growth.

## Smaller polish ideas

- Shareable links: put the focused layer, year and selected town in the URL so a view can be bookmarked or sent.
- A side-by-side "compare two towns" view in the Town Report.
- A "download this data" button on each panel, for anyone who wants to check the numbers.
