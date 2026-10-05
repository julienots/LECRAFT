/**
 * Thème visuel « jeu de blocs » des menus : boutons en pierre (9-slice via border-image),
 * curseurs, champs de texte, fond des listes. Les images sont dessinées par le code au démarrage
 * puis exposées en variables CSS ; un pack de ressources installé les remplace par ses sprites.
 */
import type { TextureManager } from '../render/TextureManager';
import { Rng } from '../util/math';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

/** Bouton 200x20 : bord noir, biseau clair en haut, sombre en bas, surface grise granuleuse. */
function drawButton(state: 'normal' | 'hover' | 'off'): string {
  const { c, ctx } = canvas(200, 20);
  const rng = new Rng(state === 'normal' ? 11 : state === 'hover' ? 12 : 13);
  const base = state === 'off' ? 44 : state === 'hover' ? 126 : 111;
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 200; x++) {
      const n = Math.floor((rng.next() - 0.5) * (state === 'off' ? 6 : 14));
      const v = base + n;
      ctx.fillStyle = `rgb(${v},${v},${v + (state === 'hover' ? 8 : 0)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  const hi = state === 'off' ? '#3c3c3c' : state === 'hover' ? '#c8c8ff' : '#a8a8a8';
  const lo = state === 'off' ? '#242424' : state === 'hover' ? '#5a5a8a' : '#565656';
  ctx.fillStyle = hi;
  ctx.fillRect(1, 1, 198, 1);
  ctx.fillRect(1, 1, 1, 17);
  ctx.fillStyle = lo;
  ctx.fillRect(1, 17, 198, 2);
  ctx.fillRect(198, 2, 1, 16);
  ctx.strokeStyle = state === 'hover' ? '#ffffff' : '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, 199, 19);
  return c.toDataURL();
}

/** Fond de curseur (piste sombre) et poignée 8x20. */
function drawSliderTrack(): string {
  const { c, ctx } = canvas(200, 20);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 200, 20);
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(1, 1, 198, 18);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(1, 1, 198, 1);
  ctx.fillRect(1, 1, 1, 18);
  return c.toDataURL();
}

/** Tuile de fond des écrans d'options (terre assombrie, comme les anciens menus). */
function drawOptionsBg(tex: TextureManager): string {
  const { c, ctx } = canvas(32, 32);
  const dirt = tex.tileByName('dirt');
  if (dirt) for (let i = 0; i < 4; i++) ctx.drawImage(dirt, (i % 2) * 16, Math.floor(i / 2) * 16);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, 32, 32);
  return c.toDataURL();
}

function fromPack(tex: TextureManager, paths: string[], legacy?: { path: string; x: number; y: number; w: number; h: number }): string | null {
  const img = tex.packImage(...paths);
  if (img) {
    const { c, ctx } = canvas(img.width, img.height);
    ctx.drawImage(img, 0, 0);
    return c.toDataURL();
  }
  if (legacy) {
    const l = tex.packImage(legacy.path);
    if (!l) return null;
    const k = l.width / 256;
    const { c, ctx } = canvas(legacy.w * k, legacy.h * k);
    ctx.drawImage(l, legacy.x * k, legacy.y * k, legacy.w * k, legacy.h * k, 0, 0, legacy.w * k, legacy.h * k);
    return c.toDataURL();
  }
  return null;
}

/** Applique (ou réapplique après un changement de pack) les images du thème. */
export function applyTheme(tex: TextureManager) {
  const root = document.documentElement.style;
  const set = (name: string, url: string) => root.setProperty(name, `url(${url})`);
  set('--mc-btn', fromPack(tex, ['gui/sprites/widget/button.png'], { path: 'gui/widgets.png', x: 0, y: 66, w: 200, h: 20 }) ?? drawButton('normal'));
  set('--mc-btn-hover', fromPack(tex, ['gui/sprites/widget/button_highlighted.png'], { path: 'gui/widgets.png', x: 0, y: 86, w: 200, h: 20 }) ?? drawButton('hover'));
  set('--mc-btn-off', fromPack(tex, ['gui/sprites/widget/button_disabled.png'], { path: 'gui/widgets.png', x: 0, y: 46, w: 200, h: 20 }) ?? drawButton('off'));
  set('--mc-slider', fromPack(tex, ['gui/sprites/widget/slider.png']) ?? drawSliderTrack());
  set('--mc-handle', fromPack(tex, ['gui/sprites/widget/slider_handle.png']) ?? drawButton('normal'));
  set('--mc-handle-hover', fromPack(tex, ['gui/sprites/widget/slider_handle_highlighted.png']) ?? drawButton('hover'));
  set('--mc-options-bg', drawOptionsBg(tex));
  updateGuiScale();
}

/** Échelle d'interface (comme l'option « Taille de l'interface ») : multiple de 0,5 adapté à l'écran. */
export function updateGuiScale() {
  const k = Math.min(window.innerWidth / 330, window.innerHeight / 230);
  const gs = Math.max(1.5, Math.min(4, Math.floor(k * 2) / 2));
  document.documentElement.style.setProperty('--gs', String(gs));
  return gs;
}

window.addEventListener('resize', () => updateGuiScale());
