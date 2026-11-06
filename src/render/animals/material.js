// The animals' toon material family: the renderer's cartoon Lambert (wrapped soft light ramp, altitude
// haze) with vertex colours, a warm soft rim, and the procedural motion in the vertex shader (legs swing
// about the hips, the head pitches and turns about the neck, wings flap about their roots, tails wag),
// driven by per-instance attributes. The thin dark outline is an inverted hull drawn with the same motion,
// a constant width in pixels. One material per species (its pivots are uniforms), one shader program.
import * as THREE from 'three';
import { cartoon, sharedUniforms, FOG_UNIFORMS_GLSL } from '../materials.js';

// aRig (per corner): head weight, leg weight, leg phase (0..1), wing weight (signed by side) or tail weight.
// aAnim (per instance): gait phase (rad), gait amount (0..1), head pitch (-1 up .. 1 down), head yaw (-1..1).
// aAnim2 (per instance): wing flap (-1..1), tail wag (-1..1), unused, unused.
export const ANIMATE_GLSL = /* glsl */`
  attribute vec4 aRig;
  attribute vec4 aAnim;
  attribute vec4 aAnim2;
  uniform vec4 uHead; // pivot y, pivot z, max pitch, max yaw (rad)
  uniform vec4 uLeg;  // hip y, front hip z, back hip z, max swing (rad)
  uniform vec4 uWing; // root |x|, root y, max flap (rad), 0
  uniform vec4 uTail; // pivot y, pivot z, max wag (rad), 0
  uniform vec3 uFar;  // readability at range: extra scale, from (m), to (m) from the camera of this view
  mat3 aRotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 aRotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 aRotZ(float a){ float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
  void animalAnimate(inout vec3 p, inout vec3 n){
    if (aRig.y > 0.0) {
      float a = sin(aAnim.x + aRig.z * 6.2831853) * aAnim.y * uLeg.w * aRig.y;
      vec3 piv = vec3(p.x, uLeg.x, p.z > 0.5 * (uLeg.y + uLeg.z) ? uLeg.y : uLeg.z);
      mat3 R = aRotX(a); p = piv + R * (p - piv); n = R * n;
    }
    if (aRig.x > 0.0) {
      vec3 piv = vec3(0.0, uHead.x, uHead.y);
      mat3 R = aRotY(aAnim.w * uHead.w * aRig.x) * aRotX(aAnim.z * uHead.z * aRig.x);
      p = piv + R * (p - piv); n = R * n;
    }
    #ifdef ANIMAL_WINGS
    if (aRig.w != 0.0) {
      float side = p.x < 0.0 ? -1.0 : 1.0;
      vec3 piv = vec3(side * uWing.x, uWing.y, p.z);
      mat3 R = aRotZ(side * aAnim2.x * uWing.z * abs(aRig.w)); p = piv + R * (p - piv); n = R * n;
    }
    #else
    if (aRig.w > 0.0) {
      vec3 piv = vec3(0.0, uTail.x, uTail.y);
      mat3 R = aRotY(aAnim2.y * uTail.z * aRig.w); p = piv + R * (p - piv); n = R * n;
    }
    #endif
  }
  // An animal far from this view's camera is drawn up to 1 + uFar.x times its size, about its feet, so its
  // silhouette still reads 50 m up the bank; near the drop (drinking) it is its own size.
  float animalFar(){
    #ifdef USE_INSTANCING
      vec3 o = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #else
      vec3 o = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #endif
    return 1.0 + uFar.x * smoothstep(uFar.y, uFar.z, distance(o, cameraPosition));
  }`;

// far: [extra scale, from m, to m] of the readability at range (theme.animals.far, 0 to switch it off)
function rigUniforms(pivots, far = [0, 1, 2]) {
  const P = { head: [0, 0, 0, 0], leg: [0, 0, 0, 0], wing: [0, 0, 0, 0], tail: [0, 0, 0, 0], ...pivots };
  return {
    uHead: { value: new THREE.Vector4(...P.head) }, uLeg: { value: new THREE.Vector4(...P.leg) },
    uWing: { value: new THREE.Vector4(...P.wing) }, uTail: { value: new THREE.Vector4(...P.tail) },
    uFar: { value: new THREE.Vector3(...far) },
  };
}
// The default readability at range: 1.6 times the size from 60 m on, growing from 20 m.
export const FAR = [0.6, 20, 60];
const farOf = (theme) => (theme.animals?.far ?? FAR) || [0, 1, 2];

