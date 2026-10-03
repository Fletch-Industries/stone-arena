import test from 'node:test';
import assert from 'node:assert/strict';
import { Excavation, ECHO_CHISEL, SCULPT, type ExcavationChanges, type StoneCell } from '../shared/excavation.js';
import { floorHeight, ceilingHeight, nativeBox, nativeRay, nativeSolid, surfaceHeight } from '../shared/terrain-collision.js';
import { sculptReason, sculptTarget, stratumAt } from '../shared/mining.js';
import { buildTerrainChunk } from '../shared/terrain-mesh.js';
import { terrainHeight, worldBoxes } from '../shared/world.js';
import { EYE, HEIGHT, DT, idleInput, move, validInput, wallHit, type Player } from '../shared/game.js';
import { placementReason, weaveTarget } from '../shared/weaving.js';
import { parseWorldSave, restoreWorld, saveWorld } from '../shared/world-save.js';
import { WorldImport } from '../server/world-import.js';
import { Simulation } from '../server/simulation.js';
import { clipCamera } from '../client/camera.js';
import { StoneReceiver, stonePackets, STONE_SYNC, type StonePacket } from '../shared/excavation-sync.js';
import { carvedCave, excavationStress } from './mining-fixture.js';
import { creatureClear } from '../shared/creatures.js';
import { suppliesNear, supplyPosition } from '../shared/forage.js';

test('large terrain synchronization is paced, atomic and includes edits made during transfer', () => {
  const source = new Excavation();
  for(let n=0;n<SCULPT.roomLimit;n++) assert(source.dig({x:100+n%128,y:-1,z:100+Math.floor(n/128),owner:`${'a'.repeat(38)}${Math.floor(n/SCULPT.playerLimit)}`},n<SCULPT.veinLimit));
  const receiver = new StoneReceiver(), packets = [...stonePackets(source.state(7919),7)]; source.drain(7919);
  assert.equal(packets.length,82); assert(packets.every(p=>JSON.stringify(p).length<11000));
  assert.equal(receiver.receive(packets[0],0),undefined);
  source.mend(100,-1,100); assert(receiver.changes(source.drain(7919) as ExcavationChanges));
  for(const packet of packets.slice(1,-1)) assert.equal(receiver.receive(packet,1000),undefined);
  const result=receiver.receive(packets.at(-1)!,1000); assert(result);assert.equal(result.seed,7919);assert.deepEqual(result.excavation.state(7919),source.state(7919));assert(!receiver.active);
  receiver.receive(packets[0],0);assert.equal(receiver.receive({...packets[1],offset:128} as StonePacket,1),false);
  receiver.receive(packets[0],0);assert(receiver.expire(STONE_SYNC.timeout+1));assert(!receiver.active);
  receiver.receive(packets[0],0); assert.equal(receiver.receive(packets.at(-1)!,1),false);
  receiver.receive(packets[0],0); assert(!receiver.changes({seed:7919,revision:99999,edits:Array(257).fill([1,1,-1,1,'a',false])}));
  assert.equal(receiver.receive({...packets[0],cuts:SCULPT.roomLimit+1} as StonePacket,0),false);
});

test('preview caves and full-capacity terrain remain valid portable worlds, with companion headroom', () => {
  const {sim,p}=singers(); Object.assign(p,carvedCave(sim.world));assert(restoreWorld(saveWorld(sim.world)));assert(creatureClear(p.x,p.z,sim.world,false,p.y+.4,.35));
  const head=ceilingHeight(p.x,p.z,p.y,sim.world);assert(head-p.y>=3); assert(!nativeSolid({x:p.x,y:p.y+1,z:p.z},sim.world));
  excavationStress(sim.world);assert.equal(sim.world.excavation!.size,SCULPT.roomLimit);assert(restoreWorld(saveWorld(sim.world)));
});

