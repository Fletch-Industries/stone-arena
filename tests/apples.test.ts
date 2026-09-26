import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPLE, DT, idleInput, validInput, type Input } from '../shared/game.js';
import { Simulation } from '../server/simulation.js';
function game() { const s = new Simulation(), a = s.add('a','Apple'), b = s.add('b','Other'); s.phase = 'active'; return { s,a,b }; }
function ticks(s: Simulation, count: number, values: Partial<Input> = {}) { for(let n=0;n<count;n++) { s.input('a',{...idleInput(),weapon:'apple',attack:true,...values,seq:s.tick+1});s.step(); } }
test('apple requires full server eating duration and heals only once at completion', () => {
 const {s,a}=game();a.hp=30;ticks(s,95);assert.equal(a.hp,30);assert.equal(a.apples,2);ticks(s,1);assert.equal(a.hp,70);assert.equal(a.apples,1);assert.equal(a.xp,0);assert.equal(a.damage,0);assert.equal(s.events.filter(e=>e.type==='heal').length,1);
});
test('apples cap health, preserve full-health inventory, and cannot exceed finite supply', () => {
 const {s,a}=game();ticks(s,100);assert.equal(a.apples,2);assert.equal(a.charge,0);
 a.hp=85;ticks(s,96);assert.equal(a.hp,100);assert.equal(a.apples,1);
 a.hp=10;ticks(s,300);assert.equal(a.hp,50);assert.equal(a.apples,0);assert.equal(a.charge,0);
 assert.ok(validInput({...idleInput(),weapon:'apple'}));
});
test('release, weapon switch, shielding, stale controls and disconnect cancel eating', () => {
 for(const interruption of ['release','switch','shield','stale','disconnect']){
  const {s,a}=game();a.hp=20;ticks(s,60);
  if(interruption==='release')ticks(s,1,{attack:false});
  if(interruption==='switch')ticks(s,1,{weapon:'sword',attack:false});
  if(interruption==='shield')ticks(s,1,{block:true});
  if(interruption==='stale')for(let n=0;n<17;n++)s.step();
  if(interruption==='disconnect'){s.disconnect(a.id);s.step();a.connected=true;}
  assert.equal(a.charge,0,interruption);assert.equal(a.apples,2);ticks(s,35);assert.equal(a.hp,20);ticks(s,61);assert.equal(a.hp,60);
 }
});
test('same-tick fatal damage wins over completed eating; no revive or item cost', () => {
 const {s,a,b}=game();Object.assign(a,{x:-5,z:0,hp:10,weapon:'apple',charge:APPLE.seconds-DT});Object.assign(b,{x:-5,z:-2,yaw:Math.PI});
 s.input(b.id,{...idleInput(),seq:1,yaw:Math.PI,attack:true});ticks(s,1);
 assert.equal(a.alive,false);assert.equal(a.hp,0);assert.equal(a.apples,2);assert.equal(s.winner,b.id);assert.equal(s.events.some(e=>e.type==='heal'),false);
});
test('nonfatal damage does not cancel food and healing happens after combat', () => {
 const {s,a,b}=game();Object.assign(a,{x:-5,z:0,hp:60,weapon:'apple',charge:APPLE.seconds-DT});Object.assign(b,{x:-5,z:-2,yaw:Math.PI});
 s.input(b.id,{...idleInput(),seq:1,yaw:Math.PI,attack:true});ticks(s,1);assert.equal(a.hp,65);assert.equal(a.apples,1);
});
test('reconnect preserves remaining food; lobby and new rounds reset it', () => {
 const {s,a,b}=game();a.hp=40;ticks(s,96);s.disconnect(a.id);a.connected=true;assert.equal(s.snapshot().players.find(p=>p.id===a.id)!.apples,1);
 s.practice=true;s.host=a.id;s.lobby(a.id);assert.equal(a.apples,2);a.apples=0;a.ready=b.ready=true;s.start(a.id);assert.equal(a.apples,2);
});
