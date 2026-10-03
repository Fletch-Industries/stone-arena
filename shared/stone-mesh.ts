import { stoneKey, type TerrainEdits } from './excavation.js';
import { stratumAt } from './mining.js';
import { CHUNK_SIZE, terrainHeight } from './world.js';

export interface StoneMesh { positions: Float32Array; normals: Float32Array; colors: Float32Array; glow: Float32Array; uv: Float32Array; indices: Uint32Array }
interface Vertex { p: number[]; n: number[]; c: number[]; uv: number[]; glow?: number[] }
const EPS = 1e-6;
const mix = (a: number[], b: number[], t: number) => a.map((v, n) => v + (b[n] - v) * t);
function clip(poly: Vertex[], distance: (p: number[]) => number) {
  const result: Vertex[] = [];
  for (let n = 0; n < poly.length; n++) {
    const a = poly[n], b = poly[(n + 1) % poly.length], da = distance(a.p), db = distance(b.p);
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); result.push({ p: mix(a.p, b.p, t), n: mix(a.n, b.n, t), c: mix(a.c, b.c, t), uv: mix(a.uv, b.uv, t), glow: a.glow && b.glow ? mix(a.glow,b.glow,t) : undefined }); }
  }
  return result;
}
function columns(edits: TerrainEdits) {
  const result = new Map<string, number[]>();
  for (const [x, y, z] of edits.cuts) { const key = `${x},${z}`; if (!result.has(key)) result.set(key, []); result.get(key)!.push(y); }
  return result;
}
/** Clip only triangles whose original surface intersects a removed native cell. */
export function openTerrain<T extends { positions: Float32Array; normals: Float32Array; colors: Float32Array; uv: Float32Array; indices: Uint16Array }>(chunk: T, cx: number, cz: number, edits: TerrainEdits) {
  if (!edits.cuts.length) return;
  const cols = columns(edits), side = CHUNK_SIZE + 1, ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  const positions = Array.from(chunk.positions), normals = Array.from(chunk.normals), colors = Array.from(chunk.colors), uv = Array.from(chunk.uv), indices: number[] = [];
  const vertex = (n: number): Vertex => ({ p: positions.slice(n * 3, n * 3 + 3), n: normals.slice(n * 3, n * 3 + 3), c: colors.slice(n * 3, n * 3 + 3), uv: uv.slice(n * 2, n * 2 + 2) });
  for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) {
    const a = z * side + x, b = a + 1, c = a + side, d = c + 1, cuts = cols.get(`${ox + x},${oz + z}`);
    for (const triangle of [[a, c, b], [b, c, d]]) {
      const original = triangle.map(vertex), low = Math.min(...original.map(v => v.p[1])), high = Math.max(...original.map(v => v.p[1]));
      const intersect = cuts?.filter(y => high > y + EPS && low <= y + 1 + EPS);
      if (!intersect?.length) { indices.push(...triangle); continue; }
      let polygons = [original];
      for (const y of intersect) polygons = polygons.flatMap(poly => [clip(poly, p => y - p[1]), clip(poly, p => p[1] - y - 1 - EPS)]).filter(poly => poly.length >= 3);
      for (const poly of polygons) {
        const first = positions.length / 3;
        for (const v of poly) { positions.push(...v.p); normals.push(...v.n); colors.push(...v.c); uv.push(...v.uv); }
        for (let n = 1; n < poly.length - 1; n++) indices.push(first, first + n, first + n + 1);
      }
    }
  }
  chunk.positions = new Float32Array(positions); chunk.normals = new Float32Array(normals); chunk.colors = new Float32Array(colors); chunk.uv = new Float32Array(uv); chunk.indices = new Uint16Array(indices);
}
const rgb = (hex: string) => [1, 3, 5].map(n => parseInt(hex.slice(n, n + 2), 16) / 255);
class MeshWriter {
  positions: number[] = []; normals: number[] = []; colors: number[] = []; glow: number[] = []; uv: number[] = []; indices: number[] = [];
  constructor(private ox: number, private oz: number) {}
  polygon(poly: Vertex[]) {
    if (poly.length < 3) return;
    const first = this.positions.length / 3;
    for (const v of poly) { this.positions.push(v.p[0] - this.ox, v.p[1], v.p[2] - this.oz); this.normals.push(...v.n); this.colors.push(...v.c); this.glow.push(...(v.glow ?? [0,0,0])); this.uv.push(...v.uv); }
    for (let n = 1; n < poly.length - 1; n++) this.indices.push(first, first + n, first + n + 1);
  }
  finish(): StoneMesh | undefined { return this.indices.length ? { positions: new Float32Array(this.positions), normals: new Float32Array(this.normals), colors: new Float32Array(this.colors), glow: new Float32Array(this.glow), uv: new Float32Array(this.uv), indices: new Uint32Array(this.indices) } : undefined; }
}
/** Only exposed native faces are built. Adjacent openings never keep interior walls. */
export function buildStoneMesh(cx: number, cz: number, seed: number, edits: TerrainEdits): StoneMesh | undefined {
  if (!edits.cuts.length) return;
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE, holes = new Set(edits.cuts.map(c => stoneKey(...c))), spent = new Set(edits.veins.map(c => stoneKey(...c))), writer = new MeshWriter(ox, oz);
  for (const [x, y, z] of edits.cuts) {
    if (x < ox || x >= ox + CHUNK_SIZE || z < oz || z >= oz + CHUNK_SIZE) continue;
    const faces = [
      { offset: [1, 0, 0], normal: [-1, 0, 0], points: [[x + 1, y, z], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z]] },
      { offset: [-1, 0, 0], normal: [1, 0, 0], points: [[x, y, z + 1], [x, y, z], [x, y + 1, z], [x, y + 1, z + 1]] },
      { offset: [0, 0, 1], normal: [0, 0, -1], points: [[x + 1, y, z + 1], [x, y, z + 1], [x, y + 1, z + 1], [x + 1, y + 1, z + 1]] },
      { offset: [0, 0, -1], normal: [0, 0, 1], points: [[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]] },
      { offset: [0, -1, 0], normal: [0, 1, 0], points: [[x, y, z], [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z]] },
      { offset: [0, 1, 0], normal: [0, -1, 0], points: [[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]] },
    ];
    for (const face of faces) {
      const [dx, dy, dz] = face.offset, nx = x + dx, ny = y + dy, nz = z + dz;
      if (holes.has(stoneKey(nx, ny, nz))) continue;
      const stratum = stratumAt(nx, ny, nz, seed), color = rgb(stratum.vein !== undefined && spent.has(stoneKey(nx, ny, nz)) ? '#818eaa' : stratum.color), shade = face.normal[1] > 0 ? .95 : face.normal[1] < 0 ? .6 : .79;
      const glow = stratum.vein !== undefined && !spent.has(stoneKey(nx,ny,nz)) ? color.map(v=>v*.2) : [0,0,0];
      const poly = face.points.map(p => ({ p, n: face.normal, c: color.map(v => v * shade), glow, uv: face.normal[0] ? [p[2], p[1]] : face.normal[2] ? [p[0], p[1]] : [p[0], p[2]] }));
      // Horizontal faces straddle the height-field diagonal; keep its exact triangles.
      const polygons = face.normal[1] ? [[poly[0], poly[1], poly[3]], [poly[3], poly[1], poly[2]]] : [poly];
      for (const triangle of polygons) writer.polygon(clip(triangle, p => terrainHeight(p[0], p[2], seed) - p[1] - EPS));
    }
  }
  return writer.finish();
}
/** A river plane never stretches through an excavated hill or cave. */
export function buildRiverMesh(cx: number, cz: number, seed: number): StoneMesh | undefined {
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE, writer = new MeshWriter(ox, oz);
  for (let z = oz; z < oz + CHUNK_SIZE; z++) for (let x = ox; x < ox + CHUNK_SIZE; x++) {
    const points = [[x, .65, z], [x, .65, z + 1], [x + 1, .65, z], [x + 1, .65, z + 1]];
    const poly = points.map(p => ({ p, n: [0, 1, 0], c: [1, 1, 1], uv: [p[0] / 3, p[2] / 3] }));
    for (const triangle of [[poly[0], poly[1], poly[2]], [poly[2], poly[1], poly[3]]]) writer.polygon(clip(triangle, p => .65 - terrainHeight(p[0], p[2], seed)));
  }
  return writer.finish();
}
export function editedSurface(x: number, z: number, seed: number, edits: TerrainEdits) {
  const column = new Set(edits.cuts.filter(c => c[0] === Math.floor(x) && c[2] === Math.floor(z)).map(c => c[1]));
  let floor = terrainHeight(x, z, seed); for (let cell = Math.ceil(floor - EPS) - 1; column.has(cell); cell--) floor = cell;
  return floor;
}
