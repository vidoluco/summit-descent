// The cartoon look on top of three.js MeshLambertMaterial (so shadows, instancing, vertex and instance
// colours keep working): a soft wrapped light ramp instead of the hard Lambert terminator, a light
// low-poly hint (world-space triangle facets that tilt the normal and the tone a little), and an
// exponential haze that thins with real altitude, and the ground covers (rock, snow, glacier ice) drawn from
// per-vertex weights as patches with crisp painted edges. Every patched material reads the same uniform
// objects, so the theme and the stage offset are set once for the whole scene. Far away they end where the
// painted backdrop begins, through its base mist (paint.js paintFade).
import * as THREE from 'three';
import { PAINT_GLSL, paintUniforms } from './paint.js';

// GLSL for the haze, shared with the hand-written water and sky shaders.
export const FOG_UNIFORMS_GLSL = /* glsl */`
  uniform vec3 uFogColor; uniform float uFogDensity, uFogFalloff, uFogBase, uFogMax, uFogYOffset;
  vec3 applyFog(vec3 c, float dist, float localY){
    float alt = localY + uFogYOffset;
    float f = (1.0 - exp(-uFogDensity * dist)) * exp(-max(alt - uFogBase, 0.0) * uFogFalloff);
    return mix(c, uFogColor, min(f, uFogMax));
  }`;

export function sharedUniforms(theme) {
  const F = theme.fog;
  return {
    fog: {
      uFogColor: { value: new THREE.Color(F.color) }, uFogDensity: { value: F.density }, uFogFalloff: { value: F.heightFalloff },
      uFogBase: { value: F.base }, uFogMax: { value: F.max }, uFogYOffset: { value: 0 },
    },
    wrap: { value: new THREE.Vector2(...theme.sun.wrap) },
    facet: { value: new THREE.Vector3(theme.terrain.facetSize, theme.terrain.facetTilt, theme.terrain.facetTone) },
    time: { value: 0 },
    clip: { value: new THREE.Vector4(1, 1, -1, -1) }, // global xz rectangle the backdrop does not draw
    offset: { value: new THREE.Vector3() }, // stage offset: local -> global
    crease: { value: new THREE.Vector2(theme.terrain.massif.crease, theme.terrain.massif.riser) }, // massif line work: darkness, ledge edge
    paint: paintUniforms(theme), // the painted backdrop (paint.js), filled once its images are loaded
    // the cover colours (terrain.rock, rockB, snow, ice, iceD) and their patch noise: m per noise cell, edge softness
    cover: {
      uCoverRock: { value: new THREE.Color(theme.terrain.rock) }, uCoverRockB: { value: new THREE.Color(theme.terrain.rockB) },
      uCoverSnow: { value: new THREE.Color(theme.terrain.snow) }, uCoverIce: { value: new THREE.Color(theme.terrain.ice) },
      uCoverIceD: { value: new THREE.Color(theme.terrain.iceD) },
      uCoverNoise: { value: new THREE.Vector2(...(theme.terrain.coverNoise || [38, 0.5])) },
      // terrain.rockBand { alt: [from, to] real m, color, soft m, amount }: a stratum of another rock colour across the walls, in beds
      uCoverBand: { value: new THREE.Vector4(...(theme.terrain.rockBand ? [...theme.terrain.rockBand.alt, theme.terrain.rockBand.soft ?? 40, theme.terrain.rockBand.amount ?? 1] : [0, 0, 1, 0])) },
      uCoverBandColor: { value: new THREE.Color(theme.terrain.rockBand?.color || '#808080') },
      // terrain.rockStrata { spacing m, tone, wobble m }: the bedding of layered limestone, thin dark lines across the rock
      uCoverStrata: { value: new THREE.Vector3(...(theme.terrain.rockStrata ? [theme.terrain.rockStrata.spacing, theme.terrain.rockStrata.tone, theme.terrain.rockStrata.wobble ?? 3] : [1, 0, 0])) },
      uCoverEdge: { value: theme.terrain.coverEdge || 0 }, // terrain.coverEdge: darkness of the line round the rock patches
    },
  };
}