function singers() {
  const sim = new Simulation(7919), p = sim.add('singer', 'Singer'), guest = sim.add('friend', 'Friend');
  sim.phase = 'active'; sim.mode = 'expedition'; sim.world.upgrades = ECHO_CHISEL;
  return { sim, p, guest };
}
function clearBody(p: Player, sim: Simulation) {
  return !worldBoxes(p.x - .4, p.z - .4, p.x + .4, p.z + .4, 'wilds', sim.world).some(b => Math.abs(p.x - b.x) < b.w / 2 + .4 && Math.abs(p.z - b.z) < b.d / 2 + .4 && p.y < (b.y ?? 0) + b.h && p.y + HEIGHT > (b.y ?? 0));
}
function surfaceFixture() {
  const f = singers(), { sim, p } = f;
  for (let x = 40; x < 160; x += 2) for (let z = -180; z < -40; z += 2) {
    const h = terrainHeight(x + .5, z + .5, sim.world.seed), y = Math.floor(h - .01);
    if (h < 3 || sculptReason({ x, y, z }, sim.world)) continue;
    const px = x + .5, pz = z + 3.5, py = terrainHeight(px, pz, sim.world.seed);
    Object.assign(p, { realm: 'wilds', x: px, y: py, z: pz, yaw: 0, pitch: Math.atan2(h - .015 - py - EYE, 3), grounded: true, vy: 0 });
    if (!clearBody(p, sim)) continue;
    const target = sculptTarget(p, sim.world);
    if (target?.valid && target.x === x && target.z === z && target.stratum.vein === undefined) return { ...f, target };
  }
  throw Error('No clear mining fixture');
}
function control(sim: Simulation, p: Player, n: number, input: Partial<ReturnType<typeof idleInput>> = {}) {
  for (let k = 0; k < n; k++) { sim.input(p.id, { ...idleInput(), seq: p.ack + 1, yaw: p.yaw, pitch: p.pitch, sculpting: true, attack: true, ...input }); sim.step(); }
}
function caveFixture() {
  const f = singers(), { sim, p } = f;
  for (let x = 6; x < 9; x++) for (let z = -9; z < -5; z++) for (let y = -4; y < -2; y++) assert(sim.world.excavation!.dig({ x, y, z, owner: p.id }));
  sim.world.excavation!.drain(sim.world.seed);
  Object.assign(p, { realm: 'wilds', x: 7.5, y: -4, z: -7.5, yaw: 0, pitch: 0, vy: 0, grounded: true });
  return f;
}
function veinFixture() {
  const f = singers(), { sim, p } = f;
  for (let x = 40; x < 160; x++) for (let z = -180; z < -40; z++) {
    const y = Math.floor(terrainHeight(x + .5, z + .5, sim.world.seed)) - 4;
    if (y < -9 || stratumAt(x, y, z, sim.world.seed).vein === undefined || sculptReason({ x, y, z }, sim.world)) continue;
    const cells: StoneCell[] = [];
    for (let bx = x - 3; bx < x; bx++) for (let bz = z - 1; bz <= z + 1; bz++) for (let by = y - 1; by <= y + 1; by++) cells.push([bx, by, bz]);
    if (cells.some(([x, y, z]) => sculptReason({ x, y, z }, sim.world) || terrainHeight(x + .5, z + .5, sim.world.seed) < y + 1.5)) continue;
    for (const [x, y, z] of cells) assert(sim.world.excavation!.dig({ x, y, z, owner: p.id }, stratumAt(x, y, z, sim.world.seed).vein !== undefined));
    sim.world.excavation!.drain(sim.world.seed);
    Object.assign(p, { realm: 'wilds', x: x - 1.5, y: y - 1, z: z + .5, yaw: -Math.PI / 2, pitch: Math.atan2(-.12, 2), vy: 0, grounded: true });
    const target = sculptTarget(p, sim.world);
    if (target?.valid && target.x === x && target.y === y && target.z === z) return { ...f, target };
    sim.world.excavation = new Excavation();
  }
  throw Error('No exposed crystal seam fixture');
}

