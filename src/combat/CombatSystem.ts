import type { DamageInfo, GameContext } from '../core/GameContext';
import { bonusDamage, enchLevel, isEnchanted } from '../inventory/Enchantments';
import { hooks } from '../scripting/Hooks';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { Mob } from '../entities/Mob';
import type { DamageSystem } from './DamageSystem';

/**
 * Combat du joueur, règles de Minecraft Bedrock : pas de recharge d'attaque (chaque coup porte
 * ses dégâts complets, la cadence n'est limitée que par l'invulnérabilité de la cible), pas de
 * balayage d'épée, coup critique ×1,5 en chute, coup de sprint (recul), usure de l'arme.
 * Les dégâts reçus par le joueur sont gérés par Player.damage().
 */
/** Intervalle minimal entre deux coups (s) : un toucher frappe aussitôt. */
export const TAP_INTERVAL = 0.05;
/** Attaque maintenue (mobile) : un coup toutes les 0,25 s, comme le geste répété de Bedrock. */
export const HELD_INTERVAL = 0.25;

export class CombatSystem {
  /** Recharge d'un objet à usage propre (sceptre) ; la mêlée Bedrock n'en a pas. */
  cooldown = 0;
  /** Dernier coup (animation de l'objet en main). */
  swing = 0;
  /** Temps écoulé depuis la dernière attaque (s). */
  sinceAttack = 10;
  private clock = 0;
  private lastCall = -1;

  constructor(private damage: DamageSystem) {}

  update(dt: number) {
    this.clock += dt;
    this.sinceAttack += dt;
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
    if (m.dead) return false;
    const p = ctx.player;
    const stack = p.inventory.selectedStack;
    const def = stack ? ItemRegistry.get(stack.id) : undefined;
    // appel continu (attaque maintenue) : un coup toutes les 0,25 s ; un toucher frappe aussitôt
    const held = this.clock - this.lastCall < 0.12;
    this.lastCall = this.clock;
    if (this.sinceAttack < (held ? HELD_INTERVAL : TAP_INTERVAL)) return false;
    let base = Math.max(0, (def?.damage ?? 1) + p.effects.attackBonus());
    const ench = bonusDamage(stack, m.def.key);
    let bonus = 0;
    // masse : attaque écrasante — dégâts selon la hauteur de chute (comme le jeu original :
    // +4 par bloc pour les 3 premiers, +2 pour les 5 suivants, +1 au-delà ; Densité +0,5 par bloc)
    const fall = p.body.fallDistance ?? 0;
    const smash = stack?.id === 'mace' && fall > 1.5 && !p.body.onGround && !p.gliding;
    if (smash) {
      bonus += 4 * Math.min(3, fall) + 2 * Math.max(0, Math.min(5, fall - 3)) + Math.max(0, fall - 8) + 0.5 * enchLevel(stack, 'density') * fall;
      // Brèche : les créatures ne portent pas d'armure ici ; le bonus s'applique aux dégâts
      bonus *= 1 + 0.15 * enchLevel(stack, 'breach');
    }
    // Empalement (trident) : bonus contre les créatures aquatiques
    let impale = 0;
    if (stack?.id === 'trident' && (m.has('aquatic') || m.body.inWater)) impale = 2.5 * enchLevel(stack, 'impaling');
    this.sinceAttack = 0;
    this.swing = 1;
    const sprintHit = p.sprinting;
    // coup critique : en chute, ni au sol, ni sur une échelle, ni dans l'eau, ni aveuglé, ni en sprint
    const crit = (p.body.fallDistance ?? 0) > 0 && p.body.vy < 0 && !p.body.onGround && !p.body.onLadder && !p.body.inWater && !p.effects.level('blindness') && !p.sprinting;
    // le ×1,5 du critique (appliqué par DamageSystem à tout le montant) ne porte que sur la base
    base += crit ? (ench + impale + bonus) / 1.5 : ench + impale + bonus;
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
    const kb = (stack?.id === 'golem_mace' ? 14 : sprintHit ? 9 : 5) + enchLevel(stack, 'knockback') * 6;
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
      }
      ctx.audio.play(crit ? 'crit' : 'hit', { x: m.x, y: m.y, z: m.z });
      // étincelles beiges du coup critique (comme le jeu original)
      if (crit) ctx.particles.burst('crit', m.x, m.y + m.body.height * 0.6, m.z, 16);
      ctx.haptic('light');
      if (def?.tool) p.inventory.damageSelected(def.tool.type === 'sword' ? 1 : 2);
      p.addExhaustion(0.1);
      // coup de sprint ou Recul : le joueur ralentit (×0,6) et cesse de sprinter
      if (sprintHit || enchLevel(stack, 'knockback')) {
        p.body.vx *= 0.6;
        p.body.vz *= 0.6;
        p.sprinting = false;
      }
    }
    return dealt > 0;
  }
}
