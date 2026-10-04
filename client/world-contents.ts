import type { Construction } from '../shared/construction.js';
import type { Excavation } from '../shared/excavation.js';
import type { Forage } from '../shared/forage.js';
import type { WorldState } from '../shared/world.js';

export interface WorldContents {
  construction: Construction; constructionSeed?: number;
  excavation: Excavation; excavationSeed?: number;
  forage: Forage; forageSeed?: number;
}
export function worldContentsReady(world: WorldState, contents: WorldContents, streaming: boolean) {
  return !streaming && contents.constructionSeed === world.seed && contents.construction.revision === world.buildRevision && contents.excavationSeed === world.seed && contents.excavation.revision === world.excavationRevision;
}

/** Full streams can finish between snapshots; rendering and exports use that completed state. */
export function bindWorldContents(world: WorldState, contents: WorldContents) {
  world.construction = contents.constructionSeed === world.seed ? contents.construction : undefined;
  world.excavation = contents.excavationSeed === world.seed ? contents.excavation : undefined;
  world.forage = contents.forageSeed === world.seed ? contents.forage : undefined;
}
