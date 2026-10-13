import type { DamageInfo, GameContext } from '../core/GameContext';
import { bonusDamage, enchLevel, isEnchanted } from '../inventory/Enchantments';
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
    let base = Math.max(0, (def?.damage ?? 1) + p.effects.attackBonus() + bonusDamage(stack, m.def.key));
    // masse : attaque écrasante — dégâts selon la hauteur de chute (comme le jeu original :
    // +4 par bloc pour les 3 premiers, +2 pour les 5 suivants, +1 au-delà ; Densité +0,5 par bloc)
    const fall = p.body.fallDistance ?? 0;
    const smash = stack?.id === 'mace' && fall > 1.5 && !p.body.onGround;
    if (smash) {
      base += 4 * Math.min(3, fall) + 2 * Math.max(0, Math.min(5, fall - 3)) + Math.max(0, fall - 8) + 0.5 * enchLevel(stack, 'density') * fall;
      // Brèche : les créatures ne portent pas d'armure ici ; le bonus s'applique aux dégâts
      base *= 1 + 0.15 * enchLevel(stack, 'breach');
    }
    // Empalement (trident) : bonus contre les créatures aquatiques
    if (stack?.id === 'trident' && (m.has('aquatic') || m.body.inWater)) base += 2.5 * enchLevel(stack, 'impaling');
    this.cooldown = def?.attackCooldown ?? 0.4;
    this.swing = 1;
    const crit = !p.body.onGround && p.body.vy < -1 && !p.body.inWater;
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
    const kb = (stack?.id === 'golem_mace' ? 14 : p.sprinting ? 9 : 5) + enchLevel(stack, 'knockback') * 6;
    const dealt = this.damage.damageMob(m, base, { kind: 'player', itemId: stack?.id, knockX: (dx / d) * kb, knockZ: (dz / d) * kb, fromPlayer: true, crit });
    hooks.hitEntity?.(m, stack ?? null);
    if (dealt > 0) {
      // Aura de feu : la créature brûle (4 s par niveau)
      const fa = enchLevel(stack, 'fire_aspect');
      if (fa && !m.has('fireImmune')) m.fireTime = Math.max(m.fireTime, 4 * fa);
      if (isEnchanted(stack)) ctx.particles.burst('enchanted_hit', m.x, m.y + m.body.height * 0.6, m.z, 10);
      const near = ((ctx as unknown as { entities?: { mobs: Mob[] } }).entities?.mobs ?? []).filter((o) => o !== m && !o.dead && Math.hypot(o.x - m.x, o.z - m.z) < 2.5 && Math.abs(o.y - m.y) < 1.5);
      if (smash) {
        // l'onde de choc repousse les créatures proches, la chute est amortie
        p.body.fallDistance = 0;
        ctx.audio.play('explode', { x: m.x, y: m.y, z: m.z, volume: 0.5, pitch: 1.4 });
        ctx.particles.burst('dust', m.x, m.y + 0.1, m.z, 20);
        for (const o of near) {
          const ox = o.x - m.x, oz = o.z - m.z, od = Math.hypot(ox, oz) || 1;
          o.body.vx += (ox / od) * 7;
          o.body.vz += (oz / od) * 7;
          o.body.vy = Math.max(o.body.vy, 5);
        }
        // Explosion de vent : le joueur rebondit vers le haut
        const wb = enchLevel(stack, 'wind_burst');
        if (wb) {
          p.body.vy = 9 + 3.5 * wb;
          ctx.particles.burst('poof', p.x, p.y, p.z, 16);
        }
      } else if (def?.tool?.type === 'sword' && !['mace', 'bow', 'crossbow'].includes(stack?.id ?? '') && p.body.onGround && !p.sprinting && !crit) {
        // balayage de l'épée (comme le jeu original) : les créatures autour de la cible sont touchées
        const sw = enchLevel(stack, 'sweeping_edge');
        const sweepDmg = 1 + base * (sw / (sw + 1));
        let swept = 0;
        for (const o of near) {
          if (Math.hypot(o.x - p.x, o.z - p.z) > 4) continue;
          const ox = o.x - p.x, oz = o.z - p.z, od = Math.hypot(ox, oz) || 1;
          this.damage.damageMob(o, sweepDmg, { kind: 'player', itemId: stack?.id, knockX: (ox / od) * 3, knockZ: (oz / od) * 3, fromPlayer: true });
          swept++;
        }
        // l'arc de balayage apparaît à chaque coup d'épée au sol (comme le jeu original)
        ctx.particles.burst('sweep', p.x + (dx / d) * 1.2, p.y + 1, p.z + (dz / d) * 1.2, 1);
        if (swept) ctx.audio.play('hit', { x: m.x, y: m.y, z: m.z, pitch: 1.3 });
      }
      ctx.audio.play(crit ? 'crit' : 'hit', { x: m.x, y: m.y, z: m.z });
      // étincelles beiges du coup critique (comme le jeu original)
      if (crit) ctx.particles.burst('crit', m.x, m.y + m.body.height * 0.6, m.z, 16);
      ctx.haptic('light');
      if (def?.tool) p.inventory.damageSelected(def.tool.type === 'sword' ? 1 : 2);
      p.addExhaustion(0.1);
      if (p.sprinting) p.sprinting = false;
    }
    return dealt > 0;
  }
}
