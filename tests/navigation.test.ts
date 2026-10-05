import test from 'node:test';
import assert from 'node:assert/strict';
import { Construction } from '../shared/construction.js';
import { move, idleInput, DT, EYE, RADIUS, type Body } from '../shared/game.js';
import { weaveTarget } from '../shared/weaving.js';
import { rectangleHeight } from '../shared/terrain-collision.js';
import { Simulation } from '../server/simulation.js';
import { routeFollower, wildRoute } from './navigation.js';

test('a test explorer visits the last detour around newly woven runes before approaching a friend', () => {
  const world = { seed: 391399180, doorOpen: true, construction: new Construction() };
  const host = { realm: 'wilds' as const, x: .000005413899324953755, z: -37.82483678383115, y: 9.664332188109197, yaw: -Math.PI, pitch: -.7 };
  // A valid two-block weave from the failed traversal's approach, not a teleport
  // or relaxed collider. Skipping the last grid point steers into this stack.
  const first = weaveTarget(host, world, false, [host]); assert(first?.valid);
  world.construction.place({ x: first.x, y: first.y, z: first.z, kind: 0, owner: 'host' });
  const dx = first.x + .5 - host.x, dz = first.z + .5 - host.z;
  const second = weaveTarget({ ...host, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(first.y + .8 - host.y - EYE, Math.hypot(dx, dz)) }, world, false, [host]); assert(second?.valid);
  world.construction.place({ x: second.x, y: second.y, z: second.z, kind: 5, owner: 'host' });
  const explorer: Body = { realm: 'wilds', x: 0, z: -5, y: 0, vy: 0, grounded: true };
  const follow = routeFollower(wildRoute(explorer, host, world.seed, world.construction), host);
  for (let tick = 0; tick < 1800 && Math.hypot(explorer.x - host.x, explorer.z - host.z) >= 1; tick++) {
    const point = follow(explorer);
    move(explorer, { ...idleInput(), yaw: Math.atan2(explorer.x - point[0], explorer.z - point[1]), z: 1, sprint: true }, DT, false, world);
  }
  assert(Math.hypot(explorer.x - host.x, explorer.z - host.z) < 1, 'Reach the friend through ordinary collision-respecting movement');
  assert.equal(world.construction.size, 2);
});

test('a test explorer crosses a clear natural lane missed by the coarse navigation grid', () => {
  const seed = 3576917457, from = { x: 29.53905772335729, z: 25.18119316862725 };
  const target = { x: 52.39703201139277, z: -84.19806490400761 };
  const sim = new Simulation(seed); sim.mode = 'expedition'; sim.world.doorOpen = true;
  const p = sim.add('explorer', 'Lane explorer');
  const y = rectangleHeight(from.x - RADIUS, from.z - RADIUS, from.x + RADIUS, from.z + RADIUS, seed) + .002;
  assert(sim.resumePlace(p, { ...from, y, realm: 'wilds', yaw: 0, pitch: 0, flying: false }), 'Start at a valid ordinary player location');
  const route = wildRoute(p, target, seed), follow = routeFollower(route, target);
  assert(route.some(point => point.some(v => v % 2 !== 0)), 'Use the finer fallback for this lane');
  for (let tick = 0; tick < 2400 && Math.hypot(p.x - target.x, p.z - target.z) >= 1; tick++) {
    const point = follow(p);
    move(p, { ...idleInput(), yaw: Math.atan2(p.x - point[0], p.z - point[1]), z: 1, sprint: true }, DT, false, sim.world);
  }
  assert(Math.hypot(p.x - target.x, p.z - target.z) < 1, 'Reach the supply patch through unchanged gameplay collision');
});
