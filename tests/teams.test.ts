import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { CTF, TEAMS, idleInput } from '../shared/game.js';
function match(mode: 'teams' | 'ctf' = 'ctf', count = 2) {
  const s = new Simulation(); for (let n = 0; n < count; n++) s.add(String(n), `Player ${n}`);
  assert(s.selectMode('0', mode)); for (const p of s.players.values()) p.ready = true;
  assert(s.start('0')); for (let n = 0; n < 300; n++) s.step(); assert.equal(s.phase, 'active'); return s;
}
function take(s: Simulation, id = '0') { const p = s.players.get(id)!; const team = p.team === 'red' ? 'blue' : 'red'; Object.assign(p, { x: TEAMS[team].x, z: 0, y: 0 }); s.updateFlags(); return s.flags.find(f => f.team === team)!; }
test('only the host changes mode, teams are capped and all changes clear readiness', () => {
  const s = new Simulation(); for (let n = 0; n < 5; n++) s.add(String(n), String(n));
  assert.equal(s.selectMode('1', 'ctf'), false); assert.equal(s.selectMode('0', '__proto__'), false);
  assert(s.selectMode('0', 'ctf')); for (const p of s.players.values()) p.ready = true;
  assert.equal(s.selectTeam('1', 'red'), false); assert(s.selectTeam('0', 'blue'));
  assert([...s.players.values()].every(p => !p.ready)); assert.equal(s.selectTeam('0', 'green'), false);
  assert(s.selectTeam('2', 'blue') === false); // Blue already has three seats.
});
test('competitive team rounds require both balanced teams; practice can explore solo', () => {
  const s = new Simulation(); s.add('0', 'Solo'); s.selectMode('0', 'ctf'); s.players.get('0')!.ready = true;
  assert(!s.start('0')); assert(s.start('0', true));
  const t = new Simulation(); for (let n = 0; n < 4; n++) t.add(String(n), String(n)); t.selectMode('0', 'teams'); t.selectTeam('1', 'red');
  for (const p of t.players.values()) p.ready = true; assert(!t.start('0')); t.selectTeam('0', 'blue');
  for (const p of t.players.values()) p.ready = true; assert(t.start('0')); assert(!t.selectTeam('0', 'red')); assert(!t.selectMode('0', 'ffa'));
});
test('enemy flag pickup is automatic, own home flag cannot be taken, and three captures award team wins', () => {
  const s = match(); const p = s.players.get('0')!, enemy = s.flags.find(f => f.team === 'blue')!;
  Object.assign(p, { x: -40, z: 0 }); s.updateFlags(); assert.equal(s.flags[0].state, 'home');
  for (let n = 1; n <= 3; n++) { assert.equal(take(s).carrier, p.id); Object.assign(p, { x: -40, z: 0 }); s.updateFlags(); s.checkWinner(); assert.equal(s.scores.red, n); assert.equal(enemy.state, 'home'); }
  assert.equal(s.phase, 'results'); assert.equal(s.winnerTeam, 'red'); assert.equal(p.wins, 1); assert.equal(p.captures, 3); assert.equal(s.players.get('1')!.wins, 0);
});
test('your flag must be home to capture; touch returns a dropped own flag', () => {
  const s = match(); const red = s.players.get('0')!, blue = s.players.get('1')!;
  take(s, '0'); take(s, '1'); Object.assign(red, { x: -40, z: 0 }); s.updateFlags(); assert.equal(s.scores.red, 0);
  Object.assign(blue, { x: -40, z: 1 }); s.dropFlag('1'); blue.z = 4; s.updateFlags(); assert.equal(s.scores.red, 1); assert.equal(red.flagReturns, 1); assert.equal(s.flags[0].state, 'home');
});
test('elimination drops a flag; respawn restores supplies but preserves earned stats and spent life cannot reconnect-reset', () => {
  const s = match(); const red = s.players.get('0')!, blue = s.players.get('1')!; take(s); red.xp = 50; red.apples = 0; red.totems = 0;
  s.damage(red, blue, 200); assert(!red.alive); assert.equal(s.flags[1].state, 'dropped'); assert.equal(red.respawnAt, s.tick + 300);
  s.checkWinner(); assert.equal(s.phase, 'active'); s.disconnect(red.id); for (let n = 0; n < 350; n++) s.step(); assert(!red.alive);
  red.connected = true; s.step(); assert(red.alive); assert.equal(red.hp, 100); assert.equal(red.xp, 50); assert.equal(red.apples, 2); assert.equal(red.totems, 1); assert.equal(red.respawnAt, 0);
  red.apples = 1; red.totems = 0; s.disconnect(red.id); red.connected = true; s.step(); assert.equal(red.apples, 1); assert.equal(red.totems, 0);
});
test('disconnect drops carried flags and the return timeout is authoritative', () => {
  const s = match(); const f = take(s); s.disconnect('0'); assert.equal(f.state, 'dropped'); assert.equal(f.carrier, '');
  s.tick = f.returnAt - 1; s.updateFlags(); assert.equal(f.state, 'dropped'); s.tick++; s.updateFlags(); assert.equal(f.state, 'home'); assert.equal(f.x, 40);
});
test('friendly fire does no damage, knockback, shield disable or XP; melee and arrows pass teammates', () => {
  const s = match('teams', 3), a = s.players.get('0')!, ally = s.players.get('2')!, enemy = s.players.get('1')!;
  Object.assign(a, { x: 40, z: 10, yaw: 0 }); Object.assign(ally, { x: 40, z: 9, block: true, shieldRaise: .25, yaw: Math.PI }); Object.assign(enemy, { x: 40, z: 7.5 });
  assert.equal(s.damage(ally, a, 45, true), false); assert.equal(ally.hp, 100); assert.equal(ally.shieldDisabled, 0); assert.equal(ally.vx, 0); assert.equal(a.xp, 0);
  s.melee(a); assert.equal(ally.hp, 100); assert.equal(enemy.hp, 65);
  enemy.hurtTime = 0; Object.assign(enemy, { x: 40, z: 6, y: 0, vx: 0, vz: 0 }); a.weapon = 'crossbow'; s.shoot(a, 1); for (let n = 0; n < 5; n++) s.step(); assert.equal(ally.hp, 100); assert(enemy.hp < 65);
});
test('projectiles persist outside the old small arena bounds', () => {
  const s = match(), p = s.players.get('0')!; Object.assign(p, { x: 40, z: 10, yaw: 0, weapon: 'bow' }); s.shoot(p, 1); s.step(); assert.equal(s.arrows.length, 1);
});
test('spawn protection blocks damage and ends on attacking or taking a flag', () => {
  const s = match(), p = s.players.get('0')!, enemy = s.players.get('1')!; s.respawn(p);
  assert(!s.damage(p, enemy, 50)); assert.equal(p.hp, 100); s.melee(p); assert.equal(p.immuneUntil, 0); assert(s.damage(p, enemy, 50));
  s.respawn(p); take(s); assert.equal(p.immuneUntil, 0);
});
test('flag pickup respects height and walls; ordinary controls cannot set team or flags', () => {
  const s = match(), p = s.players.get('0')!, f = s.flags[1]; Object.assign(p, { x: 40, z: 0, y: 7 }); s.updateFlags(); assert.equal(f.state, 'home');
  Object.assign(f, { state: 'dropped', x: 1.7, z: 0, y: 0, returnAt: s.tick + 100 }); Object.assign(p, { x: 1, z: 0, y: 0 }); s.updateFlags(); assert.equal(f.state, 'dropped');
  s.input(p.id, { ...idleInput(), seq: 1, team: 'blue', flag: 'carried' } as any); s.step(); assert.equal(p.team, 'red'); assert.equal(f.state, 'dropped');
});
test('team survival ends on the last team; capture the flag only forfeits when a whole team leaves', () => {
  const s = match('teams', 3), blue = s.players.get('1')!; s.damage(blue, s.players.get('0')!, 200); s.checkWinner(); assert.equal(s.winnerTeam, 'red'); assert.equal(s.players.get('2')!.wins, 1);
  const c = match(); c.disconnect('1'); c.checkWinner(); assert.equal(c.phase, 'active'); c.leave('1'); assert.equal(c.phase, 'results'); assert.equal(c.winnerTeam, 'red');
});
test('rematch resets flags, scores, respawn and capture stats, preserving teams and wins', () => {
  const s = match(); take(s); s.scores.red = 3; s.players.get('0')!.captures = 3; s.checkWinner(); s.tick += 180; s.lobby('0');
  assert.equal(s.phase, 'waiting'); assert.equal(s.scores.red, 0); assert(s.flags.every(f => f.state === 'home')); assert.equal(s.players.get('0')!.team, 'red'); assert.equal(s.players.get('0')!.wins, 1); assert.equal(s.players.get('0')!.captures, 0);
});
