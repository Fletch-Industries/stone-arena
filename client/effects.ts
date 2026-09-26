import * as THREE from 'three';

const FRAMES = 16;
/** Original pixel fire, generated once and animated by atlas offsets (no uploads per frame). */
export class FlameAtlas {
  texture: THREE.CanvasTexture;
  constructor() {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 32 * FRAMES;
    const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(canvas.width, canvas.height);
    for (let frame = 0; frame < FRAMES; frame++) for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) {
      const phase = frame / FRAMES * Math.PI * 2, height = (31 - y) / 31;
      const center = 7.5 + Math.sin(phase + height * 7) * height * 2;
      const edge = Math.abs(x - center) / 8;
      const tongue = .62 + .19 * Math.sin(x * 1.4 + phase) + .14 * Math.sin(x * 2.7 - phase * 2);
      if (height > tongue || edge > 1 - height * .72) continue;
      const heat = Math.max(0, 1 - height / tongue - edge * .32);
      const palette = heat > .65 ? [255, 244, 155] : heat > .4 ? [255, 205, 65] : heat > .15 ? [255, 129, 26] : [226, 65, 18];
      const offset = ((frame * 32 + y) * 16 + x) * 4;
      pixels.data.set([...palette, 255], offset);
    }
    ctx.putImageData(pixels, 0, 0);
    this.texture = new THREE.CanvasTexture(canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter; this.texture.generateMipmaps = false;
    this.texture.repeat.y = 1 / FRAMES;
  }
  material() {
    const map = this.texture.clone();
    return new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, alphaTest: .5, toneMapped: false });
  }
  animate(material: THREE.MeshBasicMaterial, time: number, offset: number, reduced: boolean) {
    const frame = reduced ? offset * 3 : (Math.floor(time * 12) + offset * 3) % FRAMES;
    material.map!.offset.y = frame / FRAMES;
    const light = reduced ? 1 : .94 + .04 * Math.sin(time * 7 + offset) + .02 * Math.sin(time * 13 + offset * 2);
    material.color.setRGB(light, light, light);
  }
}

/** Shared Phong materials retain inexpensive highlights plus a moving violet glint. */
export function armorMaterial(map: THREE.Texture, enchanted: boolean, time: { value: number }) {
  const material = new THREE.MeshPhongMaterial({ map, color: enchanted ? '#b7a4b0' : '#bec4cf', emissive: enchanted ? '#261d31' : '#10141b', emissiveIntensity: .35, specular: '#d4c3f3', shininess: 85 });
  if (enchanted) {
    material.onBeforeCompile = shader => {
      shader.uniforms.armorTime = time;
      shader.vertexShader = 'varying vec3 vArmorWorld;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvArmorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = 'uniform float armorTime;\nvarying vec3 vArmorWorld;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
        vec3 grid = floor(vArmorWorld * 32.0) / 32.0;
        float sheen = smoothstep(0.72, 0.98, sin((grid.y * 1.7 + grid.x * 0.65 - armorTime * 0.28) * 6.283185));
        outgoingLight += vec3(0.19, 0.045, 0.40) * sheen;
        #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'stone-enchanted-armor-v1';
  }
  return material;
}
