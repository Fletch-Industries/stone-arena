import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPulse } from '../client/control-pulse.js';
import { Simulation } from '../server/simulation.js';
import { idleInput } from '../shared/game.js';

function explorer() {
  const simulation = new Simulation(7919), player = simulation.add('host', 'Explorer');
  assert(simulation.selectMode(player.id, 'creative')); assert(simulation.start(player.id));
  Object.assign(player, { x: 100, z: 100, y: 60, flying: false, grounded: false, vy: 0 });
  return { simulation, player };
}

test('a short flight press survives a catch-up batch and toggles only once before acknowledgment', () => {
  const { simulation: s, player: p } = explorer(), pulse = new ControlPulse(); pulse.press();
  for (let seq = 1; seq <= 6; seq++) s.input(p.id, { ...idleInput(), seq, glide: pulse.value(seq) });
  s.step(); assert(p.flying); assert.equal(p.ack, 6);
  for (let seq = 7; seq <= 12; seq++) s.input(p.id, { ...idleInput(), seq, glide: pulse.value(seq) });
  s.step(); assert(p.flying, 'A delayed snapshot must not toggle flight again');
  pulse.acknowledge(p.ack);
  s.input(p.id, { ...idleInput(), seq: 13, glide: pulse.value(13) }); s.step(); assert(p.flying);
  pulse.press(); s.input(p.id, { ...idleInput(), seq: 14, glide: pulse.value(14) }); s.step(); assert(!p.flying);
});

test('an older acknowledgment cannot erase a queued or in-flight press', () => {
  const pulse = new ControlPulse(); pulse.press(); pulse.acknowledge(200);
  assert(pulse.value(201)); pulse.acknowledge(200); assert(pulse.value(202));
  pulse.acknowledge(202); assert(!pulse.value(203));
});

test('a transport pause cannot turn an unacknowledged press into a second flight toggle', () => {
  const { simulation: s, player: p } = explorer(), pulse = new ControlPulse(); pulse.press();
  s.input(p.id, { ...idleInput(), seq: 1, glide: pulse.value(1) }); s.step(); assert(p.flying);
  for (let tick = 0; tick < 30; tick++) s.step();
  assert(p.flying); assert(p.glideHeld);
  s.input(p.id, { ...idleInput(), seq: 2, glide: pulse.value(2) }); s.step();
  assert(p.flying, 'Retransmission after a pause is still the same physical press');
  pulse.acknowledge(p.ack);
  s.input(p.id, { ...idleInput(), seq: 3, glide: pulse.value(3) }); s.step();
  pulse.press(); s.input(p.id, { ...idleInput(), seq: 4, glide: pulse.value(4) }); s.step(); assert(!p.flying);
});

test('lost focus or a reconnect clears a press rather than replaying it in the next session', () => {
  const pulse = new ControlPulse(); pulse.press(); assert(pulse.value(20)); pulse.clear(); assert(!pulse.value(21));
  pulse.press(); assert(pulse.value(1)); pulse.acknowledge(1); assert(!pulse.value(2));
});

test('brief jump and Windstep presses survive the same batch without altering server cooldowns', () => {
  const { simulation: s, player: p } = explorer(), jump = new ControlPulse(), dash = new ControlPulse();
  s.mode = 'ffa'; s.practice = true;
  Object.assign(p, { realm: 'wilds', x: 0, z: 0, y: 0, grounded: true }); jump.press(); dash.press();
  for (let seq = 1; seq <= 6; seq++) s.input(p.id, { ...idleInput(), seq, jump: jump.value(seq), dash: dash.value(seq) });
  s.step(); assert(p.vy > 0); assert((p.dashCooldown ?? 0) > 3.9);
  jump.acknowledge(p.ack); dash.acknowledge(p.ack);
  s.input(p.id, { ...idleInput(), seq: 7, jump: jump.value(7), dash: dash.value(7) }); s.step();
  dash.press(); s.input(p.id, { ...idleInput(), seq: 8, dash: dash.value(8) }); s.step();
  assert((p.dashCooldown ?? 0) < 4 && (p.dashCooldown ?? 0) > 3.9);
});
