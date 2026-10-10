import type { DamageInfo, GameContext } from '../core/GameContext';
import { enchLevel } from '../inventory/Enchantments';
import { ArmorStand } from '../entities/ArmorStand';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { Mob, EntitySpawner } from '../entities/Mob';
import { Boss } from '../entities/Boss';
import { AIState } from '../ai/StateMachine';
import { hooks, type DamageEvent } from '../scripting/Hooks';
import { onMobHurtByMob } from '../entities/MobRelations';

/**
 * Application des dégâts aux créatures : faiblesses, coups critiques, invincibilité temporaire,
 * recul, réactions d'IA (fuite/colère/poursuite), mort, butin, XP, statistiques.
 */
export class DamageSystem {
  onBossDefeated: (boss: Boss) => void = () => {};
  onKill: (m: Mob) => void = () => {};

  constructor(private ctx: () => GameContext, private spawner: EntitySpawner) {}

  multiplier(m: Mob, src: DamageInfo): number {
    let k = 1;
    const item = src.itemId ? ItemRegistry.get(src.itemId) : undefined;
    const w = m.def.weakness;
    if (w && item?.tool) {
      const t = item.tool.type;
      if (t === 'pickaxe' || t === 'axe' || t === 'sword' || t === 'shovel') k *= w[t] ?? 1;
      if (item.tool.material === 'gold') k *= w.gold ?? 1;
    }
    if (w && src.fire) k *= w.fire ?? 1;
    if (item?.bonusVs?.[m.def.key]) k *= item.bonusVs[m.def.key];
    if (src.crit) k *= 1.5;
    return k;
  }

  damageMob(m: Mob, amount: number, src: DamageInfo): number {
    const ctx = this.ctx();
    if (m.dead || (m.iframes > 0 && src.kind !== 'environment')) return 0;
    // multijoueur : créature de l'hôte (invité) ou joueur distant : le coup part sur le réseau
    if (m.onNetHit) {
      if (src.kind === 'environment') return 0;
      const dmg = amount * this.multiplier(m, src);
      m.onNetHit(dmg, { kx: src.knockX ?? 0, kz: src.knockZ ?? 0, crit: !!src.crit, item: src.itemId ?? '' });
      m.iframes = 0.45;
      m.hurtTimer = 0.3;
      ctx.particles.burst('damage', m.x, m.y + m.body.height * 0.7, m.z, Math.min(10, 3 + Math.round(dmg)));
      ctx.audio.mobSound ? ctx.audio.mobSound(m.def.key, 'hurt', m.def.sounds.hurt || 'hurt', { x: m.x, y: m.y, z: m.z }) : ctx.audio.play(m.def.sounds.hurt || 'hurt', { x: m.x, y: m.y, z: m.z });
      return dmg;
    }
    // Wither : invulnérable pendant sa charge ; son armure arrête les projectiles
    const w = m as unknown as { invulnerable?: boolean; armored?: boolean };
    if (w.invulnerable) return 0;
    if (w.armored && src.kind === 'projectile') return 0;
    // créatures du Nether : insensibles au feu et à la lave
    if (src.fire && src.kind === 'environment' && m.has('fireImmune')) return 0;
    let dmg = amount * this.multiplier(m, src) * m.effects.damageMul(!!src.fire);
    // bots du serveur : armure et dernier attaquant (crédit des éliminations)
    const bot = m as unknown as { armorFactor?: number; lastAttacker?: unknown };
    if (bot.armorFactor !== undefined) {
      dmg *= bot.armorFactor;
      if (src.kind === 'player') bot.lastAttacker = 'player';
      else if (src.kind === 'bot' && src.attacker) bot.lastAttacker = src.attacker;
    }
    const ev = this.eventOf(src);
    if (hooks.beforeHurt) {
      dmg = hooks.beforeHurt(m, dmg, ev);
      if (!(dmg > 0)) return 0;
    }
    m.health -= dmg;
    if (src.kind !== 'environment') m.iframes = 0.45;
    m.hurtTimer = 0.3;
    const resist = m.has('knockbackResist') ? 0.25 : 1;
    if (src.knockX || src.knockZ) {
      m.body.vx += (src.knockX ?? 0) * resist;
      m.body.vz += (src.knockZ ?? 0) * resist;
      if (m.body.onGround) m.body.vy = Math.max(m.body.vy, 5 * resist);
    }
    ctx.particles.burst('damage', m.x, m.y + m.body.height * 0.7, m.z, Math.min(10, 3 + Math.round(dmg)));
    (m as unknown as { onHurt?: (c: GameContext) => void }).onHurt?.(ctx);
    // loups apprivoisés : défendent leur maître (attaquent ce que le joueur frappe)
    if (src.fromPlayer || src.kind === 'player')
      for (const o of (this.spawner as unknown as { mobs: Mob[] }).mobs ?? [])
        if (o !== m && o.def.key === 'wolf' && (o as unknown as { tamed?: boolean }).tamed && !(o as unknown as { sitting?: boolean }).sitting) (o as unknown as { target: Mob | null }).target = m;
    if (src.fromPlayer || src.kind === 'player') {
      if (m.def.category === 'passive') m.fleeTimer = 5;
      else if (m.def.category === 'neutral') {
        m.anger = 30;
        // piglins zombifiés : toute la bande alentour devient hostile
        if (m.has('groupAnger'))
          for (const o of (this.spawner as unknown as { mobs: Mob[] }).mobs ?? [])
            if (o !== m && !o.dead && o.def.key === m.def.key && Math.hypot(o.x - m.x, o.y - m.y, o.z - m.z) < 24) {
              o.anger = 30;
              o.ai.lastSeenX = ctx.player.x;
              o.ai.lastSeenZ = ctx.player.z;
              o.ai.fsm.set(AIState.CHASE);
            }
      }
      if (m.def.category !== 'passive') {
        m.ai.lastSeenX = ctx.player.x;
        m.ai.lastSeenZ = ctx.player.z;
        if (m.ai.state !== AIState.ATTACK) m.ai.fsm.set(AIState.CHASE);
      }
    }
    // frappée par une autre créature : vengeance ou fuite (relations du jeu original)
    const by = src.attacker as Mob | null | undefined;
    if (!src.fromPlayer && src.kind !== 'player' && by && (by as { kind?: string }).kind === 'mob' && 'def' in by) onMobHurtByMob(m, by);
    if (m instanceof Boss) m.onHit(ctx);
    hooks.afterHurt?.(m, dmg, ev);
    if (m.health <= 0) this.kill(m, src);
    else if (ctx.audio.mobSound) ctx.audio.mobSound(m.def.key, 'hurt', m.def.sounds.hurt, { x: m.x, y: m.y, z: m.z });
    else ctx.audio.play(m.def.sounds.hurt, { x: m.x, y: m.y, z: m.z });
    return dmg;
  }

