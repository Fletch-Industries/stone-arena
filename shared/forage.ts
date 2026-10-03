import { direction, EYE, wallHit } from './game.js';
import { hash, terrainHeight, worldBoxes, type WorldState } from './world.js';
import { surfaceHeight } from './terrain-collision.js';
import { protectedRuneSite } from './weaving.js';

export const SUPPLIES = [
  { name: 'Lumen reed', color: '#9af3cf', glyph: '❧' },
  { name: 'Gleamstone', color: '#aebcff', glyph: '◇' },
  { name: 'Emberbloom', color: '#ffd088', glyph: '✹' },
] as const;
export type Supplies = [number, number, number];
export const FORAGE = { cell: 48, reach: 4.2, yield: 4, regrowTicks: 7200, limit: 512, stockLimit: 999 } as const;
export interface SupplyNode { cx: number; cz: number; kind: number; x: number; y: number; z: number }
export type SpentNode = [number, number, number, number];
export type SupplyEdit = [number, number, number, number, number | null];
export interface ForageState { seed: number; revision: number; nodes: SpentNode[] }
export interface ForageChanges { seed: number; revision: number; edits: SupplyEdit[] }
const key = (cx: number, cz: number, kind: number) => `${cx},${cz},${kind}`;
const validNode = (cx: number, cz: number, kind: number) => [cx, cz, kind].every(Number.isInteger) && cx >= -86 && cx <= 85 && cz >= -86 && cz <= 85 && kind >= 0 && kind < 3;
const validRevision = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) < 2 ** 31;
const validSeed = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;
export const validSupplies = (n: unknown): n is Supplies => Array.isArray(n) && n.length === 3 && n.every(v => Number.isInteger(v) && v >= 0 && v <= FORAGE.stockLimit);
const cache = new Map<string, SupplyNode | undefined>();
export const forageCacheSize = () => cache.size;

/** Original supplies grow in deterministic clear patches; they do not change terrain. */
export function supplyAt(cx: number, cz: number, kind: number, seed: number): SupplyNode | undefined {
  if (!validNode(cx, cz, kind)) return;
  const id = `${seed}:${key(cx, cz, kind)}`;
  if (cache.has(id)) return cache.get(id);
  let node: SupplyNode | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = cx * FORAGE.cell + 4 + kind * 13 + hash(cx * 11 + attempt, cz, seed ^ 8191 ^ kind * 997) * 8;
    const z = cz * FORAGE.cell + 5 + hash(cx, cz * 11 + attempt, seed ^ 131071 ^ kind * 541) * 38;
    const y = terrainHeight(x, z, seed);
    if (Math.abs(x) > 4093 || Math.abs(z) > 4093 || y < .6 || protectedRuneSite(x, z, seed)) continue;
    if (worldBoxes(x - 1.3, z - 1.3, x + 1.3, z + 1.3, 'wilds', { seed, doorOpen: true }).some(b => Math.abs(x - b.x) < b.w / 2 + 1.3 && Math.abs(z - b.z) < b.d / 2 + 1.3)) continue;
    node = { cx, cz, kind, x, y, z }; break;
  }
  if (cache.size >= 1024) cache.delete(cache.keys().next().value!);
  cache.set(id, node); return node;
}
export function suppliesNear(x: number, z: number, seed: number, radius = 96) {
  const nodes: SupplyNode[] = [];
  for (let cx = Math.floor((x - radius) / FORAGE.cell); cx <= Math.floor((x + radius) / FORAGE.cell); cx++) for (let cz = Math.floor((z - radius) / FORAGE.cell); cz <= Math.floor((z + radius) / FORAGE.cell); cz++) for (let kind = 0; kind < 3; kind++) {
    const node = supplyAt(cx, cz, kind, seed); if (node && Math.hypot(node.x - x, node.z - z) <= radius) nodes.push(node);
  }
  return nodes;
}
export function supplyPosition(node: SupplyNode, world: WorldState) { if (!world.excavation?.column(node.x, node.z)) return node; const y = surfaceHeight(node.x, node.z, world); return Math.abs(y - node.y) < .0001 ? node : { ...node, y }; }
export function gatherTarget(p: { x: number; y: number; z: number; yaw: number; pitch: number; realm?: string }, world: WorldState, tick: number) {
  if (p.realm !== 'wilds') return;
  const a = { x: p.x, y: p.y + EYE, z: p.z }, aim = direction(p.yaw, p.pitch);
  let result: SupplyNode | undefined, score = Infinity;
  for (const raw of suppliesNear(p.x, p.z, world.seed, FORAGE.reach)) {
    const node = supplyPosition(raw, world);
    if (!world.forage?.available(node, tick) || (world.supplies?.[node.kind] ?? 0) >= FORAGE.stockLimit) continue;
    const b = { x: node.x, y: node.y + .9, z: node.z }, dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, distance = Math.hypot(dx, dy, dz);
    if (distance > FORAGE.reach + .5 || distance < .01 || (dx * aim.x + dy * aim.y + dz * aim.z) / distance < .72 || wallHit(a, b, 'wilds', world) < .98) continue;
    if (distance < score) { result = node; score = distance; }
  }
  return result;
}

