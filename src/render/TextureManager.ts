import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { ICON_TEMPLATES } from '../ui/IconTemplates';
import type { SkinProvider } from './MobModels';
import { paintSkin } from './MobSkins';
import { LoadedPack } from './ResourcePack';
import { buildAtlas, hex } from './TextureGenerator';
import { ANIMATED_TILES, ATLAS_COLS, TILE_PX, TileRegistry } from './TileRegistry';

const DEFAULT_GRASS = hex('#7cbd4a');
const DEFAULT_FOLIAGE = hex('#5fa83a');

/**
 * Gestion des textures : atlas des blocs (texture WebGL), tuiles individuelles et icônes d'objets
 * (canvases mis en cache, utilisés par l'interface DOM). Toutes les ressources sont générées
 * localement : aucun téléchargement.
 */
/** Tuiles en niveaux de gris teintées par le biome dans le jeu vanilla. */
const GRAY_TINTED = /^(grass_block_top|short_grass|fern|sugar_cane|(?!cherry|azalea|flowering_azalea|pale_oak)\w*_leaves)$/;
/** Tuiles sans équivalent direct dans un pack (dessinées par le jeu). */
const PACK_SKIP = new Set(['missing', 'altar_top', 'altar_side', 'chest_top', 'chest_side', 'chest_front', 'bed_foot', 'bed_side', 'bed_head']);
const PACK_RENAME: Record<string, string> = {
  water: 'water_still', lava: 'lava_still',
  // blocs de la palette élargie : noms des fichiers du pack
  cherry_log_side: 'cherry_log', mangrove_log_side: 'mangrove_log', pale_oak_log_side: 'pale_oak_log', crimson_stem_side: 'crimson_stem', warped_stem_side: 'warped_stem',
  bamboo_block_side: 'bamboo_block', basalt: 'basalt_side', quartz_block: 'quartz_block_side', smooth_quartz: 'quartz_block_bottom', bone_block: 'bone_block_side',
  noteblock_top: 'note_block', noteblock_side: 'note_block', cartography_table_side: 'cartography_table_side1', lectern_side: 'lectern_sides', grindstone_top: 'grindstone_side',
  carved_pumpkin_top: 'pumpkin_top', carved_pumpkin_side: 'carved_pumpkin', jack_o_lantern_top: 'pumpkin_top', jack_o_lantern_side: 'jack_o_lantern',
  campfire_top: 'campfire_log_lit', campfire_side: 'campfire_log_lit', azalea: 'azalea_top', fire: 'fire_0', soul_fire: 'soul_fire_0', pointed_dripstone: 'pointed_dripstone_down_tip', end_portal_frame_eye: 'end_portal_frame_eye', end_portal_frame_top: 'end_portal_frame_top',
};
const WATER_TINT = hex('#3f76e4');

