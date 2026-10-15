/**
 * Structures du jeu de référence (Java 1.21) : pyramide du désert, temple de la jungle, igloo,
 * cabane de sorcière, avant-poste de pillards, épave, ruines sous-marines, portail en ruine et
 * ruines de piste. Même principe que StructureGenerator : chaque construction est déterministe
 * (rng de la région + relief) et passe par le StructWriter « clippé » au chunk courant.
 *
 * Les plans sont décrits dans un repère local (entrée vers -Z) puis tournés d'un quart de tour
 * aléatoire. Orientation des blocs : 0 sud (+Z), 1 ouest (-X), 2 nord (-Z), 3 est (+X).
 *
 * Ce module n'importe StructureGenerator qu'en type (pas de cycle à l'exécution).
 */
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../core/Config';
import { MOB_DEFS } from '../data/mobs';
import { hash3, Rng } from '../util/math';
import { idx, type ChunkData } from './ChunkData';
import { BiomeManager } from './BiomeManager';
import type { StructWriter, TerrainQuery } from './StructureGenerator';

/** Tables de butin ajoutées (bits 2..7 de la méta du coffre : < 64). */
export const MORE_LOOT = {
  DESERT_PYRAMID: 40,
  JUNGLE_TEMPLE: 41,
  IGLOO: 42,
  SHIPWRECK_MAP: 43,
  SHIPWRECK_SUPPLY: 44,
  SHIPWRECK_TREASURE: 45,
  OCEAN_RUIN_SMALL: 46,
  OCEAN_RUIN_BIG: 47,
  RUINED_PORTAL: 48,
  OUTPOST: 49,
} as const;

type Entry = { item: string; min: number; max: number; weight: number };
const T = (item: string, min: number, max: number, weight: number): Entry => ({ item, min, max, weight });

/** Tables proches de celles du jeu de référence (objets absents ignorés par rollLoot). */
export const MORE_LOOT_TABLES: Record<number, { rolls: [number, number]; entries: Entry[] }> = {
  [MORE_LOOT.DESERT_PYRAMID]: {
    rolls: [3, 7],
    entries: [T('bone', 4, 6, 25), T('rotten_flesh', 3, 7, 25), T('gunpowder', 1, 8, 10), T('sand', 1, 8, 10), T('string', 1, 8, 10), T('spider_eye', 1, 3, 25), T('enchanted_book', 1, 1, 20), T('saddle', 1, 1, 20), T('golden_apple', 1, 1, 20), T('enchanted_golden_apple', 1, 1, 2), T('gold_ingot', 2, 7, 15), T('iron_ingot', 1, 5, 15), T('emerald', 1, 3, 15), T('diamond', 1, 3, 5), T('iron_horse_armor', 1, 1, 15), T('golden_horse_armor', 1, 1, 10), T('diamond_horse_armor', 1, 1, 5), T('dune_armor_trim_smithing_template', 1, 1, 3)],
  },
  [MORE_LOOT.JUNGLE_TEMPLE]: {
    rolls: [2, 6],
    entries: [T('diamond', 1, 3, 3), T('iron_ingot', 1, 5, 10), T('gold_ingot', 2, 7, 15), T('emerald', 1, 3, 2), T('bone', 4, 6, 20), T('rotten_flesh', 3, 7, 16), T('saddle', 1, 1, 3), T('iron_horse_armor', 1, 1, 1), T('golden_horse_armor', 1, 1, 1), T('diamond_horse_armor', 1, 1, 1), T('enchanted_book', 1, 1, 1), T('bamboo', 1, 3, 15), T('wild_armor_trim_smithing_template', 1, 1, 2)],
  },
  [MORE_LOOT.IGLOO]: {
    rolls: [2, 8],
    entries: [T('apple', 1, 3, 15), T('coal', 1, 4, 15), T('gold_nugget', 1, 3, 10), T('stone_axe', 1, 1, 2), T('rotten_flesh', 1, 1, 10), T('emerald', 1, 1, 1), T('wheat', 2, 3, 10), T('golden_apple', 1, 1, 3)],
  },
  [MORE_LOOT.SHIPWRECK_MAP]: {
    rolls: [3, 5],
    entries: [T('map', 1, 1, 10), T('compass', 1, 1, 1), T('clock', 1, 1, 1), T('paper', 1, 10, 20), T('feather', 1, 5, 10), T('book', 1, 5, 5), T('coast_armor_trim_smithing_template', 1, 1, 2)],
  },
  [MORE_LOOT.SHIPWRECK_SUPPLY]: {
    rolls: [3, 10],
    entries: [T('paper', 1, 12, 8), T('potato', 2, 6, 7), T('poisonous_potato', 2, 6, 7), T('carrot', 4, 8, 7), T('wheat', 8, 21, 7), T('coal', 2, 8, 6), T('rotten_flesh', 5, 24, 5), T('bamboo', 1, 3, 2), T('gunpowder', 1, 5, 3), T('tnt', 1, 2, 1), T('leather_helmet', 1, 1, 3), T('leather_chestplate', 1, 1, 3), T('leather_boots', 1, 1, 3), T('moss_block', 1, 4, 2), T('pumpkin', 1, 3, 2), T('suspicious_stew', 1, 1, 10), T('coast_armor_trim_smithing_template', 1, 1, 1)],
  },
  [MORE_LOOT.SHIPWRECK_TREASURE]: {
    rolls: [3, 6],
    entries: [T('iron_ingot', 1, 5, 90), T('gold_ingot', 1, 5, 10), T('emerald', 1, 5, 40), T('diamond', 1, 1, 5), T('experience_bottle', 1, 1, 5), T('iron_nugget', 1, 10, 50), T('gold_nugget', 1, 10, 10), T('lapis_lazuli', 1, 10, 20), T('coast_armor_trim_smithing_template', 1, 1, 2)],
  },
  [MORE_LOOT.OCEAN_RUIN_SMALL]: {
    rolls: [2, 8],
    entries: [T('coal', 1, 4, 10), T('stone_axe', 1, 1, 2), T('rotten_flesh', 1, 1, 5), T('emerald', 1, 1, 1), T('wheat', 2, 3, 10), T('gold_nugget', 1, 3, 5), T('leather_chestplate', 1, 1, 1), T('golden_helmet', 1, 1, 1), T('fishing_rod', 1, 1, 1), T('map', 1, 1, 5), T('enchanted_book', 1, 1, 1)],
  },
  [MORE_LOOT.OCEAN_RUIN_BIG]: {
    rolls: [2, 8],
    entries: [T('coal', 1, 4, 10), T('gold_nugget', 1, 3, 10), T('emerald', 1, 1, 1), T('wheat', 2, 3, 10), T('golden_apple', 1, 1, 1), T('enchanted_book', 1, 1, 5), T('leather_chestplate', 1, 1, 1), T('golden_helmet', 1, 1, 1), T('fishing_rod', 1, 1, 5), T('map', 1, 1, 10)],
  },
  [MORE_LOOT.RUINED_PORTAL]: {
    rolls: [4, 8],
    entries: [T('obsidian', 1, 2, 40), T('flint', 1, 4, 40), T('iron_nugget', 9, 18, 40), T('flint_and_steel', 1, 1, 40), T('fire_charge', 1, 1, 40), T('golden_apple', 1, 1, 15), T('gold_nugget', 4, 24, 15), T('golden_sword', 1, 1, 15), T('golden_axe', 1, 1, 15), T('golden_hoe', 1, 1, 15), T('golden_shovel', 1, 1, 15), T('golden_pickaxe', 1, 1, 15), T('golden_boots', 1, 1, 15), T('golden_chestplate', 1, 1, 15), T('golden_helmet', 1, 1, 15), T('golden_leggings', 1, 1, 15), T('glistering_melon_slice', 4, 12, 5), T('golden_horse_armor', 1, 1, 5), T('light_weighted_pressure_plate', 1, 1, 5), T('golden_carrot', 4, 12, 5), T('clock', 1, 1, 5), T('gold_ingot', 2, 8, 5), T('bell', 1, 1, 1), T('enchanted_golden_apple', 1, 1, 1), T('gold_block', 1, 2, 1)],
  },
  [MORE_LOOT.OUTPOST]: {
    rolls: [2, 5],
    entries: [T('crossbow', 1, 1, 1), T('wheat', 3, 5, 7), T('potato', 2, 5, 5), T('carrot', 3, 5, 5), T('dark_oak_log', 2, 3, 10), T('experience_bottle', 1, 1, 7), T('string', 1, 6, 4), T('arrow', 2, 7, 4), T('tripwire_hook', 1, 3, 3), T('iron_ingot', 1, 3, 3), T('enchanted_book', 1, 1, 1), T('goat_horn', 1, 1, 1), T('sentry_armor_trim_smithing_template', 1, 1, 2)],
  },
};

