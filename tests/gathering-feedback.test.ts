import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaAudio } from '../client/audio.js';
import { gatheringFeedback } from '../client/gathering.js';
import { Simulation } from '../server/simulation.js';
import { SUPPLIES, gatherTarget, suppliesNear } from '../shared/forage.js';
import { EYE, VERSION, type GameEvent } from '../shared/game.js';
import { terrainHeight, worldBoxes } from '../shared/world.js';

class TraceAudio extends ArenaAudio {
  calls: { name: string; args: unknown[] }[] = [];
  constructor() { super(); this.context = {} as AudioContext; }
  override tone(...args: Parameters<ArenaAudio['tone']>) { this.calls.push({ name: 'tone', args }); }
  override noise(...args: Parameters<ArenaAudio['noise']>) { this.calls.push({ name: 'noise', args }); }
}
const gather = (supplyKind?: number): GameEvent => ({ id: 1, type: 'gather', supplyKind });

test('all three pickup kinds come from the authoritative target and survive snapshot serialization', () => {
  assert.equal(VERSION, 17);
  for (let kind = 0; kind < 3; kind++) {
    const sim = new Simulation(7919), p = sim.add('explorer', 'Explorer'); sim.phase = 'active'; sim.mode = 'creative';
    let found = false;
    outer: for (const node of suppliesNear(0, 0, 7919, 192).filter(n => n.kind === kind)) for (let a = 0; a < 8; a++) {
      const x = node.x + Math.sin(a * Math.PI / 4) * 2.5, z = node.z + Math.cos(a * Math.PI / 4) * 2.5, y = terrainHeight(x, z, 7919);
      if (worldBoxes(x, z, x, z, 'wilds', sim.world).some(b => Math.abs(x-b.x) < b.w/2+.4 && Math.abs(z-b.z) < b.d/2+.4)) continue;
      Object.assign(p, { realm: 'wilds', x, y, z, yaw: Math.atan2(x-node.x, z-node.z), pitch: Math.atan2(node.y+.9-y-EYE, 2.5) });
      if (gatherTarget(p, sim.world, sim.tick) !== node) continue;
      const yaw = p.yaw; p.yaw += Math.PI; assert(!sim.gather(p.id)); assert.equal(sim.events.length, 0); p.yaw = yaw;
      assert(sim.gather(p.id)); const e = JSON.parse(JSON.stringify(sim.snapshot())).events.at(-1) as GameEvent;
      assert.equal(e.supplyKind, kind); assert.equal(e.actor, p.id);
      assert.deepEqual(e.position, { x: node.x, y: node.y+.9, z: node.z }); assert.equal(sim.world.supplies![kind], 4);
      assert(!sim.gather(p.id)); assert.equal(sim.events.length, 1); found = true; break outer;
    }
    assert(found, 'A clear supply patch must be reachable for each kind');
  }
});

test('gather cues distinguish kinds with three bounded voices and retain local/distance gain scaling', () => {
  const signatures = new Set<string>();
  for (let kind = 0; kind < 3; kind++) {
    const a = new TraceAudio(); a.event(gather(kind), true);
    assert.equal(a.calls.length, 3); assert.deepEqual(a.calls.map(c => c.name), ['tone', 'tone', 'noise']);
    assert.equal(gatheringFeedback(kind).color, SUPPLIES[kind].color);
    signatures.add(JSON.stringify(a.calls));
    const remote = new TraceAudio(); remote.event(gather(kind), false, .5);
    for (let n = 0; n < 3; n++) {
      assert.equal(remote.calls[n].args[2], (a.calls[n].args[2] as number) * .5 * .35);
      assert((a.calls[n].args[1] as number) <= .35 || n === 2);
    }
  }
  assert.equal(signatures.size, 3);
  const disabled = new TraceAudio(); disabled.context = undefined; disabled.event(gather(1), true); assert.equal(disabled.calls.length, 0);
});

test('older or invalid pickup metadata uses the earlier cue without parsing display text', () => {
  const legacy = new TraceAudio(); legacy.event(gather(), true);
  assert.deepEqual(legacy.calls, [{ name: 'tone', args: [440,.2,.04,0,'triangle',880] }, { name: 'tone', args: [1174,.35,.03,.08,'sine',1174] }, { name: 'noise', args: [.08,2600,.025] }]);
  for (const kind of [undefined, -1, 3, .5, NaN, Infinity, '1', '__proto__', null, {}]) {
    const a = new TraceAudio(); a.event({ ...gather(), supplyKind: kind as number, text: 'Gleamstone' }, true);
    assert.deepEqual(a.calls, legacy.calls); assert.equal(gatheringFeedback(kind).color, '#9affde');
  }
});
