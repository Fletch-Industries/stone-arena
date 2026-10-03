import { terrainHeight, type WorldState } from './world.js';
import { SCULPT } from './excavation.js';

interface Point { x: number; y: number; z: number }
const EPS = 1e-6;
/** Top of the nearest solid layer below a traveller, including a cave floor. */
export function floorHeight(x: number, z: number, y: number, world: WorldState) {
  const height = terrainHeight(x, z, world.seed), column = world.excavation?.column(x, z);
  if (!column) return height;
  let floor = y >= height - EPS ? height : Math.min(height, Math.floor(y + EPS) + 1);
  for (let cell = Math.ceil(floor - EPS) - 1; cell >= SCULPT.minHeight && column.has(cell); cell--) floor = cell;
  return floor;
}
export const surfaceHeight = (x: number, z: number, world: WorldState) => floorHeight(x, z, Infinity, world);
/** A closed native roof stops jumps even when the open sky is above the hill. */
export function ceilingHeight(x: number, z: number, y: number, world: WorldState) {
  const column = world.excavation?.column(x, z), height = terrainHeight(x, z, world.seed);
  if (!column || y >= height) return Infinity;
  for (let cell = Math.floor(y + EPS); cell < height; cell++) if (!column.has(cell)) return cell;
  return Infinity;
}
export function nativeSolid(p: Point, world: WorldState) {
  return p.y < terrainHeight(p.x, p.z, world.seed) - EPS && !world.excavation?.has(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
}
/** A linear terrain triangle reaches its maximum at one of the clipped corners. */
export function rectangleHeight(x0: number, z0: number, x1: number, z1: number, seed: number, maximum = true) {
  const points = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]];
  const diagonal = Math.floor(x0 + EPS) + Math.floor(z0 + EPS) + 1;
  for (const x of [x0, x1]) if (diagonal - x >= z0 && diagonal - x <= z1) points.push([x, diagonal - x]);
  for (const z of [z0, z1]) if (diagonal - z >= x0 && diagonal - z <= x1) points.push([diagonal - z, z]);
  const values = points.map(([x, z]) => terrainHeight(x, z, seed));
  return maximum ? Math.max(...values) : Math.min(...values);
}
/** Exact native density overlap; no voxels are allocated for unedited columns. */
export function nativeBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, world: WorldState) {
  if (x1 - x0 < EPS || z1 - z0 < EPS || y1 - y0 < EPS) return false;
  for (let x = Math.floor(x0 + EPS); x <= Math.floor(x1 - EPS); x++) for (let z = Math.floor(z0 + EPS); z <= Math.floor(z1 - EPS); z++) {
    const height = rectangleHeight(Math.max(x0, x), Math.max(z0, z), Math.min(x1, x + 1), Math.min(z1, z + 1), world.seed);
    const top = Math.min(y1, height); if (y0 >= top - EPS) continue;
    if (y0 < SCULPT.minHeight) return true;
    const column = world.excavation?.column(x, z);
    if (!column) return true;
    for (let y = Math.floor(y0 + EPS); y < top - EPS; y++) if (!column.has(y)) return true;
  }
  return false;
}
/** Cell and triangle-plane crossings keep thin cave walls visible to every ray. */
export function nativeRay(a: Point, b: Point, world: WorldState) {
  const breaks = [0, 1], d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  for (const [start, end] of [[a.x, b.x], [a.y, b.y], [a.z, b.z], [a.x + a.z, b.x + b.z]]) {
    if (Math.abs(end - start) < EPS) continue;
    for (let n = Math.floor(Math.min(start, end)) + 1; n < Math.max(start, end); n++) breaks.push((n - start) / (end - start));
  }
  breaks.sort((u, v) => u - v);
  const point = (t: number) => ({ x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t });
  const gap = (t: number) => { const p = point(t); return p.y - terrainHeight(p.x, p.z, world.seed); };
  for (let n = 0; n < breaks.length - 1; n++) {
    const lo = breaks[n], hi = breaks[n + 1]; if (hi - lo < EPS) continue;
    const middle = point((lo + hi) / 2);
    if (world.excavation?.has(Math.floor(middle.x), Math.floor(middle.y), Math.floor(middle.z))) continue;
    const first = gap(lo), last = gap(hi);
    if (first <= EPS) return lo;
    if (last <= EPS) return lo + (hi - lo) * first / (first - last);
  }
  return Infinity;
}
