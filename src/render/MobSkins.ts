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
