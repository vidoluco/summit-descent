// The per-world look (src/render/themes/) and the painted backdrop's orientation (src/render/paint.js), without a
// browser: which theme a world gets and in what order the layers merge, that every theme names a painting on disk and
// grows only what the renderer can draw, the downhill heading of every stage, where a view direction lands on the
// painting, the painting sinking to the far edge of the 3D ground, and the sky extension of a wall cut by the top edge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { THEMES, DEFAULT_THEME, themeFor, backdropFiles } from '../src/render/themes/index.js';
import { stageHeading, paintLayout, paintUV, footElevation, extendSky, eyeShift, paintUniforms, createPaint, placement } from '../src/render/paint.js';
import { SHAPES } from '../src/render/trees.js';

const IDS = ['dolomiti', 'antelao', 'svizzera', 'carpazi', 'everest', 'k2', 'indonesia'];
const world = (id) => JSON.parse(readFileSync(`data/worlds/${id}/world.json`, 'utf8'));
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

test('themes: one file per world, selected by id; unknown ids get the default; look and caller overrides on top', () => {
  assert.deepEqual(Object.keys(THEMES).sort(), [...IDS].sort());
  for (const id of IDS) {
    const t = themeFor(id);
    assert.equal(t.backdrop.file, `${id}.jpg`, id);
    // the same from an id, a world.json and a loadWorld() result
    assert.deepEqual(themeFor(world(id)), t, `${id} from world.json`);
    assert.deepEqual(themeFor({ json: world(id) }), t, `${id} from loadWorld()`);
  }
  assert.equal(themeFor('nowhere').backdrop.file, null);
  assert.deepEqual(themeFor('nowhere'), themeFor(null));
  assert.equal(themeFor('nowhere').terrain.treeline, DEFAULT_THEME.terrain.treeline);
  // layers: default < theme file < world.json look < caller; objects merge key by key, arrays replace
  const look = { id: 'everest', look: { fog: { density: 0.0002 }, trees: { kinds: [{ name: 'x', shape: 'shrub', share: 1, alt: [0, 1], colors: ['#000000'] }] } } };
  const t = themeFor(look, { fog: { max: 0.5 } });
  assert.equal(t.fog.density, 0.0002, 'world.json look over the theme file');
  assert.equal(t.fog.color, THEMES.everest.fog.color, 'the theme file keeps the keys the look does not set');
  assert.equal(t.fog.max, 0.5, 'caller over everything');
  assert.equal(t.fog.base, DEFAULT_THEME.fog.base, 'the default fills the rest');
  assert.equal(t.trees.kinds.length, 1, 'arrays replace');
  assert.equal(t.trees.spacing, DEFAULT_THEME.trees.spacing);
  assert.equal(DEFAULT_THEME.fog.density, 0.00013, 'merging never mutates the default');
});

test('themes: every world names its paintings on disk and grows only what the renderer draws, where it really grows', () => {
  for (const id of IDS) {
    const t = themeFor(id), f = backdropFiles(t);
    assert.ok(existsSync(`assets/backdrops/${f.view}`), `${id}: ${f.view}`);
    if (f.summit) assert.ok(existsSync(`assets/backdrops/${f.summit}`), `${id}: ${f.summit}`);
    const B = t.backdrop;
    assert.ok(B.width > 20 && B.width < 120 && B.row > 0 && B.row < 1, `${id}: painting placement`);
    assert.ok(B.baseHaze[0] <= B.baseHaze[1] && B.baseHaze[1] <= 1, `${id}: base haze rows`);
    assert.ok(B.cut[0] < B.cut[1], `${id}: cut`);
    // every key of the default is still there after the merge (the renderer reads them all)
    for (const [k, v] of Object.entries(DEFAULT_THEME)) if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k2 of Object.keys(v)) assert.ok(k2 in t[k], `${id}: ${k}.${k2}`);
    }
    for (const kind of [...t.trees.kinds, ...t.trees.shrubs.kinds]) {
      assert.ok(SHAPES.includes(kind.shape), `${id} ${kind.name}: shape ${kind.shape}`);
      assert.ok(kind.alt[0] < kind.alt[1] && kind.colors.length > 0, `${id} ${kind.name}`);
      assert.ok(kind.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c)), `${id} ${kind.name}: colours`);
    }
    // trees stop at the treeline (a soft edge of 250 m at most)
    for (const kind of t.trees.kinds) assert.ok(kind.alt[0] < t.terrain.treeline + 250, `${id} ${kind.name} below the treeline`);
  }
  // no trees on the Himalaya and the Karakoram courses (the treeline of the Khumbu is near 4000 m, every stage is above)
  for (const id of ['everest', 'k2']) {
    assert.equal(themeFor(id).trees.kinds.length, 0, id);
    const low = Math.min(...world(id).stages.map((s) => s.course.at(-1).y + s.offset.y));
    assert.ok(low > 4000, `${id} lowest course point ${low}`);
  }
  assert.equal(themeFor('k2').trees.shrubs.kinds.length, 0, 'nothing grows on the Baltoro ice');
  // glaciers only where there are some, and no snow on Kerinci (a tropical volcano)
  for (const id of ['svizzera', 'everest', 'k2', 'antelao']) assert.ok(Number.isFinite(themeFor(id).terrain.iceAbove), id);
  for (const id of ['dolomiti', 'carpazi', 'indonesia']) assert.ok(!Number.isFinite(themeFor(id).terrain.iceAbove), id);
  assert.ok(themeFor('indonesia').terrain.snowAbove > 3805, 'no snow below the top of Kerinci');
  // the broadleaf belts: beech in the Carpathians and the Cadore, rainforest on Kerinci; none in the Valais
  const has = (id, shape) => themeFor(id).trees.kinds.some((k) => k.shape === shape);
  assert.ok(has('carpazi', 'round') && has('antelao', 'round') && has('indonesia', 'round'));
  assert.ok(!has('svizzera', 'round') && !has('dolomiti', 'round'));
});

