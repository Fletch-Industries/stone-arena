import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { isTeamMode, playerColor, idleInput } from '../shared/game.js';
import { shardSites } from '../shared/expedition.js';

function expedition(count = 2) {
  const s = new Simulation(7919);
  for (let n = 0; n < count; n++) s.add(String(n), `Explorer ${n}`);
  assert(s.selectMode('0', 'expedition'));
  for (const p of s.players.values()) p.ready = true;
  assert(s.start('0'));
  for (let n = 0; n < 300; n++) s.step();
  assert.equal(s.phase, 'active'); return s;
}
test('expeditions support one to five explorers, individual colors and no team selection or balance requirement', () => {
  for (const count of [1, 3, 5]) {
    const s = expedition(count); assert(!s.practice); assert(!isTeamMode(s.mode));
    assert.equal(new Set([...s.players.values()].map(p => playerColor(p, s.mode))).size, count);
    assert(!s.selectTeam('0', 'blue')); s.step(); assert.equal(s.phase, 'active');
  }
  const s = new Simulation(); s.add('0', 'Host'); s.add('1', 'Guest');
  assert(!s.selectMode('1', 'expedition')); assert(s.selectMode('0', 'expedition'));
  assert(!s.selectTeam('0', 'blue')); assert(!s.selectMode('0', 'constructor'));
  for (const p of s.players.values()) { p.team = 'red'; p.ready = true; }
  assert(s.start('0'));
});
test('all expedition players are allies; melee and projectiles cannot hurt, push, disable shields or award combat XP', () => {
  const s = expedition(), a = s.players.get('0')!, b = s.players.get('1')!;
  Object.assign(a, { x: 40, z: 10, yaw: 0 }); Object.assign(b, { x: 40, z: 8, yaw: Math.PI, block: true, shieldRaise: .25 });
  assert(s.teammates(a, b)); assert(!s.damage(b, a, 100, true)); s.melee(a);
  a.weapon = 'crossbow'; s.shoot(a, 1); for (let n = 0; n < 20; n++) s.step();
  assert.equal(b.hp, 100); assert.equal(b.shieldDisabled, 0); assert.equal(b.x, 40); assert.equal(b.z, 8);
  assert.equal(b.vx, 0); assert.equal(b.vz, 0); assert.equal(a.damage, 0); assert.equal(a.xp, 0); assert.equal(a.kills, 0);
  assert.equal(s.phase, 'active'); assert(s.flags.every(f => f.state === 'home'));
});
test('solo completion requires collecting all three authoritative shards and returning to the citadel', () => {
  const s = expedition(1), p = s.players.get('0')!;
  for (const site of shardSites(s.world.seed)) {
    Object.assign(p, { realm: 'wilds', x: site.x, z: site.z, y: site.y, vy: 0 }); s.step();
    assert.equal(s.phase, 'active'); assert.equal(p.wins, 0);
  }
  assert.equal(p.relics, 7); Object.assign(p, { x: 0, z: 9, y: 0, vy: 0 }); s.step();
  assert.equal(p.realm, 'arena'); assert.equal(s.phase, 'results'); assert.equal(p.wins, 1);
  assert.match(s.result, /Everyone made it home/); assert.equal(s.winnerTeam, ''); s.checkWinner(); assert.equal(p.wins, 1);
});
test('the party wins only after every explorer is complete, alive, connected and home', () => {
  const s = expedition(), a = s.players.get('0')!, b = s.players.get('1')!;
  a.relics = 7; s.checkWinner(); assert.equal(s.phase, 'active');
  b.relics = 7; b.realm = 'wilds'; s.checkWinner(); assert.equal(s.phase, 'active');
  b.realm = 'arena'; b.connected = false; s.checkWinner(); assert.equal(s.phase, 'active');
  b.connected = true; b.alive = false; s.checkWinner(); assert.equal(s.phase, 'active');
  b.alive = true; s.checkWinner(); assert.equal(s.phase, 'results'); assert.equal(a.wins, 1); assert.equal(b.wins, 1); assert.equal(s.winner, '');
});
test('disconnect cannot grant a free win; explicit departure relinquishes a seat; an empty party receives no win', () => {
  const s = expedition(), a = s.players.get('0')!, b = s.players.get('1')!;
  a.relics = 7; s.disconnect(b.id); s.checkWinner(); assert.equal(s.phase, 'active');
  s.leave(b.id); assert.equal(s.phase, 'results'); assert.equal(a.wins, 1); assert.equal(b.wins, 0);
  const empty = expedition(1), p = empty.players.get('0')!; empty.leave(p.id);
  assert.equal(empty.phase, 'results'); assert.equal(p.wins, 0); assert.equal(empty.result, 'Expedition ended');
});
test('shared wins survive rematches; new expeditions reset progress and clear outstanding attacks', () => {
  const s = expedition(); for (const p of s.players.values()) p.relics = 7;
  s.checkWinner(); s.lobby('0'); assert.equal(s.phase, 'results'); s.tick += 180; s.lobby('0'); assert.equal(s.phase, 'waiting');
  for (const p of s.players.values()) { assert.equal(p.wins, 1); p.ready = true; }
  assert(s.start('0')); assert([...s.players.values()].every(p => p.relics === 0)); assert.equal(s.mode, 'expedition'); assert.equal(s.arrows.length, 0);
});
test('only the host may return an active expedition to the lobby; ordinary input cannot forge progress', () => {
  const s = expedition(); s.lobby('1'); assert.equal(s.phase, 'active');
  s.input('0', { ...idleInput(), seq: 1, relics: 7, wins: 999, realm: 'wilds' } as any); s.step();
  const p = s.players.get('0')!; assert.equal(p.relics, 0); assert.equal(p.wins, 0); assert.equal(p.realm, 'arena');
  s.lobby('0'); assert.equal(s.phase, 'waiting'); assert([...s.players.values()].every(q => !q.ready));
});
