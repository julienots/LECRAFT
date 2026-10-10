import type * as THREE from 'three';
import { B } from '../blocks/BlockRegistry';
import { AnimPlayer, ENTITY_ANIMS } from '../addons/BedrockAnimation';
import { PROJECTILE_DEFS, type ProjectileDef, type Projectile } from './Projectile';
import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { AIController } from '../ai/AIController';
import { AIState, type StateHandlers } from '../ai/StateMachine';
import { MobModel } from '../render/MobModels';
import { Entity } from './Entity';
import { scanRelations } from './MobRelations';
import type { ProjectileKind } from './Projectile';

/** Services fournis par l'EntityManager aux entités. */
export interface EntitySpawner {
  spawnProjectile(kind: ProjectileKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, damage: number, fromPlayer: boolean, def?: ProjectileDef): Projectile;
  spawnMob(key: string, x: number, y: number, z: number, opts?: { baby?: boolean; persistent?: boolean }): Mob | null;
  spawnItem(id: string, count: number, x: number, y: number, z: number, durability?: number, meta?: Record<string, unknown>): void;
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
  /** Secondes restantes en feu (Aura de feu, Flamme). */
  fireTime = 0;
  private fireTick = 0;
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
  /** Relations entre créatures (entities/MobRelations.ts) : proie, vengeance, prédateur fui. */
  prey: Mob | null = null;
  revenge = false;
  relHunt: import('./MobRelations').HuntRule | null = null;
  fleeFrom: { x: number; z: number } | null = null;
  private relTimer = Math.random();
  /** Abeille : dard perdu après une piqûre (elle meurt peu après). */
  private stingDeath = 0;
  readonly ai: AIController;
  model: MobModel;
  object3d: THREE.Object3D;
  sim = true; // simulé ce tick (LOD)
  private effectTick = 0;
  /** Lecteur d'animations Bedrock (créatures d'add-ons). */
  private animPlayer: AnimPlayer | null = null;
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

