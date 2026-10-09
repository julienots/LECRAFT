/**
 * Modèles 3D des blocs non cubiques, au format des modèles de blocs du jeu de référence
 * (éléments « from / to » en pixels, faces avec UV et rotation, rotation d'élément à 22,5° / 45°).
 * Les textures sont des noms de tuiles (celles du pack de ressources quand il est installé).
 * Données pures : partagées par le thread principal et le worker (mesher).
 */
export type FaceName = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';
export interface JFace {
  /** Tuile. */
  t: string;
  /** UV [u0, v0, u1, v1] en pixels, v vers le bas (convention des modèles du jeu). */
  uv?: number[];
  /** Rotation de la texture (0, 90, 180, 270). */
  rot?: number;
  /** Face translucide (verre de la balise). */
  trans?: boolean;
}
export interface JElement {
  from: number[];
  to: number[];
  faces: Partial<Record<FaceName, JFace>>;
  rot?: { o: number[]; axis: 'x' | 'y' | 'z'; a: number; rescale?: boolean };
  /** Faces visibles des deux côtés (cubes à trous : on voit l'intérieur). */
  both?: boolean;
}
export interface JModel {
  els: JElement[];
  /** La méta (0 sud, 1 ouest, 2 nord, 3 est) tourne le modèle (modèle décrit face au nord). */
  facing?: boolean;
  /** Boîtes de collision (pixels) ; défaut : englobante des éléments. [] = traversable. */
  collision?: number[][];
  /** Quarts de tour horaires imposés (vue de dessus). */
  steps?: number;
  /** Un modèle par méta (torches : 0 au sol, 1..4 au mur). */
  variants?: JModel[];
}

type Tex = string | Partial<Record<FaceName | 'side' | 'all', string>>;
const SIDES: FaceName[] = ['north', 'south', 'west', 'east'];
const ALL: FaceName[] = ['down', 'up', ...SIDES];

/** Élément boîte : textures par face (`side` = 4 côtés, `all` = toutes), UV par défaut (position). */
export function box(from: number[], to: number[], tex: Tex, o: { uv?: Partial<Record<FaceName | 'side' | 'all', number[]>>; skip?: FaceName[]; rot?: JElement['rot']; both?: boolean; trans?: boolean; frot?: Partial<Record<FaceName, number>> } = {}): JElement {
  const faces: JElement['faces'] = {};
  for (const f of ALL) {
    if (o.skip?.includes(f)) continue;
    const side = SIDES.includes(f);
    const t = typeof tex === 'string' ? tex : tex[f] ?? (side ? tex.side : undefined) ?? tex.all;
    if (!t) continue;
    const uv = o.uv?.[f] ?? (side ? o.uv?.side : undefined) ?? o.uv?.all;
    faces[f] = { t, uv, rot: o.frot?.[f], trans: o.trans };
  }
  return { from, to, faces, rot: o.rot, both: o.both };
}

/** Deux plans en croix (plantes, chaînes), hauteur y0..y1. */
export function cross(t: string, y0 = 0, y1 = 16, uv?: number[], w = 7.2): JElement[] {
  const a = 8 - w, b = 8 + w;
  const r = { o: [8, 8, 8], axis: 'y' as const, a: 45, rescale: true };
  const u = uv ?? [0, 16 - (y1 - y0), 16, 16];
  return [
    { from: [a, y0, 8], to: [b, y1, 8], faces: { north: { t, uv: u }, south: { t, uv: u } }, rot: r },
    { from: [8, y0, a], to: [8, y1, b], faces: { west: { t, uv: u }, east: { t, uv: u } }, rot: r },
  ];
}

/** Culture (quatre plans en dièse), comme le blé. */
export function crop(t: string, y0 = -1, y1 = 15): JElement[] {
  const u = [0, 0, 16, 16];
  return [
    { from: [4, y0, 0], to: [4, y1, 16], faces: { west: { t, uv: u }, east: { t, uv: u } } },
    { from: [12, y0, 0], to: [12, y1, 16], faces: { west: { t, uv: u }, east: { t, uv: u } } },
    { from: [0, y0, 4], to: [16, y1, 4], faces: { north: { t, uv: u }, south: { t, uv: u } } },
    { from: [0, y0, 12], to: [16, y1, 12], faces: { north: { t, uv: u }, south: { t, uv: u } } },
  ];
}

/** Plan horizontal (rails, poudre, tapis de pétales), visible des deux côtés. */
export function flat(t: string, y = 0.25): JElement[] {
  return [{ from: [0, y, 0], to: [16, y, 16], faces: { up: { t, uv: [0, 0, 16, 16] }, down: { t, uv: [0, 16, 16, 0] } } }];
}

/** Cube entier dont les faces se voient des deux côtés (générateurs, grilles, racines). */
export function cage(tex: Tex): JElement[] {
  return [box([0, 0, 0], [16, 16, 16], tex, { both: true })];
}

