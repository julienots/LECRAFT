/**
 * Correspondances entre les noms de fichiers de textures de l'édition Bedrock
 * (packs .mcpack : textures/blocks, textures/items, textures/entity) et les noms du jeu
 * (convention Java : block/…, item/…, entity/…). Les noms identiques ne sont pas listés.
 */
export const BEDROCK_BLOCK_TEXTURES: Record<string, string> = {
  grass_top: 'grass_block_top',
  grass_side_carried: 'grass_block_side',
  grass_side_snowed: 'grass_block_snow',
  dirt_podzol_top: 'podzol_top',
  dirt_podzol_side: 'podzol_side',
  stone_granite: 'granite',
  stone_diorite: 'diorite',
  stone_andesite: 'andesite',
  cobblestone_mossy: 'mossy_cobblestone',
  stonebrick: 'stone_bricks',
  stonebrick_mossy: 'mossy_stone_bricks',
  stonebrick_cracked: 'cracked_stone_bricks',
  brick: 'bricks',
  glass: 'glass',
  sandstone_normal: 'sandstone',
  sandstone_top: 'sandstone_top',
  sandstone_bottom: 'sandstone_bottom',
  torch_on: 'torch',
  furnace_front_off: 'furnace_front',
  furnace_front_on: 'furnace_front_on',
  furnace_side: 'furnace_side',
  furnace_top: 'furnace_top',
  crafting_table_front: 'crafting_table_front',
  crafting_table_side: 'crafting_table_side',
  crafting_table_top: 'crafting_table_top',
  farmland_dry: 'farmland',
  farmland_wet: 'farmland_moist',
  door_wood_lower: 'oak_door_bottom',
  door_wood_upper: 'oak_door_top',
  reeds: 'sugar_cane',
  pumpkin_side: 'pumpkin_side',
  pumpkin_top: 'pumpkin_top',
  melon_side: 'melon_side',
  melon_top: 'melon_top',
  hay_block_side: 'hay_block_side',
  hay_block_top: 'hay_block_top',
  mob_spawner: 'spawner',
  snow: 'snow',
  ice_packed: 'packed_ice',
  tallgrass: 'short_grass',
  fern: 'fern',
  flower_dandelion: 'dandelion',
  flower_rose: 'poppy',
  flower_cornflower: 'cornflower',
  flower_oxeye_daisy: 'oxeye_daisy',
  deadbush: 'dead_bush',
  mushroom_brown: 'brown_mushroom',
  mushroom_red: 'red_mushroom',
  grass_path_top: 'dirt_path_top',
  grass_path_side: 'dirt_path_side',
  stone_slab_top: 'stone',
  ladder: 'ladder',
  lantern: 'lantern',
  moss_block: 'moss_block',
  mud: 'mud',
  amethyst_block: 'amethyst_block',
  amethyst_cluster: 'amethyst_cluster',
  glow_lichen: 'glow_lichen',
  water_still_grey: 'water',
  water_still: 'water',
  lava_still: 'lava',
  cactus_side: 'cactus_side',
  cactus_top: 'cactus_top',
  cactus_bottom: 'cactus_bottom',
  bookshelf: 'bookshelf',
  tnt_side: 'tnt_side',
  tnt_top: 'tnt_top',
  tnt_bottom: 'tnt_bottom',
  obsidian: 'obsidian',
  bedrock: 'bedrock',
  clay: 'clay',
  gravel: 'gravel',
  sand: 'sand',
};

const WOODS: [string, string][] = [['oak', 'oak'], ['spruce', 'spruce'], ['birch', 'birch'], ['jungle', 'jungle'], ['acacia', 'acacia'], ['big_oak', 'dark_oak']];
for (const [b, j] of WOODS) {
  BEDROCK_BLOCK_TEXTURES[`planks_${b}`] = `${j}_planks`;
  BEDROCK_BLOCK_TEXTURES[`log_${b}`] = `${j}_log`;
  BEDROCK_BLOCK_TEXTURES[`log_${b}_top`] = `${j}_log_top`;
  BEDROCK_BLOCK_TEXTURES[`leaves_${b}`] = `${j}_leaves`;
  BEDROCK_BLOCK_TEXTURES[`leaves_${b}_opaque`] = `${j}_leaves`;
  BEDROCK_BLOCK_TEXTURES[`sapling_${b === 'big_oak' ? 'roofed_oak' : b}`] = `${j}_sapling`;
}
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'silver', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
for (const c of COLORS) BEDROCK_BLOCK_TEXTURES[`wool_colored_${c}`] = `${c === 'silver' ? 'light_gray' : c}_wool`;
for (let i = 0; i < 8; i++) BEDROCK_BLOCK_TEXTURES[`wheat_stage_${i}`] = `wheat_stage${i}`;
for (let i = 0; i < 4; i++) {
  BEDROCK_BLOCK_TEXTURES[`carrots_stage_${i}`] = `carrots_stage${i}`;
  BEDROCK_BLOCK_TEXTURES[`potatoes_stage_${i}`] = `potatoes_stage${i}`;
}
for (let i = 0; i < 10; i++) BEDROCK_BLOCK_TEXTURES[`destroy_stage_${i}`] = `destroy_stage_${i}`;
for (const o of ['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond', 'emerald']) {
  BEDROCK_BLOCK_TEXTURES[`${o}_ore`] = `${o}_ore`;
  BEDROCK_BLOCK_TEXTURES[`${o}_block`] = `${o}_block`;
}

