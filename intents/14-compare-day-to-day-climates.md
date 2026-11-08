# 14 — Compare what each place's climate feels like

## Intent
As someone choosing between the sunny east coast and the rainy west, I want sunshine, rain days, frost and snow
side by side, so that I can find a climate I'd enjoy day to day, which annual temperature alone hides.

## Where
Layer menu → *Hazard & climate outlook* → **Climate normals**. A static layer.

## Inputs & controls
| Chip | Columns show |
|---|---|
| Sunshine | Bright-sunshine hours a year |
| Rain days | Days with rain or snow (≥0.2 mm) |
| Frost days | Days with a low of 0 °C or below |
| Snowfall | Snowfall in cm |

## Behaviour (as implemented)
- **Map**: Environment Canada's 1981–2010 normals at 39 stations as columns, recoloured and resized per chip.
- **Panel**: headline numbers for the chosen measure (best station, the other extreme, stations reporting it,
  island median); stations ranked best to worst.
- **Elsewhere**: Town Report's "What it feels like" uses the nearest station reporting each measure (sunshine within
  60 km); the Town Finder's *Sunnier* and *Little snow & frost* criteria use them.

## Limits
Only 8 island stations measure sunshine. Newer 1991–2020 normals aren't yet in Environment Canada's open API.

## Source
`src/layers.ts` (`normalsLayer`), `public/data/normals.json` from the `normals` stage.
