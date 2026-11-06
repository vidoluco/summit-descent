// Host screens as DOM overlays over the game canvas: lobby, countdown, race HUD per half, stage transition,
// finished, results, the "waiting for" banner and the room-full toast. Every visible string comes from src/i18n.
//
//   const ui = createUI(root, { t, lang });
//   ui.show('lobby', { padUrl, slots: [{ connected }, { connected }], stages: 4, vote });
//   ui.vote({ cards, focus, ballot, phase, pick, spin, ... });   // the mountain vote (gallery.js), live
//   ui.onStart(({ mode }) => ...); ui.onLang((lang) => ...); ui.onRematch(() => ...); ui.onPick((id) => ...);
//
// Main screens are exclusive: 'lobby', 'countdown', 'race', 'results'. Overlays stack on top and are removed with
// hide(): 'stage', 'finished' and 'gap' (per half, cleared when the main screen changes), 'waiting' (per slot), 'full'
// and 'notice' ({kind: 'next' | 'load' | 'soft'}: a phone that joins at the next race, a stage that does not load,
// software WebGL). Once a phone is in, the lobby turns into the mountain vote: the gallery of cards (gallery.js) with
// the players' votes, the QR shrinks into a corner while a place is free. ui.fill(target, v) draws the hold or lockout progress on 'start', 'rematch' and 'back'.
import { translator, ordinal, formatAltitude, formatTime, pickLabel, nextLang, LANGS, locale } from '../i18n/index.js';
import { CSS } from './style.js';
import { dropMeter, dropFace, cloud, check, phone, wifi, animal, ANIMAL_KINDS } from './icons.js';
import { createGallery } from './gallery.js';
import { RANDOM } from '../game/mountains.js';
import { bodyScale, DROP_LOOK } from '../render/drop-look.js';

export const SCREENS = ['lobby', 'countdown', 'race', 'results'];
export const OVERLAYS = ['stage', 'finished', 'gap', 'waiting', 'full', 'notice'];
// The HUD drop is full where the drawn drop and its torrent top out (drop-look.js tail.full, 2.8): a real race
// reaches 2.5 to 2.8 and never the sim's cap of 4, so the icon fills as visibly as the drop grows.
export const MASS_MAX = DROP_LOOK.tail.full;

// Fill level of the HUD drop for a given mass (sim range 0.25..4, full from MASS_MAX).
export function massFill(mass) {
  if (!Number.isFinite(mass)) return 0;
  return Math.max(0.04, Math.min(1, mass / MASS_MAX));
}

// Results rows sorted for the podium: finishers by place, then the others by slot.
export function rankResults(players = []) {
  const done = (p) => Number.isInteger(p.place) && p.place > 0 && p.finished !== false;
  return [...players].sort((a, b) => (done(b) - done(a)) || (done(a) ? a.place - b.place : a.slot - b.slot));
}

// {marmot: 2, ibex: 1} or [{kind, n}] or a list of drink events -> [{kind, n}], known species only, most first.
export function drankList(drank) {
  const counts = new Map();
  const add = (kind, n = 1) => { if (ANIMAL_KINDS.includes(kind) && n > 0) counts.set(kind, (counts.get(kind) || 0) + n); };
  if (Array.isArray(drank)) for (const d of drank) add(d.kind ?? d.animalKind, d.n ?? 1);
  else if (drank && typeof drank === 'object') for (const [k, n] of Object.entries(drank)) add(k, n);
  return [...counts].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n || ANIMAL_KINDS.indexOf(a.kind) - ANIMAL_KINDS.indexOf(b.kind));
}

// Each player's stage splits from race.results() stageTimes (the time the drop has ridden up to the end of each stage,
// so a split is the difference to the stage before; never the total: the cloud can give a trailer seconds back, so
// stageTimes.at(-1) may exceed results().time, which the card shows), with the seconds behind the fastest split of that stage. A stage a drop did not
// finish (or a race started past it, ?stage=N) has no split. -> [{slot, splits: [{k, split, behind} | null]}]
export function stageSplits(players = [], stages = 0) {
  const n = Math.max(stages, ...players.map((p) => p.stageTimes?.length || 0));
  const rows = players.map((p) => {
    const t = p.stageTimes || [];
    return { slot: p.slot, splits: Array.from({ length: n }, (_, k) => {
      if (!Number.isFinite(t[k])) return null;
      const from = k === 0 ? 0 : t[k - 1];
      return Number.isFinite(from) ? { k, split: t[k] - from } : null;
    }) };
  });
  for (let k = 0; k < n; k++) {
    const best = Math.min(...rows.map((r) => r.splits[k]?.split ?? Infinity));
    for (const r of rows) if (r.splits[k]) r.splits[k].behind = r.splits[k].split - best;
  }
  return rows;
}

