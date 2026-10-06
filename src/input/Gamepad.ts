import type { Settings } from '../core/Settings';
import type { InputState } from './InputState';

/**
 * Manettes (API Gamepad, disposition « standard » : Xbox, PlayStation, manettes Bluetooth Android).
 * Disposition reprise de l'édition console / mobile du jeu de référence :
 *
 * En jeu                                   | Menus et inventaire (curseur virtuel)
 * ---------------------------------------- | -------------------------------------------
 * stick gauche : se déplacer               | stick gauche / croix : déplacer le curseur
 * stick droit : regarder                   | stick droit : faire défiler
 * A : sauter (double appui : voler)        | A : sélectionner / prendre / poser
 * B : lâcher l'objet                       | B : retour / fermer
 * X : utiliser (comme LT)                  | X : prendre la moitié / poser un seul objet
 * Y : inventaire                           | Y : déplacement rapide (comme Maj + clic)
 * RT : miner / attaquer — LT : utiliser    |
 * LB / RB : objet précédent / suivant      |
 * clic stick gauche : sprint               |
 * clic stick droit : s'accroupir (bascule ; maintenu en vol : descendre)
 * croix haut : changer de vue — droite : chat — bas : lâcher l'objet
 * Start (Menu) : pause — Select (Vue) : informations de débogage
 */

const enum Btn {
  A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, SELECT = 8, START = 9, LS = 10, RS = 11, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15,
}

const DEAD = 0.18;
const TRIGGER = 0.4;

export interface GamepadHost {
  /** Vrai quand le joueur contrôle son personnage (aucun menu, inventaire ou chat ouvert). */
  inGame(): boolean;
  /** Vrai en vol (créatif). */
  flying(): boolean;
  back(): void;
}

function axis(v: number | undefined): number {
  const a = v ?? 0;
  if (Math.abs(a) < DEAD) return 0;
  return Math.sign(a) * ((Math.abs(a) - DEAD) / (1 - DEAD));
}

export class GamepadInput {
  /** Une manette a servi récemment (masque les commandes tactiles). */
  active = false;
  private prev: boolean[] = [];
  private ownMove = false;
  private sneakToggled = false;
  private ownSprint = false;
  private cursor: HTMLDivElement;
  private cx = window.innerWidth / 2;
  private cy = window.innerHeight / 2;
  private downEl: Element | null = null;
  private downButton = 0;
  private repeat = new Map<number, number>();
  private cleanup: (() => void)[] = [];
  /** Manette simulée (tests automatisés) ; remplace navigator.getGamepads() si définie. */
  virtual: { axes: number[]; buttons: { pressed: boolean; value: number }[] } | null = null;

  constructor(private input: InputState, private settings: Settings, private host: GamepadHost) {
    this.cursor = document.createElement('div');
    this.cursor.className = 'gp-cursor hidden';
    document.body.appendChild(this.cursor);
    const touch = (e: PointerEvent) => {
      if (e.isTrusted && this.active) this.setActive(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.isTrusted && this.active) this.setActive(false);
    };
    const connected = (e: GamepadEvent) => console.info(`Manette connectée : ${e.gamepad.id}`);
    window.addEventListener('pointerdown', touch, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('gamepadconnected', connected);
    this.cleanup.push(
      () => window.removeEventListener('pointerdown', touch, true),
      () => window.removeEventListener('keydown', key, true),
      () => window.removeEventListener('gamepadconnected', connected),
    );
  }

  private pad(): { axes: readonly number[]; buttons: readonly { pressed: boolean; value: number }[] } | null {
    if (this.virtual) return this.virtual;
    const list = navigator.getGamepads?.() ?? [];
    for (const g of list) if (g && g.connected && g.buttons.length >= 12) return g;
    return null;
  }

  private setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    document.documentElement.classList.toggle('gamepad', on);
    if (!on) {
      this.cursor.classList.add('hidden');
      this.releaseGame();
    }
  }

