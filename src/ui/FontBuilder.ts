/**
 * Génère en mémoire une police TrueType à partir des glyphes bitmap de PixelFont, puis l'installe
 * via l'API FontFace : tout le texte DOM (menus, HUD, options) s'affiche en police pixel,
 * sans aucun fichier de police externe.
 *
 * Unités : 1 pixel de glyphe = 128 unités, 1 em = 1024 unités (8 pixels de glyphe).
 * À 16 px CSS, un pixel de glyphe vaut donc exactement 2 pixels écran.
 */
import { LINE_H, fontCharset, glyphPixels } from './PixelFont';

export const FONT_FAMILY = 'LeCraftPixel';
const UPM = 1024;
const PX = 128;
/** Ligne de base : sous la 9e rangée de la cellule (2 rangées d'accents + 7 de corps). */
const BASE_ROW = 9;

class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 255);
  }
  u16(v: number) {
    this.u8(v >> 8);
    this.u8(v);
  }
  i16(v: number) {
    this.u16(v < 0 ? v + 65536 : v);
  }
  u32(v: number) {
    this.u16((v >>> 16) & 65535);
    this.u16(v & 65535);
  }
  tag(t: string) {
    for (const c of t) this.u8(c.charCodeAt(0));
  }
  pad4() {
    while (this.bytes.length % 4) this.u8(0);
  }
}

interface GlyphData {
  code: number;
  advance: number;
  contours: [number, number][][];
  bbox: [number, number, number, number];
}

/** Fusionne les pixels en rectangles (segments horizontaux étendus verticalement). */
function rects(px: [number, number][]): [number, number, number, number][] {
  const on = new Set(px.map(([x, y]) => `${x},${y}`));
  const used = new Set<string>();
  const out: [number, number, number, number][] = [];
  const sorted = [...px].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x0, y0] of sorted) {
    if (used.has(`${x0},${y0}`)) continue;
    let x1 = x0;
    while (on.has(`${x1 + 1},${y0}`) && !used.has(`${x1 + 1},${y0}`)) x1++;
    let y1 = y0;
    const rowFull = (y: number) => {
      for (let x = x0; x <= x1; x++) if (!on.has(`${x},${y}`) || used.has(`${x},${y}`)) return false;
      return !on.has(`${x0 - 1},${y}`) || used.has(`${x0 - 1},${y}`) || true;
    };
    while (rowFull(y1 + 1)) y1++;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) used.add(`${x},${y}`);
    out.push([x0, y0, x1 + 1, y1 + 1]);
  }
  return out;
}

function buildGlyph(code: number, w: number, px: [number, number][]): GlyphData {
  const contours: [number, number][][] = [];
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const [x0, r0, x1, r1] of rects(px)) {
    const X0 = x0 * PX, X1 = x1 * PX, Y0 = (BASE_ROW - r1) * PX, Y1 = (BASE_ROW - r0) * PX;
    // sens horaire (contour extérieur TrueType)
    contours.push([[X0, Y0], [X0, Y1], [X1, Y1], [X1, Y0]]);
    xMin = Math.min(xMin, X0);
    yMin = Math.min(yMin, Y0);
    xMax = Math.max(xMax, X1);
    yMax = Math.max(yMax, Y1);
  }
  if (!contours.length) xMin = yMin = xMax = yMax = 0;
  return { code, advance: (w + 1) * PX, contours, bbox: [xMin, yMin, xMax, yMax] };
}

function glyfBytes(g: GlyphData): number[] {
  if (!g.contours.length) return [];
  const w = new Writer();
  w.i16(g.contours.length);
  g.bbox.forEach((v) => w.i16(v));
  let end = -1;
  for (const c of g.contours) {
    end += c.length;
    w.u16(end);
  }
  w.u16(0); // instructions
  const pts = g.contours.flat();
  for (let i = 0; i < pts.length; i++) w.u8(1); // on-curve, coordonnées int16
  let px = 0;
  for (const [x] of pts) {
    w.i16(x - px);
    px = x;
  }
  let py = 0;
  for (const [, y] of pts) {
    w.i16(y - py);
    py = y;
  }
  while (w.bytes.length % 4) w.u8(0);
  return w.bytes;
}

