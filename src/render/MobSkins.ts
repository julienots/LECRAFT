/**
 * Skins des créatures dessinées procéduralement (art original) dans la disposition UV standard
 * des modèles vanilla, afin qu'un pack de ressources importé puisse les remplacer tel quel.
 */
import { Rng } from '../util/math';

type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';
type Painter = (face: Face, x: number, y: number, w: number, h: number) => string | null;

export interface SkinSpec {
  w: number;
  h: number;
  paint(ctx: CanvasRenderingContext2D, rng: Rng): void;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string | null) {
  if (!c) return;
  ctx.fillStyle = c;
  ctx.fillRect(x, y, 1, 1);
}

/** Remplit les 6 régions d'une boîte au format cube vanilla. */
function box(ctx: CanvasRenderingContext2D, u: number, v: number, w: number, h: number, d: number, p: Painter) {
  const regions: [Face, number, number, number, number][] = [
    ['top', u + d, v, w, d],
    ['bottom', u + d + w, v, w, d],
    ['right', u, v + d, d, h],
    ['front', u + d, v + d, w, h],
    ['left', u + d + w, v + d, d, h],
    ['back', u + 2 * d + w, v + d, w, h],
  ];
  for (const [f, x0, y0, rw, rh] of regions) for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) px(ctx, x0 + x, y0 + y, p(f, x, y, rw, rh));
}

const pick = (rng: Rng, pal: string[]) => pal[Math.floor(rng.next() * pal.length)];

function quadSkin(opts: { base: string[]; head: [number, number, number, number, number, number]; body: [number, number, number, number, number]; leg: [number, number, number, number, number]; face: (x: number, y: number, w: number, h: number) => string | null; spots?: string[]; spotChance?: number }): SkinSpec {
  return {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const spotsAt = new Set<number>();
      if (opts.spots) for (let i = 0; i < 64 * 32; i++) if (rng.next() < (opts.spotChance ?? 0)) for (const o of [0, 1, 64, 65]) spotsAt.add(i + o);
      const base = (x: number, y: number) => (opts.spots && spotsAt.has(y * 64 + x) ? pick(rng, opts.spots) : pick(rng, opts.base));
      const [hu, hv, hw, hh, hd] = opts.head;
      box(ctx, hu, hv, hw, hh, hd, (f, x, y, w, h) => (f === 'front' ? opts.face(x, y, w, h) ?? base(hu + x, hv + y) : base(hu + x + 3, hv + y)));
      const [bu, bv, bw, bh, bd] = opts.body;
      box(ctx, bu, bv, bw, bh, bd, (_f, x, y) => base(bu + x * 3, bv + y));
      const [lu, lv, lw, lh, ld] = opts.leg;
      box(ctx, lu, lv, lw, lh, ld, (f, _x, y, _w, h) => (f !== 'top' && y >= h - 1 ? '#3a2a1a' : base(lu + y, lv)));
    },
  };
}

const eyes = (eyeRow: number, left: number, right: number, white = '#ffffff', pupil = '#1a1a1a') => (x: number, y: number) => {
  if (y === eyeRow && (x === left || x === right)) return white;
  if (y === eyeRow && (x === left + 1 || x === right - 1)) return pupil;
  return null;
};

