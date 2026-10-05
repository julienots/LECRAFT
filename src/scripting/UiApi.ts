/**
 * Module « @minecraft/server-ui » : formulaires des scripts d'add-ons (ActionFormData,
 * ModalFormData, MessageFormData), affichés avec les widgets du jeu (boutons pierre, curseurs,
 * interrupteurs, champs de texte). Les textes acceptent les codes « § » et les textes bruts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { el } from '../ui/dom';
import { mcButton, mcInput, mcLabel, mcScreen, mcSlider, mcCycle } from '../ui/Mc';
import { mcNodes, setMcText } from '../ui/McText';
import { rawTextToString, LANG } from '../commands/Commands';
import type { Screen } from '../ui/UIManager';

type Any = any;

/** Services d'affichage fournis par l'hôte. */
export interface FormHost {
  /** Ouvre un écran ; retourne null si le joueur est occupé (autre écran ouvert). */
  open(build: (close: () => void) => Screen): boolean;
  closeAll(): void;
  /** URL d'une icône (texture d'add-on ou du jeu), ou null. */
  icon(path: string): string | null;
}

/** Texte d'un formulaire : chaîne (traduite si c'est une clé connue) ou texte brut. */
const txt = (t: Any): string => (t === undefined || t === null ? '' : typeof t === 'string' ? LANG.get(t) ?? t : rawTextToString(t));

function labelEl(text: string, cls = 'white'): HTMLElement {
  const l = mcLabel('', cls);
  setMcText(l, text);
  return l;
}

