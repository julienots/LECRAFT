import * as THREE from 'three';

const R = 8;
const MAX = (2 * R + 1) * (2 * R + 1);

function makeTexture(draw: (c: CanvasRenderingContext2D) => void, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

/** Textures de remplacement (sans pack) au format de rain.png / snow.png (64 × 256). */
function defaultRain() {
  return makeTexture((c) => {
    let s = 4242;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(rnd() * 64), y = Math.floor(rnd() * 256), len = 6 + Math.floor(rnd() * 10);
      c.fillStyle = `rgba(${150 + rnd() * 40},${170 + rnd() * 40},255,${0.55 + rnd() * 0.35})`;
      c.fillRect(x, y, 1, len);
      if (y + len > 256) c.fillRect(x, y - 256, 1, len);
    }
  }, 64, 256);
}
function defaultSnow() {
  return makeTexture((c) => {
    let s = 777;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(rnd() * 63), y = Math.floor(rnd() * 255), k = rnd() < 0.4 ? 2 : 1;
      c.fillStyle = `rgba(255,255,255,${0.7 + rnd() * 0.3})`;
      c.fillRect(x, y, k, k);
    }
  }, 64, 256);
}

/**
 * Pluie / neige comme le jeu original : un « rideau » texturé (rain.png / snow.png) par colonne dans
 * un rayon de 8 blocs, tourné vers le joueur, qui défile vers le bas. Chaque rideau s'arrête sur le
 * plus haut bloc de sa colonne (pas de pluie sous un toit ou un arbre) et suit la lumière du monde.
 */
export class WeatherRenderer {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private pos = new Float32Array(MAX * 4 * 3);
  private uv = new Float32Array(MAX * 4 * 2);
  private shade = new Float32Array(MAX * 4 * 2);
  private rainTex: THREE.Texture;
  private snowTex: THREE.Texture;
  private own: THREE.Texture[] = [];
  /** Hauteur du plus haut bloc d'une colonne (fournie par la session). */
  heightAt: ((x: number, z: number) => number) | null = null;
  /** Lumière (0..1) à une position (fournie par la session). */
  lightAt: ((x: number, y: number, z: number) => number) | null = null;
  /** Colonnes où il pleut actuellement (pour les gouttes au sol). */
  readonly wet: { x: number; y: number; z: number }[] = [];

  constructor() {
    this.rainTex = this.tex(defaultRain());
    this.snowTex = this.tex(defaultSnow());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('shade', new THREE.BufferAttribute(this.shade, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array(MAX * 6);
    for (let q = 0; q < MAX; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: this.rainTex } },
      vertexShader: `attribute vec2 shade; varying vec2 vUv; varying vec2 vShade;
        void main(){ vUv = uv; vShade = shade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D uTex; varying vec2 vUv; varying vec2 vShade;
        void main(){ vec4 t = texture2D(uTex, vUv); float a = t.a * vShade.x; if (a < 0.02) discard; gl_FragColor = vec4(t.rgb * vShade.y, a); }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  private tex(img: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(img);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    this.own.push(t);
    return t;
  }

  /** Textures du pack (environment/rain.png, environment/snow.png) ou celles du jeu. */
  usePack(rain?: ImageBitmap | HTMLCanvasElement, snow?: ImageBitmap | HTMLCanvasElement) {
    const copy = (img: ImageBitmap | HTMLCanvasElement) => makeTexture((c) => c.drawImage(img, 0, 0), img.width, img.height);
    this.own.forEach((t) => t.dispose());
    this.own = [];
    this.rainTex = this.tex(rain ? copy(rain) : defaultRain());
    this.snowTex = this.tex(snow ? copy(snow) : defaultSnow());
  }

  update(t: number, cam: THREE.Vector3, intensity: number, snow: boolean, _sheltered = false) {
    this.wet.length = 0;
    if (intensity < 0.02 || !this.heightAt) {
      this.mesh.visible = false;
      return;
    }
    this.mat.uniforms.uTex.value = snow ? this.snowTex : this.rainTex;
    const cx = Math.floor(cam.x), cy = Math.floor(cam.y), cz = Math.floor(cam.z);
    let q = 0;
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > R * R) continue;
        const x = cx + dx, z = cz + dz;
        const top = this.heightAt(x, z) + 1;
        const y0 = Math.max(top, cy - R), y1 = cy + R;
        if (y0 >= y1) continue;
        if (top >= cy - R) this.wet.push({ x, y: top, z });
        // rideau perpendiculaire à la direction du joueur, centré sur la colonne
        const ox = x + 0.5 - cam.x, oz = z + 0.5 - cam.z, len = Math.hypot(ox, oz) || 1;
        const px = (-oz / len) * 0.5, pz = (ox / len) * 0.5;
        const mx = x + 0.5, mz = z + 0.5;
        this.pos.set([mx - px, y0, mz - pz, mx + px, y0, mz + pz, mx + px, y1, mz + pz, mx - px, y1, mz - pz], q * 12);
        // défilement vers le bas (phase propre à chaque colonne), neige plus lente et qui dérive
        const seed = ((x * 3121 + x * x * 45238971 + z * z * 418711 + z * 13761) & 31) / 32;
        const speed = snow ? 0.22 : 2.2 + seed * 0.4;
        const voff = t * speed + seed;
        const uoff = snow ? Math.sin(t * 0.7 + seed * 6) * 0.15 + seed : 0;
        this.uv.set([uoff, y0 * 0.25 + voff, uoff + 1, y0 * 0.25 + voff, uoff + 1, y1 * 0.25 + voff, uoff, y1 * 0.25 + voff], q * 8);
        const a = ((1 - d2 / (R * R)) * 0.5 + 0.5) * intensity;
        const l = this.lightAt ? this.lightAt(x, Math.max(y0, cy), z) : 1;
        this.shade.set([a, l, a, l, a, l, a, l], q * 8);
        q++;
      }
    const g = this.mesh.geometry;
    g.setDrawRange(0, q * 6);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('shade') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = q > 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.own.forEach((t) => t.dispose());
  }
}
