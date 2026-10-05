import * as THREE from 'three';
import { BUILD, RUNE_KINDS, type Construction } from '../shared/construction.js';
import { weaveTarget, type Weaver, type WeaveTarget } from '../shared/weaving.js';
import type { WorldState } from '../shared/world.js';
import { vistaDistance } from '../shared/horizon.js';
import { TextureLibrary } from './textures.js';
import { HEARTHSTONE } from '../shared/sailing.js';

/** Seven shared rune meshes, one preview cube, no per-block lights or animation objects. */
export class RuneConstruction {
  group = new THREE.Group();
  meshes: THREE.InstancedMesh[];
  ghost: THREE.Mesh;
  target?: WeaveTarget;
  private matrix = new THREE.Matrix4();
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private last = '';
  private store?: Construction;
  private previewAt = 0;
  visibleCount = 0;
  constructor(textures: TextureLibrary) {
    this.meshes = RUNE_KINDS.map((rune, n) => {
      const surface = n === 1 ? 'wood' : n === 3 ? 'cobble' : n === 5 ? 'wind-rune' : n === 6 ? 'hearth-rune' : 'rune';
      const material = new THREE.MeshLambertMaterial({ color: n === 1 ? '#ffe0ae' : rune.color, map: textures.get(surface), emissive: rune.color, emissiveIntensity: n === 4 ? .55 : n === 6 ? .45 : n === 5 ? .24 : n === 2 ? .08 : .045 });
      const mesh = new THREE.InstancedMesh(this.geometry, material, BUILD.roomLimit); mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.receiveShadow = true; this.group.add(mesh); return mesh;
    });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1.025, 1.025, 1.025), new THREE.MeshBasicMaterial({ color: '#91ffdf', transparent: true, opacity: .35, depthWrite: false, wireframe: true }));
    this.ghost.visible = false; this.group.add(this.ghost);
  }
  update(world: WorldState, p: (Weaver & { id?: string }) | undefined, quality: string, time: number, building: boolean, erase: boolean, players: Parameters<typeof weaveTarget>[3] = [], allowErase = false) {
    const blocks = world.construction, distance = vistaDistance(quality), key = `${world.seed}:${blocks?.revision ?? -1}:${Math.floor((p?.x ?? 0) / 16)}:${Math.floor((p?.z ?? 0) / 16)}:${quality}`;
    if (key !== this.last || this.store !== blocks) {
      this.last = key; this.store = blocks; const counts = this.meshes.map(() => 0); this.visibleCount = 0;
      for (const block of blocks?.values() ?? []) {
        if (Math.hypot(block.x + .5 - (p?.x ?? 0), block.z + .5 - (p?.z ?? 0)) > distance + 24) continue;
        this.matrix.makeTranslation(block.x + .5, block.y + .5, block.z + .5);
        this.meshes[block.kind].setMatrixAt(counts[block.kind]++, this.matrix); this.visibleCount++;
      }
      this.meshes.forEach((mesh, n) => { mesh.count = counts[n]; mesh.castShadow = quality === 'high'; mesh.instanceMatrix.needsUpdate = true; if (mesh.count) mesh.computeBoundingSphere(); });
    }
    this.ghost.visible = building && !!p && p.realm === 'wilds';
    if (!this.ghost.visible) { this.target = undefined; return; }
    if (time >= this.previewAt) {
      this.previewAt = time + .05; this.target = weaveTarget(p!, world, erase, players);
      if (this.target?.valid && !erase && p!.weaveKind === 6 && !((world.upgrades ?? 0) & HEARTHSTONE)) { this.target.valid = false; this.target.reason = 'Craft Hearthstone at a waystone loom first'; }
      if (this.target?.valid && !erase && (blocks!.size >= BUILD.roomLimit || p!.id && blocks!.count(p!.id) >= BUILD.playerLimit)) { this.target.valid = false; this.target.reason = blocks!.size >= BUILD.roomLimit ? 'This world is full · Erase a rune to make room' : 'Your rune pouch is full · Erase one of your runes'; }
      if (this.target?.valid && erase && this.target.existing?.owner !== p!.id && !allowErase) { this.target.valid = false; this.target.reason = 'This rune belongs to another explorer'; }
      if (this.target) {
        this.ghost.position.set(this.target.x + .5, this.target.y + .5, this.target.z + .5);
        const material = this.ghost.material as THREE.MeshBasicMaterial;
        const surface = this.target.valid && !erase ? this.meshes[p!.weaveKind ?? 0]?.material as THREE.MeshLambertMaterial | undefined : undefined;
        const map = surface?.map ?? null;
        if (material.map !== map) { material.map = map; material.needsUpdate = true; }
        material.wireframe = !surface;
        if (surface) material.color.copy(surface.color);
        else material.color.set(this.target.valid ? erase ? '#f5c17b' : '#91ffdf' : '#ff9385');
      }
    }
    this.ghost.visible = !!this.target;
  }
}
