import type { GameContext } from '../core/GameContext';
import type { Mob } from '../entities/Mob';
import { raycastBlocks } from '../util/Raycast';
import { BlockRegistry, SHAPES } from '../blocks/BlockRegistry';
import { AIState, StateMachine, type StateHandlers } from './StateMachine';
import { findPath } from './Pathfinder';
import { DOOR_BREAK_SECONDS, doorMode, findWaterNear, pickAwaySpot, pickPanicSpot, type Cell } from './Behaviors';
import { setOpen } from '../world/Redstone';
import { huntStep } from '../entities/MobRelations';
import { wearsGold } from '../entities/SpawnRules';

/** Mémoire de la cible hors de vue : 60 ticks (3 s), comme le « unseenMemoryTicks » des objectifs de ciblage Java. */
export const UNSEEN_MEMORY = 3;
/** Coût de recherche de chemin par tick (somme des plafonds de nœuds) : lisse les calculs entre créatures. */
export const PATH_NODE_BUDGET = 2400;

/** Archers à l'arc qui tournent autour de leur cible (RangedBowAttackGoal du jeu Java). */
export const BOW_STRAFERS = new Set(['skeleton', 'stray', 'bogged', 'parched']);

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
  /** Budget de nœuds A* restant pour ce tick (remis à zéro par l'EntityManager). */
  static pathBudget = PATH_NODE_BUDGET;
  /** Secondes depuis lesquelles la cible n'est plus en vue. */
  unseenTime = 0;
  /** Immobilisation demandée (creeper qui gonfle, créature qui travaille une porte) : secondes restantes. */
  hold = 0;
  /** Nombre de contrôles d'avancement consécutifs sans progrès (créature coincée). */
  stuckCount = 0;
  private progX = 0;
  private progZ = 0;
  private progT = 0;
  /** Portes ouvertes par la créature (refermées après son passage) et progression du bris d'une porte. */
  private opened: Cell[] = [];
  private breakKey = '';
  private breakT = 0;
  /** Destination de fuite courante et délai avant d'en choisir une autre. */
  private fleeGoal: Cell | null = null;
  private fleeRepick = 0;
  private fleeIsWater = false;
  /** La panique en cours a été déclenchée par le feu. */
  fireFled = false;
  ctx!: GameContext;
  lastSeenY = 0;
  private dt = 0.05;
  /** Chemin courant (cellules) et prochaine étape. */
  path: [number, number, number][] | null = null;
  private pathIdx = 0;
  private repath = 0;
  private goal: [number, number, number] = [0, 0, 0];
  /** Mitraillage des squelettes : temps de visée, minuterie, sens (horaire / recul). */
  seeTime = 0;
  strafeTime = -1;
  strafeCW = false;
  strafeBack = false;

  constructor(readonly mob: Mob, overrides: Partial<Record<AIState, StateHandlers<Mob>>> = {}) {
    this.fsm = new StateMachine<Mob>({ ...defaultHandlers(this), ...overrides }, mob);
    this.fsm.set(AIState.WANDER);
  }

  get state() {
    return this.fsm.state;
  }

  /** Pas de temps du tick courant. */
  get dtStep() {
    return this.dt;
  }

  update(ctx: GameContext, dt: number) {
    this.ctx = ctx;
    this.dt = dt;
    const m = this.mob;
    this.hold = Math.max(0, this.hold - dt);
    if (this.opened.length) this.closeDoors(ctx);
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
        this.unseenTime = 0;
        this.lastSeenX = ctx.player.x;
        this.lastSeenZ = ctx.player.z;
        this.lastSeenY = ctx.player.y;
      }
    }
    this.unseenTime = this.canSee ? 0 : this.unseenTime + dt;
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
    if (this.hold > 0) {
      this.stop();
      return d;
    }
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
    this.checkProgress(direct);
    const moved = Math.abs(gx - this.goal[0]) + Math.abs(gz - this.goal[2]) + Math.abs(gy - this.goal[1]) > 1;
    // écartée de son chemin (recul, poussée) : on recalcule tout de suite
    if (this.path && this.pathIdx < this.path.length) {
      const [qx, , qz] = this.path[this.pathIdx];
      if (Math.hypot(qx + 0.5 - m.x, qz + 0.5 - m.z) > 4) this.repath = Math.min(this.repath, 0);
    }
    if (!this.path || this.repath <= 0 || (moved && this.repath < 0.5)) {
      const direct20 = direct > 20, nodes = direct20 ? 1000 : direct > 10 ? 700 : 450;
      if (AIController.pathBudget < nodes) {
        // budget du tick épuisé : on réessaie au tick suivant (recalcul échelonné), sans chemin on avance droit
        this.repath = 0.05 + Math.random() * 0.1;
        if (!this.path) return this.moveTowards(x, z, speedMul, true);
      } else {
        AIController.pathBudget -= nodes;
        this.goal = [gx, gy, gz];
        this.repath = 0.6 + Math.random() * 0.5;
        const w = this.ctx.world;
        this.path = findPath(w, Math.floor(m.x), Math.floor(m.y + 0.05), Math.floor(m.z), gx, gy, gz, {
          height: Math.ceil(m.body.height - 0.01),
          maxNodes: nodes,
          waterCost: m.has('burnsInSun') ? 1 : 3,
          doors: doorMode(m.def.key, this.ctx.player.difficulty),
        });
        this.pathIdx = 0;
        // cible inaccessible (chemin partiel qui s'arrête loin) : on espace les recalculs, le résultat ne changera pas vite
        const last = this.path && this.path.length ? this.path[this.path.length - 1] : null;
        if (!last || Math.hypot(last[0] - gx, last[2] - gz) > 2 || Math.abs(last[1] - gy) > 2) this.repath = 2 + Math.random() * 1.5;
      }
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
    // porte fermée sur la route : on l'ouvre (villageois, pillards…) ou on la brise (zombies en difficile)
    if (this.handleDoor(px, py, pz)) return direct;
    this.moveTowards(px + 0.5, pz + 0.5, speedMul, false);
    // marche montante : saut anticipé (sans attendre de cogner le bloc)
    const b = m.body;
    // dans l'eau : on nage vers le haut (comme un joueur qui maintient « sauter ») pour sortir sur la rive
    if (b.inWater && (py >= Math.floor(m.y + 0.05) || b.collidedH)) b.vy = Math.max(b.vy, 5);
    if (py > Math.floor(m.y + 0.05) && b.onGround && Math.hypot(px + 0.5 - m.x, pz + 0.5 - m.z) < 1.3 && Math.hypot(b.vx, b.vz) > 0.4) b.vy = 9.2;
    return direct;
  }

  /**
   * Détecte une créature coincée : sans avancer de 0,3 bloc en 1 s alors qu'elle veut rejoindre un point
   * lointain, on recalcule le chemin, puis on la pousse de côté (les créatures du jeu original
   * recalculent leur navigation quand elles ne progressent plus : PathNavigation#recomputePath).
   */
  private checkProgress(direct: number) {
    const m = this.mob;
    this.progT += this.dt;
    if (this.progT < 1) return;
    const moved = Math.hypot(m.x - this.progX, m.z - this.progZ);
    this.progT = 0;
    this.progX = m.x;
    this.progZ = m.z;
    if (direct < 1.5 || this.hold > 0 || m.hurtTimer > 0) {
      this.stuckCount = 0;
      return;
    }
    if (moved >= 0.3) {
      this.stuckCount = 0;
      return;
    }
    this.stuckCount++;
    this.clearPath();
    if (this.stuckCount >= 2) {
      const a = Math.random() * Math.PI * 2;
      m.body.vx += Math.cos(a) * 2.5;
      m.body.vz += Math.sin(a) * 2.5;
      if (m.body.onGround) m.body.vy = 7;
    }
  }

  /** Porte fermée à la case (x, y..y+h) du chemin, à moins de 1,8 bloc : ouverture ou bris. Vrai si on la travaille. */
  private handleDoor(px: number, py: number, pz: number): boolean {
    const m = this.mob, w = this.ctx.world;
    if (Math.hypot(px + 0.5 - m.x, pz + 0.5 - m.z) > 1.8) return false;
    const mode = doorMode(m.def.key, this.ctx.player.difficulty);
    if (mode === 'none') return false;
    for (let k = 0; k < Math.max(1, Math.ceil(m.body.height - 0.01)); k++) {
      const id = w.getBlock(px, py + k, pz);
      if (id <= 0 || BlockRegistry.shape[id] !== DOOR_SHAPE() || !BlockRegistry.solid[id] || w.getMeta(px, py + k, pz) & 4) continue;
      const bd = BlockRegistry.get(id);
      if (bd.key === 'iron_door' || bd.def.keyItem) return false;
      if (mode === 'open') {
        if (setOpen(w, px, py + k, pz, true)) {
          this.opened.push([px, py + k, pz]);
          if (this.opened.length > 3) this.opened.shift();
          this.ctx.audio.play('door_open', { x: px + 0.5, y: py + k, z: pz + 0.5 });
        }
        return false;
      }
      // brise la porte : immobile et tournée vers elle pendant DOOR_BREAK_SECONDS
      const key = `${px},${py + k},${pz}`;
      if (key !== this.breakKey) {
        this.breakKey = key;
        this.breakT = 0;
      }
      this.breakT += this.dt;
      this.stop();
      m.yaw = Math.atan2(px + 0.5 - m.x, pz + 0.5 - m.z);
      if (this.breakT >= DOOR_BREAK_SECONDS) {
        const bottom = w.getMeta(px, py + k, pz) & 8 ? py + k - 1 : py + k;
        for (const yy of [bottom, bottom + 1]) if (w.getBlock(px, yy, pz) === id) w.setBlock(px, yy, pz, 0, 0);
        this.ctx.particles.blockBreak(px, bottom, pz, id);
        this.ctx.audio.play('break_wood', { x: px + 0.5, y: py + k, z: pz + 0.5 });
        this.breakKey = '';
        this.clearPath();
      } else if (Math.random() < this.dt * 3) this.ctx.audio.play('hit_wood', { x: px + 0.5, y: py + k, z: pz + 0.5, volume: 0.7 });
      return true;
    }
    return false;
  }

  /** Referme les portes ouvertes une fois la créature passée (à plus de 2,5 blocs). */
  private closeDoors(ctx: GameContext) {
    const m = this.mob;
    this.opened = this.opened.filter(([x, y, z]) => {
      if (Math.hypot(x + 0.5 - m.x, z + 0.5 - m.z) <= 2.5) return true;
      setOpen(ctx.world, x, y, z, false);
      return false;
    });
  }

  /**
   * Fuite : une destination (eau si la créature brûle, sinon un point éloigné de la menace) est choisie
   * puis rejointe par le chemin ; elle est rechoisie à l'arrivée ou toutes les 1,5 s.
   * PanicGoal (feu → eau à 5 blocs) et AvoidEntityGoal (point opposé au danger) du jeu Java.
   */
  fleeStep(from: { x: number; z: number } | null, speedMul: number) {
    const m = this.mob, w = this.ctx.world;
    const burning = m.fireTime > 0 && !m.has('fireImmune');
    this.fleeRepick -= this.dt;
    const inFlames = burning && this.fleeGoal !== null && this.fleeIsWater;
    if (!this.fleeGoal || this.fleeRepick <= 0 || (!inFlames && Math.hypot(this.fleeGoal[0] + 0.5 - m.x, this.fleeGoal[2] + 0.5 - m.z) < 1) || this.stuckCount >= 2) {
      this.fleeRepick = 1.5;
      this.stuckCount = 0;
      const rng = Math.random;
      let goal: Cell | null = null;
      this.fleeIsWater = false;
      if (burning) goal = findWaterNear(w, m.x, m.y, m.z, 5, 4);
      if (goal) this.fleeIsWater = true;
      else {
        const f = from ?? this.ctx.player;
        goal = burning && !from ? pickPanicSpot(w, m.x, m.y, m.z, rng) : pickAwaySpot(w, m.x, m.y, m.z, f.x, f.z, rng, 10);
      }
      if (goal && (!this.fleeGoal || goal[0] !== this.fleeGoal[0] || goal[2] !== this.fleeGoal[2])) this.clearPath();
      this.fleeGoal = goal;
    }
    const g = this.fleeGoal;
    if (!g) {
      const f = from ?? this.ctx.player;
      const dx = m.x - f.x, dz = m.z - f.z, d = Math.hypot(dx, dz) || 1;
      this.moveTowards(m.x + (dx / d) * 6, m.z + (dz / d) * 6, speedMul);
      return;
    }
    // eau : on entre franchement dans la case (sinon la créature reste perchée sur la berge, bord du corps sur la terre ferme)
    const wx = g[0] + 0.5 - m.x, wz = g[2] + 0.5 - m.z, wd = Math.hypot(wx, wz) || 1;
    if (this.fleeIsWater && wd < 1.3) this.moveTowards(g[0] + 0.5 + (wx / wd) * 0.8, g[2] + 0.5 + (wz / wd) * 0.8, speedMul, false);
    else this.navigateTo(g[0] + 0.5, g[1], g[2] + 0.5, speedMul);
  }

  /** Oublie la destination de fuite (changement d'état). */
  resetFlee() {
    this.fleeGoal = null;
    this.fleeRepick = 0;
    this.stuckCount = 0;
    this.fireFled = false;
    this.clearPath();
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

const DOOR_SHAPE = () => SHAPES.indexOf('door') + 1;

function isHostile(m: Mob, ctx?: GameContext) {
  if (m.anger > 0) return true;
  // piglins : hostiles envers le joueur qui ne porte aucune pièce d'armure en or (adultes seulement)
  if (m.def.key === 'piglin' && ctx && !m.baby && !(m as Mob & { barterTimer?: number }).barterTimer) return !wearsGold(ctx.player.inventory.armor);
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
  /** Petit qui suit son parent (FollowParentGoal) : adulte de la même espèce à plus de 3 blocs. */
  const wantsParent = (m: Mob) => {
    const par = m.parentMob;
    if (!m.baby || !par || par.dead || par.removed) return false;
    const d = Math.hypot(par.x - m.x, par.z - m.z);
    return d > (ai.fsm.state === AIState.FOLLOW ? 2.5 : 3.2) && d < 16;
  };
  /**
   * Squelette : une fois la cible vue depuis 1 s, il tourne autour (sens changé au hasard), recule
   * sous 25 % de sa portée et avance au-delà de 75 % (RangedBowAttackGoal).
   */
  const strafe = (m: Mob) => {
    const p = ai.ctx.player, range = m.def.ranged!.range;
    ai.seeTime = ai.canSee ? ai.seeTime + ai.dtStep : 0;
    if (ai.seeTime < 1) {
      ai.navigateTo(p.x, p.y, p.z, 1);
      m.yaw = Math.atan2(p.x - m.x, p.z - m.z);
      return;
    }
    ai.strafeTime += ai.dtStep;
    if (ai.strafeTime >= 1) {
      if (Math.random() < 0.3) ai.strafeCW = !ai.strafeCW;
      if (Math.random() < 0.3) ai.strafeBack = !ai.strafeBack;
      ai.strafeTime = 0;
    }
    const d = ai.playerDist;
    if (d > range * 0.75) ai.strafeBack = false;
    else if (d < range * 0.25) ai.strafeBack = true;
    const dx = p.x - m.x, dz = p.z - m.z, l = Math.hypot(dx, dz) || 1;
    const fx = dx / l, fz = dz / l;
    const fw = ai.strafeBack ? -0.5 : 0.5, side = ai.strafeCW ? 0.5 : -0.5;
    // déplacement relatif : avant/arrière + latéral (perpendiculaire)
    const tx = m.x + (fx * fw + -fz * side) * 3, tz = m.z + (fz * fw + fx * side) * 3;
    ai.moveTowards(tx, tz, 0.9, true);
    m.yaw = Math.atan2(dx, dz);
  };
  return {
    [AIState.IDLE]: {
      enter: (m) => (m.idleTime = 1 + Math.random() * 4),
      update: (m) => {
        ai.stop();
        if (m.fleeTimer > 0) return AIState.FLEE;
        if (wantsChase(m)) return AIState.CHASE;
        if (wantsFollow(m) || wantsParent(m)) return AIState.FOLLOW;
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
        if (wantsFollow(m) || wantsParent(m)) return AIState.FOLLOW;
        if (!ai.hasTarget) return AIState.IDLE;
        const d = ai.navigateTo(ai.targetX, ai.surfaceY(ai.targetX, ai.targetZ), ai.targetZ, 0.6);
        // coincée (deux contrôles sans progrès) : on renonce à cette destination
        if (d < 0.6 || ai.fsm.timeInState > 8 || ai.stuckCount >= 2) return AIState.IDLE;
        if (Math.hypot(m.x - m.homeX, m.z - m.homeZ) > 28 && m.def.category !== 'passive') return AIState.RETURN;
      },
    },
    [AIState.FOLLOW]: {
      update: (m) => {
        if (m.fleeTimer > 0) return AIState.FLEE;
        const p = ai.ctx.player;
        if (wantsFollow(m)) {
          if (ai.playerDist > 2.2) ai.navigateTo(p.x, p.y, p.z, 0.9);
          else {
            ai.stop();
            ai.facePlayer();
          }
          return;
        }
        if (!wantsParent(m)) return AIState.IDLE;
        const par = m.parentMob!;
        ai.navigateTo(par.x, par.y, par.z, 1.1);
      },
    },
    [AIState.FLEE]: {
      enter: () => ai.resetFlee(),
      update: (m, dt) => {
        m.fleeTimer -= dt;
        // en feu : le feu éteint (eau atteinte), la panique s'arrête vite
        if (m.fleeTimer > 0.5 && m.fleeFrom === null && m.fireTime <= 0 && ai.fireFled) m.fleeTimer = 0.5;
        ai.fireFled = m.fireTime > 0;
        if (m.fleeTimer <= 0) {
          m.fleeFrom = null;
          ai.fireFled = false;
          return AIState.WANDER;
        }
        // fuit la créature qui l'a attaquée / son prédateur, ou le joueur ; en feu, court vers l'eau
        ai.fleeStep(m.fleeFrom, 1.6);
      },
    },
    [AIState.CHASE]: {
      update: (m) => {
        if (ai.ctx.player.dead) return AIState.RETURN;
        if (!isHostile(m, ai.ctx)) return AIState.WANDER;
        // cible perdue de vue : on la poursuit encore 3 s à sa position réelle avant de chercher
        if (!ai.canSee && ai.unseenTime > UNSEEN_MEMORY) return AIState.SEARCH;
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
          if (BOW_STRAFERS.has(m.def.key)) {
            strafe(m);
            // cadence de tir : 1 flèche / 2 s (1 s en difficile)
            if (m.attackTimer <= 0) {
              m.rangedAttack(ai.ctx);
              if (ai.ctx.player.difficulty === 'hard') m.attackTimer *= 0.5;
            }
            return;
          }
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
    [AIState.HUNT]: {
      update: (m) => {
        if (m.fleeTimer > 0) return AIState.FLEE;
        // les monstres préfèrent le joueur (sauf s'ils se vengent d'une créature)
        if (!m.revenge && wantsChase(m)) {
          m.prey = null;
          return AIState.CHASE;
        }
        if (!huntStep(m, ai.ctx)) return AIState.WANDER;
      },
    },
    [AIState.DEAD]: { update: () => ai.stop() },
  };
}
