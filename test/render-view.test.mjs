// Render unit, what the players see (no WebGL): the chase camera over a real bot race (never under the ground,
// close behind its drop, looking downstream), tree placement and the per-view gather, the drop's size and
// squash. Runs the real sim on the baked Dolomiti stages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadWorld } from '../src/world/load.js';
import { createSim } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';
import { THEME } from '../src/render/theme.js';
import { createPalette } from '../src/render/palette.js';
import { buildBackdrop, buildStageTerrain } from '../src/render/terrain.js';
import { stagePaths, createPathIndex, trackPath } from '../src/render/path.js';
import { placeTrees, gatherTrees, coniferGeometry, TREE_LODS } from '../src/render/trees.js';
import { createChaseCamera } from '../src/render/camera.js';
import { createDrop, dropProfile, dropRadiusAt, UNIT_H } from '../src/render/drop.js';
import { bodyScale } from '../src/render/drop-look.js';

const world = await loadWorld('dolomiti', { dir: 'data/worlds' });
const palette = createPalette(THEME);
const backdrop = buildBackdrop(world.json.backdrop, world.backdrop, world.json.stages, THEME, palette);
const stage = (k) => {
  const st = world.stages[k], paths = stagePaths(st.json), index = createPathIndex(paths);
  return { st, paths, index, terrain: buildStageTerrain(st.json, st.height, backdrop.surface, index, THEME, palette) };
};
const S = [1, 3].map(stage);

test('chase camera: over a whole bot race it stays above the ground, a few metres behind its drop, looking downstream', () => {
  for (const { st, paths, terrain } of S) {
    const sim = createSim(st, { players: 2, seed: 5 });
    const bots = [0, 1].map((s) => createBot(sim, s, { preferShortcut: s === 1 }));
    const rigs = [0, 1].map(() => createChaseCamera(THEME, 960 / 1080));
    const fwd = new THREE.Vector3();
    let frames = 0, ahead = 0, worstClear = Infinity, far = 0;
    for (let f = 0; f < 60 * 75 && sim.state.phase !== 'done'; f++) {
      sim.step(1 / 60, bots.map((b) => b.input()));
      for (let s = 0; s < 2; s++) {
        const p = sim.state.players[s];
        if (p.status !== 'rolling') continue;
        rigs[s].update(p, 1 / 60, paths, terrain.groundAt);
        const c = rigs[s].camera;
        worstClear = Math.min(worstClear, c.position.y - terrain.groundAt(c.position.x, c.position.z));
        const d = Math.hypot(c.position.x - p.pos.x, c.position.z - p.pos.z);
        if (d > THEME.camera.back * 1.6 || d < THEME.camera.back * 0.5) far++;
        c.getWorldDirection(fwd);
        const path = paths[p.branch >= 0 ? p.branch + 1 : 0], i = trackPath(path, p.pos.x, p.pos.z);
        if (fwd.x * path.tx[i] + fwd.z * path.tz[i] > 0.5) ahead++;
        frames++;
      }
    }
    assert.ok(frames > 2000, `${st.json.id}: ${frames} camera frames`);
    assert.ok(worstClear >= THEME.camera.clearance - 0.05, `${st.json.id}: camera ${worstClear.toFixed(2)} m above the ground`);
    assert.ok(far / frames < 0.01, `${st.json.id}: camera away from its drop in ${far} frames`);
    assert.ok(ahead / frames > 0.95, `${st.json.id}: looking downstream in ${(100 * ahead / frames).toFixed(1)} % of the frames`);
  }
});

