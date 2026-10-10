/**
 * Enchantements des objets (comme le jeu original) : stockés dans `stack.meta.ench`
 * ({ id: niveau }). Les effets sont appliqués là où ils agissent : combat (CombatSystem),
 * minage (breakTime), usure (Inventory.damageSelected / damageArmor), objets obtenus
 * (getDrops), protection (Player.damage), arc (PlayerInteraction.shootBow), butin des
 * créatures (DamageSystem), réparation par l'expérience (Player.addXp).
 */
import type { ItemStack } from './Item';
import { ItemRegistry } from './ItemRegistry';

export type EnchantTarget = 'sword' | 'tool' | 'armor' | 'helmet' | 'boots' | 'bow' | 'durable';

export interface EnchantDef {
  id: string;
  name: string;
  max: number;
  target: EnchantTarget;
  /** Poids du tirage (table d'enchantement). */
  weight: number;
  /** Enchantements incompatibles entre eux (même groupe). */
  group?: string;
  /** Introuvable à la table d'enchantement (livres seulement). */
  treasure?: boolean;
}

export const ENCHANTS: EnchantDef[] = [
  { id: 'sharpness', name: 'Tranchant', max: 5, target: 'sword', weight: 10, group: 'damage' },
  { id: 'smite', name: 'Châtiment', max: 5, target: 'sword', weight: 5, group: 'damage' },
  { id: 'bane_of_arthropods', name: 'Fléau des arthropodes', max: 5, target: 'sword', weight: 5, group: 'damage' },
  { id: 'knockback', name: 'Recul', max: 2, target: 'sword', weight: 5 },
  { id: 'fire_aspect', name: 'Aura de feu', max: 2, target: 'sword', weight: 2 },
  { id: 'looting', name: 'Butin', max: 3, target: 'sword', weight: 2 },
  { id: 'efficiency', name: 'Efficacité', max: 5, target: 'tool', weight: 10 },
  { id: 'silk_touch', name: 'Toucher de soie', max: 1, target: 'tool', weight: 1, group: 'drops' },
  { id: 'fortune', name: 'Fortune', max: 3, target: 'tool', weight: 2, group: 'drops' },
  { id: 'unbreaking', name: 'Solidité', max: 3, target: 'durable', weight: 5 },
  { id: 'mending', name: 'Raccommodage', max: 1, target: 'durable', weight: 2, treasure: true },
  { id: 'protection', name: 'Protection', max: 4, target: 'armor', weight: 10, group: 'protection' },
  { id: 'fire_protection', name: 'Protection contre le feu', max: 4, target: 'armor', weight: 5, group: 'protection' },
  { id: 'blast_protection', name: 'Protection contre les explosions', max: 4, target: 'armor', weight: 2, group: 'protection' },
  { id: 'projectile_protection', name: 'Protection contre les projectiles', max: 4, target: 'armor', weight: 5, group: 'protection' },
  { id: 'feather_falling', name: 'Chute amortie', max: 4, target: 'boots', weight: 5 },
  { id: 'respiration', name: 'Apnée', max: 3, target: 'helmet', weight: 2 },
  { id: 'aqua_affinity', name: 'Affinité aquatique', max: 1, target: 'helmet', weight: 2 },
  { id: 'power', name: 'Puissance', max: 5, target: 'bow', weight: 10 },
  { id: 'punch', name: 'Frappe', max: 2, target: 'bow', weight: 2 },
  { id: 'flame', name: 'Flamme', max: 1, target: 'bow', weight: 2 },
  { id: 'infinity', name: 'Infinité', max: 1, target: 'bow', weight: 1 },
];
export const ENCHANT_BY_ID = new Map(ENCHANTS.map((e) => [e.id, e]));

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n: number) => ROMAN[n] ?? String(n);

/** Enchantements d'une pile (copie). */
export function enchantsOf(st: ItemStack | null | undefined): Record<string, number> {
  const e = st?.meta?.ench as Record<string, number> | undefined;
  return e ? { ...e } : {};
}
export function enchLevel(st: ItemStack | null | undefined, id: string): number {
  return ((st?.meta?.ench as Record<string, number> | undefined)?.[id] ?? 0) | 0;
}
export function setEnchants(st: ItemStack, ench: Record<string, number>) {
  const meta = { ...(st.meta ?? {}) };
  if (Object.keys(ench).length) meta.ench = ench;
  else delete meta.ench;
  st.meta = Object.keys(meta).length ? meta : undefined;
}
export function isEnchanted(st: ItemStack | null | undefined) {
  return !!st?.meta?.ench && Object.keys(st.meta.ench as object).length > 0;
}

/** Nom personnalisé (enclume). */
export function customName(st: ItemStack | null | undefined): string | null {
  return (st?.meta?.name as string | undefined) ?? null;
}

/** Lignes d'infobulle (« Tranchant III »…). */
export function enchantLines(st: ItemStack | null | undefined): string[] {
  return Object.entries(enchantsOf(st)).map(([id, l]) => {
    const d = ENCHANT_BY_ID.get(id);
    return `${d?.name ?? id}${d && d.max === 1 ? '' : ` ${roman(l)}`}`;
  });
}

