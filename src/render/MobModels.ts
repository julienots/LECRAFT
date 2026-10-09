import * as THREE from 'three';
import { build, VOXEL_MODELS } from './VoxelModels';
import { VANILLA_GEO } from '../data/vanillaGeometry';
import { geometryToModel } from '../addons/BedrockGeometry';

/**
 * Modèles des créatures.
 * - Créatures vanilla : boîtes texturées reprenant les dimensions, pivots et la disposition UV
 *   standard des modèles du jeu (texture 64x32 ou 64x64), compatibles avec les skins d'un pack.
 * - Boss propres à LeCraft : modèles voxel à couleurs de sommets (VoxelModels.ts).
 *
 * Repère « modèle vanilla » : pixels, y vers le bas, sol à y = 24, l'avant vers -Z.
 * Conversion vers notre repère (y vers le haut, avant vers +Z) : (x, 24 - y, -z) — une rotation.
 */
interface CubePart {
  uv: [number, number];
  box: [number, number, number, number, number, number]; // x0, y0, z0, w, h, d (relatif au pivot)
  pivot: [number, number, number];
  rot?: [number, number, number];
  mirror?: boolean;
  inflate?: number;
  anim?: string;
  /** UV par face (format « per-face » des modèles de l'édition Bedrock) : [u, v, largeur, hauteur]. */
  faceUV?: Partial<Record<'top' | 'bottom' | 'right' | 'front' | 'left' | 'back', [number, number, number, number]>>;
  /** Couche séparée (laine du mouton). */
  layer?: 'fur';
  /** Nom d'os (modèles d'add-ons : animations Bedrock). */
  bone?: string;
  children?: CubePart[];
}
export type { CubePart };
export interface VanillaModel {
  skin: string;
  texW: number;
  texH: number;
  parts: CubePart[];
  furSkin?: string;
  /** Entité sans rendu (entités techniques des add-ons). */
  invisible?: boolean;
  /** Couche lumineuse (yeux des araignées, endermen, dragon) : toujours éclairée. */
  glow?: string;
}

const P = (uv: [number, number], box: CubePart['box'], pivot: CubePart['pivot'], extra: Partial<CubePart> = {}): CubePart => ({ uv, box, pivot, ...extra });
const HALF_PI = Math.PI / 2;

function quadLegs(uv: [number, number], w: number, h: number, pivots: [number, number, number][], layer?: 'fur', inflate = 0): CubePart[] {
  const names = ['legBR', 'legBL', 'legFR', 'legFL'];
  return pivots.map((p, i) => P(uv, [-w / 2, 0, -w / 2, w, h, w], p, { anim: names[i], mirror: i % 2 === 1, layer, inflate }));
}

/**
 * Dragon de l'Ender : géométrie du modèle Java (texture 256×256 « enderdragon/dragon.png »).
 * Cou (5 segments) et queue (12 segments) chaînés pour onduler ; ailes en deux parties.
 * Le modèle est remonté de 24 px (OY) pour que le corps soit au centre de la boîte de collision.
 */
function dragonModel(): VanillaModel {
  const OY = -24;
  const f = -16;
  const seg = (anim: string, dz: number, child?: CubePart, top?: [number, number, number]): CubePart =>
    P([192, 104], [-5, -5, -5, 10, 10, 10], top ?? [0, 0, dz], { anim, children: [P([48, 0], [-1, -9, -3, 2, 4, 6], [0, 0, 0]), ...(child ? [child] : [])] });
  const head = P([112, 30], [-8, -8, 6 + f, 16, 16, 16], [0, 0, -10], {
    anim: 'dragonHead',
    children: [
      P([176, 44], [-6, -1, -8 + f, 12, 5, 16], [0, 0, 0]),
      P([0, 0], [-5, -12, 12 + f, 2, 4, 6], [0, 0, 0], { mirror: true }),
      P([112, 0], [-5, -3, -6 + f, 2, 2, 4], [0, 0, 0], { mirror: true }),
      P([0, 0], [3, -12, 12 + f, 2, 4, 6], [0, 0, 0]),
      P([112, 0], [3, -3, -6 + f, 2, 2, 4], [0, 0, 0]),
      P([176, 65], [-6, 0, -16, 12, 4, 16], [0, 4, 8 + f], { anim: 'dragonJaw' }),
    ],
  });
  let neck: CubePart = head;
  for (let i = 4; i >= 0; i--) neck = seg('dragonNeck', -10, neck, i === 0 ? [0, 14 + OY, -12] : undefined);
  let tail: CubePart | undefined;
  for (let i = 11; i >= 0; i--) tail = seg('dragonTail', 10, tail, i === 0 ? [0, 12 + OY, 60] : undefined);
  const wing = (side: 1 | -1): CubePart => {
    const x0 = side > 0 ? 0 : -56;
    return P([112, 88], [x0, -4, -4, 56, 8, 8], [12 * side, 5 + OY, 2], {
      anim: side > 0 ? 'dragonWingL' : 'dragonWingR', mirror: side > 0,
      children: [
        P([-56, 88], [x0, 0, 2, 56, 0, 56], [0, 0, 0], { mirror: side > 0 }),
        P([112, 136], [x0, -2, -2, 56, 4, 4], [56 * side, 0, 0], {
          anim: side > 0 ? 'dragonTipL' : 'dragonTipR', mirror: side > 0,
          children: [P([-56, 144], [x0, 0, 2, 56, 0, 56], [0, 0, 0], { mirror: side > 0 })],
        }),
      ],
    });
  };
  const leg = (side: 1 | -1, front: boolean): CubePart =>
    front
      ? P([112, 104], [-4, -4, -4, 8, 24, 8], [12 * side, 20 + OY, 2], {
          rot: [1.3, 0, 0], anim: 'dragonLeg',
          children: [P([226, 138], [-3, -1, -3, 6, 24, 6], [0, 20, -1], { rot: [-0.5, 0, 0], children: [P([144, 104], [-4, 0, -12, 8, 4, 16], [0, 23, 0], { rot: [0.75, 0, 0] })] })],
        })
      : P([0, 0], [-8, -4, -8, 16, 32, 16], [16 * side, 16 + OY, 42], {
          rot: [1.0, 0, 0], anim: 'dragonLeg',
          children: [P([196, 0], [-6, -2, 0, 12, 32, 12], [0, 32, -4], { rot: [0.5, 0, 0], children: [P([112, 0], [-9, 0, -20, 18, 6, 24], [0, 31, 4], { rot: [0.75, 0, 0] })] })],
        });
  return {
    skin: 'ender_dragon', texW: 256, texH: 256, glow: 'ender_dragon_eyes',
    parts: [
      P([0, 0], [-12, 0, -16, 24, 24, 64], [0, 4 + OY, 8], {
        children: [-10, 10, 30].map((z) => P([220, 53], [-1, -6, z, 2, 6, 12], [0, 0, 0])),
      }),
      neck,
      tail!,
      wing(1),
      wing(-1),
      leg(1, true),
      leg(-1, true),
      leg(1, false),
      leg(-1, false),
    ],
  };
}

