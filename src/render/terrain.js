// Terrain meshes from the baked grids, as plain typed arrays (index.js wraps them in three.js geometry).
// Two levels of detail that do not depend on the camera, so one mesh serves both split-screen views:
//   - the stage grid (4 m, local frame) at full resolution within lod.nearCourse of a stream, 8 m beyond;
//   - the global backdrop (60 m, upsampled smoothly to 30 m) around every stage, 60 m beyond lod.backdropNear.
// Where a coarse 2x2 macro cell meets a fine one, the shared mid-edge vertex is snapped onto the coarse
// edge, so there are no T-junction cracks. The stage grid's border blends onto the exact triangulated
// backdrop surface and hangs a short skirt; the backdrop is discarded under the stage grid in the shader.
// Normals come from central differences of the height field: smooth rolling shading, the low-poly hint
// is added per fragment (materials.js), not baked into the mesh. Rock, snow and ice are not baked into the vertex
// colours but given as cover weights (attribute `cover`), drawn with crisp painted edges in the shader.
import { bilinear } from '../world/sample.js';
import { clamp, lerp, smooth, D2R, fbm, vnoise } from './math.js';
import { bedAt } from './path.js';

const ext = (m) => ({ x1: m.x0 + (m.w - 1) * m.step, z1: m.z0 + (m.h - 1) * m.step });

// Height of the backdrop as drawn (two triangles per cell, diagonal from (i+1, j) to (i, j+1)), global frame.
export function backdropSurface(meta, data) {
  const { w, h, x0, z0, step } = meta;
  return (x, z) => {
    const u = clamp((x - x0) / step, 0, w - 1), v = clamp((z - z0) / step, 0, h - 1);
    const i = Math.min(Math.floor(u), w - 2), j = Math.min(Math.floor(v), h - 2);
    const fu = u - i, fv = v - j, k = j * w + i;
    const a = data[k], b = data[k + 1], c = data[k + w], d = data[k + w + 1];
    return fu + fv <= 1 ? a + (b - a) * fu + (c - a) * fv : d + (c - d) * (1 - fu) + (b - d) * (1 - fv);
  };
}

// Builds the index buffer of a w x h vertex grid where each 2x2 macro cell is fine or coarse
// (fine(mi, mj) -> bool), and snaps the heights of mid-edge vertices on fine/coarse borders (in place, Y).
// Returns { index: Uint32Array, tris }.
export function lodIndex(w, h, fine, Y) {
  const mw = Math.ceil((w - 1) / 2), mh = Math.ceil((h - 1) / 2);
  const isFine = new Uint8Array(mw * mh);
  for (let mj = 0; mj < mh; mj++) for (let mi = 0; mi < mw; mi++) {
    // a macro cell clipped by the grid edge (odd size) is always fine
    const clipped = 2 * mi + 2 > w - 1 || 2 * mj + 2 > h - 1;
    isFine[mj * mw + mi] = clipped || fine(mi, mj) ? 1 : 0;
  }
  const F = (mi, mj) => mi < 0 || mj < 0 || mi >= mw || mj >= mh ? -1 : isFine[mj * mw + mi];
  const idx = [];
  const tri2 = (a, b, c, d) => idx.push(a, c, b, b, c, d); // counter-clockwise seen from above (+y)
  for (let mj = 0; mj < mh; mj++) for (let mi = 0; mi < mw; mi++) {
    const i0 = 2 * mi, j0 = 2 * mj;
    if (isFine[mj * mw + mi]) {
      for (let j = j0; j < Math.min(j0 + 2, h - 1); j++) for (let i = i0; i < Math.min(i0 + 2, w - 1); i++) {
        const a = j * w + i; tri2(a, a + 1, a + w, a + w + 1);
      }
    } else {
      const a = j0 * w + i0; tri2(a, a + 2, a + 2 * w, a + 2 * w + 2);
    }
  }
  // snap mid-edge vertices that a coarse neighbour skips
  if (Y) {
    for (let mj = 0; mj < mh; mj++) for (let mi = 0; mi < mw; mi++) {
      if (!isFine[mj * mw + mi]) continue;
      const i0 = 2 * mi, j0 = 2 * mj;
      const snapH = (j) => { const k = j * w + i0 + 1; Y[k] = (Y[k - 1] + Y[k + 1]) / 2; };
      const snapV = (i) => { const k = (j0 + 1) * w + i; Y[k] = (Y[k - w] + Y[k + w]) / 2; };
      if (F(mi, mj - 1) === 0) snapH(j0);
      if (F(mi, mj + 1) === 0 && j0 + 2 < h) snapH(j0 + 2);
      if (F(mi - 1, mj) === 0) snapV(i0);
      if (F(mi + 1, mj) === 0 && i0 + 2 < w) snapV(i0 + 2);
    }
  }
  return { index: Uint32Array.from(idx), tris: idx.length / 3 };
}

