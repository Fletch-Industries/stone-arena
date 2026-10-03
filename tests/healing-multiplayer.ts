import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { VERSION, idleInput, type Snapshot } from '../shared/game.js';
const endpoint=process.env.TEST_ENDPOINT??'http://127.0.0.1:3107';
const client=new Client(endpoint), rooms:Room[]=[], states=new Map<Room,Snapshot>();
let timer:ReturnType<typeof setInterval>|undefined, seq=0, corner=false;
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean, ms=90000){const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error('Healing integration timed out');await wait(30);}}
function track(r:Room){rooms.push(r);r.onMessage('snapshot',(s:Snapshot)=>states.set(r,s));r.onMessage('latency',(n:number)=>r.send('latencyAck',n));r.onMessage('pong',()=>{});r.send('sync');return r;}
try{
 const a=track(await client.create('arena',{name:'Sword test',version:VERSION,private:true})),b=track(await client.joinById(a.roomId,{name:'Apple test',version:VERSION}));
 await until(()=>states.get(a)?.players.length===2);a.send('ready');b.send('ready');await until(()=>states.get(a)!.players.every(p=>p.ready));a.send('start',{practice:false});await until(()=>states.get(b)?.phase==='active');
 // Walk the clear outside corridor using ordinary inputs; no privileged test routes.
 timer=setInterval(()=>{
  const s=states.get(a),attacker=s?.players.find(p=>p.id===a.sessionId),target=s?.players.find(p=>p.id===b.sessionId);if(!attacker||!target)return;
  if(Math.abs(attacker.z-target.z)<.5)corner=true;
  const dx=corner?target.x-attacker.x:0,dz=target.z-attacker.z,near=Math.hypot(dx,dz)<2.4&&corner;
  a.send('input',{...idleInput(),seq:++seq,yaw:Math.atan2(-dx,-dz),pitch:near?Math.atan2(-.4,Math.hypot(dx,dz)):0,z:near?0:1,sprint:!near,attack:near&&target.hp===100});
  b.send('input',{...idleInput(),seq:++seq,weapon:'apple'});
 },33);
 await until(()=>!!states.get(b)?.players.find(p=>p.id===b.sessionId&&p.hp<100));clearInterval(timer);timer=undefined;
 a.send('input',{...idleInput(),seq:++seq});
 const hurt=states.get(b)!.players.find(p=>p.id===b.sessionId)!;assert.ok(hurt.alive&&hurt.apples===2);const expected=Math.min(100,hurt.hp+40);
 timer=setInterval(()=>{a.send('input',{...idleInput(),seq:++seq});b.send('input',{...idleInput(),seq:++seq,weapon:'apple',attack:true});},33);
 await until(()=>[a,b].every(r=>states.get(r)?.players.some(p=>p.id===b.sessionId&&p.apples===1&&p.hp===expected)));
 clearInterval(timer);timer=undefined;b.send('input',{...idleInput(),seq:++seq,weapon:'apple'});
 for(const r of rooms){assert.equal(states.get(r)!.events.filter(e=>e.type==='heal'&&e.actor===b.sessionId).length,1);assert.equal(states.get(r)!.players.find(p=>p.id===b.sessionId)!.xp,0);}
 console.log(`PASS: ordinary sword hit removed health; both clients saw golden apple heal ${hurt.hp} to ${expected} HP and inventory 2 to 1`);
}finally{if(timer)clearInterval(timer);await Promise.all(rooms.map(r=>r.leave()));}
