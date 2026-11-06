// Standalone render debug page: one baked stage, the real sim, two bot-driven drops, no server or phones.
// URL: ?stage=1&view=split|hero&t=6&seed=4 renders the state t seconds after the start and sets
// window.__ready; &perf=5 then runs the race in real time for 5 s and puts the frame stats in window.__perf;
// &theme=<json> overrides the world's theme (themes/); &yaw=30 turns the cameras 30 deg right; &next=1 then swaps to the next stage (setStage); &live=1 just keeps playing (open it in a browser through tools: node src/render/debug/shoot.mjs --serve).
import { loadWorld, loadStage } from '../../world/load.js';
import { createSim } from '../../sim/index.js';
import { createBot } from '../../sim/bot.js';
import { createRenderer } from '../index.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
const K = num('stage', 1), VIEW = q.get('view') || 'split', T = num('t', 6), SEED = num('seed', 4), DT = 1 / 60;
const log = (m) => console.log(`[render-debug] ${m}`);

const t0 = performance.now();
const world = await loadWorld(q.get('world') || 'dolomiti', { base: q.get('base') || 'data/worlds', stages: [K] });
log(`world loaded in ${(performance.now() - t0).toFixed(0)} ms`);
const canvas = document.getElementById('game');
const t1 = performance.now();
const theme = q.has('theme') ? JSON.parse(q.get('theme')) : undefined; // look overrides, e.g. {"fog":{"max":0}}
const r = createRenderer(canvas, { world, stage: K, pixelRatio: num('pr', 1), theme });
log(`painted backdrop ${(await r.ready) ? 'in' : 'none'}, heading ${r.paint.heading.toFixed(0)} deg`);
log(`renderer and stage ${K} built in ${(performance.now() - t1).toFixed(0)} ms: ${r.stats.tris} terrain tris, ${r.stats.trees} trees`);
r.resize(innerWidth, innerHeight);
addEventListener('resize', () => r.resize(innerWidth, innerHeight));
if (VIEW === 'hero') r.setLayout('single', [0]);

const sim = createSim(world.stages[K], { players: 2, seed: SEED, final: K === world.json.stages.length - 1 });
const bots = [0, 1].map((s) => createBot(sim, s, { preferShortcut: s === 1, seed: SEED + s }));
const step = () => { sim.step(DT, bots.map((b) => b.input())); r.update(sim.state, DT); };
const steps = Math.round((T + sim.state.countdown) / DT);
for (let i = 0; i < steps; i++) step();
if (q.has('cam')) { // free camera for view 0: cam=x,y,z,lookX,lookY,lookZ in the stage frame
  const [x, y, z, lx, ly, lz] = q.get('cam').split(',').map(Number), c = r.cameras[0];
  // &above=1: the heights are metres above the drawn ground
  const g = q.has('above') ? r.groundAt : () => 0;
  c.position.set(x, y + g(x, z), z); c.lookAt(lx, ly + g(lx, lz), lz); c.updateMatrixWorld();
}
if (q.has('yaw')) { // turn both chase cameras by yaw deg (right positive), to check the backdrop beyond the bends
  for (const c of r.cameras) { c.rotateOnWorldAxis({ x: 0, y: 1, z: 0, isVector3: true }, -num('yaw', 0) * Math.PI / 180); c.updateMatrixWorld(); }
}
r.render();
// a 192 x 108 thumbnail of the frame for the browser test (read before the drawing buffer is cleared)
{
  const c2 = document.createElement('canvas'); c2.width = 192; c2.height = 108;
  const g2 = c2.getContext('2d'); g2.drawImage(canvas, 0, 0, 192, 108);
  window.__thumb = Array.from(g2.getImageData(0, 0, 192, 108).data);
  // and the middle 16 columns at full resolution (the divider), 108 rows
  const c3 = document.createElement('canvas'); c3.width = 16; c3.height = 108;
  const g3 = c3.getContext('2d'); g3.drawImage(canvas, canvas.width / 2 - 8, 0, 16, canvas.height, 0, 0, 16, 108);
  window.__mid = Array.from(g3.getImageData(0, 0, 16, 108).data);
}
r.renderer.getContext().finish();
document.getElementById('boot')?.remove();
const p = sim.state.players;
log(`t ${sim.state.t.toFixed(1)} s, drops at ${p.map((d) => `(${d.pos.x.toFixed(0)}, ${d.pos.z.toFixed(0)}) ${d.status} ${Math.hypot(d.vel.x, d.vel.z).toFixed(1)} m/s`).join(', ')}`);
log(`stats ${JSON.stringify(r.stats)}`);
window.__stats = r.stats; window.__render = r; // for probes
window.__ready = true;

// &next=1: swap to the next stage the way the game does after the cloud transition, carrying the race over
if (q.has('next') && K + 1 < world.json.stages.length) {
  const t2 = performance.now();
  const nx = await loadStage(q.get('world') || 'dolomiti', world.json, K + 1, { base: q.get('base') || 'data/worlds' });
  // as in the game: the loaded stage is built in idle time (slices of theme.lod.buildBudget ms), then swapped in
  world.stages[K + 1] = nx;
  let slices = 0, sliceMax = 0;
  for (;;) { const a = performance.now(), more = r.buildIdle(); sliceMax = Math.max(sliceMax, performance.now() - a); if (!more) break; slices++; }
  const t3 = performance.now();
  r.setStage(nx.json, nx.height);
  const swapMs = performance.now() - t3;
  const sim2 = createSim(nx, { players: 2, seed: SEED, carry: sim.carry(), final: K + 1 === world.json.stages.length - 1 });
  const bots2 = [0, 1].map((s) => createBot(sim2, s, { seed: SEED + s }));
  for (let i = 0; i < 6 * 60; i++) { sim2.step(DT, bots2.map((b) => b.input())); r.update(sim2.state, DT); }
  r.render();
  log(`stage ${K + 1} built in ${slices} idle slices (longest ${sliceMax.toFixed(1)} ms), swapped in ${swapMs.toFixed(1)} ms, all in ${(performance.now() - t2).toFixed(0)} ms, stats ${JSON.stringify(r.stats)}`);
  window.__swapped = { stage: K + 1, players: sim2.state.players.map((p) => p.status), stats: { ...r.stats }, slices, sliceMax, swapMs };
}

const perf = num('perf', 0), live = q.has('live');
if (perf || live) {
  const frames = [];
  let last = performance.now(), acc = 0;
  const loop = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    acc += dt;
    while (acc >= DT) { step(); acc -= DT; }
    const a = performance.now(); r.render(); frames.push([dt, performance.now() - a]);
    if (perf && frames.length > 10 && frames.reduce((s, f) => s + f[0], 0) > perf) {
      const d = frames.slice(5).map((f) => f[0]).sort((x, y) => x - y), cpu = frames.slice(5).map((f) => f[1]);
      const mean = d.reduce((s, x) => s + x, 0) / d.length;
      window.__perf = { frames: d.length, fps: 1 / mean, p95ms: d[Math.floor(d.length * 0.95)] * 1000, cpuRenderMs: cpu.reduce((s, x) => s + x, 0) / cpu.length };
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
