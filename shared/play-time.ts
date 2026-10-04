export const PLAY_TIME = { playSeconds: 15 * 60, breakSeconds: 30 * 60 } as const;
export interface PlayTimeStatus { playSeconds: number; breakSeconds: number; remainingSeconds: number; retryAfterSeconds: number }
export function breakMessage(seconds: number) { return `Break time. Play again in ${Math.ceil(seconds / 60)} minutes.`; }
