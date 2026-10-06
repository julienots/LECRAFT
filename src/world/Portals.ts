import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { WORLD_HEIGHT } from '../core/Config';
import type { World } from './World';

/**
 * Portails du Nether : cadre d'obsidienne rectangulaire (intérieur de 2×3 à 21×21, coins
 * facultatifs) allumé au briquet, dans le plan X ou Z. Méta du bloc de portail : 0 = plan X, 1 = plan Z.
 */
export type Dimension = 'overworld' | 'nether' | 'end';

export const portalId = () => (BlockRegistry.has('nether_portal') ? BlockRegistry.byName('nether_portal').id : -1);

const MAX = 21;
/** Remplissage en cours : la vérification du cadre est suspendue (blocs posés un à un). */
let filling = false;

/** Intérieur d'un cadre valide contenant (x, y, z), ou null. */
export function findFrame(w: World, x: number, y: number, z: number): { cells: [number, number, number][]; axis: 0 | 1 } | null {
  const P = portalId();
  const open = (b: number) => b === B.AIR || b === P || (BlockRegistry.has('fire') && b === BlockRegistry.byName('fire').id);
  for (const axis of [0, 1] as const) {
    const ax = axis === 0 ? 1 : 0, az = axis === 0 ? 0 : 1;
    if (!open(w.getBlock(x, y, z))) return null;
    // descend jusqu'au bas de l'intérieur
    let by = y;
    while (by > 0 && y - by < MAX && open(w.getBlock(x, by - 1, z))) by--;
    if (w.getBlock(x, by - 1, z) !== B.OBSIDIAN) continue;
    // bords gauche / droit
    let l = 0;
    while (l < MAX && open(w.getBlock(x - ax * (l + 1), by, z - az * (l + 1)))) l++;
    let r = 0;
    while (r < MAX && open(w.getBlock(x + ax * (r + 1), by, z + az * (r + 1)))) r++;
    const width = l + r + 1;
    if (width < 2 || width > MAX) continue;
    const x0 = x - ax * l, z0 = z - az * l;
    if (w.getBlock(x0 - ax, by, z0 - az) !== B.OBSIDIAN || w.getBlock(x0 + ax * width, by, z0 + az * width) !== B.OBSIDIAN) continue;
    // hauteur : la première ligne dont un bloc n'est plus ouvert doit être un toit d'obsidienne complet
    let height = 0;
    let ok = true;
    for (; height <= MAX; height++) {
      let rowOpen = true;
      for (let i = 0; i < width; i++) if (!open(w.getBlock(x0 + ax * i, by + height, z0 + az * i))) rowOpen = false;
      if (!rowOpen) break;
      if (w.getBlock(x0 - ax, by + height, z0 - az) !== B.OBSIDIAN || w.getBlock(x0 + ax * width, by + height, z0 + az * width) !== B.OBSIDIAN) {
        ok = false;
        break;
      }
    }
    if (!ok || height < 3 || height > MAX) continue;
    for (let i = 0; i < width; i++) if (w.getBlock(x0 + ax * i, by + height, z0 + az * i) !== B.OBSIDIAN) ok = false;
    for (let i = 0; i < width; i++) if (w.getBlock(x0 + ax * i, by - 1, z0 + az * i) !== B.OBSIDIAN) ok = false;
    if (!ok) continue;
    const cells: [number, number, number][] = [];
    for (let h = 0; h < height; h++) for (let i = 0; i < width; i++) cells.push([x0 + ax * i, by + h, z0 + az * i]);
    return { cells, axis };
  }
  return null;
}

/** Allume le portail si (x, y, z) est à l'intérieur d'un cadre valide. */
export function tryLight(w: World, x: number, y: number, z: number): { x: number; y: number; z: number } | null {
  const P = portalId();
  if (P < 0) return null;
  const f = findFrame(w, x, y, z);
  if (!f) return null;
  filling = true;
  try {
    for (const [cx, cy, cz] of f.cells) w.setBlock(cx, cy, cz, P, f.axis);
  } finally {
    filling = false;
  }
  const [bx, by, bz] = f.cells[0];
  return { x: bx, y: by, z: bz };
}

