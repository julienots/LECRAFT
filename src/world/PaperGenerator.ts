import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/Config';
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { hash2, Rng } from '../util/math';
import { SimplexNoise } from './Noise';
import { BiomeManager } from './BiomeManager';
import { computeHeights, createChunkData, idx, type ChunkData, type SpecialBlock } from './ChunkData';
import { scanSpecials } from './WorldGenerator';
import { chestMeta, LOOT } from './StructureGenerator';
import { MOB_BY_KEY } from '../data/mobs';

/** Point d'arrivée par défaut dans la Pâte à papier. */
export const PAPER_BASE_Y = 52;
/** Taille des régions des temples d'origami (un au plus par région). */
const TEMPLE_REGION = 144;

const id = (k: string, fallback: number = B.STONE) => (BlockRegistry.has(k) ? BlockRegistry.byName(k).id : fallback);

/**
 * Générateur de la « Pâte à papier » : un monde de feuilles posées les unes sur les autres.
 * - Plaines de papier blanc (fleurs en papier, confettis), forêts d'origami (troncs en tubes de
 *   carton, feuillages pliés verts ou roses), canyons de carton en terrasses, marais d'encre
 *   (papier journal et flaques d'encre) ;
 * - sous-sol en carton puis papier froissé, filons de graphite, quelques grottes ;
 * - temples d'origami en papier de couleur (coffre au trésor, cage à gribouilles, lanternes).
 */
export class PaperGenerator {
  readonly seed: number;
  private height: SimplexNoise;
  private detail: SimplexNoise;
  private biomeA: SimplexNoise;
  private biomeB: SimplexNoise;
  private cave: SimplexNoise;
  private ids: Record<string, number>;
  readonly structures = { locate: (key: string, x: number, z: number) => (key.includes('temple') || key.includes('paper') ? this.locateTemple(x, z) : null) };

  constructor(seed: number) {
    this.seed = seed | 0;
    this.height = new SimplexNoise(seed + 301);
    this.detail = new SimplexNoise(seed + 302);
    this.biomeA = new SimplexNoise(seed + 303);
    this.biomeB = new SimplexNoise(seed + 304);
    this.cave = new SimplexNoise(seed + 305);
    this.ids = Object.fromEntries(
      ['paper_block', 'lined_paper', 'squared_paper', 'newspaper_block', 'crumpled_paper', 'cardboard', 'cardboard_tube', 'origami_leaves', 'origami_blossom', 'graphite_ore', 'ink_block',
        'paper_lantern', 'paper_rose', 'paper_tulip', 'paper_daisy', 'confetti', 'red_paper', 'orange_paper', 'yellow_paper', 'lime_paper', 'cyan_paper', 'blue_paper', 'purple_paper', 'pink_paper', 'papier_mache'].map((k) => [k, id(k, k.includes('paper') || k.includes('cardboard') ? B.SANDSTONE : 0)]),
    );
  }

  biomeKey(x: number, z: number): string {
    const a = this.biomeA.fbm2(x / 220, z / 220, 3), b = this.biomeB.fbm2(x / 220, z / 220, 3);
    if (a > 0.28) return 'origami_forest';
    if (a < -0.3) return 'cardboard_canyon';
    if (b > 0.32) return 'ink_marsh';
    return 'paper_plains';
  }

  biomeAt(x: number, z: number): number {
    return BiomeManager.byName(this.biomeKey(x, z)).id;
  }

  /** Hauteur du sol à (x, z). */
  surface(x: number, z: number, biome = this.biomeKey(x, z)): number {
    const n = this.height.fbm2(x / 90, z / 90, 4), d = this.detail.noise2(x / 18, z / 18);
    let h = PAPER_BASE_Y + n * 10 + d * 2;
    if (biome === 'cardboard_canyon') {
      // terrasses de carton (piles de feuilles) et gorges
      const t = PAPER_BASE_Y + 6 + n * 22;
      h = Math.floor(t / 4) * 4;
      if (Math.abs(this.detail.noise2(x / 60, z / 60)) < 0.08) h = PAPER_BASE_Y - 6;
    } else if (biome === 'ink_marsh') h = PAPER_BASE_Y - 2 + n * 3 + d;
    else if (biome === 'origami_forest') h += 2;
    return Math.max(8, Math.min(WORLD_HEIGHT - 20, Math.round(h)));
  }