// Smooth normals and slope (deg) of a height field on a regular grid.
function gridNormals(w, h, step, Y, N, slope) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    const l = Y[j * w + Math.max(i - 1, 0)], r = Y[j * w + Math.min(i + 1, w - 1)];
    const u = Y[Math.max(j - 1, 0) * w + i], d = Y[Math.min(j + 1, h - 1) * w + i];
    const sx = (Math.min(i + 1, w - 1) - Math.max(i - 1, 0)) * step, sz = (Math.min(j + 1, h - 1) - Math.max(j - 1, 0)) * step;
    const gx = (r - l) / sx, gz = (d - u) / sz, L = Math.hypot(gx, 1, gz);
    N[k * 3] = -gx / L; N[k * 3 + 1] = 1 / L; N[k * 3 + 2] = -gz / L;
    if (slope) slope[k] = Math.acos(1 / L) / D2R;
  }
}

// How far each node stands above the mean of the ground `reach` m around it (8 samples on a ring): positive on ribs
// and crests, negative in gullies and hollows, in m (palette.js terrain.ridges).
export function reliefGrid(w, h, step, Y, reach) {
  const r = Math.max(1, Math.round(reach / step)), d = Math.max(1, Math.round(r * 0.7071)), out = new Float32Array(w * h);
  const at = (i, j) => Y[Math.min(Math.max(j, 0), h - 1) * w + Math.min(Math.max(i, 0), w - 1)];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ring = at(i - r, j) + at(i + r, j) + at(i, j - r) + at(i, j + r) + at(i - d, j - d) + at(i + d, j - d) + at(i - d, j + d) + at(i + d, j + d);
    out[j * w + i] = Y[j * w + i] - ring / 8;
  }
  return out;
}

// Blurs the first w x h nodes of the cover weights (vec3 per node, interleaved) in place, `passes` passes each: a weight
// that flips from 0 to 1 within one cell draws its painted edge (materials.js) along the triangle edges, in steps;
// spread over a few cells the edge runs smoothly across them (terrain.coverBlur).
export function* blurCover(w, h, V, passes) {
  if (!(passes > 0)) return;
  const n = w * h, ch = new Float32Array(n);
  for (let a = 0; a < 3; a++) {
    for (let k = 0; k < n; k++) ch[k] = V[k * 3 + a];
    const b = yield* blurSteps(w, h, ch, passes);
    for (let k = 0; k < n; k++) V[k * 3 + a] = b[k];
  }
}

// A copy of a grid blurred by `passes` of a 5-tap binomial filter (1 4 6 4 1, about 1 cell of sigma each).
export function blurGrid(w, h, Y, passes = 1) {
  return drain(blurSteps(w, h, Y, passes));
}

// The same as a generator that yields after every half pass (see stageTerrainSteps).
export function* blurSteps(w, h, Y, passes = 1) {
  const a = Float32Array.from(Y), b = new Float32Array(Y.length);
  const cl = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < h; j++) {
      const r = j * w;
      for (let i = 0; i < w; i++) b[r + i] = (a[r + cl(i - 2, w)] + 4 * a[r + cl(i - 1, w)] + 6 * a[r + i] + 4 * a[r + cl(i + 1, w)] + a[r + cl(i + 2, w)]) / 16;
    }
    yield;
    for (let j = 0; j < h; j++) {
      const r0 = cl(j - 2, h) * w, r1 = cl(j - 1, h) * w, r = j * w, r3 = cl(j + 1, h) * w, r4 = cl(j + 2, h) * w;
      for (let i = 0; i < w; i++) a[r + i] = (b[r0 + i] + 4 * b[r1 + i] + 6 * b[r + i] + 4 * b[r3 + i] + b[r4 + i]) / 16;
    }
    yield;
  }
  return a;
}

