import { saveWorld } from '../shared/world-save.js';
import type { Mode } from '../shared/game.js';
import type { KeepStatus, WorldHandle } from '../shared/world-keep.js';
import type { WorldState } from '../shared/world.js';
import { KeepError, WorldVault, type WorldLease } from './world-vault.js';
import { TRAIL_LIMIT, placeOf, validPlace, type PlayerPlace, type PlayerTrail } from '../shared/player-place.js';

export function keepStamp(world: WorldState, mode: Mode) {
  return `${mode}:${world.seed}:${world.title ?? ''}:${world.doorOpen}:${world.waystones}:${world.construction?.revision}:${world.excavation?.revision}:${world.supplies?.join()}:${world.upgrades}:${world.bonds}:${world.guardians}`;
}
/** Room-local serialization prevents old checkpoints overwriting a newer restore. */
export class WorldKeeper {
  status: KeepStatus;
  private lease?: WorldLease;
  private lastStamp = '';
  private lastWorld?: WorldState;
  private pending: Promise<void> = Promise.resolve();
  private muted = false;
  private closing = false;
  private started = false;
  private trails = new Map<string, PlayerTrail>();
  private trailRevision = 0;
  constructor(private vault: WorldVault | undefined, private owner: string, private notify: (status: KeepStatus) => void, private inviteOnly = false) { this.status = { state: vault ? 'off' : 'disabled' }; }
  private send(state: KeepStatus['state']) { this.status = { ...this.status, state, handle: this.lease?.guest ? undefined : this.lease?.handle }; this.notify(this.status); }
  async load(handle: WorldHandle | string) {
    if (!this.vault) throw new KeepError(503, 'Online worlds are temporarily unavailable. Your downloaded world file can still be restored.');
    const loaded = typeof handle === 'string' ? await this.vault.acquireInvite(handle, this.owner) : await this.vault.acquire(handle, this.owner);
    this.started = true;
    this.trails = new Map(loaded.trails.map(p => [p.key, p]));
    this.lease = loaded.lease; this.lastStamp = loaded.recovered ? '' : `${keepStamp(loaded.world, loaded.mode)}:0`; this.lastWorld = loaded.world;
    this.status = { state: 'saved', handle: loaded.lease.guest ? undefined : loaded.lease.handle, summary: loaded.summary }; return loaded;
  }
  place(key: string): PlayerPlace | undefined { const p = this.trails.get(key); return p && placeOf(p); }
  rememberPlace(key: string, place: PlayerPlace) {
    if (!/^[a-f0-9]{64}$/.test(key) || !validPlace(place)) return;
    const p = placeOf(place), previous = this.trails.get(key);
    if (previous && JSON.stringify(placeOf(previous)) === JSON.stringify(p)) return;
    this.trails.delete(key); this.trails.set(key, { ...p, key, at: Date.now() });
    if (this.trails.size > TRAIL_LIMIT) this.trails.delete(this.trails.keys().next().value!);
    this.trailRevision++;
  }
  clearPlaces() { this.trails.clear(); this.trailRevision++; }
  save(world: WorldState, mode: Mode, manual = false): Promise<void> {
    if (this.closing || !this.vault || this.muted && !manual || !this.started && !manual) return this.pending;
    if (manual) { this.muted = false; this.started = true; }
    const stamp = `${keepStamp(world, mode)}:${this.trailRevision}`;
    if (world === this.lastWorld && stamp === this.lastStamp && this.status.state === 'saved') { if (manual) this.notify(this.status); return this.pending; }
    const portable = saveWorld(world, world.title || `Rune world ${world.seed.toString(16).slice(-4).toUpperCase()}`);
    const trails = [...this.trails.values()].map(p => ({ ...p }));
    this.pending = this.pending.then(async () => {
      if (this.muted) return;
      if (world === this.lastWorld && stamp === this.lastStamp && this.status.state === 'saved') { if (manual) this.notify(this.status); return; }
      this.send('saving');
      if (this.lease) this.status.summary = await this.vault!.checkpoint(this.lease, portable, mode, trails);
      else { const created = await this.vault!.create(portable, mode, this.owner, trails, this.inviteOnly); this.lease = created.lease; this.status.summary = created.summary; }
      this.lastStamp = stamp; this.lastWorld = world; this.send('saved');
    }).catch(error => { this.send(error instanceof KeepError && error.code === 507 ? 'full' : 'error'); });
    return this.pending;
  }
  async forget() {
    if (this.closing || !this.vault) return;
    this.muted = true; await this.pending;
    try {
      const id = this.lease?.handle.id;
      if (this.lease) await this.vault.remove(this.lease);
      this.lease = undefined; this.lastStamp = ''; this.lastWorld = undefined; this.status = { state: 'off' }; this.notify(this.status); return id;
    } catch { this.muted = false; this.send('error'); }
  }
  async close(world: WorldState, mode: Mode) {
    const pending = this.save(world, mode); this.closing = true;
    try { await pending; } finally { if (this.lease) this.vault?.release(this.lease); }
  }
  async abort() { this.closing = true; await this.pending; if (this.lease) this.vault?.release(this.lease); }
}
