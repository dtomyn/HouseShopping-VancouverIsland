# 23 — Inspect a parcel and keep a shortlist

## Intent
As a buyer narrowing down land, I want a report on any parcel and a place to keep the ones I like with my notes and
the asking price, so that I can compare real candidates and check them against our budget.

## Where
Land Finder → a parcel in the **Matches** list or on the map; the **Shortlist** tab.

## Inputs & controls
| Control | Effect |
|---|---|
| ☆ Shortlist / ★ Shortlisted | Adds or removes the parcel. |
| Asking price, Notes | Kept with the shortlisted parcel; the price is checked against the Budget filter and shown as over or under budget. |
| ◐ Satellite | Shows satellite imagery of the land. |
| Listings near here ↗ | Opens realtor.ca's map at the parcel. |
| Google Maps ↗ | Opens satellite view at the parcel. |
| ‹ Matches / ‹ Shortlist | Back to the list. |

## Behaviour (as implemented)
- The parcel report: rank and score, PID, size, and every measure behind the filters; a **radar chart** of its
  strengths (size, water, reach, quiet, safety, sun); **drive-time arcs** on the map to the clinic, grocery store and
  gas station it relies on, with their names and minutes. Its Safety measures include **Tsunami**: the share of the
  parcel in a published hazard map or on low coastal ground, the notification zone, and the acres outside it
  ([30](30-know-where-a-tsunami-could-reach.md)).
- **Water access**: straight-line distance to the nearest beach or beach access, public boat launch and marina or
  public harbour on the parcel's own island, with their names ([33](33-get-on-the-water.md)).
- **Water supply**: the median yield and depth of the wells within 1 km, the share of them that were low yield, the
  mapped aquifer under it, a note when a well is registered on its PID, and those wells drawn as drill holes to their
  depth, coloured by yield ([29](29-know-the-well-water-under-a-place.md)).
- **Next door**: a ring of what surrounds the parcel out to 1 km in 16 directions (parks, Crown land, water, logging
  by age, approved or active cutblocks, private land), with each kind's share, and tiles for the nearest park, Crown
  land, the last logging nearby and planned logging ([32](32-check-whats-next-door.md)).
- The shortlist (parcels, notes, asking prices) is saved in the browser; the Shortlist tab lists them.

## Limits
Nothing about a parcel's ownership, zoning or listing status is known; links go to outside sites to check.

## Source
`src/land.ts` (parcel report, `drawRadar`, `wellsDetail`, `nextDoorDetail`, `setSatellite`, `shortlist`, `SHORT`), `src/wells.ts` (`wellStrip`), `src/nextdoor.ts` (`ringSvg`).
