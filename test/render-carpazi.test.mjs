// The look of the Carpathian world (src/render/themes/carpazi.js) against the real Bâlea valley, without a browser:
// the vegetation belts of the Făgăraș (beech and fir only in the mixed forest, spruce up to the treeline, dwarf pine
// above it), no glacier, clear water and grey schist banks, the schist outcrops and boulder fields of the cirque, no
// cirque wall painted over the lower valley, and the closed forest of Valea Bâlii reaching the river.
// Also the two shared pieces the world needed: trees.cover (terrain.js forestAt) and the straight trunk of the
// broadleaf tree (trees.js roundGeometry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from '../src/world/load.js';
import { themeFor, DEFAULT_THEME } from '../src/render/themes/index.js';
import { mergeTheme } from '../src/render/theme.js';
import { createPalette } from '../src/render/palette.js';
import { buildBackdrop, buildStageTerrain, forestAt } from '../src/render/terrain.js';
import { stagePaths, createPathIndex } from '../src/render/path.js';
import { placeTrees, roundGeometry, ROUND_LODS, SHAPES } from '../src/render/trees.js';
import { fieldRocks } from '../src/render/rocks.js';
import { existsSync } from 'node:fs';

const T = themeFor('carpazi');
const hsl = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return { s: mx === mn ? 0 : (mx - mn) / (1 - Math.abs(mx + mn - 1)), l: (mx + mn) / 2, warm: r - b };
};

test('carpazi: the vegetation belts of the Făgăraș, by real altitude', () => {
  const kinds = T.trees.kinds, shrubs = T.trees.shrubs.kinds, name = (n) => kinds.filter((k) => k.name.startsWith(n));
  assert.equal(T.terrain.treeline, 1750, 'spruce treeline of the Bâlea valley');
  // beech and silver fir live in the mixed forest only (about 1000 to 1400-1500 m), never up at the treeline
  for (const k of [...name('beech'), ...name('silver fir')]) assert.ok(k.alt[1] <= 1500, `${k.name} up to ${k.alt[1]} m`);
  assert.equal(SHAPES[1], 'round');
  assert.ok(name('beech').every((k) => k.shape === 'round') && name('spruce').every((k) => k.shape === 'conifer'));
  // spruce is the only tree at the forest line
  const at = (alt) => kinds.filter((k) => alt >= k.alt[0] && alt <= k.alt[1]).map((k) => k.name);
  assert.deepEqual(at(1700), ['spruce']);
  // the lower valley is mixed: beech the most common kind there, with spruce and fir
  const low = kinds.filter((k) => 900 >= k.alt[0] && 900 <= k.alt[1]), beech = low.find((k) => k.name === 'beech');
  assert.ok(beech.share >= Math.max(...low.filter((k) => k !== beech).map((k) => k.share)), 'beech leads at 900 m');
  assert.ok(low.some((k) => k.name.startsWith('spruce')) && low.some((k) => k.name === 'silver fir'));
  // dwarf pine, juniper and Rhododendron myrtifolium: the subalpine belt from the forest line to under the ridge
  assert.deepEqual(shrubs.map((k) => k.name).sort(), ['dwarf pine', 'juniper', 'rhododendron']);
  for (const k of shrubs) assert.ok(k.alt[0] >= 1550 && k.alt[1] <= 2400, `${k.name} ${k.alt}`);
  assert.ok(T.trees.shrubs.line < 2443, 'the summit of Văiuga is bare');
});

test('carpazi: crystalline schist under grass, late snow in patches, no glacier, clear water', () => {
  const t = T.terrain;
  assert.ok(!Number.isFinite(t.iceAbove), 'there is no glacier in the Făgăraș');
  assert.equal(t.moraineBand, null);
  assert.ok(t.snowAbove >= 2400 && t.snowAbove < 2443, 'only patches of late snow under the summit');
  assert.ok(t.alpine >= 2300, 'the cirque is grass up to the ridge, scree only under the walls');
  assert.ok(t.massif.from > 9000, 'schist, not Dolomite terraces');
  // grey schist: rock, scree and the stony banks are near neutral grey, not the warm Dolomite or terracotta earth
  for (const k of ['rock', 'rockB', 'scree', 'screeD', 'bank', 'bankD']) {
    const c = hsl(t[k]);
    assert.ok(c.s < 0.15 && Math.abs(c.warm) < 0.12, `${k} ${t[k]} is grey (s ${c.s.toFixed(2)})`);
  }
  assert.ok(hsl(DEFAULT_THEME.terrain.bank).warm > 0.2, 'the default bank is the warm earth this world replaces');
  // the Bâlea is clear: a darker grey-green than the bright cyan of the glacial worlds, its stony bed showing
  const w = hsl(T.water.base), rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(T.water.base);
  assert.ok(w.s > 0.2 && w.l < hsl(DEFAULT_THEME.water.base).l && g >= b && g > r, `water ${T.water.base}`);
  assert.ok(T.water.stones && T.water.stones.amount > T.water.stones.clear && T.water.stones.clear > 0, 'stones through the shallows');
  assert.equal(DEFAULT_THEME.water.stones, null, 'no stony bed on the other worlds unless their theme asks');
});

