import { BLOCK_DEFS } from '../data/blocks';
import { modelTiles } from '../data/blockModels';

/**
 * Tuiles animées, comme les fichiers « .mcmeta » du jeu original (1.21) :
 * [images dans l'atlas, durée d'une image en ticks (1/20 s), fondu entre images, ordre des images
 * de la texture]. L'eau, la lave et le portail gardent 16 images à 8 par seconde (le shader du
 * portail compte sur 16 images).
 */
export type TileAnim = [frames: number, ticks: number, interpolate?: boolean, order?: number[]];
export const TILE_ANIMS: Record<string, TileAnim> = {
  water: [16, 2.5],
  lava: [16, 2.5],
  nether_portal: [16, 2.5],
  lantern: [3, 8],
  soul_lantern: [3, 8],
  copper_lantern: [3, 8],
  exposed_copper_lantern: [3, 8],
  weathered_copper_lantern: [3, 8],
  oxidized_copper_lantern: [3, 8],
  stonecutter_saw: [3, 1],
  campfire_log_lit: [4, 20, true],
  campfire_fire: [8, 2],
  soul_campfire_log_lit: [4, 20, true],
  soul_campfire_fire: [8, 2],
  sculk_sensor_tendril_inactive: [16, 2],
  sculk_sensor_tendril_active: [16, 1],
  sculk_shrieker_inner_top: [10, 6, true],
  sculk_shrieker_can_summon_inner_top: [10, 3, true],
  sculk_vein: [4, 20, true],
  crimson_stem_side: [5, 10, true],
  warped_stem_side: [5, 10, true],
  magma: [3, 8, true, [0, 1, 2]],
  prismarine: [22, 300, true, [0, 1, 0, 2, 0, 3, 0, 1, 2, 1, 3, 1, 0, 2, 1, 2, 3, 2, 0, 3, 1, 3]],
  sea_lantern: [5, 5],
  campfire_top: [4, 20, true],
  campfire_side: [4, 20, true],
  fire: [32, 1, false, [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]],
  soul_fire: [32, 1, false, [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]],
  sculk: [4, 20, true],
  respawn_anchor_top: [32, 1],
  seagrass: [18, 2],
  kelp_plant: [20, 2],
  crimson_hyphae: [5, 10, true],
  warped_hyphae: [5, 10, true],
  tall_seagrass_bottom: [19, 2],
  tall_seagrass_top: [19, 2],
  command_block_side: [4, 10, true],
  command_block_front: [4, 10, true],
  command_block_back: [4, 10, true],
  smoker_front_on: [3, 4],
  blast_furnace_front_on: [2, 10, true],
  chain_command_block_side: [4, 10, true],
  chain_command_block_front: [4, 10, true],
  chain_command_block_back: [4, 10, true],
  repeating_command_block_side: [4, 10, true],
  repeating_command_block_front: [4, 10, true],
  repeating_command_block_back: [4, 10, true],
  sculk_catalyst_top_bloom: [8, 1],
  sculk_catalyst_side_bloom: [8, 1],
  chain_command_block_conditional: [4, 10, true],
  command_block_conditional: [4, 10, true],
  kelp: [20, 2],
  repeating_command_block_conditional: [4, 10, true],
};
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
    const frames = TILE_ANIMS[name]?.[0] ?? 1;
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
