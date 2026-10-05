import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { ICON_TEMPLATES } from '../ui/IconTemplates';
import { buildAtlas, hex } from './TextureGenerator';
import { ATLAS_COLS, TILE_PX, TileRegistry } from './TileRegistry';

const DEFAULT_GRASS = hex('#7cbd4a');
const DEFAULT_FOLIAGE = hex('#5fa83a');

/**
 * Gestion des textures : atlas des blocs (texture WebGL), tuiles individuelles et icônes d'objets
 * (canvases mis en cache, utilisés par l'interface DOM). Toutes les ressources sont générées
 * localement : aucun téléchargement.
 */
export class TextureManager {
  readonly atlasCanvas: HTMLCanvasElement;
  readonly atlas: THREE.CanvasTexture;
  private tileCache = new Map<number, HTMLCanvasElement>();
  private iconCache = new Map<string, string>();
  private iconCanvasCache = new Map<string, HTMLCanvasElement>();

  constructor() {
    this.atlasCanvas = buildAtlas();
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.colorSpace = THREE.NoColorSpace;
    this.atlas.needsUpdate = true;
  }

  /** Tuile 16x16 isolée (teinte appliquée pour herbe/feuilles). */
  tile(index: number, tint?: [number, number, number]): HTMLCanvasElement {
    const key = index * 1000 + (tint ? 1 : 0);
    let c = this.tileCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = TILE_PX;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.atlasCanvas, (index % ATLAS_COLS) * TILE_PX, Math.floor(index / ATLAS_COLS) * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
    const img = ctx.getImageData(0, 0, TILE_PX, TILE_PX);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a > 128 && a < 250) {
        if (tint) {
          d[i] = (d[i] * tint[0]) / 255;
          d[i + 1] = (d[i + 1] * tint[1]) / 255;
          d[i + 2] = (d[i + 2] * tint[2]) / 255;
        }
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.tileCache.set(key, c);
    return c;
  }

  /** Couleur moyenne d'une tuile (particules). */
  tileColor(index: number): [number, number, number] {
    const c = this.tile(index);
    const d = c.getContext('2d')!.getImageData(0, 0, TILE_PX, TILE_PX).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 3] > 100) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
    return n ? [r / n / 255, g / n / 255, b / n / 255] : [1, 1, 1];
  }

  private tintFor(blockKey: string, tileName: string): [number, number, number] | undefined {
    if (blockKey.endsWith('leaves')) return DEFAULT_FOLIAGE;
    if (tileName.startsWith('grass') || tileName === 'tall_grass') return DEFAULT_GRASS;
    return undefined;
  }

  /** Icône d'un objet en canvas 32x32. */
  iconCanvas(itemId: string): HTMLCanvasElement {
    let c = this.iconCanvasCache.get(itemId);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const def = ItemRegistry.get(itemId);
    if (def && 'block' in def.icon) {
      const block = BlockRegistry.byName(def.icon.block);
      const tn = (i: number) => TileRegistry.names[i] ?? '';
      if (block.render === 'cross') {
        const ti = block.metaTiles ? block.metaTiles[block.metaTiles.length - 1] : block.faceTiles[0];
        ctx.drawImage(this.tile(ti, this.tintFor(block.key, tn(ti))), 0, 0, 32, 32);
      } else {
        const top = block.faceTiles[2], left = block.faceTiles[4], right = block.faceTiles[0];
        const draw = (ti: number, a: number, b: number, cc: number, d: number, e: number, f: number, shade: number) => {
          ctx.setTransform(a, b, cc, d, e, f);
          ctx.drawImage(this.tile(ti, this.tintFor(block.key, tn(ti))), 0, 0);
          if (shade > 0) {
            ctx.fillStyle = `rgba(0,0,0,${shade})`;
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillRect(0, 0, 16, 16);
            ctx.globalCompositeOperation = 'source-over';
          }
        };
        const s = 14 / 16;
        draw(left, s, 7 / 16, 0, 1, 2, 8, 0.25);
        draw(right, s, -7 / 16, 0, 1, 16, 15, 0.42);
        draw(top, s, -7 / 16, s, 7 / 16, 2, 8, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else if (def && 'sprite' in def.icon) {
      this.drawSprite(ctx, def.icon.sprite, def.icon.colors);
    } else {
      ctx.fillStyle = '#f0f';
      ctx.fillRect(8, 8, 16, 16);
    }
    this.iconCanvasCache.set(itemId, c);
    return c;
  }

  private drawSprite(ctx: CanvasRenderingContext2D, name: string, colors: string[]) {
    const tpl = ICON_TEMPLATES[name];
    if (!tpl) return;
    const a = hex(colors[0] ?? '#ff00ff');
    const b = colors[1] ? hex(colors[1].slice(0, 7)) : a;
    const c = colors[2] ? hex(colors[2]) : b;
    const sc = (v: [number, number, number], k: number) => `rgb(${Math.min(255, v[0] * k) | 0},${Math.min(255, v[1] * k) | 0},${Math.min(255, v[2] * k) | 0})`;
    const pal: Record<string, string> = {
      a: sc(a, 1),
      d: sc(a, 0.7),
      e: sc(a, 1.25),
      b: sc(b, 1),
      c: sc(c, 1),
      h: colors[1] ? sc(b, 0.85) : '#6b4f2c',
      k: 'rgba(20,18,26,0.95)',
      w: '#f4f4f4',
    };
    if (colors[1] && colors[1].length > 7) pal.h = '#7a5a34';
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const ch = tpl[y]?.[x];
        if (!ch || ch === '.') continue;
        ctx.fillStyle = pal[ch] ?? '#f0f';
        ctx.fillRect(x * 2, y * 2, 2, 2);
      }
  }

  /** URL data de l'icône (mise en cache) pour l'interface DOM. */
  iconURL(itemId: string): string {
    let u = this.iconCache.get(itemId);
    if (!u) {
      u = this.iconCanvas(itemId).toDataURL();
      this.iconCache.set(itemId, u);
    }
    return u;
  }

  dispose() {
    this.atlas.dispose();
    this.tileCache.clear();
    this.iconCache.clear();
    this.iconCanvasCache.clear();
  }
}
