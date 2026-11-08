# 07 — See when the rivers rise

## Intent
As someone looking at waterfront or valley land, I want to see how high each river runs year by year,
so that I can spot flood years and rivers that regularly run far above normal.

## Where
Layer menu → *History on the timeline* → **River floods**.

## Behaviour (as implemented)
- **Map**: each Water Survey of Canada gauge with 8+ years of record (64 of them) is a column whose height is that
  year's highest flow divided by the river's typical annual peak (median); colour ramps from below normal to
  2.5×+. Ripples mark years a river hit 1.5× or more.
- **Panel**: headline numbers for the current year (gauges at 1.5× or more, the biggest relative peak and its river),
  gauges with 8+ years, first year with 3+ gauges; the share of gauges at 1.5×+ per year; the most extreme peaks on
  record; the colour scale; a note that gauges measure flow, not flooded area.
- **Events**: island-wide high-water years (8+ gauges reporting and 40%+ of them at 1.5×+).
- **Details**: click a gauge for its full record and chart ([03](03-get-details-on-anything.md)).
- **Elsewhere**: Town Report names the nearest river and how often it reached 1.5× its normal peak.

## Limits
High water is not flooding: check regional floodplain maps for a specific property. The panel links to
*Floodplains* ([36](36-know-the-mapped-floodplains.md)), BC's designated floodplain maps.

## Source
`src/layers.ts` (`riversLayer`), `public/data/rivers.json` from the `rivers` stage.
