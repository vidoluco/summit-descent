// Bakes one world from its config, tools/bake/worlds/<id>.json (docs/world-format.md, "Bake config").
// Usage: node tools/bake/index.mjs <id> [--mode short] [--out data/worlds] [--offline] [--no-index]
// Downloads missing DEM tiles into data/raw/dem/ and missing OSM answers into data/raw/osm/<id>/
// (--offline: use only what is on disk). Writes <out>/<id>/world.json, stage-<k>.bin per stage and
// backdrop.bin, then refreshes <out>/index.json. Worlds bake independently: several can run in
// parallel, each writes only its own folder (shared downloads land through private part files).
// Short mode (spec, decision of 27/10/2026): stages are real stretches at 1:1, chosen from the data
// above the valley floor, each in its own local frame with the origin at its start.
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { loadDem, localFrame, ensureTiles } from './dem.mjs';
import { loadRiver, loadWays, networkRiver, projectOnRiver } from './river.mjs';
import { findSummit, buildSpine, crossMinProfile, findFloor, chooseStages, demRiver } from './course.mjs';
import { loadConfig } from './config.mjs';
import { fetchOsm, osmDir } from './osm.mjs';
import { loadGlaciers, glacierAt } from './glaciers.mjs';
import { writeIndex } from './world-index.mjs';
import { gridBox, sampleGrid, blurGrid, carver, carveGrid, reshapeGrid } from './terrain.mjs';
import { smooth1d, lerp, clamp, segNearest, smoothstep, segmentIndex } from './geom.mjs';
import { loadFeatures, inPolygon } from './features.mjs';
import { bilinear } from '../../src/world/sample.js';
import { SPECIES } from '../../src/render/animals/registry.js';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const id = args.find((a, i) => !a.startsWith('--') && !['--mode', '--out'].includes(args[i - 1])) || 'dolomiti';
const mode = opt('--mode', 'short');
const outRoot = opt('--out', 'data/worlds');
const offline = args.includes('--offline');
if (mode !== 'short') throw new Error(`mode ${mode} is not baked yet (only short)`);
const cfg = loadConfig(id);
const S = cfg.short, STEP = S.pointStep;
const OSM = osmDir(cfg.id);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// deterministic random (mulberry32); the animals draw from their own stream per stage, so moving them
// never moves the rocks and water drops baked after them
const mulberry = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rnd = mulberry(0x60cc1a);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- data: DEM tiles, OSM ----------
const tileInfo = await ensureTiles(cfg.dem.tiles, 'data/raw/dem', { log, offline });
const coarse = tileInfo.filter((t) => t.res === 90).map((t) => t.tile), sea = tileInfo.filter((t) => !t.file).map((t) => t.tile);
if (coarse.length) log(`GLO-30 has no tile for ${coarse.join(', ')}: using GLO-90 (90 m) there`);
if (sea.length) log(`no DEM tile at all for ${sea.join(', ')}: open sea, elevation 0`);
const dem = await loadDem('data/raw/dem', { files: tileInfo.filter((t) => t.file).map((t) => t.file), sea, log });
if (!offline) {
  const failed = await fetchOsm(cfg, { log });
  if (failed.length) log(`OSM not fetched: ${failed.join(', ')}`);
}
const summit = findSummit(dem, cfg.summit);
log(`summit ${summit.lat.toFixed(5)} ${summit.lon.toFixed(5)} at ${summit.h.toFixed(0)} m`);
const D = cfg.descent;
const river = D.kind === 'osm-relation' ? loadRiver(`${OSM}/river.json`, { name: D.name, relation: D.relation, maxGap: D.maxGap })
  : D.kind === 'osm-ways' ? loadWays(`${OSM}/river.json`, D.ways, { maxGap: D.maxGap })
  : D.kind === 'osm-network' ? networkRiver(`${OSM}/river.json`, dem.elevation, D.start ? { lat: D.start[0], lon: D.start[1] } : summit, { prefer: D.prefer, maxKm: S.spine.maxKm + 5, jump: D.jump })
  : demRiver(dem, summit, { via: D.via, to: D.to, maxKm: S.spine.maxKm + 5 });
log(`descent line: ${river.label}, ${(river.length / 1000).toFixed(1)} km, ${river.pts.length} nodes${river.jumps ? `, ${river.jumps} gaps bridged` : ''}`);
// osm.nameTags: which OSM name to show, in order (['name:en', 'name'] where the local name is not Latin)
const nameTags = cfg.osm.nameTags || ['name'];
const glaciers = cfg.osm.glaciers ? loadGlaciers(`${OSM}/glaciers.json`, nameTags) : null;
if (cfg.osm.glaciers) log(glaciers ? `glaciers: ${glaciers.length} outlines` : 'glaciers: no cache, ice only by altitude');

// One global frame for the whole world: origin at the summit, x east, z south, y real altitude.
const frame = localFrame(summit.lat, summit.lon);
const elev = (x, z) => dem.elevation(...frame.toLonLat(x, z));
const spine = buildSpine(dem, river, summit, frame, S.spine, D.summitVia);
log(`spine ${(spine.length / 1000).toFixed(1)} km (summit path ${spine.pathLen.toFixed(0)} m)`);