/** Only depleted patches need state; growth, caches, packets and memory stay bounded. */
export class Forage {
  private spent = new Map<string, SpentNode>();
  private pending: SupplyEdit[] = [];
  private overflow = false;
  revision = 0;
  get size() { return this.spent.size; }
  available(n: Pick<SupplyNode, 'cx' | 'cz' | 'kind'>, tick: number) { return (this.spent.get(key(n.cx, n.cz, n.kind))?.[3] ?? 0) <= tick; }
  private record(edit: SupplyEdit) { if (this.pending.length < 64) this.pending.push(edit); else this.overflow = true; }
  harvest(n: SupplyNode, tick: number) {
    if (!validNode(n.cx, n.cz, n.kind) || !validRevision(tick + FORAGE.regrowTicks) || !this.available(n, tick) || this.revision >= 2 ** 31 - 1) return false;
    this.expire(tick); if (this.size >= FORAGE.limit || this.revision >= 2 ** 31 - 1) return false;
    const until = tick + FORAGE.regrowTicks; this.spent.set(key(n.cx, n.cz, n.kind), [n.cx, n.cz, n.kind, until]); this.record([++this.revision, n.cx, n.cz, n.kind, until]); return true;
  }
  expire(tick: number) { for (const [id, n] of this.spent) if (n[3] <= tick && this.revision < 2 ** 31 - 1) { this.spent.delete(id); this.record([++this.revision, n[0], n[1], n[2], null]); } }
  state(seed: number): ForageState { return { seed, revision: this.revision, nodes: [...this.spent.values()].map(n => [...n]) }; }
  drain(seed: number): ForageState | ForageChanges | undefined { const out = this.overflow ? this.state(seed) : this.pending.length ? { seed, revision: this.revision, edits: this.pending } : undefined; this.pending = []; this.overflow = false; return out; }
  restore(s: ForageState) {
    if (!s || !validSeed(s.seed) || !validRevision(s.revision) || !Array.isArray(s.nodes) || s.nodes.length > FORAGE.limit) return false;
    const next = new Map<string, SpentNode>();
    for (const n of s.nodes) { if (!Array.isArray(n) || n.length !== 4 || !validNode(n[0], n[1], n[2]) || !validRevision(n[3]) || n[3] === 0 || next.has(key(n[0], n[1], n[2]))) return false; next.set(key(n[0], n[1], n[2]), [...n]); }
    this.spent = next; this.revision = s.revision; this.pending = []; this.overflow = false; return true;
  }
  apply(c: ForageChanges) {
    if (!c || !validSeed(c.seed) || !validRevision(c.revision) || !Array.isArray(c.edits) || c.edits.length > 64) return false;
    const next = new Map(this.spent); let revision = this.revision, last = -1;
    for (const n of c.edits) {
      if (!Array.isArray(n) || n.length !== 5 || !validRevision(n[0]) || n[0] <= last || !validNode(n[1], n[2], n[3]) || n[4] !== null && (!validRevision(n[4]) || n[4] === 0)) return false;
      last = n[0]; if (n[0] <= revision) continue; if (n[0] !== revision + 1) return false;
      const id = key(n[1], n[2], n[3]);
      if (n[4] === null) { if (!next.delete(id)) return false; } else { if (next.has(id) || next.size >= FORAGE.limit) return false; next.set(id, [n[1], n[2], n[3], n[4]]); }
      revision++;
    }
    if (revision !== c.revision && c.revision > this.revision || last > c.revision) return false;
    this.spent = next; this.revision = revision; return true;
  }
}
