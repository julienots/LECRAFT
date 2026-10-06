/**
 * Structures procédurales générées à partir du seed : villages, maisons abandonnées, ruines,
 * tours, temples, sanctuaire de givre, camps, mines, donjons et repaire du golem.
 *
 * Principe inter-chunks : chaque type découpe le monde en régions de `spacing` chunks.
 * Chaque région possède au plus une structure dont l'origine est déterminée par hash(seed, région).
 * Lors de la génération d'un chunk, on reconstruit toutes les structures proches et on n'écrit
 * que les blocs appartenant au chunk (écriture « clippée »). Le résultat est donc identique
 * quel que soit l'ordre de génération des chunks.
 */
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../core/Config';
import { hash3, Rng } from '../util/math';
import { BiomeManager } from './BiomeManager';

export interface TerrainQuery {
  heightAt(x: number, z: number): number;
  biomeAt(x: number, z: number): number;
}

export interface StructWriter {
  set(x: number, y: number, z: number, block: number, meta?: number): void;
  /** N'écrit que si le bloc actuel est de l'air (ou remplaçable) — uniquement dans le chunk. */
  setIfAir(x: number, y: number, z: number, block: number, meta?: number): void;
}

/** Tables de butin (stockées dans les bits 2..7 de la méta du coffre). */
export const LOOT = { NONE: 0, VILLAGE: 1, RUINS: 2, TOWER: 3, TEMPLE: 4, MINE: 5, DUNGEON: 6, BOSS: 7, CAMP: 8, FORTRESS: 9 } as const;
export const chestMeta = (loot: number, dir = 0) => (loot << 2) | (dir & 3);
/** Méta des cages à monstres = index de la créature dans data/mobs. Méta autel = boss. */
export const BOSS = { GOLEM: 1, LICH: 2 } as const;

interface StructureType {
  key: string;
  spacing: number; // en chunks
  chance: number;
  radius: number; // en blocs
  underground?: boolean;
  /** Si absent : autorisé si le biome liste la structure. */
  anyBiome?: boolean;
  build(w: StructWriter, ox: number, oz: number, rng: Rng, t: TerrainQuery): void;
}

// ---------- utilitaires de construction ----------
function fill(w: StructWriter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: number) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) w.set(x, y, z, b);
}
function box(w: StructWriter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: number, rng?: Rng, alt?: number, altChance = 0) {
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
        w.set(x, y, z, edge ? (alt !== undefined && rng && rng.next() < altChance ? alt : wall) : B.AIR);
      }
}
function foundation(w: StructWriter, t: TerrainQuery, x0: number, z0: number, x1: number, z1: number, y: number, b: number) {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const h = Math.min(t.heightAt(x, z), y - 1);
      for (let yy = Math.max(1, h - 1); yy < y; yy++) w.set(x, yy, z, b);
    }
}

interface HouseStyle {
  wall: number;
  corner: number;
  floor: number;
  roof: number;
}
function styleFor(biomeKey: string): HouseStyle {
  switch (biomeKey) {
    case 'desert':
      return { wall: B.SANDSTONE, corner: B.SANDSTONE, floor: B.SANDSTONE, roof: B.SANDSTONE };
    case 'taiga':
    case 'tundra':
      return { wall: B.OAK_PLANKS, corner: B.SPRUCE_LOG, floor: B.OAK_PLANKS, roof: B.SPRUCE_LOG };
    case 'savanna':
      return { wall: B.OAK_PLANKS, corner: B.ACACIA_LOG, floor: B.OAK_PLANKS, roof: B.HAY_BLOCK };
    default:
      return { wall: B.OAK_PLANKS, corner: B.OAK_LOG, floor: B.COBBLESTONE, roof: B.OAK_LOG };
  }
}

