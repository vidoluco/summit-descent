// The mountain vote: the catalogue the cards show (every mountain baked, its numbers from the index, its animals
// spawning on its own course and drawn as stickers, every string in both languages), the vote's rules (agree, the
// coin flip and where it lands, surprise us, a phone that leaves), and the server relaying {t:'vote'}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { MOUNTAINS, HEADLINERS, RANDOM, mountainCards, roughTime, cardImage, SHOW } from '../src/game/mountains.js';
import { CLOUD } from '../src/game/race.js';
import { TUNING } from '../src/sim/tuning.js';
import { createVote, VOTE } from '../src/game/vote.js';
import { cardSources } from '../tools/cards.mjs';
import { sanitizeVote } from '../server/room.js';
import { startServer, host, pad } from '../server/testing.js';
import { en, it } from '../src/i18n/index.js';
import { SPECIES } from '../src/render/animals/registry.js';
import { FLAGS } from '../src/ui/icons.js';

const index = JSON.parse(readFileSync('data/worlds/index.json', 'utf8'));
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; }; // a scripted rng

test('the seven mountains: one per region and two in the Dolomiti, all baked, the numbers from the index', () => {
  assert.deepEqual(MOUNTAINS, ['dolomiti', 'antelao', 'svizzera', 'carpazi', 'everest', 'k2', 'indonesia']);
  const cards = mountainCards(index);
  assert.deepEqual(cards.map((c) => c.id), MOUNTAINS, 'the index lists every mountain of the vote');
  for (const c of cards) {
    const w = index.worlds.find((x) => x.id === c.id);
    assert.equal(c.summit.altitude, w.summit.altitude);
    assert.equal(c.drop, w.summit.altitude - w.finish.altitude, 'summit minus finish: the two figures on the card add up');
    assert.ok(Math.abs(c.drop - w.drop) < 200, 'close to the drop the course really runs');
    assert.deepEqual(c.finish.names, w.finish.names);
    assert.ok(Math.abs(c.seconds - (w.raceSeconds + SHOW.start + SHOW.cloud * (w.stages - 1))) < 1e-9, `${c.id}: the race clock, the start shot and the clouds`);
    assert.ok(FLAGS.includes(c.country), `${c.id}: a flag for ${c.country}`);
    assert.ok(existsSync(`data/worlds/${c.id}/world.json`), `${c.id} is baked`);
    assert.equal(c.image, cardImage(c.id));
  }
  assert.equal(SHOW.cloud, CLOUD.linger + CLOUD.duration, 'the cloud of src/game/race.js');
  assert.equal(SHOW.start, 1.6 + 2.4 + TUNING.countdown, 'the summit painting and the start shot of src/main.js (ART.solid, INTRO_HOLD) and the countdown');
  // the real summits, as published (a judge checks the cards against them)
  const alt = Object.fromEntries(cards.map((c) => [c.id, c.summit.altitude]));
  assert.deepEqual(alt, { dolomiti: 2694, antelao: 3264, svizzera: 4478, carpazi: 2443, everest: 8849, k2: 8611, indonesia: 3805 });
  assert.deepEqual(mountainCards({ worlds: [{ id: 'k2', summit: {} }, { id: 'atlantis' }] }).map((c) => c.id), ['k2'], 'unbaked and unknown worlds are left out');
});

test('every card animal really lives on that course: it spawns in that world, has a model, a sticker and a name', () => {
  for (const id of MOUNTAINS) {
    const world = JSON.parse(readFileSync(`data/worlds/${id}/world.json`, 'utf8'));
    const spawned = new Set(world.stages.flatMap((s) => (s.spawns?.animals || []).map((a) => a.kind)));
    assert.ok(HEADLINERS[id].length >= 2 && HEADLINERS[id].length <= 3, id);
    for (const kind of HEADLINERS[id]) {
      assert.ok(spawned.has(kind), `${kind} spawns on the ${id} course`);
      assert.ok(SPECIES[kind], `${kind} has a model`);
      assert.ok(existsSync(`assets/ui/animals/${kind}.png`), `${kind} has a sticker (node src/ui/tools/stickers.mjs)`);
      assert.ok(en[`animal.${kind}`] && it[`animal.${kind}`], `${kind} is named in both languages`);
    }
  }
});

