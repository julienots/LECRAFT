/**
 * Zombie « ultra réaliste » : skin haute définition (512×512, 8 pixels par texel de la
 * disposition 64×64 du joueur) peinte procéduralement — peau en décomposition marbrée et veinée,
 * orbites creuses et yeux laiteux injectés de sang, nez rongé, mâchoire ouverte aux dents
 * cassées, plaies à vif, chemise en lambeaux tachée de sang, jean usé déchiré, chaussures usées.
 * Les couches extérieures (cheveux clairsemés, lambeaux de chemise, manches déchirées) donnent
 * du relief au modèle.
 */
const S = 8; // pixels par texel
const W = 64 * S;

type RGB = [number, number, number];
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number, oct = 4) {
  let a = 0.5, f = 1, t = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    t += vnoise(x * f, y * f, s + i * 17) * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return t / n;
}

/** Une face de la disposition de skin : coin (u, v) et taille en texels. */
interface Face { u: number; v: number; w: number; h: number; kind: 'top' | 'bottom' | 'side' | 'front' | 'back' }
function boxFaces(u: number, v: number, w: number, h: number, d: number): Face[] {
  return [
    { u: u + d, v, w, h: d, kind: 'top' },
    { u: u + d + w, v, w, h: d, kind: 'bottom' },
    { u, v: v + d, w: d, h, kind: 'side' },
    { u: u + d, v: v + d, w, h, kind: 'front' },
    { u: u + d + w, v: v + d, w: d, h, kind: 'side' },
    { u: u + 2 * d + w, v: v + d, w, h, kind: 'back' },
  ];
}

