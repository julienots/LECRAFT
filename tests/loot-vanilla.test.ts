import { describe, expect, it } from 'vitest';
import { EXTRA_BLOCKS, EXTRA_ITEMS } from '../src/data/vanillaExtra';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { rollLoot } from '../src/blocks/BlockBehaviors';
import { LOOT } from '../src/world/StructureGenerator';
import { MORE_LOOT } from '../src/world/MoreStructures';
import { VANILLA_CHEST_LOOT } from '../src/data/vanillaLoot';
import { fishingLoot } from '../src/inventory/Loot';

for (const d of EXTRA_BLOCKS) if (!ItemRegistry.has(d.key)) ItemRegistry.register({ key: d.key, name: d.name, icon: { block: d.key }, place: d.key, tab: 'building' });
for (const it of EXTRA_ITEMS) if (!ItemRegistry.has(it.key)) ItemRegistry.register(it);

describe('Objets (valeurs du jeu original)', () => {
  it('tailles de pile', () => {
    const st = (k: string) => ItemRegistry.maxStack(k);
    expect([st('ender_pearl'), st('egg'), st('snowball'), st('oak_sign'), st('bucket'), st('honey_bottle'), st('armor_stand')]).toEqual([16, 16, 16, 16, 16, 16, 16]);
    expect([st('water_bucket'), st('lava_bucket'), st('milk_bucket'), st('cake'), st('oak_boat'), st('saddle'), st('white_shulker_box'), st('potion'), st('enchanted_book'), st('mushroom_stew'), st('totem_of_undying')]).toEqual(
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    );
    expect([st('diamond_sword'), st('iron_chestplate'), st('bow'), st('trident')]).toEqual([1, 1, 1, 1]);
    expect([st('dirt'), st('stick'), st('name_tag'), st('map')]).toEqual([64, 64, 64, 64]);
  });

  it('usure', () => {
    const d = (k: string) => ItemRegistry.maxDurability(k);
    expect(['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].map(d)).toEqual([59, 131, 250, 32, 1561, 2031]);
    expect(['bow', 'crossbow', 'trident', 'shears', 'fishing_rod', 'flint_and_steel', 'shield', 'elytra', 'carrot_on_a_stick', 'mace'].map(d)).toEqual([384, 465, 250, 238, 64, 64, 336, 432, 25, 500]);
    expect(['leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots'].map(d)).toEqual([55, 80, 75, 65]);
    expect(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].map(d)).toEqual([165, 240, 225, 195]);
    expect(['golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots'].map(d)).toEqual([77, 112, 105, 91]);
    expect(['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots'].map(d)).toEqual([363, 528, 495, 429]);
    expect(['netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots'].map(d)).toEqual([407, 592, 555, 481]);
    expect(d('turtle_helmet')).toBe(275);
  });

  it('nourriture (faim / saturation)', () => {
    const f = (k: string) => {
      const x = ItemRegistry.get(k)?.food;
      return x ? [x.hunger, x.saturation] : null;
    };
    expect(f('cooked_beef')).toEqual([8, 12.8]);
    expect(f('bread')).toEqual([5, 6]);
    expect(f('golden_carrot')).toEqual([6, 14.4]);
    expect(f('rotten_flesh')).toEqual([4, 0.8]);
    expect(f('enchanted_golden_apple')).toEqual([4, 9.6]);
    expect(f('rabbit_stew')).toEqual([10, 12]);
    expect(f('dried_kelp')).toEqual([1, 0.6]);
  });

  it('combustibles (secondes)', () => {
    const b = (k: string) => ItemRegistry.get(k)?.burnTime;
    expect(b('coal')).toBe(80);
    expect(b('coal_block')).toBe(800);
    expect(b('lava_bucket')).toBe(1000);
    expect(b('blaze_rod')).toBe(120);
    expect(b('dried_kelp_block')).toBe(200);
    expect(b('oak_log')).toBe(15);
    expect(b('cherry_planks')).toBe(15);
    expect(b('stripped_birch_wood')).toBe(15);
    expect(b('oak_slab')).toBe(7.5);
    expect(b('mangrove_slab')).toBe(7.5);
    expect(b('stick')).toBe(5);
    expect(b('oak_boat')).toBe(60);
    expect(b('oak_door')).toBe(10);
    expect(b('wooden_pickaxe')).toBe(10);
    expect(b('white_carpet')).toBe(3.35);
    expect(b('bamboo')).toBe(2.5);
    // bois du Nether : ininflammable
    expect(b('crimson_planks')).toBeUndefined();
    expect(b('warped_stem')).toBeUndefined();
  });
});

describe('Butin', () => {
  it('tables officielles des coffres (déterministes, objets existants)', () => {
    for (const table of [LOOT.DUNGEON, LOOT.MINE, LOOT.FORTRESS, ...Object.values(MORE_LOOT)]) {
      const a = rollLoot(table, 42), b = rollLoot(table, 42);
      expect(a).toEqual(b);
      for (const s of a) expect(ItemRegistry.has(s.id), `${table}: ${s.id}`).toBe(true);
    }
    // donjon : 3 groupes de tirages (dont 3 objets « os / poudre / chair / ficelle »)
    const d = rollLoot(LOOT.DUNGEON, 7);
    expect(d.filter((s) => ['bone', 'gunpowder', 'rotten_flesh', 'string'].includes(s.id)).length).toBeGreaterThanOrEqual(3);
    expect(VANILLA_CHEST_LOOT.simple_dungeon).toHaveLength(3);
    expect(VANILLA_CHEST_LOOT.abandoned_mineshaft[2][1].some(([id]) => id === 'rail')).toBe(true);
  });
  it('pêche : 85 % poisson, 10 % déchet, 5 % trésor', () => {
    expect(fishingLoot(0, () => 0.5)?.id).toMatch(/cod|salmon|tropical_fish|pufferfish/);
  });
});
