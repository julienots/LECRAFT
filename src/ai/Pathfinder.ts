/**
 * Recherche de chemin A* sur la grille de blocs (comme la navigation des créatures du jeu
 * original) : marche à plat, montée d'un bloc (saut), descente jusqu'à 3 blocs, nage ; évite la
 * lave, le feu, les cactus et les barrières (trop hautes pour sauter). Les portes, portillons et
 * trappes ouverts se traversent. Nombre de nœuds borné ; si la cible est inaccessible, le chemin
 * mène au point atteignable le plus proche (comportement du jeu original).
 */
import { BlockRegistry, SHAPES } from '../blocks/BlockRegistry';
import { WORLD_HEIGHT } from '../core/Config';

export interface PathWorld {
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
}

export interface PathOptions {
  /** Hauteur de la créature en blocs (arrondie au-dessus). */
  height: number;
  maxNodes?: number;
  maxDrop?: number;
  /** Les créatures qui craignent l'eau l'évitent (coût élevé). */
  waterCost?: number;
}

const SHAPE = (k: string) => SHAPES.indexOf(k as (typeof SHAPES)[number]) + 1;
let OPENABLE: Set<number> | null = null;
let TALL: Set<number> | null = null;
function shapeSets() {
  if (!OPENABLE) {
    OPENABLE = new Set([SHAPE('door'), SHAPE('fence_gate'), SHAPE('trapdoor')]);
    TALL = new Set([SHAPE('fence'), SHAPE('fence_gate')]);
  }
}

/** Cellule traversable (air, plantes, liquides non dangereux, ouvrants ouverts). */
function passable(w: PathWorld, x: number, y: number, z: number): boolean {
  if (y < 0 || y >= WORLD_HEIGHT) return false;
  const b = w.getBlock(x, y, z);
  if (b === 0) return true;
  if (b < 0) return false;
  const R = BlockRegistry;
  if (R.liquid[b] === 2 || R.blocks[b].contactDamage > 0) return false;
  if (!R.solid[b]) return true;
  if (OPENABLE!.has(R.shape[b])) return (w.getMeta(x, y, z) & 4) !== 0;
  return false;
}

/** Sol sur lequel on peut se tenir (pas de barrière : 1,5 bloc, pas de dégâts de contact). */
function support(w: PathWorld, x: number, y: number, z: number): boolean {
  const b = w.getBlock(x, y, z);
  if (b <= 0) return false;
  const R = BlockRegistry;
  if (R.blocks[b].contactDamage > 0 || R.liquid[b] === 2) return false;
  if (TALL!.has(R.shape[b])) return false;
  return R.solid[b] === 1;
}

const isWater = (w: PathWorld, x: number, y: number, z: number) => {
  const b = w.getBlock(x, y, z);
  return b > 0 && BlockRegistry.liquid[b] === 1;
};

/** Position debout valide en (x, y, z) : pieds et tête libres, sol dessous (ou dans l'eau). */
function standable(w: PathWorld, x: number, y: number, z: number, h: number): boolean {
  for (let k = 0; k < h; k++) if (!passable(w, x, y + k, z)) return false;
  return support(w, x, y - 1, z) || isWater(w, x, y, z);
}

// tas binaire minimal sur les indices de nœuds
class Heap {
  private a: number[] = [];
  constructor(private f: Float64Array) {}
  get size() {
    return this.a.length;
  }
  push(i: number) {
    const a = this.a, f = this.f;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[a[p]] <= f[a[k]]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.a, f = this.f;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < a.length && f[a[l]] < f[a[m]]) m = l;
        if (r < a.length && f[a[r]] < f[a[m]]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Chemin de (sx, sy, sz) vers (tx, ty, tz) (coordonnées de blocs, y = bloc des pieds).
 * Retourne la liste des cellules à parcourir (sans la cellule de départ), ou null.
 */
export function findPath(w: PathWorld, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, o: PathOptions): [number, number, number][] | null {
  shapeSets();
  const maxNodes = o.maxNodes ?? 500, maxDrop = o.maxDrop ?? 3, h = Math.max(1, o.height), waterCost = o.waterCost ?? 2;
  if (!standable(w, sx, sy, sz, h)) {
    // départ légèrement décalé (créature en l'air ou dans un bloc bas) : on cherche juste en dessous
    if (standable(w, sx, sy - 1, sz, h)) sy--;
    else if (standable(w, sx, sy + 1, sz, h)) sy++;
  }
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], parent: number[] = [];
  const g = new Float64Array(maxNodes + 16), f = new Float64Array(maxNodes + 16);
  const index = new Map<number, number>();
  const closed = new Uint8Array(maxNodes + 16);
  const key = (x: number, y: number, z: number) => ((x - sx + 512) * 1024 + (z - sz + 512)) * 256 + y;
  const heur = (x: number, y: number, z: number) => {
    const dx = Math.abs(x - tx), dz = Math.abs(z - tz);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + Math.abs(y - ty) * 0.5;
  };
  const add = (x: number, y: number, z: number, from: number, cost: number): number => {
    const k = key(x, y, z);
    const ex = index.get(k);
    if (ex !== undefined) {
      if (!closed[ex] && cost < g[ex]) {
        g[ex] = cost;
        f[ex] = cost + heur(x, y, z);
        parent[ex] = from;
        heap.push(ex);
      }
      return ex;
    }
    if (xs.length >= maxNodes) return -1;
    const i = xs.length;
    xs.push(x);
    ys.push(y);
    zs.push(z);
    parent.push(from);
    g[i] = cost;
    f[i] = cost + heur(x, y, z);
    index.set(k, i);
    heap.push(i);
    return i;
  };
  const heap = new Heap(f);
  add(sx, sy, sz, -1, 0);
  let best = 0, bestH = heur(sx, sy, sz);
  while (heap.size) {
    const i = heap.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    const x = xs[i], y = ys[i], z = zs[i];
    const hh = heur(x, y, z);
    if (hh < bestH) {
      bestH = hh;
      best = i;
    }
    if (x === tx && z === tz && Math.abs(y - ty) <= 1) {
      best = i;
      break;
    }
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      const diag = dx !== 0 && dz !== 0;
      // diagonale : les deux cases adjacentes doivent être libres (pas de coin coupé)
      if (diag && (!standable(w, x + dx, y, z, h) || !standable(w, x, y, z + dz, h))) continue;
      const step = diag ? 1.414 : 1;
      let ny = -1;
      if (standable(w, nx, y, nz, h)) ny = y;
      else if (!diag && standable(w, nx, y + 1, nz, h) && passable(w, x, y + h, z)) ny = y + 1; // saut d'un bloc
      else if (passable(w, nx, y, nz) && passable(w, nx, y + h - 1, nz))
        for (let d = 1; d <= Math.max(maxDrop, 12); d++) {
          // chute de plus de 3 blocs seulement vers de l'eau (sans dégâts)
          if (standable(w, nx, y - d, nz, h) && (d <= maxDrop || isWater(w, nx, y - d, nz))) {
            ny = y - d;
            break;
          }
          if (!passable(w, nx, y - d, nz)) break;
        }
      if (ny < 0) continue;
      const cost = g[i] + step + (ny > y ? 0.5 : 0) + (isWater(w, nx, ny, nz) ? waterCost : 0);
      if (add(nx, ny, nz, i, cost) < 0) break;
    }
  }
  if (best === 0) return null;
  const out: [number, number, number][] = [];
  for (let i = best; i > 0; i = parent[i]) out.push([xs[i], ys[i], zs[i]]);
  return out.reverse();
}
