// Two human-like pilots for the balance tests, modelled on the r1 playtests of 28/10/2026 (docs/playtest/r1/*):
// both follow what the bot would do, through a reaction delay. `careful` reacts in 50-150 ms with a little noise and
// presses SCATTO when the bot would; `sloppy` reacts in 200-350 ms, steers 1.7x too hard, holds a stale stick now
// and then, drives into a bank at full lock twice (stage 0 after 22 s, then the first seconds of stage 2), hugs the
// bank of the next animal until it has been drunk a few times, and presses only a third of the advised boosts.
// Seeded, so a race is the same every run.
import { createBot } from '../../src/sim/bot.js';
import { createRng } from '../../src/sim/rng.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createPilot(kind, slot, { seed = 1 } = {}) {
  const rng = createRng(seed * 977 + slot * 31 + (kind === 'sloppy' ? 5 : 0));
  const sloppy = kind === 'sloppy';
  let sim = null, bot = null, hist = [], stage = -1, stageT = 0;
  let crashes = 0, crashLeft = 0, crashSide = 1, holdLeft = 0, hold = null, dawdled = 0, drinks = 0, prevBoost = false, skipBoost = 0;
  return {
    get crashes() { return crashes; },
    input(race) {
      if (race.sim !== sim) { sim = race.sim; bot = createBot(sim, slot, { seed: seed * 31 + slot + race.stage }); hist = []; stage = race.stage; stageT = 0; }
      const st = sim.state, p = st.players[slot];
      const advised = bot.input();
      hist.push(advised);
      if (st.phase !== 'race' || race.phase !== 'race') return { x: 0, y: 0, boost: false };
      stageT += 1 / 60;
      for (const e of st.events) if (e.kind === 'drink' && e.slot === slot) drinks++;
      const lag = Math.round((sloppy ? rng.range(200, 350) : rng.range(50, 150)) / (1000 / 60));
      const late = hist[Math.max(0, hist.length - 1 - lag)];
      if (hist.length > 60) hist.shift();
      let x = clamp(late.x * (sloppy ? 1.7 : 1) + rng.range(-0.05, 0.05), -1, 1), y = late.y;
      let boost = late.boost;
      if (!sloppy) return { x, y, boost };
      // one advised boost in three: a skipped one is let go for the next second of advice
      skipBoost = Math.max(0, skipBoost - 1 / 60);
      if (boost && (skipBoost > 0 || rng.next() >= 0.33)) { boost = false; if (!skipBoost) skipBoost = 1; }
      if (holdLeft <= 0 && rng.next() < 0.004) { hold = { x, y }; holdLeft = 0.6; }
      if (holdLeft > 0) { holdLeft -= 1 / 60; ({ x, y } = hold); }
      const crashNow = p.status === 'rolling' && !crashLeft && ((stage === 0 && stageT > 22 && crashes === 0) || (stage === 2 && crashes === 1 && stageT > 2));
      // into the bank it is already drifting toward (steering at the inside of a bend at speed only holds the line)
      if (crashNow) {
        const tr = sim.track(slot), vl = p.vel.x * -tr.pathTangent.z + p.vel.z * tr.pathTangent.x;
        crashLeft = 2.6; crashSide = tr.lateral + 0.5 * vl < 0 ? -1 : 1; crashes++;
      }
      if (crashLeft > 0) { crashLeft = Math.max(0, crashLeft - 1 / 60); return { x: crashSide, y: 1, boost: false }; }
      // the bank of the next animal ahead, until it has drunk a few sips (45 s of trying at most)
      if (p.status === 'rolling' && drinks < 4 && dawdled < 45) {
        const sp = Math.hypot(p.vel.x, p.vel.z) || 1, ux = p.vel.x / sp, uz = p.vel.z / sp;
        let best = null, bd = 150;
        for (const a of st.animals) {
          const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z), ahead = (a.pos.x - p.pos.x) * ux + (a.pos.z - p.pos.z) * uz;
          if (a.kind !== 'eagle' && a.state !== 'startled' && d < bd && (a.state === 'approach' || a.state === 'drink' || ahead > -4)) { bd = d; best = a; }
        }
        if (best) { x = clamp(((best.pos.x - p.pos.x) * -uz + (best.pos.z - p.pos.z) * ux) / 6, -0.45, 0.45); y = 1; boost = false; dawdled += 1 / 60; }
      }
      // a press is an edge: the stale or filtered advice must not hold the button down
      const out = boost && !prevBoost;
      prevBoost = boost;
      return { x, y, boost: out };
    },
  };
}

// A whole race on `world` (loadWorld with every stage) between two pilots; results by slot.
export function pilotRace(createRace, world, kinds = ['careful', 'sloppy'], { seed = 1, tuning } = {}) {
  const race = createRace(world, { bots: [false, false], seed, tuning });
  const pilots = kinds.map((k, slot) => createPilot(k, slot, { seed }));
  const ev = [{}, {}], stageMass = [];
  for (let n = 0; n < 900 * 60 && race.phase !== 'done'; n++) {
    const ins = race.phase === 'cloud' ? [] : pilots.map((pl) => ({ ...pl.input(race), connected: true }));
    race.step(1 / 60, ins);
    for (const e of race.events) {
      if (e.slot === 0 || e.slot === 1) ev[e.slot][e.kind] = (ev[e.slot][e.kind] || 0) + 1;
      if (e.kind === 'cloud' || e.kind === 'over') stageMass.push(race.state.players.map((p) => p.mass));
    }
  }
  return { res: race.results(), ev, mass: race.state.players.map((p) => p.mass), stageMass, crashes: pilots.map((p) => p.crashes) };
}