export const SKINS: Record<string, SkinSpec> = {
  pig: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const pal = ['#e88e86', '#f0a39b', '#f4b0a8', '#ec9a92'];
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => (f === 'front' ? eyes(3, 1, 6)(x, y) ?? pick(rng, pal) : pick(rng, pal)));
      box(ctx, 16, 16, 4, 3, 1, (f, x, y) => (f === 'front' ? (y === 1 && (x === 0 || x === 3) ? '#8a3a3a' : '#d97a72') : '#e08a82'));
      box(ctx, 28, 8, 10, 16, 8, () => pick(rng, pal));
      box(ctx, 0, 16, 4, 6, 4, (f, _x, y, _w, h) => (f !== 'top' && y === h - 1 ? '#7a4a44' : pick(rng, pal)));
    },
  },
  cow: quadSkin({
    base: ['#5a3a1e', '#4a2f17', '#6a4524', '#553620'],
    spots: ['#e8e8e8', '#f4f4f4', '#d8d8d8'],
    spotChance: 0.012,
    head: [0, 0, 8, 8, 6, 0],
    body: [18, 4, 12, 18, 10],
    leg: [0, 16, 4, 12, 4],
    face: (x, y) => (y >= 5 ? (y === 6 && (x === 2 || x === 5) ? '#4a2a2a' : '#c8a090') : eyes(2, 1, 6)(x, y)),
  }),
  sheep: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const skin = ['#d8c8b0', '#cfbfa6', '#e0d2bc'];
      box(ctx, 0, 0, 6, 6, 8, (f, x, y) => (f === 'front' ? eyes(2, 0, 5, '#ffffff', '#2a2a2a')(x, y) ?? (y === 5 && (x === 2 || x === 3) ? '#e8a0a0' : pick(rng, skin)) : pick(rng, skin)));
      box(ctx, 28, 8, 8, 16, 6, () => pick(rng, ['#e8d0c8', '#f0d8d0', '#e0c8c0']));
      box(ctx, 0, 16, 4, 12, 4, (f, _x, y, _w, h) => (f !== 'top' && y >= h - 1 ? '#3a3028' : pick(rng, skin)));
    },
  },
  sheep_fur: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const wool = ['#f4f4f4', '#e8e8e8', '#dcdcdc', '#ffffff'];
      box(ctx, 0, 0, 6, 6, 6, () => pick(rng, wool));
      box(ctx, 28, 8, 8, 16, 6, () => pick(rng, wool));
      box(ctx, 0, 16, 4, 6, 4, () => pick(rng, wool));
    },
  },
  chicken: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const white = ['#f4f4f4', '#ffffff', '#e8e8e8'];
      box(ctx, 0, 0, 4, 6, 3, (f, x, y) => (f === 'front' && y === 2 && (x === 0 || x === 3) ? '#1a1a1a' : pick(rng, white)));
      box(ctx, 14, 0, 4, 2, 2, () => pick(rng, ['#f0a020', '#e89018']));
      box(ctx, 14, 4, 2, 2, 2, () => '#d81a1a');
      box(ctx, 0, 9, 6, 8, 6, () => pick(rng, white));
      box(ctx, 26, 0, 3, 5, 3, () => pick(rng, ['#f0a020', '#e8b030']));
      box(ctx, 24, 13, 1, 4, 6, () => pick(rng, ['#e8e8e8', '#dcdcdc']));
    },
  },
  zombie: humanSkin({ skin: ['#4f8a3a', '#5a9a44', '#46803a'], shirt: ['#2f8f8f', '#2a8080', '#349a9a'], pants: ['#3a3a8f', '#34348a', '#40409a'], shoes: '#3a3a3a', eyes: '#1a2a1a', mouth: '#2a4a20' }),
  zombie_chief: humanSkin({ skin: ['#4a7a34', '#56883e', '#406e30'], shirt: ['#8a2a2a', '#7a2424', '#9a3030'], pants: ['#2a2030', '#241c2a', '#30263a'], shoes: '#1a1a1a', eyes: '#ff6020', mouth: '#2a4a20' }),
  player: {
    w: 64,
    h: 64,
    paint(ctx, rng) {
      humanSkin({ skin: ['#b4846d', '#aa7d66', '#bd8b72'], shirt: ['#00a8a8', '#009c9c', '#00b2b2'], pants: ['#463aa5', '#3f3496', '#4b40ad'], shoes: '#5a5a5a', eyes: '#49377a', mouth: '#8a4c3d' }).paint(ctx, rng);
      const hair = ['#2f1f0f', '#3b2812', '#28190b'];
      box(ctx, 0, 0, 8, 8, 8, (f, _x, y) => (f === 'top' || (f !== 'front' && f !== 'bottom' && y < 2) || (f === 'back' && y < 6) || (f === 'front' && y < 2) ? pick(rng, hair) : null));
      // bras et jambe gauches (disposition 64x64) : copies des côtés droits
      ctx.drawImage(ctx.canvas, 40, 16, 16, 16, 32, 48, 16, 16);
      ctx.drawImage(ctx.canvas, 0, 16, 16, 16, 16, 48, 16, 16);
    },
  },
  wither_skeleton: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const bone = ['#2a2a2a', '#323232', '#262626', '#3a3a3a'];
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => (f === 'front' && y >= 3 && y <= 4 && (x === 1 || x === 2 || x === 5 || x === 6) ? '#050505' : f === 'front' && y === 6 && x >= 2 && x <= 5 ? '#101010' : pick(rng, bone)));
      box(ctx, 16, 16, 8, 12, 4, (f, x, y) => (f === 'front' && y % 3 === 1 && x > 0 && x < 7 ? '#151515' : pick(rng, bone)));
      box(ctx, 40, 16, 2, 12, 2, () => pick(rng, bone));
      box(ctx, 0, 16, 2, 12, 2, () => pick(rng, bone));
    },
  },
  wither: {
    w: 64,
    h: 64,
    paint(ctx, rng) {
      const d = ['#1e1e1e', '#2a2a2a', '#242424', '#323232'];
      const face = (f: string, x: number, y: number, w: number) => (f === 'front' && y === Math.floor(w / 2) - 1 && (x === 1 || x === w - 2) ? '#f0f0f0' : f === 'front' && y === w - 2 && x > 0 && x < w - 1 ? '#0a0a0a' : null);
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => face(f, x, y, 8) ?? pick(rng, d));
      box(ctx, 32, 0, 6, 6, 6, (f, x, y) => face(f, x, y, 6) ?? pick(rng, d));
      box(ctx, 0, 16, 20, 3, 3, () => pick(rng, d));
      box(ctx, 0, 22, 3, 10, 3, () => pick(rng, d));
      box(ctx, 24, 22, 11, 2, 2, () => pick(rng, d));
      box(ctx, 12, 22, 3, 6, 3, () => pick(rng, d));
    },
  },
  snow_golem: {
    w: 64,
    h: 64,
    paint(ctx, rng) {
      const snow = ['#f4f8fc', '#e8eef4', '#ffffff', '#dce4ec'];
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => (f === 'front' ? (y > 1 && y < 7 && (x === 1 || x === 6 || y === 6) ? '#6a3a0a' : y === 3 && (x === 2 || x === 5) ? '#ffd040' : pick(rng, ['#e08a20', '#d07a18', '#f09a30'])) : pick(rng, ['#e08a20', '#c87018', '#d88028'])));
      box(ctx, 0, 16, 10, 10, 10, () => pick(rng, snow));
      box(ctx, 0, 36, 12, 12, 12, () => pick(rng, snow));
      box(ctx, 32, 0, 12, 2, 2, () => pick(rng, ['#5a3a1a', '#4a2a10']));
    },
  },
  minecart: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const iron = ['#8a8a8a', '#9a9a9a', '#7a7a7a', '#a8a8a8'];
      box(ctx, 0, 10, 20, 16, 2, () => pick(rng, iron));
      box(ctx, 0, 0, 16, 8, 2, (_f, _x, y) => (y === 0 || y === 7 ? '#5a5a5a' : pick(rng, iron)));
    },
  },
  husk: humanSkin({ skin: ['#b8a070', '#a89060', '#c8b080'], shirt: ['#7a6a4a', '#6a5a3a', '#8a7a5a'], pants: ['#5a4a3a', '#4a3a2a', '#6a5a4a'], shoes: '#3a2a1a', eyes: '#2a1a0a', mouth: '#5a4a2a' }),
  drowned: humanSkin({ skin: ['#4a9a8a', '#3a8a7a', '#5aaa9a'], shirt: ['#5a7a3a', '#4a6a2a', '#6a8a4a'], pants: ['#3a5a6a', '#2a4a5a', '#4a6a7a'], shoes: '#2a3a3a', eyes: '#60f0e0', mouth: '#2a4a3a' }),
  stray: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const bone = ['#b8c4c8', '#a8b4b8', '#c8d4d8'];
      const rag = ['#4a5a5a', '#5a6a6a', '#3a4a4a'];
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => (f === 'front' && y >= 3 && y <= 4 && (x === 1 || x === 2 || x === 5 || x === 6) ? '#1a1a1a' : pick(rng, bone)));
      box(ctx, 16, 16, 8, 12, 4, () => pick(rng, rag));
      box(ctx, 40, 16, 2, 12, 2, () => pick(rng, bone));
      box(ctx, 0, 16, 2, 12, 2, () => pick(rng, rag));
    },
  },
  enderman: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const b = ['#0e0e12', '#141418', '#1a1a20'];
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => (f === 'front' && y === 4 && (x <= 2 || x >= 5) ? (x === 1 || x === 6 ? '#e070ff' : '#c040e8') : pick(rng, b)));
      box(ctx, 32, 16, 8, 12, 4, () => pick(rng, b));
      box(ctx, 56, 0, 2, 30, 2, () => pick(rng, b));
    },
  },
  wolf: wolfSkin('#d8d0c8', '#b8b0a8'),
  wolf_tame: wolfSkin('#e0d8d0', '#c0b8b0'),
  wolf_angry: wolfSkin('#d0c8c0', '#a8a098', true),
  squid: squidSkin(['#1a3a5a', '#24486a', '#2e567a'], '#c8d8e8'),
  glow_squid: squidSkin(['#0a6a6a', '#10807a', '#18a098'], '#a0fff0'),
  bat: {
    w: 64,
    h: 64,
    paint(ctx, rng) {
      const fur = ['#4a3a2a', '#3a2a1a', '#5a4a3a'];
      box(ctx, 0, 0, 6, 6, 6, (f, x, y) => (f === 'front' && y === 2 && (x === 1 || x === 4) ? '#000000' : pick(rng, fur)));
      box(ctx, 0, 16, 6, 12, 6, () => pick(rng, fur));
      box(ctx, 24, 0, 3, 4, 1, () => pick(rng, fur));
      box(ctx, 42, 0, 10, 16, 1, () => pick(rng, ['#2a2018', '#1a1410', '#3a2a20']));
    },
  },
  villager: villagerSkin(['#6a4a2a', '#5a3a1a', '#7a5a3a'], false),
  witch: villagerSkin(['#3a2a4a', '#2a1a3a', '#4a3a5a'], true),
  zombified_piglin: {
    w: 64,
    h: 64,
    paint(ctx, rng) {
      const pink = ['#e8a0a0', '#d88e8e', '#f0b0aa'], rot = ['#7aa060', '#6a9050', '#8ab070'];
      const skin = () => (rng.next() < 0.3 ? pick(rng, rot) : pick(rng, pink));
      box(ctx, 0, 0, 10, 8, 8, (f, x, y) => (f === 'front' && y === 3 && (x === 2 || x === 7) ? '#1a1a1a' : f === 'front' && y === 3 && (x === 3 || x === 6) ? '#f0f0f0' : skin()));
      box(ctx, 31, 1, 4, 4, 1, (f, x, y) => (f === 'front' && y === 2 && (x === 1 || x === 2) ? '#8a4a4a' : '#e89a9a'));
      box(ctx, 2, 4, 1, 2, 1, () => '#f0ecd8');
      box(ctx, 2, 0, 1, 2, 1, () => '#f0ecd8');
      box(ctx, 51, 6, 1, 5, 4, () => pick(rng, pink));
      box(ctx, 39, 6, 1, 5, 4, () => pick(rng, pink));
      box(ctx, 16, 16, 8, 12, 4, (f, x, y) => (f === 'front' && y > 2 && y < 8 && (x === 2 || x === 5) && y % 2 === 0 ? '#e8e0d0' : y > 8 ? '#6a4a2a' : skin()));
      box(ctx, 40, 16, 4, 12, 4, () => skin());
      box(ctx, 32, 48, 4, 12, 4, () => skin());
      box(ctx, 0, 16, 4, 12, 4, (_f, _x, y) => (y < 6 ? '#6a4a2a' : skin()));
      box(ctx, 16, 48, 4, 12, 4, (_f, _x, y) => (y < 6 ? '#6a4a2a' : skin()));
    },
  },
  ghast: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const w = ['#f0f0f0', '#e4e4e4', '#d8d8d8', '#fafafa'];
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(0, 0, 16, 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, pick(rng, ['#dcdcdc', '#e8e8e8', '#cfcfcf']));
      box(ctx, 0, 0, 16, 16, 16, (f, x, y) => {
        if (f === 'front') {
          if ((y === 4 || y === 5) && ((x >= 2 && x <= 4) || (x >= 10 && x <= 12))) return '#2a2a2a';
          if (y >= 9 && y <= 10 && x >= 5 && x <= 10) return '#3a3a3a';
          if (y === 6 && (x === 3 || x === 11)) return '#9ab0c0';
        }
        return pick(rng, w);
      });
    },
  },
  magma_cube: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const dark = ['#3a1408', '#4a1a0a', '#2a0e06'], hot = ['#f08a20', '#ffb030', '#e05010'];
      for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) px(ctx, x, y, rng.next() < 0.18 ? pick(rng, hot) : pick(rng, dark));
      box(ctx, 0, 16, 4, 4, 4, () => pick(rng, ['#ffd040', '#ffb020', '#ffe080']));
      // yeux sur la face avant de la tranche 4
      for (const x of [2, 3, 12, 13]) px(ctx, 8 + (x - 8 + 8) % 8, 4 + 8, '#ffe040');
    },
  },
  blaze: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const y1 = ['#f0c020', '#e8a818', '#ffd840', '#d89010'];
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => (f === 'front' && y === 3 && (x === 1 || x === 2 || x === 5 || x === 6) ? '#2a1a0a' : f === 'front' && y === 5 && x >= 2 && x <= 5 ? '#5a3a0a' : pick(rng, y1)));
      box(ctx, 0, 16, 2, 8, 2, () => pick(rng, ['#f0a020', '#ffc040', '#d87810']));
    },
  },
  creeper: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const g = ['#4db33d', '#5ec74a', '#3e9a31', '#6fd35a', '#8fdc7a', '#2f7d26'];
      const face = (x: number, y: number) => ((y === 2 || y === 3) && (x === 1 || x === 2 || x === 5 || x === 6)) || (y === 4 && (x === 3 || x === 4)) || ((y === 5 || y === 6) && x >= 2 && x <= 5) || (y === 7 && (x === 2 || x === 5));
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => (f === 'front' && face(x, y) ? (y >= 4 ? '#0d1a0b' : '#000000') : pick(rng, g)));
      box(ctx, 16, 16, 8, 12, 4, () => pick(rng, g));
      box(ctx, 0, 16, 4, 6, 4, () => pick(rng, g));
    },
  },
  skeleton: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const bone = ['#c8c8c8', '#bcbcbc', '#d4d4d4', '#b0b0b0'];
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => {
        if (f === 'front') {
          if (y >= 3 && y <= 4 && (x === 1 || x === 2 || x === 5 || x === 6)) return '#1a1a1a';
          if (y === 6 && x >= 2 && x <= 5) return x % 2 ? '#3a3a3a' : '#9a9a9a';
        }
        return pick(rng, bone);
      });
      box(ctx, 16, 16, 8, 12, 4, (f, x, y) => (f === 'front' || f === 'back' ? (y % 3 === 1 && x > 0 && x < 7 ? '#5a5a5a' : x === 3 || x === 4 ? pick(rng, bone) : y % 3 === 1 ? '#5a5a5a' : null) ?? '#2a2a2a' : pick(rng, bone)));
      box(ctx, 40, 16, 2, 12, 2, () => pick(rng, bone));
      box(ctx, 0, 16, 2, 12, 2, () => pick(rng, bone));
    },
  },
  spider: spiderSkin(['#3a2e2a', '#2e2420', '#46382f'], '#c81a1a'),
  cave_spider: spiderSkin(['#1f3a3e', '#173034', '#2a4a4e'], '#e01a1a'),
  slime: {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      ctx.clearRect(0, 0, 64, 32);
      box(ctx, 0, 0, 8, 8, 8, () => `rgba(${100 + rng.int(0, 20)},${200 + rng.int(0, 30)},${90 + rng.int(0, 20)},0.55)`);
      box(ctx, 0, 16, 6, 6, 6, () => pick(rng, ['#4aa83a', '#5ab84a', '#3a9a2e']));
      box(ctx, 32, 0, 2, 2, 2, () => '#1a2a1a');
      box(ctx, 32, 4, 2, 2, 2, () => '#1a2a1a');
      box(ctx, 32, 8, 1, 1, 1, () => '#1a2a1a');
    },
  },
};

