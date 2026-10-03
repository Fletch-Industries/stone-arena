import type { Box } from './arena.js';

export const RUNE_KINDS = [
  { name: 'Runestone', color: '#809cac', glyph: '◇' },
  { name: 'Sunwood', color: '#cc9a62', glyph: '≋' },
  { name: 'Moon glass', color: '#a9b8ea', glyph: '✧' },
  { name: 'Mossstone', color: '#89b58b', glyph: '❧' },
  { name: 'Glow rune', color: '#f4cf82', glyph: '✦' },
  { name: 'Windlift', color: '#76ddcd', glyph: '↑' },
] as const;
export const BUILD = { reach: 6, cooldown: 15, roomLimit: 4096, playerLimit: 512, maxHeight: 64, chunk: 16, windJump: 4 } as const;
export interface RuneBlock { x: number; y: number; z: number; kind: number; owner: string }
export type RuneTuple = [number, number, number, number, string];
export type RuneEdit = [number, number, number, number, number | null, string?];
export interface ConstructionState { seed: number; revision: number; blocks: RuneTuple[] }
export interface ConstructionChanges { seed: number; revision: number; edits: RuneEdit[] }
export const runeKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
const region = (x: number, z: number) => `${Math.floor(x / BUILD.chunk)},${Math.floor(z / BUILD.chunk)}`;
export const validCell = (x: number, y: number, z: number) => [x, y, z].every(Number.isInteger) && Math.abs(x) < 4096 && Math.abs(z) < 4096 && y >= 0 && y < BUILD.maxHeight;
export const validKind = (kind: unknown): kind is number => Number.isInteger(kind) && (kind as number) >= 0 && (kind as number) < RUNE_KINDS.length;
const validOwner = (owner: unknown): owner is string => typeof owner === 'string' && /^[a-zA-Z0-9_:-]{1,40}$/.test(owner);
const validRevision = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) < 2 ** 31;

