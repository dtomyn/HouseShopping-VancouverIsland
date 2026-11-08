# 37 — Check radon

## Intent
As someone buying a home on the islands, I want to know how common high indoor radon is here, how that compares
with the rest of BC, and what testing and fixing it costs, so that I test any house I buy instead of ruling out a
town on thin numbers.

## Where
Layer menu → *Hazard & climate outlook* → **Radon** (after *Floodplains*). A static layer
([02](02-travel-through-time.md)). Also in the Town Report ([19](19-read-a-town-report.md)) and the Town Finder
([20](20-rank-towns.md)). No Land Finder filter: the data is three health areas, far too coarse for a parcel.

## Inputs & controls
| Control | Effect |
|---|---|
| Hover / click a health area | Tooltip (homes over 200 Bq/m³ of those tested, median, highest, survey years); a click opens the area's details panel. |
| **☢ Radon ›** (Town Report) | Opens the layer. |

## Behaviour (as implemented)
- **Map**: the island's three health service delivery areas (South, Central and North Vancouver Island) shaded by
  the share of tested homes over Canada's guideline of 200 Bq/m³ (green → amber → red, 0–30%, the range across
  BC), each labelled "n of N homes over 200" while the layer is picked. The North Island area runs onto the
  mainland coast because the health area does. Outlines load the first time the layer is shown.
- **Panel**: what radon is and why it matters (second cause of lung cancer after smoking, the first in people who
  never smoked); island, BC and Canada shares over the guideline and how many island homes were too low to measure;
  a callout: the island is low but any house can be high, so test any house you buy (a long-term kit, ~$30–60,
  three months or more through the heating season on the lowest lived-in floor; mitigation by a certified
  professional, typically a few thousand dollars, usually cutting radon 80% or more); every island home's result
  as a dot strip per area with the guideline marked; the map legend; BC's 16 health areas ranked by share over the
  guideline (the island's highlighted); how the survey was done and why BC's larger Radon Data Repository isn't
  used; links to Health Canada and certified testers and mitigators.
- **Area details**: homes over the guideline, median, 90th percentile, BC's share; that one area-wide number can't
  tell streets or houses apart; tests by postal area (first three characters of the postal code) with counts, too
  few to rank places by; what to do; that area's dot strip.
- **Town Report**: *Radon (area survey)*: "n of N homes" over 200 Bq/m³ in the town's health area, with the share,
  median and survey years, and "Area-wide, not this town: test any house you buy". A button opens the layer.
- **Town Finder**: *Low radon (area survey)* (weight 0 by default): a smaller share of tested homes over 200 Bq/m³
  in the town's health area is better.

## Acceptance criteria
- `npm run data radon` from an empty `.cache/radon` writes `radon.json` (~5 KB, loaded with the app) and
  `radon-map.json` (~46 KB, loaded on first show).
- Every number shown carries its sample size or its area; nothing implies street or parcel precision.
- Results published as "<15" are counted as under 15 Bq/m³ and shown as "<15", never as a number.

## Decisions
- **Health Canada's survey, not the BC Radon Data Repository.** The BCCDC repository (40,000+ tests, behind the BC
  Radon Map) releases data only on approved requests, so it isn't open. The Cross-Canada Survey is open (OGL –
  Canada) and gives one row per home with its 2007 health region and postal prefix.
- **Health areas, not postal areas, on the map.** Postal areas hold 2–30 tests each on the island; shading them
  would read as precision the data doesn't have. They are listed in an area's details with their counts.
- **No geological proxy.** Airborne gamma-ray uranium maps would look finer but measure rock, not homes; the
  message is to test the house.
- **Default weight 0** in the Town Finder: all three island areas are at 1–2%, so the criterion barely separates
  towns.

## Limits
- One test per volunteer home, 2009–2011, ~55–110 homes per area; homeowners chose to take part, so it is not a
  random sample.
- Health area outlines are today's health service delivery areas, which match the 2007 health regions the survey
  used. Islets under ~2 km² are left out of the drawing; towns are placed against the full outline (Tahsis and
  Alert Bay, whose centres fall just off its shoreline, get the nearest area).
- Nothing here measures a particular house; only a test does.

## Source
`scripts/radon.mjs` (`radon` stage), `src/radon.ts` (`radonLayer`, `radonTownRow`, `townRadon`), `src/metrics.ts`
(`radon` metric and criterion), `public/data/radon.json`, `radon-map.json`.
