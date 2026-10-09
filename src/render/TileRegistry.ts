import { BLOCK_DEFS } from '../data/blocks';
import { modelTiles } from '../data/blockModels';

/** Tuiles animées : nombre d'images consécutives dans l'atlas. */
export const ANIMATED_TILES: Record<string, number> = { water: 16, lava: 16 };
export const EXTRA_TILES = Array.from({ length: 10 }, (_, i) => `destroy_stage_${i}`);
export const ATLAS_COLS = 64;
export const TILE_PX = 16;

/**
 * Liste déterministe des tuiles de l'atlas : partagée par le thread principal
 * (génération de l'atlas) et le worker (meshing) sans dépendance au DOM.
 */
class TileRegistryImpl {
  readonly names: string[] = [];
  private map = new Map<string, number>();
  readonly animFrames = new Uint8Array(ATLAS_COLS * ATLAS_COLS);

  constructor() {
    this.add('missing');
    for (const d of BLOCK_DEFS) {
      const t = d.textures;
      if (!t) continue;
      for (const n of [t.all, t.top, t.bottom, t.side, t.front, t.back, t.east, t.west, ...(t.byMeta ?? [])]) if (n) this.add(n);
    }
    for (const n of modelTiles()) this.add(n);
    for (const n of EXTRA_TILES) this.add(n);
    if (this.names.length > ATLAS_COLS * ATLAS_COLS) throw new Error('Atlas plein');
  }

  /** Ajoute une tuile (add-ons) ; même ordre sur le thread principal et le worker. */
  addTile(name: string) {
    this.add(name);
    if (this.names.length > ATLAS_COLS * ATLAS_COLS) throw new Error('Atlas plein');
  }

  private add(name: string) {
    if (this.map.has(name)) return;
    const frames = ANIMATED_TILES[name] ?? 1;
    const idx = this.names.length;
    this.map.set(name, idx);
    this.animFrames[idx] = frames;
    this.names.push(name);
    for (let f = 1; f < frames; f++) this.names.push(`${name}#${f}`);
  }

  has(name: string) {
    return this.map.has(name);
  }

  index(name: string): number {
    const i = this.map.get(name);
    if (i === undefined) throw new Error(`Tuile inconnue: ${name}`);
    return i;
  }
  get count() {
    return this.names.length;
  }
}

export const TileRegistry = new TileRegistryImpl();
