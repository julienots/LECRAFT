/**
 * Valeurs du jeu original (Java 1.21) pour les objets : taille des piles, usure, nourriture et
 * durée de combustion (secondes). Appliquées par ItemRegistry.register à TOUS les objets (y compris
 * les objets-blocs créés au chargement), pour les clés du jeu original uniquement.
 */
import type { ItemDef } from '../inventory/Item';

const NETHER_WOOD = /^(stripped_)?(crimson|warped)_|^(crimson|warped)_/;
const WOOD = '(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)';

/** Objets non empilables (en plus des outils et armures). */
const STACK_1 = new RegExp(
  [
    '^(water|lava|milk|powder_snow|cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket$', '_boat$', '_raft$', 'minecart$', '^saddle$', '_bed$', '^music_disc_',
    '^(splash_|lingering_)?potion$', '^enchanted_book$', '^writable_book$', '_stew$', '_soup$', '^cake$', 'shulker_box$', '^totem_of_undying$', '_horse_armor$', '_nautilus_armor$',
    '^wolf_armor$', '^spyglass$', '^goat_horn$', 'bundle$', '^knowledge_book$', '^debug_stick$', '^elytra$', '^shield$', '^trident$', '^crossbow$', '^mace$', '^brush$', '_on_a_stick$',
    '^flint_and_steel$', '^shears$', '^fishing_rod$', '^bow$', '_harness$', '_banner_pattern$',
  ].join('|'),
);
/** Objets empilables par 16. */
const STACK_16 = /^(ender_pearl|snowball|egg|blue_egg|brown_egg|bucket|honey_bottle|armor_stand|written_book)$|_sign$|_banner$/;

/** Usure des objets qui ne sont ni outils ni armures (jeu original). */
export const JAVA_DURABILITY: Record<string, number> = {
  bow: 384, crossbow: 465, trident: 250, shears: 238, fishing_rod: 64, flint_and_steel: 64, shield: 336, elytra: 432,
  carrot_on_a_stick: 25, warped_fungus_on_a_stick: 100, brush: 64, mace: 500,
};

/** Nourriture [faim, saturation] du jeu original. */
export const JAVA_FOOD: Record<string, [number, number]> = {
  apple: [4, 2.4], baked_potato: [5, 6], beetroot: [1, 1.2], beetroot_soup: [6, 7.2], bread: [5, 6], carrot: [3, 3.6], chorus_fruit: [4, 2.4],
  cooked_chicken: [6, 7.2], cooked_cod: [5, 6], cooked_mutton: [6, 9.6], cooked_porkchop: [8, 12.8], cooked_rabbit: [5, 6], cooked_salmon: [6, 9.6],
  cooked_beef: [8, 12.8], cookie: [2, 0.4], dried_kelp: [1, 0.6], enchanted_golden_apple: [4, 9.6], golden_apple: [4, 9.6], glow_berries: [2, 0.4],
  golden_carrot: [6, 14.4], honey_bottle: [6, 1.2], melon_slice: [2, 1.2], mushroom_stew: [6, 7.2], poisonous_potato: [2, 1.2], potato: [1, 0.6],
  pufferfish: [1, 0.2], pumpkin_pie: [8, 4.8], rabbit_stew: [10, 12], beef: [3, 1.8], chicken: [2, 1.2], cod: [2, 0.4], mutton: [2, 1.2],
  porkchop: [3, 1.8], rabbit: [3, 1.8], salmon: [2, 0.4], rotten_flesh: [4, 0.8], spider_eye: [2, 3.2], suspicious_stew: [6, 7.2],
  sweet_berries: [2, 0.4], tropical_fish: [1, 0.2],
};

