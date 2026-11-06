// One race in short mode, stage by stage, with no DOM and no three.js (it runs in node for the tests).
// Each stage is its own sim (src/sim) created with the carry of the previous one, so mass, the race clock and
// the gap between the drops go on. Between two stages the drops ride the cloud: CLOUD.linger s to evaporate,
// then CLOUD.duration s of flight during which the next stage is swapped in at CLOUD.swapAt (cloud.t runs from
// -linger to duration); each drop then rains back in `delay` s after the leader (the sim's carry), so the order of
// the stage end is kept and its gap too, up to CLOUD.gapMax s: the rest of a longer gap is dead time the trailer
// would spend parked in its cloud, so the cloud lets it catch up (decision of 28/10/2026, after the first playtest).
// The finale: the sim gives the others T.grace s from the first finish; here the trailer also gets back the seconds
// it rained in late, and a drop still rolling within FINALE.near m of a line is waited for a little longer.
// A stage that fails to load holds the cloud at the top of its flight and is fetched again with a backoff; after
// CLOUD.failAfter failures (or CLOUD.stall s of holding) race.stalled says so, for the screen.
//
//   const race = createRace(world, { loadStage, bots: [false, true], seed: 1 });
//   race.step(1 / 60, [{x, y, boost, connected}, ...]);     // fixed step; bot slots ignore their input
//   race.phase  'countdown' | 'race' | 'cloud' | 'done';  race.sim, race.stage, race.cloud, race.events
//   race.results()                                         // once done
//   race.gap()     {leader, trailer, s, pending} while the gap is dead time for one drop (stage end, cloud, rain-in), or null
//   race.places()  [place of slot 0, place of slot 1]: the sim's live ranking, held at the stage-end order in the cloud
//   race.stalled   {stage, failures, error} while the cloud waits on a stage that does not load, or null
import { createSim } from '../sim/index.js';
import { createBot } from '../sim/bot.js';

export const CLOUD = {
  linger: 1.4, // s for the last drop to evaporate into its cloud before the flight starts (cloud.t < 0)
  duration: 3.6, // s of flight between two stages
  swapAt: 0.5, // fraction of the flight at which the next stage replaces the previous one
  // s an intermediate stage waits for the last drop once the first is through (a missing pad is waited for). It is
  // dead time for the leader, who watches the mountain it came down meanwhile (src/game/view.js, lookBack).
  wait: 8,
  // The carried gap is delay * gapScale, at most gapMax s: the longest the trailer hovers in its cloud over the next
  // start while the leader races (the playtest saw 8.5 and 15 s of it, stage after stage).
  gapScale: 1,
  gapMax: 3,
  retry: 1, // s before the first new fetch of a stage that failed to load; doubles per failure up to retryMax
  retryMax: 8,
  failAfter: 3, // failed fetches of one stage before race.stalled reports it
  stall: 10, // s of holding at the top of the flight before race.stalled reports it, failures or not
};

// A drop still rolling this close to the end of a stage when its time is up (CLOUD.wait, the sim's grace) gets up to
// `extra` more s to cross the line: the playtest cut one off 3 m from the valley floor.
export const FINALE = { near: 120, extra: 10 };

const SLOTS = 2;
const idle = { x: 0, y: 0, boost: false, connected: true };

