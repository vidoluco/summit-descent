// The species of Everest (Khumbu), K2 (Baltoro, Godwin-Austen glacier) and Kerinci (Sumatra), plugged in
// through registry.js as the top of index.js describes. Each comes from a free model of the same animal or
// of the same body plan, reshaped and repainted at load time into the game's smooth cartoon look; the
// conventions are the ones of species.js (rules in fractions of the bounding box, sizes in real metres).
// Coats with a pattern (rosettes, stripes, the tapir's saddle) are drawn per corner on the final surface
// from a 3D noise in metres, so they stay soft curves on any source. Credits are in assets/CREDITS.md.
// Which species live where, and at what altitude, is in docs/mountains/<world>.md.
import { smooth } from './build.js';
import { SPECIES as ALPS, quadruped, bump } from './species.js';
import { SPECIES as CARPATHIANS } from './species-carpazi.js';

// 3D value noise and cellular (Worley) distance, deterministic, for the coat patterns. p in metres.
function hash(i, j, k) {
  let h = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), u = x - i, v = y - j, w = z - k;
  const s = (t) => t * t * (3 - 2 * t), a = s(u), b = s(v), c = s(w);
  const l = (p, q, t) => p + (q - p) * t;
  return l(l(l(hash(i, j, k), hash(i + 1, j, k), a), l(hash(i, j + 1, k), hash(i + 1, j + 1, k), a), b),
    l(l(hash(i, j, k + 1), hash(i + 1, j, k + 1), a), l(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), a), b), c);
}
// distance to the nearest of one jittered point per unit cell
function cells(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  let d = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const I = i + a, J = j + b, K = k + c;
    d = Math.min(d, Math.hypot(x - I - hash(I, J, K), y - J - hash(K, I, J), z - K - hash(J, K, I)));
  }
  return d;
}
// 1 on a band of a periodic field u (one band per unit), w the band's share of the period
const band = (u, w) => { const v = Math.abs(((u % 1) + 1) % 1 - 0.5) * 2; return smooth(1 - w, 1 - w * 0.55, v); };