const VANILLA: Record<string, VanillaModel> = {
  pig: {
    skin: 'pig', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-4, -4, -8, 8, 8, 8], [0, 12, -6], { anim: 'head', children: [P([16, 16], [-2, 0, -9, 4, 3, 1], [0, 0, 0])] }),
      P([28, 8], [-5, -10, -7, 10, 16, 8], [0, 11, 2], { rot: [HALF_PI, 0, 0] }),
      ...quadLegs([0, 16], 4, 6, [[-3, 18, 7], [3, 18, 7], [-3, 18, -5], [3, 18, -5]]),
    ],
  },
  cow: {
    skin: 'cow', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-4, -4, -6, 8, 8, 6], [0, 4, -8], { anim: 'head', children: [P([22, 0], [-5, -5, -4, 1, 3, 1], [0, 0, 0]), P([22, 0], [4, -5, -4, 1, 3, 1], [0, 0, 0])] }),
      P([18, 4], [-6, -10, -7, 12, 18, 10], [0, 5, 2], { rot: [HALF_PI, 0, 0], children: [P([52, 0], [-2, 2, -8, 4, 6, 1], [0, 0, 0])] }),
      ...quadLegs([0, 16], 4, 12, [[-4, 12, 7], [4, 12, 7], [-4, 12, -6], [4, 12, -6]]),
    ],
  },
  sheep: {
    skin: 'sheep', texW: 64, texH: 32, furSkin: 'sheep_fur',
    parts: [
      P([0, 0], [-3, -4, -6, 6, 6, 8], [0, 6, -8], { anim: 'head', children: [P([0, 0], [-3, -4, -4, 6, 6, 6], [0, 0, 0], { layer: 'fur', inflate: 0.6 })] }),
      P([28, 8], [-4, -10, -7, 8, 16, 6], [0, 5, 2], { rot: [HALF_PI, 0, 0] }),
      P([28, 8], [-4, -10, -7, 8, 16, 6], [0, 5, 2], { rot: [HALF_PI, 0, 0], layer: 'fur', inflate: 1.75 }),
      ...quadLegs([0, 16], 4, 12, [[-3, 12, 7], [3, 12, 7], [-3, 12, -5], [3, 12, -5]]),
      ...quadLegs([0, 16], 4, 6, [[-3, 12, 7], [3, 12, 7], [-3, 12, -5], [3, 12, -5]], 'fur', 0.5),
    ],
  },
  chicken: {
    skin: 'chicken', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-2, -6, -2, 4, 6, 3], [0, 15, -4], { anim: 'head', children: [P([14, 0], [-2, -4, -4, 4, 2, 2], [0, 0, 0]), P([14, 4], [-1, -2, -3, 2, 2, 2], [0, 0, 0])] }),
      P([0, 9], [-3, -4, -3, 6, 8, 6], [0, 16, 0], { rot: [HALF_PI, 0, 0] }),
      P([26, 0], [-1, 0, -3, 3, 5, 3], [-2, 19, 1], { anim: 'legBR' }),
      P([26, 0], [-1, 0, -3, 3, 5, 3], [1, 19, 1], { anim: 'legBL', mirror: true }),
      P([24, 13], [0, 0, -3, 1, 4, 6], [-4, 13, 0], { anim: 'wingR' }),
      P([24, 13], [-1, 0, -3, 1, 4, 6], [4, 13, 0], { anim: 'wingL' }),
    ],
  },
  zombie: humanoid('zombie', 64, 64, 4),
  zombie_chief: humanoid('zombie_chief', 64, 64, 4),
  skeleton: humanoid('skeleton', 64, 32, 2),
  player: playerModel(),
  zombified_piglin: piglinModel('zombified_piglin'),
  wither_skeleton: humanoid('wither_skeleton', 64, 32, 2),
  ender_dragon: dragonModel(),
  wither: {
    skin: 'wither', texW: 64, texH: 64,
    parts: [
      P([0, 0], [-4, -4, -4, 8, 8, 8], [0, 0, 0], { anim: 'head' }),
      P([32, 0], [-4, -4, -4, 6, 6, 6], [-8, 4, 0], { anim: 'witherHeadR' }),
      P([32, 0], [-4, -4, -4, 6, 6, 6], [10, 4, 0], { anim: 'witherHeadL' }),
      P([0, 16], [-10, 3.9, -0.5, 20, 3, 3], [0, 0, 0]),
      P([0, 22], [0, 0, 0, 3, 10, 3], [-2, 6.9, -0.5], {
        rot: [0.2, 0, 0], anim: 'witherRibs',
        children: [1.5, 4, 6.5].map((y) => P([24, 22], [-4, y, 0.5, 11, 2, 2], [0, 0, 0])),
      }),
      P([12, 22], [0, 0, 0, 3, 6, 3], [-2, 16.5, 1.5], { rot: [0.7, 0, 0], anim: 'tail' }),
    ],
  },
  snow_golem: {
    skin: 'snow_golem', texW: 64, texH: 64,
    parts: [
      P([0, 0], [-4, -8, -4, 8, 8, 8], [0, 4, 0], { anim: 'head', inflate: -0.5 }),
      P([0, 16], [-5, -10, -5, 10, 10, 10], [0, 13, 0], { inflate: -0.5 }),
      P([0, 36], [-6, -12, -6, 12, 12, 12], [0, 24, 0], { inflate: -0.5 }),
      P([32, 0], [-1, 0, -1, 12, 2, 2], [5, 6, 1], { rot: [0, 0, 1], anim: 'armL' }),
      P([32, 0], [-1, 0, -1, 12, 2, 2], [-5, 6, -1], { rot: [0, Math.PI, -1], anim: 'armR' }),
    ],
  },
  minecart: {
    skin: 'minecart', texW: 64, texH: 32,
    parts: [
      P([0, 10], [-10, -8, -1, 20, 16, 2], [0, 20, 0], { rot: [HALF_PI, 0, 0] }),
      P([0, 0], [-8, -9, -1, 16, 8, 2], [-9, 19, 0], { rot: [0, HALF_PI * 3, 0] }),
      P([0, 0], [-8, -9, -1, 16, 8, 2], [9, 19, 0], { rot: [0, HALF_PI, 0] }),
      P([0, 0], [-8, -9, -1, 16, 8, 2], [0, 19, -7], { rot: [0, Math.PI, 0] }),
      P([0, 0], [-8, -9, -1, 16, 8, 2], [0, 19, 7]),
    ],
  },
  invisible: { skin: 'pig', texW: 64, texH: 32, parts: [], invisible: true },
  husk: humanoid('husk', 64, 64, 4),
  drowned: humanoid('drowned', 64, 64, 4),
  stray: humanoid('stray', 64, 32, 2),
  enderman: {
    skin: 'enderman', texW: 64, texH: 32, glow: 'enderman_eyes',
    parts: [
      P([0, 0], [-4, -8, -4, 8, 8, 8], [0, -14, 0], { anim: 'head', inflate: -0.5, children: [P([0, 16], [-4, -8, -4, 8, 8, 8], [0, 0, 0], { inflate: -0.5 })] }),
      P([32, 16], [-4, 0, -2, 8, 12, 4], [0, -14, 0]),
      P([56, 0], [-1, -2, -1, 2, 30, 2], [-5, -12, 0], { anim: 'armR' }),
      P([56, 0], [-1, -2, -1, 2, 30, 2], [5, -12, 0], { anim: 'armL', mirror: true }),
      P([56, 0], [-1, 0, -1, 2, 30, 2], [-2, -6, 0], { anim: 'legR' }),
      P([56, 0], [-1, 0, -1, 2, 30, 2], [2, -6, 0], { anim: 'legL', mirror: true }),
    ],
  },
  wolf: {
    skin: 'wolf', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-2, -3, -2, 6, 6, 4], [-1, 13.5, -7], {
        anim: 'head',
        children: [P([16, 14], [-2, -5, 0, 2, 2, 1], [0, 0, 0]), P([16, 14], [2, -5, 0, 2, 2, 1], [0, 0, 0]), P([0, 10], [-0.5, 0, -5, 3, 3, 4], [0, 0, 0])],
      }),
      P([18, 14], [-3, -2, -3, 6, 9, 6], [0, 14, 2], { rot: [HALF_PI, 0, 0] }),
      P([21, 0], [-3, -3, -3, 8, 6, 7], [-1, 14, -3], { rot: [HALF_PI, 0, 0] }),
      P([0, 18], [0, 0, -1, 2, 8, 2], [-2.5, 16, 7], { anim: 'legBR' }),
      P([0, 18], [0, 0, -1, 2, 8, 2], [0.5, 16, 7], { anim: 'legBL' }),
      P([0, 18], [0, 0, -1, 2, 8, 2], [-2.5, 16, -4], { anim: 'legFR' }),
      P([0, 18], [0, 0, -1, 2, 8, 2], [0.5, 16, -4], { anim: 'legFL' }),
      P([9, 18], [0, 0, -1, 2, 8, 2], [-1, 12, 8], { rot: [0.9, 0, 0], anim: 'tail' }),
    ],
  },
  squid: squidModel('squid'),
  glow_squid: squidModel('glow_squid'),
  bat: {
    skin: 'bat', texW: 64, texH: 64,
    parts: [
      P([0, 0], [-3, -3, -3, 6, 6, 6], [0, 8, 0], { children: [P([24, 0], [-4, -6, -2, 3, 4, 1], [0, 0, 0]), P([24, 0], [1, -6, -2, 3, 4, 1], [0, 0, 0], { mirror: true })] }),
      P([0, 16], [-3, 4, -3, 6, 12, 6], [0, 8, 0]),
      P([42, 0], [-12, 1, 1.5, 10, 16, 1], [0, 8, 0], { anim: 'wingR' }),
      P([42, 0], [2, 1, 1.5, 10, 16, 1], [0, 8, 0], { anim: 'wingL', mirror: true }),
    ],
  },
  villager: villagerModel('villager', false),
  witch: villagerModel('witch', true),
  ghast: {
    skin: 'ghast', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-8, -8, -8, 16, 16, 16], [0, 16, 0]),
      ...[9, 12, 10, 13, 8, 11, 10, 9, 12].map((len, i) => {
        const fx = ((i % 3) - (Math.floor(i / 3) % 2) * 0.5 + 0.25 - 1) * 5;
        const fz = (Math.floor(i / 3) - 1) * 5;
        return P([0, 0], [-1, 0, -1, 2, len, 2], [fx, 24, fz], { anim: 'tentacle' });
      }),
    ],
  },
  magma_cube: {
    skin: 'magma_cube', texW: 64, texH: 32,
    parts: [
      ...Array.from({ length: 8 }, (_, i) => P(i === 2 ? [24, 10] : i === 3 ? [24, 19] : [0, i], [-4, 16 + i, -4, 8, 1, 8], [0, 0, 0], { anim: 'squash' })),
      P([0, 16], [-2, 18, -2, 4, 4, 4], [0, 0, 0], { anim: 'squash' }),
    ],
  },
  blaze: {
    skin: 'blaze', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-4, -4, -4, 8, 8, 8], [0, 4, 0], { anim: 'head' }),
      ...[[9, -4], [7, 3], [5, 10]].map(([r, y], ring) =>
        P([0, 0], [0, 0, 0, 0, 0, 0], [0, 24, 0], {
          anim: `spin${ring}`,
          children: [0, 1, 2, 3].map((k) => {
            const a = (k / 4) * Math.PI * 2 + ring * 0.6;
            return P([0, 16], [-1, 0, -1, 2, 8, 2], [Math.cos(a) * r, y - 20, Math.sin(a) * r]);
          }),
        }),
      ),
    ],
  },
  creeper: {
    skin: 'creeper', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-4, -8, -4, 8, 8, 8], [0, 6, 0], { anim: 'head' }),
      P([16, 16], [-4, 0, -2, 8, 12, 4], [0, 6, 0]),
      ...quadLegs([0, 16], 4, 6, [[-2, 18, 4], [2, 18, 4], [-2, 18, -4], [2, 18, -4]]),
    ],
  },
  spider: { ...spider('spider'), glow: 'spider_eyes' },
  cave_spider: { ...spider('cave_spider'), glow: 'cave_spider_eyes' },
  slime: {
    skin: 'slime', texW: 64, texH: 32,
    parts: [
      P([0, 16], [-3, 17, -3, 6, 6, 6], [0, 0, 0], { anim: 'squash' }),
      P([32, 0], [-3.25, 18, -3.5, 2, 2, 2], [0, 0, 0]),
      P([32, 4], [1.25, 18, -3.5, 2, 2, 2], [0, 0, 0]),
      P([32, 8], [0, 21, -3.5, 1, 1, 1], [0, 0, 0]),
      P([0, 0], [-4, 16, -4, 8, 8, 8], [0, 0, 0], { anim: 'squash' }),
    ],
  },
};

