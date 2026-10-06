/**
 * Blocs et objets supplémentaires du jeu de référence (couleurs, bois, Nether, End, cuivre,
 * blocs de fonction décoratifs, colorants…). Ils élargissent la palette utilisable par les
 * add-ons (recettes, scripts, structures). Leurs identifiants numériques sont attribués et
 * mémorisés comme ceux des add-ons (aucun décalage des blocs existants dans les sauvegardes).
 * Textures et icônes générées (aucune ressource du jeu de référence n'est incluse).
 */
import type { BlockDef } from '../blocks/Block';
import type { ItemDef } from '../inventory/Item';
import type { CraftingRecipe, SmeltingRecipe } from '../crafting/Recipe';
import { WOOL_COLORS } from './blocks';
import { hex, registerPainter, paint, type Tile } from '../render/TextureGenerator';

const B: BlockDef[] = [];
const I: ItemDef[] = [];
const R: CraftingRecipe[] = [];
const S: SmeltingRecipe[] = [];
/** Ajouts aux tags de recettes existants (planches, bûches…). */
export const EXTRA_TAGS: Record<string, string[]> = { planks: [], logs: [] };

type P = (t: Tile) => void;
const tile = (name: string, fn: P) => registerPainter(name, fn);
const grainT = (colors: string[], w = 0.5, s = 4): P => (t) => void t.grain(colors.map(hex), w, s);
const flat = (base: string, spread = 0.12): P => (t) => void t.grain(paint.ramp(base, 4, spread), 0.4, 4);

function cube(key: string, name: string, painter: P | null, o: Partial<BlockDef> = {}) {
  if (painter) tile(key, painter);
  B.push({ key, name, textures: { all: key }, hardness: 1.5, tool: 'pickaxe', minTier: 1, sound: 'stone', ...o });
}
function sided(key: string, name: string, top: P, side: P, o: Partial<BlockDef> = {}) {
  tile(`${key}_top`, top);
  tile(`${key}_side`, side);
  B.push({ key, name, textures: { top: `${key}_top`, bottom: `${key}_top`, side: `${key}_side` }, hardness: 2, tool: 'axe', sound: 'wood', ...o });
}
function item(key: string, name: string, sprite: string, colors: string[], o: Partial<ItemDef> = {}) {
  I.push({ key, name, icon: { sprite, colors }, tab: 'ingredients', ...o });
}
const shaped = (id: string, result: string, count: number, pattern: string[], key: Record<string, string>) =>
  R.push({ id: `extra:${id}`, type: 'shaped', result: { item: result, count }, pattern, key, width: Math.max(...pattern.map((p) => p.length)), height: pattern.length });
const shapeless = (id: string, result: string, count: number, ingredients: string[]) =>
  R.push({ id: `extra:${id}`, type: 'shapeless', result: { item: result, count }, ingredients, width: ingredients.length <= 4 ? 2 : 3, height: Math.ceil(ingredients.length / (ingredients.length <= 4 ? 2 : 3)) });
const smelt = (input: string, result: string) => S.push({ id: `extra:smelt:${input}`, input, result, xp: 0.1, time: 10 });

