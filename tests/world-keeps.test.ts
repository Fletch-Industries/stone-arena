import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, lstat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WorldVault, KeepError } from '../server/world-vault.js';
import { WorldKeeper } from '../server/world-keeper.js';
import { Simulation } from '../server/simulation.js';
import { saveWorld, restoreWorld } from '../shared/world-save.js';
import { WorldKeeps } from '../client/world-keeps.js';
import { onlineWorldsPanel } from '../client/worlds-online.js';
import type { KeepStatus } from '../shared/world-keep.js';

async function fixture(t: test.TestContext, limit = 128) {
  const directory = await mkdtemp(join(tmpdir(), 'stone-keeps-')); t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, vault: await WorldVault.open(directory, limit), sim: new Simulation(7919) };
}
test('online checkpoints survive a new vault and contain no players or private capability', async t => {
  const { directory, vault, sim } = await fixture(t); sim.add('player-secret', 'Private nickname'); sim.world.supplies = [37, 21, 9]; sim.world.doorOpen = true; sim.world.bonds = 3; sim.world.guardians = 34;
  const created = await vault.create(saveWorld(sim.world), 'expedition', 'owner-private'); vault.release(created.lease);
  const raw = await readFile(join(directory, `${created.lease.handle.id}.json`), 'utf8');
  for (const privateText of ['Private nickname', 'player-secret', 'owner-private', created.lease.handle.key]) assert(!raw.includes(privateText));
  assert.equal((await lstat(directory)).mode & 0o777, 0o700); assert.equal((await lstat(join(directory, `${created.lease.handle.id}.json`))).mode & 0o777, 0o600);
  const restarted = await WorldVault.open(directory), restored = await restarted.acquire(created.lease.handle, 'another-room');
  assert.equal(restored.mode, 'expedition'); assert.deepEqual(saveWorld(restored.world), saveWorld(sim.world)); assert(!restored.recovered);
});
test('world keys and room leases prevent guesses, traversal and competing writers', async t => {
  const { vault, sim } = await fixture(t), created = await vault.create(saveWorld(sim.world), 'ffa', 'room-a');
  await assert.rejects(vault.acquire({ ...created.lease.handle, key: '0'.repeat(64) }, 'room-b'), (e: unknown) => e instanceof KeepError && e.code === 404);
  await assert.rejects(vault.acquire({ id: '../secret', key: created.lease.handle.key }, 'room-b'));
  await assert.rejects(vault.acquire(created.lease.handle, 'room-b'), (e: unknown) => e instanceof KeepError && e.code === 409);
  vault.release(created.lease);
  const attempts = await Promise.allSettled([vault.acquire(created.lease.handle, 'room-b'), vault.acquire(created.lease.handle, 'room-c')]);
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
  await assert.rejects(vault.checkpoint(created.lease, saveWorld(sim.world), 'ffa'));
});
test('corrupt current checkpoint recovers its last good copy; a bad key still fails', async t => {
  const { vault, directory, sim } = await fixture(t), created = await vault.create(saveWorld(sim.world), 'ffa', 'room-a');
  sim.world.supplies = [4, 8, 12]; await vault.checkpoint(created.lease, saveWorld(sim.world), 'ctf');
  await writeFile(join(directory, `${created.lease.handle.id}.json`), '{broken'); vault.release(created.lease);
  const restarted = await WorldVault.open(directory);
  await assert.rejects(restarted.acquire({ ...created.lease.handle, key: '1'.repeat(64) }, 'room-b'));
  const restored = await restarted.acquire(created.lease.handle, 'room-b'); assert(restored.recovered); assert.equal(restored.mode, 'ffa'); assert.deepEqual(restored.world.supplies, [0, 0, 0]);
  sim.world.supplies = [17, 8, 12]; await restarted.checkpoint(restored.lease, saveWorld(sim.world), 'teams');
  const recovery = JSON.parse(await readFile(join(directory, `${created.lease.handle.id}.bak`), 'utf8')); assert.deepEqual(recovery.world.supplies, [0, 0, 0]);
});
test('valid checksums cannot bypass terrain validation or follow a substituted symlink', async t => {
  const { vault, directory, sim } = await fixture(t), created = await vault.create(saveWorld(sim.world), 'ffa', 'room'); vault.release(created.lease);
  const path = join(directory, `${created.lease.handle.id}.json`), record = JSON.parse(await readFile(path, 'utf8'));
  record.world.blocks = [[0, 0, 8, 0]]; delete record.checksum; record.checksum = createHash('sha256').update(JSON.stringify(record)).digest('hex'); await writeFile(path, JSON.stringify(record));
  await assert.rejects(vault.acquire(created.lease.handle, 'new-room'));
  await rm(path); const other = join(directory, 'outside.json'); await writeFile(other, '{}'); await symlink(other, path);
  await assert.rejects(vault.acquire(created.lease.handle, 'new-room'));
});
test('storage quota is retained across restarts and removing a keep frees its slot', async t => {
  const { directory, vault, sim } = await fixture(t, 1), created = await vault.create(saveWorld(sim.world), 'ffa', 'room');
  await assert.rejects(vault.create(saveWorld(sim.world), 'ffa', 'other'), (e: unknown) => e instanceof KeepError && e.code === 507);
  await vault.remove(created.lease); assert.deepEqual(await readdir(directory), []);
  const fresh = await vault.create(saveWorld(sim.world), 'ffa', 'fresh'); vault.release(fresh.lease);
  const restarted = await WorldVault.open(directory, 1); await assert.rejects(restarted.create(saveWorld(sim.world), 'ffa', 'third'));
  await assert.rejects(restarted.acquire(created.lease.handle, 'room'));
});
test('keeper serializes captures and catches restored worlds with identical revision numbers', async t => {
  const { vault, sim } = await fixture(t), notices: KeepStatus[] = [], keeper = new WorldKeeper(vault, 'room', s => notices.push(s));
  await keeper.save(sim.world, 'expedition', true); const handle = keeper.status.handle!;
  sim.world.supplies = [1, 2, 3]; const first = keeper.save(sim.world, 'expedition'); sim.world.supplies = [4, 5, 6]; const second = keeper.save(sim.world, 'expedition'); await Promise.all([first, second]);
  const replacement = restoreWorld(saveWorld(sim.world))!; replacement.construction!.place({ x: 42, y: 28, z: 42, kind: 2, owner: 'one' }); await keeper.save(replacement, 'expedition');
  const other = restoreWorld(saveWorld(sim.world))!; other.construction!.place({ x: 43, y: 28, z: 42, kind: 2, owner: 'two' }); assert.equal(other.construction!.revision, replacement.construction!.revision); await keeper.save(other, 'expedition');
  await keeper.close(other, 'expedition'); const loaded = await vault.acquire(handle, 'next');
  assert.deepEqual(loaded.world.supplies, [4, 5, 6]); assert(loaded.world.construction!.get(43, 28, 42)); assert(!loaded.world.construction!.get(42, 28, 42));
  assert.equal(notices.at(-1)?.state, 'saved');
});
test('forgetting cancels queued checkpoints and stays off until the host opts in again', async t => {
  const { vault, directory, sim } = await fixture(t), keeper = new WorldKeeper(vault, 'room', () => {});
  await keeper.save(sim.world, 'ffa', true); const original = keeper.status.handle!; sim.world.supplies = [1, 0, 0]; const saving = keeper.save(sim.world, 'ffa'); const forgetting = keeper.forget(); await Promise.all([saving, forgetting]);
  assert.equal(keeper.status.state, 'off'); await keeper.save(sim.world, 'ffa'); assert.deepEqual(await readdir(directory), []);
  await keeper.save(sim.world, 'ffa', true); assert.notEqual(keeper.status.handle?.id, original.id); assert.equal(keeper.status.state, 'saved');
});
test('full or unavailable online storage leaves world play and portable saves usable', async t => {
  const { vault, sim } = await fixture(t, 1); await vault.create(saveWorld(sim.world), 'ffa', 'other');
  const keeper = new WorldKeeper(vault, 'room', () => {}); await keeper.save(sim.world, 'ffa', true); assert.equal(keeper.status.state, 'full'); assert(!keeper.status.handle);
  const disabled = new WorldKeeper(undefined, 'room', () => {}); await disabled.save(sim.world, 'ffa', true); assert.equal(disabled.status.state, 'disabled'); assert(restoreWorld(saveWorld(sim.world)));
});
test('an arena that never admitted a host cannot create an orphan keep during disposal', async t => {
  const { vault, directory, sim } = await fixture(t); const keeper = new WorldKeeper(vault, 'room', () => {});
  await keeper.save(sim.world, 'ffa'); await keeper.close(sim.world, 'ffa'); assert.deepEqual(await readdir(directory), []);
});
test('bookmarks retain private keys outside markup, reject malformed records and survive reload', () => {
  let stored = ''; const storage = { getItem: () => stored, setItem: (_: string, value: string) => { stored = value; } };
  const book = new WorldKeeps(storage), status: KeepStatus = { state: 'saved', handle: { id: 'a'.repeat(32), key: 'b'.repeat(64) }, summary: { id: 'a'.repeat(32), title: 'Rune camp', seed: 7919, mode: 'expedition', savedAt: 1731000000000, runes: 2, openings: 19 } };
  book.remember(status); book.remember({ ...status, handle: { ...status.handle!, id: 'c'.repeat(32) } }); assert.equal(book.entries.length, 1);
  assert.deepEqual(new WorldKeeps(storage).entries, book.entries);
  const html = onlineWorldsPanel(book.entries, true, status, false, true, false); assert(!html.includes(status.handle!.key)); assert(!html.includes('data-action="forget-online-world"')); assert(html.includes('data-action="continue-world"'));
  const host = onlineWorldsPanel(book.entries, true, status, true, false, false); assert(host.includes('data-action="forget-online-world"')); assert(!host.includes(status.handle!.key));
});
test('bookmark storage failures and saving errors remain visible without losing a download option', () => {
  const book = new WorldKeeps({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } }); assert(!book.available);
  const html = onlineWorldsPanel([], false, { state: 'error' }, true, false, false); assert(html.includes('Download this world before leaving')); assert(html.includes('cannot remember online worlds'));
});
