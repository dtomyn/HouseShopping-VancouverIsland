"""The Trails & waterfalls film: a short supplement to the main how-to, on just the new layer.

Same rules as video/storyboard.py: the narration says what to click and where, and each scene's run(f) drives the
real app through the Film calls in video/render.py. Render it with:

  .venv/Scripts/python.exe video/render.py --film trails            master, 1080p copy, storyboard, script, captions
  .venv/Scripts/python.exe video/render.py --film trails --preview  quick 960x540 cut with sound

Line ids start with "tw-" so their cached narration never clashes with the main film's.
"""
import storyboard as main

NAME = "island-atlas-trails"
BOARD_TITLE = "Island Atlas: Trails & waterfalls storyboard"
SCRIPT_TITLE = "Island Atlas, Trails & waterfalls: narration script"
SOUNDS = main.SOUNDS
spoken = main.spoken

TRAIL = "#34d399"
FALL = "#8be3ff"
FLY = "#6ee7b7"
TOUR = "#8be3ff"
TOWN = "#3ecf8e"
FINDER = "#a99bff"
LAND = "#5eead4"
STEPS = 7

# numbers for the narration, read from the app's own data
FACTS = """() => {
  const t = atlas.data.trails;
  const tall = t.falls.filter((f) => f.h).sort((a, b) => b.h - a.h)[0];
  const photos = new Set(t.falls.filter((f) => f.img).map((f) => f.img)).size;
  return {
    tr_km: t.netKm, tr_routes: t.routes.length, tr_falls: t.falls.length,
    tr_named: t.falls.filter((f) => f.name).length,
    tr_tall: tall.name, tr_tall_h: Math.round(tall.h), tr_tour: Math.min(12, photos),
  };
}"""

# Della Falls: the tallest fall in Canada, with a named trail to it
DELLA = "Della Falls"
CUMBERLAND = [-125.03, 49.62]


def step(f, n, title, colour):
    f.js("([n, t, s, c]) => Stage.chapter(n, t, s, c)", [n, title, f"Trails & waterfalls · {n} of {STEPS}", colour])
    f.sfx("whoosh", 0.35, seconds=0.6, pan_from=-0.8, pan_to=-0.2)


hint, spot, unspot, range_at, weight_at = main.hint, main.spot, main.unspot, main.range_at, main.weight_at


def panel_scroll_to(f, sel, offset=90, ms=1600, text=None):
    """Scrolls the side panel until an element sits `offset` px below the panel's top."""
    f.move({"sel": "#panel", "at": [0.5, 0.55]}, 700)
    dy = f.run("""([sel, text, off]) => {
      const p = document.getElementById('panel');
      const el = [...p.querySelectorAll(sel)].find((e) => !text || e.textContent.includes(text));
      return el ? el.getBoundingClientRect().top - p.getBoundingClientRect().top - off : 0;
    }""", [sel, text, offset])
    if abs(dy) > 4:
        f.scroll(dy, ms)


def lnglat(f, js):
    return {"lnglat": f.run(js)}


# ---------------------------------------------------------------------------------------------------

def intro(f):
    f.wait(400)
    f.run("() => { atlas.map.stop(); atlas.map.jumpTo(atlas.HOME); }")
    f.js("Stage.title('Trails & waterfalls', 'A new layer in Island Atlas', ['Trails', 'waterfalls'])")
    f.sfx("blip", 0.6, note=0)
    f.say("tw-intro")
    f.board("Title", "Black frame; the title rises word by word.")
    f.wait(2600)
    f.js("Stage.fade(0, 1600)")
    f.js("Stage.hideTitle(900)")
    f.voice_done(300)


