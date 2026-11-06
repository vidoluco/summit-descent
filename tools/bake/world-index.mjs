// data/worlds/index.json: the worlds the game can offer in the vote (docs/world-format.md, "index.json").
// Built from every <root>/<id>/world.json plus its bake config (display names, country).
// Usage: node tools/bake/world-index.mjs [--out data/worlds]   (the bake also runs it after each world)
// The race time estimate comes from two bots racing every stage in the real sim; it is cached by the
// hash of world.json and of the sim's code (src/sim/*.js), so an unchanged world on an unchanged sim is not raced again.
import { readdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { loadWorld } from '../../src/world/load.js';
import { createSim } from '../../src/sim/index.js';
import { createBot } from '../../src/sim/bot.js';

// The hash of the sim's code: a change in the physics or the bots races every world again.
const SIM_DIR = fileURLToPath(new URL('../../src/sim/', import.meta.url));
export const SIM_HASH = (() => { const h = createHash('sha256'); for (const f of readdirSync(SIM_DIR).filter((f) => f.endsWith('.js')).sort()) h.update(f).update(readFileSync(SIM_DIR + f)); return h.digest('hex').slice(0, 16); })();

export const CLOUD_SECONDS = 3.5; // the evaporate-cloud-rain transition between stages (spec: 3-4 s)

// The order the game offers the worlds in (decision of 27/10/2026): the two Dolomiti worlds, then one world per
// region. A baked world missing from this list goes after them, by id.
export const WORLD_ORDER = ['dolomiti', 'antelao', 'svizzera', 'carpazi', 'everest', 'k2', 'indonesia'];
export const byWorldOrder = (a, b) => {
  const i = (id) => (WORLD_ORDER.includes(id) ? WORLD_ORDER.indexOf(id) : WORLD_ORDER.length);
  return i(a) - i(b) || (a < b ? -1 : a > b ? 1 : 0);
};

// Seconds of racing for two bots over all stages (race clock: the cloud wait is not counted).
export async function raceSeconds(root, id) {
  const world = await loadWorld(id, { dir: root });
  let carry = null, sim = null;
  for (let k = 0; k < world.stages.length; k++) {
    sim = createSim(world.stages[k], { players: 2, seed: 3, final: k === world.stages.length - 1, carry });
    const bots = [createBot(sim, 0), createBot(sim, 1, { preferShortcut: true })];
    for (let n = 0; n < 240 * 60 && sim.state.phase !== 'done'; n++) sim.step(1 / 60, bots.map((b) => b.input()));
    if (sim.state.phase !== 'done') return null;
    carry = sim.carry();
  }
  const t = sim.state.players.map((p) => p.finishTime).filter(Number.isFinite);
  return t.length ? t.reduce((a, b) => a + b, 0) / t.length : null;
}

export async function entryFor(root, id, cached) {
  const text = readFileSync(`${root}/${id}/world.json`, 'utf8'), hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const W = JSON.parse(text);
  let cfg = null;
  try { cfg = loadConfig(id); } catch { /* a world without config keeps what world.json says */ }
  const last = W.stages.at(-1);
  let race = cached?.hash === hash && cached?.simHash === SIM_HASH ? cached.raceSeconds : undefined;
  if (race === undefined) {
    try { race = await raceSeconds(root, id); } catch { race = null; }
    if (race != null) race = Math.round(race * 10) / 10; // the same value whether fresh or cached
  }
  // fallback when the bots do not finish: 30 m/s, the middle of the spec range
  const racing = race ?? W.length / 30;
  return {
    id,
    names: cfg?.names || { en: W.name, it: W.name },
    country: cfg?.country || null,
    mode: W.mode,
    // altitude: the official height when the config has it (a 30 m DEM shaves sharp peaks: the
    // Matterhorn reads 4330 m); demAltitude: where the race really starts
    summit: { name: W.places?.[0]?.name || cfg?.summit.name, names: cfg?.summit.names || null, altitude: cfg?.summit.elevation ?? W.source.summit.elevation, demAltitude: W.source.summit.elevation, lat: W.source.summit.lat, lon: W.source.summit.lon },
    finish: { names: cfg?.finish?.names || { it: last.labels.it, en: last.labels.en }, altitude: last.altitude[0] },
    floor: { altitude: W.floor.altitude },
    stages: W.stages.length,
    stageNames: W.stages.map((s) => s.labels),
    length: W.length,
    drop: Math.round(W.stages[0].altitude[1] - last.altitude[0]),
    estimatedSeconds: Math.round(racing + CLOUD_SECONDS * (W.stages.length - 1)),
    estimate: race == null ? 'length at 30 m/s' : 'two bots in the sim',
    raceSeconds: race,
    hash,
    simHash: SIM_HASH, // with hash, the cache key of raceSeconds
  };
}

export async function buildIndex(root = 'data/worlds') {
  const old = existsSync(`${root}/index.json`) ? JSON.parse(readFileSync(`${root}/index.json`, 'utf8')) : { worlds: [] };
  const ids = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`${root}/${d.name}/world.json`)).map((d) => d.name).sort(byWorldOrder);
  const worlds = [];
  for (const id of ids) {
    try {
      worlds.push(await entryFor(root, id, old.worlds?.find((w) => w.id === id)));
    } catch { /* world.json being rewritten by a parallel bake: its own writeIndex adds it */ }
  }
  return { version: 1, worlds };
}

// Writes atomically and re-reads the folder until the list is stable, so two bakes finishing together
// both end up in the index.
export async function writeIndex(root = 'data/worlds', { log = () => {} } = {}) {
  for (let round = 0; round < 5; round++) {
    const idx = await buildIndex(root), txt = JSON.stringify(idx, null, 2) + '\n';
    const part = `${root}/index.json.${process.pid}.part`;
    writeFileSync(part, txt);
    renameSync(part, `${root}/index.json`);
    const now = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`${root}/${d.name}/world.json`)).map((d) => d.name).sort(byWorldOrder);
    if (now.join() === idx.worlds.map((w) => w.id).join()) {
      log(`${root}/index.json: ${idx.worlds.map((w) => `${w.id} ${w.estimatedSeconds} s`).join(', ')}`);
      return idx;
    }
  }
  throw new Error(`${root}/index.json: the folder kept changing`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const a = process.argv.slice(2), out = a.includes('--out') ? a[a.indexOf('--out') + 1] : 'data/worlds';
  await writeIndex(out, { log: console.log });
}
