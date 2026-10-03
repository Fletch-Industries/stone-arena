/** Sparse native terrain openings. Unchanged terrain needs no voxel storage. */
export const SCULPT = { reach: 6, roomLimit: 8192, playerLimit: 2048, veinLimit: 2048, minHeight: -12, maxHeight: 32, chunk: 16, restTicks: 300 } as const;
export const ECHO_CHISEL = 4;
export type StoneCell = [number, number, number];
export interface CutCell { x: number; y: number; z: number; owner: string }
export type CutTuple = [number, number, number, string];
export type CutEdit = [number, number, number, number, string | null, boolean];
export interface ExcavationState { seed: number; revision: number; cuts: CutTuple[]; veins: StoneCell[] }
export interface ExcavationChanges { seed: number; revision: number; edits: CutEdit[] }
export interface TerrainEdits { cuts: StoneCell[]; veins: StoneCell[] }
export const stoneKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
const columnKey = (x: number, z: number) => `${Math.floor(x)},${Math.floor(z)}`;
const region = (x: number, z: number) => `${Math.floor(x / SCULPT.chunk)},${Math.floor(z / SCULPT.chunk)}`;
export const validStoneCell = (x: number, y: number, z: number) => [x, y, z].every(Number.isInteger) && Math.abs(x) < 4096 && Math.abs(z) < 4096 && y >= SCULPT.minHeight && y < SCULPT.maxHeight;
const validOwner = (a: unknown): a is string => typeof a === 'string' && /^[a-zA-Z0-9_:-]{1,40}$/.test(a);
const validRevision = (a: unknown): a is number => Number.isSafeInteger(a) && (a as number) >= 0 && (a as number) < 2 ** 31;
const validSeed = (a: unknown): a is number => Number.isInteger(a) && (a as number) >= 0 && (a as number) <= 0xffffffff;