  /** À appeler à chaque image. */
  poll(dt: number) {
    const g = this.pad();
    if (!g) {
      if (this.active) this.setActive(false);
      return;
    }
    const pressed = (i: number) => {
      const b = g.buttons[i];
      return !!b && (b.pressed || b.value > TRIGGER);
    };
    const now: boolean[] = [];
    for (let i = 0; i < 17; i++) now[i] = pressed(i);
    const lx = axis(g.axes[0]), ly = axis(g.axes[1]), rx = axis(g.axes[2]), ry = axis(g.axes[3]);
    const anything = now.some(Boolean) || lx || ly || rx || ry;
    if (anything && !this.active) this.setActive(true);
    if (!this.active) {
      this.prev = now;
      return;
    }
    const edge = (i: number) => now[i] && !this.prev[i];
    const released = (i: number) => !now[i] && this.prev[i];
    if (this.host.inGame()) {
      this.cursor.classList.add('hidden');
      this.endPress();
      this.game(now, edge, released, lx, ly, rx, ry, dt);
    } else {
      this.releaseGame();
      this.menu(now, edge, released, lx, ly, rx, ry, dt);
    }
    this.prev = now;
  }

  private game(now: boolean[], edge: (i: number) => boolean, released: (i: number) => boolean, lx: number, ly: number, rx: number, ry: number, dt: number) {
    const inp = this.input;
    inp.mode = 'gamepad';
    // déplacement
    if (lx || ly || this.ownMove) {
      inp.moveX = lx;
      inp.moveY = -ly;
      this.ownMove = !!(lx || ly);
    }
    // regard : vitesse ~ 200°/s à fond, courbe quadratique pour la précision
    const sens = this.settings.sensitivity;
    const k = 800 * sens * dt;
    inp.lookDX += Math.sign(rx) * rx * rx * k;
    inp.lookDY += Math.sign(ry) * ry * ry * k * 0.75 * (this.settings.invertY ? -1 : 1);
    if (edge(Btn.A)) inp.jump = true;
    if (released(Btn.A)) inp.jump = false;
    if (edge(Btn.RT)) {
      inp.attack = true;
      inp.push('attackTap');
    }
    if (released(Btn.RT)) inp.attack = false;
    for (const b of [Btn.LT, Btn.X]) {
      if (edge(b)) {
        inp.push('use');
        inp.useHeld = true;
      }
      if (released(b) && !now[Btn.LT] && !now[Btn.X]) inp.useHeld = false;
    }
    if (edge(Btn.LB)) inp.push('slotPrev');
    if (edge(Btn.RB)) inp.push('slotNext');
    if (edge(Btn.Y)) inp.push('inventory');
    if (edge(Btn.B) || edge(Btn.DOWN)) inp.push('drop');
    if (edge(Btn.UP)) inp.push('perspective');
    if (edge(Btn.RIGHT)) inp.push('chat');
    if (edge(Btn.SELECT)) inp.push('debug');
    if (edge(Btn.START)) inp.push('pause');
    // sprint : clic du stick gauche, jusqu'à l'arrêt
    if (edge(Btn.LS)) {
      inp.sprint = true;
      this.ownSprint = true;
    } else if (this.ownSprint && !lx && !ly) {
      inp.sprint = false;
      this.ownSprint = false;
    }
    // accroupi : bascule (maintenu pendant le vol pour descendre)
    if (this.host.flying()) {
      this.sneakToggled = false;
      if (edge(Btn.RS) || released(Btn.RS)) inp.sneak = now[Btn.RS];
    } else if (edge(Btn.RS)) {
      this.sneakToggled = !this.sneakToggled;
      inp.sneak = this.sneakToggled;
    }
  }

  /** Relâche les commandes de jeu tenues par la manette (ouverture d'un menu). */
  private releaseGame() {
    const inp = this.input;
    if (this.ownMove) {
      inp.moveX = inp.moveY = 0;
      this.ownMove = false;
    }
    if (this.prev[Btn.A]) inp.jump = false;
    if (this.prev[Btn.RT]) inp.attack = false;
    if (this.prev[Btn.LT] || this.prev[Btn.X]) inp.useHeld = false;
  }