const M: Record<string, JModel> = {};
const def = (keys: string | string[], m: JModel) => {
  for (const k of Array.isArray(keys) ? keys : [keys]) M[k] = m;
};

// ---------- lanternes, chaînes, bougies ----------
const lantern = (t: string): JModel => ({
  els: [
    box([5, 0, 5], [11, 7, 11], t, { uv: { side: [0, 2, 6, 9], up: [0, 9, 6, 15], down: [0, 9, 6, 15] } }),
    box([6, 7, 6], [10, 9, 10], t, { uv: { side: [1, 0, 5, 2], up: [1, 10, 5, 14] }, skip: ['down'] }),
    ...cross(t, 9, 11, [11, 1, 14, 3], 1.5),
  ],
  collision: [[5, 0, 5, 11, 9, 11]],
});
for (const k of ['lantern', 'soul_lantern', 'copper_lantern', 'exposed_copper_lantern', 'weathered_copper_lantern', 'oxidized_copper_lantern']) def(k, lantern(k));
const chain = (t: string): JModel => ({
  els: [
    { from: [6.5, 0, 8], to: [9.5, 16, 8], faces: { north: { t, uv: [0, 0, 3, 16] }, south: { t, uv: [0, 0, 3, 16] } }, rot: { o: [8, 8, 8], axis: 'y', a: 45 } },
    { from: [8, 0, 6.5], to: [8, 16, 9.5], faces: { west: { t, uv: [3, 0, 6, 16] }, east: { t, uv: [3, 0, 6, 16] } }, rot: { o: [8, 8, 8], axis: 'y', a: 45 } },
  ],
  collision: [[6.5, 0, 6.5, 9.5, 16, 9.5]],
});
for (const k of ['iron_chain', 'copper_chain', 'exposed_copper_chain', 'weathered_copper_chain', 'oxidized_copper_chain']) def(k, chain(k));
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
for (const c of ['', ...COLORS.map((x) => `${x}_`)])
  for (const lit of ['', '_lit']) {
    const t = `${c}candle${lit}`;
    def(t, {
      els: [
        box([7, 0, 7], [9, 6, 9], t, { uv: { side: [0, 8, 2, 14], up: [0, 6, 2, 8], down: [0, 14, 2, 16] } }),
        ...cross(t, 6, 7, [0, 5, 1, 6], 0.5),
      ],
      collision: [[6, 0, 6, 10, 6, 10]],
    });
  }

// ---------- objets du quotidien ----------
def('cake', { els: [box([1, 0, 1], [15, 8, 15], { up: 'cake_top', down: 'cake_bottom', side: 'cake_side' })] });
const pot = [
  box([5, 0, 5], [6, 6, 11], 'flower_pot'),
  box([10, 0, 5], [11, 6, 11], 'flower_pot'),
  box([6, 0, 5], [10, 6, 6], 'flower_pot'),
  box([6, 0, 10], [10, 6, 11], 'flower_pot'),
  box([6, 0, 6], [10, 4, 10], { up: 'dirt', down: 'flower_pot' }, { skip: SIDES }),
];
def('flower_pot', { els: pot, collision: [[5, 0, 5, 11, 6, 11]] });
def('crimson_roots_pot', { els: [...pot, ...cross('crimson_roots_pot', 4, 16)], collision: [[5, 0, 5, 11, 6, 11]] });
def('warped_roots_pot', { els: [...pot, ...cross('warped_roots_pot', 4, 16)], collision: [[5, 0, 5, 11, 6, 11]] });
for (const k of ['potted_azalea_bush', 'potted_flowering_azalea_bush'])
  def(`${k}_plant`, {
    els: [...pot, box([4, 8, 4], [12, 16, 12], { up: `${k}_top`, side: `${k}_side` }, { uv: { side: [4, 0, 12, 8] }, skip: ['down'], both: true }), ...cross(`${k}_plant`, 4, 16)],
    collision: [[5, 0, 5, 11, 6, 11]],
  });

const cauldronWalls = (inner: string) => [
  box([0, 3, 0], [2, 16, 16], { side: 'cauldron_side', up: 'cauldron_top', east: inner }, { skip: ['down'] }),
  box([14, 3, 0], [16, 16, 16], { side: 'cauldron_side', up: 'cauldron_top', west: inner }, { skip: ['down'] }),
  box([2, 3, 0], [14, 16, 2], { side: 'cauldron_side', up: 'cauldron_top', south: inner }, { skip: ['down', 'west', 'east'] }),
  box([2, 3, 14], [14, 16, 16], { side: 'cauldron_side', up: 'cauldron_top', north: inner }, { skip: ['down', 'west', 'east'] }),
  box([2, 3, 2], [14, 4, 14], { up: inner, down: 'cauldron_bottom' }, { skip: SIDES }),
  ...[[0, 0], [12, 0], [0, 12], [12, 12]].map(([x, z]) => box([x, 0, z], [x + 4, 3, z + 4], { side: 'cauldron_side', down: 'cauldron_bottom' }, { skip: ['up'] })),
];
def('cauldron', { els: cauldronWalls('cauldron_inner'), collision: [[0, 0, 0, 16, 4, 16], [0, 0, 0, 2, 16, 16], [14, 0, 0, 16, 16, 16], [0, 0, 0, 16, 16, 2], [0, 0, 14, 16, 16, 16]] });
def('water_cauldron', { els: [...cauldronWalls('cauldron_inner'), box([2, 4, 2], [14, 15, 14], { up: 'water' }, { skip: [...SIDES, 'down'], trans: true })] });

