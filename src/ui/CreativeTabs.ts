/**
 * Onglets de l'inventaire créatif, comme le jeu original (1.21) : 6 onglets en haut
 * (construction, couleurs, nature, fonctionnels, redstone, recherche) et 6 en bas (outils,
 * combat, nourriture, ingrédients, œufs d'apparition, inventaire de survie).
 */
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemDef, ItemStack } from '../inventory/Item';
import { POTIONS, makePotion } from '../inventory/Potions';
import { ENCHANTS } from '../inventory/Enchantments';
import { itemName } from './i18n';

export type CreativeTabKey = 'building' | 'colored' | 'nature' | 'functional' | 'redstone' | 'search' | 'tools' | 'combat' | 'food' | 'ingredients' | 'spawn_eggs' | 'inventory';

export interface CreativeTab {
  key: CreativeTabKey;
  name: string;
  /** Objets candidats pour l'icône (le premier qui existe). */
  icon: string[];
  row: 'top' | 'bottom';
  /** Colonne (0..6) ; les onglets « à droite » sont alignés sur le bord droit de la fenêtre. */
  col: number;
  right?: boolean;
}

export const CREATIVE_TABS: CreativeTab[] = [
  { key: 'building', name: 'Blocs de construction', icon: ['bricks'], row: 'top', col: 0 },
  { key: 'colored', name: 'Blocs colorés', icon: ['cyan_wool', 'white_wool'], row: 'top', col: 1 },
  { key: 'nature', name: 'Blocs naturels', icon: ['grass_block'], row: 'top', col: 2 },
  { key: 'functional', name: 'Blocs fonctionnels', icon: ['oak_sign', 'crafting_table'], row: 'top', col: 3 },
  { key: 'redstone', name: 'Blocs de redstone', icon: ['redstone', 'lever'], row: 'top', col: 4 },
  { key: 'search', name: 'Rechercher', icon: ['compass'], row: 'top', col: 6, right: true },
  { key: 'tools', name: 'Outils et utilitaires', icon: ['diamond_pickaxe', 'iron_pickaxe'], row: 'bottom', col: 0 },
  { key: 'combat', name: 'Combat', icon: ['netherite_sword', 'diamond_sword', 'iron_sword'], row: 'bottom', col: 1 },
  { key: 'food', name: 'Nourriture et boissons', icon: ['golden_apple', 'apple'], row: 'bottom', col: 2 },
  { key: 'ingredients', name: 'Ingrédients', icon: ['iron_ingot'], row: 'bottom', col: 3 },
  { key: 'spawn_eggs', name: "Œufs d'apparition", icon: ['pig_spawn_egg', 'cow_spawn_egg', 'egg'], row: 'bottom', col: 4 },
  { key: 'inventory', name: 'Inventaire de survie', icon: ['chest'], row: 'bottom', col: 6, right: true },
];

const COLORS = 'white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black';
/** Blocs colorés (laine, tapis, terre cuite, béton, verre, lits, bougies, bannières, boîtes de shulker). */
const COLORED = new RegExp(`^(${COLORS})_(wool|carpet|terracotta|glazed_terracotta|concrete|concrete_powder|stained_glass|stained_glass_pane|bed|candle|banner|shulker_box)$|^(terracotta|glass|glass_pane|candle|shulker_box|tinted_glass)$`);
/** Blocs et objets de redstone. */
const REDSTONE = /redstone|repeater|comparator|piston|observer|hopper|dropper|dispenser|lever|_button$|pressure_plate|daylight_detector|target|note_?block|tripwire|^tnt$|rail$|^lectern$|trapped_chest|sculk_sensor|lightning_rod|^crafter$|^slime_block$|^honey_block$|^iron_door$|^iron_trapdoor$|^keycard|^minecart|^chest_minecart|^hopper_minecart|^tnt_minecart/;

/** Onglet d'un objet. */
export function creativeTabOf(d: ItemDef): CreativeTabKey {
  if (d.key.endsWith('_spawn_egg')) return 'spawn_eggs';
  // Comme le jeu original : toutes les potions (jetables et persistantes comprises) dans « Nourriture et boissons ».
  if (d.key === 'splash_potion' || d.key === 'lingering_potion') return 'food';
  const tab = d.tab ?? 'ingredients';
  if (tab !== 'combat' && tab !== 'food' && REDSTONE.test(d.key)) return 'redstone';
  if ((tab === 'building' || tab === 'nature' || tab === 'functional') && COLORED.test(d.key)) return 'colored';
  return tab;
}

/** Objets d'un onglet (ou résultats d'une recherche). */
export function creativeItems(tab: CreativeTabKey, query = ''): ItemDef[] {
  const all = ItemRegistry.all().filter((d) => !d.hidden);
  if (tab === 'search') {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((d) => d.key.includes(q.replace(/\s+/g, '_')) || d.name.toLowerCase().includes(q) || itemName(d.key).toLowerCase().includes(q));
  }
  const list = all.filter((d) => creativeTabOf(d) === tab);
  // Fin des onglets comme le jeu original : potions, puis jetables, puis persistantes ; livres enchantés en dernier.
  const last = (k: string) => ['potion', 'splash_potion', 'lingering_potion', 'enchanted_book'].indexOf(k) + 1;
  return list.map((d, i) => ({ d, i })).sort((a, b) => last(a.d.key) - last(b.d.key) || a.i - b.i).map((x) => x.d);
}

export function tabIcon(t: CreativeTab): string {
  return t.icon.find((k) => ItemRegistry.has(k)) ?? t.icon[t.icon.length - 1];
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
