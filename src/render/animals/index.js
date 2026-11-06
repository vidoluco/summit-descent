// The animals of a stage: one InstancedMesh per species (plus its outline twin), so the whole fauna
// costs two draw calls per species per view. Models load once, are rebuilt into the smooth cartoon look
// (build.js) and animated in the vertex shader from the herd's numbers (behaviour.js).
//
//   const animals = createAnimals(scene, { theme, shared, world: 'carpazi' });
//   await animals.ready;
//   animals.spawn(stage.json.spawns.animals);              // world spawns: {kind, x, y, z, flying?}
//   animals.update(dt, sim.state.players, sim.state.events, sim.state.animals);  // every frame
//   animals.setResolution(w, h);                           // the view size in px, for the outline width
//
// How a species file plugs in. registry.js imports every species file and merges what each exports:
//   SPECIES  id -> spec: the model file, size, palette, paint/repaint/deform rules, rig and motion (the
//            fields are the ones species.js documents and build.js reads); ids are the bake's spawn kinds
//            (tools/bake/worlds/<id>.json animals.kinds), so a baked spawn finds its model by name
//   SCALE    id -> readability factor (how much bigger than life the game draws it), optional
//   WORLDS   world id -> the ids of the species that live on that world's course; createAnimals({ world })
//            loads only those
//   VARIANTS world id -> { spawn kind: species drawn instead }, the coat of that world's season (optional)
// species.js holds the Alps (dolomiti, antelao, svizzera),
// species-carpazi.js the Carpathians, species-asia.js Everest, K2 and Kerinci. A spawn whose kind was not
// loaded up front is loaded on demand. Ids must be unique across files. A species may spread another's spec
// ({ ...ALPS.chamois, colors }) and import the rig helper quadruped() from species.js. A soaring species sets
// flying: true; the bake reads it to flag its spawns (tools/bake/index.mjs).
// The cue: when an animal picks a drop (behaviour.js call) a small "!" bubble pops over its head for a moment,
// a constant size on screen, so a player sees that braking by an animal drew it (playtest r1: nobody noticed).
// Readability: SCALE draws a species bigger than life everywhere; on top, an animal far from a view's camera
// grows up to 1 + theme.animals.far[0] times its size between far[1] and far[2] m (material.js FAR; 0 turns it
// off), so a chamois 50 m up the bank still reads while one drinking at the drop is its own size.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { THEME } from '../theme.js';
import { SPECIES, SCALE, speciesOf, drawnAs } from './registry.js';
import { buildSpecies } from './build.js';
import { extract } from './extract.js';
import { toGeometry, addInstanceAttributes } from './geometry.js';
import { animalMaterial, animalOutlineMaterial, animalDepthMaterial } from './material.js';
import { createHerd } from './behaviour.js';

