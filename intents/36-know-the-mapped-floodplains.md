# 36 — Know the mapped floodplains

## Intent
As someone looking at riverside towns and acreages, I want to see where the province mapped the rivers to flood,
how old each map is, and how much of a town or parcel lies inside one, so that I can avoid building in a floodplain
and know when I need to ask for a newer map.

## Where
Layer menu → *Hazard & climate outlook* → **Floodplains** (after *Tsunami zones*). A static layer
([02](02-travel-through-time.md)). Also in the Town Report ([19](19-read-a-town-report.md)), the Town Finder
([20](20-rank-towns.md)) and Land Finder ([22](22-search-for-land.md), [23](23-inspect-and-shortlist-a-parcel.md)).
Linked both ways with *River floods* ([07](07-see-river-floods.md)).

## Inputs & controls
| Control | Effect |
|---|---|
| Hover / click a floodplain area | Tooltip (study, year mapped, years since, area); a click opens the study's details panel. |
| Click a study in the panel's list | Opens the same details panel and flies to it. |
| Click a town dot or a town in the panel's ranking | Opens the Town Report. |
| **≋ River floods** (panel) / *Show it on the map* (study details) | Switches to, or adds, the River floods layer with the gauges on that river. |

## Behaviour (as implemented)
- **Floodplains**: BC's designated 200-year floodplains (a 0.5% chance of flooding in any year) on the island's
  mapped rivers and lakes, filled blue; the one alluvial fan in the data (Oyster River) in violet. Ground a study
  left out of its floodplain (a dry island near Duncan) is drawn as a hole and never counts as inside.
- **Study limits**: dashed gold lines where each study stopped mapping.
- **Locator rings** round each study, so the small areas can be found at island scale; town dots (while picked)
  are labelled with the share of their ground inside a floodplain.
- **Panel**: studies, years mapped (1978–1997), hectares mapped, towns with floodplain within 2 km; a callout that
  unmapped is not safe and the maps are old (creeks, shores and the Gulf Islands have none; newer regional studies
  aren't open data, so ask the regional district for the current map and flood construction level); a button to
  River floods; the studies oldest first, each with its map-sheet titles, drawing number, report link and the
  record peak of the river gauges on that river; towns ranked by share of ground within 2 km in a floodplain (towns
  with none within 5 km left out); how the share is measured.
- **Study details**: drawing number, year designated (or published), years since, hectares, map sheets; what the
  blue area means, why an old map may be wrong, an alluvial-fan note where there is one, the river's gauge record;
  the EcoCat report and the catalogue as sources. *Show it on the map* turns on Floodplains and River floods.
- **Town Report**: *Mapped floodplain*: the share of the ground within 2 km of the centre (sea left out) inside a
  mapped floodplain and which study; or the nearest mapped floodplain within 5 km; or "no river near here was
  mapped, which is not the same as safe". A button opens the layer.
- **Town Finder**: *Out of mapped floodplains* (weight 0 by default): less of the ground within 2 km inside a mapped
  floodplain is better.
- **Land Finder → Safety → Mapped floodplain**: *Room to build outside* (the brief's default: at least 1 acre of the
  parcel outside), *Fully outside*, or *Any*. The parcel report shows the share inside, the study and its year, and
  the acres outside it.

## Acceptance criteria
- `npm run data flood` from an empty `.cache/flood` writes `flood.json`, `flood-map.json` and `land-flood.json`
  without touching `land.json`.
- Only polygons on the atlas's islands are kept (no Squamish, Whistler or Lillooet floodplains).
- Every study shows its year; every place without a mapped floodplain says unmapped is not the same as safe.
- If `land-flood.json` is missing or doesn't match `land.json`'s parcels, Land Finder falls back to `land.json`'s
  yes/no floodplain column (any overlap counts as the whole parcel) and says so.

## Decisions
- **Province's maps only.** Searches for newer regional and municipal flood mapping (Cowichan Valley, Comox Valley,
  Strathcona/Campbell River, Nanaimo, North Cowichan) found only viewer-only web maps or services without an open
  licence, several reusing the provincial layer. The panel points to the regional district in words instead.
- **Default weight 0** in the Town Finder: with so few rivers mapped, a high score mostly means "not mapped".
- **Parcel values in their own file**, keyed by `land.json`'s parcel order and checked with a hash of its PIDs.

## Limits
- The maps date from 1978 to 1997 and are digitized from paper 1:5,000 sheets; rivers, dikes and climate have
  changed since.
- Only 17 studies cover the islands; creeks, coastal storm surge and sea-level rise are not mapped here.
- The town share counts the ground within 2 km of the centre, including river channels where the maps draw them.
- Gauge records are matched to a study by river name (within 25 km), else the nearest gauge within 8 km.

## Source
`scripts/flood.mjs` (`flood` stage), `src/flood.ts` (`floodLayer`, `floodTownRow`, `studyGauges`), `src/metrics.ts`
(`flood` metric and criterion), `src/land.ts` (`loadFlood`, `renderFlood`, `floodTile`), `public/data/flood.json`,
`flood-map.json`, `land-flood.json`.
