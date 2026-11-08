"""A short film for each layer, and an overview of them all that points to those films.

  .venv/Scripts/python.exe video/render.py --film overview          every layer in a few minutes, pointing to each film
  .venv/Scripts/python.exe video/render.py --film layer-fires       one layer's film (any layer id: layer-quakes, ...)
  .venv/Scripts/python.exe video/render.py --film all --storyboard  storyboards for the overview and every layer film

Each layer film has the same shape: a title with a hook, the layer turned on from the menu with three numbers counting up,
one or two "wow" scenes that show what only this layer can, a close look at its side panel, and an end card that sends
you to the overview. The overview is a minute-ish for the map and the menu, a moment for every layer (with a chip naming
its own film), and an end card listing them.

Adding a layer to the app needs nothing here: the layer list, names, headlines, opening sentences, headline numbers and
timeline events are read from the app as it films (video/layer_facts.js). A layer with no entry in SPECS gets a generic
film (it plays its timeline or circles the island, then reads its panel) and a generic moment in the overview. Write a
SPECS entry to give it a proper hook and wow scene. Links for the YouTube descriptions go in video/films.json.

Line ids are "<layer>-..." in a layer film and "ov-..." in the overview, so their cached narration never clashes.
"""
import json
import pathlib
import re
import types

import storyboard as main

VIDEO = pathlib.Path(__file__).resolve().parent
hint, spot, unspot = main.hint, main.spot, main.unspot
SOUNDS = main.SOUNDS

# The facts script, minus its comment lines (Playwright wants a bare function expression).
FACTS = "\n".join(line for line in (VIDEO / "layer_facts.js").read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("//"))

HOME = "atlas.HOME"
KEYS = "#ffb35c"
TOUR = "#4cc9f0"


def spoken(text):
    """What the voice reads: the caption text with symbols and short units written out."""
    text = main.spoken(text)
    text = re.sub(r"\$([\d.,]+)K\b", r"\1 thousand dollars", text)
    text = re.sub(r"\$([\d.,]+)M\b", r"\1 million dollars", text)
    text = re.sub(r"\$([\d,]+)\b", r"\1 dollars", text)
    text = re.sub(r"([\d.,]+)K ha\b", r"\1 thousand hectares", text)
    text = re.sub(r"\bM(\d\.\d)\b", r"magnitude \1", text)
    text = re.sub(r"(\d)\s?×", r"\1 times", text)
    text = re.sub(r"\+(\d)", r"plus \1", text)
    text = re.sub(r"−(\d)", r"minus \1", text)
    text = text.replace("°C", " degrees").replace("°", " degrees").replace(" min ", " minutes ").replace(" min.", " minutes.")
    text = re.sub(r"(\d) min\b", r"\1 minutes", text).replace(" ha ", " hectares ").replace(" h ", " hours ")
    text = re.sub(r"(\d)%", r"\1 percent", text)
    return re.sub(r"\s+", " ", text)


def links():
    """YouTube links per film name, filled in once each is published (video/films.json)."""
    path = VIDEO / "films.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def film_name(layer_id):
    return "island-atlas-trails" if layer_id == "trails" else f"island-atlas-{layer_id}"


# ---------------------------------------------------------------------------------------------------
# moves shared by every film

def fly(f, view, ms=3000, wait=True):
    """Moves the map: view is a JS object literal for flyTo, e.g. "{ center: [-125, 49.6], zoom: 8, pitch: 50 }"."""
    f.run(f"() => atlas.map.flyTo({{ ...{view}, duration: {ms}, essential: true }})")
    if wait:
        f.wait(ms + 100)


def orbit(f, degrees, ms):
    """A slow turn around the current centre (doesn't wait)."""
    f.run(f"() => atlas.map.easeTo({{ bearing: atlas.map.getBearing() + {degrees}, duration: {ms}, easing: (t) => t }})")


def set_speed(f, speed):
    """The timeline's speed menu offers ½ to 8 years a second; faster sweeps set the speed directly (the menu shows 8)."""
    menu = speed if speed in (0.5, 1, 2, 4, 8) else 8
    f.run(f"() => {{ const s = document.getElementById('speed-sel'); s.value = '{menu:g}'; s.dispatchEvent(new Event('change')); atlas.state.speed = {speed}; }}")


def play_years(f, start, end, speed, extra=600):
    """Plays the timeline from `start` at `speed` years a second until it reaches `end` (or the end of the layer's range)."""
    # Playing through the years, every event crossed would flash up on the timeline's ticker: hide it while playing.
    # Slow playback (under a year a second, through one event you want to see) keeps it.
    quiet = speed >= 1
    f.run(f"() => {{ atlas.setPlaying(false); atlas.setTime({start}); {'document.getElementById(`event-ticker`).style.visibility = `hidden`;' if quiet else ''} }}")
    set_speed(f, speed)
    f.click({"sel": "#play"})
    ms = max(1000, (end - start) / speed * 1000)
    f.wait_until(f"!atlas.state.playing || atlas.state.time >= {end}", most=ms + 4000)
    f.run("() => atlas.setPlaying(false)")
    if quiet:
        f.run("() => { const t = document.getElementById('event-ticker'); t.hidden = true; t.style.visibility = ''; }")
    f.wait(extra)


def open_layer(f, name, colour):
    """Opens the Layer menu and clicks the layer's name: it goes on the map and its story opens."""
    hint(f, "☰", "Layer menu", f"click {name}", colour)
    f.click({"sel": "#layers-btn"})
    f.camera({"sel": "#layer-menu", "grow": 16}, 1100, whoosh=0.3, max=1.8)
    f.wait(500)
    row = {"sel": "#layer-menu .layer-row", "text": name, "at": [0.4, 0.5]}
    spot(f, {"sel": "#layer-menu .layer-row", "text": name, "pad": 6})
    f.move(row, 800)
    f.wait(500)
    unspot(f)
    f.click(row)
    f.js("Stage.hideChip()")
    f.camera("fill", 1300, whoosh=0.3)


def panel_scroll_to(f, sel, text=None, offset=70, ms=1400):
    f.move({"sel": "#panel", "at": [0.5, 0.55]}, 600)
    dy = f.run("""([sel, text, off]) => {
      const p = document.getElementById('panel');
      const el = [...p.querySelectorAll(sel)].find((e) => !text || e.textContent.includes(text));
      return el ? el.getBoundingClientRect().top - p.getBoundingClientRect().top - off : 0;
    }""", [sel, text, offset])
    if abs(dy) > 4:
        f.scroll(dy, ms)


