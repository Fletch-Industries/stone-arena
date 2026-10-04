import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArenaSigns } from '../client/arena-signs.js';

function fixture() {
  const signs = new ArenaSigns(), camera = new THREE.PerspectiveCamera(120, 1280 / 720, .05, 1200);
  const add = (x: number, y: number, z: number) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial()); sprite.scale.set(4.5, .85, 1); sprite.position.set(x, y, z); signs.add(sprite); return sprite;
  };
  return { signs, camera, add };
}
test('nearer arena signs win overlapping sightlines regardless of registration order', () => {
  const { signs, camera, add } = fixture(), far = add(0, 0, -20), near = add(0, 0, -10);
  signs.update(camera, 1280, 720); assert(near.visible); assert(!far.visible); assert(!near.material.depthWrite);
  near.position.x = 10; signs.update(camera, 1280, 720); assert(near.visible && far.visible);
});
test('place names keep their readable screen height across distance, FOV and viewport changes', () => {
  const { signs, camera, add } = fixture(), sign = add(0, 0, -12);
  for (const [width, height, fov, depth] of [[1280, 720, 120, 12], [390, 844, 90, 25], [844, 390, 55, 8]]) {
    camera.aspect = width / height; camera.fov = fov; camera.updateProjectionMatrix(); sign.position.z = -depth;
    signs.update(camera, width, height); assert(sign.visible);
    assert(Math.abs(sign.scale.y * camera.projectionMatrix.elements[5] / depth * height / 2 - 32) < .00001);
    assert(Math.abs(sign.scale.x / sign.scale.y - 4.5 / .85) < .00001);
  }
});
test('distant labels fade and disappear, then return when approaching again', () => {
  const { signs, camera, add } = fixture(), sign = add(0, 0, -28);
  signs.update(camera, 1280, 720); assert.equal(sign.material.opacity, 1);
  sign.position.z = -34; signs.update(camera, 1280, 720); assert(sign.visible); assert.equal(sign.material.opacity, .5);
  sign.position.z = -40; signs.update(camera, 1280, 720); assert(!sign.visible);
  sign.position.z = -20; signs.update(camera, 1280, 720); assert(sign.visible); assert.equal(sign.material.opacity, 1);
});
test('signs behind the camera, at the near plane or clipped by screen edges do not occupy label slots', () => {
  const { signs, camera, add } = fixture(), visible = add(0, 0, -10), behind = add(0, 0, 10), close = add(0, 0, -.01), edge = add(25, 0, -10);
  signs.update(camera, 390, 844); assert(visible.visible); assert(!behind.visible && !close.visible && !edge.visible);
});
test('layout uses the final camera world transform, including a parent or third-person view', () => {
  const { signs, camera, add } = fixture(), sign = add(10, 0, -10), parent = new THREE.Group(); parent.position.x = 10; parent.add(camera);
  parent.updateMatrixWorld(); signs.update(camera, 1280, 720); assert(sign.visible);
  camera.rotation.y = Math.PI; signs.update(camera, 1280, 720); assert(!sign.visible);
});
