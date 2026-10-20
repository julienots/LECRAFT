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
function icon(kind: keyof typeof SHAPES, fill: 'full' | 'half' | 'empty', pal: Record<string, string> = {}): string {
  const { c, ctx } = cv(9, 9);
  const rows = SHAPES[kind];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      let color = pal[ch] ?? PAL[ch];
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
  // 24 × 23 comme le sprite moderne (le bas de la sélection touche le bord de l'écran)
  const { c, ctx } = cv(24, 23);
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

/** Barre de boss 182 × 5 (rangées : bord sombre, reflet, couleur, ombre, bord). */
function bossBar(rows: string[]): string {
  const { c, ctx } = cv(182, 5);
  rows.forEach((col, y) => {
    ctx.fillStyle = col;
    ctx.fillRect(1, y, 180, 1);
  });
  ctx.fillStyle = rows[0];
  ctx.fillRect(0, 0, 1, 5);
  ctx.fillRect(181, 0, 1, 5);
  return c.toDataURL();
}

/** Réticule 15 × 15 et indicateur de recharge d'attaque (16 × 4). */
function crosshair(): string {
  const { c, ctx } = cv(15, 15);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(7, 0, 1, 15);
  ctx.fillRect(0, 7, 15, 1);
  return c.toDataURL();
}
function attackBar(progress: boolean): string {
  const { c, ctx } = cv(16, 4);
  if (progress) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 16, 4);
  } else {
    ctx.fillStyle = '#3a3b3c';
    ctx.fillRect(0, 0, 16, 4);
  }
  return c.toDataURL();
}

