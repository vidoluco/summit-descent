// Pure helpers of the host UI (no DOM): mass fill, podium order, the "drank from you" list, the icons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { massFill, rankResults, drankList, SCREENS, OVERLAYS, MASS_MAX } from '../src/ui/index.js';
import { animal, dropMeter, dropFace, cloud, ANIMAL_KINDS, PLAYER_COLORS } from '../src/ui/icons.js';
import { SCENES } from '../src/ui/tools/scenes.js';
import { SPECIES, VARIANTS } from '../src/render/animals/registry.js';
import { existsSync } from 'node:fs';

test('massFill maps the sim mass range onto the drop icon', () => {
  assert.equal(MASS_MAX, 2.8, 'full where the drawn drop and its torrent top out (drop-look.js)');
  assert.equal(massFill(4), 1);
  assert.equal(massFill(2.8), 1);
  assert.equal(massFill(9), 1);
  assert.equal(massFill(1.4), 0.5);
  assert.equal(massFill(0.7), 0.25);
  assert.equal(massFill(0), 0.04, 'never fully empty, the outline stays readable');
  assert.equal(massFill(undefined), 0);
});

test('rankResults: finishers by place, then the ones who did not finish by slot', () => {
  const order = (ps) => rankResults(ps).map((p) => p.slot);
  assert.deepEqual(order([{ slot: 0, place: 2 }, { slot: 1, place: 1 }]), [1, 0]);
  assert.deepEqual(order([{ slot: 0, finished: false }, { slot: 1, place: 1 }]), [1, 0]);
  assert.deepEqual(order([{ slot: 1 }, { slot: 0 }]), [0, 1]);
  assert.deepEqual(order([]), []);
  const input = [{ slot: 0, place: 2 }, { slot: 1, place: 1 }];
  rankResults(input);
  assert.deepEqual(input.map((p) => p.slot), [0, 1], 'input left alone');
});

test('drankList accepts counts, pairs or raw drink events, keeps known species, most first', () => {
  assert.deepEqual(drankList({ marmot: 1, ibex: 3, dragon: 2, cow: 0 }), [{ kind: 'ibex', n: 3 }, { kind: 'marmot', n: 1 }]);
  assert.deepEqual(drankList([{ kind: 'eagle', n: 2 }, { kind: 'eagle' }]), [{ kind: 'eagle', n: 3 }]);
  const events = [{ kind: 'drink', animalKind: 'chamois' }, { kind: 'drink', animalKind: 'chamois' }, { kind: 'drink', animalKind: 'hare' }];
  assert.deepEqual(drankList(events.map((e) => ({ kind: e.animalKind }))), [{ kind: 'chamois', n: 2 }, { kind: 'hare', n: 1 }]);
  assert.deepEqual(drankList(null), []);
  // ties follow the species order of the icon set
  assert.deepEqual(drankList({ cow: 1, marmot: 1 }).map((d) => d.kind), ['marmot', 'cow']);
});

test('icons: one sticker per Monte Peralba species, unique clip ids, drop fill follows the mass', () => {
  assert.deepEqual(ANIMAL_KINDS.slice(0, 7), ['marmot', 'ibex', 'chamois', 'eagle', 'chough', 'hare', 'cow']);
  const a = animal('marmot');
  const b = animal('marmot');
  assert.match(a, /^<svg class="animal"/);
  const id = (s) => /clipPath id="([^"]+)"/.exec(s)[1];
  assert.notEqual(id(a), id(b), 'two stickers on one page do not share a clip path');
  assert.equal(animal('dragon'), '');
  assert.match(dropMeter(0.5), /y="44\.00"/);
  assert.match(dropMeter(1), /y="4\.00"/);
  assert.match(dropFace(1), new RegExp(PLAYER_COLORS[1].main));
  assert.match(cloud(0), /class="cloud"/);
});

test('icons: every species of the game has one, the drawn badge or the sticker rendered from its model', () => {
  // a paint variant (the Valais chamois in its winter coat) is the same animal to the race and the results
  const paints = new Set(Object.values(VARIANTS).flatMap((v) => Object.values(v)));
  for (const kind of paints) assert.ok(!ANIMAL_KINDS.includes(kind), `${kind} is a paint, not a species of its own`);
  for (const kind of Object.keys(SPECIES).filter((k) => !paints.has(k))) {
    assert.ok(ANIMAL_KINDS.includes(kind), kind);
    assert.ok(existsSync(`assets/ui/animals/${kind}.png`), `assets/ui/animals/${kind}.png (node src/ui/tools/stickers.mjs ${kind})`);
    assert.ok(animal(kind), `an icon for ${kind}`);
  }
  assert.equal(animal('lynx'), '<img class="animal sticker" alt="" src="assets/ui/animals/lynx.png">');
  // a drink by a Carpathian or Asian species shows on the results, not only the Monte Peralba ones
  assert.deepEqual(drankList({ 'brown-bear': 2, yak: 1, dragon: 4 }), [{ kind: 'brown-bear', n: 2 }, { kind: 'yak', n: 1 }]);
});

test('every screen and overlay has a screenshot scene', () => {
  const names = new Set(SCENES.map((s) => s.name));
  for (const s of [...SCREENS, ...OVERLAYS]) assert.ok(names.has(s), s);
});
