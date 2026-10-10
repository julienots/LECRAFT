/**
 * Dimension de la « Pâte à papier » (v2.20) : un monde entièrement fait de papier — plaines de
 * feuilles blanches, forêts d'origami, canyons de carton, marais d'encre. Blocs, objets et
 * recettes ; le portail se construit en papier mâché et s'ouvre avec une plume encrée.
 * Textures générées (art original).
 */
import type { BlockDef } from '../blocks/Block';
import type { ItemDef } from '../inventory/Item';
import type { CraftingRecipe, SmeltingRecipe } from '../crafting/Recipe';
import { hex, registerPainter, paint, type Tile } from '../render/TextureGenerator';

const B: BlockDef[] = [];
const I: ItemDef[] = [];
const R: CraftingRecipe[] = [];
const S: SmeltingRecipe[] = [];
type P = (t: Tile) => void;
const tile = (name: string, fn: P) => registerPainter(name, fn);
const shaped = (id: string, result: string, count: number, pattern: string[], key: Record<string, string>) =>
  R.push({ id: `paper:${id}`, type: 'shaped', result: { item: result, count }, pattern, key, width: Math.max(...pattern.map((p) => p.length)), height: pattern.length });
const shapeless = (id: string, result: string, count: number, ingredients: string[]) =>
  R.push({ id: `paper:${id}`, type: 'shapeless', result: { item: result, count }, ingredients, width: ingredients.length <= 4 ? 2 : 3, height: Math.ceil(ingredients.length / (ingredients.length <= 4 ? 2 : 3)) });
const shade = (c: string, k: number) => '#' + hex(c).slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('');

/** Feuille de papier : fibres légères. */
const paperFibers = (base: string): P => (t) => {
  t.grain(paint.ramp(base, 3, 0.05), 0.2, 2);
  for (let i = 0; i < 10; i++) {
    const x = t.rng.int(0, 13), y = t.rng.int(0, 15);
    t.hline(x, x + 2, y, hex(shade(base, 0.95)));
  }
};
const paperBlock = (key: string, name: string, painter: P, o: Partial<BlockDef> = {}) => {
  tile(key, painter);
  B.push({ key, name, textures: { all: key }, hardness: 0.6, tool: 'axe', minTier: 0, flammable: true, sound: 'wool', color: '#f4f0e6', ...o });
};

