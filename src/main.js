// Summit Descent host page: ties the phones (src/net), the race (src/game/race.js over src/sim), the screen
// (src/game/view.js over src/render) and the overlays (src/ui) together.
//
// Flow: lobby (the summit, the QR, the two slots) -> countdown (the snowflakes melt into drops) -> the stages
// one by one, with the cloud flight between them -> the valley floor (the second drop gets 30 s) -> results
// -> rematch or back to the lobby. A race starts from the lobby button, ?autostart, or BOOST on the phones
// (src/game/gate.js: every phone ready, or one phone holding BOOST to race a bot). A slot with no phone and no
// keyboard is driven by a bot; a phone that joins it mid race plays from the next one. Each phone hears what it is
// doing ({t:'phase'}), so it can say what BOOST does now. The sim steps at a fixed 1/60 s; the drawing
// interpolates between steps.
// Once a phone is in, the lobby is the mountain vote (src/game/vote.js, the gallery in src/ui): each phone browses and
// votes, the lobby gate closes the vote, the TV shows the verdict, and a mountain other than the one loaded reloads
// the page on it, the race starting by itself once its phones are back (HANDOFF).
// Debug and test hooks: see src/game/params.js; window.__game is the live summary for the browser tests.
import { createWsTransport } from './net/ws-transport.js';
import { createInput } from './net/input.js';
import { loadWorld, loadStage } from './world/load.js';
import { createSim } from './sim/index.js';
import { createBot } from './sim/bot.js';
import { TUNING } from './sim/tuning.js';
import { detectLang, saveLang, translator } from './i18n/index.js';
import { createUI } from './ui/index.js';
import { parseParams, botSlots } from './game/params.js';
import { createRace, altitudeOf } from './game/race.js';
import { createClock, createInterp } from './game/clock.js';
import { padFx, createHudFeed } from './game/fx.js';
import { createView } from './game/view.js';
import { createLobbyGate, createResultsGate } from './game/gate.js';
import { rendererName, isSoftwareRenderer } from './game/gpu.js';
import { createVote } from './game/vote.js';
import { mountainCards, INDEX_URL } from './game/mountains.js';

const P = parseParams(location.search);
const SLOTS = [0, 1];
const RESULTS_AFTER = 3; // s between the last finish and the results screen, so the finish cloud plays
const STAGE_CARD = 2.4; // s the "evaporating, raining down on stage n" card stays, then the drop's own cloud shows
const COUNTDOWN = TUNING.countdown;
const INTRO_HOLD = 2.4; // s of the start shot before the countdown: the mountain's name, the camera over the way down
// Before it, the summit painting fills the screen under the title (solid, then fading into the start shot): every
// course starts on the summit, so the 3D start shot cannot show the mountain itself (the playtest on the Kerinci).
const ART = { solid: 1.6, fade: 0.9 };

let lang = P.lang || detectLang();
document.documentElement.lang = lang;
const ui = createUI(document.body, { lang, t: translator(lang) });
const canvas = document.getElementById('game');
const veilEl = document.getElementById('veil');
const artEl = document.createElement('div'); // the summit painting of the start shot
artEl.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none;background:#0a1420 center / cover no-repeat;transform-origin:50% 60%';
canvas.after(artEl);
const boot = document.getElementById('boot');

const game = {
  phase: 'loading', stage: P.stage, stages: 0, players: [], fps: 0, frameMs: 0, t: 0,
  bots: [false, false], layout: [0, 1], cloud: null, error: null, ready: false, events: {}, results: null,
  gpu: '', software: false, stalled: null, rematchOpen: false, rematchReady: [false, false], pads: [null, null], // pads: the phase each phone was told
  world: P.world, vote: null, art: 0, // the vote's snapshot in the lobby; art: the summit painting's opacity in the start shot
};
window.__game = game;
game.setSpeed = (k) => { clock.speed = k; }; // test hook: slow down around the moments a screenshot wants
// debug handle on the screen (renderer, animals, effects), kept out of JSON copies of __game
Object.defineProperty(game, 'view', { get: () => view, enumerable: false });
// Test hook for scripted phones: what a bot would do in this slot right now (the phone sends it as its input).
const advisors = new Map();
game.botInput = (slot) => {
  if (!race?.sim) return { x: 0, y: 0, boost: false };
  let a = advisors.get(slot);
  if (!a || a.sim !== race.sim) { a = { sim: race.sim, bot: createBot(race.sim, slot, { seed: 50 + slot }) }; advisors.set(slot, a); }
  return a.bot.input();
};

