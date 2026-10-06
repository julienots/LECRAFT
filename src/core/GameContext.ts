import type * as THREE from 'three';
import type { World } from '../world/World';
import type { Player } from '../player/Player';
import type { Settings } from './Settings';
import type { DayCycle } from '../world/DayCycle';
import type { QualityProfile } from './Config';
import type { SkinProvider } from '../render/MobModels';
import type { Mob } from '../entities/Mob';
import type { GameRules } from '../commands/Commands';

export interface DamageInfo {
  kind: 'player' | 'projectile' | 'environment';
  /** Objet utilisé (épée, pioche...). */
  itemId?: string;
  fire?: boolean;
  knockX?: number;
  knockZ?: number;
  fromPlayer?: boolean;
  crit?: boolean;
  /** Cause (vocabulaire du jeu de référence) et auteurs, pour l'API de script. */
  cause?: string;
  attacker?: import('../scripting/Hooks').Actor | null;
  projectile?: import('../entities/Entity').Entity | null;
}
export interface CombatApi {
  damageMob(m: Mob, amount: number, src: DamageInfo): number;
}

/** Effets visuels (implémentés par ParticleSystem). */
export interface ParticleFx {
  blockBreak(x: number, y: number, z: number, block: number): void;
  blockHit(x: number, y: number, z: number, block: number, nx: number, ny: number, nz: number): void;
  burst(kind: 'smoke' | 'fire' | 'lava' | 'water' | 'damage' | 'explosion' | 'magic' | 'hearts' | 'dust' | 'ice' | 'crystal', x: number, y: number, z: number, count?: number): void;
}
/** Sons (implémentés par AudioManager). */
export interface SoundFx {
  play(name: string, opts?: { x?: number; y?: number; z?: number; volume?: number; pitch?: number }): void;
  blockSound(kind: 'break' | 'place' | 'step' | 'hit', material: string, x?: number, y?: number, z?: number): void;
}
export interface HudApi {
  toast(text: string, kind?: 'info' | 'achievement' | 'warn'): void;
  setBoss(name: string | null, frac?: number, phase?: number): void;
  showTitle?(text: string, kind: 'title' | 'subtitle' | 'actionbar'): void;
}
export interface StatsApi {
  inc(stat: string, n?: number): void;
}

export interface GameContext {
  world: World;
  player: Player;
  settings: Settings;
  profile: QualityProfile;
  dayCycle: DayCycle;
  scene: THREE.Scene;
  particles: ParticleFx;
  audio: SoundFx;
  hud: HudApi;
  stats: StatsApi;
  combat: CombatApi;
  /** Vrai si un boss a déjà été vaincu (clé position autel). */
  defeatedBosses: Set<string>;
  shadowTexture: THREE.Texture | null;
  /** Textures des skins de créatures (générées ou pack de ressources). */
  skins: SkinProvider;
  /** Règles du jeu (/gamerule). */
  gamerules: GameRules;
  /** Dimension de la partie en cours. */
  dimension: 'overworld' | 'nether' | 'end';
  iconTexture(itemId: string): THREE.Texture;
  /** Pluie active (pour l'IA/brûlure solaire). */
  raining(): boolean;
  /** Vibration courte (Android). */
  haptic(kind: 'light' | 'medium' | 'heavy'): void;
  /** Secousse de caméra (0..1). */
  shake(amount: number): void;
}
