/**
 * Widgets des menus d'avant-partie (charte « édition mobile ») : bandeau, boutons biseautés, onglets,
 * sélecteurs, interrupteurs, champs, curseurs, fenêtres. Dimensions : voir bedrock.css (unité --u).
 */
import './bedrock.css';
import type { Game } from '../core/Game';
import type { Screen } from './UIManager';
import { el } from './dom';
import { t } from './i18n';
import { playWidgetClick } from './Mc';

export type Tone = 'gray' | 'green' | 'purple' | 'red' | 'dark' | 'darker' | 'play';

const ns = (html: string) => el('span', { html, style: 'display:contents' });

export const ICON_BACK = '<svg viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><polyline points="7,1 1.5,6 7,11"/></svg>';
export const ICON_SOCIAL =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="square"><circle cx="6" cy="5" r="2.4"/><path d="M1.5 14v-2.2c0-1.9 1.6-3 4.5-3s4.5 1.1 4.5 3V14"/><circle cx="11.6" cy="4.4" r="2"/><path d="M11 8.4c2.2 0 3.6 0.9 3.6 2.7V13"/></svg>';
export const ICON_PENCIL =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"><path d="M2.5 13.5l.6-3.1 7.6-7.6 2.5 2.5-7.6 7.6z"/><path d="M9.4 4.2l2.5 2.5"/></svg>';
export const ICON_CLOSE = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M2 2l8 8M10 2l-8 8"/></svg>';
export const ICON_CHEVRON = '<svg viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><polyline points="1.5,1.5 6,6 10.5,1.5"/></svg>';
export const ICON_GRID = '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="3" height="3"/><rect x="7" y="2" width="3" height="3"/><rect x="2" y="7" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/></svg>';

/** Bouton biseauté. `label` : texte (traduit) ou nœuds. */
export function bmBtn(label: string | Node | (string | Node)[], onClick: (e: MouseEvent) => void, o: { tone?: Tone; cls?: string; w?: number; h?: number; disabled?: boolean; icon?: string } = {}): HTMLButtonElement {
  const b = el('button', { class: `bm-btn bm-t-${o.tone ?? 'gray'} ${o.cls ?? ''}`.trim(), type: 'button' });
  if (o.w) b.style.width = `calc(var(--u) * ${o.w} * 1px)`;
  if (o.h) b.style.minHeight = `calc(var(--u) * ${o.h} * 1px)`;
  if (o.icon) b.append(el('img', { class: 'ic', src: o.icon, alt: '' }));
  const parts = Array.isArray(label) ? label : [label];
  // les nœuds (icônes) restent des enfants directs du bouton, le texte va dans un <span>
  const nodes = parts.filter((p): p is Node => typeof p !== 'string');
  const texts = parts.filter((p): p is string => typeof p === 'string');
  if (!Array.isArray(label) && nodes.length) b.append(el('span', {}, ...nodes));
  else {
    for (const n of nodes) b.append(n);
    if (texts.length) b.append(el('span', {}, ...texts.map((x) => t(x))));
  }
  b.disabled = !!o.disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    playWidgetClick();
    onClick(e);
  });
  return b;
}

export function setBtnLabel(b: HTMLElement, text: string) {
  const span = b.querySelector('span');
  if (span) span.textContent = t(text);
}

/** Bandeau clair : retour, titre centré, bouton Social. */
export function bmHeader(game: Game, title: string, onBack: (() => void) | null, social = true, small = false): HTMLElement {
  const head = el('div', { class: 'bm-head' });
  if (onBack) {
    const back = el('button', { class: 'bm-back', type: 'button', 'aria-label': 'Retour' }, ns(ICON_BACK));
    back.addEventListener('click', (e) => {
      e.stopPropagation();
      playWidgetClick();
      onBack();
    });
    head.append(back);
  }
  head.append(el('div', { class: `bm-title${small ? ' small' : ''}` }, t(title)));
  if (social) {
    const s = el('button', { class: 'bm-social', type: 'button' }, ns(ICON_SOCIAL), el('span', {}, t('Social') + ' (0)'));
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      playWidgetClick();
      void import('./BedrockMenus').then((m) => game.ui.push(m.socialScreen(game)));
    });
    head.append(s);
  }
  return head;
}

interface ScreenOpts {
  cls?: string;
  title?: string;
  /** Flèche de retour (par défaut : revient à l'écran précédent). */
  back?: (() => void) | null;
  social?: boolean;
  /** Voile sombre sur le panorama (écrans sur fond de décor). */
  dim?: boolean;
  solid?: boolean;
  body: (Node | null)[];
  onBack?: () => boolean;
  onClose?: () => void;
}

