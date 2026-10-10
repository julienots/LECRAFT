/**
 * Spéléothèmes pointus (comme le jeu original) : une colonne de « pointed_dripstone » est
 * dessinée par segments — base (côté accroché), milieu, tronc, pointe — vers le bas
 * (stalactite) ou vers le haut (stalagmite). Méta : bit 2 = vers le haut, bits 0-1 = segment
 * (0 pointe, 1 tronc, 2 milieu, 3 base) ; les textures sont dans cet ordre (byMeta).
 */
import { BlockRegistry } from '../blocks/BlockRegistry';
import type { World } from './World';

/** Segment selon la position depuis la base (0) dans une colonne de `len` blocs. */
export function dripSegment(fromBase: number, len: number): number {
  const fromTip = len - 1 - fromBase;
  if (fromTip === 0) return 0;
  if (fromTip === 1) return 1;
  return fromBase === 0 ? 3 : 2;
}

const pd = () => (BlockRegistry.has('pointed_dripstone') ? BlockRegistry.byName('pointed_dripstone').id : -1);

/** Recalcule les segments de la colonne de spéléothèmes qui passe par (x, y, z). */
export function updateDripstoneColumn(w: World, x: number, y: number, z: number) {
  const id = pd();
  if (id < 0) return;
  for (const start of [y, y - 1, y + 1]) {
    if (w.getBlock(x, start, z) !== id) continue;
    let top = start, bottom = start;
    while (w.getBlock(x, top + 1, z) === id) top++;
    while (w.getBlock(x, bottom - 1, z) === id) bottom--;
    // accroché au plafond : stalactite ; posé au sol : stalagmite ; sinon garde son sens
    const hang = w.isSolid(x, top + 1, z);
    const stand = w.isSolid(x, bottom - 1, z);
    const up = stand && !hang ? true : hang ? false : (w.getMeta(x, bottom, z) & 4) !== 0;
    const len = top - bottom + 1;
    for (let yy = bottom; yy <= top; yy++) {
      const fromBase = up ? yy - bottom : top - yy;
      const m = (up ? 4 : 0) | dripSegment(fromBase, len);
      if (w.getMeta(x, yy, z) !== m) w.setBlock(x, yy, z, id, m, false);
    }
  }
}
