/** Keep a brief press in catch-up inputs until an authoritative tick acknowledges it. */
export class ControlPulse {
  private pending = false;
  private firstSequence?: number;
  press() { this.pending = true; }
  value(sequence: number) {
    if (!this.pending) return false;
    this.firstSequence ??= sequence;
    return true;
  }
  acknowledge(sequence: number) { if (this.firstSequence !== undefined && sequence >= this.firstSequence) this.clear(); }
  clear() { this.pending = false; this.firstSequence = undefined; }
}

/** Retain flight-toggle intent until both the press and its release reach the server. */
export class TogglePulse {
  private phase: 'idle' | 'pressed' | 'released' = 'idle';
  private queued = false;
  private firstSequence?: number;
  press() {
    if (this.phase === 'idle') this.phase = 'pressed';
    else this.queued = !this.queued; // Extra pairs cancel; keep only the final intent.
  }
  value(sequence: number) {
    if (this.phase === 'idle') return false;
    this.firstSequence ??= sequence;
    return this.phase === 'pressed';
  }
  acknowledge(sequence: number) {
    if (this.firstSequence === undefined || sequence < this.firstSequence) return;
    this.firstSequence = undefined;
    if (this.phase === 'pressed') this.phase = 'released';
    else { this.phase = this.queued ? 'pressed' : 'idle'; this.queued = false; }
  }
  clear() { this.phase = 'idle'; this.queued = false; this.firstSequence = undefined; }
}
