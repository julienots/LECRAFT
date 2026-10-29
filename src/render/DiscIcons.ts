/**
 * Icônes des disques de musique. Les disques de LeCraft reprennent le disque du pack de
 * ressources (item/music_disc_13.png) avec leur étiquette recolorée, et une fêlure pour les disques
 * « fendus » ; sans pack, un disque est dessiné (sillons, étiquette, trou central). Les disques du
 * jeu de référence absents du pack utilisent aussi ce dessin de repli.
 */
import { DISCS, LECRAFT_DISC_KEYS } from '../data/discs';

/** Fêlure (pixels x, y sur 16×16) des disques fendus. */
const CRACK: [number, number][] = [[4, 4], [5, 5], [5, 6], [6, 7], [7, 7], [8, 8], [8, 9], [9, 10], [10, 10], [11, 11]];

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Disque dessiné (repli sans pack) : 16×16 RGBA. */
export function drawDisc(label: string, cracked: boolean): ImageData {
  const img = new ImageData(16, 16);
  const d = img.data;
  const [lr, lg, lb] = hex(label);
  const set = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    const i = (y * 16 + x) * 4;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
  };
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = (y - 7.5) * 1.18;
      const r = Math.hypot(dx, dy);
      if (r > 7.2) continue;
      if (r < 0.9) set(x, y, 0x18, 0x18, 0x18);
      else if (r < 2.6) {
        // étiquette, plus claire en haut à gauche
        const k = 1 + (-dx - dy) * 0.06;
        set(x, y, Math.min(255, lr * k), Math.min(255, lg * k), Math.min(255, lb * k));
      } else {
        // vinyle : sillons alternés et reflet
        const groove = Math.floor(r * 1.4) % 2 ? 0x40 : 0x30;
        const shine = dx < -1 && dy < -1 && r > 4 && r < 5.5 ? 0x18 : 0;
        const edge = r > 6.4 ? -0x10 : 0;
        const v = groove + shine + edge;
        set(x, y, v, v, v);
      }
    }
  if (cracked) for (const [x, y] of CRACK) set(x, y, 0, 0, 0, 0);
  return img;
}

/** Recolore l'étiquette d'un disque du pack (pixels saturés ou très clairs au centre). */
export function recolorDisc(base: ImageData, label: string, cracked: boolean): ImageData {
  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  const d = out.data;
  const [lr, lg, lb] = hex(label);
  const w = base.width, s = w / 16;
  for (let y = 0; y < base.height; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0;
      if (sat < 0.35 || mx < 90) continue;
      const k = mx / 255;
      d[i] = Math.min(255, lr * (0.55 + 0.6 * k));
      d[i + 1] = Math.min(255, lg * (0.55 + 0.6 * k));
      d[i + 2] = Math.min(255, lb * (0.55 + 0.6 * k));
    }
  if (cracked)
    for (const [cx, cy] of CRACK)
      for (let yy = 0; yy < s; yy++)
        for (let xx = 0; xx < s; xx++) d[((cy * s + yy) * w + cx * s + xx) * 4 + 3] = 0;
  return out;
}

/**
 * Icône d'un disque (16×16 ou à la taille du pack), ou null si ce n'est pas un disque à dessiner
 * ici (disque du jeu de référence présent dans le pack : icône du pack). `pack(path)` donne les
 * pixels d'une texture du pack (chemin relatif à textures/), ou null.
 */
export function discIcon(itemId: string, pack: (path: string) => ImageData | null): ImageData | null {
  const info = DISCS[itemId];
  if (!info) return null;
  const own = LECRAFT_DISC_KEYS.includes(itemId);
  if (!own) return pack(`item/${itemId}.png`) ? null : drawDisc(info.label, !!info.cracked);
  const base = pack('item/music_disc_13.png');
  return base ? recolorDisc(base, info.label, !!info.cracked) : drawDisc(info.label, !!info.cracked);
}
