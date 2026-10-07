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
