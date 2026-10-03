import { buildHorizon } from '../shared/horizon.js';
import { BIOMES } from '../shared/biomes.js';
import { TextureLibrary } from './textures.js';
import * as THREE from 'three';
import { CHUNK_SIZE, chunkRadius, wantedChunks } from '../shared/world.js';
import { buildTerrainChunk, type TerrainChunk } from '../shared/terrain-mesh.js';
/** One worker request and one mesh upload at a time; no unbounded cache or queue. */
export class TerrainStreamer {
  horizon?: THREE.Group; horizonKey = ''; horizonReady?: TerrainChunk; time = { value: 0 };
  group = new THREE.Group(); chunks = new Map<string, THREE.Group>();
  worker?: Worker; busy = false; epoch = 0; seed = -1; center = ''; wanted = new Set<string>();
  queue: { x: number; z: number; key: string }[] = []; ready?: TerrainChunk;
  quality = 'medium';
  box = new THREE.BoxGeometry(1, 1, 1);
  grass = new THREE.MeshLambertMaterial({ vertexColors: true });
  bark = new THREE.MeshLambertMaterial({ color: '#755238' }); leaves = new THREE.MeshLambertMaterial({ color: '#ffffff' }); canopy = new THREE.IcosahedronGeometry(.65, 0);
  spire = new THREE.ConeGeometry(1, 1, 5); blossom = blossomGeometry(); flowers = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  water = new THREE.MeshPhongMaterial({ color: '#318da7', specular:'#9fdbeb', shininess:95, transparent:true, opacity:.8 });
  constructor() {
    const textures = new TextureLibrary(); this.grass.map = textures.get('grass'); this.grass.normalMap=textures.normal('grass');this.grass.normalScale.set(.14,.14); this.bark.map = textures.get('bark'); this.leaves.map = textures.get('leaves');
    this.leaves.onBeforeCompile = shader => { shader.uniforms.windTime = this.time; shader.vertexShader = 'uniform float windTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      transformed.x += sin(windTime * .8 + instanceMatrix[3].x * .18 + instanceMatrix[3].z * .12) * .018 * (position.y + .65);
      #endif`); }; this.leaves.customProgramCacheKey = () => 'stone-leaf-wind-v1';
    this.water.onBeforeCompile=shader=>{shader.uniforms.windTime=this.time;shader.vertexShader='uniform float windTime;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n transformed += normal * sin(position.x*.3+position.y*.24+windTime*.8)*.025;');};this.water.customProgramCacheKey=()=> 'stone-water-ripple-v1';
    this.flowers.onBeforeCompile = shader => { shader.uniforms.windTime = this.time; shader.vertexShader = 'uniform float windTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.x += sin(windTime * 1.2 + instanceMatrix[3].x * .7 + instanceMatrix[3].z * .3) * position.y * .1;'); };
    this.flowers.customProgramCacheKey = () => 'stone-blossom-wind-v1';
    try {
      this.worker = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ epoch: number; chunk: TerrainChunk; horizon?: string }>) => { this.busy = false; if (e.data.epoch !== this.epoch || !this.group.visible) return; if (e.data.horizon) { if (e.data.horizon === this.center) { this.horizonReady = e.data.chunk; this.horizonKey = e.data.horizon; } } else if (this.wanted.has(e.data.chunk.key)) this.ready = e.data.chunk; };
      this.worker.onerror = () => { this.worker?.terminate(); this.worker = undefined; this.busy = false; this.center = ''; };
    } catch { /* Older browsers use one small chunk per frame instead. */ }
    this.group.visible = false;
  }
  dispose(group: THREE.Group) { group.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); if (o instanceof THREE.Mesh && ![this.box, this.canopy, this.spire, this.blossom].includes(o.geometry)) o.geometry.dispose(); }); this.group.remove(group); }
  forget(key: string) {
    const group = this.chunks.get(key); if (!group) return;
    this.dispose(group); this.chunks.delete(key);
  }
  clear() { this.epoch++; this.ready = undefined; for (const key of this.chunks.keys()) this.forget(key); this.queue = []; this.wanted.clear(); this.center = ''; this.horizonReady = undefined; this.horizonKey = ''; if (this.horizon) this.dispose(this.horizon); this.horizon = undefined; }
  add(c: TerrainChunk) {
    const group = new THREE.Group(); group.position.set(c.cx * CHUNK_SIZE, 0, c.cz * CHUNK_SIZE);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(c.positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(c.normals, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(c.colors, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(c.uv, 2)); geometry.setIndex(new THREE.BufferAttribute(c.indices, 1)); geometry.computeBoundingSphere();
    group.add(new THREE.Mesh(geometry, this.grass));
    if (c.key !== 'horizon' && c.positions.some((y, i) => i % 3 === 1 && y < .65) && Math.hypot(c.cx, c.cz) > 1) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE), this.water); water.rotation.x = -Math.PI / 2; water.position.set(CHUNK_SIZE / 2, .65, CHUNK_SIZE / 2); group.add(water);
    }
    if(c.key==='horizon'){const pos=new Float32Array(c.positions);for(let i=1;i<pos.length;i+=3)pos[i]=.65;const waterGeometry=new THREE.BufferGeometry();waterGeometry.setAttribute('position',new THREE.BufferAttribute(pos,3));waterGeometry.setIndex(new THREE.BufferAttribute(new Uint16Array(c.indices),1));waterGeometry.computeVertexNormals();waterGeometry.computeBoundingSphere();group.add(new THREE.Mesh(waterGeometry,this.water));}
    if (c.trees.length) {
      const trunks = new THREE.InstancedMesh(this.box, this.bark, c.trees.length), matrix = new THREE.Matrix4();
      c.trees.forEach((t, i) => {
        const x = t.x - c.cx * CHUNK_SIZE, z = t.z - c.cz * CHUNK_SIZE;
        matrix.makeScale(.7, t.height, .7); matrix.setPosition(x, t.y + t.height / 2, z); trunks.setMatrixAt(i, matrix);
      }); group.add(trunks);
      for (const pointed of [false, true]) {
        const trees = c.trees.filter(t => (t.biome === 'moonwood') === pointed), layers = c.key === 'horizon' ? 1 : 2;
        if (!trees.length) continue;
        const crowns = new THREE.InstancedMesh(pointed ? this.spire : this.canopy, this.leaves, trees.length * layers);
        trees.forEach((t, i) => { for (let n = 0; n < layers; n++) {
          if (pointed) matrix.makeScale(n ? 1.4 : 2, n ? 2.2 : 3.3, n ? 1.4 : 2);
          else matrix.makeScale(n ? 2.2 : 3, n ? 1.8 : 2.4, n ? 2.2 : 3);
          matrix.setPosition(t.x - c.cx * CHUNK_SIZE, t.y + t.height + (pointed ? n ? 1.6 : .65 : n ? 1.4 : .25), t.z - c.cz * CHUNK_SIZE);
          crowns.setMatrixAt(i * layers + n, matrix); crowns.setColorAt(i * layers + n, new THREE.Color(BIOMES[t.biome].leaves).multiplyScalar(.82 + t.shade * .25));
        } }); group.add(crowns);
      }
    }
    const plants = this.quality === 'low' ? c.plants.filter((_, n) => n % 2 === 0) : c.plants;
    if (plants.length) {
      const flowers = new THREE.InstancedMesh(this.blossom, this.flowers, plants.length), matrix = new THREE.Matrix4();
      plants.forEach((p,n) => { matrix.makeRotationY(p.x + p.z); matrix.scale(new THREE.Vector3(p.size,p.size,p.size)); matrix.setPosition(p.x - c.cx * CHUNK_SIZE,p.y,p.z - c.cz * CHUNK_SIZE); flowers.setMatrixAt(n,matrix); flowers.setColorAt(n,new THREE.Color(BIOMES[p.biome].flower)); });
      group.add(flowers);
    }
    this.group.add(group); if (c.key === 'horizon') { if (this.horizon) this.dispose(this.horizon); this.horizon = group; } else this.chunks.set(c.key, group);
  }
  update(x: number, z: number, seed: number, quality: string, visible: boolean) {
    if (!visible) { if (this.group.visible) this.clear(); this.group.visible = false; return; }
    this.group.visible = true;
    const detail = this.worker ? quality : 'low';
    if (this.quality !== detail) { this.clear(); this.quality = detail; }
    if (seed !== this.seed) { this.clear(); this.seed = seed; }
    const radius = chunkRadius(this.worker ? quality : 'low'), center = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}:${radius}`;
    if (center !== this.center) {
      this.center = center; const wanted = wantedChunks(x, z, radius); this.wanted = new Set(wanted.map(c => c.key));
      for (const key of this.chunks.keys()) if (!this.wanted.has(key)) this.forget(key);
      if (this.ready && !this.wanted.has(this.ready.key)) this.ready = undefined;
      this.queue = wanted.filter(c => !this.chunks.has(c.key));
    }
    if (this.horizonReady) { this.add(this.horizonReady); this.horizonReady = undefined; }
    else if (this.ready) { if (this.wanted.has(this.ready.key) && !this.chunks.has(this.ready.key)) this.add(this.ready); this.ready = undefined; }
    if (!this.busy) {
      let next; while ((next = this.queue.shift()) && this.chunks.has(next.key)) { /* Skip previously completed jobs after a center change. */ }
      if (next) {
        if (this.worker) { this.busy = true; this.worker.postMessage({ cx: next.x, cz: next.z, seed, epoch: this.epoch }); }
        else this.ready = buildTerrainChunk(next.x, next.z, seed);
      } else if (this.horizonKey !== this.center && !this.ready && !this.horizonReady) {
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        if (this.worker) { this.busy = true; this.worker.postMessage({ cx, cz, seed, epoch: this.epoch, radius, quality, horizon: this.center }); }
        else { this.horizonReady = buildHorizon(cx, cz, seed, radius, 'low'); this.horizonKey = this.center; }
      }
    }
  }
}
function blossomGeometry() {
  const points: number[] = [];
  for (const a of [0, Math.PI / 2]) {
    const vertices = [[-.035,0],[.035,0],[.025,.4],[-.025,.4],[-.22,.47],[0,.72],[.22,.47],[0,.34]];
    for (const i of [0,1,2,0,2,3,4,5,6,4,6,7]) { const [x,y] = vertices[i]; points.push(x * Math.cos(a), y, x * Math.sin(a)); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3)); geometry.computeVertexNormals(); return geometry;
}
