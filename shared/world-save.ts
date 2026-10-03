import { BUILD, Construction, validCell, validKind } from './construction.js';
import { placementReason } from './weaving.js';
import type { WorldState } from './world.js';

export type SavedRune = [number, number, number, number];
export interface WorldSave { format: 'stone-arena-world'; version: 1; title: string; seed: number; doorOpen: boolean; waystones: number; blocks: SavedRune[] }
export const SAVE_BYTES = 192_000;
export function saveWorld(world: WorldState, title = world.title ?? 'My rune world'): WorldSave {
  return { format: 'stone-arena-world', version: 1, title: title.trim().slice(0, 32) || 'My rune world', seed: world.seed, doorOpen: world.doorOpen, waystones: world.waystones ?? 1, blocks: [...(world.construction?.values() ?? [])].map(b => [b.x, b.y, b.z, b.kind]) };
}
export function validSaveHeader(a: unknown): a is Omit<WorldSave, 'blocks'> {
  if (!a || typeof a !== 'object') return false; const s = a as WorldSave;
  return s.format === 'stone-arena-world' && s.version === 1 && typeof s.title === 'string' && s.title.length > 0 && s.title.length <= 32 && !/[\u0000-\u001f<>]/.test(s.title) && Number.isInteger(s.seed) && s.seed >= 0 && s.seed <= 0xffffffff && typeof s.doorOpen === 'boolean' && Number.isInteger(s.waystones) && s.waystones >= 1 && s.waystones <= 511 && !!(s.waystones & 1);
}
/** Portable worlds contain terrain/discoveries/builds, never player names or stats. */
export function restoreWorld(a: unknown): WorldState | undefined {
  if (!validSaveHeader(a)) return; const s = a as WorldSave;
  if (!Array.isArray(s.blocks) || s.blocks.length > BUILD.roomLimit) return;
  const world: WorldState = { seed: s.seed, doorOpen: s.doorOpen, waystones: s.waystones, title: s.title, construction: new Construction() };
  for (const [n, row] of s.blocks.entries()) {
    if (!Array.isArray(row) || row.length !== 4 || !validCell(row[0], row[1], row[2]) || !validKind(row[3])) return;
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