test('backdrop: the painting faces each stage downhill (baked heading, else the chord of the course)', () => {
  assert.equal(stageHeading({ heading: 37, course: [{ x: 0, z: 0 }, { x: 0, z: 10 }] }), 37, 'a baked heading wins');
  assert.ok(near(stageHeading({ course: [{ x: 0, z: 0 }, { x: 0, z: 100 }] }), 180), 'south (+z)');
  assert.ok(near(stageHeading({ course: [{ x: 0, z: 0 }, { x: 100, z: 0 }] }), 90), 'east (+x)');
  assert.ok(near(stageHeading({ course: [{ x: 0, z: 0 }, { x: 0, z: -100 }] }), 0), 'north (-z)');
  assert.ok(near(stageHeading({ course: [{ x: 0, z: 0 }, { x: -100, z: 0 }] }), 270), 'west');
  assert.equal(stageHeading({}), 180);
  // every stage of every world: the course mostly heads that way (its points stay within 90 deg of the heading
  // from the start), so the painting is ahead of the drops
  for (const id of IDS) for (const st of world(id).stages) {
    const h = stageHeading(st) * Math.PI / 180, c = st.course, fx = Math.sin(h), fz = -Math.cos(h);
    const ahead = c.filter((p) => (p.x - c[0].x) * fx + (p.z - c[0].z) * fz >= 0).length;
    assert.ok(ahead / c.length > 0.9, `${id} ${st.id || ''}: ${ahead}/${c.length} course points ahead`);
  }
});

test('backdrop: a view direction lands on the painting by azimuth from the heading and elevation from its foot row', () => {
  const B = { ...DEFAULT_THEME.backdrop, width: 60, row: 0.7, elevation: 2 };
  const L = paintLayout(B, 3168, 1344);
  assert.ok(near(L.width, (60 * Math.PI) / 180) && near(L.hy, L.width / (3168 / 1344)), 'undistorted: the height follows from the aspect');
  const dir = (azDeg, elDeg) => { const a = (azDeg * Math.PI) / 180, e = (elDeg * Math.PI) / 180; return { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: -Math.cos(a) * Math.cos(e) }; };
  for (const heading of [0, 90, 170, 300]) {
    const c = paintUV(L, heading, dir(heading, 2));
    assert.ok(near(c.u, 0.5, 1e-9) && near(c.pv, 0.7, 1e-9), `centre at heading ${heading}`);
    assert.ok(near(paintUV(L, heading, dir(heading + 30, 2)).u, 1, 1e-9), 'the right edge 30 deg right');
    assert.ok(near(paintUV(L, heading, dir(heading - 30, 2)).u, 0, 1e-9), 'the left edge 30 deg left');
    assert.ok(Math.abs(paintUV(L, heading, dir(heading + 180, 2)).u - 0.5) > 1.5, 'behind: far off the painting (the summit painting is there)');
    assert.ok(paintUV(L, heading, dir(heading, 10)).pv < 0.7 && paintUV(L, heading, dir(heading, -5)).pv > 0.7, 'up is up');
  }
  // wraps across north: heading 350, a view at 10 deg is 20 deg right of the centre
  assert.ok(near(paintUV(L, 350, dir(10, 2)).u, 0.5 + 20 / 60, 1e-9));
  // from above the painting's eye it sits lower on the horizon, from below higher
  assert.ok(eyeShift(2500, 1500, 6000) < 0 && eyeShift(1000, 1500, 6000) > 0 && eyeShift(1500, 1500, 6000) === 0);
});

