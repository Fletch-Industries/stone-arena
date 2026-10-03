import { WINDSTEP } from './expedition.js';
import { BUILD, validKind } from './construction.js';
import { SAIL, SKY_SAIL } from './sailing.js';
import { LIMIT } from './arena.js';
import { movementLimit, terrainHeight, worldBoxes, type Realm, type WorldState } from './world.js';
export { BOXES, LIMIT, SPAWNS, ARENA_SIZE, type Box } from './arena.js';
export const VERSION = 13;
export type Mode = 'ffa' | 'teams' | 'ctf' | 'expedition';
export type Team = 'red' | 'blue';
export const MODES = { ffa: 'Free for all', teams: 'Team survival', ctf: 'Capture the flag', expedition: 'Co-op expedition' } as const;
export const isTeamMode = (mode?: Mode) => mode === 'teams' || mode === 'ctf';
export const TEAMS = { red: { name: 'Red', color: '#ff7777', x: -40, z: 0 }, blue: { name: 'Blue', color: '#75baff', x: 40, z: 0 } } as const;
export const CTF = { target: 3, respawnTicks: 300, returnTicks: 1800, protectionTicks: 120, radius: 1.4 } as const;
export interface Flag { team: Team; state: 'home' | 'carried' | 'dropped'; x: number; y: number; z: number; carrier: string; returnAt: number }
export const playerColor = (p: Player, mode: Mode = 'ffa') => isTeamMode(mode) ? TEAMS[p.team].color : COLORS[p.color];
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
export interface Input { seq: number; x: number; z: number; yaw: number; pitch: number; jump: boolean; dash?: boolean; glide?: boolean; weaving?: boolean; weaveKind?: number; sprint: boolean; block: boolean; attack: boolean; weapon: Weapon; offhand: Offhand }
export const idleInput = (): Input => ({ seq: 0, x: 0, z: 0, yaw: 0, pitch: 0, jump: false, dash: false, sprint: false, block: false, attack: false, weapon: 'sword', offhand: 'shield' });
export interface Body { glideTime?: number; glideCooldown?: number; glideHeld?: boolean; hurtTime?: number; dashTime?: number; dashCooldown?: number; dashYaw?: number; dashHeld?: boolean; realm?: Realm; x: number; y: number; z: number; vy: number; grounded: boolean; vx?: number; vz?: number; sprinting?: boolean; sprintLocked?: boolean }
export interface Player extends Body {
  weaving?: boolean; weaveKind?: number; weaveReadyAt?: number; buildCount?: number; gatherReadyAt?: number; craftReadyAt?: number;
  warpTick?: number; warpReadyAt?: number;
  relics: number; realm: Realm; team: Team; respawnAt: number; immuneUntil: number; captures: number; flagReturns: number;
  id: string; name: string; color: number; yaw: number; pitch: number; hp: number; alive: boolean;
  connected: boolean; ready: boolean; weapon: Weapon; block: boolean; ammo: number; apples: number; offhand: Offhand; totems: number;
  kills: number; damage: number; assists: number; wins: number; ack: number; xp: number;
  hurtTime: number; lastDamage: number; shieldRaise: number; swingWait: number; moveSpeed: number; cooldown: number; charge: number; loaded: boolean; shieldDisabled: number; eliminatedAt: number;
}
export interface Arrow { realm?: Realm; id: number; owner: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; damage: number; age: number; critical?: boolean }
export interface GameEvent { id: number; type: 'hit' | 'kill' | 'shot' | 'swing' | 'start' | 'result' | 'level' | 'heal' | 'totem' | 'flag_pickup' | 'flag_drop' | 'flag_return' | 'flag_capture' | 'door' | 'travel' | 'dash' | 'relic' | 'waystone' | 'warp' | 'weave' | 'erase' | 'windlift' | 'gather' | 'craft' | 'glide' | 'hearth'; actor?: string; target?: string; team?: Team; text?: string; position?: { x: number; y: number; z: number }; blocked?: boolean; critical?: boolean; sprintHit?: boolean; sweep?: boolean }
export interface Snapshot { world: WorldState; mode: Mode; winnerTeam: Team | ''; scores: Record<Team, number>; flags: Flag[]; tick: number; phase: Phase; countdown: number; result: string; winner: string; round: number; host: string; practice: boolean; players: Player[]; arrows: Arrow[]; events: GameEvent[] }
export function validInput(a: unknown): a is Input {
  if (!a || typeof a !== 'object') return false;
  const i = a as Input;
  return Number.isSafeInteger(i.seq) && i.seq >= 0 && i.seq < 2 ** 31 &&
    [i.x, i.z, i.yaw, i.pitch].every(Number.isFinite) && Math.abs(i.x) <= 1 && Math.abs(i.z) <= 1 &&
    Math.abs(i.yaw) <= Math.PI * 2 && Math.abs(i.pitch) <= 1.5 && WEAPONS.includes(i.weapon) && ['shield', 'totem'].includes(i.offhand) &&
    (i.dash === undefined || typeof i.dash === 'boolean') && (i.glide === undefined || typeof i.glide === 'boolean') && (i.weaving === undefined || typeof i.weaving === 'boolean') && (i.weaveKind === undefined || validKind(i.weaveKind)) && [i.jump, i.sprint, i.block, i.attack].every(v => typeof v === 'boolean');
}
export function direction(yaw: number, pitch = 0) { return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }; }
// Velocity impulses share the same collision path as ordinary input on client/server.
export function knockback(body: Body, dx: number, dz: number, strength = 8) {
  const length = Math.hypot(dx, dz); if (length < .001) return;
  body.vx = (body.vx ?? 0) / 2 + dx / length * strength;
  body.vz = (body.vz ?? 0) / 2 + dz / length * strength;
  if (body.grounded) { body.vy = Math.min(8, body.vy / 2 + 8); body.grounded = false; }
}
export function move(body: Body, i: Input, dt = DT, slow = false, world?: WorldState) {
  body.dashCooldown = Math.max(0, (body.dashCooldown ?? 0) - dt);
  body.dashTime = Math.max(0, (body.dashTime ?? 0) - dt);
  body.glideCooldown = Math.max(0, (body.glideCooldown ?? 0) - dt);
  body.glideTime = Math.max(0, (body.glideTime ?? 0) - dt);
  if (body.realm !== 'wilds' || slow || i.block || (body.hurtTime ?? 0) > 0) body.glideTime = 0;
  const sailPress = i.glide && !body.glideHeld;
  const launch = sailPress && body.glideTime === 0 && body.realm === 'wilds' && !!((world?.upgrades ?? 0) & SKY_SAIL) && body.glideCooldown === 0 && !slow && !i.block && (body.hurtTime ?? 0) === 0;
  if (sailPress && body.glideTime > 0) body.glideTime = 0;
  else if (launch) { body.glideTime = SAIL.seconds; body.glideCooldown = SAIL.cooldown; body.dashTime = 0; }
  body.glideHeld = i.glide === true;
  if (i.dash && !body.dashHeld && body.glideTime === 0 && body.realm === 'wilds' && body.dashCooldown === 0 && !slow && !i.block) { body.dashTime = WINDSTEP.duration; body.dashCooldown = WINDSTEP.cooldown; body.dashYaw = i.yaw; }
  body.dashHeld = i.dash === true;
  if (!i.sprint || i.z <= 0) body.sprintLocked = false;
  body.sprinting = i.sprint && i.z > 0 && !slow && !i.block && !body.sprintLocked;
  const length = Math.max(1, Math.hypot(i.x, i.z));
  const speed = (body.sprinting ? SPRINT_SPEED : WALK_SPEED) * (i.block || slow ? .3 : 1);
  if ((i.jump || launch) && body.grounded) {
    const wind = body.realm === 'wilds' && world?.construction?.boxes(body.x - RADIUS, body.z - RADIUS, body.x + RADIUS, body.z + RADIUS).some(b => b.runeKind === 5 && Math.abs(body.y - (b.y! + 1)) < .03);
    body.vy = Math.sqrt(2 * GRAVITY * (wind ? BUILD.windJump : JUMP_HEIGHT)); body.grounded = false;
    if (body.sprinting) { const d = direction(i.yaw); body.vx = (body.vx ?? 0) + d.x * 4; body.vz = (body.vz ?? 0) + d.z * 4; }
  }
  const dash = (body.dashTime ?? 0) > 0 && body.realm === 'wilds', gliding = (body.glideTime ?? 0) > 0 && body.realm === 'wilds';
  const dx = ((gliding ? -Math.sin(i.yaw) * SAIL.speed + i.x * Math.cos(i.yaw) * 2 : dash ? -Math.sin(body.dashYaw ?? i.yaw) * WINDSTEP.speed : (i.x * Math.cos(i.yaw) - i.z * Math.sin(i.yaw)) / length * speed) + (body.vx ?? 0)) * dt;
  const dz = ((gliding ? -Math.cos(i.yaw) * SAIL.speed - i.x * Math.sin(i.yaw) * 2 : dash ? -Math.cos(body.dashYaw ?? i.yaw) * WINDSTEP.speed : (-i.x * Math.sin(i.yaw) - i.z * Math.cos(i.yaw)) / length * speed) + (body.vz ?? 0)) * dt;
  const realm = body.realm ?? 'arena';
  const boxes = worldBoxes(Math.min(body.x, body.x + dx), Math.min(body.z, body.z + dz), Math.max(body.x, body.x + dx), Math.max(body.z, body.z + dz), realm, world);
  const ground = realm === 'wilds' ? terrainHeight(body.x, body.z, world?.seed ?? 0) : 0;
  const oldY = body.y;
  if (gliding && body.vy < -SAIL.fall) body.vy = -SAIL.fall;
  const gravity = gliding && body.vy <= 0 ? body.vy > -SAIL.fall ? 4 : 0 : GRAVITY;
  body.y += body.vy * dt - .5 * gravity * dt * dt; body.vy -= gravity * dt;
  if (gliding && body.vy < -SAIL.fall) body.vy = -SAIL.fall;
  body.grounded = false;
  if (body.y <= ground) { body.y = ground; body.vy = 0; body.grounded = true; }
  for (const b of boxes) {
    if (Math.abs(body.x - b.x) >= b.w / 2 + RADIUS || Math.abs(body.z - b.z) >= b.d / 2 + RADIUS) continue;
    const bottom = b.y ?? 0, top = bottom + b.h;
    if (oldY >= top - .001 && body.y < top && body.vy <= 0) { body.y = top; body.vy = 0; body.grounded = true; }
    else if (bottom > 0 && oldY + HEIGHT <= bottom + .001 && body.y + HEIGHT > bottom && body.vy > 0) { body.y = bottom - HEIGHT; body.vy = 0; }
  }
  // Resolve to the contact surface instead of reverting an entire impulse step.
  for (const [axis, delta, velocity] of [['x', dx, 'vx'], ['z', dz, 'vz']] as const) {
    const before = body[axis]; let next = movementLimit(axis, body.x, body.z, before + delta, realm, world?.doorOpen === true);
    if (next !== before + delta) body[velocity] = 0;
    for (const b of boxes) {
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
      const clear = !boxes.some(o => {
        const y = o.y ?? 0;
        return Math.abs(destination.x - o.x) < o.w / 2 + RADIUS && Math.abs(destination.z - o.z) < o.d / 2 + RADIUS && top < y + o.h - .001 && top + HEIGHT > y + .001;
      });
      if (body.grounded && step > 0 && step <= .41 && next > lo && next < hi && clear) { body.y = top; body.vy = 0; }
      else { next = delta > 0 ? lo : hi; body[velocity] = 0; }
    }
    body[axis] = next;
  }
  if (realm === 'wilds') { const floor = terrainHeight(body.x, body.z, world?.seed ?? 0); if (body.y <= floor || body.grounded && Math.abs(body.y - floor) < .41 && !boxes.some(b => 'runeKey' in b && Math.abs(body.x - b.x) < b.w / 2 + RADIUS && Math.abs(body.z - b.z) < b.d / 2 + RADIUS && Math.abs(body.y - ((b.y ?? 0) + b.h)) < .001)) { body.y = floor; body.vy = 0; body.grounded = true; } }
  if (body.grounded) body.glideTime = 0;
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
export function wallHit(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, realm: Realm = 'arena', world?: WorldState) {
  let t = Infinity;
  for (const box of worldBoxes(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), realm, world)) t = Math.min(t, segmentBox(a, b, [box.x - box.w / 2, box.y ?? 0, box.z - box.d / 2], [box.x + box.w / 2, (box.y ?? 0) + box.h, box.z + box.d / 2]));
  if (realm === 'wilds') t = Math.min(t, terrainHit(a, b, world?.seed ?? 0));
  return t;
}
export function terrainHit(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, seed: number) {
    const steps = Math.max(1, Math.min(64, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 4)));
    const below = (f: number) => a.y + (b.y - a.y) * f <= terrainHeight(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, seed);
    for (let n = 0; n <= steps; n++) if (below(n / steps)) { let lo = Math.max(0, (n - 1) / steps), hi = n / steps; for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (below(mid)) hi = mid; else lo = mid; } return hi; }
    return Infinity;
}
