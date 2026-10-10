/**
 * Alambic : 3 fioles, 1 ingrédient, poudre de blaze (20 infusions par poudre). Une infusion
 * dure 20 s ; elle s'arrête si l'ingrédient est retiré ou n'agit plus sur les fioles.
 */
import type { ItemStack } from '../inventory/Item';
import { brewResult } from '../inventory/Potions';

export interface BrewingState {
  bottles: (ItemStack | null)[];
  ingredient: ItemStack | null;
  fuelItem: ItemStack | null;
  /** Infusions restantes (poudre de blaze consommée). */
  fuel: number;
  /** Secondes restantes de l'infusion en cours (0 = arrêt). */
  time: number;
}

export const newBrewing = (): BrewingState => ({ bottles: [null, null, null], ingredient: null, fuelItem: null, fuel: 0, time: 0 });

const BREW_TIME = 20;

/** Une des fioles réagit-elle à l'ingrédient ? */
function canBrew(s: BrewingState): boolean {
  if (!s.ingredient) return false;
  return s.bottles.some((b) => b && brewResult(b, s.ingredient!.id));
}

/** Avance l'infusion ; retourne vrai si une infusion vient de se terminer. */
export function tickBrewing(s: BrewingState, dt: number): boolean {
  // recharge en poudre de blaze
  if (s.fuel <= 0 && s.fuelItem && s.fuelItem.id === 'blaze_powder' && canBrew(s)) {
    s.fuel = 20;
    s.fuelItem.count--;
    if (s.fuelItem.count <= 0) s.fuelItem = null;
  }
  if (s.time > 0) {
    if (!canBrew(s)) {
      s.time = 0;
      return false;
    }
    s.time -= dt;
    if (s.time <= 0) {
      s.time = 0;
      const ing = s.ingredient!.id;
      s.bottles = s.bottles.map((b) => (b ? brewResult(b, ing) ?? b : b));
      s.ingredient!.count--;
      if (s.ingredient!.count <= 0) s.ingredient = null;
      return true;
    }
    return false;
  }
  if (s.fuel > 0 && canBrew(s)) {
    s.fuel--;
    s.time = BREW_TIME;
  }
  return false;
}
