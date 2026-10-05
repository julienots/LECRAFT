import type { ItemDef } from '../inventory/Item';
import { BLOCK_DEFS } from './blocks';

/** Blocs non obtenables en tant qu'objet. */
const NO_ITEM = new Set(['air', 'water', 'lava', 'bedrock', 'wheat', 'carrots', 'farmland', 'boss_altar', 'spawner', 'dirt_path', 'snowy_grass']);

export const MATERIALS = {
  wood: { name: 'en bois', tier: 1, speed: 2, durability: 60, dmg: 0, color: '#b58a52', item: 'planks' },
  stone: { name: 'en pierre', tier: 2, speed: 4, durability: 132, dmg: 1, color: '#8a8b90', item: 'cobblestone' },
  copper: { name: 'en cuivre', tier: 3, speed: 5, durability: 190, dmg: 1.5, color: '#d8844c', item: 'copper_ingot' },
  iron: { name: 'en fer', tier: 4, speed: 6, durability: 250, dmg: 2, color: '#e0e0e6', item: 'iron_ingot' },
  gold: { name: 'en or', tier: 2, speed: 11, durability: 45, dmg: 0.5, color: '#f8d848', item: 'gold_ingot' },
  aurite: { name: "en aurite", tier: 5, speed: 9, durability: 1600, dmg: 4, color: '#b070ff', item: 'aurite_ingot' },
} as const;
export type MaterialKey = keyof typeof MATERIALS;

const TOOL_KINDS = {
  pickaxe: { name: 'Pioche', base: 2, cd: 0.6 },
  axe: { name: 'Hache', base: 4, cd: 0.9 },
  shovel: { name: 'Pelle', base: 1.5, cd: 0.6 },
  hoe: { name: 'Houe', base: 1, cd: 0.4 },
  sword: { name: 'Épée', base: 4, cd: 0.5 },
} as const;

const ARMOR = {
  leather: { name: 'en cuir', def: [1, 3, 2, 1], dur: 80, color: '#8a5a32', item: 'leather' },
  iron: { name: 'en fer', def: [2, 6, 5, 2], dur: 240, color: '#e0e0e6', item: 'iron_ingot' },
  gold: { name: 'en or', def: [2, 5, 3, 1], dur: 110, color: '#f8d848', item: 'gold_ingot' },
  aurite: { name: "en aurite", def: [3, 8, 6, 3], dur: 600, color: '#b070ff', item: 'aurite_ingot' },
} as const;
export type ArmorMaterial = keyof typeof ARMOR;
const ARMOR_PIECES = [
  { slot: 'head', key: 'helmet', name: 'Casque', cost: 5 },
  { slot: 'chest', key: 'chestplate', name: 'Plastron', cost: 8 },
  { slot: 'legs', key: 'leggings', name: 'Jambières', cost: 7 },
  { slot: 'feet', key: 'boots', name: 'Bottes', cost: 4 },
] as const;

const sprite = (s: string, ...colors: string[]) => ({ sprite: s, colors });

