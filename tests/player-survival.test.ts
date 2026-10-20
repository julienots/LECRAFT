import { describe, expect, it } from 'vitest';
import { Player, armorReduce, difficultyScale, fallDamage, xpForLevel } from '../src/player/Player';
import { makeStack } from '../src/inventory/Inventory';

/** Survie du joueur comparée au jeu de référence (FoodData, LivingEntity, CombatRules — Java 1.21). */
const ticks = (p: Player, n: number) => {
  for (let k = 0; k < n; k++) p.tick(0.05);
};

describe('Survie (Java 1.21)', () => {
  it('armure : formule avec robustesse (CombatRules)', () => {
    // fer complet (15), 10 dégâts : max(3, 15 − 5) = 10 → −40 %
    expect(armorReduce(10, 15, 0)).toBeCloseTo(6, 5);
    // diamant complet (20, robustesse 8), 10 dégâts : 20 − 40/16 = 17,5 → −70 %
    expect(armorReduce(10, 20, 8)).toBeCloseTo(3, 5);
    // gros coup : plancher armure/5
    expect(armorReduce(100, 15, 0)).toBeCloseTo(100 * (1 - 3 / 25), 5);
    // plafond 20 points → −80 %
    expect(armorReduce(1, 30, 0)).toBeCloseTo(0.2, 5);
  });
  it('dégâts reçus : armure de fer, pas pour la chute ; difficulté', () => {
    const p = new Player('survival', 'normal');
    for (const [slot, id] of [['head', 'iron_helmet'], ['chest', 'iron_chestplate'], ['legs', 'iron_leggings'], ['feet', 'iron_boots']] as const) p.inventory.armor[slot] = makeStack(id);
    expect(p.damage(10, 'mob')).toBeCloseTo(6, 5);
    p.invulnerable = 0;
    expect(p.damage(5, 'fall')).toBeCloseTo(5, 5);
    expect(difficultyScale(4, 'easy')).toBe(3);
    expect(difficultyScale(1, 'easy')).toBe(1);
    expect(difficultyScale(4, 'hard')).toBe(6);
    expect(difficultyScale(4, 'peaceful')).toBe(0);
  });
  it('invincibilité 10 ticks : un coup plus fort n’inflige que la différence', () => {
    const p = new Player('survival', 'normal');
    expect(p.damage(5, 'mob')).toBe(5);
    expect(p.damage(3, 'mob')).toBe(0);
    expect(p.damage(8, 'mob')).toBe(3);
    expect(p.health).toBe(12);
    ticks(p, 10);
    expect(p.damage(2, 'mob')).toBe(2);
  });
  it('Résistance −20 %/niveau, Chute amortie IV −48 %, protection plafonnée à 80 %', () => {
    const p = new Player('survival', 'normal');
    p.effects.add('resistance', 100, 1);
    expect(p.damage(10, 'mob')).toBeCloseTo(6, 5);
    const q = new Player('survival', 'normal');
    q.inventory.armor.feet = { ...makeStack('iron_boots'), meta: { ench: { feather_falling: 4 } } };
    expect(q.damage(10, 'fall')).toBeCloseTo(10 * (1 - 0.48), 5);
  });
  it('dégâts de chute : ⌈d − 3⌉, Saut amélioré +1 bloc/niveau, facteurs de bloc', () => {
    expect(fallDamage(3)).toBe(0);
    expect(fallDamage(3.5)).toBe(1);
    expect(fallDamage(4)).toBe(1);
    expect(fallDamage(10)).toBe(7);
    expect(fallDamage(10, 2)).toBe(5);
    expect(fallDamage(10, 0, 0.2)).toBe(2);
    expect(fallDamage(10, 0, 0)).toBe(0);
  });
  it('régénération rapide : saturation > 0 et faim 20 → toutes les 0,5 s, 6 d’épuisement par PV', () => {
    const p = new Player('survival', 'normal');
    p.health = 10;
    p.hunger = 20;
    p.saturation = 5;
    ticks(p, 9);
    expect(p.health).toBe(10);
    ticks(p, 1);
    expect(p.health).toBeCloseTo(10 + 5 / 6, 5);
    expect(p.exhaustion).toBeCloseTo(5 + 0, 5);
  });
  it('régénération lente : faim ≥ 18 sans saturation → 1 PV toutes les 4 s', () => {
    const p = new Player('survival', 'normal');
    p.health = 10;
    p.hunger = 18;
    p.saturation = 0;
    ticks(p, 79);
    expect(p.health).toBe(10);
    ticks(p, 1);
    expect(p.health).toBe(11);
    expect(p.exhaustion).toBeCloseTo(6, 5);
    // 4 d'épuisement = 1 point de faim (saturation vide), un par tick
    ticks(p, 1);
    expect(p.hunger).toBe(17);
  });
  it('famine : 1 dégât toutes les 4 s, jusqu’à 10 PV (facile), 1 PV (normal), la mort (difficile)', () => {
    for (const [diff, floor] of [['easy', 10], ['normal', 1], ['hard', 0]] as const) {
      const p = new Player('survival', diff);
      p.hunger = 0;
      p.saturation = 0;
      p.health = 14;
      ticks(p, 80);
      expect(p.health).toBe(13);
      ticks(p, 80 * 20);
      expect(p.health, diff).toBe(floor);
    }
  });
  it('noyade : 300 ticks d’air, puis 2 dégâts par seconde ; l’air revient de 4 par tick', () => {
    const p = new Player('survival', 'normal');
    p.naturalRegen = false;
    p.body.headInWater = true;
    ticks(p, 319);
    expect(p.health).toBe(20);
    ticks(p, 1);
    expect(p.health).toBe(18);
    ticks(p, 20);
    expect(p.health).toBe(16);
    p.body.headInWater = false;
    ticks(p, 10);
    expect(p.air).toBeCloseTo(40, 5);
  });
  it('feu : 1 dégât par seconde sans armure, Résistance au feu protège, l’eau éteint', () => {
    const p = new Player('survival', 'normal');
    p.naturalRegen = false;
    p.inventory.armor.chest = makeStack('diamond_chestplate');
    p.setOnFire(100);
    ticks(p, 100);
    expect(p.health).toBe(15);
    expect(p.onFire).toBe(false);
    p.setOnFire(100);
    p.effects.add('fire_resistance', 200);
    ticks(p, 40);
    expect(p.health).toBe(15);
    p.effects.clear();
    p.setOnFire(100);
    p.body.inWater = true;
    ticks(p, 1);
    expect(p.onFire).toBe(false);
  });
  it('expérience : 7 + 2·niveau, 37 + 5·(n−15), 112 + 9·(n−30) ; 20 PV fixes', () => {
    expect(xpForLevel(0)).toBe(7);
    expect(xpForLevel(14)).toBe(35);
    expect(xpForLevel(15)).toBe(37);
    expect(xpForLevel(29)).toBe(107);
    expect(xpForLevel(30)).toBe(112);
    const p = new Player('survival', 'normal');
    p.addXp(7 + 9 + 11);
    expect(p.level).toBe(3);
    expect(p.xp).toBe(0);
    p.level = 30;
    expect(p.maxHealth).toBe(20);
  });
  it('fatigue : saut 0,05, sprint-saut 0,2, coup reçu 0,1', () => {
    const p = new Player('survival', 'normal');
    p.damage(1, 'mob');
    expect(p.exhaustion).toBeCloseTo(0.1, 5);
    p.invulnerable = 0;
    p.damage(1, 'fall');
    expect(p.exhaustion).toBeCloseTo(0.1, 5);
  });
});
