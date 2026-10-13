/**
 * Butins tirés au hasard, comme le jeu original : pêche (poissons, déchets, trésors ;
 * Chance de la mer : +2,1 % de trésor et −2,5 % de déchet par niveau).
 */
import type { ItemStack } from './Item';
import { ItemRegistry } from './ItemRegistry';
import { enchantRandomly, randomEnchantedBook } from './Enchantments';

type Entry = [id: string, weight: number];

function pick(list: Entry[], rand: () => number): string {
  const ok = list.filter(([id]) => ItemRegistry.has(id));
  const total = ok.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [id, w] of ok) if ((r -= w) < 0) return id;
  return ok[0]?.[0] ?? 'cod';
}

const FISH: Entry[] = [['cod', 60], ['salmon', 25], ['tropical_fish', 2], ['pufferfish', 13]];
const JUNK: Entry[] = [['lily_pad', 17], ['leather_boots', 10], ['leather', 10], ['bone', 10], ['potion', 10], ['string', 5], ['fishing_rod', 2], ['bowl', 10], ['stick', 5], ['ink_sac', 1], ['tripwire_hook', 10], ['rotten_flesh', 10]];
const TREASURE: Entry[] = [['bow', 1], ['enchanted_book', 1], ['fishing_rod', 1], ['name_tag', 1], ['nautilus_shell', 1], ['saddle', 1]];

export function fishingLoot(luck: number, rand: () => number = Math.random): ItemStack | null {
  const treasure = Math.max(0, 0.05 + 0.021 * luck);
  const junk = Math.max(0, 0.1 - 0.025 * luck);
  const r = rand();
  if (r < treasure) {
    const id = pick(TREASURE, rand);
    if (id === 'enchanted_book') return randomEnchantedBook(true, rand);
    const max = ItemRegistry.maxDurability(id);
    const st: ItemStack = { id, count: 1, ...(max > 0 ? { durability: Math.max(1, Math.round(max * (0.75 + rand() * 0.25))) } : {}) };
    // arc et canne trouvés en trésor : enchantés (niveau 30 du jeu original)
    return id === 'bow' || id === 'fishing_rod' ? enchantRandomly(st, 30, rand) : st;
  }
  if (r < treasure + junk) {
    const id = pick(JUNK, rand);
    const max = ItemRegistry.maxDurability(id);
    return { id, count: 1, ...(max > 0 ? { durability: Math.max(1, Math.round(max * (0.1 + rand() * 0.8))) } : {}) };
  }
  return { id: pick(FISH, rand), count: 1 };
}
