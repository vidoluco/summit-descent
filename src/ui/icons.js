// Inline SVG art for the host screens, in the game's cartoon language: rounded shapes, flat fills with one soft
// shade, a thin dark outline (INK). Animals are sticker portraits of the real Monte Peralba species.
import { SPECIES, VARIANTS } from '../render/animals/registry.js';

export const INK = '#1d1f2b';

// Slot colours of the drops (render and UI agree on these): slot 0 blue, slot 1 pink.
export const PLAYER_COLORS = [
  { main: '#4aa6f2', light: '#bfe3ff', dark: '#1d4f8f', glow: '74, 166, 242' },
  { main: '#f28bbd', light: '#ffd3e7', dark: '#8f2f5e', glow: '242, 139, 189' },
];

const DROP = 'M32 4 C 40 22 58 38 58 55 A 26 26 0 0 1 6 55 C 6 38 24 22 32 4 Z';
let uid = 0;

// HUD meter: a drop outline whose water level shows the mass (fill 0..1).
export function dropMeter(fill, color = '#5ab4ea') {
  const id = `sdm${uid++}`;
  const y = 84 - Math.max(0, Math.min(1, fill)) * 80;
  return `<svg class="drop-meter" viewBox="0 0 64 84" aria-hidden="true">
<defs><clipPath id="${id}"><path d="${DROP}"/></clipPath></defs>
<path d="${DROP}" fill="#e4f3fc"/>
<g clip-path="url(#${id})"><rect class="lvl" x="-4" y="${y.toFixed(2)}" width="72" height="90" fill="${color}"/>
<path class="wave" d="M-4 ${y.toFixed(2)} q 9 -4 18 0 t 18 0 t 18 0 t 18 0 v 6 h -72 z" fill="#ffffff" opacity=".45"/></g>
<path d="M17 36 C 20 28 25 21 28 16" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".85"/>
<path d="${DROP}" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/></svg>`;
}

// The player's drop with its face: the character from the game, used on lobby cards, results, the cloud.
export function dropFace(slot, { mood = 'happy', size } = {}) {
  const c = PLAYER_COLORS[slot] || PLAYER_COLORS[0];
  const id = `sdf${uid++}`;
  const mouth = mood === 'sleep'
    ? '<path d="M27 63 q 5 3 10 0" fill="none" stroke="#1d1f2b" stroke-width="2.6" stroke-linecap="round"/>'
    : '<path d="M26 61 q 6 6 12 0" fill="none" stroke="#1d1f2b" stroke-width="2.8" stroke-linecap="round"/>';
  const eyes = mood === 'sleep'
    ? `<path d="M19 52 q 4 3 8 0 M37 52 q 4 3 8 0" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`
    : `<g><ellipse cx="23" cy="51" rx="5.6" ry="6.4" fill="#fff" stroke="${INK}" stroke-width="2"/><ellipse cx="41" cy="51" rx="5.6" ry="6.4" fill="#fff" stroke="${INK}" stroke-width="2"/>
<circle cx="24" cy="52" r="3.3" fill="${INK}"/><circle cx="42" cy="52" r="3.3" fill="${INK}"/>
<circle cx="25.2" cy="50.6" r="1.2" fill="#fff"/><circle cx="43.2" cy="50.6" r="1.2" fill="#fff"/></g>`;
  return `<svg class="drop-face" viewBox="-2 0 68 86" ${size ? `width="${size}"` : ''} aria-hidden="true">
<defs><radialGradient id="${id}" cx="38%" cy="58%" r="70%"><stop offset="0" stop-color="${c.light}"/><stop offset=".55" stop-color="${c.main}"/><stop offset="1" stop-color="${c.dark}"/></radialGradient></defs>
<ellipse cx="32" cy="82" rx="22" ry="3.2" fill="#000" opacity=".16"/>
<path d="${DROP}" fill="url(#${id})"/>
<path d="M14 40 C 17 31 22 24 26 18" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" opacity=".8"/>
<ellipse cx="17" cy="62" rx="4.5" ry="2.6" fill="#ff6f8f" opacity=".35"/><ellipse cx="47" cy="62" rx="4.5" ry="2.6" fill="#ff6f8f" opacity=".35"/>
${eyes}${mouth}
<path d="${DROP}" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linejoin="round"/></svg>`;
}