/** Écran standard : bandeau en haut, contenu en dessous. */
export function bmScreen(game: Game, o: ScreenOpts): Screen & { root: HTMLElement } {
  const root = el('div', { class: `screen mc-screen bm-screen ${o.cls ?? ''}${o.dim ? ' bm-dim' : ''}${o.solid ? ' bm-solid' : ''}`.trim() });
  const back = o.back === undefined ? () => game.ui.back() : o.back;
  if (o.title !== undefined) root.append(bmHeader(game, o.title, back, o.social !== false));
  for (const n of o.body) if (n) root.append(n);
  return {
    root,
    el: root,
    onBack: () => {
      const m = modalsOf(root);
      if (m.length) {
        m[m.length - 1].close();
        return true;
      }
      return o.onBack ? o.onBack() : false;
    },
    onClose: o.onClose,
  };
}

// ---------- fenêtres ----------
interface ModalHandle {
  close(): void;
}
const MODALS = new WeakMap<HTMLElement, ModalHandle[]>();
const modalsOf = (root: HTMLElement) => MODALS.get(root) ?? [];

export interface ModalButton {
  label: string;
  tone?: Tone;
  onClick?: () => void | boolean;
}

/** Fenêtre au centre de l'écran (« Vraiment ? ») : titre, paragraphes, boutons empilés. */
export function bmModal(root: HTMLElement, o: { title: string; body: (string | Node)[]; buttons: ModalButton[]; onClose?: () => void }): ModalHandle {
  const modal = el('div', { class: 'bm-modal' });
  const handle: ModalHandle = {
    close() {
      modal.remove();
      const list = MODALS.get(root) ?? [];
      MODALS.set(root, list.filter((h) => h !== handle));
      o.onClose?.();
    },
  };
  const x = el('button', { class: 'x', type: 'button', 'aria-label': 'Fermer' }, ns(ICON_CLOSE));
  x.addEventListener('click', () => handle.close());
  const dlg = el(
    'div',
    { class: 'bm-dialog', role: 'dialog' },
    el('div', { class: 'dh' }, t(o.title), x),
    el('div', { class: 'db' }, ...o.body.map((b) => (typeof b === 'string' ? el('p', {}, t(b)) : b))),
    el(
      'div',
      { class: 'df' },
      ...o.buttons.map((b) =>
        bmBtn(b.label, () => {
          if (b.onClick?.() !== false) handle.close();
        }, { tone: b.tone ?? 'gray' }),
      ),
    ),
  );
  modal.append(dlg);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) handle.close();
  });
  root.append(modal);
  MODALS.set(root, [...modalsOf(root), handle]);
  return handle;
}

// ---------- lignes de réglages ----------
export function bmRow(title: string, desc?: string, ...extra: Node[]): HTMLElement {
  return el('div', { class: 'bm-rw' }, el('div', { class: 't' }, t(title)), desc ? el('div', { class: 'd' }, t(desc)) : null, ...extra);
}

export function bmSection(title: string, desc?: string): HTMLElement[] {
  const out = [el('div', { class: 'bm-sec' }, t(title))];
  if (desc) out.push(el('div', { class: 'bm-secd' }, t(desc)));
  return out;
}

export interface ToggleRow {
  el: HTMLElement;
  get(): boolean;
  set(v: boolean): void;
  sw: HTMLButtonElement;
}

