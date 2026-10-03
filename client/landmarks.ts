import * as THREE from 'three';
import { shardSites } from '../shared/expedition.js';
export class RuneLandmarks {
  halo:THREE.CanvasTexture;
  group=new THREE.Group();seed=-1;sites:THREE.Group[]=[]; crystal=new THREE.IcosahedronGeometry(1,0); stone=new THREE.CylinderGeometry(1,1.1,1,6);ring=new THREE.TorusGeometry(2.4,.055,4,48);
  constructor(){const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d')!,g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'#ffffffa0');g.addColorStop(.3,'#ffffff30');g.addColorStop(1,'#ffffff00');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);this.halo=new THREE.CanvasTexture(c);}
  build(seed:number){ if(seed===this.seed)return;this.seed=seed; const materials=new Set<THREE.Material>(); this.group.traverse(o=>{if(o instanceof THREE.Sprite){if(o.material.map!==this.halo)o.material.map?.dispose();materials.add(o.material);}else if(o instanceof THREE.Mesh){materials.add(o.material as THREE.Material);if(![this.crystal,this.stone,this.ring].includes(o.geometry as any))o.geometry.dispose();}});materials.forEach(m=>m.dispose());this.group.clear();this.sites=[];
    for(const site of shardSites(seed)){const g=new THREE.Group();g.position.set(site.x,site.y,site.z);const stone=new THREE.Mesh(this.stone,new THREE.MeshLambertMaterial({color:'#394b54'}));stone.scale.set(3,.12,3);stone.position.y=-.1;g.add(stone);
      const glow=new THREE.MeshBasicMaterial({color:site.color});const rune=new THREE.Mesh(this.crystal,glow);rune.scale.set(.8,1.5,.8);rune.position.y=3.7;g.add(rune);rune.name='rune';const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:this.halo,color:site.color,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));halo.scale.set(4,4,1);halo.position.y=3.7;halo.name='halo';g.add(halo);
      const ring=new THREE.Mesh(this.ring,glow);ring.rotation.x=Math.PI/2;ring.position.y=.12;g.add(ring);
      for(let n=0;n<4;n++){const a=n*Math.PI/2+Math.PI/4;const orb=new THREE.Mesh(this.crystal,glow);orb.scale.setScalar(.2);orb.position.set(Math.cos(a)*2.7,1.4,Math.sin(a)*2.7);g.add(orb);}
      const beam=new THREE.Mesh(new THREE.CylinderGeometry(.12,.3,55,6,1,true),new THREE.MeshBasicMaterial({color:site.color,transparent:true,opacity:.19,depthWrite:false}));beam.position.y=27.5;g.add(beam);
      const c=document.createElement('canvas');c.width=384;c.height=96;const ctx=c.getContext('2d')!;ctx.fillStyle='#102632d9';ctx.fillRect(0,0,384,96);ctx.fillStyle=site.color;ctx.textAlign='center';ctx.font='bold 30px sans-serif';ctx.fillText(site.name.toUpperCase()+' SKYSHARD',192,58);const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:true}));sign.scale.set(5,1.25,1);sign.position.y=6.8;g.add(sign);this.group.add(g);this.sites.push(g);
    }
  }
  update(time:number,mask:number,reduced:boolean){this.sites.forEach((s,i)=>{const rune=s.getObjectByName('rune')!;rune.rotation.y=reduced?0:time*.5+i;rune.position.y=3.7+(reduced?0:Math.sin(time*1.7+i)*.22);rune.visible=!(mask&1<<i);s.getObjectByName('halo')!.visible=rune.visible;});}
}