// Forest tint of the ground below the treeline, in clumps (also the density map of the trees). trees.cover moves the
// clump noise: 0.15 (the default) leaves open glades between the clumps, higher closes the canopy, lower leaves only
// strips and copses. It is a number, or [[alt, cover], ...] by real altitude (linear between, held past the ends:
// a closed park forest above farmland).
export function forestAt(theme, alt, slope, x, z) {
  const T = theme.terrain;
  const n = fbm(x / 220, z / 220, 8);
  return (1 - smooth(T.treeline - 120, T.treeline + 30, alt + 80 * n)) * (1 - smooth(theme.trees.maxSlope - 6, theme.trees.maxSlope + 4, slope))
    * smooth(-0.35, 0.2, n + coverAt(theme.trees.cover, alt));
}

export function coverAt(c, alt) {
  if (c == null) return 0.15;
  if (!Array.isArray(c)) return c;
  if (alt <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (alt < c[i][0]) return lerp(c[i - 1][1], c[i][1], (alt - c[i - 1][0]) / (c[i][0] - c[i - 1][0]));
  return c[c.length - 1][1];
}

// Integer upsampling of a grid with Catmull-Rom (bicubic) interpolation: rounded forms between the coarse
// nodes, which keep their heights. Returns { meta, data } of the finer grid.
export function upsample(meta, data, f) {
  const { w, h, x0, z0, step } = meta, W2 = (w - 1) * f + 1, H2 = (h - 1) * f + 1, out = new Float32Array(W2 * H2);
  const at = (i, j) => data[Math.min(Math.max(j, 0), h - 1) * w + Math.min(Math.max(i, 0), w - 1)];
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  for (let J = 0; J < H2; J++) for (let I = 0; I < W2; I++) {
    const i = Math.floor(I / f), j = Math.floor(J / f), u = I / f - i, v = J / f - j;
    const row = (jj) => cr(at(i - 1, jj), at(i, jj), at(i + 1, jj), at(i + 2, jj), u);
    out[J * W2 + I] = cr(row(j - 1), row(j), row(j + 1), row(j + 2), v);
  }
  return { meta: { ...meta, w: W2, h: H2, step: step / f }, data: out };
}

// Dolomite walls on the far massifs: vertical gullies down the steep high rock, oriented along the fall line,
// notches between towers on the crests, and the rock stepped into terraces (ledges and near-vertical walls, their
// altitude wandering slowly). Only carves down, fading out from M.keep to 2 M.keep m from the stages (keepDist).
// Returns per vertex the wall weight (0..1) and the terrace coordinate q (a ledge edge at every q = k + M.riser),
// for the snow apron and the crease lines drawn on the walls (materials.js CARTOON_CREASES).
function massif(theme, w, h, x0, z0, step, Y, keepDist) {
  const M = theme.terrain.massif, src = Float32Array.from(Y), at = (i, j) => src[Math.min(Math.max(j, 0), h - 1) * w + Math.min(Math.max(i, 0), w - 1)];
  const r = Math.max(1, Math.round(60 / step));
  const wall = new Float32Array(w * h), Q = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, x = x0 + i * step, z = z0 + j * step, y = src[k];
    Q[k] = y / M.terrace;
    if (y < M.from) continue;
    const kw = smooth(M.keep, M.keep * 2, keepDist(x, z));
    if (kw <= 0) continue;
    const gx = (at(i + r, j) - at(i - r, j)) / (2 * r * step), gz = (at(i, j + r) - at(i, j - r)) / (2 * r * step), gl = Math.hypot(gx, gz) + 1e-6;
    const slope = Math.atan(gl) / D2R;
    const rockW = smooth(M.from, M.from + 180, y) * smooth(18, 34, slope) * kw;
    const cu = (x * -gz + z * gx) / gl, cv = (x * gx + z * gz) / gl; // across and along the fall line
    let d = -M.gully * rockW * (1 - smooth(0, 0.3, Math.abs(vnoise(cu / M.gullyWidth, cv / 700, 21))));
    // towers: notches on the highest ground of the neighbourhood
    let top = -1e9;
    for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) top = Math.max(top, at(i + a * r, j + b * r));
    const crest = smooth(-140, -25, y - top) * smooth(M.from + 150, M.from + 320, y) * kw;
    d -= crest * M.crest * (1 - smooth(0, 0.28, Math.abs(vnoise(x / 150, z / 150, 23))));
    // terraces: flat-ish ledges, then the rise of a whole step in the last (1 - riser) of it: walls
    const ph = (0.5 + 0.5 * vnoise(x / 1100, z / 1100, 29)) * M.terrace, q = (y + d + ph) / M.terrace, fl = Math.floor(q);
    const stepped = (fl + 0.25 * (q - fl) + 0.75 * smooth(M.riser, 1, q - fl)) * M.terrace - ph;
    const tw = smooth(M.from + 60, M.from + 260, y) * smooth(24, 40, slope) * kw;
    Y[k] = lerp(y + d, Math.min(stepped, y + d), tw);
    wall[k] = Math.max(rockW, tw); Q[k] = q;
  }
  return { wall, Q };
}

