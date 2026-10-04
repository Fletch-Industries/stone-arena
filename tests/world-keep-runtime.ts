/** Isolated processes and temporary files: never restart an external TEST_ENDPOINT. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { VERSION, type Snapshot } from '../shared/game.js';
import { Construction, type ConstructionState, type ConstructionChanges } from '../shared/construction.js';
import { Excavation, type ExcavationState, type ExcavationChanges } from '../shared/excavation.js';
import { StoneReceiver, type StonePacket } from '../shared/excavation-sync.js';
import { saveWorld, type WorldSave } from '../shared/world-save.js';
import { validHandle, type KeepStatus, type WorldHandle } from '../shared/world-keep.js';
import { carvedCave } from './mining-fixture.js';
import { Simulation } from '../server/simulation.js';

const root = await mkdtemp(join(tmpdir(), 'stone-keep-runtime-')), directory = join(root, 'worlds');
const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port; await new Promise<void>(resolve => listener.close(() => resolve()));
const endpoint = `http://127.0.0.1:${port}`, client = new Client(endpoint), rooms: Room[] = [];
const states = new Map<Room, Snapshot>(), keeps = new Map<Room, KeepStatus>(), keepMessages = new Map<Room, number>(), errors: string[] = [], messageSizes: number[] = [];
let child: ChildProcess | undefined, serverLog = '';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(label: string, check: () => boolean | undefined, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  while (!check()) { if (Date.now() > end) throw Error(`Online world check timed out: ${label}`); await wait(30); }
}
async function start() {
  serverLog = '';
  child = spawn(process.execPath, [resolve('dist-server/index.js')], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ALLOWED_ORIGINS: endpoint, ARENA_WORLD_STORE_DIR: directory, ARENA_MAINTENANCE_FILE: join(root, 'unavailable'), MAX_ROOMS: '8' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout!, child.stderr!]) stream.on('data', chunk => { serverLog = (serverLog + chunk.toString()).slice(-65536); });
  await until('server startup', () => { if (child?.exitCode !== null && child?.exitCode !== undefined) throw Error('Isolated server exited before becoming healthy'); return serverLog.includes('Stone Arena listening'); });
  const response = await fetch(`${endpoint}/health`); const health = await response.json() as { ok: boolean; available: boolean; version: number }; assert(health.ok && health.available && health.version === VERSION);
}
async function stop(signal: NodeJS.Signals = 'SIGTERM') {
  const processToStop = child; child = undefined; if (!processToStop || processToStop.exitCode !== null || processToStop.signalCode) return;
  const exited = new Promise<void>(resolve => processToStop.once('exit', () => resolve())); processToStop.kill(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { processToStop.kill('SIGKILL'); reject(Error('Isolated server did not stop')); }, 12000); })]); }
  finally { clearTimeout(timer); }
}
function track(room: Room) {
  rooms.push(room); room.reconnection.enabled = false; const blocks = new Construction(), receiver = new StoneReceiver(); let excavation = new Excavation();
  keepMessages.set(room, 0);
  room.onMessage('construction', (state: ConstructionState) => assert(blocks.restore(state))); room.onMessage('constructionChanges', (change: ConstructionChanges) => assert(blocks.apply(change)));
  room.onMessage('excavation', (state: ExcavationState) => { receiver.clear(); const replacement = new Excavation(); assert(replacement.restore(state)); excavation = replacement; });
  room.onMessage('excavationStream', (part: StonePacket) => { const result = receiver.receive(part, performance.now()); assert.notEqual(result, false); if (result) excavation = result.excavation; });
  room.onMessage('excavationChanges', (change: ExcavationChanges) => { if (receiver.active) assert(receiver.changes(change)); else assert(excavation.apply(change)); });
  room.onMessage('snapshot', (snapshot: Snapshot) => { snapshot.world.construction = blocks; snapshot.world.excavation = excavation; states.set(room, snapshot); });
  room.onMessage('worldKeep', (status: KeepStatus) => { if (status.handle) assert(validHandle(status.handle)); keeps.set(room, status); keepMessages.set(room, keepMessages.get(room)! + 1); messageSizes.push(Buffer.byteLength(JSON.stringify(status))); });
  room.onMessage('worldForgotten', () => {}); room.onMessage('actionError', (error: string) => errors.push(error));
  for (const name of ['forage', 'forageChanges', 'worldRestored', 'pong', 'maintenance']) room.onMessage(name, () => {});
  room.onMessage('latency', (stamp: number) => room.send('latencyAck', stamp)); room.onError(() => {}); room.send('sync'); return room;
}
async function upload(room: Room, save: WorldSave) {
  const { blocks, cuts = [], veins = [], ...header } = save; room.send('worldRestore', { type: 'begin', header, count: blocks.length, cutsCount: cuts.length, veinsCount: veins.length });
  for (const [kind, rows] of [['blocks', blocks], ['cuts', cuts], ['veins', veins]] as const) for (let offset = 0; offset < rows.length; offset += 64) { room.send('worldRestore', { type: 'chunk', kind, offset, blocks: rows.slice(offset, offset + 64) }); await wait(35); }
  room.send('worldRestore', { type: 'commit' });
  await until('portable import checkpoint', () => keeps.get(room)?.state === 'saved' && keeps.get(room)?.summary?.title === save.title && states.get(room)?.world.title === save.title && states.get(room)?.world.construction?.size === save.blocks.length && states.get(room)?.world.excavation?.size === cuts.length);
}
try {
  await start();
  const host = track(await client.create('arena', { name: 'Original explorer', private: true, version: VERSION }));
  const friend = track(await client.joinById(host.roomId, { name: 'Cave companion', version: VERSION }));
  await until('two explorers', () => states.get(friend)?.players.length === 2 && keeps.get(host)?.state === 'saved');
  const handle: WorldHandle = { ...keeps.get(host)!.handle! };
  host.send('mode', { mode: 'expedition' }); await until('co-op mode', () => states.get(host)?.mode === 'expedition');
  const world = new Simulation(7919).world; world.doorOpen = true; world.waystones = 511; world.supplies = [98, 87, 76]; world.upgrades = 7; world.bonds = 7; world.guardians = 170; carvedCave(world);
  world.construction!.place({ x: 42, y: 28, z: 42, kind: 2, owner: 'private-owner' }); const save = saveWorld(world, 'Shared cave garden'); await upload(host, save);
  await until('guest terrain', () => states.get(friend)?.world.excavation?.size === save.cuts!.length);
  assert.equal(keepMessages.get(friend), 0); const rejectedBefore = errors.length; friend.send('worldCheckpoint'); friend.send('worldForget'); await until('guest authority rejected', () => errors.length >= rejectedBefore + 2);
  await assert.rejects(client.create('arena', { name: 'Duplicate explorer', version: VERSION, keep: handle }), /already has an arena/);
  await assert.rejects(client.create('arena', { name: 'Guessing explorer', version: VERSION, keep: { ...handle, key: '0'.repeat(64) } }), /could not be opened/);
  assert(!JSON.stringify(states.get(friend)).includes(handle.key)); assert(!JSON.stringify(states.get(friend)).includes(handle.id));
  const filesBefore = (await readdir(directory)).filter(name => name.endsWith('.json')).length;
  await assert.rejects(client.create('arena', { name: 'Old client', version: VERSION - 1 }), /refresh/); await wait(100);
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.json')).length, filesBefore);
  await host.leave(); await until('host transfer', () => states.get(friend)?.host === friend.sessionId && keeps.get(friend)?.handle?.id === handle.id); assert.equal(keeps.get(friend)?.handle?.key, handle.key);
  friend.send('ready'); await until('ready', () => states.get(friend)?.players.every(p => p.ready)); friend.send('start'); await until('active', () => states.get(friend)?.phase === 'active');
  await stop(); await start();
  let recovered = track(await client.create('arena', { name: 'Returning explorer', version: VERSION, private: true, keep: handle }));
  await until('restart restoration', () => states.get(recovered)?.world.excavation?.size === save.cuts!.length && keeps.get(recovered)?.state === 'saved');
  assert.deepEqual(saveWorld(states.get(recovered)!.world), save); assert.equal(states.get(recovered)?.mode, 'expedition'); assert.equal(states.get(recovered)?.phase, 'waiting');
  const player = states.get(recovered)!.players[0]; assert.equal(player.ready, false); assert.equal(player.xp, 0); assert.equal(player.relics, 0); assert.equal(player.hp, 100); assert(!states.get(recovered)!.players.some(p => p.name === 'Original explorer' || p.name === 'Cave companion'));
  const recordPath = join(directory, `${handle.id}.json`), current = await readFile(recordPath, 'utf8'); for (const text of [handle.key, 'Original explorer', 'Cave companion', 'private-owner']) assert(!current.includes(text));
  console.log('PASS: private online checkpoints survived a real server restart; restored caves, runes, supplies, crafting, field guide, waystones and co-op mode in a fresh lobby; guests received no capability until host transfer');
  const backup = JSON.parse(await readFile(join(directory, `${handle.id}.bak`), 'utf8')) as { world: WorldSave; mode: string };
  await writeFile(recordPath, '{damaged'); await stop('SIGKILL'); await start();
  recovered = track(await client.create('arena', { name: 'Recovery explorer', version: VERSION, private: true, keep: handle }));
  await until('recovery checkpoint', () => states.get(recovered)?.world.seed === backup.world.seed && keeps.get(recovered)?.state === 'saved' && states.get(recovered)?.world.construction?.size === backup.world.blocks.length && states.get(recovered)?.world.excavation?.size === (backup.world.cuts?.length ?? 0));
  assert.deepEqual(saveWorld(states.get(recovered)!.world), backup.world); assert.equal(states.get(recovered)?.mode, backup.mode); assert.doesNotThrow(() => JSON.parse(current));
  const promoted = JSON.parse(await readFile(recordPath, 'utf8')); assert.deepEqual(promoted.world, backup.world);
  await stop('SIGKILL');
  const invalid = JSON.parse(await readFile(recordPath, 'utf8')); invalid.world.blocks = [[0, 0, 8, 0]]; delete invalid.checksum;
  invalid.checksum = createHash('sha256').update(JSON.stringify(invalid)).digest('hex'); await writeFile(recordPath, JSON.stringify(invalid)); await start();
  recovered = track(await client.create('arena', { name: 'Terrain recovery', version: VERSION, private: true, keep: handle }));
  await until('validated recovery promotion', () => keeps.get(recovered)?.state === 'saved' && states.get(recovered)?.world.seed === backup.world.seed && states.get(recovered)?.world.construction?.size === backup.world.blocks.length && states.get(recovered)?.world.excavation?.size === (backup.world.cuts?.length ?? 0));
  assert.deepEqual(saveWorld(states.get(recovered)!.world), backup.world);
  assert.deepEqual(JSON.parse(await readFile(join(directory, `${handle.id}.bak`), 'utf8')).world, backup.world);
  await stop('SIGKILL'); await writeFile(recordPath, '{damaged again'); await start();
  recovered = track(await client.create('arena', { name: 'Second recovery explorer', version: VERSION, private: true, keep: handle }));
  await until('second recovery', () => keeps.get(recovered)?.state === 'saved' && states.get(recovered)?.world.seed === backup.world.seed && states.get(recovered)?.world.construction?.size === backup.world.blocks.length && states.get(recovered)?.world.excavation?.size === (backup.world.cuts?.length ?? 0));
  assert.deepEqual(saveWorld(states.get(recovered)!.world), backup.world); assert.equal(states.get(recovered)?.mode, backup.mode);
  console.log('PASS: a valid checksum could not admit invalid terrain; promoting the validated backup preserved it through a second crash and recovery');
  recovered.send('worldForget'); await until('online deletion', () => keeps.get(recovered)?.state === 'off'); assert(!(await readdir(directory)).some(name => name.startsWith(handle.id)));
  await recovered.leave(); await stop(); await start();
  await assert.rejects(client.create('arena', { name: 'Removed bookmark', version: VERSION, keep: handle }), /could not be opened/);
  const fresh = track(await client.create('arena', { name: 'Fresh explorer', private: true, version: VERSION })); await until('fresh keep', () => keeps.get(fresh)?.state === 'saved'); assert.notEqual(keeps.get(fresh)?.handle?.id, handle.id);
  assert(Math.max(...messageSizes) < 1024); console.log(`PASS: corrupt current checkpoint recovered a previous copy after process crash; host removed both copies without closing the game; deleted credentials failed on restart; keep messages stayed below ${Math.max(...messageSizes)} bytes`);
} finally {
  await Promise.allSettled(rooms.filter(room => room.connection.isOpen).map(room => room.leave()));
  await stop().catch(() => {}); await rm(root, { recursive: true, force: true });
}
