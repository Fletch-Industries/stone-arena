import { hash, terrainHeight } from './world.js';
export const SHARDS = [
  { name: 'Dawn', color: '#ffcd6b', angle: -.72, radius: 72 },
  { name: 'Tide', color: '#60e1e6', angle: 1.65, radius: 112 },
  { name: 'Dusk', color: '#c197ff', angle: 3.48, radius: 152 },
] as const;
const sites = new Map<number, ReturnType<typeof createSites>>();
export function shardSites(seed: number) {
  if (!sites.has(seed)) { if (sites.size >= 8) sites.delete(sites.keys().next().value!); sites.set(seed, createSites(seed)); }
  return sites.get(seed)!;
}
function createSites(seed: number) {
  return SHARDS.map((s, id) => { const a = s.angle + (hash(id, 23, seed) - .5) * .35, r = s.radius + hash(id, 31, seed) * 12; const x = Math.round(Math.sin(a) * r), z = Math.round(-Math.cos(a) * r); return { ...s, id, x, z, y: terrainHeight(x, z, seed) }; });
}
export const shardCount = (mask = 0) => Number(!!(mask & 1)) + Number(!!(mask & 2)) + Number(!!(mask & 4));
export const WINDSTEP = { cooldown: 4, duration: .28, speed: 24 } as const;
