/**
 * Cartes du serveur de mini-jeux (« LeCraft Network ») : hub et arènes, construites par code
 * dans un monde vide. Le même module sert au générateur (worker) et à la logique des jeux
 * (positions des coffres, des cages, des points de départ). Tout est déterministe.
 */
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/Config';
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { Rng } from '../util/math';
import { BiomeManager } from '../world/BiomeManager';
import { computeHeights, createChunkData, idx, type ChunkData, type SpecialBlock } from '../world/ChunkData';
import { scanSpecials } from '../world/WorldGenerator';
import { buildTree } from '../world/Trees';

const id = (k: string, fb: number) => (BlockRegistry.has(k) ? BlockRegistry.byName(k).id : fb);

/** Altitude du sol des cartes (on se tient en Y + 1). */
export const FLOOR = 63;

export type GameKey = 'skywars' | 'spleef' | 'duels' | 'parkour' | 'tntrun';

/** Hub : île ronde au centre du monde. */
export const HUB = { x: 0, z: 0, radius: 28, spawn: { x: 0.5, y: FLOOR + 1, z: 14.5, yaw: Math.PI } };
/** Socles des PNJ des jeux (devant le joueur à l'arrivée). */
export const HUB_NPCS: { game: GameKey; x: number; z: number; block: string }[] = [
  { game: 'skywars', x: -12, z: -10, block: 'gold_block' },
  { game: 'spleef', x: -6, z: -15, block: 'snow_block' },
  { game: 'duels', x: 0, z: -17, block: 'diamond_block' },
  { game: 'tntrun', x: 6, z: -15, block: 'redstone_block' },
  { game: 'parkour', x: 12, z: -10, block: 'emerald_block' },
];

export const SPLEEF = { x: 400, z: 0, half: 11, outY: FLOOR - 3 };
export const TNTRUN = { x: 1600, z: 0, half: 10, layers: [FLOOR, FLOOR - 6, FLOOR - 12], outY: FLOOR - 16 };
export const DUELS = { x: 1200, z: 0, halfX: 8, halfZ: 14 };
export const SKYWARS = { x: 800, z: 0, ring: 26, islands: 8 };
export const PARKOUR = { x: 2000, z: 0 };

/** Îles de départ de SkyWars : centre (cage) et coffre. */
export function skywarsIslands() {
  const out: { x: number; z: number; chest: [number, number, number] }[] = [];
  for (let i = 0; i < SKYWARS.islands; i++) {
    const a = (i / SKYWARS.islands) * Math.PI * 2;
    const x = SKYWARS.x + Math.round(Math.cos(a) * SKYWARS.ring), z = SKYWARS.z + Math.round(Math.sin(a) * SKYWARS.ring);
    // coffre du côté extérieur de l'île
    const ox = Math.round(Math.cos(a) * 2), oz = Math.round(Math.sin(a) * 2);
    out.push({ x, z, chest: [x + ox, FLOOR + 1, z + oz] });
  }
  return out;
}
/** Coffres de l'île centrale (meilleur butin). */
export function skywarsCenterChests(): [number, number, number][] {
  const { x, z } = SKYWARS;
  return [[x + 3, FLOOR + 1, z], [x - 3, FLOOR + 1, z], [x, FLOOR + 1, z + 3], [x, FLOOR + 1, z - 3]];
}

/** Parcours : suite de plateformes (déterministe), points de contrôle tous les 6 sauts. */
export function parkourCourse() {
  const r = new Rng(424242);
  const steps: { x: number; y: number; z: number; kind: 'step' | 'check' | 'start' | 'end' }[] = [];
  let x = PARKOUR.x, y = FLOOR, z = PARKOUR.z;
  steps.push({ x, y, z, kind: 'start' });
  let dir = 0;
  for (let i = 1; i <= 36; i++) {
    if (r.next() < 0.3) dir = (dir + (r.next() < 0.5 ? 1 : 3)) & 3;
    const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir];
    const up = y < FLOOR + 14 && r.next() < 0.35 ? 1 : 0;
    const gap = up ? 2 : r.int(2, 3);
    const side = r.int(-1, 1);
    x += dx * gap + (dz !== 0 ? side : 0);
    z += dz * gap + (dx !== 0 ? side : 0);
    y += up;
    steps.push({ x, y, z, kind: i === 36 ? 'end' : i % 6 === 0 ? 'check' : 'step' });
  }
  return steps;
}

