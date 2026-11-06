// Render unit, the Swiss world (themes/svizzera.js against docs/mountains/svizzera.md): what grows where on the
// Matterhorn line and in what shape (open larch, round stone pine, spruce low down), the grey rock and rubble of the
// high ground, the milky water, the sunny side of the Valais slopes, the paintings per stage (none on the face and the forefield,
// the summit painting turned to the real bearing of the Matterhorn from the valley stages), and the chase camera on
// the 75 % north face, where a drop in the air off a step must not tip the view into the sky.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorld } from '../src/world/load.js';
import { createSim } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';
import { mergeTheme } from '../src/render/theme.js';
import { themeFor } from '../src/render/themes/index.js';
import { createPalette } from '../src/render/palette.js';
import { buildBackdrop, buildStageTerrain } from '../src/render/terrain.js';
import { placeTrees, shapeGeometry, SHAPES } from '../src/render/trees.js';
import { stagePaths, createPathIndex, trackPath, indexAtS } from '../src/render/path.js';
import { createChaseCamera } from '../src/render/camera.js';
import * as THREE from 'three';

const json = JSON.parse(readFileSync('data/worlds/svizzera/world.json', 'utf8'));
const theme = themeFor(json);
const D2R = Math.PI / 180;

test('svizzera: larch and arolla up to the Zermatt treeline, spruce only below about 2100 m, no tree on the ice', () => {
  const T = theme.trees, kinds = Object.fromEntries(T.kinds.map((k) => [k.name, k]));
  assert.deepEqual(Object.keys(kinds).sort(), ['arolla pine', 'larch', 'spruce']);
  for (const k of T.kinds) assert.ok(k.alt[1] <= theme.terrain.treeline + 100, `${k.name} grows to ${k.alt[1]} m`);
  assert.ok(kinds.spruce.alt[1] <= 2100, 'spruce stays under the larch-arolla belt');
  assert.ok(T.shrubs.line < theme.terrain.iceAbove, 'scrub stops under the glacier');
  assert.equal(theme.terrain.massif.from, 99999, 'gneiss, not dolomite: no carved terraces');
  // late October: the larches have turned gold (more red and green than blue), the arolla pines stay green
  for (const c of kinds.larch.colors) { const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; assert.ok(r > b + 60 && g > b + 40, c); }
});

test('svizzera: larch is the open larch, arolla the rounded stone pine, the spruce cone only low down', () => {
  const kinds = Object.fromEntries(theme.trees.kinds.map((k) => [k.name, k]));
  assert.equal(kinds.larch.shape, 'open-larch');
  assert.equal(kinds['arolla pine'].shape, 'stone-pine');
  assert.ok(kinds.spruce.shape === 'conifer' && kinds.spruce.alt[1] <= 1850, 'spruce below about 1850 m');
  // the silhouette: the crown radius in 2 % slices of the unit tree's height (nearest detail level), from its edges
  const profile = (name) => {
    const g = shapeGeometry(SHAPES.indexOf(name), 0), P = g.position, I = g.index, r = new Float32Array(50);
    const edge = (a, b) => {
      const ya = P[a * 3 + 1], yb = P[b * 3 + 1], ra = Math.hypot(P[a * 3], P[a * 3 + 2]), rb = Math.hypot(P[b * 3], P[b * 3 + 2]);
      for (let k = Math.max(0, Math.ceil(Math.min(ya, yb) * 50 - 0.5)); k < 50 && (k + 0.5) / 50 <= Math.max(ya, yb); k++) {
        const t = yb === ya ? 0 : ((k + 0.5) / 50 - ya) / (yb - ya);
        r[k] = Math.max(r[k], ra + (rb - ra) * t);
      }
    };
    for (let i = 0; i < I.length; i += 3) { edge(I[i], I[i + 1]); edge(I[i + 1], I[i + 2]); edge(I[i + 2], I[i]); }
    return r;
  };
  const top = (r) => Math.max(...r.slice(40, 45)) / Math.max(...r);
  // the stone pine's crown is rounded up to its top, the spruce's tapers to a spike
  assert.ok(top(profile('stone-pine')) > 0.45, `stone pine at 80-90 % of its height: ${top(profile('stone-pine')).toFixed(2)} of its width`);
  assert.ok(top(profile('conifer')) < 0.4, `spruce at 80-90 %: ${top(profile('conifer')).toFixed(2)}`);
  // the open larch has gaps between its tiers (the next tier starts at twice the width of the thin spot under it,
  // where the trunk shows); the spruce's tiers overlap
  const gaps = (r) => r.slice(10, 40).filter((x, k) => x < 0.55 * r[11 + k]).length;
  assert.ok(gaps(profile('open-larch')) >= 2, `${gaps(profile('open-larch'))} gaps between the larch's tiers`);
  assert.equal(gaps(profile('conifer')), 0);
});

