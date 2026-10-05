/**
 * Police bitmap pixel originale (glyphes 5x7 + jambages), rendue dans un canvas.
 * Sert aux libellés de l'interface « façon jeu de blocs » : titres des conteneurs,
 * nombres des stacks, boutons, info-bulles. Les lettres accentuées françaises sont
 * composées (lettre de base + accent dessiné au-dessus).
 */

/** Hauteur d'une ligne de texte en pixels de police (accents majuscules + corps + jambages). */
export const LINE_H = 11;
/** Décalage vertical du corps des glyphes (place pour les accents des majuscules). */
const TOP = 2;

const G: Record<string, string> = {
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/####./#...#/#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../###../#..../#..../#..../#####',
  F: '#####/#..../###../#..../#..../#..../#....',
  G: '.####/#..../#..##/#...#/#...#/#...#/.###.',
  H: '#...#/#...#/#####/#...#/#...#/#...#/#...#',
  I: '###/.#./.#./.#./.#./.#./###',
  J: '....#/....#/....#/....#/....#/#...#/.###.',
  K: '#...#/#..#./###../#..#./#...#/#...#/#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#...#/#...#/#...#/#...#',
  N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/####./#..../#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#...#/#..#./.##.#',
  R: '####./#...#/####./#...#/#...#/#...#/#...#',
  S: '.####/#..../.###./....#/....#/#...#/.###.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#...#/#.#.#/##.##/#...#',
  X: '#...#/.#.#./..#../.#.#./#...#/#...#/#...#',
  Y: '#...#/.#.#./..#../..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  a: '...../...../.###./....#/.####/#...#/.####',
  b: '#..../#..../#.##./##..#/#...#/#...#/####.',
  c: '...../...../.###./#...#/#..../#...#/.###.',
  d: '....#/....#/.##.#/#..##/#...#/#...#/.####',
  e: '...../...../.###./#...#/#####/#..../.####',
  f: '..##/.#../####/.#../.#../.#../.#..',
  g: '...../...../.####/#...#/#...#/.####/....#/####.',
  h: '#..../#..../#.##./##..#/#...#/#...#/#...#',
  i: '#/./#/#/#/#/#',
  j: '....#/...../....#/....#/....#/....#/#...#/.###.',
  k: '#.../#.../#..#/#.#./##../#.#./#..#',
  l: '#./#./#./#./#./#./.#',
  m: '...../...../##.#./#.#.#/#.#.#/#...#/#...#',
  n: '...../...../####./#...#/#...#/#...#/#...#',
  o: '...../...../.###./#...#/#...#/#...#/.###.',
  p: '...../...../#.##./##..#/#...#/####./#..../#....',
  q: '...../...../.##.#/#..##/#...#/.####/....#/....#',
  r: '...../...../#.##./##..#/#..../#..../#....',
  s: '...../...../.####/#..../.###./....#/####.',
  t: '.#../.#../####/.#../.#../.#../..##',
  u: '...../...../#...#/#...#/#...#/#...#/.####',
  v: '...../...../#...#/#...#/#...#/.#.#./..#..',
  w: '...../...../#...#/#...#/#.#.#/#.#.#/.#.#.',
  x: '...../...../#...#/.#.#./..#../.#.#./#...#',
  y: '...../...../#...#/#...#/#...#/.####/....#/####.',
  z: '...../...../#####/...#./..#../.#.../#####',
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  '1': '..#../.##../..#../..#../..#../..#../#####',
  '2': '.###./#...#/....#/..##./.#.../#...#/#####',
  '3': '.###./#...#/....#/..##./....#/#...#/.###.',
  '4': '...##/..#.#/.#..#/#...#/#####/....#/....#',
  '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '..##./.#.../#..../####./#...#/#...#/.###.',
  '7': '#####/#...#/....#/...#./..#../..#../..#..',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
  '9': '.###./#...#/#...#/.####/....#/...#./.##..',
  ' ': '..../..../..../..../..../..../....',
  '.': '././././././#',
  ',': './././././#/#/#',
  ':': './#/#/./#/#/.',
  ';': './#/#/./#/#/#',
  '!': '#/#/#/#/#/./#',
  '?': '.###./#...#/....#/...#./..#../...../..#..',
  "'": '#/#/./././././',
  '’': '#/#/./././././',
  '"': '#.#/#.#/.../.../.../.../...',
  '-': '...../...../...../#####/...../...../.....',
  '+': '...../..#../..#../#####/..#../..#../.....',
  '=': '...../...../#####/...../#####/...../.....',
  '/': '....#/...#./...#./..#../.#.../.#.../#....',
  '(': '..#/.#./#../#../#../.#./..#',
  ')': '#../.#./..#/..#/..#/.#./#..',
  '[': '###/#../#../#../#../#../###',
  ']': '###/..#/..#/..#/..#/..#/###',
  '%': '#...#/#..#./...#./..#../.#.../.#..#/#...#',
  '«': '...../..#.#/.#.#./#.#../.#.#./..#.#/.....',
  '»': '...../#.#../.#.#./..#.#/.#.#./#.#../.....',
  '×': '...../#...#/.#.#./..#../.#.#./#...#/.....',
  '#': '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.',
  '<': '...#/..#./.#../#.../.#../..#./...#',
  '>': '#.../.#../..#./...#/..#./.#../#...',
  _: '...../...../...../...../...../...../#####',
  '*': '...../#.#.#/.###./#####/.###./#.#.#/.....',
  '…': '...../...../...../...../...../...../#.#.#',
  '•': '..../..../.##./.##./..../..../....',
  '&': '.##../#..#./.##../.#..#/#.##./#..#./.##.#',
  '@': '.###./#...#/#.###/#.#.#/#.###/#..../.####',
  $: '..#../.####/#.#../.###./..#.#/####./..#..',
  '|': '#/#/#/#/#/#/#',
  '~': '...../...../.#..#/#.##./...../...../.....',
  '^': '..#../.#.#./#...#/...../...../...../.....',
  '`': '#./.#/../../../../..',
  '{': '..#/.#./.#./#../.#./.#./..#',
  '}': '#../.#./.#./..#/.#./.#./#..',
  '\\': '#..../.#.../.#.../..#../...#./...#./....#',
  '°': '.#./#.#/.#./.../.../.../...',
  '❤': '.#.#./#####/#####/.###./..#../...../.....',
};

