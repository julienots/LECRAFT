/**
 * Inventaire créatif de l'édition Bedrock : 4 onglets de catégorie (construction, équipement,
 * objets, nature) et l'onglet « Tous les objets » (recherche). L'ordre des objets suit celui du
 * vrai jeu : dans « Tous les objets », construction, puis nature, puis équipement, puis objets.
 * Les objets propres à LeCraft sont rangés à la fin de leur catégorie.
 */
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemDef, ItemStack } from '../inventory/Item';
import { POTIONS, makePotion } from '../inventory/Potions';
import { ENCHANTS } from '../inventory/Enchantments';
import { itemName } from './i18n';

export type CreativeCategory = 'construction' | 'equipment' | 'items' | 'nature';
export type CreativeTabKey = CreativeCategory | 'search';

export interface CreativeTab {
  key: CreativeTabKey;
  /** Titre affiché à droite en haut du panneau. */
  name: string;
  /** Objets candidats pour l'icône (le premier qui existe). */
  icon: string[];
}

export const CREATIVE_TABS: CreativeTab[] = [
  { key: 'construction', name: 'Construction', icon: ['bricks'] },
  { key: 'equipment', name: 'Équipement', icon: ['diamond_sword', 'iron_sword'] },
  { key: 'items', name: 'Objets', icon: ['red_bed', 'white_bed'] },
  { key: 'nature', name: 'Nature', icon: ['grass_block'] },
  { key: 'search', name: 'Tous les objets', icon: ['compass'] },
];

/** Catégories de l'ordre « Tous les objets ». */
const CAT_ORDER: CreativeCategory[] = ['construction', 'nature', 'equipment', 'items'];

export function tabIcon(t: CreativeTab): string {
  return t.icon.find((k) => ItemRegistry.has(k)) ?? t.icon[t.icon.length - 1];
}

// ---------------------------------------------------------------------------------------------
// Ordre des objets
// ---------------------------------------------------------------------------------------------
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
const COLORS = ['white', 'light_gray', 'gray', 'black', 'brown', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'light_blue', 'blue', 'purple', 'magenta', 'pink'];
const TIERS = ['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite', 'graphite', 'cardboard', 'leather', 'chainmail', 'turtle'];
const ARMOR_MATS = ['leather', 'chainmail', 'copper', 'iron', 'golden', 'diamond', 'netherite', 'turtle', 'cardboard'];

const woodRank = (k: string) => {
  // « dark_oak » et « pale_oak » avant « oak »
  const i = WOODS.findIndex((w) => k === w || k.startsWith(`${w}_`) || k.startsWith(`stripped_${w}_`) || k.startsWith(`waxed_${w}`));
  return i < 0 ? 99 : i;
};
const colorRank = (k: string) => {
  const names = [...COLORS].sort((a, b) => b.length - a.length);
  const c = names.find((n) => k.startsWith(`${n}_`));
  return c ? COLORS.indexOf(c) : -1;
};
const tierRank = (k: string) => {
  const i = TIERS.findIndex((t) => k.startsWith(`${t}_`));
  return i < 0 ? 99 : i;
};
const armorRank = (k: string) => {
  const i = ARMOR_MATS.findIndex((t) => k.startsWith(`${t}_`) || k.startsWith(`${t === 'golden' ? 'gold' : t}_`));
  return i < 0 ? 99 : i;
};

type Test = (k: string, d: ItemDef) => boolean;
interface Bucket {
  cat: CreativeCategory;
  /** Nom du groupe, pour y ranger un autre groupe juste derrière (posAfter). */
  id?: string;
  posAfter?: string;
  test: Test;
  /** Tri à l'intérieur du groupe (sinon : ordre du registre). */
  sort?: (k: string) => number;
}

const re = (r: RegExp): Test => (k) => r.test(k);
const list = (...keys: string[]): Test => {
  const s = new Set(keys);
  return (k) => s.has(k);
};
const ofList = (keys: string[]) => (k: string) => {
  const i = keys.indexOf(k);
  return i < 0 ? 999 : i;
};
/** Les groupes de blocs ne concernent que les blocs (un lingot de cuivre n'est pas un bloc de cuivre). */
const blockish = (d: ItemDef) => d.place !== undefined || d.tab === 'building' || d.tab === 'nature' || d.tab === 'functional';
const C = (test: Test, sort?: Bucket['sort']): Bucket => ({ cat: 'construction', test: (k, d) => blockish(d) && test(k, d), sort });
const N = (test: Test, sort?: Bucket['sort']): Bucket => ({ cat: 'nature', test: (k, d) => blockish(d) && test(k, d), sort });
const E = (test: Test, sort?: Bucket['sort']): Bucket => ({ cat: 'equipment', test, sort });
const I = (test: Test, sort?: Bucket['sort']): Bucket => ({ cat: 'items', test, sort });