def panel_top(f):
    dy = f.run("() => -document.getElementById('panel').scrollTop")
    if abs(dy) > 4:
        f.move({"sel": "#panel", "at": [0.5, 0.5]}, 500)
        f.scroll(dy, 900)


def chip_click(f, sel):
    f.click({"sel": f"#panel {sel}"})
    f.wait(700)


def hover_town(f, town, ms=900):
    f.move({"lnglat": f.run(f"() => {{ const m = atlas.data.munis.find((m) => m.name === {json.dumps(town)}); return m ? [m.lon, m.lat] : atlas.map.getCenter().toArray(); }}")}, ms)


def event_marker(f, title_part):
    """Clicks a timeline marker by part of its title: the map flies there and the event opens in the side panel."""
    f.click({"sel": f'.ev[title*="{title_part}"]'})
    f.camera("fill", 1300, whoosh=0.3)


def event_panel(f, title, why):
    """Settles on the event's own panel, then goes back to the layer's story."""
    f.camera({"sel": "#panel", "grow": 10}, 1200, max=1.5)
    f.wait(900)
    f.board(title, why)


def event_back(f):
    f.click({"sel": "#panel .ev-back"})
    f.wait(500)


# ---------------------------------------------------------------------------------------------------
# the layer specs: a hook, three counters, the wow scenes and the panel close-up
#
# stats: (value key in facts, label, optional suffix/prefix) - counted up on screen
# wow:   scene dicts like the main film's (id, title, run, lines, shows, camera, motion, sound); line ids start with the layer id
# panel: (selector, text inside it or None, line) - the part of the side panel the camera settles on
# moment: the overview's few seconds for this layer: run(f), and a line

def fires_burn(f):
    fly(f, "{ center: [-125.15, 49.65], zoom: 7.5, pitch: 58, bearing: -38 }", 2600)
    f.say("fires-burn-1")
    hint(f, "▶", "Play", "8 years a second", "#ff8a3d")
    orbit(f, 45, 15000)
    play_years(f, 1919, 2026.9, 8, extra=200)
    f.board("A century of fire", "From 1919 to today in about 13 seconds; burn scars glow and fade as the camera turns.")
    f.voice_done(200)
    f.js("Stage.hideChip()")


def fires_cameron(f):
    f.say("fires-cam-1")
    hint(f, "◆", "Click a marker", "the Cameron Bluffs fire, 2023", "#ff8a3d")
    f.camera({"sel": "#timeline", "grow": 30}, 1100, max=1.8)
    f.wait(400)
    event_marker(f, "Cameron")
    f.run("() => atlas.map.easeTo({ pitch: 62, bearing: 20, duration: 4000 })")
    f.wait(2600)
    event_panel(f, "Cameron Bluffs", "The 2023 marker is clicked; the map flies to Cameron Lake and the fire's story opens in the side panel.")
    f.voice_done(300)
    f.camera("fill", 1100)
    event_back(f)
    f.js("Stage.hideChip()")


def quakes_depth(f):
    f.run("() => atlas.setTime(2026.5)")
    fly(f, "{ center: [-126.2, 49.35], zoom: 7.4, pitch: 76, bearing: 62 }", 4200)
    f.say("quakes-depth-1")
    orbit(f, -30, 12000)
    f.wait(4500)
    f.board("Beneath the island", "Tilted almost flat: thousands of quakes hang at their depths under the island.")
    f.voice_done(300)


def quakes_1946(f):
    f.say("quakes-46-1")
    fly(f, "{ center: [-125.34, 49.76], zoom: 7.6, pitch: 50, bearing: -10 }", 2400, wait=False)
    play_years(f, 1945.9, 1947.2, 0.5, extra=1200)
    f.camera({"sel": ".event-ticker", "grow": 60}, 1200, max=1.8)
    f.board("1946", "The timeline crosses June 1946; a shockwave spreads from the epicentre and the event shows on the timeline.")
    f.voice_done(300)
    f.camera("fill", 1100)


def seismic_surface(f):
    fly(f, "{ center: [-124.6, 49.2], zoom: 7.6, pitch: 60, bearing: -25 }", 3200)
    f.say("seismic-surf-1")
    orbit(f, 40, 14000)
    f.wait(2500)
    hover_town(f, "{se_top}".format(**f.facts))
    f.wait(1600)
    f.board("Highest hazard", "The colours run brightest at the southern tip; the cursor rests on the highest-hazard town.")
    f.voice_done(300)
    hover_town(f, "{se_low}".format(**f.facts), 1400)
    f.say("seismic-surf-2")
    f.wait(1400)
    f.voice_done(300)


def rivers_2021(f):
    f.say("rivers-ar-1")
    hint(f, "◆", "Click a marker", "November 2021", "#4cc9f0")
    f.camera({"sel": "#timeline", "grow": 30}, 1100, max=1.8)
    f.wait(400)
    event_marker(f, "Atmospheric")
    f.run("() => atlas.map.easeTo({ zoom: 8.2, pitch: 60, bearing: -30, duration: 4000 })")
    f.wait(2600)
    event_panel(f, "Atmospheric river", "The November 2021 marker: gauges across the south island spike, and the story opens in the side panel.")
    f.voice_done(300)
    f.camera("fill", 1100)
    event_back(f)
    f.js("Stage.hideChip()")


def rivers_decades(f):
    fly(f, "{ center: [-125.2, 49.6], zoom: 7.3, pitch: 55, bearing: -20 }", 2400)
    f.say("rivers-dec-1")
    orbit(f, 30, 12000)
    play_years(f, 1958, 2025.9, 6, extra=200)
    f.board("Six decades of floods", "Gauge columns jump in flood years and settle in dry ones.")
    f.voice_done(300)


