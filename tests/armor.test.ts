import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { armorTier, idleInput } from '../shared/game.js';
function game(count = 3) { const s = new Simulation(); const ps = Array.from({ length: count }, (_, n) => s.add(String(n), `P${n}`)); s.phase = 'active'; return { s, a: ps[0], b: ps[1], c: ps[2] }; }
test('actual damage and one elimination award XP and both armor upgrades without healing', () => {
  const { s, a, b } = game(); a.hp = 42;
  s.damage(b, a, 35); assert.equal(a.xp, 35); assert.equal(armorTier(a.xp).level, 1);
  b.hurtTime = 0; s.damage(b, a, 35); assert.equal(a.xp, 70); assert.equal(armorTier(a.xp).level, 2);
  b.hurtTime = 0; s.damage(b, a, 1000); assert.equal(a.xp, 150); assert.equal(a.damage, 100); assert.equal(a.kills, 1); assert.equal(a.hp, 42);
  s.damage(b, a, 1000); assert.equal(a.kills, 1); assert.equal(s.events.filter(e => e.type === 'level').length, 2);
});
test('guard and enchanted armor reduce melee and projectile damage with the same rules', () => {
  for (const [xp, hp] of [[0, 60], [50, 68], [150, 74]]) for (const projectile of [false, true]) {
    const { s, a, b } = game(); b.xp = xp; s.damage(b, a, 40, false, { projectile }); assert.equal(b.hp, hp); assert.equal(a.xp, 100 - hp);
  }
});
test('blocked and immune hits do not farm XP; stronger hit difference uses armor once', () => {
  const { s, a, b } = game(); Object.assign(a, { x: 0, z: -2 }); Object.assign(b, { x: 0, z: 0, yaw: 0, block: true, shieldRaise: .25, xp: 50 });
  s.damage(b, a, 20); assert.equal(a.xp, 0);
  b.block = false; s.damage(b, a, 20); assert.equal(b.hp, 84); assert.equal(a.xp, 16);
  s.damage(b, a, 15); assert.equal(a.xp, 16);
  s.damage(b, a, 35); assert.equal(b.hp, 72); assert.equal(a.xp, 28);
});
test('forfeit bypasses armor and immunity without awarding upgrade XP', () => {
  const { s, a, b } = game(); s.damage(b, a, 10); b.xp = 150; b.block = true; b.shieldRaise = .25;
  s.leave(b.id); assert.equal(b.alive, false); assert.equal(a.xp, 10);
});
test('simultaneous armor unlock cannot protect an earlier-processed player in that tick', () => {
  const { s, a, b } = game(2);
  Object.assign(a, { x: -5, z: 0, yaw: 0, hp: 25, xp: 30 });
  Object.assign(b, { x: -5, z: -2, yaw: Math.PI, hp: 25, xp: 30 });
  s.input(a.id, { ...idleInput(), seq: 1, attack: true, yaw: 0 }); s.input(b.id, { ...idleInput(), seq: 1, attack: true, yaw: Math.PI });
  s.step(); assert.equal(a.alive, false); assert.equal(b.alive, false); assert.equal(s.result, 'Draw — no survivors');
});
test('XP survives a disconnect and resets for lobby and rematch', () => {
  const { s, a, b } = game(2); s.damage(b, a, 1000); assert.equal(a.xp, 150);
  s.disconnect(a.id); a.connected = true; assert.equal(s.snapshot().players.find(p => p.id === a.id)!.xp, 150);
  s.host = a.id; s.checkWinner(); s.tick += 181; s.lobby(a.id); assert.equal(a.xp, 0);
  a.ready = b.ready = true; a.xp = 150; assert.equal(s.start(a.id), true); assert.equal(a.xp, 0);
});
test('armor preview is restricted to valid levels in active, connected solo practice', () => {
  const { s, a } = game(1); assert.equal(s.previewArmor(a.id, 3), false); s.practice = true;
  for (const invalid of [-1, 0, 4, 2.5, NaN, '3', {}, null]) assert.equal(s.previewArmor(a.id, invalid), false);
  assert.equal(s.previewArmor(a.id, 3), true); assert.equal(a.xp, 150);
  assert.equal(s.previewArmor(a.id, 1), true); assert.equal(a.xp, 0);
  a.connected = false; assert.equal(s.previewArmor(a.id, 3), false); a.connected = true;
  s.phase = 'waiting'; assert.equal(s.previewArmor(a.id, 3), false);
  const other = game(); other.s.practice = true; assert.equal(other.s.previewArmor(other.a.id, 3), false);
});
