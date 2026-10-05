/**
 * Formes des blocs non cubiques, en pixels (1/16 de bloc) : [x0, y0, z0, x1, y1, z1].
 * Utilisées par le mesher (rendu), la physique (collisions) et le raycast (contour visé).
 *
 * Convention de la méta « orientation » (2 bits) : 0 sud (+Z), 1 ouest (-X), 2 nord (-Z), 3 est (+X).
 * Les formes sont décrites pour l'orientation nord puis tournées.
 */
import { BlockRegistry, SHAPES } from './BlockRegistry';

export type Box = [number, number, number, number, number, number];
export type NeighborFn = (dx: number, dy: number, dz: number) => number;

export const FULL: Box = [0, 0, 0, 16, 16, 16];
/** Pas de rotation (quarts de tour horaires) selon l'orientation : nord 0, est 1, sud 2, ouest 3. */
const STEPS = [2, 3, 0, 1];
export const FACING_DIR: [number, number][] = [
  [0, 1], // 0 sud
  [-1, 0], // 1 ouest
  [0, -1], // 2 nord
  [1, 0], // 3 est
];

/** Rotation horaire (vue de dessus) d'une boîte autour du centre du bloc. */
export function rotate(b: Box, facing: number): Box {
  let [x0, y0, z0, x1, y1, z1] = b;
  for (let i = 0; i < STEPS[facing & 3]; i++) {
    const nx0 = 16 - z1, nx1 = 16 - z0, nz0 = x0, nz1 = x1;
    x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1;
  }
  return [x0, y0, z0, x1, y1, z1];
}

/** Orientation correspondant à la direction regardée par le joueur (yaw : 0 = regarde vers -Z). */
export function facingFromYaw(yaw: number): number {
  const a = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4; // 0 -Z, 1 -X, 2 +Z, 3 +X
  return [2, 1, 0, 3][a];
}
export const opposite = (f: number) => (f + 2) & 3;

function connects(id: number, kind: 'fence' | 'pane'): boolean {
  if (id <= 0) return false;
  const R = BlockRegistry;
  if (R.opaque[id]) return true;
  const s = R.shape[id];
  if (kind === 'fence') return s === SHAPES.indexOf('fence') + 1;
  return s === SHAPES.indexOf('pane') + 1 || R.blocks[id].key === 'glass';
}

