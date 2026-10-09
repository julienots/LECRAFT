import { describe, expect, it } from 'vitest';
import { EXTRA_BLOCKS, EXTRA_ITEMS, EXTRA_RECIPES, EXTRA_TAGS } from '../src/data/vanillaExtra';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { makeStack } from '../src/inventory/Inventory';
import { RecipeRegistry } from '../src/crafting/RecipeRegistry';
import type { CraftingRecipe } from '../src/crafting/Recipe';

// contenu supplémentaire enregistré comme au démarrage du jeu (AddonManager.registerExtraContent)
for (const d of EXTRA_BLOCKS) if (!ItemRegistry.has(d.key)) ItemRegistry.register({ key: d.key, name: d.name, icon: { block: d.key }, place: d.key, tab: 'building' });
for (const it of EXTRA_ITEMS) if (!ItemRegistry.has(it.key)) ItemRegistry.register(it);
for (const [t, list] of Object.entries(EXTRA_TAGS)) {
  const cur = (RecipeRegistry.tags as Record<string, string[]>)[t];
  if (cur) for (const k of list) if (!cur.includes(k) && ItemRegistry.has(k)) cur.push(k);
}
const skipped: string[] = [];
for (const r of EXTRA_RECIPES) {
  try {
    RecipeRegistry.register(r);
  } catch {
    skipped.push(r.id);
  }
}

const first = (k: string) => (k.startsWith('tag:') ? (RecipeRegistry.tags as Record<string, string[]>)[k.slice(4)]?.[0] ?? '' : k);

/** Remplit une grille 3x3 avec la recette (premier objet de chaque tag). */
function grid(r: CraftingRecipe) {
  const g = Array(9).fill(null);
  if (r.type === 'shaped')
    r.pattern!.forEach((row, y) => [...row].forEach((ch, x) => ch !== ' ' && (g[y * 3 + x] = makeStack(first(r.key![ch]), 1))));
  else r.ingredients!.forEach((k, i) => (g[i] = makeStack(first(k), 1)));
  return g;
}

describe('Recettes', () => {
  it('toutes les recettes supplémentaires sont enregistrées (ingrédients connus)', () => {
    expect(skipped).toEqual([]);
  });
  it('chaque symbole du motif est défini', () => {
    const bad = RecipeRegistry.crafting.filter((r) => r.type === 'shaped' && r.pattern!.some((row) => [...row].some((ch) => ch !== ' ' && !r.key![ch])));
    expect(bad.map((r) => r.id)).toEqual([]);
  });
  it('chaque recette est réellement fabricable (la grille donne bien son résultat)', () => {
    const bad: string[] = [];
    for (const r of RecipeRegistry.crafting) {
      const m = RecipeRegistry.match(grid(r), 3);
      if (m?.result.item !== r.result.item) bad.push(`${r.id} → ${m?.id ?? 'rien'}`);
    }
    expect(bad).toEqual([]);
  });
});