const isColoredStairs = (k: string) => colorRank(k) >= 0;
const woodForm = (k: string) => (/^stripped_.*(log|stem|block)$/.test(k) ? 1 : /_(wood|hyphae)$/.test(k) ? 2 : /^stripped_.*(wood|hyphae)$/.test(k) ? 3 : 0);
const potionish = (k: string) => k === 'potion' || k === 'splash_potion' || k === 'lingering_potion';

/** Groupes dans l'ordre d'affichage ; le premier groupe qui reconnaît l'objet l'emporte. */
const BUCKETS: Bucket[] = [
  // ----- Construction -----
  C(re(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_planks$|^bamboo_mosaic$/), (k) => woodRank(k) * 2 + (k === 'bamboo_mosaic' ? 1 : 0)),
  C(re(/_wall$/)),
  C(re(/_fence$/), (k) => (k === 'nether_brick_fence' ? 100 : woodRank(k))),
  C(re(/_fence_gate$/), woodRank),
  C(re(/_stairs$/ ), (k) => (isColoredStairs(k) ? 1000 + colorRank(k) : /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_/.test(k) ? woodRank(k) : 100)),
  C(re(/_door$/), (k) => (/^(iron|copper|exposed|weathered|oxidized|waxed|keycard)/.test(k) ? 100 : woodRank(k))),
  C(re(/_trapdoor$/), (k) => (/^(iron|copper|exposed|weathered|oxidized|waxed)/.test(k) ? 100 : woodRank(k))),
  C(re(/_pressure_plate$/), (k) => (/^(stone|polished_blackstone|light_weighted|heavy_weighted)/.test(k) ? 100 : woodRank(k))),
  C(re(/_bars$|^iron_bars$/)),
  C(re(/^(glass|tinted_glass)$|_stained_glass$/), (k) => (k === 'glass' ? -2 : k === 'tinted_glass' ? -1 : colorRank(k))),
  C(re(/^glass_pane$|_stained_glass_pane$/), (k) => (k === 'glass_pane' ? -1 : colorRank(k))),
  C(re(/_slab$/)),
  // pierres et briques
  C(list('stone', 'smooth_stone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks', 'mossy_stone_brick_block', 'infested_stone', 'infested_cobblestone', 'infested_stone_bricks', 'infested_mossy_stone_bricks', 'infested_cracked_stone_bricks', 'infested_chiseled_stone_bricks', 'infested_deepslate')),
  C(re(/^(polished_)?(granite|diorite|andesite)$/)),
  C((k) => /deepslate/.test(k) && !/_ore$/.test(k)),
  C(re(/tuff/)),
  C(re(/^(bricks|brick|mud_bricks|mud_bricks_chiseled|packed_mud|resin_bricks|resin_block|chiseled_resin_bricks)$/)),
  C(re(/sandstone/)),
  C(re(/nether_brick|nether_wart_block|warped_wart_block/)),
  C(re(/blackstone|basalt|obsidian|reinforced/)),
  C((k) => /quartz/.test(k) && !/_ore$/.test(k)),
  C(re(/prismarine|sea_lantern/)),
  C(re(/purpur|end_stone/)),
  C((k) => /copper/.test(k) && !/(chest|lantern|chain|lightning_rod|torch|golem|_ore$|^raw_|^waxed_.*(lantern|chain|rod))/.test(k), (k) => (/^waxed_/.test(k) ? 1000 : /^(exposed)/.test(k) ? 1 : /^(weathered)/.test(k) ? 2 : /^(oxidized)/.test(k) ? 3 : 0)),
  C(re(/^(coal|iron|gold|diamond|emerald|lapis|redstone|netherite|raw_iron|raw_gold|raw_copper|amethyst|bone|honey|honeycomb|slime|hay|dried_kelp)_block$/), ofList(['coal_block', 'raw_iron_block', 'raw_copper_block', 'raw_gold_block', 'iron_block', 'copper_block', 'gold_block', 'diamond_block', 'emerald_block', 'lapis_block', 'redstone_block', 'netherite_block', 'amethyst_block', 'bone_block', 'honey_block', 'honeycomb_block', 'slime_block', 'hay_block', 'dried_kelp_block'])),
  C(re(/_wool$/), colorRank),
  C(re(/^terracotta$|_terracotta$/), (k) => (k === 'terracotta' ? -1 : /glazed/.test(k) ? 100 + colorRank(k) : colorRank(k))),
  C(re(/_concrete$/), colorRank),
  C(re(/_concrete_powder$/), colorRank),
  // ----- Nature -----
  N(list('grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium', 'dirt_path', 'farmland', 'mud', 'muddy_mangrove_roots', 'clay', 'moss_block', 'pale_moss_block'), ofList(['grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium', 'dirt_path', 'farmland', 'mud', 'muddy_mangrove_roots', 'clay', 'moss_block', 'pale_moss_block'])),
  N(list('sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel'), ofList(['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel'])),
  N(list('bedrock', 'netherrack', 'crimson_nylium', 'warped_nylium', 'soul_sand', 'soul_soil', 'magma', 'glowstone', 'shroomlight', 'calcite', 'dripstone_block', 'obsidian', 'crying_obsidian', 'end_stone', 'snow_block', 'ice', 'packed_ice', 'blue_ice', 'snow'), ofList(['bedrock', 'netherrack', 'crimson_nylium', 'warped_nylium', 'soul_sand', 'soul_soil', 'magma', 'glowstone', 'shroomlight', 'calcite', 'dripstone_block', 'obsidian', 'crying_obsidian', 'end_stone', 'snow_block', 'snow', 'ice', 'packed_ice', 'blue_ice'])),
  N(re(/_ore$|^ancient_debris$|^nether_gold_ore$/), (k) => (/^deepslate_/.test(k) ? 1 : /^nether_/.test(k) ? 2 : 0)),
  N(re(/^(stripped_)?(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|crimson|warped)_(log|stem|wood|hyphae)$|^(stripped_)?bamboo_block$|^mushroom_stem$/), (k) => woodRank(k) * 10 + woodForm(k)),
  N(re(/_leaves$/), woodRank),
  N(re(/_sapling$|_propagule$|^mangrove_propagule/), woodRank),
  N(re(/_coral_block$/), (k) => (/^dead_/.test(k) ? 100 : 0)),
  N(re(/coral/)),
  N(re(/mushroom|fungus|^crimson_roots|^warped_roots|nether_sprouts|weeping_vines|twisting_vines/)),
  N(re(/dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily_of_the_valley|rose|lilac|peony|sunflower|torchflower|pitcher|eyeblossom|spore_blossom|azalea$|wildflowers|pink_petals|paper_(rose|tulip|daisy)|cactus_flower/)),
  N(re(/kelp|seagrass|sea_pickle|lily_pad|frogspawn|turtle_egg|sponge|bubble|dripleaf|glow_lichen|^vine$|hanging_roots|cave_vines|glow_berries|amethyst_(cluster|bud)|cobweb|large_amethyst|medium_amethyst|small_amethyst|budding_amethyst|sculk|moss_carpet|leaf_litter|bush|fern|grass|dead_bush|^bamboo$|sugar_cane|cactus|pumpkin$|melon$|wheat_seeds|beetroot_seeds|pumpkin_seeds|melon_seeds|torchflower_seeds|sweet_berry|pointed_dripstone/)),
  { cat: 'nature', test: (k) => k.endsWith('_spawn_egg') },
  // ----- Équipement -----
  E(re(/_helmet$/), (k) => armorRank(k)),
  E(re(/_chestplate$/), (k) => armorRank(k)),
  E(re(/_leggings$/), (k) => armorRank(k)),
  E(re(/_boots$/), (k) => armorRank(k)),
  E(re(/_sword$/), tierRank),
  E(re(/_axe$/), tierRank),
  E(re(/_pickaxe$/), tierRank),
  E(re(/_shovel$/), tierRank),
  E(re(/_hoe$/), tierRank),
  E(re(/_(hammer|excavator)$/), tierRank),
  E(list('mace', 'trident', 'bow', 'crossbow', 'shield', 'elytra', 'wolf_armor'), ofList(['mace', 'trident', 'bow', 'crossbow', 'shield', 'elytra', 'wolf_armor'])),
  E(re(/_spear$/), tierRank),
  E(list('arrow', 'spectral_arrow', 'tipped_arrow', 'snowball', 'wind_charge', 'fire_charge'), ofList(['arrow', 'spectral_arrow', 'tipped_arrow', 'snowball', 'wind_charge', 'fire_charge'])),
  E((_k, d) => !!d.food && !potionish(d.key) && d.key !== 'potion' && d.key !== 'suspicious_stew' && d.key !== 'honey_bottle' && d.key !== 'milk_bucket'),
  E(list('shears', 'flint_and_steel', 'fishing_rod', 'carrot_on_a_stick', 'warped_fungus_on_a_stick', 'brush', 'spyglass', 'compass', 'recovery_compass', 'clock', 'lead', 'name_tag', 'saddle'), ofList(['shears', 'flint_and_steel', 'fishing_rod', 'carrot_on_a_stick', 'warped_fungus_on_a_stick', 'brush', 'spyglass', 'compass', 'recovery_compass', 'clock', 'lead', 'name_tag', 'saddle'])),
  E(re(/_horse_armor$|_nautilus_armor$|_harness$/), (k) => (/harness/.test(k) ? 1000 + colorRank(k) : /nautilus/.test(k) ? 500 + armorRank(k) : armorRank(k))),
  E(re(/_bundle$|^bundle$/), (k) => (k === 'bundle' ? -1 : colorRank(k))),
  E((k) => potionish(k) || k === 'ominous_bottle' || k === 'honey_bottle' || k === 'suspicious_stew' || k === 'experience_bottle', ofList(['potion', 'splash_potion', 'lingering_potion', 'ominous_bottle', 'honey_bottle', 'suspicious_stew', 'experience_bottle'])),
  // ----- Objets -----
  I(list('stick')),
  I(re(/_bed$/), colorRank),
  I(re(/_carpet$/), (k) => (/moss/.test(k) ? 100 : colorRank(k))),
  I(re(/^(torch|soul_torch|copper_torch|redstone_torch)$/), ofList(['torch', 'soul_torch', 'copper_torch', 'redstone_torch'])),
  I(re(/lantern$/), (k) => (k === 'lantern' ? -2 : k === 'soul_lantern' ? -1 : /^waxed/.test(k) ? 100 : 0)),
  I(re(/(^|_)candle$/), (k) => (k === 'candle' ? -1 : colorRank(k))),
  I(list('crafting_table', 'cartography_table', 'fletching_table', 'smithing_table', 'loom', 'stonecutter', 'grindstone', 'furnace', 'blast_furnace', 'smoker', 'campfire', 'soul_campfire', 'campfire_log', 'anvil', 'chipped_anvil', 'damaged_anvil', 'enchanting_table', 'brewing_stand', 'cauldron', 'water_cauldron', 'composter', 'lectern', 'bookshelf', 'chiseled_bookshelf', 'beacon', 'conduit', 'respawn_anchor', 'lodestone', 'crafter', 'bell'), ofList(['crafting_table', 'cartography_table', 'fletching_table', 'smithing_table', 'loom', 'stonecutter', 'grindstone', 'furnace', 'blast_furnace', 'smoker', 'campfire', 'soul_campfire', 'campfire_log', 'anvil', 'chipped_anvil', 'damaged_anvil', 'enchanting_table', 'brewing_stand', 'cauldron', 'water_cauldron', 'composter', 'lectern', 'bookshelf', 'chiseled_bookshelf', 'beacon', 'conduit', 'respawn_anchor', 'lodestone', 'crafter', 'bell'])),
  I(re(/(^|_)chest$|^barrel$|^ender_chest_block$|_shulker_box$|^shulker_box$|^decorated_pot$/), (k) => (k === 'chest' ? 0 : k === 'trapped_chest' ? 1 : k === 'ender_chest_block' ? 2 : k === 'barrel' ? 3 : /copper_chest/.test(k) ? 10 : /shulker/.test(k) ? 100 + Math.max(0, colorRank(k)) : 50)),
  I(re(/^jukebox$|^noteblock$|^music_disc_|^disc_fragment/), (k) => (k === 'jukebox' ? -2 : k === 'noteblock' ? -1 : 0)),
  I(re(/_hanging_sign$|_sign$/), (k) => woodRank(k) * 2 + (/hanging/.test(k) ? 1 : 0)),
  I(list('item_frame', 'glow_item_frame', 'painting', 'armor_stand', 'flower_pot', 'end_rod', 'lightning_rod', 'ladder', 'scaffolding', 'cobweb', 'light', 'barrier', 'structure_void'), ofList(['item_frame', 'glow_item_frame', 'painting', 'armor_stand', 'flower_pot', 'end_rod', 'ladder', 'scaffolding', 'lightning_rod'])),
  I(re(/^bucket$|_bucket$/), ofList(['bucket', 'water_bucket', 'lava_bucket', 'powder_snow_bucket', 'milk_bucket', 'cod_bucket', 'salmon_bucket', 'tropical_fish_bucket', 'pufferfish_bucket', 'axolotl_bucket', 'tadpole_bucket'])),
  { ...I(re(/_(skull|head)$|^player_head$|^creeper_head$/)), id: 'heads' },
  I(list('enchanted_book', 'book', 'writable_book', 'written_book', 'knowledge_book', 'paper', 'map', 'filled_map'), ofList(['paper', 'book', 'writable_book', 'written_book', 'knowledge_book', 'enchanted_book', 'map', 'filled_map'])),
  I(re(/_dye$/), colorRank),
  I(re(/(^|_)(boat|raft|chest_boat|chest_raft)$/), (k) => woodRank(k.replace(/_chest/, '')) * 2 + (/chest/.test(k) ? 1 : 0)),
  I(re(/minecart$|^rail$|_rail$/), ofList(['minecart', 'chest_minecart', 'furnace_minecart', 'hopper_minecart', 'tnt_minecart', 'command_block_minecart', 'rail', 'powered_rail', 'detector_rail', 'activator_rail'])),
  I(re(/redstone|repeater|comparator|piston|observer|hopper|dropper|dispenser|lever|_button$|daylight_detector|^target$|tripwire|^tnt$|sculk_sensor|slime_block|honey_block|lightning_rod|redstone_lamp|command_block|note_?block|bell/)),
  I(re(/_banner$/), colorRank),
  I(re(/banner_pattern$/)),
  I(re(/pottery_sherd$/)),
  I(re(/smithing_template$/)),
  I(re(/^firework_|^fireworks/)),
  // matières premières (lingots, gemmes, œufs, étoiles…) : tous les objets d'ingrédient restants, juste après les têtes
  { ...I((_k, d) => d.tab === 'ingredients' || d.tab === 'functional'), posAfter: 'heads' },
];

