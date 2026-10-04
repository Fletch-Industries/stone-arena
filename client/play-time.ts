import { type PlayTimeStatus } from '../shared/play-time.js';
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
/** Separate DOM nodes keep the countdown from replacing held game controls. */
export class PlayTimeDisplay {
  private badge = document.createElement('div');
  private overlay = document.createElement('section');
  private countdown: HTMLElement;
  private remainingAt = 0;
  private retryAt = 0;
  private received = false;
  constructor(private inRoom: () => boolean) {
    this.badge.className = 'play-time-badge'; this.badge.setAttribute('role', 'timer'); this.badge.setAttribute('aria-live', 'off');
    this.overlay.className = 'play-break interactive'; this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog'); this.overlay.setAttribute('aria-modal', 'true'); this.overlay.setAttribute('aria-labelledby', 'play-break-title');
    this.overlay.innerHTML = '<div class="panel"><h2 id="play-break-title">Time for a break</h2><p>You’ve reached 15 minutes of play on this network. Take a 30-minute break, then come back.</p><p class="play-break-countdown" role="timer" aria-live="off"></p><p class="help">The timer is shared by everyone using the same public IP. Leaving early saves your remaining time; 30 minutes with nobody playing resets it. Your saved Creative world stays available.</p><button class="btn gold wide" type="button">Check again</button></div>';
    this.countdown = this.overlay.querySelector('.play-break-countdown')!;
    document.body.append(this.badge, this.overlay);
    setInterval(() => this.draw(), 1000);
  }
  onCheck(check: () => void) { this.overlay.querySelector('button')!.addEventListener('click', check); }
  get blocked() { return this.retryAt > Date.now(); }
  update(status: PlayTimeStatus) {
    if (!status || ![status.playSeconds, status.breakSeconds, status.remainingSeconds, status.retryAfterSeconds].every(v => Number.isFinite(v) && v >= 0)) return;
    this.received = true; this.remainingAt = Date.now() + status.remainingSeconds * 1000; this.retryAt = status.retryAfterSeconds ? Date.now() + status.retryAfterSeconds * 1000 : 0; this.draw();
  }
  private draw() {
    const blocked = this.blocked, wasHidden = this.overlay.hidden;
    this.overlay.hidden = !blocked;
    this.badge.hidden = blocked || !this.inRoom() || !this.received;
    this.badge.textContent = `${time(Math.max(0, Math.ceil((this.remainingAt - Date.now()) / 1000)))} play left · 30 min break`;
    this.countdown.textContent = `Come back in ${time(Math.max(0, Math.ceil((this.retryAt - Date.now()) / 1000)))}`;
    if (blocked && wasHidden) this.overlay.querySelector('button')!.focus();
  }
}
