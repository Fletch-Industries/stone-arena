import test from 'node:test';
import assert from 'node:assert/strict';
import { isSailing, locomotionPose } from '../client/animation.js';
import { DT, CREATIVE, idleInput, move, type Body } from '../shared/game.js';
import { SKY_SAIL } from '../shared/sailing.js';

const world = { seed: 7919, doorOpen: true, upgrades: SKY_SAIL };
const body = (): Body => ({ x: 4, y: 0, z: 0, vy: 0, grounded: true, realm: 'wilds' });
function pose(b: Body, distance: number) {
  return locomotionPose(distance, CREATIVE.speed, b.grounded, !!b.sprinting, b.vy, isSailing(b));
}

test('real Creative flight keeps one stance at ground contact, in the air and while sprinting, then releases it', () => {
  const b = body();
  move(b, { ...idleInput(), glide: true, x: 1 }, DT, false, world, true);
  assert(b.grounded && b.flying); assert(isSailing(b));
  const skim = pose(b, .4);
  for (let n = 0; n < 8; n++) move(b, { ...idleInput(), jump: true, sprint: true, z: 1 }, DT, false, world, true);
  assert(!b.grounded && b.flying && b.sprinting);
  assert.deepEqual(pose(b, 40), skim);
  move(b, { ...idleInput(), glide: true }, DT, false, world, true);
  assert.equal(b.flying, false); assert.equal(isSailing(b), false);
  assert.notDeepEqual(pose(b, 40), skim);
});

test('a real expedition sail uses the same flight stance and returns to the separate jump/fall pose on expiry', () => {
  const b = body();
  move(b, { ...idleInput(), glide: true }, DT, false, world);
  assert(!b.grounded && (b.glideTime ?? 0) > 0 && isSailing(b));
  const sail = pose(b, .4);
  b.vy = -1; move(b, idleInput(), DT, false, world);
  assert.deepEqual(pose(b, 12), sail);
  b.glideTime = 0; b.y = 10; move(b, idleInput(), DT, false, world);
  assert.equal(isSailing(b), false); assert.notDeepEqual(pose(b, 12), sail);
  assert.deepEqual(pose(b, 12), locomotionPose(12, CREATIVE.speed, b.grounded, !!b.sprinting, b.vy));
});
