// The pieces of tools/perf/harness.mjs the end to end test leans on, without a browser: the dictionary check
// that decides whether a visible string belongs to a language, the thumb position that makes the real pad
// page send a given stick vector, and the end-of-race check against the grace, fed by a real sim.
// (test/e2e-drive.test.mjs drives the real pad page with the thumbs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, translator } from '../src/i18n/index.js';
import { TUNING } from '../src/sim/tuning.js';
import { loadWorld } from '../src/world/load.js';
import { createRace } from '../src/game/race.js';
import { foreignStrings, thumbFor, finishProblems } from '../tools/perf/harness.mjs';

const texts = (list) => list.map((text) => ({ text }));

test('foreignStrings: dictionary text passes, the other language and stray text are caught', () => {
  const it = translator('it'), en = translator('en');
  const shown = [it('ui.start'), it('ui.go'), it('ui.hud.stage', { n: 2, total: 4 }), it('ui.hud.altitude', { m: '2.431' }), it('ui.player', { n: 1 }),
    '1', '°', '3:20,30', '192.168.1.20:5190/pad', '×2', 'Alta Val Sesis', 'Appoggia il pollice', 'e trascina per sterzare'];
  assert.deepEqual(foreignStrings(texts(shown), DICTS, 'it', { labels: ['Alta Val Sesis'] }), { bad: [], wrongLang: [] });
  const r = foreignStrings(texts([en('ui.start'), en('ui.results.title'), 'Upper Val Sesis', 'Loading...']), DICTS, 'it', { labels: ['Alta Val Sesis'] });
  assert.deepEqual(r.wrongLang, [en('ui.start'), en('ui.results.title')]);
  assert.deepEqual(r.bad, ['Upper Val Sesis', 'Loading...']);
  assert.deepEqual(foreignStrings(texts([it('ui.rematch'), en('ui.rematch')]), DICTS, 'en').wrongLang, [it('ui.rematch')]);
});

test('thumbFor: the thumb lands where controller/pad.js reads back the wanted vector', () => {
  const geo = { sx: 250, sy: 230, R: 78 };
  const DEAD = 0.12;
  // what the pad computes from a thumb offset (controller/pad.js stickMove, inside the rim)
  const read = ({ x, y }) => {
    const dx = x - geo.sx, dy = y - geo.sy, d = Math.hypot(dx, dy), mag = d / geo.R;
    if (mag <= DEAD) return { x: 0, y: 0 };
    const m = (mag - DEAD) / (1 - DEAD);
    return { x: (dx / d) * m, y: (-dy / d) * m };
  };
  for (const [x, y] of [[0, 1], [0.5, 0.5], [-0.3, 0.2], [0.9, -0.1]]) {
    const got = read(thumbFor(geo, x, y));
    assert.ok(Math.abs(got.x - x) < 1e-3 && Math.abs(got.y - y) < 1e-3, `${x},${y} -> ${got.x},${got.y}`);
  }
  assert.deepEqual(thumbFor(geo, 0, 0), { x: 250, y: 230 });
  // full deflection stays just inside the rim, so the floating base never slides away
  const far = thumbFor(geo, 1, 0);
  assert.ok(far.x - geo.sx < geo.R && far.x - geo.sx > 0.999 * geo.R);
});

// The last stage of the real world raced the way src/main.js does it, and what window.__game then holds once the
// results show: t (the sim's state.t) and race.results(). A slot without a bot is a phone held braking.
const world = await loadWorld('dolomiti', { dir: 'data/worlds' });
function raceOver(bots) {
  const race = createRace(world, { bots, seed: 4, startStage: world.json.stages.length - 1 });
  const brake = { x: 0, y: -1, boost: false, connected: true };
  for (let k = 0; k < 600 / TUNING.dt && race.phase !== 'done'; k++) race.step(TUNING.dt, [brake, brake]);
  assert.equal(race.phase, 'done');
  const t = race.state.t;
  // the host keeps stepping the race through the finish cloud and the results: the clock stays where the race ended
  for (let k = 0; k < 300; k++) race.step(TUNING.dt, [brake, brake]);
  assert.equal(race.state.t, t, 'the race clock stops with the race');
  return { t, results: race.results() };
}

test('finishProblems: the sim ends the race grace s after the first finish, or on the last one', () => {
  const dnf = raceOver([true, false]);
  assert.equal(dnf.results.filter((p) => p.finished).length, 1);
  assert.deepEqual(finishProblems(dnf, TUNING), []);
  const both = raceOver([true, true]);
  assert.equal(both.results.filter((p) => p.finished).length, 2);
  assert.deepEqual(finishProblems(both, TUNING), []);

  // what it is there to catch
  const early = { ...dnf, t: dnf.t - 5 };
  assert.match(finishProblems(early, TUNING).join(), /slot 1 did not finish, and the race ended 2\d\.\d+ s after the first finish/);
  const ranOn = { ...both, t: both.t + 1 };
  assert.match(finishProblems(ranOn, TUNING).join(), /everyone finished .* ran on/);
  const late = { ...both, t: both.t - 1 };
  assert.match(finishProblems(late, TUNING).join(), /after the race ended/);
  assert.deepEqual(finishProblems({ t: 100, results: [{ slot: 0, finished: false }, { slot: 1, finished: false }] }, TUNING), ['nobody finished']);
});
