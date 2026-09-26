import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipCamera, nextPerspective, thirdPersonCamera, validPerspective } from '../client/camera.js';
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
test('perspective cycles first/rear/front and rejects stale saved settings', () => {
  assert.equal(nextPerspective('first'), 'rear'); assert.equal(nextPerspective('rear'), 'front'); assert.equal(nextPerspective('front'), 'first');
  for (const bad of [null, undefined, 'orbit', 1, {}, '']) assert.equal(validPerspective(bad), false);
});
test('rear and front cameras follow yaw and pitch without changing aim or eye position', () => {
  const eye = { x: -5, y: 3, z: 2 }, original = { ...eye }, yaw = .3, pitch = .2;
  for (const mode of ['rear', 'front'] as const) {
    const view = thirdPersonCamera(eye, yaw, pitch, mode), sign = mode === 'rear' ? 1 : -1;
    near(view.distance, 4); near(view.position.x, eye.x + Math.sin(yaw) * Math.cos(pitch) * 4 * sign);
    near(view.position.y, eye.y - Math.sin(pitch) * 4 * sign); near(view.position.z, eye.z + Math.cos(yaw) * Math.cos(pitch) * 4 * sign);
    near(view.yaw, mode === 'rear' ? yaw : yaw + Math.PI); near(view.pitch, mode === 'rear' ? pitch : -pitch);
  }
  assert.deepEqual(eye, original);
});
test('camera retracts before all walls, including diagonals and wide near planes', () => {
  for (const radius of [.18, .22, .3]) for (const sign of [-1, 1]) {
    const p = clipCamera({ x: 15 * sign, y: 1.6, z: 15 * sign }, { x: 18 * sign, y: 1.6, z: 18 * sign }, radius);
    assert.ok(Math.abs(p.x) < 16 - radius); assert.ok(Math.abs(p.z) < 16 - radius); assert.ok(Math.abs(p.x) >= 15);
  }
});
test('camera cannot tunnel through tall cover, cap edges, low cover, or lanterns', () => {
  for (const [a, b, boundary] of [
    [{ x: 0, y: 1.6, z: -3 }, { x: 0, y: 1.6, z: 3 }, -1.54],
    [{ x: 0, y: 2.9, z: -3 }, { x: 0, y: 2.9, z: 3 }, -1.54],
    [{ x: 9, y: 1, z: -2 }, { x: 9, y: 1, z: 2 }, -.54],
    [{ x: -14, y: 2.4, z: -12 }, { x: -14, y: 2.4, z: -16 }, -13.71],
  ] as const) {
    const p = clipCamera(a, b);
    if (b.z > a.z) assert.ok(p.z < boundary - .22); else assert.ok(p.z > boundary + .22);
  }
});
test('looking vertically retracts at floor; open space and jumping retain the full boom', () => {
  const low = thirdPersonCamera({ x: -5, y: 1.62, z: 0 }, 0, 1.5, 'rear'); assert.ok(low.position.y >= .22); assert.ok(low.distance < 4);
  const high = thirdPersonCamera({ x: -5, y: 3, z: 0 }, 0, -.5, 'rear'); near(high.distance, 4);
  const eye = { x: 0, y: 1.6, z: 0 }; assert.deepEqual(clipCamera(eye, { ...eye, z: 4 }), eye);
  assert.deepEqual(clipCamera(eye, eye), eye);
});