// ---------- blocs ----------
paperBlock('paper_block', 'Bloc de papier', paperFibers('#f6f3ea'));
paperBlock('lined_paper', 'Papier ligné', (t) => {
  paperFibers('#f6f3ea')(t);
  for (let y = 3; y < 16; y += 4) t.hline(0, 15, y, hex('#8fb3e0'));
  t.vline(3, 0, 15, hex('#e08a8a'));
});
paperBlock('squared_paper', 'Papier quadrillé', (t) => {
  paperFibers('#f6f3ea')(t);
  for (let i = 0; i < 16; i += 4) {
    t.hline(0, 15, i, hex('#a8c4e8'));
    t.vline(i, 0, 15, hex('#a8c4e8'));
  }
});
paperBlock('newspaper_block', 'Papier journal', (t) => {
  t.grain(paint.ramp('#d8d4cc', 3, 0.05), 0.2, 2);
  t.rect(1, 1, 14, 3, hex('#3a3a3a'));
  for (let y = 6; y < 15; y += 2) for (let x = 1; x < 15; x++) if (t.rng.next() < 0.7) t.set(x, y, hex('#6a6a6a'));
  t.vline(8, 5, 15, hex('#d8d4cc'));
}, { color: '#d8d4cc' });
paperBlock('crumpled_paper', 'Papier froissé', (t) => {
  t.grain(['#f0ece2', '#e2ddd0', '#f8f5ee', '#d4cfc2'].map(hex), 0.6, 4);
  for (let i = 0; i < 5; i++) {
    let x = t.rng.int(0, 15), y = t.rng.int(0, 15);
    for (let k = 0; k < 8; k++) {
      t.set(x, y, hex('#c8c2b4'));
      x = Math.max(0, Math.min(15, x + t.rng.int(-1, 1)));
      y = Math.max(0, Math.min(15, y + 1));
    }
  }
}, { hardness: 0.8 });
paperBlock('cardboard', 'Carton', (t) => {
  t.grain(paint.ramp('#c49a64', 3, 0.08), 0.3, 2);
  for (let x = 0; x < 16; x += 3) t.vline(x, 0, 15, hex('#a87e4c'));
  t.hline(0, 15, 0, hex('#b08a58'));
}, { hardness: 1, color: '#c49a64' });
tile('cardboard_tube_side', (t) => {
  t.grain(paint.ramp('#b8905c', 3, 0.08), 0.3, 2);
  for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) t.set(x, (y + (x >> 2)) % 16, hex('#9a7444'));
});
tile('cardboard_tube_top', (t) => {
  t.rect(0, 0, 16, 16, hex('#b8905c'));
  t.rect(3, 3, 10, 10, hex('#2a2018'));
  t.border(hex('#9a7444'));
});
B.push({ key: 'cardboard_tube', name: 'Tube de carton', textures: { top: 'cardboard_tube_top', bottom: 'cardboard_tube_top', side: 'cardboard_tube_side' }, hardness: 1, tool: 'axe', flammable: true, sound: 'wood', color: '#b8905c' });
paperBlock('papier_mache', 'Papier mâché', (t) => {
  t.grain(['#d8ccb4', '#c8bca2', '#e4dac6', '#b8ac94'].map(hex), 0.6, 2);
  for (let i = 0; i < 14; i++) t.set(t.rng.int(0, 15), t.rng.int(0, 15), hex(['#4a6aa0', '#a04a4a', '#3a3a3a'][i % 3]));
}, { hardness: 25, tool: 'pickaxe', minTier: 2, flammable: false, sound: 'stone', color: '#d8ccb4' });
const COLORED: [string, string, string][] = [
  ['red', 'rouge', '#e05050'], ['orange', 'orange', '#f09040'], ['yellow', 'jaune', '#f0d050'], ['lime', 'vert', '#7cc850'],
  ['cyan', 'cyan', '#50c0d0'], ['blue', 'bleu', '#5078d8'], ['purple', 'violet', '#9a60d0'], ['pink', 'rose', '#f090c0'],
];
for (const [c, n, h] of COLORED) {
  paperBlock(`${c}_paper`, `Papier ${n}`, paperFibers(h), { color: h });
  shapeless(`${c}_paper`, `${c}_paper`, 4, ['paper_block', 'paper_block', 'paper_block', 'paper_block', `${c === 'lime' ? 'lime' : c}_dye`]);
}
// feuillage d'origami : facettes pliées
const origami = (base: string): P => (t) => {
  const a = hex(base), b = hex(shade(base, 0.82)), c = hex(shade(base, 1.12));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, (x + y) % 16 < 8 ? (x > y ? a : c) : x > y ? b : a);
  for (let i = 0; i < 16; i++) {
    t.set(i, i, hex(shade(base, 0.7)));
    t.set(15 - i, i, hex(shade(base, 0.75)));
  }
};
tile('origami_leaves', origami('#5cb860'));
B.push({ key: 'origami_leaves', name: 'Feuillage d’origami', textures: { all: 'origami_leaves' }, hardness: 0.3, tool: 'axe', minTier: 0, flammable: true, sound: 'wool', drops: [{ item: 'origami_fruit', chance: 0.08 }, { item: 'paper', chance: 0.3 }], color: '#5cb860' });
tile('origami_blossom', origami('#f0a0c8'));
B.push({ key: 'origami_blossom', name: 'Fleurs d’origami', textures: { all: 'origami_blossom' }, hardness: 0.3, tool: 'axe', minTier: 0, flammable: true, sound: 'wool', drops: [{ item: 'origami_fruit', chance: 0.12 }, { item: 'pink_paper', chance: 0.2 }], color: '#f0a0c8' });
tile('graphite_ore', (t) => {
  paint.cobble(t, paint.ramp('#c49a64', 5, 0.25));
  for (let i = 0; i < 4; i++) {
    const x = t.rng.int(2, 12), y = t.rng.int(2, 12);
    t.rect(x, y, 3, 2, hex('#3a3a40'));
    t.set(x + 1, y, hex('#8a8a94'));
  }
});
B.push({ key: 'graphite_ore', name: 'Minerai de graphite', textures: { all: 'graphite_ore' }, hardness: 2, tool: 'pickaxe', minTier: 1, sound: 'stone', drops: [{ item: 'graphite', min: 1, max: 3 }], color: '#5a5a62' });
tile('graphite_block', (t) => void paint.mineral(t, '#3c3c44', 'metal'));
B.push({ key: 'graphite_block', name: 'Bloc de graphite', textures: { all: 'graphite_block' }, hardness: 3, tool: 'pickaxe', minTier: 1, sound: 'metal', color: '#3c3c44' });
tile('ink_block', (t) => {
  t.grain(['#14141c', '#1c1c28', '#0c0c12'].map(hex), 0.5, 4);
  t.set(4, 4, hex('#4a4a6a'));
  t.set(5, 4, hex('#3a3a5a'));
});
B.push({ key: 'ink_block', name: 'Bloc d’encre', textures: { all: 'ink_block' }, hardness: 0.5, tool: 'shovel', minTier: 0, sound: 'snow', friction: 0.6, drops: [{ item: 'ink_sac', min: 1, max: 3 }], color: '#14141c' });
tile('paper_lantern', (t) => {
  t.clear();
  t.rect(4, 2, 8, 9, hex('#e05040'));
  for (let y = 3; y < 11; y += 2) t.hline(4, 11, y, hex('#f08070'));
  t.rect(6, 0, 4, 2, hex('#2a2018'));
  t.rect(6, 4, 4, 5, hex('#ffd890'));
});
B.push({ key: 'paper_lantern', name: 'Lanterne en papier', textures: { all: 'paper_lantern' }, hardness: 0.5, render: 'model', shape: 'lantern', solid: false, light: 15, flammable: true, sound: 'wool', color: '#e05040' });
const FLOWERS: [string, string, string][] = [['paper_rose', 'Rose en papier', '#e05050'], ['paper_tulip', 'Tulipe en papier', '#f0d050'], ['paper_daisy', 'Marguerite en papier', '#5078d8']];
for (const [k, n, h] of FLOWERS) {
  tile(k, (t) => {
    t.clear();
    t.vline(7, 7, 15, hex('#5cb860'));
    t.rect(8, 10, 2, 1, hex('#5cb860'));
    const c = hex(h), d = hex(shade(h, 0.8));
    t.draw(['..a..', '.aba.', 'abcba', '.aba.', '..a..'], { a: c, b: d, c: hex('#f6f3ea') }, 5, 2);
  });
  B.push({ key: k, name: n, textures: { all: k }, hardness: 0, render: 'cross', solid: false, needsSupport: true, replaceable: false, sway: true, sound: 'grass', color: h });
}
tile('confetti', (t) => {
  t.clear();
  const c = ['#e05050', '#f0d050', '#5078d8', '#7cc850', '#f090c0', '#9a60d0'].map(hex);
  for (let i = 0; i < 30; i++) t.set(t.rng.int(0, 15), t.rng.int(0, 15), c[t.rng.int(0, 5)]);
});
B.push({ key: 'confetti', name: 'Confettis', textures: { all: 'confetti' }, hardness: 0, render: 'model', shape: 'carpet', solid: false, needsSupport: true, replaceable: true, sound: 'wool', color: '#f0d050' });
tile('paper_portal', (t) => {
  // feuille translucide pliée en éventail, traits d'encre bleue et paillettes pastel
  const pale = ['#fdfaf2', '#eaf1ff', '#fde9f3', '#e9fbf1', '#fff6d6'].map(hex);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, pale[((x + y) >> 2) % 5], 175);
  for (let i = 0; i < 16; i++) {
    t.set(i, (i * 3) % 16, hex('#5a7ad8'), 235);
    t.set((i * 7) % 16, i, hex('#8fb3e0'), 220);
  }
  for (let k = 0; k < 16; k += 4) t.vline(k, 0, 15, hex('#d8d0c0'), 200);
  for (let i = 0; i < 8; i++) t.set(t.rng.int(0, 15), t.rng.int(0, 15), hex(['#f090c0', '#f0d050', '#7cc850'][i % 3]), 255);
});
B.push({ key: 'paper_portal', name: 'Portail de la Pâte à papier', textures: { all: 'paper_portal' }, hardness: -1, render: 'model', solid: false, light: 12, lightFilter: 0, sound: 'glass', drops: [], color: '#f6f3ea' });

