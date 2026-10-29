/**
 * Fonds des interfaces de conteneurs (inventaire, établi, fourneau, coffre) dans la disposition
 * classique des jeux de blocs (176 px de large, cases de 18 px). Dessinés par le code ;
 * remplacés par les images `gui/container/*.png` d'un pack de ressources s'il est installé.
 */
import { t as tr } from './i18n';
import type { TextureManager } from '../render/TextureManager';
import { drawText, textWidth } from './PixelFont';
import { BC, drawBArrow, drawBPanel, drawBSlot, drawSilhouette } from './BedrockArt';

export type ContainerKind = 'inventory' | 'table' | 'furnace' | 'chest' | 'enchant' | 'anvil' | 'brewing' | 'dispenser' | 'hopper';

export const GUI_W = 176;
export function guiHeight(kind: ContainerKind, rows = 3) {
  return kind === 'chest' ? 114 + rows * 18 : kind === 'hopper' ? 133 : 166;
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
/** Personnage de l'inventaire dessiné à partir de la vraie skin du joueur (vue de face, couches comprises). */
export function drawFigure(ctx: CanvasRenderingContext2D, x: number, y: number, skin: CanvasImageSource & { width: number; height: number }, k = 2) {
  const sx = skin.width / 64; // skins HD des packs
  const tall = skin.height >= skin.width; // format 64×64 (sinon 64×32 : membres gauches en miroir)
  ctx.imageSmoothingEnabled = false;
  const part = (u: number, v: number, w: number, h: number, dx: number, dy: number, mirror = false) => {
    ctx.save();
    if (mirror) {
      ctx.translate(x + (dx + w) * k, y + dy * k);
      ctx.scale(-1, 1);
      ctx.drawImage(skin, u * sx, v * sx, w * sx, h * sx, 0, 0, w * k, h * k);
    } else ctx.drawImage(skin, u * sx, v * sx, w * sx, h * sx, x + dx * k, y + dy * k, w * k, h * k);
    ctx.restore();
  };
  part(8, 8, 8, 8, 4, 0); // tête
  part(20, 20, 8, 12, 4, 8); // torse
  part(44, 20, 4, 12, 0, 8); // bras droit (à gauche à l'écran)
  part(4, 20, 4, 12, 4, 20); // jambe droite
  if (tall) {
    part(36, 52, 4, 12, 12, 8);
    part(20, 52, 4, 12, 8, 20);
    // couches extérieures (chapeau, veste, manches, pantalon)
    part(40, 8, 8, 8, 4, 0);
    part(20, 36, 8, 12, 4, 8);
    part(44, 36, 4, 12, 0, 8);
    part(52, 52, 4, 12, 12, 8);
    part(4, 36, 4, 12, 4, 20);
    part(4, 52, 4, 12, 8, 20);
  } else {
    part(44, 20, 4, 12, 12, 8, true);
    part(4, 20, 4, 12, 8, 20, true);
    part(40, 8, 8, 8, 4, 0);
  }
}

/** Matériau d'une pièce d'armure portée (nom des textures entity/equipment/…). */
function armorMaterial(item: string): string | null {
  if (item === 'turtle_helmet') return 'turtle_scute';
  const m = /^(.+?)_(helmet|chestplate|leggings|boots)$/.exec(item);
  if (!m) return null;
  return m[1] === 'golden' ? 'gold' : m[1];
}

const tinted = new Map<string, HTMLCanvasElement>();
/** Texture d'armure du pack (le cuir est teint en brun, comme la couleur par défaut du jeu). */
function armorTexture(tex: TextureManager, layer: 'humanoid' | 'humanoid_leggings', mat: string): (CanvasImageSource & { width: number; height: number }) | null {
  const img = tex.packImage(`entity/equipment/${layer}/${mat}.png`);
  if (!img || mat !== 'leather') return img ?? null;
  const key = `${layer}/${mat}`;
  let c = tinted.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#a06540';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
    tinted.set(key, c);
  }
  return c;
}

/**
 * Armure portée par-dessus le personnage de l'inventaire (même repère que drawFigure), comme le jeu
 * original : casque, plastron et bottes (texture humanoid), jambières (humanoid_leggings), un peu
 * plus grandes que le corps.
 */
