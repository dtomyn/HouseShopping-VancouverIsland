# 16 — Know how far emergency care is

## Intent
As someone planning for later life, I want to know the real drive from each town to a 24/7 emergency room,
so that I don't choose a place that's dangerously far from care.

## Where
Layer menu → *Towns & living* → **Hospital access**. A static layer.

## Behaviour (as implemented)
- **Map**: the 17 hospitals and emergency rooms Island Health lists in HealthLinkBC, with 24/7 ERs highlighted
  (others marked as call-ahead or limited hours). Town columns are the typical drive from the town centre to its
  nearest **24/7** ER, routed on OpenStreetMap roads by OSRM.
- Road routes avoid ferries wherever a road route exists. Islands without their own ER use the ferry route; the time
  covers the crossing but not the wait for a sailing.
- Hovering a town shows its route(s) on the map; clicking it opens its report.
- **Panel**: headline numbers (24/7 ERs, the median town's drive, towns within 20 minutes, the farthest town); every
  town ranked by drive.
- **Elsewhere**: Town Report's *Emergency room* line (with a closer limited-hours option if there is one); the Town
  Finder's *Close to a hospital* criterion adds the average wait for a sailing to trips that need a ferry.

## Limits
Drive times are free-flow estimates from the public OSRM demo router (no traffic, weather or closures). If routing
fails, straight-line distance is shown instead and labelled.

## Source
`src/layers.ts` (`hospitalsLayer`), `src/metrics.ts` (`townMetrics` → `er`, `care`; `erFerryWait`),
`public/data/hospitals.json` from the `hospitals` stage.
