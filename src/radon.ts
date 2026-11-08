// RADON — Health Canada's Cross-Canada Survey of Radon Concentrations in Homes (2009–2011): one long-term test in
// each volunteer home, summed up by the island's three health areas. A static layer drawn at the only grain the open
// data supports (three big areas, ~270 homes), so its message is "test any house you buy", not "avoid this town".
// Data from scripts/radon.mjs (public/data/radon.json, outlines in radon-map.json loaded on first show).
import * as d3 from 'd3';
import { PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Radon, RadonArea, RadonMap, fmt, loadRadonMap } from './data';
import type { AtlasEvent, AtlasLayer, Ctx } from './layers';
import { rampCSS } from './charts';
import { esc, safeUrl } from './html';

type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;

export const RADON_COLOR = '#e9c46a';
/** Share of homes over the guideline: calm green through amber to red (BC's highest health areas are near 30%). */
const shareColor = d3.scaleLinear<string>().domain([0, 0.03, 0.1, 0.2, 0.3]).range(['#5e9c7f', '#a5c97a', '#f2d16b', '#f08a4b', '#d9434b']).clamp(true);
export const RADON_REFS = {
  survey: { label: 'Cross-Canada Survey of Radon Concentrations in Homes (Health Canada, open.canada.ca)', url: 'https://open.canada.ca/data/en/dataset/b3bad1b0-32d4-4656-8a64-59b43900d482' },
  report: { label: 'Cross-Canada Survey of Radon Concentrations in Homes: final report (Health Canada, 2012)', url: 'https://www.canada.ca/en/health-canada/services/environmental-workplace-health/reports-publications/radiation/cross-canada-survey-radon-concentrations-homes-final-report-health-canada-2012.html' },
  radon: { label: 'Radon: what you need to know, testing and reducing it (Health Canada)', url: 'https://www.canada.ca/en/health-canada/services/health-risks-safety/radiation/radon.html' },
  bccdc: { label: 'Radon, and the BC Radon Map (BC Centre for Disease Control)', url: 'http://www.bccdc.ca/health-info/prevention-public-health/radon' },
  cnrpp: { label: 'Find a certified radon measurement or mitigation professional (C-NRPP)', url: 'https://c-nrpp.ca/' },
};

