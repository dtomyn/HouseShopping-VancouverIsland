# 21 — Consider the Gulf and Discovery islands fairly

## Intent
As someone tempted by island life, I want the small islands compared on the same terms as the towns, with the ferry
counted honestly, so that I can weigh a quieter life against its costs.

## Where
Throughout: town dots, Town Report, Town Finder, Land Finder, and every map layer.

## Behaviour (as implemented)
- Salt Spring, Galiano, Thetis, Gabriola, Lasqueti, Denman and Quadra are places alongside the municipalities, and
  every map layer is clipped to include them.
- They are unincorporated, so a few figures come from other sources, labelled in their reports:
  - population and 65+ share from the 2021 Census (the islands' dissemination areas);
  - crime from the island's rural RCMP detachment (Galiano shares the Outer Gulf Islands detachment);
  - sale prices estimated from each island's 2021 Census average home value, scaled to match transfer-tax medians
    and moved since with its rural area's sales;
  - emergency care through the ferry route when there's no ER on the island.
- **Ferries**: weekday sailings toward Vancouver Island, the last departure back, the shortest crossing, and whether
  cars go, counted from BC Ferries' GTFS timetable on a typical weekday in the next two weeks. Lasqueti's passenger
  ferry has no feed and is typed in by hand.
- **Ferry burden** (Town Finder *Not ferry-dependent*): crossing minutes + the average wait for a boat + 15 minutes
  for each hour the last boat home leaves before 11 pm, doubled when no car ferry runs; places on Vancouver Island
  score 0. *Close to a hospital* adds half the gap between sailings for trips that need a ferry.
- Land Finder's *Island* filter separates Vancouver Island from the small islands.

## Source
`scripts/municipalities.mjs` (places, Lasqueti's ferry), `scripts/ferries.mjs`, `src/metrics.ts` (`ferryBurden`,
`ferryWait`, `erFerryWait`), `src/panels.ts` (`ferryMetric`).