function nameTable(family: string): number[] {
  const records: [number, string][] = [[1, family], [2, 'Regular'], [3, `${family} Regular`], [4, family], [5, 'Version 1.0'], [6, family]];
  const w = new Writer();
  const strings: number[][] = records.map(([, s]) => {
    const b: number[] = [];
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      b.push(c >> 8, c & 255);
    }
    return b;
  });
  w.u16(0);
  w.u16(records.length);
  w.u16(6 + records.length * 12);
  let off = 0;
  records.forEach(([id], i) => {
    w.u16(3);
    w.u16(1);
    w.u16(0x409);
    w.u16(id);
    w.u16(strings[i].length);
    w.u16(off);
    off += strings[i].length;
  });
  for (const s of strings) w.bytes.push(...s);
  return w.bytes;
}

export function buildPixelFont(): ArrayBuffer {
  const chars = fontCharset().map((c) => c.charCodeAt(0)).filter((c) => c <= 0xffff).sort((a, b) => a - b);
  const glyphs: GlyphData[] = [];
  // .notdef : rectangle creux
  glyphs.push(buildGlyph(0, 5, [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], ...[3, 4, 5, 6, 7].flatMap((y) => [[0, y], [4, y]] as [number, number][])]));
  for (const code of chars) {
    const ch = String.fromCharCode(code);
    const g = glyphPixels(ch);
    glyphs.push(buildGlyph(code, ch === ' ' ? 3 : g.w, ch === ' ' ? [] : g.px));
  }
  const n = glyphs.length;
  const glyf: number[] = [];
  const loca: number[] = [];
  for (const g of glyphs) {
    loca.push(glyf.length);
    glyf.push(...glyfBytes(g));
  }
  loca.push(glyf.length);
  let xMin = 0, yMin = 0, xMax = 0, yMax = 0, maxPts = 0, maxCont = 0, advMax = 0;
  for (const g of glyphs) {
    xMin = Math.min(xMin, g.bbox[0]);
    yMin = Math.min(yMin, g.bbox[1]);
    xMax = Math.max(xMax, g.bbox[2]);
    yMax = Math.max(yMax, g.bbox[3]);
    maxCont = Math.max(maxCont, g.contours.length);
    maxPts = Math.max(maxPts, g.contours.length * 4);
    advMax = Math.max(advMax, g.advance);
  }
  const ascent = BASE_ROW * PX;
  const descent = -(LINE_H - BASE_ROW) * PX;

  const tables: Record<string, number[]> = {};
  {
    const w = new Writer();
    w.u32(0x00010000);
    w.u32(0x00010000);
    w.u32(0); // checksumAdjustment (corrigé à la fin)
    w.u32(0x5f0f3cf5);
    w.u16(0x000b);
    w.u16(UPM);
    for (let i = 0; i < 4; i++) w.u32(0); // created / modified
    [xMin, yMin, xMax, yMax].forEach((v) => w.i16(v));
    w.u16(0);
    w.u16(8);
    w.i16(2);
    w.i16(1); // loca longue
    w.i16(0);
    tables.head = w.bytes;
  }
  {
    const w = new Writer();
    w.u32(0x00010000);
    w.i16(ascent);
    w.i16(descent);
    w.i16(0);
    w.u16(advMax);
    w.i16(0);
    w.i16(0);
    w.i16(xMax);
    w.i16(1);
    w.i16(0);
    w.i16(0);
    for (let i = 0; i < 4; i++) w.i16(0);
    w.i16(0);
    w.u16(n);
    tables.hhea = w.bytes;
  }
  {
    const w = new Writer();
    w.u32(0x00010000);
    w.u16(n);
    w.u16(maxPts);
    w.u16(maxCont);
    w.u16(0);
    w.u16(0);
    w.u16(2);
    for (let i = 0; i < 8; i++) w.u16(0);
    tables.maxp = w.bytes;
  }
  {
    const w = new Writer();
    for (const g of glyphs) {
      w.u16(g.advance);
      w.i16(g.bbox[0]);
    }
    tables.hmtx = w.bytes;
  }
  {
    const w = new Writer();
    for (const o of loca) w.u32(o);
    tables.loca = w.bytes;
  }
  tables.glyf = glyf;
  {
    const codes = chars;
    const segCount = codes.length + 1;
    const w = new Writer();
    w.u16(0);
    w.u16(1);
    w.u16(3);
    w.u16(1);
    w.u32(12);
    const sub = new Writer();
    const log = Math.floor(Math.log2(segCount));
    sub.u16(4);
    sub.u16(16 + segCount * 8);
    sub.u16(0);
    sub.u16(segCount * 2);
    sub.u16(2 * 2 ** log);
    sub.u16(log);
    sub.u16(segCount * 2 - 2 * 2 ** log);
    for (const c of codes) sub.u16(c);
    sub.u16(0xffff);
    sub.u16(0);
    for (const c of codes) sub.u16(c);
    sub.u16(0xffff);
    codes.forEach((c, i) => sub.u16((i + 1 - c + 65536) % 65536));
    sub.u16(1);
    for (let i = 0; i < segCount; i++) sub.u16(0);
    w.bytes.push(...sub.bytes);
    tables.cmap = w.bytes;
  }
  tables.name = nameTable(FONT_FAMILY);
  {
    const w = new Writer();
    w.u16(4);
    w.i16(6 * PX); // xAvgCharWidth
    w.u16(400);
    w.u16(5);
    w.u16(0);
    for (const v of [650, 700, 0, 140, 650, 700, 0, 480]) w.i16(v);
    w.i16(PX); // strikeout
    w.i16(3 * PX);
    w.i16(0);
    for (let i = 0; i < 10; i++) w.u8(0);
    w.u32(3); // Basic Latin + Latin-1
    w.u32(0);
    w.u32(0);
    w.u32(0);
    w.tag('LECR');
    w.u16(0x40);
    w.u16(chars[0]);
    w.u16(chars[chars.length - 1]);
    w.i16(ascent);
    w.i16(descent);
    w.i16(0);
    w.u16(ascent);
    w.u16(-descent);
    w.u32(1);
    w.u32(0);
    w.i16(5 * PX);
    w.i16(7 * PX);
    w.u16(0);
    w.u16(32);
    w.u16(1);
    tables['OS/2'] = w.bytes;
  }
  {
    const w = new Writer();
    w.u32(0x00030000);
    w.u32(0);
    w.i16(-PX);
    w.i16(PX);
    for (let i = 0; i < 5; i++) w.u32(0);
    tables.post = w.bytes;
  }

  // assemblage
  const tags = Object.keys(tables).sort();
  const out = new Writer();
  const num = tags.length;
  const log = Math.floor(Math.log2(num));
  out.u32(0x00010000);
  out.u16(num);
  out.u16(16 * 2 ** log);
  out.u16(log);
  out.u16(num * 16 - 16 * 2 ** log);
  let offset = 12 + num * 16;
  const sum = (b: number[]) => {
    let s = 0;
    for (let i = 0; i < b.length; i += 4) s = (s + (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
    return s;
  };
  const headOffset: { v: number } = { v: 0 };
  for (const t of tags) {
    const b = tables[t];
    out.tag(t.padEnd(4, ' '));
    out.u32(sum(b));
    out.u32(offset);
    out.u32(b.length);
    if (t === 'head') headOffset.v = offset;
    offset += Math.ceil(b.length / 4) * 4;
  }
  for (const t of tags) {
    out.bytes.push(...tables[t]);
    out.pad4();
  }
  const adj = (0xb1b0afba - sum(out.bytes)) >>> 0;
  const o = headOffset.v + 8;
  out.bytes[o] = adj >>> 24;
  out.bytes[o + 1] = (adj >>> 16) & 255;
  out.bytes[o + 2] = (adj >>> 8) & 255;
  out.bytes[o + 3] = adj & 255;
  return new Uint8Array(out.bytes).buffer;
}

/** Installe la police pixel dans le document (sans effet si l'API FontFace manque). */
export async function installPixelFont(): Promise<boolean> {
  try {
    if (typeof FontFace === 'undefined') return false;
    const face = new FontFace(FONT_FAMILY, buildPixelFont());
    await face.load();
    document.fonts.add(face);
    document.documentElement.classList.add('pixel-font');
    return true;
  } catch (e) {
    console.warn('Police pixel indisponible', e);
    return false;
  }
}