/** Durée de combustion (s) du jeu original : 1 objet = 10 s de cuisson. */
export function javaBurnTime(key: string): number | undefined {
  const exact: Record<string, number> = {
    lava_bucket: 1000, coal_block: 800, dried_kelp_block: 200, blaze_rod: 120, coal: 80, charcoal: 80,
    stick: 5, bowl: 5, dead_bush: 5, azalea: 5, flowering_azalea: 5, mangrove_propagule: 5,
    bamboo: 2.5, scaffolding: 2.5,
    crafting_table: 15, chest: 15, trapped_chest: 15, bookshelf: 15, chiseled_bookshelf: 15, lectern: 15, composter: 15, barrel: 15,
    cartography_table: 15, fletching_table: 15, smithing_table: 15, loom: 15, noteblock: 15, note_block: 15, jukebox: 15, daylight_detector: 15,
    ladder: 15, bow: 15, crossbow: 15, fishing_rod: 15, mangrove_roots: 15, bamboo_mosaic: 15, bamboo_block: 15, stripped_bamboo_block: 15,
    bamboo_mosaic_slab: 7.5, bamboo_mosaic_stairs: 15, beehive: 15, bee_nest: 15,
  };
  if (exact[key] !== undefined) return exact[key];
  if (NETHER_WOOD.test(key)) return undefined; // bois du Nether : ininflammable
  if (/_wool$/.test(key) || /_sapling$/.test(key) || /_button$/.test(key) && new RegExp(`^${WOOD}_`).test(key)) return 5;
  if (/_carpet$/.test(key) && key !== 'moss_carpet' && key !== 'pale_moss_carpet') return 3.35;
  if (/_banner$/.test(key)) return 15;
  if (/_(boat|raft|chest_boat|chest_raft)$/.test(key)) return 60;
  if (new RegExp(`^${WOOD}_(door|sign|hanging_sign)$`).test(key)) return 10;
  if (new RegExp(`^${WOOD}_slab$`).test(key)) return 7.5;
  if (new RegExp(`^(stripped_)?${WOOD}_(planks|log|wood|stairs|fence|fence_gate|trapdoor|pressure_plate|shelf)$`).test(key)) return 15;
  if (/^wooden_(sword|pickaxe|axe|shovel|hoe|spear)$/.test(key)) return 10;
  return undefined;
}

/** [dégâts, recharge d'attaque en s] des armes dont la vitesse diffère du cas général. */
const JAVA_ATTACK: Record<string, [number | undefined, number]> = {
  mace: [6, 1 / 0.6],
  trident: [9, 1 / 1.1],
  wooden_hoe: [undefined, 1],
  golden_hoe: [undefined, 1],
  stone_hoe: [undefined, 0.5],
  iron_hoe: [undefined, 1 / 3],
  diamond_hoe: [undefined, 0.25],
  netherite_hoe: [undefined, 0.25],
};

/** Propriétés du jeu original à appliquer à un objet (seulement celles qui diffèrent). */
export function javaItemProps(def: ItemDef): Partial<ItemDef> {
  const k = def.key;
  const o: Partial<ItemDef> = {};
  if (!def.tool && !def.armor) {
    const stack = STACK_1.test(k) ? 1 : STACK_16.test(k) ? 16 : undefined;
    if (stack !== undefined && def.maxStack !== stack) o.maxStack = stack;
  }
  const dur = JAVA_DURABILITY[k];
  if (dur !== undefined) {
    if (def.tool && def.tool.durability !== dur) o.tool = { ...def.tool, durability: dur };
    else if (!def.tool && def.durability !== dur) o.durability = dur;
  }
  const f = JAVA_FOOD[k];
  if (f && (def.food?.hunger !== f[0] || def.food?.saturation !== f[1]))
    o.food = { ...(def.food ?? {}), hunger: f[0], saturation: f[1], ...(k.endsWith('golden_apple') ? { effect: 'regen' as const } : {}) };
  const bt = javaBurnTime(k);
  if (bt !== undefined && def.burnTime !== bt) o.burnTime = bt;
  // dégâts et recharge d'attaque du jeu original (1 / vitesse d'attaque)
  const atk = JAVA_ATTACK[k];
  if (atk) {
    if (atk[0] !== undefined && def.damage !== atk[0]) o.damage = atk[0];
    if (def.attackCooldown !== atk[1]) o.attackCooldown = atk[1];
  }
  return o;
}