/**
 * Un bloc a changé : les blocs de portail voisins qui ne sont plus tenus par le cadre (obsidienne
 * ou portail dans leur plan) disparaissent, ce qui éteint tout le portail de proche en proche.
 */
export function onBlockChanged(w: World, x: number, y: number, z: number) {
  const P = portalId();
  if (P < 0 || filling) return;
  const queue: [number, number, number][] = [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
  let guard = 0;
  while (queue.length && guard++ < 2000) {
    const [px, py, pz] = queue.pop()!;
    if (w.getBlock(px, py, pz) !== P) continue;
    const axis = w.getMeta(px, py, pz) & 1;
    const ax = axis === 0 ? 1 : 0, az = axis === 0 ? 0 : 1;
    const held = (b: number) => b === P || b === B.OBSIDIAN;
    if (held(w.getBlock(px, py + 1, pz)) && held(w.getBlock(px, py - 1, pz)) && held(w.getBlock(px + ax, py, pz + az)) && held(w.getBlock(px - ax, py, pz - az))) continue;
    w.setBlock(px, py, pz, B.AIR);
    queue.push([px + ax, py, pz + az], [px - ax, py, pz - az], [px, py + 1, pz], [px, py - 1, pz]);
  }
}

/** Le joueur (boîte) touche-t-il un bloc de portail ? */
export function touchesPortal(w: World, x: number, y: number, z: number, halfW: number, h: number): boolean {
  const P = portalId();
  if (P < 0) return false;
  for (let by = Math.floor(y); by <= Math.floor(y + h - 0.01); by++)
    for (let bx = Math.floor(x - halfW); bx <= Math.floor(x + halfW); bx++)
      for (let bz = Math.floor(z - halfW); bz <= Math.floor(z + halfW); bz++) if (w.getBlock(bx, by, bz) === P) return true;
  return false;
}

/** Cherche un bloc de portail chargé près de (x, z) dans un rayon horizontal. */
export function findNearbyPortal(w: World, x: number, z: number, radius: number, hint: { x: number; y: number; z: number }[]): { x: number; y: number; z: number } | null {
  const P = portalId();
  let best: { x: number; y: number; z: number } | null = null, bd = Infinity;
  for (const p of hint) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > radius || d >= bd || !w.isLoaded(p.x, p.z)) continue;
    // le registre peut être périmé : on vérifie le bloc (et on cherche le bas du portail)
    let y = p.y;
    if (w.getBlock(p.x, y, p.z) !== P) continue;
    while (y > 1 && w.getBlock(p.x, y - 1, p.z) === P) y--;
    best = { x: p.x, y, z: p.z };
    bd = d;
  }
  return best;
}

/**
 * Crée un portail (cadre 4×5, intérieur 2×3, plan X) près de (tx, tz) : cherche un emplacement
 * dégagé posé sur un sol solide ; à défaut, construit une plateforme d'obsidienne et dégage l'air.
 * Retourne la position du premier bloc de portail (bas, à gauche).
 */