const BUCKET_POS = BUCKETS.map((b, i) => (b.posAfter ? BUCKETS.findIndex((x) => x.id === b.posAfter) + 0.5 : i));
const BUCKET_CACHE = new Map<string, { cat: CreativeCategory; bucket: number; sub: number }>();
/** Index de l'ordre des objets dans le registre (stable), pour départager. */
let REG_INDEX: Map<string, number> | null = null;
const regIndex = (k: string) => {
  if (!REG_INDEX || REG_INDEX.size !== ItemRegistry.all().length) {
    REG_INDEX = new Map(ItemRegistry.all().map((d, i) => [d.key, i]));
    BUCKET_CACHE.clear();
  }
  return REG_INDEX.get(k) ?? 0;
};

function classify(d: ItemDef): { cat: CreativeCategory; bucket: number; sub: number } {
  let r = BUCKET_CACHE.get(d.key);
  if (r) return r;
  const k = d.key;
  const b = BUCKETS.findIndex((x) => x.test(k, d));
  if (b >= 0) r = { cat: BUCKETS[b].cat, bucket: BUCKET_POS[b], sub: BUCKETS[b].sort?.(k) ?? 0 };
  else {
    const fallback: CreativeCategory = d.tab === 'building' ? 'construction' : d.tab === 'nature' ? 'nature' : d.tab === 'combat' || d.tab === 'tools' || d.tab === 'food' ? 'equipment' : 'items';
    r = { cat: fallback, bucket: BUCKETS.length + CAT_ORDER.indexOf(fallback), sub: 0 };
  }
  BUCKET_CACHE.set(k, r);
  return r;
}