// ---------- valley floor and stage choice ----------
// the profile is made non-increasing first: bridges and other bumps in the surface model
// must not pass for a flat stretch
const prof = crossMinProfile(spine, elev, 0, spine.length, STEP, S.bedAcross);
for (let i = 1; i < prof.length; i++) prof[i] = Math.min(prof[i], prof[i - 1]);
const floorU = findFloor(prof, STEP, S.floor);
const floorKm = spine.rk[Math.round(floorU)] / 1000;
log(`valley floor at river km ${floorKm.toFixed(1)}, ${prof[Math.round(floorU / STEP)].toFixed(0)} m${Math.round(floorU / STEP) >= prof.length - 1 ? ' (no stretch flatter than the threshold within spine.maxKm: the race stops where the line read ends)' : ''}`);
// A landmark is a stretch by river km (`km`) or by real bed altitude (`alt`, for worlds whose stretches
// are easier to tell by height: glacier, icefall, moraine).
const altAt = (u) => prof[Math.min(prof.length - 1, Math.round(u / STEP))];
const landmarkOf = (rk0, rk1, a0, a1) => {
  let best = null, bo = 0;
  for (const lm of cfg.landmarks) {
    const o = lm.km ? Math.min(rk1, lm.km[1] * 1000) - Math.max(rk0, lm.km[0] * 1000) : Math.min(a0, lm.alt[1]) - Math.max(a1, lm.alt[0]);
    if (o > bo) { bo = o; best = lm; }
  }
  return best;
};
const picks = chooseStages(prof, STEP, floorU, S.stages, (u0, u1) => landmarkOf(spine.rk[Math.round(u0)], spine.rk[Math.round(u1)], altAt(u0), altAt(u1))?.id);
if (picks.length < 2) throw new Error('not enough steep river above the valley floor for two stages');
const usedNames = new Map();
const stages = picks.map((pk, k) => {
  const rk0 = spine.rk[pk.u0], rk1 = spine.rk[pk.u1];
  const lm = landmarkOf(rk0, rk1, altAt(pk.u0), altAt(pk.u1)) || { id: `stage${k}`, biome: cfg.defaultBiome || 'montane', names: [[`Tappa ${k + 1}`, `Stage ${k + 1}`]] };
  const n = usedNames.get(lm.id) || 0;
  usedNames.set(lm.id, n + 1);
  const [it, en] = lm.names[Math.min(n, lm.names.length - 1)];
  return { ...pk, k, rk0, rk1, lm, sid: n ? `${lm.id}-${n + 1}` : lm.id, it, en, biome: lm.biome, ...cfg.biomes[lm.biome] };
});
// names must be unique: a landmark with fewer names than stages gets numbered
for (const lm of cfg.landmarks) {
  const group = stages.filter((s) => s.lm === lm);
  if (group.length > lm.names.length) group.forEach((s, i) => { s.it = `${lm.names[0][0]} ${i + 1}`; s.en = `${lm.names[0][1]} ${i + 1}`; });
}
log('stages: ' + stages.map((s) => `${s.sid} km ${(s.rk0 / 1000).toFixed(1)}-${(s.rk1 / 1000).toFixed(1)} drop ${s.drop.toFixed(0)} m`).join(', '));

// ---------- per stage: course, bed, offset ----------
// Bed profile from the lowest real ground across the bed (`low`, every `dx` m): strictly descending,
// never more than LIFT above the real ground, with the slope kept between a floor and a ceiling set by
// the local mean slope. A plain running minimum would turn every bump of the surface model (trees,
// bridges) into a long flat pool ending in a cliff; here a bump becomes a gentle trench and a cliff
// becomes a ramp cut a little into the ground above it.
const LIFT = 1;
function bedProfile(low, dx) {
  const n = low.length, s = smooth1d(low, 2).map((v, i) => Math.min(v, low[i] + LIFT)), W = 30;
  // local mean slope over +-300 m of the running minimum, which bumps do not flatten
  const c = s.slice();
  for (let i = 1; i < n; i++) c[i] = Math.min(c[i], c[i - 1]);
  const m = c.map((_, i) => (c[Math.max(0, i - W)] - c[Math.min(n - 1, i + W)]) / ((Math.min(n - 1, i + W) - Math.max(0, i - W)) * dx));
  const smin = m.map((v) => clamp(0.35 * v, 0.004, 0.03)), smax = m.map((v) => Math.max(1.8 * v, 0.15));
  const U = s.slice();
  for (let i = 1; i < n; i++) U[i] = Math.min(s[i], U[i - 1] - smin[i] * dx);
  const B = U.slice();
  for (let i = n - 2; i >= 0; i--) B[i] = Math.min(U[i], B[i + 1] + smax[i] * dx);
  const out = B.map((_, i) => {
    let a = 0, k = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { a += B[j]; k++; }
    return Math.min(a / k, low[i] + LIFT);
  });
  for (let i = 1; i < n; i++) out[i] = Math.min(out[i], out[i - 1] - 0.01);
  return out;
}
// Bed half width at river km `km` (negative on the summit path). With short.width the real stream sets it: a
// table [[km, hw], ...] read piecewise linearly, so the stream is narrowest at its source and widens downstream
// as it gathers water, with a slow wiggle of +-`wiggle`. Without it, the stage biome's [min, max] band.
const W8 = S.width;
function widthAt(st, km, v) {
  const wave = Math.sin((2 * Math.PI * v) / 430 + st.k * 1.7);
  if (!W8) return st.hw[0] + (st.hw[1] - st.hw[0]) * (0.5 + 0.5 * wave);
  const t = W8.km, j = t.findIndex((r) => r[0] > km);
  const base = j < 0 ? t.at(-1)[1] : j === 0 ? t[0][1] : lerp(t[j - 1][1], t[j][1], (km - t[j - 1][0]) / (t[j][0] - t[j - 1][0]));
  return base * (1 + (W8.wiggle ?? 0.1) * wave);
}
for (const st of stages) {
  const e0 = st.u0 - Math.floor(Math.min(st.u0, S.extend) / STEP) * STEP, e1 = Math.min(st.u1 + S.extend, spine.length - 1);
  const line = [];
  for (let u = e0; u <= e1 + 1e-9; u += STEP) {
    const p = spine.at(u), v = u - st.u0, rk = spine.rk[Math.round(u)];
    line.push({ u, x: p.x, z: p.z, tx: p.tx, tz: p.tz, nx: -p.tz, nz: p.tx, hw: widthAt(st, rk / 1000, v), bank: st.bank, bankW: st.bankW, rk });
  }
  // real bed: lowest ground across the bed, smoothed, strictly descending
  let bed = line.map((p) => {
    let m = Infinity;
    for (let i = -4; i <= 4; i++) m = Math.min(m, elev(p.x + p.nx * (i / 4) * S.bedAcross * 0.5, p.z + p.nz * (i / 4) * S.bedAcross * 0.5));
    return m;
  });
  const sm = bedProfile(bed, STEP);
  const i0 = Math.round((st.u0 - e0) / STEP), N = Math.round((st.u1 - st.u0) / STEP) + 1;
  // A slot gorge (biome slot {depth, km?, ramp?}): the 30 m DEM fills a gorge a few metres wide, so its lowest
  // ground is the rim. The bed is cut `depth` m deeper over the river km window (default the whole line), ramped in
  // over `ramp` m (150), and the biome's short bankW turns the sides into walls. Out of the gorge the cut comes
  // back up only as fast as the bed falls, so the bed still drops 0.6 % or more (a flat stretch ends the gorge
  // early, as below Zmutt).
  if (st.slot) {
    const k0 = (st.slot.km?.[0] ?? line[0].rk / 1000) * 1000, k1 = (st.slot.km?.[1] ?? line.at(-1).rk / 1000) * 1000;
    const cut = line.map((p) => (p.rk > k1 ? 0 : st.slot.depth * smoothstep((p.rk - k0) / (st.slot.ramp ?? 150))));
    for (let i = cut.length - 2; i >= 0; i--) cut[i] = Math.max(0, Math.min(cut[i], cut[i + 1] + sm[i] - sm[i + 1] - 0.006 * STEP));
    cut.forEach((d, i) => { sm[i] -= d; });
  }
  st.delta = new Float64Array(line.length); // change of the ground height along the line: the waterfalls' rock steps
  st.falls = [];
  for (const wf of cfg.waterfalls || []) {
    const [wx, wz] = frame.toXZ(wf.lon, wf.lat);
    const c = line.reduce((bi, p, i) => (Math.hypot(p.x - wx, p.z - wz) < Math.hypot(line[bi].x - wx, line[bi].z - wz) ? i : bi), 0);
    if (Math.hypot(line[c].x - wx, line[c].z - wz) > 80) continue; // not on this stage's line
    // the 30 m DEM smooths a fall into a steep ramp: over a window around the real point the bed keeps its drop
    // but takes `steps` as near-vertical steps 30 m apart, with a gentler run between (at least 2 %); the same
    // change of height goes into the ground across the valley, so the fall is a rock step, not a lump
    const ns = wf.steps.length, at = wf.steps.map((_, k) => c + Math.round((k - (ns - 1) / 2) * 3));
    const a = Math.max(1, at[0] - 8), b = Math.min(line.length - 1, at.at(-1) + 9), D = sm[a] - sm[b];
    const H = wf.steps.reduce((s, h) => s + h, 0), k = Math.min(1, Math.max(0, D - 0.02 * (b - a) * STEP) / H);
    for (let i = a; i <= b; i++) {
      const y = sm[a] - (D - H * k) * ((i - a) / (b - a)) - wf.steps.reduce((s, h, n) => s + (i > at[n] ? h * k : 0), 0);
      st.delta[i] = y - sm[i];
      sm[i] = y;
    }
    st.falls.push({ name: wf.name, at, drop: wf.steps.map((h) => r2(h * k)) });
  }
  // local frame: origin at the first course point, on its bed; y is relative to that bed
  const o = line[i0], alt = sm[i0];
  st.offset = { x: r2(o.x), y: r2(alt), z: r2(o.z) };
  st.line = line.map((p, i) => ({ ...p, x: p.x - st.offset.x, z: p.z - st.offset.z, y: sm[i] - st.offset.y, real: sm[i] }));
  st.i0 = i0;
  st.N = N;
  st.pts = st.line.slice(i0, i0 + N);
  st.elevL = (x, z) => elev(x + st.offset.x, z + st.offset.z) - st.offset.y;
  const lonlat = frame.toLonLat(o.x, o.z);
  st.origin = { lat: +lonlat[1].toFixed(6), lon: +lonlat[0].toFixed(6), alt: r2(alt) };
}

