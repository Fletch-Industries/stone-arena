import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { CREATURES, WILDLIFE, WARDEN, creatureNests, creatureCacheSize, guardianNests, creatureClear, creatureTouch, creatureView, bondCount, guardianCount } from '../shared/creatures.js';
import { biomeAt } from '../shared/biomes.js';
import { APPLE, DT, EYE, idleInput, type Player } from '../shared/game.js';
import { terrainHeight, worldBoxes } from '../shared/world.js';
import { suppliesNear } from '../shared/forage.js';
import { restoreWorld, saveWorld } from '../shared/world-save.js';
import { WorldImport } from '../server/world-import.js';
import { creatureHUD } from '../client/creature-hud.js';
import { ConstellationAtlas } from '../client/atlas.js';
import type { Creature } from '../server/ecosystem.js';

function fixture(guardian=false) {
  const sim=new Simulation(7919),p=sim.add('host','Explorer'),guest=sim.add('guest','Friend');sim.mode='expedition';sim.phase='active';
  const nest=guardian?guardianNests(sim.world.seed)[0]:creatureNests(0,-1,sim.world.seed)[0];assert(nest);
  Object.assign(p,{realm:'wilds',x:nest.x,z:nest.z,y:nest.y});sim.step();
  const c=sim.ecosystem.creatures.get(nest.id)??sim.ecosystem.spawn(nest,sim.world)!;assert(c);aim(sim,p,c);
  return {sim,p,guest,c};
}
function aim(sim:Simulation,p:Player,c:Creature) {
  for(let n=0;n<16;n++){
    const a=n*Math.PI/8,x=c.x+Math.sin(a)*2.8,z=c.z+Math.cos(a)*2.8,y=terrainHeight(x,z,sim.world.seed);
    if(!creatureClear(x,z,sim.world,false))continue;
    Object.assign(p,{realm:'wilds',x,z,y,vy:0,vx:0,vz:0,grounded:true,yaw:Math.atan2(x-c.x,z-c.z),pitch:Math.atan2(c.y+(c.kind===4?1:.8)-y-EYE,2.8)});
    if(creatureTouch(p,sim.ecosystem.creatures.values(),sim.world)?.id===c.id)return;
  }
  throw Error('No clear approach to creature');
}
function ticks(sim:Simulation,n:number){for(let i=0;i<n;i++)sim.step();}
function until(sim:Simulation,check:()=>boolean,max=300){for(let n=0;!check();n++){assert(n<max,'Encounter state timed out');sim.step();}}
function shield(sim:Simulation,p:Player,c:Creature){p.block=true;p.shieldRaise=.25;p.offhand='shield';p.yaw=Math.atan2(p.x-c.x,p.z-c.z);return sim.worldStrike(p,c,WARDEN.damage);}