// ---------- créatures ajoutées : modèles du jeu réutilisés avec leurs propres skins ----------
Object.assign(VANILLA, {
  mooshroom: reuse('cow', 'mooshroom'),
  goat: reuse('cow', 'goat'),
  horse: reuse('cow', 'horse'),
  donkey: reuse('cow', 'donkey'),
  llama: reuse('cow', 'llama'),
  camel: reuse('cow', 'camel'),
  polar_bear: reuse('cow', 'polar_bear'),
  panda: reuse('pig', 'panda'),
  hoglin: reuse('pig', 'hoglin'),
  armadillo: reuse('pig', 'armadillo'),
  rabbit: reuse('pig', 'rabbit'),
  frog: reuse('pig', 'frog'),
  turtle: reuse('pig', 'turtle'),
  fox: reuse('wolf', 'fox'),
  ocelot: reuse('wolf', 'ocelot'),
  parrot: reuse('chicken', 'parrot'),
  bee: reuse('bat', 'bee'),
  phantom: reuse('bat', 'phantom'),
  silverfish: reuse('spider', 'silverfish'),
  endermite: reuse('spider', 'endermite'),
  strider: reuse('creeper', 'strider'),
  cod: fishModel('cod', 8, 3, 2),
  salmon: fishModel('salmon', 11, 4, 3),
  tropical_fish: fishModel('tropical_fish', 6, 5, 2),
  dolphin: fishModel('dolphin', 12, 5, 6),
  guardian: fishModel('guardian', 12, 12, 12),
  axolotl: fishModel('axolotl', 9, 4, 5),
  iron_golem: humanoid('iron_golem', 64, 64, 4),
  zombie_villager: humanoid('zombie_villager', 64, 64, 4),
  pillager: humanoid('pillager', 64, 64, 4),
  vindicator: humanoid('vindicator', 64, 64, 4),
  piglin: piglinModel('piglin'),
  // Pâte à papier
  paper_crane: reuse('bat', 'paper_crane'),
  origami_frog: reuse('pig', 'origami_frog'),
  scribble: humanoid('scribble', 64, 64, 4),
  crumpled_ball: reuse('magma_cube', 'crumpled_ball'),
  paper_plane: fishModel('paper_plane', 12, 2, 10),
  cardboard_golem: humanoid('cardboard_golem', 64, 64, 4),
  // v2.21 : créatures des textures du pack
  bogged: humanoid('bogged', 64, 32, 2),
  parched: humanoid('parched', 64, 64, 2),
  piglin_brute: piglinModel('piglin_brute'),
  evoker: villagerModel('evoker', false),
  wandering_trader: villagerModel('wandering_trader', false),
  mule: reuse('cow', 'mule'),
  skeleton_horse: reuse('cow', 'skeleton_horse'),
  zombie_horse: reuse('cow', 'zombie_horse'),
  trader_llama: reuse('cow', 'trader_llama'),
  camel_husk: reuse('cow', 'camel_husk'),
  zoglin: reuse('pig', 'zoglin'),
  cat: reuse('wolf', 'cat'),
  elder_guardian: fishModel('elder_guardian', 12, 12, 12),
  pufferfish: fishModel('pufferfish', 6, 6, 6),
  tadpole: fishModel('tadpole', 5, 2, 2),
  shulker: {
    skin: 'shulker', texW: 64, texH: 64,
    parts: [P([0, 28], [-8, -8, -8, 16, 8, 16], [0, 24, 0]), P([0, 0], [-8, -16, -8, 16, 12, 16], [0, 24, 0], { inflate: 0.05 }), P([0, 52], [-3, -14, -3, 6, 6, 6], [0, 24, 0], { anim: 'head' })],
  },
});

