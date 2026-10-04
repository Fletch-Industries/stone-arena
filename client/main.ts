import { WorldBook } from './world-book.js';
import { WorldKeeps } from './world-keeps.js';
import { bindWorldContents, worldContentsReady } from './world-contents.js';
import { WorldVisits, validInvite, type WorldInvite } from './world-visits.js';
import { onlineWorldsPanel } from './worlds-online.js';
import { KEEP, validHandle, validKeepSummary, type KeepStatus, type WorldHandle } from '../shared/world-keep.js';
import { ECHO_CHISEL, Excavation, type ExcavationState, type ExcavationChanges } from '../shared/excavation.js';
import { StoneReceiver, type StonePacket } from '../shared/excavation-sync.js';
import { Forage, FORAGE, gatherTarget, suppliesNear, SUPPLIES, type ForageState, type ForageChanges } from '../shared/forage.js';
import { recipeFor } from '../shared/crafting.js';
import { HEARTHSTONE, SKY_SAIL } from '../shared/sailing.js';
import { loomPanel } from './loom.js';
import { parseWorldSave, SAVE_BYTES, type WorldSave } from '../shared/world-save.js';
import { BUILD, RUNE_KINDS, Construction, validKind, type ConstructionState, type ConstructionChanges } from '../shared/construction.js';
import { ArenaAudio } from './audio.js';
import { ConstellationAtlas } from './atlas.js';
import { creatureHUD } from './creature-hud.js';
import { CREATURES, creatureView } from '../shared/creatures.js';
import { shardSites, shardCount } from '../shared/expedition.js';
import { BIOMES, biomeAt } from '../shared/biomes.js';
import { HOME_WAYSTONE, nearbyWaystone, waystoneSites, awakenedCount } from '../shared/waystones.js';
import { nearSecret } from '../shared/world.js';
import { Client, type Room } from '@colyseus/sdk';
import { ArenaScene } from './scene.js';
import { CTF, MODES, isExplorationMode, isTeamMode, TEAMS, playerColor, APPLE, ARMOR_TIERS, armorTier, DT, VERSION, attackStrength, WEAPONS, idleInput, move, type Mode, type Body, type Input, type Player, type Snapshot, type Weapon, type Offhand } from '../shared/game.js';
import './style.css';
import { totemNotice } from './totem.js';
import { hotbar } from './hotbar.js';
import { patchHUD } from './hud-patch.js';
import { ControlPulse } from './control-pulse.js';
import { PlayTimeDisplay } from './play-time.js';
import type { PlayTimeStatus } from '../shared/play-time.js';
import { exitPointerLock } from './pointer.js';
import { TouchControls } from './touch.js';
import { installGame } from './pwa.js';
import { PERSPECTIVES, PERSPECTIVE_LABELS, nextPerspective, validPerspective, type Perspective } from './camera.js';
import { arenaLocation } from '../shared/arena.js';
import type { OpenArena } from '../shared/lobbies.js';

