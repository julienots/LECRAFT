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

export type GameKey = 'skywars' | 'spleef' | 'duels' | 'parkour' | 'tntrun' | 'sumo' | 'blockparty' | 'bedwars';

/** Hub HypXL : grande île flottante (place, fontaine, lettres géantes, quartiers, tours). */
export const HUB = { x: 0, z: 0, radius: 56, spawn: { x: 0.5, y: FLOOR + 1, z: 44.5, yaw: Math.PI } };
/** Socles des PNJ des jeux : arc au nord de la place. */
const ARC_GAMES: { game: GameKey; block: string; accent: string }[] = [
  { game: 'bedwars', block: 'red_concrete', accent: 'red_wool' },
  { game: 'skywars', block: 'gold_block', accent: 'yellow_concrete' },
  { game: 'duels', block: 'diamond_block', accent: 'light_blue_concrete' },
  { game: 'sumo', block: 'white_concrete', accent: 'orange_concrete' },
  { game: 'blockparty', block: 'magenta_concrete', accent: 'lime_concrete' },
  { game: 'tntrun', block: 'redstone_block', accent: 'red_concrete' },
  { game: 'spleef', block: 'snow_block', accent: 'light_blue_wool' },
  { game: 'parkour', block: 'emerald_block', accent: 'lime_wool' },
];
export const HUB_NPCS: { game: GameKey; x: number; z: number; block: string; accent: string }[] = ARC_GAMES.map((g, i) => {
  const a = -Math.PI / 2 + (i - (ARC_GAMES.length - 1) / 2) * (Math.PI / 9);
  return { ...g, x: Math.round(Math.cos(a) * 30), z: Math.round(Math.sin(a) * 30) };
});
/** PNJ de services du hub (cosmétiques, boîtes mystères, survie, classements). */
export const HUB_SERVICES = {
  cosmetics: { x: 37, z: 10 },
  mystery: { x: 37, z: -2 },
  smp: { x: 12, z: 38 },
  leaderboard: { x: -30, z: 26 },
  parkourStart: { x: -30, y: FLOOR + 1, z: 6 },
};
/** Parcours du hub (autour de la tour ouest). */
export function hubParkour() {
  const out: { x: number; y: number; z: number }[] = [];
  const cx = -42, cz = 0;
  for (let i = 0; i < 16; i++) {
    const a = Math.PI * 0.15 + i * 0.55;
    out.push({ x: Math.round(cx + Math.cos(a) * 7), y: FLOOR + 1 + Math.floor(i * 0.9), z: Math.round(cz + Math.sin(a) * 7) });
  }
  return out;
}

