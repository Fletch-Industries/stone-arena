/** Actual disposable-server checkpoint/reopen regression for settled hill positions. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { VERSION, type Snapshot } from '../shared/game.js';
import { placeOf, type PlayerPlace } from '../shared/player-place.js';
import { saveWorld } from '../shared/world-save.js';
import { Simulation } from '../server/simulation.js';
import { WorldVault } from '../server/world-vault.js';

const directory = await mkdtemp(join(tmpdir(), 'stone-slope-')), listener = createServer();
await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(done => listener.close(() => done()));
const endpoint = `http://127.0.0.1:${port}`, client = new Client(endpoint), rooms: Room[] = [], states = new Map<Room, Snapshot>();
const key = randomUUID(), hash = createHash('sha256').update(key).digest('hex');
const safe: PlayerPlace = { realm: 'wilds', x: 30.5, y: 5.897177779659033, z: -47, yaw: .7, pitch: -.3, flying: false };
const sim = new Simulation(7919), vault = await WorldVault.open(join(directory, 'worlds'));
const made = await vault.create(saveWorld(sim.world, 'Hill return'), 'creative', 'seed', [{ ...safe, key: hash, at: Date.now() }]);
vault.release(made.lease);
let child: ChildProcess | undefined, output = '';
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 15000) { const end = Date.now() + ms; while (!await check()) { if (Date.now() > end) throw Error('Hill resume runtime timed out'); await wait(30); } }
async function start() {
  output = ''; child = spawn(process.execPath, [resolve('dist-server/index.js')], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ARENA_API_URL: endpoint, ALLOWED_ORIGINS: endpoint, ARENA_WORLD_STORE_DIR: join(directory, 'worlds'), ARENA_PLAY_TIME_FILE: join(directory, 'budget.json'), ARENA_TRUSTED_PROXIES: '', ARENA_MAINTENANCE_FILE: join(directory, 'maintenance') }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout!, child.stderr!]) stream.on('data', chunk => { output = (output + chunk).slice(-10000); });
  await until(() => { if (child?.exitCode !== null) throw Error(`Isolated hill server failed: ${output}`); return output.includes('Stone Arena listening'); });
}
async function stop() { const p = child; child = undefined; if (!p || p.exitCode !== null) return; const ended = new Promise<void>(done => p.once('exit', () => done())); p.kill('SIGTERM'); await ended; }
function track(r: Room) { rooms.push(r); r.reconnection.enabled = false; r.onMessage('snapshot', (s: Snapshot) => states.set(r, s)); r.onMessage('latency', (n: number) => r.send('latencyAck', n)); r.onMessage('*', () => {}); r.send('sync'); return r; }
const player = (r: Room) => states.get(r)!.players.find(p => p.id === r.sessionId)!;
async function enter() { const r = track(await client.create('arena', { version: VERSION, name: 'Hill explorer', playerKey: key, seatKey: randomUUID(), keep: made.lease.handle })); await until(() => states.get(r)?.phase === 'active' && player(r).grounded); return r; }
const same = (a: PlayerPlace, b: PlayerPlace) => { assert.equal(a.realm, b.realm); assert.equal(a.flying, b.flying); for (const k of ['x', 'y', 'z', 'yaw', 'pitch'] as const) assert(Math.abs(a[k]-b[k]) < .002, `${k}: ${a[k]} vs ${b[k]}`); };
async function leave(r: Room) { await r.leave(); await until(async () => (await (await fetch(`${endpoint}/health`)).json()).rooms === 0); }
try {
  await start(); let host = await enter(); await wait(250);
  const settled = placeOf(player(host)); same({ ...settled, y: safe.y }, safe); assert(Math.abs(settled.y-5.610957599803422)<.002);
  await leave(host);
  const raw = JSON.parse(await readFile(join(directory, 'worlds', `${made.lease.handle.id}.json`), 'utf8'));
  same(placeOf(raw.trails.find((p: { key: string }) => p.key === hash)), settled);
  assert(!JSON.stringify(raw).includes(key));
  host = await enter(); same(placeOf(player(host)), settled); await leave(host);
  console.log('PASS: an actual normally settled hill checkpoint resumes the same realm, location and view after leaving');
  await stop(); await start(); host = await enter(); same(placeOf(player(host)), settled);
  const active = await (await fetch(`${endpoint}/worlds/${made.lease.handle.id}`)).json(); assert.equal(active.roomId, host.roomId);
  await leave(host); console.log('PASS: the actual server restart retains the grounded hill location without moving it to the clearing');
} finally { await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave())); await stop(); await rm(directory, { recursive: true, force: true }); }
