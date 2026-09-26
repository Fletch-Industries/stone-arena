import { Client, type Room } from '@colyseus/sdk';
import { ArenaScene } from './scene.js';
import { APPLE, ARMOR_TIERS, armorTier, COLORS, DT, VERSION, attackStrength, WEAPONS, idleInput, move, type Body, type Input, type Player, type Snapshot, type Weapon } from '../shared/game.js';
import './style.css';
import { hotbar } from './hotbar.js';
import { exitPointerLock } from './pointer.js';
import { TouchControls } from './touch.js';
import { installGame } from './pwa.js';
import { PERSPECTIVES, PERSPECTIVE_LABELS, nextPerspective, validPerspective, type Perspective } from './camera.js';

const app = document.querySelector<HTMLDivElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const brand = '<div class="brand"><i class="brand-mark"></i> Stone Arena <small>Fletch Industries</small></div>';
let room: Room | undefined, snapshot: Snapshot | undefined, local: Body | undefined;
let yaw = 0, pitch = 0, weapon: Weapon = 'sword', seq = 0, accumulator = 0;
let pending: Input[] = [], lastPhase = '', lastRound = 0, eventId = 0, ping = 0, notice = '', error = '', busy = false;
let modal: 'settings' | 'controls' | '' = '', scoreboard = false, disconnected = false, lastHud = 0, nickname = '';
let mouseAttack = false, mouseBlock = false, expectedUnlock = false, dragLook = false, attackQueued = false;
let resultsEnteredAt = 0, lastForwardTap = -1000, doubleTapSprint = false;
let seatKey: string = crypto.randomUUID();
try { seatKey = sessionStorage.getItem('stone-seat') || seatKey; sessionStorage.setItem('stone-seat', seatKey); } catch { /* per-page identity when storage is unavailable */ }
const keys = new Set<string>();
const mobileQuery = matchMedia('(pointer: coarse), (max-width: 900px)');
let mobile = mobileQuery.matches, touchPlaying = false;
const settings = { sensitivity: 1, volume: .35, quality: mobile ? 'low' : 'medium', fov: 120, fovVersion: 2, perspective: 'first' as Perspective, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
const touch = new TouchControls({
  aim: (x, y) => { if (touchPlaying) { yaw -= x * .005 * settings.sensitivity; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); pitch = Math.max(-1.5, Math.min(1.5, pitch - y * .005 * settings.sensitivity)); } },
  attack: down => { mouseAttack = down; if (down) attackQueued = true; },
  block: down => { mouseBlock = down; },
  menu: () => { releasePointer(); modal = 'settings'; renderUI(); },
  scores: () => { releasePointer(); scoreboard = true; renderUI(); },
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
let audio: AudioContext | undefined;
function sound(frequency = 220, duration = .08, type: OscillatorType = 'triangle') {
  if (!audio || settings.volume <= 0) return;
  const o = audio.createOscillator(), gain = audio.createGain(); o.type = type; o.frequency.setValueAtTime(frequency, audio.currentTime); o.frequency.exponentialRampToValueAtTime(frequency / 2, audio.currentTime + duration); gain.gain.setValueAtTime(settings.volume * .12, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration); o.connect(gain); gain.connect(audio.destination); o.start(); o.stop(audio.currentTime + duration);
}
function enableAudio() { audio ??= new AudioContext(); void audio.resume(); }
let scene: ArenaScene;
try { scene = new ArenaScene(canvas); scene.settings(settings.quality, settings.fov, settings.reduced); scene.perspective = settings.perspective; touch.perspective(PERSPECTIVE_LABELS[settings.perspective]); }
catch { app.innerHTML = '<div class="overlay interactive"><div class="panel"><h2>Graphics unavailable</h2><p>Stone Arena needs WebGL 2. Enable hardware acceleration and try a current browser.</p></div></div>'; throw new Error('WebGL 2 unavailable'); }
const api = await fetch(new URL('config.json', location.href)).then(r => r.ok ? r.json() : Promise.reject()).then(c => c.api as string).catch(() => '/arena-api');
const endpoint = new URL(api, location.origin).href;
const client = new Client(endpoint);
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
setInterval(() => { if (!document.hidden) void checkAvailability(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkAvailability(); });
const me = () => snapshot?.players.find(p => p.id === room?.sessionId);
const locked = () => document.pointerLockElement === canvas;
const controlling = () => locked() || dragLook || touchPlaying;
function resetControls() { doubleTapSprint = false; lastForwardTap = -1000; keys.clear(); mouseAttack = false; mouseBlock = false; attackQueued = false; touch.reset(); }
function releasePointer() { touchPlaying = false; dragLook = false; expectedUnlock = true; exitPointerLock(document); resetControls(); }
async function lockPointer() {
  scene.inspectArmor = false;
  enableAudio(); modal = ''; scoreboard = false; if (mobile) { touchPlaying = true; notice = ''; renderUI(); return; } renderUI();
  try { await canvas.requestPointerLock(); dragLook = false; notice = ''; } catch { dragLook = true; notice = 'Hold Alt and drag to look · WASD to move · Escape for menu'; } renderUI();
}
function setPerspective(view: Perspective) {
  settings.perspective = view; scene.perspective = view; scene.inspectArmor = false;
  touch.perspective(PERSPECTIVE_LABELS[view]);
  try { localStorage.setItem('stone-settings', JSON.stringify(settings)); } catch { /* optional */ }
  renderUI();
}
function clearSession() { try { sessionStorage.removeItem('stone-session'); } catch { /* optional */ } }
async function leaveRoom() {
  const leaving = room; if (!leaving || busy) return;
  busy = true; leaving.reconnection.enabled = false; room = undefined; snapshot = undefined; local = undefined;
  disconnected = false; notice = ''; modal = ''; scoreboard = false; releasePointer(); clearSession();
  history.replaceState(null, '', location.pathname); error = ''; renderUI();
  try {
    if (leaving.connection.isOpen) await Promise.race([leaving.leave(), new Promise(resolve => setTimeout(resolve, 1500))]);
  } finally { leaving.connection.close(); busy = false; renderUI(); }
}
function storeSession() { try { if (room) sessionStorage.setItem('stone-session', JSON.stringify({ token: room.reconnectionToken, code: room.roomId })); } catch { /* optional */ } }
async function connect(action: 'create' | 'join' | 'reconnect', code = '') {
  if (busy || room) return; busy = true; error = ''; renderUI();
  try {
    if (action !== 'reconnect' && !nickname.trim()) throw new Error('Choose a nickname first.');
    const options = { name: nickname.trim().slice(0, 24), version: VERSION, seatKey };
    const joined = action === 'create' ? await client.create('arena', options) : action === 'join' ? await client.joinById(code.trim().toUpperCase(), options) : await client.reconnect(code);
    room = joined;
    joined.onMessage('maintenance', showUnavailable);
    joined.reconnection.minUptime = 0; joined.reconnection.maxDelay = 1000; joined.reconnection.maxRetries = 12;
    disconnected = false; eventId = 0; pending = []; lastPhase = ''; snapshot = undefined;
    try { localStorage.setItem('stone-name', nickname); } catch { /* optional */ }
    storeSession(); history.replaceState(null, '', `${location.pathname}?room=${room.roomId}`);
    joined.onMessage('snapshot', (s: Snapshot) => {
      if (room !== joined) return;
      const old = me(); snapshot = s; const p = me();
      if (p) {
        if (lastRound !== s.round || lastPhase !== s.phase || !local) { local = { ...p }; pending = []; yaw = p.yaw; pitch = p.pitch; weapon = p.weapon; seq = Math.max(seq, p.ack); }
        else { pending = pending.filter(i => i.seq > p.ack); local = { ...p }; if (p.alive && s.phase === 'active') for (const i of pending) move(local, { ...i, block: i.block && p.shieldDisabled <= 0 }, DT, p.charge > 0); }
        if (old && p.hp < old.hp) { const f = document.createElement('div'); f.className = 'damage-flash'; app.append(f); setTimeout(() => f.remove(), 300); sound(85, .15, 'sawtooth'); }
        if (old?.alive && !p.alive) { scene.inspectArmor = false; releasePointer(); notice = 'Eliminated. You can watch the remaining players.'; }
      }
      for (const e of s.events) if (e.id > eventId) {
        eventId = e.id; scene.event(e);
        if (e.actor === room?.sessionId) {
          if (e.type === 'heal') { notice = e.text ?? 'Healed'; sound(660, .25); setTimeout(() => { if (notice === e.text) { notice = ''; renderUI(); } }, 2500); }
          if (e.type === 'level') { notice = e.text ?? 'Armor upgraded'; sound(880, .22); setTimeout(() => { if (notice === e.text) { notice = ''; renderUI(); } }, 4000); }
          if (e.type === 'swing') { scene.swing = 1; sound(150, .08); }
          if (e.type === 'shot') sound(450, .1);
          if (e.type === 'hit') { sound(e.blocked ? 750 : e.critical ? 1550 : e.sprintHit ? 950 : 1100, .07); const c = document.querySelector('.crosshair'); c?.classList.add('hit'); setTimeout(() => c?.classList.remove('hit'), 120); }
        }
        if (e.type === 'start') sound(660, .25);
        if (e.type === 'result') sound(420, .5);
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
    joined.onMessage('actionError', (message: string) => { if (room === joined) { notice = message; renderUI(); } });
    joined.onDrop(() => { if (room !== joined) return; disconnected = true; resetControls(); notice = 'Connection lost. Reconnecting — your seat is reserved for 15 seconds.'; renderUI(); });
    joined.onReconnect(() => { if (room !== joined) { void joined.leave(); return; } disconnected = false; notice = ''; storeSession(); joined.send('sync'); renderUI(); });
    joined.onError((_code, message) => { if (room !== joined) return; notice = message ?? 'Connection error'; renderUI(); });
    joined.onLeave((_code, reason) => {
      if (room !== joined) return;
      room = undefined; snapshot = undefined; local = undefined; disconnected = false; notice = ''; modal = ''; scoreboard = false;
      releasePointer(); clearSession();
      error = reason || 'You left the arena. Create or join a room to play again.'; renderUI();
    });
    joined.send('sync');
  } catch (e) { error = e instanceof Error ? e.message : 'Could not connect. Check the room code and try again.'; if (action === 'reconnect') { try { sessionStorage.removeItem('stone-session'); } catch { /* optional */ } } }
  finally { busy = false; renderUI(); }
}
function footer() { return '<div class="footer"><span>One arena. One life. One survivor.</span><span><span>Browser multiplayer</span><span>© Fletch Industries</span></span></div>'; }
function scores() {
  const ps = [...(snapshot?.players ?? [])].sort((a, b) => Number(b.alive) - Number(a.alive) || b.eliminatedAt - a.eliminatedAt);
  return `<table class="score-table"><thead><tr><th>Player</th><th>Status</th><th>Level</th><th>Kills</th><th>Assists</th><th>Damage</th></tr></thead><tbody>${ps.map(p => `<tr class="${p.id === snapshot?.winner ? 'winner' : ''}"><td><span style="color:${COLORS[p.color]}">■</span> ${escape(p.name)}</td><td>${p.alive ? 'Alive' : 'Out'}</td><td>${armorTier(p.xp).level}</td><td>${p.kills}</td><td>${p.assists}</td><td>${Math.round(p.damage)}</td></tr>`).join('')}</tbody></table>`;
}
let lastHTML = '', lastModal = '';
function renderUI() {
  const p = me(), s = snapshot; let html = '';
  touch.item(weapon === 'apple');
  touch.show(mobile && touchPlaying && !!p?.alive && s?.phase === 'active' && !modal && !scoreboard && !disconnected);
  if ((busy || room) && !s) {
    html = `<section class="screen interactive">${brand}<div class="lobby"><h2>${room ? 'Entering your arena…' : 'Connecting…'}</h2><p role="status">Please wait while we confirm your seat.</p></div></section>`;
  } else if (!room || !s) {
    const code = new URLSearchParams(location.search).get('room') ?? '';
    html = `<section class="screen interactive">${brand}<div class="hero"><div class="eyebrow"><i class="dot"></i> Last player standing</div><h1>STONE<br><span>ARENA.</span></h1><p class="lead">Five enter. One survives.<br>Grab your gear. Bring your friends. Hold your ground.</p><div class="traits"><span><b>05</b> Players max</span><span><b>01</b> Life each</span><span><b>∞</b> No time limit</span></div><div class="form"><label class="label" for="nickname">Your arena name</label><input class="input" id="nickname" maxlength="24" placeholder="Enter your nickname" value="${escape(nickname)}" autocomplete="nickname"><button class="btn gold wide" data-action="create" ${busy ? 'disabled' : ''}>${busy ? 'Connecting…' : 'Create a private arena &nbsp; ↗'}</button><div class="row join-row"><input class="input" id="code" placeholder="Room code" aria-label="Room code" maxlength="20" value="${escape(code)}"><button class="btn" data-action="join" ${busy ? 'disabled' : ''}>Join room</button></div><div class="landing-links"><button class="text-btn" data-action="controls">How to play &nbsp; →</button><button class="text-btn install-game" data-action="install">Install game ↗</button><a class="text-btn" href="https://github.com/Fletch-Industries/stone-arena/issues/new/choose" target="_blank" rel="noopener noreferrer">Suggest a feature ↗</a></div><div class="error" role="status">${escape(error)}</div></div></div><div class="scene-label"><b>The Stone Courtyard</b>Free-for-all · Original arena</div>${footer()}</section>`;
  } else if (s.phase === 'waiting') {
    html = `<section class="screen interactive">${brand}<div class="lobby"><div class="eyebrow"><i class="dot"></i> Private arena</div><h2>Gather your contenders.</h2><p>Share the link. Ready up. Only one walks out.</p><div class="panel"><div class="row" style="justify-content:space-between"><div><span class="label">Room code</span><span class="room-code">${room.roomId}</span></div><button class="btn" data-action="invite">Copy invite</button></div><div class="players">${Array.from({ length: 5 }, (_, n) => { const q = s.players[n]; return q ? `<div class="player-row"><i class="avatar" style="background:${COLORS[q.color]}"></i><span class="name">${escape(q.name)} ${q.id === s.host ? '<span class="tag">Host</span>' : ''}</span><span class="tag ${q.ready ? 'ready' : ''}">${!q.connected ? 'Reconnecting' : q.ready ? 'Ready' : 'Not ready'}</span></div>` : '<div class="player-row"><i class="avatar" style="background:#26343b"></i><span class="name" style="color:#7c8c91">Waiting for player…</span><span class="tag">Open</span></div>'; }).join('')}</div><div class="room-actions"><button class="btn ${p?.ready ? '' : 'gold'}" data-action="ready" ${disconnected ? 'disabled' : ''}>${p?.ready ? 'Unready' : 'Ready up'}</button>${s.host === room.sessionId ? `<button class="btn gold" data-action="start" ${disconnected || !s.players.every(q => q.ready && q.connected) ? 'disabled' : ''}>${s.players.length === 1 ? 'Practice solo' : 'Start round'}</button>` : ''}</div><p class="help">${s.players.length === 1 ? 'Invite a friend for a competitive round. Solo practice lets you explore the arena and weapons.' : 'Everyone gets one life. Eliminated players spectate. The final survivor wins.'}</p></div><div class="row"><button class="text-btn" data-action="controls">Controls</button><button class="text-btn" data-action="settings">Settings</button><button class="text-btn" data-action="leave">Leave room</button></div></div>${footer()}</section>`;
  } else {
    const alive = s.players.filter(q => q.alive).length;
    html = `<div class="hud"><div class="topbar"><div class="badge"><strong>${alive}</strong> ${s.practice ? 'Practice' : 'remaining'} <span style="color:#8fa2a5"> / ${s.players.length}</span></div><div class="net">STONE ARENA · ROUND ${s.round}<br>${ping} ms · ${scene.fps} FPS<br>${mobile ? 'Touch controls · landscape recommended' : '<kbd>ESC</kbd> Menu &nbsp; <kbd>TAB</kbd> Scoreboard &nbsp; <kbd>F5 / V</kbd> View'}</div></div><div class="feed">${s.events.filter(e => e.type === 'kill').slice(-4).map(e => `<div>${escape(e.text ?? '')}</div>`).join('')}</div>${p?.alive ? `${settings.perspective === 'first' && !scene.inspectArmor ? '<div class="crosshair"></div>' : ''}<div class="bottom">${hotbar(p, weapon)}<div class="charge" role="progressbar" aria-label="${weapon === 'apple' ? 'Eating golden apple' : weapon === 'bow' ? 'Bow draw' : weapon === 'crossbow' ? 'Crossbow load' : 'Attack strength'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((weapon === 'apple' ? p.charge / APPLE.seconds : weapon === 'bow' ? p.charge : weapon === 'crossbow' ? p.loaded ? 1 : p.charge / 1.25 : attackStrength(p)) * 100)}"><i style="width:${Math.min(100, (weapon === 'apple' ? p.charge / APPLE.seconds : weapon === 'bow' ? p.charge : weapon === 'crossbow' ? p.loaded ? 1 : p.charge / 1.25 : attackStrength(p)) * 100)}%"></i></div><div class="combat-hint">${weapon === 'apple' ? p.apples === 0 ? 'No apples left this round' : p.hp >= 100 ? 'Full health · Save your apples' : `${mobile ? 'Hold Eat' : 'Hold left mouse'} to eat · Restores up to 4 hearts` : mobile ? weapon === 'bow' ? 'Hold Attack to draw · release to shoot' : weapon === 'crossbow' ? p.loaded ? 'Loaded · tap Attack to fire' : p.charge ? 'Loading…' : 'Tap Attack to load' : 'Time hits for full power · Hold Attack to repeat' : weapon === 'bow' ? 'Hold left mouse to draw · release to shoot' : weapon === 'crossbow' ? p.loaded ? 'Loaded · click to fire' : p.charge ? 'Loading…' : 'Click to load · click again to fire' : 'Left mouse to attack'}${mobile ? '' : ' · Right mouse to block'}${dragLook ? ' · Alt + drag to look' : ''}</div></div>` : `<div class="spectate interactive"><span class="eyebrow" style="justify-content:center;margin:0">Eliminated · Spectating</span><p>${escape(s.players.filter(q => q.alive)[scene.spectator % Math.max(1, alive)]?.name ?? 'Round finished')}</p><button class="btn" data-action="spectate">Next player →</button></div>`}</div>`;
    if (!scene.inspectArmor) html += `<div class="perspective-hint" aria-label="Perspective">${PERSPECTIVE_LABELS[settings.perspective]}${settings.perspective !== 'first' ? '<small>Attacks follow your character’s facing direction</small>' : ''}</div>`;
    if (s.phase === 'countdown') html += `<div class="center-message"><div class="eyebrow" style="justify-content:center">One life. Make it count.</div><div class="count">${Math.ceil(s.countdown)}</div></div>`;
    if (s.phase === 'active' && p?.alive && !controlling() && !modal && !scoreboard && !disconnected) html += `<div class="center-message interactive ${scene.inspectArmor ? 'armor-inspection' : ''}"><button class="btn gold" data-action="play">${scene.inspectArmor ? 'Resume play' : `${mobile ? 'Tap' : 'Click'} to enter the arena`}</button>${scene.inspectArmor ? '<button class="btn" data-action="settings">Settings</button>' : ''}<p>${scene.inspectArmor ? 'Character preview · The round continues' : mobile ? 'Left stick to move · Swipe right side to aim' : 'WASD to move · Mouse to aim'}</p></div>`;
    if (s.phase === 'results') html += `<div class="overlay interactive"><div class="panel results"><div class="eyebrow">${s.winner ? 'Last player standing' : 'No survivors'}</div><h2>${escape(s.result)}</h2><p>One life. Every decision mattered.</p>${scores()}${s.host === room.sessionId ? `<button class="btn gold wide" data-action="lobby" ${performance.now() - resultsEnteredAt < 3100 ? 'disabled' : ''}>${performance.now() - resultsEnteredAt < 3100 ? 'Next round in ' + Math.ceil((3100 - (performance.now() - resultsEnteredAt)) / 1000) + '…' : 'Back to lobby · Rematch'}</button>` : '<p class="help">Waiting for the host to return to the lobby.</p>'}<button class="text-btn" data-action="leave">Leave arena</button></div></div>`;
    if (scoreboard && s.phase !== 'results') html += `<div class="overlay interactive"><div class="panel results"><h2>Round ${s.round}</h2>${scores()}<p class="help">Survival decides the winner.</p><button class="btn gold" data-action="close-scores">Return to game</button></div></div>`;
  }
  if (notice) html += `<div class="notice" role="status">${escape(notice)}</div>`;
  if (modal) {
    html += `<div class="overlay interactive"><div class="panel"><div class="eyebrow">Stone Arena</div><h2>${modal === 'settings' ? 'Your settings' : 'Hold your ground.'}</h2>`;
    if (modal === 'settings') html += `<div class="settings-grid"><label class="setting">Aim sensitivity<input data-setting="sensitivity" type="range" min="0.2" max="2.5" step="0.1" value="${settings.sensitivity}"></label><label class="setting">Sound volume<input data-setting="volume" type="range" min="0" max="1" step="0.05" value="${settings.volume}"></label><label class="setting" for="camera-fov">Field of view <output aria-hidden="true">${settings.fov}°</output><input id="camera-fov" data-setting="fov" type="range" min="60" max="120" step="1" value="${settings.fov}"></label><label class="setting">Perspective<select data-setting="perspective">${PERSPECTIVES.map(v => `<option value="${v}" ${v === settings.perspective ? 'selected' : ''}>${PERSPECTIVE_LABELS[v]}</option>`).join('')}</select></label><label class="setting">Graphics<select data-setting="quality">${['low', 'medium', 'high'].map(q => `<option ${q === settings.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></label><label class="setting">Reduced camera motion<input type="checkbox" data-setting="reduced" ${settings.reduced ? 'checked' : ''}></label></div>${snapshot?.practice && snapshot.phase === 'active' ? `<label class="setting">Practice armor<select data-practice-armor>${ARMOR_TIERS.map(t => `<option value="${t.level}" ${t.level === armorTier(me()?.xp ?? 0).level ? 'selected' : ''}>Level ${t.level} · ${t.name}</option>`).join('')}</select></label>` : ''}${snapshot?.phase === 'active' && me()?.alive ? '<button class="text-btn" data-action="inspect-armor">View your character · 360°</button>' : ''}<p class="help">The round continues while the menu is open.</p>`;
    else html += '<p class="mobile-instructions">Touch: left thumbstick to move, swipe the right side to aim. Hold Attack to swing or draw a bow; release to shoot. Tap twice to load and fire a crossbow. Hold Shield, tap Jump, toggle Sprint, and tap the weapon bar to equip. Tap View to change perspective.</p><p>Up to five players. One life each. The final survivor wins. After elimination, watch your friends finish the round.</p><div class="controls"><span><kbd>W A S D</kbd> Move</span><span><kbd>MOUSE</kbd> Aim</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>CTRL / SHIFT</kbd> Sprint</span><span><kbd>LMB</kbd> Attack / draw</span><span><kbd>RMB</kbd> Shield</span><span><kbd>1 – 5</kbd> Select item</span><span><kbd>TAB</kbd> Scoreboard</span><span><kbd>F5 / V</kbd> Perspective</span></div><p class="help">Time melee hits for full power. Sprint hits push enemies back; strike while falling without sprinting for a critical hit. Shields block the front after raising; axe hits disable them for 5 seconds. Bows charge while held. Crossbows take one click to load and another to fire. No respawns or time limit. Select slot 5 and hold left mouse (Eat on mobile) to eat a golden apple: 1.6 seconds, up to 4 hearts restored, two per round. Releasing, switching items or blocking cancels eating.</p><p class="help">Deal damage to earn 1 XP per HP, plus 50 XP per elimination. Level 2 at 50 XP equips Guard armor (20% damage reduction). Level 3 at 150 XP equips Enchanted armor (35%). Everyone starts at level 1 each round. Armor never heals you.</p><p class="help">F5 or V cycles first person, third-person rear, and third-person front. Mobile: tap View. Movement and attacks still follow your character’s facing direction. Settings also offers a 360° character preview; the round keeps running.</p>';
    html += `<button class="btn gold wide" data-action="close">${snapshot?.phase === 'active' && me()?.alive ? 'Resume game' : 'Got it'}</button>${room ? `<div class="row">${snapshot?.practice ? '<button class="text-btn" data-action="lobby">Return to lobby</button>' : ''}<button class="text-btn" data-action="leave">Leave room</button></div>` : ''}</div></div>`;
  }
  // Preserve focused inputs and slider drags; HUD remains independently render-driven.
  const preserveModal = !!modal && modal === lastModal && !!app.querySelector('.overlay');
  if (html !== lastHTML && !preserveModal && !(document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range')) {
    const scroll = app.querySelector('.overlay')?.scrollTop ?? 0;
    app.innerHTML = html; lastHTML = html;
    const overlay = app.querySelector('.overlay'); if (overlay) overlay.scrollTop = scroll;
  }
  lastModal = modal;
}
app.addEventListener('pointerdown', e => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-weapon]');
  if (target && WEAPONS.includes(target.dataset.weapon as Weapon)) { e.preventDefault(); weapon = target.dataset.weapon as Weapon; mouseAttack = false; attackQueued = false; renderUI(); }
});
app.addEventListener('input', e => { const t = e.target as HTMLInputElement; if (t.id === 'nickname') nickname = t.value; });
app.addEventListener('change', e => {
  const t = e.target as HTMLInputElement; const k = t.dataset.setting;
  if (!k) return;
  if (k === 'perspective' && validPerspective(t.value)) { setPerspective(t.value); return; }
  if (k === 'quality') settings.quality = t.value; else if (k === 'reduced') settings.reduced = t.checked; else if (k === 'fov' || k === 'volume' || k === 'sensitivity') settings[k] = Number(t.value);
  if (k === 'fov') { const output = t.parentElement?.querySelector('output'); if (output) output.textContent = `${settings.fov}°`; }
  scene.settings(settings.quality, settings.fov, settings.reduced); try { localStorage.setItem('stone-settings', JSON.stringify(settings)); } catch { /* optional */ }
});
app.addEventListener('change', e => { const select = e.target as HTMLSelectElement; if (select.matches('[data-practice-armor]')) room?.send('practiceArmor', { level: Number(select.value) }); });
app.addEventListener('click', async e => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]'); const action = target?.dataset.action; if (!action) return;
  if (action === 'create' || action === 'join') { const code = document.querySelector<HTMLInputElement>('#code')?.value ?? ''; void connect(action, code); }
  if (action === 'weapon' && WEAPONS.includes(target?.dataset.weapon as Weapon)) { weapon = target!.dataset.weapon as Weapon; mouseAttack = false; attackQueued = false; renderUI(); }
  if (action === 'close-scores') { scoreboard = false; if (me()?.alive && snapshot?.phase === 'active') void lockPointer(); else renderUI(); }
  if (action === 'ready' && !disconnected && me()) room?.send('ready', { ready: !me()!.ready });
  if (action === 'start' && !disconnected) { room?.send('start', { practice: snapshot?.players.length === 1 }); void lockPointer(); }
  if (action === 'lobby') room?.send('lobby');
  if (action === 'play') void lockPointer();
  if (action === 'inspect-armor' && snapshot?.phase === 'active' && me()?.alive) { releasePointer(); scene.inspectArmor = true; modal = ''; renderUI(); }
  if (action === 'install') await installGame();
  if (action === 'leave') await leaveRoom();
  if (action === 'settings' || action === 'controls') { releasePointer(); modal = action; renderUI(); }
  if (action === 'close') { modal = ''; if (snapshot?.phase === 'active' && me()?.alive) void lockPointer(); else renderUI(); }
  if (action === 'spectate') { scene.spectator++; renderUI(); }
  if (action === 'invite') { try { await navigator.clipboard.writeText(location.href); notice = 'Invite copied. Send it to your friend.'; } catch { notice = `Share room code ${room?.roomId}`; } renderUI(); setTimeout(() => { notice = ''; renderUI(); }, 3500); }
});
document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if ((e.code === 'F5' || e.code === 'KeyV') && room && snapshot?.phase !== 'waiting' && !modal && !scoreboard && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) setPerspective(nextPerspective(settings.perspective)); return; }
  if (controlling() && !modal && ['Tab', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Tab' && controlling() && !modal) scoreboard = true;
  if (e.code === 'Escape' && room && !locked()) { releasePointer(); modal = modal ? '' : 'settings'; renderUI(); }
  if (controlling()) { if (e.code === 'KeyW' && !e.repeat) { const now = performance.now(); doubleTapSprint = now - lastForwardTap < 250; lastForwardTap = now; } keys.add(e.code); if (dragLook && e.altKey) mouseAttack = false; const n = Number(e.key); if (n >= 1 && n <= WEAPONS.length) weapon = WEAPONS[n - 1]; }
  renderUI();
});
document.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyW') doubleTapSprint = false; if (e.code === 'Tab') { scoreboard = false; renderUI(); } });
document.addEventListener('mousemove', e => { if ((locked() || (dragLook && e.altKey && (e.buttons & 1))) && me()?.alive) { yaw -= e.movementX * .002 * settings.sensitivity; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * .002 * settings.sensitivity)); } });
document.addEventListener('mousedown', e => { if (controlling() && !mobile && !(e.target as HTMLElement).closest('button, input, select, .overlay')) { if (e.button === 0 && !(dragLook && e.altKey)) { mouseAttack = true; attackQueued = true; } if (e.button === 2) mouseBlock = true; } });
document.addEventListener('mouseup', e => { if (e.button === 0) mouseAttack = false; if (e.button === 2) mouseBlock = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => { if (controlling()) weapon = WEAPONS[(WEAPONS.indexOf(weapon) + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length]; }, { passive: true });
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
    if (room && snapshot?.phase === 'active' && p?.alive && !disconnected && local) {
      const i: Input = { ...idleInput(), seq: ++seq, x: Math.max(-1, Math.min(1, Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.x)), z: Math.max(-1, Math.min(1, Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + touch.z)), yaw, pitch, jump: keys.has('Space') || touch.jump || touch.jumpQueued, sprint: doubleTapSprint || keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.sprint, attack: mouseAttack || attackQueued, block: mouseBlock, weapon };
      move(local, { ...i, block: i.block && p.shieldDisabled <= 0 }, DT, (p.charge ?? 0) > 0); pending.push(i); if (pending.length > 120) pending.shift(); room.send('input', i); attackQueued = false; touch.jumpQueued = false;
    }
  }
  scene.render(dt, snapshot, p, local, yaw, pitch, controlling(), keys.size > 0 || Math.hypot(touch.x, touch.z) > .1);
  requestAnimationFrame(frame);
}
renderUI(); requestAnimationFrame(frame);
try { const stored = JSON.parse(sessionStorage.getItem('stone-session') ?? 'null'); if (stored?.token && (!new URLSearchParams(location.search).get('room') || new URLSearchParams(location.search).get('room') === stored.code)) void connect('reconnect', stored.token); } catch { /* optional */ }
