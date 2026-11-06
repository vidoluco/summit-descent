// The mountains of the lobby vote, in gallery order (one world per region, two in the Dolomiti), and what each
// card says about them: the real names, the country, the summit, the drop and the race time from the baked index
// (data/worlds/index.json, written by tools/bake/index.mjs; on the card with the start shot and the clouds, SHOW),
// and two or three animals that really live there
// (each one spawns on that world's own course: test/vote.test.mjs checks it against world.json). Pure, so the
// TV, the phone pad and the tests read the same list.
//
//   const cards = mountainCards(await (await fetch('data/worlds/index.json')).json());
//   cards[0] -> { id, names, summit: { names, altitude }, finish: { names, altitude }, country, drop, seconds, stages, animals, image }

export const MOUNTAINS = ['dolomiti', 'antelao', 'svizzera', 'carpazi', 'everest', 'k2', 'indonesia'];
export const RANDOM = 'random'; // the "surprise us" card: any of the mountains
export const INDEX_URL = 'data/worlds/index.json';

// s the TV spends outside the race clock: the summit painting, the start shot and the countdown (src/main.js ART.solid,
// INTRO_HOLD, TUNING.countdown), and each cloud between two stages (CLOUD.linger + CLOUD.duration). The index's race
// time is the race clock of two bots; the card says how long the whole descent lasts on the TV (the playtest: '~3:00'
// on the card, 3:16 raced).
export const SHOW = { start: 1.6 + 2.4 + 3, cloud: 1.4 + 3.6 };

// The card's animals, the species a visitor really meets on that course (docs/mountains/<id>.md).
export const HEADLINERS = {
  dolomiti: ['marmot', 'chamois', 'eagle'],
  antelao: ['chamois', 'red-deer', 'eagle'],
  svizzera: ['ibex', 'marmot', 'lammergeier'],
  carpazi: ['carpathian-chamois', 'brown-bear', 'wolf'],
  everest: ['yak', 'snow-leopard', 'chough'],
  k2: ['lammergeier', 'chough'], // all snow and ice to the foot of the face (5038 m): birds only, no pika without talus, ibex and snow leopard below 5000 m
  indonesia: ['sumatran-tiger', 'malayan-tapir', 'wreathed-hornbill'],
};

// The painting on a card: the summit as people photograph it (assets/backdrops/<id>-summit.jpg), reduced by
// build.mjs; a world without one shows its downhill view.
export const cardImage = (id) => `assets/backdrops/cards/${id}.jpg`;

// The index's entries for the vote's mountains, in gallery order; a mountain the index does not list (not baked
// yet) is left out.
export function mountainCards(index) {
  const byId = new Map((index?.worlds || []).map((w) => [w.id, w]));
  return MOUNTAINS.filter((id) => byId.has(id)).map((id) => {
    const w = byId.get(id);
    return {
      id,
      names: w.names || null,
      summit: { names: w.summit?.names || null, name: w.summit?.name || id, altitude: w.summit?.altitude ?? null },
      finish: { names: w.finish?.names || null, altitude: w.finish?.altitude ?? null },
      country: w.country || null,
      drop: cardDrop(w),
      seconds: Number.isFinite(w.raceSeconds) ? w.raceSeconds + SHOW.start + SHOW.cloud * Math.max(0, (w.stages ?? 1) - 1) : w.estimatedSeconds ?? null,
      stages: w.stages ?? null,
      animals: HEADLINERS[id] || [],
      image: cardImage(id),
    };
  });
}

// The summit names the cards show in a language (data, like the stage names): for the tests that check every
// visible string comes from the dictionary or the world data.
export const summitLabels = (index, lang) => mountainCards(index).map((c) => c.summit.names?.[lang] ?? c.summit.name);

// The drop a card shows next to the summit: from the summit's surveyed altitude to the finish, so the two figures
// add up on the card (Everest: 8849 - 4425 = 4424 m). The index's own drop starts from the course's first point on
// the elevation model (8729 m there), which no card shows; it is the fallback when the summit or finish is missing.
export function cardDrop(w) {
  const top = w?.summit?.altitude, end = w?.finish?.altitude;
  return Number.isFinite(top) && Number.isFinite(end) && top > end ? Math.round(top - end) : (w?.drop ?? null);
}

// A race time for a card: rounded up to 10 s (3:17 -> 3:20, 2:57 -> 3:00), so it reads as the rough figure it is.
// The index's time is two bots racing; two people are a little slower, so the figure never rounds down.
export function roughTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const s = Math.ceil(seconds / 10 - 1e-9) * 10;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
