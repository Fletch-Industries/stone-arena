import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { VERSION, type Snapshot } from '../shared/game.js';

test('fast reconnect reserves its existing seat before durable disconnect storage finishes', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stone-drop-admission-'));
  const listener = createServer(); await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
  const port = (listener.address() as { port: number }).port; await new Promise<void>(r => listener.close(() => r()));
  const endpoint = `http://127.0.0.1:${port}`, budget = join(directory, 'play-time.json');
  const client = new Client(endpoint), rooms: Room[] = [], states = new Map<Room, Snapshot>();
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  let child: ChildProcess | undefined, logs = '', dropEntered = false, storePaused = false, reconnectEntered = false, instrumented = false;
  async function until(check: () => boolean) { const end = Date.now() + 8000; while (!check()) { assert(Date.now() < end, logs); await wait(10); } }
  // A barrier holds the real atomic budget rename. Lifecycle observers preserve
  // the original methods and report when the reconnect reaches admission.
  const code = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    let held = false, release; const rename = fs.promises.rename;
    fs.promises.rename = async (from, to) => { if (held && to === ${JSON.stringify(budget)}) { process.send('store-paused'); await new Promise(r => { release = r; }); } return rename(from, to); };
    syncBuiltinESMExports(); process.on('message', message => { if (message === 'hold') held = true; else { held = false; release?.(); release = undefined; } process.send('configured'); });
    const { ArenaRoom } = await import(${JSON.stringify(new URL('../server/index.ts', import.meta.url).href)});
    for (const [name, event] of [['onDrop','drop-entered'],['onReconnect','reconnect-entered']]) { const original = ArenaRoom.prototype[name]; ArenaRoom.prototype[name] = function(...args) { process.send(event); return original.apply(this, args); }; }
    process.send('instrumented');`;
  function track(room: Room) { rooms.push(room); room.reconnection.enabled = false; room.onMessage('*', () => {}); room.onMessage('snapshot', s => states.set(room, s)); room.onMessage('latency', stamp => room.send('latencyAck', stamp)); room.send('sync'); return room; }
  async function configure(message: string) { await new Promise<void>(resolve => { const handle = (event: string) => { if (event === 'configured') { child!.off('message', handle); resolve(); } }; child!.on('message', handle); child!.send(message); }); }
  try {
    child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', code], {
      cwd: directory, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ARENA_TRUSTED_PROXIES: '', ARENA_PLAY_TIME_FILE: budget, ARENA_WORLD_STORE_DIR: join(directory, 'worlds'), ARENA_MAINTENANCE_FILE: join(directory, 'maintenance') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.stdout!.on('data', d => { logs += d; }); child.stderr!.on('data', d => { logs += d; });
    child.on('message', event => { if (event === 'drop-entered') dropEntered = true; if (event === 'store-paused') storePaused = true; if (event === 'reconnect-entered') reconnectEntered = true; if (event === 'instrumented') instrumented = true; });
    await until(() => instrumented);
    const host = track(await client.create('arena', { name: 'Host', version: VERSION, mode: 'creative' }));
    let guest = track(await client.joinById(host.roomId, { name: 'Returning explorer', version: VERSION, playerKey: 'drop-player-profile' }));
    await until(() => states.get(host)?.players.length === 2 && states.get(guest)?.phase === 'active');
    const beforeStatus = await (await fetch(endpoint + '/play-time')).json();
    for (let n = 0; n < 3; n++) {
      dropEntered = storePaused = reconnectEntered = false; await configure('hold');
      const token = guest.reconnectionToken, id = guest.sessionId, before = states.get(guest)!.players.find(p => p.id === id)!;
      guest.connection.close(1000); await until(() => dropEntered && storePaused);
      let failure: unknown; const returning = client.reconnect(token).catch(error => { failure = error; return undefined; });
      await until(() => reconnectEntered || failure !== undefined);
      const admittedWhileStorePaused = reconnectEntered; await configure('release');
      const room = await returning; assert(admittedWhileStorePaused, `Reconnect denied before durable detach completed: ${String(failure)}`); assert(room); guest = track(room);
      await until(() => states.get(guest)?.players.some(p => p.id === id && p.connected) === true); assert.equal(guest.sessionId, id);
      const after = states.get(guest)!.players.find(p => p.id === id)!;
      for (const key of ['x','y','z','realm','hp'] as const) assert.equal(after[key], before[key]);
    }
    const status = await (await fetch(endpoint + '/play-time')).json();
    assert.equal(status.playSeconds, 900); assert.equal(status.breakSeconds, 1800); assert(status.remainingSeconds <= beforeStatus.remainingSeconds && status.remainingSeconds > 870); assert.equal(status.retryAfterSeconds, 0); assert(host.connection.isOpen);
  } finally {
    if (child?.connected) await configure('release');
    await Promise.allSettled(rooms.filter(r => r.connection.isOpen).map(r => r.leave()));
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child!.once('exit', r)); }
    await rm(directory, { recursive: true, force: true });
  }
});
