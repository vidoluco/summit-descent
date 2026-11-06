// Race balance on the real Dolomiti world (the reviewers' findings of 27/10/2026): the slope sets the pace, mass
// does not snowball into a runaway leader, a forward-only pad gets down stage 0, ice punishes a stall and not
// speed, a steal is possible, boost spam does not pay, the safe arm is a real choice, bots differ by seed.
// Every race here is seeded and deterministic. Run with node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from '../src/world/load.js';
import { createSim, TUNING } from '../src/sim/index.js';
import { vmaxFor, catchupFor } from '../src/sim/tuning.js';
import { createBot } from '../src/sim/bot.js';
import { createRace } from '../src/game/race.js';
import { syntheticWorld, raceSim, run, courseSpot, DT } from './fixtures/sim-helpers.mjs';
import { pilotRace } from './fixtures/skill-pilots.mjs';

const world = await loadWorld('dolomiti', { dir: 'data/worlds' });
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

// A whole bot race through createRace: per stage times, lead changes (2 m hysteresis), events by kind.
function botRace(seed) {
  const race = createRace(world, { bots: [true, true], seed });
  const ev = {};
  let leader = -1, changes = 0, t = 0;
  while (race.phase !== 'done' && t < 900) {
    race.step(DT, []);
    t += DT;
    for (const e of race.events) ev[e.kind] = (ev[e.kind] || 0) + 1;
    const st = race.state;
    if (race.phase !== 'race' || st.phase !== 'race') continue;
    const [a, b] = st.players;
    if ([a, b].some((p) => p.status === 'finished' || p.status === 'evaporated')) continue;
    const d = a.dist - b.dist;
    const now = Math.abs(d) > 2 ? (d > 0 ? 0 : 1) : leader;
    if (leader >= 0 && now !== leader) changes++;
    leader = now;
  }
  const res = race.results();
  const split = (r) => r.stageTimes.map((v, i, all) => v - (i ? all[i - 1] : 0));
  return { res, ev, changes, splits: res.map(split), gaps: res[0].stageTimes.map((v, k) => Math.abs(v - res[1].stageTimes[k])) };
}

// One stage with a fixed pad in slot 0 and a bot in slot 1.
function padStage(k, pad, seconds = 240) {
  const sim = createSim(world.stages[k], { players: 2, seed: 1, final: true });
  const bot = createBot(sim, 1, { seed: 3 });
  const ev = [];
  let padT = null, botT = null;
  for (let n = 0; n < seconds / DT && sim.state.phase !== 'done'; n++) {
    sim.step(DT, [pad(sim.state.t), bot.input()]);
    for (const e of sim.state.events) {
      ev.push(e);
      if (e.kind === 'finish') { if (e.slot === 0) padT = e.time; else botT = e.time; }
    }
  }
  return { padT, botT, ev: ev.filter((e) => e.slot === 0) };
}

test('top speed follows the real slope: about 28 m/s on a 5 % stream, 46 on a 70 % snowfield, mass adds little', () => {
  assert.ok(Math.abs(vmaxFor(TUNING, 1, 0.05) - 27.7) < 0.1);
  assert.ok(Math.abs(vmaxFor(TUNING, 1, 0.7) - 46.1) < 0.1);
  assert.equal(vmaxFor(TUNING, 1, 2), vmaxFor(TUNING, 1, TUNING.speed.slopeMax), 'a cliff adds no more than slopeMax');
  assert.ok(Math.abs(vmaxFor(TUNING, 4, 0.05) - vmaxFor(TUNING, 1, 0.05) - 3) < 1e-9, 'mass 4 is +3 m/s, not a runaway');
  // the grade comes from the baked course: stage 0 is the summit snowfield, stage 3 the valley stream
  const grade = (k) => { const W = createSim(world.stages[k]).world; return median(Array.from(W.course.grade)); };
  assert.ok(grade(0) > 0.4 && grade(3) < 0.1, `median grade ${grade(0).toFixed(2)} vs ${grade(3).toFixed(2)}`);
  // a bot without pickups or boosts (mass about 1 all the way): the steep stage is the fast one
  const avg = (k) => {
    const sim = createSim(world.stages[k], { players: 2, seed: 1 });
    const bot = createBot(sim, 0, { pickups: false, boost: false, steal: false });
    let sum = 0, n = 0;
    for (let i = 0; i < 200 / DT && sim.state.players[0].status !== 'finished'; i++) {
      sim.step(DT, [bot.input(), { connected: false }]);
      const p = sim.state.players[0];
      if (p.status === 'rolling') { sum += Math.hypot(p.vel.x, p.vel.z); n++; }
    }
    return sum / n;
  };
  const s0 = avg(0), s3 = avg(3);
  assert.ok(s0 > 30 && s3 < 28 && s0 > s3 + 7, `stage 0 ${s0.toFixed(1)} m/s, stage 3 ${s3.toFixed(1)} m/s`);
});

