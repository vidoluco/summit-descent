// What the phones get from the race (network contract): {t:'fx', slot, kind} to buzz in sync with what
// happens on screen, and {t:'hud', slot, mass, place} so the pad shows the drop's size and place.
// Pure: events in, messages out, so the mapping is tested in node.

// Sim events worth a buzz. Bumps, splashes and rocks only when hard, so the phone does not rattle all race.
export const FX_RULES = {
  bump: 6, // m/s closing speed between the drops (or into a rock)
  splash: 9, // m/s vertical impact on landing
  drinkGap: 0.7, // s between two drink buzzes of one slot
};

// events of one fixed step (or of one frame) -> [{slot, kind, place?}]; lastDrink[slot] = race clock of the
// last drink buzz (kept by the caller); t = race clock now.
export function padFx(events, { t = 0, lastDrink = [-Infinity, -Infinity], rules = FX_RULES } = {}) {
  const out = [];
  for (const e of events || []) {
    if (!Number.isInteger(e.slot) || e.slot < 0 || e.slot > 1) continue;
    switch (e.kind) {
      case 'freeze': out.push({ slot: e.slot, kind: 'freeze' }); break;
      case 'thaw': out.push({ slot: e.slot, kind: 'thaw' }); break;
      case 'drink':
        if (t - lastDrink[e.slot] >= rules.drinkGap) { lastDrink[e.slot] = t; out.push({ slot: e.slot, kind: 'drink' }); }
        break;
      case 'finish':
        // The valley floor is the real finish; the end of an earlier stage is a short buzz as the drop evaporates.
        out.push(e.final ? { slot: e.slot, kind: 'finish', place: e.place } : { slot: e.slot, kind: 'buzz' });
        break;
      case 'bump': if (e.intensity >= rules.bump) out.push({ slot: e.slot, kind: 'buzz' }); break;
      case 'splash': if (e.intensity >= rules.splash) out.push({ slot: e.slot, kind: 'buzz' }); break;
      case 'steal': out.push({ slot: e.slot, kind: 'buzz' }, { slot: e.from, kind: 'buzz' }); break;
      case 'respawn': if (e.reason !== 'rain') out.push({ slot: e.slot, kind: 'buzz' }); break;
      default: break;
    }
  }
  return out;
}

// HUD feed for one slot: a message when the place changes or the mass moves by a tenth, and at least every
// `every` s, so a phone that reconnects catches up. Returns null when there is nothing to send.
export function createHudFeed({ every = 1 } = {}) {
  const last = [null, null];
  return {
    next(slot, p, now) {
      if (!p) return null;
      const mass = Math.round(p.mass * 10) / 10, place = p.place;
      const l = last[slot];
      if (l && l.mass === mass && l.place === place && now - l.at < every) return null;
      last[slot] = { mass, place, at: now };
      return { t: 'hud', mass, place };
    },
    reset() { last[0] = last[1] = null; },
  };
}
