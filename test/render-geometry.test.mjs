// Render unit, pure geometry (no WebGL): theme, palette, terrain LOD without cracks, the stage border on the
// backdrop, stream paths, the water ribbon and the bank strips, built on the real baked Dolomiti world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from '../src/world/load.js';
import { bilinear } from '../src/world/sample.js';
import { THEME, mergeTheme, sunDirection } from '../src/render/theme.js';
import { createPalette } from '../src/render/palette.js';
import { lodIndex, backdropSurface, buildBackdrop, buildStageTerrain, stageTerrainSteps, carveUnderWater, blurGrid } from '../src/render/terrain.js';
import { densifyPath, stagePaths, createPathIndex, trackPath, indexAtS, roundEnd, bedAt } from '../src/render/path.js';
import { placeTrees } from '../src/render/trees.js';
import { buildRibbon, buildBanks } from '../src/render/water.js';
import { linear, hash3 } from '../src/render/math.js';

const world = await loadWorld('dolomiti', { dir: 'data/worlds' });
const palette = createPalette(THEME);
const backdrop = buildBackdrop(world.json.backdrop, world.backdrop, world.json.stages, THEME, palette);
const built = world.stages.map((st) => {
  const paths = stagePaths(st.json), index = createPathIndex(paths);
  return { st, paths, index, terrain: buildStageTerrain(st.json, st.height, backdrop.surface, index, THEME, palette) };
});

test('theme: deep merge replaces leaves and arrays, keeps the rest; colours are hex; the sun is a unit vector', () => {
  const t = mergeTheme(THEME, { fog: { density: 0 }, sky: { stops: [[0, '#000000']] } });
  assert.equal(t.fog.density, 0);
  assert.equal(t.fog.color, THEME.fog.color);
  assert.deepEqual(t.sky.stops, [[0, '#000000']]);
  assert.notEqual(THEME.fog.density, 0, 'the base theme is not mutated');
  const hex = [];
  const walk = (o) => { for (const v of Object.values(o)) { if (typeof v === 'string' && v.startsWith('#')) hex.push(v); else if (v && typeof v === 'object') walk(v); } };
  walk(THEME);
  assert.ok(hex.length > 40);
  for (const h of hex) assert.match(h, /^#[0-9a-f]{6}$/i, h);
  const s = sunDirection(THEME.sun);
  assert.ok(Math.abs(Math.hypot(s.x, s.y, s.z) - 1) < 1e-9);
  assert.ok(s.y > 0.2 && s.y < 0.6, 'a low golden-hour sun');
  assert.deepEqual(linear('#ffffff'), [1, 1, 1]);
});

test('palette: meadow low and gentle, rock on steep high ground, snow up high, earth bank and wet bed by the water', () => {
  const c = [0, 0, 0], at = (g) => (palette.ground(c, { x: 10, z: 20, ...g }), c.slice());
  const green = (v) => v[1] > v[0] && v[1] > v[2];
  assert.ok(green(at({ alt: 1500, slope: 8 })), 'meadow');
  const rock = palette.ground(c, { alt: 2400, slope: 50, x: 10, z: 20 });
  assert.ok(rock > 0.8, 'steep high ground is rock');
  assert.ok(c[0] > c[1] && c[0] > c[2], 'pale warm rock');
  const snow = at({ alt: 2600, slope: 10 });
  assert.ok(snow[0] > 0.8 && snow[1] > 0.8 && snow[2] > 0.8, 'snow');
  // the ground under the bank only warms a little: the draped bank strip (water.js buildBanks) carries the earth
  const bank = at({ alt: 1500, slope: 20, stream: { r: 1.05, above: 1.2, side: -1 } }), plain = at({ alt: 1500, slope: 20 });
  assert.ok(bank[0] > plain[0] && bank[1] < plain[1], 'warmer ground at the bank');
  const bed = at({ alt: 1500, slope: 2, stream: { r: 0.3, above: -0.3, side: 1 } });
  assert.ok(bed[2] > bed[0], 'the bed under the water is blue-grey');
});

test('lod index: fine and coarse macro cells, mid-edge vertices snapped (no T-junction cracks), counter-clockwise', () => {
  const w = 37, h = 29, Y = new Float32Array(w * h).map((_, k) => 50 * hash3(k, 3, 1));
  const fine = (mi, mj) => (mi - 8) ** 2 + (mj - 6) ** 2 < 20;
  const { index, tris } = lodIndex(w, h, fine, Y);
  assert.equal(index.length, tris * 3);
  assert.ok(tris < (w - 1) * (h - 1) * 2 && tris > (w - 1) * (h - 1) / 2);
  for (const i of index) assert.ok(i >= 0 && i < w * h);
  // every edge used by exactly one triangle lies on the grid border: a crack would leave inner open edges
  const edges = new Map();
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) {
    const k = key(index[t + e], index[t + (e + 1) % 3]); edges.set(k, (edges.get(k) || 0) + 1);
  }
  // an open inner edge is only allowed on a fine/coarse border: a half edge whose odd end was snapped onto the
  // coarse edge (collinear, so no crack), or the coarse edge spanning that snapped vertex
  const xz = (i) => [i % w, Math.floor(i / w)];
  for (const [k, n] of edges) {
    if (n !== 1) continue;
    const [a, b] = k.split(',').map(Number), [ax, az] = xz(a), [bx, bz] = xz(b);
    if ((ax === bx && (ax === 0 || ax === w - 1)) || (az === bz && (az === 0 || az === h - 1))) continue;
    const d = ax === bx ? w : 1, len = Math.abs(b - a) / d;
    const odd = len === 2 ? (a + b) / 2 : (ax === bx ? az % 2 : ax % 2) ? a : b;
    assert.ok(Math.abs(Y[odd] - (Y[odd - d] + Y[odd + d]) / 2) < 1e-4, `open edge ${k}: vertex ${odd} not on the coarse edge`);
  }
  // counter-clockwise seen from above: normals point up
  const flat = new Float32Array(w * h);
  const { index: fi } = lodIndex(w, h, () => true, flat);
  for (let t = 0; t < fi.length; t += 3) {
    const [a, b, c] = [fi[t], fi[t + 1], fi[t + 2]].map((i) => [i % w, 0, Math.floor(i / w)]);
    const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
    assert.ok(uz * vx - ux * vz > 0, 'normal y > 0');
  }
});

