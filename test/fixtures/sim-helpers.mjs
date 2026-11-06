// Shared setup for the sim tests: one synthetic world per process, race sims past the countdown.
import { generateSyntheticWorld } from './synthetic-world.mjs';
import { createWorldAccess, createSim } from '../../src/sim/index.js';

let cached = null;
export function syntheticWorld() {
  if (!cached) {
    const { json, height, backdrop } = generateSyntheticWorld();
    cached = createWorldAccess(json, height, backdrop);
  }
  return cached;
}

export const DT = 1 / 60;

// A sim already in the 'race' phase (countdown stepped through with no input).
export function raceSim({ players = 1, seed = 1, tuning } = {}) {
  const sim = createSim(syntheticWorld(), { players, seed, tuning });
  while (sim.state.phase === 'countdown') sim.step(DT, []);
  return sim;
}

// Steps for `seconds`, calling input(stepIndex, sim) for the inputs array; returns every event.
export function run(sim, seconds, input = () => [], until = null) {
  const events = [];
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) {
    sim.step(DT, input(k, sim));
    for (const e of sim.state.events) events.push({ ...e, t: sim.state.t });
    if (until && until(sim, events)) break;
  }
  return events;
}

// Course point with its tangent, at arc length s, shifted `lateral` meters to the right.
export function courseSpot(W, s, lateral = 0) {
  const q = W.pointAt(0, s);
  return { x: q.cx - q.tangent.z * lateral, z: q.cz + q.tangent.x * lateral, tangent: q.tangent, hw: q.hw, index: q.index };
}

export const momentum = (ps) => ps.reduce((a, p) => ({ x: a.x + p.mass * p.vel.x, z: a.z + p.mass * p.vel.z }), { x: 0, z: 0 });
