import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { VERSION } from '../shared/game.js';

test('joining and reconnecting remain current activity during durable play admission', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stone-admission-'));
  const listener = createServer(); await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
  const port = (listener.address() as { port: number }).port; await new Promise<void>(r => listener.close(() => r()));
  const endpoint = `http://127.0.0.1:${port}`, budget = join(directory, 'play-time.json');
  const client = new Client(endpoint), rooms: Room[] = [], pings: ReturnType<typeof setInterval>[] = [];
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  let child: ChildProcess | undefined, logs = '';
  // Delay only the actual budget's atomic rename. Admission, heartbeat checks,
  // sockets, saved places and policy run through the production server.
  const code = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    let delay = 0; const rename = fs.promises.rename;
    fs.promises.rename = async (from, to) => { if (delay && to === ${JSON.stringify(budget)}) await new Promise(r => setTimeout(r, delay)); return rename(from, to); };
    syncBuiltinESMExports(); process.on('message', ms => { delay = ms; process.send('delay-set'); });
    await import(${JSON.stringify(new URL('../server/index.ts', import.meta.url).href)});`;
  function track(room: Room) {
    rooms.push(room); room.reconnection.enabled = false; room.onMessage('*', () => {});
    room.onMessage('latency', stamp => room.send('latencyAck', stamp));
    pings.push(setInterval(() => { if (room.connection.isOpen) room.send('ping', Date.now()); }, 300));
    return room;
  }
  async function delay(ms: number) { await new Promise<void>(r => { child!.once('message', () => r()); child!.send(ms); }); }
  try {
    child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', code], {
      cwd: directory, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ARENA_HEARTBEAT_MS: '2000',
        ARENA_TRUSTED_PROXIES: '', ARENA_PLAY_TIME_FILE: budget, ARENA_WORLD_STORE_DIR: join(directory, 'worlds'), ARENA_MAINTENANCE_FILE: join(directory, 'maintenance') },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.stdout!.on('data', d => { logs += d; }); child.stderr!.on('data', d => { logs += d; });
    const end = Date.now() + 10000;
    while (!logs.includes('Stone Arena listening')) { assert(Date.now() < end, logs); await wait(30); }
    const host = track(await client.create('arena', { name: 'Host', version: VERSION, mode: 'creative' }));
    await wait(2500); await delay(1100); // Every admission now spans at least one idle-check tick.
    const guest = track(await client.joinById(host.roomId, { name: 'Returning explorer', version: VERSION, playerKey: 'admission-player-profile' }));
    assert(guest.connection.isOpen);
    const token = guest.reconnectionToken; guest.connection.close(1000);
    await wait(3000); // Previous activity is stale, and durable detach has completed.
    const returning = track(await client.reconnect(token));
    assert(returning.connection.isOpen); await wait(1200); assert(host.connection.isOpen && returning.connection.isOpen);
    const status = await (await fetch(endpoint + '/play-time')).json();
    assert.equal(status.playSeconds, 900); assert.equal(status.breakSeconds, 1800);
    assert(status.remainingSeconds > 870 && status.remainingSeconds < 900 && status.retryAfterSeconds === 0);
  } finally {
    for (const timer of pings) clearInterval(timer);
    if (child?.connected) await delay(0);
    await Promise.allSettled(rooms.filter(r => r.connection.isOpen).map(r => r.leave()));
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child!.once('exit', r)); }
    await rm(directory, { recursive: true, force: true });
  }
});
