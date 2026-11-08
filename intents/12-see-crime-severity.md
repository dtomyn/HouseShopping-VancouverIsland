# 12 — See how safe each town is

## Intent
As someone choosing a community, I want a fair measure of crime that weighs serious crime more than minor crime,
so that I can compare towns' safety over time.

## Where
Layer menu → *Towns & living* → **Crime severity**.

## Behaviour (as implemented)
- **Map**: each police service's Statistics Canada Crime Severity Index (100 = Canada in 2006; lower is safer) as a
  column, 1998 → today.
- Only municipalities with their own police service have a series; smaller villages fall under rural RCMP
  detachments. The Gulf and Discovery islands use their rural detachment ([21](21-consider-the-small-islands.md)).
- Towns that changed police service have their series spliced, with the most recent series winning where years overlap.
- Years before a service existed are reported as 0 by Statistics Canada; the data stage drops them, since no real
  service has an index of 0.
- **Panel**: headline numbers (average island index, BC index, lowest and highest towns); the index by police service
  against the BC average.
- **Elsewhere**: Town Report shows the latest index; the Town Finder's *Low crime* criterion uses it.

## Limits
Regional hubs (e.g. Duncan) score high partly because many non-residents shop and work there.

## Source
`src/layers.ts` (`crimeLayer`), `scripts/fetch-data.mjs` (`crime`), `public/data/crime.json`.
