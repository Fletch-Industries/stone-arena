import type { Body } from '../shared/game.js';

/** Flight remains flight even when Creative explorers skim a contact surface. */
export function isSailing(body: Pick<Body, 'flying' | 'glideTime'>) {
  return body.flying === true || (body.glideTime ?? 0) > 0;
}

/** Original procedural poses: distance-driven walking and a steady kite stance. */
export function locomotionPose(distance: number, speed: number, grounded: boolean, sprinting: boolean, vy: number, sailing = false) {
  if (sailing) return { leftLeg: -.2, rightLeg: -.12, leftArm: -.35, rightArm: -.35, lean: -.12 };
  const amplitude = Math.min(1, speed / 4.317) * (sprinting ? 1 : .65);
  const stride = Math.sin(distance * 2.5) * amplitude;
  return grounded
    ? { leftLeg: stride, rightLeg: -stride, leftArm: -stride, rightArm: stride, lean: sprinting ? -.09 : 0 }
    : { leftLeg: -.25, rightLeg: .25, leftArm: vy > 0 ? -.45 : -.2, rightArm: vy > 0 ? -.45 : -.2, lean: 0 };
}
