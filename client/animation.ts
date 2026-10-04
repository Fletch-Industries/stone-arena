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

/** A short elapsed-time transition; reduced motion selects the final stance. */
export function advancePoseBlend(amount: number, dt: number, reduced: boolean) {
  if (reduced || amount === 1) return 1;
  const next = 1 - (1 - amount) * Math.exp(-Math.max(0, dt) * 12);
  return 1 - next < .001 ? 1 : next;
}

/** Reuse the ordinary target pose, blending from the last displayed stance. */
export function blendLocomotionPose(from: ReturnType<typeof locomotionPose>, target: ReturnType<typeof locomotionPose>, amount: number) {
  if (amount === 1) return target;
  target.leftLeg = from.leftLeg + (target.leftLeg - from.leftLeg) * amount;
  target.rightLeg = from.rightLeg + (target.rightLeg - from.rightLeg) * amount;
  target.leftArm = from.leftArm + (target.leftArm - from.leftArm) * amount;
  target.rightArm = from.rightArm + (target.rightArm - from.rightArm) * amount;
  target.lean = from.lean + (target.lean - from.lean) * amount;
  return target;
}