def turn_on(f):
    step(f, 1, "Turn on the layer", TRAIL)
    f.camera("fill", 1200, whoosh=0.3)
    f.cursor(True)
    f.say("tw-on-1")
    hint(f, "☰", "Layer → Outdoors", "Trails & waterfalls", TRAIL)
    f.click({"sel": "#layers-btn"})
    f.camera({"sel": "#layer-menu", "grow": 16}, 1200, whoosh=0.3, max=1.8)
    f.wait(400)
    f.move({"sel": ".menu-gh", "text": "Outdoors", "at": [0.3, 0.5]}, 800)
    spot(f, {"sel": ".layer-row", "text": "Trails & waterfalls", "pad": 6})
    f.board("Outdoors", "Zoomed on the Layer menu: the new Outdoors group.")
    f.voice_done(200)
    unspot(f)
    f.say("tw-on-2")
    f.click({"sel": ".layer-row", "text": "Trails & waterfalls", "at": [0.4, 0.5]})
    f.js("Stage.hideChip()")
    f.camera("fill", 1400, whoosh=0.4)
    f.run("() => atlas.map.flyTo({ center: [-125.1, 49.5], zoom: 7.7, pitch: 50, bearing: -18, duration: 2600 })")
    f.voice_done(200)
    found = f.facts
    f.js("s => Stage.stats(s)", [
        {"v": found["tr_km"], "k": "km of mapped footpath", "c": TRAIL},
        {"v": found["tr_routes"], "k": "named hiking routes", "c": "#fcd34d"},
        {"v": found["tr_falls"], "k": "waterfalls", "c": FALL},
    ])
    f.sfx("riser", 0.35, seconds=1.8)
    f.say("tw-on-3")
    f.board("The whole island", "The layer is on; three counters rise over the map.")
    f.voice_done(500)
    f.js("Stage.hideStats()")


