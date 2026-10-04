import assert from 'node:assert/strict';
import { Client, type Room } from '@colyseus/sdk';
import { VERSION, EYE, idleInput, type Snapshot, type Input } from '../shared/game.js';
import { Excavation, SCULPT, type ExcavationState, type ExcavationChanges } from '../shared/excavation.js';
import { StoneReceiver, type StonePacket } from '../shared/excavation-sync.js';
import { Construction, type ConstructionState, type ConstructionChanges } from '../shared/construction.js';
import { sculptTarget } from '../shared/mining.js';
import { saveWorld, type WorldSave } from '../shared/world-save.js';
import { carvedCave } from './mining-fixture.js';
import { navigator, wildRoute, routeFollower } from './navigation.js';

const client = new Client(process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107'), rooms:Room[] = [], states = new Map<Room,Snapshot>(), terrain = new Map<Room,Excavation>(), seq = new Map<Room,number>(), errors:string[] = [], bytes:number[] = [];
let timer:ReturnType<typeof setInterval>|undefined;
const wait = (ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(label:string,check:()=>boolean,seconds=12){const end=Date.now()+seconds*1000;while(!check()){if(Date.now()>end)throw Error(`${label}: ${JSON.stringify([...states.values()].map(s=>({phase:s.phase,world:s.world.seed,revision:s.world.excavationRevision,players:s.players.map(p=>({x:p.x,y:p.y,z:p.z,realm:p.realm,song:p.sculptProgress}))})))} ${errors.slice(-4)}`);await wait(25);}}
function track(r:Room){rooms.push(r);r.reconnection.enabled=false;const receiver=new StoneReceiver(),blocks=new Construction();terrain.set(r,new Excavation());
  r.onMessage('excavation',(full:ExcavationState)=>{const cuts=new Excavation();assert(cuts.restore(full));terrain.set(r,cuts);receiver.clear();});
  r.onMessage('excavationChanges',(delta:ExcavationChanges)=>{if(receiver.active)assert(receiver.changes(delta));else assert(terrain.get(r)!.apply(delta));});
  r.onMessage('excavationStream',(packet:StonePacket)=>{bytes.push(Buffer.byteLength(JSON.stringify(packet)));const result=receiver.receive(packet,performance.now());assert.notEqual(result,false);if(result)terrain.set(r,result.excavation);});
  r.onMessage('construction',(s:ConstructionState)=>assert(blocks.restore(s)));r.onMessage('constructionChanges',(s:ConstructionChanges)=>assert(blocks.apply(s)));
  r.onMessage('forage',()=>{});r.onMessage('forageChanges',()=>{});r.onMessage('worldRestored',()=>{});r.onMessage('pong',()=>{});r.onMessage('latency',(n:number)=>r.send('latencyAck',n));r.onMessage('actionError',(error:string)=>errors.push(error));
  r.onMessage('snapshot',(s:Snapshot)=>{s.world.construction=blocks;s.world.excavation=terrain.get(r);states.set(r,s);});r.send('sync');return r;
}
const me=(r:Room)=>states.get(r)!.players.find(p=>p.id===r.sessionId)!;
function input(r:Room,changes:Partial<Input>&Record<string,unknown>={}){const next=(seq.get(r)??me(r).ack)+1;seq.set(r,next);r.send('input',{...idleInput(),seq:next,...changes});}
async function walk(r:Room,target:{x:number;z:number},stop=()=>Math.hypot(me(r).x-target.x,me(r).z-target.z)<.6,passage=false){const nav=navigator(),route=me(r).realm==='wilds'?wildRoute(me(r),target,states.get(r)!.world.seed):undefined;const follow=route?routeFollower(route,target,.7):undefined;
  timer=setInterval(()=>{if(stop()){input(r);return;}const p=me(r);const goal=follow?follow(p):passage||Math.hypot(p.x-target.x,p.z-target.z)<2.2?[target.x,target.z]:nav(p,target);input(r,{yaw:Math.atan2(p.x-goal[0],p.z-goal[1]),z:1,sprint:true});for(const other of rooms)if(other!==r&&other.connection.isOpen)other.send('ping',Date.now());},33);
  try{await until('ordinary navigation',stop,100);}finally{clearInterval(timer);timer=undefined;input(r);}
}
async function upload(r:Room,save:WorldSave){const {blocks,cuts=[],veins=[],...header}=save;r.send('worldRestore',{type:'begin',header,count:blocks.length,cutsCount:cuts.length,veinsCount:veins.length});for(const [kind,rows]of [['blocks',blocks],['cuts',cuts],['veins',veins]]as const)for(let offset=0;offset<rows.length;offset+=64){const message={type:'chunk',kind,offset,blocks:rows.slice(offset,offset+64)};assert(Buffer.byteLength(JSON.stringify(message))<4096);r.send('worldRestore',message);await wait(35);}r.send('worldRestore',{type:'commit'});}
async function sing(r:Room,aim:{yaw:number;pitch:number},mend:boolean,check:()=>boolean){timer=setInterval(()=>input(r,{...aim,sculpting:true,attack:!mend,block:mend,id:'forged-actor',cell:[1,-1,1],progress:100}),33);try{await until(mend?'mend':'mine',check,6);}finally{clearInterval(timer);timer=undefined;input(r,{...aim,sculpting:true});}}
try{
  const host=track(await client.create('arena',{name:'Stone singer',version:VERSION,private:true}));let guest=track(await client.joinById(host.roomId,{name:'Tunnel friend',version:VERSION}));await until('seats',()=>states.get(guest)?.players.length===2);
  await upload(host,saveWorld({seed:7919,doorOpen:false,waystones:1,supplies:[40,40,40],upgrades:0,bonds:0,guardians:0},'Stone song test'));
  await until('restore',()=>states.get(host)?.world.seed===7919);host.send('mode',{mode:'expedition'});await until('mode',()=>states.get(host)!.mode==='expedition');host.send('ready');guest.send('ready');await until('readiness',()=>states.get(host)!.players.every(p=>p.ready));host.send('start');await until('start',()=>states.get(host)!.phase==='active');
  await walk(host,{x:-26,z:-46});host.send('interact');await until('secret door',()=>states.get(host)!.world.doorOpen);await walk(host,{x:-26,z:-65},()=>me(host).realm==='wilds',true);
  await walk(host,{x:0,z:-5});host.send('craft',{recipe:'chisel'});await until('craft',()=>[host,guest].every(r=>states.get(r)!.world.upgrades===4));assert.deepEqual(states.get(host)!.world.supplies,[32,24,36]);
  await walk(host,{x:44.5,z:-60.5});await wait(200);let aim:{yaw:number;pitch:number}|undefined;
  for(let n=0;n<64;n++){const test={yaw:n*Math.PI/32,pitch:-.6},target=sculptTarget({...me(host),...test},states.get(host)!.world);if(target?.valid&&target.stratum.vein===undefined&&Math.hypot(target.x+.5-me(host).x,target.z+.5-me(host).z)>1.5){aim=test;break;}}
  assert(aim,'clear native ground');const target=sculptTarget({...me(host),...aim},states.get(host)!.world)!;
  await sing(host,aim,false,()=>[host,guest].every(r=>terrain.get(r)!.has(target.x,target.y,target.z)));assert.equal(terrain.get(guest)!.get(target.x,target.y,target.z)!.owner,host.sessionId);assert.equal(me(host).kills,0);assert.deepEqual(states.get(host)!.world.supplies,[32,24,36]);
  assert(sculptTarget({...me(host),...aim},states.get(host)!.world,true,states.get(host)!.players,true)?.valid);
  await sing(host,aim,true,()=>[host,guest].every(r=>!terrain.get(r)!.has(target.x,target.y,target.z)));await sing(host,aim,false,()=>[host,guest].every(r=>terrain.get(r)!.has(target.x,target.y,target.z)));
  console.log('PASS: normal secret-door navigation, loom crafting and held aim inputs mined/mended shared native terrain; forged actor, cell and progress claims had no authority');
  const token=guest.reconnectionToken,id=guest.sessionId;guest.connection.close();await until('drop',()=>states.get(host)!.players.some(p=>p.id===id&&!p.connected));guest=track(await client.reconnect(token));await until('reconnect',()=>terrain.get(guest)!.has(target.x,target.y,target.z));assert.equal(guest.sessionId,id);assert.deepEqual(terrain.get(host)!.state(7919),terrain.get(guest)!.state(7919));
  host.send('lobby');await until('lobby',()=>states.get(host)!.phase==='waiting');const cave={...states.get(host)!.world};carvedCave(cave);const save=saveWorld(cave,'Portable stone caves');await upload(host,save);await until('streamed cave',()=>[host,guest].every(r=>terrain.get(r)!.size===cave.excavation!.size&&states.get(r)!.world.title===save.title&&states.get(r)!.world.excavation===terrain.get(r)));assert.deepEqual(saveWorld(states.get(guest)!.world,save.title),save);assert(states.get(host)!.players.every(p=>!p.ready));assert(bytes.length>0&&Math.max(...bytes)<11000);assert(cave.excavation!.size<SCULPT.roomLimit);assert.equal(errors.length,0);
  console.log(`PASS: reconnect preserved openings; portable caves streamed atomically to two clients and reset readiness; largest part ${Math.max(...bytes)} bytes`);
}finally{clearInterval(timer);await Promise.all(rooms.filter(r=>r.connection.isOpen).map(r=>r.leave()));}
