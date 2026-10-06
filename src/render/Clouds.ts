import * as THREE from 'three';

/** Taille d'une cellule de nuage (1 pixel de clouds.png) et épaisseur, en blocs (comme le jeu original). */
const CELL = 12;
const THICK = 4;
/** Altitude du bas des nuages (le monde fait 128 blocs de haut). */
export const CLOUD_Y = 118;
/** Rayon (en cellules) des nuages affichés autour du joueur. */
const R = 16;
/** Vitesse de défilement vers l'est (blocs/s). */
const SPEED = 0.6;

const vert = /* glsl */ `
attribute vec3 color;
varying vec3 vColor;
varying float vDist;
uniform vec3 uCam;
void main() {
  vColor = color;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDist = length(wp.xz - uCam.xz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const frag = /* glsl */ `
varying vec3 vColor;
varying float vDist;
uniform vec3 uTint;
uniform float uOpacity;
uniform float uRadius;
void main() {
  float a = uOpacity * (1.0 - smoothstep(uRadius * 0.55, uRadius, vDist));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * uTint, a);
}`;

/**
 * Nuages en 3D comme le jeu original : chaque pixel opaque de clouds.png devient un bloc de nuage de
 * 12 × 4 × 12 blocs, faces ombrées (dessus 1, côtés 0,9 / 0,8, dessous 0,7), sans faces entre deux
 * nuages voisins. Ils défilent vers l'est et s'estompent au loin. Rendu en deux passes (profondeur
 * puis couleur) pour qu'on ne voie pas l'intérieur des nuages à travers leur transparence.
 */
export class Clouds3D {
  readonly group = new THREE.Group();
  private geo = new THREE.BufferGeometry();
  private depthMesh: THREE.Mesh;
  private colorMesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private grid = new Uint8Array(1);
  private w = 1;
  private h = 1;
  private builtX = NaN;
  private builtZ = NaN;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uTint: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0.8 }, uRadius: { value: R * CELL } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthFunc: THREE.LessEqualDepth,
      depthWrite: false,
    });
    const depth = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.material.uniforms, colorWrite: false, depthWrite: true });
    this.depthMesh = new THREE.Mesh(this.geo, depth);
    this.colorMesh = new THREE.Mesh(this.geo, this.material);
    this.depthMesh.renderOrder = 1.9;
    this.colorMesh.renderOrder = 2;
    this.depthMesh.frustumCulled = this.colorMesh.frustumCulled = false;
    this.group.add(this.depthMesh, this.colorMesh);
  }

  /** Forme des nuages : pixels opaques de l'image (clouds.png du pack ou image générée). */
  setImage(img: HTMLCanvasElement) {
    this.w = img.width;
    this.h = img.height;
    const d = img.getContext('2d')!.getImageData(0, 0, this.w, this.h).data;
    this.grid = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = d[i * 4 + 3] > 64 ? 1 : 0;
    this.builtX = NaN;
  }

  private solid(cx: number, cz: number) {
    const x = ((cx % this.w) + this.w) % this.w, z = ((cz % this.h) + this.h) % this.h;
    return this.grid[x + z * this.w] === 1;
  }

  /** Reconstruit les cellules autour de la cellule (ox, oz) (repère des nuages). */
  private build(ox: number, oz: number) {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const quad = (p: number[], shade: number) => {
      const b = pos.length / 3;
      pos.push(...p);
      for (let i = 0; i < 4; i++) col.push(shade, shade, shade);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
        const cx = ox + dx, cz = oz + dz;
        if (!this.solid(cx, cz)) continue;
        const x0 = dx * CELL, x1 = x0 + CELL, z0 = dz * CELL, z1 = z0 + CELL, y0 = 0, y1 = THICK;
        quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], 1);
        quad([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], 0.7);
        if (!this.solid(cx + 1, cz)) quad([x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], 0.9);
        if (!this.solid(cx - 1, cz)) quad([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], 0.9);
        if (!this.solid(cx, cz + 1)) quad([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], 0.8);
        if (!this.solid(cx, cz - 1)) quad([x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], 0.8);
      }
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geo.setIndex(idx);
    this.geo.computeBoundingSphere();
    this.builtX = ox;
    this.builtZ = oz;
  }

  update(cam: THREE.Vector3, elapsed: number, tint: THREE.Color, opacity: number) {
    const scroll = elapsed * SPEED;
    // cellule du joueur dans le repère des nuages (qui glisse vers +x)
    const ox = Math.floor((cam.x - scroll) / CELL), oz = Math.floor(cam.z / CELL);
    if (ox !== this.builtX || oz !== this.builtZ) this.build(ox, oz);
    this.group.position.set(ox * CELL + scroll, CLOUD_Y, oz * CELL);
    const u = this.material.uniforms;
    u.uCam.value.copy(cam);
    u.uTint.value.copy(tint);
    u.uOpacity.value = opacity;
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
    (this.depthMesh.material as THREE.Material).dispose();
  }
}
