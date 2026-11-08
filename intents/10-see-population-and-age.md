# 10 — See who lives here, and how old

## Intent
As someone choosing a community, I want to see how each town has grown and how old its residents are,
including projections, so that I can find places that suit my stage of life.

## Where
Layer menu → *Towns & living* → **Population & age**.

## Behaviour (as implemented)
- **Map**: each municipality's population as a column; colour shows the share aged 65+ (brighter = older). From the
  first projection year (2026) on, figures are BC Stats projections and the columns turn translucent.
- The Gulf and Discovery islands are a single 2021 Census snapshot, shown as columns in 2021 only and left out of
  totals.
- **Panel**: headline numbers (municipal residents, share 65+, growth since 2001, the oldest town); share of residents
  aged 65+ over time for the larger towns.
- **Elsewhere**: Town Report shows population with 10-year growth and the 65+ share; the Town Finder's
  *Retiree community* and *Services & amenities* criteria use them.

## Source
`src/layers.ts` (`populationLayer`), `public/data/population.json` from the `population` stage.
