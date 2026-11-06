// Look-development scene for the animals of Everest, K2 and Kerinci, served from the repo root (shoot.mjs):
//   ?scene=lineup&world=everest   the world's species side by side on a meadow in that world's light
//   ?scene=lineup&kinds=yak,pika  any species, side by side
//   ?scene=drink&world=k2         two slow drops on a stream, the world's walkers come to drink
//   ?scene=raw&file=asia/bison.glb&orient=0,0,1,0,1,0,-1,0,0   a source model in three orthographic views
//                                 (side, front, top) with the fraction grid the species rules are written in
//   &t=seconds (drink), &w, &h viewport, &yaw (lineup: extra turn of every animal, rad)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { THEME, sunDirection } from '../../theme.js';
import { sharedUniforms, cartoon } from '../../materials.js';
import { createSky } from '../../sky.js';
import { fbm, linear, smooth } from '../../math.js';
import { createAnimals } from '../index.js';
import { SPECIES, SCALE, WORLDS } from '../registry.js';
import { buildSpecies } from '../build.js';
import { extract } from '../extract.js';

const faunaOf = (world) => (WORLDS[world] || []).map((kind) => ({ kind }));
const q = new URLSearchParams(location.search);
const sceneName = q.get('scene') || 'lineup';
const W = +(q.get('w') || innerWidth), H = +(q.get('h') || innerHeight);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

if (sceneName === 'raw') await raw();
else await stage();
window.__ready = true;

// A source model, oriented and normalised the way buildSpecies sees it, in its own face colours.
async function raw() {
  const file = q.get('file'), orient = q.get('orient') ? q.get('orient').split(',').map(Number) : undefined;
  const gltf = await new GLTFLoader().loadAsync(`/assets/vendor/animals/${file}`);
  const soup = extract(gltf.scene, { clip: q.get('clip'), animations: gltf.animations });
  const kind = q.get('kind'), spec = kind ? { id: kind, ...SPECIES[kind] } : { id: 'raw', orient, size: { length: 1 }, colors: {} };
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
  const grid = Object.assign(document.createElement('canvas'), { id: 'grid', width: W, height: H });
  document.body.appendChild(grid);
  const ctx = grid.getContext('2d');
  renderer.setScissorTest(true);
  views.forEach((v, i) => {
    const cam = new THREE.OrthographicCamera(-m, m, m * H / vw, -m * H / vw, 0.01, 100);
    cam.position.set(...v.pos); cam.up.set(...v.up); cam.lookAt(0, v.pos[1] === 10 ? 0 : sy / 2, 0);
    renderer.setViewport(i * vw, 0, vw, H); renderer.setScissor(i * vw, 0, vw, H);
    renderer.render(scene, cam);
    // fraction grid: x and z from -0.5 to 0.5, y from 0 to 1, every 0.1
    const px = (a) => i * vw + vw / 2 + (a / m) * (vw / 2), py = (b) => H / 2 - (b / (m * H / vw)) * (H / 2);
    const cy = v.pos[1] === 10 ? 0 : sy / 2;
    ctx.font = '12px sans-serif';
    for (let k = 0; k <= 10; k++) {
      const fu = -0.5 + k / 10, fv = v.v[1] === 'y' ? k / 10 : -0.5 + k / 10;
      const X = px(fu * v.u[0] * (i === 2 ? -1 : 1)), Y = py((v.v[1] === 'y' ? fv * v.v[0] : fv * v.v[0]) - (v.v[1] === 'y' ? cy : 0));
      ctx.strokeStyle = k % 5 ? 'rgba(255,255,255,0.35)' : 'rgba(255,40,40,0.7)';
      ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * vw, Y); ctx.lineTo(i * vw + vw, Y); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.fillText(fu.toFixed(1), X + 2, 14); ctx.fillText(fv.toFixed(1), i * vw + 4, Y - 2);
    }
    ctx.fillText(['side (+z right)', 'front (+x right)', 'top (+z up, +x left)'][i] + `  ${v.u[1]} ${v.v[1]}`, i * vw + 40, H - 10);
  });
  console.log(`raw: faces ${built.faces} size ${built.size.map((s) => s.toFixed(3)).join(' ')}`);
}

