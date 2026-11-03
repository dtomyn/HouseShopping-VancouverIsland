"""The Island Atlas explainer: every scene's narration, camera, motion and sound, in order.

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
    text = text.replace("3D", "three-D").replace("→", "to")
    return re.sub(r"\s+", " ", text)


SPARK = "#ff8a3d"
QUAKE = "#f9d65c"
FUTURE = "#e86cff"
TOWN = "#3ecf8e"
FINDER = "#a99bff"
CEDAR = "#d8a06a"

QUALICUM = [-124.443, 49.348]


def chapter(f, n, title, sub, colour):
    f.js("([n, t, s, c]) => Stage.chapter(n, t, s, c)", [n, title, sub, colour])
    f.sfx("whoosh", 0.35, seconds=0.6, pan_from=-0.8, pan_to=-0.2)


def chip(f, icon, head, body, colour, side="left"):
    f.js("([i, h, b, c, s]) => Stage.chip(i, h, b, c, s)", [icon, head, body, colour, side])
    f.sfx("blip", 0.8, note=3)


def focus_only(f, layer):
    """Shows one layer on its own, as if picked fresh from the menu."""
    f.run("id => { atlas.state.visible.clear(); atlas.focus(id); }", layer)


def slider(f, criterion, value):
    """The point on a Town Finder slider for a weight (0-5), in app pixels."""
    return f.run("""([id, v]) => {
      const i = document.querySelector(`.weight input[data-id="${id}"]`);
      const r = i.getBoundingClientRect(), thumb = 16;
      return { x: r.left + thumb / 2 + (r.width - thumb) * (v - +i.min) / (+i.max - +i.min), y: r.top + r.height / 2 };
    }""", [criterion, value])


# ---------------------------------------------------------------------------------------------------

def cold_open(f):
    # Black. The question writes itself, then the island rises out of the dark as the map flies in.
    f.wait(500)
    f.run("() => { atlas.map.stop(); atlas.map.jumpTo({ center: [-126.6, 50.9], zoom: 5.0, pitch: 0, bearing: 0 }); }")
    f.js("Stage.title('Where should we retire?', '', ['retire?'])")
    f.sfx("blip", 0.6, note=0)
    f.say("open-1")
    f.board("The question", "Black frame; the title rises word by word out of a blur, the last word in the warm gradient.")
    f.wait(2600)
    f.js("Stage.fade(0, 2600)")
    f.run("() => atlas.map.flyTo({ ...atlas.HOME, zoom: 7.3, duration: 8200, curve: 1.5, essential: true })")
    f.voice_done(150)
    f.js("Stage.hideTitle(900)")
    f.sfx("riser", 0.65)
    f.say("open-2")
    f.wait(1400)
    f.board("Out of the dark", "The map fades up full-frame as it flies in from the north; fires start to flare as the timeline plays.")
    f.voice_done(250)


def reveal(f):
    # Impact: the camera pulls back so the app becomes a window floating on the aurora. Stats count up.
    f.sfx("impact", 0.9)
    f.mark("pulse")
    f.camera("rest", 1900, whoosh=0.6)
    f.wait(500)
    f.say("reveal-1")
    found = f.facts
    f.wait(900)
    f.js("s => Stage.stats(s)", [
        {"v": found["layers"], "k": "map layers", "c": "#ffb35c"},
        {"v": found["towns"], "k": "towns & islands", "c": "#4cc9f0"},
        {"v": found["fires"] + found["quakes"], "k": "fires & quakes mapped", "c": "#ff6b6b"},
        {"v": 170, "k": "years, 1900 → 2070", "c": "#b28cff"},
    ])
    for i in range(4):
        f.sfx("blip", 0.7, note=i * 2)
        f.wait(160)
    f.board("The reveal", "Pull back from full-frame to the floating window; four stat cards rise and count up from the data.")
    f.voice_done(500)
    # set up the next scene under the cards: back to 1919, paused
    f.run("() => { atlas.setPlaying(false); atlas.setTime(1919); }")


def time_machine(f):
    f.js("Stage.hideStats()")
    chapter(f, 1, "A century in motion", "Wildfires · 1919 to today", SPARK)
    f.cursor(True)
    f.camera({"sel": "#timeline", "grow": 40}, 1500, whoosh=0.4, max=1.9)
    f.wait(700)
    f.say("time-1")
    f.click({"sel": "#speed-sel"}, real=False)
    f.run("() => { const s = document.getElementById('speed-sel'); s.value = '8'; s.dispatchEvent(new Event('change')); }")
    f.wait(300)
    f.board("Speed and play", "Zoomed on the timeline: the cursor sets 8 years a second, then clicks play.")
    f.click({"sel": "#play"})
    f.move({"x": 980, "y": 330}, 900, wait=False)
    f.camera("fill", 1500, whoosh=0.4)
    f.wait(1600)
    # a slow push that keeps the year counter in shot
    f.camera({"cx": 700, "cy": 520, "z": 1.32}, 9000, ease="inOut")
    f.cursor(False)
    chip(f, "🔥", f"{f.facts['fires']:,} fires mapped", "Every perimeter and ignition since 1919 · BC Wildfire Service", SPARK)
    f.wait_until("atlas.state.time > 1985")
    f.board("A hundred years of fire", "Slow push into the island while the years race by; fires flare white-hot and cool to scars.")
    f.wait_until("atlas.state.time > 2010.5")
    f.say("time-2")
    f.wait_until("atlas.state.time >= 2023.62")
    f.run("() => atlas.setPlaying(false)")
    f.js("Stage.hideChip()")
    f.camera({"sel": ".toast", "grow": 16}, 1300, max=2.0)
    f.board("Moments that mattered", "Playback stops on June 2023; the camera zooms onto the Cameron Bluffs toast while a shockwave rings out on the map.")
    f.voice_done(500)


def quakes(f):
    chapter(f, 2, "Beneath the island", "Earthquakes at their true depth", QUAKE)
    f.camera("fill", 1200, whoosh=0.4)
    f.cursor(True)
    f.click({"sel": "#layers-btn"})
    f.camera({"sel": "#layer-menu", "grow": 12}, 1100, max=1.7)
    f.say("quake-1")
    f.wait(900)
    f.board("Switch layers", "The layer menu, zoomed: grouped layers, each with its own colour and years.")
    f.click({"sel": ".layer-row", "text": "Earthquakes"})
    f.move({"x": 1000, "y": 360}, 800, wait=False)
    f.camera("fill", 1300, whoosh=0.4)
    f.run("() => atlas.map.easeTo({ center: [-125.6, 49.6], zoom: 7.1, pitch: 72, bearing: 32, duration: 6500 })")
    f.cursor(False)
    chip(f, "◉", f"{f.facts['quakes']:,} earthquakes", "M2.5 and up since 1900, drawn at 3× their real depth · USGS", QUAKE, side="left")
    f.wait(3000)
    f.board("The ground opens up", "The map tilts to 72° and swings round; quakes hang beneath the island at their real depths.")
    f.voice_done(300)
    f.js("Stage.hideChip()")
    f.cursor(True)
    f.camera({"sel": "#timeline", "grow": 30}, 1200, max=1.6)
    f.click({"sel": '.ev[title*="1946"]'})
    f.say("quake-2")
    f.camera("fill", 1600)
    f.move({"x": 1100, "y": 260}, 900, wait=False)
    f.wait(1700)
    f.camera({"cx": 800, "cy": 440, "z": 1.35}, 3500)
    f.board("1946", "Clicking the 1946 marker flies the map to the epicentre; a toast and a shockwave mark it.")
    f.voice_done(600)
    f.cursor(False)


def future(f):
    chapter(f, 3, "Looking ahead", "Climate projections · hazards · health", FUTURE)
    f.camera("fill", 1200, whoosh=0.3)
    f.run("() => atlas.map.flyTo({ ...atlas.HOME, duration: 2400 })")
    f.cursor(True)
    f.click({"sel": "#layers-btn"})
    f.click({"sel": ".layer-row", "text": "Future climate"})
    f.run("() => { atlas.state.visible.clear(); atlas.state.visible.add('future'); }")
    f.say("future-1")
    f.move({"lnglat": [-124.9936, 49.6866]}, 1200)
    chip(f, "⇡", "Hot days by the 2050s", "26 downscaled climate models · a projection, not a record", FUTURE, side="left")
    f.wait(800)
    f.board("Looking ahead", "Future climate's hatched surface; hovering Courtenay shows its projected hot days with the model range.")
    f.voice_done(300)
    f.js("Stage.hideChip()")
    f.move({"x": 1060, "y": 160}, 700, wait=False)
    f.say("future-2")
    for layer, icon, head, colour in (("seismic", "∿", "Shaking hazard", "#e86cff"), ("hospitals", "✚", "Hospital access", "#6c8cff"), ("smoke", "☁", "Wildfire smoke", "#c9b8a0")):
        focus_only(f, layer)
        if layer == "smoke":  # its timeline starts in a clear year; show the smokiest
            f.run("() => atlas.setTime(2017.6)")
        f.sfx("whoosh", 0.25, seconds=0.5, bright=0.6)
        f.js("([i, h, c]) => Stage.chip(i, h, '', c)", [icon, head, colour])
        f.wait(1900)
    f.board("A click away", "A quick montage: shaking hazard, drive time to a 24/7 ER, and smoke days, each with its own chip.")
    f.js("Stage.hideChip()")
    f.voice_done(400)


def town(f):
    chapter(f, 4, "A report card for every town", "Prices · safety · climate · care", TOWN)
    focus_only(f, "fires")
    # stop playback and clear event cards, which could sit over the town pin
    f.run("() => { atlas.setPlaying(false); document.getElementById('toast-stack').innerHTML = ''; }")
    f.run("() => atlas.map.flyTo({ center: [-124.55, 49.27], zoom: 9.1, pitch: 50, bearing: -8, duration: 2600 })")
    f.wait(2700)
    f.say("town-1")
    f.move({"lnglat": QUALICUM})
    f.wait(500)
    f.board("Pick a town", "The cursor finds Qualicum Beach; its tooltip pops up.")
    f.click()
    f.move({"x": 760, "y": 520}, 900, wait=False)
    f.wait(1300)
    f.camera({"sel": "#panel .metric-grid", "grow": 14}, 1500, whoosh=0.4, max=2.0)
    f.say("town-2")
    f.wait(1600)
    f.js("t => Stage.spot(t)", {"sel": "#panel .metric", "text": "Emergency room", "pad": 6})
    f.board("The report card", "Zoomed into the report: a spotlight picks out the drive time to the nearest 24/7 emergency room.")
    f.wait(2600)
    f.js("Stage.spot(null)")
    f.move({"sel": "#panel", "at": [0.5, 0.6]}, 700)
    f.scroll(560, 2600)
    f.board("Trends", "The panel glides down to the warming trend, river record and price and population charts.")
    f.voice_done(500)


def finder(f):
    chapter(f, 5, "Rank them your way", "Town Finder", FINDER)
    f.camera("fill", 1200, whoosh=0.3)
    f.click({"sel": "#finder-btn"})
    f.say("finder-1")
    f.move({"x": 900, "y": 300}, 800, wait=False)
    f.wait(1400)
    f.run("() => atlas.map.easeTo({ ...atlas.HOME, zoom: 7.4, pitch: 58, bearing: 12, duration: 9000 })")
    factors = f.run("() => document.querySelectorAll('#panel .weight').length")
    chip(f, "◎", "Town Finder", f"{factors} factors, weighted your way · every town and island ranked", FINDER, side="left")
    f.board("Columns rise", "Every town becomes a column sized by its score, and the map slowly orbits.")
    f.voice_done(300)
    f.js("Stage.hideChip()")
    f.camera({"sel": "#panel .weights", "grow": 10}, 1300, whoosh=0.3, max=1.9)
    f.wait(500)
    f.say("finder-2")
    f.drag(slider(f, "hospital", 2), slider(f, "hospital", 5), 1000)
    f.wait(300)
    f.drag(slider(f, "dry", 2), slider(f, "dry", 5), 1000)
    f.board("Drag the sliders", "Zoomed onto the weights: hospital access and sunshine dragged up to 5.")
    f.move({"x": 760, "y": 420}, 800, wait=False)
    f.camera("fill", 1500, whoosh=0.4)
    f.run("() => atlas.map.easeTo({ bearing: -20, pitch: 60, zoom: 7.6, duration: 7000 })")
    f.wait(1500)
    f.cursor(False)
    f.board("Re-ranked", "Columns grow and shrink to the new weights; the top ten carry labels.")
    f.voice_done(300)
    f.camera({"sel": "#panel .rank-list", "grow": 10}, 1300, max=1.8)
    f.say("finder-3")
    f.wait(1800)
    f.board("Your ranking", "The ranked list, islands included.")
    f.voice_done(500)


def sources(f):
    chapter(f, 6, "Every number, traceable", "Data & sources", CEDAR)
    f.camera("fill", 1200, whoosh=0.3)
    f.cursor(True)
    f.click({"sel": "#about-btn"})
    f.wait(900)
    f.camera({"sel": ".src-round", "grow": 20}, 1600, whoosh=0.4, max=1.6)
    f.say("sources-1")
    f.wait(1200)
    f.board("A cedar round", "Each wedge is a data source and each ring a year, glowing with that source's record.")
    for nth in (0, 2, 5):
        f.move({"sel": ".src-card", "nth": nth, "at": [0.3, 0.3]}, 700)
        f.wait(900)
    f.voice_done(200)
    f.say("sources-2")
    f.camera("fill", 1800)
    f.wait(800)
    f.board("Sources", "Hovering the source cards lights their wedges.")
    f.voice_done(400)


def ending(f):
    f.js("Stage.hideChapter()")
    f.click({"sel": ".sources .close-x"})
    f.cursor(False)
    f.run("() => { atlas.state.visible.clear(); atlas.focus('fires'); atlas.map.flyTo({ ...atlas.HOME, duration: 4000 }); atlas.setTime(1919); atlas.setPlaying(true); }")
    f.camera("rest", 1600, whoosh=0.5)
    f.wait(1700)
    f.camera({"cx": 800, "cy": 467, "z": 0.62}, 2600)
    f.js("Stage.fade(0.82, 2200)")
    f.sfx("impact", 0.55)
    f.mark("end")
    f.wait(900)
    f.js("([u, fine]) => Stage.end('A century of Vancouver Island, in open data', u, fine)",
         [f.url, "Wildfires · earthquakes · floods · smoke · climate · prices · crime · hospitals<br>Open data from British Columbia, Canada and the USGS · no backend, nothing to install"])
    f.say("end-1")
    f.board("End card", "The window drifts back into the dark; the end card spins up the logo and the address.")
    f.voice_done(3800)
    f.js("Stage.blackout(1600)")
    f.wait(1800)


SCENES = [
    dict(id="open", title="Cold open", run=cold_open,
         shows="The question the app was built to answer, and the map flying in.",
         camera="App full-frame (no window edges). The map's own flight from the north down onto the island.",
         motion="Kinetic title: words rise out of a blur, 'retire?' in a warm gradient. Fade up from black under it.",
         sound="A single glassy note, then a riser building toward the reveal. Music pad fades in.",
         lines={"open-1": "We had one question. Where on Vancouver Island should we retire?",
                "open-2": "So we asked a century of open data."}),
    dict(id="reveal", title="Island Atlas", run=reveal,
         shows="What the app is, in four numbers taken from its data.",
         camera="Pull back from full-frame to the app as a floating window over a slow aurora and contour lines.",
         motion="Four stat cards rise in a stagger and count up.",
         sound="Impact on the pull-back, a whoosh, a blip per card; the arpeggio comes in.",
         lines={"reveal-1": "This is Island Atlas. {layers} layers of government data, for {towns} towns and islands, from nineteen hundred out to twenty seventy, all in one living, 3D map."}),
    dict(id="time", title="A century in motion", run=time_machine,
         shows="The timeline: speed, play, wildfires flaring and scarring, event toasts.",
         camera="Zoom onto the timeline for the clicks, back to full-frame, a 9-second push in while the years run, then onto the event toast.",
         motion="Chapter tag slides in; cursor glides on an arc, ripples on each click; fact chip rises from the bottom.",
         sound="Mouse clicks, whooshes on zooms.",
         lines={"time-1": "Press play, and a hundred years unfold. Every mapped wildfire flares up, then cools into a burn scar.",
                "time-2": "Moments that mattered pop up as they pass, like the twenty twenty-three Cameron Bluffs fire, which cut the only highway to the west coast."}),
    dict(id="quakes", title="Beneath the island", run=quakes,
         shows="The layer menu, earthquakes at depth, and jumping to a historic event from the timeline.",
         camera="Zoom onto the layer menu, then full-frame while the map tilts to 72° and swings; zoom to the timeline marker and back.",
         motion="Map orbit (the app's own camera); toast and shockwave on the 1946 quake.",
         sound="Clicks, whooshes.",
         lines={"quake-1": "Switch layers, and the ground opens up. {quakes:,} earthquakes, each drawn at its true depth beneath the island.",
                "quake-2": "Pick a moment on the timeline, and the atlas takes you there. This is the magnitude {m1946} quake of nineteen forty-six."}),
    dict(id="future", title="Looking ahead", run=future,
         shows="Future climate projections, then a quick tour of shaking hazard, hospital access and smoke.",
         camera="Full-frame on the island.",
         motion="Hover tooltip on a town; a three-layer montage with a chip for each.",
         sound="Clicks, a short whoosh per layer change.",
         lines={"future-1": "It looks ahead, too. Twenty-six climate models, scaled down to the island, project how many scorching days each town can expect by mid-century.",
                "future-2": "Earthquake shaking hazard, the drive to the nearest emergency room, and wildfire smoke are each a click away."}),
    dict(id="town", title="A report card for every town", run=town,
         shows="Clicking a town on the map opens its Town Report.",
         camera="The map flies to the Oceanside coast; the stage zooms into the report's metric grid and holds while it scrolls.",
         motion="Spotlight dims everything but the emergency-room figure; the panel glides down.",
         sound="Click, whoosh.",
         lines={"town-1": "Click any town for its report card.",
                "town-2": "Home prices, crime, the local climate and how fast it's warming, nearby fires and quakes, and how many minutes to an emergency room that never closes."}),
    dict(id="finder", title="Rank them your way", run=finder,
         shows="The Town Finder: weights, live re-ranking, 3D score columns and the ranked list.",
         camera="Full-frame while columns rise and the map orbits; zoom onto the sliders for two drags; back out to see the columns change; onto the ranking.",
         motion="Real slider drags; columns animate to new heights.",
         sound="Clicks on each grab, whooshes.",
         lines={"finder-1": "Then let the atlas do the weighing. In the Town Finder, you decide what matters most.",
                "finder-2": "Want a hospital close by, and more sunshine? Drag the sliders, and every town re-ranks instantly, rising as columns across the map.",
                "finder-3": "The islands are in the running too, with their ferry dependence counted against them."}),
    dict(id="sources", title="Every number, traceable", run=sources,
         shows="Data & sources: the cedar-round chart and source cards.",
         camera="Zoom onto the cedar round, then back to full-frame.",
         motion="The view's own entrance animation; hovering cards lights their wedges.",
         sound="Click, whoosh.",
         lines={"sources-1": "And every number is traceable. Each data source is a wedge of this cedar round, and every ring is a year of its record.",
                "sources-2": "Wildfires, earthquakes, rivers, climate, housing and health, all from open public data. No backend, nothing to install."}),
    dict(id="end", title="End card", run=ending,
         shows="Title, tagline, address and data credits.",
         camera="Back to the floating window, then it drifts away into the dark.",
         motion="Logo ring spins up; title and lines rise word by word.",
         sound="Soft impact; music resolves and fades.",
         lines={"end-1": "Island Atlas. A century of Vancouver Island, in open data."}),
]
