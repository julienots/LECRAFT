import { BlockRegistry, SHAPES } from '../blocks/BlockRegistry';
import type { World } from './World';

/**
 * Redstone simplifiée : leviers, boutons et plaques de pression alimentent les portes, trappes et
 * portillons voisins (dans un rayon d'un bloc, diagonales comprises). Les portes et trappes en fer ne
 * s'ouvrent qu'ainsi, comme dans le jeu original.
 *
 * Méta : levier / bouton bit 3 = activé ; plaque bit 0 = enfoncée ; ouvrants bit 2 = ouvert.
 */
const kind = (id: number) => (id > 0 ? SHAPES[BlockRegistry.shape[id] - 1] : undefined);

export function isOpenable(id: number) {
  const k = kind(id);
  return k === 'door' || k === 'trapdoor' || k === 'fence_gate';
}

/** Source de redstone active à cette position ? */
export function sourceActive(world: World, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  const k = kind(id);
  if (k === 'lever' || k === 'button') return (world.getMeta(x, y, z) & 8) !== 0;
  if (k === 'plate') return (world.getMeta(x, y, z) & 1) !== 0;
  return false;
}

function poweredAt(world: World, x: number, y: number, z: number): boolean {
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && sourceActive(world, x + dx, y + dy, z + dz)) return true;
  return false;
}

/** Un ouvrant (une porte : l'une ou l'autre moitié) est-il alimenté ? */
export function isPowered(world: World, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (kind(id) === 'door') {
    const by = world.getMeta(x, y, z) & 8 ? y - 1 : y;
    return poweredAt(world, x, by, z) || poweredAt(world, x, by + 1, z);
  }
  return poweredAt(world, x, y, z);
}

/** Ouvre / ferme un ouvrant (les deux moitiés d'une porte). Renvoie vrai s'il a changé. */
export function setOpen(world: World, x: number, y: number, z: number, open: boolean): boolean {
  const id = world.getBlock(x, y, z);
  const k = kind(id);
  if (!k) return false;
  const ys = k === 'door' ? (world.getMeta(x, y, z) & 8 ? [y - 1, y] : [y, y + 1]) : [y];
  let changed = false;
  for (const yy of ys) {
    if (world.getBlock(x, yy, z) !== id) continue;
    const m = world.getMeta(x, yy, z);
    const next = open ? m | 4 : m & ~4;
    if (next !== m) {
      world.setBlock(x, yy, z, id, next, false);
      changed = true;
    }
  }
  return changed;
}

/**
 * Après le changement d'une source en (x, y, z) : met à jour les ouvrants proches
 * (ouverts s'ils sont alimentés, fermés sinon). `onChange` reçoit chaque ouvrant modifié.
 */
export function updatePowerAround(world: World, x: number, y: number, z: number, onChange?: (x: number, y: number, z: number, open: boolean) => void) {
  for (let dy = -2; dy <= 2; dy++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const px = x + dx, py = y + dy, pz = z + dz;
        const id = world.getBlock(px, py, pz);
        // distributeur, dropper, entonnoir : bit 8 = alimenté (front montant : tir ; entonnoir bloqué)
        const it = id > 0 ? BlockRegistry.get(id).interact : undefined;
        if (it === 'dispenser' || it === 'hopper') {
          const m = world.getMeta(px, py, pz);
          const p = poweredAt(world, px, py, pz);
          if (p !== ((m & 8) !== 0)) world.setBlock(px, py, pz, id, p ? m | 8 : m & ~8, false);
          continue;
        }
        if (!isOpenable(id)) continue;
        // une seule mise à jour par porte (moitié basse)
        if (kind(id) === 'door' && world.getMeta(px, py, pz) & 8) continue;
        const open = isPowered(world, px, py, pz);
        if (setOpen(world, px, py, pz, open)) onChange?.(px, py, pz, open);
      }
}
