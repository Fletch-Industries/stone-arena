import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { Client } from '@colyseus/sdk';
import { VERSION } from '../shared/game.js';

test('live availability switch blocks HTTP, matchmaking and sockets, clears rooms, and reopens without restart', { timeout: 20000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'stone-availability-'));
  const portFinder = createServer();
  await new Promise<void>(resolve => portFinder.listen(0, '127.0.0.1', resolve));
  const port = (portFinder.address() as { port: number }).port;
  await new Promise<void>(resolve => portFinder.close(() => resolve()));
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), ARENA_MAINTENANCE_FILE: join(directory, 'state', 'maintenance') };
  const endpoint = `http://127.0.0.1:${port}`;
  mkdirSync(join(directory, 'dist', 'assets'), { recursive: true });
  copyFileSync(new URL('../public/maintenance.html', import.meta.url), join(directory, 'dist', 'maintenance.html'));
  writeFileSync(join(directory, 'dist', 'index.html'), 'Playable game');
  writeFileSync(join(directory, 'dist', 'assets', 'game.js'), 'game bundle');
  writeFileSync(join(directory, 'dist', 'sw.js'), 'offline worker');
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../server/index.ts', import.meta.url))], { cwd: directory, env, stdio: 'pipe' });
  let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  const toggle = (mode: string) => execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/availability.mjs', import.meta.url)), mode], { env, encoding: 'utf8' });
  const until = async (fn: () => Promise<boolean>, ms = 5000) => { const end = Date.now() + ms; while (!await fn()) { if (Date.now() > end) throw Error(`Availability timed out: ${logs}`); await new Promise(r => setTimeout(r, 50)); } };
  try {
    await until(async () => { try { return (await fetch(`${endpoint}/health`)).ok; } catch { return false; } });
    assert.equal(await (await fetch(endpoint)).text(), 'Playable game');
    const client = new Client(endpoint), options = { name: 'Availability test', version: VERSION };
    const room = await client.create('arena', options);
    room.reconnection.enabled = false; room.onMessage('snapshot', () => {}); room.onMessage('latency', () => {});
    let warned = false; room.onMessage('maintenance', () => { warned = true; });
    const token = room.reconnectionToken;
    assert.match(toggle('off'), /Game OFF/);
    assert.match(toggle('status'), /Game OFF/);
    for (const path of ['/', '/?room=ABC', '/index.html', '/assets/game.js']) {
      const response = await fetch(endpoint + path);
      assert.equal(response.status, 503); assert.match(response.headers.get('cache-control')!, /no-store/);
      assert.equal(response.headers.get('retry-after'), '300');
      if (!path.startsWith('/assets')) assert.match(await response.text(), /Do your school and chores/);
    }
    assert.equal((await fetch(`${endpoint}/sw.js`)).status, 200);
    assert.equal((await (await fetch(`${endpoint}/config.json`)).json()).available, false);
    assert.equal((await fetch(`${endpoint}/arenas`)).status, 503);
    await assert.rejects(client.create('arena', options));
    await assert.rejects(client.joinById(room.roomId, options));
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(endpoint.replace('http', 'ws') + '/anything');
      ws.addEventListener('open', () => { ws.close(); reject(Error('Maintenance allowed a WebSocket')); });
      ws.addEventListener('error', () => resolve());
    });
    await until(async () => !room.connection.isOpen && (await (await fetch(`${endpoint}/health`)).json()).rooms === 0);
    assert.equal(warned, true);
    await assert.rejects(client.reconnect(token));
    assert.equal((await (await fetch(`${endpoint}/health`)).json()).ok, true);
    assert.match(toggle('on'), /Game ON/);
    assert.match(toggle('on'), /Game ON/); // Repeated commands are safe.
    assert.equal(await (await fetch(endpoint)).text(), 'Playable game');
    assert.equal((await (await fetch(`${endpoint}/config.json`)).json()).available, true);
    const reopened = await client.create('arena', options); reopened.onMessage('snapshot', () => {}); await reopened.leave();
    assert.equal(child.exitCode, null);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
    rmSync(directory, { recursive: true, force: true });
  }
});