test('backdrop: the drawn surface matches the grid at the nodes, smooth upsampling keeps them; LOD keeps it cheap far away', () => {
  const m = world.json.backdrop, s = backdropSurface(m, world.backdrop);
  for (const [i, j] of [[10, 10], [100, 200], [m.w - 1, m.h - 1]]) assert.ok(Math.abs(s(m.x0 + i * m.step, m.z0 + j * m.step) - world.backdrop[j * m.w + i]) < 1e-3);
  // the upsampled backdrop keeps the baked nodes near the stages (carving only far away)
  const B = backdrop.meta, f = THEME.lod.backdropUpsample;
  for (const st of world.json.stages) {
    const gx = st.offset.x, gz = st.offset.z, i = Math.round((gx - m.x0) / m.step), j = Math.round((gz - m.z0) / m.step);
    assert.ok(Math.abs(backdrop.heights[j * f * B.w + i * f] - world.backdrop[j * m.w + i]) < 1e-3, `node at stage ${st.id}`);
  }
  assert.equal(B.step, m.step / f);
  assert.ok(backdrop.tris < (B.w - 1) * (B.h - 1) * 2 * 0.8, `backdrop ${backdrop.tris} triangles`);
});

test('stage terrain: the border lies on the backdrop, the bed keeps the baked heights, normals point up', () => {
  for (const { st, terrain } of built) {
    const m = st.json.height, o = st.json.offset;
    const x1 = m.x0 + (m.w - 1) * m.step, z1 = m.z0 + (m.h - 1) * m.step;
    for (let i = 0; i < m.w; i += 7) for (const z of [m.z0, z1]) {
      const x = m.x0 + i * m.step;
      assert.ok(Math.abs(terrain.groundAt(x, z) - (backdrop.surface(x + o.x, z + o.z) - o.y)) < 0.05, `${st.json.id} border at ${x}, ${z}`);
    }
    // away from the border the drawn ground is the baked grid (LOD snapping moves only a few far vertices)
    let worst = 0;
    for (const p of st.json.course) {
      if (p.x - m.x0 < 80 || x1 - p.x < 80 || p.z - m.z0 < 80 || z1 - p.z < 80) continue;
      worst = Math.max(worst, Math.abs(terrain.groundAt(p.x, p.z) - bilinear(m, st.height, p.x, p.z)));
    }
    assert.ok(worst < 1e-3, `${st.json.id}: bed moved by ${worst} m`);
    for (let k = 0; k < terrain.normal.length; k += 3 * 97) assert.ok(terrain.normal[k + 1] > 0, 'normal up');
    for (const i of terrain.index) assert.ok(i < terrain.position.length / 3);
    assert.ok(terrain.tris < (m.w - 1) * (m.h - 1) * 2, `${st.json.id}: LOD drops triangles far from the stream`);
  }
});