export const SPLEEF = { x: 400, z: 0, half: 11, outY: FLOOR - 3 };
export const TNTRUN = { x: 1600, z: 0, half: 10, layers: [FLOOR, FLOOR - 6, FLOOR - 12], outY: FLOOR - 16 };
export const DUELS = { x: 1200, z: 0, halfX: 8, halfZ: 14 };
export const SKYWARS = { x: 800, z: 0, ring: 26, islands: 8 };
export const PARKOUR = { x: 2000, z: 0 };
export const SUMO = { x: 2400, z: 0, r: 7, outY: FLOOR - 4 };
export const BLOCKPARTY = { x: 2800, z: 0, half: 12, outY: FLOOR - 6 };
export const BEDWARS = { x: 3200, z: 0, dist: 24, outY: FLOOR - 20 };
export const BLOCKPARTY_COLORS = ['red', 'orange', 'yellow', 'lime', 'light_blue', 'blue', 'magenta', 'white'];
export const BEDWARS_TEAMS: { name: string; color: string; wool: string; dx: number; dz: number }[] = [
  { name: 'Rouge', color: '§c', wool: 'red', dx: 0, dz: 1 },
  { name: 'Bleue', color: '§9', wool: 'blue', dx: 1, dz: 0 },
  { name: 'Verte', color: '§a', wool: 'lime', dx: 0, dz: -1 },
  { name: 'Jaune', color: '§e', wool: 'yellow', dx: -1, dz: 0 },
];
/** Île d'une équipe de BedWars : centre, lit (pied, tête) et point de réapparition. */
export function bedwarsIsland(i: number) {
  const t = BEDWARS_TEAMS[i];
  const x = BEDWARS.x + t.dx * BEDWARS.dist, z = BEDWARS.z + t.dz * BEDWARS.dist;
  // lit du côté extérieur, orienté vers l'extérieur
  const bx = x + t.dx * 3, bz = z + t.dz * 3;
  return { x, z, bed: [[bx, FLOOR + 1, bz], [bx + t.dx, FLOOR + 1, bz + t.dz]] as [number, number, number][], spawn: [x + 0.5 - t.dx * 1, FLOOR + 1, z + 0.5 - t.dz * 1] as [number, number, number] };
}
/** Motif de Block Party (taches de couleurs) : index de couleur par case. */
export function blockPartyPattern(seed: number): number[] {
  const r = new Rng(seed);
  const n = BLOCKPARTY.half * 2 + 1;
  const out: number[] = [];
  const style = seed % 3;
  const pts = Array.from({ length: 14 }, () => [r.int(0, n - 1), r.int(0, n - 1), r.int(0, BLOCKPARTY_COLORS.length - 1)]);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      if (style === 0) out.push(Math.floor(x / 3 + z / 3 + seed) % BLOCKPARTY_COLORS.length);
      else if (style === 1) out.push(Math.floor(Math.hypot(x - n / 2, z - n / 2) / 2 + seed) % BLOCKPARTY_COLORS.length);
      else {
        let best = 0, bd = Infinity;
        for (const p of pts) {
          const d = Math.hypot(p[0] - x, p[1] - z);
          if (d < bd) {
            bd = d;
            best = p[2];
          }
        }
        out.push(best);
      }
    }
  return out;
}

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

/** Lettres géantes (5×7) du logo. */
const FONT: Record<string, string[]> = {
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
};

