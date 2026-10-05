import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { DT, HEIGHT, RADIUS, idleInput, move } from '../shared/game.js';
import { terrainHeight, worldBoxes } from '../shared/world.js';
import { nativeBox, rectangleHeight } from '../shared/terrain-collision.js';
import { placeOf, type PlayerPlace } from '../shared/player-place.js';

const place = (x: number, y: number, z: number): PlayerPlace => ({ realm: 'wilds', x, y, z, yaw: .7, pitch: -.3, flying: false });
function setup(seed = 7919) { const sim = new Simulation(seed); sim.mode = 'creative'; sim.phase = 'active'; return { sim, p: sim.add('host', 'Host') }; }

test('normally settled hill places resume exactly in Creative and expedition without changing movement', () => {
  for (const mode of ['creative', 'expedition'] as const) {
    const { sim, p } = setup(); sim.mode = mode;
    const spot = place(30.5, 5.897177779659033, -47); assert(sim.resumePlace(p, spot));
    for (let n = 0; n < 30; n++) move(p, { ...idleInput(), yaw: spot.yaw, pitch: spot.pitch }, DT, false, sim.world, mode === 'creative');
    const settled = placeOf(p); assert.equal(settled.y, terrainHeight(p.x, p.z, 7919));
    assert(nativeBox(p.x-RADIUS, p.y+.001, p.z-RADIUS, p.x+RADIUS, p.y+HEIGHT-.001, p.z+RADIUS, sim.world));
    assert(sim.resumePlace(p, settled)); assert.deepEqual(placeOf(p), settled); assert.equal(p.vx, 0); assert.equal(p.vy, 0);
  }
});

test('ordinary unedited contact across seeded hills and valleys is accepted, while below-ground places are refused', () => {
  let tested = 0, sloping = 0;
  for (const seed of [7919, 391399180, 2874504513, 3576917457]) {
    const { sim, p } = setup(seed);
    for (const x of [-170.5, -60.5, 30.5, 99.5, 180.5]) for (const z of [-140.5, -47, 65.5, 120.5]) {
      const y = terrainHeight(x, z, seed);
      if (worldBoxes(x-RADIUS, z-RADIUS, x+RADIUS, z+RADIUS, 'wilds', sim.world).some(b => Math.abs(x-b.x)<b.w/2+RADIUS && Math.abs(z-b.z)<b.d/2+RADIUS && y+HEIGHT>(b.y??0)+.001 && y<(b.y??0)+b.h-.001)) continue;
      const spot = place(x, y, z); assert(sim.resumePlace(p, spot)); assert.deepEqual(placeOf(p), spot);
      assert(!sim.resumePlace(p, { ...spot, y: y-.05 })); assert(!sim.resumePlace(p, { ...spot, y: y-2, flying: true }));
      if (rectangleHeight(x-RADIUS,z-RADIUS,x+RADIUS,z+RADIUS,seed)>y+.001) sloping++;
      tested++;
    }
  }
  assert(tested >= 60); assert(sloping >= 20);
});

test('excavated caves retain full-body floor, wall and roof safety', () => {
  const { sim, p } = setup(), spot = place(80.5, -2, 80.5);
  for (let x = 79; x <= 81; x++) for (let z = 79; z <= 81; z++) for (let y = -2; y <= 0; y++) assert(sim.world.excavation!.dig({ x, y, z, owner: 'host' }));
  assert(sim.resumePlace(p, spot)); assert.deepEqual(placeOf(p), spot);
  assert(!sim.resumePlace(p, { ...spot, y: -2.05 }));
  assert(sim.world.excavation!.mend(80, -1, 80)); assert(!sim.resumePlace(p, spot));
  assert(sim.world.excavation!.dig({ x: 80, y: -1, z: 80, owner: 'host' }));
  assert(sim.world.excavation!.mend(81, -1, 80)); assert(!sim.resumePlace(p, { ...spot, x: 80.85 }));
  assert(sim.world.excavation!.dig({ x: 81, y: -1, z: 80, owner: 'host' }));
  assert(!sim.resumePlace(p, { ...spot, y: .3 }));
});

test('rune platforms resume at their top while walls and roofs still reject overlap', () => {
  const { sim, p } = setup(), spot = place(200.5, 31, 200.5);
  assert(sim.world.construction!.place({ x: 200, y: 30, z: 200, kind: 0, owner: 'host' }));
  assert(sim.resumePlace(p, spot)); assert.deepEqual(placeOf(p), spot);
  assert(!sim.resumePlace(p, { ...spot, y: 30.5 }));
  assert(sim.world.construction!.place({ x: 200, y: 32, z: 200, kind: 0, owner: 'host' }));
  assert(!sim.resumePlace(p, spot));
});

test('flight resumes above hills, closed Citadel passages and competitive modes retain existing restrictions', () => {
  const { sim, p } = setup(), spot = { ...place(30.5, 70, -47), flying: true };
  assert(sim.resumePlace(p, spot)); assert.deepEqual(placeOf(p), spot);
  assert(!sim.resumePlace(p, { ...spot, y: NaN }));
  assert(!sim.resumePlace(p, { ...spot, realm: 'arena', x: 0, y: 1, z: -60 }));
  sim.mode = 'ffa'; assert(!sim.resumePlace(p, spot));
});