/** Maison : utilisée par les villages (intacte) et les maisons abandonnées (dégradée). */
function house(w: StructWriter, t: TerrainQuery, cx: number, cz: number, rng: Rng, style: HouseStyle, decay: boolean, loot: number) {
  const hw = rng.int(2, 3), hd = rng.int(2, 3);
  const x0 = cx - hw, x1 = cx + hw, z0 = cz - hd, z1 = cz + hd;
  const y = t.heightAt(cx, cz) + 1;
  foundation(w, t, x0, z0, x1, z1, y, B.COBBLESTONE);
  fill(w, x0, y, z0, x1, y, z1, style.floor);
  fill(w, x0 - 1, y + 1, z0 - 1, x1 + 1, y + 9, z1 + 1, B.AIR);
  const H = 4;
  for (let yy = y + 1; yy <= y + H; yy++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const edgeX = x === x0 || x === x1, edgeZ = z === z0 || z === z1;
        if (!edgeX && !edgeZ) continue;
        if (decay && rng.next() < 0.25) continue;
        let b = edgeX && edgeZ ? style.corner : style.wall;
        if (decay && rng.next() < 0.3) b = B.MOSSY_COBBLESTONE;
        const window = yy === y + 2 && ((edgeZ && !edgeX && Math.abs(x - cx) === 1) || (edgeX && !edgeZ && Math.abs(z - cz) === 1));
        w.set(x, yy, z, window ? (decay ? B.AIR : B.GLASS) : b);
      }
  // porte (face -Z)
  w.set(cx, y + 1, z0, B.AIR);
  w.set(cx, y + 2, z0, B.AIR);
  // toit pyramidal
  for (let k = 0; k <= Math.max(hw, hd) + 1; k++) {
    const rx0 = x0 - 1 + k, rx1 = x1 + 1 - k, rz0 = z0 - 1 + k, rz1 = z1 + 1 - k;
    if (rx0 > rx1 || rz0 > rz1) break;
    for (let z = rz0; z <= rz1; z++)
      for (let x = rx0; x <= rx1; x++) {
        if (decay && rng.next() < 0.2) continue;
        const edge = x === rx0 || x === rx1 || z === rz0 || z === rz1;
        if (edge) w.set(x, y + H + 1 + k, z, k === 0 ? style.roof : B.OAK_PLANKS);
      }
  }
  // mobilier
  w.set(x1 - 1, y + 1, z1 - 1, B.CHEST, chestMeta(loot, 2));
  if (!decay) {
    w.set(x0 + 1, y + 1, z1 - 1, B.CRAFTING_TABLE);
    w.set(x1 - 1, y + 1, z0 + 1, B.LANTERN);
    if (rng.next() < 0.5) w.set(x0 + 1, y + 1, z0 + 1, B.FURNACE);
  } else if (rng.next() < 0.5) w.set(x0 + 1, y + 1, z1 - 1, B.SPAWNER, 0);
  return { doorX: cx, doorZ: z0 - 1, y };
}

function path(w: StructWriter, t: TerrainQuery, ax: number, az: number, bx: number, bz: number) {
  const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(ax + ((bx - ax) * i) / n), z = Math.round(az + ((bz - az) * i) / n);
    for (const [dx, dz] of [[0, 0], [1, 0]]) {
      const h = t.heightAt(x + dx, z + dz);
      if (h < SEA_LEVEL) w.set(x + dx, SEA_LEVEL, z + dz, B.OAK_PLANKS);
      else w.set(x + dx, h, z + dz, B.DIRT_PATH);
    }
  }
}

function spawner(w: StructWriter, x: number, y: number, z: number, mob: number) {
  w.set(x, y, z, B.SPAWNER, mob);
}

// Index des créatures (doit correspondre à l'ordre de data/mobs.ts)
export const MOB_INDEX = { zombie: 4, spider: 5, slime: 6, skeleton: 7, chef: 8, cave_spider: 9 } as const;

