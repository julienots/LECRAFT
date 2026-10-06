import type { CraftingRecipe, SmeltingRecipe } from '../crafting/Recipe';
import { ARMOR, ARMOR_PIECES, MATERIALS } from './items';
import { WOOL_COLORS } from './blocks';

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];

/** Tags : groupes d'objets interchangeables dans les recettes. */
export const TAGS: Record<string, string[]> = {
  planks: WOODS.map((w) => `${w}_planks`),
  logs: WOODS.map((w) => `${w}_log`),
  wool: WOOL_COLORS.map(([c]) => `${c}_wool`),
  coals: ['coal', 'charcoal'],
  stone_tool: ['cobblestone'],
};

let n = 0;
/** Recette avec motif. */
function shaped(item: string, count: number, pattern: string[], key: Record<string, string>): CraftingRecipe {
  return { id: `${item}#${n++}`, type: 'shaped', result: { item, count }, pattern, key, width: Math.max(...pattern.map((r) => r.length)), height: pattern.length };
}
/** Recette sans forme. */
function shapeless(item: string, count: number, ...ingredients: string[]): CraftingRecipe {
  const s = ingredients.length <= 4 ? 2 : 3;
  return { id: `${item}#${n++}`, type: 'shapeless', result: { item, count }, ingredients, width: s, height: s };
}

