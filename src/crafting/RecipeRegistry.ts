import { RECIPE_DEFS, TAGS } from '../data/recipes';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { Recipe, Station } from './Recipe';

class RecipeRegistryImpl {
  readonly recipes: Recipe[] = [];
  readonly tags = TAGS;
  constructor() {
    RECIPE_DEFS.forEach((r) => this.register(r));
  }
  register(r: Recipe) {
    if (!ItemRegistry.has(r.result.item)) throw new Error(`Recette ${r.id}: résultat inconnu ${r.result.item}`);
    for (const i of r.ingredients) {
      if (i.item.startsWith('tag:')) {
        if (!TAGS[i.item.slice(4)]) throw new Error(`Tag inconnu ${i.item}`);
      } else if (!ItemRegistry.has(i.item)) throw new Error(`Recette ${r.id}: ingrédient inconnu ${i.item}`);
    }
    this.recipes.push(r);
  }
  /** Recettes réalisables à une station donnée (l'établi permet aussi les recettes « main »). */
  forStation(station: Station): Recipe[] {
    return this.recipes.filter((r) => r.station === station || (station === 'table' && r.station === 'hand'));
  }
  matches(itemId: string, ingredient: string): boolean {
    if (ingredient.startsWith('tag:')) return TAGS[ingredient.slice(4)]?.includes(itemId) ?? false;
    return itemId === ingredient;
  }
}

export const RecipeRegistry = new RecipeRegistryImpl();
