import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHorizon, vistaDistance } from '../shared/horizon.js';
import { shardSites, shardCount, WINDSTEP } from '../shared/expedition.js';
import { terrainHeight, treeAt, WORLD_LIMIT } from '../shared/world.js';
import { move, idleInput, validInput, DT } from '../shared/game.js';
import { Simulation } from '../server/simulation.js';
const world={seed:7919,doorOpen:true};
test('horizon extends each quality with bounded vertices, without covering the exact collision ring',()=>{
  for(const [q,r] of [['low',2],['medium',3],['high',4]] as const){const h=buildHorizon(-2,3,world.seed,r,q);assert(h.positions.length/3<65536);assert(h.indices.every(i=>i<h.positions.length/3));assert(h.normals.every(Number.isFinite));assert(vistaDistance(q)>r*24*2);
    const minX=(-2-r)*24,maxX=(-2+r+1)*24,minZ=(3-r)*24,maxZ=(3+r+1)*24;
    for(let n=0;n<h.indices.length;n+=3){const ids=[h.indices[n],h.indices[n+1],h.indices[n+2]],x=ids.reduce((v,i)=>v+h.positions[i*3],0)/3,z=ids.reduce((v,i)=>v+h.positions[i*3+2],0)/3;assert(!(x>minX&&x<maxX&&z>minZ&&z<maxZ));}
  }
});
test('skyshards are shared, seeded, reachable, and their clearings exclude generated trees',()=>{const sites=shardSites(world.seed);assert.deepEqual(sites,shardSites(world.seed));assert.notDeepEqual(sites,shardSites(17));assert.equal(shardCount(7),3);assert.equal(shardCount(5),2);for(const s of sites){assert(Math.hypot(s.x,s.z)<WORLD_LIMIT);assert.equal(s.y,terrainHeight(s.x,s.z,world.seed));for(let x=Math.floor((s.x-7)/12);x<=Math.floor((s.x+7)/12);x++)for(let z=Math.floor((s.z-7)/12);z<=Math.floor((s.z+7)/12);z++){const t=treeAt(x,z,world.seed);if(t)assert(Math.hypot(t.x-s.x,t.z-s.z)>=7);}}});
test('Windstep is limited to the Wilds, predicts identically, has a cooldown and does not repeat while held',()=>{const a={realm:'wilds' as const,x:0,z:0,y:0,vy:0,grounded:true},b={...a};for(let n=0;n<300;n++){const i={...idleInput(),dash:true};move(a,i,DT,false,world);move(b,i,DT,false,world);}assert.deepEqual(a,b);assert(a.z<-6&&a.z>-7.5);move(a,idleInput(),DT,false,world);move(a,{...idleInput(),dash:true},DT,false,world);assert((a as any).dashCooldown>3.9);const arena={...a,realm:'arena' as const,x:0,z:0,dashTime:0,dashCooldown:0,dashHeld:false};move(arena,{...idleInput(),dash:true},DT,false,world);assert.equal(arena.dashTime,0);assert(!validInput({...idleInput(),dash:22}));});
test('Windstep cannot cross the return tunnel walls and cannot bypass collision',()=>{const p={realm:'wilds' as const,x:0,z:6,y:0,vy:0,grounded:true};for(let n=0;n<20;n++)move(p,{...idleInput(),dash:true,yaw:-Math.PI/2},DT,false,world);assert(p.x<1.7);assert(p.x>=0);});
test('collecting requires live connected proximity, awards each shard once and keeps no permanent advantage',()=>{const s=new Simulation(world.seed),p=s.add('p','Explorer');s.practice=true;s.phase='active';const site=shardSites(world.seed)[0];Object.assign(p,{realm:'wilds',x:site.x,z:site.z,y:site.y});p.connected=false;s.step();assert.equal(p.relics,0);p.connected=true;s.step();assert.equal(p.relics,1);const count=s.events.filter(e=>e.type==='relic').length;s.step();assert.equal(s.events.filter(e=>e.type==='relic').length,count);assert.equal(p.xp,0);assert.equal(p.hp,100);for(const a of shardSites(world.seed).slice(1)){Object.assign(p,{x:a.x,z:a.z,y:a.y,vy:0});s.step();}assert.equal(p.relics,7);s.lobby(p.id);p.ready=true;s.start(p.id,true);assert.equal(p.relics,0);});
