import { CHUNK_SIZE, terrainVertex, treesIn, hash } from './world.js';
import type { TerrainChunk } from './terrain-mesh.js';
export const vistaDistance = (quality: string) => quality === 'low' ? 150 : quality === 'high' ? 440 : 280;
/** One coarse mesh beyond the exact collision ring. Aligned cells leave its inner square open. */
export function buildHorizon(cx: number, cz: number, seed: number, radius: number, quality: string): TerrainChunk {
  const step = quality === 'high' ? 6 : quality === 'low' ? 12 : 8;
  const extent = Math.ceil(vistaDistance(quality) / CHUNK_SIZE) * CHUNK_SIZE + CHUNK_SIZE, cells = extent * 2 / step, side = cells + 1;
  const ox = cx * CHUNK_SIZE - extent, oz = cz * CHUNK_SIZE - extent;
  const minX = (cx - radius) * CHUNK_SIZE, maxX = (cx + radius + 1) * CHUNK_SIZE, minZ = (cz - radius) * CHUNK_SIZE, maxZ = (cz + radius + 1) * CHUNK_SIZE;
  const positions = new Float32Array(side * side * 3), normals = new Float32Array(side * side * 3), colors = new Float32Array(side * side * 3), uv = new Float32Array(side * side * 2), indices: number[] = [];
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const i = z * side + x, wx = ox + x * step, wz = oz + z * step, y = terrainVertex(wx, wz, seed);
    positions.set([wx, y - .015, wz], i * 3);
    const dx = terrainVertex(wx - 1, wz, seed) - terrainVertex(wx + 1, wz, seed), dz = terrainVertex(wx, wz - 1, seed) - terrainVertex(wx, wz + 1, seed), len = Math.hypot(dx, 2, dz);
    normals.set([dx / len, 2 / len, dz / len], i * 3); uv.set([wx / 3, wz / 3], i * 2);
    const c = y < .85 ? [.62, .53, .32] : Math.hypot(dx, dz) > 1.5 || y > 19 ? [.36, .39, .41] : [.15, .34, .19]; colors.set(c, i * 3);
    if (x === cells || z === cells) continue;
    if (wx >= minX && wx < maxX && wz >= minZ && wz < maxZ) continue;
    indices.push(i, i + side, i + 1, i + 1, i + side, i + side + 1);
  }
  const trees = treesIn(ox, oz, ox + extent * 2, oz + extent * 2, seed).filter(t => !(t.x >= minX && t.x < maxX && t.z >= minZ && t.z < maxZ) && (quality !== 'low' || hash(Math.floor(t.x), Math.floor(t.z), seed) > .6));
  return { key: 'horizon', seed, cx: 0, cz: 0, positions, normals, colors, uv, indices: new Uint16Array(indices), trees };
}
