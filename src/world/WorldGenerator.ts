import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../core/Config';
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { clamp, hash2, hash3, lerp, Rng, smoothstep } from '../util/math';
import { SimplexNoise } from './Noise';
import { BiomeManager } from './BiomeManager';
import { computeHeights, createChunkData, idx, type ChunkData, type SpecialBlock } from './ChunkData';
import { CaveGenerator } from './CaveGenerator';
import { StructureGenerator, type StructWriter, type TerrainQuery } from './StructureGenerator';
import { buildTree, TREE_MAX_RADIUS } from './Trees';

export interface ColumnInfo {
  height: number;
  biome: number;
  temperature: number;
  humidity: number;
  river: boolean;
}

interface OreDef {
  block: number;
  /** Répartition : uniforme entre minY et maxY, ou triangulaire centrée sur `peak` (± spread). */
  minY: number;
  maxY: number;
  peak?: number;
  spread?: number;
  tries: number;
  size: number;
  /** Variante dans l'ardoise des abîmes. */
  deep?: string;
}
/**
 * Minerais : distributions triangulaires inspirées de la génération 1.18 du jeu de référence,
 * ramenées à la hauteur du monde (y 16 ≈ y 0 du jeu de référence, niveau de la mer 52 ≈ 63).
 */
const ORES: OreDef[] = [
  { block: B.GRANITE, minY: 5, maxY: 90, tries: 3, size: 28 },
  { block: B.DIORITE, minY: 5, maxY: 90, tries: 3, size: 28 },
  { block: B.ANDESITE, minY: 5, maxY: 90, tries: 3, size: 28 },
  { block: B.DIRT, minY: 5, maxY: 90, tries: 3, size: 24 },
  { block: B.GRAVEL, minY: 5, maxY: 90, tries: 3, size: 24 },
  { block: B.COAL_ORE, minY: 20, maxY: 120, peak: 72, spread: 48, tries: 20, size: 12, deep: 'deepslate_coal_ore' },
  { block: B.COPPER_ORE, minY: 4, maxY: 90, peak: 44, spread: 32, tries: 10, size: 9, deep: 'deepslate_copper_ore' },
  { block: B.IRON_ORE, minY: 2, maxY: 70, peak: 26, spread: 30, tries: 12, size: 8, deep: 'deepslate_iron_ore' },
  { block: B.IRON_ORE, minY: 70, maxY: 126, peak: 104, spread: 30, tries: 6, size: 8 },
  { block: B.LAPIS_ORE, minY: 2, maxY: 40, peak: 16, spread: 18, tries: 3, size: 6, deep: 'deepslate_lapis_ore' },
  { block: B.GOLD_ORE, minY: 2, maxY: 34, peak: 10, spread: 22, tries: 4, size: 7, deep: 'deepslate_gold_ore' },
  { block: B.REDSTONE_ORE, minY: 2, maxY: 22, peak: 2, spread: 20, tries: 6, size: 7, deep: 'deepslate_redstone_ore' },
  { block: B.DIAMOND_ORE, minY: 2, maxY: 20, peak: 2, spread: 18, tries: 3, size: 6, deep: 'deepslate_diamond_ore' },
  { block: B.EMERALD_ORE, minY: 40, maxY: 126, peak: 100, spread: 40, tries: 3, size: 2, deep: 'deepslate_emerald_ore' },
  { block: B.CLAY, minY: 30, maxY: 60, tries: 2, size: 10 },
];
/** Sommet de la couche d'ardoise des abîmes (transition sur 8 blocs au-dessus). */
export const DEEPSLATE_Y = 16;

/**
 * Générateur procédural déterministe. Toute la génération dépend uniquement du seed :
 * le même seed produit exactement le même monde.
 * Couches de bruit : continentalité, érosion, pics/vallées, détail, température, humidité, rivières.
 */
export class WorldGenerator implements TerrainQuery {
  readonly seed: number;
  private continental: SimplexNoise;
  private erosion: SimplexNoise;
  private peaks: SimplexNoise;
  private detail: SimplexNoise;
  private temp: SimplexNoise;
  private humid: SimplexNoise;
  private river: SimplexNoise;
  private surfaceNoise: SimplexNoise;
  private caves: CaveGenerator;
  readonly structures: StructureGenerator;
  private cache = new Map<number, ColumnInfo>();
  private deepslate: number;
  private deepOre = new Map<number, number>();

