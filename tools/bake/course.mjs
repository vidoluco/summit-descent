// The real spine (summit path plus river) at 1:1, its bed profile, the valley floor and the stages.
// Everything is in one global frame: metres, x east, z south, origin at the summit.
import { localFrame, geoDist } from './dem.mjs';
import { riverAt } from './river.mjs';
import { resample, smoothPolyline, arcLengths, pointAt, smooth1d } from './geom.mjs';

// Highest DEM point within radius of the configured summit.
export function findSummit(dem, cfg) {
  const f = localFrame(cfg.lat, cfg.lon);
  let best = { h: -Infinity };
  for (let z = -cfg.searchRadius; z <= cfg.searchRadius; z += 10) {
    for (let x = -cfg.searchRadius; x <= cfg.searchRadius; x += 10) {
      if (x * x + z * z > cfg.searchRadius ** 2) continue;
      const [lon, lat] = f.toLonLat(x, z), h = dem.elevation(lon, lat);
      if (h > best.h) best = { h, lon, lat };
    }
  }
  return best;
}

// Least-cost downhill path on a 15 m grid from the summit to (lon, lat): penalises climbing and cliffs.
export function downhillPath(dem, from, to) {
  const f = localFrame(from.lat, from.lon), [tx, tz] = f.toXZ(to.lon, to.lat);
  const S = 15, pad = 450;
  const xa = Math.min(0, tx) - pad, za = Math.min(0, tz) - pad;
  const w = Math.ceil((Math.max(0, tx) + pad - xa) / S) + 1, h = Math.ceil((Math.max(0, tz) + pad - za) / S) + 1;
  const H = new Float64Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const [lon, lat] = f.toLonLat(xa + i * S, za + j * S);
    H[j * w + i] = dem.elevation(lon, lat);
  }
  const idx = (x, z) => Math.round((z - za) / S) * w + Math.round((x - xa) / S);
  const start = idx(0, 0), goal = idx(tx, tz);
  const dist = new Float64Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1);
  const heap = [[0, start]];
  dist[start] = 0;
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, k] = pop();
    if (k === goal) break;
    if (d > dist[k]) continue;
    const i = k % w, j = (k / w) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nk = nj * w + ni, len = Math.hypot(di, dj) * S, dh = H[nk] - H[k], slope = -dh / len;
      const c = len * (1 + 10 * Math.max(0, slope - 0.55) ** 2) + 40 * Math.max(0, dh);
      if (d + c < dist[nk]) {
        dist[nk] = d + c;
        prev[nk] = k;
        push([d + c, nk]);
      }
    }
  }
  const path = [];
  for (let k = goal; k >= 0; k = prev[k]) path.push(f.toLonLat(xa + (k % w) * S, za + ((k / w) | 0) * S));
  path.reverse();
  path[0] = [from.lon, from.lat];
  path[path.length - 1] = [to.lon, to.lat];
  return path;
}

