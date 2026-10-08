/**
 * Palette élargie (v2.19) : la plupart des blocs de construction du jeu de référence qui
 * manquaient (escaliers, dalles et murets de toutes les pierres, bûches écorcées et bois,
 * tapis, terre cuite émaillée, coraux, champignons géants, sculk, lanternes de grenouille…),
 * objets des nouvelles créatures (poissons, lapin, écailles…), outils et armures en netherite
 * et en mailles, marteaux (minage 3×3) et excavateurs (pelletage 3×3), œufs d'apparition.
 *
 * Textures et icônes générées (aucune ressource du jeu de référence n'est incluse). Les
 * identifiants numériques sont attribués comme ceux des autres blocs supplémentaires.
 */
import type { BlockDef } from '../blocks/Block';
import type { ItemDef } from '../inventory/Item';
import type { CraftingRecipe, SmeltingRecipe } from '../crafting/Recipe';
import { WOOL_COLORS } from './blocks';
import { MOB_DEFS } from './mobs';
import { hex, registerPainter, paint, type Tile } from '../render/TextureGenerator';

const B: BlockDef[] = [];
const I: ItemDef[] = [];
const R: CraftingRecipe[] = [];
const S: SmeltingRecipe[] = [];

type P = (t: Tile) => void;
const tile = (name: string, fn: P) => registerPainter(name, fn);
const grainT = (colors: string[], w = 0.5, s = 4): P => (t) => void t.grain(colors.map(hex), w, s);
const flat = (base: string, spread = 0.12): P => (t) => void t.grain(paint.ramp(base, 4, spread), 0.4, 4);
const shaped = (id: string, result: string, count: number, pattern: string[], key: Record<string, string>) =>
  R.push({ id: `more:${id}`, type: 'shaped', result: { item: result, count }, pattern, key, width: Math.max(...pattern.map((p) => p.length)), height: pattern.length });
const shapeless = (id: string, result: string, count: number, ingredients: string[]) =>
  R.push({ id: `more:${id}`, type: 'shapeless', result: { item: result, count }, ingredients, width: ingredients.length <= 4 ? 2 : 3, height: Math.ceil(ingredients.length / (ingredients.length <= 4 ? 2 : 3)) });
const smelt = (input: string, result: string, xp = 0.1) => S.push({ id: `more:smelt:${input}`, input, result, xp, time: 10 });
const item = (key: string, name: string, sprite: string, colors: string[], o: Partial<ItemDef> = {}) => I.push({ key, name, icon: { sprite, colors }, tab: 'ingredients', ...o });

function cube(key: string, name: string, painter: P | null, o: Partial<BlockDef> = {}) {
  if (painter) tile(key, painter);
  B.push({ key, name, textures: { all: key }, hardness: 1.5, tool: 'pickaxe', minTier: 1, sound: 'stone', ...o });
}
const shade = (c: string, k: number) => '#' + hex(c).slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('');

