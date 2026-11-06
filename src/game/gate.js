// When BOOST on the phones starts a race or leaves the results. Pure: per-frame readings in, decisions out, so the
// rules are tested in node.
//
// Lobby: a BOOST press marks that phone ready. Two phones: the race starts once both are ready. One phone: the race
// against a bot starts only when that player holds BOOST for GATE.hold s, so a curious tap before the second phone
// has scanned the QR does not start a race that phone then cannot join.
// Results: BOOST does nothing for GATE.lock s (the losing player may still be mashing it to break the ice), then a
// tap (press and release) makes that phone ready for the rematch, which starts once every phone is (one tap used
// to restart the race for both, the other player still reading the results); a hold of GATE.hold s on any phone
// goes back to the lobby and its QR.
//
//   const lobby = createLobbyGate();
//   const { start, ready, hold } = lobby.step(dt, humans, boosts);           // humans[slot], boosts[slot]: booleans
//   const results = createResultsGate();
//   const { action, lock, hold, ready } = results.step(dt, boosts, humans);  // action: null | 'rematch' | 'lobby'

export const GATE = {
  hold: 1.5, // s of BOOST held: a solo race against a bot from the lobby, back to the lobby from the results
  lock: 2.5, // s after the results appear during which BOOST is ignored
};

const SLOTS = 2;

export function createLobbyGate(rules = GATE) {
  const ready = Array(SLOTS).fill(false);
  const was = Array(SLOTS).fill(false);
  const held = Array(SLOTS).fill(0);
  return {
    // humans[slot]: a phone (or the keyboard) is on that slot; boosts[slot]: BOOST is down this frame.
    step(dt, humans, boosts) {
      for (let s = 0; s < SLOTS; s++) {
        const b = !!humans[s] && !!boosts[s];
        if (!humans[s]) ready[s] = false;
        if (b && !was[s]) ready[s] = true;
        held[s] = b ? held[s] + dt : 0;
        was[s] = b;
      }
      const on = [...Array(SLOTS).keys()].filter((s) => humans[s]);
      const solo = on.length === 1 ? on[0] : -1;
      const start = on.length > 1 ? on.every((s) => ready[s]) : solo >= 0 && held[solo] >= rules.hold;
      return { start, ready: ready.slice(), solo, hold: solo >= 0 ? Math.min(1, held[solo] / rules.hold) : 0 };
    },
    get ready() { return ready.slice(); },
    reset() { ready.fill(false); was.fill(false); held.fill(0); },
  };
}

// humans[slot]: a phone (or the keyboard) is on that slot; without it every slot that taps counts as the only one.
export function createResultsGate(rules = GATE) {
  let t = 0;
  const was = Array(SLOTS).fill(false);
  const press = Array(SLOTS).fill(null); // s held of a press that began after the lock, or null
  const ready = Array(SLOTS).fill(false); // tapped for the rematch
  return {
    step(dt, boosts, humans = null) {
      t += dt;
      const open = t >= rules.lock;
      let action = null, hold = 0;
      for (let s = 0; s < SLOTS; s++) {
        const b = !!boosts[s];
        if (b && !was[s] && open) press[s] = 0; // a press already down when the lock ends never counts
        if (press[s] !== null) {
          if (b) {
            press[s] += dt;
            if (press[s] >= rules.hold) { action = 'lobby'; press[s] = null; } else hold = Math.max(hold, press[s] / rules.hold);
          } else {
            ready[s] = true;
            press[s] = null;
          }
        }
        was[s] = b;
        if (humans && !humans[s]) ready[s] = false;
      }
      const on = humans ? [...Array(SLOTS).keys()].filter((s) => humans[s]) : ready.flatMap((r, s) => (r ? [s] : []));
      if (!action && on.length && on.every((s) => ready[s])) action = 'rematch';
      return { action, lock: Math.min(1, t / rules.lock), hold, ready: ready.slice() };
    },
    get open() { return t >= rules.lock; },
    get ready() { return ready.slice(); },
    reset() { t = 0; was.fill(false); press.fill(null); ready.fill(false); },
  };
}