function buildHub(set: Set3) {
  const R = HUB.radius, cx = HUB.x, cz = HUB.z;
  const r = new Rng(2024);
  const quartz = id('quartz_block', B.SANDSTONE), qpillar = id('quartz_pillar', quartz), qbricks = id('quartz_bricks', quartz);
  const smooth = id('smooth_stone', B.STONE), andesite = id('polished_andesite', B.STONE), diorite = id('polished_diorite', quartz);
  const bricks = B.STONE_BRICKS, lamp = id('sea_lantern', id('glowstone', B.LANTERN)), glow = id('glowstone', lamp);
  const prism = id('prismarine_bricks', bricks), dprism = id('dark_prismarine', prism), gold = id('gold_block', quartz);
  const conc = (c: string) => id(`${c}_concrete`, id(`${c}_wool`, quartz));
  // --- île : dessus en herbe, dessous effilé en pierre avec stalactites
  for (let k = 1; k <= 20; k++) {
    const rr = R * (1 - Math.pow(k / 20, 0.75));
    disc(set, cx, cz, rr, FLOOR - k, (x, z) => (k <= 2 ? B.DIRT : r.next() < 0.04 ? id('iron_ore', B.STONE) : r.next() < 0.03 ? id('coal_ore', B.STONE) : (x + z + k) % 7 === 0 ? id('andesite', B.STONE) : B.STONE));
  }
  for (let i = 0; i < 40; i++) {
    const a = r.next() * Math.PI * 2, d = r.next() * R * 0.7, len = 3 + r.int(0, 10);
    const x = Math.round(cx + Math.cos(a) * d), z = Math.round(cz + Math.sin(a) * d);
    for (let k = 0; k < len; k++) set(x, FLOOR - 20 - k + Math.round(d / 4), z, k === len - 1 ? id('glowstone', B.STONE) : B.STONE);
  }
  disc(set, cx, cz, R, FLOOR, (x, z, d) => {
    const ax = Math.abs(x - cx), az = Math.abs(z - cz);
    if (d > R - 1.5) return bricks;
    // place centrale : anneaux alternés et étoile dorée
    if (d < 15) {
      if (d < 1.2) return gold;
      const ring = Math.floor(d / 2);
      if (Math.abs(d - 6.5) < 0.6) return gold;
      return ring % 2 ? diorite : quartz;
    }
    if (Math.abs(d - 15) < 1) return andesite;
    // avenues (croix) et périphérique
    if ((ax <= 3 || az <= 3) && d < R - 2) return ax === 3 || az === 3 ? andesite : (x + z) % 2 ? smooth : id('light_gray_concrete', smooth);
    if (d > 22 && d < 26) return Math.abs(d - 24) < 0.6 ? id('light_gray_concrete', smooth) : smooth;
    return B.GRASS_BLOCK;
  });
  // --- fontaine monumentale à étages
  disc(set, cx, cz, 7, FLOOR, (_x, _z, d) => (d > 6.2 ? prism : B.WATER));
  disc(set, cx, cz, 7, FLOOR - 1, () => dprism);
  disc(set, cx, cz, 7, FLOOR + 1, (_x, _z, d) => (d > 6.2 ? id('prismarine_brick_slab', prism) : B.AIR));
  for (let y = FLOOR; y <= FLOOR + 7; y++) set(cx, y, cz, y === FLOOR + 7 ? lamp : qpillar);
  disc(set, cx, cz, 3, FLOOR + 4, (_x, _z, d) => (d > 2.2 ? prism : B.WATER));
  disc(set, cx, cz, 3, FLOOR + 3, () => dprism);
  set(cx, FLOOR + 4, cz, qpillar);
  disc(set, cx, cz, 1, FLOOR + 8, (_x, _z, d) => (d < 0.5 ? B.WATER : prism));
  for (const [dx, dz] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) {
    set(cx + dx, FLOOR, cz + dz, lamp);
    set(cx + dx, FLOOR + 1, cz + dz, B.WATER);
  }
  // bancs et lampadaires autour de la place
  const stairs = id('oak_stairs', B.OAK_PLANKS);
  for (let a = 0; a < 360; a += 30) {
    if (a % 90 === 0) continue;
    const rad = (a * Math.PI) / 180;
    const x = Math.round(cx + Math.cos(rad) * 11), z = Math.round(cz + Math.sin(rad) * 11);
    set(x, FLOOR + 1, z, stairs);
    const lx = Math.round(cx + Math.cos(rad + 0.13) * 13.5), lz = Math.round(cz + Math.sin(rad + 0.13) * 13.5);
    for (let y = 1; y <= 3; y++) set(lx, FLOOR + y, lz, B.OAK_FENCE);
    set(lx, FLOOR + 4, lz, B.LANTERN);
  }
  // lampadaires le long des avenues
  for (let t = 18; t < R - 4; t += 7)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const side of [-4, 4]) {
        const x = cx + dx * t + (dz ? side : 0), z = cz + dz * t + (dx ? side : 0);
        for (let y = 1; y <= 3; y++) set(x, FLOOR + y, z, id('dark_oak_fence', B.OAK_FENCE));
        set(x, FLOOR + 4, z, B.LANTERN);
      }
    }
  // --- logo géant « HYPXL » flottant au nord, avec ombre et socle lumineux
  const word = 'HYPXL';
  const W = word.length * 6 - 1;
  for (let li = 0; li < word.length; li++) {
    const glyph = FONT[word[li]];
    const block = li < 3 ? gold : id('redstone_block', conc('red'));
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] !== '#') continue;
        const x = cx - Math.floor(W / 2) + li * 6 + col, y = FLOOR + 22 - row;
        set(x, y, cz - 47, block);
        set(x + 1, y - 1, cz - 46, id('black_concrete', B.OBSIDIAN));
      }
  }
  for (let x = -W / 2 - 2; x <= W / 2 + 2; x++) {
    set(Math.round(cx + x), FLOOR + 13, cz - 47, lamp);
    set(Math.round(cx + x), FLOOR + 13, cz - 46, quartz);
  }
  for (const sx of [-W / 2 - 2, W / 2 + 2]) for (let y = FLOOR + 1; y <= FLOOR + 12; y++) set(Math.round(cx + sx), y, cz - 47, qpillar);
  // --- arc des jeux : socles, piliers de couleur et lanternes
  for (const n of HUB_NPCS) {
    disc(set, n.x, n.z, 3, FLOOR, (_x, _z, d) => (d > 2.4 ? andesite : quartz));
    disc(set, n.x, n.z, 2, FLOOR + 1, (_x, _z, d) => (d < 1.2 ? id(n.block, quartz) : B.AIR));
    // pilier emblème derrière le PNJ (vers l'extérieur)
    const d = Math.hypot(n.x - cx, n.z - cz), ux = (n.x - cx) / d, uz = (n.z - cz) / d;
    const px = Math.round(n.x + ux * 4), pz = Math.round(n.z + uz * 4);
    for (let y = FLOOR + 1; y <= FLOOR + 7; y++) set(px, y, pz, y === FLOOR + 7 ? lamp : id(n.accent, quartz));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) set(px + dx, FLOOR + 1, pz + dz, id(`${n.block}`, quartz));
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      set(n.x + dx, FLOOR + 1, n.z + dz, id('end_rod', B.OAK_FENCE));
    }
  }
  // --- quartier est : boutique de cosmétiques (auvent rayé) et sanctuaire des boîtes mystères
  {
    const { x: sx, z: sz } = HUB_SERVICES.cosmetics;
    for (let x = sx + 2; x <= sx + 10; x++)
      for (let z = sz - 4; z <= sz + 4; z++) {
        set(x, FLOOR, z, qbricks);
        const edge = x === sx + 2 || x === sx + 10 || z === sz - 4 || z === sz + 4;
        for (let y = 1; y <= 4; y++) if (edge && !(x === sx + 2 && Math.abs(z - sz) <= 1 && y <= 3)) set(x, FLOOR + y, z, y === 2 && (x + z) % 2 === 0 && x !== sx + 2 ? id('pink_stained_glass', B.GLASS) : quartz);
        set(x, FLOOR + 5, z, conc(z % 2 ? 'pink' : 'white'));
      }
    for (let z = sz - 5; z <= sz + 5; z++) set(sx + 1, FLOOR + 4, z, conc(z % 2 ? 'magenta' : 'white'));
    for (const z of [sz - 2, sz + 2]) set(sx + 3, FLOOR + 1, z, B.CHEST);
    set(sx + 6, FLOOR + 4, sz, B.LANTERN);
    const { x: mx, z: mz } = HUB_SERVICES.mystery;
    disc(set, mx + 5, mz, 3, FLOOR, (_x, _z, d) => (d > 2.2 ? id('crying_obsidian', B.OBSIDIAN) : B.OBSIDIAN));
    set(mx + 5, FLOOR + 1, mz, id('ender_chest', B.CHEST));
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      set(mx + 5 + dx, FLOOR + 1, mz + dz, B.OBSIDIAN);
      set(mx + 5 + dx, FLOOR + 2, mz + dz, id('end_rod', glow));
    }
  }
  // --- quartier ouest : tour et parcours en spirale, mur des classements
  {
    const tx = -42, tz = 0;
    for (let y = FLOOR + 1; y <= FLOOR + 17; y++)
      disc(set, tx, tz, 3, y, (x, z, d) => (d > 2.2 ? (y % 4 === 0 && (x + z) % 2 ? id('cyan_stained_glass', B.GLASS) : bricks) : B.AIR));
    disc(set, tx, tz, 4, FLOOR + 18, (x, z, d) => (d > 3.3 && (x + z) % 2 ? B.AIR : bricks));
    disc(set, tx, tz, 4, FLOOR + 19, (x, z, d) => (d > 3.3 && (x + z) % 2 === 0 ? bricks : B.AIR));
    set(tx, FLOOR + 19, tz, lamp);
    hubParkour().forEach((p, i, all) => set(p.x, p.y, p.z, i === 0 ? gold : i === all.length - 1 ? id('emerald_block', gold) : id(`${['white', 'yellow', 'lime', 'light_blue', 'magenta', 'orange'][i % 6]}_wool`, quartz)));
    const { x: lx, z: lz } = HUB_SERVICES.leaderboard;
    for (let x = lx - 5; x <= lx + 5; x++) for (let y = FLOOR + 1; y <= FLOOR + 7; y++) set(x, y, lz + 1, x === lx - 5 || x === lx + 5 || y === FLOOR + 7 ? id('dark_oak_log', B.OAK_LOG) : id('dark_oak_planks', B.OAK_PLANKS));
    for (const x of [lx - 3, lx, lx + 3]) set(x, FLOOR + 1, lz - 1, x === lx ? gold : x < lx ? id('iron_block', quartz) : id('copper_block', quartz));
  }
  // --- entrée sud : arche et terrasse d'arrivée
  {
    const z = 40;
    for (const x of [-5, 5]) for (let y = FLOOR + 1; y <= FLOOR + 8; y++) set(cx + x, y, cz + z, qpillar);
    for (let x = -5; x <= 5; x++) {
      set(cx + x, FLOOR + 9, cz + z, quartz);
      set(cx + x, FLOOR + 10, cz + z, Math.abs(x) % 2 ? gold : quartz);
    }
    set(cx, FLOOR + 11, cz + z, id('beacon', lamp));
    disc(set, cx, cz + 45, 4, FLOOR, (_x, _z, d) => (d < 1.2 ? gold : d < 2.4 ? quartz : diorite));
  }
  // --- tours de garde sur le pourtour
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * (Math.PI / 4);
    const tx = Math.round(cx + Math.cos(a) * (R - 4)), tz = Math.round(cz + Math.sin(a) * (R - 4));
    for (let y = FLOOR + 1; y <= FLOOR + 12; y++) disc(set, tx, tz, 2, y, (x, z, d) => (d > 1.3 ? (y % 5 === 0 && d < 2.2 && (x === tx || z === tz) ? id('light_blue_stained_glass', B.GLASS) : bricks) : B.AIR));
    disc(set, tx, tz, 3, FLOOR + 13, () => bricks);
    disc(set, tx, tz, 3, FLOOR + 14, (x, z, d) => (d > 2.3 && (x + z) % 2 === 0 ? bricks : B.AIR));
    set(tx, FLOOR + 14, tz, lamp);
  }
  // muret de bordure
  for (let a = 0; a < 360; a += 1.5) {
    const x = Math.round(cx + Math.cos((a * Math.PI) / 180) * (R - 1)), z = Math.round(cz + Math.sin((a * Math.PI) / 180) * (R - 1));
    set(x, FLOOR + 1, z, id('stone_brick_wall', bricks));
  }
  // --- jardins : arbres, haies et parterres (quadrants entre les avenues)
  const flowers = ['poppy', 'dandelion', 'cornflower', 'oxeye_daisy', 'allium', 'azure_bluet', 'red_tulip', 'pink_tulip', 'lily_of_the_valley'].map((k) => id(k, B.POPPY));
  const trees: ['oak' | 'birch' | 'cherry', number, number][] = [];
  for (let i = 0; i < 70 && trees.length < 26; i++) {
    const a = r.next() * Math.PI * 2, d = 28 + r.next() * (R - 34);
    const x = Math.round(cx + Math.cos(a) * d), z = Math.round(cz + Math.sin(a) * d);
    if (Math.abs(x) < 7 || Math.abs(z) < 7) continue;
    if (z < -20 && Math.abs(x) < 34) continue; // arc des jeux et logo
    if (x > 30 && Math.abs(z) < 16) continue; // boutique
    if (x < -30 && Math.abs(z) < 14) continue; // tour du parcours
    if (Math.abs(x + 30) < 8 && Math.abs(z - 26) < 5) continue; // classements
    if (Math.abs(x - 12) < 4 && Math.abs(z - 38) < 4) continue;
    if (trees.some(([, tx, tz]) => Math.hypot(tx - x, tz - z) < 7)) continue;
    trees.push([r.next() < 0.4 ? 'cherry' : r.next() < 0.5 ? 'birch' : 'oak', x, z]);
  }
  for (const [t, x, z] of trees) {
    buildTree(t, x, FLOOR + 1, z, r.int(1, 1e6), (bx, by, bz, b) => set(bx, by, bz, b));
    for (let i = 0; i < 8; i++) {
      const fx = x + r.int(-3, 3), fz = z + r.int(-3, 3);
      if (Math.hypot(fx, fz) < R - 3 && Math.abs(fx) > 4 && Math.abs(fz) > 4) set(fx, FLOOR + 1, fz, flowers[r.int(0, flowers.length - 1)]);
    }
  }
  // haies le long de la place
  for (let a = 0; a < 360; a += 2) {
    const deg = a % 90;
    if (deg < 12 || deg > 78) continue;
    const rad = (a * Math.PI) / 180;
    set(Math.round(cx + Math.cos(rad) * 16.5), FLOOR + 1, Math.round(cz + Math.sin(rad) * 16.5), id('oak_leaves', B.OAK_LEAVES), 1);
  }
}

