import { describe, expect, it } from 'vitest';
import { EXTRA_BLOCKS, EXTRA_ITEMS } from '../src/data/vanillaExtra';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { BlockRegistry, B } from '../src/blocks/BlockRegistry';
import { blockXp, breakTime, canHarvest, getDrops } from '../src/blocks/BlockBehaviors';
import { MATERIALS } from '../src/data/items';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';

// blocs supplémentaires enregistrés comme au démarrage (identifiants à la suite des blocs de base)
registerAddonBlocks(EXTRA_BLOCKS);
for (const d of EXTRA_BLOCKS) if (!ItemRegistry.has(d.key)) ItemRegistry.register({ key: d.key, name: d.name, icon: { block: d.key }, place: d.key, tab: 'building' });
for (const it of EXTRA_ITEMS) if (!ItemRegistry.has(it.key)) ItemRegistry.register(it);

const id = (k: string) => BlockRegistry.id(k);
const t = (block: string, item?: string, o: { water?: boolean; air?: boolean; eff?: number } = {}) => breakTime(id(block), item, false, !!o.water, o.eff ?? 0, !!o.air);
/** Générateur pseudo-aléatoire répétable. */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};

describe('Matériaux des outils (jeu original)', () => {
  it('vitesses, usures et tiers', () => {
    const m = Object.fromEntries(Object.entries(MATERIALS).map(([k, v]) => [k, [v.speed, v.durability, v.tier]]));
    expect(m).toMatchObject({ wooden: [2, 59, 1], stone: [4, 131, 2], iron: [6, 250, 3], golden: [12, 32, 1], diamond: [8, 1561, 4], copper: [5, 190, 2] });
    expect(ItemRegistry.get('netherite_pickaxe')?.tool).toMatchObject({ speed: 9, durability: 2031, tier: 4 });
  });
});

describe('Dureté et outil requis', () => {
  it('valeurs du jeu original', () => {
    const h = (k: string) => [BlockRegistry.byName(k).hardness, BlockRegistry.byName(k).tool, BlockRegistry.byName(k).minTier];
    expect(h('stone')).toEqual([1.5, 'pickaxe', 1]);
    expect(h('dirt')).toEqual([0.5, 'shovel', 0]);
    expect(h('oak_log')).toEqual([2, 'axe', 0]);
    expect(h('obsidian')).toEqual([50, 'pickaxe', 4]);
    expect(h('deepslate')).toEqual([3, 'pickaxe', 1]);
    expect(h('coal_ore')).toEqual([3, 'pickaxe', 1]);
    expect(h('iron_ore')).toEqual([3, 'pickaxe', 2]);
    expect(h('diamond_ore')).toEqual([3, 'pickaxe', 3]);
    expect(h('deepslate_coal_ore')).toEqual([4.5, 'pickaxe', 1]);
    expect(h('deepslate_iron_ore')).toEqual([4.5, 'pickaxe', 2]);
    expect(h('deepslate_diamond_ore')).toEqual([4.5, 'pickaxe', 3]);
    expect(h('ancient_debris')).toEqual([30, 'pickaxe', 4]);
    expect(h('lantern')).toEqual([3.5, 'pickaxe', 1]);
    expect(h('enchanting_table')).toEqual([5, 'pickaxe', 1]);
    expect(h('anvil')).toEqual([5, 'pickaxe', 1]);
    expect(h('raw_iron_block')).toEqual([5, 'pickaxe', 2]);
    expect(h('cut_copper')).toEqual([3, 'pickaxe', 2]);
    expect(h('beacon')[0]).toBe(3);
  });
  it('tier minimal pour les drops', () => {
    expect(canHarvest(B.DIAMOND_ORE, 'stone_pickaxe')).toBe(false);
    expect(canHarvest(B.DIAMOND_ORE, 'iron_pickaxe')).toBe(true);
    expect(canHarvest(B.OBSIDIAN, 'iron_pickaxe')).toBe(false);
    expect(canHarvest(B.OBSIDIAN, 'diamond_pickaxe')).toBe(true);
    expect(canHarvest(B.IRON_ORE, 'golden_pickaxe')).toBe(false);
    expect(canHarvest(id('deepslate_gold_ore'), 'stone_pickaxe')).toBe(false);
    expect(canHarvest(B.STONE, undefined)).toBe(false);
    expect(canHarvest(id('cobweb'), 'shears')).toBe(true);
    expect(canHarvest(id('cobweb'), undefined)).toBe(false);
  });
});

