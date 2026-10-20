/**
 * Rareté des objets (couleur du nom dans les info-bulles et au-dessus de la barre d'objets),
 * selon les règles du jeu original : commun (blanc), peu commun (jaune), rare (cyan),
 * épique (magenta). Un objet enchanté monte d'un cran (commun / peu commun → rare, rare → épique).
 */
import type { ItemStack } from '../inventory/Item';
import { isEnchanted } from '../inventory/Enchantments';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';

export const RARITY_COLOR: Record<Rarity, string> = { common: '#ffffff', uncommon: '#ffff55', rare: '#55ffff', epic: '#ff55ff' };

const EPIC = new Set([
  'enchanted_golden_apple', 'dragon_egg', 'elytra', 'mace', 'heavy_core', 'command_block', 'chain_command_block', 'repeating_command_block',
  'command_block_minecart', 'structure_block', 'structure_void', 'jigsaw', 'barrier', 'light', 'debug_stick', 'knowledge_book', 'trident',
]);
const RARE = new Set([
  'golden_apple', 'beacon', 'conduit', 'end_crystal', 'music_disc_pigstep', 'music_disc_otherside', 'music_disc_5', 'music_disc_relic', 'music_disc_creator',
  'netherite_upgrade_smithing_template', 'silence_armor_trim_smithing_template', 'eye_armor_trim_smithing_template', 'ward_armor_trim_smithing_template',
  'vex_armor_trim_smithing_template', 'spire_armor_trim_smithing_template', 'flow_armor_trim_smithing_template', 'bolt_armor_trim_smithing_template',
  'mojang_banner_pattern', 'piglin_banner_pattern',
]);
const UNCOMMON = new Set([
  'experience_bottle', 'dragon_breath', 'nether_star', 'heart_of_the_sea', 'totem_of_undying', 'enchanted_book', 'echo_shard', 'recovery_compass',
  'disc_fragment_5', 'ominous_trial_key', 'ominous_bottle', 'creeper_banner_pattern', 'skull_banner_pattern', 'flow_banner_pattern', 'guster_banner_pattern',
  'skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'player_head', 'creeper_head', 'dragon_head', 'piglin_head', 'sniffer_egg', 'turtle_helmet',
]);

export function baseRarity(id: string): Rarity {
  if (EPIC.has(id)) return 'epic';
  if (RARE.has(id)) return 'rare';
  if (UNCOMMON.has(id) || id.startsWith('music_disc_') || id.endsWith('_smithing_template') || id.endsWith('_pottery_sherd')) return 'uncommon';
  return 'common';
}

export function stackRarity(st: ItemStack): Rarity {
  const r = baseRarity(st.id);
  if (!isEnchanted(st) || st.id === 'enchanted_book') return r;
  return r === 'common' || r === 'uncommon' ? 'rare' : 'epic';
}

export function rarityColor(st: ItemStack): string {
  return RARITY_COLOR[stackRarity(st)];
}
