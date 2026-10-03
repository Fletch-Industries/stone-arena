import { terrainHeight, worldBoxes } from '../shared/world.js';
import type { Construction } from '../shared/construction.js';
import { BOXES, HEIGHT, LIMIT, RADIUS } from '../shared/game.js';
type Point = { x: number; z: number };
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

export function wildRoute(from: {x:number;z:number}, target:{x:number;z:number}, seed:number, construction?:Construction) {
  const key=(x:number,z:number)=>`${x},${z}`, start=[Math.round(from.x/2),Math.round(from.z/2)], goal=[Math.round(target.x/2),Math.round(target.z/2)], queue=[start], parents=new Map<string,number[]|null>([[key(start[0],start[1]),null]]);
  const minX=Math.min(start[0],goal[0])-12,maxX=Math.max(start[0],goal[0])+12,minZ=Math.min(start[1],goal[1])-12,maxZ=Math.max(start[1],goal[1])+12;
  let found:number[]|undefined;
  for(let n=0;n<queue.length;n++){const v=queue[n];if(Math.hypot(v[0]-goal[0],v[1]-goal[1])<1.5){found=v;break;}for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=v[0]+dx,z=v[1]+dz,k=key(x,z);if(x<minX||x>maxX||z<minZ||z>maxZ||parents.has(k))continue;// Avoid complete obstacle columns: downhill headroom can differ from the next cell's floor. Keep the return portal out of outdoor routes.
      if(Math.abs(x*2)<3.5&&z*2>=3&&z*2<=13)continue;const y=terrainHeight(x*2,z*2,seed);if(worldBoxes(x*2,z*2,x*2,z*2,'wilds',{seed,doorOpen:true,construction}).some(b=>Math.abs(x*2-b.x)<b.w/2+1&&Math.abs(z*2-b.z)<b.d/2+1))continue;parents.set(k,v);queue.push([x,z]);}}
  if(!found)throw Error('No route to the skyshard');const route=[found];while(parents.get(key(route[0][0],route[0][1])))route.unshift(parents.get(key(route[0][0],route[0][1]))!);return route.map(v=>[v[0]*2,v[1]*2]);
}
