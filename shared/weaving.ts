import { BUILD, validCell, type RuneBlock } from './construction.js';
import { direction, EYE, HEIGHT, RADIUS, segmentBox, terrainHit } from './game.js';
import { shardSites } from './expedition.js';
import { waystoneSites } from './waystones.js';
import { terrainHeight, worldBoxes, type WorldState, type Realm } from './world.js';

export interface Weaver { x: number; y: number; z: number; yaw: number; pitch: number; realm?: Realm }
export interface WeaveTarget { x: number; y: number; z: number; existing?: RuneBlock; valid: boolean; reason: string }
export function protectedRuneSite(x: number, z: number, seed: number) {
  return Math.hypot(x + .5, z + .5) < 24 || shardSites(seed).some(s => Math.hypot(x + .5 - s.x, z + .5 - s.z) < 10) || waystoneSites(seed).some(s => Math.hypot(x + .5 - s.x, z + .5 - s.z) < 12);
}
export function placementReason(cell: { x: number; y: number; z: number }, world: WorldState, players: { x: number; y: number; z: number; realm?: Realm; alive?: boolean; connected?: boolean }[] = [], requireSupport = true) {
  const { x, y, z } = cell;
  if (!validCell(x, y, z)) return 'The weave ends here';
  if (protectedRuneSite(x, z, world.seed)) return 'Keep the tunnel and skyshard trails open';
  if (world.construction?.get(x, y, z)) return 'A rune already lives here';
  const natural = worldBoxes(x, z, x + 1, z + 1, 'wilds', { ...world, construction: undefined });
  if (natural.some(b => x < b.x + b.w / 2 - .001 && x + 1 > b.x - b.w / 2 + .001 && z < b.z + b.d / 2 - .001 && z + 1 > b.z - b.d / 2 + .001 && y < (b.y ?? 0) + b.h - .001 && y + 1 > (b.y ?? 0) + .001)) return 'Give trees and ancient ruins room';
  if (players.some(p => p.realm === 'wilds' && p.alive !== false && p.x + RADIUS > x - .04 && p.x - RADIUS < x + 1.04 && p.z + RADIUS > z - .04 && p.z - RADIUS < z + 1.04 && p.y + HEIGHT > y - .04 && p.y < y + 1.04)) return 'Leave room for your friends';
  const floor = terrainHeight(x + .5, z + .5, world.seed);
  if (y + 1 <= floor + .05) return 'Aim above the ground';
  const supported = floor >= y - .08 || [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => world.construction?.get(x + dx, y + dy, z + dz));
  return !requireSupport || supported ? '' : 'Begin on the ground or beside another rune';
}
/** Server and preview choose the same nearest surface; clients never submit a cell. */
export function weaveTarget(p: Weaver, world: WorldState, erase = false, players: Parameters<typeof placementReason>[2] = []): WeaveTarget | undefined {
  if (p.realm !== 'wilds') return;
  const a = { x: p.x, y: p.y + EYE, z: p.z }, d = direction(p.yaw, p.pitch);
  const b = { x: a.x + d.x * BUILD.reach, y: a.y + d.y * BUILD.reach, z: a.z + d.z * BUILD.reach };
  let nearest = terrainHit(a, b, world.seed), hitBox: ReturnType<typeof worldBoxes>[number] | undefined;
  for (const box of worldBoxes(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), 'wilds', world)) {
    const t = segmentBox(a, b, [box.x - box.w / 2, box.y ?? 0, box.z - box.d / 2], [box.x + box.w / 2, (box.y ?? 0) + box.h, box.z + box.d / 2]);
    if (t < nearest) { nearest = t; hitBox = box; }
  }
  if (!Number.isFinite(nearest)) return;
  const hit = { x: a.x + (b.x - a.x) * nearest, y: a.y + (b.y - a.y) * nearest, z: a.z + (b.z - a.z) * nearest };
  const existing = hitBox && 'runeKey' in hitBox ? world.construction?.get(Math.floor(hitBox.x), hitBox.y!, Math.floor(hitBox.z)) : undefined;
  if (erase) return existing ? { x: existing.x, y: existing.y, z: existing.z, existing, valid: true, reason: '' } : { x: Math.floor(hit.x), y: Math.floor(hit.y), z: Math.floor(hit.z), valid: false, reason: 'Only woven runes can be erased' };
  if (hitBox && !existing) return { x: Math.floor(hit.x), y: Math.floor(hit.y), z: Math.floor(hit.z), valid: false, reason: 'Aim at open ground or a woven rune' };
  let normal = { x: 0, y: 1, z: 0 };
  if (existing) {
    const faces = [
      { distance: Math.abs(hit.x - existing.x), x: -1, y: 0, z: 0 }, { distance: Math.abs(hit.x - existing.x - 1), x: 1, y: 0, z: 0 },
      { distance: Math.abs(hit.y - existing.y), x: 0, y: -1, z: 0 }, { distance: Math.abs(hit.y - existing.y - 1), x: 0, y: 1, z: 0 },
      { distance: Math.abs(hit.z - existing.z), x: 0, y: 0, z: -1 }, { distance: Math.abs(hit.z - existing.z - 1), x: 0, y: 0, z: 1 },
    ]; normal = faces.sort((u, v) => u.distance - v.distance)[0];
  }
  const cell = { x: Math.floor(hit.x + normal.x * .02), y: Math.floor(hit.y + normal.y * .02), z: Math.floor(hit.z + normal.z * .02) };
  const reason = placementReason(cell, world, players);
  return { ...cell, existing, valid: !reason, reason };
}
