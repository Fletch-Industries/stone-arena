import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePoseBlend, blendLocomotionPose, isSailing, locomotionPose } from '../client/animation.js';
import { DT, idleInput, move, type Body } from '../shared/game.js';
import { SKY_SAIL } from '../shared/sailing.js';

test('actual ground-to-expedition launch blends from the previous walking stance rather than the new airborne pose', () => {
  const b: Body = { x: 4, y: 0, z: 0, vy: 0, grounded: true, realm: 'wilds' };
  const before = locomotionPose(.47, 4.317, true, false, 0);
  move(b, { ...idleInput(), glide: true }, DT, false, { seed: 7919, doorOpen: true, upgrades: SKY_SAIL });
  assert(isSailing(b) && !b.grounded && b.vy > 0);
  const target = locomotionPose(.47, 4.317, b.grounded, false, b.vy, isSailing(b));
  const first = blendLocomotionPose(before, { ...target }, advancePoseBlend(0, DT, false));
  for (const key of ['leftLeg', 'rightLeg', 'leftArm', 'rightArm', 'lean'] as const) {
    assert(Math.abs(first[key] - before[key]) <= Math.abs(target[key] - before[key]) * .2);
  }
  let weight = 0;
  for (let n = 0; n < 15; n++) weight = advancePoseBlend(weight, DT, false);
  assert(weight > .95);
  assert.deepEqual(blendLocomotionPose(before, { ...target }, 1), target);
});

test('flight transition progress follows elapsed time across render rates and settles exactly', () => {
  const values = [60, 30, 10].map(rate => {
    let value = 0;
    for (let n = 0; n < rate * .3; n++) value = advancePoseBlend(value, 1 / rate, false);
    return value;
  });
  assert(values.every(value => Math.abs(value - values[0]) < 1e-12));
  let value = 0;
  for (let n = 0; n < 36; n++) value = advancePoseBlend(value, 1 / 60, false);
  assert.equal(value, 1);
});

test('reversing flight continues from the displayed stance and reduced motion skips the transition', () => {
  const walk = locomotionPose(.47, 4.317, true, false, 0), flight = locomotionPose(0, 0, true, false, 0, true);
  const halfway = blendLocomotionPose(walk, { ...flight }, advancePoseBlend(0, .05, false));
  assert.deepEqual(blendLocomotionPose(halfway, { ...walk }, 0), halfway);
  const reversed = blendLocomotionPose(halfway, { ...walk }, advancePoseBlend(0, 1 / 60, false));
  assert(reversed.leftLeg > halfway.leftLeg && reversed.leftLeg < walk.leftLeg);
  assert.equal(advancePoseBlend(.25, 0, true), 1);
  assert.deepEqual(blendLocomotionPose(halfway, { ...flight }, advancePoseBlend(0, DT, true)), flight);
});
