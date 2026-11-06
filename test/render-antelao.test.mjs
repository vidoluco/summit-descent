// The Antelao world's look against the real Antelao and Val d'Oten (src/render/themes/antelao.js): bare dolomite and
// scree above about 2400 m, pale limestone gravel banks instead of red earth, clear turquoise water, the trees that
// really grow there by altitude (grey willow only on the low gravel bars), dense forest on the steep valley walls, one
// season (late October) in the 3D woods as in the paintings, each stage's own real view ahead (nothing of the Antelao
// ahead once past it), and the Antelao painted behind at its real bearing from each stage (none on the summit stage).
// Also the shared key this world added (terrain.bareAbove) stays off by default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_THEME, themeFor } from '../src/render/themes/index.js';
import { mergeTheme } from '../src/render/theme.js';
import { createPalette } from '../src/render/palette.js';
import { forestAt } from '../src/render/terrain.js';
import { linear } from '../src/render/math.js';

const W = JSON.parse(readFileSync('data/worlds/antelao/world.json', 'utf8'));
const T = themeFor('antelao');
const hue = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const wrap = (d) => ((d % 360) + 540) % 360 - 180;
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const stageLook = (id) => mergeTheme(T, T.stages[id]).backdrop;
// where the Antelao's top stands across each look-back painting (0 left .. 1 right; read off the images)
const PEAK_U = { 'antelao-summit.jpg': 0.49, 'antelao-chiggiato.jpg': 0.232 };

test('antelao: the shared bareAbove key is off unless a world sets it, and changes nothing below its band', () => {
  assert.equal(DEFAULT_THEME.terrain.bareAbove, null);
  const plain = mergeTheme(T, { terrain: { bareAbove: null } }), a = [0, 0, 0], b = [0, 0, 0];
  createPalette(plain).ground(a, { alt: 1500, slope: 8, x: 30, z: 40 });
  createPalette(T).ground(b, { alt: 1500, slope: 8, x: 30, z: 40 });
  assert.deepEqual(a, b, 'below its band bareAbove changes nothing');
  // the ground under the snow and ice covers (drawn as patches over it: the cover array takes them)
  createPalette(plain).ground(a, { alt: 3000, slope: 8, x: 30, z: 40 }, [0, 0, 0]);
  createPalette(T).ground(b, { alt: 3000, slope: 8, x: 30, z: 40 }, [0, 0, 0]);
  assert.ok(a[1] / a[0] > b[1] / b[0] + 0.02, 'without it the gentle high ground keeps some green');
});

test('antelao: bare dolomite and scree above 2400 m, pale limestone gravel on the banks, clear turquoise water', () => {
  const P = createPalette(T), high = [0, 0, 0], scree = linear(T.terrain.scree);
  // gentle ground under the summit ridge (3000 m): scree, none of the Peralba's alpine pasture (Natura 2000
  // IT3230081: rock 8210, screes 8120, glaciers 8340 only up there)
  P.ground(high, { alt: 3000, slope: 8, x: 120, z: 80 }, [0, 0, 0]); // the ground under the snow and ice patches
  assert.ok(dist(high, scree) < 0.12, `the gentle ground at 3000 m is scree: ${high.map((v) => v.toFixed(2))}`);
  // limestone: pale and nearly neutral (no warm salmon scree, no red earth on the banks)
  for (const k of ['rock', 'scree', 'bank', 'bankD']) {
    const [r, g, b] = hue(T.terrain[k]);
    assert.ok(Math.min(r, g, b) > 180 && r - b < 30, `${k} ${T.terrain[k]} is pale grey limestone`);
  }
  assert.ok(T.terrain.bankBand.width > DEFAULT_THEME.terrain.bankBand.width, 'a wider gravel bed than the earth strip of the default');
  // the north face is bare rock from gentler slopes than the default
  const cover = [0, 0, 0];
  P.ground([0, 0, 0], { alt: 2800, slope: 40, x: 10, z: 10 }, cover);
  assert.ok(cover[0] > 0.9, `the north face (2800 m, 40 deg) is bare rock: ${cover[0].toFixed(2)}`);
  // the Oten is a clear Dolomite torrent, not milky glacial water: blue-green and saturated
  const [r, g, b] = hue(T.water.base);
  assert.ok(b > r + 80 && g > r + 60, `clear turquoise water ${T.water.base}`);
  assert.equal(T.terrain.iceAbove, 2420, 'the Ghiacciaio Inferiore ends at about 2410 m (docs/mountains/antelao.md)');
});

