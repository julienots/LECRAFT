/**
 * Génère l'atlas de textures pixel-art 16x16 (dessin procédural original, déterministe),
 * dans le style « vanilla » : palettes quantifiées de 4 à 6 teintes, motifs de planches,
 * écorces, minerais, laines, etc. Un pack de ressources importé peut remplacer chaque tuile.
 *
 * Convention : alpha 200/255 = zone « teintée » par la couleur du biome (herbe, feuilles).
 * alpha 0 = transparent (cutout).
 */
import { Rng } from '../util/math';
import { ATLAS_COLS, TILE_PX, TileRegistry } from './TileRegistry';
import { WOOL_COLORS } from '../data/blocks';

export type RGB = [number, number, number];
const TINT_A = 200;

export const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const c255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class Tile {
  data = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  rng: Rng;
  private vn: Float32Array;
  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.vn = new Float32Array(16 * 16);
    for (let i = 0; i < 256; i++) this.vn[i] = this.rng.next();
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
  /** Bruit de valeur lissé et périodique (raccord parfait entre tuiles). */
  smooth(x: number, y: number, scale = 4): number {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const n = 16 / scale;
    const g = (a: number, b: number) => this.vn[(((a % n) + n) % n) * 16 + (((b % n) + n) % n)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
  }
  /** Remplissage quantifié sur une palette selon une fonction de valeur 0..1. */
  pal(colors: RGB[], fn: (x: number, y: number) => number, a = 255) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const v = Math.max(0, Math.min(0.999, fn(x, y)));
        this.set(x, y, colors[Math.floor(v * colors.length)], a);
      }
    return this;
  }
  /** Palette + bruit mixte (texture minérale typique). */
  grain(colors: RGB[], smoothW = 0.55, scale = 4, a = 255) {
    return this.pal(colors, (x, y) => this.smooth(x, y, scale) * smoothW + this.rng.next() * (1 - smoothW), a);
  }
  speckle(c: RGB, count: number, size = 1, a = 255) {
    for (let n = 0; n < count; n++) {
      const x = this.rng.int(0, 15), y = this.rng.int(0, 15);
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (this.rng.next() < 0.85) this.set((x + dx) & 15, (y + dy) & 15, c, a);
    }
    return this;
  }
  rect(x0: number, y0: number, w: number, h: number, c: RGB, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
    return this;
  }
  hline(x0: number, x1: number, y: number, c: RGB, a = 255) {
    for (let x = x0; x <= x1; x++) this.set(x, y, c, a);
  }
  vline(x: number, y0: number, y1: number, c: RGB, a = 255) {
    for (let y = y0; y <= y1; y++) this.set(x, y, c, a);
  }
  border(c: RGB, a = 255) {
    this.hline(0, 15, 0, c, a);
    this.hline(0, 15, 15, c, a);
    this.vline(0, 0, 15, c, a);
    this.vline(15, 0, 15, c, a);
    return this;
  }
  /** Dessine un motif texte (caractère → couleur), '.' = inchangé. */
  draw(rows: string[], palette: Record<string, RGB | null>, ox = 0, oy = 0) {
    rows.forEach((r, y) =>
      [...r].forEach((ch, x) => {
        if (ch === '.' || !(ch in palette)) return;
        const c = palette[ch];
        if (c === null) this.set(ox + x, oy + y, [0, 0, 0], 0);
        else this.set(ox + x, oy + y, c);
      }),
    );
    return this;
  }
  clear() {
    this.data.fill(0);
    return this;
  }
}

// ---------- palettes ----------
const ramp = (base: string, n = 5, spread = 0.38): RGB[] => {
  const c = hex(base);
  return Array.from({ length: n }, (_, i) => mul(c, 1 - spread / 2 + (spread * i) / (n - 1)));
};
const GRAY = ramp('#7f7f7f', 5, 0.4);
const DIRT = [hex('#593d29'), hex('#79553a'), hex('#866043'), hex('#96704b'), hex('#b9855c')];
const TINT = ramp('#a0a0a0', 5, 0.55);