/** Boîtes de rendu (aussi utilisées comme contour). */
export function modelBoxes(id: number, meta: number, nb: NeighborFn): Box[] {
  const kind = SHAPES[BlockRegistry.shape[id] - 1];
  const f = meta & 3;
  switch (kind) {
    case 'slab':
      return meta === 2 ? [FULL] : meta === 1 ? [[0, 8, 0, 16, 16, 16]] : [[0, 0, 0, 16, 8, 16]];
    case 'stairs': {
      const up = (meta & 4) !== 0;
      const base: Box = up ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
      const step: Box = up ? [0, 0, 0, 16, 8, 8] : [0, 8, 0, 16, 16, 8];
      return [base, rotate(step, f)];
    }
    case 'door': {
      const open = (meta & 4) !== 0;
      // fermée : panneau du côté opposé à la direction regardée ; ouverte : pivotée d'un quart de tour
      // bit 16 : charnière à droite (la porte ouverte se range contre l'autre montant)
      const right = (meta & 16) !== 0;
      return [rotate(open ? (right ? [13, 0, 0, 16, 16, 16] : [0, 0, 0, 3, 16, 16]) : [0, 0, 13, 16, 16, 16], f)];
    }
    case 'ladder':
      return [rotate([0, 0, 0, 16, 16, 1], f)];
    case 'torch': {
      if (meta === 0) return [[7, 0, 7, 9, 10, 9]];
      // torche murale : méta 1..4 = côté du support (0..3 + 1)
      return [rotate([7, 3, 0, 9, 13, 2], (meta - 1) & 3)];
    }
    case 'chest':
      return [[1, 0, 1, 15, 14, 15]];
    case 'farmland':
      return [[0, 0, 0, 16, 15, 16]];
    case 'snow_layer':
      return [[0, 0, 0, 16, Math.min(16, 2 * ((meta & 7) + 1)), 16]];
    case 'cactus':
      return [[1, 0, 1, 15, 16, 15]];
    case 'plate':
      return [[1, 0, 1, 15, 1, 15]];
    case 'lantern':
      return [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]];
    case 'bed':
      return [[0, 3, 0, 16, 9, 16], [0, 0, 0, 3, 3, 3], [13, 0, 0, 16, 3, 3], [0, 0, 13, 3, 3, 16], [13, 0, 13, 16, 3, 16]];
    case 'fence': {
      const out: Box[] = [[6, 0, 6, 10, 16, 10]];
      if (connects(nb(0, 0, -1), 'fence')) out.push([7, 6, 0, 9, 9, 6], [7, 12, 0, 9, 15, 6]);
      if (connects(nb(0, 0, 1), 'fence')) out.push([7, 6, 10, 9, 9, 16], [7, 12, 10, 9, 15, 16]);
      if (connects(nb(-1, 0, 0), 'fence')) out.push([0, 6, 7, 6, 9, 9], [0, 12, 7, 6, 15, 9]);
      if (connects(nb(1, 0, 0), 'fence')) out.push([10, 6, 7, 16, 9, 9], [10, 12, 7, 16, 15, 9]);
      return out;
    }
    case 'custom': {
      const info = BlockRegistry.get(id).def.bedrock;
      return info?.visuals[meta]?.selection ?? info?.visuals[0]?.selection ?? [FULL];
    }
    case 'pane': {
      const out: Box[] = [[7, 0, 7, 9, 16, 9]];
      if (connects(nb(0, 0, -1), 'pane')) out.push([7, 0, 0, 9, 16, 7]);
      if (connects(nb(0, 0, 1), 'pane')) out.push([7, 0, 9, 9, 16, 16]);
      if (connects(nb(-1, 0, 0), 'pane')) out.push([0, 0, 7, 7, 16, 9]);
      if (connects(nb(1, 0, 0), 'pane')) out.push([9, 0, 7, 16, 16, 9]);
      return out;
    }
    default:
      return [FULL];
  }
}

/** Boîtes de collision (physique). Vide = traversable. */
export function collisionBoxes(id: number, meta: number, nb: NeighborFn): Box[] {
  const kind = SHAPES[BlockRegistry.shape[id] - 1];
  switch (kind) {
    case 'torch':
    case 'plate':
      return [];
    case 'snow_layer':
      return (meta & 7) === 0 ? [] : [[0, 0, 0, 16, 2 * (meta & 7), 16]];
    case 'cactus':
      return [[1, 0, 1, 15, 15, 15]];
    case 'ladder':
      return [rotate([0, 0, 0, 16, 16, 3], meta & 3)];
    case 'bed':
      return [[0, 0, 0, 16, 9, 16]];
    case 'fence': {
      // les barrières mesurent 1,5 bloc de haut (on ne peut pas sauter par-dessus)
      const out: Box[] = [[6, 0, 6, 10, 24, 10]];
      if (connects(nb(0, 0, -1), 'fence')) out.push([6, 0, 0, 10, 24, 6]);
      if (connects(nb(0, 0, 1), 'fence')) out.push([6, 0, 10, 10, 24, 16]);
      if (connects(nb(-1, 0, 0), 'fence')) out.push([0, 0, 6, 6, 24, 10]);
      if (connects(nb(1, 0, 0), 'fence')) out.push([10, 0, 6, 16, 24, 10]);
      return out;
    }
    case 'lantern':
      return [[5, 0, 5, 11, 9, 11]];
    case 'custom': {
      const info = BlockRegistry.get(id).def.bedrock;
      return info?.visuals[meta]?.collision ?? info?.visuals[0]?.collision ?? [FULL];
    }
    default:
      return modelBoxes(id, meta, nb);
  }
}

/** Boîte englobante (contour de sélection). */
export function boundsOf(boxes: Box[]): Box {
  if (!boxes.length) return FULL;
  const b: Box = [16, 16, 16, 0, 0, 0];
  for (const x of boxes) {
    b[0] = Math.min(b[0], x[0]); b[1] = Math.min(b[1], x[1]); b[2] = Math.min(b[2], x[2]);
    b[3] = Math.max(b[3], x[3]); b[4] = Math.max(b[4], x[4]); b[5] = Math.max(b[5], x[5]);
  }
  return b;
}
