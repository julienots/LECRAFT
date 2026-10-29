/**
 * Éléments graphiques des interfaces de l'édition Bedrock (mobile) : panneaux gris clair à
 * contour noir, cases creuses, onglets, boutons de l'en-tête, barre de recherche, icônes dessinées.
 * Tout est dessiné par le code à l'échelle de l'interface (1 unité = 1 pixel du canvas, la fenêtre
 * est ensuite agrandie par un nombre entier ou demi-entier de pixels d'écran) ; les objets, le
 * personnage et les textures viennent du pack de ressources.
 */

export const BC = {
  line: '#000000',
  hi: '#ffffff',
  sh: '#555555',
  panel: '#c6c6c6',
  slot: '#8b8b8b',
  slotDark: '#373737',
  list: '#5d5d5d',
  listTop: '#2e2e2e',
  cellLight: '#a6a6a6',
  cellDark: '#373737',
  bar: '#484848',
  barHi: '#737373',
  barSh: '#2d2d2d',
  tab: '#606060',
  tabHi: '#c3c3c3',
  tabSh: '#2d2d2d',
  field: '#5e5e5e',
  fieldTop: '#444444',
  fieldLine: '#b0b0b0',
  text: '#404040',
  silhouette: '#2b2b2b',
  red: '#d65a5a',
  redDark: '#8f2f2f',
  redLight: '#f08c8c',
} as const;

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

/** Panneau gris clair : contour noir, reflet blanc de 2 unités en haut et à gauche, ombre grise en bas et à droite. */
export function drawBPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = BC.panel) {
  rect(ctx, x + 1, y, w - 2, h, BC.line);
  rect(ctx, x, y + 1, w, h - 2, BC.line);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, fill);
  rect(ctx, x + 2, y + 1, w - 4, 2, BC.hi);
  rect(ctx, x + 1, y + 2, 2, h - 4, BC.hi);
  rect(ctx, x + 2, y + h - 3, w - 3, 2, BC.sh);
  rect(ctx, x + w - 3, y + 2, 2, h - 3, BC.sh);
  // coins : reflet et ombre se rejoignent en diagonale
  rect(ctx, x + w - 3, y + 1, 2, 2, fill);
  rect(ctx, x + 1, y + h - 3, 2, 2, fill);
}

/** Case creuse de 20 × 20 (contour sombre en haut et à gauche, clair en bas et à droite). */
export function drawBSlot(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x, y, 20, 20, BC.slot);
  rect(ctx, x, y, 19, 1, BC.slotDark);
  rect(ctx, x, y, 1, 19, BC.slotDark);
  rect(ctx, x + 1, y + 19, 19, 1, BC.hi);
  rect(ctx, x + 19, y + 1, 1, 19, BC.hi);
}

/**
 * Onglet de 27 de large : creux et sombre (hauteur 27, le trait du bas rejoint le contour du panneau) ou
 * plein et fondu dans le panneau quand il est sélectionné (hauteur 29, il recouvre le haut du panneau).
 */
export function drawBTab(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, selected: boolean) {
  if (selected) {
    rect(ctx, x + 1, y, w - 2, 26, BC.line);
    rect(ctx, x, y + 2, w, 24, BC.line);
    rect(ctx, x + 1, y + 1, w - 2, 25, BC.panel);
    rect(ctx, x + 2, y + 1, w - 4, 2, BC.hi);
    rect(ctx, x + 1, y + 2, 2, 24, BC.hi);
    rect(ctx, x + w - 3, y + 3, 2, 23, BC.sh);
    // le haut du panneau (trait noir et reflet) disparaît sous l'onglet
    rect(ctx, x + 1, y + 26, w - 2, h - 26, BC.panel);
    return;
  }
  rect(ctx, x + 1, y, w - 2, h, BC.line);
  rect(ctx, x, y + 2, w, h - 2, BC.line);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, BC.tab);
  rect(ctx, x + 2, y + 1, w - 4, 2, BC.tabHi);
  rect(ctx, x + 1, y + 2, 2, h - 4, BC.tabHi);
  rect(ctx, x + w - 3, y + 3, 2, h - 5, BC.tabSh);
}

/** Cadre sombre de l'en-tête (boutons du livre, de la fabrication, du coffre, aide et fermeture). */
export function drawBHeader(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  rect(ctx, x + 1, y, w - 2, h, BC.line);
  rect(ctx, x, y + 2, w, h - 2, BC.line);
  rect(ctx, x + 1, y + 1, w - 2, h - 1, BC.bar);
  rect(ctx, x + 2, y + 1, w - 4, 2, BC.barHi);
  rect(ctx, x + 1, y + 2, 2, h - 2, BC.barHi);
  rect(ctx, x + w - 3, y + 3, 2, h - 3, BC.barSh);
}

