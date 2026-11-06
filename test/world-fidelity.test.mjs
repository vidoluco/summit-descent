// Fidelity of the seven worlds to the real mountains (docs/world-format.md, "Worlds" and "look"): the published
// summit heights, real names spelled right, the course on the real watercourse (OSM), the race length, and the
// baked look agreeing with the renderer's theme of each world. The OSM checks need the bake cache in data/raw/osm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../tools/bake/config.mjs';
import { localFrame } from '../tools/bake/dem.mjs';
import { WORLD_ORDER } from '../tools/bake/world-index.mjs';
import { toGlobal } from '../src/world/load.js';
import { THEMES, themeFor } from '../src/render/themes/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}data/worlds`;
const OSM = `${ROOT}data/raw/osm`;
const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));
const worldOf = (id) => JSON.parse(readFileSync(`${DIR}/${id}/world.json`, 'utf8'));

// Official summit heights
const SUMMITS = {
  dolomiti: 2694, // Monte Peralba, it.wikipedia.org/wiki/Monte_Peralba
  antelao: 3264, // it.wikipedia.org/wiki/Antelao, docs/mountains/antelao.md
  svizzera: 4478, // Matterhorn 4477.5 m, swisstopo
  carpazi: 2443, // Vârful Văiuga, docs/mountains/carpazi.md
  everest: 8849, // 8848.86 m, China-Nepal survey of 2020
  k2: 8611, // docs/mountains/k2.md (8609 m by GPS in 2014)
  indonesia: 3805, // Gunung Kerinci, id.wikipedia, docs/mountains/indonesia.md
};

test('the game offers exactly the seven worlds, in order', () => {
  assert.deepEqual(index.worlds.map((w) => w.id), WORLD_ORDER);
});

test('summits: the official height in the vote, the DEM summit close to it', () => {
  for (const w of index.worlds) {
    assert.equal(w.summit.altitude, SUMMITS[w.id], `${w.id}: official height`);
    // a 30 m DEM shaves sharp tops: the Matterhorn reads 148 m low, Everest 112 m
    assert.ok(w.summit.demAltitude <= w.summit.altitude && w.summit.altitude - w.summit.demAltitude <= 150, `${w.id}: DEM ${w.summit.demAltitude} m`);
  }
});