export function drawArmor(ctx: CanvasRenderingContext2D, x: number, y: number, tex: TextureManager, armor: { head?: string; chest?: string; legs?: string; feet?: string }, k = 2) {
  ctx.imageSmoothingEnabled = false;
  const layer = (img: CanvasImageSource & { width: number }, grow: number, parts: [number, number, number, number, number, number][]) => {
    const s = img.width / 64;
    for (const [u, v, w, h, dx, dy] of parts) ctx.drawImage(img, u * s, v * s, w * s, h * s, x + (dx - grow) * k, y + (dy - grow) * k, (w + grow * 2) * k, (h + grow * 2) * k);
  };
  const piece = (item: string | undefined, file: 'humanoid' | 'humanoid_leggings') => {
    const mat = item ? armorMaterial(item) : null;
    return mat ? armorTexture(tex, file, mat) : null;
  };
  const legs = piece(armor.legs, 'humanoid_leggings');
  if (legs) layer(legs, 0.5, [[20, 20, 8, 12, 4, 8], [4, 20, 4, 12, 4, 20], [4, 20, 4, 12, 8, 20]]);
  const feet = piece(armor.feet, 'humanoid');
  if (feet) layer(feet, 0.5, [[4, 20, 4, 12, 4, 20], [4, 20, 4, 12, 8, 20]]);
  const chest = piece(armor.chest, 'humanoid');
  if (chest) layer(chest, 0.5, [[20, 20, 8, 12, 4, 8], [44, 20, 4, 12, 0, 8], [44, 20, 4, 12, 12, 8]]);
  const head = piece(armor.head, 'humanoid');
  if (head) layer(head, 0.5, [[8, 8, 8, 8, 4, 0]]);
}

const PACK_FILES: Record<ContainerKind, string> = {
  inventory: 'gui/container/inventory.png',
  table: 'gui/container/crafting_table.png',
  furnace: 'gui/container/furnace.png',
  chest: 'gui/container/generic_54.png',
  enchant: 'gui/container/enchanting_table.png',
  anvil: 'gui/container/anvil.png',
  brewing: 'gui/container/brewing_stand.png',
  dispenser: 'gui/container/dispenser.png',
  hopper: 'gui/container/hopper.png',
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
  return kind === 'chest' ? 103 + (rows - 4) * 18 : kind === 'hopper' ? 51 : 84;
}

/** Construit l'image de fond d'une interface (canvas 1:1 en pixels d'interface). */
export function containerBackground(kind: ContainerKind, title: string, tex: TextureManager, rows = 3, skinKey = 'player', extraSlots: [number, number, number][] = [], file?: string): HTMLCanvasElement {
  const h = guiHeight(kind, rows);
  const c = document.createElement('canvas');
  c.width = GUI_W;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // variantes du jeu original (haut fourneau, fumoir, boîte de shulker) : leur propre fond
  const img = (file ? tex.packImage(file) : undefined) ?? tex.packImage(PACK_FILES[kind]);
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
    } else if (kind === 'chest') {
      for (let r = 0; r < rows; r++) for (let i = 0; i < 9; i++) drawSlot(ctx, 8 + i * 18, 18 + r * 18);
    }
    // interfaces des stations (table d'enchantement, enclume, alambic, distributeur, entonnoir)
    for (const [x, y, size] of extraSlots) drawSlot(ctx, x, y, size);
  }
  if (kind === 'inventory') {
    rect(ctx, 27, 9, 49, 70, '#000000');
    drawFigure(ctx, 27 + 8, 9 + 3, tex.skin(skinKey).image as HTMLCanvasElement);
  }
  // libellés
  const label = (s: string, x: number, y: number) => drawText(ctx, tr(s), x, y - 2, C.label);
  if (kind === 'inventory') label('Artisanat', 97, 8);
  else {
    if (kind === 'furnace' || kind === 'brewing' || kind === 'dispenser') label(title, Math.round((GUI_W - textWidth(tr(title))) / 2), 6);
    else if (kind === 'anvil') label(title, 60, 6);
    else label(title, kind === 'table' ? 29 : 8, 6);
    label('Inventaire', 8, py - 12);
  }
  return c;
}

const spriteCache = new WeakMap<ImageBitmap, string>();
/** Sprite d'interface du pack (gui/sprites/…) en data URL, pour un fond CSS ; null sans pack. */
export function packSprite(tex: TextureManager, path: string): string | null {
  const img = tex.packImage(`gui/sprites/${path}.png`);
  if (!img) return null;
  let url = spriteCache.get(img);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.drawImage(img, 0, 0);
    url = c.toDataURL();
    spriteCache.set(img, url);
  }
  return url;
}

// =====================================================================================
// Interfaces façon édition Bedrock (mobile) : cases de 20 unités, panneau droit de 195
// =====================================================================================
export const PANEL_W = 195;
/** Largeur du panneau gauche (liste des recettes / des objets) et position du panneau droit en vue scindée. */
export const LEFT_W = 162;
export const RIGHT_X = 167;
/** Ordonnée du haut des panneaux (au-dessus : onglets et en-tête de 26 unités). */
export const BODY_Y = 26;