/** Même forme que StructureType (StructureGenerator) + `aquatic` : autorisé sous le niveau de la mer. */
export interface MoreStructureType {
  key: string;
  spacing: number;
  chance: number;
  radius: number;
  underground?: boolean;
  anyBiome?: boolean;
  aquatic?: boolean;
  build(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery): void;
  site?(t: TerrainQuery, x: number, z: number): boolean;
}

// ---------- utilitaires ----------
/** Bloc par nom (repli si absent : les blocs du pack sont enregistrés au démarrage). */
const K = (key: string, fb: number = B.STONE) => (BlockRegistry.has(key) ? BlockRegistry.byName(key).id : fb);
const chestMeta = (loot: number, dir = 0) => (loot << 2) | (dir & 3);
/** Méta d'un distributeur piégé (temple de la jungle) ; bit 32 : déjà garni de flèches. */
export const DISPENSER_TRAP_BIT = 16;
const DISPENSER_STOCKED_BIT = 32;

interface TrapWorld {
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number, meta?: number, scheduleUpdates?: boolean): unknown;
  getChest(x: number, y: number, z: number, create?: boolean, size?: number): { add(st: { id: string; count: number }): number } | null;
}
/** Fil de déclenchement (ou crochet) foulé ? */
export function isTripwire(id: number) {
  const k = BlockRegistry.get(id).key;
  return id > 0 && (k === 'tripwire' || k === 'tripwire_hook');
}
/**
 * Piège du temple de la jungle : les distributeurs piégés proches (garnis de flèches la première
 * fois, comme ceux du jeu de référence) tirent via `fire`.
 */
export function springTripwire(w: TrapWorld, x: number, y: number, z: number, fire: (x: number, y: number, z: number) => void) {
  if (!BlockRegistry.has('dispenser')) return 0;
  const disp = BlockRegistry.byName('dispenser').id;
  let n = 0;
  for (let dy = -1; dy <= 3; dy++)
    for (let dz = -8; dz <= 8; dz++)
      for (let dx = -8; dx <= 8; dx++) {
        const px = x + dx, py = y + dy, pz = z + dz;
        if (w.getBlock(px, py, pz) !== disp) continue;
        const m = w.getMeta(px, py, pz);
        if (!(m & DISPENSER_TRAP_BIT)) continue;
        if (!(m & DISPENSER_STOCKED_BIT)) {
          w.getChest(px, py, pz, true, 9)?.add({ id: 'arrow', count: 2 + ((px * 31 + pz * 17 + py) & 7) });
          w.setBlock(px, py, pz, disp, m | DISPENSER_STOCKED_BIT, false);
        }
        fire(px, py, pz);
        n++;
      }
  return n;
}
const mobIndex = (key: string) => MOB_DEFS.findIndex((d) => d.key === key);
const S = 0, W = 1, N = 2, E = 3;
const DIRS: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];

/** Écriture dans un repère local tourné de r quarts de tour autour de (ox, oz). */
class Local {
  constructor(readonly w: StructWriter, readonly t: TerrainQuery, readonly ox: number, readonly oz: number, readonly r: number) {}
  wx(lx: number, lz: number): [number, number] {
    switch (this.r & 3) {
      case 0: return [this.ox + lx, this.oz + lz];
      case 1: return [this.ox - lz, this.oz + lx];
      case 2: return [this.ox - lx, this.oz - lz];
      default: return [this.ox + lz, this.oz - lx];
    }
  }
  set(lx: number, y: number, lz: number, b: number, m = 0) {
    const [x, z] = this.wx(lx, lz);
    this.w.set(x, y, z, b, m);
  }
  ifAir(lx: number, y: number, lz: number, b: number, m = 0) {
    const [x, z] = this.wx(lx, lz);
    this.w.setIfAir(x, y, z, b, m);
  }
  /** Bloc orienté : `f` en repère local, bits supplémentaires dans `extra`. */
  face(lx: number, y: number, lz: number, b: number, f: number, extra = 0) {
    this.set(lx, y, lz, b, extra | ((f + this.r) & 3));
  }
  /** Torche / levier mural : `f` = direction du mur porteur (méta f + 1) ; sans f : posé au sol. */
  wall(lx: number, y: number, lz: number, b: number, f?: number, extra = 0) {
    this.set(lx, y, lz, b, extra | (f === undefined ? 0 : ((f + this.r) & 3) + 1));
  }
  chest(lx: number, y: number, lz: number, loot: number, f: number) {
    this.set(lx, y, lz, B.CHEST, chestMeta(loot, (f + this.r) & 3));
  }
  bed(lx: number, y: number, lz: number, f: number) {
    const bed = K('red_bed', B.WHITE_WOOL ?? B.OAK_PLANKS);
    const [dx, dz] = DIRS[f];
    this.face(lx, y, lz, bed, f);
    this.face(lx + dx, y, lz + dz, bed, f, 4);
  }
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: number | (() => number), m = 0) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, typeof b === 'number' ? b : b(), m);
  }
  /** Vide : eau sous le niveau de la mer (structures immergées), air au-dessus. */
  clear(lx: number, y: number, lz: number, wet = true) {
    this.set(lx, y, lz, wet && y <= SEA_LEVEL ? B.WATER : B.AIR);
  }
  h(lx: number, lz: number) {
    const [x, z] = this.wx(lx, lz);
    return this.t.heightAt(x, z);
  }
  /** Remblai sous (lx, lz) depuis le sol jusqu'à y - 1. */
  pillar(lx: number, lz: number, y: number, b: number) {
    const h = Math.min(this.h(lx, lz), y - 1);
    for (let yy = Math.max(1, h - 1); yy < y; yy++) this.set(lx, yy, lz, b);
  }
}

/** Relief échantillonné sur un carré de demi-côté r. */
function relief(t: TerrainQuery, x: number, z: number, r: number, step = Math.max(2, r >> 1)) {
  let lo = Infinity, hi = -Infinity, wet = 0, sum = 0, n = 0;
  for (let dz = -r; dz <= r; dz += step)
    for (let dx = -r; dx <= r; dx += step) {
      const h = t.heightAt(x + dx, z + dz);
      if (h < SEA_LEVEL) wet++;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      sum += h;
      n++;
    }
  return { lo, hi, wet, avg: sum / n };
}
const biomeKey = (t: TerrainQuery, x: number, z: number) => BiomeManager.get(t.biomeAt(x, z)).key;