// ---------- nouvelles pierres décoratives (textures) ----------
cube('polished_deepslate', 'Ardoise des abîmes polie', flat('#4a4a50', 0.08), { hardness: 3.5, color: '#4a4a50' });
cube('deepslate_tiles', "Carreaux d'ardoise des abîmes", (t) => void paint.bricksT(t, hex('#232327'), paint.ramp('#3c3c42', 4, 0.2), 4, 4), { hardness: 3.5, color: '#3c3c42' });
cube('chiseled_deepslate', 'Ardoise des abîmes sculptée', (t) => { t.grain(paint.ramp('#46464c', 4, 0.15), 0.4, 4); t.border(hex('#2a2a2e')); t.rect(4, 4, 8, 8, hex('#36363a')); t.rect(6, 6, 4, 4, hex('#505056')); }, { hardness: 3.5, color: '#46464c' });
cube('cracked_deepslate_bricks', "Briques d'ardoise des abîmes craquelées", (t) => { paint.bricksT(t, hex('#2c2c30'), paint.ramp('#4a4a50', 4, 0.2), 8, 8); for (let i = 0; i < 6; i++) t.set(3 + i, 5 + (i % 3), hex('#202024')); }, { hardness: 3.5, color: '#4a4a50' });
cube('reinforced_deepslate', 'Ardoise des abîmes renforcée', (t) => { t.grain(paint.ramp('#3a3a40', 4, 0.2), 0.5, 4); t.border(hex('#c8b890')); t.rect(5, 5, 6, 6, hex('#2a2a2e')); }, { hardness: -1, color: '#3a3a40' });
cube('polished_blackstone', 'Pierre noire polie', flat('#35303a', 0.08), { hardness: 2, color: '#35303a' });
cube('polished_blackstone_bricks', 'Briques de pierre noire polie', (t) => void paint.bricksT(t, hex('#1e1a22'), paint.ramp('#3a3440', 4, 0.2), 8, 4), { hardness: 1.5, color: '#3a3440' });
cube('chiseled_polished_blackstone', 'Pierre noire polie sculptée', (t) => { t.grain(paint.ramp('#3a3440', 4, 0.15), 0.4, 4); t.border(hex('#1e1a22')); t.rect(5, 3, 6, 10, hex('#2a2430')); }, { hardness: 1.5, color: '#3a3440' });
cube('gilded_blackstone', 'Pierre noire dorée', (t) => { t.grain(paint.ramp('#2e2a32', 4, 0.3), 0.5, 4); t.speckle(hex('#f0c030'), 18, 1); }, { hardness: 1.5, color: '#2e2a32' });
cube('crying_obsidian', 'Obsidienne pleureuse', (t) => { t.grain(['#14081e', '#200c30', '#2a1040'].map(hex), 0.5, 4); t.speckle(hex('#a040ff'), 14, 1); }, { hardness: 50, minTier: 4, light: 10, color: '#200c30' });
cube('netherite_block', 'Bloc de netherite', (t) => void paint.mineral(t, '#3a3436', 'metal'), { hardness: 50, minTier: 4, sound: 'metal', color: '#3a3436' });
cube('polished_basalt', 'Basalte poli', (t) => { t.grain(paint.ramp('#5a5a62', 4, 0.15), 0.3, 2); for (let x = 0; x < 16; x += 4) t.vline(x, 0, 15, hex('#45454c')); }, { hardness: 1.25, color: '#5a5a62' });
cube('smooth_sandstone', 'Grès lisse', flat('#dbcf9f', 0.06), { hardness: 2, color: '#dbcf9f' });
cube('cut_sandstone', 'Grès taillé', (t) => { t.grain(paint.ramp('#d8cb9b', 4, 0.1), 0.3, 2); t.hline(0, 15, 0, hex('#c4b684')); t.hline(0, 15, 15, hex('#c4b684')); t.hline(0, 15, 7, hex('#c8ba88')); }, { hardness: 0.8, color: '#d8cb9b' });
cube('chiseled_sandstone', 'Grès sculpté', (t) => { t.grain(paint.ramp('#d8cb9b', 4, 0.1), 0.3, 2); t.border(hex('#c4b684')); t.rect(5, 5, 6, 6, hex('#b8a874')); t.rect(6, 6, 4, 4, hex('#d8cb9b')); }, { hardness: 0.8, color: '#d8cb9b' });
cube('smooth_red_sandstone', 'Grès rouge lisse', flat('#b8622a', 0.06), { hardness: 2, color: '#b8622a' });
cube('cut_red_sandstone', 'Grès rouge taillé', (t) => { t.grain(paint.ramp('#b8622a', 4, 0.1), 0.3, 2); t.hline(0, 15, 0, hex('#9a5020')); t.hline(0, 15, 15, hex('#9a5020')); }, { hardness: 0.8, color: '#b8622a' });
cube('chiseled_stone_bricks', 'Pierres taillées sculptées', (t) => { t.grain(paint.ramp('#7a7a7a', 4, 0.15), 0.4, 4); t.border(hex('#5a5a5a')); t.rect(4, 4, 8, 8, hex('#6a6a6a')); t.rect(6, 6, 4, 4, hex('#8a8a8a')); }, { hardness: 1.5, color: '#7a7a7a' });
cube('chiseled_quartz_block', 'Bloc de quartz sculpté', (t) => { t.grain(paint.ramp('#ece6df', 4, 0.06), 0.3, 2); t.border(hex('#d0c8bc')); t.rect(4, 4, 8, 8, hex('#ddd6cc')); }, { hardness: 0.8, color: '#ece6df' });
cube('quartz_pillar', 'Pilier de quartz', (t) => { t.grain(paint.ramp('#ece6df', 4, 0.06), 0.3, 2); t.vline(1, 0, 15, hex('#d0c8bc')); t.vline(14, 0, 15, hex('#d0c8bc')); }, { hardness: 0.8, color: '#ece6df' });
cube('chiseled_nether_bricks', 'Briques du Nether sculptées', (t) => { t.grain(paint.ramp('#2c1418', 4, 0.2), 0.4, 4); t.border(hex('#1a0a0c')); t.rect(5, 5, 6, 6, hex('#3a1c20')); }, { hardness: 2, color: '#2c1418' });
cube('cracked_nether_bricks', 'Briques du Nether craquelées', (t) => { paint.bricksT(t, hex('#1a0a0c'), paint.ramp('#3a1c20', 4, 0.2), 8, 4); for (let i = 0; i < 5; i++) t.set(4 + i, 6 + (i % 2), hex('#100406')); }, { hardness: 2, color: '#3a1c20' });
cube('polished_tuff', 'Tuf poli', flat('#6c6c62', 0.06), { color: '#6c6c62' });
cube('tuff_bricks', 'Briques de tuf', (t) => void paint.bricksT(t, hex('#4a4a42'), paint.ramp('#6c6c62', 4, 0.2), 8, 4), { color: '#6c6c62' });
cube('chiseled_tuff', 'Tuf sculpté', (t) => { t.grain(paint.ramp('#6c6c62', 4, 0.15), 0.4, 4); t.hline(0, 15, 5, hex('#4a4a42')); t.hline(0, 15, 10, hex('#4a4a42')); }, { color: '#6c6c62' });
cube('chiseled_copper', 'Cuivre sculpté', (t) => { paint.mineral(t, '#c06c50', 'metal'); t.border(hex('#8a4a34')); t.rect(5, 5, 6, 6, hex('#a85a40')); }, { hardness: 3, sound: 'metal', color: '#c06c50' });
cube('copper_grate', 'Grille en cuivre', (t) => { t.clear(); const c = paint.ramp('#c06c50', 3, 0.3); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (x % 4 === 0 || y % 4 === 0) t.set(x, y, c[(x + y) % 3]); }, { hardness: 3, sound: 'metal', render: 'cutout', color: '#c06c50' });
for (const [k, n, c] of [['exposed', 'exposé', '#a87a62'], ['weathered', 'érodé', '#6a9a6a'], ['oxidized', 'oxydé', '#52a28a']] as const) {
  cube(`${k}_cut_copper`, `Cuivre taillé ${n}`, (t) => void paint.bricksT(t, hex(shade(c, 0.7)), paint.ramp(c, 4, 0.2), 8, 8), { hardness: 3, sound: 'metal', color: c });
  cube(`${k}_chiseled_copper`, `Cuivre sculpté ${n}`, (t) => { paint.mineral(t, c, 'metal'); t.border(hex(shade(c, 0.7))); t.rect(5, 5, 6, 6, hex(shade(c, 0.85))); }, { hardness: 3, sound: 'metal', color: c });
}
cube('mossy_stone_brick_block', 'Briques de pierre très moussues', (t) => { paint.bricksT(t, hex('#4a4a4a'), paint.ramp('#6e7c62', 4, 0.25), 8, 4); t.speckle(hex('#4a7a2a'), 20, 1); }, { hardness: 1.5, color: '#6e7c62' });
cube('mud_bricks_chiseled', 'Briques de boue sculptées', (t) => { t.grain(paint.ramp('#8a6a50', 4, 0.15), 0.4, 4); t.border(hex('#6a4a34')); }, { hardness: 1.5, color: '#8a6a50' });
cube('blue_ice', 'Glace bleue', grainT(['#74a8f0', '#80b4f8', '#6aa0e8', '#8abcff'], 0.4, 4), { hardness: 2.8, tool: 'pickaxe', minTier: 0, sound: 'glass', slippery: true, drops: [], color: '#74a8f0' });
cube('lodestone', 'Magnétite', (t) => { t.grain(paint.ramp('#8a8a8e', 4, 0.15), 0.4, 4); t.rect(3, 3, 10, 10, hex('#5a5a60')); t.rect(6, 6, 4, 4, hex('#c0c0c8')); }, { hardness: 3.5, sound: 'metal', color: '#8a8a8e' });
cube('target', 'Cible', (t) => { t.grain(['#e8e0d0', '#f0e8d8'].map(hex), 0.3, 2); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 2 || (d > 4 && d < 6)) t.set(x, y, hex('#d02020')); } }, { hardness: 0.5, tool: 'hoe', minTier: 0, sound: 'grass', color: '#e8e0d0' });
cube('sponge', 'Éponge', (t) => { t.grain(['#d8d040', '#c8c030', '#e0d850'].map(hex), 0.4, 2); t.speckle(hex('#a8a020'), 24, 1); }, { hardness: 0.6, tool: 'hoe', minTier: 0, sound: 'grass', color: '#d8d040' });
cube('wet_sponge', 'Éponge mouillée', (t) => { t.grain(['#a8a830', '#989820', '#b0b038'].map(hex), 0.4, 2); t.speckle(hex('#4a7aa0'), 24, 1); }, { hardness: 0.6, tool: 'hoe', minTier: 0, sound: 'grass', color: '#a8a830' });
cube('dried_kelp_block', 'Bloc d’algues séchées', (t) => { t.grain(['#3a4a2a', '#2e3e22', '#46562e'].map(hex), 0.5, 2); for (let y = 2; y < 16; y += 4) t.hline(0, 15, y, hex('#24301a')); }, { hardness: 0.5, tool: 'hoe', minTier: 0, sound: 'grass', color: '#3a4a2a' });
cube('honey_block', 'Bloc de miel', (t) => { t.grain(['#f0a020', '#f8b030', '#e89818'].map(hex), 0.3, 2); t.border(hex('#c87810')); }, { hardness: 0, tool: undefined, minTier: 0, render: 'translucent', sound: 'snow', friction: 0.4, color: '#f0a020' });
cube('mycelium', 'Mycélium', (t) => { t.grain(['#6a5a6a', '#7a6a7a', '#5a4a5a', '#8a7a8a'].map(hex), 0.5, 2); t.speckle(hex('#a898b0'), 18, 1); }, { hardness: 0.6, tool: 'shovel', minTier: 0, sound: 'grass', drops: [{ item: 'dirt' }], color: '#6a5a6a' });
cube('tinted_glass', 'Verre teinté', (t) => { t.clear(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex('#2a2430'), 200); t.border(hex('#3a3440')); }, { hardness: 0.3, minTier: 0, render: 'translucent', sound: 'glass', lightFilter: 15, color: '#2a2430' });
cube('chiseled_bookshelf', 'Bibliothèque sculptée', (t) => { paint.planks(t, '#b8945f'); t.rect(1, 1, 14, 6, hex('#3a2a1a')); t.rect(1, 9, 14, 6, hex('#3a2a1a')); for (const x of [2, 6, 10]) { t.rect(x, 2, 3, 5, hex('#8a2a2a')); t.rect(x, 10, 3, 5, hex('#2a4a8a')); } }, { hardness: 1.5, tool: 'axe', minTier: 0, sound: 'wood', color: '#b8945f' });
cube('sculk', 'Sculk', (t) => { t.grain(['#0a1a24', '#0e2430', '#08141c'].map(hex), 0.5, 2); t.speckle(hex('#1aa0b0'), 10, 1); }, { hardness: 0.2, tool: 'hoe', minTier: 0, sound: 'wool', color: '#0a1a24' });
cube('sculk_catalyst', 'Catalyseur de sculk', (t) => { t.grain(['#0a1a24', '#0e2430'].map(hex), 0.5, 2); t.border(hex('#d8d8c0')); t.rect(5, 5, 6, 6, hex('#30d0e0')); }, { hardness: 3, tool: 'hoe', minTier: 0, light: 6, sound: 'wool', color: '#0e2430' });
cube('sculk_shrieker', 'Hurleur de sculk', (t) => { t.grain(['#0a1a24', '#0e2430'].map(hex), 0.5, 2); t.rect(3, 3, 10, 10, hex('#d8d8c0')); t.rect(5, 5, 6, 6, hex('#0a1a24')); }, { hardness: 3, tool: 'hoe', minTier: 0, sound: 'wool', color: '#0e2430' });
cube('sculk_sensor', 'Capteur de sculk', (t) => { t.grain(['#0e3040', '#103848'].map(hex), 0.5, 2); for (const x of [3, 7, 11]) t.rect(x, 2, 2, 4, hex('#30d0e0')); }, { hardness: 1.5, tool: 'hoe', minTier: 0, light: 1, sound: 'wool', color: '#0e3040' });
for (const [k, n, c] of [['ochre', 'ocre', '#f0d890'], ['verdant', 'verdoyante', '#d0f0b0'], ['pearlescent', 'nacrée', '#f0d0f0']] as const)
  cube(`${k}_froglight`, `Lanterne de grenouille ${n}`, (t) => { t.grain(paint.ramp(c, 4, 0.12), 0.4, 2); t.border(hex(shade(c, 0.8))); }, { hardness: 0.3, minTier: 0, tool: undefined, light: 15, sound: 'wood', color: c });
