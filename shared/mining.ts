import { ECHO_CHISEL, SCULPT, validStoneCell, type CutCell } from './excavation.js';
import { EYE, HEIGHT, RADIUS, direction, segmentBox, terrainHit } from './game.js';
import { protectedRuneSite } from './weaving.js';
import { hash, terrainHeight, treesIn, worldBoxes, type Realm, type WorldState } from './world.js';
import { rectangleHeight } from './terrain-collision.js';

export interface StoneSinger { id?: string; x: number; y: number; z: number; yaw: number; pitch: number; realm?: Realm }
export interface Stratum { name: string; color: string; ticks: number; vein?: 0 | 1 | 2 }
export interface SculptTarget { x: number; y: number; z: number; valid: boolean; reason: string; stratum: Stratum; position: { x: number; y: number; z: number }; existing?: CutCell }
const SEAMS = [
  { name: 'Lumen seam', color: '#90e9bd' },
  { name: 'Gleam seam', color: '#a7b1ff' },
  { name: 'Emberglass seam', color: '#ffb97a' },
] as const;
/** Seeded three-block seams make finding a deposit worth following underground. */
export function stratumAt(x: number, y: number, z: number, seed: number): Stratum {
  if (y < SCULPT.minHeight) return { name: 'Deepstone', color: '#718098', ticks: 54 };
  const depth = terrainHeight(x + .5, z + .5, seed) - y - .5;
  const salt = seed ^ Math.imul(Math.floor(y / 3) + 8192, 15683), cx = Math.floor(x / 3), cz = Math.floor(z / 3);
  if (depth > 1.25 && hash(cx, cz, salt ^ 7057) < .115) {
    const vein = Math.min(2, Math.floor(hash(cx, cz, salt ^ 9161) * 3)) as 0 | 1 | 2;
    return { ...SEAMS[vein], ticks: 72, vein };
  }
  return depth < 2.5 ? { name: 'Rootstone', color: '#b59475', ticks: 39 } : { name: 'Echo shale', color: '#8696b6', ticks: 54 };
}
type Traveller = { x: number; y: number; z: number; realm?: Realm; alive?: boolean; connected?: boolean };
export function sculptReason(cell: { x: number; y: number; z: number }, world: WorldState, players: Traveller[] = [], mend = false) {
  const { x, y, z } = cell;
  if (!validStoneCell(x, y, z)) return y < SCULPT.minHeight ? 'The deepstone foundation stays whole' : 'The stone song ends here';
  if (rectangleHeight(x, z, x + 1, z + 1, world.seed) <= y + .001) return 'Aim at native ground or a cave wall';
  if (protectedRuneSite(x, z, world.seed)) return 'Keep the tunnel, skyshards and waystone foundations whole';
  if (treesIn(x - 3, z - 3, x + 4, z + 4, world.seed).some(t => Math.abs(x + .5 - t.x) < 2.6 && Math.abs(z + .5 - t.z) < 2.6)) return 'Leave solid roots beneath the grove trees';
  if (world.construction?.get(x, y, z)) return 'Use Rune build to erase a woven rune first';
  if (mend && players.some(p => p.realm === 'wilds' && p.alive !== false && p.x + RADIUS > x - .03 && p.x - RADIUS < x + 1.03 && p.z + RADIUS > z - .03 && p.z - RADIUS < z + 1.03 && p.y + HEIGHT > y - .03 && p.y < y + 1.03)) return 'Leave room for every explorer';
  return '';
}
/** Ordinary aim selects the same native cell on server and client. */
export function sculptTarget(p: StoneSinger, world: WorldState, mend = false, players: Traveller[] = [], allowMend = false): SculptTarget | undefined {
  if (p.realm !== 'wilds') return;
  const a = { x: p.x, y: p.y + EYE, z: p.z }, d = direction(p.yaw, p.pitch);
  const b = { x: a.x + d.x * SCULPT.reach, y: a.y + d.y * SCULPT.reach, z: a.z + d.z * SCULPT.reach };
  const nearest = terrainHit(a, b, world.seed, world.excavation);
  if (!Number.isFinite(nearest)) return;
  const point = { x: a.x + d.x * (nearest * SCULPT.reach + (mend ? -.004 : .004)), y: a.y + d.y * (nearest * SCULPT.reach + (mend ? -.004 : .004)), z: a.z + d.z * (nearest * SCULPT.reach + (mend ? -.004 : .004)) };
  const cell = { x: Math.floor(point.x), y: Math.floor(point.y), z: Math.floor(point.z) }, stratum = stratumAt(cell.x, cell.y, cell.z, world.seed), existing = world.excavation?.get(cell.x, cell.y, cell.z);
  let reason = sculptReason(cell, world, players, mend);
  for (const box of worldBoxes(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), 'wilds', world)) {
    if (segmentBox(a, b, [box.x - box.w / 2, box.y ?? 0, box.z - box.d / 2], [box.x + box.w / 2, (box.y ?? 0) + box.h, box.z + box.d / 2]) < nearest - .001) { reason = 'Aim past your runes at native ground'; break; }
  }
  if (!((world.upgrades ?? 0) & ECHO_CHISEL)) reason = 'Weave Echo chisel at a waystone loom first';
  else if (!world.excavation) reason = 'The stone song is arriving…';
  else if (mend && !existing) reason = 'Aim at an excavated edge to mend it';
  else if (mend && existing!.owner !== p.id && !allowMend) reason = 'This opening belongs to another explorer';
  else if (!mend && existing) reason = 'That stone is already open';
  else if (!mend && (world.excavation!.size >= SCULPT.roomLimit || p.id && world.excavation!.count(p.id) >= SCULPT.playerLimit)) reason = 'Mend an opening to make room for more shaping';
  else if (!mend && stratum.vein !== undefined && !world.excavation!.claimed(cell.x, cell.y, cell.z) && world.excavation!.veinCount >= SCULPT.veinLimit) reason = 'This world has sung all its crystal seams';
  return { ...cell, stratum, existing, position: { x: a.x + d.x * nearest * SCULPT.reach, y: a.y + d.y * nearest * SCULPT.reach, z: a.z + d.z * nearest * SCULPT.reach }, valid: !reason, reason };
}