const app = document.querySelector<HTMLDivElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const brand = '<div class="brand"><i class="brand-mark"></i> Stone Arena <small>Fletch Industries</small></div>';
let room: Room | undefined, snapshot: Snapshot | undefined, local: Body | undefined;
let offhand: Offhand = 'shield';
let sculpting = false, excavation = new Excavation(), excavationSeed: number | undefined, lastExcavationSync = -2000;
const stoneReceiver = new StoneReceiver();
function syncExcavation() { const now = performance.now(); if (room && now - lastExcavationSync >= 2000) { lastExcavationSync = now; room.send('excavationSync'); } }
let weaving = false, weaveKind = 0, construction = new Construction(), constructionSeed: number | undefined, lastConstructionSync = -1000;
function syncConstruction() { const now = performance.now(); if (room && now - lastConstructionSync >= 1000) { lastConstructionSync = now; room.send('constructionSync'); } }
let forage = new Forage(), forageSeed: number | undefined, lastForageSync = -1000, trackedSupply: number | undefined, trackedRecipe: string | undefined;
function syncForage() { const now = performance.now(); if (room && now - lastForageSync >= 1000) { lastForageSync = now; room.send('forageSync'); } }
function updateWorldContents() { if (snapshot) bindWorldContents(snapshot.world, { construction, constructionSeed, excavation, excavationSeed, forage, forageSeed }); }
function contentsReady() { return !!snapshot && !importPending && worldContentsReady(snapshot.world, { construction, constructionSeed, excavation, excavationSeed, forage, forageSeed }, stoneReceiver.active); }
function openLoom() { if (me()?.realm !== 'wilds' || !me()?.alive || snapshot?.phase !== 'active') return; releasePointer(); modal = 'loom'; renderUI(); }
function chooseRune(kind: number) { if (kind === 6 && !((snapshot?.world.upgrades ?? 0) & HEARTHSTONE)) { openLoom(); return; } weaveKind = kind; mouseAttack = mouseBlock = attackQueued = false; }
function toggleWeaving() { if (me()?.realm !== 'wilds' || !me()?.alive || snapshot?.phase !== 'active' || disconnected) return; resetControls(); sculpting = false; weaving = !weaving; enableAudio(); renderUI(); }
function toggleSculpting() { if (me()?.realm !== 'wilds' || !me()?.alive || snapshot?.phase !== 'active' || disconnected) return; if (!((snapshot.world.upgrades ?? 0) & ECHO_CHISEL)) { openLoom(); return; } resetControls(); weaving = false; sculpting = !sculpting; enableAudio(); renderUI(); }
const totemPopup = document.createElement('div'); totemPopup.className = 'totem-popup'; totemPopup.hidden = true; totemPopup.innerHTML = totemNotice(); document.body.append(totemPopup);
let totemTimer: ReturnType<typeof setTimeout> | undefined;
let yaw = 0, pitch = 0, weapon: Weapon = 'sword', seq = 0, accumulator = 0;
let pending: Input[] = [], lastPhase = '', lastRound = 0, eventId = 0, ping = 0, notice = '', error = '', busy = false;
let modal: 'settings' | 'controls' | 'atlas' | 'worlds' | 'loom' | '' = '', scoreboard = false, disconnected = false, lastHud = 0, nickname = '';
const atlas = new ConstellationAtlas(), worldBook = new WorldBook(), worldKeeps = new WorldKeeps(), worldVisits = new WorldVisits();
let worldInvite: WorldInvite | undefined;
let onlineKeep: KeepStatus | undefined;
let keepCooldown = 0;
let lastMemoryKey = '', lastMemoryAt = 0, importPending = false;
let importTimer: ReturnType<typeof setTimeout> | undefined;
function rememberWorld(force = false) { if (!room || !snapshot || snapshot.host !== room.sessionId || !contentsReady()) return; const key = `${room.roomId}:${snapshot.world.seed}:${construction.revision}:${excavation.revision}:${snapshot.world.waystones}:${snapshot.world.doorOpen}:${snapshot.world.supplies?.join()}:${snapshot.world.upgrades}:${snapshot.world.bonds}:${snapshot.world.guardians}`; if (force || key !== lastMemoryKey && Date.now() - lastMemoryAt > 10000) { worldBook.remember(snapshot.world); lastMemoryKey = key; lastMemoryAt = Date.now(); } }
function exportWorld() { if (!snapshot || !contentsReady()) return; const world = worldBook.remember(snapshot.world), url = URL.createObjectURL(new Blob([JSON.stringify(world)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = `stone-arena-${world.seed}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notice = 'World saved · Keep the file to explore it again'; renderUI(); }
async function importWorld(world: WorldSave) {
  if (!room || snapshot?.phase !== 'waiting' || snapshot.host !== room.sessionId || importPending || disconnected) return;
  importPending = true; notice = 'Restoring your world…'; renderUI(); const target = room;
  const { blocks, cuts = [], veins = [], ...header } = world; target.send('worldRestore', { type: 'begin', header, count: blocks.length, cutsCount: cuts.length, veinsCount: veins.length });
  importTimer = setTimeout(() => { importPending = false; notice = 'World restore timed out. Try again.'; renderUI(); }, 20000);
  for (const [kind, rows] of [['blocks', blocks], ['cuts', cuts], ['veins', veins]] as const) for (let offset = 0; offset < rows.length; offset += 64) { if (room !== target || disconnected || !importPending) return; target.send('worldRestore', { type: 'chunk', kind, offset, blocks: rows.slice(offset, offset + 64) }); await new Promise(resolve => setTimeout(resolve, 35)); }
  if (room === target && importPending) target.send('worldRestore', { type: 'commit' });
}
function visitedWorldsPanel() {
  return worldVisits.entries.length ? `<h3>Creative worlds you visited</h3><p class="help">Join whenever you want. Use the same nickname in this browser to resume your last position.</p>${!worldVisits.available ? '<p role="status">This browser cannot remember profiles. Keep your world invite before leaving.</p>' : ''}<div class="world-memories">${worldVisits.entries.map(w => `<div class="world-memory"><b>${escape(w.title)}</b><button class="btn" data-action="join-world" data-world="${w.id}" ${!room && !busy ? '' : 'disabled'}>Join world</button></div>`).join('')}</div>` : '';
}
function worldsPanel() {
  const canRestore = !!room && snapshot?.phase === 'waiting' && snapshot.host === room.sessionId && !disconnected && !importPending;
  const online = onlineWorldsPanel(worldKeeps.entries, worldKeeps.available, onlineKeep, !!room && snapshot?.host === room.sessionId, !room && !busy && !!nickname.trim(), busy || disconnected || importPending || performance.now() < keepCooldown);
  return `${visitedWorldsPanel()}${online}${!room && error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}<h3>Browser memories and files</h3><p>Build a place with your friends and come back to it. Your world remembers its terrain, tunnels, runes, party supplies, upgrades, awakened waystones and field guide.</p>${snapshot ? `<button class="btn gold wide" data-action="export-world" ${contentsReady() ? '' : 'disabled'}>${contentsReady() ? 'Download this world' : 'Receiving world terrain…'}</button>` : ''}<p class="help">The host keeps up to three recent worlds in this browser. Download a world to keep it or move it to another device. Restore it in a lobby, then start a fresh adventure.</p>${worldBook.available ? '' : '<p role="status">This browser cannot keep worlds. Download a file before leaving.</p>'}<div class="world-memories">${worldBook.entries.map(m => `<div class="world-memory"><div><b>${escape(m.world.title)}</b><small>${m.world.blocks.length} ${m.world.blocks.length === 1 ? 'rune' : 'runes'} · ${m.world.cuts?.length ?? 0} openings · ${awakenedCount(m.world.waystones)}/8 waystones · ${new Date(m.savedAt).toLocaleDateString()}</small></div><button class="btn" data-action="restore-memory" data-seed="${m.world.seed}" ${canRestore ? '' : 'disabled'}>Restore</button><button class="text-btn" data-action="forget-world" data-seed="${m.world.seed}" aria-label="Forget ${escape(m.world.title)}">×</button></div>`).join('') || '<p class="help">Your first world will appear here after you create an arena.</p>'}</div><label class="btn wide world-file ${canRestore ? '' : 'disabled'}">Open a world file<input type="file" id="world-file" accept=".json,application/json" ${canRestore ? '' : 'disabled'}></label><details class="world-paste"><summary>Paste a world save</summary><label class="label" for="world-paste">Saved world</label><textarea class="input" id="world-paste" rows="3" maxlength="${SAVE_BYTES}" ${canRestore ? '' : 'disabled'}></textarea><button class="btn" data-action="restore-paste" ${canRestore ? '' : 'disabled'}>Restore pasted world</button></details><p class="help">New rounds reset health, arrows and personal skyshards. Restoring a world resets everyone's readiness and renews resource patches. Shared buildings, discoveries, supplies, crafted upgrades and freed Wardens carry forward.</p>`;
}
let trackedWaystone: number | undefined;
let privateArena = false, roomCode = new URLSearchParams(location.search).get('room') ?? '';
let openArenas: OpenArena[] = [], arenaListState: 'loading' | 'ready' | 'error' = 'loading', refreshingArenas = false;
const glidePulse = new ControlPulse(), dashPulse = new ControlPulse(), jumpPulse = new ControlPulse();
let mouseAttack = false, mouseBlock = false, expectedUnlock = false, dragLook = false, attackQueued = false;
let resultsEnteredAt = 0, lastForwardTap = -1000, doubleTapSprint = false;
let seatKey: string = crypto.randomUUID();
try { seatKey = sessionStorage.getItem('stone-seat') || seatKey; sessionStorage.setItem('stone-seat', seatKey); } catch { /* per-page identity when storage is unavailable */ }
const keys = new Set<string>();
const mobileQuery = matchMedia('(pointer: coarse), (max-width: 900px)');
let mobile = mobileQuery.matches, touchPlaying = false;
const settings = { sensitivity: 1, volume: .35, music: true, quality: mobile ? 'low' : 'medium', fov: 120, fovVersion: 2, perspective: 'first' as Perspective, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
const touch = new TouchControls({
  aim: (x, y) => { if (touchPlaying) { yaw -= x * .005 * settings.sensitivity; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); pitch = Math.max(-1.5, Math.min(1.5, pitch - y * .005 * settings.sensitivity)); } },
  attack: down => { mouseAttack = down; if (down) attackQueued = true; },
  block: down => { mouseBlock = down; },
  menu: () => { releasePointer(); modal = 'settings'; renderUI(); },
  scores: () => { releasePointer(); scoreboard = true; renderUI(); },
  offhand: () => swapOffhand(),
  perspective: () => setPerspective(nextPerspective(settings.perspective)),
});
document.body.classList.toggle('mobile', mobile);
mobileQuery.addEventListener('change', () => { mobile = mobileQuery.matches; document.body.classList.toggle('mobile', mobile); releasePointer(); renderUI(); });
try {
  const saved = JSON.parse(localStorage.getItem('stone-settings') ?? '{}');
  Object.assign(settings, saved);
  // Apply the requested wider FOV once for returning players; later adjustments persist.
  if (saved.fovVersion !== 2) settings.fov = 120;
  settings.fov = Math.max(60, Math.min(120, Number(settings.fov) || 120)); settings.fovVersion = 2;
  if (!validPerspective(settings.perspective)) settings.perspective = 'first';
  localStorage.setItem('stone-settings', JSON.stringify(settings));
  nickname = localStorage.getItem('stone-name') ?? '';
} catch { /* private browser storage may be unavailable */ }
const arenaAudio = new ArenaAudio();
function enableAudio() { arenaAudio.enable(); }
let scene: ArenaScene;
try { scene = new ArenaScene(canvas); scene.settings(settings.quality, settings.fov, settings.reduced); scene.perspective = settings.perspective; touch.perspective(PERSPECTIVE_LABELS[settings.perspective]); }
catch { app.innerHTML = '<div class="overlay interactive"><div class="panel"><h2>Graphics unavailable</h2><p>Stone Arena needs WebGL 2. Enable hardware acceleration and try a current browser.</p></div></div>'; throw new Error('WebGL 2 unavailable'); }
const api = await fetch(new URL('config.json', location.href)).then(r => r.ok ? r.json() : Promise.reject()).then(c => c.api as string).catch(() => '/arena-api');
const endpoint = new URL(api, location.origin).href;
const client = new Client(endpoint);
const playTimeDisplay = new PlayTimeDisplay(() => !!room);
async function refreshPlayTime() { try { const response = await fetch(`${endpoint.replace(/\/$/, '')}/play-time`, { cache: 'no-store' }); if (response.ok) playTimeDisplay.update(await response.json()); } catch { /* Server admission remains authoritative during outages. */ } }
playTimeDisplay.onCheck(() => { void refreshPlayTime(); });
void refreshPlayTime();
setInterval(() => { if (!document.hidden) void refreshPlayTime(); }, 5000);
function openArenaHTML() {
  if (arenaListState === 'loading') return '<p class="help">Looking for open arenas…</p>';
  if (arenaListState === 'error') return '<p class="help">Could not load arenas. Try Refresh, or join with a room code.</p>';
  if (!openArenas.length) return '<p class="help">No open arenas yet. Create one and invite your friends.</p>';
  return openArenas.map(arena => `<div class="arena-row"><div><b>${escape(arena.host)}’s arena</b><small>${arena.players} / ${arena.capacity} players · ${MODES[arena.mode]}</small></div><button class="btn gold" data-action="join-open" data-room="${escape(arena.roomId)}" aria-label="Join ${escape(arena.host)}’s arena">Join →</button></div>`).join('');
}
async function refreshArenas() {
  if (room || busy || refreshingArenas) return;
  refreshingArenas = true;
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/arenas`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Directory unavailable');
    const data = await response.json() as { arenas: OpenArena[] };
    openArenas = data.arenas; arenaListState = 'ready';
  } catch { arenaListState = 'error'; }
  finally {
    refreshingArenas = false;
    const list = app.querySelector('#open-arenas');
    const html = openArenaHTML(); if (list && list.innerHTML !== html) list.innerHTML = html;
  }
}
function showUnavailable() {
  clearSession();
  if (room) { room.reconnection.enabled = false; room.connection.close(); }
  location.replace('/');
}
// Also move idle lobby tabs to the landing page when the operator pauses the game.
async function checkAvailability() {
  try {
    const response = await fetch(new URL('config.json', location.href), { cache: 'no-store' });
    if (response.ok && (await response.json()).available === false) showUnavailable();
  } catch { /* A network outage uses the existing reconnect behavior. */ }
}
void checkAvailability();
setInterval(() => { if (!document.hidden) { void checkAvailability(); void refreshArenas(); } }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void checkAvailability(); if (room?.connection.isOpen) { room.send('ping', performance.now()); room.send('sync'); } } });
// Menus, lobbies and spectators keep a live seat without movement or animation frames.
setInterval(() => { if (room?.connection.isOpen && !disconnected) room.send('ping', performance.now()); }, 5000);
const me = () => snapshot?.players.find(p => p.id === room?.sessionId);
const locked = () => document.pointerLockElement === canvas;
const controlling = () => locked() || dragLook || touchPlaying;
function resetControls() { glidePulse.clear(); dashPulse.clear(); jumpPulse.clear(); doubleTapSprint = false; lastForwardTap = -1000; keys.clear(); mouseAttack = false; mouseBlock = false; attackQueued = false; touch.reset(); }
function releasePointer() { touchPlaying = false; dragLook = false; expectedUnlock = true; exitPointerLock(document); resetControls(); }
async function lockPointer() {
  scene.inspectArmor = false;
  enableAudio(); modal = ''; scoreboard = false; if (mobile) { touchPlaying = true; notice = ''; renderUI(); return; } renderUI();
  try { await canvas.requestPointerLock(); dragLook = false; notice = ''; } catch { dragLook = true; notice = 'Hold Alt and drag to look · WASD to move · Escape for menu'; } renderUI();
}
function swapOffhand() {
  if (snapshot?.phase !== 'active' || !me()?.alive || disconnected) return;
  offhand = offhand === 'shield' ? 'totem' : 'shield'; mouseBlock = false; renderUI();
}
function setPerspective(view: Perspective) {
  settings.perspective = view; scene.perspective = view; scene.inspectArmor = false;
  touch.perspective(PERSPECTIVE_LABELS[view]);
  try { localStorage.setItem('stone-settings', JSON.stringify(settings)); } catch { /* optional */ }
  renderUI();
}
function clearSession() { try { sessionStorage.removeItem('stone-session'); } catch { /* optional */ } }
async function leaveRoom() {
  const leaving = room; if (!leaving || busy) return; rememberWorld(true); importPending = false; clearTimeout(importTimer);
  busy = true; leaving.reconnection.enabled = false; room = undefined; snapshot = undefined; local = undefined;
  disconnected = false; notice = ''; modal = ''; scoreboard = false; releasePointer(); clearSession();
  history.replaceState(null, '', location.pathname); error = ''; renderUI();
  try {
    if (leaving.connection.isOpen) await Promise.race([leaving.leave(), new Promise(resolve => setTimeout(resolve, 1500))]);
  } finally { leaving.connection.close(); busy = false; renderUI(); }
}
function storeSession() { try { if (room) sessionStorage.setItem('stone-session', JSON.stringify({ token: room.reconnectionToken, code: worldInvite?.id ?? room.roomId })); } catch { /* optional */ } }
async function joinCreativeWorld(id: string, options: { name: string; version: number; seatKey: string; playerKey: string; private: boolean }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/worlds/${id}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404 ? 'That Creative world could not be found.' : 'This world is temporarily unavailable. Try again shortly.');
    const world = await response.json() as { roomId?: string };
    try {
      if (world.roomId) return await client.joinById(world.roomId, options);
      const bookmark = worldKeeps.entries.find(b => b.handle.id === id);
      return await client.create('arena', { ...options, ...(bookmark ? { keep: bookmark.handle } : { invite: id }) });
    } catch (e) {
      // Simultaneous arrivals share the room created by the first visitor.
      if (attempt === 3 || !/already has an arena|not found|no rooms found|disposed/i.test(e instanceof Error ? e.message : String(e))) throw e;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error('This world is opening. Try again shortly.');
}
async function connect(action: 'create' | 'join' | 'reconnect' | 'world', code = '', keep?: WorldHandle, mode?: Mode) {
  if (busy || room) return; busy = true; error = ''; renderUI();
  try {
    await refreshPlayTime(); if (playTimeDisplay.blocked) throw new Error('Time for a 30-minute break. See the countdown.');
    if (action !== 'reconnect' && !nickname.trim()) throw new Error('Choose a nickname first.');
    const options = { name: nickname.trim().slice(0, 24), version: VERSION, seatKey, playerKey: worldVisits.playerKey(nickname), private: privateArena, ...(action === 'create' && keep ? { keep } : {}), ...(mode ? { mode } : {}) };
    const stableWorld = action === 'world' || action === 'join' && /^[a-f0-9]{32}$/i.test(code.trim());
    const joined = stableWorld ? await joinCreativeWorld(code.trim().toLowerCase(), options) : action === 'create' ? await client.create('arena', options) : action === 'join' ? await client.joinById(code.trim().toUpperCase(), options) : await client.reconnect(code);
    worldInvite = undefined;
    room = joined; onlineKeep = undefined; excavation = new Excavation(); excavationSeed = undefined; lastExcavationSync = -2000; stoneReceiver.clear(); sculpting = false; construction = new Construction(); constructionSeed = undefined; forage = new Forage(); forageSeed = undefined; lastForageSync = -1000; weaving = false; lastConstructionSync = -1000; if (action !== 'reconnect') { trackedWaystone = undefined; trackedSupply = undefined; trackedRecipe = undefined; }
    joined.onMessage('maintenance', showUnavailable);
    joined.onMessage('playTime', (status: PlayTimeStatus) => { if (room !== joined) return; playTimeDisplay.update(status); if (status.retryAfterSeconds) { joined.reconnection.enabled = false; releasePointer(); } });
    joined.onMessage('worldInvite', (invite: WorldInvite) => { if (room !== joined || !validInvite(invite)) return; worldInvite = { id: invite.id, title: invite.title }; worldVisits.remember(worldInvite); storeSession(); history.replaceState(null, '', `${location.pathname}?room=${invite.id}`); renderUI(); });
    joined.onMessage('worldKeep', (status: KeepStatus) => {
      if (room !== joined || !status || !['disabled', 'off', 'saving', 'saved', 'error', 'full'].includes(status.state)) return;
      onlineKeep = { state: status.state, ...(validHandle(status.handle) ? { handle: status.handle } : {}), ...(validKeepSummary(status.summary) ? { summary: status.summary } : {}) };
      worldKeeps.remember(onlineKeep); renderUI();
    });
    joined.onMessage('worldForgotten', (data: { id?: string }) => { if (room !== joined || !data?.id) return; worldKeeps.forget(data.id); notice = 'Online copy removed · Your current arena and browser memory remain'; renderUI(); });
    joined.onMessage('worldRestored', () => { importPending = false; clearTimeout(importTimer); trackedWaystone = trackedSupply = undefined; trackedRecipe = undefined; notice = 'World restored · Ready up to explore it'; rememberWorld(true); renderUI(); });
    joined.reconnection.minUptime = 0; joined.reconnection.maxDelay = 1000; joined.reconnection.maxRetries = 280;
    disconnected = false; totemPopup.hidden = true; eventId = 0; pending = []; lastPhase = ''; snapshot = undefined;
    try { localStorage.setItem('stone-name', nickname); } catch { /* optional */ }
    storeSession(); history.replaceState(null, '', `${location.pathname}?room=${room.roomId}`);
    joined.onMessage('construction', (state: ConstructionState) => { if (room !== joined) return; const replacement = new Construction(); if (replacement.restore(state)) { construction = replacement; constructionSeed = state.seed; updateWorldContents(); } else syncConstruction(); });
    joined.onMessage('constructionChanges', (changes: ConstructionChanges) => { if (room !== joined) return; if (changes.seed !== constructionSeed || !construction.apply(changes)) syncConstruction(); });
    joined.onMessage('forage', (state: ForageState) => { if (room !== joined) return; if (forage.restore(state)) { forageSeed = state.seed; updateWorldContents(); } else syncForage(); });
    joined.onMessage('forageChanges', (changes: ForageChanges) => { if (room !== joined) return; if (changes.seed !== forageSeed || !forage.apply(changes)) syncForage(); });
    joined.onMessage('excavation', (state: ExcavationState) => { if (room !== joined) return; stoneReceiver.clear(); const replacement = new Excavation(); if (replacement.restore(state)) { excavation = replacement; excavationSeed = state.seed; updateWorldContents(); } else syncExcavation(); });
    joined.onMessage('excavationStream', (packet: StonePacket) => { if (room !== joined) return; const result = stoneReceiver.receive(packet, performance.now()); if (result === false) syncExcavation(); else if (result) { excavation = result.excavation; excavationSeed = result.seed; updateWorldContents(); } });
    joined.onMessage('excavationChanges', (changes: ExcavationChanges) => { if (room !== joined) return; if (stoneReceiver.active) { if (!stoneReceiver.changes(changes)) syncExcavation(); } else if (changes.seed !== excavationSeed || !excavation.apply(changes)) syncExcavation(); });
    joined.onMessage('snapshot', (s: Snapshot) => {
      if (room !== joined) return;
      joined.reconnection.maxRetries = isExplorationMode(s.mode) ? 280 : 12;
      if (constructionSeed !== s.world.seed || construction.revision !== s.world.buildRevision) syncConstruction();
      if (forageSeed !== s.world.seed || forage.revision !== s.world.forageRevision) syncForage();
      if (stoneReceiver.expire(performance.now()) || excavationSeed !== s.world.seed || excavation.revision !== s.world.excavationRevision) syncExcavation();
      const old = me(); snapshot = s; updateWorldContents(); const p = me();
      if (p?.realm !== 'wilds' || !p.alive || s.phase !== 'active') weaving = sculpting = false;
      if (p) {
        glidePulse.acknowledge(p.ack); dashPulse.acknowledge(p.ack); jumpPulse.acknowledge(p.ack);
        if (lastRound !== s.round || lastPhase !== s.phase || old?.realm !== p.realm || old?.alive !== p.alive || old?.respawnAt !== p.respawnAt || old?.warpTick !== p.warpTick || !local) { local = { ...p }; pending = []; yaw = p.yaw; pitch = p.pitch; weapon = p.weapon; offhand = p.offhand; seq = Math.max(seq, p.ack); }
        else { pending = pending.filter(i => i.seq > p.ack); local = { ...p }; if (p.alive && s.phase === 'active' && contentsReady()) for (const i of pending) move(local, { ...i, block: !i.weaving && !i.sculpting && i.block && i.offhand === 'shield' && p.shieldDisabled <= 0 }, DT, p.charge > 0, s.world, s.mode === 'creative'); }
        if (old && p.hp < old.hp) { const f = document.createElement('div'); f.className = 'damage-flash'; app.append(f); setTimeout(() => f.remove(), 300); arenaAudio.noise(.15,350,.15); }
        if (old?.alive && !p.alive) { scene.inspectArmor = false; releasePointer(); notice = s.mode === 'expedition' && p.respawnAt ? 'Scattered · Return at the arrival waystone in 5 seconds.' : s.mode === 'ctf' ? 'Respawning at your base in 5 seconds.' : 'Eliminated. You can watch the remaining players.'; }
      }
      if (old && !old.alive && p?.alive && s.phase === 'active') { notice = s.mode === 'expedition' ? 'Back at the arrival waystone · Rejoin your friends' : 'Respawned at your base · Click to rejoin'; resetControls(); }
      for (const e of s.events) if (e.id > eventId) {
        eventId = e.id; scene.event(e); const source = s.players.find(q => q.id === e.actor), soundAt = e.position ?? source;
        if ((!e.realm || e.realm === p?.realm) && (!source || source.realm === p?.realm) && (!soundAt || !p || Math.hypot(soundAt.x-p.x,soundAt.z-p.z)<45)) arenaAudio.event(e,e.actor===p?.id,soundAt&&p?Math.max(.12,1-Math.hypot(soundAt.x-p.x,soundAt.z-p.z)/50):1);
        if (e.actor === room?.sessionId) {
          if (e.type === 'totem' && old && p && old.totems > p.totems) { totemPopup.hidden = false; clearTimeout(totemTimer); totemTimer = setTimeout(() => { totemPopup.hidden = true; }, 2200);  }
          if (e.type === 'heal') { notice = e.text ?? 'Healed';  setTimeout(() => { if (notice === e.text) { notice = ''; renderUI(); } }, 2500); }
          if (e.type === 'level') { notice = e.text ?? 'Armor upgraded';  setTimeout(() => { if (notice === e.text) { notice = ''; renderUI(); } }, 4000); }
          if (e.type === 'mine' || e.type === 'mend' || e.type === 'swing' || e.type === 'weave' || e.type === 'erase' || e.type === 'gather') { scene.swing = 1;  }
          if (e.type === 'mine' || e.type === 'mend' || e.type === 'gather' || e.type === 'craft' || ['creature_bond','creature_scout','creature_challenge'].includes(e.type)) { notice = e.text ?? ''; const craftingNotice = notice; setTimeout(() => { if (notice === craftingNotice) { notice = ''; renderUI(); } }, 3500); }
          if (e.type === 'creature_scout') { const c=(s.creatures??[]).map(creatureView).find(c=>c.id===e.target); if(c&&c.kind!==4){trackedRecipe=undefined;trackedWaystone=undefined;trackedSupply=CREATURES[c.kind].food;} }
          if (e.type === 'hit' || e.type === 'creature_hit') {  const c = document.querySelector('.crosshair'); c?.classList.add('hit'); setTimeout(() => c?.classList.remove('hit'), 120); }
        }
        if (e.type === 'relic' && e.actor === room?.sessionId) { notice=e.text ?? ''; const relicNotice=notice; setTimeout(()=>{if(notice===relicNotice){notice='';renderUI();}},5000); }
        if ((e.type === 'travel' || e.type === 'warp' || e.type === 'waystone') && e.actor === room?.sessionId) { if (e.type !== 'waystone') resetControls(); notice = e.text ?? ''; const travelNotice = notice; setTimeout(() => { if (notice === travelNotice) { notice = ''; renderUI(); } }, 5000); }
        if (e.type === 'door') { notice = e.text ?? '';  }
        if (e.type === 'creature_clear' && p?.realm === 'wilds') { notice=e.text??''; const clearNotice=notice; setTimeout(()=>{if(notice===clearNotice){notice='';renderUI();}},5000); }
        if (e.type.startsWith('flag_')) { notice = e.text ?? ''; const flagNotice = notice; setTimeout(() => { if (notice === flagNotice) { notice = ''; renderUI(); } }, 3500); }
      }
      if (s.phase !== lastPhase || s.round !== lastRound) {
        if (s.phase === 'results' || s.phase === 'waiting') { scene.inspectArmor = false; releasePointer(); }
        if (s.phase === 'results') resultsEnteredAt = performance.now();
        modal = ''; notice = ''; lastPhase = s.phase; lastRound = s.round; renderUI();
      }
      if (performance.now() - lastHud > 90) { renderUI(); lastHud = performance.now(); }
    });
    joined.onMessage('pong', (n: number) => { if (room === joined) ping = Math.round(performance.now() - n); });
    joined.onMessage('latency', (n: number) => { if (room === joined) joined.send('latencyAck', n); });
    joined.onMessage('actionError', (message: string) => { importPending = false; clearTimeout(importTimer); if (room === joined) { notice = message; renderUI(); } });
    joined.onDrop(() => { if (room !== joined) return; disconnected = true; pending = []; resetControls(); notice = isExplorationMode(snapshot?.mode) ? 'Connection lost. Reconnecting · Your place is saved and your seat is reserved for five minutes.' : 'Connection lost. Reconnecting · Your seat is reserved for 15 seconds.'; renderUI(); });
    joined.onReconnect(() => { if (room !== joined) { void joined.leave(); return; } disconnected = false; notice = ''; storeSession(); joined.send('sync'); renderUI(); });
    joined.onError((_code, message) => { if (room !== joined) return; notice = message ?? 'Connection error'; renderUI(); });
    joined.onLeave((_code, reason) => {
      if (room !== joined) return;
      room = undefined; snapshot = undefined; local = undefined; disconnected = false; notice = ''; modal = ''; scoreboard = false;
      releasePointer(); clearSession();
      void refreshPlayTime();
      error = reason || 'You left the arena. Create or join a room to play again.'; renderUI();
    });
    joined.send('sync'); syncConstruction(); syncForage(); syncExcavation();
  } catch (e) { error = e instanceof Error ? e.message : 'Could not connect. Check the room code and try again.'; if (action === 'reconnect') { try { sessionStorage.removeItem('stone-session'); } catch { /* optional */ } } }
  finally { busy = false; renderUI(); if (!room) { void refreshArenas(); if (!nickname.trim()) document.querySelector<HTMLInputElement>('#nickname')?.focus(); } }
}
function footer() { return '<div class="footer"><span>Explore. Team up. Capture. Survive.</span><span><span>Browser multiplayer</span><span>© Fletch Industries</span></span></div>'; }
function scores() {
  const ps = [...(snapshot?.players ?? [])].sort((a, b) => Number(b.alive) - Number(a.alive) || b.eliminatedAt - a.eliminatedAt);
  if (snapshot?.mode === 'expedition') return `<table class="score-table"><thead><tr><th>Explorer</th><th>Skyshards</th><th>Journey</th></tr></thead><tbody>${ps.map(p => `<tr class="${snapshot?.phase === 'results' && p.alive && p.relics === 7 && p.realm === 'arena' ? 'winner' : ''}"><td><span style="color:${playerColor(p, 'expedition')}">■</span> ${escape(p.name)}</td><td>${shardCount(p.relics)} / 3</td><td>${!p.alive ? 'Left expedition' : !p.connected ? 'Reconnecting' : p.realm === 'wilds' ? 'Exploring the Wilds' : p.relics === 7 ? 'Home safely ✓' : 'Finding the secret door'}</td></tr>`).join('')}</tbody></table>`;
  return `<table class="score-table"><thead><tr><th>Player</th><th>Status</th><th>Level</th><th>Kills</th><th>Assists</th><th>Damage</th>${snapshot?.mode === 'ctf' ? '<th>Flags</th>' : ''}</tr></thead><tbody>${ps.map(p => `<tr class="${p.id === snapshot?.winner || (snapshot?.winnerTeam && p.team === snapshot.winnerTeam) ? 'winner' : ''}"><td><span style="color:${playerColor(p, snapshot?.mode)}">■</span> ${escape(p.name)}${isTeamMode(snapshot?.mode) ? ` <small>${TEAMS[p.team].name}</small>` : ''}</td><td>${p.alive ? 'Alive' : snapshot?.mode === 'ctf' ? 'Respawning' : 'Out'}</td><td>${armorTier(p.xp).level}</td><td>${p.kills}</td><td>${p.assists}</td><td>${Math.round(p.damage)}</td>${snapshot?.mode === 'ctf' ? `<td>${p.captures} captures · ${p.flagReturns} returns</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
function teamBalanced(s: Snapshot) { const red = s.players.filter(p => p.team === 'red').length; return red > 0 && red < s.players.length && Math.abs(red - (s.players.length - red)) <= 1; }
function flagHUD(s: Snapshot, p?: Player) {
  const carrying = s.flags.find(f => f.carrier === p?.id && f.state === 'carried');
  return `<div class="flag-hud"><div class="flag-score"><b style="color:${TEAMS.red.color}">RED ${s.scores.red}</b><span>First to ${CTF.target}</span><b style="color:${TEAMS.blue.color}">${s.scores.blue} BLUE</b></div><div class="flag-status">${s.flags.map(f => `<span style="color:${TEAMS[f.team].color}">${TEAMS[f.team].name} flag: ${f.state === 'home' ? 'At base' : f.state === 'carried' ? `Carried by ${escape(s.players.find(q => q.id === f.carrier)?.name ?? 'player')}` : `Dropped · ${Math.max(0, Math.ceil((f.returnAt - s.tick) / 60))}s`}</span>`).join(' · ')}</div><p>${carrying && p ? `You have the enemy flag! Return to ${TEAMS[p.team].name} base ${s.flags.find(f => f.team === p.team)?.state === 'home' ? 'to capture.' : '— return your own flag first.'}` : p?.realm === 'wilds' ? 'Flags stay in the citadel · Return through the tunnel to capture' : 'Touch the enemy flag to pick it up · Bring it to your base'}${p && p.immuneUntil > s.tick ? ' · Spawn protection' : ''}</p></div>`;
}
function expeditionHUD(p: Player) {
  const sites=shardSites(snapshot!.world.seed), next=sites.filter(s=>!(p.relics&1<<s.id)).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
  if (trackedRecipe) {
    const recipe = recipeFor(trackedRecipe), missing = recipe?.cost.findIndex((cost, n) => cost > (snapshot!.world.supplies?.[n] ?? 0)) ?? -1;
    if (missing < 0 || recipe?.unlock && ((snapshot!.world.upgrades ?? 0) & recipe.unlock)) {
      trackedSupply = undefined; trackedRecipe = undefined;
      trackedWaystone = [HOME_WAYSTONE,...waystoneSites(snapshot!.world.seed)].filter(s => (snapshot!.world.waystones ?? 1) & 1 << s.id).sort((a,b) => Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0]?.id;
    } else trackedSupply = missing;
  }
  const stone = nearbyWaystone(p,snapshot!.world.seed), tracked = [HOME_WAYSTONE,...waystoneSites(snapshot!.world.seed)].find(s=>s.id===trackedWaystone);
  const supply = trackedSupply === undefined ? undefined : suppliesNear(p.x, p.z, snapshot!.world.seed, 192).filter(n => n.kind === trackedSupply && forage.available(n, snapshot!.tick)).sort((a,b) => Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
  const target = supply ?? tracked ?? next ?? { x: 0, z: 8 }, bearing = p.yaw - Math.atan2(p.x - target.x, p.z - target.z);
  const guidance = trackedSupply !== undefined ? `${SUPPLIES[trackedSupply].name} · ${supply ? Math.round(Math.hypot(supply.x-p.x,supply.z-p.z)) + ' blocks' : 'Explore another grove'}` : tracked ? `${tracked.name} · ${Math.round(Math.hypot(tracked.x-p.x,tracked.z-p.z))} blocks` : next ? `${next.name} beacon · ${Math.round(Math.hypot(next.x-p.x,next.z-p.z))} blocks` : snapshot?.mode === 'expedition' ? 'All three found! Bring your party home.' : 'Warden unlocked · Awaken the waystones and explore farther.';
  return `<div class="world-hint expedition-hud"><b>${p.relics===7?'✦ WARDEN OF THE WILDS':'✦ SKYSHARD TRAIL'} · ${shardCount(p.relics)}/3</b><p><span class="trail-compass" aria-hidden="true" style="transform:rotate(${bearing}rad)">↑</span>${guidance}</p><small>Return tunnel · ${Math.round(Math.hypot(p.x,p.z-8))} blocks · 0, 8</small>${snapshot?.mode === 'expedition' ? partyProgress() : ''}<div class="trail-actions"><button class="atlas-button interactive" data-action="atlas">${mobile?'':'M · '}Atlas ${awakenedCount(snapshot!.world.waystones)}/8${stone?' · Waystone nearby':''}</button>${p.alive?`<button class="windstep interactive" data-action="dash" ${(p.dashCooldown??0)>0?'disabled':''}>${mobile?'':'Q · '}Windstep ${(p.dashCooldown??0)>0?Math.ceil(p.dashCooldown!)+'s':'READY'}</button>`:''}${p.alive ? `<button class="atlas-button interactive" data-action="loom">${mobile ? "" : "C · "}Rune loom</button>${snapshot?.mode !== 'creative' && ((snapshot!.world.upgrades ?? 0) & SKY_SAIL) ? `<button class="atlas-button interactive" data-action="glide" ${(p.glideTime ?? 0) <= 0 && (p.glideCooldown ?? 0) > 0 ? "disabled" : ""}>${mobile ? "" : "G · "}${(p.glideTime ?? 0) > 0 ? "Fold sail" : (p.glideCooldown ?? 0) > 0 ? `Glide ${Math.ceil(p.glideCooldown!)}s` : "Glide"}</button>` : ""}<button class="atlas-button interactive" data-action="weave" aria-pressed="${weaving}">${mobile ? '' : 'B · '}${weaving ? 'Use tools' : 'Rune build'}</button><button class="atlas-button interactive" data-action="sculpt" aria-pressed="${sculpting}">${mobile ? '' : 'X · '}${sculpting ? 'Use tools' : 'Shape stone'}</button>` : ''}</div></div>`;
}
function partyProgress() {
  return `<div class="party-progress">${snapshot!.players.filter(p => p.alive).map(p => `<span><i style="background:${playerColor(p, 'expedition')}"></i><em>${escape(p.name)}</em><b>${!p.connected ? 'Reconnecting…' : p.relics === 7 && p.realm === 'arena' ? 'Home ✓' : `${shardCount(p.relics)}/3`}</b></span>`).join('')}</div>`;
}
function expeditionStartHUD(p: Player) {
  const complete = p.relics === 7;
  return `<div class="world-hint expedition-hud"><b>✦ CO-OP EXPEDITION</b><p>${complete ? 'You made it home. Wait for your friends to return.' : 'Find the green stone in the north wall beside the west chambers. Open it, then follow the tunnel.'}</p><small>${complete ? 'Everyone needs all three skyshards to finish together.' : 'Secret door · −26, −48 · E or tap to open'}</small>${!complete && nearSecret(p) && !snapshot!.world.doorOpen ? `<button class="btn gold interactive" data-action="interact">${mobile ? 'Open the strange stone' : 'E · Open the strange stone'}</button>` : ''}${partyProgress()}</div>`;
}
function modeHelp(s: Snapshot) {
  return s.mode === 'creative' ? 'An endless world for exploring and building together. No damage, eliminations or round endings. All tools and waystones are ready. G / Fly toggles flight; Space goes up, Shift goes down. Friends can join at any time, and your world and last position are saved.' : s.mode === 'expedition' ? 'Explore together. Each friend finds the Dawn, Tide and Dusk skyshards, then everyone returns through the tunnel to win. Friendly fire is off. Befriend grove creatures and challenge Shade Wardens when you are ready. Play solo or with up to five friends.' : s.mode === 'ctf' ? 'Touch the enemy flag to carry it home. Your own flag must be home to score. First to 3 captures wins. Respawn after 5 seconds.' : s.mode === 'teams' ? 'Work together. One life each. The last surviving team wins.' : 'One life each. The last surviving player wins.';
}
let lastHTML = '', lastModal = '', lastWorldsHTML = '', lastLoomHTML = '', lastWorldNotice = '';
function renderUI() {
  const p = me(), s = snapshot; const gathered = s && p?.alive && s.phase === "active" && forageSeed === s.world.seed ? gatherTarget({ ...p, ...(local ?? {}), yaw, pitch }, s.world, s.tick) : undefined; let html = '';
  const worldsHTML = modal === 'worlds' ? worldsPanel() : ''; const loomHTML = modal === 'loom' && s && p ? loomPanel(s, p, disconnected) : '';
  const creatureUI=s?creatureHUD(p?{...p,...(local??{}),yaw,pitch}:undefined,s,mobile,disconnected):{prompt:'',status:''};
  touch.item(weapon === 'apple', weaving, sculpting); touch.offhand(offhand === 'totem', weaving, sculpting, s?.mode === 'creative' && (local?.flying ?? p?.flying) === true);
  touch.show(mobile && touchPlaying && !!p?.alive && s?.phase === 'active' && !modal && !scoreboard && !disconnected);
  if ((busy || room) && !s) {
    html = `<section class="screen interactive">${brand}<div class="lobby"><h2>${room ? 'Entering your arena…' : 'Connecting…'}</h2><p role="status">Please wait while we confirm your seat.</p></div></section>`;
  } else if (!room || !s) {
    html = `<section class="screen landing interactive">${brand}<div class="landing-layout"><div class="hero"><div class="eyebrow"><i class="dot"></i> Explore. Hide. Outlast.</div><h1>STONE<br><span>ARENA.</span></h1><p class="lead">Create a world. Come back after a break.<br>Rune-lit duels. Hidden passages. A skyshard trail across a magical frontier.</p><div class="traits"><span><b>05</b> Players max</span><span><b>05</b> Game modes</span><span><b>15</b> Minutes per play period</span></div><p class="help">15 minutes of play, then a 30-minute break. Everyone on the same public IP shares the timer, across devices and rooms.</p><div class="form"><label class="label" for="nickname">Your arena name</label><input class="input" id="nickname" maxlength="24" placeholder="Enter your nickname" value="${escape(nickname)}" autocomplete="nickname"><aside class="arena-directory panel" aria-label="Open arenas"><div class="directory-heading"><div><div class="eyebrow"><i class="dot"></i> Jump into a game</div><h2>Open arenas</h2></div><button class="text-btn" data-action="refresh-arenas">Refresh</button></div><p class="help">Choose a nickname, then join an arena or a Creative world already being explored.</p><div id="open-arenas" aria-live="polite">${openArenaHTML()}</div><p class="directory-note">96 × 96 blocks · 9× the space<br>Chambers · Ruins · Tunnels · Lookout tower</p></aside>${worldVisits.entries[0] ? `<button class="btn gold wide" data-action="join-world" data-world="${worldVisits.entries[0].id}" ${busy ? 'disabled' : ''}>Resume last world &nbsp; →</button>` : ''}<button class="btn gold wide" data-action="create-creative" ${busy ? 'disabled' : ''}>Create Creative world &nbsp; ↗</button><button class="btn wide" data-action="create" ${busy ? 'disabled' : ''}>Create a competitive arena</button><label class="private-option"><input id="private-arena" type="checkbox" ${privateArena ? 'checked' : ''}> Invite-only · Hide from the open arena list</label><div class="row join-row"><input class="input" id="code" placeholder="Or enter a room code" aria-label="Room or world code" maxlength="32" value="${escape(roomCode)}"><button class="btn" data-action="join" ${busy ? 'disabled' : ''}>Join</button></div><div class="landing-links"><button class="text-btn" data-action="worlds">Saved worlds &nbsp; →</button><button class="text-btn" data-action="controls">How to play &nbsp; →</button><button class="text-btn install-game" data-action="install">Install game ↗</button><a class="text-btn" href="https://github.com/Fletch-Industries/stone-arena/issues/new/choose" target="_blank" rel="noopener noreferrer">Suggest a feature ↗</a></div><div class="error" role="status">${escape(error)}</div></div></div></div>${footer()}</section>`;
  } else if (s.phase === 'waiting') {
    html = `<section class="screen interactive">${brand}<div class="lobby"><div class="eyebrow"><i class="dot"></i> Arena lobby</div><h2>Gather your contenders.</h2><p>Choose your adventure. Ready up together.</p><div class="panel"><div class="row" style="justify-content:space-between"><div><span class="label">Room code</span><span class="room-code">${room.roomId}</span></div><button class="btn" data-action="invite">Copy invite</button></div><div class="mode-picker"><label class="label" for="game-mode">Game mode</label><select class="input" id="game-mode" ${s.host !== room.sessionId || disconnected ? 'disabled' : ''}>${Object.entries(MODES).map(([value, label]) => `<option value="${value}" ${s.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select><p class="help">${modeHelp(s)}</p>${isTeamMode(s.mode) && p ? `<div class="team-picker" aria-label="Choose your team">${(['red', 'blue'] as const).map(team => `<button class="btn" data-action="team" data-team="${team}" aria-pressed="${p.team === team}" style="border-color:${TEAMS[team].color};color:${TEAMS[team].color}" ${disconnected ? 'disabled' : ''}>${TEAMS[team].name} team · ${s.players.filter(q => q.team === team).length}${p.team === team ? ' ✓' : ''}</button>`).join('')}</div>` : ''}</div><div class="players">${Array.from({ length: 5 }, (_, n) => { const q = s.players[n]; return q ? `<div class="player-row"><i class="avatar" style="background:${playerColor(q, s.mode)}"></i><span class="name">${escape(q.name)} ${isTeamMode(s.mode) ? `<span class="tag" style="color:${TEAMS[q.team].color}">${TEAMS[q.team].name}</span>` : ''} ${q.id === s.host ? '<span class="tag">Host</span>' : ''}</span><span class="tag ${q.ready ? 'ready' : ''}">${!q.connected ? 'Reconnecting' : q.ready ? 'Ready' : 'Not ready'}</span></div>` : '<div class="player-row"><i class="avatar" style="background:#26343b"></i><span class="name" style="color:#7c8c91">Waiting for player…</span><span class="tag">Open</span></div>'; }).join('')}</div><div class="room-actions"><button class="btn ${p?.ready ? '' : 'gold'}" data-action="ready" ${disconnected ? 'disabled' : ''}>${p?.ready ? 'Unready' : 'Ready up'}</button>${s.host === room.sessionId ? `<button class="btn gold" data-action="start" ${disconnected || importPending || !s.players.every(q => (q.ready || s.mode === 'creative') && q.connected) || (isTeamMode(s.mode) && s.players.length > 1 && !teamBalanced(s)) ? 'disabled' : ''}>${s.mode === 'creative' ? 'Explore world' : s.mode === 'expedition' ? 'Start expedition' : s.players.length === 1 ? 'Practice solo' : 'Start round'}</button>` : ''}</div><p class="help">${s.mode === 'creative' ? 'No ready-up needed. Open the world, then invite friends whenever you want.' : s.mode === 'expedition' ? 'Find the secret door, follow the colored beacons, and bring every explorer home. Windstep helps you cross the hills. No time limit.' : s.players.length === 1 ? 'Invite a friend for a competitive round. Solo practice lets you explore the arena and weapons.' : s.mode === 'ctf' ? 'Teams must differ by at most one player. Touch your dropped flag to return it; dropped flags return automatically after 30 seconds.' : s.mode === 'teams' ? 'Both teams must have players, balanced within one. Friendly fire is off.' : 'Everyone gets one life. Eliminated players spectate. The final survivor wins.'}</p></div><div class="row"><button class="text-btn" data-action="controls">Controls</button><button class="text-btn" data-action="settings">Settings</button><button class="text-btn" data-action="worlds">Saved worlds</button><button class="text-btn" data-action="leave">Leave room</button></div></div>${footer()}</section>`;
  } else {
    const alive = s.players.filter(q => q.alive).length;
    html = `<div class="hud ${weaving || sculpting ? 'rune-building' : ''} ${s.mode === 'ctf' ? 'ctf' : s.mode === 'expedition' ? 'expedition' : ''}"><div class="topbar"><div class="badge">${isTeamMode(s.mode) && p ? `<span style="color:${TEAMS[p.team].color}">${TEAMS[p.team].name} team</span> · ` : ''}<strong>${alive}</strong> ${isExplorationMode(s.mode) ? 'explorers' : s.practice ? 'Practice' : 'remaining'} <span style="color:#8fa2a5"> / ${s.players.length}</span></div><div class="net">${s.mode === 'creative' ? 'CREATIVE WORLD' : `STONE ARENA · ROUND ${s.round}`}<br><b class="location-label">${p?.realm === 'wilds' ? `${BIOMES[biomeAt(p.x,p.z,s.world.seed)].name} · ${Math.round(p.x)}, ${Math.round(p.z)}` : p && p.z < -48 ? 'Secret passage' : p ? arenaLocation(local?.x ?? p.x, local?.z ?? p.z, local?.y ?? p.y) : 'Stone Citadel'}</b><br>${ping} ms · ${scene.fps} FPS<br>${mobile ? 'Touch controls · landscape recommended' : '<kbd>ESC</kbd> Menu &nbsp; <kbd>TAB</kbd> Scoreboard &nbsp; <kbd>F5 / V</kbd> View'}</div></div>${s.mode === 'creative' ? `<div class="creative-invite"><div class="creative-actions"><button class="atlas-button interactive" data-action="glide" aria-pressed="${(local?.flying ?? p?.flying) === true}" ${disconnected ? 'disabled' : ''}>${mobile ? '' : 'G · '}${(local?.flying ?? p?.flying) ? 'Land' : 'Fly'}</button><button class="atlas-button interactive" data-action="invite">Invite friends</button></div><small>Endless exploration · Your place saves automatically</small></div>` : ''}${s.mode === 'ctf' ? flagHUD(s, p) : ''}${s.mode === 'expedition' && p?.alive && p.realm === 'arena' ? expeditionStartHUD(p) : p?.alive && s.phase === 'active' && nearSecret(p) && !s.world.doorOpen ? `<div class="world-hint interactive"><button class="btn gold" data-action="interact">${mobile ? 'Touch the strange stone' : 'E · Open the strange stone'}</button></div>` : p?.realm === 'wilds' ? expeditionHUD(p)  : ''}${creatureUI.status}${creatureUI.prompt}${gathered && !creatureUI.prompt ? `<div class="gather-hint interactive"><button class="btn gold" data-action="gather" ${(p?.gatherReadyAt ?? 0) > s.tick ? "disabled" : ""}>${mobile ? "Gather" : "E · Gather"} ${SUPPLIES[gathered.kind].name} +${Math.min(FORAGE.yield, FORAGE.stockLimit - (s.world.supplies?.[gathered.kind] ?? 0))}</button><small>Shared party supplies · C / Rune loom</small></div>` : ""}<div class="feed">${s.events.filter(e => e.type === 'kill' || e.type.startsWith('flag_')).slice(-4).map(e => `<div>${escape(e.text ?? '')}</div>`).join('')}</div>${p?.alive ? `${settings.perspective === 'first' && !scene.inspectArmor ? '<div class="crosshair"></div>' : ''}<div class="bottom">${hotbar(p, weapon, isExplorationMode(s.mode), weaving ? weaveKind : undefined, s.world.upgrades ?? 0, sculpting, excavation.count(p.id))}<div class="charge ${weaving ? 'hidden' : ''}" role="progressbar" aria-label="${sculpting ? 'Stone song' : weapon === 'apple' ? 'Eating golden apple' : weapon === 'bow' ? 'Bow draw' : weapon === 'crossbow' ? 'Crossbow load' : 'Attack strength'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((sculpting ? (p.sculptProgress ?? 0) / 100 : weapon === 'apple' ? p.charge / APPLE.seconds : weapon === 'bow' ? p.charge : weapon === 'crossbow' ? p.loaded ? 1 : p.charge / 1.25 : attackStrength(p)) * 100)}"><i style="width:${Math.min(100, (sculpting ? (p.sculptProgress ?? 0) / 100 : weapon === 'apple' ? p.charge / APPLE.seconds : weapon === 'bow' ? p.charge : weapon === 'crossbow' ? p.loaded ? 1 : p.charge / 1.25 : attackStrength(p)) * 100)}%"></i></div><div class="combat-hint">${sculpting ? `${mobile ? 'Hold Mine / Mend' : 'Left · Mine / Right · Mend'} · X · Tools<br>${escape(scene.sculpture.target?.reason || scene.sculpture.target?.stratum.name || 'Sing new passages through the stone')}` : weaving ? `1–7 · Choose rune · ${mobile ? 'Weave / Erase' : 'Left · Weave / Right · Erase'} · B · Tools<br>${escape(scene.construction.target?.reason || (weaveKind === 5 ? 'Windlift turns jumps into soaring leaps' : 'Build shelters, bridges and your own secret places'))}` : s.mode === 'creative' ? `${(local?.flying ?? p.flying) ? 'Flying · Space up · Shift down · Ctrl faster' : 'Explore freely · G / Fly to soar'} · No damage or endings` : s.mode === 'expedition' ? 'Explore together · Friendly fire is off · R / Tap to befriend or challenge' : weapon === 'apple' ? p.apples === 0 ? 'No apples left this round' : p.hp >= 100 ? 'Full health · Save your apples' : `${mobile ? 'Hold Eat' : 'Hold left mouse'} to eat · Restores up to 4 hearts` : mobile ? weapon === 'bow' ? 'Hold Attack to draw · release to shoot' : weapon === 'crossbow' ? p.loaded ? 'Loaded · tap Attack to fire' : p.charge ? 'Loading…' : 'Tap Attack to load' : 'Time hits for full power · Hold Attack to repeat' : weapon === 'bow' ? 'Hold left mouse to draw · release to shoot' : weapon === 'crossbow' ? p.loaded ? 'Loaded · click to fire' : p.charge ? 'Loading…' : 'Click to load · click again to fire' : 'Left mouse to attack'}${weaving ? '' : offhand === 'totem' ? p.totems ? ' · Totem ready · Saves you at 2 hearts' : ' · Totem used · Swap to shield' : mobile ? '' : ' · Right mouse to block'}${mobile || weaving ? '' : ' · F swaps left hand'}${dragLook ? ' · Alt + drag to look' : ''}</div></div>` : `<div class="spectate interactive"><span class="eyebrow" style="justify-content:center;margin:0">${(s.mode === 'ctf' || s.mode === 'expedition') && p?.respawnAt ? `Returning in ${Math.max(0, Math.ceil((p.respawnAt - s.tick) / 60))}s` : 'Eliminated · Spectating'}</span><p>${escape(s.players.filter(q => q.alive)[scene.spectator % Math.max(1, alive)]?.name ?? 'Round finished')}</p><button class="btn" data-action="spectate">Next player →</button></div>`}</div>`;
    if (!scene.inspectArmor) html += `<div class="perspective-hint" aria-label="Perspective">${PERSPECTIVE_LABELS[settings.perspective]}${settings.perspective !== 'first' ? '<small>Attacks follow your character’s facing direction</small>' : ''}</div>`;
    if (s.phase === 'countdown') html += `<div class="center-message"><div class="eyebrow" style="justify-content:center">${s.mode === 'expedition' ? 'Three skyshards. One adventure together.' : s.mode === 'ctf' ? 'First to 3 captures. Protect your flag.' : s.mode === 'teams' ? 'Your team. One life each.' : 'One life. Make it count.'}</div><div class="count">${Math.ceil(s.countdown)}</div></div>`;
    if (s.phase === 'active' && p?.alive && !controlling() && !modal && !scoreboard && !disconnected) html += `<div class="center-message interactive ${scene.inspectArmor ? 'armor-inspection' : ''}"><button class="btn gold" data-action="play">${scene.inspectArmor ? 'Resume play' : `${mobile ? 'Tap' : 'Click'} to enter the arena`}</button>${scene.inspectArmor ? '<button class="btn" data-action="settings">Settings</button>' : ''}<p>${scene.inspectArmor ? 'Character preview · The round continues' : mobile ? 'Left stick to move · Swipe right side to aim' : 'WASD to move · Mouse to aim'}</p></div>`;
    if (s.phase === 'results') html += `<div class="overlay interactive"><div class="panel results"><div class="eyebrow">${s.mode === 'expedition' ? 'Co-op expedition · Skyshard trail' : s.mode === 'ctf' ? `Capture the flag · Red ${s.scores.red} : ${s.scores.blue} Blue` : s.mode === 'teams' ? 'Team survival' : s.winner ? 'Last player standing' : 'No survivors'}</div><h2>${escape(s.result)}</h2><p>${s.mode === 'expedition' ? 'You explored the Wilds together. Your next journey awaits.' : s.mode === 'ctf' ? 'Teamwork brings the flag home.' : 'One life. Every decision mattered.'}</p>${scores()}${s.host === room.sessionId ? `<button class="btn gold wide" data-action="lobby" ${performance.now() - resultsEnteredAt < 3100 ? 'disabled' : ''}>${performance.now() - resultsEnteredAt < 3100 ? 'Next round in ' + Math.ceil((3100 - (performance.now() - resultsEnteredAt)) / 1000) + '…' : 'Back to lobby · Rematch'}</button>` : '<p class="help">Waiting for the host to return to the lobby.</p>'}<button class="text-btn" data-action="leave">Leave arena</button></div></div>`;
    if (scoreboard && s.phase !== 'results') html += `<div class="overlay interactive"><div class="panel results"><h2>${s.mode === 'creative' ? 'Creative explorers' : `Round ${s.round}`}</h2>${scores()}<p class="help">${s.mode === 'creative' ? 'Explore and build as long as you like. Friends can join at any time.' : s.mode === 'expedition' ? 'Each explorer finds three skyshards. Return through the tunnel together to finish.' : s.mode === 'ctf' ? 'First to 3 captures wins. Your flag must be home to score.' : 'Survival decides the winner.'}</p><button class="btn gold" data-action="close-scores">Return to game</button></div></div>`;
  }
  if (!p?.alive || s?.phase !== 'active') totemPopup.hidden = true;
  if (notice) html += `<div class="notice" role="status">${escape(notice)}</div>`;
  if (modal) {
    html += `<div class="overlay interactive"><div class="panel"><div class="eyebrow">Stone Arena</div><h2>${modal === 'settings' ? 'Your settings' : modal === 'atlas' ? atlas.page==='guide'?'Wilds field guide':'Constellation atlas' : modal === 'loom' ? 'Waystone rune loom' : modal === 'worlds' ? 'Your worlds' : 'Hold your ground.'}</h2>`;
    if (modal === 'settings') html += `<div class="settings-grid"><label class="setting">Aim sensitivity<input data-setting="sensitivity" type="range" min="0.2" max="2.5" step="0.1" value="${settings.sensitivity}"></label><label class="setting">Sound volume<input data-setting="volume" type="range" min="0" max="1" step="0.05" value="${settings.volume}"></label><label class="setting" for="camera-fov">Field of view <output aria-hidden="true">${settings.fov}°</output><input id="camera-fov" data-setting="fov" type="range" min="60" max="120" step="1" value="${settings.fov}"></label><label class="setting">Perspective<select data-setting="perspective">${PERSPECTIVES.map(v => `<option value="${v}" ${v === settings.perspective ? 'selected' : ''}>${PERSPECTIVE_LABELS[v]}</option>`).join('')}</select></label><label class="setting">Graphics<select data-setting="quality">${['low', 'medium', 'high'].map(q => `<option ${q === settings.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></label><label class="setting">Ambient melody<input type="checkbox" data-setting="music" ${settings.music ? 'checked' : ''}></label><label class="setting">Reduced camera motion<input type="checkbox" data-setting="reduced" ${settings.reduced ? 'checked' : ''}></label></div>${snapshot?.practice && snapshot.phase === 'active' ? `<label class="setting">Practice armor<select data-practice-armor>${ARMOR_TIERS.map(t => `<option value="${t.level}" ${t.level === armorTier(me()?.xp ?? 0).level ? 'selected' : ''}>Level ${t.level} · ${t.name}</option>`).join('')}</select></label>` : ''}${snapshot?.phase === 'active' && me()?.alive ? '<button class="text-btn" data-action="inspect-armor">View your character · 360°</button>' : ''}<button class="text-btn" data-action="worlds">Saved worlds · Download / restore</button><p class="help">The round continues while the menu is open.</p>`;
    else if (modal === 'loom') html += loomHTML;
    else if (modal === 'worlds') html += worldsHTML;
    else if (modal === 'atlas' && p) html += atlas.render(p, snapshot!, trackedWaystone);
    else html += '<p class="mobile-instructions">Touch: left thumbstick to move, swipe the right side to aim. Hold Attack to swing or draw a bow; release to shoot. Tap twice to load and fire a crossbow. Tap Swap to choose a shield or totem. Hold Shield to block, tap Jump, toggle Sprint, and tap the weapon bar to equip. Tap View to change perspective.</p><p>Up to five players. The host chooses Free for all, Team survival, Capture the flag, Co-op expedition, or Creative exploration. Creative worlds start immediately, accept friends at any time, and never end a round. G / Fly toggles flight, Space / Up rises, Shift / Down descends. All building and sculpting tools are unlocked. Resume last world on the home screen returns you to your saved place in this browser. Co-op: find all three skyshards for each explorer, then return through the tunnel together. Friendly fire is off, and you can complete it solo. Optional Shade Wardens rest beside ruins; challenge them to earn party supplies. If scattered in co-op, return at the arrival waystone after five seconds. Team modes use Red and Blue teams with friendly fire off. Capture the flag: touch the enemy flag, carry it to your base with your own flag home, and score three captures to win. Touch your dropped flag to return it; it returns automatically after 30 seconds. Eliminated players respawn after 5 seconds with fresh supplies and 2 seconds of protection, ending when they attack or pick up a flag. Survival modes have one life each.</p><div class="controls"><span><kbd>W A S D</kbd> Move</span><span><kbd>MOUSE</kbd> Aim</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>CTRL / SHIFT</kbd> Sprint</span><span><kbd>LMB</kbd> Attack / draw</span><span><kbd>RMB</kbd> Shield</span><span><kbd>1 – 5</kbd> Select item</span><span><kbd>F</kbd> Swap shield / totem</span><span><kbd>TAB</kbd> Scoreboard</span><span><kbd>F5 / V</kbd> Perspective</span><span><kbd>M</kbd> Atlas / field guide</span><span><kbd>R</kbd> Befriend / scout / challenge</span><span><kbd>B</kbd> Rune weaving</span><span><kbd>X</kbd> Echo chisel</span><span><kbd>C</kbd> Rune loom</span><span><kbd>E</kbd> Gather supplies</span><span><kbd>G</kbd> Sky sail</span></div><p class="help">Time melee hits for full power. Sprint hits push enemies back; strike while falling without sprinting for a critical hit. Shields block the front after raising; axe hits disable them for 5 seconds. Bows charge while held. Crossbows take one click to load and another to fire. Explore the 96 × 96 Stone Citadel: chamber wings, ruined gardens, covered tunnels, and a lookout tower. Walk up its stone steps without jumping. Find the unusual stone panel in the north wall near the west chambers. Press E or tap it to reveal a tunnel into the Wilds. Everyone in a room shares the same hills, rivers and forests. Follow the three colored skyshard beacons to unlock your Warden aura for the round. Press Q or tap Windstep for a short dash in the Wilds; it recharges in four seconds and cannot pass through obstacles. Explore Verdant Reach, Moonwood, Emberfields and Tideglade. Awaken eight waystone ruins for your whole room; press M or tap Atlas to track them. With all three skyshards, stand at an awakened stone and travel to another. Travel rests for two seconds, or five seconds after damage. Walk into the return tunnel near 0, 8 to come back; flags stay inside the citadel. Press B or tap Rune build in the Wilds. Choose from six starting runes (1–6), plus Hearthstone (7) after crafting, left click or hold Weave to place, right click or hold Erase to remove. Windlift tiles boost your jumps. Build up to 512 runes each, 4,096 per world; keep the tunnel and landmarks clear. Co-op friends can erase shared runes; competitive explorers erase their own, and the host can tidy any structure. Gather nearby Lumen reeds, Gleamstone clusters and Emberblooms with E or the touch prompt. Supplies are shared, and patches regrow in two minutes. Press C or Rune loom beside an awakened waystone to craft party upgrades. Echo chisel unlocks X / Shape stone: hold Mine to carve hills and dig tunnels, or hold Mend at an excavated edge to restore it. Follow glowing underground seams for party supplies; each deposit pays once. Keep tree roots and landmark foundations intact. Each explorer can shape 2,048 openings, 8,192 per world. Build runes in your caves, too. Sky sail unlocks G / Glide: a launch hop and up to 10 seconds of slow descent, steering with your view and resting for 12 seconds after launch. G again folds it; damage folds it too. Hearthstone unlocks a seventh rune that restores three HP per second nearby after five damage-free seconds. Arrow bundles weave 12 arrows, up to 40. Aim at a nearby grove creature and press R or tap to offer one favorite supply. One companion follows each explorer. Ask it to scout for patches, and a heart marks your friend. The Atlas field guide shows four species, food tracking and freed Wardens. Challenge a dormant Shade Warden near a ruin: dodge its violet ground circle or face it with your shield, then strike during recovery. Freeing it protects that ruin and earns shared supplies. Field guide discoveries, freed Wardens, supplies and upgrades survive rematches, reconnects and portable saves; companions start a fresh journey each round. Buildings survive rematches and reconnects. Saved worlds in Settings keep recent worlds in the host’s browser; download a file to keep it, then restore it in a lobby. Landmark signs and the location label help you navigate; the outer walk connects every spawn. Open arenas appear on the home screen; check Invite-only before creating to keep a room hidden. Capture the flag has respawns. All modes have no time limit. Select slot 5 and hold left mouse (Eat on mobile) to eat a golden apple: 1.6 seconds, up to 4 hearts restored, two per life. Releasing, switching items or blocking cancels eating.</p><p class="help">Press F, click the left-hand item, or tap Swap on mobile to choose a shield or a totem. One totem per life: while held, a hit that would leave you at two hearts or fewer consumes it and leaves two hearts. It cannot block attacks. Once used, swap back to your shield. Totems do not prevent forfeits.</p><p class="help">Deal damage to earn 1 XP per HP, plus 50 XP per elimination. Level 2 at 50 XP equips Guard armor (20% damage reduction). Level 3 at 150 XP equips Enchanted armor (35%). Everyone starts at level 1 each round. Armor never heals you.</p><p class="help">F5 or V cycles first person, third-person rear, and third-person front. Mobile: tap View. Movement and attacks still follow your character’s facing direction. Settings also offers a 360° character preview; the round keeps running.</p>';
    html += `<button class="btn gold wide" data-action="close">${snapshot?.phase === 'active' && me()?.alive ? 'Resume game' : 'Got it'}</button>${room ? `<div class="row">${snapshot?.practice || (snapshot?.mode === 'expedition' && snapshot.host === room.sessionId && snapshot.phase === 'active') ? '<button class="text-btn" data-action="lobby">Return party to lobby</button>' : ''}<button class="text-btn" data-action="leave">Leave room</button></div>` : ''}</div></div>`;
  }
  // Preserve focused inputs and slider drags; HUD remains independently render-driven.
  const preserveModal = !!modal && modal !== 'atlas' && modal === lastModal && !!app.querySelector('.overlay') && (modal !== 'worlds' || worldsHTML === lastWorldsHTML && notice === lastWorldNotice) && (modal !== 'loom' || loomHTML === lastLoomHTML && notice === lastWorldNotice);
  if (html !== lastHTML && !preserveModal && !(document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range')) {
    const scroll = app.querySelector('.overlay')?.scrollTop ?? 0;
    const paste = app.querySelector<HTMLTextAreaElement>('#world-paste'), value = paste?.value, pasteOpen = app.querySelector<HTMLDetailsElement>('.world-paste')?.open, focused = document.activeElement === paste;
    if (!modal && !lastModal && s?.phase === 'active' && app.firstElementChild?.classList.contains('hud')) patchHUD(app, html);
    else app.innerHTML = html;
    lastHTML = html;
    const overlay = app.querySelector('.overlay'); if (overlay) overlay.scrollTop = scroll;
    const restoredPaste = app.querySelector<HTMLTextAreaElement>('#world-paste'); if (restoredPaste && value !== undefined && lastModal === 'worlds') { restoredPaste.value = value; app.querySelector<HTMLDetailsElement>('.world-paste')!.open = !!pasteOpen; if (focused) restoredPaste.focus(); }
  }
  lastModal = modal; lastWorldsHTML = worldsHTML; lastLoomHTML = loomHTML; lastWorldNotice = notice;
}
app.addEventListener('pointerdown', e => {
  if ((e.target as HTMLElement).closest('[data-action=offhand]')) { e.preventDefault(); swapOffhand(); return; }
  const rune = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]'); if (rune && validKind(Number(rune.dataset.kind))) { e.preventDefault(); chooseRune(Number(rune.dataset.kind)); renderUI(); return; }
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-weapon]');
  if (target && WEAPONS.includes(target.dataset.weapon as Weapon)) { e.preventDefault(); weaving = sculpting = false; weapon = target.dataset.weapon as Weapon; mouseAttack = false; attackQueued = false; renderUI(); }
});
app.addEventListener('input', e => { const t = e.target as HTMLInputElement; if (t.id === 'nickname') nickname = t.value; if (t.id === 'code') roomCode = t.value; });
app.addEventListener('change', e => {
  const t = e.target as HTMLInputElement; if (t.id === 'game-mode') { room?.send('mode', { mode: t.value }); return; } if (t.id === 'private-arena') { privateArena = t.checked; return; } const k = t.dataset.setting;
  if (!k) return;
  if (k === 'perspective' && validPerspective(t.value)) { setPerspective(t.value); return; }
  if (k === 'quality') settings.quality = t.value; else if (k === 'reduced') settings.reduced = t.checked; else if (k === 'music') settings.music=t.checked; else if (k === 'fov' || k === 'volume' || k === 'sensitivity') settings[k] = Number(t.value);
  if (k === 'fov') { const output = t.parentElement?.querySelector('output'); if (output) output.textContent = `${settings.fov}°`; }
  scene.settings(settings.quality, settings.fov, settings.reduced); try { localStorage.setItem('stone-settings', JSON.stringify(settings)); } catch { /* optional */ }
});
app.addEventListener('change', e => { const select = e.target as HTMLSelectElement; if (select.matches('[data-practice-armor]')) room?.send('practiceArmor', { level: Number(select.value) }); });
app.addEventListener('click', async e => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]'); const action = target?.dataset.action; if (!action) return;
  if (action === 'create-creative') void connect('create', '', undefined, 'creative');
  if (action === 'join-world' && target?.dataset.world) void connect('world', target.dataset.world);
  if (action === 'refresh-arenas') void refreshArenas();
  if (action === 'join-open' && target?.dataset.room) void connect('join', target.dataset.room);
  if (action === 'create' || action === 'join') { const code = document.querySelector<HTMLInputElement>('#code')?.value ?? ''; void connect(action, code); }
  if (action === 'weapon' && WEAPONS.includes(target?.dataset.weapon as Weapon)) { weaving = sculpting = false; weapon = target!.dataset.weapon as Weapon; mouseAttack = false; attackQueued = false; renderUI(); }
  if (action === 'close-scores') { scoreboard = false; if (me()?.alive && snapshot?.phase === 'active') void lockPointer(); else renderUI(); }
  if (action === 'offhand' && e.detail === 0) swapOffhand();
  if (action === 'worlds') { rememberWorld(true); releasePointer(); modal = 'worlds'; renderUI(); }
  if (action === 'export-world') exportWorld();
  if (action === 'continue-world' && !room) { const bookmark = worldKeeps.entries.find(b => b.handle.id === target?.dataset.keep); if (bookmark) void connect('create', '', bookmark.handle); }
  if ((action === 'checkpoint-world' || action === 'forget-online-world') && room && !disconnected && performance.now() >= keepCooldown) { keepCooldown = performance.now() + KEEP.messageMs; room.send(action === 'checkpoint-world' ? 'worldCheckpoint' : 'worldForget'); renderUI(); }
  if (action === 'restore-memory') { const saved = worldBook.entries.find(m => m.world.seed === Number(target?.dataset.seed)); if (saved) void importWorld(saved.world); }
  if (action === 'forget-world') { worldBook.forget(Number(target?.dataset.seed)); renderUI(); }
  if (action === 'restore-paste') { const save = parseWorldSave(document.querySelector<HTMLTextAreaElement>('#world-paste')?.value ?? ''); if (save) void importWorld(save); else { notice = 'Choose a valid Stone Arena world save.'; renderUI(); } }
  if (action === 'weave') toggleWeaving();
  if (action === 'sculpt') toggleSculpting();
  if (action === 'rune-kind' && validKind(Number(target?.dataset.kind))) { chooseRune(Number(target?.dataset.kind)); renderUI(); }
  if (action === 'loom') openLoom();
  if (action === 'gather' && !disconnected) { resetControls(); room?.send('gather'); enableAudio(); }
  if ((action === 'creature' || action === 'release-creature') && !disconnected) { resetControls(); room?.send('creature', action==='release-creature'?{action:'release'}:{}); enableAudio(); }
  if (action === 'glide' && !disconnected) { glidePulse.press(); enableAudio(); }
  if (action === 'craft' && !disconnected) { resetControls(); room?.send('craft', { recipe: target?.dataset.recipe }); enableAudio(); }
  if (action === 'track-supplies' && snapshot) { const recipe = recipeFor(target?.dataset.recipe); trackedRecipe = recipe?.id; trackedSupply = recipe?.cost.findIndex((cost,n) => cost > (snapshot!.world.supplies?.[n] ?? 0)); if (trackedSupply === undefined || trackedSupply < 0) trackedSupply = 0; trackedWaystone = undefined; modal = ''; void lockPointer(); }
  if (action === 'dash' && !disconnected) { dashPulse.press(); enableAudio(); }
  if (action === 'interact' && !disconnected) room?.send('interact');
  if (action === 'atlas' && me()?.realm === 'wilds') { releasePointer(); modal = 'atlas'; renderUI(); }
  if (action === 'atlas-page' && (target?.dataset.page==='map'||target?.dataset.page==='guide')) { atlas.page=target.dataset.page; renderUI(); }
  if (action === 'track-creature-food' && [0,1,2].includes(Number(target?.dataset.food))) { trackedRecipe=undefined;trackedWaystone=undefined;trackedSupply=Number(target?.dataset.food);modal='';void lockPointer(); }
  if (action === 'track-waystone') { trackedRecipe = undefined; trackedSupply = undefined; trackedWaystone = Number(target?.dataset.waystone); modal = ''; if (me()?.alive && snapshot?.phase === 'active') void lockPointer(); else renderUI(); }
  if (action === 'clear-track') { trackedRecipe = undefined; trackedWaystone = trackedSupply = undefined; renderUI(); }
  if (action === 'warp' && !disconnected) { resetControls(); room?.send('warp', { destination: Number(target?.dataset.waystone) }); modal = ''; void lockPointer(); }

  if (action === 'team' && !disconnected) room?.send('team', { team: target?.dataset.team });
  if (action === 'ready' && !disconnected && me()) room?.send('ready', { ready: !me()!.ready });
  if (action === 'start' && !disconnected) { room?.send('start', { practice: snapshot?.players.length === 1 && !isExplorationMode(snapshot.mode) }); void lockPointer(); }
  if (action === 'lobby') room?.send('lobby');
  if (action === 'play') void lockPointer();
  if (action === 'inspect-armor' && snapshot?.phase === 'active' && me()?.alive) { releasePointer(); scene.inspectArmor = true; modal = ''; renderUI(); }
  if (action === 'install') await installGame();
  if (action === 'leave') await leaveRoom();
  if (action === 'settings' || action === 'controls') { releasePointer(); modal = action; renderUI(); }
  if (action === 'close') { modal = ''; if (snapshot?.phase === 'active' && me()?.alive) void lockPointer(); else renderUI(); }
  if (action === 'spectate') { scene.spectator++; renderUI(); }
  if (action === 'invite') { try { await navigator.clipboard.writeText(location.href); notice = 'Invite copied. Send it to your friend.'; } catch { notice = `Share world or room code ${worldInvite?.id ?? room?.roomId}`; } renderUI(); setTimeout(() => { notice = ''; renderUI(); }, 3500); }
});
document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if ((e.code === 'F5' || e.code === 'KeyV') && room && snapshot?.phase !== 'waiting' && !modal && !scoreboard && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) setPerspective(nextPerspective(settings.perspective)); return; }
  if ((e.code === 'KeyM' || e.code === 'KeyE' && me() && nearbyWaystone(me()!, snapshot!.world.seed)) && snapshot?.phase === 'active' && me()?.alive && me()?.realm === 'wilds' && !modal && !scoreboard && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) { releasePointer(); modal = 'atlas'; renderUI(); } return; }
  if (e.code === 'KeyC' && !modal && !scoreboard && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) openLoom(); return; }
  if (e.code === 'KeyR' && snapshot?.phase==='active' && me()?.alive && me()?.realm==='wilds' && !modal && !scoreboard && !disconnected && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if(!e.repeat){resetControls();room?.send('creature');enableAudio();}return; }
  if (e.code === 'KeyE' && snapshot?.phase === 'active' && me()?.alive && me()?.realm === 'wilds' && !modal && !scoreboard && !disconnected && gatherTarget({ ...me()!, ...(local ?? {}), yaw, pitch }, snapshot.world, snapshot.tick)) { e.preventDefault(); if (!e.repeat) { resetControls(); room?.send('gather'); enableAudio(); } return; }
  if (e.code === 'KeyB' && !modal && !scoreboard && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) toggleWeaving(); return; }
  if (e.code === 'KeyX' && !modal && !scoreboard && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) toggleSculpting(); return; }
  if (e.code === 'KeyE' && snapshot?.phase === 'active' && me()?.alive && nearSecret(me()!) && !modal && !scoreboard && !disconnected) { if (!e.repeat) room?.send('interact'); return; }
  if (e.code === 'KeyF' && controlling() && !modal && !scoreboard && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) swapOffhand(); return; }
  if (controlling() && !modal && ['Tab', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Tab' && controlling() && !modal) scoreboard = true;
  if (e.code === 'Escape' && room && !locked()) { releasePointer(); modal = modal ? '' : 'settings'; renderUI(); }
  if (controlling() && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { if (e.code === 'KeyG') glidePulse.press(); if (e.code === 'KeyQ') dashPulse.press(); if (e.code === 'Space') jumpPulse.press(); }
  if (controlling()) { if (e.code === 'KeyW' && !e.repeat) { const now = performance.now(); doubleTapSprint = now - lastForwardTap < 250; lastForwardTap = now; } keys.add(e.code); if (dragLook && e.altKey) mouseAttack = false; const n = Number(e.key); if (weaving && n >= 1 && n <= RUNE_KINDS.length) chooseRune(n - 1); else if (!weaving && n >= 1 && n <= WEAPONS.length) { sculpting = false; mouseAttack = mouseBlock = attackQueued = false; weapon = WEAPONS[n - 1]; } }
  renderUI();
});
document.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyW') doubleTapSprint = false; if (e.code === 'Tab') { scoreboard = false; renderUI(); } });
document.addEventListener('mousemove', e => { if ((locked() || (dragLook && e.altKey && (e.buttons & 1))) && me()?.alive) { yaw -= e.movementX * .002 * settings.sensitivity; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * .002 * settings.sensitivity)); } });
document.addEventListener('mousedown', e => { if (controlling() && !mobile && !(e.target as HTMLElement).closest('button, input, select, .overlay')) { if (e.button === 0 && !(dragLook && e.altKey)) { mouseAttack = true; attackQueued = true; } if (e.button === 2) mouseBlock = true; } });
document.addEventListener('mouseup', e => { if (e.button === 0) mouseAttack = false; if (e.button === 2) mouseBlock = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => { if (controlling()) { if (weaving) weaveKind = (weaveKind + (e.deltaY > 0 ? 1 : RUNE_KINDS.length - 1)) % RUNE_KINDS.length; else { sculpting = false; mouseAttack = mouseBlock = attackQueued = false; weapon = WEAPONS[(WEAPONS.indexOf(weapon) + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length]; } } }, { passive: true });
document.addEventListener('pointerlockchange', () => { if (!locked()) { resetControls(); if (!expectedUnlock && snapshot?.phase === 'active' && me()?.alive) modal = 'settings'; } expectedUnlock = false; renderUI(); });
window.addEventListener('blur', resetControls); document.addEventListener('visibilitychange', () => { if (document.hidden) resetControls(); });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); resetControls(); notice = 'Graphics interrupted. Reload to reconnect to your arena.'; renderUI(); });
setInterval(() => { if (room?.connection.isOpen) room.send('ping', performance.now()); }, 2000);
let previous = performance.now();
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000, .1); previous = now; accumulator = Math.min(.1, accumulator + dt);
  const p = me();
  while (accumulator >= DT) {
    accumulator -= DT;
    if (room && snapshot?.phase === 'active' && p?.alive && !disconnected && local && contentsReady()) {
      if (touch.jumpQueued) { jumpPulse.press(); touch.jumpQueued = false; }
      const inputSequence = ++seq;
      const i: Input = { ...idleInput(), seq: inputSequence, x: Math.max(-1, Math.min(1, Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.x)), z: Math.max(-1, Math.min(1, Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + touch.z)), yaw, pitch, dash: dashPulse.value(inputSequence) || keys.has('KeyQ'), glide: glidePulse.value(inputSequence) || keys.has('KeyG'), jump: jumpPulse.value(inputSequence) || keys.has('Space') || touch.jump, descend: touch.descend || snapshot.mode === 'creative' && (keys.has('ShiftLeft') || keys.has('ShiftRight')), sprint: doubleTapSprint || keys.has('ControlLeft') || keys.has('ControlRight') || (!(snapshot.mode === 'creative' && local.flying) && (keys.has('ShiftLeft') || keys.has('ShiftRight'))) || touch.sprint, attack: mouseAttack || attackQueued, block: mouseBlock && (weaving || sculpting || offhand === 'shield'), weaving, sculpting, weaveKind, weapon, offhand };
      move(local, { ...i, block: !i.weaving && !i.sculpting && i.block && i.offhand === 'shield' && p.shieldDisabled <= 0 }, DT, (p.charge ?? 0) > 0, snapshot.world, snapshot.mode === 'creative'); pending.push(i); if (pending.length > 120) pending.shift(); room.send('input', i); attackQueued = false;
    }
  }
  rememberWorld();
  arenaAudio.update(dt,p,local,snapshot?.phase==='active'&&!disconnected,settings.volume,settings.music,snapshot?.world.seed ?? 0,snapshot?.creatures ?? [],snapshot?.world);
  scene.weavePreview = weaving; scene.erasePreview = mouseBlock; scene.sculptPreview = sculpting; scene.mendPreview = mouseBlock;
  scene.render(dt, snapshot, p, local, yaw, pitch, controlling(), keys.size > 0 || Math.hypot(touch.x, touch.z) > .1);
  requestAnimationFrame(frame);
}
document.addEventListener('change', async e => { const input = e.target as HTMLInputElement; if (input.id !== 'world-file' || !input.files?.[0]) return; const file = input.files[0]; if (file.size > SAVE_BYTES) { notice = 'That file is too large for a Stone Arena world.'; renderUI(); return; } const save = parseWorldSave(await file.text()); if (save) void importWorld(save); else { notice = 'Choose a valid Stone Arena world save.'; renderUI(); } });
window.addEventListener('pagehide', () => rememberWorld(true));
renderUI(); void refreshArenas(); requestAnimationFrame(frame);
try { const stored = JSON.parse(sessionStorage.getItem('stone-session') ?? 'null'); if (stored?.token && (!new URLSearchParams(location.search).get('room') || new URLSearchParams(location.search).get('room') === stored.code)) void connect('reconnect', stored.token); } catch { /* optional */ }
