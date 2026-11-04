"""The Island Atlas how-to video: a step-by-step walkthrough of where to click, in order.

The narration only says what to do and where; it doesn't comment on the data the app shows.

video/render.py plays these scenes against the real app. Each scene has:
  title, shows, camera, motion, sound   what the storyboard page and script.md say about it
  lines                                 narration, by id; {name} is filled from the app's data (see facts() in render.py)
  run(f)                                the scene itself, using the Film calls in render.py

Targets for f.move / f.click / f.camera: {"sel": css, "text": substring, "nth": i, "at": [fx, fy], "grow": px}
for an element in the app, {"lnglat": [lon, lat]} for a place on the map, or {"cx", "cy", "z"} for a camera view.
The camera also takes "fill" (the app fills the frame) and "rest" (the window floats on the background).
"""
import re

# Words the voice reads wrongly from their spelling, as replacements in its phonemes (none needed yet).
SOUNDS = {}


def spoken(text):
    """What the voice reads: the caption text with symbols written out."""
    text = text.replace("3D", "three-D").replace("→", "to").replace("+1", "plus one")
    return re.sub(r"\s+", " ", text)


TOUR = "#4cc9f0"
MAP = "#8fdcff"
SPARK = "#ff8a3d"
QUAKE = "#f9d65c"
TOWN = "#3ecf8e"
FINDER = "#a99bff"
LAND = "#5eead4"
CEDAR = "#d8a06a"
KEYS = "#ffb35c"

QUALICUM = [-124.443, 49.348]
STEPS = 9


def step(f, n, title, colour):
    f.js("([n, t, s, c]) => Stage.chapter(n, t, s, c)", [n, title, f"Step {n} of {STEPS}", colour])
    f.sfx("whoosh", 0.35, seconds=0.6, pan_from=-0.8, pan_to=-0.2)


def hint(f, icon, head, body="", colour=KEYS, side="left"):
    """An on-screen instruction: what to click or press."""
    f.js("([i, h, b, c, s]) => Stage.chip(i, h, b, c, s)", [icon, head, body, colour, side])
    f.sfx("blip", 0.6, note=3)


def spot(f, target):
    f.js("t => Stage.spot(t)", target)


def unspot(f):
    f.js("Stage.spot(null)")


def range_at(f, sel, frac, nth=0):
    """The point at a fraction along a range input, in app pixels."""
    return f.run("""([sel, frac, nth]) => {
      const i = document.querySelectorAll(sel)[nth];
      const r = i.getBoundingClientRect(), thumb = 16;
      return { x: r.left + thumb / 2 + (r.width - thumb) * frac, y: r.top + r.height / 2 };
    }""", [sel, frac, nth])


def weight_at(f, criterion, value):
    """The point on a Town Finder slider for a weight (0-5), in app pixels."""
    return f.run("""([id, v]) => {
      const i = document.querySelector(`.weight input[data-id="${id}"]`);
      const r = i.getBoundingClientRect(), thumb = 16;
      return { x: r.left + thumb / 2 + (r.width - thumb) * (v - +i.min) / (+i.max - +i.min), y: r.top + r.height / 2 };
    }""", [criterion, value])


def open_menu_and_pick(f, name):
    f.click({"sel": "#layers-btn"})
    f.wait(300)
    f.click({"sel": ".layer-row", "text": name, "at": [0.4, 0.5]})


# ---------------------------------------------------------------------------------------------------

def intro(f):
    f.wait(400)
    f.run("() => { atlas.map.stop(); atlas.map.jumpTo(atlas.HOME); }")
    f.js("Stage.title('How to use Island Atlas', 'A step-by-step guide', ['Atlas'])")
    f.sfx("blip", 0.6, note=0)
    f.say("intro-1")
    f.board("Title", "Black frame; the title rises word by word.")
    f.wait(2200)
    f.js("Stage.fade(0, 1600)")
    f.js("Stage.hideTitle(900)")
    f.voice_done(300)


