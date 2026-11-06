// The drop's growth and its wake (src/render/drop-look.js, drop-tail.js, drop.js): the size curve, the pop and the
// ripple on a pickup, the flat wake that follows the path behind the drop (never a tube hanging under it), breaks up
// in the air and goes when the water is spent, the drop clearing a bank and the camera's sight line, the spray kept
// off its face, the other drop ghosting by a camera, and the chase camera that makes some room. Run with node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { THEME, mergeTheme } from '../src/render/theme.js';
import { createDrop, groundClearance, UNIT_H } from '../src/render/drop.js';
import { LIFT } from '../src/render/drop-tail.js';
import { DROP_LOOK, bodyScale, tailLength, tailShare, tailSpread, tailWidth, framing, visualRadius, lookOf } from '../src/render/drop-look.js';
import { createChaseCamera } from '../src/render/camera.js';
import { radiusFor, TUNING } from '../src/sim/tuning.js';

const DT = 1 / 60;
const player = (o) => ({ slot: 0, pos: { x: 0, y: 0.6, z: 0 }, vel: { x: 0, y: 0, z: 25 }, radius: radiusFor(TUNING, o?.mass ?? 1), mass: 1, status: 'rolling', melt: 1, freeze: 0, boost: 0, ...o });
const water = { inWater: true, waterY: 0.3, groundY: 0, waterUp: 0.3 };

// runs a drop down +z at its speed for n frames; mass may be a function of the frame
function run(d, p, n, mass) {
  for (let i = 0; i < n; i++) {
    if (mass) { p.mass = typeof mass === 'function' ? mass(i) : mass; p.radius = radiusFor(TUNING, p.mass); }
    p.pos.z += p.vel.z * DT; p.pos.x += p.vel.x * DT;
    d.update(p, DT, water);
  }
}
// drawn height before the stretch of speed (which the size test leaves out)
const heightOf = (d) => d.state.scale * UNIT_H;

test('look: the body grows much faster than the sim radius up to a size, then the water goes to the wake', () => {
  assert.equal(bodyScale(1), 1);
  for (let m = 0.3; m < 4; m += 0.1) assert.ok(bodyScale(m + 0.1) > bodyScale(m), `grows at ${m.toFixed(1)}`);
  // from a small drop to a full one the drawn size more than doubles (the cube root gives 1.6 x)
  const cap = DROP_LOOK.grow.cap;
  assert.ok(bodyScale(cap) / bodyScale(0.5) > 2.2, `${(bodyScale(cap) / bodyScale(0.5)).toFixed(2)}`);
  assert.ok(bodyScale(cap) / Math.cbrt(cap) > 1.15, 'visibly more than the sim radius');
  // over the masses a race really sees (1 at the start, about 1.5 most of the way, 2.5 for the heaviest at the end)
  // the drop of the last stage is near twice the first one's height (playtest: the growth must read from the sofa),
  // and the wake goes from nothing to most of its length and width
  assert.ok(bodyScale(2) > 1.65 && bodyScale(1.5) > 1.3, `${bodyScale(1.5).toFixed(2)} ${bodyScale(2).toFixed(2)}`);
  assert.ok(bodyScale(2.5) > 1.8 && bodyScale(2.5) < 2.1, `${bodyScale(2.5).toFixed(2)} at 2.5`);
  assert.ok(tailLength(2.5) > DROP_LOOK.tail.length[1] * 0.85, `${tailLength(2.5).toFixed(1)} radii at 2.5`);
  assert.ok(tailWidth(2.5) > tailWidth(1.5) && tailWidth(1.5) > tailWidth(1), 'the torrent widens as it grows');
  assert.ok(tailSpread(2.5) > tailSpread(1.5) * 1.15 && tailSpread(1.2) > tailWidth(1.2) * 2, 'and fans out behind, more as it grows');
  assert.equal(tailWidth(9), DROP_LOOK.tail.width[1]);
  // short: it fades out within a few body radii, far before the chase camera (12 m back)
  assert.ok(tailLength(9) * visualRadius({ mass: 9, radius: radiusFor(TUNING, 9) }) < THEME.camera.back * 0.7, 'the wake never reaches the camera');
  // past the cap it barely grows: the extra water is the rivulet's
  assert.ok(bodyScale(4) / bodyScale(DROP_LOOK.grow.cap) < 1.06);
  assert.equal(tailLength(1), 0); assert.equal(tailLength(DROP_LOOK.tail.from), 0);
  assert.ok(tailLength(1.5) * visualRadius({ mass: 1.5, radius: radiusFor(TUNING, 1.5) }) > DROP_LOOK.tail.min * 3, 'two pickups past the start already show a wake');
  for (let m = DROP_LOOK.tail.from; m < DROP_LOOK.tail.full - 0.1; m += 0.1) assert.ok(tailLength(m + 0.1) > tailLength(m));
  assert.equal(tailLength(DROP_LOOK.tail.full), DROP_LOOK.tail.length[1]);
  assert.equal(tailShare(9), 1);
  // the drawn radius of a sim player is its contact radius at mass 1, scaled by the body curve
  const p = { mass: 2, radius: radiusFor(TUNING, 2) };
  assert.ok(Math.abs(visualRadius(p) - TUNING.radius * bodyScale(2)) < 1e-9);
});

