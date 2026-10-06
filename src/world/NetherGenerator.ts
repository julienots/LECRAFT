import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/Config';
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { hash2, hash3, Rng } from '../util/math';
import { SimplexNoise } from './Noise';
import { BiomeManager } from './BiomeManager';
import { computeHeights, createChunkData, idx, type ChunkData, type SpecialBlock } from './ChunkData';
import { scanSpecials } from './WorldGenerator';
import { chestMeta, LOOT } from './StructureGenerator';
import { MOB_DEFS } from '../data/mobs';

/** Niveau de l'océan de lave du Nether (comme le jeu de référence : y = 31). */
export const NETHER_LAVA_LEVEL = 31;
/** Hauteur des ponts des forteresses. */
const FORTRESS_Y = 66;
/** Taille des régions de forteresse (une forteresse au plus par région). */
const FORTRESS_REGION = 288;

const id = (k: string, fallback: number = B.STONE) => (BlockRegistry.has(k) ? BlockRegistry.byName(k).id : fallback);

/**
 * Générateur du Nether : volume de netherrack creusé par un bruit 3D (grandes cavernes),
 * plafond et plancher de bedrock, océan de lave à y = 31, cinq biomes (désolation, forêts carmin
 * et biscornue, vallée des âmes, deltas de basalte), minerais (quartz, or, débris antiques),
 * grappes de pierre lumineuse au plafond et forteresses de briques du Nether (générateurs de blazes).
 */
export class NetherGenerator {
  readonly seed: number;
  private density: SimplexNoise;
  private detail: SimplexNoise;
  private biomeA: SimplexNoise;
  private biomeB: SimplexNoise;
  private patch: SimplexNoise;
  /** Interface commune avec le générateur de la surface (commande /locate). */
  readonly structures = { locate: (key: string, x: number, z: number) => (key.includes('fortress') ? this.locateFortress(x, z) : null) };
  private ids: Record<string, number>;

  constructor(seed: number) {
    this.seed = seed | 0;
    this.density = new SimplexNoise(seed + 101);
    this.detail = new SimplexNoise(seed + 102);
    this.biomeA = new SimplexNoise(seed + 103);
    this.biomeB = new SimplexNoise(seed + 104);
    this.patch = new SimplexNoise(seed + 105);
    this.ids = Object.fromEntries(
      ['netherrack', 'soul_sand', 'soul_soil', 'glowstone', 'nether_quartz_ore', 'nether_gold_ore', 'ancient_debris', 'magma', 'basalt', 'blackstone',
        'crimson_nylium', 'warped_nylium', 'crimson_stem', 'warped_stem', 'nether_wart_block', 'warped_wart_block', 'shroomlight', 'crimson_fungus', 'warped_fungus',
        'crimson_roots', 'warped_roots', 'nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'fire', 'soul_fire'].map((k) => [k, id(k, k === 'netherrack' ? B.STONE : 0)]),
    );
  }

  biomeAt(x: number, z: number): number {
    const a = this.biomeA.fbm2(x / 260, z / 260, 3), b = this.biomeB.fbm2(x / 260, z / 260, 3);
    let k = 'nether_wastes';
    if (a > 0.32) k = b > 0 ? 'crimson_forest' : 'warped_forest';
    else if (a < -0.32) k = b > 0 ? 'soul_sand_valley' : 'basalt_deltas';
    return BiomeManager.byName(k).id;
  }

  private solidAt(x: number, y: number, z: number): boolean {
    if (y <= 0 || y >= WORLD_HEIGHT - 1) return true;
    let d = this.density.noise3(x / 64, y / 28, z / 64) * 0.9 + this.detail.noise3(x / 18, y / 12, z / 18) * 0.35;
    // plancher et plafond épais, grandes cavernes au milieu
    if (y < 24) d += (24 - y) / 10;
    if (y > 96) d += (y - 96) / 7;
    d -= 0.12;
    return d > 0;
  }

  generateChunk(cx: number, cz: number): { data: ChunkData; specials: SpecialBlock[] } {
    const c = createChunkData(cx, cz);
    const blocks = c.blocks, meta = c.meta;
    const I = this.ids;
    const bx = cx * CHUNK_SIZE, bz = cz * CHUNK_SIZE;
    const LAVA = B.LAVA;
    for (let lz = 0; lz < CHUNK_SIZE; lz++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = bx + lx, z = bz + lz;
        const biome = this.biomeAt(x, z);
        c.biomes[lx + lz * CHUNK_SIZE] = biome;
        const bk = BiomeManager.get(biome).key;
        const surface = I[BiomeManager.get(biome).surfaceBlock] || I.netherrack;
        const under = I[BiomeManager.get(biome).undergroundBlock] || I.netherrack;
        const pv = this.patch.noise2(x / 14, z / 14);
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const i = idx(lx, y, lz);
          // bedrock irrégulière en haut et en bas
          if (y === 0 || y === WORLD_HEIGHT - 1 || (y < 5 && (hash3(this.seed, x, y, z) & 7) < 5 - y) || (y > WORLD_HEIGHT - 6 && (hash3(this.seed, x, y, z) & 7) < y - (WORLD_HEIGHT - 6))) {
            blocks[i] = B.BEDROCK;
            continue;
          }
          if (this.solidAt(x, y, z)) {
            let b = I.netherrack;
            if (bk === 'basalt_deltas') b = (hash3(this.seed, x, y >> 2, z) & 3) === 0 ? I.blackstone : I.basalt;
            else if (bk === 'soul_sand_valley' && y < 80) b = pv > 0.1 ? I.soul_soil : I.netherrack;
            blocks[i] = b;
          } else if (y <= NETHER_LAVA_LEVEL) {
            blocks[i] = LAVA;
            meta[i] = 0;
          }
        }
        // surface (blocs solides avec de l'air au-dessus) et sous-couche
        for (let y = WORLD_HEIGHT - 6; y > 1; y--) {
          const i = idx(lx, y, lz);
          if (blocks[i] === B.AIR || blocks[i] === LAVA || blocks[i] === B.BEDROCK) continue;
          if (blocks[idx(lx, y + 1, lz)] !== B.AIR) continue;
          if (bk === 'nether_wastes') {
            // sable des âmes et gravier près de l'océan de lave
            if (y <= NETHER_LAVA_LEVEL + 4 && pv > 0.35) blocks[i] = I.soul_sand;
            else if (y <= NETHER_LAVA_LEVEL + 2 && pv < -0.45) blocks[i] = B.GRAVEL;
          } else if (bk === 'crimson_forest' || bk === 'warped_forest') {
            blocks[i] = surface;
          } else if (bk === 'soul_sand_valley') {
            blocks[i] = pv > -0.2 ? I.soul_sand : I.soul_soil;
            for (let d = 1; d <= 2 && y - d > 0; d++) if (blocks[idx(lx, y - d, lz)] === I.netherrack) blocks[idx(lx, y - d, lz)] = under;
          } else if (bk === 'basalt_deltas') {
            if (pv > 0.5) blocks[i] = I.magma;
          }
        }
      }
    this.decorate(c);
    this.ores(c);
    this.fortress(c);
    computeHeights(c);
    return { data: c, specials: scanSpecials(c) };
  }