test('carpazi: the schist comes out of the steeper cirque slopes, not out of the forest', () => {
  const palette = createPalette(T), out = [0, 0, 0], cover = [0, 0, 0];
  // mean rock cover over a patch of ground (the edges of the outcrops wander with the noise)
  const rock = (alt, slope) => {
    let s = 0, n = 0;
    for (let x = 0; x < 600; x += 31) for (let z = 0; z < 600; z += 37) { palette.ground(out, { alt, slope, x, z }, cover); s += cover[0]; n++; }
    return s / n;
  };
  // the photos: grey outcrop bands on every steeper slope of the cirque, the gentle floor green between boulders
  assert.ok(rock(2100, 44) > 0.6, `cirque at 44 deg: ${rock(2100, 44).toFixed(2)}`);
  assert.ok(rock(1900, 40) > 0.3, `under the lake at 40 deg: ${rock(1900, 40).toFixed(2)}`);
  assert.ok(rock(2100, 20) < 0.05, 'the gentle cirque floor stays grass');
  // in the forest the same slope is soil under spruce and beech; only the gorge walls are bare
  assert.ok(rock(1300, 40) < 0.05, `forest at 40 deg: ${rock(1300, 40).toFixed(2)}`);
  assert.ok(rock(1300, 62) > 0.5, 'the walls of the gorges and of the waterfall step');
  // the band only lends the cirque its outcrops: no colour of its own over the schist
  assert.equal(T.terrain.rockBand.amount, 0);
  // two tones of lichen grey, inked round their edges
  assert.ok(hsl(T.terrain.rock).l - hsl(T.terrain.rockB).l > 0.03 && T.terrain.coverEdge > 0);
  assert.equal(DEFAULT_THEME.terrain.coverEdge, 0);
});

test('carpazi: the lower valley shows no cirque wall ahead', () => {
  const look = (id) => mergeTheme(T, T.stages[id] || {}).backdrop;
  // the cirque and the hanging valley under it: the painting of the Bâlea valley from 2050 m
  for (const id of ['summit', 'cascada']) assert.equal(look(id).file, 'carpazi.jpg', id);
  // from Cabana Bâlea Cascadă down the view is the forested valley opening onto the Făgăraș depression: its own
  // painting, and while it does not exist none (the real 3D ridges), never the alpine walls of carpazi.jpg
  for (const id of ['balea-cascada', 'valea-balii']) {
    const B = look(id);
    assert.notEqual(B.file, 'carpazi.jpg', id);
    assert.equal(B.summit, null, `${id}: the cirque is not behind the start down there`);
    assert.ok(B.eye < 1300, `${id}: painted from the lower valley (${B.eye} m)`);
    if (!existsSync(`assets/backdrops/${B.file}`)) assert.equal(B.fallback.file, null, `${id}: no painting until ${B.file} exists`);
  }
});

test('trees.cover: the default keeps the glades, a higher cover closes the canopy', () => {
  const at = (cover) => {
    const th = mergeTheme(T, { trees: { cover } });
    let s = 0, n = 0;
    for (let x = 0; x < 4000; x += 37) for (let z = 0; z < 4000; z += 41) { s += forestAt(th, 1100, 20, x, z); n++; }
    return s / n;
  };
  const open = at(0.15), closed = at(T.trees.cover);
  assert.ok(T.trees.cover > DEFAULT_THEME.trees.cover);
  assert.ok(closed > open + 0.15 && closed > 0.9, `forest share ${open.toFixed(2)} -> ${closed.toFixed(2)}`);
  // without the key a theme behaves as before (the 0.15 the function always had)
  const bare = mergeTheme(T, {}); delete bare.trees.cover;
  assert.equal(forestAt(bare, 1100, 20, 123, 456), forestAt(mergeTheme(T, { trees: { cover: 0.15 } }), 1100, 20, 123, 456));
});

