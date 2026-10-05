import { CRAFTING_RECIPES, SMELTING_RECIPES, TAGS } from '../data/recipes';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemStack } from '../inventory/Item';
import type { CraftingRecipe, SmeltingRecipe } from './Recipe';

/**
 * Registre des recettes. Correspondance « vanilla » : le contenu de la grille est rogné à sa
 * boîte englobante puis comparé au motif (et à son miroir horizontal) ; les recettes sans forme
 * ne tiennent compte que des ingrédients.
 */
class RecipeRegistryImpl {
  readonly crafting: CraftingRecipe[] = [];
  readonly smelting: SmeltingRecipe[] = [];
  readonly tags = TAGS;
  private smeltByInput = new Map<string, SmeltingRecipe>();

  constructor() {
    CRAFTING_RECIPES.forEach((r) => this.register(r));
    SMELTING_RECIPES.forEach((r) => this.registerSmelting(r));
  }

  private checkItem(id: string, ref: string) {
    if (id.startsWith('tag:')) {
      if (!TAGS[id.slice(4)]) throw new Error(`Recette ${ref}: tag inconnu ${id}`);
    } else if (!ItemRegistry.has(id)) throw new Error(`Recette ${ref}: objet inconnu ${id}`);
  }

  register(r: CraftingRecipe) {
    this.checkItem(r.result.item, r.id);
    for (const v of Object.values(r.key ?? {})) this.checkItem(v, r.id);
    for (const v of r.ingredients ?? []) this.checkItem(v, r.id);
    this.crafting.push(r);
  }

  registerSmelting(r: SmeltingRecipe) {
    this.checkItem(r.input, r.id);
    this.checkItem(r.result, r.id);
    this.smelting.push(r);
    this.smeltByInput.set(r.input, r);
  }

  /** Compatibilité avec l'ancien code (liste de toutes les recettes de fabrication). */
  get recipes() {
    return this.crafting;
  }

  matches(itemId: string, ingredient: string): boolean {
    if (ingredient.startsWith('tag:')) return TAGS[ingredient.slice(4)]?.includes(itemId) ?? false;
    return itemId === ingredient;
  }

  smeltingFor(itemId: string): SmeltingRecipe | undefined {
    return this.smeltByInput.get(itemId);
  }

  /** Recette correspondant au contenu d'une grille carrée (2x2 ou 3x3). */
  match(grid: (ItemStack | null)[], size: number): CraftingRecipe | null {
    let minX = size, minY = size, maxX = -1, maxY = -1;
    const items: string[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const s = grid[y * size + x];
        if (!s) continue;
        items.push(s.id);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    if (!items.length) return null;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const cell = (x: number, y: number) => grid[(minY + y) * size + minX + x]?.id ?? null;
    for (const r of this.crafting) {
      if (r.width > size || r.height > size) continue;
      if (r.type === 'shapeless') {
        if (r.ingredients!.length !== items.length) continue;
        const left = [...items];
        let ok = true;
        for (const ing of r.ingredients!) {
          const i = left.findIndex((it) => this.matches(it, ing));
          if (i < 0) {
            ok = false;
            break;
          }
          left.splice(i, 1);
        }
        if (ok) return r;
        continue;
      }
      if (r.width !== w || r.height !== h) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < h && ok; y++)
          for (let x = 0; x < w && ok; x++) {
            const ch = r.pattern![y][mirror ? w - 1 - x : x] ?? ' ';
            const it = cell(x, y);
            if (ch === ' ') ok = it === null;
            else ok = it !== null && this.matches(it, r.key![ch]);
          }
        if (ok) return r;
      }
    }
    return null;
  }

  /** Recettes produisant un objet (livre de recettes). */
  recipesFor(itemId: string): CraftingRecipe[] {
    return this.crafting.filter((r) => r.result.item === itemId);
  }
}

export const RecipeRegistry = new RecipeRegistryImpl();