test('look: the camera makes a little room, far less than the drop grows, so a big drop fills more of the view', () => {
  assert.deepEqual(framing({ mass: 1 }), { back: 1, up: 1 });
  for (const m of [1.5, 2.2, 3, 4]) {
    const f = framing({ mass: m });
    assert.ok(f.back > 1 && f.up > f.back, `${m}: back ${f.back.toFixed(2)} up ${f.up.toFixed(2)} (up more: the wake shows behind the drop)`);
    const dist = Math.hypot(THEME.camera.back * f.back, THEME.camera.up * f.up) / Math.hypot(THEME.camera.back, THEME.camera.up);
    // playtest: at mass 2.15 the drop on screen had grown only 1.35 x (the camera pulled back with it)
    assert.ok(bodyScale(m) / dist > (m >= 2 ? 1.55 : 1.25), `${m}: ${(bodyScale(m) / dist).toFixed(2)} x on screen`);
  }
  // no tail: no room made for one
  const noTail = lookOf(mergeTheme(THEME, { drop: { look: { tail: false } } }));
  assert.equal(noTail.tail, null);
  assert.ok(framing({ mass: 3 }, noTail).up < framing({ mass: 3 }).up);
});

test('drop: a pickup pops it past its new size and it settles; a sip wobbles it smaller; the size follows the mass', () => {
  const d = createDrop(0, THEME, null), p = player({ mass: 1.4 });
  run(d, p, 90, 1.4);
  const before = heightOf(d);
  assert.ok(Math.abs(before - THEME.drop.height * visualRadius(p)) < 0.01, 'settled at the size of the mass');
  let peak = 0;
  run(d, p, 1, 1.6);
  for (let i = 0; i < 30; i++) { run(d, p, 1, 1.6); peak = Math.max(peak, d.state.rv); }
  run(d, p, 120, 1.6);
  const settled = d.state.rv, want = visualRadius(p);
  assert.ok(Math.abs(settled - want) < want * 0.01, `settles at ${settled.toFixed(3)} for ${want.toFixed(3)}`);
  assert.ok(peak > settled * 1.08, `pops ${((peak / settled - 1) * 100).toFixed(0)} % past it`);
  assert.ok(peak / (before / THEME.drop.height) > 1.15, 'the pop reads: well over the old size');
  assert.ok(d.material.emissiveIntensity < 0.3, 'the glow of the pickup is gone');
  // a sip: it dips under the new size before settling
  let low = 1e9;
  for (let i = 0; i < 30; i++) { run(d, p, 1, 1.5); low = Math.min(low, d.state.rv); }
  assert.ok(low < visualRadius(p) * 0.995, 'wobbles smaller');
});

