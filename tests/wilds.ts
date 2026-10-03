import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { VERSION, idleInput, type Snapshot } from '../shared/game.js';
import { terrainHeight, worldBoxes } from '../shared/world.js';
import { navigator } from './navigation.js';
const client = new Client(process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107'), rooms: Room[] = [], states = new Map<Room, Snapshot>(), sequences = new Map<Room, number>();
let timer: ReturnType<typeof setInterval> | undefined;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, seconds = 80) { const end = Date.now() + seconds * 1000; while (!check()) { if (Date.now() > end) throw Error('Wilds timed out: ' + JSON.stringify([...states.values()].map(s => ({ world: s.world, players: s.players.map(p => ({ id: p.id, realm: p.realm, x: p.x, y: p.y, z: p.z, hp: p.hp })) })))); await wait(25); } }
function track(r: Room) { rooms.push(r); r.onMessage('snapshot', (s: Snapshot) => states.set(r, s)); r.onMessage('latency', (n: number) => r.send('latencyAck', n)); r.onMessage('pong', () => {}); r.onMessage('actionError', () => {}); r.reconnection.enabled = false; r.send('sync'); return r; }
const me = (r: Room) => states.get(r)!.players.find(p => p.id === r.sessionId)!;
function controls(r: Room, value = {}) { const seq = (sequences.get(r) ?? me(r).ack) + 1; sequences.set(r, seq); r.send('input', { ...idleInput(), seq, ...value }); }
async function walk(r: Room, x: number, z: number, stop = () => Math.hypot(me(r).x - x, me(r).z - z) < .5, path = true) {
  const navigate = navigator(); timer = setInterval(() => {
    const p = me(r), d = Math.hypot(p.x - x, p.z - z), point = path && d > 1.5 ? navigate(p, { x, z }) : [x, z];
    controls(r, { yaw: Math.atan2(p.x - point[0], p.z - point[1]), z: 1, sprint: d > 2 }); for (const other of rooms) if (other !== r && other.connection.isOpen) other.send('ping', Date.now());
  }, 33);
  try { await until(stop); } finally { clearInterval(timer); timer = undefined; if (r.connection.isOpen) controls(r); }
}
try {
  const host = track(await client.create('arena', { name: 'Wilds explorer', version: VERSION, private: true }));
  let guest = track(await client.joinById(host.roomId, { name: 'Terrain observer', version: VERSION }));
  await until(() => rooms.every(r => states.get(r)?.players.length === 2)); assert.equal(states.get(host)!.world.seed, states.get(guest)!.world.seed);
  host.send('ready'); guest.send('ready'); await until(() => states.get(host)!.players.every(p => p.ready)); host.send('start'); await until(() => states.get(host)?.phase === 'active');
  guest.send('interact'); await wait(100); assert(!states.get(host)!.world.doorOpen);
  await walk(host, -26, -46); host.send('interact'); await until(() => rooms.every(r => states.get(r)?.world.doorOpen === true));
  console.log('PASS: remote interaction rejected; nearby explorer opened a shared secret door');
  await walk(host, -26, -65, () => rooms.every(r => states.get(r)?.players.some(p => p.id === host.sessionId && p.realm === 'wilds') === true), false);
  assert.equal(me(host).hp, 100); assert.equal(me(guest).realm, 'arena');
  console.log('PASS: both clients observed traversing the passage into the Wilds');
  // Pick a clear radial route from the spawn, avoiding generated trunk/foliage
  // collisions through the same shared geometry used by ordinary movement.
  let target = { x: 0, z: -38 };
  for (let n = 0; n < 32; n++) {
    const candidate = { x: Math.sin(n * Math.PI / 16) * 38, z: -Math.cos(n * Math.PI / 16) * 38 };
    const clear = Array.from({ length: 38 }, (_, step) => ({ x: candidate.x * step / 38, z: candidate.z * step / 38 })).every(v => !worldBoxes(v.x, v.z, v.x, v.z, 'wilds', states.get(host)!.world).some(b => Math.abs(v.x - b.x) < b.w / 2 + .5 && Math.abs(v.z - b.z) < b.d / 2 + .5 && terrainHeight(v.x, v.z, states.get(host)!.world.seed) + 1.8 > (b.y ?? 0)));
    if (clear && terrainHeight(candidate.x, candidate.z, states.get(host)!.world.seed) > .5) { target = candidate; break; }
  }
  await walk(host, target.x, target.z, undefined, false);
  for (const r of rooms) { const s = states.get(r)!, p = s.players.find(p => p.id === host.sessionId)!; assert.equal(p.realm, 'wilds'); assert(Math.abs(p.y - terrainHeight(p.x, p.z, s.world.seed)) < .03); assert.equal(p.hp, 100); }
  console.log('PASS: shared procedural hills match authoritative footing for both clients');
  const seed = states.get(host)!.world.seed, oldId = guest.sessionId, token = guest.reconnectionToken; guest.connection.close();
  await until(() => me(host).connected && !states.get(host)!.players.find(p => p.id === oldId)!.connected, 5); guest = track(await client.reconnect(token));
  await until(() => states.get(guest)?.players.length === 2); assert.equal(states.get(guest)!.world.seed, seed); assert(states.get(guest)!.world.doorOpen);
  assert.equal(states.get(guest)!.players.find(p => p.id === host.sessionId)!.realm, 'wilds');
  await walk(host, 0, 0, undefined, false); await walk(host, 0, 10, () => me(host).realm === 'arena', false);
  assert.equal(me(host).hp, 100); assert(Math.abs(me(host).x + 26) < .01); assert(me(host).z < -59); assert.equal(states.get(host)!.phase, 'active');
  console.log('PASS: reconnect preserved world discovery; return tunnel restored arena location and health');
} finally { if (timer) clearInterval(timer); await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave())); }
