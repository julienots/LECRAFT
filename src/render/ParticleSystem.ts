import * as THREE from 'three';
import type { ParticleFx } from '../core/GameContext';
import { BlockRegistry } from '../blocks/BlockRegistry';
import type { TextureManager } from './TextureManager';
import { ATLAS_COLS, TILE_PX } from './TileRegistry';
import { ParticleSprites, SHRINKING } from './ParticleSprites';

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
  /** Morceau de texture : (u0, v0, taille, mode) ; mode 1 = atlas des blocs, 2 = sprite de particule. */
  private tile: Float32Array;
  /** Sprites animés : première case et nombre d'images (1 = fixe), sens (1 = de la grande à la petite). */
  private animBase: Int16Array;
  private animN: Uint8Array;
  private animRev: Uint8Array;
  readonly sprites: ParticleSprites;
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
    this.animBase = new Int16Array(capacity);
    this.animN = new Uint8Array(capacity);
    this.animRev = new Uint8Array(capacity);
    this.sprites = new ParticleSprites(textures);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('tile', new THREE.BufferAttribute(this.tile, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 }, uAtlas: { value: textures.atlas }, uSprites: { value: this.sprites.texture } },
      vertexShader: `attribute float psize; attribute vec3 color; attribute vec4 tile; varying vec3 vColor; varying vec4 vTile; uniform float uScale;
        void main(){ vColor = color; vTile = tile; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = max(1.0, psize * uScale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      // fragments de blocs : un carré de 4×4 pixels de la texture du bloc (comme le jeu original)
      fragmentShader: `uniform sampler2D uAtlas; uniform sampler2D uSprites; varying vec3 vColor; varying vec4 vTile;
        void main(){
          if (vTile.w > 1.5) {
            // sprite de particule du jeu original (teinté par la couleur de la particule)
            vec4 t = texture2D(uSprites, vec2(vTile.x + gl_PointCoord.x * vTile.z, vTile.y - gl_PointCoord.y * vTile.z));
            if (t.a < 0.1) discard;
            gl_FragColor = vec4(t.rgb * vColor, 1.0);
          } else if (vTile.w > 0.5) {
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
    this.animN[i] = 0;
  }

  /**
   * Particule dessinée avec un sprite du jeu original (`name`, animé s'il a plusieurs images).
   * La couleur multiplie la texture (sprites gris : fumée, sorts, notes ; colorés : flamme, cœur).
   */
  sprite(name: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, size: number, life: number, gravity: number, frame = -1) {
    if (this.count >= this.limit) return;
    const i = this.count;
    this.emit(x, y, z, vx, vy, vz, r, g, b, size, life, gravity);
    const n = this.sprites.frames(name);
    const animated = n > 1 && frame < 0;
    const cell = this.sprites.cell(name, animated ? (SHRINKING.has(name) ? n - 1 : 0) : Math.max(0, frame));
    if (cell < 0) return;
    const [u, v, sz] = this.sprites.uv(cell);
    this.tile[i * 4] = u;
    this.tile[i * 4 + 1] = v;
    this.tile[i * 4 + 2] = sz;
    this.tile[i * 4 + 3] = 2;
    this.animN[i] = animated ? n : 0;
    this.animBase[i] = this.sprites.cell(name, 0);
    this.animRev[i] = SHRINKING.has(name) ? 1 : 0;
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
    const R = Math.random;
    for (let i = 0; i < count; i++) {
      const rx = R() - 0.5, ry = R(), rz = R() - 0.5;
      switch (kind) {
        // fumée grise qui monte en rétrécissant (sprites « generic »)
        case 'smoke': { const v = 0.5 + R() * 0.3; this.sprite('generic', x + rx * 0.6, y + ry * 0.5, z + rz * 0.6, rx * 0.5, 0.8 + ry, rz * 0.5, v, v, v, 0.14, 1 + R(), -0.5); break; }
        case 'small_smoke': { const v = 0.35 + R() * 0.15; this.sprite('generic', x + rx * 0.1, y, z + rz * 0.1, rx * 0.1, 0.4 + ry * 0.2, rz * 0.1, v, v, v, 0.07, 0.8 + R() * 0.6, -0.15); break; }
        case 'campfire_smoke': { const v = 0.75 + R() * 0.15; this.sprite('big_smoke', x + rx * 0.5, y, z + rz * 0.5, rx * 0.05, 0.9 + R() * 0.3, rz * 0.05, v, v, v, 0.45, 6 + R() * 4, -0.05); break; }
        case 'fire': this.sprite('flame', x + rx * 0.5, y + ry * 0.3, z + rz * 0.5, rx * 0.4, 1.2 + ry, rz * 0.4, 1, 1, 1, 0.1, 0.5 + R() * 0.4, -1); break;
        case 'flame': this.sprite('flame', x + rx * 0.04, y, z + rz * 0.04, 0, 0.05, 0, 1, 1, 1, 0.07, 0.5 + R() * 0.4, -0.2); break;
        case 'soul_flame': this.sprite('soul_fire_flame', x + rx * 0.04, y, z + rz * 0.04, 0, 0.05, 0, 1, 1, 1, 0.07, 0.5 + R() * 0.4, -0.2); break;
        case 'lava': this.sprite('lava', x + rx, y + 0.9, z + rz, rx * 2, 3 + ry * 3, rz * 2, 1, 1, 1, 0.09, 1 + R(), 12); break;
        case 'water': this.sprite('splash', x + rx, y + ry * 0.3, z + rz, rx * 3, 2 + ry * 3, rz * 3, 0.55, 0.7, 1, 0.08, 0.6, 14); break;
        case 'bubble': this.sprite('bubble', x + rx * 0.4, y + ry * 0.4, z + rz * 0.4, rx * 0.4, 1.2 + ry, rz * 0.4, 1, 1, 1, 0.07, 0.8 + R() * 1.2, -0.5); break;
        case 'drip_water': this.sprite('drip_fall', x, y, z, 0, -0.2, 0, 0.25, 0.45, 1, 0.06, 1.2, 9); break;
        case 'drip_lava': this.sprite('drip_fall', x, y, z, 0, -0.2, 0, 1, 0.45, 0.1, 0.06, 1.5, 9); break;
        // cœurs rouges (reproduction, apprivoisement) et cœurs sombres (dégâts)
        case 'hearts': this.sprite('heart', x + rx * 0.8, y + ry * 0.5, z + rz * 0.8, rx * 0.5, 1.5, rz * 0.5, 1, 1, 1, 0.12, 1.2, 0); break;
        case 'damage': this.sprite('damage', x + rx * 0.6, y + ry * 0.4, z + rz * 0.6, rx * 3, 1 + ry * 2, rz * 3, 1, 1, 1, 0.1, 0.5, 10); break;
        case 'explosion': { const v = 0.75 + R() * 0.25; this.sprite('explosion', x + rx * 2, y + ry * 1.5, z + rz * 2, 0, 0, 0, v, v, v, 0.9 + R() * 0.6, 0.3 + R() * 0.3, 0); break; }
        case 'magic': this.sprite('spell', x + rx, y + ry, z + rz, rx * 2, 1 + ry * 2, rz * 2, 0.7 + R() * 0.3, 0.35, 1, 0.1, 0.9, -1); break;
        case 'portal': {
          // particules de portail : partent autour du bloc et se rapprochent de lui
          const ox = rx * 2, oy = ry * 2 - 0.5, oz = rz * 2;
          const v = 0.55 + R() * 0.45;
          this.sprite('generic', x + ox, y + oy, z + oz, -ox * 1.5, -oy * 1.5, -oz * 1.5, v * 0.8, v * 0.3, v, 0.08, 0.6 + R() * 0.4, 0, 0);
          break;
        }
        case 'dust': { const v = 0.55 + R() * 0.2; this.emit(x + rx, y + ry * 0.3, z + rz, rx * 3, 0.5 + ry * 1.5, rz * 3, v + 0.1, v, v * 0.8, 0.11, 0.7, 2); break; }
        case 'ice': this.sprite('glitter', x + rx * 0.8, y + ry * 0.6, z + rz * 0.8, rx * 3, 1 + ry * 3, rz * 3, 0.75, 0.92, 1, 0.09, 0.7, 8); break;
        case 'rain': { const l = this.light(x, y + 0.2, z); this.sprite('splash', x, y, z, rx * 1.2, 1 + ry * 1.2, rz * 1.2, 0.55 * l, 0.65 * l, 1 * l, 0.06, 0.25 + R() * 0.15, 12); break; }
        case 'crit': this.sprite('critical_hit', x + rx * 0.8, y + (ry - 0.5) * 0.8, z + rz * 0.8, rx * 7, ry * 4, rz * 7, 1, 1, 1, 0.08, 0.35 + R() * 0.25, 6); break;
        case 'enchanted_hit': this.sprite('enchanted_hit', x + rx * 0.8, y + (ry - 0.5) * 0.8, z + rz * 0.8, rx * 7, ry * 4, rz * 7, 1, 1, 1, 0.08, 0.35 + R() * 0.25, 6); break;
        case 'sweep': this.sprite('sweep', x, y, z, 0, 0, 0, 1, 1, 1, 0.9, 0.25, 0); i = count; break;
        case 'poof': { const v = 0.82 + R() * 0.18; this.sprite('generic', x + rx * 1.2, y + (ry - 0.5) * 1.2, z + rz * 1.2, rx * 1.2, 0.4 + ry * 0.8, rz * 1.2, v, v, v, 0.16 + R() * 0.06, 0.5 + R() * 0.5, -0.4); break; }
        case 'crystal': this.sprite('glitter', x + rx * 0.8, y + ry * 0.6, z + rz * 0.8, rx * 3, 1 + ry * 3, rz * 3, 0.4, 0.95, 0.98, 0.09, 0.7, 6); break;
        case 'end_rod': this.sprite('glitter', x + rx * 0.2, y + ry * 0.2, z + rz * 0.2, rx * 0.3, 0.1 + ry * 0.3, rz * 0.3, 1, 1, 1, 0.06, 1.5 + R(), -0.1); break;
        case 'totem': { const g = R() < 0.5; this.sprite('glitter', x + rx, y + ry * 1.5, z + rz, rx * 8, 2 + ry * 6, rz * 8, g ? 0.4 : 0.95, g ? 0.9 : 0.85, g ? 0.2 : 0.25, 0.1, 1.5 + R(), 3); break; }
        case 'happy': this.sprite('glint', x + rx * 0.8, y + ry, z + rz * 0.8, 0, 0.3, 0, 0.35, 1, 0.35, 0.08, 1 + R(), 0); break;
        case 'angry': this.sprite('angry', x + rx * 0.6, y + ry * 0.4, z + rz * 0.6, 0, 0.6, 0, 1, 1, 1, 0.12, 1, 0); break;
        case 'ash': this.sprite('generic', x + rx * 16, y + ry * 8 - 2, z + rz * 16, rx * 0.4, -0.15 - ry * 0.2, rz * 0.4, 0.28, 0.25, 0.25, 0.05, 4 + R() * 3, 0, 1); break;
        case 'white_ash': this.sprite('generic', x + rx * 16, y + ry * 8 - 2, z + rz * 16, rx * 0.4, -0.15 - ry * 0.2, rz * 0.4, 0.9, 0.9, 0.9, 0.05, 4 + R() * 3, 0, 1); break;
        case 'crimson_spore': this.sprite('generic', x + rx * 16, y + ry * 8 - 2, z + rz * 16, rx * 0.3, -0.1, rz * 0.3, 0.9, 0.15, 0.15, 0.05, 4 + R() * 3, 0, 1); break;
        case 'warped_spore': this.sprite('generic', x + rx * 16, y + ry * 8 - 2, z + rz * 16, rx * 0.3, 0.2, rz * 0.3, 0.25, 0.75, 0.8, 0.05, 4 + R() * 3, 0, 1); break;
        case 'sonic': this.sprite('sonic_boom', x, y, z, 0, 0, 0, 1, 1, 1, 0.8, 0.5, 0); break;
        case 'soul': this.sprite('soul', x + rx * 0.6, y + 0.1, z + rz * 0.6, 0, 0.6, 0, 1, 1, 1, 0.12, 1.2, 0); break;
      }
    }
  }

  /** Tourbillon d'effet de statut (couleur de l'effet), comme le jeu original. */
  effectSwirl(x: number, y: number, z: number, r: number, g: number, b: number) {
    this.sprite('effect', x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, 0, 0.5, 0, r, g, b, 0.1, 0.8 + Math.random() * 0.4, -0.2);
  }

  /** Glyphe d'enchantement qui vole d'une bibliothèque vers la table. */
  enchantGlyph(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number) {
    const t = 1.2 + Math.random() * 0.4;
    this.sprite('sga', fx, fy, fz, (tx - fx) / t, (ty - fy) / t + 0.6, (tz - fz) / t, 1, 1, 1, 0.07, t, 1, Math.floor(Math.random() * 26));
  }

  /** Note de musique (bloc musical) : couleur selon la hauteur, comme le jeu original. */
  note(x: number, y: number, z: number, pitch01: number) {
    const h = pitch01 * Math.PI * 2;
    const c = (o: number) => Math.max(0, Math.sin(h + o) * 0.65 + 0.35);
    this.sprite('note', x, y, z, 0, 0.6, 0, c(0), c(2.09), c(4.19), 0.12, 0.8, 0);
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
          this.animBase[i] = this.animBase[last];
          this.animN[i] = this.animN[last];
          this.animRev[i] = this.animRev[last];
        }
        continue;
      }
      // sprite animé : image selon l'âge (comme setSpriteFromAge du jeu original)
      const n = this.animN[i];
      if (n > 1) {
        const f = Math.min(n - 1, Math.floor((1 - this.life[i] / this.maxLife[i]) * n));
        const [u, v] = this.sprites.uv(this.animBase[i] + (this.animRev[i] ? n - 1 - f : f));
        this.tile[i * 4] = u;
        this.tile[i * 4 + 1] = v;
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
    this.sprites.dispose();
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
