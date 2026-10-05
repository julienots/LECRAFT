/**
 * Génère l'atlas de textures pixel-art 16x16 (100 % original, procédural, déterministe).
 * Convention : alpha 200/255 = zone « teintée » par la couleur du biome (herbe, feuilles).
 * alpha 0 = transparent (cutout).
 */
import { Rng } from '../util/math';
import { ATLAS_COLS, TILE_PX, TileRegistry } from './TileRegistry';

type RGB = [number, number, number];
const TINT_A = 200;

export const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const c255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

export class Tile {
  data = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  rng: Rng;
  constructor(seed: number) {
    this.rng = new Rng(seed);
  }
  set(x: number, y: number, c: RGB, a = 255, k = 1) {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const i = (y * TILE_PX + x) * 4;
    this.data[i] = c255(c[0] * k);
    this.data[i + 1] = c255(c[1] * k);
    this.data[i + 2] = c255(c[2] * k);
    this.data[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = (y * TILE_PX + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  alpha(x: number, y: number) {
    return this.data[(y * TILE_PX + x) * 4 + 3];
  }
  /** Remplissage bruité autour d'une couleur. */
  noise(c: RGB, v = 0.12, a = 255) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.set(x, y, c, a, 1 + (this.rng.next() - 0.5) * 2 * v);
    return this;
  }
  /** Taches de couleur. */
  speckle(c: RGB, count: number, size = 1, v = 0.1, a = 255) {
    for (let n = 0; n < count; n++) {
      const x = this.rng.int(0, 15), y = this.rng.int(0, 15);
      for (let dy = 0; dy < size; dy++)
        for (let dx = 0; dx < size; dx++) if (this.rng.next() < 0.8) this.set((x + dx) & 15, (y + dy) & 15, c, a, 1 + (this.rng.next() - 0.5) * v);
    }
    return this;
  }
  /** Amas de minerai. */
  ore(c: RGB, clusters: number, hi?: RGB) {
    for (let n = 0; n < clusters; n++) {
      const cx = this.rng.int(2, 13), cy = this.rng.int(2, 13);
      const pts = this.rng.int(3, 6);
      for (let p = 0; p < pts; p++) {
        const x = cx + this.rng.int(-1, 1), y = cy + this.rng.int(-1, 1);
        this.set(x, y, c, 255, 0.85 + this.rng.next() * 0.3);
        if (hi && this.rng.next() < 0.4) this.set(x, y - 1 < 0 ? 0 : y - 1, hi);
      }
    }
    return this;
  }
  rect(x0: number, y0: number, w: number, h: number, c: RGB, a = 255, v = 0) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a, 1 + (this.rng.next() - 0.5) * 2 * v);
    return this;
  }
  border(c: RGB, a = 255) {
    for (let i = 0; i < 16; i++) {
      this.set(i, 0, c, a); this.set(i, 15, c, a); this.set(0, i, c, a); this.set(15, i, c, a);
    }
    return this;
  }
  clear() {
    this.data.fill(0);
    return this;
  }
  copy(o: Tile) {
    this.data.set(o.data);
    return this;
  }
}

const P = {
  stone: hex('#7d7f86'),
  dirt: hex('#7a5233'),
  tint: hex('#c8c8c8'),
  sand: hex('#e0d29a'),
  wood: hex('#b58a52'),
  bark: hex('#6b4f2c'),
};

