/**
 * Fonds des interfaces de conteneurs (inventaire, établi, fourneau, coffre) dans la disposition
 * classique des jeux de blocs (176 px de large, cases de 18 px). Dessinés par le code ;
 * remplacés par les images `gui/container/*.png` d'un pack de ressources s'il est installé.
 */
import type { TextureManager } from '../render/TextureManager';
import { drawText, textWidth } from './PixelFont';

export type ContainerKind = 'inventory' | 'table' | 'furnace' | 'chest';

export const GUI_W = 176;
export function guiHeight(kind: ContainerKind, rows = 3) {
  return kind === 'chest' ? 114 + rows * 18 : 166;
}

const C = {
  panel: '#c6c6c6',
  light: '#ffffff',
  dark: '#555555',
  edge: '#000000',
  slot: '#8b8b8b',
  slotDark: '#373737',
  label: '#404040',
};

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

/** Panneau gris biseauté aux coins arrondis. */
export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  rect(ctx, x + 2, y, w - 4, h, C.edge);
  rect(ctx, x, y + 2, w, h - 4, C.edge);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, C.edge);
  rect(ctx, x + 2, y + 1, w - 4, h - 2, C.panel);
  rect(ctx, x + 1, y + 2, w - 2, h - 4, C.panel);
  // biseaux
  rect(ctx, x + 2, y + 1, w - 5, 2, C.light);
  rect(ctx, x + 1, y + 2, 2, h - 5, C.light);
  rect(ctx, x + 3, y + h - 3, w - 5, 2, C.dark);
  rect(ctx, x + w - 3, y + 3, 2, h - 5, C.dark);
  rect(ctx, x + 3, y + 3, 1, 1, C.light);
  rect(ctx, x + w - 4, y + h - 4, 1, 1, C.dark);
}

/** Case de 18x18 (contour sombre en haut à gauche, clair en bas à droite). `x,y` = coin de l'objet. */
export function drawSlot(ctx: CanvasRenderingContext2D, x: number, y: number, size = 18) {
  const o = (size - 16) / 2;
  const sx = x - o, sy = y - o;
  rect(ctx, sx, sy, size, size, C.slot);
  rect(ctx, sx, sy, size - 1, 1, C.slotDark);
  rect(ctx, sx, sy, 1, size - 1, C.slotDark);
  rect(ctx, sx + 1, sy + size - 1, size - 1, 1, C.light);
  rect(ctx, sx + size - 1, sy + 1, 1, size - 1, C.light);
}

/** Flèche de fabrication / cuisson (22x15). `fill` : progression 0..1 (blanc). */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, fill = 0) {
  const shape = (c: string, upto: number) => {
    ctx.fillStyle = c;
    for (let i = 0; i < 22 && i < upto; i++) {
      if (i < 15) ctx.fillRect(x + i, y + 5, 1, 5);
      else {
        const k = i - 15;
        ctx.fillRect(x + i, y + k, 1, 15 - 2 * k);
      }
    }
  };
  shape(C.slot, 22);
  if (fill > 0) shape(C.light, Math.round(22 * fill));
}

/** Flamme du fourneau (14x14), `fill` = combustible restant 0..1. */
export function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, fill: number) {
  const rows = ['......#.......', '.....##.......', '.....###......', '....####...#..', '...#####..##..', '...######.##..', '..##########..', '..###########.', '.############.', '.#############', '##############', '##############', '.############.', '..##########..'];
  const start = Math.round(14 * (1 - fill));
  for (let r = 0; r < 14; r++)
    for (let c = 0; c < 14; c++) {
      if (rows[r][c] !== '#') continue;
      const lit = r >= start && fill > 0;
      ctx.fillStyle = lit ? (r < 6 ? '#ffd84a' : r < 10 ? '#ff9a1a' : '#e8501a') : C.slot;
      ctx.fillRect(x + c, y + r, 1, 1);
    }
}

/** Personnage (vue de face) dans le cadre noir de l'inventaire. */
function drawFigure(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const k = 2;
  const box = (bx: number, by: number, w: number, h: number, c: string) => rect(ctx, x + bx * k, y + by * k, w * k, h * k, c);
  box(4, 0, 8, 8, '#b98a6a'); // tête
  box(4, 0, 8, 2, '#3b2a1c'); // cheveux
  box(4, 2, 1, 2, '#3b2a1c');
  box(11, 2, 1, 2, '#3b2a1c');
  box(6, 4, 1, 1, '#ffffff');
  box(7, 4, 1, 1, '#3a5a8a');
  box(9, 4, 1, 1, '#3a5a8a');
  box(10, 4, 1, 1, '#ffffff');
  box(7, 6, 3, 1, '#8a5a44');
  box(4, 8, 8, 12, '#3d7d48'); // torse
  box(0, 8, 4, 12, '#3d7d48'); // bras
  box(12, 8, 4, 12, '#3d7d48');
  box(0, 16, 4, 4, '#b98a6a');
  box(12, 16, 4, 4, '#b98a6a');
  box(4, 20, 4, 12, '#5a4632'); // jambes
  box(8, 20, 4, 12, '#4e3c2a');
  box(4, 30, 8, 2, '#2a2a2a');
}