// The global backdrop, drawn in the global frame: upsampled (smooth) and carved into Dolomite walls away from
// the stages. stages: world.json stages (their grid rectangles set the LOD and where nothing is carved).
export function buildBackdrop(meta0, data0, stages, theme, palette) {
  const L = theme.lod, up = upsample(meta0, data0, L.backdropUpsample), meta = up.meta;
  const { w, h, x0, z0, step } = meta;
  const n = w * h, P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
  const Y = up.data, slope = new Float32Array(n);
  const rects = stages.map((s) => { const m = s.height, e = ext(m); return [m.x0 + s.offset.x, m.z0 + s.offset.z, e.x1 + s.offset.x, e.z1 + s.offset.z]; });
  const distRect = (x, z) => { let d = Infinity; for (const [ax, az, bx, bz] of rects) d = Math.min(d, Math.hypot(Math.max(ax - x, 0, x - bx), Math.max(az - z, 0, z - bz))); return d; };
  const M = theme.terrain.massif, { wall, Q } = massif(theme, w, h, x0, z0, step, Y, distRect);
  const { index, tris } = lodIndex(w, h, (mi, mj) => distRect(x0 + (2 * mi + 1) * step, z0 + (2 * mj + 1) * step) < L.backdropNear, Y);
  gridNormals(w, h, step, Y, N, slope);
  const RG = theme.terrain.ridges, relief = RG ? reliefGrid(w, h, step, Y, RG.reach) : null;
  // the snow apron: the gentle scree right under the walls stays white
  const under = blurGrid(w, h, wall, 3), snow = palette.colors.snow;
  const c = [0, 0, 0], R = new Float32Array(n * 2), V = new Float32Array(n * 3), cv = [0, 0, 0];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, x = x0 + i * step, z = z0 + j * step, y = Y[k];
    P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
    palette.ground(c, { alt: y, slope: slope[k], x, z, nx: N[k * 3], nz: N[k * 3 + 2], relief: relief ? relief[k] : NaN, forest: forestAt(theme, y, slope[k], x, z) }, cv);
    V[k * 3] = cv[0]; V[k * 3 + 1] = cv[1]; V[k * 3 + 2] = cv[2];
    const apron = M.apron * smooth(0.12, 0.4, under[k]) * (1 - smooth(0.3, 0.6, wall[k])) * (1 - smooth(26, 36, slope[k])) * smooth(M.from - 250, M.from, y);
    C[k * 3] = lerp(c[0], snow[0], apron); C[k * 3 + 1] = lerp(c[1], snow[1], apron); C[k * 3 + 2] = lerp(c[2], snow[2], apron);
    R[k * 2] = wall[k]; R[k * 2 + 1] = Q[k];
  }
  drain(blurCover(w, h, V, theme.terrain.coverBlur?.[1]));
  return { position: P, normal: N, color: C, cover: V, rock: R, index, tris, meta, heights: Y, surface: backdropSurface(meta, Y) };
}

