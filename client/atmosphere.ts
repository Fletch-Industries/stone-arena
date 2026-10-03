import * as THREE from 'three';
/** Original sky and bounded cloud instances; no image downloads or extra render passes. */
export class Atmosphere {
  sky: THREE.Mesh; clouds: THREE.InstancedMesh;
  constructor(scene: THREE.Scene) {
    const material = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {}, vertexShader: 'varying vec3 skyDir; void main(){ skyDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }', fragmentShader: `varying vec3 skyDir; void main(){ vec3 d=normalize(skyDir); float h=pow(max(0.0,d.y),.55); vec3 c=mix(vec3(.72,.83,.83),vec3(.12,.35,.58),h); float sun=dot(d,normalize(vec3(-.42,.8,.3))); c+=vec3(1.,.72,.37)*pow(max(sun,0.),64.)*.24; c=mix(c,vec3(1.,.87,.6),smoothstep(.9993,.9997,sun)); gl_FragColor=vec4(c,1.); #include <colorspace_fragment> }`.replace('#include <colorspace_fragment>', '\n#include <colorspace_fragment>\n') });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(950, 24, 12), material); this.sky.frustumCulled = false; scene.add(this.sky);
    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color:'#fff4e3', transparent:true, opacity:.76, depthWrite:false }), 84);
    const matrix = new THREE.Matrix4();
    for(let i=0;i<84;i++){ const cluster=Math.floor(i/7), a=cluster*2.399, r=170+(cluster%4)*80; matrix.makeScale(10+(i%3)*3,3.5,7+(i%4)*2); matrix.setPosition(Math.cos(a)*r+(i%7-3)*12,75+(cluster%3)*12+(i%3)*1.8,Math.sin(a)*r+(i*13%7-3)*3); this.clouds.setMatrixAt(i,matrix); }
    this.clouds.frustumCulled=false; scene.add(this.clouds);
  }
  update(camera: THREE.Camera, time:number, reduced:boolean){ this.sky.position.copy(camera.position); this.clouds.position.set(camera.position.x+ (reduced?0:Math.sin(time*.004)*25),0,camera.position.z); }
}
/** Reuses a fixed pool for rune sparks and impact debris. */
export class SparkPool {
  points: THREE.Points; positions=new Float32Array(256*3); colors=new Float32Array(256*3); velocity=new Float32Array(256*3); life=new Float32Array(256); next=0;
  constructor(scene:THREE.Scene){ const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(this.positions,3));g.setAttribute('color',new THREE.BufferAttribute(this.colors,3));this.points=new THREE.Points(g,new THREE.PointsMaterial({size:.13,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));this.points.frustumCulled=false;scene.add(this.points); }
  burst(x:number,y:number,z:number,color:string,count=18){ const c=new THREE.Color(color);for(let n=0;n<count;n++){const i=this.next++%256;this.life[i]=.55+Math.random()*.4;this.positions.set([x,y,z],i*3);this.colors.set([c.r,c.g,c.b],i*3);this.velocity.set([(Math.random()-.5)*3,Math.random()*3,(Math.random()-.5)*3],i*3);} }
  clear(){this.life.fill(0);this.colors.fill(0);}
  update(dt:number, visible:boolean){this.points.visible=visible;for(let i=0;i<256;i++){if(this.life[i]<=0)continue;this.life[i]-=dt;for(let a=0;a<3;a++){this.positions[i*3+a]+=this.velocity[i*3+a]*dt;this.colors[i*3+a]*=Math.exp(-dt*2.2);}this.velocity[i*3+1]-=dt*3;if(this.life[i]<=0)this.colors.fill(0,i*3,i*3+3);}this.points.geometry.attributes.position.needsUpdate=true;this.points.geometry.attributes.color.needsUpdate=true; }
}