test('paths: the smooth curve passes through the baked points, never climbs, and the index finds the nearest sample', () => {
  const { st, paths, index } = built[2];
  const c = densifyPath(st.json.course, 2);
  assert.equal(paths[0].n, c.n);
  assert.equal(paths.length, 1 + st.json.branches.length);
  for (let i = 1; i < c.n; i++) { assert.ok(c.y[i] <= c.y[i - 1] + 1e-9); assert.ok(c.s[i] > c.s[i - 1]); }
  const course = st.json.course;
  for (const p of course) {
    const k = trackPath(c, p.x, p.z);
    assert.ok(Math.hypot(c.x[k] - p.x, c.z[k] - p.z) < 1e-6 && Math.abs(c.y[k] - p.y) < 1e-6, 'through every baked point');
  }
  assert.ok(Math.abs(c.length - (st.json.length ?? c.length)) / c.length < 0.02, 'length close to the baked one');
  assert.equal(indexAtS(c, 0), 0); assert.equal(indexAtS(c, 1e9), c.n - 1);
  const hit = {};
  for (let q = 0; q < 60; q++) {
    const x = st.json.height.x0 + hash3(q, 1, 5) * 900, z = st.json.height.z0 + hash3(q, 2, 5) * 1800;
    let bd = Infinity;
    for (const p of paths) for (let i = 0; i < p.n; i++) bd = Math.min(bd, Math.hypot(p.x[i] - x, p.z[i] - z));
    const found = index.nearest(x, z, hit, 400);
    if (bd > 400) { assert.equal(found, false); continue; }
    assert.ok(found && Math.abs(hit.d - bd) < 1e-9, `nearest at ${x}, ${z}`);
  }
});

test('water: the sheet ends on the banks (within the bed width), sits at bed + depth, branches drop the part inside the main channel', () => {
  const W = THEME.water;
  for (const { st, paths, terrain } of built) {
    const main = createPathIndex([paths[0]]), mh = {};
    paths.forEach((p, pi) => {
      const rb = buildRibbon(p, terrain.groundAt, THEME, [], pi > 0 ? (x, z) => main.nearest(x, z, mh, 60) && mh.d < mh.hw * 0.92 : null);
      assert.equal(rb.position.length / 3, p.n * W.columns);
      for (let i = 0; i < p.n; i += 5) for (const side of [0, 1]) {
        const e = rb.edge[side][i];
        assert.ok(e >= 0.25 * p.hw[i] - 1e-9 && e <= W.maxWidth * p.hw[i] + 1e-9, `${st.json.id} edge ${e} hw ${p.hw[i]}`);
      }
      // the centre column is at bed + depth, and the ground there is under the water
      const mid = (W.columns - 1) / 2 | 0;
      for (let i = 0; i < p.n; i += 11) {
        const k = i * W.columns + mid;
        assert.ok(Math.abs(rb.position[k * 3 + 1] - (p.y[i] + W.depth)) < 1e-4);
      }
      if (pi > 0) {
        const masked = rb.mask.reduce((a, b) => a + b, 0);
        assert.ok(masked > 0 && masked < rb.mask.length / 2, `${st.json.id} branch ${pi}: ${masked} masked vertices`);
      } else assert.equal(rb.mask.reduce((a, b) => a + b, 0), 0);
      const banks = buildBanks(p, terrain.surfaceAt, rb.edge, THEME, palette.colors);
      for (let k = 0; k < banks.position.length; k++) assert.ok(Number.isFinite(banks.position[k]));
      // opaque RGB in flat tones, draped on the drawn surface (never under it, nor under the water line but at the foot)
      assert.equal(banks.color.length, banks.position.length, 'RGB, no alpha fade');
      const nc = banks.position.length / 3 / (2 * p.n);
      for (let v = 0; v < banks.position.length / 3; v += 7) {
        const x = banks.position[v * 3], y = banks.position[v * 3 + 1], z = banks.position[v * 3 + 2], i = Math.floor(v / nc) % p.n;
        if (v % nc === 0) continue;
        assert.ok(y >= terrain.surfaceAt(x, z) - 1e-3 && y >= p.y[i] + W.depth, `${st.json.id} bank vertex ${v} under the ground or the water`);
      }
    });
  }
});