class Painter {
  readonly data: Uint8ClampedArray;
  constructor(readonly img: ImageData) {
    this.data = img.data;
  }
  set(x: number, y: number, c: RGB, a = 255) {
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    const i = (y * W + x) * 4;
    this.data[i] = clamp(c[0]);
    this.data[i + 1] = clamp(c[1]);
    this.data[i + 2] = clamp(c[2]);
    this.data[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = (y * W + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  alpha(x: number, y: number) {
    return this.data[(y * W + x) * 4 + 3];
  }
  /** Remplit une face : fn(lx, ly) avec lx, ly en texels locaux (flottants). */
  face(f: Face, fn: (lx: number, ly: number, px: number, py: number) => RGB | null, alpha = 255) {
    for (let py = f.v * S; py < (f.v + f.h) * S; py++)
      for (let px = f.u * S; px < (f.u + f.w) * S; px++) {
        const c = fn((px - f.u * S + 0.5) / S, (py - f.v * S + 0.5) / S, px, py);
        if (c) this.set(px, py, c, alpha);
      }
  }
  /** Relief : éclairage d'une carte de hauteur (lumière venant d'en haut à gauche). */
  emboss(f: Face, height: (px: number, py: number) => number, k: number) {
    for (let py = f.v * S; py < (f.v + f.h) * S; py++)
      for (let px = f.u * S; px < (f.u + f.w) * S; px++) {
        if (!this.alpha(px, py)) continue;
        const m = 1 + k * (height(px - 1, py - 1) - height(px + 1, py + 1));
        const c = this.get(px, py);
        this.set(px, py, [c[0] * m, c[1] * m, c[2] * m], this.alpha(px, py));
      }
  }

  /** Ombrage de volume : haut éclairé, bas et bords assombris (occlusion ambiante). */
  shade(f: Face, strength = 1) {
    const k = f.kind === 'top' ? 1.08 : f.kind === 'bottom' ? 0.62 : 1;
    for (let py = f.v * S; py < (f.v + f.h) * S; py++)
      for (let px = f.u * S; px < (f.u + f.w) * S; px++) {
        if (!this.alpha(px, py)) continue;
        const lx = (px - f.u * S + 0.5) / (f.w * S), ly = (py - f.v * S + 0.5) / (f.h * S);
        const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
        const ao = 1 - 0.22 * strength * (1 - smooth(0, 0.18, edge));
        const vert = f.kind === 'top' || f.kind === 'bottom' ? 1 : 1.07 - 0.16 * ly;
        const m = k * ao * vert;
        const c = this.get(px, py);
        this.set(px, py, [c[0] * m, c[1] * m, c[2] * m], this.alpha(px, py));
      }
  }
}

// ---------- matières ----------
const SKIN: RGB = [112, 124, 92];
function skin(px: number, py: number): RGB {
  const n = fbm(px / 38, py / 38, 1);
  const fine = fbm(px / 6, py / 6, 2, 2);
  const bruise = smooth(0.62, 0.8, fbm(px / 70 + 7, py / 70, 3));
  const yellow = smooth(0.55, 0.75, fbm(px / 50, py / 50 + 3, 4));
  let c = mix(SKIN, [74, 88, 64], n * 0.9);
  c = mix(c, [150, 146, 104], yellow * 0.3);
  c = mix(c, [92, 70, 86], bruise * 0.5);
  c = mix(c, [128, 104, 92], smooth(0.6, 0.8, fbm(px / 30 + 5, py / 30, 6)) * 0.25); // marbrures
  const pore = hash(px, py, 9) < 0.035 ? 0.82 : 1;
  const m = (0.88 + fine * 0.24) * pore;
  return [c[0] * m, c[1] * m, c[2] * m];
}
function flesh(px: number, py: number): RGB {
  const n = fbm(px / 5, py / 5, 11, 3);
  const c = mix([112, 30, 30], [52, 10, 14], n);
  return hash(px, py, 12) < 0.04 ? [150, 70, 64] : c;
}
const SHIRT: RGB = [64, 100, 102];
function shirt(px: number, py: number): RGB {
  const weave = ((px >> 1) + (py >> 1)) % 2 ? 0.98 : 1.02;
  const fade = fbm(px / 60, py / 60, 21);
  const grime = smooth(0.55, 0.85, fbm(px / 25, py / 25, 22));
  let c = mix(SHIRT, [110, 150, 140], fade * 0.35);
  c = mix(c, [70, 60, 40], grime * 0.6);
  const m = weave * (0.9 + fbm(px / 4, py / 4, 23, 2) * 0.2);
  return [c[0] * m, c[1] * m, c[2] * m];
}
const DENIM: RGB = [48, 56, 104];
function denim(px: number, py: number): RGB {
  const twill = ((px + py) % 6 < 3 ? 1.06 : 0.93) * (((px - py * 2) & 7) === 0 ? 0.9 : 1);
  const fade = fbm(px / 45, py / 45, 31);
  let c = mix(DENIM, [92, 104, 150], smooth(0.5, 0.85, fade) * 0.5);
  const thread = hash(px, py, 32) < 0.06 ? 1.25 : 1;
  c = [c[0] * twill * thread, c[1] * twill * thread, c[2] * twill * thread];
  return c;
}
function leather(px: number, py: number): RGB {
  const n = fbm(px / 9, py / 9, 41);
  const c = mix([58, 40, 28], [30, 22, 16], n);
  return hash(px, py, 42) < 0.04 ? [92, 72, 52] : c;
}
function hairCol(px: number, py: number): RGB {
  const strand = Math.sin(px * 0.9 + vnoise(px / 6, py / 9, 51) * 8) * 0.5 + 0.5;
  return mix([26, 22, 18], [64, 52, 40], strand * 0.6);
}

/** Taches de sang (fond assombri, bords plus clairs) et coulures. */
function blood(p: Painter, cx: number, cy: number, r: number, seed: number, drip = 0) {
  for (let y = Math.floor(cy - r * 1.4); y < cy + r * 1.4 + drip; y++)
    for (let x = Math.floor(cx - r * 1.4); x < cx + r * 1.4; x++) {
      if (!p.alpha(x, y)) continue;
      const d = Math.hypot((x - cx) / r, (y - cy) / r) + (fbm(x / 6, y / 6, seed) - 0.5) * 0.9;
      const inDrip = y > cy && y < cy + drip && Math.abs(x - cx - Math.sin((y - cy) / 9) * 3) < 2.2 - (y - cy) / (drip + 1) * 1.5;
      if (d < 1 || inDrip) {
        const c = p.get(x, y);
        const k = d < 0.7 || inDrip ? 0.85 : 0.55;
        const dry = fbm(x / 7, y / 7, seed + 1);
        p.set(x, y, mix(c, mix([78, 12, 14], [42, 12, 10], dry), k), p.alpha(x, y));
      }
    }
}

/** Veines sombres (marches aléatoires) sur la peau d'une face. */
function veins(p: Painter, f: Face, n: number, seed: number) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < n; k++) {
    let x = (f.u + rnd() * f.w) * S, y = (f.v + rnd() * f.h) * S;
    let a = rnd() * Math.PI * 2;
    const len = 20 + rnd() * 45;
    for (let i = 0; i < len; i++) {
      a += (rnd() - 0.5) * 0.7;
      x += Math.cos(a);
      y += Math.sin(a);
      if (x < f.u * S || y < f.v * S || x >= (f.u + f.w) * S || y >= (f.v + f.h) * S) break;
      const c = p.get(x | 0, y | 0);
      p.set(x | 0, y | 0, mix(c, [52, 46, 78], 0.55));
      if (i % 9 === 0 && rnd() < 0.5) {
        let bx = x, by = y, ba = a + (rnd() < 0.5 ? 0.8 : -0.8);
        for (let j = 0; j < 10; j++) {
          bx += Math.cos(ba);
          by += Math.sin(ba);
          if (bx < f.u * S || by < f.v * S || bx >= (f.u + f.w) * S || by >= (f.v + f.h) * S) break;
          const cc = p.get(bx | 0, by | 0);
          p.set(bx | 0, by | 0, mix(cc, [60, 52, 84], 0.4));
        }
      }
    }
  }
}

/** Plaie à vif (chair rouge, bords déchirés plus sombres). */
function wound(p: Painter, cx: number, cy: number, rx: number, ry: number, seed: number) {
  for (let y = Math.floor(cy - ry * 1.5); y < cy + ry * 1.5; y++)
    for (let x = Math.floor(cx - rx * 1.5); x < cx + rx * 1.5; x++) {
      if (!p.alpha(x, y)) continue;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (fbm(x / 5, y / 5, seed) - 0.5) * 0.8;
      if (d < 0.8) p.set(x, y, flesh(x, y));
      else if (d < 1.05) p.set(x, y, mix(p.get(x, y), [58, 24, 22], 0.75));
      else if (d < 1.3) p.set(x, y, mix(p.get(x, y), [120, 70, 60], 0.3));
    }
}

function ellipse(p: Painter, cx: number, cy: number, rx: number, ry: number, fn: (d: number, x: number, y: number) => RGB | null) {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (d <= 1) {
        const c = fn(d, x, y);
        if (c) p.set(x, y, c);
      }
    }
}