  /** Végétation, arbres-champignons, pierre lumineuse, piliers de basalte, feux. */
  private decorate(c: ChunkData) {
    const I = this.ids;
    const blocks = c.blocks;
    const rng = new Rng(hash2(this.seed + 7, c.cx, c.cz));
    const bx = c.cx * CHUNK_SIZE, bz = c.cz * CHUNK_SIZE;
    const get = (x: number, y: number, z: number) => (x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 0 && y < WORLD_HEIGHT ? blocks[idx(x, y, z)] : -1);
    const set = (x: number, y: number, z: number, b: number) => {
      if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WORLD_HEIGHT - 1) blocks[idx(x, y, z)] = b;
    };
    // grappes de pierre lumineuse sous les plafonds
    for (let t = 0; t < 6; t++) {
      const x = rng.int(2, 13), z = rng.int(2, 13);
      for (let y = 118; y > 40; y--) {
        if (get(x, y, z) === B.AIR && get(x, y + 1, z) === I.netherrack) {
          if (rng.chance(0.55)) break;
          set(x, y, z, I.glowstone);
          for (let k = 0; k < 40; k++) {
            const dx = rng.int(-2, 2), dy = -rng.int(0, 4), dz = rng.int(-2, 2);
            const tx = x + dx, ty = y + dy, tz = z + dz;
            if (get(tx, ty, tz) !== B.AIR) continue;
            const near = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].filter(([a, b2, d]) => get(tx + a, ty + b2, tz + d) === I.glowstone).length;
            if (near === 1) set(tx, ty, tz, I.glowstone);
          }
          break;
        }
      }
    }
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const bk = BiomeManager.get(c.biomes[lx + lz * 16]).key;
        for (let y = WORLD_HEIGHT - 8; y > NETHER_LAVA_LEVEL; y--) {
          const g = get(lx, y, lz);
          if (g === B.AIR || g === B.LAVA || get(lx, y + 1, lz) !== B.AIR) continue;
          const r = hash3(this.seed + 11, bx + lx, y, bz + lz) / 4294967296;
          if (bk === 'crimson_forest' || bk === 'warped_forest') {
            const crimson = bk === 'crimson_forest';
            if (g !== (crimson ? I.crimson_nylium : I.warped_nylium)) continue;
            if (r < 0.012 && lx > 1 && lx < 14 && lz > 1 && lz < 14) this.hugeFungus(set, get, lx, y + 1, lz, crimson, rng);
            else if (r < 0.09) set(lx, y + 1, lz, crimson ? I.crimson_roots : I.warped_roots);
            else if (r < 0.11) set(lx, y + 1, lz, crimson ? I.crimson_fungus : I.warped_fungus);
          } else if (bk === 'soul_sand_valley') {
            if (r < 0.004 && I.soul_fire && g === I.soul_soil) set(lx, y + 1, lz, I.soul_fire);
            else if (r < 0.006 && lx > 0 && lx < 15 && lz > 0 && lz < 15) for (let h = 1; h < 4 + (r * 2000) % 8; h++) if (get(lx, y + h, lz) === B.AIR) set(lx, y + h, lz, I.basalt);
          } else if (bk === 'basalt_deltas') {
            if (r < 0.01) for (let h = 1; h < 3 + (r * 1000) % 6; h++) if (get(lx, y + h, lz) === B.AIR) set(lx, y + h, lz, I.basalt);
          } else if (bk === 'nether_wastes') {
            if (r < 0.003 && I.fire && g === I.netherrack) set(lx, y + 1, lz, I.fire);
          }
        }
      }
  }

  /** Champignon géant (carmin ou biscornu) : tige, chapeau de verrues, champilampes. */
  private hugeFungus(set: (x: number, y: number, z: number, b: number) => void, get: (x: number, y: number, z: number) => number, x: number, y: number, z: number, crimson: boolean, rng: Rng) {
    const I = this.ids;
    const h = rng.int(5, 9);
    for (let k = 0; k < h; k++) if (get(x, y + k, z) !== B.AIR) return;
    for (let k = 0; k < h; k++) set(x, y + k, z, crimson ? I.crimson_stem : I.warped_stem);
    const top = y + h;
    for (let dy = -3; dy <= 0; dy++) {
      const r = dy >= -1 ? 2 : 1;
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
          if (dy < 0 && Math.abs(dx) < r && Math.abs(dz) < r && !(dx === 0 && dz === 0 && dy === 0)) continue;
          const tx = x + dx, ty = top + dy, tz = z + dz;
          if (get(tx, ty, tz) !== B.AIR) continue;
          set(tx, ty, tz, rng.chance(0.08) ? I.shroomlight : crimson ? I.nether_wart_block : I.warped_wart_block);
        }
    }
    set(x, top, z, crimson ? I.nether_wart_block : I.warped_wart_block);
  }

  private ores(c: ChunkData) {
    const I = this.ids;
    const blocks = c.blocks;
    const rng = new Rng(hash2(this.seed + 13, c.cx, c.cz));
    const vein = (block: number, tries: number, size: number, minY: number, maxY: number, host: number[]) => {
      for (let t = 0; t < tries; t++) {
        let x = rng.int(0, 15), y = rng.int(minY, maxY), z = rng.int(0, 15);
        for (let k = 0; k < size; k++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WORLD_HEIGHT - 1) {
            const i = idx(x, y, z);
            if (host.includes(blocks[i])) blocks[i] = block;
          }
          x += rng.int(-1, 1);
          y += rng.int(-1, 1);
          z += rng.int(-1, 1);
        }
      }
    };
    vein(I.nether_quartz_ore, 16, 12, 10, 117, [I.netherrack]);
    vein(I.nether_gold_ore, 10, 9, 10, 117, [I.netherrack]);
    vein(I.ancient_debris, 1, 2, 8, 22, [I.netherrack, I.basalt, I.blackstone]);
    vein(I.ancient_debris, 1, 3, 8, 119, [I.netherrack]);
    vein(I.magma, 4, 18, 26, 36, [I.netherrack]);
    vein(B.GRAVEL, 2, 24, 5, 41, [I.netherrack]);
    vein(I.blackstone, 2, 20, 5, 30, [I.netherrack]);
  }

  // ---------- forteresses ----------
  /** Centre de la forteresse de la région (ou null : pas de forteresse dans cette région). */
  private fortressCenter(rx: number, rz: number): { x: number; z: number; lenX: number; lenZ: number } | null {
    const h = hash2(this.seed + 31, rx, rz);
    if ((h & 3) === 0) return null; // 3 régions sur 4
    const r = new Rng(h);
    return { x: rx * FORTRESS_REGION + r.int(64, FORTRESS_REGION - 64), z: rz * FORTRESS_REGION + r.int(64, FORTRESS_REGION - 64), lenX: r.int(40, 72), lenZ: r.int(40, 72) };
  }

  locateFortress(x: number, z: number): { x: number; z: number } | null {
    const rx0 = Math.floor(x / FORTRESS_REGION), rz0 = Math.floor(z / FORTRESS_REGION);
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++) {
        const f = this.fortressCenter(rx0 + dx, rz0 + dz);
        if (!f) continue;
        const d = Math.hypot(f.x - x, f.z - z);
        if (d < bd) {
          bd = d;
          best = { x: f.x, z: f.z };
        }
      }
    return best;
  }

  /**
   * Forteresse : deux ponts couverts en croix (sol, murs, toit, fenêtres en barrières),
   * piliers jusqu'au sol, salle centrale avec générateur de blazes, sable des âmes et coffres.
   */
  private fortress(c: ChunkData) {
    const I = this.ids;
    if (!I.nether_bricks) return;
    const blocks = c.blocks, meta = c.meta;
    const bx = c.cx * CHUNK_SIZE, bz = c.cz * CHUNK_SIZE;
    const rx = Math.floor((bx + 8) / FORTRESS_REGION), rz = Math.floor((bz + 8) / FORTRESS_REGION);
    const f = this.fortressCenter(rx, rz);
    if (!f) return;
    if (bx + 16 < f.x - f.lenX - 8 || bx > f.x + f.lenX + 8 || bz + 16 < f.z - f.lenZ - 8 || bz > f.z + f.lenZ + 8) return;
    const Y = FORTRESS_Y;
    const blaze = Math.max(0, MOB_DEFS.findIndex((d) => d.key === 'blaze'));
    const put = (lx: number, y: number, lz: number, b: number, m = 0) => {
      const i = idx(lx, y, lz);
      blocks[i] = b;
      meta[i] = m;
    };
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const x = bx + lx, z = bz + lz;
        const dx = x - f.x, dz = z - f.z;
        const inX = Math.abs(dz) <= 3 && Math.abs(dx) <= f.lenX; // pont est-ouest
        const inZ = Math.abs(dx) <= 3 && Math.abs(dz) <= f.lenZ; // pont nord-sud
        const room = Math.abs(dx) <= 7 && Math.abs(dz) <= 7;
        if (!inX && !inZ && !room) continue;
        const half = room ? 7 : 3;
        const across = room ? Math.max(Math.abs(dx), Math.abs(dz)) : inX ? Math.abs(dz) : Math.abs(dx);
        const along = room ? 0 : inX ? Math.abs(dx) : Math.abs(dz);
        const covered = room || along % 24 < 14; // alternance couloirs couverts / ponts ouverts
        const edge = room ? Math.abs(dx) === half || Math.abs(dz) === half : across === half;
        // dégage le volume intérieur
        for (let y = Y + 1; y <= Y + 6; y++) put(lx, y, lz, B.AIR);
        // sol et piliers
        put(lx, Y, lz, I.nether_bricks);
        put(lx, Y - 1, lz, I.nether_bricks);
        const pillar = !room && along % 8 === 0 && across >= half - 1;
        if (pillar) for (let y = Y - 2; y > 1; y--) {
          const b = blocks[idx(lx, y, lz)];
          if (b !== B.AIR && b !== B.LAVA) break;
          put(lx, y, lz, I.nether_bricks);
        }
        if (edge) {
          if (covered) {
            for (let y = Y + 1; y <= Y + 4; y++) put(lx, y, lz, (y === Y + 2 || y === Y + 3) && (along + across) % 4 === 1 ? I.nether_brick_fence : I.nether_bricks);
          } else put(lx, Y + 1, lz, I.nether_brick_fence);
        }
        if (covered) put(lx, Y + 5, lz, I.nether_bricks);
        // salle centrale : générateur de blazes, sable des âmes, coffres
        if (room) {
          if (dx === 0 && dz === 0) put(lx, Y + 1, lz, B.SPAWNER, blaze);
          else if (Math.abs(dx) === 5 && Math.abs(dz) >= 2 && Math.abs(dz) <= 4) put(lx, Y, lz, I.soul_sand);
          else if ((dx === 6 && dz === 6) || (dx === -6 && dz === -6)) put(lx, Y + 1, lz, B.CHEST, chestMeta(LOOT.FORTRESS, dx > 0 ? 2 : 0));
          else if (dx === 0 && Math.abs(dz) === 7 || dz === 0 && Math.abs(dx) === 7) for (let y = Y + 1; y <= Y + 3; y++) put(lx, y, lz, B.AIR); // portes
        }
        // bouts des ponts : coffre
        if (!room && along === (inX ? f.lenX : f.lenZ) - 2 && across === 0) put(lx, Y + 1, lz, B.CHEST, chestMeta(LOOT.FORTRESS));
      }
  }
}
