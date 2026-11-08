# 01 — Choose what's on the map

## Intent
As someone exploring the island, I want to turn data layers on and off and pick which one I'm reading about,
so that I can combine layers (fires with smoke, prices with crime) without losing track of what I'm looking at.

## Where
Top-left **Layer** button (or `L`), which opens a grouped menu: *Base map*, *History on the timeline*,
*Towns & living*, *Outdoors*, *Hazard & climate outlook*.

## Inputs & controls
| Control | Effect |
|---|---|
| A layer's switch | Puts the layer on the map or takes it off. Nothing else. |
| A layer's name | Makes it the **picked** layer (switching it on if it was off): its story fills the side panel and, if it changes over time, its years drive the timeline. Other layers stay on. Closes the menu. |
| *Clear the map* (top row, while anything is on) | Turns every layer off; nothing is picked. |
| *Just the island* (top row, when the map is empty) | Selected state of the empty map; not a layer. |

## Behaviour (as implemented)
- State is two things: `visible` (the layers switched on, exactly what's drawn) and `focused` (the picked layer,
  or `'island'` for none). Only `setLayerOn`, `focus` and `clearMap` change them.
- On an empty map, the first layer switched on also becomes the picked layer, so its story and timeline appear at once.
- Switching off the picked layer removes it, stops playback, and leaves no picked layer: the timeline shows
  "No layer picked", and the panel lists the layers still on, each a click away from being picked.
- The Layer button shows the picked layer's icon and name and a `+N` badge for the other layers on the map. With
  layers on but none picked it reads "N layers on".
- Opening a layer from elsewhere (a map click on an overlay's feature, a Town Report link) picks it; every other
  layer stays on.
- Picking another layer stops any trail flight or tour; leaving the Trails layer also turns off its satellite imagery.

## Outputs
The map draws every layer in `visible` each frame; the side panel shows the picked layer's story.

## Acceptance criteria
- A switch never changes which layer is picked, except on an empty map where it picks the first layer switched on.
- Clicking a name never turns another layer off.
- "Just the island" is never shown as selected while any layer is on.
- `+N` equals the number of layers on the map other than the picked one.

## Decisions
- An earlier version replaced the picked layer when another was picked, with "pin" switches to keep layers on. It
  was confusing (the base map looked selected while layers were on), so switches became pure visibility and
  picking stopped replacing anything.

## Source
`src/main.ts` (`state`, `renderLayerMenu`, `setLayerOn`, `focus`, `clearMap`, `renderOnMap`, `LAYER_GROUPS`).
