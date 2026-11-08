# 04 — Read the story of a key moment

## Intent
As someone watching the island's history, I want to open a notable event (a big fire, a strong quake, the 2021
heat dome) and read its story with context, so that I understand what happened, where, and what else was going on.

## Where
- Diamond markers on the timeline.
- The **event ticker**: one line docked on the timeline's top edge as playback crosses an event, with **Details ›**.
- **Key moments**: a list at the end of each layer's story panel: the layer's own events, island-wide events in a
  time layer's years, and any island-wide event that names the layer in its `layers` (so the 1964 tsunami appears
  on the static *Tsunami zones* layer).

## Behaviour (as implemented)
- Opening an event stops playback, moves the timeline to its date, flies the map there, sends a shockwave, and
  shows the event panel:
  - kicker (layer or "Island-wide" and the date), title, story and headline-number tiles;
  - **Show it on the map**: switches on the event's layers at its date, picking the first if needed, without
    leaving the event;
  - its sections (e.g. "Why it matters here"), and anything the layer draws via `detail`;
  - the event's layer year by year with the moment marked;
  - **Also happening**: other layers' events within 18 months;
  - **Closest towns**: each opens its report, and closing the report returns to the event;
  - earlier and later moments on the same layer; source links.
- **Back** returns to wherever the first event was opened from (a layer, a town, the Town Finder), even after
  stepping through several events.
- The ticker shows the latest crossed event and fades after 7 seconds; it never stacks cards over the map.
- Event sources: each layer's `events()` (fires of 5,000+ ha, quakes M6.3+ within 160 km, island-wide high-water
  years, the warmest year, the smokiest years) and four curated island-wide events (1964 tsunami, 2021 heat dome,
  November 2021 atmospheric river, 2023 Cameron Bluffs fire) with stats, sections, sources and related layers.

## Inputs (the event format)
Required: `t`, `layer` (`'*'` for island-wide), `title`, `body`. Optional, each deepening the panel without
changing it: `lon`/`lat`/`zoom`, `end`, `stats`, `sections`, `image`, `sources`, `layers`, `kind`, `detail(el)`.

## Acceptance criteria
- Opening an event never leaves cards over the map; the ticker holds at most one line.
- Text from data is escaped; image and source URLs must be http(s).
- An event added with only the four required fields still opens a complete panel.

## Decisions
- Replaced top-centre toast cards, which couldn't grow, with a side-panel view that can hold any amount of detail.

## Source
`src/events.ts` (`renderEventPanel`, `momentsList`, `eventLayers`), `src/main.ts` (`openEvent`, `showEvent`,
`ticker`), `src/layers.ts` (`AtlasEvent`, `TimedEvent`, `CURATED_EVENTS`, each layer's `events()`).
