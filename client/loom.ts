import { RECIPES, craftReason } from '../shared/crafting.js';
import { SUPPLIES } from '../shared/forage.js';
import type { Player, Snapshot } from '../shared/game.js';
import { nearbyWaystone } from '../shared/waystones.js';

export function loomPanel(s: Snapshot, p: Player, disconnected = false) {
  const stone = nearbyWaystone(p, s.world.seed);
  const stock = s.world.supplies ?? [0, 0, 0];
  return `<div class="loom"><p>Gather glowing supplies in the Wilds, then craft beside an awakened waystone. Your friends share the pantry and world upgrades.</p><div class="party-pantry" aria-label="Party supplies">${SUPPLIES.map((r, n) => `<div style="--supply-color:${r.color}"><i aria-hidden="true">${r.glyph}</i><b>${stock[n]}</b><span>${r.name}</span></div>`).join('')}</div><p class="loom-place" role="status">${stone && p.realm === 'wilds' ? `${stone.name} · Rune loom ready` : 'Stand beside an awakened waystone to craft'}</p><div class="loom-recipes">${RECIPES.map(r => {
    const reason = craftReason(p, s.world, r, s.phase === 'active' && !disconnected), made = !!r.unlock && !!((s.world.upgrades ?? 0) & r.unlock), waiting = (p.craftReadyAt ?? 0) > s.tick;
    return `<article class="loom-recipe ${made ? 'woven' : ''}"><i class="recipe-glyph" aria-hidden="true">${r.glyph}</i><div><h3>${r.name}${made ? ' ✓' : ''}</h3><p>${r.description}</p><div class="recipe-cost">${r.cost.map((cost, n) => cost ? `<span class="${stock[n] >= cost ? 'enough' : ''}" style="--supply-color:${SUPPLIES[n].color}">${SUPPLIES[n].glyph} ${stock[n]}/${cost}<small>${SUPPLIES[n].name}</small></span>` : '').join('')}</div>${r.cost.some((cost,n) => stock[n] < cost) && !made ? `<button class="text-btn" data-action="track-supplies" data-recipe="${r.id}">Find missing supplies →</button>` : ''}<button class="btn ${made ? '' : 'gold'} wide" data-action="craft" data-recipe="${r.id}" ${reason || waiting ? 'disabled' : ''}>${made ? 'Ready for your whole party' : waiting ? `Ready in ${Math.ceil(((p.craftReadyAt ?? 0) - s.tick) / 60)}s` : reason || `Craft ${r.name}`}</button></div></article>`;
  }).join('')}</div><p class="help">Supplies regrow in two minutes. Gather with E or touch the prompt. Sky sail: G or Glide hops and unfolds; steer with your view, press again to fold. Flight lasts up to 10 seconds and rests for 12 seconds after launch. Damage folds the sail. Supplies and world upgrades carry in saved worlds; arrows reset each round.</p></div>`;
}
