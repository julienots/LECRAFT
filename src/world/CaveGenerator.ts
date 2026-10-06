import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../core/Config';
import { B, BlockRegistry } from '../blocks/BlockRegistry';
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
        // grottes luxuriantes : mares d'eau au lieu de lave au fond
        const lushCol = this.lush.noise3(wx / 70, 0, wz / 70) > 0.38;
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
          if (y <= 7) blocks[i] = lushCol ? (y <= 5 ? B.WATER : B.AIR) : B.LAVA;
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
    const I = this.ids();
    const rock = (b: number) => b === B.STONE || b === I.deepslate || b === B.ANDESITE || b === B.DIORITE || b === B.GRANITE || b === I.tuff;
    const at = (x: number, y: number, z: number) => (y < 0 || y >= WORLD_HEIGHT ? B.BEDROCK : blocks[idx(x, y, z)]);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = heights[x + z * CHUNK_SIZE];
        const wx = bx + x, wz = bz + z;
        // régions : grottes luxuriantes (humides) et grottes de spéléothèmes (sèches), comme les biomes souterrains
        const lushV = this.lush.noise3(wx / 70, 0, wz / 70);
        const dripV = this.lush.noise3(wx / 70 + 300, 5, wz / 70 - 300);
        const lush = lushV > 0.38, drip = !lush && dripV > 0.38;
        for (let y = 4; y < h - 6; y++) {
          const i = idx(x, y, z);
          if (blocks[i] !== B.AIR) continue;
          const below = at(x, y - 1, z), above = at(x, y + 1, z);
          const floor = rock(below), ceil = rock(above);
          if (lush) {
            if (floor) {
              const r = rng.next();
              if (r < 0.04 && I.clay) blocks[idx(x, y - 1, z)] = B.CLAY;
              else blocks[idx(x, y - 1, z)] = B.MOSS_BLOCK;
              const r2 = rng.next();
              if (r2 < 0.08) blocks[i] = B.SHORT_GRASS;
              else if (r2 < 0.1 && I.azalea) blocks[i] = I.azalea;
              else if (r2 < 0.13) blocks[i] = B.GLOW_LICHEN;
            } else if (ceil) {
              const r = rng.next();
              if (r < 0.1 && I.cave_vines) {
                // lianes pendantes (baies lumineuses sur ~1/3 des segments)
                const len = 1 + rng.int(0, 5);
                for (let k = 0; k < len && y - k > 3 && at(x, y - k, z) === B.AIR; k++) blocks[idx(x, y - k, z)] = rng.next() < 0.33 && I.cave_vines_lit ? I.cave_vines_lit : I.cave_vines;
              } else if (r < 0.11 && I.spore_blossom) blocks[i] = I.spore_blossom;
              else if (r < 0.14 && I.hanging_roots) blocks[i] = I.hanging_roots;
              else if (r < 0.3) blocks[idx(x, y + 1, z)] = B.MOSS_BLOCK;
            }
          } else if (drip && I.dripstone_block) {
            // blocs de spéléothème autour des cavités, stalactites et stalagmites
            if (floor && rng.next() < 0.6) blocks[idx(x, y - 1, z)] = I.dripstone_block;
            if (ceil && rng.next() < 0.6) blocks[idx(x, y + 1, z)] = I.dripstone_block;
            if (I.pointed_dripstone) {
              if (ceil && rng.next() < 0.12) {
                const len = 1 + rng.int(0, 2);
                for (let k = 0; k < len && at(x, y - k, z) === B.AIR; k++) blocks[idx(x, y - k, z)] = I.pointed_dripstone;
              } else if (floor && rng.next() < 0.08) {
                const len = 1 + rng.int(0, 2);
                for (let k = 0; k < len && at(x, y + k, z) === B.AIR; k++) blocks[idx(x, y + k, z)] = I.pointed_dripstone;
              }
            }
          } else if (floor) {
            const r = rng.next();
            if (r < 0.004) blocks[i] = B.GLOW_LICHEN;
            else if (r < 0.007) blocks[i] = rng.next() < 0.5 ? B.BROWN_MUSHROOM : B.RED_MUSHROOM;
          }
        }
      }
    this.geodes(c);
  }

  private _ids: Record<string, number> | null = null;
  /** Identifiants des blocs supplémentaires (0 si absents : la décoration correspondante est omise). */
  private ids(): Record<string, number> {
    if (this._ids) return this._ids;
    const get = (k: string) => (BlockRegistry.has(k) ? BlockRegistry.byName(k).id : 0);
    this._ids = Object.fromEntries(['deepslate', 'tuff', 'clay', 'azalea', 'cave_vines', 'cave_vines_lit', 'spore_blossom', 'hanging_roots', 'dripstone_block', 'pointed_dripstone', 'smooth_basalt', 'calcite', 'budding_amethyst'].map((k) => [k, get(k)]));
    return this._ids;
  }

  /**
   * Géodes d'améthyste : sphères creuses (basalte lisse, calcite, améthyste, améthyste
   * bourgeonnante et grappes vers l'intérieur). Une géode peut déborder sur les chunks voisins :
   * chaque chunk examine les centres des chunks alentour.
   */
  private geodes(c: ChunkData) {
    const I = this.ids();
    if (!I.calcite || !I.smooth_basalt) return;
    const blocks = c.blocks;
    const bx = c.cx * CHUNK_SIZE, bz = c.cz * CHUNK_SIZE;
    for (let dcx = -1; dcx <= 1; dcx++)
      for (let dcz = -1; dcz <= 1; dcz++) {
        const gcx = c.cx + dcx, gcz = c.cz + dcz;
        const h = hash3(this.seed + 404, gcx, 9, gcz);
        if (h % 24 !== 0) continue; // ~1 chunk sur 24
        const r = new Rng(h);
        const cx = gcx * CHUNK_SIZE + r.int(4, 11), cy = r.int(8, 40), cz = gcz * CHUNK_SIZE + r.int(4, 11);
        const R = 4 + r.next() * 1.5;
        for (let z = 0; z < CHUNK_SIZE; z++)
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const ddx = bx + x - cx, ddz = bz + z - cz;
            if (Math.abs(ddx) > R + 2 || Math.abs(ddz) > R + 2) continue;
            for (let y = Math.max(2, Math.floor(cy - R - 2)); y <= Math.min(WORLD_HEIGHT - 2, cy + R + 2); y++) {
              const d = Math.hypot(ddx, (y - cy) * 1.1, ddz) + (hash3(this.seed, bx + x, y, bz + z) & 255) / 512;
              if (d > R + 1) continue;
              const i = idx(x, y, z);
              if (blocks[i] === B.BEDROCK) continue;
              let b: number;
              if (d > R) b = I.smooth_basalt;
              else if (d > R - 0.8) b = I.calcite;
              else if (d > R - 1.7) b = I.budding_amethyst && (hash3(this.seed + 5, bx + x, y, bz + z) & 15) === 0 ? I.budding_amethyst : B.AMETHYST_BLOCK;
              else b = B.AIR;
              if (blocks[i] === B.AIR && b !== B.AIR) continue; // ne bouche pas les grottes
              blocks[i] = b;
            }
          }
        // grappes d'améthyste sur les blocs bourgeonnants (vers l'intérieur)
        for (let z = 0; z < CHUNK_SIZE; z++)
          for (let x = 0; x < CHUNK_SIZE; x++)
            for (let y = Math.max(3, Math.floor(cy - R)); y <= Math.min(WORLD_HEIGHT - 3, cy + R); y++) {
              if (blocks[idx(x, y, z)] !== B.AIR) continue;
              const ddx = bx + x - cx, ddz = bz + z - cz;
              if (Math.hypot(ddx, (y - cy) * 1.1, ddz) > R - 1.2) continue;
              const nb = [blocks[idx(x, y - 1, z)], blocks[idx(x, y + 1, z)]];
              if (nb.includes(I.budding_amethyst) && (hash3(this.seed + 6, bx + x, y, bz + z) & 1) === 0) blocks[idx(x, y, z)] = B.AMETHYST_CLUSTER;
            }
      }
  }
}
