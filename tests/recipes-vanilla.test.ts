import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTRA_BLOCKS, EXTRA_ITEMS, EXTRA_RECIPES, EXTRA_SMELTING, EXTRA_TAGS } from '../src/data/vanillaExtra';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { makeStack } from '../src/inventory/Inventory';
import { RecipeRegistry } from '../src/crafting/RecipeRegistry';
import { CraftingGrid, newFurnace, tickFurnace } from '../src/crafting/CraftingSystem';

// contenu supplémentaire enregistré comme au démarrage du jeu (AddonManager.registerExtraContent)
for (const d of EXTRA_BLOCKS) if (!ItemRegistry.has(d.key)) ItemRegistry.register({ key: d.key, name: d.name, icon: { block: d.key }, place: d.key, tab: 'building' });
for (const it of EXTRA_ITEMS) if (!ItemRegistry.has(it.key)) ItemRegistry.register(it);
for (const [t, list] of Object.entries(EXTRA_TAGS)) {
  const cur = (RecipeRegistry.tags as Record<string, string[]>)[t];
  if (cur) for (const k of list) if (!cur.includes(k) && ItemRegistry.has(k)) cur.push(k);
}
for (const r of EXTRA_RECIPES) {
  try {
    RecipeRegistry.register(r);
  } catch {
    /* ingrédient indisponible */
  }
}
for (const r of EXTRA_SMELTING) if (!RecipeRegistry.smeltingFor(r.input) && ItemRegistry.has(r.input) && ItemRegistry.has(r.result)) RecipeRegistry.registerSmelting(r);

/** Grille 3x3 depuis un motif (une lettre = un objet). */
function grid(rows: string[], key: Record<string, string>) {
  const g = new CraftingGrid(3);
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== ' ' && (g.slots[y * 3 + x] = makeStack(key[ch], 1))));
  return g;
}
const craft = (rows: string[], key: Record<string, string>) => {
  const r = grid(rows, key).recipe;
  return r ? `${r.result.item}×${r.result.count}` : null;
};

