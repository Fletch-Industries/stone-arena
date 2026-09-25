import { BOXES, DT, EYE, HEIGHT, SPAWNS, direction, idleInput, move, segmentBox, wallHit, type Arrow, type GameEvent, type Input, type Player, type Snapshot, type Phase } from '../shared/game.js';

export class Simulation {
  players = new Map<string, Player>(); inputs = new Map<string, Input>();
  lastInput = new Map<string, number>(); lastAttack = new Map<string, boolean>();
  damageHistory = new Map<string, Map<string, number>>();
  arrows: Arrow[] = []; events: GameEvent[] = []; phase: Phase = 'waiting';
  tick = 0; round = 0; countdown = 0; result = ''; winner = ''; host = ''; practice = false;
  nextEvent = 0; nextArrow = 0; resultTime = 0;
  rewindTicks = new Map<string, number>(); history: { tick: number; players: Map<string, { x: number; y: number; z: number }> }[] = [];
  add(id: string, name: string) {
    if (this.players.size >= 5 || this.phase !== 'waiting') throw new Error('Room full or round in progress.');
    const colors = new Set([...this.players.values()].map(p => p.color));
    const color = [0, 1, 2, 3, 4].find(c => !colors.has(c))!;
    const p: Player = { id, name, color, x: 0, y: 0, z: 0, vy: 0, grounded: true, yaw: 0, pitch: 0, hp: 100, alive: true, connected: true, ready: false, weapon: 'sword', block: false, ammo: 20, kills: 0, damage: 0, assists: 0, wins: 0, ack: 0, cooldown: 0, charge: 0, loaded: false, shieldDisabled: 0, eliminatedAt: 0 };
    this.players.set(id, p); this.inputs.set(id, idleInput()); if (!this.host) this.host = id; this.positionPlayers(); return p;
  }
  positionPlayers() { let n = 0; for (const p of this.players.values()) { const s = SPAWNS[(n++ + this.round * 2) % SPAWNS.length]; p.x = s[0]; p.z = s[1]; p.y = 0; p.vy = 0; p.yaw = Math.atan2(p.x, p.z); } }
  event(e: Omit<GameEvent, 'id'>) { this.events.push({ ...e, id: ++this.nextEvent }); this.events = this.events.slice(-24); }
  input(id: string, i: Input) { const p = this.players.get(id); if (p && i.seq > p.ack && i.seq > (this.inputs.get(id)?.seq ?? -1)) { this.inputs.set(id, i); this.lastInput.set(id, this.tick); } }
  start(id: string, practice = false) {
    const ps = [...this.players.values()];
    if (id !== this.host || this.phase !== 'waiting' || !ps.every(p => p.connected && p.ready) || (practice ? ps.length !== 1 : ps.length < 2)) return false;
    this.practice = practice; this.round++; this.phase = 'countdown'; this.countdown = 5; this.result = ''; this.winner = ''; this.arrows = []; this.events = []; this.damageHistory.clear();
    for (const p of ps) { Object.assign(p, { hp: 100, alive: true, weapon: 'sword', block: false, ammo: 20, kills: 0, damage: 0, assists: 0, cooldown: 0, charge: 0, loaded: false, shieldDisabled: 0, eliminatedAt: 0, ack: 0 }); this.inputs.set(p.id, idleInput()); this.lastAttack.set(p.id, false); }
    this.history = []; this.positionPlayers(); return true;
  }
  disconnect(id: string) { const p = this.players.get(id); if (p) { p.connected = false; p.ready = false; this.inputs.set(id, idleInput()); this.lastAttack.set(id, false); } this.transferHost(); }
  transferHost() { if (!this.players.get(this.host)?.connected) this.host = [...this.players.values()].find(p => p.connected)?.id ?? ''; }
  leave(id: string) {
    const p = this.players.get(id); if (!p) return;
    if (this.phase === 'active' && p.alive) {
      const recent = [...(this.damageHistory.get(id) ?? [])].filter(([, at]) => this.tick - at <= 300).sort((a, b) => b[1] - a[1])[0];
      const actor = recent && this.players.get(recent[0]);
      if (actor) this.damage(p, actor, 1000); else { p.hp = 0; p.alive = false; p.eliminatedAt = this.tick; this.event({ type: 'kill', target: id, text: `${p.name} forfeited` }); }
    }
    p.connected = false; p.ready = false;
    if (this.phase === 'waiting' || this.phase === 'countdown') { this.players.delete(id); this.inputs.delete(id); }
    this.transferHost(); this.checkWinner();
  }
  lobby(id: string) {
    if (id !== this.host || (this.phase !== 'results' && !this.practice)) return;
    if (this.phase === 'results' && this.tick - this.resultTime < 180) return;
    this.phase = 'waiting'; this.practice = false; this.arrows = [];
    for (const [key, p] of this.players) { if (!p.connected) { this.players.delete(key); this.inputs.delete(key); } else { p.ready = false; p.alive = true; p.hp = 100; } }
    this.positionPlayers();
  }
  checkWinner() {
    if (this.phase !== 'active' || this.practice) return;
    const alive = [...this.players.values()].filter(p => p.alive);
    if (alive.length <= 1) { this.phase = 'results'; this.resultTime = this.tick; this.winner = alive[0]?.id ?? ''; this.result = alive[0] ? `${alive[0].name} wins` : 'Draw — no survivors'; if (alive[0]) alive[0].wins++; this.event({ type: 'result', actor: this.winner, text: this.result }); this.arrows = []; }
  }
  damage(target: Player, actor: Player, amount: number, axe = false) {
    if (!target.alive) return;
    const facing = direction(target.yaw); const dx = actor.x - target.x, dz = actor.z - target.z;
    const front = (facing.x * dx + facing.z * dz) / Math.max(.01, Math.hypot(dx, dz)) > .5;
    const blocked = target.block && target.shieldDisabled <= 0 && front;
    if (blocked) { amount *= .25; if (axe) target.shieldDisabled = .8; }
    amount = Math.min(target.hp, amount); target.hp = Math.max(0, target.hp - amount); actor.damage += amount;
    const history = this.damageHistory.get(target.id) ?? new Map<string, number>(); history.set(actor.id, this.tick); this.damageHistory.set(target.id, history);
    this.event({ type: 'hit', actor: actor.id, target: target.id, blocked });
    if (target.hp <= 0) { target.alive = false; target.block = false; target.eliminatedAt = this.tick; actor.kills++; for (const [id, at] of history) if (id !== actor.id && this.tick - at <= 300) { const assister = this.players.get(id); if (assister) assister.assists++; } this.event({ type: 'kill', actor: actor.id, target: target.id, text: `${actor.name} eliminated ${target.name}` }); }
  }
  melee(p: Player) {
    const d = direction(p.yaw, p.pitch), reach = p.weapon === 'axe' ? 2.8 : 3;
    const a = { x: p.x, y: p.y + EYE, z: p.z }, b = { x: a.x + d.x * reach, y: a.y + d.y * reach, z: a.z + d.z * reach };
    let nearest = wallHit(a, b), target: Player | undefined;
    const rewind = Math.min(6, Math.max(0, this.rewindTicks.get(p.id) ?? 0));
    const past = rewind > 0 ? this.history.find(h => h.tick >= this.tick - rewind) : undefined;
    for (const q of this.players.values()) if (q.id !== p.id && q.alive) { const pose = past?.players.get(q.id) ?? q; const t = segmentBox(a, b, [pose.x - .52, pose.y, pose.z - .52], [pose.x + .52, pose.y + HEIGHT, pose.z + .52]); if (t < nearest) { nearest = t; target = q; } }
    if (target) this.damage(target, p, p.weapon === 'axe' ? 40 : 25, p.weapon === 'axe');
    this.event({ type: 'swing', actor: p.id }); p.cooldown = p.weapon === 'axe' ? .95 : .55;
  }
  shoot(p: Player, charge: number) {
    if (p.ammo <= 0 || this.arrows.length >= 60) return;
    const d = direction(p.yaw, p.pitch), speed = p.weapon === 'crossbow' ? 32 : 14 + charge * 11;
    this.arrows.push({ id: ++this.nextArrow, owner: p.id, x: p.x, y: p.y + EYE, z: p.z, vx: d.x * speed, vy: d.y * speed, vz: d.z * speed, age: 0, damage: p.weapon === 'crossbow' ? 35 : 15 + charge * 25 }); p.ammo--; p.cooldown = .25; this.event({ type: 'shot', actor: p.id });
  }
  step() {
    this.tick++;
    if (this.phase === 'countdown') {
      if ([...this.players.values()].some(p => !p.connected) || this.players.size < (this.practice ? 1 : 2)) { this.phase = 'waiting'; return; }
      this.countdown = Math.max(0, this.countdown - DT);
      if (this.countdown <= .001) { this.phase = 'active'; this.event({ type: 'start' }); }
      return;
    }
    if (this.phase !== 'active') return;
    this.history.push({ tick: this.tick, players: new Map([...this.players].map(([id, p]) => [id, { x: p.x, y: p.y, z: p.z }])) });
    if (this.history.length > 8) this.history.shift();
    // Gather attacks before resolving them so attacks initiated in one tick are simultaneous.
    const attacks: (() => void)[] = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const stale = this.tick - (this.lastInput.get(p.id) ?? -1000) > 15 || !p.connected;
      const i = stale ? { ...idleInput(), yaw: p.yaw, pitch: p.pitch, weapon: p.weapon } : this.inputs.get(p.id)!;
      p.ack = Math.max(p.ack, i.seq); p.yaw = i.yaw; p.pitch = i.pitch;
      if (i.weapon !== p.weapon) { p.weapon = i.weapon; p.charge = 0; }
      p.cooldown = Math.max(0, p.cooldown - DT); p.shieldDisabled = Math.max(0, p.shieldDisabled - DT);
      p.block = i.block && p.shieldDisabled <= 0;
      move(p, { ...i, block: p.block }, DT, p.charge > 0);
      const pressed = i.attack && !this.lastAttack.get(p.id), released = !i.attack && !!this.lastAttack.get(p.id);
      if (i.block) p.charge = 0;
      else if (p.weapon === 'bow') {
        if (i.attack && p.cooldown <= 0 && p.ammo > 0) p.charge = Math.min(1, p.charge + DT);
        if (released) { if (p.charge >= .2 && !stale) { const amount = p.charge; attacks.push(() => this.shoot(p, amount)); } p.charge = 0; }
      } else if (p.weapon === 'crossbow') {
        if (p.charge > 0) { p.charge += DT; if (p.charge >= 1.2) { p.loaded = true; p.charge = 0; } }
        if (pressed && p.cooldown <= 0 && p.ammo > 0) { if (p.loaded) { attacks.push(() => this.shoot(p, 1)); p.loaded = false; } else if (p.charge === 0) p.charge = DT; }
      } else if (i.attack && p.cooldown <= 0) attacks.push(() => this.melee(p));
      this.lastAttack.set(p.id, i.attack);
    }
    for (const attack of attacks) attack();
    this.arrows = this.arrows.filter(a => {
      a.age += DT; const old = { x: a.x, y: a.y, z: a.z }; a.x += a.vx * DT; a.y += a.vy * DT; a.z += a.vz * DT; a.vy -= 8 * DT;
      let nearest = wallHit(old, a), target: Player | undefined;
      for (const p of this.players.values()) if (p.id !== a.owner && p.alive) { const t = segmentBox(old, a, [p.x - .38, p.y, p.z - .38], [p.x + .38, p.y + HEIGHT, p.z + .38]); if (t < nearest) { nearest = t; target = p; } }
      const owner = this.players.get(a.owner); if (target && owner) this.damage(target, owner, a.damage);
      return !Number.isFinite(nearest) && a.age < 4 && a.y > 0 && Math.abs(a.x) < 16 && Math.abs(a.z) < 16;
    });
    this.checkWinner();
  }
  snapshot(): Snapshot { return { tick: this.tick, phase: this.phase, countdown: this.countdown, result: this.result, winner: this.winner, round: this.round, host: this.host, practice: this.practice, players: [...this.players.values()].map(p => ({ ...p })), arrows: this.arrows.map(a => ({ ...a })), events: this.events }; }
}
