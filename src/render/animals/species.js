// The Dolomiti species (spec "Animali: specie vere"), each from a free model of the same animal or of the
// same body plan, reshaped and repainted at load time into the game's smooth cartoon look. Coordinates in
// the rules are fractions of the oriented bounding box: f.x and f.z from -0.5 to 0.5 (z forward), f.y from
// 0 at the feet to 1 at the top. Sizes are real metres; createAnimals scales them up a little for
// readability (options.scale). Credits are in assets/CREDITS.md.
import { smooth } from './build.js';

// the chamois' pale face and throat, fading into the coat down the neck (both sides of the tag border)
const chamoisFace = (f) => smooth(0.7, 0.8, f.y) * smooth(0.16, 0.3, f.z);
// Rig of a four-legged animal in final fractions: the head (and what it carries) pitches about the neck,
// legs below the hip swing about the front and back hips in diagonal pairs (all together for a hopper),
// the tail wags about its root. A tail that hangs below the hips gives its own region (tailOf(f) -> 0..1),
// which then wags whole and is left out of the legs.
export function quadruped({ neck, head, hip, front, back, tail = null, tailOf = null, pitch = 0.8, yaw = 0.6, hop = false, legs = true, swing = 0.5 }) {
  const tailW = tailOf || (tail ? (f) => smooth(tail[1] + 0.03, tail[1] - 0.04, f.z) * smooth(tail[0] - 0.15, tail[0] - 0.05, f.y) : null);
  return {
    head,
    leg: legs ? (f) => ({ w: smooth(hip, hip - 0.12, f.y) * (tailOf ? 1 - tailOf(f) : 1), phase: hop ? (f.z > (front + back) / 2 ? 0.25 : 0) : (f.x > 0) !== (f.z > (front + back) / 2) ? 0.5 : 0 }) : null,
    tail: tailW,
    pivots: ({ size: [, sy, sz] }) => ({
      head: [neck[0] * sy, neck[1] * sz, pitch, yaw],
      leg: [hip * sy, front * sz, back * sz, swing],
      tail: tail ? [tail[0] * sy, tail[1] * sz, 0.6, 0] : [0, 0, 0, 0],
    }),
  };
}

const bump = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));

// The cow bell of the summer alps on the Quaternius cow: the leather strap round the neck, slanting from
// behind the ears down to the throat, and the brass bell hanging under it (final fractions).
const bellStrap = (f) => f.y > 0.5 && f.y < 0.95 && Math.abs(f.z - (0.3 + (f.y - 0.58) * 0.25)) < 0.02;
const BELL = { f: [0, 0.575, 0.3], r: [0.045, 0.06, 0.042], color: 'bell', mirror: false };