type Set3 = (x: number, y: number, z: number, b: number, m?: number) => void;

function disc(set: Set3, cx: number, cz: number, r: number, y: number, b: (x: number, z: number, d: number) => number) {
  for (let z = -r; z <= r; z++)
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, z);
      if (d <= r + 0.3) set(cx + x, y, cz + z, b(cx + x, cz + z, d));
    }
}

function buildHub(set: Set3) {
  const R = HUB.radius;
  const bricks = B.STONE_BRICKS, quartz = id('quartz_block', B.SMOOTH_SANDSTONE ?? B.SANDSTONE), lamp = id('sea_lantern', id('glowstone', B.LANTERN));
  // socle : pierre taillée en dessous, dessus en herbe avec allées de quartz
  for (let k = 0; k < 8; k++) disc(set, HUB.x, HUB.z, R - k * 3, FLOOR - 1 - k, () => (k < 2 ? B.DIRT : B.STONE));
  disc(set, HUB.x, HUB.z, R, FLOOR, (x, z, d) => {
    if (d > R - 1.2) return bricks;
    const ax = Math.abs(x - HUB.x), az = Math.abs(z - HUB.z);
    if (ax <= 1 || az <= 1 || Math.abs(d - 9) < 1.2) return quartz;
    return B.GRASS_BLOCK;
  });
  // muret de bordure avec lanternes
  for (let a = 0; a < 360; a += 3) {
    const x = Math.round(HUB.x + Math.cos((a * Math.PI) / 180) * R), z = Math.round(HUB.z + Math.sin((a * Math.PI) / 180) * R);
    set(x, FLOOR + 1, z, a % 30 === 0 ? B.OAK_FENCE : id('stone_brick_wall', B.COBBLESTONE_SLAB ?? bricks));
    if (a % 30 === 0) {
      set(x, FLOOR + 2, z, B.OAK_FENCE);
      set(x, FLOOR + 3, z, B.LANTERN);
    }
  }
  // fontaine centrale
  disc(set, HUB.x, HUB.z, 4, FLOOR, (_x, _z, d) => (d > 3.3 ? bricks : B.WATER));
  disc(set, HUB.x, HUB.z, 4, FLOOR + 1, (_x, _z, d) => (d > 3.3 ? B.STONE_BRICK_SLAB ?? bricks : B.AIR));
  for (let y = FLOOR; y <= FLOOR + 3; y++) set(HUB.x, y, HUB.z, y === FLOOR + 3 ? lamp : quartz);
  set(HUB.x, FLOOR + 4, HUB.z, B.WATER);
  // socles des jeux : bloc emblème, marches, lampes
  for (const n of HUB_NPCS) {
    disc(set, n.x, n.z, 2, FLOOR, () => quartz);
    set(n.x, FLOOR + 1, n.z, id(n.block, bricks));
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      set(n.x + dx, FLOOR + 1, n.z + dz, B.OAK_FENCE);
      set(n.x + dx, FLOOR + 2, n.z + dz, B.LANTERN);
    }
  }
  // arbres et parterres de fleurs
  const flowers = [B.POPPY, B.DANDELION, B.CORNFLOWER, B.OXEYE_DAISY].filter((b) => b !== undefined);
  const r = new Rng(77);
  for (const [tx, tz] of [[-18, 6], [18, 6], [-14, 18], [14, 18], [-20, -6], [20, -6]]) {
    buildTree(r.next() < 0.5 ? 'oak' : 'birch', HUB.x + tx, FLOOR + 1, HUB.z + tz, r.int(1, 1e6), (x, y, z, b) => set(x, y, z, b));
    for (let i = 0; i < 6; i++) set(HUB.x + tx + r.int(-3, 3), FLOOR + 1, HUB.z + tz + r.int(-3, 3), flowers[r.int(0, flowers.length - 1)]);
  }
}

