import type { Settings } from '../core/Settings';
import type { InputState } from './InputState';
import { actionOf, keysFor, type KeyAction } from './KeyBindings';

/** Contrôles clavier/souris (développement sur ordinateur, claviers Bluetooth, ChromeOS). */
export class KeyboardMouse {
  private keys = new Set<string>();
  /** Double appui sur « avancer » : sprint jusqu'au relâchement (comme le jeu de référence). */
  private lastForward = 0;
  private tapSprint = false;
  private cleanup: (() => void)[] = [];
  enabled = true;
  /** Échap = bouton retour Android. */
  onBack: () => void = () => {};
  /** Prochaine touche capturée (réassignation des touches). */
  capture: ((code: string) => void) | null = null;

  constructor(private canvas: HTMLElement, private input: InputState, private settings: Settings) {
    const kd = (e: KeyboardEvent) => this.onKey(e, true);
    const ku = (e: KeyboardEvent) => this.onKey(e, false);
    const md = (e: MouseEvent) => this.onMouse(e, true);
    const mu = (e: MouseEvent) => this.onMouse(e, false);
    const mm = (e: MouseEvent) => {
      if (document.pointerLockElement !== this.canvas || !this.enabled) return;
      this.input.lookDX += e.movementX * this.settings.sensitivity * 0.35;
      this.input.lookDY += e.movementY * this.settings.sensitivity * 0.35 * (this.settings.invertY ? -1 : 1);
    };
    const wheel = (e: WheelEvent) => {
      if (!this.enabled || document.pointerLockElement !== this.canvas) return;
      this.input.push(e.deltaY > 0 ? 'slotNext' : 'slotPrev');
    };
    const ctx = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    canvas.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('mousemove', mm);
    window.addEventListener('wheel', wheel, { passive: true });
    canvas.addEventListener('contextmenu', ctx);
    this.cleanup.push(
      () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku),
      () => canvas.removeEventListener('mousedown', md),
      () => window.removeEventListener('mouseup', mu),
      () => window.removeEventListener('mousemove', mm),
      () => window.removeEventListener('wheel', wheel),
      () => canvas.removeEventListener('contextmenu', ctx),
    );
  }

  /** Une des touches de l'action est-elle enfoncée ? (touches personnalisables) */
  private held(a: KeyAction) {
    return keysFor(a, this.settings.keys).some((c) => this.keys.has(c));
  }

  private update() {
    this.input.moveY = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0);
    this.input.moveX = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    this.input.jump = this.held('jump');
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.enabled) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const code = e.code;
    // réassignation en cours (écran « Touches clavier ») : la touche est capturée
    if (down && this.capture) {
      e.preventDefault();
      const cb = this.capture;
      this.capture = null;
      cb(code);
      return;
    }
    const custom = this.settings.keys;
    const action = actionOf(code, custom) ?? (e.key === '/' ? 'command' : null);
    if (down) {
      if (this.keys.has(code)) return;
      this.keys.add(code);
      this.input.mode = 'keyboard';
      if (action === 'forward') {
        const now = performance.now();
        if (now - this.lastForward < 280) {
          this.tapSprint = true;
          this.input.sprint = true;
        }
        this.lastForward = now;
      }
      if (action === 'inventory') this.input.push('inventory');
      else if (action === 'sneak') this.input.sneak = true;
      else if (action === 'sprint') this.input.sprint = true;
      else if (action === 'perspective' || action === 'debug') {
        e.preventDefault();
        this.input.push(action);
      } else if (action === 'drop') this.input.push('drop');
      else if (action === 'chat' || action === 'command') {
        e.preventDefault();
        this.input.push(action);
      } else if (/^Digit[1-9]$/.test(code)) this.input.push(`slot:${Number(code.slice(5)) - 1}`);
      else if (action === 'use') this.input.push('use');
      else if (action === 'pause') this.onBack();
    } else {
      this.keys.delete(code);
      if (this.tapSprint && action === 'forward') {
        this.tapSprint = false;
        if (!this.held('sprint')) this.input.sprint = false;
      }
      if (action === 'sneak') this.input.sneak = this.held('sneak');
      else if (action === 'sprint') this.input.sprint = this.tapSprint;
    }
    this.update();
  }

  private onMouse(e: MouseEvent, down: boolean) {
    if (!this.enabled) return;
    if (down && document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.();
      return;
    }
    this.input.mode = 'keyboard';
    if (e.button === 0) {
      this.input.attack = down;
      if (down) this.input.push('attackTap');
    } else if (e.button === 2) {
      if (down) this.input.push('use');
      this.input.useHeld = down;
    }
  }

  releaseAll() {
    this.keys.clear();
    this.update();
    this.input.attack = false;
    this.input.useHeld = false;
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  dispose() {
    this.cleanup.forEach((f) => f());
    this.exitPointerLock();
  }
}