// A limb or tail redrawn along a new centreline, in the side plane (z, y). from: the source centreline as
// [z, y] fraction points, root first; to: the new centreline, same count; thick(t) scales the cross-section
// (t from 0 at the root to 1 at the tip). Each vertex keeps its distance from the line, turned with it.
function along([x, y, z], fr, from, to, thick = () => 1) {
  const [, sy, sz] = fr.size, P = (q) => [q[0] * sz, q[1] * sy];
  let best = null, acc = 0;
  const lens = [];
  for (let i = 0; i + 1 < from.length; i++) { const a = P(from[i]), b = P(from[i + 1]); lens.push(Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = lens.reduce((u, v) => u + v, 0);
  for (let i = 0; i + 1 < from.length; i++) {
    const a = P(from[i]), b = P(from[i + 1]), dz = b[0] - a[0], dy = b[1] - a[1], l2 = dz * dz + dy * dy;
    const u = Math.min(1, Math.max(0, ((z - a[0]) * dz + (y - a[1]) * dy) / l2));
    const cz = a[0] + dz * u, cy = a[1] + dy * u, d = Math.hypot(z - cz, y - cy);
    if (!best || d < best.d) best = { d, i, u, t: (acc + lens[i] * u) / total, oz: z - cz, oy: y - cy, dz, dy };
    acc += lens[i];
  }
  const { i, u, t, oz, oy } = best, l = Math.hypot(best.dz, best.dy);
  const nrm = (oz * -best.dy + oy * best.dz) / l, tan = (oz * best.dz + oy * best.dy) / l; // offset across and along
  const a = P(to[i]), b = P(to[i + 1]), ez = b[0] - a[0], ey = b[1] - a[1], m = Math.hypot(ez, ey), k = thick(t);
  const cz = a[0] + ez * u, cy = a[1] + ey * u;
  return [x * k, cy + (nrm * ez + tan * ey) / m * k, cz + (nrm * -ey + tan * ez) / m * k];
}

// the yak's horns and tail on the bison source (its small pale horns out of the sides of the head, the
// thin tail down the rump)
const yakTail = (f) => Math.abs(f.x) < 0.05 && f.z < -0.475 && f.y > 0.55;
const yakHorn = (f) => Math.abs(f.x) > 0.325 && f.y > 0.72 && f.y < 0.82 && f.z > 0.36 && f.z < 0.41;
// the pika's ears on the hamster, the striped rabbit's on the rabbit
const pikaEar = (f) => Math.abs(f.x) > 0.19 && f.y > 0.6 && f.z > 0.28 && f.z < 0.38;
const rabbitEar = (f) => Math.abs(f.x) > 0.08 && f.y > 0.68 && f.z > 0.22 && f.z < 0.4;
// p scaled by k about the centre c (all [x, y, z] in metres)
const about = (p, c, k) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k, c[2] + (p[2] - c[2]) * k];

export const SPECIES = {
  // Snow leopard (Panthera uncia), Khumbu and Baltoro: the Poly snow leopard with the cat's long, thick
  // tail hanging low and curled up at the tip, small round ears, big paws; smoky pale grey with a cream
  // tinge, white belly, dark open rosettes on the body, solid spots on the head and legs, rings on the tail.
  'snow-leopard': {
    file: 'asia/snow-leopard.glb',
    credit: 'Snow leopard by Poly by Google (CC-BY 3.0), poly.pizza/m/26tTvxyxkPC',
    size: { length: 1.25 },
    colors: { coat: '#c8c4ba', belly: '#f2efe8', rosette: '#2f2c2a', spot: '#33302d', tail: '#cfcabe', ear: '#6a645d', nose: '#c99a92', eye: '#1b1d17', iris: '#9fb39a' },
    paint(s, f) {
      if (f.z < -0.31 && f.y < 0.8) return 'tail';
      if (f.y > 0.94 && f.z > 0.25 && f.z < 0.38) return 'ear';
      if (f.z > 0.485 && f.y > 0.78 && f.y < 0.86) return 'nose';
      return 'coat';
    },
    repaint(k, f, p) {
      if (k === 'nose' || k === 'ear') return k;
      if (k === 'tail') { // close dark blots, joining into rings toward the dark tip
        const t = smooth(-0.3, -0.5, f.z), d = cells(p[0] * 14, p[1] * 14, p[2] * 14);
        const ring = band((p[1] * 0.8 + p[2]) / 0.075, 0.3) * smooth(0.3, 0.7, t);
        return ['tail', 'rosette', Math.min(1, Math.max(smooth(0.38, 0.24, d), ring, smooth(0.93, 1, t)) * 0.95)];
      }
      const belly = smooth(0.42, 0.33, f.y) * smooth(-0.25, -0.1, f.z) * smooth(0.3, 0.18, f.z) * smooth(0.2, 0.28, f.y);
      const chin = smooth(0.78, 0.7, f.y) * smooth(0.36, 0.44, f.z);
      const pale = Math.max(belly, chin);
      // rosettes (rings of blots) on the body, solid spots on the head and legs
      const solid = Math.max(smooth(0.3, 0.36, f.z) * smooth(0.7, 0.78, f.y), smooth(0.42, 0.3, f.y));
      // dense and small (5-8 cm rosettes on a 1.2 m cat), broken rings on the body, solid spots on the head and legs
      const F = solid > 0.5 ? 18 : 12;
      const d = cells(p[0] * F + noise3(p[0] * 30, p[1] * 30, p[2] * 30) * 0.3, p[1] * F, p[2] * F);
      const ring = bump(0.16, 0.26, 0.36, 0.46, d) * (0.5 + 0.5 * noise3(p[0] * 50, p[1] * 50, p[2] * 50)) * 1.15;
      const m = (solid > 0.5 ? smooth(0.32, 0.18, d) : ring) * (1 - pale);
      if (pale > 0.02 && m < 0.3) return ['coat', 'belly', pale];
      return ['coat', solid > 0.5 ? 'spot' : 'rosette', Math.min(1, m)];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      if (f.z < -0.31 && f.y < 0.8) { // the tail: nearly as long as the body, thick, hanging low, the tip curled up
        return along([x, y, z], fr, [[-0.33, 0.78], [-0.4, 0.45], [-0.44, 0.24], [-0.5, 0.1]], [[-0.33, 0.76], [-0.43, 0.42], [-0.54, 0.22], [-0.72, 0.34]],
          (t) => 1.75 + 0.35 * Math.sin(t * Math.PI) - 0.45 * smooth(0.8, 1, t));
      }
      if (f.y > 0.9 && f.z > 0.25 && f.z < 0.4) { const by = 0.92 * sy; return [x, by + (y - by) * 0.55, z]; } // small low ears
      if (f.y < 0.06) { // big snowshoe paws
        const fz = f.z > -0.05 ? 0.2 : -0.24, k = 1 + 0.45 * smooth(0.06, 0.0, f.y);
        return [x * k, y * 0.85, fz * sz + (z - fz * sz) * (1 + (k - 1) * 0.4)];
      }
      return [x * (1 + 0.25 * bump(0.4, 0.55, 0.8, 0.92, f.y) + 0.12 * smooth(0.45, 0.2, f.y)), y - 0.15 * Math.min(y, 0.45 * sy), z]; // stockier, shorter legs
    },
    eyes: [{ f: [0.16, 0.885, 0.44], r: 0.02, color: 'iris' }],
    taubin: { iterations: 3 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.78, 0.28], head: (f) => smooth(0.26, 0.36, f.z) * smooth(0.6, 0.7, f.y), hip: 0.45, front: 0.22, back: -0.22, tail: [0.75, -0.3], pitch: 0.85 }),
    motion: { walk: 0.9, run: 7, stride: 1.0, gait: 'walk', swing: 0.45, graze: 0 },
    creaseDeg: 60,
  },
  // Sumatran tiger (Panthera tigris sumatrae), Kerinci Seblat: the Poly tiger in the darkest orange of
  // the tigers, with the Sumatran's close, narrow, often doubled stripes (drawn from a warped band field,
  // vertical on the body, ringed on the legs and tail), white belly, cheeks and the ruff of long cheek hair,
  // black ear backs, a ringed tail with a black tip.
  'sumatran-tiger': {
    file: 'asia/tiger.glb',
    credit: 'Tiger by Poly by Google (CC-BY 3.0), poly.pizza/m/5A3w06FXUup',
    size: { length: 2.0 },
    colors: { coat: '#b9541a', tail: '#b9541a', coatL: '#d5813a', white: '#f1ebdf', stripe: '#1c1715', ear: '#221b18', nose: '#b57c6e', eye: '#1a120c', iris: '#d7b23c' },
    paint(s, f) {
      if (f.z < -0.34 && f.y < 0.8) return 'tail';
      if (f.y > 0.92 && f.z > 0.26 && f.z < 0.36 && Math.abs(f.x) > 0.12) return 'ear';
      if (f.z > 0.485 && f.y > 0.72 && f.y < 0.8) return 'nose';
      return 'coat';
    },
    repaint(k, f, p) {
      if (k === 'nose' || k === 'ear') return k;
      const warp = (noise3(p[0] * 6, p[1] * 6, p[2] * 6) - 0.5) * 0.09;
      if (k === 'tail') { // rings, the last one a black tip
        const t = smooth(-0.34, -0.5, f.z), r = band((p[1] + p[2] * 0.6) / 0.09 + warp * 6, 0.36);
        return ['coat', 'stripe', Math.max(r * (0.5 + 0.5 * t), smooth(0.9, 1, t))];
      }
      // white underside from the chest to the inner thighs, the throat, the cheeks and the muzzle
      const belly = smooth(0.4, 0.3, f.y) * smooth(0.12, 0.3, f.y) * smooth(-0.36, -0.2, f.z) * smooth(0.3, 0.18, f.z) * smooth(0.32, 0.18, Math.abs(f.x));
      const throat = smooth(0.3, 0.38, f.z) * smooth(0.66, 0.56, f.y) * smooth(0.36, 0.46, f.y);
      const cheek = smooth(0.34, 0.41, f.z) * bump(0.62, 0.67, 0.75, 0.8, f.y) * smooth(0.08, 0.16, Math.abs(f.x) + (f.z - 0.4) * 0.6);
      const muzzle = smooth(0.43, 0.47, f.z) * smooth(0.76, 0.71, f.y);
      const white = Math.max(belly, throat, cheek, muzzle);
      // the stripes: across the body from the spine down the flank, rings on the legs, close and narrow
      const leg = smooth(0.42, 0.34, f.y);
      const u = leg > 0.5 ? (p[1] + warp) / 0.1 : (p[2] + warp * 1.4 + Math.abs(p[0]) * 0.3) / 0.105;
      const taper = leg > 0.5 ? smooth(0.04, 0.16, f.y) * smooth(0.36, 0.26, f.y) : smooth(0.34, 0.5, f.y + (noise3(p[0] * 9, p[1] * 9, p[2] * 9) - 0.5) * 0.2);
      const head = smooth(0.3, 0.36, f.z);
      const st = band(u, head > 0.5 ? 0.3 : 0.4) * taper * (1 - white) * (1 - 0.7 * smooth(0.42, 0.48, f.z));
      if (white > 0.02 && st < 0.3) return ['coat', 'white', white];
      const light = smooth(0.52, 0.42, f.y) * 0.5;
      return st > 0.02 ? ['coat', 'stripe', st] : ['coat', 'coatL', light];
    },
    deform([x, y, z], f, fr) {
      if (f.z < -0.34 && f.y < 0.8) { // a fuller tail, hanging, the tip turned out
        return along([x, y, z], fr, [[-0.36, 0.8], [-0.42, 0.46], [-0.45, 0.22], [-0.5, 0.17]], [[-0.36, 0.78], [-0.44, 0.46], [-0.48, 0.24], [-0.55, 0.22]], (t) => 1.6 - 0.3 * t);
      }
      if (f.y > 0.9 && f.z > 0.25 && f.z < 0.38) { const by = 0.92 * fr.size[1]; return [x, by + (y - by) * 0.7, z]; } // round ears
      return [x * (1 + 0.18 * bump(0.4, 0.55, 0.8, 0.95, f.y) * smooth(0.3, 0.42, f.z)), y, z]; // the cheek ruff widens the head
    },
    eyes: [{ f: [0.16, 0.85, 0.43], r: 0.016, color: 'iris' }],
    taubin: { iterations: 3 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.76, 0.28], head: (f) => smooth(0.26, 0.36, f.z) * smooth(0.55, 0.66, f.y), hip: 0.45, front: 0.22, back: -0.24, tail: [0.78, -0.33], pitch: 0.85 }),
    motion: { walk: 1.0, run: 8, stride: 1.2, gait: 'walk', swing: 0.45, graze: 0 },
    creaseDeg: 60,
  },
  // Domestic yak (Bos grunniens) of the Khumbu trail: the Poly bison with the hump lowered to the yak's
  // gentle withers, the beard gone, the long skirt of hair hanging from the flanks nearly to the fetlocks, the bushy
  // horse-like tail, long horns curving out and up; black-brown, browner on the back, with the white blaze
  // many Khumbu yaks carry, and the red wool collar and bell of a yak train.
  yak: {
    file: 'asia/bison.glb',
    credit: 'Bison by Poly by Google (CC-BY 3.0), poly.pizza/m/9sTrha-TxdS',
    size: { length: 2.3 },
    colors: { coat: '#33261f', coatL: '#5c4535', skirt: '#231a16', blaze: '#ece6da', horn: '#d9cfbc', hornTip: '#4a4038', nose: '#2a2321', hoof: '#1d1816', eye: '#0f0c0b', collar: '#b4302a', bell: '#c9a03c', tail: '#231a16' },
    paint(s, f) {
      if (yakHorn(f) && Math.abs(f.x) > 0.345) return 'horn'; // the root stays coat, the horn grows out of the hair
      if (f.y < 0.04) return 'hoof';
      if (yakTail(f)) return 'tail';
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'horn') return ['horn', 'hornTip', smooth(0.82, 0.92, f.y)];
      if (k !== 'coat') return k;
      if (f.z > 0.47 && f.y < 0.62) return 'nose';
      // the red woollen collar round the neck
      if (Math.abs(f.z - (0.27 + (f.y - 0.6) * 0.25)) < 0.018 && f.y > 0.56 && f.y < 0.86) return 'collar';
      const blaze = smooth(0.06, 0.02, Math.abs(f.x)) * smooth(0.4, 0.44, f.z) * bump(0.6, 0.66, 0.78, 0.82, f.y);
      if (blaze > 0.02) return ['coat', 'blaze', blaze];
      // the skirt darker, in long locks (paler streaks down it), the hem ragged
      const skirt = smooth(0.5, 0.3, f.y) * (1 - smooth(0.3, 0.4, f.z));
      const lock = smooth(0.55, 0.95, Math.sin(f.z * 95 + Math.sin(f.y * 30) * 0.8) * 0.5 + 0.5) * smooth(0.12, 0.3, f.y) * 0.45;
      const back = smooth(0.72, 0.9, f.y) * 0.75;
      return skirt > 0.02 ? ['skirt', 'coatL', lock * skirt] : ['coat', 'coatL', back];
    },
    deform([x, y, z], f, fr) {
      const [sx, sy, sz] = fr.size;
      if (yakHorn(f)) { // horns: out sideways, then curving up, tapering to the tip
        const s = Math.sign(x), t = Math.min(1, (Math.abs(f.x) - 0.325) / 0.085), a = 1.5 * t, R = 0.34, k = 1.7 - 1.35 * t; // thick at the root
        const dy = (y - 0.772 * sy) * k, dz = (z - 0.385 * sz) * k;
        return [s * (0.325 * sx + R * Math.sin(a) - dy * Math.sin(a)), 0.772 * sy + R * (1 - Math.cos(a)) + dy * Math.cos(a), 0.385 * sz + dz - 0.06 * t * t];
      }
      if (yakTail(f)) { // the tail: long, hanging to the hocks, a bushy switch
        return along([x, y, z], fr, [[-0.47, 0.85], [-0.5, 0.62]], [[-0.47, 0.84], [-0.53, 0.3]], (t) => 1.6 + 3.6 * smooth(0.25, 0.9, t));
      }
      // the beard under the head goes: the throat stays where the skirt starts
      if (f.z > 0.18 && f.z < 0.44 && f.y < 0.56 && f.y > 0.28) y = 0.56 * sy - (0.56 * sy - y) * 0.45;
      // the hump: the yak's withers are high but not the bison's mountain
      const hump = smooth(-0.3, -0.05, f.z) * smooth(0.32, 0.1, f.z);
      if (y > 0.8 * sy) y = 0.8 * sy + (y - 0.8 * sy) * (1 - 0.08 * hump);
      // the skirt: the lower flank and the belly hang down past the knees nearly to the fetlocks, a curtain of
      // locks over the upper legs (the long guard hair of the Khumbu yaks)
      const skirt = smooth(0.26, 0.36, f.y) * smooth(0.66, 0.52, f.y) * bump(-0.44, -0.36, 0.18, 0.26, f.z);
      if (skirt > 0) {
        const hem = 0.1 * sy * (1 + 0.35 * Math.sin(z * 31 + x * 7) + 0.2 * Math.sin(z * 67));
        y -= skirt * (y - hem) * 0.88; x *= 1 + 0.1 * skirt;
      }
      // a smaller head, carried low
      const head = smooth(0.3, 0.4, f.z) * smooth(0.4, 0.5, f.y);
      if (head > 0) [x, y, z] = about([x, y, z], [0, 0.66 * sy, 0.38 * sz], 1 - 0.12 * head);
      return [x, y, z];
    },
    eyes: [{ f: [0, 0.72, 0.43], r: 0.022, surface: 0.4 }],
    parts: [{ f: [0, 0.4, 0.3], r: [0.06, 0.075, 0.055], color: 'bell', mirror: false }],
    taubin: { iterations: 3 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.66, 0.3], head: (f) => smooth(0.28, 0.38, f.z) * smooth(0.36, 0.48, f.y), hip: 0.42, front: 0.22, back: -0.33, tail: [0.84, -0.47], pitch: 0.8 }),
    motion: { walk: 0.8, run: 3, stride: 1.2, gait: 'walk', swing: 0.35, graze: 1, flee: 'amble' },
    creaseDeg: 60,
  },
  // Large-eared pika (Ochotona macrotis), in the moraine rocks under the K2 face: the Poly hamster made
  // into the pika's round egg of a body (shorter, higher backed), no tail, big round ears with pale rims;
  // sandy grey-brown above with an ochre tinge, pale buff underneath.
  pika: {
    file: 'asia/hamster.glb',
    credit: 'Hamster by Poly by Google (CC-BY 3.0), poly.pizza/m/3YtzEQ5TVUP',
    size: { length: 0.3 }, // the source before it is shortened into the pika's 18 cm
    colors: { coat: '#a2937d', coatD: '#7c6f5f', ochre: '#b79b70', belly: '#e2d8c6', ear: '#75685a', rim: '#efe7d8', nose: '#3b312b', foot: '#dcd0bc', eye: '#120f0d' },
    paint(s, f) {
      if (f.y < 0.08 && f.z > -0.4) return 'foot'; // the source's ears sink into the coat, the round ones are parts
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'ear') return ['ear', 'rim', smooth(0.9, 1, f.y)];
      if (k === 'foot') return k;
      if (f.z > 0.485 && f.y > 0.42 && f.y < 0.5) return 'nose';
      const belly = smooth(0.34, 0.22, f.y) * smooth(-0.42, -0.3, f.z);
      const chin = smooth(0.42, 0.34, f.y) * smooth(0.3, 0.4, f.z);
      if (Math.max(belly, chin) > 0.02) return ['coat', 'belly', Math.max(belly, chin)];
      const back = smooth(0.62, 0.8, f.y) * 0.6, flank = bump(0.3, 0.4, 0.55, 0.65, f.y) * 0.55;
      return back > flank ? ['coat', 'coatD', back] : ['coat', 'ochre', flank];
    },
    deform([x, y, z], f, fr) {
      const [sx, sy, sz] = fr.size;
      if (pikaEar(f)) { const q = about([x, y, z], [Math.sign(x) * 0.12 * sx, 0.6 * sy, 0.3 * sz], 0.15); return [q[0], q[1], q[2] * 0.6]; } // the hamster's ears go, round ones come
      // a round egg: shorter, the back raised in the middle, the rump rounded off where the tail would be
      z *= 0.6;
      const hump = Math.cos(Math.min(1, Math.abs(f.z + 0.05) / 0.5) * Math.PI / 2);
      y = y + hump * smooth(0.3, 0.9, f.y) * 0.16 * sy;
      x *= 1 + 0.12 * hump * smooth(0.15, 0.5, f.y);
      return [x, y, z];
    },
    eyes: [{ f: [0, 0.6, 0.39], r: 0.0045, surface: 0.4 }],
    parts: [{ f: [0.17, 0.86, 0.29], r: [0.0045, 0.0135, 0.012], color: 'ear', surface: 0.1 }],
    taubin: { iterations: 4 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.45, 0.2], head: (f) => smooth(0.18, 0.3, f.z) * smooth(0.25, 0.4, f.y), hip: 0.22, front: 0.22, back: -0.25, pitch: 0.5, hop: true }),
    motion: { walk: 0.8, run: 4, stride: 0.25, gait: 'hop', hop: 0.05, swing: 0.5, graze: 0.6, flee: 'burrow' },
    creaseDeg: 60,
  },
  // Malayan tapir (Tapirus indicus), Kerinci Seblat above the park edge: the Poly peccary lowered and
  // lengthened into the tapir's barrel body, the high rounded rump, the short drooping proboscis, small
  // round ears rimmed white; black head, shoulders and legs, and the white saddle from behind the
  // shoulders over the back and rump to the belly.
  'malayan-tapir': {
    file: 'asia/peccary.glb',
    credit: 'Collared peccary by Poly by Google (CC-BY 3.0), poly.pizza/m/3eoOcw_d00X',
    size: { length: 2.1 },
    colors: { black: '#1f1d20', blackL: '#353238', saddle: '#e6e3dc', saddleD: '#c9c5bd', rim: '#efede8', nose: '#2c282a', hoof: '#17151a', eye: '#0f0d0e' },
    paint(s, f) {
      if (f.y > 0.75 && f.z > 0.19 && f.z < 0.34 && Math.abs(f.x) > 0.28) return 'rim';
      if (f.y < 0.04) return 'hoof';
      return 'black';
    },
    repaint(k, f) {
      if (k === 'rim') return ['black', 'rim', smooth(0.86, 0.94, f.y) + smooth(0.36, 0.42, Math.abs(f.x))];
      if (k === 'hoof') return k;
      // the saddle: a clean edge slanting back from behind the shoulder, down to the belly; the hind legs black
      const front = smooth(0.11, 0.07, f.z - (f.y - 0.6) * 0.18), under = smooth(0.3, 0.38, f.y);
      const thigh = smooth(-0.3, -0.36, f.z) * smooth(0.5, 0.42, f.y) * smooth(0.18, 0.28, Math.abs(f.x));
      const s = front * under * (1 - thigh);
      if (s > 0.02) return ['black', 'saddle', s];
      return ['black', 'blackL', smooth(0.75, 0.95, f.y) * 0.35];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      // a lower animal: shorter legs, the body a barrel, the rump the highest point of the back
      y = y < 0.36 * sy ? y * 0.84 : y - 0.058 * sy;
      const rump = smooth(0.05, -0.3, f.z) * smooth(0.6, 0.85, f.y);
      y += rump * 0.07 * sy * Math.cos(Math.min(1, Math.abs(f.z + 0.3) / 0.25) * Math.PI / 2 * 0.9);
      if (f.z < -0.38) { const z0 = -0.38 * sz; z = z0 + (z - z0) * 0.85; } // a round rump, no pig's tail end
      // the proboscis: the snout droops from the eyes forward and ends blunt
      const nose = smooth(0.38, 0.5, f.z);
      if (nose > 0) { y -= nose * nose * 0.11 * sy; x *= 1 - 0.2 * nose; }
      if (f.y > 0.75 && f.z > 0.19 && f.z < 0.34 && Math.abs(f.x) > 0.28) [x, y, z] = about([x, y, z], [Math.sign(x) * 0.3 * fr.size[0], 0.8 * sy, 0.27 * sz], 1.5); // the ears
      return [x, y, z];
    },
    eyes: [{ f: [0, 0.7, 0.33], r: 0.017, surface: 0.4 }],
    taubin: { iterations: 4 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.6, 0.22], head: (f) => smooth(0.18, 0.3, f.z) * smooth(0.4, 0.52, f.y), hip: 0.36, front: 0.0, back: -0.4, pitch: 0.75 }),
    motion: { walk: 0.8, run: 4.5, stride: 1.0, gait: 'walk', swing: 0.4, graze: 0.7 },
    creaseDeg: 60,
  },
  // Sumatran striped rabbit (Nesolagus netscheri), Kerinci's montane forest: the Poly rabbit with the short
  // ears of the species, grey-buff with the dark brown stripes (along the spine from the nose to the tail,
  // down the shoulder, along the flank, round the haunch, through the eye), rufous rump and tail.
  'sumatran-striped-rabbit': {
    file: 'asia/rabbit.glb',
    credit: 'Rabbit by Poly by Google (CC-BY 3.0), poly.pizza/m/9OBTRVYUSmt',
    size: { length: 0.4 },
    colors: { coat: '#a99c84', stripe: '#3a2a20', rump: '#b0643a', belly: '#e6ded0', ear: '#8e7f6a', nose: '#4e3a34', eye: '#120e0c' },
    paint(s, f) {
      if (rabbitEar(f)) return 'ear';
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'ear') return ['ear', 'stripe', smooth(0.86, 0.95, f.y) * 0.6];
      if (f.z > 0.485 && f.y > 0.42 && f.y < 0.55) return 'nose';
      const ax = Math.abs(f.x);
      const belly = smooth(0.3, 0.2, f.y) * smooth(0.1, 0.18, f.y) * smooth(-0.3, -0.15, f.z) * smooth(0.3, 0.15, f.z) * smooth(0.3, 0.18, ax);
      if (belly > 0.02) return ['coat', 'belly', belly];
      // the stripes, as distances in the side plane: one along the spine and down the face, one from behind
      // the ear over the shoulder, one along the flank to the hip, one round the haunch
      const line = (d, w) => smooth(w * 1.35, w * 0.35, Math.abs(d));
      const spine = line(ax, 0.1) * smooth(0.6, 0.7, f.y);
      const shoulder = line(f.z - 0.16 - (f.y - 0.6) * 0.45, 0.05) * smooth(0.3, 0.4, f.y) * smooth(0.78, 0.7, f.y) * smooth(0.1, 0.18, ax);
      const flank = line(f.y - 0.5 - f.z * 0.3, 0.05) * bump(-0.3, -0.18, 0.08, 0.16, f.z) * smooth(0.12, 0.2, ax);
      const haunch = line(Math.hypot(f.z + 0.27, (f.y - 0.38) * 0.9) - 0.16, 0.045) * smooth(0.12, 0.2, ax) * smooth(0.22, 0.3, f.y);
      const face = line(f.y - 0.64 + (f.z - 0.36) * 0.7, 0.035) * smooth(0.32, 0.37, f.z) * smooth(0.48, 0.44, f.z) * smooth(0.04, 0.1, ax);
      const st = Math.min(1, Math.max(spine, shoulder, flank, haunch, face));
      const rump = smooth(-0.32, -0.42, f.z) * smooth(0.2, 0.3, f.y);
      if (st > 0.02) return [rump > 0.5 ? 'rump' : 'coat', 'stripe', st];
      return ['coat', 'rump', rump];
    },
    deform([x, y, z], f, fr) {
      if (rabbitEar(f)) { // short, rounded ears
        const [, sy, sz] = fr.size, b = [x, 0.72 * sy, 0.31 * sz];
        return [x * 0.92, b[1] + (y - b[1]) * 0.42, b[2] + (z - b[2]) * 0.75];
      }
      return [x, y, z];
    },
    eyes: [{ f: [0, 0.66, 0.37], r: 0.014, surface: 0.4 }],
    taubin: { iterations: 3 },
    subdivide: { levels: 3, scheme: 'phong' }, // one level more than the others: the stripes are narrow for its triangles
    rig: quadruped({ neck: [0.45, 0.22], head: (f) => smooth(0.2, 0.3, f.z) * smooth(0.38, 0.5, f.y), hip: 0.3, front: 0.2, back: -0.2, pitch: 0.6, hop: true }),
    motion: { walk: 1, run: 6, stride: 0.5, gait: 'hop', hop: 0.1, swing: 0.6, graze: 0.6 },
    creaseDeg: 60,
  },
  // Salvadori's pheasant (Lophura inornata), the Sumatran endemic of Kerinci's montane forest: the Poly
  // pheasant with its long tail cut to the Lophura's short drooping wedge, the male's blue-black plumage with a
  // glossy blue sheen on the back and wings, the bare red face, pale bill, grey legs.
  'salvadoris-pheasant': {
    file: 'asia/pheasant.glb',
    credit: 'Pheasant by Poly by Google (CC-BY 3.0), poly.pizza/m/1wqLCnNFCgv',
    size: { length: 0.75 },
    colors: { black: '#1b1f2b', sheen: '#30405f', face: '#d3372c', bill: '#cdc9b4', leg: '#7c7e82', eye: '#120f0e', tail: '#161820' },
    paint(s, f) {
      if (s.hue < 15 && s.sat > 0.6 && f.y > 0.78 && f.z > 0.4) return 'face';
      if (f.z > 0.475 && f.y > 0.84 && f.y < 0.93) return 'bill';
      if (f.y < 0.28 && f.z > 0.05 && f.z < 0.35) return 'leg';
      if (f.z < -0.1 && f.y > 0.3) return 'tail';
      return 'black';
    },
    repaint(k, f) {
      if (k === 'black') return ['black', 'sheen', smooth(0.45, 0.65, f.y) * smooth(-0.15, 0.1, f.z) * smooth(0.3, 0.18, f.z) * 0.85];
      return k;
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      if (f.z < -0.1 && f.y > 0.3) { // the tail: short, broad and drooping, a wedge with no hook (Lophura)
        const z0 = -0.1 * sz, t = Math.min(1, (z0 - z) / (0.4 * sz)), yc = 0.5 * sy - t * 0.18 * sy;
        return [x * (1 + 1.8 * Math.sqrt(t)), yc + (y - 0.58 * sy) * (0.22 - 0.12 * t), z0 + (z - z0) * 0.12];
      }
      return [x, y, z];
    },
    eyes: [{ f: [0, 0.875, 0.425], r: 0.012, surface: 0.4 }],
    taubin: { iterations: 2 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.75, 0.3], head: (f) => smooth(0.3, 0.38, f.z) * smooth(0.7, 0.8, f.y), hip: 0.28, front: 0.15, back: 0.15, pitch: 0.75, legs: false }),
    motion: { walk: 0.7, run: 4, stride: 0.25, gait: 'hop', hop: 0.025, graze: 0.8, flee: 'amble' },
    creaseDeg: 60,
  },
  // Wreathed hornbill (Rhyticeros undulatus) flying over the Kerinci forest: the Poly soaring bird given the
  // hornbill's long, deep, pale bill with the low ridged casque, the yellow throat pouch, the neck stretched
  // out, a longer narrow white tail; black body and wings, the male's cream head and neck with the dark
  // chestnut crown and nape.
  'wreathed-hornbill': {
    file: 'poly-google/bird-soaring.glb',
    credit: 'Bird by Poly by Google (CC-BY 3.0), poly.pizza/m/8Ph79kHbt9s',
    orient: [0, -1, 0, 0, 0, -1, 1, 0, 0],
    size: { span: 1.35 },
    flying: true,
    colors: { black: '#19181c', sheen: '#2c2d36', white: '#f3f0e8', cream: '#ecdfc2', crown: '#5b2e1e', bill: '#efe3b2', casque: '#d9c08a', pouch: '#f2cf3e', eye: '#7a2a1e' },
    paint() { return 'black'; },
    repaint(k, f) {
      const ax = Math.abs(f.x);
      if (f.z < -0.18 && ax < 0.12) return ['black', 'white', smooth(-0.2, -0.26, f.z)]; // the white tail
      if (ax < 0.07 && f.z > 0.16) { // the head and neck: cream, the crown and nape chestnut
        const crown = smooth(0.26, 0.4, f.y) * smooth(0.2, 0.28, f.z);
        return crown > 0.02 ? ['cream', 'crown', crown] : ['black', 'cream', smooth(0.16, 0.24, f.z)];
      }
      return ['black', 'sheen', smooth(0.5, 0.9, f.y) * 0.6];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size, ax = Math.abs(f.x);
      const w = smooth(0.39, 0.44, f.z) * smooth(0.14, 0.22, f.y);
      if (w > 0) y = 0.13 * sy + (y - 0.13 * sy) * (1 - 0.8 * w); // close the gaping bill
      if (f.z > 0.25 && ax < 0.08) z += 0.04 * sz * smooth(0.25, 0.32, f.z); // the neck stretched out
      if (f.z > 0.4 && f.z <= 0.5) return about([x, y, z], [0, 0.14 * sy, 0.42 * sz], 0.3); // the raptor's hooked bill goes in (the parts sit beyond it)
      if (f.z < -0.2 && ax < 0.16) { // a longer, narrower tail, square at the end
        const z0 = -0.2 * sz;
        return [x * 0.62, y, z0 + (z - z0) * 1.25];
      }
      return [x, y, z];
    },
    eyes: [{ f: [0.03, 0.22, 0.4], r: 0.012, color: 'eye' }],
    // the hornbill's bill (long, deep at the base, pale yellow), the low casque on it, the yellow throat pouch
    parts: [
      // a third of the body long and deep (playtest r1: it read as an eagle), the pouch hanging under the chin
      { f: [0, 0.13, 0.53], r: [0.03, 0.05, 0.19], color: 'bill', mirror: false },
      { f: [0, 0.215, 0.5], r: [0.016, 0.02, 0.1], color: 'casque', mirror: false },
      { f: [0, 0.03, 0.4], r: [0.032, 0.042, 0.045], color: 'pouch', mirror: false },
    ],
    taubin: { iterations: 1 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: {
      head: (f) => smooth(0.3, 0.38, f.z) * smooth(0.06, 0.03, Math.abs(f.x)),
      wing: (f) => Math.sign(f.x) * smooth(0.04, 0.48, Math.abs(f.x)),
      pivots: ({ size: [sx, sy, sz] }) => ({ head: [0.22 * sy, 0.3 * sz, 0.3, 0.4], wing: [0.04 * sx, 0.3 * sy, 0.6, 0] }),
    },
    motion: { glide: 12, circle: [55, 80], height: [26, 40], flapEvery: [1.5, 3] },
    creaseDeg: 50,
  },
};