export function buildArrivalPortal(w: World, tx: number, tz: number, dim: Dimension, preferY: number): { x: number; y: number; z: number } {
  const P = portalId();
  const minY = dim === 'nether' ? 32 : 2, maxY = dim === 'nether' ? 118 : WORLD_HEIGHT - 8;
  const fits = (x: number, y: number, z: number) => {
    for (let i = -1; i <= 2; i++) {
      if (!w.isSolid(x + i, y - 1, z) || BlockRegistry.liquid[w.getBlock(x + i, y - 1, z)]) return false;
      for (let h = 0; h < 5; h++) for (const dz of [-1, 0, 1]) if (w.getBlock(x + i, y + h, z + dz) !== B.AIR) return false;
    }
    return true;
  };
  let spot: [number, number, number] | null = null;
  outer: for (let r = 0; r <= 16; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = tx + dx, z = tz + dz;
        if (!w.isLoaded(x - 2, z) || !w.isLoaded(x + 3, z)) continue;
        // du plus proche de l'altitude souhaitée vers l'extérieur
        for (let k = 0; k < maxY - minY; k++) {
          const y = preferY + (k % 2 ? -(k + 1) / 2 : k / 2);
          if (y < minY || y > maxY) continue;
          if (fits(x, y, z)) {
            spot = [x, y, z];
            break outer;
          }
        }
      }
  let [x, y, z] = spot ?? [tx, Math.max(minY + 2, Math.min(maxY - 6, preferY)), tz];
  if (!spot) {
    // plateforme d'obsidienne + espace dégagé
    for (let i = -1; i <= 2; i++)
      for (const dz of [-1, 0, 1]) {
        w.setBlock(x + i, y - 1, z + dz, B.OBSIDIAN);
        for (let h = 0; h < 5; h++) w.setBlock(x + i, y + h, z + dz, B.AIR);
      }
  }
  // cadre
  filling = true;
  for (let i = -1; i <= 2; i++) {
    w.setBlock(x + i, y - 1, z, B.OBSIDIAN);
    w.setBlock(x + i, y + 3, z, B.OBSIDIAN);
  }
  for (let h = 0; h < 3; h++) {
    w.setBlock(x - 1, y + h, z, B.OBSIDIAN);
    w.setBlock(x + 2, y + h, z, B.OBSIDIAN);
    for (let i = 0; i < 2; i++) w.setBlock(x + i, y + h, z, P, 0);
  }
  filling = false;
  return { x, y, z };
}

// ---------- portail de l'End ----------
const bid = (k: string) => (BlockRegistry.has(k) ? BlockRegistry.byName(k).id : -1);
export const endPortalId = () => bid('end_portal');

/**
 * Œil de l'Ender posé sur un cadre vide. Si les 12 cadres de l'anneau (5×5 sans les coins)
 * ont un œil, l'intérieur 3×3 devient un portail de l'End. Retourne 'inserted', 'opened' ou null.
 */
export function insertEye(w: World, x: number, y: number, z: number): 'inserted' | 'opened' | null {
  const FRAME = bid('end_portal_frame'), FILLED = bid('end_portal_frame_filled'), PORTAL = endPortalId();
  if (FRAME < 0 || w.getBlock(x, y, z) !== FRAME) return null;
  w.setBlock(x, y, z, FILLED, w.getMeta(x, y, z));
  // centres possibles de l'anneau dont (x, z) fait partie
  for (let cx = x - 2; cx <= x + 2; cx++)
    for (let cz = z - 2; cz <= z + 2; cz++) {
      let ok = true;
      for (let dz = -2; dz <= 2 && ok; dz++)
        for (let dx = -2; dx <= 2 && ok; dx++) {
          const ring = (Math.abs(dx) === 2) !== (Math.abs(dz) === 2);
          if (ring && w.getBlock(cx + dx, y, cz + dz) !== FILLED) ok = false;
        }
      if (!ok) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) w.setBlock(cx + dx, y, cz + dz, PORTAL);
      return 'opened';
    }
  return 'inserted';
}

/** Le joueur touche-t-il un portail de l'End ? */
export function touchesEndPortal(w: World, x: number, y: number, z: number, halfW: number): boolean {
  const P = endPortalId();
  if (P < 0) return false;
  for (let bx = Math.floor(x - halfW); bx <= Math.floor(x + halfW); bx++)
    for (let bz = Math.floor(z - halfW); bz <= Math.floor(z + halfW); bz++)
      for (const by of [Math.floor(y), Math.floor(y - 0.2)]) if (w.getBlock(bx, by, bz) === P) return true;
  return false;
}

/** Active la fontaine de sortie de l'End (après la mort du dragon) et pose l'œuf de dragon. */
export function activateExitPortal(w: World, y0: number) {
  const P = endPortalId();
  for (let x = -3; x <= 3; x++)
    for (let z = -3; z <= 3; z++) {
      const d = Math.hypot(x, z);
      if (d <= 2.6 && !(x === 0 && z === 0)) w.setBlock(x, y0, z, P);
    }
  const egg = bid('dragon_egg');
  if (egg > 0) w.setBlock(0, y0 + 4, 0, egg);
}
