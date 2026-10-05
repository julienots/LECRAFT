import { CHUNK_AREA, CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from '../core/Config';

/** Index linéaire d'un bloc local : x + z*16 + y*256 (tranches horizontales contiguës). */
export const idx = (x: number, y: number, z: number) => x + z * CHUNK_SIZE + y * CHUNK_AREA;

/** Données brutes d'un chunk, transférables entre threads (pas de dépendance Three.js). */
export interface ChunkData {
  cx: number;
  cz: number;
  blocks: Uint16Array; // ID de bloc (16 bits : blocs des add-ons)
  meta: Uint8Array; // niveau de liquide, stade de culture, orientation, table de butin...
  biomes: Uint8Array; // biome par colonne (x + z*16)
  heights: Uint8Array; // plus haut bloc non-air par colonne
}

export function createChunkData(cx: number, cz: number): ChunkData {
  return {
    cx,
    cz,
    blocks: new Uint16Array(CHUNK_VOLUME),
    meta: new Uint8Array(CHUNK_VOLUME),
    biomes: new Uint8Array(CHUNK_AREA),
    heights: new Uint8Array(CHUNK_AREA),
  };
}

export function computeHeights(c: ChunkData) {
  for (let z = 0; z < CHUNK_SIZE; z++)
    for (let x = 0; x < CHUNK_SIZE; x++) {
      let y = WORLD_HEIGHT - 1;
      while (y > 0 && c.blocks[idx(x, y, z)] === 0) y--;
      c.heights[x + z * CHUNK_SIZE] = y;
    }
}

/** Position de bloc spéciale (cage à monstres, autel, coffre de structure) à enregistrer côté jeu. */
export interface SpecialBlock {
  x: number;
  y: number;
  z: number;
  block: number;
  meta: number;
}
