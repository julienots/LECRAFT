/**
 * Contenu tiré des noms de textures du pack de ressources (v2.21) : chaque texture de bloc
 * et d'objet du pack a désormais un usage dans le jeu.
 *  - faces multiples (dessus / dessous / côté / avant / dos) pour les blocs existants ;
 *  - un bloc pour chaque texture de bloc restante (variantes allumées, stades de culture,
 *    bougies, rails, blocs de commande, coffres-forts, œufs de renifleur…) ;
 *  - un objet pour chaque texture d'objet restante (bateaux, pancartes, sacs, harnais, lances,
 *    disques, tessons, modèles de forge, œufs d'apparition…).
 * Les données (noms + couleurs moyennes) sont générées dans vanillaPack.ts ; aucune image du
 * jeu de référence n'est incluse : sans pack, des peintres de repli dessinent les tuiles.
 */
import type { BlockDef, SoundType, ToolType } from '../blocks/Block';
import type { ItemDef } from '../inventory/Item';
import { PACK_BLOCKS, PACK_FACES, PACK_ITEMS, PACK_ORIENT } from './vanillaPack';

/** Applique les faces du pack aux définitions existantes (avant l'enregistrement des tuiles). */
export function applyPackFaces(defs: BlockDef[]) {
  for (const d of defs) {
    const f = PACK_FACES[d.key];
    if (!f) continue;
    d.textures = { ...f };
    if (PACK_ORIENT.includes(d.key)) d.orientable = true;
  }
}

const SOIL = ['grass_block', 'dirt', 'podzol', 'moss_block', 'farmland', 'coarse_dirt', 'mud', 'sand', 'gravel'];

function material(key: string): { hardness: number; tool?: ToolType; sound: SoundType } {
  if (/copper|iron|anvil|chain|bars|lantern|rail|lightning_rod|cauldron|hopper|heavy_core|bell/.test(key)) return { hardness: 3, tool: 'pickaxe', sound: 'metal' };
  if (/glass|ice|amethyst|beacon|conduit/.test(key)) return { hardness: 0.5, sound: 'glass' };
  if (/shelf|door|trapdoor|barrel|table|loom|lectern|composter|bamboo|chorus|beehive|bee_nest|campfire|item_frame|scaffolding|crafter/.test(key)) return { hardness: 2, tool: 'axe', sound: 'wood' };
  if (/sand|gravel|powder_snow|moss|mud|roots|frogspawn|leaf|resin_clump|sculk_vein/.test(key)) return { hardness: 0.6, tool: 'shovel', sound: /sand/.test(key) ? 'sand' : /gravel/.test(key) ? 'gravel' : 'grass' };
  if (/wool|cake|candle/.test(key)) return { hardness: 0.5, sound: 'wool' };
  if (/command|structure|jigsaw|test_|vault|trial_spawner|reinforced/.test(key)) return { hardness: 10, tool: 'pickaxe', sound: 'metal' };
  return { hardness: 1.5, tool: 'pickaxe', sound: 'stone' };
}

function lightOf(key: string): number | undefined {
  if (/campfire_fire|_bulb_lit|redstone_lamp_on|froglight|lantern|beacon|conduit|sea_pickle|lit_powered/.test(key)) return 15;
  if (/_lit$|_on$|candle_lit|glow|firefly|amethyst_bud|redstone_torch$|sculk_sensor|active|ejecting|cave_vines_plant_lit/.test(key)) return /candle/.test(key) ? 6 : 9;
  return undefined;
}