/** Ligne avec interrupteur à droite. */
export function bmToggle(title: string, desc: string | null, value: boolean, onChange: (v: boolean) => void, o: { disabled?: boolean; icon?: string } = {}): ToggleRow {
  let on = value;
  const sw = el('button', { class: `bm-sw${on ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(on) });
  if (o.icon) sw.append(el('img', { class: 'hc', src: o.icon, alt: '' }));
  sw.disabled = !!o.disabled;
  const row = el('div', { class: 'bm-rw tg' }, el('div', { class: 'tx' }, el('div', { class: 't' }, t(title)), desc ? el('div', { class: 'd' }, t(desc)) : null), sw);
  const apply = () => {
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
  };
  const flip = () => {
    if (sw.disabled) return;
    playWidgetClick();
    on = !on;
    apply();
    onChange(on);
  };
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    flip();
  });
  row.addEventListener('click', (e) => {
    if (e.target !== sw && !sw.contains(e.target as Node)) flip();
  });
  return {
    el: row,
    sw,
    get: () => on,
    set(v) {
      on = v;
      apply();
    },
  };
}

export interface SegRow<T> {
  el: HTMLElement;
  get(): T;
  set(v: T): void;
}

/** Sélecteur segmenté (un bouton par valeur, la valeur choisie en vert). */
export function bmSegment<T extends string | number>(title: string, options: [T, string][], value: T, onChange: (v: T) => void, desc?: (v: T) => string, opt: { icons?: Record<string, string>; hideTitle?: boolean } = {}): SegRow<T> {
  let cur = value;
  const d = el('div', { class: 'd' }, desc ? t(desc(cur)) : '');
  const seg = el('div', { class: `bm-seg${options.length === 2 ? ' two' : ''}` });
  const btns = options.map(([v, label]) => {
    const b = el('button', { type: 'button', class: v === cur ? 'on' : '' });
    if (opt.icons?.[String(v)]) b.append(ns(opt.icons[String(v)]));
    b.append(el('span', {}, t(label)));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (v === cur) return;
      playWidgetClick();
      set(v);
      onChange(v);
    });
    seg.append(b);
    return [v, b] as const;
  });
  const set = (v: T) => {
    cur = v;
    for (const [k, b] of btns) b.classList.toggle('on', k === v);
    if (desc) d.textContent = t(desc(v));
  };
  const row = el('div', { class: 'bm-rw' }, opt.hideTitle ? null : el('div', { class: 't' }, t(title)), seg, desc ? d : null);
  return { el: row, get: () => cur, set };
}

export function bmInput(value: string, o: { placeholder?: string; maxlength?: number; numeric?: boolean } = {}): HTMLInputElement {
  const i = el('input', { class: 'bm-input', type: 'text', value, maxlength: String(o.maxlength ?? 32), spellcheck: 'false', autocomplete: 'off' });
  if (o.placeholder) i.placeholder = t(o.placeholder);
  if (o.numeric) i.inputMode = 'numeric';
  i.addEventListener('pointerdown', (e) => e.stopPropagation());
  return i;
}

/** Curseur à graduation (valeur en pourcentage ou entière). */
export function bmSlider(min: number, max: number, step: number, value: number, onInput: (v: number) => void): { el: HTMLElement; set(v: number): void } {
  const fill = el('div', { class: 'fill' });
  const knob = el('div', { class: 'knob' });
  const rail = el('div', { class: 'rail' }, fill);
  const s = el('div', { class: 'bm-slide', role: 'slider', tabindex: '0' }, rail, knob);
  let v = value;
  const place = () => {
    const f = (v - min) / (max - min || 1);
    fill.style.width = `${f * 100}%`;
    knob.style.left = `${f * 100}%`;
  };
  place();
  const from = (x: number) => {
    const r = rail.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (x - r.left) / (r.width || 1)));
    const nv = Math.min(max, Math.max(min, Math.round((min + f * (max - min)) / step) * step));
    if (nv !== v) {
      v = nv;
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
      /* pointeur simulé */
    }
    from(e.clientX);
  });
  s.addEventListener('pointermove', (e) => drag && from(e.clientX));
  s.addEventListener('pointerup', () => (drag = false));
  s.addEventListener('pointercancel', () => (drag = false));
  s.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      v = Math.min(max, Math.max(min, v + (e.key === 'ArrowLeft' ? -step : step)));
      place();
      onInput(v);
    }
  });
  return {
    el: s,
    set(nv) {
      v = nv;
      place();
    },
  };
}

/** Barre de défilement fine, à droite d'un conteneur défilant. */
export function bmScrollbar(scroller: HTMLElement): HTMLElement {
  const bar = el('div', { class: 'bm-sbar' });
  const upd = () => {
    const h = scroller.clientHeight, sh = scroller.scrollHeight;
    if (sh <= h + 2) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = '';
    const th = Math.max(24, (h / sh) * h);
    bar.style.height = `${th}px`;
    bar.style.top = `${(scroller.scrollTop / (sh - h)) * (h - th)}px`;
  };
  scroller.addEventListener('scroll', upd, { passive: true });
  new ResizeObserver(upd).observe(scroller);
  new MutationObserver(upd).observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  requestAnimationFrame(upd);
  return bar;
}

/** Image d'un objet du jeu (icône 16×16 agrandie) : repli transparent si inconnue. */
export function itemIcon(game: Game, id: string): string {
  try {
    return game.textures.iconURL(id);
  } catch {
    return '';
  }
}
