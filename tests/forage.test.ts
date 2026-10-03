import test from 'node:test';
import assert from 'node:assert/strict';
import { FORAGE, Forage, forageCacheSize, gatherTarget, suppliesNear, supplyAt, validSupplies, type SupplyNode, type ForageChanges } from '../shared/forage.js';
import { protectedRuneSite, weaveTarget } from '../shared/weaving.js';
import { craftReason, hearthNear, RECIPES } from '../shared/crafting.js';
import { HEARTHSTONE, SKY_SAIL, SAIL } from '../shared/sailing.js';
import { DT, EYE, idleInput, JUMP_HEIGHT, move, validInput } from '../shared/game.js';
import { terrainHeight, worldBoxes } from '../shared/world.js';
import { parseWorldSave, restoreWorld, saveWorld } from '../shared/world-save.js';
import { WorldImport } from '../server/world-import.js';
import { Simulation } from '../server/simulation.js';

function explorers() {
  const sim = new Simulation(7919), p = sim.add('host', 'Host'), guest = sim.add('guest', 'Guest'); sim.mode = 'expedition'; sim.phase = 'active';
  Object.assign(p, { realm: 'wilds', x: 0, z: -5, y: 0, yaw: 0, grounded: true }); return { sim, p, guest };
}
function patch() {
  const { sim, p, guest } = explorers();
  for (const node of suppliesNear(0, 0, sim.world.seed, 144)) for (let n = 0; n < 8; n++) {
    const x = node.x + Math.sin(n * Math.PI / 4) * 2.5, z = node.z + Math.cos(n * Math.PI / 4) * 2.5, y = terrainHeight(x, z, sim.world.seed);
    if (worldBoxes(x, z, x, z, 'wilds', sim.world).some(b => Math.abs(x-b.x) < b.w/2+.4 && Math.abs(z-b.z) < b.d/2+.4)) continue;
    Object.assign(p, { x, y, z, yaw: Math.atan2(x-node.x,z-node.z), pitch: Math.atan2(node.y+.9-y-EYE,2.5) });
    if (gatherTarget(p, sim.world, sim.tick) === node) return { sim, p, guest, node };
  }
  throw Error('Missing clear supply patch');
}
test('supply patches are deterministic, clear of native geometry and protected landmarks', () => {
  const a = suppliesNear(0,0,7919,192), b = suppliesNear(0,0,7919,192); assert.deepEqual(a,b); assert(a.length > 20);
  assert.notDeepEqual(a,suppliesNear(0,0,7920,192));
  for(const n of a){assert(!protectedRuneSite(n.x,n.z,7919));assert.equal(n.y,terrainHeight(n.x,n.z,7919));assert(!worldBoxes(n.x,n.z,n.x,n.z,'wilds',{seed:7919,doorOpen:true}).some(b=>Math.abs(n.x-b.x)<b.w/2+1.3&&Math.abs(n.z-b.z)<b.d/2+1.3));}
  for(let seed=0;seed<12;seed++)suppliesNear(seed*150,-seed*220,seed,192);assert(forageCacheSize()<=1024);
  assert.equal(supplyAt(-87,0,0,1),undefined);assert.equal(supplyAt(0,86,0,1),undefined);assert.equal(supplyAt(0,0,3,1),undefined);
});
test('harvest depletion replicates atomically, rejects gaps and regrows once', () => {
  const {node}=patch(), source=new Forage(), peer=new Forage();assert(source.harvest(node,100));assert(!source.harvest(node,101));
  const packet=source.drain(7919) as ForageChanges;assert(peer.apply(packet));assert(peer.apply(packet));assert.deepEqual(peer.state(7919),source.state(7919));
  const before=peer.state(7919);assert(!peer.apply({seed:7919,revision:3,edits:[[3,node.cx+1,node.cz,node.kind,10000]]}));assert.deepEqual(peer.state(7919),before);
  source.expire(100+FORAGE.regrowTicks-1);assert.equal(source.size,1);source.expire(100+FORAGE.regrowTicks);assert.equal(source.size,0);assert(peer.apply(source.drain(7919) as ForageChanges));assert(peer.available(node,8000));assert.equal(source.drain(7919),undefined);
});
test('depletion has a hard memory/packet bound and full restore validates before replacing', () => {
  const f=new Forage();for(let n=0;n<FORAGE.limit;n++)assert(f.harvest({cx:-85+n%128,cz:-85+Math.floor(n/128),kind:n%3,x:0,y:0,z:0},0));
  assert(!f.harvest({cx:70,cz:70,kind:0,x:0,y:0,z:0},0));const state=f.state(1);assert(JSON.stringify(state).length<16000);assert('nodes' in f.drain(1)!);
  const peer=new Forage();assert(peer.restore(state));const prior=peer.state(1);
  for(const bad of [{...state,nodes:[...state.nodes,state.nodes[0]]},{...state,nodes:[[86,0,0,9000]]},{...state,nodes:[[0,0,3,9000]]},{...state,nodes:[[0,0,0,-1]]},{...state,revision:2**31}]){assert(!peer.restore(bad as typeof state));assert.deepEqual(peer.state(1),prior);}
  f.expire(FORAGE.regrowTicks);assert.equal(f.size,0);assert(peer.restore(f.state(1)));assert.equal(peer.size,0);
});
test('gathering requires live nearby aim, credits only bounded party stock and preserves combat supplies', () => {
  const {sim,p,guest,node}=patch(), before={hp:p.hp,ammo:p.ammo,apples:p.apples,xp:p.xp};
  assert(!sim.gather(guest.id));const yaw=p.yaw;p.yaw+=Math.PI;assert(!sim.gather(p.id));p.yaw=yaw;
  assert(sim.gather(p.id));assert.equal(sim.world.supplies![node.kind],FORAGE.yield);assert(!sim.gather(p.id));assert(!sim.world.forage!.available(node,sim.tick));
  assert.deepEqual({hp:p.hp,ammo:p.ammo,apples:p.apples,xp:p.xp},before);assert(sim.events.some(e=>e.type==='gather'&&e.actor===p.id));
  assert(validSupplies([0,999,4]));for(const bad of [[0,-1,4],[0,1000,4],[0,.5,4],[0,2],[0,2,3,4]])assert(!validSupplies(bad));
});
test('dead, disconnected, remote and recently damaged explorers cannot harvest', () => {
  for(const change of [{alive:false},{connected:false},{realm:'arena'},{x:0,z:0,y:0},{hurtTime:.5}]){const {sim,p}=patch();Object.assign(p,change);assert(!sim.gather(p.id));assert.deepEqual(sim.world.supplies,[0,0,0]);}
  const {sim,p}=patch();sim.damageHistory.set(p.id,new Map([['attacker',sim.tick]]));assert(!sim.gather(p.id));sim.tick+=300;assert(sim.gather(p.id));
});
test('rune cover blocks supply gathering through it', () => {
  const {sim,p,node}=patch(), x=Math.floor((p.x+node.x)/2),z=Math.floor((p.z+node.z)/2),bottom=Math.floor(Math.min(p.y,node.y));
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(let y=bottom;y<bottom+4;y++)sim.world.construction!.place({x:x+dx,y,z:z+dz,kind:0,owner:'cover'});
  assert(!sim.gather(p.id));assert.equal(sim.world.forage!.size,0);
});
test('waystone crafting validates location, stock, identity-bound effect and duplicate world upgrades', () => {
  const {sim,p,guest}=explorers();sim.world.supplies=[100,100,100];const stock=[...sim.world.supplies];
  assert(!sim.craft(guest.id,'sail'));assert(!sim.craft(p.id,{recipe:'sail',supplies:[999,999,999]}));assert.deepEqual(sim.world.supplies,stock);
  const pos={x:p.x,z:p.z};p.x=50;assert(!sim.craft(p.id,'sail'));Object.assign(p,pos);
  assert(sim.craft(p.id,'sail'));assert.equal(sim.world.upgrades,SKY_SAIL);assert.deepEqual(sim.world.supplies,[88,92,96]);
  Object.assign(guest,{realm:'wilds',x:0,z:-5,y:0});assert(!sim.craft(guest.id,'sail'));assert.deepEqual(sim.world.supplies,[88,92,96]);
  sim.tick+=60;assert(sim.craft(p.id,'hearth'));assert.equal(sim.world.upgrades,SKY_SAIL|HEARTHSTONE);assert.deepEqual(sim.world.supplies,[80,80,88]);
});
test('arrow crafting caps the quiver, charges once and cannot refill a full quiver', () => {
  const {sim,p,guest}=explorers();sim.world.supplies=[20,20,20];p.ammo=35;assert(sim.craft(p.id,'arrows'));assert.equal(p.ammo,40);assert.equal(guest.ammo,20);assert.deepEqual(sim.world.supplies,[17,18,20]);
  sim.tick+=60;assert(!sim.craft(p.id,'arrows'));assert.deepEqual(sim.world.supplies,[17,18,20]);p.ammo=0;sim.world.supplies=[2,2,0];assert(!sim.craft(p.id,'arrows'));assert.equal(p.ammo,0);
});
test('crafting is unavailable while dead, disconnected, in a lobby or resting after damage', () => {
  for(const change of [{alive:false},{connected:false},{hurtTime:.5}]){const {sim,p}=explorers();sim.world.supplies=[100,100,100];Object.assign(p,change);assert(!sim.craft(p.id,'sail'));}
  const {sim,p}=explorers();sim.world.supplies=[100,100,100];sim.phase='waiting';assert(!sim.craft(p.id,'sail'));sim.phase='active';sim.damageHistory.set(p.id,new Map([['enemy',0]]));assert(!sim.craft(p.id,'sail'));sim.tick=300;assert(sim.craft(p.id,'sail'));
  assert.equal(craftReason(p,sim.world,RECIPES[0]),'Ready for your whole party');
});
test('Hearthstone is locked until crafted and then shares ordinary construction collision', () => {
  const {sim,p}=patch();p.weaving=true;p.weaveKind=6;p.pitch=-.7;
  let target=weaveTarget(p,sim.world);for(let n=0;n<32&&!target?.valid;n++){p.yaw=n*Math.PI/16;target=weaveTarget(p,sim.world);}assert(target?.valid);
  assert(!sim.weave(p,false));sim.tick+=15;sim.world.upgrades=HEARTHSTONE;assert(sim.weave(p,false));assert.equal(sim.world.construction!.get(target.x,target.y,target.z)!.kind,6);
});
test('Hearthstone warmth heals living nearby explorers, caps health and cannot revive or cross cover', () => {
  const {sim,p,node}=patch();sim.world.upgrades=HEARTHSTONE;const x=Math.floor(node.x),z=Math.floor(node.z),y=Math.ceil(terrainHeight(x+.5,z+.5,sim.world.seed));sim.world.construction!.place({x,y,z,kind:6,owner:'host'});
  Object.assign(p,{x:x+.5,z:z+.5,y:y+1,hp:98});assert(hearthNear(p,sim.world));sim.tick=59;sim.step();assert.equal(p.hp,100);
  p.hp=50;sim.damageHistory.set(p.id,new Map([['enemy',sim.tick]]));sim.tick=119;sim.step();assert.equal(p.hp,50);sim.damageHistory.clear();p.alive=false;sim.tick=179;sim.step();assert.equal(p.hp,50);
  p.alive=true;p.x=x+2.5;p.y=terrainHeight(p.x,p.z,sim.world.seed);assert(hearthNear(p,sim.world));for(let n=0;n<4;n++)sim.world.construction!.place({x:x+1,y:y+n,z,kind:0,owner:'host'});assert(!hearthNear(p,sim.world));
});
test('Sky sail launches an ordinary hop and prediction agrees with authoritative glide physics', () => {
  const {sim,p}=explorers();sim.world.upgrades=SKY_SAIL;const predicted={...p};let peak=p.y;
  for(let n=1;n<=50;n++){const i={...idleInput(),seq:n,glide:n===1};sim.input(p.id,i);sim.step();move(predicted,i,DT,false,sim.world);assert(Math.abs(predicted.x-p.x)<1e-8&&Math.abs(predicted.z-p.z)<1e-8&&Math.abs(predicted.y-p.y)<1e-8);peak=Math.max(peak,p.y);}
  assert(peak<JUMP_HEIGHT+.01);assert(p.z<-9);assert((p.glideCooldown??0)>0);assert(sim.events.some(e=>e.type==='glide'));
});
test('Sky sail is realm/upgrade gated, cannot be auto-repeated, and obeys normal collision', () => {
  const {sim,p}=explorers();move(p,{...idleInput(),glide:true},DT,false,sim.world);assert.equal(p.glideTime,0);assert.equal(p.y,0);p.glideHeld=false;sim.world.upgrades=SKY_SAIL;p.realm='arena';move(p,{...idleInput(),glide:true},DT,false,sim.world);assert.equal(p.glideTime,0);
  Object.assign(p,{realm:'wilds',x:0,z:-5,y:40,grounded:false,vy:0,glideHeld:false});for(let n=0;n<800;n++)move(p,{...idleInput(),glide:true},DT,false,sim.world);assert.equal(p.glideTime,0);assert.equal(p.glideHeld,true);
  Object.assign(p,{x:40.5,z:40.5,y:20,vy:0,grounded:false,glideHeld:false,glideCooldown:0});for(let n=0;n<4;n++)sim.world.construction!.place({x:40,y:20+n,z:39,kind:0,owner:'wall'});move(p,{...idleInput(),glide:true},DT,false,sim.world);for(let n=0;n<15;n++)move(p,idleInput(),DT,false,sim.world);assert(p.z>=40.34-1e-5);
});
test('flight descent and duration stay bounded and folding does not reset its cooldown', () => {
  const {sim,p}=explorers();sim.world.upgrades=SKY_SAIL;Object.assign(p,{y:100,vy:-30,grounded:false});move(p,{...idleInput(),glide:true},DT,false,sim.world);assert(p.vy>=-SAIL.fall);const cooldown=p.glideCooldown!;move(p,idleInput(),DT,false,sim.world);move(p,{...idleInput(),glide:true},DT,false,sim.world);assert.equal(p.glideTime,0);assert(p.glideCooldown!<cooldown&&p.glideCooldown!>11);
  Object.assign(p,{glideHeld:false,glideCooldown:0,y:100,vy:0,grounded:false});for(let n=0;n<605;n++)move(p,{...idleInput(),glide:n===0},DT,false,sim.world);assert.equal(p.glideTime,0);assert(p.y<100&&p.y>75);
});
test('damage and realm travel fold sails while rematches retain world supplies and upgrades', () => {
  const {sim,p,guest}=explorers();sim.mode='ffa';Object.assign(guest,{realm:'wilds',x:1,z:-5,y:0});sim.world.upgrades=3;sim.world.supplies=[12,24,8];p.glideTime=5;assert(sim.damage(p,guest,5));assert.equal(p.glideTime,0);assert((p.glideCooldown??0)>=5);assert((p.craftReadyAt??0)>=300);
  Object.assign(p,{x:0,z:10,y:0,glideTime:5});assert(sim.travel(p));assert.equal(p.glideTime,0);
  sim.phase='waiting';p.ready=guest.ready=true;assert(sim.start(p.id));assert.deepEqual(sim.world.supplies,[12,24,8]);assert.equal(sim.world.upgrades,3);assert.equal(p.glideTime,0);assert.equal(p.glideCooldown,0);
});
test('new saves preserve the pantry/upgrades, legacy saves load, and malformed progress is rejected', () => {
  const {sim}=explorers();sim.world.supplies=[21,30,7];sim.world.upgrades=3;const saved=saveWorld(sim.world,'Wings and warmth');assert.equal(saved.version,2);const restored=restoreWorld(saved)!;assert.deepEqual(restored.supplies,[21,30,7]);assert.equal(restored.upgrades,3);assert.deepEqual(saveWorld(restored,saved.title),saved);
  const legacy={...saved,version:1 as const};delete legacy.supplies;delete legacy.upgrades;const old=restoreWorld(legacy)!;assert(old);assert.deepEqual(old.supplies,[0,0,0]);assert.equal(old.upgrades,0);
  for(const patch of [{supplies:[9999,0,0]},{supplies:[0,-1,0]},{supplies:[0,0]},{supplies:undefined},{upgrades:4},{upgrades:.5},{upgrades:undefined}])assert.equal(parseWorldSave(JSON.stringify({...saved,...patch})),undefined);
  const {blocks,...header}=saved, upload=new WorldImport();assert(upload.begin(header,0,0));assert.deepEqual(upload.finish(1),saved);
});