/** Même géométrie qu'un modèle existant, avec une autre skin. */
function reuse(base: string, skin: string): VanillaModel {
  return { ...VANILLA[base], skin };
}

/** Poisson (corps, nageoire dorsale, queue qui ondule) : longueur, hauteur, largeur en pixels. */
function fishModel(skin: string, len: number, h: number, w: number): VanillaModel {
  return {
    skin, texW: 64, texH: 32,
    parts: [
      P([0, 0], [-w / 2, -h, -len / 2, w, h, len], [0, 22, 0], {
        anim: 'body',
        children: [
          P([0, 20], [-0.5, -2, 0, 1, 2, Math.max(3, len / 3)], [0, -h, -len / 6]),
          P([20, 20], [-0.5, -h, 0, 1, h, Math.max(3, len / 2.5)], [0, 0, len / 2], { anim: 'fishTail' }),
        ],
      }),
    ],
  };
}

function humanoid(skin: string, texW: number, texH: number, limb: number): VanillaModel {
  const lo = limb === 4 ? -2 : -1;
  return {
    skin, texW, texH,
    parts: [
      P([0, 0], [-4, -8, -4, 8, 8, 8], [0, 0, 0], { anim: 'head' }),
      P([16, 16], [-4, 0, -2, 8, 12, 4], [0, 0, 0]),
      P([40, 16], [limb === 4 ? -3 : -1, -2, lo, limb, 12, limb], [-5, 2, 0], { anim: 'armR' }),
      P([40, 16], [-1, -2, lo, limb, 12, limb], [5, 2, 0], { anim: 'armL', mirror: true }),
      P([0, 16], [lo, 0, lo, limb, 12, limb], [limb === 4 ? -1.9 : -2, 12, 0], { anim: 'legR' }),
      P([0, 16], [lo, 0, lo, limb, 12, limb], [limb === 4 ? 1.9 : 2, 12, 0], { anim: 'legL', mirror: true }),
    ],
  };
}

/** Joueur (vue à la 3e personne) : skin 64x64 avec bras/jambe gauches distincts et seconde couche. */
function playerModel(): VanillaModel {
  const o = (uv: [number, number], box: CubePart['box'], inflate: number) => P(uv, box, [0, 0, 0], { inflate });
  const limb: CubePart['box'] = [-2, 0, -2, 4, 12, 4];
  return {
    skin: 'player', texW: 64, texH: 64,
    parts: [
      P([0, 0], [-4, -8, -4, 8, 8, 8], [0, 0, 0], { anim: 'head', children: [o([32, 0], [-4, -8, -4, 8, 8, 8], 0.5)] }),
      P([16, 16], [-4, 0, -2, 8, 12, 4], [0, 0, 0], { anim: 'body', children: [o([16, 32], [-4, 0, -2, 8, 12, 4], 0.25)] }),
      P([40, 16], [-3, -2, -2, 4, 12, 4], [-5, 2, 0], { anim: 'armR', children: [o([40, 32], [-3, -2, -2, 4, 12, 4], 0.25)] }),
      P([32, 48], [-1, -2, -2, 4, 12, 4], [5, 2, 0], { anim: 'armL', children: [o([48, 48], [-1, -2, -2, 4, 12, 4], 0.25)] }),
      P([0, 16], limb, [-1.9, 12, 0], { anim: 'legR', children: [o([0, 32], limb, 0.25)] }),
      P([16, 48], limb, [1.9, 12, 0], { anim: 'legL', children: [o([0, 48], limb, 0.25)] }),
    ],
  };
}

/** Piglin (tête large, groin, défenses, oreilles) sur le corps du modèle joueur 64x64. */
function piglinModel(skin: string): VanillaModel {
  const base = playerModel();
  const o = (uv: [number, number], box: CubePart['box'], extra: Partial<CubePart> = {}) => P(uv, box, [0, 0, 0], extra);
  base.skin = skin;
  base.parts[0] = P([0, 0], [-5, -8, -4, 10, 8, 8], [0, 0, 0], {
    anim: 'head',
    children: [
      o([31, 1], [-2, -4, -5, 4, 4, 1]),
      o([2, 4], [2, -2, -5, 1, 2, 1]),
      o([2, 0], [-3, -2, -5, 1, 2, 1]),
      P([51, 6], [0, 0, -2, 1, 5, 4], [4.5, -6, 0], { rot: [0, 0, -0.5236] }),
      P([39, 6], [-1, 0, -2, 1, 5, 4], [-4.5, -6, 0], { rot: [0, 0, 0.5236] }),
    ],
  });
  return base;
}