export function buildHudSprites(tex: TextureManager): HudSprites {
  const RED = {}, GREEN = { r: '#3c8a2a', w: '#a8e090' }, BLACK = { r: '#3a3a3a', w: '#8a8a8a' }, GOLD = { r: '#e0b020', w: '#fff0a0' }, BLUE = { r: '#60a8d8', w: '#d8f0ff' };
  const BLINK = { k: '#ffffff' };
  const s: HudSprites = {
    heart_container: icon('heart', 'empty'),
    heart_container_blinking: icon('heart', 'empty', BLINK),
    food_empty: icon('food', 'empty'),
    food_empty_hunger: icon('food', 'empty'),
    armor_full: icon('armor', 'full'),
    armor_half: icon('armor', 'half'),
    armor_empty: icon('armor', 'empty'),
    air: icon('bubble', 'full'),
    air_bursting: icon('bubble', 'full', { c: '#a8d4ff' }),
    hotbar: hotbar(),
    selection: selection(),
    xp_bg: xpBar(false),
    xp_fill: xpBar(true),
    crosshair: crosshair(),
    attack_bg: attackBar(false),
    attack_progress: attackBar(true),
    boss_pink_bg: bossBar(['#26001e', '#490039', '#39002c', '#490039', '#26001e']),
    boss_pink: bossBar(['#4a003a', '#ec00b8', '#b90090', '#8c006d', '#4a003a']),
    boss_purple_bg: bossBar(['#130026', '#260049', '#1e0039', '#260049', '#130026']),
    boss_purple: bossBar(['#26004a', '#7b00ec', '#6100b9', '#49008c', '#26004a']),
  };
  for (const [v, pal] of [['', RED], ['poisoned_', GREEN], ['withered_', BLACK], ['absorbing_', GOLD], ['frozen_', BLUE]] as const)
    for (const h of ['full', 'half'] as const) {
      s[`heart_${v}${h}`] = icon('heart', h, pal);
      s[`heart_${v}${h}_blinking`] = icon('heart', h, { ...pal, k: '#ffffff' });
    }
  for (const h of ['full', 'half'] as const) {
    s[`food_${h}`] = icon('food', h);
    s[`food_${h}_hunger`] = icon('food', h, { b: '#6a8a30', e: '#9ab860' });
  }
  // sprites modernes (1.20.2+) : chaque sprite est une couche (le conteneur est dessiné dessous)
  const m = (key: string, path: string, w: number, h: number) => {
    const img = tex.packImage(`gui/sprites/${path}.png`);
    if (img) s[key] = whole(img, w, h);
    return !!img;
  };
  const modern = m('heart_full', 'hud/heart/full', 9, 9);
  if (modern) {
    m('heart_container', 'hud/heart/container', 9, 9);
    m('heart_container_blinking', 'hud/heart/container_blinking', 9, 9);
    m('heart_container_hardcore', 'hud/heart/container_hardcore', 9, 9);
    m('heart_container_hardcore_blinking', 'hud/heart/container_hardcore_blinking', 9, 9);
    m('heart_vehicle_container', 'hud/heart/vehicle_container', 9, 9);
    m('heart_vehicle_full', 'hud/heart/vehicle_full', 9, 9);
    m('heart_vehicle_half', 'hud/heart/vehicle_half', 9, 9);
    for (const v of ['', 'poisoned_', 'withered_', 'absorbing_', 'frozen_'])
      for (const hc of ['', 'hardcore_'])
        for (const h of ['full', 'half'])
          for (const b of ['', '_blinking']) m(`heart_${v}${hc}${h}${b}`, `hud/heart/${v}${hc}${h}${b}`, 9, 9);
    for (const h of ['full', 'half', 'empty']) {
      m(`food_${h}`, `hud/food_${h}`, 9, 9);
      m(`food_${h}_hunger`, `hud/food_${h}_hunger`, 9, 9);
      m(`armor_${h}`, `hud/armor_${h}`, 9, 9);
    }
    m('air', 'hud/air', 9, 9);
    m('air_bursting', 'hud/air_bursting', 9, 9);
    m('air_empty', 'hud/air_empty', 9, 9);
    m('hotbar', 'hud/hotbar', 182, 22);
    m('selection', 'hud/hotbar_selection', 24, 23);
    m('xp_bg', 'hud/experience_bar_background', 182, 5);
    m('xp_fill', 'hud/experience_bar_progress', 182, 5);
    m('crosshair', 'hud/crosshair', 15, 15);
    m('attack_bg', 'hud/crosshair_attack_indicator_background', 16, 4);
    m('attack_progress', 'hud/crosshair_attack_indicator_progress', 16, 4);
    m('attack_full', 'hud/crosshair_attack_indicator_full', 16, 16);
    for (const col of ['pink', 'purple']) {
      m(`boss_${col}_bg`, `boss_bar/${col}_background`, 182, 5);
      m(`boss_${col}`, `boss_bar/${col}_progress`, 182, 5);
    }
  } else {
    const icons = tex.packImage('gui/icons.png');
    if (icons) {
      // anciens packs : icônes déjà composées sur leur conteneur
      const both = (x: number, y: number) => {
        const k = icons.width / 256;
        const { c, ctx } = cv(9, 9);
        ctx.drawImage(icons, 16 * k, y * k, 9 * k, 9 * k, 0, 0, 9, 9);
        ctx.drawImage(icons, x * k, y * k, 9 * k, 9 * k, 0, 0, 9, 9);
        return c.toDataURL();
      };
      s.heart_full = both(52, 0);
      s.heart_half = both(61, 0);
      s.heart_container = crop(icons, 16, 0, 9, 9);
      s.heart_container_blinking = crop(icons, 25, 0, 9, 9);
      s.heart_poisoned_full = both(88, 0);
      s.heart_poisoned_half = both(97, 0);
      s.heart_withered_full = both(124, 0);
      s.heart_withered_half = both(133, 0);
      s.heart_absorbing_full = both(160, 0);
      s.heart_absorbing_half = both(169, 0);
      s.food_full = both(52, 27);
      s.food_half = both(61, 27);
      s.food_empty = crop(icons, 16, 27, 9, 9);
      s.food_full_hunger = both(88, 27);
      s.food_half_hunger = both(97, 27);
      s.food_empty_hunger = crop(icons, 133, 27, 9, 9);
      s.armor_full = crop(icons, 34, 9, 9, 9);
      s.armor_half = crop(icons, 25, 9, 9, 9);
      s.armor_empty = crop(icons, 16, 9, 9, 9);
      s.air = crop(icons, 16, 18, 9, 9);
      s.air_bursting = crop(icons, 25, 18, 9, 9);
      s.xp_bg = crop(icons, 0, 64, 182, 5);
      s.xp_fill = crop(icons, 0, 69, 182, 5);
      s.crosshair = crop(icons, 0, 0, 15, 15);
      s.attack_bg = crop(icons, 36, 94, 16, 4);
      s.attack_progress = crop(icons, 52, 94, 16, 4);
      s.attack_full = crop(icons, 68, 94, 16, 16);
    }
    const widgets = tex.packImage('gui/widgets.png');
    if (widgets) {
      s.hotbar = crop(widgets, 0, 0, 182, 22);
      s.selection = crop(widgets, 0, 22, 24, 23);
    }
  }
  return s;
}
