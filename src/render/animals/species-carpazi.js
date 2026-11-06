// The Carpathian species of the Făgăraș (Văiuga, Lacul Bâlea, Valea Bâlii), each from a free model of the
// same animal or of the same body plan, reshaped and repainted at load time like the Alpine ones
// (species.js documents the fields). Bands and sources per species are in docs/mountains/carpazi.md;
// credits in assets/CREDITS.md.
import { smooth } from './build.js';
import { SPECIES as ALPS, quadruped, bump } from './species.js';

// Value noise on the final fractions, for coat patterns that follow the body (the lynx's spots).
const hash = (i, j, k) => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), u = x - i, v = y - j, w = z - k;
  const s = (t) => t * t * (3 - 2 * t), a = s(u), b = s(v), c = s(w);
  const L = (p, q, t) => p + (q - p) * t;
  return L(L(L(hash(i, j, k), hash(i + 1, j, k), a), L(hash(i, j + 1, k), hash(i + 1, j + 1, k), a), b),
    L(L(hash(i, j, k + 1), hash(i + 1, j, k + 1), a), L(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), a), b), c);
}
// rotates p about the x axis through the point (c1, c2) of the yz plane
const rotX = ([x, y, z], c1, c2, a) => { const dy = y - c1, dz = z - c2, cs = Math.cos(a), sn = Math.sin(a); return [x, c1 + cs * dy - sn * dz, c2 + sn * dy + cs * dz]; };

