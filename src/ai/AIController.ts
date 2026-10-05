import type { GameContext } from '../core/GameContext';
import type { Mob } from '../entities/Mob';
import { raycastBlocks } from '../util/Raycast';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { AIState, StateMachine, type StateHandlers } from './StateMachine';

/**
 * Contrôleur d'IA : perception (distance, ligne de vue), déplacement (steering simple,
 * saut d'obstacles, évitement des falaises et liquides) et machine à états selon la catégorie.
 * Les boss surchargent les états CHASE/ATTACK via des handlers personnalisés.
 */
export class AIController {
  readonly fsm: StateMachine<Mob>;
  targetX = 0;
  targetZ = 0;
  hasTarget = false;
  lastSeenX = 0;
  lastSeenZ = 0;
  canSee = false;
  private losTimer = 0;
  private stuckTimer = 0;
  speedMul = 1;
  ctx!: GameContext;

  constructor(readonly mob: Mob, overrides: Partial<Record<AIState, StateHandlers<Mob>>> = {}) {
    this.fsm = new StateMachine<Mob>({ ...defaultHandlers(this), ...overrides }, mob);
    this.fsm.set(AIState.WANDER);
  }

  get state() {
    return this.fsm.state;
  }

  update(ctx: GameContext, dt: number) {
    this.ctx = ctx;
    const m = this.mob;
    if (m.dead) {
      this.fsm.set(AIState.DEAD);
      return;
    }
    // perception (ligne de vue limitée en fréquence)
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.35 + Math.random() * 0.2;
      this.canSee = this.lineOfSight(ctx);
      if (this.canSee) {
        this.lastSeenX = ctx.player.x;
        this.lastSeenZ = ctx.player.z;
      }
    }
    this.fsm.update(dt);
  }

  get playerDist() {
    return this.mob.distToPlayer;
  }

  lineOfSight(ctx: GameContext): boolean {
    const m = this.mob, p = ctx.player;
    if (p.dead || p.creative) return false;
    const d = this.playerDist;
    if (d > m.def.detectionRange) return false;
    const ex = m.x, ey = m.y + m.body.height * 0.85, ez = m.z;
    const px = p.x, py = p.y + p.eyeHeight, pz = p.z;
    const dx = px - ex, dy = py - ey, dz = pz - ez;
    const len = Math.hypot(dx, dy, dz) || 1;
    const hit = raycastBlocks(ctx.world, ex, ey, ez, dx / len, dy / len, dz / len, len);
    if (!hit) return true;
    // les blocs non opaques (feuilles, verre) ne bloquent pas la vue
    return !BlockRegistry.opaque[hit.block];
  }

  /** Avance vers (x, z). Retourne la distance restante. */
  moveTowards(x: number, z: number, speedMul = 1, avoidCliffs = true): number {
    const m = this.mob, b = m.body;
    const dx = x - m.x, dz = z - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      this.stop();
      return d;
    }
    const sp = m.def.speed * speedMul * this.speedMul * (m.baby ? 1.2 : 1) * (m.slowTimer > 0 ? 0.5 : 1);
    let vx = (dx / d) * sp, vz = (dz / d) * sp;
    if (avoidCliffs && b.onGround && !m.has('flies')) {
      const ax = Math.floor(m.x + (dx / d) * (b.halfWidth + 0.6)), az = Math.floor(m.z + (dz / d) * (b.halfWidth + 0.6));
      const w = this.ctx.world;
      let drop = 0;
      for (let y = Math.floor(m.y) - 1; y > Math.floor(m.y) - 5; y--) {
        if (w.isSolid(ax, y, az)) break;
        drop++;
      }
      const ahead = w.getBlock(ax, Math.floor(m.y), az);
      const below = w.getBlock(ax, Math.floor(m.y) - 1, az);
      const danger = (ahead > 0 && BlockRegistry.liquid[ahead] === 2) || (below > 0 && BlockRegistry.liquid[below] === 2) || (below > 0 && BlockRegistry.blocks[below].contactDamage > 0);
      if (drop >= 4 || danger) {
        vx = vz = 0;
        this.hasTarget = false;
      }
    }
    b.vx += (vx - b.vx) * 0.35;
    b.vz += (vz - b.vz) * 0.35;
    m.yaw = Math.atan2(dx, dz);
    // saut d'obstacle / escalade / sautillement
    if (b.collidedH && (b.onGround || b.inWater)) {
      if (m.has('climbs')) b.vy = 4;
      else b.vy = 8.2;
      this.stuckTimer += 0.1;
    }
    if (b.inWater && !m.has('flies')) b.vy = Math.max(b.vy, 1.5);
    if (m.has('hops') && b.onGround && Math.random() < 0.08) b.vy = 7;
    return d;
  }

  stop() {
    const b = this.mob.body;
    b.vx *= 0.5;
    b.vz *= 0.5;
  }

  /** Choisit une destination aléatoire autour du point d'origine. */
  pickWanderTarget(radius = 8) {
    const m = this.mob;
    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * radius;
    let tx = m.x + Math.cos(a) * r, tz = m.z + Math.sin(a) * r;
    // rester près de la maison
    if (Math.hypot(tx - m.homeX, tz - m.homeZ) > 20) {
      tx = m.homeX + (Math.random() - 0.5) * 8;
      tz = m.homeZ + (Math.random() - 0.5) * 8;
    }
    this.targetX = tx;
    this.targetZ = tz;
    this.hasTarget = true;
  }

  facePlayer() {
    const p = this.ctx.player;
    this.mob.yaw = Math.atan2(p.x - this.mob.x, p.z - this.mob.z);
  }
}

