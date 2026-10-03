import type { Mode } from './game.js';
export interface OpenArena { roomId: string; mode: Mode; host: string; players: number; capacity: number }