test('drop: at a sped-up clock (10 x, a frame of 0.17 s) its springs stay bounded, so neither it nor its tail goes NaN', () => {
  const d = createDrop(0, THEME, null), p = player({ mass: 2.4 });
  for (let i = 0; i < 600; i++) {
    // landings and pickups keep kicking the squash and the size springs
    if (i % 40 === 0) p.status = 'airborne'; else if (i % 40 === 3) p.status = 'rolling';
    p.mass = 2.4 + 0.2 * Math.sin(i / 7); p.radius = radiusFor(TUNING, p.mass);
    p.pos.z += p.vel.z * 0.17;
    d.update(p, 0.17, water);
    assert.ok(Math.abs(d.state.squash) < 2 && Number.isFinite(d.state.rv), `frame ${i}: squash ${d.state.squash}`);
  }
  assert.ok(Math.abs(d.root.position.y) < 10, `drawn at y ${d.root.position.y}`);
  const pos = d.tail.group.children[0].geometry.attributes.position.array;
  assert.ok(pos.every(Number.isFinite), 'the tail has no NaN vertex');
});

test('tail: past the size a drop holds, a flat wake lies on the surface behind it along its path, and goes when the water is spent', () => {
  const d = createDrop(1, THEME, null), t = d.tail, p = player({ mass: 1 });
  run(d, p, 120, 1);
  assert.equal(t.group.children[0].visible, false, 'no wake at mass 1');
  run(d, p, 300, 3);
  const tube = t.group.children[0], want = tailLength(3) * visualRadius(p);
  assert.ok(tube.visible);
  assert.ok(Math.abs(t.state.shown - want) < 0.5, `${t.state.shown.toFixed(1)} m for ${want.toFixed(1)}`);
  // every vertex behind the drop (it runs down +z), within the wake's length, flat on the water surface (no column,
  // no tube: playtest saw a sock hanging under the drop), and fanning out wider than the drop behind it
  const pos = tube.geometry.attributes.position, o = d.root.position;
  let minZ = 1e9, maxZ = -1e9, maxDy = 0, maxX = 0;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) + o.z, y = pos.getY(i) + o.y;
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); maxDy = Math.max(maxDy, Math.abs(y - water.waterY - LIFT)); maxX = Math.max(maxX, Math.abs(pos.getX(i)));
  }
  assert.ok(maxZ <= p.pos.z + 0.01 && minZ > p.pos.z - want - 0.5, `z ${minZ.toFixed(1)}..${maxZ.toFixed(1)} behind ${p.pos.z.toFixed(1)}`);
  assert.ok(maxDy < 0.01, `flat on the surface (${maxDy.toFixed(3)} m off it)`);
  assert.ok(maxX > visualRadius(p) * tailSpread(3) * 0.9, `fans out to ${maxX.toFixed(1)} m each side`);
  assert.ok(!tube.material.uniforms.uInk, 'no dark ink edge: it is water');
  // spent: mass back to 1 (a boost, a drink), the tail is pulled in within a second
  run(d, p, 60, 1);
  assert.equal(tube.visible, false);
  // in the air it breaks up into droplets, and gathers again after the landing
  run(d, p, 300, 3);
  assert.ok(tube.visible);
  p.status = 'airborne'; run(d, p, 2);
  assert.equal(tube.visible, false, 'no tail in the air');
  assert.ok(t.group.children[1].count > 5, 'the stream breaks up into droplets');
  p.status = 'rolling'; run(d, p, 60);
  assert.ok(tube.visible && t.state.shown > want * 0.6, 'lies again from the landing on');
  // a hard turn (a rock hit): the wake swings round, it never kinks across the screen
  p.vel.x = 25; p.vel.z = 0;
  let bend = 0;
  for (let i = 0; i < 40; i++) { run(d, p, 1); bend = Math.max(bend, t.state.bend); }
  assert.ok(bend <= DROP_LOOK.tail.bend + 1e-6, `bends at most ${DROP_LOOK.tail.bend} m per m (${bend.toFixed(2)})`);
  p.vel.x = 0; p.vel.z = 25; run(d, p, 120);
  // pushed out onto a bank, it fades away (a wake is the river's)
  const bank = { ...water, inWater: false };
  for (let i = 0; i < 60; i++) { p.pos.z += p.vel.z * DT; d.update(p, DT, bank); }
  assert.equal(tube.visible, false, 'no wake on dry ground');
  run(d, p, 120);
  // a respawn far away starts the path again (no tail stretched across the stage)
  p.pos.z += 300; run(d, p, 1);
  assert.equal(tube.visible, false);
  // evaporated: gone with the drop
  run(d, p, 300); p.status = 'evaporated'; run(d, p, 60);
  assert.equal(tube.visible, false);
});

