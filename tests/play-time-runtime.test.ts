import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { VERSION } from '../shared/game.js';

test('real sockets enforce shared cutoff, spoof resistance, saved worlds, cooldown and restart', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stone-play-runtime-'));
  const finder = createServer(); await new Promise<void>(r => finder.listen(0, '127.0.0.1', r));
  const port = (finder.address() as { port: number }).port; await new Promise<void>(r => finder.close(() => r()));
  const endpoint = `http://127.0.0.1:${port}`, client = new Client(endpoint), options = { name: 'Break test', version: VERSION, mode: 'creative', playerKey: 'play-time-player-profile' };
  let child: ChildProcess | undefined, offset = 0, logs = '', trustProxy = false;
  const rooms: Room[] = [];
  const until = async (fn: () => Promise<boolean> | boolean) => { const end = Date.now() + 7000; while (!await fn()) { if (Date.now() > end) throw new Error(`Play-time timeout: ${logs.slice(-3000)}`); await new Promise(r => setTimeout(r, 30)); } };
  async function stop() { const c = child; child = undefined; if (c && c.exitCode === null) { c.kill('SIGTERM'); await new Promise(r => c.once('exit', r)); } }
  async function start() {
    const code = `const realNow = Date.now; let offset = ${offset}; Date.now = () => realNow() + offset; process.on('message', n => { offset = n; process.send('clock'); }); await import(${JSON.stringify(new URL('../server/index.ts', import.meta.url).href)});`;
    child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', code], { cwd: directory, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ARENA_TRUSTED_PROXIES: trustProxy ? '127.0.0.1' : '', ARENA_PLAY_TIME_FILE: join(directory, 'play-time.json'), ARENA_WORLD_STORE_DIR: join(directory, 'worlds'), ARENA_MAINTENANCE_FILE: join(directory, 'maintenance') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout!.on('data', d => { logs += d; }); child.stderr!.on('data', d => { logs += d; });
    await until(async () => { try { return (await fetch(endpoint + '/health')).ok; } catch { return false; } });
  }
  async function advance(ms: number) { offset += ms; await new Promise<void>(r => { child!.once('message', () => r()); child!.send(offset); }); }
  function track(r: Room) { rooms.push(r); r.reconnection.enabled = false; for (const name of ['snapshot', 'playTime', 'worldKeep', 'construction', 'forage', 'excavation', 'worldInvite']) r.onMessage(name, () => {}); r.onMessage('latency', n => r.send('latencyAck', n)); return r; }
  const status = async (headers?: Record<string, string>) => (await (await fetch(endpoint + '/play-time', { headers })).json());
  try {
    await start(); let worldId = ''; const a = track(await client.create('arena', options)); a.onMessage('worldInvite', d => { worldId = d.id; }); a.send('sync');
    const b = track(await client.create('arena', { ...options, name: 'Second device' })); await until(() => !!worldId);
    await advance(14 * 60000); const before = await status(); assert(before.remainingSeconds <= 60 && before.remainingSeconds > 55);
    assert.equal((await status({ 'x-forwarded-for': '198.51.100.2', 'x-real-ip': '198.51.100.3' })).remainingSeconds, before.remainingSeconds);
    await b.leave(); const token = a.reconnectionToken; a.connection.close(1000); await until(() => !a.connection.isOpen); await new Promise(r => setTimeout(r, 100));
    const rejoined = track(await client.reconnect(token)); assert((await status()).remainingSeconds < 61);
    await advance(60000); await until(() => !rejoined.connection.isOpen); assert((await status()).retryAfterSeconds > 1795);
    await assert.rejects(client.create('arena', options)); await assert.rejects(client.joinById(a.roomId, options)); await assert.rejects(client.reconnect(rejoined.reconnectionToken));
    assert.equal((await (await fetch(endpoint + '/worlds/' + worldId)).json()).id, worldId);
    await stop(); await start(); assert((await status()).retryAfterSeconds > 1790); await assert.rejects(client.create('arena', options));
    await advance(30 * 60000); assert.equal((await status()).retryAfterSeconds, 0);
    const next = track(await client.create('arena', { ...options, invite: worldId })); assert((await status()).remainingSeconds > 895); await next.leave();
    await stop(); trustProxy = true; await start();
    const proxyHeaders = { 'x-forwarded-for': 'fake, 198.51.100.2', 'x-real-ip': '203.0.113.50' };
    const proxied = new Client(endpoint, { headers: proxyHeaders });
    const first = track(await proxied.create('arena', { ...options, name: 'Proxied player' }));
    const second = track(await proxied.create('arena', { ...options, name: 'Same network' }));
    await advance(14 * 60000); const shared = await status(proxyHeaders); assert(shared.remainingSeconds <= 60 && shared.remainingSeconds > 55);
    const independentHeaders = { 'x-forwarded-for': '203.0.113.8' };
    assert.equal((await status(independentHeaders)).remainingSeconds, 900);
    await advance(60000); await until(() => !first.connection.isOpen && !second.connection.isOpen);
    await assert.rejects(proxied.create('arena', options));
    const independent = new Client(endpoint, { headers: independentHeaders }); const third = track(await independent.create('arena', options)); await third.leave();

  } finally { await Promise.allSettled(rooms.filter(r => r.connection.isOpen).map(r => r.leave())); await stop(); await rm(directory, { recursive: true, force: true }); }
});
