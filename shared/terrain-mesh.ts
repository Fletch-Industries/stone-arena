import { CHUNK_SIZE, terrainVertex, terrainHeight, treesIn, hash, type Tree } from './world.js';
import { biomeAt, terrainColor, type Biome } from './biomes.js';
export interface Plant { x: number; y: number; z: number; size: number; biome: Biome }
export interface TerrainChunk { key: string; seed: number; cx: number; cz: number; positions: Float32Array; normals: Float32Array; colors: Float32Array; uv: Float32Array; indices: Uint16Array; trees: Tree[]; plants: Plant[] }
export function buildTerrainChunk(cx: number, cz: number, seed: number): TerrainChunk {
  const side = CHUNK_SIZE + 1, count = side * side, positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3), uv = new Float32Array(count * 2), indices = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * 6);
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const n = z * side + x, wx = ox + x, wz = oz + z, y = terrainVertex(wx, wz, seed);
    positions.set([x, y, z], n * 3); uv.set([wx / 3, wz / 3], n * 2);
    const dx = terrainVertex(wx - 1, wz, seed) - terrainVertex(wx + 1, wz, seed), dz = terrainVertex(wx, wz - 1, seed) - terrainVertex(wx, wz + 1, seed), length = Math.hypot(dx, 2, dz);
    normals.set([dx / length, 2 / length, dz / length], n * 3);
    colors.set(terrainColor(wx, wz, seed, y, Math.hypot(dx, dz)), n * 3);
  }
  let n = 0;
  for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) {
    const a = z * side + x, b = a + 1, c = a + side, d = c + 1;
    indices.set([a, c, b, b, c, d], n); n += 6;
  }
  const trees = treesIn(ox, oz, ox + CHUNK_SIZE, oz + CHUNK_SIZE, seed).filter(t => t.x >= ox && t.x < ox + CHUNK_SIZE && t.z >= oz && t.z < oz + CHUNK_SIZE);
  const plants: Plant[] = [];
  for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) {
    const gx = cx * 4 + x, gz = cz * 4 + z, wx = ox + x * 6 + 1 + hash(gx, gz, seed ^ 61) * 4, wz = oz + z * 6 + 1 + hash(gx, gz, seed ^ 67) * 4;
    const y = terrainHeight(wx, wz, seed);
    if (y < .75 || Math.hypot(wx, wz) < 15 || hash(gx, gz, seed ^ 73) < .3) continue;
    plants.push({ x: wx, z: wz, y, size: .65 + hash(gx, gz, seed ^ 79) * .8, biome: biomeAt(wx, wz, seed) });
  }
  return { key: `${cx},${cz}`, seed, cx, cz, positions, normals, colors, uv, indices, trees, plants };
}
