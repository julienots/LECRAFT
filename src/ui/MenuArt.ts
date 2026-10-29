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
  const grass = tm.tile(BlockRegistry.byName('grass_block').faceTiles[2], [124, 189, 74]);
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


/** Lettres supplémentaires (marque du studio de l'écran de démarrage). */
const FONT2: Record<string, string[]> = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
};
const glyph = (ch: string) => FONT[ch] ?? FONT2[ch];

/**
 * Logo de l'écran titre : lettres de pierre en relief (face claire, façade sombre, contour noir),
 * dessiné par le code — mêmes proportions que le logo des jeux de blocs, sans reprendre aucune marque.
 */
const LOGO: Record<string, string[]> = {
  L: ['XX.....', 'XX.....', 'XX.....', 'XX.....', 'XX.....', 'XX.....', 'XX.....', 'XXXXXXX', 'XXXXXXX'],
  E: ['XXXXXXX', 'XXXXXXX', 'XX.....', 'XXXXXX.', 'XXXXXX.', 'XX.....', 'XX.....', 'XXXXXXX', 'XXXXXXX'],
  C: ['.XXXXXX', 'XXXXXXX', 'XX.....', 'XX.....', 'XX.....', 'XX.....', 'XX.....', 'XXXXXXX', '.XXXXXX'],
  R: ['XXXXXX.', 'XXXXXXX', 'XX...XX', 'XXXXXXX', 'XXXXXX.', 'XX.XX..', 'XX..XX.', 'XX...XX', 'XX...XX'],
  A: ['.XXXXX.', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XX...XX'],
  F: ['XXXXXXX', 'XXXXXXX', 'XX.....', 'XXXXXX.', 'XXXXXX.', 'XX.....', 'XX.....', 'XX.....', 'XX.....'],
  T: ['XXXXXXX', 'XXXXXXX', '..XXX..', '..XXX..', '..XXX..', '..XXX..', '..XXX..', '..XXX..', '..XXX..'],
};

export function drawTitleLogo(tm: TextureManager | null): string {
  const text = 'LECRAFT';
  const c = 6; // pixels du canvas par cellule
  const lw = 7, lh = 9, gap = 1, depth = 3, pad = 2;
  const cols = text.length * (lw + gap) + pad * 2 + 1, rows = lh + depth + pad * 2;
  const W = cols * c, H = rows * c;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const on = new Uint8Array(cols * rows);
  [...text].forEach((ch, i) => {
    const ox = pad + i * (lw + gap), oy = pad;
    LOGO[ch].forEach((row, y) => [...row].forEach((v, x) => v === 'X' && (on[(oy + y) * cols + ox + x] = 1)));
  });
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && on[y * cols + x] === 1;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stone = tm?.tileByName('stone') ?? null;
  const sd = stone ? stone.getContext('2d')!.getImageData(0, 0, stone.width, stone.height) : null;
  const shade = (x: number, y: number, base: number) => {
    if (!sd) return Math.round(base * (0.9 + rnd() * 0.18));
    const i = ((y % sd.height) * sd.width + (x % sd.width)) * 4;
    return Math.max(0, Math.min(255, Math.round(base * (0.6 + (sd.data[i] / 255) * 0.7))));
  };
  // contour noir : une cellule autour de la face et de la façade
  ctx.fillStyle = '#000';
  for (let y = -1; y <= rows; y++)
    for (let x = -1; x <= cols; x++) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++)
        for (let dx = -1; dx <= 1 && !hit; dx++) for (let k = 0; k <= depth; k++) if (at(x + dx, y + dy - k)) hit = true;
      if (hit) ctx.fillRect(x * c, y * c, c, c);
    }
  // façade : extrusion vers le bas, plus sombre, avec des joints verticaux
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (at(x, y)) continue;
      let front = false;
      for (let k = 1; k <= depth; k++) if (at(x, y - k)) front = true;
      if (!front) continue;
      const v = shade(x * 2, y * 2, 120);
      ctx.fillStyle = `rgb(${v},${Math.round(v * 0.97)},${Math.round(v * 0.95)})`;
      ctx.fillRect(x * c, y * c, c, c);
      if (!at(x - 1, y - 1) || !at(x - 1, y - 2) || x % 3 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(x * c, y * c, 1, c);
      }
    }
  // face supérieure : pierre claire, arêtes éclairées en haut et à gauche, ombrées en bas
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (!at(x, y)) continue;
      const v = shade(x * 3, y * 3, 215);
      ctx.fillStyle = `rgb(${v},${Math.round(v * 0.975)},${Math.round(v * 0.96)})`;
      ctx.fillRect(x * c, y * c, c, c);
      if (!at(x, y - 1)) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(x * c, y * c, c, 2);
      }
      if (!at(x - 1, y)) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x * c, y * c, 2, c);
      }
      if (!at(x, y + 1)) {
        ctx.fillStyle = 'rgba(60,50,50,0.5)';
        ctx.fillRect(x * c, y * c + c - 2, c, 2);
      }
      if (!at(x + 1, y)) {
        ctx.fillStyle = 'rgba(60,50,50,0.3)';
        ctx.fillRect(x * c + c - 2, y * c, 2, c);
      }
      if ((x * 7 + y * 13) % 23 === 0) {
        ctx.fillStyle = 'rgba(80,70,70,0.3)';
        ctx.fillRect(x * c + 1, y * c + 2, c - 2, 1);
      }
    }
  return cv.toDataURL();
}

/** Marque du studio (écran de démarrage rouge) : « LEC / RAFT » en grosses lettres blanches et « STUDIOS » espacé. */
export function drawStudioMark(): string {
  const c = 6;
  const W = 34 * c, H = (9 + 2 + 9 + 3 + 8) * c;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  let y0 = 0;
  for (const line of ['LEC', 'RAFT']) {
    const tw = line.length * 8 - 1;
    let x0 = Math.floor((W / c - tw) / 2);
    for (const ch of line) {
      LOGO[ch].forEach((row, y) => [...row].forEach((v, x) => v === 'X' && ctx.fillRect((x0 + x) * c, (y0 + y) * c, c, c)));
      x0 += 8;
    }
    y0 += 9 + 2;
  }
  // « STUDIOS » : petites lettres espacées sur toute la largeur
  const t = 'STUDIOS';
  const step = 36 / t.length;
  const k = c * 0.62;
  y0 += 2;
  [...t].forEach((ch, i) => {
    const gx = (W / c - 33) / 2 + i * (33 / t.length) * 1.0;
    glyph(ch).forEach((row, y) =>
      [...row].forEach((v, x) => {
        if (v === '1') ctx.fillRect(gx * c + x * k * 1.15, (y0 + 0.2) * c + y * k * 1.15, k * 1.2, k * 1.2);
      }),
    );
  });
  void step;
  return cv.toDataURL();
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
  const grassSide = t('grass_block', 0, [124, 189, 74]), dirt = t('dirt'), stone = t('stone'), log = t('oak_log'), leaves = t('oak_leaves', 0, [95, 168, 58]), water = t('water'), sand = t('sand');
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
