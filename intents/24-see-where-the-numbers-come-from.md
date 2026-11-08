# 24 — See where every number comes from

## Intent
As someone about to make a big decision on this data, I want to see every source, how far back it reaches, how
much of it there is and when it was last refreshed, so that I can trust (or question) what the atlas shows.

## Where
Top-right **Data & sources** button, `S`, or `#sources` in the URL.

## Behaviour (as implemented)
- Every source is drawn as a **cedar round**: each wedge is a source, each ring a year from 1900 at the pith to today
  at the bark, lit as brightly as that source's own record for the year. Projections grow past the bark as a hatched
  halo out to 2070.
- Hovering a wedge or its card highlights the other; each card gives the publisher, dataset, the endpoint read, the
  licence, what the atlas works out from it, and **record counts counted from the loaded data** (not typed in).
- Each card shows its refresh status from the data manifest: "refreshed <date>", or "not available" with the last
  error when its stage failed.
- **See it on the map →** closes the view and picks that source's layer.
- Sources the atlas uses without a timeline (basemap, terrain, routing, imagery, OpenStreetMap) are listed as "bark".

## Acceptance criteria
- No count on a card is a literal: every one comes from `public/data`.
- A source whose stage failed shows its error rather than a stale "refreshed" date.

## Source
`src/sources.ts` (the cedar round, `SOURCES`, bark sources), `public/data/manifest.json`.