def('hopper', {
  els: [
    box([0, 10, 0], [16, 11, 16], { up: 'hopper_inside', down: 'hopper_outside', side: 'hopper_outside' }),
    box([0, 11, 0], [2, 16, 16], { side: 'hopper_outside', up: 'hopper_top', east: 'hopper_outside' }, { skip: ['down'] }),
    box([14, 11, 0], [16, 16, 16], { side: 'hopper_outside', up: 'hopper_top', west: 'hopper_outside' }, { skip: ['down'] }),
    box([2, 11, 0], [14, 16, 2], { side: 'hopper_outside', up: 'hopper_top' }, { skip: ['down', 'west', 'east'] }),
    box([2, 11, 14], [14, 16, 16], { side: 'hopper_outside', up: 'hopper_top' }, { skip: ['down', 'west', 'east'] }),
    box([4, 4, 4], [12, 10, 12], 'hopper_outside', { skip: ['up'] }),
    box([6, 0, 6], [10, 4, 10], 'hopper_outside', { skip: ['up'] }),
  ],
  collision: [[0, 10, 0, 16, 16, 16], [4, 4, 4, 12, 10, 12]],
});

const anvil = (top: string): JModel => ({
  facing: true,
  els: [
    box([2, 0, 2], [14, 4, 14], 'anvil'),
    box([4, 4, 3], [12, 5, 13], 'anvil', { skip: ['down'] }),
    box([6, 5, 4], [10, 10, 12], 'anvil', { skip: ['down', 'up'] }),
    box([3, 10, 0], [13, 16, 16], { up: top, all: 'anvil' }, { uv: { up: [3, 0, 13, 16] } }),
  ],
});
def('anvil', anvil('anvil_top'));
def('chipped_anvil', anvil('chipped_anvil_top'));
def('damaged_anvil', anvil('damaged_anvil_top'));

def('bell', {
  facing: true,
  els: [
    box([5, 6, 5], [11, 13, 11], { side: 'bell_side', up: 'bell_top' }, { uv: { side: [1, 0, 7, 7], up: [1, 1, 7, 7] }, skip: ['down'] }),
    box([4, 4, 4], [12, 6, 12], { side: 'bell_side', up: 'bell_top', down: 'bell_bottom' }, { uv: { side: [0, 7, 8, 9], up: [0, 0, 8, 8], down: [0, 0, 8, 8] } }),
    box([2, 0, 6], [4, 16, 10], 'dark_oak_planks'),
    box([12, 0, 6], [14, 16, 10], 'dark_oak_planks'),
    box([4, 13, 7], [12, 15, 9], 'stone', { skip: ['west', 'east'] }),
  ],
  collision: [[2, 0, 6, 14, 16, 10]],
});

def('brewing_stand', {
  els: [
    box([9, 0, 5], [15, 2, 11], 'brewing_stand_base'),
    box([2, 0, 1], [8, 2, 7], 'brewing_stand_base'),
    box([2, 0, 9], [8, 2, 15], 'brewing_stand_base'),
    box([7, 0, 7], [9, 14, 9], 'brewing_stand', { uv: { side: [7, 2, 9, 16], up: [7, 0, 9, 2] } }),
    { from: [8, 0, 1], to: [8, 16, 15], faces: { west: { t: 'brewing_stand', uv: [1, 0, 15, 16] }, east: { t: 'brewing_stand', uv: [15, 0, 1, 16] } } },
    { from: [1, 0, 8], to: [15, 16, 8], faces: { north: { t: 'brewing_stand', uv: [1, 0, 15, 16] }, south: { t: 'brewing_stand', uv: [15, 0, 1, 16] } } },
  ],
  collision: [[1, 0, 1, 15, 2, 15], [7, 0, 7, 9, 14, 9]],
});

