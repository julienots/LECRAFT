import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { Entity } from './Entity';

/** Objet tombé au sol : flotte, tourne, est attiré puis ramassé par le joueur. */
export class ItemEntity extends Entity {
  readonly kind = 'item' as const;
  object3d: THREE.Sprite;
  pickupDelay = 0.6;
  constructor(public itemId: string, public count: number, x: number, y: number, z: number, material: THREE.SpriteMaterial, public durability?: number) {
    super(0.125, 0.25);
    this.body.setPos(x, y, z);
    this.body.vx = (Math.random() - 0.5) * 3;
    this.body.vz = (Math.random() - 0.5) * 3;
    this.body.vy = 4;
    this.object3d = new THREE.Sprite(material);
    this.object3d.scale.setScalar(0.42);
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
    this.object3d.position.set(b.x, b.y + 0.25 + Math.sin(t * 3 + this.id) * 0.06, b.z);
  }

  dispose() {
    /* le matériau est partagé (cache par objet) */
  }
}