function stone(t: Tile, base = P.stone) {
  t.noise(base, 0.08);
  t.speckle([base[0] * 0.8, base[1] * 0.8, base[2] * 0.82], 14, 2, 0.1);
  t.speckle([base[0] * 1.12, base[1] * 1.12, base[2] * 1.12], 8, 1, 0.05);
  return t;
}
function dirt(t: Tile) {
  t.noise(P.dirt, 0.12);
  t.speckle(hex('#5e3e24'), 12, 1);
  t.speckle(hex('#94683f'), 8, 1);
  return t;
}
function logSide(t: Tile, bark: RGB, dark: RGB) {
  t.noise(bark, 0.07);
  for (let x = 0; x < 16; x += 3 + t.rng.int(0, 1)) for (let y = 0; y < 16; y++) if (t.rng.next() < 0.75) t.set(x, y, dark, 255, 0.9 + t.rng.next() * 0.2);
  return t;
}
function logTop(t: Tile, wood: RGB, bark: RGB) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.6) t.set(x, y, bark, 255, 0.9 + t.rng.next() * 0.2);
      else t.set(x, y, wood, 255, (Math.floor(d) % 2 ? 0.88 : 1) + t.rng.next() * 0.06);
    }
  return t;
}
function leaves(t: Tile, holes = 0.18, base: RGB = P.tint) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (t.rng.next() < holes) t.set(x, y, [0, 0, 0], 0);
      else t.set(x, y, base, TINT_A, 0.7 + t.rng.next() * 0.45);
    }
  return t;
}
function plank(t: Tile, c: RGB) {
  t.noise(c, 0.05);
  for (let y = 0; y < 16; y++) {
    if (y % 4 === 3) for (let x = 0; x < 16; x++) t.set(x, y, c, 255, 0.7);
  }
  for (let r = 0; r < 4; r++) {
    const x = (r * 7 + 3) % 16;
    t.set(x, r * 4 + 1, c, 255, 0.72);
    t.set((x + 8) % 16, r * 4 + 2, c, 255, 0.75);
  }
  return t;
}
function bricks(t: Tile, mortar: RGB, brick: RGB, bw = 8, bh = 4) {
  t.noise(brick, 0.08);
  for (let y = 0; y < 16; y++) {
    const row = Math.floor(y / bh);
    for (let x = 0; x < 16; x++) {
      const off = row % 2 ? bw / 2 : 0;
      if (y % bh === bh - 1 || (x + off) % bw === 0) t.set(x, y, mortar, 255, 0.95 + t.rng.next() * 0.1);
    }
  }
  return t;
}
function cross(t: Tile, fn: (t: Tile) => void) {
  t.clear();
  fn(t);
  return t;
}
function stem(t: Tile, x: number, y0: number, y1: number, c: RGB, a = 255) {
  for (let y = y0; y <= y1; y++) t.set(x, y, c, a, 0.85 + t.rng.next() * 0.3);
}
function crop(t: Tile, stage: number, max: number, ripe: RGB, green: RGB) {
  t.clear();
  const h = 3 + Math.round((stage / max) * 12);
  const frac = stage / max;
  const col: RGB = [green[0] + (ripe[0] - green[0]) * frac, green[1] + (ripe[1] - green[1]) * frac, green[2] + (ripe[2] - green[2]) * frac];
  for (const x of [2, 5, 8, 11, 14]) {
    const hh = h - t.rng.int(0, 2);
    stem(t, x, 16 - hh, 15, col);
    if (stage >= max - 1) for (let y = 16 - hh; y < 16 - hh + 3; y++) t.set(x + 1, y, ripe, 255, 0.9);
  }
  return t;
}

