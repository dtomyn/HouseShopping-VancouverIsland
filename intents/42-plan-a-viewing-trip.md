# 42 — Plan a day of viewings

## Intent
As someone going to see the parcels on my shortlist, I want them put in a sensible driving order from where I'm
starting, with arrival times, so that I can fit a day of viewings in (and see when it won't fit).

## Where
Land Finder ([22](22-search-for-land.md)) → **★ Shortlist** tab → **Plan a viewing trip**, under the shortlisted
parcels once there are two or more ([23](23-inspect-and-shortlist-a-parcel.md)).

## Inputs & controls
| Control | Effect |
|---|---|
| **Start from** | One of the atlas's 43 towns and islands; defaults to the one nearest the first shortlisted parcel. |
| **Leave at** | Departure time (default 09:30). |
| **Minutes at each** | Time spent at each parcel (default 45, 0–240). |
| **Back to the start** | Round trip (default) or end at the last parcel. |
| **⇢ Plan the route** / **↻ Re-plan** | Asks the router for the order and drives; the route is drawn on the map and fitted to the view. |
| **Open in Google Maps ↗** | The same order as a Google Maps directions link (start, up to nine stops in between, end). |
| **Copy the itinerary** | The plan as plain text on the clipboard. |

## Behaviour (as implemented)
- Uses up to 12 shortlisted parcels (their centre points), in the order the public OSRM demo router's *trip*
  service finds quickest from the start town (one-way trips end wherever is quickest).
- The itinerary lists the departure, each parcel with its arrival and leaving times and the drive to it (minutes,
  km), then the drive home for a round trip, and totals: driving time, distance and the time it all ends.
- A leg that uses a ferry is marked ⛴ and a note says the crossing is timed on the water only (no wait or
  schedule). A plan ending after 4:30 pm gets a note that it will be dark by then in late autumn and winter.
- The map draws the route in pink with a glow, the start as a ringed dot and the stops as numbered pink badges,
  while the shortlist is showing. Changing the shortlist drops a plan made for the old one.
- Settings are remembered in the browser (`island-atlas:trip`).
- **Privacy**: planning is the one place the atlas sends anything about the user's choices: the shortlisted
  parcels' coordinates and the start town go to `router.project-osrm.org`, only when *Plan the route* is pressed,
  and the panel says so. Notes and asking prices never leave the browser.

## Acceptance criteria
- With fewer than two shortlisted parcels, no planner is shown.
- Arrival times add each leg's drive and the minutes at each previous stop to the departure time.
- No request goes to the router until the button is pressed.
- The Google Maps link opens with the same order as the itinerary.

## Decisions
- **The OSRM demo router from the browser.** It is the router the atlas already uses for drive times; a static
  site has no server of its own to route on, and precomputing every pair of 29,000 parcels isn't possible.
- **Towns as start points.** Asking for the browser's location would add a permission prompt and send a home
  location; a town is close enough to plan a day.

## Limits
- Free-flow drive times on OpenStreetMap roads, to the parcel's centre snapped to the nearest mapped road: a big
  backcountry lot's centre can be on a logging road far from its gate.
- No traffic, ferry waits or sailing times; the public router has no service guarantee and is sometimes busy.

## Source
`src/trip.ts` (`renderTripPlanner`, `planTrip`, `tripLayers`), `src/land.ts` (the shortlist tab, `setLandTowns`).
