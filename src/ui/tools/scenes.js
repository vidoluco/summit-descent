// One state per host screen, for the screenshots (src/ui/tools/shoot.mjs) and the browser test.
// Each run(ui) executes inside the preview page, so it must not close over anything.
export const PAD_URL = 'http://192.168.1.23:5190/pad';

export const SCENES = [
  // one phone, ready: holding BOOST races a bot (the bar fills on the start button)
  { name: 'lobby', bg: 'hero', run: (ui, url) => ui.show('lobby', { padUrl: url, stages: 4, hint: 'solo', slots: [{ connected: true, ready: true }, { connected: false }] }).fill('start', 0.45) },
  { name: 'lobby-empty', bg: 'hero', run: (ui, url) => ui.show('lobby', { padUrl: url, stages: 4, slots: [{}, {}] }) },
  // two phones, the pink one has not pressed BOOST yet
  { name: 'lobby-ready', bg: 'hero', run: (ui, url) => ui.show('lobby', { padUrl: url, stages: 4, hint: 'both', slots: [{ connected: true, ready: true }, { connected: true, ready: false }] }) },
  // the mountain vote: blue browses the Antelao, pink voted K2; a free place keeps a small QR (one phone: lobby-vote-solo)
  {
    name: 'vote', bg: 'hero', run: (ui, url) => {
      ui.show('lobby', { padUrl: url, stages: 4, hint: 'both', slots: [{ connected: true, ready: false }, { connected: true, ready: true }] });
      ui.vote({ cards: window.__cards, phase: 'vote', focus: ['antelao', 'k2'], ballot: [null, 'k2'] });
    },
  },
  {
    name: 'vote-solo', bg: 'hero', run: (ui, url) => {
      ui.show('lobby', { padUrl: url, stages: 4, hint: 'solo', slots: [{ connected: true, ready: true }, {}] });
      ui.vote({ cards: window.__cards, phase: 'vote', focus: ['everest', null], ballot: ['everest', null] });
    },
  },
  {
    name: 'vote-roll', bg: 'hero', run: (ui, url) => {
      ui.show('lobby', { padUrl: url, stages: 4, slots: [{ connected: true, ready: true }, { connected: true, ready: true }] });
      ui.vote({ cards: window.__cards, phase: 'roll', focus: ['indonesia', 'svizzera'], ballot: ['indonesia', 'svizzera'], pick: 'svizzera', winner: 1, candidates: ['svizzera', 'indonesia'], spin: 'indonesia', landed: false });
    },
  },
  {
    name: 'vote-won', bg: 'hero', run: (ui, url) => {
      ui.show('lobby', { padUrl: url, stages: 4, slots: [{ connected: true, ready: true }, { connected: true, ready: true }] });
      ui.vote({ cards: window.__cards, phase: 'roll', focus: ['indonesia', 'svizzera'], ballot: ['indonesia', 'svizzera'], pick: 'svizzera', winner: 1, candidates: ['svizzera', 'indonesia'], spin: 'svizzera', landed: true });
    },
  },
  {
    name: 'vote-agree', bg: 'hero', run: (ui, url) => {
      ui.show('lobby', { padUrl: url, stages: 4, slots: [{ connected: true, ready: true }, { connected: true, ready: true }] });
      ui.vote({ cards: window.__cards, phase: 'agree', focus: ['carpazi', 'carpazi'], ballot: ['carpazi', 'carpazi'], pick: 'carpazi', winner: -1, candidates: [] });
    },
  },
  { name: 'countdown', bg: 'split', run: (ui) => ui.show('countdown', { n: 3, slots: [0, 1] }) },
  { name: 'countdown-go', bg: 'split', run: (ui) => ui.show('countdown', { n: 0, slots: [0, 1] }) },
  {
    name: 'race', bg: 'split', run: (ui) => {
      ui.show('race', { slots: [0, 1] });
      ui.hud(0, { place: 1, mass: 2.6, altitude: 2431, stage: 1, stages: 4 });
      ui.hud(1, { place: 2, mass: 0.9, altitude: 2468, stage: 1, stages: 4 });
    },
  },
  {
    name: 'race-solo', bg: 'hero', run: (ui) => {
      ui.show('race', { slots: [0] });
      ui.hud(0, { place: 1, mass: 1.4, altitude: 1688, stage: 2, stages: 4 });
    },
  },
  {
    name: 'stage', bg: 'split', run: (ui) => {
      ui.show('race', { slots: [0, 1] });
      ui.hud(0, { place: 1, mass: 2.2, altitude: 1757, stage: 1, stages: 4 });
      ui.hud(1, { place: 2, mass: 1.1, altitude: 1812, stage: 1, stages: 4 });
      ui.show('stage', { slot: 0, stage: 2, stages: 4, name: { it: 'Alta Val Sesis', en: 'Upper Val Sesis' } });
    },
  },
  {
    name: 'finished', bg: 'split', run: (ui) => {
      ui.show('race', { slots: [0, 1] });
      ui.hud(0, { place: 1, mass: 1.8, altitude: 1026, stage: 4, stages: 4 });
      ui.hud(1, { place: 2, mass: 0.7, altitude: 1088, stage: 4, stages: 4 });
      ui.show('finished', { slot: 0, place: 1, time: 222.18, where: { it: 'Orrido dell\'Acquatona', en: 'Acquatona Gorge' } });
    },
  },
  {
    name: 'gap', bg: 'split', run: (ui) => {
      ui.show('race', { slots: [0, 1] });
      ui.hud(0, { place: 1, mass: 2.0, altitude: 1757, stage: 1, stages: 4 });
      ui.hud(1, { place: 2, mass: 1.3, altitude: 1890, stage: 1, stages: 4 });
      ui.show('gap', { slot: 0, s: 8.4, ahead: true });
      ui.show('gap', { slot: 1, s: 8.4, ahead: false });
    },
  },
  {
    // blue is through the stage end, pink still racing to it: the seconds since blue finished, not the gap yet
    name: 'gap-wait', bg: 'split', run: (ui) => {
      ui.show('race', { slots: [0, 1] });
      ui.hud(0, { place: 1, mass: 2.0, altitude: 1610, stage: 2, stages: 4 });
      ui.hud(1, { place: 2, mass: 1.3, altitude: 1702, stage: 2, stages: 4 });
      ui.show('stage', { slot: 0, stage: 3, stages: 4, name: { it: 'Bassa Val Sesis', en: 'Lower Val Sesis' } });
      ui.show('gap', { slot: 0, s: 5.5, ahead: true, pending: true });
      ui.show('gap', { slot: 1, s: 5.5, ahead: false, pending: true });
    },
  },
  {
    name: 'notice', bg: 'hero', run: (ui) => {
      ui.show('race', { slots: [0] });
      ui.hud(0, { place: 1, mass: 1.4, altitude: 1688, stage: 2, stages: 4 });
      ui.show('notice', { kind: 'next', slot: 1 });
    },
  },
  {
    name: 'waiting', bg: 'split', run: (ui) => {
      ui.show('race', { slots: [0, 1] });
      ui.hud(0, { place: 2, mass: 1.2, altitude: 1544, stage: 2, stages: 4 });
      ui.hud(1, { place: 1, mass: 1.6, altitude: 1530, stage: 2, stages: 4 });
      ui.show('waiting', { slot: 1 });
    },
  },
  {
    name: 'full', bg: 'hero', run: (ui, url) => {
      ui.show('lobby', { padUrl: url, stages: 4, slots: [{ connected: true }, { connected: true }] });
      ui.show('full', { ms: 0 });
    },
  },
  {
    // just after the results appear: BOOST is locked out, the bar on the rematch button fills
    name: 'results', bg: 'split', run: (ui) => ui.show('results', {
      players: [
        { slot: 1, place: 2, time: 238.4, peak: 2.4, stageTimes: [61.2, 118.9, 177.5, 238.4], drank: { marmot: 1, chamois: 2, eagle: 1 } },
        { slot: 0, place: 1, time: 222.18, peak: 2.8, stageTimes: [58.4, 110.02, 165.3, 222.18], drank: { ibex: 1, chough: 3 } },
      ],
      stageNames: [{ it: 'Vetta e nevaio del Peralba', en: 'Peralba summit and snowfield' }, { it: 'Alta Val Sesis', en: 'Upper Val Sesis' },
        { it: 'Bassa Val Sesis', en: 'Lower Val Sesis' }, { it: 'Orrido dell\'Acquatona', en: 'Acquatona Gorge' }],
    }).fill('rematch', 0.6),
  },
  {
    // pink tapped BOOST for the rematch, blue has not yet
    name: 'results-ready', bg: 'split', run: (ui) => ui.show('results', {
      players: [
        { slot: 1, place: 1, time: 131.06, peak: 2.6, stageTimes: [40.1, 88.7, 131.06], drank: { chough: 1 } },
        { slot: 0, place: 2, time: 140.3, peak: 1.9, stageTimes: [42.6, 95.2, 140.3], drank: {} },
      ],
      stageNames: [{ it: 'Collo di bottiglia e Spalla', en: 'Bottleneck and Shoulder' }, { it: 'Parete sud-est', en: 'South-east face' },
        { it: 'Piede della parete sud-est', en: 'Foot of the south-east face' }],
      ready: [false, true],
    }).fill('rematch', 1),
  },
  {
    // five stages (the Antelao), pink cut short on the last one
    name: 'results-dnf', bg: 'split', run: (ui) => ui.show('results', {
      players: [
        { slot: 0, place: 1, time: 251.06, peak: 2.7, stageTimes: [48.2, 101.5, 150.9, 199.4, 251.06], drank: {} },
        { slot: 1, finished: false, peak: 1.6, stageTimes: [52.0, 109.8, 161.3, 214.7], drank: { 'red-deer': 2, chamois: 1, eagle: 1 } },
      ],
      stageNames: [{ it: 'Parete nord e Ghiacciaio Inferiore dell\'Antelao', en: 'Antelao north face and Lower Glacier' },
        { it: 'Val d\'Oten e Cascata delle Pile', en: 'Val d\'Oten and the Pile Waterfall' },
        { it: 'Ghiaie della Val d\'Oten verso Praciadelan', en: 'Val d\'Oten gravel bed towards Praciadelan' },
        { it: 'Torrente Molinà sotto Praciadelan', en: 'Molinà torrent below Praciadelan' }, { it: 'Torrente Molinà a Calalzo', en: 'Molinà torrent at Calalzo' }],
    }),
  },
];
