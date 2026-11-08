# 18 — Fly a trail and orbit a waterfall in 3D

## Intent
As someone deciding whether a walk or a place is for me, I want to see the real terrain from above, so that I
understand the climbs, the valleys and the views before I go.

## Where
**Fly this trail in 3D** (route and footpath cards), **Orbit it in 3D** (waterfall card), **Waterfall tour** and
**Fly <longest route>** (overview), and the **Satellite** switch beside them.

## Inputs & controls
| Control | Effect |
|---|---|
| Flight panel ❚❚ / ▶, 1× 2× 4×, ✕ | Pause or resume, speed, end the flight. `Space` pauses, `Esc` ends. Drag to look around. |
| Orbit: Back to the map | Ends the orbit (`Esc` too). Dragging, scrolling or touching stops the spin. |
| Tour: ‹ ❚❚ › Details ✕ | Previous, pause, next, open the fall's card, end (arrow keys and `Esc` work too). |
| Satellite | Lays Esri imagery under the map's own layers; stays on across cards and flights until switched off or the Trails layer is left. |

## Behaviour (as implemented)
- 3D modes switch on MapLibre terrain (1.5–1.6× exaggeration) with satellite imagery and hide the other UI; deck.gl
  layers stand down while they run.
- **Flight**: a hiker marker follows the route's ordered line; the camera keeps behind and above it, looking ahead.
  About 25 s for a short walk, longer for long routes, capped at two minutes. The panel counts distance, elevation,
  metres climbed and walking time, with the profile and a playhead. At the end the camera pulls back to frame the route.
- **Orbit**: flies to the fall and circles it slowly, with a label card and ripples.
- **Tour**: 12 photographed falls, each with a photo card; the camera flies in, circles, and moves on every 6.5 s.
- Markers stay fully visible when the terrain hides their anchor point.
- Respects reduced-motion settings (no spin, instant moves).

## Limits
Imagery and terrain stream from public tile servers, so 3D needs a good connection.

## Source
`src/trails.ts` (`startFlight`, `startOrbit`, `startTour`, `terrainOn`, `imageryOn`, `setTrailSatellite`,
`leaveTrails`, `stopAll`).
