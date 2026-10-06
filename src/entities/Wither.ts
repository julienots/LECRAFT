import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { Boss } from './Boss';
import type { EntitySpawner } from './Mob';
import { PROJECTILE_DEFS } from './Projectile';
import { B, BlockRegistry } from '../blocks/BlockRegistry';

/**
 * Wither : invoqué avec 4 blocs de sable des âmes en T et 3 crânes de squelette wither.
 * Charge pendant 10 s (invulnérable, la santé monte) puis explose ; vole au-dessus du joueur,
 * tire des crânes noirs (explosifs, effet wither) et parfois des crânes bleus, se régénère,
 * et sous la moitié de sa santé, son armure le rend insensible aux flèches et il fonce.
 * Chaque coup reçu détruit les blocs qui l'entourent.
 */
export class WitherBoss extends Boss {
  protected thresholds = [0.5];
  /** Charge initiale (s) : invulnérable. */
  charging = 10;
  private skullTimer = 3;
  private blueTimer = 8;
  private dashTimer = 6;
  private orbit = Math.random() * Math.PI * 2;
  private breakCooldown = 0;

  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner, altarKey: string) {
    super(def, index, x, y, z, spawner, altarKey);
    this.body.gravity = 0;
    this.ai.update = () => {};
    this.health = def.health / 3;
  }

  get invulnerable() {
    return this.charging > 0;
  }

  /** Armure du Wither (sous la moitié de sa santé) : les projectiles ne le blessent pas. */
  get armored() {
    return this.charging <= 0 && this.healthFrac <= 0.5;
  }

  /** Pendant la charge, pas de changement de phase (la santé part du tiers). */
  protected customUpdate(ctx: GameContext, dt: number) {
    if (this.charging > 0) this.abilities(ctx, dt);
    else super.customUpdate(ctx, dt);
  }

  protected onPhase(ctx: GameContext, phase: number) {
    if (phase === 2) {
      ctx.hud.toast("L'armure du Wither le protège des flèches !", 'warn');
      ctx.particles.burst('smoke', this.x, this.y + 2, this.z, 30);
    }
  }

  onHurt(ctx: GameContext) {
    // détruit les blocs autour de lui (pas la bedrock, l'obsidienne ni les portails)
    if (this.breakCooldown > 0 || this.charging > 0 || ctx.gamerules.mobGriefing === false) return;
    this.breakCooldown = 1;
    const w = ctx.world;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = 0; dy <= 3; dy++) {
          const x = Math.floor(this.x) + dx, y = Math.floor(this.y) + dy, z = Math.floor(this.z) + dz;
          const b = w.getBlock(x, y, z);
          if (b <= 0 || BlockRegistry.liquid[b]) continue;
          const def = BlockRegistry.get(b);
          if (def.hardness < 0 || b === B.OBSIDIAN || b === B.BEDROCK) continue;
          w.setBlock(x, y, z, B.AIR);
        }
  }

  protected abilities(ctx: GameContext, dt: number) {
    const p = ctx.player;
    this.breakCooldown -= dt;
    this.body.gravity = 0;
    // charge : invulnérable, santé qui remonte, puis explosion
    if (this.charging > 0) {
      this.charging -= dt;
      this.health = Math.min(this.def.health, this.health + (this.def.health * (2 / 3) * dt) / 10);
      this.body.vx = this.body.vy = this.body.vz = 0;
      this.yaw += dt * 2;
      if (Math.random() < dt * 20) ctx.particles.burst('smoke', this.x, this.y + 2, this.z, 2);
      if (this.charging <= 0) {
        const s = ctx as unknown as { explosions?: { explode(c: GameContext, e: unknown, x: number, y: number, z: number, p: number, b: boolean): void }; entities?: unknown };
        s.explosions?.explode(ctx, s.entities, this.x, this.y + 1.5, this.z, 7, ctx.gamerules.mobGriefing !== false);
        // sa propre explosion ne le blesse pas : il commence le combat avec toute sa santé
        this.health = this.def.health;
        this.hurtTimer = 0;
        ctx.audio.play('wither_spawn', { volume: 1 });
        ctx.shake(1);
      }
      return;
    }
    // régénération (1 PV/s)
    this.health = Math.min(this.def.health, this.health + dt);
    if (p.dead || p.creative) {
      this.body.vx *= 0.9;
      this.body.vz *= 0.9;
      this.body.vy *= 0.9;
      return;
    }
    // vol : plane en cercle au-dessus du joueur ; sous la moitié de sa santé, fonce sur lui
    this.orbit += dt * 0.6;
    let tx = p.x + Math.cos(this.orbit) * 8, ty = p.y + 6, tz = p.z + Math.sin(this.orbit) * 8;
    if (this.armored) {
      this.dashTimer -= dt;
      if (this.dashTimer < 1.2) {
        tx = p.x;
        ty = p.y + 1;
        tz = p.z;
        if (this.dashTimer <= 0) this.dashTimer = 6;
      }
    }
    const dx = tx - this.x, dy = ty - this.y, dz = tz - this.z, d = Math.hypot(dx, dy, dz) || 1;
    const sp = this.armored && this.dashTimer < 1.2 ? 14 : this.def.speed;
    const k = Math.min(1, dt * 2);
    this.body.vx += ((dx / d) * Math.min(sp, d * 2) - this.body.vx) * k;
    this.body.vy += ((dy / d) * Math.min(sp, d * 2) - this.body.vy) * k;
    this.body.vz += ((dz / d) * Math.min(sp, d * 2) - this.body.vz) * k;
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    if (this.armored && this.dashTimer < 1.2 && this.distToPlayer < 2.5) {
      p.damage(this.def.damage, 'boss', (p.x - this.x) * 3, (p.z - this.z) * 3, this);
      this.dashTimer = 6;
    }
    // crânes noirs (explosifs) et bleus (dangereux)
    this.skullTimer -= dt;
    this.blueTimer -= dt;
    if (this.distToPlayer < 40 && this.ai.lineOfSight(ctx)) {
      if (this.skullTimer <= 0) {
        this.skullTimer = this.phase >= 2 ? 1 : 1.5;
        this.shoot(ctx, 'minecraft:wither_skull');
      }
      if (this.blueTimer <= 0) {
        this.blueTimer = 7 + Math.random() * 5;
        this.shoot(ctx, 'minecraft:wither_skull_dangerous');
      }
    }
  }

  private shoot(ctx: GameContext, id: string) {
    const p = ctx.player;
    const def = PROJECTILE_DEFS.get(id)!;
    // une des trois têtes au hasard
    const side = Math.floor(Math.random() * 3) - 1;
    const sx = this.x + Math.cos(this.yaw) * side * 1.2, sy = this.y + 3.2, sz = this.z - Math.sin(this.yaw) * side * 1.2;
    const dx = p.x - sx, dy = p.y + 1 - sy, dz = p.z - sz, d = Math.hypot(dx, dy, dz) || 1;
    const speed = id.endsWith('dangerous') ? 7 : 12;
    const pr = this.spawner.spawnProjectile('custom', sx, sy, sz, (dx / d) * speed, (dy / d) * speed, (dz / d) * speed, def.damage, false, def);
    pr.owner = this;
    ctx.audio.play('wither_shoot', { x: sx, y: sy, z: sz });
    this.attackAnim = 1;
  }
}