/** Visage (face avant de la tête : 8×8 texels en (8, 8)). */
function face(p: Painter) {
  const X = 8 * S, Y = 8 * S;
  const at = (tx: number, ty: number): [number, number] => [X + tx * S, Y + ty * S];
  // arcade sourcilière et front plissé
  for (let y = Y + 2.6 * S; y < Y + 3.6 * S; y++)
    for (let x = X; x < X + 8 * S; x++) {
      const k = 0.62 + 0.3 * smooth(Y + 2.6 * S, Y + 3.6 * S, y);
      const c = p.get(x, y);
      p.set(x, y, [c[0] * k, c[1] * k, c[2] * k]);
    }
  for (let i = 0; i < 3; i++) {
    const y0 = Y + (0.9 + i * 0.5) * S;
    for (let x = X + 1.5 * S; x < X + 6.5 * S; x++) {
      const y = Math.round(y0 + Math.sin(x / 7 + i) * 2);
      p.set(x, y, mix(p.get(x, y), [50, 64, 40], 0.5));
    }
  }
  // orbites profondes (creux sombres) et petits yeux laiteux, sans éclat
  for (const [ex, droop] of [[2.35, 0], [5.65, 0.2]] as const) {
    const [cx, cy] = at(ex, 4.3 + droop);
    ellipse(p, cx, cy, 1.45 * S, 1.15 * S, (d, x, y) => mix(p.get(x, y), [20, 16, 18], 0.92 * (1 - smooth(0.35, 1, d))));
    ellipse(p, cx, cy + 0.15 * S, 0.62 * S, 0.4 * S, (d, x, y) => {
      let c: RGB = mix([176, 172, 146], [120, 114, 92], smooth(0.2, 1, d));
      if (hash(x, y, 61) < 0.18 && d > 0.5) c = mix(c, [140, 50, 46], 0.7);
      const ix = cx + (ex < 4 ? 0.9 : -0.6), di = Math.hypot(x + 0.5 - ix, y + 0.5 - (cy + 0.15 * S));
      if (di < 2.4) c = mix([120, 126, 128], c, di / 2.4); // iris voilé
      if (di < 0.9) c = [40, 38, 40];
      return mix(c, [20, 16, 18], smooth(0.75, 1, d) * 0.6); // paupière qui ombre le bord
    });
    // reflet humide minuscule
    p.set((cx - 2) | 0, (cy - 1) | 0, [210, 208, 196]);
    // poches et cernes sous l'œil
    for (let y = cy + 0.9 * S; y < cy + 1.6 * S; y++)
      for (let x = cx - 1.2 * S; x < cx + 1.2 * S; x++) p.set(x | 0, y | 0, mix(p.get(x | 0, y | 0), [64, 56, 66], 0.35 * (1 - Math.abs(x - cx) / (1.2 * S))));
  }
  // pommettes saillantes et joues creusées
  for (const sx of [1.1, 6.9]) {
    const [cx, cy] = at(sx, 5.9);
    ellipse(p, cx, cy, 1.0 * S, 1.4 * S, (d, x, y) => mix(p.get(x, y), [46, 52, 40], 0.45 * (1 - d)));
  }
  // nez rongé : cavité et narines
  {
    const [nx, ny] = at(4, 5.4);
    ellipse(p, nx, ny, 1.0 * S, 0.7 * S, (d, x, y) => mix(p.get(x, y), [60, 40, 38], 0.5 * (1 - d)));
    for (const dx of [-0.38, 0.38]) ellipse(p, nx + dx * S, ny + 0.2 * S, 0.24 * S, 0.3 * S, () => [20, 10, 10]);
    for (let y = Y + 3.8 * S; y < ny - 2; y++) p.set(nx | 0, y, mix(p.get(nx | 0, y), [150, 160, 116], 0.35));
  }
  // bouche ouverte : mâchoire tombante, dents cassées, gencives
  {
    const [mx, my] = at(4, 6.85);
    ellipse(p, mx, my, 2.25 * S, 1.05 * S, (d, x, y) => mix(p.get(x, y), [70, 34, 32], 0.7 * (1 - smooth(0.6, 1, d)))); // lèvres rongées
    ellipse(p, mx, my, 1.9 * S, 0.75 * S, (d) => mix([40, 10, 12], [10, 3, 4], 1 - d));
    for (let i = 0; i < 7; i++) {
      if (i === 2 || i === 5) continue; // dents manquantes
      const tx = mx - 1.55 * S + i * 0.45 * S;
      const h = (0.28 + hash(i, 1, 71) * 0.18) * S;
      for (let y = my - 0.6 * S; y < my - 0.6 * S + h; y++)
        for (let x = tx; x < tx + 0.36 * S; x++) p.set(x | 0, y | 0, mix([178, 160, 110], [110, 88, 52], (y - (my - 0.6 * S)) / h));
    }
    for (let i = 0; i < 6; i++) {
      if (i === 1) continue;
      const tx = mx - 1.3 * S + i * 0.5 * S;
      const h = (0.22 + hash(i, 2, 72) * 0.16) * S;
      for (let y = my + 0.62 * S - h; y < my + 0.62 * S; y++)
        for (let x = tx; x < tx + 0.36 * S; x++) p.set(x | 0, y | 0, mix([168, 150, 100], [100, 80, 46], 1 - (y - (my + 0.62 * S - h)) / h));
    }
    for (let x = mx - 1.7 * S; x < mx + 1.7 * S; x++) {
      const y = Math.round(my - 0.68 * S);
      p.set(x | 0, y, [110, 30, 34]);
    }
    blood(p, mx + 1.3 * S, my + 0.8 * S, 0.35 * S, 73, 1.4 * S);
    blood(p, mx - 0.9 * S, my + 0.7 * S, 0.25 * S, 74, 0.9 * S);
  }
  // joue arrachée
  wound(p, X + 6.6 * S, Y + 5.9 * S, 0.75 * S, 0.6 * S, 75);
  // cicatrice sur le front
  for (let i = 0; i < 2.4 * S; i++) {
    const x = X + 1.2 * S + i, y = Y + 1.5 * S + i * 0.45;
    p.set(x | 0, y | 0, mix(p.get(x | 0, y | 0), [84, 48, 44], 0.6));
    p.set(x | 0, (y + 1) | 0, mix(p.get(x | 0, (y + 1) | 0), [150, 140, 110], 0.3));
  }
}

