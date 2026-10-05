import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { raycastBlocks } from '../util/Raycast';
import { Entity } from './Entity';

export type ProjectileKind = 'arrow' | 'ice' | 'crystal' | 'boulder' | 'player_arrow' | 'frost_bolt';

const GEOS = new Map<ProjectileKind, THREE.BufferGeometry>();
const MATS = new Map<ProjectileKind, THREE.Material>();
const LOOK: Record<ProjectileKind, { size: [number, number, number]; color: string; gravity: number }> = {
  arrow: { size: [0.06, 0.06, 0.6], color: '#8a6a3c', gravity: 12 },
  player_arrow: { size: [0.06, 0.06, 0.6], color: '#b08a50', gravity: 12 },
  ice: { size: [0.3, 0.3, 0.3], color: '#a8e0ff', gravity: 0 },
  frost_bolt: { size: [0.25, 0.25, 0.25], color: '#c8f0ff', gravity: 0 },
  crystal: { size: [0.25, 0.25, 0.25], color: '#62e8f0', gravity: 0 },
  boulder: { size: [0.7, 0.7, 0.7], color: '#6e6f74', gravity: 12 },
};

/** Projectile (flèches, éclats de glace, rochers...). Collision blocs + cibles AABB. */
export class Projectile extends Entity {
  readonly kind = 'projectile' as const;
  object3d: THREE.Mesh;
  life = 6;
  stuck = false;
  constructor(readonly type: ProjectileKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, readonly damage: number, readonly fromPlayer: boolean) {
    super(0.15, 0.3);
    this.body.setPos(x, y, z);
    this.body.vx = vx;
    this.body.vy = vy;
    this.body.vz = vz;
    const look = LOOK[type];
    let g = GEOS.get(type);
    if (!g) {
      g = new THREE.BoxGeometry(...look.size);
      GEOS.set(type, g);
    }
    let m = MATS.get(type);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: look.color });
      MATS.set(type, m);
    }
    this.object3d = new THREE.Mesh(g, m);
  }

  update(ctx: GameContext, dt: number) {
    this.age += dt;
    if (this.age > this.life) {
      this.removed = true;
      return;
    }
    if (this.stuck) return;
    const b = this.body;
    b.vy -= LOOK[this.type].gravity * dt;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const step = sp * dt;
    const hit = raycastBlocks(ctx.world, b.x, b.y, b.z, b.vx / sp, b.vy / sp, b.vz / sp, step);
    if (hit) {
      b.x += (b.vx / sp) * hit.distance;
      b.y += (b.vy / sp) * hit.distance;
      b.z += (b.vz / sp) * hit.distance;
      this.impact(ctx);
      return;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
  }

  impact(ctx: GameContext) {
    if (this.type === 'arrow' || this.type === 'player_arrow') {
      this.stuck = true;
      this.life = Math.min(this.life, this.age + 4);
    } else {
      this.removed = true;
      ctx.particles.burst(this.type === 'boulder' ? 'dust' : this.type === 'crystal' ? 'crystal' : 'ice', this.x, this.y, this.z, 8);
      ctx.audio.play(this.type === 'boulder' ? 'stone_hit' : 'glass_hit', { x: this.x, y: this.y, z: this.z, volume: 0.7 });
    }
  }

  syncObject() {
    const b = this.body;
    this.object3d.position.set(b.x, b.y, b.z);
    if (!this.stuck) this.object3d.lookAt(b.x + b.vx, b.y + b.vy, b.z + b.vz);
  }

  dispose() {
    /* géométries/matériaux partagés */
  }
}

export function disposeProjectileCache() {
  GEOS.forEach((g) => g.dispose());
  MATS.forEach((m) => m.dispose());
  GEOS.clear();
  MATS.clear();
}
