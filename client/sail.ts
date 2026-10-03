import * as THREE from 'three';
import { TextureLibrary } from './textures.js';

/** Original faceted kite wings. Every player and first-person tip shares assets. */
export class SkySails {
  private cloth: THREE.MeshLambertMaterial;
  private edge = new THREE.LineBasicMaterial({ color: '#8af9e5' });
  private crystal = new THREE.OctahedronGeometry(.12, 0);
  private glow = new THREE.MeshBasicMaterial({ color: '#d2fff1' });
  private wing = new THREE.BufferGeometry();
  private outline = new THREE.BufferGeometry();
  constructor(textures: TextureLibrary) {
    this.cloth = new THREE.MeshLambertMaterial({ color: '#b0c7f5', map: textures.get('cloth'), emissive: '#58638f', emissiveIntensity: .15, side: THREE.DoubleSide });
    const vertices = [0, 0, 0, 1.5, .18, .35, 1.2, -.12, -.35, .4, -.25, -.55, .12, -.08, -.22];
    this.wing.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.wing.setAttribute('uv', new THREE.Float32BufferAttribute([0, .5, 1, 1, .8, .2, .25, 0, .08, .3], 2));
    this.wing.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]); this.wing.computeVertexNormals();
    const line: number[] = []; for (let n = 0; n < 5; n++) { line.push(...vertices.slice(n * 3, n * 3 + 3), ...vertices.slice((n + 1) % 5 * 3, (n + 1) % 5 * 3 + 3)); }
    this.outline.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  }
  make() {
    const root = new THREE.Group(); root.name = 'sky-sail';
    for (const side of [-1, 1]) { const wing = new THREE.Group(); wing.name = side < 0 ? 'left-wing' : 'right-wing'; wing.scale.x = side; wing.add(new THREE.Mesh(this.wing, this.cloth), new THREE.LineSegments(this.outline, this.edge)); root.add(wing); }
    const crystal = new THREE.Mesh(this.crystal, this.glow); crystal.scale.set(.7, 1.2, .7); root.add(crystal); return root;
  }
  animate(root: THREE.Group, time: number, reduced: boolean) {
    const flex = reduced ? 0 : Math.sin(time * 3) * .035;
    root.getObjectByName('left-wing')!.rotation.z = -.08 - flex; root.getObjectByName('right-wing')!.rotation.z = .08 + flex;
  }
}