const transport = createWsTransport();
const input = createInput(transport);
let padUrl = `${location.protocol}//${location.host}/pad`;
fetch('/api/info').then((r) => (r.ok ? r.json() : null)).then((info) => { if (info?.padUrl) { padUrl = info.padUrl; if (mode === 'lobby') showLobby(); } }).catch(() => {});

let world = null, view = null, race = null, lobbySim = null;
let mode = 'loading'; // loading | lobby | race | results
const away = [false, false]; // a pad that left (the lobby shows "phone disconnected")
const prevBoost = [false, false];
let lobbyKey = '';
let resultsAt = null, hudAt = 0;
const cardUntil = [null, null];
const lastDrink = [-Infinity, -Infinity];
const hudFeed = createHudFeed();
const lobbyGate = createLobbyGate();
const resultsGate = createResultsGate();
let lobbyGateState = { start: false, ready: [false, false], solo: -1, hold: 0 };
let stallMsg = null;
let introT = null; // s into the start shot while the race waits for it, or null
let artLead = 0; // s of the summit painting before the 3D start shot (0: none)
let summitArt = null; // the summit painting of this world, behind the results (when the world has one)
fetch('assets/backdrops/index.json').then((r) => (r.ok ? r.json() : null)).then((ix) => {
  const f = `${P.world}-summit.jpg`;
  if (!ix?.files?.includes(f)) return;
  summitArt = `assets/backdrops/${f}`;
  const img = new Image();
  img.onload = () => { artEl.style.backgroundImage = `url("${summitArt}")`; artEl.dataset.ready = '1'; };
  img.src = summitArt;
}).catch(() => {});
const clock = createClock({ speed: P.speed });
const interp = createInterp();

// ---------- world ----------
const stageCache = new Map();
function getStage(k) {
  if (!stageCache.has(k)) {
    stageCache.set(k, loadStage(P.world, world.json, k).then((s) => { world.stages[k] = s; return s; }, (e) => { stageCache.delete(k); throw e; }));
  }
  return stageCache.get(k);
}

