import * as THREE from 'three';
import type { ParticleFx } from '../core/GameContext';
import { BlockRegistry } from '../blocks/BlockRegistry';
import type { TextureManager } from './TextureManager';

/**
 * Système de particules à pool fixe (aucune allocation pendant le jeu) rendu en un seul draw call.
 * Le nombre maximal dépend du profil de qualité et du réglage « Particules ».
 */
export class ParticleSystem implements ParticleFx {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private count = 0;
  private colorCache = new Map<number, [number, number, number]>();
  limit: number;

  constructor(capacity: number, private textures: TextureManager) {
    this.limit = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } },
      vertexShader: `attribute float psize; attribute vec3 color; varying vec3 vColor; uniform float uScale;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = max(1.0, psize * uScale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vColor; void main(){ gl_FragColor = vec4(vColor, 1.0); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setScale(viewportHeight: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = viewportHeight * 0.5;
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, size: number, life: number, gravity: number) {
    if (this.count >= this.limit) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
  }

  private blockColor(block: number): [number, number, number] {
    let c = this.colorCache.get(block);
    if (!c) {
      const b = BlockRegistry.get(block);
      c = this.textures.tileColor(b.faceTiles[0]);
      this.colorCache.set(block, c);
    }
    return c;
  }

  blockBreak(x: number, y: number, z: number, block: number) {
    const [r, g, b] = this.blockColor(block);
    for (let i = 0; i < 14; i++) {
      const v = 0.75 + Math.random() * 0.4;
      this.emit(x + Math.random(), y + Math.random(), z + Math.random(), (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, r * v, g * v, b * v, 0.09 + Math.random() * 0.05, 0.5 + Math.random() * 0.5, 14);
    }
  }

  /** Feuille qui tombe lentement en se balançant sous un bloc de feuillage. */
  fallingLeaf(x: number, y: number, z: number, block: number, tint: [number, number, number] | null) {
    let [r, g, b] = this.blockColor(block);
    if (tint) [r, g, b] = [r * tint[0], g * tint[1], b * tint[2]];
    const v = 0.85 + Math.random() * 0.25;
    this.emit(x + Math.random(), y - 0.05, z + Math.random(), (Math.random() - 0.5) * 0.6, -0.3, (Math.random() - 0.5) * 0.6, r * v, g * v, b * v, 0.1, 3 + Math.random() * 2, 0.15);
  }

  /** Poussière soulevée en sprintant (couleur du bloc sous les pieds). */
  sprintDust(x: number, y: number, z: number, block: number) {
    const [r, g, b] = this.blockColor(block);
    const v = 0.8 + Math.random() * 0.3;
    this.emit(x + (Math.random() - 0.5) * 0.5, y + 0.05, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5, r * v, g * v, b * v, 0.07, 0.35, 10);
  }

  blockHit(x: number, y: number, z: number, block: number, nx: number, ny: number, nz: number) {
    const [r, g, b] = this.blockColor(block);
    for (let i = 0; i < 3; i++) {
      const px = x + 0.5 + nx * 0.52 + (nx ? 0 : Math.random() - 0.5), py = y + 0.5 + ny * 0.52 + (ny ? 0 : Math.random() - 0.5), pz = z + 0.5 + nz * 0.52 + (nz ? 0 : Math.random() - 0.5);
      this.emit(px, py, pz, nx * 2 + (Math.random() - 0.5), ny * 2 + Math.random() * 2, nz * 2 + (Math.random() - 0.5), r, g, b, 0.07, 0.35, 12);
    }
  }

  burst(kind: Parameters<ParticleFx['burst']>[0], x: number, y: number, z: number, count = 8) {
    for (let i = 0; i < count; i++) {
      const rx = (Math.random() - 0.5), ry = Math.random(), rz = (Math.random() - 0.5);
      switch (kind) {
        case 'smoke': { const v = 0.5 + Math.random() * 0.3; this.emit(x + rx * 0.6, y + ry * 0.5, z + rz * 0.6, rx * 0.5, 0.8 + ry, rz * 0.5, v, v, v, 0.12, 1 + Math.random(), -0.5); break; }
        case 'fire': this.emit(x + rx * 0.5, y + ry * 0.3, z + rz * 0.5, rx * 0.4, 1.2 + ry, rz * 0.4, 1, 0.5 + Math.random() * 0.4, 0.1, 0.09, 0.5 + Math.random() * 0.4, -1); break;
        case 'lava': this.emit(x + rx, y + 0.9, z + rz, rx * 2, 3 + ry * 3, rz * 2, 1, 0.45, 0.05, 0.08, 1, 12); break;
        case 'water': this.emit(x + rx, y + ry * 0.3, z + rz, rx * 3, 2 + ry * 3, rz * 3, 0.35, 0.55, 0.95, 0.07, 0.6, 14); break;
        case 'damage': this.emit(x + rx * 0.6, y + ry * 0.4, z + rz * 0.6, rx * 3, 1 + ry * 2, rz * 3, 0.85, 0.08, 0.08, 0.1, 0.5, 10); break;
        case 'explosion': { const v = 0.4 + Math.random() * 0.4; this.emit(x + rx, y + ry, z + rz, rx * 10, ry * 6, rz * 10, v + 0.3, v, v * 0.8, 0.18, 0.8 + Math.random() * 0.6, 4); break; }
        case 'magic': this.emit(x + rx, y + ry, z + rz, rx * 2, 1 + ry * 2, rz * 2, 0.7 + Math.random() * 0.3, 0.3, 1, 0.08, 0.9, -1); break;
        case 'hearts': this.emit(x + rx * 0.8, y + ry * 0.5, z + rz * 0.8, rx * 0.5, 1.5, rz * 0.5, 1, 0.3, 0.45, 0.14, 1.2, 0); break;
        case 'dust': { const v = 0.55 + Math.random() * 0.2; this.emit(x + rx, y + ry * 0.3, z + rz, rx * 3, 0.5 + ry * 1.5, rz * 3, v + 0.1, v, v * 0.8, 0.11, 0.7, 2); break; }
        case 'ice': this.emit(x + rx * 0.8, y + ry * 0.6, z + rz * 0.8, rx * 3, 1 + ry * 3, rz * 3, 0.75, 0.92, 1, 0.09, 0.7, 8); break;
        case 'poof': { const v = 0.82 + Math.random() * 0.18; this.emit(x + rx * 1.2, y + (ry - 0.5) * 1.2, z + rz * 1.2, rx * 1.2, 0.4 + ry * 0.8, rz * 1.2, v, v, v, 0.13 + Math.random() * 0.06, 0.5 + Math.random() * 0.5, -0.4); break; }
        case 'crystal': this.emit(x + rx * 0.8, y + ry * 0.6, z + rz * 0.8, rx * 3, 1 + ry * 3, rz * 3, 0.4, 0.95, 0.98, 0.09, 0.7, 6); break;
      }
    }
  }

  update(dt: number) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // retire en échangeant avec le dernier
        const last = --this.count;
        if (i !== last) {
          this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.size[i] = this.size[last];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.grav[i] = this.grav[last];
        }
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = Math.pow(0.4, dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    if (this.count > 0) {
      (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('psize') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  get active() {
    return this.count;
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