test('excavations replicate negative cells atomically and preserve spent seams after mending', () => {
  const source = new Excavation(), peer = new Excavation();
  assert(source.dig({ x: -25, y: -3, z: -25, owner: 'a' }, true)); assert(source.dig({ x: -24, y: -3, z: -25, owner: 'b' })); assert(source.mend(-25, -3, -25));
  const changes = source.drain(7919) as ExcavationChanges;
  assert(peer.apply(changes)); assert(peer.apply(changes)); assert.deepEqual(peer.state(7919), source.state(7919)); assert(peer.claimed(-25, -3, -25)); assert(!peer.column(-25, -25));
  const before = peer.state(7919);
  assert(!peer.apply({ seed: 7919, revision: 5, edits: [[4, 2, -1, 2, 'b', false], [6, 3, -1, 2, 'b', false]] })); assert.deepEqual(peer.state(7919), before);
  assert(!peer.restore({ ...before, cuts: [...before.cuts, before.cuts[0]] })); assert.deepEqual(peer.state(7919), before);
  assert(!peer.restore({ ...before, veins: [...before.veins, before.veins[0]] })); assert.deepEqual(peer.state(7919), before);
});

test('room and explorer excavation limits refund openings, while history and seam credit stay bounded', () => {
  const cuts = new Excavation();
  for (let n = 0; n < SCULPT.roomLimit; n++) assert(cuts.dig({ x: 40 + n % 128, y: -1, z: 100 + Math.floor(n / 128), owner: `owner:${Math.floor(n / SCULPT.playerLimit)}` }));
  assert(!cuts.dig({ x: 300, y: -1, z: 300, owner: 'new' })); assert.equal(cuts.count('owner:0'), SCULPT.playerLimit);
  assert(cuts.mend(40, -1, 100)); assert(cuts.dig({ x: 300, y: -1, z: 300, owner: 'owner:0' }, true)); assert.equal(cuts.size, SCULPT.roomLimit);
  assert.equal(cuts.changedSince(0), undefined); assert.equal(cuts.changedSince(cuts.revision - 1)!.length, 1);
  assert(cuts.mend(300, -1, 300)); assert(cuts.claimed(300, -1, 300)); assert.equal(cuts.veinCount, 1);
  for (const [x, y, z] of [[4096, 0, 0], [0, -13, 0], [0, 32, 0], [1.5, 0, 0]]) assert(!cuts.dig({ x, y, z, owner: 'new' }));
});

test('cave floor, roof and density distinguish open space from the hill above it', () => {
  const { sim, p } = caveFixture();
  assert.equal(floorHeight(p.x, p.z, p.y, sim.world), -4); assert.equal(ceilingHeight(p.x, p.z, p.y, sim.world), -2); assert.equal(surfaceHeight(p.x, p.z, sim.world), 0);
  assert(!nativeSolid({ x: p.x, y: -3, z: p.z }, sim.world)); assert(nativeSolid({ x: p.x, y: -1, z: p.z }, sim.world));
  assert(!nativeBox(7.2, -3.99, -7.8, 7.8, -2.2, -7.2, sim.world)); assert(nativeBox(7.2, -3.99, -7.8, 7.8, -1.9, -7.2, sim.world));
});

test('ordinary movement stays on a cave floor and stops at native walls', () => {
  const { sim, p } = caveFixture();
  for (let n = 0; n < 180; n++) move(p, { ...idleInput(), z: 1 }, DT, false, sim.world);
  assert(Math.abs(p.y + 4) < .001); assert(p.z >= -9 + .34 - .002 && p.z < -8.6); assert(p.grounded);
  for (let n = 0; n < 180; n++) move(p, { ...idleInput(), x: 1 }, DT, false, sim.world);
  assert(p.x <= 9 - .34 + .002); assert(p.y === -4);
});

test('jumping, dashing and knockback cannot tunnel through a native roof or wall', () => {
  const { sim, p } = caveFixture();
  let peak = p.y;
  for (let n = 0; n < 80; n++) { move(p, { ...idleInput(), jump: n === 0 }, DT, false, sim.world); peak = Math.max(peak, p.y); }
  assert(peak > -4); assert(peak + HEIGHT <= -2 + .001); assert(p.grounded); assert.equal(p.y, -4);
  p.vz = -24; for (let n = 0; n < 40; n++) move(p, { ...idleInput(), dash: n === 0 }, DT, false, sim.world);
  assert(p.z >= -8.662); assert.equal(p.y, -4);
});

