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
/** Délai d'attaque par défaut (main nue, objets sans vitesse d'attaque) : 4 attaques/s. */
export const HAND_COOLDOWN = 0.25;
/** Délais d'attaque (s) d'objets dont les données n'en fournissent pas (1 / vitesse d'attaque Java). */
const COOLDOWNS: Record<string, number> = { trident: 1 / 1.1 };

/** Délai d'attaque (s) de l'objet tenu. */
export function attackDelay(itemId: string | undefined, defCooldown?: number): number {
  return defCooldown ?? (itemId ? COOLDOWNS[itemId] : undefined) ?? HAND_COOLDOWN;
}

/** Charge d'attaque (Player.getAttackStrengthScale(0,5)) : temps depuis la dernière attaque / délai, en ticks. */
export function attackCharge(sinceAttack: number, delay: number): number {
  return Math.max(0, Math.min(1, (sinceAttack * 20 + 0.5) / Math.max(1e-6, delay * 20)));
}

/** Multiplicateur des dégâts de base selon la charge : 0,2 + 0,8·charge² (Java 1.9+). */
export function chargeScale(charge: number): number {
  return 0.2 + charge * charge * 0.8;
}

/**
 * Combat du joueur (Player.attack, Java 1.21) : charge d'attaque (dégâts ×(0,2 + 0,8·charge²),
 * enchantements ×charge), coup critique ×1,5 (en chute, sans sprint, charge > 0,9), coup de
 * sprint (recul), balayage de l'épée, usure de l'arme. Les dégâts reçus par le joueur sont gérés
 * par Player.damage().
 *
 * Commandes : un appui frappe aussitôt avec la charge du moment (comme un clic du jeu de
 * référence) ; maintenir l'attaque (mobile) frappe à chaque charge complète.
 */
export class CombatSystem {
  /** Temps restant avant la charge complète (s) ; utilisé aussi par le sceptre. */
  cooldown = 0;
  /** Dernier coup (animation de l'objet en main). */
  swing = 0;
  /** Temps écoulé depuis la dernière attaque (s) et délai de l'arme utilisée. */
  sinceAttack = 10;
  delay = HAND_COOLDOWN;
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

  /** Charge d'attaque actuelle (0..1) pour l'objet tenu. */
  charge(itemId?: string, defCooldown?: number): number {
    return attackCharge(this.sinceAttack, attackDelay(itemId, defCooldown));
  }

  /** Attaque de mêlée du joueur. Retourne vrai si un coup a été porté. */
  playerAttack(ctx: GameContext, m: Mob): boolean {
    if (m.dead) return false;
    const p = ctx.player;
    const stack = p.inventory.selectedStack;
    const def = stack ? ItemRegistry.get(stack.id) : undefined;
    const delay = attackDelay(stack?.id, def?.attackCooldown);
    const charge = attackCharge(this.sinceAttack, delay);
    // appel continu (attaque maintenue) : on attend la charge complète
    const held = this.clock - this.lastCall < 0.12;
    this.lastCall = this.clock;
    if (held && charge < 1) return false;
    // le sceptre (cooldown propre) bloque aussi la mêlée
    if (this.cooldown > 0 && this.sinceAttack >= this.delay) return false;
    const full = charge > 0.9;
    let base = Math.max(0, (def?.damage ?? 1) + p.effects.attackBonus()) * chargeScale(charge);
    const ench = bonusDamage(stack, m.def.key) * charge;
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
    if (stack?.id === 'trident' && (m.has('aquatic') || m.body.inWater)) impale = 2.5 * enchLevel(stack, 'impaling') * charge;
    this.sinceAttack = 0;
    this.delay = delay;
    this.cooldown = delay;
    this.swing = 1;
    const sprintHit = p.sprinting && full;
    // coup critique : charge > 0,9, en chute, ni au sol, ni sur une échelle, ni dans l'eau, ni aveuglé, ni en sprint
    const crit = full && (p.body.fallDistance ?? 0) > 0 && p.body.vy < 0 && !p.body.onGround && !p.body.onLadder && !p.body.inWater && !p.effects.level('blindness') && !p.sprinting;
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
      } else if (/_sword$/.test(stack?.id ?? '') && full && p.body.onGround && !sprintHit && !crit && Math.hypot(p.body.vx, p.body.vz) < 3.4) {
        // balayage de l'épée (Java : charge > 0,9, au sol, presque immobile, sans critique ni coup de sprint) :
        // 1 + base × Affilage/(Affilage+1) aux créatures proches de la cible, à moins de 3 blocs du joueur
        const sw = enchLevel(stack, 'sweeping_edge');
        const sweepDmg = 1 + Math.max(0, (def?.damage ?? 1) + p.effects.attackBonus()) * chargeScale(charge) * (sw / (sw + 1));
        let swept = 0;
        for (const o of near) {
          if (Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z) > 3) continue;
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