// ---------- objets ----------
const item = (key: string, name: string, sprite: string, colors: string[], o: Partial<ItemDef> = {}) => I.push({ key, name, icon: { sprite, colors }, tab: 'ingredients', ...o });
item('graphite', 'Graphite', 'lump', ['#3c3c44', '#8a8a94']);
item('quill', 'Plume encrée', 'feather', ['#f0f0f0', '#1a1a2a'], { use: 'ignite', maxStack: 1, tab: 'tools', description: 'Ouvre un portail de papier mâché (4×5) vers la Pâte à papier' });
item('origami_fruit', 'Fruit en origami', 'apple', ['#f0a0c8', '#5cb860'], { food: { hunger: 4, saturation: 4.8 }, tab: 'food' });
item('paper_plane_item', 'Avion en papier', 'paper', ['#f6f3ea', '#8fb3e0'], { maxStack: 16, tab: 'combat', use: 'throw', projectile: 'lecraft:paper_plane', description: 'Se lance (4 dégâts) et se récupère souvent' });
item('paper_crown', 'Couronne de papier', 'helmet', ['#f0d050'], { maxStack: 1, armor: { slot: 'head', defense: 3, durability: 300, material: 'paper' }, tab: 'combat' });
item('giant_scissors', 'Ciseaux géants', 'shears', ['#c8c8d0', '#e05050'], { maxStack: 1, damage: 7, attackCooldown: 0.7, tool: { type: 'sword', tier: 3, speed: 6, durability: 500, material: 'graphite' }, tab: 'combat' });
const G = { tier: 3, speed: 7, durability: 420, color: '#4a4a54' };
const DMG: Record<string, number> = { sword: 6, axe: 9, pickaxe: 4, shovel: 4.5, hoe: 1 };
const NAMES: Record<string, string> = { sword: 'Épée', pickaxe: 'Pioche', axe: 'Hache', shovel: 'Pelle', hoe: 'Houe' };
const PATTERNS: Record<string, string[]> = { sword: ['M', 'M', 'S'], pickaxe: ['MMM', ' S ', ' S '], axe: ['MM', 'MS', ' S'], shovel: ['M', 'S', 'S'], hoe: ['MM', ' S', ' S'] };
for (const tk of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'] as const) {
  I.push({
    key: `graphite_${tk}`, name: `${NAMES[tk]} en graphite`, icon: { sprite: tk, colors: [G.color, '#c49a64'] }, maxStack: 1,
    tool: { type: tk, tier: G.tier, speed: G.speed, durability: G.durability, material: 'graphite' }, damage: DMG[tk],
    attackCooldown: tk === 'sword' ? 0.625 : tk === 'axe' ? 1.1 : tk === 'pickaxe' ? 0.83 : tk === 'hoe' ? 0.5 : 1, use: tk === 'hoe' ? 'till' : undefined, tab: tk === 'sword' ? 'combat' : 'tools',
  });
  shaped(`graphite_${tk}`, `graphite_${tk}`, 1, PATTERNS[tk], { M: 'graphite', S: 'cardboard_tube' });
}
const PIECES = [['head', 'helmet', 'Casque'], ['chest', 'chestplate', 'Plastron'], ['legs', 'leggings', 'Jambières'], ['feet', 'boots', 'Bottes']] as const;
const ARMOR_P: Record<string, string[]> = { helmet: ['XXX', 'X X'], chestplate: ['X X', 'XXX', 'XXX'], leggings: ['XXX', 'X X', 'X X'], boots: ['X X', 'X X'] };
const DEF = [2, 4, 3, 2], DUR = [140, 200, 190, 160];
PIECES.forEach(([slot, k, n], i) => {
  I.push({ key: `cardboard_${k}`, name: `${n} en carton`, icon: { sprite: k, colors: ['#c49a64'] }, maxStack: 1, armor: { slot, defense: DEF[i], durability: DUR[i], material: 'cardboard' }, tab: 'combat' });
  shaped(`cardboard_${k}`, `cardboard_${k}`, 1, ARMOR_P[k], { X: 'cardboard' });
});

