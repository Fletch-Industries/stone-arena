import { parseWorldSave, saveWorld, type WorldSave } from '../shared/world-save.js';
import type { WorldState } from '../shared/world.js';

interface Memory { savedAt: number; world: WorldSave }
/** Three local memories; portable files let families move them between browsers. */
export class WorldBook {
  entries: Memory[] = [];
  available = true;
  constructor() {
    try {
      const stored = localStorage.getItem('stone-world-book-v1');
      if (!stored || stored.length > 600_000) return;
      const list = JSON.parse(stored); if (!Array.isArray(list) || list.length > 3) return;
      for (const memory of list) if (Number.isFinite(memory?.savedAt) && memory.savedAt > 0) { const world = parseWorldSave(JSON.stringify(memory.world)); if (world) this.entries.push({ savedAt: memory.savedAt, world }); }
    } catch { this.available = false; }
  }
  remember(world: WorldState, title?: string) {
    const old = this.entries.find(m => m.world.seed === world.seed);
    const memory = { savedAt: Date.now(), world: saveWorld(world, title || world.title || old?.world.title || `Rune world ${world.seed.toString(16).slice(-4).toUpperCase()}`) };
    this.entries = [memory, ...this.entries.filter(m => m.world.seed !== world.seed)].slice(0, 3);
    try { localStorage.setItem('stone-world-book-v1', JSON.stringify(this.entries)); this.available = true; } catch { this.available = false; }
    return memory.world;
  }
  forget(seed: number) { this.entries = this.entries.filter(m => m.world.seed !== seed); try { localStorage.setItem('stone-world-book-v1', JSON.stringify(this.entries)); } catch { this.available = false; } }
}
