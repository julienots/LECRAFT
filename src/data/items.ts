import type { ItemDef } from '../inventory/Item';
import { BLOCK_DEFS } from './blocks';

/** Blocs non obtenables en tant qu'objet (ou obtenus via un objet dédié). */
const NO_ITEM = new Set(['air', 'water', 'lava', 'bedrock', 'wheat', 'carrots', 'potatoes', 'farmland', 'boss_altar', 'spawner', 'dirt_path', 'snowy_grass_block', 'lit_furnace', 'oak_door', 'red_bed', 'sugar_cane', 'snow', 'amethyst_cluster', 'glow_lichen']);

/** Matériaux d'outils (valeurs du jeu vanilla Java). */
export const MATERIALS = {
  wooden: { name: 'en bois', tier: 1, speed: 2, durability: 59, color: '#a8834b', item: 'tag:planks', dmg: { sword: 4, axe: 7, pickaxe: 2, shovel: 2.5, hoe: 1 }, axeCd: 1.25 },
  stone: { name: 'en pierre', tier: 2, speed: 4, durability: 131, color: '#8a8a8a', item: 'tag:stone_tool', dmg: { sword: 5, axe: 9, pickaxe: 3, shovel: 3.5, hoe: 1 }, axeCd: 1.25 },
  copper: { name: 'en cuivre', tier: 2, speed: 5, durability: 190, color: '#d8844c', item: 'copper_ingot', dmg: { sword: 5, axe: 9, pickaxe: 3, shovel: 3.5, hoe: 1 }, axeCd: 1.25 },
  iron: { name: 'en fer', tier: 3, speed: 6, durability: 250, color: '#e6e6e6', item: 'iron_ingot', dmg: { sword: 6, axe: 9, pickaxe: 4, shovel: 4.5, hoe: 1 }, axeCd: 1.1 },
  golden: { name: 'en or', tier: 1, speed: 12, durability: 32, color: '#fae24a', item: 'gold_ingot', dmg: { sword: 4, axe: 7, pickaxe: 2, shovel: 2.5, hoe: 1 }, axeCd: 1 },
  diamond: { name: 'en diamant', tier: 4, speed: 8, durability: 1561, color: '#4fe0d6', item: 'diamond', dmg: { sword: 7, axe: 9, pickaxe: 5, shovel: 5.5, hoe: 1 }, axeCd: 1 },
} as const;
export type MaterialKey = keyof typeof MATERIALS;

export const TOOL_KINDS = {
  sword: { name: 'Épée', cd: 0.625 },
  pickaxe: { name: 'Pioche', cd: 0.83 },
  axe: { name: 'Hache', cd: 1.25 },
  shovel: { name: 'Pelle', cd: 1 },
  hoe: { name: 'Houe', cd: 0.5 },
} as const;

export const ARMOR = {
  leather: { name: 'en cuir', def: [1, 3, 2, 1], dur: [55, 80, 75, 65], color: '#8a5a32', item: 'leather' },
  iron: { name: 'en fer', def: [2, 6, 5, 2], dur: [165, 240, 225, 195], color: '#e6e6e6', item: 'iron_ingot' },
  golden: { name: 'en or', def: [2, 5, 3, 1], dur: [77, 112, 105, 91], color: '#fae24a', item: 'gold_ingot' },
  diamond: { name: 'en diamant', def: [3, 8, 6, 3], dur: [363, 528, 495, 429], color: '#4fe0d6', item: 'diamond' },
} as const;
export type ArmorMaterial = keyof typeof ARMOR;
export const ARMOR_PIECES = [
  { slot: 'head', key: 'helmet', name: 'Casque', fem: false },
  { slot: 'chest', key: 'chestplate', name: 'Plastron', fem: false },
  { slot: 'legs', key: 'leggings', name: 'Jambières', fem: true },
  { slot: 'feet', key: 'boots', name: 'Bottes', fem: true },
] as const;

