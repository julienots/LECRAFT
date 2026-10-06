import type * as THREE from 'three';
import { PROJECTILE_DEFS, type ProjectileDef, type Projectile } from './Projectile';
import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { AIController } from '../ai/AIController';
import { AIState, type StateHandlers } from '../ai/StateMachine';
import { MobModel } from '../render/MobModels';
import { Entity } from './Entity';
import type { ProjectileKind } from './Projectile';

/** Services fournis par l'EntityManager aux entités. */
export interface EntitySpawner {
  spawnProjectile(kind: ProjectileKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, damage: number, fromPlayer: boolean, def?: ProjectileDef): Projectile;
  spawnMob(key: string, x: number, y: number, z: number, opts?: { baby?: boolean; persistent?: boolean }): Mob | null;
  spawnItem(id: string, count: number, x: number, y: number, z: number, durability?: number): void;
  modelFor(key: string, scale: number): MobModel;
}

/**
 * Créature générique pilotée par un AIController.
 * Animal (passif/neutre, reproduction), Monster (hostile) et Boss en dérivent.
 */
export class Mob extends Entity {
  readonly kind = 'mob' as const;
  health: number;
  dead = false;
  deathTimer = 0;
  hurtTimer = 0;
  iframes = 0;
  attackTimer = 0;
  attackAnim = 0;
  homeX: number;
  homeZ: number;
  idleTime = 2;
  fleeTimer = 0;
  anger = 0;
  baby = false;
  growTimer = 0;
  loveTimer = 0;
  breedCooldown = 0;
  persistent = false;
  slowTimer = 0;
  burnTimer = 0;
  walkPhase = 0;
  /** Clé de la cage/autel d'origine. */
  origin: string | null = null;
  readonly ai: AIController;
  model: MobModel;
  object3d: THREE.Object3D;
  sim = true; // simulé ce tick (LOD)
  private effectTick = 0;
  private idleSoundTimer = 4 + Math.random() * 10;

  constructor(readonly def: MobDef, readonly index: number, x: number, y: number, z: number, protected spawner: EntitySpawner, handlers?: Partial<Record<AIState, StateHandlers<Mob>>>) {
    super(def.width / 2, def.height);
    this.body.setPos(x, y, z);
    this.health = def.health;
    this.homeX = x;
    this.homeZ = z;
    this.model = spawner.modelFor(def.key, def.scale ?? 1);
    this.object3d = this.model.group;
    this.ai = new AIController(this, handlers);
    if (this.has('flies')) this.body.gravity = 0;
  }

  has(trait: NonNullable<MobDef['traits']>[number]) {
    return this.def.traits?.includes(trait) ?? false;
  }

  get maxHealth() {
    return this.def.health;
  }

  setBaby(b: boolean) {
    this.baby = b;
    this.growTimer = b ? 300 : 0;
    const s = (this.def.scale ?? 1) * (b ? 0.55 : 1);
    this.model.group.scale.setScalar(s);
    this.body.height = this.def.height * (b ? 0.55 : 1);
    this.body.halfWidth = (this.def.width / 2) * (b ? 0.55 : 1);
  }

