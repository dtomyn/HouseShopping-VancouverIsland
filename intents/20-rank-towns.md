# 20 — Rank the towns by what matters to me

## Intent
As a household deciding where to live, I want to weight what matters to us and see every town ranked,
so that a shortlist falls out of our own priorities rather than someone else's.

## Where
Top-right **Town Finder** button.

## Inputs & controls
| Control | Effect |
|---|---|
| 16 sliders, 0–5 | Weight of each criterion (0 = ignore). Each has a hint saying exactly what it measures. |
| Presets | *Balanced* (the defaults), *On a budget*, *Sun & safety*, *Quiet & low-risk*. |
| A town in the ranking | Opens its report ([19](19-read-a-town-report.md)); closing returns to the ranking. |
| × | Leaves the Town Finder. |

Criteria: Affordability, Low crime, Low wildfire exposure, Lower shaking hazard, Low tsunami exposure, Out of mapped floodplains (off by
default), Low quake activity (off by default), Mild & warm, Sunnier, Little snow & frost, Close to a hospital, Not ferry-dependent, Clean air, Mild
future summers, Trails & waterfalls nearby, Fast internet, Retiree community, Services & amenities.

## Behaviour (as implemented)
- Each criterion is turned into a **percentile rank** across the towns that have a value (robust to outliers; ties
  share their average rank; direction flipped where lower is better). A town's score is the weighted mean of its
  ranks over the criteria with weight > 0; towns missing a value are skipped for that criterion, not penalized.
- The ranking updates as a slider moves. The map shows every town as a 3D column, height and colour by score, with
  the top 10 labelled.
- Weights are saved in the browser and restored next time.

## Acceptance criteria
- With every weight at 0 except one, the order matches that criterion alone.
- Reloading the page keeps the weights.

## Decisions
- Past quake counts mostly track seismometer coverage and offshore faults, so *Low quake activity* starts at 0 and
  *Lower shaking hazard* (the official model) carries the weight.

## Source
`src/metrics.ts` (`CRITERIA`, `rankTowns`, `ferryBurden`, `erFerryWait`), `src/panels.ts` (`renderFinder`,
`loadWeights`, presets), `src/main.ts` (`openFinder`, finder columns in `render`).