def('enchanting_table', { els: [box([0, 0, 0], [16, 12, 16], { up: 'enchanting_table_top', down: 'enchanting_table_bottom', side: 'enchanting_table_side' })] });
def('stonecutter', {
  facing: true,
  els: [
    box([0, 0, 0], [16, 9, 16], { up: 'stonecutter_top', down: 'stonecutter_bottom', side: 'stonecutter_side' }),
    { from: [1, 9, 8], to: [15, 16, 8], faces: { north: { t: 'stonecutter_saw', uv: [1, 9, 15, 16] }, south: { t: 'stonecutter_saw', uv: [1, 9, 15, 16] } } },
  ],
  collision: [[0, 0, 0, 16, 9, 16]],
});
def('lectern', {
  facing: true,
  els: [
    box([0, 0, 0], [16, 2, 16], { all: 'lectern_base' }, { uv: { side: [0, 14, 16, 16] } }),
    box([4, 2, 4], [12, 15, 12], { north: 'lectern_front', south: 'lectern_front', side: 'lectern_sides' }, { uv: { north: [4, 1, 12, 14], south: [4, 1, 12, 14], west: [2, 3, 10, 16], east: [2, 3, 10, 16] }, skip: ['up', 'down'] }),
    box([0, 12, 3], [16, 16, 16], { up: 'lectern_top', down: 'lectern_top', side: 'lectern_sides' }, { uv: { side: [0, 0, 16, 4] }, rot: { o: [8, 14, 8], axis: 'x', a: -22.5 } }),
  ],
  collision: [[0, 0, 0, 16, 15, 16]],
});
def('grindstone', {
  facing: true,
  els: [
    box([4, 4, 2], [12, 16, 14], { west: 'grindstone_side', east: 'grindstone_side', all: 'grindstone_round' }, { uv: { west: [0, 0, 12, 12], east: [0, 0, 12, 12], north: [0, 0, 8, 12], south: [0, 0, 8, 12], up: [0, 0, 8, 12], down: [0, 0, 8, 12] } }),
    box([2, 7, 5], [4, 13, 11], 'grindstone_pivot', { uv: { all: [0, 0, 6, 6] } }),
    box([12, 7, 5], [14, 13, 11], 'grindstone_pivot', { uv: { all: [0, 0, 6, 6] } }),
    box([2, 0, 6], [4, 7, 10], 'dark_oak_log'),
    box([12, 0, 6], [14, 7, 10], 'dark_oak_log'),
  ],
  collision: [[2, 0, 2, 14, 16, 14]],
});
const campfire = (log: string, fire: string | null): JModel => ({
  facing: true,
  els: [
    box([1, 0, 0], [5, 4, 16], log, { uv: { side: [0, 0, 16, 4], north: [0, 4, 4, 8], south: [0, 4, 4, 8], up: [0, 0, 16, 4], down: [0, 0, 16, 4] }, frot: { up: 90, down: 90 } }),
    box([11, 0, 0], [15, 4, 16], log, { uv: { side: [0, 0, 16, 4], north: [0, 4, 4, 8], south: [0, 4, 4, 8], up: [0, 0, 16, 4], down: [0, 0, 16, 4] }, frot: { up: 90, down: 90 } }),
    box([0, 3, 11], [16, 7, 15], log, { uv: { side: [0, 0, 16, 4], west: [0, 4, 4, 8], east: [0, 4, 4, 8], up: [0, 0, 16, 4], down: [0, 0, 16, 4] } }),
    box([0, 3, 1], [16, 7, 5], log, { uv: { side: [0, 0, 16, 4], west: [0, 4, 4, 8], east: [0, 4, 4, 8], up: [0, 0, 16, 4], down: [0, 0, 16, 4] } }),
    box([5, 0, 0], [11, 1, 16], log, { uv: { up: [0, 8, 16, 14], side: [0, 15, 16, 16] }, frot: { up: 90 } }),
    ...(fire ? cross(fire, 1, 17, [0, 0, 16, 16]) : []),
  ],
  collision: [[0, 0, 0, 16, 7, 16]],
});
def('campfire', campfire('campfire_log_lit', 'campfire_fire'));
def('soul_campfire', campfire('soul_campfire_log_lit', 'soul_campfire_fire'));
def('campfire_log', campfire('campfire_log', null));
const composter = (fill: string | null, h: number): JModel => ({
  els: [
    box([0, 0, 0], [16, 2, 16], { down: 'composter_bottom', up: 'composter_bottom', side: 'composter_side' }),
    box([0, 2, 0], [2, 16, 16], { side: 'composter_side', up: 'composter_top' }, { skip: ['down'], both: true }),
    box([14, 2, 0], [16, 16, 16], { side: 'composter_side', up: 'composter_top' }, { skip: ['down'], both: true }),
    box([2, 2, 0], [14, 16, 2], { side: 'composter_side', up: 'composter_top' }, { skip: ['down', 'west', 'east'], both: true }),
    box([2, 2, 14], [14, 16, 16], { side: 'composter_side', up: 'composter_top' }, { skip: ['down', 'west', 'east'], both: true }),
    ...(fill ? [box([2, 2, 2], [14, h, 14], { up: fill }, { skip: [...SIDES, 'down'] })] : []),
  ],
});
def('composter', composter('composter_compost', 8));
def('composter_ready', composter('composter_ready', 15));
def('composter_compost', composter('composter_compost', 12));