/** L'enchantement s'applique-t-il à cet objet (livre : à tout) ? */
export function canEnchant(itemId: string, e: EnchantDef): boolean {
  if (itemId === 'book' || itemId === 'enchanted_book') return true;
  const def = ItemRegistry.get(itemId);
  if (!def) return false;
  const tool = def.tool?.type;
  switch (e.target) {
    case 'sword':
      return tool === 'sword' || tool === 'axe';
    case 'tool':
      return tool === 'pickaxe' || tool === 'axe' || tool === 'shovel' || tool === 'hoe';
    case 'armor':
      return !!def.armor;
    case 'helmet':
      return def.armor?.slot === 'head';
    case 'boots':
      return def.armor?.slot === 'feet';
    case 'bow':
      return itemId === 'bow' || itemId === 'crossbow';
    case 'durable':
      return ItemRegistry.maxDurability(itemId) > 0;
  }
}

/** Peut-on ajouter `id` à côté des enchantements déjà présents (groupes exclusifs) ? */
export function compatible(existing: Record<string, number>, id: string): boolean {
  const g = ENCHANT_BY_ID.get(id)?.group;
  if (!g) return true;
  return !Object.keys(existing).some((k) => k !== id && ENCHANT_BY_ID.get(k)?.group === g);
}

/** Objet enchantable à la table ? */
export function enchantable(itemId: string): boolean {
  if (itemId === 'book') return true;
  return ENCHANTS.some((e) => !e.treasure && canEnchant(itemId, e));
}

/** Générateur pseudo-aléatoire déterministe (graine d'enchantement du joueur). */
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EnchantOffer {
  /** Niveau d'expérience requis (affiché). */
  level: number;
  /** Lapis et niveaux retirés (1, 2 ou 3). */
  cost: number;
  ench: Record<string, number>;
}

/**
 * Trois propositions de la table d'enchantement, comme le jeu original : niveaux requis selon
 * les bibliothèques autour (15 au plus), enchantements tirés selon leur poids et leur niveau.
 */
export function enchantOffers(itemId: string, bookshelves: number, seed: number): EnchantOffer[] {
  if (!enchantable(itemId)) return [];
  const r = rng(seed ^ (itemId.length * 7919));
  const b = Math.min(15, bookshelves);
  const base = 1 + Math.floor(r() * 8) + Math.floor(b / 2) + Math.floor(r() * (b + 1));
  const levels = [Math.max(Math.floor(base / 3), 1), Math.floor((base * 2) / 3) + 1, Math.max(base, b * 2)];
  return levels.map((level, i) => ({ level, cost: i + 1, ench: rollEnchants(itemId, level, r) }));
}

function rollEnchants(itemId: string, level: number, r: () => number): Record<string, number> {
  const pool = ENCHANTS.filter((e) => !e.treasure && canEnchant(itemId, e));
  const out: Record<string, number> = {};
  const book = itemId === 'book';
  let chance = 1;
  let power = level + 1 + Math.floor(r() * 4);
  while (pool.length && r() < chance) {
    const cand = pool.filter((e) => compatible(out, e.id) && !out[e.id]);
    if (!cand.length) break;
    const total = cand.reduce((a, e) => a + e.weight, 0);
    let w = r() * total;
    const pick = cand.find((e) => (w -= e.weight) < 0) ?? cand[0];
    // niveau de l'enchantement proportionnel au niveau dépensé (30 = niveau maximal)
    out[pick.id] = Math.max(1, Math.min(pick.max, Math.round((pick.max * power) / 30 + r() * 0.6)));
    if (book) break;
    power = Math.floor(power / 2);
    chance = (power + 1) / 50;
  }
  return out;
}

/** Bibliothèques comptées autour d'une table (anneau à 2 blocs, sur 2 hauteurs). */
export function countBookshelves(getBlockKey: (x: number, y: number, z: number) => string, x: number, y: number, z: number): number {
  let n = 0;
  for (let dy = 0; dy <= 1; dy++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
        if (getBlockKey(x + dx, y + dy, z + dz) === 'bookshelf') n++;
      }
  return Math.min(15, n);
}

// ---------- effets ----------

/** Dégâts supplémentaires de l'arme contre une créature. */
export function bonusDamage(st: ItemStack | null | undefined, mobKey: string): number {
  let d = 0;
  const sharp = enchLevel(st, 'sharpness');
  if (sharp) d += 0.5 * sharp + 0.5;
  const smite = enchLevel(st, 'smite');
  if (smite && /zombi|skeleton|squelette|wither|drowned|husk|stray|phantom|lich/.test(mobKey)) d += 2.5 * smite;
  const bane = enchLevel(st, 'bane_of_arthropods');
  if (bane && /spider|bee|silverfish|endermite/.test(mobKey)) d += 2.5 * bane;
  return d;
}

/** L'usure est-elle évitée (Solidité) ? Armure : 60 % des points restent consommés. */
export function unbreakingSaves(st: ItemStack, armor = false, rand: () => number = Math.random): boolean {
  const u = enchLevel(st, 'unbreaking');
  if (!u) return false;
  if (armor) return rand() >= 0.6 + 0.4 / (u + 1);
  return rand() >= 1 / (u + 1);
}

/** Réduction des dégâts par les enchantements de protection de l'armure (0..0,8). */
export function protectionFactor(armor: (ItemStack | null)[], kind: 'any' | 'fire' | 'explosion' | 'projectile' | 'fall'): number {
  let epf = 0;
  for (const a of armor) {
    if (!a) continue;
    epf += enchLevel(a, 'protection');
    if (kind === 'fire') epf += 2 * enchLevel(a, 'fire_protection');
    if (kind === 'explosion') epf += 2 * enchLevel(a, 'blast_protection');
    if (kind === 'projectile') epf += 2 * enchLevel(a, 'projectile_protection');
    if (kind === 'fall') epf += 3 * enchLevel(a, 'feather_falling');
  }
  return Math.min(20, epf) * 0.04;
}