test('the rubber band: a drop behind gets min(2.5, gap / 80) m/s more, the leader nothing', () => {
  assert.equal(catchupFor(TUNING, 0), 0);
  assert.equal(catchupFor(TUNING, -50), 0);
  assert.equal(catchupFor(TUNING, 120), 1.5);
  assert.equal(catchupFor(TUNING, 1000), 2.5);
  const W = syntheticWorld();
  const sim = raceSim({ players: 2 });
  const lead = courseSpot(W, 4900, -4), back = courseSpot(W, 4700, 4);
  sim.place(0, lead, { vel: { x: lead.tangent.x * 20, z: lead.tangent.z * 20 } });
  sim.place(1, back, { vel: { x: back.tangent.x * 20, z: back.tangent.z * 20 } });
  run(sim, 6, () => [{ y: 1 }, { y: 1 }]);
  const [a, b] = sim.state.players;
  assert.ok(b.speed > a.speed + 1.5, `behind ${b.speed.toFixed(1)} m/s, ahead ${a.speed.toFixed(1)} m/s`);
});

// Two equal bots: close, either can win. Since the rubber band was weakened (28/10/2026) a bot that gets ahead by a
// few seconds on the first stage keeps the lead it carries into the next ones, so a pass is no longer guaranteed.
test('mass does not snowball: over 8 seeded bot races the stages end close, either bot wins, both finish', (t) => {
  const races = [1, 2, 3, 4, 5, 6, 7, 8].map(botRace);
  const gaps = races.flatMap((r) => r.gaps);
  assert.ok(median(gaps) <= 5, `stage-end gap median ${median(gaps).toFixed(1)} s`);
  for (const r of races) {
    assert.ok(r.res.every((p) => p.finished), 'both reach the valley floor');
    const total = Math.max(...r.res.map((p) => p.time));
    assert.ok(total > 180 && total < 300, `3 to 5 minutes, got ${total.toFixed(0)} s`);
  }
  const wins = [0, 1].map((slot) => races.filter((r) => r.res[slot].place === 1).length);
  assert.ok(wins[0] >= 1 && wins[1] >= 1, `wins by slot ${wins.join(':')}`);
  const totals = races.map((r) => Math.abs(r.res[0].time - r.res[1].time));
  assert.ok(median(totals) < 8, `final gaps ${totals.map((g) => g.toFixed(1)).join(' ')} s`);
  // the bots are not the same rival every race (lane, lookahead and boost habits come from the seed)
  const firstSplits = races.map((r) => r.splits[0].map((v) => v.toFixed(1)).join('/'));
  assert.ok(new Set(firstSplits).size >= 4, `slot 0 splits: ${firstSplits.join(' ')}`);
  // and a boosting bot does go for the other drop now and then
  const steals = races.map((r) => r.ev.steal || 0);
  assert.ok(steals.filter((n) => n > 0).length >= 5 && median(steals) <= 4, `steals per race ${steals.join(' ')}`);
  // ice does not freeze a drop going at race speed
  assert.ok(races.every((r) => !r.ev.freeze), `freezes ${races.map((r) => r.ev.freeze || 0).join(' ')}`);
  t.diagnostic(`gap median ${median(gaps).toFixed(1)} s, lead changes ${races.map((r) => r.changes).join(' ')}, steals ${steals.join(' ')}`);
});

test('stage 0: a forward-only pad gets down within 1.5x the bot time, the banks hold it through the bends', (t) => {
  const fwd = padStage(0, () => ({ x: 0, y: 1 }));
  assert.ok(fwd.padT && fwd.botT, 'both finish');
  assert.ok(fwd.padT < 1.5 * fwd.botT, `pad ${fwd.padT?.toFixed(1)} s, bot ${fwd.botT?.toFixed(1)} s`);
  assert.ok(!fwd.ev.some((e) => e.kind === 'respawn' && e.reason === 'offcourse'), 'never thrown off the course');
  assert.ok(!fwd.ev.some((e) => e.kind === 'freeze'), 'and never frozen');
  // stages 1-3 are gentler: the same pad finishes all of them
  for (const k of [1, 2, 3]) assert.ok(padStage(k, () => ({ x: 0, y: 1 })).padT, `stage ${k}`);
  t.diagnostic(`stage 0 forward-only ${fwd.padT.toFixed(1)} s vs bot ${fwd.botT.toFixed(1)} s`);
});

