import { describe, expect, it } from 'vitest';
import { EXTRA_BLOCKS, EXTRA_ITEMS, EXTRA_RECIPES, EXTRA_TAGS } from '../src/data/vanillaExtra';
import { BLOCK_DEFS } from '../src/data/blocks';
import { BLOCK_MODELS } from '../src/data/blockModels';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { makeStack } from '../src/inventory/Inventory';
import { RecipeRegistry } from '../src/crafting/RecipeRegistry';
import { CraftingGrid } from '../src/crafting/CraftingSystem';

// contenu supplémentaire enregistré comme au démarrage du jeu (AddonManager.registerExtraContent)
for (const d of EXTRA_BLOCKS) if (!ItemRegistry.has(d.key)) ItemRegistry.register({ key: d.key, name: d.name, icon: { block: d.key }, place: d.key, tab: 'building' });
for (const it of EXTRA_ITEMS) if (!ItemRegistry.has(it.key)) ItemRegistry.register(it);
for (const [t, list] of Object.entries(EXTRA_TAGS)) {
  const cur = (RecipeRegistry.tags as Record<string, string[]>)[t];
  if (cur) for (const k of list) if (!cur.includes(k) && ItemRegistry.has(k)) cur.push(k);
}
const failed: string[] = [];
for (const r of EXTRA_RECIPES) {
  try {
    RecipeRegistry.register(r);
  } catch (e) {
    failed.push(`${r.id}: ${(e as Error).message}`);
  }
}

function grid(rows: string[], key: Record<string, string>) {
  const g = new CraftingGrid(3);
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== ' ' && (g.slots[y * 3 + x] = makeStack(key[ch], 1))));
  return g;
}
const craft = (rows: string[], key: Record<string, string>) => {
  const r = grid(rows, key).recipe;
  return r ? `${r.result.item}×${r.result.count}` : null;
};
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

