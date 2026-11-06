// Mesh surgery for the animal models, on plain typed arrays (no three.js, so node tests can run it).
// A mesh is { pos: Float32Array(3 * verts), idx: Uint32Array(3 * faces), col: Float32Array(3 * faces) }:
// welded vertices and one flat colour per face (linear RGB). The pipeline turns the faceted low-poly
// sources into the smooth, rounded look of the game: weld, optional Taubin smoothing (rounds boxy
// volumes without shrinking them), subdivision (Loop, or midpoints pushed out on the Phong surface so
// thin legs and horns keep their size), then smooth normals with a crease angle for shading.

const EPS_REL = 1e-5;

export function bounds(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

// Triangle soup (or indexed triangles) -> welded mesh. Vertices closer than eps (relative to the bounding
// box diagonal) become one, degenerate faces are dropped. colors: one [r, g, b] per face.
export function weld(positions, index, colors, epsRel = EPS_REL) {
  const nf = (index ? index.length : positions.length / 3) / 3;
  const b = bounds(positions);
  const eps = Math.hypot(...b.size) * epsRel || 1e-9;
  const inv = 1 / eps, map = new Map(), pos = [], remap = new Int32Array(positions.length / 3);
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let id = map.get(key);
    if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(x, y, z); }
    remap[v] = id;
  }
  const idx = [], col = [];
  for (let f = 0; f < nf; f++) {
    const a = remap[index ? index[f * 3] : f * 3], c1 = remap[index ? index[f * 3 + 1] : f * 3 + 1], c2 = remap[index ? index[f * 3 + 2] : f * 3 + 2];
    if (a === c1 || c1 === c2 || a === c2) continue;
    idx.push(a, c1, c2);
    col.push(colors[f * 3], colors[f * 3 + 1], colors[f * 3 + 2]);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), col: new Float32Array(col) };
}

// Edges with their faces: Map key a*n+b (a < b) -> { a, b, faces: [f...], opp: [vertex opposite in each face] }.
function edgeTable(mesh) {
  const n = mesh.pos.length / 3, edges = new Map(), { idx } = mesh;
  for (let f = 0; f < idx.length / 3; f++) {
    for (let k = 0; k < 3; k++) {
      const i = idx[f * 3 + k], j = idx[f * 3 + ((k + 1) % 3)], o = idx[f * 3 + ((k + 2) % 3)];
      const a = Math.min(i, j), b = Math.max(i, j), key = a * n + b;
      let e = edges.get(key);
      if (!e) { e = { a, b, faces: [], opp: [], mid: -1 }; edges.set(key, e); }
      e.faces.push(f); e.opp.push(o);
    }
  }
  return edges;
}

// Neighbour lists and crease flags: a vertex on an edge that does not have exactly two faces (open
// border, or where a separate shell pokes through) is a crease vertex and only follows its crease edges.
function vertexRings(mesh, edges) {
  const n = mesh.pos.length / 3;
  const ring = Array.from({ length: n }, () => []), crease = Array.from({ length: n }, () => []);
  for (const e of edges.values()) {
    ring[e.a].push(e.b); ring[e.b].push(e.a);
    if (e.faces.length !== 2) { crease[e.a].push(e.b); crease[e.b].push(e.a); }
  }
  return { ring, crease };
}

// Area-weighted smooth normal per welded vertex.
export function vertexNormals(mesh) {
  const { pos, idx } = mesh, out = new Float32Array(pos.length);
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f] * 3, b = idx[f + 1] * 3, c = idx[f + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { out[v] += nx; out[v + 1] += ny; out[v + 2] += nz; }
  }
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v], out[v + 1], out[v + 2]) || 1;
    out[v] /= l; out[v + 1] /= l; out[v + 2] /= l;
  }
  return out;
}

// Taubin lambda|mu smoothing: a shrink step and an inflate step per iteration, so boxy corners round
// off while the volume stays. weight(v) in [0, 1] can pin parts (eyes, horn tips) in place.
export function taubin(mesh, { iterations = 4, lambda = 0.5, mu = -0.53, weight = null } = {}) {
  const edges = edgeTable(mesh), { ring, crease } = vertexRings(mesh, edges);
  let p = Float32Array.from(mesh.pos);
  const n = p.length / 3, w = new Float32Array(n);
  for (let v = 0; v < n; v++) w[v] = weight ? weight(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], v) : 1;
  const pass = (src, k) => {
    const dst = Float32Array.from(src);
    for (let v = 0; v < n; v++) {
      const nb = crease[v].length ? (crease[v].length === 2 ? crease[v] : null) : ring[v];
      if (!nb || !nb.length || !w[v]) continue;
      let sx = 0, sy = 0, sz = 0;
      for (const u of nb) { sx += src[u * 3]; sy += src[u * 3 + 1]; sz += src[u * 3 + 2]; }
      const f = k * w[v], m = 1 / nb.length;
      dst[v * 3] += f * (sx * m - src[v * 3]); dst[v * 3 + 1] += f * (sy * m - src[v * 3 + 1]); dst[v * 3 + 2] += f * (sz * m - src[v * 3 + 2]);
    }
    return dst;
  };
  for (let i = 0; i < iterations; i++) p = pass(pass(p, lambda), mu);
  return { ...mesh, pos: p };
}

