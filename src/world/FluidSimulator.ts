import { BlockRegistry, B } from '../blocks/BlockRegistry';
import type { World } from './World';

const FALLING = 8;
const WATER_DELAY = 5; // ticks
const LAVA_DELAY = 30;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Liquides voxel simplifiés (automate cellulaire, pas de physique lourde) :
 * méta 0 = source, 1..7 = distance d'écoulement, 8 = chute.
 * L'eau s'étend sur 7 blocs, la lave sur 3 (plus lentement). Deux sources d'eau
 * adjacentes créent une nouvelle source. Eau + lave → obsidienne (source) ou pierre brute.
 */
export class FluidSimulator {
  private scheduled = new Map<string, number>();
  private tickCount = 0;
  budget = 160;

  schedule(x: number, y: number, z: number, id: number) {
    const k = `${x},${y},${z}`;
    if (this.scheduled.has(k)) return;
    this.scheduled.set(k, this.tickCount + (id === B.LAVA ? LAVA_DELAY : WATER_DELAY));
  }

  get pending() {
    return this.scheduled.size;
  }

  tick(world: World) {
    this.tickCount++;
    let n = 0;
    for (const [k, t] of this.scheduled) {
      if (t > this.tickCount) continue;
      this.scheduled.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      this.update(world, x, y, z);
      if (++n >= this.budget) break;
    }
  }

  private canFlowInto(world: World, x: number, y: number, z: number, liquid: number, level: number): boolean {
    const id = world.getBlock(x, y, z);
    if (id < 0) return false;
    if (id === liquid) {
      const m = world.getMeta(x, y, z);
      return m !== 0 && m !== FALLING && m > level;
    }
    return BlockRegistry.replaceable[id] === 1 && !BlockRegistry.liquid[id] || id === B.AIR;
  }

  update(world: World, x: number, y: number, z: number) {
    const id = world.getBlock(x, y, z);
    if (id !== B.WATER && id !== B.LAVA) return;
    const lava = id === B.LAVA;
    const step = lava ? 2 : 1;
    const max = lava ? 6 : 7;
    let meta = world.getMeta(x, y, z);

    // interactions eau/lave
    if (lava) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        if (world.getBlock(x + dx, y + dy, z + dz) === B.WATER) {
          world.setBlock(x, y, z, meta === 0 ? B.OBSIDIAN : B.COBBLESTONE);
          return;
        }
      }
    }

    if (meta !== 0) {
      // recalcule le niveau à partir des voisins
      let newMeta: number;
      if (world.getBlock(x, y + 1, z) === id) newMeta = FALLING;
      else {
        let best = 99;
        let sources = 0;
        for (const [dx, dz] of DIRS) {
          const n = world.getBlock(x + dx, y, z + dz);
          if (n !== id) continue;
          const m = world.getMeta(x + dx, y, z + dz);
          if (m === 0) sources++;
          const eff = m === FALLING ? 0 : m;
          if (eff < best) best = eff;
        }
        newMeta = best + step;
        if (!lava && sources >= 2) {
          const below = world.getBlock(x, y - 1, z);
          if (BlockRegistry.solid[Math.max(0, below)] || (below === B.WATER && world.getMeta(x, y - 1, z) === 0)) newMeta = 0;
        }
        if (newMeta > max) {
          world.setBlock(x, y, z, B.AIR);
          return;
        }
      }
      if (newMeta !== meta) {
        world.setBlock(x, y, z, id, newMeta);
        meta = newMeta;
      }
    }

    // écoulement vers le bas
    const below = world.getBlock(x, y - 1, z);
    if (below >= 0 && y > 0) {
      if (below === B.AIR || (BlockRegistry.replaceable[below] && !BlockRegistry.liquid[below])) {
        world.setBlock(x, y - 1, z, id, FALLING);
        return;
      }
      if (!lava && below === B.LAVA) {
        world.setBlock(x, y - 1, z, world.getMeta(x, y - 1, z) === 0 ? B.OBSIDIAN : B.COBBLESTONE);
        return;
      }
      if (below === id && world.getMeta(x, y - 1, z) !== 0) return;
    }
    // écoulement horizontal
    const eff = meta === FALLING ? 0 : meta;
    const next = eff + step;
    if (next > max) return;
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      const nid = world.getBlock(nx, y, nz);
      if (!lava && nid === B.LAVA) {
        world.setBlock(nx, y, nz, world.getMeta(nx, y, nz) === 0 ? B.OBSIDIAN : B.COBBLESTONE);
        continue;
      }
      if (this.canFlowInto(world, nx, y, nz, id, next)) world.setBlock(nx, y, nz, id, next);
    }
  }
}
