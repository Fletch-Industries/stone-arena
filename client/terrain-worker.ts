import { buildTerrainChunk } from '../shared/terrain-mesh.js';
import { buildHorizon } from '../shared/horizon.js';
import type { TerrainEdits } from '../shared/excavation.js';
const worker = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (value: unknown, transfer: Transferable[]) => void };
worker.onmessage = (e: MessageEvent<{ cx: number; cz: number; seed: number; epoch: number; radius?: number; quality?: string; horizon?: string; edits?: TerrainEdits }>) => {
  const { cx, cz, seed, epoch, horizon, radius, quality, edits } = e.data;
  const chunk = horizon ? buildHorizon(cx, cz, seed, radius!, quality!) : buildTerrainChunk(cx, cz, seed, edits);
  const meshes = [chunk, chunk.caves, chunk.river].filter(m => !!m);
  worker.postMessage({ epoch, chunk, horizon }, meshes.flatMap(m => [m!.positions.buffer, m!.normals.buffer, m!.colors.buffer, m!.uv.buffer, m!.indices.buffer, ...('glow' in m! ? [m!.glow.buffer] : [])]));
};