describe('Objets et recettes de Java 1.21', () => {
  it('toutes les recettes Java s’enregistrent', () => {
    expect(failed.filter((f) => f.startsWith('java:'))).toEqual([]);
  });

  it('objets ajoutés (créatif du jeu original)', () => {
    const keys = [
      'bedrock', 'farmland', 'dirt_path', 'spawner', 'snow', 'amethyst_cluster', 'glow_lichen', 'trapped_chest', 'suspicious_sand', 'suspicious_gravel', 'decorated_pot',
      'skeleton_skull', 'zombie_head', 'creeper_head', 'dragon_head', 'piglin_head', 'player_head', 'recovery_compass', 'tipped_arrow', 'dried_ghast',
      'polished_blackstone_button', 'polished_blackstone_pressure_plate', 'light_weighted_pressure_plate', 'heavy_weighted_pressure_plate', 'petrified_oak_slab',
      'cut_sandstone_slab', 'cut_red_sandstone_slab', 'smooth_red_sandstone_slab', 'smooth_red_sandstone_stairs', 'prismarine_brick_slab', 'prismarine_brick_stairs',
      'resin_brick_slab', 'resin_brick_stairs', 'resin_brick_wall', 'bamboo_mosaic_slab', 'bamboo_mosaic_stairs', 'copper_chest', 'oxidized_copper_chest',
      ...['stone', 'cobblestone', 'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks', 'deepslate'].map((k) => `infested_${k}`),
      ...COLORS.flatMap((c) => [`${c}_bed`, `${c}_banner`]),
    ];
    for (const k of keys) expect(ItemRegistry.has(k), k).toBe(true);
    // toutes les variantes cirées du cuivre
    for (const o of ['', 'exposed_', 'weathered_', 'oxidized_'])
      for (const k of ['cut_copper', 'cut_copper_slab', 'cut_copper_stairs', 'chiseled_copper', 'copper_grate', 'copper_door', 'copper_trapdoor', 'copper_bulb', 'copper_bars', 'copper_chain', 'copper_lantern', 'lightning_rod', 'copper_chest'])
        expect(ItemRegistry.has(`waxed_${o}${k}`), `waxed_${o}${k}`).toBe(true);
    for (const k of ['waxed_copper_block', 'waxed_exposed_copper', 'waxed_weathered_copper', 'waxed_oxidized_copper']) expect(ItemRegistry.has(k), k).toBe(true);
    expect(ItemRegistry.maxStack('white_bed')).toBe(1);
    expect(ItemRegistry.maxStack('blue_banner')).toBe(16);
    expect(ItemRegistry.get('zombie_head')!.tab).toBe('functional');
  });

  it('blocs ajoutés à la fin (identifiants des sauvegardes inchangés)', () => {
    const keys = EXTRA_BLOCKS.map((d) => d.key);
    const first = keys.indexOf('white_bed');
    expect(first).toBeGreaterThan(keys.indexOf('redstone_torch_off'));
    for (const k of ['waxed_copper_block', 'trapped_chest', 'infested_stone']) expect(keys.indexOf(k)).toBeGreaterThan(first);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of EXTRA_BLOCKS) expect(BLOCK_DEFS.some((b) => b.key === d.key), d.key).toBe(false);
    // modèles : cuivre ciré = modèle du cuivre ; bannières, têtes, pot décoré
    expect(BLOCK_MODELS.waxed_copper_lantern).toBe(BLOCK_MODELS.copper_lantern);
    for (const k of ['red_banner', 'player_head', 'decorated_pot']) expect(BLOCK_MODELS[k], k).toBeDefined();
    expect(EXTRA_BLOCKS.find((d) => d.key === 'infested_stone')!.spawnOnBreak).toBe('silverfish');
  });

  it('recettes exactes du jeu original', () => {
    expect(craft(['###', 'XXX'], { '#': 'white_wool', X: 'oak_planks' })).toBe('white_bed×1');
    expect(craft(['###', 'XXX'], { '#': 'red_wool', X: 'birch_planks' })).toBe('red_bed×1');
    expect(craft(['###', 'XXX'], { '#': 'blue_wool', X: 'oak_planks' })).toBe('blue_bed×1');
    expect(craft(['AB'], { A: 'white_bed', B: 'lime_dye' })).toBe('lime_bed×1');
    expect(craft(['###', '###', ' | '], { '#': 'cyan_wool', '|': 'stick' })).toBe('cyan_banner×1');
    expect(craft(['AB'], { A: 'chest', B: 'tripwire_hook' })).toBe('trapped_chest×1');
    expect(craft(['CCC', 'C#C', 'CCC'], { C: 'copper_ingot', '#': 'chest' })).toBe('copper_chest×1');
    expect(craft([' # ', '# #', ' # '], { '#': 'brick' })).toBe('decorated_pot×1');
    expect(craft([' # ', 'B #', ' # '], { '#': 'brick', B: 'archer_pottery_sherd' })).toBe('decorated_pot×1');
    expect(craft(['##'], { '#': 'gold_ingot' })).toBe('light_weighted_pressure_plate×1');
    expect(craft(['##'], { '#': 'iron_ingot' })).toBe('heavy_weighted_pressure_plate×1');
    expect(craft(['#'], { '#': 'polished_blackstone' })).toBe('polished_blackstone_button×1');
    expect(craft(['###'], { '#': 'cut_sandstone' })).toBe('cut_sandstone_slab×6');
    expect(craft(['###'], { '#': 'resin_bricks' })).toBe('resin_brick_slab×6');
    expect(craft(['###', '###'], { '#': 'resin_bricks' })).toBe('resin_brick_wall×6');
    expect(craft(['#  ', '## ', '###'], { '#': 'prismarine_bricks' })).toBe('prismarine_brick_stairs×4');
    expect(craft(['#  ', '## ', '###'], { '#': 'cut_sandstone' })).toBe('sandstone_stairs×4');
    expect(craft(['#', '#'], { '#': 'resin_brick_slab' })).toBe('chiseled_resin_bricks×1');
    expect(craft(['###', '#C#', '###'], { '#': 'echo_shard', C: 'compass' })).toBe('recovery_compass×1');
    expect(craft(['###', '#X#', '###'], { '#': 'ghast_tear', X: 'soul_sand' })).toBe('dried_ghast×1');
    expect(craft(['###'], { '#': 'snow_block' })).toBe('snow×6');
    expect(craft(['~~ ', '~~ ', '  ~'], { '~': 'string' })).toBe('lead×2');
    expect(craft([' #', 'P '], { '#': 'iron_nugget', P: 'paper' })).toBe('name_tag×1');
    expect(craft(['AB', 'BC'], { A: 'blue_dye', B: 'red_dye', C: 'white_dye' })).toBe('magenta_dye×4');
    expect(craft(['AB', 'CD'], { A: 'bowl', B: 'brown_mushroom', C: 'red_mushroom', D: 'cornflower' })).toBe('suspicious_stew×1');
    // cire (rayon de miel) et recettes des blocs cirés
    expect(craft(['AB'], { A: 'exposed_copper_door', B: 'honeycomb' })).toBe('waxed_exposed_copper_door×1');
    expect(craft(['AB'], { A: 'copper_lantern', B: 'honeycomb' })).toBe('waxed_copper_lantern×1');
    expect(craft(['CC', 'CC'], { C: 'waxed_copper_block' })).toBe('waxed_cut_copper×4');
    expect(craft(['###'], { '#': 'waxed_weathered_cut_copper' })).toBe('waxed_weathered_cut_copper_slab×6');
    expect(craft([' C ', 'CBC', ' R '], { C: 'waxed_oxidized_copper', B: 'blaze_rod', R: 'redstone' })).toBe('waxed_oxidized_copper_bulb×4');
    expect(craft(['C'], { C: 'waxed_copper_block' })).toBe('copper_ingot×9');
  });

  it('flèches à effet : la potion persistante donne son effet', () => {
    const g = grid(['AAA', 'APA', 'AAA'], { A: 'arrow', P: 'arrow' });
    g.slots[4] = { id: 'lingering_potion', count: 1, meta: { potion: 'strong_healing' } };
    const out = g.result!;
    expect(`${out.id}×${out.count}`).toBe('tipped_arrow×8');
    expect(out.meta?.potion).toBe('strong_healing');
  });
});
