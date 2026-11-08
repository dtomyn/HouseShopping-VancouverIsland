# 03 — Get details on anything on the map

## Intent
As someone exploring, I want every dot, column, line or patch on the map to open a proper details view when I
click it (not just a hover bubble), so that I can always dig further into what I'm looking at.

## Where
Anywhere on the map. Hover shows a tooltip ending with **Click for details**; a click opens the side panel.

## Behaviour (as implemented)
A click is handled in this order:
1. The owning layer's own `click` (Trails: routes, waterfalls and footpaths open trail cards, see [17](17-find-hikes-and-waterfalls.md)).
2. Anything belonging to a town (its dot, or its column on any layer) opens the **Town Report** ([19](19-read-a-town-report.md)).
3. Otherwise the layer's `describe(info)` builds the panel; a layer without one gets a panel built from its tooltip.

Rich descriptions (`describe`):
| Feature | Panel |
|---|---|
| Earthquake | Magnitude, depth, date, distance from the nearest atlas town; "How it compares" (the strongest few by rank, the rest by percentile) and a note on how depth affects shaking. The USGS place label is quoted, not used as the lead. |
| Mapped fire perimeter | Size, cause, rank among all mapped fires, year, nearest town. |
| Fire ignition | Start date, final size, cause, nearest town. |
| River gauge | Normal annual peak (m³/s), record and its year, years at 1.5× normal, area drained, and a chart of every year's peak against normal. |
| Weather station | 1961–1990 normal, last-decade average, warmest year, years of record, and a chart of every year against normal. |
| Air monitor | Smokiest season, full years of data, worst daily average, and a chart of smoky fire-season days per year. |

**Fallback** for every other feature (hospitals, normals stations, spots on the hazard and future-climate surfaces,
and any layer added later): the tooltip's bold line becomes the title, each `label value` pair becomes a headline
tile, and other lines become the description.

Every details panel (it is the event panel, [04](04-read-the-story-of-a-moment.md), for a record without a date
when it's a place) also offers the closest towns, **Show it on the map** and its sources. A moment (quake, fire)
moves the timeline to its date; a place (gauge, station) leaves the timeline alone.

## Acceptance criteria
- Every pickable feature of every layer opens a panel on click; none only shows a tooltip.
- Tooltips end with "Click for details" unless they already say what a click does (e.g. "Click for town report").
- Back returns to the panel the user came from.

## Limits
Full-coverage surfaces (Shaking hazard, Future climate) are clickable only while they're the picked layer, so they
don't swallow clicks meant for thin lines on other layers.

## Source
`src/main.ts` (`onClick`, `featureDetails`, `onHover`), `src/layers.ts` (`describe` on fires, quakes, rivers,
climate, smoke; `detailBars`, `isoDate`), `src/events.ts` (`fromTooltip`, `renderEventPanel`).
