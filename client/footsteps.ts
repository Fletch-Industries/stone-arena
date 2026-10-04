import { terrainHeight, terrainVertex } from '../shared/world.js';
import type { Body } from '../shared/game.js';

export type FootstepSurface = 'grass' | 'stone' | 'shore' | 'cave' | 'citadel';
/** Sample only when a grounded stride completes; reuse the bounded height cache. */
export function footstepSurface(body: Body, seed: number, cave: boolean): FootstepSurface {
  if (body.realm !== 'wilds') return 'citadel';
  if (cave) return 'cave';
  const height = terrainHeight(body.x, body.z, seed);
  if (Math.abs(body.y - height) > .65) return 'stone';
  if (Math.hypot(body.x, body.z) < 18) return 'grass';
  if (height < .8) return 'shore';
  if (height > 20) return 'stone';
  const dx = terrainVertex(body.x - 1, body.z, seed) - terrainVertex(body.x + 1, body.z, seed);
  const dz = terrainVertex(body.x, body.z - 1, seed) - terrainVertex(body.x, body.z + 1, seed);
  return 2 / Math.hypot(dx, 2, dz) < .82 ? 'stone' : 'grass';
}

// Original, short two-voice cues. Existing grass/cave/Citadel timbres are retained.
export const FOOTSTEPS = {
  grass: { noiseSeconds: .09, cutoff: 1400, hz: 80, toneSeconds: .08, end: 50 },
  stone: { noiseSeconds: .06, cutoff: 1850, hz: 190, toneSeconds: .05, end: 95 },
  shore: { noiseSeconds: .13, cutoff: 420, hz: 62, toneSeconds: .09, end: 35 },
  cave: { noiseSeconds: .09, cutoff: 650, hz: 80, toneSeconds: .08, end: 50 },
  citadel: { noiseSeconds: .09, cutoff: 750, hz: 115, toneSeconds: .08, end: 50 },
} as const;
