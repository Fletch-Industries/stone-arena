import { CREATURES, WILDLIFE, WARDEN, creatureClear, creatureNests, guardianNests, creatureTouch, creatureWire, guardianCount, type CreatureNest, type CreatureView, type CreatureState } from '../shared/creatures.js';
import { FORAGE, suppliesNear, SUPPLIES } from '../shared/forage.js';
import { DT, WALK_SPEED, idleInput, move, knockback, wallHit, type Body, type GameEvent, type Player } from '../shared/game.js';
import { hash, terrainHeight, worldBoxes, type WorldState } from '../shared/world.js';

export interface Creature extends CreatureView, Body {
  realm: 'wilds'; homeX: number; homeZ: number; ruin: number;
  goalX: number; goalZ: number; steerYaw: number; steerAt: number;
  scoutReadyAt: number; wanderAt: number; challengers: Set<string>; lost: number;
}
export interface EcosystemHooks {
  event(e: Omit<GameEvent,'id'>): void;
  hurt(player: Player, creature: Creature, amount: number): void;
  reward(player: Player, amount: number, damage?: boolean): void;
}
const distance = (a:{x:number;z:number},b:{x:number;z:number}) => Math.hypot(a.x-b.x,a.z-b.z);

/** Seeded, interest-scoped life. No actors exist beyond the fixed per-room pool. */
export class Ecosystem {
  creatures = new Map<string, Creature>();
  private seed = -1; private guardians:CreatureNest[]=[];
  clear() { this.creatures.clear(); this.seed=-1; this.guardians=[]; }
  wire() { return [...this.creatures.values()].map(creatureWire); }
  spawn(n:CreatureNest,world:WorldState) {
    if(this.creatures.size>=WILDLIFE.limit||this.creatures.has(n.id)||!creatureClear(n.x,n.z,world))return;
    const cleared=n.kind===4&&!!((world.guardians??0)&1<<n.ruin);
    const c:Creature={...n,y:terrainHeight(n.x,n.z,world.seed),realm:'wilds',homeX:n.x,homeZ:n.z,yaw:hash(Math.floor(n.x),Math.floor(n.z),world.seed)*6,
      hp:n.kind===4?(cleared?0:WARDEN.health):100,state:n.kind===4?(cleared?'cleared':'dormant'):'idle',timer:0,owner:'',aimX:n.x,aimZ:n.z,
      goalX:n.x,goalZ:n.z,steerYaw:0,steerAt:0,scoutReadyAt:0,wanderAt:0,challengers:new Set(),lost:0,vy:0,grounded:true};
    this.creatures.set(n.id,c);return c;
  }
  private maintain(players:Player[],world:WorldState) {
    if(world.seed!==this.seed){this.clear();this.seed=world.seed;this.guardians=guardianNests(world.seed);}
    const explorers=players.filter(p=>p.alive&&p.connected&&p.realm==='wilds');
    for(const [id,c]of this.creatures){const owner=players.find(p=>p.id===c.owner);
      if(c.owner&&!owner){c.owner='';c.state='idle';}
      if(!c.owner&&!explorers.some(p=>distance(p,c)<WILDLIFE.retireRadius))this.creatures.delete(id);}
    const wanted=new Map<string,CreatureNest>();
    for(const p of explorers)for(let cx=Math.floor((p.x-WILDLIFE.radius)/WILDLIFE.region);cx<=Math.floor((p.x+WILDLIFE.radius)/WILDLIFE.region);cx++)for(let cz=Math.floor((p.z-WILDLIFE.radius)/WILDLIFE.region);cz<=Math.floor((p.z+WILDLIFE.radius)/WILDLIFE.region);cz++)
      for(const n of creatureNests(cx,cz,world.seed))if(distance(p,n)<WILDLIFE.radius)wanted.set(n.id,n);
    for(const n of this.guardians)if(explorers.some(p=>distance(p,n)<WILDLIFE.radius))wanted.set(n.id,n);
    const near=(n:CreatureNest)=>Math.min(...explorers.map(p=>distance(p,n)));
    // Make space for a new nearby grove, while retaining each player's companion.
    const ordered=[...wanted.values()].sort((a,b)=>near(a)-near(b));
    for(const n of ordered){if(this.creatures.has(n.id))continue;
      if(this.creatures.size===WILDLIFE.limit){const far=[...this.creatures.values()].filter(c=>!c.owner&&c.state!=='windup'&&c.state!=='chase').sort((a,b)=>near(b)-near(a))[0];if(!far||near(far)<=near(n)+8)continue;this.creatures.delete(far.id);}
      this.spawn(n,world);}
  }
  private awake(c:Creature,p:Player) { if(c.kind!==4||c.hp<=0||c.state==='cleared')return; c.challengers.add(p.id);c.lost=0;if(c.state==='dormant'){c.state='chase';c.timer=.5;} }
  interact(p:Player,world:WorldState,tick:number,hooks:EcosystemHooks,action?:unknown) {
    if(action!==undefined&&action!=='release')return false;
    if(action==='release'){const c=[...this.creatures.values()].find(c=>c.owner===p.id);if(!c)return false;c.owner='';c.state='idle';c.timer=1;hooks.event({type:'creature_bond',actor:p.id,realm:'wilds',text:`${CREATURES[c.kind as 0|1|2|3].name} is free to wander`,position:{x:c.x,y:c.y+1,z:c.z}});return true;}
    const selected=creatureTouch(p,this.creatures.values(),world);if(!selected)return false;const c=this.creatures.get(selected.id)!;
    if(c.kind===4){if(c.state!=='dormant')return false;this.awake(c,p);hooks.event({type:'creature_challenge',actor:p.id,realm:'wilds',text:'Shade Warden awakened · Dodge violet pulses or face it with your shield',position:{x:c.x,y:c.y+1,z:c.z}});return true;}
    const species=CREATURES[c.kind];
    if(c.owner===p.id){if(tick<c.scoutReadyAt)return false;
      const node=suppliesNear(p.x,p.z,world.seed,WILDLIFE.scoutRadius).filter(n=>n.kind===species.food&&world.forage?.available(n,tick)).sort((a,b)=>distance(p,a)-distance(p,b))[0];if(!node)return false;
      c.goalX=node.x;c.goalZ=node.z;c.state='scout';c.timer=10;c.scoutReadyAt=tick+WILDLIFE.scoutSeconds*60;
      hooks.event({type:'creature_scout',actor:p.id,target:c.id,realm:'wilds',text:`${species.name} is scouting for ${SUPPLIES[species.food].name}`,position:{x:node.x,y:node.y+.8,z:node.z}});return true;}
    if(c.owner||(world.supplies?.[species.food]??0)<1)return false;
    world.supplies![species.food]--;
    for(const old of this.creatures.values())if(old.owner===p.id){old.owner='';old.state='idle';old.timer=1;}
    c.owner=p.id;c.state='follow';c.timer=1;world.bonds=(world.bonds??0)|1<<c.kind;
    hooks.event({type:'creature_bond',actor:p.id,realm:'wilds',text:`${species.name} befriended · It follows you and can scout for supplies`,position:{x:c.x,y:c.y+1,z:c.z}});return true;
  }
  hurt(c:Creature,p:Player,amount:number,world:WorldState,hooks:EcosystemHooks,strength=8) {
    if(c.kind!==4||c.hp<=0||c.state==='cleared'||!Number.isFinite(amount)||amount<=0||p.realm!=='wilds')return false;
    this.awake(c,p);const damage=Math.min(c.hp,amount);c.hp-=damage;hooks.reward(p,damage,true);
    knockback(c,c.x-p.x,c.z-p.z,strength*.3);
    hooks.event({type:'creature_hit',actor:p.id,target:c.id,realm:'wilds',position:{x:c.x,y:c.y+1,z:c.z}});
    if(c.hp===0){c.state='cleared';c.timer=0;c.challengers.clear();c.vx=c.vz=c.vy=0;world.guardians=(world.guardians??0)|1<<c.ruin;
      [6,6,4].forEach((n,k)=>{world.supplies![k]=Math.min(FORAGE.stockLimit,world.supplies![k]+n);});hooks.reward(p,25);
      hooks.event({type:'creature_clear',actor:p.id,target:c.id,realm:'wilds',text:`Shade Warden freed · ${guardianCount(world.guardians)}/8 waystones protected · Party supplies found`,position:{x:c.x,y:c.y+1,z:c.z}});}
    return true;
  }
  private steer(c:Creature,world:WorldState,tick:number) {
    const dx=c.goalX-c.x,dz=c.goalZ-c.z;if(Math.hypot(dx,dz)<.4)return false;
    if(tick>=c.steerAt){c.steerAt=tick+6;const desired=Math.atan2(-dx,-dz);let best=Infinity,chosen:number|undefined;
      for(const offset of [0,.5,-.5,1,-1,1.6,-1.6,2.2,-2.2]){const yaw=desired+offset,x=c.x-Math.sin(yaw)*1.2,z=c.z-Math.cos(yaw)*1.2,y=terrainHeight(x,z,world.seed);
        if(y<.3||y-c.y>.6||Math.abs(x)>4090||Math.abs(z)>4090)continue;
        if(worldBoxes(Math.min(c.x,x)-.35,Math.min(c.z,z)-.35,Math.max(c.x,x)+.35,Math.max(c.z,z)+.35,'wilds',world).some(b=>Math.abs(x-b.x)<b.w/2+.35&&Math.abs(z-b.z)<b.d/2+.35&&y<(b.y??0)+b.h&&y+1.8>(b.y??0)))continue;
        const score=Math.hypot(c.goalX-x,c.goalZ-z)+Math.abs(offset)*.35;if(score<best){best=score;chosen=yaw;}}
      if(chosen===undefined){c.steerAt=0;return false;}c.steerYaw=chosen;
    }
    c.yaw=c.steerYaw;return true;
  }
  private blink(c:Creature,owner:Player,world:WorldState,hooks:EcosystemHooks) {
    for(let n=0;n<12;n++){const a=n*Math.PI/6,x=owner.x+Math.sin(a)*2.8,z=owner.z+Math.cos(a)*2.8;if(!creatureClear(x,z,world,false))continue;
      Object.assign(c,{x,y:terrainHeight(x,z,world.seed),z,vy:0,vx:0,vz:0,grounded:true,state:'follow',timer:1});
      hooks.event({type:'creature_blink',actor:owner.id,target:c.id,realm:'wilds',position:{x,y:c.y+.6,z}});return true;}return false;
  }
  step(players:Player[],world:WorldState,tick:number,hooks:EcosystemHooks) {
    if(this.seed!==world.seed||tick%60===0)this.maintain(players,world);
    if(tick%3!==0)return;const dt=DT*3,explorers=players.filter(p=>p.alive&&p.connected&&p.realm==='wilds');
    for(const c of this.creatures.values()){
      c.timer=Math.max(0,c.timer-dt);let moving=false,speed=1.5;
      if(c.kind===4){
        if((world.guardians??0)&1<<c.ruin){c.state='cleared';c.hp=0;}
        const target=explorers.filter(p=>c.challengers.has(p.id)&&distance(p,{x:c.homeX,z:c.homeZ})<WARDEN.leash).sort((a,b)=>distance(c,a)-distance(c,b))[0];
        if(c.state!=='dormant'&&c.state!=='cleared'){
          c.lost=target?0:c.lost+dt;
          if(c.lost>5){c.challengers.clear();c.hp=WARDEN.health;c.state='dormant';c.timer=0;}
          else if(c.state==='windup'&&c.timer===0){
            for(const p of explorers)if(distance(p,{x:c.aimX,z:c.aimZ})<WARDEN.pulseRadius&&Math.abs(p.y-c.y)<2.2&&wallHit({x:c.x,y:c.y+1,z:c.z},{x:p.x,y:p.y+1,z:p.z},'wilds',world)>=.99)hooks.hurt(p,c,WARDEN.damage);
            hooks.event({type:'creature_pulse',realm:'wilds',position:{x:c.aimX,y:terrainHeight(c.aimX,c.aimZ,world.seed)+.1,z:c.aimZ}});c.state='recover';c.timer=WARDEN.recover;
          }else if(c.state==='recover'&&c.timer===0){c.state='chase';}
          else if(c.state==='chase'&&target){c.goalX=target.x;c.goalZ=target.z;c.yaw=Math.atan2(c.x-target.x,c.z-target.z);speed=2.6;
            if(distance(c,target)<4&&Math.abs(c.y-target.y)<2.2&&c.timer===0&&wallHit({x:c.x,y:c.y+1,z:c.z},{x:target.x,y:target.y+1,z:target.z},'wilds',world)>=.99){c.state='windup';c.timer=WARDEN.windup;c.aimX=target.x;c.aimZ=target.z;}
            else moving=true;
          }
        }
        if(c.state==='dormant'&&distance(c,{x:c.homeX,z:c.homeZ})>1){c.goalX=c.homeX;c.goalZ=c.homeZ;moving=true;}
      }else if(c.owner){
        const owner=players.find(p=>p.id===c.owner);
        if(owner?.connected&&owner.alive&&owner.realm==='wilds'){
          if(distance(c,owner)>24&&this.blink(c,owner,world,hooks))continue;
          if(c.state==='scout'&&c.timer>0&&distance(c,owner)<14){moving=distance(c,{x:c.goalX,z:c.goalZ})>1.5;speed=2.5;}
          else{c.state='follow';c.goalX=owner.x;c.goalZ=owner.z;moving=distance(c,owner)>2.8;speed=distance(c,owner)>7?3.5:2.5;}
          if(!moving)c.yaw=Math.atan2(c.x-owner.x,c.z-owner.z);
        }else c.state='idle';
      }else{
        if(tick>=c.wanderAt){c.wanderAt=tick+180+Math.floor(hash(Math.floor(c.x),tick,world.seed)*180);const a=hash(tick,Math.floor(c.homeX),world.seed)*Math.PI*2;
          c.goalX=c.homeX+Math.sin(a)*6;c.goalZ=c.homeZ+Math.cos(a)*6;c.state='wander';}
        moving=distance(c,{x:c.goalX,z:c.goalZ})>.5;if(!moving)c.state='idle';
      }
      moving=moving&&this.steer(c,world,tick);
      const beforeX=c.x,beforeZ=c.z;move(c,{...idleInput(),yaw:c.yaw,z:moving?speed/WALK_SPEED:0},dt,false,world);
      if(moving&&Math.hypot(c.x-beforeX,c.z-beforeZ)<.015){c.steerAt=0;if(!c.owner&&c.kind!==4)c.wanderAt=tick+30;}
    }
  }
}
