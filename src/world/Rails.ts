/**
 * Raccordement automatique des rails (comme le jeu original) : chaque rail prend la forme qui
 * le relie à ses voisins — ligne droite, montée vers un rail plus haut, virage (rail simple
 * seulement). Méta = forme : 0 nord-sud, 1 est-ouest, 2 montée est, 3 montée ouest, 4 montée
 * nord, 5 montée sud, 6 virage sud-est, 7 sud-ouest, 8 nord-ouest, 9 nord-est.
 */
import { BlockRegistry } from '../blocks/BlockRegistry';
import type { World } from './World';

const RAILS = /^(rail|powered_rail|detector_rail|activator_rail)(_on)?$/;
export const isRailKey = (k: string) => RAILS.test(k);
const isRail = (w: World, x: number, y: number, z: number) => {
  const id = w.getBlock(x, y, z);
  return id > 0 && RAILS.test(BlockRegistry.get(id).key);
};

/** Directions : nord (-z), sud (+z), ouest (-x), est (+x). */
const DIRS = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] } as const;
type Dir = keyof typeof DIRS;

/** Voisins reliés : au même niveau, un cran plus haut (montée) ou plus bas. */
function connections(w: World, x: number, y: number, z: number): { d: Dir; up: boolean }[] {
  const out: { d: Dir; up: boolean }[] = [];
  for (const d of Object.keys(DIRS) as Dir[]) {
    const [dx, dz] = DIRS[d];
    if (isRail(w, x + dx, y, z + dz)) out.push({ d, up: false });
    else if (isRail(w, x + dx, y + 1, z + dz)) out.push({ d, up: true });
    else if (isRail(w, x + dx, y - 1, z + dz)) out.push({ d, up: false });
  }
  return out;
}

const UP: Record<Dir, number> = { e: 2, w: 3, n: 4, s: 5 };
const CURVE: Record<string, number> = { se: 6, es: 6, sw: 7, ws: 7, nw: 8, wn: 8, ne: 9, en: 9 };

/** Forme d'un rail selon ses voisins (null : aucun voisin, la forme actuelle reste). */
export function railShape(w: World, x: number, y: number, z: number, curves: boolean): number | null {
  const c = connections(w, x, y, z);
  if (!c.length) return null;
  const has = (d: Dir) => c.find((k) => k.d === d);
  // ligne droite (montée si l'un des deux côtés est plus haut)
  for (const [a, b, flat] of [['n', 's', 0], ['e', 'w', 1]] as [Dir, Dir, number][]) {
    if (has(a) && has(b)) return has(a)!.up ? UP[a] : has(b)!.up ? UP[b] : flat;
  }
  if (curves && c.length >= 2) {
    const ns = c.find((k) => k.d === 'n' || k.d === 's'), ew = c.find((k) => k.d === 'e' || k.d === 'w');
    if (ns && ew) return CURVE[ns.d + ew.d];
  }
  const one = c[0];
  if (one.up) return UP[one.d];
  return one.d === 'n' || one.d === 's' ? 0 : 1;
}

/** Recalcule la forme du rail en (x, y, z) et de ses voisins (après pose ou casse). */
export function updateRailsAround(w: World, x: number, y: number, z: number) {
  const fix = (px: number, py: number, pz: number) => {
    const id = w.getBlock(px, py, pz);
    if (id <= 0) return;
    const key = BlockRegistry.get(id).key;
    if (!RAILS.test(key)) return;
    const shape = railShape(w, px, py, pz, key === 'rail');
    if (shape !== null && shape !== w.getMeta(px, py, pz)) w.setBlock(px, py, pz, id, shape, false);
  };
  fix(x, y, z);
  for (const [dx, dz] of Object.values(DIRS)) for (const dy of [-1, 0, 1]) fix(x + dx, y + dy, z + dz);
}