const PACK_FILES: Record<ContainerKind, string> = {
  inventory: 'gui/container/inventory.png',
  table: 'gui/container/crafting_table.png',
  furnace: 'gui/container/furnace.png',
  chest: 'gui/container/generic_54.png',
};

/** Positions vanilla des cases (coin de l'objet 16x16). */
export const LAYOUT = {
  inventory: {
    armor: [0, 1, 2, 3].map((i) => [8, 8 + i * 18] as const),
    grid: [0, 1, 2, 3].map((i) => [98 + (i % 2) * 18, 18 + Math.floor(i / 2) * 18] as const),
    result: [154, 28] as const,
    arrow: [135, 29] as const,
    book: [104, 61] as const,
  },
  table: {
    grid: Array.from({ length: 9 }, (_, i) => [30 + (i % 3) * 18, 17 + Math.floor(i / 3) * 18] as const),
    result: [124, 35] as const,
    arrow: [90, 35] as const,
    book: [5, 34] as const,
  },
  furnace: { input: [56, 17] as const, fuel: [56, 53] as const, result: [116, 35] as const, flame: [56, 36] as const, arrow: [79, 34] as const, book: [20, 34] as const },
};

/** Position de l'inventaire du joueur (rangée principale) selon l'interface. */
export function playerInvY(kind: ContainerKind, rows = 3) {
  return kind === 'chest' ? 103 + (rows - 4) * 18 : 84;
}

/** Construit l'image de fond d'une interface (canvas 1:1 en pixels d'interface). */
export function containerBackground(kind: ContainerKind, title: string, tex: TextureManager, rows = 3): HTMLCanvasElement {
  const h = guiHeight(kind, rows);
  const c = document.createElement('canvas');
  c.width = GUI_W;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const img = tex.packImage(PACK_FILES[kind]);
  const py = playerInvY(kind, rows);
  if (img) {
    const k = img.width / 256;
    if (kind === 'chest') {
      const top = rows * 18 + 17;
      ctx.drawImage(img, 0, 0, GUI_W * k, top * k, 0, 0, GUI_W, top);
      ctx.drawImage(img, 0, 126 * k, GUI_W * k, 96 * k, 0, top, GUI_W, 96);
    } else ctx.drawImage(img, 0, 0, GUI_W * k, h * k, 0, 0, GUI_W, h);
  } else {
    drawPanel(ctx, 0, 0, GUI_W, h);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) drawSlot(ctx, 8 + i * 18, py + r * 18);
    for (let i = 0; i < 9; i++) drawSlot(ctx, 8 + i * 18, py + 58);
    if (kind === 'inventory') {
      const L = LAYOUT.inventory;
      for (const [x, y] of L.armor) drawSlot(ctx, x, y);
      rect(ctx, 26, 8, 51, 72, '#000000');
      for (const [x, y] of L.grid) drawSlot(ctx, x, y);
      drawArrow(ctx, L.arrow[0], L.arrow[1]);
      drawSlot(ctx, L.result[0], L.result[1], 18);
    } else if (kind === 'table') {
      const L = LAYOUT.table;
      for (const [x, y] of L.grid) drawSlot(ctx, x, y);
      drawArrow(ctx, L.arrow[0], L.arrow[1]);
      drawSlot(ctx, L.result[0], L.result[1], 26);
    } else if (kind === 'furnace') {
      const L = LAYOUT.furnace;
      drawSlot(ctx, L.input[0], L.input[1]);
      drawSlot(ctx, L.fuel[0], L.fuel[1]);
      drawSlot(ctx, L.result[0], L.result[1], 26);
    } else {
      for (let r = 0; r < rows; r++) for (let i = 0; i < 9; i++) drawSlot(ctx, 8 + i * 18, 18 + r * 18);
    }
  }
  if (kind === 'inventory') {
    rect(ctx, 27, 9, 49, 70, '#000000');
    drawFigure(ctx, 27 + 8, 9 + 3);
  }
  // libellés
  const label = (t: string, x: number, y: number) => drawText(ctx, t, x, y - 2, C.label);
  if (kind === 'inventory') label('Fabrication', 97, 8);
  else {
    if (kind === 'furnace') label(title, Math.round((GUI_W - textWidth(title)) / 2), 6);
    else label(title, kind === 'table' ? 29 : 8, 6);
    label('Inventaire', 8, py - 12);
  }
  return c;
}
