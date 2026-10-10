/**
 * Présentation d'une pile d'objets : nom affiché (nom personnalisé de l'enclume, nom de la
 * potion), clé d'icône (couleur de la potion) et reflet d'enchantement.
 */
import { itemName, language } from '../ui/i18n';
import type { ItemStack } from './Item';
import { ItemRegistry } from './ItemRegistry';
import { customName, isEnchanted } from './Enchantments';
import { potionColor, potionName, potionOf } from './Potions';

export function stackName(st: ItemStack): string {
  return customName(st) ?? (potionOf(st) && language() === 'fr' ? potionName(st) : itemName(st.id, ItemRegistry.get(st.id)?.name));
}

/** Clé d'icône : « potion#rrggbb » pour les potions (liquide teinté), sinon l'identifiant. */
export function iconKey(st: ItemStack): string {
  return potionOf(st) ? `${st.id}${potionColor(st)}` : st.id;
}

/** Reflet violet des objets enchantés (et livres enchantés). */
export function hasGlint(st: ItemStack): boolean {
  return isEnchanted(st) || st.id === 'enchanted_book' || st.id === 'experience_bottle' || st.id === 'nether_star' || st.id === 'enchanted_golden_apple';
}
