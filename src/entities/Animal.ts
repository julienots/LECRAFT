import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { Mob, type EntitySpawner } from './Mob';
import { B } from '../blocks/BlockRegistry';
import { WOOL_COLORS } from '../data/blocks';

/** Couleurs naturelles des moutons (probabilités vanilla). */
const SHEEP_COLORS: [string, number][] = [['white', 0.8184], ['black', 0.05], ['gray', 0.05], ['light_gray', 0.05], ['brown', 0.03], ['pink', 0.0016]];
export function randomSheepColor(): string {
  let r = Math.random() * SHEEP_COLORS.reduce((a, c) => a + c[1], 0);
  for (const [c, w] of SHEEP_COLORS) if ((r -= w) < 0) return c;
  return 'white';
}
export const woolHex = (c: string) => parseInt((WOOL_COLORS.find((w) => w[0] === c)?.[2] ?? '#ffffff').slice(1), 16);

/**
 * Animal (passif ou neutre) : fuite quand il est blessé (passifs), colère (neutres),
 * attiré par sa nourriture, reproduction (mode « amour ») et croissance des petits.
 */
export class Animal extends Mob {
  /** Couleur de laine (moutons). */
  woolColor = 'white';
  sheared = false;
  private eggTimer = 300 + Math.random() * 300;

  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner) {
    super(def, index, x, y, z, spawner);
    if (def.key === 'sheep') this.setWool(randomSheepColor(), false);
  }

  setWool(color: string, sheared: boolean) {
    this.woolColor = color;
    this.sheared = sheared;
    this.model.setFur(sheared ? null : woolHex(color));
  }

  /** Tonte (cisailles) : 1 à 3 laines de la couleur du mouton. */
  shear(ctx: GameContext): boolean {
    if (!this.has('shearable') || this.sheared || this.baby || this.dead) return false;
    this.setWool(this.woolColor, true);
    this.spawner.spawnItem(`${this.woolColor}_wool`, 1 + Math.floor(Math.random() * 3), this.x, this.y + 1, this.z);
    ctx.audio.play('shear', { x: this.x, y: this.y, z: this.z });
    return true;
  }

  protected customUpdate(ctx: GameContext, dt: number) {
    // la laine repousse en broutant l'herbe
    if (this.sheared && Math.random() < dt / 40) {
      const bx = Math.floor(this.x), by = Math.floor(this.y - 0.5), bz = Math.floor(this.z);
      if (ctx.world.getBlock(bx, by, bz) === B.GRASS_BLOCK) {
        ctx.world.setBlock(bx, by, bz, B.DIRT);
        this.setWool(this.woolColor, false);
      }
    }
    // les poules pondent des œufs toutes les 5 à 10 minutes
    if (this.has('laysEggs') && !this.baby) {
      this.eggTimer -= dt;
      if (this.eggTimer <= 0) {
        this.eggTimer = 300 + Math.random() * 300;
        this.spawner.spawnItem('egg', 1, this.x, this.y + 0.3, this.z);
        ctx.audio.play('pop', { x: this.x, y: this.y, z: this.z, volume: 0.5 });
      }
    }
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
      if (baby instanceof Animal && this.def.key === 'sheep') baby.setWool(Math.random() < 0.5 ? this.woolColor : o.woolColor, false);
      if (baby) {
        ctx.particles.burst('hearts', baby.x, baby.y + 0.6, baby.z, 8);
        ctx.stats.inc('animalsBred');
        ctx.player.addXp(3);
      }
      return;
    }
  }
}
