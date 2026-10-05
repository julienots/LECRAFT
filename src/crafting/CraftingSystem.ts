import type { Inventory } from '../inventory/Inventory';
import { makeStack } from '../inventory/Inventory';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { Recipe, Station } from './Recipe';
import { RecipeRegistry } from './RecipeRegistry';

/**
 * Système de fabrication « livre de recettes » adapté au tactile :
 * l'interface liste les recettes, le joueur touche celle qu'il veut fabriquer.
 * Le four consomme des unités de combustible (charbon = 8, bois = 2...).
 */
export class CraftingSystem {
  /** Réserve de combustible du joueur (unités). */
  fuel = 0;

  countFor(inv: Inventory, ingredient: string): number {
    let n = 0;
    for (const s of inv.slots) if (s && RecipeRegistry.matches(s.id, ingredient)) n += s.count;
    return n;
  }

  fuelAvailable(inv: Inventory): number {
    let n = this.fuel;
    for (const s of inv.slots) if (s) n += (ItemRegistry.get(s.id)?.fuel ?? 0) * s.count;
    return n;
  }

  canCraft(inv: Inventory, r: Recipe, times = 1): boolean {
    for (const i of r.ingredients) if (this.countFor(inv, i.item) < i.count * times) return false;
    if (r.fuel) {
      // le combustible ne doit pas être un ingrédient consommé deux fois : approximation conservatrice
      const needFuel = r.fuel * times;
      if (this.fuel < needFuel && this.fuelAvailable(inv) - this.ingredientFuel(inv, r, times) < needFuel) return false;
    }
    return true;
  }

  private ingredientFuel(_inv: Inventory, r: Recipe, times: number): number {
    let n = 0;
    for (const i of r.ingredients) {
      const id = i.item.startsWith('tag:') ? RecipeRegistry.tags[i.item.slice(4)][0] : i.item;
      n += (ItemRegistry.get(id)?.fuel ?? 0) * i.count * times;
    }
    return n;
  }

  available(inv: Inventory, station: Station): { recipe: Recipe; craftable: boolean }[] {
    return RecipeRegistry.forStation(station).map((recipe) => ({ recipe, craftable: this.canCraft(inv, recipe) }));
  }

  private consume(inv: Inventory, ingredient: string, n: number) {
    for (let i = inv.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = inv.slots[i];
      if (s && RecipeRegistry.matches(s.id, ingredient)) {
        const k = Math.min(n, s.count);
        s.count -= k;
        n -= k;
        if (s.count <= 0) inv.slots[i] = null;
      }
    }
  }

  private consumeFuel(inv: Inventory, units: number, exclude: Set<string>) {
    while (this.fuel < units) {
      // brûle l'objet combustible le moins précieux (plus petite valeur)
      let best = -1, bestVal = Infinity;
      inv.slots.forEach((s, i) => {
        if (!s || exclude.has(s.id)) return;
        const f = ItemRegistry.get(s.id)?.fuel ?? 0;
        if (f > 0 && f < bestVal) {
          bestVal = f;
          best = i;
        }
      });
      if (best < 0) return false;
      inv.slots[best]!.count--;
      if (inv.slots[best]!.count <= 0) inv.slots[best] = null;
      this.fuel += bestVal;
    }
    this.fuel -= units;
    return true;
  }

  /** Fabrique ; retourne le nombre de fabrications réussies. */
  craft(inv: Inventory, r: Recipe, times = 1): number {
    let done = 0;
    for (let t = 0; t < times; t++) {
      if (!this.canCraft(inv, r)) break;
      for (const i of r.ingredients) this.consume(inv, i.item, i.count);
      if (r.fuel) {
        const exclude = new Set(r.ingredients.map((i) => i.item));
        if (!this.consumeFuel(inv, r.fuel, exclude)) break;
      }
      const rest = inv.add({ ...makeStack(r.result.item, r.result.count) });
      done++;
      if (rest > 0) {
        // inventaire plein : l'appelant récupère via onOverflow
        this.overflow.push({ ...makeStack(r.result.item, rest) });
        break;
      }
    }
    inv.changed();
    return done;
  }

  /** Objets qui n'ont pas pu entrer dans l'inventaire (à jeter au sol). */
  overflow: { id: string; count: number }[] = [];
}
