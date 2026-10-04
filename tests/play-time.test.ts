import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayTimeLimiter, canonicalIP, clientIP } from '../server/play-time.js';

test('canonical addresses and explicit proxy trust defeat spoofed headers', () => {
  assert.equal(canonicalIP('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(canonicalIP('::ffff:c000:201'), '192.0.2.1');
  assert.equal(canonicalIP('2001:0DB8:0:0:0:0:0:1'), '2001:db8::1');
  assert.equal(clientIP('192.0.2.1', '198.51.100.2', new Set()), '192.0.2.1');
  assert.equal(clientIP('192.0.2.1', 'fake, 198.51.100.2', new Set(['192.0.2.1'])), '198.51.100.2');
  assert.throws(() => clientIP('192.0.2.1', 'garbage', new Set(['192.0.2.1'])));
});
test('simultaneous tabs share wall-clock play and every room hits the same cutoff', async () => {
  let now = 1000; const l = new PlayTimeLimiter(undefined, () => now, 15000, 30000), key = l.key('192.0.2.1');
  await l.join(key, 'room-a'); now += 5000; await l.join(key, 'room-b'); now += 5000;
  assert.equal(l.status(key).remainingSeconds, 5); await l.leave(key, 'room-a'); now += 5000;
  assert.equal(l.status(key).retryAfterSeconds, 30); await assert.rejects(l.join(key, 'new-browser'));
  await l.leave(key, 'room-b'); now += 29999; assert.equal(l.status(key).retryAfterSeconds, 1);
  now += 1; assert.equal(l.status(key).remainingSeconds, 15); await l.join(key, 'next-period');
});
test('short exits retain usage; a continuous full break resets partial allowance', async () => {
  let now = 1000; const l = new PlayTimeLimiter(undefined, () => now, 15000, 30000), key = l.key('192.0.2.1');
  await l.join(key, 'a'); now += 4000; await l.leave(key, 'a'); now += 20000;
  assert.equal(l.status(key).remainingSeconds, 11); await l.join(key, 'b'); now += 2000; await l.leave(key, 'b');
  now += 29999; assert.equal(l.status(key).remainingSeconds, 9); now += 1; assert.equal(l.status(key).remainingSeconds, 15);
});
test('independent IP budgets and bounded capacity retain exhausted networks', async () => {
  let now = 1000; const l = new PlayTimeLimiter(undefined, () => now, 15000, 30000, 2), a = l.key('192.0.2.1'), b = l.key('192.0.2.2'), c = l.key('192.0.2.3');
  await l.join(a, 'a'); now += 10000; await l.join(b, 'b'); now += 5000;
  assert.equal(l.status(a).retryAfterSeconds, 30); assert.equal(l.status(b).remainingSeconds, 10);
  await l.leave(a, 'a'); await assert.rejects(l.join(c, 'c'), /full/);
  now += 30000; await l.join(c, 'c'); assert.equal(l.status(c).remainingSeconds, 15);
});
test('private atomic budgets survive crash and graceful restart without resetting allowance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stone-play-')); const file = join(dir, 'budgets.json'); let now = 1000;
  try {
    let l = await PlayTimeLimiter.open(file, () => now, 15000, 30000), key = l.key('192.0.2.1');
    await l.join(key, 'a'); now += 4000; await l.checkpoint(); now += 3000;
    l = await PlayTimeLimiter.open(file, () => now, 15000, 30000); assert.equal(l.key('192.0.2.1'), key); assert.equal(l.status(key).remainingSeconds, 8);
    await l.join(key, 'b'); now += 8000; await l.close();
    l = await PlayTimeLimiter.open(file, () => now, 15000, 30000); assert.equal(l.status(key).retryAfterSeconds, 30);
    const raw = await readFile(file, 'utf8'); assert(!raw.includes('192.0.2.1')); assert(!raw.includes('"a"'));
    await writeFile(file, '{invalid'); await assert.rejects(PlayTimeLimiter.open(file), /JSON/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
