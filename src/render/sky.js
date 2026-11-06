// Sky dome: a gradient by elevation (lavender overhead, pink, warm peach at the horizon) with a soft
// glow low around the sun's azimuth. Drawn first, without depth, centred on the camera of each view.
import * as THREE from 'three';

// alpha: what it writes in the alpha channel (the race renderer's 0: no outline on the sky, post.js).
export function createSky(theme, sunDir, { alpha = 1 } = {}) {
  const S = theme.sky, n = S.stops.length;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: {
      cols: { value: S.stops.map(([, h]) => new THREE.Color(h)) }, els: { value: S.stops.map(([e]) => e) },
      uSun: { value: new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z) }, uGlow: { value: new THREE.Color(S.glow) },
      uGlowA: { value: S.glowStrength }, uGlowW: { value: S.glowWidth },
    },
    vertexShader: /* glsl */`varying vec3 vD;
      void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: /* glsl */`varying vec3 vD; uniform vec3 cols[${n}]; uniform float els[${n}]; uniform vec3 uSun, uGlow; uniform float uGlowA, uGlowW;
      void main(){
        vec3 d = normalize(vD); float e = degrees(asin(clamp(d.y, -1.0, 1.0))); vec3 c = cols[0];
        for (int i = 1; i < ${n}; i++) c = mix(c, cols[i], smoothstep(els[i - 1], els[i], e));
        vec2 a = normalize(d.xz + 1e-5), s = normalize(uSun.xz + 1e-5);
        float g = acos(clamp(dot(a, s), -1.0, 1.0));
        c = mix(c, uGlow, uGlowA * exp(-g * g / uGlowW) * (1.0 - smoothstep(2.0, 24.0, e)));
        gl_FragColor = vec4(c, ${alpha.toFixed(2)});
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); mesh.updateMatrixWorld(); };
  return mesh;
}

// Recolours a createSky() dome with another theme.sky (a stage's own, under its own painting). The shader keeps its
// number of stops: a sky with another count is left as it was (returns false).
export function setSkyLook(mesh, S) {
  const U = mesh.material.uniforms;
  if (S.stops.length !== U.els.value.length) return false;
  S.stops.forEach(([e, h], i) => { U.els.value[i] = e; U.cols.value[i].set(h); });
  U.uGlow.value.set(S.glow); U.uGlowA.value = S.glowStrength; U.uGlowW.value = S.glowWidth;
  return true;
}