// ---------- branches ----------
function bezier(a, ta, b, tb, k) {
  const c = Math.hypot(b.x - a.x, b.z - a.z), p1 = [a.x + ta[0] * c * k, a.z + ta[1] * c * k], p2 = [b.x - tb[0] * c * k, b.z - tb[1] * c * k];
  const fine = [];
  for (let i = 0; i <= 400; i++) {
    const t = i / 400, m = 1 - t;
    fine.push([m * m * m * a.x + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * b.x, m * m * m * a.z + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * b.z]);
  }
  return fine;
}
function resampleXZ(fine, step) {
  const s = [0];
  for (let i = 1; i < fine.length; i++) s.push(s[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]));
  const n = Math.max(2, Math.round(s.at(-1) / step)), out = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * s.at(-1);
    while (j < s.length - 2 && s[j + 1] < t) j++;
    const f = (t - s[j]) / Math.max(s[j + 1] - s[j], 1e-9);
    out.push({ x: lerp(fine[j][0], fine[j + 1][0], f), z: lerp(fine[j][1], fine[j + 1][1], f), arc: t });
  }
  return { pts: out, length: s.at(-1) };
}
const helpers = (st) => {
  const pts = st.pts, N = st.N;
  const yAtU = (v) => {
    const f = clamp(v / STEP, 0, N - 1), i = Math.min(Math.floor(f), N - 2);
    return lerp(pts[i].y, pts[i + 1].y, f - i);
  };
  const pAtU = (v) => {
    const f = clamp(v / STEP, 0, N - 1), i = Math.min(Math.floor(f), N - 2), t = f - i, a = pts[i], b = pts[i + 1];
    return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), nx: lerp(a.nx, b.nx, t), nz: lerp(a.nz, b.nz, t) };
  };
  const distTo = (x, z, lo = 0, hi = st.line.length - 1) => {
    let best = Infinity;
    for (let i = lo; i < hi; i++) {
      const n = segNearest(st.line[i].x, st.line[i].z, st.line[i + 1].x, st.line[i + 1].z, x, z);
      if (n.d2 < best) best = n.d2;
    }
    return Math.sqrt(best);
  };
  return { yAtU, pAtU, distTo };
};
// Near the forks a branch runs inside the main channel: there it takes the main bed height under it,
// so the carved grid and the branch points agree. Never climbs.
function fitEnds(st, b) {
  const pts = st.pts, lo = Math.max(0, b.from - 3), hi = Math.min(st.N - 2, b.to + 3);
  for (const p of b.points) {
    let best = { d2: Infinity };
    for (let i = lo; i <= hi; i++) {
      const n = segNearest(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z, p.x, p.z);
      if (n.d2 < best.d2) best = { ...n, i };
    }
    const d = Math.sqrt(best.d2), hw = lerp(pts[best.i].hw, pts[best.i + 1].hw, best.t);
    const w = clamp(1 - (d - hw) / b.bankW, 0, 1), ym = lerp(pts[best.i].y, pts[best.i + 1].y, best.t);
    p.y = lerp(p.y, ym, w);
  }
  const bp = b.points;
  bp[0].y = pts[b.from].y; bp.at(-1).y = pts[b.to].y;
  for (let i = 1; i < bp.length; i++) bp[i].y = Math.min(bp[i].y, bp[i - 1].y);
  for (let i = bp.length - 2; i >= 0; i--) bp[i].y = Math.max(bp[i].y, bp[i + 1].y);
  return b;
}

// A branch must lie on real ground at or above its bed (the carve only lowers the terrain). The
// points next to the forks sit in the main channel, which is carved anyway.
const fillOf = (st, bp) => Math.max(...bp.slice(3, -3).map((p) => p.y - st.elevL(p.x, p.z)));
const why = {}, MAX_FALL = 30, CP_EVERY = 60; // course points between checkpoints
const reject = (r) => { why[r] = (why[r] || 0) + 1; };