function isHostile(m: Mob, ctx?: GameContext) {
  if (m.anger > 0) return true;
  if (m.def.category === 'neutral') return false;
  // les araignées sont neutres en pleine lumière (comportement vanilla)
  if (m.has('neutralInDay') && ctx) {
    const l = ctx.world.getLight(Math.floor(m.x), Math.floor(m.y + 0.5), Math.floor(m.z));
    if (Math.round(l.sky * ctx.dayCycle.daylight) > 11) return false;
  }
  return m.def.category === 'hostile' || m.def.category === 'boss';
}

function defaultHandlers(ai: AIController): Partial<Record<AIState, StateHandlers<Mob>>> {
  const wantsChase = (m: Mob) => isHostile(m, ai.ctx) && ai.canSee && ai.playerDist <= m.def.detectionRange && !ai.ctx.player.dead;
  const wantsFollow = (m: Mob) => {
    if (!m.def.food || m.def.category === 'hostile') return false;
    const held = ai.ctx.player.inventory.selectedStack;
    return !!held && m.def.food.includes(held.id) && ai.playerDist < 10 && !ai.ctx.player.dead;
  };
  return {
    [AIState.IDLE]: {
      enter: (m) => (m.idleTime = 1 + Math.random() * 4),
      update: (m) => {
        ai.stop();
        if (m.fleeTimer > 0) return AIState.FLEE;
        if (wantsChase(m)) return AIState.CHASE;
        if (wantsFollow(m)) return AIState.FOLLOW;
        if (ai.fsm.timeInState > m.idleTime) return AIState.WANDER;
      },
    },
    [AIState.WANDER]: {
      enter: () => ai.pickWanderTarget(),
      update: (m) => {
        if (m.fleeTimer > 0) return AIState.FLEE;
        if (wantsChase(m)) return AIState.CHASE;
        if (wantsFollow(m)) return AIState.FOLLOW;
        if (!ai.hasTarget) return AIState.IDLE;
        const d = ai.moveTowards(ai.targetX, ai.targetZ, 0.6);
        if (d < 0.6 || ai.fsm.timeInState > 8) return AIState.IDLE;
        if (Math.hypot(m.x - m.homeX, m.z - m.homeZ) > 28 && m.def.category !== 'passive') return AIState.RETURN;
      },
    },
    [AIState.FOLLOW]: {
      update: (m) => {
        if (m.fleeTimer > 0) return AIState.FLEE;
        if (!wantsFollow(m)) return AIState.IDLE;
        const p = ai.ctx.player;
        if (ai.playerDist > 2.2) ai.moveTowards(p.x, p.z, 0.9);
        else {
          ai.stop();
          ai.facePlayer();
        }
      },
    },
    [AIState.FLEE]: {
      update: (m, dt) => {
        m.fleeTimer -= dt;
        if (m.fleeTimer <= 0) return AIState.WANDER;
        const p = ai.ctx.player;
        const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
        ai.moveTowards(m.x + (dx / d) * 6, m.z + (dz / d) * 6, 1.6);
      },
    },
    [AIState.CHASE]: {
      update: (m) => {
        if (ai.ctx.player.dead) return AIState.RETURN;
        if (!isHostile(m, ai.ctx)) return AIState.WANDER;
        if (!ai.canSee) return AIState.SEARCH;
        const p = ai.ctx.player;
        const range = m.def.ranged ? Math.min(m.def.ranged.range, m.def.attackRange) : m.def.attackRange;
        if (ai.playerDist <= range) return AIState.ATTACK;
        ai.moveTowards(p.x, p.z, 1, false);
      },
    },
    [AIState.ATTACK]: {
      update: (m) => {
        const p = ai.ctx.player;
        if (p.dead) return AIState.RETURN;
        if (!isHostile(m, ai.ctx)) return AIState.WANDER;
        ai.facePlayer();
        if (m.def.ranged) {
          if (!ai.canSee) return AIState.SEARCH;
          if (ai.playerDist > m.def.ranged.range) return AIState.CHASE;
          // garde ses distances
          if (ai.playerDist < 4) {
            const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
            ai.moveTowards(m.x + (dx / d) * 3, m.z + (dz / d) * 3, 0.8);
            m.yaw = Math.atan2(p.x - m.x, p.z - m.z);
          } else ai.stop();
          if (m.attackTimer <= 0) m.rangedAttack(ai.ctx);
        } else {
          if (ai.playerDist > m.def.attackRange * 1.15) return AIState.CHASE;
          ai.moveTowards(p.x, p.z, 0.6, false);
          if (m.attackTimer <= 0) m.meleeAttack(ai.ctx);
        }
      },
    },
    [AIState.SEARCH]: {
      update: (m) => {
        if (wantsChase(m)) return AIState.CHASE;
        const d = ai.moveTowards(ai.lastSeenX, ai.lastSeenZ, 0.8);
        if (d < 1 || ai.fsm.timeInState > 6) return AIState.RETURN;
      },
    },
    [AIState.RETURN]: {
      update: (m) => {
        if (wantsChase(m)) return AIState.CHASE;
        const d = ai.moveTowards(m.homeX, m.homeZ, 0.7);
        if (d < 2 || ai.fsm.timeInState > 15) return AIState.WANDER;
      },
    },
    [AIState.DEAD]: { update: () => ai.stop() },
  };
}
