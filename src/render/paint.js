// The painted backdrop: the far landscape is a painting of the real view (assets/backdrops/<id>.jpg, CREDITS.md
// there), not 3D terrain. It sits on a camera-centred cylinder at the horizon, undistorted there (arc length per
// texel = height per texel), centred on the stage's downhill heading; a second painting of the summit itself
// (<id>-summit.jpg) sits on the opposite azimuth, behind the start, for the views looking back uphill.
//   - Past each side edge it fades out (over `edge` deg) into the gradient sky above and its base mist below: nothing
//     is shown there that the painting does not show (no mirrored or stretched copy of its edge).
//   - Above it, its own sky (each column's top rows, blurred across) fades into the gradient sky toward the zenith
//     (over `skyFade` image heights); a wall cut by the image's top edge dissolves into that sky over `topFeather`.
//   - The painting was seen from a real altitude (`eye`) at a real distance from its massif: from higher up the
//     massif sits lower on the horizon, from lower down higher (setView, per view, from the camera's altitude).
//   - Only the far part of the painting is used: under its foot row (baseHaze[1]) it is all base mist, so the
//     painted foreground never shows at the scale of a distant range.
//   - The 3D ground, trees, rocks and water turn into that base mist between the `cut` distances, opaque, and are not
//     drawn beyond them where the painting shows land (paintFade in PAINT_GLSL, used by materials.js and water.js):
//     nothing 3D is ever seen through, or blended with, the painting. The far valley floor seen from high up, well
//     under the painting's foot, stays 3D.
// One background sphere draws it all (no depth), over the gradient sky, once the images are loaded.
//
//   const paint = createPaint(theme, shared.paint, { base: 'assets/backdrops/' });
//   scene.add(paint.mesh); paint.setHeading(stageHeading(stage.json)); await paint.ready;
//   paint.setView(cameraAltitude, footElevation(...), azimuth);   // before each view is drawn
//
// Azimuths are in degrees clockwise from north (north is -z, east is +x), as the sun's in the theme.
import * as THREE from 'three';
import { clamp } from './math.js';

const D2R = Math.PI / 180;

// The downhill heading of a stage (deg): its "heading" from world.json if baked, else the chord of its course
// from the start to the finish (the course curves around it: p5..p95 within about +-60 deg on every world).
export function stageHeading(stage) {
  if (Number.isFinite(stage?.heading)) return stage.heading;
  const c = stage?.course;
  if (!c || c.length < 2) return 180;
  const a = c[0], b = c[c.length - 1];
  return ((Math.atan2(b.x - a.x, -(b.z - a.z)) / D2R) + 360) % 360;
}

// The elevation (deg) of the 3D ground's far edge seen from (x, y, z) looking along the horizontal unit (fx, fz):
// the highest of the ground at 0.8, 1 and 1.25 x dist (the cut, where the 3D ground turns into the painting).
// ground(x, z) -> y, all in one frame.
export function footElevation(ground, x, y, z, fx, fz, dist) {
  let e = -90;
  for (const k of [0.8, 1, 1.25]) { const d = dist * k; e = Math.max(e, Math.atan2(ground(x + fx * d, z + fz * d) - y, d) / D2R); }
  return e;
}

// How far (deg) a painting seen from eye m sinks under its place on the horizon for a viewer at alt m, its massif
// `distance` m away.
export const eyeShift = (alt, eye, distance) => (Number.isFinite(eye) && distance > 0 ? -Math.atan((alt - eye) / distance) / D2R : 0);

// Where a painting sits for a theme.backdrop and an image of w x h px, for a viewer `shift` deg under the eye of the
// painting (eyeShift): { width (rad of azimuth), hy (tan of elevation per image height), yb (tan of the elevation of
// image row `row`), row, bottom (tan at the image's lower edge), top }. Image row pv is at
// tan(elevation) = yb + (row - pv) * hy.
export function paintLayout(B, w, h, shift = 0) {
  const width = B.width * D2R, hy = width / (w / h), yb = Math.tan((B.elevation + shift) * D2R);
  return { width, hy, yb, row: B.row, bottom: yb - (1 - B.row) * hy, top: yb + B.row * hy };
}

