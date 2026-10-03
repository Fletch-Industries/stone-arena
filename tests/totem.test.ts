import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPLE, DT, TOTEM, idleInput, validInput } from '../shared/game.js';
import { Simulation } from '../server/simulation.js';
import { hotbar } from '../client/hotbar.js';

function duel() {
  const s = new Simulation(), a = s.add('a', 'Attacker'), b = s.add('b', 'Totem bearer');
  s.phase = 'active'; b.offhand = 'totem';
  return { s, a, b };
}

test('left-hand controls accept only a shield or totem; supply is server owned', () => {
  for (const offhand of ['shield', 'totem']) assert.equal(validInput({ ...idleInput(), offhand }), true);
  for (const offhand of [undefined, null, 0, 'apple', {}, 'totem;shield']) assert.equal(validInput({ ...idleInput(), offhand }), false);
  const { s, b } = duel(); b.totems = 0;
  s.input(b.id, { ...idleInput(), seq: 1, offhand: 'totem', ...{ totems: 99, hp: 1000 } }); s.step();
  assert.equal(b.totems, 0); assert.equal(b.hp, 100);
});

test('held totem leaves two hearts once, without a kill, assist or prevented-damage XP', () => {
  const { s, a, b } = duel(); b.hp = 55;
  s.damage(b, a, 1000);
  assert.equal(b.hp, TOTEM.health); assert.equal(b.alive, true); assert.equal(b.totems, 0);
  assert.equal(a.damage, 35); assert.equal(a.xp, 35); assert.equal(a.kills, 0);
  assert.equal(s.events.filter(e => e.type === 'totem' && e.actor === b.id).length, 1);
  s.checkWinner(); assert.equal(s.phase, 'active');
  b.offhand = 'shield'; b.offhand = 'totem'; b.hurtTime = 0;
  s.damage(b, a, 1000); s.checkWinner();
  assert.equal(b.alive, false); assert.equal(s.winner, a.id); assert.equal(a.kills, 1);
  assert.equal(s.events.filter(e => e.type === 'totem').length, 1);
});

test('threshold applies after armor to melee and projectiles, including lethal hits', () => {
  for (const projectile of [false, true]) for (const [hp, amount, expected, remaining] of [
    [100, 79, 21, 1], [100, 80, 20, 0], [100, 200, 20, 0], [10, 1, 20, 0],
  ]) {
    const { s, a, b } = duel(); b.hp = hp; s.damage(b, a, amount, false, { projectile });
    assert.equal(b.hp, expected); assert.equal(b.totems, remaining); assert.equal(b.alive, true);
    assert.equal(a.damage, Math.max(0, hp - expected));
  }
  const { s, a, b } = duel(); b.xp = 150; b.hp = 50;
  s.damage(b, a, 40); assert.equal(b.hp, 24); assert.equal(b.totems, 1);
  b.hp = 50; b.hurtTime = 0; s.damage(b, a, 50);
  assert.equal(b.hp, 20); assert.equal(b.totems, 0);
});

test('stored totems, immune hits and forfeits cannot grant a save', () => {
  const { s, a, b } = duel(); b.offhand = 'shield'; b.hp = 30;
  s.damage(b, a, 40); assert.equal(b.alive, false); assert.equal(b.totems, 1);
  const immune = duel(); immune.b.hp = 25; immune.b.hurtTime = .5; immune.b.lastDamage = 40;
  assert.equal(immune.s.damage(immune.b, immune.a, 35), false); assert.equal(immune.b.totems, 1);
  assert.equal(immune.b.hp, 25);
  const forfeit = duel(); forfeit.s.damage(forfeit.b, forfeit.a, 10); forfeit.s.leave(forfeit.b.id);
  assert.equal(forfeit.b.alive, false); assert.equal(forfeit.b.totems, 1);
  assert.equal(forfeit.s.events.some(e => e.type === 'totem'), false);
});

test('swapping away from a shield removes blocking, slowdown and attack suppression', () => {
  const { s, b } = duel(); b.hp = 30;
  s.input(b.id, { ...idleInput(), seq: 1, offhand: 'shield', block: true }); s.step();
  assert.equal(b.block, true); assert.ok(b.shieldRaise > 0);
  s.input(b.id, { ...idleInput(), seq: 2, offhand: 'totem', block: true, weapon: 'apple', attack: true }); s.step();
  assert.equal(b.block, false); assert.equal(b.shieldRaise, 0); assert.ok(b.charge > 0);
  b.shieldDisabled = 5;
  s.input(b.id, { ...idleInput(), seq: 3, offhand: 'shield', block: true }); s.step(); assert.equal(b.block, false);
});

test('a totem save cancels a same-tick completed apple bite, leaving exactly two hearts', () => {
  const { s, a, b } = duel();
  Object.assign(b, { x: -5, z: 0, hp: 25, weapon: 'apple', charge: APPLE.seconds - DT });
  Object.assign(a, { x: -5, z: -2, yaw: Math.PI });
  s.input(a.id, { ...idleInput(), seq: 1, yaw: Math.PI, attack: true });
  s.input(b.id, { ...idleInput(), seq: 1, offhand: 'totem', weapon: 'apple', attack: true }); s.step();
  assert.equal(b.hp, 20); assert.equal(b.apples, APPLE.count); assert.equal(b.totems, 0);
  assert.equal(b.charge, 0); assert.equal(s.events.some(e => e.type === 'heal'), false);
});

test('stale controls and reconnect preserve the selected hand and spent supply; rounds reset supply', () => {
  const { s, a, b } = duel(); s.damage(b, a, 1000);
  s.disconnect(b.id); for (let i = 0; i < 20; i++) s.step(); b.connected = true;
  const state = s.snapshot().players.find(p => p.id === b.id)!;
  assert.equal(state.totems, 0); assert.equal(state.offhand, 'totem'); assert.equal(state.hp, 20);
  s.practice = true; s.lobby(a.id); assert.equal(b.totems, 1);
  b.totems = 0; a.ready = b.ready = true; assert.equal(s.start(a.id), true); assert.equal(b.totems, 1);
});

test('HUD exposes an accessible hand switch and distinguishes ready from consumed totems', () => {
  const { b } = duel();
  assert.match(hotbar(b, 'sword'), /Left hand: Totem ready\. Switch to shield/);
  assert.match(hotbar(b, 'sword'), /data-action="offhand"/);
  b.totems = 0; assert.match(hotbar(b, 'sword'), /Totem consumed/);
  b.offhand = 'shield'; assert.match(hotbar(b, 'sword'), /Shield ready\. Switch to totem/);
});