cube('redstone_lamp', 'Lampe à redstone', (t) => { t.grain(['#5a3a24', '#4a2e1c', '#6a442c'].map(hex), 0.5, 2); t.rect(3, 3, 10, 10, hex('#8a5a30')); t.rect(5, 5, 6, 6, hex('#3a2414')); }, { hardness: 0.3, minTier: 0, tool: undefined, sound: 'glass', color: '#5a3a24' });
cube('observer', 'Observateur', (t) => { t.grain(['#5a5a5a', '#6a6a6a'].map(hex), 0.4, 2); t.rect(3, 4, 10, 3, hex('#2a2a2a')); t.rect(3, 9, 10, 3, hex('#2a2a2a')); }, { hardness: 3, color: '#5a5a5a' });
cube('dispenser', 'Distributeur', (t) => { paint.cobble(t, paint.ramp('#7a7a7a', 5, 0.4)); t.rect(5, 5, 6, 6, hex('#1a1a1a')); t.rect(6, 6, 4, 4, hex('#3a3a3a')); }, { hardness: 3.5, color: '#7a7a7a' });
cube('dropper', 'Dropper', (t) => { paint.cobble(t, paint.ramp('#7a7a7a', 5, 0.4)); t.rect(5, 5, 6, 6, hex('#1a1a1a')); }, { hardness: 3.5, color: '#7a7a7a' });
cube('piston', 'Piston', (t) => { paint.cobble(t, paint.ramp('#7a7a7a', 5, 0.4)); t.rect(0, 0, 16, 4, hex('#b8945f')); }, { hardness: 1.5, color: '#7a7a7a' });
cube('sticky_piston', 'Piston collant', (t) => { paint.cobble(t, paint.ramp('#7a7a7a', 5, 0.4)); t.rect(0, 0, 16, 4, hex('#6ad850')); }, { hardness: 1.5, color: '#7a7a7a' });
cube('crafter', 'Fabricateur', (t) => { t.grain(['#7a7a7a', '#8a8a8a'].map(hex), 0.4, 2); t.border(hex('#4a4a4a')); t.rect(4, 4, 8, 8, hex('#b8945f')); }, { hardness: 1.5, color: '#7a7a7a' });
cube('blast_furnace', 'Haut fourneau', (t) => { t.grain(['#5a5a5e', '#6a6a6e', '#4a4a4e'].map(hex), 0.4, 2); t.rect(3, 8, 10, 6, hex('#1a1a1a')); t.hline(3, 12, 10, hex('#8a8a8e')); }, { hardness: 3.5, color: '#5a5a5e' });
cube('smoker', 'Fumoir', (t) => { paint.planks(t, '#5a4028'); t.rect(3, 8, 10, 6, hex('#1a1a1a')); }, { hardness: 3.5, tool: 'axe', minTier: 0, sound: 'wood', color: '#5a4028' });
cube('beehive', 'Ruche', (t) => { paint.planks(t, '#c8a050'); t.rect(5, 6, 6, 4, hex('#3a2a10')); }, { hardness: 0.6, tool: 'axe', minTier: 0, sound: 'wood', color: '#c8a050' });
cube('bee_nest', 'Nid d’abeilles', (t) => { t.grain(['#e0b030', '#d0a020', '#f0c040'].map(hex), 0.4, 2); for (let y = 1; y < 16; y += 3) t.hline(0, 15, y, hex('#b88818')); t.rect(6, 6, 4, 4, hex('#3a2a10')); }, { hardness: 0.3, tool: 'axe', minTier: 0, sound: 'wood', color: '#e0b030' });
cube('ender_chest_block', 'Bloc d’ender', (t) => { t.grain(['#14261e', '#1a3028', '#0e1c16'].map(hex), 0.5, 2); t.border(hex('#2a6a5a')); t.rect(6, 6, 4, 4, hex('#30c090')); }, { hardness: 22.5, color: '#14261e' });
cube('respawn_anchor', 'Ancre de réapparition', (t) => { t.grain(['#1a1028', '#20142e'].map(hex), 0.5, 2); t.border(hex('#4a2a7a')); t.rect(5, 5, 6, 6, hex('#a040ff')); }, { hardness: 50, minTier: 4, light: 3, color: '#1a1028' });
for (const [k, n, c, light] of [['red_mushroom_block', 'Bloc de champignon rouge', '#c02a20', 0], ['brown_mushroom_block', 'Bloc de champignon brun', '#956b4a', 0], ['mushroom_stem', 'Pied de champignon', '#d8d0c4', 0]] as const)
  cube(k, n, (t) => { t.grain(paint.ramp(c, 4, 0.15), 0.4, 2); if (k === 'red_mushroom_block') t.speckle(hex('#f0f0f0'), 10, 2); }, { hardness: 0.2, tool: 'axe', minTier: 0, sound: 'wood', light, color: c });