/** Calamar : corps 12×16×12 et 8 tentacules oscillantes (texture 64×32). */
function squidModel(skin: string): VanillaModel {
  return {
    skin, texW: 64, texH: 32,
    parts: [
      P([0, 0], [-6, -8, -6, 12, 16, 12], [0, 6, 0]),
      ...Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return P([48, 0], [-1, 0, -1, 2, 18, 2], [Math.cos(a) * 5, 13, Math.sin(a) * 5], { anim: 'tentacle' });
      }),
    ],
  };
}

/** Villageois (et sorcière : chapeau pointu, texture 64×128), bras croisés, robe. */
function villagerModel(skin: string, witch: boolean): VanillaModel {
  const hat: CubePart[] = witch
    ? [P([0, 64], [0, 0, 0, 10, 2, 10], [-5, -10.03, -5], { children: [P([0, 76], [0, 0, 0, 7, 4, 7], [1.75, 2, 2], { rot: [-0.05, 0, 0.03], children: [P([0, 87], [0, 0, 0, 4, 4, 4], [1.75, 4, 2], { rot: [-0.1, 0, 0.05], children: [P([0, 95], [0, 0, 0, 1, 2, 1], [1.75, 4, 2], { rot: [-0.2, 0, 0.1] })] })] })] })]
    : [];
  return {
    skin, texW: 64, texH: witch ? 128 : 64,
    parts: [
      P([0, 0], [-4, -10, -4, 8, 10, 8], [0, 0, 0], { anim: 'head', children: [P([24, 0], [-1, -1, -6, 2, 4, 2], [0, 2, 0]), ...hat] }),
      P([16, 20], [-4, 0, -3, 8, 12, 6], [0, 0, 0]),
      P([0, 38], [-4, 0, -3, 8, 18, 6], [0, 0, 0], { inflate: 0.5 }),
      P([44, 22], [-8, -2, -2, 4, 8, 4], [0, 3, -1], { rot: [-0.75, 0, 0], children: [P([44, 22], [4, -2, -2, 4, 8, 4], [0, 0, 0], { mirror: true }), P([40, 38], [-4, 2, -2, 8, 4, 4], [0, 0, 0])] }),
      P([0, 22], [-2, 0, -2, 4, 12, 4], [-2, 12, 0], { anim: 'legR' }),
      P([0, 22], [-2, 0, -2, 4, 12, 4], [2, 12, 0], { anim: 'legL', mirror: true }),
    ],
  };
}

function spider(skin: string): VanillaModel {
  const legs: CubePart[] = [];
  const yRots = [Math.PI / 4, Math.PI / 8, -Math.PI / 8, -Math.PI / 4];
  const zs = [2, 1, 0, -1];
  for (let i = 0; i < 4; i++) {
    const zr = i === 0 || i === 3 ? Math.PI / 4 : Math.PI / 4 * 0.74;
    legs.push(P([18, 0], [-15, -1, -1, 16, 2, 2], [-4, 15, zs[i]], { rot: [0, yRots[i], -zr], anim: `spiderR${i}` }));
    legs.push(P([18, 0], [-1, -1, -1, 16, 2, 2], [4, 15, zs[i]], { rot: [0, -yRots[i], zr], anim: `spiderL${i}` }));
  }
  return {
    skin, texW: 64, texH: 32,
    parts: [
      P([32, 4], [-4, -4, -8, 8, 8, 8], [0, 15, -3], { anim: 'head' }),
      P([0, 0], [-3, -3, -3, 6, 6, 6], [0, 15, 0]),
      P([0, 12], [-5, -4, -6, 10, 8, 12], [0, 15, 9]),
      ...legs,
    ],
  };
}

