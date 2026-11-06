// The stream: one water ribbon per path (course and branches), following the densified centre line at
// bed + water.depth. Each row finds where the drawn ground rises above the water on both sides, so the
// sheet ends on the real banks (smoothed along the stream into flowing curves) and the shader knows the
// distance to the waterline for the edge foam. Turquoise with soft drifting patches, white foam bands
// along the banks and around rocks, streaks on rapids, white water on waterfalls and below them.
import * as THREE from 'three';
import { smooth } from './math.js';
import { FOG_UNIFORMS_GLSL } from './materials.js';
import { PAINT_GLSL } from './paint.js';

const MAX_ROCKS = 24;

// Plain arrays for one path. ground(x, z): drawn ground height. rocks: [{x, z, r}] in the same frame.
// covered(x, z): true where another sheet already holds the water (a branch inside the main channel near the
// fork), those vertices get mask 1 and the shader drops them.
export function buildRibbon(path, ground, theme, rocks = [], covered = null) {
  const W = theme.water, n = path.n, cols = W.columns;
  const edge = [new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) {
    const wy = path.y[i] + W.depth, rx = -path.tz[i], rz = path.tx[i], hw = path.hw[i];
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      // the sheet stops at the bed width even where the meadow is barely above the water (no flooding)
      const cap = W.maxWidth * hw;
      let prevT = 0.25 * hw, prevH = ground(path.x[i] + rx * prevT * sg, path.z[i] + rz * prevT * sg) - wy, found = cap;
      for (let t = prevT + 0.5; t <= cap; t += 0.5) {
        const hgt = ground(path.x[i] + rx * t * sg, path.z[i] + rz * t * sg) - wy;
        if (hgt > 0) { found = prevH < 0 ? prevT + (t - prevT) * (-prevH / (hgt - prevH)) : t; break; }
        prevT = t; prevH = hgt;
      }
      edge[side][i] = found;
    }
  }
  // the 4 m grid makes the waterline wobble: smooth it along the stream into a flowing curve
  for (const e of edge) {
    const src = Float64Array.from(e), R = 6;
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) { s += src[j]; c++; }
      e[i] = Math.min(s / c, W.maxWidth * path.hw[i]);
    }
  }
  const slope = new Float64Array(n), white = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2), ds = path.s[b] - path.s[a] || 1;
    slope[i] = Math.max(0, path.y[a] - path.y[b]) / ds;
  }
  // white water below steep drops (fading over 25 m downstream) and on the lip just before them
  for (let i = 0; i < n; i++) {
    let wmax = 0;
    for (let j = i; j >= 0 && path.s[i] - path.s[j] < 25; j--) wmax = Math.max(wmax, smooth(0.5, 1.0, slope[j]) * (1 - (path.s[i] - path.s[j]) / 25));
    for (let j = i; j < n && path.s[j] - path.s[i] < 8; j++) wmax = Math.max(wmax, smooth(0.12, 0.3, slope[j] - slope[i]) * 0.85);
    white[i] = wmax;
  }
  // stream coordinates of the rocks (s along, t across)
  const rk = [];
  for (const r of rocks) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = (path.x[i] - r.x) ** 2 + (path.z[i] - r.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    if (Math.sqrt(bd) > path.hw[bi] * 1.6) continue;
    rk.push(path.s[bi], (r.x - path.x[bi]) * -path.tz[bi] + (r.z - path.z[bi]) * path.tx[bi], r.r);
    if (rk.length / 3 >= MAX_ROCKS) break;
  }
  // columns: denser toward both banks
  const F = [];
  for (let c = 0; c < cols; c++) { const u = (c / (cols - 1)) * 2 - 1; F.push(Math.sign(u) * Math.pow(Math.abs(u), 0.7)); }
  const P = new Float32Array(n * cols * 3), A = new Float32Array(n * cols * 4), S = new Float32Array(n * cols * 2), K = new Float32Array(n * cols);
  for (let i = 0; i < n; i++) {
    const wy = path.y[i] + W.depth, rx = -path.tz[i], rz = path.tx[i];
    const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3);
    const bend = (path.tx[a] * path.tz[b] - path.tz[a] * path.tx[b]) / Math.max(path.s[b] - path.s[a], 1); // signed curvature, + turns right
    for (let c = 0; c < cols; c++) {
      const f = F[c], side = f < 0 ? 0 : 1, e = edge[side][i], t = f * (e + W.overlap), k = i * cols + c;
      // the outer columns curl down into the bank, so the waterline is a smooth curve at the computed edge
      // instead of the jagged cut of a flat sheet through the terrain triangles
      const curl = Math.abs(f) === 1 ? W.curl : 0;
      P[k * 3] = path.x[i] + rx * t; P[k * 3 + 1] = wy - curl; P[k * 3 + 2] = path.z[i] + rz * t;
      A[k * 4] = path.s[i]; A[k * 4 + 1] = t; A[k * 4 + 2] = e - Math.abs(t); A[k * 4 + 3] = side ? bend : -bend;
      S[k * 2] = slope[i]; S[k * 2 + 1] = white[i];
      if (covered && covered(P[k * 3], P[k * 3 + 2])) K[k] = 1;
    }
  }
  const idx = new Uint32Array((n - 1) * (cols - 1) * 6);
  let q = 0;
  for (let i = 0; i < n - 1; i++) for (let c = 0; c < cols - 1; c++) {
    const a = i * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = e; idx[q++] = d;
  }
  return { position: P, stream: A, slope: S, mask: K, index: idx, rocks: rk, edge };
}

