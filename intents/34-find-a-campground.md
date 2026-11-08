# 34 — Find a campground

## Intent
As someone who camps (or whose visiting family will), I want to see the campgrounds and recreation sites around a
town, which are BC Parks, national park, rustic recreation sites or private, and what each offers, so that I know
what's within reach for weekends away.

## Where
- Layer menu → *Outdoors* → **Camping & rec sites**. A static layer.
- Town Report → **Camping nearby**.

## Inputs & controls
| Control | Effect |
|---|---|
| Kind chips in the panel (BC Parks, national park, recreation site, private/regional/other, day-use rec site) | Show or hide that kind. |
| Hover a marker | Tooltip: name, kind, park, campsites, fee, season, access (walk-in, paddle-in), a closure notice. |
| Click a marker | Details panel: campsites, fee, upkeep, year established, closure notice as of the build, the site description, activities, facilities, season and booking, operator (an organisation, never a person), and links. |
| Click a town in the ranking | Opens its Town Report. |

## Behaviour (as implemented)
- The `camping` stage reads Recreation Sites and Trails BC's established sites (`FTEN_REC_SITE_POINTS_SVW`) with
  their campsite counts, access, activities, upkeep and closure notices; a site with no campsites and no camping
  activity is a day-use site.
- It adds OpenStreetMap's `tourism=camp_site` and `caravan_site` (private and group-only sites dropped). One that
  carries the rec site's file number (`ref:FFID`) or sits within 400 m of a rec site is merged into it, adding fee,
  website and facilities. The rest are sorted by BC's park boundaries (the same WFS requests and cache as the
  `neighbours` stage) into BC Parks or national park campgrounds, else private, regional or other. The same
  campground mapped twice within 250 m appears once.
- `backcountry=yes` or `camp_site=basic` marks a walk-in site, a BC Marine Trails tag a paddle-in site; both are
  drawn as a hollow △. Day-use rec sites are rings.
- For every town: the nearest campground, the nearest park campground, the nearest rec site, and the count of each
  kind within 25 km (own island only for the small islands). The panel ranks towns by campgrounds within 25 km.

## Acceptance criteria
- About 430 points: ~108 BC Parks, ~14 national park, ~99 recreation site and ~180 other campgrounds, ~28 day-use
  recreation sites.
- A rec site mapped in OpenStreetMap too appears once.
- Without `camping.json` the layer says to run `npm run data camping` and the Town Report row is absent.

## Limits
- BC Parks doesn't publish its campgrounds as open data, so park campgrounds are those mapped in OpenStreetMap; a big
  park may show a campground and its group sites separately. Capacity, fees and seasons appear only where tagged,
  and reservation availability isn't included.
- Recreation site closure notices are as of the build date.
- Distances are straight lines. No Town Finder criterion or Land Finder filter: camping rarely decides a home.

## Source
`scripts/outdoors.mjs` (`buildCamping`), `src/outdoors.ts` (`campingLayer`, `campingTownRow`); data
`public/data/camping.json` from the `camping` stage.