// Siberian (Himalayan) ibex (Capra sibirica), K2 above Concordia: the alpine ibex's model with the
// Siberian male's huge horns (kept at full length and swept back in a wide arc to a pointed tip, knobbed
// ridges on the front), a longer black beard, darker brown summer coat with the dark dorsal stripe and
// flanks, pale belly.
SPECIES['siberian-ibex'] = {
  ...ALPS.ibex,
  size: { length: 1.5 },
  colors: { ...ALPS.ibex.colors, coat: '#7a6249', coatD: '#3f3127', belly: '#d2c2a4', horn: '#9a8466', hornD: '#6e5c46', beard: '#231b16', muzzle: '#8a755d', ear: '#6a5641' },
  repaint(k, f) {
    if (k !== 'coat') return k;
    const leg = smooth(0.3, 0.12, f.y), chest = smooth(0.1, 0.25, f.z) * smooth(0.52, 0.42, f.y) * 0.8;
    const dorsal = smooth(0.06, 0.0, Math.abs(f.x)) * smooth(0.48, 0.54, f.y) * smooth(0.2, 0.1, f.z) * 0.9;
    const flank = bump(0.26, 0.32, 0.38, 0.44, f.y) * smooth(0.2, 0.1, f.z) * 0.55;
    return ['coat', 'coatD', Math.min(1, Math.max(leg * 0.9, chest, dorsal, flank))];
  },
  deform([x, y, z], f, fr) {
    const [, sy, sz] = fr.size;
    const horn = smooth(0.56, 0.64, f.y) * smooth(0.0, 0.06, 0.32 - f.z);
    if (horn > 0) { // horns at full length, the curl folded into a long pointed tip swept back and down
      const by = 0.6 * sy, bz = 0.2 * sz, k = 1 + 0.08 * horn;
      y = by + (y - by) * k; z = bz + (z - bz) * k; x *= 1 - 0.1 * horn;
      const tip = horn * smooth(-0.12, -0.26, f.z), ty = by + (0.8 * sy - by) * k, tz = bz + (-0.26 * sz - bz) * k;
      x *= 1 - 0.5 * tip; y += (ty - y) * tip; z += (tz - z) * tip;
      return [x, y, z];
    }
    if (f.z > 0.38 && f.y < 0.47 && f.y > 0.3) { const ay = 0.47 * sy; y = ay - (ay - y) * 1.2; } // the long beard
    return [x, y, z];
  },
};