// Spine: least-cost path from the summit to the OSM source, then the river, smoothed (sigma in m) and
// resampled at 1 m. rk[i] is the real river distance from the source (negative on the summit path).
// via: [[lat, lon], ...] points the summit path must pass (an icefall, a col), in order.
export function buildSpine(dem, river, summit, frame, { maxKm, sigma, pathSigma = sigma }, via = []) {
  const src = { lon: river.pts[0][0], lat: river.pts[0][1] };
  let pathLL;
  if (!via.length) pathLL = geoDist(summit.lon, summit.lat, src.lon, src.lat) < 1 ? [[summit.lon, summit.lat]] : downhillPath(dem, summit, src);
  else {
    pathLL = [[summit.lon, summit.lat]];
    let from = summit;
    for (const to of [...via.map(([lat, lon]) => ({ lon, lat })), src]) {
      pathLL.push(...downhillPath(dem, from, to).slice(1));
      from = to;
    }
  }
  let pathLen = 0;
  for (let i = 1; i < pathLL.length; i++) pathLen += geoDist(...pathLL[i - 1], ...pathLL[i]);
  // vertices with their real river distance, so rk follows the river's own arc length
  const ll = [...pathLL], vk = [-pathLen];
  for (let i = 1; i < pathLL.length; i++) vk.push(vk[i - 1] + geoDist(...pathLL[i - 1], ...pathLL[i]));
  vk[vk.length - 1] = 0;
  for (let t = 10; t <= Math.min(maxKm * 1000, river.length); t += 10) { ll.push(riverAt(river, t)); vk.push(t); }
  const vxz = ll.map(([lon, lat]) => frame.toXZ(lon, lat)), vS = arcLengths(vxz);
  const raw = resample(vxz, 2);
  // the summit path is a grid route, not a real channel: it gets pathSigma, blended into the river
  const rawS = arcLengths(raw), sA = smoothPolyline(raw, sigma / 2), sB = smoothPolyline(raw, pathSigma / 2);
  const sm = sA.map((p, i) => {
    const w = 1 - Math.min(Math.max((rawS[i] - pathLen) / 200, 0), 1);
    return [p[0] + (sB[i][0] - p[0]) * w, p[1] + (sB[i][1] - p[1]) * w];
  });
  const smS = arcLengths(sm);
  const rkOf = (a) => {
    let lo = 0, hi = vS.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (vS[m] <= a) lo = m; else hi = m; }
    return vk[lo] + (vk[hi] - vk[lo]) * Math.min(Math.max((a - vS[lo]) / Math.max(vS[hi] - vS[lo], 1e-9), 0), 1);
  };
  const total = Math.floor(smS.at(-1));
  const pts = [], rk = new Float64Array(total + 1);
  let j = 0;
  for (let u = 0; u <= total; u++) {
    while (j < smS.length - 2 && smS[j + 1] < u) j++;
    const f = (u - smS[j]) / Math.max(smS[j + 1] - smS[j], 1e-9);
    pts.push([sm[j][0] + (sm[j + 1][0] - sm[j][0]) * f, sm[j][1] + (sm[j + 1][1] - sm[j][1]) * f]);
    rk[u] = rkOf(rawS[j] + (rawS[j + 1] - rawS[j]) * f);
  }
  const at = (u) => {
    const i = Math.min(Math.max(Math.round(u), 0), total);
    const a = pts[Math.max(0, i - 3)], b = pts[Math.min(total, i + 3)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x: pts[i][0], z: pts[i][1], tx: (b[0] - a[0]) / L, tz: (b[1] - a[1]) / L };
  };
  return { pts, rk, length: total, pathLen, pathLL, at };
}

// The descent line from the DEM alone (descent.kind dem): least-cost downhill paths from the summit
// through the via points ([lat, lon]) to `to`, the way a glacier or an unmapped torrent runs. Without
// via and to, a steepest-descent flow line: down the lowest of the 8 neighbours on a 15 m lattice, and
// out of a pit by a least-cost path to the lowest ground within 600 m. Same shape as loadRiver.
export function demRiver(dem, summit, { via = [], to, maxKm = 40 } = {}) {
  const pts = [[summit.lon, summit.lat]];
  let from = summit;
  for (const [lat, lon] of [...via, ...(to ? [to] : [])]) {
    pts.push(...downhillPath(dem, from, { lon, lat }).slice(1));
    from = { lon, lat };
  }
  if (!via.length && !to) {
    const S = 15, f = localFrame(summit.lat, summit.lon);
    let x = 0, z = 0, len = 0, h = dem.elevation(summit.lon, summit.lat);
    const seen = new Set(['0,0']);
    while (len < maxKm * 1000) {
      let best = null;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx * S, nz = z + dz * S, nh = dem.elevation(...f.toLonLat(nx, nz));
        const drop = (h - nh) / Math.hypot(dx, dz);
        if (nh < h && !seen.has(`${nx},${nz}`) && (!best || drop > best.drop)) best = { x: nx, z: nz, h: nh, drop };
      }
      if (best) {
        len += Math.hypot(best.x - x, best.z - z);
        x = best.x; z = best.z; h = best.h;
        seen.add(`${x},${z}`);
        pts.push(f.toLonLat(x, z));
        continue;
      }
      // a pit: the lowest lattice point within 600 m, reached by a least-cost path
      let low = null;
      for (let dz = -600; dz <= 600; dz += S) for (let dx = -600; dx <= 600; dx += S) {
        if (dx * dx + dz * dz > 600 * 600) continue;
        const nh = dem.elevation(...f.toLonLat(x + dx, z + dz));
        if (nh < h - 1 && (!low || nh < low.h)) low = { x: x + dx, z: z + dz, h: nh };
      }
      if (!low) break;
      const [lon0, lat0] = f.toLonLat(x, z), [lon1, lat1] = f.toLonLat(low.x, low.z);
      const seg = downhillPath(dem, { lon: lon0, lat: lat0 }, { lon: lon1, lat: lat1 }).slice(1);
      for (const p of seg) { const [px, pz] = f.toXZ(...p); len += Math.hypot(px - x, pz - z); x = Math.round(px / S) * S; z = Math.round(pz / S) * S; }
      pts.push(...seg);
      h = low.h;
      for (const p of seg) { const [px, pz] = f.toXZ(...p); seen.add(`${Math.round(px / S) * S},${Math.round(pz / S) * S}`); }
    }
  }
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + geoDist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return { relation: null, pts, s, length: s.at(-1), label: 'Copernicus DEM descent line (least-cost downhill path)' };
}