// One subdivision level: each triangle -> four, colours inherited. scheme 'loop' smooths every vertex
// (approximating, rounder, shrinks thin parts a little); 'phong' keeps the old vertices and lifts the new
// edge midpoints onto the Phong surface of the smooth normals (interpolating, keeps size).
export function subdivide(mesh, { levels = 1, scheme = 'loop', alpha = 0.75 } = {}) {
  let m = mesh;
  for (let l = 0; l < levels; l++) m = scheme === 'phong' ? subdividePhong(m, alpha) : subdivideLoop(m);
  return m;
}

function split(mesh, edges, newPos) {
  const { idx, col } = mesh, nf = idx.length / 3, n = mesh.pos.length / 3;
  const out = new Uint32Array(nf * 12), oc = new Float32Array(nf * 12), ot = mesh.tag ? new Int16Array(nf * 4) : null;
  const mid = (i, j) => edges.get(Math.min(i, j) * n + Math.max(i, j)).mid;
  for (let f = 0; f < nf; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    out.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], f * 12);
    for (let k = 0; k < 4; k++) oc.set(col.subarray(f * 3, f * 3 + 3), f * 12 + k * 3);
    if (ot) ot.fill(mesh.tag[f], f * 4, f * 4 + 4);
  }
  return ot ? { pos: newPos, idx: out, col: oc, tag: ot } : { pos: newPos, idx: out, col: oc };
}

function subdivideLoop(mesh) {
  const { pos } = mesh, n = pos.length / 3;
  const edges = edgeTable(mesh), { ring, crease } = vertexRings(mesh, edges);
  const np = new Float32Array((n + edges.size) * 3);
  // old vertices
  for (let v = 0; v < n; v++) {
    const cr = crease[v];
    let wSelf, nb, wNb;
    if (cr.length === 2) { wSelf = 0.75; nb = cr; wNb = 0.125; }
    else if (cr.length > 0) { wSelf = 1; nb = []; wNb = 0; }
    else {
      nb = ring[v]; const k = nb.length;
      const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
      wSelf = 1 - k * beta; wNb = beta;
    }
    for (let c = 0; c < 3; c++) {
      let s = pos[v * 3 + c] * wSelf;
      for (const u of nb) s += pos[u * 3 + c] * wNb;
      np[v * 3 + c] = s;
    }
  }
  // edge vertices
  let next = n;
  for (const e of edges.values()) {
    e.mid = next++;
    for (let c = 0; c < 3; c++) {
      const pa = pos[e.a * 3 + c], pb = pos[e.b * 3 + c];
      np[e.mid * 3 + c] = e.faces.length === 2 ? 0.375 * (pa + pb) + 0.125 * (pos[e.opp[0] * 3 + c] + pos[e.opp[1] * 3 + c]) : 0.5 * (pa + pb);
    }
  }
  return split(mesh, edges, np);
}

function subdividePhong(mesh, alpha) {
  const { pos } = mesh, n = pos.length / 3;
  const edges = edgeTable(mesh), nrm = vertexNormals(mesh);
  const np = new Float32Array((n + edges.size) * 3);
  np.set(pos);
  let next = n;
  for (const e of edges.values()) {
    e.mid = next++;
    const m = [0, 1, 2].map((c) => 0.5 * (pos[e.a * 3 + c] + pos[e.b * 3 + c]));
    const proj = (v) => { // m projected on the tangent plane of vertex v
      const d = (m[0] - pos[v * 3]) * nrm[v * 3] + (m[1] - pos[v * 3 + 1]) * nrm[v * 3 + 1] + (m[2] - pos[v * 3 + 2]) * nrm[v * 3 + 2];
      return [m[0] - d * nrm[v * 3], m[1] - d * nrm[v * 3 + 1], m[2] - d * nrm[v * 3 + 2]];
    };
    const pa = proj(e.a), pb = proj(e.b);
    for (let c = 0; c < 3; c++) np[e.mid * 3 + c] = (1 - alpha) * m[c] + alpha * 0.5 * (pa[c] + pb[c]);
  }
  return split(mesh, edges, np);
}

