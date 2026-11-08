# 33 — Get on the water

## Intent
As someone retiring to the coast, I want to see where the beaches, boat launches, marinas and public harbours are,
and how far each town or parcel is from them, so that I can pick a place where a swim, a paddle or a boat is close.

## Where
- Layer menu → *Outdoors* → **Water access**. A static layer.
- Town Report → **Water access**.
- Land Finder → filter rail → **Outdoors** (*A beach nearby*, *A boat launch nearby*); a parcel's report →
  **Water access**.

## Inputs & controls
| Control | Effect |
|---|---|
| Kind chips in the panel (sea beach, lake or river beach, beach access, boat launch, marina, public harbour) | Show or hide that kind on the map. |
| Hover a marker | Tooltip: name (or "Unnamed …"), kind, harbour type and authority, access, fee, berths, surface, nearest town. |
| Click a marker | Details panel: what it is, fee, berths, fuel, pump-out and shore power where mapped, the harbour authority, and links to the website, the DFO harbour-authority listing and the OpenStreetMap feature. |
| Click a town in the ranking | Opens its Town Report. |
| Land Finder: *A beach nearby* (0.5–30 km, crossfilter histogram) | Keeps parcels within that straight-line distance of a mapped beach or beach access on their own island. Off (*Any*) by default. |
| Land Finder: *A boat launch nearby* (0.5–30 km) | The same for public boat launches. Off by default. |

## Behaviour (as implemented)
- The `water` stage takes from OpenStreetMap every `natural=beach`, `leisure=slipway`, `leisure=marina` and feature
  named "Beach Access" in the islands' box, drops private and no-access slipways, beaches and accesses (a private
  marina stays, marked private), and keeps those on Vancouver Island or a shortlisted island (within ~500 m of its
  shore) or within 3 km of a town centre (Alert Bay's Cormorant Island).
- A beach more than 1 km from the islands' coastline (or one named for a lake, river or creek and 300 m+ inland) is
  a lake or river beach.
- Fisheries and Oceans Canada's small craft harbours (core fishing, non-core fishing and recreational) are added; an
  OpenStreetMap marina within 300 m of one is merged into it, its name kept as "also called".
- Markers: sand dots for sea beaches, green dots for lake beaches, sand rings for beach accesses, ▲ boat launches,
  ◆ marinas, ■ public harbours.
- For every town the stage stores the nearest beach (or access), lake beach, boat launch and moorage (marina or
  public harbour), and counts within 10 km. A town on a small island only counts points on its own island.
- The panel shows counts, the kind chips, and the towns ranked by straight-line distance to the nearest boat launch,
  with their nearest beach and moorage.
- The Land Finder works out each parcel's nearest beach, boat launch and moorage in the browser from `water.json`, on
  the parcel's own island, and shows them as tiles in the parcel's report.

## Acceptance criteria
- About 960 points: ~455 sea beaches, ~110 lake beaches, ~65 beach accesses, ~185 boat launches, ~100 marinas and
  ~40 DFO harbours.
- 36 of 43 towns have a boat launch within 5 km.
- With *A beach nearby* at 2 km about 11,000 of 29,000 parcels pass; *A boat launch nearby* at 5 km about 19,500.
- Without `water.json` the layer says to run `npm run data water`, the Town Report row is absent and the two Land
  Finder filters let every parcel through.

## Limits
- OpenStreetMap is volunteer-mapped: beaches and launches are well covered, but only beach accesses someone has named
  "Beach Access" appear; municipal beach-access inventories are not one open dataset.
- Distances are straight lines, not walking or driving routes, and say nothing of sand versus rock.
- "Public" is what the map says: launch fees, tide limits, trailer parking and marina waiting lists vary.
- The lake/sea split uses distance from a simplified coastline, so a few lagoon beaches may be sorted wrongly.

## Source
`scripts/outdoors.mjs` (`buildWater`), `src/outdoors.ts` (`waterLayer`, `waterTownRow`, `nearestFor`), `src/land.ts`
(`waterDetail`, the *Outdoors* rows); data `public/data/water.json` from the `water` stage.
