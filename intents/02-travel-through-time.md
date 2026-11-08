# 02 — Travel through time

## Intent
As someone curious about the island's past, I want to play the years forward, pause, and jump to any year,
so that I can watch fires, quakes, floods, warming, growth and prices unfold and see how they line up.

## Where
The timeline along the bottom of the screen.

## Inputs & controls
| Control | Effect |
|---|---|
| ▶ / ❚❚ (or `Space`) | Play or pause. Playing from the end restarts at the start of the range. |
| Speed | ½, 1, 2, 4 or 8 years a second (default 2). |
| Slider | Drag to any moment in the picked layer's range. |
| `←` / `→` | Step back or forward one year (one month on monthly layers such as Home prices). Pauses playback. |
| Diamond markers | Key moments; click one to open it (see [04](04-read-the-story-of-a-moment.md)). |

## Behaviour (as implemented)
- The timeline belongs to the last picked **time-based** layer (`timeLayer`): its range sets the slider's ends, its
  `spark()` draws the bar sparkline behind the slider, and its events (plus the island-wide curated events within
  range) become the markers.
- Every time-based layer on the map is drawn at the same moment, so overlays stay in step.
- **Static layers** (Shaking hazard, Climate normals, Future climate, Hospital access, Trails & waterfalls) don't
  change over time. While one is picked the timeline dims, and a note says it doesn't change over time and which
  time-based layers on the map are still playing. With nothing picked it says "No history layer on the map" or
  "No layer picked".
- Picking a time-based layer whose range doesn't include the current year moves the timeline to its start.
- Playback stops at the end of the range.
- Crossing an event during playback shows it on the event ticker and sends a shockwave across the map at its place.

## Outputs
Year (and month, on monthly layers or at slow speeds) readout; the map and panel update every frame.

## Acceptance criteria
- Two time-based layers on the map always show the same year.
- `→` from a year boundary lands exactly on the next year (or month).
- Picking a static layer never moves the timeline.

## Source
`src/main.ts` (`setupTimeline`, `setTime`, `setPlaying`, `syncTimelineUI`, `drawSpark`, `drawEvents`,
`fireCrossedEvents`, `frame`), `index.html` (timeline markup).