// The arms scale with the stream: on a world with short.width a shortcut is a little narrower than the main bed
// and the safe arm a little wider (a side channel of the same stream), else the fixed 9 and 22 m.
const meanHw = (st) => st.pts.reduce((s, p) => s + p.hw, 0) / st.pts.length;
// (and their banks are as low as the main bed's: a brook, not a ditch)
const armHw = (st, kind) => (!W8 ? (kind === 'shortcut' ? 9 : 22) : kind === 'shortcut' ? Math.max(4.5, 0.85 * meanHw(st)) : 1.4 * meanHw(st));

function makeShortcut(st) {
  const { yAtU, distTo } = helpers(st), pts = st.pts, N = st.N, hwB = r2(armHw(st, 'shortcut'));
  const cands = [];
  // a checkpoint that falls inside the branch moves to the nearer fork: it must stay 300-900 m from its neighbours
  const cpOk = (i, j) => !Array.from({ length: Math.ceil(N / CP_EVERY) }, (_, n) => n * CP_EVERY).some((c) => c > i && c < j && Math.min(c - i, j - c) > 25);
  for (let i = 6; i < N - 26; i++) for (let j = i + 20; j <= Math.min(i + 80, N - 6); j++) {
    const a = pts[i], b = pts[j], chord = Math.hypot(b.x - a.x, b.z - a.z), arc = (j - i) * STEP;
    if (arc - chord >= 50 && cpOk(i, j)) cands.push({ i, j, save: arc - chord });
  }
  cands.sort((p, q) => q.save - p.save || p.i - q.i);
  for (const c of cands.slice(0, 400)) {
    const a = pts[c.i], b = pts[c.j];
    const path = resampleXZ(bezier(a, [a.tx, a.tz], b, [b.tx, b.tz], 0.08), STEP);
    if (path.length > (c.j - c.i) * STEP - 50) { reject('not shorter'); continue; }
    const mid = path.pts.filter((p) => p.arc >= 60 && p.arc <= path.length - 60);
    if (!mid.length || !(Math.min(...mid.map((p) => distTo(p.x, p.z))) > Math.max(a.hw, b.hw) + hwB + 10)) { reject('too close'); continue; }
    const Lb = path.length, lipIdx = path.pts.findIndex((p) => p.arc > Lb * 0.62) - 1;
    // above the lip the branch keeps part of its height; k sets how much, for a fall of 8-30 m
    let bp, fall;
    for (let k = 0.65; k <= 1.0001; k += 0.05) {
      bp = path.pts.map((p, n) => ({ x: p.x, z: p.z, hw: hwB, y: n <= lipIdx ? yAtU(c.i * STEP + p.arc * k) : yAtU(c.j * STEP - (Lb - p.arc)) }));
      bp[0].y = pts[c.i].y; bp.at(-1).y = pts[c.j].y;
      fall = bp[lipIdx].y - bp[lipIdx + 1].y;
      if (fall <= MAX_FALL) break;
    }
    if (fall < 8 || fall > MAX_FALL) { reject('fall'); continue; }
    if (fillOf(st, bp) > 1) { reject('above ground'); continue; }
    const br = fitEnds(st, { from: c.i, to: c.j, kind: 'shortcut', points: bp, lip: lipIdx, bank: W8 ? 1.6 : 4, bankW: 10, main: (c.j - c.i) * STEP });
    br.fall = bp[lipIdx].y - bp[lipIdx + 1].y;
    return br;
  }
  return null;
}

// An arm offset to the inside of a tight bend folds over itself (a cusp, a loop): no turn over 35 deg per point
const kinked = (bp) => bp.slice(2).some((p, n) => {
  const a = bp[n], b = bp[n + 1], t = Math.atan2(b.z - a.z, b.x - a.x), u = Math.atan2(p.z - b.z, p.x - b.x);
  return Math.abs(Math.atan2(Math.sin(u - t), Math.cos(u - t))) > (35 * Math.PI) / 180;
});

function makeSafe(st) {
  const { yAtU, pAtU, distTo } = helpers(st), pts = st.pts, N = st.N, span = 46, hwS = r2(armHw(st, 'safe'));
  let best = null;
  for (let i = 8; i + span < N - 8; i += 2) for (const A of [70, 85]) for (const sg of [1, -1]) {
    const j = i + span, fine = [];
    for (let n = 0; n <= 400; n++) {
      const t = n / 400, q = pAtU((i + t * span) * STEP), off = A * sg * Math.sin(Math.PI * t) ** 2;
      fine.push([q.x + q.nx * off, q.z + q.nz * off]);
    }
    const path = resampleXZ(fine, STEP);
    const bp = path.pts.map((p) => ({ x: p.x, z: p.z, hw: hwS, y: yAtU((i + (p.arc / path.length) * span) * STEP) }));
    bp[0].y = pts[i].y; bp.at(-1).y = pts[j].y;
    if (fillOf(st, bp) > 1 || kinked(bp)) continue;
    // the arm must keep clear of the rest of the course (meanders)
    const far = bp.filter((p, n) => n > 8 && n < bp.length - 8);
    if (far.some((p) => distTo(p.x, p.z, 0, st.i0 + i - 3) < 60 || distTo(p.x, p.z, st.i0 + j + 3) < 60)) continue;
    const cut = bp.reduce((s, p) => s + Math.max(0, st.elevL(p.x, p.z) - p.y), 0) / bp.length;
    if (!best || cut < best.cut) best = { from: i, to: j, kind: 'safe', points: bp, bank: W8 ? 1.2 : 3, bankW: 20, side: sg, cut, main: span * STEP };
  }
  return best && fitEnds(st, best);
}
// no branch through the walls of a slot gorge or across a rock step, and other gorges come last: a real gorge
// has one channel (until 28/10/2026 gorges came first, which put the shortcut beside the Cascata delle Pile)
const rank = (s) => (s.biome === 'gorge' ? 1 : 0);
// cfg.branches {shortcut?, safe?}: landmark ids that may take each arm (Antelao: the shortcut in the Molinà, not
// as a 25 m fall in the braided gravel bed of the Val d'Oten, which takes the safe arm)
const branchable = (s, kind) => !s.slot && !s.falls.length && (!cfg.branches?.[kind] || cfg.branches[kind].includes(s.lm.id));
const shortcutOrder = stages.slice(1).filter((s) => branchable(s, 'shortcut')).sort((a, b) => rank(a) - rank(b) || b.drop - a.drop);
let shortcutStage = null;
for (const st of shortcutOrder) {
  const b = makeShortcut(st);
  if (b) { st.branches = [b]; shortcutStage = st; break; }
  log(`no shortcut in ${st.sid}: ${JSON.stringify(why)}`);
  for (const k in why) delete why[k];
}
if (!shortcutStage && cfg.requireShortcut !== false) throw new Error('no stage has a bend good for a shortcut (set requireShortcut false to bake without one)');
if (shortcutStage) log(`shortcut in ${shortcutStage.sid}: course ${shortcutStage.branches[0].from}-${shortcutStage.branches[0].to}, waterfall ${shortcutStage.branches[0].fall.toFixed(1)} m`);
let safeStage = null;
{
  let best = null;
  for (const st of stages.slice(1).filter((s) => branchable(s, 'safe'))) {
    if (st === shortcutStage) continue;
    const b = makeSafe(st);
    if (b && (!best || b.cut < best.b.cut)) best = { st, b };
  }
  if (best) {
    safeStage = best.st;
    safeStage.branches = [best.b];
    log(`safe arm in ${safeStage.sid}: course ${best.b.from}-${best.b.to}, mean cut ${best.b.cut.toFixed(1)} m`);
  } else log('no stage has room for a safe arm');
}
for (const st of stages) st.branches ||= [];

