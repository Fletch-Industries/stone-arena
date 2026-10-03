import { shardSites, shardCount } from '../shared/expedition.js';
import { BUILD, Construction } from '../shared/construction.js';
import { weaveTarget } from '../shared/weaving.js';
import { restoreWorld } from '../shared/world-save.js';
import { FORAGE, Forage, gatherTarget, SUPPLIES } from '../shared/forage.js';
import { craftReason, hearthNear, recipeFor } from '../shared/crafting.js';
import { HEARTHSTONE } from '../shared/sailing.js';
import { HOME_WAYSTONE, nearbyWaystone, waystoneSites } from '../shared/waystones.js';
import { WILDLIFE, guardianRay } from '../shared/creatures.js';
import { Ecosystem, type Creature, type EcosystemHooks } from './ecosystem.js';
import { nearSecret, SECRET, WORLD_LIMIT, terrainHeight, type Realm, type WorldState } from '../shared/world.js';
import { CTF, MODES, isTeamMode, TEAMS, LIMIT, type Mode, type Team, type Flag, APPLE, TOTEM, ARMOR_TIERS, armorTier, MELEE, attackStrength, meleeRecovery, knockback, DT, EYE, HEIGHT, SPAWNS, direction, idleInput, move, segmentBox, wallHit, type Arrow, type GameEvent, type Input, type Player, type Snapshot, type Phase } from '../shared/game.js';