/** Accents (dessinés au-dessus de la lettre de base). */
const ACCENTS: Record<string, [string, string]> = {
  é: ['e', 'acute'], è: ['e', 'grave'], ê: ['e', 'circ'], ë: ['e', 'trema'],
  à: ['a', 'grave'], â: ['a', 'circ'], ä: ['a', 'trema'],
  î: ['i', 'circ'], ï: ['i', 'trema'], ô: ['o', 'circ'], ö: ['o', 'trema'],
  ù: ['u', 'grave'], û: ['u', 'circ'], ü: ['u', 'trema'],
  É: ['E', 'acute'], È: ['E', 'grave'], Ê: ['E', 'circ'], À: ['A', 'grave'], Â: ['A', 'circ'], Î: ['I', 'circ'], Ô: ['O', 'circ'], Û: ['U', 'circ'],
};
const ACCENT_PIX: Record<string, [number, number][]> = {
  acute: [[3, 0], [2, 1]],
  grave: [[1, 0], [2, 1]],
  circ: [[2, 0], [1, 1], [3, 1]],
  trema: [[1, 1], [3, 1]],
};

interface Glyph {
  w: number;
  /** Pixels allumés (x, y) dans la cellule (y = 0 en haut, corps à partir de TOP). */
  px: [number, number][];
}

const cache = new Map<string, Glyph>();

function parse(src: string): Glyph {
  const rows = src.split('/');
  const w = Math.max(...rows.map((r) => r.length));
  const px: [number, number][] = [];
  rows.forEach((r, y) => [...r].forEach((c, x) => c === '#' && px.push([x, y + TOP])));
  return { w, px };
}