const CSS_ID = 'sd-ui-style';

export function createUI(root, { t, lang = 'en', doc = root.ownerDocument || globalThis.document } = {}) {
  if (!doc.getElementById(CSS_ID)) {
    const style = doc.createElement('style');
    style.id = CSS_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
  let tr = t || translator(lang);

  const el = (tag, cls, html) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  };
  const text = (e, s) => { if (e.textContent !== s) e.textContent = s; return e; };
  const placeInto = (e, n) => {
    const [num, sfx] = ordinal(lang, n);
    e.innerHTML = '';
    e.append(text(el('span', 'n'), num), text(el('span', sfx === '°' ? 'sfx deg' : 'sfx'), sfx));
  };
  const listeners = { start: new Set(), lang: new Set(), rematch: new Set(), back: new Set(), pick: new Set() };
  const emit = (name, arg) => { for (const fn of listeners[name]) { try { fn(arg); } catch (e) { console.error(e); } } };
  const on = (name) => (fn) => { listeners[name].add(fn); return () => listeners[name].delete(fn); };

  const ui = el('div', 'sd-ui');
  ui.lang = lang;
  root.appendChild(ui);

  // ---------- lobby ----------
  const lobby = el('section', 'scr lobby hide');
  lobby.innerHTML = `
<div class="head"><div class="title ink">${dropFace(0)}${dropFace(1)}<span class="gname"></span></div>
  <div class="world"><span class="wname"></span><i></i><small class="wsub"></small></div></div>
<div class="langs" role="group">${LANGS.map((l) => `<button type="button" data-lang="${l}"></button>`).join('')}</div>
<div class="main">
  <div class="join card"><div class="qr"><img alt=""></div>
    <div class="txt"><h2>${phone()}<span class="jt"></span></h2><p class="js"></p><div class="or"></div><div class="url"></div>
      <div class="wifi-line">${wifi()}<span class="jw"></span></div></div></div>
  <div class="slots">${[0, 1].map((s) => `<div class="slot" data-slot="${s}"><div class="player"></div>${dropFace(s)}
    <div class="name ink"></div><div class="state">${check()}<span class="st"></span><span class="dots"><i></i><i></i><i></i></span></div></div>`).join('')}</div>
</div>
<div class="foot">
  <div class="modes"><button type="button" class="mode sel" data-mode="short"><b></b><span></span></button>
    <button type="button" class="mode soon" data-mode="real" aria-disabled="true"><b></b><span></span><i class="ribbon"></i></button></div>
  <button type="button" class="start go"><b class="ink"></b><span></span></button>
</div>
<div class="vfoot"><div class="vjoin card"><div class="qr"><img alt=""></div><div><b></b><span></span><small class="url"></small></div></div>
  ${[0, 1].map((s) => `<div class="vp" data-slot="${s}">${dropFace(s)}<div><b class="ink"></b><span></span></div></div>`).join('')}</div>`;
  const $l = (s) => lobby.querySelector(s);
  const slotEls = [...lobby.querySelectorAll('.slot')];
  const gallery = createGallery(lobby, { el, text, tr: () => tr, lang: () => lang });
  // a click on a card on the TV itself (a mouse, a remote): the mountain to race when no phone voted
  gallery.el.addEventListener('click', (e) => { const c = e.target.closest?.('.mcard'); if (c) emit('pick', c.dataset.id); });
  let mode = 'short';
  let lobbyCanStart = false;
  $l('.start').addEventListener('click', () => { if (lobbyCanStart) emit('start', { mode }); });
  for (const b of lobby.querySelectorAll('.mode')) {
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      mode = b.dataset.mode;
      for (const m of lobby.querySelectorAll('.mode')) m.classList.toggle('sel', m === b);
    });
  }
  for (const b of lobby.querySelectorAll('.langs button')) {
    b.addEventListener('click', () => {
      if (b.dataset.lang === lang) return;
      api.setLang(b.dataset.lang);
      emit('lang', lang);
    });
  }

  function renderLobby(d = {}) {
    text($l('.gname'), tr('game.name'));
    const world = d.world || 'dolomiti';
    text($l('.wname'), tr(`world.${world}`));
    text($l('.wsub'), tr(`world.${world}.sub`));
    for (const b of lobby.querySelectorAll('.langs button')) {
      text(b, tr(`ui.lang.${b.dataset.lang}`));
      b.classList.toggle('on', b.dataset.lang === lang);
    }
    lobby.querySelector('.langs').setAttribute('aria-label', tr('ui.lang'));
    const padUrl = d.padUrl || '';
    const qr = d.qr || (padUrl ? `/qr.svg?u=${encodeURIComponent(padUrl)}` : '');
    const img = $l('.qr img');
    if (qr && img.getAttribute('src') !== qr) img.setAttribute('src', qr);
    $l('.qr').classList.toggle('hide', !qr);
    text($l('.jt'), tr('ui.join.title'));
    text($l('.js'), tr('ui.join.scan'));
    text($l('.or'), tr('ui.join.or'));
    text($l('.url'), padUrl.replace(/^https?:\/\//, ''));
    text($l('.jw'), tr('ui.join.wifi'));
    const slots = d.slots || [];
    let any = false;
    slotEls.forEach((s, i) => {
      const info = slots[i] || {};
      const onNow = !!info.connected;
      any ||= onNow;
      if (onNow && !s.classList.contains('on')) {
        s.classList.remove('joined');
        void s.offsetWidth;
        s.classList.add('joined');
      }
      s.classList.toggle('on', onNow);
      s.classList.toggle('away', !onNow && !!info.away);
      text(s.querySelector('.player'), tr('ui.player', { n: i + 1 }));
      text(s.querySelector('.name'), info.name || tr(`ui.slot.name${i}`));
      // info.ready false: the phone is there and BOOST makes it ready (undefined: there is nothing to confirm)
      s.classList.toggle('unready', onNow && info.ready === false);
      text(s.querySelector('.st'), tr(onNow ? (info.ready === false ? 'ui.slot.press' : 'ui.slot.ready') : info.away ? 'ui.slot.away' : 'ui.slot.empty'));
    });
    const short = $l('.mode[data-mode="short"]');
    const real = $l('.mode[data-mode="real"]');
    text(short.querySelector('b'), tr('ui.mode.short'));
    text(short.querySelector('span'), tr('ui.mode.shortText', { n: d.stages ?? 4 }));
    text(real.querySelector('b'), tr('ui.mode.real'));
    text(real.querySelector('span'), tr('ui.mode.realText'));
    text(real.querySelector('.ribbon'), tr('ui.mode.soon'));
    lobbyCanStart = d.canStart ?? any;
    const start = $l('.start');
    start.toggleAttribute('disabled', !lobbyCanStart);
    start.classList.toggle('ready', lobbyCanStart);
    text(start.querySelector('b'), tr(lobbyCanStart ? 'ui.start' : 'ui.start.need'));
    text(start.querySelector('span'), lobbyCanStart ? tr(d.hint === 'solo' ? 'ui.start.solo' : d.hint === 'both' ? 'ui.start.both' : 'ui.start.hint') : '');
    start.querySelector('span').classList.toggle('hide', !lobbyCanStart);
    renderVote(d);
  }

  // The vote: the gallery and the players' bar under it, once a phone is in and the game sent the mountains.
  function renderVote(d = screenData.lobby || {}) {
    const slots = d.slots || [];
    const voting = !!d.vote?.cards?.length && slots.some((s) => s?.connected);
    lobby.classList.toggle('voting', voting);
    lobby.classList.toggle('deciding', voting && !!d.vote.phase && d.vote.phase !== 'vote');
    gallery.render(voting ? { ...d.vote, present: [0, 1].map((i) => !!slots[i]?.connected) } : null);
    if (!voting) return;
    const v = d.vote;
    const start = $l('.start');
    if (lobbyCanStart) {
      text(start.querySelector('b'), tr('ui.vote.start'));
      text(start.querySelector('span'), tr(d.hint === 'solo' ? 'ui.vote.startSolo' : 'ui.vote.startHint'));
    }
    const nameOf = (id) => {
      const c = v.cards.find((m) => m.id === id);
      if (!c) return id === RANDOM ? tr('mountain.random') : '';
      const named = tr(`mountain.${id}`); // with its article: "Guarda il Cervino"
      return named !== `mountain.${id}` ? named : pickLabel(lang, c.summit.names) || c.summit.name;
    };
    const free = slots.some((s) => !s?.connected);
    const join = $l('.vjoin');
    join.classList.toggle('hide', !free);
    const src = $l('.main .qr img').getAttribute('src');
    if (src && join.querySelector('img').getAttribute('src') !== src) join.querySelector('img').setAttribute('src', src);
    text(join.querySelector('b'), tr('ui.vote.empty'));
    text(join.querySelector('span'), tr('ui.vote.scan'));
    text(join.querySelector('.url'), (d.padUrl || '').replace(/^https?:\/\//, ''));
    for (const p of lobby.querySelectorAll('.vp')) {
      const i = Number(p.dataset.slot), info = slots[i] || {};
      const ballot = v.ballot?.[i], focus = v.focus?.[i];
      p.classList.toggle('on', !!info.connected);
      p.classList.toggle('voted', !!info.connected && !!ballot);
      p.classList.toggle('free', !info.connected);
      text(p.querySelector('b'), tr(`ui.slot.name${i}`));
      text(p.querySelector('span'), !info.connected ? tr(info.away ? 'ui.vote.away' : 'ui.slot.empty')
        : ballot ? tr('ui.vote.votedFor', { name: nameOf(ballot) }) : focus ? tr('ui.vote.choosingAt', { name: nameOf(focus) }) : tr('ui.vote.choosing'));
    }
  }

  // ---------- race: halves with HUD, countdown and per-half overlays ----------
  const race = el('section', 'scr race hide');
  race.innerHTML = `<div class="halves">${[0, 1].map((s) => `<div class="half" data-slot="${s}">
  <div class="hud"><div class="meter">${dropMeter(0.25)}<div class="info"><div class="alt ink"></div><div class="stg ink"></div></div></div>
    <div class="place ink"></div></div>
  <div class="cd hide"><div class="ti hide"><b class="ink"></b><span class="ink"></span><small class="ink"></small></div><div class="n ink"></div></div>
  <div class="stage hide"><div class="sc card"><div class="cl"></div><div class="tx"><div class="big"></div><div class="mid"></div>
    <div class="pill"><span class="sn"></span><small class="so"></small></div></div></div></div>
  <div class="finished hide"><div class="fc card"><div class="fd"></div><div class="tx"><div class="big"></div><div class="where"></div></div>
    <div class="pl"></div><div class="time"></div></div><div class="wait"></div></div>
  <div class="gap ink hide"></div>
  <div class="waiting card hide" data-slot="${s}">${dropFace(s, { mood: 'sleep' })}<div><b></b><span></span></div><i class="pulse"></i></div>
</div>`).join('')}</div><div class="divider"></div>`;
  const halves = [...race.querySelectorAll('.half')];
  const hudData = [{}, {}];
  const stageData = [null, null];
  const finishedData = [null, null];
  const gapData = [null, null];
  const waitingOn = [false, false];
  let raceSlots = [0, 1];
  let countdown = null;

  function layout(slots) {
    raceSlots = Array.isArray(slots) && slots.length ? slots.filter((s) => s === 0 || s === 1) : [0, 1];
    const solo = raceSlots.length === 1;
    ui.classList.toggle('solo', solo);
    ui.classList.toggle('split', !solo);
    halves.forEach((h, i) => h.classList.toggle('off', !raceSlots.includes(i)));
  }

  function renderHud(slot) {
    const d = hudData[slot];
    const h = halves[slot];
    const meter = h.querySelector('.drop-meter');
    const fill = massFill(d.mass ?? 1);
    const y = (84 - fill * 80).toFixed(2);
    meter.querySelector('.lvl').setAttribute('y', y);
    meter.querySelector('.wave').setAttribute('d', `M-4 ${y} q 9 -4 18 0 t 18 0 t 18 0 t 18 0 v 6 h -72 z`);
    // The icon also grows with the drop, on the curve of the drawn drop (render/drop-look.js), springing past
    // each new size (the transition overshoots): 0.65 x at mass 0.5, 0.9 x at the start, 1.24 x for a full drop.
    meter.style.transform = `scale(${(0.9 * Math.pow(bodyScale(Math.max(0.25, d.mass ?? 1)), 0.8)).toFixed(3)})`;
    const alt = h.querySelector('.alt');
    text(alt, Number.isFinite(d.altitude) ? tr('ui.hud.altitude', { m: formatAltitude(lang, d.altitude) }) : '');
    const stg = h.querySelector('.stg');
    text(stg, Number.isInteger(d.stage) ? tr('ui.hud.stage', { n: d.stage, total: d.stages ?? d.stage }) : '');
    const pl = h.querySelector('.place');
    const place = Number.isInteger(d.place) && d.place > 0 ? d.place : 0;
    if (String(place) !== pl.dataset.place || pl.dataset.lang !== lang) {
      if (place && pl.dataset.place && pl.dataset.place !== '0' && pl.dataset.lang === lang) {
        pl.classList.remove('bump');
        void pl.offsetWidth;
        pl.classList.add('bump');
      }
      pl.dataset.place = String(place);
      pl.dataset.lang = lang;
      if (place) placeInto(pl, place); else pl.innerHTML = '';
    }
  }

  function renderCountdown() {
    race.classList.toggle('counting', !!countdown);
    for (const h of halves) {
      const cd = h.querySelector('.cd');
      if (!countdown) { cd.classList.add('hide'); continue; }
      cd.classList.remove('hide');
      const n = cd.querySelector('.n'), ti = cd.querySelector('.ti'), title = countdown.title;
      // the start shot before the numbers: the mountain's name and the first stage, no number yet
      ti.classList.toggle('hide', !title);
      n.classList.toggle('hide', !!title);
      if (title) {
        text(ti.querySelector('b'), tr(`world.${title.world}`));
        text(ti.querySelector('span'), pickLabel(lang, title.name));
        text(ti.querySelector('small'), title.stages ? tr('ui.stage.of', { n: title.stage, total: title.stages }) : '');
        continue;
      }
      const go = countdown.n <= 0;
      text(n, go ? tr('ui.go') : String(countdown.n));
      n.classList.toggle('go', go);
    }
  }
  function tickCountdown() {
    for (const h of halves) {
      const n = h.querySelector('.cd .n');
      n.classList.remove('tick');
      void n.offsetWidth;
      n.classList.add('tick');
    }
  }

  function renderStage(slot) {
    const d = stageData[slot];
    const box = halves[slot].querySelector('.stage');
    box.classList.toggle('hide', !d);
    if (!d) return;
    const cl = box.querySelector('.cl');
    if (cl.dataset.slot !== String(slot)) { cl.innerHTML = cloud(slot); cl.dataset.slot = String(slot); }
    text(box.querySelector('.big'), tr('ui.stage.evaporate'));
    text(box.querySelector('.mid'), tr('ui.stage.rain', { n: d.stage }));
    text(box.querySelector('.sn'), pickLabel(lang, d.name));
    box.querySelector('.sn').classList.toggle('hide', !d.name);
    text(box.querySelector('.so'), d.stages ? tr('ui.stage.of', { n: d.stage, total: d.stages }) : '');
  }

  function renderFinished(slot) {
    const d = finishedData[slot];
    const box = halves[slot].querySelector('.finished');
    box.classList.toggle('hide', !d);
    if (!d) return;
    // a card in the top of the half, clear of the drop (the camera keeps it in the lower half): the finish line, where
    // it is on the real mountain (the index's finish name), the place and the time
    const fd = box.querySelector('.fd');
    if (fd.dataset.slot !== String(slot)) { fd.innerHTML = dropFace(slot); fd.dataset.slot = String(slot); }
    text(box.querySelector('.big'), tr('ui.finished.title'));
    const where = pickLabel(lang, d.where);
    text(box.querySelector('.where'), where).classList.toggle('hide', !where);
    const pl = box.querySelector('.pl');
    pl.classList.toggle('hide', !(Number.isInteger(d.place) && d.place > 0));
    if (Number.isInteger(d.place) && d.place > 0) placeInto(pl, d.place); else pl.innerHTML = '';
    text(box.querySelector('.time'), Number.isFinite(d.time) ? formatTime(lang, d.time) : '');
    text(box.querySelector('.wait'), tr('ui.finished.wait')).classList.toggle('hide', d.wait === false);
  }

  // the gap to the other drop while one of them has nothing to steer (stage end, cloud, raining in late)
  let gapFmt = null, gapFmtLang = null;
  function renderGap(slot) {
    const d = gapData[slot];
    const box = halves[slot].querySelector('.gap');
    box.classList.toggle('hide', !d);
    if (!d) return;
    if (gapFmtLang !== lang) { gapFmt = new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 }); gapFmtLang = lang; }
    box.classList.toggle('ahead', !!d.ahead && !d.pending);
    box.classList.toggle('pending', !!d.pending);
    // pending: the other drop is still racing, so the seconds are the time since the leader finished, not the gap yet
    const other = 1 - slot, s = gapFmt.format(d.s);
    text(box, d.pending ? tr(d.ahead ? `ui.gap.wait${other}` : `ui.gap.since${other}`, { s }) : tr(d.ahead ? 'ui.gap.ahead' : 'ui.gap.behind', { s }));
  }

  function renderWaiting(slot) {
    const w = halves[slot].querySelector('.waiting');
    w.classList.toggle('hide', !waitingOn[slot] || current === 'lobby');
    halves[slot].classList.toggle('paused', waitingOn[slot] && current !== 'lobby');
    text(w.querySelector('b'), tr(`ui.waiting${slot}`));
    text(w.querySelector('span'), tr('ui.waiting.text'));
  }

  // ---------- results ----------
  const results = el('section', 'scr results hide');
  results.innerHTML = `<div class="head"><h1 class="ink"></h1><div class="sub ink"></div></div><div class="podium"></div>
<div class="foot"><button type="button" class="back"><b class="ink"></b><span></span></button><button type="button" class="start ready"><b class="ink"></b><span></span></button></div>`;
  results.querySelector('.start').addEventListener('click', () => { if (!results.querySelector('.start').disabled) emit('rematch'); });
  results.querySelector('.back').addEventListener('click', () => emit('back'));

  function renderResults(d = {}) {
    text(results.querySelector('h1'), tr('ui.results.title'));
    text(results.querySelector('.sub'), tr(`world.${d.world || 'dolomiti'}`));
    // behind the podium, the mountain just raced, as people photograph its summit (assets/backdrops/<id>-summit.jpg)
    results.style.setProperty('--art', d.art ? `url("${d.art}")` : 'none');
    const players = d.players || [];
    // the rematch: every phone taps BOOST (d.ready per slot, from src/game/gate.js); one tapped, the line says who waits
    const ready = Array.isArray(d.ready) ? d.ready : [false, false];
    const humans = players.filter((p) => !p.bot).length;
    const waiting = humans > 1 && ready.filter(Boolean).length === 1 ? ready.indexOf(true) : -1;
    text(results.querySelector('.start b'), tr('ui.rematch'));
    text(results.querySelector('.start span'), waiting >= 0 ? tr(`ui.rematch.wait${waiting}`) : tr(humans > 1 ? 'ui.rematch.both' : 'ui.rematch.hint'));
    results.querySelector('.start').classList.toggle('half-ready', waiting >= 0);
    text(results.querySelector('.back b'), tr('ui.back'));
    text(results.querySelector('.back span'), tr('ui.back.hint'));
    const pod = results.querySelector('.podium');
    pod.innerHTML = '';
    const ranked = rankResults(players);
    const winner = ranked.find((p) => Number.isInteger(p.place) && p.place === 1 && Number.isFinite(p.time));
    const names = d.stageNames || [];
    const splits = new Map(stageSplits(players, names.length).map((r) => [r.slot, r.splits]));
    if (!splitFmt[lang]) splitFmt[lang] = new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const sec = (v) => splitFmt[lang].format(v);
    for (const p of ranked) {
      const card = el('div', 'res card');
      card.dataset.slot = String(p.slot);
      card.classList.toggle('ready', !!ready[p.slot] && !p.bot);
      const done = Number.isInteger(p.place) && p.place > 0 && p.finished !== false;
      const top = el('div', 'top', dropFace(p.slot, { mood: done ? 'happy' : 'sleep' }));
      const who = el('div', 'who');
      who.append(text(el('b'), p.name || tr(`ui.slot.name${p.slot}`)), text(el('span'), tr('ui.player', { n: p.slot + 1 })));
      const medal = el('div', `medal ink ${done ? `p${p.place}` : 'dnf'}`);
      if (done) placeInto(medal, p.place); else medal.append(text(el('span', 'dash'), '–'));
      top.append(who, medal);
      const time = el('div', 'time');
      time.append(text(el('span'), tr('ui.results.time')));
      // behind the winner, next to the time
      if (done && winner && winner !== p && Number.isFinite(p.time)) time.append(text(el('i', 'behind'), tr('ui.results.behind', { t: formatTime(lang, p.time - winner.time) })));
      const tb = el('b', done ? '' : 'dnf');
      text(tb, done && Number.isFinite(p.time) ? formatTime(lang, p.time) : tr('ui.results.dnf'));
      time.append(tb);
      // the stages one by one, with their real names, and the drop's biggest size
      const sp = splits.get(p.slot) || [];
      const stages = el('div', `stages${sp.length > 4 ? ' many' : ''}`); // five stages (the Antelao): tighter rows on both cards
      const sh = el('div', 'sh');
      sh.append(text(el('b'), tr('ui.results.stages')));
      if (Number.isFinite(p.peak)) {
        const pk = el('span', 'peak', dropMeter(massFill(p.peak)));
        pk.append(text(el('span'), tr('ui.results.peak')), text(el('b'), sec(p.peak)));
        sh.append(pk);
      }
      stages.append(sh);
      sp.forEach((x, k) => {
        if (!x) return;
        const row = el('div', 'srow');
        row.append(text(el('i'), String(k + 1)), text(el('span', 'snm'), pickLabel(lang, names[k]) || tr('ui.stage.of', { n: k + 1, total: sp.length })));
        if (x.behind >= 0.05) row.append(text(el('small'), `+${sec(x.behind)}`));
        else row.append(el('small', 'best'));
        row.append(text(el('b'), formatTime(lang, x.split)));
        stages.append(row);
      });
      const list = drankList(p.drank);
      const h3 = text(el('h3'), tr('ui.results.drank'));
      const drank = el('div', 'drank');
      if (!list.length) {
        const nb = el('div', 'nobody', dropFace(p.slot));
        nb.append(text(el('span'), tr('ui.results.nobody')));
        drank.append(nb);
      }
      for (const { kind, n } of list) {
        const c = el('div', 'critter', animal(kind));
        c.title = tr(`animal.${kind}`);
        const col = el('div');
        col.append(text(el('span', 'x'), tr('ui.results.times', { n })), text(el('span', 'nm'), tr(`animal.${kind}`)));
        c.append(col);
        drank.append(c);
      }
      const chip = el('div', 'rdy', check());
      chip.append(text(el('span'), tr('ui.results.ready')));
      card.append(top, time, ...(sp.some(Boolean) || Number.isFinite(p.peak) ? [stages] : []), ...(list.length ? [h3] : []), drank, chip);
      pod.append(card);
    }
  }
  const splitFmt = {};

  // ---------- room full toast ----------
  const full = el('div', 'toast card hide', `${phone()}<div><b></b><span></span></div>`);
  let fullTimer = 0;
  function renderFull() {
    text(full.querySelector('b'), tr('ui.full.title'));
    text(full.querySelector('span'), tr('ui.full.text'));
  }

  // ---------- notice: a phone joining at the next race, a stage that does not load, software graphics ----------
  const notice = el('div', 'toast notice card hide', `<div class="ic"></div><div><b></b><span></span></div>`);
  let noticeData = null, noticeTimer = 0;
  function renderNotice() {
    notice.classList.toggle('hide', !noticeData);
    if (!noticeData) return;
    const { kind, slot } = noticeData;
    const ic = notice.querySelector('.ic');
    const icon = kind === 'next' ? 'phone' : kind === 'load' ? 'wifi' : 'sleep';
    if (ic.dataset.icon !== icon) { ic.innerHTML = icon === 'phone' ? phone() : icon === 'wifi' ? wifi() : dropFace(0, { mood: 'sleep' }); ic.dataset.icon = icon; }
    notice.dataset.kind = kind;
    text(notice.querySelector('b'), tr(kind === 'next' ? `ui.next.title${slot === 1 ? 1 : 0}` : `ui.${kind}.title`));
    text(notice.querySelector('span'), tr(`ui.${kind}.text`));
  }

  ui.append(lobby, race, results, full, notice);

  // ---------- state ----------
  let current = null;
  const screenData = {};
  const mains = { lobby, race, results };

  function setMain(name) {
    const target = name === 'countdown' ? 'race' : name;
    for (const [k, s] of Object.entries(mains)) s.classList.toggle('hide', k !== target);
    if (current !== name && name !== 'race') {
      for (let s = 0; s < 2; s++) { stageData[s] = null; finishedData[s] = null; gapData[s] = null; renderStage(s); renderFinished(s); renderGap(s); }
    }
    current = name;
    ui.dataset.screen = name;
    for (let s = 0; s < 2; s++) renderWaiting(s);
  }

  function renderAll() {
    ui.lang = lang;
    if (screenData.lobby) renderLobby(screenData.lobby);
    for (let s = 0; s < 2; s++) { renderHud(s); renderStage(s); renderFinished(s); renderGap(s); renderWaiting(s); }
    renderCountdown();
    if (screenData.results) renderResults(screenData.results);
    renderFull();
    renderNotice();
  }

  const api = {
    el: ui,
    get lang() { return lang; },
    get screen() { return current; },

    show(screen, data = {}) {
      switch (screen) {
        case 'lobby':
          screenData.lobby = { vote: screenData.lobby?.vote, ...data }; // the vote stays until ui.vote() changes it
          countdown = null;
          renderCountdown();
          setMain('lobby');
          renderLobby(screenData.lobby);
          break;
        case 'countdown':
          if (data.slots) layout(data.slots); else if (current !== 'race' && current !== 'countdown') layout(raceSlots);
          setMain('countdown');
          countdown = { n: Number.isFinite(data.n) ? Math.max(0, Math.round(data.n)) : 3, title: data.title || null };
          renderCountdown();
          if (!countdown.title) tickCountdown();
          break;
        case 'race': {
          if (data.slots) layout(data.slots); else if (data.players) layout(data.players === 1 ? [0] : [0, 1]); else layout(raceSlots);
          const wasGo = countdown && countdown.n <= 0;
          setMain('race');
          if (!wasGo) { countdown = null; renderCountdown(); } else { race.classList.remove('counting'); setTimeout(() => { if (current === 'race') { countdown = null; renderCountdown(); } }, 1100); }
          for (let s = 0; s < 2; s++) renderHud(s);
          break;
        }
        case 'results':
          screenData.results = data;
          countdown = null;
          renderCountdown();
          setMain('results');
          renderResults(data);
          break;
        case 'stage': {
          for (const s of slotsOf(data)) { stageData[s] = { ...data }; finishedData[s] = null; renderFinished(s); renderStage(s); }
          break;
        }
        case 'finished':
          for (const s of slotsOf(data)) { finishedData[s] = { ...data }; stageData[s] = null; renderStage(s); renderFinished(s); }
          break;
        case 'gap':
          for (const s of slotsOf(data)) { gapData[s] = Number.isFinite(data.s) ? { s: Math.max(0, data.s), ahead: !!data.ahead, pending: !!data.pending } : null; renderGap(s); }
          break;
        case 'waiting':
          for (const s of slotsOf(data)) { waitingOn[s] = true; renderWaiting(s); }
          break;
        case 'notice':
          noticeData = { kind: ['next', 'load', 'soft'].includes(data.kind) ? data.kind : 'soft', slot: data.slot };
          renderNotice();
          clearTimeout(noticeTimer);
          if (data.ms) noticeTimer = setTimeout(() => { noticeData = null; renderNotice(); }, data.ms);
          break;
        case 'full':
          renderFull();
          full.classList.remove('hide');
          clearTimeout(fullTimer);
          if (data.ms !== 0) fullTimer = setTimeout(() => full.classList.add('hide'), data.ms ?? 6000);
          break;
        default:
          throw new Error(`unknown screen ${screen}`);
      }
      return api;
    },

    hide(screen, data = {}) {
      switch (screen) {
        case 'stage': for (const s of slotsOf(data)) { stageData[s] = null; renderStage(s); } break;
        case 'finished': for (const s of slotsOf(data)) { finishedData[s] = null; renderFinished(s); } break;
        case 'gap': for (const s of slotsOf(data)) { gapData[s] = null; renderGap(s); } break;
        case 'waiting': for (const s of slotsOf(data)) { waitingOn[s] = false; renderWaiting(s); } break;
        case 'notice': if (!data.kind || noticeData?.kind === data.kind) { clearTimeout(noticeTimer); noticeData = null; renderNotice(); } break;
        case 'full': clearTimeout(fullTimer); full.classList.add('hide'); break;
        default: throw new Error(`cannot hide ${screen}`);
      }
      return api;
    },

    // Per-half race HUD. Fields are merged, so a caller can send only what changed.
    hud(slot, data = {}) {
      if (slot !== 0 && slot !== 1) return api;
      Object.assign(hudData[slot], data);
      renderHud(slot);
      return api;
    },

    // Switches every visible string. Without t, the translator for lang from src/i18n.
    setLang(next, t2) {
      if (!LANGS.includes(next)) return api;
      lang = next;
      tr = t2 || translator(lang);
      renderAll();
      return api;
    },
    toggleLang() {
      api.setLang(nextLang(lang));
      emit('lang', lang);
      return api;
    },

    onStart: on('start'),
    onLang: on('lang'),
    onRematch: on('rematch'),
    onBack: on('back'),
    onPick: on('pick'),

    // The mountain vote, live (src/game/vote.js snapshot plus the cards): merged into the lobby's data.
    vote(data) {
      screenData.lobby = { ...(screenData.lobby || {}), vote: data };
      if (current === 'lobby') renderVote(screenData.lobby);
      return api;
    },

    // Progress 0..1 on a button: 'start' (lobby, BOOST held for a solo race), 'back' (results, BOOST held),
    // 'rematch' (results: the BOOST lockout; the button stays disabled until it is full).
    fill(target, v) {
      const b = target === 'start' ? $l('.start') : target === 'rematch' ? results.querySelector('.start') : target === 'back' ? results.querySelector('.back') : null;
      if (!b) return api;
      const f = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
      b.style.setProperty('--fill', f.toFixed(3));
      b.classList.toggle('filling', f > 0 && f < 1);
      if (target === 'rematch') b.toggleAttribute('disabled', f < 1);
      return api;
    },

    destroy() {
      clearTimeout(fullTimer);
      clearTimeout(noticeTimer);
      ui.remove();
      for (const s of Object.values(listeners)) s.clear();
    },
  };

  function slotsOf(data) {
    if (Number.isInteger(data.slot)) return data.slot === 0 || data.slot === 1 ? [data.slot] : [];
    if (Array.isArray(data.slots)) return data.slots.filter((s) => s === 0 || s === 1);
    return [0, 1];
  }

  layout([0, 1]);
  renderAll();
  return api;
}
