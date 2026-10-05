import { RUNE_KINDS, validKind } from '../shared/construction.js';

// Original three-voice rune cues, reusing the capped synth and spark pool.
// Older protocol-17 events keep their earlier sound and green sparks.
const legacy = { color: '#9affde', hz: 330, end: 660, chime: 990, cutoff: 2000 } as const;
const notes = [
  [220, 330, 660, 1300],
  [294, 441, 882, 1700],
  [587, 880, 1174, 3400],
  [262, 392, 784, 1000],
  [440, 880, 1320, 2600],
  [330, 990, 1485, 3000],
  [392, 588, 1176, 1400],
] as const;
const profiles = notes.map(([hz, end, chime, cutoff], kind) => ({ color: RUNE_KINDS[kind].color, hz, end, chime, cutoff }));
export function weavingFeedback(kind: unknown) { return validKind(kind) ? profiles[kind] : legacy; }