test('tail: off in the theme, none drawn; no garbage per frame once warm', () => {
  const off = createDrop(0, mergeTheme(THEME, { drop: { look: { tail: false } } }), null);
  assert.equal(off.tail, null);
  const d = createDrop(0, THEME, null), p = player({ mass: 3 });
  run(d, p, 400, 3);
  // the heap is noisy (a collection can land in any window): the best of a few windows
  let perFrame = Infinity;
  for (let k = 0; k < 4; k++) {
    const h0 = process.memoryUsage().heapUsed;
    run(d, p, 600, 3);
    perFrame = Math.min(perFrame, (process.memoryUsage().heapUsed - h0) / 600);
  }
  assert.ok(perFrame < 2048, `${perFrame.toFixed(0)} bytes per frame`);
});

test('chase camera: a big drop with its wake is framed from a little farther and higher, eased in', () => {
  const ground = () => 0;
  const path = { n: 200, x: new Float32Array(200), y: new Float32Array(200), z: new Float32Array(200), s: new Float32Array(200), hw: new Float32Array(200).fill(10) };
  for (let i = 0; i < 200; i++) { path.z[i] = i * 5; path.s[i] = i * 5; }
  const at = (mass, frames = 400) => {
    const c = createChaseCamera(THEME), p = player({ mass, pos: { x: 0, y: radiusFor(TUNING, mass), z: 300 } });
    for (let i = 0; i < frames; i++) c.update(p, DT, [path], ground);
    return { back: p.pos.z - c.camera.position.z, up: c.camera.position.y };
  };
  const small = at(1), big = at(3);
  assert.ok(big.back > small.back * 1.04 && big.up > small.up * 1.1, `back ${small.back.toFixed(1)} -> ${big.back.toFixed(1)}, up ${small.up.toFixed(1)} -> ${big.up.toFixed(1)}`);
  assert.ok(big.back < small.back * 1.15, 'but far less than the drop grows');
  const first = at(3, 1);
  assert.ok(Math.abs(first.back - big.back) < 0.2, 'snaps on the first frame');
});

test('drop: its round bottom clears a slope and a bank all around it, not only under its centre', () => {
  // a 45 degree bank rising to the right: the old centre-only rule left the uphill half inside the ground
  const g = (x) => Math.max(0, x);
  const r = 1;
  assert.equal(groundClearance(() => 2, 0, 0, r), 2, 'flat: on the ground');
  const base = groundClearance(g, 0, 0, r);
  for (let a = 0; a < 64; a++) {
    for (let b = 1; b < 16; b++) {
      const th = (a / 64) * Math.PI * 2, ph = (b / 16) * (Math.PI / 2); // lower hemisphere
      const x = Math.cos(th) * Math.sin(ph) * r, z = Math.sin(th) * Math.sin(ph) * r, y = base + r - Math.cos(ph) * r;
      assert.ok(y >= g(x, z) - 0.08 * r, `point (${x.toFixed(2)}, ${z.toFixed(2)}) at ${y.toFixed(2)} under the ground ${g(x, z).toFixed(2)}`);
    }
  }
  // the drawn drop on that bank (the game hands it the drawn ground) stands on it
  const d = createDrop(0, THEME, null), p = player({ pos: { x: 0, y: 0.55, z: 0 }, vel: { x: 0, y: 0, z: 0.1 } });
  const bank = { inWater: false, waterY: 0, groundY: 0, waterUp: 0, groundAt: g };
  for (let i = 0; i < 30; i++) d.update(p, DT, bank);
  const rd = 0.5 * d.state.scale;
  assert.ok(d.root.position.y > groundClearance(g, 0, 0, rd) - 0.05 * UNIT_H * d.state.scale - 0.06, `drawn at ${d.root.position.y.toFixed(2)}`);
  assert.ok(d.root.position.y > 0.2 * rd, 'lifted off the centre height');
});

