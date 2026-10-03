import * as THREE from 'three';
import { BIOMES, biomeAt } from '../shared/biomes.js';
import { hash, terrainHeight } from '../shared/world.js';
/** Decorative spirit moths: one draw, at most 32 instances, no network entities. */
export class SpiritMoths {
  mesh: THREE.InstancedMesh; time = { value: 0 }; center = ''; anchors: { x: number; z: number; phase: number }[] = [];
  matrix = new THREE.Matrix4();
  scale = new THREE.Vector3(.35,.35,.35);
  constructor(parent: THREE.Object3D) {
    const geometry = new THREE.BufferGeometry(), points: number[] = [];
    for (const side of [-1, 1]) points.push(0,0,0, side*.55,.2,.05, side*.32,-.25,0);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3)); geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    material.onBeforeCompile = shader => { shader.uniforms.wingTime = this.time; shader.vertexShader = 'uniform float wingTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.z += sin(wingTime * 12. + instanceMatrix[3].x * .7) * abs(position.x) * .6;'); };
    material.customProgramCacheKey = () => 'stone-spirit-moth-v1';
    this.mesh = new THREE.InstancedMesh(geometry,material,32); this.mesh.frustumCulled = false; this.mesh.visible = false; parent.add(this.mesh);
  }
  update(x: number, z: number, seed: number, time: number, quality: string, reduced: boolean, visible: boolean) {
    this.mesh.visible = visible; if (!visible) return;
    const count = quality === 'low' ? 8 : quality === 'high' ? 32 : 18, cx = Math.floor(x/40), cz = Math.floor(z/40), center = `${seed}:${cx},${cz}:${count}`;
    if (center !== this.center) {
      this.center = center; this.anchors = [];
      const cells = [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
      for (let n = 0; n < count; n++) {
        const [dx,dz] = cells[n % 9], gx = cx + dx, gz = cz + dz, slot = Math.floor(n / 9);
        const ax = gx * 40 + 8 + hash(gx,gz,seed ^ (811 + slot * 23)) * 24, az = gz * 40 + 8 + hash(gx,gz,seed ^ (829 + slot * 31)) * 24;
        this.anchors.push({ x: ax, z: az, phase: hash(gx,gz,seed ^ (839 + slot)) * Math.PI * 2 });
        this.mesh.setColorAt(n,new THREE.Color(BIOMES[biomeAt(ax,az,seed)].spirit));
      }
      this.mesh.count = count;
    }
    const t = reduced ? 0 : time; this.time.value = t;
    this.anchors.forEach((a,n) => {
      const ax = a.x + Math.sin(t*.32+a.phase)*2.6, az = a.z + Math.cos(t*.26+a.phase)*2.6;
      this.matrix.makeRotationY(a.phase + t*.2); this.matrix.scale(this.scale);
      this.matrix.setPosition(ax,terrainHeight(ax,az,seed)+1.5+Math.sin(t*.7+a.phase)*.6,az); this.mesh.setMatrixAt(n,this.matrix);
    }); this.mesh.instanceMatrix.needsUpdate = true;
  }
}
