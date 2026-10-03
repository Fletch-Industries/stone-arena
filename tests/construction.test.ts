import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD, Construction, type ConstructionChanges } from '../shared/construction.js';
import { weaveTarget, placementReason, protectedRuneSite } from '../shared/weaving.js';
import { DT, EYE, idleInput, move, validInput, wallHit } from '../shared/game.js';
import { terrainHeight, worldBoxes } from '../shared/world.js';
import { shardSites } from '../shared/expedition.js';
import { waystoneSites } from '../shared/waystones.js';
import { Simulation } from '../server/simulation.js';

function setup() {
  const sim = new Simulation(7919), p = sim.add('builder', 'Builder'); sim.phase = 'active'; sim.practice = true;
  for (let x = 30; x < 50; x++) for (let z = -50; z < -24; z++) {
    const y = terrainHeight(x + .5, z + .5, sim.world.seed), pz = z + 4.5, py = terrainHeight(x + .5, pz, sim.world.seed);
    Object.assign(p, { realm: 'wilds', x: x + .5, z: pz, y: py, yaw: 0, pitch: Math.atan2(y - py - EYE, 4), weaving: true, weaveKind: 0 });
    if (worldBoxes(p.x, p.z, p.x, p.z, 'wilds', sim.world).some(b => Math.abs(p.x - b.x) < b.w / 2 + .4 && Math.abs(p.z - b.z) < b.d / 2 + .4 && py < (b.y ?? 0) + b.h)) continue;
    const target = weaveTarget(p, sim.world, false, [p]); if (target?.valid) return { sim, p, target };
  }
  throw Error('Fixture needs an open build site');
}
function aim(p: ReturnType<typeof setup>['p'], target: { x: number; y: number; z: number }) {
  const dx = target.x + .5 - p.x, dz = target.z + .5 - p.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(target.y + .8 - p.y - EYE, Math.hypot(dx, dz));
}
test('rune controls reject malformed modes and forged palette values', () => {
  assert(validInput({ ...idleInput(), weaving: true, weaveKind: 5 }));
  for (const field of [{ weaving: 1 }, { weaveKind: -1 }, { weaveKind: 6 }, { weaveKind: .5 }, { weaveKind: NaN }]) assert(!validInput({ ...idleInput(), ...field }));
});
test('sparse construction indexes negative cells and removes empty regions', () => {
  const c = new Construction(); assert(c.place({ x: -17, y: 20, z: -16, kind: 2, owner: 'a' })); assert(c.place({ x: 200, y: 30, z: 200, kind: 0, owner: 'a' }));
  assert.equal(c.boxes(-18, -17, -16, -15).length, 1); assert.equal(c.boxes(0, 0, 1, 1).length, 0); assert(c.erase(-17, 20, -16)); assert.equal(c.boxes(-18, -17, -16, -15).length, 0); assert.equal(c.count('a'), 1);
});
test('player quota refunds erased runes; room quota bounds all builders', () => {
  const c = new Construction();
  for (let n = 0; n < BUILD.roomLimit; n++) assert(c.place({ x: n % 64, y: Math.floor(n / 64) % 32, z: Math.floor(n / 2048), kind: n % 6, owner: `a${Math.floor(n / BUILD.playerLimit)}` }));
  assert.equal(c.size, 4096); assert(!c.place({ x: 80, y: 0, z: 0, kind: 0, owner: 'other' })); assert(!c.place({ x: 81, y: 0, z: 0, kind: 0, owner: 'a0' }));
  assert(c.erase(0, 0, 0)); assert(c.place({ x: 81, y: 0, z: 0, kind: 5, owner: 'a0' })); assert(c.state(1).blocks.length === 4096); assert(JSON.stringify(c.state(1)).length < 150_000);
});
test('full construction restore is atomic and rejects duplicate or unbounded data', () => {
  const c = new Construction(); c.place({ x: 40, y: 5, z: 40, kind: 1, owner: 'a' }); const original = c.state(7919);
  for (const row of [[40, 5, 40, 1, 'a'], [4096, 5, 40, 1, 'a'], [41, 64, 40, 1, 'a'], [41, 5, 40, 6, 'a'], [41, 5, 40, 1, '<script>']]) {
    assert(!c.restore({ ...original, blocks: [...original.blocks, row as [number, number, number, number, string]] })); assert.deepEqual(c.state(7919), original);
  }
});
test('construction deltas replicate atomically and demand recovery after gaps', () => {
  const source = new Construction(), peer = new Construction(); source.place({ x: 40, y: 5, z: 40, kind: 4, owner: 'a' });
  const first = source.drain(7919) as ConstructionChanges; assert(peer.apply(first)); assert(peer.apply(first)); assert.deepEqual(peer.state(7919), source.state(7919));
  assert(!peer.apply({ seed: 7919, revision: 3, edits: [[2, 41, 5, 40, 0, 'a'], [3, 40, 5, 40, 0, 'a']] })); assert.equal(peer.size, 1); assert.equal(peer.revision, 1);
  source.erase(40, 5, 40); source.place({ x: 42, y: 5, z: 40, kind: 2, owner: 'a' }); const missed = source.drain(7919) as ConstructionChanges;
  assert(!peer.apply({ ...missed, edits: missed.edits.slice(1) })); assert(peer.restore(source.state(7919))); assert(peer.apply(missed)); assert.deepEqual(peer.state(7919), source.state(7919));
});
test('excess pending edits fall back to one bounded full sync', () => {
  const c = new Construction(); for (let n = 0; n < 100; n++) c.place({ x: n, y: 1, z: 30, kind: 0, owner: 'a' });
  const message = c.drain(7919)!; assert('blocks' in message); assert.equal(message.blocks.length, 100); assert.equal(c.drain(7919), undefined);
});
test('tunnel, skyshards and every waystone remain unbuildable', () => {
  assert(protectedRuneSite(0, 8, 7919));
  for (const site of [...shardSites(7919), ...waystoneSites(7919)]) assert(protectedRuneSite(Math.floor(site.x), Math.floor(site.z), 7919));
  const { sim } = setup(); assert(placementReason({ x: 0, y: 0, z: 8 }, sim.world));
});
test('ordinary aim places a rune and the same aim selects adjacent air', () => {
  const { sim, p, target } = setup(); assert(sim.weave(p, false)); assert.equal(sim.world.construction!.size, 1);
  aim(p, target); const next = weaveTarget(p, sim.world); assert(next?.valid); assert(next.existing); assert(Math.abs(next.x - target.x) + Math.abs(next.y - target.y) + Math.abs(next.z - target.z) === 1);
});
test('building uses a bounded cadence and never grants combat damage or a shield', () => {
  const { sim, p } = setup(); const pose = { ...p }; sim.phase = 'waiting'; const q = sim.add('friend', 'Friend'); Object.assign(p, pose); sim.phase = 'active'; Object.assign(q, { realm: 'wilds', x: p.x + 8, z: p.z, y: p.y });
  sim.input(p.id, { ...idleInput(), seq: 1, yaw: p.yaw, pitch: p.pitch, weaving: true, attack: true, block: false }); sim.step(); assert.equal(sim.world.construction!.size, 1); assert.equal(p.damage, 0); assert.equal(q.hp, 100);
  const revision = sim.world.construction!.revision; sim.step(); assert.equal(sim.world.construction!.revision, revision);
  sim.input(p.id, { ...idleInput(), seq: 2, yaw: p.yaw, pitch: p.pitch, weaving: true, block: true }); sim.step(); assert.equal(p.block, false); assert.equal(p.shieldRaise, 0);
});
test('place cannot encase a player and preserves nearby native geometry', () => {
  const { sim, target } = setup(); const occupied = { realm: 'wilds' as const, x: target.x + .5, y: target.y, z: target.z + .5, alive: true, connected: true };
  assert.equal(placementReason(target, sim.world, [occupied]), 'Leave room for your friends');
  assert.equal(placementReason(target, sim.world, [{ ...occupied, connected: false }]), 'Leave room for your friends');
  assert(placementReason({ x: -3, y: 0, z: 7 }, sim.world));
});
test('erase selects the nearest rune and cannot reach through it to a hidden block', () => {
  const { sim, p, target } = setup(); assert(sim.weave(p, false)); aim(p, target);
  const adjacent = weaveTarget(p, sim.world)!; assert(adjacent.valid); sim.world.construction!.place({ ...adjacent, kind: 5, owner: p.id });
  const selected = weaveTarget(p, sim.world, true)!; assert(selected.existing); assert.notDeepEqual([selected.x, selected.y, selected.z], [target.x, target.y, target.z]);
  sim.tick += BUILD.cooldown; assert(sim.weave(p, true)); assert(sim.world.construction!.get(target.x, target.y, target.z)); assert(!sim.world.construction!.get(selected.x, selected.y, selected.z));
});
test('weaving rejects dead, disconnected, out of realm and recently hurt builders', () => {
  for (const patch of [{ alive: false }, { connected: false }, { realm: 'arena' }, { weaving: false }, { hurtTime: .1 }]) {
    const { sim, p } = setup(); Object.assign(p, patch); assert(!sim.weave(p, false)); assert.equal(sim.world.construction!.size, 0);
  }
  const { sim, p } = setup(); sim.damageHistory.set(p.id, new Map([['attacker', sim.tick]])); assert(!sim.weave(p, false)); sim.tick += 300; assert(sim.weave(p, false));
});
test('erase permissions protect opponents while co-op and hosts can restore a shared site', () => {
  const { sim, p, target } = setup(); sim.world.construction!.place({ ...target, kind: 0, owner: 'friend' }); aim(p, target); sim.host = 'friend';
  assert(!sim.weave(p, true)); assert.equal(sim.world.construction!.size, 1); sim.tick += BUILD.cooldown; sim.mode = 'expedition'; assert(sim.weave(p, true)); assert.equal(sim.world.construction!.size, 0);
  sim.world.construction!.place({ ...target, kind: 1, owner: 'friend' }); sim.tick += BUILD.cooldown; sim.mode = 'ffa'; sim.host = p.id; assert(sim.weave(p, true));
});
test('rune cover blocks shared movement, projectile rays and first surface selection', () => {
  const { sim, p, target } = setup(); sim.world.construction!.place({ ...target, kind: 0, owner: p.id });
  const a = { x: target.x + .5, y: target.y + .9, z: target.z + 2 }, b = { ...a, z: target.z - 1 }; assert(Number.isFinite(wallHit(a, b, 'wilds', sim.world)));
  sim.world.construction!.place({ ...target, y: target.y + 1, kind: 0, owner: p.id }); sim.world.construction!.place({ ...target, y: target.y + 2, kind: 0, owner: p.id });
  const body = { realm: 'wilds' as const, x: a.x, y: terrainHeight(a.x, a.z, sim.world.seed), z: a.z, vy: 0, grounded: true };
  for (let n = 0; n < 20; n++) move(body, { ...idleInput(), z: 1 }, DT, false, sim.world); assert(body.z >= target.z + 1.34 - .002);
  aim(p, target); const erase = weaveTarget(p, sim.world, true); assert(erase?.existing); assert.equal(erase.x, target.x); assert.equal(erase.z, target.z);
});
test('windlift jumping is identical in prediction and simulation and reaches four blocks', () => {
  const { sim, p, target } = setup(); sim.world.construction!.place({ ...target, kind: 5, owner: p.id }); Object.assign(p, { x: target.x + .5, z: target.z + .5, y: target.y + 1, vy: 0, grounded: true });
  const predicted = { ...p }, startY = p.y; let peak = p.y;
  for (let n = 1; n <= 35; n++) { const input = { ...idleInput(), seq: n, jump: n === 1 }; sim.input(p.id, input); sim.step(); move(predicted, input, DT, false, sim.world); assert(Math.abs(p.y - predicted.y) < 1e-8); peak = Math.max(peak, p.y); }
  assert(Math.abs(peak - startY - BUILD.windJump) < .025);
});
test('room snapshots stay small; rematches and reconnect retain shared buildings', () => {
  const { sim, p, target } = setup(); assert(sim.weave(p, false)); const block = sim.world.construction!.state(sim.world.seed);
  assert(!('construction' in sim.snapshot().world)); assert(JSON.stringify(sim.snapshot()).length < 6000); assert.equal(sim.snapshot().players[0].buildCount, 1);
  sim.disconnect(p.id); p.connected = true; sim.transferHost(); sim.lobby(p.id); assert.equal(sim.phase, 'waiting'); assert.deepEqual(sim.world.construction!.state(sim.world.seed), block); assert.equal(p.weaving, false);
  p.ready = true; assert(sim.start(p.id, true)); assert.deepEqual(sim.world.construction!.state(sim.world.seed), block);
});
