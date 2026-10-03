import { CTF, TEAMS, LIMIT, type Mode, type Team, type Flag, APPLE, TOTEM, ARMOR_TIERS, armorTier, MELEE, attackStrength, meleeRecovery, knockback, DT, EYE, HEIGHT, SPAWNS, direction, idleInput, move, segmentBox, wallHit, type Arrow, type GameEvent, type Input, type Player, type Snapshot, type Phase } from '../shared/game.js';

export class Simulation {
  mode: Mode = 'ffa'; winnerTeam: Team | '' = ''; scores = { red: 0, blue: 0 };
  flags: Flag[] = this.homeFlags();
  homeFlags(): Flag[] { return (['red', 'blue'] as Team[]).map(team => ({ team, state: 'home', x: TEAMS[team].x, z: TEAMS[team].z, y: 0, carrier: '', returnAt: 0 })); }
  resetFlags() { this.flags = this.homeFlags(); this.scores = { red: 0, blue: 0 }; this.winnerTeam = ''; }
  teammates(a: Player, b: Player) { return this.mode !== 'ffa' && a.team === b.team; }
  balanced() { const ps = [...this.players.values()]; const red = ps.filter(p => p.team === 'red').length; return red > 0 && red < ps.length && Math.abs(red - (ps.length - red)) <= 1; }
  selectMode(id: string, value: unknown) {
    if (id !== this.host || this.phase !== 'waiting' || !['ffa', 'teams', 'ctf'].includes(value as string)) return false;
    this.mode = value as Mode; this.resetFlags(); for (const p of this.players.values()) p.ready = false; this.positionPlayers(); return true;
  }
  selectTeam(id: string, value: unknown) {
    const p = this.players.get(id);
    if (!p?.connected || this.phase !== 'waiting' || this.mode === 'ffa' || !['red', 'blue'].includes(value as string)) return false;
    if ([...this.players.values()].filter(q => q.id !== id && q.team === value).length >= 3) return false;
    p.team = value as Team; for (const q of this.players.values()) q.ready = false; this.positionPlayers(); return true;
  }
  departed = new Set<string>();
  combatXp: Map<string, number> | undefined;
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
    const red = [...this.players.values()].filter(p => p.team === 'red').length;
    const team: Team = red <= this.players.size - red ? 'red' : 'blue';
    const p: Player = { team, respawnAt: 0, immuneUntil: 0, captures: 0, flagReturns: 0, id, name, color, x: 0, y: 0, z: 0, vy: 0, grounded: true, yaw: 0, pitch: 0, hp: 100, xp: 0, alive: true, connected: true, ready: false, weapon: 'sword', offhand: 'shield', block: false, ammo: 20, apples: APPLE.count, totems: TOTEM.count, kills: 0, damage: 0, assists: 0, wins: 0, ack: 0, cooldown: 0, charge: 0, loaded: false, shieldDisabled: 0, hurtTime: 0, lastDamage: 0, shieldRaise: 0, swingWait: 0, moveSpeed: 0, vx: 0, vz: 0, sprinting: false, sprintLocked: false, eliminatedAt: 0 };
    this.players.set(id, p); this.inputs.set(id, idleInput()); if (!this.host) this.host = id; this.positionPlayers(); return p;
  }
  spawn(p: Player, index: number) {
    const s = this.mode === 'ffa' ? SPAWNS[(index + this.round * 2) % SPAWNS.length] : [p.team === 'red' ? -43 : 43, (index - 1) * 5];
    Object.assign(p, { x: s[0], z: s[1], y: 0, vy: 0, vx: 0, vz: 0, grounded: true, sprinting: false, sprintLocked: false, yaw: Math.atan2(s[0], s[1]), pitch: 0 });
  }
  positionPlayers() { let n = 0; const teams = { red: 0, blue: 0 }; for (const p of this.players.values()) this.spawn(p, this.mode === 'ffa' ? n++ : teams[p.team]++); }
  dropFlag(id: string) {
    const p = this.players.get(id); if (!p) return;
    for (const f of this.flags) if (f.carrier === id) {
      Object.assign(f, { state: 'dropped', carrier: '', x: p.x, y: p.y, z: p.z, returnAt: this.tick + CTF.returnTicks });
      this.event({ type: 'flag_drop', actor: id, team: f.team, text: `${p.name} dropped the ${TEAMS[f.team].name} flag` });
    }
  }
  returnFlag(f: Flag, p?: Player) {
    Object.assign(f, { state: 'home', x: TEAMS[f.team].x, y: 0, z: TEAMS[f.team].z, carrier: '', returnAt: 0 });
    if (p) p.flagReturns++;
    this.event({ type: 'flag_return', actor: p?.id, team: f.team, text: `${TEAMS[f.team].name} flag returned${p ? ' by ' + p.name : ''}` });
  }
  flagTouch(p: Player, f: Pick<Flag, 'x' | 'y' | 'z'>) {
    return Math.hypot(p.x - f.x, p.z - f.z) <= CTF.radius && Math.abs(p.y - f.y) < 1.5 && !Number.isFinite(wallHit({ x: p.x, y: p.y + .8, z: p.z }, { x: f.x, y: f.y + .8, z: f.z }));
  }
  updateFlags() {
    if (this.mode !== 'ctf') return;
    const ps = [...this.players.values()].filter(p => p.alive && p.connected && !this.departed.has(p.id));
    for (const f of this.flags) {
      if (f.state === 'dropped' && this.tick >= f.returnAt) this.returnFlag(f);
      if (f.state === 'carried') {
        const carrier = this.players.get(f.carrier);
        if (!carrier?.alive || !carrier.connected || this.departed.has(carrier.id)) this.dropFlag(f.carrier);
        else Object.assign(f, { x: carrier.x, y: carrier.y, z: carrier.z });
      }
      if (f.state === 'dropped') { const owner = ps.find(p => p.team === f.team && this.flagTouch(p, f)); if (owner) this.returnFlag(f, owner); }
      if (f.state !== 'carried') {
        const thief = ps.find(p => p.team !== f.team && this.flagTouch(p, f));
        if (thief) { Object.assign(f, { state: 'carried', carrier: thief.id, returnAt: 0 }); thief.immuneUntil = 0; this.event({ type: 'flag_pickup', actor: thief.id, team: f.team, text: `${thief.name} took the ${TEAMS[f.team].name} flag` }); }
      }
    }
    for (const f of this.flags) if (f.state === 'carried') {
      const p = this.players.get(f.carrier)!, own = this.flags.find(q => q.team === p.team)!;
      if (own.state === 'home' && this.flagTouch(p, { ...TEAMS[p.team], y: 0 })) {
        this.scores[p.team]++; p.captures++; Object.assign(f, { state: 'home', x: TEAMS[f.team].x, z: TEAMS[f.team].z, y: 0, carrier: '', returnAt: 0 });
        this.event({ type: 'flag_capture', actor: p.id, team: p.team, text: `${p.name} captured for ${TEAMS[p.team].name} · ${this.scores[p.team]} / ${CTF.target}` });
      }
    }
  }
  respawn(p: Player) {
    Object.assign(p, { alive: true, hp: 100, respawnAt: 0, immuneUntil: this.tick + CTF.protectionTicks, weapon: 'sword', offhand: 'shield', ammo: 20, apples: APPLE.count, totems: TOTEM.count, block: false, charge: 0, cooldown: 0, loaded: false, shieldDisabled: 0, hurtTime: 0, lastDamage: 0, shieldRaise: 0, swingWait: 0, moveSpeed: 0 });
    const team = [...this.players.values()].filter(q => q.team === p.team); this.spawn(p, team.indexOf(p));
    this.inputs.set(p.id, { ...idleInput(), seq: p.ack, yaw: p.yaw }); this.lastInput.delete(p.id); this.lastAttack.set(p.id, false); this.attackPress.delete(p.id); this.attackRelease.delete(p.id); this.damageHistory.delete(p.id);
  }
  event(e: Omit<GameEvent, 'id'>) { this.events.push({ ...e, id: ++this.nextEvent }); this.events = this.events.slice(-24); }
  input(id: string, i: Input) { const p = this.players.get(id); if (p && i.seq > p.ack && i.seq > (this.inputs.get(id)?.seq ?? -1)) { const previous = this.inputs.get(id); if (i.attack && !previous?.attack) this.attackPress.add(id); if (!i.attack && previous?.attack) this.attackRelease.add(id); this.inputs.set(id, i); this.lastInput.set(id, this.tick); } }
  start(id: string, practice = false) {
    const ps = [...this.players.values()];
    if (id !== this.host || this.phase !== 'waiting' || !ps.every(p => p.connected && p.ready) || (practice ? ps.length !== 1 : ps.length < 2)) return false;
    if (!practice && this.mode !== 'ffa' && !this.balanced()) return false;
    this.resetFlags();
    this.practice = practice; this.round++; this.phase = 'countdown'; this.countdown = 5; this.result = ''; this.winner = ''; this.arrows = []; this.events = []; this.damageHistory.clear();
    for (const p of ps) { Object.assign(p, { respawnAt: 0, immuneUntil: 0, captures: 0, flagReturns: 0, hp: 100, xp: 0, alive: true, weapon: 'sword', offhand: 'shield', block: false, ammo: 20, apples: APPLE.count, totems: TOTEM.count, kills: 0, damage: 0, assists: 0, cooldown: 0, charge: 0, loaded: false, shieldDisabled: 0, hurtTime: 0, lastDamage: 0, shieldRaise: 0, swingWait: 0, moveSpeed: 0, vx: 0, vz: 0, sprinting: false, sprintLocked: false, eliminatedAt: 0, ack: 0 }); this.inputs.set(p.id, idleInput()); this.lastAttack.set(p.id, false); }
    this.history = []; this.attackPress.clear(); this.attackRelease.clear(); this.positionPlayers(); return true;
  }
  disconnect(id: string) { this.dropFlag(id); const p = this.players.get(id); if (p) { p.connected = false; p.ready = false; p.charge = 0; this.inputs.set(id, { ...idleInput(), offhand: p.offhand }); this.lastAttack.set(id, false); } this.transferHost(); }
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
    this.dropFlag(id); p.respawnAt = 0; p.connected = false; p.ready = false; this.departed.add(id);
    if (this.phase === 'waiting' || this.phase === 'countdown') this.removePlayer(id);
    this.transferHost(); this.checkWinner();
  }
  lobby(id: string) {
    if (id !== this.host || (this.phase !== 'results' && !this.practice)) return;
    if (this.phase === 'results' && this.tick - this.resultTime < 180) return;
    this.phase = 'waiting'; this.practice = false; this.arrows = []; this.resetFlags();
    for (const [key, p] of this.players) { if (this.departed.has(key)) this.removePlayer(key); else { p.ready = false; p.respawnAt = 0; p.immuneUntil = 0; p.captures = p.flagReturns = 0; p.xp = 0; p.apples = APPLE.count; p.totems = TOTEM.count; p.charge = 0; p.alive = true; p.hp = 100; p.hurtTime = 0; p.block = false; p.shieldRaise = 0; p.moveSpeed = 0; } }
    this.positionPlayers();
  }
  checkWinner() {
    if (this.phase !== 'active' || this.practice) return;
    if (this.mode !== 'ffa') {
      const teams = (['red', 'blue'] as Team[]).filter(team => [...this.players.values()].some(p => p.team === team && !this.departed.has(p.id) && (this.mode === 'ctf' || p.alive)));
      const scoring = (['red', 'blue'] as Team[]).filter(team => this.scores[team] >= CTF.target);
      if (teams.length <= 1 || scoring.length) {
        this.winnerTeam = scoring.length === 1 ? scoring[0] : scoring.length > 1 ? '' : teams[0] ?? '';
        this.phase = 'results'; this.resultTime = this.tick; this.winner = '';
        this.result = this.winnerTeam ? `${TEAMS[this.winnerTeam].name} team wins` : 'Draw';
        for (const p of this.players.values()) if (p.team === this.winnerTeam && !this.departed.has(p.id)) p.wins++;
        this.event({ type: 'result', text: this.result }); this.arrows = [];
      }
      return;
    }
    const alive = [...this.players.values()].filter(p => p.alive);
    if (alive.length <= 1) { this.phase = 'results'; this.resultTime = this.tick; this.winner = alive[0]?.id ?? ''; this.result = alive[0] ? `${alive[0].name} wins` : 'Draw — no survivors'; if (alive[0]) alive[0].wins++; this.event({ type: 'result', actor: this.winner, text: this.result }); this.arrows = []; }
  }
  earnXp(player: Player, amount: number) {
    if (this.phase !== 'active' || this.practice || amount <= 0 || !Number.isFinite(amount)) return;
    const before = armorTier(player.xp);
    player.xp = Math.min(150, player.xp + amount);
    const after = armorTier(player.xp);
    if (after.level > before.level) this.event({ type: 'level', actor: player.id, text: `Level ${after.level} · ${after.name} unlocked` });
  }
  previewArmor(id: string, level: unknown) {
    const player = this.players.get(id);
    if (!this.practice || this.phase !== 'active' || this.players.size !== 1 || !player?.alive || !player.connected || ![1, 2, 3].includes(level as number)) return false;
    player.xp = ARMOR_TIERS[(level as number) - 1].xp; return true;
  }
  damage(target: Player, actor: Player, amount: number, axe = false, hit: { strength?: number; critical?: boolean; sprintHit?: boolean; sweep?: boolean; projectile?: boolean; source?: { x: number; z: number }; force?: boolean } = {}) {
    if (!target.alive || (!hit.force && (this.teammates(target, actor) || target.immuneUntil > this.tick))) return false;
    const source = hit.source ?? actor, facing = direction(target.yaw);
    const dx = source.x - target.x, dz = source.z - target.z;
    const blocked = !hit.force && target.offhand === 'shield' && target.block && target.shieldDisabled <= 0 && target.shieldRaise >= .25 && facing.x * dx + facing.z * dz > 0;
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
    if (!hit.force) amount *= 1 - armorTier(this.combatXp?.get(target.id) ?? target.xp).reduction;
    const before = target.hp;
    const saved = !hit.force && amount > 0 && target.offhand === 'totem' && target.totems > 0 && before - amount <= TOTEM.health;
    target.hp = saved ? TOTEM.health : Math.max(0, before - amount);
    amount = Math.max(0, before - target.hp); actor.damage += amount;
    if (saved) {
      target.totems--; target.charge = 0;
      this.event({ type: 'totem', actor: target.id, text: 'Totem used · Two hearts remaining' });
    }
    if (!hit.force && actor.id !== target.id) this.earnXp(actor, amount);
    if (!immune && !hit.force) knockback(target, -dx, -dz, hit.strength ?? 8);
    const history = this.damageHistory.get(target.id) ?? new Map<string, number>(); history.set(actor.id, this.tick); this.damageHistory.set(target.id, history);
    this.event({ type: 'hit', actor: actor.id, target: target.id, blocked: false, critical: hit.critical, sprintHit: hit.sprintHit, sweep: hit.sweep });
    if (target.hp <= 0) { target.alive = false; target.block = false; target.charge = 0; target.eliminatedAt = this.tick; this.dropFlag(target.id); if (this.mode === 'ctf' && !hit.force) target.respawnAt = this.tick + CTF.respawnTicks; actor.kills++; if (!hit.force && actor.id !== target.id) this.earnXp(actor, 50); for (const [id, at] of history) if (id !== actor.id && this.tick - at <= 300) { const assister = this.players.get(id); if (assister) assister.assists++; } this.event({ type: 'kill', actor: actor.id, target: target.id, text: `${actor.name} eliminated ${target.name}` }); }
    return true;
  }
  random = Math.random;
  melee(p: Player, pose: Player = p) {
    p.immuneUntil = 0;
    const strength = attackStrength(pose), strong = strength > .9;
    const sprintHit = strong && !!pose.sprinting;
    const critical = strong && !pose.grounded && pose.vy < 0 && !pose.sprinting;
    const sweep = strong && p.weapon === 'sword' && pose.grounded && !pose.sprinting && pose.moveSpeed <= 4.317 + .01;
    const d = direction(p.yaw, p.pitch), reach = 3;
    const a = { x: p.x, y: p.y + EYE, z: p.z }, b = { x: a.x + d.x * reach, y: a.y + d.y * reach, z: a.z + d.z * reach };
    let nearest = wallHit(a, b), target: Player | undefined;
    const rewind = Math.min(6, Math.max(0, this.rewindTicks.get(p.id) ?? 0));
    const past = rewind > 0 ? this.history.find(h => h.tick >= this.tick - rewind) : undefined;
    for (const q of this.players.values()) if (q.id !== p.id && q.alive && !this.teammates(p, q)) { const pose = past?.players.get(q.id) ?? q; const t = segmentBox(a, b, [pose.x - .3, pose.y, pose.z - .3], [pose.x + .3, pose.y + HEIGHT, pose.z + .3]); if (t < nearest) { nearest = t; target = q; } }
    if (target) {
      const amount = (p.weapon === 'axe' ? MELEE.axe.damage : MELEE.sword.damage) * (.2 + .8 * strength * strength) * (critical ? 1.5 : 1);
      const landed = this.damage(target, p, amount, p.weapon === 'axe', { strength: sprintHit ? 18 : 8, critical, sprintHit });
      if (landed && sweep) for (const q of this.players.values()) {
        if (q.id === p.id || q.id === target.id || !q.alive || this.teammates(p, q) || Math.hypot(q.x - p.x, q.z - p.z) >= 3 || Math.abs(q.y - target.y) > .5 || Math.abs(q.x - target.x) > 1.3 || Math.abs(q.z - target.z) > 1.3) continue;
        if (!Number.isFinite(wallHit(a, { x: q.x, y: q.y + 1, z: q.z }))) this.damage(q, p, 5, false, { strength: 8, sweep: true });
      }
      if (sprintHit) { p.sprinting = false; p.sprintLocked = true; p.vx = (p.vx ?? 0) * .6; p.vz = (p.vz ?? 0) * .6; }
    }
    this.event({ type: 'swing', actor: p.id, critical, sprintHit, sweep: !!target && sweep });
    p.cooldown = meleeRecovery(p.weapon); p.swingWait = .1;
  }
  shoot(p: Player, charge: number) {
    p.immuneUntil = 0;
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
    if (this.mode === 'ctf') for (const p of this.players.values()) if (!p.alive && p.connected && p.respawnAt > 0 && this.tick >= p.respawnAt && !this.departed.has(p.id)) this.respawn(p);
    this.history.push({ tick: this.tick, players: new Map([...this.players].map(([id, p]) => [id, { x: p.x, y: p.y, z: p.z }])) });
    if (this.history.length > 8) this.history.shift();
    // Gather attacks before resolving them so attacks initiated in one tick are simultaneous.
    const attacks: (() => void)[] = [];
    const meals: { player: Player; totems: number }[] = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const stale = this.tick - (this.lastInput.get(p.id) ?? -1000) > 15 || !p.connected;
      const i = stale ? { ...idleInput(), yaw: p.yaw, pitch: p.pitch, weapon: p.weapon, offhand: p.offhand } : this.inputs.get(p.id)!;
      p.ack = Math.max(p.ack, i.seq); p.yaw = i.yaw; p.pitch = i.pitch;
      if (i.weapon !== p.weapon) { p.weapon = i.weapon; p.charge = 0; p.cooldown = p.weapon === 'sword' || p.weapon === 'axe' ? Math.max(p.cooldown, meleeRecovery(p.weapon)) : 0; }
      p.hurtTime = Math.max(0, p.hurtTime - DT); p.swingWait = Math.max(0, p.swingWait - DT);
      p.cooldown = Math.max(0, p.cooldown - DT); p.shieldDisabled = Math.max(0, p.shieldDisabled - DT);
      p.offhand = i.offhand; p.block = i.block && p.offhand === 'shield' && p.shieldDisabled <= 0;
      p.shieldRaise = p.block ? Math.min(.25, p.shieldRaise + DT) : 0;
      const oldX = p.x, oldZ = p.z;
      move(p, { ...i, block: p.block }, DT, p.charge > 0);
      p.moveSpeed = Math.hypot(p.x - oldX, p.z - oldZ) / DT;
      const pressed = !stale && (this.attackPress.has(p.id) || (i.attack && !this.lastAttack.get(p.id))), released = this.attackRelease.has(p.id) || (!i.attack && !!this.lastAttack.get(p.id));
      if (p.block) p.charge = 0;
      else if (p.weapon === 'apple') {
        if (i.attack && p.apples > 0 && p.hp < 100) {
          p.charge += DT;
          if (p.charge + 1e-8 >= APPLE.seconds) { p.charge = 0; meals.push({ player: p, totems: p.totems }); }
        } else p.charge = 0;
      } else if (p.weapon === 'bow') {
        if (i.attack && p.cooldown <= 0 && p.ammo > 0) p.charge = Math.min(1, p.charge + DT);
        if (released) { if (p.charge >= .14 && !stale) { const amount = p.charge; attacks.push(() => this.shoot(p, amount)); } p.charge = 0; }
      } else if (p.weapon === 'crossbow') {
        if (p.charge > 0) { p.charge += DT; if (p.charge >= 1.25) { p.loaded = true; p.charge = 0; } }
        if (pressed && p.cooldown <= 0 && p.ammo > 0) { if (p.loaded) { attacks.push(() => this.shoot(p, 1)); p.loaded = false; } else if (p.charge === 0) p.charge = DT; }
      } else if ((pressed || (i.attack && p.cooldown <= 0)) && p.swingWait <= 0) { const attackPose = { ...p }; attacks.push(() => this.melee(p, attackPose)); }
      this.lastAttack.set(p.id, i.attack);
    }
    this.attackPress.clear(); this.attackRelease.clear();
    // Newly earned protection starts after all attacks in this tick, independent of seat order.
    this.combatXp = new Map([...this.players.values()].map(p => [p.id, p.xp]));
    for (const attack of attacks) attack();
    this.arrows = this.arrows.filter(a => {
      a.age += DT; const old = { x: a.x, y: a.y, z: a.z }; a.x += a.vx * DT; a.y += a.vy * DT; a.z += a.vz * DT; const drag = Math.pow(.99, DT * 20); a.vx *= drag; a.vz *= drag; a.vy = a.vy * drag - 20 * DT;
      const owner = this.players.get(a.owner);
      let nearest = wallHit(old, a), target: Player | undefined;
      for (const p of this.players.values()) if (p.id !== a.owner && p.alive && (!owner || !this.teammates(owner, p))) { const t = segmentBox(old, a, [p.x - .38, p.y, p.z - .38], [p.x + .38, p.y + HEIGHT, p.z + .38]); if (t < nearest) { nearest = t; target = p; } }
      if (target && owner) {
        const base = Math.ceil(Math.hypot(a.vx, a.vy, a.vz) / 20 * 2);
        const amount = (base + (a.critical ? Math.floor(this.random() * (Math.floor(base / 2) + 2)) : 0)) * 5;
        this.damage(target, owner, amount, false, { projectile: true, source: old, critical: a.critical });
      }
      return !Number.isFinite(nearest) && a.age < 4 && a.y > 0 && Math.abs(a.x) < LIMIT && Math.abs(a.z) < LIMIT;
    });
    this.combatXp = undefined;
    // Food cannot revive a same-tick death or finish a bite cancelled by a totem save.
    for (const { player: p, totems } of meals) if (p.totems === totems && p.alive && p.connected && p.apples > 0 && p.hp < 100) {
      const amount = Math.min(APPLE.heal, 100 - p.hp); p.hp += amount; p.apples--;
      this.event({ type: 'heal', actor: p.id, text: `Golden apple restored ${Math.round(amount)} HP` });
    }
    this.updateFlags(); this.checkWinner();
  }
  snapshot(): Snapshot { return { mode: this.mode, winnerTeam: this.winnerTeam, scores: { ...this.scores }, flags: this.flags.map(f => ({ ...f })), tick: this.tick, phase: this.phase, countdown: this.countdown, result: this.result, winner: this.winner, round: this.round, host: this.host, practice: this.practice, players: [...this.players.values()].map(p => ({ ...p })), arrows: this.arrows.map(a => ({ ...a })), events: this.events }; }
}
