// What the race tells the host HUD and the results, beyond the sim's own state: the places held at the stage-end
// order while the drops ride the cloud (the next stage's sim starts from slot order and does not step in the
// cloud), a gap that says whether it is final or still the time since the leader finished, and each drop's
// peak mass. Playtest 28/10: the trailer read "1st" during the evaporation, the leader "+0.1 s ahead".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from '../src/world/load.js';
import { createRace } from '../src/game/race.js';

const DT = 1 / 60;
const world = await loadWorld('dolomiti', { dir: 'data/worlds' });

// a bot race to the end, recording what the HUD would be given at every step
function record(seed) {
  const race = createRace(world, { bots: [true, true], seed });
  const seen = { cloud: [], pending: [], final: [], peak: [0, 0] };
  for (let t = 0; race.phase !== 'done' && t < 1200; t += DT) {
    race.step(DT, []);
    for (const p of race.state.players) seen.peak[p.slot] = Math.max(seen.peak[p.slot], p.mass);
    const g = race.gap();
    if (race.phase === 'cloud') seen.cloud.push({ places: race.places(), order: race.cloud.order.slice(), from: race.cloud.from, swapped: race.cloud.swapped });
    else if (g?.pending) seen.pending.push(g);
    else if (g) seen.final.push(g);
  }
  return { race, seen };
}

test('in the cloud the places stay at the stage-end order, before and after the next stage is swapped in', () => {
  // a race where pink is through a stage end first: the swapped-in sim says blue is 1st until it steps (the bots'
  // tuning moves, so the seed is looked for rather than fixed)
  let seen = null;
  for (let seed = 1; seed <= 12 && !seen; seed++) { const r = record(seed).seen; if (r.cloud.some((c) => c.order[0] === 1)) seen = r; }
  assert.ok(seen, 'some race has pink through a stage end first');
  assert.ok(seen.cloud.length > 60, 'the cloud was flown');
  assert.ok(seen.cloud.some((c) => c.swapped), 'including after the swap');
  for (const c of seen.cloud) {
    assert.equal(c.places[c.order[0]], 1, 'the first through the stage end is 1st');
    assert.equal(c.places[c.order[1]], 2);
  }
});

test('the gap is pending while the trailer still races to the stage end, final once both are through', () => {
  const { seen } = record(3);
  assert.ok(seen.pending.length > 10, 'the leader waited for the trailer');
  assert.ok(seen.pending.every((g) => g.pending === true));
  assert.ok(seen.pending.at(-1).s > seen.pending[0].s, 'pending: it counts up from the leader\'s finish');
  assert.ok(seen.final.length > 0 && seen.final.every((g) => g.pending === false));
});

test('results carry each drop\'s peak mass', () => {
  const { race, seen } = record(5);
  for (const r of race.results()) {
    assert.ok(Number.isFinite(r.peak) && r.peak > 0.25, `slot ${r.slot} peak ${r.peak}`);
    assert.ok(Math.abs(r.peak - seen.peak[r.slot]) < 1e-9);
  }
});