// Image coordinates of a view direction d ({ x, y, z }, any length) for a painting centred on heading (deg):
// { u: 0..1 across the painting (outside: beyond its side edges), pv: 0 top .. 1 bottom (outside: above, below) }.
export function paintUV(L, heading, d) {
  let az = Math.atan2(d.x, -d.z) - heading * D2R;
  az = ((az + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const te = d.y / Math.max(Math.hypot(d.x, d.z), 1e-4);
  return { u: 0.5 + az / L.width, pv: L.row - (te - L.yb) / L.hy };
}

// GLSL of the backdrop, shared by its sphere and the materials that end where it begins (materials.js, water.js). Needs
// cameraPosition (three's built-in uniform) and the uniforms of paintUniforms().
export const PAINT_GLSL = /* glsl */`
  uniform sampler2D tPaint0, tPaintSky0, tPaint1, tPaintSky1;
  uniform vec4 uPaintA0, uPaintB0, uPaintA1, uPaintB1; // A: heading (rad), width (rad), row, yb; B: hy, side fade (u), sky fade, top feather (image heights)
  uniform vec3 uPaintBase0, uPaintBase1;
  uniform vec4 uPaintOn; // painting 0 loaded, painting 1 loaded, cut from, cut to (m)
  uniform vec4 uPaintHaze1; // the same rows and amount for the summit painting (its own composition)
  uniform vec4 uPaintHaze; // base haze rows (from, to: the foot, under which the painting is all mist), amount; the band (tan) under the foot where the far ground turns to mist
  uniform vec2 uPaintCarry; // per painting: painting widths over which its edge sky and base mist carry on past its sides (0: none)
  // One painting in direction d, premultiplied, to be laid over the gradient sky: the image; above it its own sky
  // (each column's, blurred across) fading into the gradient; beyond its side edges (faded over B.y) nothing but its
  // base mist under the foot row, or, with carry C, its edge column's own sky (a vertical gradient, blurred) above
  // that column's ridge row and its base mist under it, fading into that over C painting widths. cov: how much the
  // painting covers this azimuth (0 beyond its sides), solid: how much of it is painted land there (not sky).
  vec4 paintOne(sampler2D tP, sampler2D tS, vec4 A, vec4 B, vec4 Hz, vec3 base, float C, vec3 d, out float cov, out float solid){
    float az = atan(d.x, -d.z) - A.x; az = mod(az + 3.14159265, 6.2831853) - 3.14159265;
    float u = 0.5 + az / A.y, te = d.y / max(length(d.xz), 1e-4), pv = A.z - (te - A.w) / B.x;
    float side = smoothstep(0.0, B.y, u) * smoothstep(0.0, B.y, 1.0 - u);
    float uc = clamp(u, 0.002, 0.998);
    vec4 sk = texture2D(tS, vec2(uc, 0.5)); // rgb: the sky over this column, a: the column's ridge row
    // a column with no sky in the painting (a wall cut by its top edge) dissolves into the sky over its top rows,
    // blurred as it goes (a soft glow into the air, not the streaks of its brush lines drawn out)
    float top = (1.0 - smoothstep(0.0, B.w, pv)) * (1.0 - smoothstep(0.0, 0.03, sk.a));
    vec3 img = texture2D(tP, vec2(uc, 1.0 - clamp(pv, 0.0, 1.0)), 5.0 * top).rgb;
    img = mix(img, sk.rgb, top);
    img = mix(img, base, Hz.z * smoothstep(Hz.x, Hz.y, pv)); // its own base turns to mist
    float under = smoothstep(Hz.y - 0.01, Hz.y + 0.03, pv); // under the foot row only the mist: no painted foreground
    img = mix(img, base, under);
    float a = 1.0 - smoothstep(0.0, B.z, -pv); // above the image its sky fades into the gradient
    float land = smoothstep(sk.a - 0.01, sk.a + 0.01, pv);
    cov = side; solid = side * land;
    vec4 past = vec4(base * under, under);
    if (C > 0.0) {
      float carry = 1.0 - smoothstep(0.0, C, max(-u, u - 1.0));
      vec3 edge = texture2D(tP, vec2(uc, 1.0 - clamp(pv, 0.0, 1.0)), 4.0).rgb;
      past = mix(past, mix(vec4(edge * a, a), vec4(base, 1.0), max(land, under)), carry);
    }
    return mix(past, vec4(img * a, a), side);
  }
  // How much of the backdrop in direction d (horizontal azimuth from the view painting's centre) is the summit's.
  float paintSide(vec3 d){
    if (uPaintOn.y < 0.5) return 0.0;
    return 1.0 - smoothstep(-0.35, 0.35, cos(atan(d.x, -d.z) - uPaintA0.x));
  }
  // The backdrop in direction d, premultiplied (alpha 0: only the gradient sky); cov and solid as in paintOne. Each
  // painting holds its half of the horizon, their mist bands meet half way.
  vec4 paintBg(vec3 d, out float cov, out float solid){
    float c0, s0, c1 = 0.0, s1 = 0.0;
    vec4 p0 = paintOne(tPaint0, tPaintSky0, uPaintA0, uPaintB0, uPaintHaze, uPaintBase0, uPaintCarry.x, d, c0, s0), p1 = vec4(0.0);
    float k = paintSide(d);
    if (k > 0.0) p1 = paintOne(tPaint1, tPaintSky1, uPaintA1, uPaintB1, uPaintHaze1, uPaintBase1, uPaintCarry.y, d, c1, s1);
    cov = mix(c0, c1, k); solid = mix(s0, s1, k);
    return mix(p0, p1, k);
  }
  // The far 3D ground meeting the backdrop (w: world position of the fragment). Toward the far cut distance it turns
  // into the painting's base mist, opaque (no painting shows through it) and without outline (a lowered). Beyond
  // the cut it is not drawn at all (no colour, no depth: no ghost, no outline): the painting stands in for it, as the
  // 3D terrain ends at the mid distance in the cartoon-b mockup. Well under the painting's foot (the far valley floor
  // seen from high up) it stays 3D, in the haze; beyond the paintings' side edges (where they show nothing) it
  // stays too, in the same mist.
  void paintFade(inout vec3 rgb, inout float a, vec3 w){
    if (uPaintOn.x < 0.5) return;
    vec3 d = w - cameraPosition; float hd = length(d.xz);
    float f = smoothstep(uPaintOn.z, uPaintOn.w, hd);
    if (f <= 0.0) return;
    float k = paintSide(d);
    float foot0 = uPaintA0.w - (uPaintHaze.y - uPaintA0.z) * uPaintB0.x, foot1 = uPaintA1.w - (uPaintHaze1.y - uPaintA1.z) * uPaintB1.x;
    float foot = mix(foot0, foot1, k);
    float low = 1.0 - smoothstep(foot - 6.0 * uPaintHaze.w, foot, d.y / max(hd, 1.0)); // well under the foot (a soft band, not a ruled line)
    float cov, solid; vec4 bg = paintBg(d, cov, solid);
    vec3 mist = mix(uPaintBase0, uPaintBase1, k);
    // beyond the cut the painting stands in for it (t 1), except in the band of a side edge, where the 3D ground and
    // the fading painting cross over (t from 0 to 1 across the band: the seam of a panorama, not a ghost over the view)
    float t = hd > uPaintOn.w && low < 0.5 ? cov : 0.0;
    if (t > 0.98) discard;
    // the mist: where the ground meets the painting's foot all of it, mostly near the end of the cut (a thin band:
    // seen from high above, the ground stays 3D down to the painting); on a ridge standing above the foot it comes
    // in all along the cut, as aerial haze, so the ridge reads as a far range where the cut ends it
    float te = d.y / max(hd, 1.0);
    float m = (1.0 - smoothstep(0.5, 1.0, low)) * mix(f * f, f * 0.9, smoothstep(foot, foot + 4.0 * uPaintHaze.w, te));
    rgb = mix(rgb, mist, m); a *= 1.0 - m;
    rgb = mix(rgb, bg.rgb + (1.0 - bg.a) * mist, t); a *= 1.0 - t;
  }`;

const blank = () => { const t = new THREE.DataTexture(new Uint8Array([200, 190, 200, 255]), 1, 1); t.needsUpdate = true; return t; };

// The placement of painting k (0 the view, 1 the summit) of a theme.backdrop: the summit painting has its own
// composition, so backdrop.summitAt may give it its own row, elevation, width and baseHaze.
export const placement = (B, k) => (k && B.summitAt ? { ...B, ...B.summitAt } : B);

// The uniform objects of PAINT_GLSL (shared by every material that includes it; createPaint fills them).
export function paintUniforms(theme) {
  const B = theme.backdrop;
  return {
    tPaint0: { value: blank() }, tPaintSky0: { value: blank() }, tPaint1: { value: blank() }, tPaintSky1: { value: blank() },
    uPaintA0: { value: new THREE.Vector4(0, 1, B.row, 0) }, uPaintB0: { value: new THREE.Vector4(1, 0.1, B.skyFade, B.topFeather) },
    uPaintA1: { value: new THREE.Vector4(Math.PI, 1, B.row, 0) }, uPaintB1: { value: new THREE.Vector4(1, 0.1, B.skyFade, B.topFeather) },
    uPaintBase0: { value: new THREE.Color(theme.fog.color) }, uPaintBase1: { value: new THREE.Color(theme.fog.color) },
    uPaintOn: { value: new THREE.Vector4(0, 0, B.cut[0], B.cut[1]) },
    uPaintHaze: { value: new THREE.Vector4(B.baseHaze[0], B.baseHaze[1], B.baseHaze[2], B.below) },
    uPaintHaze1: { value: new THREE.Vector4(...(placement(B, 1).baseHaze), 0) },
    uPaintCarry: { value: new THREE.Vector2(B.carry || 0, placement(B, 1).carry || 0) },
  };
}

// The sky extension and the base mist of a loaded image, from a small copy (B.sample px). Sky: per column the
// colour of its top rows, blurred widely across the columns that have sky there (a wall reaching the top edge takes
// its neighbours' sky); alpha = the column's ridge row (0..1: the first sharp darkening going down, the ink outline
// of the rock; 0 where the column has no sky at all). Base mist: the mean colour of the farthest painted land, just
// under the ridge line (the painter's own aerial haze), half way to the lowest sky: the air the 3D ground and the
// painting's foot dissolve into, which reads as distance in front of a snowfield as well as a meadow.
// Returns { sky: DataTexture, base: Color }.
export function skyExtension(image, B) {
  const [SW, SH] = B.sample, cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(image, 0, 0, SW, SH);
  const px = cx.getImageData(0, 0, SW, SH).data;
  const { sky, base } = extendSky(px, SW, SH, B.baseHaze[1]);
  const tex = new THREE.DataTexture(sky, SW, SH);
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return { sky: tex, base: new THREE.Color().setRGB(base[0] / 255, base[1] / 255, base[2] / 255, THREE.SRGBColorSpace) };
}

// The pixel work of skyExtension on RGBA bytes (w x h): { sky: Uint8Array RGBA, ridge: Int32Array per column,
// base: [r, g, b] 0..255 }.
export function extendSky(px, SW, SH, foot = 0.9) {
  const at = (x, y) => (y * SW + x) * 4;
  // the sky of the top row: the mean of its brightest half (a wall cut by the top edge is darker than the sky);
  // a column whose top pixel is far from it has no sky at all (ridge row 0)
  const tops = Array.from({ length: SW }, (_, x) => { const o = at(x, 0); return [px[o] + px[o + 1] + px[o + 2], o]; }).sort((p, q) => q[0] - p[0]);
  const ref = [0, 0, 0], half = Math.max(1, SW >> 1);
  for (let k = 0; k < half; k++) for (let c = 0; c < 3; c++) ref[c] += px[tops[k][1] + c] / half;
  // sky is smooth: pale rock as light as the sky but drawn with brush strokes and ink lines (a spire cut by the top
  // edge) is not sky, whatever its colour
  const smoothTop = (x) => {
    let v = 0;
    for (let y = 0; y < Math.min(4, SH); y++) for (const dx of [-1, 1]) {
      const a = at(x, y), b = at(clamp(x + dx, 0, SW - 1), y);
      v += Math.abs(px[a] - px[b]) + Math.abs(px[a + 1] - px[b + 1]) + Math.abs(px[a + 2] - px[b + 2]);
    }
    return v < 8 * 24;
  };
  const sil0 = new Int32Array(SW);
  for (let x = 0; x < SW; x++) {
    const o = at(x, 0);
    if (Math.abs(px[o] - ref[0]) + Math.abs(px[o + 1] - ref[1]) + Math.abs(px[o + 2] - ref[2]) > 90 || !smoothTop(x)) { sil0[x] = 0; continue; }
    let r = 1;
    for (; r < SH; r++) {
      const a = at(x, r - 1), b = at(x, r);
      const mnA = Math.min(px[a], px[a + 1], px[a + 2]), mnB = Math.min(px[b], px[b + 1], px[b + 2]);
      if (mnB < mnA - 14 || px[b] + px[b + 1] + px[b + 2] < px[a] + px[a + 1] + px[a + 2] - 40) break;
    }
    sil0[x] = r;
  }
  const sil = new Int32Array(SW);
  for (let x = 0; x < SW; x++) { let m = SH; for (let d = -5; d <= 5; d++) m = Math.min(m, sil0[clamp(x + d, 0, SW - 1)]); sil[x] = Math.max(m - 3, 0); }
  // the lowest painted sky: the mean of the lowest row that is sky in some column (for the base mist)
  const lowest = [0, 0, 0];
  for (let y = 0; y < SH; y++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = 0; x < SW; x++) if (y < sil[x]) { const o = at(x, y); r += px[o]; g += px[o + 1]; b += px[o + 2]; n++; }
    if (n) { lowest[0] = r / n; lowest[1] = g / n; lowest[2] = b / n; }
  }
  // the sky over each column: its top rows where it has sky, blurred across the sky columns (a wide Gaussian, so
  // neither the brush texture nor a wall cut by the top edge leaves a vertical streak); a column with no sky takes
  // its neighbours'. Every row of the texture is the same.
  const top = new Float32Array(SW * 3), isSky = new Uint8Array(SW), mean = [0, 0, 0];
  let ns = 0;
  for (let x = 0; x < SW; x++) {
    const rows = Math.min(4, sil0[x]);
    if (rows < 1) continue;
    isSky[x] = 1; ns++;
    for (let y = 0; y < rows; y++) { const o = at(x, y); for (let k = 0; k < 3; k++) top[x * 3 + k] += px[o + k] / rows; }
    for (let k = 0; k < 3; k++) mean[k] += top[x * 3 + k];
  }
  if (ns) for (let k = 0; k < 3; k++) mean[k] /= ns;
  else { const o = at(SW >> 1, 0); for (let k = 0; k < 3; k++) mean[k] = px[o + k]; }
  const sigma = Math.max(2, SW * 0.05), R = Math.ceil(sigma * 2.5), ext = new Uint8Array(SW * SH * 4);
  for (let x = 0; x < SW; x++) {
    const c = [0, 0, 0];
    let wt = 0;
    for (let d = -R; d <= R; d++) {
      const xx = clamp(x + d, 0, SW - 1);
      if (!isSky[xx]) continue;
      const w = Math.exp(-0.5 * (d / sigma) ** 2);
      for (let k = 0; k < 3; k++) c[k] += top[xx * 3 + k] * w;
      wt += w;
    }
    // far from any sky column the mean sky of the painting
    const f = Math.min(1, wt / 0.5);
    for (let k = 0; k < 3; k++) c[k] = (wt ? c[k] / wt : 0) * f + mean[k] * (1 - f);
    for (let y = 0; y < SH; y++) {
      const o = (y * SW + x) * 4;
      for (let k = 0; k < 3; k++) ext[o + k] = Math.round(c[k]);
      ext[o + 3] = Math.round((255 * sil0[x]) / SH); // the ridge row of this column: land under it (paintOne solid)
    }
  }
  // the base mist: the farthest painted land (a few rows under the ridge line, where the painter's own aerial haze is
  // strongest), half way to the lowest sky; without a ridge line, the painting's foot (rows around `foot`)
  let r = 0, g = 0, b = 0, n = 0;
  for (let x = Math.floor(SW * 0.2); x < SW * 0.8; x++) {
    if (sil0[x] < 1 || sil0[x] + 7 >= SH * foot) continue;
    for (let y = sil0[x] + 2; y < sil0[x] + 7; y++) { const o = at(x, y); r += px[o]; g += px[o + 1]; b += px[o + 2]; n++; }
  }
  if (n < SW) {
    r = g = b = n = 0;
    const y0 = clamp(Math.floor(SH * (foot - 0.04)), 0, SH - 1), y1 = clamp(Math.ceil(SH * (foot + 0.04)), y0 + 1, SH);
    for (let y = y0; y < y1; y++) for (let x = Math.floor(SW * 0.25); x < SW * 0.75; x++) { const o = at(x, y); r += px[o]; g += px[o + 1]; b += px[o + 2]; n++; }
  }
  const base = [r / n, g / n, b / n].map((v, k) => v + (lowest[k] - v) / 2);
  return { sky: ext, ridge: sil0, base };
}

// The list of painting files that exist (assets/backdrops/index.json, written by build.mjs and served by the
// debug server), so a missing summit painting is skipped without a 404. Without the list only the view is loaded.
async function available(base) {
  try {
    const res = await fetch(`${base}index.json`);
    if (res.ok) return new Set((await res.json()).files || []);
  } catch { /* no list */ }
  return null;
}

// The backdrop of a theme. uniforms: paintUniforms() (shared with the materials); opts.base: URL of the folder;
// opts.renderer: for the anisotropy; opts.onLoad(base mist colour, or null when no painting is shown) whenever the
// view painting changes. Returns { mesh, uniforms, setHeading(deg), setView(...), setBackdrop(B), ready (resolves
// when the paintings asked for last are loaded or given up), loaded }.
// setBackdrop(B): another theme.backdrop (a stage's own, theme.stages[id].backdrop merged over the world's): its
// files and placement; file null shows no painting at all (the gradient sky and the 3D far terrain), summit null
// none behind the start; fallback: backdrop keys used instead when the list of paintings lacks `file`. Images are
// loaded once and kept.
export function createPaint(theme, uniforms, { base = 'assets/backdrops/', renderer = null, onLoad = null } = {}) {
  let B = theme.backdrop;
  const U = uniforms;
  // laid over the gradient sky (premultiplied), with alpha 0 written: no outline on the background (post.js)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, uniforms: U,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.ZeroFactor,
    vertexShader: /* glsl */`varying vec3 vD;
      void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: /* glsl */`varying vec3 vD; ${PAINT_GLSL}
      void main(){ float cov, solid; gl_FragColor = paintBg(normalize(vD), cov, solid); }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -9; mesh.visible = false;
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); mesh.updateMatrixWorld(); };
  const state = { loaded: false, heading: 180, alt: null, deg: 180, gen: 0 };
  const eyes = () => [[B.eye, B.distance], [B.summitEye ?? B.eye, B.summitDistance ?? B.distance]];

  // The viewer's real altitude (m): each painting at its height on the horizon from there. foot (deg, optional): the
  // elevation where the 3D ground ends in the view (footElevation), with az (deg) the view's azimuth: the painting
  // the view faces sinks so its foot sits there (never rises above its own place), so from high above a valley the
  // painted landscape starts where the 3D one ends instead of a band of far 3D ground under it.
  function setView(alt, foot = null, az = null) {
    state.alt = alt;
    const facing = az === null ? -1 : Math.cos((az - state.heading) * D2R) >= 0 ? 0 : 1, E = eyes();
    for (let k = 0; k < 2; k++) {
      let e = placement(B, k).elevation + eyeShift(alt, E[k][0], E[k][1]);
      if (k === facing && Number.isFinite(foot)) e = Math.min(e, Math.max(foot + B.footLift, B.footMin));
      U[`uPaintA${k}`].value.w = Math.tan(e * D2R);
    }
  }

  // the summit painting sits opposite the view, turned by summitOffset (deg) where its real bearing differs
  function setHeading(deg) {
    state.deg = deg;
    state.heading = B.azimuth ?? deg + (B.offset || 0);
    U.uPaintA0.value.x = state.heading * D2R;
    U.uPaintA1.value.x = (state.heading + 180 + (B.summitOffset || 0)) * D2R;
  }

  const loader = new THREE.TextureLoader(), images = new Map(), exts = new Map();
  const load = (file) => {
    if (!images.has(file)) images.set(file, new Promise((res) => loader.load(`${base}${file}`, res, undefined, () => res(null))));
    return images.get(file);
  };
  function install(tex, k) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const Bk = placement(B, k), L = paintLayout(Bk, tex.image.width, tex.image.height), key = `${k} ${tex.uuid} ${Bk.baseHaze[1]}`;
    if (!exts.has(key)) exts.set(key, skyExtension(tex.image, Bk));
    const ext = exts.get(key);
    U[`tPaint${k}`].value = tex; U[`tPaintSky${k}`].value = ext.sky;
    U[`uPaintA${k}`].value.set(U[`uPaintA${k}`].value.x, L.width, L.row, L.yb);
    U[`uPaintB${k}`].value.set(L.hy, Math.min(B.edge, B.width * 0.15) * D2R / L.width, B.skyFade, B.topFeather);
    // the base mist: the painting's own (skyExtension), or the theme's where the painting's foot reads wrong as air
    const mist = Bk.mist ? new THREE.Color(Bk.mist) : ext.base;
    U[`uPaintBase${k}`].value.copy(mist);
    return mist;
  }
  function setBackdrop(next) {
    B = next; const gen = ++state.gen;
    U.uPaintHaze.value.set(B.baseHaze[0], B.baseHaze[1], B.baseHaze[2], B.below);
    U.uPaintHaze1.value.set(...placement(B, 1).baseHaze, 0);
    U.uPaintCarry.value.set(B.carry || 0, placement(B, 1).carry || 0);
    U.uPaintOn.value.z = B.cut[0]; U.uPaintOn.value.w = B.cut[1];
    setHeading(state.deg);
    if (state.alt !== null) setView(state.alt);
    const off = () => { U.uPaintOn.value.x = 0; U.uPaintOn.value.y = 0; mesh.visible = false; state.loaded = false; onLoad?.(null); return false; };
    if (!B.file || typeof document === 'undefined') return (ready = Promise.resolve(off()));
    const b = B; // B may be replaced by a later call while the list loads: this call loads its own files
    return (ready = (async () => {
      const have = await available(base);
      if (gen !== state.gen) return ready; // superseded by a later call: that one decides
      // a stage's own painting that is not there yet: its `fallback` backdrop instead (the world's view, placed as such)
      if (have && !have.has(b.file) && b.fallback) return setBackdrop({ ...b, ...b.fallback, fallback: null });
      const [view, summit] = await Promise.all([load(b.file), b.summit && have?.has(b.summit) ? load(b.summit) : null]);
      if (gen !== state.gen) return ready;
      if (!view) return off();
      const mist = install(view, 0);
      if (summit) install(summit, 1);
      U.uPaintOn.value.x = 1; U.uPaintOn.value.y = summit ? 1 : 0;
      mesh.visible = true; state.loaded = true;
      onLoad?.(mist);
      return true;
    })());
  }
  let ready = null;
  setHeading(state.heading);
  setBackdrop(B);
  return { mesh, uniforms: U, setHeading, setView, setBackdrop, get ready() { return ready; }, get loaded() { return state.loaded; }, get heading() { return state.heading; } };
}