// Himalayan brown bear (Ursus arctos isabellinus) of the Karakoram: the Carpathian brown bear's model in
// the pale, sandy isabelline coat of the Himalayan form, browner on the legs, with the pale grizzled hump.
SPECIES['himalayan-brown-bear'] = {
  ...CARPATHIANS['brown-bear'],
  size: { length: 1.9 },
  colors: { ...CARPATHIANS['brown-bear'].colors, coat: '#a8835a', coatD: '#6e5038', grizzle: '#d2b48a', muzzle: '#c1a27c', ear: '#7a5a40' },
};

export { noise3, cells };

// Readability: how much bigger than life the game draws them (a drop is 1.4 m tall).
export const SCALE = {
  'snow-leopard': 1.15, 'sumatran-tiger': 1, yak: 1, 'siberian-ibex': 1.1, 'himalayan-brown-bear': 1, pika: 3,
  'malayan-tapir': 1, 'sumatran-striped-rabbit': 1.9, 'salvadoris-pheasant': 1.7, 'wreathed-hornbill': 1.6,
};

// world id -> the species that live on its course: the bake's animals.kinds that really spawn there
// (tools/bake/worlds/<id>.json). The chough and the lammergeier are the Alpine ones of species.js, the same
// species in the Himalaya and the Karakoram.
export const WORLDS = {
  // Thukla (4425-4788 m): yaks on the trail, a snow leopard on the moraine, choughs above every stage
  everest: ['yak', 'snow-leopard', 'chough'],
  // the face and its foot (5038-8566 m), all snow and ice: the lammergeier over the face, choughs to the Shoulder.
  // No walker: the pika lives in talus and rock crevices, of which the course has none; the ibex and the snow
  // leopard (siberian-ibex, snow-leopard) stop at 5000 m, under the last stage. They come in on their own if a
  // stage reaches the Godwin-Austen moraine again
  k2: ['lammergeier', 'chough'],
  // Kerinci from the summit to the Bengkolan Dua fields: the tiger down to the farms, the hornbill over the
  // forest and the fields, tapir, striped rabbit and Salvadori's pheasant only above the park edge (1800 m)
  indonesia: ['sumatran-tiger', 'malayan-tapir', 'sumatran-striped-rabbit', 'salvadoris-pheasant', 'wreathed-hornbill'],
};
