// Trees and scrub, by kind from the world's theme (themes/: trees.kinds, trees.shrubs): conifers with soft, rounded,
// drooping tiers (spruce, fir, larch, pine: a lathe per tier with a few branch lobes, the look of the cartoon-b
// mockup), broadleaf trees with a lumpy round crown (beech, montane rainforest), low rounded scrub (dwarf pine,
// juniper, rhododendron, heath), tree ferns (a slender trunk under a rosette of arching fronds: Cyathea), the dense
// rounded crown of the Swiss stone pine (a column of clustered lumps) and the open larch (few, thin, gappy tiers, the
// trunk showing between them). Trees grow in clumps below the treeline, each spot taking one kind among those whose
// altitude band holds it; scrub grows in patches up to its own line. Both are kept off rock, ice, snow and the meadow
// along the stream, with a denser framing wall of trees just past the clearing. Three levels of detail per shape:
// each band is gathered per view, in front of that view's camera, into its own instanced mesh refilled before the
// view is drawn (no allocation); only the near band casts shadows.
import { lerp, smooth, hash3, vnoise, fbm, linear } from './math.js';
import { forestAt, drain } from './terrain.js';

export const SHAPES = ['conifer', 'round', 'shrub', 'fern', 'stone-pine', 'open-larch'];

// One unit tree (height 1, base at the origin) as plain arrays: position, normal-ready, color (shade).
// slim: crown radius at the foot (plus up to 0.07); fill: tier thickness as a share of the default (under 1 the tiers
// part and the trunk, up to `trunk`, shows between them).
export function coniferGeometry({ tiers, segs, rings, seed = 1, lobe = 0.12, slim: slim0 = 0.25, fill = 1, trunk = 0.22 }) {
  const pos = [], col = [], idx = [];
  const lathe = (pts, ts) => { // pts: [r, y, shade, lobeWeight]
    const base = pos.length / 3;
    const lob = 6 + Math.floor(hash3(ts, 1, 2) * 4), ph = hash3(ts, 2, 3) * 6.28, ph2 = hash3(ts, 3, 4) * 6.28;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const lo = 0.65 * Math.sin(lob * a + ph) + 0.35 * Math.sin((lob * 2 - 1) * a + ph2);
      for (const [r, y, sh, wl] of pts) {
        const rr = r * (1 + lobe * lo * wl), yy = y - 0.02 * Math.max(lo, 0) * wl;
        pos.push(Math.cos(a) * rr, yy, Math.sin(a) * rr); col.push(sh, sh, sh);
      }
    }
    const n = pts.length;
    for (let s = 0; s < segs; s++) for (let q = 0; q < n - 1; q++) {
      const a = base + s * n + q, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  };
  // trunk
  lathe([[0.03, -0.06, 0.35, 0], [0.026 - 0.012 * (trunk - 0.22), trunk, 0.35, 0]], seed * 97);
  const y0 = 0.1 + 0.04 * hash3(seed, 9, 9), slim = slim0 + 0.07 * hash3(seed, 5, 6);
  let yb = y0;
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers, ts = seed * 31 + i;
    const step = ((1 - y0) / tiers) * (0.82 + 0.3 * hash3(ts, 7, 1)) * (1 - 0.25 * f);
    const th = ((1 - y0) / tiers) * (i === tiers - 1 ? 2.5 : (1.7 + 0.3 * hash3(ts, 7, 2)) * fill);
    const yt = i === tiers - 1 ? 1.0 : Math.min(yb + th, 0.97);
    const R = slim * Math.pow(1 - f * 0.9, 1.05) * (0.88 + 0.22 * hash3(ts, 8, 3));
    const prof = [];
    for (let q = 0; q < rings; q++) { const p = q / (rings - 1); prof.push([R * p, yt - (yt - yb) * Math.pow(p, 1.35), 0.8 + 0.28 * p, p ** 2.5]); }
    prof.push([R * 0.97, yb - 0.022, 0.5, 1], [R * 0.78, yb - 0.016, 0.32, 0.7], [R * 0.25, yb + (yt - yb) * 0.32, 0.28, 0]);
    lathe(prof, ts);
    yb = Math.min(yb + step, 0.93);
  }
  return { position: new Float32Array(pos), color: new Float32Array(col), index: new Uint32Array(idx) };
}

