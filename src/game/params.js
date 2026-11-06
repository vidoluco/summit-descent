// URL parameters of the host page, for debugging and the browser tests. None is needed to play.
//   ?bots=2       both slots are sim bots (bots=1: slot 1 is a bot); without it a slot with no phone
//                 or keyboard gets a bot when the race starts (bots=0 is the same as no param)
//   ?autostart    start the race as soon as the world is loaded (with bots) or a player is there
//   ?stage=N      start the race on stage N (0-based), then play the rest to the valley floor
//   ?seed=S       sim seed (default 1)
//   ?speed=K      run the game clock K times faster (tests reach the valley floor in less time)
//   ?lang=en|it   start language (otherwise the saved choice, then the browser language)
//   ?world=id     baked world (default dolomiti)
//   ?pr=1         pixel ratio cap
//   ?intro=0      no start shot: the countdown starts at once (tests about something else)
const int = (v, d, lo, hi) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const num = (v, d, lo, hi) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const flag = (q, k) => q.has(k) && !/^(0|false|no|off)$/i.test(q.get(k) || '');

export function parseParams(search = '') {
  const q = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const lang = q.get('lang');
  const world = q.get('world');
  return {
    bots: q.has('bots') ? int(q.get('bots') || '2', 0, 0, 2) : null,
    autostart: flag(q, 'autostart'),
    stage: q.has('stage') ? int(q.get('stage'), 0, 0, 63) : 0,
    seed: q.has('seed') ? int(q.get('seed'), 1, 0, 2 ** 31 - 1) : 1,
    speed: q.has('speed') ? num(q.get('speed'), 1, 0.1, 16) : 1,
    lang: lang === 'en' || lang === 'it' ? lang : null,
    world: world && /^[a-z0-9_-]{1,32}$/.test(world) ? world : 'dolomiti',
    pixelRatio: q.has('pr') ? num(q.get('pr'), 1, 0.5, 2) : null,
    intro: !q.has('intro') || flag(q, 'intro'),
  };
}

// Which slots a bot drives for a race. bots = the ?bots param (null when absent); humans[slot] = a phone or
// the keyboard is driving that slot. bots=1 gives slot 1 to a bot, bots=2 both. Otherwise every slot without
// a human gets a bot, so a solo player still has a rival (and no race waits on an empty slot).
export function botSlots(bots, humans) {
  if (bots === 2) return [true, true];
  if (bots === 1) return [false, true];
  return humans.map((h) => !h);
}
