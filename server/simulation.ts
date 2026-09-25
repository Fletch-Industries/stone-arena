import { MELEE, attackStrength, meleeRecovery, knockback, DT, EYE, HEIGHT, SPAWNS, direction, idleInput, move, segmentBox, wallHit, type Arrow, type GameEvent, type Input, type Player, type Snapshot, type Phase } from '../shared/game.js';

export class Simulation {
  departed = new Set<string>();
  players = new Map<string, Player>(); inputs = new Map<string, Input>();
  attackPress = new Set<string>(); attackRelease = new Set<string>();
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
    const p: Player = { id, name, color, x: 0, y: 0, z: 0, vy: 0, grounded: true, yaw: 0, pitch: 0, hp: 100, alive: true, connected: true, ready: false, weapon: 'sword', block: false, ammo: 20, kills: 0, damage: 0, assists: 0, wins: 0, ack: 0, cooldown: 0, charge: 0, loaded: false, shieldDisabled: 0, hurtTime: 0, lastDamage: 0, shieldRaise: 0, swingWait: 0, moveSpeed: 0, vx: 0, vz: 0, sprinting: false, sprintLocked: false, eliminatedAt: 0 };
    this.players.set(id, p); this.inputs.set(id, idleInput()); if (!this.host) this.host = id; this.positionPlayers(); return p;
  }
  positionPlayers() { let n = 0; for (const p of this.players.values()) { const s = SPAWNS[(n++ + this.round * 2) % SPAWNS.length]; p.x = s[0]; p.z = s[1]; p.y = 0; p.vy = 0; p.vx = p.vz = 0; p.grounded = true; p.sprinting = p.sprintLocked = false; p.yaw = Math.atan2(p.x, p.z); } }
  event(e: Omit<GameEvent, 'id'>) { this.events.push({ ...e, id: ++this.nextEvent }); this.events = this.events.slice(-24); }
  input(id: string, i: Input) { const p = this.players.get(id); if (p && i.seq > p.ack && i.seq > (this.inputs.get(id)?.seq ?? -1)) { const previous = this.inputs.get(id); if (i.attack && !previous?.attack) this.attackPress.add(id); if (!i.attack && previous?.attack) this.attackRelease.add(id); this.inputs.set(id, i); this.lastInput.set(id, this.tick); } }
  start(id: string, practice = false) {
    const ps = [...this.players.values()];
    if (id !== this.host || this.phase !== 'waiting' || !ps.every(p => p.connected && p.ready) || (practice ? ps.length !== 1 : ps.length < 2)) return false;
    this.practice = practice; this.round++; this.phase = 'countdown'; this.countdown = 5; this.result = ''; this.winner = ''; this.arrows = []; this.events = []; this.damageHistory.clear();
    for (const p of ps) { Object.assign(p, { hp: 100, alive: true, weapon: 'sword', block: false, ammo: 20, kills: 0, damage: 0, assists: 0, cooldown: 0, charge: 0, loaded: false, shieldDisabled: 0, hurtTime: 0, lastDamage: 0, shieldRaise: 0, swingWait: 0, moveSpeed: 0, vx: 0, vz: 0, sprinting: false, sprintLocked: false, eliminatedAt: 0, ack: 0 }); this.inputs.set(p.id, idleInput()); this.lastAttack.set(p.id, false); }
    this.history = []; this.attackPress.clear(); this.attackRelease.clear(); this.positionPlayers(); return true;
  }
  disconnect(id: string) { const p = this.players.get(id); if (p) { p.connected = false; p.ready = false; this.inputs.set(id, idleInput()); this.lastAttack.set(id, false); } this.transferHost(); }
  transferHost() { if (!this.players.get(this.host)?.connected) this.host = [...this.players.values()].find(p => p.connected)?.id ?? ''; }
  removePlayer(id: string) {
    this.departed.delete(id); this.players.delete(id); this.inputs.delete(id); this.lastInput.delete(id); this.lastAttack.delete(id);
    this.attackPress.delete(id); this.attackRelease.delete(id); this.rewindTicks.delete(id); this.damageHistory.delete(id);
    for (const damage of this.damageHistory.values()) damage.delete(id);
  }
  leave(id: string) {
    const p = this.players.get(id); if (!p) return;
    if (this.phase === 'active' && p.alive) {
      const recent = [...(this.damageHistory.get(id) ?? [])].filter(([, at]) => this.tick - at <= 300).sort((a, b) => b[1] - a[1])[0];
      const actor = recent && this.players.get(recent[0]);
      if (actor) this.damage(p, actor, 1000, false, { force: true }); else { p.hp = 0; p.alive = false; p.eliminatedAt = this.tick; this.event({ type: 'kill', target: id, text: `${p.name} forfeited` }); }
    }
    p.connected = false; p.ready = false; this.departed.add(id);
    if (this.phase === 'waiting' || this.phase === 'countdown') this.removePlayer(id);
    this.transferHost(); this.checkWinner();
  }
  lobby(id: string) {
    if (id !== this.host || (this.phase !== 'results' && !this.practice)) return;
    if (this.phase === 'results' && this.tick - this.resultTime < 180) return;
    this.phase = 'waiting'; this.practice = false; this.arrows = [];
    for (const [key, p] of this.players) { if (this.departed.has(key)) this.removePlayer(key); else { p.ready = false; p.alive = true; p.hp = 100; p.hurtTime = 0; p.block = false; p.shieldRaise = 0; p.moveSpeed = 0; } }
    this.positionPlayers();
  }
  checkWinner() {
    if (this.phase !== 'active' || this.practice) return;
    const alive = [...this.players.values()].filter(p => p.alive);
    if (alive.length <= 1) { this.phase = 'results'; this.resultTime = this.tick; this.winner = alive[0]?.id ?? ''; this.result = alive[0] ? `${alive[0].name} wins` : 'Draw — no survivors'; if (alive[0]) alive[0].wins++; this.event({ type: 'result', actor: this.winner, text: this.result }); this.arrows = []; }
  }
  damage(target: Player, actor: Player, amount: number, axe = false, hit: { strength?: number; critical?: boolean; sprintHit?: boolean; sweep?: boolean; projectile?: boolean; source?: { x: number; z: number }; force?: boolean } = {}) {
    if (!target.alive) return false;
    const source = hit.source ?? actor, facing = direction(target.yaw);
    const dx = source.x - target.x, dz = source.z - target.z;
    const blocked = !hit.force && target.block && target.shieldDisabled <= 0 && target.shieldRaise >= .25 && facing.x * dx + facing.z * dz > 0;
    if (blocked) {
      // Modern Java weapon component: axes disable a successfully blocked shield.
      if (axe) { target.shieldDisabled = 5; target.block = false; target.shieldRaise = 0; }
      if (!hit.projectile) knockback(actor, dx, dz, 10);
      this.event({ type: 'hit', actor: actor.id, target: target.id, blocked: true }); return false;
    }
    const original = amount, immune = !hit.force && target.hurtTime > 0;
    if (immune) { if (amount <= target.lastDamage) return false; amount -= target.lastDamage; }
    else if (!hit.force) target.hurtTime = .5;
    target.lastDamage = original;
    amount = Math.min(target.hp, amount); target.hp = Math.max(0, target.hp - amount); actor.damage += amount;
    if (!immune && !hit.force) knockback(target, -dx, -dz, hit.strength ?? 8);
    const history = this.damageHistory.get(target.id) ?? new Map<string, number>(); history.set(actor.id, this.tick); this.damageHistory.set(target.id, history);
    this.event({ type: 'hit', actor: actor.id, target: target.id, blocked: false, critical: hit.critical, sprintHit: hit.sprintHit, sweep: hit.sweep });
    if (target.hp <= 0) { target.alive = false; target.block = false; target.eliminatedAt = this.tick; actor.kills++; for (const [id, at] of history) if (id !== actor.id && this.tick - at <= 300) { const assister = this.players.get(id); if (assister) assister.assists++; } this.event({ type: 'kill', actor: actor.id, target: target.id, text: `${actor.name} eliminated ${target.name}` }); }
    return true;
  }
  random = Math.random;
  melee(p: Player, pose: Player = p) {
    const strength = attackStrength(pose), strong = strength > .9;
    const sprintHit = strong && !!pose.sprinting;
    const critical = strong && !pose.grounded && pose.vy < 0 && !pose.sprinting;
    const sweep = strong && p.weapon === 'sword' && pose.grounded && !pose.sprinting && pose.moveSpeed <= 4.317 + .01;
    const d = direction(p.yaw, p.pitch), reach = 3;
    const a = { x: p.x, y: p.y + EYE, z: p.z }, b = { x: a.x + d.x * reach, y: a.y + d.y * reach, z: a.z + d.z * reach };
    let nearest = wallHit(a, b), target: Player | undefined;
    const rewind = Math.min(6, Math.max(0, this.rewindTicks.get(p.id) ?? 0));
    const past = rewind > 0 ? this.history.find(h => h.tick >= this.tick - rewind) : undefined;
    for (const q of this.players.values()) if (q.id !== p.id && q.alive) { const pose = past?.players.get(q.id) ?? q; const t = segmentBox(a, b, [pose.x - .3, pose.y, pose.z - .3], [pose.x + .3, pose.y + HEIGHT, pose.z + .3]); if (t < nearest) { nearest = t; target = q; } }
    if (target) {
      const amount = (p.weapon === 'axe' ? MELEE.axe.damage : MELEE.sword.damage) * (.2 + .8 * strength * strength) * (critical ? 1.5 : 1);
      const landed = this.damage(target, p, amount, p.weapon === 'axe', { strength: sprintHit ? 18 : 8, critical, sprintHit });
      if (landed && sweep) for (const q of this.players.values()) {
        if (q.id === p.id || q.id === target.id || !q.alive || Math.hypot(q.x - p.x, q.z - p.z) >= 3 || Math.abs(q.y - target.y) > .5 || Math.abs(q.x - target.x) > 1.3 || Math.abs(q.z - target.z) > 1.3) continue;
        if (!Number.isFinite(wallHit(a, { x: q.x, y: q.y + 1, z: q.z }))) this.damage(q, p, 5, false, { strength: 8, sweep: true });
      }
      if (sprintHit) { p.sprinting = false; p.sprintLocked = true; p.vx = (p.vx ?? 0) * .6; p.vz = (p.vz ?? 0) * .6; }
    }
    this.event({ type: 'swing', actor: p.id, critical, sprintHit, sweep: !!target && sweep });
    p.cooldown = meleeRecovery(p.weapon); p.swingWait = .1;
  }
  shoot(p: Player, charge: number) {
    if (p.ammo <= 0 || this.arrows.length >= 60) return;
    const power = Math.min(1, (charge * charge + 2 * charge) / 3);
    if (p.weapon === 'bow' && power < .1) return;
    const d = direction(p.yaw, p.pitch), speed = p.weapon === 'crossbow' ? 63 : 60 * power;
    this.arrows.push({ id: ++this.nextArrow, owner: p.id, x: p.x, y: p.y + EYE, z: p.z, vx: d.x * speed, vy: d.y * speed, vz: d.z * speed, age: 0, damage: Math.ceil(speed / 20 * 2) * 5, critical: p.weapon === 'crossbow' || power === 1 }); p.ammo--; p.cooldown = .25; this.event({ type: 'shot', actor: p.id });
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
      if (i.weapon !== p.weapon) { p.weapon = i.weapon; p.charge = 0; p.cooldown = p.weapon === 'sword' || p.weapon === 'axe' ? Math.max(p.cooldown, meleeRecovery(p.weapon)) : 0; }
      p.hurtTime = Math.max(0, p.hurtTime - DT); p.swingWait = Math.max(0, p.swingWait - DT);
      p.cooldown = Math.max(0, p.cooldown - DT); p.shieldDisabled = Math.max(0, p.shieldDisabled - DT);
      p.block = i.block && p.shieldDisabled <= 0;
      p.shieldRaise = p.block ? Math.min(.25, p.shieldRaise + DT) : 0;
      const oldX = p.x, oldZ = p.z;
      move(p, { ...i, block: p.block }, DT, p.charge > 0);
      p.moveSpeed = Math.hypot(p.x - oldX, p.z - oldZ) / DT;
      const pressed = !stale && (this.attackPress.has(p.id) || (i.attack && !this.lastAttack.get(p.id))), released = this.attackRelease.has(p.id) || (!i.attack && !!this.lastAttack.get(p.id));
      if (i.block) p.charge = 0;
      else if (p.weapon === 'bow') {
        if (i.attack && p.cooldown <= 0 && p.ammo > 0) p.charge = Math.min(1, p.charge + DT);
        if (released) { if (p.charge >= .14 && !stale) { const amount = p.charge; attacks.push(() => this.shoot(p, amount)); } p.charge = 0; }
      } else if (p.weapon === 'crossbow') {
        if (p.charge > 0) { p.charge += DT; if (p.charge >= 1.25) { p.loaded = true; p.charge = 0; } }
        if (pressed && p.cooldown <= 0 && p.ammo > 0) { if (p.loaded) { attacks.push(() => this.shoot(p, 1)); p.loaded = false; } else if (p.charge === 0) p.charge = DT; }
      } else if ((pressed || (i.attack && p.cooldown <= 0)) && p.swingWait <= 0) { const attackPose = { ...p }; attacks.push(() => this.melee(p, attackPose)); }
      this.lastAttack.set(p.id, i.attack);
    }
    this.attackPress.clear(); this.attackRelease.clear();
    for (const attack of attacks) attack();
    this.arrows = this.arrows.filter(a => {
      a.age += DT; const old = { x: a.x, y: a.y, z: a.z }; a.x += a.vx * DT; a.y += a.vy * DT; a.z += a.vz * DT; const drag = Math.pow(.99, DT * 20); a.vx *= drag; a.vz *= drag; a.vy = a.vy * drag - 20 * DT;
      let nearest = wallHit(old, a), target: Player | undefined;
      for (const p of this.players.values()) if (p.id !== a.owner && p.alive) { const t = segmentBox(old, a, [p.x - .38, p.y, p.z - .38], [p.x + .38, p.y + HEIGHT, p.z + .38]); if (t < nearest) { nearest = t; target = p; } }
      const owner = this.players.get(a.owner);
      if (target && owner) {
        const base = Math.ceil(Math.hypot(a.vx, a.vy, a.vz) / 20 * 2);
        const amount = (base + (a.critical ? Math.floor(this.random() * (Math.floor(base / 2) + 2)) : 0)) * 5;
        this.damage(target, owner, amount, false, { projectile: true, source: old, critical: a.critical });
      }
      return !Number.isFinite(nearest) && a.age < 4 && a.y > 0 && Math.abs(a.x) < 16 && Math.abs(a.z) < 16;
    });
    this.checkWinner();
  }
  snapshot(): Snapshot { return { tick: this.tick, phase: this.phase, countdown: this.countdown, result: this.result, winner: this.winner, round: this.round, host: this.host, practice: this.practice, players: [...this.players.values()].map(p => ({ ...p })), arrows: this.arrows.map(a => ({ ...a })), events: this.events }; }
}
