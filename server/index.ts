import { Server, Room, ServerError, createRouter, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SeatRegistry } from './seats.js';
import { Simulation } from './simulation.js';
import { DT, VERSION, validInput } from '../shared/game.js';
import { isUnavailable, unavailableMessage } from './availability.js';

const origins = new Set((process.env.ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://127.0.0.1:3107').split(','));
const activeRooms = new Map<string, ArenaRoom>();
let draining = false;
const seats = new SeatRegistry();
const heartbeatMs = Math.max(1000, Number(process.env.ARENA_HEARTBEAT_MS ?? 30000));
export class ArenaRoom extends Room {
  publicLobby = true;
  sim = new Simulation(randomBytes(4).readUInt32LE()); accumulator = 0; lastPhase = 'waiting'; idleTicks = 0;
  lastSeen = new Map<string, number>();
  expired = new Set<string>();
  latencySent = new Map<string, number>();
  onCreate(options: { private?: boolean } = {}) {
    if (options.private !== undefined && typeof options.private !== 'boolean') throw new ServerError(400, 'Invalid arena visibility.');
    if (isUnavailable()) throw new ServerError(503, unavailableMessage);
    if (draining || activeRooms.size >= Number(process.env.MAX_ROOMS ?? 8)) throw new ServerError(503, 'Arena is busy. Please try again shortly.');
    this.roomId = randomBytes(5).toString('hex').toUpperCase();
    this.publicLobby = options.private !== true;
    activeRooms.set(this.roomId, this); this.autoDispose = true; this.maxClients = 5; this.maxMessagesPerSecond = 90;
    this.seatReservationTimeout = 10; this.setPrivate(true);
    this.onMessage('input', (c, input) => { this.lastSeen.set(c.sessionId, performance.now()); if (!validInput(input)) { c.leave(4002, 'Invalid controls'); return; } this.sim.input(c.sessionId, input); });
    this.onMessage('ready', (c, data) => { const p = this.sim.players.get(c.sessionId); this.lastSeen.set(c.sessionId, performance.now()); if (p?.connected && this.sim.phase === 'waiting') { p.ready = typeof data?.ready === 'boolean' ? data.ready : !p.ready; c.send('snapshot', this.sim.snapshot()); } else c.send('actionError', 'Ready is available in the lobby.'); });
    this.onMessage('interact', c => { this.lastSeen.set(c.sessionId, performance.now()); if (!this.sim.interact(c.sessionId)) c.send('actionError', 'Move closer to the unusual stone panel.'); });
    this.onMessage('mode', (c, data) => { if (!this.sim.selectMode(c.sessionId, data?.mode)) c.send('actionError', 'Only the host can change mode in the lobby.'); });
    this.onMessage('team', (c, data) => { if (!this.sim.selectTeam(c.sessionId, data?.team)) c.send('actionError', 'Choose Red or Blue in the lobby. Each team holds three players.'); });
    this.onMessage('start', (c, data) => { this.lastSeen.set(c.sessionId, performance.now()); if (this.sim.start(c.sessionId, data?.practice === true)) void this.lock(); else c.send('actionError', 'The host can start when everyone is ready. Team modes need both teams, balanced within one player. With one player, choose Practice solo.'); });
    this.onMessage('practiceArmor', (c, data) => { if (this.sim.previewArmor(c.sessionId, data?.level)) c.send('snapshot', this.sim.snapshot()); else c.send('actionError', 'Armor preview is available during solo practice.'); });
    this.onMessage('lobby', c => this.sim.lobby(c.sessionId));
    this.onMessage('ping', (c, n) => { if (typeof n === 'number' && Number.isFinite(n)) { this.lastSeen.set(c.sessionId, performance.now()); c.send('pong', n); } });
    this.onMessage('latencyAck', (c, n) => { if (n === this.latencySent.get(c.sessionId)) { this.sim.rewindTicks.set(c.sessionId, Math.min(6, Math.round((performance.now() - n) / 2 / (1000 / 60)))); this.latencySent.delete(c.sessionId); } });
    this.onMessage('sync', c => { this.lastSeen.set(c.sessionId, performance.now()); c.send('snapshot', this.sim.snapshot()); });
    this.setTimestep((elapsed) => {
      this.accumulator = Math.min(this.accumulator + elapsed / 1000, .1);
      while (this.accumulator >= DT) { this.sim.step(); this.accumulator -= DT; }
      if (this.sim.phase !== this.lastPhase) {
        this.lastPhase = this.sim.phase;
        if (this.sim.phase === 'waiting') void this.unlock(); else void this.lock();
      }
      this.idleTicks = this.sim.phase === 'waiting' ? this.idleTicks + 1 : 0;
      if (this.idleTicks > 60 * 30 * 60) void this.disconnect();
    }, 1000 / 60);
    this.setPatchRate(null);
    this.clock.setInterval(() => {
      if (isUnavailable()) { this.broadcast('maintenance'); void this.disconnect(); return; }
      for (const c of this.clients) if (!this.expired.has(c.sessionId) && performance.now() - (this.lastSeen.get(c.sessionId) ?? 0) > heartbeatMs) {
        this.expired.add(c.sessionId); c.leave(4000, 'Connection inactive. Join the arena again.');
      }
    }, Math.min(1000, heartbeatMs / 2));
    this.clock.setInterval(() => { for (const c of this.clients) { const n = performance.now(); this.latencySent.set(c.sessionId, n); c.send('latency', n); } }, 2000);
    this.clock.setInterval(() => {
      const snapshot = this.sim.snapshot();
      for (const c of this.clients) {
        const socket = c.raw as unknown as { bufferedAmount?: number };
        if ((socket.bufferedAmount ?? 0) > 256_000) { c.leave(4002, 'Connection too slow'); continue; }
        c.send('snapshot', snapshot);
      }
    }, 50);
  }
  onAuth(_c: Client, opts: { version?: number; name?: unknown; seatKey?: unknown }) {
    if (isUnavailable()) throw new ServerError(503, unavailableMessage);
    if (draining) throw new ServerError(503, 'Server is updating. Please reconnect shortly.');
    if (opts.version !== VERSION) throw new ServerError(400, 'Please refresh to update the game.');
    if (typeof opts.name !== 'string' || !opts.name.trim() || opts.name.length > 24) throw new ServerError(400, 'Enter a nickname (1–24 characters).');
    if (opts.seatKey !== undefined && (typeof opts.seatKey !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(opts.seatKey))) throw new ServerError(400, 'Invalid browser session. Refresh the page.');
    return true;
  }
  onJoin(c: Client, opts: { name: string; seatKey?: string }) {
    if (isUnavailable()) throw new ServerError(503, unavailableMessage);
    if (!seats.claim(opts.seatKey ?? c.sessionId, this.roomId, c.sessionId)) throw new ServerError(409, 'This browser tab already has a seat. Return to the existing arena or close the duplicate tab. Abandoned connections expire within 30 seconds.');
    try { this.sim.add(c.sessionId, opts.name.trim().replace(/[\u0000-\u001f<>]/g, '').slice(0, 24) || 'Player'); }
    catch (e) { seats.releasePlayer(this.roomId, c.sessionId); throw e; }
    this.lastSeen.set(c.sessionId, performance.now()); c.send('snapshot', this.sim.snapshot());
  }
  async onDrop(c: Client) { this.sim.disconnect(c.sessionId); try { await this.allowReconnection(c, 15); } catch { /* onLeave finalizes the forfeit */ } }
  onReconnect(c: Client) { this.lastSeen.set(c.sessionId, performance.now()); this.expired.delete(c.sessionId); const p = this.sim.players.get(c.sessionId); if (p) p.connected = true; this.sim.transferHost(); c.send('snapshot', this.sim.snapshot()); }
  onLeave(c: Client) { this.sim.leave(c.sessionId); seats.releasePlayer(this.roomId, c.sessionId); this.lastSeen.delete(c.sessionId); this.expired.delete(c.sessionId); this.latencySent.delete(c.sessionId); }
  onDispose() { activeRooms.delete(this.roomId); seats.releaseRoom(this.roomId); }
}

const transport = new WebSocketTransport({
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
  app.get('/arenas', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isUnavailable() || draining) { res.status(503).json({ error: 'Arena is temporarily unavailable.' }); return; }
    res.json({ arenas: [...activeRooms.values()].filter(room => room.publicLobby && room.sim.phase === 'waiting' && !room.locked && room.clients.length > 0 && room.clients.length < room.maxClients).map(room => ({
      roomId: room.roomId, mode: room.sim.mode, host: room.sim.players.get(room.sim.host)?.name ?? 'Open arena', players: room.sim.players.size, capacity: room.maxClients,
    })).filter(room => room.players < room.capacity) });
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
server.router = createRouter({}, { onRequest: () => {
  if (isUnavailable()) return Response.json({ code: 503, error: unavailableMessage }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' } });
} });
server.define('arena', ArenaRoom);
server.onBeforeShutdown(() => { draining = true; });
await server.listen(Number(process.env.PORT ?? 3107), process.env.HOST ?? '127.0.0.1');
console.log(`Stone Arena listening on ${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 3107}`);