test('trees: clumps below the treeline, off the stream clearing and the rock; the per-view gather fills the bands nearest first', () => {
  const { st, terrain, index } = S[0];
  const trees = placeTrees(st.json, terrain, index, THEME, palette);
  assert.ok(trees.count > 3000, `${trees.count} trees`);
  const hit = {};
  for (let i = 0; i < trees.count; i++) {
    const x = trees.pos[i * 3], y = trees.pos[i * 3 + 1], z = trees.pos[i * 3 + 2];
    assert.ok(y + st.json.offset.y < THEME.terrain.treeline + 60, 'below the treeline');
    if (index.nearest(x, z, hit, 60)) assert.ok(hit.d > hit.hw + THEME.trees.clearing[0] - 0.5, `tree in the clearing at ${hit.d} m`);
    for (let e = 0; e < 16; e++) assert.ok(Number.isFinite(trees.matrix[i * 16 + e]));
  }
  const bands = THEME.trees.lod.map((r, k) => ({ r, cap: THEME.trees.lodCap[k], matrix: new Float32Array(THEME.trees.lodCap[k] * 16), color: new Float32Array(THEME.trees.lodCap[k] * 3) }));
  const counts = bands.map(() => 0), p = st.json.course[60];
  gatherTrees(trees, p.x, p.z, 0, 1, THEME.trees.cone, bands, counts);
  assert.ok(counts.every((n, k) => n <= bands[k].cap) && counts[1] > 0 && counts[2] > 0, `${counts}`);
  for (let k = 0; k < bands.length; k++) for (let n = 0; n < counts[k]; n++) {
    const dx = bands[k].matrix[n * 16 + 12] - p.x, dz = bands[k].matrix[n * 16 + 14] - p.z, d = Math.hypot(dx, dz);
    assert.ok(d < bands[k].r && (k === 0 || d >= bands[k - 1].r), `band ${k} tree at ${d.toFixed(0)} m`);
    assert.ok(d < 40 || dz / d >= THEME.trees.cone - 1e-6, 'in front of the camera');
  }
  // a band at its cap keeps its nearest trees (cells walked nearest first), not whichever cells came last in a row walk
  const tight = bands.map((b, k) => ({ ...b, cap: k === 2 ? 300 : b.cap }));
  const tc = tight.map(() => 0);
  gatherTrees(trees, p.x, p.z, 0, 1, THEME.trees.cone, tight, tc);
  assert.equal(tc[2], 300);
  let keptMax = 0;
  for (let n = 0; n < tc[2]; n++) keptMax = Math.max(keptMax, Math.hypot(tight[2].matrix[n * 16 + 12] - p.x, tight[2].matrix[n * 16 + 14] - p.z));
  let nearerDropped = 0;
  for (let i = 0; i < trees.count; i++) {
    const dx = trees.pos[i * 3] - p.x, dz = trees.pos[i * 3 + 2] - p.z, d = Math.hypot(dx, dz);
    if (d >= THEME.trees.lod[1] && d < keptMax - 2 * trees.grid.cell * Math.SQRT2 && dz / d >= THEME.trees.cone) nearerDropped++;
  }
  assert.equal(nearerDropped, 0, `kept far trees up to ${keptMax.toFixed(0)} m, but dropped nearer ones`);
  // no garbage per call once warm (it runs per view per frame; Math.hypot here cost 70 kB a call)
  for (let k = 0; k < 400; k++) gatherTrees(trees, p.x + k, p.z, 0, 1, THEME.trees.cone, bands, counts);
  const h0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < 200; k++) gatherTrees(trees, p.x + k, p.z, 0, 1, THEME.trees.cone, bands, counts);
  const perCall = (process.memoryUsage().heapUsed - h0) / 200;
  assert.ok(perCall < 4096, `${perCall.toFixed(0)} bytes allocated per gather`);
  // cheaper geometry for farther bands
  const tris = TREE_LODS.map((L) => coniferGeometry(L).index.length / 3);
  assert.ok(tris[0] > tris[1] && tris[1] > tris[2] && tris[2] < 160, `${tris}`);
});

