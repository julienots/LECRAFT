import { Rng } from '../util/math';
import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { ICON_TEMPLATES } from '../ui/IconTemplates';
import type { SkinProvider } from './MobModels';
import { paintSkin } from './MobSkins';
import { paintRealisticZombie } from './RealisticZombie';
import { skinAspect } from './MobModels';
import { LoadedPack } from './ResourcePack';
import { buildAtlas, hex } from './TextureGenerator';
import { ATLAS_COLS, TILE_ANIMS, TILE_PX, TileRegistry } from './TileRegistry';

const DEFAULT_GRASS = hex('#7cbd4a');
const DEFAULT_FOLIAGE = hex('#5fa83a');

/**
 * Gestion des textures : atlas des blocs (texture WebGL), tuiles individuelles et icônes d'objets
 * (canvases mis en cache, utilisés par l'interface DOM). Toutes les ressources sont générées
 * localement : aucun téléchargement.
 */
/** Tuiles en niveaux de gris teintées par le biome dans le jeu vanilla. */
const GRAY_TINTED = /^(grass_block_top|short_grass|fern|sugar_cane|tall_grass_bottom|tall_grass_top|large_fern_bottom|large_fern_top|lily_pad|(?!cherry|azalea|flowering_azalea|pale_oak)\w*_leaves)$/;
/** Tuiles sans équivalent direct dans un pack (dessinées par le jeu). */
const PACK_SKIP = new Set(['missing', 'altar_top', 'altar_side', 'bed_foot', 'bed_side', 'bed_head']);
export const PACK_RENAME: Record<string, string> = {
  water: 'water_still', lava: 'lava_still',
  // blocs de la palette élargie : noms des fichiers du pack
  cherry_log_side: 'cherry_log', mangrove_log_side: 'mangrove_log', pale_oak_log_side: 'pale_oak_log', crimson_stem_side: 'crimson_stem', warped_stem_side: 'warped_stem',
  bamboo_block_side: 'bamboo_block', basalt: 'basalt_side', quartz_block: 'quartz_block_side', smooth_quartz: 'quartz_block_bottom', bone_block: 'bone_block_side',
  noteblock_top: 'note_block', noteblock_side: 'note_block', cartography_table_side: 'cartography_table_side1', lectern_side: 'lectern_sides', grindstone_top: 'grindstone_side',
  carved_pumpkin_top: 'pumpkin_top', carved_pumpkin_side: 'carved_pumpkin', jack_o_lantern_top: 'pumpkin_top', jack_o_lantern_side: 'jack_o_lantern',
  campfire_top: 'campfire_log_lit', campfire_side: 'campfire_log_lit', azalea: 'azalea_top', fire: 'fire_0', soul_fire: 'soul_fire_0', pointed_dripstone: 'pointed_dripstone_down_tip', end_portal_frame_eye: 'end_portal_frame_eye', end_portal_frame_top: 'end_portal_frame_top',
  // palette v2.19
  stripped_oak_log_side: 'stripped_oak_log', oak_wood: 'oak_log', stripped_spruce_log_side: 'stripped_spruce_log', spruce_wood: 'spruce_log', stripped_birch_log_side: 'stripped_birch_log', birch_wood: 'birch_log', stripped_jungle_log_side: 'stripped_jungle_log', jungle_wood: 'jungle_log', stripped_acacia_log_side: 'stripped_acacia_log', acacia_wood: 'acacia_log', stripped_dark_oak_log_side: 'stripped_dark_oak_log', dark_oak_wood: 'dark_oak_log', stripped_cherry_log_side: 'stripped_cherry_log', cherry_wood: 'cherry_log', stripped_mangrove_log_side: 'stripped_mangrove_log', mangrove_wood: 'mangrove_log', stripped_pale_oak_log_side: 'stripped_pale_oak_log', pale_oak_wood: 'pale_oak_log', stripped_crimson_stem_side: 'stripped_crimson_stem', crimson_hyphae: 'crimson_stem', stripped_warped_stem_side: 'stripped_warped_stem', warped_hyphae: 'warped_stem', ochre_froglight: 'ochre_froglight_side', verdant_froglight: 'verdant_froglight_side', pearlescent_froglight: 'pearlescent_froglight_side', sculk_catalyst: 'sculk_catalyst_side', sculk_shrieker: 'sculk_shrieker_side', sculk_sensor: 'sculk_sensor_side', bamboo_plant: 'bamboo_stalk', sweet_berry_bush: 'sweet_berry_bush_stage3', sunflower: 'sunflower_front', small_dripleaf: 'small_dripleaf_top', glow_berries_vines: 'cave_vines_lit', honey_block: 'honey_block_side', bee_nest: 'bee_nest_front', beehive: 'beehive_front', blast_furnace: 'blast_furnace_front', smoker: 'smoker_front', crafter: 'crafter_north', piston: 'piston_side', sticky_piston: 'piston_side', dispenser: 'dispenser_front', dropper: 'dropper_front', observer: 'observer_front', respawn_anchor: 'respawn_anchor_side0', target: 'target_side', lodestone: 'lodestone_side', chiseled_bookshelf: 'chiseled_bookshelf_occupied', dried_kelp_block: 'dried_kelp_side', mycelium: 'mycelium_top', polished_basalt: 'polished_basalt_side', smooth_sandstone: 'sandstone_top', smooth_red_sandstone: 'red_sandstone_top', reinforced_deepslate: 'reinforced_deepslate_side', quartz_pillar: 'quartz_pillar', kelp_plant: 'kelp_plant',
};
const WATER_TINT = hex('#3f76e4');