// Patches a MeshLambertMaterial. opts: { facets: bool, clip: bool (backdrop), creases: bool (massif line work),
// cover: bool (the geometry has a vec3 `cover` attribute: rock, snow, ice weights) }.
export function cartoon(material, shared, opts = {}) {
  const defines = [];
  if (opts.facets) defines.push('#define CARTOON_FACETS');
  if (opts.clip) defines.push('#define CARTOON_CLIP');
  if (opts.creases) defines.push('#define CARTOON_CREASES');
  if (opts.cover) defines.push('#define CARTOON_COVER');
  material.customProgramCacheKey = () => `cartoon:${defines.join(',')}`;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared.fog, shared.paint, shared.cover, { uWrap: shared.wrap, uFacet: shared.facet, uClip: shared.clip, uOffset: shared.offset, uCrease: shared.crease });
    sh.vertexShader = `${defines.join('\n')}
      varying vec3 vCWorld;
      #ifdef CARTOON_CREASES
        attribute vec2 rock; varying vec2 vRock;
      #endif
      #ifdef CARTOON_COVER
        attribute vec3 cover; varying vec3 vCover;
      #endif
      ${sh.vertexShader}`.replace('#include <project_vertex>', /* glsl */`
      #include <project_vertex>
      #ifdef CARTOON_CREASES
        vRock = rock;
      #endif
      #ifdef CARTOON_COVER
        vCover = cover;
      #endif
      {
        vec4 cw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cw = instanceMatrix * cw;
        #endif
        cw = modelMatrix * cw; vCWorld = cw.xyz;
      }`);
    sh.fragmentShader = `${defines.join('\n')}
      varying vec3 vCWorld; uniform vec2 uWrap; uniform vec3 uFacet; uniform vec4 uClip; uniform vec3 uOffset;
      #ifdef CARTOON_CREASES
        varying vec2 vRock; uniform vec2 uCrease;
      #endif
      #ifdef CARTOON_COVER
        varying vec3 vCover; uniform vec3 uCoverRock, uCoverRockB, uCoverSnow, uCoverIce, uCoverIceD, uCoverBandColor; uniform vec2 uCoverNoise; uniform vec4 uCoverBand; uniform vec3 uCoverStrata; uniform float uCoverEdge;
      #endif
      ${FOG_UNIFORMS_GLSL}
      ${PAINT_GLSL}
      float cH12(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec2 cTri(vec2 p){ float s = (p.x + p.y) * 0.3660254; vec2 i = floor(p + s); vec2 f = p - i + (i.x + i.y) * 0.2113249;
        return vec2(cH12(i * 1.37 + (f.x > f.y ? 0.0 : 17.1)), cH12(i * 2.11 + (f.x > f.y ? 3.0 : 9.7))); }
      #ifdef CARTOON_COVER
      float cVn(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(cH12(i), cH12(i + vec2(1.0, 0.0)), u.x), mix(cH12(i + vec2(0.0, 1.0)), cH12(i + vec2(1.0, 1.0)), u.x), u.y); }
      // a cover weight w (0..1, smooth across the vertices) as a patch: inside where w plus the noise passes one half,
      // with an edge a pixel or two wide (a painted edge, not a blend)
      // far: 0 near the camera, 1 far off, where the noise fades out (no camouflage blotches on a distant face: the
      // covers follow the ground's own form)
      float cPatch(float w, float n, float far){ float v = w + (n - 0.5) * uCoverNoise.y * (1.0 - 0.8 * far);
        float e = max(fwidth(v) * 0.75, 0.015);
        return w <= 0.001 ? 0.0 : smoothstep(0.5 - e, 0.5 + e, v); }
      #endif
      ${sh.fragmentShader}`
      .replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
        'float dotNL = smoothstep( uWrap.x, uWrap.y, dot( geometryNormal, directLight.direction ) );')
      .replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      #ifdef CARTOON_COVER
      {
        // rock (two tones in broad blotches), glacier ice (blue streaks), snow on top: crisp patches over the ground
        vec2 gq = (vCWorld.xz + uOffset.xz) / uCoverNoise.x;
        float cFar = smoothstep(700.0, 2500.0, length(vViewPosition));
        float n1 = cVn(gq) * 0.62 + cVn(gq * 2.3 + 5.1) * 0.38, n2 = cVn(gq * 0.31 + 2.7), n3 = cVn(vec2(gq.x * 0.5, gq.y * 2.4) + 9.3);
        vec3 rk = mix(uCoverRock, uCoverRockB, smoothstep(0.42, 0.62, n2));
        float ry = vCWorld.y + uOffset.y + (n1 - 0.5) * uCoverBand.z * 2.0;
        float bed = fract((vCWorld.y + uOffset.y) / 14.0 + n2 * 0.6); // its beds: lighter ones between darker partings
        bed = mix(0.62, 1.0, smoothstep(0.3, 0.38, bed) * (1.0 - smoothstep(0.86, 0.94, bed)));
        rk = mix(rk, uCoverBandColor * (0.9 + 0.2 * n2), bed * uCoverBand.w * smoothstep(uCoverBand.x - uCoverBand.z, uCoverBand.x, ry) * (1.0 - smoothstep(uCoverBand.y, uCoverBand.y + uCoverBand.z, ry)));
        if (uCoverStrata.y > 0.0) {
          // bedding planes: an antialiased line every spacing m of real height, wavering, broken where n2 is low
          float sy = (vCWorld.y + uOffset.y + (n1 - 0.5) * uCoverStrata.z * 2.0) / uCoverStrata.x;
          float sw = fwidth(sy), sd = abs(fract(sy) - 0.5);
          rk *= 1.0 - uCoverStrata.y * (1.0 - smoothstep(0.5 * sw, 1.5 * sw, 0.5 - sd)) * smoothstep(0.3, 0.45, n2) * (1.0 - smoothstep(0.07, 0.16, sw));
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, rk, cPatch(vCover.x, n1, cFar));
        if (uCoverEdge > 0.0) {
          // terrain.coverEdge: a thin dark line round the rock patches, the inked outline of an outcrop, gone far off
          // and where the patches get smaller than a few pixels
          float ev = vCover.x + (n1 - 0.5) * uCoverNoise.y * (1.0 - 0.8 * cFar), ew = max(fwidth(ev), 1e-4);
          diffuseColor.rgb *= 1.0 - uCoverEdge * (1.0 - smoothstep(0.6 * ew, 1.8 * ew, abs(ev - 0.5))) * (1.0 - smoothstep(0.08, 0.2, ew)) * (1.0 - cFar) * step(0.001, vCover.x);
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(uCoverIce, uCoverIceD, smoothstep(0.55, 0.75, n3) * 0.7), cPatch(vCover.z, 1.0 - n1, cFar));
        diffuseColor.rgb = mix(diffuseColor.rgb, uCoverSnow, cPatch(vCover.y, n1 * 0.5 + n2 * 0.5, cFar));
      }
      #endif`)
      .replace('#include <clipping_planes_fragment>', /* glsl */`
      #include <clipping_planes_fragment>
      #ifdef CARTOON_CLIP
        vec2 gxz = vCWorld.xz + uOffset.xz;
        if (gxz.x > uClip.x && gxz.x < uClip.z && gxz.y > uClip.y && gxz.y < uClip.w) discard;
      #endif`)
      .replace('#include <normal_fragment_begin>', /* glsl */`
      #include <normal_fragment_begin>
      #ifdef CARTOON_FACETS
      {
        float fd = length(vViewPosition);
        // two lattice sizes, cross-faded with distance so the facets keep a similar size on screen
        vec2 gp = vCWorld.xz + uOffset.xz;
        vec2 fa = cTri(gp / uFacet.x + 3.1), fb = cTri(gp / (uFacet.x * 5.0) + 7.7), fc = cTri(gp / (uFacet.x * 24.0) + 1.3);
        vec2 hh = mix(mix(fa, fb, smoothstep(110.0, 240.0, fd)), fc, smoothstep(700.0, 1400.0, fd));
        // the lattice lies in the horizontal plane: on steep walls it would stretch into tall saw teeth, so it fades
        // out between about 40 and 60 deg of slope
        vec3 wn = normalize(cross(dFdx(vCWorld), dFdy(vCWorld)));
        float level = smoothstep(0.5, 0.78, abs(wn.y));
        // far off the facets fade out (the far ground reads as soft painted forms, as the painting next to it)
        level *= 1.0 - smoothstep(1500.0, 3500.0, fd);
        vec3 tilt = uFacet.y * 2.0 * vec3(hh.x - 0.5, 0.0, hh.y - 0.5) * level;
        normal = normalize(normal + (viewMatrix * vec4(tilt, 0.0)).xyz);
        diffuseColor.rgb *= 1.0 + uFacet.z * 2.0 * (hh.y - 0.5) * level;
      }
      #endif
      #ifdef CARTOON_CREASES
      {
        // the line work on the Dolomite walls: a thin dark line along every ledge edge (an iso-line of the terrace
        // coordinate, antialiased), gone where the ledges get denser than a few pixels
        float fw = fwidth(vRock.y), dq = abs(fract(vRock.y - uCrease.y + 0.5) - 0.5);
        float ln = (1.0 - smoothstep(0.6 * fw, 1.6 * fw, dq)) * smoothstep(0.35, 0.7, vRock.x) * (1.0 - smoothstep(0.08, 0.2, fw));
        diffuseColor.rgb *= 1.0 - uCrease.x * ln;
      }
      #endif`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, length(vViewPosition), vCWorld.y); paintFade(gl_FragColor.rgb, gl_FragColor.a, vCWorld);');
  };
  return material;
}
