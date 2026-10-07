/**
 * Constantes du moteur et profils de qualité.
 * Les dimensions de chunk sont fixes à l'exécution (le format de sauvegarde en dépend),
 * les autres valeurs sont pilotées par les paramètres/profils.
 */
export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * WORLD_HEIGHT;
export const SEA_LEVEL = 52;
/** Marge (en blocs) autour d'un chunk utilisée pour calculer la lumière lors du meshing. */
export const LIGHT_PADDING = 14;

export const TICKS_PER_SECOND = 20;
export const TICK_DT = 1 / TICKS_PER_SECOND;
/** Durée d'un cycle jour/nuit complet en secondes réelles. */
export const DAY_LENGTH_SECONDS = 14 * 60;

export const SAVE_VERSION = 2;

export type QualityLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface QualityProfile {
  renderDistance: number; // en chunks
  simulationDistance: number; // en chunks
  pixelRatio: number; // multiplicateur de devicePixelRatio (plafonné)
  maxParticles: number;
  maxEntities: number;
  entityDistance: number; // en blocs
  shadows: 'off' | 'blob' | 'blob+ao';
  waterQuality: 'simple' | 'animated';
  clouds: boolean;
  chunkBudgetPerFrame: number; // nombre de meshes uploadés par frame
  workerJobsInFlight: number;
  foliageAnimation: boolean;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  LOW: {
    renderDistance: 4,
    simulationDistance: 2,
    pixelRatio: 0.6,
    maxParticles: 150,
    maxEntities: 14,
    entityDistance: 32,
    shadows: 'off',
    waterQuality: 'simple',
    clouds: false,
    chunkBudgetPerFrame: 1,
    workerJobsInFlight: 2,
    foliageAnimation: false,
  },
  MEDIUM: {
    renderDistance: 6,
    simulationDistance: 3,
    pixelRatio: 0.8,
    maxParticles: 400,
    maxEntities: 24,
    entityDistance: 48,
    shadows: 'blob',
    waterQuality: 'animated',
    clouds: true,
    chunkBudgetPerFrame: 2,
    workerJobsInFlight: 3,
    foliageAnimation: true,
  },
  HIGH: {
    renderDistance: 10,
    simulationDistance: 4,
    pixelRatio: 1,
    maxParticles: 900,
    maxEntities: 36,
    entityDistance: 64,
    shadows: 'blob+ao',
    waterQuality: 'animated',
    clouds: true,
    chunkBudgetPerFrame: 3,
    workerJobsInFlight: 4,
    foliageAnimation: true,
  },
};

export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
export type GameMode = 'survival' | 'creative';

export const DIFFICULTY_DAMAGE: Record<Difficulty, number> = {
  peaceful: 0,
  easy: 0.6,
  normal: 1,
  hard: 1.5,
};