test('native ray and third-person camera stop on the same cave walls and roofs', () => {
  const { sim } = caveFixture();
  const a = { x: 7.5, y: -3, z: -6 }, b = { x: 7.5, y: -3, z: -12 };
  assert(Math.abs(nativeRay(a, b, sim.world) - .5) < 1e-6); assert(Math.abs(wallHit(a, b, 'wilds', sim.world) - .5) < 1e-6);
  const camera = clipCamera(a, b, .2, 'wilds', sim.world); assert(camera.z > -9 && camera.z < -8.5);
  const throughRoof = nativeRay({ x: 7.5, y: 1, z: -7.5 }, { x: 7.5, y: -3, z: -7.5 }, sim.world); assert(Math.abs(throughRoof - .25) < 1e-6);
});

test('arrows survive below sea level until they actually meet a cave surface', () => {
  const { sim, p } = caveFixture();
  sim.arrows.push({ id: 1, owner: p.id, realm: 'wilds', x: 7.5, y: -3, z: -6, vx: 0, vy: 0, vz: -10, damage: 35, age: 0 });
  control(sim, p, 5, { sculpting: false, attack: false }); assert.equal(sim.arrows.length, 1); assert(sim.arrows[0].y < 0);
  control(sim, p, 80, { sculpting: false, attack: false }); assert.equal(sim.arrows.length, 0);
});

test('surface mesh opens a mined cell and merges adjacent caves without internal faces', () => {
  const cuts = new Excavation(); assert(cuts.dig({ x: 6, y: -1, z: -6, owner: 'a' }));
  const before = buildTerrainChunk(0, -1, 7919), one = buildTerrainChunk(0, -1, 7919, cuts.geometry(-1, -25, 24, 0));
  assert.equal(one.indices.length, before.indices.length - 6); assert.equal(one.caves!.indices.length, 30);
  assert(cuts.dig({ x: 7, y: -1, z: -6, owner: 'a' })); const two = buildTerrainChunk(0, -1, 7919, cuts.geometry(-1, -25, 24, 0));
  assert.equal(two.indices.length, before.indices.length - 12); assert.equal(two.caves!.indices.length, 48);
  assert(cuts.mend(6, -1, -6)); assert(cuts.mend(7, -1, -6)); const closed = buildTerrainChunk(0, -1, 7919, cuts.geometry(-1, -25, 24, 0)); assert.deepEqual(closed.indices, before.indices); assert.equal(closed.caves, undefined);
});

test('underground openings retain native roofs and every drawn face borders the same density', () => {
  const cuts = new Excavation(); assert(cuts.dig({ x: 6, y: -3, z: -6, owner: 'a' }));
  const chunk = buildTerrainChunk(0, -1, 7919, cuts.geometry(-1, -25, 24, 0)), mesh = chunk.caves!, world = { seed: 7919, doorOpen: true, excavation: cuts };
  assert.equal(chunk.indices.length, buildTerrainChunk(0, -1, 7919).indices.length); assert.equal(mesh.indices.length, 36);
  for (let n = 0; n < mesh.indices.length; n += 3) {
    const ids = [mesh.indices[n], mesh.indices[n + 1], mesh.indices[n + 2]], normal = Array.from(mesh.normals.slice(ids[0] * 3, ids[0] * 3 + 3));
    const center = [0, 0, 0].map((_, axis) => ids.reduce((sum, id) => sum + mesh.positions[id * 3 + axis] / 3, 0)); center[2] -= 24;
    const point = (sign: number) => ({ x: center[0] + normal[0] * .002 * sign, y: center[1] + normal[1] * .002 * sign, z: center[2] + normal[2] * .002 * sign });
    assert(!nativeSolid(point(1), world)); assert(nativeSolid(point(-1), world));
  }
  assert([...mesh.positions, ...mesh.normals, ...mesh.uv, ...mesh.colors].every(Number.isFinite));
});

