import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { DT, JUMP_HEIGHT, LIMIT, MELEE, WALK_SPEED, SPRINT_SPEED, idleInput, knockback, move, type Body } from '../shared/game.js';
import { locomotionPose } from '../client/animation.js';
function duel(count = 2) {
  const s = new Simulation();
  for (let n = 0; n < count; n++) s.add(String(n), `P${n}`);
  s.phase = 'active';
  const [a, b, c] = [...s.players.values()];
  Object.assign(a, { x: -5, y: 0, z: 0, yaw: 0 });
  Object.assign(b, { x: -5, y: 0, z: -2, yaw: Math.PI });
  return { s, a, b, c };
}
function body(): Body { return { x: -12, z: 0, y: 0, vy: 0, grounded: true }; }
test('walking and forward sprint match reference speed; backward sprint is walking', () => {
  for (const [z, sprint, speed] of [[1, false, WALK_SPEED], [1, true, SPRINT_SPEED], [-1, true, WALK_SPEED]] as const) {
    const p = body(); for (let n = 0; n < 60; n++) move(p, { ...idleInput(), z, sprint });
    assert.ok(Math.abs(Math.abs(p.z) - speed) < .0001);
  }
});
test('jump apex matches 1.252 blocks; sprint jump carries farther, with same apex', () => {
  const distances: number[] = [];
  for (const sprint of [false, true]) {
    const p = body(); let max = 0;
    for (let n = 0; n < 60; n++) { move(p, { ...idleInput(), z: 1, sprint, jump: n === 0 }); max = Math.max(max, p.y); if (n > 0 && p.grounded) break; }
    assert.ok(Math.abs(max - JUMP_HEIGHT) < .002); assert.equal(p.y, 0); distances.push(Math.abs(p.z));
  }
  assert.ok(distances[1] > distances[0] * 1.3);
});
test('ground hit pushes away and lifts; airborne hit leaves vertical velocity unchanged', () => {
  const { s, a, b } = duel(); s.melee(a);
  assert.equal(b.hp, 65); assert.ok(b.vz! < 0); assert.ok(b.vy > 0); assert.equal(b.grounded, false);
  const p = body(); p.y = 2; p.grounded = false; p.vy = -2; knockback(p, 1, 0); assert.equal(p.vy, -2);
});
test('sprint hit is stronger and requires releasing sprint or forward to reset', () => {
  const { s, a, b } = duel(); a.sprinting = true; s.melee(a);
  assert.equal(b.hp, 65); assert.equal(b.vz, -18); assert.equal(a.sprinting, false); assert.equal(a.sprintLocked, true);
  move(a, { ...idleInput(), z: 1, sprint: true }); assert.equal(a.sprinting, false);
  move(a, { ...idleInput(), z: 0, sprint: true });
  move(a, { ...idleInput(), z: 1, sprint: true }); assert.equal(a.sprinting, true);
});
test('only descending, charged, non-sprinting hits are critical', () => {
  for (const [vy, sprinting, cooldown, expected] of [[-2, false, 0, 52.5], [2, false, 0, 35], [-2, true, 0, 35], [-2, false, MELEE.sword.recovery, 7]] as const) {
    const { s, a, b } = duel(); Object.assign(a, { y: .1, grounded: false, vy, sprinting, cooldown }); s.melee(a); assert.equal(100 - b.hp, expected);
  }
});
test('rapid early clicks deal weak damage; recovery and weapon switches cannot be bypassed', () => {
  const { s, a, b } = duel(); a.cooldown = MELEE.sword.recovery; s.melee(a); assert.equal(b.hp, 93);
  b.hurtTime = 0; a.cooldown = 0; s.melee(a); assert.equal(b.hp, 58);
  assert.equal(a.cooldown, .625); a.weapon = 'axe'; s.melee(a); assert.equal(a.cooldown, 1);
});
test('half-second hurt window rejects repeat damage/knockback but accepts stronger difference', () => {
  const { s, a, b } = duel(); s.damage(b, a, 20); const vz = b.vz;
  s.damage(b, a, 15); assert.equal(b.hp, 80); assert.equal(b.vz, vz);
  s.damage(b, a, 35); assert.equal(b.hp, 65); assert.equal(b.vz, vz);
  for (let n = 0; n < 31; n++) s.step(); s.damage(b, a, 35); assert.equal(b.hp, 30);
});
test('shield has raise delay, blocks front completely, exposes back, and repels attacker', () => {
  { const { s, a, b } = duel(); b.block = true; b.shieldRaise = .2; s.damage(b, a, 35); assert.equal(b.hp, 65); }
  { const { s, a, b } = duel(); b.block = true; b.shieldRaise = .25; s.damage(b, a, 35); assert.equal(b.hp, 100); assert.equal(b.vz, 0); assert.ok(a.vz! > 0); }
  { const { s, a, b } = duel(); b.block = true; b.shieldRaise = .25; b.yaw = 0; s.damage(b, a, 35); assert.equal(b.hp, 65); }
});
test('modern axes always disable a raised shield, with or without sprinting', () => {
  for (const [random, sprintHit, disabled] of [[.1, false, true], [.8, false, true], [.8, true, true]] as const) {
    const { s, a, b } = duel(); s.random = () => random; b.block = true; b.shieldRaise = .25;
    s.damage(b, a, 45, true, { sprintHit }); assert.equal(b.shieldDisabled, disabled ? 5 : 0); assert.equal(b.hp, 100);
  }
});
test('projectile shield facing uses impact direction, not the shooter current position', () => {
  const { s, a, b } = duel(); b.block = true; b.shieldRaise = .25; a.z = -4;
  s.damage(b, a, 35, false, { projectile: true, source: { x: -5, z: 0 } }); assert.equal(b.hp, 100); assert.equal(a.vz, 0);
});
test('charged grounded sword sweeps nearby enemies; sprinting does not sweep', () => {
  for (const sprinting of [false, true]) {
    const { s, a, b, c } = duel(3); Object.assign(c, { x: -4, z: -2 }); a.sprinting = sprinting;
    s.melee(a); assert.equal(b.hp, 65); assert.equal(c.hp, sprinting ? 100 : 95);
  }
});
test('melee uses a three-block ray and respects cover', () => {
  const { s, a, b } = duel(); b.z = -3.31; s.melee(a); assert.equal(b.hp, 100);
  b.z = -3.29; a.cooldown = 0; s.melee(a); assert.equal(b.hp, 65);
});
test('knockback cannot tunnel through cover or arena walls', () => {
  const p = body(); Object.assign(p, { x: 0, z: 3, vx: 0, vz: -300, grounded: false, y: .1 }); move(p, idleInput()); assert.ok(p.z >= 1.84 - 1e-8); assert.equal(p.vz, 0);
  Object.assign(p, { x: LIMIT - .2, z: 12, vx: 300, vz: 0 }); move(p, idleInput()); assert.equal(p.x, LIMIT); assert.equal(p.vx, 0);
});
test('replayed movement retains knockback and sprint lock exactly', () => {
  const { s, a, b } = duel(); a.sprinting = true; s.melee(a);
  const predicted = { ...b };
  for (let n = 0; n < 15; n++) { const i = { ...idleInput(), seq: n + 1, x: .5, z: 1, sprint: true, yaw: b.yaw }; s.input(b.id, i); s.step(); move(predicted, i); }
  for (const k of ['x', 'y', 'z', 'vy', 'vx', 'vz'] as const) assert.equal(predicted[k], b[k]);
});
test('forfeiting while shielded and recently hurt still ends the life', () => {
  const { s, a, b } = duel(); s.damage(b, a, 10); b.block = true; b.shieldRaise = .25; s.leave(b.id); assert.equal(b.alive, false); assert.equal(s.winner, a.id);
});
test('animation has opposing limbs, stronger running strides, and separate airborne poses', () => {
  const walk = locomotionPose(.4, WALK_SPEED, true, false, 0), run = locomotionPose(.4, SPRINT_SPEED, true, true, 0);
  assert.equal(walk.leftLeg, -walk.rightLeg); assert.equal(walk.leftLeg, -walk.leftArm); assert.ok(Math.abs(run.leftLeg) > Math.abs(walk.leftLeg));
  const rise = locomotionPose(.4, WALK_SPEED, false, false, 2), fall = locomotionPose(4, WALK_SPEED, false, false, -2);
  assert.equal(rise.leftLeg, fall.leftLeg); assert.notEqual(rise.leftArm, fall.leftArm);
  assert.equal(locomotionPose(1, 0, true, false, 0).leftLeg, 0);
});
test('bow draw curve and crossbow projectile speed match the reference kit', () => {
  const { s, a } = duel(); a.weapon = 'bow'; s.shoot(a, .1); assert.equal(s.arrows.length, 0); assert.equal(a.ammo, 20);
  s.shoot(a, .5); assert.equal(s.arrows[0].vz, -25); assert.equal(s.arrows[0].critical, false);
  s.shoot(a, 1); assert.equal(s.arrows[1].vz, -60); assert.equal(s.arrows[1].critical, true);
  a.weapon = 'crossbow'; s.shoot(a, 1); assert.equal(s.arrows[2].vz, -63); assert.equal(a.ammo, 17);
});
test('arrows use drag, gravity and swept collision at full speed', () => {
  const { s, a, b } = duel(); s.random = () => 0; a.weapon = 'bow'; s.shoot(a, 1); s.step();
  assert.ok(s.arrows[0].vz > -60); assert.ok(s.arrows[0].vy < 0); s.step(); assert.ok(b.hp < 100); assert.equal(s.arrows.length, 0);
});
test('simultaneous hits preserve each attacker critical eligibility before knockback', () => {
  const { s, a, b } = duel(); Object.assign(b, { y: .1, vy: -1, grounded: false });
  s.input(a.id, { ...idleInput(), seq: 1, attack: true, yaw: a.yaw });
  s.input(b.id, { ...idleInput(), seq: 1, attack: true, yaw: b.yaw });
  s.step(); assert.equal(a.hp, 47.5); assert.equal(b.hp, 65);
});
