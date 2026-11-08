# 06 — See the island's earthquakes in 3D

## Intent
As someone weighing earthquake risk, I want to see where and how deep quakes have struck around the island,
so that I understand the Cascadia setting and the island's real seismic record.

## Where
Layer menu → *History on the timeline* → **Earthquakes**.

## Behaviour (as implemented)
- **Map**: every M2.5+ quake since 1900 (USGS catalogue, a wide box including offshore Cascadia) drawn at its true
  location and **depth, exaggerated ×3**, below the surface, with a stem up to the ground and a shockwave ripple
  when the timeline crosses it. Colour encodes depth. Tilting the map shows them underground.
- **Panel**: headline numbers (quakes in the current year, its largest, the totals since 1900, M4+ count);
  magnitude over time; a depth legend; a note that the great Cascadia earthquake of January 1700 (~M9) predates the
  record, and that the apparent rise in small quakes after the 1970s reflects better seismometers.
- **Events**: M6.3+ quakes within 160 km of a town, including the 1946 Vancouver Island earthquake.
- **Details**: click a quake ([03](03-get-details-on-anything.md)).
- **Elsewhere**: Town Report counts felt-size (M4+) quakes within 75 km since 1970; the Town Finder's
  *Low quake activity* criterion uses it but is off by default, because the hazard model is the better guide
  ([13](13-know-how-hard-the-ground-could-shake.md)).

## Limits
Quakes sit below ground, so they pick reliably for hover and click only on a tilted map.

## Source
`src/layers.ts` (`quakesLayer`), `public/data/quakes.json` from the `quakes` stage.