export const TREE_LODS = [
  { tiers: 7, segs: 22, rings: 5 }, // near
  { tiers: 5, segs: 9, rings: 3 }, // mid
  { tiers: 3, segs: 5, rings: 2 }, // far
];

// A lumpy ball (a lathe whose radius bulges in `lob` lobes around and two along), centre (cx, cy, cz), radii
// (rx, ry), shade from dark underneath to light on top. Appends to pos, col, idx.
function lump(pos, col, idx, cx, cy, cz, rx, ry, segs, rings, seed, dark = 0.62) {
  const base = pos.length / 3, lob = 5 + Math.floor(hash3(seed, 1, 2) * 3), ph = hash3(seed, 2, 3) * 6.28;
  for (let s = 0; s <= segs; s++) {
    const a = (s / segs) * Math.PI * 2, lo = 1 + 0.12 * Math.sin(lob * a + ph);
    for (let q = 0; q <= rings; q++) {
      const v = q / rings, th = v * Math.PI, sr = Math.sin(th), cy2 = -Math.cos(th);
      const r = rx * sr * lo * (1 + 0.06 * Math.sin(3 * th + ph));
      pos.push(cx + Math.cos(a) * r, cy + ry * cy2, cz + Math.sin(a) * r);
      const sh = lerp(dark, 1.04, smooth(-0.6, 0.8, cy2)); col.push(sh, sh, sh);
    }
  }
  const n = rings + 1;
  for (let s = 0; s < segs; s++) for (let q = 0; q < rings; q++) {
    const a = base + s * n + q, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
}

// A unit broadleaf tree (height 1, base at the origin): a short trunk and a crown of overlapping round lumps.
export function roundGeometry({ lumps, segs, rings, seed = 1 }) {
  const pos = [], col = [], idx = [];
  // trunk: a straight, slightly tapered column from below the ground into the crown (on a steep slope its downhill
  // side shows a bare stem, not a spike)
  const ts = Math.max(5, segs >> 1), tb = pos.length / 3;
  for (let s = 0; s <= ts; s++) {
    const a = (s / ts) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    pos.push(ca * 0.034, -0.12, sa * 0.034, ca * 0.026, 0.5, sa * 0.026); col.push(0.3, 0.3, 0.3, 0.36, 0.36, 0.36);
  }
  for (let s = 0; s < ts; s++) { const a = tb + s * 2, c = a + 2; idx.push(a, a + 1, c, a + 1, c + 1, c); }
  lump(pos, col, idx, 0, 0.66, 0, 0.3, 0.26, segs, rings, seed * 11);
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + hash3(seed, i, 4) * 0.8, r = 0.17 + 0.05 * hash3(seed, i, 5);
    const y = 0.52 + 0.24 * hash3(seed, i, 6), s = 0.17 + 0.06 * hash3(seed, i, 7);
    lump(pos, col, idx, Math.cos(a) * r, y, Math.sin(a) * r, s, s * 0.85, segs, rings, seed * 13 + i);
  }
  return { position: new Float32Array(pos), color: new Float32Array(col), index: new Uint32Array(idx) };
}

// A unit shrub (height 1, base at the origin, about 1 wide): a few low rounded mounds sitting on the ground.
export function shrubGeometry({ lumps, segs, rings, seed = 1 }) {
  const pos = [], col = [], idx = [];
  lump(pos, col, idx, 0, 0.42, 0, 0.32, 0.58, segs, rings, seed * 17, 0.55);
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + hash3(seed, i, 8), r = 0.2 + 0.08 * hash3(seed, i, 9), s = 0.18 + 0.08 * hash3(seed, i, 10);
    lump(pos, col, idx, Math.cos(a) * r, s * 1.1, Math.sin(a) * r, s, s * 2.1, segs, rings, seed * 19 + i, 0.55);
  }
  return { position: new Float32Array(pos), color: new Float32Array(col), index: new Uint32Array(idx) };
}

