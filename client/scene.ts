import { vistaDistance } from '../shared/horizon.js';
import { Atmosphere, SparkPool } from './atmosphere.js';
import { RuneLandmarks } from './landmarks.js';
import { SECRET, PASSAGE, RETURN_PASSAGE } from '../shared/world.js';
import { TerrainStreamer } from './terrain.js';
import * as THREE from 'three';
import { TEAMS, isTeamMode, playerColor, type Mode, type Team, ARENA_SIZE, SPAWNS, BOXES, COLORS, EYE, armorTier, attackStrength, type Body, type GameEvent, type Player, type Snapshot, type Weapon } from '../shared/game.js';
import { LANDMARKS } from '../shared/arena.js';
import { locomotionPose } from './animation.js';
import { TextureLibrary, type Surface } from './textures.js';
import { FlameAtlas, armorMaterial } from './effects.js';
import { swordBlade, appleBody, totemBody } from './items.js';
import { clipCamera, thirdPersonCamera, type Perspective } from './camera.js';

export class ArenaScene {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(120, 1, .05, 1200);
  arena = new THREE.Group(); worldDecor = new THREE.Group(); terrain = new TerrainStreamer(); secretDoor = new THREE.Group();
  atmosphere: Atmosphere; sparks: SparkPool; runeLandmarks = new RuneLandmarks();
  auraGeometry = new THREE.TorusGeometry(.7,.022,4,24); runeGeometry = new THREE.IcosahedronGeometry(.17,0);
  auraMaterial = new THREE.MeshBasicMaterial({color:'#76fff1'});
  runeMaterials = ['#ffcd6b','#60e1e6','#c197ff'].map(color => new THREE.MeshBasicMaterial({color}));
  viewRealm = 'arena'; dashTrailTime = 0; lastWeaponYaw = 0; landingKick = 0; wasGrounded = true;
  bases = new Map<Team, THREE.Group>(); flags = new Map<Team, THREE.Group>();
  avatars = new Map<string, THREE.Group>(); arrowMeshes = new Map<number, THREE.Mesh>(); weapon = new THREE.Group(); leftHand = new THREE.Group();
  textures = new TextureLibrary(); surfaceMaterials = new Map<string, THREE.MeshLambertMaterial>();
  flameAtlas = new FlameAtlas(); flames: THREE.MeshBasicMaterial[] = [];
  armorTime = { value: 0 };
  armorMaterials = [armorMaterial(this.textures.get('metal'), false, this.armorTime), armorMaterial(this.textures.get('metal'), true, this.armorTime)];
  swordGeo = swordBlade(); appleGeo = appleBody(); totemGeo = totemBody();
  swordMaterial = armorMaterial(this.textures.get('metal'), true, this.armorTime);
  sun = new THREE.DirectionalLight('#ffe9bc', 1.9);
  contactShadows = new THREE.Group(); shadowGeo = new THREE.PlaneGeometry(1, 1);
  avatarShadows = new Map<string, THREE.Mesh>();
  contactMaterial = new THREE.MeshBasicMaterial({ color: '#172838', transparent: true, opacity: .2, depthWrite: false });
  materials = new Map<string, THREE.MeshLambertMaterial>(); boxGeo = new THREE.BoxGeometry(1, 1, 1);
  arrowGeo = new THREE.BoxGeometry(.055, .055, .7); lastWeapon = ''; lastOffhand = ''; swing = 0; time = 0; quality = 'medium'; inspectArmor = false; configuredFov = 120; perspective: Perspective = 'first';
  cameraDistance = 0; lastCamera = new THREE.Vector3(); cameraTracking = '';
  rigs = new Map<string, { head: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; tool: THREE.Group; toolName: string; distance: number; speed: number; swing: number; landed: number; grounded: boolean }>();
  frames = 0; fps = 60; fpsTime = 0; spectator = 0; reduced = false; renderScale = 1;
  constructor(canvas: HTMLCanvasElement) {
    this.swordMaterial.color.set('#a88abf');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .95;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#a5cee5'); this.scene.fog = new THREE.Fog('#a5cee5', 65, 150);
    this.scene.add(new THREE.HemisphereLight('#b8deef', '#435a44', 1.25));
    this.atmosphere = new Atmosphere(this.scene); this.sparks = new SparkPool(this.scene); this.worldDecor.add(this.runeLandmarks.group);
    this.sun.position.set(-40, 80, 30); this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -72, right: 72, top: 72, bottom: -72, near: .5, far: 180 });
    this.sun.shadow.bias = -.00015; this.sun.shadow.normalBias = .035;
    this.scene.add(this.sun, this.sun.target, this.contactShadows);
    this.scene.add(this.arena, this.terrain.group, this.worldDecor); this.worldDecor.visible = false;
    const floorGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE); this.repeatUV(floorGeo, ARENA_SIZE/3, ARENA_SIZE/3);
    const floor = new THREE.Mesh(floorGeo, this.surface('paving')); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.arena.add(floor);
    // Unit masonry keeps a consistent pixel density. All wall blocks share one draw call.
    const positions: number[][] = [];
    const edge = ARENA_SIZE / 2 + .5;
    for (let y = 0; y < 6; y++) {
      // Front/back own the corner cubes; side rows stop before them.
      for (let x = -edge; x <= edge; x++) { if (y >= 3 || Math.abs(x - SECRET.x) >= 2) positions.push([x, y + .5, -edge]); positions.push([x, y + .5, edge]); }
      for (let z = -edge + 1; z <= edge - 1; z++) positions.push([-edge, y + .5, z], [edge, y + .5, z]);
    }
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.surface('brick'), positions.length), mat = new THREE.Matrix4();
    positions.forEach((p, i) => { mat.makeTranslation(p[0], p[1], p[2]); walls.setMatrixAt(i, mat); walls.setColorAt(i, new THREE.Color().setScalar(.88 + ((i * 17) % 13) / 100)); });
    walls.castShadow = walls.receiveShadow = true; this.arena.add(walls);
    for (const b of BOXES) {
      // Cap replaces the top .12 units; coplanar brick and cap tops flicker.
      const bodyHeight = b.h - .12;
      const mesh = new THREE.Mesh(this.blockGeometry(b.w, bodyHeight, b.d), this.surface(b.surface ?? 'brick')); mesh.position.set(b.x, (b.y ?? 0) + bodyHeight / 2, b.z); mesh.castShadow = mesh.receiveShadow = true; this.arena.add(mesh);
      const cap = new THREE.Mesh(this.blockGeometry(b.w, .12, b.d), this.surface(b.surface === 'wood' ? 'wood' : 'stone', '#c7c9c5')); cap.position.set(b.x, (b.y ?? 0) + b.h - .06, b.z); cap.castShadow = cap.receiveShadow = true; this.arena.add(cap);
      if (!b.y) this.contact(b.x, b.z, b.w + .35, b.d + .35);
    }
    for (let x = -45; x <= 45; x += 3) for (const z of [-edge, edge]) this.masonry([1.4, 1, 1.3], [x, 6.5, z]);
    for (let z = -45; z <= 45; z += 3) for (const x of [-edge, edge]) this.masonry([1.3, 1, 1.4], [x, 6.5, z]);
    for (const [x, z] of [[-14, -14], [14, 14], [-14, 14], [14, -14], [-36, -26], [36, 26], [0, 35], [-11, 17], [11, -17]]) {
      this.box(this.arena, [.24, 2.06, .24], [x, 1.03, z], '#bc9060', 'wood');
      const flame = this.flameAtlas.material(); this.flames.push(flame);
      const flameGeo = new THREE.PlaneGeometry(.46, .64);
      for (const angle of [0, Math.PI / 2]) { const fire = new THREE.Mesh(flameGeo, flame); fire.position.set(x, 2.43, z); fire.rotation.y = angle; this.arena.add(fire); }
      this.box(this.arena, [.5, .08, .5], [x, 2.1, z], '#727879', 'metal');
      for (const [dx, dz] of [[-.23, -.23], [-.23, .23], [.23, -.23], [.23, .23]]) this.box(this.arena, [.035, .56, .035], [x + dx, 2.42, z + dz], '#64636c', 'metal');
      this.box(this.arena, [.58, .1, .58], [x, 2.75, z], '#727879', 'metal');
      this.contact(x, z, .65, .65);
    }
    // Small baked contact patches keep geometry grounded on low-power devices.
    for (const side of [-1, 1]) { this.contact(side * 47.7, 0, .6, ARENA_SIZE); this.contact(0, side * 47.7, ARENA_SIZE, .6); }
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.7, 4.8, 48), this.material('#b9ad87')); ring.rotation.x = -Math.PI / 2; ring.position.y = .008; this.arena.add(ring);
    for (const [n, [x, z]] of SPAWNS.entries()) {
      const color = COLORS[n % COLORS.length];
      const tile = this.box(this.arena, [1.8, .015, 1.8], [x, .018, z], color); tile.material = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: .5 });
    }
    // Readable landmark signs, original canvas lettering; no external textures.
    for (const place of LANDMARKS) {
      const label = document.createElement('canvas'); label.width = 512; label.height = 96;
      const ctx = label.getContext('2d')!; ctx.fillStyle = '#263538'; ctx.fillRect(0, 0, 512, 96);
      ctx.strokeStyle = '#bf9860'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 504, 88);
      ctx.fillStyle = '#f6d79d'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(place.name.toUpperCase(), 256, 59);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(label), depthTest: true }));
      sign.scale.set(4.5, .85, 1); sign.position.set(place.x, place.name === 'Lookout tower' ? 9.8 : 4.9, place.z); this.arena.add(sign);
    }
    // Muted garden tiles distinguish ruined wings from the cobblestone courtyard.
    for (const side of [-1, 1]) this.box(this.arena, [17, .018, 17], [side * 26, .015, -side * 26], '#879378', 'stone');
    for (const team of ['red', 'blue'] as Team[]) {
      const base = new THREE.Group(), info = TEAMS[team]; base.position.set(info.x, .03, info.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2, 32), new THREE.MeshBasicMaterial({ color: info.color, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; base.add(ring);
      const label = document.createElement('canvas'); label.width = 256; label.height = 64; const ctx = label.getContext('2d')!;
      ctx.fillStyle = '#152631'; ctx.fillRect(0, 0, 256, 64); ctx.fillStyle = info.color; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${info.name.toUpperCase()} BASE`, 128, 42);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(label) })); sign.scale.set(4, 1, 1); sign.position.set(0, 4.2, 0); base.add(sign); this.arena.add(base); this.bases.set(team, base); base.visible = false;
      const flag = new THREE.Group(); this.box(flag, [.07, 2.8, .07], [0, 1.4, 0], '#efdab1', 'wood');
      this.box(flag, [1.25, .85, .06], [.64, 2.22, 0], info.color); this.box(flag, [.12, .18, .12], [0, 2.9, 0], '#ffd788', 'metal');
      this.arena.add(flag); this.flags.set(team, flag); flag.visible = false;
    }
    for (const b of PASSAGE) {
      const m = new THREE.Mesh(this.blockGeometry(b.w, b.h, b.d), this.surface('brick')); m.position.set(b.x, (b.y ?? 0) + b.h / 2, b.z); this.arena.add(m);
    }
    this.box(this.arena, [4, .06, 18], [-26, -.03, -56.5], '#ffffff', 'cobble');
    this.box(this.secretDoor, [4, 3, .9], [0, 1.5, -48], '#c1c5c6', 'brick');
    this.box(this.secretDoor, [.5, .65, .03], [0, 1.45, -47.53], '#81998e', 'stone');
    this.secretDoor.position.x = SECRET.x; this.arena.add(this.secretDoor);
    for (const z of [-52, -58, -63]) for (const x of [-27.75, -24.25]) this.box(this.arena, [.14, .45, .14], [x, 2, z], '#e7b36d');
    for (const b of RETURN_PASSAGE) { const m = new THREE.Mesh(this.blockGeometry(b.w, b.h, b.d), this.surface('stone')); m.position.set(b.x, (b.y ?? 0) + b.h / 2, b.z); this.worldDecor.add(m); }
    this.box(this.worldDecor, [4, .05, 8], [0, -.025, 7], '#c6c5aa', 'cobble');
    this.box(this.worldDecor, [4, 3, .06], [0, 1.5, 10.5], '#77a8a3');
    const label = document.createElement('canvas'); label.width = 512; label.height = 96; const ctx = label.getContext('2d')!;
    ctx.fillStyle = '#263538'; ctx.fillRect(0, 0, 512, 96); ctx.fillStyle = '#eed09a'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('RETURN TO THE CITADEL', 256, 60);
    const returnSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(label) })); returnSign.scale.set(5, 1, 1); returnSign.position.set(0, 4.2, 3); this.worldDecor.add(returnSign);
    this.scene.add(this.camera); this.camera.add(this.weapon, this.leftHand); this.leftHand.scale.setScalar(.55); this.leftHand.position.set(-.36, -.4, -.65); this.weapon.scale.setScalar(.55); this.weapon.position.set(.36, -.4, -.65);
    window.addEventListener('resize', () => this.resize()); this.resize();
  }
  repeatUV(geometry: THREE.BufferGeometry, u: number, v: number) {
    const uv = geometry.getAttribute('uv'); for (let n = 0; n < uv.count; n++) uv.setXY(n, uv.getX(n) * u, uv.getY(n) * v); return geometry;
  }
  blockGeometry(w: number, h: number, d: number) {
    const geometry = new THREE.BoxGeometry(w, h, d), uv = geometry.getAttribute('uv');
    const repeats = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let n = 0; n < uv.count; n++) { const [u, v] = repeats[Math.floor(n / 4)]; uv.setXY(n, uv.getX(n) * u, uv.getY(n) * v); }
    return geometry;
  }
  surface(name: Surface, color = '#ffffff') {
    const key = `${name}:${color}`;
    if (!this.surfaceMaterials.has(key)) this.surfaceMaterials.set(key, new THREE.MeshLambertMaterial({ color, map: this.textures.get(name), normalMap: this.textures.normal(name), normalScale: new THREE.Vector2(.35, .35) }));
    return this.surfaceMaterials.get(key)!;
  }
  masonry(size: number[], pos: number[]) {
    const m = new THREE.Mesh(this.blockGeometry(size[0], size[1], size[2]), this.surface('brick')); m.position.set(...pos as [number, number, number]); m.castShadow = m.receiveShadow = true; this.arena.add(m); return m;
  }
  contact(x: number, z: number, w: number, d: number) {
    const m = new THREE.Mesh(this.shadowGeo, this.contactMaterial); m.rotation.x = -Math.PI / 2; m.position.set(x, .012, z); m.scale.set(w, d, 1); this.contactShadows.add(m); return m;
  }
  material(color: string) { if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshLambertMaterial({ color })); return this.materials.get(color)!; }
  box(parent: THREE.Object3D, scale: number[], pos: number[], color: string, surface?: Surface) { const m = new THREE.Mesh(this.boxGeo, surface ? this.surface(surface, color) : this.material(color)); m.scale.set(...scale as [number, number, number]); m.position.set(...pos as [number, number, number]); m.castShadow = m.receiveShadow = parent !== this.weapon; parent.add(m); return m; }
  resize() { this.renderer.setSize(innerWidth, innerHeight); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  settings(quality: string, fov: number, reduced: boolean) {
    this.quality = quality; this.reduced = reduced;
    this.renderScale = quality === 'low' ? 1 : Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5); this.renderer.setPixelRatio(this.renderScale);
    this.renderer.shadowMap.enabled = quality !== 'low';
    const size = quality === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; this.sun.shadow.mapSize.set(size, size); }
    this.contactShadows.visible = quality === 'low';
    for (const shadow of this.avatarShadows.values()) shadow.visible = quality === 'low';
    this.renderer.shadowMap.needsUpdate = true;
    this.configuredFov = fov; this.camera.fov = fov; this.resize();
  }
  makeAvatar(p: Player, mode: Mode) {
    const g = new THREE.Group(), color = playerColor(p, mode); g.userData.color = color;
    this.box(g, [.58, .7, .3], [0, 1.05, 0], color, 'cloth');
    const scarf=new THREE.Group();scarf.name='scarf';scarf.position.set(0,1.35,.19);this.box(scarf,[.3,.12,.06],[0,0,0],'#e4bb76','cloth');for(let n=0;n<3;n++)this.box(scarf,[.14,.19,.03],[.1,-.17-n*.17,.06+n*.02],'#e4bb76','cloth');g.add(scarf);
    const pivot = (x: number, y: number) => { const joint = new THREE.Group(); joint.position.set(x, y, 0); g.add(joint); return joint; };
    const head = pivot(0, 1.4);
    this.box(head, [.48, .46, .45], [0, .24, 0], '#dab48b');
    this.box(head, [.5, .12, .47], [0, .44, 0], '#433c36');
    for (const x of [-.12, .12]) this.box(head, [.07, .07, .025], [x, .26, -.23], '#283b44');
    const leftLeg = pivot(-.17, .7), rightLeg = pivot(.17, .7);
    for (const leg of [leftLeg, rightLeg]) this.box(leg, [.25, .7, .28], [0, -.35, 0], '#364753', 'cloth');
    const leftArm = pivot(-.42, 1.37), rightArm = pivot(.42, 1.37);
    for (const arm of [leftArm, rightArm]) this.box(arm, [.22, .67, .25], [0, -.335, 0], color, 'cloth');
    const shield = this.box(leftArm, [.12, .67, .49], [-.15, -.34, -.1], '#d3b382', 'wood'); shield.name = 'shield';
    const totem = new THREE.Group(); totem.name = 'totem'; totem.position.set(0, -.55, -.18); totem.scale.setScalar(.65); leftArm.add(totem); this.buildTotem(totem);
    const tool = new THREE.Group(); tool.position.set(0, -.6, -.15); tool.scale.setScalar(.65); rightArm.add(tool);
    this.buildWeapon(tool, p.weapon);
    // Plates follow the same head/limb pivots as walking, jumping, blocking and swings.
    this.plate(head, [.56, .14, .53], [0, .46, 0]);
    this.plate(head, [.07, .35, .53], [-.255, .22, 0]); this.plate(head, [.07, .35, .53], [.255, .22, 0]);
    this.plate(head, [.44, .35, .07], [0, .22, .235]);
    this.plate(g, [.64, .6, .38], [0, 1.08, 0]);
    this.plate(g, [.65, .10, .39], [0, .74, 0]);
    for (const arm of [leftArm, rightArm]) this.plate(arm, [.3, .33, .33], [0, -.14, 0]);
    for (const leg of [leftLeg, rightLeg]) {
      this.plate(leg, [.28, .39, .33], [0, -.21, 0]);
      this.plate(leg, [.3, .23, .4], [0, -.58, -.03]);
    }
    // Cloth insignia stay readable through armor so player colors remain useful.
    this.box(g, [.15, .28, .022], [0, 1.15, -.207], color, 'cloth');
    this.box(g, [.15, .28, .022], [0, 1.15, .207], color, 'cloth');
    this.rigs.set(p.id, { head, leftArm, rightArm, leftLeg, rightLeg, tool, toolName: p.weapon, distance: 0, speed: 0, swing: 0, landed: 0, grounded: p.grounded });
    g.position.set(p.x, p.y, p.z);
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const ctx = c.getContext('2d')!;
    ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#101820bb'; ctx.fillRect(0, 8, 256, 40); ctx.fillStyle = color; ctx.fillText(p.name, 128, 37);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true })); label.scale.set(2, .5, 1); label.position.y = 2.3; g.add(label);
    this.scene.add(g); this.avatars.set(p.id, g); this.avatarShadows.set(p.id, this.contact(p.x, p.z, .7, .7)); return g;
  }
  plate(parent: THREE.Object3D, size: number[], position: number[]) {
    const mesh = new THREE.Mesh(this.boxGeo, this.armorMaterials[0]); mesh.scale.set(...size as [number, number, number]); mesh.position.set(...position as [number, number, number]);
    mesh.userData.armor = true; mesh.castShadow = mesh.receiveShadow = parent !== this.weapon; parent.add(mesh); return mesh;
  }
  setWeapon(name: Weapon, xp: number) {
    const level = armorTier(xp).level, key = `${name}:${level}`; if (key === this.lastWeapon) return; this.lastWeapon = key;
    this.buildWeapon(this.weapon, name);
    if (level > 1) { const glove = this.plate(this.weapon, [.19, .22, .18], [0, -.18, .03]); glove.material = this.armorMaterials[level - 2]; }
  }
  buildTotem(group: THREE.Group) {
    const charm = new THREE.Mesh(this.totemGeo, this.material('#d6a346')); charm.castShadow = charm.receiveShadow = group !== this.leftHand; group.add(charm);
    for (const side of [-1, 1]) {
      const gem = this.box(group, [.13, .13, .02], [0, .17, side * .06], '#64e8bf'); gem.rotation.z = Math.PI / 4;
      this.box(group, [.16, .04, .02], [0, .32, side * .06], '#ffe59a');
      for (const x of [-.21, .21]) this.box(group, [.13, .04, .02], [x, .12, side * .06], '#ffe59a');
    }
  }
  setOffhand(p: Player) {
    const level = armorTier(p.xp).level, key = `${p.offhand}:${p.totems}:${level}`;
    if (key === this.lastOffhand) return; this.lastOffhand = key; this.leftHand.clear();
    if (p.offhand === 'totem') { if (p.totems > 0) this.buildTotem(this.leftHand); else return; }
    else { this.box(this.leftHand, [.55, .67, .12], [0, .08, 0], '#8a673c', 'wood'); this.box(this.leftHand, [.09, .67, .14], [0, .08, -.02], '#b6b6a3', 'metal'); }
    this.box(this.leftHand,[.18,.2,.2],[0,-.14,.16],'#dab48b');this.box(this.leftHand,[.16,.27,.17],[0,-.34,.23],'#355b65','cloth');
    if (level > 1) { const glove = this.plate(this.leftHand, [.19, .22, .18], [0, -.18, .03]); glove.material = this.armorMaterials[level - 2]; }
    this.leftHand.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = false; });
  }
  buildWeapon(group: THREE.Group, name: Weapon) {
    group.clear();
    if (name === 'sword') {
      const blade = new THREE.Mesh(this.swordGeo, this.swordMaterial); blade.castShadow = blade.receiveShadow = group !== this.weapon; group.add(blade);
      this.box(group, [.10, .29, .10], [0, .02, 0], '#302138', 'wood');
      for (const y of [-.07, .01, .09]) this.box(group, [.115, .025, .115], [0, y, 0], '#8760a5', 'metal');
      for (const side of [-1, 1]) {
        const guard = this.box(group, [.22, .085, .13], [side * .14, .18, 0], '#683995', 'metal'); guard.rotation.z = -side * .3;
        this.box(group, [.095, .11, .14], [side * .25, .21, 0], '#a276c8', 'metal');
        this.box(group, [.045, .65, .012], [-.045, .58, side * .042], '#bdacdb', 'metal');
      }
      this.box(group, [.16, .1, .14], [0, -.16, 0], '#8453a6', 'metal');
    }
    if (name === 'apple') {
      const fruit = new THREE.Mesh(this.appleGeo, this.material('#e8bc2e')); fruit.castShadow = fruit.receiveShadow = group !== this.weapon; group.add(fruit);
      this.box(group, [.065, .16, .08], [.015, .34, 0], '#875123', 'wood');
      for (const side of [-1, 1]) {
        this.box(group, [.19, .055, .016], [-.045, .2, side * .102], '#fff5a2');
        this.box(group, [.065, .13, .016], [-.14, .12, side * .102], '#f7df6c');
        this.box(group, [.1, .065, .016], [.095, -.02, side * .102], '#ce8d17');
      }
    }
    if (name === 'axe') { this.box(group, [.1, .8, .1], [0, .22, 0], '#7d5736', 'wood'); this.box(group, [.38, .29, .1], [-.12, .59, 0], '#b0d5d0', 'metal'); this.box(group, [.1, .38, .1], [-.32, .56, 0], '#e0e8d4', 'metal'); }
    if (name === 'bow') { for (let n = -2; n <= 2; n++) this.box(group, [.08, .17, .09], [.15 - Math.abs(n) * .065, n * .17 + .2, 0], '#be8a50', 'wood'); this.box(group, [.012, .78, .012], [-.03, .2, 0], '#e9dcbc'); }
    if (name === 'crossbow') { this.box(group, [.14, .15, .65], [0, .15, -.15], '#8d633f', 'wood'); this.box(group, [.65, .09, .12], [0, .17, -.38], '#b3b7a7', 'metal'); this.box(group, [.1, .29, .1], [0, -.01, .02], '#6e4b32', 'wood'); }
    if(group===this.weapon){this.box(group,[.17,.19,.18],[0,-.02,.07],'#dab48b');this.box(group,[.15,.28,.17],[0,-.23,.22],'#355b65','cloth');}
  }
  event(e: GameEvent) {
    if (e.type === 'swing' || e.type === 'shot') { const rig = e.actor && this.rigs.get(e.actor); if (rig) rig.swing = 1; }
    const g = this.avatars.get(e.target ?? e.actor ?? ''); if (g?.userData.realm === this.viewRealm && !this.reduced && ['hit','relic','totem','dash','level','flag_capture'].includes(e.type)) this.sparks.burst(g.position.x,g.position.y+1,g.position.z,e.type === 'hit' ? e.blocked ? '#bdeaff' : '#ffcd83' : '#6dfff0',e.type === 'relic' ? 45 : 16);
  }
  render(dt: number, snapshot: Snapshot | undefined, me: Player | undefined, local: Body | undefined, yaw: number, pitch: number, playing: boolean, moving: boolean) {
    this.time += dt; this.armorTime.value = this.reduced ? 0 : this.time;
    this.flames.forEach((flame, n) => this.flameAtlas.animate(flame, this.time, n, this.reduced));
    this.frames++; this.fpsTime += dt;
    if (this.fpsTime >= 1) { this.fps = Math.round(this.frames / this.fpsTime); this.frames = 0; this.fpsTime = 0; }
    const inRound = snapshot && snapshot.phase !== 'waiting';
    const inspecting = this.inspectArmor && !!me?.alive && snapshot?.phase === 'active';
    const thirdPerson = this.perspective !== 'first';
    let cameraGap = Infinity;
    let follow = me;
    if (me && !me.alive) { const alive = snapshot?.players.filter(p => p.alive) ?? []; follow = alive[this.spectator % Math.max(1, alive.length)]; }
    if (inRound && follow) {
      const pos = follow.id === me?.id && local ? local : follow;
      const distance = Math.hypot(pos.x - this.lastCamera.x, pos.z - this.lastCamera.z);
      if (this.cameraTracking === follow.id && distance < 1 && pos.grounded) this.cameraDistance += distance;
      this.cameraTracking = follow.id; this.lastCamera.set(pos.x, pos.y, pos.z);
      const bob = !thirdPerson && !this.reduced && pos.grounded && distance > .001 && distance < 1 ? Math.sin(this.cameraDistance * 5) * (pos.sprinting ? .045 : .025) : 0;
      this.camera.position.set(pos.x, pos.y + EYE + bob, pos.z);
      const lookYaw = follow.id === me?.id ? yaw : follow.yaw, lookPitch = follow.id === me?.id ? pitch : follow.pitch;
      this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(lookPitch, lookYaw, 0);
      if (this.perspective !== 'first') {
        const radius = .03 + .05 * Math.tan(this.configuredFov * Math.PI / 360) * Math.hypot(1, this.camera.aspect);
        const view = thirdPersonCamera(this.camera.position, lookYaw, lookPitch, this.perspective, Math.max(.18, radius), pos.realm ?? 'arena', snapshot.world);
        this.camera.position.copy(view.position); this.camera.rotation.set(view.pitch, view.yaw, 0); cameraGap = view.distance;
      }
    } else { const a = this.time * .018; this.camera.position.set(Math.sin(a + .8) * 62, 48, Math.cos(a + .8) * 62); this.camera.lookAt(0, 0, 0); }
    const realm = inRound ? follow?.realm ?? 'arena' : 'arena', wild = realm === 'wilds';
    this.arena.visible = !wild; this.worldDecor.visible = wild; this.contactShadows.visible = !wild && this.quality === 'low'; this.renderer.shadowMap.enabled = !wild && this.quality !== 'low';
    if(this.viewRealm!==realm)this.sparks.clear(); this.viewRealm = realm; this.terrain.time.value = this.reduced ? 0 : this.time;
    this.terrain.update(this.camera.position.x, this.camera.position.z, snapshot?.world.seed ?? 0, this.quality, wild);
    const fog = this.scene.fog as THREE.Fog; fog.near = wild ? vistaDistance(this.terrain.worker ? this.quality : 'low') * .48 : 80; fog.far = wild ? vistaDistance(this.terrain.worker ? this.quality : 'low') : 200;
    this.atmosphere.update(this.camera,this.time,this.reduced); this.sparks.update(dt,!this.reduced);
    if (snapshot && wild) { this.runeLandmarks.build(snapshot.world.seed); this.runeLandmarks.update(this.time,me?.relics ?? 0,this.reduced); }
    this.secretDoor.position.x += ((snapshot?.world.doorOpen ? SECRET.x + 4.3 : SECRET.x) - this.secretDoor.position.x) * Math.min(1, dt * 4);
    const fov = inspecting ? 55 : this.configuredFov;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (inspecting && me) { const angle = this.reduced ? Math.PI + me.yaw : this.time * .3; this.camera.position.copy(clipCamera({ x: me.x, y: me.y + EYE, z: me.z }, { x: me.x + Math.sin(angle) * 3.8, y: me.y + 1.8, z: me.z + Math.cos(angle) * 3.8 }, .22, me.realm, snapshot?.world)); this.camera.lookAt(me.x, me.y + .85, me.z); }
    this.weapon.visible = !thirdPerson && !inspecting && !!inRound && !!me?.alive && snapshot?.phase !== 'results' && (me.weapon !== 'apple' || me.apples > 0);
    if (me) { this.setWeapon(me.weapon, me.xp); this.setOffhand(me); this.swing = Math.max(0, this.swing - dt * 5); const arc = Math.sin(this.swing * Math.PI), sway = this.reduced ? 0 : Math.max(-.16,Math.min(.16,yaw-this.lastWeaponYaw)); this.lastWeaponYaw=yaw; this.weapon.rotation.set(-arc * 1.25, -arc * .65-sway, -.2 - arc * .9); this.weapon.position.y = -.43 - ((me.weapon === 'sword' || me.weapon === 'axe') ? (1 - attackStrength(me)) * .1 : 0) + (moving && local?.grounded && !this.reduced ? Math.sin(this.cameraDistance * 5) * .02 : 0); this.weapon.position.z = -.65 + me.charge * .035; }
    if (local && !this.reduced) { if (!this.wasGrounded && local.grounded) this.landingKick = .08; this.wasGrounded=local.grounded; this.landingKick*=Math.exp(-dt*14); this.weapon.position.y-=this.landingKick; this.weapon.rotation.z+=(local.dashTime ?? 0)>0 ? -.22 : 0; if ((local.dashTime ?? 0)>0 && (this.dashTrailTime+=dt)>.025) { this.dashTrailTime=0; this.sparks.burst(local.x,local.y+.6,local.z,'#66e8df',3); } }
    this.leftHand.visible = !thirdPerson && !inspecting && !!inRound && !!me?.alive && snapshot?.phase !== 'results' && (me.offhand === 'shield' || me.totems > 0);
    this.leftHand.position.set(me?.block ? -.2 : -.36, me?.block ? -.12 : this.weapon.position.y, me?.block ? -.5 : -.65);
    this.leftHand.rotation.set(0, me?.block ? -.1 : .1, .1);
    const eating = me?.weapon === 'apple' && me.charge > 0;
    this.weapon.position.x = eating ? .15 : .36;
    if (eating) { this.weapon.position.y += .18 + (this.reduced ? 0 : Math.sin(this.time * 18) * .025); this.weapon.position.z += .2; this.weapon.rotation.z = -.4; }
    const ids = new Set(snapshot?.players.map(p => p.id));
    for (const [id, g] of this.avatars) if (!ids.has(id) || g.userData.color !== playerColor(snapshot!.players.find(p => p.id === id)!, snapshot!.mode)) { this.scene.remove(g); g.traverse(o => { if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); } }); this.avatars.delete(id); this.rigs.delete(id); const shadow = this.avatarShadows.get(id); if (shadow) this.contactShadows.remove(shadow); this.avatarShadows.delete(id); }
    for (const p of snapshot?.players ?? []) {
      const g = this.avatars.get(p.id) ?? this.makeAvatar(p, snapshot!.mode); g.visible = p.realm === realm && p.alive && (inspecting || (thirdPerson && cameraGap > .65) || p.id !== (inRound ? follow?.id : undefined));
      g.userData.realm=p.realm;
      let aura=g.getObjectByName('warden-aura'); if(!aura){aura=new THREE.Group();aura.name='warden-aura';const ring=new THREE.Mesh(this.auraGeometry,this.auraMaterial);ring.rotation.x=Math.PI/2;ring.position.y=.15;aura.add(ring);for(let n=0;n<3;n++){const shard=new THREE.Mesh(this.runeGeometry,this.runeMaterials[n]);shard.position.set(Math.cos(n*2.094)*.8,1.4,Math.sin(n*2.094)*.8);aura.add(shard);}g.add(aura);} aura.visible=p.relics===7; aura.rotation.y=this.reduced?0:this.time*.8;
      // Hide only the followed avatar's name; it otherwise blocks the aiming area.
      for (const child of g.children) if (child instanceof THREE.Sprite) child.visible = p.id !== follow?.id || !inRound;
      const shadow = this.avatarShadows.get(p.id)!; shadow.visible = !wild && p.realm === realm && p.alive && p.y < 1.5; shadow.position.set(p.x, .014, p.z); shadow.scale.setScalar(.7 + p.y * .15);
      const rig = this.rigs.get(p.id)!, oldX = g.position.x, oldZ = g.position.z;
      const body = p.id === me?.id && local && inRound ? local : p;
      const target = new THREE.Vector3(body.x, body.y, body.z); if (body === local || g.position.distanceTo(target) > 4) g.position.copy(target); else g.position.lerp(target, 1 - Math.exp(-dt * 18));
      const travelled = Math.hypot(g.position.x - oldX, g.position.z - oldZ);
      if (travelled < 1 && body.grounded) rig.distance += travelled;
      rig.speed += ((snapshot?.phase === 'active' ? p.moveSpeed : 0) - rig.speed) * (1 - Math.exp(-dt * 15));
      const pose = locomotionPose(rig.distance, rig.speed, body.grounded, !!body.sprinting, body.vy);
      if (!rig.grounded && body.grounded) rig.landed = 1;
      rig.grounded = body.grounded; rig.landed = Math.max(0, rig.landed - dt * 6);
      g.position.y -= Math.sin(rig.landed * Math.PI) * .06;
      const scarf=g.getObjectByName('scarf')!;scarf.rotation.x=this.reduced?0:-rig.speed*.025+Math.sin(this.time*3+p.color)*.05;scarf.rotation.z=this.reduced?0:Math.sin(this.time*2+p.color)*.04;
      g.rotation.set(pose.lean, p.id === me?.id ? yaw : p.yaw, 0); rig.head.rotation.x = p.id === me?.id ? pitch : p.pitch;
      rig.leftLeg.rotation.x = pose.leftLeg; rig.rightLeg.rotation.x = pose.rightLeg;
      rig.leftArm.rotation.x = p.block ? -1.1 : pose.leftArm;
      rig.swing = Math.max(0, rig.swing - dt / .3);
      rig.rightArm.rotation.x = rig.swing > 0 ? -Math.sin(rig.swing * Math.PI) * 1.8 : p.weapon === 'apple' && p.charge > 0 ? 1.65 + (this.reduced ? 0 : Math.sin(this.time * 18) * .06) : p.charge > 0 || (p.weapon === 'crossbow' && p.loaded) ? -1.3 + p.pitch : pose.rightArm;
      rig.leftArm.rotation.z = p.block ? -.2 : Math.sin(rig.distance*1.3)*.04; rig.rightArm.rotation.z = rig.swing>0 ? -.4*Math.sin(rig.swing*Math.PI) : .04;
      rig.tool.visible = p.weapon !== 'apple' || p.apples > 0;
      rig.tool.rotation.x = p.weapon === 'apple' && p.charge > 0 ? -1.65 : 0;
      const shield = g.getObjectByName('shield')!; shield.visible = p.offhand === 'shield';
      g.getObjectByName('totem')!.visible = p.offhand === 'totem' && p.totems > 0;
      if (rig.toolName !== p.weapon) { rig.toolName = p.weapon; this.buildWeapon(rig.tool, p.weapon); }
      g.traverse(o => { if (o instanceof THREE.Mesh) { o.userData.baseMaterial ??= o.material; if (o.userData.armor) { const level = armorTier(p.xp).level; o.visible = level > 1; o.material = p.hurtTime > 0 ? this.material('#e77979') : this.armorMaterials[Math.max(0, level - 2)]; } else o.material = p.hurtTime > 0 ? this.material('#e77979') : o.userData.baseMaterial; } });
    }
    const arrowIds = new Set(snapshot?.arrows.map(a => a.id));
    for (const [id, m] of this.arrowMeshes) if (!arrowIds.has(id)) { this.scene.remove(m); this.arrowMeshes.delete(id); }
    for (const a of snapshot?.arrows ?? []) { let m = this.arrowMeshes.get(a.id); if (!m) { m = new THREE.Mesh(this.arrowGeo, this.material('#d8b277')); this.scene.add(m); this.arrowMeshes.set(a.id, m); } m.visible = (a.realm ?? 'arena') === realm; m.position.set(a.x, a.y, a.z); m.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz); }
    for (const [team, base] of this.bases) {
      base.visible = !!snapshot && isTeamMode(snapshot.mode);
      const flag = this.flags.get(team)!, state = snapshot?.flags.find(f => f.team === team); flag.visible = snapshot?.mode === 'ctf' && !!state;
      if (state) {
        const carrier = snapshot?.players.find(p => p.id === state.carrier), body = carrier?.id === me?.id && local ? local : carrier;
        flag.position.set(body?.x ?? state.x, (body?.y ?? state.y) + (state.state === 'carried' ? 1 : .02), body?.z ?? state.z);
        flag.rotation.set(0, this.reduced ? 0 : Math.sin(this.time * 2) * .08, state.state === 'dropped' ? -.65 : 0);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
