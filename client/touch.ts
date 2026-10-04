import { PERSPECTIVE_LABELS, type Perspective } from './camera.js';

/** Stable pointer-capture surfaces, separate from the frequently refreshed HUD. */
export class TouchControls {
  x = 0; z = 0; jump = false; jumpQueued = false; descend = false; sprint = false;
  private flightControls = false;
  private root = document.createElement('div');
  private resets: (() => void)[] = [];
  constructor(actions: { aim: (x: number, y: number) => void; attack: (down: boolean) => void; block: (down: boolean) => void; menu: () => void; scores: () => void; perspective: () => void; offhand: () => void }) {
    this.root.className = 'touch-controls'; this.root.hidden = true;
    this.root.innerHTML = '<div class="touch-look" aria-label="Drag to aim"><span>DRAG TO AIM</span></div><div class="touch-stick" aria-label="Movement joystick"><i></i><span>MOVE</span></div><div class="touch-actions"><button class="touch-button touch-sprint" aria-label="Toggle sprint" aria-pressed="false">Sprint</button><button class="touch-button touch-jump" aria-label="Jump">Jump ↑</button><button class="touch-button touch-shield" aria-label="Hold shield">Shield</button><button class="touch-button touch-attack" aria-label="Attack">Attack</button></div><div class="touch-menu"><button class="touch-button touch-offhand" aria-label="Swap left hand to totem">Swap</button><button class="touch-button touch-view" aria-label="Change perspective">View</button><button class="touch-button" aria-label="Open scoreboard">Scores</button><button class="touch-button" aria-label="Open game menu">Menu</button></div>';
    document.body.append(this.root);
    const find = (selector: string) => this.root.querySelector<HTMLElement>(selector)!;
    const capture = (element: HTMLElement, start: (e: PointerEvent) => void, move: (e: PointerEvent) => void, end: () => void) => {
      let id: number | undefined;
      const reset = () => { if (id !== undefined) { const previous = id; id = undefined; if (element.hasPointerCapture(previous)) element.releasePointerCapture(previous); } end(); element.classList.remove('pressed'); };
      this.resets.push(reset);
      element.addEventListener('pointerdown', e => { e.preventDefault(); if (id !== undefined) return; id = e.pointerId; element.setPointerCapture(id); element.classList.add('pressed'); start(e); });
      element.addEventListener('pointermove', e => { if (e.pointerId === id) { e.preventDefault(); move(e); } });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(event, e => { if ((e as PointerEvent).pointerId === id) reset(); });
    };
    const stick = find('.touch-stick'), thumb = stick.querySelector('i')!;
    let cx = 0, cy = 0;
    const moveStick = (e: PointerEvent) => { const dx = e.clientX - cx, dy = e.clientY - cy, length = Math.hypot(dx, dy), radius = 40, scale = Math.min(1, radius / Math.max(1, length)); this.x = Math.abs(dx * scale) < 4 ? 0 : dx * scale / radius; this.z = Math.abs(dy * scale) < 4 ? 0 : -dy * scale / radius; thumb.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`; };
    capture(stick, e => { const box = stick.getBoundingClientRect(); cx = box.left + box.width / 2; cy = box.top + box.height / 2; moveStick(e); }, moveStick, () => { this.x = this.z = 0; thumb.style.transform = ''; });
    let lx = 0, ly = 0;
    capture(find('.touch-look'), e => { lx = e.clientX; ly = e.clientY; }, e => { actions.aim(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY; }, () => {});
    capture(find('.touch-attack'), () => actions.attack(true), () => {}, () => actions.attack(false));
    capture(find('.touch-shield'), () => { if (this.flightControls) this.descend = true; else actions.block(true); }, () => {}, () => { this.descend = false; actions.block(false); });
    capture(find('.touch-jump'), () => { this.jump = this.jumpQueued = true; }, () => {}, () => { this.jump = false; });
    find('.touch-sprint').addEventListener('click', () => { this.sprint = !this.sprint; find('.touch-sprint').setAttribute('aria-pressed', String(this.sprint)); });
    find('.touch-offhand').addEventListener('click', actions.offhand);
    find('.touch-view').addEventListener('click', actions.perspective);
    find('[aria-label="Open game menu"]').addEventListener('click', actions.menu);
    find('[aria-label="Open scoreboard"]').addEventListener('click', actions.scores);
  }
  item(apple: boolean, weaving = false, sculpting = false) { const button = this.root.querySelector('.touch-attack')!; const label = sculpting ? 'Mine' : weaving ? 'Weave' : apple ? 'Eat' : 'Attack'; if (button.textContent !== label) { button.textContent = label; button.setAttribute('aria-label', sculpting ? 'Hold to mine stone' : weaving ? 'Weave rune' : apple ? 'Eat golden apple' : 'Attack'); } }
  offhand(totem: boolean, weaving = false, sculpting = false, flying = false) {
    this.flightControls = flying && !weaving && !sculpting;
    const shield = this.root.querySelector<HTMLButtonElement>('.touch-shield')!;
    shield.disabled = totem && !weaving && !sculpting && !this.flightControls; shield.textContent = this.flightControls ? 'Down ↓' : sculpting ? 'Mend' : weaving ? 'Erase' : 'Shield'; shield.setAttribute('aria-label', this.flightControls ? 'Hold to fly down' : sculpting ? 'Hold to mend an opening' : weaving ? 'Erase woven rune' : totem ? 'Shield unavailable while holding totem' : 'Hold shield');
    const jump = this.root.querySelector<HTMLButtonElement>('.touch-jump')!; jump.textContent = this.flightControls ? 'Up ↑' : 'Jump ↑'; jump.setAttribute('aria-label', this.flightControls ? 'Hold to fly up' : 'Jump');
    this.root.querySelector('.touch-offhand')!.setAttribute('aria-label', `Swap left hand to ${totem ? 'shield' : 'totem'}`);
  }
  perspective(view: Perspective) {
    const button = this.root.querySelector('.touch-view')!, label = PERSPECTIVE_LABELS[view];
    button.textContent = { first: '1st', rear: 'Rear', front: 'Front' }[view];
    button.setAttribute('aria-label', `Change perspective: ${label}`);
    button.setAttribute('aria-description', 'Attacks follow your character’s facing direction');
    button.setAttribute('title', label);
  }
  reset() { for (const reset of this.resets) reset(); this.descend = false; this.jumpQueued = false; this.sprint = false; this.root.querySelector('.touch-sprint')!.setAttribute('aria-pressed', 'false'); }
  show(visible: boolean) { if (this.root.hidden === !visible) return; this.root.hidden = !visible; if (!visible) this.reset(); }
}
