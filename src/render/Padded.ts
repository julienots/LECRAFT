import { CHUNK_SIZE, LIGHT_PADDING, WORLD_HEIGHT } from '../core/Config';
import { idx, type ChunkData } from '../world/ChunkData';
import { PADDED_AREA, PADDED_W } from './ChunkMesher';

/**
 * Remplit un volume padded (chunk central + LIGHT_PADDING blocs des 8 voisins).
 * Retourne la hauteur max du chunk central.
 */
export function buildPadded(get: (cx: number, cz: number) => ChunkData | undefined, cx: number, cz: number, padded: Uint16Array): number {
  const P = LIGHT_PADDING;
  padded.fill(0);
  let maxY = 0;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const c = get(cx + dx, cz + dz);
      if (!c) continue;
      const x0 = dx < 0 ? CHUNK_SIZE - P : 0, x1 = dx > 0 ? P : CHUNK_SIZE;
      const z0 = dz < 0 ? CHUNK_SIZE - P : 0, z1 = dz > 0 ? P : CHUNK_SIZE;
      const pxOff = dx * CHUNK_SIZE + P, pzOff = dz * CHUNK_SIZE + P;
      let cmax = 0;
      for (let i = 0; i < 256; i++) if (c.heights[i] > cmax) cmax = c.heights[i];
      if (dx === 0 && dz === 0) maxY = cmax;
      const top = Math.min(WORLD_HEIGHT - 1, cmax + 1);
      for (let y = 0; y <= top; y++)
        for (let z = z0; z < z1; z++) {
          const src = idx(x0, y, z);
          const dst = x0 + pxOff + (z + pzOff) * PADDED_W + y * PADDED_AREA;
          padded.set(c.blocks.subarray(src, src + (x1 - x0)), dst);
        }
    }
  return maxY;
}
