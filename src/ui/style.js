// Host screen styles. Sizes are designed on a 1920x1080 TV and scale with the viewport through --u (one design
// pixel), so the overlays stay readable from the sofa on any screen. Cartoon premium: Fredoka, white type with a
// dark outline, cream cards with soft shadows, slot colours blue and pink.
import { FREDOKA_WOFF2 } from './font-data.js';
import { INK, PLAYER_COLORS } from './icons.js';

const u = (n) => `calc(var(--u) * ${n})`;
const [B, P] = PLAYER_COLORS;

// A round outline drawn with text shadows, for the biggest numerals: -webkit-text-stroke leaves notches where the
// variable font's contours overlap (visible on the countdown 3 at TV size).
function outline(r, drop = 14) {
  const ring = (rad, n) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return `${u((Math.cos(a) * rad).toFixed(2))} ${u((Math.sin(a) * rad).toFixed(2))} 0 var(--ink)`;
  });
  return [...ring(r, 32), ...ring(r * 0.66, 16), ...ring(r * 0.33, 8), `0 ${u(drop)} ${u(drop * 2)} rgba(20, 24, 40, 0.3)`].join(', ');
}

export const CSS = `
@font-face { font-family: "SD Fredoka"; font-weight: 500 700; font-display: block;
  src: url(data:font/woff2;base64,${FREDOKA_WOFF2}) format("woff2"); }
.sd-ui { --u: min(calc(100vw / 1920), calc(100vh / 1080)); --ink: ${INK}; --cream: #fff8ef; --paper: #fffdf9;
  --c0: ${B.main}; --c0l: ${B.light}; --c0d: ${B.dark}; --g0: ${B.glow};
  --c1: ${P.main}; --c1l: ${P.light}; --c1d: ${P.dark}; --g1: ${P.glow};
  --shadow: 0 ${u(12)} ${u(36)} rgba(46, 28, 60, 0.28), 0 ${u(3)} ${u(8)} rgba(46, 28, 60, 0.18);
  position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 10;
  font-family: "SD Fredoka", "Fredoka", ui-rounded, "SF Pro Rounded", system-ui, sans-serif; font-weight: 600;
  color: var(--ink); -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none;
  line-height: 1.15; }
.sd-ui *, .sd-ui *::before, .sd-ui *::after { box-sizing: border-box; }
.sd-ui svg { display: block; overflow: visible; }
.sd-ui button { font: inherit; color: inherit; cursor: pointer; pointer-events: auto; border: 0; background: none; padding: 0; }
.sd-ui .hide { display: none !important; }

/* outlined white type, as on the race HUD of the mockups */
.sd-ui .ink { color: #fff; -webkit-text-stroke: ${u(8)} var(--ink); paint-order: stroke fill; font-weight: 700;
  text-shadow: 0 ${u(5)} ${u(10)} rgba(20, 24, 40, 0.25); letter-spacing: ${u(0.5)}; }
.sd-ui .card { background: var(--paper); border: ${u(4)} solid var(--ink); border-radius: ${u(40)}; box-shadow: var(--shadow); }

.sd-ui .scr { position: absolute; inset: 0; }

/* ---------- lobby ---------- */
.sd-ui .lobby::before { content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(255, 232, 238, 0.10) 0%, rgba(40, 24, 50, 0) 30%, rgba(40, 24, 50, 0) 55%, rgba(28, 20, 40, 0.42) 100%); }
.sd-ui .lobby .head { position: absolute; left: 0; right: 0; top: ${u(44)}; display: flex; flex-direction: column; align-items: center; gap: ${u(14)}; }
.sd-ui .lobby .title { display: flex; align-items: center; gap: ${u(22)}; font-size: ${u(124)}; line-height: 1; -webkit-text-stroke-width: ${u(11)}; }
.sd-ui .lobby .title .drop-face { width: ${u(96)}; filter: drop-shadow(0 ${u(5)} ${u(8)} rgba(20, 24, 40, 0.25)); }
.sd-ui .lobby .title .drop-face + .drop-face { margin-left: ${u(-46)}; transform: rotate(10deg) translateY(${u(10)}); }
.sd-ui .lobby .world { display: flex; align-items: center; gap: ${u(18)}; padding: ${u(10)} ${u(30)}; border-radius: ${u(999)};
  background: rgba(255, 253, 249, 0.92); border: ${u(4)} solid var(--ink); box-shadow: var(--shadow); font-size: ${u(36)}; }
.sd-ui .lobby .world small { font-size: ${u(28)}; font-weight: 500; opacity: 0.72; }
.sd-ui .lobby .world i { width: ${u(8)}; height: ${u(8)}; border-radius: 50%; background: var(--ink); opacity: 0.5; }

.sd-ui .langs { position: absolute; top: ${u(44)}; right: ${u(56)}; display: flex; padding: ${u(6)}; gap: ${u(4)};
  border-radius: ${u(999)}; background: rgba(255, 253, 249, 0.92); border: ${u(4)} solid var(--ink); box-shadow: var(--shadow); }
.sd-ui .langs button { font-size: ${u(30)}; font-weight: 700; padding: ${u(8)} ${u(22)}; border-radius: ${u(999)}; opacity: 0.55; transition: background 0.2s, opacity 0.2s; }
.sd-ui .langs button.on { background: var(--ink); color: #fff; opacity: 1; }

.sd-ui .lobby .main { position: absolute; left: ${u(80)}; right: ${u(80)}; top: ${u(318)}; height: ${u(500)}; display: flex; gap: ${u(56)}; }
.sd-ui .join { width: ${u(840)}; flex: none; display: flex; gap: ${u(34)}; padding: ${u(34)} ${u(40)} ${u(34)} ${u(34)}; align-items: center; }
.sd-ui .join .qr { flex: none; width: ${u(330)}; height: ${u(330)}; padding: ${u(16)}; border-radius: ${u(28)}; background: #fff;
  border: ${u(4)} solid var(--ink); box-shadow: inset 0 0 0 ${u(8)} #fff; }
.sd-ui .join .qr img { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.sd-ui .join .txt { flex: 1; display: flex; flex-direction: column; gap: ${u(14)}; min-width: 0; }
.sd-ui .join h2 { margin: 0; font-size: ${u(44)}; line-height: 1.05; white-space: nowrap; font-weight: 700; display: flex; align-items: center; gap: ${u(14)}; }
.sd-ui .join h2 .phone { width: ${u(34)}; flex: none; }
.sd-ui .join p { margin: 0; font-size: ${u(30)}; font-weight: 500; line-height: 1.25; }
.sd-ui .join .or { font-size: ${u(24)}; opacity: 0.62; margin-top: ${u(6)}; }
.sd-ui .join .url { font-size: ${u(31)}; font-weight: 700; padding: ${u(10)} ${u(16)}; border-radius: ${u(16)}; background: #eaf4ff;
  border: ${u(3)} solid rgba(29, 31, 43, 0.18); overflow-wrap: anywhere; letter-spacing: ${u(0.3)}; }
.sd-ui .join .wifi-line { display: flex; align-items: center; gap: ${u(12)}; font-size: ${u(24)}; font-weight: 500; opacity: 0.8; line-height: 1.2; margin-top: ${u(4)}; }
.sd-ui .join .wifi { width: ${u(34)}; flex: none; color: var(--ink); }

.sd-ui .slots { flex: 1; display: flex; gap: ${u(36)}; min-width: 0; }
.sd-ui .slot { --c: #c9cfd8; --cl: #eef1f5; --g: 120, 130, 150; flex: 1; min-width: 0; padding: 0 ${u(10)}; position: relative; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: ${u(18)}; border-radius: ${u(40)}; border: ${u(5)} dashed rgba(255, 255, 255, 0.85);
  background: rgba(255, 253, 249, 0.30); backdrop-filter: blur(${u(6)}); transition: background 0.35s, border-color 0.35s, box-shadow 0.35s; }
.sd-ui .slot[data-slot="0"] { --c: var(--c0); --cl: var(--c0l); --cd: var(--c0d); --g: var(--g0); }
.sd-ui .slot[data-slot="1"] { --c: var(--c1); --cl: var(--c1l); --cd: var(--c1d); --g: var(--g1); }
.sd-ui .slot .drop-face { width: ${u(150)}; filter: grayscale(0.9) opacity(0.6); transition: filter 0.35s; }
.sd-ui .slot .name { font-size: ${u(44)}; text-align: center; white-space: nowrap; }
.sd-ui .slot .state { display: flex; white-space: nowrap; align-items: center; gap: ${u(10)}; font-size: ${u(27)}; font-weight: 600; padding: ${u(10)} ${u(20)};
  border-radius: ${u(999)}; background: rgba(255, 253, 249, 0.9); border: ${u(3)} solid var(--ink); }
.sd-ui .slot .state .dots { display: inline-flex; gap: ${u(6)}; }
.sd-ui .slot .state .dots i { width: ${u(9)}; height: ${u(9)}; border-radius: 50%; background: var(--ink); opacity: 0.3; animation: sd-dot 1.2s infinite; }
.sd-ui .slot .state .dots i:nth-child(2) { animation-delay: 0.2s; } .sd-ui .slot .state .dots i:nth-child(3) { animation-delay: 0.4s; }
.sd-ui .slot .check { width: ${u(38)}; display: none; }
.sd-ui .slot .player { position: absolute; top: ${u(24)}; left: 0; right: 0; text-align: center; font-size: ${u(26)}; font-weight: 600; color: #fff; opacity: 0.9;
  -webkit-text-stroke: ${u(5)} var(--ink); paint-order: stroke fill; }
.sd-ui .slot.on { border: ${u(5)} solid var(--ink); background: radial-gradient(120% 90% at 50% 30%, var(--cl) 0%, var(--c) 70%, var(--cd) 130%);
  box-shadow: var(--shadow), 0 0 ${u(60)} rgba(var(--g), 0.75), inset 0 ${u(-14)} 0 rgba(0, 0, 0, 0.10), inset 0 ${u(8)} 0 rgba(255, 255, 255, 0.35); }
.sd-ui .slot.on .drop-face { filter: none; animation: sd-bob 2.4s ease-in-out infinite; }
.sd-ui .slot.on .check { display: block; }
.sd-ui .slot.on .dots { display: none; }
.sd-ui .slot.away { border-style: solid; border-color: var(--ink); background: rgba(255, 253, 249, 0.5); }
.sd-ui .slot.away .drop-face { filter: grayscale(0.4) opacity(0.85); }
.sd-ui .slot.on.unready .check { display: none; }
.sd-ui .slot.on.unready .dots { display: inline-flex; }
.sd-ui .slot.joined { animation: sd-pop 0.6s cubic-bezier(0.3, 1.6, 0.5, 1); }

.sd-ui .lobby .foot { position: absolute; left: ${u(80)}; right: ${u(80)}; bottom: ${u(52)}; height: ${u(170)}; display: flex; gap: ${u(32)}; align-items: stretch; }
.sd-ui .modes { display: flex; gap: ${u(24)}; align-items: stretch; }
.sd-ui .modes .label { align-self: center; font-size: ${u(34)}; margin-right: ${u(6)}; }
.sd-ui .mode { position: relative; width: ${u(400)}; display: flex; flex-direction: column; justify-content: center; gap: ${u(6)}; padding: ${u(18)} ${u(30)};
  text-align: left; border-radius: ${u(32)}; background: var(--paper); border: ${u(4)} solid var(--ink); box-shadow: var(--shadow); }
.sd-ui .mode b { font-size: ${u(46)}; font-weight: 700; }
.sd-ui .mode span { font-size: ${u(25)}; font-weight: 500; opacity: 0.8; line-height: 1.2; }
.sd-ui .mode.sel { background: linear-gradient(180deg, #fff6d6, #ffe08a); box-shadow: var(--shadow), 0 0 0 ${u(8)} rgba(255, 214, 92, 0.6); }
.sd-ui .mode.sel::after { content: ""; position: absolute; right: ${u(22)}; top: ${u(20)}; width: ${u(24)}; height: ${u(24)}; border-radius: 50%;
  background: var(--ink); box-shadow: 0 0 0 ${u(6)} #fff, 0 0 0 ${u(10)} var(--ink); }
.sd-ui .mode.soon { cursor: default; background: rgba(255, 253, 249, 0.7); border-style: dashed; }
.sd-ui .mode.soon b, .sd-ui .mode.soon span { opacity: 0.5; }
.sd-ui .mode .ribbon { position: absolute; right: ${u(-14)}; top: ${u(-20)}; padding: ${u(6)} ${u(18)}; border-radius: ${u(999)};
  font-style: normal; background: #ff9e5e; color: #fff; border: ${u(4)} solid var(--ink); font-size: ${u(24)}; font-weight: 700; transform: rotate(5deg);
  -webkit-text-stroke: ${u(4)} var(--ink); paint-order: stroke fill; }
.sd-ui .start { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${u(4)};
  border-radius: ${u(40)}; border: ${u(5)} solid var(--ink); background: linear-gradient(180deg, #8ae07a 0%, #4fbf5c 100%);
  box-shadow: var(--shadow), inset 0 ${u(-12)} 0 rgba(0, 0, 0, 0.14), inset 0 ${u(8)} 0 rgba(255, 255, 255, 0.35); transition: transform 0.15s, filter 0.3s; }
.sd-ui .start:active { transform: translateY(${u(4)}); }
.sd-ui .start b { font-size: ${u(64)}; }
.sd-ui .start span { font-size: ${u(27)}; font-weight: 600; color: #123a1c; }
.sd-ui .start[disabled] { cursor: default; filter: grayscale(1) brightness(1.05); background: linear-gradient(180deg, #e9e6e1, #cfcac3); }
.sd-ui .start[disabled] b { -webkit-text-stroke-width: ${u(6)}; font-size: ${u(46)}; }
.sd-ui .start[disabled] span { color: var(--ink); opacity: 0.7; }
.sd-ui .start.ready { animation: sd-breathe 1.8s ease-in-out infinite; }
/* hold and lockout progress (ui.fill): a bar filling along the bottom of the button */
.sd-ui .start, .sd-ui .back { position: relative; overflow: hidden; }
.sd-ui .start::after, .sd-ui .back::after { content: ""; position: absolute; left: 0; bottom: 0; height: ${u(14)}; width: calc(var(--fill, 0) * 100%);
  background: var(--ink); opacity: 0; transition: opacity 0.2s; }
.sd-ui .start.filling::after, .sd-ui .back.filling::after { opacity: 0.6; }

/* ---------- lobby: the mountain vote (gallery.js) ---------- */
.sd-ui .lobby.voting::before { background: linear-gradient(180deg, rgba(40, 24, 50, 0.50) 0%, rgba(40, 24, 50, 0.30) 40%, rgba(28, 20, 40, 0.62) 100%); }
.sd-ui .lobby.voting > .head, .sd-ui .lobby.voting > .main { display: none; }
.sd-ui .lobby:not(.voting) > .vfoot { display: none; }
.sd-ui .gallery { position: absolute; inset: 0; pointer-events: none; }
.sd-ui .gallery .vhead { position: absolute; left: 0; right: 0; top: ${u(20)}; display: flex; flex-direction: column; align-items: center; gap: ${u(6)}; transition: opacity 0.3s; }
.sd-ui .gallery .vt { font-size: ${u(76)}; line-height: 1; -webkit-text-stroke-width: ${u(10)}; }
.sd-ui .gallery .vs { font-size: ${u(27)}; font-weight: 600; color: #fff; padding: ${u(6)} ${u(22)}; border-radius: ${u(999)}; background: rgba(29, 31, 43, 0.55); }
.sd-ui .gallery:not([data-phase="vote"]) .vhead { opacity: 0; }
.sd-ui .cards { position: absolute; left: ${u(64)}; right: ${u(64)}; top: ${u(176)}; bottom: ${u(154)}; display: grid;
  grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(2, 1fr); gap: ${u(28)} ${u(26)}; }
.sd-ui .mcard { --ring: 0 0 0 0 transparent; position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; pointer-events: auto; cursor: pointer;
  background: var(--paper); border: ${u(4)} solid var(--ink); border-radius: ${u(30)}; box-shadow: var(--ring), var(--shadow);
  transition: transform 0.35s cubic-bezier(0.3, 1.5, 0.5, 1), box-shadow 0.25s, filter 0.35s, opacity 0.35s; }
.sd-ui .mcard .pic { position: relative; flex: none; height: ${u(184)}; border-radius: ${u(26)} ${u(26)} 0 0; overflow: hidden; border-bottom: ${u(4)} solid var(--ink); background: #e9d7cf; }
.sd-ui .mcard .pic .art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%; }
.sd-ui .mcard .cap { position: absolute; left: 0; right: 0; bottom: 0; padding: ${u(30)} ${u(16)} ${u(10)};
  background: linear-gradient(180deg, rgba(29, 31, 43, 0) 0%, rgba(29, 31, 43, 0.55) 55%, rgba(29, 31, 43, 0.75) 100%); }
.sd-ui .mcard .nm { font-size: ${u(40)}; line-height: 1.02; -webkit-text-stroke-width: ${u(7)}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sd-ui .mcard .rg { display: flex; align-items: center; gap: ${u(8)}; margin-top: ${u(4)}; color: #fff; font-size: ${u(20)}; font-weight: 600; white-space: nowrap; }
.sd-ui .mcard .rg span { overflow: hidden; text-overflow: ellipsis; }
.sd-ui .mcard .flag { width: ${u(34)}; flex: none; }
.sd-ui .mcard .flag.np { width: ${u(25)}; }
.sd-ui .mcard .stats { flex: none; display: grid; grid-template-columns: repeat(3, 1fr); padding: ${u(8)} ${u(12)} ${u(4)}; }
.sd-ui .mcard .stats > div { display: flex; flex-direction: column; align-items: center; min-width: 0; }
.sd-ui .mcard .stats > div + div { border-left: ${u(3)} solid rgba(29, 31, 43, 0.12); }
.sd-ui .mcard .stats span { font-size: ${u(17)}; font-weight: 600; opacity: 0.62; text-transform: uppercase; letter-spacing: ${u(1)}; }
.sd-ui .mcard .stats b { font-size: ${u(29)}; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sd-ui .mcard .fauna { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: ${u(6)}; padding: ${u(2)} ${u(10)} ${u(8)}; }
.sd-ui .mcard figure { margin: 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: ${u(2)}; }
.sd-ui .mcard figure img { height: ${u(56)}; max-width: 100%; object-fit: contain; filter: drop-shadow(0 ${u(3)} ${u(3)} rgba(46, 28, 60, 0.28)); }
.sd-ui .mcard figcaption { font-size: ${u(17)}; font-weight: 600; line-height: 1.02; text-align: center; opacity: 0.8; max-width: 100%; text-wrap: balance;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
/* surprise us: the seven paintings as a mosaic under a die */
.sd-ui .mcard.random { background: linear-gradient(180deg, #fff6d6, #ffe3a3); }
.sd-ui .mcard .mosaic { position: absolute; inset: 0; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; filter: saturate(0.8) brightness(0.9); }
.sd-ui .mcard .mosaic img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%; border-left: ${u(3)} solid var(--ink); }
.sd-ui .mcard .mosaic img:first-child { border-left: 0; }
.sd-ui .mcard .die { position: absolute; left: 50%; top: 42%; width: ${u(120)}; transform: translate(-50%, -50%); filter: drop-shadow(0 ${u(8)} ${u(10)} rgba(29, 31, 43, 0.35)); }
.sd-ui .mcard .rtext { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; padding: ${u(10)} ${u(28)}; font-size: ${u(27)}; font-weight: 600; line-height: 1.2; }
/* the phones' markers: a ring in the player's colour on the card it shows, its drop sitting on the card it voted */
.sd-ui .mcard.f0 { --ring: 0 0 0 ${u(7)} var(--c0); }
.sd-ui .mcard.f1 { --ring: 0 0 0 ${u(7)} var(--c1); }
.sd-ui .mcard.f0.f1, .sd-ui .mcard.f0.b1, .sd-ui .mcard.b0.f1 { --ring: 0 0 0 ${u(7)} var(--c0), 0 0 0 ${u(14)} var(--c1); }
.sd-ui .mcard.b0 { --ring: 0 0 0 ${u(9)} var(--c0), 0 0 ${u(46)} rgba(var(--g0), 0.9); transform: translateY(${u(-8)}); }
.sd-ui .mcard.b1 { --ring: 0 0 0 ${u(9)} var(--c1), 0 0 ${u(46)} rgba(var(--g1), 0.9); transform: translateY(${u(-8)}); }
.sd-ui .mcard.b0.b1 { --ring: 0 0 0 ${u(9)} var(--c0), 0 0 0 ${u(18)} var(--c1), 0 0 ${u(50)} rgba(255, 220, 120, 0.9); }
.sd-ui .mcard .pins { position: absolute; left: 0; right: 0; top: 0; height: 100%; pointer-events: none; }
.sd-ui .mcard .pin { position: absolute; top: ${u(10)}; width: ${u(62)}; opacity: 0; transform: translateY(${u(-30)}) scale(0.6); transition: opacity 0.25s, transform 0.4s cubic-bezier(0.3, 1.6, 0.5, 1); }
.sd-ui .mcard .pin[data-slot="0"] { left: ${u(12)}; } .sd-ui .mcard .pin[data-slot="1"] { right: ${u(12)}; }
.sd-ui .mcard .pin .drop-face { width: 100%; filter: drop-shadow(0 ${u(4)} ${u(5)} rgba(20, 24, 40, 0.45)); }
.sd-ui .mcard .pin .check { position: absolute; right: ${u(-8)}; bottom: ${u(-2)}; width: ${u(30)}; opacity: 0; }
.sd-ui .mcard.f0 .pin[data-slot="0"], .sd-ui .mcard.f1 .pin[data-slot="1"] { opacity: 0.92; transform: scale(0.72); }
.sd-ui .mcard.b0 .pin[data-slot="0"], .sd-ui .mcard.b1 .pin[data-slot="1"] { opacity: 1; transform: none; animation: sd-bob 2.4s ease-in-out infinite; }
.sd-ui .mcard.b0 .pin[data-slot="0"] .check, .sd-ui .mcard.b1 .pin[data-slot="1"] .check { opacity: 1; }
/* the verdict: the others fade, the coin's card glows as it passes, the winner pops */
.sd-ui .mcard.dim { filter: grayscale(0.8) brightness(0.6); transform: scale(0.96); } /* opaque: the 3D lobby must not show through (playtest 28/10) */
.sd-ui .mcard.spin { --ring: 0 0 0 ${u(10)} #ffd23f, 0 0 ${u(60)} rgba(255, 210, 63, 0.95); transform: translateY(${u(-10)}) scale(1.03); filter: none; opacity: 1; transition-duration: 0.08s; }
.sd-ui .mcard.picked { --ring: 0 0 0 ${u(12)} #ffd23f, 0 0 ${u(90)} rgba(255, 210, 63, 1); transform: translateY(${u(-2)}) scale(1.06); z-index: 2; animation: sd-pop 0.6s cubic-bezier(0.3, 1.6, 0.5, 1); }
.sd-ui .verdict { position: absolute; left: 50%; top: ${u(28)}; transform: translateX(-50%); display: flex; align-items: center; gap: ${u(24)}; width: max-content; max-width: ${u(1700)};
  padding: ${u(14)} ${u(44)} ${u(14)} ${u(26)}; border-radius: ${u(999)}; background: var(--paper); border: ${u(5)} solid var(--ink); box-shadow: var(--shadow);
  animation: sd-drop-in 0.5s cubic-bezier(0.3, 1.5, 0.5, 1) both; z-index: 3; }
.sd-ui .verdict .vface { display: flex; }
.sd-ui .verdict .vface .drop-face { width: ${u(66)}; animation: sd-bob 1.6s ease-in-out infinite; }
.sd-ui .verdict .vface .drop-face + .drop-face { margin-left: ${u(-18)}; animation-delay: 0.3s; }
.sd-ui .verdict[data-winner="0"] .vface .drop-face + .drop-face, .sd-ui .verdict[data-winner="1"] .vface .drop-face:first-child { display: none; }
.sd-ui .verdict .vbig { font-size: ${u(62)}; line-height: 1.05; -webkit-text-stroke-width: ${u(9)}; }
.sd-ui .verdict .vsmall { font-size: ${u(28)}; font-weight: 600; opacity: 0.8; margin-top: ${u(2)}; }
/* the players' bar: the QR for a free place, each player's vote; the mode and start buttons shrink to its right */
.sd-ui .vfoot { position: absolute; left: ${u(64)}; right: ${u(956)}; bottom: ${u(26)}; height: ${u(108)}; display: flex; gap: ${u(18)}; align-items: stretch; }
.sd-ui .vjoin { flex: none; display: flex; align-items: center; gap: ${u(12)}; padding: ${u(8)} ${u(18)} ${u(8)} ${u(8)}; border-radius: ${u(26)}; max-width: ${u(360)}; }
.sd-ui .vjoin .qr { width: ${u(88)}; height: ${u(88)}; flex: none; padding: ${u(4)}; background: #fff; border-radius: ${u(14)}; }
.sd-ui .vjoin .qr img { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
.sd-ui .vjoin b { display: block; font-size: ${u(26)}; font-weight: 700; white-space: nowrap; }
.sd-ui .vjoin span { display: block; font-size: ${u(21)}; font-weight: 500; opacity: 0.8; }
.sd-ui .vjoin small { display: block; font-size: ${u(19)}; font-weight: 700; opacity: 0.7; margin-top: ${u(2)}; }
.sd-ui .vp { --c: #c9cfd8; --cl: #eef1f5; flex: 1; min-width: 0; display: flex; align-items: center; gap: ${u(14)}; padding: ${u(8)} ${u(22)} ${u(8)} ${u(14)};
  border-radius: ${u(26)}; border: ${u(4)} dashed rgba(255, 255, 255, 0.8); background: rgba(255, 253, 249, 0.3); transition: background 0.3s; }
.sd-ui .vp[data-slot="0"] { --c: var(--c0); --cl: var(--c0l); --cd: var(--c0d); }
.sd-ui .vp[data-slot="1"] { --c: var(--c1); --cl: var(--c1l); --cd: var(--c1d); }
.sd-ui .vp .drop-face { width: ${u(62)}; flex: none; filter: grayscale(0.9) opacity(0.6); }
.sd-ui .vp > div { min-width: 0; }
.sd-ui .vp b { display: block; font-size: ${u(32)}; -webkit-text-stroke-width: ${u(6)}; white-space: nowrap; }
.sd-ui .vp span { display: block; font-size: ${u(22)}; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 ${u(2)} ${u(4)} rgba(20, 24, 40, 0.5); }
.sd-ui .vp.on { border: ${u(4)} solid var(--ink); background: radial-gradient(120% 120% at 30% 30%, var(--cl) 0%, var(--c) 70%, var(--cd) 140%); box-shadow: var(--shadow); }
.sd-ui .vp.on .drop-face { filter: none; }
.sd-ui .vp.on span { color: var(--ink); text-shadow: none; }
.sd-ui .vp.free span { display: none; } /* the QR card next to it says what to do */
.sd-ui .vp.voted .drop-face { animation: sd-bob 2.4s ease-in-out infinite; }
.sd-ui .lobby.deciding > .foot { opacity: 0.4; filter: grayscale(0.6); transition: opacity 0.3s; } /* the verdict is on, nothing to start */
.sd-ui .lobby.voting > .foot { left: auto; right: ${u(64)}; bottom: ${u(26)}; height: ${u(108)}; gap: ${u(18)}; }
.sd-ui .lobby.voting .modes { gap: ${u(14)}; }
.sd-ui .lobby.voting .mode { width: ${u(200)}; padding: ${u(10)} ${u(20)}; border-radius: ${u(26)}; }
.sd-ui .lobby.voting .mode b { font-size: ${u(34)}; }
.sd-ui .lobby.voting .mode span { display: none; }
.sd-ui .lobby.voting .mode.sel::after { top: ${u(14)}; right: ${u(16)}; width: ${u(18)}; height: ${u(18)}; }
.sd-ui .lobby.voting .mode .ribbon { font-size: ${u(19)}; top: ${u(-18)}; }
.sd-ui .lobby.voting .start { flex: none; width: ${u(420)}; border-radius: ${u(30)}; }
.sd-ui .lobby.voting .start b { font-size: ${u(44)}; }
.sd-ui .lobby.voting .start span { font-size: ${u(19)}; }

/* ---------- race: two halves side by side, or one full view ---------- */
.sd-ui .halves { position: absolute; inset: 0; }
.sd-ui .half { position: absolute; top: 0; bottom: 0; left: 0; width: 50%; overflow: hidden; }
.sd-ui .half[data-slot="1"] { left: 50%; }
.sd-ui.solo .half { left: 0; width: 100%; }
.sd-ui.solo .half.off { display: none; }
.sd-ui .race .divider { position: absolute; left: calc(50% - ${u(2)}); top: 0; bottom: 0; width: ${u(4)}; background: var(--ink); }
.sd-ui.solo .race .divider { display: none; }
.sd-ui .race.counting .hud { opacity: 0; }
.sd-ui .hud { position: absolute; inset: 0; transition: opacity 0.4s; }
.sd-ui .meter { position: absolute; left: ${u(40)}; bottom: ${u(34)}; display: flex; align-items: flex-end; gap: ${u(18)}; }
.sd-ui .meter .drop-meter { width: ${u(84)}; height: auto; transform-origin: 50% 100%; transition: transform 0.4s cubic-bezier(0.3, 1.5, 0.5, 1); }
.sd-ui .meter .lvl, .sd-ui .meter .wave { transition: y 0.4s, transform 0.4s; }
.sd-ui .meter .info { display: flex; flex-direction: column; gap: ${u(4)}; padding-bottom: ${u(6)}; }
.sd-ui .meter .alt { font-size: ${u(46)}; -webkit-text-stroke-width: ${u(7)}; }
.sd-ui .meter .stg { font-size: ${u(30)}; -webkit-text-stroke-width: ${u(6)}; }
.sd-ui .place { position: absolute; right: ${u(44)}; bottom: ${u(26)}; display: flex; align-items: flex-start; line-height: 1; }
.sd-ui .place .n { font-size: ${u(176)}; letter-spacing: ${u(-2)}; -webkit-text-stroke-width: 0; text-shadow: ${outline(6, 5)}; }
.sd-ui .place .sfx { font-size: ${u(64)}; margin-top: ${u(14)}; margin-left: ${u(3)}; -webkit-text-stroke-width: ${u(8)}; }
.sd-ui .place .sfx.deg { font-size: ${u(120)}; margin-top: ${u(-6)}; margin-left: ${u(-2)}; }
.sd-ui .place.bump { animation: sd-pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1); }
.sd-ui.solo .meter { left: ${u(56)}; }

.sd-ui .cd { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.sd-ui .cd .n { font-size: ${u(360)}; line-height: 1; -webkit-text-stroke-width: 0; text-shadow: ${outline(11)}; }
.sd-ui .cd .n.go { color: #ffe066; font-size: ${u(250)}; }
.sd-ui .cd .ti { position: absolute; left: 4%; right: 4%; top: 9%; display: flex; flex-direction: column; align-items: center; gap: ${u(8)}; text-align: center;
  animation: sd-title 2.4s ease-out both; }
.sd-ui .cd .ti b { font-size: ${u(62)}; line-height: 1.05; -webkit-text-stroke-width: ${u(9)}; }
.sd-ui .cd .ti span { font-size: ${u(36)}; line-height: 1.1; -webkit-text-stroke-width: ${u(6)}; }
.sd-ui .cd .ti small { font-size: ${u(30)}; -webkit-text-stroke-width: ${u(5)}; opacity: 0.9; }
.sd-ui.solo .cd .ti b { font-size: ${u(92)}; }
.sd-ui.solo .cd .ti span { font-size: ${u(46)}; }
.sd-ui .cd .n.tick { animation: sd-tick 0.95s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
.sd-ui .cd .n.go.tick { animation: sd-go 1.1s cubic-bezier(0.2, 1.4, 0.4, 1) both; }

/* overlays inside a half: stage transition, finished, waiting. The stage and finish cards sit in the top of the
   half on a solid cream card: the camera keeps the drop in the lower half, so they never cover it (playtest 28/10) */
.sd-ui .stage { position: absolute; left: 0; right: 0; top: ${u(130)}; display: flex; justify-content: center; animation: sd-slide-in 0.5s cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.sd-ui .stage .sc { display: flex; align-items: center; gap: ${u(22)}; max-width: calc(100% - ${u(60)}); padding: ${u(18)} ${u(34)} ${u(20)} ${u(22)}; }
.sd-ui .stage .cl { flex: none; }
.sd-ui .stage .cloud { width: ${u(170)}; animation: sd-float 3s ease-in-out infinite; }
.sd-ui .stage .cloud .rain { animation: sd-rain 1s linear infinite; }
.sd-ui .stage .tx { display: flex; flex-direction: column; align-items: flex-start; gap: ${u(4)}; min-width: 0; }
.sd-ui .stage .big { font-size: ${u(54)}; font-weight: 700; line-height: 1.05; }
.sd-ui .stage .mid { font-size: ${u(32)}; font-weight: 600; line-height: 1.15; opacity: 0.85; }
.sd-ui .stage .pill { margin-top: ${u(8)}; display: flex; align-items: baseline; flex-wrap: wrap; column-gap: ${u(14)}; padding: ${u(8)} ${u(22)}; border-radius: ${u(24)};
  background: var(--cream); border: ${u(3)} solid var(--ink); font-size: ${u(30)}; font-weight: 700; }
.sd-ui .stage .pill small { font-size: ${u(24)}; font-weight: 500; opacity: 0.7; white-space: nowrap; }
.sd-ui.solo .stage .cloud { width: ${u(200)}; }
.sd-ui.solo .stage .big { font-size: ${u(64)}; }

/* the gap to the other drop while one of them waits (stage end, cloud, raining in late); pending: still racing */
.sd-ui .gap { position: absolute; left: 50%; top: ${u(40)}; transform: translateX(-50%); z-index: 2; white-space: nowrap;
  font-size: ${u(64)}; font-variant-numeric: tabular-nums; animation: sd-fade 0.4s ease-out both; }
.sd-ui .gap.ahead { color: #ffe066; }
.sd-ui .gap.pending { font-size: ${u(42)}; -webkit-text-stroke-width: ${u(7)}; }

.sd-ui .finished { position: absolute; left: 0; right: 0; top: ${u(40)}; display: flex; flex-direction: column; align-items: center; gap: ${u(12)};
  animation: sd-slide-in 0.5s cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.sd-ui .finished .fc { display: flex; align-items: center; gap: ${u(22)}; max-width: calc(100% - ${u(60)}); padding: ${u(16)} ${u(34)} ${u(16)} ${u(22)}; }
.sd-ui .finished .fd { flex: none; }
.sd-ui .finished .drop-face { width: ${u(104)}; display: block; animation: sd-bob 2s ease-in-out infinite; }
.sd-ui .finished .tx { display: flex; flex-direction: column; gap: ${u(2)}; min-width: 0; }
.sd-ui .finished .big { font-size: ${u(58)}; font-weight: 700; line-height: 1.05; }
.sd-ui .finished .where { font-size: ${u(26)}; font-weight: 500; opacity: 0.75; line-height: 1.15; }
.sd-ui .finished .pl { display: flex; align-items: flex-start; line-height: 1; flex: none; margin-left: ${u(10)}; }
.sd-ui .finished .pl .n { font-size: ${u(104)}; -webkit-text-stroke-width: 0; text-shadow: ${outline(5, 3)}; color: #ffe066; }
.sd-ui .finished .pl .sfx { font-size: ${u(40)}; margin-top: ${u(8)}; color: #ffe066; -webkit-text-stroke: ${u(6)} var(--ink); paint-order: stroke fill; }
.sd-ui .finished .pl .sfx.deg { font-size: ${u(72)}; margin-top: ${u(-4)}; }
.sd-ui .finished .time { flex: none; font-size: ${u(46)}; font-weight: 700; font-variant-numeric: tabular-nums; }
.sd-ui .finished .time:empty { display: none; }
.sd-ui .finished .wait { font-size: ${u(28)}; padding: ${u(8)} ${u(24)}; border-radius: ${u(999)}; background: var(--paper); border: ${u(3)} solid var(--ink); box-shadow: var(--shadow); }

.sd-ui .half.paused::before { content: ""; position: absolute; inset: 0; backdrop-filter: grayscale(0.7) brightness(0.92); background: rgba(40, 30, 60, 0.12); }
.sd-ui .waiting { position: absolute; left: 50%; top: ${u(40)}; transform: translateX(-50%); width: max-content; max-width: calc(100% - ${u(60)});
  display: flex; align-items: center; gap: ${u(22)}; padding: ${u(20)} ${u(34)} ${u(20)} ${u(24)}; animation: sd-drop-in 0.5s cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.sd-ui .waiting .drop-face { width: ${u(70)}; flex: none; }
.sd-ui .waiting b { display: block; font-size: ${u(40)}; font-weight: 700; }
.sd-ui .waiting span { display: block; font-size: ${u(25)}; font-weight: 500; opacity: 0.78; margin-top: ${u(4)}; }
.sd-ui .waiting .pulse { width: ${u(20)}; height: ${u(20)}; border-radius: 50%; flex: none; background: var(--c);
  box-shadow: 0 0 0 ${u(4)} var(--ink); animation: sd-pulse 1.2s ease-in-out infinite; }
.sd-ui .waiting[data-slot="0"] { --c: var(--c0); } .sd-ui .waiting[data-slot="1"] { --c: var(--c1); }

.sd-ui .toast { position: absolute; left: 50%; top: ${u(30)}; transform: translateX(-50%); width: ${u(1180)}; min-height: ${u(232)}; display: flex; align-items: center; gap: ${u(34)};
  padding: ${u(26)} ${u(48)}; z-index: 3; border-width: ${u(5)}; animation: sd-drop-in 0.5s cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.sd-ui .toast .phone { width: ${u(78)}; flex: none; transform: rotate(-8deg); }
.sd-ui .toast b { display: block; font-size: ${u(58)}; font-weight: 700; }
.sd-ui .toast span { display: block; font-size: ${u(32)}; font-weight: 500; opacity: 0.8; margin-top: ${u(6)}; line-height: 1.25; }
.sd-ui .toast.notice .ic { width: ${u(96)}; flex: none; display: flex; justify-content: center; }
.sd-ui .toast.notice .ic > * { width: 100%; height: auto; transform: none; }

/* ---------- results ---------- */
.sd-ui .results { background: radial-gradient(90% 80% at 50% 40%, rgba(255, 236, 226, 0.35), rgba(40, 24, 50, 0.55)), var(--art, none) center 30% / cover no-repeat; }
.sd-ui .results .head { position: absolute; left: 0; right: 0; top: ${u(46)}; display: flex; flex-direction: column; align-items: center; gap: ${u(10)}; }
.sd-ui .results h1 { margin: 0; font-size: ${u(120)}; line-height: 1; -webkit-text-stroke-width: ${u(11)}; }
.sd-ui .results .sub { font-size: ${u(34)}; -webkit-text-stroke-width: ${u(6)}; }
.sd-ui .podium { position: absolute; left: ${u(140)}; right: ${u(140)}; top: ${u(236)}; height: ${u(650)}; display: flex; gap: ${u(60)}; justify-content: center; }
.sd-ui .res { --c: var(--c0); --cl: var(--c0l); width: ${u(800)}; flex: 0 1 ${u(800)}; min-width: 0; position: relative; display: flex; flex-direction: column; padding: ${u(24)} ${u(36)} ${u(22)}; gap: ${u(12)}; }
.sd-ui .res[data-slot="1"] { --c: var(--c1); --cl: var(--c1l); }
.sd-ui .res::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: ${u(170)}; border-radius: ${u(36)} ${u(36)} 0 0;
  background: linear-gradient(180deg, var(--cl), rgba(255, 255, 255, 0)); }
.sd-ui .res > * { position: relative; }
.sd-ui .res .top { display: flex; align-items: center; gap: ${u(26)}; }
.sd-ui .res .top .drop-face { width: ${u(100)}; flex: none; }
.sd-ui .res .who b { display: block; font-size: ${u(54)}; font-weight: 700; }
.sd-ui .res .who span { display: block; font-size: ${u(28)}; font-weight: 500; opacity: 0.7; }
.sd-ui .res .medal { margin-left: auto; width: ${u(124)}; height: ${u(124)}; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  border: ${u(5)} solid var(--ink); background: radial-gradient(circle at 35% 30%, #fff6c2, #ffd23f 55%, #e0a51a); box-shadow: var(--shadow), inset 0 ${u(-8)} 0 rgba(0, 0, 0, 0.12); }
.sd-ui .res .medal.p2 { background: radial-gradient(circle at 35% 30%, #ffffff, #d5dbe4 55%, #a7b0bd); }
.sd-ui .res .medal.dnf { background: radial-gradient(circle at 35% 30%, #ffffff, #e5e1dc 60%, #c3bdb5); }
.sd-ui .res .medal .n { font-size: ${u(84)}; line-height: 1; -webkit-text-stroke-width: ${u(8)}; }
.sd-ui .res .medal .sfx { font-size: ${u(34)}; align-self: flex-start; margin-top: ${u(28)}; -webkit-text-stroke-width: ${u(6)}; }
.sd-ui .res .medal .sfx.deg { font-size: ${u(60)}; margin-top: ${u(18)}; }
.sd-ui .res .medal .dash { font-size: ${u(70)}; }
.sd-ui .res .time { display: flex; align-items: center; justify-content: space-between; padding: ${u(8)} ${u(26)}; border-radius: ${u(24)};
  background: #f4efe8; border: ${u(3)} solid rgba(29, 31, 43, 0.16); }
.sd-ui .res .time span { font-size: ${u(30)}; font-weight: 500; opacity: 0.75; }
.sd-ui .res .time .behind { margin-left: auto; margin-right: ${u(18)}; font-style: normal; font-size: ${u(30)}; font-weight: 600; opacity: 0.6; font-variant-numeric: tabular-nums; }
.sd-ui .res .time b { font-size: ${u(58)}; font-weight: 700; font-variant-numeric: tabular-nums; }
.sd-ui .res .time b.dnf { font-size: ${u(44)}; opacity: 0.7; }
/* the stage splits with the stages' real names, the drop's peak mass */
.sd-ui .res .stages { display: flex; flex-direction: column; gap: ${u(4)}; }
.sd-ui .res .sh { display: flex; align-items: center; justify-content: space-between; font-size: ${u(28)}; margin-bottom: ${u(2)}; }
.sd-ui .res .sh > b { font-weight: 700; }
.sd-ui .res .peak { display: flex; align-items: center; gap: ${u(8)}; font-size: ${u(24)}; }
.sd-ui .res .peak .drop-meter { width: ${u(26)}; }
.sd-ui .res .peak span { font-weight: 500; opacity: 0.7; }
.sd-ui .res .peak b { font-size: ${u(30)}; font-weight: 700; font-variant-numeric: tabular-nums; }
.sd-ui .res .srow { display: flex; align-items: center; gap: ${u(12)}; font-size: ${u(24)}; line-height: 1.2; padding: ${u(3)} 0; border-top: ${u(2)} dashed rgba(29, 31, 43, 0.12); }
.sd-ui .res .srow i { flex: none; width: ${u(34)}; height: ${u(34)}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-style: normal;
  font-size: ${u(20)}; font-weight: 700; background: var(--cl); border: ${u(2)} solid var(--ink); }
.sd-ui .res .srow .snm { flex: 1; min-width: 0; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sd-ui .res .srow small { flex: none; font-size: ${u(22)}; font-weight: 600; opacity: 0.55; font-variant-numeric: tabular-nums; }
.sd-ui .res .srow b { flex: none; width: ${u(120)}; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.sd-ui .res .stages.many .srow { padding: 0; font-size: ${u(22)}; }
.sd-ui .res .stages.many .srow i { width: ${u(28)}; height: ${u(28)}; font-size: ${u(17)}; }
.sd-ui .res h3 { margin: ${u(2)} 0 0; font-size: ${u(28)}; font-weight: 700; }
/* this phone tapped BOOST for the rematch */
.sd-ui .res .rdy { position: absolute; left: 50%; top: ${u(-26)}; transform: translateX(-50%); display: none; align-items: center; gap: ${u(10)}; white-space: nowrap;
  padding: ${u(8)} ${u(24)} ${u(8)} ${u(14)}; border-radius: ${u(999)}; background: var(--c); color: #fff; border: ${u(4)} solid var(--ink); box-shadow: var(--shadow);
  font-size: ${u(28)}; font-weight: 700; }
.sd-ui .res .rdy .check { width: ${u(34)}; }
.sd-ui .res.ready .rdy { display: flex; animation: sd-pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) both; }
.sd-ui .res.ready { box-shadow: 0 0 0 ${u(6)} var(--c), var(--shadow); }
.sd-ui .res .drank { display: grid; grid-template-columns: repeat(3, 1fr); gap: ${u(14)} ${u(16)}; align-content: start; }
.sd-ui .res .critter { display: flex; align-items: center; gap: ${u(10)}; min-width: 0; }
.sd-ui .res .critter .animal { width: ${u(66)}; flex: none; filter: drop-shadow(0 ${u(4)} ${u(6)} rgba(46, 28, 60, 0.25)); }
.sd-ui .res .critter .x { font-size: ${u(38)}; font-weight: 700; line-height: 1; }
.sd-ui .res .critter .nm { font-size: ${u(21)}; font-weight: 500; opacity: 0.75; line-height: 1.1; }
.sd-ui .res .nobody { grid-column: 1 / -1; }
.sd-ui .res .critter > div { display: flex; flex-direction: column; }
.sd-ui .res .nobody { font-size: ${u(30)}; font-weight: 500; opacity: 0.7; display: flex; align-items: center; gap: ${u(14)}; }
.sd-ui .res .nobody .drop-face { width: ${u(56)}; }
.sd-ui .results .foot { position: absolute; left: 0; right: 0; bottom: ${u(44)}; display: flex; justify-content: center; gap: ${u(36)}; }
.sd-ui .results .back { flex: none; width: ${u(520)}; height: ${u(136)}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${u(2)};
  border-radius: ${u(40)}; border: ${u(5)} solid var(--ink); background: var(--paper); box-shadow: var(--shadow); color: inherit; font: inherit; cursor: pointer; }
.sd-ui .results .back b { font-size: ${u(46)}; }
.sd-ui .results .back span { font-size: ${u(25)}; font-weight: 600; opacity: 0.7; }
.sd-ui .results .start { flex: none; width: ${u(760)}; height: ${u(136)}; }

@keyframes sd-pop { 0% { transform: scale(0.82); } 60% { transform: scale(1.06); } 100% { transform: scale(1); } }
@keyframes sd-bob { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(calc(var(--u) * -10)) rotate(3deg); } }
@keyframes sd-dot { 0%, 100% { opacity: 0.25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(calc(var(--u) * -5)); } }
@keyframes sd-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
@keyframes sd-title { 0% { transform: translateY(${u(-30)}); opacity: 0; } 18%, 80% { transform: none; opacity: 1; } 100% { opacity: 0; } }
@keyframes sd-tick { 0% { transform: scale(1.9); opacity: 0; } 25% { opacity: 1; } 55% { transform: scale(0.94); } 75%, 100% { transform: scale(1); opacity: 1; } }
@keyframes sd-go { 0% { transform: scale(0.4) rotate(-8deg); opacity: 0; } 30% { transform: scale(1.15) rotate(3deg); opacity: 1; }
  60% { transform: scale(1) rotate(0); opacity: 1; } 100% { transform: scale(1.25); opacity: 0; } }
@keyframes sd-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes sd-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(calc(var(--u) * -12)); } }
@keyframes sd-rain { from { transform: translateY(calc(var(--u) * -6)); opacity: 1; } to { transform: translateY(calc(var(--u) * 10)); opacity: 0.6; } }
@keyframes sd-drop-in { from { transform: translate(-50%, calc(var(--u) * -40)); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
@keyframes sd-slide-in { from { transform: translateY(calc(var(--u) * -40)); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes sd-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.6); opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) { .sd-ui *, .sd-ui *::before { animation-duration: 0.01s !important; animation-iteration-count: 1 !important; } }
`;