export const ITEM_DEFS: ItemDef[] = [
  // --- matériaux ---
  { key: 'stick', name: 'Bâton', icon: sprite('stick', '#8a6a3c'), fuel: 1 },
  { key: 'coal', name: 'Charbon', icon: sprite('lump', '#2a2a30', '#4a4a52'), fuel: 8 },
  { key: 'charcoal', name: 'Charbon de bois', icon: sprite('lump', '#3a2e24', '#5a4a3a'), fuel: 8 },
  { key: 'raw_copper', name: 'Cuivre brut', icon: sprite('raw', '#c26b3c', '#4fb59a') },
  { key: 'copper_ingot', name: 'Lingot de cuivre', icon: sprite('ingot', '#d8844c', '#f0b080') },
  { key: 'raw_iron', name: 'Fer brut', icon: sprite('raw', '#c8a88c', '#e8d0b8') },
  { key: 'iron_ingot', name: 'Lingot de fer', icon: sprite('ingot', '#d8d8de', '#ffffff') },
  { key: 'raw_gold', name: 'Or brut', icon: sprite('raw', '#e8c030', '#fff0a0') },
  { key: 'gold_ingot', name: "Lingot d'or", icon: sprite('ingot', '#f8d848', '#fff6c0') },
  { key: 'crystal_shard', name: 'Éclat de cristal', icon: sprite('gem', '#62e8f0', '#d0ffff'), rare: true },
  { key: 'raw_aurite', name: 'Aurite brute', icon: sprite('raw', '#9a50e0', '#e0b0ff'), rare: true },
  { key: 'aurite_ingot', name: "Lingot d'aurite", icon: sprite('ingot', '#b070ff', '#f0d0ff'), rare: true },
  { key: 'flint', name: 'Silex', icon: sprite('lump', '#3a3a40', '#6a6a72') },
  { key: 'leather', name: 'Cuir', icon: sprite('leather', '#8a5a32', '#a8743f') },
  { key: 'feather', name: 'Plume', icon: sprite('feather', '#f0f0f0', '#c8c8c8') },
  { key: 'bone', name: 'Os', icon: sprite('bone', '#e8e4d4', '#bab49c') },
  { key: 'string', name: 'Fil', icon: sprite('string', '#e8e8e8') },
  { key: 'slime_ball', name: 'Boule de gelée', icon: sprite('ball', '#6ad850', '#a8f890') },
  { key: 'clay_ball', name: "Boule d'argile", icon: sprite('ball', '#9aa3b0', '#c0c8d4') },
  { key: 'brick', name: 'Brique', icon: sprite('ingot', '#a8503a', '#c87a5a') },
  { key: 'arrow', name: 'Flèche', icon: sprite('arrow', '#8a6a3c', '#5a5a64', '#f0f0f0') },
  { key: 'seeds', name: 'Graines de blé', icon: sprite('seeds', '#7aa040', '#c8d870'), use: 'plant', plants: 'wheat' },
  { key: 'wheat', name: 'Blé', icon: sprite('wheat', '#d8c050', '#a89030') },
  // --- nourriture ---
  { key: 'apple', name: 'Pomme', icon: sprite('apple', '#d83a2e', '#4f8a2c'), food: { hunger: 4, saturation: 2.4 } },
  { key: 'bread', name: 'Pain', icon: sprite('bread', '#c8903a', '#e8b860'), food: { hunger: 5, saturation: 6 } },
  { key: 'carrot', name: 'Carotte', icon: sprite('carrot', '#f08a24', '#4f9a2c'), food: { hunger: 3, saturation: 3.6 }, use: 'plant', plants: 'carrots' },
  { key: 'raw_meat', name: 'Viande crue', icon: sprite('meat', '#e06a6a', '#f0e0e0'), food: { hunger: 3, saturation: 1.8 } },
  { key: 'cooked_meat', name: 'Steak grillé', icon: sprite('meat', '#8a4a2a', '#f0e0e0'), food: { hunger: 8, saturation: 12 } },
  { key: 'raw_poultry', name: 'Volaille crue', icon: sprite('poultry', '#f0c0b0', '#f8f0e8'), food: { hunger: 2, saturation: 1.2 } },
  { key: 'cooked_poultry', name: 'Volaille rôtie', icon: sprite('poultry', '#c8803a', '#f8f0e8'), food: { hunger: 6, saturation: 7 } },
  // --- armes spéciales & objets rares ---
  { key: 'bow', name: 'Arc', icon: sprite('bow', '#8a6a3c', '#e8e8e8'), maxStack: 1, use: 'shoot', damage: 1, tool: { type: 'sword', tier: 0, speed: 1, durability: 300, material: 'wood' } },
  { key: 'golem_core', name: 'Cœur de golem', icon: sprite('core', '#7a7b80', '#ff9a3a'), rare: true, description: 'Battement de pierre ancienne. Sert à fabriquer la boussole du givre et la masse du golem.' },
  { key: 'frost_heart', name: 'Cœur de givre', icon: sprite('core', '#86b4e8', '#e0f4ff'), rare: true, description: 'Froid éternel de la Liche.' },
  { key: 'golem_mace', name: 'Masse du golem', icon: sprite('mace', '#7a7b80', '#5a4a3a', '#ff9a3a'), maxStack: 1, damage: 11, attackCooldown: 1.1, tool: { type: 'sword', tier: 0, speed: 1, durability: 900, material: 'golem' }, rare: true, description: 'Repousse violemment les ennemis.' },
  { key: 'frost_scepter', name: 'Sceptre de givre', icon: sprite('scepter', '#86b4e8', '#e0f4ff', '#6a5a8a'), maxStack: 1, use: 'cast', damage: 6, tool: { type: 'sword', tier: 0, speed: 1, durability: 250, material: 'frost' }, rare: true, description: 'Lance des éclats de glace.' },
  { key: 'compass_golem', name: 'Boussole des profondeurs', icon: sprite('compass', '#7a7b80', '#ff9a3a'), maxStack: 1, use: 'compass', target: 'golem_lair', description: 'Indique le repaire du Golem.' },
  { key: 'compass_lich', name: 'Boussole du givre', icon: sprite('compass', '#86b4e8', '#e0f4ff'), maxStack: 1, use: 'compass', target: 'ice_temple', description: 'Indique le sanctuaire de la Liche.' },
  { key: 'compass_village', name: 'Boussole du voyageur', icon: sprite('compass', '#b58a52', '#d83a2e'), maxStack: 1, use: 'compass', target: 'village', description: 'Indique le village le plus proche.' },
  { key: 'ancient_relic', name: 'Relique ancienne', icon: sprite('relic', '#f8d848', '#7a40c0'), rare: true, description: 'Objet de collection trouvé dans les donjons.' },
];

