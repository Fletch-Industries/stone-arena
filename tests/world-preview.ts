import { BUILD, Construction } from '../shared/construction.js';
import { placementReason, weaveTarget } from '../shared/weaving.js';
import { hotbar, runePalette } from '../client/hotbar.js';
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
let weaving=false, weaveKind=0, weave=false, erase=false, jump=false, buildHudHTML='', demoBase:{x:number;y:number;z:number}|undefined;
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
function makeLodge(stress=false) {
  walking=false; sim.world.construction=new Construction();
  const world=sim.world; let plot:{x:number;y:number;z:number}|undefined;
  for(let x=32;x<130&&!plot;x+=10)for(let z=-110;z<-30&&!plot;z+=10){
    let top=0,clear=true; for(let dx=0;dx<12;dx++)for(let dz=0;dz<12;dz++){const y=Math.floor(terrainHeight(x+dx+.5,z+dz+.5,world.seed));top=Math.max(top,y);if(placementReason({x:x+dx,y,z:z+dz},world))clear=false;}
    if(clear)plot={x,y:top,z};
  }
  if(!plot)throw Error('No clear preview plot'); demoBase=plot; const {x,y,z}=plot;
  Object.assign(p,{realm:'wilds',x:x+17,z:z+19,y:terrainHeight(x+17,z+19,world.seed),yaw:Math.atan2(11,13),pitch:.1,grounded:true,vy:0});
  const add=(bx:number,by:number,bz:number,kind:number)=>{if(!placementReason({x:bx,y:by,z:bz},world,[p]))world.construction!.place({x:bx,y:by,z:bz,kind,owner:`preview:${Math.floor(world.construction!.size/BUILD.playerLimit)}`});};
  for(let dx=1;dx<=8;dx++)for(let dz=1;dz<=8;dz++)for(let by=Math.floor(terrainHeight(x+dx+.5,z+dz+.5,world.seed));by<=y;by++)add(x+dx,by,z+dz,dx===8&&dz===8?5:3);
  for(let level=1;level<=3;level++)for(let n=1;n<=8;n++)for(const [bx,bz]of[[x+n,z+1],[x+n,z+8],[x+1,z+n],[x+8,z+n]]){if(bz===z+8&&n>=4&&n<=5&&level<3)continue;add(bx,y+level,bz,level===2&&n%3===0?2:1);}
  for(let dx=0;dx<=9;dx++)for(let dz=0;dz<=9;dz++)add(x+dx,y+4,z+dz,dx===0||dz===0||dx===9||dz===9?0:3);
  for(const [dx,dz]of[[2,2],[7,2],[2,7],[7,7]])add(x+dx,y+5,z+dz,4);
  if(stress)for(let bx=x-45;bx<x+75&&world.construction!.size<BUILD.roomLimit;bx++)for(let bz=z-45;bz<z+75&&world.construction!.size<BUILD.roomLimit;bz++){const bottom=Math.floor(terrainHeight(bx+.5,bz+.5,world.seed));for(let level=0;level<3&&world.construction!.size<BUILD.roomLimit;level++)add(bx,bottom+level,bz,(bx+bz+1200)%6);}
  weaving=false; scene.weavePreview=false; buildHud();
}
function buildHud(){const root=document.querySelector<HTMLElement>('#build-hud')!;root.hidden=!weaving;const html=`${hotbar({...p,buildCount:sim.world.construction!.count(p.id)},p.weapon,true,weaveKind)}<p class="combat-hint">Aim with the controls · Weave or erase · Windlift lifts jumps</p>`;if(html!==buildHudHTML){buildHudHTML=html;root.querySelector('.bottom')!.innerHTML=html;}}
document.querySelector('#build-demo')!.addEventListener('click',()=>{makeLodge();audio.enable();audio.chime();});
document.querySelector('#build-stress')!.addEventListener('click',()=>makeLodge(true));
document.querySelector('#build-mode')!.addEventListener('click',()=>{walking=false;weaving=!weaving;if(!weaving){buildHud();return;}if(!demoBase)makeLodge();weaving=true;const t=demoBase!;Object.assign(p,{x:t.x+11.5,z:t.z+8.5,y:terrainHeight(t.x+11.5,t.z+8.5,sim.world.seed),yaw:0,pitch:-.65});buildHud();});
document.querySelector('#build-hud')!.addEventListener('click',e=>{const t=(e.target as HTMLElement).closest<HTMLElement>('[data-kind]');if(t){weaveKind=Number(t.dataset.kind);buildHud();}});
document.querySelector('#place-rune')!.addEventListener('click',()=>{weave=true;audio.enable();});
document.querySelector('#erase-rune')!.addEventListener('click',()=>{erase=true;audio.enable();});
document.querySelector('#wind-course')!.addEventListener('click',()=>{if(!demoBase)makeLodge();const t=demoBase!;Object.assign(p,{x:t.x+8.5,z:t.z+8.5,y:t.y+1,vy:0,grounded:true,yaw:-Math.PI/4,pitch:.15});weaving=false;jump=true;audio.enable();buildHud();});
function frame(now: number) {
  const elapsed = now - previous; previous = now; frames.push(elapsed); if (frames.length > 240) frames.shift();
  const dt = Math.min(.1, elapsed / 1000); acc = Math.min(.1, acc + dt);
  while (acc >= DT) { acc -= DT; sim.input(p.id,{ ...idleInput(),seq:++seq,yaw:p.yaw,pitch:p.pitch,offhand:p.offhand,weapon:p.weapon,z:walking?1:0,sprint:walking,dash,weaving,weaveKind,attack:weave,block:erase,jump });sim.step();dash=weave=erase=jump=false; }
  for(const e of sim.events)if(e.id>eventId){eventId=e.id;scene.event(e);audio.event(e,e.actor===p.id);}
  audio.update(dt,p,p,true,.3,true,sim.world.seed);
  const snapshot=sim.snapshot(); snapshot.world.construction=sim.world.construction; scene.weavePreview=weaving; scene.erasePreview=erase;
  scene.render(dt, snapshot, p, p, p.yaw, p.pitch, true, walking);
  if(!atlasPanel.hidden&&now-lastAtlas>120){lastAtlas=now;atlasView();}
  if(weaving)buildHud();
  const sorted = [...frames].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * .95)] ?? 0;
  document.querySelector('#stats')!.textContent = `${scene.fps} FPS · p95 frame ${p95.toFixed(1)} ms\n${scene.terrain.chunks.size} resident chunks · ${scene.terrain.queue.length} queued\n${scene.renderer.info.render.calls} draw calls · ${scene.renderer.info.render.triangles} triangles\n${scene.renderer.info.memory.geometries} geometries · ${scene.renderer.info.memory.textures} textures\n${BIOMES[biomeAt(p.x,p.z,sim.world.seed)].name} · ${Math.round(p.x)}, ${Math.round(p.z)} · height ${p.y.toFixed(2)}\n${awakenedCount(sim.world.waystones)}/8 waystones · ${p.relics}/7 shard mask · near ${nearbyWaystone(p,sim.world.seed)?.name??'none'}\nHorizon: ${scene.terrain.horizon?'ready':'loading'} · Dash: ${(p.dashCooldown??0).toFixed(1)}s · Audio: ${audio.context?.state??'off'} / ${audio.voices} voices\nRunes: ${sim.world.construction!.size}/${BUILD.roomLimit} · ${scene.construction.visibleCount} visible · ${weaveTarget(p,sim.world)?.reason??'aim at ground'}\nWorker: ${scene.terrain.worker ? 'running' : 'fallback'} · ${scene.terrain.busy ? 'one request' : 'idle'}\nCaches: ${treeCacheSize()} trees · ${terrainCacheSize()} heights`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
