import * as THREE from 'three';
import type { ParticleFx } from '../core/GameContext';
import { BlockRegistry } from '../blocks/BlockRegistry';
import type { TextureManager } from './TextureManager';
import { ATLAS_COLS, TILE_PX } from './TileRegistry';

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
  /** Morceau de texture : (u0, v0, taille, 1 si texturé) dans l'atlas des blocs. */
  private tile: Float32Array;
  private count = 0;
  /** Lumière (0..1) à une position du monde, fournie par la session (fragments de blocs). */
  lightAt: ((x: number, y: number, z: number) => number) | null = null;
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
    this.tile = new Float32Array(capacity * 4);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('tile', new THREE.BufferAttribute(this.tile, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 }, uAtlas: { value: textures.atlas } },
      vertexShader: `attribute float psize; attribute vec3 color; attribute vec4 tile; varying vec3 vColor; varying vec4 vTile; uniform float uScale;
        void main(){ vColor = color; vTile = tile; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = max(1.0, psize * uScale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      // fragments de blocs : un carré de 4×4 pixels de la texture du bloc (comme le jeu original)
      fragmentShader: `uniform sampler2D uAtlas; varying vec3 vColor; varying vec4 vTile;
        void main(){
          if (vTile.w > 0.5) {
            vec4 t = texture2D(uAtlas, vec2(vTile.x + gl_PointCoord.x * vTile.z, vTile.y - gl_PointCoord.y * vTile.z));
            if (t.a < 0.5) discard;
            gl_FragColor = vec4(t.rgb * vColor, 1.0);
          } else gl_FragColor = vec4(vColor, 1.0);
        }`,
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
    this.tile[i * 4 + 3] = 0;
  }

  /** Teinte (herbe/feuillage/fixe) et tuile utilisées pour les fragments d'un bloc. */
  private blockLook(block: number): { tile: number; tint: [number, number, number] } {
    const b = BlockRegistry.get(block);
    // l'herbe se casse en fragments de terre, comme le jeu original
    if (b.key === 'grass_block') return { tile: b.faceTiles[3], tint: [1, 1, 1] };
    const t = BlockRegistry.tintType[block];
    const c = BlockRegistry.tintColor[block];
    const tint: [number, number, number] = t === 1 ? [0.57, 0.74, 0.35] : t === 2 ? [0.47, 0.72, 0.28] : t === 3 ? [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255] : [1, 1, 1];
    return { tile: b.faceTiles[0], tint };
  }

  /** Fragment texturé : un morceau 4×4 px pris au hasard dans la tuile. */
  private emitPiece(tileIndex: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, size: number, life: number, gravity: number) {
    if (this.count >= this.limit) return;
    const i = this.count;
    this.emit(x, y, z, vx, vy, vz, r, g, b, size, life, gravity);
    const W = this.textures.atlasCanvas.width, H = this.textures.atlasCanvas.height;
    const px = (tileIndex % ATLAS_COLS) * TILE_PX + Math.floor(Math.random() * 3) * 4;
    const py = Math.floor(tileIndex / ATLAS_COLS) * TILE_PX + Math.floor(Math.random() * 3) * 4;
    this.tile[i * 4] = px / W;
    this.tile[i * 4 + 1] = 1 - py / H;
    this.tile[i * 4 + 2] = 4 / W;
    this.tile[i * 4 + 3] = 1;
  }

  private light(x: number, y: number, z: number) {
    return this.lightAt ? this.lightAt(x, y, z) : 1;
  }

  /** Bloc cassé : 4×4×4 fragments de sa texture projetés depuis le centre (comme le jeu original). */
  blockBreak(x: number, y: number, z: number, block: number) {
    const { tile, tint } = this.blockLook(block);
    const l = this.light(x + 0.5, y + 0.5, z + 0.5);
    const n = this.limit - this.count >= 64 ? 4 : 2;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++) {
          const fx = (i + 0.5) / n, fy = (j + 0.5) / n, fz = (k + 0.5) / n;
          const v = l * (0.85 + Math.random() * 0.15);
          this.emitPiece(tile, x + fx, y + fy, z + fz, (fx - 0.5) * 4 + (Math.random() - 0.5), (fy - 0.5) * 4 + Math.random() * 2, (fz - 0.5) * 4 + (Math.random() - 0.5), tint[0] * v, tint[1] * v, tint[2] * v, 0.1 + Math.random() * 0.06, 0.3 + Math.random() * 0.7, 14);
        }
  }

  /** Poussière soulevée en sprintant (fragments du bloc sous les pieds). */
  sprintDust(x: number, y: number, z: number, block: number) {
    const { tile, tint } = this.blockLook(block);
    const v = this.light(x, y + 0.2, z) * (0.85 + Math.random() * 0.15);
    this.emitPiece(tile, x + (Math.random() - 0.5) * 0.5, y + 0.05, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5, tint[0] * v, tint[1] * v, tint[2] * v, 0.07, 0.35, 10);
  }

  /** Bloc frappé pendant le minage : quelques fragments sur la face visée. */
  blockHit(x: number, y: number, z: number, block: number, nx: number, ny: number, nz: number) {
    const { tile, tint } = this.blockLook(block);
    const l = this.light(x + 0.5 + nx, y + 0.5 + ny, z + 0.5 + nz);
    for (let i = 0; i < 2; i++) {
      const px = x + 0.5 + nx * 0.52 + (nx ? 0 : Math.random() - 0.5), py = y + 0.5 + ny * 0.52 + (ny ? 0 : Math.random() - 0.5), pz = z + 0.5 + nz * 0.52 + (nz ? 0 : Math.random() - 0.5);
      const v = l * (0.8 + Math.random() * 0.2);
      this.emitPiece(tile, px, py, pz, nx * 2 + (Math.random() - 0.5), ny * 2 + Math.random() * 2, nz * 2 + (Math.random() - 0.5), tint[0] * v, tint[1] * v, tint[2] * v, 0.08, 0.35, 12);
    }
  }

  /** Feuille qui tombe lentement en se balançant sous un bloc de feuillage. */
  fallingLeaf(x: number, y: number, z: number, block: number, tint: [number, number, number] | null) {
    const { tile } = this.blockLook(block);
    const t = tint ?? [1, 1, 1];
    const v = this.light(x + 0.5, y - 0.5, z + 0.5) * (0.85 + Math.random() * 0.25);
    this.emitPiece(tile, x + Math.random(), y - 0.05, z + Math.random(), (Math.random() - 0.5) * 0.6, -0.3, (Math.random() - 0.5) * 0.6, t[0] * v, t[1] * v, t[2] * v, 0.1, 3 + Math.random() * 2, 0.15);
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
        case 'rain': { const l = this.light(x, y + 0.2, z); this.emit(x, y, z, rx * 1.2, 1 + ry * 1.2, rz * 1.2, 0.45 * l, 0.55 * l, 0.95 * l, 0.05, 0.25 + Math.random() * 0.15, 12); break; }
        case 'crit': { const v = 0.7 + Math.random() * 0.3; this.emit(x + rx * 0.8, y + (ry - 0.5) * 0.8, z + rz * 0.8, rx * 7, ry * 4, rz * 7, v, v * 0.9, v * 0.72, 0.08, 0.35 + Math.random() * 0.25, 6); break; }
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
          this.tile.copyWithin(i * 4, last * 4, last * 4 + 4);
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
      (this.geo.getAttribute('tile') as THREE.BufferAttribute).needsUpdate = true;
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