def(['daylight_detector'], { els: [box([0, 0, 0], [16, 6, 16], { up: 'daylight_detector_top', all: 'daylight_detector_side' }, { uv: { side: [0, 10, 16, 16] } })] });
def(['daylight_detector_inverted'], { els: [box([0, 0, 0], [16, 6, 16], { up: 'daylight_detector_inverted_top', all: 'daylight_detector_side' }, { uv: { side: [0, 10, 16, 16] } })] });
const torchStub = (x: number, z: number, t: string) => box([x, 2, z], [x + 2, 7, z + 2], t, { uv: { side: [7, 6, 9, 11], up: [7, 6, 9, 8] }, skip: ['down'] });
for (const on of ['', '_on']) {
  def(`repeater${on}`, { facing: true, els: [box([0, 0, 0], [16, 2, 16], { up: `repeater${on}`, all: 'smooth_stone' }, { uv: { side: [0, 14, 16, 16] } }), torchStub(7, 2, on ? 'redstone_torch' : 'redstone_torch_off'), torchStub(7, 6, on ? 'redstone_torch' : 'redstone_torch_off')] });
  def(`comparator${on}`, { facing: true, els: [box([0, 0, 0], [16, 2, 16], { up: `comparator${on}`, all: 'smooth_stone' }, { uv: { side: [0, 14, 16, 16] } }), torchStub(4, 11, 'redstone_torch_off'), torchStub(10, 11, 'redstone_torch_off'), torchStub(7, 2, on ? 'redstone_torch' : 'redstone_torch_off')] });
}
def('scaffolding', {
  els: [
    box([0, 14, 0], [16, 16, 16], { up: 'scaffolding_top', down: 'scaffolding_bottom', side: 'scaffolding_side' }, { uv: { side: [0, 0, 16, 2] } }),
    ...[[0, 0], [14, 0], [0, 14], [14, 14]].map(([x, z]) => box([x, 0, z], [x + 2, 14, z + 2], 'scaffolding_side', { uv: { side: [0, 2, 2, 16] }, skip: ['up', 'down'] })),
    box([2, 1, 0], [14, 3, 2], 'scaffolding_side', { uv: { side: [2, 13, 14, 15] }, skip: ['west', 'east'] }),
    box([2, 1, 14], [14, 3, 16], 'scaffolding_side', { uv: { side: [2, 13, 14, 15] }, skip: ['west', 'east'] }),
  ],
  collision: [[0, 14, 0, 16, 16, 16]],
});
def('beacon', {
  els: [
    box([2, 0.1, 2], [14, 3, 14], 'obsidian'),
    box([3, 3, 3], [13, 14, 13], 'beacon'),
    box([0, 0, 0], [16, 16, 16], 'glass', { trans: true }),
  ],
  collision: [[0, 0, 0, 16, 16, 16]],
});
def('conduit', { els: [box([5, 5, 5], [11, 11, 11], 'conduit', { uv: { all: [3, 3, 9, 9] } })] });
def('heavy_core', { els: [box([4, 0, 4], [12, 8, 12], 'heavy_core', { uv: { up: [0, 0, 8, 8], down: [8, 0, 16, 8], side: [0, 8, 8, 16] } })] });
for (const k of ['lightning_rod', 'lightning_rod_on', 'exposed_lightning_rod', 'weathered_lightning_rod', 'oxidized_lightning_rod'])
  def(k, { els: [box([6, 12, 6], [10, 16, 10], k, { uv: { all: [0, 0, 4, 4] } }), box([7, 0, 7], [9, 12, 9], k, { uv: { side: [0, 4, 2, 16] }, skip: ['up'] })], collision: [[6, 0, 6, 10, 16, 10]] });
