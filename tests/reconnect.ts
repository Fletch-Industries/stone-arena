import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { VERSION, type Snapshot } from '../shared/game.js';
const endpoint = process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107';
const clients = [new Client(endpoint), new Client(endpoint), new Client(endpoint)];
const rooms: Room[] = []; const states = new Map<string, Snapshot>();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(f: () => boolean, ms = 20000) { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw Error('Reconnect test timed out'); await wait(50); } }
function sub(r: Room) { r.onMessage('snapshot', (s: Snapshot) => states.set(r.sessionId, s)); r.onMessage('latency', (n: number) => r.send('latencyAck', n)); r.send('sync'); }
try {
  rooms.push(await clients[0].create('arena', { version: VERSION, private: true, name: 'ReconnectHost' })); sub(rooms[0]);
  for (let i = 1; i < 3; i++) { rooms.push(await clients[i].joinById(rooms[0].roomId, { version: VERSION, private: true, name: `Reconnect${i}` })); sub(rooms[i]); }
  for (const r of rooms) r.send('ready');
  await until(() => states.get(rooms[0].sessionId)?.players.every(p => p.ready) ?? false); rooms[0].send('start', { practice: false });
  await until(() => states.get(rooms[0].sessionId)?.phase === 'active');
  const oldId = rooms[1].sessionId, token = rooms[1].reconnectionToken;
  rooms[1].reconnection.enabled = false; rooms[1].connection.close(1000);
  await until(() => states.get(rooms[0].sessionId)?.players.find(p => p.id === oldId)?.connected === false);
  rooms[1] = await clients[1].reconnect(token); sub(rooms[1]);
  await until(() => states.get(rooms[0].sessionId)?.players.find(p => p.id === oldId)?.connected === true);
  assert.equal(rooms[1].sessionId, oldId); assert.equal(states.get(rooms[0].sessionId)!.players.find(p => p.id === oldId)!.hp, 100);
  console.log('PASS: dropped player reconnects with the same identity and life');
  const expiredToken = rooms[2].reconnectionToken; const expiredId = rooms[2].sessionId;
  rooms[2].reconnection.enabled = false; rooms[2].connection.close(1000);
  await until(() => states.get(rooms[0].sessionId)?.players.find(p => p.id === expiredId)?.alive === false, 23000);
  await assert.rejects(clients[2].reconnect(expiredToken));
  assert.equal(states.get(rooms[0].sessionId)!.phase, 'active');
  console.log('PASS: expired reservation forfeits one life and cannot resurrect');
  await rooms[1].leave(); await until(() => states.get(rooms[0].sessionId)?.phase === 'results');
  assert.equal(states.get(rooms[0].sessionId)!.winner, rooms[0].sessionId);
  console.log('PASS: remaining player wins after opponents forfeit');
} finally { await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave())); }