  /** Santé maximale modifiée (loup apprivoisé…). */
  maxHealthOverride: number | null = null;
  get maxHealth() {
    return this.maxHealthOverride ?? this.def.health;
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
    // abeille sans dard : ne pique plus
    if (this.def.key === 'bee' && this.dynProps.get('__stung')) return;
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz) || 1;
    const dy = p.y - this.y;
    if (d > this.def.attackRange * 1.2 || dy > 2.5 || dy < -2) return;
    const dealt = p.damage(this.def.damage, 'mob', (dx / d) * 5, (dz / d) * 5, this);
    if (dealt > 0 && this.has('poison') && p.difficulty !== 'easy') p.poisonTimer = Math.max(p.poisonTimer, p.difficulty === 'hard' ? 15 : 7);
    // zombie momifié : inflige la faim
    if (dealt > 0 && this.def.key === 'husk') p.effects.add('hunger', 140, 0, true, p.effectTarget);
    // squelette wither : effet wither
    if (dealt > 0 && this.def.key === 'wither_skeleton') p.effects.add('wither', 200, 0, true, p.effectTarget);
    // abeille : poison (normal 10 s, difficile 18 s), puis elle perd son dard et meurt en 50 à 60 s
    if (dealt > 0 && this.def.key === 'bee') {
      if (p.difficulty !== 'easy') p.effects.add('poison', p.difficulty === 'hard' ? 360 : 200, 0, true, p.effectTarget);
      this.anger = 0;
      this.stingDeath = 50 + Math.random() * 10;
      this.dynProps.set('__stung', true);
    }
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
    ctx.audio.play(r.projectile === 'arrow' ? 'bow' : this.def.key === 'ghast' ? 'ghast_shoot' : 'cast', { x: sx, y: sy, z: sz });
  }

  /** Multijoueur (invité) : créature de l'hôte, position imposée par le réseau (pas d'IA ni de physique). */
  net: { x: number; y: number; z: number; yaw: number; f: number } | null = null;
  /** Multijoueur (invité) : identifiant de la créature chez l'hôte. */
  netId = 0;
  /** Multijoueur : les coups portés à cette créature sont envoyés à l'hôte au lieu d'être appliqués. */
  onNetHit: ((dmg: number, info: { kx: number; kz: number; crit: boolean; item: string }) => void) | null = null;

  private netUpdate(dt: number) {
    const n = this.net!;
    const b = this.body;
    const k = 1 - Math.exp(-12 * dt);
    const ox = b.x, oz = b.z;
    if (Math.hypot(n.x - b.x, n.y - b.y, n.z - b.z) > 8) b.setPos(n.x, n.y, n.z);
    else b.setPos(b.x + (n.x - b.x) * k, b.y + (n.y - b.y) * k, b.z + (n.z - b.z) * k);
    b.vx = (b.x - ox) / Math.max(dt, 1e-3);
    b.vz = (b.z - oz) / Math.max(dt, 1e-3);
    this.walkPhase += Math.hypot(b.vx, b.vz) * dt * 3.2;
    let d = n.yaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * k;
    this.attackAnim = Math.max(0, this.attackAnim - dt * 3);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    if (n.f & 2) this.attackAnim = 1;
    if (n.f & 1 && this.hurtTimer <= 0) this.hurtTimer = 0.3;
    if (n.f & 4) {
      this.dead = true;
      this.deathTimer += dt;
      if (this.deathTimer > 1) this.removed = true;
    }
  }

  /** Mise à jour par tick (physique + IA). */
  update(ctx: GameContext, dt: number) {
    if (this.net) return this.netUpdate(dt);
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
      if (this.def.key === 'ender_dragon') {
        // mort du dragon : il s'élève lentement au milieu des explosions puis disparaît
        this.body.vx = this.body.vz = 0;
        this.body.y += dt * 1.5;
        if (Math.random() < dt * 14) ctx.particles.burst('explosion', this.x + (Math.random() - 0.5) * 8, this.y + 1 + Math.random() * 4, this.z + (Math.random() - 0.5) * 8, 6);
        if (this.deathTimer > 5) this.removed = true;
        return;
      }
      this.body.vx *= 0.8;
      this.body.vz *= 0.8;
      this.body.step(ctx.world, dt);
      // comme le jeu original : bascule sur le côté pendant 1 s puis disparaît dans un nuage de fumée
      if (this.deathTimer > 1) {
        this.removed = true;
        ctx.particles.burst('poof', this.x, this.y + this.body.height / 2, this.z, Math.round(10 + this.def.width * 10));
      }
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
    // relations avec les autres créatures (chasse, fuite, protection des petits)
    this.relTimer -= dt;
    if (this.relTimer <= 0) {
      this.relTimer = 0.8 + Math.random() * 0.4;
      scanRelations(this, ctx);
    }
    if (this.stingDeath <= 0 && this.def.key === 'bee' && this.dynProps.get('__stung')) this.stingDeath = 50 + Math.random() * 10;
    if (this.stingDeath > 0) {
      this.stingDeath -= dt;
      if (this.stingDeath <= 0) ctx.combat.damageMob(this, this.health + 1, { kind: 'environment' });
      if (this.dead) return;
    }
    if (this.has('aquatic')) this.swim(ctx, dt);
    if (this.has('flies')) {
      // vol : maintien d'une altitude au-dessus du sol
      const ground = ctx.world.surfaceBelow(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z));
      const want = ground + 1 + this.hoverHeight;
      this.body.vy += ((want - this.y) * 2 - this.body.vy) * Math.min(1, dt * 3);
    }
    this.body.step(ctx.world, dt);
    // dégâts de contact (lave, cactus)
    if (this.body.inLava && !this.has('fireImmune')) ctx.combat.damageMob(this, 4 * dt * 2, { kind: 'environment', fire: true });
    // en feu (Aura de feu, flèche enflammée) : 1 point par seconde, l'eau éteint
    if (this.fireTime > 0) {
      this.fireTime = this.body.inWater ? 0 : this.fireTime - dt;
      this.fireTick -= dt;
      if (this.fireTick <= 0 && this.fireTime > 0) {
        this.fireTick = 1;
        ctx.combat.damageMob(this, 1, { kind: 'environment', fire: true });
      }
      if (Math.random() < dt * 12) ctx.particles.burst('fire', this.x, this.y + this.body.height * (0.3 + Math.random() * 0.6), this.z, 1);
    }
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
      if (this.distToPlayer < 20) {
        if (ctx.audio.mobSound) ctx.audio.mobSound(this.def.key, 'idle', this.def.sounds.idle, { x: this.x, y: this.y, z: this.z, volume: 0.6 });
        else ctx.audio.play(this.def.sounds.idle, { x: this.x, y: this.y, z: this.z, volume: 0.6 });
      }
    }
  }

  /** Altitude de vol (créatures volantes). */
  hoverHeight = 2;

  private swimTarget = { x: 0, y: 0, z: 0, t: 0 };
  /** Créatures aquatiques : nagent en 3D dans l'eau, suffoquent hors de l'eau. */
  private swim(ctx: GameContext, dt: number) {
    const b = this.body;
    if (!b.inWater) {
      this.airTime = (this.airTime ?? 0) + dt;
      if (this.airTime > 2) {
        this.airTime = 1;
        ctx.combat.damageMob(this, 1, { kind: 'environment' });
      }
      if (b.onGround && Math.random() < dt * 2) {
        b.vy = 4;
        b.vx = (Math.random() - 0.5) * 3;
        b.vz = (Math.random() - 0.5) * 3;
      }
      return;
    }
    this.airTime = 0;
    const s = this.swimTarget;
    s.t -= dt;
    if (s.t <= 0 || Math.hypot(s.x - this.x, s.y - this.y, s.z - this.z) < 1) {
      s.t = 3 + Math.random() * 4;
      // destination dans l'eau uniquement (quelques essais, sinon on reste sur place)
      s.x = this.x;
      s.y = this.y;
      s.z = this.z;
      for (let i = 0; i < 6; i++) {
        const x = this.x + (Math.random() - 0.5) * 12, y = this.y + (Math.random() - 0.5) * 6, z = this.z + (Math.random() - 0.5) * 12;
        if (ctx.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === B.WATER && ctx.world.getBlock(Math.floor(x), Math.floor(y + 1), Math.floor(z)) === B.WATER) {
          s.x = x;
          s.y = y;
          s.z = z;
          break;
        }
      }
    }
    const dx = s.x - this.x, dy = s.y - this.y, dz = s.z - this.z, d = Math.hypot(dx, dy, dz) || 1;
    const sp = this.def.speed;
    b.vx += ((dx / d) * sp - b.vx) * Math.min(1, dt * 2);
    b.vz += ((dz / d) * sp - b.vz) * Math.min(1, dt * 2);
    b.vy += ((dy / d) * sp * 0.6 + 0.3 - b.vy) * Math.min(1, dt * 2); // compense la gravité dans l'eau
    // ne jaillit pas hors de l'eau : sous la surface, la remontée est bloquée
    if (b.vy > 0 && ctx.world.getBlock(Math.floor(this.x), Math.floor(this.y + b.height + 0.2), Math.floor(this.z)) !== B.WATER) b.vy = 0;
    this.yaw = Math.atan2(b.vx, b.vz);
  }
  private airTime = 0;

  /** Point d'extension pour les sous-classes. */
  protected customUpdate(_ctx: GameContext, _dt: number) {}

  /** Synchronise l'objet 3D avec la simulation (à chaque frame de rendu). */
  render(ctx: GameContext, alpha: number, t: number) {
    const g = this.model.group;
    g.visible = !this.effects.level('invisibility');
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.yaw;
    // angle de chute vanilla : √(1,6 × (ticks − 1) / 20), plafonné à 90°
    g.rotation.z = this.dead && this.def.key !== 'ender_dragon' ? (Math.PI / 2) * Math.min(1, Math.sqrt(Math.max(0, this.deathTimer * 20 - 1) / 20 * 1.6)) : 0;
    const sp = Math.hypot(this.body.vx, this.body.vz);
    let headYaw = 0, headPitch = 0;
    const p = ctx.player;
    const chasing = this.ai.state === AIState.CHASE || this.ai.state === AIState.ATTACK || this.ai.state === AIState.FOLLOW;
    if (chasing || (this.distToPlayer < 8 && !p.dead && !this.dead)) {
      // les créatures suivent le joueur du regard (rotation de la tête limitée)
      headPitch = Math.atan2(p.y + p.eyeHeight - (this.y + this.body.height * 0.85), this.distToPlayer || 1) * 0.6;
      let d = Math.atan2(p.x - this.x, p.z - this.z) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      headYaw = Math.max(-1.1, Math.min(1.1, d));
    }
    const animSet = this.model.bones.size ? ENTITY_ANIMS.get(this.def.key) : undefined;
    if (animSet) {
      // animations Bedrock de l'add-on (images clés + contrôleurs)
      this.animPlayer ??= new AnimPlayer(animSet);
      const DEG = 180 / Math.PI;
      const chasing = this.ai.state === AIState.CHASE || this.ai.state === AIState.ATTACK;
      const q = (n: string, a: unknown[]): number | undefined => {
        switch (n) {
          case 'modified_distance_moved': case 'distance_moved': case 'walk_distance': return this.walkPhase / 3.2;
          case 'modified_move_speed': case 'move_speed': return Math.min(1, sp / Math.max(1, this.def.speed));
          case 'ground_speed': case 'horizontal_speed': return sp;
          case 'vertical_speed': return this.body.vy;
          case 'is_moving': case 'is_walking': return sp > 0.15 ? 1 : 0;
          case 'is_on_ground': return this.body.onGround ? 1 : 0;
          case 'is_in_water': case 'is_in_water_or_rain': case 'is_swimming': return this.body.inWater ? 1 : 0;
          case 'is_baby': return this.baby ? 1 : 0;
          case 'is_alive': return this.dead ? 0 : 1;
          case 'health': return this.health;
          case 'max_health': return this.maxHealth;
          case 'has_target': case 'is_angry': case 'is_attacking': case 'has_any_target': return chasing ? 1 : 0;
          case 'is_delayed_attacking': return this.attackAnim > 0 ? 1 : 0;
          case 'attack_time': return this.attackAnim > 0 ? 1 - this.attackAnim : 0;
          case 'target_x_rotation': case 'head_x_rotation': return -headPitch * DEG;
          case 'target_y_rotation': case 'head_y_rotation': return headYaw * DEG;
          case 'body_y_rotation': return this.yaw * DEG;
          case 'delta_time': return 1 / 60;
          case 'time_of_day': return ctx.dayCycle.time;
          case 'is_jumping': return !this.body.onGround && this.body.vy > 0 ? 1 : 0;
          case 'is_sprinting': case 'is_running': return sp > this.def.speed * 1.2 ? 1 : 0;
          case 'variant': case 'mark_variant': case 'skin_id': return Number(this.dynProps.get(`__${n}`) ?? (n === 'variant' ? this.def.variant ?? 0 : 0));
          case 'property': case 'actor_property': case 'has_property': {
            const k = `__prop:${String(a[0])}`;
            const v = this.dynProps.has(k) ? this.dynProps.get(k) : this.def.properties?.[String(a[0])];
            return n === 'has_property' ? (v !== undefined ? 1 : 0) : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : 0;
          }
          case 'all_animations_finished': case 'any_animation_finished': return 1;
          default: return 0;
        }
      };
      this.model.applyPoses(this.animPlayer.evaluate(this.age, q as never));
    } else this.model.animate(this.walkPhase, Math.min(1, sp / 2), t, this.attackAnim, headYaw, headPitch);
    // éclairage
    const l = ctx.world.getLight(Math.floor(this.x), Math.floor(this.y + this.body.height * 0.6), Math.floor(this.z));
    const sky = (l.sky / 15) * ctx.dayCycle.daylight, blk = l.block / 15;
    const br = Math.max(ctx.dimension === 'nether' ? 0.45 : 0.12, Math.pow(Math.max(sky, blk), 1.3));
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