test('svizzera: round Stafel only scattered trees on the open forefield', async () => {
  const world = await loadWorld('svizzera', { dir: 'data/worlds', stages: [2] });
  const st = world.stages[2], look = mergeTheme(theme, theme.stages[st.json.id]), palette = createPalette(look);
  assert.equal(st.json.id, 'stafel');
  const backdrop = buildBackdrop(world.json.backdrop, world.backdrop, world.json.stages, look, palette);
  const index = createPathIndex(stagePaths(st.json));
  const terrain = buildStageTerrain(st.json, st.height, backdrop.surface, index, look, palette);
  const tr = placeTrees(st.json, terrain, index, look, palette), m = st.json.height, o = st.json.offset;
  let area = 0, n = 0;
  for (const h of terrain.heights) if (h + o.y >= 2000 && h + o.y < 2200) area += m.step * m.step;
  const x1 = m.x0 + (m.w - 1) * m.step, z1 = m.z0 + (m.h - 1) * m.step;
  for (let i = 0; i < tr.count; i++) {
    const x = tr.pos[i * 3], z = tr.pos[i * 3 + 2], alt = tr.pos[i * 3 + 1] + o.y;
    if (x >= m.x0 && x <= x1 && z >= m.z0 && z <= z1 && alt >= 2000 && alt < 2200 && SHAPES[tr.shape[i]] !== 'shrub') n++;
  }
  const perHa = (n / area) * 1e4;
  assert.ok(area > 2e5 && perHa > 3 && perHa < 22, `${perHa.toFixed(1)} trees per ha between 2000 and 2200 m`);
});

test('svizzera: above about 2800 m only grey rock, rubble, ice and snow; straw pasture lower down', () => {
  const pal = createPalette(theme), c = [0, 0, 0], s = Math.sin(24 * D2R);
  // linear RGB: a grey or violet-grey keeps its blue, the straw and ochre of the grass do not
  for (const alt of [2850, 3000, 3300, 3700, 4200]) for (const slope of [6, 18, 30, 45]) for (const nz of [s, -s]) {
    pal.ground(c, { alt, slope, x: 811, z: -2040, nx: 0, nz });
    assert.ok(c[2] > 0.75 * c[0], `${alt} m, ${slope} deg, facing ${nz > 0 ? 'south' : 'north'}: rgb ${c.map((v) => v.toFixed(2))}`);
  }
  pal.ground(c, { alt: 2150, slope: 15, x: 811, z: -2040, nx: 0, nz: s });
  assert.ok(c[0] > 1.8 * c[2], `pasture at Stafel: rgb ${c.map((v) => v.toFixed(2))}`);
});

test('svizzera: the glacial water is milky grey, its facets a soft hint', () => {
  const hsl = {};
  new THREE.Color(theme.water.base).getHSL(hsl, THREE.SRGBColorSpace);
  assert.ok(hsl.s < 0.2 && hsl.l > 0.6, `water.base ${theme.water.base}: saturation ${hsl.s.toFixed(2)}, lightness ${hsl.l.toFixed(2)}`);
  assert.ok(theme.water.facetTone <= 0.05);
});

test('svizzera: the sunny side keeps its pasture higher, the shaded side turns to rubble and snow lower', () => {
  const pal = createPalette(theme), c = [0, 0, 0];
  const at = (alt, nz) => pal.ground(c, { alt, slope: 24, x: 1234, z: 567, nx: 0, nz });
  const s = Math.sin(24 * D2R);
  let south = 0, north = 0;
  for (const alt of [2500, 2600, 2700, 2800]) { south += at(alt, s); north += at(alt, -s); }
  assert.ok(north > south + 0.4, `bare ground ${north.toFixed(2)} facing north, ${south.toFixed(2)} facing south`);
  // without a normal (trees, the sim) the bands read the plain altitude, as on every other world
  assert.equal(pal.ground(c, { alt: 2600, slope: 24, x: 1234, z: 567 }), at(2600, 0));
});

