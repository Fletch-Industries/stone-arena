import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { VERSION, idleInput, type Player, type Snapshot } from '../shared/game.js';
import { navigator } from './navigation.js';
const endpoint = process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107';
const rounds = Number(process.env.TEST_ROUNDS ?? 1);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 15000) { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('Timed out waiting for game condition'); await wait(50); } }
const clients = Array.from({ length: 6 }, () => new Client(endpoint));
const rooms: Room[] = []; const states = new Map<string, Snapshot>(); const seq = new Map<string, number>();
let knockbackSeen = false, armorSeen = false;
function subscribe(r: Room) { r.onMessage('snapshot', (s: Snapshot) => { states.set(r.sessionId, s); if (s.players.some(p => p.xp >= 50)) armorSeen = true; if (s.phase === 'active' && s.players.some(p => !p.grounded && Math.hypot(p.vx ?? 0, p.vz ?? 0) > .5)) knockbackSeen = true; }); r.onMessage('pong', () => {}); r.onMessage('latency', (n: number) => r.send('latencyAck', n)); r.onError((_c, m) => console.error(m)); r.send('sync'); }
const navigators = new Map<string, ReturnType<typeof navigator>>();
let timer: ReturnType<typeof setInterval> | undefined;
try {
  rooms.push(await clients[0].create('arena', { name: 'Test-1', version: VERSION, private: true })); subscribe(rooms[0]);
  for (let n = 1; n < 5; n++) { rooms.push(await clients[n].joinById(rooms[0].roomId, { name: `Test-${n + 1}`, version: VERSION })); subscribe(rooms[n]); }
  await assert.rejects(clients[5].joinById(rooms[0].roomId, { name: 'Sixth', version: VERSION }));
  console.log('PASS: five clients joined; sixth rejected', rooms[0].roomId);
  await until(() => [...states.values()].length === 5 && [...states.values()].every(s => s.players.length === 5));
  for (let round = 0; round < rounds; round++) {
    knockbackSeen = false; armorSeen = false;
    for (const r of rooms) r.send('ready');
    await until(() => states.get(rooms[0].sessionId)!.players.every(p => p.ready)); console.log('starting', rooms[0].sessionId, states.get(rooms[0].sessionId)?.host); rooms[0].send('start', {practice:false});
    await until(() => [...states.values()].every(s => s.phase === 'active'));
    await assert.rejects(clients[5].joinById(rooms[0].roomId, { name: 'Late', version: VERSION }));
    timer = setInterval(() => {
      for (const r of rooms) {
        const s = states.get(r.sessionId), p = s?.players.find(p => p.id === r.sessionId); if (!s || !p?.alive || s.phase !== 'active') continue;
        const enemies = s.players.filter(q => q.alive && q.id !== p.id).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        const target = enemies[0]; if (!target) continue;
        const distance = Math.hypot(target.x - p.x, target.z - p.z), waypoint = (navigators.get(r.sessionId) ?? (navigators.set(r.sessionId, navigator()), navigators.get(r.sessionId)!))(p, target);
        const close = distance < 2.5; const dx = close ? target.x - p.x : waypoint[0] - p.x, dz = close ? target.z - p.z : waypoint[1] - p.z;
        const yaw = Math.atan2(-dx, -dz); const next = (seq.get(r.sessionId) ?? 0) + 1; seq.set(r.sessionId, next);
        r.send('input', { ...idleInput(), seq: next, yaw, pitch: close ? Math.atan2(-.5, Math.max(.1, distance)) : 0, z: close ? 0 : 1, sprint: !close, attack: close });
      }
    }, 1000 / 30);
    await until(() => [...states.values()].every(s => s.phase === 'results'), 90000);
    clearInterval(timer); timer = undefined;
    assert.ok(knockbackSeen, 'server knockback must replicate to the ordinary clients');
    console.log('PASS: authoritative knockback replicated during combat');
    assert.ok(armorSeen, 'earned armor must replicate to ordinary clients');
    for (const s of states.values()) for (const p of s.players) assert.ok(Math.abs(p.xp - Math.min(150, p.damage + p.kills * 50)) < .0001, 'XP must equal actual damage plus elimination bonuses');
    console.log('PASS: earned XP and armor upgrades replicated during combat');
    const results = [...states.values()]; assert.equal(new Set(results.map(s => s.winner)).size, 1);
    assert.ok(results[0].players.filter(p => p.alive).length <= 1);
    console.log(`PASS: round ${round + 1}, all five agree on ${results[0].result}; total kills ${results[0].players.reduce((v, p) => v + p.kills, 0)}`);
    if (round < rounds - 1) { await wait(3200); rooms[0].send('lobby'); await until(() => [...states.values()].every(s => s.phase === 'waiting')); }
  }
} catch (e) { console.log('last states', [...states.values()].map(s => ({phase:s.phase,countdown:s.countdown,tick:s.tick,players:s.players.map(p=>({name:p.name,ready:p.ready,connected:p.connected,x:p.x,z:p.z,hp:p.hp}))}))); throw e; } finally { if (timer) clearInterval(timer); await Promise.all(rooms.map(r => r.leave())); }