/** Catégorie (onglet) d'un objet. */
export function creativeTabOf(d: ItemDef): CreativeCategory {
  return classify(d).cat;
}

/** États, morceaux de blocs et objets techniques absents de l'inventaire créatif. */
const JUNK = new RegExp(
  [
    '_stage\\d+$', '_conditional$', '_vertical$', '_awake$', '_dormant$', '_bloom$', '_inside$', '_side_(small|tall)$', '_middle$', '_frustum$', '_tip_merge$',
    '_propagule_hanging$', '_west$', '^structure_block_(data|load|save)$', '^frosted_ice_\\d$', '^test_', '^jigsaw_lock$', '^sunflower_back$', '_crop_(bottom|top)_stage_\\d$',
    '^(barrel_open|beehive_honey|bee_nest_honey|chiseled_bookshelf_empty|chorus_flower_dead|end_portal_frame_filled|nether_portal|end_portal|fire|soul_fire|water_cauldron)$',
    '^(kelp|twisting_vines|weeping_vines|cave_vines|bamboo)_plant$', '^bamboo_(small|large)_leaves$', '^potted_', '_roots_pot$', '^pitcher_crop$',
    '^(redstone_dust_line\\d|repeater_on|comparator_on|cake_inner|piston_head|lightning_rod_on|white_candle_lit|vault_ominous)$',
  ].join('|'),
);

