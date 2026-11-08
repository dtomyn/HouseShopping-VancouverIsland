# 22 — Search every large parcel for the land we want

## Intent
As a buyer looking for acreage, I want to filter every large private parcel on the islands by what we need
(size, water, reach, quiet, safety) and see how each requirement narrows the field, so that I find the few
places that fit and understand which wish is costing the most.

## Where
Top-right **Land Finder** button (or `#land` in the URL). It replaces the map's layers with the parcels.

## Inputs & controls
| Section | Filters |
|---|---|
| The land | Size (5–640 acres, log scale), gentle ground (average slope), farmland reserve (either / avoid / only), island (anywhere / Vancouver Island / small islands) |
| Waterfront | Ocean, lake or river (any combination); frontage length, or distance to water |
| Within reach | Drive minutes to the nearest clinic or hospital (or 24/7 ER only), grocery store and gas station |
| Quiet | Distance from the parcel's quietest spot to a busy road; from airports and float bases; from industry and quarries |
| Safety | Wildfire threat rating on or within 500 m; wildfire starts within 5 km since 1990; avoid mapped floodplains; highest ground above sea level; earthquake shaking |
| Water supply | Median yield and median depth of the registered wells within 1 km; share of them under 2 US gallons a minute; over a mapped aquifer (all off by default; [29](29-know-the-well-water-under-a-place.md)) |
| Trails & waterfalls | Km of footpath within 3 km; distance to the nearest waterfall (both off by default) |
| Budget | Applies to shortlisted parcels you've given an asking price ([23](23-inspect-and-shortlist-a-parcel.md)) |
| Presets | **★ Our brief** (10+ acres, waterfront, within 45 min of care, groceries and gas, quiet and safe) and **Show everything** |

## Behaviour (as implemented)
- About 29,000 private parcels of 5+ acres from ParcelMap BC, with every measure precomputed by the data stage.
- Behind each slider is a **histogram of the parcels that value would let through given every other filter**
  (a crossfilter), so you can see what loosening one requirement would gain.
- A **funnel** along the bottom shows how each stage (size, water, reach, quiet, safe, wells, trails, place) narrows the
  island, and which one cuts the most.
- The count of matches updates live; matches glow on the map, numbered by rank, and the list shows the top 80.
- Matches are ranked by a 0–100 score of how comfortably they clear the bar: size 15%, water 20%, reach 20%, quiet
  15%, safety 22%, sun 8%.
- Filters are saved in the browser.

## Acceptance criteria
- Moving a slider to a value gives the match count its histogram showed for that value.
- Show everything matches every parcel; Our brief restores the starting filters.
- Reloading the page keeps the filters.

## Limits
- BC publishes no per-parcel prices; the budget relies on asking prices you add.
- Floodplain maps are mostly from the 1980s–90s and not every river is mapped.
- A parcel with no tested well within 1 km drops out when a well yield is required.

## Source
`src/land.ts` (`BRIEF`, `LOOSE`, `parts`, `scoreOf`, filter rail, funnel), `scripts/land.mjs`,
`public/data/land.json` from the `land` stage; well prospects from `public/data/land-wells.json` (the `wells` stage),
loaded if present.