describe('Recettes du jeu original', () => {
  it('recettes de base (motifs, nombres, tags)', () => {
    expect(craft(['#'], { '#': 'oak_log' })).toBe('oak_planks×4');
    expect(craft(['#'], { '#': 'stripped_oak_wood' })).toBe('oak_planks×4');
    expect(craft(['###', '# #', '###'], { '#': 'cobbled_deepslate' })).toBe('furnace×1');
    expect(craft(['###', '# #', '###'], { '#': 'blackstone' })).toBe('furnace×1');
    expect(craft(['XXX', ' # ', ' # '], { X: 'blackstone', '#': 'stick' })).toBe('stone_pickaxe×1');
    expect(craft(['# #', '###'], { '#': 'oak_planks' })).toBe('oak_boat×1');
    expect(craft(['###', '###', ' | '], { '#': 'oak_planks', '|': 'stick' })).toBe('oak_sign×3');
    expect(craft(['X X', 'X#X', 'X X'], { X: 'iron_ingot', '#': 'stick' })).toBe('rail×16');
    expect(craft(['III', ' i ', 'iii'], { I: 'iron_block', i: 'iron_ingot' })).toBe('anvil×1');
    expect(craft(['PSP', 'P P', 'PSP'], { P: 'birch_planks', S: 'cherry_slab' })).toBe('barrel×1');
    expect(craft(['CCC', 'CNC', 'CCC'], { C: 'chiseled_stone_bricks', N: 'iron_ingot' })).toBe('lodestone×1');
    expect(craft([' A ', 'ABA', 'CCC'], { A: 'stick', B: 'soul_soil', C: 'stripped_spruce_log' })).toBe('soul_campfire×1');
    expect(craft(['C', 'S', 'D'], { C: 'charcoal', S: 'stick', D: 'soul_soil' })).toBe('soul_torch×4');
    expect(craft(['###', '#C#', '###'], { '#': 'paper', C: 'compass' })).toBe('map×1');
    // teinture : n'importe quelle laine ; béton en poudre sans forme
    expect(craft(['AB'], { A: 'red_wool', B: 'blue_dye' })).toBe('blue_wool×1');
    expect(craft(['GSG', 'SDS', 'GSG'], { G: 'gravel', S: 'sand', D: 'red_dye' })).toBe('red_concrete_powder×8');
    // le colorant vert se cuit (cactus), il ne se fabrique pas
    expect(craft(['C'], { C: 'cactus' })).toBe(null);
    expect(RecipeRegistry.smeltingFor('cactus')?.result).toBe('green_dye');
  });

  it('boîtes de shulker : boîte de base puis teinture', () => {
    expect(craft(['S', 'C', 'S'], { S: 'shulker_shell', C: 'chest' })).toBe('shulker_box×1');
    expect(craft(['AB'], { A: 'shulker_box', B: 'lime_dye' })).toBe('lime_shulker_box×1');
  });

  it('le gâteau rend les seaux vides', () => {
    const g = grid(['AAA', 'BEB', 'CCC'], { A: 'milk_bucket', B: 'sugar', E: 'egg', C: 'wheat' });
    expect(g.recipe?.result.item).toBe('cake');
    g.consume();
    expect(g.slots.slice(0, 3).map((s) => s?.id)).toEqual(['bucket', 'bucket', 'bucket']);
    expect(g.slots.slice(3).every((s) => s === null)).toBe(true);
  });

  it('cuisson : expérience et postes (haut fourneau, fumoir)', () => {
    expect(RecipeRegistry.smeltingFor('ancient_debris')?.xp).toBe(2);
    expect(RecipeRegistry.smeltingFor('clay')?.xp).toBe(0.35);
    expect(RecipeRegistry.smeltingFor('deepslate_diamond_ore')?.xp).toBe(1);
    expect(RecipeRegistry.smeltingFor('iron_pickaxe')?.result).toBe('iron_nugget');
    expect(RecipeRegistry.smeltingFor('stripped_cherry_log')?.result).toBe('charcoal');
    expect(RecipeRegistry.smeltingFor('raw_iron', 'blast_furnace')).toBeDefined();
    expect(RecipeRegistry.smeltingFor('beef', 'blast_furnace')).toBeUndefined();
    expect(RecipeRegistry.smeltingFor('beef', 'smoker')).toBeDefined();
    expect(RecipeRegistry.smeltingFor('sand', 'smoker')).toBeUndefined();
    // haut fourneau : 5 s par objet au lieu de 10
    const f = { ...newFurnace(), kind: 'blast_furnace' as const, input: makeStack('raw_iron', 2), fuel: makeStack('coal', 1) };
    for (let t = 0; t < 5.2; t += 0.1) tickFurnace(f, 0.1);
    expect(f.output?.id).toBe('iron_ingot');
    expect(f.output?.count).toBe(1);
  });

  // ---- couverture des recettes officielles (bedrock-samples), si présentes sur la machine ----
  const DIR = '/home/user/mojang/bedrock-samples/behavior_pack/recipes';
  it.skipIf(!existsSync(DIR))('chaque recette officielle d’un objet existant est fabricable', () => {
    const ALIAS: Record<string, string> = {
      brick_block: 'bricks', carrotonastick: 'carrot_on_a_stick', darkoak_sign: 'dark_oak_sign', emptymap: 'map', end_bricks: 'end_stone_bricks',
      end_brick_stairs: 'end_stone_brick_stairs', ender_chest: 'ender_chest_block', fence_gate: 'oak_fence_gate', frame: 'item_frame', glow_frame: 'glow_item_frame',
      golden_rail: 'powered_rail', hardened_clay: 'terracotta', horsearmorleather: 'leather_horse_armor', lit_pumpkin: 'jack_o_lantern', melon_block: 'melon',
      melon: 'melon_slice', netherbrick: 'nether_brick', netherstar: 'nether_star', normal_stone_stairs: 'stone_stairs', stone_stairs: 'cobblestone_stairs',
      prismarine_bricks_stairs: 'prismarine_brick_stairs', red_nether_brick: 'red_nether_bricks', reeds: 'sugar_cane', sealantern: 'sea_lantern', sign: 'oak_sign',
      slime: 'slime_block', snow: 'snow_block', speckled_melon: 'glistering_melon_slice', stonecutter_block: 'stonecutter', undyed_shulker_box: 'shulker_box', web: 'cobweb',
      wooden_door: 'oak_door', record_5: 'music_disc_5', chain: 'iron_chain', boat: 'oak_boat', chest_boat: 'oak_chest_boat', chorus_fruit_popped: 'popped_chorus_fruit',
      muttonCooked: 'cooked_mutton', nether_brick: 'nether_bricks', cooked_fish: 'cooked_cod', appleenchanted: 'enchanted_golden_apple',
    };
    const DYE = ['ink_sac', 'red_dye', 'green_dye', 'cocoa_beans', 'lapis_lazuli', 'purple_dye', 'cyan_dye', 'light_gray_dye', 'gray_dye', 'pink_dye', 'lime_dye', 'yellow_dye', 'light_blue_dye', 'magenta_dye', 'orange_dye', 'bone_meal', 'black_dye', 'brown_dye', 'blue_dye', 'white_dye'];
    const TAG_FIRST: Record<string, string> = { planks: 'oak_planks', logs: 'oak_log', wooden_slabs: 'oak_slab', coals: 'coal', wool: 'white_wool', stone_crafting_materials: 'cobblestone', stone_tool_materials: 'cobblestone', soul_fire_base_blocks: 'soul_sand', egg: 'egg', mushrooms_for_stew: 'brown_mushroom' };
    /** Recettes propres à Bedrock (voir src/data/vanillaRecipes.ts). */
    const BEDROCK_ONLY = /_from_ink_sac|_from_lapis_lazuli|_from_cocoa_beans|_from_bone_meal|bonemeal|_ink_white|_lapis_|_from_(crimson|warped|mangrove)_(slab|planks)|enhanced|^map\.json|^lead\.json|cobweb_to_string|^name_tag|stairs_from_chiseled|stairs_from_cut|^suspicious_stew|^tripwire_hook_from|^mushroom_stew/;
    const norm = (ref: unknown): string | null => {
      const o = (typeof ref === 'string' ? { item: ref } : ref) as { item?: string; tag?: string; data?: number };
      if (o.tag) return TAG_FIRST[o.tag.replace('minecraft:', '')] ?? null;
      let id = o.item!.replace('minecraft:', '');
      let data = o.data;
      const m = id.match(/^(.*):(\d+)$/);
      if (m) [id, data] = [m[1], Number(m[2])];
      if (id === 'dye') return DYE[data ?? 0];
      if (id === 'coal' && data === 1) return 'charcoal';
      if (id === 'bucket' && data === 1) return 'milk_bucket';
      if (id === 'quartz_block' && data === 2) return 'quartz_pillar';
      return ALIAS[id] ?? id;
    };
    const bad: string[] = [];
    let checked = 0;
    for (const f of readdirSync(DIR)) {
      if (BEDROCK_ONLY.test(f)) continue;
      const j = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
      const type = Object.keys(j).find((k) => k.startsWith('minecraft:recipe'))!;
      const r = j[type];
      if (!(r.tags ?? []).includes('crafting_table') || !/shaped|shapeless/.test(type)) continue;
      const res = Array.isArray(r.result) ? r.result[0] : r.result;
      const result = norm(res)!;
      if (!ItemRegistry.has(result)) continue;
      const g = new CraftingGrid(3);
      let ok = true;
      if (r.pattern) {
        (r.pattern as string[]).forEach((row, y) =>
          [...row].forEach((ch, x) => {
            if (ch === ' ') return;
            const id = norm(r.key[ch]);
            if (!id || !ItemRegistry.has(id)) ok = false;
            else g.slots[y * 3 + x] = makeStack(id, 1);
          }),
        );
      } else {
        const ings = (r.ingredients as { count?: number }[]).flatMap((x) => Array(x.count ?? 1).fill(x));
        ings.forEach((x, i) => {
          const id = norm(x);
          if (!id || !ItemRegistry.has(id)) ok = false;
          else g.slots[i] = makeStack(id, 1);
        });
      }
      if (!ok) continue; // ingrédient absent de LeCraft
      checked++;
      const m = g.recipe;
      if (m?.result.item !== result || m.result.count !== (res.count ?? 1)) bad.push(`${f} → ${m ? `${m.result.item}×${m.result.count}` : 'rien'} (attendu ${result}×${res.count ?? 1})`);
    }
    expect(checked).toBeGreaterThan(850);
    expect(bad).toEqual([]);
  });
});
