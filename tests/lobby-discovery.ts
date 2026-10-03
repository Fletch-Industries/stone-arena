import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { VERSION, type Snapshot } from '../shared/game.js';
import type { OpenArena } from '../shared/lobbies.js';
const endpoint = process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107';
const client = new Client(endpoint), rooms: Room[] = [], states = new Map<Room, Snapshot>();
const timers: ReturnType<typeof setInterval>[] = [];
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 15000;
  while (!await check()) { if (Date.now() > end) throw Error('Lobby discovery timed out'); await wait(50); }
}
function track(room: Room) {
  rooms.push(room); room.onMessage('snapshot', (s: Snapshot) => states.set(room, s));
  room.onMessage('latency', (n: number) => room.send('latencyAck', n)); room.onMessage('pong', () => {});
  timers.push(setInterval(() => { if (room.connection.isOpen) room.send('ping', Date.now()); }, 1000));
  room.send('sync'); return room;
}
const listing = async (): Promise<OpenArena[]> => {
  const response = await fetch(`${endpoint}/arenas`);
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/);
  return (await response.json()).arenas;
};
try {
  const privateRoom = track(await client.create('arena', { name: 'Invite only', version: VERSION, private: true }));
  assert.equal((await listing()).some(a => a.roomId === privateRoom.roomId), false);
  const invited = track(await client.joinById(privateRoom.roomId, { name: 'Invited friend', version: VERSION }));
  await until(() => states.get(privateRoom)?.players.length === 2);
  await invited.leave(); await privateRoom.leave();
  const host = track(await client.create('arena', { name: '<Host & friends>', version: VERSION }));
  await until(async () => (await listing()).some(a => a.roomId === host.roomId && a.players === 1));
  const visible = (await listing()).find(a => a.roomId === host.roomId)!;
  assert.deepEqual(Object.keys(visible).sort(), ['capacity', 'host', 'mode', 'players', 'roomId']);
  assert.equal(visible.mode, 'ffa'); host.send('mode', { mode: 'ctf' });
  await until(async () => (await listing()).some(a => a.roomId === host.roomId && a.mode === 'ctf')); host.send('mode', { mode: 'expedition' });
  await until(async () => (await listing()).some(a => a.roomId === host.roomId && a.mode === 'expedition')); host.send('mode', { mode: 'ffa' });
  assert.equal(visible.host, 'Host & friends'); assert.equal(visible.capacity, 5);
  const guests: Room[] = [];
  for (let n = 0; n < 4; n++) guests.push(track(await client.joinById(visible.roomId, { name: `Guest ${n}`, version: VERSION })));
  await until(() => states.get(host)?.players.length === 5);
  assert.equal((await listing()).some(a => a.roomId === host.roomId), false);
  await guests.pop()!.leave();
  await until(async () => (await listing()).some(a => a.roomId === host.roomId && a.players === 4));
  for (const r of [host, ...guests]) r.send('ready', { ready: true });
  await until(() => states.get(host)?.players.every(p => p.ready) === true);
  host.send('start'); await until(() => states.get(host)?.phase === 'countdown');
  assert.equal((await listing()).some(a => a.roomId === host.roomId), false);
  await assert.rejects(client.joinById(host.roomId, { name: 'Late join', version: VERSION }));
  await Promise.all([host, ...guests].map(r => r.leave()));
  await until(async () => !(await listing()).some(a => a.roomId === host.roomId));
  console.log('PASS: open lobby discovery and joining, invite-only access, full-room exclusion, capacity updates, started-round exclusion and disposal');
} finally {
  for (const timer of timers) clearInterval(timer);
  await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave()));
}
