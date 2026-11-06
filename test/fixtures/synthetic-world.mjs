// A procedural world in the exact world.json format: a winding valley descending from a summit
// at the origin to the sea, with a carved bed, a shortcut branch with a waterfall jump, ice, sun and
// rain zones, checkpoints, pickups, three animals and rocks.
// generateSyntheticWorld() -> { json, height: Float32Array, backdrop: Float32Array }
// CLI: node test/fixtures/synthetic-world.mjs <outDir>  writes world.json, height.bin, backdrop.bin
import { createRng } from '../../src/sim/rng.js';

const STAGES = [
  { name: 'summit', len: 700, slope: 0.28, hw: 12, depth: 20, amp: 0.3, wl: 500, hills: 50 },
  { name: 'ice', len: 500, slope: 0.06, hw: 16, depth: 14, amp: 0.2, wl: 700, hills: 30 },
  { name: 'gorge', len: 1600, slope: 0.2, hw: 14, depth: 26, amp: 0.45, wl: 600, hills: 60 },
  { name: 'valley', len: 2000, slope: 0.06, hw: 20, depth: 18, amp: 0, wl: 1, hills: 35 },
  { name: 'plain', len: 1300, slope: 0.02, hw: 24, depth: 5, amp: 0.35, wl: 900, hills: 3 },
  { name: 'lagoon', len: 500, slope: 0.008, hw: 30, depth: 3, amp: 0.15, wl: 800, hills: 1 },
  { name: 'sea', len: 220, slope: 0.03, hw: 40, depth: 2, amp: 0, wl: 1, hills: 0 },
];
// The valley holds one big meander (heading = A sin(2 pi s / L)), whose chord is the shortcut.
const MEANDER = { stage: 'valley', start: 200, L: 1200, A: 1.4 };
const DS = 10;
const BRANCH_HW = 8;
const BED_DIP = 1.2;

const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };

function stageAt(s) {
  let acc = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (s < acc + STAGES[i].len || i === STAGES.length - 1) return { i, st: STAGES[i], local: s - acc, start: acc };
    acc += STAGES[i].len;
  }
}
// Stage property blended over 100 m around each boundary.
function prop(s, key) {
  const { i, st, local } = stageAt(s);
  const v = st[key];
  if (local < 50 && i > 0) { const p = STAGES[i - 1][key]; return p + (v - p) * smooth(-50, 50, local); }
  if (st.len - local < 50 && i < STAGES.length - 1) { const n = STAGES[i + 1][key]; return v + (n - v) * smooth(-50, 50, local - st.len); }
  return v;
}