// A unit tree fern (height 1, base at the origin, about 1.1 wide): a slender trunk and a rosette of `fronds` arching
// fronds, each a closed flat ribbon (wide across, thin up and down, tapering to its tip) along a curve that rises
// from the crown, bends out and droops, `pts` sections along it and `around` vertices round each section.
export function fernGeometry({ fronds, pts, around, seed = 1 }) {
  const pos = [], col = [], idx = [];
  lump(pos, col, idx, 0, 0.26, 0, 0.04, 0.58, Math.max(5, around), 3, seed * 23, 0.3); // trunk (a long, thin lump, its foot in the ground)
  lump(pos, col, idx, 0, 0.82, 0, 0.06, 0.05, Math.max(5, around), 2, seed * 29, 0.5); // the crown knob
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + (hash3(seed, f, 21) - 0.5) * 0.6, ca = Math.cos(a), sa = Math.sin(a);
    const len = 0.5 + 0.12 * hash3(seed, f, 22), lift = 0.55 + 0.5 * hash3(seed, f, 23); // young fronds stand up higher
    const base = pos.length / 3;
    for (let q = 0; q < pts; q++) {
      const t = q / (pts - 1), r = len * t;
      const y = 0.82 + len * (lift * t - (0.5 + 0.7 * lift) * t * t); // up, then over, the tip hanging below the crown
      const dy = len * (lift - 2 * (0.5 + 0.7 * lift) * t); // slope of the curve, to tilt the section
      const w = 0.1 * Math.sin(Math.PI * Math.min(1, 0.12 + t)) * (1 - 0.65 * t), th = 0.012 * (1 - 0.7 * t) + 0.002;
      const nx = -dy / Math.hypot(1, dy), ny = 1 / Math.hypot(1, dy); // the section's up in the frond's vertical plane
      for (let k = 0; k < around; k++) {
        const b = (k / around) * Math.PI * 2, cw = Math.cos(b) * w, sv = Math.sin(b) * th;
        // across (perpendicular to the frond, horizontal) plus up/down along the section normal
        pos.push(ca * r - sa * cw + ca * nx * sv, y + ny * sv, sa * r + ca * cw + sa * nx * sv);
        const sh = Math.sin(b) > 0 ? 1.0 : 0.6; col.push(sh, sh, sh);
      }
    }
    for (let q = 0; q < pts - 1; q++) for (let k = 0; k < around; k++) {
      const a0 = base + q * around + k, a1 = base + q * around + ((k + 1) % around), b0 = a0 + around, b1 = a1 + around;
      idx.push(a0, a1, b0, a1, b1, b0);
    }
  }
  return { position: new Float32Array(pos), color: new Float32Array(col), index: new Uint32Array(idx) };
}

