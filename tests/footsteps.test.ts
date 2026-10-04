import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaAudio } from '../client/audio.js';
import { footstepSurface } from '../client/footsteps.js';
import { terrainHeight, type WorldState } from '../shared/world.js';
import type { Body, Player } from '../shared/game.js';

// Exercise movement-driven scheduling without a hardware AudioContext.
class TraceAudio extends ArenaAudio {
  calls: { name: string; args: unknown[] }[] = [];
  steps = 0;
  constructor() {
    super(); this.context = { currentTime: 0 } as AudioContext;
    const param = { setTargetAtTime() {} };
    this.master = this.ambient = { gain: param } as unknown as GainNode;
    this.windFilter = { frequency: param } as unknown as BiquadFilterNode;
  }
  override noise(...args: Parameters<ArenaAudio['noise']>) { this.calls.push({ name: 'noise', args }); }
  override tone(...args: Parameters<ArenaAudio['tone']>) { this.calls.push({ name: 'tone', args }); }
  override footstep(...args: Parameters<ArenaAudio['footstep']>) { this.steps++; super.footstep(...args); }
}
const seed = 7919;
const body = (): Body => ({ x: 4, y: 0, z: 0, vy: 0, grounded: true, realm: 'wilds' });
const doc = { hidden: false };
Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
function update(a: TraceAudio, b: Body, volume = 1, active = true, dt = 1 / 60, sprinting = false, world?: WorldState) {
  a.update(dt, { realm: b.realm, charge: 0, sprinting } as Player, b, active, volume, false, seed, [], world);
}

test('footstep material follows actual seeded grass, cliff, shore, caves and raised stone surfaces', () => {
  const b = body(); assert.equal(footstepSurface(b, seed, false), 'grass');
  Object.assign(b, { x: 240, z: 240, y: terrainHeight(240, 240, seed) });
  assert.equal(footstepSurface(b, seed, false), 'stone');
  let shore: Body | undefined;
  for (let x = -240; x < 240 && !shore; x += 4) for (let z = -240; z < 240; z += 4) {
    const y = terrainHeight(x, z, seed);
    if (Math.hypot(x, z) > 60 && y < .5) { shore = { ...b, x, y, z }; break; }
  }
  assert(shore); assert.equal(footstepSurface(shore, seed, false), 'shore');
  assert.equal(footstepSurface(b, seed, true), 'cave');
  Object.assign(b, { x: 4, z: 0, y: 2 }); assert.equal(footstepSurface(b, seed, false), 'stone');
  b.realm = 'arena'; assert.equal(footstepSurface(b, seed, true), 'citadel');
});

test('grounded gait retains distance at different frame rates and tolerates slow sprint frames without bursts', () => {
  for (const hz of [8, 30, 60, 120]) {
    const a = new TraceAudio(), b = body(); update(a, b);
    for (let n = 0; n < hz * 2; n++) { b.x += 5 / hz; update(a, b, 1, true, 1 / hz); }
    assert.equal(a.steps, 5); assert(Math.abs(a.stepDistance - .5) < 1e-10);
  }
  const a = new TraceAudio(), b = body(); update(a, b);
  for (let n = 0; n < 8; n++) { b.x += 2.5; update(a, b, 1, true, .125, true); }
  assert.equal(a.steps, 8); assert(a.stepDistance >= 0 && a.stepDistance < 1.9);
});

test('air travel and grounded Creative flight cannot queue walking cues, while real landing still sounds', () => {
  const a = new TraceAudio(), b = body(); update(a, b);
  for (let n = 0; n < 8; n++) { b.x += .5; b.y = 10; b.grounded = false; update(a, b); }
  b.y = 0; b.grounded = true; update(a, b);
  assert.equal(a.steps, 0); assert.equal(a.calls.length, 2); assert.equal(a.stepDistance, 0);
  a.calls = []; b.flying = true;
  for (let n = 0; n < 8; n++) { b.x += .5; update(a, b); }
  b.flying = false; update(a, b); assert.equal(a.steps, 0); assert.equal(a.calls.length, 0);
  for (let n = 0; n < 20; n++) { b.x += .1; update(a, b); }
  assert.equal(a.steps, 1);
});

test('teleport, realm change, inactive, muted and hidden interruptions clear unfinished footsteps', () => {
  for (const kind of ['teleport', 'realm', 'inactive', 'mute', 'hidden']) {
    const a = new TraceAudio(), b = body(); update(a, b); a.stepDistance = 1.8;
    try {
      if (kind === 'teleport') { b.x += 50; update(a, b); }
      if (kind === 'realm') { b.realm = 'arena'; update(a, b); }
      if (kind === 'inactive') update(a, b, 1, false);
      if (kind === 'mute') update(a, b, 0);
      if (kind === 'hidden') { doc.hidden = true; update(a, b); doc.hidden = false; }
      b.x += .3; update(a, b); assert.equal(a.steps, 0, kind); assert.equal(a.calls.length, 0, kind);
    } finally { doc.hidden = false; }
  }
});

test('standing and vertical movement do not sample a footstep, while diagonal ground travel does', () => {
  const a = new TraceAudio(), b = body(); update(a, b);
  for (let n = 0; n < 100; n++) { b.y += .1; update(a, b); }
  assert.equal(a.steps, 0); assert.equal(a.calls.length, 0);
  for (let n = 0; n < 10; n++) { b.x += .15; b.z += .15; update(a, b); }
  assert.equal(a.steps, 1); assert.equal(a.calls.length, 2);
});

test('legacy low-grass, cave and Citadel timbres and sprint gain remain intact in actual scheduling', () => {
  for (const [realm, cave, cutoff, hz] of [['wilds', false, 1400, 80], ['wilds', true, 650, 80], ['arena', false, 750, 115]] as const) {
    const a = new TraceAudio(), b = body(); b.realm = realm;
    const world = cave ? { seed, doorOpen: true } : undefined;
    if (cave) Object.assign(b, { x: 240, z: 240, y: terrainHeight(240, 240, seed) - 6 });
    update(a, b, 1, true, 1 / 60, true, world); a.stepDistance = 1.4; b.x += .6;
    update(a, b, 1, true, 1 / 60, true, world);
    assert.deepEqual(a.calls, [{ name: 'noise', args: [.09, cutoff, .065] }, { name: 'tone', args: [hz, .08, .025, 0, 'triangle', 50] }]);
  }
});