export const CRAFTING_RECIPES: CraftingRecipe[] = [
  ...WOODS.map((w) => shapeless(`${w}_planks`, 4, `${w}_log`)),
  shaped('stick', 4, ['#', '#'], { '#': 'tag:planks' }),
  shaped('crafting_table', 1, ['##', '##'], { '#': 'tag:planks' }),
  shaped('torch', 4, ['C', 'S'], { C: 'tag:coals', S: 'stick' }),
  shaped('furnace', 1, ['###', '# #', '###'], { '#': 'cobblestone' }),
  shaped('chest', 1, ['###', '# #', '###'], { '#': 'tag:planks' }),
  shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' }),
  shaped('oak_door', 3, ['##', '##', '##'], { '#': 'oak_planks' }),
  shaped('oak_fence', 3, ['#S#', '#S#'], { '#': 'oak_planks', S: 'stick' }),
  shaped('oak_slab', 6, ['###'], { '#': 'oak_planks' }),
  shaped('oak_stairs', 4, ['#  ', '## ', '###'], { '#': 'oak_planks' }),
  shaped('cobblestone_slab', 6, ['###'], { '#': 'cobblestone' }),
  shaped('cobblestone_stairs', 4, ['#  ', '## ', '###'], { '#': 'cobblestone' }),
  shaped('stone_slab', 6, ['###'], { '#': 'stone' }),
  shaped('stone_bricks', 4, ['##', '##'], { '#': 'stone' }),
  shaped('stone_brick_slab', 6, ['###'], { '#': 'stone_bricks' }),
  shaped('stone_brick_stairs', 4, ['#  ', '## ', '###'], { '#': 'stone_bricks' }),
  shapeless('mossy_cobblestone', 1, 'cobblestone', 'moss_block'),
  shapeless('mossy_stone_bricks', 1, 'stone_bricks', 'moss_block'),
  shaped('bricks', 1, ['##', '##'], { '#': 'brick' }),
  shaped('sandstone', 1, ['##', '##'], { '#': 'sand' }),
  shaped('glass_pane', 16, ['###', '###'], { '#': 'glass' }),
  shaped('white_wool', 1, ['##', '##'], { '#': 'string' }),
  shaped('red_bed', 1, ['WWW', 'PPP'], { W: 'tag:wool', P: 'tag:planks' }),
  shaped('bookshelf', 1, ['###', 'BBB', '###'], { '#': 'tag:planks', B: 'book' }),
  shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }),
  shaped('lantern', 1, ['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'torch' }),
  shaped('hay_block', 1, ['###', '###', '###'], { '#': 'wheat' }),
  shapeless('wheat', 9, 'hay_block'),
  shaped('stone_pressure_plate', 1, ['##'], { '#': 'stone' }),
  shaped('bread', 1, ['###'], { '#': 'wheat' }),
  shapeless('sugar', 1, 'sugar_cane'),
  shaped('paper', 3, ['###'], { '#': 'sugar_cane' }),
  shapeless('book', 1, 'paper', 'paper', 'paper', 'leather'),
  shapeless('bone_meal', 3, 'bone'),
  shaped('bow', 1, [' #S', '# S', ' #S'], { '#': 'stick', S: 'string' }),
  shaped('arrow', 4, ['F', '#', 'P'], { F: 'flint', '#': 'stick', P: 'feather' }),
  shaped('bucket', 1, ['I I', ' I '], { I: 'iron_ingot' }),
  shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' }),
  shapeless('flint_and_steel', 1, 'iron_ingot', 'flint'),
  shaped('compass', 1, [' I ', 'IRI', ' I '], { I: 'iron_ingot', R: 'redstone' }),
  shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' }),
  shaped('iron_nugget', 9, ['#'], { '#': 'iron_ingot' }),
  shaped('iron_ingot', 1, ['###', '###', '###'], { '#': 'iron_nugget' }),
  shaped('gold_nugget', 9, ['#'], { '#': 'gold_ingot' }),
  shaped('gold_ingot', 1, ['###', '###', '###'], { '#': 'gold_nugget' }),
  // boussoles et objets propres à LeCraft (boss)
  shaped('compass_golem', 1, [' I ', 'IDI', ' I '], { I: 'iron_ingot', D: 'amethyst_shard' }),
  shaped('compass_lich', 1, [' I ', 'ICI', ' I '], { I: 'iron_ingot', C: 'golem_core' }),
  shaped('golem_mace', 1, [' C ', ' B ', ' S '], { C: 'golem_core', B: 'iron_block', S: 'stick' }),
];

// blocs de minerais ↔ lingots
for (const [block, item] of [['coal_block', 'coal'], ['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'], ['emerald_block', 'emerald'], ['lapis_block', 'lapis_lazuli'], ['redstone_block', 'redstone'], ['copper_block', 'copper_ingot']] as const) {
  CRAFTING_RECIPES.push(shaped(block, 1, ['###', '###', '###'], { '#': item }));
  CRAFTING_RECIPES.push(shapeless(item, 9, block));
}
// outils
const TOOL_PATTERNS: Record<string, string[]> = {
  pickaxe: ['XXX', ' # ', ' # '],
  axe: ['XX', 'X#', ' #'],
  shovel: ['X', '#', '#'],
  hoe: ['XX', ' #', ' #'],
  sword: ['X', 'X', '#'],
};
for (const [mk, m] of Object.entries(MATERIALS))
  for (const [tk, pat] of Object.entries(TOOL_PATTERNS)) CRAFTING_RECIPES.push(shaped(`${mk}_${tk}`, 1, pat, { X: m.item, '#': 'stick' }));
// armures
const ARMOR_PATTERNS: Record<string, string[]> = {
  helmet: ['XXX', 'X X'],
  chestplate: ['X X', 'XXX', 'XXX'],
  leggings: ['XXX', 'X X', 'X X'],
  boots: ['X X', 'X X'],
};
for (const [mk, m] of Object.entries(ARMOR)) for (const p of ARMOR_PIECES) CRAFTING_RECIPES.push(shaped(`${mk}_${p.key}`, 1, ARMOR_PATTERNS[p.key], { X: m.item }));

const smelt = (input: string, result: string, xp = 0.1): SmeltingRecipe => ({ id: `smelt:${input}`, input, result, xp, time: 10 });
export const SMELTING_RECIPES: SmeltingRecipe[] = [
  smelt('raw_iron', 'iron_ingot', 0.7),
  smelt('raw_gold', 'gold_ingot', 1),
  smelt('raw_copper', 'copper_ingot', 0.7),
  smelt('iron_ore', 'iron_ingot', 0.7),
  smelt('gold_ore', 'gold_ingot', 1),
  smelt('copper_ore', 'copper_ingot', 0.7),
  smelt('sand', 'glass'),
  smelt('cobblestone', 'stone'),
  smelt('stone_bricks', 'cracked_stone_bricks'),
  smelt('clay_ball', 'brick', 0.3),
  smelt('beef', 'cooked_beef', 0.35),
  smelt('porkchop', 'cooked_porkchop', 0.35),
  smelt('chicken', 'cooked_chicken', 0.35),
  smelt('mutton', 'cooked_mutton', 0.35),
  smelt('potato', 'baked_potato', 0.35),
  ...WOODS.map((w) => smelt(`${w}_log`, 'charcoal', 0.15)),
];
