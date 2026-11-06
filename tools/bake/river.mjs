// The real watercourse as one ordered lon/lat polyline, source first, from a cached Overpass answer.
// Three OSM shapes (descent.kind in the world config):
//   osm-relation  a waterway relation: members with role main_stream or empty, in relation order
//   osm-ways      explicit way ids in flow order (unnamed streams, a hand-picked chain)
//   osm-network   every river/stream way of a box: walk downstream from a start point, choosing at each
//                 fork by preferred name, then river over stream (braided channels collapse to one line)
// The DEM line (descent.kind dem) is built in course.mjs. All return { relation, pts, s, length, label }.
import { readFileSync } from 'node:fs';
import { geoDist } from './dem.mjs';

const withArc = (pts) => {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + geoDist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return { pts, s, length: s.at(-1) };
};

// Appends way geometries in order, turning each to continue from the last point. A gap up to maxGap m
// is bridged by a straight segment (a confluence drawn a few metres apart); a longer one throws.
function chain(geoms, maxGap, what) {
  const pts = [];
  for (const [ref, geom] of geoms) {
    let g = geom.map((p) => [p.lon, p.lat]);
    if (pts.length) {
      const [lx, ly] = pts.at(-1);
      const dHead = geoDist(lx, ly, g[0][0], g[0][1]), dTail = geoDist(lx, ly, g.at(-1)[0], g.at(-1)[1]);
      if (dTail < dHead) g = g.reverse();
      if (Math.min(dHead, dTail) > maxGap) throw new Error(`${what}: gap of ${Math.min(dHead, dTail).toFixed(0)} m before way ${ref}`);
      g = g.slice(1); // the shared node (or, across a small gap, the first point of the next way)
    }
    pts.push(...g);
  }
  return pts;
}

export function loadRiver(file = 'data/raw/osm/dolomiti/river.json', { name = 'Piave', relation, maxGap = 50 } = {}) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const rel = j.elements.find((e) => e.type === 'relation' && (Number.isInteger(relation) ? e.id === relation : e.tags?.name === name));
  if (!rel) throw new Error(`${file}: no ${Number.isInteger(relation) ? `relation ${relation}` : `${name} relation`}`);
  const ways = new Map(j.elements.filter((e) => e.type === 'way').map((w) => [w.id, w]));
  const geoms = [];
  for (const m of rel.members) {
    if (m.type !== 'way' || (m.role !== 'main_stream' && m.role !== '')) continue;
    const w = ways.get(m.ref);
    if (!w?.geometry) throw new Error(`way ${m.ref} has no geometry`);
    geoms.push([m.ref, w.geometry]);
  }
  return { relation: rel.id, ...withArc(chain(geoms, maxGap, file)), label: `OpenStreetMap relation ${rel.id} (${rel.tags?.name || name})` };
}

export function loadWays(file, ids, { maxGap = 50 } = {}) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const ways = new Map(j.elements.filter((e) => e.type === 'way').map((w) => [w.id, w]));
  const geoms = ids.map((id) => {
    const w = ways.get(id);
    if (!w?.geometry) throw new Error(`${file}: way ${id} missing`);
    return [id, w.geometry];
  });
  const names = [...new Set(ids.map((id) => ways.get(id).tags?.name).filter(Boolean))];
  return { relation: null, ...withArc(chain(geoms, maxGap, file)), label: `OpenStreetMap ways ${names.length ? `(${names.join(', ')})` : '(unnamed streams)'}` };
}

const RANK = { river: 0, stream: 1, brook: 2 };

