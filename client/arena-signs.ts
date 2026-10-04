import * as THREE from 'three';

/** Eight existing place signs share a bounded screen layout; no DOM or render pass. */
export class ArenaSigns {
  private entries: { sprite: THREE.Sprite; aspect: number; order: number; distance: number; x: number; y: number; w: number; h: number }[] = [];
  private accepted: typeof this.entries = [];
  private point = new THREE.Vector3();
  private eye = new THREE.Vector3();

  add(sprite: THREE.Sprite) {
    this.entries.push({ sprite, aspect: sprite.scale.x / sprite.scale.y, order: this.entries.length, distance: 0, x: 0, y: 0, w: 0, h: 0 });
    sprite.material.depthWrite = false;
  }

  update(camera: THREE.PerspectiveCamera, width: number, height: number) {
    camera.updateMatrixWorld(); camera.getWorldPosition(this.eye);
    this.accepted.length = 0;
    for (const entry of this.entries) {
      const sign = entry.sprite; sign.visible = false;
      sign.getWorldPosition(this.point); entry.distance = this.point.distanceTo(this.eye);
      this.point.applyMatrix4(camera.matrixWorldInverse);
      const depth = -this.point.z;
      if (entry.distance >= 40 || depth <= camera.near) continue;
      this.point.applyMatrix4(camera.projectionMatrix);
      if (this.point.z < -1 || this.point.z > 1) continue;
      entry.h = 32; entry.w = entry.h * entry.aspect;
      entry.x = (this.point.x + 1) * width / 2 - entry.w / 2;
      entry.y = (1 - this.point.y) * height / 2 - entry.h / 2;
      if (entry.x < 8 || entry.y < 8 || entry.x + entry.w > width - 8 || entry.y + entry.h > height - 8) continue;
      const scale = entry.h * 2 * depth / (height * camera.projectionMatrix.elements[5]);
      sign.scale.set(scale * entry.aspect, scale, 1);
      const fade = THREE.MathUtils.smoothstep(entry.distance, 28, 40);
      sign.material.opacity = 1 - fade;
      if (sign.material.opacity > .02) this.accepted.push(entry);
    }
    this.accepted.sort((a, b) => a.distance - b.distance || a.order - b.order);
    for (let n = 0; n < this.accepted.length; n++) {
      const entry = this.accepted[n];
      let crowded = false;
      for (let i = 0; i < n; i++) {
        const other = this.accepted[i];
        if (other.sprite.visible && entry.x < other.x + other.w + 8 && entry.x + entry.w + 8 > other.x && entry.y < other.y + other.h + 8 && entry.y + entry.h + 8 > other.y) { crowded = true; break; }
      }
      entry.sprite.visible = !crowded;
    }
  }
}
