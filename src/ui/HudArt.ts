/**
 * Sprites du HUD dessinés par le code (art original, proportions classiques : icônes 9x9,
 * barre d'objets 182x22, sélection 24x24, barre d'XP 182x5). Un pack de ressources installé
 * fournit les siens (dossier gui/sprites/hud, ou l'ancien gui/icons.png + gui/widgets.png).
 */
import type { TextureManager } from '../render/TextureManager';

const SHAPES: Record<string, string[]> = {
  heart: ['.kk...kk.', 'krrk.krrk', 'krwrkrrrk', 'krrrrrrrk', '.krrrrrk.', '..krrrk..', '...krk...', '....k....', '.........'],
  food: ['....kkk..', '...kbbbk.', '..kbebbbk', '..kbbbbbk', '.kbbbbbk.', 'kwkbbbk..', 'kwwkkk...', '.kk......', '.........'],
  armor: ['.kk...kk.', 'kaak.kaak', 'kaeakaaak', '.kaaaaak.', '.kaaaaak.', '.kaaaaak.', '.kaaaaak.', '.kkkkkkk.', '.........'],
  bubble: ['...kkk...', '..kcwck..', '.kcwccck.', '.kccccck.', '.kccccck.', '..kccck..', '...kkk...', '.........', '.........'],
};
const PAL: Record<string, string> = { k: '#1a0a0a', r: '#d8221e', w: '#ffc8c8', b: '#a8622c', e: '#d8925a', a: '#c4c8d0', c: '#5aa8ff' };

function cv(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

/** Icône 9x9 : `fill` = 'full' | 'half' | 'empty' (moitié gauche pour cœurs/armure, droite pour la faim). */
function icon(kind: keyof typeof SHAPES, fill: 'full' | 'half' | 'empty'): string {
  const { c, ctx } = cv(9, 9);
  const rows = SHAPES[kind];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      let color = PAL[ch];
      if (ch !== 'k') {
        const filled = fill === 'full' || (fill === 'half' && (kind === 'food' ? x >= 4 : x <= 4));
        if (!filled) color = 'rgba(0,0,0,0.45)';
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return c.toDataURL();
}

function hotbar(): string {
  const { c, ctx } = cv(182, 22);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 182, 22);
  for (let i = 0; i < 9; i++) {
    const x = 1 + i * 20;
    ctx.fillStyle = '#6a6a6a';
    ctx.fillRect(x, 1, 20, 20);
    ctx.fillStyle = 'rgba(20,20,20,0.92)';
    ctx.fillRect(x + 2, 3, 16, 16);
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(x, 1, 20, 1);
    ctx.fillRect(x, 1, 1, 20);
    ctx.fillStyle = '#3c3c3c';
    ctx.fillRect(x + 1, 3, 1, 16);
    ctx.fillRect(x + 2, 2, 16, 1);
  }
  // fond semi-transparent comme l'original
  const img = ctx.getImageData(0, 0, 182, 22);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = Math.min(img.data[i], 200);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function selection(): string {
  const { c, ctx } = cv(24, 24);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 24, 24);
  ctx.clearRect(4, 4, 16, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1, 1, 22, 2);
  ctx.fillRect(1, 21, 22, 2);
  ctx.fillRect(1, 1, 2, 22);
  ctx.fillRect(21, 1, 2, 22);
  ctx.fillStyle = '#a0a0a0';
  ctx.fillRect(3, 3, 18, 1);
  ctx.fillRect(3, 20, 18, 1);
  ctx.fillRect(3, 3, 1, 18);
  ctx.fillRect(20, 3, 1, 18);
  ctx.clearRect(0, 0, 1, 1);
  ctx.clearRect(23, 0, 1, 1);
  ctx.clearRect(0, 23, 1, 1);
  ctx.clearRect(23, 23, 1, 1);
  return c.toDataURL();
}

function xpBar(progress: boolean): string {
  const { c, ctx } = cv(182, 5);
  if (!progress) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 182, 5);
    ctx.fillStyle = '#2c2c2c';
    ctx.fillRect(1, 1, 180, 3);
    ctx.fillStyle = '#000';
    for (let i = 1; i < 18; i++) ctx.fillRect(Math.round((i * 182) / 18), 1, 1, 3);
  } else {
    ctx.fillStyle = '#6ad81c';
    ctx.fillRect(1, 1, 180, 3);
    ctx.fillStyle = '#b8ff70';
    ctx.fillRect(1, 1, 180, 1);
    ctx.fillStyle = '#3c8a10';
    ctx.fillRect(1, 3, 180, 1);
  }
  return c.toDataURL();
}