/** Chemins des skins des créatures dans un pack (plusieurs versions du jeu). */
export const SKIN_PATHS: Record<string, string[]> = {
  pig: ['entity/pig/pig.png', 'entity/pig/temperate_pig.png'],
  cow: ['entity/cow/cow.png', 'entity/cow/temperate_cow.png'],
  sheep: ['entity/sheep/sheep.png'],
  sheep_fur: ['entity/sheep/sheep_fur.png', 'entity/sheep/sheep_wool.png'],
  chicken: ['entity/chicken.png', 'entity/chicken/chicken.png', 'entity/chicken/temperate_chicken.png'],
  zombie: ['entity/zombie/zombie.png'],
  zombie_chief: ['entity/zombie/husk.png'],
  skeleton: ['entity/skeleton/skeleton.png'],
  player: ['entity/player/wide/steve.png', 'entity/steve.png'],
  creeper: ['entity/creeper/creeper.png'],
  zombified_piglin: ['entity/piglin/zombified_piglin.png'],
  ghast: ['entity/ghast/ghast.png'],
  magma_cube: ['entity/slime/magmacube.png'],
  blaze: ['entity/blaze.png'],
  snow_golem: ['entity/snow_golem.png'],
  wither_skeleton: ['entity/skeleton/wither_skeleton.png'],
  wither: ['entity/wither/wither.png'],
  minecart: ['entity/minecart.png'],
  husk: ['entity/zombie/husk.png'],
  drowned: ['entity/zombie/drowned.png'],
  stray: ['entity/skeleton/stray.png'],
  enderman: ['entity/enderman/enderman.png'],
  wolf: ['entity/wolf/wolf.png'],
  wolf_tame: ['entity/wolf/wolf_tame.png'],
  wolf_angry: ['entity/wolf/wolf_angry.png'],
  squid: ['entity/squid/squid.png'],
  glow_squid: ['entity/squid/glow_squid.png'],
  villager: ['entity/villager/villager.png'],
  witch: ['entity/witch.png'],
  spider: ['entity/spider/spider.png'],
  cave_spider: ['entity/spider/cave_spider.png'],
  slime: ['entity/slime/slime.png'],
};
/** Skin générée de remplacement pour une clé sans peintre (entités d'add-ons sur un modèle vanilla). */
export const SKIN_FALLBACK: Record<string, string> = {};
/** Textures d'objets aux noms différents dans le jeu vanilla. */
const ITEM_PATHS: Record<string, string[]> = {
  compass: ['item/compass_16.png', 'item/compass_00.png', 'item/compass.png'],
  compass_golem: ['item/recovery_compass_16.png', 'item/compass_16.png'],
  compass_lich: ['item/recovery_compass_16.png', 'item/compass_16.png'],
  bow: ['item/bow.png'],
  clock: ['item/clock_00.png'],
};

export class TextureManager implements SkinProvider {
  readonly atlasCanvas: HTMLCanvasElement;
  readonly atlas: THREE.CanvasTexture;
  private tileCache = new Map<number, HTMLCanvasElement>();
  private iconCache = new Map<string, string>();
  private iconCanvasCache = new Map<string, HTMLCanvasElement>();
  private skinCache = new Map<string, THREE.CanvasTexture>();
  private pack: LoadedPack | null = null;
  /** Images des add-ons (textures Bedrock converties, textures propres aux add-ons). */
  private extra = new Map<string, ImageBitmap>();
  /** Vue combinée : pack de ressources Java prioritaire, puis images des add-ons. */
  private view: LoadedPack | null = null;
  /** Appelé après le changement de pack (rafraîchissement de l'interface). */
  onChange: (() => void) | null = null;

  constructor() {
    this.atlasCanvas = buildAtlas();
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.colorSpace = THREE.NoColorSpace;
    this.atlas.needsUpdate = true;
  }

  /** Image brute du pack installé (chemin relatif à textures/). */
  packImage(...paths: string[]): ImageBitmap | undefined {
    return this.view?.first(...paths);
  }

  get packName(): string | null {
    return this.pack?.info.name ?? null;
  }