// ---------- pyramide du désert ----------
function desertPyramid(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery) {
  const L = new Local(w, t, ox, oz, rng.int(0, 3));
  const SS = B.SANDSTONE, CUT = K('cut_sandstone', SS), CH = K('chiseled_sandstone', SS), SM = K('smooth_sandstone', SS);
  const OR = K('orange_terracotta', SS), BL = K('blue_terracotta', OR), STAIRS = K('sandstone_stairs', SS);
  // comme le jeu de référence : légèrement enfouie dans les dunes
  const y0 = Math.round(relief(t, ox, oz, 10, 5).avg);
  // fondation
  for (let lz = -10; lz <= 10; lz++) for (let lx = -10; lx <= 10; lx++) L.pillar(lx, lz, y0 - 1, SS);
  L.fill(-10, y0 - 1, -10, 10, y0 - 1, 10, SS);
  // corps : murs droits sur 4 rangs puis gradins jusqu'au sommet
  for (let k = 0; k <= 13; k++) {
    const r = k < 4 ? 10 : 13 - k;
    const y = y0 + k;
    for (let lz = -10; lz <= 10; lz++)
      for (let lx = -10; lx <= 10; lx++) {
        const m = Math.max(Math.abs(lx), Math.abs(lz));
        if (m > r) {
          if (m <= 10) L.set(lx, y, lz, B.AIR);
          continue;
        }
        L.set(lx, y, lz, m === r ? (k === 3 && r === 10 ? CUT : SS) : B.AIR);
      }
  }
  // sol de la salle : rosace de terre cuite (bleue au centre)
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.abs(dx) + Math.abs(dz);
      if (d === 0) L.set(dx, y0 - 1, dz, BL);
      else if (d <= 2 || (Math.abs(dx) === 2 && Math.abs(dz) === 2)) L.set(dx, y0 - 1, dz, OR);
    }
  // piliers de la salle
  for (const [px, pz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
    L.fill(px, y0, pz, px, y0 + 6, pz, CUT);
    L.set(px, y0 + 2, pz, OR);
    L.set(px, y0 + 6, pz, CH);
  }
  // tours d'angle (façade nord) avec motif de terre cuite orange
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -10 : 6, x1 = sx < 0 ? -6 : 10, cx = sx * 8;
    for (let y = y0 - 1; y <= y0 + 13; y++)
      for (let lz = -10; lz <= -6; lz++)
        for (let lx = x0; lx <= x1; lx++) {
          const edge = lx === x0 || lx === x1 || lz === -10 || lz === -6 || y === y0 - 1 || y === y0 + 13;
          L.set(lx, y, lz, edge ? SS : B.AIR);
        }
    // façade avant et latérale
    for (const [fx, fz, ax] of [[cx, -10, true], [sx * 10, -8, false]] as [number, number, boolean][]) {
      const at = (d: number, y: number, b: number) => (ax ? L.set(fx + d, y, fz, b) : L.set(fx, y, fz + d, b));
      at(0, y0 + 2, OR);
      at(0, y0 + 5, OR);
      at(-1, y0 + 6, OR);
      at(0, y0 + 6, BL);
      at(1, y0 + 6, OR);
      at(0, y0 + 7, OR);
      at(0, y0 + 9, CH);
      for (let d = -1; d <= 1; d++) at(d, y0 + 10, OR);
      for (let d = -2; d <= 2; d++) at(d, y0 + 11, CUT);
    }
    // créneaux
    for (let lz = -10; lz <= -6; lz++)
      for (let lx = x0; lx <= x1; lx++)
        if ((lx === x0 || lx === x1 || lz === -10 || lz === -6) && (lx + lz) % 2 === 0) L.set(lx, y0 + 14, lz, SM);
    // porte vers la salle + échelle jusqu'au toit de la tour
    const inner = sx < 0 ? -6 : 6;
    L.set(inner, y0, -8, B.AIR);
    L.set(inner, y0 + 1, -8, B.AIR);
    const lad = K('ladder', B.OAK_PLANKS);
    const lx = sx < 0 ? -9 : 9;
    for (let y = y0; y <= y0 + 13; y++) L.face(lx, y, -8, lad, sx < 0 ? W : E);
  }
  // entrée principale (3 de large) et marches, entrées latérales
  L.fill(-1, y0, -10, 1, y0 + 2, -9, B.AIR);
  L.fill(-2, y0, -10, -2, y0 + 3, -10, CUT);
  L.fill(2, y0, -10, 2, y0 + 3, -10, CUT);
  for (let d = -1; d <= 1; d++) L.set(d, y0 + 3, -10, OR);
  L.set(0, y0 + 4, -10, CH);
  for (let d = -1; d <= 1; d++) {
    L.face(d, y0 - 1, -11, STAIRS, S);
    L.pillar(d, -11, y0 - 1, SS);
  }
  for (const sx of [-10, 10]) {
    L.set(sx, y0, 0, B.AIR);
    L.set(sx, y0 + 1, 0, B.AIR);
    L.set(sx, y0 + 2, 0, OR);
  }
  // chambre secrète : puits sous la terre cuite bleue, 4 coffres et piège (plaque + 9 TNT)
  const yc = y0 - 12;
  L.fill(-1, yc + 3, -1, 1, y0 - 2, 1, SS);
  L.fill(0, yc + 3, 0, 0, y0 - 2, 0, B.AIR);
  for (let y = yc - 3; y <= yc + 3; y++)
    for (let lz = -4; lz <= 4; lz++)
      for (let lx = -4; lx <= 4; lx++) {
        const inside = Math.abs(lx) <= 3 && Math.abs(lz) <= 3 && y >= yc && y <= yc + 2;
        const recess = y === yc && ((lx === 0 && Math.abs(lz) === 3) || (lz === 0 && Math.abs(lx) === 3));
        if (inside && (Math.abs(lx) <= 2 && Math.abs(lz) <= 2)) L.set(lx, y, lz, B.AIR);
        else if (recess) continue;
        else if (y >= yc && y <= yc + 2 && Math.abs(lx) <= 3 && Math.abs(lz) <= 3) {
          // murs : grès taillé, colonnes ciselées et terre cuite orange autour des niches
          const pillar = (Math.abs(lx) === 1 && Math.abs(lz) === 3) || (Math.abs(lz) === 1 && Math.abs(lx) === 3);
          L.set(lx, y, lz, pillar ? (y === yc + 1 ? OR : CH) : CUT);
        } else if (y !== yc + 3 || lx !== 0 || lz !== 0) L.set(lx, y, lz, SS);
      }
  L.fill(-1, yc - 2, -1, 1, yc - 2, 1, B.TNT);
  L.set(0, yc, 0, B.STONE_PRESSURE_PLATE);
  L.chest(0, yc, -3, MORE_LOOT.DESERT_PYRAMID, S);
  L.chest(0, yc, 3, MORE_LOOT.DESERT_PYRAMID, N);
  L.chest(-3, yc, 0, MORE_LOOT.DESERT_PYRAMID, E);
  L.chest(3, yc, 0, MORE_LOOT.DESERT_PYRAMID, W);
}

