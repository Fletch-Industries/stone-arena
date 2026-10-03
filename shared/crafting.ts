import { HEARTHSTONE, SKY_SAIL } from './sailing.js';
import type { Supplies } from './forage.js';
import { EYE, segmentBox, wallHit, type Player } from './game.js';
import { nearbyWaystone } from './waystones.js';
import type { WorldState } from './world.js';

export const RECIPES = [
  { id: 'sail', name: 'Sky sail', glyph: '⋈', cost: [12, 8, 4] as Supplies, unlock: SKY_SAIL, description: 'Unfold crystal wings for the whole party. G or Glide launches a hop; Windlift runes and high ledges give you longer flights.' },
  { id: 'hearth', name: 'Hearthstone', glyph: '♥', cost: [8, 12, 8] as Supplies, unlock: HEARTHSTONE, description: 'Unlock a seventh building rune. Rest beside its warmth to recover three HP each second after combat.' },
  { id: 'arrows', name: 'Arrow bundle', glyph: '➶', cost: [3, 2, 0] as Supplies, unlock: 0, description: 'Weave 12 arrows for your quiver, up to 40. Your party supplies pay for this bundle.' },
] as const;
export type Recipe = typeof RECIPES[number];
export const recipeFor = (id: unknown) => RECIPES.find(r => r.id === id);
export function craftReason(p: Player, world: WorldState, recipe: Recipe, active = true, rested = true) {
  if (!active || !p.alive || !p.connected || p.realm !== 'wilds') return 'Craft while exploring the Wilds';
  const stone = nearbyWaystone(p, world.seed);
  if (!stone || !((world.waystones ?? 1) & 1 << stone.id)) return 'Stand beside an awakened waystone';
  if (!rested || p.hurtTime > 0) return 'Rest for five seconds after damage';
  if (recipe.unlock && ((world.upgrades ?? 0) & recipe.unlock)) return 'Ready for your whole party';
  if (recipe.id === 'arrows' && p.ammo >= 40) return 'Your quiver is full';
  if (recipe.cost.some((cost, kind) => (world.supplies?.[kind] ?? 0) < cost)) return 'Gather the missing supplies';
  return '';
}
export function hearthNear(p: Player, world: WorldState) {
  if (p.realm !== 'wilds' || !((world.upgrades ?? 0) & HEARTHSTONE)) return false;
  const a = { x: p.x, y: p.y + EYE, z: p.z };
  return world.construction?.boxes(p.x - 3, p.z - 3, p.x + 3, p.z + 3).some(b => {
    if (b.runeKind !== 6 || Math.hypot(p.x - b.x, p.z - b.z) > 3 || Math.abs(p.y - (b.y! + 1)) > 2) return false;
    const target = { x: b.x, y: b.y! + .5, z: b.z };
    const surface = segmentBox(a, target, [b.x - .5, b.y!, b.z - .5], [b.x + .5, b.y! + 1, b.z + .5]);
    return wallHit(a, target, 'wilds', world) >= surface - .01;
  }) ?? false;
}