function humanSkin(c: { skin: string[]; shirt: string[]; pants: string[]; shoes: string; eyes: string; mouth: string }): SkinSpec {
  return {
    w: 64,
    h: 64,
    paint(ctx, rng) {
      box(ctx, 0, 0, 8, 8, 8, (f, x, y) => {
        if (f === 'front') {
          if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return x === 2 || x === 5 ? c.eyes : '#e8e8e8';
          if (y === 6 && x >= 2 && x <= 5) return c.mouth;
        }
        if (f === 'top' || (f !== 'bottom' && y < 1)) return pick(rng, c.skin.map((s) => s));
        return pick(rng, c.skin);
      });
      box(ctx, 16, 16, 8, 12, 4, () => pick(rng, c.shirt));
      box(ctx, 40, 16, 4, 12, 4, (f, _x, y) => (f !== 'bottom' && y < 4 ? pick(rng, c.shirt) : pick(rng, c.skin)));
      box(ctx, 0, 16, 4, 12, 4, (f, _x, y, _w, h) => (f !== 'top' && y >= h - 2 ? c.shoes : pick(rng, c.pants)));
    },
  };
}

function wolfSkin(fur: string, dark: string, angry = false): SkinSpec {
  return {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      const f = [fur, dark, fur, '#ffffff'];
      box(ctx, 0, 0, 6, 6, 4, (side, x, y) => (side === 'front' && y === 2 && (x === 1 || x === 4) ? (angry ? '#c01010' : '#1a1a1a') : pick(rng, f)));
      box(ctx, 16, 14, 2, 2, 1, () => dark);
      box(ctx, 0, 10, 3, 3, 4, (side, x, y) => (side === 'front' && y === 0 && x === 1 ? '#1a1a1a' : pick(rng, f)));
      box(ctx, 18, 14, 6, 9, 6, () => pick(rng, f));
      box(ctx, 21, 0, 8, 6, 7, () => pick(rng, f));
      box(ctx, 0, 18, 2, 8, 2, () => pick(rng, f));
      box(ctx, 9, 18, 2, 8, 2, () => pick(rng, f));
    },
  };
}

