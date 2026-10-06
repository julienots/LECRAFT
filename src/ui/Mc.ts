/**
 * Widgets des menus dans le style des jeux de blocs : boutons pierre, curseurs à libellé intégré,
 * boutons cycliques (« Difficulté : Normale »), champs de texte, écrans à titre centré.
 * Les dimensions sont exprimées en pixels d'interface (multipliés par --gs).
 */
import type { Screen } from './UIManager';
import { el } from './dom';

let clickSound: (() => void) | null = null;
/** Son joué par tous les widgets (branché par le jeu). */
export function setWidgetClick(fn: () => void) {
  clickSound = fn;
}

export function mcButton(label: string | Node, onClick: () => void, opts: { w?: number; disabled?: boolean; cls?: string } = {}): HTMLButtonElement {
  const b = el('button', { class: `mc-btn ${opts.cls ?? ''}`.trim(), type: 'button', style: `--w:${opts.w ?? 200}` });
  b.append(typeof label === 'string' ? el('span', {}, label) : label);
  b.disabled = !!opts.disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    clickSound?.();
    onClick();
  });
  return b;
}

export function setLabel(b: HTMLElement, text: string) {
  const span = b.querySelector('span');
  if (span) span.textContent = text;
}

/** Bouton qui fait défiler des valeurs : « Préfixe : Valeur ». */
export function mcCycle<T>(prefix: string, options: [T, string][], value: T, onChange: (v: T) => void, w = 150): HTMLButtonElement {
  let i = Math.max(0, options.findIndex(([v]) => v === value));
  const text = () => `${prefix} : ${options[i][1]}`;
  const b = mcButton(text(), () => {
    i = (i + 1) % options.length;
    setLabel(b, text());
    onChange(options[i][0]);
  }, { w });
  return b;
}

export function mcToggle(prefix: string, on: boolean, onChange: (v: boolean) => void, w = 150): HTMLButtonElement {
  return mcCycle<boolean>(prefix, [[true, 'OUI'], [false, 'NON']], on, onChange, w);
}

/** Curseur : la piste sombre porte le libellé, la poignée se déplace. */
export function mcSlider(label: (v: number) => string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, w = 150): HTMLElement {
  const handle = el('div', { class: 'mc-handle' });
  const text = el('span', {}, label(value));
  const s = el('div', { class: 'mc-slider', style: `--w:${w}`, role: 'slider', tabindex: '0' }, handle, text);
  const place = () => {
    const f = (value - min) / (max - min || 1);
    handle.style.left = `calc(${f} * (100% - var(--gs) * 8px))`;
  };
  place();
  const setFrom = (clientX: number) => {
    const r = s.getBoundingClientRect();
    const hw = r.height * 0.4;
    const f = Math.min(1, Math.max(0, (clientX - r.left - hw / 2) / (r.width - hw)));
    let v = min + f * (max - min);
    v = Math.round(v / step) * step;
    v = Math.min(max, Math.max(min, +v.toFixed(4)));
    if (v !== value) {
      value = v;
      text.textContent = label(v);
      place();
      onInput(v);
    }
  };
  let drag = false;
  s.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    drag = true;
    try {
      s.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur simulé (manette) */
    }
    s.classList.add('active');
    setFrom(e.clientX);
  });
  s.addEventListener('pointermove', (e) => drag && setFrom(e.clientX));
  const end = () => {
    if (drag) clickSound?.();
    drag = false;
    s.classList.remove('active');
  };
  s.addEventListener('pointerup', end);
  s.addEventListener('pointercancel', end);
  s.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const v = Math.min(max, Math.max(min, value + (e.key === 'ArrowLeft' ? -step : step)));
      value = +v.toFixed(4);
      text.textContent = label(value);
      place();
      onInput(value);
    }
  });
  return s;
}

export function mcInput(value: string, opts: { placeholder?: string; maxlength?: number; w?: number } = {}): HTMLInputElement {
  const i = el('input', { class: 'mc-input', type: 'text', value, maxlength: String(opts.maxlength ?? 32), style: `--w:${opts.w ?? 200}`, spellcheck: 'false', autocomplete: 'off' });
  if (opts.placeholder) i.placeholder = opts.placeholder;
  return i;
}

export function mcLabel(text: string, cls = ''): HTMLElement {
  return el('div', { class: `mc-label ${cls}`.trim() }, text);
}

/** Rangée de widgets centrée (espacement de 4 px d'interface entre colonnes). */
export function mcRow(...items: (HTMLElement | null | false)[]): HTMLElement {
  return el('div', { class: 'mc-row' }, ...items);
}

/** Grille d'options à deux colonnes (comme les écrans d'options). */
export function mcGrid(...items: HTMLElement[]): HTMLElement {
  return el('div', { class: 'mc-grid' }, ...items);
}

export type McBackground = 'panorama' | 'dirt' | 'dim' | 'death';

/**
 * Écran standard : titre centré en haut, contenu défilant au centre, boutons en bas.
 */
export function mcScreen(opts: { title: string; body: (HTMLElement | null)[]; footer?: HTMLElement[]; bg?: McBackground; onBack?: () => boolean; onClose?: () => void; list?: boolean }): Screen {
  const content = el('div', { class: `mc-body${opts.list ? ' mc-list-area' : ''}` }, ...opts.body);
  const root = el(
    'div',
    { class: `screen mc-screen bg-${opts.bg ?? 'dirt'}` },
    el('div', { class: 'mc-title' }, opts.title),
    content,
    opts.footer?.length ? el('div', { class: 'mc-footer' }, ...opts.footer) : null,
  );
  return { el: root, onBack: opts.onBack, onClose: opts.onClose };
}
