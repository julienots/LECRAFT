import { describe, expect, it } from 'vitest';
import { Inventory, makeStack } from '../src/inventory/Inventory';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { CraftingSystem } from '../src/crafting/CraftingSystem';
import { RecipeRegistry } from '../src/crafting/RecipeRegistry';
import { breakTime, canHarvest, getDrops, rollLoot } from '../src/blocks/BlockBehaviors';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { TileRegistry } from '../src/render/TileRegistry';
import { hasPainter } from '../src/render/TextureGenerator';
import { LOOT } from '../src/world/StructureGenerator';
import { Player } from '../src/player/Player';
import { MOB_DEFS } from '../src/data/mobs';
import { BiomeManager } from '../src/world/BiomeManager';

const recipe = (item: string, station?: string) => RecipeRegistry.recipes.find((r) => r.result.item === item && (!station || r.station === station))!;

describe('Inventaire', () => {
  it('empile, sépare, déplace et retire', () => {
    const inv = new Inventory();
    expect(inv.add(makeStack('dirt', 100))).toBe(0);
    expect(inv.slots[0]!.count).toBe(64);
    expect(inv.slots[1]!.count).toBe(36);
    expect(inv.split(1)).toBe(true);
    expect(inv.count('dirt')).toBe(100);
    inv.move(0, 20);
    expect(inv.slots[20]!.count).toBe(64);
    expect(inv.remove('dirt', 90)).toBe(true);
    expect(inv.count('dirt')).toBe(10);
    expect(inv.remove('dirt', 11)).toBe(false);
  });
  it('les outils ne s’empilent pas et ont une durabilité', () => {
    const inv = new Inventory();
    inv.add(makeStack('iron_pickaxe'));
    inv.add(makeStack('iron_pickaxe'));
    expect(inv.slots[0]!.count).toBe(1);
    expect(inv.slots[1]!.count).toBe(1);
    expect(inv.slots[0]!.durability).toBe(250);
    inv.selected = 0;
    for (let i = 0; i < 249; i++) inv.damageSelected();
    expect(inv.damageSelected()).toBe(true);
    expect(inv.slots[0]).toBeNull();
  });
  it('équipe une armure et calcule la défense', () => {
    const inv = new Inventory();
    inv.add(makeStack('iron_chestplate'));
    expect(inv.equipArmor(0)).toBe(true);
    expect(inv.defense()).toBe(6);
    const p = new Player('survival', 'normal');
    p.inventory.add(makeStack('iron_chestplate'));
    p.inventory.equipArmor(0);
    const dealt = p.damage(10, 'mob');
    expect(dealt).toBeLessThan(10);
  });
  it('sérialise et recharge', () => {
    const inv = new Inventory();
    inv.add(makeStack('torch', 12));
    inv.add(makeStack('iron_sword'));
    const copy = new Inventory();
    copy.load(JSON.parse(JSON.stringify(inv.serialize())));
    expect(copy.count('torch')).toBe(12);
    expect(copy.slots[1]!.durability).toBe(250);
  });
});

describe('Fabrication', () => {
  it('toutes les recettes référencent des objets existants', () => {
    expect(RecipeRegistry.recipes.length).toBeGreaterThan(60);
  });
  it('planches depuis n’importe quel tronc, puis établi et outils', () => {
    const inv = new Inventory();
    const cs = new CraftingSystem();
    inv.add(makeStack('birch_log', 2));
    expect(cs.craft(inv, recipe('planks'), 2)).toBe(2);
    expect(inv.count('planks')).toBe(8);
    expect(cs.craft(inv, recipe('crafting_table'))).toBe(1);
    expect(cs.craft(inv, recipe('stick'))).toBe(1);
    expect(cs.canCraft(inv, recipe('stone_pickaxe'))).toBe(false);
    inv.add(makeStack('cobblestone', 3));
    expect(cs.craft(inv, recipe('stone_pickaxe'))).toBe(1);
    expect(inv.count('stone_pickaxe')).toBe(1);
  });
  it('le four consomme du combustible', () => {
    const inv = new Inventory();
    const cs = new CraftingSystem();
    inv.add(makeStack('raw_iron', 10));
    expect(cs.canCraft(inv, recipe('iron_ingot'))).toBe(false);
    inv.add(makeStack('coal', 1));
    expect(cs.craft(inv, recipe('iron_ingot'), 10)).toBe(8);
    expect(inv.count('iron_ingot')).toBe(8);
    expect(inv.count('coal')).toBe(0);
  });
});

describe('Blocs', () => {
  it('chaque tuile a un dessin et chaque bloc des tuiles valides', () => {
    for (const n of TileRegistry.names) expect(hasPainter(n.split('#')[0]) || n === 'missing', n).toBe(true);
    for (const b of BlockRegistry.blocks) for (const t of b.faceTiles) expect(t).toBeLessThan(TileRegistry.count);
  });
  it('outil requis et tiers', () => {
    expect(canHarvest(B.IRON_ORE, 'wood_pickaxe')).toBe(false);
    expect(canHarvest(B.IRON_ORE, 'stone_pickaxe')).toBe(true);
    expect(canHarvest(B.AURITE_ORE, 'stone_pickaxe')).toBe(false);
    expect(canHarvest(B.AURITE_ORE, 'iron_pickaxe')).toBe(true);
    expect(getDrops(B.STONE, 0, undefined)).toEqual([]);
    expect(getDrops(B.STONE, 0, 'wood_pickaxe')[0].id).toBe('cobblestone');
    expect(breakTime(B.STONE, 'iron_pickaxe', false, false)).toBeLessThan(breakTime(B.STONE, 'wood_pickaxe', false, false));
    expect(breakTime(B.BEDROCK, 'aurite_pickaxe', false, false)).toBe(Infinity);
  });
  it('cultures : drop selon le stade', () => {
    expect(getDrops(B.WHEAT, 7, undefined, () => 0).map((s) => s.id)).toEqual(['wheat', 'seeds']);
    expect(getDrops(B.WHEAT, 3, undefined).map((s) => s.id)).toEqual(['seeds']);
  });
  it('butin des coffres déterministe', () => {
    const a = rollLoot(LOOT.DUNGEON, 1234), b = rollLoot(LOOT.DUNGEON, 1234);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
    for (const s of a) expect(ItemRegistry.has(s.id)).toBe(true);
  });
});

describe('Données', () => {
  it('créatures et biomes cohérents', () => {
    for (const b of BiomeManager.biomes) {
      for (const k of [...b.animals, ...b.hostiles]) expect(MOB_DEFS.some((m) => m.key === k), k).toBe(true);
      for (const v of b.vegetation) expect(BlockRegistry.has(v.block)).toBe(true);
    }
    for (const m of MOB_DEFS) for (const d of m.drops) expect(ItemRegistry.has(d.item), d.item).toBe(true);
    expect(MOB_DEFS[4].key).toBe('rodeur');
    expect(MOB_DEFS[8].key).toBe('chef');
  });
  it('survie : faim, régénération, noyade, chute', () => {
    const p = new Player('survival', 'normal');
    p.health = 10;
    for (let i = 0; i < 100; i++) p.tick(0.05);
    expect(p.health).toBeGreaterThan(10);
    p.body.landed = 10;
    const h = p.health;
    p.invulnerable = 0;
    p.tick(0.05);
    expect(p.health).toBeLessThan(h);
    p.hunger = 5;
    expect(p.eat('bread')).toBe(true);
    expect(p.hunger).toBe(10);
  });
});
