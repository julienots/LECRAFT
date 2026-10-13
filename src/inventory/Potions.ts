/**
 * Potions (comme le jeu original) : stockées dans `stack.meta.potion` (« swiftness »,
 * « long_swiftness », « strong_swiftness »…). Fioles d'eau remplies à l'eau, verrue du Nether
 * → potion étrange, ingrédients → potions à effet, redstone (longue durée), poudre lumineuse
 * (niveau II), œil d'araignée fermenté (effet inverse), poudre à canon (potion jetable).
 * Les effets utilisent le système d'effets existant (Effects.ts).
 */
import type { ItemStack } from './Item';
import { EFFECTS as EFFECT_NAMES, type EffectList, type EffectTarget } from '../entities/Effects';

interface PotionType {
  name: string;
  color: string;
  /** Effet (identifiant d'Effects.ts), durée en secondes (0 = instantané). */
  effect?: string;
  duration?: number;
  long?: number;
  strong?: number;
  /** Effets supplémentaires (Maître tortue : lenteur + résistance), amplificateurs normal / renforcé. */
  more?: { effect: string; amp: number; strongAmp: number }[];
  /** Amplificateur de l'effet principal (normal / renforcé), si différent de 0 / 1. */
  amp?: number;
  strongAmp?: number;
}

export const POTIONS: Record<string, PotionType> = {
  water: { name: "Fiole d'eau", color: '#385dc6' },
  awkward: { name: 'Potion étrange', color: '#385dc6' },
  thick: { name: 'Potion épaisse', color: '#385dc6' },
  mundane: { name: 'Potion banale', color: '#385dc6' },
  night_vision: { name: 'Potion de vision nocturne', color: '#1f1fa1', effect: 'night_vision', duration: 180, long: 480 },
  invisibility: { name: "Potion d'invisibilité", color: '#7f8392', effect: 'invisibility', duration: 180, long: 480 },
  leaping: { name: 'Potion de saut', color: '#22ff4c', effect: 'jump_boost', duration: 180, long: 480, strong: 90 },
  fire_resistance: { name: 'Potion de résistance au feu', color: '#e49a3a', effect: 'fire_resistance', duration: 180, long: 480 },
  swiftness: { name: 'Potion de rapidité', color: '#7cafc6', effect: 'speed', duration: 180, long: 480, strong: 90 },
  slowness: { name: 'Potion de lenteur', color: '#5a6c81', effect: 'slowness', duration: 90, long: 240, strong: 20 },
  water_breathing: { name: "Potion d'apnée", color: '#2e5299', effect: 'water_breathing', duration: 180, long: 480 },
  healing: { name: 'Potion de soin', color: '#f82423', effect: 'instant_health', duration: 0, strong: 0 },
  harming: { name: 'Potion de dégâts', color: '#430a09', effect: 'instant_damage', duration: 0, strong: 0 },
  poison: { name: 'Potion de poison', color: '#4e9331', effect: 'poison', duration: 45, long: 90, strong: 21 },
  regeneration: { name: 'Potion de régénération', color: '#cd5cab', effect: 'regeneration', duration: 45, long: 90, strong: 22 },
  strength: { name: 'Potion de force', color: '#932423', effect: 'strength', duration: 180, long: 480, strong: 90 },
  weakness: { name: 'Potion de faiblesse', color: '#484d48', effect: 'weakness', duration: 90, long: 240 },
  slow_falling: { name: 'Potion de chute lente', color: '#f3cfb9', effect: 'slow_falling', duration: 90, long: 240 },
  // Maître tortue : Lenteur IV + Résistance III (renforcée : Lenteur VI + Résistance IV)
  turtle_master: { name: 'Potion du Maître tortue', color: '#755a72', effect: 'slowness', amp: 3, strongAmp: 5, duration: 20, long: 40, strong: 20, more: [{ effect: 'resistance', amp: 2, strongAmp: 3 }] },
  luck: { name: 'Potion de chance', color: '#59c106', effect: 'luck', duration: 300 },
  // potions de 1.21
  wind_charged: { name: 'Potion de charge de vent', color: '#bdc9ff', effect: 'wind_charged', duration: 180 },
  weaving: { name: 'Potion de tissage', color: '#78695a', effect: 'weaving', duration: 180 },
  oozing: { name: 'Potion de suintement', color: '#99ffa3', effect: 'oozing', duration: 180 },
  infested: { name: "Potion d'infestation", color: '#8c9b8c', effect: 'infested', duration: 180 },
};

