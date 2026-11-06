// The race renderer (three.js), in the "Cartoon premium" style of docs/mockups/gemini-reference-cartoon.png.
// One scene, one WebGL renderer, one or two chase cameras drawn side by side with viewport + scissor into a
// multisampled target, then one composite pass (outlines, divider, sRGB). Everything is drawn in the local
// frame of the stage being played; the backdrop (global frame) is shifted under it, and far away everything
// dissolves into the world's painted backdrop (paint.js), centred on each stage's downhill heading.
//
//   const r = createRenderer(canvas, { world, stage: 0 });   // world = loadWorld() result
//   r.setStage(world.stages[k].json, world.stages[k].height); // swap stages (each built once, the others in idle time)
//   r.update(sim.state, dt);  r.render();                     // every frame
//   r.resize(innerWidth, innerHeight);
//   await r.ready;                                            // the paintings are in (optional: they pop in)
//
// The look comes from the world's theme (themes/index.js: the default, themes/<id>.js, world.json "look"); pass
// { theme: overrides } to change it, { backdrops: url } for the folder of the paintings (default assets/backdrops/).
import * as THREE from 'three';
import { THEME, mergeTheme, sunDirection } from './theme.js';
import { themeFor } from './themes/index.js';
import { createPaint, stageHeading, footElevation } from './paint.js';
import { createPalette } from './palette.js';
import { sharedUniforms, cartoon } from './materials.js';
import { buildBackdrop, stageTerrainSteps, backdropSurface, carveSteps, drain } from './terrain.js';
import { stagePaths, createPathIndex, roundEnd, bedAt } from './path.js';
import { buildRibbon, buildBanks, waterMaterial, setRibbonRocks } from './water.js';
import { SHAPES, shapeGeometry, placeTreesSteps, gatherTrees } from './trees.js';
import { rockList, rockMesh, fieldRocks } from './rocks.js';
import { createSky, setSkyLook } from './sky.js';
import { createDrop, createPickups } from './drop.js';
import { createParticles } from './particles.js';
import { createChaseCamera } from './camera.js';
import { createPost } from './post.js';

export { THEME, mergeTheme } from './theme.js';
export { themeFor } from './themes/index.js';
export { stageHeading } from './paint.js';

