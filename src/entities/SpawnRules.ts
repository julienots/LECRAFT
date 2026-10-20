/**
 * Règles d'apparition du jeu Java 1.21 (fonctions pures, testées dans tests/mobs.test.ts).
 */

/** Assombrissement du ciel (0 le jour → 11 à minuit) déduit de la lumière du jour du cycle (0,34..1). */
export function skyDarken(daylight: number): number {
  return Math.max(0, Math.min(11, Math.round(((1 - daylight) / 0.66) * 11)));
}

/**
 * Monstres de la Surface (Monster.isDarkEnoughToSpawn, 1.18+) :
 *  - lumière des blocs strictement nulle (une torche empêche toute apparition alentour) ;
 *  - lumière du ciel brute > aléa(0..31) : échec (à découvert, une chance sur deux seulement) ;
 *  - lumière effective (ciel assombri selon l'heure) ≤ aléa uniforme 0..7.
 */
export function darkEnoughToSpawn(light: { sky: number; block: number }, daylight: number, rand: () => number = Math.random): boolean {
  if (light.block > 0) return false;
  if (light.sky > Math.floor(rand() * 32)) return false;
  const effective = Math.max(0, light.sky - skyDarken(daylight));
  return effective <= Math.floor(rand() * 8);
}

/** Phantoms : 3 jours sans dormir (72 000 ticks), puis probabilité (t − limite) / t à chaque essai. */
export function phantomSpawnChance(secondsSinceRest: number, dayLength: number): number {
  const limit = 3 * dayLength;
  if (secondsSinceRest < limit) return 0;
  return (secondsSinceRest - limit) / secondsSinceRest;
}

/** Nombre de phantoms d'un groupe : 1 à (1 + difficulté) (facile 1, normal 2, difficile 3). */
export function phantomGroupMax(difficulty: string): number {
  return difficulty === 'hard' ? 4 : difficulty === 'normal' ? 3 : 2;
}

/** Dégâts d'un golem de fer (Java : 7,5 + aléa entier 0..14, soit 7,5 à 21,5 en normal). */
export function ironGolemDamage(rand: () => number = Math.random): number {
  return 7.5 + Math.floor(rand() * 15);
}

/** Créatures de la famille des zombies : 5 % de bébés à l'apparition naturelle. */
export const BABY_ZOMBIE_KEYS = new Set(['zombie', 'husk', 'drowned', 'zombie_villager']);
export const BABY_ZOMBIE_CHANCE = 0.05;

/** Croissance d'un petit : 20 minutes (24 000 ticks) ; nourrir retire 10 % du temps restant. */
export const BABY_GROW_SECONDS = 1200;
/** Délai entre deux reproductions (6 000 ticks). */
export const BREED_COOLDOWN_SECONDS = 300;

/** Troc des piglins (Java 1.21, poids sur 459). Les objets absents du jeu sont ignorés. */
export const PIGLIN_BARTER: { item: string; min: number; max: number; weight: number }[] = [
  { item: 'enchanted_book', min: 1, max: 1, weight: 5 },
  { item: 'iron_boots', min: 1, max: 1, weight: 8 },
  { item: 'potion', min: 1, max: 1, weight: 10 },
  { item: 'iron_nugget', min: 10, max: 36, weight: 10 },
  { item: 'ender_pearl', min: 2, max: 4, weight: 10 },
  { item: 'string', min: 3, max: 9, weight: 20 },
  { item: 'quartz', min: 5, max: 12, weight: 20 },
  { item: 'obsidian', min: 1, max: 1, weight: 40 },
  { item: 'crying_obsidian', min: 1, max: 3, weight: 40 },
  { item: 'fire_charge', min: 1, max: 1, weight: 40 },
  { item: 'leather', min: 2, max: 4, weight: 40 },
  { item: 'soul_sand', min: 2, max: 8, weight: 40 },
  { item: 'nether_brick', min: 2, max: 8, weight: 40 },
  { item: 'spectral_arrow', min: 6, max: 12, weight: 40 },
  { item: 'gravel', min: 8, max: 16, weight: 40 },
  { item: 'blackstone', min: 8, max: 16, weight: 40 },
];

/** Tire un résultat de troc parmi les objets disponibles. */
export function rollBarter(has: (id: string) => boolean, rand: () => number = Math.random): { item: string; count: number } | null {
  const list = PIGLIN_BARTER.filter((e) => has(e.item));
  const total = list.reduce((a, e) => a + e.weight, 0);
  let r = rand() * total;
  for (const e of list) {
    r -= e.weight;
    if (r < 0) return { item: e.item, count: e.min + Math.floor(rand() * (e.max - e.min + 1)) };
  }
  return null;
}

/** Le joueur porte-t-il au moins une pièce d'armure en or (les piglins le laissent tranquille) ? */
export function wearsGold(armor: Record<string, { id: string } | null | undefined>): boolean {
  return Object.values(armor).some((s) => !!s && /^gold(en)?_(helmet|chestplate|leggings|boots)$/.test(s.id));
}