// ---------- grids ----------
for (const st of stages) {
  const all = [...st.line, ...st.branches.flatMap((b) => b.points)];
  const hm = gridBox(all, S.corridor, S.gridStep);
  const base = reshapeGrid(hm, blurGrid(hm, sampleGrid(hm, st.elevL), S.blur), st.line, st.delta);
  const main = carver(st.line, 80);
  const bc = st.branches.map((b) => carver(b.points.map((p) => ({ ...p, bank: b.bank, bankW: b.bankW })), b.points[0].hw + b.bankW + 2));
  const { grid, min, max } = carveGrid(hm, base, main, bc);
  st.meta = hm;
  st.grid = grid;
  st.base = base;
  st.minH = min;
  st.maxH = max;
  st.groundAt = (x, z) => bilinear(hm, grid, x, z);
  log(`${st.sid}: grid ${hm.w} x ${hm.h} at ${hm.step} m, ${min.toFixed(0)} to ${max.toFixed(0)} m local`);
}

// ---------- what people built, and the lakes, on each stage grid ----------
// Lakes: the ring and its level (the median ground inside; the ground under the ring goes 0.6 m below it, so the
// flat sheet the renderer lays there is not pierced). Buildings: oriented boxes on the ground, none in the bed or
// on a branch. Roads and cable cars: lines on the ground every 8 m, split where they cross the bed (a bridge).
const feats = loadFeatures(`${OSM}/features.json`, frame.toXZ, nameTags);
if (feats) log(`features: ${feats.lakes.length} lakes, ${feats.buildings.length} buildings, ${feats.roads.length} roads, ${feats.cables.length} cable cars`);
for (const st of stages) {
  st.features = { lakes: [], buildings: [], roads: [], cables: [] };
  if (!feats) continue;
  const m = st.meta, x1 = m.x0 + (m.w - 1) * m.step, z1 = m.z0 + (m.h - 1) * m.step;
  const inGrid = (x, z, pad = 0) => x >= m.x0 + pad && z >= m.z0 + pad && x <= x1 - pad && z <= z1 - pad;
  const loc = ([x, z]) => [x - st.offset.x, z - st.offset.z];
  const near = segmentIndex(st.line.map((p) => [p.x, p.z]), 32), arms = st.branches.flatMap((b) => b.points);
  // metres past the bed edge (negative inside it), main line or branch
  const past = (x, z) => {
    const n = near(x, z, 300);
    let d = n ? n.d - lerp(st.line[n.seg].hw, st.line[n.seg + 1].hw, n.t) : 300;
    for (const p of arms) d = Math.min(d, Math.hypot(p.x - x, p.z - z) - p.hw);
    return d;
  };
  for (const l of feats.lakes) {
    const ring = l.ring.map(loc);
    if (!ring.some(([x, z]) => inGrid(x, z))) continue;
    if (st.line.some((p) => inPolygon(ring, p.x, p.z))) { log(`${st.sid}: the line runs through the lake ${l.name}: not drawn`); continue; }
    const area = Math.abs(ring.reduce((a, [x, z], i) => { const [u, v] = ring[(i + 1) % ring.length]; return a + x * v - u * z; }, 0)) / 2;
    if (area < 400) continue; // a pond
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const [x, z] of ring) { i0 = Math.min(i0, x); i1 = Math.max(i1, x); j0 = Math.min(j0, z); j1 = Math.max(j1, z); }
    const nodes = [];
    for (let j = Math.max(0, Math.ceil((j0 - m.z0) / m.step)); j <= Math.min(m.h - 1, Math.floor((j1 - m.z0) / m.step)); j++)
      for (let i = Math.max(0, Math.ceil((i0 - m.x0) / m.step)); i <= Math.min(m.w - 1, Math.floor((i1 - m.x0) / m.step)); i++)
        if (inPolygon(ring, m.x0 + i * m.step, m.z0 + j * m.step)) nodes.push(j * m.w + i);
    if (nodes.length < 6) continue;
    const level = nodes.map((k) => st.grid[k]).sort((a, b) => a - b)[Math.floor(nodes.length / 2)];
    for (const k of nodes) st.grid[k] = Math.min(st.grid[k], level - 0.6);
    st.features.lakes.push({ name: l.name, level: r2(level), area: Math.round(area), ring: ring.map(([x, z]) => [r2(x), r2(z)]) });
  }
  for (const b of feats.buildings) {
    const [x, z] = loc([b.x, b.z]);
    if (!inGrid(x, z, 12) || past(x, z) < Math.max(b.w, b.d) / 2 + 6) continue;
    st.features.buildings.push({ kind: b.kind, ...(b.name ? { name: b.name } : {}), x: r2(x), y: r2(st.groundAt(x, z)), z: r2(z), w: r2(b.w), d: r2(b.d), rot: Math.round(b.rot * 1000) / 1000, ...(b.levels ? { levels: b.levels } : {}) });
  }
  for (const [key, list] of [['roads', feats.roads], ['cables', feats.cables]]) for (const r of list) {
    let cur = [];
    const flush = () => { if (cur.length >= 2) st.features[key].push({ ...(r.kind ? { kind: r.kind } : {}), ...(r.name ? { name: r.name } : {}), points: cur }); cur = []; };
    const pts = r.line.map(loc);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
      for (let k = i ? 1 : 0; k <= n; k++) {
        const x = lerp(ax, bx, k / n), z = lerp(az, bz, k / n);
        // a cable car spans the valley: only its ends stand on the ground
        if (!inGrid(x, z, 4) || (key === 'roads' && past(x, z) < 2)) { flush(); continue; }
        cur.push([r2(x), r2(st.groundAt(x, z)), r2(z)]);
      }
    }
    flush();
  }
  const f = st.features;
  if (f.lakes.length + f.buildings.length + f.roads.length + f.cables.length) log(`${st.sid}: ${f.lakes.length} lakes${f.lakes.length ? ` (${f.lakes.map((l) => l.name).join(', ')})` : ''}, ${f.buildings.length} buildings, ${f.roads.length} roads, ${f.cables.length} cable cars`);
}