def climate_warm(f):
    fly(f, "{ center: [-125.0, 49.5], zoom: 7.3, pitch: 52, bearing: -20 }", 2400)
    f.say("climate-warm-1")
    hint(f, "▶", "Play", "a century in 15 seconds", "#f25f5c")
    orbit(f, 40, 16000)
    play_years(f, 1902, 2020.9, 8, extra=200)
    f.board("Warming", "Station columns turn from blue to red as the years run.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def climate_stripes(f):
    f.say("climate-str-1")
    panel_scroll_to(f, "h3", "warming stripes", offset=40)
    f.camera({"sel": "#panel", "grow": 10}, 1300, whoosh=0.3, max=1.5)
    f.wait(1200)
    f.board("Warming stripes", "Zoomed on the panel's warming stripes: one stripe per year, blue to red.")
    f.voice_done(300)
    f.camera("fill", 1100)


def normals_chips(f):
    fly(f, "{ center: [-125.0, 49.5], zoom: 7.4, pitch: 55, bearing: -15 }", 2400)
    f.say("normals-ch-1")
    f.camera({"sel": "#panel .chips", "grow": 40}, 1200, max=1.9)
    f.wait(800)
    for key in ("wetDays", "frostDays", "snow"):
        chip_click(f, f'[data-v="{key}"]')
        f.wait(900)
    f.camera("fill", 1200)
    f.board("Four climates", "Sunshine, rain days, frost and snow: the columns re-shape with each chip.")
    f.voice_done(300)
    chip_click(f, '[data-v="sun"]')
    f.say("normals-ch-2")
    orbit(f, 35, 9000)
    f.wait(3000)
    f.voice_done(300)


def future_chips(f):
    fly(f, "{ center: [-125.0, 49.5], zoom: 7.4, pitch: 55, bearing: -15 }", 2400)
    f.camera({"sel": "#panel .chip-row", "grow": 90}, 1200, max=1.6)
    f.say("future-ch-1")
    chip_click(f, '[data-period="0"]')
    f.wait(1400)
    f.voice_done(200)
    f.say("future-ch-2")
    chip_click(f, '[data-period="2"]')
    f.wait(1600)
    f.voice_done(200)
    f.say("future-ch-3")
    chip_click(f, '[data-scenario="ssp585"]')
    f.wait(1600)
    f.voice_done(200)
    f.board("The 2050s", "Today, then the 2050s, then the high-emissions scenario: hot-day columns grow.")
    f.say("future-ch-4")
    chip_click(f, '[data-show="frost"]')
    chip_click(f, '[data-map="chg"]')
    f.camera("fill", 1200)
    orbit(f, 35, 9000)
    f.wait(2500)
    f.board("Change from today", "Frost days, shown as change from today: losses everywhere.")
    f.voice_done(300)


def population_grow(f):
    fly(f, "{ center: [-124.2, 48.95], zoom: 8.2, pitch: 58, bearing: -25 }", 2600)
    f.say("population-grow-1")
    hint(f, "▶", "Play", "2001 to 2046", "#3ecf8e")
    orbit(f, 30, 14000)
    play_years(f, 2001, 2046.9, 4, extra=300)
    f.board("Growing and greying", "Columns rise as towns grow; colours brighten as they age. Projections after today.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def housing_climb(f):
    fly(f, "{ center: [-124.0, 48.9], zoom: 8.0, pitch: 58, bearing: -25 }", 2600)
    f.say("housing-climb-1")
    hint(f, "▶", "Play", "month by month", "#b388ff")
    orbit(f, 30, 12000)
    play_years(f, 2017.4, 2026.7, 1, extra=300)
    f.board("Prices climb", "Month by month since 2017: the columns grow, fastest through 2021 and 2022.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def crime_years(f):
    fly(f, "{ center: [-124.4, 49.1], zoom: 7.8, pitch: 58, bearing: -20 }", 2600)
    f.say("crime-yrs-1")
    orbit(f, 30, 10000)
    play_years(f, 1998, 2025.9, 4, extra=300)
    f.board("Crime over time", "Each town's Crime Severity Index, 1998 to today.")
    f.voice_done(300)


def hospitals_reach(f):
    fly(f, "{ center: [-125.6, 49.7], zoom: 7.5, pitch: 60, bearing: -30 }", 3200)
    f.say("hospitals-reach-1")
    orbit(f, 40, 14000)
    f.wait(2500)
    hover_town(f, "Tahsis")
    f.wait(1800)
    f.board("Far from care", "Tall columns are long drives; the cursor rests on a remote west-coast town.")
    f.voice_done(300)


def smoke_years(f):
    fly(f, "{ center: [-124.6, 49.2], zoom: 7.6, pitch: 55, bearing: -15 }", 2400)
    f.say("smoke-yrs-1")
    orbit(f, 25, 9000)
    play_years(f, 1998, 2025.9, 4, extra=200)
    f.voice_done(200)
    f.say("smoke-yrs-2")
    f.camera({"sel": "#timeline", "grow": 30}, 1100, max=1.8)
    f.wait(400)
    event_marker(f, "2017")
    f.wait(2400)
    event_panel(f, "2017", "The smokiest year: the 2017 marker is clicked and its story opens in the side panel.")
    f.voice_done(300)
    f.camera("fill", 1100)
    event_back(f)


def scene(id, title, run, lines, shows="", camera="", motion="", sound="Clicks, whooshes."):
    return dict(id=id, title=title, run=run, lines=lines, shows=shows, camera=camera, motion=motion, sound=sound)


SPECS = {
    "fires": dict(
        hook="Since 1919, fire has crossed Vancouver Island again and again. Here's all of it, on one map.",
        stats=[("fi_n", "fires on record"), ("fi_year_ha", "hectares burned in {fi_year}"), ("fi_human", "of ignitions caused by people", "%")],
        on="{fi_n:,} fires on record. The worst year, {fi_year}, burned {fi_year_ha:,} hectares, and {fi_human} percent of ignitions were started by people.",
        wow=[scene("fires-burn", "A century of fire", fires_burn,
                   {"fires-burn-1": "Press play, and a century of fire sweeps across the island. Each glowing scar is a mapped fire; each spark, an ignition."},
                   "The timeline playing 1919 to today at eight years a second.", "A slow orbit over the island.", "Scars glow and fade."),
             scene("fires-cam", "Cameron Bluffs, 2023", fires_cameron,
                   {"fires-cam-1": "Click a marker to jump to a moment. In June 2023, the Cameron Bluffs fire closed Highway 4, the only road to the west coast, for weeks."},
                   "Clicking the 2023 event marker.", "Zoomed on the timeline, then the event's panel.", "The map flies to Cameron Lake.")],
        panel=("h3", "Ignition cause", "The panel charts the area burned every year, and what started the fires: lightning, or people."),
        moment=lambda f: (fly(f, "{ center: [-125.15, 49.65], zoom: 7.4, pitch: 55, bearing: -30 }", 1800), play_years(f, 1919, 2026.9, 12, extra=100)),
        teaser="Wildfires: every mapped fire since 1919, burning across the island in seconds.",
    ),
    "quakes": dict(
        hook="Vancouver Island sits above one of the most dangerous faults in the world. Its earthquakes, mapped in 3D.",
        stats=[("qu_n", "earthquakes on record"), ("qu_m4", "of magnitude 4 or more"), ("qu_deep", "km, the deepest", "")],
        on="{qu_n:,} earthquakes since {qu_first}, {qu_m4:,} of them magnitude four or more, as deep as {qu_deep} kilometres.",
        wow=[scene("quakes-depth", "Beneath the island", quakes_depth,
                   {"quakes-depth-1": "Tilt the map, and every quake hangs at its true depth beneath the island, stretched three times: the trace of an ocean plate diving under North America."},
                   "The map tilted almost flat with quakes shown below ground.", "Low, slow orbit.", "Whooshes."),
             scene("quakes-46", "The 1946 earthquake", quakes_1946,
                   {"quakes-46-1": "In June 1946, a magnitude {qu_big_m} earthquake struck the centre of the island, the strongest on its record. Play through it, and the shockwave spreads."},
                   "The timeline crossing June 1946.", "Over the epicentre; the event on the timeline.", "A shockwave.")],
        panel=("h3", "Depth", "The panel charts every quake's magnitude over time, and how deep they strike."),
        moment=lambda f: (f.run("() => atlas.setTime(2026.5)"), fly(f, "{ center: [-126.2, 49.35], zoom: 7.3, pitch: 75, bearing: 60 }", 2600), orbit(f, -20, 6000), f.wait(2500)),
        teaser="Earthquakes: over a century of quakes, hanging at their true depths beneath the island.",
    ),
    "seismic": dict(
        hook="How hard could the ground shake where you live? Canada's building code has a map for that.",
        stats=[("se_top_g", "of gravity in {se_top}", "%"), ("se_low_g", "of gravity in {se_low}", "%"), ("se_n", "towns compared")],
        on="In {se_top}, the ground could shake at {se_top_g} percent of gravity, in a quake that has a two percent chance in fifty years. In {se_low}, {se_low_g} percent.",
        wow=[scene("seismic-surf", "The shaking map", seismic_surface,
                   {"seismic-surf-1": "The brighter the colour, the harder the shaking. It's strongest at the island's southern tip, around Greater Victoria, where deep quakes inside the sinking ocean plate run closest.",
                    "seismic-surf-2": "Point at any town to see its numbers."},
                   "The hazard surface from a low angle; hovering towns.", "A slow orbit.", "Whooshes.")],
        panel=("h3", "Towns, highest to lowest", "The panel explains why it differs across the island, and ranks every town."),
        moment=lambda f: (fly(f, "{ center: [-124.6, 49.2], zoom: 7.5, pitch: 58, bearing: -25 }", 2200), orbit(f, 25, 6000), f.wait(3000)),
        teaser="Shaking hazard: the building code's map of how hard the ground could shake.",
    ),
    "rivers": dict(
        hook="Every winter, atmospheric rivers pour onto the island's mountains. Here's how the rivers answer.",
        stats=[("ri_n", "river gauges"), ("ri_2021_hi", "gauges at 1.5× normal in 2021"), ("ri_big_year", "the year of the biggest peak", "")],
        on="{ri_n} river gauges. The biggest peak on record, at {ri_big_river} in {ri_big_year}, ran {ri_big_x} times its normal yearly high.",
        wow=[scene("rivers-ar", "The atmospheric river", rivers_2021,
                   {"rivers-ar-1": "In November 2021, an atmospheric river washed out the Malahat Highway, cutting Victoria off by road. Click its marker to see the gauges spike."},
                   "Clicking the November 2021 marker.", "Zoomed on the timeline, then the event's panel.", "Columns spike."),
             scene("rivers-dec", "Six decades of floods", rivers_decades,
                   {"rivers-dec-1": "Play the years, and the gauges jump in every flood year and settle in the dry ones."},
                   "The timeline playing from 1958.", "A slow orbit.", "Whooshes.")],
        panel=("h3", "Most extreme peaks", "The panel ranks the most extreme peaks on record, and charts how often the rivers run high."),
        moment=lambda f: (fly(f, "{ center: [-124.6, 49.0], zoom: 7.8, pitch: 55, bearing: -25 }", 1800), play_years(f, 2015, 2025.9, 4, extra=100)),
        teaser="River floods: sixty years of river gauges, spiking in every flood.",
    ),
    "climate": dict(
        hook="The island is warming. A century of weather stations shows by how much.",
        stats=[("cl_n", "long-running weather stations"), ("cl_warm", "the warmest year", "")],
        on="{cl_n} weather stations, going back to the early 1900s. The warmest year was {cl_warm}, {cl_warm_a} degrees above normal.",
        wow=[scene("climate-warm", "A century of warming", climate_warm,
                   {"climate-warm-1": "Press play: each column is a station, blue when the year ran cool, red when it ran warm. Watch the red take over."},
                   "The timeline playing 1902 to 2020.", "A slow orbit.", "Columns shift colour."),
             scene("climate-str", "Warming stripes", climate_stripes,
                   {"climate-str-1": "The panel's warming stripes tell the same story at a glance: one stripe for every year, warming {h_climate_3} a decade since 1950."},
                   "Zoomed on the warming stripes.", "Scroll and zoom on the panel.", "Whoosh.")],
        panel=("h3", "Anomaly by year", "And the chart below shows every year's difference from normal."),
        moment=lambda f: (fly(f, "{ center: [-125.0, 49.5], zoom: 7.3, pitch: 52, bearing: -20 }", 1800), play_years(f, 1902, 2020.9, 16, extra=100)),
        teaser="Climate: a century of weather stations turning from blue to red.",
    ),
    "normals": dict(
        hook="Sunny or grey, frosty or mild: the island's climates are not all alike.",
        stats=[("no_sun_h", "hours of sun: {no_sun}"), ("no_dull_h", "hours of sun: {no_dull}"), ("no_wet_d", "rain days: {no_wet}")],
        on="{no_sun} gets {no_sun_h:,} hours of sunshine a year; {no_dull}, {no_dull_h:,}. {no_wet} sees rain or snow on {no_wet_d} days a year.",
        wow=[scene("normals-ch", "Four climates", normals_chips,
                   {"normals-ch-1": "Switch what the columns show: rain days, frost days, snowfall.",
                    "normals-ch-2": "Thirty years of averages, from {no_n} weather stations."},
                   "Clicking each of the four chips.", "Zoomed on the chips, then full-frame.", "Columns reshape.")],
        panel=("h3", None, "The panel ranks the stations, from the sunniest to the greyest."),
        moment=lambda f: (fly(f, "{ center: [-125.0, 49.5], zoom: 7.4, pitch: 55, bearing: -15 }", 1800), orbit(f, 25, 6000), f.wait(3500)),
        teaser="Climate normals: sunshine, rain, frost and snow, station by station.",
    ),
    "future": dict(
        hook="What will the island's climate be like by mid-century? Twenty-six climate models have an answer.",
        stats=[("fu_hot_now", "days over 30 °C a year, today"), ("fu_hot_50", "in the 2050s"), ("fu_hot_50h", "with high emissions")],
        on="The typical town gets {fu_hot_now} days over thirty degrees a year today. By the 2050s, models project {fu_hot_50}, or {fu_hot_50h} with high emissions.",
        wow=[scene("future-ch", "The 2050s", future_chips,
                   {"future-ch-1": "Start with today.",
                    "future-ch-2": "Now jump to the 2050s.",
                    "future-ch-3": "And switch to the high-emissions scenario.",
                    "future-ch-4": "Frost is the other side: from {fu_frost_now} frost days a year to about {fu_frost_50}. Change from today shows the loss in every town."},
                   "Clicking period, scenario, variable and map chips.", "Zoomed on the chips, then full-frame.", "Columns grow and shrink.")],
        panel=("h3", "Reading the scenarios", "Every number comes with a range across the models, because they disagree. These are projections, not records."),
        moment=lambda f: (fly(f, "{ center: [-125.0, 49.5], zoom: 7.4, pitch: 55, bearing: -15 }", 1800), orbit(f, 25, 6000), f.wait(3500)),
        teaser="Future climate: what twenty-six climate models project for the 2050s.",
    ),
    "population": dict(
        hook="Who lives on the island, and how old are they? Forty-five years of towns, growing and greying.",
        stats=[("po_t0", "thousand people in {po_y0}"), ("po_now", "thousand today"), ("po_end", "thousand by {po_y1}")],
        on="{po_t0} thousand people lived in the island's towns in {po_y0}. Today it's {po_now} thousand, and {po_end} thousand are projected by {po_y1}.",
        wow=[scene("population-grow", "Growing and greying", population_grow,
                   {"population-grow-1": "Press play: columns grow with the towns, and brighten as they age. {po_grow} has grown {po_grow_x} times over. After {po_now_y}, it's the province's projection."},
                   "The timeline playing 2001 to 2046.", "A slow orbit over the south island.", "Columns rise.")],
        panel=("h3", "aged 65+", "The share of residents aged sixty-five and over climbs from {po_s0} percent to {po_send} percent."),
        moment=lambda f: (fly(f, "{ center: [-124.2, 48.95], zoom: 8.0, pitch: 55, bearing: -25 }", 1800), play_years(f, 2001, 2046.9, 8, extra=100)),
        teaser="Population and age: towns growing, and greying, out to 2046.",
    ),
    "housing": dict(
        hook="What do homes really sell for? Every recorded sale, town by town, month by month.",
        stats=[("ho_t0", "thousand dollars, typical in {ho_y0}", "", "$"), ("ho_top_k", "thousand: {ho_top}", "", "$"), ("ho_low_k", "thousand: {ho_low}", "", "$")],
        on="A typical home in the major towns sold for about ${ho_t0}K in {ho_y0}. Today it's {h_housing_0}. The priciest town, {ho_top}, is near {h_housing_3}.",
        wow=[scene("housing-climb", "Prices climb", housing_climb,
                   {"housing-climb-1": "Play it month by month: watch the columns climb, fastest through the boom of 2021 and 2022."},
                   "The timeline playing 2017 to today.", "A slow orbit over the south island.", "Columns rise.")],
        panel=("h3", "Median sale value", "The panel charts the median sale value for every town, so you can compare them over time."),
        moment=lambda f: (fly(f, "{ center: [-124.0, 48.9], zoom: 8.0, pitch: 55, bearing: -25 }", 1800), play_years(f, 2017.4, 2026.7, 2, extra=100)),
        teaser="Home prices: every recorded sale, month by month since 2017.",
    ),
    "crime": dict(
        hook="How safe is each town? Statistics Canada weighs every crime by how serious it is.",
        stats=[("cr_safe_v", "lowest: {cr_safe}"), ("cr_bc", "British Columbia"), ("cr_high_v", "highest: {cr_high}")],
        on="On the Crime Severity Index, {cr_safe} scores {cr_safe_v} and {cr_high} {cr_high_v}, against {cr_bc} for the province.",
        wow=[scene("crime-yrs", "Crime over time", crime_years,
                   {"crime-yrs-1": "Play the years from {cr_y0}, and each town's column rises and falls with its index. A hundred is Canada's level in 2006."},
                   "The timeline playing 1998 to today.", "A slow orbit.", "Columns move.")],
        panel=("h3", "Crime Severity Index by police service", "The panel charts each police service's index against the province."),
        moment=lambda f: (fly(f, "{ center: [-124.4, 49.1], zoom: 7.8, pitch: 55, bearing: -20 }", 1800), play_years(f, 1998, 2025.9, 8, extra=100)),
        teaser="Crime severity: each town's index, from 1998 to today.",
    ),
    "hospitals": dict(
        hook="If something goes wrong, how far is the nearest emergency room?",
        stats=[("hs_er", "24/7 emergency rooms"), ("hs_fac", "hospitals and ERs"), ("hs_n", "towns with a drive time")],
        on="{h_hospitals_0} emergency rooms are open around the clock. The median town is {h_hospitals_1} away; the farthest, {h_hospitals_3_who}, is {h_hospitals_3}.",
        wow=[scene("hospitals-reach", "Far from care", hospitals_reach,
                   {"hospitals-reach-1": "Column height is the drive to the nearest twenty-four-hour ER. On the west coast and the outer islands, it's hours, not minutes."},
                   "Drive-time columns from a low angle; hovering a remote town.", "A slow orbit.", "Whooshes.")],
        panel=("h3", "nearest 24/7 emergency room", "The panel ranks every town by its drive to emergency care."),
        moment=lambda f: (fly(f, "{ center: [-125.6, 49.7], zoom: 7.4, pitch: 58, bearing: -30 }", 2200), orbit(f, 25, 6000), f.wait(3500)),
        teaser="Hospital access: the drive from every town to a twenty-four-hour ER.",
    ),
    "smoke": dict(
        hook="Towns that never burn still breathe the smoke. Here's how often it reaches them.",
        stats=[("sm_n", "air monitors"), ("sm_year", "the smokiest year", ""), ("sm_most", "days over the limit at one station")],
        on="{sm_n} air-quality monitors, back to {sm_y0}. The smokiest year was {sm_year}: {sm_days} fire-season days over the provincial objective, at the average monitor.",
        wow=[scene("smoke-yrs", "Smoke on the wind", smoke_years,
                   {"smoke-yrs-1": "Play the fire seasons: monitors glow on the days the smoke rolls in.",
                    "smoke-yrs-2": "Click a marker to jump to a smoky year, like {sm_year}."},
                   "The timeline playing 1998 to today; the 2017 marker.", "A slow orbit; the event's panel.", "Whooshes.")],
        panel=("h3", "Smokiest years", "The panel ranks the smokiest years, and every monitor's record."),
        moment=lambda f: (fly(f, "{ center: [-124.6, 49.2], zoom: 7.6, pitch: 55, bearing: -15 }", 1800), play_years(f, 1998, 2025.9, 8, extra=100)),
        teaser="Wildfire smoke: how often the smoke reaches each town's air monitor.",
    ),
    # Trails & waterfalls has its own, longer film (video/storyboard_trails.py); the overview gives it a moment.
    "trails": dict(
        film="trails",
        moment=lambda f: (fly(f, "{ center: [-125.28, 49.6], zoom: 9.4, pitch: 62, bearing: -28 }", 2600), orbit(f, 25, 6000), f.wait(3500)),
        teaser="Trails and waterfalls: every footpath and waterfall, with 3D flights and a waterfall tour.",
    ),
}


# ---------------------------------------------------------------------------------------------------
# the generic film and moment, for a layer with no spec (a layer added after these films were written)

def generic_explore(meta):
    def run(f):
        fly(f, "{ center: [-125.0, 49.5], zoom: 7.4, pitch: 55, bearing: -20 }", 2400)
        f.say(f"{meta['id']}-ex-1")
        orbit(f, 35, 12000)
        if meta["static"]:
            f.wait(6000)
        else:
            a, b = meta["range"]
            play_years(f, a, b, max(1, round((b - a) / 10)), extra=300)
        f.board("Explore", "The layer from a low angle, playing its timeline (or circling, if it doesn't change over time).")
        f.voice_done(300)
    return run


def generic_moment(meta):
    def run(f):
        fly(f, "{ center: [-125.0, 49.5], zoom: 7.4, pitch: 55, bearing: -20 }", 1800)
        if meta["static"]:
            orbit(f, 25, 6000)
            f.wait(3500)
        else:
            a, b = meta["range"]
            play_years(f, a, b, max(2, round((b - a) / 5)), extra=100)
    return run


def spec_for(meta):
    """A layer's spec, or a generic one built from what the app says about it."""
    if meta["id"] in SPECS:
        return SPECS[meta["id"]]
    hero = [h for h in meta["hero"] if h[0] and h[0] not in ("–", "-")][:1]
    return dict(
        generic=True,
        hook=(meta["h2"] or meta["name"]).rstrip("?.!") + ("?" if meta["h2"].endswith("?") else "."),
        stats=[],
        on=meta["lede"] or f"{meta['name']}, on the map.",
        wow=[scene(f"{meta['id']}-ex", "Explore", generic_explore(meta),
                   {f"{meta['id']}-ex-1": ("Press play, and watch it change over time." if not meta["static"] else "Tilt and turn the map to explore it.")
                    + (f" {hero[0][1][0].upper() + hero[0][1][1:]}: {hero[0][0]}." if hero else "")})],
        panel=("h2", None, "The side panel has the full story, with its charts and sources."),
        moment=generic_moment(meta),
        teaser=f"{meta['name']}: {meta['h2'] or meta['lede']}",
    )


# ---------------------------------------------------------------------------------------------------
# a layer film

def make_layer_film(layer_id):
    film = types.SimpleNamespace(NAME=film_name(layer_id), SOUNDS=SOUNDS, spoken=spoken, FACTS=FACTS, SCENES=[], layer=layer_id)

    def prepare(found):
        meta = next((l for l in found.get("layers", []) if l["id"] == layer_id), None)
        if not meta:
            raise SystemExit(f"the app has no layer '{layer_id}' (it has: {', '.join(l['id'] for l in found.get('layers', []))})")
        spec = spec_for(meta)
        name, colour = meta["name"], meta["color"]
        # every counter needs its value and label now, not halfway through a render
        for st in spec["stats"]:
            if st[0] not in found:
                raise SystemExit(f"{layer_id}: no fact named '{st[0]}' for a counter")
            st[1].format(**found)
        film.BOARD_TITLE = f"Island Atlas: {name} storyboard"
        film.SCRIPT_TITLE = f"Island Atlas, {name}: narration script"
        lid = layer_id
        steps = len(spec["wow"]) + 2

        def chapter(f, n, title):
            f.js("([n, t, s, c]) => Stage.chapter(n, t, s, c)", [n, title, f"{name} · {n} of {steps}", colour])
            f.sfx("whoosh", 0.35, seconds=0.6, pan_from=-0.8, pan_to=-0.2)

        def intro(f):
            f.wait(400)
            f.run("() => { atlas.map.stop(); atlas.map.jumpTo(atlas.HOME); }")
            f.js("([t, s]) => Stage.title(t, s, [t.split(' ')[0]])", [name, meta["h2"] or "Island Atlas"])
            f.sfx("blip", 0.6, note=0)
            f.say(f"{lid}-intro")
            f.board("Title", "Black frame; the layer's name rises word by word over its headline.")
            f.wait(2600)
            f.js("Stage.fade(0, 1600)")
            f.js("Stage.hideTitle(900)")
            f.voice_done(300)

        def turn_on(f):
            chapter(f, 1, "Turn it on")
            f.camera("fill", 1200, whoosh=0.3)
            f.cursor(True)
            f.say(f"{lid}-on-1")
            open_layer(f, name, colour)
            f.voice_done(200)
            f.wait(600)
            if spec["stats"]:
                items = []
                for st in spec["stats"]:
                    key, label = st[0], st[1].format(**found)
                    v = found.get(key)
                    if not isinstance(v, (int, float)):
                        continue
                    year = key.endswith(("year", "_y0", "_y1", "warm"))
                    # a year counts up from a few decades back, not from zero
                    items.append({"v": v, "k": label, "c": colour, "suffix": st[2] if len(st) > 2 else "", "prefix": st[3] if len(st) > 3 else "", "plain": year, "from": v - 40 if year else 0})
                f.js("s => Stage.stats(s)", items)
                f.sfx("riser", 0.35, seconds=1.8)
            f.say(f"{lid}-on-2")
            f.wait(1800)
            f.board("On the map", "The layer is on; its headline numbers count up over the map.")
            f.voice_done(500)
            f.js("Stage.hideStats()")

        def wow_scene(n, sc):
            def run(f):
                chapter(f, n, sc["title"])
                sc["run"](f)
            return run

        def panel(f):
            chapter(f, steps, "Read its story")
            sel, text, _ = spec["panel"]
            panel_top(f)
            if text or sel != "h2":
                panel_scroll_to(f, sel, text, offset=60)
            f.camera({"sel": "#panel", "grow": 10}, 1300, whoosh=0.3, max=1.5)
            f.say(f"{lid}-panel")
            f.wait(1500)
            f.board("The story", "Zoomed on the side panel.")
            f.voice_done(400)
            f.camera("fill", 1200)

        def ending(f):
            f.js("Stage.hideChapter()")
            f.run("() => atlas.map.flyTo({ ...atlas.HOME, duration: 3200 })")
            f.camera("rest", 1600, whoosh=0.5)
            f.wait(1700)
            f.js("Stage.fade(0.82, 2000)")
            f.sfx("impact", 0.5)
            f.mark("end")
            f.wait(700)
            f.js("([t, u, fine]) => Stage.end(t, u, fine)", [f"{name}: {meta['h2']}" if meta["h2"] else name, f.url, "Watch the overview for every other layer · nothing to install"])
            f.say(f"{lid}-end")
            f.wait(1500)
            f.board("End card", "The window drifts back; the end card sends you to the overview.")
            f.voice_done(3000)
            f.js("Stage.blackout(1600)")
            f.wait(1800)

        sel, text, panel_line = spec["panel"]
        film.SCENES = [
            dict(id=f"{lid}-intro", title="Introduction", run=intro, shows="The title.", camera="Floating window, then full-frame.",
                 motion="Title rises out of a blur; fade up from black.", sound="A glassy note; music fades in.", lines={f"{lid}-intro": spec["hook"]}),
            dict(id=f"{lid}-on", title="Turn it on", run=turn_on, shows=f"Clicking {name} in the Layer menu; three headline numbers.",
                 camera="Zoom onto the menu, then full-frame.", motion="Real clicks; counters rise.", sound="Clicks, a riser.",
                 lines={f"{lid}-on-1": f"Open Layer, at the top left, and click {name}.", f"{lid}-on-2": spec["on"]}),
            *[{**sc, "run": wow_scene(i + 2, sc)} for i, sc in enumerate(spec["wow"])],
            dict(id=f"{lid}-panel", title="Read its story", run=panel, shows="The side panel's charts and rankings.", camera="Zoomed on the panel.",
                 motion="A scroll.", sound="Whoosh.", lines={f"{lid}-panel": panel_line}),
            dict(id=f"{lid}-end", title="End card", run=ending, shows="Title and the pointer to the overview.", camera="Back to the floating window.",
                 motion="Logo spins up.", sound="Soft impact; music fades.",
                 lines={f"{lid}-end": f"That's {name}. For every other layer, watch the Island Atlas overview."}),
        ]

    film.prepare = prepare

    def youtube(found, url, chapters):
        meta = next(l for l in found["layers"] if l["id"] == layer_id)
        ln = links()
        return f"""TITLE
Island Atlas: {meta['name']} | Vancouver Island in data

DESCRIPTION
{meta['h2'] or meta['name']} One layer of Island Atlas, an animated map of Vancouver Island's history and data.
{meta['lede']}

▶ Every layer in a few minutes: the Island Atlas overview: {(ln.get('island-atlas-overview') or '[add the link to the overview]')}
▶ How to use Island Atlas, step by step: {(ln.get('island-atlas-explainer') or '[add the link to the how-to]')}

Try it yourself: {url or '[add the link]'}

Chapters
{chapters}

Everything in this video is the real application, filmed frame by frame. The narration uses a synthetic voice (Kokoro). Data sources are listed in the app under Data & sources. Data extract {found['extract']}.

TAGS
Island Atlas, Vancouver Island, {meta['name']}, map, data visualization, open data, British Columbia
"""

    film.youtube = youtube
    return film


# ---------------------------------------------------------------------------------------------------
# the overview: every layer, each pointing to its own film

def make_overview():
    film = types.SimpleNamespace(NAME="island-atlas-overview", SOUNDS=SOUNDS, spoken=spoken, FACTS=FACTS, SCENES=[],
                                 BOARD_TITLE="Island Atlas: overview storyboard", SCRIPT_TITLE="Island Atlas overview: narration script")

    def prepare(found):
        metas = found["layers"]
        n = len(metas)
        chapters_total = n + 2

        def chapter(f, k, title, colour, sub=None):
            f.js("([n, t, s, c]) => Stage.chapter(n, t, s, c)", [k, title, sub or f"{k} of {chapters_total}", colour])
            f.sfx("whoosh", 0.35, seconds=0.6, pan_from=-0.8, pan_to=-0.2)

        def intro(f):
            f.wait(400)
            f.run("() => { atlas.map.stop(); atlas.map.jumpTo(atlas.HOME); }")
            f.js("Stage.title('Island Atlas', 'Every layer, in a few minutes', ['Atlas'])")
            f.sfx("blip", 0.6, note=0)
            f.say("ov-intro")
            f.board("Title", "Black frame; the title rises word by word.")
            f.wait(2600)
            f.js("Stage.fade(0, 1600)")
            f.js("Stage.hideTitle(900)")
            f.voice_done(300)

        def how(f):
            chapter(f, 1, "How it works", TOUR)
            f.camera("fill", 1200, whoosh=0.3)
            f.cursor(True)
            f.say("ov-how-1")
            f.click({"sel": "#layers-btn"})
            f.camera({"sel": "#layer-menu", "grow": 16}, 1100, whoosh=0.3, max=1.8)
            f.wait(600)
            hint(f, "◐", "Switch: on the map or off", "Name: its story and timeline", KEYS)
            first = metas[0]["name"]
            f.click({"sel": "#layer-menu .layer-row", "text": first, "at": [0.93, 0.5]})
            f.board("The menu", "Zoomed on the Layer menu: a switch turns a layer on; its name opens its story.")
            f.voice_done(200)
            f.say("ov-how-2")
            f.click({"sel": "#layers-btn"})
            f.camera("fill", 1200)
            f.camera({"sel": "#timeline", "grow": 30}, 1200, max=1.8)
            f.wait(1600)
            f.voice_done(200)
            f.camera("fill", 1100)
            f.js("Stage.hideChip()")

        def moment(k, meta):
            spec = spec_for(meta)
            fname = "the Trails and waterfalls film" if meta["id"] == "trails" else f"Island Atlas · {meta['name']}"

            def run(f):
                chapter(f, k, meta["name"], meta["color"], f"Layer {k - 1} of {n}")
                f.run(f"() => {{ atlas.setPlaying(false); atlas.clearMap(); atlas.focus({json.dumps(meta['id'])}); }}")
                f.say(f"ov-{meta['id']}")
                hint(f, "▶", "Full film", fname, meta["color"])
                spec["moment"](f)
                f.board(meta["name"], f"{meta['name']} on its own, with a chip naming its full film.")
                f.voice_done(250)
                f.js("Stage.hideChip()")
            return run

        def towns(f):
            chapter(f, chapters_total, "Towns, and finding one", "#3ecf8e")
            f.run("() => { atlas.setPlaying(false); atlas.clearMap(); atlas.map.flyTo({ ...atlas.HOME, duration: 2400 }); }")
            f.wait(2500)
            f.say("ov-towns-1")
            f.click({"lnglat": f.run("() => { const m = atlas.data.munis.find((m) => m.name === 'Qualicum Beach'); return [m.lon, m.lat]; }")})
            f.wait(2200)
            f.board("A town report", "A town dot is clicked; its report opens with every layer's number for that town.")
            f.voice_done(300)
            f.click({"sel": "#panel .close-x"})
            f.say("ov-towns-2")
            spot(f, {"sel": "#finder-btn", "pad": 6})
            f.wait(1400)
            spot(f, {"sel": "#land-btn", "pad": 6})
            f.wait(1400)
            unspot(f)
            f.voice_done(300)

        def ending(f):
            f.js("Stage.hideChapter()")
            f.run("() => atlas.map.flyTo({ ...atlas.HOME, duration: 3200 })")
            f.camera("rest", 1600, whoosh=0.5)
            f.wait(1700)
            f.js("Stage.fade(0.82, 2000)")
            f.sfx("impact", 0.5)
            f.mark("end")
            f.wait(700)
            f.js("([u, fine]) => Stage.end('Every layer has its own short film', u, fine)", [f.url, f"{n} layers, a film for each · links in the description"])
            f.say("ov-end")
            f.wait(1500)
            f.board("End card", "The end card points to a film for each layer.")
            f.voice_done(3000)
            f.js("Stage.blackout(1600)")
            f.wait(1800)

        film.SCENES = [
            dict(id="ov-intro", title="Introduction", run=intro, shows="The title.", camera="Floating window, then full-frame.",
                 motion="Title rises.", sound="A glassy note.",
                 lines={"ov-intro": f"Island Atlas puts a century of Vancouver Island on one map: {n} layers of history and data. Here they all are, in a few minutes."}),
            dict(id="ov-how", title="How it works", run=how, shows="The Layer menu's switches and names; the timeline.", camera="Zoomed on the menu and the timeline.",
                 motion="Real clicks.", sound="Clicks.",
                 lines={"ov-how-1": "Open Layer at the top left. A switch puts a layer on the map; clicking its name opens its story.",
                        "ov-how-2": "Layers that change over time play on the timeline along the bottom."}),
            *[dict(id=f"ov-{m['id']}", title=m["name"], run=moment(i + 2, m), shows=f"{m['name']}, with a chip naming its own film.",
                   camera="Full-frame.", motion="A camera move or the timeline playing.", sound="Whoosh.",
                   lines={f"ov-{m['id']}": spec_for(m)["teaser"]}) for i, m in enumerate(metas)],
            dict(id="ov-towns", title="Towns, and finding one", run=towns, shows="A town report; the Town Finder and Land Finder buttons.",
                 camera="Full-frame.", motion="A click on a town.", sound="Clicks.",
                 lines={"ov-towns-1": "Click any town for its report: every layer's numbers for that one place.",
                        "ov-towns-2": "And Town Finder and Land Finder, at the top right, rank the towns and search the land by what matters to you."}),
            dict(id="ov-end", title="End card", run=ending, shows="Title and the pointer to the layer films.", camera="Back to the floating window.",
                 motion="Logo spins up.", sound="Soft impact; music fades.",
                 lines={"ov-end": "Every layer has its own short film, with a closer look. Pick any of them to go deeper. Enjoy exploring."}),
        ]

    film.prepare = prepare

    def youtube(found, url, chapters):
        ln = links()
        rows = "\n".join(f"• {m['name']}: {(ln.get(film_name(m['id'])) or '[add the link]')}" for m in found["layers"])
        return f"""TITLE
Island Atlas: every layer in a few minutes | Vancouver Island in data

DESCRIPTION
Island Atlas puts a century of Vancouver Island on one animated map: {len(found['layers'])} layers of history and data, from wildfires and earthquakes to home prices and hiking trails. This overview shows each one in a few seconds.

Each layer has its own short film with a closer look:
{rows}

▶ How to use Island Atlas, step by step: {(ln.get('island-atlas-explainer') or '[add the link to the how-to]')}

Try it yourself: {url or '[add the link]'}

Chapters
{chapters}

Everything in this video is the real application, filmed frame by frame. The narration uses a synthetic voice (Kokoro). Data sources are listed in the app under Data & sources. Data extract {found['extract']}.

TAGS
Island Atlas, Vancouver Island, map, data visualization, wildfires, earthquakes, home prices, climate, open data, British Columbia
"""

    film.youtube = youtube
    return film


def film(name):
    """`overview` or `layer-<id>` (the Trails layer keeps its own module)."""
    if name == "overview":
        return make_overview()
    if name.startswith("layer-"):
        return make_layer_film(name[6:])
    raise SystemExit(f"unknown film '{name}'")
