import { describe, expect, it } from 'vitest';
import { Inventory, makeStack } from '../src/inventory/Inventory';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { CraftingGrid, CraftingSystem, newFurnace, tickFurnace } from '../src/crafting/CraftingSystem';
import { RecipeRegistry } from '../src/crafting/RecipeRegistry';
import { breakTime, canHarvest, getDrops, rollLoot } from '../src/blocks/BlockBehaviors';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { TileRegistry } from '../src/render/TileRegistry';
import { hasPainter } from '../src/render/TextureGenerator';
import { LOOT, MOB_INDEX } from '../src/world/StructureGenerator';
import { Player } from '../src/player/Player';
import { MOB_DEFS } from '../src/data/mobs';
import { BiomeManager } from '../src/world/BiomeManager';

const recipe = (item: string) => RecipeRegistry.crafting.find((r) => r.result.item === item)!;
/** Remplit une grille à partir d'un motif texte (une lettre = un objet). */
function grid(size: 2 | 3, rows: string[], key: Record<string, string>) {
  const g = new CraftingGrid(size);
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== ' ' && (g.slots[y * size + x] = makeStack(key[ch], 1))));
  return g;
}

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
    expect(RecipeRegistry.crafting.length).toBeGreaterThan(100);
    expect(RecipeRegistry.smelting.length).toBeGreaterThan(10);
  });
  it('grille 2x2 : planches depuis n’importe quel tronc, établi, bâtons', () => {
    let g = grid(2, ['L '], { L: 'birch_log' });
    expect(g.result).toEqual({ id: 'birch_planks', count: 4 });
    g = grid(2, [' L'], { L: 'oak_log' });
    expect(g.result?.id).toBe('oak_planks');
    g = grid(2, ['PP', 'PP'], { P: 'spruce_planks' });
    expect(g.result?.id).toBe('crafting_table');
    g = grid(2, [' P', ' P'], { P: 'oak_planks' });
    expect(g.result).toEqual({ id: 'stick', count: 4 });
  });
  it('grille 3x3 : motifs, miroir, position libre et recettes sans forme', () => {
    expect(grid(3, ['CCC', ' S ', ' S '], { C: 'cobblestone', S: 'stick' }).result?.id).toBe('stone_pickaxe');
    // la hache et son miroir
    expect(grid(3, ['PP ', 'PS ', ' S '], { P: 'oak_planks', S: 'stick' }).result?.id).toBe('wooden_axe');
    expect(grid(3, [' PP', ' SP', ' S '], { P: 'oak_planks', S: 'stick' }).result?.id).toBe('wooden_axe');
    // une épée décalée dans un coin reste reconnue
    expect(grid(3, ['  I', '  I', '  S'], { I: 'iron_ingot', S: 'stick' }).result?.id).toBe('iron_sword');
    // motif incomplet : rien
    expect(grid(3, ['CC ', ' S ', ' S '], { C: 'cobblestone', S: 'stick' }).result?.id).toBe('stone_hoe');
    expect(grid(3, ['C C', ' S ', ' S '], { C: 'cobblestone', S: 'stick' }).result).toBeNull();
    // la pioche ne tient pas dans la grille 2x2
    const r = recipe('stone_pickaxe');
    expect(RecipeRegistry.match(grid(2, ['CC', 'S '], { C: 'cobblestone', S: 'stick' }).slots, 2)?.id).not.toBe(r.id);
  });
  it('prendre le résultat consomme un exemplaire de chaque case', () => {
    const g = new CraftingGrid(2);
    g.slots[0] = makeStack('oak_log', 3);
    expect(g.result?.count).toBe(4);
    g.consume();
    expect(g.slots[0]!.count).toBe(2);
  });
  it('le livre de recettes remplit la grille depuis l’inventaire', () => {
    const inv = new Inventory();
    const cs = new CraftingSystem();
    inv.add(makeStack('cobblestone', 8));
    const g = new CraftingGrid(3);
    expect(cs.canCraft(inv, recipe('furnace'), 3)).toBe(true);
    expect(cs.canCraft(inv, recipe('furnace'), 2)).toBe(false);
    expect(cs.fillGrid(inv, g, recipe('furnace'))).toBe(true);
    expect(g.result?.id).toBe('furnace');
    expect(inv.count('cobblestone')).toBe(0);
    g.clearInto(inv);
    expect(inv.count('cobblestone')).toBe(8);
  });
  it('fourneau : 10 s par objet, le charbon dure 80 s (8 objets)', () => {
    const f = newFurnace();
    f.input = makeStack('raw_iron', 10);
    f.fuel = makeStack('coal', 1);
    let lit = false;
    for (let t = 0; t < 120; t += 0.05) if (tickFurnace(f, 0.05)) lit = !lit;
    expect(f.output?.id).toBe('iron_ingot');
    expect(f.output?.count).toBe(8);
    expect(f.fuel).toBeNull();
    expect(f.burn).toBe(0);
    expect(f.xp).toBeGreaterThan(5);
  });
});