// The earth banks: one opaque band of constant width draped on the drawn ground along each (smoothed) waterline,
// from just under the water up the bank, in flat tones as in the reference: a dark wet foot, the warm lit earth
// (darker on the right bank), and a thin dark line along its top edge. ground(x, z): the drawn surface (terrain
// surfaceAt, the triangles as drawn, so the band covers them instead of being pierced). edge: buildRibbon().edge.
// Colours are RGB (opaque: nothing shows through, and the band writes depth).
// covered(x, z): true inside another sheet (a branch's banks inside the main channel at the forks), where no quad
// of the band is made: it would lie across the main water as a grey bar.
export function buildBanks(path, ground, edge, theme, colors, covered = null) {
  const W = theme.water, B = theme.terrain.bankBand, n = path.n;
  // [m from the waterline, outward; tone: 0 wet, 1 earth, 2 line]; pairs at the same distance give hard edges
  // (dense across, so the band's chords stay on the 4 m terrain triangles it is draped on)
  const cols = [[-0.8, 0], [-0.3, 0], [0, 0], [B.wet * 0.5, 0], [B.wet, 0], [B.wet, 1]];
  for (let q = 1; q <= 4; q++) cols.push([B.wet + ((B.width - B.wet) * q) / 4, 1]);
  cols.push([B.width, 2], [B.width + B.line, 2]);
  const nc = cols.length;
  const P = new Float32Array(n * 2 * nc * 3), N = new Float32Array(P.length), C = new Float32Array(P.length);
  const idx = [], under = covered ? new Uint8Array(n * 2 * nc) : null;
  let v = 0;
  for (let side = 0; side < 2; side++) {
    const sg = side ? 1 : -1, base = side ? colors.bankD : colors.bank;
    const tone = [base.map((x) => x * B.wetTone), base, base.map((x) => x * B.lineTone)];
    for (let i = 0; i < n; i++) {
      const rx = -path.tz[i] * sg, rz = path.tx[i] * sg, wy = path.y[i] + W.depth;
      for (let c = 0; c < nc; c++) {
        const t = edge[side][i] + cols[c][0];
        const x = path.x[i] + rx * t, z = path.z[i] + rz * t;
        // the foot under the sheet, the rest on the ground and never under the water line
        // (the top edge comes down onto the ground, so the lift does not show as a step)
        const y = c === 0 ? wy - 0.35 : Math.max(ground(x, z), wy + 0.02) + (c === nc - 1 ? 0.02 : B.lift);
        P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
        if (under && covered(x, z)) under[v] = 1;
        const e = 1.5, gx = ground(x + e, z) - ground(x - e, z), gz = ground(x, z + e) - ground(x, z - e), L = Math.hypot(gx, 2 * e, gz);
        N[v * 3] = -gx / L; N[v * 3 + 1] = (2 * e) / L; N[v * 3 + 2] = -gz / L;
        const col = tone[cols[c][1]];
        C[v * 3] = col[0]; C[v * 3 + 1] = col[1]; C[v * 3 + 2] = col[2];
        v++;
      }
    }
  }
  for (let side = 0; side < 2; side++) for (let i = 0; i < n - 1; i++) for (let c = 0; c < nc - 1; c++) {
    if (cols[c][0] === cols[c + 1][0]) continue; // a hard tone edge: no quad of zero width
    const a = (side * n + i) * nc + c, b = a + 1, d = a + nc, e = d + 1;
    if (under && (under[a] || under[b] || under[d] || under[e])) continue;
    if (side) idx.push(a, b, d, b, e, d); else idx.push(a, d, b, b, d, e); // counter-clockwise seen from above
  }
  return { position: P, normal: N, color: C, index: Uint32Array.from(idx) };
}

