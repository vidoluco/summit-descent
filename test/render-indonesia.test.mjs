// The Kerinci look (src/render/themes/indonesia.js) against the bands measured on the mountain, and the three small
// theme keys it added to the shared renderer: trees.cover by altitude (terrain.js coverAt), ground tints by altitude
// band and farmland plots (palette.js terrain.tints, terrain.fields), and the tree fern shape (trees.js). No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { themeFor, DEFAULT_THEME } from '../src/render/themes/index.js';
import { createPalette } from '../src/render/palette.js';
import { coverAt, forestAt, buildBackdrop, buildStageTerrain } from '../src/render/terrain.js';
import { SHAPES, fernGeometry, FERN_LODS, shapeGeometry, placeTrees, kindWeight } from '../src/render/trees.js';
import { stagePaths, createPathIndex } from '../src/render/path.js';
import { loadWorld } from '../src/world/load.js';

const T = themeFor('indonesia');
const W = JSON.parse(readFileSync('data/worlds/indonesia/world.json', 'utf8'));
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('Kerinci bands: forest 1750-2950 m, scrub to 3250 m, bare ash above; no snow, ice, conifers or tea', () => {
  // Ohsawa et al. 1985: natural forest from 1750 m to the forest limit at 2950 m, scrub to the vegetation limit at 3250 m
  assert.equal(T.terrain.treeline, 2950);
  assert.equal(W.look.treeline, T.terrain.treeline, 'the baked look agrees');
  assert.equal(T.trees.shrubs.line, 3250);
  assert.equal(T.terrain.alpine, 3250);
  for (const k of T.trees.kinds) assert.ok(k.alt[1] <= 2950, `${k.name} stops at the forest limit`);
  for (const k of T.trees.shrubs.kinds) assert.ok(k.alt[0] >= 2800 && k.alt[1] <= 3300, `${k.name} in the scrub zone`);
  assert.ok(!Number.isFinite(T.terrain.iceAbove) && T.terrain.snowAbove > 3805);
  // broadleaf montane forest, tree ferns, cinnamon in the fields: no spruce, fir or pine shapes, no tea rows
  assert.ok(T.trees.kinds.every((k) => k.shape !== 'conifer'), 'no conifers on the Kerinci line');
  assert.ok(T.trees.kinds.some((k) => k.shape === 'fern'), 'tree ferns');
  assert.ok(![...T.trees.kinds, ...T.trees.shrubs.kinds].some((k) => /tea/i.test(k.name)), 'the tea estate lies off the line');
  // only the cinnamon gardens grow below the park edge (1804 m on the line)
  const below = T.trees.kinds.filter((k) => k.alt[0] < 1740).map((k) => k.name);
  assert.deepEqual(below, ['cinnamon garden']);
  // the water is a clear tropical stream, greener than the glacial milk and the Alpine blue
  const [r, g, b] = T.water.base.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  assert.ok(g > r && g >= b, `stream ${T.water.base}`);
  assert.equal(W.look.waterType, 'tropical');
});

test('Kerinci ground by altitude: grey-brown ash on the cone, olive scrub, dark forest, plots only below the park edge', () => {
  const P = createPalette(T), c = [0, 0, 0], at = (alt, slope = 12, x = 137, z = 59, forest = 0) => {
    P.ground(c, { alt, slope, x, z, forest }); return [...c];
  };
  // the cone is bare: no green above the scrub, even on gentle ground
  for (const alt of [3350, 3500, 3700]) {
    const [r, g] = at(alt, 8);
    assert.ok(r >= g * 0.95, `${alt} m: ash, not meadow (${c.map((v) => v.toFixed(3))})`);
  }
  // the scrub zone sits between the meadow and the ash
  const scrub = at(3100, 12), meadow = at(2600, 12);
  assert.ok(scrub[0] / scrub[1] > meadow[0] / meadow[1], 'scrub ground is olive, warmer than the forest meadow');
  // under the closed forest the ground is dark
  assert.ok(lum(at(2200, 12, 137, 59, 1)) < lum(at(2200, 12, 137, 59, 0)) * 0.8, 'forest floor');
  // farmland: plots of crops and tilled earth below 1790 m make the ground vary from plot to plot; none above
  const spread = (alt) => { const L = []; for (let x = 0; x < 400; x += 7) L.push(lum(at(alt, 6, x, 31))); return Math.max(...L) - Math.min(...L); };
  assert.ok(spread(1550) > spread(2200) * 1.5, `plots below the park edge (${spread(1550).toFixed(3)} vs ${spread(2200).toFixed(3)})`);
});

