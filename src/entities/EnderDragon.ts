import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { Boss } from './Boss';
import { Mob, type EntitySpawner } from './Mob';
import { PROJECTILE_DEFS } from './Projectile';
import { END_ISLAND_Y } from '../world/EndGenerator';

type DragonState = 'circle' | 'charge' | 'perch' | 'leave';

/**
 * Dragon de l'Ender : tourne autour des piliers, fonce sur le joueur, crache des boules de feu,
 * se pose sur la fontaine centrale (souffle) ; les cristaux de l'End le soignent, et détruire
 * le cristal qui le soigne le blesse. Il traverse les blocs (vol libre).
 */
export class EnderDragon extends Boss {
  protected thresholds = [0.5];
  private state: DragonState = 'circle';
  private stateTime = 0;
  private angle = Math.random() * Math.PI * 2;
  private nextCharge = 10;
  private nextFireball = 6;
  private nextPerch = 35;
  /** Cristal qui soigne le dragon (rayon visible). */
  healer: EndCrystal | null = null;

  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner, altarKey: string) {
    super(def, index, x, y, z, spawner, altarKey);
    this.body.gravity = 0;
    this.body.noClip = true;
    this.ai.update = () => {};
  }

  protected onPhase(ctx: GameContext, phase: number) {
    if (phase === 2) {
      this.nextCharge = 2;
      ctx.audio.play('dragon_growl', { volume: 1 });
    }
  }

  private flyTo(x: number, y: number, z: number, speed: number, dt: number) {
    const dx = x - this.x, dy = y - this.y, dz = z - this.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const k = Math.min(1, dt * 1.8);
    this.body.vx += ((dx / d) * speed - this.body.vx) * k;
    this.body.vy += ((dy / d) * speed - this.body.vy) * k;
    this.body.vz += ((dz / d) * speed - this.body.vz) * k;
    if (Math.hypot(this.body.vx, this.body.vz) > 0.5) this.yaw = Math.atan2(this.body.vx, this.body.vz);
    return d;
  }

  protected abilities(ctx: GameContext, dt: number) {
    const p = ctx.player;
    this.body.noClip = true;
    this.body.gravity = 0;
    this.stateTime += dt;
    const fast = this.phase >= 2;
    // soin par le cristal le plus proche (≤ 32 blocs)
    let best: EndCrystal | null = null, bd = 32;
    for (const m of (this.spawner as unknown as { mobs: Mob[] }).mobs) {
      if (!(m instanceof EndCrystal) || m.dead) continue;
      const d = Math.hypot(m.x - this.x, m.y - this.y, m.z - this.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    this.healer = best;
    if (best && this.health < this.def.health) {
      this.health = Math.min(this.def.health, this.health + dt);
      // rayon de soin (particules le long du segment)
      if (Math.random() < dt * 30) {
        const t = Math.random();
        ctx.particles.burst('magic', best.x + (this.x - best.x) * t, best.y + 1 + (this.y + 2 - best.y - 1) * t, best.z + (this.z - best.z) * t, 1);
      }
    }
    switch (this.state) {
      case 'circle': {
        // vol circulaire autour des piliers
        this.angle += dt * (fast ? 0.45 : 0.32);
        const r = 48 + Math.sin(this.stateTime * 0.3) * 10;
        const ty = END_ISLAND_Y + 28 + Math.sin(this.stateTime * 0.5) * 8;
        this.flyTo(Math.cos(this.angle) * r, ty, Math.sin(this.angle) * r, fast ? 16 : 12, dt);
        if (p.dead || p.creative) break;
        this.nextFireball -= dt;
        if (this.nextFireball <= 0 && this.distToPlayer < 90) {
          this.nextFireball = fast ? 5 : 8;
          const def = PROJECTILE_DEFS.get('minecraft:dragon_fireball')!;
          const sx = this.x + Math.sin(this.yaw) * 6, sy = this.y + 2, sz = this.z + Math.cos(this.yaw) * 6;
          const dx = p.x - sx, dy = p.y + 1 - sy, dz = p.z - sz, d = Math.hypot(dx, dy, dz) || 1;
          const pr = this.spawner.spawnProjectile('custom', sx, sy, sz, (dx / d) * 14, (dy / d) * 14, (dz / d) * 14, def.damage, false, def);
          pr.owner = this;
          ctx.audio.play('ghast_shoot', { x: sx, y: sy, z: sz, volume: 1 });
        }
        this.nextCharge -= dt;
        if (this.nextCharge <= 0 && this.distToPlayer < 100) this.setState('charge');
        this.nextPerch -= dt;
        if (this.nextPerch <= 0) this.setState('perch');
        break;
      }
      case 'charge': {
        // fonce sur le joueur ; le heurter le projette en l'air
        const d = this.flyTo(p.x, p.y + 1, p.z, fast ? 26 : 22, dt);
        this.attackAnim = 1;
        if (d < 5 && !p.dead) {
          const kx = p.x - this.x, kz = p.z - this.z, kd = Math.hypot(kx, kz) || 1;
          p.damage(this.def.damage, 'boss', (kx / kd) * 14, (kz / kd) * 14, this);
          p.body.vy = 9;
          ctx.shake(0.8);
          this.setState('leave');
        } else if (this.stateTime > 7 || p.dead) this.setState('leave');
        break;
      }
      case 'leave': {
        this.flyTo(this.x + Math.sin(this.yaw) * 30, END_ISLAND_Y + 40, this.z + Math.cos(this.yaw) * 30, 18, dt);
        if (this.stateTime > 3) this.setState('circle');
        break;
      }
      case 'perch': {
        // se pose sur la fontaine du portail et souffle
        const d = this.flyTo(0, END_ISLAND_Y + 5, 0, 12, dt);
        if (d < 3) {
          this.body.vx *= 0.5;
          this.body.vy *= 0.5;
          this.body.vz *= 0.5;
          this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
          if (Math.random() < dt * 20) ctx.particles.burst('magic', this.x + Math.sin(this.yaw) * 8, this.y + 1, this.z + Math.cos(this.yaw) * 8, 3);
          const hx = this.x + Math.sin(this.yaw) * 8, hz = this.z + Math.cos(this.yaw) * 8;
          if (!p.dead && Math.hypot(p.x - hx, p.z - hz) < 5 && Math.abs(p.y - this.y) < 5 && Math.random() < dt * 2) p.damage(3, 'boss', 0, 0, this);
        }
        if (this.stateTime > 12) this.setState('leave');
        break;
      }
    }
  }

  private setState(s: DragonState) {
    this.state = s;
    this.stateTime = 0;
    if (s === 'circle') this.nextCharge = this.phase >= 2 ? 6 + Math.random() * 4 : 10 + Math.random() * 8;
    if (s === 'perch') this.nextPerch = 40 + Math.random() * 30;
  }
}

/**
 * Cristal de l'End : posé sur la bedrock au sommet des piliers ; soigne le dragon.
 * Un coup (ou une flèche) le fait exploser ; s'il soignait le dragon, celui-ci est blessé.
 */
export class EndCrystal extends Mob {
  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner) {
    super(def, index, x, y, z, spawner);
    this.body.gravity = 0;
    this.persistent = true;
    this.ai.update = () => {};
  }

  protected customUpdate() {
    this.body.vx = this.body.vy = this.body.vz = 0;
  }

  onHurt(ctx: GameContext) {
    if (this.dead) return;
    this.dead = true;
    this.removed = true;
    const s = ctx as unknown as { explosions?: { explode(c: GameContext, e: unknown, x: number, y: number, z: number, p: number, b: boolean): void }; entities?: unknown };
    s.explosions?.explode(ctx, s.entities, this.x, this.y + 1, this.z, 3, false);
    for (const m of (this.spawner as unknown as { mobs: Mob[] }).mobs)
      if (m instanceof EnderDragon && m.healer === this && !m.dead) {
        m.iframes = 0;
        ctx.combat.damageMob(m, 10, { kind: 'environment' });
      }
  }
}
