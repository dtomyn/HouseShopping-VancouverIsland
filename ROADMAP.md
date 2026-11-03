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
| 2 | [A century of logging](#6-a-century-of-logging) | Same BC WFS paging and the same "flare then scar" animation as wildfires; the most dramatic new visual | Small–medium |
| 3 | ✅ [Getting to a hospital](#1-getting-to-a-hospital) | The most important retirement factor missing today; adds the first "static" (non-timeline) layer | Medium |
| 4 | ✅ [Static-layer support](#static-layers) | Needed by items 3, 8 and 9; small refactor done once | Small |
| 5 | [Guided story mode](#10-guided-story-mode) | Best done once several layers exist, so tours can tie them together | Medium |
| 6 | [Sea level: Victoria vs. Tofino](#7-sea-level-victoria-vs-tofino) | Short, surprising story; small dataset; good first story-mode tour | Small–medium |
| 7 | ✅ [Wildfire smoke days](#4-wildfire-smoke-days) | Health-relevant; larger download to process | Medium |
| 8 | ✅ [Future climate (2030s–2050s)](#2-future-climate-2030s2050s) | High value, but projection data and uncertainty need careful presentation | Medium–large |
| 9 | ✅ [Earthquake shaking hazard](#5-earthquake-shaking-hazard) | Static layer that complements the quake history | Medium |
| 10 | [Tsunami zones and a Cascadia scenario](#9-tsunami-zones-and-a-cascadia-scenario) | Builds on items 4 and 9; arrival times must come from published modelling | Medium–large |
| 11 | [Ongoing costs: property tax and rent](#11-ongoing-costs-property-tax-and-rent) | Useful, but rent data may need a manual export step | Medium |
| 12 | [Indigenous territories and place names](#8-indigenous-territories-and-original-place-names) | Important, but needs the most care with sources, permissions and wording | Medium |

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

## Explaining the island's history

### 6. A century of logging

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

## Smaller polish ideas

- Shareable links: put the focused layer, year and selected town in the URL so a view can be bookmarked or sent.
- A side-by-side "compare two towns" view in the Town Report.
- A "download this data" button on each panel, for anyone who wants to check the numbers.
