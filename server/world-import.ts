import { BUILD } from '../shared/construction.js';
import { validSaveHeader, type SavedRune, type WorldSave, type WorldSaveHeader } from '../shared/world-save.js';
import { SCULPT, type StoneCell } from '../shared/excavation.js';

/** Small upload packets keep the existing 4KiB inbound WebSocket limit intact. */
export class WorldImport {
  private upload?: { header: WorldSaveHeader; count: number; cutsCount: number; veinsCount: number; blocks: SavedRune[]; cuts: StoneCell[]; veins: StoneCell[]; started: number };
  begin(header: unknown, count: unknown, now: number, cutsCount: unknown = 0, veinsCount: unknown = 0) {
    this.upload = undefined;
    if (!validSaveHeader(header) || !Number.isInteger(count) || (count as number) < 0 || (count as number) > BUILD.roomLimit || !Number.isInteger(cutsCount) || (cutsCount as number) < 0 || (cutsCount as number) > SCULPT.roomLimit || !Number.isInteger(veinsCount) || (veinsCount as number) < 0 || (veinsCount as number) > SCULPT.veinLimit || header.version < 4 && (cutsCount !== 0 || veinsCount !== 0)) return false;
    this.upload = { header: { format: header.format, version: header.version, title: header.title, seed: header.seed, doorOpen: header.doorOpen, waystones: header.waystones, supplies: header.supplies ? [...header.supplies] : undefined, upgrades: header.upgrades, bonds: header.bonds, guardians: header.guardians }, count: count as number, cutsCount: cutsCount as number, veinsCount: veinsCount as number, blocks: [], cuts: [], veins: [], started: now }; return true;
  }
  chunk(offset: unknown, blocks: unknown, now: number, kind: unknown = 'blocks') {
    const u = this.upload;
    const list = u && (kind === 'blocks' ? u.blocks : kind === 'cuts' ? u.cuts : kind === 'veins' ? u.veins : undefined), count = u && (kind === 'blocks' ? u.count : kind === 'cuts' ? u.cutsCount : u.veinsCount);
    if (!u || !list || now - u.started > 30_000 || offset !== list.length || !Array.isArray(blocks) || !blocks.length || blocks.length > 64 || list.length + blocks.length > count! || !blocks.every(row => Array.isArray(row) && row.length === (kind === 'blocks' ? 4 : 3) && row.every(Number.isInteger))) { this.upload = undefined; return false; }
    if (kind === 'blocks') u.blocks.push(...blocks.map(row => [...row] as SavedRune));
    else if (kind === 'cuts') u.cuts.push(...blocks.map(row => [...row] as StoneCell));
    else u.veins.push(...blocks.map(row => [...row] as StoneCell)); return true;
  }
  finish(now: number): WorldSave | undefined {
    const u = this.upload; this.upload = undefined;
    return u && now - u.started <= 30_000 && u.blocks.length === u.count && u.cuts.length === u.cutsCount && u.veins.length === u.veinsCount ? { ...u.header, blocks: u.blocks, ...(u.header.version === 4 ? { cuts: u.cuts, veins: u.veins } : {}) } : undefined;
  }
  expire(now: number) { if (this.upload && now - this.upload.started > 30_000) this.upload = undefined; }
}
