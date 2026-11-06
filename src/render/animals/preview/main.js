// Look-development scene for the animals, served from the repo root (preview/shoot.mjs):
//   ?scene=lineup                 the Dolomiti species side by side on a golden-hour meadow
//   ?scene=lineup&world=carpazi   that world's species (registry WORLDS), smallest on the left
//   ?scene=lineup&kinds=wolf,lynx any species, side by side
//   ?scene=turn&kind=bear         one species from four sides (front, three-quarter, flank, back)
//   ?scene=drink                  a slow drop on a stream with the animals coming to drink from it
//   ?scene=raw&kind=bear          the species' source model, oriented and normalised as buildSpecies sees
//                                 it, in three orthographic views with the fraction grid its rules use;
//                                 &bare=1 drops the paint, reshape and smoothing (the source as it is)
//   &t=seconds (drink), &w, &h viewport, &yaw (lineup: extra turn of every animal, rad)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { THEME, sunDirection } from '../../theme.js';
import { sharedUniforms, cartoon } from '../../materials.js';
import { createSky } from '../../sky.js';
import { fbm, linear, smooth } from '../../math.js';
import { createAnimals, SPECIES, SCALE } from '../index.js';
import { speciesOf } from '../registry.js';
import { buildSpecies } from '../build.js';
import { extract } from '../extract.js';

const q = new URLSearchParams(location.search);
const sceneName = q.get('scene') || 'lineup';
const W = +(q.get('w') || innerWidth), H = +(q.get('h') || innerHeight);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

if (sceneName === 'raw') await raw();
else await meadow();
window.__ready = true;

// A source model as buildSpecies sees it, in three orthographic views with the fraction grid.
async function raw() {
  const kind = q.get('kind'), spec = { id: kind, ...SPECIES[kind] };
  const gltf = await new GLTFLoader().loadAsync(`/assets/vendor/animals/${spec.file}`);
  const soup = extract(gltf.scene, { ...(spec.pose || {}), animations: gltf.animations });
  if (q.get('bare')) for (const k of ['paint', 'repaint', 'deform', 'taubin', 'subdivide', 'eyes', 'parts']) delete spec[k];
  const built = buildSpecies(soup, spec);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(built.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(built.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(built.color, 3));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9fb3c8');
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));
  scene.add(new THREE.HemisphereLight('#ffffff', '#777777', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(-1, 2, 1.5); scene.add(sun);
  const [sx, sy, sz] = built.size, m = Math.max(sx, sy, sz) * 0.6;
  const views = [
    { pos: [-10, sy / 2, 0], up: [0, 1, 0], u: [sz, 'z'], v: [sy, 'y'] }, // left flank, head to the right
    { pos: [0, sy / 2, 10], up: [0, 1, 0], u: [sx, 'x'], v: [sy, 'y'] }, // from the front
    { pos: [0, 10, 0], up: [0, 0, 1], u: [sx, 'x'], v: [sz, 'z'] }, // from above, head up (x mirrored)
  ];
  const vw = Math.floor(W / 3);
  const grid = Object.assign(document.createElement('canvas'), { width: W, height: H });
  grid.style.cssText = 'position:absolute;left:0;top:0';
  document.body.appendChild(grid);
  const ctx = grid.getContext('2d');
  renderer.setScissorTest(true);
  views.forEach((v, i) => {
    const top = v.pos[1] === 10, cy = top ? 0 : sy / 2;
    const cam = new THREE.OrthographicCamera(-m, m, m * H / vw, -m * H / vw, 0.01, 100);
    cam.position.set(...v.pos); cam.up.set(...v.up); cam.lookAt(0, cy, 0);
    renderer.setViewport(i * vw, 0, vw, H); renderer.setScissor(i * vw, 0, vw, H);
    renderer.render(scene, cam);
    // fraction grid: x and z from -0.5 to 0.5, y from 0 to 1, every 0.1 (red every 0.5)
    const px = (a) => i * vw + vw / 2 + (a / m) * (vw / 2), py = (b) => H / 2 - (b / (m * H / vw)) * (H / 2);
    ctx.font = '12px sans-serif';
    for (let k = 0; k <= 10; k++) {
      const fu = -0.5 + k / 10, fv = v.v[1] === 'y' ? k / 10 : -0.5 + k / 10;
      const X = px(fu * v.u[0] * (i === 2 ? -1 : 1)), Y = py(fv * v.v[0] - cy);
      ctx.strokeStyle = k % 5 ? 'rgba(255,255,255,0.35)' : 'rgba(255,40,40,0.7)';
      ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * vw, Y); ctx.lineTo(i * vw + vw, Y); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.fillText(fu.toFixed(1), X + 2, 14); ctx.fillText(fv.toFixed(1), i * vw + 4, Y - 2);
    }
    ctx.fillText(['side (+z right)', 'front (+x right)', 'top (+z up, +x left)'][i] + `  ${v.u[1]} ${v.v[1]}`, i * vw + 40, H - 10);
  });
  console.log(`raw ${kind}: faces ${built.faces} size ${built.size.map((s) => s.toFixed(3)).join(' ')}`);
}

