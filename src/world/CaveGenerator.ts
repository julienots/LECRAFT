import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../core/Config';
import { B } from '../blocks/BlockRegistry';
import { SimplexNoise } from './Noise';
import { idx, type ChunkData } from './ChunkData';
import { hash3, Rng } from '../util/math';

const STEP = 4;
const NX = CHUNK_SIZE / STEP + 1;
const NY = WORLD_HEIGHT / STEP + 1;

/**
 * Grottes procédurales : salles (« fromage »), grands tunnels (« spaghetti »), petits tunnels,
 * gouffres, lacs souterrains d'eau et de lave, végétation souterraine.
 * Le bruit 3D est échantillonné sur une grille 4x4x4 puis interpolé (rapide sur mobile).
 */
export class CaveGenerator {
  private cheese: SimplexNoise;
  private spagA: SimplexNoise;
  private spagB: SimplexNoise;
  private noodA: SimplexNoise;
  private noodB: SimplexNoise;
  private aquifer: SimplexNoise;
  private ravine: SimplexNoise;
  private lush: SimplexNoise;
  private grid = new Float32Array(NX * NX * NY * 5);

  constructor(private seed: number) {
    this.cheese = new SimplexNoise(seed + 101);
    this.spagA = new SimplexNoise(seed + 102);
    this.spagB = new SimplexNoise(seed + 103);
    this.noodA = new SimplexNoise(seed + 104);
    this.noodB = new SimplexNoise(seed + 105);
    this.aquifer = new SimplexNoise(seed + 106);
    this.ravine = new SimplexNoise(seed + 107);
    this.lush = new SimplexNoise(seed + 108);
  }

  private sampleGrid(bx: number, bz: number) {
    const g = this.grid;
    let i = 0;
    for (let gy = 0; gy < NY; gy++)
      for (let gz = 0; gz < NX; gz++)
        for (let gx = 0; gx < NX; gx++) {
          const x = bx + gx * STEP, y = gy * STEP, z = bz + gz * STEP;
          g[i++] = this.cheese.noise3(x / 64, y / 32, z / 64);
          g[i++] = this.spagA.noise3(x / 48, y / 28, z / 48);
          g[i++] = this.spagB.noise3(x / 48 + 50, y / 28, z / 48);
          g[i++] = this.noodA.noise3(x / 22, y / 16, z / 22);
          g[i++] = this.noodB.noise3(x / 22 + 90, y / 16, z / 22);
        }
  }

  private interp(x: number, y: number, z: number, out: Float32Array) {
    const fx = x / STEP, fy = y / STEP, fz = z / STEP;
    const x0 = Math.min(NX - 2, fx | 0), y0 = Math.min(NY - 2, fy | 0), z0 = Math.min(NX - 2, fz | 0);
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const g = this.grid;
    for (let n = 0; n < 5; n++) {
      const at = (ix: number, iy: number, iz: number) => g[((iy * NX + iz) * NX + ix) * 5 + n];
      const c00 = at(x0, y0, z0) * (1 - tx) + at(x0 + 1, y0, z0) * tx;
      const c10 = at(x0, y0 + 1, z0) * (1 - tx) + at(x0 + 1, y0 + 1, z0) * tx;
      const c01 = at(x0, y0, z0 + 1) * (1 - tx) + at(x0 + 1, y0, z0 + 1) * tx;
      const c11 = at(x0, y0 + 1, z0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1, z0 + 1) * tx;
      const c0 = c00 * (1 - ty) + c10 * ty;
      const c1 = c01 * (1 - ty) + c11 * ty;
      out[n] = c0 * (1 - tz) + c1 * tz;
    }
  }

  carve(c: ChunkData, heights: Int16Array) {
    const bx = c.cx * CHUNK_SIZE, bz = c.cz * CHUNK_SIZE;
    this.sampleGrid(bx, bz);
    const v = new Float32Array(5);
    const blocks = c.blocks;
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = heights[x + z * CHUNK_SIZE];
        const wx = bx + x, wz = bz + z;
        const underwater = h < SEA_LEVEL;
        const aq = this.aquifer.noise2(wx / 90, wz / 90) > 0.5;
        // Gouffres
        const rmask = this.ravine.noise2(wx / 500, wz / 500);
        let ravineBottom = 999;
        if (rmask > 0.3 && !underwater) {
          const rv = Math.abs(this.ravine.noise2(wx / 150 + 77, wz / 150));
          if (rv < 0.02) ravineBottom = Math.max(8, Math.round(h - 34 * (1 - rv / 0.02) - 6));
        }
        for (let y = 3; y <= h; y++) {
          const depth = h - y;
          let carve = y >= ravineBottom;
          if (!carve) {
            this.interp(x, y, z, v);
            const thr = 0.6 - Math.min(0.16, Math.max(0, (40 - y) / 120));
            if (v[0] > thr && depth > 7) carve = true;
            else if (v[1] * v[1] + v[2] * v[2] < 0.005 && (underwater ? depth > 7 : depth > 0 || y > SEA_LEVEL)) carve = true;
            else if (y < 70 && depth > 4 && v[3] * v[3] + v[4] * v[4] < 0.0016) carve = true;
          }
          if (!carve) continue;
          const i = idx(x, y, z);
          if (blocks[i] === B.WATER || blocks[i] === B.BEDROCK) continue;
          if (y <= 10) blocks[i] = B.LAVA;
          else if (aq && y < 30 && depth > 8) blocks[i] = B.WATER;
          else blocks[i] = B.AIR;
        }
      }
  }

  /** Végétation et éléments rares des grottes (après le creusement). */
  decorate(c: ChunkData, heights: Int16Array) {
    const bx = c.cx * CHUNK_SIZE, bz = c.cz * CHUNK_SIZE;
    const rng = new Rng(hash3(this.seed, c.cx, 77, c.cz));
    const blocks = c.blocks;
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = heights[x + z * CHUNK_SIZE];
        const lush = this.lush.noise3((bx + x) / 40, 0, (bz + z) / 40) > 0.45;
        for (let y = 4; y < h - 6; y++) {
          const i = idx(x, y, z);
          if (blocks[i] !== B.AIR) continue;
          const below = blocks[idx(x, y - 1, z)];
          if (below === B.STONE) {
            if (lush) {
              blocks[idx(x, y - 1, z)] = B.MOSS_BLOCK;
              if (rng.next() < 0.05) blocks[i] = B.GLOW_LICHEN;
              else if (rng.next() < 0.03) blocks[i] = B.SHORT_GRASS;
            } else if (rng.next() < 0.004) blocks[i] = B.GLOW_LICHEN;
            else if (rng.next() < 0.003) blocks[i] = rng.next() < 0.5 ? B.BROWN_MUSHROOM : B.RED_MUSHROOM;
          }
          if (y < 28 && rng.next() < 0.0015) {
            // Petite géode d'améthyste (structure rare)
            for (let k = 0; k < 4; k++) {
              const ox = x + rng.int(-1, 1), oy = y + rng.int(-1, 1), oz = z + rng.int(-1, 1);
              if (ox >= 0 && ox < 16 && oz >= 0 && oz < 16 && oy > 2) {
                const j = idx(ox, oy, oz);
                if (blocks[j] === B.STONE) {
                  blocks[j] = B.AMETHYST_BLOCK;
                  const up = idx(ox, oy + 1, oz);
                  if (oy + 1 < WORLD_HEIGHT && blocks[up] === B.AIR && rng.next() < 0.5) blocks[up] = B.AMETHYST_CLUSTER;
                }
              }
            }
          }
        }
      }
  }
}
