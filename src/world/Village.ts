/**
 * Villages inspirés du jeu original : un puits central avec la cloche, des rues en terre battue
 * qui suivent le relief, et des bâtiments orientés vers la rue (maisons à toit en escaliers,
 * vraies portes, vitres, lits), une bibliothèque, une forge, des champs et des lampadaires.
 * Le style (bois, pierre, grès) dépend du biome. Tout est déterministe (rng de la région) et
 * écrit bloc par bloc via le StructWriter « clippé » au chunk courant.
 */
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { FACING_DIR } from '../blocks/Shapes';
import { SEA_LEVEL } from '../core/Config';
import type { Rng } from '../util/math';
import { BiomeManager } from './BiomeManager';
import type { StructWriter, TerrainQuery } from './StructureGenerator';

const id = (k: string, fallback: number) => (BlockRegistry.has(k) ? BlockRegistry.byName(k).id : fallback);
/** Orientation (0 sud, 1 ouest, 2 nord, 3 est) d'un vecteur unitaire horizontal. */
const dirIndex = (dx: number, dz: number) => FACING_DIR.findIndex(([x, z]) => x === dx && z === dz);

interface Palette {
  wall: number;
  corner: number;
  floor: number;
  base: number;
  stairs: number;
  slab: number;
  door: number;
  fence: number;
  /** Toit plat (désert) au lieu d'un toit à deux pans en escaliers. */
  flat: boolean;
}

function palette(biome: string): Palette {
  const cobble = B.COBBLESTONE;
  const wood = (w: string, flat = false): Palette => ({
    wall: id(`${w}_planks`, B.OAK_PLANKS),
    corner: id(`${w}_log`, B.OAK_LOG),
    floor: id(`${w}_planks`, B.OAK_PLANKS),
    base: cobble,
    stairs: id(`${w}_stairs`, B.OAK_STAIRS),
    slab: id(`${w}_slab`, B.OAK_SLAB),
    door: id(`${w}_door`, id('oak_door', B.AIR)),
    fence: id(`${w}_fence`, B.OAK_FENCE),
    flat,
  });
  switch (biome) {
    case 'desert':
    case 'badlands':
      return { ...wood('oak', true), wall: B.SANDSTONE, corner: B.SANDSTONE, floor: B.SANDSTONE, base: B.SANDSTONE, stairs: id('sandstone_stairs', B.SANDSTONE), slab: id('sandstone_slab', B.SANDSTONE) };
    case 'taiga':
    case 'snowy_taiga':
    case 'tundra':
    case 'ice_zone':
      return wood('spruce');
    case 'savanna':
      return wood('acacia');
    default:
      return wood('oak');
  }
}

/** Repère local d'un bâtiment : u vers la droite, v vers l'intérieur (la façade est en v = 0). */
class Frame {
  readonly fx: number;
  readonly fz: number;
  readonly rx: number;
  readonly rz: number;
  constructor(
    private w: StructWriter,
    readonly ox: number,
    readonly y: number,
    readonly oz: number,
    /** Orientation « vers l'intérieur » (de la rue vers le fond du bâtiment). */
    readonly facing: number,
  ) {
    [this.fx, this.fz] = FACING_DIR[facing];
    this.rx = -this.fz;
    this.rz = this.fx;
  }
  wx(u: number, v: number) {
    return this.ox + u * this.rx + v * this.fx;
  }
  wz(u: number, v: number) {
    return this.oz + u * this.rz + v * this.fz;
  }
  set(u: number, dy: number, v: number, b: number, m = 0) {
    this.w.set(this.wx(u, v), this.y + dy, this.wz(u, v), b, m);
  }
  fill(u0: number, dy0: number, v0: number, u1: number, dy1: number, v1: number, b: number) {
    for (let dy = dy0; dy <= dy1; dy++) for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) this.set(u, dy, v, b);
  }
  /** Orientation monde d'une direction locale (du = ±1 ou dv = ±1). */
  dir(du: number, dv: number) {
    return dirIndex(du * this.rx + dv * this.fx, du * this.rz + dv * this.fz);
  }
}

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
const overlaps = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;

/** Emprise monde d'un bâtiment (avec une marge d'un bloc). */
function footprint(f: Frame, hw: number, depth: number): Rect {
  const xs = [f.wx(-hw - 1, -1), f.wx(hw + 1, depth)], zs = [f.wz(-hw - 1, -1), f.wz(hw + 1, depth)];
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
}

