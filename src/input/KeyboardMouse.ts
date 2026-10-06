import type { Settings } from '../core/Settings';
import type { InputState } from './InputState';

/** Contrôles clavier/souris (développement sur ordinateur, claviers Bluetooth, ChromeOS). */
export class KeyboardMouse {
  private keys = new Set<string>();
  private cleanup: (() => void)[] = [];
  enabled = true;
  /** Échap = bouton retour Android. */
  onBack: () => void = () => {};

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

  private update() {
    const k = this.keys;
    this.input.moveY = (k.has('KeyW') || k.has('KeyZ') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    this.input.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('KeyQ') || k.has('ArrowLeft') ? 1 : 0);
    this.input.jump = k.has('Space');
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.enabled) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const code = e.code;
    if (down) {
      if (this.keys.has(code)) return;
      this.keys.add(code);
      this.input.mode = 'keyboard';
      if (code === 'KeyE' || code === 'KeyI') this.input.push('inventory');
      else if (code === 'ShiftLeft' || code === 'ShiftRight') this.input.sneak = true;
      else if (code === 'ControlLeft') this.input.sprint = true;
      else if (code === 'F5') {
        e.preventDefault();
        this.input.push('perspective');
      } else if (code === 'F3') {
        e.preventDefault();
        this.input.push('debug');
      } else if (code === 'KeyG' || code === 'KeyQ') this.input.push('drop');
      else if (code === 'KeyT' || code === 'Enter') {
        e.preventDefault();
        this.input.push('chat');
      } else if (code === 'Slash' || e.key === '/') {
        e.preventDefault();
        this.input.push('command');
      }
      else if (/^Digit[1-9]$/.test(code)) this.input.push(`slot:${Number(code.slice(5)) - 1}`);
      else if (code === 'KeyF') this.input.push('use');
      else if (code === 'Escape' || code === 'KeyP') this.onBack();
    } else {
      this.keys.delete(code);
      if (code === 'ShiftLeft' || code === 'ShiftRight') this.input.sneak = false;
      else if (code === 'ControlLeft') this.input.sprint = false;
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
