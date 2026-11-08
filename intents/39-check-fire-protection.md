# 39 — Check fire protection (and what it means for insurance)

## Intent
As someone looking at rural acreage, I want to know how far each parcel is from a fire hall by road, so that I can
tell which ones a home insurer would rate as protected and avoid falling for land I couldn't insure affordably.

## Where
Land Finder ([22](22-search-for-land.md)) → *Safety* → **Fire hall by road**, and the parcel report's *Safety* tiles
([23](23-inspect-and-shortlist-a-parcel.md)). Land Finder only: every town has its own hall, so there is no Town
Report row.

## Inputs & controls
| Control | Effect |
|---|---|
| **Within 8 km** / **Within 13 km** / **Any** (chips) | Keeps parcels whose road distance to the nearest fire hall on their own island is at most that; a parcel with no route counts as outside. *Any* (the default) lets every parcel through. |

## Behaviour (as implemented)
- **Data**: the `firehalls` stage takes every `amenity=fire_station` in OpenStreetMap on the atlas's islands (one
  point per hall; wildfire bases, forestry and airport crash crews dropped) and routes from each parcel's ~400 m
  cell to the four nearest halls on the same island with the OSRM demo router, keeping the shortest road distance,
  its drive time and the hall. Written to `land-fire.json`, aligned with `land.json` by order and checked with a
  hash of its PIDs.
- **Filter**: in the *Safe* funnel step. Without the file (or if it no longer lines up with `land.json`) every
  parcel passes and the row says how to build it.
- **Parcel report**: a *Fire hall* tile with the road distance, the hall's name and drive time, and the insurance
  reading: within 8 km "within the 8 km insurers use for a protected rating (if inside a fire protection area)";
  8–13 km "some insurers rate it semi-protected, ask before you buy"; past 13 km "usually rated unprotected, with
  higher premiums and fewer insurers". Green within 8 km, red past 13 km or with no route.
- **Map**: the selected parcel's arcs to care, groceries and gas gain a red arc to its fire hall, labelled with the
  distance and drive time.

## Acceptance criteria
- `npm run data firehalls` from an empty `.cache/firehalls` rebuilds `land-fire.json` (~270 KB) after `land`.
- The 8 km and 13 km lines match the tile's wording; a parcel with no route fails both chips.
- Halls on another island are never used, even when the router would cross by ferry.

## Decisions
- **OpenStreetMap halls, not a provincial layer.** The BC Data Catalogue has no open fire-hall or fire-protection-
  area layer (the candidates are "Access Only"), and regional districts publish their service areas unevenly.
- **Road distance, not straight line.** Insurers grade by the drive; a hall across an inlet can be 2 km away and
  25 km by road.
- **Default *Any*.** Turning it on would silently change everyone's saved brief.

## Limits
- Distance to a hall is only half of a protected rating: the house must also be inside a fire protection area
  (a service the local government pays for), and some insurers also want a hydrant or a water supply within reach.
  Neither is mapped here; ask the regional district and an insurer.
- OpenStreetMap may miss a small volunteer hall or keep a closed one; halls with no name show as "Fire hall".
- Routes start from a point within about 400 m of the parcel, snapped to the nearest mapped road; long private
  driveways aren't counted.

## Source
`scripts/firehalls.mjs` (`firehalls` stage), `src/land.ts` (`loadFire`, `renderFire`, `fireTile`, the fire arc in
`landLayers`), `public/data/land-fire.json`.
