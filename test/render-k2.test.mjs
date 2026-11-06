// The K2 look (src/render/themes/k2.js), without a browser: the sky around and past each painting is that painting's
// own (the purple dawn of k2.jpg on the summit and the face, the blue morning of k2-glacier.jpg at the foot), never the
// default peach that stood beside Broad Peak as a flat salmon block; the stage sky reaches the renderer's dome (sky.js
// setSkyLook); the paintings' edge sky carries on past their sides (backdrop.carry, paint.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { themeFor, DEFAULT_THEME } from '../src/render/themes/index.js';
import { mergeTheme } from '../src/render/theme.js';
import { createSky, setSkyLook } from '../src/render/sky.js';
import { paintUniforms, createPaint, PAINT_GLSL } from '../src/render/paint.js';

const world = JSON.parse(readFileSync('data/worlds/k2/world.json', 'utf8'));
const theme = themeFor(world);
const stageTheme = (id) => mergeTheme(theme, theme.stages[id]);
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const dist = (a, b) => Math.hypot(...rgb(a).map((v, k) => v - rgb(b)[k]));
// the gradient's colour at an elevation (deg), as the sky shader blends it (stepwise smoothstep)
function skyAt(S, e) {
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let c = rgb(S.stops[0][1]);
  for (let i = 1; i < S.stops.length; i++) { const f = sm(S.stops[i - 1][0], S.stops[i][0], e), n = rgb(S.stops[i][1]); c = c.map((v, k) => v + (n[k] - v) * f); }
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// measured on the files (assets/backdrops/), columns 2-10 % from the left edge
const K2_TOP = '#6f5a71', K2_HORIZON = '#cc8a70'; // k2.jpg: row 0, row 0.375 (the orange band over the far ranges)
const GLACIER_TOP = '#75a0cd'; // k2-glacier.jpg: row 0

test('k2: the sky is the dawn of k2.jpg on the summit and the face, purple overhead, salmon on the horizon, haze below it', () => {
  for (const id of ['summit-shoulder', 'south-east-face']) {
    const S = stageTheme(id).sky;
    assert.ok(dist(skyAt(S, 30), K2_TOP) < 25, `${id}: overhead ${skyAt(S, 30)} is the painting's top row`);
    assert.ok(Math.min(...[-2.5, -2, -1.5].map((e) => dist(skyAt(S, e), K2_HORIZON))) < 25, `${id}: its salmon band at the horizon`);
    const [r, g, b] = rgb(skyAt(S, 8));
    assert.ok(b > g && r > g && r + g + b < 3 * 150, `${id}: a dark purple, not the default peach (${skyAt(S, 8)})`);
    // under the horizon (it dips 3 deg from 7000-8600 m) the pale haze of the painting's foot, not more sky
    assert.ok(dist(skyAt(S, -8), theme.backdrop.mist) < 10, `${id}: below the horizon the mist`);
  }
  assert.notDeepEqual(theme.sky.stops, DEFAULT_THEME.sky.stops);
});

test('k2: at the foot of the face the sky is the blue morning of k2-glacier.jpg, with as many stops as the world sky', () => {
  const S = stageTheme('face-foot').sky;
  const [r, , b] = rgb(skyAt(S, 30));
  assert.ok(b > r + 50 && dist(skyAt(S, 30), GLACIER_TOP) < 25, `overhead ${skyAt(S, 30)}`);
  assert.equal(S.stops.length, theme.sky.stops.length, 'the renderer recolours its dome in place');
  for (const id of Object.keys(theme.stages)) assert.ok(world.stages.some((s) => s.id === id), `theme.stages.${id} is a stage of world.json`);
});

test('sky: setSkyLook recolours the dome with a stage sky of the same number of stops, and leaves it otherwise', () => {
  const sky = createSky(theme, new THREE.Vector3(0, 0.4, -1));
  const U = sky.material.uniforms, foot = stageTheme('face-foot').sky;
  assert.equal(setSkyLook(sky, foot), true);
  assert.deepEqual(U.els.value, foot.stops.map(([e]) => e));
  assert.equal(`#${U.cols.value.at(-1).getHexString()}`, foot.stops.at(-1)[1]);
  assert.equal(`#${U.uGlow.value.getHexString()}`, foot.glow);
  assert.equal(U.uGlowA.value, foot.glowStrength);
  assert.equal(setSkyLook(sky, theme.sky), true, 'and back on the next stage');
  assert.equal(`#${U.cols.value[0].getHexString()}`, theme.sky.stops[0][1]);
  assert.equal(setSkyLook(sky, { ...theme.sky, stops: theme.sky.stops.slice(1) }), false, 'another number of stops: kept');
  assert.equal(`#${U.cols.value[0].getHexString()}`, theme.sky.stops[0][1]);
});

test('backdrop: the K2 paintings carry their own sky past their sides; off by default; the uniform follows each stage', async () => {
  assert.equal(DEFAULT_THEME.backdrop.carry, 0, 'other worlds keep fading into the gradient');
  assert.ok(PAINT_GLSL.includes('uniform vec2 uPaintCarry'));
  const face = stageTheme('south-east-face').backdrop, foot = stageTheme('face-foot').backdrop;
  // far enough to cover a split view (about 42 deg wide) where the course bends east of Broad Peak, but not all round
  assert.ok(face.carry * face.width >= 60 && 2 * face.carry * face.width < 360 - face.width, `face carry ${face.carry}`);
  assert.ok(foot.carry * foot.width >= 60 && 2 * foot.carry * foot.width <= 360 - foot.width, `foot carry ${foot.carry}`);
  assert.equal(foot.fallback.carry, face.carry, 'until the glacier painting exists, k2.jpg carries as on the face');
  const U = paintUniforms(theme);
  assert.deepEqual(U.uPaintCarry.value.toArray(), [theme.backdrop.carry, theme.backdrop.carry]);
  const p = createPaint(theme, U);
  await p.ready;
  p.setBackdrop(foot);
  assert.equal(U.uPaintCarry.value.x, foot.carry);
  p.setBackdrop({ ...face, carry: 0, summitAt: { ...face.summitAt, carry: 0 } });
  assert.deepEqual(U.uPaintCarry.value.toArray(), [0, 0]);
});
