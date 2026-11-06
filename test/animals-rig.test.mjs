// The rig helpers and the material knobs the species files share: a tail that hangs below the hips wags whole
// and is left out of the legs, every species of the Alpine and Carpathian worlds has a head and (walkers) legs
// in its rig, and far animals are drawn bigger for readability, per view, with a switch to turn it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quadruped } from '../src/render/animals/species.js';
import { SPECIES, WORLDS } from '../src/render/animals/registry.js';
import { animalMaterial, animalOutlineMaterial, FAR } from '../src/render/animals/material.js';
import { THEME } from '../src/render/theme.js';

const f = (x, y, z) => ({ x, y, z });

test('quadruped: a tail region of its own wags whole and never swings with the legs', () => {
  const tailOf = (p) => (p.z < -0.3 && Math.abs(p.x) < 0.1 ? 1 : 0);
  const rig = quadruped({ neck: [0.7, 0.3], head: () => 0, hip: 0.45, front: 0.2, back: -0.2, tail: [0.6, -0.3], tailOf });
  const tip = f(0, 0.2, -0.45), hind = f(0.2, 0.2, -0.25);
  assert.equal(rig.tail(tip), 1);
  assert.equal(rig.leg(tip).w, 0, 'the hanging tail is not a leg');
  assert.ok(rig.leg(hind).w > 0.9, 'the hind leg still swings');
  assert.equal(rig.tail(hind), 0);
  // without a region the tail is the band behind the rump, above the hips, as before
  const plain = quadruped({ neck: [0.7, 0.3], head: () => 0, hip: 0.45, front: 0.2, back: -0.2, tail: [0.6, -0.3] });
  assert.ok(plain.tail(f(0, 0.62, -0.4)) > 0.9 && plain.tail(f(0, 0.62, 0)) === 0);
});

test('every species of the Alpine and Carpathian worlds is rigged: a head, legs for the walkers, wings for the soarers', () => {
  const ids = new Set(['dolomiti', 'antelao', 'svizzera', 'carpazi'].flatMap((w) => WORLDS[w]));
  for (const id of ids) {
    const s = SPECIES[id], pv = s.rig.pivots({ size: [1, 1, 1] });
    assert.equal(typeof s.rig.head, 'function', `${id} head`);
    assert.ok(pv.head, `${id} head pivot`);
    if (s.flying) assert.ok(s.rig.wing && pv.wing, `${id} wings`);
    else if (!['marmot', 'chough', 'ptarmigan'].includes(id)) assert.ok(s.rig.leg && pv.leg, `${id} legs`); // the marmot sits up, the birds hop
  }
});

test('far animals are drawn bigger per view, and the theme can switch it off', () => {
  assert.ok(FAR[0] > 0 && FAR[0] <= 1 && FAR[1] < FAR[2], 'at most twice the size, growing over a range');
  const m = animalMaterial(THEME, null, {}), o = animalOutlineMaterial(THEME, null, {});
  assert.deepEqual(m.userData.rig.uFar.value.toArray(), FAR);
  assert.deepEqual(o.uniforms.uFar.value.toArray(), FAR, 'the outline hull grows with the animal');
  assert.match(o.vertexShader, /p \*= animalFar\(\)/);
  const off = { ...THEME, animals: { ...(THEME.animals || {}), far: 0 } };
  assert.equal(animalMaterial(off, null, {}).userData.rig.uFar.value.x, 0);
  assert.equal(animalOutlineMaterial(off, null, {}).uniforms.uFar.value.x, 0);
});