test('seeded habitats have four original species, clear nests, eight guardians and a bounded cache',()=>{
  const found=new Set<number>();
  for(const seed of [0,1,7919,4294967295]){
    assert.equal(guardianNests(seed).length,8);
    for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)for(const n of creatureNests(x,z,seed)){
      assert(n.kind!==4);found.add(n.kind);assert.equal(CREATURES[n.kind].biome,biomeAt(n.x,n.z,seed));assert(creatureClear(n.x,n.z,{seed,doorOpen:true}));
    }
  }
  assert.equal(found.size,4);assert.deepEqual(creatureNests(0,-1,7919),creatureNests(0,-1,7919));
  for(let x=-12;x<12;x++)for(let z=-12;z<12;z++)creatureNests(x,z,42);
  assert(creatureCacheSize()<=WILDLIFE.cacheLimit);assert.deepEqual(creatureNests(65,0,1),[]);
});
test('five explorers share a 32-actor interest pool with compact finite poses and no client ownership of positions',()=>{
  const sim=new Simulation(7919);sim.phase='active';sim.mode='expedition';
  sim.phase='waiting';for(let n=0;n<5;n++)sim.add(`p${n}`,`Friend ${n}`);sim.phase='active';
  [...sim.players.values()].forEach((p,n)=>Object.assign(p,{realm:'wilds',x:n*90,z:-n*70,y:terrainHeight(n*90,-n*70,sim.world.seed)}));
  ticks(sim,60);assert.equal(sim.ecosystem.creatures.size,WILDLIFE.limit);const wire=sim.snapshot().creatures!;
  assert(Buffer.byteLength(JSON.stringify(wire))<5500);assert(wire.every(w=>w.slice(2,9).every(Number.isFinite)));assert(wire.map(creatureView).every(c=>c.owner===''));
  for(const p of sim.players.values())p.realm='arena';ticks(sim,60);assert.equal(sim.ecosystem.creatures.size,0);
});
test('a shared favorite supply buys one personal companion atomically, and another player cannot steal it',()=>{
  const {sim,p,guest,c}=fixture();assert(c.kind!==4);const food=CREATURES[c.kind].food;sim.world.supplies![food]=1;assert(sim.creature(p.id));assert.equal(sim.world.supplies![food],0);assert.equal(c.owner,p.id);assert.equal(sim.world.bonds,1<<c.kind);
  Object.assign(guest,{...p,id:guest.id,name:guest.name});guest.friendReadyAt=0;assert(!sim.creature(guest.id));assert.equal(c.owner,p.id);assert.equal(guest.xp,0);assert.equal(guest.kills,0);
  const next=creatureNests(1,-1,sim.world.seed)[0],other=sim.ecosystem.creatures.get(next.id)??sim.ecosystem.spawn(next,sim.world)!;assert(other&&other.kind!==4);aim(sim,p,other);sim.tick+=39;sim.world.supplies![CREATURES[other.kind].food]=1;assert(sim.creature(p.id));assert.equal(c.owner,'');assert.equal(other.owner,p.id);assert.equal([...sim.ecosystem.creatures.values()].filter(c=>c.owner===p.id).length,1);
});
test('creature interaction rejects forged actions, bad reach, lobbies, dead and disconnected players, and recent damage',()=>{
  for(const patch of [{alive:false},{connected:false},{realm:'arena'},{x:0,z:-5,y:0},{hurtTime:.5},{block:true},{charge:1}]){const {sim,p,c}=fixture();sim.world.supplies=[9,9,9];Object.assign(p,patch);assert(!sim.creature(p.id));assert.equal(c.owner,'');assert.deepEqual(sim.world.supplies,[9,9,9]);}
  const {sim,p,c}=fixture();sim.world.supplies=[9,9,9];assert(!sim.creature(p.id,{owner:p.id,stock:999}));assert(!sim.creature('unknown'));sim.phase='waiting';assert(!sim.creature(p.id));sim.phase='active';p.yaw+=Math.PI;assert(!sim.creature(p.id));aim(sim,p,c);sim.damageHistory.set(p.id,new Map([['wild:warden:1',sim.tick]]));assert(!sim.creature(p.id));sim.tick+=300;assert(sim.creature(p.id));
});
test('rune cover prevents befriending through a wall',()=>{
  const {sim,p,c}=fixture();sim.world.supplies=[5,5,5];const x=Math.floor((p.x+c.x)/2),z=Math.floor((p.z+c.z)/2),y=Math.floor(Math.min(p.y,c.y));
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(let n=0;n<4;n++)sim.world.construction!.place({x:x+dx,y:y+n,z:z+dz,kind:0,owner:'cover'});
  assert(!sim.creature(p.id));assert.equal(c.owner,'');assert.deepEqual(sim.world.supplies,[5,5,5]);
});
test('a companion scouts an available favorite patch without spending stock, rejects cooldown and releases only its owner',()=>{
  const {sim,p,guest,c}=fixture();assert(c.kind!==4);sim.world.supplies=[10,10,10];assert(sim.creature(p.id));sim.tick+=39;const before=[...sim.world.supplies!];assert(sim.creature(p.id));assert.equal(c.state,'scout');assert.deepEqual(sim.world.supplies,before);
  const event=[...sim.events].reverse().find(e=>e.type==='creature_scout')!;assert(event.position);assert.equal(event.target,c.id);assert(suppliesNear(p.x,p.z,sim.world.seed,72).some(n=>n.kind===CREATURES[c.kind as 0|1|2|3].food&&n.x===event.position!.x&&n.z===event.position!.z));
  sim.tick+=39;assert(!sim.creature(p.id));Object.assign(guest,{realm:'wilds'});assert(!sim.creature(guest.id,'release'));assert(sim.creature(p.id,'release'));assert.equal(c.owner,'');assert.equal(bondCount(sim.world.bonds),1);
});
test('companions follow with normal terrain collision, stop across realms and safely catch up after long travel',()=>{
  const {sim,p,c}=fixture();sim.world.supplies=[5,5,5];assert(sim.creature(p.id));const before={x:c.x,z:c.z};p.x+=8;
  ticks(sim,120);assert(Math.hypot(c.x-before.x,c.z-before.z)>1);assert(Math.hypot(c.x-p.x,c.z-p.z)<8);assert(c.y>=terrainHeight(c.x,c.z,sim.world.seed)-.01);
  p.realm='arena';const stopped={x:c.x,z:c.z};ticks(sim,60);assert(Math.hypot(c.x-stopped.x,c.z-stopped.z)<.1);p.realm='wilds';p.x+=60;p.y=terrainHeight(p.x,p.z,sim.world.seed);ticks(sim,3);assert(Math.hypot(c.x-p.x,c.z-p.z)<4);assert.equal(c.owner,p.id);
  assert(!worldBoxes(c.x,c.z,c.x,c.z,'wilds',sim.world).some(b=>Math.abs(c.x-b.x)<b.w/2+.33&&Math.abs(c.z-b.z)<b.d/2+.33&&c.y<(b.y??0)+b.h&&c.y+1.8>(b.y??0)));
});
test('guardians remain peaceful until challenged and lock their pulse before players dodge it',()=>{
  const {sim,p,c}=fixture(true);ticks(sim,180);assert.equal(c.state,'dormant');assert.equal(p.hp,100);aim(sim,p,c);assert(sim.creature(p.id));until(sim,()=>c.state==='windup');const locked={x:c.aimX,z:c.aimZ};ticks(sim,45);assert.equal(p.hp,100);assert.deepEqual({x:c.aimX,z:c.aimZ},locked);
  p.x+=10;p.y=terrainHeight(p.x,p.z,sim.world.seed);until(sim,()=>c.state==='recover',30);assert.equal(p.hp,100);assert(sim.events.some(e=>e.type==='creature_pulse'&&e.realm==='wilds'));
});
test('guardian pulses respect shields, armor, totems, realm separation and protection without awarding PvP stats',()=>{
  {const {sim,p,c}=fixture(true);assert(!shield(sim,p,c));assert.equal(p.hp,100);p.yaw+=Math.PI;assert(sim.worldStrike(p,c,24));assert.equal(p.hp,76);}
  {const {sim,p,c}=fixture(true);p.xp=150;assert(sim.worldStrike(p,c,24));assert.equal(p.hp,100-24*.65);assert.equal(p.kills,0);assert.equal(p.damage,0);assert.equal(p.xp,150);}
  {const {sim,p,c}=fixture(true);p.hp=25;p.offhand='totem';assert(sim.worldStrike(p,c,24));assert.equal(p.hp,20);assert.equal(p.totems,0);assert(p.alive);}
  {const {sim,p,c}=fixture(true);p.immuneUntil=sim.tick+120;assert(!sim.worldStrike(p,c,24));p.immuneUntil=0;p.realm='arena';assert(!sim.worldStrike(p,c,24));assert.equal(p.hp,100);}
});
test('a telegraphed pulse cannot damage through solid rune cover or hit a distant bystander',()=>{
  const {sim,p,guest,c}=fixture(true);Object.assign(guest,{realm:'wilds',x:p.x+15,z:p.z,y:p.y});c.state='windup';c.challengers.add(p.id);c.aimX=p.x;c.aimZ=p.z;c.timer=.01;sim.tick=2;
  const x=Math.floor((p.x+c.x)/2),z=Math.floor((p.z+c.z)/2),y=Math.floor(Math.min(p.y,c.y));for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(let n=0;n<4;n++)sim.world.construction!.place({x:x+dx,y:y+n,z:z+dz,kind:0,owner:'cover'});
  sim.step();assert.equal(p.hp,100);assert.equal(guest.hp,100);assert.equal(c.state,'recover');
});
test('melee frees a guardian once, earns bounded XP and pantry rewards, and cannot hurt friendly creatures',()=>{
  const {sim,p,c}=fixture(true);sim.world.supplies=[998,998,998];
  for(let n=0;n<4;n++){aim(sim,p,c);p.weapon='sword';p.cooldown=0;sim.melee(p);}
  assert.equal(c.hp,0);assert.equal(c.state,'cleared');assert.equal(sim.world.guardians,1<<c.ruin);assert.equal(guardianCount(sim.world.guardians),1);assert.deepEqual(sim.world.supplies,[999,999,999]);assert.equal(p.damage,120);assert.equal(p.xp,145);assert.equal(p.kills,0);
  sim.melee(p);assert.equal(p.xp,145);assert.equal(sim.events.filter(e=>e.type==='creature_clear').length,1);
  const friendly=fixture();aim(friendly.sim,friendly.p,friendly.c);friendly.sim.melee(friendly.p);assert.equal(friendly.c.hp,100);assert.equal(friendly.p.damage,0);
});
test('melee and swept arrows choose the nearest player, guardian or cover with no cross-realm hits',()=>{
  {const {sim,p,guest,c}=fixture(true);sim.mode='ffa';Object.assign(guest,{realm:'wilds',x:(p.x+c.x)/2,z:(p.z+c.z)/2,y:p.y});sim.melee(p);assert(guest.hp<100);assert.equal(c.hp,120);}
  {const {sim,p,c}=fixture(true);const dx=c.x-p.x,dz=c.z-p.z;sim.arrows.push({id:1,owner:p.id,realm:'wilds',x:p.x,y:c.y+1,z:p.z,vx:dx*60,vy:0,vz:dz*60,damage:30,age:0});sim.step();assert(c.hp<120);assert.equal(sim.arrows.length,0);assert(p.xp>0);}
  {const {sim,p,c}=fixture(true);p.realm='arena';sim.melee(p);assert.equal(c.hp,120);}
});
test('co-op guardian elimination cancels same-tick eating and respawns with discoveries intact',()=>{
  const {sim,p,c}=fixture(true);p.hp=10;p.weapon='apple';p.charge=APPLE.seconds-DT;p.relics=7;p.xp=50;sim.world.bonds=15;sim.world.guardians=2;sim.world.supplies=[3,4,5];
  // Use a different guardian so this world has one freed ruin and one active encounter.
  c.ruin=2;c.state='windup';c.timer=.01;c.challengers.add(p.id);c.aimX=p.x;c.aimZ=p.z;sim.tick=2;
  sim.input(p.id,{...idleInput(),seq:1,yaw:p.yaw,weapon:'apple',attack:true});sim.step();assert(!p.alive);assert.equal(p.hp,0);assert.equal(p.apples,2);assert.equal(p.respawnAt,303);assert.equal(sim.phase,'active');
  ticks(sim,300);assert(p.alive);assert.equal(p.realm,'wilds');assert.equal(p.x,0);assert.equal(p.z,-5);assert.equal(p.hp,100);assert.equal(p.relics,7);assert.equal(p.xp,50);assert.equal(p.totems,1);assert.equal(sim.world.bonds,15);assert.equal(sim.world.guardians,2);assert.deepEqual(sim.world.supplies,[3,4,5]);assert(p.immuneUntil>sim.tick);
});
test('competitive Wilds deaths retain the existing one-life rule',()=>{
  const {sim,p,c}=fixture(true);sim.mode='ffa';p.hp=10;sim.worldStrike(p,c,24);assert(!p.alive);assert.equal(p.respawnAt,0);assert(![...sim.events].reverse().find(e=>e.type==='kill')!.text!.includes('Return'));ticks(sim,300);assert(!p.alive);
});
test('lost challenges reset after five seconds and freed guardians remain peaceful after a rematch',()=>{
  const {sim,p,guest,c}=fixture(true);assert(sim.creature(p.id));p.realm='arena';ticks(sim,330);assert(c.state==='dormant'||!sim.ecosystem.creatures.has(c.id));
  sim.world.guardians=1<<c.ruin;sim.world.bonds=15;sim.phase='waiting';p.ready=guest.ready=true;assert(sim.start(p.id));assert.equal(sim.ecosystem.creatures.size,0);assert.equal(sim.world.bonds,15);assert.equal(sim.world.guardians,1<<c.ruin);const freed=sim.ecosystem.spawn({...c,ruin:c.ruin},sim.world)!;assert(freed);assert.equal(freed.state,'cleared');assert.equal(freed.hp,0);
});
test('version-four worlds preserve discoveries, accept legacy one/two, and reject malformed or missing masks',()=>{
  const {sim}=fixture();sim.world.bonds=15;sim.world.guardians=510;const save=saveWorld(sim.world);assert.equal(save.version,4);assert.equal(restoreWorld(save)!.bonds,15);assert.equal(restoreWorld(save)!.guardians,510);
  const {blocks,...header}=save,upload=new WorldImport();assert(upload.begin(header,0,0));assert.deepEqual(upload.finish(1),save);
  for(const patch of [{bonds:-1},{bonds:16},{bonds:1.5},{bonds:undefined},{guardians:1},{guardians:512},{guardians:.5},{guardians:undefined}])assert.equal(restoreWorld({...save,...patch}),undefined);
  for(const version of [1,2]as const){const legacy={...save,version};delete legacy.bonds;delete legacy.guardians;const old=restoreWorld(legacy)!;assert(old);assert.equal(old.bonds,0);assert.equal(old.guardians,0);assert.deepEqual(old.supplies,save.supplies);}
  sim.phase='waiting';assert(sim.restore(sim.host,save));assert.equal(sim.ecosystem.creatures.size,0);assert.equal(sim.world.guardians,510);assert([...sim.players.values()].every(p=>!p.ready));
});
test('touch prompts and the field guide expose ownership, progress, tracking and optional challenges',()=>{
  const {sim,p,c}=fixture();let hud=creatureHUD(p,sim.snapshot(),true);assert(hud.prompt.includes('Offer 1'));assert(hud.prompt.includes('disabled'));sim.world.supplies=[3,3,3];assert(sim.creature(p.id));hud=creatureHUD(p,sim.snapshot(),true);assert(hud.prompt.includes('Your companion'));assert(hud.prompt.includes('Scout ready in'));sim.tick+=39;assert(creatureHUD(p,sim.snapshot(),true).prompt.includes('Scout for supplies'));
  const atlas=new ConstellationAtlas();atlas.page='guide';const html=atlas.render(p,sim.snapshot());assert(html.includes('1/4 grove friends'));assert(html.includes('Let it wander'));assert(html.includes('track-creature-food'));assert(html.includes('Optional')||html.includes('Challenge one when you are ready'));assert(html.includes('role="tab"'));
  const warden=fixture(true);assert(creatureHUD(warden.p,warden.sim.snapshot(),true).prompt.includes('Challenge Warden'));warden.c.state='windup';assert(creatureHUD(warden.p,warden.sim.snapshot(),true).status.includes('Pulse incoming'));
});
