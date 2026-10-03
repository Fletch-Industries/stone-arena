import * as THREE from 'three';
import { sculptTarget, type SculptTarget, type StoneSinger } from '../shared/mining.js';
import { EYE } from '../shared/game.js';
import type { WorldState } from '../shared/world.js';

/** One preview cell, singing glyph and beam; no terrain actors or extra lights. */
export class StoneSculpture {
  group = new THREE.Group(); target?: SculptTarget;
  private ghost = new THREE.Mesh(new THREE.BoxGeometry(1.008, 1.008, 1.008), new THREE.MeshBasicMaterial({ color: '#91eadb', transparent: true, opacity: .5, depthWrite: false, wireframe: true }));
  private glyph = new THREE.Group();
  private ring = new THREE.Mesh(new THREE.TorusGeometry(.22, .015, 4, 32), new THREE.MeshBasicMaterial({ color: '#b4fff0' }));
  private note = new THREE.Mesh(new THREE.OctahedronGeometry(.045), new THREE.MeshBasicMaterial({ color: '#fff1b6' }));
  private points = new Float32Array(6);
  private beam: THREE.Line;
  private previewAt = 0;
  constructor() {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(this.points, 3));
    this.beam = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#a1f6e9', transparent: true, opacity: .65 }));
    this.glyph.add(this.ring, this.note); this.group.add(this.ghost, this.glyph, this.beam); this.group.visible = false;
  }
  update(world: WorldState, p: (StoneSinger & { sculptCell?: number[]; sculptProgress?: number }) | undefined, time: number, reduced: boolean, active: boolean, mend: boolean, players: Parameters<typeof sculptTarget>[3] = [], allowMend = false) {
    this.group.visible = active && !!p && p.realm === 'wilds';
    if (!this.group.visible) { this.target = undefined; return; }
    if (time >= this.previewAt) { this.previewAt = time + .05; this.target = sculptTarget(p!, world, mend, players, allowMend); }
    const t = this.target; this.ghost.visible = this.glyph.visible = !!t; this.beam.visible = false;
    if (!t) return;
    const color = t.valid ? mend ? '#efc6a4' : t.stratum.vein === undefined ? '#a4f6e2' : t.stratum.color : '#ff9a91';
    this.ghost.position.set(t.x + .5, t.y + .5, t.z + .5); this.ghost.material.color.set(color); this.ring.material.color.set(color);
    const toward = new THREE.Vector3(p!.x - t.position.x, p!.y + EYE - t.position.y, p!.z - t.position.z).normalize();
    this.glyph.position.set(t.position.x, t.position.y, t.position.z).addScaledVector(toward, .11); this.glyph.lookAt(p!.x, p!.y + EYE, p!.z); this.glyph.rotateZ(reduced ? 0 : time * .8);
    const progress = p!.sculptProgress ?? 0; this.glyph.scale.setScalar(1 + progress / 200); this.note.position.set(reduced ? .22 : Math.cos(time * 4) * .22, reduced ? 0 : Math.sin(time * 4) * .22, .02);
    if (t.valid && progress > 0 && p!.sculptCell?.join() === [t.x, t.y, t.z].join()) {
      this.beam.visible = true; this.points.set([p!.x + Math.cos(p!.yaw) * .22, p!.y + 1.16, p!.z - Math.sin(p!.yaw) * .22, this.glyph.position.x, this.glyph.position.y, this.glyph.position.z]);
      this.beam.geometry.getAttribute('position').needsUpdate = true; this.beam.geometry.computeBoundingSphere();
    }
  }
}