// Stage transition: a puffy cloud carrying the drop, raining at the bottom.
export function cloud(slot) {
  const c = PLAYER_COLORS[slot] || PLAYER_COLORS[0];
  const puff = 'M44 92 C 22 92 16 70 32 64 C 30 44 56 36 66 50 C 74 28 112 30 114 56 C 132 50 146 70 132 84 C 130 90 124 92 118 92 Z';
  return `<svg class="cloud" viewBox="0 0 160 150" aria-hidden="true">
<g class="rain">${[[46, 108], [70, 120], [94, 106], [118, 118], [58, 134], [106, 136]].map(([x, y]) =>
    `<path d="M${x} ${y} c 3 5 6 8 6 11 a 6 6 0 0 1 -12 0 c 0 -3 3 -6 6 -11 z" fill="${c.main}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`).join('')}</g>
<path d="${puff}" fill="#ffffff" stroke="${INK}" stroke-width="3.6" stroke-linejoin="round"/>
<path d="M36 86 C 52 90 100 90 128 84" fill="none" stroke="#dfe7f3" stroke-width="7" stroke-linecap="round"/>
<g transform="translate(62 46) scale(.62)">${dropFace(slot).replace(/<svg[^>]*>|<\/svg>/g, '')}</g>
<path d="M58 56 c 2 -6 8 -9 14 -8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/></svg>`;
}

