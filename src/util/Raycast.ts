import { BlockRegistry } from '../blocks/BlockRegistry';
import { modelBoxes } from '../blocks/Shapes';
import type { World } from '../world/World';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  /** Normale de la face touchée. */
  nx: number;
  ny: number;
  nz: number;
  block: number;
  distance: number;
  /** Point d'impact (monde). */
  px: number;
  py: number;
  pz: number;
}

/**
 * Lancer de rayon voxel (DDA d'Amanatides & Woo).
 * Ignore l'air et les liquides ; les blocs à forme sont testés contre leurs boîtes réelles.
 */
export function raycastBlocks(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, hitLiquids = false): RayHit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const b = world.getBlock(x, y, z);
    if (b > 0) {
      const liquid = BlockRegistry.liquid[b];
      if (!liquid || hitLiquids) {
        if (BlockRegistry.shape[b]) {
          // test précis contre les boîtes de la forme
          const meta = world.getMeta(x, y, z);
          const boxes = modelBoxes(b, meta, (ddx, ddy, ddz) => Math.max(0, world.getBlock(x + ddx, y + ddy, z + ddz)));
          let best = Infinity, bn: [number, number, number] = [0, 0, 0];
          for (const bx of boxes) {
            const r = rayAABBNormal(ox, oy, oz, dx, dy, dz, x + bx[0] / 16, y + bx[1] / 16, z + bx[2] / 16, x + bx[3] / 16, y + bx[4] / 16, z + bx[5] / 16);
            if (r && r.t < best) {
              best = r.t;
              bn = r.n;
            }
          }
          if (best <= maxDist) return { x, y, z, nx: bn[0], ny: bn[1], nz: bn[2], block: b, distance: best, px: ox + dx * best, py: oy + dy * best, pz: oz + dz * best };
        } else return { x, y, z, nx, ny, nz, block: b, distance: t, px: ox + dx * t, py: oy + dy * t, pz: oz + dz * t };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

/** Intersection rayon / AABB avec normale de la face d'entrée. */
export function rayAABBNormal(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): { t: number; n: [number, number, number] } | null {
  let tmin = -Infinity, tmax = Infinity;
  let n: [number, number, number] = [0, 0, 0];
  const axes: [number, number, number, number][] = [[ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ]];
  for (let a = 0; a < 3; a++) {
    const [o, d, mn, mx] = axes[a];
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return null;
      continue;
    }
    let t1 = (mn - o) / d, t2 = (mx - o) / d;
    let sign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      n = [0, 0, 0];
      n[a] = sign;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), n };
}

/** Intersection rayon / AABB (méthode des slabs). Retourne la distance ou -1. */
export function rayAABB(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  const r = rayAABBNormal(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ);
  return r ? r.t : -1;
}