test('every string a card shows exists in both languages; each card has a painting', () => {
  const sources = cardSources('assets/backdrops');
  for (const c of mountainCards(index)) {
    for (const k of [`world.${c.id}`, `region.${c.id}`, `country.${c.country}`]) assert.ok(en[k] && it[k], k);
    assert.ok(sources[c.id], `${c.id}: a painting for the card`);
    if (existsSync(`assets/backdrops/${c.id}-summit.jpg`)) assert.equal(sources[c.id], `${c.id}-summit.jpg`, 'the summit as people photograph it');
  }
  for (const k of ['ui.vote.title', 'ui.vote.random', 'ui.vote.agree', 'ui.vote.roll', 'ui.vote.won', 'pad.vote.title', 'pad.vote.go']) assert.ok(en[k] && it[k], k);
});

test('rough race time on the cards', () => {
  assert.equal(roughTime(195.8), '3:20');
  assert.equal(roughTime(149.8), '2:30');
  assert.equal(roughTime(253.9), '4:20');
  assert.equal(roughTime(176.9), '3:00', 'rounded up: two people are slower than the bots');
  assert.equal(roughTime(180), '3:00');
  assert.equal(roughTime(0), '');
  assert.equal(roughTime(null), '');
});

const run = (v, s) => { let snap; for (let t = 0; t < s; t += 1 / 60) snap = v.step(1 / 60); return snap; };

test('both on the same mountain: they agree, the drops cheer for VOTE.agree s, then it is done', () => {
  const v = createVote({ worlds: MOUNTAINS, current: 'dolomiti' });
  assert.ok(v.focus(0, 'antelao'));
  assert.ok(v.focus(1, 'k2'));
  assert.ok(v.focus(1, 'antelao'), 'browsing moves the marker');
  v.press(0); v.press(1);
  assert.deepEqual(v.snapshot().ballot, ['antelao', 'antelao']);
  assert.equal(v.close([true, true]), 'antelao');
  assert.equal(v.phase, 'agree');
  assert.equal(v.focus(0, 'k2'), false, 'nothing changes once the vote is closed');
  assert.equal(v.press(0), false);
  assert.equal(run(v, VOTE.agree - 0.1).phase, 'agree');
  const done = run(v, 0.2);
  assert.equal(done.phase, 'done');
  assert.equal(done.pick, 'antelao');
  assert.equal(done.winner, -1);
});

test('two different mountains: a coin flip between the two, the spin ends on the winner\'s pick', () => {
  for (const coin of [0.2, 0.8]) {
    const v = createVote({ worlds: MOUNTAINS, rng: seq(coin, 0.1) });
    v.focus(0, 'indonesia'); v.press(0);
    v.focus(1, 'svizzera'); v.press(1);
    const pick = v.close([true, true]);
    assert.equal(pick, coin < 0.5 ? 'indonesia' : 'svizzera');
    const snap = v.snapshot();
    assert.equal(snap.phase, 'roll');
    assert.equal(snap.winner, coin < 0.5 ? 0 : 1);
    assert.deepEqual(snap.candidates, ['svizzera', 'indonesia'], 'only the two votes spin, in gallery order');
    // the highlight alternates between the two, slowing down, and stops on the pick
    const seen = [];
    for (let t = 0; t < VOTE.roll; t += 1 / 60) { const s = v.step(1 / 60).spin; if (seen.at(-1) !== s) seen.push(s); }
    assert.ok(seen.length >= VOTE.turns, `${seen.length} flips`);
    assert.ok(seen.every((id) => ['svizzera', 'indonesia'].includes(id)));
    assert.equal(seen.at(-1), pick);
    const landed = v.snapshot();
    assert.ok(landed.landed);
    assert.equal(landed.spin, pick);
    assert.equal(run(v, VOTE.land + 0.05).phase, 'done');
  }
  // fair: over many coins, each player wins about half the time
  let blue = 0;
  for (let i = 0; i < 400; i++) {
    const v = createVote({ worlds: MOUNTAINS, rng: Math.random });
    v.focus(0, 'k2'); v.press(0); v.focus(1, 'everest'); v.press(1);
    if (v.close() === 'k2') blue++;
  }
  assert.ok(blue > 150 && blue < 250, `blue won ${blue} of 400`);
});