// Walks the waterway network downstream from the node nearest to `start` ({lon, lat}). OSM draws
// waterways in flow direction; an edge drawn the wrong way is taken backwards only when the DEM says
// it descends. A dead end (stream under a glacier or into a lake) jumps to the nearest lower node
// within `jump` m. Stops after maxKm.
export function networkRiver(file, elevation, start, { prefer = [], maxKm = 40, jump = 400, climb = 15 } = {}) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const ways = j.elements.filter((e) => e.type === 'way' && e.geometry && e.nodes && !(e.tags?.tunnel === 'culvert' && RANK[e.tags?.waterway] > 0));
  const ll = new Map(), edges = new Map();
  const wayLen = new Map(ways.map((w) => [w.id, w.geometry.slice(1).reduce((s, p, i) => s + geoDist(w.geometry[i].lon, w.geometry[i].lat, p.lon, p.lat), 0)]));
  const add = (a, e) => { if (!edges.has(a)) edges.set(a, []); edges.get(a).push(e); };
  for (const w of ways) {
    w.nodes.forEach((n, i) => ll.set(n, [w.geometry[i].lon, w.geometry[i].lat]));
    for (let i = 0; i + 1 < w.nodes.length; i++) {
      add(w.nodes[i], { to: w.nodes[i + 1], way: w, back: false });
      add(w.nodes[i + 1], { to: w.nodes[i], way: w, back: true });
    }
  }
  if (!ll.size) throw new Error(`${file}: no waterway in the box`);
  const nearest = (lon, lat, ok = () => true) => {
    let best = null, bd = Infinity;
    for (const [n, p] of ll) {
      if (!ok(n, p)) continue;
      const d = geoDist(lon, lat, p[0], p[1]);
      if (d < bd || (d === bd && n < best)) { bd = d; best = n; }
    }
    return { node: best, d: bd };
  };
  const pi = (w) => { const k = prefer.indexOf(w.tags?.name); return k < 0 ? prefer.length : k; };
  const score = (e, cur) => [e.back ? 1 : 0, pi(e.way), RANK[e.way.tags?.waterway] ?? 3, e.way === cur ? 0 : 1, -wayLen.get(e.way.id), e.way.id];
  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  let cur = nearest(start.lon, start.lat).node, curWay = null, len = 0, jumps = 0;
  const visited = new Set([cur]), pts = [ll.get(cur)], used = [];
  while (len < maxKm * 1000) {
    const h = elevation(...ll.get(cur));
    const cands = (edges.get(cur) || []).filter((e) => !visited.has(e.to) && elevation(...ll.get(e.to)) <= h + climb && (!e.back || elevation(...ll.get(e.to)) < h));
    let next;
    if (cands.length) {
      const e = cands.sort((a, b) => cmp(score(a, curWay), score(b, curWay)))[0];
      next = e.to;
      if (e.way !== curWay) { curWay = e.way; used.push(e.way.tags?.name); }
    } else {
      const [lon, lat] = ll.get(cur);
      const n = nearest(lon, lat, (k, p) => !visited.has(k) && (edges.get(k) || []).some((e) => !e.back) && elevation(...p) < h);
      if (!n.node || n.d > jump) break;
      next = n.node;
      curWay = null;
      jumps++;
    }
    const a = ll.get(cur), b = ll.get(next);
    len += geoDist(a[0], a[1], b[0], b[1]);
    visited.add(next);
    pts.push(b);
    cur = next;
  }
  if (pts.length < 2) throw new Error(`${file}: no downstream way from the start point`);
  const names = [...new Set(used.filter(Boolean))];
  return { relation: null, ...withArc(pts), jumps, label: `OpenStreetMap waterways ${names.length ? `(${names.join(', ')})` : '(unnamed streams)'}` };
}

// lon/lat at arc length t (metres from the source), linear between nodes.
export function riverAt(river, t) {
  const { pts, s } = river;
  t = Math.min(Math.max(t, 0), s.at(-1));
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= t) lo = mid; else hi = mid;
  }
  const f = (t - s[lo]) / Math.max(s[hi] - s[lo], 1e-9);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
}

// Arc length of the river point nearest to (lon, lat), and the distance to it.
export function projectOnRiver(river, lon, lat) {
  let best = { t: 0, d: Infinity };
  const { pts, s } = river;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = geoDist(lon, lat, pts[i][0], pts[i][1]);
    if (d < best.d) best = { t: s[i], d };
  }
  return best;
}
