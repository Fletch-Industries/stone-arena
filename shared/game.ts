import { BOXES, LIMIT } from './arena.js';
export { BOXES, LIMIT, SPAWNS, ARENA_SIZE, type Box } from './arena.js';
export const VERSION = 6;
// Round progression is an arena rule, not Minecraft's XP/armor formula.
export const ARMOR_TIERS = [
  { level: 1, xp: 0, name: 'Unarmored', reduction: 0 },
  { level: 2, xp: 50, name: 'Guard armor', reduction: .2 },
  { level: 3, xp: 150, name: 'Enchanted armor', reduction: .35 },
] as const;
export const armorTier = (xp: number) => xp >= 150 ? ARMOR_TIERS[2] : xp >= 50 ? ARMOR_TIERS[1] : ARMOR_TIERS[0];
export const APPLE = { count: 2, heal: 40, seconds: 1.6 } as const;
export const TOTEM = { count: 1, health: 20 } as const;
export type Offhand = 'shield' | 'totem';
export const DT = 1 / 60;
export const RADIUS = .34;
export const HEIGHT = 1.8;
export const EYE = 1.62;
// Java-style, unenchanted diamond kit. HP is stored at 5× Minecraft units.
export const WALK_SPEED = 4.317;
export const SPRINT_SPEED = WALK_SPEED * 1.3;
export const JUMP_HEIGHT = 1.252;
export const GRAVITY = 32;
export const MELEE = { sword: { damage: 35, recovery: .625 }, axe: { damage: 45, recovery: 1 } };
export const meleeRecovery = (weapon: Weapon) => weapon === 'axe' ? MELEE.axe.recovery : MELEE.sword.recovery;
export const attackStrength = (p: Pick<Player, 'weapon' | 'cooldown'>) => Math.max(0, Math.min(1, 1 - p.cooldown / meleeRecovery(p.weapon)));
export type Weapon = 'sword' | 'axe' | 'bow' | 'crossbow' | 'apple';
export const WEAPONS: Weapon[] = ['sword', 'axe', 'bow', 'crossbow', 'apple'];
export const COLORS = ['#f3b85b', '#6adbc8', '#a8a0ff', '#f58f9c', '#8ece6b'];
export type Phase = 'waiting' | 'countdown' | 'active' | 'results';
export interface Input { seq: number; x: number; z: number; yaw: number; pitch: number; jump: boolean; sprint: boolean; block: boolean; attack: boolean; weapon: Weapon; offhand: Offhand }
export const idleInput = (): Input => ({ seq: 0, x: 0, z: 0, yaw: 0, pitch: 0, jump: false, sprint: false, block: false, attack: false, weapon: 'sword', offhand: 'shield' });
export interface Body { x: number; y: number; z: number; vy: number; grounded: boolean; vx?: number; vz?: number; sprinting?: boolean; sprintLocked?: boolean }
export interface Player extends Body {
  id: string; name: string; color: number; yaw: number; pitch: number; hp: number; alive: boolean;
  connected: boolean; ready: boolean; weapon: Weapon; block: boolean; ammo: number; apples: number; offhand: Offhand; totems: number;
  kills: number; damage: number; assists: number; wins: number; ack: number; xp: number;
  hurtTime: number; lastDamage: number; shieldRaise: number; swingWait: number; moveSpeed: number; cooldown: number; charge: number; loaded: boolean; shieldDisabled: number; eliminatedAt: number;
}
export interface Arrow { id: number; owner: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; damage: number; age: number; critical?: boolean }
export interface GameEvent { id: number; type: 'hit' | 'kill' | 'shot' | 'swing' | 'start' | 'result' | 'level' | 'heal' | 'totem'; actor?: string; target?: string; text?: string; blocked?: boolean; critical?: boolean; sprintHit?: boolean; sweep?: boolean }
export interface Snapshot { tick: number; phase: Phase; countdown: number; result: string; winner: string; round: number; host: string; practice: boolean; players: Player[]; arrows: Arrow[]; events: GameEvent[] }
export function validInput(a: unknown): a is Input {
  if (!a || typeof a !== 'object') return false;
  const i = a as Input;
  return Number.isSafeInteger(i.seq) && i.seq >= 0 && i.seq < 2 ** 31 &&
    [i.x, i.z, i.yaw, i.pitch].every(Number.isFinite) && Math.abs(i.x) <= 1 && Math.abs(i.z) <= 1 &&
    Math.abs(i.yaw) <= Math.PI * 2 && Math.abs(i.pitch) <= 1.5 && WEAPONS.includes(i.weapon) && ['shield', 'totem'].includes(i.offhand) &&
    [i.jump, i.sprint, i.block, i.attack].every(v => typeof v === 'boolean');
}
export function direction(yaw: number, pitch = 0) { return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }; }
// Velocity impulses share the same collision path as ordinary input on client/server.
export function knockback(body: Body, dx: number, dz: number, strength = 8) {
  const length = Math.hypot(dx, dz); if (length < .001) return;
  body.vx = (body.vx ?? 0) / 2 + dx / length * strength;
  body.vz = (body.vz ?? 0) / 2 + dz / length * strength;
  if (body.grounded) { body.vy = Math.min(8, body.vy / 2 + 8); body.grounded = false; }
}
export function move(body: Body, i: Input, dt = DT, slow = false) {
  if (!i.sprint || i.z <= 0) body.sprintLocked = false;
  body.sprinting = i.sprint && i.z > 0 && !slow && !i.block && !body.sprintLocked;
  const length = Math.max(1, Math.hypot(i.x, i.z));
  const speed = (body.sprinting ? SPRINT_SPEED : WALK_SPEED) * (i.block || slow ? .3 : 1);
  if (i.jump && body.grounded) {
    body.vy = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT); body.grounded = false;
    if (body.sprinting) { const d = direction(i.yaw); body.vx = (body.vx ?? 0) + d.x * 4; body.vz = (body.vz ?? 0) + d.z * 4; }
  }
  const dx = ((i.x * Math.cos(i.yaw) - i.z * Math.sin(i.yaw)) / length * speed + (body.vx ?? 0)) * dt;
  const dz = ((-i.x * Math.sin(i.yaw) - i.z * Math.cos(i.yaw)) / length * speed + (body.vz ?? 0)) * dt;
  const oldY = body.y;
  body.y += body.vy * dt - .5 * GRAVITY * dt * dt; body.vy -= GRAVITY * dt;
  body.grounded = false;
  if (body.y <= 0) { body.y = 0; body.vy = 0; body.grounded = true; }
  for (const b of BOXES) {
    if (Math.abs(body.x - b.x) >= b.w / 2 + RADIUS || Math.abs(body.z - b.z) >= b.d / 2 + RADIUS) continue;
    const bottom = b.y ?? 0, top = bottom + b.h;
    if (oldY >= top - .001 && body.y < top && body.vy <= 0) { body.y = top; body.vy = 0; body.grounded = true; }
    else if (bottom > 0 && oldY + HEIGHT <= bottom + .001 && body.y + HEIGHT > bottom && body.vy > 0) { body.y = bottom - HEIGHT; body.vy = 0; }
  }
  // Resolve to the contact surface instead of reverting an entire impulse step.
  for (const [axis, delta, velocity] of [['x', dx, 'vx'], ['z', dz, 'vz']] as const) {
    const before = body[axis]; let next = Math.max(-LIMIT, Math.min(LIMIT, before + delta));
    if (next !== before + delta) body[velocity] = 0;
    for (const b of BOXES) {
      const other = axis === 'x' ? 'z' : 'x', half = (axis === 'x' ? b.w : b.d) / 2 + RADIUS;
      const otherHalf = (axis === 'x' ? b.d : b.w) / 2 + RADIUS;
      const bottom = b.y ?? 0, top = bottom + b.h;
      if (body.y >= top - .001 || body.y + HEIGHT <= bottom + .001 || Math.abs(body[other] - b[other]) >= otherHalf) continue;
      const lo = b[axis] - half, hi = b[axis] + half;
      const crossing = delta > 0 && before <= lo && next > lo || delta < 0 && before >= hi && next < hi;
      if (!crossing) continue;
      // Step only onto the destination's small riser, with clear headroom.
      const destination = { x: body.x, z: body.z, [axis]: next };
      const step = top - body.y;
      const clear = !BOXES.some(o => {
        const y = o.y ?? 0;
        return Math.abs(destination.x - o.x) < o.w / 2 + RADIUS && Math.abs(destination.z - o.z) < o.d / 2 + RADIUS && top < y + o.h - .001 && top + HEIGHT > y + .001;
      });
      if (body.grounded && step > 0 && step <= .41 && next > lo && next < hi && clear) { body.y = top; body.vy = 0; }
      else { next = delta > 0 ? lo : hi; body[velocity] = 0; }
    }
    body[axis] = next;
  }
  const friction = Math.pow(body.grounded ? .546 : .91, dt * 20);
  body.vx = (body.vx ?? 0) * friction; body.vz = (body.vz ?? 0) * friction;
  if (Math.abs(body.vx) < .001) body.vx = 0;
  if (Math.abs(body.vz) < .001) body.vz = 0;
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
  for (const box of BOXES) t = Math.min(t, segmentBox(a, b, [box.x - box.w / 2, box.y ?? 0, box.z - box.d / 2], [box.x + box.w / 2, (box.y ?? 0) + box.h, box.z + box.d / 2]));
  return t;
}