test('surprise us: any mountain, the spin runs over all of them; with a real vote it is the coin first', () => {
  const v = createVote({ worlds: MOUNTAINS, rng: seq(0.99, 0.5) });
  v.focus(0, RANDOM); v.press(0);
  v.focus(1, RANDOM); v.press(1);
  const pick = v.close();
  assert.ok(MOUNTAINS.includes(pick));
  assert.deepEqual(v.snapshot().candidates, MOUNTAINS);
  assert.equal(run(v, VOTE.roll).spin, pick);
  // blue says k2, pink says surprise: the coin picks pink, whose surprise is then drawn (rng 0.0 -> the first)
  const w = createVote({ worlds: MOUNTAINS, rng: seq(0.9, 0.0, 0.3) });
  w.focus(0, 'k2'); w.press(0); w.focus(1, RANDOM); w.press(1);
  assert.equal(w.close(), 'dolomiti');
  assert.equal(w.snapshot().winner, 1);
  // a solo surprise spins too
  const s = createVote({ worlds: MOUNTAINS, rng: seq(0.5) });
  s.focus(0, RANDOM); s.press(0);
  assert.equal(s.close([true, false]), MOUNTAINS[3]);
  assert.equal(s.phase, 'roll');
});

test('one player, no ballot, unknown cards, a phone that leaves', () => {
  const v = createVote({ worlds: MOUNTAINS, current: 'carpazi' });
  assert.equal(v.focus(0, 'atlantis'), false);
  v.press(0); // never browsed: the world on screen
  assert.equal(v.snapshot().ballot[0], 'carpazi');
  assert.equal(v.close([true, false]), 'carpazi');
  assert.equal(v.phase, 'agree');
  assert.equal(run(v, VOTE.solo + 0.05).phase, 'done', 'a single ballot is shown for VOTE.solo s');
  // nobody voted (the TV's start button): the current world, which a click on a card may change
  const n = createVote({ worlds: MOUNTAINS, current: 'dolomiti' });
  n.current = 'everest';
  n.current = 'atlantis';
  assert.equal(n.close([false, false]), 'everest');
  // ballots of a slot nobody is on do not count
  const a = createVote({ worlds: MOUNTAINS });
  a.focus(1, 'k2'); a.press(1);
  a.focus(0, 'antelao'); a.press(0);
  assert.equal(a.close([true, false]), 'antelao');
  // pink leaves while the coin spins: the verdict is undone, blue keeps its vote, pink's goes
  const l = createVote({ worlds: MOUNTAINS });
  l.focus(0, 'k2'); l.press(0); l.focus(1, 'everest'); l.press(1);
  l.close();
  run(l, 1);
  assert.equal(l.leave(1), true);
  const back = l.snapshot();
  assert.equal(back.phase, 'vote');
  assert.deepEqual(back.ballot, ['k2', null]);
  assert.equal(back.focus[1], 'everest', 'its card stays where the phone left it');
  assert.equal(l.leave(1), false, 'leaving an open vote undoes nothing');
  l.reset('svizzera');
  assert.deepEqual(l.snapshot().ballot, [null, null]);
  assert.equal(l.current, 'svizzera');
});

test('server: {t:"vote"} from a pad reaches the host with its slot; junk is dropped', async (t) => {
  assert.deepEqual(sanitizeVote({ t: 'vote', world: 'k2', lock: true }), { world: 'k2', lock: true });
  assert.deepEqual(sanitizeVote({ t: 'vote', world: 'random', lock: 1 }), { world: 'random', lock: false });
  for (const bad of [{ t: 'vote' }, { t: 'vote', world: 'K2!' }, { t: 'vote', world: 'x'.repeat(40) }, { t: 'vote', world: 7 }]) assert.equal(sanitizeVote(bad), null);
  const srv = await startServer();
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  const b = await pad(srv, 'bbbb');
  await a.next('welcome');
  await b.next('welcome');
  b.send({ t: 'vote', world: 'antelao', lock: true, slot: 0 }); // a forged slot is overwritten
  assert.deepEqual(await h.next('vote'), { t: 'vote', slot: 1, world: 'antelao', lock: true });
  a.send({ t: 'vote', world: 'everest' });
  assert.deepEqual(await h.next('vote'), { t: 'vote', slot: 0, world: 'everest', lock: false });
  a.send({ t: 'vote', world: '../etc' });
  assert.ok(await h.none('vote'));
  // the host's menu reaches only that phone
  h.send({ t: 'menu', slot: 0, worlds: MOUNTAINS, phase: 'vote', focus: 'everest' });
  assert.equal((await a.next('menu')).focus, 'everest');
  assert.ok(await b.none('menu'));
});