/** Sol du bâtiment : fondations jusqu'au terrain, plancher, air au-dessus (arbres et herbes retirés). */
function groundwork(f: Frame, t: TerrainQuery, hw: number, depth: number, floor: number, base: number, clear: number) {
  for (let v = -1; v <= depth; v++)
    for (let u = -hw - 1; u <= hw + 1; u++) {
      const x = f.wx(u, v), z = f.wz(u, v);
      const inside = v >= 0 && v < depth && Math.abs(u) <= hw;
      const h = t.heightAt(x, z);
      for (let y = Math.min(h, f.y - 1); y < f.y; y++) f.set(u, y - f.y, v, inside ? base : B.DIRT);
      if (!inside) f.set(u, -1, v, base === B.SANDSTONE ? B.SAND : B.GRASS_BLOCK);
      for (let dy = inside ? 1 : 0; dy <= clear; dy++) f.set(u, dy, v, B.AIR);
      if (inside) f.set(u, 0, v, floor);
    }
}

/** Murs (poteaux d'angle en bûches), toit à deux pans en escaliers (ou plat), pignons. */
function shell(f: Frame, p: Palette, hw: number, depth: number, height: number) {
  for (let dy = 1; dy <= height; dy++)
    for (let v = 0; v < depth; v++)
      for (let u = -hw; u <= hw; u++) {
        const edgeU = Math.abs(u) === hw, edgeV = v === 0 || v === depth - 1;
        if (!edgeU && !edgeV) continue;
        f.set(u, dy, v, edgeU && edgeV ? p.corner : p.wall);
      }
  const top = height + 1;
  if (p.flat) {
    f.fill(-hw, top, 0, hw, top, depth - 1, p.wall);
    for (let v = 0; v < depth; v++)
      for (let u = -hw; u <= hw; u++) if (Math.abs(u) === hw || v === 0 || v === depth - 1) f.set(u, top + 1, v, p.slab);
    return;
  }
  // pans le long de la profondeur : les marches montent vers le faîtage (u = 0)
  const up = f.dir(1, 0), down = f.dir(-1, 0);
  for (let k = 0; k <= hw; k++) {
    const dy = top + k;
    const ul = -hw - 1 + k, ur = hw + 1 - k;
    for (let v = -1; v <= depth; v++) {
      f.set(ul, dy, v, p.stairs, up);
      f.set(ur, dy, v, p.stairs, down);
      // pignons (façade et fond) ; faîtage en dalles entre les dernières marches
      if (v === 0 || v === depth - 1) for (let u = ul + 1; u <= ur - 1; u++) f.set(u, dy, v, p.wall);
      else if (k === hw) f.set(0, dy, v, p.slab);
    }
  }
}

/** Porte au centre de la façade, avec un éclairage extérieur à côté. */
function frontDoor(f: Frame, p: Palette) {
  const m = f.facing; // on entre en marchant vers l'intérieur
  if (p.door !== B.AIR) {
    f.set(0, 1, 0, p.door, m);
    f.set(0, 2, 0, p.door, m | 8);
  } else {
    f.set(0, 1, 0, B.AIR);
    f.set(0, 2, 0, B.AIR);
  }
  // torche murale à droite de la porte (support : le mur derrière elle)
  f.set(1, 2, -1, B.TORCH, f.dir(0, 1) + 1);
}

function window_(f: Frame, u: number, dy: number, v: number) {
  f.set(u, dy, v, B.GLASS_PANE);
}

export type Building = 'small' | 'medium' | 'library' | 'forge' | 'farm' | 'lamp';
const SIZES: Record<Building, [number, number]> = { small: [2, 5], medium: [3, 6], library: [4, 7], forge: [3, 6], farm: [4, 9], lamp: [0, 1] };

