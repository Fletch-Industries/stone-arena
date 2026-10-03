import { hash } from './noise.js';
export const BIOMES = {
  meadow: { name: 'Verdant Reach', ground: [.22, .38, .23], leaves: '#78ad78', flower: '#f4d681', spirit: '#e6ef91', density: .30, tune: 1 },
  moonwood: { name: 'Moonwood', ground: [.28, .26, .37], leaves: '#b596d6', flower: '#b5caff', spirit: '#dbc2ff', density: .22, tune: .89 },
  emberfields: { name: 'Emberfields', ground: [.43, .32, .18], leaves: '#e5ae5e', flower: '#ffc285', spirit: '#ffbe76', density: .48, tune: 1.12 },
  tideglade: { name: 'Tideglade', ground: [.17, .37, .34], leaves: '#71c8bc', flower: '#75e7dd', spirit: '#a0fff2', density: .38, tune: 1.19 },
} as const;
export type Biome = keyof typeof BIOMES;
const keys = Object.keys(BIOMES) as Biome[];
/** Nine jittered habitat centers, blended locally. No whole-world map or cache. */
export function biomeBlend(x: number, z: number, seed: number) {
  const cx = Math.floor(x / 180), cz = Math.floor(z / 180), weights = [0, 0, 0, 0];
  let total = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const gx = cx + dx, gz = cz + dz;
    const px = gx * 180 + 30 + hash(gx, gz, seed ^ 43891) * 120;
    const pz = gz * 180 + 30 + hash(gx, gz, seed ^ 73931) * 120;
    const weight = 1 / Math.pow(40 + (x - px) ** 2 + (z - pz) ** 2, 1.5);
    weights[Math.min(3, Math.floor(hash(gx, gz, seed ^ 91283) * 4))] += weight; total += weight;
  }
  const clearing = Math.max(0, Math.min(1, (Math.hypot(x, z) - 18) / 42));
  return weights.map((w, n) => w / total * clearing + (n === 0 ? 1 - clearing : 0));
}
export function biomeAt(x: number, z: number, seed: number): Biome {
  const weights = biomeBlend(x, z, seed);
  return keys[weights.indexOf(Math.max(...weights))];
}
/** One palette for both the near mesh and distant horizon, including shore/rock. */
export function terrainColor(x: number, z: number, seed: number, height: number, slope: number) {
  const weights = biomeBlend(x, z, seed), color = [0, 0, 0];
  for (let n = 0; n < 4; n++) for (let c = 0; c < 3; c++) color[c] += BIOMES[keys[n]].ground[c] * weights[n];
  const rock = Math.max(0, Math.min(1, (slope - 1.05) / 1.3 + (height - 19) / 12));
  const shore = Math.max(0, Math.min(1, (.95 - height) * 2));
  const tint = .96 + hash(Math.floor(x / 4), Math.floor(z / 4), seed ^ 6113) * .06;
  return color.map((v, c) => ((v * (1 - rock) + [.36, .39, .43][c] * rock) * (1 - shore) + [.54, .49, .34][c] * shore) * tint);
}
