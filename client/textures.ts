import * as THREE from 'three';

export type Surface = 'stone' | 'brick' | 'cobble' | 'paving' | 'wood' | 'metal' | 'cloth' | 'grass' | 'bark' | 'leaves' | 'rune' | 'wind-rune' | 'hearth-rune';
/** Original seamless pixel maps. No downloaded textures or game assets. */
export class TextureLibrary {
  private maps = new Map<Surface, THREE.CanvasTexture>();
  private normals = new Map<Surface, THREE.CanvasTexture>();
  get(surface: Surface) {
    if (!this.maps.has(surface)) this.make(surface);
    return this.maps.get(surface)!;
  }
  normal(surface: Surface) {
    if (!this.normals.has(surface)) this.make(surface);
    return this.normals.get(surface)!;
  }
  private make(surface: Surface) {
    const size = 32, heights: number[] = [], colors: number[][] = [];
    const noise = (x: number, y: number, seed = 0) => {
      let n = Math.imul((x & 31) + 1, 374761393) ^ Math.imul((y & 31) + 1, 668265263) ^ Math.imul(seed + 1, 1274126177);
      n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    };
    const cells = Array.from({ length: 16 }, (_, n) => ({ x: n % 4 * 8 + 2 + noise(n, 1) * 4, y: Math.floor(n / 4) * 8 + 2 + noise(n, 2) * 4 }));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fine = Math.floor(noise(x, y, 3) * 5) * 2 - 4;
      const coarse = Math.floor(noise(Math.floor(x / 3), Math.floor(y / 3), 9) * 5) * 3 - 6;
      let v = 150 + fine + coarse, h = .7, rgb = [v, v + 1, v + 2];
      if (surface === 'rune' || surface === 'wind-rune' || surface === 'hearth-rune') {
        const edge = x < 2 || y < 2 || x > 29 || y > 29;
        const diamond = Math.abs(Math.abs(x - 15.5) + Math.abs(y - 15.5) - 8) < 1.25;
        const corner = Math.abs(x - 15.5) < 1 && (y < 8 || y > 23) || Math.abs(y - 15.5) < 1 && (x < 8 || x > 23);
        const arrow = y >= 9 && y <= 23 && Math.abs(x - 15.5) < 1.5 || y >= 7 && y < 14 && Math.abs(Math.abs(x - 15.5) - (y - 7)) < 1.5;
        const heart = y >= 10 && y <= 22 && Math.abs(x - 15.5) < (y < 14 ? 6 : (24 - y) * .55) && !(y < 12 && Math.abs(x - 15.5) < 1.5);
        const mark = surface === 'hearth-rune' ? heart : surface === 'wind-rune' ? arrow : diamond || corner;
        v = edge ? 91 : mark ? 238 : 156 + fine + coarse * .4;
        rgb = [v, v, v]; h = edge ? .25 : mark ? .85 : .65;
      } else if (surface === 'paving') {
        const row = Math.floor(y / 16), xx = (x + row * 8) % 16, yy = y % 16;
        const seam = xx === 0 || yy === 0, bevel = xx === 1 || yy === 1;
        const slab = noise(Math.floor((x + row * 8) / 16), row, 57);
        v = (seam ? 86 : 125 + slab * 16 + (bevel ? 7 : 0)) + fine * .3 + coarse * .3;
        rgb = [v * .87, v * .96, v]; h = seam ? .3 : bevel ? .8 : .7;
      } else if (surface === 'brick') {
        const row = Math.floor(y / 8), xx = (x + (row % 2) * 8) % 16, yy = y % 8;
        const seam = xx === 0 || yy === 0, edge = xx === 1 || yy === 1;
        v = seam ? 104 + fine : 153 + fine + coarse + (edge ? 13 : xx === 15 || yy === 7 ? -10 : 0);
        rgb = [v, v + 2, v + 3]; h = seam ? .15 : edge ? .9 : .72;
      } else if (surface === 'cobble') {
        const nearest = cells.map((c, id) => { const dx = Math.min(Math.abs(x - c.x), size - Math.abs(x - c.x)), dy = Math.min(Math.abs(y - c.y), size - Math.abs(y - c.y)); return { id, d: dx * dx + dy * dy }; }).sort((a, b) => a.d - b.d);
        const gap = nearest[1].d - nearest[0].d, edge = gap < 6;
        v = edge ? 94 + fine : 139 + Math.floor(noise(nearest[0].id, 5) * 6) * 5 + fine + (gap < 16 ? 13 : 0);
        rgb = [v, v + 2, v + 4]; h = edge ? .1 : Math.min(.9, .55 + gap / 100);
      } else if (surface === 'wood') {
        const seam = x % 8 === 0 || (y + Math.floor(x / 8) * 9) % 32 === 0;
        const grain = Math.floor(noise(x, Math.floor(y / 6), 7) * 5) * 5;
        v = seam ? 65 : 150 + grain + fine;
        rgb = [v, v * .74, v * .43]; h = seam ? .15 : .6 + grain / 100;
      } else if (surface === 'metal') {
        v = 190 + fine + (x < 2 || y < 2 ? 25 : x > 29 || y > 29 ? -30 : 0);
        rgb = [v - 8, v, v + 4]; h = .7;
      } else if (surface === 'grass') {
        const blade = noise(x, y, 19) > .83 && y % 4 < 2, patch = noise(Math.floor(x / 8), Math.floor(y / 8), 31);
        v = 174 + fine + coarse + (blade ? 17 : 0) + patch * 22; rgb = [v * .9, v, v * .87]; h = .5 + noise(x, y, 8) * .1;
      } else if (surface === 'bark') {
        const grain = Math.sin(x * 1.6 + noise(x, Math.floor(y / 8), 51) * 2);
        v = 166 + grain * 26 + fine; rgb = [v, v * .76, v * .53]; h = .5 + grain * .14;
      } else if (surface === 'leaves') {
        const vein = (x + y * 2) % 7 === 0; v = 183 + fine + coarse + (vein ? 25 : 0); rgb = [v * .85, v, v * .87]; h = .5;
      } else if (surface === 'cloth') {
        v = 226 + (x % 2 === y % 2 ? 9 : -7) + fine;
        rgb = [v, v, v]; h = .5;
      }
      heights.push(h); colors.push(rgb);
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(size, size);
    colors.forEach((rgb, n) => { for (let c = 0; c < 3; c++) pixels.data[n * 4 + c] = Math.max(0, Math.min(255, rgb[c])); pixels.data[n * 4 + 3] = 255; });
    ctx.putImageData(pixels, 0, 0);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestMipmapLinearFilter;
    map.wrapS = map.wrapT = THREE.RepeatWrapping; this.maps.set(surface, map);
    const normalCanvas = document.createElement('canvas'); normalCanvas.width = normalCanvas.height = size;
    const ng = normalCanvas.getContext('2d')!, np = ng.createImageData(size, size);
    const height = (x: number, y: number) => heights[(y & 31) * size + (x & 31)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const n = new THREE.Vector3((height(x - 1, y) - height(x + 1, y)) * .6, (height(x, y + 1) - height(x, y - 1)) * .6, 1).normalize();
      const offset = (y * size + x) * 4;
      np.data[offset] = (n.x * .5 + .5) * 255; np.data[offset + 1] = (n.y * .5 + .5) * 255; np.data[offset + 2] = (n.z * .5 + .5) * 255; np.data[offset + 3] = 255;
    }
    ng.putImageData(np, 0, 0); const normal = new THREE.CanvasTexture(normalCanvas);
    normal.magFilter = THREE.NearestFilter; normal.minFilter = THREE.NearestMipmapLinearFilter; normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    this.normals.set(surface, normal);
  }
}
