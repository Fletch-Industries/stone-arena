import { LIMIT } from './arena.js';
import { WORLD_LIMIT, SECRET, type Realm } from './world.js';

export interface PlayerPlace { realm: Realm; x: number; y: number; z: number; yaw: number; pitch: number; flying: boolean }
export interface PlayerTrail extends PlayerPlace { key: string; at: number }
export const TRAIL_LIMIT = 32;

/** Server checkpoints contain anonymous place keys, never names or control credentials. */
export function validPlace(value: unknown): value is PlayerPlace {
  if (!value || typeof value !== 'object') return false;
  const p = value as PlayerPlace;
  if (!['arena', 'wilds'].includes(p.realm) || ![p.x, p.y, p.z, p.yaw, p.pitch].every(Number.isFinite) || Math.abs(p.yaw) > Math.PI * 2 || Math.abs(p.pitch) > 1.5 || typeof p.flying !== 'boolean') return false;
  return p.realm === 'wilds' ? Math.abs(p.x) <= WORLD_LIMIT && Math.abs(p.z) <= WORLD_LIMIT && p.y >= -32 && p.y <= 128 : Math.abs(p.x) <= LIMIT && p.z >= SECRET.end - 1 && p.z <= LIMIT && p.y >= 0 && p.y <= 128;
}
export function validTrails(value: unknown): value is PlayerTrail[] {
  return Array.isArray(value) && value.length <= TRAIL_LIMIT && new Set(value.map(p => p?.key)).size === value.length && value.every(p => { const trail = p as PlayerTrail; return validPlace(p) && typeof trail.key === 'string' && /^[a-f0-9]{64}$/.test(trail.key) && Number.isSafeInteger(trail.at) && trail.at > 0; });
}
export function placeOf(p: Omit<PlayerPlace, 'flying'> & { flying?: boolean }): PlayerPlace { return { realm: p.realm, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, flying: p.flying === true }; }