test('leaving the bed takes a deliberate steer: a light stick stays in, a full stick toward the bank goes over it', () => {
  const W = syntheticWorld(), sim = raceSim();
  const at = W.pointAt(0, 3900); // the valley, no rock near
  const go = (x, seconds) => {
    sim.place(0, { x: at.cx, z: at.cz }, { vel: { x: at.tangent.x * 20, z: at.tangent.z * 20 } });
    let maxOff = 0;
    const ev = run(sim, seconds, () => [{ x, y: 0 }], (s) => { maxOff = Math.max(maxOff, s.track(0).dist - s.track(0).hw); return false; });
    return { maxOff, ev };
  };
  const nudge = go(0.4, 4);
  assert.ok(nudge.maxOff < TUNING.bed.wall + 0.5, `a light steer stays in: ${nudge.maxOff.toFixed(1)} m past the edge`);
  assert.ok(!nudge.ev.some((e) => e.kind === 'respawn'));
  const out = go(1, 8);
  assert.ok(out.maxOff > TUNING.bed.wall + TUNING.bed.edge + 2, `a full steer leaves: ${out.maxOff.toFixed(1)} m past the edge`);
});

test('respawn: at the last respawn mark reached in the bed, already following the slope', () => {
  const sim = createSim(world.stages[0], { players: 1, seed: 1 });
  while (sim.state.phase === 'countdown') sim.step(DT, []);
  const W = sim.world, s = 760;
  const c = W.pointAt(0, s);
  sim.place(0, { x: c.cx, z: c.cz }, { vel: { x: c.tangent.x * 20, z: c.tangent.z * 20 } });
  sim.step(DT, [{}]); // reached s = 760 in the bed: the mark at 600 is now the respawn point
  const off = W.pointAt(0, s + 20);
  sim.place(0, { x: off.cx - off.tangent.z * (off.hw + 60), z: off.cz + off.tangent.x * (off.hw + 60) });
  const ev = run(sim, 6, () => [{}], (x, e) => e.some((y) => y.kind === 'respawn'));
  const r = ev.find((e) => e.kind === 'respawn');
  assert.ok(r && r.reason === 'offcourse');
  const back = Math.floor(s / TUNING.respawn.every) * TUNING.respawn.every;
  assert.ok(back > W.course.s[W.checkpoints[0]], 'the mark is past the first checkpoint');
  assert.ok(Math.abs(sim.track(0).s - back) < 6, `respawned at ${sim.track(0).s.toFixed(0)} m, mark ${back} m`);
  const p = sim.state.players[0];
  assert.ok(Math.hypot(p.vel.x, p.vel.z) > TUNING.respawn.speed - 0.5);
  const seen = new Set();
  run(sim, 0.5, () => [{ y: 1 }], (x) => { seen.add(x.state.players[0].status); return false; });
  assert.deepEqual([...seen], ['rolling'], 'it does not launch off the snowfield on the first step');
});

test('ice: nothing freezes in the first seconds of stage 0 or at race speed, a stall does', () => {
  const sim = createSim(world.stages[0], { players: 2, seed: 1 });
  const bots = [createBot(sim, 0), createBot(sim, 1)];
  while (sim.state.phase === 'countdown') sim.step(DT, []);
  let maxEarly = 0;
  const ev = run(sim, 20, () => bots.map((b) => b.input()), (s) => { if (s.state.t - TUNING.countdown < TUNING.ice.startGrace) maxEarly = Math.max(...s.state.players.map((p) => p.freeze)); return false; });
  assert.equal(maxEarly, 0, 'the standing start in the ice zone does not freeze');
  assert.ok(!ev.some((e) => e.kind === 'freeze'));
  assert.ok(sim.state.players.every((p) => p.freeze < 0.05), `freeze ${sim.state.players.map((p) => p.freeze.toFixed(2))}`);
  // a drop braking to a stall in the same ice zone freezes
  const stall = createSim(world.stages[0], { players: 1, seed: 1 });
  while (stall.state.phase === 'countdown') stall.step(DT, []);
  const e2 = run(stall, 12, () => [{ y: -1 }], (s) => s.state.players[0].status === 'frozen');
  assert.ok(e2.some((e) => e.kind === 'freeze'));
});