// ---------- temple de la jungle ----------
function jungleTemple(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery) {
  const L = new Local(w, t, ox, oz, rng.int(0, 3));
  const MOSSY = B.MOSSY_COBBLESTONE, COB = B.COBBLESTONE, CH = K('chiseled_stone_bricks', B.STONE_BRICKS);
  const stone = () => (rng.next() < 0.45 ? MOSSY : COB);
  const STAIRS = K('mossy_cobblestone_stairs', K('cobblestone_stairs', COB)), CSTAIRS = K('cobblestone_stairs', COB);
  const y0 = Math.round(relief(t, ox, oz, 7, 7).avg) + 1, yb = y0 - 4;
  // fondation et dégagement au-dessus
  for (let lz = -7; lz <= 7; lz++)
    for (let lx = -5; lx <= 5; lx++) {
      L.pillar(lx, lz, yb - 1, COB);
      for (let y = y0 + 4; y <= y0 + 14; y++) L.set(lx, y, lz, B.AIR);
    }
  // sous-sol + rez-de-chaussée : coque pleine, planchers
  for (let y = yb - 1; y <= y0 + 3; y++)
    for (let lz = -7; lz <= 7; lz++)
      for (let lx = -5; lx <= 5; lx++) {
        const edge = Math.abs(lx) === 5 || Math.abs(lz) === 7 || y === yb - 1 || y === y0 - 1 || y === y0 + 3;
        L.set(lx, y, lz, edge ? stone() : B.AIR);
      }
  // étage
  for (let y = y0 + 3; y <= y0 + 7; y++)
    for (let lz = -5; lz <= 5; lz++)
      for (let lx = -4; lx <= 4; lx++) {
        const edge = Math.abs(lx) === 4 || Math.abs(lz) === 5 || y === y0 + 3 || y === y0 + 7;
        L.set(lx, y, lz, edge ? stone() : B.AIR);
      }
  // toit en gradins
  for (let lz = -5; lz <= 5; lz++)
    for (let lx = -4; lx <= 4; lx++) {
      if (Math.abs(lx) === 4 || Math.abs(lz) === 5) {
        const f = lz === -5 ? S : lz === 5 ? N : lx === -4 ? E : W;
        L.face(lx, y0 + 8, lz, STAIRS, f);
      } else L.set(lx, y0 + 8, lz, stone());
    }
  L.fill(-1, y0 + 9, -2, 1, y0 + 9, 2, stone);
  L.fill(0, y0 + 10, -1, 0, y0 + 10, 1, CH);
  // façade : entrée, colonnes ciselées, marches
  L.fill(-1, y0, -7, 1, y0 + 2, -7, B.AIR);
  for (const px of [-3, 3]) L.fill(px, y0, -7, px, y0 + 3, -7, CH);
  for (let d = -1; d <= 1; d++) {
    L.face(d, y0 - 1, -8, CSTAIRS, S);
    L.pillar(d, -8, y0 - 1, COB);
  }
  L.set(0, y0 + 5, -5, B.AIR);
  L.set(0, y0 + 4, -5, B.AIR);
  // fenêtres
  for (const sx of [-5, 5]) for (const lz of [-4, 0, 4]) L.set(sx, y0 + 1, lz, B.AIR);
  for (const sx of [-4, 4]) for (const lz of [-2, 2]) L.set(sx, y0 + 5, lz, B.AIR);
  // accès à l'étage : échelle contre un pilier, débouchant dans la salle du haut
  const lad = K('ladder', B.OAK_PLANKS);
  L.fill(-3, y0, 5, -3, y0 + 2, 5, CH);
  for (let y = y0; y <= y0 + 4; y++) L.face(-3, y, 4, lad, S);
  // escalier vers le sous-sol (côté est)
  for (let s = 1; s <= 4; s++) {
    const z = s;
    for (const lx of [3, 4]) {
      for (let y = y0 - s; y <= y0 + 2; y++) L.set(lx, y, z, B.AIR);
      if (s < 4) L.face(lx, y0 - 1 - s, z, CSTAIRS, N);
    }
  }
  // sous-sol : cloison (x = 1), couloir piégé à l'est, salle aux leviers à l'ouest
  L.fill(1, yb, -6, 1, yb + 2, 6, stone);
  L.fill(1, yb, 5, 1, yb + 1, 6, B.AIR);
  // piège : fil tendu en travers du couloir, deux distributeurs braqués dessus
  const hook = K('tripwire_hook', B.AIR), wire = K('tripwire', B.AIR), disp = K('dispenser', COB);
  L.set(2, yb, -1, hook);
  L.set(3, yb, -1, wire);
  L.set(4, yb, -1, hook);
  L.face(3, yb + 1, -7, disp, S, DISPENSER_TRAP_BIT);
  L.face(5, yb + 1, -1, disp, W, DISPENSER_TRAP_BIT);
  const vine = K('vine', B.AIR);
  L.set(3, yb + 2, -6, vine);
  // premier coffre au bout du couloir
  L.chest(3, yb, -6, MORE_LOOT.JUNGLE_TEMPLE, S);
  // énigme des leviers (décor) : la niche secrète est murée par des briques ciselées
  const lever = K('lever', B.AIR);
  for (const lx of [-3, -2, -1]) L.wall(lx, yb + 1, 6, lever, S);
  L.fill(-4, yb, -4, -1, yb + 2, -4, CH);
  L.fill(-1, yb, -6, -1, yb + 2, -5, CH);
  L.chest(-3, yb, -6, MORE_LOOT.JUNGLE_TEMPLE, S);
  if (BlockRegistry.has('sticky_piston')) L.set(-2, yb + 2, -5, K('sticky_piston'));
  // éclairage discret et lianes sur la façade
  L.wall(-4, yb + 2, 0, B.TORCH, W);
  for (let i = 0; i < 18; i++) {
    const lx = rng.int(-5, 5), y = y0 + rng.int(0, 6), side = rng.next() < 0.5 ? -8 : 8;
    if (y > y0 + 2 && Math.abs(lx) > 4) continue;
    L.ifAir(lx, y, side, vine);
  }
}

// ---------- igloo ----------
function igloo(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery) {
  const L = new Local(w, t, ox, oz, rng.int(0, 3));
  const SNOW = K('snow_block', B.WHITE_WOOL ?? B.STONE), ICE = K('ice', B.GLASS);
  const y0 = t.heightAt(ox, oz) + 1;
  // fondation, dôme (ellipsoïde creux) et sol
  for (let lz = -4; lz <= 4; lz++)
    for (let lx = -4; lx <= 4; lx++) {
      const d2 = (lx * lx + lz * lz) / (3.6 * 3.6);
      if (d2 > 1) continue;
      L.pillar(lx, lz, y0 - 1, SNOW);
      L.set(lx, y0 - 1, lz, SNOW);
      for (let y = y0; y <= y0 + 5; y++) {
        const dy = (y - y0 + 1) / 4.3;
        const outer = d2 + dy * dy <= 1;
        const inner = (lx * lx + lz * lz) / (2.6 * 2.6) + ((y - y0 + 1) / 3.4) ** 2 <= 1;
        L.set(lx, y, lz, inner ? B.AIR : outer ? SNOW : B.AIR);
      }
    }
  // tunnel d'entrée
  for (const lz of [-4, -5]) {
    L.pillar(-1, lz, y0 - 1, SNOW);
    L.pillar(0, lz, y0 - 1, SNOW);
    L.pillar(1, lz, y0 - 1, SNOW);
    L.fill(-1, y0 - 1, lz, 1, y0 - 1, lz, SNOW);
    L.fill(-1, y0, lz, -1, y0 + 1, lz, SNOW);
    L.fill(1, y0, lz, 1, y0 + 1, lz, SNOW);
    L.fill(-1, y0 + 2, lz, 1, y0 + 2, lz, SNOW);
    L.fill(0, y0, lz, 0, y0 + 1, lz, B.AIR);
  }
  L.fill(0, y0, -3, 0, y0 + 1, -3, B.AIR);
  // fenêtres de glace
  L.set(-3, y0 + 1, 0, ICE);
  L.set(3, y0 + 1, 0, ICE);
  // tapis, lit, fourneau, établi, torche de redstone
  const carpet = K('white_carpet', B.AIR);
  for (let lz = -2; lz <= 2; lz++) for (let lx = -2; lx <= 2; lx++) if (lx * lx + lz * lz <= 6) L.set(lx, y0, lz, carpet);
  L.bed(2, y0, -1, S);
  L.set(-2, y0, -1, K('crafting_table', B.OAK_PLANKS));
  L.face(-2, y0, 0, K('furnace', B.COBBLESTONE), E);
  L.wall(0, y0 + 1, 2, K('redstone_torch', B.TORCH), S);
  // sous-sol (une fois sur deux) : trappe sous le tapis, puits à échelle, laboratoire
  if (rng.next() < 0.5) return;
  const depth = rng.int(5, 9), yb = y0 - 1 - depth;
  const SB = () => (rng.next() < 0.2 ? B.MOSSY_STONE_BRICKS ?? B.STONE_BRICKS : rng.next() < 0.15 ? B.CRACKED_STONE_BRICKS ?? B.STONE_BRICKS : B.STONE_BRICKS);
  L.face(0, y0 - 1, 1, K('oak_trapdoor', B.OAK_PLANKS), S, 8);
  L.fill(-1, yb, 0, 1, y0 - 2, 2, SB);
  for (let y = yb - 1; y <= yb + 3; y++)
    for (let lz = 1; lz <= 10; lz++)
      for (let lx = -4; lx <= 4; lx++) {
        const edge = Math.abs(lx) === 4 || lz === 1 || lz === 10 || y === yb - 1 || y === yb + 3;
        L.set(lx, y, lz, edge ? SB() : B.AIR);
      }
  // échelle dans une niche du mur nord, de la trappe jusqu'au sol du laboratoire
  const lad = K('ladder', B.OAK_PLANKS);
  for (let y = yb; y <= y0 - 2; y++) L.face(0, y, 1, lad, N);
  L.set(-2, yb, 3, K('brewing_stand', B.CAULDRON ?? B.STONE));
  L.set(-3, yb, 3, K('water_cauldron', K('cauldron', B.STONE)));
  L.chest(2, yb, 3, MORE_LOOT.IGLOO, W);
  L.set(3, yb, 4, K('crafting_table', B.OAK_PLANKS));
  // deux cellules derrière des barreaux
  const bars = K('iron_bars', B.GLASS);
  for (const sx of [-1, 1]) {
    L.fill(sx * 1, yb, 7, sx * 1, yb + 2, 9, SB);
    for (let lx = Math.min(sx * 2, sx * 3); lx <= Math.max(sx * 2, sx * 3); lx++) L.fill(lx, yb, 7, lx, yb + 2, 7, bars);
  }
  L.fill(0, yb, 9, 0, yb + 2, 9, SB);
  L.wall(0, yb + 2, 8, K('redstone_torch', B.TORCH), S);
  L.wall(-3, yb + 2, 2, B.TORCH, N);
}

