import { ArenaScene } from '../client/scene.js';
import { Simulation } from '../server/simulation.js';
import { terrainHeight } from '../shared/world.js';
import { move, idleInput, DT } from '../shared/game.js';
const scene = new ArenaScene(document.querySelector<HTMLCanvasElement>('#world')!), sim = new Simulation(7919), p = sim.add('preview', 'Explorer');
sim.phase = 'active'; sim.practice = true; sim.world.doorOpen = true;
Object.assign(p, { realm: 'wilds', x: 22, z: -32, y: terrainHeight(22, -32, sim.world.seed), yaw: -.9, pitch: -.12 });
let quality = 'medium', walking = false, previous = performance.now(), acc = 0, region = 0;
const frames: number[] = [];
scene.settings(quality, 100, false);
document.querySelector('#quality')!.addEventListener('change', e => { quality = (e.target as HTMLSelectElement).value; scene.settings(quality, 100, false); });
document.querySelector('#walk')!.addEventListener('click', () => { walking = !walking; document.querySelector('#walk')!.textContent = walking ? 'Stop walking' : 'Walk the hills'; });
document.querySelector('#teleport')!.addEventListener('click', () => { region++; p.realm = 'wilds'; p.x = 22 + region * 120; p.z = -32 - region * 60; p.y = terrainHeight(p.x, p.z, sim.world.seed); });
document.querySelector('#door')!.addEventListener('click', () => { walking = false; Object.assign(p, { realm: 'arena', x: -26, z: -43, y: 0, yaw: 0, pitch: -.08 }); sim.world.doorOpen = !sim.world.doorOpen; });
document.querySelector('#return')!.addEventListener('click', () => { p.realm = 'wilds'; p.x = 0; p.z = -4; p.y = 0; p.yaw = Math.PI; });
function frame(now: number) {
  const elapsed = now - previous; previous = now; frames.push(elapsed); if (frames.length > 240) frames.shift();
  const dt = Math.min(.1, elapsed / 1000); acc = Math.min(.1, acc + dt);
  while (acc >= DT) { acc -= DT; if (walking) move(p, { ...idleInput(), yaw: p.yaw, z: 1, sprint: true }, DT, false, sim.world); }
  scene.render(dt, sim.snapshot(), p, p, p.yaw, p.pitch, true, walking);
  const sorted = [...frames].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * .95)] ?? 0;
  document.querySelector('#stats')!.textContent = `${scene.fps} FPS · p95 frame ${p95.toFixed(1)} ms\n${scene.terrain.chunks.size} resident chunks · ${scene.terrain.queue.length} queued\n${scene.renderer.info.render.calls} draw calls · ${scene.renderer.info.render.triangles} triangles\n${scene.renderer.info.memory.geometries} geometries · ${scene.renderer.info.memory.textures} textures\n${Math.round(p.x)}, ${Math.round(p.z)} · height ${p.y.toFixed(2)}\nWorker: ${scene.terrain.worker ? 'running' : 'fallback'} · ${scene.terrain.busy ? 'one request' : 'idle'}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
