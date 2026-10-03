import test from 'node:test';
import assert from 'node:assert/strict';
import { BIOMES, biomeAt, biomeBlend, terrainColor } from '../shared/biomes.js';
import { buildTerrainChunk } from '../shared/terrain-mesh.js';
import { buildHorizon } from '../shared/horizon.js';
import { hash, terrainHeight, terrainVertex, treeAt, treeCacheSize, worldBoxes } from '../shared/world.js';
import { HOME_WAYSTONE, awakenedCount, nearbyWaystone, waystoneSites, waystoneBoxes } from '../shared/waystones.js';
import { Simulation } from '../server/simulation.js';
import { idleInput } from '../shared/game.js';
const seed = 7919;
function explorer() { const sim = new Simulation(seed), p = sim.add('p','Warden'); sim.phase='active';sim.practice=true;Object.assign(p,{realm:'wilds',x:0,z:-5,y:0,relics:7});return {sim,p}; }
test('seeded habitats contain four distinct biomes, normalized blends and a gentle arrival clearing', () => {
  const seen = new Set();
  for (let x=-500;x<=500;x+=50) for (let z=-500;z<=500;z+=50) { seen.add(biomeAt(x,z,seed));const blend=biomeBlend(x,z,seed);assert(blend.every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert(Math.abs(blend.reduce((a,b)=>a+b)-1)<1e-10);assert.deepEqual(blend,biomeBlend(x,z,seed)); }
  assert.equal(seen.size,4);assert.equal(biomeAt(0,0,seed),'meadow');assert.deepEqual(biomeBlend(0,0,seed),[1,0,0,0]);assert.notDeepEqual(biomeBlend(400,230,seed),biomeBlend(400,230,17));
  assert.equal(new Set(Object.values(BIOMES).map(b=>b.leaves)).size,4);
  assert.equal(hash(0,0,3143351877^91283),1);assert(biomeBlend(100,100,3143351877).every(v=>Number.isFinite(v)&&v>=0&&v<=1));
});
test('near terrain and the horizon use the same vertex palette and bounded flora generation', () => {
  const near=buildTerrainChunk(0,0,seed), horizon=buildHorizon(0,0,seed,2,'high');
  for (let n=0;n<near.positions.length/3;n++) {const x=near.positions[n*3],z=near.positions[n*3+2],y=terrainVertex(x,z,seed),dx=terrainVertex(x-1,z,seed)-terrainVertex(x+1,z,seed),dz=terrainVertex(x,z-1,seed)-terrainVertex(x,z+1,seed);assert.deepEqual([...near.colors.slice(n*3,n*3+3)],[...new Float32Array(terrainColor(x,z,seed,y,Math.hypot(dx,dz)))]);}
  for(let n=0;n<horizon.positions.length/3;n+=127){const x=horizon.positions[n*3],z=horizon.positions[n*3+2],y=terrainVertex(x,z,seed),dx=terrainVertex(x-1,z,seed)-terrainVertex(x+1,z,seed),dz=terrainVertex(x,z-1,seed)-terrainVertex(x,z+1,seed);assert.deepEqual([...horizon.colors.slice(n*3,n*3+3)],[...new Float32Array(terrainColor(x,z,seed,y,Math.hypot(dx,dz)))]);}
  for(const [x,z] of [[-3,7],[20,-5],[0,0]]){const chunk=buildTerrainChunk(x,z,seed);assert(chunk.plants.length<=16);assert.deepEqual(chunk.plants,buildTerrainChunk(x,z,seed).plants);for(const p of chunk.plants){assert.equal(p.y,terrainHeight(p.x,p.z,seed));assert(p.x>=x*24&&p.x<(x+1)*24&&p.z>=z*24&&p.z<(z+1)*24);}}
  assert.equal(horizon.plants.length,0);
});
test('ruins have clear approaches, actual terrain-supported pillars and seeded persistent identities',()=>{
  const sites=waystoneSites(seed);assert.equal(sites.length,8);assert.deepEqual(sites,waystoneSites(seed));assert.notDeepEqual(sites,waystoneSites(17));
  for(const s of sites){assert.equal(s.y,terrainHeight(s.x,s.z,seed));assert(Math.hypot(s.x,s.z)>150);assert(Math.hypot(s.x,s.z)<510);const boxes=waystoneBoxes(s,seed);assert.equal(boxes.length,5);for(const b of boxes.slice(0,4))assert(Math.abs((b.y??0)-terrainHeight(b.x,b.z,seed)+.2)<1e-9);
    const bodies=worldBoxes(s.x,s.z,s.x,s.z,'wilds',{seed,doorOpen:true});assert(!bodies.some(b=>Math.abs(s.x-b.x)<b.w/2+.3&&Math.abs(s.z-b.z)<b.d/2+.3&&s.y+1.8>(b.y??0)&&s.y<(b.y??0)+b.h));
    for(let x=Math.floor((s.x-9)/12);x<=Math.floor((s.x+9)/12);x++)for(let z=Math.floor((s.z-9)/12);z<=Math.floor((s.z+9)/12);z++){const t=treeAt(x,z,seed);if(t)assert(Math.hypot(t.x-s.x,t.z-s.z)>=9);}
  }
});
test('only live connected nearby explorers awaken a stone, once for the shared room; discoveries survive rematches',()=>{
  const {sim,p}=explorer(),s=waystoneSites(seed)[0];p.relics=0;Object.assign(p,{x:s.x,z:s.z,y:s.y});p.connected=false;sim.step();assert.equal(sim.world.waystones,1);p.connected=true;sim.step();assert.equal(sim.world.waystones,3);assert.equal(awakenedCount(sim.world.waystones),1);sim.step();assert.equal(sim.events.filter(e=>e.type==='waystone').length,1);
  sim.lobby(p.id);p.ready=true;assert(sim.start(p.id,true));assert.equal(sim.world.waystones,3);assert.equal(p.relics,0);assert.equal(new Simulation(17).world.waystones,1);
});
test('Warden travel requires all shards, proximity, discovered source and destination, and safe identity-bound state',()=>{
  const {sim,p}=explorer(),s=waystoneSites(seed)[0];assert(!sim.warp(p.id,s.id));sim.world.waystones=3;
  for(const bad of [-1,9,1.1,'1',null,{},NaN])assert(!sim.warp(p.id,bad));assert(!sim.warp('another',s.id));assert(!sim.warp(p.id,0));
  p.relics=3;assert(!sim.warp(p.id,s.id));p.relics=7;p.connected=false;assert(!sim.warp(p.id,s.id));p.connected=true;p.alive=false;assert(!sim.warp(p.id,s.id));p.alive=true;p.x=15;assert(!sim.warp(p.id,s.id));p.x=0;p.y=9;assert(!sim.warp(p.id,s.id));p.y=0;
  const undiscovered=waystoneSites(seed)[1];Object.assign(p,{x:undiscovered.x,z:undiscovered.z,y:undiscovered.y});assert(!sim.warp(p.id,0));Object.assign(p,{x:0,z:-5,y:0});
  sim.step();assert(sim.history.some(frame=>frame.players.has(p.id)));
  Object.assign(p,{hp:60,ammo:8,apples:1,totems:0,xp:50,charge:.8,vx:9,vy:3,dashTime:.2});assert(sim.warp(p.id,s.id));assert.equal(p.x,s.x);assert.equal(p.y,s.y);assert.equal(p.z,s.z);assert.equal(p.realm,'wilds');assert.equal(p.hp,60);assert.equal(p.ammo,8);assert.equal(p.apples,1);assert.equal(p.totems,0);assert.equal(p.xp,50);assert.equal(p.charge,0);assert.equal(p.vx,0);assert.equal(p.dashTime,0);assert.equal(sim.events.at(-1)?.type,'warp');assert(!sim.history.some(frame=>frame.players.has(p.id)));
  assert(!sim.warp(p.id,0));sim.tick+=120;assert(sim.warp(p.id,0));assert.equal(p.z,HOME_WAYSTONE.z);assert.equal(p.y,0);
});
test('travel cannot bypass recent damage, early cooldown, lobby/results state or arena realm',()=>{
  const sim=new Simulation(seed),p=sim.add('p','Warden'),enemy=sim.add('enemy','Opponent');sim.phase='active';sim.world.waystones=3;Object.assign(p,{realm:'wilds',x:0,z:-5,y:0,relics:7});Object.assign(enemy,{realm:'wilds',x:0,z:-3});assert(sim.damage(p,enemy,10));assert(!sim.warp(p.id,1));sim.tick+=299;p.hurtTime=0;assert(!sim.warp(p.id,1));sim.tick++;assert(sim.warp(p.id,1));
  sim.tick+=120;sim.phase='results';assert(!sim.warp(p.id,0));sim.phase='active';p.realm='arena';assert(!sim.warp(p.id,0));p.realm='wilds';p.alive=false;assert(!sim.warp(p.id,0));
});
test('client movement cannot forge shared discoveries, Warden progress, location or travel cooldown',()=>{
  const {sim,p}=explorer();p.relics=0;sim.input(p.id,{...idleInput(),seq:1,waystones:511,relics:7,destination:1,warpReadyAt:0,xPosition:999} as any);sim.step();assert.equal(sim.world.waystones,1);assert.equal(p.relics,0);assert.equal(p.x,0);assert.equal(p.z,-5);assert.equal(p.warpTick,-1000);assert.equal(nearbyWaystone(p,seed)?.id,0);
});
test('new tree habitat cache is bounded across long travel and many seeds',()=>{for(let n=0;n<2600;n++)treeAt(n-1300,n%31-15,seed+n%13);assert(treeCacheSize()<=2048);const t=treeAt(5,2,seed);assert.deepEqual(t,treeAt(5,2,seed));});
