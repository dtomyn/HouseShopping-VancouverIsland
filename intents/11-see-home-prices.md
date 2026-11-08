# 11 — See what homes really sell for

## Intent
As a buyer, I want to see recorded sale values town by town, month by month, so that I know what each place
costs and how fast it has changed.

## Where
Layer menu → *Towns & living* → **Home prices**.

## Behaviour (as implemented)
- **Map**: each town's median fair-market value of recorded property transfers (BC Property Transfer Tax data) as a
  column, monthly from 2017. Columns use a **6-month rolling median** so small towns don't flicker.
- **Price rule** (`trailingMedianPrice`): the median of the monthly medians in the trailing window, counting only
  months with sales and a non-zero valuation (early months list sales with no valuation).
- **Panel**: headline numbers (typical across the major towns, lowest among towns of 5,000+, highest); median sale
  value over time by town; colour scale; a note that it includes all property types, so it runs below single-family
  listing prices.
- **Islands**: no transfer-tax series of their own; their values are estimates (see [21](21-consider-the-small-islands.md)).
- **Elsewhere**: Town Report shows the median sale value and its 5-year change; the Town Finder's *Affordability*
  criterion uses it.

## Acceptance criteria
- No month with sales but no valuation shows as $0.

## Source
`src/layers.ts` (`housingLayer`), `src/data.ts` (`trailingMedianPrice`), `public/data/housing.json` from the
`housing` stage.
