/**
 * Présentation d'une pile d'objets : nom affiché (nom personnalisé de l'enclume, nom de la
 * potion), clé d'icône (couleur de la potion) et reflet d'enchantement.
 */
import { itemName, language } from '../ui/i18n';
import type { ItemStack } from './Item';
import { ItemRegistry } from './ItemRegistry';
import { customName, isEnchanted } from './Enchantments';
import { POTIONS, potionColor, potionName, potionOf } from './Potions';

/** Potion d'une flèche à effet (null pour une autre pile). */
function arrowPotion(st: ItemStack): string | null {
  return st.id === 'tipped_arrow' ? ((st.meta?.potion as string | undefined) ?? null) : null;
}

export function stackName(st: ItemStack): string {
  const ap = arrowPotion(st);
  if (ap && !customName(st) && language() === 'fr') {
    // « Flèche de rapidité » comme le jeu original (nom de la potion sans « Potion »)
    const n = POTIONS[ap.replace(/^(long|strong)_/, '')]?.name;
    if (n?.startsWith('Potion ')) return n.replace(/^Potion/, 'Flèche');
  }
  return customName(st) ?? (potionOf(st) && language() === 'fr' ? potionName(st) : itemName(st.id, ItemRegistry.get(st.id)?.name));
}

/** Clé d'icône : « potion#rrggbb » pour les potions et flèches à effet (liquide teinté), sinon l'identifiant. */
export function iconKey(st: ItemStack): string {
  const ap = arrowPotion(st);
  if (ap) return `tipped_arrow${potionColor({ id: 'potion', count: 1, meta: { potion: ap } })}`;
  return potionOf(st) ? `${st.id}${potionColor(st)}` : st.id;
}

/** Reflet violet des objets enchantés (et livres enchantés). */
export function hasGlint(st: ItemStack): boolean {
  return isEnchanted(st) || st.id === 'enchanted_book' || st.id === 'experience_bottle' || st.id === 'nether_star' || st.id === 'enchanted_golden_apple';
}