test('svizzera: no painting on the face and the forefield; from the valley the summit painting points at the Matterhorn', () => {
  const ids = json.stages.map((s) => s.id);
  for (const id of Object.keys(theme.stages)) assert.ok(ids.includes(id), `stage ${id} exists`);
  for (const id of ['north-face', 'matterhorngletscher']) assert.equal(mergeTheme(theme, theme.stages[id]).backdrop.file, null, id);
  // the peak sits 13 deg left of the summit painting's centre (assets/backdrops/svizzera-summit.jpg, u 0.30 of 64 deg)
  for (const id of ['stafel', 'zmutt-zermatt']) {
    const st = json.stages.find((s) => s.id === id), B = mergeTheme(theme, theme.stages[id]).backdrop;
    const p = st.course[Math.floor(st.course.length / 2)], gx = p.x + st.offset.x, gz = p.z + st.offset.z;
    const real = (Math.atan2(-gx, gz) / D2R + 360) % 360; // from the stage to the summit at the frame origin
    const painted = st.heading + 180 + B.summitOffset - 0.2 * 64;
    const off = ((painted - real + 540) % 360) - 180;
    assert.ok(Math.abs(off) < 6, `${id}: painted Matterhorn ${painted.toFixed(0)} deg, real ${real.toFixed(0)} deg`);
    assert.ok(B.cut[1] <= Math.hypot(gx, gz) + 300, `${id}: the 3D Matterhorn has dissolved into its painting`);
  }
});

test('svizzera: on the north face the chase camera keeps the course ahead in view, a drop in the air included', async () => {
  const world = await loadWorld('svizzera', { dir: 'data/worlds', stages: [0] });
  const palette = createPalette(theme);
  const backdrop = buildBackdrop(world.json.backdrop, world.backdrop, world.json.stages, theme, palette);
  const st = world.stages[0], paths = stagePaths(st.json), index = createPathIndex(paths);
  const terrain = buildStageTerrain(st.json, st.height, backdrop.surface, index, theme, palette);
  const half = (theme.camera.fov / 2) * D2R, fwd = new THREE.Vector3();
  // how far under the centre of the view the course lookAhead m on sits, as a fraction of the half height
  const run = (camera) => {
    const sim = createSim(st, { players: 2, seed: 3 }), bots = [0, 1].map((s) => createBot(sim, s, { seed: 3 + s }));
    const rigs = [0, 1].map(() => createChaseCamera({ ...theme, camera }, 960 / 1080));
    let worst = 0, air = 0;
    for (let f = 0; f < 60 * 50 && sim.state.phase !== 'done'; f++) {
      sim.step(1 / 60, bots.map((b) => b.input()));
      for (let s = 0; s < 2; s++) {
        const p = sim.state.players[s];
        if (p.status !== 'rolling' && p.status !== 'airborne') continue;
        rigs[s].update(p, 1 / 60, paths, terrain.groundAt);
        if (p.status !== 'airborne') continue;
        air++;
        const c = rigs[s].camera, path = paths[0], i = trackPath(path, p.pos.x, p.pos.z), j = indexAtS(path, path.s[i] + camera.lookAhead);
        c.getWorldDirection(fwd);
        const pitch = Math.asin(fwd.y), ahead = Math.atan2(path.y[j] - c.position.y, Math.hypot(path.x[j] - c.position.x, path.z[j] - c.position.z));
        worst = Math.max(worst, (pitch - ahead) / half);
      }
    }
    return { worst, air };
  };
  const on = run(theme.camera), off = run({ ...theme.camera, keepAhead: null });
  assert.ok(on.air > 30, `${on.air} frames in the air`);
  assert.ok(off.worst > 1, `without keepAhead the course leaves the view (${off.worst.toFixed(2)} half heights under)`);
  assert.ok(on.worst < 1, `with keepAhead it stays in (${on.worst.toFixed(2)})`);
});
