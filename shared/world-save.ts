import { BUILD, Construction, validCell, validKind } from './construction.js';
import { placementReason } from './weaving.js';
import { Forage, validSupplies, type Supplies } from './forage.js';
import { HEARTHSTONE } from './sailing.js';
import { validBonds, validGuardians } from './creatures.js';
import type { WorldState } from './world.js';
import { ECHO_CHISEL, Excavation, SCULPT, validStoneCell, type StoneCell } from './excavation.js';
import { sculptReason, stratumAt } from './mining.js';

export type SavedRune = [number, number, number, number];
export interface WorldSave { format: 'stone-arena-world'; version: 1 | 2 | 3 | 4; title: string; seed: number; doorOpen: boolean; waystones: number; blocks: SavedRune[]; cuts?: StoneCell[]; veins?: StoneCell[]; supplies?: Supplies; upgrades?: number; bonds?: number; guardians?: number }
export type WorldSaveHeader = Omit<WorldSave, 'blocks' | 'cuts' | 'veins'>;
export const SAVE_BYTES = 384_000;
export function saveWorld(world: WorldState, title = world.title ?? 'My rune world'): WorldSave {
  return { format: 'stone-arena-world', version: 4, title: title.trim().slice(0, 32) || 'My rune world', seed: world.seed, doorOpen: world.doorOpen, waystones: world.waystones ?? 1, supplies: [...(world.supplies ?? [0, 0, 0])], upgrades: world.upgrades ?? 0, bonds: world.bonds ?? 0, guardians: world.guardians ?? 0, blocks: [...(world.construction?.values() ?? [])].map(b => [b.x, b.y, b.z, b.kind]), cuts: [...(world.excavation?.values() ?? [])].map(c => [c.x, c.y, c.z]), veins: [...(world.excavation?.claimedCells() ?? [])].map(c => [...c]) };
}
export function validSaveHeader(a: unknown): a is WorldSaveHeader {
  if (!a || typeof a !== 'object') return false; const s = a as WorldSave;
  const extras = (s.supplies === undefined || validSupplies(s.supplies)) && (s.upgrades === undefined || Number.isInteger(s.upgrades) && s.upgrades >= 0 && s.upgrades <= (s.version === 4 ? 7 : 3)) && (s.bonds === undefined || validBonds(s.bonds)) && (s.guardians === undefined || validGuardians(s.guardians));
  return s.format === 'stone-arena-world' && [1, 2, 3, 4].includes(s.version) && extras && (s.version === 1 || validSupplies(s.supplies) && s.upgrades !== undefined) && (s.version < 3 || validBonds(s.bonds) && validGuardians(s.guardians)) && typeof s.title === 'string' && s.title.length > 0 && s.title.length <= 32 && !/[\u0000-\u001f<>]/.test(s.title) && Number.isInteger(s.seed) && s.seed >= 0 && s.seed <= 0xffffffff && typeof s.doorOpen === 'boolean' && Number.isInteger(s.waystones) && s.waystones >= 1 && s.waystones <= 511 && !!(s.waystones & 1);
}
/** Portable worlds contain terrain/discoveries/builds, never player names or stats. */
export function restoreWorld(a: unknown): WorldState | undefined {
  if (!validSaveHeader(a)) return; const s = a as WorldSave;
  if (!Array.isArray(s.blocks) || s.blocks.length > BUILD.roomLimit) return;
  const world: WorldState = { seed: s.seed, doorOpen: s.doorOpen, waystones: s.waystones, title: s.title, construction: new Construction(), excavation: new Excavation(), forage: new Forage(), supplies: [...(s.supplies ?? [0, 0, 0])], upgrades: s.upgrades ?? 0, bonds: s.bonds ?? 0, guardians: s.guardians ?? 0 };
  if (s.version === 4) {
    if (!Array.isArray(s.cuts) || s.cuts.length > SCULPT.roomLimit || !Array.isArray(s.veins) || s.veins.length > SCULPT.veinLimit || (s.cuts.length || s.veins.length) && !((world.upgrades ?? 0) & ECHO_CHISEL)) return;
    for (const [n, cell] of s.cuts.entries()) if (!Array.isArray(cell) || cell.length !== 3 || !validStoneCell(cell[0], cell[1], cell[2]) || sculptReason({ x: cell[0], y: cell[1], z: cell[2] }, world) || !world.excavation!.dig({ x: cell[0], y: cell[1], z: cell[2], owner: `memory:${Math.floor(n / SCULPT.playerLimit)}` })) return;
    for (const cell of s.veins) if (!Array.isArray(cell) || cell.length !== 3 || !validStoneCell(cell[0], cell[1], cell[2]) || sculptReason({ x: cell[0], y: cell[1], z: cell[2] }, world) || stratumAt(cell[0], cell[1], cell[2], s.seed).vein === undefined) return;
    if (!world.excavation!.restore({ seed: s.seed, revision: world.excavation!.revision, cuts: world.excavation!.state(s.seed).cuts, veins: s.veins })) return;
    for (const c of world.excavation!.values()) if (stratumAt(c.x,c.y,c.z,s.seed).vein !== undefined && !world.excavation!.claimed(c.x,c.y,c.z)) return;
  } else if (s.cuts !== undefined && (!Array.isArray(s.cuts) || s.cuts.length) || s.veins !== undefined && (!Array.isArray(s.veins) || s.veins.length)) return;
  for (const [n, row] of s.blocks.entries()) {
    if (!Array.isArray(row) || row.length !== 4 || !validCell(row[0], row[1], row[2]) || s.version < 4 && row[1] < 0 || !validKind(row[3]) || row[3] === 6 && !((world.upgrades ?? 0) & HEARTHSTONE)) return;
    const cell = { x: row[0], y: row[1], z: row[2] };
    // Runes may float after their original support is erased. Keep that magic.
    if (placementReason(cell, world, [], false) || !world.construction!.place({ ...cell, kind: row[3], owner: `memory:${Math.floor(n / BUILD.playerLimit)}` })) return;
  }
  world.construction!.drain(s.seed); return world;
}
export function parseWorldSave(text: string): WorldSave | undefined {
  if (text.length > SAVE_BYTES) return;
  try { const data = JSON.parse(text); return restoreWorld(data) ? data as WorldSave : undefined; } catch { return; }
}
