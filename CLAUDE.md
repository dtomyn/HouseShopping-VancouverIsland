# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Island Atlas: a static, no-backend Vite + TypeScript web app that animates a century of Vancouver Island open data on a 3D map (MapLibre basemap + deck.gl layers + d3 charts). Live at <https://dtomyn.github.io/HouseShopping-VancouverIsland/>; deployed by `.github/workflows/deploy.yml` (Node 22) on push to `main`.

## Commands

```bash
npm run dev               # http://localhost:5173 (.claude/launch.json has preview configs)
npm run build             # tsc --noEmit + vite build: the only automated check (no tests, no linter)
npm run preview           # serve dist/ at http://localhost:4173
npm run data [stage…]     # rebuild public/data/*.json from the original sources
```

Data stages (in run order): `island ferries fires quakes rivers climate normals population housing crime hospitals seismic smoke future trails internet land wells tsunami`. Raw downloads cache in `.cache/`; a failing source keeps its old JSON and records the error in `public/data/manifest.json` (shown in the app's Data & sources view). `public/data/` is committed, so the app runs without the pipeline.

Videos (Windows only, needs Edge + `.venv` with Kokoro; see README):

```bash
.venv/Scripts/python.exe video/render.py --check --film all,main,trails   # fill every narration line from the data, no filming
.venv/Scripts/python.exe video/render.py --film layer-fires --video-only  # one film's 1440p master (+ captions, script, youtube.txt)
```

## Rules for this repo

- `main` is protected: work on a branch and open a PR.
- All data comes from `npm run data` stages, never manual downloads or hand-edited JSON (the only hand-typed data is in `scripts/municipalities.mjs`). A data change must work from an empty `.cache/`.
- Anything from outside the code (OSM names, quake places, data strings) goes through `esc()` / `safeUrl()` in `src/html.ts` before reaching `innerHTML`. The production build ships a CSP (`vite.config.ts`, build only): scripts only from the site itself; images and fetches from any `https:` host.
- Explainer videos render at 1440p (2560×1440) at most; don't go higher.
- `MAP-ATLAS-BLUEPRINT.md` describes the app's conventions for building other atlases (layer menu rules, event panels, film structure). When you change one of those behaviours, update the blueprint and the README with it.
- `intents/` holds one file per user intent, written as implemented (Intent, Where, Inputs & controls, Behaviour, Acceptance criteria, Limits, Source). When a change alters what a user can do, update the matching intent, or add one and list it in `intents/README.md`. Ideas not yet built go in `intents/proposed/`.

## Architecture

**`src/main.ts`** owns all app state and wiring:
- **`state`:**
  - `visible`: the layers switched on, exactly what's drawn;
  - `focused`: the active layer, whose story is in the panel and whose timeline is shown; `'island'` means none;
  - `timeLayer`: the timeline's owner;
  - `mode`: `layer | town | finder | land | event`;
  - `time`, `playing`.
- **Frame loop:** a `requestAnimationFrame` loop advances time, fires timeline events crossed (the ticker plus a map beacon), and rebuilds the deck.gl layer list every frame from each visible layer's `build(ctx)`. Flat layers whose id matches `/scars|embers|base|stems/` are inserted under the basemap labels.
- **Layer menu semantics:** `setLayerOn(id, on)` is the switch, `focus(id, keepPanel?)` makes a layer active (switching it on), and `clearMap()` turns everything off. Nothing else mutates `visible`.
- **Click routing (`onClick`):**
  1. the owning layer's `click(info)`, used by trails;
  2. a town key on the object (a dot, or a town's column on any layer) opens `openTown`;
  3. otherwise the layer's `describe(info)`, or `fromTooltip` from its tooltip, opens `openEvent`.
- **Side panel:** each view swaps the panel via `swapPanel`: `showLayerPanel`, `openTown`, `openFinder`, `openLandFinder`, `openTrailView`, `openEvent`.
- **`?film`:** with this in the URL, `window.atlas` exposes state and these functions to the video renderer.

**`src/layers.ts`** holds the `AtlasLayer` contract and every data layer except trails, internet and land:
- **The contract:**
  - `id`, `range`, `static`;
  - `build(ctx)` returns the deck layers;
  - `spark()` draws the timeline sparkline, and `events()` returns timeline moments;
  - `panel(el, ctx)` renders the story panel and returns `{ update }`;
  - `tooltip(info)` returns HTML;
  - optional `describe(info)` and `click(info)`.
- `buildLayers()` lists them; menu order comes from `LAYER_GROUPS` in main.
- **Events:** `AtlasEvent` (with `TimedEvent` when `t` is set) is the one shape used for timeline events, `CURATED_EVENTS` and clicked map features. Optional fields (`stats`, `sections`, `image`, `sources`, `layers`, `kind`, `detail(el)`) deepen the panel without touching its code.
- **Tooltip format:** tooltips must keep `<b>Title</b>` plus `<span class="tk">label</span> <span class="tv">value</span>` lines. `fromTooltip` turns that into a details panel for layers without `describe`, and main appends "Click for details" unless the tooltip mentions clicking.

**Other modules:**
- **`src/events.ts`:** `renderEventPanel`, the detail view for events and map features; date-based context (also happening, previous and next) appears only when `t` is set. Also `momentsList` and `fromTooltip`.
- **`src/trails.ts` + `src/trailcards.ts`:** the trails layer with its own panel views (`overview | route | fall | path`) and 3D modes (route flight, waterfall orbit, waterfall tour) on MapLibre terrain with Esri imagery. During 3D modes, `trailsCinema()` makes main stop drawing deck layers. Footpath elevations are sampled client-side from Terrarium tiles. `trailcards.ts` is pure HTML/SVG string builders.
- **`src/internet.ts`:** the Internet & cell layer (ISED broadband hexagons + Ookla speeds by quarter) and the `townNet` / `parcelNet` lookups used by metrics and Land Finder.
- **`src/tsunami.ts`:** the Tsunami zones layer (static). Its shapes and low-ground cells (`tsunami-map.json`) load the first time it's shown; the wave sweep runs off `ctx.clock`. Its per-parcel values live in `land-tsunami.json` (keyed to `land.json`'s order by a PID hash), which `src/land.ts` loads optionally.
- **`src/land.ts`:** Land Finder, a separate `mode` with its own deck layers, filters and panel, built on `public/data/land.json`.
- **`src/panels.ts` + `src/metrics.ts`:**
  - `townMetrics(data)` computes every per-town number, consumed by the Town Report, the Town Finder (`CRITERIA` weights) and Land Finder.
  - Home prices go through `trailingMedianPrice` in `src/data.ts`, which ignores zero valuations.
- **`src/data.ts`:** `loadAll()` fetches `public/data/*.json` and holds the shared types and formatters (`fmt`, `km`, `MONTHS`). **`src/sources.ts`:** the Data & sources view.

**Data pipeline:** `scripts/fetch-data.mjs` holds one async function per stage in `SOURCES`, clips to the island's bounding box, and writes compact JSON. The bigger stages live in `scripts/trails.mjs`, `land.mjs`, `ferries.mjs` and `internet.mjs` (range-reads only the island's rows of Ookla's global parquet files through `hyparquet`). `scripts/municipalities.mjs` lists the 43 towns and islands. The smoke stage streams FTP files through `curl`.

**Videos (`video/`):**
- **How it renders:** `render.py` serves `dist/` and `video/stage/` from one origin, opens the stage in headless Edge with a persistent profile (`video/out/browser-profile`), and steps a virtual clock one frame at a time. It runs a film's scenes (`run(f)` functions calling the `Film` API) and muxes the narration (Kokoro, cached by line text in `video/out/vo`).
- **The films:**
  - `storyboard.py`: the how-to;
  - `storyboard_trails.py`: Trails & waterfalls;
  - `storyboard_layers.py`: a film per layer, plus the overview. Both are built at render time from the app's own layer list, read by `layer_facts.js` (`prepare(found)` hook). A layer with no `SPECS` entry gets a generic film.
- **Gotchas:**
  - Only one render can run at a time, because of the shared browser profile.
  - A running batch keeps the film modules it loaded, so edits apply only to later runs.
  - `render.py` runs `npm run build` unless given `--no-build`, and films use `dist/`, so rebuild after app changes.
  - Film steps target app CSS selectors (`#panel .tr-fly`, `.ev[title*=…]`, `#event-ticker`): when you rename UI, update the films and run `--check`.

## Verifying in the browser

Use the preview tools with `.claude/launch.json` (`island-atlas` on port 5173). Load `/?film` to get `window.atlas` for scripted setup: `atlas.clearMap()`, `atlas.focus('fires')`, `atlas.setTime(1946.5)`, `atlas.map.jumpTo(...)`.

When the browser pane is hidden, the map's frame loop is throttled: deck layers and picking go stale until a screenshot forces a frame. Take a screenshot before trusting `pickObject` or a visual check.

Quake markers sit below ground at their depth, so they only pick reliably on a pitched map.