test('a boost aimed at the drop just ahead homes in and steals from a little further than touching', () => {
  const W = syntheticWorld();
  const tryIt = (tuning) => {
    const sim = raceSim({ players: 2, tuning });
    const back = courseSpot(W, 4700, -1.2), front = courseSpot(W, 4705, 1.2);
    sim.place(0, back, { mass: 1.5, vel: { x: back.tangent.x * 22, z: back.tangent.z * 22 } });
    sim.place(1, front, { mass: 1.5, vel: { x: front.tangent.x * 22, z: front.tangent.z * 22 } });
    return run(sim, 1.2, (k) => [{ boost: k === 0 }, {}]).filter((e) => e.kind === 'steal');
  };
  assert.equal(tryIt().length, 1, 'with homing and the steal reach');
  assert.equal(tryIt({ boost: { homing: 0 }, collide: { stealReach: 0 } }).length, 0, 'without them it misses, as before');
});

// Three bot seeds, since 28/10/2026: one race decides by a rock or an animal more than by the boosts. Since the rebake
// of that night the Dolomiti beds are 8-14 m wide and a drop takes nearly every water drop, so mass is plentiful:
// spamming every cooldown wins a few seconds at most over boosts timed on straights and through water drops, and
// pays for them with a visibly smaller drop.
test('boost spam is no real gain over timed boosts, and it drains the drop', () => {
  const race = (mode, seed) => {
    let carry = null, time = null;
    for (let k = 0; k < world.stages.length; k++) {
      const sim = createSim(world.stages[k], { players: 2, seed: 1, final: k === world.stages.length - 1, carry });
      const bot = createBot(sim, 0, { boost: mode === 'timed', seed });
      let f = 0;
      for (let i = 0; i < 300 / DT && sim.state.players[0].status !== 'finished'; i++) {
        let inp = bot.input();
        const p = sim.state.players[0];
        if (mode === 'spam' && p.status !== 'frozen') inp = { ...inp, boost: p.boostCooldown <= 0 && f++ % 2 === 0 };
        sim.step(DT, [inp, { connected: false }]);
      }
      time = sim.state.players[0].finishTime;
      carry = sim.carry();
    }
    return { time, mass: carry.players[0].mass };
  };
  const runs = (mode) => [5, 6, 7].map((seed) => race(mode, seed));
  const none = runs('none'), timed = runs('timed'), spam = runs('spam');
  const t = (rs) => median(rs.map((r) => r.time)), m = (rs) => median(rs.map((r) => r.mass));
  assert.ok(t(timed) < t(none) - 5, `boosting helps: ${t(timed).toFixed(1)} s vs ${t(none).toFixed(1)} s`);
  assert.ok(t(spam) > t(timed) - 4, `spam ${t(spam).toFixed(1)} s vs timed ${t(timed).toFixed(1)} s`);
  assert.ok(m(spam) < m(timed) - 0.2, `and it costs water: mass ${m(spam).toFixed(2)} vs ${m(timed).toFixed(2)}`);
});

// The rebake of 28/10/2026 moved the Dolomiti safe arm from stage 1 to stage 2: the test finds it.
test('the safe arm: taken only on purpose, in the shade, worth the water on it', () => {
  const k = world.json.stages.findIndex((st) => (st.branches || []).some((b) => b.kind === 'safe'));
  assert.ok(k >= 0, 'the Dolomiti have a safe arm');
  const ride = (preferShortcut) => {
    const sim = createSim(world.stages[k], { players: 2, seed: 1 });
    const bot = createBot(sim, 0, { preferShortcut, seed: 4 });
    const b = sim.world.branches.find((x) => x.kind === 'safe');
    let onArm = 0, sun = false, m0 = null, gain = null;
    while (sim.state.players[0].status !== 'finished' && sim.state.t < 200) {
      sim.step(DT, [bot.input(), { connected: false }]);
      const tr = sim.track(0);
      if (tr.pathId) { onArm += DT; sun ||= tr.zones.sun; }
      if (m0 === null && tr.sEq >= b.sFrom) m0 = sim.state.players[0].mass;
      if (gain === null && m0 !== null && tr.sEq >= b.sTo + 5 && !tr.pathId) gain = sim.state.players[0].mass - m0;
    }
    return { onArm, sun, gain, kind: b.kind };
  };
  const main = ride(false), arm = ride(true);
  assert.equal(arm.kind, 'safe');
  assert.equal(main.onArm, 0, 'aiming at the main course never drifts onto the arm');
  assert.ok(arm.onArm > 8, `the arm taken on purpose: ${arm.onArm.toFixed(1)} s on it`);
  assert.equal(arm.sun, false, 'no sun on the safe arm');
  assert.ok(arm.gain > main.gain + 0.15, `mass gained across the fork: arm ${arm.gain.toFixed(2)}, main ${main.gain.toFixed(2)}`);
});