export interface HudSprites {
  [k: string]: string;
}

function crop(img: ImageBitmap, x: number, y: number, w: number, h: number, sheet = 256): string {
  const k = img.width / sheet;
  const { c, ctx } = cv(w, h);
  ctx.drawImage(img, x * k, y * k, w * k, h * k, 0, 0, w, h);
  return c.toDataURL();
}
function whole(img: ImageBitmap, w: number, h: number): string {
  const { c, ctx } = cv(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL();
}

export function buildHudSprites(tex: TextureManager): HudSprites {
  const s: HudSprites = {
    heart_full: icon('heart', 'full'),
    heart_half: icon('heart', 'half'),
    heart_empty: icon('heart', 'empty'),
    food_full: icon('food', 'full'),
    food_half: icon('food', 'half'),
    food_empty: icon('food', 'empty'),
    armor_full: icon('armor', 'full'),
    armor_half: icon('armor', 'half'),
    armor_empty: icon('armor', 'empty'),
    air: icon('bubble', 'full'),
    hotbar: hotbar(),
    selection: selection(),
    xp_bg: xpBar(false),
    xp_fill: xpBar(true),
  };
  // sprites modernes (1.20.2+)
  const m = (key: string, path: string, w: number, h: number) => {
    const img = tex.packImage(`gui/sprites/hud/${path}.png`);
    if (img) s[key] = whole(img, w, h);
    return !!img;
  };
  const modern = m('heart_full', 'heart/full', 9, 9);
  if (modern) {
    m('heart_half', 'heart/half', 9, 9);
    // cœur vide = conteneur seul
    m('heart_empty', 'heart/container', 9, 9);
    m('food_full', 'food_full', 9, 9);
    m('food_half', 'food_half', 9, 9);
    m('food_empty', 'food_empty', 9, 9);
    m('armor_full', 'armor_full', 9, 9);
    m('armor_half', 'armor_half', 9, 9);
    m('armor_empty', 'armor_empty', 9, 9);
    m('air', 'air', 9, 9);
    m('hotbar', 'hotbar', 182, 22);
    m('selection', 'hotbar_selection', 24, 23);
    m('xp_bg', 'experience_bar_background', 182, 5);
    m('xp_fill', 'experience_bar_progress', 182, 5);
    // les cœurs « pleins » modernes s'affichent par-dessus le conteneur
    const cont = tex.packImage('gui/sprites/hud/heart/container.png');
    if (cont) {
      for (const k of ['heart_full', 'heart_half'] as const) {
        const full = tex.packImage(`gui/sprites/hud/heart/${k === 'heart_full' ? 'full' : 'half'}.png`)!;
        const { c, ctx } = cv(9, 9);
        ctx.drawImage(cont, 0, 0, 9, 9);
        ctx.drawImage(full, 0, 0, 9, 9);
        s[k] = c.toDataURL();
      }
    }
  } else {
    const icons = tex.packImage('gui/icons.png');
    if (icons) {
      const both = (x: number, y: number) => {
        const k = icons.width / 256;
        const { c, ctx } = cv(9, 9);
        ctx.drawImage(icons, 16 * k, y * k, 9 * k, 9 * k, 0, 0, 9, 9);
        ctx.drawImage(icons, x * k, y * k, 9 * k, 9 * k, 0, 0, 9, 9);
        return c.toDataURL();
      };
      s.heart_full = both(52, 0);
      s.heart_half = both(61, 0);
      s.heart_empty = crop(icons, 16, 0, 9, 9);
      s.food_full = both(52, 27);
      s.food_half = both(61, 27);
      s.food_empty = crop(icons, 16, 27, 9, 9);
      s.armor_full = crop(icons, 34, 9, 9, 9);
      s.armor_half = crop(icons, 25, 9, 9, 9);
      s.armor_empty = crop(icons, 16, 9, 9, 9);
      s.air = crop(icons, 16, 18, 9, 9);
      s.xp_bg = crop(icons, 0, 64, 182, 5);
      s.xp_fill = crop(icons, 0, 69, 182, 5);
    }
    const widgets = tex.packImage('gui/widgets.png');
    if (widgets) {
      s.hotbar = crop(widgets, 0, 0, 182, 22);
      s.selection = crop(widgets, 0, 22, 24, 24);
    }
  }
  return s;
}
