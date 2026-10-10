import { describe, expect, it } from 'vitest';
import { MOB_DEFS } from '../src/data/mobs';
import { FEARS, HUNTS } from '../src/entities/MobRelations';
import { dripSegment } from '../src/world/Dripstone';

const keys = new Set(MOB_DEFS.map((m) => m.key));

describe('Relations entre créatures', () => {
  it('chasseurs, proies et prédateurs fuis existent tous', () => {
    for (const [hunter, rules] of Object.entries(HUNTS)) {
      expect(keys.has(hunter), hunter).toBe(true);
      for (const r of rules) if (Array.isArray(r.prey)) for (const p of r.prey) expect(keys.has(p), `${hunter} → ${p}`).toBe(true);
    }
    for (const [prey, from] of Object.entries(FEARS)) {
      expect(keys.has(prey), prey).toBe(true);
      for (const f of from) expect(keys.has(f), `${prey} fuit ${f}`).toBe(true);
    }
  });

  it('relations du jeu original', () => {
    const preyOf = (k: string) => HUNTS[k].flatMap((r) => (Array.isArray(r.prey) ? r.prey : []));
    expect(preyOf('wolf')).toEqual(expect.arrayContaining(['sheep', 'rabbit', 'fox', 'skeleton']));
    expect(preyOf('fox')).toContain('chicken');
    expect(preyOf('zombie')).toEqual(expect.arrayContaining(['villager', 'iron_golem']));
    expect(preyOf('llama')).toEqual(['wolf']);
    expect(FEARS.creeper).toEqual(expect.arrayContaining(['cat', 'ocelot']));
    expect(FEARS.skeleton).toContain('wolf');
    expect(HUNTS.frog[0].eat && HUNTS.frog[0].baby).toBe(true);
  });
});

describe('Spéléothèmes', () => {
  it('segments : pointe, tronc, milieu, base', () => {
    expect([0, 1, 2, 3].map((i) => dripSegment(i, 4))).toEqual([3, 2, 1, 0]);
    expect(dripSegment(0, 1)).toBe(0);
    expect([0, 1].map((i) => dripSegment(i, 2))).toEqual([1, 0]);
  });
});