test('a held stone song mines from authenticated aim without trusting submitted cells or progress', () => {
  const { sim, p, guest, target } = surfaceFixture();
  const forged = { ...idleInput(), seq: 1, sculpting: true, attack: true, yaw: p.yaw, pitch: p.pitch, owner: guest.id, cell: [999, -12, 999], progress: 100 };
  assert(validInput(forged)); sim.input(p.id, forged); sim.step(); assert.equal(sim.world.excavation!.size, 0); assert((p.sculptProgress ?? 0) < 100);
  control(sim, p, target.stratum.ticks - 2); assert.equal(sim.world.excavation!.size, 0);
  control(sim, p, 1); assert.equal(sim.world.excavation!.size, 1); assert.equal(sim.world.excavation!.get(target.x, target.y, target.z)!.owner, p.id); assert(!sim.world.excavation!.get(999, -12, 999));
  assert.equal(p.kills, 0); assert.equal(p.damage, 0); assert.equal(guest.xp, 0);
});

test('release, tool switching and stale controls cancel unfinished mining', () => {
  for (const change of [{ attack: false }, { sculpting: false }]) {
    const { sim, p } = surfaceFixture(); control(sim, p, 15); assert((p.sculptProgress ?? 0) > 0); control(sim, p, 1, change); assert.equal(p.sculptProgress, 0); assert.equal(sim.world.excavation!.size, 0);
  }
  const { sim, p } = surfaceFixture(); control(sim, p, 1); for (let n = 0; n < 70; n++) sim.step(); assert.equal(sim.world.excavation!.size, 0); assert.equal(p.sculptProgress, 0); assert(!p.sculpting);
});

test('the party crafts one chisel, and locked, dead, disconnected or citadel actors cannot mine', () => {
  const { sim, p, guest } = singers(); sim.world.upgrades = 0; sim.world.supplies = [20, 20, 20]; Object.assign(p, { realm: 'wilds', x: 0, z: -5, y: 0 });
  assert(sim.craft(p.id, 'chisel')); assert.equal(sim.world.upgrades, ECHO_CHISEL); assert.deepEqual(sim.world.supplies, [12, 4, 16]);
  sim.tick += 60; Object.assign(guest, { realm: 'wilds', x: 0, z: -5, y: 0 }); assert(!sim.craft(guest.id, 'chisel')); assert.deepEqual(sim.world.supplies, [12, 4, 16]);
  for (const patch of [{ realm: 'arena' as const }, { alive: false }, { connected: false }]) { const f = surfaceFixture(); Object.assign(f.p, patch); control(f.sim, f.p, 100); assert.equal(f.sim.world.excavation!.size, 0); }
  const f = surfaceFixture(); f.sim.world.upgrades = 0; control(f.sim, f.p, 100); assert.equal(f.sim.world.excavation!.size, 0);
  assert(!validInput({ ...idleInput(), weaving: true, sculpting: true })); assert(!validInput({ ...idleInput(), sculpting: 1 }));
});

test('damage interrupts a stone song and keeps mining unavailable for five seconds', () => {
  const { sim, p, guest } = surfaceFixture(); control(sim, p, 20); sim.mode = 'ffa'; guest.realm = 'wilds';
  sim.damage(p, guest, 5); assert.equal(p.sculptProgress, 0); control(sim, p, 290); assert.equal(sim.world.excavation!.size, 0);
  control(sim, p, 70); assert(sim.world.excavation!.size > 0);
});

test('same-tick projectile damage cancels a completing stone song, including a totem save', () => {
  for(const fatal of [false,true]){const {sim,p,guest,target}=surfaceFixture();sim.mode='ffa';p.immuneUntil=0;control(sim,p,target.stratum.ticks-1);guest.realm='wilds';p.hp=fatal?25:100;
    sim.arrows.push({id:1,owner:guest.id,realm:'wilds',x:p.x,y:p.y+1,z:p.z,vx:0,vy:0,vz:0,damage:35,age:0});control(sim,p,1,{offhand:'totem'});
    assert.equal(sim.world.excavation!.size,0);assert.equal(p.sculptProgress,0);assert(p.alive);if(fatal)assert.equal(p.totems,0);
  }
});

