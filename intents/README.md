# Intents — Island Atlas

Each file in this folder describes one **user intent**: something a person using the atlas wants to accomplish,
worked out retroactively from what the application *currently implements* (not from a wish list). Together they
answer the question the atlas was built for: **where on Vancouver Island should we live?** Every file follows the
same shape:

- **Intent**: the goal in user terms ("As a … I want … so that …")
- **Where**: the screen or control that serves it
- **Inputs & controls**: what the user can set (where there is something to set)
- **Behaviour (as implemented)**: the rules the code actually applies
- **Acceptance criteria**: testable statements derived from the implementation
- **Decisions**: why it works this way, where an earlier approach was replaced
- **Limits**: known simplifications or gaps
- **Source**: where it lives in the code

## Index

### Explore the map and time
| # | Intent | File |
|---|--------|------|
| 01 | Choose what's on the map | [01-choose-whats-on-the-map.md](01-choose-whats-on-the-map.md) |
| 02 | Travel through time | [02-travel-through-time.md](02-travel-through-time.md) |
| 03 | Get details on anything on the map | [03-get-details-on-anything.md](03-get-details-on-anything.md) |
| 04 | Read the story of a key moment | [04-read-the-story-of-a-moment.md](04-read-the-story-of-a-moment.md) |

### Read the island's history
| # | Intent | File |
|---|--------|------|
| 05 | See where the island has burned | [05-see-wildfire-history.md](05-see-wildfire-history.md) |
| 06 | See the island's earthquakes in 3D | [06-see-earthquakes.md](06-see-earthquakes.md) |
| 07 | See when the rivers rise | [07-see-river-floods.md](07-see-river-floods.md) |
| 08 | See how much the island has warmed | [08-see-the-island-warm.md](08-see-the-island-warm.md) |
| 09 | See how often wildfire smoke reaches each town | [09-see-wildfire-smoke.md](09-see-wildfire-smoke.md) |
| 10 | See who lives here, and how old | [10-see-population-and-age.md](10-see-population-and-age.md) |
| 11 | See what homes really sell for | [11-see-home-prices.md](11-see-home-prices.md) |
| 12 | See how safe each town is | [12-see-crime-severity.md](12-see-crime-severity.md) |

### Know today's conditions and the outlook
| # | Intent | File |
|---|--------|------|
| 13 | Know how hard the ground could shake | [13-know-how-hard-the-ground-could-shake.md](13-know-how-hard-the-ground-could-shake.md) |
| 14 | Compare what each place's climate feels like | [14-compare-day-to-day-climates.md](14-compare-day-to-day-climates.md) |
| 15 | See the climate the next 25 years could bring | [15-see-the-climate-ahead.md](15-see-the-climate-ahead.md) |
| 16 | Know how far emergency care is | [16-know-how-far-emergency-care-is.md](16-know-how-far-emergency-care-is.md) |
| 28 | Check internet and cell coverage | [28-check-internet-and-cell-coverage.md](28-check-internet-and-cell-coverage.md) |

### Get outdoors
| # | Intent | File |
|---|--------|------|
| 17 | Find hikes and waterfalls near a place | [17-find-hikes-and-waterfalls.md](17-find-hikes-and-waterfalls.md) |
| 18 | Fly a trail and orbit a waterfall in 3D | [18-fly-trails-and-orbit-waterfalls.md](18-fly-trails-and-orbit-waterfalls.md) |

### Water and land
| # | Intent | File |
|---|--------|------|
| 29 | Know the well water under a place | [29-know-the-well-water-under-a-place.md](29-know-the-well-water-under-a-place.md) |

### Choose a place
| # | Intent | File |
|---|--------|------|
| 19 | Read a town's report card | [19-read-a-town-report.md](19-read-a-town-report.md) |
| 20 | Rank the towns by what matters to me | [20-rank-towns.md](20-rank-towns.md) |
| 21 | Consider the Gulf and Discovery islands fairly | [21-consider-the-small-islands.md](21-consider-the-small-islands.md) |
| 22 | Search every large parcel for the land we want | [22-search-for-land.md](22-search-for-land.md) |
| 23 | Inspect a parcel and keep a shortlist | [23-inspect-and-shortlist-a-parcel.md](23-inspect-and-shortlist-a-parcel.md) |

### Trust it and use it anywhere
| # | Intent | File |
|---|--------|------|
| 24 | See where every number comes from | [24-see-where-the-numbers-come-from.md](24-see-where-the-numbers-come-from.md) |
| 25 | Get around the map quickly | [25-get-around-the-map.md](25-get-around-the-map.md) |
| 26 | Use it privately, with nothing to install | [26-use-it-privately-with-nothing-to-install.md](26-use-it-privately-with-nothing-to-install.md) |
| 27 | Keep the data fresh and reproducible (maintainer) | [27-keep-the-data-fresh-and-reproducible.md](27-keep-the-data-fresh-and-reproducible.md) |

### Proposed (not implemented)
New drafts go in `proposed/` with the same shape, using **Behaviour (proposed)**, **Open questions** and
**Touches** (files expected to change) in place of the as-implemented sections. Move a file up into this folder
and rewrite it as-implemented once it ships. The open ideas are in [../ROADMAP.md](../ROADMAP.md) (logging history,
story mode, sea level, tsunami zones, ongoing costs, Indigenous territories); none has a proposed intent yet.

Out of scope: the `video/` explainer films are a separate tooling project that films the app; they are not an
end-user intent of the application. [../MAP-ATLAS-BLUEPRINT.md](../MAP-ATLAS-BLUEPRINT.md) covers building a new
atlas in the same style.
