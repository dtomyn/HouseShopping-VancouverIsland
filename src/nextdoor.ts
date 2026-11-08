// What's next door to a Land Finder parcel: parks, Crown land, water and logging around it, from
// public/data/land-neighbours.json (scripts/neighbours.mjs). The file lines up with land.json by parcel order; a
// hash of land.json's PID column guards against a mismatch, in which case the Next door filters stay off.

/** The ring's classes, in the order the pipeline numbers them (CLASSES in scripts/neighbours.mjs). */
export const NB_CLASSES = [
  { label: 'Private or other land', c: '#3b4660' },
  { label: 'Water', c: '#38bdf8' },
  { label: 'Park or protected area', c: '#2dd4bf' },
  { label: 'Crown land', c: '#c4b5fd' },
  { label: 'Logged in the last 10 years', c: '#f59e0b' },
  { label: 'Logged 10–30 years ago', c: '#d6b27c' },
  { label: 'Logged over 30 years ago', c: '#65a30d' },
  { label: 'Approved or being logged', c: '#ff5ca8' },
];

export type Neighbours = {
  source: string; asOf: number; count: number; check: string; cell: number;
  sectors: number; bands: number[]; classes: string[];
  /** [name ('' when unnamed), kind] */
  parks: [string, string][];
  cols: {
    /** metres from the parcel to the nearest park, Crown land, approved/active block, water (null: none within 1 km) */
    parkM: (number | null)[]; parkI: (number | null)[]; crownM: (number | null)[]; planM: (number | null)[];
    /** 1 approved, 2 being logged */
    planK: (number | null)[]; waterM: (number | null)[];
    /** latest harvest year within 1 km (or on the parcel), and on the parcel itself */
    lastCut: (number | null)[]; onCut: (number | null)[];
    /** hectares logged within 1 km in the last 10 years */
    cut10: number[];
    /** sectors × bands digits (class index), sector 0 = north, clockwise, innermost band first */
    ring: string[];
  };
};

/** FNV-1a over the PID column, the same as pidHash() in scripts/neighbours.mjs. */
export function pidHash(pids: string[]) {
  let h = 0x811c9dc5;
  for (const p of pids) {
    for (let i = 0; i < p.length; i++) { h ^= p.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= 124; h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export async function loadNeighbours(pids: string[]): Promise<Neighbours | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/land-neighbours.json`);
    if (!res.ok) return null;
    const j = (await res.json()) as Neighbours;
    if (j.count !== pids.length || j.check !== pidHash(pids)) {
      console.warn('land-neighbours.json no longer matches land.json; run npm run data neighbours');
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

/** The parcel at the centre, its surroundings in sectors and bands out to 1 km, and a key with each class's share. */
export function ringSvg(ring: string, nb: Neighbours) {
  const S = nb.sectors, B = nb.bands.length;
  const size = 172, c = size / 2;
  const radii = [24, 44, 62, 82]; // parcel, then each band's outer edge (nearer bands drawn wider than to scale)
  const arc = (r0: number, r1: number, a0: number, a1: number) => {
    const p = (r: number, a: number) => `${(c + r * Math.sin(a)).toFixed(2)},${(c - r * Math.cos(a)).toFixed(2)}`;
    return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)} Z`;
  };
  const counts = new Array(NB_CLASSES.length).fill(0);
  let cells = '';
  for (let s = 0; s < S; s++)
    for (let b = 0; b < B; b++) {
      const k = +ring[s * B + b] || 0;
      counts[k] += [1, 2, 4][b] ?? 1; // the outer bands are bigger areas
      const a0 = ((s - 0.5) / S) * 2 * Math.PI, a1 = ((s + 0.5) / S) * 2 * Math.PI;
      cells += `<path class="nd-cell" d="${arc(radii[b] + 1, radii[b + 1], a0, a1)}" fill="${NB_CLASSES[k].c}" style="animation-delay:${(s * 40 + b * 90)}ms"><title>${NB_CLASSES[k].label}, ${nb.bands[b - 1] ?? 0}–${nb.bands[b]} m</title></path>`;
    }
  const total = counts.reduce((a, v) => a + v, 0) || 1;
  const key = NB_CLASSES.map((k, i) => ({ ...k, i, share: counts[i] / total })).filter((k) => k.share > 0).sort((a, b) => b.share - a.share);
  const lab = (r: number, t: string) => `<text class="nd-lab" x="${c + 3}" y="${c - r + 9}">${t}</text>`;
  return `<div class="nd-ring">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="What surrounds the parcel, out to 1 km">
      <g class="nd-cells">${cells}</g>
      <circle cx="${c}" cy="${c}" r="${radii[0] - 2}" fill="rgba(255,255,255,.1)" stroke="#fff" stroke-width="1.5"/>
      <text class="nd-n" x="${c}" y="${c + 4}" text-anchor="middle">Lot</text>
      <text class="nd-n" x="${c}" y="9" text-anchor="middle">N</text>
      ${lab(radii[1], '250 m')}${lab(radii[2], '500 m')}${lab(radii[3], '1 km')}
    </svg>
    <div class="nd-key">${key.map((k) => `<span><i style="background:${k.c}"></i>${k.label}<em>${Math.round(k.share * 100)}%</em></span>`).join('')}</div>
  </div>`;
}
