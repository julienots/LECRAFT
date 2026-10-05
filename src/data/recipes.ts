import type { Recipe, Station } from '../crafting/Recipe';
import { ARMOR, ARMOR_PIECES, MATERIALS } from './items';

const r = (item: string, count: number, station: Station, ...ing: [string, number][]): Recipe => ({
  id: `${item}@${station}${ing.map((i) => i[0]).join('+')}`,
  result: { item, count },
  ingredients: ing.map(([i, c]) => ({ item: i, count: c })),
  station,
  fuel: station === 'furnace' ? 1 : undefined,
});

/** Tags : groupes d'objets interchangeables dans les recettes. */
export const TAGS: Record<string, string[]> = {
  log: ['log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log'],
  coal: ['coal', 'charcoal'],
};

export const RECIPE_DEFS: Recipe[] = [
  // à la main
  r('planks', 4, 'hand', ['tag:log', 1]),
  r('stick', 4, 'hand', ['planks', 2]),
  r('crafting_table', 1, 'hand', ['planks', 4]),
  r('torch', 4, 'hand', ['stick', 1], ['tag:coal', 1]),
  // établi : blocs
  r('furnace', 1, 'table', ['cobblestone', 8]),
  r('chest', 1, 'table', ['planks', 8]),
  r('stone_bricks', 4, 'table', ['stone', 4]),
  r('bricks', 1, 'table', ['brick', 4]),
  r('sandstone', 1, 'table', ['sand', 4]),
  r('mossy_cobble', 1, 'table', ['cobblestone', 1], ['moss', 1]),
  r('bookshelf', 1, 'table', ['planks', 6], ['leather', 3]),
  r('lantern', 1, 'table', ['iron_ingot', 1], ['torch', 1]),
  r('hay', 1, 'table', ['wheat', 9]),
  r('wheat', 9, 'hand', ['hay', 1]),
  r('wool', 1, 'table', ['string', 4]),
  r('iron_block', 1, 'table', ['iron_ingot', 9]),
  r('gold_block', 1, 'table', ['gold_ingot', 9]),
  r('aurite_block', 1, 'table', ['aurite_ingot', 9]),
  r('crystal_block', 1, 'table', ['crystal_shard', 4]),
  r('glass', 1, 'furnace', ['sand', 1]),
  // établi : objets
  r('bread', 1, 'table', ['wheat', 3]),
  r('bow', 1, 'table', ['stick', 3], ['string', 3]),
  r('arrow', 4, 'table', ['flint', 1], ['stick', 1], ['feather', 1]),
  r('compass_village', 1, 'table', ['iron_ingot', 2], ['copper_ingot', 2]),
  r('compass_golem', 1, 'table', ['iron_ingot', 4], ['crystal_shard', 1]),
  r('compass_lich', 1, 'table', ['golem_core', 1], ['iron_ingot', 4]),
  r('golem_mace', 1, 'table', ['golem_core', 1], ['iron_block', 1], ['stick', 2]),
  // four
  r('iron_ingot', 1, 'furnace', ['raw_iron', 1]),
  r('copper_ingot', 1, 'furnace', ['raw_copper', 1]),
  r('gold_ingot', 1, 'furnace', ['raw_gold', 1]),
  r('aurite_ingot', 1, 'furnace', ['raw_aurite', 1]),
  r('stone', 1, 'furnace', ['cobblestone', 1]),
  r('cooked_meat', 1, 'furnace', ['raw_meat', 1]),
  r('cooked_poultry', 1, 'furnace', ['raw_poultry', 1]),
  r('brick', 1, 'furnace', ['clay_ball', 1]),
  r('charcoal', 1, 'furnace', ['tag:log', 1]),
];

// outils (matrice matériaux)
const TOOL_SHAPES: Record<string, [number, number]> = { pickaxe: [3, 2], axe: [3, 2], shovel: [1, 2], hoe: [2, 2], sword: [2, 1] };
for (const [mk, m] of Object.entries(MATERIALS))
  for (const [tk, [mat, sticks]] of Object.entries(TOOL_SHAPES)) {
    const ing: [string, number][] = [[m.item, mat], ['stick', sticks]];
    if (mk === 'aurite') ing.push(['crystal_shard', 1]);
    RECIPE_DEFS.push(r(`${mk}_${tk}`, 1, mk === 'wood' ? 'hand' : 'table', ...ing));
  }
for (const [mk, m] of Object.entries(ARMOR)) for (const p of ARMOR_PIECES) RECIPE_DEFS.push(r(`${mk}_${p.key}`, 1, 'table', [m.item, p.cost]));
