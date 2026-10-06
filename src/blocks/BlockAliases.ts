/**
 * Bloc le plus proche pour un identifiant du jeu de référence absent de LeCraft
 * (ex. « azalea_leaves » → feuilles de chêne, « red_concrete » → laine rouge).
 * Utilisé par les scripts et commandes des add-ons pour éviter qu'un bloc inconnu
 * n'interrompe leur exécution. Retourne -1 si aucune équivalence raisonnable n'existe.
 */
import { BlockRegistry } from './BlockRegistry';

const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];

const RULES: [RegExp, (m: RegExpExecArray, k: string) => string | null][] = [
  [/^deepslate_(\w+_ore)$/, (m) => m[1]],
  [/^(\w+)_ore$/, () => 'iron_ore'],
  [/^(cobbled_deepslate|deepslate|tuff|calcite|blackstone|basalt|smooth_basalt|dripstone_block|polished_\w+|smooth_stone|chiseled_\w+|cut_\w+)$/, (m) => (/cobbled/.test(m[1]) ? 'cobblestone' : 'stone')],
  [/stained_glass_pane$|^\w+_pane$/, () => 'glass_pane'],
  [/stained_glass$|^tinted_glass$|^hard_glass$/, () => 'glass'],
  [/^(\w+?)_(wool|carpet|concrete|concrete_powder|terracotta|glazed_terracotta|shulker_box|bed|candle|banner)$/, (m) => (COLORS.includes(m[1]) ? `${m[1]}_wool` : 'white_wool')],
  [/^(terracotta|hardened_clay|stained_hardened_clay)$/, () => 'clay'],
  [/^(\w+)_leaves(_flowered)?$|^leaves2?$/, (m) => (m[1] && WOODS.includes(m[1]) ? `${m[1]}_leaves` : 'oak_leaves')],
  [/^(stripped_)?(\w+?)_(log|wood|stem|hyphae)$/, (m) => (WOODS.includes(m[2]) ? `${m[2]}_log` : 'oak_log')],
  [/^(\w+?)_planks$/, (m) => (WOODS.includes(m[1]) ? `${m[1]}_planks` : 'oak_planks')],
  [/^(\w+?)_sapling$|^(azalea|flowering_azalea|mangrove_propagule)$/, (m) => (m[1] && WOODS.includes(m[1]) ? `${m[1]}_sapling` : 'oak_sapling')],
  [/(oak|spruce|birch|jungle|acacia|cherry|mangrove|bamboo|crimson|warped|pale_oak|wooden)_stairs$/, () => 'oak_stairs'],
  [/stone_brick_stairs$|brick_stairs$/, () => 'stone_brick_stairs'],
  [/_stairs$/, () => 'cobblestone_stairs'],
  [/(oak|spruce|birch|jungle|acacia|cherry|mangrove|bamboo|crimson|warped|pale_oak|wooden)_slab$/, () => 'oak_slab'],
  [/stone_brick_slab$/, () => 'stone_brick_slab'],
  [/cobblestone_slab$/, () => 'cobblestone_slab'],
  [/_slab$|^double_\w*slab\d*$/, () => 'stone_slab'],
  [/_fence(_gate)?$|^fence_gate$/, () => 'oak_fence'],
  [/_door$|^wooden_door$/, () => 'oak_door'],
  [/_wall$/, () => 'cobblestone'],
  [/^(\w+_)?bricks?$|_bricks$/, () => 'bricks'],
  [/copper|^cut_copper/, () => 'copper_block'],
  [/^(\w+_)?(tulip|allium|azure_bluet|lily_of_the_valley|wither_rose|torchflower|pink_petals|wildflowers|blue_orchid|lilac|rose_bush|peony|sunflower|red_flower|yellow_flower|golden_dandelion|eyeblossom|open_eyeblossom|closed_eyeblossom)$/, (_m, k) => (/yellow|sunflower|dandelion/.test(k) ? 'dandelion' : 'poppy')],
  [/^(tall_grass|tallgrass|grass|seagrass|tall_seagrass|short_dry_grass|tall_dry_grass|bush|firefly_bush|large_fern|leaf_litter|vine|vines|cave_vines\w*|weeping_vines|twisting_vines|hanging_roots|sweet_berry_bush)$/, () => 'short_grass'],
  [/^(frosted_ice|blue_ice)$/, () => 'packed_ice'],
  [/^(snow_layer|powder_snow)$/, () => 'snow'],
  [/torch$|^torch\w+$/, () => 'torch'],
  [/lantern$/, () => 'lantern'],
  [/^(netherrack|nether_wart_block|warped_wart_block|crimson_nylium|warped_nylium|magma|shroomlight)$/, () => 'bricks'],
  [/^(end_stone|end_stone_bricks|purpur_block|purpur_pillar)$/, () => 'sandstone'],
  [/^(quartz_block|quartz_pillar|quartz_bricks|smooth_quartz|bone_block)$/, () => 'diorite'],
  [/^(soul_sand|soul_soil|red_sand)$/, () => 'sand'],
  [/^(coarse_dirt|rooted_dirt|grass_path|mycelium)$/, () => 'dirt'],
  [/^(noteblock|note_block|jukebox|barrel|smoker|blast_furnace|cartography_table|fletching_table|smithing_table|loom|lectern|composter|beehive|bee_nest|chiseled_bookshelf)$/, (m) => (m[1] === 'smoker' || m[1] === 'blast_furnace' ? 'furnace' : m[1] === 'chiseled_bookshelf' ? 'bookshelf' : 'oak_planks')],
  [/^(ender_chest|trapped_chest|copper_chest)$/, () => 'chest'],
  [/^(melon_block)$/, () => 'melon'],
  [/^(carved_pumpkin|lit_pumpkin|jack_o_lantern)$/, () => 'pumpkin'],
  [/^(moss_carpet|pale_moss_block|pale_moss_carpet)$/, () => 'moss_block'],
  [/^(mud_bricks|packed_mud)$/, () => 'mud'],
  [/^(budding_amethyst)$/, () => 'amethyst_block'],
  [/^(\w+_amethyst_bud)$/, () => 'amethyst_cluster'],
  [/^(light_weighted_pressure_plate|heavy_weighted_pressure_plate|\w+_pressure_plate)$/, () => 'stone_pressure_plate'],
  [/^(hay_bale)$/, () => 'hay_block'],
  [/^(reeds)$/, () => 'sugar_cane'],
  [/^(web|cobweb)$/, () => 'short_grass'],
];

const cache = new Map<string, number>();

export function closestBlock(id: string): number {
  const k = String(id).toLowerCase().replace(/^minecraft:/, '');
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  let out = -1;
  if (BlockRegistry.has(k)) out = BlockRegistry.byName(k).id;
  else
    for (const [re, fn] of RULES) {
      const m = re.exec(k);
      if (!m) continue;
      const t = fn(m, k);
      if (t && BlockRegistry.has(t)) {
        out = BlockRegistry.byName(t).id;
        break;
      }
    }
  cache.set(k, out);
  return out;
}
