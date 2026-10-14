/**
 * Villages inspirés de la 1.21 : une place avec un puits, la cloche et des lampadaires, des rues en
 * chemin de terre (lissées : jamais plus d'un bloc de dénivelé d'une case à l'autre) avec des
 * ruelles secondaires, et des bâtiments tournés vers la rue. Chaque bâtiment habitable a une vraie
 * porte (deux moitiés, tournée vers la rue) avec une marche et une allée jusqu'à la rue.
 * Maisons (un lit par villageois), bibliothèque (pupitre), forges (haut fourneau, table de forgeron
 * ou meule + lave), boucherie (fumoir), cartographe, temple (alambic), pêcheur (tonneau), archer
 * (table d'archerie), tanneur (chaudron), tailleur de pierre, berger (métier à tisser), champs
 * (composteur) et enclos. Le style (bois, pierre, grès, terre cuite, neige) dépend du biome.
 * Tout est déterministe (rng de la région) et écrit via le StructWriter « clippé » au chunk courant.
 */
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { FACING_DIR } from '../blocks/Shapes';
import { SEA_LEVEL } from '../core/Config';
import { Rng as RngImpl, type Rng } from '../util/math';
import { BiomeManager } from './BiomeManager';
import type { StructWriter, TerrainQuery } from './StructureGenerator';

const id = (k: string, fallback: number) => (BlockRegistry.has(k) ? BlockRegistry.byName(k).id : fallback);
/** Orientation (0 sud, 1 ouest, 2 nord, 3 est) d'un vecteur unitaire horizontal. */
const dirIndex = (dx: number, dz: number) => FACING_DIR.findIndex(([x, z]) => x === dx && z === dz);
/** Demi-rayon maximal du village (doit rester sous le rayon déclaré dans StructureGenerator). */
const REACH = 46;

export interface Palette {
  wall: number;
  corner: number;
  floor: number;
  /** Fondations et soubassement. */
  base: number;
  /** Rangée du bas des murs (pierre, grès taillé, terre cuite…). */
  trim: number;
  /** Marche devant la porte. */
  step: number;
  stairs: number;
  slab: number;
  door: number;
  fence: number;
  gate: number;
  /** Chemins et allées. */
  path: number;
  /** Sol naturel autour des bâtiments (et remblai dessous). */
  ground: number;
  fillGround: number;
  /** Bande décorative (terre cuite du désert et de la savane). */
  accent: number;
  /** Toit plat (désert) au lieu d'un toit à deux pans en escaliers. */
  flat: boolean;
  snowy: boolean;
  flowers: boolean;
}

export function palette(biome: string): Palette {
  const wood = (w: string): Palette => ({
    wall: id(`${w}_planks`, B.OAK_PLANKS),
    corner: id(`${w}_log`, B.OAK_LOG),
    floor: id(`${w}_planks`, B.OAK_PLANKS),
    base: B.COBBLESTONE,
    trim: B.COBBLESTONE,
    step: id('cobblestone_stairs', B.COBBLESTONE),
    stairs: id(`${w}_stairs`, B.OAK_STAIRS),
    slab: id(`${w}_slab`, B.OAK_SLAB),
    door: id(`${w}_door`, id('oak_door', B.AIR)),
    fence: id(`${w}_fence`, B.OAK_FENCE),
    gate: id(`${w}_fence_gate`, id('oak_fence_gate', id(`${w}_fence`, B.OAK_FENCE))),
    path: id('dirt_path', B.DIRT),
    ground: B.GRASS_BLOCK,
    fillGround: B.DIRT,
    accent: id(`${w}_planks`, B.OAK_PLANKS),
    flat: false,
    snowy: false,
    flowers: true,
  });
  switch (biome) {
    case 'desert':
    case 'badlands': {
      const smooth = id('smooth_sandstone', B.SANDSTONE);
      return {
        ...wood('oak'),
        wall: smooth,
        corner: id('cut_sandstone', B.SANDSTONE),
        floor: smooth,
        base: B.SANDSTONE,
        trim: id('cut_sandstone', B.SANDSTONE),
        step: id('sandstone_stairs', B.SANDSTONE),
        stairs: id('sandstone_stairs', B.SANDSTONE),
        slab: id('sandstone_slab', B.SANDSTONE),
        fence: id('sandstone_wall', B.OAK_FENCE),
        gate: id('oak_fence_gate', B.OAK_FENCE),
        path: smooth,
        ground: B.SAND,
        fillGround: B.SANDSTONE,
        accent: id('yellow_terracotta', id('terracotta', B.SANDSTONE)),
        flat: true,
        flowers: false,
      };
    }
    case 'savanna':
      return { ...wood('acacia'), trim: id('orange_terracotta', id('terracotta', B.COBBLESTONE)), accent: id('orange_terracotta', id('terracotta', B.COBBLESTONE)) };
    case 'taiga':
      return { ...wood('spruce'), trim: B.MOSSY_COBBLESTONE ?? B.COBBLESTONE, ground: B.GRASS_BLOCK };
    case 'snowy_taiga':
    case 'tundra':
    case 'ice_zone':
      return {
        ...wood('spruce'),
        corner: id('stripped_spruce_log', id('spruce_log', B.OAK_LOG)),
        trim: B.STONE_BRICKS ?? B.COBBLESTONE,
        step: id('stone_brick_stairs', id('cobblestone_stairs', B.COBBLESTONE)),
        ground: B.SNOWY_GRASS_BLOCK ?? B.GRASS_BLOCK,
        snowy: true,
        flowers: false,
      };
    default:
      return wood('oak');
  }
}

