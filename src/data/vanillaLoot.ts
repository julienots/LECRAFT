/**
 * Tables de butin des coffres du jeu original (bedrock-samples/loot_tables/chests), identifiants
 * convertis en identifiants Java ; seuls les objets existant dans LeCraft sont gardés.
 * Ne pas éditer à la main : script d'audit (compare-recipes.mjs --loot).
 * Pool : [[tirages min, max], entrées] ; entrée : [objet ('' = rien), poids, min, max, drapeaux?]
 * (drapeaux : 1 = enchanté au hasard, 2 = usure aléatoire).
 */
export type LootPoolEntry = [string, number, number, number, number?];
export type LootPool = [[number, number], LootPoolEntry[]];

export const VANILLA_CHEST_LOOT: Record<string, LootPool[]> = {
  simple_dungeon: [
    [[1, 3], [['leather', 20, 1, 5], ['golden_apple', 15, 1, 1], ['music_disc_13', 15, 1, 1], ['music_disc_cat', 15, 1, 1], ['music_disc_otherside', 2, 1, 1], ['name_tag', 20, 1, 1], ['golden_horse_armor', 10, 1, 1], ['iron_horse_armor', 15, 1, 1], ['copper_horse_armor', 15, 1, 1], ['diamond_horse_armor', 5, 1, 1], ['enchanted_book', 10, 1, 1]]],
    [[1, 4], [['iron_ingot', 10, 1, 4], ['gold_ingot', 5, 1, 4], ['bread', 20, 1, 1], ['wheat', 20, 1, 4], ['bucket', 10, 1, 1], ['redstone', 15, 1, 4], ['coal', 15, 1, 4], ['melon_seeds', 10, 2, 4], ['pumpkin_seeds', 10, 2, 4], ['beetroot_seeds', 10, 2, 4]]],
    [[3, 3], [['bone', 10, 1, 8], ['gunpowder', 10, 1, 8], ['rotten_flesh', 10, 1, 8], ['string', 10, 1, 8]]],
  ],
  abandoned_mineshaft: [
    [[1, 1], [['golden_apple', 20, 1, 1], ['name_tag', 30, 1, 1], ['enchanted_book', 10, 1, 1], ['iron_pickaxe', 5, 1, 1], ['', 5, 0, 0]]],
    [[2, 4], [['iron_ingot', 10, 1, 5], ['gold_ingot', 5, 1, 3], ['redstone', 5, 4, 9], ['lapis_lazuli', 5, 4, 9], ['diamond', 3, 1, 2], ['coal', 10, 3, 8], ['bread', 15, 1, 3], ['melon_seeds', 10, 2, 4], ['pumpkin_seeds', 10, 2, 4], ['beetroot_seeds', 10, 2, 4], ['glow_berries', 15, 3, 6]]],
    [[3, 3], [['rail', 20, 4, 8], ['powered_rail', 5, 1, 4], ['detector_rail', 5, 1, 4], ['activator_rail', 5, 1, 4], ['torch', 15, 1, 16]]],
  ],
  nether_bridge: [
    [[2, 4], [['diamond', 5, 1, 3], ['iron_ingot', 5, 1, 5], ['gold_ingot', 15, 1, 3], ['golden_sword', 5, 1, 1], ['golden_chestplate', 5, 1, 1], ['flint_and_steel', 5, 1, 1], ['nether_wart', 5, 3, 7], ['saddle', 10, 1, 1], ['golden_horse_armor', 8, 1, 1], ['iron_horse_armor', 5, 1, 1], ['copper_horse_armor', 5, 1, 1], ['diamond_horse_armor', 3, 1, 1], ['obsidian', 2, 2, 4]]],
    [[1, 1], [['', 14, 0, 0], ['rib_armor_trim_smithing_template', 1, 1, 1]]],
  ],
  desert_pyramid: [
    [[2, 4], [['diamond', 5, 1, 3], ['iron_ingot', 15, 1, 5], ['gold_ingot', 15, 2, 7], ['emerald', 15, 1, 3], ['bone', 25, 4, 6], ['spider_eye', 25, 1, 3], ['rotten_flesh', 25, 3, 7], ['leather', 20, 1, 5], ['iron_horse_armor', 15, 1, 1], ['copper_horse_armor', 15, 1, 1], ['golden_horse_armor', 10, 1, 1], ['diamond_horse_armor', 5, 1, 1], ['enchanted_book', 20, 1, 1], ['golden_apple', 20, 1, 1], ['', 15, 0, 0]]],
    [[4, 4], [['bone', 10, 1, 8], ['gunpowder', 10, 1, 8], ['rotten_flesh', 10, 1, 8], ['string', 10, 1, 8], ['sand', 10, 1, 8]]],
    [[1, 1], [['', 6, 0, 0], ['dune_armor_trim_smithing_template', 1, 2, 2]]],
  ],
  jungle_temple: [
    [[2, 6], [['diamond', 15, 1, 3], ['iron_ingot', 50, 1, 5], ['gold_ingot', 75, 2, 7], ['emerald', 10, 1, 3], ['bone', 100, 4, 6], ['rotten_flesh', 80, 3, 7], ['bamboo', 75, 1, 3], ['leather', 15, 1, 5], ['iron_horse_armor', 5, 1, 1], ['copper_horse_armor', 5, 1, 1], ['golden_horse_armor', 5, 1, 1], ['diamond_horse_armor', 5, 1, 1], ['enchanted_book', 6, 1, 1]]],
    [[1, 1], [['', 2, 0, 0], ['wild_armor_trim_smithing_template', 1, 2, 2]]],
  ],
  igloo_chest: [
    [[2, 8], [['apple', 15, 1, 1], ['coal', 15, 1, 1], ['gold_nugget', 10, 1, 1], ['stone_axe', 2, 1, 1], ['rotten_flesh', 10, 1, 1], ['emerald', 1, 1, 1], ['wheat', 10, 1, 1]]],
    [[1, 1], [['golden_apple', 1, 1, 1]]],
  ],
  shipwreck: [
    [[1, 1], [['map', 1, 1, 1]]],
    [[3, 3], [['compass', 1, 1, 1], ['map', 1, 1, 1], ['clock', 1, 1, 1], ['paper', 20, 1, 10], ['feather', 10, 1, 5], ['book', 5, 1, 5]]],
    [[1, 1], [['', 5, 0, 0], ['coast_armor_trim_smithing_template', 1, 2, 2]]],
  ],
  shipwrecksupply: [
    [[3, 10], [['paper', 8, 1, 12], ['potato', 7, 2, 6], ['moss_block', 7, 1, 4], ['poisonous_potato', 7, 2, 6], ['carrot', 7, 4, 8], ['wheat', 7, 8, 21], ['coal', 6, 2, 8], ['rotten_flesh', 5, 5, 24], ['bamboo', 2, 1, 3], ['pumpkin', 2, 1, 3], ['gunpowder', 3, 1, 5], ['tnt', 1, 1, 2], ['leather_helmet', 3, 1, 1, 1], ['leather_chestplate', 3, 1, 1, 1], ['leather_leggings', 3, 1, 1, 1], ['leather_boots', 3, 1, 1, 1], ['suspicious_stew', 10, 1, 1]]],
    [[1, 1], [['', 5, 0, 0], ['coast_armor_trim_smithing_template', 1, 2, 2]]],
    [[1, 1], [['copper_nautilus_armor', 100, 1, 1], ['iron_nautilus_armor', 50, 1, 1], ['golden_nautilus_armor', 25, 1, 1], ['diamond_nautilus_armor', 10, 1, 1]]],
  ],
  shipwrecktreasure: [
    [[3, 6], [['iron_ingot', 90, 1, 5], ['gold_ingot', 10, 1, 5], ['emerald', 40, 1, 5], ['diamond', 5, 1, 1], ['experience_bottle', 5, 1, 1]]],
    [[2, 5], [['iron_nugget', 50, 1, 10], ['gold_nugget', 10, 1, 10], ['lapis_lazuli', 20, 1, 10]]],
    [[1, 1], [['', 5, 0, 0], ['coast_armor_trim_smithing_template', 1, 2, 2]]],
  ],
  underwater_ruin_small: [
    [[2, 8], [['coal', 10, 1, 1], ['stone_axe', 2, 1, 1], ['stone_spear', 2, 1, 1], ['rotten_flesh', 5, 1, 1], ['emerald', 1, 1, 1], ['wheat', 10, 1, 1]]],
    [[1, 1], [['leather_chestplate', 1, 1, 1], ['golden_helmet', 1, 1, 1], ['fishing_rod', 5, 1, 1, 1], ['map', 5, 1, 1]]],
    [[1, 1], [['copper_nautilus_armor', 100, 1, 1], ['iron_nautilus_armor', 50, 1, 1], ['golden_nautilus_armor', 25, 1, 1], ['diamond_nautilus_armor', 10, 1, 1]]],
  ],
  underwater_ruin_big: [
    [[2, 8], [['coal', 10, 1, 1], ['stone_spear', 2, 1, 1], ['gold_nugget', 10, 1, 1], ['emerald', 1, 1, 1], ['wheat', 10, 1, 1]]],
    [[1, 1], [['golden_apple', 1, 1, 1], ['enchanted_book', 5, 1, 1], ['leather_chestplate', 1, 1, 1], ['golden_helmet', 1, 1, 1], ['fishing_rod', 5, 1, 1, 1], ['map', 10, 1, 1]]],
    [[1, 1], [['copper_nautilus_armor', 100, 1, 1], ['iron_nautilus_armor', 50, 1, 1], ['golden_nautilus_armor', 25, 1, 1], ['diamond_nautilus_armor', 10, 1, 1]]],
  ],
  ruined_portal: [
    [[4, 8], [['obsidian', 40, 1, 2], ['flint', 40, 1, 4], ['iron_nugget', 40, 9, 18], ['flint_and_steel', 40, 1, 1], ['fire_charge', 40, 1, 1], ['golden_apple', 15, 1, 1], ['gold_nugget', 15, 4, 24], ['golden_sword', 15, 1, 1, 1], ['golden_axe', 15, 1, 1, 1], ['golden_hoe', 15, 1, 1, 1], ['golden_shovel', 15, 1, 1, 1], ['golden_pickaxe', 15, 1, 1, 1], ['golden_boots', 15, 1, 1, 1], ['golden_chestplate', 15, 1, 1, 1], ['golden_helmet', 15, 1, 1, 1], ['golden_leggings', 15, 1, 1, 1], ['glistering_melon_slice', 5, 4, 12], ['golden_horse_armor', 5, 1, 1], ['golden_carrot', 5, 4, 12], ['clock', 5, 1, 1], ['gold_ingot', 5, 2, 8], ['bell', 1, 1, 1], ['gold_block', 1, 1, 2]]],
    [[1, 1], [['', 1, 0, 0], ['lodestone', 2, 1, 2]]],
  ],
  pillager_outpost: [
    [[0, 1], [['crossbow', 1, 1, 1]]],
    [[2, 3], [['wheat', 7, 3, 5], ['potato', 5, 2, 5], ['carrot', 5, 3, 5]]],
    [[1, 3], [['dark_oak_log', 1, 2, 3]]],
    [[2, 3], [['experience_bottle', 7, 1, 1], ['string', 4, 1, 6], ['arrow', 4, 2, 7], ['tripwire_hook', 3, 1, 3], ['iron_ingot', 3, 1, 3], ['enchanted_book', 1, 1, 1]]],
    [[0, 1], [['goat_horn', 1, 1, 1]]],
    [[1, 1], [['', 3, 0, 0], ['sentry_armor_trim_smithing_template', 1, 2, 2]]],
  ],
};
