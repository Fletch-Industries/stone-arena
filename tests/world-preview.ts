import { ArenaAudio } from '../client/audio.js';
import { ConstellationAtlas } from '../client/atlas.js';
import '../client/style.css';
import { shardSites } from '../shared/expedition.js';
import { BIOMES, biomeAt, type Biome } from '../shared/biomes.js';
import { HOME_WAYSTONE, nearbyWaystone, waystoneSites, awakenedCount } from '../shared/waystones.js';
import { ArenaScene } from '../client/scene.js';
import { Simulation } from '../server/simulation.js';
import { terrainHeight, treeCacheSize, terrainCacheSize } from '../shared/world.js';
import { idleInput, DT } from '../shared/game.js';
const scene = new ArenaScene(document.querySelector<HTMLCanvasElement>('#world')!), sim = new Simulation(7919), p = sim.add('preview', 'Explorer');
sim.phase = 'active'; sim.practice = true; sim.world.doorOpen = true;
Object.assign(p, { realm: 'wilds', x: 22, z: -32, y: terrainHeight(22, -32, sim.world.seed), yaw: -.9, pitch: -.12 });
const mobileQuery=matchMedia('(pointer: coarse), (max-width: 900px)');
const mobileLayout=()=>document.body.classList.toggle('mobile',mobileQuery.matches);mobileLayout();mobileQuery.addEventListener('change',mobileLayout);
const audio = new ArenaAudio(), atlas = new ConstellationAtlas(), atlasPanel = document.querySelector<HTMLElement>('#preview-atlas')!;
let dash=false, seq=0, eventId=0, tracked:number|undefined, lastAtlas=0, lastAtlasHTML='';
let quality = 'medium', reduced=false, walking = false, previous = performance.now(), acc = 0, region = 0;
const frames: number[] = [];
const selectedSite = () => {const biome=(document.querySelector<HTMLSelectElement>('#habitat')!.value as Biome);return biome==='meadow'?HOME_WAYSTONE:waystoneSites(sim.world.seed).find(s=>s.biome===biome)!;};
function atlasView() {
  const html=`<div class="overlay interactive"><div class="panel"><div class="eyebrow">Stone Arena</div><h2>Constellation atlas</h2>${atlas.render(p,sim.snapshot(),tracked)}<button class="btn gold wide" data-action="close">Resume game</button></div></div>`;
  if(lastAtlasHTML!==html){lastAtlasHTML=html;const scroll=atlasPanel.querySelector('.overlay')?.scrollTop??0;atlasPanel.innerHTML=html;atlasPanel.querySelector('.overlay')!.scrollTop=scroll;}
}
document.querySelector('#atlas')!.addEventListener('click',()=>{walking=false;atlasPanel.hidden=false;atlasView();});
atlasPanel.addEventListener('click',e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-action]');if(!button)return;const action=button.dataset.action,id=Number(button.dataset.waystone);if(action==='warp'){audio.enable();sim.warp(p.id,id);atlasView();}if(action==='track-waystone'){tracked=id;atlasView();}if(action==='clear-track'){tracked=undefined;atlasView();}if(action==='close')atlasPanel.hidden=true;});
document.querySelector('#biome')!.addEventListener('click',()=>{walking=false;const s=selectedSite();Object.assign(p,{realm:'wilds',x:s.x+8,z:s.z+15,y:terrainHeight(s.x+8,s.z+15,sim.world.seed),yaw:Math.atan2(8,15),pitch:.09});});
document.querySelector('#center')!.addEventListener('click',()=>{walking=false;const s=selectedSite();Object.assign(p,{realm:'wilds',x:s.x,z:s.z,y:s.y,yaw:0,pitch:0});});
document.querySelector('#dash')!.addEventListener('click',()=>{dash=true;audio.enable();});
document.querySelector('#rune')!.addEventListener('click',()=>{walking=false;const site=shardSites(sim.world.seed)[0];Object.assign(p,{realm:'wilds',x:site.x+5,z:site.z+12,y:terrainHeight(site.x+5,site.z+12,sim.world.seed),yaw:.4,pitch:.08});});
document.querySelector('#aura')!.addEventListener('click',()=>{p.relics=7;scene.perspective=scene.perspective==='first'?'rear':'first';audio.enable();audio.chime();});
document.querySelector('#sound')!.addEventListener('click',()=>{audio.enable();audio.event({id:0,type:'hit',blocked:true},true);});
scene.settings(quality, 120, reduced);
document.querySelector('#quality')!.addEventListener('change', e => { quality = (e.target as HTMLSelectElement).value; scene.settings(quality, 120, reduced); });
document.querySelector('#reduced')!.addEventListener('change', e => { reduced = (e.target as HTMLInputElement).checked; scene.settings(quality,120,reduced); });
document.querySelector('#walk')!.addEventListener('click', () => { walking = !walking; document.querySelector('#walk')!.textContent = walking ? 'Stop walking' : 'Walk the hills'; });
document.querySelector('#teleport')!.addEventListener('click', () => { region++; p.realm = 'wilds'; p.x = 22 + region * 120; p.z = -32 - region * 60; p.y = terrainHeight(p.x, p.z, sim.world.seed); });
document.querySelector('#door')!.addEventListener('click', () => { walking = false; Object.assign(p, { realm: 'arena', x: -26, z: -43, y: 0, yaw: 0, pitch: -.08 }); sim.world.doorOpen = !sim.world.doorOpen; });
document.querySelector('#return')!.addEventListener('click', () => { walking=false;p.realm = 'wilds'; p.x = 0; p.z = -4; p.y = 0; p.yaw = Math.PI; });
function frame(now: number) {
  const elapsed = now - previous; previous = now; frames.push(elapsed); if (frames.length > 240) frames.shift();
  const dt = Math.min(.1, elapsed / 1000); acc = Math.min(.1, acc + dt);
  while (acc >= DT) { acc -= DT; sim.input(p.id,{ ...idleInput(),seq:++seq,yaw:p.yaw,pitch:p.pitch,offhand:p.offhand,weapon:p.weapon,z:walking?1:0,sprint:walking,dash });sim.step();dash=false; }
  for(const e of sim.events)if(e.id>eventId){eventId=e.id;scene.event(e);audio.event(e,e.actor===p.id);}
  audio.update(dt,p,p,true,.3,true,sim.world.seed);
  scene.render(dt, sim.snapshot(), p, p, p.yaw, p.pitch, true, walking);
  if(!atlasPanel.hidden&&now-lastAtlas>120){lastAtlas=now;atlasView();}
  const sorted = [...frames].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * .95)] ?? 0;
  document.querySelector('#stats')!.textContent = `${scene.fps} FPS · p95 frame ${p95.toFixed(1)} ms\n${scene.terrain.chunks.size} resident chunks · ${scene.terrain.queue.length} queued\n${scene.renderer.info.render.calls} draw calls · ${scene.renderer.info.render.triangles} triangles\n${scene.renderer.info.memory.geometries} geometries · ${scene.renderer.info.memory.textures} textures\n${BIOMES[biomeAt(p.x,p.z,sim.world.seed)].name} · ${Math.round(p.x)}, ${Math.round(p.z)} · height ${p.y.toFixed(2)}\n${awakenedCount(sim.world.waystones)}/8 waystones · ${p.relics}/7 shard mask · near ${nearbyWaystone(p,sim.world.seed)?.name??'none'}\nHorizon: ${scene.terrain.horizon?'ready':'loading'} · Dash: ${(p.dashCooldown??0).toFixed(1)}s · Audio: ${audio.context?.state??'off'} / ${audio.voices} voices\nWorker: ${scene.terrain.worker ? 'running' : 'fallback'} · ${scene.terrain.busy ? 'one request' : 'idle'}\nCaches: ${treeCacheSize()} trees · ${terrainCacheSize()} heights`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