  constructor(seed: number) {
    this.deepslate = BlockRegistry.has('deepslate') ? BlockRegistry.byName('deepslate').id : B.STONE;
    for (const o of ORES) if (o.deep && BlockRegistry.has(o.deep)) this.deepOre.set(o.block, BlockRegistry.byName(o.deep).id);
    this.seed = seed | 0;
    this.continental = new SimplexNoise(seed + 1);
    this.erosion = new SimplexNoise(seed + 2);
    this.peaks = new SimplexNoise(seed + 3);
    this.detail = new SimplexNoise(seed + 4);
    this.temp = new SimplexNoise(seed + 5);
    this.humid = new SimplexNoise(seed + 6);
    this.river = new SimplexNoise(seed + 7);
    this.surfaceNoise = new SimplexNoise(seed + 8);
    this.caves = new CaveGenerator(seed);
    this.structures = new StructureGenerator(seed, this);
  }

  /** Calcul pur (sans cache) des propriétés d'une colonne. */
  private computeColumn(x: number, z: number): ColumnInfo {
    const cont = this.continental.fbm2(x / 700, z / 700, 4);
    const ero = this.erosion.fbm2(x / 380, z / 380, 3);
    const pv = this.peaks.fbm2(x / 190, z / 190, 4);
    const ridge = 1 - Math.abs(pv);
    const det = this.detail.fbm2(x / 48, z / 48, 3);
    let temperature = this.temp.fbm2(x / 900, z / 900, 3) * 1.4;
    const humidity = this.humid.fbm2(x / 800, z / 800, 3) * 1.4;

    let h: number;
    let inland = 0;
    if (cont < -0.22) {
      const d = Math.min(1, (-0.22 - cont) / 0.3);
      h = SEA_LEVEL - 3 - d * 22 + det * 2;
    } else if (cont < -0.08) {
      const t = (cont + 0.22) / 0.14;
      h = lerp(SEA_LEVEL - 3, SEA_LEVEL + 2, t) + det * 1.5;
    } else {
      inland = Math.min(1, (cont + 0.08) / 0.5);
      const base = SEA_LEVEL + 2 + inland * 10 + det * 3;
      const hill = ridge * ridge * 14 * (0.5 + 0.5 * inland);
      const mount = smoothstep(-0.05, -0.45, ero);
      const mountains = mount * Math.pow(ridge, 1.5) * 58 * (0.3 + 0.7 * inland);
      h = base + hill * (1 - mount) + mountains;
    }
    // marais : terrain aplati au niveau de la mer
    if (h > SEA_LEVEL && humidity > 0.45 && temperature > -0.3 && temperature < 0.42 && h < SEA_LEVEL + 10) {
      h = lerp(h, SEA_LEVEL + 0.4, 0.75);
    }
    // rivières (vallées)
    let river = false;
    const rv = Math.abs(this.river.fbm2(x / 420, z / 420, 2));
    const RW = 0.028;
    if (rv < RW && cont > -0.16) {
      const t = rv / RW;
      const target = SEA_LEVEL - 2.5 - (1 - t) * 2;
      h = lerp(target, h, t * t);
      if (h < SEA_LEVEL) river = true;
    }
    const height = clamp(Math.round(h), 6, WORLD_HEIGHT - 8);
    temperature -= Math.max(0, height - SEA_LEVEL - 20) / 60;

    let biome: number;
    if (river) biome = temperature < -0.5 ? BiomeManager.byName('ice_zone').id : BiomeManager.byName('river').id;
    else if (height < SEA_LEVEL - 1) biome = temperature < -0.6 ? BiomeManager.byName('ice_zone').id : BiomeManager.byName('ocean').id;
    else if (height <= SEA_LEVEL + 1 && cont < -0.04) biome = temperature < -0.4 ? BiomeManager.byName('tundra').id : BiomeManager.byName('beach').id;
    else if (height > SEA_LEVEL + 36) biome = BiomeManager.byName('mountain').id;
    else biome = BiomeManager.selectLand(temperature, humidity, height, SEA_LEVEL).id;
    return { height, biome, temperature, humidity, river };
  }

  column(x: number, z: number): ColumnInfo {
    const key = (x + 32768) * 65536 + (z + 32768);
    let c = this.cache.get(key);
    if (!c) {
      if (this.cache.size > 60000) this.cache.clear();
      c = this.computeColumn(x, z);
      this.cache.set(key, c);
    }
    return c;
  }
  heightAt(x: number, z: number) {
    return this.column(x, z).height;
  }
  biomeAt(x: number, z: number) {
    return this.column(x, z).biome;
  }

