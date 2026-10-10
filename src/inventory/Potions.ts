/**
 * Potions (comme le jeu original) : stockées dans `stack.meta.potion` (« swiftness »,
 * « long_swiftness », « strong_swiftness »…). Fioles d'eau remplies à l'eau, verrue du Nether
 * → potion étrange, ingrédients → potions à effet, redstone (longue durée), poudre lumineuse
 * (niveau II), œil d'araignée fermenté (effet inverse), poudre à canon (potion jetable).
 * Les effets utilisent le système d'effets existant (Effects.ts).
 */
import type { ItemStack } from './Item';
import type { EffectList, EffectTarget } from '../entities/Effects';

interface PotionType {
  name: string;
  color: string;
  /** Effet (identifiant d'Effects.ts), durée en secondes (0 = instantané). */
  effect?: string;
  duration?: number;
  long?: number;
  strong?: number;
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
};

/** Ingrédient sur potion étrange → potion. */
const AWKWARD_TO: Record<string, string> = {
  sugar: 'swiftness', rabbit_foot: 'leaping', glistering_melon_slice: 'healing', spider_eye: 'poison', pufferfish: 'water_breathing',
  magma_cream: 'fire_resistance', golden_carrot: 'night_vision', blaze_powder: 'strength', ghast_tear: 'regeneration', phantom_membrane: 'slow_falling',
};
/** Œil d'araignée fermenté : effet inversé. */
const CORRUPT: Record<string, string> = { swiftness: 'slowness', leaping: 'slowness', healing: 'harming', poison: 'harming', night_vision: 'invisibility' };

export const BREW_INGREDIENTS = new Set(['nether_wart', 'redstone', 'glowstone_dust', 'fermented_spider_eye', 'gunpowder', ...Object.keys(AWKWARD_TO)]);
export const isBrewIngredient = (id: string) => BREW_INGREDIENTS.has(id);
export const isBrewBottle = (st: ItemStack) => st.id === 'potion' || st.id === 'splash_potion';

/** Identifiant de potion d'une pile (« water » par défaut pour une fiole). */
export function potionOf(st: ItemStack | null | undefined): string | null {
  if (!st || (st.id !== 'potion' && st.id !== 'splash_potion')) return null;
  return (st.meta?.potion as string | undefined) ?? 'water';
}
export function makePotion(potion: string, splash = false): ItemStack {
  return { id: splash ? 'splash_potion' : 'potion', count: 1, meta: { potion } };
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
  const splash = st.id === 'splash_potion' ? name.replace(/^Potion/, 'Potion jetable').replace(/^Fiole d'eau/, "Fiole d'eau jetable") : name;
  return v === 'strong' ? `${splash} II` : splash;
}
export function potionColor(st: ItemStack): string {
  return POTIONS[parse(potionOf(st) ?? 'water').base]?.color ?? '#385dc6';
}

/** Effet d'une potion : identifiant, durée (s), amplificateur. */
export function potionEffect(p: string): { id: string; seconds: number; amp: number } | null {
  const { base, v } = parse(p);
  const t = POTIONS[base];
  if (!t?.effect) return null;
  const seconds = v === 'long' ? t.long ?? t.duration! : v === 'strong' ? t.strong ?? t.duration! : t.duration!;
  return { id: t.effect, seconds, amp: v === 'strong' ? (base === 'slowness' ? 3 : 1) : 0 };
}

/** Ligne d'infobulle (« Rapidité (3:00) »). */
export function potionLine(st: ItemStack): string | null {
  const e = potionEffect(potionOf(st) ?? '');
  if (!e) return null;
  const { base } = parse(potionOf(st)!);
  const t = POTIONS[base].name.replace(/^Potion (de |d')/, '');
  const name = t.charAt(0).toUpperCase() + t.slice(1) + (e.amp ? ` ${['', 'II', 'III', 'IV'][e.amp]}` : '');
  return e.seconds > 0 ? `${name} (${Math.floor(e.seconds / 60)}:${String(e.seconds % 60).padStart(2, '0')})` : name;
}

/** Résultat de l'infusion d'un ingrédient dans une potion (null si sans effet). */
export function brewResult(bottle: ItemStack, ingredient: string): ItemStack | null {
  const p = potionOf(bottle);
  if (!p) return null;
  const splash = bottle.id === 'splash_potion';
  const { base, v } = parse(p);
  const out = (np: string, sp = splash) => makePotion(np, sp);
  if (ingredient === 'gunpowder') return splash ? null : out(p, true);
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
    const nv = v === 'long' && nt.long ? 'long_' : v === 'strong' && nt.strong !== undefined ? 'strong_' : '';
    return out(nv + nb);
  }
  return null;
}

/** Applique une potion à une cible (buvée : 100 %, éclaboussée : selon la distance). */
export function applyPotion(effects: EffectList, target: EffectTarget, p: string, factor = 1) {
  const e = potionEffect(p);
  if (!e) return false;
  if (e.seconds === 0) {
    // effet instantané : amplificateur conservé, intensité réduite par la distance
    if (factor >= 0.5) effects.add(e.id, 1, e.amp, true, target);
    return true;
  }
  return effects.add(e.id, Math.round(e.seconds * 20 * factor), e.amp, true, target);
}
