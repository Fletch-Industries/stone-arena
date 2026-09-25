export const VERSION = 1;
export const DT = 1 / 60;
export const RADIUS = .34;
export const HEIGHT = 1.8;
export const EYE = 1.6;
export const LIMIT = 15.65;
export type Weapon = 'sword' | 'axe' | 'bow' | 'crossbow';
export const WEAPONS: Weapon[] = ['sword', 'axe', 'bow', 'crossbow'];
export const COLORS = ['#f3b85b', '#6adbc8', '#a8a0ff', '#f58f9c', '#8ece6b'];
export type Phase = 'waiting' | 'countdown' | 'active' | 'results';
export interface Box { x: number; z: number; w: number; d: number; h: number }
export const BOXES: Box[] = [
  { x: 0, z: 0, w: 3, d: 3, h: 2.8 },
  ...[-1, 1].flatMap(x => [-1, 1].map(z => ({ x: x * 7, z: z * 7, w: 2, d: 2, h: 2.5 }))),
  { x: -9, z: 0, w: 3, d: 1, h: 1.15 }, { x: 9, z: 0, w: 3, d: 1, h: 1.15 },
  { x: 0, z: -9, w: 1, d: 3, h: 1.15 }, { x: 0, z: 9, w: 1, d: 3, h: 1.15 },
];
export const SPAWNS = [[-12, -12], [12, 12], [-12, 12], [12, -12], [0, -13], [0, 13], [-13, 0], [13, 0]];
export interface Input { seq: number; x: number; z: number; yaw: number; pitch: number; jump: boolean; sprint: boolean; block: boolean; attack: boolean; weapon: Weapon }
export const idleInput = (): Input => ({ seq: 0, x: 0, z: 0, yaw: 0, pitch: 0, jump: false, sprint: false, block: false, attack: false, weapon: 'sword' });
export interface Body { x: number; y: number; z: number; vy: number; grounded: boolean }
export interface Player extends Body {
  id: string; name: string; color: number; yaw: number; pitch: number; hp: number; alive: boolean;
  connected: boolean; ready: boolean; weapon: Weapon; block: boolean; ammo: number;
  kills: number; damage: number; assists: number; wins: number; ack: number;
  cooldown: number; charge: number; loaded: boolean; shieldDisabled: number; eliminatedAt: number;
}
export interface Arrow { id: number; owner: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; damage: number; age: number }
export interface GameEvent { id: number; type: 'hit' | 'kill' | 'shot' | 'swing' | 'start' | 'result'; actor?: string; target?: string; text?: string; blocked?: boolean }
export interface Snapshot { tick: number; phase: Phase; countdown: number; result: string; winner: string; round: number; host: string; practice: boolean; players: Player[]; arrows: Arrow[]; events: GameEvent[] }
export function validInput(a: unknown): a is Input {
  if (!a || typeof a !== 'object') return false;
  const i = a as Input;
  return Number.isSafeInteger(i.seq) && i.seq >= 0 && i.seq < 2 ** 31 &&
    [i.x, i.z, i.yaw, i.pitch].every(Number.isFinite) && Math.abs(i.x) <= 1 && Math.abs(i.z) <= 1 &&
    Math.abs(i.yaw) <= Math.PI * 2 && Math.abs(i.pitch) <= 1.5 && WEAPONS.includes(i.weapon) &&
    [i.jump, i.sprint, i.block, i.attack].every(v => typeof v === 'boolean');
}
export function direction(yaw: number, pitch = 0) { return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }; }
export function move(body: Body, i: Input, dt = DT, slow = false) {
  const length = Math.max(1, Math.hypot(i.x, i.z));
  const speed = (i.sprint && !slow && !i.block ? 7.5 : 5) * (i.block ? .65 : slow ? .75 : 1);
  const dx = (i.x * Math.cos(i.yaw) - i.z * Math.sin(i.yaw)) / length * speed * dt;
  const dz = (-i.x * Math.sin(i.yaw) - i.z * Math.cos(i.yaw)) / length * speed * dt;
  if (i.jump && body.grounded) { body.vy = 7; body.grounded = false; }
  const oldY = body.y;
  body.vy -= 22 * dt;
  body.y += body.vy * dt;
  body.grounded = false;
  if (body.y <= 0) { body.y = 0; body.vy = 0; body.grounded = true; }
  for (const b of BOXES) {
    if (Math.abs(body.x - b.x) < b.w / 2 + RADIUS && Math.abs(body.z - b.z) < b.d / 2 + RADIUS && oldY >= b.h - .01 && body.y < b.h) {
      body.y = b.h; body.vy = 0; body.grounded = true;
    }
  }
  for (const [axis, delta] of [['x', dx], ['z', dz]] as const) {
    const before = body[axis];
    body[axis] = Math.max(-LIMIT, Math.min(LIMIT, before + delta));
    for (const b of BOXES) if (body.y < b.h - .02 && Math.abs(body.x - b.x) < b.w / 2 + RADIUS && Math.abs(body.z - b.z) < b.d / 2 + RADIUS) body[axis] = before;
  }
}
// Parametric segment/AABB intersection; shared by melee occlusion and swept arrows.
export function segmentBox(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, min: number[], max: number[]) {
  let lo = 0, hi = 1;
  for (const [j, k] of (['x', 'y', 'z'] as const).entries()) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-8) { if (a[k] < min[j] || a[k] > max[j]) return Infinity; }
    else { const t1 = (min[j] - a[k]) / d, t2 = (max[j] - a[k]) / d; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); if (lo > hi) return Infinity; }
  }
  return lo;
}
export function wallHit(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  let t = Infinity;
  for (const box of BOXES) t = Math.min(t, segmentBox(a, b, [box.x - box.w / 2, 0, box.z - box.d / 2], [box.x + box.w / 2, box.h, box.z + box.d / 2]));
  return t;
}