function packBlock([key, name, kind, color, textures]: (typeof PACK_BLOCKS)[number]): BlockDef {
  const m = material(key);
  const base: BlockDef = { key, name, textures, hardness: m.hardness, tool: m.tool, minTier: 0, sound: m.sound, color, light: lightOf(key) };
  switch (kind) {
    case 'cutout':
    case 'faces_cutout':
      return { ...base, render: 'cutout', orientable: !!textures.front };
    case 'faces':
      return { ...base, orientable: !!textures.front };
    case 'model':
      // modèle 3D (src/data/blockModels.ts) : forme, collisions et orientation viennent du modèle
      return { ...base, render: 'model', hardness: /crop|stage|wart|rail|dust|litter|petals|wildflowers|frogspawn|tripwire|vein|clump|moss_carpet|candle|pot|cocoa|dripleaf|azalea|pickle|egg|frame/.test(key) ? (/rail/.test(key) ? 0.7 : 0.1) : m.hardness };
    case 'cross':
      return { ...base, hardness: m.sound === 'metal' ? 1 : 0, tool: m.sound === 'metal' ? 'pickaxe' : undefined, render: 'cross', sound: m.sound === 'stone' ? 'grass' : m.sound, replaceable: false };
    case 'double':
      return { ...base, hardness: 0, tool: undefined, render: 'cross', sway: true, sound: 'grass', needsSupport: true, doublePlant: true, supportBlocks: SOIL };
    case 'carpet':
      return { ...base, hardness: /rail/.test(key) ? 0.7 : 0.1, tool: /rail/.test(key) ? 'pickaxe' : undefined, render: 'model', shape: 'carpet', solid: false, needsSupport: true };
    case 'door':
      return { ...base, hardness: 3, render: 'model', shape: 'door', interact: 'door', needsSupport: true, drops: [{ item: key }] };
    case 'trapdoor':
      return { ...base, hardness: 3, render: 'model', shape: 'trapdoor', interact: 'door' };
    case 'lantern':
      return { ...base, render: 'model', shape: 'lantern', light: 15 };
    case 'pane':
      return { ...base, render: 'model', shape: 'pane' };
    case 'torch':
      return { ...base, hardness: 0, tool: undefined, render: 'model', shape: 'torch', solid: false, sound: 'wood', needsSupport: true, light: /off/.test(key) ? undefined : 7 };
    default:
      return base;
  }
}

export const PACK_BLOCK_DEFS: BlockDef[] = [
  ...PACK_BLOCKS.map(packBlock),
  // textures aussi utilisées par les modèles (répéteur, comparateur) mais qui sont de vrais blocs
  { key: 'redstone_torch', name: 'Torche de redstone', textures: { all: 'redstone_torch' }, hardness: 0, render: 'model', shape: 'torch', solid: false, light: 7, sound: 'wood', needsSupport: true, color: '#d02010' },
  { key: 'redstone_torch_off', name: 'Torche de redstone éteinte', textures: { all: 'redstone_torch_off' }, hardness: 0, render: 'model', shape: 'torch', solid: false, sound: 'wood', needsSupport: true, color: '#602010' },
];
export const PACK_ITEM_DEFS: ItemDef[] = PACK_ITEMS as ItemDef[];
/** Recettes des objets les plus utiles (le reste se trouve dans l'inventaire créatif). */
export const PACK_RECIPES = [
  ['copper_helmet', ['XXX', 'X X']], ['copper_chestplate', ['X X', 'XXX', 'XXX']], ['copper_leggings', ['XXX', 'X X', 'X X']], ['copper_boots', ['X X', 'X X']],
].map(([k, pattern]) => ({ id: `pack:${k}`, type: 'shaped' as const, result: { item: k as string, count: 1 }, pattern: pattern as string[], key: { X: 'copper_ingot' }, width: 3, height: (pattern as string[]).length }))
  .concat(
    (['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond'] as const).map((m) => ({
      id: `pack:${m}_spear`, type: 'shaped' as const, result: { item: `${m}_spear`, count: 1 }, pattern: ['  X', ' S ', 'S  '],
      key: { X: { wooden: 'tag:planks', stone: 'cobblestone', copper: 'copper_ingot', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' }[m], S: 'stick' }, width: 3, height: 3,
    })),
  );