  generateChunk(cx: number, cz: number): { data: ChunkData; specials: SpecialBlock[] } {
    const c = createChunkData(cx, cz);
    const blocks = c.blocks, meta = c.meta;
    const I = this.ids;
    const bx = cx * CHUNK_SIZE, bz = cz * CHUNK_SIZE;
    const rng = new Rng(hash2(this.seed, cx, cz));
    const tops = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const keys: string[] = [];
    for (let lz = 0; lz < CHUNK_SIZE; lz++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = bx + lx, z = bz + lz;
        const bk = this.biomeKey(x, z);
        keys[lx + lz * CHUNK_SIZE] = bk;
        c.biomes[lx + lz * CHUNK_SIZE] = BiomeManager.byName(bk).id;
        const h = this.surface(x, z, bk);
        tops[lx + lz * CHUNK_SIZE] = h;
        blocks[idx(lx, 0, lz)] = B.BEDROCK;
        const top = bk === 'origami_forest' ? I.lined_paper : bk === 'cardboard_canyon' ? I.cardboard : bk === 'ink_marsh' ? I.newspaper_block : (x + z) % 23 === 0 ? I.squared_paper : I.paper_block;
        for (let y = 1; y <= h; y++) {
          let b: number;
          if (y === h) b = top;
          else if (y > h - (bk === 'cardboard_canyon' ? 8 : 4)) b = I.cardboard;
          else b = I.crumpled_paper;
          // grottes (pas trop près de la surface) et filons de graphite
          if (y > 3 && y < h - 6 && this.cave.noise3(x / 22, y / 14, z / 22) > 0.55) b = B.AIR;
          else if (b === I.crumpled_paper && y < h - 5 && (hash2(this.seed + y, x, z) & 1023) < 9) b = I.graphite_ore;
          blocks[idx(lx, y, lz)] = b;
        }
        // flaques d'encre du marais
        if (bk === 'ink_marsh' && this.detail.noise2(x / 9, z / 9) > 0.35) blocks[idx(lx, h, lz)] = I.ink_block;
        // décoration de surface
        if (h + 1 < WORLD_HEIGHT && blocks[idx(lx, h, lz)] !== I.ink_block) {
          const r = rng.next();
          if (bk === 'paper_plains' && r < 0.045) blocks[idx(lx, h + 1, lz)] = [I.paper_rose, I.paper_tulip, I.paper_daisy][rng.int(0, 2)];
          else if (bk === 'paper_plains' && r < 0.06) blocks[idx(lx, h + 1, lz)] = I.confetti;
          else if (bk === 'origami_forest' && r < 0.03) blocks[idx(lx, h + 1, lz)] = [I.paper_rose, I.paper_daisy][rng.int(0, 1)];
          else if (bk === 'ink_marsh' && r < 0.015) blocks[idx(lx, h + 1, lz)] = I.paper_daisy;
        }
      }
    // arbres d'origami (y compris ceux des chunks voisins qui débordent)
    for (let tz = -1; tz <= 1; tz++)
      for (let tx = -1; tx <= 1; tx++) {
        const r2 = new Rng(hash2(this.seed + 77, cx + tx, cz + tz));
        const n = r2.int(0, 5);
        for (let k = 0; k < n; k++) {
          const x = (cx + tx) * CHUNK_SIZE + r2.int(2, 13), z = (cz + tz) * CHUNK_SIZE + r2.int(2, 13);
          if (this.biomeKey(x, z) !== 'origami_forest' && !(this.biomeKey(x, z) === 'paper_plains' && k === 0 && r2.next() < 0.15)) continue;
          this.tree(blocks, bx, bz, x, this.surface(x, z) + 1, z, r2);
        }
      }
    // lanternes de papier sur poteaux de carton dans les plaines
    if (rng.next() < 0.18) {
      const lx = rng.int(2, 13), lz = rng.int(2, 13), h = tops[lx + lz * CHUNK_SIZE];
      if (keys[lx + lz * CHUNK_SIZE] === 'paper_plains' && h + 4 < WORLD_HEIGHT) {
        for (let y = h + 1; y <= h + 2; y++) blocks[idx(lx, y, lz)] = I.cardboard_tube;
        blocks[idx(lx, h + 3, lz)] = I.paper_lantern;
      }
    }
    this.temple(blocks, meta, cx, cz);
    computeHeights(c);
    return { data: c, specials: scanSpecials(c) };
  }

