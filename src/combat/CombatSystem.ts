import type { DamageInfo, GameContext } from '../core/GameContext';
import { hooks } from '../scripting/Hooks';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { Mob } from '../entities/Mob';
import type { DamageSystem } from './DamageSystem';

/**
 * Combat du joueur : cadence d'attaque (cooldown), dégâts de l'objet tenu, coups critiques
 * (en chute), recul, usure de l'arme. Les dégâts reçus par le joueur sont gérés par Player.damage().
 */
export class CombatSystem {
  cooldown = 0;
  /** Dernier coup (animation de l'objet en main). */
  swing = 0;

  constructor(private damage: DamageSystem) {}

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swing = Math.max(0, this.swing - dt * 4);
  }

  damageMob(m: Mob, amount: number, src: DamageInfo) {
    return this.damage.damageMob(m, amount, src);
  }

  get ready() {
    return this.cooldown <= 0;
  }

  /** Attaque de mêlée du joueur. Retourne vrai si un coup a été porté. */
  playerAttack(ctx: GameContext, m: Mob): boolean {
    if (!this.ready || m.dead) return false;
    const p = ctx.player;
    const stack = p.inventory.selectedStack;
    const def = stack ? ItemRegistry.get(stack.id) : undefined;
    const base = Math.max(0, (def?.damage ?? 1) + p.effects.attackBonus());
    this.cooldown = def?.attackCooldown ?? 0.4;
    this.swing = 1;
    const crit = !p.body.onGround && p.body.vy < -1 && !p.body.inWater;
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
    const kb = stack?.id === 'golem_mace' ? 14 : p.sprinting ? 9 : 5;
    const dealt = this.damage.damageMob(m, base, { kind: 'player', itemId: stack?.id, knockX: (dx / d) * kb, knockZ: (dz / d) * kb, fromPlayer: true, crit });
    hooks.hitEntity?.(m, stack ?? null);
    if (dealt > 0) {
      ctx.audio.play(crit ? 'crit' : 'hit', { x: m.x, y: m.y, z: m.z });
      if (crit) ctx.particles.burst('magic', m.x, m.y + m.body.height, m.z, 6);
      ctx.haptic('light');
      if (def?.tool) p.inventory.damageSelected(def.tool.type === 'sword' ? 1 : 2);
      p.addExhaustion(0.1);
      if (p.sprinting) p.sprinting = false;
    }
    return dealt > 0;
  }
}