// Lineup, turn and drink: the shared golden-hour light, a gentle meadow, the animals on it.
async function meadow() {
  const theme = THEME, shared = sharedUniforms(theme);
  const scene = new THREE.Scene();
  const sd = sunDirection(theme.sun);
  scene.add(createSky(theme, sd));
  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = theme.shadow.bias; sun.shadow.normalBias = theme.shadow.normalBias; sun.shadow.radius = theme.shadow.radius;
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 140 });
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity));
  shared.fog.uFogBase.value = 2000; // a meadow around 2000 m: light haze

  // Gentle meadow (rolling, smooth), with a stream through it for the drink scene.
  const stream = sceneName === 'drink';
  const streamX = (z) => 1.2 + Math.sin(z * 0.08) * 2.5;
  function groundAt(x, z) {
    let y = fbm(x / 40, z / 40, 3) * 2.2 + fbm(x / 13, z / 13, 5) * 0.35 - z * 0.03;
    if (stream) { const d = Math.abs(x - streamX(z)); y -= 0.9 * (1 - smooth(1.05, 1.75, d)); }
    return y;
  }
  const waterY = (z) => groundAt(streamX(z), z) + 0.35;
  {
    const N = 220, S = 160, g = new THREE.PlaneGeometry(S, S, N, N); g.rotateX(-Math.PI / 2);
    const P = g.attributes.position, col = new Float32Array(P.count * 3);
    const C = Object.fromEntries(['meadow', 'meadowY', 'meadowF', 'meadowD', 'bank', 'bankWet'].map((k) => [k, linear(theme.terrain[k])]));
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i) - 20; P.setZ(i, z); P.setY(i, groundAt(x, z));
      const n = fbm(x / 18, z / 18, 9), c = [...C.meadow];
      const mixc = (k, t) => { for (let j = 0; j < 3; j++) c[j] += (C[k][j] - c[j]) * t; };
      mixc('meadowY', Math.max(0, 0.5 + n) * 0.6); mixc('meadowF', Math.max(0, -n) * 0.5);
      if (stream) { const d = Math.abs(x - streamX(z)); mixc('bank', (1 - smooth(1.6, 2.3, d)) * 0.9); mixc('bankWet', 1 - smooth(1.0, 1.45, d)); }
      col.set(c, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, cartoon(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, { facets: true }));
    m.receiveShadow = true; scene.add(m);
    if (stream) { // a simple water ribbon
      const pts = [], idx = [];
      for (let k = 0; k <= 120; k++) { const z = -60 + k; for (const s of [-1, 1]) pts.push(streamX(z) + s * 1.3, waterY(z), z); if (k) idx.push(2 * k - 2, 2 * k, 2 * k - 1, 2 * k - 1, 2 * k, 2 * k + 1); }
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); wg.setIndex(idx); wg.computeVertexNormals();
      scene.add(new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: theme.water.base, emissive: theme.water.deep, emissiveIntensity: 0.35, side: THREE.DoubleSide })));
    }
  }

  const world = q.get('world') || 'dolomiti';
  const kinds = sceneName === 'turn' ? [q.get('kind')] : q.get('kinds') ? q.get('kinds').split(',') : speciesOf(world);
  const animals = createAnimals(scene, { theme, shared, base: '/assets/vendor/animals/', species: [...new Set(kinds)], world: q.get('world'), ground: groundAt, seed: 3 });
  animals.setResolution(W, H);
  await animals.ready;
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 3000);
  const flyers = kinds.filter((k) => SPECIES[k].flying), walkers = kinds.filter((k) => !SPECIES[k].flying);
  // the sun behind the camera's left shoulder: the direction the camera looks, and the ground frame
  const sunAz = Math.atan2(sd.x, sd.z), view = sunAz + Math.PI + 0.55;
  const fwd = [Math.sin(view), Math.cos(view)], right = [Math.cos(view), -Math.sin(view)];
  const at = (u, v) => ({ x: right[0] * u + fwd[0] * v, z: right[1] * u + fwd[1] * v });
  const hold = (pose) => {
    for (const a of animals.animals) Object.assign(a, { y: groundAt(a.x, a.z), gait: 0, bob: 0, stretch: 0, head: 0, flap: 0, pitch: 0, roll: 0, tail: 0 }, pose(a));
    animals.herd.update = () => animals.animals; // hold the pose
    animals.update(0.016, [], []);
  };

  if (sceneName === 'lineup' || sceneName === 'turn') {
    // a row across the view, smallest on the left, each animal in three-quarter view (turn: four headings)
    const len = (k) => (SPECIES[k].size.length || SPECIES[k].size.height * 0.8 || 0.5) * (SCALE[k] || 1);
    const row = sceneName === 'turn' ? [kinds[0], kinds[0], kinds[0], kinds[0]] : [...walkers].sort((a, b) => len(b) - len(a));
    const widths = row.map((k) => Math.max(0.9, len(k) * (sceneName === 'turn' ? 1.25 : 0.95))), total = widths.reduce((a, b) => a + b, 0) + 0.5 * (row.length - 1);
    let u = -total / 2;
    const list = row.map((kind, i) => { const p = { kind, ...at(u + widths[i] / 2, sceneName === 'turn' ? 0 : 0.5 * i - 0.5) }; u += widths[i] + 0.5; return p; });
    if (sceneName === 'lineup') flyers.forEach((kind, i) => list.push({ kind, ...at(-0.25 * total + i * 0.5 * total, 0.4 * total + i * 2) }));
    animals.spawn(list);
    const face = view + Math.PI - 1.15 + +(q.get('yaw') || 0); // toward the camera, turned to show the flank
    const turns = [view + Math.PI, view + Math.PI - 0.8, view + Math.PI / 2, view];
    let n = 0;
    hold((a) => a.flying
      ? { y: groundAt(a.x, a.z) + 0.22 * total + 2, heading: view + Math.PI / 2 + 0.5, roll: -0.5, pitch: 0.1, flap: 0.12, headYaw: 0 }
      : { heading: sceneName === 'turn' ? turns[n++] : face, headYaw: sceneName === 'turn' ? 0 : 0.25 });
    // far enough back that the row fills the width (a 34 degree vertical fov is 57 degrees across at 16:9)
    const back = Math.max(4, total * 0.95 + 1);
    const c = at(-0.3, -back), t = at(-0.3, 0.5);
    cam.fov = 34; cam.updateProjectionMatrix();
    cam.position.set(c.x, groundAt(c.x, c.z) + 0.5 + back * 0.07, c.z);
    cam.lookAt(t.x, groundAt(t.x, t.z) + 0.3 + total * 0.07, t.z);
    sun.position.set(sd.x * 60, sd.y * 60, sd.z * 60); sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -total, right: total, top: total, bottom: -total }); sun.shadow.camera.updateProjectionMatrix();
  } else {
    // two slow drops resting by the banks: the walkers spread on both banks and come down to drink
    const list = q.get('kinds') || q.get('world')
      ? walkers.map((kind, i) => ({ kind, x: streamX(-6 + i * 3) + (i % 2 ? 6 : -6), z: -6 + i * 3 }))
      : [{ kind: 'marmot', x: streamX(1.6) - 5.5, z: 1.6 }, { kind: 'chamois', x: streamX(-3.6) + 6, z: -3.6 }, { kind: 'hare', x: -6.5, z: -7 }, { kind: 'chough', x: -2.6, z: 6.5 }];
    flyers.forEach((kind) => list.push({ kind, x: 2, z: -12 }));
    animals.spawn(list);
    const T = +(q.get('t') || 9), dt = 1 / 60;
    const mk = (slot, side, z0, stop) => ({ slot, side, z0, stop, pos: { x: 0, y: 0, z: z0 }, vel: { x: 0, y: 0, z: 0 }, radius: 0.55, status: 'rolling' });
    const drops = [mk(0, -0.55, 1.2, 1.2), mk(1, 0.55, -3.4, -3.4)]; // resting in an eddy by the bank
    const place = (d, t) => {
      d.pos.z = Math.min(d.stop, d.z0 + t * 2.0); d.vel.z = d.pos.z < d.stop ? 2.0 : 0.25;
      d.pos.x = streamX(d.pos.z) + d.side; d.pos.y = waterY(d.pos.z) + 0.55; d.speed = d.vel.z;
    };
    for (let t = 0; t < T; t += dt) { for (const d of drops) place(d, t); animals.update(dt, drops, []); }
    const dropMeshes = [];
    try {
      const { createDrop } = await import('../../drop.js');
      for (const d of drops) {
        const m = createDrop(d.slot, theme, null); scene.add(m.root);
        m.update(d, 0.016, { inWater: true, waterY: waterY(d.pos.z), groundY: groundAt(d.pos.x, d.pos.z) });
        dropMeshes.push(m);
      }
    } catch (e) { console.log('drop module unavailable: ' + e.message); }
    // from downstream on the sunny side: both drops with their drinkers on opposite banks
    const p = drops[0].pos, m0 = { x: (drops[0].pos.x + drops[1].pos.x) / 2, y: (drops[0].pos.y + drops[1].pos.y) / 2, z: (drops[0].pos.z + drops[1].pos.z) / 2 };
    cam.fov = 34; cam.updateProjectionMatrix();
    cam.position.set(m0.x + 4.6, m0.y + 2.9, m0.z + 9.8); cam.lookAt(m0.x - 0.6, m0.y - 0.1, m0.z - 0.6);
    for (const m of dropMeshes) m.faceCamera?.(cam);
    sun.position.set(p.x + sd.x * 60, sd.y * 60, p.z + sd.z * 60); sun.target.position.set(p.x, 0, p.z);
    console.log('modes: ' + animals.animals.map((a) => `${a.kind}:${a.mode}`).join(' '));
  }
  renderer.render(scene, cam);
  console.log('stats: ' + JSON.stringify(animals.stats()) + ' calls ' + renderer.info.render.calls + ' tris ' + renderer.info.render.triangles);
}
