import { pixelIcon } from './Bedrock';
/**
 * Icônes en pixel art des boutons tactiles (comme l'édition mobile) : chaque « # » est un pixel blanc,
 * avec une ombre portée sombre d'un pixel pour rester lisible sur tous les fonds.
 */
const ICONS: Record<string, string[]> = {
  up: [
    '....#....',
    '...###...',
    '..#####..',
    '.#######.',
    '#########',
    '...###...',
    '...###...',
    '...###...',
  ],
  down: [
    '...###...',
    '...###...',
    '...###...',
    '#########',
    '.#######.',
    '..#####..',
    '...###...',
    '....#....',
  ],
  left: [
    '...#.....',
    '..##.....',
    '.#######.',
    '########.',
    '.#######.',
    '..##.....',
    '...#.....',
  ],
  right: [
    '.....#...',
    '.....##..',
    '.#######.',
    '.########',
    '.#######.',
    '.....##..',
    '.....#...',
  ],
  upleft: [
    '######...',
    '#####....',
    '######...',
    '###.###..',
    '##...###.',
    '#.....###',
    '.......#.',
  ],
  upright: [
    '...######',
    '....#####',
    '...######',
    '..###.###',
    '.###...##',
    '###.....#',
    '.#.......',
  ],
  // s'accroupir : personnage baissé au-dessus d'une flèche
  sneak: [
    '...##....',
    '...##....',
    '.######..',
    '...##.##.',
    '..####...',
    '.##..##..',
    '.........',
    '..#####..',
    '...###...',
    '....#....',
  ],
  // courir : double chevron
  sprint: [
    '#...#....',
    '##..##...',
    '.##..##..',
    '..##..##.',
    '.##..##..',
    '##..##...',
    '#...#....',
  ],
  pause: [
    '.##...##.',
    '.##...##.',
    '.##...##.',
    '.##...##.',
    '.##...##.',
    '.##...##.',
    '.##...##.',
  ],
  chat: [
    '.#######.',
    '#########',
    '##.#.#.##',
    '#########',
    '.#######.',
    '..##.....',
    '.##......',
  ],
};

const cache = new Map<string, string>();

/** URL de données (SVG net, sans lissage) de l'icône `name`. */
export function touchIcon(name: string): string {
  let url = cache.get(name);
  if (url) return url;
  const rows = ICONS[name] ?? ICONS.up;
  const w = Math.max(...rows.map((r) => r.length)) + 1, h = rows.length + 1;
  let shadow = '', light = '';
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      if (c !== '#') return;
      shadow += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1"/>`;
      light += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><g fill="#000" fill-opacity="0.55">${shadow}</g><g fill="#fff">${light}</g></svg>`;
  url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  cache.set(name, url);
  return url;
}

/**
 * Pictogrammes de l'interface mobile (boutons du haut, sauter, s'accroupir, courir) : traits bleu
 * nuit sur boutons gris, chevrons blancs pour la course, comme le jeu original.
 */
const N = '#1d2638';
const BH: Record<string, { rows: string[]; pal: Record<string, string> }> = {
  // sauter : flèche vers le haut au-dessus d'un socle
  bh_jump: {
    rows: [
      '.......#.......',
      '......###......',
      '.....#####.....',
      '....#######....',
      '.......#.......',
      '.......#.......',
      '..#....#....#..',
      '..#....#....#..',
      '..#.........#..',
      '...............',
      '..###########..',
    ],
    pal: { '#': N },
  },
  // s'accroupir / descendre : flèche vers le bas, traits au-dessus
  bh_sneak: {
    rows: [
      '..#.........#..',
      '..#....#....#..',
      '..#....#....#..',
      '.......#.......',
      '.......#.......',
      '....#######....',
      '.....#####.....',
      '......###......',
      '.......#.......',
      '...............',
      '..###########..',
    ],
    pal: { '#': N },
  },
  // courir : double chevron blanc ombré de bleu clair
  bh_sprint: {
    rows: [
      '##..##.....',
      '###.###....',
      '.###.###...',
      '..###.###..',
      '...###.###.',
      '..###.###..',
      '.###.###...',
      '###.###....',
      '##..##.....',
    ],
    pal: { '#': '#ffffff' },
  },
  // menu : trois barres
  bh_menu: {
    rows: ['..............', '.############.', '.############.', '..............', '.############.', '.############.', '..............', '.############.', '.############.'],
    pal: { '#': N },
  },
  // tchat : bulle à trois points
  bh_chat: {
    rows: [
      '..##########..',
      '.#..........#.',
      '#............#',
      '#..##.##.##..#',
      '#..##.##.##..#',
      '#............#',
      '.#..........#.',
      '..####..#####.',
      '.....#..#.....',
      '......##......',
    ],
    pal: { '#': N },
  },
  // gestes : petit personnage aux bras écartés
  bh_emote: {
    rows: [
      '...#####....',
      '...#####....',
      '...#.#.#....',
      '.#.#####.#..',
      '###.###.##..',
      '.#..###..#..',
      '....###.....',
      '...##.##....',
      '...#...#....',
      '..##...##...',
    ],
    pal: { '#': N },
  },
};

/** Pictogramme de l'interface mobile : `url(...)` CSS. */
export function bhTouchIcon(name: string): string {
  const s = BH[name] ?? BH.bh_jump;
  return pixelIcon(`touch:${name}`, s.rows, s.pal);
}
