import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { Mob, type EntitySpawner } from './Mob';

/** Durée de la mèche du creeper (1,5 s comme le jeu de référence). */
const CREEPER_FUSE = 1.5;

/** Créature hostile (zombie, squelette, araignées, slime, chef zombie, creeper). */
export class Monster extends Mob {
  /** Temps passé loin du joueur (disparition). */
  farTime = 0;
  /** Creeper : progression de la mèche (secondes). */
  fuse = 0;
  /** Phantom : piqué en cours (secondes). */
  private swoop = 2;
  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner) {
    super(def, index, x, y, z, spawner);
    if (def.key === 'ghast') this.hoverHeight = 7;
    else if (def.key === 'blaze') this.hoverHeight = 1.5;
    else if (def.key === 'phantom') this.hoverHeight = 14;
  }

  /** Le creeper n'attaque pas : il allume sa mèche (voir customUpdate). */
  meleeAttack(ctx: GameContext) {
    if (this.def.key !== 'creeper') super.meleeAttack(ctx);
  }

  protected customUpdate(ctx: GameContext, dt: number) {
    if (this.distToPlayer > 40) this.farTime += dt;
    else this.farTime = 0;
    if (this.def.key === 'creeper' && !this.dead) this.creeperUpdate(ctx, dt);
    // phantom : tourne haut dans le ciel puis pique sur le joueur
    if (this.def.key === 'phantom' && !this.dead) {
      const p = ctx.player;
      const near = Math.hypot(p.x - this.x, p.z - this.z);
      this.swoop -= dt;
      if (this.swoop <= 0 && near < 24 && !p.dead && !p.creative) this.swoop = 4;
      this.hoverHeight = this.swoop > 2 ? Math.max(0.5, p.y - ctx.world.surfaceBelow(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z))) : 14;
      if (ctx.dayCycle.daylight > 0.7) this.removed = this.distToPlayer > 32 || this.removed;
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

  /** Mèche : s'allume à moins de 3 blocs du joueur visible, s'éteint s'il s'éloigne à plus de 7 blocs. */
  private creeperUpdate(ctx: GameContext, dt: number) {
    const p = ctx.player;
    const close = !p.dead && !p.creative && this.ai.canSee && this.distToPlayer < 3;
    if (close || (this.fuse > 0 && this.distToPlayer < 7 && !p.dead)) {
      if (this.fuse === 0) ctx.audio.play('fuse', { x: this.x, y: this.y + 1, z: this.z });
      this.fuse += dt;
      // immobile pendant la mèche
      this.body.vx *= 0.5;
      this.body.vz *= 0.5;
    } else this.fuse = Math.max(0, this.fuse - dt);
    if (this.fuse >= CREEPER_FUSE) {
      const s = ctx as unknown as { explosions?: { explode(c: GameContext, e: unknown, x: number, y: number, z: number, p: number, b: boolean): void }; entities?: unknown };
      this.dead = true;
      this.removed = true;
      s.explosions?.explode(ctx, s.entities, this.x, this.y + 0.8, this.z, 3, ctx.gamerules.mobGriefing !== false);
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
  }
}