def('cocoa_stage0', { facing: true, els: [box([6, 7, 11], [10, 12, 15], 'cocoa_stage0', { uv: { side: [11, 4, 15, 9], up: [0, 0, 4, 4], down: [0, 0, 4, 4] } })] });
def('cocoa_stage1', { facing: true, els: [box([5, 5, 9], [11, 12, 15], 'cocoa_stage1', { uv: { side: [9, 4, 15, 11], up: [0, 0, 6, 6], down: [0, 0, 6, 6] } })] });
def('cocoa_stage2', { facing: true, els: [box([4, 3, 7], [12, 12, 15], 'cocoa_stage2', { uv: { side: [8, 4, 16, 13], up: [0, 0, 8, 8], down: [0, 0, 8, 8] } })] });
def('sea_pickle', { els: [box([6, 0, 6], [10, 6, 10], 'sea_pickle', { uv: { side: [0, 10, 4, 16], up: [4, 0, 8, 4], down: [8, 0, 12, 4] } })], collision: [[6, 0, 6, 10, 6, 10]] });
def('turtle_egg', { els: [box([5, 0, 4], [9, 7, 8], 'turtle_egg', { uv: { side: [1, 4, 5, 11], up: [0, 0, 4, 4], down: [0, 0, 4, 4] } })], collision: [[3, 0, 3, 12, 7, 12]] });
for (const s of ['not_cracked', 'slightly_cracked', 'very_cracked'])
  def(`sniffer_egg_${s}`, {
    facing: true,
    els: [box([1, 0, 2], [15, 16, 14], { up: `sniffer_egg_${s}_top`, down: `sniffer_egg_${s}_bottom`, north: `sniffer_egg_${s}_north`, south: `sniffer_egg_${s}_south`, west: `sniffer_egg_${s}_west`, east: `sniffer_egg_${s}_east` }, { uv: { north: [0, 0, 14, 16], south: [0, 0, 14, 16], west: [0, 0, 12, 16], east: [0, 0, 12, 16], up: [0, 0, 14, 12], down: [0, 0, 14, 12] } })],
  });
for (let i = 0; i < 4; i++) {
  const n = `dried_ghast_hydration_${i}`;
  def(n, {
    facing: true,
    els: [
      box([3, 0, 3], [13, 10, 13], { up: `${n}_top`, down: `${n}_bottom`, north: `${n}_north`, south: `${n}_south`, west: `${n}_west`, east: `${n}_east` }, { uv: { all: [0, 0, 10, 10] } }),
      { from: [3, 0, 2.9], to: [13, 5, 2.9], faces: { north: { t: `${n}_tentacles`, uv: [0, 0, 10, 5] }, south: { t: `${n}_tentacles`, uv: [0, 0, 10, 5] } } },
    ],
  });
}
def('item_frame', { facing: true, els: [box([2, 2, 15], [14, 14, 16], { north: 'item_frame', south: 'item_frame', all: 'birch_planks' }, { uv: { north: [2, 2, 14, 14], south: [2, 2, 14, 14] } })], collision: [] });
def('glow_item_frame', { facing: true, els: [box([2, 2, 15], [14, 14, 16], { north: 'glow_item_frame', south: 'glow_item_frame', all: 'birch_planks' }, { uv: { north: [2, 2, 14, 14], south: [2, 2, 14, 14] } })], collision: [] });
def('piston_head', {
  facing: true,
  els: [
    box([0, 0, 0], [16, 16, 4], { north: 'piston_top', south: 'piston_inner', side: 'piston_side' }, { uv: { side: [0, 0, 16, 4] } }),
    box([6, 6, 4], [10, 10, 16], 'piston_side', { uv: { side: [0, 4, 12, 8], up: [0, 4, 12, 8], down: [0, 4, 12, 8] }, skip: ['north'], frot: { west: 90, east: 270 } }),
  ],
});
def('big_dripleaf', {
  facing: true,
  els: [
    box([0, 15, 0], [16, 15, 16], { up: 'big_dripleaf_top', down: 'big_dripleaf_top' }, { skip: SIDES }),
    { from: [0, 11, 0], to: [16, 15, 0], faces: { north: { t: 'big_dripleaf_side', uv: [0, 12, 16, 16] }, south: { t: 'big_dripleaf_side', uv: [0, 12, 16, 16] } } },
    ...cross('big_dripleaf_stem', 0, 15),
  ],
  collision: [[0, 14, 0, 16, 15, 16]],
});
def('big_dripleaf_tip', { facing: true, els: [box([0, 15, 0], [16, 15, 16], { up: 'big_dripleaf_tip', down: 'big_dripleaf_tip' }, { skip: SIDES }), ...cross('big_dripleaf_stem', 0, 15)], collision: [[0, 14, 0, 16, 15, 16]] });
for (const k of ['azalea', 'flowering_azalea'])
  def(k, {
    els: [
      box([0, 16, 0], [16, 16, 16], { up: `${k}_top`, down: `${k}_top` }, { skip: SIDES }),
      box([0, 0, 0.1], [16, 16, 0.1], `${k}_side`, { skip: ['up', 'down', 'west', 'east'], both: true }),
      box([0, 0, 15.9], [16, 16, 15.9], `${k}_side`, { skip: ['up', 'down', 'west', 'east'], both: true }),
      box([0.1, 0, 0], [0.1, 16, 16], `${k}_side`, { skip: ['up', 'down', 'north', 'south'], both: true }),
      box([15.9, 0, 0], [15.9, 16, 16], `${k}_side`, { skip: ['up', 'down', 'north', 'south'], both: true }),
      ...cross('azalea_plant', 0, 16),
    ],
    collision: [[0, 8, 0, 16, 16, 16], [6, 0, 6, 10, 8, 10]],
  });