function stone(t: Tile, pal = GRAY) {
  t.grain(pal, 0.6, 4);
  // taches sombres allongées typiques
  for (let n = 0; n < 5; n++) {
    const x = t.rng.int(0, 15), y = t.rng.int(0, 15), len = t.rng.int(2, 4);
    for (let i = 0; i < len; i++) t.set((x + i) & 15, y, pal[0]);
  }
  return t;
}
function dirt(t: Tile) {
  t.grain(DIRT, 0.35, 4);
  return t;
}
function planks(t: Tile, base: string) {
  const p = ramp(base, 5, 0.32);
  for (let y = 0; y < 16; y++) {
    const row = Math.floor(y / 4);
    for (let x = 0; x < 16; x++) {
      const grainV = t.smooth(x * 0.5, y + row * 7, 4);
      let c = p[1 + Math.floor(grainV * 3)];
      if (y % 4 === 3) c = p[0];
      t.set(x, y, c);
    }
    // joints verticaux décalés
    const j = [3, 11, 7, 15][Math.floor(y / 4)];
    if (y % 4 !== 3) t.set(j, y, p[0]);
  }
  // nœuds du bois
  for (let n = 0; n < 3; n++) t.set(t.rng.int(0, 15), t.rng.int(0, 3) * 4 + t.rng.int(0, 2), p[0]);
  return t;
}
function logSide(t: Tile, bark: string, stripes = true) {
  const p = ramp(bark, 5, 0.5);
  t.pal(p, (x, y) => (stripes ? t.smooth(x * 3, y * 0.4, 4) * 0.7 + t.rng.next() * 0.3 : t.rng.next()));
  if (stripes) for (let x = 1; x < 16; x += t.rng.int(2, 4)) for (let y = 0; y < 16; y++) if (t.rng.next() < 0.7) t.set(x, y, p[0]);
  return t;
}
function logTop(t: Tile, inner: string, bark: string) {
  const pi = ramp(inner, 4, 0.3), pb = ramp(bark, 3, 0.4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) t.set(x, y, pb[t.rng.int(0, 2)]);
      else t.set(x, y, Math.floor(d) % 2 ? pi[1] : pi[2 + (t.rng.next() < 0.3 ? 1 : 0)]);
    }
  return t;
}
function leaves(t: Tile, holes = 0.22) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = t.smooth(x, y, 2) * 0.5 + t.rng.next() * 0.5;
      if (v < holes) t.set(x, y, [0, 0, 0], 0);
      else t.set(x, y, TINT[Math.min(4, Math.floor(v * 5))], TINT_A);
    }
  return t;
}
function ore(t: Tile, colors: string[], pattern = 0) {
  stone(t);
  const c = colors.map(hex);
  const spots = [
    [[3, 3], [4, 3], [3, 4], [10, 2], [11, 2], [11, 3], [6, 8], [7, 8], [7, 9], [12, 10], [12, 11], [13, 11], [3, 12], [4, 12], [4, 13], [9, 13]],
    [[2, 2], [3, 2], [3, 3], [9, 4], [10, 4], [10, 5], [11, 5], [5, 9], [6, 9], [6, 10], [12, 11], [13, 11], [12, 12], [2, 13], [3, 13]],
  ][pattern];
  for (const [x, y] of spots) {
    t.set(x, y, c[0]);
    if (c[1] && t.rng.next() < 0.5) t.set(x, y - 1, c[1]);
    if (c[2] && t.rng.next() < 0.35) t.set(x + 1, y, c[2]);
  }
  return t;
}
function mineral(t: Tile, base: string, style: 'metal' | 'gem' | 'grain' = 'metal') {
  const p = ramp(base, 5, 0.45);
  if (style === 'grain') t.grain(p, 0.5, 4);
  else t.pal(p.slice(1, 4), (x, y) => (style === 'gem' ? ((x + y) % 4 === 0 ? 0.9 : 0.4 + t.rng.next() * 0.2) : 0.35 + t.rng.next() * 0.35));
  t.border(p[0]);
  t.hline(1, 14, 1, p[4]);
  t.vline(1, 1, 14, p[4]);
  if (style === 'metal') {
    t.hline(2, 13, 5, p[1]);
    t.hline(2, 13, 10, p[1]);
  }
  return t;
}
function wool(t: Tile, base: string) {
  const p = ramp(base, 4, 0.22);
  t.pal(p, (x, y) => (((x + (y >> 1)) % 3 === 0 ? 0.15 : 0.55) + t.rng.next() * 0.35));
  return t;
}
function bricksT(t: Tile, mortar: RGB, brick: RGB[], bw = 8, bh = 4) {
  for (let y = 0; y < 16; y++) {
    const row = Math.floor(y / bh);
    for (let x = 0; x < 16; x++) {
      const off = row % 2 ? bw / 2 : 0;
      if (y % bh === bh - 1 || (x + off) % bw === 0) t.set(x, y, mortar);
      else t.set(x, y, brick[Math.floor(t.rng.next() * brick.length)]);
    }
  }
  return t;
}
function cobble(t: Tile, pal = GRAY) {
  t.rect(0, 0, 16, 16, pal[0]);
  const stones = [[1, 1, 5, 4], [7, 0, 5, 3], [12, 1, 4, 5], [0, 6, 4, 4], [5, 5, 6, 5], [12, 7, 4, 4], [1, 11, 6, 4], [8, 11, 4, 5], [13, 12, 3, 4], [6, 4, 2, 1]];
  for (const [x, y, w, h] of stones) {
    const shade = t.rng.int(2, 4);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const edge = xx === 0 || yy === 0;
      t.set((x + xx) & 15, (y + yy) & 15, edge ? pal[Math.min(4, shade + 1)] : pal[shade - (t.rng.next() < 0.3 ? 1 : 0)]);
    }
  }
  return t;
}
function plant(t: Tile, fn: (t: Tile) => void) {
  t.clear();
  fn(t);
  return t;
}
function stem(t: Tile, x: number, y0: number, y1: number, c: RGB, a = 255) {
  for (let y = y0; y <= y1; y++) t.set(x, y, c, a);
}
function crop(t: Tile, stage: number, max: number, ripe: RGB) {
  t.clear();
  const green = hex('#2f8f1e');
  const h = 3 + Math.round((stage / max) * 12);
  const frac = stage / max;
  const col = mix(green, ripe, frac * frac);
  for (const x of [1, 4, 7, 10, 13]) {
    const hh = h - (x % 3);
    stem(t, x, 16 - hh, 15, mix(col, green, 0.3));
    stem(t, x + 1, 17 - hh, 15, col);
    if (stage >= max - 1) for (let y = 16 - hh; y < 16 - hh + 4; y++) t.set(x + (y % 2), y, ripe);
  }
  return t;
}
function rootCrop(t: Tile, stage: number, root: RGB) {
  t.clear();
  const leaf = hex('#3fa025');
  const h = 3 + stage * 3;
  for (const x of [2, 6, 10, 13]) {
    stem(t, x, 16 - h, 15, leaf);
    t.set(x - 1, 16 - h + 1, leaf);
    t.set(x + 1, 16 - h + 2, leaf);
  }
  if (stage === 3) for (const x of [3, 9]) t.rect(x, 13, 3, 3, root);
  return t;
}
function sapling(t: Tile, leaf: RGB, trunk: RGB) {
  return plant(t, (t) => {
    stem(t, 7, 8, 15, trunk);
    stem(t, 8, 9, 15, mul(trunk, 0.8));
    for (let i = 0; i < 40; i++) {
      const a = t.rng.next() * Math.PI * 2, r = t.rng.next() * 5;
      t.set(Math.round(7.5 + Math.cos(a) * r), Math.round(6 + Math.sin(a) * r * 0.9), mul(leaf, 0.75 + t.rng.next() * 0.45));
    }
  });
}
function flowerT(t: Tile, petal: RGB, center: RGB) {
  return plant(t, (t) => {
    const g = hex('#3f8f2a');
    stem(t, 7, 8, 15, g);
    t.set(6, 12, g);
    t.set(5, 11, g);
    t.set(8, 13, g);
    t.set(9, 12, g);
    for (const [x, y] of [[7, 4], [6, 5], [8, 5], [7, 6], [6, 3], [8, 3], [5, 4], [9, 4], [6, 6], [8, 6], [7, 2]]) t.set(x, y, petal);
    t.set(7, 4, center);
  });
}

