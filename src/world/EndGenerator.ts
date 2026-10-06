import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/Config';
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { hash2, Rng } from '../util/math';
import { SimplexNoise } from './Noise';
import { BiomeManager } from './BiomeManager';
import { computeHeights, createChunkData, idx, type ChunkData, type SpecialBlock } from './ChunkData';
import { scanSpecials } from './WorldGenerator';

/** Altitude du dessus de l'île principale (le jeu de référence : ~ y 60 sur 256 → ici 64 sur 128). */
export const END_ISLAND_Y = 64;
/** Point d'arrivée (plateforme d'obsidienne), comme (100, 49, 0) dans le jeu de référence. */
export const END_SPAWN = { x: 60, y: 50, z: 0 };
/** Rayon du cercle des piliers d'obsidienne (43 dans le jeu de référence). */
const PILLAR_RING = 43;

export interface EndPillar {
  x: number;
  z: number;
  radius: number;
  /** Altitude du sommet (bedrock où repose le cristal). */
  top: number;
  caged: boolean;
}

/** Piliers d'obsidienne (positions fixes, hauteurs et rayons dérivés de la graine). */
export function endPillars(seed: number): EndPillar[] {
  const r = new Rng(hash2(seed + 909, 1, 2));
  const order = Array.from({ length: 10 }, (_, i) => i).sort(() => r.next() - 0.5);
  return order.map((k, i) => {
    const a = 2 * (-Math.PI + (Math.PI / 10) * i);
    const radius = 2 + Math.floor(k / 3);
    return { x: Math.floor(PILLAR_RING * Math.cos(a)), z: Math.floor(PILLAR_RING * Math.sin(a)), radius, top: END_ISLAND_Y + 12 + k * 3, caged: k === 1 || k === 2 };
  });
}

/**
 * Générateur de l'End : île principale de pierre de l'End flottant au-dessus du vide (forme
 * bombée par-dessous), dix piliers d'obsidienne (deux entourés de barreaux de fer) et la fontaine
 * de bedrock du portail de sortie au centre ; petites îles extérieures au-delà de 400 blocs.
 */
export class EndGenerator {
  readonly seed: number;
  private shape: SimplexNoise;
  private outer: SimplexNoise;
  readonly pillars: EndPillar[];
  readonly structures = { locate: () => null as { x: number; z: number } | null };
  private endStone: number;
  private ironBars: number;

  constructor(seed: number) {
    this.seed = seed | 0;
    this.shape = new SimplexNoise(seed + 201);
    this.outer = new SimplexNoise(seed + 202);
    this.pillars = endPillars(seed);
    this.endStone = BlockRegistry.has('end_stone') ? BlockRegistry.byName('end_stone').id : B.SANDSTONE;
    this.ironBars = BlockRegistry.has('iron_bars') ? BlockRegistry.byName('iron_bars').id : B.AIR;
  }

  biomeAt(_x: number, _z: number) {
    return BiomeManager.byName('the_end').id;
  }

  /** Épaisseur de l'île à (x, z) : [dessus, dessous] ou null. */
  private island(x: number, z: number): [number, number] | null {
    const r = Math.hypot(x, z);
    const n = this.shape.fbm2(x / 60, z / 60, 3);
    // île principale
    const R = 92 + n * 18;
    if (r < R) {
      const k = 1 - r / R;
      const top = END_ISLAND_Y + Math.round(n * 2.5 + this.shape.noise2(x / 14, z / 14) * 1.2);
      const depth = Math.round(4 + Math.sqrt(k) * 42 + n * 4);
      return [top, Math.max(4, top - depth)];
    }
    // îles extérieures (vide entre 120 et 400 blocs, comme le grand vide du jeu de référence)
    if (r > 400) {
      const v = this.outer.fbm2(x / 90, z / 90, 3);
      if (v > 0.32) {
        const k = Math.min(1, (v - 0.32) / 0.25);
        const top = END_ISLAND_Y - 6 + Math.round(this.outer.noise2(x / 30, z / 30) * 6);
        return [top, top - Math.round(3 + k * 22)];
      }
    }
    return null;
  }

  generateChunk(cx: number, cz: number): { data: ChunkData; specials: SpecialBlock[] } {
    const c = createChunkData(cx, cz);
    const blocks = c.blocks;
    const bx = cx * CHUNK_SIZE, bz = cz * CHUNK_SIZE;
    const biome = this.biomeAt(0, 0);
    for (let lz = 0; lz < CHUNK_SIZE; lz++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        c.biomes[lx + lz * CHUNK_SIZE] = biome;
        const t = this.island(bx + lx, bz + lz);
        if (!t) continue;
        for (let y = Math.max(1, t[1]); y <= Math.min(WORLD_HEIGHT - 2, t[0]); y++) blocks[idx(lx, y, lz)] = this.endStone;
      }
    // piliers d'obsidienne
    for (const p of this.pillars) {
      if (p.x + p.radius + 2 < bx || p.x - p.radius - 2 >= bx + CHUNK_SIZE || p.z + p.radius + 2 < bz || p.z - p.radius - 2 >= bz + CHUNK_SIZE) continue;
      for (let lz = 0; lz < CHUNK_SIZE; lz++)
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const dx = bx + lx - p.x, dz = bz + lz - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= p.radius * p.radius + 1) {
            for (let y = END_ISLAND_Y - 10; y < p.top; y++) blocks[idx(lx, y, lz)] = B.OBSIDIAN;
            if (dx === 0 && dz === 0) blocks[idx(lx, p.top, lz)] = B.BEDROCK;
          }
          // cage de barreaux de fer (5×5 autour du cristal)
          if (p.caged && Math.abs(dx) <= 2 && Math.abs(dz) <= 2) {
            const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
            for (let y = p.top; y <= p.top + 3; y++) if ((edge || y === p.top + 3) && !(dx === 0 && dz === 0 && y === p.top)) blocks[idx(lx, y, lz)] = this.ironBars;
          }
        }
    }
    // fontaine du portail de sortie (inactive tant que le dragon est vivant)
    if (bx <= 4 && bx + CHUNK_SIZE > -4 && bz <= 4 && bz + CHUNK_SIZE > -4) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++)
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const x = bx + lx, z = bz + lz;
          const d = Math.hypot(x, z);
          if (d > 3.6) continue;
          const y0 = END_ISLAND_Y;
          for (let y = y0 - 2; y <= y0 + 6; y++) blocks[idx(lx, y, lz)] = B.AIR;
          blocks[idx(lx, y0 - 1, lz)] = B.BEDROCK;
          if (d > 2.6) blocks[idx(lx, y0, lz)] = B.BEDROCK;
          if (x === 0 && z === 0) for (let y = y0; y <= y0 + 3; y++) blocks[idx(lx, y, lz)] = B.BEDROCK;
        }
    }
    computeHeights(c);
    return { data: c, specials: scanSpecials(c) };
  }
}