// ---------- cabane de sorcière ----------
function witchHut(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery) {
  const L = new Local(w, t, ox, oz, rng.int(0, 3));
  const PL = K('spruce_planks', B.OAK_PLANKS), LOG = B.OAK_LOG, ST = K('spruce_stairs', PL), FENCE = K('oak_fence', LOG);
  let hmax = -Infinity;
  for (const [lx, lz] of [[-3, -5], [3, -5], [-3, 3], [3, 3], [0, 0]]) hmax = Math.max(hmax, L.h(lx, lz));
  const yf = Math.max(SEA_LEVEL + 3, hmax + 2);
  // pilotis
  for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [-3, -5], [3, -5]]) {
    const h = L.h(lx, lz);
    for (let y = Math.min(h, yf - 1); y < yf; y++) L.set(lx, y, lz, LOG);
  }
  // dégagement, plancher et murs
  L.fill(-4, yf + 1, -6, 4, yf + 7, 4, B.AIR);
  L.fill(-3, yf, -5, 3, yf, 3, PL);
  for (let y = yf + 1; y <= yf + 3; y++)
    for (let lz = -3; lz <= 3; lz++)
      for (let lx = -3; lx <= 3; lx++) {
        const ex = Math.abs(lx) === 3, ez = Math.abs(lz) === 3;
        if (!ex && !ez) continue;
        L.set(lx, y, lz, ex && ez ? LOG : PL);
      }
  // porte et fenêtres (barrières)
  L.set(0, yf + 1, -3, B.AIR);
  L.set(0, yf + 2, -3, B.AIR);
  for (const sx of [-3, 3]) L.set(sx, yf + 2, 0, FENCE);
  L.set(0, yf + 2, 3, FENCE);
  // garde-corps du porche
  for (const sx of [-3, 3]) for (const lz of [-5, -4]) L.set(sx, yf + 1, lz, FENCE);
  // toit à deux pans (escaliers de sapin), débord d'un bloc
  for (let lz = -6; lz <= 4; lz++) {
    L.face(-4, yf + 4, lz, ST, E);
    L.face(4, yf + 4, lz, ST, W);
    L.fill(-3, yf + 4, lz, 3, yf + 4, lz, PL);
    L.face(-3, yf + 5, lz, ST, E);
    L.face(3, yf + 5, lz, ST, W);
    L.fill(-2, yf + 5, lz, 2, yf + 5, lz, PL);
  }
  // mobilier : chaudron, établi, pot de fleurs
  L.set(2, yf + 1, 2, K('cauldron', B.STONE));
  L.set(-2, yf + 1, 2, K('crafting_table', B.OAK_PLANKS));
  L.set(-2, yf + 1, -2, K('flower_pot', B.AIR));
}

// ---------- avant-poste de pillards ----------
function outpost(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery) {
  const L = new Local(w, t, ox, oz, rng.int(0, 3));
  const LOG = K('dark_oak_log', B.OAK_LOG), PL = K('dark_oak_planks', B.OAK_PLANKS), BIRCH = K('birch_planks', B.OAK_PLANKS);
  const FENCE = K('dark_oak_fence', K('oak_fence', LOG)), ST = K('dark_oak_stairs', PL), SLAB = K('dark_oak_slab', PL), COB = B.COBBLESTONE;
  const y0 = t.heightAt(ox, oz) + 1;
  // dégagement et fondation
  for (let lz = -5; lz <= 5; lz++)
    for (let lx = -5; lx <= 5; lx++) {
      L.pillar(lx, lz, y0, COB);
      for (let y = y0; y <= y0 + 23; y++) L.set(lx, y, lz, B.AIR);
    }
  L.fill(-4, y0 - 1, -4, 4, y0 - 1, 4, COB);
  // tour : 3 niveaux, poteaux de chêne noir
  for (let y = y0; y <= y0 + 13; y++)
    for (let lz = -3; lz <= 3; lz++)
      for (let lx = -3; lx <= 3; lx++) {
        const ex = Math.abs(lx) === 3, ez = Math.abs(lz) === 3;
        if (!ex && !ez) continue;
        L.set(lx, y, lz, ex && ez ? LOG : y < y0 + 4 ? COB : (y - y0) % 5 === 4 ? BIRCH : PL);
      }
  for (const y of [y0 + 4, y0 + 9]) L.fill(-2, y, -2, 2, y, 2, PL);
  // porte, fenêtres à barrières
  L.fill(0, y0, -3, 0, y0 + 1, -3, B.AIR);
  for (const y of [y0 + 6, y0 + 7, y0 + 11, y0 + 12])
    for (const [lx, lz] of [[0, -3], [0, 3], [-3, 0], [3, 0]]) L.set(lx, y, lz, FENCE);
  // échelle jusqu'à la plate-forme
  const lad = K('ladder', B.OAK_PLANKS);
  // plate-forme supérieure (11×11) et garde-corps
  L.fill(-5, y0 + 14, -5, 5, y0 + 14, 5, PL);
  for (let lz = -5; lz <= 5; lz++) for (let lx = -5; lx <= 5; lx++) if (Math.abs(lx) === 5 || Math.abs(lz) === 5) L.set(lx, y0 + 15, lz, FENCE);
  for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) L.fill(lx, y0 + 14, lz, lx, y0 + 18, lz, LOG);
  for (let y = y0; y <= y0 + 14; y++) L.face(2, y, 2, lad, E);
  // toit pyramidal
  for (let k = 0; k <= 4; k++) {
    const r = 4 - k, y = y0 + 19 + k;
    for (let lz = -r; lz <= r; lz++)
      for (let lx = -r; lx <= r; lx++) {
        const edge = Math.abs(lx) === r || Math.abs(lz) === r;
        if (r === 0) L.set(lx, y, lz, SLAB);
        else if (edge) L.face(lx, y, lz, ST, lz === -r ? S : lz === r ? N : lx === -r ? E : W);
        else L.set(lx, y, lz, PL);
      }
  }
  // coffre au sommet, lanterne
  L.chest(-2, y0 + 15, 2, MORE_LOOT.OUTPOST, E);
  L.set(-2, y0 + 15, -2, B.LANTERN);
  // pillards : générateur au rez-de-chaussée (comme le jeu de référence, ils y réapparaissent)
  const pil = mobIndex('pillager');
  if (pil >= 0) L.set(0, y0, 1, B.SPAWNER, pil);
  L.wall(-2, y0 + 2, 0, B.TORCH, W);
  // dépendances autour : cage, tente, cible, tas de bûches
  const spots: [number, number][] = [[11, 0], [-11, 2], [2, 11], [-3, -11], [9, 9], [-9, -8]];
  for (let i = spots.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const feats = ['cage', 'tent', 'target', 'logs'];
  for (let i = 0; i < feats.length; i++) {
    if (i >= 2 && rng.next() < 0.4) continue;
    const [cx, cz] = spots[i];
    const gy = L.h(cx, cz) + 1;
    if (gy < SEA_LEVEL + 1) continue;
    const f = feats[i];
    if (f === 'cage') {
      for (let lz = -2; lz <= 2; lz++) for (let lx = -2; lx <= 2; lx++) L.pillar(cx + lx, cz + lz, gy, COB);
      L.fill(cx - 2, gy - 1, cz - 2, cx + 2, gy - 1, cz + 2, PL);
      L.fill(cx - 2, gy, cz - 2, cx + 2, gy + 4, cz + 2, B.AIR);
      for (let lz = -2; lz <= 2; lz++)
        for (let lx = -2; lx <= 2; lx++) {
          const ex = Math.abs(lx) === 2, ez = Math.abs(lz) === 2;
          if (ex || ez) L.fill(cx + lx, gy, cz + lz, cx + lx, gy + 2, cz + lz, ex && ez ? LOG : FENCE);
        }
      L.fill(cx - 2, gy + 3, cz - 2, cx + 2, gy + 3, cz + 2, PL);
    } else if (f === 'tent') {
      const wool = K('white_wool', PL);
      L.fill(cx - 3, gy, cz - 2, cx + 3, gy + 3, cz + 2, B.AIR);
      for (let k = 0; k < 3; k++) {
        L.fill(cx - 3 + k, gy + k, cz - 2, cx - 3 + k, gy + k, cz + 2, wool);
        L.fill(cx + 3 - k, gy + k, cz - 2, cx + 3 - k, gy + k, cz + 2, wool);
      }
      L.fill(cx, gy + 3, cz - 2, cx, gy + 3, cz + 2, LOG);
      L.set(cx, gy, cz + 1, K('crafting_table', PL));
    } else if (f === 'target') {
      L.set(cx, gy, cz, FENCE);
      L.set(cx, gy + 1, cz, K('hay_block', PL));
      L.face(cx, gy + 2, cz, K('carved_pumpkin', K('pumpkin', PL)), N);
      L.set(cx + 2, gy, cz, K('target', K('hay_block', PL)));
    } else {
      for (let k = -1; k <= 1; k++) L.fill(cx + k, gy, cz, cx + k, gy + (k === 0 ? 1 : 0), cz, LOG);
      L.set(cx + 2, gy, cz + 1, K('pumpkin', PL));
      L.set(cx - 2, gy, cz - 1, K('pumpkin', PL));
    }
  }
}