// ---------- recettes ----------
shaped('paper_block', 'paper_block', 1, ['PPP', 'PPP', 'PPP'], { P: 'paper' });
shapeless('paper_from_block', 'paper', 9, ['paper_block']);
shaped('papier_mache', 'papier_mache', 4, ['PPP', 'PCP', 'PPP'], { P: 'paper', C: 'clay_ball' });
shapeless('quill', 'quill', 1, ['feather', 'ink_sac', 'paper']);
shaped('lined_paper', 'lined_paper', 4, ['PP', 'PB'], { P: 'paper_block', B: 'blue_dye' });
shaped('squared_paper', 'squared_paper', 4, ['PB', 'BP'], { P: 'paper_block', B: 'light_blue_dye' });
shaped('newspaper_block', 'newspaper_block', 4, ['PP', 'PI'], { P: 'paper_block', I: 'ink_sac' });
shaped('cardboard', 'cardboard', 2, ['PP', 'PP'], { P: 'paper' });
shaped('cardboard_tube', 'cardboard_tube', 2, ['C', 'C'], { C: 'cardboard' });
shaped('graphite_block', 'graphite_block', 1, ['GGG', 'GGG', 'GGG'], { G: 'graphite' });
shapeless('graphite_from_block', 'graphite', 9, ['graphite_block']);
shaped('paper_lantern', 'paper_lantern', 1, ['PPP', 'PTP', 'PPP'], { P: 'red_paper', T: 'torch' });
shapeless('paper_plane_item', 'paper_plane_item', 2, ['paper', 'paper']);
shapeless('confetti', 'confetti', 8, ['paper', 'red_dye', 'yellow_dye', 'blue_dye']);
shaped('giant_scissors', 'giant_scissors', 1, [' G ', 'G G', 'R R'], { G: 'graphite_block', R: 'red_paper' });
shaped('ink_block', 'ink_block', 1, ['II', 'II'], { I: 'ink_sac' });
S.push({ id: 'paper:smelt:graphite_ore', input: 'graphite_ore', result: 'graphite', xp: 0.5, time: 10 });

export const PAPER_BLOCKS = B;
export const PAPER_ITEMS = I;
export const PAPER_RECIPES = R;
export const PAPER_SMELTING = S;
