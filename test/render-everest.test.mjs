// The Everest look (src/render/themes/everest.js), without a browser: one course from the summit pyramid to the yak
// pastures of Thukla, so each stage has its own banks, water and paintings (theme.stages); the paintings turned to
// the real bearings of Pumori and of Everest; the Yellow Band across the summit pyramid; nothing that does not grow
// at 4400-8849 m in the Khumbu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { themeFor } from '../src/render/themes/index.js';
import { mergeTheme } from '../src/render/theme.js';
import { createPalette } from '../src/render/palette.js';
import { paintUniforms, createPaint } from '../src/render/paint.js';
import { sharedUniforms } from '../src/render/materials.js';

const world = JSON.parse(readFileSync('data/worlds/everest/world.json', 'utf8'));
const theme = themeFor(world);
const stageTheme = (id) => mergeTheme(theme, theme.stages[id]);
const hue = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// Real places (Wikipedia coordinates) in the world frame: x east, z south, metres from the summit.
const KX = 111320 * Math.cos((world.frame.lat * Math.PI) / 180), KZ = 110574;
const at = (lat, lon) => ({ x: (lon - world.frame.lon) * KX, z: -(lat - world.frame.lat) * KZ });
const PUMORI = at(28.0147, 86.8281), EVEREST = at(world.frame.lat, world.frame.lon);
// where they are in the paintings: u across the image (0 left .. 1 right), measured on the files
const PUMORI_U = 0.307, EVEREST_U = 0.464;

const bearing = (from, to) => ((Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI + 360) % 360;
const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function middle(s) {
  const c = s.course[s.course.length >> 1];
  return { x: s.offset.x + c.x, z: s.offset.z + c.z };
}

test('everest: every stage look names a real stage; ice stages run in clear meltwater between snow banks, Thukla in milky glacial water', () => {
  const ids = world.stages.map((s) => s.id);
  for (const id of Object.keys(theme.stages)) assert.ok(ids.includes(id), `theme.stages.${id} is a stage of world.json`);
  const blue = (w) => { const [r, g, b] = hue(w.base); return b - r; };
  for (const id of ['summit-pyramid', 'western-cwm', 'icefall']) {
    const t = stageTheme(id);
    const [r, g, b] = hue(t.terrain.bank);
    assert.ok(r > 200 && g > 200 && b > 200, `${id}: the channel is cut in snow, not earth (${t.terrain.bank})`);
    assert.ok(blue(t.water) > 120, `${id}: clear deep-blue supraglacial meltwater (${t.water.base})`);
  }
  const k = stageTheme('thukla');
  assert.ok(blue(k.water) < 70, `thukla: milky grey-turquoise glacial water below the snout (${k.water.base})`);
  assert.ok(hue(k.terrain.bank)[0] < 180, 'thukla: banks of grey glacial gravel');
  // stage looks change only the stream and the paintings: the ground of the stage grid stays the world's
  for (const id of Object.keys(theme.stages)) {
    const t = stageTheme(id);
    for (const key of ['meadow', 'scree', 'rock', 'snow', 'ice', 'moraine']) assert.equal(t.terrain[key], theme.terrain[key], `${id}: terrain.${key}`);
  }
});

test('everest: no painting where it would show the wrong mountains; the others turned to the real bearings', () => {
  // on the summit pyramid everything is below the viewer and Pumori is 56 deg off the way down; at Thukla the view
  // south is Ama Dablam, Taboche and Cholatse, not the Pumori of the painting: both show the real 3D ranges
  assert.equal(stageTheme('summit-pyramid').backdrop.file, null);
  assert.equal(stageTheme('thukla').backdrop.file, null);
  for (const id of ['western-cwm', 'icefall']) {
    const s = world.stages.find((x) => x.id === id), B = stageTheme(id).backdrop, m = middle(s);
    const centre = s.heading + B.offset;
    const pumori = centre + (PUMORI_U - 0.5) * B.width;
    assert.ok(angle(pumori, bearing(m, PUMORI)) < 8, `${id}: Pumori painted at ${pumori.toFixed(0)}, really at ${bearing(m, PUMORI).toFixed(0)}`);
    const summitW = (B.summitAt?.width ?? B.width), everest = centre + 180 + B.summitOffset + (EVEREST_U - 0.5) * summitW;
    assert.ok(angle(everest, bearing(m, EVEREST)) < 8, `${id}: Everest painted at ${everest.toFixed(0)}, really at ${bearing(m, EVEREST).toFixed(0)}`);
  }
});

test('everest: the Yellow Band is a bare cliff band of yellowish marble between 8200 and 8600 m', () => {
  const P = createPalette(theme), out = [0, 0, 0], cv = [0, 0, 0];
  const cover = (alt, slope) => { P.ground(out, { alt, slope, x: 130, z: 70 }, cv); return [...cv]; };
  const [rock, snow] = cover(8400, 47);
  assert.ok(rock > 0.9 && snow < 0.1, `in the band a 47 deg slope is bare rock (rock ${rock.toFixed(2)}, snow ${snow.toFixed(2)})`);
  const [rock2, snow2] = cover(7800, 47);
  assert.ok(snow2 > 0.5, `below it the same slope holds snow over the rock (rock ${rock2.toFixed(2)}, snow ${snow2.toFixed(2)})`);
  const U = sharedUniforms(theme).cover;
  assert.deepEqual([U.uCoverBand.value.x, U.uCoverBand.value.y], [8200, 8600]);
  const c = U.uCoverBandColor.value;
  assert.ok(c.r > c.g && c.g > c.b, 'yellowish brown');
  // a world without one keeps its rock as it was
  assert.equal(sharedUniforms(themeFor('dolomiti')).cover.uCoverBand.value.w, 0);
});

test('everest: nothing grows that does not grow there; the scrub stops at 5000 m; yak pasture, not alpine meadow green', () => {
  assert.equal(theme.trees.kinds.length, 0, 'the treeline of Sagarmatha is near 4000 m, under the course');
  assert.deepEqual(theme.trees.shrubs.kinds.map((k) => k.name).sort(), ['dwarf juniper', 'dwarf rhododendron']);
  for (const k of theme.trees.shrubs.kinds) assert.ok(k.alt[1] <= 5000 && k.height[1] <= 1.5, k.name);
  const [r, g, b] = hue(theme.terrain.meadow);
  assert.ok(r >= g && g > b, `tawny turf (${theme.terrain.meadow})`);
});

test('paint: a stage backdrop swaps the paintings and their placement (no painting: off)', async () => {
  const U = paintUniforms(theme), seen = [];
  const p = createPaint(theme, U, { onLoad: (m) => seen.push(m) });
  assert.equal(await p.ready, false, 'no document: no image');
  const B = stageTheme('icefall').backdrop;
  p.setHeading(300);
  p.setBackdrop(B); p.setHeading(300);
  assert.equal(await p.ready, false);
  assert.deepEqual([U.uPaintOn.value.z, U.uPaintOn.value.w], B.cut);
  assert.ok(Math.abs(U.uPaintA0.value.x - ((300 + B.offset) * Math.PI) / 180) < 1e-9, 'view painting turned by offset');
  assert.ok(Math.abs(U.uPaintA1.value.x - ((300 + B.offset + 180 + B.summitOffset) * Math.PI) / 180) < 1e-9, 'summit painting turned by summitOffset');
  assert.equal(U.uPaintHaze.value.z, B.baseHaze[2]);
  assert.equal(U.uPaintOn.value.x, 0);
  assert.ok(seen.every((m) => m === null), 'the haze is told there is no painting');
});