/** Géométrie d'un cube au format vanilla (UV standard), convertie dans notre repère. */
function cubeGeometry(part: CubePart, texW: number, texH: number): THREE.BufferGeometry {
  const [bx, by, bz, w, h, d] = part.box;
  const g = part.inflate ?? 0;
  const x0 = bx - g, y0 = by - g, z0 = bz - g, x1 = bx + w + g, y1 = by + h + g, z1 = bz + d + g;
  const [u, v] = part.uv;
  // régions de texture (vanilla) : [u0, v0, largeur, hauteur]
  const R = {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + 2 * d + w, v + d, w, h],
  };
  if (part.mirror) [R.right, R.left] = [R.left, R.right];
  if (part.faceUV) Object.assign(R, part.faceUV);
  // faces : 4 coins (repère vanilla) + coordonnées texture (u relatif, v relatif) de chaque coin
  type C = [number, number, number, number, number];
  const faces: { r: number[]; n: [number, number, number]; c: C[] }[] = [
    // avant (-Z vanilla) : u croît avec x, v avec y
    { r: R.front, n: [0, 0, -1], c: [[x0, y0, z0, 0, 0], [x1, y0, z0, 1, 0], [x1, y1, z0, 1, 1], [x0, y1, z0, 0, 1]] },
    // arrière (+Z) : u croît quand x décroît
    { r: R.back, n: [0, 0, 1], c: [[x1, y0, z1, 0, 0], [x0, y0, z1, 1, 0], [x0, y1, z1, 1, 1], [x1, y1, z1, 0, 1]] },
    // côté droit (-X) : u croît quand z décroît
    { r: R.right, n: [-1, 0, 0], c: [[x0, y0, z1, 0, 0], [x0, y0, z0, 1, 0], [x0, y1, z0, 1, 1], [x0, y1, z1, 0, 1]] },
    // côté gauche (+X) : u croît avec z
    { r: R.left, n: [1, 0, 0], c: [[x1, y0, z0, 0, 0], [x1, y0, z1, 1, 0], [x1, y1, z1, 1, 1], [x1, y1, z0, 0, 1]] },
    // dessus (-Y vanilla) : v croît quand z décroît (l'avant en bas de la région)
    { r: R.top, n: [0, -1, 0], c: [[x0, y0, z1, 0, 0], [x1, y0, z1, 1, 0], [x1, y0, z0, 1, 1], [x0, y0, z0, 0, 1]] },
    // dessous (+Y)
    { r: R.bottom, n: [0, 1, 0], c: [[x0, y1, z0, 0, 0], [x1, y1, z0, 1, 0], [x1, y1, z1, 1, 1], [x0, y1, z1, 0, 1]] },
  ];
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (const f of faces) {
    const base = pos.length / 3;
    const [ru, rv, rw, rh] = f.r;
    for (const [x, y, z, fu, fv] of f.c) {
      // conversion : (x, -y, -z) en pixels → blocs
      pos.push(x / 16, -y / 16, -z / 16);
      let uu = ru + fu * rw;
      if (part.mirror) uu = ru + (1 - fu) * rw;
      uvs.push(uu / texW, 1 - (rv + fv * rh) / texH);
    }
    // ordre anti-horaire vu de l'extérieur (dans notre repère)
    const n: [number, number, number] = [f.n[0], -f.n[1], -f.n[2]];
    const p = (i: number) => [pos[(base + i) * 3], pos[(base + i) * 3 + 1], pos[(base + i) * 3 + 2]];
    const a = p(0), b = p(1), c = p(2);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ccw = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0;
    if (ccw) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
export function cachedCube(part: CubePart, texW: number, texH: number) {
  const k = `${part.uv}|${part.box}|${part.inflate ?? 0}|${part.mirror ? 1 : 0}|${texW}x${texH}|${part.faceUV ? JSON.stringify(part.faceUV) : ''}`;
  let g = geoCache.get(k);
  if (!g) {
    g = cubeGeometry(part, texW, texH);
    geoCache.set(k, g);
  }
  return g;
}

/** Fournisseur de textures de skins (générées ou issues d'un pack). */
export interface SkinProvider {
  skin(key: string): THREE.Texture;
}

const SHADOW_GEO = new THREE.PlaneGeometry(1, 1);

export class MobModel {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshBasicMaterial;
  /** Matériau de la laine (moutons), teinté selon la couleur. */
  readonly furMaterial: THREE.MeshBasicMaterial | null = null;
  /** Yeux lumineux (non teintés par la lumière). */
  readonly glowMaterial: THREE.MeshBasicMaterial | null = null;
  readonly parts = new Map<string, THREE.Object3D[]>();
  readonly furParts: THREE.Object3D[] = [];
  private shadow: THREE.Mesh | null = null;
  readonly vanilla: boolean;
  private animPhase = new Map<THREE.Object3D, THREE.Euler>();
  /** Os nommés (modèles d'add-ons) avec leur pose de repos. */
  readonly bones = new Map<string, { o: THREE.Object3D; rot: THREE.Euler; pos: THREE.Vector3 }>();

  /** Skin imposée (bots : skin de joueur différente) ; ces modèles ne sont pas remis au pool. */
  readonly skinKey: string | undefined;
  constructor(readonly type: string, scale: number, shadowTex: THREE.Texture | null, skins: SkinProvider, skinKey?: string) {
    this.skinKey = skinKey;
    const def = VANILLA[type];
    this.vanilla = !!def;
    if (def) {
      this.material = new THREE.MeshBasicMaterial({ map: skins.skin(skinKey ?? def.skin), transparent: type === 'slime', alphaTest: type === 'slime' ? 0.05 : 0.5, side: type === 'slime' ? THREE.DoubleSide : THREE.FrontSide, depthWrite: type !== 'slime' });
      if (def.furSkin) this.furMaterial = new THREE.MeshBasicMaterial({ map: skins.skin(def.furSkin), alphaTest: 0.5 });
      if (def.glow)
        this.glowMaterial = new THREE.MeshBasicMaterial({
          map: skins.skin(def.glow), transparent: true, alphaTest: 0.05, depthWrite: false,
          blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        });
      const root = new THREE.Group();
      for (const p of def.parts) root.add(this.buildPart(p, def));
      this.group.add(root);
    } else {
      const voxel = VOXEL_MODELS[type];
      if (!voxel) throw new Error(`Modèle inconnu: ${type}`);
      this.material = new THREE.MeshBasicMaterial({ vertexColors: true });
      this.group.add(build(voxel(), this.parts, this.material));
    }
    this.group.scale.setScalar(scale);
    if (shadowTex && !def?.invisible) {
      this.shadow = new THREE.Mesh(SHADOW_GEO, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 }));
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.02;
      this.shadow.renderOrder = 1;
      this.group.add(this.shadow);
    }
  }

  private buildPart(p: CubePart, def: VanillaModel, child = false): THREE.Object3D {
    const pivot = new THREE.Group();
    // pivot converti : (x, 24 - y, -z) ; les enfants sont relatifs au pivot parent (sans décalage du sol)
    pivot.position.set(p.pivot[0] / 16, (child ? -p.pivot[1] : 24 - p.pivot[1]) / 16, -p.pivot[2] / 16);
    if (p.rot) pivot.rotation.set(p.rot[0], -p.rot[1], -p.rot[2]);
    const fur = p.layer === 'fur';
    const mat = fur ? this.furMaterial! : this.material;
    // nœud sans géométrie (os d'un modèle Bedrock) : seulement un pivot
    if (p.box[3] || p.box[4] || p.box[5]) {
      const mesh = new THREE.Mesh(cachedCube(p, def.texW, def.texH), mat);
      pivot.add(mesh);
      if (fur) this.furParts.push(mesh);
      else if (this.glowMaterial) {
        const g = new THREE.Mesh(mesh.geometry, this.glowMaterial);
        g.renderOrder = 2;
        pivot.add(g);
      }
    }
    if (p.bone) this.bones.set(p.bone, { o: pivot, rot: pivot.rotation.clone(), pos: pivot.position.clone() });
    if (p.anim) {
      const list = this.parts.get(p.anim) ?? [];
      list.push(pivot);
      this.parts.set(p.anim, list);
      this.animPhase.set(pivot, pivot.rotation.clone());
    }
    for (const c of p.children ?? []) pivot.add(this.buildPart(c, def, true));
    return pivot;
  }

  setShadowSize(w: number, visible: boolean) {
    if (!this.shadow) return;
    this.shadow.visible = visible;
    this.shadow.scale.setScalar(w * 1.3);
  }

  /** Couleur de la laine (mouton) ; null = tondu. */
  setFur(color: number | null) {
    for (const f of this.furParts) f.visible = color !== null;
    if (color !== null && this.furMaterial) this.furMaterial.userData.base = color;
  }

  private rot(name: string, fn: (base: THREE.Euler, o: THREE.Object3D) => void) {
    for (const o of this.parts.get(name) ?? []) fn(this.animPhase.get(o) ?? new THREE.Euler(), o);
  }

  /** Anime : phase de marche, amplitude (0..1), temps, attaque (0..1), orientation de la tête. */
  animate(phase: number, amp: number, t: number, attack: number, headYaw: number, headPitch: number) {
    const s = Math.cos(phase * 0.6662 * 2) * 1.2 * amp;
    for (const k of ['legFL', 'legBR', 'legR']) this.rot(k, (b, o) => (o.rotation.x = b.x + s));
    for (const k of ['legFR', 'legBL', 'legL']) this.rot(k, (b, o) => (o.rotation.x = b.x - s));
    // bras : zombies tendus vers l'avant, squelettes balancés
    const zombieArms = this.type.startsWith('zombi');
    this.rot('armR', (b, o) => (o.rotation.x = zombieArms ? -HALF_PI + Math.sin(t * 2) * 0.05 - attack * 0.6 : b.x - s * 0.7 - attack * 1.4));
    this.rot('armL', (b, o) => (o.rotation.x = zombieArms ? -HALF_PI - Math.sin(t * 2) * 0.05 - attack * 0.6 : b.x + s * 0.7));
    // anciens modèles (boss)
    for (const p of this.parts.get('armL_fwd') ?? []) p.rotation.x = -HALF_PI - attack * 0.8 + s * 0.3;
    for (const p of this.parts.get('armR_fwd') ?? []) p.rotation.x = -HALF_PI - attack * 0.8 - s * 0.3;
    this.rot('wingR', (b, o) => (o.rotation.z = b.z + (amp > 0.1 || attack > 0 ? Math.sin(t * 25) * 0.7 : 0)));
    this.rot('wingL', (b, o) => (o.rotation.z = b.z - (amp > 0.1 || attack > 0 ? Math.sin(t * 25) * 0.7 : 0)));
    this.rot('head', (b, o) => {
      o.rotation.y = b.y + headYaw;
      o.rotation.x = b.x - headPitch;
    });
    for (let i = 0; i < 4; i++) {
      const sw = Math.cos(phase * 1.3 + (i % 2) * Math.PI) * 0.4 * amp;
      this.rot(`spiderR${i}`, (b, o) => (o.rotation.y = b.y + sw));
      this.rot(`spiderL${i}`, (b, o) => (o.rotation.y = b.y - sw));
    }
    this.rot('witherHeadR', (b, o) => (o.rotation.y = b.y + Math.sin(t * 1.3) * 0.4));
    this.rot('witherHeadL', (b, o) => (o.rotation.y = b.y + Math.sin(t * 1.1 + 2) * 0.4));
    this.rot('witherRibs', (b, o) => (o.rotation.x = b.x + (0.065 + 0.05 * Math.cos(t * 2)) * Math.PI));
    // dragon de l'Ender : battement d'ailes (comme le modèle Java), cou et queue qui ondulent
    if (this.type === 'ender_dragon') {
      const a = t * 4.2;
      // rotations vanilla (x, y, z) → repère du jeu (x, -y, -z)
      this.rot('dragonWingL', (_b, o) => o.rotation.set(0.125 - Math.cos(a) * 0.2, -0.25, (Math.sin(a) + 0.125) * 0.8));
      this.rot('dragonWingR', (_b, o) => o.rotation.set(0.125 - Math.cos(a) * 0.2, 0.25, -(Math.sin(a) + 0.125) * 0.8));
      this.rot('dragonTipL', (_b, o) => (o.rotation.z = -(Math.sin(a + 2) + 0.5) * 0.75));
      this.rot('dragonTipR', (_b, o) => (o.rotation.z = (Math.sin(a + 2) + 0.5) * 0.75));
      this.rot('dragonNeck', (b, o) => {
        o.rotation.x = b.x + Math.sin(a - 1) * 0.03;
        o.rotation.y = b.y + Math.sin(t * 0.9) * 0.04;
      });
      this.rot('dragonTail', (b, o) => {
        o.rotation.x = b.x + Math.sin(a + 1) * 0.025;
        o.rotation.y = b.y + Math.sin(t * 1.2) * 0.05;
      });
      this.rot('dragonJaw', (b, o) => (o.rotation.x = b.x + (Math.sin(a) + 1) * 0.1 + attack * 0.6));
      this.rot('dragonHead', (b, o) => (o.rotation.x = b.x - headPitch * 0.5));
      this.rot('dragonLeg', (b, o) => (o.rotation.x = b.x + (Math.sin(a) + 1) * 0.05));
    }
    this.rot('tail', (b, o) => (o.rotation.z = b.z + Math.sin(t * 3) * 0.1 * (1 + amp)));
    this.rot('fishTail', (b, o) => (o.rotation.y = b.y + Math.sin(t * 8) * 0.45));
    this.rot('tentacle', (b, o) => (o.rotation.x = b.x + 0.15 + Math.sin(t * 2.2 + o.position.x * 3 + o.position.z * 5) * 0.25));
    for (let r = 0; r < 3; r++) this.rot(`spin${r}`, (b, o) => (o.rotation.y = b.y + t * (r === 1 ? -1.4 : 1.1 + r * 0.3)));
    this.rot('squash', (_b, o) => {
      const k = 1 + Math.sin(t * 6) * 0.06 * (0.3 + amp);
      o.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));
    });
  }

  private basePos = new Map<THREE.Object3D, THREE.Vector3>();

  /**
   * Pose accroupie du modèle humanoïde (comme le modèle vanilla) : buste penché de 0,5 rad,
   * tête et bras abaissés de 4,2/3,2 px, jambes reculées de 4 px. À appeler après animate().
   */
  crouch(on: boolean) {
    const move = (name: string, dy: number, dz: number) =>
      this.rot(name, (_b, o) => {
        let p = this.basePos.get(o);
        if (!p) this.basePos.set(o, (p = o.position.clone()));
        o.position.set(p.x, p.y - (on ? dy : 0) / 16, p.z - (on ? dz : 0) / 16);
      });
    move('head', 4.2, 0);
    move('body', 3.2, 0);
    move('armR', 3.2, 0);
    move('armL', 3.2, 0);
    move('legR', 0.2, 4);
    move('legL', 0.2, 4);
    this.rot('body', (b, o) => (o.rotation.x = b.x + (on ? 0.5 : 0)));
    if (on) for (const k of ['armR', 'armL']) this.rot(k, (_b, o) => (o.rotation.x += 0.4));
  }

  /** Applique des poses d'animation Bedrock (degrés et pixels, repère Bedrock) aux os. */
  applyPoses(poses: Map<string, { rot: [number, number, number]; pos: [number, number, number]; scale: [number, number, number] }>) {
    const D = Math.PI / 180;
    for (const [name, b] of this.bones) {
      const p = poses.get(name);
      const o = b.o;
      if (!p) {
        o.rotation.copy(b.rot);
        o.position.copy(b.pos);
        o.scale.set(1, 1, 1);
        continue;
      }
      o.rotation.set(b.rot.x - p.rot[0] * D, b.rot.y + p.rot[1] * D, b.rot.z - p.rot[2] * D);
      o.position.set(b.pos.x - p.pos[0] / 16, b.pos.y + p.pos[1] / 16, b.pos.z - p.pos[2] / 16);
      o.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    }
  }

  setTint(r: number, g: number, b: number) {
    this.material.color.setRGB(r, g, b);
    if (this.furMaterial) {
      const base = (this.furMaterial.userData.base as number | undefined) ?? 0xffffff;
      this.furMaterial.color.setRGB((((base >> 16) & 255) / 255) * r, (((base >> 8) & 255) / 255) * g, ((base & 255) / 255) * b);
    }
  }

  dispose() {
    this.material.dispose();
    this.furMaterial?.dispose();
    this.glowMaterial?.dispose();
    if (this.shadow) (this.shadow.material as THREE.Material).dispose();
  }
}

