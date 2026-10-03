import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { DT, idleInput, move, wallHit, type Body } from '../shared/game.js';
import { CHUNK_SIZE, WORLD_LIMIT, SECRET, terrainHeight, terrainVertex, treeAt, wantedChunks, chunkRadius, terrainCacheSize } from '../shared/world.js';
import { buildTerrainChunk } from '../shared/terrain-mesh.js';
import { clipCamera } from '../client/camera.js';
const world = { seed: 7919, doorOpen: true };
function practice() { const s = new Simulation(world.seed); const p = s.add('host', 'Explorer'); p.ready = true; assert(s.start('host', true)); for (let n = 0; n < 300; n++) s.step(); return { s, p }; }
test('the same seed generates the same terrain/trees, different rooms vary, and the arrival clearing stays flat', () => {
  for (const [x, z] of [[0, 0], [0, 8], [6, -6], [-8, 0]]) assert.equal(terrainHeight(x, z, world.seed), 0);
  const heights = [[30, 40], [-51, 80], [80, -40], [300, 200]].map(([x, z]) => terrainHeight(x, z, world.seed));
  assert(heights.some(y => y > 3)); assert(new Set(heights).size > 2);
  assert.deepEqual(heights, [[30, 40], [-51, 80], [80, -40], [300, 200]].map(([x, z]) => terrainHeight(x, z, world.seed)));
  assert.notDeepEqual(heights, [[30, 40], [-51, 80], [80, -40], [300, 200]].map(([x, z]) => terrainHeight(x, z, world.seed + 1)));
  assert.deepEqual(treeAt(-3, 7, world.seed), treeAt(-3, 7, world.seed));
});
test('neighboring chunk edges and normals match without cracks, including negative coordinates', () => {
  const a = buildTerrainChunk(-1, 2, world.seed), b = buildTerrainChunk(0, 2, world.seed), width = CHUNK_SIZE + 1;
  assert.equal(a.positions.length, width * width * 3); assert.equal(a.indices.length, CHUNK_SIZE * CHUNK_SIZE * 6);
  for (let z = 0; z < width; z++) {
    const edge = (z * width + CHUNK_SIZE) * 3, next = z * width * 3;
    assert.equal(a.positions[edge + 1], b.positions[next + 1]); assert.deepEqual(a.normals.slice(edge, edge + 3), b.normals.slice(next, next + 3));
  }
  const c = buildTerrainChunk(-1, 3, world.seed);
  for (let x = 0; x < width; x++) assert.equal(a.positions[(CHUNK_SIZE * width + x) * 3 + 1], c.positions[x * 3 + 1]);
});
test('terrain collision exactly follows the rendered triangles', () => {
  const x = -25, z = 47, a = terrainVertex(x, z, world.seed), b = terrainVertex(x + 1, z, world.seed), c = terrainVertex(x, z + 1, world.seed), d = terrainVertex(x + 1, z + 1, world.seed);
  assert.equal(terrainHeight(x + .2, z + .3, world.seed), a + (b - a) * .2 + (c - a) * .3);
  assert(Math.abs(terrainHeight(x + .8, z + .7, world.seed) - (d + (c - d) * .2 + (b - d) * .3)) < 1e-10);
});
test('only nearby living players can open the stone door, which remains shared across snapshots and rematches', () => {
  const { s, p } = practice(); assert(!s.interact(p.id)); Object.assign(p, { x: -26, z: -46 }); p.connected = false; assert(!s.interact(p.id)); p.connected = true; p.alive = false; assert(!s.interact(p.id)); p.alive = true;
  assert(s.interact(p.id)); assert(s.snapshot().world.doorOpen); const copy = s.snapshot(); copy.world.doorOpen = false; assert(s.world.doorOpen);
  s.lobby(p.id); assert(s.world.doorOpen); assert(!s.interact(p.id));
});
test('closed panels stop movement; the open narrow passage stays solid and leads to a safe return trip', () => {
  const { s, p } = practice(); Object.assign(p, { x: -26, z: -46 });
  for (let n = 0; n < 70; n++) move(p, { ...idleInput(), z: 1 }, DT, false, s.world);
  assert(p.z >= -47.22); assert.equal(p.realm, 'arena'); assert(s.interact(p.id));
  for (let n = 0; n < 260; n++) { move(p, { ...idleInput(), z: 1 }, DT, false, s.world); if (s.travel(p)) break; }
  assert.equal(p.realm, 'wilds'); assert.equal(p.x, 0); assert.equal(p.z, 0); assert.equal(p.y, 0); assert.equal(p.hp, 100);
  for (let n = 0; n < 150; n++) { move(p, { ...idleInput(), z: -1 }, DT, false, s.world); if (s.travel(p)) break; }
  assert.equal(p.realm, 'arena'); assert.equal(p.z, -61); assert.equal(p.x, -26);
  move(p, { ...idleInput(), x: 1 }, 1, false, s.world); assert(p.x <= SECRET.x + 1.66);
  const elsewhere: Body = { x: 10, y: 0, z: -47, vy: 0, grounded: true }; move(elsewhere, { ...idleInput(), z: 1 }, 1, false, s.world); assert(elsewhere.z >= -47.65);
});
test('wild movement follows terrain on client and server without falling through or using arena bounds', () => {
  const a: Body = { realm: 'wilds', x: 90, z: 60, y: terrainHeight(90, 60, world.seed), vy: 0, grounded: true }, b = { ...a };
  for (let n = 0; n < 1800; n++) { const input = { ...idleInput(), z: 1, yaw: n / 80, sprint: n % 60 > 20, jump: n % 181 === 0 }; move(a, input, DT, false, world); move(b, input, DT, false, world); assert(a.y >= terrainHeight(a.x, a.z, world.seed) - 1e-8); }
  assert.deepEqual(a, b); assert(a.x > 48); assert(Number.isFinite(a.y));
  const edge = { ...a, x: WORLD_LIMIT - .01 }; move(edge, { ...idleInput(), x: 1 }, DT, false, world); assert(edge.x <= WORLD_LIMIT);
});
test('terrain, trees and tunnel walls block projectiles and third-person cameras', () => {
  const x = 81, z = 71, y = terrainHeight(x, z, world.seed);
  assert(wallHit({ x, z, y: y + 1 }, { x, z, y: y - 1 }, 'wilds', world) < 1);
  assert.equal(wallHit({ x, z, y: y + 3 }, { x: x + .1, z, y: y + 3 }, 'wilds', world), Infinity);
  const camera = clipCamera({ x, z, y: y + 1.6 }, { x, z, y: y - 2 }, .22, 'wilds', world); assert(camera.y >= y + .21);
  assert(wallHit({ x: -26, y: 1.6, z: -46 }, { x: -26, y: 1.6, z: -51 }, 'arena', { ...world, doorOpen: false }) < 1);
  assert.equal(wallHit({ x: -26, y: 1.6, z: -46 }, { x: -26, y: 1.6, z: -51 }, 'arena', world), Infinity);
});
test('no combat between realms, forged controls cannot teleport, and CTF flags stay in the citadel', () => {
  const s = new Simulation(), a = s.add('a', 'A'), b = s.add('b', 'B'); s.phase = 'active'; s.mode = 'ctf'; Object.assign(a, { x: 40, z: 0 }); s.updateFlags(); assert.equal(s.flags[1].carrier, a.id);
  s.world.doorOpen = true; Object.assign(a, { x: -26, z: -64.5 }); assert(s.travel(a)); assert.equal(s.flags[1].state, 'dropped'); assert.equal(s.flags[1].x, -26); assert.equal(s.flags[1].z, -64.5);
  Object.assign(a, { x: 40, z: 0 }); assert.equal(s.damage(a, b, 100), false); assert.equal(s.damage(b, a, 100), false);
  s.input(b.id, { ...idleInput(), seq: 1, realm: 'wilds', world: { doorOpen: true } } as any); s.step(); assert.equal(b.realm, 'arena');
  a.hp = 42; a.apples = 0; a.totems = 0; Object.assign(a, { x: 0, z: 9, y: 0 }); s.travel(a); assert.equal(a.hp, 42); assert.equal(a.apples, 0); assert.equal(a.totems, 0);
});
test('streaming schedules are capped per quality, release distant regions and height cache stays bounded', () => {
  for (const quality of ['low', 'medium', 'high']) { const r = chunkRadius(quality), a = wantedChunks(0, 0, r), b = wantedChunks(300, -700, r); assert.equal(a.length, (r * 2 + 1) ** 2); assert.equal(a[0].distance, 0); assert(a.length <= 81); assert(!b.some(c => a.some(old => old.key === c.key))); }
  for (let n = 0; n < 20; n++) buildTerrainChunk(n * 2, n * -3, world.seed);
  assert(terrainCacheSize() <= 4096);
});
