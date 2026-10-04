import { KEEP, validHandle, validKeepSummary, type KeepStatus, type KeepSummary, type WorldHandle } from '../shared/world-keep.js';

export interface WorldBookmark { handle: WorldHandle; summary: KeepSummary }
type BookmarkStorage = Pick<Storage, 'getItem' | 'setItem'>;
/** Tiny private bookmarks. Keys never enter invite links or portable world files. */
export class WorldKeeps {
  entries: WorldBookmark[] = [];
  available = true;
  private storage?: BookmarkStorage;
  constructor(storage?: BookmarkStorage) {
    try {
      this.storage = storage ?? localStorage;
      const text = this.storage.getItem('stone-world-keeps-v1'); if (!text) return;
      if (text.length > 100_000) return;
      const entries = JSON.parse(text); if (!Array.isArray(entries) || entries.length > KEEP.worlds) return;
      for (const entry of [...entries].reverse()) if (validHandle(entry?.handle) && validKeepSummary(entry?.summary) && entry.handle.id === entry.summary.id && !this.entries.some(b => b.handle.id === entry.handle.id)) this.remember({ state: 'saved', handle: entry.handle, summary: entry.summary }, false);
    } catch { this.available = false; }
  }
  remember(status: KeepStatus, persist = true) {
    if (!validHandle(status.handle) || !validKeepSummary(status.summary) || status.handle.id !== status.summary.id) return;
    const h = status.handle, s = status.summary;
    const bookmark: WorldBookmark = { handle: { id: h.id, key: h.key }, summary: { id: s.id, title: s.title, seed: s.seed, mode: s.mode, savedAt: s.savedAt, runes: s.runes, openings: s.openings } };
    const existing = this.entries.find(b => b.handle.id === h.id);
    if (existing && existing.summary.savedAt > s.savedAt) return;
    if (existing && existing.handle.key === h.key && JSON.stringify(existing.summary) === JSON.stringify(bookmark.summary)) return;
    this.entries = [bookmark, ...this.entries.filter(b => b.handle.id !== h.id)].slice(0, KEEP.worlds);
    if (persist) this.persist();
  }
  forget(id: string) { this.entries = this.entries.filter(b => b.handle.id !== id); this.persist(); }
  private persist() {
    try { this.storage?.setItem('stone-world-keeps-v1', JSON.stringify(this.entries)); this.available = !!this.storage; }
    catch { this.available = false; }
  }
}