/** Repère local d'un bâtiment : u vers la droite, v vers l'intérieur (la façade est en v = 0). */
export class Frame {
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
  fill(u0: number, dy0: number, v0: number, u1: number, dy1: number, v1: number, b: number, m = 0) {
    for (let dy = dy0; dy <= dy1; dy++) for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) this.set(u, dy, v, b, m);
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

export type Building =
  | 'small'
  | 'medium'
  | 'big'
  | 'library'
  | 'forge'
  | 'butcher'
  | 'cartographer'
  | 'temple'
  | 'fisher'
  | 'fletcher'
  | 'tannery'
  | 'mason'
  | 'shepherd'
  | 'farm'
  | 'big_farm'
  | 'pen'
  | 'lamp';
/** Demi-largeur et profondeur (façade comprise) de chaque bâtiment. */
const SIZES: Record<Building, [number, number]> = {
  small: [2, 5],
  medium: [3, 6],
  big: [4, 8],
  library: [4, 7],
  forge: [3, 6],
  butcher: [3, 5],
  cartographer: [2, 6],
  temple: [2, 7],
  fisher: [2, 5],
  fletcher: [2, 5],
  tannery: [2, 5],
  mason: [3, 5],
  shepherd: [3, 5],
  farm: [4, 9],
  big_farm: [5, 9],
  pen: [3, 6],
  lamp: [0, 1],
};
/** Bâtiments fermés avec une vraie porte (les champs, l'enclos et les lampadaires n'en ont pas). */
export const HAS_DOOR: Record<Building, boolean> = Object.fromEntries((Object.keys(SIZES) as Building[]).map((k) => [k, k !== 'farm' && k !== 'big_farm' && k !== 'pen' && k !== 'lamp'])) as Record<Building, boolean>;
/** Lits (un par villageois) de chaque bâtiment. */
export const BEDS: Partial<Record<Building, number>> = { small: 1, medium: 2, big: 3 };
/** Bloc de métier attendu (clé), s'il existe dans le registre. */
export const JOB_SITE: Partial<Record<Building, string[]>> = {
  library: ['lectern'],
  forge: ['blast_furnace', 'smithing_table', 'grindstone'],
  butcher: ['smoker'],
  cartographer: ['cartography_table'],
  temple: ['brewing_stand'],
  fisher: ['barrel'],
  fletcher: ['fletching_table'],
  tannery: ['cauldron', 'water_cauldron'],
  mason: ['stonecutter'],
  shepherd: ['loom'],
  farm: ['composter'],
  big_farm: ['composter'],
};

/** Emprise monde d'un bâtiment : marge d'un bloc sur les côtés et au fond, allée devant (v = -2). */
function footprint(f: Frame, hw: number, depth: number): Rect {
  const xs = [f.wx(-hw - 1, -2), f.wx(hw + 1, depth)], zs = [f.wz(-hw - 1, -2), f.wz(hw + 1, depth)];
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
}

/**
 * Terrassement : fondations jusqu'au terrain, plancher, air au-dessus (arbres et herbes retirés),
 * sol nivelé tout autour (marge et bande de l'allée devant la façade).
 */
function groundwork(f: Frame, t: TerrainQuery, p: Palette, hw: number, depth: number, floor: number, clear: number) {
  for (let v = -2; v <= depth; v++)
    for (let u = -hw - 1; u <= hw + 1; u++) {
      const x = f.wx(u, v), z = f.wz(u, v);
      const inside = v >= 0 && v < depth && Math.abs(u) <= hw;
      const h = t.heightAt(x, z);
      for (let y = Math.min(h, f.y - 1); y < f.y; y++) f.set(u, y - f.y, v, inside ? p.base : p.fillGround);
      if (!inside) f.set(u, -1, v, p.ground);
      // dégagé haut : les arbres (posés avant les structures) ne traversent ni toits ni allées
      const top = Math.max(clear + 4, h - f.y + 12);
      for (let dy = inside ? 1 : 0; dy <= top; dy++) f.set(u, dy, v, B.AIR);
      if (inside) f.set(u, 0, v, floor);
      else if (p.snowy && v >= -1) f.set(u, 0, v, B.SNOW);
    }
}

/** Murs (poteaux d'angle), soubassement, toit à deux pans en escaliers (ou plat), pignons. Renvoie le haut des murs. */
function shell(f: Frame, p: Palette, hw: number, depth: number, height: number) {
  for (let v = 0; v < depth; v++) for (let u = -hw; u <= hw; u++) if (Math.abs(u) === hw || v === 0 || v === depth - 1) f.set(u, 0, v, p.trim);
  for (let dy = 1; dy <= height; dy++)
    for (let v = 0; v < depth; v++)
      for (let u = -hw; u <= hw; u++) {
        const edgeU = Math.abs(u) === hw, edgeV = v === 0 || v === depth - 1;
        if (!edgeU && !edgeV) continue;
        // bande décorative en haut des murs (terre cuite du désert / de la savane)
        const band = dy === height && p.accent !== p.wall && !(edgeU && edgeV);
        f.set(u, dy, v, edgeU && edgeV ? p.corner : band ? p.accent : p.wall);
      }
  const top = height + 1;
  if (p.flat) {
    f.fill(-hw, top, 0, hw, top, depth - 1, p.wall);
    for (let v = 0; v < depth; v++) for (let u = -hw; u <= hw; u++) if (Math.abs(u) === hw || v === 0 || v === depth - 1) f.set(u, top + 1, v, p.slab);
    return top;
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
  return top;
}

/** Hauteur du toit au-dessus de la colonne u (pour les cheminées). */
const roofAt = (p: Palette, hw: number, top: number, u: number) => (p.flat ? top + 1 : top + (hw + 1 - Math.abs(u)));

/**
 * Vraie porte au centre de la façade (moitié basse + moitié haute, tournée vers la rue), marche
 * devant, allée de chemin jusqu'à la rue et torche murale à côté.
 */
function frontDoor(f: Frame, p: Palette) {
  const m = f.facing; // on entre en marchant vers l'intérieur
  if (p.door !== B.AIR) {
    f.set(0, 1, 0, p.door, m);
    f.set(0, 2, 0, p.door, m | 8);
  } else {
    f.set(0, 1, 0, B.AIR);
    f.set(0, 2, 0, B.AIR);
  }
  // l'entrée reste libre à l'intérieur
  f.set(0, 1, 1, B.AIR);
  f.set(0, 2, 1, B.AIR);
  // marche (la partie haute vers la porte), puis allée de 3 de large jusqu'à la rue
  f.set(0, 0, -1, p.step, m);
  f.set(0, 1, -1, B.AIR);
  f.set(0, 2, -1, B.AIR);
  for (let u = -1; u <= 1; u++) {
    f.set(u, -1, -2, p.path);
    f.fill(u, 0, -2, u, 2, -2, B.AIR);
  }
  // torche murale à droite de la porte (support : le mur derrière elle)
  f.set(1, 2, -1, B.TORCH, f.dir(0, 1) + 1);
}

function windows(f: Frame, hw: number, depth: number, rows: number[] = [2]) {
  const pane = B.GLASS_PANE;
  for (const dy of rows) {
    for (let v = 2; v < depth - 1; v += 2) {
      f.set(-hw, dy, v, pane);
      f.set(hw, dy, v, pane);
    }
    f.set(0, dy, depth - 1, pane);
    if (hw >= 3) {
      f.set(-2, dy, 0, pane);
      f.set(2, dy, 0, pane);
    }
  }
}

/** Fleurs plantées devant la façade (pas devant la porte). */
function flowerBed(f: Frame, p: Palette, rng: Rng, hw: number) {
  if (!p.flowers) return;
  const kinds = ['poppy', 'dandelion', 'cornflower', 'azure_bluet', 'oxeye_daisy'].filter((k) => BlockRegistry.has(k));
  if (!kinds.length) return;
  for (let u = -hw; u <= hw; u++) if (Math.abs(u) >= 2 && rng.next() < 0.6) f.set(u, 0, -1, BlockRegistry.byName(rng.pick(kinds)).id);
}

/** Lits côte à côte contre le mur du fond (tête au fond), à partir de la gauche. */
function beds(f: Frame, hw: number, back: number, n: number) {
  for (let i = 0; i < n; i++) {
    const u = -hw + 1 + i;
    f.set(u, 1, back, B.RED_BED, f.dir(0, 1) | 4);
    f.set(u, 1, back - 1, B.RED_BED, f.dir(0, 1));
  }
}

/** Cheminée en pierre contre le mur du fond, qui dépasse du toit. */
function chimney(f: Frame, p: Palette, hw: number, depth: number, top: number) {
  const u = hw - 1;
  f.fill(u, 1, depth - 1, u, roofAt(p, hw, top, u) + 1, depth - 1, p.base === B.SANDSTONE ? B.SANDSTONE : B.COBBLESTONE);
}

const wool = () => id('white_wool', id('wool', B.OAK_PLANKS));

/** Construit un bâtiment dans son repère (origine : milieu de la façade, au niveau du plancher). */
function build(kind: Building, f: Frame, t: TerrainQuery, p: Palette, rng: Rng, loot: number) {
  const [hw, depth] = SIZES[kind];
  const out = f.dir(0, -1); // vers la façade (blocs orientés vers la porte)
  if (kind === 'lamp') {
    // lampadaire : poteau (barrières ou grès) surmonté d'une lanterne
    f.set(0, -1, 0, p.base);
    f.set(0, 0, 0, p.fence);
    f.set(0, 1, 0, p.fence);
    if (p.flat) f.set(0, 2, 0, B.TORCH);
    else f.set(0, 2, 0, B.LANTERN);
    return;
  }
  if (kind === 'farm' || kind === 'big_farm') {
    // champ : cadre de bûches, canaux d'eau, cultures à tous les stades, composteur et foin
    groundwork(f, t, p, hw, depth, B.DIRT, 3);
    const water = kind === 'farm' ? [0] : [-2, 2];
    const crops = [B.WHEAT, B.CARROTS, id('potatoes', B.WHEAT)];
    for (let v = 0; v < depth; v++) {
      for (let u = -hw; u <= hw; u++) {
        const border = Math.abs(u) === hw || v === 0 || v === depth - 1;
        if (border) f.set(u, 0, v, p.flat ? B.SANDSTONE : p.corner);
        else if (water.includes(u)) f.set(u, 0, v, B.WATER);
        else f.set(u, 0, v, B.FARMLAND, 1);
      }
    }
    // une culture par rangée de part et d'autre de chaque canal
    for (let u = -hw + 1; u <= hw - 1; u++) {
      if (water.includes(u)) continue;
      const crop = rng.pick(crops);
      for (let v = 1; v < depth - 1; v++) f.set(u, 1, v, crop, crop === B.WHEAT ? rng.int(0, 7) : rng.int(0, 3));
    }
    if (BlockRegistry.has('composter')) f.set(-hw, 1, 0, BlockRegistry.byName('composter').id);
    f.set(hw + 1, 0, 0, B.HAY_BLOCK);
    if (rng.next() < 0.5) f.set(hw + 1, 0, 1, B.HAY_BLOCK);
    if (rng.next() < 0.5) f.set(hw + 1, 1, 0, B.HAY_BLOCK);
    return;
  }
  if (kind === 'pen') {
    // enclos : barrières, portillon côté rue, bottes de foin et abreuvoir
    groundwork(f, t, p, hw, depth, p.ground === B.SAND ? B.SAND : B.GRASS_BLOCK, 3);
    for (let v = 0; v < depth; v++) for (let u = -hw; u <= hw; u++) if (Math.abs(u) === hw || v === 0 || v === depth - 1) f.set(u, 1, v, p.fence);
    f.set(0, 1, 0, p.gate, f.facing);
    f.set(0, 0, -1, p.path);
    f.fill(-1, -1, -2, 1, -1, -2, p.path);
    f.set(-hw + 1, 1, depth - 2, B.HAY_BLOCK);
    f.set(-hw + 1, 2, depth - 2, B.HAY_BLOCK);
    f.set(-hw + 2, 1, depth - 2, B.HAY_BLOCK);
    f.set(hw - 1, 0, depth - 2, B.WATER);
    f.set(hw - 1, 0, depth - 3, B.WATER);
    return;
  }

  // ---------- bâtiments fermés ----------
  let height = 3;
  let style: Palette = p;
  if (kind === 'temple') {
    height = 5;
    style = { ...p, wall: p.flat ? p.wall : B.STONE_BRICKS ?? p.base, corner: p.flat ? p.corner : B.COBBLESTONE, floor: p.flat ? p.floor : B.STONE_BRICKS ?? p.base, accent: p.flat ? p.accent : B.STONE_BRICKS ?? p.base };
  } else if (kind === 'library') height = 4;
  else if (kind === 'forge' || kind === 'mason') style = { ...p, wall: p.flat ? p.wall : B.COBBLESTONE, accent: p.flat ? p.accent : B.COBBLESTONE, floor: p.flat ? p.floor : B.COBBLESTONE };
  else if (kind === 'big') height = 4;
  groundwork(f, t, style, hw, depth, style.floor, height + hw + 4);
  const top = shell(f, style, hw, depth, height);
  windows(f, hw, depth, kind === 'temple' ? [2, 3] : [2]);
  frontDoor(f, style);
  flowerBed(f, style, rng, hw);
  const back = depth - 2;
  const at = (u: number, v: number, b: number, m = 0, dy = 1) => f.set(u, dy, v, b, m);
  const chest = (u: number, v: number) => at(u, v, B.CHEST, (loot << 2) | (out & 3));
  const job = (k: string, u: number, v: number, fb: number = B.CRAFTING_TABLE) => at(u, v, id(k, fb), out);
  const pot = (u: number, v: number) => BlockRegistry.has('flower_pot') && at(u, v, BlockRegistry.byName('flower_pot').id);
  switch (kind) {
    case 'small':
      beds(f, hw, back, 1);
      at(1, back, B.CRAFTING_TABLE);
      at(1, back, B.LANTERN, 0, 2);
      pot(1, 2);
      break;
    case 'medium':
      beds(f, hw, back, 2);
      chest(hw - 1, back);
      at(hw - 1, back - 1, B.FURNACE, out);
      at(hw - 1, 1, B.CRAFTING_TABLE);
      at(-hw + 1, 1, B.LANTERN);
      pot(1, back);
      chimney(f, style, hw, depth, top);
      break;
    case 'big':
      beds(f, hw, back, 3);
      chest(hw - 1, back);
      at(hw - 1, back - 1, B.CRAFTING_TABLE);
      at(hw - 1, back - 2, B.FURNACE, out);
      at(hw - 1, 1, B.BOOKSHELF);
      at(-hw + 1, 1, B.LANTERN);
      at(hw - 2, 1, B.LANTERN);
      if (BlockRegistry.has('red_carpet')) f.fill(-1, 1, 2, 1, 1, 3, BlockRegistry.byName('red_carpet').id);
      chimney(f, style, hw, depth, top);
      break;
    case 'library':
      // bibliothécaire : rayonnages le long des murs, pupitre au fond
      for (let v = 1; v <= back; v++) {
        f.fill(-hw + 1, 1, v, -hw + 1, 3, v, B.BOOKSHELF);
        f.fill(hw - 1, 1, v, hw - 1, 3, v, B.BOOKSHELF);
      }
      job('lectern', 0, back);
      at(-1, back, B.LANTERN);
      at(1, back, B.LANTERN);
      at(-hw + 2, 1, B.CRAFTING_TABLE);
      if (BlockRegistry.has('red_carpet')) f.fill(-1, 1, 2, 1, 1, back - 1, BlockRegistry.byName('red_carpet').id);
      break;
    case 'forge': {
      // armurier (haut fourneau), outilleur (table de forgeron) ou forgeron d'armes (meule) ; bassin de lave
      const station = rng.pick(JOB_SITE.forge!);
      f.set(-hw + 1, 0, back, B.LAVA);
      at(-hw + 1, back, B.AIR);
      job(station, -hw + 2, back);
      at(-hw + 1, back - 1, B.FURNACE, out);
      chest(hw - 1, back);
      at(hw - 1, back - 1, id('anvil', id('smithing_table', B.CRAFTING_TABLE)), f.dir(1, 0));
      at(hw - 1, 1, B.LANTERN);
      chimney(f, style, hw, depth, top);
      break;
    }
    case 'butcher':
      job('smoker', -hw + 1, back, B.FURNACE);
      at(-hw + 2, back, B.CRAFTING_TABLE);
      chest(hw - 1, back);
      at(hw - 1, 1, B.LANTERN);
      chimney(f, style, hw, depth, top);
      break;
    case 'cartographer':
      job('cartography_table', -1, back);
      at(1, back, B.BOOKSHELF);
      at(1, back - 1, B.BOOKSHELF);
      at(1, back, B.LANTERN, 0, 2);
      chest(1, 2);
      break;
    case 'temple':
      // clerc : alambic sur l'autel, vitraux sur deux rangées
      at(0, back, B.STONE_BRICKS ?? B.COBBLESTONE);
      f.set(0, 2, back, id('brewing_stand', B.CRAFTING_TABLE));
      at(-1, back, B.LANTERN);
      at(1, back, B.LANTERN);
      chest(1, 2);
      break;
    case 'fisher':
      job('barrel', -1, back, B.CHEST);
      chest(1, back);
      at(-1, 1, B.LANTERN);
      break;
    case 'fletcher':
      job('fletching_table', -1, back);
      at(1, back, B.CRAFTING_TABLE);
      at(-1, 1, B.LANTERN);
      chest(1, 2);
      break;
    case 'tannery':
      job(rng.next() < 0.5 && BlockRegistry.has('water_cauldron') ? 'water_cauldron' : 'cauldron', -1, back, B.CRAFTING_TABLE);
      chest(1, back);
      at(1, 1, B.LANTERN);
      break;
    case 'mason':
      job('stonecutter', -hw + 1, back);
      at(-hw + 2, back, id('terracotta', B.BRICKS ?? B.COBBLESTONE));
      at(hw - 1, back, id('white_terracotta', id('terracotta', B.COBBLESTONE)));
      chest(hw - 1, back - 1);
      at(hw - 1, 1, B.LANTERN);
      break;
    case 'shepherd': {
      job('loom', -hw + 1, back);
      const colors = ['white_wool', 'yellow_wool', 'red_wool', 'blue_wool', 'lime_wool'].filter((k) => BlockRegistry.has(k));
      at(hw - 1, back, wool());
      at(hw - 1, back, colors.length ? BlockRegistry.byName(rng.pick(colors)).id : wool(), 0, 2);
      at(hw - 2, back, colors.length ? BlockRegistry.byName(rng.pick(colors)).id : wool());
      chest(hw - 1, back - 1);
      at(-hw + 1, 1, B.LANTERN);
      break;
    }
  }
}

/** Requêtes de terrain mises en cache (le village entier est recalculé pour chaque chunk touché). */
function cached(t: TerrainQuery, ox: number, oz: number): TerrainQuery {
  const h = new Map<number, number>();
  return {
    heightAt(x, z) {
      const k = (x - ox + 1024) * 4096 + (z - oz + 1024);
      let v = h.get(k);
      if (v === undefined) h.set(k, (v = t.heightAt(x, z)));
      return v;
    },
    biomeAt: (x, z) => t.biomeAt(x, z),
  };
}

interface Street {
  x: number;
  z: number;
  dx: number;
  dz: number;
  from: number;
  len: number;
  /** Hauteur de la chaussée à chaque pas (index = distance au départ). */
  ys: number[];
  /** Premier pas où l'on peut bâtir. */
  first: number;
}

/** Jeu de bâtiments à placer d'abord (comme le jeu original : un de chaque métier), puis au hasard. */
const DECK: Building[] = ['small', 'medium', 'farm', 'library', 'big', 'forge', 'small', 'butcher', 'medium', 'shepherd', 'big', 'fletcher', 'small', 'cartographer', 'temple', 'medium', 'big_farm', 'mason', 'small', 'tannery', 'fisher', 'big', 'pen'];
const POOL: Building[] = ['small', 'small', 'small', 'medium', 'medium', 'big', 'big', 'farm', 'big_farm', 'pen', 'forge', 'library', 'butcher', 'shepherd'];

/**
 * Village complet autour de (ox, oz) : place (puits, cloche, lampadaires), 2 à 4 rues avec des
 * ruelles, bâtiments le long des rues, porte vers la rue. `loot` : table de butin des coffres.
 */
export function buildVillage(w: StructWriter, ox: number, oz: number, rng: Rng, terrain: TerrainQuery, loot: number) {
  const t = cached(terrain, ox, oz);
  const biome = BiomeManager.get(t.biomeAt(ox, oz)).key;
  const p = palette(biome);
  const cy = Math.max(t.heightAt(ox, oz), SEA_LEVEL) + 1;
  const used: Rect[] = [{ x0: ox - 4, z0: oz - 4, x1: ox + 4, z1: oz + 4 }];
  const paved = new Set<number>();
  const K = (x: number, z: number) => (x - ox + 1024) * 4096 + (z - oz + 1024);

  // chaussée d'une case : remblai ou déblai jusqu'à la hauteur lissée, passerelle sur l'eau
  const pave = (x: number, z: number, y: number) => {
    if (paved.has(K(x, z))) return;
    paved.add(K(x, z));
    const h = t.heightAt(x, z);
    if (h < SEA_LEVEL) w.set(x, y, z, p.flat ? B.SANDSTONE : p.floor);
    else {
      for (let yy = h + 1; yy < y; yy++) w.set(x, yy, z, p.fillGround);
      w.set(x, y, z, p.path);
    }
    for (let yy = y + 1; yy <= Math.max(h, y) + 12; yy++) w.set(x, yy, z, B.AIR);
  };
  const layStreet = (s: Street, y0: number) => {
    let prev = y0;
    const px = -s.dz, pz = s.dx;
    for (let i = s.from; i <= s.len; i++) {
      const cx = s.x + s.dx * i, cz = s.z + s.dz * i;
      const hc = Math.max(t.heightAt(cx, cz), SEA_LEVEL);
      const y = Math.max(SEA_LEVEL, Math.min(prev + 1, Math.max(prev - 1, hc)));
      s.ys[i] = prev = y;
      for (let k = -1; k <= 1; k++) pave(cx + px * k, cz + pz * k, y);
    }
    const ax = s.x + s.dx * s.from, az = s.z + s.dz * s.from, bx = s.x + s.dx * s.len, bz = s.z + s.dz * s.len;
    used.push({ x0: Math.min(ax, bx) - Math.abs(px), z0: Math.min(az, bz) - Math.abs(pz), x1: Math.max(ax, bx) + Math.abs(px), z1: Math.max(az, bz) + Math.abs(pz) });
  };

  // rues principales : bras partant de la place (au moins deux)
  const streets: Street[] = [];
  const start = rng.int(0, 3);
  for (let k = 0; k < 4; k++) {
    const [dx, dz] = FACING_DIR[(start + k) & 3];
    if (k >= 2 && rng.next() < 0.3) continue;
    const s: Street = { x: ox, z: oz, dx, dz, from: 4, len: rng.int(22, 34), ys: [], first: 6 };
    layStreet(s, cy - 1);
    streets.push(s);
  }
  // ruelles perpendiculaires partant des rues principales
  for (const a of [...streets]) {
    if (a.len < 26 || rng.next() < 0.35) continue;
    const j = rng.int(12, a.len - 8), side = rng.next() < 0.5 ? -1 : 1;
    const dx = -a.dz * side, dz = a.dx * side;
    const s: Street = { x: a.x + a.dx * j, z: a.z + a.dz * j, dx, dz, from: 2, len: rng.int(12, 20), ys: [], first: 4 };
    // pas de croisement avec une autre rue
    const ex = s.x + dx * s.len, ez = s.z + dz * s.len, sx = s.x + dx * 2, sz = s.z + dz * 2;
    const r = { x0: Math.min(sx, ex) - 1, z0: Math.min(sz, ez) - 1, x1: Math.max(sx, ex) + 1, z1: Math.max(sz, ez) + 1 };
    if (used.some((u) => overlaps(u, r))) continue;
    layStreet(s, a.ys[j]);
    streets.push(s);
  }

  // place centrale : dallage, puits avec toit et cloche, lampadaires aux coins
  for (let z = oz - 3; z <= oz + 3; z++)
    for (let x = ox - 3; x <= ox + 3; x++) {
      const h = t.heightAt(x, z);
      for (let y = Math.min(h, cy - 1); y < cy; y++) w.set(x, y, z, p.base === B.SANDSTONE ? B.SANDSTONE : B.COBBLESTONE);
      w.set(x, cy - 1, z, p.path);
      for (let y = cy; y <= Math.max(h, cy) + 12; y++) w.set(x, y, z, B.AIR);
    }
  const rimB = p.flat ? B.SANDSTONE : B.COBBLESTONE;
  for (let z = oz - 1; z <= oz + 1; z++)
    for (let x = ox - 1; x <= ox + 1; x++) {
      const rim = x !== ox || z !== oz;
      for (let y = cy - 4; y < cy; y++) w.set(x, y, z, rim ? rimB : B.WATER);
      w.set(x, cy, z, rim ? rimB : B.AIR);
    }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    w.set(ox + dx, cy + 1, oz + dz, p.fence);
    w.set(ox + dx, cy + 2, oz + dz, p.fence);
  }
  for (let z = oz - 1; z <= oz + 1; z++) for (let x = ox - 1; x <= ox + 1; x++) w.set(x, cy + 3, z, p.flat ? p.slab : id('cobblestone_slab', B.COBBLESTONE));
  if (BlockRegistry.has('bell')) w.set(ox + 2, cy, oz + 2, BlockRegistry.byName('bell').id);
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3]]) build('lamp', new Frame(w, ox + dx, cy, oz + dz, 0), t, p, rng, loot);
  w.set(ox - 2, cy, oz + 2, B.HAY_BLOCK);

  // bâtiments des deux côtés de chaque rue, façade (porte) vers la rue
  const deck = [...DECK];
  // mélange local (on puise par la fin) : maisons et ateliers restent alternés
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.max(0, i - rng.int(0, 3));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  deck.reverse();
  const inBounds = (r: Rect) => r.x0 >= ox - REACH && r.x1 <= ox + REACH && r.z0 >= oz - REACH && r.z1 <= oz + REACH;
  for (const s of streets) {
    const px = -s.dz, pz = s.dx;
    for (const side of [-1, 1]) {
      let i = s.first + rng.int(0, 2);
      while (i < s.len) {
        const kind = deck.length ? deck[deck.length - 1] : POOL[rng.int(0, POOL.length - 1)];
        const [hw, depth] = SIZES[kind];
        const along = i + hw;
        if (along > s.len - 1) break;
        // origine : milieu de la façade, à 4 blocs de l'axe de la rue (rue, allée, marche, façade)
        const fx = s.x + s.dx * along + px * side * 4, fz = s.z + s.dz * along + pz * side * 4;
        const facing = dirIndex(px * side, pz * side);
        const probe = new Frame(w, fx, 0, fz, facing);
        const rect = footprint(probe, hw, depth);
        let lo = Infinity, hi = -Infinity;
        for (let v = 0; v < depth; v += Math.max(1, depth >> 2))
          for (const u of [-hw, 0, hw]) {
            const h = t.heightAt(probe.wx(u, v), probe.wz(u, v));
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        // plancher au niveau de la rue (à un bloc près) pour que l'allée soit praticable
        const road = s.ys[along];
        const y = Math.min(road + 2, Math.max(road, Math.round((lo + hi) / 2) + 1));
        const flatEnough = kind === 'farm' || kind === 'big_farm' ? hi - lo <= 4 : hi - lo <= 6;
        const ok = lo >= SEA_LEVEL && flatEnough && hi - y <= 6 && y - 1 - lo <= 6 && inBounds(rect) && !used.some((r) => overlaps(r, rect));
        if (ok) {
          used.push(rect);
          if (deck.length) deck.pop();
          build(kind, new Frame(w, fx, y, fz, facing), t, p, rng, loot);
          i += hw * 2 + 2 + rng.int(1, 2);
        } else i += 2;
      }
    }
  }

  // lampadaires et bottes de foin le long des rues, dans les espaces libres
  for (const s of streets) {
    const px = -s.dz, pz = s.dx;
    for (let i = s.first; i <= s.len; i += 7) {
      const side = (i / 7) & 1 ? 1 : -1;
      const x = s.x + s.dx * i + px * side * 2, z = s.z + s.dz * i + pz * side * 2;
      const r = { x0: x, z0: z, x1: x, z1: z };
      if (used.some((u) => overlaps(u, r)) || !inBounds(r) || t.heightAt(x, z) < SEA_LEVEL) continue;
      used.push(r);
      const y = s.ys[i] + 1;
      for (let yy = t.heightAt(x, z) + 1; yy < y - 1; yy++) w.set(x, yy, z, p.fillGround);
      for (let yy = y; yy <= y + 3; yy++) w.set(x, yy, z, B.AIR);
      if (rng.next() < 0.75) build('lamp', new Frame(w, x, y, z, 0), t, p, rng, loot);
      else {
        w.set(x, y - 1, z, p.ground);
        w.set(x, y, z, B.HAY_BLOCK);
        if (rng.next() < 0.5) w.set(x, y + 1, z, B.HAY_BLOCK);
      }
    }
  }
}

