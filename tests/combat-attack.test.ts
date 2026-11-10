import { describe, expect, it } from 'vitest';
import { CombatSystem } from '../src/combat/CombatSystem';
import { Player } from '../src/player/Player';
import { makeStack } from '../src/inventory/Inventory';
import type { DamageSystem } from '../src/combat/DamageSystem';
import type { GameContext } from '../src/core/GameContext';
import type { Mob } from '../src/entities/Mob';

/** Attaque du joueur selon les règles de Minecraft Bedrock (pas de recharge d'attaque). */
function setup(item?: string) {
  const hits: { amount: number; crit: boolean; kb: number }[] = [];
  const dmg = {
    damageMob: (_m: Mob, amount: number, src: { crit?: boolean; knockX?: number; knockZ?: number }) => {
      hits.push({ amount: amount * (src.crit ? 1.5 : 1), crit: !!src.crit, kb: Math.hypot(src.knockX ?? 0, src.knockZ ?? 0) });
      return amount;
    },
  } as unknown as DamageSystem;
  const combat = new CombatSystem(dmg);
  const p = new Player('survival', 'normal');
  p.body.onGround = true;
  if (item) p.inventory.slots[p.inventory.selected] = makeStack(item);
  const ctx = { player: p, particles: { burst() {} }, audio: { play() {} }, haptic() {} } as unknown as GameContext;
  const mob = { dead: false, x: 0, y: 0, z: -2, def: { key: 'zombie' }, has: () => false, body: { inWater: false, height: 1.95 }, fireTime: 0 } as unknown as Mob;
  const wait = (s: number) => {
    for (let t = 0; t < s - 1e-9; t += 0.05) combat.update(0.05);
  };
  return { combat, p, ctx, mob, hits, wait };
}

describe('Attaque du joueur (Bedrock)', () => {
  it('épée en diamant : 7 dégâts à chaque coup, même enchaînés', () => {
    const { combat, ctx, mob, hits, wait } = setup('diamond_sword');
    expect(combat.playerAttack(ctx, mob)).toBe(true);
    expect(hits[0].amount).toBeCloseTo(7, 5);
    wait(0.2);
    combat.playerAttack(ctx, mob);
    expect(hits[1].amount).toBeCloseTo(7, 5);
  });
  it('attaque maintenue : un coup plein toutes les 0,25 s', () => {
    const { combat, ctx, mob, hits } = setup();
    let n = 0;
    for (let k = 0; k < 60; k++) {
      combat.update(1 / 60);
      if (combat.playerAttack(ctx, mob)) n++;
    }
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(5);
    for (const h of hits) expect(h.amount).toBeCloseTo(1, 5);
  });
  it('critique ×1,5 en chute (pas en sprint, pas au sol)', () => {
    const { combat, p, ctx, mob, hits, wait } = setup('iron_sword');
    wait(1);
    p.body.onGround = false;
    p.body.vy = -3;
    p.body.fallDistance = 0.5;
    combat.playerAttack(ctx, mob);
    expect(hits[0].crit).toBe(true);
    expect(hits[0].amount).toBeCloseTo(9, 5);
    wait(1);
    p.sprinting = true;
    combat.playerAttack(ctx, mob);
    expect(hits[1].crit).toBe(false);
    expect(hits[1].amount).toBeCloseTo(6, 5);
  });
  it('coup de sprint : recul plus fort, le joueur ralentit et cesse de sprinter', () => {
    const { combat, p, ctx, mob, hits, wait } = setup('iron_sword');
    wait(1);
    combat.playerAttack(ctx, mob);
    wait(1);
    p.sprinting = true;
    p.body.vz = -5;
    combat.playerAttack(ctx, mob);
    expect(hits[1].kb).toBeGreaterThan(hits[0].kb);
    expect(p.sprinting).toBe(false);
    expect(p.body.vz).toBeCloseTo(-3, 5);
  });
  it('pas de recharge : hache et trident frappent sans délai', () => {
    const { combat, ctx, mob, wait } = setup('wooden_axe');
    combat.playerAttack(ctx, mob);
    expect(combat.cooldown).toBe(0);
    wait(0.15);
    expect(combat.playerAttack(ctx, mob)).toBe(true);
  });
});
