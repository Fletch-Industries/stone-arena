import { excavationStress } from './mining-fixture.js';
import { Excavation, SCULPT, stoneKey, type ExcavationState, type ExcavationChanges } from '../shared/excavation.js';
import { StoneReceiver, type StonePacket } from '../shared/excavation-sync.js';
import { sculptReason, stratumAt } from '../shared/mining.js';
import assert from 'node:assert/strict';
import { Client, type Room } from '@colyseus/sdk';
import { BUILD, Construction, type ConstructionState, type ConstructionChanges } from '../shared/construction.js';
import { terrainHeight } from '../shared/world.js';
import { placementReason } from '../shared/weaving.js';
import { saveWorld } from '../shared/world-save.js';
import { Forage, type ForageState, type ForageChanges, type Supplies } from '../shared/forage.js';
import { VERSION, type Snapshot } from '../shared/game.js';

const client = new Client(process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107'), rooms: Room[] = [], states = new Map<Room, Snapshot>(), geometry = new Map<Room, Construction>();
const stoneSizes:number[] = [], transfers:number[] = [], cutsByRoom = new Map<Room,Excavation>();
const pingSamples: number[] = [], fullSizes: number[] = [], forageSizes: number[] = [], snapshotSizes: number[] = [];
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) { const end = Date.now() + 12000; while (!check()) { if (Date.now() > end) throw Error('World capacity timed out'); await wait(25); } }
function track(room: Room) {
  rooms.push(room); cutsByRoom.set(room,new Excavation()); const receiver=new StoneReceiver();
  room.onMessage('excavation',(state:ExcavationState)=>{const cuts=new Excavation();assert(cuts.restore(state));cutsByRoom.set(room,cuts);receiver.clear();});
  room.onMessage('excavationChanges',(delta:ExcavationChanges)=>{if(receiver.active)assert(receiver.changes(delta));else assert(cutsByRoom.get(room)!.apply(delta));});
  room.onMessage('excavationStream',(packet:StonePacket)=>{stoneSizes.push(Buffer.byteLength(JSON.stringify(packet)));if(packet.type==='begin')transfers.push(packet.token);const result=receiver.receive(packet,performance.now());assert.notEqual(result,false);if(result)cutsByRoom.set(room,result.excavation);});
  const blocks = new Construction(); geometry.set(room, blocks); room.reconnection.enabled = false;
  room.onMessage('construction', (full: ConstructionState) => { assert(blocks.restore(full)); fullSizes.push(Buffer.byteLength(JSON.stringify(full))); });
  room.onMessage('constructionChanges', (delta: ConstructionChanges) => assert(blocks.apply(delta)));
  const field = new Forage();
  room.onMessage('forage', (full: ForageState) => { assert(field.restore(full)); forageSizes.push(Buffer.byteLength(JSON.stringify(full))); });
  room.onMessage('forageChanges', (delta: ForageChanges) => assert(field.apply(delta)));
  room.onMessage('snapshot', (state: Snapshot) => { snapshotSizes.push(Buffer.byteLength(JSON.stringify(state))); state.world.construction = blocks; state.world.excavation = cutsByRoom.get(room); states.set(room, state); });
  room.onMessage('pong', (stamp: number) => pingSamples.push(Date.now() - stamp)); room.onMessage('latency', (stamp: number) => room.send('latencyAck', stamp)); room.onMessage('worldRestored', () => {});
  room.onMessage('actionError', (message: string) => { throw Error(message); }); room.send('sync'); return room;
}
try {
  const host = track(await client.create('arena', { name: 'World builder', version: VERSION, private: true }));
  let guest = track(await client.joinById(host.roomId, { name: 'World observer', version: VERSION }));
  await until(() => [host, guest].every(r => states.get(r)?.players.length === 2));
  const world = { seed: states.get(host)!.world.seed, doorOpen: true, waystones: 511, supplies: [999,999,999] as Supplies, upgrades: 7, construction: new Construction(), excavation: new Excavation() };
  excavationStress(world); assert.equal(world.excavation.size,SCULPT.roomLimit);
  const claims=[...world.excavation.claimedCells()],keys=new Set(claims.map(c=>stoneKey(...c)));
  for(let x=40;x<400&&claims.length<SCULPT.veinLimit;x++)for(let z=-300;z<-40&&claims.length<SCULPT.veinLimit;z++)for(let y=-11;y<-4&&claims.length<SCULPT.veinLimit;y++){
    if(keys.has(stoneKey(x,y,z))||sculptReason({x,y,z},world)||stratumAt(x,y,z,world.seed).vein===undefined)continue;claims.push([x,y,z]);keys.add(stoneKey(x,y,z));
  }
  assert.equal(claims.length,SCULPT.veinLimit);assert(world.excavation.restore({...world.excavation.state(world.seed),veins:claims}));
  for (let x = 32; x < 200 && world.construction.size < BUILD.roomLimit; x++) for (let z = -200; z < -32 && world.construction.size < BUILD.roomLimit; z++) {
    const cell = { x, y: Math.floor(terrainHeight(x + .5, z + .5, world.seed)), z };
    if (!placementReason(cell, world)) assert(world.construction.place({ ...cell, kind: world.construction.size % 7, owner: `plot:${Math.floor(world.construction.size / BUILD.playerLimit)}` }));
  }
  assert.equal(world.construction.size, BUILD.roomLimit);
  const save = saveWorld(world, 'Full capacity playground'), { blocks, cuts = [], veins = [], ...header } = save;
  host.send('worldRestore', { type: 'begin', header, count: blocks.length, cutsCount:cuts.length, veinsCount:veins.length });
  for(const [kind,rows] of [['blocks',blocks],['cuts',cuts],['veins',veins]]as const)for (let offset = 0; offset < rows.length; offset += 64) { const message = { type: 'chunk', kind, offset, blocks: rows.slice(offset, offset + 64) }; assert(Buffer.byteLength(JSON.stringify(message)) < 4096); host.send('worldRestore', message); guest.send('ping', Date.now()); await wait(35); }
  host.send('worldRestore', { type: 'commit' }); await until(() => [host, guest].every(r => geometry.get(r)!.size === BUILD.roomLimit && cutsByRoom.get(r)!.size === SCULPT.roomLimit && cutsByRoom.get(r)!.veinCount === SCULPT.veinLimit));
  assert.deepEqual(saveWorld(states.get(guest)!.world, save.title), save);
  // Repeated normal recovery requests cannot flood full-state packets.
  const before = fullSizes.length, forageBefore = forageSizes.length, stoneBefore = transfers.length; for (let n = 0; n < 10; n++) { host.send('constructionSync'); host.send('forageSync'); host.send('excavationSync'); host.send('sync'); } await wait(200); assert(fullSizes.length - before <= 1); assert(forageSizes.length - forageBefore <= 1);assert(transfers.length-stoneBefore<=1);
  const token = guest.reconnectionToken, id = guest.sessionId; guest.connection.close(); await until(() => states.get(host)?.players.find(p => p.id === id)?.connected === false);
  guest = track(await client.reconnect(token)); await until(() => geometry.get(guest)!.size === BUILD.roomLimit && cutsByRoom.get(guest)!.size === SCULPT.roomLimit); assert.equal(guest.sessionId, id); assert.deepEqual(geometry.get(guest)!.state(world.seed), geometry.get(host)!.state(world.seed));
  await until(() => states.get(guest)?.world.upgrades === 7); assert.deepEqual(states.get(guest)!.world.supplies, [999,999,999]);
  for (let n = 0; n < 20; n++) { host.send('ping', Date.now()); guest.send('ping', Date.now()); await wait(50); }
  assert(host.connection.isOpen && guest.connection.isOpen);assert.deepEqual(cutsByRoom.get(guest)!.state(world.seed),cutsByRoom.get(host)!.state(world.seed));assert(Math.max(...stoneSizes)<11000); assert(Math.max(...fullSizes) < 150_000); assert(Math.max(...snapshotSizes) < 12000); assert(pingSamples.length >= 40);
  const sorted = pingSamples.sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * .95)]; assert(p95 < 1000);
  console.log(`PASS: 4,096 runes, 8,192 native openings and 2,048 spent seams restored and reconnected in two ordinary clients; full state ${Math.max(...fullSizes)} bytes, terrain part ${Math.max(...stoneSizes)} bytes, snapshots ${Math.max(...snapshotSizes)} bytes, ping p95 ${p95} ms; recovery requests stayed bounded`);
} finally { await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave())); }