const sprite = (s: string, ...colors: string[]) => ({ sprite: s, colors });
const food = (key: string, name: string, s: { sprite: string; colors: string[] }, hunger: number, saturation: number, extra: Partial<ItemDef> = {}): ItemDef => ({ key, name, icon: s, food: { hunger, saturation }, tab: 'food', ...extra });

export const ITEM_DEFS: ItemDef[] = [
  // --- ingrédients ---
  { key: 'stick', name: 'Bâton', icon: sprite('stick', '#8a6a3c'), burnTime: 5, tab: 'ingredients' },
  { key: 'coal', name: 'Charbon', icon: sprite('lump', '#2a2a2a', '#4a4a4a'), burnTime: 80, tab: 'ingredients' },
  { key: 'charcoal', name: 'Charbon de bois', icon: sprite('lump', '#3a2e24', '#5a4a3a'), burnTime: 80, tab: 'ingredients' },
  { key: 'raw_iron', name: 'Fer brut', icon: sprite('raw', '#d8af93', '#f0d4b8'), tab: 'ingredients' },
  { key: 'iron_ingot', name: 'Lingot de fer', icon: sprite('ingot', '#d8d8d8', '#ffffff'), tab: 'ingredients' },
  { key: 'iron_nugget', name: 'Pépite de fer', icon: sprite('nugget', '#d8d8d8', '#ffffff'), tab: 'ingredients' },
  { key: 'raw_gold', name: 'Or brut', icon: sprite('raw', '#f2c530', '#fff58a'), tab: 'ingredients' },
  { key: 'gold_ingot', name: "Lingot d'or", icon: sprite('ingot', '#fae24a', '#fffbc8'), tab: 'ingredients' },
  { key: 'gold_nugget', name: "Pépite d'or", icon: sprite('nugget', '#fae24a', '#fffbc8'), tab: 'ingredients' },
  { key: 'raw_copper', name: 'Cuivre brut', icon: sprite('raw', '#c56b4b', '#e08b63'), tab: 'ingredients' },
  { key: 'copper_ingot', name: 'Lingot de cuivre', icon: sprite('ingot', '#d8844c', '#f2b080'), tab: 'ingredients' },
  { key: 'diamond', name: 'Diamant', icon: sprite('gem', '#4fe0d6', '#d8fffd'), tab: 'ingredients' },
  { key: 'emerald', name: 'Émeraude', icon: sprite('gem', '#17dd62', '#9dffb8'), tab: 'ingredients' },
  { key: 'lapis_lazuli', name: 'Lapis-lazuli', icon: sprite('lump', '#1f4ea0', '#4b75d0'), tab: 'ingredients' },
  { key: 'redstone', name: 'Poudre de redstone', icon: sprite('dust', '#c81a0a', '#ff4a2a'), tab: 'ingredients' },
  { key: 'amethyst_shard', name: "Éclat d'améthyste", icon: sprite('gem', '#a87fe0', '#e8d8ff'), tab: 'ingredients' },
  { key: 'flint', name: 'Silex', icon: sprite('lump', '#2e2e32', '#5a5a62'), tab: 'ingredients' },
  { key: 'leather', name: 'Cuir', icon: sprite('leather', '#8a5a32', '#a8743f'), tab: 'ingredients' },
  { key: 'feather', name: 'Plume', icon: sprite('feather', '#f0f0f0', '#c8c8c8'), tab: 'ingredients' },
  { key: 'bone', name: 'Os', icon: sprite('bone', '#e8e4d4', '#bab49c'), tab: 'ingredients' },
  { key: 'bone_meal', name: "Poudre d'os", icon: sprite('dust', '#e8e8f0', '#ffffff'), use: 'bone_meal', tab: 'ingredients' },
  { key: 'string', name: 'Ficelle', icon: sprite('string', '#e8e8e8'), tab: 'ingredients' },
  { key: 'slime_ball', name: 'Boule de slime', icon: sprite('ball', '#6ad850', '#a8f890'), tab: 'ingredients' },
  { key: 'clay_ball', name: "Boule d'argile", icon: sprite('ball', '#a0a6b4', '#c0c8d4'), tab: 'ingredients' },
  { key: 'brick', name: 'Brique', icon: sprite('ingot', '#a8503a', '#c87a5a'), tab: 'ingredients' },
  { key: 'paper', name: 'Papier', icon: sprite('paper', '#f0f0e8', '#d8d8c8'), tab: 'ingredients' },
  { key: 'book', name: 'Livre', icon: sprite('book', '#7a4a22', '#f0f0e8'), tab: 'ingredients' },
  { key: 'sugar', name: 'Sucre', icon: sprite('dust', '#f4f4f4', '#ffffff'), tab: 'ingredients' },
  { key: 'gunpowder', name: 'Poudre à canon', icon: sprite('dust', '#5a5a5a', '#8a8a8a'), tab: 'ingredients' },
  { key: 'egg', name: 'Œuf', icon: sprite('egg', '#e8dcc0', '#f8f0e0'), maxStack: 16, tab: 'ingredients' },
  { key: 'wheat', name: 'Blé', icon: sprite('wheat', '#d8c050', '#a89030'), tab: 'ingredients' },
  { key: 'wheat_seeds', name: 'Graines de blé', icon: sprite('seeds', '#5a9a2a', '#c8d870'), use: 'plant', plants: 'wheat', tab: 'nature' },
  { key: 'sugar_cane', name: 'Canne à sucre', icon: { tile: 'sugar_cane' }, place: 'sugar_cane', tab: 'nature' },
  { key: 'spider_eye', name: "Œil d'araignée", icon: sprite('eye', '#8a1a2a', '#e04a5a'), food: { hunger: 2, saturation: 3.2 }, tab: 'food' },
  { key: 'snowball', name: 'Boule de neige', icon: sprite('ball', '#f0f8ff', '#ffffff'), maxStack: 16, use: 'throw', projectile: 'minecraft:snowball', tab: 'combat' },
  { key: 'arrow', name: 'Flèche', icon: sprite('arrow', '#8a6a3c', '#5a5a64', '#f0f0f0'), tab: 'combat' },
  // --- nourriture ---
  food('apple', 'Pomme', sprite('apple', '#d8241c', '#4f8a2c'), 4, 2.4),
  food('golden_apple', 'Pomme dorée', sprite('apple', '#f6d03d', '#4f8a2c'), 4, 9.6, { food: { hunger: 4, saturation: 9.6, effect: 'regen' }, rare: true }),
  food('bread', 'Pain', sprite('bread', '#b8802a', '#e0b060'), 5, 6),
  food('carrot', 'Carotte', sprite('carrot', '#f08a24', '#4f9a2c'), 3, 3.6, { use: 'plant', plants: 'carrots' }),
  food('potato', 'Pomme de terre', sprite('potato', '#c8a050', '#e0c070'), 1, 0.6, { use: 'plant', plants: 'potatoes' }),
  food('baked_potato', 'Pomme de terre cuite', sprite('potato', '#c8802a', '#f0c060'), 5, 6),
  food('beef', 'Bœuf cru', sprite('meat', '#d8584a', '#f0e0e0'), 3, 1.8),
  food('cooked_beef', 'Steak', sprite('meat', '#7a4228', '#f0e0e0'), 8, 12.8),
  food('porkchop', 'Côtelette de porc crue', sprite('meat', '#f0a0a0', '#fff0f0'), 3, 1.8),
  food('cooked_porkchop', 'Côtelette de porc cuite', sprite('meat', '#c8803a', '#fff0d0'), 8, 12.8),
  food('chicken', 'Poulet cru', sprite('poultry', '#f0c0b0', '#f8f0e8'), 2, 1.2),
  food('cooked_chicken', 'Poulet cuit', sprite('poultry', '#c8803a', '#f8f0e8'), 6, 7.2),
  food('mutton', 'Mouton cru', sprite('meat', '#d84a4a', '#f0d0c0'), 2, 1.2),
  food('cooked_mutton', 'Mouton cuit', sprite('meat', '#9a4a2a', '#f0d0c0'), 6, 9.6),
  food('melon_slice', 'Tranche de pastèque', sprite('slice', '#e03a3a', '#5a9a2a'), 2, 1.2),
  food('poisonous_potato', 'Pomme de terre empoisonnée', sprite('potato', '#a8b040', '#c8d060'), 2, 1.2),
  food('rotten_flesh', 'Chair putréfiée', sprite('meat', '#8a6a3a', '#5a8a3a'), 4, 0.8),
  // --- outils & divers ---
  { key: 'bow', name: 'Arc', icon: sprite('bow', '#8a6a3c', '#e8e8e8'), maxStack: 1, use: 'shoot', damage: 1, tool: { type: 'sword', tier: 0, speed: 1, durability: 384, material: 'wood' }, tab: 'combat' },
  { key: 'shears', name: 'Cisailles', icon: sprite('shears', '#d8d8d8', '#5a5a5a'), maxStack: 1, use: 'shear', tool: { type: 'shears', tier: 2, speed: 5, durability: 238, material: 'iron' }, tab: 'tools' },
  { key: 'flint_and_steel', name: 'Briquet', icon: sprite('flint_steel', '#8a8a8a', '#3a3a3a'), maxStack: 1, use: 'ignite', tool: { type: 'sword', tier: 0, speed: 1, durability: 64, material: 'iron' }, tab: 'tools' },
  { key: 'bucket', name: 'Seau', icon: sprite('bucket', '#c8c8c8', '#5a5a5a'), maxStack: 16, use: 'bucket', tab: 'tools' },
  { key: 'water_bucket', name: "Seau d'eau", icon: sprite('bucket', '#c8c8c8', '#3f76e4'), maxStack: 1, use: 'water_bucket', tab: 'tools' },
  { key: 'lava_bucket', name: 'Seau de lave', icon: sprite('bucket', '#c8c8c8', '#ff7a1a'), maxStack: 1, use: 'lava_bucket', burnTime: 1000, tab: 'tools' },
  { key: 'milk_bucket', name: 'Seau de lait', icon: sprite('bucket', '#c8c8c8', '#f8f8f8'), maxStack: 1, use: 'milk', tab: 'food' },
  { key: 'compass', name: 'Boussole', icon: sprite('compass', '#7a7a7a', '#d81a1a'), maxStack: 1, use: 'spawn_compass', tab: 'tools', description: 'Indique le point d’apparition.' },
  { key: 'oak_door', name: 'Porte en chêne', icon: sprite('door', '#9c7a4a', '#c8e0e8'), place: 'oak_door', maxStack: 64, burnTime: 10, tab: 'building' },
  { key: 'red_bed', name: 'Lit rouge', icon: sprite('bed', '#a12722', '#e8e8e8'), place: 'red_bed', maxStack: 1, tab: 'functional' },
  // --- objets des boss (contenu propre à LeCraft) ---
  { key: 'golem_core', name: 'Cœur de golem', icon: sprite('core', '#7a7b80', '#ff9a3a'), rare: true, tab: 'ingredients', description: 'Sert à fabriquer la boussole du givre et la masse du golem.' },
  { key: 'frost_heart', name: 'Cœur de givre', icon: sprite('core', '#86b4e8', '#e0f4ff'), rare: true, tab: 'ingredients' },
  { key: 'golem_mace', name: 'Masse du golem', icon: sprite('mace', '#7a7b80', '#5a4a3a', '#ff9a3a'), maxStack: 1, damage: 11, attackCooldown: 1.1, tool: { type: 'sword', tier: 0, speed: 1, durability: 900, material: 'golem' }, rare: true, tab: 'combat', description: 'Repousse violemment les ennemis.' },
  { key: 'frost_scepter', name: 'Sceptre de givre', icon: sprite('scepter', '#86b4e8', '#e0f4ff', '#6a5a8a'), maxStack: 1, use: 'cast', damage: 6, tool: { type: 'sword', tier: 0, speed: 1, durability: 250, material: 'frost' }, rare: true, tab: 'combat', description: 'Lance des éclats de glace.' },
  { key: 'compass_golem', name: 'Boussole des profondeurs', icon: sprite('compass', '#7a7b80', '#ff9a3a'), maxStack: 1, use: 'compass', target: 'golem_lair', tab: 'tools', description: 'Indique le repaire du Golem.' },
  { key: 'compass_lich', name: 'Boussole du givre', icon: sprite('compass', '#86b4e8', '#e0f4ff'), maxStack: 1, use: 'compass', target: 'ice_temple', tab: 'tools', description: 'Indique le sanctuaire de la Liche.' },
  { key: 'ancient_relic', name: 'Relique ancienne', icon: sprite('relic', '#f8d848', '#7a40c0'), rare: true, tab: 'ingredients' },
];

