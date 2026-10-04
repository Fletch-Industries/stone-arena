import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, lstat, readFile, open, rename, unlink, chmod } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { MODES, type Mode } from '../shared/game.js';
import { KEEP, validHandle, type KeepSummary, type WorldHandle } from '../shared/world-keep.js';
import { SAVE_BYTES, restoreWorld, validSaveHeader, type WorldSave } from '../shared/world-save.js';
import type { WorldState } from '../shared/world.js';

interface RecordBody { format: 'stone-arena-keep'; version: 1; id: string; keyHash: string; savedAt: number; mode: Mode; world: WorldSave }
interface StoredKeep extends RecordBody { checksum: string }
export interface WorldLease { handle: WorldHandle; owner: string; savedAt: number }
export interface LoadedKeep { lease: WorldLease; world: WorldState; mode: Mode; summary: KeepSummary; recovered: boolean }
export class KeepError extends Error {
  constructor(public code: number, message: string) { super(message); }
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const denied = () => new KeepError(404, 'That online world could not be opened. Use a downloaded world file if you have one.');
const summary = (record: RecordBody): KeepSummary => ({ id: record.id, title: record.world.title, seed: record.world.seed, mode: record.mode, savedAt: record.savedAt, runes: record.world.blocks.length, openings: record.world.cuts?.length ?? 0 });

/** Private capabilities, bounded files, atomic checkpoints; no player identities. */
export class WorldVault {
  private ids = new Set<string>();
  private leases = new Map<string, WorldLease>();
  private recovering = new WeakSet<WorldLease>();
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private directory: string, private limit: number) {}
  static async open(directory: string, limit: number = KEEP.worlds) {
    if (!isAbsolute(directory) || !Number.isInteger(limit) || limit < 1 || limit > KEEP.worlds) throw new Error('Invalid online world storage configuration.');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory()) throw new Error('Online world storage must be a private directory.');
    await chmod(directory, 0o700);
    const vault = new WorldVault(directory, limit), names = await readdir(directory);
    for (const name of names) {
      const id = /^([a-f0-9]{32})\.(?:json|bak)$/.exec(name)?.[1];
      if (id) vault.ids.add(id);
      else if (/^\.[a-f0-9]{32}\.\d+\.[a-f0-9]{16}\.tmp$/.test(name)) await unlink(join(directory, name));
    }
    if (vault.ids.size > KEEP.worlds) throw new Error('Online world storage exceeds its configured bounds.');
    return vault;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.catch(() => {}); return result;
  }
  private async read(id: string, backup = false, validateTerrain = true): Promise<{ record: StoredKeep; world?: WorldState } | undefined> {
    try {
      const file = join(this.directory, `${id}.${backup ? 'bak' : 'json'}`), stat = await lstat(file);
      if (!stat.isFile() || stat.size > KEEP.bytes || stat.size < 2) return;
      const record = JSON.parse(await readFile(file, 'utf8')) as StoredKeep;
      if (!record || record.format !== 'stone-arena-keep' || record.version !== 1 || record.id !== id || typeof record.keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.keyHash) || !Number.isSafeInteger(record.savedAt) || record.savedAt < 1 || typeof record.mode !== 'string' || !Object.hasOwn(MODES, record.mode)) return;
      const { checksum, ...body } = record;
      if (typeof checksum !== 'string' || hash(JSON.stringify(body)) !== checksum) return;
      if (!validSaveHeader(record.world) || !Array.isArray(record.world.blocks) || record.world.blocks.length > 4096 || !Array.isArray(record.world.cuts) || record.world.cuts.length > 8192 || !Array.isArray(record.world.veins) || record.world.veins.length > 2048) return;
      const world = validateTerrain ? restoreWorld(record.world) : undefined; if (validateTerrain && !world) return;
      return { record, world };
    } catch { return; }
  }
  async acquire(handle: unknown, owner: string): Promise<LoadedKeep> {
    if (!validHandle(handle)) throw denied();
    return this.serial(async () => {
      const current = await this.read(handle.id, false, false);
      let found = current ?? await this.read(handle.id, true, false), recovered = !current;
      const allowed = (value: typeof found) => value && timingSafeEqual(Buffer.from(value.record.keyHash, 'hex'), Buffer.from(hash(handle.key), 'hex'));
      if (!allowed(found)) throw denied();
      let world = restoreWorld(found!.record.world);
      if (!world && current) { found = await this.read(handle.id, true, false); recovered = true; if (!allowed(found)) throw denied(); world = restoreWorld(found!.record.world); }
      if (!found || !world) throw denied();
      if (this.leases.has(handle.id)) throw new KeepError(409, 'This world already has an arena. Rejoin it or wait until everyone leaves.');
      const lease = { handle: { id: handle.id, key: handle.key }, owner, savedAt: found.record.savedAt };
      this.leases.set(handle.id, lease);
      if (recovered) this.recovering.add(lease);
      return { lease, world, mode: found.record.mode, summary: summary(found.record), recovered };
    });
  }
  async create(world: WorldSave, mode: Mode, owner: string): Promise<{ lease: WorldLease; summary: KeepSummary }> {
    return this.serial(async () => {
      if (this.ids.size >= this.limit) throw new KeepError(507, 'Online world storage is full. Keep a downloaded world file.');
      let id: string; do { id = randomBytes(16).toString('hex'); } while (this.ids.has(id));
      const lease = { handle: { id, key: randomBytes(32).toString('hex') }, owner, savedAt: 0 };
      this.ids.add(id); this.leases.set(id, lease);
      try { return { lease, summary: await this.write(lease, world, mode) }; }
      catch (error) { this.ids.delete(id); this.leases.delete(id); throw error; }
    });
  }
  checkpoint(lease: WorldLease, world: WorldSave, mode: Mode) {
    return this.serial(() => this.write(lease, world, mode));
  }
  private async atomic(id: string, suffix: 'json' | 'bak', text: string) {
    const temporary = join(this.directory, `.${id}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.directory, `${id}.${suffix}`));
    } finally { await unlink(temporary).catch(() => {}); }
  }
  private async write(lease: WorldLease, save: WorldSave, mode: Mode): Promise<KeepSummary> {
    if (this.leases.get(lease.handle.id) !== lease) throw denied();
    if (typeof mode !== 'string' || !Object.hasOwn(MODES, mode) || !validSaveHeader(save) || !Array.isArray(save.blocks) || save.blocks.length > 4096 || !Array.isArray(save.cuts) || save.cuts.length > 8192 || !Array.isArray(save.veins) || save.veins.length > 2048) throw new KeepError(400, 'This world could not be kept online.');
    // Reconstruct the portable payload explicitly; never persist extra fields.
    const world: WorldSave = { format: 'stone-arena-world', version: 4, title: save.title, seed: save.seed, doorOpen: save.doorOpen, waystones: save.waystones, supplies: save.supplies && [...save.supplies], upgrades: save.upgrades, bonds: save.bonds, guardians: save.guardians, blocks: save.blocks.map(b => [b[0], b[1], b[2], b[3]]), cuts: save.cuts.map(c => [c[0], c[1], c[2]]), veins: save.veins.map(c => [c[0], c[1], c[2]]) };
    if (Buffer.byteLength(JSON.stringify(world)) > SAVE_BYTES) throw new KeepError(400, 'This world is too large to keep online.');
    const body: RecordBody = { format: 'stone-arena-keep', version: 1, id: lease.handle.id, keyHash: hash(lease.handle.key), savedAt: Math.max(Date.now(), lease.savedAt + 1), mode, world };
    const record: StoredKeep = { ...body, checksum: hash(JSON.stringify(body)) }, text = JSON.stringify(record);
    if (Buffer.byteLength(text) > KEEP.bytes) throw new KeepError(400, 'This world is too large to keep online.');
    // A recovered backup has passed terrain validation. Preserve it while
    // replacing a rejected primary, even if that primary's checksum was valid.
    const previous = this.recovering.has(lease) ? undefined : await this.read(lease.handle.id, false, false);
    if (previous) await this.atomic(lease.handle.id, 'bak', JSON.stringify(previous.record));
    await this.atomic(lease.handle.id, 'json', text);
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    this.recovering.delete(lease); lease.savedAt = body.savedAt; return summary(body);
  }
  release(lease: WorldLease) { if (this.leases.get(lease.handle.id) === lease) { this.leases.delete(lease.handle.id); this.recovering.delete(lease); } }
  remove(lease: WorldLease) {
    return this.serial(async () => {
      if (this.leases.get(lease.handle.id) !== lease) throw denied();
      for (const suffix of ['json', 'bak']) await unlink(join(this.directory, `${lease.handle.id}.${suffix}`)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      const directory = await open(this.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); }
      this.ids.delete(lease.handle.id); this.release(lease);
    });
  }
}