/** Objets d'un onglet (ou résultats d'une recherche), dans l'ordre du jeu. */
export function creativeItems(tab: CreativeTabKey, query = ''): ItemDef[] {
  regIndex('');
  const all = ItemRegistry.all().filter((d) => !d.hidden && !JUNK.test(d.key));
  let pool = all;
  if (tab === 'search') {
    const q = query.trim().toLowerCase();
    if (q) pool = all.filter((d) => d.key.includes(q.replace(/\s+/g, '_')) || d.name.toLowerCase().includes(q) || itemName(d.key).toLowerCase().includes(q));
  } else pool = all.filter((d) => classify(d).cat === tab);
  const catIdx = (d: ItemDef) => CAT_ORDER.indexOf(classify(d).cat);
  return pool
    .map((d) => ({ d, c: classify(d), i: regIndex(d.key) }))
    .sort((a, b) => (tab === 'search' ? CAT_ORDER.indexOf(a.c.cat) - CAT_ORDER.indexOf(b.c.cat) : 0) || a.c.bucket - b.c.bucket || a.c.sub - b.c.sub || a.i - b.i)
    .map((x) => x.d)
    .filter((d) => catIdx(d) >= 0);
}

/** Objet de l'inventaire créatif : la définition et la pile exacte (potion, livre enchanté…). */
export interface CreativeEntry {
  def: ItemDef;
  stack: ItemStack;
}