// Runs a build generator (one that yields between slices of work) to the end and returns its result.
export function drain(gen) {
  for (;;) { const r = gen.next(); if (r.done) return r.value; }
}

// The stage grid in the stage's local frame. surface: backdropSurface() of the drawn backdrop (global).
// streams: createPathIndex() of the stage paths. Returns the mesh arrays and groundAt(x, z), the drawn
// ground height in the local frame (stage grid inside, backdrop outside).
export function buildStageTerrain(stage, height, surface, streams, theme, palette) {
  return drain(stageTerrainSteps(stage, height, surface, streams, theme, palette));
}

// The same build as a generator that yields after every grid row, so the renderer can spread it over frames.
export function* stageTerrainSteps(stage, height, surface, streams, theme, palette) {
  const m = stage.height, { w, h, x0, z0, step } = m, o = stage.offset, L = theme.lod;
  const Y = Float32Array.from(height);
  const { x1, z1 } = ext(m);
  const hit = {};
  const nearStream = (x, z, d) => streams.nearest(x, z, hit, d);
  // rounded meadows: beyond the bed the ground is softened (the 30 m DEM leaves long straight creases and terraces
  // even after the bake's blur); the bed and the foot of its banks keep the baked heights the sim plays on
  const S = theme.terrain.smooth, Yb = yield* blurSteps(w, h, Y, S.passes);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i, x = x0 + i * step, z = z0 + j * step;
      const r = nearStream(x, z, 200) ? hit.d / hit.hw : 99;
      Y[k] = lerp(Y[k], Yb[k], smooth(S.from[0], S.from[1], r));
    }
    if (j % 8 === 7) yield;
  }
  // border band: blend onto the backdrop surface, exact at the edge
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    const e = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    if (e >= L.edgeBlend) continue;
    const k = j * w + i;
    Y[k] = lerp(surface(x + o.x, z + o.z) - o.y, Y[k], smooth(0, L.edgeBlend, e));
  }
  yield;
  const { index: inner, tris } = lodIndex(w, h, (mi, mj) => nearStream(x0 + (2 * mi + 1) * step, z0 + (2 * mj + 1) * step, L.nearCourse), Y);
  // skirt: a ring of vertices under the border
  const ring = [];
  for (let i = 0; i < w; i++) ring.push(i);
  for (let j = 1; j < h; j++) ring.push(j * w + w - 1);
  for (let i = w - 2; i >= 0; i--) ring.push((h - 1) * w + i);
  for (let j = h - 2; j > 0; j--) ring.push(j * w);
  const n = w * h, nt = n + ring.length;
  const P = new Float32Array(nt * 3), N = new Float32Array(nt * 3), C = new Float32Array(nt * 3), V = new Float32Array(nt * 3), slope = new Float32Array(n);
  // shading from a softer copy still: smooth light across the slopes, the low-poly hint comes from the facet lattice
  yield;
  const Ys = yield* blurSteps(w, h, Y, S.normalPasses), RG = theme.terrain.ridges;
  gridNormals(w, h, step, Ys, N, slope);
  const relief = RG ? reliefGrid(w, h, step, Ys, RG.reach) : null;
  yield;
  const c = [0, 0, 0], cv = [0, 0, 0], depth = theme.water.depth, stream = { r: 0, above: 0, side: 1, past: 0 };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, x = x0 + i * step, z = z0 + j * step, y = Y[k], alt = y + o.y;
    P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
    const s = nearStream(x, z, 120) && hit.d < hit.hw * 2.2;
    if (s) { stream.r = hit.d / hit.hw; stream.above = y - (hit.y + depth); stream.side = hit.lat >= 0 ? 1 : -1; stream.past = hit.past || 0; }
    palette.ground(c, { alt, slope: slope[k], x: x + o.x, z: z + o.z, nx: N[k * 3], nz: N[k * 3 + 2], relief: relief ? relief[k] : NaN, forest: s ? 0 : forestAt(theme, alt, slope[k], x + o.x, z + o.z) * 0.6, stream: s ? stream : null }, cv);
    C[k * 3] = c[0]; C[k * 3 + 1] = c[1]; C[k * 3 + 2] = c[2];
    V[k * 3] = cv[0]; V[k * 3 + 1] = cv[1]; V[k * 3 + 2] = cv[2];
    if (i === w - 1) yield;
  }
  yield* blurCover(w, h, V, theme.terrain.coverBlur?.[0]);
  ring.forEach((k, r) => {
    const q = n + r;
    P[q * 3] = P[k * 3]; P[q * 3 + 1] = P[k * 3 + 1] - L.skirt; P[q * 3 + 2] = P[k * 3 + 2];
    for (let a = 0; a < 3; a++) { N[q * 3 + a] = N[k * 3 + a]; C[q * 3 + a] = C[k * 3 + a]; V[q * 3 + a] = V[k * 3 + a]; }
  });
  const index = new Uint32Array(inner.length + ring.length * 6);
  index.set(inner);
  let t = inner.length;
  for (let r = 0; r < ring.length; r++) {
    const a = ring[r], b = ring[(r + 1) % ring.length], a2 = n + r, b2 = n + (r + 1) % ring.length;
    index[t++] = a; index[t++] = a2; index[t++] = b; index[t++] = b; index[t++] = a2; index[t++] = b2;
  }
  const inside = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const groundAt = (x, z) => (inside(x, z) ? bilinear(m, Y, x, z) : surface(x + o.x, z + o.z) - o.y);
  // the triangles as drawn (exact on the fine cells along the streams): what the banks and the waterline sit on
  const tri = backdropSurface(m, Y);
  const surfaceAt = (x, z) => (inside(x, z) ? tri(x, z) : surface(x + o.x, z + o.z) - o.y);
  return { position: P, normal: N, color: C, cover: V, index, tris: tris + ring.length * 2, groundAt, surfaceAt, heights: Y, slope, meta: m };
}