test('backdrop: the painting sinks to the far edge of the 3D ground in the view it faces, never above its own place', () => {
  // a valley falling away 30 m per 100 m, seen from 100 m above it: its far edge is below the horizon, and the farthest
  // of the three samples (0.8, 1, 1.25 x the cut) is the highest one in the view
  const valley = (x) => -0.3 * Math.abs(x);
  const e = footElevation(valley, 0, 100, 0, 1, 0, 4000);
  assert.ok(near(e, (Math.atan2(-0.3 * 5000 - 100, 5000) * 180) / Math.PI, 1e-9), `the highest of the three samples (${e.toFixed(2)})`);
  // a ridge at 3200 m in front of the valley: it is the edge
  const ridge = (x) => (Math.abs(x - 3200) < 50 ? 300 : valley(x));
  assert.ok(near(footElevation(ridge, 0, 100, 0, 1, 0, 4000), (Math.atan2(200, 3200) * 180) / Math.PI, 1e-9));
  assert.ok(footElevation(() => 500, 0, 0, 0, 1, 0, 4000) > 0, 'a wall ahead is above the horizon');
  const theme = themeFor('dolomiti'), U = paintUniforms(theme), paint = createPaint(theme, U);
  paint.setHeading(170);
  assert.ok(near(U.uPaintA0.value.x, (170 * Math.PI) / 180) && near(U.uPaintA1.value.x, (350 * Math.PI) / 180), 'the summit painting on the opposite azimuth');
  const B = theme.backdrop, tanOf = (d) => Math.tan((d * Math.PI) / 180), nominal = B.elevation + eyeShift(B.eye, B.eye, B.distance);
  paint.setView(B.eye, -12, 175); // facing the view painting
  assert.ok(near(U.uPaintA0.value.w, tanOf(-12 + B.footLift)), 'the view painting sinks to the foot');
  assert.ok(near(U.uPaintA1.value.w, tanOf(placement(B, 1).elevation + eyeShift(B.eye, B.summitEye, B.summitDistance))), 'the one behind stays, at its own place');
  paint.setView(B.eye, -60, 175);
  assert.ok(near(U.uPaintA0.value.w, tanOf(B.footMin)), 'never below footMin');
  paint.setView(B.eye, 20, 175);
  assert.ok(near(U.uPaintA0.value.w, tanOf(nominal)), 'never above its own place');
  paint.setView(B.eye, -12, 355); // looking back uphill: the summit painting sinks instead
  assert.ok(near(U.uPaintA0.value.w, tanOf(nominal)) && U.uPaintA1.value.w < tanOf(0));
  // the summit painting has its own composition: its own foot row and haze, the rest as the view's
  assert.equal(placement(B, 0), B);
  assert.equal(placement(B, 1).row, B.summitAt.row);
  assert.equal(placement(B, 1).width, B.width);
  assert.deepEqual([U.uPaintHaze1.value.x, U.uPaintHaze1.value.y], B.summitAt.baseHaze.slice(0, 2));
  assert.equal(paint.heading, 170);
  assert.equal(createPaint({ ...theme, backdrop: { ...B, azimuth: 45 } }, paintUniforms(theme)).heading, 45, 'a fixed azimuth wins');
});

test('backdrop: the sky extension keeps the painted sky above each ridge, and a wall cut by the top edge gets the sky, not its rock', () => {
  const W = 60, H = 30, px = new Uint8ClampedArray(W * H * 4), sky = [240, 180, 170], rock = [60, 70, 72];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // a wall up to the top edge on the left third, a ridge at row 12 elsewhere
    const c = x < 20 || y >= 12 ? rock : sky, o = (y * W + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  const r = extendSky(px, W, H, 0.9);
  for (let x = 0; x < 15; x++) assert.equal(r.ridge[x], 0, `column ${x}: no sky`);
  for (let x = 30; x < W; x++) assert.equal(r.ridge[x], 12, `column ${x}: ridge row`);
  for (const x of [2, 10, 40, 55]) for (const y of [0, 20]) {
    const o = (y * W + x) * 4, d = Math.abs(r.sky[o] - sky[0]) + Math.abs(r.sky[o + 1] - sky[1]) + Math.abs(r.sky[o + 2] - sky[2]);
    assert.ok(d < 40, `sky extension at (${x}, ${y}) is the sky (${r.sky[o]}, ${r.sky[o + 1]}, ${r.sky[o + 2]})`);
  }
  assert.ok(r.base[0] < 170 && r.base[0] > 130, 'the base mist comes from the painting foot (rock), half way to the sky');
});