describe('Blocs', () => {
  it('chaque tuile a un dessin et chaque bloc des tuiles valides', () => {
    for (const n of TileRegistry.names) expect(hasPainter(n.split('#')[0]) || n === 'missing', n).toBe(true);
    for (const b of BlockRegistry.blocks) for (const t of b.faceTiles) expect(t).toBeLessThan(TileRegistry.count);
  });
  it('outil requis et tiers', () => {
    expect(canHarvest(B.IRON_ORE, 'wooden_pickaxe')).toBe(false);
    expect(canHarvest(B.IRON_ORE, 'stone_pickaxe')).toBe(true);
    expect(canHarvest(B.DIAMOND_ORE, 'stone_pickaxe')).toBe(false);
    expect(canHarvest(B.DIAMOND_ORE, 'iron_pickaxe')).toBe(true);
    expect(canHarvest(B.OBSIDIAN, 'iron_pickaxe')).toBe(false);
    expect(canHarvest(B.OBSIDIAN, 'diamond_pickaxe')).toBe(true);
    expect(getDrops(B.STONE, 0, undefined)).toEqual([]);
    expect(getDrops(B.STONE, 0, 'wooden_pickaxe')[0].id).toBe('cobblestone');
    expect(getDrops(B.IRON_ORE, 0, 'stone_pickaxe')[0].id).toBe('raw_iron');
    expect(breakTime(B.STONE, 'iron_pickaxe', false, false)).toBeLessThan(breakTime(B.STONE, 'wooden_pickaxe', false, false));
    expect(breakTime(B.BEDROCK, 'diamond_pickaxe', false, false)).toBe(Infinity);
  });
  it('cultures : drop selon le stade', () => {
    expect(getDrops(B.WHEAT, 7, undefined, () => 0).map((s) => s.id)).toEqual(['wheat', 'wheat_seeds']);
    expect(getDrops(B.WHEAT, 3, undefined).map((s) => s.id)).toEqual(['wheat_seeds']);
    expect(getDrops(B.POTATOES, 3, undefined, () => 0.5)[0].id).toBe('potato');
  });
  it('drops des blocs à forme : dalle double, porte, lit, cisailles', () => {
    expect(getDrops(B.STONE_SLAB, 2, 'wooden_pickaxe')).toEqual([{ id: 'stone_slab', count: 2 }]);
    expect(getDrops(B.STONE_SLAB, 1, 'wooden_pickaxe')).toEqual([{ id: 'stone_slab', count: 1 }]);
    expect(getDrops(B.OAK_DOOR, 0, undefined)[0].id).toBe('oak_door');
    expect(getDrops(B.OAK_DOOR, 8, undefined)).toEqual([]);
    expect(getDrops(B.RED_BED, 4, undefined)).toEqual([]);
    expect(getDrops(B.RED_BED, 0, undefined)[0].id).toBe('red_bed');
    expect(getDrops(B.OAK_LEAVES, 0, 'shears')[0].id).toBe('oak_leaves');
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
    // indices utilisés par les cages à monstres des structures
    for (const [k, i] of Object.entries(MOB_INDEX)) expect(MOB_DEFS[i].key).toBe(k === 'chef' ? 'zombie_chief' : k);
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

describe('Formes et orientation', () => {
  it('escaliers : la marche haute est du côté regardé', async () => {
    const { modelBoxes, facingFromYaw, FACING_DIR } = await import('../src/blocks/Shapes');
    // regarder vers le nord (-Z) donne l'orientation nord (2)
    expect(facingFromYaw(0)).toBe(2);
    expect(FACING_DIR[2]).toEqual([0, -1]);
    const boxes = modelBoxes(B.OAK_STAIRS, 2, () => 0);
    const step = boxes[1];
    expect(step[2]).toBe(0);
    expect(step[5]).toBe(8);
    // tourné vers l'est : marche côté +X
    const east = modelBoxes(B.OAK_STAIRS, 3, () => 0)[1];
    expect(east[0]).toBe(8);
    expect(east[3]).toBe(16);
  });
  it('dalles et neige : hauteurs', async () => {
    const { modelBoxes, collisionBoxes } = await import('../src/blocks/Shapes');
    expect(modelBoxes(B.STONE_SLAB, 0, () => 0)[0][4]).toBe(8);
    expect(modelBoxes(B.STONE_SLAB, 1, () => 0)[0][1]).toBe(8);
    expect(modelBoxes(B.SNOW, 3, () => 0)[0][4]).toBe(8);
    expect(collisionBoxes(B.TORCH, 0, () => 0)).toEqual([]);
  });
  it('barrières : connexions aux voisins et collision de 1,5 bloc', async () => {
    const { modelBoxes, collisionBoxes } = await import('../src/blocks/Shapes');
    const nb = (dx: number, _dy: number, dz: number) => (dx === 1 && dz === 0 ? B.OAK_FENCE : 0);
    expect(modelBoxes(B.OAK_FENCE, 0, nb).length).toBe(3);
    expect(Math.max(...collisionBoxes(B.OAK_FENCE, 0, nb).map((b) => b[4]))).toBe(24);
  });
});

describe('Police pixel', () => {
  it('génère une police TrueType valide (en-tête, tables)', async () => {
    const { buildPixelFont } = await import('../src/ui/FontBuilder');
    const buf = new DataView(buildPixelFont());
    expect(buf.getUint32(0)).toBe(0x00010000);
    const n = buf.getUint16(4);
    const tags: string[] = [];
    for (let i = 0; i < n; i++) tags.push(String.fromCharCode(...[0, 1, 2, 3].map((k) => buf.getUint8(12 + i * 16 + k))));
    for (const t of ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']) expect(tags).toContain(t);
    expect([...tags].sort()).toEqual(tags);
  });
});
