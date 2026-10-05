import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { Mob, type EntitySpawner } from './Mob';

/** Créature hostile (zombie, squelette, araignées, slime, chef zombie). */
export class Monster extends Mob {
  /** Temps passé loin du joueur (disparition). */
  farTime = 0;
  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner) {
    super(def, index, x, y, z, spawner);
  }

  protected customUpdate(ctx: GameContext, dt: number) {
    if (this.distToPlayer > 40) this.farTime += dt;
    else this.farTime = 0;
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
}
