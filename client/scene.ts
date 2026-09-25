import * as THREE from 'three';
import { BOXES, COLORS, EYE, type Player, type Snapshot, type Weapon } from '../shared/game.js';

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
    this.box(g, [.58, .7, .3], [0, 1.05, 0], color); this.box(g, [.48, .46, .45], [0, 1.64, 0], '#dab48b');
    this.box(g, [.5, .16, .47], [0, 1.85, 0], '#433c36');
    this.box(g, [.07, .07, .025], [-.12, 1.66, -.23], '#283b44'); this.box(g, [.07, .07, .025], [.12, 1.66, -.23], '#283b44');
    for (const x of [-.17, .17]) this.box(g, [.25, .7, .28], [x, .35, 0], '#364753');
    for (const x of [-.42, .42]) this.box(g, [.22, .67, .25], [x, 1.04, 0], color);
    const shield = this.box(g, [.12, .67, .49], [.57, 1.03, -.1], '#b59968'); shield.name = 'shield';
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const ctx = c.getContext('2d')!;
    ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#101820bb'; ctx.fillRect(0, 8, 256, 40); ctx.fillStyle = color; ctx.fillText(p.name, 128, 37);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true })); label.scale.set(2, .5, 1); label.position.y = 2.3; g.add(label);
    this.scene.add(g); this.avatars.set(p.id, g); return g;
  }
  setWeapon(name: Weapon, block: boolean) {
    const key = `${name}:${block}`; if (key === this.lastWeapon) return; this.lastWeapon = key; this.weapon.clear();
    if (block) { this.box(this.weapon, [.66, .78, .12], [-.36, .2, -.3], '#8a673c'); this.box(this.weapon, [.12, .78, .14], [-.36, .2, -.32], '#b6b6a3'); return; }
    if (name === 'sword') { this.box(this.weapon, [.11, .28, .1], [0, 0, 0], '#72502f'); this.box(this.weapon, [.34, .07, .12], [0, .17, 0], '#d9b773'); this.box(this.weapon, [.13, .7, .065], [0, .55, 0], '#b5e2db'); this.box(this.weapon, [.08, .15, .06], [0, .96, 0], '#e2f9ed'); }
    if (name === 'axe') { this.box(this.weapon, [.1, .8, .1], [0, .22, 0], '#7d5736'); this.box(this.weapon, [.38, .29, .1], [-.12, .59, 0], '#b0d5d0'); this.box(this.weapon, [.1, .38, .1], [-.32, .56, 0], '#e0e8d4'); }
    if (name === 'bow') { for (let n = -2; n <= 2; n++) this.box(this.weapon, [.08, .17, .09], [.15 - Math.abs(n) * .065, n * .17 + .2, 0], '#be8a50'); this.box(this.weapon, [.012, .78, .012], [-.03, .2, 0], '#e9dcbc'); }
    if (name === 'crossbow') { this.box(this.weapon, [.14, .15, .65], [0, .15, -.15], '#8d633f'); this.box(this.weapon, [.65, .09, .12], [0, .17, -.38], '#b3b7a7'); this.box(this.weapon, [.1, .29, .1], [0, -.01, .02], '#6e4b32'); }
  }
  render(dt: number, snapshot: Snapshot | undefined, me: Player | undefined, local: { x: number; y: number; z: number } | undefined, yaw: number, pitch: number, playing: boolean, moving: boolean) {
    this.time += dt; this.frames++; this.fpsTime += dt;
    if (this.fpsTime >= 1) { this.fps = Math.round(this.frames / this.fpsTime); this.frames = 0; this.fpsTime = 0; }
    const inRound = snapshot && snapshot.phase !== 'waiting';
    let follow = me;
    if (me && !me.alive) { const alive = snapshot?.players.filter(p => p.alive) ?? []; follow = alive[this.spectator % Math.max(1, alive.length)]; }
    if (inRound && follow) {
      const pos = follow.id === me?.id && local ? local : follow;
      this.camera.position.set(pos.x, pos.y + EYE + (moving && !this.reduced ? Math.sin(this.time * 12) * .018 : 0), pos.z);
      this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(follow.id === me?.id ? pitch : follow.pitch, follow.id === me?.id ? yaw : follow.yaw, 0);
    } else { const a = this.time * .018; this.camera.position.set(Math.sin(a + .8) * 24, 19, Math.cos(a + .8) * 24); this.camera.lookAt(0, 0, 0); }
    this.weapon.visible = !!inRound && !!me?.alive && snapshot?.phase !== 'results';
    if (me) { this.setWeapon(me.weapon, me.block); this.swing = Math.max(0, this.swing - dt * 5); this.weapon.rotation.set(-this.swing * 1.2, 0, -.2 - this.swing * .8); this.weapon.position.y = -.43 + (moving && !this.reduced ? Math.sin(this.time * 10) * .012 : 0); }
    const ids = new Set(snapshot?.players.map(p => p.id));
    for (const [id, g] of this.avatars) if (!ids.has(id)) { this.scene.remove(g); g.traverse(o => { if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); } }); this.avatars.delete(id); }
    for (const p of snapshot?.players ?? []) {
      const g = this.avatars.get(p.id) ?? this.makeAvatar(p); g.visible = p.alive && p.id !== (inRound ? follow?.id : undefined);
      const target = new THREE.Vector3(p.x, p.y, p.z); if (g.position.distanceTo(target) > 4) g.position.copy(target); else g.position.lerp(target, 1 - Math.exp(-dt * 18));
      g.rotation.y = p.yaw; const shield = g.getObjectByName('shield')!; shield.visible = p.block;
    }
    const arrowIds = new Set(snapshot?.arrows.map(a => a.id));
    for (const [id, m] of this.arrowMeshes) if (!arrowIds.has(id)) { this.scene.remove(m); this.arrowMeshes.delete(id); }
    for (const a of snapshot?.arrows ?? []) { let m = this.arrowMeshes.get(a.id); if (!m) { m = new THREE.Mesh(this.arrowGeo, this.material('#d8b277')); this.scene.add(m); this.arrowMeshes.set(a.id, m); } m.position.set(a.x, a.y, a.z); m.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz); }
    this.renderer.render(this.scene, this.camera);
  }
}