export function createUiApi(host: FormHost) {
  const FormCancelationReason = Object.freeze({ UserBusy: 'UserBusy', UserClosed: 'UserClosed' });
  const FormRejectReason = Object.freeze({ MalformedResponse: 'MalformedResponse', PlayerQuit: 'PlayerQuit', ServerShutdown: 'ServerShutdown' });
  class FormRejectError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }
  const busy = () => ({ canceled: true, cancelationReason: FormCancelationReason.UserBusy, selection: undefined, formValues: undefined });

  /** Habille un écran : titre formaté et fond assombri (le monde reste visible). */
  function finish(s: Screen, title: string): Screen {
    s.el.classList.add('script-form');
    const t = s.el.querySelector('.mc-title') as HTMLElement | null;
    if (t) setMcText(t, title);
    return s;
  }

  class ActionFormData {
    private _title = '';
    private _body = '';
    private items: ({ kind: 'button'; text: string; icon?: string } | { kind: 'label' | 'header'; text: string } | { kind: 'divider' })[] = [];
    title(t: Any) {
      this._title = txt(t);
      return this;
    }
    body(t: Any) {
      this._body = txt(t);
      return this;
    }
    button(t: Any, icon?: string) {
      this.items.push({ kind: 'button', text: txt(t), icon });
      return this;
    }
    label(t: Any) {
      this.items.push({ kind: 'label', text: txt(t) });
      return this;
    }
    header(t: Any) {
      this.items.push({ kind: 'header', text: txt(t) });
      return this;
    }
    divider() {
      this.items.push({ kind: 'divider' });
      return this;
    }
    show(_player: Any): Promise<Any> {
      return new Promise((resolve) => {
        let done = false;
        const ok = host.open((close) => {
          const finishWith = (r: Any) => {
            if (done) return;
            done = true;
            close();
            resolve(r);
          };
          const body: HTMLElement[] = [];
          if (this._body) body.push(labelEl(this._body, 'white form-body'));
          let idx = 0;
          for (const it of this.items) {
            if (it.kind === 'button') {
              const i = idx++;
              const content = el('span', { class: 'form-btn' });
              const url = it.icon ? host.icon(it.icon) : null;
              if (url) content.append(el('img', { class: 'form-icon', src: url, alt: '' }));
              const t = el('span', {});
              t.append(...mcNodes(it.text));
              content.append(t);
              body.push(mcButton(content, () => finishWith({ canceled: false, selection: i }), { w: 260 }));
            } else if (it.kind === 'divider') body.push(el('div', { class: 'form-divider' }));
            else body.push(labelEl(it.text, it.kind === 'header' ? 'yellow' : 'white'));
          }
          const s = mcScreen({
            title: this._title,
            body,
            footer: [mcButton('Fermer', () => finishWith({ canceled: true, cancelationReason: FormCancelationReason.UserClosed }), { w: 200 })],
            bg: 'dim',
            onBack: () => {
              finishWith({ canceled: true, cancelationReason: FormCancelationReason.UserClosed });
              return true;
            },
            onClose: () => finishWith({ canceled: true, cancelationReason: FormCancelationReason.UserClosed }),
          });
          return finish(s, this._title);
        });
        if (!ok) resolve(busy());
      });
    }
  }

  class MessageFormData {
    private _title = '';
    private _body = '';
    private b1 = '';
    private b2 = '';
    title(t: Any) {
      this._title = txt(t);
      return this;
    }
    body(t: Any) {
      this._body = txt(t);
      return this;
    }
    button1(t: Any) {
      this.b1 = txt(t);
      return this;
    }
    button2(t: Any) {
      this.b2 = txt(t);
      return this;
    }
    show(_player: Any): Promise<Any> {
      return new Promise((resolve) => {
        let done = false;
        const ok = host.open((close) => {
          const finishWith = (r: Any) => {
            if (done) return;
            done = true;
            close();
            resolve(r);
          };
          const btn = (t: string, sel: number) => {
            const span = el('span', {});
            span.append(...mcNodes(t));
            return mcButton(span, () => finishWith({ canceled: false, selection: sel }), { w: 200 });
          };
          const s = mcScreen({
            title: this._title,
            body: [labelEl(this._body, 'white form-body')],
            footer: [btn(this.b1 || 'OK', 0), ...(this.b2 ? [btn(this.b2, 1)] : [])],
            bg: 'dim',
            onBack: () => {
              finishWith({ canceled: true, cancelationReason: FormCancelationReason.UserClosed, selection: undefined });
              return true;
            },
            onClose: () => finishWith({ canceled: true, cancelationReason: FormCancelationReason.UserClosed, selection: undefined }),
          });
          return finish(s, this._title);
        });
        if (!ok) resolve(busy());
      });
    }
  }

  type Field =
    | { kind: 'text'; label: string; placeholder: string; value: string }
    | { kind: 'toggle'; label: string; value: boolean }
    | { kind: 'slider'; label: string; min: number; max: number; step: number; value: number }
    | { kind: 'dropdown'; label: string; options: string[]; value: number }
    | { kind: 'label' | 'header'; label: string }
    | { kind: 'divider' };

  class ModalFormData {
    private _title = '';
    private _submit = 'Valider';
    private fields: Field[] = [];
    title(t: Any) {
      this._title = txt(t);
      return this;
    }
    submitButton(t: Any) {
      this._submit = txt(t);
      return this;
    }
    textField(label: Any, placeholder: Any, def?: Any) {
      const d = def && typeof def === 'object' && !('rawtext' in def) ? def.defaultValue : def;
      this.fields.push({ kind: 'text', label: txt(label), placeholder: txt(placeholder), value: d === undefined ? '' : txt(d) });
      return this;
    }
    toggle(label: Any, def?: Any) {
      const d = def && typeof def === 'object' ? def.defaultValue : def;
      this.fields.push({ kind: 'toggle', label: txt(label), value: !!d });
      return this;
    }
    slider(label: Any, min: number, max: number, step?: Any, def?: number) {
      let st = 1, d = min;
      if (step && typeof step === 'object') {
        st = Number(step.valueStep ?? 1);
        d = Number(step.defaultValue ?? min);
      } else {
        st = Number(step ?? 1);
        d = Number(def ?? min);
      }
      this.fields.push({ kind: 'slider', label: txt(label), min: Number(min), max: Number(max), step: st || 1, value: d });
      return this;
    }
    dropdown(label: Any, options: Any[], def?: Any) {
      const d = def && typeof def === 'object' ? def.defaultValueIndex : def;
      this.fields.push({ kind: 'dropdown', label: txt(label), options: options.map(txt), value: Number(d ?? 0) });
      return this;
    }
    label(t: Any) {
      this.fields.push({ kind: 'label', label: txt(t) });
      return this;
    }
    header(t: Any) {
      this.fields.push({ kind: 'header', label: txt(t) });
      return this;
    }
    divider() {
      this.fields.push({ kind: 'divider' });
      return this;
    }
    show(_player: Any): Promise<Any> {
      return new Promise((resolve) => {
        let done = false;
        const ok = host.open((close) => {
          const finishWith = (r: Any) => {
            if (done) return;
            done = true;
            close();
            resolve(r);
          };
          const values: Any[] = this.fields.map((f) => ('value' in f ? f.value : undefined));
          const body: HTMLElement[] = [];
          this.fields.forEach((f, i) => {
            if (f.kind === 'divider') body.push(el('div', { class: 'form-divider' }));
            else if (f.kind === 'label' || f.kind === 'header') body.push(labelEl(f.label, f.kind === 'header' ? 'yellow' : 'white'));
            else if (f.kind === 'text') {
              body.push(labelEl(f.label, 'left'));
              const input = mcInput(f.value, { placeholder: f.placeholder, maxlength: 256, w: 260 });
              input.addEventListener('input', () => (values[i] = input.value));
              body.push(input);
            } else if (f.kind === 'toggle') {
              const b = mcCycle<boolean>(f.label.replace(/§./g, ''), [[true, 'OUI'], [false, 'NON']], f.value, (v) => (values[i] = v), 260);
              body.push(b);
            } else if (f.kind === 'slider') {
              const name = f.label.replace(/§./g, '');
              body.push(mcSlider((v) => `${name} : ${v}`, f.min, f.max, f.step, f.value, (v) => (values[i] = v), 260));
            } else if (f.kind === 'dropdown') {
              const opts = f.options.map((o, k) => [k, o.replace(/§./g, '')] as [number, string]);
              if (opts.length) body.push(mcCycle<number>(f.label.replace(/§./g, ''), opts, f.value, (v) => (values[i] = v), 260));
            }
          });
          const s = mcScreen({
            title: this._title,
            body,
            footer: [mcButton(this._submit.replace(/§./g, '') || 'Valider', () => finishWith({ canceled: false, formValues: values }), { w: 200 })],
            bg: 'dim',
            onBack: () => {
              finishWith({ canceled: true, cancelationReason: FormCancelationReason.UserClosed, formValues: undefined });
              return true;
            },
            onClose: () => finishWith({ canceled: true, cancelationReason: FormCancelationReason.UserClosed, formValues: undefined }),
          });
          return finish(s, this._title);
        });
        if (!ok) resolve(busy());
      });
    }
  }

  const uiManager = { closeAllForms: (_p?: Any) => host.closeAll() };

  return {
    ActionFormData,
    ModalFormData,
    MessageFormData,
    FormCancelationReason,
    FormRejectReason,
    FormRejectError,
    uiManager,
    ActionFormResponse: class {},
    ModalFormResponse: class {},
    MessageFormResponse: class {},
    FormResponse: class {},
  };
}
