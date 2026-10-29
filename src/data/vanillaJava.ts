/**
 * Objets et blocs de Java 1.21 encore absents (audit de l'inventaire créatif, onglet par onglet) :
 * lits et bannières des 16 couleurs, têtes et crânes, coffre piégé, coffres en cuivre, pot décoré,
 * plaques de pression pondérées, bouton / plaque en pierre noire polie, dalles / escaliers / murets
 * manquants, blocs infestés, toutes les variantes cirées du cuivre, sable / gravier suspects,
 * ghast desséché, boussole de récupération, flèche à effet… et leurs recettes exactes (Java).
 *
 * Construit APRÈS l'assemblage des autres blocs supplémentaires (les variantes cirées et les
 * dalles copient les définitions finales) et ajouté à la FIN de EXTRA_BLOCKS : les identifiants
 * numériques déjà attribués ne bougent pas (sauvegardes compatibles).
 */
import type { BlockDef } from '../blocks/Block';
import type { ItemDef } from '../inventory/Item';
import type { CraftingRecipe } from '../crafting/Recipe';
import { WOOL_COLORS } from './blocks';
import { hex, paint, registerPainter, type RGB, type Tile } from '../render/TextureGenerator';

const DYE_NAMES: Record<string, string> = { white: 'blanc', orange: 'orange', magenta: 'magenta', light_blue: 'bleu clair', yellow: 'jaune', lime: 'vert clair', pink: 'rose', gray: 'gris', light_gray: 'gris clair', cyan: 'cyan', purple: 'violet', blue: 'bleu', brown: 'marron', green: 'vert', red: 'rouge', black: 'noir' };
const toHex = (c: RGB) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const shade = (h: string, f: number) => toHex(paint.mul(hex(h), f));

/** Pixel art 8×8 (une lettre = une couleur de la palette), agrandi ×2 dans la tuile 16×16. */
function pix(rows: string[], pal: Record<string, string>) {
  return (t: Tile) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const ch = rows[y >> 1][x >> 1];
        const base = hex(pal[ch] ?? '#ff00ff');
        // léger grain (comme les textures du jeu)
        t.set(x, y, paint.mul(base, 0.94 + ((x * 7 + y * 13) % 5) * 0.03));
      }
  };
}

