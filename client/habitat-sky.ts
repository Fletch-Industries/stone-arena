import { biomeBlend } from '../shared/biomes.js';

// Linear RGB: horizon then zenith. Original Citadel sky stays unchanged.
export const ARENA_SKY = [.72, .83, .83, .12, .35, .58] as const;
const HABITAT_SKIES = [
  [.58, .72, .64, .10, .23, .43], // Verdant Reach: soft green haze, blue sky
  [.58, .48, .70, .16, .10, .37], // Moonwood: lilac haze, violet sky
  [.82, .60, .36, .43, .18, .15], // Emberfields: amber haze, warm rose sky
  [.40, .71, .73, .04, .27, .36], // Tideglade: sea mist, teal sky
] as const;

export function sampleHabitatSky(x: number, z: number, seed: number, out: Float64Array) {
  const weights = biomeBlend(x, z, seed);
  out.fill(0);
  for (let n = 0; n < 4; n++) for (let c = 0; c < 6; c++) out[c] += HABITAT_SKIES[n][c] * weights[n];
}

/** Five habitat samples per second; fixed color buffers and frame-independent easing. */
export class HabitatSky {
  current = new Float64Array(ARENA_SKY);
  target = new Float64Array(ARENA_SKY);
  private sampleIn = 0;
  private seed?: number;
  update(dt: number, wild: boolean, x: number, z: number, seed: number) {
    if (!wild) { this.current.set(ARENA_SKY); this.target.set(ARENA_SKY); this.seed = undefined; this.sampleIn = 0; return 0; }
    this.sampleIn -= dt;
    if (this.seed !== seed || this.sampleIn <= 0) {
      sampleHabitatSky(x, z, seed, this.target); this.seed = seed; this.sampleIn = .2;
    }
    const alpha = 1 - Math.exp(-Math.max(0, dt) * 1.5);
    for (let c = 0; c < 6; c++) this.current[c] += (this.target[c] - this.current[c]) * alpha;
    return alpha;
  }
}