export function check() {
  return `<svg class="check" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="#5fd38a" stroke="${INK}" stroke-width="3"/>
<path d="M12 21 l 6 6 l 11 -13" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function phone() {
  return `<svg class="phone" viewBox="0 0 40 56" aria-hidden="true"><rect x="4" y="3" width="32" height="50" rx="7" fill="#fff" stroke="${INK}" stroke-width="3.4"/>
<rect x="9" y="10" width="22" height="32" rx="3" fill="#cfe7ff"/><circle cx="20" cy="47" r="2.4" fill="${INK}"/></svg>`;
}

export function wifi() {
  return `<svg class="wifi" viewBox="0 0 40 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round">
<path d="M4 12 C 14 3 26 3 36 12"/><path d="M10 18 C 16 13 24 13 30 18"/></g><circle cx="20" cy="25" r="3.6" fill="currentColor"/></svg>`;
}

// ---------- animals: sticker portraits, 100x100 ----------
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const eye = (x, y, r = 4.4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${x + r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.36}" fill="#fff"/>`;
const blush = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="3" fill="#ff7d8e" opacity=".33"/>`;
// The portrait is clipped to its round badge; CLIP becomes a unique id per drawn icon.
const badge = (bg, body) => `<defs><clipPath id="CLIP"><circle cx="50" cy="50" r="46"/></clipPath></defs>
<circle cx="50" cy="50" r="46" fill="${bg}"/><g clip-path="url(#CLIP)">${body}</g><circle cx="50" cy="50" r="46" fill="none" stroke="${INK}" stroke-width="3.4"/>`;

const ANIMALS = {
  // Marmota marmota: round brown face, darker crown, cream muzzle, two small incisors.
  marmot: badge('#d7ecb4', `
<circle cx="28" cy="33" r="8" fill="#8a5b38" ${S}/><circle cx="72" cy="33" r="8" fill="#8a5b38" ${S}/>
<circle cx="28" cy="34" r="3.4" fill="#d9a77c"/><circle cx="72" cy="34" r="3.4" fill="#d9a77c"/>
<path d="M50 26 C 74 26 82 44 82 60 C 82 78 68 88 50 88 C 32 88 18 78 18 60 C 18 44 26 26 50 26 Z" fill="#b07b4f" ${S}/>
<path d="M30 38 C 36 30 64 30 70 38 C 62 35 38 35 30 38 Z" fill="#7d5132"/>
<path d="M50 54 C 64 54 70 62 70 70 C 70 80 60 84 50 84 C 40 84 30 80 30 70 C 30 62 36 54 50 54 Z" fill="#ecd3ad"/>
${eye(37, 50)}${eye(63, 50)}${blush(28, 62)}${blush(72, 62)}
<path d="M45 61 Q 50 58 55 61 Q 54 66 50 66 Q 46 66 45 61 Z" fill="#4a2e22"/>
<path d="M44 71 Q 47 74 50 71 Q 53 74 56 71" fill="none" ${S}/>
<rect x="47" y="72.5" width="6" height="4.6" rx="1.6" fill="#fff" ${S} stroke-width="2"/>`),

  // Capra ibex: long ridged horns sweeping back, grey-brown face, short beard.
  ibex: badge('#cfe2f5', `
<path d="M41 40 C 35 28 32 19 24 13" fill="none" stroke="${INK}" stroke-width="15" stroke-linecap="round"/>
<path d="M59 40 C 65 28 68 19 76 13" fill="none" stroke="${INK}" stroke-width="15" stroke-linecap="round"/>
<path d="M41 40 C 35 28 32 19 24 13" fill="none" stroke="#d8c49a" stroke-width="9.5" stroke-linecap="round"/>
<path d="M59 40 C 65 28 68 19 76 13" fill="none" stroke="#d8c49a" stroke-width="9.5" stroke-linecap="round"/>
<path d="M41 40 C 35 28 32 19 24 13 M59 40 C 65 28 68 19 76 13" fill="none" stroke="#8e7850" stroke-width="9.5" stroke-dasharray="2 5"/>
<path d="M33 50 C 22 46 16 50 12 54 C 20 58 28 58 34 56 Z" fill="#8f7b60" ${S}/>
<path d="M67 50 C 78 46 84 50 88 54 C 80 58 72 58 66 56 Z" fill="#8f7b60" ${S}/>
<path d="M50 36 C 64 36 68 48 67 62 C 66 76 60 86 50 86 C 40 86 34 76 33 62 C 32 48 36 36 50 36 Z" fill="#a38d6f" ${S}/>
<path d="M50 64 C 60 64 63 72 61 79 C 59 85 55 87 50 87 C 45 87 41 85 39 79 C 37 72 40 64 50 64 Z" fill="#e0d2b6"/>
<path d="M44 85 C 46 94 54 94 56 85 Z" fill="#5f4c38" ${S} stroke-width="2.4"/>
${eye(42, 56, 4)}${eye(58, 56, 4)}
<ellipse cx="46" cy="73" rx="2" ry="1.6" fill="${INK}"/><ellipse cx="54" cy="73" rx="2" ry="1.6" fill="${INK}"/>
<path d="M50 36 C 64 36 68 48 67 62 C 66 76 60 86 50 86 C 40 86 34 76 33 62 C 32 48 36 36 50 36 Z" fill="none" ${S}/>`),

  // Rupicapra rupicapra: cream face with the dark stripe through each eye, short black hooked horns.
  chamois: badge('#f6dcc4', `
<path d="M44 38 C 43 28 41 20 42 15 C 43 10 38 9 36 13" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
<path d="M56 38 C 57 28 59 20 58 15 C 57 10 62 9 64 13" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
<path d="M35 46 C 26 38 18 38 14 40 C 18 48 26 52 34 52 Z" fill="#8b5a3c" ${S}/>
<path d="M65 46 C 74 38 82 38 86 40 C 82 48 74 52 66 52 Z" fill="#8b5a3c" ${S}/>
<path d="M50 34 C 64 34 68 46 67 60 C 66 74 60 86 50 86 C 40 86 34 74 33 60 C 32 46 36 34 50 34 Z" fill="#f4ecdc" ${S}/>
<path d="M40 36 C 36 46 36 56 41 64 C 43 70 46 76 47 82 C 43 80 38 74 36 66 C 33 56 34 44 40 36 Z" fill="#3b2a22"/>
<path d="M60 36 C 64 46 64 56 59 64 C 57 70 54 76 53 82 C 57 80 62 74 64 66 C 67 56 66 44 60 36 Z" fill="#3b2a22"/>
<path d="M33.5 58 C 33 70 38 82 46 85 C 40 80 36 70 36 58 Z M66.5 58 C 67 70 62 82 54 85 C 60 80 64 70 64 58 Z" fill="#a8714b"/>
${eye(41.5, 55, 4)}${eye(58.5, 55, 4)}
<ellipse cx="46" cy="76" rx="2" ry="1.6" fill="${INK}"/><ellipse cx="54" cy="76" rx="2" ry="1.6" fill="${INK}"/>
<path d="M50 34 C 64 34 68 46 67 60 C 66 74 60 86 50 86 C 40 86 34 74 33 60 C 32 46 36 34 50 34 Z" fill="none" ${S}/>`),

  // Aquila chrysaetos: profile with the golden nape, dark brown head, yellow cere and a hooked beak.
  eagle: badge('#cfe2f5', `
<path d="M20 92 C 18 70 22 46 40 34 C 54 26 70 30 76 42 C 78 48 76 54 72 58 C 70 70 66 82 64 94 Z" fill="#6e4526" ${S}/>
<path d="M30 52 C 32 40 42 32 54 32 C 46 38 42 46 42 56 C 38 64 34 70 30 76 C 28 68 28 60 30 52 Z" fill="#d9a348"/>
<path d="M38 34 C 46 28 58 28 66 34 C 58 33 50 34 44 38 Z" fill="#e8bd62"/>
<path d="M70 42 C 78 40 86 44 90 52 C 92 58 90 64 86 66 C 86 60 82 56 76 56 C 72 56 70 52 70 48 Z" fill="#f2c23d" ${S}/>
<path d="M86 66 C 88 62 88 58 86 56" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<path d="M70 42 C 72 40 76 39 79 40 L 76 48 C 73 48 70 46 70 42 Z" fill="#ffd95c" ${S} stroke-width="2.4"/>
<path d="M50 42 C 56 37 64 38 67 43" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>
${eye(59, 48, 4.4)}
<path d="M46 70 C 50 76 56 80 62 80 M40 80 C 46 86 54 88 60 88" fill="none" stroke="#4b2e19" stroke-width="2.6" stroke-linecap="round"/>`),

  // Pyrrhocorax graculus: glossy black, short curved yellow bill, red legs.
  chough: badge('#f9e3c0', `
<path d="M42 82 L 40 92 M36 92 h 9 M56 82 L 58 92 M54 92 h 9" fill="none" stroke="#e2473a" stroke-width="4.2" stroke-linecap="round"/>
<path d="M50 22 C 70 22 80 38 78 54 C 76 72 64 84 50 84 C 32 84 20 72 20 56 C 20 38 32 22 50 22 Z" fill="#2a2c38" ${S}/>
<path d="M24 60 C 18 66 14 74 16 82 C 24 78 30 72 34 64 Z" fill="#20222c" ${S}/>
<path d="M34 34 C 40 28 50 26 58 28" fill="none" stroke="#5b6a96" stroke-width="5" stroke-linecap="round" opacity=".8"/>
<path d="M66 46 C 74 44 84 46 90 52 C 84 54 76 56 68 56 Z" fill="#f4cc32" ${S}/>
<path d="M68 51 C 76 51 82 52 89 52" fill="none" stroke="#c99a12" stroke-width="2" stroke-linecap="round"/>
<circle cx="58" cy="44" r="6.2" fill="#fff" stroke="${INK}" stroke-width="2"/>${eye(59.5, 44.5, 3.8)}
${blush(54, 58)}`),

  // Lepus timidus: long ears with black tips, grey-brown summer coat, white muzzle.
  hare: badge('#d7ecb4', `
<path d="M37 44 C 30 30 28 14 34 8 C 42 6 46 22 46 40 Z" fill="#b9a891" ${S}/>
<path d="M63 44 C 70 30 72 14 66 8 C 58 6 54 22 54 40 Z" fill="#b9a891" ${S}/>
<path d="M36 30 C 34 22 34 14 37 12 C 41 13 42 22 42 32 Z M64 30 C 66 22 66 14 63 12 C 59 13 58 22 58 32 Z" fill="#f3c9cf"/>
<path d="M30 13 C 31 9 33 7 35 7.5 C 39 8 41 11 42 14 C 38 12 34 12 30 13 Z M70 13 C 69 9 67 7 65 7.5 C 61 8 59 11 58 14 C 62 12 66 12 70 13 Z" fill="${INK}"/>
<path d="M50 38 C 68 38 78 50 78 64 C 78 78 66 88 50 88 C 34 88 22 78 22 64 C 22 50 32 38 50 38 Z" fill="#c4b39c" ${S}/>
<path d="M50 62 C 62 62 68 70 66 78 C 64 84 58 87 50 87 C 42 87 36 84 34 78 C 32 70 38 62 50 62 Z" fill="#fbf8f2"/>
${eye(38, 57, 4.6)}${eye(62, 57, 4.6)}${blush(30, 70)}${blush(70, 70)}
<path d="M46 68 Q 50 66 54 68 Q 52 72 50 72 Q 48 72 46 68 Z" fill="#e7808f" ${S} stroke-width="2"/>
<path d="M50 72 v4 M50 76 q -4 4 -7 1 M50 76 q 4 4 7 1" fill="none" ${S} stroke-width="2.4"/>
<path d="M50 38 C 68 38 78 50 78 64 C 78 78 66 88 50 88 C 34 88 22 78 22 64 C 22 50 32 38 50 38 Z" fill="none" ${S}/>`),

  // Bruna alpina: grey-brown, pale muzzle ring, short pale horns, a cowbell.
  cow: badge('#d7ecb4', `
<path d="M34 32 C 28 26 26 20 28 16 C 32 20 36 24 40 28 Z M66 32 C 72 26 74 20 72 16 C 68 20 64 24 60 28 Z" fill="#efe4cc" ${S}/>
<path d="M30 40 C 20 36 12 38 9 42 C 14 50 24 52 32 48 Z M70 40 C 80 36 88 38 91 42 C 86 50 76 52 68 48 Z" fill="#8a7564" ${S}/>
<path d="M50 26 C 66 26 72 38 71 52 C 70 62 68 66 66 70 L 34 70 C 32 66 30 62 29 52 C 28 38 34 26 50 26 Z" fill="#9b8574" ${S}/>
<path d="M44 28 C 46 34 54 34 56 28 C 54 26 46 26 44 28 Z" fill="#7c6858"/>
<path d="M50 60 C 66 60 74 66 74 74 C 74 82 64 86 50 86 C 36 86 26 82 26 74 C 26 66 34 60 50 60 Z" fill="#efe4d6" ${S}/>
<path d="M50 63 C 62 63 68 67 68 72 C 68 78 60 80 50 80 C 40 80 32 78 32 72 C 32 67 38 63 50 63 Z" fill="#f2c9bf"/>
<ellipse cx="41" cy="71" rx="3.2" ry="2.4" fill="#7a4a44"/><ellipse cx="59" cy="71" rx="3.2" ry="2.4" fill="#7a4a44"/>
<path d="M44 79 Q 50 82 56 79" fill="none" ${S} stroke-width="2.2"/>
${eye(40, 48, 4.4)}${eye(60, 48, 4.4)}
<path d="M44 86 C 44 96 56 96 56 86 Z" fill="#f1c34a" ${S} stroke-width="2.6"/><circle cx="50" cy="95" r="2" fill="${INK}"/>`),
};

// Every species of the game has an icon: its drawn badge above, or else the sticker rendered from its own model
// (assets/ui/animals/<kind>.png, src/ui/tools/stickers.mjs), the one the lobby cards show.
export const STICKERS = 'assets/ui/animals/';
// a paint variant of a species (the Valais chamois in its winter coat) is drawn on the course but is the same animal
// to the race and the results, so it gets no badge or name of its own
const PAINTS = new Set(Object.values(VARIANTS).flatMap((v) => Object.values(v)));
export const ANIMAL_KINDS = [...new Set([...Object.keys(ANIMALS), ...Object.keys(SPECIES)])].filter((k) => !PAINTS.has(k));

export function animal(kind) {
  const body = ANIMALS[kind];
  if (!body) return SPECIES[kind] ? `<img class="animal sticker" alt="" src="${STICKERS}${kind}.png">` : '';
  return `<svg class="animal" viewBox="0 0 100 100" aria-hidden="true">${body.replace(/CLIP/g, `sda${uid++}`)}</svg>`;
}

// ---------- flags of the vote's countries: rounded, flat, with the ink outline (60x40; Nepal's is its own shape) ----------
const FLAG_BODY = {
  IT: '<rect width="20" height="40" fill="#009246"/><rect x="20" width="20" height="40" fill="#fff"/><rect x="40" width="20" height="40" fill="#ce2b37"/>',
  RO: '<rect width="20" height="40" fill="#002b7f"/><rect x="20" width="20" height="40" fill="#fcd116"/><rect x="40" width="20" height="40" fill="#ce1126"/>',
  ID: '<rect width="60" height="20" fill="#e70011"/><rect y="20" width="60" height="20" fill="#fff"/>',
  CH: '<rect width="60" height="40" fill="#da291c"/><path d="M26 9 h8 v7 h7 v8 h-7 v7 h-8 v-7 h-7 v-8 h7 z" fill="#fff"/>',
  PK: '<rect width="60" height="40" fill="#01411c"/><rect width="15" height="40" fill="#fff"/>'
    + '<path d="M44.5 8.5 A 12 12 0 1 0 50.5 29.5 A 9.6 9.6 0 1 1 44.5 8.5 Z" fill="#fff"/>'
    + '<path d="M45 11.5 l 1.3 3.6 3.8 0.1 -3 2.3 1.1 3.7 -3.2 -2.2 -3.1 2.2 1.1 -3.7 -3 -2.3 3.8 -0.1 z" fill="#fff"/>',
};
export const FLAGS = [...Object.keys(FLAG_BODY), 'NP'];
export function flag(country) {
  if (country === 'NP') {
    // the two stacked pennants, crimson with the blue border, the moon above and the sun below
    const p = 'M3 2 L 30 19 L 13 19 L 30 38 L 3 38 Z';
    return `<svg class="flag np" viewBox="0 0 34 40" aria-hidden="true"><path d="${p}" fill="#003893" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
<path d="M6 7.5 L 22 17 L 9.5 17 L 9.5 21 L 23 35 L 6 35 Z" fill="#dc143c"/>
<path d="M8.5 11.5 a 4.2 4.2 0 0 0 8 0 a 4 3 0 0 1 -8 0 z" fill="#fff"/><circle cx="12.5" cy="13.6" r="1.6" fill="#fff"/>
<circle cx="12.5" cy="28.5" r="3.4" fill="#fff"/></svg>`;
  }
  const body = FLAG_BODY[country];
  if (!body) return '';
  const id = `sdg${uid++}`;
  return `<svg class="flag" viewBox="-2 -2 64 44" aria-hidden="true"><defs><clipPath id="${id}"><rect width="60" height="40" rx="7"/></clipPath></defs>
<g clip-path="url(#${id})">${body}<rect width="60" height="20" fill="#fff" opacity=".12"/></g>
<rect width="60" height="40" rx="7" fill="none" stroke="${INK}" stroke-width="3"/></svg>`;
}

// The "surprise us" card's die: rounded, tilted, five pips.
export function die() {
  const pip = (x, y) => `<circle cx="${x}" cy="${y}" r="5.4" fill="${INK}"/>`;
  return `<svg class="die" viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-12 50 50)">
<rect x="14" y="18" width="72" height="72" rx="16" fill="#cbbfb2"/><rect x="14" y="12" width="72" height="72" rx="16" fill="#fffdf9" stroke="${INK}" stroke-width="4"/>
${pip(32, 30)}${pip(68, 30)}${pip(50, 48)}${pip(32, 66)}${pip(68, 66)}</g></svg>`;
}