// --- outils et armes (matrice matériaux × types) ---
for (const [mk, m] of Object.entries(MATERIALS))
  for (const [tk, t] of Object.entries(TOOL_KINDS)) {
    ITEM_DEFS.push({
      key: `${mk}_${tk}`,
      name: `${t.name} ${m.name}`,
      icon: sprite(tk, m.color, '#6b4f2c'),
      maxStack: 1,
      tool: { type: tk as keyof typeof TOOL_KINDS, tier: m.tier, speed: m.speed, durability: m.durability, material: mk },
      damage: m.dmg[tk as keyof typeof m.dmg],
      attackCooldown: tk === 'axe' ? m.axeCd : t.cd,
      use: tk === 'hoe' ? 'till' : undefined,
      bonusVs: mk === 'golden' ? { liche: 2 } : undefined,
      burnTime: mk === 'wooden' ? 10 : undefined,
      tab: tk === 'sword' ? 'combat' : 'tools',
    });
  }
for (const [mk, m] of Object.entries(ARMOR))
  ARMOR_PIECES.forEach((p, i) => {
    ITEM_DEFS.push({
      key: `${mk}_${p.key}`,
      name: `${p.name} ${m.name}`,
      icon: sprite(p.key, m.color),
      maxStack: 1,
      armor: { slot: p.slot, defense: m.def[i], durability: m.dur[i], material: mk },
      tab: 'combat',
    });
  });