// ---------- types de structures ----------
const TYPES: StructureType[] = [
  {
    key: 'village',
    spacing: 10,
    chance: 0.75,
    radius: 30,
    build(w, ox, oz, rng, t) {
      const biome = BiomeManager.get(t.biomeAt(ox, oz));
      const style = styleFor(biome.key);
      const cy = t.heightAt(ox, oz) + 1;
      // puits central
      foundation(w, t, ox - 2, oz - 2, ox + 2, oz + 2, cy, B.COBBLESTONE);
      fill(w, ox - 2, cy, oz - 2, ox + 2, cy, oz + 2, B.COBBLESTONE);
      fill(w, ox - 2, cy + 1, oz - 2, ox + 2, cy + 5, oz + 2, B.AIR);
      fill(w, ox - 1, cy - 3, oz - 1, ox + 1, cy, oz + 1, B.WATER);
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) fill(w, ox + dx, cy + 1, oz + dz, ox + dx, cy + 3, oz + dz, style.corner);
      fill(w, ox - 2, cy + 4, oz - 2, ox + 2, cy + 4, oz + 2, B.OAK_PLANKS);
      const n = rng.int(3, 6);
      const a0 = rng.next() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        const d = rng.int(11, 18);
        const hx = Math.round(ox + Math.cos(a) * d), hz = Math.round(oz + Math.sin(a) * d);
        if (t.heightAt(hx, hz) < SEA_LEVEL) continue;
        const door = house(w, t, hx, hz, rng, style, false, LOOT.VILLAGE);
        path(w, t, ox, oz + 3, door.doorX, door.doorZ);
        // lampadaire
        const lx = door.doorX + 2, lz = door.doorZ - 1, ly = t.heightAt(lx, lz) + 1;
        if (ly > SEA_LEVEL) {
          fill(w, lx, ly, lz, lx, ly + 1, lz, B.OAK_LOG);
          w.set(lx, ly + 2, lz, B.LANTERN);
        }
      }
      // champ cultivé
      const fa = a0 + Math.PI / n;
      const fx = Math.round(ox + Math.cos(fa) * 9), fz = Math.round(oz + Math.sin(fa) * 9);
      const fy = t.heightAt(fx, fz);
      if (fy >= SEA_LEVEL) {
        foundation(w, t, fx - 3, fz - 3, fx + 3, fz + 3, fy, B.DIRT);
        fill(w, fx - 3, fy + 1, fz - 3, fx + 3, fy + 3, fz + 3, B.AIR);
        for (let z = fz - 3; z <= fz + 3; z++)
          for (let x = fx - 3; x <= fx + 3; x++) {
            const border = Math.abs(x - fx) === 3 || Math.abs(z - fz) === 3;
            if (border) w.set(x, fy, z, B.OAK_LOG);
            else if (x === fx) w.set(x, fy, z, B.WATER);
            else {
              w.set(x, fy, z, B.FARMLAND, 1);
              const crop = rng.next() < 0.75 ? B.WHEAT : B.CARROTS;
              w.set(x, fy + 1, z, crop, crop === B.WHEAT ? rng.int(2, 7) : rng.int(1, 3));
            }
          }
      }
    },
  },
  {
    key: 'abandoned_house',
    spacing: 6,
    chance: 0.3,
    radius: 6,
    build(w, ox, oz, rng, t) {
      house(w, t, ox, oz, rng, styleFor(BiomeManager.get(t.biomeAt(ox, oz)).key), true, LOOT.RUINS);
    },
  },
  {
    key: 'ruins',
    spacing: 7,
    chance: 0.4,
    radius: 8,
    build(w, ox, oz, rng, t) {
      const y = t.heightAt(ox, oz);
      for (let z = oz - 5; z <= oz + 5; z++)
        for (let x = ox - 5; x <= ox + 5; x++) {
          const edge = Math.abs(x - ox) === 5 || Math.abs(z - oz) === 5;
          const hy = t.heightAt(x, z);
          if (!edge) {
            if (rng.next() < 0.5) w.set(x, hy, z, rng.pick([B.COBBLESTONE, B.MOSSY_COBBLESTONE, B.GRAVEL]));
            continue;
          }
          const hgt = rng.int(0, 4);
          for (let k = 1; k <= hgt; k++) w.set(x, hy + k, z, rng.pick([B.STONE_BRICKS, B.CRACKED_STONE_BRICKS, B.MOSSY_COBBLESTONE]));
        }
      w.set(ox, y, oz, B.CHEST, chestMeta(LOOT.RUINS));
      w.set(ox, y - 1, oz, B.COBBLESTONE);
    },
  },
  {
    key: 'camp',
    spacing: 8,
    chance: 0.35,
    radius: 7,
    build(w, ox, oz, rng, t) {
      const y = t.heightAt(ox, oz) + 1;
      foundation(w, t, ox - 4, oz - 4, ox + 4, oz + 4, y, B.DIRT);
      fill(w, ox - 4, y, oz - 4, ox + 4, y + 4, oz + 4, B.AIR);
      fill(w, ox - 4, y - 1, oz - 4, ox + 4, y - 1, oz + 4, B.DIRT_PATH);
      // feu de camp
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) w.set(ox + dx, y, oz + dz, B.COBBLESTONE);
      w.set(ox, y, oz, B.LANTERN);
      // bancs
      fill(w, ox - 3, y, oz - 3, ox - 1, y, oz - 3, B.OAK_LOG);
      fill(w, ox + 1, y, oz + 3, ox + 3, y, oz + 3, B.OAK_LOG);
      // tente de laine
      for (let k = 0; k < 3; k++) {
        fill(w, ox + 2 + k, y + k, oz - 3, ox + 2 + k, y + k, oz, B.WHITE_WOOL);
        fill(w, ox + 6 - k, y + k, oz - 3, ox + 6 - k, y + k, oz, B.BROWN_WOOL);
      }
      w.set(ox + 4, y, oz - 2, B.CHEST, chestMeta(LOOT.CAMP, 2));
      if (rng.next() < 0.5) w.set(ox - 3, y, oz + 2, B.CRAFTING_TABLE);
    },
  },
  {
    key: 'tower',
    spacing: 9,
    chance: 0.45,
    radius: 5,
    build(w, ox, oz, rng, t) {
      const y = t.heightAt(ox, oz) + 1;
      const H = 18;
      foundation(w, t, ox - 3, oz - 3, ox + 3, oz + 3, y, B.STONE_BRICKS);
      box(w, ox - 3, y - 1, oz - 3, ox + 3, y + H, oz + 3, B.STONE_BRICKS, rng, B.CRACKED_STONE_BRICKS, 0.2);
      // escalier en colimaçon (anneau intérieur)
      const ring: [number, number][] = [];
      for (let i = -2; i <= 2; i++) ring.push([i, -2]);
      for (let i = -1; i <= 2; i++) ring.push([2, i]);
      for (let i = 1; i >= -2; i--) ring.push([i, 2]);
      for (let i = 1; i >= -1; i--) ring.push([-2, i]);
      for (let s = 0; s < H - 1; s++) {
        const [dx, dz] = ring[s % ring.length];
        w.set(ox + dx, y + s, oz + dz, B.OAK_PLANKS);
      }
      // plancher du sommet avec trémie
      fill(w, ox - 2, y + H - 1, oz - 2, ox + 2, y + H - 1, oz + 2, B.OAK_PLANKS);
      const [ex, ez] = ring[(H - 2) % ring.length];
      w.set(ox + ex, y + H - 1, oz + ez, B.AIR);
      fill(w, ox - 2, y + H, oz - 2, ox + 2, y + H + 3, oz + 2, B.AIR);
      for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) if ((Math.abs(x) === 3 || Math.abs(z) === 3) && (x + z) % 2 === 0) w.set(ox + x, y + H + 1, oz + z, B.STONE_BRICKS);
      w.set(ox, y + H, oz, B.CHEST, chestMeta(LOOT.TOWER));
      w.set(ox + 1, y + H, oz + 1, B.LANTERN);
      // fenêtres et porte
      for (let k = 4; k < H; k += 5) {
        w.set(ox, y + k, oz - 3, B.AIR);
        w.set(ox + 3, y + k, oz, B.AIR);
      }
      w.set(ox, y, oz - 3, B.AIR);
      w.set(ox, y + 1, oz - 3, B.AIR);
      spawner(w, ox, y, oz, MOB_INDEX.skeleton);
    },
  },
  {
    key: 'temple',
    spacing: 12,
    chance: 0.6,
    radius: 10,
    build(w, ox, oz, rng, t) {
      const biome = BiomeManager.get(t.biomeAt(ox, oz));
      const mat = biome.key === 'jungle' ? B.MOSSY_COBBLESTONE : B.SANDSTONE;
      const y = t.heightAt(ox, oz) + 1;
      foundation(w, t, ox - 8, oz - 8, ox + 8, oz + 8, y, mat);
      for (let k = 0; k <= 8; k++) {
        const r = 8 - k;
        for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) w.set(ox + x, y + k, oz + z, Math.abs(x) === r || Math.abs(z) === r ? mat : B.AIR);
      }
      fill(w, ox - 8, y + 9, oz - 8, ox + 8, y + 9, oz + 8, B.AIR);
      // entrée
      fill(w, ox - 1, y, oz - 8, ox + 1, y + 2, oz - 6, B.AIR);
      // chambre cachée
      box(w, ox - 3, y - 6, oz - 3, ox + 3, y - 1, oz + 3, mat);
      w.set(ox, y - 1, oz, B.AIR);
      w.set(ox, y - 2, oz, B.AIR);
      // quatre coffres contre les murs et piège : plaque de pression au-dessus de TNT
      w.set(ox - 2, y - 5, oz, B.CHEST, chestMeta(LOOT.TEMPLE, 3));
      w.set(ox + 2, y - 5, oz, B.CHEST, chestMeta(LOOT.TEMPLE, 1));
      w.set(ox, y - 5, oz - 2, B.CHEST, chestMeta(LOOT.TEMPLE, 0));
      w.set(ox, y - 5, oz + 2, B.CHEST, chestMeta(LOOT.TEMPLE, 2));
      w.set(ox, y - 5, oz, B.STONE_PRESSURE_PLATE);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) w.set(ox + dx, y - 8, oz + dz, B.TNT);
      fill(w, ox - 1, y - 7, oz - 1, ox + 1, y - 7, oz + 1, mat);
      w.set(ox - 2, y - 3, oz - 2, B.TORCH, 2);
      w.set(ox, y + 1, oz, B.GOLD_BLOCK);
      if (rng.next() < 0.5) spawner(w, ox + 4, y, oz + 4, MOB_INDEX.zombie);
    },
  },
  {
    key: 'ice_temple',
    spacing: 14,
    chance: 0.75,
    radius: 22,
    build(w, ox, oz, _rng, t) {
      const y = t.heightAt(ox, oz) + 1;
      foundation(w, t, ox - 6, oz - 6, ox + 6, oz + 6, y, B.PACKED_ICE);
      box(w, ox - 6, y - 1, oz - 6, ox + 6, y + 7, oz + 6, B.PACKED_ICE);
      for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) fill(w, ox + dx, y + 8, oz + dz, ox + dx, y + 13, oz + dz, B.PACKED_ICE);
      fill(w, ox - 1, y, oz - 6, ox + 1, y + 2, oz - 6, B.AIR);
      w.set(ox, y, oz + 4, B.LANTERN);
      // escalier descendant vers l'arène (axe +X)
      const depth = 14;
      for (let s = 0; s <= depth; s++) {
        const sx = ox - 3 + s;
        fill(w, sx, y - s, oz - 1, sx, y - s + 3, oz + 1, B.AIR);
        fill(w, sx, y - s - 1, oz - 1, sx, y - s - 1, oz + 1, B.STONE_BRICKS);
      }
      // arène
      const ax = ox - 3 + depth + 9, ay = y - depth - 1;
      box(w, ax - 9, ay - 1, oz - 9, ax + 9, ay + 9, oz + 9, B.PACKED_ICE);
      fill(w, ax - 8, ay - 1, oz - 8, ax + 8, ay - 1, oz + 8, B.STONE_BRICKS);
      fill(w, ax - 9, ay, oz - 1, ax - 9, ay + 3, oz + 1, B.AIR);
      for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
        fill(w, ax + dx, ay, oz + dz, ax + dx, ay + 8, oz + dz, B.PACKED_ICE);
        w.set(ax + dx, ay + 4, oz + dz - Math.sign(dz), B.LANTERN);
      }
      w.set(ax, ay, oz, B.BOSS_ALTAR, BOSS.LICH);
      w.set(ax + 7, ay, oz - 7, B.CHEST, chestMeta(LOOT.BOSS, 1));
      w.set(ax + 7, ay, oz + 7, B.CHEST, chestMeta(LOOT.BOSS, 1));
    },
  },
  {
    key: 'mine',
    spacing: 7,
    chance: 0.45,
    radius: 44,
    underground: true,
    anyBiome: true,
    build(w, ox, oz, rng) {
      const y0 = rng.int(20, 38);
      let x = ox, z = oz, y = y0;
      const segments = rng.int(6, 12);
      for (let s = 0; s < segments; s++) {
        const dir = rng.int(0, 3);
        const dx = [1, 0, -1, 0][dir], dz = [0, 1, 0, -1][dir];
        const len = rng.int(8, 16);
        for (let i = 0; i < len; i++) {
          x += dx;
          z += dz;
          if (Math.abs(x - ox) > 38 || Math.abs(z - oz) > 38) break;
          const px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0;
          for (let k = -1; k <= 1; k++) for (let yy = y; yy <= y + 2; yy++) w.set(x + px * k, yy, z + pz * k, B.AIR);
          w.set(x, y - 1, z, B.OAK_PLANKS);
          if (i % 4 === 0) {
            for (const k of [-1, 1]) for (let yy = y; yy <= y + 1; yy++) w.set(x + px * k, yy, z + pz * k, B.OAK_LOG);
            for (let k = -1; k <= 1; k++) w.set(x + px * k, y + 2, z + pz * k, B.OAK_PLANKS);
            if (rng.next() < 0.35) w.set(x + px, y, z + pz, B.TORCH);
          }
          if (rng.next() < 0.015) w.set(x - px, y, z - pz, B.CHEST, chestMeta(LOOT.MINE));
          // toiles d'araignée dans les coins du plafond (mines abandonnées)
          if (rng.next() < 0.08 && BlockRegistry.has('cobweb')) w.set(x + px * (rng.next() < 0.5 ? -1 : 1), y + 2, z + pz * (rng.next() < 0.5 ? -1 : 1), BlockRegistry.byName('cobweb').id);
          if (rng.next() < 0.004) spawner(w, x, y, z, MOB_INDEX.cave_spider);
        }
      }
    },
  },
  {
    key: 'dungeon',
    spacing: 6,
    chance: 0.5,
    radius: 26,
    underground: true,
    anyBiome: true,
    build(w, ox, oz, rng) {
      const y = rng.int(14, 32);
      const rooms: { x: number; z: number; r: number }[] = [];
      const count = rng.int(3, 6);
      for (let i = 0; i < count; i++) {
        const gx = rng.int(-1, 1), gz = rng.int(-1, 1);
        if (rooms.some((r) => r.x === ox + gx * 14 && r.z === oz + gz * 14)) continue;
        rooms.push({ x: ox + gx * 14, z: oz + gz * 14, r: rng.int(3, 5) });
      }
      rooms.forEach((r) => box(w, r.x - r.r, y - 1, r.z - r.r, r.x + r.r, y + 4, r.z + r.r, B.MOSSY_COBBLESTONE, rng, B.STONE_BRICKS, 0.5));
      // couloirs (en L) entre salles consécutives, creusés après les salles (portes implicites)
      const corridor = (x0: number, z0: number, x1: number, z1: number) => {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
          for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
            for (let yy = y; yy <= y + 2; yy++) w.set(x, yy, z, B.AIR);
            w.set(x, y - 1, z, B.STONE_BRICKS);
          }
      };
      for (let i = 1; i < rooms.length; i++) {
        const a = rooms[i - 1], b = rooms[i];
        corridor(a.x, a.z, b.x, a.z);
        corridor(b.x, a.z, b.x, b.z);
      }
      // contenu des salles posé en dernier
      rooms.forEach((r, i) => {
        w.set(r.x - r.r + 1, y + 2, r.z + r.r - 1, B.LANTERN);
        if (i === rooms.length - 1 && rooms.length >= 4) spawner(w, r.x + 1, y, r.z + 1, MOB_INDEX.chef);
        else spawner(w, r.x + 1, y, r.z + 1, rng.pick([MOB_INDEX.zombie, MOB_INDEX.skeleton, MOB_INDEX.zombie, MOB_INDEX.spider]));
        w.set(r.x + r.r - 1, y, r.z + r.r - 1, B.CHEST, chestMeta(LOOT.DUNGEON, 2));
        if (rng.next() < 0.5) w.set(r.x - r.r + 1, y, r.z - r.r + 1, B.CHEST, chestMeta(LOOT.DUNGEON, 0));
      });
    },
  },
  {
    key: 'golem_lair',
    spacing: 16,
    chance: 0.85,
    radius: 16,
    anyBiome: true,
    build(w, ox, oz, rng, t) {
      const surf = t.heightAt(ox, oz);
      if (surf < SEA_LEVEL + 1) return;
      const ay = 16;
      // entrée : petit mausolée + escalier en colimaçon
      const y = surf + 1;
      foundation(w, t, ox - 2, oz - 2, ox + 2, oz + 2, y, B.STONE_BRICKS);
      box(w, ox - 2, y - 1, oz - 2, ox + 2, y + 4, oz + 2, B.STONE_BRICKS);
      w.set(ox, y, oz - 2, B.AIR);
      w.set(ox, y + 1, oz - 2, B.AIR);
      w.set(ox, y + 5, oz, B.LANTERN);
      const ring: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
      for (let yy = y - 1; yy >= ay + 1; yy--) {
        fill(w, ox - 1, yy, oz - 1, ox + 1, yy, oz + 1, B.AIR);
        for (const [dx, dz] of [[-2, -2], [-2, -1], [-2, 0], [-2, 1], [-2, 2], [2, -2], [2, -1], [2, 0], [2, 1], [2, 2], [-1, -2], [0, -2], [1, -2], [-1, 2], [0, 2], [1, 2]])
          w.set(ox + dx, yy, oz + dz, B.STONE_BRICKS);
      }
      for (let yy = y - 1, s = 0; yy >= ay + 1; yy--, s++) {
        const [dx, dz] = ring[s % 8];
        w.set(ox + dx, yy - 1, oz + dz, B.COBBLESTONE);
        if (s % 6 === 0) w.set(ox, yy, oz, B.AIR);
      }
      // arène
      box(w, ox - 11, ay - 1, oz - 11, ox + 11, ay + 9, oz + 11, B.STONE_BRICKS, rng, B.CRACKED_STONE_BRICKS, 0.25);
      fill(w, ox - 1, ay, oz - 1, ox + 1, ay + 9, oz + 1, B.AIR);
      for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
        fill(w, ox + dx, ay, oz + dz, ox + dx, ay + 8, oz + dz, B.MOSSY_COBBLESTONE);
        w.set(ox + dx, ay + 3, oz + dz - Math.sign(dz), B.LANTERN);
      }
      w.set(ox + 6, ay, oz, B.BOSS_ALTAR, BOSS.GOLEM);
      for (const dz of [-9, 9]) w.set(ox + 9, ay, oz + dz, B.CHEST, chestMeta(LOOT.BOSS, 3));
    },
  },
];