/** Ingrédient sur potion étrange → potion. */
const AWKWARD_TO: Record<string, string> = {
  sugar: 'swiftness', rabbit_foot: 'leaping', glistering_melon_slice: 'healing', spider_eye: 'poison', pufferfish: 'water_breathing',
  magma_cream: 'fire_resistance', golden_carrot: 'night_vision', blaze_powder: 'strength', ghast_tear: 'regeneration', phantom_membrane: 'slow_falling',
  turtle_helmet: 'turtle_master', breeze_rod: 'wind_charged', cobweb: 'weaving', slime_block: 'oozing', stone: 'infested',
};
/** Œil d'araignée fermenté : effet inversé. */
const CORRUPT: Record<string, string> = { swiftness: 'slowness', leaping: 'slowness', healing: 'harming', poison: 'harming', night_vision: 'invisibility' };

export const BREW_INGREDIENTS = new Set(['nether_wart', 'redstone', 'glowstone_dust', 'fermented_spider_eye', 'gunpowder', 'dragon_breath', ...Object.keys(AWKWARD_TO)]);
export const isBrewIngredient = (id: string) => BREW_INGREDIENTS.has(id);
export const isBrewBottle = (st: ItemStack) => st.id === 'potion' || st.id === 'splash_potion' || st.id === 'lingering_potion';

/** Identifiant de potion d'une pile (« water » par défaut pour une fiole). */
export function potionOf(st: ItemStack | null | undefined): string | null {
  if (!st || (st.id !== 'potion' && st.id !== 'splash_potion' && st.id !== 'lingering_potion')) return null;
  return (st.meta?.potion as string | undefined) ?? 'water';
}
export function makePotion(potion: string, splash: boolean | 'lingering' = false): ItemStack {
  return { id: splash === 'lingering' ? 'lingering_potion' : splash ? 'splash_potion' : 'potion', count: 1, meta: { potion } };
}

/** Type de base, variante (longue / renforcée). */
function parse(p: string): { base: string; v: '' | 'long' | 'strong' } {
  if (p.startsWith('long_')) return { base: p.slice(5), v: 'long' };
  if (p.startsWith('strong_')) return { base: p.slice(7), v: 'strong' };
  return { base: p, v: '' };
}

