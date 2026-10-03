import { ECHO_CHISEL, Excavation, SCULPT } from '../shared/excavation.js';
import { sculptReason, stratumAt } from '../shared/mining.js';
import { terrainHeight, type WorldState } from '../shared/world.js';

/** Visible preview controls use this deterministic, portable cave fixture. */
export function carvedCave(world: WorldState) {
  world.excavation = new Excavation(); world.upgrades = (world.upgrades ?? 0) | ECHO_CHISEL;
  for (let x = 40; x < 320; x += 4) for (let z = -280; z < -40; z += 4) {
    let low = Infinity, valid = true;
    for (let dx = 0; dx < 7; dx++) for (let dz = 0; dz < 10; dz++) { low = Math.min(low, terrainHeight(x+dx+.5,z+dz+.5,world.seed)); if (sculptReason({ x:x+dx,y:-4,z:z+dz },world)) valid = false; }
    const floor = Math.floor(low) - 4; if (!valid || floor < SCULPT.minHeight || low < 2) continue;
    // A wide room and stairwell to daylight, with the roof left above the room.
    for (let dx = 0; dx < 7; dx++) for (let dz = 0; dz < 10; dz++) for (let y = floor; y < floor+3; y++) world.excavation.dig({x:x+dx,y,z:z+dz,owner:'preview'},stratumAt(x+dx,y,z+dz,world.seed).vein!==undefined);
    for (let dz = 6; dz < 10; dz++) for (let dx = 2; dx < 5; dx++) for (let y = floor+dz-5; y < terrainHeight(x+dx+.5,z+dz+.5,world.seed); y++) world.excavation.dig({x:x+dx,y,z:z+dz,owner:'preview'},stratumAt(x+dx,y,z+dz,world.seed).vein!==undefined);
    return { x:x+3.5,y:floor,z:z+4.5,yaw:0,pitch:0,realm:'wilds' as const,grounded:true,vy:0,vx:0,vz:0 };
  }
  throw Error('No clear cave preview plot');
}
export function excavationStress(world: WorldState) {
  world.excavation = new Excavation(); world.upgrades = (world.upgrades ?? 0) | ECHO_CHISEL;
  for (let x = 40; x < 260 && world.excavation.size < SCULPT.roomLimit; x++) for (let z = -180; z < -40 && world.excavation.size < SCULPT.roomLimit; z++) {
    if (sculptReason({x,y:-8,z},world)) continue;
    const h = terrainHeight(x+.5,z+.5,world.seed);
    for (let y = -8; y < h && world.excavation.size < SCULPT.roomLimit; y++) {
      const vein = stratumAt(x,y,z,world.seed).vein!==undefined; if (vein && world.excavation.veinCount >= SCULPT.veinLimit) continue;
      world.excavation.dig({x,y,z,owner:`stress:${Math.floor(world.excavation.size/SCULPT.playerLimit)}`},vein);
    }
  }
  return { x:75.5,y:terrainHeight(75.5,-25.5,world.seed),z:-25.5,yaw:0,pitch:-.1,realm:'wilds' as const,grounded:true,vy:0,vx:0,vz:0 };
}
