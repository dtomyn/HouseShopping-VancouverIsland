# 19 — Read a town's report card

## Intent
As someone comparing towns, I want everything the atlas knows about one place on a single card, so that I can
judge it on prices, safety, hazards, climate, care and the outdoors at once.

## Where
Click any town dot (shown whenever no town-column layer is on), a town's column on any layer, a town in a ranking,
or a "closest towns" link in any details panel.

## Behaviour (as implemented)
- The map flies to the town; the panel shows its regional district and a card of metrics, each with its source and
  the area it covers:
  - median sale value (estimated for islands) and 5-year change; population and growth; share aged 65+;
  - Crime Severity Index; wildfire starts and area burned nearby; felt-size quakes nearby; shaking hazard;
    tsunami notification zone and low coastal ground nearby ([30](30-know-where-a-tsunami-could-reach.md));
    share of the ground within 2 km in a mapped floodplain and which study, or the nearest one
    ([36](36-know-the-mapped-floodplains.md)); the share of tested homes over the radon guideline in the town's
    health area, with the sample size ([37](37-check-radon.md));
  - climate (nearest station, warming trend); sunshine, rain days, frost days and snowfall from the 1981–2010
    normals; smoky days a year;
  - the drive to the nearest 24/7 emergency room (and a closer limited-hours option); for islands, the ferry
    (sailings a day, last boat home, crossing time);
  - the nearest river and how often it reached 1.5× its normal peak;
  - "By the 2050s" climate projections with model ranges;
  - trails and waterfalls nearby, each opening on the map;
  - water access: straight-line distance to the nearest beach, boat launch and moorage, and counts within 10 km
    ([33](33-get-on-the-water.md)); camping nearby: the nearest campground and park campground and the count within
    25 km ([34](34-find-a-campground.md)), each with a button that opens its layer;
  - wells nearby: median depth and yield and the share of low-yield wells, within 5 km (or the whole island for the
    small islands), with a chart of those wells as drill holes ([29](29-know-the-well-water-under-a-place.md)).
  - internet: measured home download within 5 km over the past year (and in 2019), the share of homes nearby
    offered 50/10 Mbps, and whether mobile service is reported ([28](28-check-internet-and-cell-coverage.md)).
  - logging and parks nearby: hectares logged within 5 km in the last 10 years, the share ever logged, approved or
    active cutblocks, the share in parks, and the nearest named parks, with a button that opens the Logging layer at
    today ([31](31-see-a-century-of-logging.md), [32](32-check-whats-next-door.md)).
- Charts of population (dashed = projection), median sale value and the crime index against BC.
- Opened from the Town Finder, it shows the town's rank and score.
- Close (×) returns to where it was opened from: the layer, the Town Finder, or the event that linked to it.

## Acceptance criteria
- Every town in `scripts/municipalities.mjs` has a report; missing figures say why (e.g. "no municipal police series").
- Distances are from the town centre.

## Limits
Hazard counts describe history, not a forecast: the card says to check official floodplain, tsunami and
wildfire-interface maps for any property.

## Source
`src/panels.ts` (`renderTownReport`, `outdoorsRow`, `ferryMetric`, `erMetric`), `src/logging.ts` (`loggingTownRow`), `src/outdoors.ts` (`waterTownRow`, `campingTownRow`), `src/metrics.ts` (`townMetrics`),
`src/main.ts` (`openTown`).
