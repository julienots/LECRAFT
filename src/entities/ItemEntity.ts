import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { Entity } from './Entity';

/** Objet tombé au sol : flotte, tourne, est attiré puis ramassé par le joueur. */
export class ItemEntity extends Entity {
  readonly kind = 'item' as const;
  object3d: THREE.Mesh;
  pickupDelay = 0.6;
  /** Décalage de rotation et de flottement propre à chaque objet (comme bobOffs en Java). */
  private bobOffs = Math.random() * Math.PI * 2;
  constructor(public itemId: string, public count: number, x: number, y: number, z: number, mesh: THREE.Mesh, public durability?: number) {
    super(0.125, 0.25);
    this.body.setPos(x, y, z);
    this.body.vx = (Math.random() - 0.5) * 3;
    this.body.vz = (Math.random() - 0.5) * 3;
    this.body.vy = 4;
    this.object3d = mesh;
  }

  update(ctx: GameContext, dt: number) {
    this.age += dt;
    this.pickupDelay -= dt;
    if (this.age > 300) {
      this.removed = true;
      return;
    }
    const b = this.body;
    const p = ctx.player;
    const dx = p.x - b.x, dy = p.y + 0.8 - b.y, dz = p.z - b.z;
    const d = Math.hypot(dx, dy, dz);
    if (this.pickupDelay <= 0 && d < 3 && !p.dead) {
      // aimantation
      b.vx += (dx / d) * 30 * dt;
      b.vy += (dy / d) * 30 * dt;
      b.vz += (dz / d) * 30 * dt;
    }
    if (b.onGround) {
      b.vx *= 0.8;
      b.vz *= 0.8;
    }
    b.step(ctx.world, dt);
  }

  syncObject(t: number) {
    const b = this.body;
    // flotte (sin(âge/10 ticks) × 0,1 + 0,1) et tourne d'un radian par seconde, comme l'édition Java
    const half = (this.object3d.userData.half as number | undefined) ?? 0.2;
    this.object3d.position.set(b.x, b.y + half + 0.1 + Math.sin(t * 2 + this.bobOffs) * 0.1, b.z);
    this.object3d.rotation.y = t + this.bobOffs;
  }

  dispose() {
    /* le matériau est partagé (cache par objet) */
  }
}
