import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { VERSION, idleInput, type Snapshot } from '../shared/game.js';
import { terrainHeight, worldBoxes } from '../shared/world.js';
import { waystoneSites } from '../shared/waystones.js';
import { shardSites } from '../shared/expedition.js';
import { navigator } from './navigation.js';
const client = new Client(process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107'), rooms: Room[] = [], states = new Map<Room, Snapshot>(), sequences = new Map<Room, number>();
const expedition = process.argv.includes('--expedition'), waystones = process.argv.includes('--waystones'), actionErrors = new Map<Room, string[]>();
let timer: ReturnType<typeof setInterval> | undefined;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, seconds = 80) { const end = Date.now() + seconds * 1000; while (!check()) { if (Date.now() > end) throw Error('Wilds timed out: ' + JSON.stringify([...states.values()].map(s => ({ world: s.world, players: s.players.map(p => ({ id: p.id, realm: p.realm, x: p.x, y: p.y, z: p.z, hp: p.hp })) })))); await wait(25); } }
function track(r: Room) { rooms.push(r); r.onMessage('snapshot', (s: Snapshot) => states.set(r, s)); r.onMessage('latency', (n: number) => r.send('latencyAck', n)); r.onMessage('pong', () => {}); r.onMessage('actionError', (message: string) => actionErrors.set(r,[...(actionErrors.get(r)??[]),message].slice(-50)));  r.reconnection.enabled = false; r.send('sync'); return r; }
const me = (r: Room) => states.get(r)!.players.find(p => p.id === r.sessionId)!;
function controls(r: Room, value = {}) { const seq = (sequences.get(r) ?? me(r).ack) + 1; sequences.set(r, seq); r.send('input', { ...idleInput(), seq, ...value }); }
async function walk(r: Room, x: number, z: number, stop = () => Math.hypot(me(r).x - x, me(r).z - z) < .5, path = true) {
  const navigate = navigator(); timer = setInterval(() => {
    // Stop on the observed portal/arrival before issuing movement in its new realm.
    if (stop()) { controls(r); return; }
    const p = me(r), d = Math.hypot(p.x - x, p.z - z), point = path && d > 1.5 ? navigate(p, { x, z }) : [x, z];
    controls(r, { yaw: Math.atan2(p.x - point[0], p.z - point[1]), z: 1, sprint: d > 2 }); for (const other of rooms) if (other !== r && other.connection.isOpen) other.send('ping', Date.now());
  }, 33);
  try { await until(stop); } finally { clearInterval(timer); timer = undefined; if (r.connection.isOpen) controls(r); }
}
function wildRoute(from: {x:number;z:number}, target:{x:number;z:number}, seed:number) {
  const key=(x:number,z:number)=>`${x},${z}`, start=[Math.round(from.x/2),Math.round(from.z/2)], goal=[Math.round(target.x/2),Math.round(target.z/2)], queue=[start], parents=new Map<string,number[]|null>([[key(start[0],start[1]),null]]);
  const minX=Math.min(start[0],goal[0])-12,maxX=Math.max(start[0],goal[0])+12,minZ=Math.min(start[1],goal[1])-12,maxZ=Math.max(start[1],goal[1])+12;
  let found:number[]|undefined;
  for(let n=0;n<queue.length;n++){const v=queue[n];if(Math.hypot(v[0]-goal[0],v[1]-goal[1])<1.5){found=v;break;}for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=v[0]+dx,z=v[1]+dz,k=key(x,z);if(x<minX||x>maxX||z<minZ||z>maxZ||parents.has(k))continue;// Keep an outdoor route out of the return portal; enter it explicitly after reaching the clearing.
      if(Math.abs(x*2)<3.5&&z*2>=3&&z*2<=13)continue;const y=terrainHeight(x*2,z*2,seed);if(worldBoxes(x*2,z*2,x*2,z*2,'wilds',{seed,doorOpen:true}).some(b=>Math.abs(x*2-b.x)<b.w/2+1&&Math.abs(z*2-b.z)<b.d/2+1&&y+1.8>(b.y??0)&&y<(b.y??0)+b.h))continue;parents.set(k,v);queue.push([x,z]);}}
  if(!found)throw Error('No route to the skyshard');const route=[found];while(parents.get(key(route[0][0],route[0][1])))route.unshift(parents.get(key(route[0][0],route[0][1]))!);return route.map(v=>[v[0]*2,v[1]*2]);
}
async function followWildRoute(r:Room,target:{x:number;z:number},stop:()=>boolean=()=>Math.hypot(me(r).x-target.x,me(r).z-target.z)<1){const route=wildRoute(me(r),target,states.get(r)!.world.seed);let point=0;timer=setInterval(()=>{const p=me(r);while(point<route.length-1&&Math.hypot(p.x-route[point][0],p.z-route[point][1])<.65)point++;const goal=point===route.length-1?[target.x,target.z]:route[point],d=Math.hypot(p.x-goal[0],p.z-goal[1]);controls(r,{yaw:Math.atan2(p.x-goal[0],p.z-goal[1]),z:1,sprint:true,dash:d>7&&(p.dashCooldown??0)<=0});for(const other of rooms)if(other!==r&&other.connection.isOpen)other.send('ping',Date.now());},33);try{await until(stop,100);}finally{clearInterval(timer);timer=undefined;controls(r);}}
try {
  const host = track(await client.create('arena', { name: 'Wilds explorer', version: VERSION, private: true }));
  let guest = track(await client.joinById(host.roomId, { name: 'Terrain observer', version: VERSION }));
  await until(() => rooms.every(r => states.get(r)?.players.length === 2)); assert.equal(states.get(host)!.world.seed, states.get(guest)!.world.seed);
  if (expedition || waystones) { host.send('mode', { mode: 'expedition' }); await until(() => rooms.every(r => states.get(r)?.mode === 'expedition')); }
  host.send('ready'); guest.send('ready'); await until(() => states.get(host)!.players.every(p => p.ready)); host.send('start'); await until(() => states.get(host)?.phase === 'active');
  guest.send('interact'); await wait(100); assert(!states.get(host)!.world.doorOpen);
  await walk(host, -26, -46); host.send('interact'); await until(() => rooms.every(r => states.get(r)?.world.doorOpen === true));
  console.log('PASS: remote interaction rejected; nearby explorer opened a shared secret door');
  await walk(host, -26, -65, () => rooms.every(r => states.get(r)?.players.some(p => p.id === host.sessionId && p.realm === 'wilds') === true), false);
  assert.equal(me(host).hp, 100); assert.equal(me(guest).realm, 'arena');
  console.log('PASS: both clients observed traversing the passage into the Wilds');
  const beforeDash = { ...me(host) }, guestBeforeDash = { ...me(guest) };
  controls(host, { dash: true });
  await until(() => rooms.every(r => (states.get(r)?.players.find(p => p.id === host.sessionId)?.dashCooldown ?? 0) > 0), 5);
  controls(host);
  await until(() => rooms.every(r => (states.get(r)?.players.find(p => p.id === host.sessionId)?.dashTime ?? 0) === 0), 5);
  for (const r of rooms) { const p = states.get(r)!.players.find(p => p.id === host.sessionId)!; assert(Math.hypot(p.x - beforeDash.x, p.z - beforeDash.z) > 6); assert(Math.hypot(p.x - beforeDash.x, p.z - beforeDash.z) < 7.5); assert.equal(p.hp, 100); }
  assert.equal(me(guest).x, guestBeforeDash.x); assert.equal(me(guest).z, guestBeforeDash.z);
  console.log('PASS: Windstep replicated its seven-block dash and cooldown to both clients without moving the observer');
  // Pick a clear radial route from the spawn, avoiding generated trunk/foliage
  // collisions through the same shared geometry used by ordinary movement.
  let target = { x: 0, z: -38 };
  for (let n = 0; n < 32; n++) {
    const candidate = { x: Math.sin(n * Math.PI / 16) * 38, z: -Math.cos(n * Math.PI / 16) * 38 };
    const clear = Array.from({ length: 38 }, (_, step) => ({ x: candidate.x * step / 38, z: candidate.z * step / 38 })).every(v => !worldBoxes(v.x, v.z, v.x, v.z, 'wilds', states.get(host)!.world).some(b => Math.abs(v.x - b.x) < b.w / 2 + .5 && Math.abs(v.z - b.z) < b.d / 2 + .5 && terrainHeight(v.x, v.z, states.get(host)!.world.seed) + 1.8 > (b.y ?? 0)));
    if (clear && terrainHeight(candidate.x, candidate.z, states.get(host)!.world.seed) > .5) { target = candidate; break; }
  }
  await walk(host, target.x, target.z, undefined, false);
  for (const r of rooms) { const s = states.get(r)!, p = s.players.find(p => p.id === host.sessionId)!; assert.equal(p.realm, 'wilds'); assert(Math.abs(p.y - terrainHeight(p.x, p.z, s.world.seed)) < .03); assert.equal(p.hp, 100); }
  console.log('PASS: shared procedural hills match authoritative footing for both clients');
  const site=shardSites(states.get(host)!.world.seed)[0]; await followWildRoute(host,site,()=>rooms.filter(r=>r.connection.isOpen).every(r=>states.get(r)?.players.some(p=>p.id===host.sessionId&&(p.relics&1)!==0)===true));
  assert.equal(me(host).relics,1);assert.equal(me(guest).relics,0);console.log('PASS: ordinary exploration discovered the Dawn skyshard for its explorer in both snapshots');
  if (waystones) {
    const seed = states.get(host)!.world.seed;
    for (const remaining of shardSites(seed).slice(1)) await followWildRoute(host, remaining, () => (me(host).relics & 1 << remaining.id) !== 0);
    assert.equal(me(host).relics,7);
    const target=waystoneSites(seed).filter(s=>!((states.get(host)!.world.waystones??1)&1<<s.id)).sort((a,b)=>Math.hypot(me(host).x-a.x,me(host).z-a.z)-Math.hypot(me(host).x-b.x,me(host).z-b.z))[0];assert(target);
    const observer={...me(guest)}, from={...me(host)};
    guest.send('warp',{destination:target.id,id:host.sessionId,relics:7,waystones:511});
    await until(()=>(actionErrors.get(guest)?.length??0)>0,5);assert.equal(me(host).relics,7);assert(Math.hypot(me(host).x-from.x,me(host).z-from.z)<.5);
    host.send('warp',{destination:target.id});await until(()=>(actionErrors.get(host)?.length??0)>0,5);assert.equal(me(host).warpTick,-1000);
    console.log('PASS: ordinary clients cannot forge a Warden identity, discoveries or travel from a remote position');
    await followWildRoute(host,target,()=>[host,guest].every(r=>!!((states.get(r)?.world.waystones??1)&1<<target.id)));
    const inventory={hp:me(host).hp,ammo:me(host).ammo,apples:me(host).apples,totems:me(host).totems,xp:me(host).xp};
    host.send('warp',{destination:0});await until(()=>[host,guest].every(r=>{const p=states.get(r)?.players.find(p=>p.id===host.sessionId);return p?.realm==='wilds'&&Math.hypot(p.x,p.z+5)<.01&&(p.warpTick??-1000)>0;}),5);
    for(const r of [host,guest]){const p=states.get(r)!.players.find(p=>p.id===host.sessionId)!;assert.deepEqual({hp:p.hp,ammo:p.ammo,apples:p.apples,totems:p.totems,xp:p.xp},inventory);assert.equal(p.relics,7);assert.equal(p.y,0);}
    assert.equal(me(guest).x,observer.x);assert.equal(me(guest).z,observer.z);assert.equal(me(guest).relics,0);
    const errors=actionErrors.get(host)!.length;host.send('warp',{destination:target.id});await until(()=>(actionErrors.get(host)?.length??0)>errors,5);assert.equal(me(host).z,-5);
    await until(()=>states.get(host)!.tick>=(me(host).warpReadyAt??0),5);
    host.send('warp',{destination:target.id,id:guest.sessionId});await until(()=>[host,guest].every(r=>{const p=states.get(r)?.players.find(p=>p.id===host.sessionId);return !!p&&Math.hypot(p.x-target.x,p.z-target.z)<.01;}),5);
    assert.equal(me(guest).realm,'arena');assert.equal(me(guest).x,observer.x);assert.equal(me(guest).z,observer.z);
    console.log('PASS: ordinary exploration awakened a shared ruin; two-way Warden travel replicated, preserved supplies and enforced its rest without moving the observer');
  }
  const seed = states.get(host)!.world.seed, oldId = guest.sessionId, token = guest.reconnectionToken; guest.connection.close();
  await until(() => me(host).connected && !states.get(host)!.players.find(p => p.id === oldId)!.connected, 5); guest = track(await client.reconnect(token));
  await until(() => states.get(guest)?.players.length === 2); assert.equal(states.get(guest)!.world.seed, seed); assert(states.get(guest)!.world.doorOpen);
  assert.equal(states.get(guest)!.players.find(p => p.id === host.sessionId)!.realm, 'wilds');
  assert.equal(states.get(guest)!.players.find(p=>p.id===host.sessionId)!.relics,waystones?7:1); if(waystones)assert.equal(states.get(guest)!.world.waystones,states.get(host)!.world.waystones); await followWildRoute(host,{x:0,z:0}); await walk(host, 0, 10, () => me(host).realm === 'arena', false);
  assert.equal(me(host).hp, 100); // Snapshots may include a few ticks of legitimate movement after the transition.
  // The simulation tests separately assert the exact portal coordinates.
  assert(Math.abs(me(host).x + 26) < .25); assert(me(host).z < -59); assert.equal(states.get(host)!.phase, 'active');
  console.log('PASS: reconnect preserved world discovery; return tunnel restored arena location and health');
  if (waystones) {
    const discovered=states.get(host)!.world.waystones;host.send('lobby');await until(()=>[host,guest].every(r=>states.get(r)?.phase==='waiting'));
    host.send('ready');guest.send('ready');await until(()=>states.get(host)!.players.every(p=>p.ready));host.send('start');await until(()=>[host,guest].every(r=>states.get(r)?.phase==='active'));
    for(const r of [host,guest]){assert.equal(states.get(r)!.world.waystones,discovered);assert.equal(states.get(r)!.world.seed,seed);assert(states.get(r)!.players.every(p=>p.relics===0&&(p.warpReadyAt??0)===0));}
    console.log('PASS: reconnect and rematch preserved shared waystone discovery while resetting personal Warden progress');
  }
  if (expedition) {
    await walk(host, -26, -65, () => me(host).realm === 'wilds', false);
    for (const remaining of shardSites(seed).slice(1)) await followWildRoute(host, remaining, () => (me(host).relics & 1 << remaining.id) !== 0);
    await followWildRoute(host, { x: 0, z: 0 }); await walk(host, 0, 10, () => me(host).realm === 'arena', false);
    assert.equal(me(host).relics, 7); assert.equal(states.get(host)!.phase, 'active'); assert.equal(me(host).wins, 0);
    console.log('PASS: one completed explorer returning home does not prematurely end the expedition');
    await walk(guest, -26, -46); await walk(guest, -26, -65, () => me(guest).realm === 'wilds', false);
    for (const site of shardSites(seed)) await followWildRoute(guest, site, () => (me(guest).relics & 1 << site.id) !== 0);
    assert.equal(states.get(host)!.phase, 'active');
    await followWildRoute(guest, { x: 0, z: 0 }); await walk(guest, 0, 10, () => me(guest).realm === 'arena', false);
    await until(() => [host, guest].every(r => states.get(r)?.phase === 'results'));
    for (const r of [host, guest]) { const s = states.get(r)!; assert.match(s.result, /Everyone made it home/); assert(s.players.every(p => p.relics === 7 && p.wins === 1 && p.hp === 100 && p.realm === 'arena')); }
    console.log('PASS: two ordinary clients collected all three skyshards each, returned through the tunnel and received a shared win');
    await wait(3100); host.send('lobby'); await until(() => [host, guest].every(r => states.get(r)?.phase === 'waiting'));
    host.send('ready'); guest.send('ready'); await until(() => states.get(host)!.players.every(p => p.ready)); host.send('start'); await until(() => [host, guest].every(r => states.get(r)?.phase === 'active'));
    assert(states.get(host)!.players.every(p => p.relics === 0 && p.wins === 1)); assert.equal(states.get(host)!.world.seed, seed);
    console.log('PASS: expedition rematch preserved shared wins and world seed while resetting the trail');
  }
} finally { if (timer) clearInterval(timer); await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave())); }
