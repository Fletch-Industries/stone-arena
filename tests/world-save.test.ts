import test from 'node:test';
import assert from 'node:assert/strict';
import { Construction } from '../shared/construction.js';
import { placementReason } from '../shared/weaving.js';
import { terrainHeight } from '../shared/world.js';
import { parseWorldSave, restoreWorld, saveWorld } from '../shared/world-save.js';
import { WorldImport } from '../server/world-import.js';
import { Simulation } from '../server/simulation.js';

function saved() {
  const sim = new Simulation(7919); sim.world.doorOpen = true; sim.world.waystones = 511;
  for (let x = 32; x < 100; x++) for (let z = -80; z < -30; z++) {
    const y = Math.floor(terrainHeight(x + .5, z + .5, 7919));
    if (!placementReason({ x, y, z }, sim.world)) { sim.world.construction!.place({ x, y, z, kind: 5, owner: 'private_player' }); return saveWorld(sim.world, 'Our magic garden'); }
  }
  throw Error('Missing clear save fixture');
}
test('portable worlds round-trip seed, runes and shared discoveries without private player data', () => {
  const save = saved(), world = restoreWorld(save)!; assert(world); assert.equal(world.seed, 7919); assert.equal(world.waystones, 511); assert.equal(world.doorOpen, true); assert.equal(world.construction!.size, 1);
  assert.equal([...world.construction!.values()][0].owner, 'memory:0'); assert(!JSON.stringify(save).includes('private_player')); assert.deepEqual(saveWorld(world, save.title), save); assert.deepEqual(parseWorldSave(JSON.stringify(save)), save);
});
test('world restore validates geometry, sites, bounds and duplicates before replacing a room', () => {
  const save = saved(), sim = new Simulation(999); const p = sim.add('host', 'Host'), before = sim.world;
  for (const blocks of [[[0, 0, 8, 0]], [[4096, 10, 40, 0]], [[40, -1, 40, 0]], [[40, 64, 40, 0]], [[40, 10, 40, 8]], [...save.blocks, ...save.blocks]]) { assert(!sim.restore(p.id, { ...save, blocks })); assert.equal(sim.world, before); }
  for (const patch of [{ format: 'other' }, { version: 99 }, { seed: -1 }, { seed: 2 ** 32 }, { waystones: 510 }, { waystones: 512 }, { title: '<script>' }]) assert(!restoreWorld({ ...save, ...patch }));
});
test('save parser rejects corrupt JSON and oversized archives', () => {
  assert.equal(parseWorldSave('{'), undefined); assert.equal(parseWorldSave(' '.repeat(192001)), undefined); assert.equal(parseWorldSave(JSON.stringify({ ...saved(), blocks: Array(4097).fill([40, 30, 40, 0]) })), undefined);
});
test('only a connected lobby host can restore; every player readies again', () => {
  const sim = new Simulation(999), host = sim.add('host', 'Host'), guest = sim.add('guest', 'Guest'); host.ready = guest.ready = true;
  assert(!sim.restore(guest.id, saved())); sim.phase = 'active'; assert(!sim.restore(host.id, saved())); sim.phase = 'waiting'; host.connected = false; assert(!sim.restore(host.id, saved())); host.connected = true;
  assert(sim.restore(host.id, saved())); assert.equal(sim.world.seed, 7919); assert.equal(sim.world.construction!.size, 1); assert([...sim.players.values()].every(p => !p.ready && p.realm === 'arena' && !p.weaving));
});
test('small upload chunks commit once, in order, with bounded packet sizes', () => {
  const save = saved(), { blocks, ...header } = save, upload = new WorldImport(); assert(upload.begin(header, blocks.length, 100)); assert(upload.chunk(0, blocks, 120)); assert.deepEqual(upload.finish(200), save); assert.equal(upload.finish(200), undefined);
  assert(JSON.stringify({ type: 'chunk', offset: 4096, blocks: Array(64).fill([-4095, 63, -4095, 5]) }).length < 4096);
});
test('partial, duplicate, excessive and expired world uploads fail closed', () => {
  const save = saved(), { blocks, ...header } = save;
  for (const action of ['partial', 'duplicate', 'oversized', 'late']) {
    const upload = new WorldImport(); assert(upload.begin(header, 1, 0));
    if (action === 'duplicate') { assert(upload.chunk(0, blocks, 1)); assert(!upload.chunk(0, blocks, 2)); }
    if (action === 'oversized') assert(!upload.chunk(0, Array(65).fill(blocks[0]), 1));
    if (action === 'late') assert(!upload.chunk(0, blocks, 30001));
    assert.equal(upload.finish(30002), undefined);
  }
  const upload = new WorldImport(); assert(!upload.begin(header, 4097, 0)); assert(upload.begin(header, 1, 0)); upload.expire(30001); assert.equal(upload.finish(30001), undefined);
});
test('a removed support does not destroy floating magical runes in a saved world', () => {
  const save = saved(), row = save.blocks[0]; save.blocks = [[row[0], row[1] + 10, row[2], 4]]; const world = restoreWorld(save); assert(world); assert.equal(world.construction!.size, 1);
});