// A unit Swiss stone pine (Pinus cembra; height 1, base at the origin, about 0.6 wide): a short bare trunk and a dense
// crown of clustered round lumps from about a fifth of the height up, irregular, rounded at the top (an old tree's
// candelabra of several rounded heads).
export function stonePineGeometry({ levels, per, segs, rings, seed = 1 }) {
  const pos = [], col = [], idx = [];
  lump(pos, col, idx, 0, 0.16, 0, 0.035, 0.3, Math.max(5, segs >> 1), 3, seed * 31, 0.3); // trunk
  lump(pos, col, idx, 0, 0.56, 0, 0.2, 0.36, segs, rings, seed * 37, 0.5); // the core of the crown
  for (let l = 0; l < levels; l++) {
    const f = l / Math.max(1, levels - 1), y = 0.3 + 0.52 * f, n = Math.max(1, Math.round(per * (1 - 0.45 * f)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash3(seed, l * 7 + i, 41) * 1.3 + l * 0.9;
      const r = (0.17 - 0.08 * f) * (0.7 + 0.5 * hash3(seed, l * 7 + i, 42)), s = (0.15 - 0.03 * f) * (0.8 + 0.4 * hash3(seed, l * 7 + i, 43));
      lump(pos, col, idx, Math.cos(a) * r, y + 0.06 * hash3(seed, l * 7 + i, 44), Math.sin(a) * r, s, s * 0.85, segs, rings, seed * 43 + l * 7 + i, 0.5);
    }
  }
  return { position: new Float32Array(pos), color: new Float32Array(col), index: new Uint32Array(idx) };
}

// A unit open larch (Larix decidua; height 1): a narrow cone of a few thin tiers with gaps between them where the
// trunk shows, airier than the spruce.
export const larchGeometry = (o) => coniferGeometry({ ...o, slim: 0.19, fill: 0.42, trunk: 0.9, lobe: 0.2 });

export const ROUND_LODS = [{ lumps: 5, segs: 14, rings: 7 }, { lumps: 4, segs: 8, rings: 4 }, { lumps: 2, segs: 5, rings: 3 }];
export const SHRUB_LODS = [{ lumps: 3, segs: 10, rings: 5 }, { lumps: 2, segs: 6, rings: 3 }, { lumps: 0, segs: 5, rings: 2 }];
export const FERN_LODS = [{ fronds: 11, pts: 9, around: 6 }, { fronds: 8, pts: 5, around: 4 }, { fronds: 6, pts: 3, around: 3 }];
export const STONE_PINE_LODS = [{ levels: 4, per: 5, segs: 10, rings: 5 }, { levels: 3, per: 3, segs: 6, rings: 3 }, { levels: 1, per: 2, segs: 5, rings: 2 }];
export const LARCH_LODS = [{ tiers: 6, segs: 16, rings: 4 }, { tiers: 4, segs: 8, rings: 3 }, { tiers: 3, segs: 5, rings: 2 }];

// The unit geometry of a shape at a level of detail.
export function shapeGeometry(shape, li, seed = 5) {
  if (shape === 1) return roundGeometry({ ...ROUND_LODS[li], seed: seed + li });
  if (shape === 2) return shrubGeometry({ ...SHRUB_LODS[li], seed: seed + li });
  if (shape === 3) return fernGeometry({ ...FERN_LODS[li], seed: seed + li });
  if (shape === 4) return stonePineGeometry({ ...STONE_PINE_LODS[li], seed: seed + li });
  if (shape === 5) return larchGeometry({ ...LARCH_LODS[li], seed: seed + li });
  return coniferGeometry({ ...TREE_LODS[li], seed: seed + li });
}

// The kind growing at a spot: one of `kinds` by share among those whose altitude band holds alt (soft 60 m edges),
// picked with u in [0, 1); null where none grows.
export function pickKind(kinds, alt, u) {
  let tot = 0;
  for (const k of kinds) tot += bandWeight(k, alt);
  if (tot <= 0) return null;
  let acc = 0;
  for (const k of kinds) { acc += bandWeight(k, alt) / tot; if (u < acc) return k; }
  return kinds[kinds.length - 1];
}
const bandWeight = (k, alt) => k.share * smooth(k.alt[0] - 60, k.alt[0] + 60, alt) * (1 - smooth(k.alt[1] - 60, k.alt[1] + 60, alt));
export const kindWeight = (kinds, alt) => kinds.reduce((s, k) => s + bandWeight(k, alt), 0);

// Tree instances for a stage: { count, matrix: Float32Array(16n), color: Float32Array(3n), pos: Float32Array(3n) }.
// terrain: buildStageTerrain() result (groundAt); streams: createPathIndex();
// palette: createPalette().
export function placeTrees(stage, terrain, streams, theme, palette) {
  return drain(placeTreesSteps(stage, terrain, streams, theme, palette));
}

// The same placement as a generator that yields after every row of candidates (see index.js, built in idle time).
// Returns { count, matrix, color, pos, shape (index in SHAPES per instance), grid }.
export function* placeTreesSteps(stage, terrain, streams, theme, palette) {
  const T = theme.trees, m = stage.height, o = stage.offset, kinds = T.kinds || [], SH = T.shrubs || { kinds: [] };
  const shrubs = SH.kinds || [];
  const x1 = m.x0 + (m.w - 1) * m.step, z1 = m.z0 + (m.h - 1) * m.step;
  const out = [], hit = {}, c = [0, 0, 0];
  const slopeAt = (x, z) => {
    const e = 4, gx = terrain.groundAt(x + e, z) - terrain.groundAt(x - e, z), gz = terrain.groundAt(x, z + e) - terrain.groundAt(x, z - e);
    return Math.atan(Math.hypot(gx, gz) / (2 * e)) * 57.2958;
  };
  const consider = (x, z, sp, onGrid) => {
    const y = terrain.groundAt(x, z), alt = y + o.y, slope = slopeAt(x, z), gx = x + o.x, gz = z + o.z;
    if (slope > Math.max(T.maxSlope, SH.maxSlope || 0)) return;
    let wall = 0, open = true; // open: past the clearing along the stream, where trees may stand
    if (streams.nearest(x, z, hit, 260)) {
      const clear = hit.hw + lerp(T.clearing[0], T.clearing[1], 0.5 + 0.5 * vnoise(x / 40, z / 40, 7));
      if (hit.d < clear * (shrubs.length ? 0.55 : 1)) return; // scrub reaches a little closer to the water
      open = hit.d >= clear;
      wall = 1 - smooth(clear + T.wall * 0.4, clear + T.wall, hit.d);
    }
    if (palette.ground(c, { alt, slope, x: gx, z: gz }) > 0.35) return; // rock, scree, ice, snow
    const u = hash3(Math.round(x * 10), Math.round(z * 10), 3), pick = hash3(Math.round(x * 10), Math.round(z * 10), 11);
    // trees: the forest clumps below the treeline, a denser wall past the clearing
    const forest = slope <= T.maxSlope && open ? forestAt(theme, alt, slope, gx, gz) * Math.min(1, kindWeight(kinds, alt) * 4) : 0;
    if (forest >= 0.02) {
      const p = T.density * (forest + 0.9 * wall * (forest > 0.15 ? 1 : 0.3)) * (onGrid ? 1 : 0.8);
      if (u <= p) { const k = pickKind(kinds, alt, pick); if (k) { out.push([x, y, z, sp, alt, k]); return; } }
    }
    // scrub: patches in the open ground up to its line, thinning out at the top
    if (!shrubs.length || alt > SH.line + 60 || slope > SH.maxSlope) return;
    const patch = smooth(-0.15, 0.35, fbm(gx / 90, gz / 90, 13) + 0.1) * (1 - smooth(SH.line - 150, SH.line + 60, alt)) * Math.min(1, kindWeight(shrubs, alt) * 4);
    if (patch <= 0.02 || u > SH.density * patch * (1 - forest) * (onGrid ? 1 : 0.7)) return;
    const k = pickKind(shrubs, alt, pick);
    if (k) out.push([x, y, z, sp, alt, k]);
  };
  const S = T.spacing;
  for (let z = m.z0 + S / 2; z < z1; z += S) {
    for (let x = m.x0 + S / 2; x < x1; x += S) {
      const jx = x + (hash3(x * 10, z * 10, 1) - 0.5) * S * 1.1, jz = z + (hash3(z * 10, x * 10, 2) - 0.5) * S * 1.1;
      if (jx > m.x0 + 2 && jx < x1 - 2 && jz > m.z0 + 2 && jz < z1 - 2) consider(jx, jz, S, true);
    }
    yield;
  }
  // a ring of forest on the backdrop around the stage grid
  const F = T.farSpacing, R = T.farRing;
  for (let z = m.z0 - R; z < z1 + R; z += F) {
    for (let x = m.x0 - R; x < x1 + R; x += F) {
      if (x > m.x0 - F && x < x1 + F && z > m.z0 - F && z < z1 + F) continue;
      const jx = x + (hash3(x * 10, z * 10, 4) - 0.5) * F, jz = z + (hash3(z * 10, x * 10, 5) - 0.5) * F;
      consider(jx, jz, F, false);
    }
    yield;
  }
  const n = out.length, matrix = new Float32Array(n * 16), color = new Float32Array(n * 3), pos = new Float32Array(n * 3), shape = new Uint8Array(n);
  const lin = new Map(), colorsOf = (k) => { let l = lin.get(k); if (!l) lin.set(k, (l = (k.colors || ['#3d6a47']).map(linear))); return l; };
  const treeline = theme.terrain.treeline;
  out.forEach(([x, y, z, sp, alt, k], i) => {
    const sh = Math.max(0, SHAPES.indexOf(k.shape)), hr = k.height || T.height, r1 = hash3(i, 4, 1);
    // trees shrink toward the treeline (scrub keeps its size), the far ring a little taller to read at distance
    const shrink = sh === 2 ? 1 : 1 - 0.3 * smooth(treeline - 250, treeline, alt);
    const hh = lerp(hr[0], hr[1], r1 ** 1.5) * shrink * (sp > S && sh !== 2 ? 1.15 : 1);
    const wd = hh * (k.width ?? T.width) * (0.85 + 0.35 * hash3(i, 5, 2));
    const a = hash3(i, 6, 3) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    // k.lean (deg): gnarled trees lean up to this far, each its own way (a shear: the crown off the foot)
    const ln = k.lean ? Math.tan(k.lean * Math.PI / 180 * hash3(i, 11, 8)) * hh : 0;
    // column-major TRS: rotation about y, scale (wd, hh, wd), slightly sunk into the slope
    matrix.set([ca * wd, 0, -sa * wd, 0, ca * ln, hh, -sa * ln, 0, sa * wd, 0, ca * wd, 0, x, y - (sh === 2 ? 0.15 : 0.4), z, 1], i * 16);
    const cols = colorsOf(k), base = cols[Math.floor(hash3(i, 9, 6) * cols.length)];
    const kk = 0.9 + 0.18 * hash3(i, 10, 7);
    color[i * 3] = base[0] * kk; color[i * 3 + 1] = base[1] * kk; color[i * 3 + 2] = base[2] * kk;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    shape[i] = sh;
  });
  return { count: n, matrix, color, pos, shape, grid: bucket(pos, n, 96) };
}

function bucket(pos, n, cell) {
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.floor(pos[i * 3] / cell) * 65536 + Math.floor(pos[i * 3 + 2] / cell);
    let l = map.get(k);
    if (!l) map.set(k, (l = []));
    l.push(i);
  }
  for (const [k, l] of map) map.set(k, Int32Array.from(l));
  return { map, cell };
}