export const BEDROCK_ITEM_TEXTURES: Record<string, string> = {
  bucket_empty: 'bucket',
  bucket_water: 'water_bucket',
  bucket_lava: 'lava_bucket',
  bucket_milk: 'milk_bucket',
  seeds_wheat: 'wheat_seeds',
  beef_raw: 'beef',
  beef_cooked: 'cooked_beef',
  porkchop_raw: 'porkchop',
  porkchop_cooked: 'cooked_porkchop',
  chicken_raw: 'chicken',
  chicken_cooked: 'cooked_chicken',
  mutton_raw: 'mutton',
  mutton_cooked: 'cooked_mutton',
  potato_baked: 'baked_potato',
  potato_poisonous: 'poisonous_potato',
  apple_golden: 'golden_apple',
  melon: 'melon_slice',
  dye_powder_blue: 'lapis_lazuli',
  dye_powder_white: 'bone_meal',
  redstone_dust: 'redstone',
  slimeball: 'slime_ball',
  fireball: 'fire_charge',
  door_wood: 'oak_door',
  bed_red: 'red_bed',
  book_normal: 'book',
  reeds: 'sugar_cane',
  arrow: 'arrow',
  bow_standby: 'bow',
  compass_item: 'compass',
};
for (const [b, j] of [['wood', 'wooden'], ['stone', 'stone'], ['iron', 'iron'], ['gold', 'golden'], ['diamond', 'diamond'], ['copper', 'copper']])
  for (const t of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) BEDROCK_ITEM_TEXTURES[`${b}_${t}`] = `${j}_${t}`;
for (const [b, j] of [['leather', 'leather'], ['iron', 'iron'], ['gold', 'golden'], ['diamond', 'diamond']])
  for (const t of ['helmet', 'chestplate', 'leggings', 'boots']) BEDROCK_ITEM_TEXTURES[`${b}_${t}`] = `${j}_${t}`;

/** Textures d'entités Bedrock → chemins attendus par TextureManager (convention Java). */
export const BEDROCK_ENTITY_TEXTURES: Record<string, string> = {
  'pig/pig_v3': 'entity/pig/pig',
  'pig/pig': 'entity/pig/pig',
  'cow/cow_v2': 'entity/cow/cow',
  'cow/cow': 'entity/cow/cow',
  'sheep/sheep': 'entity/sheep/sheep',
  chicken: 'entity/chicken',
  'chicken/chicken': 'entity/chicken',
  'zombie/zombie': 'entity/zombie/zombie',
  'zombie/husk': 'entity/zombie/husk',
  'skeleton/skeleton': 'entity/skeleton/skeleton',
  'spider/spider': 'entity/spider/spider',
  'spider/cave_spider': 'entity/spider/cave_spider',
  'slime/slime': 'entity/slime/slime',
};

/** Étiquettes de biomes (filtres d'apparition des add-ons) → biomes du jeu. */
export const BIOME_TAGS: Record<string, string[]> = {
  plains: ['plains'],
  forest: ['forest', 'dense_forest'],
  roofed: ['dense_forest'],
  desert: ['desert'],
  jungle: ['jungle'],
  savanna: ['savanna'],
  swamp: ['swamp'],
  mountain: ['mountain'],
  mountains: ['mountain'],
  extreme_hills: ['mountain'],
  taiga: ['taiga'],
  cold: ['taiga', 'tundra', 'ice_zone'],
  frozen: ['tundra', 'ice_zone'],
  ice: ['ice_zone'],
  beach: ['beach'],
  ocean: ['ocean'],
  river: ['river'],
  animal: ['plains', 'forest', 'dense_forest', 'savanna', 'taiga', 'tundra', 'jungle', 'swamp', 'mountain'],
  monster: ['plains', 'forest', 'dense_forest', 'desert', 'jungle', 'savanna', 'swamp', 'mountain', 'taiga', 'tundra', 'beach', 'ice_zone'],
  overworld: ['plains', 'forest', 'dense_forest', 'desert', 'jungle', 'savanna', 'swamp', 'mountain', 'taiga', 'tundra', 'beach', 'ocean', 'river', 'ice_zone'],
};