function build(kind: Building, f: Frame, t: TerrainQuery, p: Palette, rng: Rng, loot: number) {
  const [hw, depth] = SIZES[kind];
  if (kind === 'lamp') {
    // lampadaire : poteau de barrière, bloc de laine, torches sur les quatre côtés
    f.set(0, 0, 0, B.AIR);
    f.set(0, -1, 0, p.base);
    f.fill(0, 0, 0, 0, 1, 0, p.fence);
    const wool = id('white_wool', id('wool', B.OAK_PLANKS));
    f.set(0, 2, 0, wool);
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.set(du, 2, dv, B.TORCH, f.dir(-du, -dv) + 1);
    return;
  }
  if (kind === 'farm') {
    // champ : cadre de bûches, canal d'eau au centre, cultures
    groundwork(f, t, hw, depth, B.DIRT, B.DIRT, 3);
    for (let v = 0; v < depth; v++)
      for (let u = -hw; u <= hw; u++) {
        const border = Math.abs(u) === hw || v === 0 || v === depth - 1;
        if (border) f.set(u, 0, v, p.corner === B.SANDSTONE ? B.SANDSTONE : B.OAK_LOG);
        else if (u === 0) f.set(u, 0, v, B.WATER);
        else {
          f.set(u, 0, v, B.FARMLAND, 1);
          const crop = rng.next() < 0.6 ? B.WHEAT : rng.next() < 0.5 ? B.CARROTS : id('potatoes', B.WHEAT);
          f.set(u, 1, v, crop, crop === B.WHEAT ? rng.int(2, 7) : rng.int(1, 3));
        }
      }
    return;
  }
  const height = kind === 'library' ? 4 : 3;
  groundwork(f, t, hw, depth, p.floor, p.base, height + hw + 3);
  // soubassement en pierre (comme les maisons de plaine)
  for (let v = 0; v < depth; v++) for (let u = -hw; u <= hw; u++) if (Math.abs(u) === hw || v === 0 || v === depth - 1) f.set(u, 0, v, p.base);
  shell(f, p, hw, depth, height);
  frontDoor(f, p);
  // fenêtres sur les côtés et au fond
  for (let v = 2; v < depth - 1; v += 2) {
    window_(f, -hw, 2, v);
    window_(f, hw, 2, v);
  }
  window_(f, 0, 2, depth - 1);
  if (hw >= 3) {
    window_(f, -2, 2, 0);
    window_(f, 2, 2, 0);
  }
  // intérieur
  const back = depth - 2;
  const light = (u: number, v: number) => f.set(u, 1, v, B.LANTERN);
  switch (kind) {
    case 'small':
      f.set(-hw + 1, 1, back, B.RED_BED, f.dir(0, 1) | 4);
      f.set(-hw + 1, 1, back - 1, B.RED_BED, f.dir(0, 1));
      f.set(hw - 1, 1, back, B.CRAFTING_TABLE);
      light(hw - 1, 1);
      break;
    case 'medium':
      f.set(-hw + 1, 1, back, B.RED_BED, f.dir(0, 1) | 4);
      f.set(-hw + 1, 1, back - 1, B.RED_BED, f.dir(0, 1));
      f.set(hw - 1, 1, back, B.CHEST, (loot << 2) | (f.dir(0, -1) & 3));
      f.set(hw - 1, 1, back - 1, B.FURNACE);
      f.set(hw - 1, 1, 1, B.CRAFTING_TABLE);
      light(-hw + 1, 1);
      break;
    case 'library':
      for (let v = 1; v <= back; v++) {
        f.fill(-hw + 1, 1, v, -hw + 1, 2, v, B.BOOKSHELF);
        f.fill(hw - 1, 1, v, hw - 1, 2, v, B.BOOKSHELF);
      }
      f.set(0, 1, back, id('lectern', B.CRAFTING_TABLE), f.dir(0, -1));
      f.set(-1, 1, back, B.LANTERN);
      f.set(1, 1, back, B.LANTERN);
      break;
    case 'forge':
      // forge ouverte sur la rue : deux fourneaux, coffre de forgeron, enclume si disponible
      for (let u = -hw + 1; u <= hw - 1; u++) f.set(u, 1, 0, B.AIR);
      f.set(0, 2, 0, B.AIR);
      f.set(-hw + 1, 1, back, B.FURNACE);
      f.set(-hw + 2, 1, back, B.FURNACE);
      f.set(hw - 1, 1, back, B.CHEST, (loot << 2) | (f.dir(0, -1) & 3));
      f.set(hw - 1, 1, back - 1, id('anvil', id('smithing_table', B.CRAFTING_TABLE)));
      light(0, back);
      break;
  }
}

/**
 * Village complet autour de (ox, oz) : puits et cloche, 2 à 4 rues, bâtiments le long des rues.
 * `loot` : table de butin des coffres.
 */