/** Mains au bas des bras : doigts, ongles sales. */
function hands(p: Painter, f: Face) {
  const y0 = (f.v + f.h - 3) * S;
  for (let py = y0; py < (f.v + f.h) * S; py++)
    for (let px = f.u * S; px < (f.u + f.w) * S; px++) {
      const lx = (px - f.u * S) / S;
      const c = p.get(px, py);
      let k = 0.9;
      if (Math.abs((lx * 4) % 4 - 2) < 0.12 && py > y0 + S) k = 0.6; // séparation des doigts
      if (py > (f.v + f.h) * S - 0.5 * S) k = 0.5; // ongles crasseux
      p.set(px, py, mix([c[0] * k, c[1] * k, c[2] * k], [70, 56, 40], py > (f.v + f.h) * S - 0.5 * S ? 0.5 : 0.1));
    }
}

/** Trous dans le tissu laissant voir la peau (côtes sur le torse). */
function holes(p: Painter, f: Face, n: number, seed: number, ribs = false) {
  for (let k = 0; k < n; k++) {
    const cx = (f.u + 0.8 + hash(k, seed, 81) * (f.w - 1.6)) * S, cy = (f.v + 2 + hash(k, seed, 82) * (f.h - 4)) * S;
    const r = (0.7 + hash(k, seed, 83) * 0.9) * S;
    for (let y = Math.floor(cy - r * 1.4); y < cy + r * 1.4; y++)
      for (let x = Math.floor(cx - r * 1.4); x < cx + r * 1.4; x++) {
        if (x < f.u * S || y < f.v * S || x >= (f.u + f.w) * S || y >= (f.v + f.h) * S) continue;
        const d = Math.hypot((x - cx) / r, (y - cy) / (r * 0.8)) + (fbm(x / 4, y / 4, seed + k) - 0.5) * 0.9;
        if (d < 0.85) {
          let c = skin(x, y);
          if (ribs && Math.abs(((y - f.v * S) / (S * 1.3)) % 1 - 0.5) < 0.1) c = mix(c, [40, 50, 34], 0.6);
          c = mix(c, [24, 20, 18], 0.45 * (1 - d));
          c = mix(c, [70, 40, 36], 0.3);
          p.set(x, y, c);
        } else if (d < 1.05) p.set(x, y, mix(p.get(x, y), [150, 156, 140], 0.3)); // fils effilochés
      }
  }
}