test('companions reach a clear cave floor and mending respects their bodies', () => {
  const {sim,p}=singers();Object.assign(p,carvedCave(sim.world));sim.step();const c=[...sim.ecosystem.creatures.values()].find(c=>c.kind<4)!;assert(c);Object.assign(c,{owner:p.id,x:p.x,y:p.y+10,z:p.z,blinkAt:0});
  for(let n=0;n<6;n++)sim.step();assert(Math.abs(c.y-p.y)<2);assert(!nativeSolid({x:c.x,y:c.y+.8,z:c.z},sim.world));assert(creatureClear(c.x,c.z,sim.world,false,c.y+.4,.35));
  const reason=sculptReason({x:Math.floor(c.x),y:Math.floor(c.y),z:Math.floor(c.z)},sim.world,[c],true);assert.equal(reason,'Leave room for every explorer');
});

test('gatherable surface patches follow a carved floor and spent seam credit cannot be omitted from a save', () => {
  const {sim,p}=singers(), node=suppliesNear(44,-60,sim.world.seed,160).find(n=>!sculptReason({x:Math.floor(n.x),y:Math.floor(n.y-.001),z:Math.floor(n.z)},sim.world))!;assert(node);
  const x=Math.floor(node.x),z=Math.floor(node.z),y=Math.floor(node.y-.001);assert(sim.world.excavation!.dig({x,y,z,owner:p.id},stratumAt(x,y,z,sim.world.seed).vein!==undefined));assert(supplyPosition(node,sim.world).y<node.y);assert.equal(supplyPosition(node,sim.world).y,surfaceHeight(node.x,node.z,sim.world));
  const v=veinFixture();control(v.sim,v.p,72);const save=saveWorld(v.sim.world);assert(!restoreWorld({...save,veins:[]}));
});

test('mending respects player bodies, woven rooms and ownership, including reconnecting explorers', () => {
  const { sim, p, guest, target } = surfaceFixture(); control(sim, p, target.stratum.ticks);
  const { x, y, z } = target; Object.assign(guest, { realm: 'wilds', x: x + .5, y, z: z + .5, connected: false });
  assert.equal(sculptReason(target, sim.world, [guest], true), 'Leave room for every explorer'); control(sim, p, 45, { attack: false, block: true }); assert(sim.world.excavation!.has(x, y, z));
  guest.realm = 'arena'; sim.world.construction!.place({ x, y, z, owner: p.id, kind: 4 }); assert.match(sculptReason(target, sim.world, [], true), /Rune build/); sim.world.construction!.erase(x, y, z);
  const mend = sculptTarget(p, sim.world, true, [], true); assert(mend?.valid); assert.deepEqual([mend.x, mend.y, mend.z], [x, y, z]);
  const outsider = { ...p, id: guest.id }; assert(!sculptTarget(outsider, sim.world, true)?.valid); assert(sculptTarget(outsider, sim.world, true, [], true)?.valid);
  control(sim, p, 30, { attack: false, block: true }); assert(!sim.world.excavation!.has(x, y, z));
});

test('native foundations, tree roots and world bounds cannot be excavated or imported away', () => {
  const { sim } = singers(); assert.match(sculptReason({ x: 0, y: -1, z: 0 }, sim.world), /foundations/); assert.match(sculptReason({ x: 4000, y: -13, z: 4000 }, sim.world), /foundation/);
  const saved = saveWorld(sim.world); assert(!restoreWorld({ ...saved, cuts: [[0, -1, 0]] })); assert(!restoreWorld({ ...saved, cuts: [[4096, -1, 100]] })); assert(!restoreWorld({ ...saved, cuts: [[50, 31, 50]] }));
});

