import type { Inventory } from '../inventory/Inventory';
import { canMerge, makeStack } from '../inventory/Inventory';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemStack } from '../inventory/Item';
import type { CraftingRecipe } from './Recipe';
import { RecipeRegistry } from './RecipeRegistry';

/** Grille de fabrication (2x2 dans l'inventaire, 3x3 sur l'établi). */
export class CraftingGrid {
  readonly slots: (ItemStack | null)[];
  constructor(readonly size: 2 | 3) {
    this.slots = new Array(size * size).fill(null);
  }
  get recipe(): CraftingRecipe | null {
    return RecipeRegistry.match(this.slots, this.size);
  }
  get result(): ItemStack | null {
    const r = this.recipe;
    return r ? makeStack(r.result.item, r.result.count) : null;
  }
  /** Consomme un exemplaire de chaque case (prise du résultat). */
  consume() {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) continue;
      s.count--;
      if (s.count <= 0) this.slots[i] = null;
    }
  }
  /** Rend le contenu à l'inventaire ; retourne ce qui n'a pas pu être rangé. */
  clearInto(inv: Inventory): ItemStack[] {
    const left: ItemStack[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) continue;
      const rest = inv.add(s);
      if (rest > 0) left.push({ ...s, count: rest });
      this.slots[i] = null;
    }
    return left;
  }
}

/**
 * Outils du « livre de recettes » : savoir si une recette est réalisable à partir de
 * l'inventaire et remplir automatiquement la grille selon le motif.
 */
export class CraftingSystem {
  countFor(inv: Inventory, ingredient: string): number {
    let n = 0;
    for (const s of inv.slots) if (s && RecipeRegistry.matches(s.id, ingredient)) n += s.count;
    return n;
  }

  /** Ingrédients nécessaires (par case) d'une recette. */
  cells(r: CraftingRecipe): { ingredient: string; x: number; y: number }[] {
    if (r.type === 'shapeless') return r.ingredients!.map((ing, i) => ({ ingredient: ing, x: i % r.width, y: Math.floor(i / r.width) }));
    const out: { ingredient: string; x: number; y: number }[] = [];
    r.pattern!.forEach((row, y) => [...row].forEach((ch, x) => ch !== ' ' && out.push({ ingredient: r.key![ch], x, y })));
    return out;
  }

  /** Nombre de fois que la recette peut être faite avec l'inventaire + la grille. */
  canCraft(inv: Inventory, r: CraftingRecipe, gridSize: number, grid?: CraftingGrid): boolean {
    if (r.width > gridSize || r.height > gridSize) return false;
    const need = new Map<string, number>();
    for (const c of this.cells(r)) need.set(c.ingredient, (need.get(c.ingredient) ?? 0) + 1);
    for (const [ing, n] of need) {
      let have = this.countFor(inv, ing);
      if (grid) for (const s of grid.slots) if (s && RecipeRegistry.matches(s.id, ing)) have += s.count;
      if (have < n) return false;
    }
    return true;
  }

  /** Remplit la grille avec les ingrédients de la recette (depuis l'inventaire). */
  fillGrid(inv: Inventory, grid: CraftingGrid, r: CraftingRecipe, times = 1): boolean {
    for (const left of grid.clearInto(inv)) inv.add(left);
    if (!this.canCraft(inv, r, grid.size)) return false;
    for (let t = 0; t < times; t++) {
      if (t > 0 && !this.canCraft(inv, r, grid.size)) break;
      for (const c of this.cells(r)) {
        const idx = c.y * grid.size + c.x;
        const slot = inv.slots.findIndex((s) => s && RecipeRegistry.matches(s.id, c.ingredient) && (!grid.slots[idx] || canMerge(grid.slots[idx]!, s)));
        if (slot < 0) return t > 0;
        const taken = inv.takeFromSlot(slot, 1)!;
        const cur = grid.slots[idx];
        if (cur) cur.count++;
        else grid.slots[idx] = taken;
      }
    }
    inv.changed();
    return true;
  }
}

/** État d'un fourneau (entité de bloc), simulé comme dans le jeu vanilla. */
export interface FurnaceState {
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  /** Combustion restante (s) et durée totale du combustible en cours. */
  burn: number;
  burnMax: number;
  /** Progression de la cuisson (s, 10 s par objet). */
  cook: number;
  xp: number;
}

export function newFurnace(): FurnaceState {
  return { input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0, xp: 0 };
}

/** Avance la simulation d'un fourneau ; retourne vrai si l'état « allumé » a changé. */
export function tickFurnace(f: FurnaceState, dt: number): boolean {
  const wasLit = f.burn > 0;
  const recipe = f.input ? RecipeRegistry.smeltingFor(f.input.id) : undefined;
  const canSmelt = !!recipe && (!f.output || (f.output.id === recipe.result && f.output.count < ItemRegistry.maxStack(recipe.result)));
  if (f.burn <= 0 && canSmelt && f.fuel) {
    const bt = ItemRegistry.get(f.fuel.id)?.burnTime ?? 0;
    if (bt > 0) {
      f.burn = f.burnMax = bt;
      if (f.fuel.id === 'lava_bucket') f.fuel = makeStack('bucket');
      else {
        f.fuel.count--;
        if (f.fuel.count <= 0) f.fuel = null;
      }
    }
  }
  if (f.burn > 0) {
    f.burn = Math.max(0, f.burn - dt);
    if (canSmelt) {
      f.cook += dt;
      if (f.cook >= recipe!.time) {
        f.cook = 0;
        if (f.output) f.output.count++;
        else f.output = makeStack(recipe!.result, 1);
        f.input!.count--;
        if (f.input!.count <= 0) f.input = null;
        f.xp += recipe!.xp;
      }
    } else f.cook = 0;
  } else if (f.cook > 0) f.cook = Math.max(0, f.cook - dt * 2);
  return wasLit !== f.burn > 0;
}
