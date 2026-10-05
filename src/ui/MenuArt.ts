import type { TextureManager } from '../render/TextureManager';
import { BlockRegistry } from '../blocks/BlockRegistry';

/** Police pixel 5x7 (lettres utilisées par le logo). */
const FONT: Record<string, string[]> = {
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};

/** Logo « LECRAFT » dessiné avec les textures de blocs du jeu. */
export function drawLogo(tm: TextureManager): string {
  const text = 'LECRAFT';
  const px = 10;
  const w = text.length * 6 * px + px, h = 9 * px + 8;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const stone = tm.tile(BlockRegistry.byName('stone').faceTiles[0]);
  const grass = tm.tile(BlockRegistry.byName('grass').faceTiles[2], [124, 189, 74]);
  [...text].forEach((ch, i) => {
    const g = FONT[ch];
    g.forEach((row, y) =>
      [...row].forEach((v, x) => {
        if (v !== '1') return;
        const X = (i * 6 + x) * px + px / 2, Y = y * px + px / 2;
        ctx.fillStyle = '#0008';
        ctx.fillRect(X + 4, Y + 5, px, px);
        ctx.drawImage(y < 2 ? grass : stone, (x * 3) % 8, (y * 3) % 8, 8, 8, X, Y, px, px);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(X, Y, px, 2);
      }),
    );
  });
  return c.toDataURL();
}

/** Paysage latéral en pixel-art (boucle horizontale de 2048 px) pour le menu. */
export function drawLandscape(tm: TextureManager): string {
  const W = 2048, H = 256, S = 16;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const t = (k: string, face = 0, tint?: [number, number, number]) => tm.tile(BlockRegistry.byName(k).faceTiles[face], tint);
  const grassSide = t('grass', 0, [124, 189, 74]), dirt = t('dirt'), stone = t('stone'), log = t('log'), leaves = t('leaves', 0, [95, 168, 58]), water = t('water'), sand = t('sand');
  const cols = W / S;
  const heights: number[] = [];
  for (let i = 0; i < cols; i++) {
    const a = (i / cols) * Math.PI * 2;
    heights.push(Math.round(7 + Math.sin(a * 3) * 2.5 + Math.sin(a * 7 + 1) * 1.5 + Math.sin(a * 13) * 0.8));
  }
  const rows = H / S;
  for (let i = 0; i < cols; i++) {
    const h = heights[i];
    for (let r = 0; r < rows; r++) {
      const y = H - (r + 1) * S;
      if (r < h) {
        const img = r === h - 1 ? (h <= 5 ? sand : grassSide) : r > h - 4 ? dirt : stone;
        ctx.drawImage(img, i * S, y);
      } else if (r < 5) ctx.drawImage(water, i * S, y);
    }
    if (h > 6 && i % 11 === 3) {
      const base = H - h * S;
      for (let k = 1; k <= 4; k++) ctx.drawImage(log, i * S, base - k * S);
      for (let dx = -2; dx <= 2; dx++) for (let dy = 3; dy <= 6; dy++) if (Math.abs(dx) + Math.max(0, dy - 5) < 3 || dy < 6) if (!(Math.abs(dx) === 2 && dy === 6)) ctx.drawImage(leaves, (i + dx) * S, base - dy * S);
    }
  }
  return c.toDataURL();
}

export function drawClouds(): string {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  let s = 99;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const x = rnd() * 1024, y = 10 + rnd() * 50, w = 60 + rnd() * 120, h = 16 + rnd() * 16;
    for (const ox of [0, -1024]) {
      ctx.fillRect(x + ox, y, w, h);
      ctx.fillRect(x + ox + w * 0.2, y - 12, w * 0.5, 14);
    }
  }
  return c.toDataURL();
}
