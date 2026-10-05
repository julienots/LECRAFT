import type * as THREE from 'three';
import { CHUNK_SIZE } from '../core/Config';
import type { ChunkData } from './ChunkData';

/** Chunk côté thread principal : données de blocs + meshes + état. */
export class Chunk implements ChunkData {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  meta: Uint8Array;
  biomes: Uint8Array;
  heights: Uint8Array;
  /** Lumière (ciel<<4 | bloc) issue du dernier meshing ; null avant le premier meshing. */
  light: Uint8Array | null = null;
  opaqueMesh: THREE.Mesh | null = null;
  transMesh: THREE.Mesh | null = null;
  /** Le mesh doit être (re)calculé. */
  dirty = true;
  /** Remesh prioritaire (modification par le joueur). */
  urgent = false;
  meshJob = 0;
  appliedJob = -1;
  meshInFlight = false;
  /** Données différentes de la génération : doivent être sauvegardées. */
  modified = false;
  /** Modifié depuis la dernière sauvegarde. */
  unsaved = false;
  /** Incrémenté à chaque modification (sauvegarde concurrente). */
  version = 0;
  /** Positions des entités « spéciales » enregistrées (cages, autels). */
  specialKeys: string[] = [];
  /** Temps écoulé depuis l'apparition du mesh (fondu). */
  readonly key: string;

  constructor(d: ChunkData, key: string) {
    this.cx = d.cx;
    this.cz = d.cz;
    this.blocks = d.blocks;
    this.meta = d.meta;
    this.biomes = d.biomes;
    this.heights = d.heights;
    this.key = key;
  }

  get worldX() {
    return this.cx * CHUNK_SIZE;
  }
  get worldZ() {
    return this.cz * CHUNK_SIZE;
  }
}
