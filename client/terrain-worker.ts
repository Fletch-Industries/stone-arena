import { buildTerrainChunk } from '../shared/terrain-mesh.js';
import { buildHorizon } from '../shared/horizon.js';
const worker = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (value: unknown, transfer: Transferable[]) => void };
worker.onmessage = (e: MessageEvent<{ cx: number; cz: number; seed: number; epoch: number; radius?: number; quality?: string; horizon?: string }>) => {
  const { cx, cz, seed, epoch, horizon, radius, quality } = e.data;
  const chunk = horizon ? buildHorizon(cx, cz, seed, radius!, quality!) : buildTerrainChunk(cx, cz, seed);
  worker.postMessage({ epoch, chunk, horizon }, [chunk.positions.buffer, chunk.normals.buffer, chunk.colors.buffer, chunk.uv.buffer, chunk.indices.buffer]);
};