/** Bouton de l'en-tête (27 × 19) : clair au repos, gris enfoncé quand il est sélectionné. */
export function drawBButton(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, selected: boolean) {
  rect(ctx, x, y, w, h, BC.line);
  if (selected) {
    rect(ctx, x + 1, y + 1, w - 2, h - 2, BC.slot);
    rect(ctx, x + 1, y + 1, w - 2, 1, BC.slotDark);
    rect(ctx, x + 1, y + 1, 1, h - 2, BC.slotDark);
    rect(ctx, x + 1, y + h - 2, w - 2, 1, BC.hi);
    rect(ctx, x + w - 2, y + 1, 1, h - 2, BC.hi);
  } else {
    rect(ctx, x + 1, y + 1, w - 2, h - 2, BC.panel);
    rect(ctx, x + 1, y + 1, w - 2, 1, BC.hi);
    rect(ctx, x + 1, y + 1, 1, h - 2, BC.hi);
    rect(ctx, x + 1, y + h - 2, w - 2, 1, BC.sh);
    rect(ctx, x + w - 2, y + 1, 1, h - 2, BC.sh);
  }
}

/** Barre de recherche (fond gris foncé, contour noir, filet clair dessous). */
export function drawBField(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  rect(ctx, x, y, w, h, BC.line);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, BC.field);
  rect(ctx, x + 1, y + 1, w - 2, 1, BC.fieldTop);
  rect(ctx, x + 1, y + h - 3, w - 2, 1, BC.fieldLine);
}

/** Zone de liste (fond sombre, ombre intérieure en haut) dans laquelle défilent les cases. */
export function drawBListArea(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  rect(ctx, x, y, w, h, BC.list);
  rect(ctx, x, y, w, 2, BC.listTop);
}

/** Interrupteur du filtre « recettes fabricables » : case de l'établi et curseur à droite. */
export function drawBToggle(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean) {
  // case de l'icône (17 × 17) puis curseur (11 × 17)
  rect(ctx, x, y, 17, 17, BC.line);
  rect(ctx, x + 1, y + 1, 15, 15, on ? '#d8d8d8' : BC.slot);
  rect(ctx, x + 1, y + 1, 15, 1, on ? BC.hi : BC.slotDark);
  rect(ctx, x + 1, y + 1, 1, 15, on ? BC.hi : BC.slotDark);
  rect(ctx, x + 17, y, 11, 17, BC.line);
  rect(ctx, x + 18, y + 1, 9, 15, on ? '#3f8f2f' : BC.bar);
  rect(ctx, on ? x + 22 : x + 19, y + 4, 4, 9, on ? BC.hi : '#9a9a9a');
}

// ---------------------------------------------------------------------------------------------
// Dessins en caractères : '#' trait sombre, autres lettres = palette
// ---------------------------------------------------------------------------------------------
type Palette = Record<string, string>;

export function drawArt(ctx: CanvasRenderingContext2D, x: number, y: number, rows: string[], pal: Palette) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = pal[row[i]];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x + i, y + j, 1, 1);
      }
    }
  });
}

const D = { '#': BC.silhouette };

const SIL_HEAD = [
  '................',
  '....########....',
  '...#........#...',
  '..#..........#..',
  '..#..........#..',
  '..#..##..##..#..',
  '..#..........#..',
  '..#..........#..',
  '...#........#...',
  '....#......#....',
  '.....##..##.....',
  '......####......',
];
const SIL_CHEST = [
  '................',
  '..###......###..',
  '.#...##..##...#.',
  '#.....####.....#',
  '#..............#',
  '#..#........#..#',
  '.#.#........#.#.',
  '..##........##..',
  '...#........#...',
  '...#........#...',
  '...#........#...',
  '....########....',
];
const SIL_LEGS = [
  '................',
  '..############..',
  '..#..........#..',
  '..#..######..#..',
  '..#..#....#..#..',
  '..#..#....#..#..',
  '..#..#....#..#..',
  '..#..#....#..#..',
  '..#..#....#..#..',
  '..####....####..',
];
const SIL_BOOTS = [
  '................',
  '..####....####..',
  '..#..#....#..#..',
  '..#..#....#..#..',
  '..#..#....#..#..',
  '..#..#....#..#..',
  '.##..#....#..##.',
  '#....#....#....#',
  '.####......####.',
];
const SIL_SHIELD = [
  '................',
  '..############..',
  '..#..........#..',
  '..#..........#..',
  '..#..........#..',
  '..#..........#..',
  '...#........#...',
  '...#........#...',
  '....#......#....',
  '.....#....#.....',
  '......#..#......',
  '.......##.......',
];

/** Silhouette de la case d'armure vide (16 × 16, dessinée autour du point `x, y`). */
export function drawSilhouette(ctx: CanvasRenderingContext2D, kind: 'head' | 'chest' | 'legs' | 'feet' | 'shield', x: number, y: number) {
  const rows = { head: SIL_HEAD, chest: SIL_CHEST, legs: SIL_LEGS, feet: SIL_BOOTS, shield: SIL_SHIELD }[kind];
  drawArt(ctx, x, y + 2, rows, D);
}

