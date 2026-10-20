import { describe, expect, it } from 'vitest';
import { MOB_BY_KEY, MOB_DEFS, slimeDef, type MobDef } from '../src/data/mobs';
import { BABY_GROW_SECONDS, BREED_COOLDOWN_SECONDS, PIGLIN_BARTER, darkEnoughToSpawn, ironGolemDamage, phantomGroupMax, phantomSpawnChance, rollBarter, skyDarken, wearsGold } from '../src/entities/SpawnRules';
import { ENDERMITE_PEARL_CHANCE } from '../src/entities/Projectile';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { EXTRA_BLOCKS, EXTRA_ITEMS } from '../src/data/vanillaExtra';

const def = (k: string): MobDef => {
  const d = MOB_BY_KEY.get(k)?.def;
  if (!d) throw new Error(k);
  return d;
};
const drop = (k: string, item: string) => def(k).drops.find((d) => d.item === item);

/**
 * Valeurs de référence du jeu Java 1.21 (difficulté normale) : PV, dégâts, taille, XP.
 * [clé, PV, dégâts au corps à corps, largeur, hauteur, XP]
 */
const JAVA: [string, number, number, number, number, number][] = [
  ['zombie', 20, 3, 0.6, 1.95, 5],
  ['husk', 20, 3, 0.6, 1.95, 5],
  ['drowned', 20, 3, 0.6, 1.95, 5],
  ['zombie_villager', 20, 3, 0.6, 1.95, 5],
  ['skeleton', 20, 2, 0.6, 1.99, 5],
  ['stray', 20, 2, 0.6, 1.99, 5],
  ['spider', 16, 2, 1.4, 0.9, 5],
  ['cave_spider', 12, 2, 0.7, 0.5, 5],
  ['creeper', 20, 0, 0.6, 1.7, 5],
  ['enderman', 40, 7, 0.6, 2.9, 5],
  ['witch', 26, 0, 0.6, 1.95, 5],
  ['blaze', 20, 6, 0.6, 1.8, 10],
  ['ghast', 10, 0, 4, 4, 5],
  ['zombified_piglin', 20, 8, 0.6, 1.95, 5],
  ['piglin', 16, 8, 0.6, 1.95, 5],
  ['piglin_brute', 50, 13, 0.6, 1.95, 20],
  ['hoglin', 40, 6, 1.4, 1.4, 5],
  ['wither_skeleton', 20, 8, 0.7, 2.4, 5],
  ['vindicator', 24, 13, 0.6, 1.95, 5],
  ['pillager', 24, 3, 0.6, 1.95, 5],
  ['evoker', 24, 6, 0.6, 1.95, 10],
  ['vex', 14, 9, 0.4, 0.8, 3],
  ['phantom', 20, 6, 0.9, 0.5, 5],
  ['guardian', 30, 6, 0.85, 0.85, 10],
  ['elder_guardian', 80, 8, 2, 2, 10],
  ['silverfish', 8, 1, 0.4, 0.3, 5],
  ['endermite', 8, 2, 0.4, 0.3, 3],
  ['shulker', 30, 4, 1, 1, 5],
  ['ravager', 100, 12, 1.95, 2.2, 20],
  ['warden', 500, 30, 0.9, 2.9, 5],
  ['breeze', 30, 1, 0.6, 1.77, 10],
  ['cow', 10, 0, 0.9, 1.4, 2],
  ['sheep', 8, 0, 0.9, 1.3, 2],
  ['pig', 10, 0, 0.9, 0.9, 2],
  ['chicken', 4, 0, 0.4, 0.7, 1],
  ['wolf', 8, 4, 0.6, 0.85, 2],
  ['iron_golem', 100, 14.5, 1.4, 2.7, 0],
  ['snow_golem', 4, 0, 0.7, 1.9, 0],
  ['villager', 20, 0, 0.6, 1.95, 0],
  ['polar_bear', 30, 6, 1.4, 1.4, 3],
  ['bee', 10, 2, 0.7, 0.6, 1],
  ['turtle', 30, 0, 1.2, 0.4, 1],
  ['rabbit', 3, 0, 0.4, 0.5, 1],
  ['bat', 6, 0, 0.5, 0.9, 0],
  ['squid', 10, 0, 0.8, 0.8, 1],
];

