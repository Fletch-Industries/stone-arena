import { MODES, type Mode } from './game.js';

export const KEEP = { worlds: 128, seconds: 10, messageMs: 2000, bytes: 409_600 } as const;
export interface WorldHandle { id: string; key: string }
export interface KeepSummary { id: string; title: string; seed: number; mode: Mode; savedAt: number; runes: number; openings: number }
export interface KeepStatus { state: 'disabled' | 'off' | 'saving' | 'saved' | 'error' | 'full'; handle?: WorldHandle; summary?: KeepSummary }
export function validHandle(value: unknown): value is WorldHandle {
  if (!value || typeof value !== 'object') return false;
  const h = value as WorldHandle;
  return typeof h.id === 'string' && /^[a-f0-9]{32}$/.test(h.id) && typeof h.key === 'string' && /^[a-f0-9]{64}$/.test(h.key);
}
export function validKeepSummary(value: unknown): value is KeepSummary {
  if (!value || typeof value !== 'object') return false;
  const s = value as KeepSummary;
  return typeof s.id === 'string' && /^[a-f0-9]{32}$/.test(s.id) && typeof s.title === 'string' && s.title.length > 0 && s.title.length <= 32 && !/[\u0000-\u001f<>]/.test(s.title) && Number.isInteger(s.seed) && s.seed >= 0 && s.seed <= 0xffffffff && typeof s.mode === 'string' && Object.hasOwn(MODES, s.mode) && Number.isSafeInteger(s.savedAt) && s.savedAt > 0 && Number.isInteger(s.runes) && s.runes >= 0 && s.runes <= 4096 && Number.isInteger(s.openings) && s.openings >= 0 && s.openings <= 8192;
}
