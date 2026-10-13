/**
 * Atlas des particules : les textures du jeu original (`textures/particle/*.png` du pack :
 * flamme, fumée animée, cœurs, notes, glyphes d'enchantement, bulles, gouttes, sorts…), réunies
 * dans une seule texture de 256 × 256 (cases de 16 px). Sans pack, chaque sprite est dessiné
 * (formes simples en niveaux de gris, teintées par la couleur de la particule).
 */
import * as THREE from 'three';
import type { TextureManager } from './TextureManager';

const CELL = 16;
const COLS = 16;

/** Sprites (nom → nombre d'images ; 1 = fixe). */
export const SPRITE_SETS: Record<string, number> = {
  flame: 1, soul_fire_flame: 1, copper_fire_flame: 1, lava: 1, heart: 1, angry: 1, note: 1, glint: 1, enchanted_hit: 1, critical_hit: 1, damage: 1,
  bubble: 1, drip_hang: 1, drip_fall: 1, drip_land: 1, firefly: 1,
  generic: 8, big_smoke: 12, effect: 8, spell: 8, glitter: 8, splash: 4, explosion: 16, sweep: 8, soul: 11, spark: 8, sga: 26, sonic_boom: 16,
};

/** Sprites animés de la grande image vers la petite (le jeu original commence par la dernière). */
export const SHRINKING = new Set(['generic', 'effect', 'spell', 'glitter', 'spark']);

export class ParticleSprites {
  readonly texture: THREE.CanvasTexture;
  /** Première case de chaque sprite. */
  private readonly base = new Map<string, number>();

  constructor(tm: TextureManager) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CELL * COLS;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    let cell = 0;
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    for (const [name, n] of Object.entries(SPRITE_SETS)) {
      this.base.set(name, cell);
      for (let i = 0; i < n; i++, cell++) {
        const file = n === 1 ? name : name === 'sga' ? `sga_${letters[i]}` : `${name}_${i}`;
        const img = tm.packImage(`particle/${file}.png`);
        const x = (cell % COLS) * CELL, y = Math.floor(cell / COLS) * CELL;
        // un sprite peut être plus grand que 16 px (explosion, balayage) : réduit dans sa case
        if (img) ctx.drawImage(img, 0, 0, img.width, Math.min(img.height, img.width), x, y, CELL, CELL);
        else drawFallback(ctx, name, i, n, x, y);
      }
    }
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
  }

  /** Case de l'image `frame` du sprite `name` (ou -1). */
  cell(name: string, frame = 0): number {
    const b = this.base.get(name);
    return b === undefined ? -1 : b + Math.max(0, Math.min(frame, (SPRITE_SETS[name] ?? 1) - 1));
  }

  frames(name: string) {
    return SPRITE_SETS[name] ?? 1;
  }

  /** Coordonnées (u0, v0, taille) d'une case pour le shader. */
  uv(cell: number): [number, number, number] {
    const size = CELL / (CELL * COLS);
    return [(cell % COLS) * size, 1 - Math.floor(cell / COLS) * size, size];
  }

  dispose() {
    this.texture.dispose();
  }
}

/** Dessins de secours (sans pack) : blancs ou gris, teintés à l'affichage. */
function drawFallback(ctx: CanvasRenderingContext2D, name: string, i: number, n: number, x: number, y: number) {
  const px = (dx: number, dy: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + dx, y + dy, w, h);
  };
  const disc = (r: number, c: string) => {
    for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 16; xx++) if ((xx - 7.5) ** 2 + (yy - 7.5) ** 2 <= r * r) px(xx, yy, 1, 1, c);
  };
  switch (name) {
    case 'flame': case 'soul_fire_flame': case 'copper_fire_flame':
      px(6, 4, 4, 9, name === 'soul_fire_flame' ? '#60e0f0' : '#ffb030'); px(7, 7, 2, 6, '#fff4a0'); break;
    case 'lava': px(6, 6, 4, 4, '#ff8020'); px(7, 7, 2, 2, '#ffe060'); break;
    case 'heart': px(3, 4, 4, 3, '#ff3040'); px(9, 4, 4, 3, '#ff3040'); px(3, 6, 10, 3, '#ff3040'); px(5, 9, 6, 2, '#ff3040'); px(7, 11, 2, 2, '#ff3040'); break;
    case 'damage': px(3, 4, 4, 3, '#5a1010'); px(9, 4, 4, 3, '#5a1010'); px(3, 6, 10, 3, '#5a1010'); px(5, 9, 6, 2, '#5a1010'); break;
    case 'angry': px(3, 3, 3, 10, '#606060'); px(10, 3, 3, 10, '#606060'); px(3, 7, 10, 2, '#606060'); break;
    case 'note': px(9, 2, 2, 9, '#ffffff'); px(5, 9, 5, 4, '#ffffff'); px(11, 2, 3, 2, '#ffffff'); break;
    case 'glint': case 'enchanted_hit': case 'critical_hit': px(7, 2, 2, 12, '#ffffff'); px(2, 7, 12, 2, '#ffffff'); break;
    case 'bubble': disc(4, '#ffffff'); disc(3, 'rgba(0,0,0,0)'); ctx.clearRect(x + 6, y + 6, 4, 4); break;
    case 'drip_hang': case 'drip_fall': case 'drip_land': px(7, 6, 2, 4, '#ffffff'); break;
    case 'sga': px(4 + (i % 3) * 2, 4, 2, 8, '#ffffff'); px(4, 6 + (i % 4), 8, 2, '#ffffff'); break;
    default: {
      // fumée, sorts, étincelles, explosion : disque qui rétrécit avec l'image
      const k = SHRINKING.has(name) ? i + 1 : n - i;
      const r = 2 + (5 * k) / Math.max(1, n);
      disc(Math.min(7, r), '#ffffff');
    }
  }
}
