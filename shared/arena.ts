// One geometry source for rendering, movement, camera clipping and combat cover.
export interface Box { x: number; z: number; w: number; d: number; h: number; y?: number; surface?: 'brick' | 'stone' | 'wood' }
export const ARENA_SIZE = 96;
export const LIMIT = ARENA_SIZE / 2 - .35;
export const SPAWNS = [[-40, -40], [40, 40], [-40, 40], [40, -40], [0, -42], [0, 42], [-42, 0], [42, 0]];
export const BOXES: Box[] = [
  { x: 0, z: 0, w: 3, d: 3, h: 2.8 },
  ...[-1, 1].flatMap(x => [-1, 1].map(z => ({ x: x * 7, z: z * 7, w: 2, d: 2, h: 2.5 }))),
  { x: -9, z: 0, w: 3, d: 1, h: 1.15 }, { x: 9, z: 0, w: 3, d: 1, h: 1.15 },
  { x: -4, z: -9, w: 1, d: 3, h: 1.15 }, { x: 0, z: 9, w: 1, d: 3, h: 1.15 },
];
const block = (x: number, z: number, w: number, d: number, h: number, y = 0, surface: Box['surface'] = 'brick') => BOXES.push({ x, z, w, d, h, y, surface });

// Two chamber wings. Doorways on every side and staggered interior doors make
// connected hiding rooms rather than a single dead-end building.
for (const sign of [-1, 1]) {
  const cx = sign * 26, cz = sign * 26;
  for (const side of [-1, 1]) {
    for (const offset of [-5.5, 5.5]) {
      block(cx + offset, cz + side * 9, 7, 1, 4);
      block(cx + side * 9, cz + offset, 1, 7, 4);
    }
    block(cx, cz + side * 9, 4, 1, 1.4, 2.6);
    block(cx + side * 9, cz, 1, 4, 1.4, 2.6);
  }
  for (const side of [-1, 1]) {
    block(cx + side * 6, cz, 6, .8, 4);
    block(cx, cz + side * 6, .8, 6, 4);
    block(cx + side * 5.5, cz + side * 5.5, 2, 1.5, 1.1, 0, 'wood');
  }
  // Four roof sections leave a central skylight to orient players indoors.
  for (const dx of [-5, 5]) for (const dz of [-5, 5]) block(cx + dx, cz + dz, 8, 8, .4, 4, 'wood');
}

// Ruined gardens in the opposite corners: broken walls, alcoves and several
// entrances. The clear perimeter connects every spawn without forcing a duel.
for (const sign of [-1, 1]) {
  const cx = sign * 26, cz = -sign * 26;
  for (const offset of [-7, 7]) {
    block(cx + offset, cz, 1, 13, 2.8);
    block(cx, cz + offset, 9, 1, 2.8);
  }
  block(cx - 2, cz - 2, 1, 7, 2.6);
  block(cx + 3, cz + 3, 6, 1, 2.6);
  block(cx + 3, cz - 3, 2, 2, 1);
  block(cx - 3, cz + 4, 2, 2, 1);
}

// Roofed east/west tunnels north and south of the original courtyard. Side
// exits interrupt long sightlines and connect to the chamber wings and tower.
for (const z of [-17, 17]) {
  if (z < 0) for (const x of [-9.5, 9.5]) block(x, z, 15, 5, .6, 3.1, 'stone');
  else block(0, z, 34, 5, .6, 3.1, 'stone');
  for (const side of [-1, 1]) for (const [x, width] of [[-14, 6], [-6, 4], [6, 4], [14, 6]]) block(x, z + side * 2.5, width, .8, 3.1);
}

// A 7.2-block lookout, with an open stairwell and a walkable battlement deck.
// The .4-block risers use the same server/client step collision as ordinary movement.
for (let n = 0; n < 18; n++) block(0, -10.55 - n * 1.1, 3.6, 1.1, .4, n * .4, 'stone');
for (const n of [3, 7, 11, 15]) for (const x of [-1.55, 1.55]) block(x, -10.55 - n * 1.1, .35, .35, n * .4);
for (const x of [-4.2, 4.2]) block(x, -28, 3.6, 12, .4, 6.8, 'wood');
block(0, -31.5, 4.8, 5, .4, 6.8, 'wood');
for (const x of [-5.3, 5.3]) for (const z of [-33.3, -22.7]) block(x, z, 1.4, 1.4, 6.8);
block(0, -34, 12.8, .8, 1.05, 7.2);
for (const x of [-6, 6]) block(x, -28, .8, 12, 1.05, 7.2);
for (const x of [-4.2, 4.2]) block(x, -22, 3.6, .8, 1.05, 7.2);
for (const x of [-5, -2.5, 0, 2.5, 5]) block(x, -34, 1.2, .8, .65, 8.25);

// Scattered low cover breaks up the longer approaches without sealing routes.
for (const sign of [-1, 1]) {
  block(sign * 24, 0, 3, 3, 1.15);
  block(sign * 32, sign * 7, 2, 3, 1.15);
  block(sign * 12, sign * 31, 3, 2, 1.15);
}

export const LANDMARKS = [
  { name: 'Stone courtyard', x: 0, z: 0 },
  { name: 'West chambers', x: -26, z: -26 },
  { name: 'East chambers', x: 26, z: 26 },
  { name: 'West ruins', x: -26, z: 26 },
  { name: 'East ruins', x: 26, z: -26 },
  { name: 'Lookout tower', x: 0, z: -28 },
  { name: 'North tunnel', x: 0, z: -17 },
  { name: 'South tunnel', x: 0, z: 17 },
] as const;
export function arenaLocation(x: number, z: number, y: number) {
  if (Math.abs(x) < 7 && z < -21 && z > -35 && y > 5) return 'Lookout tower';
  if (Math.abs(x) < 17 && Math.abs(Math.abs(z) - 17) < 2.5 && y < 3.1) return z < 0 ? 'North tunnel' : 'South tunnel';
  if (Math.abs(x) > 36 || Math.abs(z) > 36) return 'Outer walk';
  return LANDMARKS.reduce((nearest, place) => Math.hypot(place.x - x, place.z - z) < Math.hypot(nearest.x - x, nearest.z - z) ? place : nearest).name;
}
