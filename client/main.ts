import { Client, type Room } from '@colyseus/sdk';
import { ArenaScene } from './scene.js';
import { COLORS, DT, VERSION, WEAPONS, idleInput, move, type Body, type Input, type Player, type Snapshot, type Weapon } from '../shared/game.js';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const icons: Record<Weapon, string> = {
  sword: '<path d="M8 26L25 9L27 3L21 5L5 22M5 18L14 27" stroke="#bce6df" stroke-width="4"/>',
  axe: '<path d="M8 29L23 5" stroke="#bc915c" stroke-width="4"/><path d="M15 5L25 12L30 6L21 1Z" fill="#c0dfd5"/>',
  bow: '<path d="M6 3Q38 16 6 29L6 3M3 16L28 16" stroke="#d8b477" stroke-width="3" fill="none"/>',
  crossbow: '<path d="M16 29V3M3 10L16 5L29 10" stroke="#c3d2ba" stroke-width="4"/><path d="M12 29L12 15L20 15L20 29" fill="#ac804e"/>',
};
const icon = (w: Weapon) => `<svg viewBox="0 0 32 32" aria-hidden="true">${icons[w]}</svg>`;
const brand = '<div class="brand"><i class="brand-mark"></i> Stone Arena <small>Fletch Industries</small></div>';
let room: Room | undefined, snapshot: Snapshot | undefined, local: Body | undefined;
let yaw = 0, pitch = 0, weapon: Weapon = 'sword', seq = 0, accumulator = 0;
let pending: Input[] = [], lastPhase = '', lastRound = 0, eventId = 0, ping = 0, notice = '', error = '', busy = false;
let modal: 'settings' | 'controls' | '' = '', scoreboard = false, disconnected = false, lastHud = 0, nickname = '';
let mouseAttack = false, mouseBlock = false, expectedUnlock = false;
const keys = new Set<string>();
const settings = { sensitivity: 1, volume: .35, quality: 'medium', fov: 78, reduced: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('stone-settings') ?? '{}')); nickname = localStorage.getItem('stone-name') ?? ''; } catch { /* private browser storage may be unavailable */ }
let audio: AudioContext | undefined;
function sound(frequency = 220, duration = .08, type: OscillatorType = 'triangle') {
  if (!audio || settings.volume <= 0) return;
  const o = audio.createOscillator(), gain = audio.createGain(); o.type = type; o.frequency.setValueAtTime(frequency, audio.currentTime); o.frequency.exponentialRampToValueAtTime(frequency / 2, audio.currentTime + duration); gain.gain.setValueAtTime(settings.volume * .12, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration); o.connect(gain); gain.connect(audio.destination); o.start(); o.stop(audio.currentTime + duration);
}
function enableAudio() { audio ??= new AudioContext(); void audio.resume(); }
let scene: ArenaScene;
try { scene = new ArenaScene(canvas); scene.settings(settings.quality, settings.fov, settings.reduced); }
catch { app.innerHTML = '<div class="overlay interactive"><div class="panel"><h2>Graphics unavailable</h2><p>Stone Arena needs WebGL 2. Enable hardware acceleration and try a current desktop browser.</p></div></div>'; throw new Error('WebGL 2 unavailable'); }
const api = await fetch(new URL('config.json', location.href)).then(r => r.ok ? r.json() : Promise.reject()).then(c => c.api as string).catch(() => '/arena-api');
const endpoint = new URL(api, location.origin).href;
const client = new Client(endpoint);
const me = () => snapshot?.players.find(p => p.id === room?.sessionId);
const locked = () => document.pointerLockElement === canvas;
function resetControls() { keys.clear(); mouseAttack = false; mouseBlock = false; }
function releasePointer() { expectedUnlock = true; document.exitPointerLock(); resetControls(); }
async function lockPointer() {
  enableAudio(); modal = ''; renderUI();
  try { await canvas.requestPointerLock(); } catch { notice = 'Click the arena to capture the mouse. Escape releases it.'; renderUI(); }
}
function storeSession() { try { if (room) sessionStorage.setItem('stone-session', JSON.stringify({ token: room.reconnectionToken, code: room.roomId })); } catch { /* optional */ } }
async function connect(action: 'create' | 'join' | 'reconnect', code = '') {
  if (busy) return; busy = true; error = ''; renderUI();
  try {
    if (action !== 'reconnect' && !nickname.trim()) throw new Error('Choose a nickname first.');
    const options = { name: nickname.trim().slice(0, 24), version: VERSION };
    room = action === 'create' ? await client.create('arena', options) : action === 'join' ? await client.joinById(code.trim().toUpperCase(), options) : await client.reconnect(code);
    disconnected = false; eventId = 0; pending = []; lastPhase = ''; snapshot = undefined;
    try { localStorage.setItem('stone-name', nickname); } catch { /* optional */ }
    storeSession(); history.replaceState(null, '', `${location.pathname}?room=${room.roomId}`);
    room.onMessage('snapshot', (s: Snapshot) => {
      const old = me(); snapshot = s; const p = me();
      if (p) {
        if (lastRound !== s.round || lastPhase !== s.phase || !local) { local = { ...p }; pending = []; yaw = p.yaw; pitch = p.pitch; weapon = p.weapon; seq = Math.max(seq, p.ack); }
        else { pending = pending.filter(i => i.seq > p.ack); local = { ...p }; if (p.alive && s.phase === 'active') for (const i of pending) move(local, i, DT, p.charge > 0); }
        if (old && p.hp < old.hp) { const f = document.createElement('div'); f.className = 'damage-flash'; app.append(f); setTimeout(() => f.remove(), 300); sound(85, .15, 'sawtooth'); }
        if (old?.alive && !p.alive) { releasePointer(); notice = 'Eliminated. You can watch the remaining players.'; }
      }
      for (const e of s.events) if (e.id > eventId) {
        eventId = e.id;
        if (e.actor === room?.sessionId) {
          if (e.type === 'swing') { scene.swing = 1; sound(150, .08); }
          if (e.type === 'shot') sound(450, .1);
          if (e.type === 'hit') { sound(e.blocked ? 750 : 1100, .07); const c = document.querySelector('.crosshair'); c?.classList.add('hit'); setTimeout(() => c?.classList.remove('hit'), 120); }
        }
        if (e.type === 'start') sound(660, .25);
        if (e.type === 'result') sound(420, .5);
      }
      if (s.phase !== lastPhase || s.round !== lastRound) {
        if (s.phase === 'results' || s.phase === 'waiting') releasePointer();
        modal = ''; notice = ''; lastPhase = s.phase; lastRound = s.round; renderUI();
      }
      if (performance.now() - lastHud > 90) { renderUI(); lastHud = performance.now(); }
    });
    room.onMessage('pong', (n: number) => { ping = Math.round(performance.now() - n); });
    room.onMessage('latency', (n: number) => room?.send('latencyAck', n));
    room.onDrop(() => { disconnected = true; resetControls(); notice = 'Connection lost. Reconnecting — your life is preserved.'; renderUI(); });
    room.onReconnect(() => { disconnected = false; notice = ''; storeSession(); room?.send('sync'); renderUI(); });
    room.onError((_code, message) => { notice = message ?? 'Connection error'; renderUI(); });
    room.onLeave(() => { room = undefined; snapshot = undefined; local = undefined; releasePointer(); try { sessionStorage.removeItem('stone-session'); } catch { /* optional */ } error = 'You left the arena. Create or join a room to play again.'; renderUI(); });
    room.send('sync');
  } catch (e) { error = e instanceof Error ? e.message : 'Could not connect. Check the room code and try again.'; if (action === 'reconnect') { try { sessionStorage.removeItem('stone-session'); } catch { /* optional */ } } }
  finally { busy = false; renderUI(); }
}
function footer() { return '<div class="footer"><span>One arena. One life. One survivor.</span><span><span>Browser multiplayer</span><span>© Fletch Industries</span></span></div>'; }
function scores() {
  const ps = [...(snapshot?.players ?? [])].sort((a, b) => Number(b.alive) - Number(a.alive) || b.eliminatedAt - a.eliminatedAt);
  return `<table class="score-table"><thead><tr><th>Player</th><th>Status</th><th>Kills</th><th>Assists</th><th>Damage</th></tr></thead><tbody>${ps.map(p => `<tr class="${p.id === snapshot?.winner ? 'winner' : ''}"><td><span style="color:${COLORS[p.color]}">■</span> ${escape(p.name)}</td><td>${p.alive ? 'Alive' : 'Out'}</td><td>${p.kills}</td><td>${p.assists}</td><td>${Math.round(p.damage)}</td></tr>`).join('')}</tbody></table>`;
}
let lastHTML = '';
function renderUI() {
  const p = me(), s = snapshot; let html = '';
  if (!room || !s) {
    const code = new URLSearchParams(location.search).get('room') ?? '';
    html = `<section class="screen interactive">${brand}<div class="hero"><div class="eyebrow"><i class="dot"></i> Last player standing</div><h1>STONE<br><span>ARENA.</span></h1><p class="lead">Five enter. One survives.<br>Grab your gear. Bring your friends. Hold your ground.</p><div class="traits"><span><b>05</b> Players max</span><span><b>01</b> Life each</span><span><b>∞</b> No time limit</span></div><div class="form"><label class="label" for="nickname">Your arena name</label><input class="input" id="nickname" maxlength="24" placeholder="Enter your nickname" value="${escape(nickname)}" autocomplete="nickname"><button class="btn gold wide" data-action="create" ${busy ? 'disabled' : ''}>${busy ? 'Connecting…' : 'Create a private arena &nbsp; ↗'}</button><div class="row join-row"><input class="input" id="code" placeholder="Room code" aria-label="Room code" maxlength="20" value="${escape(code)}"><button class="btn" data-action="join" ${busy ? 'disabled' : ''}>Join room</button></div><button class="text-btn" data-action="controls">How to play &nbsp; →</button><div class="error" role="status">${escape(error)}</div></div></div><div class="scene-label"><b>The Stone Courtyard</b>Free-for-all · Original arena</div>${footer()}</section>`;
  } else if (s.phase === 'waiting') {
    html = `<section class="screen interactive">${brand}<div class="lobby"><div class="eyebrow"><i class="dot"></i> Private arena</div><h2>Gather your contenders.</h2><p>Share the link. Ready up. Only one walks out.</p><div class="panel"><div class="row" style="justify-content:space-between"><div><span class="label">Room code</span><span class="room-code">${room.roomId}</span></div><button class="btn" data-action="invite">Copy invite</button></div><div class="players">${Array.from({ length: 5 }, (_, n) => { const q = s.players[n]; return q ? `<div class="player-row"><i class="avatar" style="background:${COLORS[q.color]}"></i><span class="name">${escape(q.name)} ${q.id === s.host ? '<span class="tag">Host</span>' : ''}</span><span class="tag ${q.ready ? 'ready' : ''}">${!q.connected ? 'Reconnecting' : q.ready ? 'Ready' : 'Not ready'}</span></div>` : '<div class="player-row"><i class="avatar" style="background:#26343b"></i><span class="name" style="color:#7c8c91">Waiting for player…</span><span class="tag">Open</span></div>'; }).join('')}</div><div class="room-actions"><button class="btn ${p?.ready ? '' : 'gold'}" data-action="ready">${p?.ready ? 'Unready' : 'Ready up'}</button>${s.host === room.sessionId ? `<button class="btn gold" data-action="start" ${!s.players.every(q => q.ready && q.connected) ? 'disabled' : ''}>${s.players.length === 1 ? 'Practice solo' : 'Start round'}</button>` : ''}</div><p class="help">${s.players.length === 1 ? 'Invite a friend for a competitive round. Solo practice lets you explore the arena and weapons.' : 'Everyone gets one life. Eliminated players spectate. The final survivor wins.'}</p></div><div class="row"><button class="text-btn" data-action="controls">Controls</button><button class="text-btn" data-action="settings">Settings</button><button class="text-btn" data-action="leave">Leave room</button></div></div>${footer()}</section>`;
  } else {
    const alive = s.players.filter(q => q.alive).length;
    html = `<div class="hud"><div class="topbar"><div class="badge"><strong>${alive}</strong> ${s.practice ? 'Practice' : 'remaining'} <span style="color:#8fa2a5"> / ${s.players.length}</span></div><div class="net">STONE ARENA · ROUND ${s.round}<br>${ping} ms · ${scene.fps} FPS<br><kbd>ESC</kbd> Menu &nbsp; <kbd>TAB</kbd> Scoreboard</div></div><div class="feed">${s.events.filter(e => e.type === 'kill').slice(-4).map(e => `<div>${escape(e.text ?? '')}</div>`).join('')}</div>${p?.alive ? `<div class="crosshair"></div><div class="bottom"><div class="vitals"><b>♥ ${Math.ceil(p.hp)}</b><div class="health-track"><div class="health-fill" style="width:${p.hp}%"></div></div><span>${p.ammo} ARROWS</span><span>${p.block ? '◈ BLOCKING' : p.shieldDisabled > 0 ? 'SHIELD DISABLED' : '◈ SHIELD'}</span></div><div class="slots">${WEAPONS.map((w, i) => `<div class="slot ${weapon === w ? 'selected' : ''}"><small>${i + 1}</small>${icon(w)}${w[0].toUpperCase() + w.slice(1)}</div>`).join('')}</div><div class="charge"><i style="width:${Math.min(100, (p.charge || p.cooldown) * 100)}%"></i></div><div class="combat-hint">${weapon === 'bow' ? 'Hold left mouse to draw · release to shoot' : weapon === 'crossbow' ? p.loaded ? 'Loaded · click to fire' : p.charge ? 'Loading…' : 'Click to load · click again to fire' : 'Left mouse to attack'} &nbsp; · &nbsp; Right mouse to block</div></div>` : `<div class="spectate interactive"><span class="eyebrow" style="justify-content:center;margin:0">Eliminated · Spectating</span><p>${escape(s.players.filter(q => q.alive)[scene.spectator % Math.max(1, alive)]?.name ?? 'Round finished')}</p><button class="btn" data-action="spectate">Next player →</button></div>`}</div>`;
    if (s.phase === 'countdown') html += `<div class="center-message"><div class="eyebrow" style="justify-content:center">One life. Make it count.</div><div class="count">${Math.ceil(s.countdown)}</div></div>`;
    if (s.phase === 'active' && p?.alive && !locked() && !modal && !disconnected) html += '<div class="center-message interactive"><button class="btn gold" data-action="play">Click to enter the arena</button><p>WASD to move · Mouse to aim</p></div>';
    if (s.phase === 'results') html += `<div class="overlay interactive"><div class="panel results"><div class="eyebrow">${s.winner ? 'Last player standing' : 'No survivors'}</div><h2>${escape(s.result)}</h2><p>One life. Every decision mattered.</p>${scores()}${s.host === room.sessionId ? '<button class="btn gold wide" data-action="lobby">Back to lobby · Rematch</button>' : '<p class="help">Waiting for the host to return to the lobby.</p>'}<button class="text-btn" data-action="leave">Leave arena</button></div></div>`;
    if (scoreboard && s.phase !== 'results') html += `<div class="overlay"><div class="panel results"><h2>Round ${s.round}</h2>${scores()}<p class="help">Survival decides the winner. Release Tab to return.</p></div></div>`;
  }
  if (notice) html += `<div class="notice" role="status">${escape(notice)}</div>`;
  if (modal) {
    html += `<div class="overlay interactive"><div class="panel"><div class="eyebrow">Stone Arena</div><h2>${modal === 'settings' ? 'Your settings' : 'Hold your ground.'}</h2>`;
    if (modal === 'settings') html += `<div class="settings-grid"><label class="setting">Mouse sensitivity<input data-setting="sensitivity" type="range" min="0.2" max="2.5" step="0.1" value="${settings.sensitivity}"></label><label class="setting">Sound volume<input data-setting="volume" type="range" min="0" max="1" step="0.05" value="${settings.volume}"></label><label class="setting">Field of view<input data-setting="fov" type="range" min="60" max="105" step="1" value="${settings.fov}"></label><label class="setting">Graphics<select data-setting="quality">${['low', 'medium', 'high'].map(q => `<option ${q === settings.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></label><label class="setting">Reduced camera motion<input type="checkbox" data-setting="reduced" ${settings.reduced ? 'checked' : ''}></label></div><p class="help">The round continues while the menu is open.</p>`;
    else html += '<p>Up to five players. One life each. The final survivor wins. After elimination, watch your friends finish the round.</p><div class="controls"><span><kbd>W A S D</kbd> Move</span><span><kbd>MOUSE</kbd> Aim</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>SHIFT</kbd> Sprint</span><span><kbd>LMB</kbd> Attack / draw</span><span><kbd>RMB</kbd> Shield</span><span><kbd>1 – 4</kbd> Change weapon</span><span><kbd>TAB</kbd> Scoreboard</span></div><p class="help">The axe breaks shield guards briefly. Bows charge while held. Crossbows take one click to load and another to fire. No healing, no respawns, no time limit.</p>';
    html += `<button class="btn gold wide" data-action="close">${snapshot?.phase === 'active' && me()?.alive ? 'Resume game' : 'Got it'}</button>${room ? `<div class="row">${snapshot?.practice ? '<button class="text-btn" data-action="lobby">Return to lobby</button>' : ''}<button class="text-btn" data-action="leave">Leave room</button></div>` : ''}</div></div>`;
  }
  // Preserve focused inputs and slider drags; HUD remains independently render-driven.
  if (html !== lastHTML && !(document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range')) { app.innerHTML = html; lastHTML = html; }
}
app.addEventListener('input', e => { const t = e.target as HTMLInputElement; if (t.id === 'nickname') nickname = t.value; });
app.addEventListener('change', e => {
  const t = e.target as HTMLInputElement; const k = t.dataset.setting;
  if (!k) return;
  if (k === 'quality') settings.quality = t.value; else if (k === 'reduced') settings.reduced = t.checked; else if (k === 'fov' || k === 'volume' || k === 'sensitivity') settings[k] = Number(t.value);
  scene.settings(settings.quality, settings.fov, settings.reduced); try { localStorage.setItem('stone-settings', JSON.stringify(settings)); } catch { /* optional */ }
});
app.addEventListener('click', async e => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action; if (!action) return;
  if (action === 'create' || action === 'join') { const code = document.querySelector<HTMLInputElement>('#code')?.value ?? ''; void connect(action, code); }
  if (action === 'ready') room?.send('ready');
  if (action === 'start') { room?.send('start', { practice: snapshot?.players.length === 1 }); void lockPointer(); }
  if (action === 'lobby') room?.send('lobby');
  if (action === 'play') void lockPointer();
  if (action === 'leave') { releasePointer(); modal = ''; await room?.leave(); }
  if (action === 'settings' || action === 'controls') { releasePointer(); modal = action; renderUI(); }
  if (action === 'close') { modal = ''; if (snapshot?.phase === 'active' && me()?.alive) void lockPointer(); else renderUI(); }
  if (action === 'spectate') { scene.spectator++; renderUI(); }
  if (action === 'invite') { try { await navigator.clipboard.writeText(location.href); notice = 'Invite copied. Send it to your friend.'; } catch { notice = `Share room code ${room?.roomId}`; } renderUI(); setTimeout(() => { notice = ''; renderUI(); }, 3500); }
});
document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Tab') scoreboard = true;
  if (e.code === 'Escape' && room && !locked()) { modal = modal ? '' : 'settings'; renderUI(); }
  if (locked()) { keys.add(e.code); const n = Number(e.key); if (n >= 1 && n <= 4) weapon = WEAPONS[n - 1]; }
  renderUI();
});
document.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab') { scoreboard = false; renderUI(); } });
document.addEventListener('mousemove', e => { if (locked() && me()?.alive) { yaw -= e.movementX * .002 * settings.sensitivity; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * .002 * settings.sensitivity)); } });
document.addEventListener('mousedown', e => { if (locked()) { if (e.button === 0) mouseAttack = true; if (e.button === 2) mouseBlock = true; } });
document.addEventListener('mouseup', e => { if (e.button === 0) mouseAttack = false; if (e.button === 2) mouseBlock = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => { if (locked()) weapon = WEAPONS[(WEAPONS.indexOf(weapon) + (e.deltaY > 0 ? 1 : 3)) % 4]; }, { passive: true });
document.addEventListener('pointerlockchange', () => { if (!locked()) { resetControls(); if (!expectedUnlock && snapshot?.phase === 'active' && me()?.alive) modal = 'settings'; } expectedUnlock = false; renderUI(); });
window.addEventListener('blur', resetControls); document.addEventListener('visibilitychange', () => { if (document.hidden) resetControls(); });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); resetControls(); notice = 'Graphics interrupted. Reload to reconnect to your arena.'; renderUI(); });
setInterval(() => room?.send('ping', performance.now()), 2000);
let previous = performance.now();
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000, .1); previous = now; accumulator = Math.min(.1, accumulator + dt);
  const p = me();
  while (accumulator >= DT) {
    accumulator -= DT;
    if (room && snapshot?.phase === 'active' && p?.alive && !disconnected && local) {
      const i: Input = { ...idleInput(), seq: ++seq, x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), z: Number(keys.has('KeyW')) - Number(keys.has('KeyS')), yaw, pitch, jump: keys.has('Space'), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), attack: mouseAttack, block: mouseBlock, weapon };
      move(local, i, DT, (p.charge ?? 0) > 0); pending.push(i); if (pending.length > 120) pending.shift(); room.send('input', i);
    }
  }
  scene.render(dt, snapshot, p, local, yaw, pitch, locked(), keys.size > 0);
  requestAnimationFrame(frame);
}
renderUI(); requestAnimationFrame(frame);
try { const stored = JSON.parse(sessionStorage.getItem('stone-session') ?? 'null'); if (stored?.token && (!new URLSearchParams(location.search).get('room') || new URLSearchParams(location.search).get('room') === stored.code)) void connect('reconnect', stored.token); } catch { /* optional */ }
