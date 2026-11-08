# 25 — Get around the map quickly

## Intent
As a frequent user, I want to move around the island in 3D, reach any view by keyboard or link, and use it on a
phone, so that exploring is quick wherever I am.

## Where
The whole screen.

## Inputs & controls
| Input | Effect |
|---|---|
| Drag / scroll | Pan / zoom. |
| Right-drag (or Ctrl-drag) | Tilt and turn the map. The compass button turns north back up. |
| `L` | Open or close the Layer menu. |
| `Space` | Play or pause the timeline. |
| `←` / `→` | Step a year (or a month). |
| `P` | Hide or show the side panel (also the top-right panel button). |
| `S` | Open Data & sources. |
| `Esc` | Close the Layer menu or a dialog; end a 3D flight, orbit or tour; in Land Finder, close the parcel report, then Land Finder. |
| `#trails`, `#land`, `#sources` | Open straight to Trails & waterfalls, Land Finder or Data & sources. |

## Behaviour (as implemented)
- The atlas opens on the plain island with an intro flight, then a "Start here" panel saying what to click.
- Hovering anything shows a tooltip; on layers that draw towns, the town under the cursor is highlighted.
- Under 820 px wide the brand text and some buttons hide, the Layer menu goes full-width, the side panel docks above
  the timeline and the timeline drops its speed control.
- Shortcuts don't fire while typing in a field.

## Source
`src/main.ts` (keyboard handler, hash handling, `setPanelOpen`, intro), `src/style.css` (`@media (max-width: 820px)`).
