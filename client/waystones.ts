import * as THREE from 'three';
import { BIOMES } from '../shared/biomes.js';
import { HOME_WAYSTONE, waystoneSites, waystoneBoxes } from '../shared/waystones.js';
/** Seeded ruins share masonry, runes and glow assets; changing rooms releases labels/buffers. */
export class WaystoneLandmarks {
  group = new THREE.Group(); seed = -1; sites: THREE.Group[] = [];
  box = new THREE.BoxGeometry(1,1,1); crystal = new THREE.IcosahedronGeometry(1,0); ring = new THREE.TorusGeometry(2.5,.06,4,32);
  glow = Object.fromEntries(Object.entries(BIOMES).map(([key,b]) => [key,new THREE.MeshBasicMaterial({color:b.spirit})]));
  halos: Record<string,THREE.SpriteMaterial>;
  constructor(halo: THREE.Texture, private stone: THREE.Material) {
    this.halos = Object.fromEntries(Object.entries(BIOMES).map(([key,b]) => [key,new THREE.SpriteMaterial({map:halo,color:b.spirit,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:.65})]));
  }
  build(seed: number) {
    if (seed === this.seed) return; this.seed = seed;
    this.group.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); if (o instanceof THREE.Sprite && o.name === 'label') { o.material.map?.dispose(); o.material.dispose(); } });
    this.group.clear(); this.sites = [];
    for (const site of [HOME_WAYSTONE,...waystoneSites(seed)]) {
      const group = new THREE.Group(); group.position.set(site.x,site.y,site.z); group.userData.id = site.id;
      const boxes = waystoneBoxes(site,seed), matrix = new THREE.Matrix4();
      if (boxes.length) { const pillars = new THREE.InstancedMesh(this.box,this.stone,boxes.length); boxes.forEach((b,n) => { matrix.makeScale(b.w,b.h,b.d); matrix.setPosition(b.x-site.x,(b.y??0)+b.h/2-site.y,b.z-site.z); pillars.setMatrixAt(n,matrix); }); group.add(pillars); }
      const rune = new THREE.Mesh(this.crystal,this.glow[site.biome]); rune.scale.set(.65,1.1,.65); rune.position.y = 2.8; rune.name = 'rune'; group.add(rune);
      const halo = new THREE.Sprite(this.halos[site.biome]); halo.position.y = 2.8; halo.scale.set(3.3,3.3,1); halo.name = 'halo'; group.add(halo);
      const ring = new THREE.Mesh(this.ring,this.glow[site.biome]); ring.rotation.x = Math.PI/2; ring.position.y = .1; group.add(ring);
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96; const ctx = canvas.getContext('2d')!;
      ctx.fillStyle='#10232be6';ctx.fillRect(0,0,512,96);ctx.fillStyle=BIOMES[site.biome].spirit;ctx.font='bold 25px sans-serif';ctx.textAlign='center';ctx.fillText(site.id === 0 ? 'ARRIVAL WAYSTONE' : site.name.toUpperCase(),256,55);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:true})); label.name='label';label.scale.set(6,1.12,1);label.position.y=6.4;group.add(label);
      this.group.add(group);this.sites.push(group);
    }
  }
  update(x:number,z:number,time:number,mask:number,reduced:boolean,range:number) {
    for (const group of this.sites) {
      group.visible = Math.hypot(x-group.position.x,z-group.position.z) < range;
      if (!group.visible) continue;
      const awake = !!(mask & 1 << group.userData.id), rune = group.getObjectByName('rune')!;
      rune.rotation.y = reduced ? 0 : time * .4; rune.position.y = 2.8 + (reduced ? 0 : Math.sin(time * 1.1 + group.userData.id)*.15);
      rune.scale.set(awake ? .75 : .45,awake ? 1.3 : .75,awake ? .75 : .45);
      group.getObjectByName('halo')!.visible = awake;
    }
  }
}
