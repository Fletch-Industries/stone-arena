import { biomeAt, BIOMES, type Biome } from './biomes.js';
import { hash, terrainHeight, type Realm } from './world.js';
import type { Box } from './arena.js';
export interface Waystone { id: number; name: string; x: number; y: number; z: number; biome: Biome }
const sites = new Map<number, Waystone[]>();
export function waystoneSites(seed: number): Waystone[] {
  const cached = sites.get(seed); if (cached) return cached;
  const phase = hash(13, 17, seed) * Math.PI * 2;
  const result = Array.from({ length: 8 }, (_, n) => {
    const angle = phase + n * Math.PI / 4 + (hash(n, 91, seed) - .5) * .22;
    const r = [168, 220, 285, 370, 190, 250, 335, 490][n];
    const x = Math.round(Math.sin(angle) * r), z = Math.round(-Math.cos(angle) * r), biome = biomeAt(x, z, seed);
    return { id: n + 1, name: `${BIOMES[biome].name} ${n + 1}`, x, z, y: terrainHeight(x, z, seed), biome };
  });
  if (sites.size >= 8) sites.delete(sites.keys().next().value!);
  sites.set(seed, result); return result;
}
export const HOME_WAYSTONE: Waystone = { id: 0, name: 'Arrival clearing', x: 0, z: -5, y: 0, biome: 'meadow' };
export function awakenedCount(mask = 0) { let count = 0; for (let n = 1; n <= 8; n++) if (mask & 1 << n) count++; return count; }
export function nearbyWaystone(p: { x: number; y: number; z: number; realm?: Realm }, seed: number) {
  if (p.realm !== 'wilds') return;
  return [HOME_WAYSTONE, ...waystoneSites(seed)].find(s => Math.hypot(p.x - s.x, p.z - s.z) < 3.4 && Math.abs(p.y - s.y) < 3);
}
/** Pillars leave the center and all four approaches walkable. Collision matches art. */
export function waystoneBoxes(s: Waystone, seed: number): Box[] {
  if (s.id === 0) return [];
  const boxes: Box[] = [];
  const corners = [[-4, -4], [4, -4], [-4, 4], [4, 4]].map(([x,z]) => ({ x: s.x + x, z: s.z + z, y: terrainHeight(s.x + x, s.z + z, seed) - .2 }));
  const roof = Math.max(...corners.map(p => p.y)) + 4.4;
  for (const p of corners) boxes.push({ ...p, w: 1, d: 1, h: roof - p.y + .3, surface: 'stone' });
  boxes.push({ x: s.x, z: s.z - 4, y: roof, w: 9, d: 1.2, h: .6, surface: 'stone' });
  return boxes;
}
