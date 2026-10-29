/**
 * Valeurs du jeu original (Java 1.21) pour la dureté, l'outil efficace et le tier minimal requis
 * pour obtenir les drops (1 bois/or, 2 pierre, 3 fer, 4 diamant ; 0 = aucun outil requis).
 * Appliquées aux définitions avant leur enregistrement (n'affecte pas les identifiants).
 * Seuls les blocs dont les valeurs différaient sont listés (audit des blocs / outils).
 */
import type { BlockDef, DropDef, ToolType } from '../blocks/Block';

type Props = [hardness: number, tool: ToolType | null, minTier: number, drops?: DropDef[]];
const P = (h: number, t = 1): Props => [h, 'pickaxe', t];

export const JAVA_BLOCK_PROPS: Record<string, Props> = {
  // minerais des abîmes et du Nether
  nether_gold_ore: P(3),
  // métaux : le cuivre et le fer demandent une pioche en pierre
  raw_copper_block: P(5, 2), raw_iron_block: P(5, 2), raw_gold_block: P(5, 3),
  lightning_rod: P(3, 2),
  iron_bars: P(5), iron_chain: P(5), copper_chain: P(5, 2), exposed_copper_chain: P(5, 2), weathered_copper_chain: P(5, 2), oxidized_copper_chain: P(5, 2),
  copper_bars: P(5, 2), exposed_copper_bars: P(5, 2), weathered_copper_bars: P(5, 2), oxidized_copper_bars: P(5, 2),
  lantern: P(3.5), soul_lantern: P(3.5), copper_lantern: P(3.5), exposed_copper_lantern: P(3.5), weathered_copper_lantern: P(3.5), oxidized_copper_lantern: P(3.5),
  bell: P(5), cauldron: P(2), water_cauldron: P(2), hopper: P(3), anvil: P(5), chipped_anvil: P(5), damaged_anvil: P(5),
  brewing_stand: P(0.5), enchanting_table: P(5), stonecutter: P(3.5), smoker: P(3.5), grindstone: P(2), heavy_core: P(10),
  conduit: [3, 'pickaxe', 0], beacon: [3, null, 0],
  stone_pressure_plate: P(0.5),
  // stations en bois (dureté 2,5 dans le jeu original)
  barrel: [2.5, 'axe', 0], cartography_table: [2.5, 'axe', 0], fletching_table: [2.5, 'axe', 0], smithing_table: [2.5, 'axe', 0], loom: [2.5, 'axe', 0], lectern: [2.5, 'axe', 0],
  composter: [0.6, 'axe', 0], noteblock: [0.8, 'axe', 0], daylight_detector: [0.2, 'axe', 0], carved_pumpkin: [1, 'axe', 0], jack_o_lantern: [1, 'axe', 0],
  creaking_heart: [10, 'axe', 0], mangrove_roots: [0.7, 'axe', 0], chorus_plant: [0.4, 'axe', 0], chorus_flower: [0.4, 'axe', 0], big_dripleaf: [0.1, 'axe', 0], bamboo_plant: [1, 'axe', 0],
  // blocs « instantanés »
  flower_pot: [0, null, 0], repeater: [0, null, 0], comparator: [0, null, 0], scaffolding: [0, null, 0], item_frame: [0, null, 0], glow_item_frame: [0, null, 0],
  sea_pickle: [0, null, 0], leaf_litter: [0, null, 0], wildflowers: [0, null, 0], frogspawn: [0, null, 0], tripwire: [0, null, 0], resin_clump: [0, null, 0], resin_block: [0, null, 0],
  turtle_egg: [0.5, null, 0], sniffer_egg_not_cracked: [0.5, null, 0], glowstone: [0.3, null, 0], tinted_glass: [0.3, null, 0], honeycomb_block: [0.6, null, 0],
  calibrated_sculk_sensor: [1.5, 'hoe', 0], sculk_vein: [0.2, 'hoe', 0], pale_moss_block: [0.1, 'hoe', 0], powder_snow: [0.25, null, 0, []],
  // pierres et variantes
  cracked_deepslate_tiles: P(3.5), chiseled_red_sandstone: P(0.8), chiseled_resin_bricks: P(1.5), resin_bricks: P(1.5), prismarine_bricks: P(1.5),
  cracked_polished_blackstone_bricks: P(1.5), chiseled_tuff_bricks: P(1.5), shulker_box: [2, 'pickaxe', 0], quartz_stairs: P(0.8),
  budding_amethyst: [1.5, 'pickaxe', 0, []], reinforced_deepslate: [55, null, 0, []],
  // blocs techniques : incassables en survie, comme le jeu original
  vault: [50, null, 0, []], trial_spawner: [50, 'pickaxe', 0, []],
  command_block: [-1, null, 0], chain_command_block: [-1, null, 0], repeating_command_block: [-1, null, 0], structure_block: [-1, null, 0], jigsaw: [-1, null, 0],
  // neige : il faut une pelle (4 boules de neige) ; toile : épée ou cisailles
  snow_block: [0.2, 'shovel', 1, [{ item: 'snowball', min: 4, max: 4 }]],
  cobweb: [4, 'sword', 1, [{ item: 'string' }]],
};

