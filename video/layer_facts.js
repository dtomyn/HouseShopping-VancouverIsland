// Numbers for the per-layer films and the overview (video/storyboard_layers.py), computed in the app's frame from
// window.atlas. Run by video/render.py before filming; every value here can be quoted in narration as {name}.
() => {
  const a = window.atlas, d = a.data, out = {};
  const clean = (n) => n.replace(/ Int'l A$/, ' airport').replace(/ A$/, ' airport').replace(/ Isl View$/, '').replace(/ At .*$/i, '').replace(/ Near .*$/i, '');
  const name = (k) => d.munis.find((m) => m.key === k)?.name ?? k;
  const r1 = (v) => Math.round(v * 10) / 10;
  const safe = (f) => { try { f(); } catch (e) { out.err = (out.err || '') + ' ' + e.message; } };
  safe(() => { // fires
    const byY = {}; const seen = new Set();
    for (const p of d.fires.perimeters) { if (seen.has(p.id)) continue; seen.add(p.id); byY[p.year] = (byY[p.year] || 0) + p.ha; }
    const best = Object.entries(byY).sort((x, y) => y[1] - x[1])[0];
    const big = [...d.fires.perimeters].sort((x, y) => y.ha - x.ha)[0];
    const pts = d.fires.points; const cause = [0, 0, 0]; pts.forEach((p) => cause[p[4]]++);
    Object.assign(out, { fi_n: d.fires.perimeters.length + pts.length, fi_year: +best[0], fi_year_ha: Math.round(best[1]), fi_big_ha: Math.round(big.ha), fi_big_year: big.year, fi_human: Math.round(100 * cause[1] / pts.length), fi_first: Math.min(...d.fires.perimeters.map((p) => p.year)) });
  });
  safe(() => { // quakes
    const q = d.quakes.rows; const big = [...q].sort((x, y) => y[3] - x[3])[0];
    Object.assign(out, { qu_n: q.length, qu_big_m: big[3], qu_big_year: Math.floor(big[4]), qu_big_place: big[5], qu_m4: q.filter((x) => x[3] >= 4).length, qu_deep: Math.round(Math.max(...q.map((x) => x[2]))), qu_first: Math.floor(Math.min(...q.map((x) => x[4]))) });
  });
  safe(() => { // seismic
    const t = Object.entries(d.seismic.towns).sort((x, y) => y[1][0] - x[1][0]);
    Object.assign(out, { se_top: name(t[0][0]), se_top_g: Math.round(t[0][1][0] * 100), se_low: name(t.at(-1)[0]), se_low_g: Math.round(t.at(-1)[1][0] * 100), se_n: t.length });
  });
  safe(() => { // rivers
    const s = d.rivers.stations; let best = null;
    for (const st of s) for (const [y, v] of Object.entries(st.peaks)) { const r = v / st.median; if (!best || r > best.r) best = { r, y, st }; }
    const y21 = s.filter((st) => st.peaks['2021'] != null); const hi21 = y21.filter((st) => st.peaks['2021'] / st.median >= 1.5).length;
    Object.assign(out, { ri_n: s.length, ri_big_x: r1(best.r), ri_big_river: clean(best.st.name), ri_big_year: +best.y, ri_2021_hi: hi21, ri_2021_n: y21.length });
  });
  safe(() => { // climate
    const st = d.climate.stations; const ys = {};
    for (const s of st) for (const [y, v] of Object.entries(s.temp)) { (ys[y] ||= []).push(v - s.baseline); }
    const an = Object.entries(ys).filter(([, v]) => v.length >= 3).map(([y, v]) => [+y, v.reduce((p, c) => p + c, 0) / v.length]);
    const warm = an.sort((x, y) => y[1] - x[1])[0];
    const after = an.filter(([y]) => y >= 1950); const n = after.length, mx = after.reduce((p, c) => p + c[0], 0) / n, my = after.reduce((p, c) => p + c[1], 0) / n;
    const slope = after.reduce((p, c) => p + (c[0] - mx) * (c[1] - my), 0) / after.reduce((p, c) => p + (c[0] - mx) ** 2, 0);
    Object.assign(out, { cl_n: st.length, cl_warm: warm[0], cl_warm_a: r1(warm[1]), cl_decade: Math.round(slope * 100) / 10 });
  });
  safe(() => { // normals
    const s = d.normals.stations.filter((x) => x.sun); const sun = [...s].sort((x, y) => y.sun - x.sun);
    const w = d.normals.stations.filter((x) => x.wetDays).sort((x, y) => y.wetDays - x.wetDays);
    Object.assign(out, { no_sun: clean(sun[0].name), no_sun_h: Math.round(sun[0].sun), no_dull: clean(sun.at(-1).name), no_dull_h: Math.round(sun.at(-1).sun), no_wet: clean(w[0].name), no_wet_d: Math.round(w[0].wetDays), no_dry: clean(w.at(-1).name), no_dry_d: Math.round(w.at(-1).wetDays), no_n: d.normals.stations.length });
  });
  safe(() => { // future
    const t = Object.values(d.future.towns); const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    Object.assign(out, { fu_hot_now: Math.round(med(t.map((x) => x.hot.ssp245[0][1]))), fu_hot_50: Math.round(med(t.map((x) => x.hot.ssp245[2][1]))), fu_hot_50h: Math.round(med(t.map((x) => x.hot.ssp585[2][1]))), fu_frost_now: Math.round(med(t.map((x) => x.frost.ssp245[0][1]))), fu_frost_50: Math.round(med(t.map((x) => x.frost.ssp245[2][1]))), fu_temp_up: r1(med(t.map((x) => x.temp.ssp245[2][1] - x.temp.ssp245[0][1]))) });
  });
  safe(() => { // population
    const p = Object.entries(d.population.munis).filter(([, v]) => !v.census);
    const tot = (y) => p.reduce((s, [, v]) => s + (v.pop[y] || 0), 0);
    const s65 = (y) => p.reduce((s, [, v]) => s + (v.pop[y] || 0) * (v.s65[y] || 0), 0) / tot(y);
    const ys = Object.keys(p[0][1].pop).map(Number); const y0 = Math.min(...ys), y1 = Math.max(...ys); const fp = Math.min(...p.map(([, v]) => v.firstProjection || 9999));
    const grow = p.map(([k, v]) => [k, (v.pop[fp - 1] || 0) / (v.pop[y0] || 1)]).filter(([, g]) => isFinite(g)).sort((x, y) => y[1] - x[1])[0];
    Object.assign(out, { po_y0: y0, po_y1: y1, po_now_y: fp - 1, po_t0: Math.round(tot(y0) / 1000), po_now: Math.round(tot(fp - 1) / 1000), po_end: Math.round(tot(y1) / 1000), po_s0: Math.round(s65(y0) * 100), po_snow: Math.round(s65(fp - 1) * 100), po_send: Math.round(s65(y1) * 100), po_grow: name(grow[0]), po_grow_x: r1(grow[1]) });
  });
  safe(() => { // housing, by the app's own rule: median of the last 6 months' medians, then the median across major towns
    const h = d.housing.munis; const big = ['victoria', 'saanich', 'nanaimo', 'langford', 'courtenay', 'campbell river', 'port alberni', 'parksville'];
    const price = (k, t) => { const s = h[k]; if (!s) return null; const v = []; const end = Math.floor(t * 12 + 1e-6); for (let i = end - 5; i <= end; i++) { const y = Math.floor(i / 12), m = i - y * 12; const x = s[`${y}-${String(m + 1).padStart(2, '0')}`]; if (x && x[2] > 0 && x[0] > 0) v.push(x[0]); } if (v.length < 4) return null; v.sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; };
    const typical = (t) => { const v = big.map((k) => price(k, t)).filter((x) => x); if (v.length < 5) return null; v.sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; };
    let t0 = 2017.4; while (t0 < 2026 && !typical(t0)) t0 += 1 / 12;
    // the priciest and cheapest towns now, by the same rule
    const now = new Date().getFullYear() + 0.6;
    const towns = Object.keys(h).map((k) => [k, price(k, now)]).filter(([, v]) => v).sort((x, y) => y[1] - x[1]);
    Object.assign(out, { ho_y0: Math.floor(t0), ho_t0: Math.round(typical(t0) / 1000), ho_top: name(towns[0][0]), ho_top_k: Math.round(towns[0][1] / 1000), ho_low: name(towns.at(-1)[0]), ho_low_k: Math.round(towns.at(-1)[1] / 1000) });
  });
  safe(() => { // crime
    const c = d.crime.munis; const ys = [...new Set(Object.values(c).flatMap((x) => Object.keys(x.csi || {})))].map(Number).sort((x, y) => x - y); const y1 = ys.at(-1);
    const r = Object.entries(c).map(([k, v]) => [k, v.csi?.[y1]]).filter(([, v]) => v != null).sort((x, y) => x[1] - y[1]);
    Object.assign(out, { cr_y0: ys[0], cr_y1: y1, cr_safe: name(r[0][0]), cr_safe_v: Math.round(r[0][1]), cr_high: name(r.at(-1)[0]), cr_high_v: Math.round(r.at(-1)[1]), cr_bc: Math.round(d.crime.bc?.csi?.[y1] ?? 0) });
  });
  safe(() => { // hospitals: nearest 24/7 ER by road without a ferry, per town
    const f = d.hospitals.facilities;
    const near = Object.entries(d.hospitals.towns).map(([k, trips]) => [k, Math.min(...trips.filter((t) => f[t.f].ed === '24/7' && !t.ferry && t.min != null).map((t) => t.min))]).filter(([, v]) => isFinite(v)).sort((x, y) => x[1] - y[1]);
    const far = near.at(-1);
    Object.assign(out, { hs_er: f.filter((x) => x.ed === '24/7').length, hs_fac: f.length, hs_far: name(far[0]), hs_far_min: far[1], hs_median: near[Math.floor(near.length / 2)][1], hs_n15: near.filter(([, v]) => v <= 15).length, hs_n: near.length });
  });
  safe(() => { // smoke
    const isl = d.smoke.island; const best = [...isl].sort((x, y) => y[4] - x[4])[0];
    Object.assign(out, { sm_n: d.smoke.stations.length, sm_y0: isl[0][0], sm_y1: isl.at(-1)[0], sm_year: best[0], sm_days: r1(best[4]), sm_most: best[5], sm_thr: d.smoke.threshold });
  });
  // Every layer the app has, described by the app itself: the overview and the generic films are built from this,
  // so a layer added later shows up without touching the films. Each panel is drawn off-screen at the end of the
  // layer's timeline (today, for static layers) and its headline, opening sentence and four headline numbers read.
  safe(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:344px';
    document.body.appendChild(host);
    const txt = (el, s) => el.querySelector(s)?.textContent.trim().replace(/\s+/g, ' ') ?? '';
    out.layers = a.layers.filter((l) => l.id !== 'island' && l.available).map((l) => {
      const t = l.static ? a.state.time : Math.min(l.range[1], new Date().getFullYear() + 0.6);
      const ctx = { time: t, speed: 2, data: d, selected: null, hovered: null, focusedId: l.id, clock: performance.now() };
      const el = host.appendChild(document.createElement('div'));
      try { l.panel(el, ctx)?.update?.(ctx); } catch { /* a panel that needs the live map still gives its name */ }
      const lede = txt(el, '.lede');
      const first = (lede.match(/^.*?[.!?](\s|$)/)?.[0] ?? lede).trim();
      return {
        id: l.id, name: l.name, icon: l.icon, color: l.color, static: !!l.static, range: l.range, period: l.period ?? null,
        h2: txt(el, 'h2'), lede: first.length > 170 ? '' : first,
        hero: [...el.querySelectorAll('.hero .stat')].map((s) => [txt(s, '.v'), txt(s, '.l')]),
        events: l.events().map((e) => ({ t: e.t, title: e.title, lon: e.lon ?? null, lat: e.lat ?? null, zoom: e.zoom ?? null })),
      };
    });
    host.remove();
    // the headline numbers as flat names for narration: h_<layer>_<n> and h_<layer>_<n>_l (value and label)
    // ..._who: the place a label names ("farthest: Lasqueti Island" gives "Lasqueti Island")
    for (const l of out.layers) l.hero.forEach(([v, k], i) => { out[`h_${l.id}_${i}`] = v; out[`h_${l.id}_${i}_l`] = k; out[`h_${l.id}_${i}_who`] = k.includes(': ') ? k.split(': ').slice(1).join(': ') : k; });
  });
  return out;
}