export function potionName(st: ItemStack): string {
  const p = potionOf(st)!;
  const { base, v } = parse(p);
  const t = POTIONS[base];
  const name = t?.name ?? 'Potion';
  const splash = st.id === 'lingering_potion' ? name.replace(/^Potion/, 'Potion persistante').replace(/^Fiole d'eau/, "Fiole d'eau persistante") : st.id === 'splash_potion' ? name.replace(/^Potion/, 'Potion jetable').replace(/^Fiole d'eau/, "Fiole d'eau jetable") : name;
  return v === 'strong' ? `${splash} II` : splash;
}
export function potionColor(st: ItemStack): string {
  return POTIONS[parse(potionOf(st) ?? 'water').base]?.color ?? '#385dc6';
}

/** Effets d'une potion : identifiant, durée (s), amplificateur (plusieurs pour Maître tortue). */
export function potionEffects(p: string): { id: string; seconds: number; amp: number }[] {
  const { base, v } = parse(p);
  const t = POTIONS[base];
  if (!t?.effect) return [];
  const seconds = v === 'long' ? t.long ?? t.duration! : v === 'strong' ? t.strong ?? t.duration! : t.duration!;
  const strong = v === 'strong';
  const main = { id: t.effect, seconds, amp: strong ? t.strongAmp ?? (base === 'slowness' ? 3 : 1) : t.amp ?? 0 };
  return [main, ...(t.more ?? []).map((m) => ({ id: m.effect, seconds, amp: strong ? m.strongAmp : m.amp }))];
}
export function potionEffect(p: string): { id: string; seconds: number; amp: number } | null {
  return potionEffects(p)[0] ?? null;
}

const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI'];
/** Ligne d'infobulle (« Rapidité (3:00) » ; une ligne par effet, séparées par « , »). */
export function potionLine(st: ItemStack): string | null {
  const list = potionEffects(potionOf(st) ?? '');
  if (!list.length) return null;
  return list
    .map((e) => {
      const name = EFFECT_NAMES[e.id] ?? e.id;
      const label = name + (e.amp ? ` ${ROMAN[e.amp] ?? e.amp + 1}` : '');
      return e.seconds > 0 ? `${label} (${Math.floor(e.seconds / 60)}:${String(e.seconds % 60).padStart(2, '0')})` : label;
    })
    .join(', ');
}

/** Résultat de l'infusion d'un ingrédient dans une potion (null si sans effet). */
export function brewResult(bottle: ItemStack, ingredient: string): ItemStack | null {
  const p = potionOf(bottle);
  if (!p) return null;
  const splash = bottle.id === 'splash_potion';
  const { base, v } = parse(p);
  const out = (np: string, sp: boolean | 'lingering' = bottle.id === 'lingering_potion' ? 'lingering' : splash) => makePotion(np, sp);
  if (ingredient === 'gunpowder') return splash || bottle.id === 'lingering_potion' ? null : out(p, true);
  // souffle de dragon sur une potion jetable : potion persistante (nuage d'effet)
  if (ingredient === 'dragon_breath') return bottle.id === 'splash_potion' ? makePotion(p, 'lingering') : null;
  if (base === 'water') {
    if (ingredient === 'nether_wart') return out('awkward');
    if (ingredient === 'glowstone_dust') return out('thick');
    if (ingredient === 'fermented_spider_eye') return out('weakness');
    if (AWKWARD_TO[ingredient] || ingredient === 'redstone') return out('mundane');
    return null;
  }
  if (base === 'awkward') return AWKWARD_TO[ingredient] ? out(AWKWARD_TO[ingredient]) : null;
  const t = POTIONS[base];
  if (!t?.effect) return null;
  if (ingredient === 'redstone') return t.long && v !== 'long' ? out(`long_${base}`) : null;
  if (ingredient === 'glowstone_dust') return t.strong !== undefined && v !== 'strong' ? out(`strong_${base}`) : null;
  if (ingredient === 'fermented_spider_eye' && CORRUPT[base]) {
    const nb = CORRUPT[base];
    const nt = POTIONS[nb];
    // comme le jeu original : saut II → lenteur (normale), poison prolongé → dégâts (normaux)
    const nv = v === 'long' && nt.long ? 'long_' : v === 'strong' && nt.strong !== undefined && base !== 'leaping' ? 'strong_' : '';
    return out(nv + nb);
  }
  return null;
}

/** Applique une potion à une cible (buvée : 100 %, éclaboussée : selon la distance). */
export function applyPotion(effects: EffectList, target: EffectTarget, p: string, factor = 1) {
  const list = potionEffects(p);
  if (!list.length) return false;
  for (const e of list) {
    // effet instantané : amplificateur conservé, intensité réduite par la distance
    if (e.seconds === 0) {
      if (factor >= 0.5) effects.add(e.id, 1, e.amp, true, target);
    } else effects.add(e.id, Math.round(e.seconds * 20 * factor), e.amp, true, target);
  }
  return true;
}
