import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA_SIZE, BOXES, DT, HEIGHT, LIMIT, RADIUS, SPAWNS, idleInput, move, wallHit, type Body } from '../shared/game.js';
import { LANDMARKS, arenaLocation } from '../shared/arena.js';
import { clipCamera } from '../client/camera.js';
import { groundPath } from './navigation.js';
const body = (x: number, z: number, y = 0): Body => ({ x, z, y, vy: 0, grounded: true });
const intersects = (p: Body) => BOXES.some(b => Math.abs(p.x - b.x) < b.w / 2 + RADIUS - .001 && Math.abs(p.z - b.z) < b.d / 2 + RADIUS - .001 && p.y < (b.y ?? 0) + b.h - .001 && p.y + HEIGHT > (b.y ?? 0) + .001);
test('nine times the area, valid separated spawns, and routes into every chamber and district', () => {
  assert.equal(ARENA_SIZE ** 2 / 32 ** 2, 9);
  for (const [x, z] of SPAWNS) {
    assert.ok(Math.abs(x) < LIMIT && Math.abs(z) < LIMIT);
    assert.equal(intersects(body(x, z)), false);
    for (const target of LANDMARKS.filter(p => p.name !== 'Lookout tower')) assert.ok(groundPath({ x, z }, target.name === 'Stone courtyard' ? { x: 4, z: 4 } : target).length, `No route from ${x},${z} to ${target.name}`);
  }
  for (const side of [-1, 1]) for (const dx of [-5, 5]) for (const dz of [-3, 3]) {
    const destination = { x: side * 26 + dx, z: side * 26 + dz };
    assert.ok(groundPath({ x: 0, z: 5 }, destination).length, `Chamber unreachable: ${JSON.stringify(destination)}`);
  }
});
test('walk up the lookout steps, cross the deck and descend without jumping or entering solids', () => {
  const p = body(0, -9);
  for (let n = 0; n < 330; n++) { move(p, { ...idleInput(), z: 1 }); assert.equal(intersects(p), false, JSON.stringify(p)); }
  assert.ok(p.z < -31 && p.z > -34); assert.ok(Math.abs(p.y - 7.2) < .001); assert.equal(p.grounded, true);
  assert.equal(arenaLocation(p.x, p.z, p.y), 'Lookout tower');
  for (let n = 0; n < 340; n++) move(p, { ...idleInput(), z: -1 });
  assert.ok(p.z > -10); assert.equal(p.y, 0);
});
test('tunnel roofs and floating stair treads leave usable passages and stop head impacts', () => {
  const p = body(-16, 17);
  for (let n = 0; n < 440; n++) { move(p, { ...idleInput(), x: 1 }); assert.equal(intersects(p), false); }
  assert.ok(p.x > 15); assert.equal(p.y, 0);
  const underStairs = body(-3, -17);
  for (let n = 0; n < 85; n++) move(underStairs, { ...idleInput(), x: 1 });
  assert.ok(underStairs.x > 3); assert.equal(underStairs.y, 0);
  const jumping = body(8, 17); jumping.vy = 20; jumping.grounded = false;
  for (let n = 0; n < 100; n++) { move(jumping, idleInput()); assert.ok(jumping.y + HEIGHT <= 3.1 + .001); }
  assert.equal(jumping.y, 0);
});
test('elevated cover blocks projectiles and cameras at its own height while keeping tunnel sightlines open', () => {
  assert.equal(wallHit({ x: -16, y: 1.6, z: 17 }, { x: 16, y: 1.6, z: 17 }), Infinity);
  assert.ok(wallHit({ x: 8, y: 1.6, z: 17 }, { x: 8, y: 5, z: 17 }) < 1);
  const view = clipCamera({ x: 8, y: 1.6, z: 17 }, { x: 8, y: 5, z: 17 });
  assert.ok(view.y < 3.1 - .22);
  assert.equal(wallHit({ x: 8, y: 4, z: 17 }, { x: 8, y: 4, z: 21 }), Infinity);
});
test('client prediction and authority replay the same staircase movement and stay within expanded boundaries', () => {
  const a = body(0, -9), b = { ...a };
  for (let n = 0; n < 300; n++) { const input = { ...idleInput(), z: 1, sprint: n % 9 > 4 }; move(a, input); move(b, input, DT); }
  assert.deepEqual(a, b);
  const edge = body(LIMIT - .1, 42); edge.vx = 300;
  move(edge, idleInput()); assert.equal(edge.x, LIMIT); assert.equal(edge.vx, 0);
});