// --- objets-blocs (un par bloc posable) ---
/** Durée de combustion (s) des blocs en bois (valeurs vanilla). */
function burnOf(key: string): number | undefined {
  if (key === 'coal_block') return 800;
  if (key.endsWith('_sapling')) return 5;
  if (key === 'oak_slab') return 7.5;
  if (/stone|cobble|brick/.test(key)) return undefined;
  if (/(_planks|_log|_stairs|_fence|crafting_table|bookshelf|chest|ladder)$/.test(key)) return 15;
  if (key.endsWith('_wool')) return 5;
  return undefined;
}
for (const b of BLOCK_DEFS) {
  if (NO_ITEM.has(b.key)) continue;
  const flat = b.render === 'cross' || b.shape === 'torch' || b.shape === 'ladder' || b.shape === 'pane' || b.shape === 'lantern';
  const tab: ItemDef['tab'] = /sapling|leaves|flower|grass|fern|mushroom|dandelion|poppy|cornflower|daisy|bush|cactus|pumpkin|melon|dirt|sand|gravel|clay|ore|log|snow|ice|moss|mud|podzol/.test(b.key)
    ? 'nature'
    : /crafting|furnace|chest|torch|lantern|ladder|tnt|bookshelf|plate/.test(b.key)
      ? 'functional'
      : 'building';
  ITEM_DEFS.push({
    key: b.key,
    name: b.name,
    icon: flat ? { tile: b.textures?.all ?? b.key } : { block: b.key },
    place: b.key,
    burnTime: burnOf(b.key),
    tab,
  });
}