/** Flèche de fabrication / cuisson (`w` × 14), grise comme dans le jeu ; `fill` : progression 0..1 en blanc. */
export function drawBArrow(ctx: CanvasRenderingContext2D, x: number, y: number, fill = 0, w = 18, color = '#8b8b8b') {
  const shape = (c: string, upto: number) => {
    ctx.fillStyle = c;
    for (let i = 0; i < w && i < upto; i++) {
      if (i < w - 8) ctx.fillRect(x + i, y + 5, 1, 4);
      else {
        const half = Math.max(1, Math.round(7 - (i - (w - 8)) * 0.85));
        ctx.fillRect(x + i, y + 7 - half, 1, half * 2);
      }
    }
  };
  shape(color, w);
  if (fill > 0) shape('#ffffff', Math.round(w * fill));
}

// ----- icônes d'onglets et de boutons -------------------------------------------------------

/** Loupe de l'onglet de recherche (16 × 16). */
export function drawMagnifier(ctx: CanvasRenderingContext2D, x: number, y: number, size = 16) {
  const k = size / 16;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  const c = 6.4, r = 5.6;
  for (let j = 0; j < 16; j++)
    for (let i = 0; i < 16; i++) {
      const d = Math.hypot(i + 0.5 - c - 1, j + 0.5 - c - 1);
      if (d <= r + 1.0 && d > r - 0.3) rect(ctx, i, j, 1, 1, '#23314d');
      else if (d <= r - 0.3) rect(ctx, i, j, 1, 1, i + j < 10 ? '#cfe7ff' : '#7db8f0');
    }
  for (let i = 0; i < 5; i++) {
    rect(ctx, 11 + i, 11 + i, 2, 2, '#7a5230');
    rect(ctx, 10 + i, 10 + i, 1, 1, '#23314d');
  }
  ctx.restore();
}

/** Petite loupe grise de la barre de recherche (10 × 10). */
export function drawSmallMagnifier(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const rows = [
    '..####....',
    '.#....#...',
    '#......#..',
    '#......#..',
    '#......#..',
    '.#....#...',
    '..####.#..',
    '........#.',
    '.........#',
  ];
  drawArt(ctx, x, y, rows, { '#': '#c9c9c9' });
}

/** Livre ouvert vert (bouton du catalogue créatif), 19 × 12. */
export function drawOpenBook(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const rows = [
    '..#######.#######..',
    '.#GGGGGGG#GGGGGGG#.',
    '#GGWWWWWWGWWWWWWGG#',
    '#GWWWWWWWGWWWWWWWG#',
    '#GWWWWWWWGWWWWWWWG#',
    '#GWWWWWWWGWWWWWWWG#',
    '#GWWWWWWWGWWWWWWWG#',
    '#GwwwwwwwGwwwwwwwG#',
    '#GGGGGGGGGGGGGGGGG#',
    '.#################.',
  ];
  drawArt(ctx, x, y + 1, rows, { '#': '#123a24', G: '#3fa04a', W: '#f6f1e8', w: '#d6cfbd' });
}

/** Coffre en bois vu de face (bouton « inventaire »), 14 × 10. */
export function drawChestIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const rows = [
    '..##########..',
    '.#bbbbbbbbbb#.',
    '#bbbbbbbbbbbb#',
    '#bbbbbbbbbbbb#',
    '#dddddddddddd#',
    '#bbbbbkkbbbbb#',
    '#bbbbbkkbbbbb#',
    '#bbbbbbbbbbbb#',
    '.#bbbbbbbbbb#.',
    '..##########..',
  ];
  drawArt(ctx, x, y, rows, { '#': '#2a1608', b: '#a4702e', d: '#6e4719', k: '#d8d8d8' });
}

/** Livre vert incliné devant un coffre : bouton de la fabrication, 20 × 13. */
export function drawCraftIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  drawChestIcon(ctx, x + 6, y + 2);
  const rows = [
    '....####....',
    '..##GGGG##..',
    '.#GGGwwwG##.',
    '#GGwwwwGGG#.',
    '#GwwwwGGGG#.',
    '.#GwwGGGG#..',
    '..##GGGG##..',
    '....####....',
  ];
  drawArt(ctx, x, y + 1, rows, { '#': '#10301a', G: '#3fa04a', w: '#e8f0e0' });
}

/** Croix de fermeture et point d'interrogation de l'en-tête (blancs). */
export function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const rows = ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'];
  drawArt(ctx, x, y, rows, { '#': '#ffffff' });
}
export function drawQuestion(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const rows = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];
  drawArt(ctx, x, y, rows, { '#': '#ffffff' });
}

/** Poubelle (case de destruction de l'inventaire créatif). */
export function drawTrash(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const rows = [
    '......####......',
    '..############..',
    '..#..........#..',
    '...#.#.#.#.#.#..',
    '...#.#.#.#.#.#..',
    '...#.#.#.#.#.#..',
    '...#.#.#.#.#.#..',
    '...#.#.#.#.#.#..',
    '...##########...',
  ];
  drawArt(ctx, x, y + 3, rows, { '#': '#3a3a3a' });
}