/** Texture d'ombre circulaire (ombre « blob » bon marché sous les entités). */
export function createShadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
  g.addColorStop(0, 'rgba(0,0,0,0.8)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function disposeModelCache() {
  geoCache.forEach((g) => g.dispose());
  geoCache.clear();
}

/**
 * Géométries exactes du jeu de référence (src/data/vanillaGeometry.ts) : mêmes cubes et mêmes UV
 * que les textures du pack, pour que chaque créature ait exactement son apparence d'origine.
 */
const GEO_MOBS: Record<string, string> = {
  cow: 'geometry.cow.v2', mooshroom: 'geometry.mooshroom.v2', pig: 'geometry.pig.v3', chicken: 'geometry.chicken.v1.12',
  horse: 'geometry.horse.v3', donkey: 'geometry.horse.v3', mule: 'geometry.horse.v3', skeleton_horse: 'geometry.horse.v3', zombie_horse: 'geometry.horse.v3',
  llama: 'geometry.llama.v1.8', trader_llama: 'geometry.llama.v1.8', camel: 'geometry.camel', camel_husk: 'geometry.camel_husk', goat: 'geometry.goat',
  panda: 'geometry.panda', hoglin: 'geometry.hoglin', zoglin: 'geometry.hoglin', armadillo: 'geometry.armadillo',
  rabbit: 'geometry.rabbit.v2', frog: 'geometry.frog', turtle: 'geometry.turtle', fox: 'geometry.fox', ocelot: 'geometry.ocelot.v1.8', cat: 'geometry.cat',
  parrot: 'geometry.parrot', bee: 'geometry.bee', phantom: 'geometry.phantom', silverfish: 'geometry.silverfish', endermite: 'geometry.endermite',
  strider: 'geometry.strider', cod: 'geometry.cod', salmon: 'geometry.salmon', pufferfish: 'geometry.pufferfish.large.v1.8', tropical_fish: 'geometry.tropicalfish_a',
  dolphin: 'geometry.dolphin', guardian: 'geometry.guardian.v1.8', elder_guardian: 'geometry.guardian.v1.8', axolotl: 'geometry.axolotl', tadpole: 'geometry.tadpole',
  iron_golem: 'geometry.irongolem', zombie_villager: 'geometry.zombie.villager.v1.8', pillager: 'geometry.pillager', vindicator: 'geometry.vindicator.v1.8',
  evoker: 'geometry.evoker.v1.8', bat: 'geometry.bat_v2', shulker: 'geometry.shulker.v1.8', bogged: 'geometry.skeleton.bogged', parched: 'geometry.parched',
};
const GEO_GLOW: Record<string, string> = { phantom: 'phantom_eyes' };
/** Os d'équipement ou d'états particuliers masqués (selle, sacoches, coffres, pose enroulée…). */
const HORSE_GEAR = ['reinsl', 'reinsr', 'bridle', 'bitl', 'bitr', 'bagl', 'bagr', 'saddle'];
const GEO_HIDE: Record<string, string[]> = {
  horse: [...HORSE_GEAR, 'muleearl', 'muleearr'], skeleton_horse: [...HORSE_GEAR, 'muleearl', 'muleearr'], zombie_horse: [...HORSE_GEAR, 'muleearl', 'muleearr'],
  donkey: [...HORSE_GEAR, 'earl', 'earr'], mule: [...HORSE_GEAR, 'earl', 'earr'],
  llama: ['chest1', 'chest2'], trader_llama: ['chest1', 'chest2'], camel: ['saddle', 'bridle', 'reins'], camel_husk: ['saddle', 'bridle', 'reins'],
  armadillo: ['body_rolled_up'], frog: ['croaking_body', 'tongue'], fox: ['head_sleeping', 'held_item'],
  evoker: ['rightarm', 'leftarm'], vindicator: ['arms'],
};
/** Corps couchés par l'animation d'installation des quadrupèdes de l'édition Bedrock (rotation X de 90°). */
const GEO_BODY_90 = new Set(['cow', 'mooshroom', 'pig', 'chicken', 'llama', 'trader_llama', 'ocelot', 'cat', 'fox']);
for (const [k, id] of Object.entries(GEO_MOBS)) {
  const g0 = VANILLA_GEO[id];
  // seuls les cubes du corps tournent (os intermédiaire) : les pattes et la tête restent en place
  const g = g0 && GEO_BODY_90.has(k)
    ? { ...g0, bones: g0.bones.flatMap((b) => (b.name === 'body' ? [{ ...b, cubes: [] }, { name: 'body_turned', parent: 'body', pivot: b.pivot, rotation: [90, 0, 0], cubes: b.cubes }] : [b])) }
    : g0;
  if (!g) continue;
  const hide = new Set(GEO_HIDE[k] ?? []);
  const byName = new Map(g.bones.map((b) => [b.name, b]));
  const hidden = (b: { name: string; parent?: string }): boolean => {
    for (let x: { name: string; parent?: string } | undefined = b; x; x = x.parent ? byName.get(x.parent) : undefined) if (hide.has(x.name.toLowerCase())) return true;
    return false;
  };
  VANILLA[k] = { ...geometryToModel({ id, texW: g.texW, texH: g.texH, bones: g.bones.filter((b) => !hidden(b)) }, k), glow: GEO_GLOW[k] ?? VANILLA[k]?.glow };
}