const painters: Record<string, (t: Tile, frame: number) => void> = {
  missing: (t) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, (x >> 3) ^ (y >> 3) ? hex('#ff00ff') : [0, 0, 0]); },
  bedrock: (t) => { t.noise(hex('#3a3a3e'), 0.3); t.speckle(hex('#18181a'), 20, 2); t.speckle(hex('#6a6a70'), 10, 1); },
  stone: (t) => stone(t),
  dirt: (t) => dirt(t),
  grass_top: (t) => { t.noise(P.tint, 0.14, TINT_A); t.speckle(hex('#a8a8a8'), 18, 1, 0.1, TINT_A); t.speckle(hex('#e8e8e8'), 10, 1, 0.1, TINT_A); },
  grass_side: (t) => {
    dirt(t);
    for (let x = 0; x < 16; x++) {
      const h = 3 + t.rng.int(0, 2) + (t.rng.next() < 0.25 ? 1 : 0);
      for (let y = 0; y < h; y++) t.set(x, y, P.tint, TINT_A, 0.8 + t.rng.next() * 0.3);
    }
  },
  sand: (t) => { t.noise(P.sand, 0.05); t.speckle(hex('#c9b97c'), 16, 1); t.speckle(hex('#f2e6b8'), 10, 1); },
  gravel: (t) => { t.noise(hex('#8c8580'), 0.1); for (let i = 0; i < 26; i++) { const x = t.rng.int(0, 14), y = t.rng.int(0, 14); const c = t.rng.pick([hex('#5f5a56'), hex('#a8a29c'), hex('#746c66')]); t.rect(x, y, 2, 2, c, 255, 0.05); } },
  log_top: (t) => logTop(t, hex('#b88c55'), P.bark),
  log_side: (t) => logSide(t, P.bark, hex('#4e3920')),
  leaves: (t) => leaves(t),
  planks: (t) => plank(t, P.wood),
  glass: (t) => { t.clear(); t.border(hex('#d8f0f8'), 255); for (let i = 3; i < 7; i++) t.set(i, i - 1, hex('#ffffff'), 220); t.set(11, 10, hex('#ffffff'), 200); t.set(12, 11, hex('#ffffff'), 200); for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) if (t.alpha(x, y) === 0) t.set(x, y, hex('#c0e4f0'), 26); },
  water: (t, f) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const w = Math.sin((x + f * 4) * 0.8) + Math.sin((y * 1.3 + x * 0.4 - f * 3) * 0.7); t.set(x, y, hex('#3a6fd8'), 190, 0.85 + w * 0.08 + t.rng.next() * 0.05); } },
  water_flow: (t) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex('#3a6fd8'), 190, 0.85 + Math.sin(y * 1.1 + x * 0.2) * 0.1); },
  lava: (t, f) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const w = Math.sin((x + f * 2) * 0.6 + Math.sin(y * 0.5 + f)) + Math.cos((y - f * 2) * 0.7); t.set(x, y, w > 0.6 ? hex('#ffd24a') : w > -0.4 ? hex('#ff7a1a') : hex('#c83c0a'), 255, 0.95 + t.rng.next() * 0.1); } },
  snow: (t) => { t.noise(hex('#f2f6fa'), 0.03); t.speckle(hex('#dde6f0'), 12, 1); },
  ice: (t) => { t.noise(hex('#9cc8f2'), 0.05, 200); for (let i = 0; i < 4; i++) { let x = t.rng.int(0, 15), y = t.rng.int(0, 15); for (let s = 0; s < 6; s++) { t.set(x, y, hex('#e4f2ff'), 230); x += t.rng.int(0, 1); y += t.rng.int(-1, 1); } } },
  coal_ore: (t) => stone(t).ore(hex('#1e1e22'), 5, hex('#3a3a40')),
  copper_ore: (t) => stone(t).ore(hex('#c26b3c'), 4, hex('#4fb59a')),
  iron_ore: (t) => stone(t).ore(hex('#d8b08c'), 4, hex('#f0d2b4')),
  gold_ore: (t) => stone(t).ore(hex('#f5d442'), 4, hex('#fff2a0')),
  crystal_ore: (t) => { stone(t, hex('#5c5e66')).ore(hex('#62e8f0'), 4, hex('#d0ffff')); },
  aurite_ore: (t) => { stone(t, hex('#4c4a56')).ore(hex('#b366ff'), 3, hex('#f0c8ff')); },
  cobblestone: (t) => { t.noise(hex('#6f7074'), 0.05); for (let i = 0; i < 11; i++) { const x = t.rng.int(0, 13), y = t.rng.int(0, 13), w = t.rng.int(3, 5), h = t.rng.int(3, 4); t.rect(x, y, w, h, t.rng.pick([hex('#8a8b90'), hex('#7a7b80'), hex('#9a9ba0')]), 255, 0.05); } for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (t.rng.next() < 0.08) t.set(x, y, hex('#4a4b50')); },
  sandstone_top: (t) => { t.noise(hex('#d8c58a'), 0.05); t.speckle(hex('#c4b078'), 10, 1); },
  sandstone: (t) => { t.noise(hex('#d8c58a'), 0.04); for (let x = 0; x < 16; x++) { t.set(x, 3, hex('#bba870')); t.set(x, 12, hex('#bba870')); t.set(x, 13, hex('#e8d8a0')); } },
  snowy_grass_side: (t) => { dirt(t); for (let x = 0; x < 16; x++) { const h = 3 + t.rng.int(0, 2); for (let y = 0; y < h; y++) t.set(x, y, hex('#f2f6fa'), 255, 0.95 + t.rng.next() * 0.05); } },
  cactus_top: (t) => { t.noise(hex('#5aa04a'), 0.06); t.border(hex('#2f6a28')); t.rect(6, 6, 4, 4, hex('#7cc066')); },
  cactus_side: (t) => { t.noise(hex('#3f8a35'), 0.06); for (let y = 0; y < 16; y++) { t.set(0, y, hex('#2f6a28')); t.set(15, y, hex('#2f6a28')); } for (let i = 0; i < 9; i++) t.set(t.rng.int(2, 13), t.rng.int(0, 15), hex('#e8e0b0')); },
  tall_grass: (t) => cross(t, (t) => { for (let i = 0; i < 9; i++) { const x = t.rng.int(1, 14); const h = t.rng.int(6, 14); for (let y = 16 - h; y < 16; y++) t.set(x + (y < 8 && i % 2 ? 1 : 0), y, P.tint, TINT_A, 0.75 + t.rng.next() * 0.4); } }),
  flower_red: (t) => cross(t, (t) => { stem(t, 7, 7, 15, hex('#3f8a2c')); t.set(6, 11, hex('#4f9a3c')); t.set(8, 12, hex('#4f9a3c')); t.rect(5, 3, 5, 4, hex('#d83a2e'), 255, 0.1); t.rect(6, 2, 3, 1, hex('#e85a4e')); t.rect(7, 4, 1, 2, hex('#2a1a10')); }),
  flower_yellow: (t) => cross(t, (t) => { stem(t, 8, 8, 15, hex('#3f8a2c')); t.set(9, 12, hex('#4f9a3c')); for (const [x, y] of [[8, 4], [6, 5], [10, 5], [7, 7], [9, 7], [8, 6]]) t.rect(x - 1, y - 1, 2, 2, hex('#f2d22e'), 255, 0.1); t.set(8, 5, hex('#c87a10')); }),
  dead_bush: (t) => cross(t, (t) => { const c = hex('#8a6a3c'); stem(t, 8, 6, 15, c); for (let i = 0; i < 6; i++) { let x = 8, y = t.rng.int(7, 12); const dx = i % 2 ? 1 : -1; for (let s = 0; s < 4; s++) { x += dx; y -= t.rng.int(0, 1); t.set(x, y, c); } } }),
  torch: (t) => cross(t, (t) => { t.rect(7, 6, 2, 10, hex('#8a6a3c')); t.rect(7, 4, 2, 2, hex('#ffcf5a')); t.set(7, 3, hex('#fff2b0')); t.set(8, 4, hex('#ff8a20')); }),
  crafting_top: (t) => { plank(t, hex('#a07040')); t.border(hex('#5a3a1e')); for (let i = 1; i < 15; i++) { t.set(i, 5, hex('#5a3a1e')); t.set(i, 10, hex('#5a3a1e')); t.set(5, i, hex('#5a3a1e')); t.set(10, i, hex('#5a3a1e')); } },
  crafting_side: (t) => { plank(t, hex('#a07040')); t.rect(0, 0, 16, 3, hex('#6b4f2c')); t.rect(3, 6, 3, 6, hex('#c0c0c8')); t.rect(10, 5, 2, 8, hex('#6b4f2c')); t.rect(9, 5, 4, 2, hex('#909098')); },
  crafting_front: (t) => { plank(t, hex('#a07040')); t.rect(0, 0, 16, 3, hex('#6b4f2c')); t.rect(4, 6, 8, 6, hex('#3a2a18')); t.rect(5, 7, 2, 4, hex('#c0c0c8')); t.rect(9, 7, 2, 4, hex('#b58a52')); },
  furnace_top: (t) => stone(t, hex('#6a6a6a')),
  furnace_side: (t) => { stone(t, hex('#6a6a6a')); t.border(hex('#4a4a4a')); },
  furnace_front: (t) => { stone(t, hex('#6a6a6a')); t.border(hex('#4a4a4a')); t.rect(4, 8, 8, 6, hex('#1a1a1a')); t.rect(5, 11, 6, 2, hex('#ff7a1a'), 255, 0.2); t.rect(4, 3, 8, 2, hex('#3a3a3a')); },
  chest_top: (t) => { plank(t, hex('#a8742f')); t.border(hex('#4a3010')); },
  chest_side: (t) => { plank(t, hex('#a8742f')); t.border(hex('#4a3010')); for (let x = 0; x < 16; x++) t.set(x, 5, hex('#4a3010')); },
  chest_front: (t) => { plank(t, hex('#a8742f')); t.border(hex('#4a3010')); for (let x = 0; x < 16; x++) t.set(x, 5, hex('#4a3010')); t.rect(7, 4, 2, 4, hex('#d8d8e0')); t.set(7, 6, hex('#303030')); },
  farmland_dry: (t) => { t.noise(hex('#7a5233'), 0.08); for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) t.set(x, y, hex('#5a3c22')); },
  farmland_wet: (t) => { t.noise(hex('#4a3020'), 0.08); for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) t.set(x, y, hex('#2e1e12')); },
  sapling: (t) => cross(t, (t) => { stem(t, 8, 8, 15, hex('#6b4f2c')); for (let i = 0; i < 26; i++) { const a = t.rng.next() * Math.PI * 2, r = t.rng.next() * 4.5; t.set(Math.round(8 + Math.cos(a) * r), Math.round(6 + Math.sin(a) * r * 0.8), hex('#4f8a2c'), 255, 0.8 + t.rng.next() * 0.4); } }),
  bricks: (t) => bricks(t, hex('#b8aca0'), hex('#9c4a3a')),
  mossy_cobble: (t) => { painters.cobblestone(t, 0); t.speckle(hex('#4f7a3a'), 16, 2, 0.2); },
  obsidian: (t) => { t.noise(hex('#22183a'), 0.15); t.speckle(hex('#4a3a70'), 8, 1); t.speckle(hex('#100a1e'), 10, 2); },
  clay: (t) => { t.noise(hex('#9aa3b0'), 0.05); t.speckle(hex('#8a92a0'), 10, 2); },
  jungle_log_top: (t) => logTop(t, hex('#a8844a'), hex('#5a4320')),
  jungle_log_side: (t) => { logSide(t, hex('#5a4320'), hex('#3e2e14')); t.speckle(hex('#4f7a2a'), 6, 1); },
  jungle_leaves: (t) => leaves(t, 0.12),
  spruce_log_top: (t) => logTop(t, hex('#8a6a40'), hex('#3e2c1a')),
  spruce_log_side: (t) => logSide(t, hex('#3e2c1a'), hex('#2a1e10')),
  spruce_leaves: (t) => leaves(t, 0.22, hex('#a0a8a0')),
  birch_log_top: (t) => logTop(t, hex('#d0b080'), hex('#dcd6c4')),
  birch_log_side: (t) => { t.noise(hex('#dcd6c4'), 0.04); for (let i = 0; i < 9; i++) { const x = t.rng.int(0, 13), y = t.rng.int(0, 15); t.rect(x, y, t.rng.int(2, 4), 1, hex('#2a2a26')); } },
  birch_leaves: (t) => leaves(t, 0.2, hex('#d0d8b8')),
  acacia_log_top: (t) => logTop(t, hex('#c8603a'), hex('#6e6258')),
  acacia_log_side: (t) => logSide(t, hex('#6e6258'), hex('#4e443c')),
  acacia_leaves: (t) => leaves(t, 0.25, hex('#d0d0a0')),
  mud: (t) => { t.noise(hex('#3e3328'), 0.08); t.speckle(hex('#2e251c'), 14, 2); },
  glow_mushroom: (t) => cross(t, (t) => { t.rect(7, 9, 2, 7, hex('#d8e8e0')); t.rect(4, 6, 8, 3, hex('#5ef0c8'), 255, 0.1); t.rect(5, 5, 6, 1, hex('#9ff8e0')); t.set(6, 7, hex('#ffffff')); t.set(9, 6, hex('#ffffff')); }),
  moss: (t) => { t.noise(hex('#4c7d2e'), 0.12); t.speckle(hex('#6a9a3e'), 14, 1); },
  spikes: (t) => cross(t, (t) => { for (const x of [2, 7, 12]) for (let y = 4; y < 16; y++) { const w = Math.floor((y - 4) / 4); t.rect(x - w + 1, y, 1 + w * 2, 1, hex('#9a9aa8'), 255, 0.1); } t.rect(0, 14, 16, 2, hex('#5a5a66')); }),
  spawner: (t) => { t.clear(); t.border(hex('#303848')); for (let i = 0; i < 16; i += 4) for (let j = 0; j < 16; j++) { t.set(i, j, hex('#303848')); t.set(j, i, hex('#303848')); } t.rect(6, 6, 4, 4, hex('#8a2a2a'), 180); },
  altar_top: (t) => { bricks(t, hex('#3a3a40'), hex('#75767c')); t.rect(5, 5, 6, 6, hex('#7a40c0'), 255, 0.15); t.rect(7, 7, 2, 2, hex('#e0b0ff')); },
  altar_side: (t) => { bricks(t, hex('#3a3a40'), hex('#75767c')); for (let x = 2; x < 14; x++) t.set(x, 7, hex('#a060e0')); },
  wool: (t) => { t.noise(hex('#ecebe4'), 0.04); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y * 3) % 7 === 0) t.set(x, y, hex('#d4d2c8')); },
  stone_bricks: (t) => bricks(t, hex('#55565c'), hex('#7a7b80'), 8, 8),
  cracked_bricks: (t) => { bricks(t, hex('#4a4b50'), hex('#6e6f74'), 8, 8); let x = 3, y = 0; for (let i = 0; i < 16; i++) { t.set(x, y, hex('#303034')); y++; x += t.rng.int(-1, 1); } },
  packed_ice: (t) => { t.noise(hex('#86b4e8'), 0.05); t.speckle(hex('#b0d0f8'), 10, 2); },
  crystal_block: (t) => { t.noise(hex('#7ff4fa'), 0.1); for (let i = 0; i < 16; i++) t.set(i, (i * 5) % 16, hex('#e0ffff')); t.border(hex('#40b8c8')); },
  gold_block: (t) => { t.noise(hex('#f8d848'), 0.05); t.border(hex('#c8a020')); t.rect(2, 2, 5, 1, hex('#fff4b0')); },
  iron_block: (t) => { t.noise(hex('#d8d8dc'), 0.03); t.border(hex('#a8a8b0')); t.rect(2, 2, 5, 1, hex('#ffffff')); },
  aurite_block: (t) => { t.noise(hex('#b070ff'), 0.06); t.border(hex('#7030c0')); t.rect(2, 2, 6, 1, hex('#f0d0ff')); t.speckle(hex('#e0b0ff'), 5, 1); },
  bookshelf: (t) => { plank(t, hex('#8a5a32')); for (const row of [1, 9]) { t.rect(1, row, 14, 6, hex('#2a1a10')); for (let x = 1; x < 15; x += 2) t.rect(x, row + t.rng.int(0, 1), 2, 6, t.rng.pick([hex('#a83030'), hex('#3050a8'), hex('#30a050'), hex('#c8a040'), hex('#7040a0')]), 255, 0.08); } },
  hay_top: (t) => { t.noise(hex('#d8b830'), 0.1); t.border(hex('#a88a20')); },
  hay_side: (t) => { t.noise(hex('#d8b830'), 0.1); for (let x = 0; x < 16; x++) { t.set(x, 4, hex('#8a3a20')); t.set(x, 11, hex('#8a3a20')); } for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x += 3) if (t.rng.next() < 0.5) t.set(x, y, hex('#b89820')); },
  pumpkin_top: (t) => { t.noise(hex('#e08a1e'), 0.06); t.rect(7, 6, 2, 3, hex('#5a7a2a')); },
  pumpkin_side: (t) => { t.noise(hex('#e08a1e'), 0.05); for (let x = 1; x < 16; x += 4) for (let y = 0; y < 16; y++) t.set(x, y, hex('#b86a10')); },
  lantern: (t) => { t.clear(); t.rect(4, 4, 8, 10, hex('#3a3a40')); t.rect(5, 5, 6, 8, hex('#ffd070'), 255, 0.15); t.rect(6, 2, 4, 2, hex('#3a3a40')); t.rect(7, 0, 2, 2, hex('#5a5a60')); },
  path_top: (t) => { t.noise(hex('#9a7a48'), 0.08); t.speckle(hex('#7a5a30'), 14, 1); },
  cloud: (t) => { t.noise(hex('#ffffff'), 0.02); },
};
for (let s = 0; s < 8; s++) painters[`wheat_${s}`] = (t) => crop(t, s, 7, hex('#d8c050'), hex('#4a9a2a'));
for (let s = 0; s < 4; s++)
  painters[`carrot_${s}`] = (t) => {
    crop(t, s, 3, hex('#3f9a2a'), hex('#4a9a2a'));
    if (s === 3) for (const x of [3, 9]) t.rect(x, 13, 3, 3, hex('#f08a24'));
  };
