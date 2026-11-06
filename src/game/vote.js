// The mountain vote in the lobby. Pure: what each phone looks at and votes for in, what the TV and the phones show
// out, so the rules are tested in node.
//
// Each phone browses the mountains (focus: the card it shows, a hollow marker on the TV) and votes with a tap on the
// card or BOOST (ballot: the focused card, a pin on the TV); it may vote again until the vote closes. The lobby gate
// (gate.js) closes it: two phones once both voted, one phone once its BOOST is held. Then:
//   - the same mountain on both: 'agree', both drops cheer on it for VOTE.agree s;
//   - two different ones: 'roll', a coin flip between the two that spins for VOTE.roll s and rests on the winner
//     for VOTE.land s; a RANDOM ballot stands for any mountain, so the spin runs over all of them;
//   - one ballot (a solo player): 'agree' for VOTE.solo s; RANDOM spins as above; no ballot: the current world.
// A phone that leaves while the result is showing reopens the vote: the race would start without it.
//
//   const vote = createVote({ worlds: ['dolomiti', 'antelao'], current: 'dolomiti' });
//   vote.focus(slot, id); vote.press(slot); vote.close([true, true]);
//   const v = vote.step(dt);   // { phase: 'vote'|'agree'|'roll'|'done', focus, ballot, pick, spin, winner, ... }
import { RANDOM } from './mountains.js';

export { RANDOM };
export const VOTE = {
  agree: 2.6, // s both drops cheer on the card they agree on
  solo: 1.4, // s a single ballot is shown before the race
  roll: 3.4, // s the coin flip spins
  land: 1.8, // s it rests on the winner
  turns: 14, // highlight steps of the spin, at least (more to land on the winner)
};

const SLOTS = 2;
const ease = (u) => 1 - (1 - u) ** 3;

export function createVote({ worlds, current = worlds[0], rng = Math.random, rules = VOTE } = {}) {
  const ids = [...worlds];
  const ok = (id) => ids.includes(id) || id === RANDOM;
  const focus = Array(SLOTS).fill(null);
  const ballot = Array(SLOTS).fill(null);
  let phase = 'vote', t = 0, pick = null, winner = -1, candidates = [], steps = 0, from = 0, length = 0;
  const randomWorld = () => ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))];

  // The card the spin highlights at time t: an ease-out walk over the candidates that stops on the pick.
  function spinAt(time) {
    if (phase !== 'roll' && phase !== 'done') return null;
    if (!candidates.length) return pick;
    const u = Math.min(1, time / rules.roll);
    return candidates[(from + Math.floor(steps * ease(u) + 1e-9)) % candidates.length];
  }

  function startRoll(cands) {
    candidates = cands;
    const n = cands.length;
    from = rng() < 0.5 ? 0 : n - 1;
    // at least rules.turns steps, and as many more as it takes to stop on the pick
    const target = cands.indexOf(pick);
    steps = rules.turns + (((target - from - rules.turns) % n) + n) % n;
    phase = 'roll';
    length = rules.roll + rules.land;
  }

  const api = {
    get phase() { return phase; },
    get pick() { return pick; },
    get worlds() { return ids.slice(); },
    get current() { return current; },
    set current(id) { if (ids.includes(id)) current = id; },

    // The phone shows this card. Nothing changes once the vote is closed.
    focus(slot, id) {
      if (phase !== 'vote' || !(slot in focus) || !ok(id)) return false;
      focus[slot] = id;
      return true;
    },
    // A vote: the card the phone shows (or the current world, for a phone that never browsed).
    press(slot) {
      if (phase !== 'vote' || !(slot in ballot)) return false;
      ballot[slot] = focus[slot] ?? current;
      return true;
    },
    // The phone went away: its ballot goes (it keeps its place in the gallery), and a result being shown is undone.
    leave(slot) {
      if (!(slot in ballot)) return false;
      ballot[slot] = null;
      if (phase === 'agree' || phase === 'roll') { phase = 'vote'; t = 0; pick = null; winner = -1; candidates = []; return true; }
      return false;
    },

    // The gate closed the vote; present[slot]: a player is on that slot. Ballots of absent slots do not count.
    close(present = [true, true]) {
      if (phase !== 'vote') return null;
      const votes = [];
      for (let s = 0; s < SLOTS; s++) if (present[s] && ballot[s]) votes.push({ slot: s, id: ballot[s] });
      t = 0;
      winner = -1;
      if (!votes.length) { pick = current; candidates = []; phase = 'agree'; length = rules.solo; return pick; }
      const same = votes.every((v) => v.id === votes[0].id);
      if (same && votes[0].id !== RANDOM) {
        pick = votes[0].id; candidates = [];
        phase = 'agree';
        length = votes.length > 1 ? rules.agree : rules.solo;
        return pick;
      }
      // a coin flip between the ballots; the winner's RANDOM is any mountain
      const w = same ? votes[0] : votes[rng() < 0.5 ? 0 : 1];
      winner = same ? -1 : w.slot;
      pick = w.id === RANDOM ? randomWorld() : w.id;
      const any = votes.some((v) => v.id === RANDOM);
      startRoll(any ? ids.slice() : [...new Set(votes.map((v) => v.id))].sort((a, b) => ids.indexOf(a) - ids.indexOf(b)));
      return pick;
    },

    // Advances the result being shown; returns the snapshot. 'done' once it has been shown long enough.
    step(dt) {
      if (phase === 'agree' || phase === 'roll') {
        t += dt;
        if (t >= length) phase = 'done';
      }
      return api.snapshot();
    },

    snapshot() {
      return {
        phase, t, pick, winner, candidates: candidates.slice(),
        focus: focus.slice(), ballot: ballot.slice(),
        spin: spinAt(t),
        landed: phase === 'done' || (phase === 'roll' && t >= rules.roll),
      };
    },

    // Back to an open vote (a new lobby), the ballots cleared; the phones keep the card they were looking at.
    reset(next = current) {
      if (ids.includes(next)) current = next;
      ballot.fill(null);
      phase = 'vote'; t = 0; pick = null; winner = -1; candidates = []; steps = 0; length = 0;
    },
  };
  return api;
}
