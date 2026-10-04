import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { CREATIVE, DT, idleInput, move, type Player } from '../shared/game.js';
import { placeOf, validPlace, validTrails } from '../shared/player-place.js';
import { WorldVisits } from '../client/world-visits.js';

function creative() { const s = new Simulation(7919); s.add('host', 'Host'); assert(s.selectMode('host', 'creative')); assert(s.start('host')); return s; }
test('Creative starts immediately without readiness, unlocks tools and never ends after discoveries or departures', () => {
  const s = creative(), p = s.players.get('host')!;
  assert.equal(s.phase, 'active'); assert.equal(s.countdown, 0); assert(!s.practice);
  assert.equal(s.world.upgrades, 7); assert.equal(s.world.waystones, 511); assert(s.world.doorOpen); assert.equal(p.realm, 'wilds');
  Object.assign(p, { realm: 'arena', x: 0, y: 0, z: 0, relics: 7 });
  for (let n = 0; n < 600; n++) s.step();
  assert.equal(s.phase, 'active'); assert.equal(p.wins, 0);
  s.leave('host'); s.checkWinner(); assert.equal(s.phase, 'active'); assert.equal(s.players.size, 0);
});
test('friends join an active Creative world without moving existing explorers', () => {
  const s = creative(), host = s.players.get('host')!; Object.assign(host, { x: 100, y: 70, z: -80, yaw: 1, flying: true });
  const before = placeOf(host), guest = s.add('guest', 'Guest');
  assert.deepEqual(placeOf(host), before); assert(guest.alive && guest.connected); assert.equal(guest.realm, 'wilds');
  s.disconnect('host'); s.leave('host'); assert.equal(s.host, 'guest'); assert.equal(s.phase, 'active');
  assert(s.add('late', 'Late')); assert.equal(s.phase, 'active');
});
test('Creative refuses damage including Warden attacks and forfeits', () => {
  const s = creative(), a = s.players.get('host')!, b = s.add('guest', 'Guest');
  assert(!s.damage(b, a, 1000)); assert(!s.damage(b, a, 1000, false, { force: true }));
  assert(!s.worldStrike(b, { id: 'warden', x: b.x, z: b.z } as any, 1000)); assert.equal(b.hp, 100);
  s.leave('guest'); assert.equal(s.phase, 'active'); assert.equal(a.kills, 0);
});
test('Creative flight hovers, climbs, descends, obeys a height bound and cannot be forged in survival', () => {
  const s = creative(), body = { ...s.players.get('host')!, x: 100, y: 70, z: 100, grounded: false }, i = { ...idleInput(), glide: true };
  move(body, i, DT, false, s.world, true); assert(body.flying); assert.equal(body.y, 70);
  for (let n = 0; n < 60; n++) move(body, { ...idleInput(), jump: true }, DT, false, s.world, true);
  assert(Math.abs(body.y - 80) < .001);
  for (let n = 0; n < 60; n++) move(body, { ...idleInput(), descend: true }, DT, false, s.world, true);
  assert(Math.abs(body.y - 70) < .001);
  body.y = CREATIVE.ceiling; move(body, { ...idleInput(), jump: true }, DT, false, s.world, true); assert.equal(body.y, CREATIVE.ceiling);
  move(body, idleInput(), DT, false, s.world); assert.equal(body.flying, false); assert(body.vy < 0);
});
test('flight respects terrain and rune walls instead of letting explorers clip through solids', () => {
  const s = creative(), p = s.players.get('host')!;
  Object.assign(p, { x: 42.5, y: 28, z: 43.5, flying: true, grounded: false });
  assert(s.world.construction!.place({ x: 42, y: 28, z: 42, kind: 0, owner: 'host' }));
  for (let n = 0; n < 60; n++) move(p, { ...idleInput(), z: 1 }, DT, false, s.world, true);
  assert(p.z >= 43.34 - .001);
});
test('saved spots restore realm, view and flight; unsafe or forged positions use a safe spawn', () => {
  const s = creative(), spot = { realm: 'wilds' as const, x: 180, y: 70, z: -100, yaw: 1.2, pitch: -.4, flying: true };
  const p = s.add('returning', 'Returning', spot); assert.deepEqual(placeOf(p), spot);
  assert.equal(p.hp, 100); assert.equal(p.vx, 0); assert.equal(p.vy, 0);
  assert(!s.resumePlace(p, { ...spot, x: Infinity })); assert(!validPlace({ ...spot, y: 999 }));
  assert(!s.resumePlace(p, { ...spot, x: 100, y: -20, z: 100 }));
  const invalid = s.add('unsafe', 'Unsafe', { ...spot, realm: 'arena', x: 0, y: 1, z: -60 }); assert.equal(invalid.realm, 'wilds');
  const competitive = new Simulation(); competitive.add('host', 'Host', spot); assert.equal(competitive.players.get('host')!.realm, 'arena');
});
test('place records reject unbounded, duplicate and malformed trails', () => {
  const spot = { realm: 'wilds', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flying: false, key: 'a'.repeat(64), at: 1 };
  assert(validTrails([spot])); assert(!validTrails([spot, spot])); assert(!validTrails([{ ...spot, yaw: 9 }])); assert(!validTrails([{ ...spot, key: '../escape' }]));
  assert(!validTrails(Array.from({ length: 33 }, (_, n) => ({ ...spot, key: n.toString(16).padStart(64, '0') }))));
});
test('browser profiles keep separate player places on a shared device and world invitations survive reload', () => {
  let text = '', n = 0; const storage = { getItem: () => text, setItem: (_: string, value: string) => { text = value; } };
  const visits = new WorldVisits(storage, () => `profile-${String(++n).padStart(20, '0')}`);
  const sam = visits.playerKey('Sam'), alex = visits.playerKey('Alex'); assert.notEqual(sam, alex);
  visits.remember({ id: 'a'.repeat(32), title: 'Our world' });
  const next = new WorldVisits(storage); assert.equal(next.playerKey(' sam '), sam); assert.equal(next.playerKey('Alex'), alex); assert.deepEqual(next.entries, visits.entries);
  visits.remember({ id: '../invalid', title: 'Invalid' }); assert.equal(visits.entries.length, 1);
});