  generateChunk(cx: number, cz: number): { data: ChunkData; specials: SpecialBlock[] } {
    const c = createChunkData(cx, cz);
    const blocks = c.blocks;
    const bx = cx * CHUNK_SIZE, bz = cz * CHUNK_SIZE;
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const rng = new Rng(hash3(this.seed, cx, 1, cz));

    // 1) Terrain de base + surface
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = bx + x, wz = bz + z;
        const col = this.column(wx, wz);
        const h = col.height;
        heights[x + z * CHUNK_SIZE] = h;
        c.biomes[x + z * CHUNK_SIZE] = col.biome;
        const biome = BiomeManager.get(col.biome);
        // pente : roche apparente sur les versants raides
        const slope = Math.max(Math.abs(this.heightAt(wx + 1, wz) - this.heightAt(wx - 1, wz)), Math.abs(this.heightAt(wx, wz + 1) - this.heightAt(wx, wz - 1)));
        let surface = B[biome.surfaceBlock.toUpperCase()];
        let under = B[biome.undergroundBlock.toUpperCase()];
        const sn = this.surfaceNoise.noise2(wx / 16, wz / 16);
        if (h < SEA_LEVEL) {
          surface = sn > 0.45 ? B.GRAVEL : sn < -0.55 ? B.CLAY : B.SAND;
          under = biome.key === 'river' || biome.key === 'ocean' ? B.SAND : under;
          if (biome.key === 'swamp') surface = B.MUD;
        } else if (biome.key === 'mountain') {
          if (h > SEA_LEVEL + 56) surface = B.SNOW;
          else if (h > SEA_LEVEL + 46 || slope > 3) surface = B.STONE;
          else if (slope > 2 && sn > 0) surface = B.GRAVEL;
        } else if (slope > 4 && h > SEA_LEVEL + 6) {
          surface = B.STONE;
          under = B.STONE;
        }
        if (biome.key === 'taiga' && surface === B.GRASS_BLOCK && sn > 0.25) surface = B.PODZOL;
        if (h === SEA_LEVEL && (surface === B.GRASS_BLOCK || surface === B.SNOWY_GRASS_BLOCK) && biome.key !== 'swamp') surface = B.SAND;
        if (surface === B.GRASS_BLOCK && h < SEA_LEVEL) surface = B.DIRT;
        const underDepth = biome.underDepth + (sn > 0.3 ? 1 : 0);
        for (let y = 0; y <= h; y++) {
          let b: number;
          if (y === 0 || (y <= 2 && rng.next() < 0.5)) b = B.BEDROCK;
          else if (y === h) b = surface;
          else if (y >= h - underDepth) b = under;
          else if (y < DEEPSLATE_Y || (y < DEEPSLATE_Y + 8 && (hash3(this.seed, wx, y, wz) & 7) >= y - DEEPSLATE_Y)) b = this.deepslate;
          else b = B.STONE;
          blocks[idx(x, y, z)] = b;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) blocks[idx(x, y, z)] = B.WATER;
        if (biome.frozen && h < SEA_LEVEL) blocks[idx(x, SEA_LEVEL, z)] = B.ICE;
      }

    // 2) Grottes
    this.caves.carve(c, heights);