export const SPECIES = {
  // Carpathian chamois (Rupicapra rupicapra carpatica), the largest chamois: the Alpine chamois model and
  // marks (cream face, dark stripe through the eye, hooked black horns), a little bigger, the summer coat a
  // shade warmer.
  'carpathian-chamois': {
    ...ALPS.chamois,
    size: { length: 1.3 },
    colors: { ...ALPS.chamois.colors, coat: '#a06a3c', coatD: '#4f3323' },
  },
  // Brown bear (Ursus arctos arctos): the Poly bear (shoulder hump, long snout, plantigrade paws) in the
  // dark brown of the Carpathian bears, paler and greyer on the hump tips and muzzle, small round ears,
  // black nose, pale claws.
  'brown-bear': {
    file: 'poly-google/bear.glb',
    credit: 'Bear by Poly by Google (CC-BY 3.0), poly.pizza/m/a4hZyH8vVph',
    orient: [0, 0, -1, 0, 1, 0, 1, 0, 0],
    size: { length: 2.0 },
    colors: { coat: '#5a3c28', coatD: '#3a271c', grizzle: '#8a6a4c', muzzle: '#9a7a5a', nose: '#1c1512', claw: '#d8cbb3', ear: '#4a3122', eye: '#120d0b' },
    paint(s, f) {
      if (f.y < 0.035 && (f.z > 0.28 || (f.z > -0.25 && f.z < -0.05))) return 'claw';
      if (f.y > 0.9 && f.z > 0.26 && f.z < 0.36 && Math.abs(f.x) > 0.12) return 'ear';
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'claw' || k === 'ear') return k;
      if (f.z > 0.485) return 'nose';
      const muzzle = smooth(0.42, 0.47, f.z) * smooth(0.86, 0.8, f.y);
      if (muzzle > 0.01) return ['coat', 'muzzle', muzzle];
      const legs = smooth(0.42, 0.25, f.y), hump = smooth(0.86, 0.96, f.y) * bump(-0.15, 0.0, 0.25, 0.32, f.z);
      if (hump > 0.01) return ['coat', 'grizzle', hump * 0.75];
      return ['coat', 'coatD', Math.min(1, legs * 0.9)];
    },
    deform([x, y, z], f, fr) {
      const [sx, sy, sz] = fr.size;
      if (f.y > 0.9 && f.z > 0.26 && f.z < 0.36 && Math.abs(f.x) > 0.12) { // small round ears, low on the skull
        const cy = 0.92 * sy, cz = 0.31 * sz, cx = Math.sign(x) * 0.17 * sx;
        return [cx + (x - cx) * 0.85, cy + (y - cy) * 0.75, cz + (z - cz) * 0.85];
      }
      if (f.z > 0.42 && f.y > 0.64 && f.y < 0.77) y = 0.75 * sy + (y - 0.75 * sy) * 0.35; // close the mouth
      const head = smooth(0.3, 0.38, f.z) * smooth(0.55, 0.65, f.y);
      if (head > 0) x *= 1 + 0.12 * head * smooth(0.48, 0.38, f.z); // a broad skull, the snout stays narrow
      return [x, y, z];
    },
    eyes: [{ f: [0, 0.84, 0.42], r: 0.026, surface: 0.45 }],
    taubin: { iterations: 4 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.8, 0.3], head: (f) => smooth(0.28, 0.38, f.z) * smooth(0.5, 0.62, f.y), hip: 0.46, front: 0.22, back: -0.27, tail: [0.62, -0.48], pitch: 0.75, swing: 0.4 }),
    motion: { walk: 1.1, run: 7, stride: 1.1, gait: 'walk', swing: 0.4, graze: 0.5 },
    creaseDeg: 60,
  },
  // Eurasian lynx (Lynx lynx carpathicus): the Poly bobcat (the same body plan) with the lynx's longer
  // legs, black ear tufts, facial ruff and short black-tipped tail, in the greyish tawny summer coat with
  // dark spots, cream throat, ruff and belly.
  lynx: {
    file: 'poly-google/bobcat.glb',
    credit: 'Bobcat by Poly by Google (CC-BY 3.0), poly.pizza/m/bvsVdF1hLme',
    size: { length: 1.15 },
    colors: { coat: '#a6835e', coatL: '#c4a47c', spot: '#4f3a2b', cream: '#ece2cc', tuft: '#191311', tailTip: '#191311', nose: '#7a5048', eye: '#2a2112', ear: '#3a2d24' },
    paint(s, f) {
      if (f.y > 0.9 && f.z > 0.34 && f.z < 0.46 && Math.abs(f.x) > 0.12) return 'ear';
      if (f.z < -0.37 && f.y > 0.55) return 'tailTip';
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'ear') return ['ear', 'tuft', smooth(0.9, 0.95, f.y)];
      if (k === 'tailTip') return ['coat', 'tailTip', smooth(-0.4, -0.45, f.z)];
      if (f.z > 0.48 && f.y > 0.72 && f.y < 0.78 && Math.abs(f.x) < 0.04) return 'nose';
      // cream: the ruff and throat, the muzzle, the belly and the inside of the legs
      const ruff = smooth(0.35, 0.42, f.z) * smooth(0.78, 0.7, f.y) * smooth(0.58, 0.64, f.y);
      const muzzle = smooth(0.44, 0.48, f.z) * smooth(0.8, 0.74, f.y);
      const belly = smooth(0.56, 0.46, f.y) * smooth(0.3, 0.42, f.y) * smooth(0.06, 0.02, Math.abs(f.x) - 0.04);
      const light = Math.max(ruff, muzzle, belly);
      if (light > 0.02) return ['coat', 'cream', light];
      // spots on the flanks and legs, a little bigger toward the rump; plain on the head and back line
      const n = noise3(f.x * 30 + 3, f.y * 30, f.z * 34), m = smooth(0.68, 0.74, n) * smooth(0.36, 0.3, f.z) * smooth(0.04, 0.09, Math.abs(f.x));
      if (m > 0.02) return ['coat', 'spot', m * 0.9];
      return ['coat', 'coatL', smooth(0.6, 0.5, f.y) * 0.5];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      if (f.z < -0.37 && f.y > 0.55) { // a short stub tail, held a little down
        const z0 = -0.37 * sz, y0 = 0.76 * sy;
        return [x * 1.25, y0 + (y - y0) * 0.6 - (z0 - z) * 0.5, z0 + (z - z0) * 0.42];
      }
      if (f.y > 0.9 && f.z > 0.34 && f.z < 0.46 && Math.abs(f.x) > 0.12) { // ear tips drawn up into tufts
        const t = smooth(0.92, 1.0, f.y);
        y += t * 0.09 * sy; x *= 1 - 0.45 * t;
      }
      const ruff = smooth(0.34, 0.4, f.z) * bump(0.6, 0.66, 0.78, 0.84, f.y);
      if (ruff > 0) x *= 1 + 0.14 * ruff; // the cheek ruff
      if (y < 0.46 * sy) y *= 1.1; else y += 0.046 * sy; // longer legs than a bobcat
      return [x, y, z];
    },
    eyes: [{ f: [0, 0.79, 0.45], r: 0.016, surface: 0.4, color: 'eye' }],
    taubin: { iterations: 3 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.66, 0.3], head: (f) => smooth(0.3, 0.38, f.z) * smooth(0.55, 0.65, f.y), hip: 0.45, front: 0.22, back: -0.3, tail: [0.7, -0.37], pitch: 0.8 }),
    motion: { walk: 1.0, run: 9, stride: 0.8, gait: 'walk', swing: 0.5, graze: 0 },
    creaseDeg: 60,
  },
  // Grey wolf (Canis lupus lupus): the Quaternius wolf in the Eurasian wolf's agouti coat, tawny grey with
  // a darker saddle and tail tip, cream cheeks, throat, belly and legs inside.
  wolf: {
    file: 'quaternius/wolf.glb',
    credit: 'Wolf by Quaternius (CC0 1.0), poly.pizza/m/P1gU3Qkr9r',
    pose: { clip: 'Idle', time: 0 },
    size: { length: 1.85 }, // nose to tail tip: a big Carpathian wolf, 75 cm at the shoulder
    colors: { coat: '#8f826d', tawny: '#a68b67', saddle: '#4e4740', cream: '#e6dfcf', nose: '#191514', eye: '#3b2b14', ear: '#6b6153' },
    paint(s, f) {
      if (s.luma < 0.12 && f.z > 0.45) return 'nose';
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'nose') return 'nose';
      const cheek = smooth(0.35, 0.42, f.z) * smooth(0.86, 0.76, f.y) * smooth(0.6, 0.68, f.y);
      const throat = smooth(0.22, 0.3, f.z) * smooth(0.74, 0.6, f.y) * smooth(0.45, 0.52, f.y);
      const belly = smooth(0.52, 0.44, f.y) * smooth(0.33, 0.4, f.y) * smooth(0.3, 0.22, f.z) * smooth(-0.25, -0.15, f.z);
      const light = Math.max(cheek, throat, belly);
      if (light > 0.02) return ['coat', 'cream', light];
      const tailTip = smooth(-0.44, -0.49, f.z);
      if (tailTip > 0.02) return ['coat', 'saddle', tailTip];
      const saddle = smooth(0.7, 0.82, f.y) * bump(-0.32, -0.22, 0.12, 0.25, f.z);
      if (saddle > 0.02) return ['coat', 'saddle', saddle * 0.8];
      return ['coat', 'tawny', smooth(0.4, 0.15, f.y) * 0.4];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size, w = smooth(-0.18, -0.3, f.z) * smooth(0.3, 0.45, f.y);
      // the tail hangs low behind the hocks, as a wolf carries it, not held out like the source's
      return w > 0 ? rotX([x, y, z], 0.68 * sy, -0.2 * sz, -0.55 * w) : [x, y, z];
    },
    eyes: [{ f: [0, 0.885, 0.42], r: 0.016, surface: 0.4, color: 'eye' }],
    taubin: { iterations: 2 },
    subdivide: { levels: 1, scheme: 'phong' },
    rig: quadruped({ neck: [0.76, 0.27], head: (f) => smooth(0.26, 0.36, f.z) * smooth(0.6, 0.72, f.y), hip: 0.47, front: 0.22, back: -0.18, tail: [0.66, -0.22], tailOf: (f) => smooth(-0.24, -0.3, f.z) * smooth(0.1, 0.06, Math.abs(f.x)) * smooth(0.15, 0.22, f.y), pitch: 0.8 }),
    motion: { walk: 1.3, run: 9, stride: 1.0, gait: 'walk', swing: 0.5, graze: 0 },
    creaseDeg: 60,
  },
  // Romanian Carpathian shepherd dog (Ciobănesc Românesc Carpatin), the guardian of the stâna: the
  // Quaternius husky (the same lupoid body) made heavier in the head and chest, the curled tail let down
  // into the breed's low sabre, the ears dropped, in its wolf-grey coat with a black overlay on the back,
  // pale legs and chest, darker muzzle.
  sheepdog: {
    file: 'quaternius/husky.glb',
    credit: 'Husky by Quaternius (CC0 1.0), poly.pizza/m/wcWiuEqwzq',
    pose: { clip: 'Idle', time: 0 },
    size: { length: 1.45 },
    colors: { coat: '#8b8172', overlay: '#3b3632', cream: '#dcd3c0', mask: '#4a4038', nose: '#171312', eye: '#3a2a16', ear: '#5c4e40' },
    paint(s, f) {
      if (s.luma < 0.1 && f.z > 0.45) return 'nose';
      if (f.y > 0.86 && f.z > 0.25 && f.z < 0.38 && Math.abs(f.x) > 0.1) return 'ear';
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'nose' || k === 'ear') return k;
      if (f.z > 0.44 && f.y > 0.76 && f.y < 0.86) return ['coat', 'mask', smooth(0.44, 0.48, f.z) * 0.8];
      const chest = smooth(0.2, 0.3, f.z) * smooth(0.72, 0.58, f.y);
      const legs = smooth(0.34, 0.24, f.y), belly = smooth(0.48, 0.4, f.y) * smooth(-0.3, -0.2, f.z);
      const light = Math.max(chest, legs, belly);
      if (light > 0.02) return ['coat', 'cream', light * 0.85];
      const back = smooth(0.55, 0.66, f.y) * smooth(0.3, 0.18, f.z) + smooth(-0.32, -0.4, f.z) * 0.6;
      return ['coat', 'overlay', Math.min(1, back) * 0.85];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      if (f.z < -0.36 && f.y > 0.55) return rotX([x * 1.3, y, z], 0.66 * sy, -0.36 * sz, -2.6); // the curl let down into a sabre
      if (f.y > 0.86 && f.z > 0.25 && f.z < 0.38 && Math.abs(f.x) > 0.1) { // ears dropped forward and down
        const p = rotX([x, y, z], 0.9 * sy, 0.31 * sz, 0.9);
        return [p[0] * 1.08, p[1], p[2]];
      }
      const head = smooth(0.22, 0.3, f.z) * smooth(0.62, 0.72, f.y);
      if (head > 0) { x *= 1 + 0.18 * head; if (f.z > 0.42) z -= (z - 0.42 * sz) * 0.25 * head; } // broad head, shorter muzzle
      const chest = smooth(0.0, 0.15, f.z) * bump(0.35, 0.45, 0.62, 0.7, f.y);
      if (chest > 0) x *= 1 + 0.15 * chest;
      return [x, y, z];
    },
    eyes: [{ f: [0, 0.86, 0.39], r: 0.016, surface: 0.45, color: 'eye' }],
    taubin: { iterations: 2 },
    subdivide: { levels: 1, scheme: 'phong' },
    rig: quadruped({ neck: [0.7, 0.24], head: (f) => smooth(0.22, 0.32, f.z) * smooth(0.6, 0.7, f.y), hip: 0.42, front: 0.2, back: -0.25, tail: [0.62, -0.36], pitch: 0.8 }),
    motion: { walk: 1.2, run: 8, stride: 0.9, gait: 'walk', swing: 0.5, graze: 0 },
    creaseDeg: 60,
  },
  // Red deer stag (Cervus elaphus), the forest deer of the Carpathians: the Quaternius stag in the summer
  // coat, reddish brown with the darker shaggy neck of a stag, grey-brown legs, the cream rump patch round
  // a short tail, many-tined brown antlers with pale tips.
  'red-deer': {
    file: 'quaternius/stag.glb',
    credit: 'Stag by Quaternius (CC0 1.0), poly.pizza/m/tQdzbZ1Cmw',
    pose: { clip: 'Idle', time: 0 },
    size: { length: 2.1 },
    colors: { coat: '#8b5430', coatD: '#6a3f25', neck: '#4f3424', rump: '#dcc29a', leg: '#6a5444', antler: '#6e5c46', tine: '#ece3cf', hoof: '#221a16', nose: '#231b18', ear: '#7a4e30', eye: '#130e0c' },
    paint(s, f) {
      if (f.y > 0.75 || (f.y > 0.62 && s.luma < 0.3 && Math.abs(f.x) > 0.07)) return 'antler';
      if (f.y < 0.03) return 'hoof';
      if (s.luma < 0.12) return 'nose';
      if (f.y > 0.64 && Math.abs(f.x) > 0.06 && f.z > 0.18 && f.z < 0.34) return 'ear';
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'antler') return ['antler', 'tine', Math.min(1, smooth(0.86, 0.97, f.y) * 0.9 + (Math.abs(f.x) > 0.4 ? 0.4 : 0))];
      if (k !== 'coat') return k;
      const neck = smooth(0.14, 0.24, f.z) * smooth(0.36, 0.46, f.y) * smooth(0.36, 0.3, f.z);
      if (neck > 0.02) return ['coat', 'neck', neck];
      const rump = smooth(-0.42, -0.48, f.z) * bump(0.4, 0.44, 0.58, 0.62, f.y);
      if (rump > 0.02) return ['coat', 'rump', rump];
      const leg = smooth(0.3, 0.18, f.y);
      return leg > 0.02 ? ['coat', 'leg', leg] : ['coat', 'coatD', smooth(0.4, 0.32, f.y) * 0.6];
    },
    eyes: [{ f: [0, 0.705, 0.385], r: 0.022, surface: 0.4 }],
    taubin: { iterations: 2, weight: (x, y, z) => 1 },
    subdivide: { levels: 1, scheme: 'phong' },
    rig: quadruped({ neck: [0.55, 0.24], head: (f) => Math.max(smooth(0.26, 0.34, f.z) * smooth(0.56, 0.64, f.y), smooth(0.66, 0.7, f.y)), hip: 0.33, front: 0.18, back: -0.35, tail: [0.5, -0.48], pitch: 0.85 }),
    motion: { walk: 1.2, run: 9, stride: 1.2, gait: 'walk', swing: 0.45, graze: 0.8 },
    creaseDeg: 55,
  },
  // Sheep of the stâna, the Țurcană breed of the Carpathian shepherds: the round Poly sheep with the
  // breed's long coarse fleece hanging lower, off-white with grey-brown grime below, a white face with a
  // greyish muzzle, white legs, dark hooves.
  sheep: {
    file: 'poly-google/sheep.glb',
    credit: 'Sheep by Poly by Google (CC-BY 3.0), poly.pizza/m/9nvBoaVZuX2',
    size: { length: 1.3 },
    colors: { wool: '#eeebe2', woolD: '#cbc3b1', face: '#f2ede3', spot: '#2a2420', ear: '#e6d5cc', leg: '#ece6da', hoof: '#2e2724', nose: '#3a302c', eye: '#120e0c' },
    paint(s, f) {
      if (f.y < 0.035) return 'hoof';
      if (s.luma < 0.25 && f.z > 0.45) return 'nose';
      if (s.luma < 0.25) return 'face'; // the source's flat eyes: bead eyes instead
      if (s.hue < 20 && s.sat > 0.15 && f.y > 0.7) return 'ear';
      if (f.z > 0.28 && f.y > 0.6 && f.y < 0.92 && s.luma > 0.9 && s.sat < 0.05) return 'face';
      if (f.y < 0.36 && s.sat < 0.05) return 'leg';
      return 'wool';
    },
    repaint(k, f) {
      if (k === 'face') {
        return ['face', 'spot', smooth(0.46, 0.49, f.z) * 0.6];
      }
      if (k === 'ear') return ['ear', 'spot', smooth(0.17, 0.2, Math.abs(f.x)) * 0.8];
      if (k !== 'wool') return k;
      return ['wool', 'woolD', Math.min(1, smooth(0.55, 0.36, f.y) * 0.8 + smooth(-0.4, -0.5, f.z) * 0.2)];
    },
    deform([x, y, z], f, fr) {
      const [, sy] = fr.size;
      // the long Țurcană staple: the underline of the fleece hangs to the knee, in locks
      const under = bump(0.3, 0.36, 0.46, 0.56, f.y) * smooth(0.34, 0.28, f.z) * smooth(0.18, 0.26, Math.abs(f.x) + 0.12);
      if (under > 0) y -= under * 0.08 * sy * (0.7 + 0.3 * Math.sin(z * 40 + x * 30));
      return [x * (f.y > 0.36 && f.z < 0.3 ? 1.04 : 1), y, z];
    },
    eyes: [{ f: [0, 0.83, 0.375], r: 0.016, surface: 0.4 }],
    taubin: { iterations: 3 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.66, 0.28], head: (f) => smooth(0.28, 0.36, f.z) * smooth(0.6, 0.68, f.y), hip: 0.38, front: 0.18, back: -0.3, pitch: 0.9 }),
    motion: { walk: 0.8, run: 4, stride: 0.7, gait: 'walk', swing: 0.4, graze: 1, flee: 'amble' },
    creaseDeg: 60,
  },
};

// Readability: how much bigger than life the game draws them (a drop is 1.4 m tall).
export const SCALE = { 'carpathian-chamois': 1.2, 'brown-bear': 1, lynx: 1.25, wolf: 1.15, sheepdog: 1.15, 'red-deer': 1, sheep: 1.1 };

// The Făgăraș course (tools/bake/worlds/carpazi.json animals.kinds): the golden eagle comes from species.js.
export const WORLDS = {
  carpazi: ['carpathian-chamois', 'brown-bear', 'lynx', 'wolf', 'red-deer', 'sheep', 'sheepdog', 'eagle'],
};