// ---------- tuiles ----------
for (const [c, , h] of WOOL_COLORS) {
  const dark = hex(shade(h, 0.78)), light = hex(shade(h, 1.12));
  registerPainter(`${c}_bed_foot`, (t) => {
    t.pal([dark, hex(h), light], () => t.rng.next());
    t.hline(0, 15, 0, hex(shade(h, 0.65)));
  });
  registerPainter(`${c}_bed_head`, (t) => {
    t.pal([dark, hex(h), light], () => t.rng.next());
    t.rect(2, 1, 12, 6, hex('#e8e8e8'));
    t.hline(2, 13, 6, hex('#c8c8c8'));
  });
  registerPainter(`${c}_bed_side`, (t) => {
    paint.planks(t, '#9c7a4a');
    t.rect(0, 3, 16, 6, hex(h));
    t.hline(0, 15, 3, light);
  });
  registerPainter(`${c}_banner`, (t) => {
    t.grain(paint.ramp(h, 3, 0.06), 0.3, 2);
    t.hline(0, 15, 0, hex(shade(h, 0.8)));
    t.hline(0, 15, 15, hex(shade(h, 0.8)));
  });
}
// têtes (visage, côté, dessus) : pixel art d'après les skins du jeu
const HEADS: Record<string, { face: string[]; side: string[]; top: string[]; pal: Record<string, string> }> = {
  skeleton_skull: {
    face: ['aaaaaaaa', 'abaaaaba', 'aaaaaaaa', 'addaadda', 'addaadda', 'aaaddaaa', 'adadadad', 'baaaaaab'],
    side: ['aaaaaaaa', 'aaabaaaa', 'aaaaaaba', 'abaaaaaa', 'aaaaaaaa', 'aaaaabaa', 'abaaaaaa', 'bbbbbbbb'],
    top: ['aaaaaaaa', 'abaaaaaa', 'aaaaabaa', 'aaaaaaaa', 'aabaaaaa', 'aaaaaaba', 'aaaaaaaa', 'aaabaaaa'],
    pal: { a: '#c4c4c4', b: '#a2a2a2', d: '#3c3c3c' },
  },
  zombie_head: {
    face: ['hhhhhhhh', 'gGgggGgg', 'gggggggg', 'geeggeeg', 'gggGGggg', 'ggGGGGgg', 'gggggggg', 'gGgggggG'],
    side: ['hhhhhhhh', 'hgggGggh', 'gggggggg', 'ggGggggg', 'gggggGgg', 'gggggggg', 'gGgggggg', 'gggggGgg'],
    top: ['hhhhhhhh', 'hhGhhhhh', 'hhhhhhGh', 'hhhhhhhh', 'hGhhhhhh', 'hhhhGhhh', 'hhhhhhhh', 'hhhGhhhh'],
    pal: { g: '#5c9446', G: '#457a34', h: '#2f5a24', e: '#1a2a16' },
  },
  creeper_head: {
    face: ['cCccCccc', 'cCcccCcc', 'ckkcckkc', 'ckkcckkc', 'cccKKccc', 'cckkkkcc', 'cckkkkcc', 'cckccKcc'],
    side: ['cCccCccc', 'cccCcccc', 'cccccCcc', 'cCcccccc', 'ccccCccc', 'ccCccccc', 'cccccCcc', 'cCcccccc'],
    top: ['cCccCccc', 'cccCcccc', 'ccccccCc', 'cCcccccc', 'cccCcccc', 'cccccCcc', 'cCcccccc', 'ccccCccc'],
    pal: { c: '#5aae44', C: '#3f8c2e', k: '#111111', K: '#1c1c1c' },
  },
  player_head: {
    face: ['hhhhhhhh', 'hhhhhhhh', 'hssssssh', 'swbssbws', 'sssnnsss', 'ssmmmmss', 'smsssssm', 'ssssssss'],
    side: ['hhhhhhhh', 'hhhhhhhh', 'hhhhhhss', 'hhhhssss', 'hhhsssss', 'hhssssss', 'hsssssss', 'ssssssss'],
    top: ['hhhhhhhh', 'hhhHhhhh', 'hhhhhhHh', 'hhhhhhhh', 'hHhhhhhh', 'hhhhHhhh', 'hhhhhhhh', 'hhHhhhhh'],
    pal: { h: '#3f2a15', H: '#33220f', s: '#b4846d', w: '#ffffff', b: '#523d89', n: '#9a6650', m: '#6a4030' },
  },
  piglin_head: {
    face: ['pppppppp', 'pPpppPpp', 'pwkppkwp', 'pppppppp', 'ppnnnnpp', 'ppnknkpp', 'ppnnnnpp', 'tpppppPt'],
    side: ['pppppppp', 'pppPpppp', 'pppppppp', 'ePpppppp', 'eepppppp', 'eppppPpp', 'pppppppp', 'pPpppppp'],
    top: ['pppppppp', 'pPpppppp', 'ppppPppp', 'pppppppp', 'ppPppppp', 'pppppPpp', 'pppppppp', 'pppPpppp'],
    pal: { p: '#e8a3a0', P: '#d08c88', n: '#f0b8b0', k: '#3a1c1c', w: '#ffffff', e: '#c47a76', t: '#f0e0b0' },
  },
  dragon_head: {
    face: ['dddddddd', 'dDdddDdd', 'dpPddPpd', 'dddddddd', 'dDddddDd', 'dddddddd', 'dkdddkdd', 'dddddddd'],
    side: ['dddddddd', 'dddDdddd', 'dddddDdd', 'dDdddddd', 'ddddDddd', 'dddddddd', 'dddDdddd', 'DDDDDDDD'],
    top: ['dDddddDd', 'dDddddDd', 'dddddddd', 'ddDddDdd', 'dddddddd', 'ddddDddd', 'dDdddddd', 'dddddddd'],
    pal: { d: '#1d1d22', D: '#2c2c34', p: '#d96cf0', P: '#f0b8ff', k: '#0a0a0c' },
  },
};
for (const [k, h] of Object.entries(HEADS)) {
  registerPainter(`${k}_face`, pix(h.face, h.pal));
  registerPainter(`${k}_side`, pix(h.side, h.pal));
  registerPainter(`${k}_top`, pix(h.top, h.pal));
}
// pot décoré (terre cuite)
registerPainter('decorated_pot_side', (t) => {
  t.grain(paint.ramp('#9a5a3e', 4, 0.08), 0.3, 2);
  t.hline(0, 15, 1, hex('#6e3e2a'));
  t.hline(0, 15, 14, hex('#6e3e2a'));
  for (let x = 2; x < 14; x += 4) t.rect(x, 5, 2, 6, hex('#7a4630'));
});
registerPainter('decorated_pot_top', (t) => {
  t.grain(paint.ramp('#a86448', 4, 0.08), 0.3, 2);
  t.rect(5, 5, 6, 6, hex('#3a2016'));
});
// coffres : piégé (loquet et liseré rouges) et cuivre (4 stades d'oxydation)
const chestPainters = (prefix: string, wood: ((t: Tile) => void), edge: string, latch: string, line: string) => {
  registerPainter(`${prefix}_top`, (t) => { wood(t); t.border(hex(edge)); });
  registerPainter(`${prefix}_side`, (t) => { wood(t); t.border(hex(edge)); t.hline(0, 15, 5, hex(line)); });
  registerPainter(`${prefix}_front`, (t) => {
    wood(t);
    t.border(hex(edge));
    t.hline(0, 15, 5, hex(line));
    t.rect(7, 4, 2, 4, hex(latch));
    t.set(7, 6, hex('#3a3a3a'));
    t.set(8, 6, hex('#3a3a3a'));
  });
};
chestPainters('trapped_chest', (t) => paint.planks(t, '#a07436'), '#3a2610', '#c8c8c8', '#a82a1a');
export const COPPER_STAGES: [string, string, string][] = [
  ['', '', '#c06c50'], ['exposed_', ' exposé', '#a1806a'], ['weathered_', ' érodé', '#6c9e72'], ['oxidized_', ' oxydé', '#52a387'],
];
for (const [p, , col] of COPPER_STAGES) chestPainters(`${p}copper_chest`, (t) => void paint.mineral(t, col, 'metal'), shade(col, 0.6), shade(col, 1.25), shade(col, 0.7));

