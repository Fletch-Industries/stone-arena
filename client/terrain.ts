import * as THREE from 'three';
import { CHUNK_SIZE, chunkRadius, wantedChunks } from '../shared/world.js';
import { buildTerrainChunk, type TerrainChunk } from '../shared/terrain-mesh.js';
/** One worker request and one mesh upload at a time; no unbounded cache or queue. */
export class TerrainStreamer {
  group = new THREE.Group(); chunks = new Map<string, THREE.Group>();
  worker?: Worker; busy = false; epoch = 0; seed = -1; center = ''; wanted = new Set<string>();
  queue: { x: number; z: number; key: string }[] = []; ready?: TerrainChunk;
  box = new THREE.BoxGeometry(1, 1, 1);
  grass = new THREE.MeshLambertMaterial({ vertexColors: true });
  bark = new THREE.MeshLambertMaterial({ color: '#755238' }); leaves = new THREE.MeshLambertMaterial({ color: '#548243' });
  water = new THREE.MeshLambertMaterial({ color: '#4387ab', transparent: true, opacity: .72 });
  constructor() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = 210 + (x * 7 + y * 13) % 40; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, 1, 1); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestMipmapLinearFilter; this.grass.map = texture;
    try {
      this.worker = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ epoch: number; chunk: TerrainChunk }>) => { this.busy = false; if (e.data.epoch === this.epoch && this.wanted.has(e.data.chunk.key) && this.group.visible) this.ready = e.data.chunk; };
      this.worker.onerror = () => { this.worker?.terminate(); this.worker = undefined; this.busy = false; this.center = ''; };
    } catch { /* Older browsers use one small chunk per frame instead. */ }
    this.group.visible = false;
  }
  forget(key: string) {
    const group = this.chunks.get(key); if (!group) return;
    group.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); if (o instanceof THREE.Mesh && o.geometry !== this.box) o.geometry.dispose(); });
    this.group.remove(group); this.chunks.delete(key);
  }
  clear() { this.epoch++; this.ready = undefined; for (const key of this.chunks.keys()) this.forget(key); this.queue = []; this.wanted.clear(); this.center = ''; }
  add(c: TerrainChunk) {
    const group = new THREE.Group(); group.position.set(c.cx * CHUNK_SIZE, 0, c.cz * CHUNK_SIZE);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(c.positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(c.normals, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(c.colors, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(c.uv, 2)); geometry.setIndex(new THREE.BufferAttribute(c.indices, 1)); geometry.computeBoundingSphere();
    group.add(new THREE.Mesh(geometry, this.grass));
    if (c.positions.some((y, i) => i % 3 === 1 && y < .65) && Math.hypot(c.cx, c.cz) > 1) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE), this.water); water.rotation.x = -Math.PI / 2; water.position.set(CHUNK_SIZE / 2, .65, CHUNK_SIZE / 2); group.add(water);
    }
    if (c.trees.length) {
      const trunks = new THREE.InstancedMesh(this.box, this.bark, c.trees.length), crowns = new THREE.InstancedMesh(this.box, this.leaves, c.trees.length), matrix = new THREE.Matrix4();
      c.trees.forEach((t, i) => {
        const x = t.x - c.cx * CHUNK_SIZE, z = t.z - c.cz * CHUNK_SIZE;
        matrix.makeScale(.7, t.height, .7); matrix.setPosition(x, t.y + t.height / 2, z); trunks.setMatrixAt(i, matrix);
        matrix.makeScale(4, 3, 4); matrix.setPosition(x, t.y + t.height + .5, z); crowns.setMatrixAt(i, matrix); crowns.setColorAt(i, new THREE.Color().setScalar(.75 + t.shade * .35));
      }); group.add(trunks, crowns);
    }
    this.group.add(group); this.chunks.set(c.key, group);
  }
  update(x: number, z: number, seed: number, quality: string, visible: boolean) {
    if (!visible) { if (this.group.visible) this.clear(); this.group.visible = false; return; }
    this.group.visible = true;
    if (seed !== this.seed) { this.clear(); this.seed = seed; }
    const radius = chunkRadius(this.worker ? quality : 'low'), center = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}:${radius}`;
    if (center !== this.center) {
      this.center = center; const wanted = wantedChunks(x, z, radius); this.wanted = new Set(wanted.map(c => c.key));
      for (const key of this.chunks.keys()) if (!this.wanted.has(key)) this.forget(key);
      if (this.ready && !this.wanted.has(this.ready.key)) this.ready = undefined;
      this.queue = wanted.filter(c => !this.chunks.has(c.key));
    }
    if (this.ready) { if (this.wanted.has(this.ready.key) && !this.chunks.has(this.ready.key)) this.add(this.ready); this.ready = undefined; }
    if (!this.busy) {
      let next; while ((next = this.queue.shift()) && this.chunks.has(next.key)) { /* Skip previously completed jobs after a center change. */ }
      if (next) {
        if (this.worker) { this.busy = true; this.worker.postMessage({ cx: next.x, cz: next.z, seed, epoch: this.epoch }); }
        else this.ready = buildTerrainChunk(next.x, next.z, seed);
      }
    }
  }
}