// Playtest finding (28/10/2026, Dolomiti Bassa Val Sesis): at the forks a grey bank bar lay across the river, the
// band of the shortcut drawn inside the main channel. Each band now leaves out what lies on the other path's water.
test('banks: no band lies across the water of another path at the forks', () => {
  let forks = 0;
  for (const { st, paths, terrain } of built) {
    if (paths.length < 2) continue;
    const idx = paths.map((p) => createPathIndex([p])), h = {};
    const inside = (k, x, z) => idx[k].nearest(x, z, h, 60) && h.d < h.hw * 0.92;
    const main = (x, z) => inside(0, x, z), arm = (x, z) => paths.slice(1).some((_, k) => inside(k + 1, x, z));
    paths.forEach((p, pi) => {
      const rb = buildRibbon(p, terrain.groundAt, THEME, [], pi > 0 ? main : null);
      const covered = pi > 0 ? main : arm, banks = buildBanks(p, terrain.surfaceAt, rb.edge, THEME, palette.colors, covered);
      const open = buildBanks(p, terrain.surfaceAt, rb.edge, THEME, palette.colors);
      assert.ok(banks.index.length < open.index.length, `${st.json.id} path ${pi}: nothing left out at the forks`);
      const P = banks.position;
      for (let t = 0; t < banks.index.length; t += 3) {
        const [a, b, c] = [banks.index[t], banks.index[t + 1], banks.index[t + 2]];
        const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
        assert.ok(!covered(x, z), `${st.json.id} path ${pi}: bank triangle on the other water at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      }
      forks++;
    });
  }
  assert.ok(forks >= 4, 'the Dolomiti have a shortcut and a safe arm');
});

test('path index: exact nearest sample (or none) for any point and reach, far from the streams too, and fast', () => {
  let n = 0;
  const t0 = performance.now();
  for (const { st, paths, index } of built) {
    const m = st.json.height, hit = {};
    for (let q = 0; q < 1500; q++) {
      const x = m.x0 - 500 + hash3(q, 1, 9) * (m.w * m.step + 1000), z = m.z0 - 500 + hash3(q, 2, 9) * (m.h * m.step + 1000), maxD = [60, 120, 260, 400][q % 4];
      let bd = Infinity;
      for (const p of paths) for (let i = 0; i < p.n; i++) bd = Math.min(bd, Math.hypot(p.x[i] - x, p.z[i] - z));
      const found = index.nearest(x, z, hit, maxD);
      if (bd > maxD) assert.equal(found, false, `${x}, ${z} within ${maxD}`);
      else assert.ok(found && Math.abs(hit.d - bd) < 1e-9, `${st.json.id} nearest at ${x}, ${z}`);
      n++;
    }
  }
  assert.ok(n === 6000);
  // the stage build asks the index once per terrain vertex and tree candidate: a whole stage must take a fraction
  // of a second, not the 1.5 s freeze it was in the middle of every cloud (generous bound: the machine may be busy)
  const { st, index } = built[2], t1 = performance.now();
  const terrain = buildStageTerrain(st.json, st.height, backdrop.surface, index, THEME, palette);
  placeTrees(st.json, terrain, index, THEME, palette);
  const ms = performance.now() - t1;
  assert.ok(ms < 1500, `stage 3 terrain and trees in ${ms.toFixed(0)} ms (brute-force check ${(t1 - t0).toFixed(0)} ms)`);
});

test('stage build in slices: the generator yields every row and gives the same terrain as the one-shot build', () => {
  const { st, index, terrain } = built[1];
  const gen = stageTerrainSteps(st.json, st.height, backdrop.surface, index, THEME, palette);
  let yields = 0, r;
  while (!(r = gen.next()).done) yields++;
  assert.ok(yields >= st.json.height.h, `${yields} slices for ${st.json.height.h} rows`);
  assert.deepEqual(r.value.position, terrain.position);
  assert.deepEqual(r.value.color, terrain.color);
});

test('terrain: rounded meadows beyond the bed, the bed itself as baked; nothing above the water inside a sheet once carved', () => {
  const { st, paths, index } = built[3];
  const terrain = buildStageTerrain(st.json, st.height, backdrop.surface, index, THEME, palette);
  const m = st.json.height, hit = {};
  // smoother than the bake away from the stream: less curvature (second differences) on the open slopes
  const curv = (Y) => { let a = 0, c = 0; for (let j = 2; j < m.h - 2; j += 3) for (let i = 2; i < m.w - 2; i += 3) {
    if (index.nearest(m.x0 + i * m.step, m.z0 + j * m.step, hit, 120)) continue;
    const k = j * m.w + i; a += Math.abs(Y[k - 1] + Y[k + 1] - 2 * Y[k]) + Math.abs(Y[k - m.w] + Y[k + m.w] - 2 * Y[k]); c++; } return a / c; };
  assert.ok(curv(terrain.heights) < curv(st.height) * 0.92, `curvature ${curv(terrain.heights).toFixed(3)} vs baked ${curv(st.height).toFixed(3)}`);
  assert.ok(Math.abs(blurGrid(3, 3, new Float32Array(9).fill(5), 2)[4] - 5) < 1e-6, 'the blur keeps a flat field');
  const ribbons = paths.map((p) => buildRibbon(p, terrain.surfaceAt, THEME));
  const lowered = carveUnderWater(terrain, index, paths, ribbons.map((rb) => rb.edge), THEME);
  assert.ok(lowered > 0, 'some ground stood above the sheet');
  let above = 0;
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const x = m.x0 + i * m.step, z = m.z0 + j * m.step;
    if (!index.nearest(x, z, hit, 60) || hit.past > 0) continue;
    const e = ribbons[hit.path].edge[hit.lat >= 0 ? 1 : 0][hit.i];
    if (Math.abs(hit.lat) < e - 0.3 && terrain.heights[j * m.w + i] > bedAt(paths[hit.path], hit.i, x, z) + THEME.water.depth - 0.1) above++;
    if (Math.abs(terrain.position[(j * m.w + i) * 3 + 1] - terrain.heights[j * m.w + i]) > 1e-6) above++;
  }
  assert.equal(above, 0, 'ground vertices above the water inside a sheet');
});

test('water: the course ends in a rounded pool past the finish, its bed never climbing', () => {
  const { paths, terrain } = built[1], p = paths[0], len = p.hw[p.n - 1] * THEME.water.endPool;
  const e = roundEnd(p, terrain.surfaceAt, len);
  assert.ok(e.n > p.n && Math.abs(e.length - (p.length + len)) < 1e-6);
  for (let i = 0; i < p.n; i++) assert.equal(e.x[i], p.x[i]);
  for (let i = p.n; i < e.n; i++) { assert.ok(e.y[i] <= e.y[i - 1] + 1e-9, 'not climbing'); assert.ok(e.hw[i] <= e.hw[i - 1] + 1e-9, 'closing'); }
  assert.ok(e.hw[e.n - 1] < 1e-6, 'closed at the end');
  const rb = buildRibbon(e, terrain.surfaceAt, THEME);
  assert.ok(rb.edge[0][e.n - 1] <= 0.25 * p.hw[p.n - 1] + 1e-6 && rb.edge[1][e.n - 1] <= 0.25 * p.hw[p.n - 1] + 1e-6, 'the sheet narrows to the tip');
});

test('backdrop: the far high rock is stepped into Dolomite walls with a snow apron and crease lines, the stages untouched', () => {
  const B = backdrop.meta, R = backdrop.rock, Y = backdrop.heights;
  assert.equal(R.length, (B.w * B.h) * 2);
  let walls = 0, steep = 0;
  for (let k = 0; k < B.w * B.h; k++) if (R[k * 2] > 0.5) {
    walls++;
    const i = k % B.w, j = Math.floor(k / B.w);
    if (i < 1 || j < 1 || i >= B.w - 1 || j >= B.h - 1) continue;
    const g = Math.hypot(Y[k + 1] - Y[k - 1], Y[k + B.w] - Y[k - B.w]) / (2 * B.step);
    if (Math.atan(g) > 55 * Math.PI / 180) steep++;
  }
  assert.ok(walls > 500, `${walls} wall vertices`);
  assert.ok(steep > walls * 0.05, `${steep} of them in walls steeper than 55 degrees`);
  // the apron takes the scree under the walls most of the way to snow (massif.apron of the way, at most)
  const snow = linear(THEME.terrain.snow), tol = 0.03 + (1 - THEME.terrain.massif.apron) * 0.6;
  let apron = 0;
  for (let k = 0; k < B.w * B.h; k++) if (R[k * 2] < 0.3 && Math.abs(backdrop.color[k * 3] - snow[0]) < tol && Math.abs(backdrop.color[k * 3 + 2] - snow[2]) < tol) apron++;
  assert.ok(apron > 50, `${apron} snow apron vertices`);
});