test('names are real and spelled right in both languages', () => {
  for (const w of index.worlds) {
    const names = [w.names, w.summit.names, w.finish.names, ...w.stageNames].flatMap((n) => [n.it, n.en]);
    for (const n of names) {
      assert.ok(n && n === n.trim() && !/\s{2}/.test(n), `${w.id}: "${n}"`);
      // Italian accents written as an apostrophe (Molina', Quaterna') instead of the accented letter
      assert.ok(!/[aeiouAEIOU]'(\s|,|$)/.test(n), `${w.id}: "${n}" spells an accent with an apostrophe`);
      // Romanian takes the comma below (ș ț), never the Turkish cedilla (ş ţ)
      assert.ok(!/[ŞşŢţ]/.test(n), `${w.id}: "${n}" has a cedilla s or t`);
    }
    assert.equal(new Set(w.stageNames.map((s) => s.it)).size, w.stages, `${w.id}: stage names repeat`);
  }
  const carpazi = index.worlds.find((w) => w.id === 'carpazi');
  assert.ok(carpazi.stageNames.some((s) => s.it.includes('Bâlea')) && carpazi.summit.name === 'Vârful Văiuga');
});

// K2 at about 2.2 min: its steep part is that short (138 s since the landing fix of 28/10/2026 ended the false flights
// over the face)
test('each race lasts 3-5 minutes with two bots; K2 at about 2.2, its steep part is that short', () => {
  for (const w of index.worlds) {
    assert.equal(w.estimate, 'two bots in the sim', `${w.id}: the bots did not finish`);
    const min = w.id === 'k2' ? 130 : 180;
    assert.ok(w.estimatedSeconds >= min && w.estimatedSeconds <= 300, `${w.id}: ${w.estimatedSeconds} s`);
  }
});

// The OSM waterways of a world's cache as segments in its global frame.
function waterways(id, W) {
  const file = `${OSM}/${id}/river.json`;
  if (!existsSync(file)) return null;
  const f = localFrame(W.frame.lat, W.frame.lon), segs = [];
  for (const e of JSON.parse(readFileSync(file, 'utf8')).elements) {
    if (e.type !== 'way' || !e.geometry || !/^(river|stream)$/.test(e.tags?.waterway || '')) continue;
    const g = e.geometry.map((p) => f.toXZ(p.lon, p.lat));
    for (let i = 1; i < g.length; i++) segs.push({ a: g[i - 1], b: g[i], name: e.tags.name || '' });
  }
  return segs;
}
const nearest = (segs, x, z) => {
  let best = { d: Infinity, name: '' };
  for (const { a, b, name } of segs) {
    const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(a[0] + t * dx - x, a[1] + t * dz - z);
    if (d < best.d) best = { d, name };
  }
  return best;
};

for (const id of WORLD_ORDER) {
  const cfg = loadConfig(id), kind = cfg.descent.kind;
  const skip = !kind.startsWith('osm') ? `${id}: the line comes from the DEM (glaciers, OSM maps no stream)` : existsSync(`${OSM}/${id}/river.json`) ? false : 'no OSM cache';
  test(`${id}: below the summit path the course runs on the real OSM watercourse`, { skip }, () => {
    const W = worldOf(id), segs = waterways(id, W), named = new Set();
    for (const [k, s] of W.stages.entries()) {
      const d = s.course.map((p) => { const g = toGlobal(s, p); return nearest(segs, g.x, g.z); });
      // the first stage starts on the summit, where no stream is mapped: only its part on the stream counts (none on
      // a face and glacier, as on the Antelao and the Matterhorn)
      const from = k ? 0 : d.findIndex((q) => q.d < 30);
      if (from < 0) continue;
      const on = d.slice(from);
      const close = on.filter((q) => q.d < 60).length / on.length;
      assert.ok(close >= 0.9, `${id} ${s.id}: ${(close * 100).toFixed(0)} % of the course within 60 m of an OSM waterway`);
      for (const q of on) if (q.d < 60 && q.name) named.add(q.name);
    }
    const want = cfg.descent.name ? [cfg.descent.name] : cfg.descent.prefer || [];
    assert.ok(!want.length || want.some((n) => named.has(n)), `${id}: course on ${[...named].join(', ')}, config names ${want.join(', ')}`);
  });
}

test('the baked look agrees with the renderer theme of each world', () => {
  for (const id of WORLD_ORDER) {
    const W = worldOf(id), L = W.look, T = themeFor(id), band = (type) => L.ground.filter((g) => g.type === type);
    assert.ok(THEMES[id], `${id}: no render theme`);
    assert.equal(L.backdrop.file, T.backdrop.file, `${id}: painting`);
    assert.equal(L.backdrop.summit, T.backdrop.summit, `${id}: summit painting`);
    assert.equal(L.treeline ?? 0, T.terrain.treeline, `${id}: treeline`);
    const ice = band('glacier');
    assert.equal(ice.length ? Math.min(...ice.map((g) => g.alt[0])) : null, T.terrain.iceAbove, `${id}: glacier ice from`);
    const mor = band('moraine');
    assert.deepEqual(mor.length ? mor[0].alt : null, T.terrain.moraineBand, `${id}: moraine band`);
    if (band('snow').length) assert.equal(band('snow')[0].alt[0], T.terrain.snowAbove, `${id}: snow from`);
    // the look adds facts and never retunes the renderer: the theme with it equals the theme without it
    const withLook = themeFor(W);
    for (const k of Object.keys(T)) assert.deepEqual(withLook[k], T[k], `${id}: world.json look changes theme.${k}`);
  }
});
