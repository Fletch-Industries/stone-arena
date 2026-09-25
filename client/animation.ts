/** Original procedural poses: distance-driven limbs, no walk cycle while airborne. */
export function locomotionPose(distance: number, speed: number, grounded: boolean, sprinting: boolean, vy: number) {
  const amplitude = Math.min(1, speed / 4.317) * (sprinting ? 1 : .65);
  const stride = Math.sin(distance * 2.5) * amplitude;
  return grounded
    ? { leftLeg: stride, rightLeg: -stride, leftArm: -stride, rightArm: stride, lean: sprinting ? -.09 : 0 }
    : { leftLeg: -.25, rightLeg: .25, leftArm: vy > 0 ? -.45 : -.2, rightArm: vy > 0 ? -.45 : -.2, lean: 0 };
}