test('crystal seams reward only their first song even after mending and portable restoration', () => {
  const { sim, p, target } = veinFixture(), vein = target.stratum.vein!;
  control(sim, p, 72); assert.equal(sim.world.supplies![vein], 4); assert(sim.world.excavation!.claimed(target.x, target.y, target.z));
  control(sim, p, 30, { attack: false, block: true }); assert(!sim.world.excavation!.has(target.x, target.y, target.z));
  control(sim, p, 72); assert.equal(sim.world.supplies![vein], 4);
  const world = restoreWorld(saveWorld(sim.world)); assert(world); assert(world.excavation!.claimed(target.x, target.y, target.z)); assert.equal(world.supplies![vein], 4);
});

test('runes can form real underground shelters and cannot be woven into untouched stone', () => {
  const { sim, p, target } = surfaceFixture(); control(sim, p, target.stratum.ticks);
  const cell = { x: target.x, y: target.y - 1, z: target.z }; assert(sim.world.excavation!.dig({ ...cell, owner: p.id }, stratumAt(cell.x, cell.y, cell.z, sim.world.seed).vein !== undefined));
  assert.equal(placementReason(cell, sim.world), ''); assert(sim.world.construction!.place({ ...cell, kind: 4, owner: p.id }));
  assert(placementReason({ x: cell.x + 1, y: cell.y, z: cell.z }, sim.world));
  const save = saveWorld(sim.world), restored = restoreWorld(save); assert(restored); assert(restored.construction!.get(cell.x, cell.y, cell.z)); assert.deepEqual(saveWorld(restored), save);
});

test('version-four worlds retain mines, spent seams and underground builds while earlier formats still load', () => {
  const { sim, p, target } = surfaceFixture(); control(sim, p, target.stratum.ticks); sim.world.bonds = 15; sim.world.guardians = 510;
  const save = saveWorld(sim.world, 'Our hollow hill'); assert.equal(save.version, 4); assert.equal(save.cuts!.length, 1); assert(!JSON.stringify(save).includes(p.id)); assert.deepEqual(parseWorldSave(JSON.stringify(save)), save);
  const restored = restoreWorld(save)!; assert.equal(restored.excavation!.size, 1); assert.equal(restored.bonds, 15); assert.equal(restored.guardians, 510);
  for (const patch of [{ cuts: [save.cuts![0], save.cuts![0]] }, { veins: [[save.cuts![0][0], 31, save.cuts![0][2]]] }, { upgrades: 8 }, { upgrades: 0 }, { cuts: undefined }, { veins: undefined }]) assert(!restoreWorld({ ...save, ...patch }));
  const empty = saveWorld(singers().sim.world);
  for (const version of [1, 2, 3] as const) { const legacy = { ...empty, version, upgrades: 0 }; delete legacy.cuts; delete legacy.veins; assert(restoreWorld(legacy)); assert.equal(restoreWorld(legacy)!.excavation!.size, 0); }
});

test('separate bounded upload streams require complete terrain data before an atomic host restore', () => {
  const { sim, p, target } = surfaceFixture(); control(sim, p, target.stratum.ticks); const save = saveWorld(sim.world), { blocks, cuts = [], veins = [], ...header } = save;
  const upload = new WorldImport(); assert(upload.begin(header, blocks.length, 0, cuts.length, veins.length)); assert.equal(upload.finish(1), undefined);
  assert(upload.begin(header, 0, 0, cuts.length, 0)); assert(upload.chunk(0, cuts, 1, 'cuts')); assert.deepEqual(upload.finish(2), save);
  assert(upload.begin(header, 0, 0, 1, 0)); assert(!upload.chunk(1, cuts, 1, 'cuts')); assert.equal(upload.finish(2), undefined);
  assert(upload.begin(header, 0, 0, 1, 0)); assert(!upload.chunk(0, cuts, 1, 'unknown')); assert.equal(upload.finish(2), undefined);
  assert(!upload.begin(header, 0, 0, SCULPT.roomLimit + 1, 0)); assert(!upload.begin({ ...header, version: 3, upgrades: 0 }, 0, 0, 1, 0));
  sim.phase = 'waiting'; const guest = sim.players.get('friend')!; p.ready = guest.ready = true;
  assert(!sim.restore(guest.id, save)); assert(sim.restore(p.id, save)); assert(!p.ready && !guest.ready); assert.equal(sim.world.excavation!.size, cuts.length);
});
