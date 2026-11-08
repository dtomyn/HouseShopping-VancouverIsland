# 40 — Find land that gets the winter sun

## Intent
As someone choosing a place to live year-round, I want to know how much direct sun a parcel or town gets on the
shortest days once the hills are in the way, so that I don't buy a lot that sits in a ridge's shadow from November
to February.

## Where
Land Finder ([22](22-search-for-land.md)) → *The land* → **Winter sun**, and a *Winter sun* tile with a year chart
in the parcel report ([23](23-inspect-and-shortlist-a-parcel.md)). Also a *Winter sun* row in the Town Report
([19](19-read-a-town-report.md)) and a Town Finder criterion ([20](20-rank-towns.md)).

## Inputs & controls
| Control | Effect |
|---|---|
| **Winter sun** slider (0–8 h, with the crossfilter histogram) | Keeps parcels whose sunniest spot gets at least that many hours of direct sun on 21 December. 0 (*Any*) is the default. |
| Town Finder **Winter sun** weight | Ranks towns by the share of the 21 December day the ground around the centre gets (weight 0 by default). |

## Behaviour (as implemented)
- **Data**: the `sun` stage builds one elevation mosaic of the islands from Mapzen Terrarium tiles at z11 (~50 m),
  traces each spot's skyline along 61 rays (every 3° from east through south to west, out to 25 km, with the
  earth's curvature and refraction), then walks the sun across the sky in 4-minute steps on four dates: 21 December
  (declination −23.44°), late January and November (−20°), late February and October (−10.5°) and the equinoxes
  (0°). It counts the time the sun is above both the horizon and the skyline.
- **Parcels**: the parcel's centre and up to six more spots on a lattice over it; the parcel's figure is its
  sunniest spot (the most December sun, then the most at the equinox). Written to `land-sun.json` in tenths of an
  hour, aligned with `land.json` and checked with a PID hash.
- **Towns**: the ground within 1.5 km of the centre on a 250 m grid; the median December hours and the share of
  that ground with under an hour, plus daylight on flat ground at the town's latitude (`sun.json`).
- **Filter**: in the *Place* funnel step. Without the file every parcel passes.
- **Parcel report**: *Winter sun* (hours on 21 December of the hours of daylight, and how much the hills take),
  and four bars (21 Dec, late Jan & Nov, late Feb & Oct, equinoxes) of sun past the hills against daylight on flat
  ground. The match score's *sun* part blends the year's sunshine at the nearest station with this share of the
  winter day.
- **Town Report**: *Winter sun*: median hours on 21 December within 1.5 km, of the daylight, with the share of the
  ground under an hour when there is any.

## Acceptance criteria
- `npm run data sun` from an empty `.cache/land/dem` rebuilds `land-sun.json` (~380 KB) and `sun.json` (~4 KB)
  after `land`, in about a minute plus the tile downloads.
- Open flat ground at 49.5° N gets about 8.2 h on 21 December; no figure exceeds the flat-ground daylight.
- Deep inlet towns (Zeballos, Tahsis, Sayward) come out lowest and the Victoria waterfront close to full daylight.

## Decisions
- **The sunniest spot, not the centre.** A house goes where the sun is; an acreage with one sunny bench passes.
- **Terrain only.** Trees and buildings change with every clearing and aren't in open data at this scale; cloud is
  in the yearly sunshine figure instead.
- **Four dates, not a year.** The winter half is what differs between places; the summer sun clears every ridge.

## Limits
- ~50 m terrain smooths small knolls and cut banks; a tall stand of second growth can take more winter sun than the
  hills do.
- Rays reach 25 km; a far, high ridge beyond that rarely matters below 18° of sun.

## Source
`scripts/sun.mjs` (`sun` stage), `src/land.ts` (`loadSun`, `flatSunHours`, `sunTile`, the *Winter sun* row),
`src/panels.ts` (`winterSunMetric`), `src/metrics.ts` (`winterSun` metric and criterion), `public/data/land-sun.json`,
`sun.json`.