export const STRUCTURE_KEYS = TYPES.map((t) => t.key);

export interface StructureInstance {
  key: string;
  x: number;
  z: number;
}

export class StructureGenerator {
  constructor(private seed: number, private terrain: TerrainQuery) {}

  /** Calcule l'instance éventuelle d'une région (déterministe). */
  private instance(type: StructureType, ti: number, rx: number, rz: number): StructureInstance | null {
    const h = hash3(this.seed, rx, 7000 + ti, rz);
    if ((h & 0xffff) / 65536 >= type.chance) return null;
    const span = Math.max(1, type.spacing - 2);
    const ocx = rx * type.spacing + 1 + ((h >>> 16) % span);
    const ocz = rz * type.spacing + 1 + ((h >>> 24) % span);
    const x = ocx * CHUNK_SIZE + 8, z = ocz * CHUNK_SIZE + 8;
    if (!type.anyBiome) {
      const biome = BiomeManager.get(this.terrain.biomeAt(x, z));
      if (!biome.structures.includes(type.key)) return null;
      if (this.terrain.heightAt(x, z) < SEA_LEVEL) return null;
    } else if (!type.underground) {
      const biome = BiomeManager.get(this.terrain.biomeAt(x, z));
      if (biome.key === 'ocean' || biome.key === 'river') return null;
    }
    return { key: type.key, x, z };
  }

