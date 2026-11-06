// Composite pass: the scene is drawn (both views) into one multisampled linear render target with a depth
// texture, then a full-screen pass adds the thin dark outlines on silhouettes (curvature of the inverse
// depth), the divider between the two halves and the sRGB encoding, into an 8-bit target; a last FXAA pass
// draws that to the canvas, so the outlines (computed from the single-sample resolved depth) are antialiased too.
// Outlines skip the water (the water shader writes alpha 0: no line where the river surface folds over a crest)
// and need a real depth gap in metres, so only object and ridge silhouettes get one, not every slope break.
// Their width scales with the output height (theme.outline.width px at 1080 rows).
import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export function createPost(theme, renderer) {
  const O = theme.outline;
  const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
  target.depthTexture = new THREE.DepthTexture(2, 2);
  target.depthTexture.type = THREE.FloatType;
  // the composite, already sRGB encoded, for the FXAA pass (which wants perceptual values)
  const ldr = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const mat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      tC: { value: target.texture }, tD: { value: target.depthTexture }, uTx: { value: new THREE.Vector2(0.5, 0.5) },
      uNear: { value: theme.camera.near }, uFar: { value: theme.camera.far },
      uLine: { value: O.strength }, uW: { value: O.width }, uTh: { value: new THREE.Vector2(...O.threshold) }, uGap: { value: O.minGap }, uLc: { value: new THREE.Color(O.color) },
      uDiv: { value: 0 }, uDivW: { value: theme.divider.width }, uDivC: { value: new THREE.Color(theme.divider.color) }, uRes: { value: new THREE.Vector2(2, 2) },
      uExposure: { value: theme.exposure }, uEncode: { value: 1 },
    },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */`
      uniform sampler2D tC, tD; uniform vec2 uTx, uTh, uRes; uniform float uNear, uFar, uLine, uW, uGap, uDiv, uDivW, uExposure, uEncode; uniform vec3 uLc, uDivC; varying vec2 vUv;
      float iw(vec2 p){ float d = texture2D(tD, p).x; float z = uNear * uFar / (uFar - d * (uFar - uNear)); return 1.0 / z; }
      void main(){
        vec4 src = texture2D(tC, vUv);
        vec3 c = src.rgb * uExposure;
        vec2 o = uTx * uW;
        float m = iw(vUv);
        float lx = iw(vUv + vec2(o.x, 0.0)) + iw(vUv - vec2(o.x, 0.0)) - 2.0 * m;
        float ly = iw(vUv + vec2(0.0, o.y)) + iw(vUv - vec2(0.0, o.y)) - 2.0 * m;
        float l1 = iw(vUv + o) + iw(vUv - o) - 2.0 * m, l2 = iw(vUv + vec2(o.x, -o.y)) + iw(vUv - vec2(o.x, -o.y)) - 2.0 * m;
        // silhouettes: the neighbours are much farther than this pixel (the near side of a depth step); e is about
        // the relative depth gap, e / m about the gap in metres
        float e = max(max(-lx, -ly), max(-l1, -l2) * 0.7) / m;
        float line = smoothstep(uTh.x, uTh.y, e) * smoothstep(uGap * 0.5, uGap, e / m);
        line *= smoothstep(0.25, 0.6, src.a); // not on the water
        c = mix(c, uLc, line * uLine);
        if (uDiv > 0.5) {
          float px = abs(vUv.x - 0.5) * uRes.x;
          c = mix(c, uDivC, 1.0 - smoothstep(uDivW * 0.5 - 0.75, uDivW * 0.5 + 0.75, px));
        }
        gl_FragColor = vec4(c, 1.0);
        if (uEncode > 0.5) gl_FragColor = sRGBTransferOETF(gl_FragColor);
        else {
          #include <colorspace_fragment>
        }
      }`,
  });
  // FXAA reads the sRGB-encoded composite and writes it to the canvas as is
  const fxaa = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
    vertexShader: QUAD_VS,
    fragmentShader: FXAAShader.fragmentShader,
  });
  fxaa.uniforms.tDiffuse.value = ldr.texture;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera();
  const useFxaa = theme.post?.fxaa !== false;
  function setSize(w, h) {
    target.setSize(w, h);
    ldr.setSize(w, h);
    mat.uniforms.uTx.value.set(1 / w, 1 / h);
    mat.uniforms.uRes.value.set(w, h);
    mat.uniforms.uW.value = Math.max(1, (O.width * h) / 1080);
    fxaa.uniforms.resolution.value.set(1 / w, 1 / h);
  }
  function composite(split) {
    mat.uniforms.uDiv.value = split ? 1 : 0;
    mat.uniforms.uEncode.value = useFxaa ? 1 : 0;
    quad.material = mat;
    renderer.setRenderTarget(useFxaa ? ldr : null);
    renderer.render(scene, cam);
    if (!useFxaa) return;
    quad.material = fxaa;
    renderer.setRenderTarget(null);
    renderer.render(scene, cam);
  }
  return { target, setSize, composite, material: mat };
}