describe('Temps de minage (formule du jeu original, arrondi au tick)', () => {
  it('main, bon outil, mauvais tier', () => {
    expect(t('stone')).toBeCloseTo(7.5);
    expect(t('stone', 'wooden_pickaxe')).toBeCloseTo(1.15);
    expect(t('stone', 'golden_pickaxe')).toBeCloseTo(0.2);
    expect(t('dirt')).toBeCloseTo(0.75);
    expect(t('dirt', 'wooden_shovel')).toBeCloseTo(0.4);
    expect(t('oak_log')).toBeCloseTo(3);
    expect(t('obsidian', 'diamond_pickaxe')).toBeCloseTo(9.4);
    expect(t('obsidian', 'iron_pickaxe')).toBeCloseTo(41.7);
    expect(t('cobweb', 'iron_sword')).toBeCloseTo(0.4);
    expect(t('cobweb')).toBeCloseTo(20);
    expect(t('oak_leaves', 'shears')).toBeCloseTo(0.05);
  });
  it('pénalités sous l’eau et en l’air (×5), Efficacité', () => {
    expect(t('stone', 'wooden_pickaxe', { water: true })).toBeCloseTo(5.65);
    expect(t('stone', 'wooden_pickaxe', { air: true })).toBeCloseTo(5.65);
    expect(t('stone', 'diamond_pickaxe', { eff: 5 })).toBeCloseTo(0.1);
    // Efficacité sans effet avec le mauvais outil
    expect(t('stone', 'diamond_axe', { eff: 5 })).toBeCloseTo(7.5);
  });
});

describe('Drops', () => {
  it('minerais, verre, gravier', () => {
    expect(getDrops(B.DIAMOND_ORE, 0, 'iron_pickaxe', seq(0.5))).toEqual([{ id: 'diamond', count: 1 }]);
    expect(getDrops(B.IRON_ORE, 0, 'stone_pickaxe', seq(0.5))[0].id).toBe('raw_iron');
    expect(getDrops(B.GLASS, 0, undefined)).toEqual([]);
    expect(getDrops(B.GLASS, 0, undefined, Math.random, { silk_touch: 1 })[0].id).toBe('glass');
    expect(getDrops(B.GRAVEL, 0, 'wooden_shovel', seq(0.05))[0].id).toBe('flint');
    expect(getDrops(B.GRAVEL, 0, 'wooden_shovel', seq(0.5))[0].id).toBe('gravel');
    // Fortune III : toujours du silex
    expect(getDrops(B.GRAVEL, 0, 'wooden_shovel', seq(0.99), { fortune: 3 })[0].id).toBe('flint');
    expect(getDrops(id('snow_block'), 0, 'wooden_shovel')).toEqual([{ id: 'snowball', count: 4 }]);
    expect(getDrops(id('snow_block'), 0, undefined)).toEqual([]);
    expect(getDrops(id('cobweb'), 0, 'shears')[0].id).toBe('cobweb');
    expect(getDrops(B.SPAWNER, 0, 'diamond_pickaxe', Math.random, { silk_touch: 1 })).toEqual([]);
  });
  it('Fortune sur les minerais (×1 à ×(niveau+1))', () => {
    // aléa 0,99 → multiplicateur maximal (niveau + 1)
    expect(getDrops(B.DIAMOND_ORE, 0, 'diamond_pickaxe', seq(0.99), { fortune: 3 })[0].count).toBe(4);
    expect(getDrops(B.DIAMOND_ORE, 0, 'diamond_pickaxe', seq(0.1), { fortune: 3 })[0].count).toBe(1);
  });
  it('feuilles : pousse 1/20, pomme 1/200 (chêne)', () => {
    expect(getDrops(B.OAK_LEAVES, 0, undefined, seq(0.04, 0.9, 0.9)).map((s) => s.id)).toEqual(['oak_sapling']);
    expect(getDrops(B.OAK_LEAVES, 0, undefined, seq(0.9, 0.9, 0.004)).map((s) => s.id)).toEqual(['apple']);
    expect(getDrops(B.OAK_LEAVES, 0, undefined, seq(0.9))).toEqual([]);
  });
  it('expérience des minerais (pas pour le fer, l’or, le cuivre)', () => {
    expect(blockXp(B.IRON_ORE)).toBe(0);
    expect(blockXp(B.DIAMOND_ORE, () => 0)).toBe(3);
    expect(blockXp(B.DIAMOND_ORE, () => 0.99)).toBe(7);
    expect(blockXp(B.COAL_ORE, () => 0.99)).toBe(2);
  });
});