// Lowest real ground across the bed (+-half of `across` m) every `step` m, lightly smoothed.
export function crossMinProfile(spine, elevGlobal, u0, u1, step, across) {
  const out = [];
  for (let u = u0; u <= u1 + 1e-9; u += step) {
    const p = spine.at(u);
    let m = Infinity;
    for (let k = -4; k <= 4; k++) m = Math.min(m, elevGlobal(p.x - p.tz * (k / 4) * across * 0.5, p.z + p.tx * (k / 4) * across * 0.5));
    out.push(m);
  }
  return smooth1d(out, 2);
}

// The valley floor: the first spine position past `after` where the mean slope over the next
// `window` m drops below `slope`. Returns the spine arc length.
export function findFloor(profile, step, { window, slope, after }) {
  const n = Math.round(window / step);
  for (let i = Math.round(after / step); i + n < profile.length; i++) {
    if ((profile[i] - profile[i + n]) / window < slope) return i * step;
  }
  return (profile.length - 1) * step;
}

// Chooses the stages: the first starts on the summit, the others are the windows with the most drop
// above the floor, picked greedily without overlap (at least `gap` m apart), then put in river order.
// group(u0, u1) names the stretch a window belongs to; at most `perGroup` windows per stretch, so the
// steepest valley does not take every stage.
// pick 'packed' instead lays the windows one after the other from the summit, `gap` m apart, as many
// as fit above the floor: for a short steep valley where the greedy pick takes the two steepest
// stretches in the middle and leaves only the flat bottom for the last stage (Bâlea, carpazi).
// end 'floor' fixes the last window to finish where the valley floor starts and picks the others
// greedily above it: for a valley whose steepest stretches are all high up, so the race still ends at
// the real bottom and not in a gorge above it (the Molinà at Calalzo, antelao).
export function chooseStages(profile, step, floorU, { count, length, gap, perGroup = Infinity, pick = 'steepest', end = null }, group = () => 0) {
  const n = Math.round(length / step), drop = (i) => profile[i] - profile[i + n];
  const picked = [0], last = Math.floor(floorU / step + 1e-9) - n;
  if (end === 'floor' && pick !== 'packed' && count > 1 && last >= n + gap / step) picked.push(last);
  if (pick === 'packed') {
    const g = Math.ceil(gap / step - 1e-9);
    for (let k = 1; k < count && (k * (n + g) + n) * step <= floorU; k++) picked.push(k * (n + g));
    return picked.map((i) => ({ u0: i * step, u1: (i + n) * step, drop: drop(i) }));
  }
  const free = (i) => picked.every((p) => i + n + gap / step <= p || i >= p + n + gap / step);
  const used = (g) => picked.filter((p) => group(p * step, (p + n) * step) === g).length;
  while (picked.length < count) {
    let best = -1, bd = -Infinity;
    for (let i = 0; (i + n) * step <= floorU; i++) if (free(i) && drop(i) > bd && used(group(i * step, (i + n) * step)) < perGroup) { bd = drop(i); best = i; }
    if (best < 0) break;
    picked.push(best);
  }
  return picked.sort((a, b) => a - b).map((i) => ({ u0: i * step, u1: (i + n) * step, drop: drop(i) }));
}

export { pointAt, arcLengths };
