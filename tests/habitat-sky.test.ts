import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ARENA_SKY, sampleHabitatSky } from '../client/habitat-sky.js';
import { Atmosphere } from '../client/atmosphere.js';

test('habitat palette follows deterministic world habitats and keeps the arrival clearing verdant', () => {
  const a = new Float64Array(6), b = new Float64Array(6);
  sampleHabitatSky(0, 0, 7919, a); assert.deepEqual([...a], [.58, .72, .64, .10, .23, .43]);
  sampleHabitatSky(-410, 630, 7919, a); sampleHabitatSky(-410, 630, 7919, b); assert.deepEqual(a, b);
  sampleHabitatSky(-410, 630, 12345, b); assert(a.some((v, c) => Math.abs(v - b[c]) > .01));
  assert([...a, ...b].every(v => Number.isFinite(v) && v > 0 && v < 1));
});
test('walking across habitat boundaries blends colors continuously instead of switching a dominant biome', () => {
  const a = new Float64Array(6), b = new Float64Array(6);
  for (let x = -500; x <= 500; x += 10) {
    sampleHabitatSky(x, -143, 7919, a); sampleHabitatSky(x + .01, -143, 7919, b);
    assert(a.every((v, c) => Math.abs(v - b[c]) < .001));
  }
});
test('color transition has the same elapsed-time result at different frame rates', () => {
  const skies = [30, 60, 120].map(hz => {
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog('#a5cee5', 80, 200);
    const sky = new Atmosphere(scene), camera = new THREE.PerspectiveCamera(); camera.position.set(370, 10, -240);
    for (let n = 0; n < hz * 2; n++) sky.update(camera, n / hz, true, 1 / hz, true, 7919);
    return { palette: sky.palette, fog: scene.fog.color.toArray() };
  });
  for (const sky of skies) {
    assert(sky.palette.current.every((v, c) => Math.abs(v - skies[0].palette.current[c]) < 1e-12));
    assert(sky.fog.every((v, c) => Math.abs(v - skies[0].fog[c]) < 1e-12));
  }
  assert(skies[0].palette.current.some((v, c) => Math.abs(v - ARENA_SKY[c]) > .05));
});
test('new worlds resample immediately and returning to the Citadel restores its original sky and fog', () => {
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog('#a5cee5', 80, 200);
  const original = scene.fog.color.clone(), sky = new Atmosphere(scene), camera = new THREE.PerspectiveCamera(); camera.position.set(370, 10, -240);
  sky.update(camera, 0, true, 1, true, 7919); const target = sky.palette.target.slice();
  sky.update(camera, 0, true, .01, true, 12345); assert(sky.palette.target.some((v, c) => Math.abs(v - target[c]) > .01));
  assert(!scene.fog.color.equals(original));
  sky.update(camera, 0, true, .01, false, 12345); assert.deepEqual([...sky.palette.current], [...ARENA_SKY]); assert(scene.fog.color.equals(original));
  sky.update(camera, 0, true, 0, true, 7919); assert.deepEqual(sky.palette.target, target);
});
test('reduced motion freezes clouds while travel still updates the fixed sky resources', () => {
  const scene = new THREE.Scene(), sky = new Atmosphere(scene), camera = new THREE.PerspectiveCamera();
  const material = sky.sky.material as THREE.ShaderMaterial, geometry = sky.sky.geometry, cloudMaterial = sky.clouds.material, colors = material.uniforms.horizon.value;
  camera.position.set(0, 10, 0); sky.update(camera, 10, true, .1, true, 7919); const before = sky.horizon.clone();
  camera.position.set(400, 10, -500); sky.update(camera, 100, true, .2, true, 7919);
  assert.equal(sky.clouds.position.x, camera.position.x); assert.equal(sky.clouds.position.z, camera.position.z); assert(!sky.horizon.equals(before));
  assert.equal(sky.sky.geometry, geometry); assert.equal(sky.clouds.material, cloudMaterial); assert.equal(material.uniforms.horizon.value, colors); assert.equal(sky.clouds.count, 84);
});
