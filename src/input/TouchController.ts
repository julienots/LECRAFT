import type { Settings } from '../core/Settings';
import type { InputState } from './InputState';
import { VirtualJoystick } from './VirtualJoystick';
import { DPad } from './DPad';
import { bhTouchIcon } from '../ui/TouchIcons';
import { bedrockScale } from '../ui/Bedrock';

export interface TouchButtonDef {
  id: string;
  label: string;
  /** Position par défaut : distance depuis le bord (droite/bas) en pixels d'interface (× échelle de l'écran). */
  right?: number;
  left?: number;
  bottom?: number;
  top?: number;
  size: number;
  kind: 'hold' | 'tap' | 'toggle';
}

/**
 * Disposition par défaut, comme l'édition mobile : sauter en bas à droite, s'accroupir à sa gauche,
 * courir au-dessus du joystick. Pas de bouton « attaquer » ni « utiliser » : on touche l'écran
 * (toucher bref = poser / frapper, appui long = casser), comme dans le jeu original.
 */
const BUTTONS: TouchButtonDef[] = [
  // disposition mesurée sur l'édition mobile (écran 20:9) : sauter au-dessus de s'accroupir,
  // courir (double chevron) à leur gauche
  { id: 'jump', label: 'bh_jump', right: 24.3, bottom: 127.7, size: 32.5, kind: 'hold' },
  { id: 'sneak', label: 'bh_sneak', right: 24.3, bottom: 80, size: 32.5, kind: 'toggle' },
  { id: 'sprint', label: 'bh_sprint', right: 76, bottom: 104, size: 32.5, kind: 'toggle' },
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
  /** Cercle blanc sous le doigt qui oriente la caméra. */
  private ring: HTMLDivElement;
  enabled = true;
  private cleanup: (() => void)[] = [];

  constructor(parent: HTMLElement, private input: InputState, private settings: Settings) {
    this.root = document.createElement('div');
    this.root.className = 'touch-layer';
    parent.appendChild(this.root);
    this.joystick = new VirtualJoystick(this.root, settings.joystickSize);
    this.dpad = new DPad(this.root, input);
    this.ring = document.createElement('div');
    this.ring.className = 'bh-ring';
    this.ring.style.display = 'none';
    this.root.appendChild(this.ring);
    for (const b of BUTTONS) this.createButton(b);
    this.applyLayout();
    const relayout = () => this.applyLayout();
    window.addEventListener('resize', relayout);
    this.cleanup.push(() => window.removeEventListener('resize', relayout));
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
    el.style.backgroundImage = bhTouchIcon(def.label);
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
      case 'sneak':
        // en vol (créatif) : maintenir pour descendre, comme le jeu original
        if (this.flying) {
          i.sneak = down;
          break;
        }
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

  private flying = false;
  /** En vol (créatif) : « s'accroupir » devient « descendre » (flèche vers le bas). */
  setFlying(on: boolean) {
    if (on === this.flying) return;
    this.flying = on;
    const b = this.buttons.get('sneak')!;
    if (on) {
      this.input.sneak = false;
      b.classList.remove('active');
    }
    this.dpad.setFlying(on);
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
    const u = bedrockScale();
    for (const def of BUTTONS) {
      const el = this.buttons.get(def.id)!;
      const size = def.size * scale * u;
      el.style.width = el.style.height = `${size}px`;
      const custom = s.layout[def.id];
      el.style.left = el.style.right = el.style.top = el.style.bottom = '';
      if (custom) {
        el.style.left = `${custom.x}%`;
        el.style.top = `${custom.y}%`;
      } else {
        const mirror = s.leftHanded;
        const r = def.right, l = def.left;
        if (r !== undefined) el.style[mirror ? 'left' : 'right'] = `${r * u}px`;
        if (l !== undefined) el.style[mirror ? 'right' : 'left'] = `${l * u}px`;
        if (def.bottom !== undefined) el.style.bottom = `${def.bottom * u}px`;
        if (def.top !== undefined) el.style.top = `${def.top * u}px`;
      }
    }
    this.joystick.layout(s.joystickSize, s.leftHanded);
    // croix directionnelle : la case centrale remplace « accroupi », double appui avant = sprint
    const dpad = s.controlScheme === 'dpad';
    this.dpad.setVisible(dpad);
    this.joystick.setShown(!dpad);
    this.dpad.setScale(scale, s.leftHanded);
    this.buttons.get('sneak')!.style.display = dpad ? 'none' : '';
    this.buttons.get('sprint')!.style.display = dpad ? 'none' : '';
    if (dpad && !s.layout.jump) {
      const j = this.buttons.get('jump')!;
      j.style.bottom = `${40 * u}px`;
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
    // horodatage réel du toucher (pas l'heure de traitement : une image en retard ne doit pas
    // transformer un toucher bref en appui long)
    const entry = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: e.timeStamp, long: false, timer: 0 };
    entry.timer = window.setTimeout(() => {
      if (Math.hypot(entry.x - entry.sx, entry.y - entry.sy) < TAP_MOVE_PX * 2) {
        entry.long = true;
        this.ring.classList.add('hold');
        this.input.attack = true;
        this.input.holdAim = this.aimAt(entry.x, entry.y);
      }
    }, LONG_PRESS_MS);
    this.look.set(e.pointerId, entry);
    this.showRing(e.clientX, e.clientY, false);
  }

  /** Cercle de visée sous le doigt (peau claire quand l'appui long mine / attaque). */
  private showRing(x: number, y: number, hold: boolean) {
    this.ring.style.display = '';
    this.ring.style.left = `${x}px`;
    this.ring.style.top = `${y}px`;
    this.ring.classList.toggle('hold', hold);
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
    this.showRing(l.x, l.y, l.long);
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
    if (!this.look.size) this.ring.style.display = 'none';
    const short = e.timeStamp - l.t < LONG_PRESS_MS && Math.hypot(l.x - l.sx, l.y - l.sy) < TAP_MOVE_PX;
    if (l.long) {
      if (![...this.look.values()].some((o) => o.long)) {
        this.input.attack = false;
        this.input.holdAim = null;
      }
      // minuterie déclenchée en retard alors que le doigt s'était relevé à temps : c'était un toucher
      if (short) {
        this.input.tapAim = this.aimAt(l.sx, l.sy);
        this.input.push('use');
      }
    } else if (short) {
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
    this.ring.style.display = 'none';
    this.joystick.reset();
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