    // 3) Minerais
    const centerBiome = BiomeManager.get(c.biomes[8 + 8 * CHUNK_SIZE]).key;
    for (const ore of ORES) {
      if (ore.block === B.EMERALD_ORE && centerBiome !== 'mountain') continue;
      const deep = this.deepOre.get(ore.block);
      for (let t = 0; t < ore.tries; t++) {
        let x = rng.int(0, 15), z = rng.int(0, 15);
        let y = ore.peak !== undefined ? Math.round(ore.peak + (rng.next() - rng.next()) * (ore.spread ?? 16)) : rng.int(ore.minY, ore.maxY);
        if (y < ore.minY || y > ore.maxY) continue;
        for (let s = 0; s < ore.size; s++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WORLD_HEIGHT) {
            const i = idx(x, y, z);
            if (blocks[i] === B.STONE) blocks[i] = ore.block;
            else if (blocks[i] === this.deepslate && this.deepslate !== B.STONE) blocks[i] = deep ?? (ore.block === B.GRANITE || ore.block === B.DIORITE || ore.block === B.ANDESITE ? blocks[i] : ore.block);
          }
          x += rng.int(-1, 1);
          y += rng.int(-1, 1);
          z += rng.int(-1, 1);
        }
      }
    }
    this.caves.decorate(c, heights);

    // 4) Arbres (y compris ceux dont le tronc est dans un chunk voisin)
    const setClipped = (x: number, y: number, z: number, b: number, onlyIfAir?: boolean) => {
      const lx = x - bx, lz = z - bz;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y <= 0 || y >= WORLD_HEIGHT) return;
      const i = idx(lx, y, lz);
      if (onlyIfAir && blocks[i] !== B.AIR && blocks[i] !== B.SHORT_GRASS) return;
      blocks[i] = b;
    };
    const R = TREE_MAX_RADIUS;
    for (let wz = bz - R; wz < bz + CHUNK_SIZE + R; wz++)
      for (let wx = bx - R; wx < bx + CHUNK_SIZE + R; wx++) {
        const col = this.column(wx, wz);
        const biome = BiomeManager.get(col.biome);
        if (biome.treeDensity <= 0 || col.height < SEA_LEVEL || col.river) continue;
        const hh = hash2(this.seed + 31, wx, wz);
        if ((hh & 0xffffff) / 0x1000000 >= biome.treeDensity) continue;
        // pas d'arbre sur les versants raides ou la roche
        if (biome.key === 'mountain' && col.height > SEA_LEVEL + 46) continue;
        let total = 0;
        for (const t of biome.trees) total += t.weight;
        let pick = ((hh >>> 24) / 256) * total;
        let type = biome.trees[0].type;
        for (const t of biome.trees) {
          pick -= t.weight;
          if (pick < 0) {
            type = t.type;
            break;
          }
        }
        // la surface doit être du sol (vérifiable seulement localement)
        const lx = wx - bx, lz = wz - bz;
        if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
          const ground = blocks[idx(lx, col.height, lz)];
          if (ground === B.AIR || ground === B.WATER || ground === B.LAVA) continue;
          if (type !== 'cactus') blocks[idx(lx, col.height, lz)] = B.DIRT;
        }
        buildTree(type, wx, col.height + 1, wz, hh, setClipped);
      }

    // 5) Végétation basse (dans le chunk)
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = heights[x + z * CHUNK_SIZE];
        if (h + 1 >= WORLD_HEIGHT) continue;
        const ground = blocks[idx(x, h, z)];
        const above = idx(x, h + 1, z);
        if (blocks[above] !== B.AIR) continue;
        const biome = BiomeManager.get(c.biomes[x + z * CHUNK_SIZE]);
        // couche de neige sur les biomes froids et les sommets
        const cold = biome.weather === 'snow' && (biome.key !== 'mountain' || h > SEA_LEVEL + 40);
        if (cold && h >= SEA_LEVEL && BlockRegistry.opaque[ground]) {
          if (ground === B.GRASS_BLOCK) blocks[idx(x, h, z)] = B.SNOWY_GRASS_BLOCK;
          blocks[above] = B.SNOW;
          continue;
        }
        // canne à sucre au bord de l'eau
        if ((ground === B.GRASS_BLOCK || ground === B.SAND || ground === B.DIRT) && h === SEA_LEVEL && rng.next() < 0.12) {
          const wx = bx + x, wz = bz + z;
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.heightAt(wx + dx, wz + dz) < SEA_LEVEL)) {
            const hh = 1 + rng.int(0, 2);
            for (let k = 1; k <= hh && h + k < WORLD_HEIGHT; k++) blocks[idx(x, h + k, z)] = B.SUGAR_CANE;
            continue;
          }
        }
        for (const v of biome.vegetation) {
          if (rng.next() < v.chance) {
            const bid = B[v.block.toUpperCase()];
            const ok = ground === B.GRASS_BLOCK || ground === B.PODZOL || (v.block === 'dead_bush' && ground === B.SAND);
            if (ok && bid !== undefined) blocks[above] = bid;
            break;
          }
        }
      }

    // 6) Structures
    const writer: StructWriter = {
      set: (x, y, z, b, m = 0) => {
        const lx = x - bx, lz = z - bz;
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y <= 0 || y >= WORLD_HEIGHT) return;
        const i = idx(lx, y, lz);
        blocks[i] = b;
        c.meta[i] = m;
      },
      setIfAir: (x, y, z, b, m = 0) => {
        const lx = x - bx, lz = z - bz;
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y <= 0 || y >= WORLD_HEIGHT) return;
        const i = idx(lx, y, lz);
        if (blocks[i] !== B.AIR) return;
        blocks[i] = b;
        c.meta[i] = m;
      },
    };
    this.structures.apply(cx, cz, writer);

    computeHeights(c);
    return { data: c, specials: scanSpecials(c) };
  }

  /** Point d'apparition : première colonne terrestre (hors océan/rivière) en spirale autour de l'origine. */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 2000; r += 8) {
      const steps = Math.max(1, Math.floor((2 * Math.PI * r) / 8));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        const col = this.column(x, z);
        const key = BiomeManager.get(col.biome).key;
        if (col.height > SEA_LEVEL + 1 && key !== 'ocean' && key !== 'river' && key !== 'mountain') return { x: x + 0.5, y: col.height + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: WORLD_HEIGHT - 10, z: 0.5 };
  }
}

/** Liste les blocs nécessitant une logique de jeu (cages, autels). */
export function scanSpecials(c: ChunkData): SpecialBlock[] {
  const out: SpecialBlock[] = [];
  const blocks = c.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b === B.SPAWNER || b === B.BOSS_ALTAR) {
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
      out.push({ x: c.cx * CHUNK_SIZE + x, y, z: c.cz * CHUNK_SIZE + z, block: b, meta: c.meta[i] });
    }
  }
  return out;
}