// opts: { theme, shared (renderer's sharedUniforms), base (URL of assets/vendor/animals/), world (id: load
//   its species), species (ids to load, instead), max (instances per species), scale (multiplier, or
//   {kind: factor}), ground(x, z) -> y, outline (false to skip the hulls), shadows, seed }
export function createAnimals(scene, opts = {}) {
  const theme = opts.theme || THEME;
  const base = opts.base ?? 'assets/vendor/animals/';
  const ids = (opts.species || speciesOf(opts.world)).filter((id) => SPECIES[id]);
  const max = opts.max || 12;
  const group = new THREE.Group();
  group.name = 'animals';
  scene.add(group);
  const herd = createHerd({ ground: opts.ground, seed: opts.seed ?? 7 });
  const kinds = {}; // id -> { mesh, hull, anim, anim2, spec }
  const resolution = new THREE.Vector2(1920, 1080);
  const scaleOf = (k) => (typeof opts.scale === 'number' ? opts.scale : opts.scale?.[k] ?? 1) * (SCALE[k] ?? 1);
  let pending = null;

  const loader = opts.loader || new GLTFLoader();
  const loading = {}; // id -> promise of its kinds entry
  function load(id) {
    loading[id] ??= (async () => {
      const spec = { id, ...SPECIES[drawnAs(opts.world, id)] }; // the coat of the world's season
      const gltf = await loader.loadAsync(`${base}${spec.file}`);
      const built = buildSpecies(extract(gltf.scene, { ...(spec.pose || {}), animations: gltf.animations }), spec);
      const geo = toGeometry(built);
      const { anim, anim2 } = addInstanceAttributes(geo, max);
      const wings = !!spec.flying;
      const mesh = new THREE.InstancedMesh(geo, animalMaterial(theme, opts.shared, built.pivots, { wings }), max);
      mesh.name = `animal:${id}`;
      mesh.count = 0;
      mesh.castShadow = opts.shadows !== false;
      mesh.customDepthMaterial = animalDepthMaterial(built.pivots, { wings });
      mesh.frustumCulled = false; // instances spread over the stage; the bounding sphere is the model's
      group.add(mesh);
      let hull = null;
      if (opts.outline !== false) {
        const om = animalOutlineMaterial(theme, opts.shared, built.pivots, { wings });
        om.uniforms.uResolution.value = resolution;
        om.uniforms.uDepth.value = 0.015 * Math.max(...built.size) * scaleOf(id);
        hull = new THREE.InstancedMesh(geo, om, max);
        hull.name = `animal-outline:${id}`;
        hull.count = 0;
        hull.frustumCulled = false;
        hull.instanceMatrix = mesh.instanceMatrix; // same matrices, one upload
        group.add(hull);
      }
      kinds[id] = { mesh, hull, anim, anim2, spec, size: built.size, faces: built.faces };
    })();
    return loading[id];
  }
  const ready = Promise.all(ids.map(load)).then(() => { if (pending) spawn(pending); });
  const cues = createCues(group, opts.cues ?? CUES);

  function spawn(list) {
    pending = list;
    // a kind this world did not list loads now, and the stage respawns when it is in
    const missing = [...new Set((list || []).map((s) => s.kind || s.species))].filter((k) => SPECIES[k] && !loading[k]);
    if (missing.length) Promise.all(missing.map(load)).then(() => { if (pending === list) spawn(list); }, (e) => console.warn(`animals: ${e.message}`));
    if (!Object.keys(kinds).length) return [];
    const animals = herd.spawn(list || []); // every spawn, so a herd index stays the sim's animal index
    write();
    return animals;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), sc = new THREE.Vector3();
  function write() {
    const counts = {};
    for (const a of herd.animals) {
      const k = kinds[a.kind];
      if (!k) continue; // still loading
      const i = counts[a.kind] = (counts[a.kind] ?? -1) + 1;
      if (i >= max) continue;
      const s = scaleOf(a.kind);
      e.set(a.pitch, a.heading, a.roll); q.setFromEuler(e);
      p.set(a.x, a.y + a.bob * s, a.z);
      sc.set(s, s * (1 + a.stretch), s);
      k.mesh.setMatrixAt(i, m4.compose(p, q, sc));
      k.anim.setXYZW(i, a.phase, a.gait, a.head, a.headYaw);
      k.anim2.setXYZW(i, a.flap, a.tail, 0, 0);
    }
    cues.begin();
    for (const a of herd.animals) {
      const k = kinds[a.kind];
      if (!k || a.call <= 0) continue;
      const s = scaleOf(a.kind), fwd = 0.35 * k.size[2] * s; // over the head, not the middle of the back
      cues.show(a.x + Math.sin(a.heading) * fwd, a.y + k.size[1] * s * 0.95 + 0.25, a.z + Math.cos(a.heading) * fwd, 1 - a.call, a.index);
    }
    cues.end();
    for (const [id, k] of Object.entries(kinds)) {
      const n = Math.min(max, (counts[id] ?? -1) + 1);
      k.mesh.count = n; if (k.hull) k.hull.count = n;
      k.mesh.instanceMatrix.needsUpdate = true; k.anim.needsUpdate = true; k.anim2.needsUpdate = true;
    }
  }

  return {
    group, ready, kinds, herd, cues,
    get animals() { return herd.animals; },
    spawn,
    // dt in s; drops: sim.state.players; events: sim.state.events of this step; simAnimals: sim.state.animals
    update(dt, drops, events, simAnimals) {
      if (!Object.keys(kinds).length) return;
      herd.update(dt, drops, events, simAnimals);
      write();
    },
    setResolution(w, h) { resolution.set(w, h); },
    stats() { return Object.fromEntries(Object.entries(kinds).map(([id, k]) => [id, { faces: k.faces, instances: k.mesh.count, size: k.size }])); },
    dispose() {
      for (const k of Object.values(kinds)) { k.mesh.geometry.dispose(); k.mesh.material.dispose(); k.hull?.material.dispose(); k.mesh.customDepthMaterial.dispose(); }
      cues.dispose();
      scene.remove(group);
    },
  };
}

// The "!" bubble: size is its height as a fraction of the view height, pop the overshoot when it appears.
export const CUES = { max: 6, size: 0.06, pop: 0.3, colors: { fill: '#fff8ec', ink: '#2b211c', mark: '#f0862a' } };

// A pool of sprites drawn at a constant size on screen; without a DOM (Node) nothing is drawn.
function createCues(group, C) {
  const pool = [];
  let used = 0, tex = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 160;
    const g = c.getContext('2d');
    // a round bubble with a short tail pointing down at the animal, a thick dark rim, the mark in orange
    g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = C.colors.ink; g.fillStyle = C.colors.fill;
    g.beginPath(); g.arc(64, 64, 52, Math.PI * 0.62, Math.PI * 0.38); g.lineTo(64, 150); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = C.colors.mark; g.strokeStyle = C.colors.ink; g.lineWidth = 5;
    g.beginPath(); g.roundRect(52, 22, 24, 58, 12); g.fill(); g.stroke();
    g.beginPath(); g.arc(64, 99, 12, 0, Math.PI * 2); g.fill(); g.stroke();
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  const pop = (t) => { // t: 0 when it appears .. 1 when it is gone
    const grow = Math.min(1, t / 0.08), settle = Math.min(1, t / 0.3);
    return grow * (1 + C.pop * Math.sin(settle * Math.PI));
  };
  return {
    begin() { used = 0; },
    show(x, y, z, t, seed) {
      if (!tex || used >= C.max) return;
      let sp = pool[used];
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthWrite: false, transparent: true, fog: false }));
        sp.center.set(0.5, 0); sp.renderOrder = 5; sp.name = 'animal-cue';
        // the same share of the view height whatever the camera's field of view (each split view renders it)
        sp.onBeforeRender = (r, s, cam) => {
          const k = (sp.userData.k * 2) / cam.projectionMatrix.elements[5];
          sp.scale.set(k * 0.8, k, 1); sp.updateMatrixWorld();
        };
        group.add(sp); pool.push(sp);
      }
      sp.userData.k = pop(t) * C.size;
      sp.visible = true;
      sp.position.set(x, y + Math.sin(t * 14 + seed) * 0.08, z);
      sp.material.opacity = Math.min(1, (1 - t) / 0.15);
      used++;
    },
    end() { for (let i = used; i < pool.length; i++) pool[i].visible = false; },
    get shown() { return used; },
    dispose() { for (const sp of pool) sp.material.dispose(); tex?.dispose(); },
  };
}

export { SPECIES, SCALE };