test('drop: height from the mass (drop-look body curve), stretch with speed, frost then ice, afloat, gone when evaporated', () => {
  const d = createDrop(0, THEME, null);
  const player = (o) => ({ slot: 0, pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 }, radius: 0.55, mass: 1, status: 'rolling', melt: 1, freeze: 0, boost: 0, ...o });
  const water = { inWater: true, waterY: 0.7, groundY: 0.45 };
  const run = (p, n = 120, wt = water) => { for (let i = 0; i < n; i++) d.update(p, 1 / 60, wt); return d.root.children[0].scale.clone(); };
  const small = run(player({}));
  const big = run(player({ mass: 8, radius: 0.55 * 2 }));
  assert.ok(Math.abs(big.y / small.y - bodyScale(8)) < 0.02, `scale ${big.y / small.y}`);
  assert.ok(Math.abs(small.y * UNIT_H - THEME.drop.height * 0.55) < 0.05, 'height = theme.drop.height x radius');
  // the shape of the HUD icon: round bottom, widest at about a third of the height, plump (no needle)
  const prof = dropProfile(), wide = prof.reduce((a, p) => (p.x > a.x ? p : a));
  assert.ok(Math.abs(wide.x - 0.5) < 0.01 && wide.y / UNIT_H > 0.3 && wide.y / UNIT_H < 0.4, `widest ${wide.x} at ${wide.y / UNIT_H}`);
  assert.ok(UNIT_H < 1.4, 'about as tall as the reference drops (1.3 x the width), no tall apex');
  // convex sides: at 65 % of the height still about two thirds of the widest radius (the old spike had 0.23)
  const at = (f) => prof.find((p) => p.y >= f * UNIT_H).x;
  assert.ok(at(0.65) > 0.3 && at(0.85) > 0.1, `radius ${at(0.65).toFixed(2)} at 65 %, ${at(0.85).toFixed(2)} at 85 %: not a spike`);
  // the face lies on the shell, every point of the eye discs just outside it (inside, the shell hid half of each eye)
  const fresh = createDrop(1, THEME, null), faceGroup = fresh.root.children[0].children[0].children[1], v = new THREE.Vector3();
  faceGroup.updateMatrixWorld(true);
  for (const m of faceGroup.children.filter((o) => o.geometry.type === 'CircleGeometry')) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); m.localToWorld(v); assert.ok(Math.hypot(v.x, v.z) > dropRadiusAt(v.y), `eye disc point inside the shell at y ${v.y.toFixed(3)}`); }
  }
  const fast = run(player({ vel: { x: 0, y: 0, z: 30 } }));
  assert.ok(fast.y > small.y * 1.05 && fast.y < small.y * (1.01 + THEME.drop.squashMax) && fast.x < small.x, 'stretched a little along the height, thinner');
  // afloat: deep in the water by the sim, the drawn drop rises until at most theme.drop.float of it is under the surface
  run(player({ pos: { x: 0, y: 0.2, z: 0 } }));
  const h = UNIT_H * d.root.children[0].scale.y, under = (water.waterY - d.root.position.y) / h;
  assert.ok(under <= THEME.drop.float + (THEME.drop.bob + 0.01) / h, `${(under * 100).toFixed(0)} % under the water`);
  run(player({ pos: { x: 0, y: 0.2, z: 0 } }), 120, { inWater: false, waterY: 0, groundY: -0.6 });
  assert.ok(Math.abs(d.root.position.y - (0.2 - 0.55)) < 0.1, 'out of the water it follows the sim');
  run(player({ pos: { x: 0, y: 0.2, z: 0 } }), 120, { inWater: false, waterY: 0, groundY: 0.3 });
  assert.ok(d.root.position.y > 0.3 - 0.15, 'and stands on the drawn ground where that is higher (no sinking into a bank)');
  // freezing frosts the shell, the cube shows only once frozen
  const cube = () => d.root.children[0].children[0].children.find((o) => o.geometry?.type === 'RoundedBoxGeometry');
  run(player({ freeze: 0.8 }));
  assert.ok(!cube().visible || cube().material.opacity < 0.02, 'no cube while only freezing');
  assert.ok(d.material.color.b > d.material.color.r && d.material.color.r > 0.3, 'frosted pale');
  run(player({ status: 'frozen', freeze: 1 }));
  assert.ok(cube().visible && cube().material.opacity > 0.4, 'ice cube shows');
  run(player({ status: 'evaporated' }), 200);
  assert.ok(d.material.opacity < 0.02, 'faded out');
  run(player({}), 200);
  assert.ok(d.material.opacity > 0.98, 'back after the respawn');
});