/** Le hub est construit une seule fois puis découpé par chunk (génération rapide). */
let hubCache: Map<string, number[]> | null = null;
function buildHubCached(set: Set3, cx: number, cz: number) {
  if (!hubCache) {
    const cache = new Map<string, number[]>();
    buildHub((x, y, z, b, m = 0) => {
      if (b === undefined) return;
      const k = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
      let a = cache.get(k);
      if (!a) cache.set(k, (a = []));
      a.push(x, y, z, b, m);
    });
    hubCache = cache;
  }
  const a = hubCache.get(`${cx},${cz}`);
  if (a) for (let i = 0; i < a.length; i += 5) set(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4]);
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

function buildSumo(set: Set3) {
  const { x, z, r } = SUMO;
  disc(set, x, z, r, FLOOR, (_x, _z, d) => (d > r - 1.2 ? id('red_concrete', B.STONE) : id('white_concrete', B.SNOW_BLOCK)));
  disc(set, x, z, r - 1, FLOOR - 1, () => id('red_terracotta', B.STONE));
  disc(set, x, z, 1, FLOOR, () => id('gold_block', B.STONE));
  // spectateurs : anneau de gradins lointain
  for (let a = 0; a < 360; a += 4) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < 3; k++) set(Math.round(x + Math.cos(rad) * (r + 8 + k)), FLOOR - 2 + k, Math.round(z + Math.sin(rad) * (r + 8 + k)), k === 2 ? id('sea_lantern', B.GLASS) : id('stone_bricks', B.STONE));
  }
}