/** Couleurs des armures (cuir non teint ; calques peints sans pack). */
const ARMOR_COLORS: Record<string, string> = { leather: '#a06540', chainmail: '#9a9a9a', iron: '#d8d8d8', gold: '#f3d24a', diamond: '#4ee3d4', netherite: '#4a4446', copper: '#c87a50', turtle_scute: '#47a13a' };
const shadeHex = (h: string, k: number) => {
  const n = parseInt(h.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/** Skins de joueur fournies par les packs récents (entity/player/wide). */
export const PLAYER_SKINS = ['steve', 'alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'sunny', 'zuri'];

/** Chemins des skins des créatures dans un pack (plusieurs versions du jeu). */
export const SKIN_PATHS: Record<string, string[]> = {
  armor_stand: ['entity/armorstand/wood.png', 'entity/armor_stand/wood.png'],
  pig: ['entity/pig/pig.png', 'entity/pig/temperate_pig.png'],
  cow: ['entity/cow/cow.png', 'entity/cow/temperate_cow.png'],
  sheep: ['entity/sheep/sheep.png'],
  sheep_fur: ['entity/sheep/sheep_fur.png', 'entity/sheep/sheep_wool.png'],
  chicken: ['entity/chicken.png', 'entity/chicken/chicken.png', 'entity/chicken/temperate_chicken.png'],
  zombie: ['entity/zombie/zombie.png'],
  zombie_chief: ['entity/zombie/husk.png'],
  skeleton: ['entity/skeleton/skeleton.png'],
  player: ['entity/player/wide/steve.png', 'entity/steve.png'],
  // skins des joueurs (bots du serveur)
  ...Object.fromEntries(PLAYER_SKINS.map((n) => [`player_${n}`, [`entity/player/wide/${n}.png`, 'entity/player/wide/steve.png', 'entity/steve.png']])),
  creeper: ['entity/creeper/creeper.png'],
  zombified_piglin: ['entity/piglin/zombified_piglin.png'],
  piglin: ['entity/piglin/piglin.png'],
  mooshroom: ['entity/cow/red_mooshroom.png', 'entity/cow/mooshroom.png'],
  ghast: ['entity/ghast/ghast.png'],
  magma_cube: ['entity/slime/magmacube.png'],
  blaze: ['entity/blaze.png'],
  snow_golem: ['entity/snow_golem.png'],
  wither_skeleton: ['entity/skeleton/wither_skeleton.png'],
  bogged: ['entity/skeleton/bogged.png'],
  parched: ['entity/skeleton/parched.png'],
  piglin_brute: ['entity/piglin/piglin_brute.png'],
  evoker: ['entity/illager/evoker.png'],
  wandering_trader: ['entity/wandering_trader.png'],
  wither: ['entity/wither/wither.png'],
  ender_dragon: ['entity/enderdragon/dragon.png'],
  ender_dragon_eyes: ['entity/enderdragon/dragon_eyes.png'],
  enderman_eyes: ['entity/enderman/enderman_eyes.png'],
  spider_eyes: ['entity/spider_eyes.png', 'entity/spider/spider_eyes.png'],
  cave_spider_eyes: ['entity/spider_eyes.png', 'entity/spider/spider_eyes.png'],
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
  horse: ['entity/horse/horse_brown.png'],
  donkey: ['entity/horse/donkey.png'],
  mule: ['entity/horse/mule.png'],
  skeleton_horse: ['entity/horse/horse_skeleton.png'],
  zombie_horse: ['entity/horse/horse_zombie.png'],
  llama: ['entity/llama/brown.png'],
  trader_llama: ['entity/llama/creamy.png'],
  camel: ['entity/camel/camel.png'],
  camel_husk: ['entity/camel/camel_husk.png'],
  goat: ['entity/goat/goat.png'],
  polar_bear: ['entity/bear/polarbear.png'],
  panda: ['entity/panda/panda.png'],
  hoglin: ['entity/hoglin/hoglin.png'],
  zoglin: ['entity/hoglin/zoglin.png'],
  armadillo: ['entity/armadillo.png'],
  warden: ['entity/warden/warden.png'],
  allay: ['entity/allay/allay.png'],
  sniffer: ['entity/sniffer/sniffer.png'],
  breeze: ['entity/breeze/breeze.png'],
  ravager: ['entity/illager/ravager.png'],
  vex: ['entity/illager/vex.png'],
  creaking: ['entity/creaking/creaking.png'],
  happy_ghast: ['entity/ghast/happy_ghast.png'],
  rabbit: ['entity/rabbit/brown.png'],
  frog: ['entity/frog/temperate_frog.png'],
  turtle: ['entity/turtle/big_sea_turtle.png'],
  fox: ['entity/fox/fox.png'],
  ocelot: ['entity/cat/ocelot.png'],
  cat: ['entity/cat/tabby.png'],
  parrot: ['entity/parrot/parrot_red_blue.png'],
  bee: ['entity/bee/bee.png'],
  phantom: ['entity/phantom.png'],
  phantom_eyes: ['entity/phantom_eyes.png'],
  silverfish: ['entity/silverfish.png'],
  endermite: ['entity/endermite.png'],
  strider: ['entity/strider/strider.png'],
  cod: ['entity/fish/cod.png'],
  salmon: ['entity/fish/salmon.png'],
  pufferfish: ['entity/fish/pufferfish.png'],
  tropical_fish: ['entity/fish/tropical_a.png'],
  dolphin: ['entity/dolphin.png'],
  guardian: ['entity/guardian.png'],
  elder_guardian: ['entity/guardian_elder.png'],
  axolotl: ['entity/axolotl/axolotl_lucy.png'],
  tadpole: ['entity/tadpole/tadpole.png'],
  iron_golem: ['entity/iron_golem/iron_golem.png'],
  zombie_villager: ['entity/zombie_villager/zombie_villager.png'],
  pillager: ['entity/illager/pillager.png'],
  vindicator: ['entity/illager/vindicator.png'],
  bat: ['entity/bat.png'],
  shulker: ['entity/shulker/shulker.png'],
};
/** Skin générée de remplacement pour une clé sans peintre (entités d'add-ons sur un modèle vanilla). */
/**
 * Faces du coffre tirées de entity/chest/normal.png (64×64, mesures du jeu original) :
 * couvercle 14×14×5 en (0,0), base 14×14×10 en (0,19), loquet 2×4×1 en (0,0).
 * Les bandes latérales sont stockées à l'envers dans la texture (modèle en repère « y vers le bas »).
 */
/** Tuiles des coffres composées depuis la texture d'entité (coffre normal, coffre de l'Ender). */
const CHEST_TILES: Record<string, [string, string]> = {
  chest_top: ['normal', 'chest_top'], chest_side: ['normal', 'chest_side'], chest_front: ['normal', 'chest_front'],
  ender_chest_top: ['ender', 'chest_top'], ender_chest_side: ['ender', 'chest_side'], ender_chest_front: ['ender', 'chest_front'],
};
// coffre piégé et coffres en cuivre (4 stades d'oxydation ; les versions cirées partagent les tuiles)
for (const [k, tex] of [['trapped_chest', 'trapped'], ['copper_chest', 'copper'], ['exposed_copper_chest', 'copper_exposed'], ['weathered_copper_chest', 'copper_weathered'], ['oxidized_copper_chest', 'copper_oxidized']])
  for (const f of ['top', 'side', 'front']) CHEST_TILES[`${k}_${f}`] = [tex, `chest_${f}`];
function chestTile(img: ImageBitmap, name: string): ImageData {
  const k = img.width / 64;
  const c = document.createElement('canvas');
  c.width = c.height = TILE_PX;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const flip = (sx: number, sy: number, w: number, h: number, dx: number, dy: number) => {
    ctx.save();
    ctx.translate(dx, dy + h);
    ctx.scale(1, -1);
    ctx.drawImage(img, sx * k, sy * k, w * k, h * k, 0, 0, w, h);
    ctx.restore();
  };
  if (name === 'chest_top') ctx.drawImage(img, 28 * k, 0, 14 * k, 14 * k, 1, 1, 14, 14);
  else {
    // la tuile couvre y = 0..14 du bloc (lignes 2..16 de l'image) : base (10 px) puis couvercle (5 px)
    const u = name === 'chest_front' ? 42 : 0;
    flip(u, 33, 14, 10, 1, 6);
    flip(u, 14, 14, 5, 1, 2);
    if (name === 'chest_front') ctx.drawImage(img, 4 * k, 1 * k, 2 * k, 4 * k, 7, 5, 2, 4);
  }
  // côtés et dessus du loquet en relief : lus sur les bords de la tuile (zone libre hors du coffre)
  const lock = (dx: number, dy: number, w: number, h: number) => ctx.drawImage(img, 1 * k, 1 * k, 1 * k, 1 * k, dx, dy, w, h);
  if (name === 'chest_side') {
    lock(0, 5, 1, 4);
    lock(15, 5, 1, 4);
  } else if (name === 'chest_top') {
    lock(7, 0, 2, 1);
    lock(7, 15, 2, 1);
    lock(0, 7, 1, 2);
    lock(15, 7, 1, 2);
  }
  return ctx.getImageData(0, 0, TILE_PX, TILE_PX);
}

/** Couches d'yeux lumineux : skin de base et couleur des yeux (si le pack ne fournit pas la texture). */
const GLOW_FROM: Record<string, [string, 'red' | 'purple']> = {
  spider_eyes: ['spider', 'red'],
  cave_spider_eyes: ['cave_spider', 'red'],
  enderman_eyes: ['enderman', 'purple'],
  ender_dragon_eyes: ['ender_dragon', 'purple'],
};

export const SKIN_FALLBACK: Record<string, string> = {};
/** Couleur et largeur de texture des créatures récentes, sans pack. */
for (const n of PLAYER_SKINS) SKIN_FALLBACK[`player_${n}`] = 'player';
/** Textures d'objets aux noms différents dans le jeu vanilla. */
const ITEM_PATHS: Record<string, string[]> = {
  compass: ['item/compass_16.png', 'item/compass_00.png', 'item/compass.png'],
  compass_golem: ['item/recovery_compass_16.png', 'item/compass_16.png'],
  compass_lich: ['item/recovery_compass_16.png', 'item/compass_16.png'],
  bow: ['item/bow.png'],
  clock: ['item/clock_00.png'],
  lever: ['block/lever.png'],
  // textures d'objet aux noms différents dans le jeu original
  crossbow: ['item/crossbow_standby.png'],
  recovery_compass: ['item/recovery_compass_16.png', 'item/recovery_compass_00.png'],
  light: ['item/light_15.png'],
  enchanted_golden_apple: ['item/golden_apple.png'],
  tipped_arrow: ['item/tipped_arrow_base.png'],
};
/**
 * Icônes composées depuis les textures d'entité (le jeu original n'a pas de texture d'objet) :
 * têtes (skin : [fichier, u, v, largeur, hauteur, profondeur] de la tête), lits, bouclier.
 */
const HEAD_SKINS: Record<string, [string, number, number, number, number, number]> = {
  skeleton_skull: ['entity/skeleton/skeleton.png', 0, 0, 8, 8, 8],
  wither_skeleton_skull: ['entity/skeleton/wither_skeleton.png', 0, 0, 8, 8, 8],
  zombie_head: ['entity/zombie/zombie.png', 0, 0, 8, 8, 8],
  creeper_head: ['entity/creeper/creeper.png', 0, 0, 8, 8, 8],
  player_head: ['entity/player/wide/steve.png', 0, 0, 8, 8, 8],
  piglin_head: ['entity/piglin/piglin.png', 0, 0, 10, 8, 8],
};

/**
 * Boîtes des modèles d'inventaire du jeu original (en seizièmes : x0, y0, z0, x1, y1, z1),
 * dessinées dans l'ordre : escalier haut à gauche, plaques et tapis à plat, bouton au centre.
 */
const ICON_BOXES: Record<string, number[][]> = {
  slab: [[0, 0, 0, 16, 8, 16]],
  stairs: [[0, 0, 0, 16, 8, 16], [0, 8, 0, 8, 16, 16]],
  plate: [[1, 0, 1, 15, 1, 15]],
  button: [[5, 6, 6, 11, 10, 10]],
  carpet: [[0, 0, 0, 16, 1, 16]],
  snow_layer: [[0, 0, 0, 16, 2, 16]],
  trapdoor: [[0, 0, 0, 16, 3, 16]],
  farmland: [[0, 0, 0, 16, 15, 16]],
  cactus: [[1, 0, 1, 15, 16, 15]],
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
    // mipmaps comme le jeu original (moins de scintillement au loin) ; le shader des chunks
    // choisit lui-même le niveau (sans couture entre tuiles) et le limite à 4 px par tuile
    this.atlas.minFilter = THREE.NearestMipmapLinearFilter;
    this.atlas.generateMipmaps = true;
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
      if (!img) {
        // le coffre n'a pas de texture de bloc dans le jeu original : on compose ses faces
        // à partir de la texture d'entité (entity/chest/normal.png)
        const ct = CHEST_TILES[name];
        const chest = ct && pack.get(`entity/chest/${ct[0]}.png`);
        if (chest) out.set(full, chestTile(chest, ct[1]));
        continue;
      }
      const frames = Math.max(1, Math.floor(img.height / img.width));
      // image de la texture pour cette case de l'atlas : ordre du « .mcmeta », sinon répartie dans le temps
      const anim = TILE_ANIMS[name];
      const ours = anim?.[0] ?? 1;
      const slot = fs ? Number(fs) : 0;
      const frame = anim?.[3] && ours === anim[3].length ? anim[3][slot] % frames : frames === ours ? slot : Math.floor((slot * frames) / ours);
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
      } else if (this.translucentTiles().has(name)) {
        // verre teinté, glace, miel, slime : transparence partielle conservée (comme le jeu)
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

  private translucent: Set<string> | null = null;
  /** Tuiles des blocs translucides (rendus dans la passe transparente). */
  private translucentTiles(): Set<string> {
    if (!this.translucent) {
      this.translucent = new Set();
      for (const b of BlockRegistry.blocks) if (b.render === 'translucent') for (const t of b.faceTiles) this.translucent.add(TileRegistry.names[t]);
    }
    return this.translucent;
  }

  private flatCache = new Map<number, boolean>();
  /**
   * Icône plate (comme les objets du jeu de référence) plutôt qu'un cube : plantes, torches,
   * échelles, vitres, barreaux, portes, lanternes, lits, et tout bloc à texture surtout transparente.
   */
  flatIcon(block: { id: number; render: string; shape: string | null; faceTiles: number[] }): boolean {
    if (block.render === 'cross') return true;
    if (block.shape && ['torch', 'ladder', 'door', 'pane', 'lantern', 'bed', 'lever'].includes(block.shape)) return true;
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
      const canvas = this.skinCanvas(key);
      t = new THREE.CanvasTexture(canvas);
      // skins haute définition (zombie réaliste) : filtrage lissé et mipmaps
      const hd = canvas.width >= 256 && key === 'zombie';
      t.magFilter = hd ? THREE.LinearFilter : THREE.NearestFilter;
      t.minFilter = hd ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
      t.generateMipmaps = hd;
      t.colorSpace = THREE.NoColorSpace;
      this.skinCache.set(key, t);
    }
    return t;
  }

  private skinCanvas(key: string): HTMLCanvasElement {
    if (key === 'zombie') return paintRealisticZombie();
    if (key.startsWith('armor_')) return this.armorSkin(key);
    if (key === 'armor_stand' && !this.view?.first('entity/armorstand/wood.png', 'entity/armor_stand/wood.png')) return this.woodStandSkin();
    if (key === 'snow_golem_pumpkin') return this.pumpkinSkin();
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
      // proportions attendues par le modèle : texture plus haute → on garde le haut (ancienne
      // disposition 64×32 dans une texture 64×64), plus basse → on complète (vide)
      const asp = skinAspect(key);
      if (asp) c.height = Math.round(img.width * asp);
      c.getContext('2d')!.drawImage(img, 0, 0);
      return c;
    }
    // yeux lumineux absents du pack : extraits de la skin de base (pixels de la couleur des yeux)
    const eyes = GLOW_FROM[key];
    if (eyes) return this.eyesFrom(this.skinCanvas(eyes[0]), eyes[1]);
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

  /**
   * Calque d'armure 64×32 (casque, plastron, bottes ; « _legs » : jambières) : texture du pack
   * (format récent entity/equipment ou ancien models/armor), cuir teinté en brun comme l'armure
   * non teinte du jeu ; sans pack, couleur du matériau sur les zones du calque.
   */
  /** Support d'armure sans pack : bois de chêne (tuile des planches) sur toute la texture. */
  private woodStandSkin(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const t = this.tile(TileRegistry.has('oak_planks') ? TileRegistry.index('oak_planks') : 0);
    for (let y = 0; y < 64; y += 16) for (let x = 0; x < 64; x += 16) ctx.drawImage(t, 0, 0, 16, 16, x, y, 16, 16);
    return c;
  }

  private armorSkin(key: string): HTMLCanvasElement {
    const legs = key.endsWith('_legs');
    const mat = key.slice(6, legs ? -5 : undefined);
    const old = mat === 'turtle_scute' ? 'turtle' : mat;
    const img = this.view?.first(
      `entity/equipment/${legs ? 'humanoid_leggings' : 'humanoid'}/${mat}.png`,
      `models/armor/${old}_layer_${legs ? 2 : 1}.png`,
    );
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    const color = ARMOR_COLORS[mat] ?? '#8a8a8a';
    if (img) {
      ctx.drawImage(img, 0, 0, 64, 32);
      if (mat === 'leather') {
        // cuir : texture en niveaux de gris multipliée par la couleur par défaut
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 64, 32);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(img, 0, 0, 64, 32);
        ctx.globalCompositeOperation = 'source-over';
      }
      return c;
    }
    const rng = new Rng(mat.length * 977);
    const rect = (x: number, y: number, w: number, h: number) => {
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = rng.next() < 0.25 ? shadeHex(color, 0.82) : rng.next() < 0.15 ? shadeHex(color, 1.15) : color;
          ctx.fillRect(i, j, 1, 1);
        }
    };
    // zones du calque (UV de boîte) : tête, corps, bras, jambes
    if (!legs) {
      rect(0, 0, 32, 16);
      rect(16, 16, 24, 16);
      rect(40, 16, 16, 16);
    } else rect(16, 16, 24, 16);
    rect(0, 16, 16, 16);
    return c;
  }

  /** Citrouille sculptée du golem de neige : faces du bloc disposées en UV de boîte 10×10×10 (×8). */
  private pumpkinSkin(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const t = (n: string) => this.tile(TileRegistry.has(n) ? TileRegistry.index(n) : 0);
    const put = (n: string, x: number, y: number) => ctx.drawImage(t(n), 0, 0, 16, 16, x * 8, y * 8, 80, 80);
    put('pumpkin_top', 10, 0);
    put('pumpkin_top', 20, 0);
    put('pumpkin_side', 0, 10);
    put(TileRegistry.has('carved_pumpkin_side') ? 'carved_pumpkin_side' : 'pumpkin_side', 10, 10);
    put('pumpkin_side', 20, 10);
    put('pumpkin_side', 30, 10);
    return c;
  }

  private eyesFrom(base: HTMLCanvasElement, kind: 'red' | 'purple'): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const eye = kind === 'red' ? r > 140 && g < 90 && b < 90 : b > 140 && r > 110 && g < 120 && b - g > 60;
      if (!eye) d[i + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);
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
    if (tileName.startsWith('grass') || tileName === 'short_grass' || tileName === 'fern' || tileName.startsWith('tall_grass') || tileName.startsWith('large_fern') || tileName === 'sugar_cane') return DEFAULT_GRASS;
    return undefined;
  }

  /** Icône composée (têtes, lits, bouclier depuis les textures d'entité du pack ; bannières) ; faux sinon. */
  private entityIcon(ctx: CanvasRenderingContext2D, itemId: string): boolean {
    // bannière : traverse, étendard de la couleur du bloc (comme l'icône du jeu original)
    if (/_banner$/.test(itemId) && BlockRegistry.has(itemId)) {
      const col = hex(BlockRegistry.byName(itemId).color);
      const css = (k: number) => `rgb(${col.map((c) => Math.min(255, Math.round(c * k))).join(',')})`;
      ctx.fillStyle = '#6b4f2c';
      ctx.fillRect(6, 1, 20, 3);
      ctx.fillStyle = css(1);
      ctx.fillRect(8, 4, 16, 26);
      ctx.fillStyle = css(0.8);
      ctx.fillRect(8, 4, 1, 26);
      ctx.fillRect(23, 4, 1, 26);
      ctx.fillRect(8, 29, 16, 1);
      return true;
    }
    const v = this.view;
    if (!v) return false;
    const crop = (img: ImageBitmap, sx: number, sy: number, sw: number, sh: number, rotate = false) => {
      const k = img.width / 64;
      const t = document.createElement('canvas');
      t.width = t.height = 16;
      const tc = t.getContext('2d')!;
      tc.imageSmoothingEnabled = false;
      if (rotate) {
        tc.translate(16, 0);
        tc.rotate(Math.PI / 2);
      }
      tc.drawImage(img, sx * k, sy * k, sw * k, sh * k, 0, 0, 16, 16);
      return t;
    };
    // faces d'un pavé isométrique (mêmes transformations que les icônes de blocs) ; h = hauteur relative
    const s = 14 / 16;
    const cube = (front: HTMLCanvasElement, side: HTMLCanvasElement, top: HTMLCanvasElement, h = 1) => {
      const dy = (1 - h) * 16;
      const face = (tile: HTMLCanvasElement, a: number, b: number, c: number, d: number, e: number, f: number, shade: number) => {
        ctx.setTransform(a, b, c, d, e, f);
        ctx.drawImage(tile, 0, 0);
        if (shade > 0) {
          ctx.fillStyle = `rgba(0,0,0,${shade})`;
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillRect(0, 0, 16, 16);
          ctx.globalCompositeOperation = 'source-over';
        }
      };
      face(front, s, 7 / 16, 0, h, 2, 8 + dy, 0.25);
      face(side, s, -7 / 16, 0, h, 16, 15 + dy, 0.42);
      face(top, s, -7 / 16, s, 7 / 16, 2, 8 + dy, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    const head = HEAD_SKINS[itemId];
    if (head) {
      const img = v.get(head[0]);
      if (!img) return false;
      const [, u, vv, w, h, d] = head;
      cube(crop(img, u + d, vv + d, w, h), crop(img, u, vv + d, d, h), crop(img, u + d, vv, w, d));
      return true;
    }
    const bed = /^(\w+)_bed$/.exec(itemId);
    if (bed) {
      const img = v.get(`entity/bed/${bed[1]}.png`);
      if (!img) return false;
      const k = img.width / 64;
      // dessus : tête (oreiller) puis pied ; côtés : flanc du matelas et pieds en bois
      const top = document.createElement('canvas');
      top.width = top.height = 16;
      const tc = top.getContext('2d')!;
      tc.imageSmoothingEnabled = false;
      tc.drawImage(img, 6 * k, 6 * k, 16 * k, 16 * k, 0, 0, 16, 8);
      tc.drawImage(img, 6 * k, 28 * k, 16 * k, 16 * k, 0, 8, 16, 8);
      const side = document.createElement('canvas');
      side.width = side.height = 16;
      const sc = side.getContext('2d')!;
      sc.imageSmoothingEnabled = false;
      sc.drawImage(crop(img, 0, 28, 6, 16, true), 0, 0, 16, 16, 0, 0, 16, 11);
      sc.drawImage(img, 50 * k, 3 * k, 3 * k, 3 * k, 0, 11, 3, 5);
      sc.drawImage(img, 50 * k, 3 * k, 3 * k, 3 * k, 13, 11, 3, 5);
      cube(side, side, top, 9 / 16);
      return true;
    }
    if (itemId === 'shield') {
      const img = v.get('entity/shield_base_nopattern.png') ?? v.get('entity/shield_base.png');
      if (!img) return false;
      const k = img.width / 64;
      // face avant de la planche (12×22 px)
      ctx.drawImage(img, 1 * k, 1 * k, 12 * k, 22 * k, 8, 1, 17, 30);
      return true;
    }
    return false;
  }

  /** Icône d'un objet en canvas 32x32. */
  iconCanvas(itemId: string): HTMLCanvasElement {
    let c = this.iconCanvasCache.get(itemId);
    if (c) return c;
    // potion : « potion#rrggbb » → fiole avec le liquide teinté
    const hashAt = itemId.indexOf('#');
    if (hashAt > 0) {
      c = this.potionIcon(itemId.slice(0, hashAt), itemId.slice(hashAt));
      this.iconCanvasCache.set(itemId, c);
      return c;
    }
    c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const def = ItemRegistry.get(itemId);
    if (def && this.entityIcon(ctx, itemId)) {
      this.iconCanvasCache.set(itemId, c);
      return c;
    }
    // variantes de blocs (bougie allumée, rail activé, répéteur alimenté…) : texture d'objet de base ;
    // blocs cirés : texture de la version non cirée (comme le jeu original)
    const base = itemId.replace(/_(lit|on|off|powered|active|inactive|unlit|triggered|crafting|ejecting|ominous)$/, '').replace(/^waxed_/, '');
    const packImg = def && this.view?.first(...(ITEM_PATHS[itemId] ?? []), `item/${def.packTexture ?? itemId}.png`, ...(base !== itemId ? [`item/${base}.png`] : []));
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
      if (block.render === 'model' && block.visuals?.length && !block.shape) {
        this.modelIcon(ctx, block);
      } else if (!ICON_BOXES[block.shape ?? ''] && this.flatIcon(block)) {
        const ti = block.metaTiles ? block.metaTiles[block.metaTiles.length - 1] : block.faceTiles[block.shape === 'door' ? 2 : 0];
        ctx.drawImage(this.tile(ti, this.tintFor(block.key, tn(ti))), 0, 0, 32, 32);
      } else {
        this.boxIcon(ctx, block, ICON_BOXES[block.shape ?? ''] ?? [[0, 0, 0, 16, 16, 16]]);
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

  /**
   * Icône isométrique d'un bloc fait de boîtes (en seizièmes) comme les modèles d'inventaire du
   * jeu original : chaque face ne montre que la partie de texture qu'elle couvre (plaque, bouton,
   * tapis, marches d'escalier…). Faces gauche et droite ombrées comme dans l'inventaire.
   */
  private boxIcon(ctx: CanvasRenderingContext2D, block: { key: string; faceTiles: number[] }, boxes: number[][]) {
    const tn = (i: number) => TileRegistry.names[i] ?? '';
    const face = (ti: number, shade: number) => {
      const t = this.tile(ti, this.tintFor(block.key, tn(ti)));
      if (!shade) return t;
      const c = document.createElement('canvas');
      c.width = t.width;
      c.height = t.height;
      const g = c.getContext('2d')!;
      g.drawImage(t, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgba(0,0,0,${shade})`;
      g.fillRect(0, 0, c.width, c.height);
      return c;
    };
    const top = face(block.faceTiles[2], 0), left = face(block.faceTiles[4], 0.25), right = face(block.faceTiles[0], 0.42);
    const s = 14 / 16, k = 7 / 16;
    // sous-rectangle (u, v, l, h) de la texture dessiné au même endroit dans le repère de la face
    const part = (img: HTMLCanvasElement, u: number, v: number, w: number, h: number) => {
      const r = img.width / 16;
      if (w > 0 && h > 0) ctx.drawImage(img, u * r, v * r, w * r, h * r, u, v, w, h);
    };
    for (const [x0, y0, z0, x1, y1, z1] of boxes) {
      ctx.setTransform(s, k, 0, 1, 2 + s * z0, 8 - k * z0);
      part(left, x0, 16 - y1, x1 - x0, y1 - y0);
      ctx.setTransform(s, -k, 0, 1, 2 + s * x1, 8 + k * x1);
      part(right, z0, 16 - y1, z1 - z0, y1 - y0);
      ctx.setTransform(s, -k, s, k, 2, 24 - y1);
      part(top, z0, x0, z1 - z0, x1 - x0);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * Icône d'un bloc à modèle (enclume, chaudron, bougie allumée…) : vraie géométrie du modèle
   * vue en perspective isométrique comme dans l'inventaire du jeu original (faces sud, est et
   * dessus), chaque face texturée par une transformation affine, ombrée selon son orientation.
   * Les petits modèles sont agrandis pour remplir la case.
   */
  private modelIcon(ctx: CanvasRenderingContext2D, block: { key: string; visuals?: { quads: { p: number[]; uv: number[]; tile: number }[] }[] }) {
    const quads = block.visuals![0].quads;
    const s = 14 / 16, k = 7 / 16;
    const proj = (x: number, y: number, z: number): [number, number] => [x * s + (16 - z) * s, x * k - (16 - z) * k + (16 - y)];
    type Q = { pts: [number, number][]; uv: number[]; tile: number; depth: number; shade: number };
    const list: Q[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of quads) {
      const P = (i: number) => [q.p[i * 3], q.p[i * 3 + 1], q.p[i * 3 + 2]];
      const a = P(0), b = P(1), c = P(3);
      // normale (produit vectoriel) : faces tournées vers l'observateur seulement
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (n[0] * 0.6 + n[1] * 0.8 + n[2] * 0.6 <= 0.0001) continue;
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      const shade = n[1] / len > 0.7 ? 0 : Math.abs(n[0] / len) > Math.abs(n[2] / len) ? 0.42 : 0.25;
      const pts = [0, 1, 2, 3].map((i) => proj(q.p[i * 3], q.p[i * 3 + 1], q.p[i * 3 + 2]));
      for (const [x, y] of pts) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      let depth = 0;
      for (let i = 0; i < 4; i++) depth += q.p[i * 3] + q.p[i * 3 + 1] + q.p[i * 3 + 2];
      list.push({ pts, uv: q.uv, tile: q.tile, depth, shade });
    }
    if (!list.length) return;
    list.sort((a, b) => a.depth - b.depth);
    // mise à l'échelle : un modèle plein garde la taille d'un cube, un petit modèle est agrandi
    const w = maxX - minX, h = maxY - minY;
    const sc = Math.min(2.6, 28 / Math.max(w, h, 1));
    const ox = 16 - ((minX + maxX) / 2) * sc, oy = 16 - ((minY + maxY) / 2) * sc;
    for (const q of list) {
      const P = q.pts.map(([x, y]) => [ox + x * sc, oy + y * sc]);
      const T = [0, 1, 3].map((i) => [q.uv[i * 2], 16 - q.uv[i * 2 + 1]]);
      // transformation affine texture → écran (coins 0, 1 et 3)
      const du1 = T[1][0] - T[0][0], dv1 = T[1][1] - T[0][1], du2 = T[2][0] - T[0][0], dv2 = T[2][1] - T[0][1];
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-6) continue;
      const ex1 = P[1][0] - P[0][0], ey1 = P[1][1] - P[0][1], ex2 = P[3][0] - P[0][0], ey2 = P[3][1] - P[0][1];
      const a = (ex1 * dv2 - ex2 * dv1) / det, c = (ex2 * du1 - ex1 * du2) / det;
      const b = (ey1 * dv2 - ey2 * dv1) / det, d = (ey2 * du1 - ey1 * du2) / det;
      const e = P[0][0] - a * T[0][0] - c * T[0][1], f = P[0][1] - b * T[0][0] - d * T[0][1];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(P[i][0], P[i][1]);
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(a, b, c, d, e, f);
      const tex = this.tile(q.tile, this.tintFor(block.key, TileRegistry.names[q.tile] ?? ''));
      let img: CanvasImageSource = tex;
      if (q.shade > 0) {
        // face ombrée : copie assombrie de la tuile (seulement ses pixels visibles)
        const t = document.createElement('canvas');
        t.width = tex.width;
        t.height = tex.height;
        const tc = t.getContext('2d')!;
        tc.drawImage(tex, 0, 0);
        tc.globalCompositeOperation = 'source-atop';
        tc.fillStyle = `rgba(0,0,0,${q.shade})`;
        tc.fillRect(0, 0, t.width, t.height);
        img = t;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 16, 16);
      ctx.restore();
    }
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

  /** Image tenue en main : texture « _in_hand » du pack (lances) sinon l'icône. */
  heldCanvas(itemId: string, texture?: string): HTMLCanvasElement {
    // variante d'état (arc ou arbalète en tension) : texture du pack si présente
    const img = (texture && this.view?.get(`item/${texture}.png`)) || this.view?.get(`item/${itemId}_in_hand.png`);
    if (!img) return this.iconCanvas(itemId);
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, img.width, Math.min(img.height, img.width), 0, 0, c.width, c.height);
    return c;
  }

  /** URL data de l'icône (mise en cache) pour l'interface DOM. */
  /** Icône de potion : fiole du pack + calque du liquide teinté (ou liquide repeint sans pack). */
  private potionIcon(base: string, color: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // flèche à effet : tige du pack + pointe teintée
    const arrow = base === 'tipped_arrow';
    const bottle = this.view?.get(arrow ? 'item/tipped_arrow_base.png' : `item/${base}.png`);
    const overlay = this.view?.get(arrow ? 'item/tipped_arrow_head.png' : 'item/potion_overlay.png');
    const rgb = hex(color);
    if (bottle && overlay) {
      ctx.drawImage(bottle, 0, 0, 32, 32);
      const od = this.view!.imageData(overlay, 16);
      const d = od.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = (d[i] * rgb[0]) / 255;
        d[i + 1] = (d[i + 1] * rgb[1]) / 255;
        d[i + 2] = (d[i + 2] * rgb[2]) / 255;
      }
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = 16;
      tmp.getContext('2d')!.putImageData(od, 0, 0);
      ctx.drawImage(tmp, 0, 0, 32, 32);
      return c;
    }
    // sans pack : la fiole dessinée, liquide (moitié basse) recoloré
    ctx.drawImage(this.iconCanvas(base), 0, 0);
    const img = ctx.getImageData(0, 0, 32, 32);
    const d = img.data;
    for (let y = 14; y < 30; y++)
      for (let x = 6; x < 26; x++) {
        const i = (y * 32 + x) * 4;
        if (d[i + 3] < 128) continue;
        const l = (d[i] + d[i + 1] + d[i + 2]) / 765;
        if (l < 0.18 || l > 0.85) continue;
        d[i] = rgb[0] * (0.6 + l * 0.6);
        d[i + 1] = rgb[1] * (0.6 + l * 0.6);
        d[i + 2] = rgb[2] * (0.6 + l * 0.6);
      }
    ctx.putImageData(img, 0, 0);
    return c;
  }

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
