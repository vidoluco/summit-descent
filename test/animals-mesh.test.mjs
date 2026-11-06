// Animal mesh surgery (src/render/animals/mesh.js, build.js): welding, smoothing and subdivision keep a
// closed watertight shape and its size, colours and tags follow the faces, the build normalises any
// source into the game frame. Pure, no three.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weld, subdivide, taubin, toCorners, bounds, stats, ellipsoid, merge, vertexNormals } from '../src/render/animals/mesh.js';
import { buildSpecies, linearHex, describe } from '../src/render/animals/build.js';

// A flat-shaded box as a triangle soup (36 corners, one colour per face): the boxy source we round off.
function boxSoup(sx = 2, sy = 1, sz = 3, ox = 0, oy = 0, oz = 0) {
  const q = [[[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
    [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]];
  const pos = [], col = [];
  q.forEach((f, i) => {
    for (const t of [[0, 1, 2], [0, 2, 3]]) {
      for (const k of t) pos.push(ox + (f[k][0] * sx) / 2, oy + (f[k][1] * sy) / 2, oz + (f[k][2] * sz) / 2);
      col.push(i / 6, 0.5, 1 - i / 6);
    }
  });
  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}

function volume(m) {
  let v = 0;
  for (let f = 0; f < m.idx.length; f += 3) {
    const a = m.idx[f] * 3, b = m.idx[f + 1] * 3, c = m.idx[f + 2] * 3, p = m.pos;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

test('weld merges the split corners of a flat-shaded soup into a closed mesh', () => {
  const s = boxSoup();
  const m = weld(s.positions, null, s.colors);
  assert.deepEqual(stats(m), { verts: 8, faces: 12, edges: 18, open: 0 });
  assert.equal(m.col.length, 36);
  assert.ok(Math.abs(volume(m) - 6) < 1e-5, 'outward winding, volume of the box');
});

test('Loop subdivision rounds the box, stays closed, keeps face colours and tags', () => {
  const s = boxSoup();
  const m = { ...weld(s.positions, null, s.colors) };
  m.tag = Int16Array.from({ length: 12 }, (_, f) => f >> 1);
  const r = subdivide(m, { levels: 2, scheme: 'loop' });
  assert.equal(r.idx.length / 3, 12 * 16);
  assert.equal(stats(r).open, 0);
  assert.equal(r.tag.length, 12 * 16);
  for (let f = 0; f < r.tag.length; f++) {
    const src = f >> 4; // each coarse face becomes 16 children, in order
    assert.equal(r.tag[f], m.tag[src]);
    assert.deepEqual([...r.col.subarray(f * 3, f * 3 + 3)], [...m.col.subarray(src * 3, src * 3 + 3)]);
  }
  // rounder: the corners are pulled in, nothing pokes out of the original box
  const b = bounds(r.pos);
  for (let k = 0; k < 3; k++) assert.ok(b.size[k] < [2, 1, 3][k] && b.size[k] > [2, 1, 3][k] * 0.5);
});

test('Phong subdivision keeps the original vertices and lifts new ones onto the smooth surface', () => {
  const ico = ellipsoid([0, 0, 0], [1, 1, 1], [1, 1, 1], 0); // 20 faces on the unit sphere
  const flat = subdivide(ico, { levels: 1, scheme: 'phong', alpha: 0 }), round = subdivide(ico, { levels: 1, scheme: 'phong' });
  assert.deepEqual([...round.pos.subarray(0, ico.pos.length)], [...ico.pos]);
  const err = (m) => { let e = 0; for (let i = 0; i < m.pos.length; i += 3) e = Math.max(e, Math.abs(Math.hypot(m.pos[i], m.pos[i + 1], m.pos[i + 2]) - 1)); return e; };
  assert.ok(err(round) < err(flat) * 0.5, `phong ${err(round).toFixed(3)} vs flat ${err(flat).toFixed(3)}`);
  assert.equal(stats(round).open, 0);
});

test('Taubin smoothing rounds without shrinking much, and pinned vertices stay', () => {
  const s = boxSoup();
  const m = subdivide(weld(s.positions, null, s.colors), { levels: 2, scheme: 'phong', alpha: 0 });
  const r = taubin(m, { iterations: 6 });
  assert.ok(volume(r) > volume(m) * 0.85, `volume kept (${volume(r).toFixed(2)} of ${volume(m).toFixed(2)})`);
  const pinned = taubin(m, { iterations: 6, weight: () => 0 });
  assert.deepEqual([...pinned.pos], [...m.pos]);
});

test('corners: smooth normals inside the crease angle, flat across it, hull normals never split', () => {
  const s = boxSoup();
  const m = weld(s.positions, null, s.colors);
  const hard = toCorners(m, { creaseDeg: 60 }), soft = toCorners(m, { creaseDeg: 100 });
  assert.equal(hard.count, 36);
  for (let i = 0; i < 36; i++) {
    const n = hard.normal.subarray(i * 3, i * 3 + 3), h = hard.hull.subarray(i * 3, i * 3 + 3), w = soft.normal.subarray(i * 3, i * 3 + 3);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-5);
    assert.equal(Math.max(...n.map(Math.abs)), 1, 'box faces at 90 deg stay flat under a 60 deg crease');
    const p = hard.position.subarray(i * 3, i * 3 + 3);
    assert.ok([0, 1, 2].every((k) => Math.sign(h[k]) === Math.sign(p[k])) && Math.abs(Math.hypot(...h) - 1) < 1e-5, 'hull normal points out of the corner');
    assert.ok(Math.max(...w.map(Math.abs)) < 0.99, 'smoothed across a 100 deg crease');
  }
  const vn = vertexNormals(m);
  assert.equal(vn.length, 24);
});

test('ellipsoid parts are smooth closed shells of the given size, merge keeps both', () => {
  const e = ellipsoid([1, 2, 3], [0.1, 0.2, 0.3], [1, 0, 0]);
  assert.equal(stats(e).open, 0);
  const b = bounds(e.pos);
  assert.ok(Math.abs(b.size[0] - 0.2) < 1e-4 && Math.abs(b.size[2] - 0.6) < 1e-4);
  const s = boxSoup(), m = merge(weld(s.positions, null, s.colors), e);
  assert.equal(m.idx.length / 3, 12 + e.idx.length / 3);
});

test('buildSpecies: orient, normalise to metres, feet on the ground, paint and repaint, eyes, rig', () => {
  // a box lying along +x in its source frame: the orient turns +x into the game's +z (forward)
  const soup = boxSoup(3, 1, 1, 10, 5, -2);
  const spec = {
    id: 'test', orient: [0, 0, -1, 0, 1, 0, 1, 0, 0], size: { length: 1.5 },
    colors: { body: '#806040', front: '#ffffff', eye: '#000000' },
    paint: (s, f) => (f.z > 0.3 ? 'front' : 'body'),
    repaint: (k, f) => (k === 'body' ? ['body', 'front', f.y > 0.5 ? 1 : 0] : k),
    eyes: [{ f: [0.3, 0.7, 0.45], r: 0.03 }],
    rig: { head: (f) => (f.z > 0.25 ? 1 : 0), leg: (f) => ({ w: f.y < 0.2 ? 1 : 0, phase: f.x > 0 ? 0.5 : 0 }), pivots: ({ size }) => ({ head: [size[1], 0.25 * size[2], 0.8, 0.5] }) },
  };
  const out = buildSpecies(soup, spec);
  const b = bounds(out.position);
  assert.ok(Math.abs(b.size[2] - 1.5) < 0.02 + 0.03, `length ${b.size[2]}`); // + the eyes' bulge
  assert.ok(Math.abs(b.min[1]) < 1e-5, 'feet on y = 0');
  assert.ok(Math.abs(b.min[0] + b.max[0]) < 0.02, 'centred on x');
  assert.ok(out.count === out.position.length / 3 && out.rig.length === out.count * 4);
  // colours: the front is white, the top of the body blended to white by repaint, the bottom stays body
  const white = linearHex('#ffffff'), body = linearHex('#806040');
  let front = 0, low = 0, eye = 0;
  for (let i = 0; i < out.count; i++) {
    const z = out.position[i * 3 + 2], y = out.position[i * 3 + 1], c = [...out.color.subarray(i * 3, i * 3 + 3)];
    if (c.every((v) => v === 0)) { eye++; continue; }
    if (z > 0.6 && y > 0.1 && y < 0.9) { front++; assert.deepEqual(c.map((v) => +v.toFixed(4)), white.map((v) => +v.toFixed(4))); }
    if (z < 0 && y < 0.01) { low++; assert.ok(Math.abs(c[0] - body[0]) < 1e-4); }
  }
  assert.ok(front > 0 && low > 0 && eye > 0, `front ${front} low ${low} eye corners ${eye}`);
  assert.equal(out.pivots.head.length, 4);
  assert.ok(out.rig.some((v, i) => i % 4 === 0 && v === 1) && out.rig.some((v, i) => i % 4 === 2 && v === 0.5));
});

test('describe gives luma, hue and saturation of a linear colour', () => {
  const d = describe(linearHex('#ff0000'));
  assert.ok(Math.abs(d.hue) < 1e-6 && Math.abs(d.sat - 1) < 1e-6 && Math.abs(d.luma - 0.299) < 1e-3);
  assert.ok(Math.abs(describe(linearHex('#808080')).sat) < 1e-6);
});
