# 31 — See a century of logging

## Intent
As someone choosing where to live, I want to watch where and when the island's forests were cut, how fast they grow
back and what is set aside for good, so that I understand today's landscape and what may happen to the hills around
a place.

## Where
Layer menu → *History on the timeline* → **Logging**. Also the Town Report's *See a century of logging on the map*
button, which opens it at today.

## Behaviour (as implemented)
- **Map**: every cutblock in BC's consolidated harvest record (about 49,000 on the islands, 1900 → today; about 42,000
  big enough to draw) appears in the year it was logged. A block being cut rises as a glowing column with a ring of "sawdust", then lies as bare
  ground (tan) for about 3 years, greens as it regrows (3–20 years), darkens to young forest (20–45 years) and then
  stays as a faint mark. The ageing is done on the GPU (stacked layers with soft time-filter ranges), so playback
  stays smooth. The shapes (about 4 MB) load the first time the layer is shown.
- **Today**: once the timeline reaches the current year, cutblocks approved on Crown forest tenures but not started
  (pink outline) and those being logged now (solid pink) pulse on the map.
- **Parks**: provincial parks, ecological reserves, protected areas, conservancies and national parks are drawn in
  teal throughout, to show what can't be cut.
- **Panel**: headline numbers for the current year (hectares logged, cutblocks, share of the islands' land logged at
  least once by then, and the decade so far or, at today, blocks on the books); hectares per year (bar chart with
  playhead); a per-decade strip that lights the current decade; the share of the islands logged at least once over
  time (line chart); callouts with the overall share, the busiest decade and year, what's on the books now and the
  park area; a legend; caveats; the source.
- **Events**: the five busiest years (with that year's area-weighted centre and a year-by-year chart), and a
  milestone each time another tenth of the islands' land has been logged at least once.
- **Details**: click a cutblock (year, area, % clearcut, years of regrowth, nearest town), an approved or active block
  (status, date, area, licensee, timber mark) or a park (kind, area).
- **Elsewhere**: the Town Report's *Logging & parks nearby* row; the Land Finder's *Next door* filters and parcel
  ring ([32](32-check-whats-next-door.md)); a Logging card in Data & sources.

## Acceptance criteria
- Scrubbing back removes blocks not yet logged; scrubbing forward greens older blocks with no flicker.
- The share logged counts land logged twice only once (100 m grid), so it never exceeds the yearly totals' sum.
- Approved and active blocks show only at the current year.
- Everything shown comes from the `logging` and `neighbours` stages; nothing is typed in.

## Limits
- Logging before the 1950s, and on private land before satellite change detection, is only partly in the record, so
  early decades are undercounts and the share logged (about 18%) is a floor, not the true figure.
- The colours by age illustrate regrowth; they are not a measure of today's forest cover.
- Approved and active blocks cover Crown forest tenures only: harvest plans on private managed forest land (much of
  the east coast) aren't published. An approved block may wait years or never be cut.

## Source
`src/logging.ts` (`loggingLayer`, `loggingTownRow`), `src/data.ts` (`Logging`, `LoggingBlocks`,
`loadLoggingBlocks`), `scripts/neighbours.mjs` (`buildLogging`), data `public/data/logging.json` and
`logging-blocks.json` from the `logging` stage; park outlines from `neighbours.json`.
