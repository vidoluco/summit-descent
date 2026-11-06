// Built species arrays -> three.js BufferGeometry with the attributes the animal materials read.
import * as THREE from 'three';

export function toGeometry(built) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(built.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(built.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(built.color, 3));
  g.setAttribute('aHull', new THREE.BufferAttribute(built.hull, 3));
  g.setAttribute('aRig', new THREE.BufferAttribute(built.rig, 4));
  g.computeBoundingSphere();
  // the motion can swing a wing or a head out of the rest pose: be generous for frustum culling
  g.boundingSphere.radius *= 1.5;
  return g;
}

// Per-instance motion attributes on an InstancedMesh geometry (shared by its outline twin).
export function addInstanceAttributes(geometry, max) {
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const anim2 = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAnim', anim);
  geometry.setAttribute('aAnim2', anim2);
  return { anim, anim2 };
}
