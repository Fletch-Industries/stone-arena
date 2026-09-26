import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worker(network: () => Promise<Response>, cached: Response | undefined = new Response('Offline screen')) {
  const listeners = new Map<string, (event: any) => void>();
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://arena.example' }, addEventListener: (name: string, cb: (event: any) => void) => listeners.set(name, cb) },
    caches: { match: async () => cached }, URL, Response, fetch: network,
  });
  return (path: string, mode = 'navigate', method = 'GET') => {
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({ request: { url: new URL(path, 'https://arena.example').href, mode, method }, respondWith: (r: Promise<Response>) => { response = r; } });
    return response;
  };
}

test('installed app fetches a fresh game and preserves invite navigation', async () => {
  const online = new Response('Current game');
  const request = worker(async () => online);
  assert.equal(await request('/?room=ABC123'), online);
});
test('offline launch shows reconnect instructions instead of a stale multiplayer client', async () => {
  const request = worker(async () => { throw new TypeError('Offline'); });
  assert.equal(await (await request('/?room=ABC123'))!.text(), 'Offline screen');
});
test('service worker never intercepts API, assets, POSTs or other origins', () => {
  const request = worker(async () => { throw new Error('Must not fetch'); });
  assert.equal(request('/config.json', 'cors'), undefined);
  assert.equal(request('/arena-api/matchmake', 'cors', 'POST'), undefined);
  assert.equal(request('/assets/game.js', 'cors'), undefined);
  assert.equal(request('https://api.example/arena', 'navigate'), undefined);
});
test('manifest launches the lobby without capturing a private room link', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const png = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});