// ---------- épave ----------
function shipwreck(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery) {
  const L = new Local(w, t, ox, oz, rng.int(0, 3));
  const wood = rng.pick(['oak', 'spruce', 'dark_oak', 'birch', 'jungle', 'acacia']);
  const PL = K(`${wood}_planks`, B.OAK_PLANKS), LOG = K(`${wood}_log`, B.OAK_LOG), FENCE = K(`${wood}_fence`, K('oak_fence', LOG));
  const TRAP = K(`${wood}_trapdoor`, PL);
  // posture : droite, couchée sur le flanc ou retournée ; parfois brisée (moitié avant ou arrière)
  const pose = rng.next() < 0.6 ? 0 : rng.next() < 0.5 ? 1 : 2;
  const half = rng.next() < 0.25 ? (rng.next() < 0.5 ? -1 : 1) : 0;
  const len = 11; // demi-longueur
  const H = 9; // hauteur totale (cale + pont + cabine)
  const floor = t.heightAt(ox, oz);
  const yb = floor < SEA_LEVEL ? floor - 1 : floor - 2;
  const wet = floor < SEA_LEVEL + 1;
  const put = (u: number, v: number, hh: number, b: number, m = 0) => {
    if ((half < 0 && u > 1) || (half > 0 && u < -1)) return;
    let x = v, y = hh;
    if (pose === 1) [x, y] = [hh - 3, v + 3];
    else if (pose === 2) [x, y] = [-v, H - hh];
    if (b === B.AIR) L.clear(x, yb + y, u, wet);
    else L.set(x, yb + y, u, b, m);
  };
  const decay = (p: number) => rng.next() < p;
  const halfWidth = (u: number, hh: number) => {
    const base = hh <= 0 ? 1 : hh === 1 ? 2 : 3;
    // proue effilée (u > 0), poupe carrée
    const taper = u > len - 5 ? Math.ceil((u - (len - 5)) * 0.6) : 0;
    return Math.max(0, base - taper);
  };
  for (let u = -len; u <= len; u++) {
    for (let hh = 0; hh <= 5; hh++) {
      const hw = halfWidth(u, hh);
      for (let v = -3; v <= 3; v++) {
        const end = u === -len || u === len;
        if (Math.abs(v) > hw) continue;
        const shell = hh === 0 || Math.abs(v) === hw || end || hh === 1 || hh === 5;
        if (!shell) put(u, v, hh, B.AIR);
        else if (hh === 5 && decay(0.25)) put(u, v, hh, B.AIR);
        else if (decay(0.08)) put(u, v, hh, B.AIR);
        else put(u, v, hh, hh === 5 && Math.abs(v) < hw ? PL : hh === 2 && Math.abs(v) === hw ? LOG : PL);
      }
    }
    // bastingage
    const hw = halfWidth(u, 5);
    if (hw > 0 && !decay(0.3)) {
      put(u, -hw, 6, FENCE);
      put(u, hw, 6, FENCE);
    }
  }
  // écoutille et cabine arrière
  put(2, 0, 5, TRAP, 8);
  for (let u = -len; u <= -len + 5; u++)
    for (let hh = 6; hh <= 9; hh++)
      for (let v = -3; v <= 3; v++) {
        const edge = Math.abs(v) === 3 || u === -len || u === -len + 5 || hh === 9;
        if (decay(0.1)) continue;
        put(u, v, hh, edge ? PL : B.AIR);
      }
  put(-len + 5, 0, 6, B.AIR);
  put(-len + 5, 0, 7, B.AIR);
  put(-len + 2, -3, 7, B.AIR);
  put(-len + 2, 3, 7, B.AIR);
  // mâts (souvent brisés), sauf retournée
  if (pose !== 2)
    for (const u of [-2, 5]) {
      const top = 6 + rng.int(2, 9);
      for (let hh = 1; hh <= top; hh++) put(u, 0, hh, LOG);
    }
  // coffres : ravitaillement (proue), trésor (poupe), carte (cabine)
  const ch = (u: number, v: number, hh: number, loot: number) => put(u, v, hh, B.CHEST, chestMeta(loot, (N + L.r) & 3));
  ch(len - 4, 0, 2, MORE_LOOT.SHIPWRECK_SUPPLY);
  ch(-len + 2, 1, 2, MORE_LOOT.SHIPWRECK_TREASURE);
  ch(-len + 2, -1, 6, MORE_LOOT.SHIPWRECK_MAP);
}