def tour(f):
    step(f, 1, "Find your way around", TOUR)
    f.cursor(True)
    f.say("tour-1")
    for lnglat in ([-124.99, 49.69], [-124.443, 49.348], [-123.94, 49.17]):
        f.move({"lnglat": lnglat}, 900)
        f.wait(500)
    f.board("Just the island", "The app opens on the plain island; the cursor touches a few town dots.")
    f.voice_done(200)
    f.say("tour-2")
    spot(f, {"sel": "#layers-btn", "pad": 8})
    f.move({"sel": "#layers-btn"}, 900)
    f.board("Layer button", "A spotlight on the Layer button, top left.")
    f.voice_done(200)
    f.say("tour-3")
    spot(f, {"sel": ".top-actions", "pad": 8})
    for sel in ("#land-btn", "#finder-btn", "#about-btn", "#panel-btn"):
        f.move({"sel": sel}, 700)
        f.wait(500)
    f.board("Top-right buttons", "The spotlight moves to the four buttons at the top right; the cursor touches each.")
    f.voice_done(200)
    f.say("tour-4")
    spot(f, {"sel": "#panel", "pad": 4})
    f.move({"sel": "#panel", "at": [0.5, 0.4]}, 900)
    f.board("Side panel", "The spotlight on the side panel.")
    f.voice_done(200)
    f.say("tour-5")
    spot(f, {"sel": "#timeline", "pad": 6})
    f.move({"sel": "#timeline", "at": [0.5, 0.5]}, 900)
    f.board("Timeline", "The spotlight on the timeline along the bottom.")
    f.voice_done(300)
    unspot(f)


def move_map(f):
    step(f, 2, "Move the map", MAP)
    f.say("map-1")
    hint(f, "✥", "Drag", "to move the map", MAP)
    f.drag({"x": 760, "y": 520}, {"x": 980, "y": 440}, 1300)
    f.wait(300)
    f.drag({"x": 980, "y": 440}, {"x": 800, "y": 500}, 1100)
    f.board("Drag", "The cursor drags the map one way and back.")
    f.voice_done(200)
    f.say("map-2")
    hint(f, "⇕", "Scroll", "to zoom in and out", MAP)
    f.move({"lnglat": [-124.6, 49.4]}, 700)
    f.scroll(-900, 1600)
    f.wait(500)
    f.scroll(900, 1400)
    f.board("Scroll", "A scroll wheel zooms in on the middle of the island, then out again.")
    f.voice_done(200)
    f.say("map-3")
    hint(f, "⟲", "Right-drag", "to tilt and turn the view", MAP)
    f.drag({"x": 800, "y": 520}, {"x": 1000, "y": 420}, 1500, button="right")
    f.wait(500)
    f.camera({"sel": ".maplibregl-ctrl-top-right", "grow": 40}, 1200, whoosh=0.3, max=2.2)
    spot(f, {"sel": ".maplibregl-ctrl-top-right", "pad": 6})
    f.voice_done(100)
    f.say("map-4")
    f.move({"sel": ".maplibregl-ctrl-zoom-in"}, 700)
    f.wait(400)
    f.move({"sel": ".maplibregl-ctrl-zoom-out"}, 500)
    f.wait(400)
    f.click({"sel": ".maplibregl-ctrl-compass"})
    f.board("Map buttons", "Zoomed on the map buttons: zoom in, zoom out, and the compass, which is clicked.")
    f.voice_done(200)
    unspot(f)
    f.js("Stage.hideChip()")
    f.camera("fill", 1200, whoosh=0.3)
    f.run("() => atlas.map.flyTo({ ...atlas.HOME, duration: 1800 })")
    f.wait(1900)


def layers(f):
    step(f, 3, "Show a data layer", SPARK)
    f.say("layer-1")
    hint(f, "☰", "Click Layer", "top left, or press L", SPARK)
    f.click({"sel": "#layers-btn"})
    f.camera({"sel": "#layer-menu", "grow": 16}, 1200, whoosh=0.3, max=1.8)
    f.board("Layer menu", "The menu opens and the camera zooms in on it.")
    f.voice_done(200)
    f.say("layer-2")
    for nth in range(4):  # Base map, then the three groups of layers
        f.move({"sel": ".menu-gh", "nth": nth, "at": [0.3, 0.5]}, 700)
        f.wait(700)
    f.voice_done(200)
    f.say("layer-3")
    f.click({"sel": ".layer-row", "text": "Wildfires", "at": [0.4, 0.5]})
    f.camera("fill", 1300, whoosh=0.3)
    f.js("Stage.hideChip()")
    f.wait(800)
    spot(f, {"sel": "#panel", "pad": 4})
    f.board("Wildfires on", "Wildfires picked; the menu closes, the map fills in and the side panel describes the layer.")
    f.voice_done(300)
    unspot(f)