// coraux (blocs et plantes) et versions mortes
for (const [k, n, c] of [['tube', 'tubulaire', '#3050e0'], ['brain', 'cerveau', '#e070a8'], ['bubble', 'bulles', '#a020c0'], ['fire', 'de feu', '#d02a2a'], ['horn', 'corne', '#e8d030']] as const) {
  cube(`${k}_coral_block`, `Bloc de corail ${n}`, (t) => { t.grain(paint.ramp(c, 4, 0.25), 0.5, 2); t.speckle(hex(shade(c, 1.3)), 12, 1); }, { hardness: 1.5, minTier: 1, color: c });
  cube(`dead_${k}_coral_block`, `Bloc de corail ${n} mort`, (t) => { t.grain(paint.ramp('#8a847c', 4, 0.2), 0.5, 2); }, { hardness: 1.5, minTier: 1, color: '#8a847c' });
  tile(`${k}_coral`, (t) => { t.clear(); const p = paint.ramp(c, 3, 0.3); for (let i = 0; i < 5; i++) { const x = 2 + i * 3; for (let y = 4 + (i % 2) * 2; y < 16; y++) t.set(x + ((y >> 2) % 2), y, p[(y + i) % 3]); t.set(x, 3 + (i % 2) * 2, p[2]); } });
  B.push({ key: `${k}_coral`, name: `Corail ${n}`, textures: { all: `${k}_coral` }, hardness: 0, render: 'cross', solid: false, needsSupport: true, sound: 'grass', drops: [], color: c });
}
// plantes : algues, herbes marines, bambou, buisson à baies, pousses du Nether, lianes
const plantTile = (key: string, colors: string[], shape: 'grass' | 'stalk' | 'bush' | 'vine') =>
  tile(key, (t) => {
    t.clear();
    const p = colors.map(hex);
    if (shape === 'stalk') {
      for (let y = 0; y < 16; y++) for (let x = 6; x < 10; x++) t.set(x, y, p[(x + (y >> 2)) % p.length]);
      for (let y = 2; y < 16; y += 5) t.hline(6, 9, y, p[0]);
      t.rect(10, 4, 3, 2, p[1]);
      t.rect(3, 10, 3, 2, p[1]);
    } else if (shape === 'bush') {
      for (let y = 4; y < 16; y++) for (let x = 2; x < 14; x++) if (t.rng.next() < 0.7) t.set(x, y, p[t.rng.int(0, p.length - 2)]);
      for (let i = 0; i < 6; i++) t.set(t.rng.int(3, 12), t.rng.int(5, 14), p[p.length - 1]);
    } else if (shape === 'vine') {
      for (let x = 3; x < 14; x += 4) for (let y = 0; y < 16; y++) if (t.rng.next() < 0.85) t.set(x + ((y >> 2) % 2), y, p[(x + y) % p.length]);
    } else for (let x = 1; x < 15; x += 2) for (let y = t.rng.int(2, 8); y < 16; y++) t.set(x + (y % 3 === 0 ? 1 : 0), y, p[(x + y) % p.length]);
  });
const plant = (key: string, name: string, colors: string[], shape: 'grass' | 'stalk' | 'bush' | 'vine', o: Partial<BlockDef> = {}) => {
  plantTile(key, colors, shape);
  B.push({ key, name, textures: { all: key }, hardness: 0, render: 'cross', solid: false, sway: shape !== 'stalk', replaceable: shape === 'grass', needsSupport: shape !== 'vine', sound: 'grass', color: colors[0], ...o });
};
plant('seagrass', 'Herbe marine', ['#2a8a3a', '#3a9a4a', '#1e7a2e'], 'grass', { drops: [] });
plant('kelp_plant', 'Algue', ['#4a8a2a', '#3a7a1e', '#5a9a3a'], 'vine', { drops: [{ item: 'kelp' }] });
plant('bamboo_plant', 'Bambou', ['#6aa030', '#5a9020', '#7ab040'], 'stalk', { hardness: 1, tool: 'axe', drops: [{ item: 'bamboo' }] });
plant('sweet_berry_bush', 'Buisson à baies sucrées', ['#2a6a3a', '#3a7a4a', '#1e5a2e', '#c02040'], 'bush', { contactDamage: 0.5, drops: [{ item: 'sweet_berries', min: 1, max: 3 }] });
plant('nether_sprouts', 'Pousses du Nether', ['#16a098', '#108a80', '#20b0a8'], 'grass', { drops: [] });
plant('weeping_vines', 'Lianes pleureuses', ['#a01818', '#8a1010', '#c02828'], 'vine', { drops: [] });
plant('twisting_vines', 'Lianes tordues', ['#14a090', '#108a7a', '#20b8a8'], 'vine', { drops: [] });
plant('sunflower', 'Tournesol', ['#3f8f2a', '#f0c020', '#e0a010'], 'stalk', { drops: [{ item: 'sunflower' }] });
plant('small_dripleaf', 'Petite grande-feuille', ['#5a9a2a', '#4a8a1e', '#6aaa3a'], 'bush', {});
plant('glow_berries_vines', 'Lianes à baies lumineuses', ['#3a7a2a', '#2e6a1e', '#f0b030'], 'vine', { light: 10, drops: [{ item: 'glow_berries' }] });

