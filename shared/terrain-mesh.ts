import { CHUNK_SIZE, terrainVertex, treesIn, hash, type Tree } from './world.js';
export interface TerrainChunk { key: string; seed: number; cx: number; cz: number; positions: Float32Array; normals: Float32Array; colors: Float32Array; uv: Float32Array; indices: Uint16Array; trees: Tree[] }
export function buildTerrainChunk(cx: number, cz: number, seed: number): TerrainChunk {
  const side = CHUNK_SIZE + 1, count = side * side, positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3), uv = new Float32Array(count * 2), indices = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * 6);
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const n = z * side + x, wx = ox + x, wz = oz + z, y = terrainVertex(wx, wz, seed);
    positions.set([x, y, z], n * 3); uv.set([wx / 3, wz / 3], n * 2);
    const dx = terrainVertex(wx - 1, wz, seed) - terrainVertex(wx + 1, wz, seed), dz = terrainVertex(wx, wz - 1, seed) - terrainVertex(wx, wz + 1, seed), length = Math.hypot(dx, 2, dz);
    normals.set([dx / length, 2 / length, dz / length], n * 3);
    const tint = .94 + hash(Math.floor(wx / 4), Math.floor(wz / 4), seed ^ 6113) * .08;
    const color = y < .85 ? [.62, .53, .32] : Math.hypot(dx, dz) > 1.5 || y > 19 ? [.36, .39, .41] : [.15, .34, .19];
    colors.set(color.map(c => c * tint), n * 3);
  }
  let n = 0;
  for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) {
    const a = z * side + x, b = a + 1, c = a + side, d = c + 1;
    indices.set([a, c, b, b, c, d], n); n += 6;
  }
  const trees = treesIn(ox, oz, ox + CHUNK_SIZE, oz + CHUNK_SIZE, seed).filter(t => t.x >= ox && t.x < ox + CHUNK_SIZE && t.z >= oz && t.z < oz + CHUNK_SIZE);
  return { key: `${cx},${cz}`, seed, cx, cz, positions, normals, colors, uv, indices, trees };
}
