/**
 * Interface de l'édition mobile (Bedrock) : échelle d'interface, pictogrammes en pixel art et
 * boutons gris du jeu original. Les dimensions CSS de ces écrans sont exprimées en « pixels
 * d'interface » multipliés par --bs (≈ hauteur de l'écran / 240 : 3 sur un écran de 720 px).
 */
import { el } from './dom';
import { tb } from './BedrockLang';

let clickSound: (() => void) | null = null;
/** Son joué par les boutons de ces écrans (branché par le jeu). */
export function setBedrockClick(fn: () => void) {
  clickSound = fn;
}

/**
 * Échelle de l'interface mobile : 3 en 1568 × 720. Arrondie vers le BAS par quarts (un arrondi
 * à l'entier supérieur agrandissait trop les écrans et coupait le bas des menus sur les téléphones
 * dont la hauteur utile n'est pas un multiple de 240).
 */
export function bedrockScale(): number {
  const h = Math.min(window.innerHeight, window.innerWidth > window.innerHeight ? window.innerHeight : window.innerHeight * 0.46);
  return Math.max(0.75, Math.floor((h / 240) * 4) / 4);
}

let started = false;
/** Publie --bs sur la page et le met à jour quand l'écran change de taille. */
export function initBedrockScale() {
  const apply = () => document.documentElement.style.setProperty('--bs', `${bedrockScale()}px`);
  apply();
  if (started) return;
  started = true;
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
}

/** Nombre de pixels d'écran d'une unité d'interface. */
export function bs(): number {
  return bedrockScale();
}

const cache = new Map<string, string>();

/**
 * Pictogramme en pixel art : chaque caractère d'une ligne est une couleur de `pal` (« . » =
 * transparent). Retourne une valeur CSS `url(...)` (SVG net, sans lissage).
 */
