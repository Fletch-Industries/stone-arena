import test from 'node:test';
import assert from 'node:assert/strict';
import { exitPointerLock } from '../client/pointer.js';
import { SeatRegistry } from '../server/seats.js';

test('room transitions tolerate unavailable and denied Pointer Lock', () => {
  assert.doesNotThrow(() => exitPointerLock({}));
  assert.doesNotThrow(() => exitPointerLock({ exitPointerLock() { throw Error('unavailable'); } }));
  let released = false; exitPointerLock({ exitPointerLock() { released = true; } }); assert.equal(released, true);
});
test('one tab cannot acquire duplicate seats or clear another connection lease', () => {
  const seats = new SeatRegistry();
  assert.equal(seats.claim('tab-a', 'room-a', 'player-a'), true);
  assert.equal(seats.claim('tab-a', 'room-a', 'duplicate'), false);
  assert.equal(seats.claim('tab-a', 'room-b', 'duplicate'), false);
  seats.releasePlayer('room-b', 'duplicate');
  assert.equal(seats.claim('tab-a', 'room-b', 'duplicate'), false);
  assert.equal(seats.claim('tab-b', 'room-a', 'friend'), true);
  seats.releasePlayer('room-a', 'player-a');
  assert.equal(seats.claim('tab-a', 'room-b', 'player-new'), true);
  seats.releaseRoom('room-a');
  assert.equal(seats.claim('tab-b', 'room-c', 'friend-new'), true);
  assert.equal(seats.claim('tab-a', 'room-c', 'duplicate'), false);
});

test('returning to lobby preserves reserved players but removes confirmed departures', async () => {
  const { Simulation } = await import('../server/simulation.js');
  const sim = new Simulation(); sim.add('host', 'Host'); sim.add('reserved', 'Reserved'); sim.add('gone', 'Gone');
  sim.phase = 'results'; sim.tick = 200; sim.resultTime = 0;
  sim.disconnect('reserved'); sim.leave('gone'); sim.lobby('host');
  assert.equal(sim.players.has('reserved'), true);
  assert.equal(sim.players.get('reserved')!.connected, false);
  assert.equal(sim.players.has('gone'), false);
  sim.leave('reserved'); assert.equal(sim.players.size, 1);
  sim.players.get('host')!.ready = true;
  assert.equal(sim.start('host', true), true);
});
