import { Server, Room, ServerError, createRouter, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { PlayTimeLimiter, canonicalIP, clientIP } from './play-time.js';
import { breakMessage } from '../shared/play-time.js';
import { randomBytes, createHash } from 'node:crypto';
import { SeatRegistry } from './seats.js';
import { WorldImport } from './world-import.js';
import { WorldVault, KeepError } from './world-vault.js';
import { WorldKeeper } from './world-keeper.js';
import { KEEP, validHandle, type WorldHandle } from '../shared/world-keep.js';
import { Simulation } from './simulation.js';
import { DT, VERSION, MODES, isExplorationMode, validInput, type Mode } from '../shared/game.js';
import { placeOf } from '../shared/player-place.js';
import { stonePackets, STONE_SYNC, type StonePacket } from '../shared/excavation-sync.js';
import { isUnavailable, unavailableMessage } from './availability.js';

const origins = new Set((process.env.ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://127.0.0.1:3107').split(','));
const activeRooms = new Map<string, ArenaRoom>();
let draining = false;
const seats = new SeatRegistry();
const worldVault = process.env.ARENA_WORLD_STORE_DIR ? await WorldVault.open(process.env.ARENA_WORLD_STORE_DIR) : undefined;
const heartbeatMs = Math.max(1000, Number(process.env.ARENA_HEARTBEAT_MS ?? 30000));
const playTime = await PlayTimeLimiter.open(process.env.ARENA_PLAY_TIME_FILE ?? (process.env.ARENA_WORLD_STORE_DIR ? resolve(process.env.ARENA_WORLD_STORE_DIR, '../play-time.json') : undefined));
const trustedProxies = new Set((process.env.ARENA_TRUSTED_PROXIES ?? '').split(',').filter(Boolean).map(ip => { const canonical = canonicalIP(ip); if (!canonical) throw new Error('Invalid trusted proxy address.'); return canonical; }));
const socketIPs = new WeakMap<object, string>();
function requestIP(req: IncomingMessage) { const forwarded = req.headers['x-forwarded-for']; return clientIP(req.socket.remoteAddress, typeof forwarded === 'string' ? forwarded : undefined, trustedProxies); }
function socketKey(c: Client) { const ip = socketIPs.get((c as unknown as { ref: object }).ref); if (!ip) throw new ServerError(503, 'Client network could not be identified.'); return playTime.key(ip); }
class LimitedTransport extends WebSocketTransport {
  protected async onConnection(raw: any, req: IncomingMessage, upgrade?: any) { socketIPs.set(raw, requestIP(req)); await super.onConnection(raw, req, upgrade); }
}
export class ArenaRoom extends Room {
  publicLobby = true;
  sim = new Simulation(randomBytes(4).readUInt32LE()); accumulator = 0; lastPhase = 'waiting'; idleTicks = 0;
  lastSeen = new Map<string, number>();
  expired = new Set<string>();
  latencySent = new Map<string, number>();
  lastBuildSync = new Map<string, number>();
  lastForageSync = new Map<string, number>();
  lastExcavationSync = new Map<string, number>();
  stoneTransfers = new Map<string, Generator<StonePacket>>();
  stoneToken = 0;
  worldImports = new Map<string, WorldImport>();
  keeper?: WorldKeeper;
  lastKeepHost = '';
  lastKeepRequest = -KEEP.messageMs;
  playerKeys = new Map<string, string>();
  playKeys = new Map<string, string>();
  detachPlay(c: Client) { const key = this.playKeys.get(c.sessionId); if (key) { this.playKeys.delete(c.sessionId); return playTime.leave(key, `${this.roomId}:${c.sessionId}`); } return Promise.resolve(); }
  endPlay(c: Client, seconds: number) { if (this.expired.has(c.sessionId)) return; this.expired.add(c.sessionId); this.rememberPlaces(); void this.checkpointWorld(); c.send('playTime', playTime.status(this.playKeys.get(c.sessionId)!)); c.leave(4008, breakMessage(seconds)); }
  sendKeep(c: Client) { if (c.sessionId === this.sim.host && this.keeper) c.send('worldKeep', this.keeper.status); }
  rememberPlaces() { if (this.sim.phase === 'active' && isExplorationMode(this.sim.mode)) for (const p of this.sim.players.values()) { const key = this.playerKeys.get(p.id); if (key && p.alive && p.connected) this.keeper?.rememberPlace(key, placeOf(p)); } }
  checkpointWorld() { this.rememberPlaces(); return this.keeper?.save(this.sim.world, this.sim.mode) ?? Promise.resolve(); }
  sendWorldInvite(c?: Client) { const summary = this.keeper?.status.summary; if (this.sim.mode !== 'creative' || !summary) return; const invite = { id: summary.id, title: summary.title }; if (c) c.send('worldInvite', invite); else this.broadcast('worldInvite', invite); }
  sendConstruction(c: Client, force = false) { const now = performance.now(); if (!force && now - (this.lastBuildSync.get(c.sessionId) ?? -1000) < 750) return; this.lastBuildSync.set(c.sessionId, now); c.send('construction', this.sim.world.construction!.state(this.sim.world.seed)); }
  sendForage(c: Client, force = false) { const now = performance.now(); if (!force && now - (this.lastForageSync.get(c.sessionId) ?? -1000) < 750) return; this.lastForageSync.set(c.sessionId, now); c.send('forage', this.sim.world.forage!.state(this.sim.world.seed)); }
  sendExcavation(c: Client, force = false) { const now = performance.now(); if (!force && (this.stoneTransfers.has(c.sessionId) || now - (this.lastExcavationSync.get(c.sessionId) ?? -2000) < 2000)) return; this.lastExcavationSync.set(c.sessionId, now); const state = this.sim.world.excavation!.state(this.sim.world.seed); this.stoneTransfers.delete(c.sessionId); if (state.cuts.length + state.veins.length <= STONE_SYNC.rows) c.send('excavation', state); else { const packets = stonePackets(state, ++this.stoneToken); c.send('excavationStream', packets.next().value!); this.stoneTransfers.set(c.sessionId, packets); } }
  async onCreate(options: { private?: boolean; keep?: WorldHandle; invite?: string; mode?: Mode } = {}) {
    if (options.private !== undefined && typeof options.private !== 'boolean') throw new ServerError(400, 'Invalid arena visibility.');
    if (options.keep !== undefined && !validHandle(options.keep)) throw new ServerError(400, 'Choose a saved online world from this browser.');
    if (options.invite !== undefined && (typeof options.invite !== 'string' || !/^[a-f0-9]{32}$/.test(options.invite))) throw new ServerError(400, 'Choose a valid Creative world invite.');
    if (options.keep && options.invite) throw new ServerError(400, 'Choose one world to open.');
    if (options.mode !== undefined && !Object.hasOwn(MODES, options.mode)) throw new ServerError(400, 'Choose a game mode.');
    if (isUnavailable()) throw new ServerError(503, unavailableMessage);
    if (draining || activeRooms.size >= Number(process.env.MAX_ROOMS ?? 8)) throw new ServerError(503, 'Arena is busy. Please try again shortly.');
    this.roomId = randomBytes(5).toString('hex').toUpperCase();
    this.publicLobby = options.private !== true;
    activeRooms.set(this.roomId, this); this.autoDispose = true; this.maxClients = 5; this.maxMessagesPerSecond = 90;
    this.keeper = new WorldKeeper(worldVault, this.roomId, () => { const host = this.clients.find(c => c.sessionId === this.sim.host); if (host) this.sendKeep(host); this.sendWorldInvite(); }, !this.publicLobby);
    try {
      if (options.keep || options.invite) { const loaded = await this.keeper.load(options.keep ?? options.invite!); this.sim.world = loaded.world; this.sim.mode = loaded.mode; this.publicLobby = !loaded.inviteOnly; }
      else if (options.mode) this.sim.mode = options.mode;
      if (isUnavailable() || draining) throw new ServerError(503, 'The arena is temporarily unavailable.');
    } catch (error) {
      await this.keeper.abort(); activeRooms.delete(this.roomId);
      if (error instanceof KeepError) throw new ServerError(error.code, error.message);
      throw error;
    }
    this.seatReservationTimeout = 10; this.setPrivate(true);
    this.onMessage('input', (c, input) => { this.lastSeen.set(c.sessionId, performance.now()); if (!validInput(input)) { c.leave(4002, 'Invalid controls'); return; } this.sim.input(c.sessionId, input); });
    this.onMessage('ready', (c, data) => { const p = this.sim.players.get(c.sessionId); this.lastSeen.set(c.sessionId, performance.now()); if (p?.connected && this.sim.phase === 'waiting') { p.ready = typeof data?.ready === 'boolean' ? data.ready : !p.ready; c.send('snapshot', this.sim.snapshot()); } else c.send('actionError', 'Ready is available in the lobby.'); });
    this.onMessage('interact', c => { this.lastSeen.set(c.sessionId, performance.now()); if (!this.sim.interact(c.sessionId)) c.send('actionError', 'Move closer to the unusual stone panel.'); });
    this.onMessage('gather', c => { this.lastSeen.set(c.sessionId, performance.now()); if (!this.sim.gather(c.sessionId)) c.send('actionError', 'Aim at nearby reeds, crystals or blooms. They regrow in two minutes; gathering rests for five seconds after damage.'); });
    this.onMessage('craft', (c, data) => { this.lastSeen.set(c.sessionId, performance.now()); if (!this.sim.craft(c.sessionId, data?.recipe)) c.send('actionError', 'Stand at an awakened waystone with enough party supplies. Crafting rests for five seconds after damage.'); });
    this.onMessage('creature', (c, data) => { this.lastSeen.set(c.sessionId, performance.now()); if (!this.sim.creature(c.sessionId, data?.action)) c.send('actionError', 'Aim at a nearby creature. Offer one of its favorite supplies to befriend it, or challenge a dormant Shade Warden. Rest for five seconds after damage.'); });
    this.onMessage('warp', (c, data) => { this.lastSeen.set(c.sessionId, performance.now()); if (!this.sim.warp(c.sessionId, data?.destination)) c.send('actionError', 'Find all three skyshards, stand at an awakened waystone, and choose another discovered stone. Travel rests for 2 seconds and is unavailable for 5 seconds after damage.'); });
    this.onMessage('mode', (c, data) => { if (!this.sim.selectMode(c.sessionId, data?.mode)) c.send('actionError', 'Only the host can change mode in the lobby.'); });
    this.onMessage('team', (c, data) => { if (!this.sim.selectTeam(c.sessionId, data?.team)) c.send('actionError', 'Choose Red or Blue in the lobby. Each team holds three players.'); });
    this.onMessage('start', (c, data) => { this.lastSeen.set(c.sessionId, performance.now()); if (this.sim.start(c.sessionId, data?.practice === true)) void this.lock(); else c.send('actionError', 'The host can start when everyone is ready. Team modes need both teams, balanced within one player. Solo expeditions can start normally; other solo modes use Practice solo.'); });
    this.onMessage('practiceArmor', (c, data) => { if (this.sim.previewArmor(c.sessionId, data?.level)) c.send('snapshot', this.sim.snapshot()); else c.send('actionError', 'Armor preview is available during solo practice.'); });
    this.onMessage('lobby', c => this.sim.lobby(c.sessionId));
    this.onMessage('ping', (c, n) => { if (typeof n === 'number' && Number.isFinite(n)) { this.lastSeen.set(c.sessionId, performance.now()); c.send('pong', n); } });
    this.onMessage('latencyAck', (c, n) => { if (n === this.latencySent.get(c.sessionId)) { this.lastSeen.set(c.sessionId, performance.now()); this.sim.rewindTicks.set(c.sessionId, Math.min(6, Math.round((performance.now() - n) / 2 / (1000 / 60)))); this.latencySent.delete(c.sessionId); } });
    this.onMessage('sync', c => { this.lastSeen.set(c.sessionId, performance.now()); this.sendConstruction(c); this.sendForage(c); this.sendExcavation(c); this.sendKeep(c); c.send('snapshot', this.sim.snapshot()); });
    this.onMessage('worldCheckpoint', c => {
      if (c.sessionId !== this.sim.host || !this.sim.players.get(c.sessionId)?.connected) { c.send('actionError', 'The host keeps this world online.'); return; }
      const now = performance.now(); if (now - this.lastKeepRequest < KEEP.messageMs) return; this.lastKeepRequest = now; this.lastSeen.set(c.sessionId, now);
      this.rememberPlaces(); void this.keeper?.save(this.sim.world, this.sim.mode, true);
    });
    this.onMessage('worldForget', async c => {
      if (c.sessionId !== this.sim.host || !this.sim.players.get(c.sessionId)?.connected) { c.send('actionError', 'Only the host can remove the online copy.'); return; }
      const now = performance.now(); if (now - this.lastKeepRequest < KEEP.messageMs) return; this.lastKeepRequest = now; this.lastSeen.set(c.sessionId, now);
      const id = await this.keeper?.forget(); if (id) c.send('worldForgotten', { id });
    });
    this.onMessage('constructionSync', c => { const now = performance.now(); if (now - (this.lastBuildSync.get(c.sessionId) ?? -1000) < 1000) return; this.sendConstruction(c); });
    this.onMessage('forageSync', c => { const now = performance.now(); if (now - (this.lastForageSync.get(c.sessionId) ?? -1000) < 1000) return; this.sendForage(c); });
    this.onMessage('excavationSync', c => { this.sendExcavation(c); });
    this.onMessage('worldRestore', (c, data) => {
      if (c.sessionId !== this.sim.host || this.sim.phase !== 'waiting' || !this.sim.players.get(c.sessionId)?.connected) { this.worldImports.delete(c.sessionId); c.send('actionError', 'The host can restore a world in the lobby.'); return; }
      const now = performance.now(); this.lastSeen.set(c.sessionId, now);
      let upload = this.worldImports.get(c.sessionId); if (!upload) { upload = new WorldImport(); this.worldImports.set(c.sessionId, upload); }
      const ok = data?.type === 'begin' ? upload.begin(data.header, data.count, now, data.cutsCount ?? 0, data.veinsCount ?? 0) : data?.type === 'chunk' ? upload.chunk(data.offset, data.blocks, now, data.kind ?? 'blocks') : data?.type === 'commit' ? this.sim.restore(c.sessionId, upload.finish(now)) : false;
      if (!ok) { this.worldImports.delete(c.sessionId); c.send('actionError', 'That world could not be restored. Choose a Stone Arena world save.'); return; }
      if (data.type === 'commit') { this.keeper?.clearPlaces(); this.sim.resumePlaces.clear(); this.worldImports.delete(c.sessionId); for (const player of this.clients) { this.sendConstruction(player, true); this.sendForage(player, true); this.sendExcavation(player, true); } this.broadcast('snapshot', this.sim.snapshot()); c.send('worldRestored'); void this.checkpointWorld(); }
    });
    this.setTimestep((elapsed) => {
      this.accumulator = Math.min(this.accumulator + elapsed / 1000, .1);
      while (this.accumulator >= DT) { this.sim.step(); this.accumulator -= DT; }
      if (this.sim.phase !== this.lastPhase) {
        this.lastPhase = this.sim.phase;
        if (this.sim.phase === 'waiting' || this.sim.mode === 'creative') void this.unlock(); else void this.lock();
      }
      this.idleTicks = this.sim.phase === 'waiting' && this.clients.length === 0 ? this.idleTicks + 1 : 0;
      if (this.idleTicks > 60 * 30 * 60) void this.disconnect();
    }, 1000 / 60);
    this.setPatchRate(null);
    this.clock.setInterval(() => { if (this.clients.length) void this.checkpointWorld(); }, KEEP.seconds * 1000);
    this.clock.setInterval(() => {
      if (this.lastKeepHost !== this.sim.host) { this.lastKeepHost = this.sim.host; const host = this.clients.find(c => c.sessionId === this.sim.host); if (host) this.sendKeep(host); }
      if (isUnavailable()) { this.broadcast('maintenance'); void this.disconnect(); return; }
      for (const upload of this.worldImports.values()) upload.expire(performance.now());
      for (const c of this.clients) { const key = this.playKeys.get(c.sessionId); if (key) { try { const status = playTime.status(key); if (status.retryAfterSeconds) this.endPlay(c, status.retryAfterSeconds); } catch { c.leave(4010, 'Play-time tracking unavailable. Try again shortly.'); } } }
      for (const c of this.clients) if (!this.expired.has(c.sessionId) && performance.now() - (this.lastSeen.get(c.sessionId) ?? 0) > heartbeatMs) {
        this.expired.add(c.sessionId); c.leave(4000, 'Connection inactive. Join the arena again.');
      }
    }, Math.min(1000, heartbeatMs / 2));
    this.clock.setInterval(() => { for (const c of this.clients) { const n = performance.now(); this.latencySent.set(c.sessionId, n); c.send('latency', n); } }, 2000);
    this.clock.setInterval(() => {
      const snapshot = this.sim.snapshot();
      const construction = this.sim.world.construction!.drain(this.sim.world.seed);
      const forage = this.sim.world.forage!.drain(this.sim.world.seed);
      const excavation = this.sim.world.excavation!.drain(this.sim.world.seed);
      for (const c of this.clients) {
        const socket = c.raw as unknown as { bufferedAmount?: number };
        // Pause large updates during temporary backpressure. Transport heartbeats
        // still reclaim dead sockets; a brief Wi-Fi stall should not forfeit a life.
        if ((socket.bufferedAmount ?? 0) > 256_000) { this.sendExcavationAfterStall.add(c.sessionId); continue; }
        if (this.sendExcavationAfterStall.delete(c.sessionId)) { this.sendConstruction(c, true); this.sendForage(c, true); this.sendExcavation(c, true); }
        if (construction) c.send('blocks' in construction ? 'construction' : 'constructionChanges', construction);
        if (forage) c.send('nodes' in forage ? 'forage' : 'forageChanges', forage);
        if (excavation) { if ('cuts' in excavation) this.sendExcavation(c, true); else c.send('excavationChanges', excavation); }
        const packets = this.stoneTransfers.get(c.sessionId);
        if (packets) for (let n = 0; n < STONE_SYNC.packets; n++) { const next = packets.next(); if (next.done) { this.stoneTransfers.delete(c.sessionId); break; } c.send('excavationStream', next.value); }
        c.send('snapshot', snapshot);
      }
    }, 50);
  }
  sendExcavationAfterStall = new Set<string>();
  onAuth(_c: Client, opts: { version?: number; name?: unknown; seatKey?: unknown; playerKey?: unknown }) {
    if (isUnavailable()) throw new ServerError(503, unavailableMessage);
    if (draining) throw new ServerError(503, 'Server is updating. Please reconnect shortly.');
    if (opts.version !== VERSION) throw new ServerError(400, 'Please refresh to update the game.');
    if (typeof opts.name !== 'string' || !opts.name.trim() || opts.name.length > 24) throw new ServerError(400, 'Enter a nickname (1–24 characters).');
    if (opts.seatKey !== undefined && (typeof opts.seatKey !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(opts.seatKey))) throw new ServerError(400, 'Invalid browser session. Refresh the page.');
    if (opts.playerKey !== undefined && (typeof opts.playerKey !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(opts.playerKey))) throw new ServerError(400, 'Invalid player profile. Refresh the page.');
    const status = playTime.status(socketKey(_c)); if (status.retryAfterSeconds) throw new ServerError(429, breakMessage(status.retryAfterSeconds));
    return true;
  }
  async onJoin(c: Client, opts: { name: string; seatKey?: string; playerKey?: string }) {
    if (isUnavailable()) throw new ServerError(503, unavailableMessage);
    if (!seats.claim(opts.seatKey ?? c.sessionId, this.roomId, c.sessionId)) throw new ServerError(409, 'This browser tab already has a seat. Return to the existing arena or close the duplicate tab. Abandoned connections expire within 30 seconds.');
    // Durable admission can span a heartbeat tick; joining is current activity.
    this.lastSeen.set(c.sessionId, performance.now());
    const playKey = socketKey(c);
    this.playKeys.set(c.sessionId, playKey);
    try { const status = await playTime.join(playKey, `${this.roomId}:${c.sessionId}`); c.send('playTime', status); } catch (e) { await this.detachPlay(c).catch(() => {}); seats.releasePlayer(this.roomId, c.sessionId); throw new ServerError(429, e instanceof Error ? e.message : 'Play-time tracking unavailable.'); }
    const key = opts.playerKey && createHash('sha256').update(opts.playerKey).digest('hex');
    try { this.sim.add(c.sessionId, opts.name.trim().replace(/[\u0000-\u001f<>]/g, '').slice(0, 24) || 'Player', key ? this.keeper?.place(key) : undefined); if (key) this.playerKeys.set(c.sessionId, key); }
    catch (e) { await this.detachPlay(c); seats.releasePlayer(this.roomId, c.sessionId); throw e; }
    this.lastSeen.set(c.sessionId, performance.now());
    if (this.sim.mode === 'creative' && this.sim.phase === 'waiting') this.sim.start(this.sim.host);
    if (c.sessionId === this.sim.host) await this.keeper?.save(this.sim.world, this.sim.mode, true);
    this.sendConstruction(c); this.sendExcavation(c); this.sendKeep(c); this.sendWorldInvite(c); c.send('snapshot', this.sim.snapshot());
  }
  async onDrop(c: Client) { await this.detachPlay(c).catch(() => {}); this.rememberPlaces(); this.sim.disconnect(c.sessionId); void this.checkpointWorld(); if (this.expired.has(c.sessionId)) return; try { await this.allowReconnection(c, isExplorationMode(this.sim.mode) ? 300 : 15); } catch { /* onLeave finalizes the departure */ } }
  async onReconnect(c: Client) { this.lastSeen.set(c.sessionId, performance.now()); const playKey = socketKey(c), status = await playTime.join(playKey, `${this.roomId}:${c.sessionId}`); this.playKeys.set(c.sessionId, playKey); c.send('playTime', status); this.lastSeen.set(c.sessionId, performance.now()); this.expired.delete(c.sessionId); const p = this.sim.players.get(c.sessionId), key = this.playerKeys.get(c.sessionId); if (p) { p.connected = true; if (key && isExplorationMode(this.sim.mode)) this.sim.resumePlace(p, this.keeper?.place(key)); } this.sim.transferHost(); this.sendConstruction(c, true); this.sendForage(c, true); this.sendExcavation(c, true); this.sendKeep(c); this.sendWorldInvite(c); c.send('snapshot', this.sim.snapshot()); }
  async onLeave(c: Client) { await this.detachPlay(c).catch(() => {}); this.rememberPlaces(); this.sim.leave(c.sessionId); void this.checkpointWorld(); seats.releasePlayer(this.roomId, c.sessionId); this.playerKeys.delete(c.sessionId); this.lastSeen.delete(c.sessionId); this.expired.delete(c.sessionId); this.latencySent.delete(c.sessionId); this.lastBuildSync.delete(c.sessionId); this.lastForageSync.delete(c.sessionId); this.lastExcavationSync.delete(c.sessionId); this.sendExcavationAfterStall.delete(c.sessionId); this.stoneTransfers.delete(c.sessionId); this.worldImports.delete(c.sessionId); }
  async onDispose() { this.rememberPlaces(); try { await this.keeper?.close(this.sim.world, this.sim.mode); } finally { activeRooms.delete(this.roomId); seats.releaseRoom(this.roomId); } }
}

const transport = new LimitedTransport({
  verifyClient: (info, done) => { try { const status = playTime.status(playTime.key(requestIP(info.req))); if (status.retryAfterSeconds) { done(false, 429, breakMessage(status.retryAfterSeconds), { 'Retry-After': String(status.retryAfterSeconds), 'Cache-Control': 'no-store' }); return; } done(true); } catch { done(false, 503, 'Play-time tracking unavailable.'); } },
  maxPayload: 4096, perMessageDeflate: false, pingInterval: 3000, pingMaxRetries: 2,
  beforeUpgrade: (_url, ctx) => {
    if (isUnavailable()) return new Response(unavailableMessage, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' } });
    const origin = ctx.headers.get('origin');
    if (origin && !origins.has(origin)) return new Response('Origin denied', { status: 403 });
  },
});
const server = new Server({ transport, greet: false, express: app => {
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { res.status(403).send('Origin denied'); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; } next();
  });
  if (process.env.ACME_CHALLENGE_DIR) app.use('/.well-known/acme-challenge', express.static(process.env.ACME_CHALLENGE_DIR, { dotfiles: 'deny' }));
  app.get('/health', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.status(draining ? 503 : 200).json({ ok: !draining, available: !isUnavailable(), version: VERSION, rooms: activeRooms.size, uptime: Math.floor(process.uptime()) }); });
  app.get('/config.json', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ api: process.env.ARENA_API_URL ?? '/arena-api', available: !isUnavailable() }); });
  app.get('/play-time', (req, res) => { res.setHeader('Cache-Control', 'no-store'); try { res.json(playTime.status(playTime.key(req.headers['x-real-ip'] as string))); } catch { res.status(503).json({ error: 'Play-time tracking unavailable. Try again shortly.' }); } });
  app.get('/arenas', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isUnavailable() || draining) { res.status(503).json({ error: 'Arena is temporarily unavailable.' }); return; }
    res.json({ arenas: [...activeRooms.values()].filter(room => room.publicLobby && (room.sim.phase === 'waiting' || room.sim.mode === 'creative' && room.sim.phase === 'active') && !room.locked && room.clients.length > 0 && room.clients.length < room.maxClients).map(room => ({
      roomId: room.roomId, mode: room.sim.mode, host: room.sim.players.get(room.sim.host)?.name ?? 'Open arena', players: room.sim.players.size, capacity: room.maxClients,
    })).filter(room => room.players < room.capacity) });
  });
  app.get('/worlds/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isUnavailable() || draining) { res.status(503).json({ error: 'Worlds are temporarily unavailable.' }); return; }
    try {
      const id = typeof req.params.id === 'string' ? req.params.id.toLowerCase() : '', invite = await worldVault?.invite(id);
      if (!invite) { res.status(404).json({ error: 'That Creative world could not be found.' }); return; }
      const active = [...activeRooms.values()].find(room => room.sim.mode === 'creative' && room.keeper?.status.summary?.id === id);
      res.json({ id: invite.id, title: invite.title, ...(active ? { roomId: active.roomId } : {}) });
    } catch { res.status(503).json({ error: 'This world could not be opened. Try again shortly.' }); }
  });
  app.use((req, res, next) => {
    // Keep installed-app metadata/offline launch functional, without serving game code.
    if (!isUnavailable() || ['/sw.js', '/offline.html', '/manifest.webmanifest', '/favicon.svg'].includes(req.path) || /^\/icons\/[a-zA-Z0-9-]+\.png$/.test(req.path)) { next(); return; }
    res.status(503).set({ 'Cache-Control': 'no-store', 'Retry-After': '300' });
    if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html' || req.accepts(['html', 'json']) === 'html')) res.sendFile(resolve('dist/maintenance.html'));
    else res.json({ code: 503, error: unavailableMessage });
  });
  app.use(express.static(resolve('dist'), { maxAge: '1h', setHeaders(res, path) { if (['index.html', 'sw.js', 'manifest.webmanifest'].some(file => path.endsWith(file))) res.setHeader('Cache-Control', 'no-cache'); } }));
} });
// Colyseus handles matchmaking before Express. Reject seat reservations here too.
server.router = createRouter({}, { onRequest: request => {
  if (request.method === 'POST') { try { const status = playTime.status(playTime.key(request.headers.get('x-real-ip')!)); if (status.retryAfterSeconds) return Response.json({ code: 429, error: breakMessage(status.retryAfterSeconds) }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(status.retryAfterSeconds) } }); } catch { return Response.json({ code: 503, error: 'Play-time tracking unavailable.' }, { status: 503 }); } }
  if (isUnavailable()) return Response.json({ code: 503, error: unavailableMessage }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' } });
} });
server.define('arena', ArenaRoom);
server.onBeforeShutdown(async () => { draining = true; await playTime.close(); await Promise.all([...activeRooms.values()].map(room => room.checkpointWorld())); });
await server.listen(Number(process.env.PORT ?? 3107), process.env.HOST ?? '127.0.0.1');
// Run before Colyseus routing: its default IP resolver trusts arbitrary headers.
transport.server!.prependListener('request', (req: IncomingMessage) => { try { const ip = requestIP(req); req.headers['x-real-ip'] = ip; req.headers['x-forwarded-for'] = ip; delete req.headers['x-client-ip']; } catch { delete req.headers['x-real-ip']; delete req.headers['x-forwarded-for']; delete req.headers['x-client-ip']; } });
const playTimer = setInterval(() => { void playTime.checkpoint().catch(() => { for (const room of activeRooms.values()) for (const c of room.clients) c.leave(4010, 'Play-time tracking unavailable. Try again shortly.'); }); for (const room of activeRooms.values()) for (const c of room.clients) { const key = room.playKeys.get(c.sessionId); if (key) { try { c.send('playTime', playTime.status(key)); } catch { /* storage failure is handled above */ } } } }, 5000);
playTimer.unref();
console.log(`Stone Arena listening on ${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 3107}`);