describe('Créatures : valeurs du jeu Java 1.21', () => {
  it.each(JAVA)('%s : %i PV, %d dégâts, %d × %d, %i XP', (k, hp, dmg, w, h, xp) => {
    const d = def(k);
    expect(d.health).toBe(hp);
    expect(d.damage).toBe(dmg);
    expect(d.width).toBeCloseTo(w, 2);
    expect(d.height).toBeCloseTo(h, 2);
    expect(d.xp).toBe(xp);
  });

  it('butin principal', () => {
    expect(drop('zombie', 'rotten_flesh')).toMatchObject({ min: 0, max: 2 });
    expect(drop('skeleton', 'bone')).toMatchObject({ min: 0, max: 2 });
    expect(drop('skeleton', 'arrow')).toMatchObject({ min: 0, max: 2 });
    expect(drop('spider', 'string')).toMatchObject({ min: 0, max: 2 });
    expect(drop('spider', 'spider_eye')?.chance).toBeCloseTo(1 / 3, 1);
    expect(drop('creeper', 'gunpowder')).toMatchObject({ min: 0, max: 2 });
    expect(drop('enderman', 'ender_pearl')).toMatchObject({ min: 0, max: 1 });
    expect(drop('blaze', 'blaze_rod')).toMatchObject({ min: 0, max: 1 });
    expect(drop('ghast', 'ghast_tear')).toMatchObject({ min: 0, max: 1 });
    expect(drop('cow', 'beef')).toMatchObject({ min: 1, max: 3 });
    expect(drop('cow', 'leather')).toMatchObject({ min: 0, max: 2 });
    expect(drop('pig', 'porkchop')).toMatchObject({ min: 1, max: 3 });
    expect(drop('chicken', 'feather')).toMatchObject({ min: 0, max: 2 });
    expect(drop('sheep', 'mutton')).toMatchObject({ min: 1, max: 2 });
    expect(drop('wither_skeleton', 'wither_skeleton_skull')?.chance).toBe(0.025);
    expect(drop('evoker', 'totem_of_undying')).toMatchObject({ min: 1, max: 1 });
    expect(drop('evoker', 'totem_of_undying')?.chance).toBeUndefined();
    expect(drop('iron_golem', 'iron_ingot')).toMatchObject({ min: 3, max: 5 });
    expect(drop('drowned', 'copper_ingot')?.chance).toBe(0.11);
    expect(drop('strider', 'string')).toMatchObject({ min: 2, max: 5 });
    // butins qui n'existent pas dans le jeu original
    expect(drop('piglin', 'gold_nugget')).toBeUndefined();
    expect(drop('pillager', 'emerald')).toBeUndefined();
    expect(drop('zombie_villager', 'emerald')).toBeUndefined();
    expect(drop('goat', 'goat_horn')).toBeUndefined();
    expect(drop('armadillo', 'armadillo_scute')).toBeUndefined();
    expect(def('wandering_trader').drops).toEqual([]);
    expect(drop('turtle', 'seagrass')).toBeTruthy();
  });

  it('tous les objets lâchés existent', () => {
    for (const m of MOB_DEFS) for (const d of m.drops) expect(ItemRegistry.has(d.item) || EXTRA_ITEMS.some((i) => i.key === d.item) || EXTRA_BLOCKS.some((b) => b.key === d.item), `${m.key} → ${d.item}`).toBe(true);
    for (const e of PIGLIN_BARTER) expect(e.weight).toBeGreaterThan(0);
  });

  it('nourriture de reproduction / apprivoisement', () => {
    expect(def('cow').food).toEqual(['wheat']);
    expect(def('sheep').food).toEqual(['wheat']);
    expect(def('pig').food).toEqual(expect.arrayContaining(['carrot', 'potato', 'beetroot']));
    expect(def('chicken').food).toEqual(expect.arrayContaining(['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod']));
    expect(def('horse').food).toEqual(['golden_carrot', 'golden_apple']);
    expect(def('llama').food).toEqual(['hay_block']);
    expect(def('mule').food).toBeUndefined();
    expect(def('turtle').food).toEqual(['seagrass']);
    expect(def('strider').food).toEqual(['warped_fungus']);
    expect(def('wolf').food).toEqual(expect.arrayContaining(['beef', 'rabbit', 'rotten_flesh']));
    expect(def('cat').traits).toContain('tameable');
    expect(def('parrot').traits).toContain('tameable');
    expect(def('piglin').food).toEqual(['gold_ingot']);
  });

  it('brûlent au soleil', () => {
    for (const k of ['zombie', 'skeleton', 'stray', 'phantom', 'drowned', 'zombie_villager', 'bogged']) expect(def(k).traits, k).toContain('burnsInSun');
    for (const k of ['husk', 'creeper', 'spider', 'enderman', 'wither_skeleton']) expect(def(k).traits ?? [], k).not.toContain('burnsInSun');
  });

  it('vitesses de poursuite (≈ 43,17 × attribut²)', () => {
    expect(def('zombie').speed).toBeCloseTo(2.3, 1);
    expect(def('skeleton').speed).toBeCloseTo(2.7, 1);
    expect(def('creeper').speed).toBeCloseTo(2.7, 1);
    expect(def('spider').speed).toBeCloseTo(3.9, 1);
    expect(def('enderman').speed).toBeCloseTo(3.9, 1);
  });

  it('pas d’apparition naturelle pour l’endermite (perles de l’Ender, 5 %)', () => {
    expect(def('endermite').spawn).toBeUndefined();
    expect(ENDERMITE_PEARL_CHANCE).toBe(0.05);
  });
});