// The steepest real stages (78-98 % faces): before 28/10/2026 every landing put the drop down level, so the next step
// launched it again off the face. Two bots racing the whole world (mass carried) spent 60 % of k2 stage 1, 43 % of
// everest stage 0 and 22 % of svizzera stage 0 in the air; following the slope on landing, 18, 7 and 5 %.
test('steep faces: the drops roll down them and fly only off real steps (under a quarter of the time in the air)', async () => {
  for (const [id, k] of [['k2', 1], ['everest', 0], ['svizzera', 0]]) {
    const w = await loadWorld(id, { dir: 'data/worlds', stages: [k] });
    const sim = createSim(w.stages[k], { players: 2, seed: 3 });
    const bots = [createBot(sim, 0), createBot(sim, 1, { preferShortcut: true })];
    let air = 0, racing = 0;
    for (let n = 0; n < 240 / DT && sim.state.phase !== 'done'; n++) {
      sim.step(DT, bots.map((b) => b.input()));
      for (const p of sim.state.players) if (p.status === 'rolling' || p.status === 'airborne' || p.status === 'frozen') { racing++; air += p.status === 'airborne'; }
    }
    assert.ok(racing > 0 && air / racing < 0.25, `${id} stage ${k}: ${((100 * air) / racing).toFixed(0)} % of the racing steps airborne`);
  }
});

// Playtest r1 (28/10/2026, docs/playtest/r1): on every mountain a sloppy player (late, heavy-handed, two bank crashes,
// drunk by animals, a third of the boosts) finished within 2 s of a clean one, or ahead, and with the bigger drop.
// Now the middle of the bed is the fast line, a bank hit costs speed and water, a boost through a water drop pays for
// itself and the rubber band is weak: the clean player wins nearly every race, by seconds, and ends with a drop as big.
test('skill pays on every mountain: a clean pilot beats a sloppy one by seconds and does not end with a small drop', async (t) => {
  const ids = ['dolomiti', 'antelao', 'svizzera', 'carpazi', 'everest', 'k2', 'indonesia'];
  const gaps = [], mass = [[], []];
  let wins = 0;
  for (const id of ids) {
    const w = await loadWorld(id, { dir: 'data/worlds' });
    for (const seed of [1, 2]) {
      const r = pilotRace(createRace, w, ['careful', 'sloppy'], { seed });
      const [clean, sloppy] = r.res;
      assert.ok(clean.finished && sloppy.finished, `${id} seed ${seed}: both finish inside the grace`);
      wins += clean.place === 1;
      gaps.push(sloppy.time - clean.time);
      r.mass.forEach((m, slot) => mass[slot].push(m));
    }
  }
  // two clean pilots end within about 4 s of each other either way, so a race or two can still go to the sloppy one
  assert.ok(wins >= gaps.length - 2, `the clean pilot won ${wins} of ${gaps.length}`);
  assert.ok(median(gaps) >= 3, `median gap ${median(gaps).toFixed(1)} s (${gaps.map((g) => g.toFixed(1)).join(' ')})`);
  assert.ok(Math.max(...gaps) < TUNING.grace, 'the sloppy one still makes it inside the grace');
  // the drop of the clean pilot grows too (it started at 1), and is not the visibly smaller one at the finish
  assert.ok(Math.min(...mass[0]) > 2.5, `clean pilot's final mass ${mass[0].map((m) => m.toFixed(1)).join(' ')}`);
  // the radius goes with the cube root of the mass: under 8 % smaller is not the visibly smaller drop (r1: 15 %)
  assert.ok(Math.cbrt(median(mass[0]) / median(mass[1])) > 0.92, `final mass clean ${median(mass[0]).toFixed(2)}, sloppy ${median(mass[1]).toFixed(2)}`);
  t.diagnostic(`gaps ${gaps.map((g) => g.toFixed(1)).join(' ')} s; mass clean ${mass[0].map((m) => m.toFixed(1)).join(' ')}, sloppy ${mass[1].map((m) => m.toFixed(1)).join(' ')}`);
});

