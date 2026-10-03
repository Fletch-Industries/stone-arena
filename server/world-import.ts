import { BUILD } from '../shared/construction.js';
import { validSaveHeader, type SavedRune, type WorldSave } from '../shared/world-save.js';

/** Small upload packets keep the existing 4KiB inbound WebSocket limit intact. */
export class WorldImport {
  private upload?: { header: Omit<WorldSave, 'blocks'>; count: number; blocks: SavedRune[]; started: number };
  begin(header: unknown, count: unknown, now: number) {
    this.upload = undefined;
    if (!validSaveHeader(header) || !Number.isInteger(count) || (count as number) < 0 || (count as number) > BUILD.roomLimit) return false;
    this.upload = { header: { format: header.format, version: header.version, title: header.title, seed: header.seed, doorOpen: header.doorOpen, waystones: header.waystones, supplies: header.supplies ? [...header.supplies] : undefined, upgrades: header.upgrades }, count: count as number, blocks: [], started: now }; return true;
  }
  chunk(offset: unknown, blocks: unknown, now: number) {
    const u = this.upload;
    if (!u || now - u.started > 30_000 || offset !== u.blocks.length || !Array.isArray(blocks) || !blocks.length || blocks.length > 64 || u.blocks.length + blocks.length > u.count || !blocks.every(row => Array.isArray(row) && row.length === 4 && row.every(Number.isInteger))) { this.upload = undefined; return false; }
    u.blocks.push(...blocks.map(row => [...row] as SavedRune)); return true;
  }
  finish(now: number): WorldSave | undefined {
    const u = this.upload; this.upload = undefined;
    return u && now - u.started <= 30_000 && u.blocks.length === u.count ? { ...u.header, blocks: u.blocks } : undefined;
  }
  expire(now: number) { if (this.upload && now - this.upload.started > 30_000) this.upload = undefined; }
}