// --- outils et armes générés à partir de la matrice matériaux x types ---
for (const [mk, m] of Object.entries(MATERIALS))
  for (const [tk, t] of Object.entries(TOOL_KINDS)) {
    ITEM_DEFS.push({
      key: `${mk}_${tk}`,
      name: `${t.name} ${m.name}`,
      icon: sprite(tk, m.color, '#8a6a3c'),
      maxStack: 1,
      tool: { type: tk as keyof typeof TOOL_KINDS, tier: m.tier, speed: m.speed, durability: m.durability, material: mk },
      damage: t.base + m.dmg,
      attackCooldown: t.cd,
      use: tk === 'hoe' ? 'till' : undefined,
      bonusVs: mk === 'gold' ? { liche: 2 } : undefined,
      fuel: mk === 'wood' ? 2 : undefined,
    });
  }
for (const [mk, m] of Object.entries(ARMOR))
  ARMOR_PIECES.forEach((p, i) => {
    ITEM_DEFS.push({
      key: `${mk}_${p.key}`,
      name: `${p.name} ${m.name}`,
      icon: sprite(p.key, m.color, '#00000000'),
      maxStack: 1,
      armor: { slot: p.slot, defense: m.def[i], durability: m.dur, material: mk },
    });
  });

// --- objets-blocs (un par bloc posable) ---
for (const b of BLOCK_DEFS) {
  if (NO_ITEM.has(b.key)) continue;
  ITEM_DEFS.push({
    key: b.key,
    name: b.name,
    icon: { block: b.key },
    place: b.key,
    fuel: b.key.endsWith('log') ? 2 : b.key === 'planks' || b.key === 'crafting_table' || b.key === 'bookshelf' ? 2 : b.key === 'sapling' ? 1 : undefined,
  });
}

export { ARMOR, ARMOR_PIECES, TOOL_KINDS };