const pct = (k: number, n: number) => (n ? (100 * k) / n : 0);
const pctTxt = (k: number, n: number) => { const p = pct(k, n); return p === 0 ? '0%' : p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`; };
const bq = (R: Radon, v: number) => (v < R.lod ? `under ${R.lod} Bq/m³` : `${fmt.int(Math.round(v))} Bq/m³`);
const short = (R: Radon, v: number) => (v < R.lod ? `<${R.lod}` : fmt.int(Math.round(v)));

/** The town's health area and its figures, or null. */
export function townRadon(data: Data, key: string): RadonArea | null {
  const R = data.radon;
  if (!R) return null;
  const i = R.towns[key];
  return i == null ? null : R.areas[i] ?? null;
}

/** The Town Report row: its health area's share over 200 Bq/m³ with the sample size. */
export function radonTownRow(data: Data, key: string, metric: (l: string, dot: string, v: string, sub: string) => string) {
  const R = data.radon;
  if (!R) return '';
  const a = townRadon(data, key);
  if (!a) return metric('Radon (area survey)', RADON_COLOR, '<span style="color:var(--ink-3)">n/a</span>', '');
  return metric(
    'Radon (area survey)', RADON_COLOR,
    `${a.over200} of ${a.n} homes`,
    `over ${R.guideline} Bq/m³ (${pctTxt(a.over200, a.n)}), median ${short(R, a.median)} Bq/m³ · ${esc(a.name)} health area, Health Canada survey ${esc(R.years)}. Area-wide, not this town: test any house you buy.<br><button class="tr-fall" data-layer="radon" style="margin-top:6px">☢ Radon ›</button>`,
  );
}

/** Every home's result as a dot on a square-root scale, one row per area, with the guideline marked. */
function stripSVG(R: Radon, areas: RadonArea[]) {
  const W = 320, rowH = 34, top = 14, left = 0, right = 8;
  const max = Math.max(400, ...areas.map((a) => a.max));
  const x = d3.scaleSqrt().domain([0, max]).range([left + 34, W - right]);
  const H = top + areas.length * rowH + 18;
  const rows = areas.map((a, i) => {
    const y0 = top + i * rowH;
    const dots = a.values.filter((v) => v >= R.lod).map((v, j) => {
      const jit = ((j * 37) % 11) / 10 - 0.5;
      return `<circle cx="${x(v).toFixed(1)}" cy="${(y0 + 14 + jit * 12).toFixed(1)}" r="2.6" fill="${v > R.guideline ? '#f08a4b' : RADON_COLOR}" fill-opacity="${v > R.guideline ? 1 : 0.6}"/>`;
    }).join('');
    return `<text x="0" y="${y0 - 1}" fill="var(--ink-3)" font-size="10">${esc(a.name)} · ${a.n} homes</text>
      <rect x="0" y="${y0 + 5}" width="30" height="18" rx="4" fill="rgba(255,255,255,.06)"/><text x="15" y="${y0 + 18}" text-anchor="middle" fill="var(--ink-2)" font-size="10" font-family="JetBrains Mono, monospace">${a.belowLod}</text>${dots}`;
  }).join('');
  const g = x(R.guideline);
  const ticks = [50, 100, 200, 300].filter((t) => t <= max).map((t) => `<text x="${x(t).toFixed(1)}" y="${H - 2}" text-anchor="middle" fill="var(--ink-3)" font-size="9.5">${t}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Every tested home's radon level by health area">
    <line x1="${g}" x2="${g}" y1="${top - 4}" y2="${H - 12}" stroke="#f08a4b" stroke-dasharray="3 3"/>
    <text x="${g + 3}" y="${top + 2}" fill="#f08a4b" font-size="9.5">guideline</text>
    ${rows}
    <text x="15" y="${H - 2}" text-anchor="middle" fill="var(--ink-3)" font-size="9.5">&lt;${R.lod}</text>${ticks}
  </svg>`;
}

type Poly = { a: number; poly: [number, number][][] };

export function radonLayer(data: Data): AtlasLayer {
  const R = data.radon;
  const areas = R?.areas ?? [];
  let map: RadonMap | null = null;
  let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  let polys: Poly[] = [];
  const ensure = () => {
    if (state !== 'idle') return;
    state = 'loading';
    loadRadonMap().then((j) => {
      if (!j) { state = 'failed'; return; }
      map = j;
      polys = j.areas.flatMap((ps, a) => ps.map((poly) => ({ a, poly })));
      state = 'ready';
    });
  };
  const townsIn = (i: number) => data.munis.filter((m) => R?.towns[m.key] === i).map((m) => m.name);

  const describeArea = (i: number, at?: [number, number]): AtlasEvent | null => {
    const a = areas[i];
    if (!R || !a) return null;
    const towns = townsIn(i);
    const fsas = a.fsas.filter((f) => f.fsa !== 'withheld');
    return {
      layer: 'radon', kind: 'Radon · health area', title: `${a.name}`,
      body: `${a.n} homes in the ${a.name} health area were tested for radon for three months or more in Health Canada’s 2009–2011 survey. ${a.over200 === 0 ? 'None' : a.over200 === 1 ? 'One' : String(a.over200)} came in over Canada’s guideline of ${R.guideline} Bq/m³${a.over200 ? ` (the highest ${bq(R, a.max)})` : ''}, and ${a.belowLod} of them were too low to measure.${towns.length ? ` Towns here: ${towns.join(', ')}.` : ''}`,
      lon: at?.[0] ?? a.label?.[0], lat: at?.[1] ?? a.label?.[1], zoom: 7.4,
      stats: [
        { v: `${a.over200} of ${a.n}`, l: `homes over ${R.guideline} Bq/m³ (${pctTxt(a.over200, a.n)})` },
        { v: short(R, a.median), l: 'median, Bq/m³' },
        { v: short(R, a.p90), l: 'nine homes in ten below, Bq/m³' },
        { v: pctTxt(R.totals.bc.over200, R.totals.bc.n), l: `over ${R.guideline} across BC (${fmt.int(R.totals.bc.n)} homes)` },
      ],
      sections: [
        { title: 'How fine this is', text: `One number for a whole health area, from ${a.n} volunteer homes: it can’t tell one street, or one house, from the next. Radon depends on the ground right under a house and on how the house is built and aired, so two neighbours can differ tenfold. A low area means high homes are rarer here, not absent.` },
        ...(fsas.length ? [{ title: 'Tests by postal area', text: `${fsas.map((f) => `${f.fsa}: ${f.n} home${f.n > 1 ? 's' : ''}${f.over200 ? `, ${f.over200} over ${R.guideline}` : ''} (highest ${short(R, f.max)})`).join('; ')}${a.fsas.some((f) => f.fsa === 'withheld') ? `; ${a.fsas.find((f) => f.fsa === 'withheld')!.n} with the postal area withheld for privacy` : ''}. A handful of homes each, too few to rank places by.` }] : []),
        { title: 'What to do', text: `Test any house you buy: a long-term (three months or more) kit costs about $30–60, is best run through the heating season on the lowest floor you live on, and is the only way to know. If it reads over ${R.guideline} Bq/m³, a certified mitigator can fit a sub-slab fan and pipe (active soil depressurization) for typically a few thousand dollars, which usually cuts radon by 80% or more.` },
      ],
      sources: [RADON_REFS.survey, RADON_REFS.radon, RADON_REFS.cnrpp],
      detail: (el) => { el.insertAdjacentHTML('beforeend', `<div style="margin:8px 0">${stripSVG(R, [a])}</div>`); },
    };
  };

  const l: AtlasLayer = {
    id: 'radon',
    name: 'Radon',
    icon: '☢',
    color: RADON_COLOR,
    range: [2026, 2026.99],
    static: true,
    period: R ? `home tests ${R.years}` : 'home tests',
    available: !!R,
    unavailable: 'The radon data hasn’t been built yet. Run <code>npm run data radon</code>, then reload.',
    build({ focusedId }: Ctx) {
      if (!R) return [];
      ensure();
      if (!map) return [];
      const focused = focusedId === 'radon';
      const fill = (a: number) => { const ar = areas[a]; return rgb(shareColor(ar.n ? ar.over200 / ar.n : 0), focused ? 105 : 70); };
      const out: Layer[] = [
        new PolygonLayer<Poly>({
          id: 'radon-areas-base',
          data: polys,
          getPolygon: (p) => p.poly,
          getFillColor: (p) => fill(p.a),
          getLineColor: [255, 236, 190, focused ? 200 : 120],
          getLineWidth: 1.2,
          lineWidthUnits: 'pixels',
          stroked: true,
          pickable: true,
          updateTriggers: { getFillColor: focused },
          parameters: NO_DEPTH,
        } as any),
      ];
      if (focused) {
        const labelled = areas.map((a, i) => ({ a, i })).filter((d) => d.a.label);
        out.push(
          new TextLayer<{ a: RadonArea; i: number }>({
            id: 'radon-labels',
            data: labelled,
            getPosition: (d) => d.a.label!,
            getText: (d) => `${d.a.over200} of ${d.a.n} homes over ${R.guideline}`,
            getSize: 12,
            getColor: [255, 244, 220, 245],
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 230],
            fontSettings: { sdf: true },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `<div class="kicker" style="--c:${RADON_COLOR}">Radon · Health Canada home survey</div>
        <h2>Radon: test the house, not the town</h2>`;
      if (!R) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const T = R.totals;
      const stat = (v: string, lab: string) => `<div class="stat"><div class="v">${v}</div><div class="l">${lab}</div></div>`;
      const bcMax = Math.max(...R.bc.map((b) => pct(b.over200, b.n)), 1);
      const bcRows = [...R.bc].sort((a, b) => pct(b.over200, b.n) - pct(a.over200, a.n)).map((b, i) => {
        const p = pct(b.over200, b.n);
        return `<li style="cursor:default${b.island ? ';background:rgba(233,196,106,.08)' : ''}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(b.name)}</span><br><span class="rd">${b.over200} of ${b.n} homes · median ${short(R, b.median)} Bq/m³</span></span><span><div class="bar"><i style="width:${Math.round((p / bcMax) * 100)}%;background:${shareColor(p / 100)}"></i></div><div class="bar-v">${pctTxt(b.over200, b.n)}</div></span></li>`;
      }).join('');
      const bccdc = safeUrl(RADON_REFS.bccdc.url);
      el.insertAdjacentHTML('beforeend', `
        <p class="lede"><b>Radon</b> is a radioactive gas with no smell or colour that seeps out of the ground as uranium in rock and soil breaks down. Outdoors it thins away; in a house it can build up, worst in basements and in winter. Breathed for years, it is the <b>second cause of lung cancer after smoking</b>, and the first among people who never smoked. Canada’s guideline is <b>${R.guideline} Bq/m³</b>.</p>`);
      const hero = el.appendChild(document.createElement('div'));
      hero.className = 'hero';
      hero.innerHTML = [
        stat(`${T.island.over200} of ${T.island.n}`, `island homes tested over ${R.guideline} Bq/m³ (${pctTxt(T.island.over200, T.island.n)})`),
        stat(pctTxt(T.bc.over200, T.bc.n), `over ${R.guideline} across BC (${fmt.int(T.bc.n)} homes)`),
        stat(pctTxt(T.canada.over200, T.canada.n), `over ${R.guideline} across Canada (${fmt.int(T.canada.n)} homes)`),
        stat(String(areas.reduce((s, a) => s + a.belowLod, 0)), `island homes too low to measure (under ${R.lod})`),
      ].join('');
      el.insertAdjacentHTML('beforeend', `
        <div class="callout" style="--c:${RADON_COLOR}"><b>Low here, but any house can be high.</b> Vancouver Island and the Gulf Islands are among the lowest-radon parts of Canada: the island’s volcanic and sedimentary rocks carry little uranium, unlike the Kootenays’ granites. Even so, ${T.island.over200} of the ${T.island.n} island homes tested were over the guideline, and radon is decided by the ground right under a house and how it is built. <b>Test any house you buy</b>: a long-term kit (three months or more, through the heating season, on the lowest floor you live on) costs about $30–60. If it reads high, a certified mitigator can usually fix it with a sub-slab fan and pipe for a few thousand dollars, cutting radon by 80% or more.</div>
        <h3>Every island home tested</h3>
        <div>${stripSVG(R, areas)}</div>
        <p class="note">Each dot is one home’s average over three months or more (square-root scale, Bq/m³). The box counts homes under ${R.lod} Bq/m³, too low for the test to measure.</p>
        <h3>The map</h3>
        <div class="ramp" style="background:${rampCSS((t) => shareColor(t * 0.3))}"></div>
        <div class="ramp-labels"><span>0%</span><span>10%</span><span>20%</span><span>30%+ of homes over ${R.guideline}</span></div>
        <p class="note">Shaded by the share of tested homes over the guideline in each of the island’s three health areas: the finest grain this open data allows. The North Island area runs onto the mainland coast because the health area does. Click an area for its figures and its tests by postal area.</p>
        <h3>BC’s health areas compared</h3>
        <ol class="rank-list">${bcRows}</ol>
        <p class="note">Health Canada’s Cross-Canada Survey of Radon Concentrations in Homes, ${esc(R.years)}: one long-term test in each of about ${fmt.int(Math.round(T.canada.n / 1000) * 1000)} volunteer homes across Canada, chosen by the homeowners rather than at random, so a few dozen homes stand for a whole health area. BC’s own Radon Data Repository holds tens of thousands more tests and draws the BC Radon Map${bccdc ? ` (<a href="${esc(bccdc)}" target="_blank" rel="noopener">BCCDC</a>)` : ''}, but its data is released only on request, so it isn’t used here.</p>
        <div class="source">Source: ${esc(R.source)}. <a href="${RADON_REFS.radon.url}" target="_blank" rel="noopener">Health Canada on radon</a> · <a href="${RADON_REFS.cnrpp.url}" target="_blank" rel="noopener">certified testers and mitigators</a>.</div>`);
      return { update() {} };
    },
    describe(info: PickingInfo) {
      if (!R || !info.object || info.layer?.id !== 'radon-areas-base') return null;
      return describeArea((info.object as Poly).a, info.coordinate as [number, number] | undefined);
    },
    tooltip(info: PickingInfo) {
      if (!R || !info.object || info.layer?.id !== 'radon-areas-base') return null;
      const a = areas[(info.object as Poly).a];
      if (!a) return null;
      return `<b>${esc(a.name)} health area</b><br><span class="tk">Homes over ${R.guideline} Bq/m³</span> <span class="tv">${a.over200} of ${a.n} (${pctTxt(a.over200, a.n)})</span><br><span class="tk">Median</span> <span class="tv">${short(R, a.median)} Bq/m³</span><br><span class="tk">Highest</span> <span class="tv">${short(R, a.max)} Bq/m³</span><br><span class="tk">Tested</span> <span class="tv">${esc(R.years)}, Health Canada</span>`;
    },
  };
  return l;
}
