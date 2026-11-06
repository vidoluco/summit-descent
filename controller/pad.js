// Phone controller: floating joystick (left 2/3) and SCATTO button (right 1/3).
// Sends {t:'in', x, y, b, seq} at 30 Hz and on every change. x right positive, y up (forward) positive.
// Test hooks: window.__pad (state, slot, geometry()); with window.__padTrace = [] set before load, every input
// sent is logged with the time of the touch behind it (test/helpers/phones.mjs latency()).
import { webm, mp4 } from 'nosleep.js/src/media.js';
import { pickLang, translator, ordinal, locale, LANG_KEY } from '../src/i18n/index.js';
import { TUNING } from '../src/sim/tuning.js';
import { mountainCards, roughTime, RANDOM, INDEX_URL } from '../src/game/mountains.js';
import { flag, die } from '../src/ui/icons.js';
import { formatAltitude, pickLabel } from '../src/i18n/index.js';

const $ = (id) => document.getElementById(id);
const SEND_MS = 1000 / 30;
const DEAD = 0.12;
const PING_MS = 1000;
const SILENT_MS = 3500; // no word from the server this long: the socket is dead even if it says open
const COOLDOWN_MS = TUNING.boost.cooldown * 1000;
const trace = Array.isArray(window.__padTrace) ? window.__padTrace : null;
const epoch = (ts = performance.now()) => performance.timeOrigin + ts;

// ---------- identity ----------
function uuid() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b); // randomUUID is missing on plain http LAN pages
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch {}
  return val ?? null;
}
let padId = store('summit-descent.padId');
if (!padId || !/^[A-Za-z0-9_-]{1,64}$/.test(padId)) padId = store('summit-descent.padId', uuid());