// ---------- bois : écorcés, bois (6 faces d'écorce), escaliers/dalles/barrières manquants ----------
const LOGS: [string, string, string, string][] = [
  // [essence, nom, couleur des planches, couleur de l'écorce]
  ['oak', 'chêne', '#b8945f', '#6b5130'], ['spruce', 'sapin', '#7a5a34', '#3a2a18'], ['birch', 'bouleau', '#d7c185', '#e8e4dc'],
  ['jungle', 'acajou', '#b4835c', '#56441e'], ['acacia', 'acacia', '#ad5d32', '#676157'], ['dark_oak', 'chêne noir', '#4a2f17', '#3a2a18'],
  ['cherry', 'cerisier', '#e3b3ad', '#3b2129'], ['mangrove', 'palétuvier', '#773934', '#4a3d2a'], ['pale_oak', 'chêne pâle', '#e8dcd6', '#6a625c'],
  ['crimson', 'carmin', '#7e3a56', '#5c1e2e'], ['warped', 'biscornu', '#2b6963', '#3a3a5a'],
];
for (const [w, n, plank, bark] of LOGS) {
  const stem = w === 'crimson' || w === 'warped';
  const log = stem ? `${w}_stem` : `${w}_log`;
  const wood = stem ? `${w}_hyphae` : `${w}_wood`;
  const flammable = !stem;
  tile(`stripped_${log}_side`, (t) => void paint.logSide(t, plank));
  tile(`stripped_${log}_top`, (t) => void paint.logTop(t, plank, shade(plank, 0.8)));
  tile(`${wood}`, (t) => void paint.logSide(t, bark));
  B.push({ key: `stripped_${log}`, name: `${stem ? 'Tige' : 'Bûche'} de ${n} écorcée`, textures: { top: `stripped_${log}_top`, bottom: `stripped_${log}_top`, side: `stripped_${log}_side` }, hardness: 2, tool: 'axe', flammable, sound: 'wood', color: plank });
  B.push({ key: wood, name: stem ? `Hyphes de ${n}` : `Bois de ${n}`, textures: { all: wood }, hardness: 2, tool: 'axe', flammable, sound: 'wood', color: bark });
  B.push({ key: `stripped_${wood}`, name: stem ? `Hyphes de ${n} écorcées` : `Bois de ${n} écorcé`, textures: { all: `stripped_${log}_side` }, hardness: 2, tool: 'axe', flammable, sound: 'wood', color: plank });
  shaped(wood, wood, 3, ['LL', 'LL'], { L: log });
  shaped(`stripped_${wood}`, `stripped_${wood}`, 3, ['LL', 'LL'], { L: `stripped_${log}` });
  shapeless(`planks_from_stripped_${log}`, `${w}_planks`, 4, [`stripped_${log}`]);
  shapeless(`planks_from_${wood}`, `${w}_planks`, 4, [wood]);
  // essences de base : escaliers, dalles et barrières (le chêne les a déjà)
  if (['spruce', 'birch', 'jungle', 'acacia', 'dark_oak'].includes(w)) {
    for (const [suffix, shape, nm] of [['stairs', 'stairs', 'Escalier'], ['slab', 'slab', 'Dalle'], ['fence', 'fence', 'Barrière']] as const)
      B.push({ key: `${w}_${suffix}`, name: `${nm} en ${n}`, textures: { all: `${w}_planks` }, hardness: 2, tool: 'axe', render: 'model', shape, flammable: true, sound: 'wood', color: plank });
    shaped(`${w}_stairs`, `${w}_stairs`, 4, ['P  ', 'PP ', 'PPP'], { P: `${w}_planks` });
    shaped(`${w}_slab`, `${w}_slab`, 6, ['PPP'], { P: `${w}_planks` });
    shaped(`${w}_fence`, `${w}_fence`, 3, ['PSP', 'PSP'], { P: `${w}_planks`, S: 'stick' });
  }
}
/** Bûche → version écorcée (clic droit avec une hache). */
export const STRIPPED: Record<string, string> = Object.fromEntries(
  LOGS.flatMap(([w]) => {
    const stem = w === 'crimson' || w === 'warped';
    const log = stem ? `${w}_stem` : `${w}_log`, wood = stem ? `${w}_hyphae` : `${w}_wood`;
    return [[log, `stripped_${log}`], [wood, `stripped_${wood}`]];
  }),
);

// ---------- escaliers, dalles et murets de toutes les pierres ----------
// [préfixe, nom, texture, escalier, dalle, muret]
const STONES: [string, string, string, boolean, boolean, boolean][] = [
  ['stone', 'pierre', 'stone', true, false, false],
  ['cobblestone', 'pierre taillée', 'cobblestone', false, false, true],
  ['mossy_cobblestone', 'pierre taillée moussue', 'mossy_cobblestone', true, true, true],
  ['stone_brick', 'pierres taillées', 'stone_bricks', false, false, true],
  ['mossy_stone_brick', 'pierres taillées moussues', 'mossy_stone_bricks', true, true, true],
  ['granite', 'granite', 'granite', true, true, true],
  ['diorite', 'diorite', 'diorite', true, true, true],
  ['andesite', 'andésite', 'andesite', true, true, true],
  ['polished_granite', 'granite poli', 'polished_granite', true, true, false],
  ['polished_diorite', 'diorite polie', 'polished_diorite', true, true, false],
  ['polished_andesite', 'andésite polie', 'polished_andesite', true, true, false],
  ['sandstone', 'grès', 'sandstone', true, true, true],
  ['smooth_sandstone', 'grès lisse', 'smooth_sandstone', true, true, false],
  ['red_sandstone', 'grès rouge', 'red_sandstone', true, true, true],
  ['smooth_stone', 'pierre lisse', 'smooth_stone', false, true, false],
  ['brick', 'briques', 'bricks', false, false, true],
  ['cobbled_deepslate', 'ardoise des abîmes taillée', 'cobbled_deepslate', true, true, true],
  ['polished_deepslate', 'ardoise des abîmes polie', 'polished_deepslate', true, true, true],
  ['deepslate_tile', "carreaux d'ardoise", 'deepslate_tiles', true, true, true],
  ['deepslate_brick', "briques d'ardoise", 'deepslate_bricks', false, false, true],
  ['blackstone', 'pierre noire', 'blackstone', true, true, true],
  ['polished_blackstone', 'pierre noire polie', 'polished_blackstone', true, true, true],
  ['polished_blackstone_brick', 'briques de pierre noire polie', 'polished_blackstone_bricks', true, true, true],
  ['end_stone_brick', "briques de pierre de l'End", 'end_stone_bricks', true, true, true],
  ['purpur', 'purpur', 'purpur_block', true, true, false],
  ['prismarine', 'prismarine', 'prismarine', true, true, true],
  ['dark_prismarine', 'prismarine sombre', 'dark_prismarine', true, true, false],
  ['mud_brick', 'briques de boue', 'mud_bricks', true, true, true],
  ['tuff', 'tuf', 'tuff', true, true, true],
  ['polished_tuff', 'tuf poli', 'polished_tuff', true, true, true],
  ['tuff_brick', 'briques de tuf', 'tuff_bricks', true, true, true],
  ['nether_brick', 'briques du Nether', 'nether_bricks', false, false, true],
  ['red_nether_brick', 'briques rouges du Nether', 'red_nether_bricks', true, true, true],
  ['smooth_quartz', 'quartz lisse', 'smooth_quartz', true, true, false],
  ['cut_copper', 'cuivre taillé', 'cut_copper', true, true, false],
  ['exposed_cut_copper', 'cuivre taillé exposé', 'exposed_cut_copper', true, true, false],
  ['weathered_cut_copper', 'cuivre taillé érodé', 'weathered_cut_copper', true, true, false],
  ['oxidized_cut_copper', 'cuivre taillé oxydé', 'oxidized_cut_copper', true, true, false],
];
for (const [k, n, tex, stairs, slab, wall] of STONES) {
  const metal = k.includes('copper');
  const base = { textures: { all: tex }, hardness: metal ? 3 : 2, tool: 'pickaxe' as const, minTier: 1, render: 'model' as const, sound: metal ? ('metal' as const) : ('stone' as const) };
  if (stairs) {
    B.push({ key: `${k}_stairs`, name: `Escalier en ${n}`, shape: 'stairs', ...base });
    shaped(`${k}_stairs`, `${k}_stairs`, 4, ['B  ', 'BB ', 'BBB'], { B: tex });
  }
  if (slab) {
    B.push({ key: `${k}_slab`, name: `Dalle en ${n}`, shape: 'slab', ...base });
    shaped(`${k}_slab`, `${k}_slab`, 6, ['BBB'], { B: tex });
  }
  if (wall) {
    B.push({ key: `${k}_wall`, name: `Muret en ${n}`, shape: 'wall', ...base });
    shaped(`${k}_wall`, `${k}_wall`, 6, ['BBB', 'BBB'], { B: tex });
  }
}