/** Sparse shared geometry. Collision queries touch nearby 16m regions only. */
export class Construction {
  private cells = new Map<string, RuneBlock>();
  private regions = new Map<string, Map<string, Box & { runeKey: string; runeKind: number }>>();
  private owners = new Map<string, number>();
  private pending: RuneEdit[] = [];
  private overflow = false;
  revision = 0;
  get size() { return this.cells.size; }
  count(owner: string) { return this.owners.get(owner) ?? 0; }
  get(x: number, y: number, z: number) { return this.cells.get(runeKey(x, y, z)); }
  values() { return this.cells.values(); }
  private insert(block: RuneBlock) {
    const key = runeKey(block.x, block.y, block.z), area = region(block.x, block.z);
    this.cells.set(key, block); this.owners.set(block.owner, this.count(block.owner) + 1);
    if (!this.regions.has(area)) this.regions.set(area, new Map());
    this.regions.get(area)!.set(key, { x: block.x + .5, y: block.y, z: block.z + .5, w: 1, d: 1, h: 1, runeKey: key, runeKind: block.kind });
  }
  private drop(block: RuneBlock) {
    const key = runeKey(block.x, block.y, block.z), area = region(block.x, block.z);
    this.cells.delete(key); const count = this.count(block.owner) - 1;
    if (count) this.owners.set(block.owner, count); else this.owners.delete(block.owner);
    const boxes = this.regions.get(area)!; boxes.delete(key); if (!boxes.size) this.regions.delete(area);
  }
  private record(edit: RuneEdit) { if (this.pending.length < 64) this.pending.push(edit); else this.overflow = true; }
  place(block: RuneBlock) {
    if (!validCell(block.x, block.y, block.z) || !validKind(block.kind) || !validOwner(block.owner) || this.get(block.x, block.y, block.z) || this.size >= BUILD.roomLimit || this.count(block.owner) >= BUILD.playerLimit || this.revision >= 2 ** 31 - 1) return false;
    this.insert({ ...block }); this.record([++this.revision, block.x, block.y, block.z, block.kind, block.owner]); return true;
  }
  erase(x: number, y: number, z: number) {
    const block = this.get(x, y, z); if (!block || this.revision >= 2 ** 31 - 1) return false;
    this.drop(block); this.record([++this.revision, x, y, z, null]); return true;
  }
  boxes(x0: number, z0: number, x1: number, z1: number) {
    const boxes: (Box & { runeKey: string; runeKind: number })[] = [];
    for (let x = Math.floor(Math.min(x0, x1) / BUILD.chunk); x <= Math.floor(Math.max(x0, x1) / BUILD.chunk); x++) for (let z = Math.floor(Math.min(z0, z1) / BUILD.chunk); z <= Math.floor(Math.max(z0, z1) / BUILD.chunk); z++) {
      for (const box of this.regions.get(`${x},${z}`)?.values() ?? []) if (box.x + .5 >= Math.min(x0, x1) && box.x - .5 <= Math.max(x0, x1) && box.z + .5 >= Math.min(z0, z1) && box.z - .5 <= Math.max(z0, z1)) boxes.push(box);
    }
    return boxes;
  }
  state(seed: number): ConstructionState { return { seed, revision: this.revision, blocks: [...this.cells.values()].map(b => [b.x, b.y, b.z, b.kind, b.owner]) }; }
  drain(seed: number): ConstructionState | ConstructionChanges | undefined {
    const result = this.overflow ? this.state(seed) : this.pending.length ? { seed, revision: this.revision, edits: this.pending } : undefined;
    this.pending = []; this.overflow = false; return result;
  }
  /** Validate the entire message before changing collision or ownership. */
  restore(state: ConstructionState) {
    if (!state || !Number.isInteger(state.seed) || state.seed < 0 || state.seed > 0xffffffff || !validRevision(state.revision) || !Array.isArray(state.blocks) || state.blocks.length > BUILD.roomLimit) return false;
    const replacement = new Construction();
    for (const row of state.blocks) {
      if (!Array.isArray(row) || row.length !== 5 || !replacement.place({ x: row[0], y: row[1], z: row[2], kind: row[3], owner: row[4] })) return false;
    }
    this.cells = replacement.cells; this.regions = replacement.regions; this.owners = replacement.owners; this.revision = state.revision; this.pending = []; this.overflow = false; return true;
  }
  apply(changes: ConstructionChanges) {
    if (!changes || !Number.isInteger(changes.seed) || changes.seed < 0 || changes.seed > 0xffffffff || !validRevision(changes.revision) || !Array.isArray(changes.edits) || changes.edits.length > 64) return false;
    // Stage only changed cells, rather than copying a full world for every packet.
    const overlay = new Map<string, RuneBlock | undefined>(), ownerDeltas = new Map<string, number>();
    const operations: { before?: RuneBlock; after?: RuneBlock }[] = [];
    let last = -1, revision = this.revision, size = this.size;
    const changeOwner = (owner: string, delta: number) => { ownerDeltas.set(owner, (ownerDeltas.get(owner) ?? 0) + delta); return this.count(owner) + ownerDeltas.get(owner)!; };
    for (const row of changes.edits) {
      if (!Array.isArray(row) || row.length !== (row[4] === null ? 5 : 6) || !validRevision(row[0]) || row[0] <= last || !validCell(row[1], row[2], row[3]) || (row[4] !== null && (!validKind(row[4]) || !validOwner(row[5])))) return false;
      last = row[0]; if (row[0] <= revision) continue;
      if (row[0] !== revision + 1) return false;
      const key = runeKey(row[1], row[2], row[3]), before = overlay.has(key) ? overlay.get(key) : this.get(row[1], row[2], row[3]);
      if (row[4] === null) {
        if (!before) return false; size--; changeOwner(before.owner, -1); overlay.set(key, undefined); operations.push({ before });
      } else {
        if (before || ++size > BUILD.roomLimit || changeOwner(row[5]!, 1) > BUILD.playerLimit) return false;
        const after = { x: row[1], y: row[2], z: row[3], kind: row[4], owner: row[5]! }; overlay.set(key, after); operations.push({ after });
      }
      revision++;
    }
    if (revision !== changes.revision && changes.revision > this.revision || last > changes.revision) return false;
    for (const op of operations) { if (op.before) this.drop(op.before); if (op.after) this.insert(op.after); }
    this.revision = revision; return true;
  }
}
