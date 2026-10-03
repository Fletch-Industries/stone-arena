import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { VERSION, idleInput, type Snapshot } from '../shared/game.js';
import { navigator } from './navigation.js';
const client = new Client(process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107');
const rooms: Room[] = [], states = new Map<Room, Snapshot>();
let timer: ReturnType<typeof setInterval> | undefined, seq = 0;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, seconds = 60) {
  const end = Date.now() + seconds * 1000;
  while (!check()) { if (Date.now() > end) throw Error('Exploration timed out: ' + JSON.stringify([...states.values()].map(s => s.players.map(p => ({ x: p.x, y: p.y, z: p.z }))))); await wait(30); }
}
function track(room: Room) {
  rooms.push(room); room.onMessage('snapshot', (s: Snapshot) => states.set(room, s));
  room.onMessage('latency', (n: number) => room.send('latencyAck', n)); room.onMessage('pong', () => {});
  room.send('sync'); return room;
}
try {
  const explorer = track(await client.create('arena', { name: 'Explorer', version: VERSION, private: true }));
  const observer = track(await client.joinById(explorer.roomId, { name: 'Observer', version: VERSION }));
  await until(() => states.get(explorer)?.players.length === 2);
  explorer.send('ready'); observer.send('ready'); await until(() => states.get(explorer)!.players.every(p => p.ready));
  explorer.send('start'); await until(() => states.get(explorer)?.phase === 'active');
  for (const destination of [{ x: -21, z: -23 }, { x: 0, z: -9 }]) {
    const navigate = navigator();
    timer = setInterval(() => {
      const p = states.get(explorer)?.players.find(p => p.id === explorer.sessionId); if (!p) return;
      const distance = Math.hypot(p.x - destination.x, p.z - destination.z), point = distance < 1.5 ? [destination.x, destination.z] : navigate(p, destination);
      explorer.send('input', { ...idleInput(), seq: ++seq, yaw: Math.atan2(p.x - point[0], p.z - point[1]), z: 1, sprint: distance > 2 });
      observer.send('input', { ...idleInput(), seq: ++seq });
    }, 33);
    await until(() => rooms.every(r => states.get(r)?.players.some(p => p.id === explorer.sessionId && Math.hypot(p.x - destination.x, p.z - destination.z) < .35)));
    clearInterval(timer); timer = undefined;
    console.log('PASS: both clients observed ordinary movement to', destination);
  }
  timer = setInterval(() => {
    const p = states.get(explorer)?.players.find(p => p.id === explorer.sessionId); if (!p) return;
    explorer.send('input', { ...idleInput(), seq: ++seq, yaw: Math.atan2(p.x, 1), x: 0, z: p.z > -31 ? 1 : 0 });
    observer.send('input', { ...idleInput(), seq: ++seq });
  }, 33);
  await until(() => rooms.every(r => states.get(r)?.players.some(p => p.id === explorer.sessionId && p.y > 7.19 && p.z < -30)));
  for (const room of rooms) { const s = states.get(room)!; assert.equal(s.phase, 'active'); assert.equal(s.players.find(p => p.id === explorer.sessionId)!.hp, 100); }
  console.log('PASS: both clients observed climbing to the lookout deck without jumping; exploration did not end the round');
} finally {
  if (timer) clearInterval(timer);
  await Promise.all(rooms.map(room => room.leave()));
}