// ---------- sculk (demi-blocs avec vrilles) ----------
const tendrils = (t: string): JElement[] =>
  [[3, 3], [13, 3], [3, 13], [13, 13]].flatMap(([x, z]) => [
    { from: [x - 4, 8, z], to: [x + 4, 16, z], faces: { north: { t, uv: [4, 8, 12, 16] }, south: { t, uv: [4, 8, 12, 16] } }, rot: { o: [x, 8, z], axis: 'y' as const, a: 45 } },
    { from: [x, 8, z - 4], to: [x, 16, z + 4], faces: { west: { t, uv: [4, 8, 12, 16] }, east: { t, uv: [4, 8, 12, 16] } }, rot: { o: [x, 8, z], axis: 'y' as const, a: 45 } },
  ]);
def('sculk_sensor', { els: [box([0, 0, 0], [16, 8, 16], { up: 'sculk_sensor_top', down: 'sculk_sensor_bottom', side: 'sculk_sensor_side' }, { uv: { side: [0, 8, 16, 16] } }), ...tendrils('sculk_sensor_tendril_inactive')], collision: [[0, 0, 0, 16, 8, 16]] });
def('calibrated_sculk_sensor', {
  facing: true,
  els: [
    box([0, 0, 0], [16, 8, 16], { up: 'calibrated_sculk_sensor_top', down: 'sculk_sensor_bottom', side: 'sculk_sensor_side', north: 'calibrated_sculk_sensor_input_side' }, { uv: { side: [0, 8, 16, 16] } }),
    ...tendrils('sculk_sensor_tendril_active'),
    ...cross('calibrated_sculk_sensor_amethyst', 8, 16),
  ],
  collision: [[0, 0, 0, 16, 8, 16]],
});
for (const [k, top] of [['sculk_shrieker', 'sculk_shrieker_inner_top'], ['sculk_shrieker_can_summon_inner', 'sculk_shrieker_can_summon_inner_top'], ['sculk_shrieker_inner', 'sculk_shrieker_inner_top']])
  def(k, {
    els: [
      box([0, 0, 0], [16, 8, 16], { up: 'sculk_shrieker_top', down: 'sculk_shrieker_bottom', side: 'sculk_shrieker_side' }, { uv: { side: [0, 8, 16, 16] } }),
      box([1, 8, 1], [15, 15, 15], { up: top, side: 'sculk_shrieker_side' }, { uv: { side: [1, 1, 15, 8] }, skip: ['down'] }),
    ],
    collision: [[0, 0, 0, 16, 8, 16]],
  });
def('cake_inner', { els: [box([7, 0, 1], [15, 8, 15], { up: 'cake_top', down: 'cake_bottom', side: 'cake_side', west: 'cake_inner' })] });
def('spore_blossom_base', { els: [{ from: [0, 15.75, 0], to: [16, 15.75, 16], faces: { down: { t: 'spore_blossom_base', uv: [0, 0, 16, 16] }, up: { t: 'spore_blossom_base', uv: [0, 0, 16, 16] } } }], collision: [] });

// ---------- cubes à trous : intérieur visible (comme les cages des générateurs) ----------
for (const [k, tex] of [
  ['vault', { up: 'vault_top', down: 'vault_bottom', side: 'vault_side_off', north: 'vault_front_off' }],
  ['vault_on', { up: 'vault_top', down: 'vault_bottom', side: 'vault_side_on', north: 'vault_front_on' }],
  ['vault_off', { up: 'vault_top', down: 'vault_bottom', side: 'vault_side_off', north: 'vault_front_off' }],
  ['vault_ejecting', { up: 'vault_top_ejecting', down: 'vault_bottom', side: 'vault_side_on', north: 'vault_front_ejecting' }],
  ['vault_ominous', { up: 'vault_top_ominous', down: 'vault_bottom_ominous', side: 'vault_side_off_ominous', north: 'vault_front_off_ominous' }],
  ['vault_on_ominous', { up: 'vault_top_ominous', down: 'vault_bottom_ominous', side: 'vault_side_on_ominous', north: 'vault_front_on_ominous' }],
  ['vault_off_ominous', { up: 'vault_top_ominous', down: 'vault_bottom_ominous', side: 'vault_side_off_ominous', north: 'vault_front_off_ominous' }],
  ['vault_ejecting_ominous', { up: 'vault_top_ejecting_ominous', down: 'vault_bottom_ominous', side: 'vault_side_on_ominous', north: 'vault_front_ejecting_ominous' }],
  ['trial_spawner', { up: 'trial_spawner_top_inactive', down: 'trial_spawner_bottom', side: 'trial_spawner_side_inactive' }],
  ['trial_spawner_active', { up: 'trial_spawner_top_active', down: 'trial_spawner_bottom', side: 'trial_spawner_side_active' }],
  ['trial_spawner_inactive', { up: 'trial_spawner_top_inactive', down: 'trial_spawner_bottom', side: 'trial_spawner_side_inactive' }],
  ['trial_spawner_ejecting_reward', { up: 'trial_spawner_top_ejecting_reward', down: 'trial_spawner_bottom', side: 'trial_spawner_side_active' }],
  ['trial_spawner_active_ominous', { up: 'trial_spawner_top_active_ominous', down: 'trial_spawner_bottom', side: 'trial_spawner_side_active_ominous' }],
  ['trial_spawner_inactive_ominous', { up: 'trial_spawner_top_inactive_ominous', down: 'trial_spawner_bottom', side: 'trial_spawner_side_inactive_ominous' }],
  ['trial_spawner_ejecting_reward_ominous', { up: 'trial_spawner_top_ejecting_reward_ominous', down: 'trial_spawner_bottom', side: 'trial_spawner_side_active_ominous' }],
  ['spawner', { all: 'spawner' }],
  ['mangrove_roots', { up: 'mangrove_roots_top', down: 'mangrove_roots_top', side: 'mangrove_roots_side' }],
  ['copper_grate', { all: 'copper_grate' }],
  ['exposed_copper_grate', { all: 'exposed_copper_grate' }],
  ['weathered_copper_grate', { all: 'weathered_copper_grate' }],
  ['oxidized_copper_grate', { all: 'oxidized_copper_grate' }],
] as [string, Tex][])
  def(k, { facing: k.startsWith('vault'), els: cage(tex) });