def timeline(f):
    step(f, 4, "Play the timeline", SPARK)
    f.camera({"sel": "#timeline", "grow": 30}, 1300, whoosh=0.3, max=1.9)
    f.say("time-1")
    hint(f, "▶", "Click play", "or press the space bar", SPARK)
    f.click({"sel": "#play"})
    f.board("Play", "Zoomed on the timeline: play is clicked and the years start to run.")
    f.voice_done(200)
    f.say("time-2")
    hint(f, "»", "Speed", "how many years pass each second", SPARK)
    f.click({"sel": "#speed-sel"}, real=False)
    f.run("() => { const s = document.getElementById('speed-sel'); s.value = '8'; s.dispatchEvent(new Event('change')); }")
    f.wait(1500)
    f.voice_done(200)
    f.say("time-3")
    hint(f, "⏸", "Pause, then drag the slider", "to jump to any year", SPARK)
    f.click({"sel": "#play"})
    f.wait(300)
    start = f.run("() => { const s = document.getElementById('scrub'); return (+s.value - +s.min) / (+s.max - +s.min); }")
    f.drag(range_at(f, "#scrub", start), range_at(f, "#scrub", 0.55), 1500)
    f.board("Scrub", "Paused; the slider is dragged forward through the decades.")
    f.voice_done(200)
    f.say("time-4")
    hint(f, "◆", "Click a marker", "to jump to that event", SPARK)
    f.click({"sel": '.ev[title*="Cameron"]'})
    f.camera("fill", 1500, whoosh=0.3)
    f.wait(1600)
    f.camera({"sel": ".toast", "grow": 16}, 1200, max=1.8)
    f.board("Event", "The Cameron Bluffs marker is clicked; the map flies there and the event card appears.")
    f.voice_done(400)
    f.js("Stage.hideChip()")
    f.camera("fill", 1200)
    f.wait(1200)


def switching(f):
    step(f, 5, "Switch, combine and clear layers", QUAKE)
    f.run("() => atlas.map.flyTo({ ...atlas.HOME, duration: 1800 })")
    f.say("sw-1")
    open_menu_and_pick(f, "Earthquakes")
    f.wait(900)
    f.board("Replace", "Earthquakes picked from the menu; the wildfires go away.")
    f.voice_done(200)
    f.say("sw-2")
    hint(f, "◐", "Flip a layer's switch", "to keep it on while you pick others", QUAKE)
    f.click({"sel": "#layers-btn"})
    f.camera({"sel": "#layer-menu", "grow": 16}, 1100, whoosh=0.3, max=1.8)
    f.wait(300)
    f.click({"sel": ".layer-row", "text": "Earthquakes", "at": [0.93, 0.5]})
    f.wait(500)
    f.click({"sel": ".layer-row", "text": "Hospital access", "at": [0.4, 0.5]})
    f.board("Keep and add", "Zoomed on the menu: the Earthquakes switch is flipped on, then Hospital access is picked.")
    f.voice_done(200)
    f.say("sw-3")
    f.camera({"sel": "#layers-btn", "grow": 60}, 1100, max=2.2)
    spot(f, {"sel": "#picker-extra", "pad": 6})
    f.move({"sel": "#picker-extra"}, 700)
    f.board("+1", "Zoomed on the Layer button: the +1 badge counts the extra layer.")
    f.voice_done(200)
    unspot(f)
    f.say("sw-4")
    hint(f, "◌", "Pick Just the island", "to clear the map", TOUR)
    f.click({"sel": "#layers-btn"})
    f.camera({"sel": "#layer-menu", "grow": 16}, 1100, max=1.8)
    f.wait(400)
    f.click({"sel": ".layer-row", "text": "Just the island", "at": [0.4, 0.5]})
    f.camera("fill", 1200, whoosh=0.3)
    f.board("Clear", "Just the island is picked; everything comes off the map.")
    f.voice_done(400)
    f.js("Stage.hideChip()")