function glyph(ch: string): Glyph {
  let g = cache.get(ch);
  if (g) return g;
  if (G[ch]) g = parse(G[ch]);
  else if (ACCENTS[ch]) {
    const [base, kind] = ACCENTS[ch];
    const b = glyph(base);
    const upper = base === base.toUpperCase();
    // minuscules : on retire le point du i et on place l'accent juste au-dessus du corps
    const px = b.px.filter(([, y]) => !(base === 'i' && y === TOP + 0));
    const dy = upper ? 0 : TOP;
    const off = Math.floor((b.w - 5) / 2);
    for (const [x, y] of ACCENT_PIX[kind]) px.push([Math.max(0, Math.min(b.w - 1, x + off)), y + dy]);
    g = { w: b.w, px };
  } else if (ch === 'ç' || ch === 'Ç') {
    const b = glyph(ch === 'ç' ? 'c' : 'C');
    g = { w: b.w, px: [...b.px, [2, TOP + 7], [1, TOP + 8]] };
  } else if (ch === 'œ') g = parse('...../...../.#.#./#.#.#/#.###/#.#../.#.##');
  else if (ch === 'Œ') g = parse('.####/#.#../#.#../#.##./#.#../#.#../.####');
  else {
    const n = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    g = n !== ch && n.length === 1 ? glyph(n) : parse(G['?']);
  }
  cache.set(ch, g);
  return g;
}

/** Pixels d'un glyphe (pour la génération de la police TrueType). */
export function glyphPixels(ch: string): { w: number; px: [number, number][] } {
  return glyph(ch);
}

/** Caractères couverts par la police (ASCII imprimable + lettres françaises + symboles). */
export function fontCharset(): string[] {
  const set = new Set<string>([...Object.keys(G), ...Object.keys(ACCENTS), 'ç', 'Ç', 'œ', 'Œ']);
  for (let c = 32; c < 127; c++) set.add(String.fromCharCode(c));
  for (const ch of 'ÀÁÄÇÈÉÊËÌÍÎÏÒÓÔÖÙÚÛÜàáäèéêëìíòóùú') set.add(ch);
  return [...set].filter((c) => c.length === 1);
}

/** Largeur d'un texte en pixels de police (1 pixel d'espacement entre les lettres). */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += glyph(ch).w + 1;
  return Math.max(0, w - 1);
}

/**
 * Dessine un texte dans un contexte 2D à l'échelle `scale` (pixels écran par pixel de police).
 * `shadow` : ombre portée décalée d'un pixel, comme dans les interfaces du jeu.
 */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale = 1, shadow: string | null = null) {
  const pass = (ox: number, oy: number, c: string) => {
    ctx.fillStyle = c;
    let cx = x;
    for (const ch of text) {
      const g = glyph(ch);
      for (const [px, py] of g.px) ctx.fillRect(Math.round(cx + (px + ox) * scale), Math.round(y + (py + oy) * scale), Math.ceil(scale), Math.ceil(scale));
      cx += (g.w + 1) * scale;
    }
  };
  if (shadow) pass(1, 1, shadow);
  pass(0, 0, color);
}

const urlCache = new Map<string, string>();

/** Rendu d'un texte en image (data URL), pour l'utiliser dans le DOM. */
export function textImage(text: string, color = '#404040', shadow: string | null = null, scale = 1): { url: string; w: number; h: number } {
  const w = (textWidth(text) + (shadow ? 1 : 0)) * scale, h = LINE_H * scale;
  const key = `${text}|${color}|${shadow}|${scale}`;
  let url = urlCache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = h;
    drawText(c.getContext('2d')!, text, 0, 0, color, scale, shadow);
    url = c.toDataURL();
    if (urlCache.size > 400) urlCache.clear();
    urlCache.set(key, url);
  }
  return { url, w, h };
}

/** Élément <img> de texte en police pixel, dimensionné en pixels de police × `px`. */
export function pixelText(text: string, opts: { color?: string; shadow?: string | null; px?: number; cls?: string } = {}): HTMLImageElement {
  const { url, w, h } = textImage(text, opts.color ?? '#404040', opts.shadow ?? null, 1);
  const img = document.createElement('img');
  img.src = url;
  img.alt = text;
  img.draggable = false;
  img.className = `ptext ${opts.cls ?? ''}`.trim();
  const k = opts.px ?? 1;
  img.style.width = `${w * k}px`;
  img.style.height = `${h * k}px`;
  return img;
}