/** Nom français d'une variante cirée (accord du premier mot). */
function waxedName(name: string): string {
  const first = name.split(' ')[0];
  if (/^(Barreaux)$/.test(first)) return `${name} cirés`;
  if (/^(Dalle|Porte|Trappe|Lanterne|Chaîne|Ampoule|Grille)$/.test(first)) return `${name} cirée`;
  return `${name} ciré`;
}
/** Blocs de cuivre qui ont une variante cirée dans le jeu original. */
const WAXABLE = /^((exposed_|weathered_|oxidized_)?(copper|cut_copper|cut_copper_slab|cut_copper_stairs|chiseled_copper|copper_grate|copper_door|copper_trapdoor|copper_bulb|copper_bars|copper_chain|copper_lantern|lightning_rod|copper_chest)|copper_block)$/;

export interface JavaContent {
  blocks: BlockDef[];
  items: ItemDef[];
  recipes: CraftingRecipe[];
  tags: Record<string, string[]>;
}

/**
 * Contenu Java manquant. `all` = définitions déjà assemblées (BLOCK_DEFS + supplémentaires),
 * `recipes` = recettes déjà connues (pour dériver les recettes des variantes cirées).
 */
export function buildJavaContent(all: BlockDef[], recipes: CraftingRecipe[]): JavaContent {
  const byKey = new Map(all.map((d) => [d.key, d]));
  const B: BlockDef[] = [];
  const I: ItemDef[] = [];
  const R: CraftingRecipe[] = [];
  const tags: Record<string, string[]> = {};
  const shaped = (id: string, result: string, count: number, pattern: string[], key: Record<string, string>) =>
    R.push({ id: `java:${id}`, type: 'shaped', result: { item: result, count }, pattern, key, width: Math.max(...pattern.map((p) => p.length)), height: pattern.length });
  const shapeless = (id: string, result: string, count: number, ingredients: string[]) =>
    R.push({ id: `java:${id}`, type: 'shapeless', result: { item: result, count }, ingredients, width: ingredients.length <= 4 ? 2 : 3, height: Math.ceil(ingredients.length / (ingredients.length <= 4 ? 2 : 3)) });
  const add = (d: BlockDef) => {
    if (!byKey.has(d.key)) {
      B.push(d);
      byKey.set(d.key, d);
    }
  };

  // ---------- lits (15 couleurs en plus du lit rouge) et teinture d'un lit ----------
  tags.beds = [];
  for (const [c, , h] of WOOL_COLORS) {
    const key = `${c}_bed`;
    tags.beds.push(key);
    if (c !== 'red')
      add({ key, name: `Lit ${DYE_NAMES[c]}`, textures: { top: `${c}_bed_foot`, side: `${c}_bed_side`, bottom: 'oak_planks', byMeta: [`${c}_bed_foot`, `${c}_bed_head`] }, hardness: 0.2, render: 'model', shape: 'bed', sound: 'wool', interact: 'bed', needsSupport: true, drops: [{ item: key }], color: h });
    if (c !== 'red') shaped(key, key, 1, ['###', 'XXX'], { '#': `${c}_wool`, X: 'tag:planks' });
  }
  for (const [c] of WOOL_COLORS) shapeless(`dye_${c}_bed`, `${c}_bed`, 1, [`${c}_dye`, 'tag:beds']);

  // ---------- bannières (16 couleurs, modèle 3D : mât + étendard) ----------
  for (const [c, n, h] of WOOL_COLORS) {
    const key = `${c}_banner`;
    add({ key, name: `Bannière ${n}`, textures: { all: key }, hardness: 1, tool: 'axe', render: 'model', solid: false, flammable: true, sound: 'wood', orientable: true, color: h });
    shaped(key, key, 1, ['###', '###', ' | '], { '#': `${c}_wool`, '|': 'stick' });
  }

  // ---------- têtes et crânes (créatif / butin ; aucune recette dans le jeu original) ----------
  const HEAD_NAMES: Record<string, string> = { skeleton_skull: 'Crâne de squelette', zombie_head: 'Tête de zombie', creeper_head: 'Tête de creeper', dragon_head: 'Tête de dragon', piglin_head: 'Tête de piglin', player_head: 'Tête de joueur' };
  for (const [k, name] of Object.entries(HEAD_NAMES))
    add({ key: k, name, textures: { top: `${k}_top`, bottom: `${k}_top`, side: `${k}_side`, front: `${k}_face` }, hardness: 1, render: 'model', sound: 'stone', orientable: true, color: HEADS[k].pal[Object.keys(HEADS[k].pal)[0]] });

  // ---------- coffres : piégé, cuivre (4 stades) et versions cirées ----------
  const chest = byKey.get('chest')!;
  add({ ...chest, key: 'trapped_chest', name: 'Coffre piégé', textures: { top: 'trapped_chest_top', bottom: 'trapped_chest_top', side: 'trapped_chest_side', front: 'trapped_chest_front' }, drops: undefined });
  shapeless('trapped_chest', 'trapped_chest', 1, ['chest', 'tripwire_hook']);
  for (const [p, adj, col] of COPPER_STAGES) {
    const t = `${p}copper_chest`;
    add({ key: t, name: `Coffre en cuivre${adj}`, textures: { top: `${t}_top`, bottom: `${t}_top`, side: `${t}_side`, front: `${t}_front` }, hardness: 3, tool: 'pickaxe', minTier: 0, render: 'model', shape: 'chest', sound: 'metal', interact: 'chest', orientable: true, color: col });
  }
  shaped('copper_chest', 'copper_chest', 1, ['CCC', 'C#C', 'CCC'], { C: 'copper_ingot', '#': 'chest' });

  // ---------- pot décoré ----------
  add({ key: 'decorated_pot', name: 'Pot décoré', textures: { top: 'decorated_pot_top', bottom: 'decorated_pot_top', side: 'decorated_pot_side' }, hardness: 0, render: 'model', sound: 'stone', color: '#9a5a3e' });
  // briques ou tessons de poterie (#decorated_pot_ingredients), en losange
  tags.decorated_pot_ingredients = ['brick', ...['angler', 'archer', 'arms_up', 'blade', 'brewer', 'burn', 'danger', 'explorer', 'flow', 'friend', 'guster', 'heart', 'heartbreak', 'howl', 'miner', 'mourner', 'plenty', 'prize', 'scrape', 'sheaf', 'shelter', 'skull', 'snort'].map((s) => `${s}_pottery_sherd`)];
  shaped('decorated_pot', 'decorated_pot', 1, [' # ', '# #', ' # '], { '#': 'tag:decorated_pot_ingredients' });

  // ---------- plaques de pression pondérées, bouton et plaque en pierre noire polie ----------
  const plate = (key: string, name: string, tex: string, color: string, sound: BlockDef['sound']) =>
    add({ key, name, textures: { all: tex }, hardness: 0.5, tool: 'pickaxe', minTier: 1, render: 'model', shape: 'plate', solid: false, sound, needsSupport: true, color });
  plate('light_weighted_pressure_plate', 'Plaque de pression pondérée légère', 'gold_block', '#f6d03d', 'metal');
  plate('heavy_weighted_pressure_plate', 'Plaque de pression pondérée lourde', 'iron_block', '#d8d8d8', 'metal');
  plate('polished_blackstone_pressure_plate', 'Plaque de pression en pierre noire polie', 'polished_blackstone', '#35303b', 'stone');
  shaped('light_weighted_pressure_plate', 'light_weighted_pressure_plate', 1, ['##'], { '#': 'gold_ingot' });
  shaped('heavy_weighted_pressure_plate', 'heavy_weighted_pressure_plate', 1, ['##'], { '#': 'iron_ingot' });
  shaped('polished_blackstone_pressure_plate', 'polished_blackstone_pressure_plate', 1, ['##'], { '#': 'polished_blackstone' });
  const button = byKey.get('stone_button');
  if (button) add({ ...button, key: 'polished_blackstone_button', name: 'Bouton en pierre noire polie', textures: { all: 'polished_blackstone' }, drops: undefined, color: '#35303b' });
  shapeless('polished_blackstone_button', 'polished_blackstone_button', 1, ['polished_blackstone']);

  // ---------- dalles, escaliers et murets manquants ----------
  const variant = (key: string, name: string, base: string, shape: 'slab' | 'stairs' | 'wall', hardness: number, o: Partial<BlockDef> = {}) => {
    const b = byKey.get(base);
    if (!b) return;
    add({ key, name, textures: { ...(b.textures ?? { all: base }) }, hardness, tool: b.tool ?? 'pickaxe', minTier: b.minTier ?? 1, render: 'model', shape, sound: b.sound ?? 'stone', flammable: b.flammable, color: b.color, ...o });
    if (o.drops) return;
    if (shape === 'slab') shaped(key, key, 6, ['###'], { '#': base });
    else if (shape === 'stairs') shaped(key, key, 4, ['#  ', '## ', '###'], { '#': base });
    else shaped(key, key, 6, ['###', '###'], { '#': base });
  };
  // dalle de chêne pétrifiée : objet créatif sans recette (se casse à la pioche)
  {
    const oak = byKey.get('oak_planks')!;
    add({ key: 'petrified_oak_slab', name: 'Dalle en chêne pétrifiée', textures: { ...oak.textures }, hardness: 2, tool: 'pickaxe', minTier: 1, render: 'model', shape: 'slab', sound: 'stone', color: oak.color });
  }
  variant('cut_sandstone_slab', 'Dalle en grès taillé', 'cut_sandstone', 'slab', 2);
  variant('cut_red_sandstone_slab', 'Dalle en grès rouge taillé', 'cut_red_sandstone', 'slab', 2);
  variant('smooth_red_sandstone_slab', 'Dalle en grès rouge lisse', 'smooth_red_sandstone', 'slab', 2);
  variant('smooth_red_sandstone_stairs', 'Escalier en grès rouge lisse', 'smooth_red_sandstone', 'stairs', 2);
  variant('prismarine_brick_slab', 'Dalle en briques de prismarine', 'prismarine_bricks', 'slab', 1.5);
  variant('prismarine_brick_stairs', 'Escalier en briques de prismarine', 'prismarine_bricks', 'stairs', 1.5);
  variant('resin_brick_slab', 'Dalle en briques de résine', 'resin_bricks', 'slab', 1.5);
  variant('resin_brick_stairs', 'Escalier en briques de résine', 'resin_bricks', 'stairs', 1.5);
  variant('resin_brick_wall', 'Muret en briques de résine', 'resin_bricks', 'wall', 1.5);
  variant('bamboo_mosaic_slab', 'Dalle en mosaïque de bambou', 'bamboo_mosaic', 'slab', 2, { tool: 'axe', minTier: 0, sound: 'wood', flammable: true });
  variant('bamboo_mosaic_stairs', 'Escalier en mosaïque de bambou', 'bamboo_mosaic', 'stairs', 2, { tool: 'axe', minTier: 0, sound: 'wood', flammable: true });
  shaped('chiseled_resin_bricks', 'chiseled_resin_bricks', 1, ['#', '#'], { '#': 'resin_brick_slab' });

  // ---------- blocs infestés (poisson d'argent caché : rien ne tombe, le monstre sort) ----------
  const INFESTED: [string, number][] = [['stone', 0.75], ['cobblestone', 1], ['stone_bricks', 0.75], ['mossy_stone_bricks', 0.75], ['cracked_stone_bricks', 0.75], ['chiseled_stone_bricks', 0.75], ['deepslate', 1.5]];
  for (const [base, hardness] of INFESTED) {
    const b = byKey.get(base);
    if (!b) continue;
    const plural = /^Pierres /.test(b.name);
    const fem = /^(Pierre|Ardoise|Roche)/.test(b.name);
    add({ ...b, key: `infested_${base}`, name: `${b.name} infesté${fem ? 'e' : ''}${plural ? 's' : ''}`, hardness, tool: 'pickaxe', minTier: 0, drops: [], spawnOnBreak: 'silverfish' });
  }

  // ---------- cuivre ciré : même aspect, ne s'oxyde pas ----------
  const waxedOf = new Map<string, string>();
  for (const d of [...byKey.values()]) {
    if (!WAXABLE.test(d.key)) continue;
    const key = `waxed_${d.key}`;
    waxedOf.set(d.key, key);
    add({ ...d, key, name: waxedName(d.name), drops: d.drops?.map((x) => (x.item === d.key ? { ...x, item: key } : x)) });
    shapeless(`${key}_from_honeycomb`, key, 1, [d.key, 'honeycomb']);
  }
  // recettes des blocs cirés (cuivre taillé, dalles, escaliers, cuivre sculpté, grilles, ampoules) :
  // celles des blocs non cirés, ingrédients et résultat remplacés par leur version cirée
  const isBlockIng = (k: string) => waxedOf.has(k) && !/door|trapdoor|bars|chain|lantern|lightning_rod|chest/.test(k);
  for (const r of recipes) {
    const ings = r.type === 'shaped' ? Object.values(r.key ?? {}) : r.ingredients ?? [];
    if (!waxedOf.has(r.result.item) || !ings.some(isBlockIng)) continue;
    const sw = (k: string) => (isBlockIng(k) ? waxedOf.get(k)! : k);
    const id = `waxed_${r.id.replace(/^[a-z]+:/, '')}`;
    if (r.type === 'shaped') shaped(id, waxedOf.get(r.result.item)!, r.result.count, r.pattern!, Object.fromEntries(Object.entries(r.key!).map(([c, k]) => [c, sw(k)])));
    else shapeless(id, waxedOf.get(r.result.item)!, r.result.count, r.ingredients!.map(sw));
  }
  shapeless('copper_ingot_from_waxed_copper_block', 'copper_ingot', 9, ['waxed_copper_block']);
  shaped('bolt_armor_trim_smithing_template_from_waxed', 'bolt_armor_trim_smithing_template', 2, ['#S#', '#C#', '###'], { '#': 'diamond', S: 'bolt_armor_trim_smithing_template', C: 'waxed_copper_block' });

  // ---------- objets sans bloc propre ----------
  // sable / gravier suspects et ghast desséché : posent le premier état du bloc du pack
  I.push({ key: 'suspicious_sand', name: 'Sable suspect', icon: { block: 'suspicious_sand_0' }, place: 'suspicious_sand_0', tab: 'nature' });
  I.push({ key: 'suspicious_gravel', name: 'Gravier suspect', icon: { block: 'suspicious_gravel_0' }, place: 'suspicious_gravel_0', tab: 'nature' });
  shaped('dried_ghast', 'dried_ghast', 1, ['###', '#X#', '###'], { '#': 'ghast_tear', X: 'soul_sand' });
  I.push({ key: 'dried_ghast', name: 'Ghast desséché', icon: { block: 'dried_ghast_hydration_0' }, place: 'dried_ghast_hydration_0', tab: 'nature' });
  I.push({ key: 'recovery_compass', name: 'Boussole de récupération', icon: { sprite: 'compass', colors: ['#2a4a5a', '#40e0d0'] }, maxStack: 1, tab: 'tools', description: 'Indique le lieu de la dernière mort.' });
  shaped('recovery_compass', 'recovery_compass', 1, ['###', '#C#', '###'], { '#': 'echo_shard', C: 'compass' });
  I.push({ key: 'tipped_arrow', name: 'Flèche à effet', icon: { sprite: 'arrow', colors: ['#8a6a3c', '#385dc6', '#f0f0f0'] }, tab: 'combat' });
  // 8 flèches autour d'une potion persistante → 8 flèches à effet (l'effet suit la potion : CraftingGrid.result)
  shaped('tipped_arrow', 'tipped_arrow', 8, ['AAA', 'APA', 'AAA'], { A: 'arrow', P: 'lingering_potion' });

  // ---------- recettes Java manquantes ou différentes ----------
  shaped('snow', 'snow', 6, ['###'], { '#': 'snow_block' });
  shapeless('magenta_dye_from_blue_red_white_dye', 'magenta_dye', 4, ['blue_dye', 'red_dye', 'red_dye', 'white_dye']);
  // 1.21.6 : étiquette = papier + pépite de métal (#metal_nuggets)
  tags.metal_nuggets = ['iron_nugget', 'gold_nugget'];
  shaped('name_tag', 'name_tag', 1, [' #', 'P '], { '#': 'tag:metal_nuggets', P: 'paper' });
  // escaliers et dalles de grès : grès, grès sculpté ou grès taillé (comme le jeu original)
  tags.sandstone_stairs_materials = ['sandstone', 'chiseled_sandstone', 'cut_sandstone'];
  tags.red_sandstone_stairs_materials = ['red_sandstone', 'chiseled_red_sandstone', 'cut_red_sandstone'];
  tags.sandstone_slab_materials = ['sandstone', 'chiseled_sandstone'];
  tags.red_sandstone_slab_materials = ['red_sandstone', 'chiseled_red_sandstone'];
  shaped('sandstone_stairs_any', 'sandstone_stairs', 4, ['#  ', '## ', '###'], { '#': 'tag:sandstone_stairs_materials' });
  shaped('red_sandstone_stairs_any', 'red_sandstone_stairs', 4, ['#  ', '## ', '###'], { '#': 'tag:red_sandstone_stairs_materials' });
  shaped('sandstone_slab_any', 'sandstone_slab', 6, ['###'], { '#': 'tag:sandstone_slab_materials' });
  shaped('red_sandstone_slab_any', 'red_sandstone_slab', 6, ['###'], { '#': 'tag:red_sandstone_slab_materials' });
  // ragoût suspect : bol + champignon brun + champignon rouge + petite fleur
  tags.small_flowers = ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'open_eyeblossom', 'closed_eyeblossom'];
  shapeless('suspicious_stew', 'suspicious_stew', 1, ['bowl', 'brown_mushroom', 'red_mushroom', 'tag:small_flowers']);

  return { blocks: B, items: I, recipes: R, tags };
}

/** Recettes du jeu à remplacer par la version Java 1.21.11 (identifiant → nouvelle recette). */
export const JAVA_RECIPE_FIXES: Record<string, Pick<CraftingRecipe, 'pattern' | 'key' | 'result' | 'width' | 'height'>> = {
  // 1.21.6 : la laisse ne demande plus de boule de slime (5 ficelles → 2 laisses)
  'extra:lead': { result: { item: 'lead', count: 2 }, pattern: ['~~ ', '~~ ', '  ~'], key: { '~': 'string' }, width: 3, height: 3 },
};
