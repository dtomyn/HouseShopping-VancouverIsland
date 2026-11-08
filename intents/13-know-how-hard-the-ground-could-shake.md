# 13 — Know how hard the ground could shake

## Intent
As someone weighing earthquake risk for a home, I want the official forecast of shaking, not just past quakes,
so that I can compare places by what the building code expects.

## Where
Layer menu → *Hazard & climate outlook* → **Shaking hazard**. A static layer ([02](02-travel-through-time.md)).

## Behaviour (as implemented)
- **Map**: Natural Resources Canada's 2020 National Seismic Hazard Model (the basis of the 2020 building code): peak
  ground acceleration with a **2% chance of being exceeded in 50 years** (about a 1-in-2,475-year event), as a share of
  gravity, site class C. Sampled on a ~7 km grid and drawn as a colour surface over land, contoured every 10%.
- While it's the picked layer: town dots with their values, and the surface answers hover and click.
- **Panel**: headline numbers (highest and lowest towns, the ratio between them, the 1-in-2,475 chance); the colour
  scale with a rough guide to what each level of shaking does; why it differs across the island (deep quakes in the
  sinking Juan de Fuca plate, shallow crustal faults, the offshore Cascadia megathrust); every town ranked with its
  10%-in-50-years value.
- **Elsewhere**: Town Report shows the town's value; the Town Finder's *Lower shaking hazard* criterion and Land
  Finder's *Earthquake shaking* filter use it.

## Limits
The surface is bilinearly interpolated from the ~7 km grid; site conditions (soft soil, fill) can change shaking
locally and aren't modelled (site class C throughout).

## Source
`src/layers.ts` (`seismicLayer`, `HazardBitmap`), `public/data/seismic.json` from the `seismic` stage.