// Cell offsets (a, b) of a (2R+1)^2 block, nearest first: a band that reaches its cap then drops its farthest
// trees, not whichever cells a row by row walk happened to visit last. Built once per R.
const ORDERS = new Map();
function cellOrder(R) {
  let o = ORDERS.get(R);
  if (o) return o;
  const cells = [];
  for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) cells.push([a, b, a * a + b * b]);
  cells.sort((p, q) => p[2] - q[2]);
  o = Int16Array.from(cells.flatMap(([a, b]) => [a, b]));
  ORDERS.set(R, o);
  return o;
}

// Fills one instance buffer per level of detail (and per shape) for one camera, nearest band first.
// bands: [{ r (m), matrix, color, cap }], `lods` of them per shape: the tree of shape s at level k goes to
// bands[s * lods + k] (lods defaults to all of them: one shape), the radii are those of the first shape;
// cone: cosine of the horizontal half angle kept in front of the camera (fwd is its unit forward in x, z); trees closer than 40 m are always kept (shadows, wide lenses).
// Cells are walked nearest first, so a full band loses its farthest trees. counts[k] receives the number
// written into bands[k]. No allocation (Math.sqrt, not Math.hypot, which allocates its arguments).
export function gatherTrees(trees, cx, cz, fwdX, fwdZ, cone, bands, counts, lods = bands.length) {
  const { map, cell } = trees.grid, P = trees.pos, M = trees.matrix, C = trees.color, SH = trees.shape, nb = lods;
  const rMax = bands[nb - 1].r, R = Math.ceil(rMax / cell), order = cellOrder(R);
  const ci = Math.floor(cx / cell), cj = Math.floor(cz / cell);
  for (let k = 0; k < bands.length; k++) counts[k] = 0;
  for (let c = 0; c < order.length; c += 2) {
    const a = order[c], b = order[c + 1];
    // skip whole cells outside the radius or behind the camera
    const ox = (a + 0.5) * cell + (ci * cell - cx), oz = (b + 0.5) * cell + (cj * cell - cz), od = Math.sqrt(ox * ox + oz * oz);
    if (od > rMax + cell) continue;
    if (od > 2 * cell && (ox * fwdX + oz * fwdZ) / od < cone - 0.25) continue;
    const l = map.get((ci + a) * 65536 + cj + b);
    if (!l) continue;
    for (let q = 0; q < l.length; q++) {
      const i = l[q], dx = P[i * 3] - cx, dz = P[i * 3 + 2] - cz, d2 = dx * dx + dz * dz;
      if (d2 >= rMax * rMax) continue;
      if (d2 > 1600 && dx * fwdX + dz * fwdZ < cone * Math.sqrt(d2)) continue;
      let k = 0;
      while (k < nb - 1 && d2 >= bands[k].r * bands[k].r) k++;
      if (SH && SH[i]) k += SH[i] * nb;
      const dst = bands[k], n = counts[k];
      if (n >= dst.cap) continue;
      for (let e = 0; e < 16; e++) dst.matrix[n * 16 + e] = M[i * 16 + e];
      dst.color[n * 3] = C[i * 3]; dst.color[n * 3 + 1] = C[i * 3 + 1]; dst.color[n * 3 + 2] = C[i * 3 + 2];
      counts[k] = n + 1;
    }
  }
  return counts;
}