// ---------- cultures et plantes à plans multiples ----------
for (let s = 0; s < 4; s++) def(`beetroots_stage${s}`, { els: crop(`beetroots_stage${s}`), collision: [] });
for (let s = 0; s < 3; s++) def(`nether_wart_stage${s}`, { els: crop(`nether_wart_stage${s}`), collision: [] });
for (let s = 0; s < 2; s++) def(`torchflower_crop_stage${s}`, { els: crop(`torchflower_crop_stage${s}`), collision: [] });
for (const k of ['rail', 'rail_corner', 'powered_rail', 'powered_rail_on', 'detector_rail', 'detector_rail_on', 'activator_rail', 'activator_rail_on', 'redstone_dust_dot', 'redstone_dust_line0', 'redstone_dust_line1', 'leaf_litter', 'pink_petals_stem', 'wildflowers', 'wildflowers_stem', 'frogspawn', 'tripwire', 'sculk_vein', 'resin_clump', 'pale_moss_carpet_side_small', 'pale_moss_carpet_side_tall'])
  def(k, { facing: true, els: flat(k, k === 'frogspawn' ? 1.5 : 0.25), collision: [] });

// ---------- torches (au sol et au mur, inclinées comme dans le jeu) ----------
const torchEls = (t: string, wall: boolean): JElement[] => {
  const uv = { side: [7, 6, 9, 16], up: [7, 6, 9, 8], down: [7, 13, 9, 15] };
  return wall
    ? [box([-1, 3.5, 7], [1, 13.5, 9], t, { uv, rot: { o: [0, 3.5, 8], axis: 'z', a: -22.5 } })]
    : [box([7, 0, 7], [9, 10, 9], t, { uv })];
};
/** Torche : variante 0 au sol, 1..4 contre le mur (côté du support : sud, ouest, nord, est). */
export function torchModel(t: string): JModel {
  return { els: [], collision: [], variants: [{ els: torchEls(t, false), collision: [] }, ...[3, 0, 1, 2].map((steps) => ({ els: torchEls(t, true), steps, collision: [] }))] };
}
const endRodEls = (): JElement[] => [
  box([7, 1, 7], [9, 16, 9], 'end_rod', { uv: { side: [0, 0, 2, 15], up: [2, 0, 4, 2], down: [2, 0, 4, 2] } }),
  box([6, 0, 6], [10, 1, 10], 'end_rod', { uv: { side: [2, 6, 6, 7], up: [2, 2, 6, 6], down: [2, 2, 6, 6] } }),
];
M.end_rod = {
  els: [],
  collision: [],
  variants: [
    { els: endRodEls(), collision: [] },
    ...[3, 0, 1, 2].map((steps) => ({ els: endRodEls().map((e) => ({ ...e, rot: { o: [8, 8, 8], axis: 'z' as const, a: -90 } })), steps, collision: [] })),
  ],
};

/** Modèles par clé de bloc. */
export const BLOCK_MODELS: Record<string, JModel> = M;

/** Toutes les tuiles citées par les modèles (enregistrées dans l'atlas). */
export function modelTiles(): string[] {
  const out = new Set<string>();
  for (const m of Object.values(M)) for (const v of [m, ...(m.variants ?? [])]) for (const e of v.els) for (const f of Object.values(e.faces)) if (f) out.add(f.t);
  return [...out];
}
