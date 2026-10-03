import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { VERSION, idleInput, type Snapshot } from '../shared/game.js';

const client = new Client(process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107');
const rooms: Room[] = [], states = new Map<Room, Snapshot>();
let timer: ReturnType<typeof setInterval> | undefined, seq = 0, corner = false, attacking = true;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() > end) throw Error('Totem integration timed out'); await wait(30); }
}
function track(room: Room) {
  rooms.push(room); room.onMessage('snapshot', (s: Snapshot) => states.set(room, s));
  room.onMessage('latency', (n: number) => room.send('latencyAck', n)); room.onMessage('pong', () => {});
  room.send('sync'); return room;
}
try {
  const a = track(await client.create('arena', { name: 'Totem attacker', version: VERSION }));
  const b = track(await client.joinById(a.roomId, { name: 'Totem bearer', version: VERSION }));
  await until(() => states.get(a)?.players.length === 2);
  a.send('ready'); b.send('ready'); await until(() => states.get(a)!.players.every(p => p.ready));
  a.send('start'); await until(() => states.get(b)?.phase === 'active');
  // Approach through the clear outside corridor with ordinary client controls.
  timer = setInterval(() => {
    const s = states.get(a), attacker = s?.players.find(p => p.id === a.sessionId), target = s?.players.find(p => p.id === b.sessionId);
    if (!attacker || !target) return;
    if (target.totems === 0) attacking = false;
    if (Math.abs(attacker.z - target.z) < .5) corner = true;
    const dx = corner ? target.x - attacker.x : 0, dz = target.z - attacker.z;
    const near = corner && Math.hypot(dx, dz) < 2.4;
    a.send('input', { ...idleInput(), seq: ++seq, yaw: Math.atan2(-dx, -dz), pitch: near ? Math.atan2(-.4, Math.hypot(dx, dz)) : 0, z: near ? 0 : 1, sprint: !near, attack: near && attacking });
    b.send('input', { ...idleInput(), seq: ++seq, offhand: 'totem', block: true });
  }, 33);
  await until(() => rooms.every(r => states.get(r)?.players.some(p => p.id === b.sessionId && p.totems === 0)));
  clearInterval(timer); timer = undefined;
  a.send('input', { ...idleInput(), seq: ++seq });
  for (const room of rooms) {
    const s = states.get(room)!, p = s.players.find(p => p.id === b.sessionId)!;
    assert.equal(p.hp, 20); assert.equal(p.alive, true); assert.equal(p.block, false); assert.equal(p.offhand, 'totem');
    assert.equal(s.phase, 'active'); assert.equal(s.events.filter(e => e.type === 'totem' && e.actor === b.sessionId).length, 1);
    assert.equal(s.players.find(p => p.id === a.sessionId)!.kills, 0);
  }
  // Swap hands twice: neither toggle may replenish the consumed item.
  b.send('input', { ...idleInput(), seq: ++seq, offhand: 'shield' });
  await until(() => rooms.every(r => states.get(r)?.players.some(p => p.id === b.sessionId && p.offhand === 'shield' && p.totems === 0)));
  b.send('input', { ...idleInput(), seq: ++seq, offhand: 'totem' });
  await until(() => rooms.every(r => states.get(r)?.players.some(p => p.id === b.sessionId && p.offhand === 'totem' && p.totems === 0)));
  await wait(600);
  timer = setInterval(() => {
    const s = states.get(a), attacker = s?.players.find(p => p.id === a.sessionId), target = s?.players.find(p => p.id === b.sessionId);
    if (!attacker || !target) return;
    const dx = target.x - attacker.x, dz = target.z - attacker.z, distance = Math.hypot(dx, dz);
    a.send('input', { ...idleInput(), seq: ++seq, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(-.4, distance), z: distance < 2.4 ? 0 : 1, attack: distance < 2.4 });
    b.send('input', { ...idleInput(), seq: ++seq, offhand: 'totem' });
  }, 33);
  await until(() => rooms.every(r => states.get(r)?.phase === 'results'));
  clearInterval(timer); timer = undefined;
  for (const room of rooms) {
    const s = states.get(room)!;
    assert.equal(s.winner, a.sessionId); assert.equal(s.players.find(p => p.id === b.sessionId)!.alive, false);
    assert.equal(s.events.filter(e => e.type === 'totem').length, 1);
  }
  await wait(3100); a.send('lobby');
  await until(() => rooms.every(r => states.get(r)?.phase === 'waiting'));
  for (const room of rooms) assert.equal(states.get(room)!.players.find(p => p.id === b.sessionId)!.totems, 1);
  console.log('PASS: both clients observed one two-heart save, consumed inventory, hand switching, subsequent elimination and rematch reset');
} finally {
  if (timer) clearInterval(timer);
  await Promise.all(rooms.map(room => room.leave()));
}