type Painter = (t: Tile, frame: number) => void;
const painters: Record<string, Painter> = {
  missing: (t) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, (x >> 3) ^ (y >> 3) ? hex('#f800f8') : [0, 0, 0]);
  },
  bedrock: (t) => t.grain([hex('#2b2b2b'), hex('#454545'), hex('#5f5f5f'), hex('#878787'), hex('#9e9e9e')], 0.3, 2),
  stone: (t) => stone(t),
  granite: (t) => t.grain([hex('#7b5244'), hex('#8f5f4e'), hex('#9f6b58'), hex('#b57b66'), hex('#c99b88')], 0.35, 2),
  diorite: (t) => t.grain([hex('#7d7d7f'), hex('#a8a8aa'), hex('#bdbdbd'), hex('#d0d0d0'), hex('#e6e6e6')], 0.4, 2),
  andesite: (t) => t.grain([hex('#5f5f61'), hex('#787878'), hex('#888889'), hex('#959595'), hex('#a5a5a5')], 0.5, 4),
  dirt: (t) => dirt(t),
  grass_block_top: (t) => t.grain(TINT, 0.4, 2, TINT_A),
  grass_block_side: (t) => {
    dirt(t);
    for (let x = 0; x < 16; x++) {
      const h = 3 + ((x * 7) % 3 === 0 ? 1 : 0) + (t.rng.next() < 0.3 ? 1 : 0);
      for (let y = 0; y < h; y++) t.set(x, y, TINT[t.rng.int(1, 4)], TINT_A);
    }
  },
  grass_block_snow: (t) => {
    dirt(t);
    for (let x = 0; x < 16; x++) {
      const h = 3 + ((x * 5) % 3 === 0 ? 1 : 0);
      for (let y = 0; y < h; y++) t.set(x, y, mul(hex('#f4fafa'), 0.93 + t.rng.next() * 0.07));
    }
  },
  podzol_top: (t) => t.grain([hex('#3e2a12'), hex('#5b3f1d'), hex('#6a4a22'), hex('#7a5a2c'), hex('#8c6a38')], 0.45, 2),
  podzol_side: (t) => {
    dirt(t);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 3 + (x % 2); y++) t.set(x, y, [hex('#5b3f1d'), hex('#7a5a2c')][t.rng.int(0, 1)]);
  },
  cobblestone: (t) => cobble(t),
  mossy_cobblestone: (t) => {
    cobble(t);
    const moss = [hex('#4e6a2e'), hex('#5f7c37'), hex('#6e8c3f')];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (t.smooth(x, y, 4) > 0.55) t.set(x, y, moss[t.rng.int(0, 2)]);
  },
  sand: (t) => t.grain([hex('#c2b281'), hex('#d4c592'), hex('#dbcfa3'), hex('#e3d8ad'), hex('#ece3bd')], 0.3, 2),
  gravel: (t) => {
    t.grain([hex('#5a5655'), hex('#6f6b69'), hex('#837f7e'), hex('#999391'), hex('#ab9e98')], 0.2, 2);
    for (let i = 0; i < 9; i++) t.rect(t.rng.int(0, 14), t.rng.int(0, 14), 2, 2, [hex('#a5918b'), hex('#5e5856'), hex('#8b8380')][t.rng.int(0, 2)]);
  },
  coal_ore: (t) => ore(t, ['#2b2b2b', '#151515', '#454545']),
  copper_ore: (t) => ore(t, ['#c56b4b', '#e08b63', '#4f9d82'], 1),
  iron_ore: (t) => ore(t, ['#d8af93', '#f0d4b8', '#a0806a']),
  lapis_ore: (t) => ore(t, ['#1f4ea0', '#4b75d0', '#123673'], 1),
  gold_ore: (t) => ore(t, ['#f2d14a', '#fff58a', '#b58b1c']),
  redstone_ore: (t) => ore(t, ['#b0120a', '#ff2a1a', '#6e0703'], 1),
  diamond_ore: (t) => ore(t, ['#5decf5', '#d8fffd', '#1aa7a0']),
  emerald_ore: (t) => ore(t, ['#17dd62', '#9dffb8', '#0b7c34'], 1),
  coal_block: (t) => mineral(t, '#2a2a2a', 'grain'),
  copper_block: (t) => mineral(t, '#c06c50', 'metal'),
  iron_block: (t) => mineral(t, '#dcdcdc', 'metal'),
  lapis_block: (t) => mineral(t, '#2856b8', 'grain'),
  gold_block: (t) => mineral(t, '#f6d03d', 'metal'),
  redstone_block: (t) => mineral(t, '#b8200e', 'grain'),
  diamond_block: (t) => mineral(t, '#62ede4', 'gem'),
  emerald_block: (t) => mineral(t, '#2acb57', 'gem'),
  glass: (t) => {
    t.clear();
    const f = hex('#dcf0f6');
    t.border(f);
    for (const [x, y] of [[3, 2], [2, 3], [4, 3], [3, 4], [12, 11], [11, 12], [13, 12], [12, 13]]) t.set(x, y, hex('#ffffff'), 230);
  },
  sandstone: (t) => {
    t.grain([hex('#c9bb85'), hex('#d8cb9b'), hex('#e0d4a6'), hex('#e8ddb4')], 0.4, 4);
    t.hline(0, 15, 0, hex('#e8ddb4'));
    t.hline(0, 15, 3, hex('#bfae78'));
    for (let y = 12; y < 16; y++) t.hline(0, 15, y, [hex('#d2c48f'), hex('#c9bb85'), hex('#bfae78'), hex('#b5a46f')][y - 12]);
  },
  sandstone_top: (t) => t.grain([hex('#d2c48f'), hex('#d8cb9b'), hex('#e0d4a6'), hex('#e6dcb0')], 0.5, 4),
  sandstone_bottom: (t) => t.grain([hex('#c9bb85'), hex('#d8cb9b'), hex('#e0d4a6')], 0.3, 2),
  bricks: (t) => bricksT(t, hex('#b3aa9c'), [hex('#8a4a38'), hex('#966253'), hex('#a6634d'), hex('#7d4334')]),
  tnt_side: (t) => {
    t.pal([hex('#a8231a'), hex('#c12a1f'), hex('#db441a')], (x) => [0.1, 0.6, 0.9, 0.6][x % 4] + t.rng.next() * 0.05);
    t.rect(0, 5, 16, 6, hex('#e8e8e8'));
    t.hline(0, 15, 5, hex('#c8c8c8'));
    t.hline(0, 15, 10, hex('#c8c8c8'));
    const k = hex('#1a1a1a');
    t.draw(['TTT.N..N.TTT', '.T..NN.N..T.', '.T..N.NN..T.', '.T..N..N..T.'], { T: k, N: k }, 2, 6);
  },
  tnt_top: (t) => {
    t.pal([hex('#a8231a'), hex('#c12a1f'), hex('#db441a')], (x, y) => ((x + y) % 4) / 4 + 0.1);
    t.rect(6, 6, 4, 4, hex('#e8e8e8'));
    t.rect(7, 7, 2, 2, hex('#3a3a3a'));
  },
  tnt_bottom: (t) => t.pal([hex('#a8231a'), hex('#c12a1f'), hex('#db441a')], (x, y) => ((x + y) % 4) / 4 + 0.1),
  bookshelf: (t) => {
    planks(t, '#b8945f');
    const books = [hex('#9c2f2a'), hex('#2f4d9c'), hex('#2f8c3a'), hex('#c8a03a'), hex('#6a2f8c'), hex('#2f8c8c'), hex('#8c5a2f')];
    for (const row of [1, 9]) {
      t.rect(0, row, 16, 6, hex('#3a2a18'));
      for (let x = 1; x < 15; x++) {
        if (t.rng.next() < 0.15) continue;
        const c = books[t.rng.int(0, books.length - 1)];
        const top = row + t.rng.int(0, 1);
        for (let y = top; y < row + 6; y++) t.set(x, y, mul(c, y === top ? 1.2 : 1));
      }
    }
  },
  obsidian: (t) => {
    t.grain([hex('#0a0811'), hex('#14121d'), hex('#1e1a2c'), hex('#2b2140'), hex('#3b2d5a')], 0.5, 2);
    for (let i = 0; i < 4; i++) t.set(t.rng.int(0, 15), t.rng.int(0, 15), hex('#6a4ea0'));
  },
  torch: (t) => {
    t.clear();
    const w = [hex('#6b4f2c'), hex('#8a6a3c')];
    for (let y = 8; y < 16; y++) {
      t.set(7, y, w[0]);
      t.set(8, y, w[1]);
    }
    t.set(7, 6, hex('#ffd85a'));
    t.set(8, 6, hex('#ffe9a0'));
    t.set(7, 7, hex('#ff9a2a'));
    t.set(8, 7, hex('#ffd85a'));
  },
  chest_top: (t) => {
    planks(t, '#a07436');
    t.border(hex('#3a2610'));
  },
  chest_side: (t) => {
    planks(t, '#a07436');
    t.border(hex('#3a2610'));
    t.hline(0, 15, 5, hex('#3a2610'));
  },
  chest_front: (t) => {
    planks(t, '#a07436');
    t.border(hex('#3a2610'));
    t.hline(0, 15, 5, hex('#3a2610'));
    t.rect(7, 4, 2, 4, hex('#c8c8c8'));
    t.set(7, 6, hex('#3a3a3a'));
    t.set(8, 6, hex('#3a3a3a'));
  },
  crafting_table_top: (t) => {
    planks(t, '#b8945f');
    const d = hex('#5a3c1e');
    t.border(d);
    t.hline(1, 14, 5, d);
    t.hline(1, 14, 10, d);
    t.vline(5, 1, 14, d);
    t.vline(10, 1, 14, d);
  },
  crafting_table_side: (t) => {
    planks(t, '#b8945f');
    t.rect(0, 0, 16, 3, hex('#6b4f2c'));
    t.rect(3, 6, 1, 7, hex('#6b4f2c'));
    t.rect(2, 5, 3, 2, hex('#a8a8a8'));
    t.rect(11, 5, 1, 8, hex('#6b4f2c'));
    t.rect(9, 5, 5, 2, hex('#8a8a8a'));
  },
  crafting_table_front: (t) => {
    planks(t, '#b8945f');
    t.rect(0, 0, 16, 3, hex('#6b4f2c'));
    t.rect(3, 5, 10, 1, hex('#5a3c1e'));
    t.rect(4, 6, 1, 7, hex('#a8a8a8'));
    t.rect(7, 6, 2, 6, hex('#8a6a3c'));
    t.rect(11, 6, 1, 7, hex('#a8a8a8'));
  },
  furnace_top: (t) => stone(t, ramp('#7a7a7a', 5, 0.3)),
  furnace_side: (t) => {
    cobble(t, ramp('#6e6e6e', 5, 0.35));
    t.border(hex('#4a4a4a'));
  },
  furnace_front: (t) => {
    cobble(t, ramp('#6e6e6e', 5, 0.35));
    t.border(hex('#4a4a4a'));
    t.rect(3, 8, 10, 6, hex('#1a1a1a'));
    t.rect(4, 3, 8, 2, hex('#3a3a3a'));
  },
  furnace_front_on: (t) => {
    cobble(t, ramp('#6e6e6e', 5, 0.35));
    t.border(hex('#4a4a4a'));
    t.rect(3, 8, 10, 6, hex('#2a1a0a'));
    for (let x = 4; x < 12; x++) for (let y = 10; y < 14; y++) t.set(x, y, [hex('#ff6a00'), hex('#ffb000'), hex('#ffe060')][t.rng.int(0, 2)]);
    t.rect(4, 3, 8, 2, hex('#3a3a3a'));
  },
  farmland: (t) => {
    t.grain([hex('#4d3421'), hex('#5f412a'), hex('#704d32'), hex('#7d5a3a')], 0.3, 2);
    for (let y = 0; y < 16; y += 4) t.hline(0, 15, y, hex('#3e2a1a'));
  },
  farmland_moist: (t) => {
    t.grain([hex('#2a1a0e'), hex('#3a2616'), hex('#46301c'), hex('#523822')], 0.3, 2);
    for (let y = 0; y < 16; y += 4) t.hline(0, 15, y, hex('#1e130a'));
  },
  oak_door_top: (t) => {
    planks(t, '#9c7a4a');
    t.border(hex('#5a4020'));
    t.rect(3, 2, 4, 5, hex('#c8e0e8'));
    t.rect(9, 2, 4, 5, hex('#c8e0e8'));
    t.rect(3, 9, 10, 1, hex('#5a4020'));
  },
  oak_door_bottom: (t) => {
    planks(t, '#9c7a4a');
    t.border(hex('#5a4020'));
    t.rect(3, 2, 10, 1, hex('#5a4020'));
    t.rect(3, 8, 10, 1, hex('#5a4020'));
    t.rect(12, 5, 2, 2, hex('#2a2a2a'));
  },
  ladder: (t) => {
    t.clear();
    const w = [hex('#6b4f2c'), hex('#8f6d3c')];
    for (let y = 0; y < 16; y++) {
      t.set(2, y, w[0]); t.set(3, y, w[1]);
      t.set(12, y, w[0]); t.set(13, y, w[1]);
    }
    for (const y of [1, 5, 9, 13]) {
      t.hline(4, 11, y, w[1]);
      t.hline(4, 11, y + 1, w[0]);
    }
  },
  snow: (t) => t.grain([hex('#e2ecec'), hex('#eef6f6'), hex('#f8fdfd'), hex('#ffffff')], 0.3, 4),
  ice: (t) => {
    t.grain([hex('#7da6f2'), hex('#91b7fd'), hex('#a4c4fd'), hex('#b8d2ff')], 0.6, 4, 210);
    for (let i = 0; i < 3; i++) {
      let x = t.rng.int(0, 15), y = t.rng.int(0, 15);
      for (let s = 0; s < 6; s++) {
        t.set(x & 15, y & 15, hex('#e8f2ff'), 230);
        x += t.rng.int(0, 1);
        y += t.rng.int(-1, 1);
      }
    }
  },
  packed_ice: (t) => t.grain([hex('#7aa2ee'), hex('#8db4fa'), hex('#9fc2fb'), hex('#b4d0fd')], 0.6, 4),
  cactus_side: (t) => {
    t.pal([hex('#2f5e1a'), hex('#3f7a22'), hex('#4f8c2a'), hex('#5c9a32')], (x) => [0.1, 0.5, 0.8, 0.5, 0.3][x % 5] + t.rng.next() * 0.1);
    t.vline(0, 0, 15, hex('#1f3e10'));
    t.vline(15, 0, 15, hex('#1f3e10'));
    for (let i = 0; i < 8; i++) t.set(t.rng.int(1, 14), t.rng.int(0, 15), hex('#d8d0a0'));
  },
  cactus_top: (t) => {
    t.pal([hex('#3f7a22'), hex('#4f8c2a'), hex('#6aa83a')], (x, y) => (Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) % 3) / 3);
    t.border(hex('#1f3e10'));
  },
  cactus_bottom: (t) => t.pal([hex('#9c8a5a'), hex('#b0a070')], () => t.rng.next()),
  clay: (t) => t.grain([hex('#8f95a2'), hex('#9aa0ad'), hex('#a0a6b4'), hex('#aab0bd')], 0.5, 4),
  sugar_cane: (t) => {
    t.clear();
    for (const x of [3, 8, 12]) {
      for (let y = 0; y < 16; y++) {
        const node = (y + x) % 5 === 0;
        t.set(x, y, node ? TINT[1] : TINT[3], TINT_A);
        t.set(x + 1, y, node ? TINT[0] : TINT[2], TINT_A);
      }
      t.set(x - 1, (x * 3) % 16, TINT[3], TINT_A);
    }
  },
  pumpkin_side: (t) => {
    t.pal([hex('#a85a0a'), hex('#c87414'), hex('#e38a1d'), hex('#ef9f2e')], (x) => [0.05, 0.4, 0.7, 0.9, 0.7, 0.4][x % 6] + t.rng.next() * 0.05);
  },
  pumpkin_top: (t) => {
    t.pal([hex('#c87414'), hex('#e38a1d'), hex('#ef9f2e')], (x, y) => (Math.hypot(x - 7.5, y - 7.5) % 4) / 4);
    t.rect(7, 6, 2, 3, hex('#4a6a1a'));
  },
  melon_side: (t) => t.pal([hex('#4a7012'), hex('#6f9a24'), hex('#8db83a'), hex('#a8c84f')], (x, y) => ((x + (y % 3 === 0 ? 1 : 0)) % 4) / 4 + t.rng.next() * 0.1),
  melon_top: (t) => t.pal([hex('#6f9a24'), hex('#8db83a'), hex('#a8c84f')], (x, y) => (Math.hypot(x - 7.5, y - 7.5) % 3) / 3),
  stone_bricks: (t) => bricksT(t, hex('#5a5a5a'), ramp('#7a7a7a', 4, 0.2), 8, 8),
  mossy_stone_bricks: (t) => {
    bricksT(t, hex('#5a5a5a'), ramp('#7a7a7a', 4, 0.2), 8, 8);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (t.smooth(x, y, 4) > 0.6) t.set(x, y, [hex('#5f7c37'), hex('#4e6a2e')][t.rng.int(0, 1)]);
  },
  cracked_stone_bricks: (t) => {
    bricksT(t, hex('#555555'), ramp('#767676', 4, 0.2), 8, 8);
    let x = 4, y = 0;
    for (let i = 0; i < 18; i++) {
      t.set(x & 15, y & 15, hex('#3a3a3a'));
      y++;
      x += t.rng.int(-1, 1);
    }
  },
  bed_foot: (t) => {
    t.pal([hex('#7e1c19'), hex('#a12722'), hex('#b8302a')], () => t.rng.next());
    t.hline(0, 15, 0, hex('#6a1612'));
  },
  bed_head: (t) => {
    t.pal([hex('#7e1c19'), hex('#a12722'), hex('#b8302a')], () => t.rng.next());
    t.rect(2, 1, 12, 6, hex('#e8e8e8'));
    t.hline(2, 13, 6, hex('#c8c8c8'));
  },
  bed_side: (t) => {
    planks(t, '#9c7a4a');
    t.rect(0, 3, 16, 6, hex('#a12722'));
    t.hline(0, 15, 3, hex('#b8302a'));
  },
  short_grass: (t) =>
    plant(t, (t) => {
      for (let i = 0; i < 11; i++) {
        const x = t.rng.int(1, 14), h = t.rng.int(5, 13);
        for (let y = 16 - h; y < 16; y++) t.set(x + (y < 9 && i % 3 === 0 ? 1 : 0), y, TINT[t.rng.int(1, 4)], TINT_A);
      }
    }),
  fern: (t) =>
    plant(t, (t) => {
      for (const [cx, dir] of [[7, -1], [8, 1], [5, -1], [10, 1]]) {
        for (let i = 0; i < 9; i++) {
          const x = cx + Math.round((dir * i) / 3), y = 15 - i;
          t.set(x, y, TINT[2], TINT_A);
          if (i % 2) t.set(x + dir, y, TINT[3], TINT_A);
        }
      }
    }),
  dandelion: (t) => flowerT(t, hex('#ffec4f'), hex('#f2b500')),
  poppy: (t) => flowerT(t, hex('#e01c1c'), hex('#1a1a1a')),
  cornflower: (t) => flowerT(t, hex('#466aeb'), hex('#2a3a9a')),
  oxeye_daisy: (t) => flowerT(t, hex('#f2f2f2'), hex('#f2c500')),
  dead_bush: (t) =>
    plant(t, (t) => {
      const c = hex('#8a6a3c');
      stem(t, 8, 7, 15, c);
      for (let i = 0; i < 6; i++) {
        let x = 8, y = t.rng.int(7, 12);
        const dx = i % 2 ? 1 : -1;
        for (let s = 0; s < 4; s++) {
          x += dx;
          y -= t.rng.int(0, 1);
          t.set(x, y, c);
        }
      }
    }),
  brown_mushroom: (t) =>
    plant(t, (t) => {
      t.rect(7, 10, 2, 6, hex('#d8cfb8'));
      t.rect(4, 7, 8, 3, hex('#9a7558'));
      t.rect(5, 6, 6, 1, hex('#b08a6a'));
    }),
  red_mushroom: (t) =>
    plant(t, (t) => {
      t.rect(7, 10, 2, 6, hex('#d8cfb8'));
      t.rect(4, 6, 8, 4, hex('#d63b2e'));
      t.rect(5, 5, 6, 1, hex('#e04a3c'));
      t.set(6, 7, hex('#ffffff'));
      t.set(9, 6, hex('#ffffff'));
      t.set(10, 8, hex('#ffffff'));
    }),
  water: (t, f) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const w = Math.sin((x + f * 4) * 0.8) + Math.sin((y * 1.3 + x * 0.4 - f * 3) * 0.7);
        t.set(x, y, hex('#3f76e4'), 180, 0.82 + w * 0.08 + t.rng.next() * 0.05);
      }
  },
  lava: (t, f) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const w = Math.sin((x + f * 2) * 0.6 + Math.sin(y * 0.5 + f)) + Math.cos((y - f * 2) * 0.7);
        t.set(x, y, w > 0.6 ? hex('#ffd24a') : w > -0.4 ? hex('#ff7a1a') : hex('#c83c0a'));
      }
  },
  spawner: (t) => {
    t.clear();
    const c = hex('#1d2b39'), c2 = hex('#2f4458');
    t.border(c);
    for (let i = 0; i < 16; i += 5) {
      t.vline(i, 0, 15, c2);
      t.hline(0, 15, i, c2);
    }
  },
  hay_block_side: (t) => {
    t.pal([hex('#9a7a10'), hex('#b8951a'), hex('#c4a51a'), hex('#d8b82a')], (x) => (x % 3) / 3 + t.rng.next() * 0.3);
    t.hline(0, 15, 3, hex('#7a2a1a'));
    t.hline(0, 15, 12, hex('#7a2a1a'));
  },
  hay_block_top: (t) => t.pal([hex('#9a7a10'), hex('#b8951a'), hex('#c4a51a'), hex('#d8b82a')], () => t.rng.next()),
  lantern: (t) => {
    t.clear();
    const m = hex('#3a3c44'), g = hex('#ffd070');
    t.rect(5, 5, 6, 9, m);
    t.rect(6, 7, 4, 6, g);
    t.set(7, 9, hex('#fff0b0'));
    t.rect(6, 3, 4, 2, m);
    t.rect(7, 1, 2, 2, hex('#5a5c64'));
  },
  mud: (t) => t.grain([hex('#2c2827'), hex('#3c3837'), hex('#464140'), hex('#524c4a')], 0.5, 4),
  moss_block: (t) => t.grain([hex('#46592a'), hex('#596d2d'), hex('#647a33'), hex('#70883a')], 0.5, 2),
  glow_lichen: (t) =>
    plant(t, (t) => {
      for (let i = 0; i < 24; i++) t.set(t.rng.int(1, 14), t.rng.int(6, 15), [hex('#7f9c8a'), hex('#a8d8b8'), hex('#d8ffe8')][t.rng.int(0, 2)]);
    }),
  amethyst_block: (t) => t.grain([hex('#5a3d8c'), hex('#7652a8'), hex('#8662bf'), hex('#a07fd8'), hex('#c8a8f0')], 0.3, 2),
  amethyst_cluster: (t) =>
    plant(t, (t) => {
      for (const [x, h] of [[4, 8], [7, 12], [10, 9], [12, 6]]) {
        for (let y = 16 - h; y < 16; y++) {
          t.set(x, y, hex('#a87fe0'));
          t.set(x + 1, y, hex('#c8a8f0'));
        }
        t.set(x, 15 - h, hex('#e8d8ff'));
      }
    }),
  dirt_path_top: (t) => t.grain([hex('#7a6334'), hex('#8a713a'), hex('#94793e'), hex('#a48a4c')], 0.4, 2),
  dirt_path_side: (t) => {
    dirt(t);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) t.set(x, y, [hex('#8a713a'), hex('#94793e')][t.rng.int(0, 1)]);
  },
  altar_top: (t) => {
    bricksT(t, hex('#3a3a40'), ramp('#75767c', 3, 0.2));
    t.rect(5, 5, 6, 6, hex('#7a40c0'));
    t.rect(7, 7, 2, 2, hex('#e0b0ff'));
  },
  altar_side: (t) => {
    bricksT(t, hex('#3a3a40'), ramp('#75767c', 3, 0.2));
    t.hline(2, 13, 7, hex('#a060e0'));
  },
};

