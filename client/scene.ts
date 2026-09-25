import * as THREE from 'three';
import { BOXES, COLORS, EYE, attackStrength, type Body, type GameEvent, type Player, type Snapshot, type Weapon } from '../shared/game.js';
import { locomotionPose } from './animation.js';

function stoneTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  let seed = 723; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  g.fillStyle = '#6b706d'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 32) for (let x = -32; x < 128; x += 64) { const v = 92 + rng() * 35; g.fillStyle = `rgb(${v},${v + 6},${v + 3})`; g.fillRect(x + (y % 64 ? 32 : 0) + 1, y + 1, 62, 30); }
  for (let n = 0; n < 1600; n++) { g.fillStyle = rng() > .5 ? '#ffffff0b' : '#00000012'; g.fillRect(rng() * 128, rng() * 128, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
export class ArenaScene {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(120, 1, .05, 130);
  avatars = new Map<string, THREE.Group>(); arrowMeshes = new Map<number, THREE.Mesh>(); weapon = new THREE.Group();
  materials = new Map<string, THREE.MeshLambertMaterial>(); boxGeo = new THREE.BoxGeometry(1, 1, 1);
  arrowGeo = new THREE.BoxGeometry(.055, .055, .7); lastWeapon = ''; swing = 0; time = 0; quality = 'medium';
  cameraDistance = 0; lastCamera = new THREE.Vector3(); cameraTracking = '';
  rigs = new Map<string, { head: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; tool: THREE.Group; toolName: string; distance: number; speed: number; swing: number; landed: number; grounded: boolean }>();
  frames = 0; fps = 60; fpsTime = 0; spectator = 0; reduced = false; renderScale = 1;
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#98b8bd'); this.scene.fog = new THREE.Fog('#98b8bd', 38, 95);
    this.scene.add(new THREE.HemisphereLight('#ffedcf', '#536875', 2.6));
    const sun = new THREE.DirectionalLight('#ffdfac', 2.3); sun.position.set(-15, 35, 10); this.scene.add(sun);
    const tex = stoneTexture(); const stone = new THREE.MeshLambertMaterial({ map: tex });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), new THREE.MeshLambertMaterial({ map: tex.clone(), color: '#adb1a3' }));
    floor.material.map!.repeat.set(16, 16); floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    // Repeated masonry is instanced: hundreds of blocks, two draw calls.
    const positions: number[][] = [];
    for (let y = 0; y < 6; y++) for (let x = -16; x <= 16; x += 2) { positions.push([x, y + .5, -16.5], [x, y + .5, 16.5], [-16.5, y + .5, x], [16.5, y + .5, x]); }
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1.98, .98, .98), stone, positions.length); const mat = new THREE.Matrix4();
    positions.forEach((p, i) => { mat.compose(new THREE.Vector3(...p as [number, number, number]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i % 4 >= 2 ? Math.PI / 2 : 0), new THREE.Vector3(1, 1, 1)); walls.setMatrixAt(i, mat); }); this.scene.add(walls);
    for (const b of BOXES) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), stone); mesh.position.set(b.x, b.h / 2, b.z); this.scene.add(mesh); this.box(this.scene, [b.w + .15, .15, b.d + .15], [b.x, b.h, b.z], '#c0b8a1'); }
    for (let x = -15; x <= 15; x += 3) for (const z of [-16.5, 16.5]) this.box(this.scene, [1.4, 1, 1.3], [x, 6.5, z], '#a8aaa0');
    for (let z = -15; z <= 15; z += 3) for (const x of [-16.5, 16.5]) this.box(this.scene, [1.3, 1, 1.4], [x, 6.5, z], '#a8aaa0');
    for (const [x, z] of [[-14, -14], [14, 14], [-14, 14], [14, -14]]) { this.box(this.scene, [.24, 2.3, .24], [x, 1.15, z], '#604a37'); this.box(this.scene, [.5, .6, .5], [x, 2.4, z], '#e7ae51'); }
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.7, 4.8, 48), this.material('#b9ad87')); ring.rotation.x = -Math.PI / 2; ring.position.y = .008; this.scene.add(ring);
    for (const [x, z, color] of [[-12, -12, COLORS[0]], [12, 12, COLORS[1]], [-12, 12, COLORS[2]], [12, -12, COLORS[3]], [0, -13, COLORS[4]]] as [number, number, string][]) {
      const tile = this.box(this.scene, [1.8, .015, 1.8], [x, .018, z], color); tile.material = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: .5 });
    }
    this.scene.add(this.camera); this.camera.add(this.weapon); this.weapon.scale.setScalar(.55); this.weapon.position.set(.36, -.4, -.65);
    window.addEventListener('resize', () => this.resize()); this.resize();
  }
  material(color: string) { if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshLambertMaterial({ color })); return this.materials.get(color)!; }
  box(parent: THREE.Object3D, scale: number[], pos: number[], color: string) { const m = new THREE.Mesh(this.boxGeo, this.material(color)); m.scale.set(...scale as [number, number, number]); m.position.set(...pos as [number, number, number]); parent.add(m); return m; }
  resize() { this.renderer.setSize(innerWidth, innerHeight); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  settings(quality: string, fov: number, reduced: boolean) { this.quality = quality; this.reduced = reduced; this.renderScale = quality === 'low' ? 1 : Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5); this.renderer.setPixelRatio(this.renderScale); this.camera.fov = fov; this.resize(); }
  makeAvatar(p: Player) {
    const g = new THREE.Group(), color = COLORS[p.color];
    this.box(g, [.58, .7, .3], [0, 1.05, 0], color);
    const pivot = (x: number, y: number) => { const joint = new THREE.Group(); joint.position.set(x, y, 0); g.add(joint); return joint; };
    const head = pivot(0, 1.4);
    this.box(head, [.48, .46, .45], [0, .24, 0], '#dab48b');
    this.box(head, [.5, .12, .47], [0, .44, 0], '#433c36');
    for (const x of [-.12, .12]) this.box(head, [.07, .07, .025], [x, .26, -.23], '#283b44');
    const leftLeg = pivot(-.17, .7), rightLeg = pivot(.17, .7);
    for (const leg of [leftLeg, rightLeg]) this.box(leg, [.25, .7, .28], [0, -.35, 0], '#364753');
    const leftArm = pivot(-.42, 1.37), rightArm = pivot(.42, 1.37);
    for (const arm of [leftArm, rightArm]) this.box(arm, [.22, .67, .25], [0, -.335, 0], color);
    const shield = this.box(leftArm, [.12, .67, .49], [-.15, -.34, -.1], '#b59968'); shield.name = 'shield';
    const tool = new THREE.Group(); tool.position.set(0, -.6, -.15); tool.scale.setScalar(.65); rightArm.add(tool);
    this.buildWeapon(tool, p.weapon);
    this.rigs.set(p.id, { head, leftArm, rightArm, leftLeg, rightLeg, tool, toolName: p.weapon, distance: 0, speed: 0, swing: 0, landed: 0, grounded: p.grounded });
    g.position.set(p.x, p.y, p.z);
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const ctx = c.getContext('2d')!;
    ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#101820bb'; ctx.fillRect(0, 8, 256, 40); ctx.fillStyle = color; ctx.fillText(p.name, 128, 37);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true })); label.scale.set(2, .5, 1); label.position.y = 2.3; g.add(label);
    this.scene.add(g); this.avatars.set(p.id, g); return g;
  }
  setWeapon(name: Weapon, block: boolean) {
    const key = `${name}:${block}`; if (key === this.lastWeapon) return; this.lastWeapon = key; this.weapon.clear();
    if (block) { this.box(this.weapon, [.66, .78, .12], [-.36, .2, -.3], '#8a673c'); this.box(this.weapon, [.12, .78, .14], [-.36, .2, -.32], '#b6b6a3'); return; }
    this.buildWeapon(this.weapon, name);
  }
  buildWeapon(group: THREE.Group, name: Weapon) {
    group.clear();
    if (name === 'sword') { this.box(group, [.11, .28, .1], [0, 0, 0], '#72502f'); this.box(group, [.34, .07, .12], [0, .17, 0], '#d9b773'); this.box(group, [.13, .7, .065], [0, .55, 0], '#b5e2db'); this.box(group, [.08, .15, .06], [0, .96, 0], '#e2f9ed'); }
    if (name === 'axe') { this.box(group, [.1, .8, .1], [0, .22, 0], '#7d5736'); this.box(group, [.38, .29, .1], [-.12, .59, 0], '#b0d5d0'); this.box(group, [.1, .38, .1], [-.32, .56, 0], '#e0e8d4'); }
    if (name === 'bow') { for (let n = -2; n <= 2; n++) this.box(group, [.08, .17, .09], [.15 - Math.abs(n) * .065, n * .17 + .2, 0], '#be8a50'); this.box(group, [.012, .78, .012], [-.03, .2, 0], '#e9dcbc'); }
    if (name === 'crossbow') { this.box(group, [.14, .15, .65], [0, .15, -.15], '#8d633f'); this.box(group, [.65, .09, .12], [0, .17, -.38], '#b3b7a7'); this.box(group, [.1, .29, .1], [0, -.01, .02], '#6e4b32'); }
  }
  event(e: GameEvent) {
    if (e.type === 'swing' || e.type === 'shot') { const rig = e.actor && this.rigs.get(e.actor); if (rig) rig.swing = 1; }
  }
  render(dt: number, snapshot: Snapshot | undefined, me: Player | undefined, local: Body | undefined, yaw: number, pitch: number, playing: boolean, moving: boolean) {
    this.time += dt; this.frames++; this.fpsTime += dt;
    if (this.fpsTime >= 1) { this.fps = Math.round(this.frames / this.fpsTime); this.frames = 0; this.fpsTime = 0; }
    const inRound = snapshot && snapshot.phase !== 'waiting';
    let follow = me;
    if (me && !me.alive) { const alive = snapshot?.players.filter(p => p.alive) ?? []; follow = alive[this.spectator % Math.max(1, alive.length)]; }
    if (inRound && follow) {
      const pos = follow.id === me?.id && local ? local : follow;
      const distance = Math.hypot(pos.x - this.lastCamera.x, pos.z - this.lastCamera.z);
      if (this.cameraTracking === follow.id && distance < 1 && pos.grounded) this.cameraDistance += distance;
      this.cameraTracking = follow.id; this.lastCamera.set(pos.x, pos.y, pos.z);
      const bob = !this.reduced && pos.grounded && distance > .001 && distance < 1 ? Math.sin(this.cameraDistance * 5) * (pos.sprinting ? .045 : .025) : 0;
      this.camera.position.set(pos.x, pos.y + EYE + bob, pos.z);
      this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(follow.id === me?.id ? pitch : follow.pitch, follow.id === me?.id ? yaw : follow.yaw, 0);
    } else { const a = this.time * .018; this.camera.position.set(Math.sin(a + .8) * 24, 19, Math.cos(a + .8) * 24); this.camera.lookAt(0, 0, 0); }
    this.weapon.visible = !!inRound && !!me?.alive && snapshot?.phase !== 'results';
    if (me) { this.setWeapon(me.weapon, me.block); this.swing = Math.max(0, this.swing - dt * 5); this.weapon.rotation.set(-this.swing * 1.2, 0, -.2 - this.swing * .8); this.weapon.position.y = -.43 - ((me.weapon === 'sword' || me.weapon === 'axe') ? (1 - attackStrength(me)) * .1 : 0) + (moving && local?.grounded && !this.reduced ? Math.sin(this.cameraDistance * 5) * .02 : 0); this.weapon.position.z = -.65 + me.charge * .035; }
    const ids = new Set(snapshot?.players.map(p => p.id));
    for (const [id, g] of this.avatars) if (!ids.has(id)) { this.scene.remove(g); g.traverse(o => { if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); } }); this.avatars.delete(id); this.rigs.delete(id); }
    for (const p of snapshot?.players ?? []) {
      const g = this.avatars.get(p.id) ?? this.makeAvatar(p); g.visible = p.alive && p.id !== (inRound ? follow?.id : undefined);
      const rig = this.rigs.get(p.id)!, oldX = g.position.x, oldZ = g.position.z;
      const target = new THREE.Vector3(p.x, p.y, p.z); if (g.position.distanceTo(target) > 4) g.position.copy(target); else g.position.lerp(target, 1 - Math.exp(-dt * 18));
      const travelled = Math.hypot(g.position.x - oldX, g.position.z - oldZ);
      if (travelled < 1 && p.grounded) rig.distance += travelled;
      rig.speed += ((snapshot?.phase === 'active' ? p.moveSpeed : 0) - rig.speed) * (1 - Math.exp(-dt * 15));
      const pose = locomotionPose(rig.distance, rig.speed, p.grounded, !!p.sprinting, p.vy);
      if (!rig.grounded && p.grounded) rig.landed = 1;
      rig.grounded = p.grounded; rig.landed = Math.max(0, rig.landed - dt * 6);
      g.position.y -= Math.sin(rig.landed * Math.PI) * .06;
      g.rotation.set(pose.lean, p.yaw, 0); rig.head.rotation.x = p.pitch;
      rig.leftLeg.rotation.x = pose.leftLeg; rig.rightLeg.rotation.x = pose.rightLeg;
      rig.leftArm.rotation.x = p.block ? -1.1 : pose.leftArm;
      rig.swing = Math.max(0, rig.swing - dt / .3);
      rig.rightArm.rotation.x = rig.swing > 0 ? -Math.sin(rig.swing * Math.PI) * 1.8 : p.charge > 0 || p.loaded ? -1.3 + p.pitch : pose.rightArm;
      const shield = g.getObjectByName('shield')!; shield.visible = p.block;
      if (rig.toolName !== p.weapon) { rig.toolName = p.weapon; this.buildWeapon(rig.tool, p.weapon); }
      g.traverse(o => { if (o instanceof THREE.Mesh) { o.userData.baseMaterial ??= o.material; o.material = p.hurtTime > 0 ? this.material('#e77979') : o.userData.baseMaterial; } });
    }
    const arrowIds = new Set(snapshot?.arrows.map(a => a.id));
    for (const [id, m] of this.arrowMeshes) if (!arrowIds.has(id)) { this.scene.remove(m); this.arrowMeshes.delete(id); }
    for (const a of snapshot?.arrows ?? []) { let m = this.arrowMeshes.get(a.id); if (!m) { m = new THREE.Mesh(this.arrowGeo, this.material('#d8b277')); this.scene.add(m); this.arrowMeshes.set(a.id, m); } m.position.set(a.x, a.y, a.z); m.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz); }
    this.renderer.render(this.scene, this.camera);
  }
}