function walls(set: Set3, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, b: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) if (x === x0 || x === x1 || z === z0 || z === z1) set(x, y, z, b);
}

/** Arène de Spleef : sol de neige au-dessus d'une piscine (tomber = éliminé). */
export function buildSpleefFloor(set: Set3) {
  const { x, z, half } = SPLEEF;
  for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) set(x + dx, FLOOR, z + dz, B.SNOW_BLOCK);
}
function buildSpleef(set: Set3) {
  const { x, z, half } = SPLEEF;
  const h = half + 1;
  for (let dz = -h; dz <= h; dz++) for (let dx = -h; dx <= h; dx++) set(x + dx, FLOOR - 7, z + dz, B.STONE_BRICKS);
  for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) for (let y = FLOOR - 6; y <= FLOOR - 5; y++) set(x + dx, y, z + dz, B.WATER);
  walls(set, x - h, z - h, x + h, z + h, FLOOR - 6, FLOOR + 3, B.STONE_BRICKS);
  walls(set, x - h, z - h, x + h, z + h, FLOOR + 4, FLOOR + 5, B.GLASS);
  buildSpleefFloor(set);
}

/** Couches de TNT Run (sable sur TNT : elles disparaissent sous les pas). */
export function buildTntRunLayers(set: Set3) {
  const { x, z, half, layers } = TNTRUN;
  const sand = id('sand', B.SAND), tnt = id('tnt', B.GRAVEL);
  for (const y of layers)
    for (let dz = -half; dz <= half; dz++)
      for (let dx = -half; dx <= half; dx++) {
        set(x + dx, y, z + dz, sand);
        set(x + dx, y - 1, z + dz, tnt);
      }
}
function buildTntRun(set: Set3) {
  const { x, z, half, layers } = TNTRUN;
  const h = half + 1;
  walls(set, x - h, z - h, x + h, z + h, layers[layers.length - 1] - 4, FLOOR + 4, B.STONE_BRICKS);
  for (let dz = -h; dz <= h; dz++) for (let dx = -h; dx <= h; dx++) set(x + dx, TNTRUN.outY - 1, z + dz, B.LAVA);
  buildTntRunLayers(set);
}

function buildDuels(set: Set3) {
  const { x, z, halfX, halfZ } = DUELS;
  const floor = id('smooth_sandstone', B.SANDSTONE), wall = id('cut_sandstone', B.SANDSTONE);
  for (let dz = -halfZ - 1; dz <= halfZ + 1; dz++)
    for (let dx = -halfX - 1; dx <= halfX + 1; dx++) {
      set(x + dx, FLOOR, z + dz, (dx + dz) % 4 === 0 ? wall : floor);
      set(x + dx, FLOOR - 1, z + dz, B.SANDSTONE);
    }
  walls(set, x - halfX - 1, z - halfZ - 1, x + halfX + 1, z + halfZ + 1, FLOOR + 1, FLOOR + 4, wall);
  for (const [dx, dz] of [[-halfX, -halfZ], [halfX, -halfZ], [-halfX, halfZ], [halfX, halfZ]]) set(x + dx, FLOOR + 1, z + dz, id('glowstone', B.LANTERN));
}

