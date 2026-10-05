/**
 * Constructeurs d'arbres partagés par la génération (worker) et la pousse des pousses (jeu).
 * Ils écrivent via une fonction set() fournie : aucune dépendance au stockage.
 */
import type { TreeType } from '../data/biomes';
import { B } from '../blocks/BlockRegistry';
import { Rng } from '../util/math';

export type SetFn = (x: number, y: number, z: number, block: number, onlyIfAir?: boolean) => void;

function blob(set: SetFn, cx: number, cy: number, cz: number, r: number, leaf: number, rng: Rng, squash = 1) {
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++)
    for (let dz = -ri; dz <= ri; dz++)
      for (let dx = -ri; dx <= ri; dx++) {
        const d = (dx * dx + dz * dz) / (r * r) + (dy * dy) / (r * r * squash * squash);
        if (d <= 1 && !(d > 0.75 && rng.next() < 0.35)) set(cx + dx, cy + dy, cz + dz, leaf, true);
      }
}

export function buildTree(type: TreeType, x: number, y: number, z: number, seed: number, set: SetFn) {
  const rng = new Rng(seed);
  switch (type) {
    case 'oak':
    case 'swamp_oak': {
      const h = rng.int(4, 6);
      const leaf = B.OAK_LEAVES;
      for (let dy = h - 3; dy <= h + 1; dy++) {
        const r = dy >= h ? 1 : 2;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && (dy >= h || rng.next() < 0.5)) continue;
            set(x + dx, y + dy, z + dz, leaf, true);
          }
      }
      if (type === 'swamp_oak')
        for (let i = 0; i < 6; i++) {
          const dx = rng.int(-2, 2), dz = rng.int(-2, 2);
          for (let dy = h - 4; dy < h - 2; dy++) set(x + dx, y + dy, z + dz, leaf, true);
        }
      for (let dy = 0; dy < h; dy++) set(x, y + dy, z, B.OAK_LOG);
      break;
    }
    case 'big_oak': {
      const h = rng.int(7, 10);
      for (let dy = 0; dy < h; dy++) set(x, y + dy, z, B.OAK_LOG);
      blob(set, x, y + h - 1, z, 3.2, B.OAK_LEAVES, rng, 0.8);
      for (let b = 0; b < 3; b++) {
        const dx = rng.int(-2, 2), dz = rng.int(-2, 2), by = y + h - 3 - b;
        set(x + Math.sign(dx), by, z + Math.sign(dz), B.OAK_LOG);
        blob(set, x + dx, by + 1, z + dz, 2, B.OAK_LEAVES, rng, 0.8);
      }
      break;
    }
    case 'birch': {
      const h = rng.int(5, 7);
      for (let dy = h - 3; dy <= h + 1; dy++) {
        const r = dy >= h ? 1 : 2;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r) continue;
            set(x + dx, y + dy, z + dz, B.BIRCH_LEAVES, true);
          }
      }
      for (let dy = 0; dy < h; dy++) set(x, y + dy, z, B.BIRCH_LOG);
      break;
    }
    case 'spruce': {
      const h = rng.int(7, 11);
      let r = 0;
      for (let dy = h; dy >= 2; dy--) {
        const rr = Math.min(3, r);
        for (let dz = -rr; dz <= rr; dz++)
          for (let dx = -rr; dx <= rr; dx++) if (Math.abs(dx) + Math.abs(dz) <= rr + (rr > 1 ? 1 : 0)) set(x + dx, y + dy, z + dz, B.SPRUCE_LEAVES, true);
        r = (h - dy) % 3 === 2 ? Math.max(1, r - 1) : r + 1;
      }
      set(x, y + h + 1, z, B.SPRUCE_LEAVES, true);
      for (let dy = 0; dy < h; dy++) set(x, y + dy, z, B.SPRUCE_LOG);
      break;
    }
    case 'jungle': {
      const h = rng.int(9, 15);
      for (let dy = 0; dy < h; dy++) set(x, y + dy, z, B.JUNGLE_LOG);
      blob(set, x, y + h, z, 3.5, B.JUNGLE_LEAVES, rng, 0.55);
      for (let b = 0; b < 2; b++) {
        const by = y + rng.int(4, h - 3);
        const dx = rng.pick([-2, 2]), dz = rng.pick([-2, 2]);
        set(x + Math.sign(dx), by, z + Math.sign(dz), B.JUNGLE_LOG);
        blob(set, x + dx, by + 1, z + dz, 2, B.JUNGLE_LEAVES, rng, 0.6);
      }
      break;
    }
    case 'acacia': {
      const h = rng.int(4, 6);
      const dx = rng.pick([-1, 1]), dz = rng.pick([-1, 0, 1]);
      let tx = x, tz = z;
      for (let dy = 0; dy < h; dy++) {
        if (dy >= h - 2) {
          tx += dx;
          tz += dz;
        }
        set(tx, y + dy, tz, B.ACACIA_LOG);
      }
      const top = y + h;
      for (let ddz = -3; ddz <= 3; ddz++)
        for (let ddx = -3; ddx <= 3; ddx++) if (Math.abs(ddx) + Math.abs(ddz) <= 4) set(tx + ddx, top, tz + ddz, B.ACACIA_LEAVES, true);
      for (let ddz = -1; ddz <= 1; ddz++) for (let ddx = -1; ddx <= 1; ddx++) set(tx + ddx, top + 1, tz + ddz, B.ACACIA_LEAVES, true);
      break;
    }
    case 'dark_oak': {
      // tronc 2x2 et canopée large et basse
      const h = rng.int(6, 8);
      for (let dy = 0; dy < h; dy++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(x + dx, y + dy, z + dz, B.DARK_OAK_LOG);
      for (let dy = h - 3; dy <= h + 1; dy++) {
        const r = dy > h ? 2 : 4 - (dy === h - 3 ? 1 : 0);
        for (let dz = -r; dz <= r + 1; dz++)
          for (let dx = -r; dx <= r + 1; dx++) {
            if ((dx === -r || dx === r + 1) && (dz === -r || dz === r + 1)) continue;
            if (rng.next() < 0.08) continue;
            set(x + dx, y + dy, z + dz, B.DARK_OAK_LEAVES, true);
          }
      }
      break;
    }
    case 'cactus': {
      const h = rng.int(1, 3);
      for (let dy = 0; dy < h; dy++) set(x, y + dy, z, B.CACTUS);
      break;
    }
  }
}

/** Rayon horizontal maximal d'un arbre (pour la génération inter-chunks). */
export const TREE_MAX_RADIUS = 4;