// ---------- ruines sous-marines ----------
function oceanRuinPiece(L: Local, cx: number, cz: number, rng: Rng, warm: boolean, big: boolean, loot: number) {
  const R = big ? 6 : 3;
  const brick = () => {
    if (warm) return rng.next() < 0.3 ? K('cut_sandstone', B.SANDSTONE) : rng.next() < 0.15 ? K('chiseled_sandstone', B.SANDSTONE) : B.SANDSTONE;
    return rng.next() < 0.3 ? B.MOSSY_STONE_BRICKS ?? B.STONE_BRICKS : rng.next() < 0.25 ? B.CRACKED_STONE_BRICKS ?? B.STONE_BRICKS : B.STONE_BRICKS;
  };
  const sus = K(warm ? 'suspicious_sand_0' : 'suspicious_gravel_0', warm ? B.SAND : B.GRAVEL);
  const magma = K('magma', K('magma_block', B.NETHERRACK ?? B.STONE));
  for (let lz = -R; lz <= R; lz++)
    for (let lx = -R; lx <= R; lx++) {
      const x = cx + lx, z = cz + lz;
      const hy = L.h(x, z);
      const edge = Math.abs(lx) === R || Math.abs(lz) === R;
      const pillar = big && Math.abs(lx) === 3 && Math.abs(lz) === 3;
      // dallage partiel
      if (rng.next() < 0.6) L.set(x, hy, z, brick());
      if (edge || pillar) {
        const hgt = rng.next() < 0.2 ? 0 : rng.int(1, big ? 6 : 4);
        for (let k = 1; k <= hgt; k++) L.set(x, hy + k, z, brick());
        for (let k = hgt + 1; k <= (big ? 8 : 5); k++) L.clear(x, hy + k, z);
      } else for (let k = 1; k <= (big ? 6 : 4); k++) L.clear(x, hy + k, z);
    }
  // porte, fragments enfouis, magma
  L.clear(cx, L.h(cx, cz - R) + 1, cz - R);
  L.clear(cx, L.h(cx, cz - R) + 2, cz - R);
  const floorAt = (b: number) => {
    const x = cx + rng.int(-R + 1, R - 1), z = cz + rng.int(-R + 1, R - 1);
    L.set(x, L.h(x, z), z, b);
  };
  for (let i = 0; i < (big ? 4 : 2); i++) floorAt(sus);
  if (rng.next() < (big ? 0.8 : 0.4)) floorAt(magma);
  const chy = L.h(cx + 1, cz + 1);
  L.set(cx + 1, chy, cz + 1, brick());
  L.chest(cx + 1, chy + 1, cz + 1, loot, rng.int(0, 3));
}
function oceanRuins(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery) {
  const L = new Local(w, t, ox, oz, rng.int(0, 3));
  // ruines chaudes (grès) ou froides (pierre taillée) : les océans n'ont pas de variante thermique ici
  const warm = rng.next() < 0.5;
  const big = rng.next() < 0.3;
  oceanRuinPiece(L, 0, 0, rng, warm, big, big ? MORE_LOOT.OCEAN_RUIN_BIG : MORE_LOOT.OCEAN_RUIN_SMALL);
  if (big) {
    // grappe de petites ruines autour de la grande
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.next(), d = rng.int(12, 15);
      const cx = Math.round(Math.cos(a) * d), cz = Math.round(Math.sin(a) * d);
      if (L.h(cx, cz) > SEA_LEVEL - 3) continue;
      oceanRuinPiece(L, cx, cz, rng, warm, false, MORE_LOOT.OCEAN_RUIN_SMALL);
    }
  }
}

// ---------- portail en ruine ----------
/** Portail en ruine ; `nether` : version du Nether (sans verdure, bassin de lave). */
export function buildRuinedPortal(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery, nether = false) {
  const L = new Local(w, t, ox, oz, rng.int(0, 3));
  const OBS = K('obsidian', B.STONE), CRY = K('crying_obsidian', OBS), NR = K('netherrack', B.COBBLESTONE);
  const magma = K('magma', K('magma_block', NR)), gold = K('gold_block', B.STONE);
  const biome = biomeKey(t, ox, oz);
  const mossy = !nether && (biome === 'jungle' || biome === 'swamp' || biome === 'dense_forest');
  const gy = t.heightAt(ox, oz);
  // plaque de netherrack autour (bords irréguliers), magma et parfois de l'or
  const R = rng.int(4, 6);
  for (let lz = -R; lz <= R; lz++)
    for (let lx = -R; lx <= R; lx++) {
      const d = Math.hypot(lx, lz) / R;
      if (d > 1 || rng.next() < d * d * 0.9) continue;
      const hy = L.h(lx, lz);
      if (Math.abs(hy - gy) > 3) continue;
      const r = rng.next();
      L.set(lx, hy, lz, r < 0.06 ? magma : mossy && r < 0.3 ? B.MOSSY_COBBLESTONE : NR);
      if (rng.next() < 0.5) L.set(lx, hy - 1, lz, NR);
    }
  if (rng.next() < 0.5) {
    const gx = rng.int(-2, 2), gz = rng.int(2, 3);
    L.set(gx, L.h(gx, gz), gz, gold);
  }
  // cadre 4×5 (intérieur 2×3) : obsidienne, obsidienne pleureuse, blocs manquants
  const laying = rng.next() < 0.2;
  const frame = (i: number, j: number, b: number) => {
    if (laying) L.set(i - 1, gy + 1, j - 2, b);
    else L.set(i - 1, gy + j, 0, b);
  };
  const fallen: [number, number][] = [];
  for (let j = 0; j <= 4; j++)
    for (let i = 0; i <= 3; i++) {
      const border = i === 0 || i === 3 || j === 0 || j === 4;
      if (!border) {
        if (!laying) frame(i, j, B.AIR);
        continue;
      }
      // les blocs du haut manquent plus souvent (le bas reste porteur)
      if (rng.next() < 0.12 + j * 0.05) {
        fallen.push([i, j]);
        if (!laying) frame(i, j, B.AIR);
        continue;
      }
      frame(i, j, rng.next() < 0.2 ? CRY : OBS);
    }
  if (!laying) for (let i = -1; i <= 4; i++) L.set(i - 1, gy + 5, 0, B.AIR);
  // blocs tombés au pied du portail
  for (const [i] of fallen.slice(0, 4)) {
    const lx = i - 1 + rng.int(-1, 1), lz = rng.next() < 0.5 ? -2 : 2;
    L.set(lx, L.h(lx, lz) + 1, lz, rng.next() < 0.2 ? CRY : OBS);
  }
  if (nether && rng.next() < 0.5) {
    L.set(3, gy, 3, B.LAVA);
    L.set(3, gy - 1, 3, NR);
  }
  if (mossy) for (let k = 0; k < 4; k++) L.ifAir(rng.int(-2, 2), gy + 1, rng.int(-2, 2), K('vine', B.AIR));
  // coffre
  const cx = rng.next() < 0.5 ? -3 : 3, cz = rng.int(-2, 2);
  const cy = L.h(cx, cz) + 1;
  L.set(cx, cy - 1, cz, NR);
  L.chest(cx, cy, cz, MORE_LOOT.RUINED_PORTAL, cx < 0 ? E : W);
}