/** Îles de SkyWars (sans les cages, posées au début de la partie). */
function buildSkyWars(set: Set3) {
  const r = new Rng(9090);
  const island = (cx: number, cz: number, R: number) => {
    for (let k = 0; k <= R; k++) disc(set, cx, cz, R - k, FLOOR - k, (_x, _z, d) => (k === 0 ? B.GRASS_BLOCK : k < 2 ? B.DIRT : r.next() < 0.1 ? B.IRON_ORE : B.STONE));
  };
  for (const i of skywarsIslands()) {
    island(i.x, i.z, 3);
    set(i.chest[0], i.chest[1], i.chest[2], B.CHEST);
  }
  island(SKYWARS.x, SKYWARS.z, 6);
  for (const c of skywarsCenterChests()) set(c[0], c[1], c[2], B.CHEST);
  buildTree('oak', SKYWARS.x + 1, FLOOR + 1, SKYWARS.z - 1, 1234, (x, y, z, b) => set(x, y, z, b));
  // petites îles intermédiaires
  for (let i = 0; i < SKYWARS.islands; i++) {
    const a = ((i + 0.5) / SKYWARS.islands) * Math.PI * 2;
    island(SKYWARS.x + Math.round(Math.cos(a) * 15), SKYWARS.z + Math.round(Math.sin(a) * 15), 1);
  }
}

function buildParkour(set: Set3) {
  const colors = ['white_wool', 'yellow_wool', 'lime_wool', 'light_blue_wool', 'magenta_wool', 'orange_wool'];
  for (const s of parkourCourse()) {
    const b = s.kind === 'start' ? id('quartz_block', B.STONE) : s.kind === 'end' ? id('emerald_block', B.GLASS) : s.kind === 'check' ? id('gold_block', B.SANDSTONE) : id(colors[(s.x + s.z) & 3], B.OAK_PLANKS);
    if (s.kind === 'start') {
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) set(s.x + dx, s.y, s.z + dz, b);
    } else set(s.x, s.y, s.z, b);
  }
}

/** Emprises des cartes (pour ne construire que les chunks concernés). */
const MAPS: { x0: number; z0: number; x1: number; z1: number; build: (set: Set3) => void }[] = [
  { x0: -32, z0: -32, x1: 32, z1: 32, build: buildHub },
  { x0: SPLEEF.x - 14, z0: -14, x1: SPLEEF.x + 14, z1: 14, build: buildSpleef },
  { x0: SKYWARS.x - 34, z0: -34, x1: SKYWARS.x + 34, z1: 34, build: buildSkyWars },
  { x0: DUELS.x - 12, z0: -18, x1: DUELS.x + 12, z1: 18, build: buildDuels },
  { x0: TNTRUN.x - 13, z0: -13, x1: TNTRUN.x + 13, z1: 13, build: buildTntRun },
  { x0: PARKOUR.x - 80, z0: -80, x1: PARKOUR.x + 80, z1: 80, build: buildParkour },
];

/**
 * Générateur du monde du serveur : vide (ciel des plaines) avec le hub et les arènes.
 * Même interface que les autres générateurs pour le worker.
 */
export class ServerGenerator {
  readonly seed: number;
  readonly structures = { locate: () => null as { x: number; z: number } | null };
  constructor(seed: number) {
    this.seed = seed | 0;
  }
  biomeAt(_x: number, _z: number) {
    return BiomeManager.byName('plains').id;
  }
  heightAt(_x: number, _z: number) {
    return FLOOR;
  }
  findSpawn() {
    return { x: HUB.spawn.x, y: FLOOR, z: HUB.spawn.z };
  }
  generateChunk(cx: number, cz: number): { data: ChunkData; specials: SpecialBlock[] } {
    const c = createChunkData(cx, cz);
    const bx = cx * CHUNK_SIZE, bz = cz * CHUNK_SIZE;
    c.biomes.fill(this.biomeAt(0, 0));
    const set: Set3 = (x, y, z, b, m = 0) => {
      const lx = x - bx, lz = z - bz;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y <= 0 || y >= WORLD_HEIGHT || b === undefined) return;
      const i = idx(lx, y, lz);
      c.blocks[i] = b;
      c.meta[i] = m;
    };
    for (const m of MAPS) if (m.x1 >= bx && m.x0 < bx + CHUNK_SIZE && m.z1 >= bz && m.z0 < bz + CHUNK_SIZE) m.build(set);
    computeHeights(c);
    return { data: c, specials: scanSpecials(c) };
  }
}
