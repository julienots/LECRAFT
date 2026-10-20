import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { Mob, type EntitySpawner } from './Mob';
import { B } from '../blocks/BlockRegistry';
import { WOOL_COLORS } from '../data/blocks';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { AIState } from '../ai/StateMachine';
import { BREED_COOLDOWN_SECONDS, ironGolemDamage, rollBarter } from './SpawnRules';

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
  /** Piglin : troc en cours (secondes avant de lâcher le résultat). */
  barterTimer = 0;

  /** Animal apprivoisé (chat, perroquet ; le loup gère aussi ce drapeau). */
  get tamedPet(): boolean {
    return !!this.dynProps.get('__tamed');
  }

  /** Golem de fer : 7,5 à 21,5 dégâts (jeu Java), comme contre les monstres. */
  meleeDamage(): number {
    return this.def.key === 'iron_golem' ? ironGolemDamage() : this.def.damage;
  }

  /** Butin propre à l'individu : laine du mouton (s'il n'est pas tondu). */
  protected onDeath(_ctx: GameContext) {
    if (this.def.key === 'sheep' && !this.sheared && !this.baby) this.spawner.spawnItem(`${this.woolColor}_wool`, 1, this.x, this.y + 0.5, this.z);
  }

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

  private guardTimer = 0;

  protected customUpdate(ctx: GameContext, dt: number) {
    // golem de fer : défend le village contre les monstres proches
    if (this.def.key === 'iron_golem' && !this.dead) {
      this.guardTimer -= dt;
      let foe: Mob | null = null, best = 14;
      for (const e of (ctx as unknown as { entities: { entities: Mob[] } }).entities.entities) {
        const m = e as Mob;
        if (e.kind !== 'mob' || m.dead || m.def.category !== 'hostile' || m.def.key === 'creeper') continue;
        const d = Math.hypot(m.x - this.x, m.z - this.z);
        if (d < best) {
          best = d;
          foe = m;
        }
      }
      if (foe) {
        if (best > 2.2) this.ai.moveTowards(foe.x, foe.z, 1.1, true);
        else if (this.guardTimer <= 0) {
          this.guardTimer = 1.2;
          this.attackAnim = 1;
          const d = best || 1;
          ctx.combat.damageMob(foe, ironGolemDamage(), { kind: 'bot', knockX: ((foe.x - this.x) / d) * 3, knockZ: ((foe.z - this.z) / d) * 3, attacker: this as never });
          foe.body.vy = 7;
          ctx.audio.play('stone_hit', { x: this.x, y: this.y, z: this.z });
        }
      } else if (Math.hypot(this.homeX - this.x, this.homeZ - this.z) > 24) this.ai.moveTowards(this.homeX, this.homeZ, 0.6, true);
    }
    // la laine repousse en broutant l'herbe
    if (this.sheared && Math.random() < dt / 40) {
      const bx = Math.floor(this.x), by = Math.floor(this.y - 0.5), bz = Math.floor(this.z);
      if (ctx.world.getBlock(bx, by, bz) === B.GRASS_BLOCK) {
        ctx.world.setBlock(bx, by, bz, B.DIRT);
        this.setWool(this.woolColor, false);
      }
    }
    // les poules pondent des œufs toutes les 5 à 10 minutes ; le tatou perd une écaille aussi souvent
    if ((this.has('laysEggs') || this.def.key === 'armadillo') && !this.baby) {
      this.eggTimer -= dt;
      if (this.eggTimer <= 0) {
        this.eggTimer = 300 + Math.random() * 300;
        this.spawner.spawnItem(this.def.key === 'armadillo' ? 'armadillo_scute' : 'egg', 1, this.x, this.y + 0.3, this.z);
        ctx.audio.play('pop', { x: this.x, y: this.y, z: this.z, volume: 0.5 });
      }
    }
    // piglin : examine le lingot d'or 6 s puis lâche le résultat du troc
    if (this.barterTimer > 0) {
      this.barterTimer -= dt;
      this.ai.stop();
      if (this.barterTimer <= 0 && !this.dead) {
        const r = rollBarter((id) => ItemRegistry.has(id));
        if (r) this.spawner.spawnItem(r.item, r.count, this.x, this.y + 1, this.z);
      }
    }
    // chat / perroquet apprivoisé : suit son maître et le rejoint s'il est trop loin
    if (this.tamedPet && this.def.key !== 'wolf' && !this.dead) {
      const p = ctx.player;
      if (this.ai.state === AIState.WANDER || this.ai.state === AIState.IDLE) {
        if (this.distToPlayer > 12 && !p.dead) {
          const x = Math.floor(p.x + (Math.random() - 0.5) * 3), z = Math.floor(p.z + (Math.random() - 0.5) * 3);
          if (ctx.world.isSolid(x, Math.floor(p.y) - 1, z) && ctx.world.getBlock(x, Math.floor(p.y), z) === B.AIR) this.body.setPos(x + 0.5, Math.floor(p.y), z + 0.5);
        } else if (this.distToPlayer > 5 && !p.dead) this.ai.moveTowards(p.x, p.z, 1);
      }
    }
  }

  /** Chat (1 chance sur 3, poisson cru) et perroquet (1 chance sur 10, graines) : apprivoisement. */
  private tryTame(ctx: GameContext): boolean {
    const chance = this.def.key === 'parrot' ? 0.1 : 1 / 3;
    if (Math.random() < chance) {
      this.dynProps.set('__tamed', true);
      this.persistent = true;
      this.fleeTimer = 0;
      ctx.particles.burst('hearts', this.x, this.y + this.body.height, this.z, 7);
    } else ctx.particles.burst('smoke', this.x, this.y + this.body.height, this.z, 6);
    return true;
  }

  /** Nourrir : renvoie vrai si la nourriture a été acceptée. */
  feed(ctx: GameContext, itemId: string): boolean {
    if (!this.def.food?.includes(itemId) || this.dead) return false;
    // piglin : troc contre un lingot d'or (adulte seulement)
    if (this.def.key === 'piglin') {
      if (this.baby || this.barterTimer > 0 || this.anger > 0) return false;
      this.barterTimer = 6;
      return true;
    }
    // apprivoisement (chat, perroquet) ; le loup sauvage ne se nourrit pas (os uniquement), le perroquet ne se reproduit pas
    if (this.has('tameable') && !this.tamedPet) return this.def.key === 'wolf' ? false : this.tryTame(ctx);
    if (this.def.key === 'parrot') return false;
    if (this.baby) {
      // chaque nourriture retire 10 % du temps de croissance restant
      this.growTimer -= this.growTimer * 0.1;
      ctx.particles.burst('hearts', this.x, this.y + this.body.height, this.z, 3);
      return true;
    }
    if (this.breedCooldown > 0 || this.loveTimer > 0) return false;
    this.loveTimer = 30;
    this.persistent = true;
    ctx.particles.burst('hearts', this.x, this.y + this.body.height, this.z, 5);
    if (ctx.audio.mobSound) ctx.audio.mobSound(this.def.key, 'idle', this.def.sounds.idle, { x: this.x, y: this.y, z: this.z });
    else ctx.audio.play(this.def.sounds.idle, { x: this.x, y: this.y, z: this.z });
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
      this.breedCooldown = o.breedCooldown = BREED_COOLDOWN_SECONDS;
      const baby = this.spawner.spawnMob(this.def.key, (this.x + o.x) / 2, this.y + 0.2, (this.z + o.z) / 2, { baby: true, persistent: true });
      if (baby instanceof Animal && this.def.key === 'sheep') baby.setWool(Math.random() < 0.5 ? this.woolColor : o.woolColor, false);
      if (baby) {
        ctx.particles.burst('hearts', baby.x, baby.y + 0.6, baby.z, 8);
        ctx.stats.inc('animalsBred');
        // 1 à 7 points d'expérience par naissance
        ctx.player.addXp(1 + Math.floor(Math.random() * 7));
      }
      return;
    }
  }
}