export const SPECIES = {
  // Alpine marmot, standing up like a sentinel: the upright Poly gopher made chubby (pear body, broad
  // round head, short muzzle), the long rat tail turned into a short bushy one with a dark tip, the open
  // mouth closed, cream muzzle and belly, warm grey-brown coat darker on the back and crown.
  marmot: {
    file: 'poly-google/gopher.glb',
    credit: 'Gopher by Poly by Google (CC-BY 3.0), poly.pizza/m/2IatILCJa3X',
    size: { height: 0.55 },
    colors: { fur: '#a47a52', furD: '#7b5b42', cream: '#ecd8b2', tail: '#7b5b42', ear: '#6e5140', tailTip: '#3b2c24', paw: '#6a4f3e', nose: '#3a2a28', eye: '#17110f', tooth: '#f4ecdb' },
    paint(s, f) { // parts, on the source
      if (f.z < -0.2 && f.y < 0.22) return 'tail';
      if (s.luma < 0.3) return f.z > 0.45 ? 'nose' : 'fur'; // the source's flat eyes go, bead eyes come
      if (s.sat < 0.12) return 'tooth';
      if (f.y < 0.035) return 'paw';
      return s.luma > 0.75 ? 'cream' : 'fur';
    },
    repaint(k, f) { // soft regions, on the final shape
      if (k === 'tail') return f.z < -0.42 ? 'tailTip' : 'furD';
      if (k === 'nose' || k === 'paw' || k === 'tooth') return k === 'tooth' ? 'cream' : k;
      if (f.y > 0.8 && f.z > 0.3) return 'cream'; // muzzle
      if (k === 'ear') return 'ear';
      const dark = smooth(0.05, -0.25, f.z) * 0.8 + smooth(0.84, 0.97, f.y) * 0.7;
      const belly = smooth(1.0, 0.85, Math.hypot(f.x / 0.32, (f.y - 0.45) / 0.33)) * smooth(0.08, 0.2, f.z);
      return k === 'cream' ? 'cream' : belly > 0 ? ['fur', 'cream', belly] : ['fur', 'furD', Math.min(1, dark)];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      if (f.z < -0.16 && f.y < 0.25) { // tail: shorter, a little raised, bushy
        const z0 = -0.16 * sz, t = (z0 - z) / sz;
        const lift = 0.035 * sy + t * t * 0.9 * sy; // curls up a little toward the tip
        return [x * 1.7, lift + (y - 0.03 * sy) * 2.6, z0 + (z - z0) * 0.48];
      }
      if (f.z > 0.34 && f.y > 0.82 && f.y < 0.93) y = 0.893 * sy + (y - 0.893 * sy) * 0.12; // close the mouth
      const arm = (f.z > 0.18 ? 1 : 0) * bump(0.36, 0.44, 0.64, 0.7, f.y) * smooth(0.08, 0.16, Math.abs(f.x));
      if (arm > 0) { // short stout forearms held at the chest
        const sx0 = Math.sign(x) * 0.22 * fr.size[0], sy0 = 0.62 * sy, sz0 = 0.22 * sz, k = 1 - 0.35 * arm;
        x = sx0 + (x - sx0) * k; y = sy0 + (y - sy0) * k; z = sz0 + (z - sz0) * k;
      }
      const body = bump(-0.1, 0.35, 0.55, 0.85, f.y), head = smooth(0.72, 0.84, f.y);
      let X = x * (1 + 0.75 * body), Y = y, Z = 0.03 * sz + (z - 0.03 * sz) * (1 + 0.32 * body);
      if (head > 0) { // a bigger, rounder head with a short muzzle
        const hy = 0.9 * sy, hz = 0.3 * sz, k = 1 + 0.28 * head;
        X *= 1 + 0.45 * head; Y = hy + (Y - hy) * k; Z = hz + (Z - hz) * k;
        if (Z > 0.3 * sz) Z -= (Z - 0.3 * sz) * 0.35 * head;
      }
      if (Y > 0.6 * sy) Y = 0.6 * sy + (Y - 0.6 * sy) * 0.9; // shorter neck
      return [X, Y, Z];
    },
    eyes: [{ f: [0.15, 0.94, 0.36], r: 0.014 }],
    parts: [{ f: [0.17, 0.955, 0.25], r: [0.011, 0.014, 0.009], color: 'ear' }],
    taubin: { iterations: 4 },
    subdivide: { levels: 2, scheme: 'phong' },
    // upright: the upper body bends at the hips to drink, the tail flicks; it hops, on all fours when it runs
    rig: {
      head: (f) => smooth(0.22, 0.5, f.y) * (f.z > -0.22 || f.y > 0.25 ? 1 : 0),
      tail: (f) => smooth(-0.2, -0.3, f.z) * smooth(0.3, 0.2, f.y),
      pivots: ({ size: [, sy, sz] }) => ({ head: [0.2 * sy, 0.02 * sz, 0.55, 0.5], tail: [0.05 * sy, -0.2 * sz, 0.5, 0] }),
    },
    motion: { walk: 0.9, run: 4.5, stride: 0.35, gait: 'hop', hop: 0.07, runPitch: 1.05, alertStretch: 0.06, graze: 0, flee: 'burrow' },
  },
  // Alpine ibex (male): the Poly horned goat, horns cut down to a long backward scimitar with knobbly
  // ridges, recoloured from its orange cartoon coat to grey-brown with darker legs, pale belly, short beard.
  ibex: {
    file: 'poly-google/goat-horned.glb',
    credit: 'Goat by Poly by Google (CC-BY 3.0), poly.pizza/m/bSetPnvQB5G',
    size: { length: 1.4 },
    colors: { coat: '#8f7c66', coatD: '#5d4d40', tail: '#4f4136', belly: '#d6c6a8', horn: '#b49c78', hornD: '#8c7759', hoof: '#2f2724', beard: '#4b3d33', muzzle: '#a99379', eye: '#16110f', ear: '#7a6855' },
    paint(s, f) {
      const horn = f.y > 0.63 || (f.y > 0.56 && f.z < 0.3 && f.z > 0.02 && Math.abs(f.x) < 0.22);
      if (horn) return s.luma > 0.5 ? 'horn' : 'hornD';
      if (f.y < 0.035) return 'hoof';
      if (f.z < -0.3 && f.y > 0.42 && f.y < 0.56 && Math.abs(f.x) < 0.1) return 'tail';
      if (s.luma < 0.12) return 'coat'; // flat source eyes go
      if (f.z > 0.38 && f.y < 0.47) return 'beard';
      if (f.y > 0.52 && f.y < 0.64 && Math.abs(f.x) > 0.3) return 'ear';
      if (s.sat < 0.3 && s.luma > 0.5 && f.y > 0.26 && f.z < 0.15) return 'belly';
      return 'coat';
    },
    repaint(k, f) {
      if (k !== 'coat') return k;
      const leg = smooth(0.3, 0.12, f.y), chest = smooth(0.1, 0.25, f.z) * smooth(0.52, 0.42, f.y) * 0.7;
      const flank = smooth(0.34, 0.26, f.y) * 0.5;
      return ['coat', 'coatD', Math.min(1, Math.max(leg * 0.9, chest, flank))];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      const horn = smooth(0.56, 0.64, f.y) * smooth(0.0, 0.06, 0.32 - f.z);
      if (horn > 0) { // horns 70 % as long, about their base on the crown
        const by = 0.6 * sy, bz = 0.2 * sz, k = 1 - 0.3 * horn;
        y = by + (y - by) * k; z = bz + (z - bz) * k; x *= 1 - 0.15 * horn;
        // the curl folds into a pointed tip at the end of the arc: a scimitar, not a ram's curl
        const tip = horn * smooth(-0.1, -0.22, f.z), ty = by + (0.9 * sy - by) * k, tz = bz + (-0.3 * sz - bz) * k;
        x *= 1 - 0.5 * tip; y += (ty - y) * tip; z += (tz - z) * tip;
        return [x, y, z];
      }
      // the short goatee of an Alpine male, not the long pendant of a domestic goat, drawn up to the chin
      if (f.z > 0.34 && f.y < 0.56 && f.y > 0.3) { const ay = 0.56 * sy; y = ay - (ay - y) * 0.4; }
      // a shorter, deeper face: the snout drawn back toward the eyes (the beard goes with it)
      const face = smooth(0.26, 0.34, f.z) * smooth(0.38, 0.44, f.y);
      if (face > 0) z -= (z - 0.26 * sz) * 0.42 * face;
      return [x, y, z];
    },
    eyes: [{ f: [0.27, 0.675, 0.19], r: 0.026 }],
    taubin: { iterations: 3, weight: (x, y, z) => 1 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.5, 0.27], head: (f) => Math.max(smooth(0.22, 0.34, f.z) * smooth(0.38, 0.5, f.y), smooth(0.5, 0.6, f.y) * smooth(-0.34, -0.26, f.z)), hip: 0.28, front: 0.2, back: -0.3, tail: [0.42, -0.42], pitch: 0.85 }),
    motion: { walk: 1.1, run: 6, stride: 0.9, gait: 'walk', swing: 0.45, graze: 0.7 },
    creaseDeg: 60,
  },
  // Chamois: the Poly goat made stocky (short legs, deep barrel, thick neck) with the chamois' marks: cream
  // face crossed by the dark stripe from the horn through the eye to the muzzle, short black horns standing
  // up and hooked back at the tip, warm rufous summer coat with a dark dorsal stripe, dark legs, pale belly
  // and rump.
  chamois: {
    file: 'poly-google/goat.glb',
    credit: 'Goat by Poly by Google (CC-BY 3.0), poly.pizza/m/d7dImmjtF8E',
    size: { length: 1.2 },
    colors: { coat: '#9a673e', coatD: '#553826', belly: '#d0a679', face: '#f1e7d6', head: '#f1e7d6', stripe: '#231b17', horn: '#1d1816', hoof: '#221b18', nose: '#4a3a30', eye: '#120e0c', ear: '#9a673e' },
    paint(s, f) {
      if (f.y > 0.885 && Math.abs(f.x) < 0.22 && f.z > 0.12 && f.z < 0.36) return 'horn';
      if (f.y < 0.03) return 'hoof';
      if (f.y > 0.8 && Math.abs(f.x) > 0.22 && f.z < 0.36 && f.z > 0.15) return 'ear';
      if (f.y > 0.66 && f.z > 0.22) return 'head';
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'head') {
        if (f.z > 0.485 && f.y < 0.84) return 'nose';
        // the stripe: a band from the horn base through the eye to the corner of the mouth, on each side
        const ax = 0.3, ay = 0.93, bx = 0.48, by = 0.76; // z, y
        const t = Math.max(0, Math.min(1, ((f.z - ax) * (bx - ax) + (f.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        const d = Math.hypot(f.z - (ax + t * (bx - ax)), f.y - (ay + t * (by - ay)));
        const side = smooth(0.06, 0.13, Math.abs(f.x));
        const neck = smooth(0.74, 0.68, f.y) * smooth(0.3, 0.24, f.z); // the face fades into the coat on the neck
        const st = smooth(0.05, 0.035, d) * side * (1 - neck), face = chamoisFace(f);
        return st > 0.02 ? ['face', 'stripe', st] : ['coat', 'face', face];
      }
      if (k === 'ear') return ['coat', 'face', smooth(0.86, 0.95, f.y) * 0.3];
      if (k !== 'coat') return k;
      const leg = smooth(0.32, 0.18, f.y), dorsal = smooth(0.08, 0.02, Math.abs(f.x)) * smooth(0.5, 0.56, f.y) * smooth(0.25, 0.15, f.z);
      const belly = smooth(0.42, 0.34, f.y) * smooth(0.3, 0.38, f.y) * smooth(0.25, 0.15, f.z);
      const rump = smooth(-0.42, -0.5, f.z) * smooth(0.4, 0.5, f.y);
      if (belly > 0.01 || rump > 0.01) return ['coat', 'belly', Math.max(belly, rump)];
      if (chamoisFace(f) > 0.01) return ['coat', 'face', chamoisFace(f)];
      return ['coat', 'coatD', Math.min(1, leg * 0.95 + dorsal)];
    },
    deform([x, y, z], f, fr) {
      const [sx, sy, sz] = fr.size;
      if (f.y > 0.885 && Math.abs(f.x) < 0.22 && f.z > 0.12 && f.z < 0.36) { // horns: upright, hooked back at the tip
        const B = [x, 0.9 * sy, 0.28 * sz], L = 0.22;
        const rot = (p, c, a) => { const dy = p[1] - c[1], dz = p[2] - c[2], cs = Math.cos(a), sn = Math.sin(a); return [p[0], c[1] + cs * dy - sn * dz, c[2] + sn * dy + cs * dz]; };
        let q = rot([x, y, z], B, 0.6);
        const h = q[1] - B[1], hook = smooth(0.4 * L, 0.9 * L, h);
        if (hook > 0) q = rot(q, [x, B[1] + 0.4 * L, q[2] - 0.02 * sz], -3.0 * hook);
        // a fifth shorter (real horns are 15-25 cm, under the length of the head), tips a little apart
        const k = 0.8, sp = 1 + 0.6 * smooth(0, L, h);
        return [q[0] * 0.9 * sp, B[1] + (q[1] - B[1]) * k, B[2] + (q[2] - B[2]) * k];
      }
      if (f.y > 0.8 && Math.abs(f.x) > 0.22 && f.z < 0.36 && f.z > 0.15) { // ears pricked up
        const ax = Math.abs(x) - 0.2 * sx;
        return [Math.sign(x) * (0.2 * sx + ax * 0.75), y + ax * 0.9, z];
      }
      // a stocky goat-antelope, not the source's slender goat: legs 15 % shorter under a deeper belly (the
      // height stays, so the face marks keep their place), a thicker barrel and neck
      const yl = 0.4 * sy, yb = 0.5 * sy;
      if (y < yl) y *= 0.85;
      else if (y < yb) y = 0.85 * yl + ((y - yl) / (yb - yl)) * (yb - 0.85 * yl);
      const barrel = bump(0.25, 0.36, 0.56, 0.64, f.y) * smooth(0.36, 0.2, f.z) * smooth(-0.46, -0.3, f.z);
      const neck = bump(0.48, 0.56, 0.7, 0.78, f.y) * bump(0.06, 0.14, 0.26, 0.32, f.z);
      return [x * (1 + 0.16 * barrel + 0.18 * neck), y, z];
    },
    eyes: [{ f: [0.15, 0.865, 0.37], r: 0.019 }],
    taubin: { iterations: 3 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.62, 0.2], head: (f) => Math.max(smooth(0.15, 0.27, f.z) * smooth(0.5, 0.62, f.y), smooth(0.8, 0.86, f.y) * smooth(0.05, 0.12, f.z)), hip: 0.35, front: 0.2, back: -0.33, tail: [0.58, -0.45], pitch: 0.9 }),
    motion: { walk: 1.2, run: 7, stride: 0.9, gait: 'walk', swing: 0.5, graze: 0.7 },
    creaseDeg: 60,
  },
  // Mountain hare in its summer coat: the Poly jackrabbit with shorter ears (black tipped), grey-brown
  // back, white belly and scut.
  hare: {
    file: 'poly-google/jackrabbit.glb',
    credit: 'Jackrabbit by Poly by Google (CC-BY 3.0), poly.pizza/m/biNOm96olTH',
    size: { length: 0.6 },
    colors: { coat: '#8f7d69', coatD: '#6c5b4b', belly: '#eee8de', ear: '#8f7d69', earTip: '#211b18', eye: '#140f0d', nose: '#5a4540' },
    paint(s, f) {
      if (f.y > 0.73 && f.z > 0.0) return 'ear'; // the ears lean forward over the head to z 0.47
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'ear') return ['ear', 'earTip', smooth(0.9, 0.95, f.y)];
      if (f.z > 0.485 && f.y > 0.52 && f.y < 0.6) return 'nose';
      const belly = smooth(0.36, 0.28, f.y) * smooth(0.12, 0.2, f.y) * smooth(-0.3, -0.15, f.z) * smooth(0.25, 0.15, f.z);
      const chin = smooth(0.52, 0.46, f.y) * smooth(0.3, 0.4, f.z) * smooth(0.36, 0.42, f.y);
      const scut = smooth(-0.42, -0.5, f.z) * smooth(0.22, 0.3, f.y);
      const light = Math.max(belly, chin, scut);
      if (light > 0.01) return ['coat', 'belly', light];
      return ['coat', 'coatD', smooth(0.4, 0.62, f.y) * smooth(0.15, -0.1, f.z) * 0.6];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      if (f.y > 0.73 && f.z > 0.0) { // mountain hare ears: well shorter than a jackrabbit's, about the head's length
        const by = 0.72 * sy, bz = 0.3 * sz, k = 0.55;
        return [x * 0.92, by + (y - by) * k, bz + (z - bz) * k];
      }
      return [x, y, z];
    },
    eyes: [{ f: [0.2, 0.64, 0.36], r: 0.014, flat: 0.6 }],
    taubin: { iterations: 3 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.45, 0.22], head: (f) => Math.max(smooth(0.22, 0.32, f.z) * smooth(0.38, 0.5, f.y), smooth(0.62, 0.72, f.y) * smooth(-0.05, 0.05, f.z)), hip: 0.3, front: 0.2, back: -0.2, pitch: 0.6, hop: true }),
    motion: { walk: 1, run: 7, stride: 0.6, gait: 'hop', hop: 0.12, swing: 0.6, graze: 0.5 },
  },
  // Alpine chough: the round Poly raven, glossy black with the chough's slender yellow bill and red legs.
  chough: {
    file: 'poly-google/raven.glb',
    credit: 'Raven by Poly by Google (CC-BY 3.0), poly.pizza/m/5oae0lwh9fF',
    orient: [0, 0, -1, 0, 1, 0, 1, 0, 0],
    size: { length: 0.38 },
    colors: { black: '#23232b', sheen: '#343a4c', beak: '#f2c94a', leg: '#d9453a', eye: '#0e0d10' },
    paint(s, f) {
      if (s.hue > 200 && s.hue < 260 && s.sat > 0.2) return 'black'; // source eyes, bead eyes instead
      if (s.luma > 0.6) return 'beak';
      if (s.luma > 0.4 && f.y < 0.2) return 'leg';
      return 'black';
    },
    repaint(k, f) {
      if (k !== 'black') return k;
      return ['black', 'sheen', smooth(0.5, 0.85, f.y) * smooth(-0.3, 0.1, f.z) * 0.8];
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      if (f.z > 0.4 && f.y > 0.8) { // a slimmer, slightly longer and decurved bill
        const ay = 0.885 * sy, t = (z - 0.4 * sz) / (0.1 * sz);
        return [x * 0.6, ay + (y - ay) * 0.6 - t * t * 0.02 * sy, 0.4 * sz + (z - 0.4 * sz) * 1.2];
      }
      return [x, y, z];
    },
    eyes: [{ f: [0.25, 0.9, 0.355], r: 0.008 }],
    taubin: { iterations: 2 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.72, 0.28], head: (f) => smooth(0.24, 0.34, f.z) * smooth(0.6, 0.72, f.y), hip: 0.2, front: 0.1, back: -0.1, pitch: 0.7, hop: true, legs: false }),
    motion: { walk: 0.8, run: 5, stride: 0.22, gait: 'hop', hop: 0.06, graze: 0.6, flee: 'fly' },
  },
  // Golden eagle soaring: the Poly soaring raptor (fingered primaries, fanned tail), dark brown with the
  // golden crown and nape, paler bars on the upper wing, yellow feet, and the hooked bill dark slate to the
  // tip with only the cere at its base yellow (Aquila chrysaetos).
  eagle: {
    file: 'poly-google/bird-soaring.glb',
    credit: 'Bird by Poly by Google (CC-BY 3.0), poly.pizza/m/8Ph79kHbt9s',
    orient: [0, -1, 0, 0, 0, -1, 1, 0, 0],
    size: { span: 2.1 },
    flying: true,
    colors: { brown: '#4b3427', brownL: '#7d5c3f', gold: '#c99343', dark: '#2a1f19', cere: '#f0c35a', bill: '#3b3d44', eye: '#1a120c' },
    paint() { return 'brown'; },
    repaint(k, f) {
      const ax = Math.abs(f.x);
      // the hooked bill under the brown brow ridge, yellow only at the cere
      if (f.z > 0.42 && f.y < 0.24) return ['cere', 'bill', smooth(0.43, 0.44, f.z)];
      if (f.z > 0.28 && ax < 0.06) return ['brown', 'gold', smooth(0.3, 0.38, f.z) * smooth(0.3, 0.6, f.y)];
      if (ax > 0.06) {
        const tip = smooth(0.3, 0.42, ax), covert = smooth(0.05, 0.2, f.z) * (1 - tip) * smooth(0.08, 0.14, ax);
        return covert > 0.02 ? ['brown', 'brownL', covert * 0.9] : ['brown', 'dark', tip * 0.8];
      }
      return ['brown', 'dark', smooth(-0.2, -0.45, f.z) * 0.5];
    },
    deform([x, y, z], f, fr) {
      const sy = fr.size[1], w = smooth(0.39, 0.44, f.z) * smooth(0.14, 0.22, f.y);
      if (w > 0) y = 0.13 * sy + (y - 0.13 * sy) * (1 - 0.8 * w); // close the gaping bill
      return [x, y, z];
    },
    eyes: [{ f: [0.03, 0.2, 0.4], r: 0.014 }],
    taubin: { iterations: 1 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: {
      head: (f) => smooth(0.3, 0.38, f.z) * smooth(0.06, 0.03, Math.abs(f.x)),
      wing: (f) => Math.sign(f.x) * smooth(0.04, 0.48, Math.abs(f.x)),
      pivots: ({ size: [sx, sy, sz] }) => ({ head: [0.25 * sy, 0.32 * sz, 0.4, 0.6], wing: [0.04 * sx, 0.3 * sy, 0.55, 0] }),
    },
    // it hunts low along the slope, so it passes through the chase camera's view (playtest r1: never seen)
    motion: { glide: 13, circle: [26, 40], height: [14, 24], flapEvery: [3, 7] },
    creaseDeg: 50,
  },
  // Bearded vulture (Gypaetus barbatus), the lammergeier of the Zermatt pair: the soaring Poly bird given
  // the lammergeier's long narrow wings and long wedge-shaped tail, slate-grey above and below, the head and
  // underparts cream to rusty orange (the iron-rich mud it bathes in), the black mask through the eye to the
  // bristly beard under the bill. Seen from below, the orange body between dark wings is what tells it from
  // the golden eagle.
  lammergeier: {
    file: 'poly-google/bird-soaring.glb',
    credit: 'Bird by Poly by Google (CC-BY 3.0), poly.pizza/m/8Ph79kHbt9s',
    orient: [0, -1, 0, 0, 0, -1, 1, 0, 0],
    size: { span: 2.5 },
    flying: true,
    colors: { slate: '#3c3b40', slateL: '#66646a', under: '#2a292d', rust: '#d48a4c', cream: '#eedcbf', mask: '#141215', beak: '#8b8580', eye: '#e8c06a' },
    paint() { return 'slate'; },
    repaint(k, f) {
      const ax = Math.abs(f.x);
      if (f.z > 0.4 && f.y < 0.26) return f.y < 0.1 ? 'mask' : 'beak'; // the bill and the beard under it
      if (ax < 0.075 && f.z > -0.2) {
        // the body: cream head, orange breast and belly fading to slate on the back
        const mask = smooth(0.035, 0.015, Math.abs(f.y - 0.2 - (f.z - 0.36) * 0.5)) * smooth(0.33, 0.37, f.z);
        if (mask > 0.02) return ['cream', 'mask', mask];
        const under = smooth(0.42, 0.3, f.y), head = smooth(0.26, 0.34, f.z);
        return ['slate', head > 0.5 ? 'cream' : 'rust', Math.max(under, head) * smooth(-0.22, -0.1, f.z)];
      }
      if (ax >= 0.075) return f.y < 0.42 ? ['under', 'slate', smooth(0.3, 0.42, f.y)] : ['slate', 'slateL', smooth(0.0, 0.18, f.z) * smooth(0.36, 0.2, ax) * 0.8];
      return 'slate';
    },
    deform([x, y, z], f, fr) {
      const [sx, sy, sz] = fr.size, ax = Math.abs(f.x);
      const w = smooth(0.39, 0.44, f.z) * smooth(0.14, 0.22, f.y);
      if (w > 0) y = 0.13 * sy + (y - 0.13 * sy) * (1 - 0.8 * w); // close the gaping bill
      if (f.z < -0.2 && ax < 0.16) { // the long wedge tail: longer, tapering to a point
        const z0 = -0.2 * sz, t = (z0 - z) / (0.3 * sz);
        return [x * (0.72 - 0.52 * t * t), y, z0 + (z - z0) * 1.75];
      }
      const wing = smooth(0.07, 0.12, ax);
      if (wing > 0) { // longer and narrower wings
        const x0 = 0.08 * sx, zc = 0.06 * sz;
        x = Math.sign(x) * (x0 + (Math.abs(x) - x0) * (1 + 0.12 * wing));
        z = zc + (z - zc) * (1 - 0.2 * wing);
      }
      return [x, y, z];
    },
    eyes: [{ f: [0.03, 0.2, 0.4], r: 0.014, color: 'eye' }],
    taubin: { iterations: 1 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: {
      head: (f) => smooth(0.3, 0.38, f.z) * smooth(0.06, 0.03, Math.abs(f.x)),
      wing: (f) => Math.sign(f.x) * smooth(0.04, 0.48, Math.abs(f.x)),
      pivots: ({ size: [sx, sy, sz] }) => ({ head: [0.25 * sy, 0.32 * sz, 0.4, 0.6], wing: [0.04 * sx, 0.3 * sy, 0.45, 0] }),
    },
    motion: { glide: 14, circle: [30, 46], height: [16, 30], flapEvery: [6, 12] }, // low along the slope, as the eagle
    creaseDeg: 50,
  },
  // Rock ptarmigan (Lagopus muta) in its summer plumage: the round Poly quail (the same plump gamebird body)
  // without its crest plume and with a short tail, grey-brown barred above, white belly and wings, the
  // male's black lores and red comb over the eye, white feathered feet.
  ptarmigan: {
    file: 'poly-google/quail.glb',
    credit: 'Quail by Poly by Google (CC-BY 3.0), poly.pizza/m/3WonMe83zEX',
    keep: (f) => !(f.y > 0.88 && f.z > 0.33) && !(f.y > 0.96 && f.z > 0.22),
    size: { length: 0.36 },
    colors: { back: '#7c6c59', bar: '#3f352c', white: '#f4f2ec', lore: '#141211', comb: '#d8332a', beak: '#1e1a18', eye: '#0f0d0c', tail: '#1e1a18' },
    paint(s, f) {
      if (f.z > 0.335 && f.y > 0.83 && s.luma < 0.4 && s.sat < 0.3) return 'beak';
      if (s.luma < 0.08) return 'lore';
      if (s.hue < 30 && s.sat > 0.5 && f.y < 0.75) return 'white'; // the folded wing: white in summer too
      if (s.sat < 0.25 && s.luma > 0.35 && f.y < 0.6) return 'white';
      if (f.y < 0.2 && f.z > -0.1) return 'white'; // feathered feet
      return 'back';
    },
    repaint(k, f) {
      if (k === 'back') {
        if (f.z < -0.3) return ['back', 'tail', smooth(-0.34, -0.42, f.z)];
        const n = Math.sin(f.y * 90 + Math.sin(f.z * 40) * 2) * 0.5 + 0.5;
        return ['back', 'bar', smooth(0.7, 0.9, n) * 0.6];
      }
      if (k === 'lore') return f.z > 0.29 && f.y > 0.84 && f.y < 0.9 ? 'lore' : 'back'; // a thin black stripe from the bill to the eye
      return k;
    },
    deform([x, y, z], f, fr) {
      const [, sy, sz] = fr.size;
      if (f.z < -0.22) { // a short tail held level
        const z0 = -0.22 * sz, t = (z0 - z) / (0.28 * sz);
        return [x, y + smooth(0, 1, t) * 0.22 * sy, z0 + (z - z0) * 0.42];
      }
      return [x, y, z];
    },
    eyes: [{ f: [0, 0.86, 0.27], r: 0.008, surface: 0.4 }],
    parts: [{ f: [0, 0.905, 0.265], r: [0.004, 0.006, 0.012], color: 'comb', surface: 0.2 }],
    taubin: { iterations: 3 },
    subdivide: { levels: 2, scheme: 'phong' },
    rig: quadruped({ neck: [0.72, 0.2], head: (f) => smooth(0.15, 0.26, f.z) * smooth(0.62, 0.74, f.y), hip: 0.2, front: 0.1, back: -0.1, pitch: 0.7, legs: false }),
    motion: { walk: 0.6, run: 3.5, stride: 0.2, gait: 'hop', hop: 0.03, graze: 0.7, flee: 'fly' },
  },
  // Brown alpine cow (Bruna alpina) at the lower pastures: the Quaternius cow, mouse-grey-brown with the
  // pale muzzle ring around a dark nose, cream horns with dark tips, and the brass bell on its leather
  // strap that every cow on a summer alp wears.
  cow: {
    file: 'quaternius/cow.glb',
    credit: 'Cow by Quaternius (CC0 1.0), poly.pizza/m/26zM1outCr',
    pose: { clip: 'Idle', time: 0 },
    size: { length: 2.2 },
    colors: { coat: '#8a735f', coatD: '#5f4e42', light: '#c9b8a2', ring: '#eae0cd', nose: '#2e2725', horn: '#e8dcc0', hornTip: '#3a302b', hoof: '#2b2420', eye: '#111111', eyeW: '#f2f2f2', strap: '#4a2a1c', bell: '#c9a03c' },
    paint(s, f) {
      if (s.luma > 0.85 && Math.abs(f.x) > 0.12) return 'eyeW';
      if (s.luma < 0.15) return 'eye';
      if (f.y > 0.88 && s.sat < 0.5 && f.z > 0.3 && Math.abs(f.x) > 0.12) return 'horn';
      if (f.y < 0.12 && s.luma < 0.35) return 'hoof';
      if (s.hue < 30 && s.sat > 0.5) return f.z > 0.44 ? 'ring' : 'coat'; // the source muzzle; its cheek patch goes
      if (s.sat < 0.3) return f.y < 0.35 ? 'coatD' : 'light';
      return 'coat';
    },
    repaint(k, f) {
      if (k === 'horn') return ['horn', 'hornTip', smooth(0.25, 0.33, Math.abs(f.x))];
      if (k === 'eyeW') return ['coat', 'light', 0.6]; // the pale hair round the eye, not a white eyeball
      if (k === 'ring') return ['ring', 'nose', smooth(0.47, 0.495, f.z)];
      if ((k === 'coat' || k === 'light') && bellStrap(f)) return 'strap';
      if (k === 'light') return ['coat', 'light', 0.55];
      if (k === 'coat' || k === 'coatD') return ['coat', 'coatD', Math.max(k === 'coatD' ? 0.7 : 0, smooth(0.3, 0.12, f.y) * 0.7)];
      return k;
    },
    parts: [BELL],
    taubin: { iterations: 1 },
    subdivide: { levels: 1, scheme: 'phong' },
    rig: quadruped({ neck: [0.62, 0.3], head: (f) => smooth(0.26, 0.38, f.z) * smooth(0.45, 0.58, f.y), hip: 0.4, front: 0.25, back: -0.32, tail: [0.88, -0.46], pitch: 0.9 }),
    motion: { walk: 0.9, run: 2.5, stride: 1.2, gait: 'walk', swing: 0.35, graze: 1, flee: 'amble' },
  },
};

// Hérens (Eringer) cow, the Valais breed of the Zermatt alps: the alpine cow made shorter in the leg and
// heavier in the body, near black to dark chestnut with no pale muzzle, short horns, the same bell.
SPECIES.herens = {
  ...SPECIES.cow,
  size: { length: 2.0 },
  colors: { ...SPECIES.cow.colors, coat: '#3a2722', coatD: '#211714', light: '#563a2f', ring: '#3f302b', nose: '#1b1513', horn: '#e2d6bc' },
  parts: [{ ...BELL, f: [0, 0.6, 0.3] }], // the throat sits higher on the shorter frame
  deform([x, y, z], f, fr) {
    const sy = fr.size[1];
    y = y < 0.42 * sy ? y * 0.84 : y - 0.067 * sy; // short legs
    if (f.y > 0.4 && f.z < 0.34) x *= 1.1; // a deep, muscular body
    return [x, y, z];
  },
};

// Late October on the Svizzera course (themes/svizzera.js, the gold larches of the paintings): the chamois in its
// winter coat, near black-brown with the face mask, throat and rump patch standing out paler; the rock
// ptarmigan most of the way through its autumn moult, white with a little grey-brown left on the crown and
// back, the black tail and the male's black lores kept all year.
SPECIES['chamois-winter'] = {
  ...SPECIES.chamois,
  colors: { ...SPECIES.chamois.colors, coat: '#3e2d25', coatD: '#1e1613', belly: '#a58a70', ear: '#3e2d25' },
};
SPECIES['ptarmigan-autumn'] = {
  ...SPECIES.ptarmigan,
  colors: { ...SPECIES.ptarmigan.colors, back: '#e9e6df', bar: '#8a7d6e' },
};

export { bump };

// Readability: the game draws the small animals bigger than life so they read at race speed next to a
// drop 1.4 m tall. Real sizes are in the specs above.
export const SCALE = { marmot: 1.9, hare: 1.7, chough: 2.0, ibex: 1.15, chamois: 1.2, cow: 1, herens: 1, eagle: 1.6, lammergeier: 1.5, ptarmigan: 2.0, 'chamois-winter': 1.2, 'ptarmigan-autumn': 2.0 };

// The species of each Alpine world, the spawn kinds of its bake config (tools/bake/worlds/<id>.json
// animals.kinds): only what really lives on that course, at the altitude of its stages. Bands and sources
// are in docs/mountains/<id>.md.
export const WORLDS = {
  // Monte Peralba to the Piave springs and Sappada (Carnic Alps): no documented ibex colony on the
  // Peralba, so no ibex here; the Antelao has one
  dolomiti: ['marmot', 'chamois', 'hare', 'chough', 'eagle', 'cow'],
  // Antelao, Cadore: the Antelao-Marmarole-Sorapis ibex colony; red deer (species-carpazi.js) in the woods of
  // the Val d'Oten and the Molinà; no cows, there is no pasture on the course
  antelao: ['ibex', 'marmot', 'chamois', 'hare', 'chough', 'eagle', 'red-deer'],
  // the Matterhorn north face to Zermatt: the Hérens is the cow of the Valais alps
  svizzera: ['ibex', 'chamois', 'marmot', 'lammergeier', 'ptarmigan', 'chough', 'herens'],
};

// The coat of the season on a world: world id -> { spawn kind: species drawn instead }. The sim and the bake
// keep the plain kind (same body, same motion), only the paint changes.
export const VARIANTS = {
  svizzera: { chamois: 'chamois-winter', ptarmigan: 'ptarmigan-autumn' },
};
