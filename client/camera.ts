import { BOXES, segmentBox } from '../shared/game.js';

export const PERSPECTIVES = ['first', 'rear', 'front'] as const;
export type Perspective = typeof PERSPECTIVES[number];
export const PERSPECTIVE_LABELS: Record<Perspective, string> = { first: 'First person', rear: 'Third person · rear', front: 'Third person · front' };
export const validPerspective = (value: unknown): value is Perspective => PERSPECTIVES.includes(value as Perspective);
export const nextPerspective = (view: Perspective): Perspective => PERSPECTIVES[(PERSPECTIVES.indexOf(view) + 1) % PERSPECTIVES.length];
type Point = { x: number; y: number; z: number };
// Include the cover caps and lantern cages, not only the player collision boxes.
const obstacles = [
  ...BOXES.map(b => ({ min: [b.x - b.w / 2 - .04, 0, b.z - b.d / 2 - .04], max: [b.x + b.w / 2 + .04, b.h, b.z + b.d / 2 + .04] })),
  ...[-14, 14].flatMap(x => [-14, 14].map(z => ({ min: [x - .29, 0, z - .29], max: [x + .29, 2.8, z + .29] }))),
];
/** Retract the camera boom before its near plane enters cover, floor or walls. */
export function clipCamera(origin: Point, desired: Point, radius = .22): Point {
  let fraction = 1;
  for (const box of obstacles) fraction = Math.min(fraction, segmentBox(origin, desired, box.min.map(n => n - radius), box.max.map(n => n + radius)));
  for (const axis of ['x', 'z'] as const) {
    const delta = desired[axis] - origin[axis];
    if (delta > 0) fraction = Math.min(fraction, (16 - radius - origin[axis]) / delta);
    if (delta < 0) fraction = Math.min(fraction, (-16 + radius - origin[axis]) / delta);
  }
  if (desired.y < radius) fraction = Math.min(fraction, (origin.y - radius) / (origin.y - desired.y));
  const length = Math.hypot(desired.x - origin.x, desired.y - origin.y, desired.z - origin.z);
  fraction = Math.max(0, Math.min(1, fraction - (fraction < 1 ? .015 / Math.max(.001, length) : 0)));
  return { x: origin.x + (desired.x - origin.x) * fraction, y: origin.y + (desired.y - origin.y) * fraction, z: origin.z + (desired.z - origin.z) * fraction };
}
/** The camera moves; aim remains the player's eye ray in every perspective. */
export function thirdPersonCamera(eye: Point, yaw: number, pitch: number, view: 'rear' | 'front', radius = .22) {
  const sign = view === 'rear' ? 1 : -1, distance = 4;
  const position = clipCamera(eye, {
    x: eye.x + Math.sin(yaw) * Math.cos(pitch) * distance * sign,
    y: eye.y - Math.sin(pitch) * distance * sign,
    z: eye.z + Math.cos(yaw) * Math.cos(pitch) * distance * sign,
  }, radius);
  return { position, yaw: view === 'front' ? yaw + Math.PI : yaw, pitch: view === 'front' ? -pitch : pitch, distance: Math.hypot(position.x - eye.x, position.y - eye.y, position.z - eye.z) };
}
