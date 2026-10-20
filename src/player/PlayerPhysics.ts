import { PhysicsBody } from '../entities/Physics';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_SNEAK_HEIGHT = 1.5;
export const EYE_HEIGHT = 1.62;
/** Hauteur des yeux accroupi (1,27 dans le jeu de référence). */
export const SNEAK_EYE_HEIGHT = 1.27;

/**
 * Constantes de mouvement du joueur, reprises de LivingEntity/Player (Java 1.21).
 * Unités : blocs par tick (20 ticks/s) ; le contrôleur convertit en blocs/s (×20).
 */
export const MOVE = {
  TICK: 0.05,
  GRAVITY: 0.08,
  /** Gravité réduite par Chute lente quand le joueur descend. */
  SLOW_FALL_GRAVITY: 0.01,
  /** Frottement de l'air (vertical) et horizontal hors du sol. */
  AIR_DRAG_Y: 0.98,
  AIR_DRAG_XZ: 0.91,
  JUMP_POWER: 0.42,
  /** Saut amélioré : +0,1 bloc/tick par niveau. */
  JUMP_BOOST: 0.1,
  /** Élan du saut en sprint, dans la direction du regard. */
  SPRINT_JUMP_BOOST: 0.2,
  /** Attribut de vitesse de déplacement (marche) et multiplicateur de sprint. */
  WALK_SPEED: 0.1,
  SPRINT_MUL: 1.3,
  /** Contrôle en l'air (vitesse « de vol » du joueur hors créatif). */
  AIR_SPEED: 0.02,
  AIR_SPRINT_SPEED: 0.026,
  /** Vol créatif (×2 en sprint), poussée verticale = 3 × vitesse de vol, amortie ×0,6 par tick. */
  FLY_SPEED: 0.05,
  FLY_VERTICAL_DRAG: 0.6,
  /** Glissance par défaut des blocs (0,6 ; glace 0,98 ; glace bleue 0,989 ; slime 0,8). */
  BLOCK_FRICTION: 0.6,
  /** Les entrées sont multipliées par 0,98 (LivingEntity.aiStep). */
  INPUT_SCALE: 0.98,
  /** Accroupi / ramper : 30 % de la vitesse (attribut sneaking_speed), objet utilisé : 20 %. */
  SNEAK_MUL: 0.3,
  USE_ITEM_MUL: 0.2,
  /** Échelles : vitesse horizontale et chute bornées à 0,15, montée à 0,2 (→ 2,35 blocs/s). */
  LADDER_CLAMP: 0.15,
  LADDER_UP: 0.2,
  /** Délai entre deux sauts quand saut reste enfoncé (ticks). */
  JUMP_DELAY: 10,
} as const;

/** Corps physique du joueur. */
export class PlayerPhysics extends PhysicsBody {
  flying = false;
  constructor() {
    super(PLAYER_WIDTH / 2, PLAYER_HEIGHT);
  }
}