// ---------- couleurs : béton, terre cuite, verre teinté, colorants ----------
const DYE_NAMES: Record<string, string> = { white: 'blanc', orange: 'orange', magenta: 'magenta', light_blue: 'bleu clair', yellow: 'jaune', lime: 'vert clair', pink: 'rose', gray: 'gris', light_gray: 'gris clair', cyan: 'cyan', purple: 'violet', blue: 'bleu', brown: 'marron', green: 'vert', red: 'rouge', black: 'noir' };
const DYE_FROM: Record<string, string> = { white: 'bone_meal', yellow: 'dandelion', red: 'poppy', blue: 'cornflower', light_gray: 'oxeye_daisy', black: 'ink_sac', brown: 'cocoa_beans', green: 'cactus', orange: 'orange_tulip', pink: 'pink_tulip', magenta: 'allium', light_blue: 'blue_orchid', purple: '', cyan: '', lime: '', gray: '' };
for (const [c, n, h] of WOOL_COLORS) {
  item(`${c}_dye`, `Colorant ${DYE_NAMES[c] ?? c}`, 'dust', [h, h]);
  cube(`${c}_concrete`, `Béton ${n}`, flat(h, 0.06), { hardness: 1.8, color: h });
  cube(`${c}_concrete_powder`, `Béton en poudre ${n}`, grainT([h, h, '#ffffff'].map((x, i) => (i === 2 ? x : x)), 0.2, 2), { hardness: 0.5, tool: 'shovel', minTier: 0, sound: 'sand', gravity: true, color: h });
  const tc = paint.mix(hex(h), hex('#a0624a'), 0.45);
  const tcHex = `#${tc.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  cube(`${c}_terracotta`, `Terre cuite ${n}`, flat(tcHex, 0.1), { hardness: 1.25, color: tcHex });
  tile(`${c}_stained_glass`, (t) => {
    t.clear();
    const col = hex(h);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, col, 110);
    t.border(paint.mul(col, 0.8), 220);
  });
  B.push({ key: `${c}_stained_glass`, name: `Verre ${n}`, textures: { all: `${c}_stained_glass` }, hardness: 0.3, render: 'translucent', sound: 'glass', drops: [], color: h });
  B.push({ key: `${c}_stained_glass_pane`, name: `Vitre ${n}`, textures: { all: `${c}_stained_glass` }, hardness: 0.3, render: 'model', shape: 'pane', sound: 'glass', drops: [], color: h });
  if (DYE_FROM[c]) shapeless(`${c}_dye`, `${c}_dye`, c === 'white' ? 1 : 1, [DYE_FROM[c]]);
  shaped(`${c}_concrete_powder`, `${c}_concrete_powder`, 8, ['SSS', 'SDS', 'GGG'], { S: 'sand', D: `${c}_dye`, G: 'gravel' });
  shaped(`${c}_terracotta`, `${c}_terracotta`, 8, ['TTT', 'TDT', 'TTT'], { T: 'terracotta', D: `${c}_dye` });
  shaped(`${c}_stained_glass`, `${c}_stained_glass`, 8, ['GGG', 'GDG', 'GGG'], { G: 'glass', D: `${c}_dye` });
  shaped(`${c}_stained_glass_pane`, `${c}_stained_glass_pane`, 16, ['GGG', 'GGG'], { G: `${c}_stained_glass` });
  if (c !== 'white') shapeless(`${c}_wool_dye`, `${c}_wool`, 1, ['white_wool', `${c}_dye`]);
}
shapeless('purple_dye', 'purple_dye', 2, ['blue_dye', 'red_dye']);
shapeless('cyan_dye', 'cyan_dye', 2, ['blue_dye', 'green_dye']);
shapeless('lime_dye', 'lime_dye', 2, ['green_dye', 'white_dye']);
shapeless('gray_dye', 'gray_dye', 2, ['black_dye', 'white_dye']);
cube('terracotta', 'Terre cuite', flat('#985e43', 0.1), { hardness: 1.25, color: '#985e43' });
smelt('clay', 'terracotta');

// ---------- bois supplémentaires ----------
const WOODS2: [string, string, string, string, string][] = [
  ['cherry', 'cerisier', '#e3b3ad', '#3b2129', '#e6a3c0'],
  ['mangrove', 'palétuvier', '#773934', '#4a3d2a', '#6a9a2e'],
  ['pale_oak', 'chêne pâle', '#e8dcd6', '#6a625c', '#8a9a88'],
  ['crimson', 'carmin', '#7e3a56', '#5c1e2e', '#b02020'],
  ['warped', 'biscornu', '#2b6963', '#3a3a5a', '#16a0a0'],
  ['bamboo', 'bambou', '#c9b44c', '#7f9a2a', '#7aaa30'],
];
for (const [w, n, plank, bark, leaf] of WOODS2) {
  const stem = w === 'crimson' || w === 'warped';
  tile(`${w}_planks`, (t) => void paint.planks(t, plank));
  B.push({ key: `${w}_planks`, name: `Planches de ${n}`, textures: { all: `${w}_planks` }, hardness: 2, tool: 'axe', flammable: !stem, sound: 'wood', color: plank });
  const log = stem ? `${w}_stem` : w === 'bamboo' ? 'bamboo_block' : `${w}_log`;
  tile(`${log}_side`, (t) => void paint.logSide(t, bark));
  tile(`${log}_top`, (t) => void paint.logTop(t, plank, bark));
  B.push({ key: log, name: stem ? `Tige de ${n}` : w === 'bamboo' ? 'Bloc de bambou' : `Bûche de ${n}`, textures: { top: `${log}_top`, bottom: `${log}_top`, side: `${log}_side` }, hardness: 2, tool: 'axe', flammable: !stem, sound: 'wood', color: bark });
  EXTRA_TAGS.planks.push(`${w}_planks`);
  EXTRA_TAGS.logs.push(log);
  shapeless(`${w}_planks`, `${w}_planks`, w === 'bamboo' ? 2 : 4, [log]);
  for (const [suffix, shape, nm] of [['stairs', 'stairs', 'Escalier'], ['slab', 'slab', 'Dalle'], ['fence', 'fence', 'Barrière']] as const)
    B.push({ key: `${w}_${suffix}`, name: `${nm} en ${n}`, textures: { all: `${w}_planks` }, hardness: 2, tool: 'axe', render: 'model', shape, sound: 'wood', color: plank });
  shaped(`${w}_stairs`, `${w}_stairs`, 4, ['P  ', 'PP ', 'PPP'], { P: `${w}_planks` });
  shaped(`${w}_slab`, `${w}_slab`, 6, ['PPP'], { P: `${w}_planks` });
  shaped(`${w}_fence`, `${w}_fence`, 3, ['PSP', 'PSP'], { P: `${w}_planks`, S: 'stick' });
  if (!stem && w !== 'bamboo') {
    tile(`${w}_leaves`, (t) => {
      paint.leaves(t, 0.2);
      // feuillage teinté à la couleur de l'essence (pas de teinte de biome)
      for (let i = 0; i < 256; i++) {
        const a = t.data[i * 4 + 3];
        if (!a) continue;
        const k = t.data[i * 4] / 160;
        const c = hex(leaf);
        t.data[i * 4] = c[0] * k;
        t.data[i * 4 + 1] = c[1] * k;
        t.data[i * 4 + 2] = c[2] * k;
        t.data[i * 4 + 3] = 255;
      }
    });
    B.push({ key: `${w}_leaves`, name: `Feuilles de ${n}`, textures: { all: `${w}_leaves` }, hardness: 0.2, tool: 'shears', render: 'cutout', flammable: true, sound: 'leaves', lightFilter: 1, sway: true, drops: [{ item: 'stick', chance: 0.05 }], color: leaf });
  }
}
for (const [k, n, c] of [['azalea_leaves', "Feuilles d'azalée", '#5a8a2a'], ['flowering_azalea_leaves', "Feuilles d'azalée fleurie", '#6a8a3a']] as const) {
  tile(k, (t) => {
    paint.leaves(t, 0.15);
    for (let i = 0; i < 256; i++) if (t.data[i * 4 + 3]) {
      const kk = t.data[i * 4] / 160, col = hex(c);
      t.data[i * 4] = col[0] * kk;
      t.data[i * 4 + 1] = col[1] * kk;
      t.data[i * 4 + 2] = col[2] * kk;
      t.data[i * 4 + 3] = 255;
    }
    if (k.startsWith('flowering')) t.speckle(hex('#e070c0'), 10);
  });
  B.push({ key: k, name: n, textures: { all: k }, hardness: 0.2, tool: 'shears', render: 'cutout', sound: 'leaves', lightFilter: 1, sway: true, drops: [], color: c });
}

// ---------- pierres et minéraux ----------
cube('deepslate', 'Ardoise des abîmes', grainT(['#3a3a40', '#46464c', '#505056', '#5a5a60'], 0.6, 4), { hardness: 3, drops: [{ item: 'cobbled_deepslate' }], color: '#4d4d52' });
cube('cobbled_deepslate', 'Ardoise des abîmes taillée', (t) => void paint.cobble(t, paint.ramp('#4a4a50', 5, 0.4)), { hardness: 3.5, color: '#4a4a50' });
cube('deepslate_bricks', "Briques d'ardoise des abîmes", (t) => void paint.bricksT(t, hex('#2c2c30'), paint.ramp('#505056', 4, 0.2), 8, 8), { hardness: 3.5, color: '#505056' });
cube('tuff', 'Tuf', grainT(['#5a5a52', '#6c6c62', '#7a7a70', '#86867a'], 0.5, 2), { color: '#6c6c62' });
cube('calcite', 'Calcite', grainT(['#d8d8d4', '#e0e0dc', '#e8e8e4', '#f0f0ec'], 0.4, 2), { hardness: 0.75, color: '#e0e0dc' });
cube('smooth_stone', 'Pierre lisse', flat('#9e9e9e', 0.1), { hardness: 2, color: '#9e9e9e' });
smelt('stone', 'smooth_stone');
for (const [k, n, c] of [['polished_granite', 'Granite poli', '#9a6c58'], ['polished_diorite', 'Diorite polie', '#c8c8c8'], ['polished_andesite', 'Andésite polie', '#888888']] as const) {
  cube(k, n, (t) => void paint.mineral(t, c, 'grain'), { color: c });
  shaped(k, k, 4, ['SS', 'SS'], { S: k.replace('polished_', '') });
}
cube('netherrack', 'Netherrack', grainT(['#5e2626', '#6e2c2c', '#7a3232', '#8a3a3a'], 0.3, 2), { hardness: 0.4, color: '#6e2c2c' });
cube('nether_bricks', 'Briques du Nether', (t) => void paint.bricksT(t, hex('#1e0e10'), paint.ramp('#3a1c20', 4, 0.25), 8, 4), { hardness: 2, color: '#3a1c20' });
cube('red_nether_bricks', 'Briques du Nether rouges', (t) => void paint.bricksT(t, hex('#2a0606'), paint.ramp('#5a0a0a', 4, 0.25), 8, 4), { hardness: 2, color: '#5a0a0a' });
cube('soul_sand', 'Sable des âmes', grainT(['#3a2c22', '#4a3a2c', '#5a4636', '#6a5442'], 0.3, 2), { hardness: 0.5, tool: 'shovel', minTier: 0, sound: 'sand', color: '#4a3a2c' });
cube('soul_soil', 'Terre des âmes', grainT(['#3a2c22', '#46362a', '#523f32'], 0.5, 4), { hardness: 0.5, tool: 'shovel', minTier: 0, sound: 'sand', color: '#46362a' });
cube('glowstone', 'Pierre lumineuse', grainT(['#8a6a30', '#c8962a', '#f0c050', '#ffe8a0'], 0.3, 2), { hardness: 0.3, minTier: 0, light: 15, sound: 'glass', drops: [{ item: 'glowstone_dust', min: 2, max: 4 }], color: '#f0c050' });
cube('magma', 'Bloc de magma', grainT(['#4a1a0a', '#8a2a0a', '#d0501a', '#f08a2a'], 0.4, 2), { hardness: 0.5, light: 3, contactDamage: 1, color: '#8a2a0a' });
cube('basalt', 'Basalte', grainT(['#3a3a3e', '#48484c', '#55555a', '#626266'], 0.7, 4), { hardness: 1.25, color: '#48484c' });
cube('blackstone', 'Roche noire', grainT(['#1e1a20', '#2a2430', '#363040', '#423a48'], 0.5, 2), { color: '#2a2430' });
cube('quartz_block', 'Bloc de quartz', (t) => void paint.mineral(t, '#ebe5de', 'grain'), { hardness: 0.8, color: '#ebe5de' });
cube('quartz_bricks', 'Briques de quartz', (t) => void paint.bricksT(t, hex('#c8c0b6'), paint.ramp('#ebe5de', 3, 0.1), 8, 8), { hardness: 0.8, color: '#ebe5de' });
cube('smooth_quartz', 'Quartz lisse', flat('#ebe5de', 0.05), { hardness: 2, color: '#ebe5de' });
cube('end_stone', "Pierre de l'End", grainT(['#cfcf96', '#dcdca4', '#e6e6ae', '#eeeebc'], 0.4, 2), { hardness: 3, color: '#dcdca4' });
cube('end_stone_bricks', "Briques de pierre de l'End", (t) => void paint.bricksT(t, hex('#b8b884'), paint.ramp('#e2e2aa', 3, 0.12), 8, 8), { hardness: 3, color: '#e2e2aa' });
cube('purpur_block', 'Bloc de purpur', (t) => void paint.bricksT(t, hex('#8a5a8a'), paint.ramp('#a87aa8', 3, 0.12), 8, 8), { hardness: 1.5, color: '#a87aa8' });
cube('prismarine', 'Prismarine', grainT(['#4a8a7a', '#5aa090', '#64aa9a', '#7ac0b0'], 0.4, 2), { color: '#5aa090' });
cube('dark_prismarine', 'Prismarine sombre', (t) => void paint.bricksT(t, hex('#244a3c'), paint.ramp('#346a58', 3, 0.15), 8, 8), { color: '#346a58' });
cube('sea_lantern', 'Lanterne aquatique', grainT(['#aac8c0', '#c8e0d8', '#e0f0e8', '#f8fffc'], 0.4, 2), { hardness: 0.3, minTier: 0, light: 15, sound: 'glass', color: '#e0f0e8' });
cube('red_sand', 'Sable rouge', grainT(['#a8521c', '#b85e22', '#c46a28', '#d07a34'], 0.3, 2), { hardness: 0.5, tool: 'shovel', minTier: 0, gravity: true, sound: 'sand', color: '#b85e22' });
cube('red_sandstone', 'Grès rouge', grainT(['#a8521c', '#b85e22', '#c46a28'], 0.6, 4), { hardness: 0.8, color: '#b85e22' });
cube('coarse_dirt', 'Terre stérile', grainT(['#5a3e2a', '#6a4a32', '#7a563a', '#8a6444'], 0.2, 2), { hardness: 0.5, tool: 'shovel', minTier: 0, sound: 'dirt', color: '#6a4a32' });
cube('packed_mud', 'Boue compactée', flat('#8a6a50', 0.12), { hardness: 1, tool: 'pickaxe', minTier: 0, sound: 'dirt', color: '#8a6a50' });
cube('mud_bricks', 'Briques de boue', (t) => void paint.bricksT(t, hex('#6a503a'), paint.ramp('#8a6a50', 3, 0.15), 8, 4), { color: '#8a6a50' });
cube('dripstone_block', 'Bloc de spéléothème', grainT(['#7a5e4a', '#866a54', '#927660', '#9e826c'], 0.7, 4), { color: '#866a54' });
cube('bone_block', "Bloc d'os", grainT(['#d8d4bc', '#e2dec6', '#ecead4'], 0.4, 4), { hardness: 2, color: '#e2dec6' });
cube('honeycomb_block', 'Bloc de rayon de miel', grainT(['#c08018', '#d89420', '#e8a830', '#f0c040'], 0.4, 2), { hardness: 0.6, minTier: 0, sound: 'wool', color: '#d89420' });
cube('slime_block', 'Bloc de slime', (t) => {
  t.clear();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex('#70c060'), 170);
  t.border(hex('#4a9a3a'), 230);
}, { hardness: 0, minTier: 0, render: 'translucent', sound: 'wool', color: '#70c060' });
for (const m of ['iron', 'gold', 'copper'] as const) {
  const c = { iron: '#d8af93', gold: '#e8b830', copper: '#b4684d' }[m];
  cube(`raw_${m}_block`, `Bloc de ${m === 'iron' ? 'fer' : m === 'gold' ? 'or' : 'cuivre'} brut`, (t) => void paint.mineral(t, c, 'grain'), { hardness: 5, color: c });
  shaped(`raw_${m}_block`, `raw_${m}_block`, 1, ['RRR', 'RRR', 'RRR'], { R: `raw_${m}` });
  shapeless(`raw_${m}_from_block`, `raw_${m}`, 9, [`raw_${m}_block`]);
}
for (const [k, n, c] of [['exposed_copper', 'Cuivre exposé', '#a87a62'], ['weathered_copper', 'Cuivre érodé', '#6a9a6a'], ['oxidized_copper', 'Cuivre oxydé', '#4aa08a'], ['cut_copper', 'Cuivre taillé', '#c06c50']] as const)
  cube(k, n, (t) => void paint.mineral(t, c, 'metal'), { hardness: 3, sound: 'metal', color: c });
shaped('cut_copper', 'cut_copper', 4, ['CC', 'CC'], { C: 'copper_block' });

// ---------- blocs de fonction (décoratifs dans cette version) ----------
const wood = (c: string): P => (t) => void paint.planks(t, c);
const face = (bg: string, fg: string): P => (t) => {
  paint.planks(t, bg);
  t.rect(4, 4, 8, 8, hex(fg));
  t.border(paint.mul(hex(bg), 0.6));
};
sided('noteblock', 'Bloc musical', wood('#7a4a2a'), face('#7a4a2a', '#3a2010'));
sided('jukebox', 'Juke-box', face('#7a4a2a', '#2a1a10'), wood('#6a3e22'));
sided('barrel', 'Tonneau', (t) => {
  paint.planks(t, '#8a6236');
  t.rect(5, 5, 6, 6, hex('#3a2a18'));
}, (t) => {
  paint.planks(t, '#7a5530');
  t.hline(0, 15, 3, hex('#4a4a4a'));
  t.hline(0, 15, 12, hex('#4a4a4a'));
});
sided('composter', 'Composteur', (t) => {
  paint.planks(t, '#8a6236');
  t.rect(2, 2, 12, 12, hex('#5a3e1e'));
}, wood('#8a6236'));
sided('cartography_table', 'Table de cartographie', face('#8a6236', '#e0d8b0'), wood('#5a3e22'));
sided('fletching_table', "Table d'archerie", face('#c8b070', '#8a6236'), wood('#c8b070'));
sided('smithing_table', 'Table de forgeron', (t) => void paint.mineral(t, '#2a2a30', 'metal'), wood('#5a3e22'), { tool: 'axe' });
sided('loom', 'Métier à tisser', face('#c8a070', '#e8e0d0'), wood('#a8805a'));
sided('lectern', 'Pupitre', face('#a07a4a', '#e8e0c8'), wood('#a07a4a'));
sided('grindstone', 'Meule', (t) => void paint.stone(t, paint.ramp('#8a8a8a', 5, 0.3)), wood('#6a4a2a'), { tool: 'pickaxe', sound: 'stone' });
sided('carved_pumpkin', 'Citrouille taillée', (t) => void t.grain(paint.ramp('#e38a1d', 4, 0.2), 0.5, 4), (t) => {
  t.grain(paint.ramp('#e38a1d', 4, 0.2), 0.5, 4);
  t.rect(3, 4, 3, 3, hex('#2a1a00'));
  t.rect(10, 4, 3, 3, hex('#2a1a00'));
  t.rect(4, 10, 8, 2, hex('#2a1a00'));
});
sided('jack_o_lantern', "Citrouille-lanterne", (t) => void t.grain(paint.ramp('#e38a1d', 4, 0.2), 0.5, 4), (t) => {
  t.grain(paint.ramp('#e38a1d', 4, 0.2), 0.5, 4);
  t.rect(3, 4, 3, 3, hex('#ffe060'));
  t.rect(10, 4, 3, 3, hex('#ffe060'));
  t.rect(4, 10, 8, 2, hex('#ffe060'));
}, { light: 15 });
sided('campfire', 'Feu de camp', (t) => {
  paint.logSide(t, '#5a3e22');
  t.speckle(hex('#ffb030'), 18);
}, (t) => {
  paint.logSide(t, '#5a3e22');
  t.rect(2, 2, 12, 6, hex('#ff8a20'));
  t.speckle(hex('#ffe060'), 10);
}, { light: 15, solid: true });
shaped('campfire', 'campfire', 1, [' S ', 'SCS', 'LLL'], { S: 'stick', C: 'tag:coals', L: 'tag:logs' });
shaped('barrel', 'barrel', 1, ['PSP', 'P P', 'PSP'], { P: 'tag:planks', S: 'oak_slab' });
shaped('composter', 'composter', 1, ['S S', 'S S', 'SSS'], { S: 'oak_slab' });
shaped('noteblock', 'noteblock', 1, ['PPP', 'PRP', 'PPP'], { P: 'tag:planks', R: 'redstone' });
shaped('jukebox', 'jukebox', 1, ['PPP', 'PDP', 'PPP'], { P: 'tag:planks', D: 'diamond' });
shaped('cartography_table', 'cartography_table', 1, ['AA', 'PP', 'PP'], { A: 'paper', P: 'tag:planks' });
shaped('fletching_table', 'fletching_table', 1, ['FF', 'PP', 'PP'], { F: 'flint', P: 'tag:planks' });
shaped('smithing_table', 'smithing_table', 1, ['II', 'PP', 'PP'], { I: 'iron_ingot', P: 'tag:planks' });
shaped('loom', 'loom', 1, ['SS', 'PP'], { S: 'string', P: 'tag:planks' });
shaped('lectern', 'lectern', 1, ['SSS', ' B ', ' S '], { S: 'oak_slab', B: 'bookshelf' });
shaped('jack_o_lantern', 'jack_o_lantern', 1, ['P', 'T'], { P: 'carved_pumpkin', T: 'torch' });
shaped('quartz_block', 'quartz_block', 1, ['QQ', 'QQ'], { Q: 'quartz' });
shaped('quartz_bricks', 'quartz_bricks', 4, ['QQ', 'QQ'], { Q: 'quartz_block' });
shaped('glowstone', 'glowstone', 1, ['GG', 'GG'], { G: 'glowstone_dust' });
shaped('bone_block', 'bone_block', 1, ['BBB', 'BBB', 'BBB'], { B: 'bone_meal' });
shaped('honeycomb_block', 'honeycomb_block', 1, ['HH', 'HH'], { H: 'honeycomb' });
shaped('slime_block', 'slime_block', 1, ['SSS', 'SSS', 'SSS'], { S: 'slime_ball' });
shaped('deepslate_bricks', 'deepslate_bricks', 4, ['DD', 'DD'], { D: 'cobbled_deepslate' });
shaped('end_stone_bricks', 'end_stone_bricks', 4, ['EE', 'EE'], { E: 'end_stone' });
shaped('mud_bricks', 'mud_bricks', 4, ['MM', 'MM'], { M: 'packed_mud' });
shapeless('packed_mud', 'packed_mud', 1, ['mud', 'wheat']);
shaped('nether_bricks', 'nether_bricks', 1, ['NN', 'NN'], { N: 'nether_brick' });
smelt('netherrack', 'nether_brick');
smelt('cobbled_deepslate', 'deepslate');
smelt('quartz_block', 'smooth_quartz');
shaped('iron_bars', 'iron_bars', 16, ['III', 'III'], { I: 'iron_ingot' });
B.push({ key: 'iron_bars', name: 'Barreaux de fer', textures: { all: 'iron_bars' }, hardness: 5, tool: 'pickaxe', render: 'model', shape: 'pane', sound: 'metal', color: '#8a8a8a' });
tile('iron_bars', (t) => {
  t.clear();
  for (const x of [1, 6, 10, 14]) t.vline(x, 0, 15, hex('#6a6a6a'));
  t.hline(0, 15, 1, hex('#8a8a8a'));
  t.hline(0, 15, 14, hex('#8a8a8a'));
});

cube('nether_wart_block', 'Bloc de verrues du Nether', grainT(['#6a0a0a', '#8a1010', '#a01818'], 0.4, 2), { hardness: 1, tool: 'hoe', minTier: 0, sound: 'wool', color: '#8a1010' });
cube('warped_wart_block', 'Bloc de verrues biscornues', grainT(['#0a6a6a', '#108a80', '#18a098'], 0.4, 2), { hardness: 1, tool: 'hoe', minTier: 0, sound: 'wool', color: '#108a80' });
shaped('nether_wart_block', 'nether_wart_block', 1, ['WWW', 'WWW', 'WWW'], { W: 'nether_wart' });
for (const [k, n] of [['brick', 'briques'], ['nether_brick', 'briques du Nether'], ['quartz', 'quartz'], ['deepslate_brick', "briques d'ardoise"]] as const) {
  const tex = k === 'brick' ? 'bricks' : k === 'nether_brick' ? 'nether_bricks' : k === 'quartz' ? 'quartz_block' : 'deepslate_bricks';
  B.push({ key: `${k}_slab`, name: `Dalle en ${n}`, textures: { all: tex }, hardness: 2, tool: 'pickaxe', minTier: 1, render: 'model', shape: 'slab', sound: 'stone' });
  B.push({ key: `${k}_stairs`, name: `Escalier en ${n}`, textures: { all: tex }, hardness: 2, tool: 'pickaxe', minTier: 1, render: 'model', shape: 'stairs', sound: 'stone' });
  shaped(`${k}_slab`, `${k}_slab`, 6, ['BBB'], { B: tex });
  shaped(`${k}_stairs`, `${k}_stairs`, 4, ['B  ', 'BB ', 'BBB'], { B: tex });
}
for (const [k, n, flame, light] of [['soul_torch', 'Torche des âmes', '#60e0f0', 10], ['copper_torch', 'Torche en cuivre', '#80f0a0', 14]] as const) {
  tile(k, (t) => {
    t.clear();
    t.rect(7, 6, 2, 10, hex('#6a4a2a'));
    t.rect(7, 4, 2, 2, hex(flame));
    t.set(7, 3, hex('#ffffff'));
  });
  B.push({ key: k, name: n, textures: { all: k }, hardness: 0, render: 'model', shape: 'torch', solid: false, light, sound: 'wood', needsSupport: true, color: flame });
}
shaped('soul_torch', 'soul_torch', 4, ['C', 'S', 'D'], { C: 'tag:coals', S: 'stick', D: 'soul_sand' });
shaped('copper_torch', 'copper_torch', 4, ['N', 'C', 'S'], { N: 'copper_nugget', C: 'tag:coals', S: 'stick' });

// ---------- fleurs ----------
const flower = (key: string, name: string, petal: string, center = '#f0d040') => {
  tile(key, (t) => void paint.flowerT(t, hex(petal), hex(center)));
  B.push({ key, name, textures: { all: key }, hardness: 0, render: 'cross', replaceable: false, sway: true, sound: 'grass', needsSupport: true, supportBlocks: ['grass_block', 'dirt', 'podzol', 'moss_block', 'farmland'], color: petal });
};
flower('allium', 'Allium', '#b070e0');
flower('azure_bluet', 'Houstonie bleue', '#e8eef8');
flower('blue_orchid', 'Orchidée bleue', '#2aa8e8');
flower('red_tulip', 'Tulipe rouge', '#d8301a', '#2a8a1a');
flower('orange_tulip', 'Tulipe orange', '#f08a1a', '#2a8a1a');
flower('white_tulip', 'Tulipe blanche', '#f0f0f0', '#2a8a1a');
flower('pink_tulip', 'Tulipe rose', '#f0a0c0', '#2a8a1a');
flower('lily_of_the_valley', 'Muguet', '#ffffff', '#e8e8e8');
flower('wither_rose', 'Rose de Wither', '#1a1a1a', '#3a3a3a');
flower('torchflower', 'Torche-fleur', '#f0a020', '#c03010');
tile('azalea', (t) => void paint.sapling(t, hex('#5a8a2a'), hex('#5a4a2a')));
B.push({ key: 'azalea', name: 'Azalée', textures: { all: 'azalea' }, hardness: 0, render: 'cross', sway: true, sound: 'grass', needsSupport: true, color: '#5a8a2a' });

// ---------- objets ----------
item('honeycomb', 'Rayon de miel', 'gem', ['#e8a830', '#f8d060']);
item('quartz', 'Quartz du Nether', 'gem', ['#e8e2da', '#ffffff']);
item('blaze_rod', 'Bâton de blaze', 'stick', ['#f0b020', '#ffe060']);
item('blaze_powder', 'Poudre de blaze', 'dust', ['#f0a020', '#ffd040']);
item('ink_sac', "Poche d'encre", 'lump', ['#1a1a24', '#3a3a4a']);
item('glow_ink_sac', "Poche d'encre lumineuse", 'lump', ['#2a8a8a', '#7af0e0']);
item('cocoa_beans', 'Fèves de cacao', 'seeds', ['#6a3a1a', '#8a5a2a']);
item('sweet_berries', 'Baies sucrées', 'ball', ['#c01a2a', '#e04a4a'], { food: { hunger: 2, saturation: 0.4 }, tab: 'food' });
item('glow_berries', 'Baies lumineuses', 'ball', ['#f0a020', '#ffe060'], { food: { hunger: 2, saturation: 0.4 }, tab: 'food' });
item('bowl', 'Bol', 'lump', ['#8a6236', '#a87a4a']);
item('mushroom_stew', 'Ragoût de champignons', 'lump', ['#8a6236', '#c8a070'], { food: { hunger: 6, saturation: 7.2 }, maxStack: 1, tab: 'food' });
item('nether_wart', 'Verrue du Nether', 'seeds', ['#8a1a1a', '#c02a2a']);
item('nether_brick', 'Brique du Nether', 'ingot', ['#3a1c20', '#5a2c30']);
item('glowstone_dust', 'Poudre lumineuse', 'dust', ['#d8a030', '#ffe080']);
item('ender_pearl', "Perle de l'Ender", 'ball', ['#1a6a5a', '#2aaa8a'], { maxStack: 16 });
item('ender_eye', "Œil de l'Ender", 'eye', ['#2a8a5a', '#b0f0a0']);
item('ghast_tear', 'Larme de ghast', 'gem', ['#d8e8f0', '#ffffff']);
item('magma_cream', 'Crème de magma', 'ball', ['#c05010', '#f0a020']);
item('phantom_membrane', 'Membrane de phantom', 'leather', ['#c8c0a8', '#e8e0d0']);
item('prismarine_shard', 'Éclat de prismarine', 'gem', ['#4a8a7a', '#7ac0b0']);
item('prismarine_crystals', 'Cristaux de prismarine', 'gem', ['#a8d8c8', '#e8fff8']);
item('nautilus_shell', 'Coquille de nautile', 'lump', ['#e0d0c0', '#f8f0e8']);
item('heart_of_the_sea', 'Cœur de la mer', 'gem', ['#1a5aa0', '#4aa0f0']);
item('copper_nugget', 'Pépite de cuivre', 'nugget', ['#c06c50', '#e09070']);
item('netherite_scrap', 'Fragment de netherite', 'lump', ['#4a3a34', '#6a5a50']);
item('netherite_ingot', 'Lingot de netherite', 'ingot', ['#3a3434', '#5a5050']);
item('echo_shard', "Éclat d'écho", 'gem', ['#0a3a4a', '#2a8aa0']);
item('rabbit_hide', 'Peau de lapin', 'leather', ['#a88060', '#c8a080']);
item('totem_of_undying', "Totem d'immortalité", 'relic', ['#e8c040', '#40a060'], { maxStack: 1 });
item('name_tag', 'Étiquette', 'paper', ['#d8d0c0', '#8a6a4a']);
item('saddle', 'Selle', 'leather', ['#8a5a32', '#5a3a1a'], { maxStack: 1 });
item('lead', 'Laisse', 'string', ['#c8a070', '#8a6a4a']);
item('glass_bottle', 'Fiole', 'lump', ['#c8e6f0', '#ffffff']);
item('experience_bottle', "Fiole d'expérience", 'lump', ['#a0e060', '#e0ff90']);
item('glistering_melon_slice', 'Tranche de pastèque scintillante', 'slice', ['#f0d040', '#e05040']);
item('golden_carrot', 'Carotte dorée', 'carrot', ['#f0c030', '#ffe060'], { food: { hunger: 6, saturation: 14.4 }, tab: 'food' });
item('cookie', 'Cookie', 'bread', ['#b8783a', '#5a3a1a'], { food: { hunger: 2, saturation: 0.4 }, tab: 'food' });
item('pumpkin_pie', 'Tarte à la citrouille', 'bread', ['#e38a1d', '#f0c070'], { food: { hunger: 8, saturation: 4.8 }, tab: 'food' });
item('beetroot', 'Betterave', 'carrot', ['#8a1a3a', '#c02a5a'], { food: { hunger: 1, saturation: 1.2 }, tab: 'food' });
item('beetroot_seeds', 'Graines de betterave', 'seeds', ['#a85a3a', '#c87a5a']);
item('pumpkin_seeds', 'Graines de citrouille', 'seeds', ['#e0d0a0', '#f0e8c8']);
item('melon_seeds', 'Graines de pastèque', 'seeds', ['#2a1a0a', '#4a3a1a']);
item('wind_charge', 'Charge de vent', 'ball', ['#c8f0ff', '#ffffff']);
item('breeze_rod', 'Bâton de breeze', 'stick', ['#a0c8f0', '#e0f0ff']);
item('nether_star', 'Étoile du Nether', 'gem', ['#e8e8f0', '#ffffff']);
item('dragon_breath', 'Souffle de dragon', 'lump', ['#c040ff', '#f0a0ff']);
item('clock', 'Montre', 'compass', ['#f0c030', '#8a6a1a']);
item('trident', 'Trident', 'stick', ['#3aa098', '#8ae0d8'], { maxStack: 1, damage: 9, tab: 'combat' });
item('shield', 'Bouclier', 'leather', ['#8a6236', '#a0a0a0'], { maxStack: 1, tab: 'combat' });
item('fire_charge', 'Boule de feu', 'ball', ['#3a2a1a', '#f08a20']);
shaped('bowl', 'bowl', 4, ['P P', ' P '], { P: 'tag:planks' });
shapeless('mushroom_stew', 'mushroom_stew', 1, ['brown_mushroom', 'red_mushroom', 'bowl']);
shapeless('blaze_powder', 'blaze_powder', 2, ['blaze_rod']);
shapeless('magma_cream', 'magma_cream', 1, ['blaze_powder', 'slime_ball']);
shapeless('ender_eye', 'ender_eye', 1, ['ender_pearl', 'blaze_powder']);
shaped('copper_ingot_from_nuggets', 'copper_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'copper_nugget' });
shapeless('copper_nugget', 'copper_nugget', 9, ['copper_ingot']);
shaped('glistering_melon_slice', 'glistering_melon_slice', 1, ['NNN', 'NMN', 'NNN'], { N: 'gold_nugget', M: 'melon_slice' });
shaped('golden_carrot', 'golden_carrot', 1, ['NNN', 'NCN', 'NNN'], { N: 'gold_nugget', C: 'carrot' });
shaped('cookie', 'cookie', 8, ['WCW'], { W: 'wheat', C: 'cocoa_beans' });
shapeless('pumpkin_pie', 'pumpkin_pie', 1, ['pumpkin', 'sugar', 'egg']);
shapeless('pumpkin_seeds', 'pumpkin_seeds', 4, ['pumpkin']);
shapeless('melon_seeds', 'melon_seeds', 1, ['melon_slice']);
shaped('glass_bottle', 'glass_bottle', 3, ['G G', ' G '], { G: 'glass' });
shaped('lead', 'lead', 2, ['SS ', 'SB ', '  S'], { S: 'string', B: 'slime_ball' });
shaped('clock', 'clock', 1, [' G ', 'GRG', ' G '], { G: 'gold_ingot', R: 'redstone' });
shaped('shield', 'shield', 1, ['PIP', 'PPP', ' P '], { P: 'tag:planks', I: 'iron_ingot' });
shapeless('netherite_ingot', 'netherite_ingot', 1, ['netherite_scrap', 'netherite_scrap', 'netherite_scrap', 'netherite_scrap', 'gold_ingot', 'gold_ingot', 'gold_ingot', 'gold_ingot']);
shaped('carved_pumpkin_from', 'carved_pumpkin', 1, ['P'], { P: 'pumpkin' });

export const EXTRA_BLOCKS: BlockDef[] = B;
export const EXTRA_ITEMS: ItemDef[] = I;
export const EXTRA_RECIPES = R;
export const EXTRA_SMELTING = S;
