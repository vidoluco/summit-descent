// One animal as a sticker for the lobby cards: the game's own model (createAnimals, the cartoon material and its
// outline) under the golden-hour light, alone on a transparent background, three-quarter view, cropped to its
// outline. Served from the repo root by src/ui/tools/stickers.mjs, which saves window.__sticker as a PNG.
//   ?kind=marmot&size=320   the species, and the longest side of the sticker in px
import * as THREE from 'three';
import { THEME, sunDirection } from '../../../render/theme.js';
import { sharedUniforms } from '../../../render/materials.js';
import { createAnimals, SPECIES, SCALE } from '../../../render/animals/index.js';

const q = new URLSearchParams(location.search);
const kind = q.get('kind');
const SIZE = +(q.get('size') || 320);
const W = 1200, H = 1200;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const theme = THEME, shared = sharedUniforms(theme);
shared.fog.uFogBase.value = 1e6; // no haze on a sticker
const scene = new THREE.Scene();
const sd = sunDirection(theme.sun);
const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
sun.position.set(sd.x * 60, sd.y * 60, sd.z * 60);
scene.add(sun, sun.target, new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity));

const spec = SPECIES[kind];
if (!spec) throw new Error(`no species ${kind}`);
const animals = createAnimals(scene, { theme, shared, base: '/assets/vendor/animals/', species: [kind], ground: () => 0, shadows: false, seed: 3 });
animals.setResolution(W * 0.45, H * 0.45); // the outline as thick as on a 540 px view: it survives the reduction
await animals.ready;
animals.spawn([{ kind, x: 0, y: 0, z: 0 }]);
// the sun over the camera's left shoulder; the animal turned to show its flank and face, a bird seen from above
// with its wings spread, as it glides over the course
const sunAz = Math.atan2(sd.x, sd.z), view = sunAz + Math.PI + 0.55;
const flying = !!spec.flying;
for (const a of animals.animals) {
  Object.assign(a, { y: 0, gait: 0, bob: 0, stretch: 0, head: 0, pitch: 0, roll: flying ? +(q.get('roll') ?? 0) : 0, tail: 0, flap: flying ? +(q.get('flap') ?? 0) : 0,
    heading: view + Math.PI - +(q.get('yaw') ?? (flying ? 1.57 : 1.05)), headYaw: flying ? 0 : 0.3 });
}
animals.herd.update = () => animals.animals; // hold the pose
animals.update(0.016, [], []);

// framed on the built model's box (horns, antlers and wings included)
const [sx, sy, sz] = animals.kinds[kind].size.map((v) => v * (SCALE[kind] || 1));
const len = Math.max(sx, sy, sz);
const cam = new THREE.PerspectiveCamera(18, W / H, 0.05, 500);
const back = len * 4.2 + 1;
const fwd = [Math.sin(view), Math.cos(view)];
cam.position.set(-fwd[0] * back, back * +(q.get('elev') ?? (flying ? 1.4 : 0.22)), -fwd[1] * back);
cam.lookAt(0, flying ? 0 : sy * 0.5, 0);
renderer.render(scene, cam);

// crop to the drawn pixels (with a little air), scale so the longest side is SIZE
const src = renderer.domElement;
const probe = Object.assign(document.createElement('canvas'), { width: W, height: H });
const pc = probe.getContext('2d');
pc.drawImage(src, 0, 0);
const px = pc.getImageData(0, 0, W, H).data;
let x0 = W, y0 = H, x1 = -1, y1 = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
if (x1 < 0) throw new Error(`${kind}: nothing drawn`);
const pad = 6, cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = (SIZE - 2 * pad) / Math.max(cw, ch);
const out = Object.assign(document.createElement('canvas'), { width: Math.round(cw * k) + 2 * pad, height: Math.round(ch * k) + 2 * pad });
const oc = out.getContext('2d');
oc.imageSmoothingQuality = 'high';
oc.drawImage(src, x0, y0, cw, ch, pad, pad, out.width - 2 * pad, out.height - 2 * pad);
window.__sticker = { png: out.toDataURL('image/png'), w: out.width, h: out.height, touches: [x0 <= 0, y0 <= 0, x1 >= W - 1, y1 >= H - 1] };