  /** Description des dégâts pour l'API de script. */
  private eventOf(src: DamageInfo): DamageEvent {
    const fromPlayer = src.fromPlayer || src.kind === 'player';
    const cause = src.cause ?? (src.kind === 'player' ? 'entityAttack' : src.kind === 'projectile' ? 'projectile' : src.fire ? 'fire' : 'none');
    return { cause, attacker: src.attacker ?? (fromPlayer ? this.ctx().player : null), projectile: src.projectile ?? null };
  }

  private kill(m: Mob, src: DamageInfo) {
    const ctx = this.ctx();
    m.dead = true;
    m.health = 0;
    hooks.died?.(m, this.eventOf(src));
    m.ai.fsm.set(AIState.DEAD);
    if (ctx.audio.mobSound) ctx.audio.mobSound(m.def.key, 'death', m.def.sounds.death, { x: m.x, y: m.y, z: m.z });
    else ctx.audio.play(m.def.sounds.death, { x: m.x, y: m.y, z: m.z });
    ctx.particles.burst('smoke', m.x, m.y + m.body.height / 2, m.z, 12);
    // support d'armure : rend son armure et disparaît aussitôt (pas d'animation de mort)
    if (m instanceof ArmorStand) {
      m.dropExtra();
      m.removed = true;
      ctx.particles.burst('dust', m.x, m.y + 1, m.z, 16);
    }
    if (!m.baby) {
      // Butin : jusqu'à +1 objet par niveau, et plus de chances pour les objets rares
      const looting = src.fromPlayer || src.kind === 'player' ? enchLevel(ctx.player.inventory.selectedStack, 'looting') : 0;
      for (const d of m.def.drops) {
        if (d.chance !== undefined && Math.random() > d.chance + looting * 0.01) continue;
        const n = d.min + Math.floor(Math.random() * (d.max - d.min + 1)) + (looting ? Math.floor(Math.random() * (looting + 1)) : 0);
        if (n > 0) this.spawner.spawnItem(d.item, n, m.x, m.y + 0.5, m.z);
      }
    }
    if (src.fromPlayer || src.kind === 'player') {
      ctx.player.addXp(m.def.xp);
      ctx.stats.inc('kills');
      if (m.def.category === 'hostile' || m.def.category === 'boss') ctx.stats.inc('monstersKilled');
    }
    if (m.has('splits') && !m.baby) {
      for (let i = 0; i < 2; i++) {
        const c = this.spawner.spawnMob(m.def.key, m.x + (i ? 0.4 : -0.4), m.y + 0.3, m.z, { baby: true });
        if (c) c.health = 4;
      }
    }
    if (m instanceof Boss) this.onBossDefeated(m);
    this.onKill(m);
  }
}