export function generateSyntheticWorld({ seed = 7, step = 4 } = {}) {
  const rng = createRng(seed);
  const total = STAGES.reduce((a, s) => a + s.len, 0);
  const n = Math.round(total / DS) + 1;
  const theta0 = Math.atan2(0.35, 1); // east-south-east (z is south)
  const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];

  // Centerline by integrating the heading; bed elevation by integrating the slope.
  const course = [];
  let x = 0, z = 0, y = 0;
  let meanderFrom = -1, meanderTo = -1;
  for (let k = 0; k < n; k++) {
    const s = k * DS;
    const { st, local } = stageAt(s);
    let phi = 0;
    if (st.amp) phi = st.amp * Math.sin((2 * Math.PI * local) / st.wl + ph[0]) * smooth(0, 80, local) * smooth(0, 80, st.len - local);
    if (st.name === MEANDER.stage) {
      const m = local - MEANDER.start;
      if (m >= 0 && m <= MEANDER.L) phi = MEANDER.A * Math.sin((2 * Math.PI * m) / MEANDER.L);
      if (m === 0) meanderFrom = k;
      if (m === MEANDER.L) meanderTo = k;
    }
    course.push({ x, y, z, hw: prop(s, 'hw'), _s: s, _depth: prop(s, 'depth'), _hills: prop(s, 'hills') });
    const th = theta0 + phi;
    x += Math.cos(th) * DS;
    z += Math.sin(th) * DS;
    y -= prop(s, 'slope') * DS;
  }
  // Shift so the sea starts at 0, and keep the sea floor at -4.
  const seaStart = total - STAGES[STAGES.length - 1].len;
  const ySea = course[Math.round(seaStart / DS)].y;
  for (const p of course) p.y = Math.max(p.y - ySea, -4);
  const finish = course.findIndex((p) => p.y <= 0);

  // Shortcut: straight chord across the meander, with a waterfall in the middle.
  const A = course[meanderFrom], B = course[meanderTo];
  const C = Math.hypot(B.x - A.x, B.z - A.z);
  const cdx = (B.x - A.x) / C, cdz = (B.z - A.z) / C;
  const dy = A.y - B.y;
  const cliffAt = 0.5 * C;
  const branchY = (sb) => {
    if (sb < cliffAt) return A.y - 0.35 * dy * (sb / cliffAt);
    return A.y - 0.7 * dy - 0.3 * dy * ((sb - cliffAt) / (C - cliffAt));
  };
  const branchPts = [];
  for (let sb = DS; sb < C - DS * 0.5; sb += DS) branchPts.push({ x: A.x + cdx * sb, y: branchY(sb), z: A.z + cdz * sb, hw: BRANCH_HW });

  // Grid over the corridor.
  const margin = 260;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of course) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const x0 = Math.floor((minX - margin) / step) * step, z0 = Math.floor((minZ - margin) / step) * step;
  const w = Math.ceil((maxX + margin - x0) / step) + 1, h = Math.ceil((maxZ + margin - z0) / step) + 1;

  // Base terrain: inverse distance (power 4) blend of the bed elevation plus trench depth, on a
  // coarse grid, then upsampled with rolling hills on top.
  const cs = 20;
  const cw = Math.ceil((w * step) / cs) + 2, ch = Math.ceil((h * step) / cs) + 2;
  const cBase = new Float32Array(cw * ch), cHills = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const px = x0 + i * cs, pz = z0 + j * cs;
    let ws = 0, vb = 0, vh = 0;
    for (let k = 0; k < course.length; k += 2) {
      const p = course[k];
      const d2 = (px - p.x) ** 2 + (pz - p.z) ** 2 + 900;
      const wt = 1 / (d2 * d2);
      ws += wt; vb += wt * (p.y + p._depth); vh += wt * p._hills;
    }
    cBase[j * cw + i] = vb / ws; cHills[j * cw + i] = vh / ws;
  }
  const coarse = (arr, px, pz) => {
    const u = Math.min(Math.max((px - x0) / cs, 0), cw - 1.001), v = Math.min(Math.max((pz - z0) / cs, 0), ch - 1.001);
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * cw + i;
    return arr[k] * (1 - fu) * (1 - fv) + arr[k + 1] * fu * (1 - fv) + arr[k + cw] * (1 - fu) * fv + arr[k + cw + 1] * fu * fv;
  };
  const hillNoise = (px, pz) => 0.5 + 0.25 * Math.sin(px * 0.011 + ph[1]) * Math.cos(pz * 0.013 + ph[2]) + 0.25 * Math.sin((px + pz) * 0.0047 + ph[0]);
  const height = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const px = x0 + i * step, pz = z0 + j * step;
    height[j * w + i] = coarse(cBase, px, pz) + coarse(cHills, px, pz) * hillNoise(px, pz);
  }

  const cellRange = (ax, az, bx, bz, r) => ({
    i0: Math.max(0, Math.floor((Math.min(ax, bx) - r - x0) / step)), i1: Math.min(w - 1, Math.ceil((Math.max(ax, bx) + r - x0) / step)),
    j0: Math.max(0, Math.floor((Math.min(az, bz) - r - z0) / step)), j1: Math.min(h - 1, Math.ceil((Math.max(az, bz) + r - z0) / step)),
  });

  // Raise a dam along the chord so the shortcut is a real trench even inside the meander.
  {
    const r = BRANCH_HW + 50;
    const { i0, i1, j0, j1 } = cellRange(A.x, A.z, B.x, B.z, r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + i * step, pz = z0 + j * step;
      const sb = Math.min(Math.max((px - A.x) * cdx + (pz - A.z) * cdz, 0), C);
      if (sb < 40 || sb > C - 40) continue;
      const d = Math.abs((px - A.x) * -cdz + (pz - A.z) * cdx);
      if (d > r) continue;
      const lift = branchY(sb) + 16 - Math.max(0, d - (BRANCH_HW + 30)) * 0.8;
      const fade = smooth(40, 90, sb) * smooth(40, 90, C - sb);
      const k = j * w + i;
      height[k] = Math.max(height[k], height[k] + (lift - height[k]) * fade);
    }
  }

  const trench = (lat, hw, wall) => (lat < hw ? BED_DIP * (lat / hw) ** 2 : BED_DIP + (lat - hw) * wall);

  // Carve the main bed segment by segment (min of the channel surfaces).
  for (let k = 0; k < course.length - 1; k++) {
    const a = course[k], b = course[k + 1];
    const r = Math.max(a.hw, b.hw) + a._depth / 0.9 + 6;
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const { i0, i1, j0, j1 } = cellRange(a.x, a.z, b.x, b.z, r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + i * step, pz = z0 + j * step;
      const tRaw = ((px - a.x) * dx + (pz - a.z) * dz) / L2;
      const t = Math.min(Math.max(tRaw, 0), 1);
      const d = Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
      if (d > r) continue;
      const hw = a.hw + (b.hw - a.hw) * t;
      // Unclamped elevation: past a segment end the bed keeps its slope instead of a flat cap.
      const surf = a.y + (b.y - a.y) * tRaw + trench(d, hw, 0.9);
      const idx = j * w + i;
      if (surf < height[idx]) height[idx] = surf;
    }
  }
  // Carve the shortcut with its exact profile, so the waterfall is a sharp step.
  {
    const r = BRANCH_HW + 30;
    const { i0, i1, j0, j1 } = cellRange(A.x, A.z, B.x, B.z, r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + i * step, pz = z0 + j * step;
      const sbRaw = (px - A.x) * cdx + (pz - A.z) * cdz;
      const sb = Math.min(Math.max(sbRaw, 0), C);
      const d = Math.hypot(px - (A.x + cdx * sb), pz - (A.z + cdz * sb));
      if (d > r) continue;
      const surf = branchY(sb) + trench(d, BRANCH_HW, 1.5);
      const idx = j * w + i;
      if (surf < height[idx]) height[idx] = surf;
    }
  }
  // Sea beyond the coast stays below 0.
  for (let k = 0; k < height.length; k++) if (height[k] < -4) height[k] = -4;

  // Indices by stage.
  const idxAt = (s) => Math.min(course.length - 1, Math.max(0, Math.round(s / DS)));
  const stageStart = (name) => { let acc = 0; for (const st of STAGES) { if (st.name === name) return acc; acc += st.len; } };
  const right = (k) => { const a = course[Math.max(0, k - 1)], b = course[Math.min(course.length - 1, k + 1)]; const l = Math.hypot(b.x - a.x, b.z - a.z); return { x: -(b.z - a.z) / l, z: (b.x - a.x) / l }; };
  const beside = (k, f) => { const p = course[k], r = right(k); return { x: p.x + r.x * p.hw * f, z: p.z + r.z * p.hw * f }; };
  const ground = (q) => { const u = Math.min(Math.max((q.x - x0) / step, 0), w - 1), v = Math.min(Math.max((q.z - z0) / step, 0), h - 1); const i = Math.min(Math.floor(u), w - 2), j = Math.min(Math.floor(v), h - 2); const fu = u - i, fv = v - j, kk = j * w + i; return height[kk] * (1 - fu) * (1 - fv) + height[kk + 1] * fu * (1 - fv) + height[kk + w] * (1 - fu) * fv + height[kk + w + 1] * fu * fv; };
  const at = (q) => ({ x: +q.x.toFixed(2), y: +ground(q).toFixed(2), z: +q.z.toFixed(2) });

  const iceFrom = idxAt(stageStart('ice') + 60), iceTo = idxAt(stageStart('ice') + 440);
  const sunFrom = idxAt(stageStart('plain') + 200), sunTo = idxAt(stageStart('plain') + 900);
  const rainFrom = idxAt(stageStart('gorge') + 1300), rainTo = idxAt(stageStart('valley') + 150);

  const checkpoints = [];
  for (let s = 700; s < course[finish]._s - 300; s += 700) {
    const k = idxAt(s);
    if (k > meanderFrom - 5 && k < meanderTo + 5) continue;
    checkpoints.push(k);
  }

  const water = [];
  let flip = 1;
  for (let s = 250; s < course[finish]._s - 100; s += 260) {
    const k = idxAt(s);
    if (k > meanderFrom && k < meanderTo) continue;
    water.push(at(beside(k, 0.45 * flip)));
    flip = -flip;
  }
  for (let k = meanderFrom + 2; k < meanderTo; k += 25) water.push(at(beside(k, 0.3 * flip)));
  for (const f of [0.22, 0.78]) water.push(at({ x: A.x + cdx * C * f, z: A.z + cdz * C * f }));

  const animals = [
    { kind: 'marmot', ...at(beside(idxAt(460), 0.7)) },
    { kind: 'ibex', ...at(beside(idxAt(stageStart('gorge') + 600), -0.75)) },
    { kind: 'cow', ...at(beside(idxAt(stageStart('valley') + 1700), 0.7)) },
  ];
  const obstacles = [];
  for (const [s, f] of [[300, -0.4], [1500, 0.35], [2100, -0.3], [2600, 0.4], [5000, -0.35], [5500, 0.3]]) obstacles.push({ kind: 'rock', ...at(beside(idxAt(s), f)), r: 2 });

  const start = [-0.25, 0.25].map((f) => at(beside(1, f)));

  // Backdrop: the base terrain on a coarse 60 m grid around the corridor.
  const bstep = 60, bm = 1200;
  const bx0 = Math.floor((minX - bm) / bstep) * bstep, bz0 = Math.floor((minZ - bm) / bstep) * bstep;
  const bw = Math.ceil((maxX + bm - bx0) / bstep) + 1, bh = Math.ceil((maxZ + bm - bz0) / bstep) + 1;
  const backdrop = new Float32Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const px = bx0 + i * bstep, pz = bz0 + j * bstep;
    backdrop[j * bw + i] = coarse(cBase, px, pz) + coarse(cHills, px, pz) * hillNoise(px, pz) + 120 * smooth(200, 1100, Math.hypot(Math.max(minX - px, 0, px - maxX), Math.max(minZ - pz, 0, pz - maxZ)));
  }

  const json = {
    id: 'synthetic',
    name: 'Synthetic valley',
    mode: 'short',
    height: { file: 'height.bin', w, h, x0, z0, step },
    seaLevel: 0,
    course: course.map((p) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), hw: +p.hw.toFixed(2) })),
    branches: [{ from: meanderFrom, to: meanderTo, kind: 'shortcut', points: branchPts.map((p) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), hw: p.hw })) }],
    checkpoints,
    zones: [
      { kind: 'ice', from: iceFrom, to: iceTo },
      { kind: 'rain', from: rainFrom, to: rainTo },
      { kind: 'sun', from: sunFrom, to: sunTo },
    ],
    spawns: { start, water, animals, obstacles },
    finish,
    backdrop: { file: 'backdrop.bin', w: bw, h: bh, x0: bx0, z0: bz0, step: bstep },
  };
  return { json, height, backdrop };
}

const f32le = (arr) => {
  const buf = new ArrayBuffer(arr.length * 4), dv = new DataView(buf);
  for (let i = 0; i < arr.length; i++) dv.setFloat32(i * 4, arr[i], true);
  return new Uint8Array(buf);
};

export async function writeSyntheticWorld(dir, opts) {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { json, height, backdrop } = generateSyntheticWorld(opts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/world.json`, JSON.stringify(json));
  writeFileSync(`${dir}/height.bin`, f32le(height));
  writeFileSync(`${dir}/backdrop.bin`, f32le(backdrop));
  return json;
}

// Run as a CLI only. `node --test` also loads every file under test/ (NODE_TEST_CONTEXT set), and
// there the module must load quietly instead of failing with the usage message.
const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && !process.env.NODE_TEST_CONTEXT) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node test/fixtures/synthetic-world.mjs <outDir>'); process.exit(1); }
  const json = await writeSyntheticWorld(dir);
  console.log(`wrote ${dir}: ${json.height.w}x${json.height.h} grid, ${json.course.length} course points`);
}
