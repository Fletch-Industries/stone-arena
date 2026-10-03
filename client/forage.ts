import * as THREE from 'three';
import { gatherTarget, suppliesNear, supplyPosition, SUPPLIES, type SupplyNode } from '../shared/forage.js';
import { hash, type WorldState } from '../shared/world.js';
import { TextureLibrary } from './textures.js';
import type { Excavation } from '../shared/excavation.js';

/** Five shared instanced draws; one reusable selection halo, no resource lights. */
export class ForageRenderer {
  group = new THREE.Group();
  target?: SupplyNode;
  visibleCount = 0;
  private last = '';
  private excavation?: Excavation;
  private time = { value: 0 };
  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private angle = new THREE.Euler();
  private meshes: THREE.InstancedMesh[];
  private halo = new THREE.Mesh(new THREE.TorusGeometry(.7, .025, 4, 32), new THREE.MeshBasicMaterial({ color: '#9af3cf' }));
  constructor(textures: TextureLibrary) {
    const leaf = new THREE.MeshLambertMaterial({ color: '#83d7ae', map: textures.get('leaves'), side: THREE.DoubleSide });
    leaf.onBeforeCompile = shader => { shader.uniforms.forageTime = this.time; shader.vertexShader = 'uniform float forageTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(forageTime * 1.6 + instanceMatrix[3].x) * .05 * max(0.0, position.y + .4);'); };
    const materials = [
      new THREE.MeshLambertMaterial({ color: '#648d79', map: textures.get('bark') }), leaf,
      new THREE.MeshLambertMaterial({ color: '#b6f4de', emissive: '#76c5a6', emissiveIntensity: .22 }),
      new THREE.MeshLambertMaterial({ color: '#aebcff', emissive: '#777abc', emissiveIntensity: .22, map: textures.get('rune') }),
      new THREE.MeshLambertMaterial({ color: '#ffc680', emissive: '#d3823c', emissiveIntensity: .42 }),
    ];
    const geometries = [new THREE.CylinderGeometry(.055, .075, .9, 4), new THREE.PlaneGeometry(.3, .8), new THREE.IcosahedronGeometry(.16, 0), new THREE.OctahedronGeometry(.42, 0), new THREE.IcosahedronGeometry(.23, 0)];
    this.meshes = materials.map((material, n) => { const mesh = new THREE.InstancedMesh(geometries[n], material, 2048); mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(mesh); return mesh; });
    this.halo.rotation.x = -Math.PI / 2; this.halo.visible = false; this.group.add(this.halo);
  }
  update(world: WorldState, p: { x: number; y: number; z: number; yaw: number; pitch: number; realm?: string }, tick: number, time: number, quality: string, reduced: boolean) {
    this.time.value = reduced ? 0 : time;
    const key = `${world.seed}:${world.forage?.revision ?? 0}:${world.excavation?.revision ?? 0}:${Math.floor(p.x / 24)}:${Math.floor(p.z / 24)}:${quality}`;
    if (key !== this.last || this.excavation !== world.excavation) {
      this.last = key; this.excavation = world.excavation; this.visibleCount = 0; const counts = [0, 0, 0, 0, 0];
      const add = (mesh: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, yaw = 0, tilt = 0) => {
        this.position.set(x, y, z); this.angle.set(tilt, yaw, 0); this.rotation.setFromEuler(this.angle); this.scale.set(sx, sy, sz); this.matrix.compose(this.position, this.rotation, this.scale); this.meshes[mesh].setMatrixAt(counts[mesh]++, this.matrix);
      };
      for (const raw of suppliesNear(p.x, p.z, world.seed, quality === 'low' ? 72 : quality === 'high' ? 120 : 96)) {
        const n = supplyPosition(raw, world);
        if (world.forage && !world.forage.available(n, tick)) continue; this.visibleCount++;
        for (let part = 0; part < 3; part++) {
          const angle = part * Math.PI * 2 / 3 + hash(n.cx, n.cz, world.seed) * 6;
          const x = n.x + Math.sin(angle) * .28, z = n.z + Math.cos(angle) * .28, height = part === 0 ? 1.2 : .9;
          if (n.kind === 1) { add(3, x, n.y + height * .43, z, .75, height * 1.5, .75, angle); continue; }
          add(0, x, n.y + height / 2, z, 1, height / .9, 1); add(n.kind === 0 ? 2 : 4, x, n.y + height, z);
          for (const side of [-1, 1]) add(1, x + Math.sin(angle) * side * .12, n.y + .5, z + Math.cos(angle) * side * .12, 1, .7, 1, angle, side * .45);
        }
      }
      this.meshes.forEach((mesh, n) => { mesh.count = counts[n]; mesh.instanceMatrix.needsUpdate = true; if (mesh.count) mesh.computeBoundingSphere(); });
    }
    this.target = gatherTarget(p, world, tick); this.halo.visible = !!this.target;
    if (this.target) { this.halo.position.set(this.target.x, this.target.y + .06, this.target.z); this.halo.material.color.set(SUPPLIES[this.target.kind].color); this.halo.scale.setScalar(reduced ? 1 : 1 + Math.sin(time * 4) * .06); }
  }
}