interface WorldActor { worldEnemy: true; id: string; name: string; x: number; z: number; realm: 'wilds' }
export class Simulation {
  world: WorldState;
  ecosystem = new Ecosystem();
  private ecologyHooks: EcosystemHooks = { event: e => this.event(e), hurt: (p, c, n) => this.worldStrike(p, c, n), reward: (p, n, damage) => { if (damage) p.damage += n; this.earnXp(p, n); } };
  constructor(seed = 7919) { this.world = { seed: seed >>> 0, doorOpen: false, waystones: 1, construction: new Construction(), forage: new Forage(), supplies: [0, 0, 0], upgrades: 0, bonds: 0, guardians: 0 }; }
  creature(id: string, action?: unknown) {
    const p = this.players.get(id);
    if (this.phase !== 'active' || !p?.alive || !p.connected || p.realm !== 'wilds' || p.block || p.charge > 0 || action !== 'release' && this.tick < (p.friendReadyAt ?? 0) || p.hurtTime > 0 || !this.rested(id)) return false;
    if (!this.ecosystem.interact(p, this.world, this.tick, this.ecologyHooks, action)) return false;
    const scouting=action===undefined&&[...this.ecosystem.creatures.values()].some(c=>c.owner===id&&c.state==='scout');
    p.friendReadyAt = this.tick + (scouting?WILDLIFE.scoutSeconds*60:39); p.immuneUntil = 0; return true;
  }
  worldStrike(p: Player, c: Creature, amount: number) {
    return this.damage(p, { worldEnemy: true, id: `wild:${c.id}`, name: 'Shade Warden', x: c.x, z: c.z, realm: 'wilds' }, amount, false, { projectile: true, strength: 5 });
  }
  rested(id: string) { return ![...(this.damageHistory.get(id)?.values() ?? [])].some(at => this.tick - at < 300); }
  gather(id: string) {
    const p = this.players.get(id);
    if (this.phase !== 'active' || !p?.alive || !p.connected || p.realm !== 'wilds' || this.tick < (p.gatherReadyAt ?? 0) || p.hurtTime > 0 || !this.rested(id)) return false;
    const node = gatherTarget(p, this.world, this.tick);
    if (!node || !this.world.forage!.harvest(node, this.tick)) return false;
    const stock = this.world.supplies!; const amount = Math.min(FORAGE.yield, FORAGE.stockLimit - stock[node.kind]); stock[node.kind] += amount;
    p.gatherReadyAt = this.tick + 39; p.immuneUntil = 0;
    this.event({ type: 'gather', actor: id, text: `+${amount} ${SUPPLIES[node.kind].name} · Party supplies`, position: { x: node.x, y: node.y + .9, z: node.z } }); return true;
  }
  craft(id: string, choice: unknown) {
    const p = this.players.get(id), recipe = recipeFor(choice);
    if (!p || !recipe || this.tick < (p.craftReadyAt ?? 0) || craftReason(p, this.world, recipe, this.phase === 'active', this.rested(id))) return false;
    recipe.cost.forEach((amount, kind) => { this.world.supplies![kind] -= amount; });
    if (recipe.unlock) this.world.upgrades = (this.world.upgrades ?? 0) | recipe.unlock;
    else p.ammo = Math.min(40, p.ammo + 12);
    p.craftReadyAt = this.tick + 60; p.immuneUntil = 0;
    this.event({ type: 'craft', actor: id, text: recipe.unlock ? `${recipe.name} woven · Ready for your whole party` : 'Arrow bundle woven · +12 arrows, up to 40', position: { x: p.x, y: p.y + 1, z: p.z } }); return true;
  }
  restore(id: string, save: unknown) {
    if (id !== this.host || this.phase !== 'waiting' || !this.players.get(id)?.connected) return false;
    const world = restoreWorld(save); if (!world) return false;
    this.world = world; this.ecosystem.clear(); this.history = []; this.arrows = []; this.resetFlags();
    for (const p of this.players.values()) { p.ready = false; this.inputs.set(p.id, { ...idleInput(), seq: p.ack }); this.lastInput.delete(p.id); }
    this.positionPlayers(); return true;
  }
  weave(p: Player, erase: boolean) {
    if (this.phase !== 'active' || !p.alive || !p.connected || p.realm !== 'wilds' || !p.weaving || this.tick < (p.weaveReadyAt ?? 0) || p.hurtTime > 0 || [...(this.damageHistory.get(p.id)?.values() ?? [])].some(at => this.tick - at < 300)) return false;
    p.weaveReadyAt = this.tick + BUILD.cooldown;
    const target = weaveTarget(p, this.world, erase, [...this.players.values()]);
    if (!target?.valid) return false;
    const blocks = this.world.construction!;
    if (!erase && p.weaveKind === 6 && !((this.world.upgrades ?? 0) & HEARTHSTONE)) return false;
    const ok = erase ? !!target.existing && (target.existing.owner === p.id || p.id === this.host || this.mode === 'expedition') && blocks.erase(target.x, target.y, target.z) : blocks.place({ x: target.x, y: target.y, z: target.z, kind: p.weaveKind ?? 0, owner: p.id });
    if (ok) this.event({ type: erase ? 'erase' : 'weave', actor: p.id, position: { x: target.x + .5, y: target.y + .5, z: target.z + .5 } });
    return ok;
  }
  warp(id: string, destination: unknown) {
    const p = this.players.get(id);
    const source = p && nearbyWaystone(p, this.world.seed);
    if (this.phase !== 'active' || !p?.alive || !p.connected || p.relics !== 7 || p.hurtTime > 0 || this.tick < (p.warpReadyAt ?? 0) || !source || !((this.world.waystones ?? 1) & 1 << source.id) || !Number.isInteger(destination) || (destination as number) < 0 || (destination as number) > 8 || !((this.world.waystones ?? 1) & 1 << (destination as number))) return false;
    if ([...(this.damageHistory.get(id)?.values() ?? [])].some(at => this.tick - at < 300)) return false;
    const target = destination === 0 ? HOME_WAYSTONE : waystoneSites(this.world.seed).find(s => s.id === destination)!;
    if (target.id === source.id) return false;
    Object.assign(p, { glideTime: 0, glideHeld: false, x: target.x, y: target.y, z: target.z, vx: 0, vz: 0, vy: 0, grounded: true, weaving: false, warpTick: this.tick, warpReadyAt: this.tick + 120, yaw: 0, pitch: 0, dashTime: 0, dashHeld: false, block: false, shieldRaise: 0, charge: 0, moveSpeed: 0, sprinting: false, sprintLocked: false, immuneUntil: 0 });
    this.inputs.set(id, { ...idleInput(), seq: p.ack, offhand: p.offhand }); this.lastInput.delete(id); this.lastAttack.set(id, false); this.attackPress.delete(id); this.attackRelease.delete(id);
    this.arrows = this.arrows.filter(a => a.owner !== id);
    for (const frame of this.history) frame.players.delete(id);
    this.event({ type: 'warp', actor: id, text: `Waystone travel · ${target.name}` }); return true;
  }
  interact(id: string) {
    const p = this.players.get(id);
    if (this.phase !== 'active' || !p?.alive || !p.connected || !nearSecret(p)) return false;
    if (!this.world.doorOpen) { this.world.doorOpen = true; this.event({ type: 'door', actor: id, text: 'The stone wall slides aside…' }); }
    return true;
  }
  travel(p: Player) {
    const out = p.realm === 'arena' && this.world.doorOpen && p.z < SECRET.end + 1 && Math.abs(p.x - SECRET.x) < 1.7 && p.y < 2;
    const back = p.realm === 'wilds' && p.z > 8 && p.z < 12 && Math.abs(p.x) < 1.6 && p.y < 2;
    if (!out && !back) return false;
    this.dropFlag(p.id);
    Object.assign(p, { glideTime: 0, glideHeld: false, weaving: false, realm: out ? 'wilds' : 'arena', x: out ? 0 : SECRET.x, y: 0, z: out ? 0 : -61, vy: 0, vx: 0, vz: 0, grounded: true, yaw: out ? 0 : Math.PI, pitch: 0, block: false, charge: 0, sprinting: false, sprintLocked: false, immuneUntil: 0 });
    this.inputs.set(p.id, { ...idleInput(), seq: p.ack, yaw: p.yaw, offhand: p.offhand }); this.lastInput.delete(p.id); this.lastAttack.set(p.id, false); this.attackPress.delete(p.id); this.attackRelease.delete(p.id);
    this.arrows = this.arrows.filter(a => a.owner !== p.id);
    this.event({ type: 'travel', actor: p.id, text: out ? 'You discovered the Wilds · The return tunnel is behind you' : 'Back inside the Stone Citadel' }); return true;
  }
  mode: Mode = 'ffa'; winnerTeam: Team | '' = ''; scores = { red: 0, blue: 0 };
  flags: Flag[] = this.homeFlags();
  homeFlags(): Flag[] { return (['red', 'blue'] as Team[]).map(team => ({ team, state: 'home', x: TEAMS[team].x, z: TEAMS[team].z, y: 0, carrier: '', returnAt: 0 })); }
  resetFlags() { this.flags = this.homeFlags(); this.scores = { red: 0, blue: 0 }; this.winnerTeam = ''; }
  teammates(a: Player, b: Player) { return this.mode === 'expedition' || (isTeamMode(this.mode) && a.team === b.team); }
  balanced() { const ps = [...this.players.values()]; const red = ps.filter(p => p.team === 'red').length; return red > 0 && red < ps.length && Math.abs(red - (ps.length - red)) <= 1; }
  selectMode(id: string, value: unknown) {
    if (id !== this.host || this.phase !== 'waiting' || typeof value !== 'string' || !Object.hasOwn(MODES, value)) return false;
    this.mode = value as Mode; this.resetFlags(); for (const p of this.players.values()) p.ready = false; this.positionPlayers(); return true;
  }
  selectTeam(id: string, value: unknown) {
    const p = this.players.get(id);
    if (!p?.connected || this.phase !== 'waiting' || !isTeamMode(this.mode) || !['red', 'blue'].includes(value as string)) return false;
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
  rewindTicks = new Map<string, number>(); history: { tick: number; players: Map<string, { x: number; y: number; z: number; realm: Realm }> }[] = [];
  add(id: string, name: string) {
    if (this.players.size >= 5 || this.phase !== 'waiting') throw new Error('Room full or round in progress.');
    const colors = new Set([...this.players.values()].map(p => p.color));
    const color = [0, 1, 2, 3, 4].find(c => !colors.has(c))!;
    const red = [...this.players.values()].filter(p => p.team === 'red').length;
    const team: Team = red <= this.players.size - red ? 'red' : 'blue';
    const p: Player = { relics: 0, realm: 'arena', team, respawnAt: 0, immuneUntil: 0, captures: 0, flagReturns: 0, id, name, color, x: 0, y: 0, z: 0, vy: 0, grounded: true, yaw: 0, pitch: 0, hp: 100, xp: 0, alive: true, connected: true, ready: false, weapon: 'sword', offhand: 'shield', block: false, ammo: 20, apples: APPLE.count, totems: TOTEM.count, kills: 0, damage: 0, assists: 0, wins: 0, ack: 0, cooldown: 0, charge: 0, loaded: false, shieldDisabled: 0, hurtTime: 0, lastDamage: 0, shieldRaise: 0, swingWait: 0, moveSpeed: 0, vx: 0, vz: 0, sprinting: false, sprintLocked: false, eliminatedAt: 0 };
    this.players.set(id, p); this.inputs.set(id, idleInput()); if (!this.host) this.host = id; this.positionPlayers(); return p;
  }
  spawn(p: Player, index: number) {
    const s = !isTeamMode(this.mode) ? SPAWNS[(index + this.round * 2) % SPAWNS.length] : [p.team === 'red' ? -43 : 43, (index - 1) * 5];
    Object.assign(p, { glideTime: 0, glideCooldown: 0, glideHeld: false, gatherReadyAt: 0, craftReadyAt: 0, friendReadyAt: 0, weaving: false, weaveReadyAt: 0, warpTick: -1000, warpReadyAt: 0, dashTime: 0, dashHeld: false, dashCooldown: 0, realm: 'arena', x: s[0], z: s[1], y: 0, vy: 0, vx: 0, vz: 0, grounded: true, sprinting: false, sprintLocked: false, yaw: Math.atan2(s[0], s[1]), pitch: 0 });
  }
  positionPlayers() { let n = 0; const teams = { red: 0, blue: 0 }; for (const p of this.players.values()) this.spawn(p, !isTeamMode(this.mode) ? n++ : teams[p.team]++); }
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
    return Math.hypot(p.x - f.x, p.z - f.z) <= CTF.radius && Math.abs(p.y - f.y) < 1.5 && !Number.isFinite(wallHit({ x: p.x, y: p.y + .8, z: p.z }, { x: f.x, y: f.y + .8, z: f.z }, 'arena', this.world));
  }
  updateFlags() {
    if (this.mode !== 'ctf') return;
    const ps = [...this.players.values()].filter(p => p.alive && p.connected && p.realm === 'arena' && !this.departed.has(p.id));
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
    if (this.mode === 'expedition') Object.assign(p, { realm: 'wilds', x: 0, z: -5, y: terrainHeight(0, -5, this.world.seed), yaw: 0, pitch: 0, warpTick: this.tick });
    this.inputs.set(p.id, { ...idleInput(), seq: p.ack, yaw: p.yaw }); this.lastInput.delete(p.id); this.lastAttack.set(p.id, false); this.attackPress.delete(p.id); this.attackRelease.delete(p.id); this.damageHistory.delete(p.id);
  }
  event(e: Omit<GameEvent, 'id'>) { this.events.push({ ...e, id: ++this.nextEvent }); this.events = this.events.slice(-24); }
  input(id: string, i: Input) { const p = this.players.get(id); if (p && i.seq > p.ack && i.seq > (this.inputs.get(id)?.seq ?? -1)) { const previous = this.inputs.get(id); if (i.attack && !previous?.attack) this.attackPress.add(id); if (!i.attack && previous?.attack) this.attackRelease.add(id); this.inputs.set(id, i); this.lastInput.set(id, this.tick); } }
  start(id: string, practice = false) {
    const ps = [...this.players.values()];
    if (id !== this.host || this.phase !== 'waiting' || !ps.every(p => p.connected && p.ready) || (practice ? ps.length !== 1 : ps.length < (this.mode === 'expedition' ? 1 : 2))) return false;
    if (!practice && isTeamMode(this.mode) && !this.balanced()) return false;
    this.resetFlags(); this.ecosystem.clear();
    this.practice = practice && this.mode !== 'expedition'; this.round++; this.phase = 'countdown'; this.countdown = 5; this.result = ''; this.winner = ''; this.arrows = []; this.events = []; this.damageHistory.clear();
    for (const p of ps) { Object.assign(p, { relics: 0, respawnAt: 0, immuneUntil: 0, captures: 0, flagReturns: 0, hp: 100, xp: 0, alive: true, weapon: 'sword', offhand: 'shield', block: false, ammo: 20, apples: APPLE.count, totems: TOTEM.count, kills: 0, damage: 0, assists: 0, cooldown: 0, charge: 0, loaded: false, shieldDisabled: 0, hurtTime: 0, lastDamage: 0, shieldRaise: 0, swingWait: 0, moveSpeed: 0, vx: 0, vz: 0, sprinting: false, sprintLocked: false, eliminatedAt: 0, ack: 0 }); this.inputs.set(p.id, idleInput()); this.lastAttack.set(p.id, false); }
    this.history = []; this.attackPress.clear(); this.attackRelease.clear(); this.positionPlayers(); return true;
  }
  disconnect(id: string) { this.dropFlag(id); const p = this.players.get(id); if (p) { p.connected = false; p.ready = false; p.charge = 0; p.glideTime = 0; p.glideHeld = false; this.inputs.set(id, { ...idleInput(), offhand: p.offhand }); this.lastAttack.set(id, false); } this.transferHost(); }
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
    if (id !== this.host || (this.phase !== 'results' && !this.practice && !(this.mode === 'expedition' && this.phase === 'active'))) return;
    if (this.phase === 'results' && this.tick - this.resultTime < 180) return;
    this.phase = 'waiting'; this.practice = false; this.arrows = []; this.ecosystem.clear(); this.resetFlags();
    for (const [key, p] of this.players) { if (this.departed.has(key)) this.removePlayer(key); else { p.ready = false; p.respawnAt = 0; p.immuneUntil = 0; p.captures = p.flagReturns = 0; p.xp = 0; p.apples = APPLE.count; p.totems = TOTEM.count; p.charge = 0; p.alive = true; p.hp = 100; p.hurtTime = 0; p.block = false; p.shieldRaise = 0; p.moveSpeed = 0; } }
    this.positionPlayers();
  }
  checkWinner() {
    if (this.phase !== 'active') return;
    if (this.mode === 'expedition') {
      const party = [...this.players.values()].filter(p => !this.departed.has(p.id));
      // A reconnecting explorer remains part of the party and cannot accidentally
      // grant a win. Only explicit departures remove a seat from the expedition.
      const complete = party.length > 0 && party.every(p => p.connected && p.alive && p.relics === 7 && p.realm === 'arena');
      if (complete || party.length === 0) {
        this.phase = 'results'; this.resultTime = this.tick; this.winner = ''; this.winnerTeam = '';
        this.result = complete ? 'Expedition complete · Everyone made it home!' : 'Expedition ended';
        if (complete) for (const p of party) p.wins++;
        this.event({ type: 'result', text: this.result }); this.arrows = [];
      }
      return;
    }
    if (this.practice) return;
    if (isTeamMode(this.mode)) {
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
  damage(target: Player, actor: Player | WorldActor, amount: number, axe = false, hit: { strength?: number; critical?: boolean; sprintHit?: boolean; sweep?: boolean; projectile?: boolean; source?: { x: number; z: number }; force?: boolean } = {}) {
    const enemy = 'worldEnemy' in actor;
    if (!target.alive || (!hit.force && ((!enemy && this.teammates(target, actor)) || target.realm !== actor.realm || target.immuneUntil > this.tick))) return false;
    const source = hit.source ?? actor, facing = direction(target.yaw);
    const dx = source.x - target.x, dz = source.z - target.z;
    const blocked = !hit.force && target.offhand === 'shield' && target.block && target.shieldDisabled <= 0 && target.shieldRaise >= .25 && facing.x * dx + facing.z * dz > 0;
    if (blocked) {
      // Modern Java weapon component: axes disable a successfully blocked shield.
      if (axe) { target.shieldDisabled = 5; target.block = false; target.shieldRaise = 0; }
      if (!hit.projectile && !enemy) knockback(actor, dx, dz, 10);
      this.event({ type: 'hit', actor: actor.id, target: target.id, realm: enemy ? 'wilds' : undefined, position: enemy ? { x: target.x, y: target.y + 1, z: target.z } : undefined, blocked: true }); return false;
    }
    const original = amount, immune = !hit.force && target.hurtTime > 0;
    if (immune) { if (amount <= target.lastDamage) return false; amount -= target.lastDamage; }
    else if (!hit.force) target.hurtTime = .5;
    target.lastDamage = original; target.craftReadyAt = Math.max(target.craftReadyAt ?? 0, this.tick + 300); target.gatherReadyAt = Math.max(target.gatherReadyAt ?? 0, this.tick + 300); target.friendReadyAt = Math.max(target.friendReadyAt ?? 0, this.tick + 300); target.glideTime = 0; target.glideCooldown = Math.max(target.glideCooldown ?? 0, 5);
    if (!hit.force) amount *= 1 - armorTier(this.combatXp?.get(target.id) ?? target.xp).reduction;
    const before = target.hp;
    const saved = !hit.force && amount > 0 && target.offhand === 'totem' && target.totems > 0 && before - amount <= TOTEM.health;
    target.hp = saved ? TOTEM.health : Math.max(0, before - amount);
    amount = Math.max(0, before - target.hp); if (!enemy) actor.damage += amount;
    if (amount > 0) target.warpReadyAt = Math.max(target.warpReadyAt ?? 0, this.tick + 300);
    if (saved) {
      target.totems--; target.charge = 0;
      this.event({ type: 'totem', actor: target.id, text: 'Totem used · Two hearts remaining' });
    }
    if (!enemy && !hit.force && actor.id !== target.id) this.earnXp(actor, amount);
    if (!immune && !hit.force) knockback(target, -dx, -dz, hit.strength ?? 8);
    const history = this.damageHistory.get(target.id) ?? new Map<string, number>(); history.set(actor.id, this.tick); this.damageHistory.set(target.id, history);
    this.event({ type: 'hit', actor: actor.id, target: target.id, realm: enemy ? 'wilds' : undefined, position: enemy ? { x: target.x, y: target.y + 1, z: target.z } : undefined, blocked: false, critical: hit.critical, sprintHit: hit.sprintHit, sweep: hit.sweep });
    if (target.hp <= 0) {
      target.alive = false; target.block = false; target.charge = 0; target.eliminatedAt = this.tick; this.dropFlag(target.id);
      if (!hit.force && (this.mode === 'ctf' || this.mode === 'expedition' && enemy)) target.respawnAt = this.tick + CTF.respawnTicks;
      if (!enemy) { actor.kills++; if (!hit.force && actor.id !== target.id) this.earnXp(actor, 50); for (const [id, at] of history) if (id !== actor.id && this.tick - at <= 300) { const assister = this.players.get(id); if (assister) assister.assists++; } }
      this.event({ type: 'kill', actor: actor.id, target: target.id, realm: enemy ? 'wilds' : undefined, text: enemy ? `Shade Warden scattered ${target.name}${target.respawnAt?' · Return in five seconds':''}` : `${actor.name} eliminated ${target.name}` });
    }
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
    let nearest = wallHit(a, b, p.realm, this.world), target: Player | undefined;
    const rewind = Math.min(6, Math.max(0, this.rewindTicks.get(p.id) ?? 0));
    const past = rewind > 0 ? this.history.find(h => h.tick >= this.tick - rewind) : undefined;
    for (const q of this.players.values()) if (q.id !== p.id && q.alive && q.realm === p.realm && !this.teammates(p, q)) { const pose = past?.players.get(q.id) ?? q; if (pose.realm !== p.realm) continue; const t = segmentBox(a, b, [pose.x - .3, pose.y, pose.z - .3], [pose.x + .3, pose.y + HEIGHT, pose.z + .3]); if (t < nearest) { nearest = t; target = q; } }
    const guardian = guardianRay(a, b, this.ecosystem.creatures.values(), p.realm);
    const creature = guardian && guardian.t < nearest ? this.ecosystem.creatures.get(guardian.creature.id) : undefined;
    if (creature) target = undefined;
    if (target || creature) {
      const amount = (p.weapon === 'axe' ? MELEE.axe.damage : MELEE.sword.damage) * (.2 + .8 * strength * strength) * (critical ? 1.5 : 1);
      const landed = creature ? this.ecosystem.hurt(creature, p, amount, this.world, this.ecologyHooks, sprintHit ? 18 : 8) : this.damage(target!, p, amount, p.weapon === 'axe', { strength: sprintHit ? 18 : 8, critical, sprintHit });
      if (target && landed && sweep) for (const q of this.players.values()) {
        if (q.id === p.id || q.id === target.id || !q.alive || q.realm !== p.realm || this.teammates(p, q) || Math.hypot(q.x - p.x, q.z - p.z) >= 3 || Math.abs(q.y - target.y) > .5 || Math.abs(q.x - target.x) > 1.3 || Math.abs(q.z - target.z) > 1.3) continue;
        if (!Number.isFinite(wallHit(a, { x: q.x, y: q.y + 1, z: q.z }, p.realm, this.world))) this.damage(q, p, 5, false, { strength: 8, sweep: true });
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
    this.arrows.push({ realm: p.realm, id: ++this.nextArrow, owner: p.id, x: p.x, y: p.y + EYE, z: p.z, vx: d.x * speed, vy: d.y * speed, vz: d.z * speed, age: 0, damage: Math.ceil(speed / 20 * 2) * 5, critical: p.weapon === 'crossbow' || power === 1 }); p.ammo--; p.cooldown = .25; this.event({ type: 'shot', actor: p.id });
  }
  step() {
    this.tick++;
    if (this.tick % 60 === 0) this.world.forage!.expire(this.tick);
    if (this.phase === 'countdown') {
      if ([...this.players.values()].some(p => !p.connected) || this.players.size < (this.practice || this.mode === 'expedition' ? 1 : 2)) { this.phase = 'waiting'; return; }
      this.countdown = Math.max(0, this.countdown - DT);
      if (this.countdown <= .001) { this.phase = 'active'; this.event({ type: 'start' }); }
      return;
    }
    if (this.phase !== 'active') return;
    if (this.mode === 'ctf' || this.mode === 'expedition') for (const p of this.players.values()) if (!p.alive && p.connected && p.respawnAt > 0 && this.tick >= p.respawnAt && !this.departed.has(p.id)) this.respawn(p);
    this.history.push({ tick: this.tick, players: new Map([...this.players].map(([id, p]) => [id, { x: p.x, y: p.y, z: p.z, realm: p.realm }])) });
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
      p.weaving = i.weaving === true && p.realm === 'wilds' && !stale; p.weaveKind = i.weaveKind ?? 0;
      if (p.weaving) p.charge = 0;
      p.offhand = i.offhand; p.block = !p.weaving && i.block && p.offhand === 'shield' && p.shieldDisabled <= 0;
      p.shieldRaise = p.block ? Math.min(.25, p.shieldRaise + DT) : 0;
      const oldX = p.x, oldZ = p.z, wasDashing = (p.dashTime ?? 0) > 0, wasGliding = (p.glideTime ?? 0) > 0, wasGrounded = p.grounded;
      move(p, { ...i, block: p.block }, DT, p.charge > 0, this.world);
      if (wasGrounded && i.jump && !p.grounded && p.vy > 13) this.event({ type: 'windlift', actor: p.id, position: { x: p.x, y: p.y, z: p.z } });
      if (!wasDashing && (p.dashTime ?? 0) > 0) this.event({ type: 'dash', actor: p.id });
      if (!wasGliding && (p.glideTime ?? 0) > 0) { p.immuneUntil = 0; this.event({ type: 'glide', actor: p.id }); }
      if (this.travel(p)) { p.dashTime = 0; continue; }
      if (p.realm === 'wilds' && p.connected) for (const site of shardSites(this.world.seed)) {
        if (!(p.relics & 1 << site.id) && Math.hypot(p.x - site.x, p.z - site.z) < 2.6 && Math.abs(p.y - site.y) < 3) {
          p.relics |= 1 << site.id; this.event({ type: 'relic', actor: p.id, text: shardCount(p.relics) === 3 ? `${p.name} found all three skyshards · Warden aura unlocked!` : `${p.name} discovered the ${site.name} skyshard · ${shardCount(p.relics)}/3` });
        }
      }
      const waystone = p.connected && nearbyWaystone(p, this.world.seed);
      if (waystone && !((this.world.waystones ?? 1) & 1 << waystone.id)) {
        this.world.waystones = (this.world.waystones ?? 1) | 1 << waystone.id;
        this.event({ type: 'waystone', actor: p.id, text: `${p.name} awakened ${waystone.name} · Shared by your party` });
      }
      p.moveSpeed = Math.hypot(p.x - oldX, p.z - oldZ) / DT;
      const pressed = !stale && (this.attackPress.has(p.id) || (i.attack && !this.lastAttack.get(p.id))), released = this.attackRelease.has(p.id) || (!i.attack && !!this.lastAttack.get(p.id));
      if (p.weaving) { if (i.attack || i.block) this.weave(p, i.block); }
      else if (p.block) p.charge = 0;
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
      let nearest = wallHit(old, a, a.realm ?? 'arena', this.world), target: Player | undefined;
      for (const p of this.players.values()) if (p.id !== a.owner && p.alive && p.realm === (a.realm ?? 'arena') && (!owner || !this.teammates(owner, p))) { const t = segmentBox(old, a, [p.x - .38, p.y, p.z - .38], [p.x + .38, p.y + HEIGHT, p.z + .38]); if (t < nearest) { nearest = t; target = p; } }
      const guardian = guardianRay(old, a, this.ecosystem.creatures.values(), a.realm ?? 'arena');
      const creature = guardian && guardian.t < nearest ? this.ecosystem.creatures.get(guardian.creature.id) : undefined;
      if (creature) { nearest = guardian!.t; target = undefined; }
      if ((target || creature) && owner) {
        const base = Math.ceil(Math.hypot(a.vx, a.vy, a.vz) / 20 * 2);
        const amount = (base + (a.critical ? Math.floor(this.random() * (Math.floor(base / 2) + 2)) : 0)) * 5;
        if (creature) this.ecosystem.hurt(creature, owner, amount, this.world, this.ecologyHooks);
        else this.damage(target!, owner, amount, false, { projectile: true, source: old, critical: a.critical });
      }
      return !Number.isFinite(nearest) && a.age < 4 && a.y > 0 && Math.abs(a.x) < (a.realm === 'wilds' ? WORLD_LIMIT : LIMIT) && (a.realm === 'wilds' ? Math.abs(a.z) < WORLD_LIMIT : a.z > SECRET.end - 1 && a.z < LIMIT);
    });
    this.ecosystem.step([...this.players.values()], this.world, this.tick, this.ecologyHooks);
    this.combatXp = undefined;
    // Food cannot revive a same-tick death or finish a bite cancelled by a totem save.
    for (const { player: p, totems } of meals) if (p.totems === totems && p.alive && p.connected && p.apples > 0 && p.hp < 100) {
      const amount = Math.min(APPLE.heal, 100 - p.hp); p.hp += amount; p.apples--;
      this.event({ type: 'heal', actor: p.id, text: `Golden apple restored ${Math.round(amount)} HP` });
    }
    if (this.tick % 60 === 0) for (const p of this.players.values()) if (p.alive && p.connected && p.hp < 100 && !p.block && p.charge === 0 && p.hurtTime === 0 && this.rested(p.id) && hearthNear(p, this.world)) {
      p.hp = Math.min(100, p.hp + 3); if (this.tick % 180 === 0) this.event({ type: 'hearth', actor: p.id, text: 'Hearthstone warmth · Resting restores health', position: { x: p.x, y: p.y + .5, z: p.z } });
    }
    this.updateFlags(); this.checkWinner();
  }
  snapshot(): Snapshot { return { world: { seed: this.world.seed, doorOpen: this.world.doorOpen, waystones: this.world.waystones, title: this.world.title, buildRevision: this.world.construction!.revision, forageRevision: this.world.forage!.revision, supplies: [...this.world.supplies!], upgrades: this.world.upgrades, bonds: this.world.bonds, guardians: this.world.guardians }, creatures: this.ecosystem.wire(), mode: this.mode, winnerTeam: this.winnerTeam, scores: { ...this.scores }, flags: this.flags.map(f => ({ ...f })), tick: this.tick, phase: this.phase, countdown: this.countdown, result: this.result, winner: this.winner, round: this.round, host: this.host, practice: this.practice, players: [...this.players.values()].map(p => ({ ...p, buildCount: this.world.construction!.count(p.id) })), arrows: this.arrows.map(a => ({ ...a })), events: this.events }; }
}