// ---------- portails en ruine du Nether ----------
const NETHER_PORTAL_SPACING = 12 * CHUNK_SIZE;
/** Portail en ruine de la région (rx, rz) du Nether, ou null. */
function netherPortalAt(seed: number, rx: number, rz: number): { x: number; z: number } | null {
  const h = hash3(seed, rx, 7777, rz);
  if ((h & 0xffff) / 65536 >= 0.4) return null;
  const span = NETHER_PORTAL_SPACING - 32;
  return { x: rx * NETHER_PORTAL_SPACING + 16 + ((h >>> 16) % span), z: rz * NETHER_PORTAL_SPACING + 16 + ((h >>> 8) % span) };
}
/** Portail en ruine du Nether le plus proche (commande /locate). */
export function locateNetherRuinedPortal(seed: number, x: number, z: number): { x: number; z: number } | null {
  const crx = Math.floor(x / NETHER_PORTAL_SPACING), crz = Math.floor(z / NETHER_PORTAL_SPACING);
  let best: { x: number; z: number } | null = null, bd = Infinity;
  for (let dz = -4; dz <= 4; dz++)
    for (let dx = -4; dx <= 4; dx++) {
      const p = netherPortalAt(seed, crx + dx, crz + dz);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
  return best;
}
/** Écrit dans le chunk du Nether les portails en ruine qui le recoupent (t.heightAt : sol de la caverne). */
export function applyNetherRuinedPortals(seed: number, c: ChunkData, t: TerrainQuery) {
  const bx = c.cx * CHUNK_SIZE, bz = c.cz * CHUNK_SIZE, R = 8;
  const w: StructWriter = {
    set: (x, y, z, b, m = 0) => {
      const lx = x - bx, lz = z - bz;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y <= 1 || y >= WORLD_HEIGHT - 1) return;
      c.blocks[idx(lx, y, lz)] = b;
      c.meta[idx(lx, y, lz)] = m;
    },
    setIfAir: (x, y, z, b, m = 0) => {
      const lx = x - bx, lz = z - bz;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y <= 1 || y >= WORLD_HEIGHT - 1 || c.blocks[idx(lx, y, lz)] !== B.AIR) return;
      c.blocks[idx(lx, y, lz)] = b;
      c.meta[idx(lx, y, lz)] = m;
    },
  };
  for (let rx = Math.floor((bx - R) / NETHER_PORTAL_SPACING); rx <= Math.floor((bx + CHUNK_SIZE + R) / NETHER_PORTAL_SPACING); rx++)
    for (let rz = Math.floor((bz - R) / NETHER_PORTAL_SPACING); rz <= Math.floor((bz + CHUNK_SIZE + R) / NETHER_PORTAL_SPACING); rz++) {
      const p = netherPortalAt(seed, rx, rz);
      if (!p || p.x + R < bx || p.x - R >= bx + CHUNK_SIZE || p.z + R < bz || p.z - R >= bz + CHUNK_SIZE) continue;
      buildRuinedPortal(w, p.x, p.z, new Rng(hash3(seed, rx, 7778, rz)), t, true);
    }
}

// ---------- ruines de piste ----------
function trailRuins(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery) {
  const L = new Local(w, t, ox, oz, rng.int(0, 3));
  const TC = ['terracotta', 'brown_terracotta', 'light_gray_terracotta', 'red_terracotta', 'yellow_terracotta', 'white_terracotta', 'light_blue_terracotta', 'cyan_terracotta', 'orange_terracotta'].map((k) => K(k, B.STONE_BRICKS)).filter((b, i, a) => a.indexOf(b) === i);
  const MUD = K('mud_bricks', B.STONE_BRICKS), PACKED = K('packed_mud', B.DIRT), SUS = K('suspicious_gravel_0', B.GRAVEL);
  const top = Math.round(relief(t, ox, oz, 10, 5).avg);
  const bury = [B.DIRT, B.DIRT, B.GRAVEL, K('coarse_dirt', B.DIRT)];
  // pièces enterrées (seul le haut de quelques murs affleure)
  const rooms: [number, number, number, number][] = [[-4, -4, 4, 4]];
  const extra = rng.int(2, 4);
  for (let i = 0; i < extra; i++) {
    const a = rng.int(0, 3), d = rng.int(7, 10);
    const [dx, dz] = DIRS[a];
    const hw = rng.int(2, 3), hd = rng.int(2, 3);
    rooms.push([dx * d - hw, dz * d - hd, dx * d + hw, dz * d + hd]);
  }
  const floorY = top - 7;
  for (const [x0, z0, x1, z1] of rooms) {
    const course = rng.pick(TC);
    for (let lz = z0; lz <= z1; lz++)
      for (let lx = x0; lx <= x1; lx++) {
        const edge = lx === x0 || lx === x1 || lz === z0 || lz === z1;
        L.set(lx, floorY, lz, PACKED);
        const ct = Math.max(floorY + 3, L.h(lx, lz));
        const wallTop = ct - (rng.next() < 0.25 ? 0 : rng.int(1, 3));
        for (let y = floorY + 1; y <= ct; y++) {
          if (edge) L.set(lx, y, lz, y <= wallTop ? ((y - floorY) % 3 === 0 ? course : rng.next() < 0.7 ? MUD : rng.pick(TC)) : rng.pick(bury));
          else L.set(lx, y, lz, y === ct ? (rng.next() < 0.5 ? B.GRASS_BLOCK : B.DIRT) : rng.next() < 0.05 ? SUS : rng.pick(bury));
        }
      }
  }
  // chemin de gravier reliant les pièces, enfoui
  for (const [x0, z0, x1, z1] of rooms.slice(1)) {
    const cx = (x0 + x1) >> 1, cz = (z0 + z1) >> 1;
    const steps = Math.max(Math.abs(cx), Math.abs(cz));
    for (let s = 0; s <= steps; s++) {
      const lx = Math.round((cx * s) / steps), lz = Math.round((cz * s) / steps);
      L.set(lx, floorY, lz, rng.next() < 0.3 ? SUS : B.GRAVEL);
    }
  }
  // quelques fragments suspects affleurants
  for (let i = 0; i < 4; i++) {
    const lx = rng.int(-3, 3), lz = rng.int(-3, 3);
    L.set(lx, Math.max(floorY + 3, L.h(lx, lz)) - 1, lz, SUS);
  }
}

// ---------- déclaration des types ----------
export const MORE_STRUCTURES: MoreStructureType[] = [
  {
    key: 'desert_pyramid',
    spacing: 14,
    chance: 0.7,
    radius: 16,
    build: desertPyramid,
    site(t, x, z) {
      const r = relief(t, x, z, 10, 5);
      return r.hi - r.lo <= 6 && r.wet === 0;
    },
  },
  {
    key: 'jungle_temple',
    spacing: 14,
    chance: 0.7,
    radius: 12,
    build: jungleTemple,
    site(t, x, z) {
      const r = relief(t, x, z, 7, 7);
      return r.hi - r.lo <= 7 && r.wet === 0;
    },
  },
  {
    key: 'igloo',
    spacing: 10,
    chance: 0.5,
    radius: 12,
    build: igloo,
    site(t, x, z) {
      const r = relief(t, x, z, 5, 5);
      return r.hi - r.lo <= 2 && r.wet === 0;
    },
  },
  {
    key: 'witch_hut',
    spacing: 9,
    chance: 0.6,
    radius: 8,
    aquatic: true,
    build: witchHut,
    site(t, x, z) {
      const r = relief(t, x, z, 4, 4);
      return r.lo >= SEA_LEVEL - 5 && r.hi - r.lo <= 5;
    },
  },
  {
    key: 'pillager_outpost',
    spacing: 14,
    chance: 0.45,
    radius: 18,
    build: outpost,
    site(t, x, z) {
      const r = relief(t, x, z, 6, 6);
      return r.hi - r.lo <= 4 && r.wet === 0;
    },
  },
  {
    key: 'shipwreck',
    spacing: 9,
    chance: 0.5,
    radius: 14,
    aquatic: true,
    build: shipwreck,
    site(t, x, z) {
      const h = t.heightAt(x, z);
      return h <= SEA_LEVEL + 1 && h >= 12;
    },
  },
  {
    key: 'ocean_ruins',
    spacing: 8,
    chance: 0.5,
    radius: 24,
    aquatic: true,
    build: oceanRuins,
    site(t, x, z) {
      return t.heightAt(x, z) <= SEA_LEVEL - 6;
    },
  },
  {
    key: 'ruined_portal',
    spacing: 11,
    chance: 0.4,
    radius: 8,
    anyBiome: true,
    build: (w, ox, oz, rng, t) => buildRuinedPortal(w, ox, oz, rng, t),
  },
  {
    key: 'trail_ruins',
    spacing: 14,
    chance: 0.45,
    radius: 16,
    build: trailRuins,
    site(t, x, z) {
      const r = relief(t, x, z, 10, 5);
      return r.hi - r.lo <= 5 && r.wet === 0 && r.hi < WORLD_HEIGHT - 10;
    },
  },
];