test('drop: where its own camera looks over a lip, it rides up so the face stays in sight; on an even run it does not', () => {
  const lift = (hump) => {
    const d = createDrop(0, THEME, null), p = player({ pos: { x: 0, y: 0.55, z: -20 } }), cam = new THREE.Vector3();
    const wi = { inWater: false, waterY: 0, groundY: 0, waterUp: 0, camera: cam };
    for (let i = 0; i < 48; i++) {
      p.pos.z += p.vel.z * DT;
      // a hump of the surface 3 to 6 m behind the end point, the camera 10 m behind the drop and 2.5 m up
      const z = p.pos.z;
      wi.groundY = wi.waterY = hump && z > -6 && z < -3 ? 1.6 : 0;
      p.pos.y = wi.groundY + p.radius;
      cam.set(0, 2.5, z - 10);
      d.update(p, DT, wi);
    }
    return d.state.sight;
  };
  assert.ok(lift(false) < 0.01, `even: ${lift(false).toFixed(2)} m`);
  assert.ok(lift(true) > 0.15, `behind a lip: ${lift(true).toFixed(2)} m`);
  assert.ok(lift(true) <= THEME.drop.sightMax * UNIT_H * 3, 'and never more than its cap');
});

test('drop: drawn after the spray, so no particle lands on its face; the wake\'s droplets go before it', () => {
  const d = createDrop(0, THEME, null), body = d.root.children[0].children[0];
  const shell = body.children[0], face = body.children[1];
  assert.ok(shell.renderOrder > 3, 'after the spray points (renderOrder 3, no depth write)');
  face.traverse((o) => { if (o.isMesh) assert.ok(o.renderOrder >= shell.renderOrder); });
  const droplets = d.tail.group.children[1];
  assert.ok(droplets.renderOrder < shell.renderOrder && droplets.material.transparent && !droplets.material.depthWrite, 'droplets never cover it');
});

test('drop: a pickup sends a ripple ring out over the water that fades; the other drop ghosts right by a camera', () => {
  const d = createDrop(0, THEME, null), p = player({ mass: 1.4 });
  run(d, p, 60, 1.4);
  const ripple = d.root.children.find((o) => o.isMesh && o.geometry.type === 'RingGeometry' && o.material.isMeshBasicMaterial);
  assert.equal(ripple.visible, false);
  run(d, p, 3, 1.6);
  assert.ok(ripple.visible && ripple.material.opacity > 0.4, 'a gulp');
  const s0 = ripple.scale.x;
  run(d, p, 12, 1.6);
  assert.ok(ripple.scale.x > s0 * 1.3 && ripple.material.opacity < 0.6, 'widening, fading');
  run(d, p, 60, 1.6);
  assert.equal(ripple.visible, false, 'gone');
  // ghost: this drop 4 m from a camera whose own drop is 13 m away; solid when it is that camera's own drop
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(d.root.position.x, d.root.position.y + 2, d.root.position.z - 4);
  const own = d.root.position.clone().add(new THREE.Vector3(0, 0, 9));
  d.faceCamera(cam, own);
  assert.ok(d.material.opacity < 0.4 && !d.material.depthWrite, `ghost at ${d.material.opacity.toFixed(2)}`);
  d.faceCamera(cam, d.root.position);
  assert.equal(d.material.opacity, 1);
  d.faceCamera(cam);
  assert.equal(d.material.opacity, 1, 'no own drop given: solid');
});
