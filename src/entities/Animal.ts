import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { Mob, type EntitySpawner } from './Mob';

/**
 * Animal (passif ou neutre) : fuite quand il est blessé (passifs), colère (neutres),
 * attiré par sa nourriture, reproduction (mode « amour ») et croissance des petits.
 */
export class Animal extends Mob {
  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner) {
    super(def, index, x, y, z, spawner);
  }

  /** Nourrir : renvoie vrai si la nourriture a été acceptée. */
  feed(ctx: GameContext, itemId: string): boolean {
    if (!this.def.food?.includes(itemId) || this.dead) return false;
    if (this.baby) {
      this.growTimer -= 60;
      ctx.particles.burst('hearts', this.x, this.y + this.body.height, this.z, 3);
      return true;
    }
    if (this.breedCooldown > 0 || this.loveTimer > 0) return false;
    this.loveTimer = 30;
    this.persistent = true;
    ctx.particles.burst('hearts', this.x, this.y + this.body.height, this.z, 5);
    ctx.audio.play(this.def.sounds.idle, { x: this.x, y: this.y, z: this.z });
    if (this.def.category === 'neutral') this.anger = 0;
    return true;
  }

  /** Cherche un partenaire en mode amour à proximité. */
  tryBreed(ctx: GameContext, others: Mob[]) {
    if (this.loveTimer <= 0 || this.baby || this.dead) return;
    for (const o of others) {
      if (o === this || !(o instanceof Animal) || o.def.key !== this.def.key || o.loveTimer <= 0 || o.baby || o.dead) continue;
      const d = Math.hypot(o.x - this.x, o.z - this.z);
      if (d > 8) continue;
      if (d > 1.6) {
        this.ai.moveTowards(o.x, o.z, 0.8);
        return;
      }
      this.loveTimer = o.loveTimer = 0;
      this.breedCooldown = o.breedCooldown = 300;
      const baby = this.spawner.spawnMob(this.def.key, (this.x + o.x) / 2, this.y + 0.2, (this.z + o.z) / 2, { baby: true, persistent: true });
      if (baby) {
        ctx.particles.burst('hearts', baby.x, baby.y + 0.6, baby.z, 8);
        ctx.stats.inc('animalsBred');
        ctx.player.addXp(3);
      }
      return;
    }
  }
}
