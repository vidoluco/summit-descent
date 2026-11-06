// Drop lab: one baked stage, the real sim and bots, with the drops' masses held where the URL says, to judge how a
// drop of any size and its rivulet read on screen (node src/render/drop-shoot.mjs captures it).
// URL: ?world=dolomiti&stage=1&t=8&seed=4&mass=1,2.5 (slot 0, slot 1) &gain=0.15,-1 (per slot: the frame is that many
// s after a pickup of 0.2, to see the pop; -1 none) &look=<json> (theme.drop.look overrides, e.g. {"tail":false}) &theme=<json>
// &view=split|hero; sets window.__ready.
import { loadWorld } from '../world/load.js';
import { createSim } from '../sim/index.js';
import { createBot } from '../sim/bot.js';
import { radiusFor, TUNING } from '../sim/tuning.js';
import { createRenderer, mergeTheme } from './index.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
const K = num('stage', 1), T = num('t', 8), SEED = num('seed', 4), DT = 1 / 60;
const masses = (q.get('mass') || '1,1').split(',').map(Number), gains = (q.get('gain') || '-1,-1').split(',').map(Number);
const world = await loadWorld(q.get('world') || 'dolomiti', { base: 'data/worlds', stages: [K] });
let theme = q.has('theme') ? JSON.parse(q.get('theme')) : {};
if (q.has('look')) theme = mergeTheme(theme, { drop: { look: JSON.parse(q.get('look')) } });
const r = createRenderer(document.getElementById('game'), { world, stage: K, pixelRatio: 1, theme });
r.resize(innerWidth, innerHeight);
if ((q.get('view') || 'split') === 'hero') r.setLayout('single', [0]);
const sim = createSim(world.stages[K], { players: 2, seed: SEED, final: K === world.json.stages.length - 1 });
const bots = [0, 1].map((s) => createBot(sim, s, { preferShortcut: s === 1, seed: SEED + s }));
const steps = Math.round((T + sim.state.countdown) / DT), gainAt = gains.map((g) => (g >= 0 ? steps - Math.round(g / DT) : -1));
// hold the masses (a pickup of 0.2 at gainAt when asked): the sim's own pickups, sips and boosts are undone
const hold = (i) => sim.state.players.forEach((p, s) => {
  const m = masses[s] ?? 1;
  p.mass = gainAt[s] >= 0 && i < gainAt[s] ? m - 0.2 : m;
  p.radius = radiusFor(TUNING, p.mass);
});
for (let i = 0; i < steps; i++) { hold(i); sim.step(DT, bots.map((b) => b.input())); hold(i); r.update(sim.state, DT); }
await r.ready; // the painted backdrop, when this renderer has one
r.render();
r.renderer.getContext().finish();
const p = sim.state.players;
const wi = [0, 1].map((s) => r.waterAt(s)), c0 = r.cameras[0].position;
console.log(`[drop-lab] t ${sim.state.t.toFixed(1)} s, ${p.map((d, s) => `mass ${d.mass.toFixed(2)} ${d.status} ${Math.hypot(d.vel.x, d.vel.z).toFixed(1)} m/s`
  + ` (${wi[s].inWater ? 'water' : 'ground'} ${wi[s].waterY.toFixed(2)}, ground ${wi[s].groundY.toFixed(2)}, base ${(d.pos.y - d.radius).toFixed(2)},`
  + ` ${Math.hypot(d.pos.x - c0.x, d.pos.y - c0.y, d.pos.z - c0.z).toFixed(1)} m from camera 0)`).join(', ')}`);
window.__ready = true;