// backdrop: real ground in the global frame, the stage grid wherever one covers the point
const allGlobal = stages.flatMap((st) => [
  { x: st.meta.x0 + st.offset.x, z: st.meta.z0 + st.offset.z },
  { x: st.meta.x0 + (st.meta.w - 1) * st.meta.step + st.offset.x, z: st.meta.z0 + (st.meta.h - 1) * st.meta.step + st.offset.z },
]);
const bd = gridBox(allGlobal, S.backdropMargin, S.backdropStep);
const inStage = (st, x, z) => {
  const m = st.meta, lx = x - st.offset.x, lz = z - st.offset.z;
  return lx >= m.x0 && lz >= m.z0 && lx <= m.x0 + (m.w - 1) * m.step && lz <= m.z0 + (m.h - 1) * m.step;
};
const backdrop = sampleGrid(bd, (x, z) => {
  for (const st of stages) if (inStage(st, x, z)) return st.groundAt(x - st.offset.x, z - st.offset.z) + st.offset.y;
  return elev(x, z);
});
log(`backdrop grid ${bd.w} x ${bd.h} at ${bd.step} m`);

// ---------- gameplay features, per stage ----------
const groups = Object.entries(cfg.animals.kinds);
const banks = { '-1': 0, 1: 0 }; // walkers on the left (-1) and right bank so far, over the whole world
for (const st of stages) {
  const N = st.N, pts = st.pts, ga = st.groundAt;
  const inBranch = (i) => st.branches.some((b) => i > b.from && i < b.to);
  const nearBranch = (x, z, extra) => st.branches.some((b) => b.points.some((p) => Math.hypot(p.x - x, p.z - z) < p.hw + extra));
  const at = (i, off) => {
    const p = pts[i], x = p.x + p.nx * off, z = p.z + p.nz * off;
    return { x: r2(x), y: r2(ga(r2(x), r2(z))), z: r2(z) };
  };

  // every ~600 m, the first at the start; one inside a branch moves to the nearer fork
  const cps = [];
  for (let i = 0; i < N - 30; i += CP_EVERY) {
    let c = i;
    for (const b of st.branches) if (c > b.from && c < b.to) c = c - b.from <= b.to - c ? b.from : b.to;
    if (!cps.length || c - cps.at(-1) >= 35) cps.push(c);
  }
  st.checkpoints = cps;

  const zones = [];
  const iceEnd = pts.findLastIndex((p) => p.real >= S.iceAbove);
  if (!glaciers) {
    if (iceEnd >= 5) zones.push({ kind: 'ice', from: 0, to: iceEnd });
  } else {
    // ice: above iceAbove (snowfield) or inside a glacier outline (glacier, icefall); runs of 5+ points
    const on = pts.map((p, i) => {
      const g = glacierAt(glaciers, ...frame.toLonLat(p.x + st.offset.x, p.z + st.offset.z));
      return g ? { glacier: g } : iceEnd >= 5 && i <= iceEnd ? { glacier: null } : null;
    });
    for (let i = 0; i < N;) {
      if (!on[i]) { i++; continue; }
      let j = i;
      while (j + 1 < N && on[j + 1]) j++;
      if (j - i >= 5) {
        // the glacier under most of the run names the zone
        const count = new Map();
        for (const o of on.slice(i, j + 1)) if (o.glacier) count.set(o.glacier, (count.get(o.glacier) || 0) + 1);
        const g = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
        zones.push({ kind: 'ice', from: i, to: j, ...(g ? { glacier: g.name || g.id, ...(g.icefall ? { icefall: true } : {}) } : {}) });
      }
      i = j + 1;
    }
  }
  for (const [bi, b] of st.branches.entries()) if (b.kind === 'shortcut') zones.push({ kind: 'waterfall', from: b.from, to: b.to, branch: bi });
  // a real waterfall on the main course: its steps, as course indices (the drop is between at and at + 1)
  for (const f of st.falls) {
    const at = f.at.map((i) => i - st.i0);
    if (at[0] < 3 || at.at(-1) > N - 4) continue; // on the extension, not played
    zones.push({ kind: 'waterfall', from: at[0] - 3, to: at.at(-1) + 3, name: f.name, steps: at.map((i, n) => ({ at: i, drop: f.drop[n] })) });
  }
  st.zones = zones;

  const obstacles = [];
  // A boulder in the bed of radius r at `lat` m off the centre, `side` the bank it leans to: it never fills more
  // than a quarter of a narrow bed and leaves the far side free for a drop to pass (the sim bot passes a rock with
  // r + its radius + 2.5 m of clearance inside hw - its radius - 1.5 m: 5.8 m with a mass-4 drop)
  const boulder = (i, side, f, r) => {
    const hw = pts[i].hw;
    r = Math.min(r, 0.25 * hw);
    const lo = clamp(r + 5.8 - hw, 0, hw - r - 0.4);
    return { o: at(i, side * lerp(lo, hw - r - 0.4, f)), r: r2(r) };
  };
  if (st.biome === 'gorge' || st.branches.some((b) => b.kind === 'shortcut')) {
    // boulders all along the main bed of a gorge or of the stage with the shortcut
    for (let n = 0; n < 14; n++) {
      const i = Math.round(4 + ((N - 9) * (n + rnd() * 0.6)) / 14);
      if (st.branches.some((b) => Math.abs(i - b.from) < 3 || Math.abs(i - b.to) < 3)) continue;
      const u = rnd() * 2 - 1, { o, r } = boulder(i, u < 0 ? -1 : 1, Math.min(1, Math.abs(u) / 0.6) * 0.6, 1.2 + rnd() * 1.6);
      if (nearBranch(o.x, o.z, 2)) continue;
      obstacles.push({ kind: 'rock', ...o, r, course: i });
    }
  }
  for (const b of st.branches) {
    if (b.kind === 'safe') {
      // the main arm beside the safe branch is the rocky one
      for (let n = 0; n < 6; n++) {
        const i = Math.round(b.from + 4 + ((b.to - b.from - 8) * (n + 0.5)) / 6);
        const { o, r } = boulder(i, n % 2 ? 1 : -1, 0.2 + rnd() * 0.4, 1.0 + rnd() * 1.2);
        if (nearBranch(o.x, o.z, 2)) continue;
        obstacles.push({ kind: 'rock', ...o, r, course: i });
      }
    }
  }

  const water = [];
  for (let i = 8, n = 0; i < N - 5; i += 9, n++) {
    const o = at(i, (n % 2 ? 1 : -1) * pts[i].hw * (0.15 + 0.35 * rnd()));
    if (obstacles.some((r) => Math.hypot(r.x - o.x, r.z - o.z) < r.r + 3)) continue;
    water.push({ ...o, course: i });
  }
  for (const [bi, b] of st.branches.entries()) {
    const step = b.kind === 'safe' ? 8 : 6;
    for (let n = 3; n < b.points.length - 3; n += step) {
      if (b.lip != null && n > b.lip - 2) break;
      const p = b.points[n];
      water.push({ x: r2(p.x), y: r2(ga(r2(p.x), r2(p.z))), z: r2(p.z), branch: bi });
    }
  }

  // animals: only species living at the real altitude of the spot. `off` is meters past the bed edge: the
  // walkers stand on the bank where a drop riding the edge goes by within their sense radius (sim tuning
  // animal.sense) and the chase camera sees them.
  const animals = [];
  const total = cfg.animals.perStage, arnd = mulberry(0xa2b1 + st.k * 7919);
  // a pasture: gentle ground over the 12 m of bank beyond the spot, away from the bed
  const gentle = (i, g, side) => {
    const p = pts[i], a = at(i, side * (p.hw + g.off[0])), b = at(i, side * (p.hw + g.off[0] + 12));
    return Math.abs(b.y - a.y) / 12 <= g.maxSlope;
  };
  for (let n = 0; n < total; n++) {
    const i = Math.round(5 + (N - 11) * (0.05 + (0.9 * (n + 0.5)) / total));
    const p = pts[i], bank = banks[-1] <= banks[1] ? -1 : 1; // the bank with fewer walkers: both get as many
    const ok = groups.filter(([, g]) => {
      if (p.real < g.alt[0] || p.real > g.alt[1]) return false;
      return g.maxSlope == null || gentle(i, g, bank) || gentle(i, g, -bank);
    });
    const free = ok.filter(([kind, g]) => g.max == null || animals.filter((a) => a.kind === kind).length < g.max);
    if (!free.length) continue;
    const [kind, g] = free[(n + st.k) % free.length];
    // grazers take the other bank when only that one is a pasture
    let side = g.maxSlope != null && !gentle(i, g, bank) ? -bank : bank;
    const off = p.hw + g.off[0] + arnd() * (g.off[1] - g.off[0]);
    let o = at(i, side * off);
    if (nearBranch(o.x, o.z, 6)) { side = -side; o = at(i, side * off); }
    if (nearBranch(o.x, o.z, 6)) continue;
    const flying = g.flying ?? !!SPECIES[kind]?.flying; // a soaring bird circles above the spot and never drinks
    animals.push({ kind, ...o, course: i, ...(flying ? { flying: true } : {}) });
    if (!flying) banks[side]++;
  }

  // side by side, 8 m apart where the bed is wide, inside the bed of a narrow stream
  const sx = Math.min(4, 0.55 * pts[2].hw);
  st.spawns = { start: [at(2, -sx), at(2, sx)], water, animals, obstacles };
}
// weather zones on the stages that have none of their own: the highest gets the sun, the next the rain.
// cfg.weather { sun, rain } names the landmark of each instead, where the highest plain stage is a
// shaded gorge (the Cascata delle Pile, antelao)
{
  // a real waterfall on the course does not take the stage out (the Cascada Bâlea stage keeps its sun)
  const plain = stages.filter((s) => s.zones.every((z) => z.kind === 'waterfall' && z.branch == null)).sort((a, b) => b.offset.y - a.offset.y);
  const named = (kind) => cfg.weather?.[kind] && plain.find((s) => s.lm.id === cfg.weather[kind]);
  const sun = cfg.weather?.sun ? named('sun') : plain[0];
  if (sun) sun.zones.push({ kind: 'sun', from: 0, to: sun.N - 1 });
  const r = cfg.weather?.rain ? named('rain') : plain[1] || plain[0];
  if (r) {
    const a = Math.round((r.N - 1) * 0.1), b = Math.round((r.N - 1) * 0.9);
    r.zones.push({ kind: 'rain', from: a, to: b });
  }
}

