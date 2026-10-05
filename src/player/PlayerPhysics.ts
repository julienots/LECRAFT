import { PhysicsBody } from '../entities/Physics';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_SNEAK_HEIGHT = 1.5;
export const EYE_HEIGHT = 1.62;
export const SNEAK_EYE_HEIGHT = 1.32;

/** Corps physique du joueur. */
export class PlayerPhysics extends PhysicsBody {
  flying = false;
  constructor() {
    super(PLAYER_WIDTH / 2, PLAYER_HEIGHT);
  }
}