/**
 * Plan d'un bâtiment (liste ordonnée des blocs à poser) : utilisé par les bots du serveur de survie,
 * qui construisent leur maison bloc par bloc. Les blocs d'air (déblaiement) viennent en premier,
 * puis le reste de bas en haut.
 */
export function planBuilding(kind: Building, x: number, y: number, z: number, facing: number, biome: string, t: TerrainQuery, seed = 1): [number, number, number, number, number][] {
  const out = new Map<string, [number, number, number, number, number]>();
  const rec: StructWriter = {
    set: (bx, by, bz, b, m = 0) => void out.set(`${bx},${by},${bz}`, [bx, by, bz, b, m]),
    setIfAir: (bx, by, bz, b, m = 0) => void out.set(`${bx},${by},${bz}`, [bx, by, bz, b, m]),
  };
  build(kind, new Frame(rec, x, y, z, facing), t, palette(biome), new RngImpl(seed), 0);
  const list = [...out.values()];
  return [...list.filter((e) => e[3] === B.AIR), ...list.filter((e) => e[3] !== B.AIR).sort((a, b) => a[1] - b[1])];
}

/** Emprise (demi-largeur, profondeur) d'un bâtiment. */
export function buildingSize(kind: Building): [number, number] {
  return SIZES[kind];
}

/** Liste des types de bâtiments (tests). */
export const BUILDING_KINDS = Object.keys(SIZES) as Building[];
