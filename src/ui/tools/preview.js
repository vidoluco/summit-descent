// UI preview page for screenshots and browser tests: the host overlays over a still of the game
// (backdrops/*.jpg stand in for the canvas). The shooter and test/ui-dom.test.mjs drive window.__ui.
import { createUI } from '../index.js';
import { detectLang, translator } from '../../i18n/index.js';
import { mountainCards, INDEX_URL } from '../../game/mountains.js';

const params = new URLSearchParams(location.search);
const lang = params.get('lang') || detectLang();
const ui = createUI(document.getElementById('ui'), { t: translator(lang), lang });
const events = [];
ui.onStart((d) => events.push(['start', d]));
ui.onLang((l) => events.push(['lang', l]));
ui.onRematch(() => events.push(['rematch']));
ui.onPick((id) => events.push(['pick', id]));
window.__ui = ui;
window.__events = events;
window.__bg = (name) => { document.getElementById('game').style.backgroundImage = name && name !== 'none' ? `url(backdrops/${name}.jpg)` : 'none'; };
window.__bg(params.get('bg') || 'hero');
// the vote's cards, for the scenes (window.__cards)
const cards = fetch(INDEX_URL).then((r) => r.json()).then((ix) => { window.__cards = mountainCards(ix); }, () => { window.__cards = []; });
window.__ready = Promise.all([document.fonts.ready, cards]).then(() => true);