test('antelao: spruce, larch and beech below the treeline, mugo pine and alpenrose above, grey willow on the low gravel', () => {
  const kinds = T.trees.kinds, names = new Set(kinds.map((k) => k.name));
  assert.deepEqual([...names].sort(), ['beech', 'larch', 'spruce']);
  assert.ok(kinds.every((k) => k.alt[1] <= T.terrain.treeline + 300), 'no tree far above the treeline');
  assert.ok(kinds.find((k) => k.name === 'beech').alt[1] <= 1450, 'beech only in the low montane belt of Cadore');
  const shrubs = Object.fromEntries(T.trees.shrubs.kinds.map((k) => [k.name, k]));
  assert.deepEqual(Object.keys(shrubs).sort(), ['grey willow', 'hairy alpenrose', 'mugo pine']);
  assert.ok(shrubs['grey willow'].alt[1] <= 1350, 'Salix elaeagnos on the gravel bars of the Val d\'Oten and the Molinà only');
  assert.ok(shrubs['mugo pine'].alt[1] <= T.trees.shrubs.line && T.trees.shrubs.line <= 2400, 'the mugo stops under the bare rock');
  // the steep wooded walls of the Val d'Oten (1200-1500 m, 45 deg) carry forest; the default would leave them open
  const at = (theme) => [0, 1, 2, 3, 4, 5, 6, 7].reduce((s, i) => s + forestAt(theme, 1300, 45, 400 * i, 230 * i), 0) / 8;
  assert.ok(at(T) > 0.6, `forest on the 45 deg walls at 1300 m: ${at(T).toFixed(2)}`);
  assert.ok(at(T) > at(DEFAULT_THEME) + 0.3, 'more than the default forest there');
});

test('antelao: the summit painting stands at the real bearing and distance of the Antelao from each stage', () => {
  // the world frame's origin is the summit (world.json frame), so the start of each stage gives its bearing
  for (const s of W.stages) {
    const over = T.stages[s.id]?.backdrop;
    assert.ok(over, `${s.id}: its own backdrop placement`);
    const x = s.course[0].x + s.offset.x, z = s.course[0].z + s.offset.z, d = Math.hypot(x, z);
    if (d < 200) { assert.equal(over.summit, null, `${s.id}: on the summit nothing is painted behind`); continue; }
    const B = stageLook(s.id), width = B.summitAt?.width ?? B.width;
    assert.ok(B.summit in PEAK_U, `${s.id}: ${B.summit} has its peak measured`);
    const bearing = (Math.atan2(-x, z) * 180 / Math.PI + 360) % 360;
    const painted = s.heading + 180 + over.summitOffset + (PEAK_U[B.summit] - 0.5) * width;
    assert.ok(Math.abs(wrap(painted - bearing)) < 3, `${s.id}: painted at ${painted.toFixed(0)}, the summit is at ${bearing.toFixed(0)} deg`);
    assert.ok(Math.abs(over.summitDistance - d) / d < 0.1, `${s.id}: ${over.summitDistance} m, really ${d.toFixed(0)} m`);
  }
});

test('antelao: every stage paints the real view down its own way, and none shows the Antelao ahead once past it', () => {
  // the views and the photos they repaint (assets/backdrops/CREDITS.md): the summit stage looks north across the
  // Val d'Oten head at the Marmarole, the Pile east down the valley from under Forcella Piccola, the rest south-east
  // over Calalzo and its lake to the Friulian Dolomites. The Chiggiato painting looks UP the valley, at the Antelao:
  // it is only ever behind the start
  const views = { antelao: 'antelao-marmarole.jpg', pile: 'antelao-galassi.jpg', oten: 'antelao.jpg', molina: 'antelao.jpg', calalzo: 'antelao.jpg' };
  assert.deepEqual(W.stages.map((s) => s.id), Object.keys(views));
  for (const s of W.stages) {
    const B = stageLook(s.id);
    assert.equal(B.file, views[s.id], `${s.id}: the view ahead`);
    for (const f of [B.file, B.summit].filter(Boolean)) assert.ok(existsSync(`assets/backdrops/${f}`), `${s.id}: ${f} on disk`);
    assert.notEqual(B.file, 'antelao-chiggiato.jpg', `${s.id}: the uphill view is never ahead`);
    if (s.id !== 'antelao') assert.equal(B.summit, 'antelao-chiggiato.jpg', `${s.id}: behind, the north face seen from the Val d'Oten`);
  }
  // the San Vito face (antelao-summit.jpg) is the world's summit painting for the lobby card and the results only
  assert.equal(T.backdrop.summit, 'antelao-summit.jpg');
});

test('antelao: one season, late October, in the 3D woods and meadows as in the paintings', () => {
  const rgb = (c) => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const kinds = Object.fromEntries(T.trees.kinds.map((k) => [k.name, k]));
  // the larches gold and the beech copper (far more red than blue, red over green); the spruce stays dark green
  for (const c of kinds.larch.colors) { const [r, g, b] = rgb(c); assert.ok(r > g && r > b + 90, `larch ${c} is gold`); }
  for (const c of kinds.beech.colors) { const [r, g, b] = rgb(c); assert.ok(r > g + 30 && r > b + 80, `beech ${c} is copper`); }
  for (const c of kinds.spruce.colors) { const [r, g, b] = rgb(c); assert.ok(g > r && g < 120, `spruce ${c} stays dark green`); }
  // the hay meadows faded toward ochre: no lime lawn (red within 30 of green, never far under it)
  for (const k of ['meadowY', 'meadow', 'meadowF', 'meadowD']) {
    const [r, g] = rgb(T.terrain[k]);
    assert.ok(g - r < 30, `${k} ${T.terrain[k]} is a faded autumn meadow, not a lime lawn`);
  }
});
