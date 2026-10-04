import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { VERSION, type Snapshot } from '../shared/game.js';
const endpoint = process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107';
const client = new Client(endpoint), rooms: Room[] = [], states = new Map<Room, Snapshot>();
const timers: ReturnType<typeof setInterval>[] = [];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(f: () => boolean | Promise<boolean>, ms = 20000) { const end = Date.now() + ms; while (!(await f())) { if (Date.now() > end) throw Error('Room lifecycle test timed out'); await wait(50); } }
const count = () => fetch(`${endpoint}/health`).then(r => r.json()).then(s => s.rooms as number);
function track(r: Room, heartbeat = true) {
  rooms.push(r); r.onMessage('snapshot', (s: Snapshot) => states.set(r, s));
  r.onMessage('latency', (n: number) => { if (heartbeat) r.send('latencyAck', n); }); r.onMessage('pong', () => {}); r.onMessage('actionError', () => {});
  if (heartbeat) timers.push(setInterval(() => { if (r.connection.isOpen) r.send('ping', Date.now()); }, 1000));
  r.send('sync'); return r;
}
const options = (seatKey = randomUUID()) => ({ version: VERSION, private: true, name: 'Lifecycle-Test', seatKey });
const baseline = await count();
try {
  const seat = options(); let host = track(await client.create('arena', seat));
  await until(() => states.get(host)?.players.length === 1);
  host.send('ready', { ready: true }); host.send('ready', { ready: true });
  await until(() => states.get(host)?.players[0]?.ready === true); await wait(150);
  assert.equal(states.get(host)!.players[0].ready, true);
  console.log('PASS: repeated ready messages are idempotent');
  await assert.rejects(client.joinById(host.roomId, seat), /already has a seat/);
  await assert.rejects(client.create('arena', seat), /already has a seat/);
  assert.equal(states.get(host)!.players.length, 1);
  console.log('PASS: duplicate join/create cannot acquire a second seat');
  host.send('start', { practice: true }); await until(() => states.get(host)?.phase === 'active');
  assert.equal(states.get(host)!.practice, true); assert.equal(states.get(host)!.players.length, 1);
  host.send('lobby'); await until(() => states.get(host)?.phase === 'waiting');
  console.log('PASS: one player starts solo practice and returns to lobby');
  const oldId = host.sessionId, token = host.reconnectionToken;
  host.reconnection.enabled = false; host.connection.close(1000); await wait(200);
  host = track(await client.reconnect(token)); await until(() => states.get(host)?.players[0]?.connected === true);
  assert.equal(host.sessionId, oldId); assert.equal(states.get(host)!.players.length, 1);
  console.log('PASS: refresh-style reconnect retains exactly one player');
  await host.leave(); await until(async () => await count() === baseline);
  const reused = track(await client.create('arena', seat)); await until(() => states.get(reused)?.players.length === 1);
  await reused.leave(); await until(async () => await count() === baseline);
  console.log('PASS: leave disposes room and frees the tab identity for another arena');
  const silent = track(await client.create('arena', options()), false);
  await until(() => !silent.connection.isOpen, 40000); await until(async () => await count() === baseline);
  console.log('PASS: silent connected client expires and its empty room is disposed');
  const dropped = track(await client.create('arena', options()), false); const expired = dropped.reconnectionToken;
  dropped.reconnection.enabled = false; dropped.connection.close(1000);
  await until(async () => await count() === baseline, 20000);
  await assert.rejects(client.reconnect(expired));
  console.log('PASS: abandoned reconnect reservation expires without leaking a room');
} finally {
  for (const t of timers) clearInterval(t);
  await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave()));
}