/** Potions dans l'ordre du jeu original : eau, banale, épaisse, étrange, puis chaque effet (normal, long, renforcé). */
function potionKeys(withBase: boolean): string[] {
  const out: string[] = [];
  for (const [k, p] of Object.entries(POTIONS)) {
    const base = !p.effect && !p.more;
    if (base && !withBase) continue;
    out.push(k);
    if (p.long !== undefined) out.push(`long_${k}`);
    if (p.strong !== undefined) out.push(`strong_${k}`);
  }
  return out;
}

/** Variantes d'un objet comme dans le jeu original (toutes les potions, livres de chaque niveau…). */
function variants(d: ItemDef): ItemStack[] {
  if (d.key === 'potion' || d.key === 'splash_potion' || d.key === 'lingering_potion') {
    const form = d.key === 'potion' ? false : d.key === 'splash_potion' ? true : ('lingering' as const);
    return potionKeys(true).map((k) => makePotion(k, form));
  }
  if (d.key === 'tipped_arrow') return potionKeys(false).map((k) => ({ id: 'tipped_arrow', count: 1, meta: { potion: k } }));
  if (d.key === 'enchanted_book') {
    const out: ItemStack[] = [];
    for (const e of ENCHANTS) for (let l = 1; l <= e.max; l++) out.push({ id: 'enchanted_book', count: 1, meta: { ench: { [e.id]: l } } });
    return out;
  }
  return [{ id: d.key, count: 1 }];
}

/** Piles de l'onglet (ou de la recherche), variantes comprises. */
export function creativeEntries(tab: CreativeTabKey, query = ''): CreativeEntry[] {
  return creativeItems(tab, query).flatMap((def) => variants(def).map((stack) => ({ def, stack })));
}

/** Catégorie « livre de recettes » d'un résultat de fabrication (mêmes catégories que le créatif). */
export function recipeCategory(itemId: string): CreativeCategory {
  const d = ItemRegistry.get(itemId);
  return d ? classify(d).cat : 'items';
}