// cuivre (blocs, découpes, grilles, ampoules, portes, trappes) : pioche en pierre
for (const ox of ['', 'exposed_', 'weathered_', 'oxidized_']) {
  for (const k of ['cut_copper', 'chiseled_copper', 'copper_grate', 'copper_bulb', 'copper_door', 'copper_trapdoor', 'cut_copper_stairs', 'cut_copper_slab'])
    JAVA_BLOCK_PROPS[`${ox}${k}`] ??= P(3, 2);
  if (ox) JAVA_BLOCK_PROPS[`${ox}copper`] ??= P(3, 2);
  if (ox) JAVA_BLOCK_PROPS[`${ox}lightning_rod`] ??= P(3, 2);
}
// escaliers, dalles et murets : dureté du bloc d'origine (ardoise des abîmes 3,5 ; tuf 1,5 ; granite… 1,5)
for (const base of ['cobbled_deepslate', 'polished_deepslate', 'deepslate_brick', 'deepslate_tile']) for (const s of ['stairs', 'slab', 'wall']) JAVA_BLOCK_PROPS[`${base}_${s}`] = P(3.5);
for (const base of ['tuff', 'polished_tuff', 'tuff_brick', 'mud_brick', 'granite', 'diorite', 'andesite', 'polished_granite', 'polished_diorite', 'polished_andesite', 'mossy_stone_brick', 'prismarine', 'purpur', 'dark_prismarine'])
  for (const s of ['stairs', 'slab', 'wall']) JAVA_BLOCK_PROPS[`${base}_${s}`] = P(1.5);
JAVA_BLOCK_PROPS.stone_brick_wall = P(1.5);
JAVA_BLOCK_PROPS.blackstone_stairs = P(1.5);
JAVA_BLOCK_PROPS.blackstone_wall = P(1.5);
JAVA_BLOCK_PROPS.polished_blackstone_brick_stairs = P(1.5);
JAVA_BLOCK_PROPS.polished_blackstone_brick_wall = P(1.5);
for (const base of ['sandstone', 'red_sandstone']) {
  JAVA_BLOCK_PROPS[`${base}_stairs`] = P(0.8);
  JAVA_BLOCK_PROPS[`${base}_wall`] = P(0.8);
}
for (const base of ['end_stone_brick']) for (const s of ['stairs', 'slab', 'wall']) JAVA_BLOCK_PROPS[`${base}_${s}`] = P(3);

/** Objets obtenus du jeu original (sans Toucher de soie) quand ils différaient. */
export const JAVA_DROPS: Record<string, DropDef[]> = {
  sea_lantern: [{ item: 'prismarine_crystals', min: 2, max: 3 }],
  ender_chest_block: [{ item: 'obsidian', min: 8, max: 8 }],
  campfire: [{ item: 'charcoal', min: 2, max: 2 }],
  soul_campfire: [{ item: 'soul_soil' }],
  amethyst_cluster: [{ item: 'amethyst_shard', min: 4, max: 4 }],
  // Toucher de soie obligatoire (sinon rien, ou seulement de l'expérience)
  bee_nest: [], turtle_egg: [], cake: [], vine: [], mushroom_stem: [],
  sculk: [], sculk_vein: [], sculk_sensor: [], calibrated_sculk_sensor: [], sculk_catalyst: [], sculk_shrieker: [],
  // blocs de champignon : 0 à 2 champignons (aléa -6..2 borné à 0)
  red_mushroom_block: [{ item: 'red_mushroom', min: 1, max: 2, chance: 2 / 9 }],
  brown_mushroom_block: [{ item: 'brown_mushroom', min: 1, max: 2, chance: 2 / 9 }],
  // cultures du pack : stade final = récolte complète
  cocoa_stage0: [{ item: 'cocoa_beans' }], cocoa_stage1: [{ item: 'cocoa_beans' }], cocoa_stage2: [{ item: 'cocoa_beans', min: 2, max: 3 }],
  nether_wart_stage0: [{ item: 'nether_wart' }], nether_wart_stage1: [{ item: 'nether_wart' }], nether_wart_stage2: [{ item: 'nether_wart', min: 2, max: 4 }],
  beetroots_stage0: [{ item: 'beetroot_seeds' }], beetroots_stage1: [{ item: 'beetroot_seeds' }], beetroots_stage2: [{ item: 'beetroot_seeds' }],
  beetroots_stage3: [{ item: 'beetroot' }, { item: 'beetroot_seeds', min: 1, max: 4 }],
  // sable / gravier suspects : rien (le pinceau révèle l'objet) ; ghast desséché : lui-même
  ...Object.fromEntries([0, 1, 2, 3].flatMap((i) => [[`suspicious_sand_${i}`, []], [`suspicious_gravel_${i}`, []], [`dried_ghast_hydration_${i}`, [{ item: 'dried_ghast' }]]])),
};

/** Applique les valeurs du jeu original (en place) aux définitions présentes. */
export function applyJavaBlockProps(defs: BlockDef[]) {
  for (const d of defs) {
    const dr = JAVA_DROPS[d.key];
    if (dr) d.drops = dr;
    const p = JAVA_BLOCK_PROPS[d.key];
    if (!p) continue;
    const [hardness, tool, minTier, drops] = p;
    d.hardness = hardness;
    d.tool = tool ?? undefined;
    d.minTier = minTier;
    if (drops) d.drops = drops;
  }
}