  /** Applique (ou retire) un pack de ressources : atlas, icônes et skins sont régénérés. */
  applyPack(pack: LoadedPack | null, extra?: Map<string, ImageBitmap>) {
    this.pack = pack;
    if (extra) this.extra = extra;
    // les add-ons passent au-dessus du pack de ressources (comme l'empilement du jeu de référence)
    const merged = new Map(pack?.images ?? []);
    for (const [k, v] of this.extra) merged.set(k, v);
    this.view = merged.size ? new LoadedPack(pack?.info ?? { name: 'add-ons', files: merged.size }, merged) : null;
    const fresh = buildAtlas(this.view ? this.packTiles(this.view) : undefined);
    const ctx = this.atlasCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.atlasCanvas.width, this.atlasCanvas.height);
    ctx.drawImage(fresh, 0, 0);
    this.atlas.needsUpdate = true;
    this.tileCache.clear();
    this.flatCache.clear();
    this.iconCache.clear();
    this.iconCanvasCache.clear();
    for (const [key, tex] of this.skinCache) {
      tex.image = this.skinCanvas(key);
      tex.needsUpdate = true;
    }
    this.onChange?.();
  }

  /** Tuiles de remplacement issues du pack, converties à la convention de l'atlas. */
  private packTiles(pack: LoadedPack): Map<string, ImageData> {
    const out = new Map<string, ImageData>();
    for (const full of TileRegistry.names) {
      const [name, fs] = full.split('#');
      if (PACK_SKIP.has(name)) continue;
      const img = pack.get(`block/${PACK_RENAME[name] ?? name}.png`);
      if (!img) continue;
      const frames = Math.max(1, Math.floor(img.height / img.width));
      const ours = ANIMATED_TILES[name] ?? 1;
      const frame = Math.floor(((fs ? Number(fs) : 0) * frames) / ours);
      const data = pack.imageData(img, TILE_PX, frame);
      const d = data.data;
      if (name === 'grass_block_side') {
        const ov = pack.get('block/grass_block_side_overlay.png');
        if (ov) {
          const o = pack.imageData(ov, TILE_PX).data;
          for (let i = 0; i < d.length; i += 4)
            if (o[i + 3] > 128) {
              d[i] = o[i];
              d[i + 1] = o[i + 1];
              d[i + 2] = o[i + 2];
              d[i + 3] = 200;
            } else d[i + 3] = 255;
        }
      } else if (GRAY_TINTED.test(name)) {
        for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i + 3] > 128 ? 200 : 0;
      } else if (name === 'water') {
        for (let i = 0; i < d.length; i += 4) {
          d[i] = (d[i] * WATER_TINT[0]) / 255;
          d[i + 1] = (d[i + 1] * WATER_TINT[1]) / 255;
          d[i + 2] = (d[i + 2] * WATER_TINT[2]) / 255;
          d[i + 3] = Math.max(d[i + 3], 170);
        }
      } else if (name.startsWith('addon/')) {
        // textures d'add-ons : transparence conservée (blocs « blend »)
      } else {
        // alpha binaire (cutout) ; on évite la plage réservée à la teinte
        for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i + 3] > 128 ? 255 : 0;
      }
      out.set(full, data);
    }
    return out;
  }

  private flatCache = new Map<number, boolean>();
  /**
   * Icône plate (comme les objets du jeu de référence) plutôt qu'un cube : plantes, torches,
   * échelles, vitres, barreaux, portes, lanternes, lits, et tout bloc à texture surtout transparente.
   */
  flatIcon(block: { id: number; render: string; shape: string | null; faceTiles: number[] }): boolean {
    if (block.render === 'cross') return true;
    if (block.shape && ['torch', 'ladder', 'door', 'pane', 'lantern', 'bed'].includes(block.shape)) return true;
    if (block.render !== 'model') return false; // cubes (même transparents : verre, feuilles) en 3D
    let f = this.flatCache.get(block.id);
    if (f === undefined) {
      const c = this.tile(block.faceTiles[0]);
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let t = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 20) t++;
      f = t / (d.length / 4) > 0.45;
      this.flatCache.set(block.id, f);
    }
    return f;
  }

  /** Texture de skin d'une créature (pack prioritaire, sinon skin générée). */
  skin(key: string): THREE.Texture {
    let t = this.skinCache.get(key);
    if (!t) {
      t = new THREE.CanvasTexture(this.skinCanvas(key));
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      this.skinCache.set(key, t);
    }
    return t;
  }

  private skinCanvas(key: string): HTMLCanvasElement {
    // texture de bloc (entités d'add-ons qui utilisent une texture de bloc du jeu)
    for (const p of SKIN_PATHS[key] ?? []) {
      if (!p.startsWith('tile:')) continue;
      try {
        const t = this.tile(TileRegistry.index(p.slice(5)));
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        c.getContext('2d')!.drawImage(t, 0, 0, 16, 16);
        return c;
      } catch {
        /* tuile inconnue */
      }
    }
    const img = this.view?.first(...(SKIN_PATHS[key] ?? []).filter((p) => !p.startsWith('tile:')));
    if (img) {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      return c;
    }
    const painted = paintSkin(SKIN_FALLBACK[key] ?? key);
    if (painted) return painted;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f0f';
    ctx.fillRect(0, 0, 64, 32);
    return c;
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

  /** Tuile par nom (null si inconnue). */
  tileByName(name: string): HTMLCanvasElement | null {
    try {
      return this.tile(TileRegistry.index(name));
    } catch {
      return null;
    }
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
    if (tileName.startsWith('grass') || tileName === 'short_grass' || tileName === 'fern' || tileName === 'sugar_cane') return DEFAULT_GRASS;
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
    const packImg = def && this.view?.first(...(ITEM_PATHS[itemId] ?? []), `item/${def.packTexture ?? itemId}.png`);
    if (def && packImg) {
      const data = this.view!.imageData(packImg, 16);
      const tint = def.armor?.material === 'leather' || itemId.startsWith('leather_') ? hex('#a06540') : null;
      if (tint) {
        const ov = this.view!.get(`item/${itemId}_overlay.png`);
        const od = ov ? this.view!.imageData(ov, 16).data : null;
        const d = data.data;
        for (let i = 0; i < d.length; i += 4) {
          if (od && od[i + 3] > 0) {
            d.set([od[i], od[i + 1], od[i + 2], od[i + 3]], i);
            continue;
          }
          d[i] = (d[i] * tint[0]) / 255;
          d[i + 1] = (d[i + 1] * tint[1]) / 255;
          d[i + 2] = (d[i + 2] * tint[2]) / 255;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = 16;
      tmp.getContext('2d')!.putImageData(data, 0, 0);
      ctx.drawImage(tmp, 0, 0, 32, 32);
    } else if (def && 'image' in def.icon) {
      const img = this.view?.get(def.icon.image);
      if (img) {
        ctx.drawImage(img, 0, 0, img.width, Math.min(img.height, img.width), 0, 0, 32, 32);
      } else {
        ctx.fillStyle = '#f0f';
        ctx.fillRect(8, 8, 16, 16);
      }
    } else if (def && 'tile' in def.icon) {
      const name = def.icon.tile;
      let ti = 0;
      try {
        ti = TileRegistry.index(name);
      } catch {
        const b = def.place ? BlockRegistry.byName(def.place) : null;
        ti = b ? (b.metaTiles ? b.metaTiles[b.metaTiles.length - 1] : b.faceTiles[0]) : 0;
      }
      ctx.drawImage(this.tile(ti, this.tintFor(def.place ?? '', name)), 0, 0, 32, 32);
    } else if (def && 'block' in def.icon) {
      const block = BlockRegistry.byName(def.icon.block);
      const tn = (i: number) => TileRegistry.names[i] ?? '';
      if (this.flatIcon(block)) {
        const ti = block.metaTiles ? block.metaTiles[block.metaTiles.length - 1] : block.faceTiles[block.shape === 'door' ? 2 : 0];
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
        // dalles : demi-hauteur ; escaliers dessinés comme un bloc plein (comme une vue réduite)
        const h = block.shape === 'slab' ? 0.5 : 1;
        const dy = (1 - h) * 16;
        draw(left, s, 7 / 16, 0, h, 2, 8 + dy, 0.25);
        draw(right, s, -7 / 16, 0, h, 16, 15 + dy, 0.42);
        draw(top, s, -7 / 16, s, 7 / 16, 2, 8 + dy, 0);
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
    for (const t of this.skinCache.values()) t.dispose();
    this.skinCache.clear();
    this.tileCache.clear();
    this.iconCache.clear();
    this.iconCanvasCache.clear();
  }
}