  // ---------- menus : curseur virtuel ----------
  private menu(now: boolean[], edge: (i: number) => boolean, released: (i: number) => boolean, lx: number, ly: number, rx: number, ry: number, dt: number) {
    const W = window.innerWidth, H = window.innerHeight;
    this.cursor.classList.remove('hidden');
    let mx = lx, my = ly;
    // croix : déplacement lent et précis
    if (now[Btn.LEFT]) mx -= 0.35;
    if (now[Btn.RIGHT]) mx += 0.35;
    if (now[Btn.UP]) my -= 0.35;
    if (now[Btn.DOWN]) my += 0.35;
    const moving = mx || my;
    if (moving) {
      const over = document.elementFromPoint(this.cx, this.cy);
      // ralenti au-dessus d'un élément interactif (comme le curseur « aimanté » de la version console)
      const slow = over?.closest('button, .gslot, [role=button], input, select, .mc-slider, .mc-btn') ? 0.55 : 1;
      const speed = Math.min(W, H) * 1.6 * slow * dt;
      const m = Math.hypot(mx, my);
      const f = Math.pow(Math.min(1, m), 1.6) / (m || 1);
      this.cx = Math.max(0, Math.min(W - 1, this.cx + mx * f * speed));
      this.cy = Math.max(0, Math.min(H - 1, this.cy + my * f * speed));
      this.dispatch('pointermove', this.downEl ?? this.target(), 0, false);
    }
    this.cursor.style.transform = `translate(${this.cx}px, ${this.cy}px)`;
    // défilement des listes au stick droit
    if (ry || rx) {
      let el: Element | null = this.target();
      while (el && el !== document.body) {
        const s = getComputedStyle(el);
        if ((/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) || (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth)) {
          el.scrollBy(rx * 900 * dt, ry * 900 * dt);
          break;
        }
        el = el.parentElement;
      }
    }
    // A : clic gauche, X : clic droit, Y : Maj + clic
    for (const [b, button, shift] of [[Btn.A, 0, false], [Btn.X, 2, false], [Btn.Y, 0, true]] as const) {
      if (edge(b)) this.press(button, shift);
      if (released(b) && this.downEl && this.downButton === b) this.release(button, shift);
    }
    if (edge(Btn.B)) {
      this.endPress();
      this.host.back();
    }
    if (edge(Btn.START) && !this.host.inGame()) this.host.back();
    // LB / RB : onglets (inventaire créatif), comme une molette
    for (const [b, d] of [[Btn.LB, -1], [Btn.RB, 1]] as const) {
      const t = performance.now();
      if (edge(b) || (now[b] && t > (this.repeat.get(b) ?? Infinity))) {
        this.repeat.set(b, t + (edge(b) ? 400 : 120));
        this.target()?.dispatchEvent(new WheelEvent('wheel', { deltaY: d * 100, clientX: this.cx, clientY: this.cy, bubbles: true }));
      }
    }
  }

  private target(): Element | null {
    const el = document.elementFromPoint(this.cx, this.cy);
    return el === this.cursor ? null : el;
  }

  private dispatch(type: string, el: Element | null, button: number, shift: boolean) {
    if (!el) return;
    const init: PointerEventInit = {
      bubbles: true, cancelable: true, composed: true, clientX: this.cx, clientY: this.cy, button, buttons: type === 'pointerup' ? 0 : button === 2 ? 2 : 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, shiftKey: shift,
    };
    el.dispatchEvent(new PointerEvent(type, init));
    if (type === 'pointerdown') el.dispatchEvent(new MouseEvent('mousedown', init));
    if (type === 'pointerup') el.dispatchEvent(new MouseEvent('mouseup', init));
  }

  private press(button: number, shift: boolean) {
    const el = this.target();
    this.endPress();
    if (!el) return;
    this.downEl = el;
    this.downButton = button === 2 ? Btn.X : shift ? Btn.Y : Btn.A;
    if (el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.focus();
    this.dispatch('pointerdown', el, button, shift);
  }

  private release(button: number, shift: boolean) {
    const down = this.downEl;
    this.downEl = null;
    const el = this.target();
    this.dispatch('pointerup', el, button, shift);
    if (down && down !== el && down.isConnected) this.dispatch('pointercancel', down, button, shift);
    // clic : sur l'élément commun (comme un vrai clic de souris)
    if (el && down && (down === el || down.contains(el) || el.contains(down))) {
      const t = down.contains(el) ? el : down;
      if (button === 0) (t as HTMLElement).click?.();
      else t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: this.cx, clientY: this.cy, button: 2 }));
    }
  }

  private endPress() {
    if (!this.downEl) return;
    if (this.downEl.isConnected) this.dispatch('pointercancel', this.downEl, 0, false);
    this.downEl = null;
  }

  /** Recentre le curseur (ouverture d'un écran). */
  center() {
    this.cx = window.innerWidth / 2;
    this.cy = window.innerHeight / 2;
  }

  get cursorPos(): [number, number] {
    return [this.cx, this.cy];
  }

  dispose() {
    this.cleanup.forEach((f) => f());
    this.cursor.remove();
    document.documentElement.classList.remove('gamepad');
  }
}
