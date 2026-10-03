import * as THREE from 'three';

// Original stepped silhouettes, shared by all held items; no imported game assets.
function pixelShape(points: number[][], depth: number) {
  const shape = new THREE.Shape(); points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.translate(0, 0, -depth / 2); return geometry;
}
export const swordBlade = () => pixelShape([[-.11,.23],[.11,.23],[.11,.89],[.07,.89],[.07,1.01],[.03,1.01],[.03,1.09],[-.03,1.09],[-.03,1.01],[-.07,1.01],[-.07,.89],[-.11,.89]], .075);
export const appleBody = () => pixelShape([[-.12,-.13],[.12,-.13],[.12,-.09],[.2,-.09],[.2,-.01],[.24,-.01],[.24,.23],[.2,.23],[.2,.3],[.08,.3],[.08,.26],[-.04,.26],[-.04,.3],[-.16,.3],[-.16,.26],[-.24,.26],[-.24,.02],[-.2,.02],[-.2,-.07],[-.12,-.07]], .19);
export const totemBody = () => pixelShape([[-.06,-.16],[.06,-.16],[.06,-.05],[.14,-.05],[.14,.07],[.3,.07],[.3,.16],[.14,.16],[.14,.34],[.08,.34],[.08,.4],[-.08,.4],[-.08,.34],[-.14,.34],[-.14,.16],[-.3,.16],[-.3,.07],[-.14,.07],[-.14,-.05],[-.06,-.05]], .09);
