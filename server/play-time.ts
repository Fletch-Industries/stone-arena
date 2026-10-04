import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdir, readFile, open, rename, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { PLAY_TIME, type PlayTimeStatus } from '../shared/play-time.js';

export function canonicalIP(value: string | undefined): string | undefined {
  if (!value || !isIP(value)) return;
  if (isIP(value) === 4) return value;
  const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(ip);
  if (mapped) { const a = parseInt(mapped[1], 16), b = parseInt(mapped[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  return ip;
}
/** Trust only explicitly configured immediate proxy peers; ignore client IP headers otherwise. */
export function clientIP(peer: string | undefined, forwarded: string | null | undefined, trusted: Set<string>) {
  const ip = canonicalIP(peer); if (!ip) throw new Error('Client network could not be identified.');
  if (!trusted.has(ip)) return ip;
  // The rightmost hop is the address appended by the trusted front door.
  const source = canonicalIP(forwarded?.split(',').at(-1)?.trim());
  if (!source) throw new Error('Trusted proxy did not supply a valid client address.');
  return source;
}
interface Budget { used: number; last: number; active: boolean }
interface Saved { version: 1; salt: string; records: [string, Budget][] }
export class PlayTimeLimiter {
  private records = new Map<string, Budget>();
  private connections = new Map<string, Set<string>>();
  private salt = randomBytes(32).toString('hex');
  private queue: Promise<void> = Promise.resolve();
  private broken = false;
  constructor(private file?: string, private now = Date.now, private playMs = PLAY_TIME.playSeconds * 1000, private breakMs = PLAY_TIME.breakSeconds * 1000, private capacity = 4096) {}
  static async open(file?: string, now = Date.now, playMs?: number, breakMs?: number, capacity?: number) {
    const limiter = new PlayTimeLimiter(file, now, playMs, breakMs, capacity);
    if (file) {
      if (!isAbsolute(file)) throw new Error('Play-time storage must use an absolute path.');
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      try {
        if ((await stat(file)).size > 1024 * 1024) throw new Error('Play-time storage exceeds its bound.');
        const saved = JSON.parse(await readFile(file, 'utf8')) as Saved;
        if (saved.version !== 1 || !/^[a-f0-9]{64}$/.test(saved.salt) || !Array.isArray(saved.records) || saved.records.length > limiter.capacity) throw new Error('Invalid play-time storage.');
        for (const [key, b] of saved.records) {
          if (!/^[a-f0-9]{64}$/.test(key) || !b || !Number.isFinite(b.used) || b.used < 0 || b.used > limiter.playMs || !Number.isFinite(b.last) || b.last < 0 || typeof b.active !== 'boolean' || limiter.records.has(key)) throw new Error('Invalid play-time budget.');
          limiter.records.set(key, { ...b });
        }
        limiter.salt = saved.salt;
        // A crash cannot grant a new allowance: conservatively charge open connections until startup or exhaustion.
        for (const b of limiter.records.values()) { limiter.settle(b); b.active = false; }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await limiter.save();
    }
    return limiter;
  }
  key(ip: string) { const normalized = canonicalIP(ip); if (!normalized) throw new Error('Invalid client address.'); return createHmac('sha256', this.salt).update(normalized).digest('hex'); }
  private settle(b: Budget) {
    const now = Math.max(b.last, this.now());
    if (b.active && b.used < this.playMs) { const delta = Math.min(now - b.last, this.playMs - b.used); b.used += delta; b.last += delta; }
    if ((!b.active || b.used >= this.playMs) && now - b.last >= this.breakMs) { b.used = 0; b.last = now; }
  }
  status(key: string): PlayTimeStatus {
    if (this.broken) throw new Error('Play-time storage unavailable. Try again shortly.');
    const b = this.records.get(key); if (b) this.settle(b);
    return { playSeconds: this.playMs / 1000, breakSeconds: this.breakMs / 1000, remainingSeconds: Math.ceil((this.playMs - (b?.used ?? 0)) / 1000), retryAfterSeconds: b && b.used >= this.playMs ? Math.max(0, Math.ceil((b.last + this.breakMs - this.now()) / 1000)) : 0 };
  }
  async join(key: string, connection: string) {
    if (this.status(key).retryAfterSeconds) throw new Error('A play break is required.');
    let b = this.records.get(key);
    if (!b) {
      for (const [k, record] of this.records) { this.settle(record); if (!record.active && record.used === 0 && !this.connections.has(k)) this.records.delete(k); }
      if (this.records.size >= this.capacity) throw new Error('Play-time tracking is full. Try again after a break.');
      b = { used: 0, last: this.now(), active: false }; this.records.set(key, b);
    }
    let clients = this.connections.get(key); if (!clients) { clients = new Set(); this.connections.set(key, clients); }
    if (!b.active) b.last = this.now();
    clients.add(connection); b.active = true; await this.save(); return this.status(key);
  }
  async leave(key: string, connection: string) {
    const clients = this.connections.get(key); if (!clients?.delete(connection)) return;
    const b = this.records.get(key)!; this.settle(b);
    if (!clients.size) { this.connections.delete(key); b.active = false; }
    await this.save();
  }
  async checkpoint() { for (const b of this.records.values()) this.settle(b); await this.save(); }
  async close() { for (const b of this.records.values()) { this.settle(b); b.active = false; } this.connections.clear(); await this.save(); }
  private save() {
    if (!this.file) return Promise.resolve();
    const body = JSON.stringify({ version: 1, salt: this.salt, records: [...this.records] } satisfies Saved);
    const operation = this.queue.then(async () => {
      const path = `${this.file}.tmp`, handle = await open(path, 'w', 0o600);
      try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
      await rename(path, this.file!);
      const directory = await open(dirname(this.file!), 'r'); try { await directory.sync(); } finally { await directory.close(); }
    });
    this.queue = operation.catch(() => { this.broken = true; });
    return operation;
  }
}
