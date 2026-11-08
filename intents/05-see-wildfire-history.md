# 05 — See where the island has burned

## Intent
As someone choosing where to live, I want to see every mapped wildfire and recorded ignition over a century,
so that I can judge how often and how close fire comes to the places I'm considering.

## Where
Layer menu → *History on the timeline* → **Wildfires**.

## Behaviour (as implemented)
- **Map**: mapped fire perimeters (1919 → today) flare as they burn, then cool to dark burn scars that stay on the
  map; recorded ignitions (1950 → today) glow as embers sized by final fire size, coloured by cause (lightning,
  human, unknown). GPU time filtering shows only what has happened by the current moment.
- **Panel**: headline numbers for the current year (ignitions, mapped area burned, share human-caused, total burned
  since 1919); area burned per year as a bar chart with the worst years named; ignition cause legend and a note
  that perimeters are mapped mainly for larger fires.
- **Events**: every mapped fire of 5,000+ ha, with its size, cause and size rank.
- **Details**: click a perimeter or an ignition ([03](03-get-details-on-anything.md)).
- **Elsewhere**: Town Report shows wildfire starts within 15 km since 1990 and area burned nearby; the Town Finder's
  *Low wildfire exposure* criterion uses the same count.

## Acceptance criteria
- Scrubbing back removes fires that hadn't started yet; scars persist for every fire up to the current moment.
- Each perimeter is counted once in yearly totals, however many parts it is drawn in.

## Limits
Perimeter totals understate small-fire activity (BC maps perimeters mainly for larger fires).

## Source
`src/layers.ts` (`firesLayer`), data `public/data/fires.json` from the `fires` stage.
