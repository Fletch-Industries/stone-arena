/** Ordinary SDK inputs on a disposable server: never touch a production endpoint. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { VERSION, idleInput, type Snapshot, type Input } from '../shared/game.js';
import { placeOf, type PlayerPlace } from '../shared/player-place.js';
import type { KeepStatus, WorldHandle } from '../shared/world-keep.js';
import type { WorldInvite } from '../client/world-visits.js';

const directory = await mkdtemp(join(tmpdir(), 'stone-creative-')), listener = createServer();
await new Promise<void>(done => listener.listen(0, '127.0.0.1', done)); const port = (listener.address() as { port: number }).port;
await new Promise<void>(done => listener.close(() => done()));
const endpoint = `http://127.0.0.1:${port}`, client = new Client(endpoint), rooms: Room[] = [], states = new Map<Room, Snapshot>(), invites = new Map<Room, WorldInvite>(), keeps = new Map<Room, KeepStatus>();
let child: ChildProcess | undefined, output = '';
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 15000) { const end = Date.now() + ms; while (!await check()) { if (Date.now() > end) throw Error('Creative runtime timed out'); await wait(30); } }
async function start() {
  output = ''; child = spawn(process.execPath, [resolve('dist-server/index.js')], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ARENA_API_URL: endpoint, ALLOWED_ORIGINS: endpoint, ARENA_WORLD_STORE_DIR: join(directory, 'worlds'), ARENA_MAINTENANCE_FILE: join(directory, 'maintenance'), ARENA_HEARTBEAT_MS: '30000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout!, child.stderr!]) stream.on('data', chunk => { output = (output + chunk).slice(-32000); });
  await until(() => { if (child?.exitCode !== null) throw Error(`Isolated Creative server failed: ${output}`); return output.includes('Stone Arena listening'); });
}
async function stop() { const p = child; child = undefined; if (!p || p.exitCode !== null) return; const ended = new Promise<void>(done => p.once('exit', () => done())); p.kill('SIGTERM'); await ended; }
function track(r: Room) {
  rooms.push(r); r.reconnection.enabled = false;
  r.onMessage('snapshot', (s: Snapshot) => states.set(r, s)); r.onMessage('worldInvite', (i: WorldInvite) => invites.set(r, i)); r.onMessage('worldKeep', (s: KeepStatus) => keeps.set(r, s));
  r.onMessage('latency', (n: number) => r.send('latencyAck', n)); r.onMessage('*', () => {}); r.send('sync'); return r;
}
const player = (r: Room) => states.get(r)!.players.find(p => p.id === r.sessionId)!;
let sequence = 0;
async function controls(r: Room, input: Partial<Input>, milliseconds: number) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { r.send('input', { ...idleInput(), ...input, seq: ++sequence }); await wait(16); }
}
async function settle(r: Room) { await controls(r, {}, 150); await until(() => Math.abs(player(r).vy) < .001 && player(r).moveSpeed < .001); }
function samePosition(actual: PlayerPlace, expected: PlayerPlace) { assert.equal(actual.realm, expected.realm); assert.equal(actual.flying, expected.flying); for (const key of ['x', 'y', 'z', 'yaw', 'pitch'] as const) assert(Math.abs(actual[key] - expected[key]) < .002, `Restored ${key}: ${actual[key]} vs ${expected[key]}`); }
try {
  await start();
  const hostKey = randomUUID(), guestKey = randomUUID(), hostOptions = { version: VERSION, name: 'Creative host', private: true, playerKey: hostKey, seatKey: randomUUID() }, guestOptions = { version: VERSION, name: 'Creative guest', playerKey: guestKey, seatKey: randomUUID() };
  let host = track(await client.create('arena', { ...hostOptions, mode: 'creative' }));
  await until(() => states.get(host)?.phase === 'active' && keeps.get(host)?.state === 'saved' && !!invites.get(host));
  const id = invites.get(host)!.id, handle: WorldHandle = { ...keeps.get(host)!.handle! }, seed = states.get(host)!.world.seed;
  assert.equal(states.get(host)!.mode, 'creative'); assert.equal(player(host).ready, false);
  await controls(host, { glide: true, jump: true }, 2200); await controls(host, { z: 1 }, 900); await settle(host);
  const hostSpot = placeOf(player(host)); assert(hostSpot.flying && hostSpot.y > 15);
  let guest = track(await client.joinById(host.roomId, guestOptions)); await until(() => states.get(guest)?.players.length === 2);
  samePosition(placeOf(player(host)), hostSpot); assert.equal(states.get(guest)!.phase, 'active');
  await controls(guest, { glide: true, jump: true }, 1900); await controls(guest, { x: 1 }, 600); await settle(guest);
  const guestSpot = placeOf(player(guest)); assert(Math.abs(hostSpot.x - guestSpot.x) > 2);
  await wait(35000); assert(host.connection.isOpen && guest.connection.isOpen, 'Idle connected explorers must survive the old 30-second movement timeout'); assert.equal(states.get(host)!.phase, 'active');
  console.log('PASS: Creative starts immediately, allows late joins, never ends a round and stays connected while idle using connection replies alone');
  const token = guest.reconnectionToken, oldSession = guest.sessionId; guest.connection.close(1000);
  await until(() => states.get(host)?.players.find(p => p.id === oldSession)?.connected === false); await wait(18000);
  guest = track(await client.reconnect(token)); await until(() => player(guest)?.connected === true); assert.equal(guest.sessionId, oldSession); samePosition(placeOf(player(guest)), guestSpot);
  console.log('PASS: an explorer reconnects beyond the old 15-second window with the same identity and saved place');
  await host.leave(); await guest.leave(); await until(async () => (await (await fetch(`${endpoint}/health`)).json()).rooms === 0);
  const offline = await (await fetch(`${endpoint}/worlds/${id}`)).json(); assert.equal(offline.id, id); assert.equal(offline.roomId, undefined);
  await stop(); await start();
  host = track(await client.create('arena', { ...hostOptions, seatKey: randomUUID(), invite: id })); await until(() => states.get(host)?.phase === 'active' && !!invites.get(host));
  assert.equal(invites.get(host)!.id, id); assert.equal(states.get(host)!.world.seed, seed); samePosition(placeOf(player(host)), hostSpot); assert.equal(keeps.get(host)?.handle, undefined, 'An invite does not expose the creator key');
  const live = await (await fetch(`${endpoint}/worlds/${id}`)).json(); assert.equal(live.roomId, host.roomId);
  guest = track(await client.joinById(live.roomId, { ...guestOptions, seatKey: randomUUID() })); await until(() => states.get(guest)?.players.length === 2); samePosition(placeOf(player(guest)), guestSpot);
  const raw = await readFile(join(directory, 'worlds', `${id}.json`), 'utf8'); for (const secret of [hostKey, guestKey, handle.key, hostOptions.name, guestOptions.name]) assert(!raw.includes(secret));
  host.send('worldForget'); await wait(250); assert.equal((await (await fetch(`${endpoint}/worlds/${id}`)).json()).id, id);
  console.log('PASS: a stable Creative invite reopens after everyone leaves and the actual server restarts; each explorer resumes their own server-captured position, and guests cannot remove the world');
} finally {
  await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave())); await stop(); await rm(directory, { recursive: true, force: true });
}