export class Excavation {
  private cells = new Map<string, CutCell>();
  private regions = new Map<string, Map<string, CutCell>>();
  private columns = new Map<string, Set<number>>();
  private owners = new Map<string, number>();
  private veins = new Map<string, StoneCell>();
  private veinRegions = new Map<string, Map<string, StoneCell>>();
  private pending: CutEdit[] = [];
  private overflow = false;
  private history: [number, number, number][] = [];
  revision = 0;
  get size() { return this.cells.size; }
  get veinCount() { return this.veins.size; }
  count(owner: string) { return this.owners.get(owner) ?? 0; }
  get(x: number, y: number, z: number) { return this.cells.get(stoneKey(x, y, z)); }
  has(x: number, y: number, z: number) { return this.cells.has(stoneKey(x, y, z)); }
  claimed(x: number, y: number, z: number) { return this.veins.has(stoneKey(x, y, z)); }
  column(x: number, z: number): ReadonlySet<number> | undefined { return this.columns.get(columnKey(x, z)); }
  values() { return this.cells.values(); }
  claimedCells() { return this.veins.values(); }
  near(x0: number, z0: number, x1: number, z1: number) {
    for (let x = Math.floor(Math.min(x0, x1)); x <= Math.floor(Math.max(x0, x1)); x++) for (let z = Math.floor(Math.min(z0, z1)); z <= Math.floor(Math.max(z0, z1)); z++) if (this.columns.has(columnKey(x, z))) return true;
    return false;
  }
  private insert(cell: CutCell) {
    const key = stoneKey(cell.x, cell.y, cell.z), area = region(cell.x, cell.z), col = columnKey(cell.x, cell.z);
    this.cells.set(key, cell); this.owners.set(cell.owner, this.count(cell.owner) + 1);
    if (!this.regions.has(area)) this.regions.set(area, new Map());
    this.regions.get(area)!.set(key, cell);
    if (!this.columns.has(col)) this.columns.set(col, new Set());
    this.columns.get(col)!.add(cell.y);
  }
  private drop(cell: CutCell) {
    const key = stoneKey(cell.x, cell.y, cell.z), area = region(cell.x, cell.z), col = columnKey(cell.x, cell.z);
    this.cells.delete(key);
    const count = this.count(cell.owner) - 1;
    if (count) this.owners.set(cell.owner, count); else this.owners.delete(cell.owner);
    const cells = this.regions.get(area)!; cells.delete(key); if (!cells.size) this.regions.delete(area);
    const column = this.columns.get(col)!; column.delete(cell.y); if (!column.size) this.columns.delete(col);
  }
  private claim(cell: StoneCell) {
    const key = stoneKey(...cell), area = region(cell[0], cell[2]);
    this.veins.set(key, cell);
    if (!this.veinRegions.has(area)) this.veinRegions.set(area, new Map());
    this.veinRegions.get(area)!.set(key, cell);
  }
  private remember(revision: number, x: number, z: number) {
    this.history.push([revision, x, z]); if (this.history.length > 256) this.history.shift();
  }
  private record(edit: CutEdit) {
    if (this.pending.length < 64) this.pending.push(edit); else this.overflow = true;
    this.remember(edit[0], edit[1], edit[3]);
  }
  dig(cell: CutCell, claim = false) {
    if (!validStoneCell(cell.x, cell.y, cell.z) || !validOwner(cell.owner) || this.get(cell.x, cell.y, cell.z) || this.size >= SCULPT.roomLimit || this.count(cell.owner) >= SCULPT.playerLimit || this.revision >= 2 ** 31 - 1 || claim && !this.claimed(cell.x, cell.y, cell.z) && this.veinCount >= SCULPT.veinLimit) return false;
    this.insert({ ...cell });
    if (claim && !this.claimed(cell.x, cell.y, cell.z)) this.claim([cell.x, cell.y, cell.z]);
    this.record([++this.revision, cell.x, cell.y, cell.z, cell.owner, claim]); return true;
  }
  mend(x: number, y: number, z: number) {
    const cell = this.get(x, y, z); if (!cell || this.revision >= 2 ** 31 - 1) return false;
    this.drop(cell); this.record([++this.revision, x, y, z, null, false]); return true;
  }
  /** A small edit history invalidates only nearby resident graphics chunks. */
  changedSince(revision: number): [number, number][] | undefined {
    if (revision === this.revision) return [];
    if (!this.history.length || revision < this.history[0][0] - 1 || revision > this.revision) return;
    return this.history.filter(row => row[0] > revision).map(row => [row[1], row[2]]);
  }
  private inRegion<T>(map: Map<string, Map<string, T>>, x0: number, z0: number, x1: number, z1: number) {
    const result: T[] = [];
    for (let x = Math.floor(x0 / SCULPT.chunk); x <= Math.floor(x1 / SCULPT.chunk); x++) for (let z = Math.floor(z0 / SCULPT.chunk); z <= Math.floor(z1 / SCULPT.chunk); z++) for (const cell of map.get(`${x},${z}`)?.values() ?? []) result.push(cell);
    return result;
  }
  geometry(x0: number, z0: number, x1: number, z1: number): TerrainEdits {
    return {
      cuts: this.inRegion(this.regions, x0, z0, x1, z1).filter(c => c.x >= x0 && c.x <= x1 && c.z >= z0 && c.z <= z1).map(c => [c.x, c.y, c.z]),
      veins: this.inRegion(this.veinRegions, x0, z0, x1, z1).filter(c => c[0] >= x0 && c[0] <= x1 && c[2] >= z0 && c[2] <= z1).map(c => [...c]),
    };
  }
  state(seed: number): ExcavationState { return { seed, revision: this.revision, cuts: [...this.cells.values()].map(c => [c.x, c.y, c.z, c.owner]), veins: [...this.veins.values()].map(c => [...c]) }; }
  drain(seed: number): ExcavationState | ExcavationChanges | undefined {
    const result = this.overflow ? this.state(seed) : this.pending.length ? { seed, revision: this.revision, edits: this.pending } : undefined;
    this.pending = []; this.overflow = false; return result;
  }
  restore(state: ExcavationState) {
    if (!state || !validSeed(state.seed) || !validRevision(state.revision) || !Array.isArray(state.cuts) || state.cuts.length > SCULPT.roomLimit || !Array.isArray(state.veins) || state.veins.length > SCULPT.veinLimit) return false;
    const replacement = new Excavation();
    for (const row of state.cuts) if (!Array.isArray(row) || row.length !== 4 || !replacement.dig({ x: row[0], y: row[1], z: row[2], owner: row[3] })) return false;
    for (const row of state.veins) {
      if (!Array.isArray(row) || row.length !== 3 || !validStoneCell(...row) || replacement.claimed(...row)) return false;
      replacement.claim([...row]);
    }
    this.cells = replacement.cells; this.regions = replacement.regions; this.columns = replacement.columns; this.owners = replacement.owners; this.veins = replacement.veins; this.veinRegions = replacement.veinRegions;
    this.revision = state.revision; this.pending = []; this.history = []; this.overflow = false; return true;
  }
  /** Validate an entire packet before changing terrain, ownership or vein credit. */
  apply(changes: ExcavationChanges) {
    if (!changes || !validSeed(changes.seed) || !validRevision(changes.revision) || !Array.isArray(changes.edits) || changes.edits.length > 64) return false;
    const overlay = new Map<string, CutCell | undefined>(), owners = new Map<string, number>(), claims = new Map<string, StoneCell>();
    const operations: { revision: number; x: number; z: number; before?: CutCell; after?: CutCell; claim?: StoneCell }[] = [];
    let revision = this.revision, size = this.size, last = -1;
    const changeOwner = (owner: string, delta: number) => { owners.set(owner, (owners.get(owner) ?? 0) + delta); return this.count(owner) + owners.get(owner)!; };
    for (const row of changes.edits) {
      if (!Array.isArray(row) || row.length !== 6 || !validRevision(row[0]) || row[0] <= last || !validStoneCell(row[1], row[2], row[3]) || (row[4] !== null && !validOwner(row[4])) || typeof row[5] !== 'boolean' || row[4] === null && row[5]) return false;
      last = row[0]; if (row[0] <= revision) continue;
      if (row[0] !== revision + 1) return false;
      const key = stoneKey(row[1], row[2], row[3]), before = overlay.has(key) ? overlay.get(key) : this.get(row[1], row[2], row[3]);
      const op: typeof operations[number] = { revision: row[0], x: row[1], z: row[3] };
      if (row[4] === null) {
        if (!before) return false; size--; changeOwner(before.owner, -1); overlay.set(key, undefined); op.before = before;
      } else {
        if (before || ++size > SCULPT.roomLimit || changeOwner(row[4], 1) > SCULPT.playerLimit) return false;
        const after = { x: row[1], y: row[2], z: row[3], owner: row[4] }; overlay.set(key, after); op.after = after;
        if (row[5] && !this.veins.has(key) && !claims.has(key)) { if (this.veinCount + claims.size >= SCULPT.veinLimit) return false; const claim: StoneCell = [row[1], row[2], row[3]]; claims.set(key, claim); op.claim = claim; }
      }
      operations.push(op); revision++;
    }
    if (revision !== changes.revision && changes.revision > this.revision || last > changes.revision) return false;
    for (const op of operations) { if (op.before) this.drop(op.before); if (op.after) this.insert(op.after); if (op.claim) this.claim(op.claim); this.remember(op.revision, op.x, op.z); }
    this.revision = revision; return true;
  }
}
