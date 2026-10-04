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