test('broadleaf tree: a straight trunk into the crown, not a spike under it', () => {
  for (const lod of ROUND_LODS) {
    const g = roundGeometry({ ...lod, seed: 3 }), ts = Math.max(5, lod.segs >> 1), p = g.position;
    // the trunk is the first (ts + 1) pairs of vertices: a bottom ring under the ground and a top ring in the crown
    for (let s = 0; s <= ts; s++) {
      const b = s * 6, rb = Math.hypot(p[b], p[b + 2]), rt = Math.hypot(p[b + 3], p[b + 5]);
      assert.ok(p[b + 1] < 0 && p[b + 4] >= 0.45, 'from under the ground into the crown');
      assert.ok(rb > 0.03 && rt > 0.02 && rt <= rb, `a column, tapering a little (${rb.toFixed(3)} -> ${rt.toFixed(3)})`);
    }
    // the crown starts above the top of the bare stem seen on a slope
    let low = Infinity;
    for (let i = (ts + 1) * 2; i < p.length / 3; i++) low = Math.min(low, p[i * 3 + 1]);
    assert.ok(low > 0.3 && low < 0.5, `crown bottom ${low.toFixed(2)}`);
  }
});

test('carpazi: the forest of Valea Bâlii reaches the river, the cirque has only scrub', async () => {
  const world = await loadWorld('carpazi', { dir: 'data/worlds' }), palette = createPalette(T);
  const backdrop = buildBackdrop(world.json.backdrop, world.backdrop, world.json.stages, T, palette);
  const grow = (k) => {
    const st = world.stages[k], index = createPathIndex(stagePaths(st.json));
    const terrain = buildStageTerrain(st.json, st.height, backdrop.surface, index, T, palette);
    const trees = placeTrees(st.json, terrain, index, T, palette), hit = {};
    let near = 0, tall = 0;
    for (let i = 0; i < trees.count; i++) {
      const x = trees.pos[i * 3], z = trees.pos[i * 3 + 2];
      if (index.nearest(x, z, hit, 80) && hit.d < 60) { near++; if (SHAPES[trees.shape[i]] !== 'shrub') tall++; }
    }
    return { near, tall, count: trees.count };
  };
  // the last stage (917 to 696 m): closed beech and spruce forest down to the banks, within 60 m of the stream (the
  // default clearing and slope limit left about 800 trees there, a strip of lawn on each side)
  const s3 = grow(3);
  assert.ok(s3.tall > 2000, `${s3.tall} trees within 60 m of the Bâlea on Valea Bâlii`);
  // the first stage starts on the bare summit and runs down the cirque: scrub there, the first spruce only near its end
  const s0 = grow(0);
  assert.ok(s0.near > s0.tall * 3, `cirque: ${s0.near} plants near the stream, ${s0.tall} of them trees`);

  // the boulders strewn over the cirque (rocks.field): hundreds on the first stage, in the alpine band, off the water
  // and off the walls; none in the forest of the last stage; none at all on a world whose theme has no field
  const stones = (k, theme = T) => {
    const st = world.stages[k], index = createPathIndex(stagePaths(st.json));
    const terrain = buildStageTerrain(st.json, st.height, backdrop.surface, index, theme, palette);
    return { list: fieldRocks(st.json, terrain.groundAt, index, theme.rocks.field), index, st };
  };
  const { list, index, st } = stones(0), F = T.rocks.field, hit = {};
  assert.ok(list.length > 300 && list.length <= F.max, `${list.length} boulders on stage 1`);
  for (const r of list) {
    const alt = r.y + st.json.offset.y;
    assert.ok(alt >= F.alt[0] && alt <= F.alt[1], `boulder at ${alt.toFixed(0)} m`);
    assert.ok(!index.nearest(r.x, r.z, hit, F.near) || hit.d >= hit.hw * F.clear, 'not in the stream');
    assert.ok(r.r >= F.r[0] && r.r <= F.r[1]);
  }
  assert.ok(list.filter((r) => r.r > 1.5).length < list.length * 0.25, 'mostly stones, a few blocks');
  assert.deepEqual(stones(0).list, list, 'the same boulders every time');
  assert.equal(stones(3).list.length, 0, 'none in the beech woods of Valea Bâlii');
  assert.equal(stones(0, mergeTheme(T, { rocks: { field: null } })).list.length, 0);
  assert.equal(DEFAULT_THEME.rocks.field, null);
});
