// The lobby's mountain vote on the TV: the seven mountains as cards (the summit painting, the real name, the flag,
// the summit altitude, the drop, the race time and three animals that live there) plus "surprise us", each
// phone's marker on the card it shows (a ring in its colour) and on the card it voted for (its drop sitting on it
// with a tick), and the verdict: both agree, or the coin flip that spins between the two and lands on the winner.
// Part of src/ui (createUI builds it inside the lobby); every visible string comes from src/i18n.
//
//   const g = createGallery(lobbyEl, { el, text, tr: () => tr, lang: () => lang });
//   g.render({ cards, focus: [id, id], ballot: [id, null], phase: 'vote', pick, spin, winner, landed, loading });
import { formatAltitude, pickLabel } from '../i18n/index.js';
import { roughTime, RANDOM } from '../game/mountains.js';
import { dropFace, check, flag, die, STICKERS } from './icons.js';

export { STICKERS };

export function createGallery(root, { el, text, tr, lang }) {
  const box = el('div', 'gallery hide');
  box.innerHTML = `<div class="vhead"><div class="vt ink"></div><div class="vs"></div></div><div class="cards"></div>
<div class="verdict hide"><div class="vface">${dropFace(0)}${dropFace(1)}</div><div><div class="vbig ink"></div><div class="vsmall"></div></div></div>`;
  root.appendChild(box);
  const grid = box.querySelector('.cards');
  let key = '';
  let cardEls = new Map();

  // The cards, built once per list of mountains (and per language: the names and captions change with it).
  function build(cards) {
    grid.innerHTML = '';
    cardEls = new Map();
    const T = tr(), L = lang();
    for (const c of [...cards, { id: RANDOM }]) {
      const card = el('div', `mcard${c.id === RANDOM ? ' random' : ''}`);
      card.dataset.id = c.id;
      const pins = [0, 1].map((s) => `<i class="pin" data-slot="${s}">${dropFace(s)}${check()}</i>`).join('');
      if (c.id === RANDOM) {
        card.innerHTML = `<div class="pic"><div class="mosaic">${cards.map((m) => `<img alt="" src="${m.image}">`).join('')}</div>${die()}
<div class="cap"><div class="nm ink"></div></div><div class="pins">${pins}</div></div><div class="rtext"></div>`;
        text(card.querySelector('.nm'), T('ui.vote.random'));
        text(card.querySelector('.rtext'), T('ui.vote.randomText'));
      } else {
        card.innerHTML = `<div class="pic"><img class="art" alt="" src="${c.image}"><div class="cap"><div class="nm ink"></div>
<div class="rg">${flag(c.country)}<span></span></div></div><div class="pins">${pins}</div></div>
<div class="stats">${['summit', 'drop', 'time'].map((k) => `<div class="st-${k}"><span></span><b></b></div>`).join('')}</div>
<div class="fauna">${c.animals.map((a) => `<figure><img alt="" src="${STICKERS}${a}.png"><figcaption></figcaption></figure>`).join('')}</div>`;
        text(card.querySelector('.nm'), pickLabel(L, c.summit.names) || c.summit.name);
        text(card.querySelector('.rg span'), T('ui.vote.where', { region: T(`region.${c.id}`), country: T(`country.${c.country}`) }));
        const stat = (k, label, value) => { text(card.querySelector(`.st-${k} span`), T(label)); text(card.querySelector(`.st-${k} b`), value); };
        const m = (v) => (Number.isFinite(v) ? T('ui.hud.altitude', { m: formatAltitude(L, v) }) : '');
        stat('summit', 'ui.vote.summit', m(c.summit.altitude));
        stat('drop', 'ui.vote.drop', m(c.drop));
        stat('time', 'ui.vote.time', roughTime(c.seconds) ? T('ui.vote.about', { t: roughTime(c.seconds) }) : '');
        card.querySelectorAll('.fauna figcaption').forEach((f, i) => text(f, T(`animal.${c.animals[i]}`)));
      }
      grid.appendChild(card);
      cardEls.set(c.id, card);
    }
  }

  // the mountain inside the verdict's sentence, with its article ("il Cervino", "l'Antelao"): mountain.<id> in
  // src/i18n, else the card's name
  const nameOf = (d, id) => {
    const T = tr(), key = `mountain.${id}`, named = T(key);
    if (named !== key) return named;
    const c = d.cards.find((m) => m.id === id);
    return c ? pickLabel(lang(), c.summit.names) || c.summit.name : id || '';
  };

  function render(d) {
    const T = tr();
    const show = !!d && Array.isArray(d.cards) && d.cards.length > 0;
    box.classList.toggle('hide', !show);
    if (!show) return;
    const k = `${lang()}|${d.cards.map((c) => c.id).join(',')}`;
    if (k !== key) { build(d.cards); key = k; }
    text(box.querySelector('.vt'), T('ui.vote.title'));
    text(box.querySelector('.vs'), T('ui.vote.sub'));
    const focus = d.focus || [], ballot = d.ballot || [], present = d.present || [true, true];
    const phase = d.phase || 'vote';
    const rolling = phase === 'roll' || (phase === 'done' && d.candidates?.length > 0);
    box.dataset.phase = phase;
    for (const [id, card] of cardEls) {
      for (const s of [0, 1]) {
        const here = present[s] !== false;
        card.classList.toggle(`f${s}`, here && focus[s] === id && ballot[s] !== id);
        card.classList.toggle(`b${s}`, here && ballot[s] === id);
      }
      const picked = phase !== 'vote' && (rolling ? d.spin === id : d.pick === id);
      card.classList.toggle('spin', rolling && d.spin === id && !d.landed);
      card.classList.toggle('picked', picked && (!rolling || !!d.landed));
      card.classList.toggle('dim', phase !== 'vote' && !picked && !(rolling && d.candidates?.includes(id) && !d.landed));
    }
    // the verdict under the cards: agree, the coin in the air, where it landed
    const v = box.querySelector('.verdict');
    v.classList.toggle('hide', phase === 'vote');
    if (phase === 'vote') return;
    const name = nameOf(d, d.pick);
    let big, small = '';
    if (d.loading) big = T('ui.vote.loading', { name });
    else if (rolling && !d.landed) big = T(d.candidates.length > 2 ? 'ui.vote.rollAny' : 'ui.vote.roll');
    else if (rolling) { big = T('ui.vote.won', { name }); small = d.winner >= 0 ? T(`ui.vote.won${d.winner}`) : ''; }
    else big = T(ballot.filter(Boolean).length > 1 ? 'ui.vote.agree' : 'ui.vote.solo', { name });
    text(v.querySelector('.vbig'), big);
    text(v.querySelector('.vsmall'), small);
    v.querySelector('.vsmall').classList.toggle('hide', !small);
    v.dataset.winner = String(d.winner ?? -1);
  }

  return { el: box, render, reset() { key = ''; } };
}
