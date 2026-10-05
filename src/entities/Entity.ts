import type * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { PhysicsBody } from './Physics';

let NEXT_ID = 1;

/** Entité de base : corps physique + objet 3D. */
export abstract class Entity {
  readonly id = NEXT_ID++;
  abstract readonly kind: 'mob' | 'item' | 'projectile';
  readonly body: PhysicsBody;
  yaw = 0;
  removed = false;
  age = 0;
  /** Distance au joueur (mise à jour par l'EntityManager). */
  distToPlayer = 0;
  abstract object3d: THREE.Object3D;

  constructor(halfWidth: number, height: number) {
    this.body = new PhysicsBody(halfWidth, height);
  }
  get x() {
    return this.body.x;
  }
  get y() {
    return this.body.y;
  }
  get z() {
    return this.body.z;
  }
  abstract update(ctx: GameContext, dt: number): void;
  /** Appelé lors du retrait (libération/recyclage des ressources). */
  abstract dispose(): void;

  /** AABB monde. */
  aabb(): [number, number, number, number, number, number] {
    const b = this.body;
    return [b.x - b.halfWidth, b.y, b.z - b.halfWidth, b.x + b.halfWidth, b.y + b.height, b.z + b.halfWidth];
  }
}
