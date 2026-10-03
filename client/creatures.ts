import * as THREE from 'three';
import { CREATURES, WARDEN, WILDLIFE, creatureView, type CreatureView, type CreatureWire } from '../shared/creatures.js';
import { terrainHeight, type WorldState } from '../shared/world.js';
import type { GameEvent } from '../shared/game.js';
import type { TextureLibrary } from './textures.js';

interface Rig { x:number; y:number; z:number; yaw:number; stride:number; flash:number }
type Parts = { body:THREE.InstancedMesh; head:THREE.InstancedMesh; feet:THREE.InstancedMesh; accents:THREE.InstancedMesh; eyes:THREE.InstancedMesh; pupils:THREE.InstancedMesh };
/** Six shared draws per species, irrespective of population. All artwork is original. */
export class CreatureRenderer {
  group = new THREE.Group();
  private rigs = new Map<string,Rig>();
  private kinds:Parts[]=[]; private meshes:THREE.InstancedMesh[]=[];
  private dummy = new THREE.Object3D(); private tint=new THREE.Color();
  private shadow:THREE.InstancedMesh; private hearts:THREE.InstancedMesh; private pulses:THREE.Mesh;
  private pulseKeys:string[]=[];
  private pulsePositions:THREE.BufferAttribute; private pulseUV:THREE.BufferAttribute; private pulseCues:THREE.BufferAttribute;
  private counts = new Map<THREE.InstancedMesh,number>();
  constructor(textures:TextureLibrary) {
    this.group.name='grove-creatures';
    const cube=new THREE.BoxGeometry(1,1,1), round=new THREE.IcosahedronGeometry(.5,1), crystal=new THREE.IcosahedronGeometry(.5,0);
    const make=(geometry:THREE.BufferGeometry,material:THREE.Material,capacity=32)=>{
      const m=new THREE.InstancedMesh(geometry,material,capacity);m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.frustumCulled=false;m.count=0;this.group.add(m);this.meshes.push(m);return m;
    };
    for(let k=0;k<5;k++){
      const fur=k<2?'spirit-fur':k===4?'rune':'lantern-shell';
      const skin=new THREE.MeshLambertMaterial({map:textures.get(fur),color:'#ffffff'});
      const accent=new THREE.MeshLambertMaterial({map:textures.get(k<2?'leaves':'metal'),color:'#ffffff',emissive:k===4?'#51376e':'#183a35',emissiveIntensity:.35});
      const eye=new THREE.MeshBasicMaterial({color:k===4?'#eecaff':'#fff2d1'}), pupil=new THREE.MeshBasicMaterial({color:'#13222d'});
      this.kinds.push({body:make(round,skin),head:make(k===4?cube:round,skin),feet:make(cube,skin,192),accents:make(crystal,accent,256),eyes:make(cube,eye,64),pupils:make(cube,pupil,64)});
    }
    this.shadow=make(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:'#163037',opacity:.16,transparent:true,depthWrite:false}),32);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#b4ffe3';ctx.beginPath();ctx.moveTo(16,27);ctx.bezierCurveTo(-3,15,3,-3,16,8);ctx.bezierCurveTo(29,-3,35,15,16,27);ctx.fill();
    const heart=new THREE.CanvasTexture(canvas);heart.colorSpace=THREE.SRGBColorSpace;
    this.hearts=make(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:heart,transparent:true,alphaTest:.1,depthWrite:false,side:THREE.DoubleSide}),32);
    const pulse=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:'attribute vec3 cue; varying vec2 vUv; varying vec3 vCue; void main(){vUv=uv;vCue=cue;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec2 vUv; varying vec3 vCue; void main(){vec2 q=vUv*2.-1.;float r=length(q);if(r>1.)discard;
        float edge=1.-smoothstep(.014,.036,abs(r-.97));float close=1.-smoothstep(.018,.06,abs(r-max(.02,1.-vCue.r)));
        float spokes=pow(abs(cos(atan(q.y,q.x)*8.)),18.)*smoothstep(.55,.92,r);float fill=(1.-r)*.13;
        vec3 color=mix(vec3(.7,.38,1.),vec3(1.,.82,.47),vCue.g);gl_FragColor=vec4(color,(edge*.85+close*.6+spokes*.24+fill)*vCue.b);}`});
    // Eight bounded patches use the terrain's exact integer-grid triangulation,
    // so the warning stays visible over slopes without another rendering pass.
    const patch=new THREE.BufferGeometry(),indices:number[]=[];
    this.pulsePositions=new THREE.BufferAttribute(new Float32Array(8*64*3),3).setUsage(THREE.DynamicDrawUsage);
    this.pulseUV=new THREE.BufferAttribute(new Float32Array(8*64*2),2).setUsage(THREE.DynamicDrawUsage);
    this.pulseCues=new THREE.BufferAttribute(new Float32Array(8*64*3),3).setUsage(THREE.DynamicDrawUsage);
    for(let n=0;n<8;n++)for(let z=0;z<7;z++)for(let x=0;x<7;x++){const a=n*64+z*8+x,b=a+1,c=a+8;indices.push(a,b,c,c,b,c+1);}
    patch.setAttribute('position',this.pulsePositions);patch.setAttribute('uv',this.pulseUV);patch.setAttribute('cue',this.pulseCues);patch.setIndex(indices);patch.setDrawRange(0,0);
    this.pulses=new THREE.Mesh(patch,pulse);this.pulses.frustumCulled=false;this.pulses.renderOrder=2;this.group.add(this.pulses);
  }
  event(e:GameEvent){if(e.type==='creature_hit'&&e.target){const r=this.rigs.get(e.target);if(r)r.flash=.22;}}
  private put(mesh:THREE.InstancedMesh,r:Rig,x:number,y:number,z:number,sx:number,sy:number,sz:number,color?:string,rx=0,ry=0,rz=0){
    const index=this.counts.get(mesh)??0;if(index>=mesh.instanceMatrix.count)return;
    const sin=Math.sin(r.yaw),cos=Math.cos(r.yaw);this.dummy.position.set(r.x+x*cos+z*sin,r.y+y,r.z-x*sin+z*cos);
    this.dummy.rotation.set(rx,r.yaw+ry,rz);this.dummy.scale.set(sx,sy,sz);this.dummy.updateMatrix();mesh.setMatrixAt(index,this.dummy.matrix);
    if(color)mesh.setColorAt(index,this.tint.set(color));this.counts.set(mesh,index+1);
  }
  update(wire:CreatureWire[],world:WorldState,camera:THREE.Camera,me:string,time:number,dt:number,reduced:boolean,enabled:boolean){
    this.group.visible=enabled;if(!enabled)return;this.counts.clear();let pulseCount=0;const ids=new Set(wire.map(w=>w[0]));for(const id of this.rigs.keys())if(!ids.has(id))this.rigs.delete(id);
    for(const w of wire.slice(0,WILDLIFE.limit)){
      const c:CreatureView=creatureView(w);let r=this.rigs.get(c.id);
      if(!r){r={x:c.x,y:c.y,z:c.z,yaw:c.yaw,stride:0,flash:0};this.rigs.set(c.id,r);}
      const oldX=r.x,oldZ=r.z,blend=1-Math.exp(-dt*18),gap=Math.hypot(r.x-c.x,r.z-c.z);
      r.x+=(c.x-r.x)*(gap>24?1:blend);r.y+=(c.y-r.y)*(gap>24?1:blend);r.z+=(c.z-r.z)*(gap>24?1:blend);
      r.yaw+=Math.atan2(Math.sin(c.yaw-r.yaw),Math.cos(c.yaw-r.yaw))*blend;
      const travel=Math.hypot(r.x-oldX,r.z-oldZ),walking=travel>.001&&travel<1;r.stride+=walking?travel*8:0;r.flash=Math.max(0,r.flash-dt);
      const k=c.kind,parts=this.kinds[k],phase=time*2+(c.x+c.z)*.05,hop=reduced?0:walking?Math.abs(Math.sin(r.stride))*.09:Math.sin(phase)*.025;
      const base=k===4?(c.state==='cleared'?'#8ca9b5':'#585071'):CREATURES[k].color;
      const body=r.flash>0?'#fff1cf':base,accent=k===4?(c.state==='cleared'?'#aaffdc':'#c19bf4'):CREATURES[k].accent;
      const blink=!reduced&&time%4.3<.12?.025:1;
      if(k===0){
        this.put(parts.body,r,0,.47+hop,0,.62,.55,.88,body);this.put(parts.head,r,0,.73+hop,-.4,.48,.48,.4,body);
        for(const s of [-1,1]){this.put(parts.accents,r,s*.18,1.06+hop,-.37,.13,.49,.1,accent,0,0,-s*.42);this.put(parts.accents,r,s*.3,.87+hop,-.34,.3,.11,.16,accent,0,0,s*.25);}
      }else if(k===1){
        this.put(parts.body,r,0,.45+hop,0,.58,.45,.88,body);this.put(parts.head,r,0,.66+hop,-.4,.5,.42,.4,body);
        for(const s of [-1,1])this.put(parts.accents,r,s*.18,.94+hop,-.38,.16,.36,.12,accent,0,0,-s*.25);
        for(let n=0;n<3;n++)this.put(parts.accents,r,(reduced?0:Math.sin(phase+n*.5))*.1,.6+hop+n*.1,.4+n*.17,.18,.2,.3,accent,.2,0,.2);
      }else if(k===2){
        this.put(parts.body,r,0,.43+hop,0,.82,.55,1,body);this.put(parts.head,r,0,.42+hop,-.5,.42,.34,.37,body);
        for(let n=0;n<3;n++)this.put(parts.accents,r,0,.65+hop,.3-n*.27,.43,.12,.18,accent);
        for(const s of [-1,1])this.put(parts.accents,r,s*.17,.72+hop,-.55,.07,.33,.07,accent,0,0,-s*.25);
      }else if(k===3){
        const float=.38+(reduced?0:Math.sin(phase)*.07);this.put(parts.body,r,0,.5+float,0,.76,.23,.74,body);this.put(parts.head,r,0,.53+float,-.26,.47,.25,.32,body);
        for(const s of [-1,1])this.put(parts.accents,r,s*.5,.5+float,0,.7,.07,.54,accent,0,0,s*(reduced?.12:Math.sin(phase*2)*.22));
        for(let n=0;n<3;n++)this.put(parts.accents,r,(reduced?0:Math.sin(phase+n))*.07,.45+float,.4+n*.18,.1,.065,.34,accent,-.1);
      }else{
        const float=reduced?0:Math.sin(phase)*.07;this.put(parts.body,r,0,.91+float,0,1.12,1.55,1.03,body);
        this.put(parts.head,r,0,1.19+float,-.44,.71,.45,.26,body);
        for(const s of [-1,1]){this.put(parts.accents,r,s*.7,.95+float,0,.3,.93,.27,accent,0,0,s*.35);this.put(parts.accents,r,s*.29,1.83+float,.05,.2,.45,.24,accent,0,0,-s*.3);}
        this.put(parts.accents,r,0,.61+float,-.55,.26,.31,.12,accent,0,0,Math.PI/4);
      }
      if(k<3)for(let n=0;n<(k===2?6:4);n++){
        const side=n%2?1:-1,pair=Math.floor(n/2),step=reduced?0:walking?Math.sin(r.stride+(pair+n%2)*Math.PI)*.1:0;
        this.put(parts.feet,r,side*(k===2?.38:.23),.17+hop+Math.max(0,step),pair*(k===2?.28:.5)-(k===2?.28:.25)+step,.12,.27,.15,body,walking&&!reduced?step*3:0);
      }
      const ey=k===4?1.2:k===3?.98:k===2?.49:.77+hop,ez=k===4?-.58:k===3?-.41:k===2?-.67:-.57;
      for(const s of [-1,1]){this.put(parts.eyes,r,s*(k===4?.17:.13),ey,ez,.14,(k===4?.11:.13)*blink,.025);this.put(parts.pupils,r,s*(k===4?.17:.13),ey,ez-.016,.055,.075*blink,.016);}
      this.put(this.shadow,{...r,y:terrainHeight(r.x,r.z,world.seed)},0,.017,0,k===4?1.5:1.05,k===4?1.5:1.05,1,undefined,-Math.PI/2);
      if(c.owner===me){const index=this.counts.get(this.hearts)??0;this.dummy.position.set(r.x,r.y+(k===0?1.6:1.35),r.z);this.dummy.quaternion.copy(camera.quaternion);this.dummy.scale.setScalar(.3);this.dummy.updateMatrix();this.hearts.setMatrixAt(index,this.dummy.matrix);this.counts.set(this.hearts,index+1);}
      if(k===4&&(c.state==='windup'||c.state==='recover')&&pulseCount<8){
        const slot=pulseCount++,key=`${world.seed}:${c.aimX}:${c.aimZ}`,changed=this.pulseKeys[slot]!==key;
        for(let n=0;n<64;n++){const index=slot*64+n;
          if(changed){const x=Math.floor(c.aimX-WARDEN.pulseRadius)+n%8,z=Math.floor(c.aimZ-WARDEN.pulseRadius)+Math.floor(n/8);
            this.pulsePositions.setXYZ(index,x,terrainHeight(x,z,world.seed)+.055,z);this.pulseUV.setXY(index,(x-c.aimX)/(WARDEN.pulseRadius*2)+.5,(z-c.aimZ)/(WARDEN.pulseRadius*2)+.5);}
          this.pulseCues.setXYZ(index,c.state==='windup'?1-c.timer/WARDEN.windup:1,c.state==='recover'?1:0,c.state==='windup'?1:Math.min(1,c.timer/.6));
        }
        if(changed){this.pulseKeys[slot]=key;this.pulsePositions.needsUpdate=this.pulseUV.needsUpdate=true;}
      }
    }
    this.pulses.visible=pulseCount>0;this.pulses.geometry.setDrawRange(0,pulseCount*7*7*6);this.pulseCues.needsUpdate=pulseCount>0;
    for(const mesh of this.meshes){mesh.count=this.counts.get(mesh)??0;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
}
