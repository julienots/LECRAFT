import { describe, expect, it } from 'vitest';
import { EXTRA_BLOCKS, EXTRA_ITEMS } from '../src/data/vanillaExtra';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { breakTime, getDrops } from '../src/blocks/BlockBehaviors';
import { bonusDamage, canEnchant, ENCHANT_BY_ID, enchantOffers, enchLevel, protectionFactor, setEnchants, unbreakingSaves } from '../src/inventory/Enchantments';
import { brewResult, makePotion, potionEffect, potionName, potionOf } from '../src/inventory/Potions';
import { newBrewing, tickBrewing } from '../src/crafting/Brewing';

for (const it of EXTRA_ITEMS) if (!ItemRegistry.has(it.key)) ItemRegistry.register(it);
for (const d of EXTRA_BLOCKS) if (!ItemRegistry.has(d.key)) ItemRegistry.register({ key: d.key, name: d.name, icon: { block: d.key }, place: d.key, tab: 'building' });

describe('Enchantements', () => {
  it('cibles : Tranchant sur une épée, Efficacité sur une pioche, Protection sur une armure', () => {
    expect(canEnchant('diamond_sword', ENCHANT_BY_ID.get('sharpness')!)).toBe(true);
    expect(canEnchant('diamond_pickaxe', ENCHANT_BY_ID.get('sharpness')!)).toBe(false);
    expect(canEnchant('diamond_pickaxe', ENCHANT_BY_ID.get('efficiency')!)).toBe(true);
    expect(canEnchant('iron_chestplate', ENCHANT_BY_ID.get('protection')!)).toBe(true);
    expect(canEnchant('iron_chestplate', ENCHANT_BY_ID.get('feather_falling')!)).toBe(false);
    expect(canEnchant('iron_boots', ENCHANT_BY_ID.get('feather_falling')!)).toBe(true);
  });
  it('table : 3 propositions, niveaux croissants, plus hauts avec 15 bibliothèques, enchantements valides', () => {
    const a = enchantOffers('diamond_sword', 0, 42), b = enchantOffers('diamond_sword', 15, 42);
    expect(a).toHaveLength(3);
    expect(a[0].level).toBeLessThanOrEqual(a[2].level);
    expect(b[2].level).toBe(30);
    expect(a[2].level).toBeLessThanOrEqual(8);
    for (const o of [...a, ...b]) for (const id of Object.keys(o.ench)) expect(canEnchant('diamond_sword', ENCHANT_BY_ID.get(id)!), id).toBe(true);
    // même graine → mêmes propositions (pas de nouveau tirage en rouvrant la table)
    expect(enchantOffers('diamond_sword', 15, 42)).toEqual(b);
  });
  it('effets : dégâts de Tranchant, minage plus rapide, protection, solidité', () => {
    const sword = { id: 'diamond_sword', count: 1 };
    setEnchants(sword, { sharpness: 3, smite: 0 });
    expect(enchLevel(sword, 'sharpness')).toBe(3);
    expect(bonusDamage(sword, 'cow')).toBe(2);
    expect(breakTime(B.STONE, 'iron_pickaxe', false, false, 5)).toBeLessThan(breakTime(B.STONE, 'iron_pickaxe', false, false, 0) / 3);
    const chest = { id: 'iron_chestplate', count: 1 };
    setEnchants(chest, { protection: 4 });
    expect(protectionFactor([chest], 'any')).toBeCloseTo(0.16);
    const boots = { id: 'iron_boots', count: 1 };
    setEnchants(boots, { feather_falling: 4 });
    expect(protectionFactor([boots], 'fall')).toBeCloseTo(0.48);
    const pick = { id: 'iron_pickaxe', count: 1 };
    setEnchants(pick, { unbreaking: 3 });
    let saved = 0;
    for (let i = 0; i < 4000; i++) if (unbreakingSaves(pick)) saved++;
    expect(saved / 4000).toBeGreaterThan(0.68);
    expect(saved / 4000).toBeLessThan(0.82);
  });
  it('Toucher de soie et Fortune', () => {
    const dia = BlockRegistry.byName('diamond_ore').id;
    expect(getDrops(dia, 0, 'iron_pickaxe', Math.random, { silk_touch: 1 })[0].id).toBe('diamond_ore');
    let total = 0;
    for (let i = 0; i < 400; i++) total += getDrops(dia, 0, 'iron_pickaxe', Math.random, { fortune: 3 }).reduce((a, s) => a + s.count, 0);
    expect(total / 400).toBeGreaterThan(1.8);
  });
});