// variantes générées
const WOOD_LOOK: Record<string, { planks: string; bark: string; inner: string; leafHoles: number; sapling: [string, string]; barkStyle?: 'birch' }> = {
  oak: { planks: '#b8945f', bark: '#6b5130', inner: '#b8945f', leafHoles: 0.22, sapling: ['#48a32b', '#6b5130'] },
  spruce: { planks: '#7a5a34', bark: '#3b2912', inner: '#8a6a40', leafHoles: 0.2, sapling: ['#2d5a34', '#3b2912'] },
  birch: { planks: '#d7c185', bark: '#d8d7d2', inner: '#d0b880', leafHoles: 0.22, sapling: ['#6a9a3e', '#d8d7d2'], barkStyle: 'birch' },
  jungle: { planks: '#b4835c', bark: '#554419', inner: '#a8844a', leafHoles: 0.15, sapling: ['#30b020', '#554419'] },
  acacia: { planks: '#ad5d32', bark: '#676157', inner: '#c8603a', leafHoles: 0.28, sapling: ['#7a9a2a', '#676157'] },
  dark_oak: { planks: '#4a2f17', bark: '#3e2d17', inner: '#5a3c22', leafHoles: 0.18, sapling: ['#2f6a1e', '#3e2d17'] },
};
for (const [w, look] of Object.entries(WOOD_LOOK)) {
  painters[`${w}_planks`] = (t) => planks(t, look.planks);
  painters[`${w}_log`] =
    look.barkStyle === 'birch'
      ? (t) => {
          t.grain([hex('#c8c7c0'), hex('#d8d7d2'), hex('#e8e8e4')], 0.3, 4);
          for (let i = 0; i < 10; i++) t.rect(t.rng.int(0, 13), t.rng.int(0, 15), t.rng.int(2, 4), 1, hex('#2a2a26'));
        }
      : (t) => logSide(t, look.bark);
  painters[`${w}_log_top`] = (t) => logTop(t, look.inner, look.bark);
  painters[`${w}_leaves`] = (t) => leaves(t, look.leafHoles);
  painters[`${w}_sapling`] = (t) => sapling(t, hex(look.sapling[0]), hex(look.sapling[1]));
}
for (const [c, , h] of WOOL_COLORS) painters[`${c}_wool`] = (t) => wool(t, h);
for (let s = 0; s < 8; s++) painters[`wheat_stage${s}`] = (t) => crop(t, s, 7, hex('#d8c050'));
for (let s = 0; s < 4; s++) painters[`carrots_stage${s}`] = (t) => rootCrop(t, s, hex('#f08a24'));
for (let s = 0; s < 4; s++) painters[`potatoes_stage${s}`] = (t) => rootCrop(t, s, hex('#c8a050'));
for (let s = 0; s < 10; s++)
  painters[`destroy_stage_${s}`] = (t) => {
    t.clear();
    const r = new Rng(777);
    const cracks = 2 + s * 2;
    for (let c = 0; c < cracks; c++) {
      let x = 8 + r.int(-2, 2), y = 8 + r.int(-2, 2);
      for (let i = 0; i < 3 + s; i++) {
        t.set(x & 15, y & 15, [20, 20, 20], 200);
        x += r.int(-1, 1);
        y += r.int(-1, 1);
      }
    }
  };