describe('Slimes et cubes de magma', () => {
  it.each([
    ['slime', 4, 16, 4, 4],
    ['slime', 2, 4, 2, 2],
    ['slime', 1, 1, 0, 1],
    ['magma_cube', 4, 16, 6, 4],
    ['magma_cube', 2, 4, 4, 2],
    ['magma_cube', 1, 1, 3, 1],
  ] as const)('%s taille %i : %i PV, %i dégâts, %i XP', (k, size, hp, dmg, xp) => {
    const d = slimeDef(def(k), size);
    expect(d.health).toBe(hp);
    expect(d.damage).toBe(dmg);
    expect(d.xp).toBe(xp);
    expect(d.width).toBeCloseTo(0.52 * size, 3);
    expect(d.scale).toBe(size);
    expect(d.traits ?? []).not.toContain('splits');
    expect(d.key).toBe(k);
  });
  it('seul le petit slime lâche des boules de slime ; la crème de magma vient des grands et moyens', () => {
    expect(slimeDef(def('slime'), 1).drops.map((d) => d.item)).toEqual(['slime_ball']);
    expect(slimeDef(def('slime'), 2).drops).toEqual([]);
    expect(slimeDef(def('slime'), 4).drops).toEqual([]);
    expect(slimeDef(def('magma_cube'), 1).drops).toEqual([]);
    expect(slimeDef(def('magma_cube'), 4).drops[0]).toMatchObject({ item: 'magma_cream', chance: 0.25 });
  });
});

describe("Règles d'apparition et mécaniques", () => {
  const seq = (...v: number[]) => {
    let i = 0;
    return () => v[i++ % v.length];
  };
  it('monstres : lumière des blocs nulle (règle 1.18+)', () => {
    // la moindre lumière de bloc interdit l'apparition
    for (let i = 0; i < 50; i++) expect(darkEnoughToSpawn({ sky: 0, block: 1 }, 0.34)).toBe(false);
    // grotte totalement noire : toujours possible
    for (let i = 0; i < 50; i++) expect(darkEnoughToSpawn({ sky: 0, block: 0 }, 1)).toBe(true);
    // en plein jour à découvert : jamais
    for (let i = 0; i < 50; i++) expect(darkEnoughToSpawn({ sky: 15, block: 0 }, 1)).toBe(false);
    // à minuit à découvert : lumière effective 4, possible si les deux tirages le permettent
    expect(skyDarken(0.34)).toBe(11);
    expect(skyDarken(1)).toBe(0);
    expect(darkEnoughToSpawn({ sky: 15, block: 0 }, 0.34, seq(0.99, 0.99))).toBe(true);
    expect(darkEnoughToSpawn({ sky: 15, block: 0 }, 0.34, seq(0.1, 0.99))).toBe(false);
    expect(darkEnoughToSpawn({ sky: 15, block: 0 }, 0.34, seq(0.99, 0.1))).toBe(false);
  });
  it('phantoms : 3 jours sans dormir', () => {
    const day = 840;
    expect(phantomSpawnChance(2.9 * day, day)).toBe(0);
    expect(phantomSpawnChance(3 * day, day)).toBe(0);
    expect(phantomSpawnChance(6 * day, day)).toBeCloseTo(0.5, 5);
    expect(phantomGroupMax('easy')).toBe(2);
    expect(phantomGroupMax('hard')).toBe(4);
  });
  it('golem de fer : 7,5 à 21,5 dégâts', () => {
    expect(ironGolemDamage(() => 0)).toBe(7.5);
    expect(ironGolemDamage(() => 0.9999)).toBe(21.5);
  });
  it('petits : 20 min de croissance, 5 min entre deux reproductions', () => {
    expect(BABY_GROW_SECONDS).toBe(1200);
    expect(BREED_COOLDOWN_SECONDS).toBe(300);
  });
  it('piglins : armure en or et troc', () => {
    expect(wearsGold({ head: { id: 'golden_helmet' }, chest: null })).toBe(true);
    expect(wearsGold({ head: { id: 'iron_helmet' }, feet: null })).toBe(false);
    const r = rollBarter((id) => id === 'gravel' || id === 'obsidian', seq(0, 0.5));
    expect(r?.item).toBe('obsidian');
    for (let i = 0; i < 200; i++) {
      const x = rollBarter((id) => ItemRegistry.has(id));
      const e = PIGLIN_BARTER.find((b) => b.item === x?.item)!;
      expect(x!.count).toBeGreaterThanOrEqual(e.min);
      expect(x!.count).toBeLessThanOrEqual(e.max);
    }
  });
});