// Lowers the stage ground inside each water sheet to below the water, so no terrain triangle pokes through it:
// every grid vertex closer to the stream than its sheet's edge (less a margin) is put at least `under` m under the
// water line there. paths: the drawn paths; edges[p]: buildRibbon(paths[p]).edge. Updates the mesh positions and
// the heights behind groundAt() and surfaceAt(). Returns the number of vertices lowered.
export function carveUnderWater(terrain, streams, paths, edges, theme, under = 0.12, margin = 0.3) {
  return drain(carveSteps(terrain, streams, paths, edges, theme, under, margin));
}

// The same as a generator that yields every few grid rows.
// Past the sheet's edge the ground is also kept under a ramp of water.bankRamp (rise per m) for water.bankReach m: a
// steep wall next to the stream becomes a sloping cut bank instead of a staircase of 4 m cells along it.
export function* carveSteps(terrain, streams, paths, edges, theme, under = 0.12, margin = 0.3) {
  const { w, h, x0, z0, step } = terrain.meta, Y = terrain.heights, P = terrain.position, depth = theme.water.depth, hit = {};
  const ramp = theme.water.bankRamp ?? Infinity, reach = Number.isFinite(ramp) ? theme.water.bankReach ?? 0 : 0;
  let n = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      if (!streams.nearest(x, z, hit, 60) || hit.past > 0) continue;
      const e = edges[hit.path]?.[hit.lat >= 0 ? 1 : 0]?.[hit.i];
      const out = Math.abs(hit.lat) - (e - margin); // m past the carved part of the sheet (negative: inside)
      if (!(out < reach)) continue;
      const k = j * w + i, top = bedAt(paths[hit.path], hit.i, x, z) + depth - under + Math.max(out, 0) * ramp;
      if (Y[k] > top) { Y[k] = top; P[k * 3 + 1] = top; if (out < 0) n++; }
    }
    if (j % 16 === 15) yield;
  }
  return n;
}