test('theme keys: trees.cover by altitude, ground tints and fields default off (other worlds unchanged)', () => {
  assert.equal(coverAt(undefined, 2000), 0.15);
  assert.equal(coverAt(0.4, 2000), 0.4);
  const curve = [[1000, -0.5], [2000, 0.5]];
  assert.equal(coverAt(curve, 500), -0.5);
  assert.equal(coverAt(curve, 1500), 0);
  assert.equal(coverAt(curve, 2500), 0.5);
  assert.deepEqual(DEFAULT_THEME.terrain.tints, []);
  assert.equal(DEFAULT_THEME.terrain.fields, null);
  // Kerinci: a closed canopy in the park, copses below its edge
  assert.ok(forestAt(T, 2200, 15, 500, 500) > 0.8);
  let open = 0;
  for (let i = 0; i < 200; i++) if (forestAt(T, 1600, 5, i * 53, i * 31) < 0.05) open++;
  assert.ok(open > 120, `${open} / 200 spots open in the fields`);
  // a theme without the new keys draws exactly as before
  const D = themeFor('dolomiti'), P = createPalette(D), c1 = [0, 0, 0], c2 = [0, 0, 0];
  P.ground(c1, { alt: 1500, slope: 10, x: 40, z: 70 });
  createPalette({ ...D, terrain: { ...D.terrain, tints: undefined, fields: undefined } }).ground(c2, { alt: 1500, slope: 10, x: 40, z: 70 });
  assert.deepEqual(c1, c2);
});

test('tree fern: a slender trunk under a rosette of arching fronds, wider than tall, fewer triangles at each level', () => {
  assert.equal(SHAPES[3], 'fern');
  let last = Infinity;
  for (let li = 0; li < FERN_LODS.length; li++) {
    const g = shapeGeometry(3, li), P = g.position;
    let y0 = Infinity, y1 = -Infinity, r = 0;
    for (let i = 0; i < P.length; i += 3) { y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); r = Math.max(r, Math.hypot(P[i], P[i + 2])); }
    assert.ok(y1 > 0.85 && y1 < 1.25, `top ${y1.toFixed(2)}`);
    assert.ok(r > 0.45 && r < 0.75, `fronds reach ${r.toFixed(2)}`);
    assert.ok(g.index.length / 3 < last, 'fewer triangles');
    last = g.index.length / 3;
    for (let i = 0; i < g.index.length; i++) assert.ok(g.index[i] < P.length / 3);
  }
  // the fronds droop: their tips hang below the crown
  const g = fernGeometry({ ...FERN_LODS[0], seed: 3 }), P = g.position;
  let tipY = 0, n = 0;
  for (let i = 0; i < P.length; i += 3) if (Math.hypot(P[i], P[i + 2]) > 0.45) { tipY += P[i + 1]; n++; }
  assert.ok(n > 0 && tipY / n < 0.82, 'drooping tips');
});

test('Kerinci trees on the baked stages: a closed forest in the park, copses and riparian trees in the fields', async () => {
  const world = await loadWorld('indonesia', { dir: 'data/worlds' });
  const P = createPalette(T), backdrop = buildBackdrop(world.json.backdrop, world.backdrop, world.json.stages, T, P);
  const count = (k) => {
    const st = world.stages[k], index = createPathIndex(stagePaths(st.json, T.water.rowStep));
    const terrain = buildStageTerrain(st.json, st.height, backdrop.surface, index, T, P);
    const tr = placeTrees(st.json, terrain, index, T, P), by = {};
    let lowFern = Infinity;
    for (let i = 0; i < tr.count; i++) {
      const alt = tr.pos[i * 3 + 1] + st.json.offset.y, s = SHAPES[tr.shape[i]];
      by[s] = (by[s] || 0) + 1;
      if (s === 'fern') lowFern = Math.min(lowFern, alt);
      assert.ok(alt < T.terrain.treeline + 250 || s === 'shrub', `${s} at ${alt.toFixed(0)} m`);
    }
    return { n: tr.count, by, lowFern };
  };
  const summit = count(0), forest = count(1), fields = count(3);
  assert.ok(forest.n > 5 * fields.n, `forest ${forest.n} trees, fields ${fields.n}`);
  assert.ok(forest.by.fern > 1000 && forest.by.round > 10000, JSON.stringify(forest.by));
  assert.ok(fields.lowFern > 1680, `tree ferns only at the forest edge above the fields (lowest ${fields.lowFern.toFixed(0)} m)`);
  assert.ok(fields.n > 1000, 'cinnamon copses and riparian trees in the fields');
  assert.ok(summit.by.shrub > 0, 'scrub on the lower summit stage');
  assert.ok(kindWeight(T.trees.kinds, 3400) === 0, 'nothing grows on the ash cone');
});
