import { buildTerrainChunk } from '../shared/terrain-mesh.js';
const worker = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (value: unknown, transfer: Transferable[]) => void };
worker.onmessage = (e: MessageEvent<{ cx: number; cz: number; seed: number; epoch: number }>) => {
  const { cx, cz, seed, epoch } = e.data, chunk = buildTerrainChunk(cx, cz, seed);
  worker.postMessage({ epoch, chunk }, [chunk.positions.buffer, chunk.normals.buffer, chunk.colors.buffer, chunk.uv.buffer, chunk.indices.buffer]);
};