  /** Liste les structures dont l'emprise peut toucher la zone [x0..x1]x[z0..z1]. */
  structuresNear(x0: number, z0: number, x1: number, z1: number): { type: StructureType; ti: number; inst: StructureInstance; rx: number; rz: number }[] {
    const out: { type: StructureType; ti: number; inst: StructureInstance; rx: number; rz: number }[] = [];
    TYPES.forEach((type, ti) => {
      const S = type.spacing * CHUNK_SIZE;
      const R = type.radius;
      for (let rx = Math.floor((x0 - R - S) / S); rx <= Math.floor((x1 + R) / S); rx++)
        for (let rz = Math.floor((z0 - R - S) / S); rz <= Math.floor((z1 + R) / S); rz++) {
          const inst = this.instance(type, ti, rx, rz);
          if (!inst) continue;
          if (inst.x + R < x0 || inst.x - R > x1 || inst.z + R < z0 || inst.z - R > z1) continue;
          out.push({ type, ti, inst, rx, rz });
        }
    });
    return out;
  }

  /** Écrit dans le chunk toutes les structures qui le recoupent. */
  apply(cx: number, cz: number, writer: StructWriter) {
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    for (const s of this.structuresNear(x0, z0, x0 + 15, z0 + 15)) {
      const rng = new Rng(hash3(this.seed, s.rx, 9000 + s.ti, s.rz));
      s.type.build(writer, s.inst.x, s.inst.z, rng, this.terrain);
    }
  }

  /** Recherche la structure la plus proche d'un type (pour la boussole / debug). */
  locate(key: string, x: number, z: number, maxRegions = 12): StructureInstance | null {
    const ti = TYPES.findIndex((t) => t.key === key);
    if (ti < 0) return null;
    const type = TYPES[ti];
    const S = type.spacing * CHUNK_SIZE;
    const crx = Math.floor(x / S), crz = Math.floor(z / S);
    let best: StructureInstance | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= maxRegions; r++) {
      for (let rx = crx - r; rx <= crx + r; rx++)
        for (let rz = crz - r; rz <= crz + r; rz++) {
          if (Math.max(Math.abs(rx - crx), Math.abs(rz - crz)) !== r) continue;
          const inst = this.instance(type, ti, rx, rz);
          if (!inst) continue;
          const d = (inst.x - x) ** 2 + (inst.z - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = inst;
          }
        }
      if (best && r >= 2) break;
    }
    return best;
  }
}

export const MAX_BUILD_HEIGHT = WORLD_HEIGHT - 1;