/** Ordonnée (cases de 20 unités) de la première rangée de l'inventaire du joueur. */
export function bedrockInvTop(kind: ContainerKind, rows = 3) {
  return kind === 'chest' ? 66 + rows * 20 : kind === 'hopper' ? 86 : 121;
}
/** Hauteur du panneau droit. */
export function bedrockBodyH(kind: ContainerKind, rows = 3) {
  return bedrockInvTop(kind, rows) + 63;
}

/** Positions des cases (coin de la case de 20 × 20, repère du panneau droit). */
export const BLAYOUT = {
  inventory: {
    armor: [0, 1, 2, 3].map((i) => [8, 33 + i * 20] as const),
    figure: [28, 33, 59, 80] as const,
    offhand: [88, 93] as const,
    grid: [[107, 46], [127, 46], [107, 66], [127, 66]] as const,
    arrow: [149, 58] as const,
    result: [168, 54] as const,
    title: [95, 34] as const,
  },
  table: {
    grid: Array.from({ length: 9 }, (_, i) => [28 + (i % 3) * 20, 46 + Math.floor(i / 3) * 20] as const),
    arrow: [98, 69] as const,
    result: [132, 66] as const,
    title: [28, 34] as const,
  },
  furnace: { input: [62, 44] as const, fuel: [62, 84] as const, flame: [66, 67] as const, arrow: [92, 65] as const, result: [132, 64] as const },
};

/** Fond du panneau droit : panneau, cases, personnage, flèches et libellés (repère absolu, 195 de large). */
export function bedrockBackground(kind: ContainerKind, title: string, tex: TextureManager, rows = 3, skinKey = 'player', extraCells: [number, number][] = [], opts: { chestCells?: number; arrowAt?: [number, number]; arrowW?: number; flame?: boolean; hideLabel?: boolean } = {}): HTMLCanvasElement {
  const h = BODY_Y + bedrockBodyH(kind, rows);
  const c = document.createElement('canvas');
  c.width = PANEL_W;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  drawBPanel(ctx, 0, BODY_Y, PANEL_W, bedrockBodyH(kind, rows));
  const top = bedrockInvTop(kind, rows);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) drawBSlot(ctx, 8 + i * 20, top + r * 20);
  for (let i = 0; i < 9; i++) drawBSlot(ctx, 8 + i * 20, top + 63);
  const label = (s: string, x: number, y: number) => drawText(ctx, tr(s), x, y - 2, BC.text);
  if (kind === 'inventory') {
    const L = BLAYOUT.inventory;
    L.armor.forEach(([x, y], i) => {
      drawBSlot(ctx, x, y);
      drawSilhouette(ctx, (['head', 'chest', 'legs', 'feet'] as const)[i], x + 2, y);
    });
    const [fx, fy, fw, fh] = L.figure;
    ctx.fillStyle = '#000';
    ctx.fillRect(fx, fy, fw, fh);
    ctx.fillStyle = BC.slotDark;
    ctx.fillRect(fx, fy, fw, 1);
    ctx.fillRect(fx, fy, 1, fh);
    drawBSlot(ctx, L.offhand[0], L.offhand[1]);
    drawSilhouette(ctx, 'shield', L.offhand[0] + 2, L.offhand[1]);
    for (const [x, y] of L.grid) drawBSlot(ctx, x, y);
    drawBArrow(ctx, L.arrow[0], L.arrow[1]);
    drawBSlot(ctx, L.result[0], L.result[1]);
    label('Fabrication', L.title[0], 35);
  } else if (kind === 'table') {
    const L = BLAYOUT.table;
    for (const [x, y] of L.grid) drawBSlot(ctx, x, y);
    drawBArrow(ctx, L.arrow[0], L.arrow[1]);
    drawBSlot(ctx, L.result[0], L.result[1]);
    label(title, L.title[0], 35);
  } else if (kind === 'furnace') {
    const L = BLAYOUT.furnace;
    drawBSlot(ctx, L.input[0], L.input[1]);
    drawBSlot(ctx, L.fuel[0], L.fuel[1]);
    drawBSlot(ctx, L.result[0], L.result[1]);
    drawFlame(ctx, L.flame[0], L.flame[1], 0);
    drawBArrow(ctx, L.arrow[0], L.arrow[1], 0, 24);
    label(title, 10, 35);
  } else if (kind === 'chest') {
    for (let r = 0; r < rows; r++) for (let i = 0; i < 9; i++) drawBSlot(ctx, 8 + i * 20, 46 + r * 20);
    label(title, 10, 35);
  } else {
    label(title, 10, 35);
  }
  if (kind === 'chest' || kind === 'hopper' || kind === 'dispenser') label('Inventaire', 10, top - 12);
  for (const [x, y] of extraCells) drawBSlot(ctx, x, y);
  return c;
}
