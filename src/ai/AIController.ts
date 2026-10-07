import type { GameContext } from '../core/GameContext';
import type { Mob } from '../entities/Mob';
import { raycastBlocks } from '../util/Raycast';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { AIState, StateMachine, type StateHandlers } from './StateMachine';
import { findPath } from './Pathfinder';

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
  lastSeenY = 0;
  private dt = 0.05;
  /** Chemin courant (cellules) et prochaine étape. */
  path: [number, number, number][] | null = null;
  private pathIdx = 0;
  private repath = 0;
  private goal: [number, number, number] = [0, 0, 0];

  constructor(readonly mob: Mob, overrides: Partial<Record<AIState, StateHandlers<Mob>>> = {}) {
    this.fsm = new StateMachine<Mob>({ ...defaultHandlers(this), ...overrides }, mob);
    this.fsm.set(AIState.WANDER);
  }

  get state() {
    return this.fsm.state;
  }

  update(ctx: GameContext, dt: number) {
    this.ctx = ctx;
    this.dt = dt;
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
        this.lastSeenY = ctx.player.y;
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
    const sp = m.def.speed * speedMul * this.speedMul * (m.baby ? 1.2 : 1) * (m.slowTimer > 0 ? 0.5 : 1) * m.effects.speedMul();
    let vx = (dx / d) * sp, vz = (dz / d) * sp;
    if (avoidCliffs && b.onGround && !m.has('flies')) {
      const ax = Math.floor(m.x + (dx / d) * (b.halfWidth + 0.6)), az = Math.floor(m.z + (dz / d) * (b.halfWidth + 0.6));
      const w = this.ctx.world;
      let drop = 0;
      for (let y = Math.floor(m.y) - 1; y > Math.floor(m.y) - 5; y--) {
        if (w.isSolid(ax, y, az)) break;
        // de l'eau dessous : on peut y entrer (pas une falaise)
        const lb = w.getBlock(ax, y, az);
        if (lb > 0 && BlockRegistry.liquid[lb] === 1) break;
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
      else b.vy = 9.2;
      this.stuckTimer += 0.1;
    }
    if (b.inWater && !m.has('flies')) b.vy = Math.max(b.vy, 1.5);
    if (m.has('hops') && b.onGround && Math.random() < 0.08) b.vy = 7;
    return d;
  }

  /**
   * Se rend en (x, y, z) en suivant un chemin A* (recalculé régulièrement ou si la cible bouge).
   * Les créatures volantes ou aquatiques vont en ligne droite. Retourne la distance restante.
   */
  navigateTo(x: number, y: number, z: number, speedMul = 1): number {
    const m = this.mob;
    const direct = Math.hypot(x - m.x, z - m.z);
    if (m.has('flies') || m.has('aquatic') || !this.ctx) return this.moveTowards(x, z, speedMul, false);
    const gx = Math.floor(x), gy = Math.floor(y), gz = Math.floor(z);
    this.repath -= this.dt;
    const moved = Math.abs(gx - this.goal[0]) + Math.abs(gz - this.goal[2]) + Math.abs(gy - this.goal[1]) > 1;
    if (!this.path || this.repath <= 0 || (moved && this.repath < 0.5)) {
      this.goal = [gx, gy, gz];
      this.repath = 0.6 + Math.random() * 0.5;
      const w = this.ctx.world;
      this.path = findPath(w, Math.floor(m.x), Math.floor(m.y + 0.05), Math.floor(m.z), gx, gy, gz, {
        height: Math.ceil(m.body.height - 0.01),
        maxNodes: direct > 20 ? 1000 : direct > 10 ? 700 : 450,
        waterCost: m.has('burnsInSun') ? 1 : 3,
      });
      this.pathIdx = 0;
    }
    const path = this.path;
    // fin du chemin (ou chemin partiel : cible inaccessible) : approche directe sans sauter d'une falaise
    if (!path || this.pathIdx >= path.length) return this.moveTowards(x, z, speedMul, true);
    // étape suivante : on la valide quand on est sur sa case
    let [px, py, pz] = path[this.pathIdx];
    if (Math.floor(m.x) === px && Math.floor(m.z) === pz && Math.abs(Math.floor(m.y + 0.05) - py) <= 1) {
      this.pathIdx++;
      if (this.pathIdx >= path.length) return this.moveTowards(x, z, speedMul, true);
      [px, py, pz] = path[this.pathIdx];
    }
    this.moveTowards(px + 0.5, pz + 0.5, speedMul, false);
    // marche montante : saut anticipé (sans attendre de cogner le bloc)
    const b = m.body;
    // dans l'eau : on nage vers le haut (comme un joueur qui maintient « sauter ») pour sortir sur la rive
    if (b.inWater && (py >= Math.floor(m.y + 0.05) || b.collidedH)) b.vy = Math.max(b.vy, 5);
    if (py > Math.floor(m.y + 0.05) && b.onGround && Math.hypot(px + 0.5 - m.x, pz + 0.5 - m.z) < 1.3 && Math.hypot(b.vx, b.vz) > 0.4) b.vy = 9.2;
    return direct;
  }

  /** Abandonne le chemin courant (changement d'objectif). */
  clearPath() {
    this.path = null;
    this.repath = 0;
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

  /** Hauteur des pieds sur la surface en (x, z) (au plus quelques blocs au-dessus de la créature). */
  surfaceY(x: number, z: number) {
    return this.ctx.world.surfaceBelow(Math.floor(x), Math.floor(this.mob.y) + 4, Math.floor(z)) + 1;
  }

  /**
   * Abri du soleil (créatures qui brûlent) : case voisine sans ciel au-dessus, sinon null.
   * Échantillonnage autour de la créature, comme le « chercher de l'ombre » du jeu original.
   */
  findShade(): [number, number] | null {
    const m = this.mob, w = this.ctx.world;
    for (let t = 0; t < 14; t++) {
      const x = Math.floor(m.x + (Math.random() - 0.5) * 20), z = Math.floor(m.z + (Math.random() - 0.5) * 20);
      const y = this.surfaceY(x, z);
      if (Math.abs(y - m.y) > 4) continue;
      if (w.getLight(x, y, z).sky < 14) return [x + 0.5, z + 0.5];
    }
    return null;
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
      enter: (m) => {
        ai.clearPath();
        ai.pickWanderTarget();
        // créature qui brûle au soleil : elle cherche l'ombre (arbres, surplombs)
        if (m.has('burnsInSun') && ai.ctx && ai.ctx.dayCycle.daylight > 0.8 && m.burnTimer > 0) {
          const s = ai.findShade();
          if (s) [ai.targetX, ai.targetZ] = s;
        }
      },
      update: (m) => {
        if (m.fleeTimer > 0) return AIState.FLEE;
        if (wantsChase(m)) return AIState.CHASE;
        if (wantsFollow(m)) return AIState.FOLLOW;
        if (!ai.hasTarget) return AIState.IDLE;
        const d = ai.navigateTo(ai.targetX, ai.surfaceY(ai.targetX, ai.targetZ), ai.targetZ, 0.6);
        if (d < 0.6 || ai.fsm.timeInState > 8) return AIState.IDLE;
        if (Math.hypot(m.x - m.homeX, m.z - m.homeZ) > 28 && m.def.category !== 'passive') return AIState.RETURN;
      },
    },
    [AIState.FOLLOW]: {
      update: (m) => {
        if (m.fleeTimer > 0) return AIState.FLEE;
        if (!wantsFollow(m)) return AIState.IDLE;
        const p = ai.ctx.player;
        if (ai.playerDist > 2.2) ai.navigateTo(p.x, p.y, p.z, 0.9);
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
        ai.navigateTo(p.x, p.y, p.z, 1);
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
        const d = ai.navigateTo(ai.lastSeenX, ai.lastSeenY, ai.lastSeenZ, 0.8);
        if (d < 1 || ai.fsm.timeInState > 8) return AIState.RETURN;
      },
    },
    [AIState.RETURN]: {
      update: (m) => {
        if (wantsChase(m)) return AIState.CHASE;
        const d = ai.navigateTo(m.homeX, ai.surfaceY(m.homeX, m.homeZ), m.homeZ, 0.7);
        if (d < 2 || ai.fsm.timeInState > 15) return AIState.WANDER;
      },
    },
    [AIState.DEAD]: { update: () => ai.stop() },
  };
}
