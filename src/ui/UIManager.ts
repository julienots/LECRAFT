import { el } from './dom';
import { bmModal } from './BedrockUI';

export interface Screen {
  el: HTMLElement;
  /** Retour Android / Échap : retourne vrai si l'écran a géré l'action. */
  onBack?(): boolean;
  onClose?(): void;
}

/**
 * Pile d'écrans DOM (menus, overlays). Le bouton retour Android ferme l'écran du dessus.
 */
export class UIManager {
  private stack: Screen[] = [];
  onClick: () => void = () => {};

  constructor(readonly root: HTMLElement) {}

  push(s: Screen) {
    this.stack.push(s);
    this.root.append(s.el);
  }

  /** Remplace toute la pile. */
  set(s: Screen) {
    this.clear();
    this.push(s);
  }

  pop(): Screen | undefined {
    const s = this.stack.pop();
    if (s) {
      s.el.remove();
      s.onClose?.();
    }
    return s;
  }

  remove(s: Screen) {
    const i = this.stack.indexOf(s);
    if (i >= 0) {
      this.stack.splice(i, 1);
      s.el.remove();
      s.onClose?.();
    }
  }

  clear() {
    while (this.stack.length) this.pop();
  }

  get top(): Screen | undefined {
    return this.stack[this.stack.length - 1];
  }
  get size() {
    return this.stack.length;
  }

  /** Gère le retour ; retourne faux si la pile est vide (le jeu décide alors). */
  back(): boolean {
    const top = this.top;
    if (!top) return false;
    if (top.onBack?.()) return true;
    if (this.stack.length > 1 || top.onBack === undefined) {
      this.pop();
      return true;
    }
    return false;
  }

  confirm(title: string, message: string, okLabel = 'Confirmer', danger = true): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      let own: Screen | null = null;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        if (own) this.remove(own);
        resolve(v);
      };
      void danger;
      // la fenêtre s'affiche par-dessus l'écran actuel (qui reste visible, assombri) quand c'est un écran des menus
      let host = this.top?.el;
      if (!host?.classList.contains('bm-screen') || host.classList.contains('bm-loading')) {
        host = el('div', { class: 'screen mc-screen bm-screen' });
        own = { el: host, onBack: () => (finish(false), true) };
        this.push(own);
      }
      bmModal(host, {
        title,
        body: [message],
        buttons: [{ label: okLabel, tone: 'green', onClick: () => finish(true) }, { label: 'Annuler', onClick: () => finish(false) }],
        onClose: () => finish(false),
      });
    });
  }
}