// ---------- places ----------
let placeSrc = 'fallback', placeList = cfg.placesFallback;
if (existsSync(`${OSM}/places.json`)) {
  const j = JSON.parse(readFileSync(`${OSM}/places.json`, 'utf8'));
  const got = new Map();
  const skip = new Set(cfg.osm.placeExclude || []);
  for (const e of j.elements) {
    const nm = nameTags.map((k) => e.tags?.[k]).find(Boolean);
    if (nm && e.tags.place && !got.has(nm) && !skip.has(nm)) got.set(nm, { name: nm, lat: e.lat, lon: e.lon });
  }
  if (got.size >= 3) { placeList = [...got.values()]; placeSrc = 'osm'; }
}
const lastKm = stages.at(-1).rk1 / 1000;
const places = [{ name: cfg.summit.name, lat: +summit.lat.toFixed(5), lon: +summit.lon.toFixed(5), riverKm: r2(-spine.pathLen / 1000), stage: 0, course: 0, distance: 0, kind: 'peak' }];
for (const p of placeList) {
  const pr = projectOnRiver(river, p.lon, p.lat), km = pr.t / 1000;
  if (km > Math.max(lastKm, floorKm) + 10) continue; // far below the played part
  if (cfg.osm.placeMaxDistance != null && pr.d > cfg.osm.placeMaxDistance) continue; // another valley
  const k = stages.findIndex((s) => pr.t >= s.rk0 && pr.t <= s.rk1);
  const course = k < 0 ? null : stages[k].pts.reduce((bi, q, i, a) => (Math.abs(q.rk - pr.t) < Math.abs(a[bi].rk - pr.t) ? i : bi), 0);
  places.push({ name: p.name, lat: p.lat, lon: p.lon, riverKm: r2(km), stage: k < 0 ? null : k, course, distance: Math.round(pr.d), kind: 'town' });
}
places.sort((a, b) => a.riverKm - b.riverKm);

