# 17 — Find hikes and waterfalls near a place

## Intent
As someone who wants an outdoor life, I want to see every trail and waterfall on the island and dig into any of
them, so that I can judge which towns put good walks and falls on my doorstep.

## Where
Layer menu → *Outdoors* → **Trails & waterfalls** (or `#trails` in the URL). A static layer.

## Behaviour (as implemented)
- **Map**: every mapped footpath (OpenStreetMap; about 6,300 km) as a glowing web with sparks for hikers moving
  along it; alpine paths in yellow. The 84 named hiking routes are bright lines coloured by effort (easy, moderate,
  hard, from length and climb by Naismith's rule plus any trail-difficulty tag). Waterfalls are beams of falling
  water, as tall as their drop where it's known, with labels for the named ones.
- **Overview panel**: totals; a **Waterfall tour** button and a 3D flight of the longest route
  ([18](18-fly-trails-and-orbit-waterfalls.md)); routes filtered by effort and sorted (featured, longest, most
  climbing, most waterfalls), each with a mini elevation profile; waterfalls with photos; more named falls; the
  towns closest to the outdoors.
- **Route card**: a satellite portrait of the route drawing itself in; distance, time, climbing, highest point; an
  elevation profile you can point along (a marker follows on the map); the grade mix and steepest kilometre; storeys
  of stairs, steps and calories; today's daylight with the latest start to finish before sunset; waterfalls along
  the way; more hikes nearby; closest towns; links (website, Wikipedia, OpenStreetMap, directions).
- **Waterfall card**: photo (or a satellite close-up); badges (height rank, how high up it sits, trail access); a
  height comparison with a person, a house, Niagara and the island's tallest when the drop is known; when its stream
  usually runs hardest (rain-fed vs snow-fed by elevation, a rule of thumb); routes that pass it; nearby falls.
- **Footpath card** (click any path): the same-named pieces nearby highlighted; length; elevation profile, climbing
  and time sampled from terrain tiles on the fly; the same grade, effort and daylight sections; nearby falls, hikes
  and towns. A footpath that is part of a named route opens the route instead.
- Clicks work whenever the layer is on the map, not only while it's picked.
- **Elsewhere**: Town Report's *Trails & waterfalls nearby*; the Town Finder's criterion; Land Finder's filters.

## Acceptance criteria
- Every card shows its closest towns, each opening the Town Report.
- A footpath card shows a profile within about a second, or says the terrain couldn't be read.

## Limits
OpenStreetMap is volunteer-mapped: trails can be closed, overgrown, private or seasonal. Effort and time are
estimates; elevations come from ~50 m terrain (routes) and ~12 m terrain (footpaths).

## Source
`src/trails.ts` (`trailsLayer`, `renderOverview`, `renderRoute`, `renderFall`, `renderPath`, `pathRoute`),
`src/trailcards.ts` (hero portraits, `gradeMix`, `effortTiles`, `daylightCard`, `heightCompare`, `flowCalendar`,
`elevationsAlong`), `public/data/trails.json`, `trails-net.json` from the `trails` stage.