// ours polaire : modèle Java (texture 128×64)
VANILLA.polar_bear = {
  skin: 'polar_bear', texW: 128, texH: 64,
  parts: [
    P([0, 0], [-3.5, -3, -3, 7, 7, 7], [0, 10, -16], { anim: 'head', children: [P([0, 44], [-2.5, 1, -6, 5, 3, 3], [0, 0, 0]), P([26, 0], [-4.5, -4, -1, 2, 2, 1], [0, 0, 0]), P([26, 0], [2.5, -4, -1, 2, 2, 1], [0, 0, 0], { mirror: true })] }),
    P([0, 19], [-5, -13, -7, 14, 14, 11], [-2, 9, 12], { rot: [HALF_PI, 0, 0], children: [P([39, 0], [-4, -25, -7, 12, 12, 10], [0, 0, 0])] }),
    P([50, 22], [-2, 0, -2, 4, 10, 8], [-4.5, 14, 6], { anim: 'legBR' }),
    P([50, 22], [-2, 0, -2, 4, 10, 8], [4.5, 14, 6], { anim: 'legBL', mirror: true }),
    P([50, 40], [-2, 0, -2, 4, 10, 6], [-3.5, 14, -8], { anim: 'legFR' }),
    P([50, 40], [-2, 0, -2, 4, 10, 6], [3.5, 14, -8], { anim: 'legFL', mirror: true }),
  ],
};

/** Proportions (hauteur / largeur) de la texture attendue par le modèle d'une skin. */
export function skinAspect(skin: string): number | undefined {
  for (const m of Object.values(VANILLA)) if (m.skin === skin) return m.texH / m.texW;
  return undefined;
}

export const VANILLA_MODELS = VANILLA;