function squidSkin(pal: string[], eye: string): SkinSpec {
  return {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      box(ctx, 0, 0, 12, 16, 12, (f, x, y) => (f === 'front' && y === 11 && (x === 2 || x === 9) ? eye : pick(rng, pal)));
      box(ctx, 48, 0, 2, 18, 2, () => pick(rng, pal));
    },
  };
}

function villagerSkin(robe: string[], witch: boolean): SkinSpec {
  return {
    w: 64,
    h: witch ? 128 : 64,
    paint(ctx, rng) {
      const skin = witch ? ['#9aa080', '#8a9070', '#aab090'] : ['#b48a6a', '#a87e5e', '#c09676'];
      box(ctx, 0, 0, 8, 10, 8, (f, x, y) => (f === 'front' && y === 4 && (x === 2 || x === 5) ? '#2a6a2a' : f === 'front' && y === 4 && (x === 1 || x === 6) ? '#f0f0f0' : f === 'front' && y === 3 && x >= 1 && x <= 6 ? '#3a2a1a' : pick(rng, skin)));
      box(ctx, 24, 0, 2, 4, 2, () => pick(rng, skin));
      box(ctx, 16, 20, 8, 12, 6, () => pick(rng, robe));
      box(ctx, 0, 38, 8, 18, 6, () => pick(rng, robe));
      box(ctx, 44, 22, 4, 8, 4, () => pick(rng, robe));
      box(ctx, 40, 38, 8, 4, 4, () => pick(rng, robe));
      box(ctx, 0, 22, 4, 12, 4, () => pick(rng, ['#3a3a3a', '#2a2a2a']));
      if (witch) {
        const hat = ['#1a1a1a', '#2a1a2a', '#202020'];
        box(ctx, 0, 64, 10, 2, 10, () => pick(rng, hat));
        box(ctx, 0, 76, 7, 4, 7, (_f, _x, y) => (y === 3 ? '#7a2a9a' : pick(rng, hat)));
        box(ctx, 0, 87, 4, 4, 4, () => pick(rng, hat));
        box(ctx, 0, 95, 1, 2, 1, () => pick(rng, hat));
      }
    },
  };
}

function spiderSkin(pal: string[], eye: string): SkinSpec {
  return {
    w: 64,
    h: 32,
    paint(ctx, rng) {
      box(ctx, 32, 4, 8, 8, 8, (f, x, y) => {
        if (f === 'front' && ((y === 2 && (x === 1 || x === 6)) || (y === 3 && (x === 2 || x === 5)) || (y === 4 && (x === 3 || x === 4)))) return eye;
        return pick(rng, pal);
      });
      box(ctx, 0, 0, 6, 6, 6, () => pick(rng, pal));
      box(ctx, 0, 12, 10, 8, 12, (f, x, y) => (f === 'top' && (x + y) % 5 === 0 ? '#5a4a3a' : pick(rng, pal)));
      box(ctx, 18, 0, 16, 2, 2, () => pick(rng, pal));
    },
  };
}

/** Dessine une skin dans un canvas. */
export function paintSkin(key: string): HTMLCanvasElement | null {
  const spec = SKINS[key];
  if (!spec) return null;
  const c = document.createElement('canvas');
  c.width = spec.w;
  c.height = spec.h;
  const ctx = c.getContext('2d')!;
  spec.paint(ctx, new Rng(key.length * 7919 + key.charCodeAt(0)));
  return c;
}