describe('Potions et alambic', () => {
  it('chaîne d’infusion : eau → étrange → rapidité → longue / II → jetable', () => {
    const water = makePotion('water');
    const awk = brewResult(water, 'nether_wart')!;
    expect(potionOf(awk)).toBe('awkward');
    const swift = brewResult(awk, 'sugar')!;
    expect(potionOf(swift)).toBe('swiftness');
    expect(potionOf(brewResult(swift, 'redstone'))).toBe('long_swiftness');
    expect(potionOf(brewResult(swift, 'glowstone_dust'))).toBe('strong_swiftness');
    expect(potionOf(brewResult(swift, 'fermented_spider_eye'))).toBe('slowness');
    const splash = brewResult(swift, 'gunpowder')!;
    expect(splash.id).toBe('splash_potion');
    expect(potionName(splash)).toBe('Potion jetable de rapidité');
    expect(brewResult(awk, 'dirt')).toBeNull();
    expect(potionEffect('strong_swiftness')).toEqual({ id: 'speed', seconds: 90, amp: 1 });
    expect(potionEffect('long_poison')).toEqual({ id: 'poison', seconds: 90, amp: 0 });
  });
  it('alambic : poudre de blaze, 20 s, les 3 fioles transformées, ingrédient consommé', () => {
    const s = newBrewing();
    s.bottles = [makePotion('water'), makePotion('water'), null];
    s.ingredient = { id: 'nether_wart', count: 2 };
    s.fuelItem = { id: 'blaze_powder', count: 1 };
    let done = false;
    for (let t = 0; t < 25 && !done; t += 0.5) done = tickBrewing(s, 0.5);
    expect(done).toBe(true);
    expect(s.bottles.map((b) => potionOf(b))).toEqual(['awkward', 'awkward', null]);
    expect(s.ingredient!.count).toBe(1);
    expect(s.fuelItem).toBeNull();
    expect(s.fuel).toBe(19);
  });
  it('pas de poudre de blaze : pas d’infusion', () => {
    const s = newBrewing();
    s.bottles = [makePotion('water'), null, null];
    s.ingredient = { id: 'nether_wart', count: 1 };
    for (let t = 0; t < 30; t++) tickBrewing(s, 1);
    expect(potionOf(s.bottles[0])).toBe('water');
  });
});

describe('Sons du pack de ressources', () => {
  it('cris des créatures, blocs et sons courants trouvés dans sounds/ (variantes numérotées)', async () => {
    const { groupPackSounds, packFilesFor, packMobFiles } = await import('../src/audio/PackSounds');
    const b = () => new Blob(['x']);
    const files = new Map<string, Blob>([
      ['mob/cow/say1.ogg', b()], ['mob/cow/say2.ogg', b()], ['mob/cow/hurt1.ogg', b()],
      ['mob/pig/say1.ogg', b()], ['mob/pig/death.ogg', b()], ['mob/horse/donkey/idle1.ogg', b()],
      ['dig/stone1.ogg', b()], ['step/grass2.ogg', b()], ['random/chestopen.ogg', b()], ['dig/cloth1.ogg', b()],
    ]);
    const g = groupPackSounds(files);
    expect(packMobFiles(g, 'cow', 'idle')).toHaveLength(2);
    expect(packMobFiles(g, 'cow', 'death')).toHaveLength(1);
    expect(packMobFiles(g, 'mooshroom', 'hurt')).toHaveLength(1);
    expect(packMobFiles(g, 'pig', 'death')).toHaveLength(1);
    expect(packMobFiles(g, 'donkey', 'idle')).toHaveLength(1);
    expect(packMobFiles(g, 'sheep', 'idle')).toBeNull();
    expect(packFilesFor(g, 'break_stone')).toHaveLength(1);
    expect(packFilesFor(g, 'place_wool')).toHaveLength(1);
    expect(packFilesFor(g, 'step_grass')).toHaveLength(1);
    expect(packFilesFor(g, 'chest_open')).toHaveLength(1);
    expect(packFilesFor(g, 'moo')).toBeNull();
  });
});
