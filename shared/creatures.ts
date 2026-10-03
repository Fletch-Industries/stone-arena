import { floorHeight, nativeBox } from './terrain-collision.js';
import { biomeAt, type Biome } from './biomes.js';
import { direction, EYE, wallHit, segmentBox, type Player } from './game.js';
import { hash, terrainHeight, worldBoxes, type WorldState } from './world.js';
import { protectedRuneSite } from './weaving.js';
import { waystoneSites } from './waystones.js';

export const CREATURES = [
  { name: 'Mosskip', biome: 'meadow', color: '#95d4a3', accent: '#baf9ce', food: 0, glyph: '❧', description: 'A springy grove friend with leaf antlers. Offer a Lumen reed, then ask it to scout for more.' },
  { name: 'Moonwhisk', biome: 'moonwood', color: '#b7b0e3', accent: '#f1dcff', food: 1, glyph: '✧', description: 'A curious moonlit prowler with a sweeping crystal tail. Gleamstone earns its trust.' },
  { name: 'Emberlug', biome: 'emberfields', color: '#da9d62', accent: '#ffe0a2', food: 2, glyph: '✹', description: 'A little lantern beetle with warm patterned plates. Share an Emberbloom and explore together.' },
  { name: 'Tidewing', biome: 'tideglade', color: '#84cbde', accent: '#cafff2', food: 0, glyph: '⋈', description: 'A gliding reef spirit with ribbon fins. It loves Lumen reeds and finds growing patches.' },
] as const;
export type CreatureKind = 0 | 1 | 2 | 3 | 4;
export const WILDLIFE = { limit: 32, region: 64, radius: 100, retireRadius: 144, cacheLimit: 512, reach: 4.5, scoutRadius: 72, scoutSeconds: 12 } as const;
export const WARDEN = { health: 120, damage: 24, pulseRadius: 3, windup: .9, recover: 1.25, leash: 32, engage: 24 } as const;
export type CreatureState = 'idle' | 'wander' | 'follow' | 'scout' | 'dormant' | 'chase' | 'windup' | 'recover' | 'cleared';
export const CREATURE_STATES: CreatureState[] = ['idle','wander','follow','scout','dormant','chase','windup','recover','cleared'];
export interface CreatureView { id: string; kind: CreatureKind; x: number; y: number; z: number; yaw: number; hp: number; state: CreatureState; timer: number; owner: string; aimX: number; aimZ: number }
/** Compact, centimeter-precision poses keep all 32 actors inexpensive at 20Hz. */
export type CreatureWire = [string, CreatureKind, number, number, number, number, number, number, number, string, number, number];
const rounded = (n: number) => Math.round(n * 100) / 100;
export const creatureWire = (c: CreatureView): CreatureWire => [c.id,c.kind,rounded(c.x),rounded(c.y),rounded(c.z),rounded(c.yaw),rounded(c.hp),CREATURE_STATES.indexOf(c.state),rounded(c.timer),c.owner,rounded(c.aimX),rounded(c.aimZ)];
export function creatureView(w: CreatureWire): CreatureView { return { id:w[0],kind:w[1],x:w[2],y:w[3],z:w[4],yaw:w[5],hp:w[6],state:CREATURE_STATES[w[7]],timer:w[8],owner:w[9],aimX:w[10],aimZ:w[11] }; }
export interface CreatureNest { id: string; kind: CreatureKind; x: number; y: number; z: number; ruin: number }
const nests = new Map<string, CreatureNest[]>();
export const creatureCacheSize = () => nests.size;
export const habitatKind = (biome: Biome): CreatureKind => Math.max(0, CREATURES.findIndex(s => s.biome === biome)) as CreatureKind;
export function creatureClear(x: number, z: number, world: WorldState, landmarks = true, fromY = Infinity, radius = .7) {
  const y = floorHeight(x,z,fromY,world), underground = Number.isFinite(fromY) && !!world.excavation?.column(x,z);
  return Math.abs(x) < 4090 && Math.abs(z) < 4090 && (underground || y >= .6) && (!landmarks || !protectedRuneSite(x,z,world.seed)) && (!underground || !nativeBox(x-radius,y+.03,z-radius,x+radius,y+1.8,z+radius,world)) && !worldBoxes(x-radius,z-radius,x+radius,z+radius,'wilds',world).some(b => Math.abs(x-b.x)<b.w/2+radius && Math.abs(z-b.z)<b.d/2+radius && y < (b.y??0)+b.h && y+1.8 > (b.y??0));
}
export function creatureNests(cx: number, cz: number, seed: number) {
  if (!Number.isInteger(cx)||!Number.isInteger(cz)||Math.abs(cx)>64||Math.abs(cz)>64) return [];
  const key=`${seed}:${cx},${cz}`; const cached=nests.get(key); if(cached) return cached;
  const found:CreatureNest[]=[], world={seed,doorOpen:true};
  for(let slot=0;slot<2;slot++) for(let attempt=0;attempt<12;attempt++) {
    const x=cx*WILDLIFE.region+7+hash(cx*17+attempt,cz*7+slot,seed^919)*50;
    const z=cz*WILDLIFE.region+7+hash(cx*7+slot,cz*17+attempt,seed^1327)*50;
    if(!creatureClear(x,z,world))continue;
    found.push({id:`grove:${cx},${cz}:${slot}`,kind:habitatKind(biomeAt(x,z,seed)),x,y:terrainHeight(x,z,seed),z,ruin:0});break;
  }
  if(nests.size>=WILDLIFE.cacheLimit)nests.delete(nests.keys().next().value!);nests.set(key,found);return found;
}
export function guardianNests(seed:number) {
  return waystoneSites(seed).flatMap(s => {
    for(let n=0;n<16;n++) { const a=n*Math.PI/8+hash(s.id,0,seed)*6, x=s.x+Math.sin(a)*16,z=s.z+Math.cos(a)*16;
      if(creatureClear(x,z,{seed,doorOpen:true}))return [{id:`warden:${s.id}`,kind:4 as const,x,y:terrainHeight(x,z,seed),z,ruin:s.id}]; }
    return [];
  });
}
export function creatureTouch(p: Pick<Player,'x'|'y'|'z'|'yaw'|'pitch'|'realm'>, creatures: Iterable<CreatureView>, world: WorldState, reach=WILDLIFE.reach) {
  if(p.realm!=='wilds')return; const a={x:p.x,y:p.y+EYE,z:p.z},d=direction(p.yaw,p.pitch);let best:CreatureView|undefined,score=Infinity;
  for(const c of creatures){const b={x:c.x,y:c.y+(c.kind===4?1:.8),z:c.z},dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,dist=Math.hypot(dx,dy,dz);
    if(dist>reach||dist<.01||(dx*d.x+dy*d.y+dz*d.z)/dist<.7||wallHit(a,b,'wilds',world)<.99)continue;
    if(dist<score){best=c;score=dist;}}
  return best;
}
export function guardianRay(a:{x:number;y:number;z:number},b:typeof a,creatures:Iterable<CreatureView>,realm:string) {
  if(realm!=='wilds')return;let best:CreatureView|undefined,nearest=Infinity;
  for(const c of creatures)if(c.kind===4&&c.hp>0&&c.state!=='cleared'){const t=segmentBox(a,b,[c.x-.6,c.y,c.z-.6],[c.x+.6,c.y+1.9,c.z+.6]);if(t<nearest){best=c;nearest=t;}}
  return best?{creature:best,t:nearest}:undefined;
}
export const bondCount = (mask=0) => CREATURES.reduce((n,_,k)=>n+Number(!!(mask&1<<k)),0);
export const guardianCount = (mask=0) => {let n=0;for(let k=1;k<=8;k++)n+=Number(!!(mask&1<<k));return n;};
export const validBonds = (n:unknown):n is number => Number.isInteger(n)&&(n as number)>=0&&(n as number)<=15;
export const validGuardians = (n:unknown):n is number => Number.isInteger(n)&&(n as number)>=0&&(n as number)<=510&&((n as number)&1)===0;