test('a bank hit costs speed and water and buzzes the phone, a graze does not', () => {
  const W = syntheticWorld();
  const at = W.pointAt(0, 3900); // the valley, no rock near
  const hit = (into) => {
    const sim = raceSim();
    const sp = courseSpot(W, 3900, at.hw - 0.5);
    const rx = -at.tangent.z, rz = at.tangent.x;
    sim.place(0, sp, { mass: 2, vel: { x: at.tangent.x * 30 + rx * into, z: at.tangent.z * 30 + rz * into } });
    const v0 = Math.hypot(sim.state.players[0].vel.x, sim.state.players[0].vel.z);
    const ev = run(sim, 0.4, () => [{ x: 1, y: 1 }]); // steering into it
    const p = sim.state.players[0];
    return { ev: ev.filter((e) => e.kind === 'bump' && e.obstacle === 'bank'), v: Math.hypot(p.vel.x, p.vel.z), v0, mass: p.mass };
  };
  const hard = hit(14), graze = hit(2);
  assert.equal(hard.ev.length, 1, 'one bump on the bank');
  assert.ok(hard.ev[0].intensity >= 6 && hard.ev[0].lost > 0.04, `a buzz-strength bump (${hard.ev[0].intensity.toFixed(1)} m/s) that sprays mass`);
  assert.ok(hard.v < 0.8 * hard.v0, `speed ${hard.v0.toFixed(1)} -> ${hard.v.toFixed(1)} m/s`);
  assert.ok(graze.ev.length === 0 && graze.v > 0.9 * graze.v0, `a graze keeps its speed: ${graze.v.toFixed(1)} m/s`);
  assert.ok(graze.mass - hard.mass > 0.04, `mass ${hard.mass.toFixed(3)} vs ${graze.mass.toFixed(3)}`);
});

test('the current runs fastest down the middle of the bed: riding the bank is slower', () => {
  const W = syntheticWorld();
  const ride = (frac) => {
    const sim = raceSim();
    const sp = courseSpot(W, 3600, 0);
    sim.place(0, courseSpot(W, 3600, frac * sp.hw), { vel: { x: sp.tangent.x * 20, z: sp.tangent.z * 20 } });
    // hold the lane with a simple controller
    run(sim, 8, (k, s) => {
      const tr = s.track(0), p = s.state.players[0];
      const vl = p.vel.x * -tr.pathTangent.z + p.vel.z * tr.pathTangent.x;
      return [{ x: Math.max(-1, Math.min(1, 0.3 * (frac * tr.hw - tr.lateral) - 0.2 * vl)), y: 1 }];
    });
    return sim.track(0).sEq;
  };
  const middle = ride(0), bank = ride(0.85);
  assert.ok(middle > bank + 15, `8 s down the middle ${middle.toFixed(0)} m, along the bank ${bank.toFixed(0)} m`);
});

test('a boost through a water drop scoops up more than the boost costs', () => {
  const W = syntheticWorld();
  const take = (boost) => {
    const sim = raceSim();
    const pk = sim.state.pickups.find((k) => k.kind === 'water');
    const near = W.nearestCourse(pk.pos);
    sim.place(0, { x: pk.pos.x - near.tangent.x * 8, z: pk.pos.z - near.tangent.z * 8 }, { mass: 1.5, vel: { x: near.tangent.x * 20, z: near.tangent.z * 20 } });
    const m0 = sim.state.players[0].mass;
    const ev = run(sim, 0.5, (k) => [{ boost: boost && k === 0 }]);
    return { got: ev.find((e) => e.kind === 'pickup'), dm: sim.state.players[0].mass - m0 };
  };
  const plain = take(false), boosted = take(true);
  assert.ok(plain.got && boosted.got, 'both take the water drop');
  assert.ok(Math.abs(boosted.got.amount - TUNING.pickup.water * TUNING.pickup.boostBonus) < 1e-9, `boosted pickup ${boosted.got.amount}`);
  assert.ok(boosted.dm > 0.1 && boosted.got.amount - TUNING.boost.cost > 0.15, `net mass of the boost through it ${boosted.dm.toFixed(3)}`);
});