// Lineup and drink: the world's light (the shared theme), a gentle meadow, the animals on it.
async function stage() {
  const theme = THEME, shared = sharedUniforms(theme);
  const scene = new THREE.Scene();
  const sd = sunDirection(theme.sun);
  scene.add(createSky(theme, sd));
  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = theme.shadow.bias; sun.shadow.normalBias = theme.shadow.normalBias; sun.shadow.radius = theme.shadow.radius;
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 140 });
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity));
  shared.fog.uFogBase.value = 2000;

  const world = q.get('world');
  const kinds = q.get('kinds') ? q.get('kinds').split(',') : faunaOf(world).map((f) => f.kind);
  const stream = sceneName === 'drink';
  const streamX = (z) => 1.2 + Math.sin(z * 0.08) * 2.5;
  // ground colours by world: alpine meadow (theme), Khumbu / Baltoro moraine, Kerinci forest floor
  const GROUND = { everest: ['#a59a7f', '#8f8670', '#b8ab8c'], k2: ['#9c958a', '#86807a', '#b1a99b'], indonesia: ['#6f8f45', '#5c7c3a', '#86a052'] };
  function groundAt(x, z) {
    let y = fbm(x / 40, z / 40, 3) * 2.2 + fbm(x / 13, z / 13, 5) * 0.35 - z * 0.03;
    if (stream) { const d = Math.abs(x - streamX(z)); y -= 0.9 * (1 - smooth(1.05, 1.75, d)); }
    return y;
  }
  const waterY = (z) => groundAt(streamX(z), z) + 0.35;
  {
    const N = 220, S = 160, g = new THREE.PlaneGeometry(S, S, N, N); g.rotateX(-Math.PI / 2);
    const P = g.attributes.position, col = new Float32Array(P.count * 3);
    const gc = GROUND[world] ? GROUND[world].map(linear) : ['meadow', 'meadowY', 'meadowF'].map((k) => linear(theme.terrain[k]));
    const bank = linear(theme.terrain.bank), wet = linear(theme.terrain.bankWet);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i) - 20; P.setZ(i, z); P.setY(i, groundAt(x, z));
      const n = fbm(x / 18, z / 18, 9), c = [...gc[0]];
      const mixc = (C, t) => { for (let j = 0; j < 3; j++) c[j] += (C[j] - c[j]) * t; };
      mixc(gc[2], Math.max(0, 0.5 + n) * 0.6); mixc(gc[1], Math.max(0, -n) * 0.5);
      if (stream) { const d = Math.abs(x - streamX(z)); mixc(bank, (1 - smooth(1.6, 2.3, d)) * 0.9); mixc(wet, 1 - smooth(1.0, 1.45, d)); }
      col.set(c, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, cartoon(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, { facets: true }));
    m.receiveShadow = true; scene.add(m);
    if (stream) {
      const pts = [], idx = [];
      for (let k = 0; k <= 120; k++) { const z = -60 + k; for (const s of [-1, 1]) pts.push(streamX(z) + s * 1.3, waterY(z), z); if (k) idx.push(2 * k - 2, 2 * k, 2 * k - 1, 2 * k - 1, 2 * k, 2 * k + 1); }
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); wg.setIndex(idx); wg.computeVertexNormals();
      const glacial = world === 'everest' || world === 'k2';
      scene.add(new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: glacial ? '#a9d2cf' : theme.water.base, emissive: theme.water.deep, emissiveIntensity: 0.3, side: THREE.DoubleSide })));
    }
  }

  const animals = createAnimals(scene, { theme, shared, base: '/assets/vendor/animals/', species: [...new Set(kinds)], ground: groundAt, seed: 5 });
  animals.setResolution(W, H);
  await animals.ready;
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 3000);
  const flyers = kinds.filter((k) => SPECIES[k].flying), walkers = kinds.filter((k) => !SPECIES[k].flying);

  if (sceneName === 'lineup') {
    // a row across the view, biggest on the left, the low sun behind the camera's left shoulder, three-quarter view
    const sunAz = Math.atan2(sd.x, sd.z), view = sunAz + Math.PI + 0.55;
    const fwd = [Math.sin(view), Math.cos(view)], right = [Math.cos(view), -Math.sin(view)];
    const at = (u, v) => ({ x: right[0] * u + fwd[0] * v, z: right[1] * u + fwd[1] * v });
    const len = (k) => (SPECIES[k].size.length || SPECIES[k].size.height || 0.5) * (SCALE[k] || 1);
    const row = [...walkers].sort((a, b) => len(b) - len(a));
    const widths = row.map((k) => Math.max(0.9, len(k) * 0.95)), total = widths.reduce((a, b) => a + b, 0) + 0.5 * (row.length - 1);
    let u = -total / 2;
    const list = row.map((kind, i) => { const p = { kind, ...at(u + widths[i] / 2, 0.6 * i - 0.6) }; u += widths[i] + 0.5; return p; });
    flyers.forEach((kind, i) => list.push({ kind, ...at(-1.5 + i * 4.5, 10 + i * 2) }));
    animals.spawn(list);
    const face = view + Math.PI - 1.15 + +(q.get('yaw') || 0);
    for (const a of animals.animals) {
      Object.assign(a, { heading: face, y: groundAt(a.x, a.z), gait: 0, bob: 0, stretch: 0, head: 0, headYaw: 0.25, flap: 0, pitch: 0, roll: 0, tail: 0 });
      if (a.flying) Object.assign(a, { y: groundAt(a.x, a.z) + 4.2, heading: view + Math.PI / 2 + 0.5, roll: -0.5, pitch: 0.1, flap: 0.12, headYaw: 0 });
    }
    animals.herd.update = () => animals.animals; // hold the pose
    animals.update(0.016, [], []);
    const back = Math.max(4, total * 1.35) * +(q.get('zoom') || 1);
    const c = at(-0.3, -back);
    cam.fov = 34; cam.updateProjectionMatrix();
    const eye = Math.min(1.6, 0.3 + back * 0.12);
    cam.position.set(c.x, groundAt(c.x, c.z) + eye, c.z);
    const t = at(-0.3, 0.5); cam.lookAt(t.x, groundAt(t.x, t.z) + eye * 0.7, t.z);
    sun.position.set(sd.x * 60, sd.y * 60, sd.z * 60); sun.target.position.set(0, 0, 0);
  } else {
    // two slow drops resting by the banks; the walkers spread on both banks and come down to drink
    const list = walkers.map((kind, i) => ({ kind, x: streamX(-6 + i * 3) + (i % 2 ? 6 : -6), z: -6 + i * 3 }));
    flyers.forEach((kind) => list.push({ kind, x: 2, z: -12 }));
    animals.spawn(list);
    const T = +(q.get('t') || 9), dt = 1 / 60;
    const mk = (slot, side, z0) => ({ slot, side, z0, stop: z0, pos: { x: 0, y: 0, z: z0 }, vel: { x: 0, y: 0, z: 0 }, radius: 0.55, status: 'rolling' });
    const drops = [mk(0, -0.55, -2), mk(1, 0.55, 1.5)];
    const place = (d) => { d.pos.z = d.stop; d.vel.z = 0.25; d.pos.x = streamX(d.pos.z) + d.side; d.pos.y = waterY(d.pos.z) + 0.55; d.speed = 0.25; };
    for (let t = 0; t < T; t += dt) { for (const d of drops) place(d); animals.update(dt, drops, []); }
    try {
      const { createDrop } = await import('../../drop.js');
      for (const d of drops) {
        const m = createDrop(d.slot, theme, null); scene.add(m.root);
        m.update(d, 0.016, { inWater: true, waterY: waterY(d.pos.z), groundY: groundAt(d.pos.x, d.pos.z) });
        m.faceCamera?.(cam);
      }
    } catch (e) { console.log('drop module unavailable: ' + e.message); }
    const p = drops[0].pos;
    cam.fov = 36; cam.updateProjectionMatrix();
    cam.position.set(p.x + 6, p.y + 3.4, p.z + 11); cam.lookAt(p.x - 0.4, p.y - 0.2, p.z - 0.2);
    sun.position.set(p.x + sd.x * 60, sd.y * 60, p.z + sd.z * 60); sun.target.position.set(p.x, 0, p.z);
    console.log('modes: ' + animals.animals.map((a) => `${a.kind}:${a.mode}`).join(' '));
  }
  renderer.render(scene, cam);
  console.log('stats: ' + JSON.stringify(animals.stats()) + ' calls ' + renderer.info.render.calls + ' tris ' + renderer.info.render.triangles);
}
