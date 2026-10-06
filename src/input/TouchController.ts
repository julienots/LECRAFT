import type { Settings } from '../core/Settings';
import type { InputState } from './InputState';
import { VirtualJoystick } from './VirtualJoystick';
import { DPad } from './DPad';

export interface TouchButtonDef {
  id: string;
  label: string;
  /** Position par défaut : distance depuis le bord (droite/bas) en px. */
  right?: number;
  left?: number;
  bottom?: number;
  top?: number;
  size: number;
  kind: 'hold' | 'tap' | 'toggle';
}

/** Disposition par défaut : grappe d'actions en bas à droite (hors de la hotbar). */
const BUTTONS: TouchButtonDef[] = [
  { id: 'jump', label: '⤒', right: 22, bottom: 28, size: 78, kind: 'hold' },
  { id: 'sneak', label: '⇩', right: 110, bottom: 20, size: 54, kind: 'toggle' },
  { id: 'attack', label: '⚔', right: 104, bottom: 88, size: 64, kind: 'hold' },
  { id: 'use', label: '✋', right: 22, bottom: 120, size: 62, kind: 'tap' },
  { id: 'sprint', label: '»', left: 24, bottom: 190, size: 54, kind: 'toggle' },
];

const LONG_PRESS_MS = 280;
const TAP_MOVE_PX = 12;

/**
 * Contrôles tactiles : joystick à gauche, caméra à droite, boutons d'action.
 * Appui long dans la zone caméra = miner/attaquer ; appui court = utiliser/poser.
 * Les positions des boutons sont personnalisables (mode édition) et sauvegardées.
 */