/** Sol de Block Party pour un motif (couleurs par case). */
export function buildBlockPartyFloor(set: Set3, pattern: number[] | null) {
  const { x, z, half } = BLOCKPARTY;
  const n = half * 2 + 1;
  for (let dz = 0; dz < n; dz++)
    for (let dx = 0; dx < n; dx++) {
      const c = pattern ? pattern[dz * n + dx] : (dx + dz) % BLOCKPARTY_COLORS.length;
      set(x - half + dx, FLOOR, z - half + dz, c < 0 ? B.AIR : id(`${BLOCKPARTY_COLORS[c]}_concrete`, id(`${BLOCKPARTY_COLORS[c]}_wool`, B.SNOW_BLOCK)));
    }
}
function buildBlockParty(set: Set3) {
  const { x, z, half } = BLOCKPARTY;
  buildBlockPartyFloor(set, null);
  // piliers lumineux et « enceintes » autour de la piste
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = x + sx * (half + 3), pz = z + sz * (half + 3);
    for (let y = FLOOR - 4; y <= FLOOR + 8; y++) set(px, y, pz, y % 3 === 0 ? id('sea_lantern', B.GLASS) : id('black_concrete', B.OBSIDIAN));
    set(px, FLOOR + 9, pz, id('jukebox', B.OAK_PLANKS));
  }
  for (let a = 0; a < 360; a += 3) {
    const rad = (a * Math.PI) / 180;
    set(Math.round(x + Math.cos(rad) * (half + 6)), FLOOR + 6, Math.round(z + Math.sin(rad) * (half + 6)), id(`${BLOCKPARTY_COLORS[Math.floor(a / 3) % BLOCKPARTY_COLORS.length]}_stained_glass`, B.GLASS));
  }
}