  /** Arbre d'origami : tronc en tube de carton et feuillage en pyramide à gradins. */
  private tree(blocks: Uint16Array, bx: number, bz: number, x: number, y: number, z: number, r: Rng) {
    const I = this.ids;
    const h = r.int(4, 7);
    const leaf = r.next() < 0.35 ? I.origami_blossom : I.origami_leaves;
    const put = (wx: number, wy: number, wz: number, b: number, over = false) => {
      const lx = wx - bx, lz = wz - bz;
      if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE || wy < 1 || wy >= WORLD_HEIGHT) return;
      const i = idx(lx, wy, lz);
      if (over || blocks[i] === B.AIR) blocks[i] = b;
    };
    for (let k = 0; k < h; k++) put(x, y + k, z, I.cardboard_tube, true);
    const base = y + h - 2;
    for (let level = 0; level < 4; level++) {
      const rad = 3 - level;
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) if (Math.abs(dx) + Math.abs(dz) <= rad + 1) put(x + dx, base + level, z + dz, leaf);
    }
    put(x, base + 4, z, leaf);
  }

  /** Centre du temple de la région (rx, rz), ou null. */
  private templeIn(rx: number, rz: number): { x: number; z: number } | null {
    const r = new Rng(hash2(this.seed + 911, rx, rz));
    if (r.next() > 0.6) return null;
    const x = rx * TEMPLE_REGION + r.int(24, TEMPLE_REGION - 24), z = rz * TEMPLE_REGION + r.int(24, TEMPLE_REGION - 24);
    if (this.biomeKey(x, z) === 'cardboard_canyon') return null;
    return { x, z };
  }

  locateTemple(x: number, z: number): { x: number; z: number } | null {
    const rx0 = Math.floor(x / TEMPLE_REGION), rz0 = Math.floor(z / TEMPLE_REGION);
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (let r = 0; r <= 6; r++)
      for (let rz = rz0 - r; rz <= rz0 + r; rz++)
        for (let rx = rx0 - r; rx <= rx0 + r; rx++) {
          if (Math.max(Math.abs(rx - rx0), Math.abs(rz - rz0)) !== r) continue;
          const t = this.templeIn(rx, rz);
          if (!t) continue;
          const d = Math.hypot(t.x - x, t.z - z);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
    return best;
  }

  /** Temple d'origami : pyramide à gradins de papier de couleur, salle avec coffre et cage. */
  private temple(blocks: Uint16Array, meta: Uint8Array, cx: number, cz: number) {
    const I = this.ids;
    const bx = cx * CHUNK_SIZE, bz = cz * CHUNK_SIZE;
    const rx = Math.floor((bx + 8) / TEMPLE_REGION), rz = Math.floor((bz + 8) / TEMPLE_REGION);
    for (let oz = -1; oz <= 1; oz++)
      for (let ox = -1; ox <= 1; ox++) {
        const t = this.templeIn(rx + ox, rz + oz);
        if (!t || t.x + 10 < bx || t.x - 10 >= bx + CHUNK_SIZE || t.z + 10 < bz || t.z - 10 >= bz + CHUNK_SIZE) continue;
        const y0 = this.surface(t.x, t.z) + 1;
        const colors = [I.red_paper, I.orange_paper, I.yellow_paper, I.lime_paper, I.cyan_paper, I.blue_paper, I.purple_paper];
        const set = (x: number, y: number, z: number, b: number, m = 0) => {
          const lx = x - bx, lz = z - bz;
          if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE || y < 1 || y >= WORLD_HEIGHT) return;
          blocks[idx(lx, y, lz)] = b;
          meta[idx(lx, y, lz)] = m;
        };
        // fondations jusqu'au sol
        for (let dz = -9; dz <= 9; dz++) for (let dx = -9; dx <= 9; dx++) for (let y = y0 - 6; y < y0; y++) set(t.x + dx, y, t.z + dz, I.cardboard);
        // gradins (un par couleur), creux à l'intérieur
        for (let level = 0; level < 7; level++) {
          const rad = 9 - level;
          for (let dz = -rad; dz <= rad; dz++)
            for (let dx = -rad; dx <= rad; dx++) {
              const edge = Math.abs(dx) === rad || Math.abs(dz) === rad;
              const inside = rad > 3 && !edge && level < 4;
              set(t.x + dx, y0 + level, t.z + dz, inside ? B.AIR : colors[level]);
            }
        }
        // entrée et escalier de lanternes
        for (let y = y0; y < y0 + 3; y++) for (let dx = -1; dx <= 1; dx++) set(t.x + dx, y, t.z - 9 + (y - y0), B.AIR);
        for (let dz = -9; dz <= -6; dz++) for (let dx = -1; dx <= 1; dx++) set(t.x + dx, y0, t.z + dz, B.AIR);
        set(t.x - 3, y0 + 3, t.z, I.paper_lantern);
        set(t.x + 3, y0 + 3, t.z, I.paper_lantern);
        // trésor et cage à gribouilles
        set(t.x, y0, t.z + 3, B.CHEST, chestMeta(LOOT.PAPER, 2));
        const sc = MOB_BY_KEY.get('scribble');
        if (sc) set(t.x, y0, t.z, B.SPAWNER, sc.index);
        set(t.x, y0 + 7, t.z, I.paper_lantern);
      }
  }
}