for (let s = 0; s < 10; s++)
  painters[`destroy_${s}`] = (t) => {
    t.clear();
    const r = new Rng(777);
    const cracks = 2 + s * 2;
    for (let c = 0; c < cracks; c++) {
      let x = 8 + r.int(-2, 2), y = 8 + r.int(-2, 2);
      const len = 3 + s;
      for (let i = 0; i < len; i++) {
        t.set(x & 15, y & 15, [20, 20, 20], 200);
        x += r.int(-1, 1);
        y += r.int(-1, 1);
      }
    }
  };

/** Construit l'atlas complet. Retourne un canvas de 256x256 pixels. */
export function buildAtlas(): HTMLCanvasElement {
  const size = ATLAS_COLS * TILE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const tiles = drawTiles();
  tiles.forEach((tile, i) => {
    const img = new ImageData(tile.data, TILE_PX, TILE_PX);
    ctx.putImageData(img, (i % ATLAS_COLS) * TILE_PX, Math.floor(i / ATLAS_COLS) * TILE_PX);
  });
  return canvas;
}

/** Dessine toutes les tuiles (pur calcul, testable sans DOM). */
export function drawTiles(): Tile[] {
  return TileRegistry.names.map((full, i) => {
    const [name, frameStr] = full.split('#');
    const frame = frameStr ? Number(frameStr) : 0;
    const t = new Tile(1000 + i * 7919 + (name === full ? 0 : 0));
    const p = painters[name];
    if (!p) {
      if (import.meta.env?.DEV) console.warn('Tuile sans peintre:', name);
      painters.missing(t, 0);
    } else p(t, frame);
    return t;
  });
}

export function hasPainter(name: string) {
  return !!painters[name];
}