/** Îles de BedWars (sans les lits, posés au début de la partie) et île centrale. */
export function buildBedWarsBeds(set: Set3) {
  BEDWARS_TEAMS.forEach((t, i) => {
    const isl = bedwarsIsland(i);
    // orientation du lit : pied vers le centre de l'île (méta : 0 sud, 1 ouest, 2 nord, 3 est)
    const f = t.dz > 0 ? 0 : t.dx < 0 ? 1 : t.dz < 0 ? 2 : 3;
    set(isl.bed[0][0], isl.bed[0][1], isl.bed[0][2], B.RED_BED ?? id('red_bed', B.OAK_PLANKS), f);
    set(isl.bed[1][0], isl.bed[1][1], isl.bed[1][2], B.RED_BED ?? id('red_bed', B.OAK_PLANKS), f | 4);
  });
}
function buildBedWars(set: Set3) {
  const r = new Rng(31337);
  BEDWARS_TEAMS.forEach((t, i) => {
    const isl = bedwarsIsland(i);
    for (let k = 0; k <= 4; k++) disc(set, isl.x, isl.z, 5 - k, FLOOR - k, () => (k === 0 ? id(`${t.wool}_wool`, B.STONE) : r.next() < 0.2 ? B.DIRT : B.STONE));
    // générateur (bloc de fer) et marchand
    set(isl.x - t.dx * 4, FLOOR, isl.z - t.dz * 4, id('iron_block', B.STONE));
  });
  for (let k = 0; k <= 5; k++) disc(set, BEDWARS.x, BEDWARS.z, 6 - k, FLOOR - k, () => (k === 0 ? id('end_stone', B.STONE) : B.STONE));
  set(BEDWARS.x, FLOOR + 1, BEDWARS.z, id('diamond_block', B.STONE));
  buildBedWarsBeds(set);
}

/** Emprises des cartes (pour ne construire que les chunks concernés). */
const MAPS: { x0: number; z0: number; x1: number; z1: number; build: (set: Set3) => void }[] = [
  { x0: -64, z0: -64, x1: 64, z1: 64, build: buildHub },
  { x0: SUMO.x - 20, z0: -20, x1: SUMO.x + 20, z1: 20, build: buildSumo },
  { x0: BLOCKPARTY.x - 20, z0: -20, x1: BLOCKPARTY.x + 20, z1: 20, build: buildBlockParty },
  { x0: BEDWARS.x - 34, z0: -34, x1: BEDWARS.x + 34, z1: 34, build: buildBedWars },
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
    for (const m of MAPS) if (m.x1 >= bx && m.x0 < bx + CHUNK_SIZE && m.z1 >= bz && m.z0 < bz + CHUNK_SIZE) (m.build === buildHub ? buildHubCached(set, cx, cz) : m.build(set));
    computeHeights(c);
    return { data: c, specials: scanSpecials(c) };
  }
}
