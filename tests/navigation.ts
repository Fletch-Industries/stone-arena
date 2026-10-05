import { terrainHeight, worldBoxes } from '../shared/world.js';
import type { Construction } from '../shared/construction.js';
import { BOXES, HEIGHT, LIMIT, RADIUS } from '../shared/game.js';
type Point = { x: number; z: number };
/** Visit the final detour before aiming at the exact target; it may skirt a rune. */
export function routeFollower(route: number[][], target: Point, tolerance = .65) {
  let next = 0;
  const end = [target.x, target.z];
  return (position: Point) => {
    while (next < route.length && Math.hypot(position.x - route[next][0], position.z - route[next][1]) < tolerance) next++;
    return next === route.length ? end : route[next];
  };
}
const bound = Math.floor(LIMIT), key = (x: number, z: number) => `${x},${z}`;
const blocked = new Set<string>();
for (const box of BOXES) {
  if ((box.y ?? 0) >= HEIGHT || (box.y ?? 0) + box.h <= .41) continue;
  for (let x = Math.ceil(box.x - box.w / 2 - RADIUS - .08); x <= Math.floor(box.x + box.w / 2 + RADIUS + .08); x++)
    for (let z = Math.ceil(box.z - box.d / 2 - RADIUS - .08); z <= Math.floor(box.z + box.d / 2 + RADIUS + .08); z++) blocked.add(key(x, z));
}
export function groundPath(a: Point, b: Point): number[][] {
  const start = [Math.round(a.x), Math.round(a.z)], goal = [Math.round(b.x), Math.round(b.z)];
  const queue = [start], previous = new Map<string, number[] | null>([[key(...start as [number, number]), null]]);
  let found: number[] | undefined;
  for (let n = 0; n < queue.length; n++) {
    const v = queue[n];
    if (Math.hypot(v[0] - goal[0], v[1] - goal[1]) < 1.5) { found = v; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [v[0] + dx, v[1] + dz], k = key(next[0], next[1]);
      if (Math.abs(next[0]) > bound || Math.abs(next[1]) > bound || blocked.has(k) || previous.has(k)) continue;
      previous.set(k, v); queue.push(next);
    }
  }
  if (!found) return [];
  const route = [found];
  while (previous.get(key(route[0][0], route[0][1]))) route.unshift(previous.get(key(route[0][0], route[0][1]))!);
  return route;
}
// Test clients navigate through normal inputs. Cache routes between goal changes
// instead of searching the entire larger arena on every input packet.
export function navigator() {
  let route: number[][] = [], goalKey = '';
  return (a: Point, b: Point) => {
    const goal = key(Math.round(b.x), Math.round(b.z));
    while (route.length > 1 && Math.hypot(a.x - route[0][0], a.z - route[0][1]) < .45) route.shift();
    if (goal !== goalKey || !route.length || Math.hypot(a.x - route[0][0], a.z - route[0][1]) > 3) { route = groundPath(a, b); goalKey = goal; }
    if (route.length > 1 && Math.hypot(a.x - route[0][0], a.z - route[0][1]) < .45) route.shift();
    return route[0] ?? [a.x, a.z];
  };
}

export function wildRoute(from: Point, target: Point, seed: number, construction?: Construction) {
  // Keep existing coarse routes. A one-block fallback can resolve clear lanes
  // that the two-block sampling misses, without relaxing obstacle clearance.
  function plan(step: number) {
    const start = [Math.round(from.x / step), Math.round(from.z / step)];
    const goal = [Math.round(target.x / step), Math.round(target.z / step)];
    const queue = [start], parents = new Map<string, number[] | null>([[key(start[0], start[1]), null]]);
    const margin = 24 / step;
    const minX = Math.min(start[0], goal[0]) - margin, maxX = Math.max(start[0], goal[0]) + margin;
    const minZ = Math.min(start[1], goal[1]) - margin, maxZ = Math.max(start[1], goal[1]) + margin;
    for (let n = 0; n < queue.length; n++) {
      const v = queue[n];
      if (Math.hypot(v[0] - goal[0], v[1] - goal[1]) < 1.5) {
        const route = [v];
        while (parents.get(key(route[0][0], route[0][1]))) route.unshift(parents.get(key(route[0][0], route[0][1]))!);
        return route.map(p => [p[0] * step, p[1] * step]);
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = v[0] + dx, z = v[1] + dz, k = key(x, z), wx = x * step, wz = z * step;
        if (x < minX || x > maxX || z < minZ || z > maxZ || parents.has(k)) continue;
        // Avoid complete obstacle columns and keep the return portal out of outdoor routes.
        if (Math.abs(wx) < 3.5 && wz >= 3 && wz <= 13) continue;
        if (worldBoxes(wx, wz, wx, wz, 'wilds', { seed, doorOpen: true, construction }).some(b => Math.abs(wx - b.x) < b.w / 2 + 1 && Math.abs(wz - b.z) < b.d / 2 + 1)) continue;
        parents.set(k, v); queue.push([x, z]);
      }
    }
  }
  const route = plan(2) ?? plan(1);
  if (!route) throw Error('No test route: ' + JSON.stringify({ seed, from: { x: from.x, z: from.z }, target: { x: target.x, z: target.z }, clearance: 1, margin: 24 }));
  return route;
}