/** Construit l'atlas complet (canvas). Les tuiles fournies par un pack remplacent les tuiles générées. */
export function buildAtlas(overrides?: Map<string, ImageData>): HTMLCanvasElement {
  const rows = Math.ceil(TileRegistry.count / ATLAS_COLS);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = Math.max(ATLAS_COLS, rows) * TILE_PX;
  const ctx = canvas.getContext('2d')!;
  const tiles = drawTiles();
  tiles.forEach((tile, i) => {
    const name = TileRegistry.names[i];
    const img = overrides?.get(name) ?? new ImageData(tile.data, TILE_PX, TILE_PX);
    ctx.putImageData(img, (i % ATLAS_COLS) * TILE_PX, Math.floor(i / ATLAS_COLS) * TILE_PX);
  });
  return canvas;
}

/** Dessine toutes les tuiles (pur calcul, testable sans DOM). */
export function drawTiles(): Tile[] {
  return TileRegistry.names.map((full, i) => {
    const [name, frameStr] = full.split('#');
    const frame = frameStr ? Number(frameStr) : 0;
    const t = new Tile(1000 + i * 7919);
    const p = painters[name];
    if (!p) painters.missing(t, 0);
    else p(t, frame);
    return t;
  });
}

export function hasPainter(name: string) {
  return !!painters[name];
}

/** Ajoute (ou remplace) le dessin d'une tuile (blocs supplémentaires). */
export function registerPainter(name: string, fn: Painter) {
  painters[name] = fn;
}
/** Outils de dessin réutilisables par les définitions de blocs supplémentaires. */
export const paint = { stone, planks, logSide, logTop, leaves, ore, mineral, wool, bricksT, cobble, flowerT, sapling, ramp, mix, mul };
