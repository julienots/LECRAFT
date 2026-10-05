import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { Mob, type EntitySpawner } from './Mob';

/**
 * Boss à phases. Chaque boss combine les états d'IA standard (poursuite/attaque)
 * avec des capacités spécifiques débloquées selon sa santé restante.
 */
export abstract class Boss extends Mob {
  phase = 1;
  altarKey: string;
  protected abstract thresholds: number[]; // fractions de santé déclenchant les phases 2, 3...
  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner, altarKey: string) {
    super(def, index, x, y, z, spawner);
    this.altarKey = altarKey;
    this.persistent = true;
  }

  get healthFrac() {
    return Math.max(0, this.health / this.def.health);
  }

  protected customUpdate(ctx: GameContext, dt: number) {
    let p = 1;
    for (const t of this.thresholds) if (this.healthFrac <= t) p++;
    if (p !== this.phase) {
      this.phase = p;
      this.onPhase(ctx, p);
      ctx.hud.toast(`${this.def.name} — phase ${p} !`, 'warn');
      ctx.audio.play('roar', { x: this.x, y: this.y, z: this.z, volume: 1 });
      ctx.shake(0.6);
    }
    this.abilities(ctx, dt);
  }
  protected abstract onPhase(ctx: GameContext, phase: number): void;
  protected abstract abilities(ctx: GameContext, dt: number): void;
  /** Appelé par le système de combat quand le boss est touché. */
  onHit(_ctx: GameContext) {}
}

/** Golem des profondeurs : coups au sol, bond + onde de choc, rochers, invocations. */
export class GolemBoss extends Boss {
  protected thresholds = [0.6, 0.3];
  private leapTimer = 5;
  private leapState: 'none' | 'charge' | 'air' = 'none';
  private leapCharge = 0;
  private boulderTimer = 4;
  private summoned = false;

  protected onPhase(ctx: GameContext, phase: number) {
    if (phase === 3) {
      this.ai.speedMul = 1.3;
      if (!this.summoned) {
        this.summoned = true;
        for (let i = 0; i < 2; i++) this.spawner.spawnMob('zombie', this.x + (i ? 3 : -3), this.y + 0.5, this.z + 2);
        ctx.particles.burst('smoke', this.x, this.y + 1, this.z, 20);
      }
    }
  }

  protected abilities(ctx: GameContext, dt: number) {
    const p = ctx.player;
    if (this.phase >= 2) {
      if (this.leapState === 'none') {
        this.leapTimer -= dt;
        if (this.leapTimer <= 0 && this.ai.canSee && this.distToPlayer > 3 && this.body.onGround) {
          this.leapState = 'charge';
          this.leapCharge = 0.9;
          ctx.audio.play('golem_idle', { x: this.x, y: this.y, z: this.z, volume: 1 });
        }
      } else if (this.leapState === 'charge') {
        this.leapCharge -= dt;
        this.body.vx *= 0.5;
        this.body.vz *= 0.5;
        this.attackAnim = 1;
        if (Math.random() < 0.5) ctx.particles.burst('dust', this.x, this.y, this.z, 2);
        if (this.leapCharge <= 0) {
          const t = 0.9;
          this.body.vx = (p.x - this.x) / t;
          this.body.vz = (p.z - this.z) / t;
          this.body.vy = 12.5;
          this.leapState = 'air';
        }
      } else if (this.leapState === 'air' && this.body.onGround && this.body.vy <= 0) {
        this.leapState = 'none';
        this.leapTimer = this.phase >= 3 ? 4.5 : 6.5;
        this.body.vx = this.body.vz = 0;
        ctx.particles.burst('explosion', this.x, this.y + 0.3, this.z, 30);
        ctx.audio.play('slam', { x: this.x, y: this.y, z: this.z, volume: 1 });
        ctx.shake(1);
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d < 5 && Math.abs(p.y - this.y) < 2.5) {
          const k = 1 - d / 5.5;
          p.damage(9 * k + 2, 'boss', ((p.x - this.x) / (d || 1)) * 10, ((p.z - this.z) / (d || 1)) * 10, this);
          ctx.haptic('heavy');
        }
      }
    }
    if (this.phase >= 3) {
      this.boulderTimer -= dt;
      if (this.boulderTimer <= 0 && this.distToPlayer > 6 && this.ai.canSee && this.leapState === 'none') {
        this.boulderTimer = 4;
        const sx = this.x, sy = this.y + 3, sz = this.z;
        const dx = p.x - sx, dz = p.z - sz, dh = Math.hypot(dx, dz) || 1;
        const speed = 15, t = dh / speed;
        this.spawner.spawnProjectile('boulder', sx, sy, sz, (dx / dh) * speed, (p.y + 1 - sy) / t + 6 * t, (dz / dh) * speed, 6, false);
        this.attackAnim = 1;
      }
    }
  }
}