// world = loadWorld() result; stages that are not loaded yet come from opts.loadStage(k) -> Promise<{json, height}>.
export function createRace(world, { loadStage, bots = [false, false], seed = 1, startStage = 0, tuning, cloud: cloudOpts } = {}) {
  const C = { ...CLOUD, ...cloudOpts };
  const stages = world.json.stages;
  const last = stages.length - 1;
  const first = Math.max(0, Math.min(last, startStage | 0));
  const data = world.stages.slice();
  const loading = new Map();
  const drank = Array.from({ length: SLOTS }, () => ({}));
  const peak = Array(SLOTS).fill(0); // the biggest mass each drop reached, for the results
  const stageTimes = Array.from({ length: SLOTS }, () => []);
  const rodeFrom = Array(SLOTS).fill(0); // race clock at which each drop started the stage being played
  let k = first, sim = null, pilots = [], phase = 'countdown', cloud = null, carried = null, waitT = 0;
  let extraT = 0, graced = false; // s of FINALE.extra used on this stage; the trailer's late rain added to the grace
  let events = [];
  let error = null;
  const failures = new Map(); // stage -> failed fetches
  let holdT = 0, retryAt = 0; // s held at the top of the flight waiting for the next stage, next fetch at
  const raining = new Set(); // slots of the stage just begun still waiting in the cloud to rain in

  function load(i) {
    if (data[i] || i > last) return Promise.resolve(data[i]);
    if (!loading.has(i)) {
      if (!loadStage) throw new Error(`createRace: stage ${i} is not loaded and there is no loadStage`);
      loading.set(i, Promise.resolve(loadStage(i)).then((s) => { data[i] = s; error = null; return s; }, (e) => {
        error = e;
        failures.set(i, (failures.get(i) || 0) + 1);
        loading.delete(i);
        throw e;
      }));
    }
    return loading.get(i);
  }

  // The splits: stageTimes[slot][k] is the time that drop has spent riding up to the end of stage k, each stage from
  // its rain-in (rodeFrom, race clock) to its line or to the cloud. A gap the cloud cut (CLOUD.gapMax) is not ridden, so
  // a trailer's last stage time is its race time plus the seconds the cloud gave back.
  function ride(slot, at) {
    stageTimes[slot][k] = (k > first ? stageTimes[slot][k - 1] ?? 0 : 0) + at - rodeFrom[slot];
  }

  function begin(i, carry) {
    if (!data[i]) throw new Error(`stage ${i} is not loaded`);
    k = i;
    for (let s = 0; s < SLOTS; s++) rodeFrom[s] = carry ? carry.t - carry.raceStart + (carry.players[s]?.delay || 0) : 0;
    sim = createSim(data[i], { players: SLOTS, seed: seed + i * 101, tuning, final: i === last, carry });
    pilots = bots.map((b, slot) => (b ? createBot(sim, slot, { seed: seed * 31 + slot + i, preferShortcut: slot === 1 && i % 2 === 0 }) : null));
    waitT = 0; extraT = 0; graced = false;
    raining.clear();
    if (carry) for (const p of carry.players) if (p.delay > 0) raining.add(p.slot);
  }

  const ready = load(first).then(() => { if (!sim) begin(first, null); });
  if (data[first]) begin(first, null);

  function startCloud() {
    carried = sim.carry();
    for (const p of carried.players) p.delay = Math.min(p.delay * C.gapScale, C.gapMax);
    // a drop the cloud took before its line rode this stage until now
    for (const p of sim.state.players) if (p.status !== 'finished') ride(p.slot, sim.state.t - carried.raceStart);
    const from = sim.state.players.map((p) => ({ x: p.pos.x, y: p.pos.y, z: p.pos.z }));
    const delays = carried.players.map((p) => p.delay);
    const order = carried.players.slice().sort((a, b) => a.delay - b.delay).map((p) => p.slot);
    cloud = { t: -C.linger, duration: C.duration, swapAt: C.swapAt, from: k, to: k + 1, swapped: false, fromPos: from, toPos: null, delays, order };
    phase = 'cloud';
    events.push({ kind: 'cloud', from: k, to: k + 1, delays });
    holdT = 0; retryAt = C.retry;
    load(k + 1).catch(() => {});
  }

  function swap() {
    const fromOffset = stages[k].offset;
    begin(k + 1, carried);
    cloud.swapped = true;
    cloud.toPos = sim.state.players.map((p) => ({ x: p.pos.x, y: p.pos.y, z: p.pos.z }));
    cloud.fromOffset = fromOffset;
    events.push({ kind: 'stage', stage: k, from: k - 1 });
  }

  function inputsFor(given) {
    const out = [];
    for (let s = 0; s < SLOTS; s++) out.push(pilots[s] ? { ...pilots[s].input(), connected: true } : given?.[s] || idle);
    return out;
  }

  function step(dt, inputs) {
    events = [];
    if (!sim || phase === 'done') return api;
    if (phase === 'cloud') {
      cloud.t += dt;
      if (!cloud.swapped && cloud.t >= cloud.duration * cloud.swapAt) {
        if (data[cloud.to]) swap();
        else {
          // hold at the top until the next stage is there, fetching it again with a backoff
          cloud.t = cloud.duration * cloud.swapAt;
          holdT += dt;
          if (holdT >= retryAt && !loading.has(cloud.to)) {
            load(cloud.to).catch(() => {});
            retryAt = holdT + Math.min(C.retryMax, C.retry * 2 ** (failures.get(cloud.to) || 0));
          }
        }
      }
      if (cloud.swapped && cloud.t >= cloud.duration) { phase = 'race'; cloud = null; }
      return api;
    }
    const before = sim.state.phase;
    const ins = inputsFor(inputs);
    // the sim's grace runs out this step with a drop about to cross the valley floor: hold it a little longer
    const g = sim.state.grace;
    if (sim.state.final && g !== null && g <= dt + 1e-9 && closing()) { sim.state.grace = g + dt; extraT += dt; }
    sim.step(dt, ins);
    const st = sim.state;
    for (const p of st.players) if (p.mass > peak[p.slot]) peak[p.slot] = p.mass;
    // the grace counts from the first finish, but the trailer rained into this stage up to CLOUD.gapMax s later
    if (st.final && st.grace !== null && !graced) {
      graced = true;
      st.grace += Math.max(0, ...(carried?.players || []).filter((p) => st.players[p.slot].status !== 'finished').map((p) => p.delay));
    }
    for (const e of st.events) {
      if (e.kind === 'respawn' && e.reason === 'rain') raining.delete(e.slot);
      if (e.kind === 'drink' && e.animalKind) drank[e.slot][e.animalKind] = (drank[e.slot][e.animalKind] || 0) + 1;
      if (e.kind === 'finish') {
        ride(e.slot, e.time);
        if (!st.final) load(k + 1).catch(() => {});
      }
      events.push(e);
    }
    if (before === 'countdown' && st.phase === 'race') events.push({ kind: 'go', stage: k });
    if (st.phase === 'race') phase = 'race';
    // An intermediate stage: once a drop is through, the others get CLOUD.wait s while their pad is there.
    if (!st.final && st.phase === 'race' && st.players.some((p) => p.status === 'finished')) {
      const late = st.players.filter((p) => p.status !== 'finished');
      if (late.length && late.every((p) => p.connected)) waitT += dt;
      if (waitT >= C.wait && closing()) { waitT = C.wait; extraT += dt; }
      if (waitT >= C.wait) st.phase = 'done';
    }
    if (st.phase === 'done') {
      if (st.final) { phase = 'done'; events.push({ kind: 'over' }); }
      else startCloud();
    }
    return api;
  }

  // A drop of a human still rolling within FINALE.near m of the end of the stage, while FINALE.extra lasts.
  function closing() {
    if (extraT >= FINALE.extra) return false;
    const end = sim.world.sFinish;
    return sim.state.players.some((p) => p.status !== 'finished' && p.status !== 'evaporated' && p.connected && end - p.dist <= FINALE.near);
  }

  // The gap while it is dead time for one of the drops: the leader through an intermediate stage end waits for the
  // trailer, both ride the cloud, the trailer waits to rain into the next stage. Positive seconds, or null. pending:
  // the trailer is still racing to the stage end, so s is the time since the leader finished, not the gap yet.
  function gap() {
    let delays = null, pending = false;
    if (phase === 'cloud') delays = cloud.delays;
    else if (phase === 'race' && sim) {
      const ps = sim.state.players;
      if (!sim.state.final && ps.some((p) => p.status === 'finished') && ps.some((p) => p.status !== 'finished')) { delays = sim.carry().players.map((p) => p.delay); pending = true; }
      else if (raining.size && carried) delays = carried.players.map((p) => p.delay);
    }
    if (!delays) return null;
    const leader = delays[0] <= delays[1] ? 0 : 1, trailer = 1 - leader;
    const s = delays[trailer] - delays[leader];
    return s >= 0.05 ? { leader, trailer, s, pending } : null;
  }

  // Places for the HUD. In the cloud the sim does not step (and the next stage's sim starts from slot order), so the
  // places stay at the stage-end order, the one the rain-in delays keep (cloud.order).
  function places() {
    if (phase === 'cloud' && cloud?.order) { const out = []; cloud.order.forEach((slot, i) => { out[slot] = i + 1; }); return out; }
    return (sim?.state.players || []).map((p) => p.place);
  }

  const api = {
    step,
    gap,
    places,
    ready,
    get phase() { return phase; },
    get sim() { return sim; },
    get state() { return sim?.state ?? null; },
    get stage() { return k; },
    get stages() { return stages.length; },
    get first() { return first; },
    get final() { return k === last; },
    get cloud() { return cloud; },
    get events() { return events; },
    get error() { return error; },
    get stalled() {
      if (phase !== 'cloud' || cloud.swapped || data[cloud.to]) return null;
      const n = failures.get(cloud.to) || 0;
      return n >= C.failAfter || holdT >= C.stall ? { stage: cloud.to, failures: n, error } : null;
    },
    get bots() { return bots.slice(); },
    isBot: (slot) => !!bots[slot],
    stageJson: (i = k) => stages[i],
    stageData: (i = k) => data[i] || null,
    drank: (slot) => ({ ...drank[slot] }),
    // Final standings: finishers by place, the others did not finish.
    results() {
      const ps = sim?.state.players || [];
      return ps.map((p) => ({
        slot: p.slot,
        place: p.status === 'finished' ? p.place : null,
        time: p.status === 'finished' ? p.finishTime : null,
        finished: p.status === 'finished',
        bot: !!bots[p.slot],
        drank: { ...drank[p.slot] },
        peak: peak[p.slot] || p.mass,
        stageTimes: stageTimes[p.slot].slice(),
      }));
    },
  };
  return api;
}

// Altitude above sea level of a drop on stage `stageJson` (positions are in the stage's local frame).
export function altitudeOf(stageJson, p) {
  return p.pos.y - p.radius + (stageJson?.offset?.y ?? 0);
}
