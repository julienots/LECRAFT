/**
 * Points d'accroche entre le moteur et l'environnement de script des add-ons.
 * Le moteur appelle ces fonctions (si définies) ; l'hôte de scripts actif les renseigne.
 * Sans add-on à script, tous les crochets restent indéfinis et n'ont aucun coût.
 */
import type { Entity } from '../entities/Entity';
import type { Player } from '../player/Player';
import type { ItemStack } from '../inventory/Item';

/** Entité ou joueur. */
export type Actor = Entity | Player;

export interface DamageEvent {
  cause: string;
  attacker: Actor | null;
  projectile: Entity | null;
}

export interface ScriptHooks {
  /** Avant des dégâts : retourne le montant (éventuellement modifié) ; ≤ 0 annule. */
  beforeHurt?(target: Actor, amount: number, ev: DamageEvent): number;
  afterHurt?(target: Actor, amount: number, ev: DamageEvent): void;
  died?(target: Actor, ev: DamageEvent): void;
  spawned?(e: Entity, cause: 'Spawned' | 'Born' | 'Loaded' | 'Event'): void;
  /** Le joueur frappe une créature (mêlée). */
  hitEntity?(target: Entity, stack: ItemStack | null): void;
  hitBlock?(x: number, y: number, z: number, face: number): void;
  /** Clic d'utilisation sur un bloc : vrai = interaction consommée (rien d'autre ne se produit). */
  interactBlock?(x: number, y: number, z: number, face: number, hit: [number, number, number], stack: ItemStack | null): boolean;
  /** Clic d'utilisation sur une créature : vrai = consommé. */
  interactEntity?(target: Entity, stack: ItemStack | null): boolean;
  /** Utilisation d'un objet dans le vide : vrai = annulé / consommé. */
  useItem?(stack: ItemStack): boolean;
  /** Avant de casser un bloc : vrai = annulé. */
  beforeBreak?(x: number, y: number, z: number, id: number, meta: number, stack: ItemStack | null): boolean;
  afterBreak?(x: number, y: number, z: number, id: number, meta: number, stack: ItemStack | null): void;
  /** Avant de poser un bloc : null = annulé, sinon méta (éventuellement modifiée). */
  beforePlace?(x: number, y: number, z: number, id: number, meta: number, face: number): number | null;
  afterPlace?(x: number, y: number, z: number, id: number, prevId: number): void;
  startUse?(stack: ItemStack): void;
  /** Fin d'utilisation (arc relâché, etc.). */
  releaseUse?(stack: ItemStack, ticks: number): void;
  /** Objet consommé (nourriture, potion). */
  consumed?(stack: ItemStack): void;
  /** Message de chat : vrai = annulé. */
  chat?(message: string): boolean;
  scriptEvent?(id: string, message: string, source: Actor | null): void;
  randomTick?(x: number, y: number, z: number, id: number): void;
  /** Créature retirée du monde (mort, disparition…). */
  removed?(e: Entity): void;
  /** Commande personnalisée d'un script : vrai si elle existe (et a été exécutée). */
  customCommand?(name: string, args: string[]): boolean;
}

export const hooks: ScriptHooks = {};

/** Conversion des causes internes vers les causes de dégâts du jeu de référence. */
export function damageCause(source: string): string {
  switch (source) {
    case 'mob':
    case 'boss':
    case 'player':
      return 'entityAttack';
    case 'fall':
      return 'fall';
    case 'lava':
      return 'lava';
    case 'drown':
      return 'drowning';
    case 'starve':
      return 'starve';
    case 'contact':
      return 'contact';
    case 'void':
      return 'void';
    case 'projectile':
      return 'projectile';
    case 'fire':
      return 'fire';
    case 'explosion':
      return 'blockExplosion';
    case 'magic':
      return 'magic';
    case 'wither':
      return 'wither';
    default:
      return source || 'none';
  }
}