// Flat corner arrays for a BufferGeometry: position, shading normal (smooth inside a crease angle),
// smooth normal (for the outline hull, never split) and colour, three corners per face.
export function toCorners(mesh, { creaseDeg = 70 } = {}) {
  const { pos, idx, col } = mesh, nf = idx.length / 3;
  const smooth = vertexNormals(mesh);
  const fn = new Float32Array(nf * 3), fa = new Float32Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    fn[f * 3] = nx / l; fn[f * 3 + 1] = ny / l; fn[f * 3 + 2] = nz / l; fa[f] = l;
  }
  // faces around each vertex
  const n = pos.length / 3, start = new Uint32Array(n + 1);
  for (let i = 0; i < idx.length; i++) start[idx[i] + 1]++;
  for (let v = 0; v < n; v++) start[v + 1] += start[v];
  const fill = start.slice(0, n), around = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) around[fill[idx[i]]++] = (i / 3) | 0;
  const cosT = Math.cos((creaseDeg * Math.PI) / 180);
  const position = new Float32Array(nf * 9), normal = new Float32Array(nf * 9), hull = new Float32Array(nf * 9), color = new Float32Array(nf * 9);
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k], o = f * 9 + k * 3;
      position[o] = pos[v * 3]; position[o + 1] = pos[v * 3 + 1]; position[o + 2] = pos[v * 3 + 2];
      let sx = 0, sy = 0, sz = 0;
      for (let t = start[v]; t < start[v + 1]; t++) {
        const g = around[t];
        if (fn[g * 3] * fn[f * 3] + fn[g * 3 + 1] * fn[f * 3 + 1] + fn[g * 3 + 2] * fn[f * 3 + 2] < cosT) continue;
        sx += fn[g * 3] * fa[g]; sy += fn[g * 3 + 1] * fa[g]; sz += fn[g * 3 + 2] * fa[g];
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      normal[o] = sx / l; normal[o + 1] = sy / l; normal[o + 2] = sz / l;
      hull[o] = smooth[v * 3]; hull[o + 1] = smooth[v * 3 + 1]; hull[o + 2] = smooth[v * 3 + 2];
      color[o] = col[f * 3]; color[o + 1] = col[f * 3 + 1]; color[o + 2] = col[f * 3 + 2];
    }
  }
  return { position, normal, hull, color, count: nf * 3 };
}

// Applies fn(x, y, z) -> [x, y, z] to every vertex (in place on a copy).
export function mapVertices(mesh, fn) {
  const p = Float32Array.from(mesh.pos);
  for (let i = 0; i < p.length; i += 3) { const r = fn(p[i], p[i + 1], p[i + 2], i / 3); p[i] = r[0]; p[i + 1] = r[1]; p[i + 2] = r[2]; }
  return { ...mesh, pos: p };
}

// Recolours faces: fn(rgb, centroid [x, y, z], f) -> rgb or null (keep). Faces may carry a tag (an int
// per face, e.g. a palette key index) that subdivision and merge keep.
export function mapFaces(mesh, fn) {
  const { pos, idx } = mesh, col = Float32Array.from(mesh.col);
  for (let f = 0; f < idx.length / 3; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
    const cen = [0, 1, 2].map((k) => (pos[a + k] + pos[b + k] + pos[c + k]) / 3);
    const r = fn([col[f * 3], col[f * 3 + 1], col[f * 3 + 2]], cen, f);
    if (r) { col[f * 3] = r[0]; col[f * 3 + 1] = r[1]; col[f * 3 + 2] = r[2]; }
  }
  return { ...mesh, col };
}

// Appends another mesh (e.g. bead eyes) to this one.
export function merge(a, b) {
  const n = a.pos.length / 3, idx = new Uint32Array(a.idx.length + b.idx.length);
  idx.set(a.idx); for (let i = 0; i < b.idx.length; i++) idx[a.idx.length + i] = b.idx[i] + n;
  const pos = new Float32Array(a.pos.length + b.pos.length); pos.set(a.pos); pos.set(b.pos, a.pos.length);
  const col = new Float32Array(a.col.length + b.col.length); col.set(a.col); col.set(b.col, a.col.length);
  if (!a.tag && !b.tag) return { pos, idx, col };
  const tag = new Int16Array(idx.length / 3).fill(-1);
  if (a.tag) tag.set(a.tag); if (b.tag) tag.set(b.tag, a.idx.length / 3);
  return { pos, idx, col, tag };
}

// A smooth closed ellipsoid shell (subdivided icosahedron), for bead eyes and highlight dots: centre c,
// radii r [x, y, z], colour rgb.
export function ellipsoid(c, r, rgb, level = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let pos = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  let idx = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  let m = { pos: new Float32Array(pos), idx: new Uint32Array(idx), col: new Float32Array((idx.length / 3) * 3).fill(0) };
  for (let l = 0; l < level; l++) m = subdividePhong(m, 0);
  return mapFaces(mapVertices(m, (x, y, z) => { const l = Math.hypot(x, y, z); return [c[0] + (x / l) * r[0], c[1] + (y / l) * r[1], c[2] + (z / l) * r[2]]; }), () => rgb);
}

// Mesh stats for tests and logs.
export function stats(mesh) {
  const edges = edgeTable(mesh);
  let open = 0;
  for (const e of edges.values()) if (e.faces.length !== 2) open++;
  return { verts: mesh.pos.length / 3, faces: mesh.idx.length / 3, edges: edges.size, open };
}
