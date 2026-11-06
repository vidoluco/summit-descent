// The Dolomiti world's look against the real Peralba and Val Sesis (src/render/themes/dolomiti.js): pale limestone
// with its bedding, tawny alpine turf above the treeline, gravel banks instead of red earth, the trees that really grow
// there by altitude, and the summit painting turned to the Peralba's real bearing from each stage (none on the summit
// itself). Also the two shared keys this world added (terrain.highGrass, terrain.rockStrata) stay off by default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_THEME, themeFor } from '../src/render/themes/index.js';
import { mergeTheme } from '../src/render/theme.js';
import { createPalette } from '../src/render/palette.js';
import { sharedUniforms } from '../src/render/materials.js';

const W = JSON.parse(readFileSync('data/worlds/dolomiti/world.json', 'utf8'));
const CFG = JSON.parse(readFileSync('tools/bake/worlds/dolomiti.json', 'utf8'));
const T = themeFor('dolomiti');
const hue = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// degrees clockwise from north, from (lat, lon) a to b
function bearing([la1, lo1], [la2, lo2]) {
  const r = Math.PI / 180, y = Math.sin((lo2 - lo1) * r) * Math.cos(la2 * r);
  const x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const wrap = (d) => ((d % 360) + 540) % 360 - 180;

test('dolomiti: the shared highGrass and rockStrata keys are off unless a world sets them', () => {
  assert.equal(DEFAULT_THEME.terrain.highGrass, null);
  assert.equal(DEFAULT_THEME.terrain.rockStrata, null);
  assert.equal(sharedUniforms(DEFAULT_THEME).cover.uCoverStrata.value.y, 0, 'no bedding lines by default');
  const s = sharedUniforms(T).cover.uCoverStrata.value;
  assert.deepEqual([s.x, s.y, s.z], [T.terrain.rockStrata.spacing, T.terrain.rockStrata.tone, T.terrain.rockStrata.wobble]);
  // without highGrass the ground is exactly what it was
  const plain = mergeTheme(T, { terrain: { highGrass: null } }), a = [0, 0, 0], b = [0, 0, 0];
  createPalette(plain).ground(a, { alt: 1500, slope: 10, x: 30, z: 40 });
  createPalette(mergeTheme(plain, { terrain: { highGrass: { color: '#ff0000', from: 1900, to: 2250, amount: 1 } } })).ground(b, { alt: 1500, slope: 10, x: 30, z: 40 });
  assert.deepEqual(a, b, 'below its band highGrass changes nothing');
});

test('dolomiti: tawny turf above the treeline, lush pasture below, pale limestone, gravel banks', () => {
  const P = createPalette(T), low = [0, 0, 0], high = [0, 0, 0];
  // the same gentle spot of ground in the Val Sesis pasture (1600 m) and on the Peralba's south flank (2250 m)
  P.ground(low, { alt: 1600, slope: 8, x: 120, z: 80 });
  P.ground(high, { alt: 2250, slope: 8, x: 120, z: 80 });
  const yellowness = (c) => c[0] / c[1];
  assert.ok(yellowness(high) > yellowness(low) + 0.05, `the alpine turf is more tawny: ${yellowness(high).toFixed(2)} vs ${yellowness(low).toFixed(2)}`);
  // limestone: pale and nearly neutral (no warm salmon scree, no red earth on the banks)
  for (const k of ['rock', 'rockB', 'scree', 'bank']) {
    const [r, g, b] = hue(T.terrain[k]);
    assert.ok(Math.min(r, g, b) > 150 && r - b < 40, `${k} ${T.terrain[k]} is pale grey limestone`);
  }
  const cover = [0, 0, 0];
  P.ground([0, 0, 0], { alt: 1050, slope: 70, x: 10, z: 10 }, cover);
  assert.ok(cover[0] > 0.9, `the walls of the Acquatona gorge (about 1050 m) are bare rock: ${cover[0].toFixed(2)}`);
  assert.equal(T.terrain.iceAbove, null, 'the Peralba has no glacier');
});

test('dolomiti: spruce, silver fir and larch below the treeline, mugo pine and alpenrose above, no broadleaf', () => {
  const kinds = T.trees.kinds, names = new Set(kinds.map((k) => k.name));
  assert.deepEqual([...names].sort(), ['larch', 'silver fir', 'spruce']);
  assert.ok(kinds.every((k) => k.shape === 'conifer'), 'no beech at Sappada and above (spruce-fir and larch forest)');
  assert.ok(kinds.every((k) => k.alt[1] <= T.terrain.treeline + 150), 'no tree far above the treeline');
  assert.ok(kinds.find((k) => k.name === 'silver fir').alt[1] <= 1500, 'silver fir only in the lower montane forest');
  assert.ok(T.terrain.treeline < 2164, 'the forest stops below Rifugio Calvi (2164 m)');
  assert.equal(T.terrain.treeline, W.look.treeline, 'the baked look agrees');
  const shrubs = T.trees.shrubs.kinds.map((k) => k.name).sort();
  assert.deepEqual(shrubs, ['hairy alpenrose', 'mugo pine']);
  assert.ok(T.trees.shrubs.line <= 2350);
});

test('dolomiti: the summit painting stands where the Peralba really is from each stage, none on the summit itself', () => {
  const peak = [CFG.summit.lat, CFG.summit.lon];
  for (const s of W.stages) {
    const B = themeFor({ ...W, id: 'dolomiti' }).stages[s.id]?.backdrop || {};
    if (s.id === 'summit') { assert.equal(B.summit, null, 'the race starts on the summit ridge'); continue; }
    const real = bearing([s.origin.lat, s.origin.lon], peak), shown = s.heading + 180 + (B.summitOffset || 0);
    assert.ok(Math.abs(wrap(shown - real)) < 3, `${s.id}: painted at ${wrap(shown).toFixed(0)}, the Peralba at ${real.toFixed(0)} deg`);
  }
});
