import { SUPPLIES } from '../shared/forage.js';

// Original three-voice cues: two tones and one short noise envelope per pickup.
// Missing metadata retains the earlier sound/color for protocol-17 events.
const legacy = {
  color: '#9affde',
  tones: [[440, .2, 0, 'triangle', 880], [1174, .35, .08, 'sine', 1174]],
  noise: [.08, 2600],
} as const;
const profiles = [
  { ...legacy, color: SUPPLIES[0].color },
  { color: SUPPLIES[1].color, tones: [[740, .18, 0, 'sine', 1480], [1110, .3, .065, 'sine', 1665]], noise: [.045, 4100] },
  { color: SUPPLIES[2].color, tones: [[330, .24, 0, 'triangle', 495], [660, .3, .1, 'sine', 440]], noise: [.12, 900] },
] as const;

export function gatheringFeedback(kind: unknown) {
  return typeof kind === 'number' && Number.isInteger(kind) && kind >= 0 && kind < profiles.length ? profiles[kind] : legacy;
}
