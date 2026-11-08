# 29 — Know the well water under a place

## Intent
As a buyer looking at rural land or a small island, I want to see how deep the wells go and how much water they give
around a town or a parcel, so that I know whether a well there is likely to supply a home before I fall for the land.

## Where
Layer menu → *History on the timeline* → **Wells & groundwater** (or `#wells` in the URL). Also the Town Report
([19](19-read-a-town-report.md)), the Land Finder's *Water supply* filters ([22](22-search-for-land.md)) and the
parcel report ([23](23-inspect-and-shortlist-a-parcel.md)).

## Inputs & controls
| Control | Effect |
|---|---|
| Depth × 10 / 30 / 100 | How much the wells' depth is exaggerated below the map (default ×30). |
| Aquifers switch | Shows or hides the mapped aquifers under the wells. |
| Timeline | Plays the wells being drilled, by construction year. |
| A row of *Typical well by area* | Opens that town's report. |

## Behaviour (as implemented)
- **Map**: every registered water-supply well on the islands (about 35,000 from BC's GWELLS registry; monitoring,
  geotechnical, dewatering and heat-exchange holes left out) drawn as a line from the ground **down to its real depth**,
  exaggerated, coloured by the yield the driller measured: ember red for a trickle, amber under 2 US gallons a minute,
  aqua and ice-white for plenty, grey when no yield was recorded. The bottom of each well is a dot sized by yield;
  **low-yield wells are hollow rings**. While the layer is active, a blue tick marks where the water stood in each
  hole. Tilted, the map shows a forest of drill holes beneath the island.
- **Timeline**: wells appear by construction date from 1900; each new well flashes down its hole and rings at the
  surface, so rural settlement spreads across the island as it plays. Wells with no recorded date join the map at today.
- **Aquifers**: the provincially mapped aquifers that reach the islands lie flat under the wells, coloured by
  productivity (high, moderate, low). They catch clicks only while this layer is active, so they don't swallow clicks
  meant for other layers.
- **Panel**: wells drilled by the current year, drilled that year, median depth and share of low-yield wells over the
  past decade; wells drilled each year (with a playhead); the yield legend; a callout on how much drier the small islands
  are (share of low-yield wells and median yield, small islands against Vancouver Island, and how many of their wells draw
  from fractured bedrock), all counted from the data; a table of every town and island ranked by median well depth with
  wells, median depth, median yield and share of low-yield wells (islands highlighted); the aquifers by productivity and
  how many are highly vulnerable; caveats; the source line.
- **Events**: the busiest drilling year, and the deepest well.
- **Details**: click a well for its depth, yield, water level and aquifer, how it compares with the wells within 2 km,
  its aquifer's description, the wells within 1 km drawn as drill holes, and a link to its GWELLS record. Click an
  aquifer for its material, productivity, vulnerability, demand and quality concerns, with a link to its GWELLS page.
- **Town Report**: median well depth (with the middle half), median yield (also in litres a minute) and the share of
  low-yield wells, within 5 km of the town centre, or every well on the island for the small islands; and a chart of
  those wells as drill holes, shallowest to deepest, coloured by yield, with the water level and the median marked.
- **Land Finder**: per parcel, the median yield and depth of the wells within 1 km, the share of them that were low
  yield, whether the parcel's centre is over a mapped aquifer, and how many wells are registered on its PID. These are
  the *Water supply* filters, and the parcel report shows them with a drill-hole chart of the wells within 1 km.

## Acceptance criteria
- `npm run data wells` works from an empty `.cache/`, writes `wells.json` and (when `land.json` exists)
  `land-wells.json`, and never touches `land.json`.
- Playing the timeline from 1900 adds wells year by year; at the end every well is on the map.
- At ×100 the wells reach further down than at ×10.
- The small-island callout and the table's figures match `wells.json`'s `summary` and `towns`.
- Every Town Report shows the wells row when there are wells nearby; Salt Spring's uses every well on Salt Spring.
- With the *Water supply* filters at Any, the Land Finder's matches are the same as without them.

## Decisions
- **Yields stay in US gallons a minute**, the unit GWELLS, drillers and listings in BC use, with litres a minute
  alongside; depths and water levels are converted from feet to metres like the rest of the atlas.
- **A yield of 0 counts as not recorded.** Legacy records use 0 for untested wells (well 1010 reads "ample supply" with a
  yield of 0), and dry holes are rarely registered as water-supply wells, so a 0 can't be read as dry.
- **1 January 1900 and 1950 are placeholder dates** in legacy records and count as undated.
- **Low yield is under 2 US gallons a minute**: below that a home usually needs a storage tank to get through the day.
- **Per-parcel figures live in their own file** (`land-wells.json`, in `land.json`'s order with PIDs to check it), so
  the wells stage can be re-run without rebuilding the Land Finder's parcels; the Land Finder matches by PID if the
  order has changed.

## Limits
- Yields are the driller's short test when each well was finished, not a long-term or late-summer supply.
- Drillers have only had to report every new well since 2016, so older wells, and the early timeline, are under-counted.
- Well locations are often approximate (the registry places some at the centre of the lot).
- Nearby wells are a guide to a new well's chances, not a promise; water quality isn't covered.

## Source
`src/wells.ts` (`wellsLayer`, `wellStrip`, `wellsTownRow`), `src/land.ts` (*Water supply* section, `wellsDetail`),
`src/panels.ts`, `scripts/wells.mjs`; `public/data/wells.json` and `public/data/land-wells.json` from the `wells` stage.
