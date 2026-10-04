import test from 'node:test';
import assert from 'node:assert/strict';
import { bindWorldContents, worldContentsReady } from '../client/world-contents.js';
import { Construction } from '../shared/construction.js';
import { Excavation } from '../shared/excavation.js';
import { Forage, suppliesNear } from '../shared/forage.js';
import { StoneReceiver, stonePackets } from '../shared/excavation-sync.js';
import { saveWorld } from '../shared/world-save.js';
import { Simulation } from '../server/simulation.js';
import { carvedCave } from './mining-fixture.js';

test('a completed cave stream updates the export before the next snapshot', () => {
  const sim = new Simulation(7919), previous = new Excavation(); previous.dig({ x: 43, y: 9, z: -62, owner: 'old' });
  carvedCave(sim.world); const world = sim.snapshot().world;
  const contents = { construction: sim.world.construction!, constructionSeed: 7919, excavation: previous, excavationSeed: 7919, forage: sim.world.forage!, forageSeed: 7919 };
  bindWorldContents(world, contents);
  world.buildRevision = contents.construction.revision; world.excavationRevision = contents.excavation.revision;
  const receiver = new StoneReceiver(); let completed: ReturnType<StoneReceiver['receive']>;
  for (const packet of stonePackets(sim.world.excavation!.state(7919), 1)) {
    completed = receiver.receive(packet, 100); assert.notEqual(completed, false);
    if (!completed) { assert.equal(world.excavation, previous, 'Partial streams never become visible'); assert(!worldContentsReady(world, contents, receiver.active), 'Identical seeds/revisions cannot make an in-flight restore ready'); }
  }
  assert(completed); contents.excavation = completed.excavation; contents.excavationSeed = completed.seed;
  bindWorldContents(world, contents);
  world.excavationRevision = contents.excavation.revision; assert(worldContentsReady(world, contents, receiver.active));
  assert.deepEqual(saveWorld(world, 'Restored cave'), saveWorld(sim.world, 'Restored cave'));
  assert.notEqual(world.excavation, previous);
});
test('full rune and supply replacements follow their seed and discard a previous world', () => {
  const sim = new Simulation(7919), world = sim.snapshot().world, construction = new Construction(), forage = new Forage();
  assert(construction.place({ x: 42, y: 28, z: 42, kind: 2, owner: 'builder' }));
  const node = suppliesNear(40, -60, 7919, 96)[0]; assert(node); assert(forage.harvest(node, 10));
  const contents = { construction, constructionSeed: 7919, excavation: new Excavation(), excavationSeed: 7919, forage, forageSeed: 7919 };
  bindWorldContents(world, contents); assert.equal(saveWorld(world).blocks.length, 1); assert(!world.forage!.available(node, 10));
  world.seed = 1234567; bindWorldContents(world, contents);
  assert.equal(world.construction, undefined); assert.equal(world.excavation, undefined); assert.equal(world.forage, undefined);
  assert.equal(saveWorld(world).blocks.length, 0); assert.equal(saveWorld(world).cuts!.length, 0);
});