// ---------- output ----------
const round = (st) => {
  const course = st.pts.map((p) => ({ x: r2(p.x), y: r2(p.y), z: r2(p.z), hw: Math.round(p.hw * 10) / 10 }));
  // rounding must not break the strict descent; the first point is the origin
  course[0] = { ...course[0], x: 0, y: 0, z: 0 };
  for (let i = 1; i < course.length; i++) if (course[i].y >= course[i - 1].y) course[i].y = r2(course[i - 1].y - 0.01);
  return course;
};
// downhill heading (deg clockwise from north, north is -z): the mean direction of the course, which for points
// evenly spaced is the chord from the start to the finish; the renderer centres the painted backdrop on it
const headingOf = (c) => {
  const deg = (Math.atan2(c.at(-1).x - c[0].x, -(c.at(-1).z - c[0].z)) * 180) / Math.PI;
  return (Math.round(((deg + 360) % 360) * 10) / 10) % 360;
};
const stageJson = stages.map((st) => {
  const real = st.pts.map((p) => p.real), course = round(st);
  return {
    id: st.sid,
    name: st.it,
    labels: { it: st.it, en: st.en },
    biome: st.biome,
    palette: st.palette,
    origin: st.origin,
    offset: st.offset,
    realKm: [r2(st.rk0 / 1000), r2(st.rk1 / 1000)],
    altitude: [Math.round(Math.min(...real)), Math.round(Math.max(...real))],
    length: st.u1 - st.u0,
    heading: headingOf(course),
    pointStep: STEP,
    height: { file: `stage-${st.k}.bin`, w: st.meta.w, h: st.meta.h, x0: st.meta.x0, z0: st.meta.z0, step: st.meta.step, min: r2(st.minH), max: r2(st.maxH) },
    course,
    branches: st.branches.map((b) => ({
      from: b.from, to: b.to, kind: b.kind,
      points: b.points.map((p) => ({ x: r2(p.x), y: r2(p.y), z: r2(p.z), hw: p.hw })),
      ...(b.lip != null ? { waterfall: { at: b.lip, drop: r2(b.fall) } } : {}),
    })),
    checkpoints: st.checkpoints,
    zones: st.zones,
    spawns: st.spawns,
    ...(Object.values(st.features).some((l) => l.length) ? { features: st.features } : {}),
    finish: st.N - 1,
  };
});
// branch end points sit exactly on the rounded course
for (const s of stageJson) for (const b of s.branches) {
  b.points[0] = { ...b.points[0], x: s.course[b.from].x, y: s.course[b.from].y, z: s.course[b.from].z };
  b.points[b.points.length - 1] = { ...b.points.at(-1), x: s.course[b.to].x, y: s.course[b.to].y, z: s.course[b.to].z };
  for (let i = 1; i < b.points.length; i++) if (b.points[i].y > b.points[i - 1].y) b.points[i].y = b.points[i - 1].y;
}

// The real landscape for the renderer (docs/world-format.md, "look"): the bands of the config's look, the fauna
// from its animals (every species of the mountain with its real band, spawned or not), and the paintings
function lookOf(c) {
  const L = c.look;
  return {
    treeline: L.treeline,
    treeSpecies: L.treeSpecies,
    ground: L.ground.map((g) => ({ type: g.type, alt: g.alt })),
    waterType: L.waterType,
    ...(L.glacialAbove != null ? { glacialAbove: L.glacialAbove } : {}),
    fauna: Object.entries(c.animals.kinds).map(([kind, a]) => ({ id: kind, alt: a.alt })),
    backdrop: { file: L.backdrop?.file || `${c.id}.jpg`, summit: L.backdrop?.summit || `${c.id}-summit.jpg` },
    sources: L.sources,
  };
}
const world = {
  id: cfg.id,
  name: cfg.name,
  mode,
  seaLevel: 0, // global frame: y is the real altitude
  length: stages.reduce((s, st) => s + st.u1 - st.u0, 0),
  pointStep: STEP,
  floor: { riverKm: r2(floorKm), altitude: Math.round(prof[Math.round(floorU / STEP)]), slope: S.floor.slope, window: S.floor.window },
  frame: { lat: summit.lat, lon: summit.lon }, // exact: localFrame(lat, lon) of dem.mjs maps lon/lat to x, z
  ...(cfg.look ? { look: lookOf(cfg) } : {}),
  stages: stageJson,
  backdrop: { file: 'backdrop.bin', w: bd.w, h: bd.h, x0: bd.x0, z0: bd.z0, step: bd.step },
  places,
  source: {
    river: D.kind === 'dem' ? `${river.label}, from the elevation data below` : `${river.label}, ODbL, (c) OpenStreetMap contributors`,
    places: placeSrc === 'osm' ? 'OpenStreetMap via Overpass' : 'approximate coordinates from the bake config (Overpass unavailable)',
    elevation: `Copernicus DEM GLO-30${coarse.length ? ` (GLO-90 for ${coarse.join(', ')}: no GLO-30 tile)` : ''}, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA`,
    tiles: dem.tiles,
    ...(Object.keys(dem.voids).length ? { voids: dem.voids } : {}),
    ...(sea.length ? { sea } : {}),
    ...(glaciers ? { glaciers: 'OpenStreetMap natural=glacier outlines, ODbL, (c) OpenStreetMap contributors' } : {}),
    ...(feats ? { features: 'OpenStreetMap buildings, roads, aerialways and natural=water, ODbL, (c) OpenStreetMap contributors' } : {}),
    summit: { lat: +summit.lat.toFixed(5), lon: +summit.lon.toFixed(5), elevation: Math.round(summit.h) },
  },
};

const dir = `${outRoot}/${cfg.id}`;
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith('.bin') || f === 'world.json') rmSync(`${dir}/${f}`);
const toBuf = (f32) => {
  const buf = Buffer.alloc(f32.length * 4);
  for (let i = 0; i < f32.length; i++) buf.writeFloatLE(f32[i], i * 4);
  return buf;
};
// each file lands whole (part file + rename), so a reader in parallel never sees half of it
const put = (f, data) => { writeFileSync(`${dir}/${f}.${process.pid}.part`, data); renameSync(`${dir}/${f}.${process.pid}.part`, `${dir}/${f}`); };
for (const st of stages) put(`stage-${st.k}.bin`, toBuf(st.grid));
put('backdrop.bin', toBuf(backdrop));
put('world.json', JSON.stringify(world));
if (!args.includes('--no-index')) writeIndex(outRoot, { log });
const files = ['world.json', ...stages.map((s) => `stage-${s.k}.bin`), 'backdrop.bin'];
log(`${dir}: ${files.map((f) => `${f} ${(readFileSync(`${dir}/${f}`).length / 1e6).toFixed(2)} MB`).join(', ')}`);
log('stages: ' + stageJson.map((s) => `${s.id} ${s.length} m, ${s.altitude[1]}->${s.altitude[0]} m, ${s.checkpoints.length} cp, ${s.spawns.water.length} water, ${s.spawns.animals.map((a) => a.kind).join('/')}, ${s.spawns.obstacles.length} rocks, zones ${s.zones.map((z) => z.kind).join('/')}`).join('; '));