export function buildVillage(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery, loot: number) {
  const biome = BiomeManager.get(t.biomeAt(ox, oz)).key;
  const p = palette(biome);
  const cy = t.heightAt(ox, oz) + 1;
  const used: Rect[] = [{ x0: ox - 4, z0: oz - 4, x1: ox + 4, z1: oz + 4 }];

  // rues : bras partant du puits (au moins deux), en terre battue de 3 de large suivant le relief
  const arms: { dx: number; dz: number; len: number }[] = [];
  const start = rng.int(0, 3);
  for (let k = 0; k < 4; k++) {
    const [dx, dz] = FACING_DIR[(start + k) & 3];
    if (k >= 2 && rng.next() < 0.3) continue;
    arms.push({ dx, dz, len: rng.int(18, 32) });
  }
  const road = (x: number, z: number) => {
    const h = t.heightAt(x, z);
    if (h < SEA_LEVEL) w.set(x, SEA_LEVEL, z, p.wall === B.SANDSTONE ? B.SANDSTONE : B.OAK_PLANKS);
    else {
      w.set(x, h, z, p.base === B.SANDSTONE ? B.SANDSTONE : B.DIRT_PATH);
      w.set(x, h + 1, z, B.AIR);
      w.set(x, h + 2, z, B.AIR);
    }
  };
  for (const a of arms)
    for (let i = 3; i <= a.len; i++) {
      const px = -a.dz, pz = a.dx; // perpendiculaire
      for (let s = -1; s <= 1; s++) road(ox + a.dx * i + px * s, oz + a.dz * i + pz * s);
    }

  // puits central (au-dessus de la place) avec la cloche
  for (let z = oz - 3; z <= oz + 3; z++) for (let x = ox - 3; x <= ox + 3; x++) {
    const h = t.heightAt(x, z);
    for (let y = Math.min(h, cy - 1); y < cy; y++) w.set(x, y, z, B.COBBLESTONE);
    w.set(x, cy - 1, z, p.base === B.SANDSTONE ? B.SANDSTONE : B.DIRT_PATH);
    for (let y = cy; y <= cy + 6; y++) w.set(x, y, z, B.AIR);
  }
  for (let z = oz - 1; z <= oz + 1; z++) for (let x = ox - 1; x <= ox + 1; x++) {
    const rim = x !== ox || z !== oz;
    for (let y = cy - 4; y < cy; y++) w.set(x, y, z, rim ? B.COBBLESTONE : B.WATER);
    w.set(x, cy, z, rim ? B.COBBLESTONE : B.AIR);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    w.set(ox + dx, cy + 1, oz + dz, p.fence);
    w.set(ox + dx, cy + 2, oz + dz, p.fence);
  }
  for (let z = oz - 1; z <= oz + 1; z++) for (let x = ox - 1; x <= ox + 1; x++) w.set(x, cy + 3, z, B.COBBLESTONE_SLAB ?? B.COBBLESTONE);
  if (BlockRegistry.has('bell')) w.set(ox + 2, cy, oz, BlockRegistry.byName('bell').id);

  // bâtiments des deux côtés de chaque rue, façade (porte) vers la rue
  const pool: Building[] = ['small', 'small', 'small', 'medium', 'medium', 'farm', 'farm', 'library', 'forge', 'lamp'];
  for (const a of arms) {
    const px = -a.dz, pz = a.dx;
    for (const side of [-1, 1]) {
      let i = 5 + rng.int(0, 3);
      while (i < a.len - 1) {
        const kind = pool[rng.int(0, pool.length - 1)];
        const [hw, depth] = SIZES[kind];
        const along = i + hw;
        // origine : milieu de la façade, à 2 blocs du bord de la rue
        const setback = kind === 'lamp' ? 2 : 3;
        const fx = ox + a.dx * along + px * side * setback, fz = oz + a.dz * along + pz * side * setback;
        const facing = dirIndex(px * side, pz * side);
        const probe = new Frame(w, fx, 0, fz, facing);
        const rect = footprint(probe, hw, depth);
        // terrain : pas dans l'eau, pente raisonnable
        let lo = Infinity, hi = -Infinity;
        for (const [u, v] of [[-hw, 0], [hw, 0], [-hw, depth - 1], [hw, depth - 1], [0, (depth - 1) >> 1]]) {
          const h = t.heightAt(probe.wx(u, v), probe.wz(u, v));
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
        const ok = lo >= SEA_LEVEL && hi - lo <= 5 && !used.some((r) => overlaps(r, rect));
        if (ok) {
          used.push(rect);
          const y = kind === 'lamp' ? t.heightAt(fx, fz) + 1 : Math.round((lo + hi) / 2) + 1;
          build(kind, new Frame(w, fx, y, fz, facing), t, p, rng, loot);
          // allée de la porte jusqu'à la rue
          if (kind !== 'lamp' && kind !== 'farm')
            for (let s = 1; s < setback; s++) {
              const x = fx - px * side * s, z = fz - pz * side * s;
              const h = t.heightAt(x, z);
              if (h >= SEA_LEVEL) {
                w.set(x, h, z, p.base === B.SANDSTONE ? B.SANDSTONE : B.DIRT_PATH);
                w.set(x, h + 1, z, B.AIR);
                w.set(x, h + 2, z, B.AIR);
              }
            }
        }
        i += hw * 2 + 2 + (kind === 'lamp' ? 3 : rng.int(1, 3));
      }
    }
  }
}