async function main() {
  world = await loadWorld(P.world, { stages: [] });
  const n = world.json.stages.length;
  game.stages = n;
  const s0 = Math.min(P.stage, n - 1);
  game.stage = s0;
  await getStage(s0);
  view = createView(canvas, world, { pixelRatio: P.pixelRatio ?? Math.min(devicePixelRatio || 1, 2) });
  game.gpu = rendererName(view.renderer.renderer?.getContext?.());
  game.software = isSoftwareRenderer(game.gpu);
  view.resize(innerWidth, innerHeight);
  addEventListener('resize', () => view.resize(innerWidth, innerHeight));
  enterLobby();
  boot?.remove();
  requestAnimationFrame(loop);
  // the other stages in the background, so the cloud never waits on the network
  for (let k = 0; k < n; k++) if (k !== s0) getStage(k).catch(() => {});
  // ?autostart waits for the animal models, so their build does not stutter the countdown
  await Promise.race([view.animals.ready.catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  view.warm(); // the snowflakes, trails, shards, hearts and clouds compile now, not on the countdown's first frame
  game.ready = true;
}

// ---------- lobby ----------
// input.get() drains the BOOST presses a phone queued, so each lobby frame reads every slot once (readInputs) and
// everything else in that frame looks at that one reading.
let lastInputs = [null, null];
const readInputs = () => SLOTS.map((s) => input.get(s));
// a phone, or the keyboard once one of its keys was pressed
const humanAt = (s, ins) => input.padConnected(s) || ins?.[s]?.source === 'keyboard';
function slotsInfo(ins = lastInputs) {
  const ready = lobbyGate.ready;
  return SLOTS.map((s) => {
    const connected = humanAt(s, ins);
    return { connected, ready: connected ? ready[s] : undefined, away: away[s] && !input.padConnected(s) };
  });
}
function showLobby() {
  const slots = slotsInfo();
  const n = slots.filter((s) => s.connected).length;
  ui.show('lobby', {
    padUrl, slots, stages: world.json.stages.length - Math.min(P.stage, world.json.stages.length - 1), world: P.world,
    canStart: n > 0 || P.bots === 2, hint: n === 1 ? 'solo' : n === 2 ? 'both' : null,
  });
  lobbyKey = JSON.stringify(slots);
}

function enterLobby() {
  mode = 'lobby';
  race = null;
  resultsAt = null;
  introT = null;
  artEl.style.opacity = '0';
  const k = Math.min(P.stage, world.json.stages.length - 1);
  view.setStage(k, world.stages[k]);
  view.setLayout([0]);
  lobbySim = createSim(world.stages[k], { players: 2, seed: P.seed, final: k === world.json.stages.length - 1 });
  lobbyGate.reset();
  vote.reset(P.world);
  goingTo = null;
  menuKey.fill('');
  wasDown.fill(true);
  for (const s of SLOTS) { ui.hide('waiting', { slot: s }); prevBoost[s] = true; } // a BOOST still held from the results is not a press
  ui.hide('notice', { kind: 'next' });
  ui.fill('start', 0);
  showLobby();
  if (game.software) ui.show('notice', { kind: 'soft' });
  game.phase = 'lobby';
  game.results = null;
  game.rematchOpen = false;
}

// ---------- lobby: mountain vote ----------
// The phones send {t:'vote', slot, world, lock}: the card in front of them, and lock when they tapped it (it counts
// as a BOOST press, which votes the card in front). The vote's snapshot goes to the gallery and, per phone, as
// {t:'menu'}. A mountain other than the one loaded is a reload: the pick and the players go through sessionStorage.
const HANDOFF = 'summit-descent.handoff';
const HANDOFF_WAIT = 12; // s the race waits after the reload for the phones that voted to be back
let cards = [];
let vote = createVote({ worlds: [P.world], current: P.world });
const pulse = [false, false]; // a tap on the card this frame
const wasDown = [false, false];
const menuKey = ['', ''];
let voteKey = '', goingTo = null;
let handoff = null;
try {
  const h = JSON.parse(sessionStorage.getItem(HANDOFF) || 'null');
  sessionStorage.removeItem(HANDOFF);
  if (h && h.world === P.world && Date.now() - h.at < 60000) handoff = { ...h, wait: 0 };
} catch {}
fetch(INDEX_URL).then((r) => (r.ok ? r.json() : null)).then((ix) => {
  cards = mountainCards(ix);
  if (cards.some((c) => c.id === P.world)) vote = createVote({ worlds: cards.map((c) => c.id), current: P.world });
  voteKey = '';
}).catch(() => {});
transport.onMessage((m) => {
  if (m.t !== 'vote' || mode !== 'lobby' || !SLOTS.includes(m.slot)) return;
  if (vote.focus(m.slot, m.world) && m.lock) pulse[m.slot] = true;
});
ui.onPick((id) => { if (mode === 'lobby' && vote.phase === 'vote') vote.current = id; });

// One lobby frame of the vote: BOOST presses and card taps vote, the gate closes it, the verdict runs, and once it
// has been shown the race starts (here, or on the other world after a reload).
function voteFrame(dt, ins, humans) {
  const down = boosts(ins).map((b, s) => b || pulse[s]);
  pulse.fill(false);
  for (const s of SLOTS) { if (down[s] && !wasDown[s] && humans[s]) vote.press(s); wasDown[s] = down[s]; }
  lobbyGateState = lobbyGate.step(dt, humans, down);
  if (handoff) {
    // back after the reload: the race starts once the players who voted are here again (or after HANDOFF_WAIT)
    handoff.wait += dt;
    const back = handoff.humans.every((h, s) => !h || humans[s]);
    publishVote({ phase: 'done', pick: P.world, loading: !game.ready, focus: [P.world, P.world], ballot: [null, null], candidates: [] });
    if (game.ready && (back || handoff.wait > HANDOFF_WAIT)) { handoff = null; return true; }
    return false;
  }
  if (goingTo) return false;
  const canStart = humans.some(Boolean) || P.bots === 2;
  if (canStart && lobbyGateState.start && vote.phase === 'vote') vote.close(humans);
  const v = vote.step(dt);
  publishVote(v);
  if (v.phase !== 'done') return false;
  if (v.pick === P.world || !v.pick) return true;
  // another mountain: tell the phones, then reload on it
  goingTo = v.pick;
  publishVote({ ...v, loading: true });
  try { sessionStorage.setItem(HANDOFF, JSON.stringify({ world: v.pick, humans, at: Date.now() })); } catch {}
  const q = new URLSearchParams(location.search);
  q.set('world', v.pick);
  q.delete('autostart');
  setTimeout(() => location.replace(`${location.pathname}?${q}`), 700);
  return false;
}
let shownVote = null; // what the gallery and the phones were last given
function publishVote(v) {
  shownVote = v;
  const view = { ...v, cards };
  const k = JSON.stringify(v);
  if (k !== voteKey) { voteKey = k; ui.vote(view); }
  game.vote = { phase: v.phase, focus: v.focus, ballot: v.ballot, pick: v.pick, spin: v.spin ?? null, landed: !!v.landed, winner: v.winner ?? -1, loading: !!v.loading };
  for (const s of SLOTS) {
    if (!input.padConnected(s)) { menuKey[s] = ''; continue; }
    const m = { t: 'menu', worlds: vote.worlds, phase: v.phase, focus: v.focus[s] ?? vote.current, ballot: v.ballot[s] ?? null, other: v.ballot[1 - s] ?? null,
      pick: v.pick ?? null, spin: v.spin ?? null, winner: v.winner ?? -1, landed: !!v.landed, candidates: v.candidates || [], loading: !!v.loading };
    const mk = JSON.stringify(m);
    if (mk !== menuKey[s]) { menuKey[s] = mk; input.send(s, m); }
  }
}
// ---------- end of lobby: mountain vote ----------

// ---------- race ----------
function startRace() {
  const humans = SLOTS.map((s) => humanAt(s, lastInputs));
  const bots = botSlots(P.bots, humans);
  const k = Math.min(P.stage, world.json.stages.length - 1);
  race = createRace(world, { loadStage: getStage, bots, seed: P.seed, startStage: k });
  mode = 'race';
  resultsAt = null;
  game.bots = bots;
  game.results = null;
  game.rematchOpen = false;
  game.events = {};
  ui.hide('notice', { kind: 'next' });
  ui.hide('notice', { kind: 'soft' });
  lastDrink[0] = lastDrink[1] = -Infinity;
  hudFeed.reset();
  clock.reset();
  interp.reset();
  // one human racing a bot: their view takes the whole screen; otherwise side by side
  const shown = humans.filter(Boolean).length === 1 && P.bots !== 2 ? [humans.indexOf(true)] : [0, 1];
  game.layout = shown;
  view.setStage(k, world.stages[k]);
  view.setLayout(shown);
  // the start shot first: the race waits while the title shows and the camera looks up at the summit
  const s0 = race.stageJson(k);
  introT = P.intro ? 0 : null;
  artLead = P.intro && artEl.dataset.ready ? ART.solid : 0;
  ui.show('countdown', { n: Math.ceil(race.state.countdown), slots: shown, title: P.intro ? { world: P.world, name: s0?.labels || s0?.name, stage: k + 1, stages: race.stages } : null });
  lastCount = Math.ceil(race.state.countdown);
  for (const s of SLOTS) {
    cardUntil[s] = null;
    if (!bots[s] && !humans[s]) ui.show('waiting', { slot: s }); else ui.hide('waiting', { slot: s });
  }
  game.phase = 'countdown';
  updateHud(true);
}

let lastCount = 3;
// where the valley-floor line is on the real mountain ({en, it} from the index), for the finish card
const finishName = () => cards.find((c) => c.id === P.world)?.finish?.names || null;
function onRaceEvents(events) {
  const st = race.state;
  for (const e of events) {
    game.events[e.kind] = (game.events[e.kind] || 0) + 1;
    switch (e.kind) {
      case 'go':
        ui.show('countdown', { n: 0 });
        ui.show('race', { slots: game.layout });
        for (const s of SLOTS) if (!race.isBot(s)) input.send(s, { t: 'fx', kind: 'buzz' });
        break;
      case 'finish': {
        if (!e.final) {
          const next = race.stageJson(race.stage + 1);
          ui.show('stage', { slot: e.slot, stage: race.stage + 2, stages: race.stages, name: next?.labels || next?.name });
          cardUntil[e.slot] = view.time + STAGE_CARD;
        } else {
          const other = st.players[1 - e.slot];
          ui.show('finished', { slot: e.slot, place: e.place, time: e.time, wait: other?.status !== 'finished', where: finishName() });
          if (other?.status === 'finished') ui.show('finished', { slot: 1 - e.slot, place: other.place, time: other.finishTime, wait: false, where: finishName() });
        }
        break;
      }
      case 'stage':
        view.setStage(race.stage, race.stageData(race.stage));
        updateHud(true);
        break;
      case 'over':
        resultsAt = view.time + RESULTS_AFTER;
        for (const p of st.players) if (p.status === 'finished') ui.show('finished', { slot: p.slot, place: p.place, time: p.finishTime, wait: false, where: finishName() });
        break;
      default: break;
    }
  }
  // a phone that joined a bot's slot mid race does not buzz on the bot's bumps and splashes
  for (const m of padFx(events, { t: st.t, lastDrink })) if (!race.isBot(m.slot)) input.send(m.slot, { t: 'fx', kind: m.kind, ...(m.place ? { place: m.place } : {}) });
}

function updateHud(force = false) {
  const st = race?.state;
  if (!st) return;
  const now = performance.now();
  if (!force && now - hudAt < 100) return;
  hudAt = now;
  const stageJson = race.stageJson();
  // in the cloud the places stay at the stage-end order, and the stage is already the one the drops rain on
  const places = race.places(), stage = (race.cloud ? race.cloud.to : race.stage) + 1;
  for (const p of st.players) {
    ui.hud(p.slot, { place: places[p.slot] ?? p.place, mass: p.mass, altitude: Math.round(altitudeOf(stageJson, p)), stage, stages: race.stages });
    const m = hudFeed.next(p.slot, p, now / 1000);
    if (m && !race.isBot(p.slot)) input.send(p.slot, m);
  }
  // the gap to the other drop on both views while it is dead time for one of them
  const gap = race.gap();
  for (const s of SLOTS) {
    if (gap) ui.show('gap', { slot: s, s: gap.s, ahead: gap.leader === s, pending: gap.pending });
    else ui.hide('gap', { slot: s });
  }
}

let resultsShown = null, readyKey = ''; // what the results screen was given; the rematch taps it shows
function showResults() {
  mode = 'results';
  game.phase = 'results';
  const players = race.results();
  game.results = players;
  resultsGate.reset();
  resultsShown = { players, world: P.world, art: summitArt, ready: [false, false], stageNames: world.json.stages.map((s) => s.labels || s.name) };
  readyKey = 'false,false';
  ui.show('results', resultsShown);
  ui.fill('rematch', 0);
  ui.fill('back', 0);
  // the phone's place card says what the podium says (a drop that did not finish has none)
  for (const p of players) if (!race.isBot(p.slot)) input.send(p.slot, { t: 'hud', mass: Math.round(race.state.players[p.slot].mass * 10) / 10, place: p.place ?? 0 });
}
// The rematch taps on the results: "pink is ready, waiting for blue" until every phone has tapped.
function showReady(ready) {
  const k = ready.join();
  if (k === readyKey) return;
  readyKey = k;
  ui.show('results', { ...resultsShown, ready });
}

// What each phone is doing, sent when it changes ({t:'phase', phase}): 'lobby' (BOOST makes it ready), 'ready'
// (waiting for the other phone), 'solo' (hold BOOST to race a bot), 'race', 'next' (a bot drives its slot until
// this race ends), 'results' (tap BOOST: rematch, hold: back to the lobby), 'rematch' (tapped, waiting for the other).
function phaseOf(s) {
  if (!input.padConnected(s)) return null;
  if (mode === 'lobby') return !lobbyGateState.ready[s] ? 'lobby' : lobbyGateState.solo === s ? 'solo' : 'ready';
  if (mode === 'results') return resultsGate.ready[s] ? 'rematch' : 'results';
  if (mode === 'race' && race) return race.isBot(s) ? 'next' : 'race';
  return null;
}
function syncPads() {
  for (const s of SLOTS) {
    const ph = phaseOf(s);
    if (ph && ph !== game.pads[s]) input.send(s, { t: 'phase', phase: ph });
    game.pads[s] = ph;
  }
}

// ---------- phones and keyboard ----------
input.on((m) => {
  if (m.t === 'join') {
    away[m.slot] = false;
    game.pads[m.slot] = null; // a phone that (re)joins hears its phase again
    menuKey[m.slot] = ''; // and the vote
    ui.hide('waiting', { slot: m.slot });
    if (mode === 'race' && race?.isBot(m.slot)) ui.show('notice', { kind: 'next', slot: m.slot, ms: 7000 });
  }
  else if (m.t === 'leave') {
    away[m.slot] = true;
    if (mode === 'lobby') vote.leave(m.slot); // its ballot goes; a verdict being shown is undone
    if (mode === 'race' && race && !race.isBot(m.slot)) ui.show('waiting', { slot: m.slot });
  } else if (m.t === 'full') ui.show('full');
  if (mode === 'lobby') showLobby();
});
// the start button on the TV closes the vote with the ballots in so far (none: the mountain on screen)
ui.onStart(() => { if (mode === 'lobby' && vote.phase === 'vote' && !goingTo && !handoff) vote.close(SLOTS.map((s) => humanAt(s, lastInputs))); });
ui.onRematch(() => { if (mode === 'results') startRace(); });
ui.onBack(() => { if (mode === 'results') enterLobby(); });
ui.onLang((l) => { lang = l; saveLang(l); document.documentElement.lang = l; });

// BOOST per slot this frame (a phone or the keyboard), for the lobby and results gates. A press still held from the
// screen before does not count until it is released.
function boosts(ins) {
  return SLOTS.map((s) => {
    const b = !!ins[s].boost && ins[s].connected;
    if (prevBoost[s] && b) return false;
    prevBoost[s] = false;
    return b;
  });
}

// ---------- frame loop ----------
let last = performance.now(), fpsAcc = 0, fpsN = 0, cpuAcc = 0;
const frameEvents = [];
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const t0 = performance.now();
  try {
    frame(dt);
    if (world) syncPads();
  } catch (e) {
    game.error = e.message;
    console.error(e);
  }
  const cpu = performance.now() - t0;
  fpsAcc += dt; fpsN++; cpuAcc += cpu;
  if (fpsAcc >= 0.5) { game.fps = Math.round((fpsN / fpsAcc) * 10) / 10; game.frameMs = Math.round((cpuAcc / fpsN) * 100) / 100; fpsAcc = 0; fpsN = 0; cpuAcc = 0; }
}

function frame(dt) {
  if (mode === 'lobby') {
    lastInputs = readInputs();
    const humans = SLOTS.map((s) => humanAt(s, lastInputs));
    const go = voteFrame(dt, lastInputs, humans);
    const slots = slotsInfo(lastInputs);
    if (JSON.stringify(slots) !== lobbyKey) showLobby();
    ui.fill('start', lobbyGateState.hold);
    const canStart = slots.some((s) => s.connected) || P.bots === 2;
    if (go || (canStart && P.autostart && game.ready)) { startRace(); return; }
    view.frame(interp.view(lobbySim.state, 1, []), [], dt, { mode: 'lobby' });
    summarize(lobbySim.state);
    return;
  }
  if (!race) return;
  if (mode === 'results') {
    lastInputs = readInputs();
    const humans = SLOTS.map((s) => humanAt(s, lastInputs));
    const r = resultsGate.step(dt, boosts(lastInputs), humans);
    game.rematchOpen = resultsGate.open;
    game.rematchReady = r.ready;
    ui.fill('rematch', r.lock);
    ui.fill('back', r.hold);
    if (!r.action) showReady(r.ready.map((x, s) => x && humans[s]));
    if (r.action === 'rematch') { startRace(); return; }
    if (r.action === 'lobby') { enterLobby(); return; }
  }
  frameEvents.length = 0;
  // the start shot: the race holds until it is over, then the countdown numbers start
  if (introT !== null) {
    introT += dt * clock.speed;
    if (introT >= artLead + INTRO_HOLD) { introT = null; clock.reset(); ui.show('countdown', { n: lastCount }); }
  }
  const art = introT !== null && artLead ? 1 - smoothstep((introT - artLead) / ART.fade) : 0;
  artEl.style.opacity = art.toFixed(3);
  if (art > 0) artEl.style.transform = `scale(${(1 + 0.04 * Math.min(1, introT / (artLead + ART.fade))).toFixed(4)})`;
  game.art = art;
  const n = introT === null ? clock.advance(dt) : 0;
  for (let i = 0; i < n; i++) {
    interp.capture(race.state);
    race.step(clock.dt, SLOTS.map((s) => input.get(s)));
    if (race.events.length) { onRaceEvents(race.events); for (const e of race.events) frameEvents.push(e); }
  }
  const st = race.state;
  if (race.phase === 'countdown') {
    const c = Math.ceil(st.countdown);
    if (c !== lastCount && c > 0) { lastCount = c; ui.show('countdown', { n: c }); }
  }
  // the stage card gives way to the drop's own cloud
  for (const s of SLOTS) if (cardUntil[s] !== null && (view.time >= cardUntil[s] || (race.phase === 'cloud' && race.cloud.t >= 0))) { ui.hide('stage', { slot: s }); cardUntil[s] = null; }
  if (mode === 'race') updateHud();
  if (mode === 'race' && resultsAt !== null && view.time >= resultsAt) showResults();
  view.frame(interp.view(st, clock.alpha, frameEvents), frameEvents, dt * clock.speed, { mode: 'race', race, intro: introProgress(st) });
  if (veilEl) veilEl.style.opacity = view.veil(race).toFixed(3);
  stalled(race.stalled);
  game.phase = mode === 'results' ? 'results' : race.phase === 'done' ? 'finish' : race.phase;
  game.stage = race.stage;
  game.cloud = race.cloud ? { t: race.cloud.t, from: race.cloud.from, to: race.cloud.to, swapped: race.cloud.swapped } : null;
  summarize(st);
}

const smoothstep = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
// 0..1 through the 3D start shot (the hold after the summit painting, then the countdown), null once the race is under way
function introProgress(st) {
  if (introT !== null) return Math.max(0, introT - artLead) / (INTRO_HOLD + COUNTDOWN);
  if (race.phase !== 'countdown' || !P.intro) return null;
  return Math.min(1, (INTRO_HOLD + COUNTDOWN - st.countdown) / (INTRO_HOLD + COUNTDOWN));
}

// The cloud holding on a stage that does not load: say so on the TV and in __game, and clear it once it loads.
function stalled(st) {
  game.stalled = st ? { stage: st.stage, failures: st.failures } : null;
  const msg = st ? `stage ${st.stage + 1} does not load${st.error?.message ? `: ${st.error.message}` : ''}` : null;
  if (msg === stallMsg) return;
  if (msg) { game.error = msg; ui.show('notice', { kind: 'load' }); }
  else { if (game.error === stallMsg) game.error = null; ui.hide('notice', { kind: 'load' }); }
  stallMsg = msg;
}

function summarize(st) {
  game.t = st.t;
  game.players = st.players.map((p) => ({
    slot: p.slot, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, vel: { x: p.vel.x, z: p.vel.z }, status: p.status, place: p.place, mass: p.mass,
    finished: p.status === 'finished' && (!race || race.final), melt: p.melt, connected: p.connected,
  }));
  game.animals = st.animals.map((a) => ({ kind: a.kind, x: a.pos.x, z: a.pos.z, state: a.state, target: a.target }));
}

main().catch((e) => {
  game.error = e.message;
  console.error(e);
  if (boot) boot.textContent = e.message;
});

