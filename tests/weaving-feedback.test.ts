import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaAudio } from '../client/audio.js';
import { weavingFeedback } from '../client/weaving-feedback.js';
import { Simulation } from '../server/simulation.js';
import { BUILD, RUNE_KINDS } from '../shared/construction.js';
import { weaveTarget } from '../shared/weaving.js';
import { EYE, VERSION, type GameEvent } from '../shared/game.js';
import { HEARTHSTONE } from '../shared/sailing.js';
import { terrainHeight, worldBoxes } from '../shared/world.js';

function setup(kind: number) {
  const sim = new Simulation(7919), p = sim.add('builder', 'Builder');
  sim.phase = 'active'; sim.mode = 'creative'; sim.world.upgrades = HEARTHSTONE;
  for (let x = 30; x < 50; x++) for (let z = -50; z < -24; z++) {
    const y = terrainHeight(x + .5, z + .5, sim.world.seed), pz = z + 4.5, py = terrainHeight(x + .5, pz, sim.world.seed);
    Object.assign(p, { realm: 'wilds', x: x + .5, z: pz, y: py, yaw: 0, pitch: Math.atan2(y - py - EYE, 4), weaving: true, weaveKind: kind });
    if (worldBoxes(p.x, p.z, p.x, p.z, 'wilds', sim.world).some(b => Math.abs(p.x-b.x) < b.w/2+.4 && Math.abs(p.z-b.z) < b.d/2+.4 && py < (b.y ?? 0)+b.h)) continue;
    const target = weaveTarget(p, sim.world, false, [p]); if (target?.valid) return { sim, p, target };
  }
  throw Error('Fixture needs an open build site');
}
class TraceAudio extends ArenaAudio {
  calls: { name: string; args: unknown[] }[] = [];
  constructor() { super(); this.context = {} as AudioContext; }
  override tone(...args: Parameters<ArenaAudio['tone']>) { this.calls.push({ name: 'tone', args }); }
  override noise(...args: Parameters<ArenaAudio['noise']>) { this.calls.push({ name: 'noise', args }); }
}
const weave = (weaveKind?: number): GameEvent => ({ id: 1, type: 'weave', weaveKind });

test('all seven successful weave events retain the placed kind after selection changes and serialization', () => {
  assert.equal(VERSION, 17);
  for (let kind = 0; kind < RUNE_KINDS.length; kind++) {
    const { sim, p, target } = setup(kind);
    p.hurtTime = .1; assert(!sim.weave(p, false)); assert.equal(sim.events.length, 0); p.hurtTime = 0;
    assert(sim.weave(p, false)); const placed = sim.world.construction!.get(target.x, target.y, target.z)!;
    p.weaveKind = (kind + 1) % RUNE_KINDS.length;
    const e = JSON.parse(JSON.stringify(sim.snapshot())).events.at(-1) as GameEvent;
    assert.equal(e.type, 'weave'); assert.equal(e.weaveKind, placed.kind); assert.equal(e.weaveKind, kind);
    assert.equal(e.actor, p.id); assert.equal(e.realm, undefined); // Preserve the earlier optional realm contract.
    assert.deepEqual(e.position, { x: placed.x+.5, y: placed.y+.5, z: placed.z+.5 });
    assert(!sim.weave(p, false)); assert.equal(sim.events.length, 1);
  }
});

test('erase retains its original cue and does not masquerade as a newly placed rune', () => {
  const { sim, p, target } = setup(4); assert(sim.weave(p, false)); sim.tick += BUILD.cooldown;
  const dx = target.x+.5-p.x, dz = target.z+.5-p.z;
  p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(target.y+.8-p.y-EYE, Math.hypot(dx, dz));
  assert(sim.weave(p, true)); assert.equal(sim.world.construction!.size, 0);
  const e = JSON.parse(JSON.stringify(sim.snapshot())).events.at(-1) as GameEvent;
  assert.equal(e.type, 'erase'); assert(!('weaveKind' in e));
  const a = new TraceAudio(); a.event(e, true);
  assert.deepEqual(a.calls, [{ name: 'tone', args: [660,.15,.035,0,'sine',220] }, { name: 'noise', args: [.13,1500,.035] }]);
});

test('original rune cues have seven distinct bounded three-voice signatures and preserve remote gain', () => {
  const signatures = new Set<string>();
  for (let kind = 0; kind < RUNE_KINDS.length; kind++) {
    const a = new TraceAudio(); a.event(weave(kind), true);
    assert.deepEqual(a.calls.map(c => c.name), ['tone', 'tone', 'noise']);
    assert.equal(weavingFeedback(kind).color, RUNE_KINDS[kind].color);
    signatures.add(JSON.stringify(a.calls));
    const remote = new TraceAudio(); remote.event(weave(kind), false, .5);
    for (let n = 0; n < 3; n++) {
      assert.equal(remote.calls[n].args[2], (a.calls[n].args[2] as number) * .5 * .35);
      assert((a.calls[n].args[1] as number) <= .2 || n === 2);
    }
  }
  assert.equal(signatures.size, 7);
  const disabled = new TraceAudio(); disabled.context = undefined; disabled.event(weave(4), true); assert.equal(disabled.calls.length, 0);
});

test('older and malformed weaving metadata preserves the earlier sound and green sparks', () => {
  const a = new TraceAudio(); a.event(weave(), true);
  assert.deepEqual(a.calls, [{ name: 'tone', args: [330,.17,.045,0,'triangle',660] }, { name: 'tone', args: [990,.2,.018,.04] }, { name: 'noise', args: [.06,2000,.035] }]);
  for (const kind of [undefined, -1, 7, .5, NaN, Infinity, '4', '__proto__', null, {}]) {
    const b = new TraceAudio(); b.event({ ...weave(), weaveKind: kind as number, text: 'Glow rune' }, true);
    assert.deepEqual(b.calls, a.calls); assert.equal(weavingFeedback(kind).color, '#9affde');
  }
});