// ---------- language: per phone, stored choice or the browser language ----------
let lang = pickLang(store(LANG_KEY), navigator.language);
let t = translator(lang);
let fmt = null;
let lastOverlay = null;
let lastHud = null;
function applyLang() {
  t = translator(lang);
  fmt = new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  document.documentElement.lang = lang;
  document.title = t('pad.title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  updateWho();
  updateBanner();
  if (lastOverlay) overlay(...lastOverlay);
  if (lastHud) showHud(lastHud);
  buildVote();
}

// ---------- state ----------
const st = { x: 0, y: 0, b: 0, seq: 0 };
let ws = null;
let joined = false;
let slot = -1;
let hostOn = false;
let retry = 0;
let retryTimer = 0;
let lastRx = 0;
let lastTx = 0;
let pendingTx = 0;
let replaced = false;
let gestured = false;
// What the host says this phone is doing ({t:'phase'}): the banner line that tells the player what BOOST does now.
let phase = null;
const PHASE_TEXT = { lobby: 'pad.lobbyPress', ready: 'pad.lobbyReady', solo: 'pad.lobbySolo', next: 'pad.next', results: 'pad.results', rematch: 'pad.rematch' };

// ---------- view ----------
function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '159, 180, 200';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
function setAccent(color) {
  const root = document.documentElement.style;
  root.setProperty('--accent', color);
  root.setProperty('--accent-rgb', hexRgb(color));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}
// title and text are i18n keys; vars fill their {placeholders}.
function overlay(title, text, opts = {}, vars) {
  const ov = $('overlay');
  lastOverlay = title ? [title, text, opts, vars] : null;
  if (!title) { ov.classList.add('hide'); return; }
  const { spin = false, action = false } = opts;
  $('ovTitle').innerHTML = spin ? '<span class="spin"></span>' : '';
  $('ovTitle').append(t(title));
  $('ovText').textContent = text ? t(text, vars) : '';
  ov.classList.toggle('action', action);
  ov.classList.remove('hide');
}
function banner(text) {
  const el = $('banner');
  if (text) el.textContent = text;
  el.classList.toggle('show', !!text);
}
function setNet(on) { $('net').classList.toggle('on', on); }

let toastTimer = 0;
function toast(big, small, ms = 1800) {
  $('toastBig').textContent = big;
  $('toastSmall').textContent = small || '';
  const el = $('toast');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function flash() {
  const el = $('flash');
  el.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
}
// Chrome blocks (and logs) vibrate before the first tap, and a touch counts as one only when the finger lifts.
// iOS Safari has no vibrate: since iOS 18 a tap on a switch's label gives a haptic tick, so a press of the pad's
// own buttons is still felt there (it works inside a touch handler only: the host's buzzes stay silent on iOS).
const activated = () => (navigator.userActivation ? navigator.userActivation.hasBeenActive : gestured);
let tick = null;
if (!navigator.vibrate) {
  const label = document.createElement('label');
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.tabIndex = -1;
  label.setAttribute('aria-hidden', 'true');
  label.style.display = 'none';
  label.append(sw);
  document.body.append(label);
  tick = () => label.click();
}
function vibrate(p, { touch = false } = {}) {
  if (navigator.vibrate) {
    if (!activated()) return;
    try { navigator.vibrate(p); } catch {}
  } else if (touch && tick) {
    try { tick(); } catch {}
  }
}

function updateWho() {
  const who = $('who');
  if (slot < 0) { who.textContent = t('pad.waiting'); return; }
  who.textContent = t('pad.player', { n: slot + 1 }) + ' ';
  const small = document.createElement('small');
  small.textContent = t(`pad.color${slot}`);
  who.append(small);
}
function updateBanner() {
  if (!joined) return banner('');
  if (!hostOn) return banner(going() ? '' : t('pad.noHost'));
  if (menu && menu.phase !== 'vote') return banner(''); // the carousel says where the race goes
  banner(PHASE_TEXT[phase] ? t(PHASE_TEXT[phase]) : '');
}

// ---------- network ----------
function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws?role=pad&id=${encodeURIComponent(padId)}`;
}
function send(msg) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
  return false;
}
// The epoch ms of the oldest touch whose change has not been sent yet (traced pages only).
let touchAt = null;
const touched = (e) => { if (trace && touchAt === null) touchAt = epoch(e?.timeStamp); };
function sendInput() {
  clearTimeout(pendingTx);
  pendingTx = 0;
  if (!joined) return;
  lastTx = performance.now();
  const m = { t: 'in', x: Math.round(st.x * 1000) / 1000, y: Math.round(st.y * 1000) / 1000, b: st.b, seq: st.seq++ };
  if (!send(m) || !trace) return;
  if (trace.length > 20000) trace.splice(0, 10000);
  trace.push({ seq: m.seq, x: m.x, y: m.y, b: m.b, tx: epoch(), touch: touchAt });
  touchAt = null;
}
function changed(urgent) {
  const wait = SEND_MS / 2 - (performance.now() - lastTx);
  if (urgent || wait <= 0) return sendInput();
  if (!pendingTx) pendingTx = setTimeout(sendInput, wait);
}
// The 30 Hz repeat fills the gaps only: while the thumb moves, the moves themselves go out (up to 60 Hz), and a
// repeat sent just before one would hold that move back for half a period.
setInterval(() => { if (performance.now() - lastTx >= SEND_MS - 4) sendInput(); }, SEND_MS);

function connect() {
  clearTimeout(retryTimer);
  if (ws) return;
  replaced = false;
  setNet(false);
  if (!joined) overlay('pad.connecting', 'pad.sameWifi', { spin: true });
  let sock;
  try { sock = new WebSocket(wsUrl()); } catch { return reconnectLater(); }
  ws = sock;
  lastRx = performance.now();
  sock.onopen = () => { retry = 0; lastRx = performance.now(); setNet(true); };
  sock.onmessage = (ev) => {
    lastRx = performance.now();
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m && typeof m === 'object') onMessage(m);
  };
  sock.onerror = () => {};
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    ws = null;
    joined = false;
    setNet(false);
    banner('');
    if (ev.code === 4001) {
      replaced = true;
      overlay('pad.elsewhere', 'pad.elsewhereText', { action: true });
      return;
    }
    reconnectLater();
  };
}
function reconnectLater() {
  if (replaced) return;
  const delay = Math.min(5000, 500 * 2 ** retry++) * (0.8 + Math.random() * 0.4);
  overlay('pad.lost', 'pad.retry', { spin: true }, { s: Math.max(1, Math.round(delay / 1000)) });
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, delay);
}
// Wi-Fi drops often leave the socket half open (and a handshake can hang): ping every second, the server pongs,
// and silence for SILENT_MS means the socket is dead.
function dropSocket() {
  const s = ws;
  ws = null;
  joined = false;
  try { s?.close(); } catch {}
  setNet(false);
  banner('');
}
setInterval(() => {
  if (!ws) return;
  if (ws.readyState === 1) send({ t: 'ping', ts: Date.now() });
  if (performance.now() - lastRx > SILENT_MS) {
    dropSocket();
    reconnectLater();
  }
}, PING_MS);
// The Wi-Fi came back: try now instead of at the end of the backoff.
addEventListener('online', () => { if (!ws && !replaced) { retry = 0; connect(); } });

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      joined = true;
      slot = Number.isInteger(m.slot) ? m.slot : -1;
      hostOn = !!m.host;
      if (typeof m.id === 'string' && m.id !== padId) padId = store('summit-descent.padId', m.id);
      if (typeof m.color === 'string') setAccent(m.color);
      updateWho();
      overlay(null);
      updateBanner();
      vibrate(30);
      sendInput();
      break;
    case 'full':
      joined = false;
      overlay('pad.full', 'pad.fullText', { spin: true });
      break;
    case 'host':
      hostOn = !!m.on;
      if (!hostOn) phase = null;
      updateBanner();
      break;
    case 'hud':
      if (phase !== 'next') showHud(m);
      break;
    case 'phase':
      phase = typeof m.phase === 'string' ? m.phase : null;
      if (phase === 'race' || phase === 'next' || phase === 'results' || phase === 'rematch') menu = null; // the vote is over
      // no mass or place while a bot drives this slot, nor left over from the last race in the lobby
      if (phase !== 'race' && phase !== 'results' && phase !== 'rematch') { $('hud').classList.remove('show'); lastHud = null; }
      if (phase !== 'race') cooldown(false);
      updateBanner();
      break;
    case 'fx':
      onFx(m.kind, m);
      break;
    case 'menu':
      onMenu(m);
      break;
  }
  if (m.t === 'phase' || m.t === 'host' || m.t === 'welcome') showVote();
}

// ---------- hud and effects ----------
function showHud(m) {
  lastHud = m;
  $('hud').classList.add('show');
  if (Number.isFinite(m.mass)) {
    $('mass').textContent = fmt.format(m.mass);
    const s = Math.max(0.55, Math.min(1.6, Math.cbrt(m.mass)));
    $('massIcon').style.transform = `scale(${s})`;
  }
  const place = Number.isInteger(m.place) && m.place > 0 ? m.place : 0;
  $('placeCard').style.display = place ? '' : 'none';
  if (place) {
    const [n, suffix] = ordinal(lang, place);
    // the Italian degree sign is already raised: as a superscript it would float off the number
    if (suffix === '°') {
      $('place').replaceChildren(n + suffix);
    } else {
      const sup = document.createElement('sup');
      sup.textContent = suffix;
      $('place').replaceChildren(n, sup);
    }
  }
}
let frozenTimer = 0;
function onFx(kind, m) {
  if (kind !== 'freeze') { document.body.classList.remove('frozen'); clearTimeout(frozenTimer); }
  switch (kind) {
    case 'buzz':
      vibrate(40);
      flash();
      break;
    case 'freeze':
      vibrate([60, 40, 60, 40, 120]);
      document.body.classList.add('frozen');
      toast(t('pad.frozen'), t('pad.frozenText'), 2600);
      clearTimeout(frozenTimer);
      frozenTimer = setTimeout(() => document.body.classList.remove('frozen'), 6000);
      break;
    case 'drink':
      vibrate([25, 50, 25]);
      toast(t('pad.drink'), t('pad.drinkText'), 1600);
      break;
    case 'finish': {
      vibrate([80, 60, 80, 60, 300]);
      const p = Number.isInteger(m.place) ? m.place : null;
      toast(t('pad.finish'), p ? t('pad.finishPlace', { place: ordinal(lang, p).join('') }) : t('pad.finishDone'), 4000);
      break;
    }
    case 'thaw':
      vibrate(30);
      toast(t('pad.thaw'), '', 900);
      break;
    default:
      vibrate(20);
  }
}

// ---------- joystick ----------
const stickEl = $('stick');
const baseEl = $('base');
const knobEl = $('knob');
let stickId = null;
let ox = 0;
let oy = 0;
let R = 80;

function radius() {
  const r = stickEl.getBoundingClientRect();
  return Math.max(52, Math.min(110, Math.min(r.width, r.height) * 0.2));
}
function place(el, x, y) { el.style.transform = `translate3d(${x}px, ${y}px, 0)`; }

function stickMove(px, py, e) {
  let dx = px - ox;
  let dy = py - oy;
  let d = Math.hypot(dx, dy);
  // Dynamic origin: dragging past the rim pulls the base along with the thumb.
  if (d > R) {
    const k = (d - R) / d;
    ox += dx * k;
    oy += dy * k;
    dx = px - ox;
    dy = py - oy;
    d = R;
    place(baseEl, ox, oy);
  }
  place(knobEl, ox + dx, oy + dy);
  let mag = d / R;
  let nx = 0;
  let ny = 0;
  if (mag > DEAD) {
    const m = (mag - DEAD) / (1 - DEAD);
    nx = (dx / d) * m;
    ny = (-dy / d) * m;
  } else {
    mag = 0;
  }
  baseEl.style.setProperty('--ang', String(Math.atan2(dy, dx)));
  baseEl.style.setProperty('--mag', String(Math.min(1, mag)));
  nx = Math.max(-1, Math.min(1, nx));
  ny = Math.max(-1, Math.min(1, ny));
  if (Math.abs(nx - st.x) > 0.004 || Math.abs(ny - st.y) > 0.004) {
    st.x = nx;
    st.y = ny;
    touched(e);
    changed(false);
  }
}
function local(e) {
  const r = stickEl.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
stickEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  keepAwake();
  // One thumb owns the stick; a second finger on it is ignored. A thumb whose lift never arrived (the capture is
  // gone with it) does not lock the stick: the new one takes over.
  if (stickId !== null && stickEl.hasPointerCapture?.(stickId) !== false) return;
  stickId = e.pointerId;
  try { stickEl.setPointerCapture(e.pointerId); } catch {}
  R = radius();
  stickEl.style.setProperty('--r', `${R}px`);
  [ox, oy] = local(e);
  place(baseEl, ox, oy);
  place(knobEl, ox, oy);
  stickEl.classList.add('active');
  stickMove(ox, oy, e);
});
stickEl.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickId) return;
  e.preventDefault();
  const evs = e.getCoalescedEvents?.() || [];
  const last = evs.length ? evs[evs.length - 1] : e;
  const [x, y] = local(last);
  stickMove(x, y, evs[0] || e);
});
function stickEnd(e) {
  if (e && e.pointerId !== stickId) return;
  stickId = null;
  stickEl.classList.remove('active');
  if (st.x || st.y) { st.x = 0; st.y = 0; touched(e); changed(true); }
}
stickEl.addEventListener('pointerup', stickEnd);
stickEl.addEventListener('pointercancel', stickEnd);
stickEl.addEventListener('lostpointercapture', stickEnd);

// ---------- button ----------
// In a race SCATTO recharges (TUNING.boost.cooldown): the ring around it fills back up, and a press while it does
// is shown as not taken. Presses on the ice (cracking it) and outside a race do not start the ring.
const boostEl = $('boost');
const btnIds = new Set();
let readyAt = 0;
let readyTimer = 0;
function cooldown(on) {
  clearTimeout(readyTimer);
  boostEl.classList.remove('cooling', 'ready');
  if (!on) { readyAt = 0; return; }
  void boostEl.offsetWidth; // restart the ring's animation
  readyAt = performance.now() + COOLDOWN_MS;
  boostEl.style.setProperty('--cd', `${COOLDOWN_MS}ms`);
  boostEl.classList.add('cooling');
  readyTimer = setTimeout(() => {
    boostEl.classList.remove('cooling');
    boostEl.classList.add('ready');
    vibrate(15);
  }, COOLDOWN_MS);
}
function setButton(down, e) {
  const b = down ? 1 : 0;
  if (b === st.b) return;
  st.b = b;
  boostEl.classList.toggle('down', down);
  if (down) {
    vibrate(12, { touch: true });
    const racing = phase === 'race' && !document.body.classList.contains('frozen');
    const charging = performance.now() < readyAt;
    if (racing && !charging) cooldown(true);
    if (!charging) {
      const ring = document.createElement('div');
      ring.className = 'burst';
      boostEl.appendChild(ring);
      setTimeout(() => ring.remove(), 520);
    }
  }
  touched(e);
  changed(true);
}
boostEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  keepAwake();
  btnIds.add(e.pointerId);
  try { boostEl.setPointerCapture(e.pointerId); } catch {}
  setButton(true, e);
});
function btnEnd(e) {
  btnIds.delete(e.pointerId);
  if (!btnIds.size) setButton(false, e);
}
boostEl.addEventListener('pointerup', btnEnd);
boostEl.addEventListener('pointercancel', btnEnd);
boostEl.addEventListener('lostpointercapture', btnEnd);

function releaseAll() {
  stickId = null;
  btnIds.clear();
  stickEl.classList.remove('active');
  boostEl.classList.remove('down');
  const was = st.x || st.y || st.b;
  st.x = 0; st.y = 0; st.b = 0;
  if (was) sendInput();
}

// ---------- the mountain vote (lobby) ----------
// The host sends {t:'menu', worlds, phase, focus, ballot, other, pick, spin, winner, landed} while the lobby votes;
// the phone shows the mountains as a carousel (its cards from data/worlds/index.json), sends the card in front as
// {t:'vote', world} and votes it with a tap on that card ({lock: true}) or with SCATTO (the host locks the card it
// was last told about). During the verdict the carousel follows the coin and says where it landed.
const voteEl = $('vote');
const trackEl = $('track');
let cards = [];
let menu = null;
let vIndex = 0;
let vSent = null; // the card in front the host has heard about, this lobby
// The cards and all their pictures load with the first menu (a page that never votes, under a scripted host, asks
// for nothing); the carousel shows once they are in, or after CARDS_MS, so no picture pops in while the player swipes.
const CARDS_MS = 2500;
let cardsAsked = false;
const preload = (src) => new Promise((ok) => { const i = new Image(); i.onload = i.onerror = () => ok(i); i.src = src; });
const kept = []; // the preloaded pictures, held so the browser keeps them decoded
function loadCards() {
  if (cardsAsked) return;
  cardsAsked = true;
  const all = fetch(INDEX_URL).then((r) => (r.ok ? r.json() : null)).then((ix) => {
    cards = mountainCards(ix);
    const srcs = [...cards.map((c) => c.image), ...new Set(cards.flatMap((c) => c.animals.map((a) => `assets/ui/animals/${a}.png`)))];
    return Promise.all(srcs.map((s) => preload(s).then((i) => kept.push(i))));
  }).catch(() => {});
  Promise.race([all, new Promise((ok) => setTimeout(ok, CARDS_MS))]).then(() => {
    buildVote();
    // the card the host has for this phone, now that the cards are there
    if (menu && !vSent) { const i = voteIds().indexOf(menu.focus); if (i >= 0) vIndex = i; }
    layoutVote(); showVote();
    if (menu?.phase === 'vote') sendFocus();
  });
}
const voteIds = () => (menu?.worlds?.length ? menu.worlds.filter((id) => cards.some((c) => c.id === id)) : cards.map((c) => c.id)).concat(RANDOM);
const cardName = (id) => { const c = cards.find((m) => m.id === id); return c ? pickLabel(lang, c.summit.names) || c.summit.name : id === RANDOM ? t('ui.vote.random') : id || ''; };
// the carousel shows in the lobby; once the mountain is picked it stays up through the TV loading it (the host
// page reloads on another world, so the phone loses the host for a few seconds) until the race begins
const going = () => menu?.phase === 'done' || menu?.loading;
const voting = () => !!menu && joined && (going() || (hostOn && (phase === 'lobby' || phase === 'ready' || phase === 'solo')));

function buildVote() {
  if (!cards.length) return;
  const ids = voteIds();
  trackEl.innerHTML = '';
  for (const id of ids) {
    const c = cards.find((m) => m.id === id);
    const el = document.createElement('div');
    el.className = 'vc';
    el.dataset.id = id;
    const badges = `<span class="badge me"><i></i>${t('pad.vote.mine')}</span><span class="badge them"><i></i><em></em></span>`;
    if (!c) {
      el.innerHTML = `<div class="pic"><div class="mosaic">${cards.map((m) => `<i data-bg="${m.image}"></i>`).join('')}</div>${die()}
<div class="cap"><div class="nm"></div></div>${badges}</div><div class="txt"></div>`;
      el.querySelector('.nm').textContent = t('ui.vote.random');
      el.querySelector('.txt').textContent = t('ui.vote.randomText');
    } else {
      const alt = (m) => (Number.isFinite(m) ? t('ui.hud.altitude', { m: formatAltitude(lang, m) }) : '');
      el.innerHTML = `<div class="pic" data-bg="${c.image}"><div class="cap"><div class="nm"></div><div class="rg">${flag(c.country)}<span></span></div></div>${badges}</div>
<div class="row stats"><div><small></small><b></b></div><div><small></small><b></b></div><div><small></small><b></b></div></div>
<div class="row fauna">${c.animals.map((a) => `<figure><img alt="" data-src="assets/ui/animals/${a}.png"><figcaption></figcaption></figure>`).join('')}</div>`;
      el.querySelector('.nm').textContent = cardName(id);
      el.querySelector('.rg span').textContent = t('ui.vote.where', { region: t(`region.${id}`), country: t(`country.${c.country}`) });
      const cells = el.querySelectorAll('.stats > div');
      [['ui.vote.summit', alt(c.summit.altitude)], ['ui.vote.drop', alt(c.drop)], ['ui.vote.time', roughTime(c.seconds) ? t('ui.vote.about', { t: roughTime(c.seconds) }) : '']].forEach(([k, v], i) => {
        cells[i].querySelector('small').textContent = t(k);
        cells[i].querySelector('b').textContent = v;
      });
      el.querySelectorAll('.fauna figcaption').forEach((f, i) => { f.textContent = t(`animal.${c.animals[i]}`); });
    }
    trackEl.append(el);
  }
  $('vdots').innerHTML = ids.map(() => '<i></i>').join('');
  $('vmode').textContent = t('pad.vote.mode');
  $('vreal').textContent = t('pad.vote.real');
  layoutVote();
}

function layoutVote() {
  const els = [...trackEl.children];
  const v = menu || {};
  const result = v.phase && v.phase !== 'vote';
  const rolling = v.phase === 'roll' || (v.phase === 'done' && v.candidates?.length > 0);
  if (result) vIndex = Math.max(0, els.findIndex((e) => e.dataset.id === (rolling && !v.landed ? v.spin : v.pick)));
  els.forEach((e, i) => {
    e.style.setProperty('--i', String(i - vIndex));
    // pictures load for the card in front and its neighbours only: a phone on the Wi-Fi fetches a few, not all
    if (Math.abs(i - vIndex) <= 1 && !e.dataset.loaded) {
      e.dataset.loaded = '1';
      for (const b of e.querySelectorAll('[data-bg]')) b.style.backgroundImage = `url(${b.dataset.bg})`;
      for (const img of e.querySelectorAll('img[data-src]')) img.src = img.dataset.src;
    }
    e.classList.toggle('on', i === vIndex);
    e.classList.toggle('mine', e.dataset.id === v.ballot);
    e.classList.toggle('theirs', !!v.other && e.dataset.id === v.other);
    e.classList.toggle('spin', rolling && !v.landed && e.dataset.id === v.spin);
    e.classList.toggle('picked', result && (!rolling || v.landed) && e.dataset.id === v.pick);
    const em = e.querySelector('.badge.them em');
    if (em) em.textContent = t(slot === 0 ? 'pad.vote.other1' : 'pad.vote.other0');
  });
  document.documentElement.style.setProperty('--other', slot === 0 ? '#f28bbd' : '#4aa6f2');
  [...$('vdots').children].forEach((d, i) => d.classList.toggle('on', i === vIndex));
  let verdict = '';
  if (v.phase === 'done' || (rolling && v.landed) || v.phase === 'agree') verdict = t('pad.vote.go', { name: cardName(v.pick) });
  else if (rolling) verdict = t('pad.vote.roll');
  $('verdict').textContent = verdict;
  voteEl.classList.toggle('verdict', !!verdict);
  updateBanner();
}

function showVote() {
  const on = voting() && cards.length > 0;
  voteEl.classList.toggle('hide', !on);
  document.body.classList.toggle('voting', on);
}

// Tell the host which card is in front (once per change); lock: the player voted it.
function sendFocus(lock = false) {
  const id = trackEl.children[vIndex]?.dataset.id;
  if (!id || (!lock && id === vSent)) return;
  if (send({ t: 'vote', world: id, lock })) vSent = id;
}

function onMenu(m) {
  loadCards();
  const fresh = !menu || menu.phase !== 'vote' && m.phase === 'vote';
  const prevSpin = menu?.spin, prevPhase = menu?.phase;
  const ids = (menu?.worlds || []).join();
  menu = { ...m, ballot: m.ballot || null, other: m.other || null };
  if (ids !== (m.worlds || []).join()) buildVote();
  // a new lobby: the carousel starts on the card the host has for this phone (the world on screen at first)
  if (fresh) { vSent = null; const i = voteIds().indexOf(m.focus); if (i >= 0) vIndex = i; }
  layoutVote();
  showVote();
  if (m.phase === 'roll' && m.spin !== prevSpin && !m.landed) vibrate(8);
  if ((m.phase === 'agree' || m.landed) && prevPhase !== m.phase) vibrate([30, 40, 60]);
  if (m.phase === 'vote' && (fresh || !vSent)) sendFocus();
}

// Swipe left and right to browse, tap the card in front to vote it, tap a side card to bring it in front.
let swipe = null;
voteEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  keepAwake();
  if (swipe || menu?.phase !== 'vote') return;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, t: performance.now() };
  try { voteEl.setPointerCapture(e.pointerId); } catch {}
});
voteEl.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  swipe.dx = e.clientX - swipe.x;
  if (Math.abs(swipe.dx) > 6) { trackEl.classList.add('dragging'); for (const c of trackEl.children) c.style.setProperty('--drag', `${swipe.dx}px`); }
});
function swipeEnd(e) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const { dx } = swipe;
  swipe = null;
  trackEl.classList.remove('dragging');
  for (const c of trackEl.children) c.style.removeProperty('--drag');
  const n = trackEl.children.length;
  if (e.type === 'pointerup' && Math.abs(dx) <= 12) {
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.vc');
    const i = hit ? [...trackEl.children].indexOf(hit) : -1;
    if (i === vIndex) { vibrate(25, { touch: true }); sendFocus(true); return; }
    if (i >= 0) vIndex = i;
  } else if (Math.abs(dx) > 40) {
    const w = trackEl.children[vIndex]?.getBoundingClientRect().width || 300;
    vIndex = Math.max(0, Math.min(n - 1, vIndex - Math.sign(dx) * Math.max(1, Math.round(Math.abs(dx) / (w * 0.9)))));
    vibrate(8, { touch: true });
  }
  layoutVote();
  sendFocus();
}
voteEl.addEventListener('pointerup', swipeEnd);
voteEl.addEventListener('pointercancel', swipeEnd);

// ---------- page hygiene: no zoom, no scroll, screen awake ----------
for (const ev of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu', 'selectstart']) {
  document.addEventListener(ev, (e) => e.preventDefault());
}
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// Screen awake: the Wake Lock API where the page may use it (https or localhost). The pad is served over plain
// http on the LAN, which is not a secure context, so there a muted inline video that never ends keeps the screen
// on instead (the NoSleep.js trick and its two tiny clips, MIT). Both need the page to be visible; the video
// also needs a tap.
let wakeLock = null;
let sleepVideo = null;
let awake = null; // 'lock' | 'video' | null, for the tests
function noSleepVideo() {
  const v = document.createElement('video');
  v.muted = true;
  v.setAttribute('muted', '');
  v.setAttribute('playsinline', '');
  v.setAttribute('aria-hidden', 'true');
  v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  for (const [type, src] of [['webm', webm], ['mp4', mp4]]) {
    const s = document.createElement('source');
    s.type = `video/${type}`;
    s.src = src;
    v.append(s);
  }
  // the webm clip loops; the mp4 one would end on iOS with a flash of media controls, so it seeks back instead
  v.addEventListener('loadedmetadata', () => {
    if (v.duration <= 1) v.loop = true;
    else v.addEventListener('timeupdate', () => { if (v.currentTime > 0.5) v.currentTime = Math.random(); });
  });
  document.body.append(v);
  return v;
}
async function keepAwake() {
  if (document.visibilityState !== 'visible') return;
  if (navigator.wakeLock) {
    if (wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      awake = 'lock';
      wakeLock.addEventListener('release', () => { wakeLock = null; awake = sleepVideo && !sleepVideo.paused ? 'video' : null; });
      return;
    } catch { wakeLock = null; } // refused (battery saver, a policy): fall back to the video
  }
  if (!activated()) return;
  sleepVideo ||= noSleepVideo();
  if (!sleepVideo.paused) return;
  try { await sleepVideo.play(); awake = 'video'; } catch { awake = null; }
}
// A tap is a user gesture only once the finger lifts: the screen lock, full screen and landscape wait for that.
function activate() {
  keepAwake();
  if (gestured) return;
  gestured = true;
  const el = document.documentElement;
  try { el.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {}); } catch {}
  try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch {}
}
document.addEventListener('pointerup', activate, true);
document.addEventListener('touchend', activate, true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepAwake();
    if (replaced) return;
    // Back from a lock or another app: a socket that heard nothing all that time is gone even if it says open.
    if (ws && performance.now() - lastRx > PING_MS * 2) dropSocket();
    if (!ws) { retry = 0; connect(); }
  } else {
    releaseAll();
  }
});
window.addEventListener('pagehide', releaseAll);

$('ovBtn').addEventListener('click', () => { replaced = false; retry = 0; connect(); });
$('lang').addEventListener('pointerdown', (e) => e.stopPropagation());
$('lang').addEventListener('click', () => {
  lang = lang === 'it' ? 'en' : 'it';
  store(LANG_KEY, lang);
  applyLang();
});

// Where a thumb rests on the stick and where SCATTO is (viewport px), with the stick radius and dead zone.
function geometry() {
  const s = stickEl.getBoundingClientRect();
  const b = $('btn').getBoundingClientRect();
  return { sx: s.left + s.width * 0.45, sy: s.top + s.height * 0.6, R: radius(), dead: DEAD, bx: b.left + b.width / 2, by: b.top + b.height / 2, br: b.width / 2 };
}
window.__pad = {
  state: st, geometry,
  get slot() { return slot; }, get joined() { return joined; }, get lang() { return lang; }, get phase() { return phase; },
  get awake() { return awake; }, get cooling() { return performance.now() < readyAt; },
  // the vote: shown, the card in front, the cards in order, the host's last menu
  get vote() { return { shown: !voteEl.classList.contains('hide'), focus: trackEl.children[vIndex]?.dataset.id || null, ids: [...trackEl.children].map((c) => c.dataset.id), menu }; },
  voteRect: (id) => { const r = trackEl.querySelector(`[data-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } : null; },
};
applyLang();
connect();
