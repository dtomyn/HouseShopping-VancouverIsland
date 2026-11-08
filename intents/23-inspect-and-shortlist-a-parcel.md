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
  gas station it relies on, with their names and minutes.
- The shortlist (parcels, notes, asking prices) is saved in the browser; the Shortlist tab lists them.

## Limits
Nothing about a parcel's ownership, zoning or listing status is known; links go to outside sites to check.

## Source
`src/land.ts` (parcel report, `drawRadar`, `setSatellite`, `shortlist`, `SHORT`).
