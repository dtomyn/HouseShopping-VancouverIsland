# 26 — Use it privately, with nothing to install

## Intent
As anyone, I want to open the atlas from a link and use it without an account or install, knowing my choices stay
on my machine, so that I can explore freely and share it easily.

## Where
<https://dtomyn.github.io/HouseShopping-VancouverIsland/>, or a local copy (`npm run dev`).

## Behaviour (as implemented)
- **Fully static**: HTML, JavaScript and JSON on GitHub Pages; no backend, database or API key. All the atlas's own
  data ships with the site (`public/data`, about 10 MB, plus the footpath network loaded when Trails is first used).
- **Only map imagery is fetched from outside**: basemap, terrain, satellite tiles and waterfall photos from public
  tile servers and Wikimedia.
- **What's remembered stays in the browser** (`localStorage`): Town Finder weights, Land Finder filters, the
  shortlist with its notes and prices, and the trip planner's settings. Nothing is sent anywhere, with one exception
  the user starts: **Plan the route** on the shortlist ([42](42-plan-a-viewing-trip.md)) sends the shortlisted
  parcels' coordinates and the start town to the public OSRM router to work out the drives, and says so beside the
  button. Notes and prices are never sent.
- **Outside text can't run code**: names and strings from crowd-edited or outside data go through `esc()`, and links
  through `safeUrl()` (http/https only). The production build carries a Content-Security-Policy that allows scripts
  only from the site itself.
- **The build works from any path** (relative `base`), so forks deploy to their own Pages with the included workflow.

## Acceptance criteria
- With the browser's network panel open, no request carries a user's weights, filters, notes or prices, and the
  shortlist's coordinates go out only to `router.project-osrm.org`, only after *Plan the route* is pressed.
- Clearing site data resets every saved choice to its default.

## Limits
An internet connection is still needed for map imagery; without it the data layers draw over a blank map.

## Source
`vite.config.ts` (CSP, `base`), `src/html.ts` (`esc`, `safeUrl`), `src/panels.ts` (`island-atlas:weights`),
`src/land.ts` (`island-atlas:land-filters`, `island-atlas:shortlist`), `src/trip.ts` (`island-atlas:trip`, the
router call), `.github/workflows/deploy.yml`.