  meleeAttack(ctx: GameContext) {
    this.attackTimer = this.def.attackCooldown;
    this.attackAnim = 1;
    const p = ctx.player;
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz) || 1;
    const dy = p.y - this.y;
    if (d > this.def.attackRange * 1.2 || dy > 2.5 || dy < -2) return;
    const dealt = p.damage(this.def.damage, 'mob', (dx / d) * 5, (dz / d) * 5, this);
    if (dealt > 0 && this.has('poison') && p.difficulty !== 'easy') p.poisonTimer = Math.max(p.poisonTimer, p.difficulty === 'hard' ? 15 : 7);
    if (dealt > 0) {
      ctx.audio.play('hurt', { volume: 0.9 });
      ctx.haptic('medium');
    }
  }

  rangedAttack(ctx: GameContext) {
    const r = this.def.ranged!;
    this.attackTimer = this.def.attackCooldown * (0.8 + Math.random() * 0.4);
    this.attackAnim = 1;
    const p = ctx.player;
    const sx = this.x, sy = this.y + this.body.height * 0.8, sz = this.z;
    const tx = p.x, ty = p.y + 1.2, tz = p.z;
    const dx = tx - sx, dz = tz - sz, dh = Math.hypot(dx, dz) || 1;
    const t = dh / r.speed;
    const grav = r.projectile === 'arrow' || r.projectile === 'boulder' ? 12 : 0;
    const vy = (ty - sy) / t + 0.5 * grav * t;
    const spread = 0.06;
    const custom = r.customId ? PROJECTILE_DEFS.get(r.customId) : undefined;
    const pr = this.spawner.spawnProjectile(custom ? 'custom' : r.projectile, sx, sy, sz, (dx / dh) * r.speed + (Math.random() - 0.5) * spread * r.speed, vy, (dz / dh) * r.speed + (Math.random() - 0.5) * spread * r.speed, custom?.damage || r.damage, false, custom);
    pr.owner = this;
    ctx.audio.play(r.projectile === 'arrow' ? 'bow' : 'cast', { x: sx, y: sy, z: sz });
  }

  /** Mise à jour par tick (physique + IA). */
  update(ctx: GameContext, dt: number) {
    this.age += dt;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.attackTimer -= dt;
    this.attackAnim = Math.max(0, this.attackAnim - dt * 3);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.breedCooldown = Math.max(0, this.breedCooldown - dt);
    this.loveTimer = Math.max(0, this.loveTimer - dt);
    if (this.anger > 0) this.anger = Math.max(0, this.anger - dt);
    if (this.baby) {
      this.growTimer -= dt;
      if (this.growTimer <= 0) this.setBaby(false);
    }
    if (this.dead) {
      this.deathTimer += dt;
      this.body.vx *= 0.8;
      this.body.vz *= 0.8;
      this.body.step(ctx.world, dt);
      if (this.deathTimer > 0.8) this.removed = true;
      return;
    }
    if (this.effects.map.size) {
      this.effects.tick(
        {
          heal: (n) => (this.health = Math.min(this.maxHealth, this.health + n)),
          hurt: (n) => ctx.combat.damageMob(this, n, { kind: 'environment' }),
          hp: () => this.health,
          body: this.body,
        },
        this.effectTick++,
      );
      if (this.dead) return;
    }
    this.ai.update(ctx, dt);
    this.customUpdate(ctx, dt);
    if (this.has('flies')) {
      // vol : maintien d'une altitude au-dessus du sol
      const ground = ctx.world.surfaceBelow(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z));
      const want = ground + 1 + this.hoverHeight;
      this.body.vy += ((want - this.y) * 2 - this.body.vy) * Math.min(1, dt * 3);
    }
    this.body.step(ctx.world, dt);
    // dégâts de contact (lave, cactus)
    if (this.body.inLava) ctx.combat.damageMob(this, 4 * dt * 2, { kind: 'environment', fire: true });
    // brûlure au soleil
    if (this.has('burnsInSun') && ctx.dayCycle.daylight > 0.8 && !ctx.raining() && !this.body.inWater) {
      const l = ctx.world.getLight(Math.floor(this.x), Math.floor(this.y + this.body.height), Math.floor(this.z));
      if (l.sky >= 15) {
        this.burnTimer += dt;
        if (this.burnTimer > 1) {
          this.burnTimer = 0;
          ctx.combat.damageMob(this, 2, { kind: 'environment', fire: true });
          ctx.particles.burst('fire', this.x, this.y + this.body.height * 0.8, this.z, 6);
        }
      }
    }
    // animation de marche
    const sp = Math.hypot(this.body.vx, this.body.vz);
    this.walkPhase += sp * dt * 3.2;
    this.idleSoundTimer -= dt;
    if (this.idleSoundTimer <= 0) {
      this.idleSoundTimer = 6 + Math.random() * 14;
      if (this.distToPlayer < 20) ctx.audio.play(this.def.sounds.idle, { x: this.x, y: this.y, z: this.z, volume: 0.6 });
    }
  }

  /** Altitude de vol (créatures volantes). */
  hoverHeight = 2;

  /** Point d'extension pour les sous-classes. */
  protected customUpdate(_ctx: GameContext, _dt: number) {}

  /** Synchronise l'objet 3D avec la simulation (à chaque frame de rendu). */
  render(ctx: GameContext, alpha: number, t: number) {
    const g = this.model.group;
    g.visible = !this.effects.level('invisibility');
    g.position.set(this.x, this.y + (this.dead ? -this.deathTimer * 0.3 : 0), this.z);
    g.rotation.y = this.yaw;
    g.rotation.z = this.dead ? Math.min(Math.PI / 2, this.deathTimer * 4) : 0;
    const sp = Math.hypot(this.body.vx, this.body.vz);
    let headYaw = 0, headPitch = 0;
    if (this.ai.state === AIState.CHASE || this.ai.state === AIState.ATTACK || this.ai.state === AIState.FOLLOW) {
      const p = ctx.player;
      headPitch = Math.atan2(p.y + p.eyeHeight - (this.y + this.body.height * 0.85), this.distToPlayer || 1) * 0.6;
    }
    this.model.animate(this.walkPhase, Math.min(1, sp / 2), t, this.attackAnim, headYaw, headPitch);
    // éclairage
    const l = ctx.world.getLight(Math.floor(this.x), Math.floor(this.y + this.body.height * 0.6), Math.floor(this.z));
    const sky = (l.sky / 15) * ctx.dayCycle.daylight, blk = l.block / 15;
    const br = Math.max(0.12, Math.pow(Math.max(sky, blk), 1.3));
    if (this.hurtTimer > 0 || this.dead) this.model.setTint(1, 0.35, 0.35);
    else this.model.setTint(br, br, br * (this.loveTimer > 0 ? 0.9 : 1));
    this.model.setShadowSize(this.body.halfWidth * 2, ctx.settings.shadows !== 'off');
    void alpha;
  }

  dispose() {
    /* le modèle est rendu au pool par l'EntityManager */
  }
}

export { AIState };
