import { Client, type Room } from '@colyseus/sdk';
import assert from 'node:assert/strict';
import { VERSION, idleInput, TEAMS, type Snapshot } from '../shared/game.js';
import { navigator } from './navigation.js';
const client = new Client(process.env.TEST_ENDPOINT ?? 'http://127.0.0.1:3107');
const rooms: Room[] = [], states = new Map<Room, Snapshot>(), seq = new Map<Room, number>();
let timer: ReturnType<typeof setInterval> | undefined;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, seconds = 60) {
  const end = Date.now() + seconds * 1000;
  while (!check()) { if (Date.now() > end) throw Error('CTF timed out: ' + JSON.stringify([...states.values()].map(s => ({ phase: s.phase, flags: s.flags, players: s.players.map(p => ({ id: p.id, hp: p.hp, alive: p.alive, x: p.x, z: p.z })) })))); await wait(25); }
}
function track(r: Room) {
  rooms.push(r); r.onMessage('snapshot', (s: Snapshot) => states.set(r, s)); r.onMessage('latency', (n: number) => r.send('latencyAck', n)); r.onMessage('pong', () => {}); r.onMessage('actionError', (m: string) => console.log('Action:', m)); r.reconnection.enabled = false; r.send('sync'); return r;
}
const player = (r: Room) => states.get(r)!.players.find(p => p.id === r.sessionId)!;
function input(r: Room, fields = {}) { const n = (seq.get(r) ?? player(r).ack) + 1; seq.set(r, n); r.send('input', { ...idleInput(), seq: n, ...fields }); }
async function walk(r: Room, target: { x: number; z: number }, stop: () => boolean = () => Math.hypot(player(r).x - target.x, player(r).z - target.z) < .4) {
  const navigate = navigator(); timer = setInterval(() => {
    const p = player(r), distance = Math.hypot(p.x - target.x, p.z - target.z), point = distance < 1.5 ? [target.x, target.z] : navigate(p, target);
    input(r, { yaw: Math.atan2(p.x - point[0], p.z - point[1]), z: 1, sprint: distance > 2 });
    for (const other of rooms) if (other !== r && other.connection.isOpen) other.send('ping', Date.now());
  }, 33);
  try { await until(stop); } finally { clearInterval(timer); timer = undefined; if (r.connection.isOpen) input(r); }
}
try {
  const red = track(await client.create('arena', { name: 'Flag runner', version: VERSION, private: true }));
  let blue = track(await client.joinById(red.roomId, { name: 'Blue defender', version: VERSION }));
  await until(() => states.get(red)?.players.length === 2);
  blue.send('mode', { mode: 'ctf' }); await wait(100); assert.equal(states.get(red)!.mode, 'ffa');
  red.send('mode', { mode: 'ctf' }); await until(() => states.get(blue)?.mode === 'ctf');
  assert.equal(player(red).team, 'red'); assert.equal(player(blue).team, 'blue');
  red.send('ready'); blue.send('ready'); await until(() => states.get(red)!.players.every(p => p.ready)); red.send('start'); await until(() => states.get(red)?.phase === 'active');
  await walk(red, TEAMS.blue, () => rooms.every(r => states.get(r)?.flags.some(f => f.team === 'blue' && f.carrier === red.sessionId) === true));
  console.log('PASS: both clients observed enemy flag pickup through ordinary movement');
  await walk(red, TEAMS.red, () => rooms.every(r => states.get(r)?.scores.red === 1));
  assert.equal(states.get(red)!.phase, 'active'); assert.equal(player(red).captures, 1); assert(states.get(blue)!.flags.every(f => f.state === 'home'));
  console.log('PASS: both clients observed returning the enemy flag to score with own flag home');
  await walk(red, { x: -43, z: -5 }); await walk(blue, { x: -43, z: -3 });
  const deaths = player(blue).kills;
  timer = setInterval(() => { const a = player(blue), target = player(red); input(blue, { yaw: Math.atan2(a.x - target.x, a.z - target.z), attack: target.alive, weapon: 'axe', z: target.alive && Math.hypot(a.x - target.x, a.z - target.z) > 1.8 ? 1 : 0 }); input(red); }, 33);
  await until(() => !player(red).alive, 15); clearInterval(timer); timer = undefined; input(blue);
  const deadline = player(red).respawnAt; assert(deadline > states.get(red)!.tick); assert.equal(states.get(red)!.phase, 'active');
  await until(() => player(red).alive, 10); assert.equal(player(red).hp, 100); assert.equal(player(red).totems, 1); assert.equal(player(blue).kills, deaths + 1); assert.equal(states.get(red)!.scores.red, 1);
  console.log('PASS: CTF elimination keeps the round running and respawns with supplies and preserved score');
  await walk(blue, TEAMS.red, () => states.get(red)!.flags.some(f => f.team === 'red' && f.carrier === blue.sessionId));
  const oldId = blue.sessionId, token = blue.reconnectionToken; blue.connection.close();
  await until(() => states.get(red)!.flags.some(f => f.team === 'red' && f.state === 'dropped'), 5);
  blue = track(await client.reconnect(token)); await until(() => states.get(blue)?.players.some(p => p.id === oldId && p.connected) === true);
  assert.equal(blue.sessionId, oldId); assert.equal(player(blue).team, 'blue'); assert.equal(states.get(blue)!.scores.red, 1);
  console.log('PASS: disconnect drops a carried flag and reconnect preserves the team, seat and score');
} finally {
  if (timer) clearInterval(timer);
  await Promise.all(rooms.filter(r => r.connection.isOpen).map(r => r.leave()));
}