export function pixelIcon(name: string, rows: string[], pal: Record<string, string>): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  let body = '';
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      const col = pal[c];
      if (c !== '.' && col) body += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>`;
    }),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${body}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  cache.set(name, url);
  return url;
}

const R = '#c8392b';

/** Pictogrammes des petits boutons (menu de pause, tchat, réglages). */
const SHAPES: Record<string, { rows: string[]; pal: Record<string, string> }> = {
  // livre rouge (guide de démarrage)
  book: {
    rows: [
      '..kkkkkkkkkk..',
      '.kyyyyyyyyyyk.',
      'kyyrryyyyyyyyk',
      'kyyrryyyyyyyyk',
      'kyyrryykkkkyyk',
      'kyyrryyyyyyyyk',
      'kyyrrrykkkkyyk',
      'kyyyrryyyyyyyk',
      'kyyyyyykkkkyyk',
      'kyyyyyyyyyyyyk',
      '.kkkkkkkkkkkk.',
    ],
    pal: { k: '#2a2118', y: '#e8d5a0', r: R },
  },
  camera: {
    rows: [
      '....kkkk......',
      '.kkkkkkkkkkkk.',
      'kwwwwwwwwwwwwk',
      'kwwkkkkkkkkwwk',
      'kwkkdddddkkkwk',
      'kwkdddwwdddkwk',
      'kwkdddwwdddkwk',
      'kwkkdddddkkkwk',
      'kwwkkkkkkkkwwk',
      '.kkkkkkkkkkkk.',
    ],
    pal: { k: '#1d1d1d', w: '#8d8d8d', d: '#2f2f2f' },
  },
  gear: {
    rows: [
      '...bb..bb...',
      '..bbbbbbbb..',
      '.bbbwwwwbbb.',
      'bbbwwbbwwbbb',
      'bbwwbbbbwwbb',
      '.bwwbbbbwwb.',
      '.bwwbbbbwwb.',
      'bbwwbbbbwwbb',
      'bbbwwbbwwbbb',
      '.bbbwwwwbbb.',
      '..bbbbbbbb..',
      '...bb..bb...',
    ],
    pal: { b: '#3d6fd0', w: '#dfe6f7' },
  },
  keyboard: {
    rows: [
      'kkkkkkkkkkkkkkkk',
      'kwkwkwkwkwkwkwkk',
      'kkkkkkkkkkkkkkkk',
      'kwkwkwkwkwkwkwkk',
      'kkkkkkkkkkkkkkkk',
      'kwkwwwwwwwwkwkwk',
      'kkkkkkkkkkkkkkkk',
    ],
    pal: { k: '#7a7a7a', w: '#4a4a4a' },
  },
  send: {
    rows: [
      '.kkkkkkkkkkkkkkkk.',
      'kwwwwwwwwwwwwwwwwk',
      'kwwwwwwwwwkwwwwwwk',
      'kwwwwwwwwwwkwwwwwk',
      'kwwkkkkkkkkkkkwwwk',
      'kwwwwwwwwwwkwwwwwk',
      'kwwwwwwwwwkwwwwwwk',
      'kwwwwwwwwwwwwwwwwk',
      '.kkkkkwwkkkkkkkkk.',
      '.....kwk..........',
      '......k...........',
    ],
    pal: { k: '#5a5a5a', w: '#f0f0f0' },
  },
  social: {
    rows: [
      '....kkkk.......',
      '...k....k......',
      '...k....k......',
      '....kkkk.......',
      '.kkkk..kkkk....',
      'k.....k....k...',
      'k....k.....k...',
      'k....k.....k...',
      'k....k.....k...',
    ],
    pal: { k: '#6d6d6d' },
  },
  help: {
    rows: ['.kkkk.', 'k....k', '....k.', '...k..', '...k..', '......', '...k..'],
    pal: { k: '#4a4a4a' },
  },
  chevron: {
    rows: ['k...', 'kk..', 'kkk.', 'kkkk', 'kkk.', 'kk..', 'k...'],
    pal: { k: '#ffffff' },
  },
  chevron_dark: {
    rows: ['k...', 'kk..', 'kkk.', 'kkkk', 'kkk.', 'kk..', 'k...'],
    pal: { k: '#3a3a3a' },
  },
  back: {
    rows: ['...k', '..k.', '.k..', 'k...', '.k..', '..k.', '...k'],
    pal: { k: '#2b2b2b' },
  },
  back_light: {
    rows: ['...k', '..k.', '.k..', 'k...', '.k..', '..k.', '...k'],
    pal: { k: '#c8c8c8' },
  },
  down: {
    rows: ['k.....k', '.k...k.', '..k.k..', '...k...'],
    pal: { k: '#1b1b1b' },
  },
  check: {
    rows: ['......k', '.....k.', 'k...k..', '.k.k...', '..k....'],
    pal: { k: '#ffffff' },
  },
  info: {
    rows: [
      '.kkkkkkk.',
      'k.......k',
      'k...k...k',
      'k.......k',
      'k...k...k',
      'k...k...k',
      'k...k...k',
      '.kkkkkkk.',
    ],
    pal: { k: '#e0c060' },
  },
  search: {
    rows: ['..kkk...', '.k...k..', 'k.....k.', 'k.....k.', 'k.....k.', '.k...k..', '..kkkkk.', '......kk'],
    pal: { k: '#c8c8c8' },
  },
  sun: {
    rows: [
      '....y....',
      '.y..y..y.',
      '..yyyyy..',
      '.yyyyyyy.',
      'yyyyyyyyy',
      '.yyyyyyy.',
      '..yyyyy..',
      '.y..y..y.',
      '....y....',
    ],
    pal: { y: '#fff3b0' },
  },
};

/** Pictogramme nommé (valeur CSS `url(...)`). */
export function bhIcon(name: string): string {
  const s = SHAPES[name];
  if (!s) throw new Error(`pictogramme inconnu : ${name}`);
  return pixelIcon(`bh:${name}`, s.rows, s.pal);
}

/** Élément <i> portant un pictogramme (taille en unités d'interface par défaut = taille du dessin). */
export function bhIconEl(name: string, cls = ''): HTMLElement {
  const s = SHAPES[name];
  const i = el('i', { class: `bh-ico ${cls}`.trim() });
  i.style.backgroundImage = bhIcon(name);
  i.style.setProperty('--iw', String(Math.max(...s.rows.map((r) => r.length))));
  i.style.setProperty('--ih', String(s.rows.length));
  return i;
}

export interface BhButtonOpts {
  /** Largeur en unités d'interface (par défaut : toute la largeur du conteneur). */
  w?: number;
  /** Hauteur en unités d'interface. */
  h?: number;
  cls?: string;
  disabled?: boolean;
  /** Chevron « > » à droite (sous-liste). */
  chevron?: boolean;
  /** Chevron « < » à gauche (retour d'une sous-liste). */
  back?: boolean;
  icon?: string;
}

/** Bouton gris du jeu original (bord noir, reflet clair en haut, ombre en bas ; vert quand survolé). */
export function bhButton(label: string | Node, onClick: () => void, o: BhButtonOpts = {}): HTMLButtonElement {
  const b = el('button', { class: `bh-btn ${o.cls ?? ''}`.trim(), type: 'button' });
  if (o.w) b.style.width = `calc(var(--bs) * ${o.w})`;
  if (o.h) b.style.height = `calc(var(--bs) * ${o.h})`;
  if (o.back) b.append(el('i', { class: 'bh-chev back' }));
  if (o.icon) b.append(bhIconEl(o.icon));
  b.append(el('span', { class: 'bh-lbl' }, typeof label === 'string' ? tb(label) : label));
  if (o.chevron) b.append(el('i', { class: 'bh-chev' }));
  b.disabled = !!o.disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    clickSound?.();
    onClick();
  });
  return b;
}

export function bhSetLabel(b: HTMLElement, text: string) {
  const s = b.querySelector('.bh-lbl');
  if (s) s.textContent = text;
}

/** Interrupteur de l'édition mobile (gris, vert quand activé). */
export function bhToggle(on: boolean, onChange: (v: boolean) => void, disabled = false): HTMLElement {
  const t = el('div', { class: `bh-toggle${on ? ' on' : ''}${disabled ? ' off' : ''}`, role: 'switch', tabindex: '0', 'aria-checked': String(on) }, el('i', {}));
  const flip = () => {
    if (disabled) return;
    on = !on;
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', String(on));
    clickSound?.();
    onChange(on);
  };
  t.addEventListener('click', flip);
  t.addEventListener('keydown', (e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), flip()));
  return t;
}

/** Curseur : piste grise, partie remplie verte, poignée claire. `fmt` donne la valeur affichée au-dessus. */
export function bhSlider(min: number, max: number, step: number, value: number, onInput: (v: number) => void, onValue?: (v: number) => void, disabled = false): HTMLElement {
  const fill = el('div', { class: 'bh-fill' });
  const handle = el('div', { class: 'bh-handle' });
  const s = el('div', { class: `bh-slider${disabled ? ' off' : ''}`, role: 'slider', tabindex: '0', 'aria-valuemin': String(min), 'aria-valuemax': String(max) }, fill, handle);
  const place = () => {
    const f = (value - min) / (max - min);
    fill.style.width = `${f * 100}%`;
    handle.style.left = `${f * 100}%`;
    s.setAttribute('aria-valuenow', String(value));
    onValue?.(value);
  };
  const set = (v: number, fire = true) => {
    v = Math.min(max, Math.max(min, +(Math.round(v / step) * step).toFixed(4)));
    if (v === value) return;
    value = v;
    place();
    if (fire) onInput(v);
  };
  const from = (clientX: number) => {
    const r = s.getBoundingClientRect();
    set(min + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (max - min));
  };
  let drag = false;
  s.addEventListener('pointerdown', (e) => {
    if (disabled) return;
    e.stopPropagation();
    drag = true;
    try {
      s.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur simulé */
    }
    from(e.clientX);
  });
  s.addEventListener('pointermove', (e) => drag && from(e.clientX));
  const end = () => {
    if (drag) clickSound?.();
    drag = false;
  };
  s.addEventListener('pointerup', end);
  s.addEventListener('pointercancel', end);
  s.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') (e.preventDefault(), set(value - step));
    else if (e.key === 'ArrowRight') (e.preventDefault(), set(value + step));
  });
  place();
  return s;
}

/** Boutons côte à côte dont un seul est choisi (difficulté) : le choisi est vert. */
export function bhSegments<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void, disabled = false): HTMLElement {
  const wrap = el('div', { class: 'bh-seg' });
  const btns = options.map(([v, label]) => {
    const b = el('button', { class: `bh-segb${v === value ? ' on' : ''}`, type: 'button' }, tb(label));
    b.disabled = disabled;
    b.addEventListener('click', () => {
      value = v;
      btns.forEach((x, i) => x.classList.toggle('on', options[i][0] === v));
      clickSound?.();
      onChange(v);
    });
    return b;
  });
  wrap.append(...btns);
  return wrap;
}

/** Liste déroulante : boîte claire à chevron ; ouvre une fenêtre de choix avec coche sur la valeur actuelle. */
export function bhSelect<T extends string | number>(title: string, options: [T, string][], value: T, onChange: (v: T) => void, host: HTMLElement, disabled = false): HTMLElement {
  const label = el('span', { class: 'bh-sel-lbl' }, tb(options.find(([v]) => v === value)?.[1] ?? ''));
  const box = el('button', { class: 'bh-select', type: 'button' }, label, bhIconEl('down'));
  box.disabled = disabled;
  box.addEventListener('click', () => {
    clickSound?.();
    const close = () => pop.remove();
    const rows = options.map(([v, text]) => {
      const r = el('button', { class: `bh-opt${v === value ? ' on' : ''}`, type: 'button' }, el('span', {}, tb(text)), v === value ? el('i', { class: 'bh-check' }) : null);
      r.addEventListener('click', () => {
        value = v;
        label.textContent = tb(text);
        clickSound?.();
        close();
        onChange(v);
      });
      return r;
    });
    const x = el('button', { class: 'bh-x', type: 'button', 'aria-label': 'Fermer' }, '×');
    x.addEventListener('click', close);
    const pop = el('div', { class: 'bh-popup' }, el('div', { class: 'bh-pop-box' }, el('div', { class: 'bh-pop-head' }, el('span', {}, tb(title)), x), ...rows));
    pop.addEventListener('pointerdown', (e) => {
      if (e.target === pop) close();
    });
    host.append(pop);
  });
  return box;
}
