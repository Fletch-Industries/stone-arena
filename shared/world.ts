import { shardSites } from './expedition.js';
import { BIOMES, biomeAt, type Biome } from './biomes.js';
import { waystoneSites, waystoneBoxes } from './waystones.js';
import { hash, noise } from './noise.js';
export { hash } from './noise.js';
import { BOXES, LIMIT, type Box } from './arena.js';
import type { Construction } from './construction.js';
import type { Forage, Supplies } from './forage.js';
export type Realm = 'arena' | 'wilds';
export interface WorldState { seed: number; doorOpen: boolean; waystones?: number; title?: string; buildRevision?: number; construction?: Construction; forageRevision?: number; forage?: Forage; supplies?: Supplies; upgrades?: number }
export const SECRET = { x: -26, z: -48, halfWidth: 2, end: -65 } as const;
export const WORLD_LIMIT = 4096;
export const CHUNK_SIZE = 24;
export const TREE_CELL = 12;
export const PASSAGE: Box[] = [
  { x: -26, z: -48, w: 4, d: 1, y: 3, h: 3 },
  { x: -28.3, z: -56.5, w: .6, d: 18, h: 3.2 },
  { x: -23.7, z: -56.5, w: .6, d: 18, h: 3.2 },
  { x: -26, z: -56.5, w: 4, d: 18, y: 3.2, h: .5, surface: 'stone' },
];
export const SECRET_DOOR: Box = { x: SECRET.x, z: -48, w: 4, d: .9, h: 3 };
export const RETURN_PASSAGE: Box[] = [
  { x: -2.3, z: 7, w: .6, d: 8, h: 3.2 },
  { x: 2.3, z: 7, w: .6, d: 8, h: 3.2 },
  { x: 0, z: 7, w: 4, d: 8, y: 3.2, h: .5, surface: 'stone' },
];
const closedArena = [...BOXES, ...PASSAGE, SECRET_DOOR], openArena = [...BOXES, ...PASSAGE];
// Cache is bounded across every room/seed, including a worker's long exploration.
const heights = new Map<string, number>();
export function terrainVertex(x: number, z: number, seed: number) {
  const key = `${seed}:${x}:${z}`, cached = heights.get(key); if (cached !== undefined) return cached;
  const distance = Math.hypot(x, z), blend = Math.max(0, Math.min(1, (distance - 12) / 20));
  const smooth = blend * blend * (3 - 2 * blend);
  const hills = 2 + noise(x / 120, z / 120, seed) * 19 + noise(x / 36, z / 36, seed ^ 7153) * 3;
  const river = Math.abs(noise(x / 180, z / 180, seed ^ 32452843) - .5);
  const channel = Math.max(0, 1 - river / .045);
  const value = Math.max(0, hills * (1 - channel * .99)) * smooth;
  if (heights.size >= 4096) heights.delete(heights.keys().next().value!);
  heights.set(key, value); return value;
}
// Exactly matches the triangulation in streamed meshes, including negative cells.
export function terrainHeight(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const a = terrainVertex(ix, iz, seed), b = terrainVertex(ix + 1, iz, seed), c = terrainVertex(ix, iz + 1, seed), d = terrainVertex(ix + 1, iz + 1, seed);
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
export interface Tree { x: number; z: number; y: number; height: number; shade: number; biome: Biome }
const treeCache = new Map<string, Tree | undefined>();
export function treeAt(cx: number, cz: number, seed: number): Tree | undefined {
  const key = `${seed}:${cx}:${cz}`;
  if (treeCache.has(key)) return treeCache.get(key);
  const remember = (tree?: Tree) => { if (treeCache.size >= 2048) treeCache.delete(treeCache.keys().next().value!); treeCache.set(key,tree); return tree; };
  const x = cx * TREE_CELL + 2 + hash(cx, cz, seed ^ 541) * 8, z = cz * TREE_CELL + 2 + hash(cx, cz, seed ^ 659) * 8;
  const biome = biomeAt(x, z, seed);
  if (hash(cx, cz, seed ^ 9511) < BIOMES[biome].density) return remember();
  const y = terrainHeight(x, z, seed);
  if (Math.hypot(x, z) < 18 || y < .9 || y > 20 || shardSites(seed).some(s => Math.hypot(s.x - x, s.z - z) < 7) || waystoneSites(seed).some(s => Math.hypot(s.x - x, s.z - z) < 9)) return remember();
  return remember({ x, z, y, biome, height: 4 + hash(cx, cz, seed ^ 997) * 2 + (biome === 'moonwood' ? 1 : 0), shade: hash(cx, cz, seed ^ 331) });
}
export const treeCacheSize = () => treeCache.size;
export function treesIn(x0: number, z0: number, x1: number, z1: number, seed: number) {
  const trees: Tree[] = [];
  for (let x = Math.floor(x0 / TREE_CELL); x <= Math.floor(x1 / TREE_CELL); x++) for (let z = Math.floor(z0 / TREE_CELL); z <= Math.floor(z1 / TREE_CELL); z++) { const tree = treeAt(x, z, seed); if (tree) trees.push(tree); }
  return trees;
}
export function worldBoxes(x0: number, z0: number, x1: number, z1: number, realm: Realm = 'arena', world?: WorldState): Box[] {
  if (realm !== 'wilds') return world?.doorOpen ? openArena : closedArena;
  const boxes: Box[] = [...RETURN_PASSAGE];
  for (const t of treesIn(x0 - 3, z0 - 3, x1 + 3, z1 + 3, world?.seed ?? 0)) {
    boxes.push({ x: t.x, z: t.z, w: .7, d: .7, h: t.height, y: t.y, surface: 'wood' }, { x: t.x, z: t.z, w: 4, d: 4, h: 4, y: t.y + t.height - 1 });
  }
  for (const site of waystoneSites(world?.seed ?? 0)) if (site.x > Math.min(x0, x1) - 7 && site.x < Math.max(x0, x1) + 7 && site.z > Math.min(z0, z1) - 7 && site.z < Math.max(z0, z1) + 7) boxes.push(...waystoneBoxes(site, world?.seed ?? 0));
  if (world?.construction) boxes.push(...world.construction.boxes(x0 - .35, z0 - .35, x1 + .35, z1 + .35));
  return boxes;
}
export function movementLimit(axis: 'x' | 'z', x: number, z: number, next: number, realm: Realm, open: boolean) {
  if (realm === 'wilds') return Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, next));
  const inPassage = open && Math.abs((axis === 'x' ? next : x) - SECRET.x) <= SECRET.halfWidth - .34;
  if (axis === 'z' && inPassage) return Math.max(SECRET.end - 1, Math.min(LIMIT, next));
  if (axis === 'x' && z < -LIMIT) return Math.max(SECRET.x - SECRET.halfWidth + .34, Math.min(SECRET.x + SECRET.halfWidth - .34, next));
  return Math.max(-LIMIT, Math.min(LIMIT, next));
}
export const nearSecret = (p: { x: number; z: number; y: number; realm?: Realm }) => p.realm !== 'wilds' && p.y < 2 && Math.hypot(p.x - SECRET.x, p.z - SECRET.z) < 3.4;
export const chunkRadius = (quality: string) => quality === 'low' ? 2 : quality === 'high' ? 4 : 3;
export const chunkKey = (x: number, z: number) => `${x},${z}`;
export function wantedChunks(x: number, z: number, radius: number) {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE), chunks: { x: number; z: number; key: string; distance: number }[] = [];
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) chunks.push({ x: cx + dx, z: cz + dz, key: chunkKey(cx + dx, cz + dz), distance: dx * dx + dz * dz });
  return chunks.sort((a, b) => a.distance - b.distance);
}
export const terrainCacheSize = () => heights.size;