function geometryOf(a, { normals = false } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  if (a.normal) g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  if (a.color) g.setAttribute('color', new THREE.BufferAttribute(a.color, a.color.length === a.position.length ? 3 : 4));
  if (a.rock) g.setAttribute('rock', new THREE.BufferAttribute(a.rock, 2)); // massif walls: weight, terrace coordinate
  if (a.cover) g.setAttribute('cover', new THREE.BufferAttribute(a.cover, 3)); // rock, snow, ice weights (crisp in the shader)
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  if (normals) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function createRenderer(canvas, { world, stage = 0, theme: over, backdrops = 'assets/backdrops/', pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2), renderer: given } = {}) {
  const theme = world ? themeFor(world, over) : mergeTheme(THEME, over);
  const renderer = given || new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const shared = sharedUniforms(theme);
  const palette = createPalette(theme);
  // a stage's own look (theme.stages[stage id], merged over the world's): what changes along a course that runs from
  // the ice to the pastures, such as its banks, its water and its paintings (themes/index.js)
  const stageLooks = new Map();
  function stageLook(json) {
    const over = json?.id && theme.stages?.[json.id];
    if (!over) return { theme, palette };
    if (!stageLooks.has(json.id)) { const t = mergeTheme(theme, over); stageLooks.set(json.id, { theme: t, palette: createPalette(t) }); }
    return stageLooks.get(json.id);
  }
  // the sun: absolute, or relative to each stage's downhill heading (theme.sun.relative), where the painting has it
  const sunAt = (heading) => sunDirection(Number.isFinite(theme.sun.relative) ? { ...theme.sun, azimuth: heading + theme.sun.relative } : theme.sun);
  const sd = sunAt(180), sunVec = new THREE.Vector3(sd.x, sd.y, sd.z);

  // ---- sky, lights
  const sky = createSky(theme, sd, { alpha: 0 });
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity);
  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  const S = theme.shadow;
  sun.castShadow = true;
  sun.shadow.mapSize.set(S.size, S.size);
  Object.assign(sun.shadow.camera, { left: -S.extent, right: S.extent, top: S.extent, bottom: -S.extent, near: 1, far: 1400 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = S.bias; sun.shadow.normalBias = S.normalBias; sun.shadow.radius = S.radius; sun.shadow.intensity = S.darkness;
  scene.add(hemi, sun, sun.target);

  // the painted backdrop over the gradient sky; the haze takes some of its base mist once it is in
  const paint = createPaint(theme, shared.paint, {
    base: backdrops, renderer,
    onLoad: (mist) => { shared.fog.uFogColor.value.set(theme.fog.color); if (mist) shared.fog.uFogColor.value.lerp(mist, theme.backdrop.fogTint); },
  });
  scene.add(paint.mesh);

  // environment for the glossy drops: the sky only
  const envMap = (() => {
    const pm = new THREE.PMREMGenerator(renderer), sc = new THREE.Scene(), s2 = createSky(theme, sd);
    s2.onBeforeRender = () => {}; sc.add(s2);
    const rt = pm.fromScene(sc, 0, 0.1, 5000); pm.dispose();
    return rt.texture;
  })();

  // ---- materials
  const groundMat = cartoon(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, { facets: true, cover: true });
  const backdropMat = cartoon(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, { facets: true, clip: true, creases: true, cover: true });
  const treeMat = cartoon(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, {});
  // the bank band is opaque and one sided (it lies on the ground): one draw, no per-draw program switch
  const bankMat = cartoon(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), shared, {});
  const rockMat = cartoon(new THREE.MeshLambertMaterial({ color: theme.rocks.color }), shared, { facets: true });
  // the instanced shadow casters get their own depth materials (one for the trees, which carry instance colours, one
  // for the rocks and pickups): with three's single default one, every switch between them and the drops' plain
  // meshes rebuilt the program parameters per draw
  const instancedDepth = new THREE.MeshDepthMaterial(), treeDepth = new THREE.MeshDepthMaterial();

  // ---- backdrop (global frame, built once)
  let backdrop = null, surface = null;
  if (world?.backdrop && world.json.backdrop) {
    const b = buildBackdrop(world.json.backdrop, world.backdrop, world.json.stages, theme, palette);
    surface = b.surface;
    backdrop = new THREE.Mesh(geometryOf(b), backdropMat);
    backdrop.receiveShadow = true; backdrop.frustumCulled = false;
    scene.add(backdrop);
  }

  // ---- players and effects
  const drops = [0, 1].map((slot) => createDrop(slot, theme, envMap));
  for (const d of drops) scene.add(d.root);
  const pickups = createPickups(theme, envMap);
  pickups.mesh.customDepthMaterial = instancedDepth;
  scene.add(pickups.mesh);
  const particles = createParticles(theme, shared);
  scene.add(particles.points);
  const cams = [0, 1].map(() => createChaseCamera(theme));

  // trees: one instanced mesh per shape (conifer, round, shrub) and level of detail, refilled per view; only the
  // shapes the world grows get one
  const kinds = [...(theme.trees.kinds || []), ...(theme.trees.shrubs?.kinds || [])];
  const nLod = theme.trees.lod.length;
  const treeBands = SHAPES.flatMap((name, si) => theme.trees.lod.map((r, li) => {
    const used = kinds.some((k) => k.shape === name);
    const cap = used ? theme.trees.lodCap[li] : 1;
    const mesh = new THREE.InstancedMesh(geometryOf(shapeGeometry(si, li), { normals: true }), treeMat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = li === 0; mesh.receiveShadow = li === 0;
    mesh.customDepthMaterial = treeDepth; mesh.visible = used;
    scene.add(mesh);
    return { mesh, r, cap, matrix: mesh.instanceMatrix.array, color: mesh.instanceColor.array };
  }));
  const treeCounts = treeBands.map(() => 0);

  // ---- stage
  // Every stage is built once (terrain, water, banks, rocks, tree instances) and kept: setStage only swaps the
  // group under stageRoot. Stages of the world not built yet are built in idle time, a few ms per update(),
  // so the swap under the cloud (and a rematch back to the first stage) costs no frame.
  const stageRoot = new THREE.Group();
  scene.add(stageRoot);
  let cur = null; // the stage record on screen: { json, paths, index, terrain, trees, mist, height, group }
  const built = new Map(); // stage json -> record
  let job = null; // { json, gen } being built in idle time
  const hit = {};

  function* stageSteps(json, height) {
    const { theme, palette } = stageLook(json);
    const o = json.offset, m = json.height;
    const paths = stagePaths(json, theme.water.rowStep);
    const index = createPathIndex(paths);
    const surf = surface || backdropSurface(m, height); // no backdrop: the stage grid alone
    const terrain = yield* stageTerrainSteps(json, height, surface ? surf : (x, z) => surf(x - o.x, z - o.z) + o.y, index, theme, palette);
    const W = theme.water, ground = terrain.surfaceAt; // the water and the banks sit on the triangles as drawn
    // rocks, then the water that foams around them; the course ends in a rounded pool, not a straight cut
    const rocks = rockList(json, terrain.groundAt, paths);
    const bedRocks = rocks.filter((r) => r.bed);
    const mainOnly = createPathIndex([paths[0]]), mh = {};
    const inMain = (x, z) => mainOnly.nearest(x, z, mh, 60) && mh.d < mh.hw * 0.92;
    // the main banks open where an arm leaves: none across the arm's water at the forks
    const armsOnly = paths.length > 1 ? createPathIndex(paths.slice(1)) : null, ah = {};
    const inArm = armsOnly && ((x, z) => armsOnly.nearest(x, z, ah, 60) && ah.d < ah.hw * 0.92);
    const drawn = paths.map((p, pi) => (pi === 0 ? roundEnd(p, ground, p.hw[p.n - 1] * W.endPool, W.rowStep) : p));
    const ribbons = [];
    for (let pi = 0; pi < paths.length; pi++) { yield; ribbons.push(buildRibbon(drawn[pi], ground, theme, bedRocks, pi > 0 ? inMain : null)); }
    // no ground inside a sheet above it: the terrain under the water is lowered, then the meshes are made
    yield* carveSteps(terrain, index, paths, ribbons.map((rb) => rb.edge), theme);
    // on the triangles as drawn (the lower of the two surfaces: never in the air off a steep face), and no bank stone
    // on a slope steeper than about 55 deg (it would hang on the wall)
    const S = terrain.surfaceAt;
    for (let k = rocks.length - 1; k >= 0; k--) {
      const r = rocks[k], gx = S(r.x + 2, r.z) - S(r.x - 2, r.z), gz = S(r.x, r.z + 2) - S(r.x, r.z - 2);
      if (!r.bed && Math.hypot(gx, gz) / 4 > 1.43) { rocks.splice(k, 1); continue; }
      r.y = Math.min(terrain.groundAt(r.x, r.z), S(r.x, r.z));
    }
    const field = fieldRocks(json, S, index, theme.rocks.field); // the boulder fields of the open ground (rocks.field)
    yield;
    const group = new THREE.Group();
    const groundMesh = new THREE.Mesh(geometryOf(terrain), groundMat);
    groundMesh.receiveShadow = true; groundMesh.frustumCulled = false;
    group.add(groundMesh);
    if (rocks.length) { const rm = rockMesh(rocks, rockMat); rm.customDepthMaterial = instancedDepth; group.add(rm); }
    if (field.length) { const fm = rockMesh(field, rockMat, 2); fm.customDepthMaterial = instancedDepth; group.add(fm); }
    const mist = [];
    for (let pi = 0; pi < paths.length; pi++) {
      const p = drawn[pi], rb = ribbons[pi];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(rb.position, 3));
      g.setAttribute('stream', new THREE.BufferAttribute(rb.stream, 4));
      g.setAttribute('slope', new THREE.BufferAttribute(rb.slope, 2));
      g.setAttribute('mask', new THREE.BufferAttribute(rb.mask, 1));
      g.setIndex(new THREE.BufferAttribute(rb.index, 1));
      const mat = waterMaterial(theme, shared);
      setRibbonRocks(mat, rb.rocks);
      if (pi > 0) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -4; }
      const w = new THREE.Mesh(g, mat); w.frustumCulled = false; w.renderOrder = 1;
      group.add(w);
      const bk = new THREE.Mesh(geometryOf(buildBanks(p, ground, rb.edge, theme, palette.colors, pi > 0 ? inMain : inArm)), bankMat);
      bk.frustumCulled = false; bk.receiveShadow = true;
      group.add(bk);
      // waterfall feet, for the mist
      for (let i = 1; i < p.n - 1; i++) {
        const sl = rb.slope[i * 2], next = rb.slope[(i + 1) * 2];
        if (sl > W.waterfallSlope * 0.7 && next <= W.waterfallSlope * 0.7) mist.push(p.x[i + 1], p.y[i + 1] + W.depth, p.z[i + 1], p.hw[i + 1]);
      }
    }
    // trees: gathered per view in render()
    const trees = yield* placeTreesSteps(json, terrain, index, theme, palette);
    // the chase camera keeps clear of both the smooth ground and the triangles as drawn (on a 4 m grid of a 90 % face
    // they part by metres: the camera under a drawn triangle sees its back, a dark wedge)
    const camGround = (x, z) => Math.max(terrain.groundAt(x, z), terrain.surfaceAt(x, z));
    return { json, paths, index, terrain, trees, mist: Float32Array.from(mist), height, group, camGround };
  }

  // The record of a stage: built already, finished now if it is being built in idle time, else built now.
  function prepare(json, height) {
    let rec = built.get(json);
    if (rec) return rec;
    rec = drain(job?.json === json ? job.gen : stageSteps(json, height));
    if (job?.json === json) job = null;
    built.set(json, rec);
    return rec;
  }

  // Idle work: up to budget ms of building the next stage of the world not built yet (the one after the stage on
  // screen first). Returns true while there is work left.
  function buildIdle(budget = theme.lod.buildBudget) {
    if (!job) {
      const ss = world?.stages || [];
      const at = Math.max(0, ss.findIndex((st) => st?.json === cur?.json));
      for (let d = 1; d <= ss.length && !job; d++) {
        const st = ss[(at + d) % ss.length];
        if (st?.json && st.height && !built.has(st.json)) job = { json: st.json, gen: stageSteps(st.json, st.height) };
      }
      if (!job) return false;
    }
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      const r = job.gen.next();
      if (r.done) { built.set(job.json, r.value); job = null; return true; }
    }
    return true;
  }

  let paintLook = theme.backdrop;
  function setStage(json, height) {
    const rec = prepare(json, height);
    if (cur) stageRoot.remove(cur.group);
    const o = json.offset;
    shared.offset.value.set(o.x, o.y, o.z);
    shared.fog.uFogYOffset.value = o.y;
    const m = json.height;
    shared.clip.value.set(m.x0 + o.x, m.z0 + o.z, m.x0 + (m.w - 1) * m.step + o.x, m.z0 + (m.h - 1) * m.step + o.z);
    if (backdrop) backdrop.position.set(-o.x, -o.y, -o.z);
    // the painting along this stage's way down, the light where the painting has it
    const heading = stageHeading(json), look = stageLook(json).theme.backdrop;
    if (look !== paintLook) { paintLook = look; paint.setBackdrop(look); }
    paint.setHeading(heading);
    const s2 = sunAt(heading); sunVec.set(s2.x, s2.y, s2.z); sky.material.uniforms.uSun.value.copy(sunVec);
    setSkyLook(sky, stageLook(json).theme.sky); // the gradient sky continues this stage's painting
    stageRoot.add(rec.group);
    cur = rec;
    for (const c of cams) { c.reset(); c.foot = NaN; } // the painting's foot is found again from the new place
    for (const d of drops) d.state.prevStatus = '';
    particles.clear();
    stats.tris = rec.terrain.tris; stats.trees = rec.trees.count;
  }

  function disposeStages() {
    const keep = new Set([groundMat, rockMat, bankMat]);
    for (const rec of built.values()) {
      rec.group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose(); // its instance buffers
        if (o.geometry) o.geometry.dispose();
        if (o.material && !keep.has(o.material)) o.material.dispose();
      });
    }
    stageRoot.clear();
    built.clear();
    cur = null; job = null;
  }

  // ---- views
  let layout = 'auto', views = [0, 1], W = 2, H = 2;
  const post = createPost(theme, renderer);
  const stats = { tris: 0, trees: 0, views: 0 };
  const waterInfo = [{ inWater: false, waterY: 0, groundY: 0, waterUp: 0 }, { inWater: false, waterY: 0, groundY: 0, waterUp: 0 }];
  const prev = [{ status: '' }, { status: '' }];
  let lastState = null, time = 0;
  const tmpV = new THREE.Vector3();

  function resize(w, h) {
    W = Math.max(2, Math.floor(w)); H = Math.max(2, Math.floor(h));
    renderer.setSize(W, H, false);
    const pw = Math.floor(W * renderer.getPixelRatio()), ph = Math.floor(H * renderer.getPixelRatio());
    post.setSize(pw, ph);
    particles.material.uniforms.uScale.value = ph / (2 * Math.tan((theme.camera.fov * Math.PI) / 360));
  }

  function setLayout(l, slots) { layout = l; if (slots) views = slots; }

  // slots drawn this frame, side by side (reused array: no allocation per frame)
  const shown = [];
  function pickViews(state) {
    shown.length = 0;
    const ps = state?.players || [];
    if (layout === 'single') { shown.push(views[0] ?? 0); return shown; }
    for (const p of ps) if (shown.length < 2 && (layout === 'split' || p.connected !== false)) shown.push(p.slot);
    if (!shown.length) for (const p of ps) if (shown.length < 2) shown.push(p.slot);
    return shown;
  }

  const none = [];
  function update(state, dt, events = state.events) {
    buildIdle();
    if (!cur || !state) return;
    lastState = state; time += dt;
    shared.time.value = time;
    const ps = state.players;
    const g = cur.terrain.groundAt, depth = theme.water.depth;
    for (let s = 0; s < 2; s++) {
      const p = ps[s];
      if (!p) { drops[s].update(null, dt); continue; }
      const wi = waterInfo[s];
      // the drop clears the ground all around it, and the surface between it and its camera (last frame's) (drop.js)
      wi.groundY = g(p.pos.x, p.pos.z); wi.groundAt = g; wi.camera = cams[s].state.init ? cams[s].camera.position : null;
      wi.inWater = cur.index.nearest(p.pos.x, p.pos.z, hit, 80) && hit.d < hit.hw * 0.96 && p.pos.y - p.radius < hit.y + depth + 0.8;
      const hp = cur.paths[hit.path];
      wi.waterY = wi.inWater ? Math.max(bedAt(hp, hit.i, p.pos.x, p.pos.z) + depth, wi.groundY) : wi.groundY;
      // the water a few metres upstream, between the drop and its chase camera: on a steep run it hides the drop's face
      wi.waterUp = wi.inWater ? hp.y[Math.max(0, hit.i - 2)] + depth : wi.waterY;
      drops[s].update(p, dt, wi);
      cams[s].update(p, dt, cur.paths, cur.camGround);
      // spray
      if (wi.inWater && (p.status === 'rolling')) particles.wake(s, p.pos.x, wi.waterY, p.pos.z, p.vel.x, p.vel.z, p.radius, dt);
      if (prev[s].status === 'airborne' && p.status === 'rolling') particles.burst(p.pos.x, wi.waterY, p.pos.z, theme.particles.splash, 5, 1.2);
      prev[s].status = p.status;
    }
    for (const e of events || none) {
      const p = ps[e.slot];
      if (!p) continue;
      const y = waterInfo[e.slot].waterY;
      if (e.kind === 'splash' || e.kind === 'bump') particles.burst(p.pos.x, y, p.pos.z, theme.particles.splash, 5);
      else if (e.kind === 'pickup') particles.burst(p.pos.x, y + 0.6, p.pos.z, 10, 2.5, 0.7);
      else if (e.kind === 'evaporate' || e.kind === 'finish') particles.burst(p.pos.x, y + 0.5, p.pos.z, 24, 1.5, 1.6);
      else if (e.kind === 'thaw') particles.burst(p.pos.x, y + 0.6, p.pos.z, 18, 3.5, 0.9);
    }
    // mist at the waterfall feet near a camera
    const M = cur.mist;
    for (let i = 0; i < M.length; i += 4) {
      let near = false;
      tmpV.set(M[i], M[i + 1], M[i + 2]);
      for (const c of cams) if (c.state.init && c.camera.position.distanceToSquared(tmpV) < 90000) near = true;
      if (!near) continue;
      if (particles.rnd() < theme.particles.mist * dt) {
        const a = particles.rnd() * 6.283, r = M[i + 3] * 0.6 * particles.rnd();
        particles.emit(M[i] + Math.cos(a) * r, M[i + 1] + 0.2, M[i + 2] + Math.sin(a) * r, Math.cos(a) * 1.5, 2 + 3 * particles.rnd(), Math.sin(a) * 1.5, 2.2);
      }
    }
    pickups.update(state.pickups || [], time);
    particles.update(dt);
  }

  const fwd = new THREE.Vector3();
  function render() {
    const vs = cur && lastState ? pickViews(lastState) : none;
    const pw = Math.floor(W * renderer.getPixelRatio()), ph = Math.floor(H * renderer.getPixelRatio());
    // a render target has its own viewport and scissor (the renderer's apply to the canvas only)
    const rt = post.target;
    rt.scissorTest = false; rt.viewport.set(0, 0, pw, ph);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(theme.fog.color, 0); // alpha 0 where nothing is drawn: no outline there (post.js)
    renderer.clear();
    const n = vs.length, vw = Math.floor(pw / Math.max(n, 1));
    vs.forEach((slot, vi) => {
      const rig = cams[slot], cam = rig.camera, p = lastState.players[slot];
      cam.aspect = vw / ph; cam.updateProjectionMatrix();
      // trees around this camera
      cam.getWorldDirection(fwd);
      const fl = Math.hypot(fwd.x, fwd.z) || 1;
      gatherTrees(cur.trees, cam.position.x, cam.position.z, fwd.x / fl, fwd.z / fl, theme.trees.cone, treeBands, treeCounts, nLod);
      treeBands.forEach((b, k) => {
        const gm = b.mesh;
        gm.count = treeCounts[k];
        gm.instanceMatrix.clearUpdateRanges(); gm.instanceMatrix.addUpdateRange(0, treeCounts[k] * 16); gm.instanceMatrix.needsUpdate = true;
        gm.instanceColor.clearUpdateRanges(); gm.instanceColor.addUpdateRange(0, treeCounts[k] * 3); gm.instanceColor.needsUpdate = true;
      });
      for (const d of drops) d.faceCamera(cam, drops[slot].root.position); // the other drop ghosts right by this camera
      // the painting's height on the horizon from this camera, its foot where this view's 3D ground ends (smoothed)
      const o = cur.json.offset, fx = fwd.x / fl, fz = fwd.z / fl;
      if (surface) {
        const e = footElevation(surface, cam.position.x + o.x, cam.position.y + o.y, cam.position.z + o.z, fx, fz, paintLook.cut[1]); // where this stage's 3D ground turns into its painting
        rig.foot = Number.isFinite(rig.foot) && rig.footAt === time ? rig.foot : Number.isFinite(rig.foot) && time - rig.footAt < 0.5 ? rig.foot + (e - rig.foot) * Math.min(1, (time - rig.footAt) * 2.5) : e;
        rig.footAt = time;
      }
      paint.setView(cam.position.y + o.y, surface ? rig.foot : null, (Math.atan2(fx, -fz) / Math.PI) * 180);
      // the one shadow map, centred on this view's drop
      sun.target.position.set(p.pos.x, p.pos.y, p.pos.z);
      sun.position.copy(sun.target.position).addScaledVector(sunVec, 600);
      sun.target.updateMatrixWorld();
      const x = vi * vw;
      rt.viewport.set(x, 0, vw, ph); rt.scissor.set(x, 0, vw, ph); rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
    });
    rt.scissorTest = false; rt.viewport.set(0, 0, pw, ph);
    renderer.setViewport(0, 0, W, H);
    post.composite(n > 1);
    stats.views = n; stats.treesDrawn = treeCounts;
  }

  if (world?.stages?.[stage]) setStage(world.stages[stage].json, world.stages[stage].height);
  resize(canvas.clientWidth || canvas.width || 2, canvas.clientHeight || canvas.height || 2);

  return {
    setStage, update, render, resize, setLayout,
    // builds a stage now (normally done in idle time by update()); buildIdle(ms) runs one slice of that work
    prepare: (json, height) => { prepare(json, height); }, buildIdle,
    isBuilt: (json) => built.has(json),
    get theme() { return theme; },
    // the painted backdrop: ready resolves (true when a painting is in) once its images are loaded
    get ready() { return paint.ready; }, paint,
    get scene() { return scene; },
    get stageRoot() { return stageRoot; },
    get renderer() { return renderer; },
    // for the game's own effects and the animals: the scene-wide uniforms, the sky env map, the spray pool
    get shared() { return shared; },
    get envMap() { return envMap; },
    get particles() { return particles; },
    get stage() { return cur?.json ?? null; },
    cameras: cams.map((c) => c.camera),
    groundAt: (x, z) => (cur ? cur.terrain.groundAt(x, z) : 0),
    // { inWater, waterY, groundY, waterUp } under the drop of a slot, as of the last update()
    waterAt: (slot) => waterInfo[slot],
    stats,
    dispose() { disposeStages(); renderer.dispose(); },
  };
}