/** Liche de givre : éclats de glace, téléportation, anneau de projectiles, pics de glace, spectres. */
export class LichBoss extends Boss {
  protected thresholds = [0.5, 0.25];
  private hits = 0;
  private ringTimer = 5;
  private spikeTimer = 3;
  private spikes: { x: number; y: number; z: number; t: number }[] = [];
  private summoned = false;

  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner, altarKey: string) {
    super(def, index, x, y, z, spawner, altarKey);
    this.hoverHeight = 2.5;
  }

  protected onPhase(ctx: GameContext, phase: number) {
    if (phase === 3 && !this.summoned) {
      this.summoned = true;
      for (let i = 0; i < 2; i++) this.spawner.spawnMob('skeleton', this.x + (i ? 4 : -4), this.y + 1, this.z);
      ctx.particles.burst('magic', this.x, this.y + 2, this.z, 30);
    }
  }

  onHit(ctx: GameContext) {
    if (this.phase < 2) return;
    this.hits++;
    if (this.hits >= 3) {
      this.hits = 0;
      this.teleport(ctx);
    }
  }

  private teleport(ctx: GameContext) {
    const p = ctx.player;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 4;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const y = p.y + 1;
      if (!this.body.collides(ctx.world, x, y, z)) {
        ctx.particles.burst('magic', this.x, this.y + 1, this.z, 16);
        this.body.setPos(x, y, z);
        ctx.particles.burst('magic', x, y + 1, z, 16);
        ctx.audio.play('teleport', { x, y, z });
        return;
      }
    }
  }

  protected abilities(ctx: GameContext, dt: number) {
    const p = ctx.player;
    if (this.phase >= 2) {
      this.ringTimer -= dt;
      if (this.ringTimer <= 0) {
        this.ringTimer = this.phase >= 3 ? 4 : 5.5;
        const n = 10;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          this.spawner.spawnProjectile('ice', this.x, this.y + 1.5, this.z, Math.cos(a) * 9, (p.y + 1 - (this.y + 1.5)) * 0.3, Math.sin(a) * 9, 4, false);
        }
        ctx.audio.play('cast', { x: this.x, y: this.y, z: this.z, volume: 1 });
        this.attackAnim = 1;
      }
    }
    if (this.phase >= 3) {
      this.spikeTimer -= dt;
      if (this.spikeTimer <= 0) {
        this.spikeTimer = 4;
        this.spikes.push({ x: p.x, y: p.y, z: p.z, t: 1.1 });
        for (let i = 0; i < 2; i++) this.spikes.push({ x: p.x + (Math.random() - 0.5) * 8, y: p.y, z: p.z + (Math.random() - 0.5) * 8, t: 1.1 });
      }
    }
    for (const s of this.spikes) {
      s.t -= dt;
      if (s.t > 0) {
        if (Math.random() < 0.6) ctx.particles.burst('ice', s.x + (Math.random() - 0.5) * 2, s.y + 0.1, s.z + (Math.random() - 0.5) * 2, 1);
      } else {
        ctx.particles.burst('ice', s.x, s.y + 0.5, s.z, 18);
        ctx.audio.play('glass_break', { x: s.x, y: s.y, z: s.z });
        if (Math.hypot(p.x - s.x, p.z - s.z) < 1.8 && Math.abs(p.y - s.y) < 2) {
          p.damage(6, 'boss', 0, 0, this);
          p.slowTimer = 2.5;
        }
      }
    }
    this.spikes = this.spikes.filter((s) => s.t > 0);
  }
}