function patchVertex(sh) {
  sh.vertexShader = `${ANIMATE_GLSL}\n${sh.vertexShader}`
    .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vec3 aP = position; animalAnimate(aP, objectNormal); aP *= animalFar();')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed = aP;');
}

// shared: the renderer's sharedUniforms(theme) objects, so haze and light ramp match the world.
export function animalMaterial(theme, shared, pivots, { wings = false } = {}) {
  const sh0 = shared || sharedUniforms(theme);
  const m = cartoon(new THREE.MeshLambertMaterial({ vertexColors: true }), sh0);
  const base = m.onBeforeCompile, rig = rigUniforms(pivots, farOf(theme));
  const A = theme.animals || {};
  const rim = { uRim: { value: new THREE.Color(A.rim || '#ffd6a0') }, uRimK: { value: new THREE.Vector2(A.rimStrength ?? 0.35, A.rimPower ?? 2.6) } };
  m.onBeforeCompile = (sh, r) => {
    base(sh, r);
    if (wings) sh.defines = { ...sh.defines, ANIMAL_WINGS: '' };
    Object.assign(sh.uniforms, rig, rim);
    patchVertex(sh);
    sh.fragmentShader = `uniform vec3 uRim; uniform vec2 uRimK;\n${sh.fragmentShader}`.replace('#include <opaque_fragment>', /* glsl */`
      { float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), uRimK.y); outgoingLight += uRim * rimF * uRimK.x; }
      #include <opaque_fragment>`);
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `${key()}|animal${wings ? ':wings' : ''}`;
  m.userData.rig = rig;
  return m;
}

// Shadow casting with the same motion.
export function animalDepthMaterial(pivots, { wings = false } = {}) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const rig = rigUniforms(pivots);
  m.onBeforeCompile = (sh) => {
    if (wings) sh.defines = { ...sh.defines, ANIMAL_WINGS: '' };
    Object.assign(sh.uniforms, rig);
    sh.vertexShader = `${ANIMATE_GLSL}\n${sh.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\n { vec3 nn = vec3(0.0, 1.0, 0.0); animalAnimate(transformed, nn); }');
  };
  m.customProgramCacheKey = () => `animal-depth${wings ? ':wings' : ''}`;
  return m;
}

// Inverted hull: back faces pushed out along the smooth normal by a constant pixel width.
export function animalOutlineMaterial(theme, shared, pivots, { wings = false } = {}) {
  const sh0 = shared || sharedUniforms(theme);
  const O = theme.outline || {}, A = theme.animals || {};
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    defines: wings ? { ANIMAL_WINGS: '' } : {},
    uniforms: {
      ...rigUniforms(pivots, farOf(theme)), ...sh0.fog,
      uColor: { value: new THREE.Color(A.outline || O.color || '#2e2630') },
      uWidth: { value: A.outlineWidth ?? 1.4 }, // px
      uDepth: { value: 0.02 }, // m the hull sits behind the surface, so it never shows through creases
      uResolution: { value: new THREE.Vector2(1920, 1080) },
    },
    vertexShader: /* glsl */`
      ${ANIMATE_GLSL}
      attribute vec3 aHull;
      uniform float uWidth, uDepth; uniform vec2 uResolution;
      varying vec3 vW; varying float vDist;
      void main(){
        vec3 p = position, n = aHull;
        animalAnimate(p, n);
        p *= animalFar();
        mat4 M = modelMatrix;
        #ifdef USE_INSTANCING
          M = modelMatrix * instanceMatrix;
        #endif
        vec4 w = M * vec4(p, 1.0); vW = w.xyz;
        vec4 mv = viewMatrix * w; mv.xyz += normalize(mv.xyz) * uDepth;
        vec4 c = projectionMatrix * mv;
        vec4 cn = projectionMatrix * viewMatrix * vec4(normalize(mat3(M) * n), 0.0);
        vec2 d = cn.xy; float l = length(d);
        if (l > 1e-5) c.xy += d / l * uWidth * 2.0 / uResolution * c.w;
        vDist = length(mv.xyz);
        gl_Position = c;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying vec3 vW; varying float vDist;
      ${FOG_UNIFORMS_GLSL}
      void main(){
        gl_FragColor = vec4(applyFog(uColor, vDist, vW.y), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