/** Ourlet déchiré (bord inférieur en dents de scie) : rend transparent sous la ligne. */
function raggedHem(p: Painter, f: Face, fromBottom: number, seed: number) {
  for (let px = f.u * S; px < (f.u + f.w) * S; px++) {
    const cut = (f.v + f.h) * S - fromBottom * S + Math.floor(fbm(px / 5, 0, seed) * 2.6 * S - S * 0.6);
    for (let py = cut; py < (f.v + f.h) * S; py++) p.set(px, py, [0, 0, 0], 0);
  }
}

/** Peint la skin du zombie réaliste (512×512). */
export function paintRealisticZombie(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, W);
  const p = new Painter(img);

  // --- tête (0, 0) : peau, crâne dégarni, visage
  const head = boxFaces(0, 0, 8, 8, 8);
  for (const f of head) p.face(f, (_lx, _ly, px, py) => skin(px, py));
  p.face(head[0], (lx, ly, px, py) => (fbm(px / 7, py / 7, 91) > 0.48 || ly < 1 ? hairCol(px, py) : mix(skin(px, py), [150, 120, 100], 0.2)));
  for (const f of [head[2], head[4], head[5]])
    p.face(f, (lx, ly, px, py) => (ly < 2.2 + fbm(px / 8, 0, 92) * 1.6 && fbm(px / 6, py / 6, 93) > 0.42 ? hairCol(px, py) : null));
  // oreilles (côtés)
  for (const f of [head[2], head[4]]) {
    ellipse(p, (f.u + 4) * S, (f.v + 4.5) * S, 0.9 * S, 1.4 * S, (d, x, y) => mix(p.get(x, y), [62, 74, 50], 0.5 * (1 - d)));
    ellipse(p, (f.u + 4) * S, (f.v + 4.5) * S, 0.35 * S, 0.6 * S, () => [36, 34, 30]);
  }
  veins(p, head[2], 3, 101);
  veins(p, head[4], 3, 102);
  veins(p, head[5], 4, 103);
  wound(p, (head[5].u + 5) * S, (head[5].v + 5.2) * S, 0.8 * S, 0.6 * S, 104);
  face(p);
  veins(p, { u: 8, v: 8, w: 8, h: 3, kind: 'front' }, 2, 105);
  const skinH = (x: number, y: number) => fbm(x / 9, y / 9, 7, 3) * 0.6 + fbm(x / 3, y / 3, 8, 2) * 0.4;
  for (const f of head) p.emboss(f, skinH, 0.9);
  for (const f of head) p.shade(f);

  // --- torse (16, 16) : chemise en lambeaux
  const body = boxFaces(16, 16, 8, 12, 4);
  for (const f of body) p.face(f, (_lx, _ly, px, py) => shirt(px, py));
  // col en V ouvert sur la peau
  p.face(body[3], (lx, ly, px, py) => (ly < 3.2 - Math.abs(lx - 4) * 0.9 ? skin(px, py) : null));
  holes(p, body[3], 3, 111, true);
  holes(p, body[5], 2, 112);
  holes(p, body[2], 1, 113);
  holes(p, body[4], 1, 114);
  blood(p, (body[3].u + 5.5) * S, (body[3].v + 4) * S, 1.3 * S, 115, 3 * S);
  blood(p, (body[3].u + 2) * S, (body[3].v + 1.5) * S, 0.7 * S, 116, 2 * S);
  blood(p, (body[5].u + 3) * S, (body[5].v + 7) * S, 1.1 * S, 117, 2 * S);
  const clothH = (x: number, y: number) => fbm(x / 14, y / 22, 118, 3) * 0.8 + ((x + y) % 2) * 0.1;
  for (const f of body) p.emboss(f, clothH, 1.1);
  for (const f of body) p.shade(f);

  // --- bras (peau nue, restes de manches) : droit (40, 16), gauche (32, 48)
  for (const [u, v, seed] of [[40, 16, 120], [32, 48, 130]] as const) {
    const arm = boxFaces(u, v, 4, 12, 4);
    for (const f of arm) p.face(f, (_lx, ly, px, py) => (ly < 2.2 + fbm(px / 5, 0, seed) * 1.2 && f.kind !== 'bottom' ? shirt(px, py) : skin(px, py)));
    for (const f of arm.slice(2)) {
      veins(p, f, 2, seed + f.u);
      hands(p, f);
    }
    wound(p, (arm[3].u + 2) * S, (arm[3].v + 6.5) * S, 0.8 * S, 1.2 * S, seed + 1);
    blood(p, (arm[5].u + 2) * S, (arm[5].v + 8) * S, 0.6 * S, seed + 2, 2 * S);
    for (const f of arm) p.emboss(f, (x, y) => fbm(x / 9, y / 9, seed, 3) * 0.6 + fbm(x / 3, y / 3, seed + 1, 2) * 0.4, 0.9);
    for (const f of arm) p.shade(f);
  }

  // --- jambes (jean usé, genoux déchirés, chaussures) : droite (0, 16), gauche (16, 48)
  for (const [u, v, seed] of [[0, 16, 140], [16, 48, 150]] as const) {
    const leg = boxFaces(u, v, 4, 12, 4);
    for (const f of leg)
      p.face(f, (_lx, ly, px, py) => {
        if (f.kind === 'bottom' || ly > 10.4 + fbm(px / 6, 0, seed) * 0.6) return leather(px, py);
        let col = denim(px, py);
        col = mix(col, [70, 58, 40], smooth(7.5, 10.5, ly) * 0.55 * fbm(px / 8, py / 8, seed)); // boue
        return col;
      });
    // genou déchiré
    const kx = (leg[3].u + 2) * S, ky = (leg[3].v + 5.6) * S;
    for (let y = ky - 1.4 * S; y < ky + 1.4 * S; y++)
      for (let x = kx - 1.8 * S; x < kx + 1.8 * S; x++) {
        const d = Math.hypot((x - kx) / (1.6 * S), (y - ky) / (1.1 * S)) + (fbm(x / 4, y / 4, seed + 3) - 0.5) * 0.8;
        if (d < 0.8) p.set(x, y, Math.abs(y - ky) < 2 + Math.sin(x) * 2 ? [214, 214, 220] : mix(skin(x, y), flesh(x, y), 0.35));
        else if (d < 1) p.set(x, y, [190, 196, 210]);
      }
    // couture latérale
    for (const f of [leg[2], leg[4]]) for (let y = f.v * S; y < (f.v + 10) * S; y++) p.set((f.u + 2) * S, y, [120, 104, 70]);
    for (const f of leg) p.emboss(f, (x, y) => fbm(x / 16, y / 26, seed + 9, 3), 1.2);
    for (const f of leg) p.shade(f);
  }

  // --- couches extérieures : cheveux clairsemés, lambeaux de chemise, manches déchirées
  const hat = boxFaces(32, 0, 8, 8, 8);
  for (const f of hat)
    p.face(f, (_lx, ly, px, py) => {
      if (f.kind === 'bottom' || f.kind === 'front') return null;
      const lim = f.kind === 'top' ? 8 : 2.6 + fbm(px / 6, 0, 161) * 2.2;
      return ly < lim && fbm(px / 5, py / 5, 162) > 0.55 ? hairCol(px, py) : null;
    });
  const jacket = boxFaces(16, 32, 8, 12, 4);
  for (const f of jacket.slice(2)) {
    p.face(f, (_lx, ly, px, py) => (ly > 8.5 ? mix(shirt(px, py), [60, 52, 40], 0.25) : null));
    raggedHem(p, f, 0.6, 170 + f.u);
    blood(p, (f.u + f.w / 2) * S, (f.v + 10) * S, 0.6 * S, 171 + f.u, S);
    p.shade(f, 0.6);
  }
  for (const [u, v] of [[40, 32], [48, 48]] as const) {
    const sl = boxFaces(u, v, 4, 12, 4);
    for (const f of sl.slice(2)) {
      p.face(f, (_lx, ly, px, py) => (ly < 2.8 ? shirt(px, py) : null));
      for (let px = f.u * S; px < (f.u + f.w) * S; px++) {
        const cut = (f.v + 1.6) * S + Math.floor(fbm(px / 4, 0, 180 + u) * 1.6 * S);
        for (let py = cut; py < (f.v + 3) * S; py++) p.set(px, py, [0, 0, 0], 0);
      }
      p.shade(f, 0.6);
    }
  }

  ctx.putImageData(img, 0, 0);
  return c;
}
