/** Small deterministic fields shared by terrain, habitats and room landmarks. */
export const hash = (x: number, z: number, seed: number) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967295;
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return mix(mix(hash(ix, iz, seed), hash(ix + 1, iz, seed), sx), mix(hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed), sx), sz);
}