export function waterMaterial(theme, shared) {
  const W = theme.water, col = (h) => new THREE.Color(h);
  const rocks = Array.from({ length: MAX_ROCKS }, () => new THREE.Vector3(-1e6, 0, 0));
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared.fog, ...shared.paint, uTime: shared.time,
      cDeep: { value: col(W.deep) }, cBase: { value: col(W.base) }, cLight: { value: col(W.light) }, cFar: { value: col(W.far) }, cFoam: { value: col(W.foam) },
      cBed: { value: col(theme.terrain.bed) }, // the bed seen through the shallows by the banks
      uFlow: { value: W.flow }, uPatch: { value: new THREE.Vector2(...W.patch) }, uFacet: { value: new THREE.Vector2(...W.facet) }, uFacetTone: { value: W.facetTone },
      uFoamEdge: { value: new THREE.Vector2(...W.foamEdge) }, uFoamBend: { value: W.foamBend }, uRapid: { value: new THREE.Vector2(...W.rapidSlope) },
      uFall: { value: W.waterfallSlope }, uRockFoam: { value: W.rockFoam }, uRocks: { value: rocks },
      // water.stones { size m, amount in the shallows, clear: amount across the sheet, reach m of the shallows } (null: none)
      uStones: { value: new THREE.Vector4(...(W.stones ? [W.stones.size, W.stones.amount, W.stones.clear ?? 0, W.stones.reach ?? 2.4] : [0, 0, 0, 1])) },
    },
    vertexShader: /* glsl */`
      attribute vec4 stream; attribute vec2 slope; attribute float mask;
      varying vec4 vS; varying vec2 vSl; varying vec3 vW; varying float vFogDepth; varying float vMask;
      void main(){ vS = stream; vSl = slope; vMask = mask; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mv = viewMatrix * w; vFogDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      ${FOG_UNIFORMS_GLSL}
      ${PAINT_GLSL}
      uniform float uTime, uFlow, uFacetTone, uFoamBend, uFall, uRockFoam; uniform vec2 uPatch, uFacet, uFoamEdge, uRapid;
      uniform vec3 cDeep, cBase, cLight, cFar, cFoam, cBed; uniform vec3 uRocks[${MAX_ROCKS}]; uniform vec4 uStones;
      varying vec4 vS; varying vec2 vSl; varying vec3 vW; varying float vFogDepth; varying float vMask;
      float h12(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      // step(edge, v) antialiased over a pixel; once v changes by more than ~half its range per pixel the mask is
      // blended toward its average instead of aliasing
      float aaStep(float edge, float v){ float w = max(fwidth(v), 1e-4); return mix(smoothstep(edge - w, edge + w, v), 1.0 - edge, smoothstep(0.15, 0.45, w)); }
      // the same for a distance in metres (no fading): a line one pixel soft
      float aaEdge(float edge, float v){ float w = max(fwidth(v) * 0.75, 1e-4); return smoothstep(edge - w, edge + w, v); }
      float n12(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
      vec2 tri(vec2 p){ float s = (p.x + p.y) * 0.3660254; vec2 i = floor(p + s); vec2 f = p - i + (i.x + i.y) * 0.2113249;
        return vec2(h12(i * 1.37 + (f.x > f.y ? 0.0 : 17.1)), h12(i * 2.11 + (f.x > f.y ? 3.0 : 9.7))); }
      void main(){
        if (vMask > 0.5) discard;
        float s = vS.x, t = vS.y, e = vS.z, bend = vS.w, side = t < 0.0 ? 0.0 : 1.0, sl = vSl.x, wh = vSl.y;
        float d = vFogDepth;
        float sf = s - uTime * uFlow * (1.0 + 6.0 * sl);          // patterns drift downstream, faster on the steep
        float p = n12(vec2(sf / uPatch.x, t / uPatch.y)) * 0.65 + n12(vec2(sf / (uPatch.x * 0.37) + 7.0, t / (uPatch.y * 0.5))) * 0.35;
        vec3 c = mix(mix(cDeep, cLight, smoothstep(0.2, 0.85, p)), cBase, 0.3);
        vec2 h = tri(vec2(sf / uFacet.x, t / uFacet.y));
        c *= 1.0 + uFacetTone * (h.x < 0.34 ? -1.0 : (h.x < 0.68 ? 0.0 : 1.0)) * (1.0 - smoothstep(50.0, 110.0, d));
        c = mix(c, cFar, smoothstep(25.0, 160.0, d) * 0.5);
        c = mix(c, cLight, smoothstep(0.55, 1.0, abs(t) / (abs(t) + max(e, 0.0) + 0.01)) * 0.25);
        // the shallows: the pale bed shows through the clear water over the last metre or two to the bank
        c = mix(c, cBed, 0.4 * (1.0 - smoothstep(0.15, 1.8, e)) * (1.0 - smoothstep(60.0, 140.0, d)));
        if (uStones.x > 0.0) {
          // water.stones: the stony bed through clear water, rounded pebbles of about size m (longer along the flow,
          // each its own size and tone) on the gravel, strongest in the shallows by the banks, fainter across the
          // sheet; fixed to the bed (the surface patterns drift over them), gone farther off than they can be told apart
          vec2 q = vec2(s / (uStones.x * 1.4), t / uStones.x), qi = floor(q), qf = fract(q);
          float peb = 0.0, id = 0.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j)), o = vec2(h12(qi + g), h12(qi + g + 31.7)) * 0.7 + 0.15;
            float rad = 0.22 + 0.26 * h12(qi + g + 3.1), dd = length(g + o - qf);
            float inside = 1.0 - aaEdge(rad, dd);
            if (inside > peb) { peb = inside; id = h12(qi + g + 7.3); }
          }
          vec3 stone = cBed * mix(0.86, 0.66 + 0.5 * id, peb); // lighter and darker stones than the gravel
          c = mix(c, stone, mix(uStones.z, uStones.y, 1.0 - smoothstep(0.15, uStones.w, e)) * (1.0 - smoothstep(22.0, 65.0, d)));
        }
        float rapid = smoothstep(uRapid.x, uRapid.y, sl);
        // edge foam: white ribbons along the banks in broken stretches (calm water between them), always on the outside
        // of bends and on the rapids, whose width flows with the stream; a thinner broken ribbon just off them
        float cl = n12(vec2(sf * 0.12, side * 13.0)) * 0.7 + n12(vec2(sf * 0.33, side * 5.0)) * 0.3;
        float bk = clamp(max(bend, 0.0) * 40.0, 0.0, 1.0);
        float pres = clamp(smoothstep(0.42, 0.68, n12(vec2(sf * 0.045, side * 17.0 + 3.0))) + bk * 1.2 + rapid * 0.6, 0.0, 1.0);
        float w0 = mix(uFoamEdge.x, uFoamEdge.y, smoothstep(0.3, 0.78, cl)) * (1.0 + uFoamBend * bk) * pres;
        float foam = (1.0 - aaEdge(w0, e)) * smoothstep(0.05, 0.3, pres);
        float w1 = w0 + 0.45 + 0.5 * n12(vec2(sf * 0.08, side * 7.0 + 2.0));
        float rib = aaEdge(w1, e) * (1.0 - aaEdge(w1 + 0.32, e)) * aaStep(0.45, n12(vec2(sf * 0.11, side * 3.0 + 9.0))) * smoothstep(0.5, 0.9, pres);
        foam = max(foam, rib);
        // around the rocks, with a short wake downstream
        for (int i = 0; i < ${MAX_ROCKS}; i++) {
          vec3 r = uRocks[i]; float ds = s - r.x; ds *= ds > 0.0 ? 0.3 : 0.9;
          float dd = length(vec2(ds, t - r.y)) - r.z;
          foam = max(foam, 1.0 - smoothstep(0.0, uRockFoam * (0.5 + 0.8 * n12(vec2(sf * 0.8, t * 1.2 + float(i)))), dd));
        }
        // rapids: a few thin, short white streaks along the flow (never bars across the sheet), half transparent, broken
        // white water in pools below the falls; antialiased, and faded to their average where they get thinner than
        // a couple of pixels, so they do not crawl as the camera moves
        float rs = n12(vec2(t * 1.5 + 11.0, sf / 13.0)) * 0.75 + n12(vec2(t * 2.6, sf / 6.0)) * 0.25;
        float st = aaStep(0.78 - 0.05 * rapid, rs) * rapid * (1.0 - 0.75 * smoothstep(35.0, 90.0, d)); // seen edge-on far off, they would hatch
        float wp = n12(vec2(t * 0.9 + 4.0, sf * 0.07)) * 0.7 + n12(vec2(t * 2.0, sf * 0.2)) * 0.3;
        float wpool = aaStep(1.0 - 0.32 * wh, wp) * smoothstep(0.05, 0.3, wh);
        foam = max(foam, max(st * 0.55, wpool * 0.85));
        // waterfall: white curtains with blue between them, not a white sheet
        float fall = smoothstep(uFall * 0.7, uFall, sl);
        float curtain = aaStep(0.5, n12(vec2(t * 1.4, sf * 0.07)) * 0.8 + n12(vec2(t * 3.1, sf * 0.15)) * 0.2);
        c = mix(c, cLight, fall * 0.35);
        foam = max(foam, fall * curtain * 0.95);
        c = mix(c, cFoam, clamp(foam, 0.0, 1.0));
        // far off it ends where the ground does (paint.js); alpha 0 marks water for the outline pass (no line where the
        // river surface folds over a crest)
        c = applyFog(c, d, vW.y);
        float wa = 1.0;
        paintFade(c, wa, vW);
        gl_FragColor = vec4(c, 0.0);
      }`,
  });
}

export function setRibbonRocks(material, rk) {
  const u = material.uniforms.uRocks.value;
  for (let i = 0; i < u.length; i++) {
    if (i * 3 < rk.length) u[i].set(rk[i * 3], rk[i * 3 + 1], rk[i * 3 + 2]);
    else u[i].set(-1e6, 0, 0);
  }
}

export const WATER_MAX_ROCKS = MAX_ROCKS;