export class TouchController {
  readonly root: HTMLDivElement;
  private joystick: VirtualJoystick;
  private dpad: DPad;
  private buttons = new Map<string, HTMLDivElement>();
  private look = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; long: boolean; timer: number }>();
  private editMode = false;
  enabled = true;
  private cleanup: (() => void)[] = [];

  constructor(parent: HTMLElement, private input: InputState, private settings: Settings) {
    this.root = document.createElement('div');
    this.root.className = 'touch-layer';
    parent.appendChild(this.root);
    this.joystick = new VirtualJoystick(this.root, settings.joystickSize / 2);
    this.dpad = new DPad(this.root, input);
    for (const b of BUTTONS) this.createButton(b);
    this.applyLayout();
    const opts = { passive: false } as AddEventListenerOptions;
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    this.root.addEventListener('pointerdown', down, opts);
    window.addEventListener('pointermove', move, opts);
    window.addEventListener('pointerup', up, opts);
    window.addEventListener('pointercancel', up, opts);
    this.cleanup.push(
      () => this.root.removeEventListener('pointerdown', down),
      () => window.removeEventListener('pointermove', move),
      () => window.removeEventListener('pointerup', up),
      () => window.removeEventListener('pointercancel', up),
    );
  }

  private createButton(def: TouchButtonDef) {
    const el = document.createElement('div');
    el.className = `touch-btn btn-${def.id}`;
    el.dataset.id = def.id;
    el.textContent = def.label;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', def.id);
    this.root.appendChild(el);
    this.buttons.set(def.id, el);
    let dragging: { id: number; dx: number; dy: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.enabled) return;
      if (this.editMode) {
        const r = el.getBoundingClientRect();
        dragging = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
        el.setPointerCapture(e.pointerId);
        return;
      }
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressed');
      this.input.mode = 'touch';
      this.press(def, true);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.editMode || !dragging || dragging.id !== e.pointerId) return;
      const W = window.innerWidth, H = window.innerHeight;
      const x = ((e.clientX - dragging.dx) / W) * 100, y = ((e.clientY - dragging.dy) / H) * 100;
      this.settings.layout[def.id] = { x: Math.max(0, Math.min(95, x)), y: Math.max(0, Math.min(95, y)) };
      this.applyLayout();
    });
    const release = (e: PointerEvent) => {
      e.stopPropagation();
      if (this.editMode) {
        dragging = null;
        return;
      }
      el.classList.remove('pressed');
      this.press(def, false);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  private press(def: TouchButtonDef, down: boolean) {
    const i = this.input;
    switch (def.id) {
      case 'jump':
        i.jump = down;
        break;
      case 'attack':
        i.attack = down;
        if (down) i.push('attackTap');
        break;
      case 'use':
        if (down) i.push('use');
        i.useHeld = down;
        break;
      case 'sneak':
        if (down) {
          i.sneak = !i.sneak;
          this.buttons.get('sneak')!.classList.toggle('active', i.sneak);
        }
        break;
      case 'sprint':
        if (down) {
          i.sprint = !i.sprint;
          this.buttons.get('sprint')!.classList.toggle('active', i.sprint);
        }
        break;
    }
  }

  /** Réinitialise l'état visuel des bascules (après mort, menu...). */
  syncToggles() {
    this.buttons.get('sneak')!.classList.toggle('active', this.input.sneak);
    this.buttons.get('sprint')!.classList.toggle('active', this.input.sprint);
    this.dpad.syncSneak();
  }

  applyLayout() {
    const s = this.settings;
    const scale = s.buttonScale;
    for (const def of BUTTONS) {
      const el = this.buttons.get(def.id)!;
      const size = def.size * scale;
      el.style.width = el.style.height = `${size}px`;
      el.style.fontSize = `${size * 0.42}px`;
      const custom = s.layout[def.id];
      el.style.left = el.style.right = el.style.top = el.style.bottom = '';
      if (custom) {
        el.style.left = `${custom.x}%`;
        el.style.top = `${custom.y}%`;
      } else {
        const mirror = s.leftHanded;
        const r = def.right, l = def.left;
        if (r !== undefined) el.style[mirror ? 'left' : 'right'] = `${r * scale}px`;
        if (l !== undefined) el.style[mirror ? 'right' : 'left'] = `${l * scale}px`;
        if (def.bottom !== undefined) el.style.bottom = `${def.bottom * scale}px`;
        if (def.top !== undefined) el.style.top = `${def.top * scale}px`;
      }
    }
    this.joystick.setSize(s.joystickSize);
    // croix directionnelle : la case centrale remplace « accroupi », double appui avant = sprint
    const dpad = s.controlScheme === 'dpad';
    this.dpad.setVisible(dpad);
    this.dpad.setScale(scale, s.leftHanded);
    this.buttons.get('sneak')!.style.display = dpad ? 'none' : '';
    this.buttons.get('sprint')!.style.display = dpad ? 'none' : '';
    if (dpad && !s.layout.jump) {
      const j = this.buttons.get('jump')!;
      j.style.bottom = `${40 * scale}px`;
    }
  }

  setEditMode(on: boolean) {
    this.editMode = on;
    this.root.classList.toggle('editing', on);
  }

  resetLayout() {
    this.settings.layout = {};
    this.applyLayout();
  }

  private isJoystickZone(x: number) {
    if (this.settings.controlScheme === 'dpad') return false;
    const w = window.innerWidth;
    return this.settings.leftHanded ? x > w * 0.6 : x < w * 0.4;
  }

  /** Position du doigt en coordonnées normalisées (null en visée au viseur). */
  private aimAt(x: number, y: number): { x: number; y: number } | null {
    if (this.settings.touchAim === 'crosshair') return null;
    return { x: (x / window.innerWidth) * 2 - 1, y: 1 - (y / window.innerHeight) * 2 };
  }

  private onDown(e: PointerEvent) {
    if (!this.enabled || this.editMode || e.pointerType === 'mouse') return;
    e.preventDefault();
    this.input.mode = 'touch';
    if (this.isJoystickZone(e.clientX) && !this.joystick.active && e.clientY > window.innerHeight * 0.25) {
      this.joystick.start(e.pointerId, e.clientX, e.clientY);
      return;
    }
    const entry = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), long: false, timer: 0 };
    entry.timer = window.setTimeout(() => {
      if (Math.hypot(entry.x - entry.sx, entry.y - entry.sy) < TAP_MOVE_PX * 2) {
        entry.long = true;
        this.input.attack = true;
        this.input.holdAim = this.aimAt(entry.x, entry.y);
      }
    }, LONG_PRESS_MS);
    this.look.set(e.pointerId, entry);
  }

  private onMove(e: PointerEvent) {
    if (!this.enabled || e.pointerType === 'mouse') return;
    if (this.joystick.move(e.pointerId, e.clientX, e.clientY)) {
      this.input.moveX = this.joystick.x;
      this.input.moveY = this.joystick.y;
      return;
    }
    const l = this.look.get(e.pointerId);
    if (!l) return;
    const k = this.settings.sensitivity * 0.9;
    this.input.lookDX += (e.clientX - l.x) * k;
    this.input.lookDY += (e.clientY - l.y) * k * (this.settings.invertY ? -1 : 1);
    l.x = e.clientX;
    l.y = e.clientY;
    if (l.long) this.input.holdAim = this.aimAt(l.x, l.y);
  }

  private onUp(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    if (this.joystick.end(e.pointerId)) {
      this.input.moveX = this.input.moveY = 0;
      return;
    }
    const l = this.look.get(e.pointerId);
    if (!l) return;
    clearTimeout(l.timer);
    this.look.delete(e.pointerId);
    if (l.long) {
      if (![...this.look.values()].some((o) => o.long)) {
        this.input.attack = false;
        this.input.holdAim = null;
      }
    } else if (performance.now() - l.t < LONG_PRESS_MS && Math.hypot(l.x - l.sx, l.y - l.sy) < TAP_MOVE_PX) {
      // toucher bref : utiliser / poser là où le doigt a touché
      this.input.tapAim = this.aimAt(l.sx, l.sy);
      this.input.push('use');
    }
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
    if (!v) this.releaseAll();
  }

  releaseAll() {
    this.joystick.end(-1);
    this.dpad.release();
    for (const l of this.look.values()) clearTimeout(l.timer);
    this.look.clear();
    this.input.attack = this.input.jump = this.input.useHeld = false;
    this.input.holdAim = this.input.tapAim = null;
    this.input.moveX = this.input.moveY = 0;
    this.buttons.forEach((b) => b.classList.remove('pressed'));
  }

  dispose() {
    this.releaseAll();
    this.cleanup.forEach((f) => f());
    this.joystick.dispose();
    this.root.remove();
  }
}