def town(f):
    step(f, 6, "Open a town's report", TOWN)
    f.run("() => { document.getElementById('toast-stack').innerHTML = ''; atlas.map.flyTo({ center: [-124.55, 49.27], zoom: 8.6, pitch: 40, bearing: -8, duration: 2000 }); }")
    f.wait(2100)
    f.say("town-1")
    hint(f, "●", "Click a town dot", "point at it first to see its name", TOWN)
    f.move({"lnglat": QUALICUM}, 1100)
    f.wait(900)
    f.board("Point at a town", "The cursor rests on Qualicum Beach and its name pops up.")
    f.click()
    f.move({"x": 760, "y": 520}, 900, wait=False)
    f.voice_done(200)
    f.say("town-2")
    f.wait(1200)
    f.move({"sel": "#panel", "at": [0.5, 0.6]}, 700)
    f.scroll(700, 2600)
    f.board("The report", "The map flies to the town and its report fills the side panel; the panel scrolls.")
    f.voice_done(200)
    f.say("town-3")
    hint(f, "×", "Click the X", "to close the report", TOWN)
    f.click({"sel": "#panel .close-x"})
    f.board("Close", "The X at the top of the report is clicked.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def finder(f):
    step(f, 7, "Rank towns with Town Finder", FINDER)
    f.say("fi-1")
    f.click({"sel": "#finder-btn"})
    f.wait(1200)
    f.board("Town Finder", "Town Finder opens in the side panel and score columns rise on the map.")
    f.voice_done(200)
    f.camera({"sel": "#panel .weights", "grow": 10}, 1300, whoosh=0.3, max=1.9)
    f.say("fi-2")
    hint(f, "⇆", "Drag a slider", "0 ignores it · 5 matters most", FINDER)
    f.wait(1200)
    f.drag(weight_at(f, "hospital", 2), weight_at(f, "hospital", 5), 1100)
    f.board("Weights", "Zoomed on the sliders: one is dragged from 2 to 5.")
    f.voice_done(200)
    f.say("fi-3")
    f.camera({"sel": "#panel .chips", "grow": 20}, 1100, max=1.9)
    f.click({"sel": '#panel [data-preset="sun"]'})
    f.board("Presets", "A preset button sets all the sliders at once.")
    f.voice_done(200)
    f.say("fi-4")
    hint(f, "≡", "Click a town in the list", "to open its report", FINDER)
    f.camera("fill", 1300, whoosh=0.3)
    f.wait(500)
    # the ranking sits below the sliders: scroll the panel down to it
    f.move({"sel": "#panel", "at": [0.5, 0.5]}, 700)
    f.scroll(f.run("() => { const p = document.getElementById('panel'); return document.querySelector('#panel .rank-list').getBoundingClientRect().top - p.getBoundingClientRect().top - 160; }"), 1800)
    f.move({"sel": "#panel .rank-list li", "at": [0.4, 0.5]}, 700)
    f.wait(300)
    f.click({"sel": "#panel .rank-list li", "at": [0.4, 0.5]})
    f.board("Pick from the ranking", "The top town in the ranking is clicked and its report opens.")
    f.voice_done(300)
    f.say("fi-5")
    f.click({"sel": "#panel .close-x"})
    f.wait(900)
    f.click({"sel": "#panel .close-x"})
    f.board("Back and close", "The report's X goes back to the ranking; the Finder's X closes it.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def land(f):
    step(f, 8, "Search parcels with Land Finder", LAND)
    f.say("la-1")
    f.click({"sel": "#land-btn"})
    f.wait_until("!!document.querySelector('.land-rail') && !!document.querySelector('#panel .ld-list')", most=20000)
    f.wait(1500)
    f.board("Land Finder", "Land Finder opens: filters on the left, matches on the right, parcels on the map.")
    f.voice_done(200)
    f.say("la-2")
    spot(f, {"sel": ".land-rail", "pad": 4})
    f.move({"sel": ".land-rail .lr-count"}, 900)
    f.voice_done(200)
    unspot(f)
    f.say("la-3")
    hint(f, "⇆", "Drag a slider or click a choice", "every filter works the same way", LAND)
    f.camera({"sel": ".land-rail", "grow": 10}, 1200, whoosh=0.3, max=1.5)
    f.drag(range_at(f, ".land-rail .lr-slide input", 0.35), range_at(f, ".land-rail .lr-slide input", 0.2), 1100)
    f.wait(400)
    f.click({"sel": ".land-rail .lr-row .chip", "text": "Vancouver Island"})
    f.board("Filters", "Zoomed on the filters: the size slider is dragged and a choice is clicked; the count updates.")
    f.voice_done(200)
    f.js("Stage.hideChip()")
    f.say("la-4")
    f.camera({"sel": ".land-rail .lr-head", "grow": 14}, 1100, max=1.9)
    f.click({"sel": '.land-rail [data-preset="loose"]'})
    f.wait(900)
    f.click({"sel": '.land-rail [data-preset="brief"]'})
    f.board("Presets", "Show everything, then Our brief, at the top of the filters.")
    f.voice_done(200)
    f.say("la-5")
    hint(f, "▤", "Click a match", "to open its report", LAND)
    f.camera("fill", 1200, whoosh=0.3)
    f.move({"sel": "#panel .ld-card", "at": [0.4, 0.5]}, 900)
    f.wait(500)
    f.click({"sel": "#panel .ld-card", "at": [0.4, 0.5]})
    f.wait(2400)
    f.board("A parcel", "The top match is clicked; the map flies to the parcel and its report opens.")
    f.voice_done(200)
    f.say("la-6")
    hint(f, "☆", "Shortlist · Satellite", "buttons under the parcel's chart", LAND)
    f.camera({"sel": "#panel .ld-actions", "grow": 20}, 1100, whoosh=0.3, max=1.9)
    f.click({"sel": "#panel .ld-btn.star"})
    f.wait(500)
    f.click({"sel": "#panel .ld-btn.sat"})
    f.wait(700)
    f.move({"sel": "#panel .ld-actions a", "at": [0.5, 0.5]}, 700)
    f.wait(400)
    f.move({"sel": "#panel .ld-actions a", "nth": 1, "at": [0.5, 0.5]}, 600)
    f.board("Shortlist and satellite", "Zoomed on the buttons: Shortlist and Satellite are clicked, then the two links are pointed at.")
    f.voice_done(200)
    f.camera("fill", 1200)
    f.wait(1400)
    f.click({"sel": "#panel .ld-btn.sat"})
    f.say("la-7")
    hint(f, "‹", "‹ Matches, then ★ Shortlist", "at the top of the panel", LAND)
    f.click({"sel": "#panel .ld-back"})
    f.wait(700)
    f.click({"sel": '#panel [data-tab="short"]'})
    f.board("Your shortlist", "Back to the matches, then the Shortlist tab shows the starred parcel.")
    f.voice_done(200)
    f.say("la-8")
    hint(f, "×", "Click the X", "to close Land Finder", LAND)
    f.click({"sel": "#panel .close-x"})
    f.wait(1600)
    f.voice_done(300)
    f.js("Stage.hideChip()")


def sources(f):
    step(f, 9, "See where the data comes from", CEDAR)
    f.say("so-1")
    f.click({"sel": "#about-btn"})
    f.wait(1500)
    f.board("Data & sources", "The sources view opens.")
    f.voice_done(200)
    f.say("so-2")
    hint(f, "→", "See it on the map", "at the foot of each source", CEDAR)
    f.move({"sel": ".src-card", "nth": 0, "at": [0.4, 0.3]}, 900)
    f.wait(1000)
    f.move({"sel": ".src-go", "nth": 0}, 700)
    f.wait(300)
    f.click()
    f.wait(1200)
    f.board("See it on the map", "Pointing at a source, then See it on the map opens that layer.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def keys(f):
    f.js("Stage.hideChapter()")
    f.camera("fill", 800)
    f.say("keys-1")
    f.cursor(False)
    for key, name, colour in (("L", "Layer menu", KEYS), ("Space", "Play and pause", SPARK), ("← →", "Step a year", SPARK),
                              ("P", "Hide the side panel", TOUR), ("S", "Data & sources", CEDAR), ("Esc", "Close", KEYS)):
        hint(f, key, name, "", colour)
        if key == "L":
            f.key("l", 900)
            f.key("Escape", 300)
        elif key == "Space":
            f.key(" ", 1500)
            f.key(" ", 300)
        elif key == "← →":
            f.key("ArrowRight", 400)
            f.key("ArrowRight", 600)
        elif key == "P":
            f.key("p", 1000)
            f.key("p", 300)
        elif key == "S":
            f.key("s", 1500)
        else:
            f.key("Escape", 800)
        f.wait(200)
    f.board("Shortcuts", "Each key gets a chip as it is pressed: L, Space, arrows, P, S, Escape.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def ending(f):
    f.run("() => { atlas.focus('island'); atlas.map.flyTo({ ...atlas.HOME, duration: 3000 }); }")
    f.camera("rest", 1600, whoosh=0.5)
    f.wait(1700)
    f.js("Stage.fade(0.82, 2000)")
    f.sfx("impact", 0.5)
    f.mark("end")
    f.wait(700)
    f.js("([u, fine]) => Stage.end('A century of Vancouver Island, in open data', u, fine)",
         [f.url, "Open data from British Columbia, Canada and the USGS · nothing to install"])
    f.say("end-1")
    f.board("End card", "The window drifts back; the end card shows the name and address.")
    f.voice_done(3000)
    f.js("Stage.blackout(1600)")
    f.wait(1800)


SCENES = [
    dict(id="intro", title="Introduction", run=intro,
         shows="The title.", camera="App full-frame.", motion="Title rises out of a blur; fade up from black.", sound="A glassy note; music pad fades in.",
         lines={"intro-1": "Here's how to use Island Atlas, step by step."}),
    dict(id="tour", title="Find your way around", run=tour,
         shows="The opening screen and where each control is.", camera="Full-frame.", motion="A spotlight moves from control to control.", sound="Whooshes.",
         lines={"tour-1": "When the app opens, you see just the island, with a dot for each town.",
                "tour-2": "The Layer button, at the top left, puts data on the map.",
                "tour-3": "At the top right are the Land Finder, the Town Finder, Data and sources, and a button that hides the side panel.",
                "tour-4": "The side panel explains whatever you are looking at.",
                "tour-5": "And the timeline along the bottom plays the history layers."}),
    dict(id="map", title="Move the map", run=move_map,
         shows="Drag, scroll, right-drag and the map buttons.", camera="Full-frame; zoom onto the map buttons.", motion="Real drags and scrolls.", sound="Clicks.",
         lines={"map-1": "Drag the map to move around.",
                "map-2": "Scroll to zoom in and out.",
                "map-3": "Hold the right mouse button and drag to tilt and turn the view.",
                "map-4": "The buttons at the top right of the map zoom in and out, and the compass turns north back up."}),
    dict(id="layers", title="Show a data layer", run=layers,
         shows="Opening the Layer menu and picking Wildfires.", camera="Zoom onto the menu, then full-frame.", motion="Cursor clicks.", sound="Clicks, whooshes.",
         lines={"layer-1": "To put data on the map, click Layer, or press L.",
                "layer-2": "Just the island is at the top. Below it, the layers are in three groups: history, towns, and hazards and climate.",
                "layer-3": "Click one to show it. Let's pick Wildfires. The side panel now describes that layer."}),
    dict(id="timeline", title="Play the timeline", run=timeline,
         shows="Play, speed, pause, dragging the slider, and clicking an event marker.", camera="Zoomed on the timeline; full-frame for the event.", motion="Real clicks and a slider drag.", sound="Clicks.",
         lines={"time-1": "History layers play on the timeline. Click play, or press the space bar.",
                "time-2": "Use Speed to choose how many years pass each second.",
                "time-3": "Click pause to stop. Drag the slider to jump to any year.",
                "time-4": "The marks above the slider are events. Click one, and the map jumps there and shows a card about it. The card closes by itself."}),
    dict(id="switching", title="Switch, combine and clear layers", run=switching,
         shows="Replacing a layer, keeping one on with its switch, the +1 badge, and clearing the map.", camera="Zoomed on the menu and the Layer button.", motion="Real clicks.", sound="Clicks.",
         lines={"sw-1": "Pick another layer, and it replaces the one on the map. Here, Earthquakes.",
                "sw-2": "To keep a layer on while you look at another, flip its switch on the right. Then pick the next layer.",
                "sw-3": "The +1 on the Layer button tells you one extra layer is still showing.",
                "sw-4": "To clear the map, open Layer and pick Just the island."}),
    dict(id="town", title="Open a town's report", run=town,
         shows="Pointing at and clicking a town dot, scrolling its report, closing it.", camera="Full-frame.", motion="Hover, click, scroll.", sound="Clicks.",
         lines={"town-1": "Point at a town dot to see its name, and click it to open the town's report.",
                "town-2": "The map flies to the town and the report opens in the side panel. Scroll down to see all of it.",
                "town-3": "Click the X at the top to close it."}),
    dict(id="finder", title="Rank towns with Town Finder", run=finder,
         shows="Opening Town Finder, a slider, a preset, opening a town from the ranking, closing.", camera="Zoomed on the sliders and presets; full-frame for the list.", motion="A real slider drag.", sound="Clicks.",
         lines={"fi-1": "Click Town Finder to rank the towns by what matters to you.",
                "fi-2": "Each slider sets how much one thing counts, from zero, ignore it, to five, matters most. Drag one, and the ranking updates right away.",
                "fi-3": "Or click a preset to set them all at once.",
                "fi-4": "The columns on the map show each town's score. Click a town in the list to open its report.",
                "fi-5": "Closing the report takes you back to the ranking. Click the X again to leave Town Finder."}),
    dict(id="land", title="Search parcels with Land Finder", run=land,
         shows="Land Finder filters, presets, opening a parcel, shortlist, satellite, closing.", camera="Zoomed on the filters, presets and parcel buttons.", motion="Real drags and clicks.", sound="Clicks.",
         lines={"la-1": "Click Land Finder to search the island's large private parcels.",
                "la-2": "The filters are on the left. The number at the top shows how many parcels match.",
                "la-3": "Drag a slider or click a choice to change a filter, and the matches update.",
                "la-4": "Show everything turns every filter off. Our brief puts them back to the starting set.",
                "la-5": "The best matches are listed on the right, and drawn on the map. Click one to open its report.",
                "la-6": "Click Shortlist to save it, and Satellite to see the land from above. The links open listings and Google Maps for that spot.",
                "la-7": "The arrow at the top goes back to the list, and the Shortlist tab keeps the parcels you saved.",
                "la-8": "Click the X to close Land Finder."}),
    dict(id="sources", title="See where the data comes from", run=sources,
         shows="Opening Data & sources and jumping to a layer from it.", camera="Full-frame.", motion="Hover, click.", sound="Clicks.",
         lines={"so-1": "Click Data and sources to see where every layer comes from.",
                "so-2": "Point at a source to read about it, and click See it on the map to open that layer."}),
    dict(id="keys", title="Keyboard shortcuts", run=keys,
         shows="The keyboard shortcuts, each pressed in turn.", camera="Full-frame.", motion="A chip for each key.", sound="Key clicks.",
         lines={"keys-1": "Finally, the shortcuts. L opens the layer menu, space plays and pauses, the arrow keys step a year, P hides the side panel, S opens the sources, and Escape closes things."}),
    dict(id="end", title="End card", run=ending,
         shows="Title and address.", camera="Back to the floating window.", motion="Logo spins up.", sound="Soft impact; music fades.",
         lines={"end-1": "That's everything you need. Enjoy exploring."}),
]