// ---------- tapis, terre cuite émaillée, boîtes de shulker, lits colorés (décor) ----------
for (const [c, n, h] of WOOL_COLORS) {
  B.push({ key: `${c}_carpet`, name: `Tapis ${n}`, textures: { all: `${c}_wool` }, hardness: 0.1, render: 'model', shape: 'carpet', solid: false, needsSupport: true, flammable: true, sound: 'wool', color: h });
  shaped(`${c}_carpet`, `${c}_carpet`, 3, ['WW'], { W: `${c}_wool` });
  tile(`${c}_glazed_terracotta`, (t) => {
    const a = hex(h), b2 = hex(shade(h, 0.65)), w = hex('#f0ece0');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const q = (x < 8 ? 0 : 1) + (y < 8 ? 0 : 2);
        const lx = x & 7, ly = y & 7;
        const r = [lx + ly, 7 - lx + ly, lx + 7 - ly, 14 - lx - ly][q];
        t.set(x, y, r < 4 ? w : r < 8 ? a : r % 3 === 0 ? b2 : a);
      }
  });
  B.push({ key: `${c}_glazed_terracotta`, name: `Terre cuite émaillée ${n}`, textures: { all: `${c}_glazed_terracotta` }, hardness: 1.4, tool: 'pickaxe', minTier: 1, sound: 'stone', color: h });
  smelt(`${c}_terracotta`, `${c}_glazed_terracotta`);
  tile(`${c}_shulker_box`, (t) => { t.grain(paint.ramp(h, 4, 0.15), 0.3, 2); t.hline(0, 15, 9, hex(shade(h, 0.6))); t.border(hex(shade(h, 0.7))); });
  B.push({ key: `${c}_shulker_box`, name: `Boîte de shulker ${n}`, textures: { all: `${c}_shulker_box` }, hardness: 2, tool: 'pickaxe', minTier: 0, sound: 'stone', color: h });
  shaped(`${c}_shulker_box`, `${c}_shulker_box`, 1, ['S', 'C', 'S'], { S: 'shulker_shell', C: 'chest' });
}
B.push({ key: 'moss_carpet', name: 'Tapis de mousse', textures: { all: 'moss_block' }, hardness: 0.1, render: 'model', shape: 'carpet', solid: false, sound: 'grass', color: '#596e2d' });
shaped('moss_carpet', 'moss_carpet', 3, ['MM'], { M: 'moss_block' });
tile('pink_petals', (t) => { t.clear(); for (let i = 0; i < 40; i++) t.set(t.rng.int(0, 15), t.rng.int(0, 15), hex(['#f0a0c0', '#e890b0', '#f8b8d0', '#5a9a2a'][t.rng.int(0, 3)])); });
B.push({ key: 'pink_petals', name: 'Pétales roses', textures: { all: 'pink_petals' }, hardness: 0, render: 'model', shape: 'carpet', solid: false, replaceable: true, sound: 'grass', color: '#f0a0c0' });
tile('soul_lantern', (t) => { t.clear(); t.rect(5, 2, 6, 7, hex('#3a3a40')); t.rect(6, 3, 4, 5, hex('#60e0f0')); t.rect(6, 0, 4, 2, hex('#2a2a2e')); });
B.push({ key: 'soul_lantern', name: 'Lanterne des âmes', textures: { all: 'soul_lantern' }, hardness: 3.5, tool: 'pickaxe', render: 'model', shape: 'lantern', solid: false, light: 10, sound: 'metal', color: '#60e0f0' });
shaped('soul_lantern', 'soul_lantern', 1, ['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'soul_torch' });

// recettes des nouveaux blocs
shaped('polished_deepslate', 'polished_deepslate', 4, ['DD', 'DD'], { D: 'cobbled_deepslate' });
shaped('deepslate_tiles', 'deepslate_tiles', 4, ['DD', 'DD'], { D: 'deepslate_bricks' });
shaped('polished_blackstone', 'polished_blackstone', 4, ['BB', 'BB'], { B: 'blackstone' });
shaped('polished_blackstone_bricks', 'polished_blackstone_bricks', 4, ['BB', 'BB'], { B: 'polished_blackstone' });
shaped('cut_sandstone', 'cut_sandstone', 4, ['SS', 'SS'], { S: 'sandstone' });
shaped('chiseled_sandstone', 'chiseled_sandstone', 1, ['S', 'S'], { S: 'sandstone_slab' });
smelt('sandstone', 'smooth_sandstone');
smelt('red_sandstone', 'smooth_red_sandstone');
shaped('chiseled_stone_bricks', 'chiseled_stone_bricks', 1, ['S', 'S'], { S: 'stone_brick_slab' });
shaped('quartz_pillar', 'quartz_pillar', 2, ['Q', 'Q'], { Q: 'quartz_block' });
shaped('chiseled_quartz_block', 'chiseled_quartz_block', 1, ['S', 'S'], { S: 'quartz_slab' });
shaped('polished_tuff', 'polished_tuff', 4, ['TT', 'TT'], { T: 'tuff' });
shaped('tuff_bricks', 'tuff_bricks', 4, ['TT', 'TT'], { T: 'polished_tuff' });
shaped('netherite_block', 'netherite_block', 1, ['NNN', 'NNN', 'NNN'], { N: 'netherite_ingot' });
shapeless('netherite_ingot_from_block', 'netherite_ingot', 9, ['netherite_block']);
shaped('target', 'target', 1, [' R ', 'RHR', ' R '], { R: 'redstone', H: 'hay_block' });
shaped('lodestone', 'lodestone', 1, ['CCC', 'CNC', 'CCC'], { C: 'chiseled_stone_bricks', N: 'netherite_ingot' });
shaped('dried_kelp_block', 'dried_kelp_block', 1, ['KKK', 'KKK', 'KKK'], { K: 'dried_kelp' });
shapeless('dried_kelp', 'dried_kelp', 9, ['dried_kelp_block']);
shaped('honey_block', 'honey_block', 1, ['HH', 'HH'], { H: 'honey_bottle' });
shaped('beehive', 'beehive', 1, ['PPP', 'HHH', 'PPP'], { P: 'tag:planks', H: 'honeycomb' });
shaped('tinted_glass', 'tinted_glass', 2, [' A ', 'AGA', ' A '], { A: 'amethyst_shard', G: 'glass' });
shaped('redstone_lamp', 'redstone_lamp', 1, [' R ', 'RGR', ' R '], { R: 'redstone', G: 'glowstone' });
shaped('observer', 'observer', 1, ['CCC', 'RRQ', 'CCC'], { C: 'cobblestone', R: 'redstone', Q: 'quartz' });
shaped('dispenser', 'dispenser', 1, ['CCC', 'CBC', 'CRC'], { C: 'cobblestone', B: 'bow', R: 'redstone' });
shaped('dropper', 'dropper', 1, ['CCC', 'C C', 'CRC'], { C: 'cobblestone', R: 'redstone' });
shaped('piston', 'piston', 1, ['PPP', 'CIC', 'CRC'], { P: 'tag:planks', C: 'cobblestone', I: 'iron_ingot', R: 'redstone' });
shapeless('sticky_piston', 'sticky_piston', 1, ['piston', 'slime_ball']);
shaped('blast_furnace', 'blast_furnace', 1, ['III', 'IFI', 'SSS'], { I: 'iron_ingot', F: 'furnace', S: 'smooth_stone' });
shaped('smoker', 'smoker', 1, [' L ', 'LFL', ' L '], { L: 'tag:logs', F: 'furnace' });
shaped('chiseled_bookshelf', 'chiseled_bookshelf', 1, ['PPP', 'SSS', 'PPP'], { P: 'tag:planks', S: 'oak_slab' });
shaped('crafter', 'crafter', 1, ['III', 'ICI', 'RDR'], { I: 'iron_ingot', C: 'crafting_table', R: 'redstone', D: 'dropper' });
shapeless('mushroom_stem', 'mushroom_stem', 1, ['brown_mushroom', 'red_mushroom']);
shaped('respawn_anchor', 'respawn_anchor', 1, ['OOO', 'GGG', 'OOO'], { O: 'crying_obsidian', G: 'glowstone' });
for (const k of ['exposed', 'weathered', 'oxidized']) shaped(`${k}_chiseled_copper`, `${k}_chiseled_copper`, 1, ['S', 'S'], { S: `${k}_cut_copper_slab` });
shaped('chiseled_copper', 'chiseled_copper', 1, ['S', 'S'], { S: 'cut_copper_slab' });
shaped('copper_grate', 'copper_grate', 4, [' C ', 'C C', ' C '], { C: 'copper_block' });

// ---------- objets ----------
const fish = (key: string, name: string, colors: string[], hunger: number, sat: number, raw = true) =>
  I.push({ key, name, icon: { sprite: 'fish', colors }, food: { hunger, saturation: sat }, tab: 'food', ...(raw ? {} : {}) });
fish('cod', 'Morue crue', ['#a89878', '#d8c8a8'], 2, 0.4);
fish('cooked_cod', 'Morue cuite', ['#c89858', '#f0d0a0'], 5, 6);
fish('salmon', 'Saumon cru', ['#c04a38', '#e88070'], 2, 0.4);
fish('cooked_salmon', 'Saumon cuit', ['#c06a40', '#f0a070'], 6, 9.6);
fish('tropical_fish', 'Poisson tropical', ['#f08a20', '#ffffff'], 1, 0.2);
fish('pufferfish', 'Poisson-globe', ['#e0c030', '#f8e870'], 1, 0.2);
I.push({ key: 'rabbit', name: 'Lapin cru', icon: { sprite: 'meat', colors: ['#e8a0a0', '#f0c0b8'] }, food: { hunger: 3, saturation: 1.8 }, tab: 'food' });
I.push({ key: 'cooked_rabbit', name: 'Lapin cuit', icon: { sprite: 'meat', colors: ['#b8743a', '#d89860'] }, food: { hunger: 5, saturation: 6 }, tab: 'food' });
I.push({ key: 'rabbit_stew', name: 'Ragoût de lapin', icon: { sprite: 'bowl_food', colors: ['#a86a3a', '#6a4a2a'] }, food: { hunger: 10, saturation: 12 }, maxStack: 1, tab: 'food' });
I.push({ key: 'beetroot_soup', name: 'Soupe de betteraves', icon: { sprite: 'bowl_food', colors: ['#a01830', '#6a4a2a'] }, food: { hunger: 6, saturation: 7.2 }, maxStack: 1, tab: 'food' });
I.push({ key: 'honey_bottle', name: 'Fiole de miel', icon: { sprite: 'bottle', colors: ['#f0a020', '#ffd060'] }, food: { hunger: 6, saturation: 1.2 }, maxStack: 16, tab: 'food' });
I.push({ key: 'dried_kelp', name: 'Algue séchée', icon: { sprite: 'leaf', colors: ['#3a4a2a', '#5a6a3a'] }, food: { hunger: 1, saturation: 0.6 }, tab: 'food' });
I.push({ key: 'cooked_mushroom_skewer', name: 'Brochette de champignons', icon: { sprite: 'stick', colors: ['#a86a3a'] }, food: { hunger: 6, saturation: 7 }, tab: 'food', description: 'Nouveauté LeCraft' });
item('kelp', 'Algue', 'leaf', ['#4a8a2a', '#6aaa3a'], { place: 'kelp_plant', tab: 'nature' });
item('bamboo', 'Bambou', 'stick', ['#6aa030'], { place: 'bamboo_plant', burnTime: 2.5, tab: 'nature' });
item('sunflower', 'Tournesol', 'flower', ['#f0c020', '#3f8f2a'], { place: 'sunflower', tab: 'nature' });
item('goat_horn', 'Corne de chèvre', 'horn', ['#d8d0b8', '#a89870'], { maxStack: 1 });
item('rabbit_foot', 'Patte de lapin', 'bone', ['#c8a888', '#e8d0b8']);
item('turtle_scute', 'Écaille de tortue', 'gem', ['#4a8a3a', '#7aba6a']);
item('armadillo_scute', 'Écaille de tatou', 'gem', ['#c88a70', '#e8b8a0']);
item('shulker_shell', 'Carapace de shulker', 'gem', ['#8a5a9a', '#c8a0d8']);
item('spyglass', 'Longue-vue', 'stick', ['#c87a3a'], { maxStack: 1, tab: 'tools' });
smelt('cod', 'cooked_cod', 0.35);
smelt('salmon', 'cooked_salmon', 0.35);
smelt('rabbit', 'cooked_rabbit', 0.35);
smelt('kelp', 'dried_kelp');
smelt('wet_sponge', 'sponge', 0.15);
shapeless('rabbit_stew', 'rabbit_stew', 1, ['cooked_rabbit', 'carrot', 'baked_potato', 'brown_mushroom', 'bowl']);
shapeless('beetroot_soup', 'beetroot_soup', 1, ['beetroot', 'beetroot', 'beetroot', 'beetroot', 'beetroot', 'beetroot', 'bowl']);
shapeless('cooked_mushroom_skewer', 'cooked_mushroom_skewer', 1, ['stick', 'brown_mushroom', 'red_mushroom', 'brown_mushroom']);
shaped('spyglass', 'spyglass', 1, ['A', 'C', 'C'], { A: 'amethyst_shard', C: 'copper_ingot' });
shaped('turtle_helmet', 'turtle_helmet', 1, ['SSS', 'S S'], { S: 'turtle_scute' });
shaped('wolf_armor', 'wolf_armor', 1, ['S  ', 'SSS', 'S S'], { S: 'armadillo_scute' });

// outils, armes et armures en netherite ; armure de mailles ; casque de tortue
const NETH = { tier: 4, speed: 9, durability: 2031, color: '#4a4246' };
const NETH_DMG: Record<string, number> = { sword: 8, axe: 10, pickaxe: 6, shovel: 6.5, hoe: 1 };
const TOOL_NAMES: Record<string, string> = { sword: 'Épée', pickaxe: 'Pioche', axe: 'Hache', shovel: 'Pelle', hoe: 'Houe' };
for (const tk of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'] as const) {
  I.push({
    key: `netherite_${tk}`, name: `${TOOL_NAMES[tk]} en netherite`, icon: { sprite: tk, colors: [NETH.color, '#6b4f2c'] }, maxStack: 1,
    tool: { type: tk, tier: NETH.tier, speed: NETH.speed, durability: NETH.durability, material: 'netherite' }, damage: NETH_DMG[tk],
    attackCooldown: tk === 'sword' ? 0.625 : tk === 'axe' ? 1 : tk === 'pickaxe' ? 0.83 : tk === 'hoe' ? 0.25 : 1, use: tk === 'hoe' ? 'till' : undefined, tab: tk === 'sword' ? 'combat' : 'tools',
  });
  shapeless(`netherite_${tk}`, `netherite_${tk}`, 1, [`diamond_${tk}`, 'netherite_ingot']);
}
const PIECES = [['head', 'helmet', 'Casque'], ['chest', 'chestplate', 'Plastron'], ['legs', 'leggings', 'Jambières'], ['feet', 'boots', 'Bottes']] as const;
const NETH_ARMOR = { def: [3, 8, 6, 3], dur: [407, 592, 555, 481] };
const CHAIN_ARMOR = { def: [2, 5, 4, 1], dur: [165, 240, 225, 195] };
const ARMOR_PATTERNS: Record<string, string[]> = { helmet: ['XXX', 'X X'], chestplate: ['X X', 'XXX', 'XXX'], leggings: ['XXX', 'X X', 'X X'], boots: ['X X', 'X X'] };
PIECES.forEach(([slot, k, nm], i) => {
  I.push({ key: `netherite_${k}`, name: `${nm} en netherite`, icon: { sprite: k, colors: [NETH.color] }, maxStack: 1, armor: { slot, defense: NETH_ARMOR.def[i], durability: NETH_ARMOR.dur[i], material: 'netherite' }, tab: 'combat' });
  shapeless(`netherite_${k}`, `netherite_${k}`, 1, [`diamond_${k}`, 'netherite_ingot']);
  I.push({ key: `chainmail_${k}`, name: `${nm} en mailles`, icon: { sprite: k, colors: ['#9a9aa0'] }, maxStack: 1, armor: { slot, defense: CHAIN_ARMOR.def[i], durability: CHAIN_ARMOR.dur[i], material: 'chainmail' }, tab: 'combat' });
  shaped(`chainmail_${k}`, `chainmail_${k}`, 1, ARMOR_PATTERNS[k], { X: 'iron_nugget' });
});
I.push({ key: 'turtle_helmet', name: 'Carapace de tortue', icon: { sprite: 'helmet', colors: ['#4a8a3a'] }, maxStack: 1, armor: { slot: 'head', defense: 2, durability: 275, material: 'turtle' }, tab: 'combat' });
I.push({ key: 'wolf_armor', name: 'Armure pour loup', icon: { sprite: 'chestplate', colors: ['#c88a70'] }, maxStack: 1, tab: 'combat' });

// ---------- marteaux (minage 3×3) et excavateurs (pelletage 3×3) — nouveautés LeCraft ----------
const AREA_MATS: [string, string, number, number, number, string, string, number][] = [
  // [clé, nom, niveau, vitesse, durabilité, couleur, ingrédient, dégâts]
  ['wooden', 'en bois', 1, 2, 59, '#a8834b', 'tag:planks', 5],
  ['stone', 'en pierre', 2, 4, 131, '#8a8a8a', 'tag:stone_tool', 6],
  ['copper', 'en cuivre', 2, 5, 190, '#d8844c', 'copper_block', 6],
  ['iron', 'en fer', 3, 6, 250, '#e6e6e6', 'iron_block', 7],
  ['golden', 'en or', 1, 12, 32, '#fae24a', 'gold_block', 5],
  ['diamond', 'en diamant', 4, 8, 1561, '#4fe0d6', 'diamond_block', 8],
  ['netherite', 'en netherite', 4, 9, 2031, NETH.color, 'netherite_ingot', 9],
];
for (const [mk, n, tier, speed, dur, color, mat, dmg] of AREA_MATS) {
  I.push({
    key: `${mk}_hammer`, name: `Marteau ${n}`, icon: { sprite: 'hammer', colors: [color, '#6b4f2c'] }, maxStack: 1,
    // un peu plus lent qu'une pioche, mais casse 3×3 blocs ; trois fois plus solide
    tool: { type: 'pickaxe', tier, speed: speed * 0.7, durability: dur * 3, material: mk }, damage: dmg, attackCooldown: 1.2, area: 'hammer', tab: 'tools',
    description: 'Mine 3×3 blocs (accroupi : un seul bloc)',
  });
  I.push({
    key: `${mk}_excavator`, name: `Excavateur ${n}`, icon: { sprite: 'excavator', colors: [color, '#6b4f2c'] }, maxStack: 1,
    tool: { type: 'shovel', tier, speed: speed * 0.75, durability: dur * 3, material: mk }, damage: dmg - 2, attackCooldown: 1.1, area: 'excavator', tab: 'tools',
    description: 'Creuse 3×3 blocs de terre, sable, gravier… (accroupi : un seul bloc)',
  });
  if (mk === 'netherite') {
    shapeless('netherite_hammer', 'netherite_hammer', 1, ['diamond_hammer', 'netherite_ingot']);
    shapeless('netherite_excavator', 'netherite_excavator', 1, ['diamond_excavator', 'netherite_ingot']);
  } else {
    shaped(`${mk}_hammer`, `${mk}_hammer`, 1, ['MMM', 'MSM', ' S '], { M: mat, S: 'stick' });
    shaped(`${mk}_excavator`, `${mk}_excavator`, 1, [' M ', 'MSM', ' S '], { M: mat, S: 'stick' });
  }
}

// ---------- œufs d'apparition (inventaire créatif) ----------
const EGG_COLORS: Record<string, [string, string]> = {
  cow: ['#443626', '#a1a1a1'], sheep: ['#e7e7e7', '#ffb5b5'], pig: ['#f0a5a2', '#db635f'], chicken: ['#a1a1a1', '#ff0000'], zombie: ['#00afaf', '#799c65'],
  spider: ['#342d27', '#a80e0e'], slime: ['#51a03e', '#7ebf6e'], skeleton: ['#c1c1c1', '#494949'], cave_spider: ['#0c424e', '#a80e0e'], creeper: ['#0da70b', '#000000'],
  zombified_piglin: ['#ea9393', '#4c7129'], ghast: ['#f9f9f9', '#bcbcbc'], magma_cube: ['#340000', '#fcfc00'], blaze: ['#f6b201', '#fff87e'], enderman: ['#161616', '#000000'],
  wolf: ['#d7d3d3', '#ceaf96'], squid: ['#223b4d', '#708899'], glow_squid: ['#095656', '#85f1bc'], bat: ['#4c3e30', '#0f0f0f'], husk: ['#797061', '#e6cc94'],
  drowned: ['#8ff1d7', '#799c65'], stray: ['#617677', '#dde4e4'], witch: ['#340000', '#51a03e'], villager: ['#563c33', '#bd8b72'], wither_skeleton: ['#141414', '#474d4d'],
};
for (const d of MOB_DEFS) {
  if (d.category === 'boss' || d.key === 'end_crystal' || d.key.includes(':')) continue;
  const [a, b] = EGG_COLORS[d.key] ?? [shade(d.key.length % 2 ? '#7a8a5a' : '#8a6a5a', 1 + (d.key.charCodeAt(0) % 5) / 10), shade('#c8c0a0', 1 - (d.key.charCodeAt(1) % 5) / 12)];
  I.push({ key: `${d.key}_spawn_egg`, name: `Œuf d'apparition de ${d.name}`, icon: { sprite: 'egg', colors: [a, b] }, use: 'spawn_egg', target: d.key, tab: 'ingredients' });
}

export const MORE_BLOCKS = B;
export const MORE_ITEMS = I;
export const MORE_RECIPES = R;
export const MORE_SMELTING = S;
