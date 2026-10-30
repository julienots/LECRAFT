import type { GameContext } from '../core/GameContext';
import { AIState } from '../ai/StateMachine';
import type { MobDef } from '../data/mobs';
import { Mob, type EntitySpawner } from './Mob';
import { newMonsterUpdate } from './NewMobs';
import { creeperSwellDir, reinforcementChance, reinforcementSpot, rollReinforcementBonus } from '../ai/Behaviors';

/** Zombies qui appellent des renforts quand on les frappe (famille Zombie de Java, difficile). */
const REINFORCERS = new Set(['zombie', 'husk', 'drowned', 'zombie_villager']);

/** Durée de la mèche du creeper (1,5 s comme le jeu de référence). */
const CREEPER_FUSE = 1.5;
/** Puissance de l'explosion du creeper (6 s'il est chargé par la foudre). */
export const CREEPER_POWER = 3;
export const CHARGED_CREEPER_POWER = 6;

/** Créature hostile (zombie, squelette, araignées, slime, chef zombie, creeper). */
export class Monster extends Mob {
  /** Temps passé loin du joueur (disparition). */
  farTime = 0;
  /** Creeper : progression de la mèche (secondes). */
  fuse = 0;
  /** Phantom : piqué en cours (secondes). */
  private swoop = 2;
  /** Blaze : boules de feu restantes de la salve en cours, et délai avant la suivante. */
  private burst = 0;
  private burstTimer = 0;
  /** Araignées : délai avant le prochain bond. */
  private leapTimer = 0;
  /** Blaze : délai des dégâts de l'eau. */
  private wetTimer = 0;

  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner) {
    super(def, index, x, y, z, spawner);
    if (def.key === 'ghast') this.hoverHeight = 7;
    else if (def.key === 'blaze') this.hoverHeight = 1.5;
    else if (def.key === 'phantom') this.hoverHeight = 14;
    else if (def.key === 'paper_plane') this.hoverHeight = 8;
  }

  /** Slime / cube de magma : taille (1, 2 ou 4), 0 pour les autres créatures. */
  get size(): number {
    return this.def.key === 'slime' || this.def.key === 'magma_cube' ? (this.def.scale ?? 1) : 0;
  }

  /** Creeper chargé (foudre) : explosion de puissance 6. */
  get charged(): boolean {
    return !!this.dynProps.get('__powered');
  }
  set charged(v: boolean) {
    if (v) this.dynProps.set('__powered', true);
    else this.dynProps.delete('__powered');
  }

  /** Le creeper n'attaque pas : il allume sa mèche (voir customUpdate). Le petit slime n'inflige rien. */
  meleeAttack(ctx: GameContext) {
    if (this.def.key === 'creeper') return;
    if (this.meleeDamage() <= 0) {
      this.attackTimer = this.def.attackCooldown;
      return;
    }
    super.meleeAttack(ctx);
  }

  /** Blaze : salve de 3 boules de feu espacées de 0,3 s, puis 5 s de repos (BlazeAttackGoal). */
  rangedAttack(ctx: GameContext) {
    if (this.def.key !== 'blaze') return super.rangedAttack(ctx);
    this.attackTimer = this.def.attackCooldown;
    this.burst = 3;
    this.burstTimer = 0;
    void ctx;
  }

  protected customUpdate(ctx: GameContext, dt: number) {
    newMonsterUpdate(this, ctx, dt);
    if (this.distToPlayer > 40) this.farTime += dt;
    else this.farTime = 0;
    if (this.def.key === 'creeper' && !this.dead) this.creeperUpdate(ctx, dt);
    if (this.def.key === 'blaze' && !this.dead) this.blazeUpdate(ctx, dt);
    if ((this.def.key === 'spider' || this.def.key === 'cave_spider') && !this.dead) this.spiderLeap(ctx, dt);
    // phantom : tourne haut dans le ciel puis pique sur le joueur
    if ((this.def.key === 'phantom' || this.def.key === 'paper_plane') && !this.dead) {
      const p = ctx.player;
      const near = Math.hypot(p.x - this.x, p.z - this.z);
      this.swoop -= dt;
      if (this.swoop <= 0 && near < 24 && !p.dead && !p.creative) this.swoop = 4;
      this.hoverHeight = this.swoop > 2 ? Math.max(0.5, p.y - ctx.world.surfaceBelow(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z))) : this.def.key === 'phantom' ? 14 : 8;
      if (this.def.key === 'phantom' && ctx.dayCycle.daylight > 0.7) this.removed = this.distToPlayer > 32 || this.removed;
    }
    // le chef charge quand il est à moyenne distance
    if (this.def.key === 'zombie_chief' && this.ai.canSee && this.distToPlayer > 4 && this.distToPlayer < 12 && this.attackTimer < -2) {
      this.attackTimer = 0;
      const p = ctx.player;
      const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz) || 1;
      this.body.vx = (dx / d) * 9;
      this.body.vz = (dz / d) * 9;
      this.body.vy = 4;
      ctx.audio.play('roar', { x: this.x, y: this.y, z: this.z });
      ctx.particles.burst('dust', this.x, this.y, this.z, 10);
    }
  }

  /** Salve du blaze et sensibilité à l'eau (1 dégât toutes les 0,5 s dans l'eau ou sous la pluie). */
  private blazeUpdate(ctx: GameContext, dt: number) {
    if (this.burst > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burst--;
        this.burstTimer = 0.3;
        if (!ctx.player.dead && this.ai.canSee) this.fireShot(ctx);
      }
    }
    const wet = this.body.inWater || (ctx.raining() && ctx.dimension === 'overworld' && ctx.world.getLight(Math.floor(this.x), Math.floor(this.y + 1.8), Math.floor(this.z)).sky >= 15);
    this.wetTimer -= dt;
    if (wet && this.wetTimer <= 0) {
      this.wetTimer = 0.5;
      ctx.combat.damageMob(this, 1, { kind: 'environment' });
    }
  }

  /** Araignée : bondit sur sa cible quand elle est à 2 à 4 blocs (LeapAtTargetGoal). */
  private spiderLeap(ctx: GameContext, dt: number) {
    this.leapTimer -= dt;
    const st = this.ai.state;
    if (this.leapTimer > 0 || !this.body.onGround || (st !== AIState.CHASE && st !== AIState.ATTACK)) return;
    const p = ctx.player;
    const d = Math.hypot(p.x - this.x, p.z - this.z);
    if (d < 2 || d > 4 || p.dead || Math.random() > dt * 4) return;
    this.leapTimer = 1;
    const k = 1 / (d || 1);
    this.body.vx = (p.x - this.x) * k * 8 + this.body.vx * 0.2;
    this.body.vz = (p.z - this.z) * k * 8 + this.body.vz * 0.2;
    this.body.vy = 8;
  }

  /** Division du slime / cube de magma : 2 à 4 enfants de taille moitié. */
  protected onDeath(_ctx: GameContext) {
    const s = this.size;
    if (s <= 1) return;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const ox = ((i % 2) - 0.5) * s * 0.5, oz = (Math.floor(i / 2) - 0.5) * s * 0.5;
      const c = this.spawner.spawnMob(this.def.key, this.x + ox, this.y + 0.5, this.z + oz, { size: s / 2 });
      if (c && this.persistent) c.persistent = true;
    }
  }

  /**
   * Renforts du zombie (Zombie#hurt) : en difficile, un zombie blessé a une petite chance d'appeler un
   * autre zombie à 7-40 blocs ; chacun perd 0,05 de chance après l'appel.
   */
  onHurt(ctx: GameContext) {
    if (this.dead || !REINFORCERS.has(this.def.key) || ctx.player.dead || ctx.gamerules.doMobSpawning === false) return;
    let bonus = this.dynProps.get('__reinf') as number | undefined;
    if (bonus === undefined) {
      bonus = rollReinforcementBonus(Math.random);
      this.dynProps.set('__reinf', bonus);
    }
    if (Math.random() >= reinforcementChance(ctx.player.difficulty, bonus)) return;
    const spot = reinforcementSpot(ctx.world, this.x, this.y, this.z, ctx.player.x, ctx.player.z, Math.random);
    if (!spot) return;
    const z = this.spawner.spawnMob('zombie', spot[0] + 0.5, spot[1], spot[2] + 0.5);
    if (!z) return;
    z.dynProps.set('__reinf', 0);
    this.dynProps.set('__reinf', bonus - 0.05);
    z.ai.lastSeenX = ctx.player.x;
    z.ai.lastSeenZ = ctx.player.z;
    z.ai.lastSeenY = ctx.player.y;
    z.ai.fsm.set(AIState.SEARCH);
  }

  /**
   * Mèche (SwellGoal) : s'allume à moins de 3 blocs d'une cible visible, continue tant qu'elle est
   * visible à moins de 7 blocs, sinon se dégonfle ; le creeper s'arrête pendant qu'il gonfle.
   */
  private creeperUpdate(ctx: GameContext, dt: number) {
    const p = ctx.player;
    const targetable = !p.dead && !p.creative;
    if (targetable && creeperSwellDir(this.fuse > 0, this.distToPlayer, this.ai.canSee) > 0) {
      if (this.fuse === 0) ctx.audio.play('fuse', { x: this.x, y: this.y + 1, z: this.z });
      this.fuse += dt;
      this.ai.hold = 0.15;
      this.body.vx *= 0.5;
      this.body.vz *= 0.5;
    } else this.fuse = Math.max(0, this.fuse - dt);
    if (this.fuse >= CREEPER_FUSE) {
      const s = ctx as unknown as { explosions?: { explode(c: GameContext, e: unknown, x: number, y: number, z: number, p: number, b: boolean): void }; entities?: unknown };
      this.dead = true;
      this.removed = true;
      s.explosions?.explode(ctx, s.entities, this.x, this.y + 0.8, this.z, this.charged ? CHARGED_CREEPER_POWER : CREEPER_POWER, ctx.gamerules.mobGriefing !== false);
    }
  }

  render(ctx: GameContext, alpha: number, t: number) {
    super.render(ctx, alpha, t);
    if (this.fuse > 0) {
      // gonflement et clignotement blanc
      const k = Math.min(1, this.fuse / CREEPER_FUSE);
      const s = (this.def.scale ?? 1) * (1 + k * 0.25);
      this.model.group.scale.set(s, s * (1 + k * 0.08), s);
      if (Math.floor(this.fuse * 8) % 2 === 0) this.model.setTint(2.2, 2.2, 2.2);
    } else if (this.def.key === 'creeper') this.model.group.scale.setScalar(this.def.scale ?? 1);
    if (this.charged) this.model.setTint(0.75, 0.95, 1.6);
  }
}