def read_map(f):
    step(f, 2, "Read the map", TRAIL)
    f.run("() => atlas.map.flyTo({ center: [-125.28, 49.6], zoom: 9.7, pitch: 62, bearing: -28, duration: 4200, curve: 1.4 })")
    f.sfx("whoosh", 0.5, seconds=1.6)
    f.say("tw-read-1")
    f.wait(4300)
    # in on the valley floor, where the footpaths are thickest
    f.camera({"x": 380, "y": 360, "w": 640, "h": 360}, 1600, max=1.9)
    f.board("Footpaths", "Zoomed in on the glowing footpath web, with sparks moving along it.")
    f.voice_done(200)
    f.camera("fill", 1300)
    f.say("tw-read-2")
    hint(f, "━", "Bright lines are named routes", "green easy · yellow moderate · red hard", TRAIL)
    route = lnglat(f, f"""() => {{ const r = atlas.data.trails.routes.find((r) => r.name === 'Della Falls Trail'); return r.line[Math.floor(r.line.length * 0.45)]; }}""")
    f.move(route, 1100)
    f.wait(1400)
    f.board("A route", "The cursor rests on a route and its tooltip shows length, climb and time.")
    f.voice_done(200)
    f.say("tw-read-3")
    hint(f, "▮", "Beams are waterfalls", "as tall as their drop, where it's known", FALL)
    f.move(lnglat(f, f"() => {{ const w = atlas.data.trails.falls.find((w) => w.name === '{DELLA}'); return [w.lon, w.lat]; }}"), 1100)
    f.wait(800)
    f.board("A waterfall", "The cursor on Della Falls, the tallest beam.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def waterfall(f):
    step(f, 3, "Open a waterfall", FALL)
    f.say("tw-fall-1")
    panel_scroll_to(f, "h3", text="Waterfalls with photos", offset=60)
    f.camera({"sel": "#panel .tr-gallery", "grow": 20}, 1300, whoosh=0.3, max=1.7)
    f.wait(600)
    f.click({"sel": "#panel .tr-ph", "text": DELLA, "at": [0.5, 0.45]})
    f.board("Photos", "Zoomed on the panel's waterfall photos; Della Falls is clicked.")
    f.voice_done(200)
    f.camera("fill", 1200)
    f.wait(1500)
    f.say("tw-fall-2")
    f.camera({"sel": "#panel", "grow": 10}, 1300, whoosh=0.3, max=1.5)
    f.move({"sel": "#panel .metric-grid", "at": [0.3, 0.3]}, 900)
    f.board("Della Falls", "The map flies there; the panel shows the photo, the drop and how far it is from a trail.")
    f.voice_done(200)
    f.say("tw-fall-3")
    hint(f, "⟳", "Orbit it in 3D", "", FALL)
    f.click({"sel": "#panel .tr-fly"})
    f.camera("fill", 1400, whoosh=0.4)
    f.move({"x": 760, "y": 620}, 900, wait=False)
    f.wait(5200)
    f.board("Orbit", "Satellite imagery on 3D terrain; the camera circles the falls.")
    f.voice_done(2500)
    f.say("tw-fall-4")
    hint(f, "✕", "Back to the map", "or press Escape", FALL)
    f.wait(1600)
    f.voice_done(200)
    # the orbit bar lives in the app's page, outside the panel
    f.click({"sel": ".tr-orbit-bar button"})
    f.wait(1600)
    f.js("Stage.hideChip()")


def route(f):
    step(f, 4, "Follow its trail", TRAIL)
    f.say("tw-route-1")
    panel_scroll_to(f, "h3", text="Routes that pass it", offset=60, ms=1200)
    f.click({"sel": "#panel .tr-routes li", "at": [0.35, 0.5]})
    f.board("Della Falls Trail", "Under Routes that pass it, the trail is clicked; the map frames the whole route.")
    f.voice_done(200)
    f.wait(800)
    f.say("tw-route-2")
    f.camera({"sel": "#panel", "grow": 10}, 1300, whoosh=0.3, max=1.5)
    f.move({"sel": "#panel .metric-grid", "at": [0.5, 0.5]}, 900)
    f.voice_done(200)
    f.camera("fill", 1200)
    f.say("tw-route-3")
    hint(f, "↔", "Point along the profile", "a marker follows on the map", TRAIL)
    f.move({"sel": "#panel .tr-prof svg", "at": [0.12, 0.55]}, 900)
    for x in (0.3, 0.5, 0.7, 0.9):
        f.move({"sel": "#panel .tr-prof svg", "at": [x, 0.55]}, 900)
        f.wait(250)
    f.board("Profile", "The cursor runs along the elevation profile; a white marker moves along the route on the map.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def fly(f):
    step(f, 5, "Fly the trail in 3D", FLY)
    f.say("tw-fly-1")
    f.click({"sel": "#panel .tr-fly"})
    f.camera("fill", 1200, whoosh=0.5)
    f.wait_until("!!document.querySelector('.tr-hud')", most=4000)
    f.voice_done(200)
    f.say("tw-fly-2")
    f.move({"x": 960, "y": 300}, 1200, wait=False)
    f.wait(5000)
    f.board("Flying", "The camera follows the trail over satellite imagery on 3D terrain.")
    f.camera({"sel": ".tr-hud", "grow": 24}, 1400, whoosh=0.3, max=1.7)
    f.voice_done(300)
    f.say("tw-fly-3")
    hint(f, "4×", "Speed · Space pauses · Esc ends", "", FLY)
    f.click({"sel": '.tr-hud .th-sp[data-s="4"]'})
    f.board("The flight panel", "Zoomed on the panel along the bottom: distance, elevation, climb and time; 4× is clicked.")
    f.wait(900)
    f.camera("fill", 1400)
    f.move({"x": 960, "y": 300}, 1000, wait=False)
    f.voice_done(200)
    f.wait_until("!!document.querySelector('.tr-hud.done')", most=26000)
    f.wait(2600)
    f.key("Escape", 1600)
    f.js("Stage.hideChip()")


def tour(f):
    step(f, 6, "Take the waterfall tour", TOUR)
    f.click({"sel": "#panel .tr-back"})
    f.wait(900)
    f.say("tw-tour-1")
    f.camera({"sel": "#panel .tr-cta", "grow": 20}, 1200, whoosh=0.3, max=1.8)
    f.wait(500)
    f.click({"sel": '#panel [data-act="tour"]'})
    f.camera("fill", 1300, whoosh=0.4)
    f.move({"x": 1200, "y": 300}, 1000, wait=False)
    f.voice_done(200)
    f.wait_until("!!document.querySelector('.tr-tour')", most=3000)
    f.wait(6500)
    f.board("Tour", "The first stop: the camera circles a waterfall and its photo card slides up.")
    f.say("tw-tour-2")
    f.camera({"sel": ".tr-tour", "grow": 30}, 1300, whoosh=0.3, max=1.6)
    f.wait(1800)
    f.click({"sel": '.tr-tour [data-a="next"]'})
    f.camera("fill", 1300)
    f.voice_done(200)
    f.wait(8000)
    f.board("Next stop", "Next is clicked and the tour flies on to another fall.")
    f.key("Escape", 1400)


def town(f):
    step(f, 7, "Trails in town reports and finders", TOWN)
    f.run(f"() => atlas.map.flyTo({{ center: {CUMBERLAND}, zoom: 10.2, pitch: 45, bearing: -10, duration: 2400 }})")
    f.wait(2500)
    f.say("tw-town-1")
    hint(f, "●", "Click a town dot", "", TOWN)
    f.click(lnglat(f, "() => { const m = atlas.data.munis.find((m) => m.name === 'Cumberland'); return [m.lon, m.lat]; }"))
    f.voice_done(200)
    f.wait(800)
    panel_scroll_to(f, "h3", text="Trails & waterfalls nearby", offset=40, ms=2000)
    f.say("tw-town-2")
    f.camera({"sel": "#panel", "grow": 10}, 1300, whoosh=0.3, max=1.5)
    f.move({"sel": "#panel .tr-fall", "at": [0.5, 0.5]}, 1000)
    f.board("Town report", "Cumberland's report: trail kilometres, waterfalls, and the nearest routes and falls as buttons.")
    f.voice_done(200)
    f.camera("fill", 1200)
    f.js("Stage.hideChip()")
    f.click({"sel": "#panel [data-out=\"fall\"]"})
    f.wait(2200)
    f.say("tw-find-1")
    f.click({"sel": "#finder-btn"})
    f.wait(900)
    f.move({"sel": "#panel", "at": [0.5, 0.5]}, 600)
    dy = f.run("() => { const p = document.getElementById('panel'); return document.querySelector('.weight input[data-id=\"outdoors\"]').getBoundingClientRect().top - p.getBoundingClientRect().top - 200; }")
    f.scroll(dy, 1200)
    f.camera({"sel": ".weight input[data-id=\"outdoors\"]", "grow": 70}, 1200, whoosh=0.3, max=2.0)
    f.drag(weight_at(f, "outdoors", 2), weight_at(f, "outdoors", 5), 1100)
    f.board("Town Finder", "Zoomed on the new Trails & waterfalls slider, dragged up to 5.")
    f.voice_done(200)
    f.camera("fill", 1200)
    f.click({"sel": "#panel .close-x"})
    f.say("tw-find-2")
    f.click({"sel": "#land-btn"})
    f.wait_until("!!document.querySelector('.land-rail [data-sec=\"outdoors\"]')", most=20000)
    f.wait(1200)
    f.move({"sel": ".land-rail", "at": [0.5, 0.5]}, 700)
    dy = f.run("() => { const r = document.querySelector('.land-rail'); return document.querySelector('[data-sec=\"outdoors\"]').getBoundingClientRect().top - r.getBoundingClientRect().top - 120; }")
    f.scroll(dy, 1600)
    f.camera({"sel": '.land-rail [data-sec="outdoors"]', "grow": 20}, 1300, whoosh=0.3, max=1.8)
    hint(f, "⇆", "Trails to walk · A waterfall nearby", "in Land Finder's filters", LAND)
    f.drag(range_at(f, '.land-rail [data-sec="outdoors"] input', 1.0, 1), range_at(f, '.land-rail [data-sec="outdoors"] input', 0.12, 1), 1500)
    f.board("Land Finder", "Zoomed on the Trails & waterfalls filters: the waterfall slider is pulled in to about 5 km.")
    f.voice_done(400)
    f.camera("fill", 1200)
    f.js("Stage.hideChip()")
    f.click({"sel": "#panel .close-x"})
    f.wait(1400)


def ending(f):
    f.js("Stage.hideChapter()")
    f.run("() => { atlas.focus('trails'); atlas.map.flyTo({ center: [-125.1, 49.5], zoom: 7.6, pitch: 50, bearing: -18, duration: 3200 }); }")
    f.camera("rest", 1600, whoosh=0.5)
    f.wait(1700)
    f.js("Stage.fade(0.82, 2000)")
    f.sfx("impact", 0.5)
    f.mark("end")
    f.wait(700)
    f.js("([u, fine]) => Stage.end('Trails & waterfalls, in open data', u, fine)",
         [f.url, "Trails and waterfalls from OpenStreetMap, Wikidata and Wikimedia Commons · nothing to install"])
    f.say("tw-end")
    f.board("End card", "The window drifts back; the end card shows the name and address.")
    f.voice_done(3000)
    f.js("Stage.blackout(1600)")
    f.wait(1800)


def youtube(found, url, chapters):
    return f"""TITLE
Island Atlas add-on: Trails & Waterfalls in 3D | Vancouver Island

DESCRIPTION
New in Island Atlas: a Trails & Waterfalls layer. This short add-on picks up where the main how-to guide leaves off, so if you're new to the app, start there:
▶ How to use Island Atlas: a step-by-step guide: {MAIN_VIDEO}

The new layer maps every footpath on Vancouver Island and the Gulf and Discovery islands: {found['tr_km']:,} km of trail, {found['tr_routes']} named hiking routes coloured by effort, and {found['tr_falls']} waterfalls drawn as beams of light, as tall as their drop where it's known. The tallest, {found['tr_tall']}, drops {found['tr_tall_h']} m.

In this video:
• Turn on the layer and read the map
• Open a waterfall and orbit it in 3D
• Follow a trail and read its elevation profile
• Fly the trail in 3D, over satellite imagery on the real terrain
• Take the waterfall tour of {found['tr_tour']} photographed falls
• Find trails and waterfalls in town reports, Town Finder and Land Finder

Try it yourself: {url or '[add the link]'}

Chapters
{chapters}

Everything in this video is the real application, filmed frame by frame. The narration uses a synthetic voice (Kokoro).

Data: trails and waterfalls © OpenStreetMap contributors (ODbL); photos and heights from Wikidata (CC0) and Wikimedia Commons (each photo under its own licence); terrain from Mapzen / AWS Terrain Tiles; imagery © Esri, Maxar, Earthstar Geographics. Basemap © OpenStreetMap contributors © CARTO. Data extract {found['extract']}.
Trails can be closed, overgrown, on private land or seasonal: check BC Parks, Recreation Sites and Trails BC, or the local trail society before you go. This is an exploration tool, not trail or safety advice.

TAGS
Island Atlas, Vancouver Island, hiking, hiking trails, waterfalls, Della Falls, Strathcona Park, 3D map, trail map, Gulf Islands, BC hiking, open data, OpenStreetMap, tutorial
"""


# where the main how-to lives on YouTube, for the add-on's description; fill in once it's published
MAIN_VIDEO = "[add the link to the main video]"


SCENES = [
    dict(id="tw-intro", title="Introduction", run=intro,
         shows="The title.", camera="Floating window, then full-frame.", motion="Title rises out of a blur; fade up from black.", sound="A glassy note; music fades in.",
         lines={"tw-intro": "Island Atlas now maps the island's trails and waterfalls. Here's how to explore them."}),
    dict(id="tw-on", title="Turn on the layer", run=turn_on,
         shows="Picking Trails & waterfalls from the Layer menu; the island-wide counts.", camera="Zoom onto the menu, then full-frame.", motion="Real clicks; counters rise.", sound="Clicks, whooshes, a riser.",
         lines={"tw-on-1": "Click Layer, at the top left. Trails and waterfalls is in the new Outdoors group.",
                "tw-on-2": "Pick it, and the map lights up.",
                "tw-on-3": "That's {tr_km:,} kilometres of mapped footpath, {tr_routes} named hiking routes, and {tr_falls} waterfalls."}),
    dict(id="tw-read", title="Read the map", run=read_map,
         shows="The footpath web, a named route and its tooltip, a waterfall beam.", camera="A slow fly-in; a zoom onto the footpaths.", motion="Cursor rests on a route, then a waterfall.", sound="Whooshes.",
         lines={"tw-read-1": "Every footpath glows, and each moving spark is a hiker out on the trail.",
                "tw-read-2": "The brighter lines are named routes, coloured by effort: green is easy, yellow moderate, and red hard. Point at one to see its length and climb.",
                "tw-read-3": "The beams of light are waterfalls. Where the drop has been measured, the beam is as tall as the fall. The tallest, {tr_tall}, drops {tr_tall_h} metres."}),
    dict(id="tw-fall", title="Open a waterfall", run=waterfall,
         shows="Clicking a waterfall photo, its report, and the 3D orbit.", camera="Zoomed on the photos and the report; full-frame for the orbit.", motion="Real clicks; the map circles the falls.", sound="Clicks, whooshes.",
         lines={"tw-fall-1": "The side panel lists the routes, with photos of the waterfalls further down. Click one to open it.",
                "tw-fall-2": "The map flies there, and the panel shows its photo, its drop, and how far it is from a trail.",
                "tw-fall-3": "Click Orbit it in 3D to circle the falls over the real terrain.",
                "tw-fall-4": "Drag to look around, and click Back to the map when you're done."}),
    dict(id="tw-route", title="Follow its trail", run=route,
         shows="Opening the route that passes the falls; its stats and elevation profile.", camera="Zoomed on the route report.", motion="The cursor runs along the profile.", sound="Clicks.",
         lines={"tw-route-1": "Under Routes that pass it, click the trail to open it.",
                "tw-route-2": "You get its distance, walking time, climbing, and an elevation profile.",
                "tw-route-3": "Point along the profile, and a marker shows that spot on the map."}),
    dict(id="tw-fly", title="Fly the trail in 3D", run=fly,
         shows="The 3D flight along the trail, its panel, and the speed buttons.", camera="Full-frame; a zoom onto the flight panel.", motion="The camera follows the trail to its end.", sound="Clicks, whooshes.",
         lines={"tw-fly-1": "Now click Fly this trail in 3D.",
                "tw-fly-2": "The camera follows the trail over satellite imagery on the real terrain, while the panel along the bottom counts the distance, the elevation and the climb.",
                "tw-fly-3": "The speed buttons go faster. The space bar pauses, and Escape ends the flight."}),
    dict(id="tw-tour", title="Take the waterfall tour", run=tour,
         shows="Starting the waterfall tour; two stops.", camera="Zoomed on the tour button and the photo card.", motion="The camera flies from fall to fall and circles each.", sound="Clicks, whooshes.",
         lines={"tw-tour-1": "Back on the main list, Waterfall tour flies to {tr_tour} photographed falls, one after another.",
                "tw-tour-2": "Each one gets a card with its photo and drop. The arrows skip ahead, and Escape ends the tour."}),
    dict(id="tw-town", title="Trails in town reports and finders", run=town,
         shows="The Trails & waterfalls section of a town report, the Town Finder slider, and the Land Finder filters.", camera="Zoomed on each in turn.", motion="Real clicks, scrolls and slider drags.", sound="Clicks.",
         lines={"tw-town-1": "Town reports now include the trails and waterfalls nearby. Click a town dot to open one.",
                "tw-town-2": "It shows how much trail is within ten kilometres, the waterfalls within thirty, and the nearest routes and falls. Click any of them to see it on the map.",
                "tw-find-1": "In Town Finder, the Trails and waterfalls slider ranks towns by how much there is nearby.",
                "tw-find-2": "And Land Finder has a Trails and waterfalls section, to find land near trails, or with a waterfall close by."}),
    dict(id="tw-end", title="End card", run=ending,
         shows="Title and address.", camera="Back to the floating window.", motion="Logo spins up.", sound="Soft impact; music fades.",
         lines={"tw-end": "Lace up your boots, and enjoy exploring."}),
]
