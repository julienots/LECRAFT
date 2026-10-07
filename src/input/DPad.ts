import type { InputState } from './InputState';
import { touchIcon } from '../ui/TouchIcons';

type Cell = 'up' | 'down' | 'left' | 'right' | 'upleft' | 'upright' | 'center' | null;

const DIRS: Record<Exclude<Cell, null | 'center'>, [number, number]> = {
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0],
  upleft: [-Math.SQRT1_2, Math.SQRT1_2],
  upright: [Math.SQRT1_2, Math.SQRT1_2],
};

/**
 * Croix directionnelle « classique » des commandes tactiles de l'édition mobile :
 * flèches avant/arrière/gauche/droite, diagonales avant qui apparaissent en avançant,
 * case centrale = s'accroupir, double appui sur « avant » = sprint. Le doigt peut glisser
 * d'une flèche à l'autre.
 */
export class DPad {
  readonly root: HTMLDivElement;
  private cells = new Map<Exclude<Cell, null>, HTMLDivElement>();
  private pointer: number | null = null;
  private current: Cell = null;
  private lastUp = 0;
  private sprintByTap = false;

  constructor(parent: HTMLElement, private input: InputState) {
    this.root = document.createElement('div');
    this.root.className = 'dpad hidden';
    const icons: Record<Exclude<Cell, null>, string> = { up: 'up', down: 'down', left: 'left', right: 'right', upleft: 'upleft', upright: 'upright', center: 'sneak' };
    for (const k of Object.keys(icons) as Exclude<Cell, null>[]) {
      const c = document.createElement('div');
      c.className = `dpad-cell dpad-${k}`;
      c.style.backgroundImage = touchIcon(icons[k]);
      this.root.append(c);
      this.cells.set(k, c);
    }
    parent.append(this.root);
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || this.pointer !== null) return;
      e.preventDefault();
      e.stopPropagation();
      this.pointer = e.pointerId;
      this.input.mode = 'touch';
      const cell = this.cellAt(e.clientX, e.clientY, true);
      if (cell === 'center' && this.flying) {
        // en vol : maintenir la case centrale pour descendre
        this.input.sneak = true;
        this.cells.get('center')!.classList.add('pressed');
        this.current = 'center';
        return;
      }
      if (cell === 'center') {
        this.input.sneak = !this.input.sneak;
        this.cells.get('center')!.classList.toggle('active', this.input.sneak);
        this.current = 'center';
        return;
      }
      if (cell === 'up') {
        const now = performance.now();
        if (now - this.lastUp < 300) {
          this.input.sprint = true;
          this.sprintByTap = true;
        }
        this.lastUp = now;
      }
      this.set(cell);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer || this.current === 'center') return;
      e.preventDefault();
      this.set(this.cellAt(e.clientX, e.clientY, false));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer) return;
      if (this.current === 'center' && this.flying) {
        this.input.sneak = false;
        this.cells.get('center')!.classList.remove('pressed');
      }
      this.pointer = null;
      this.set(null);
      if (this.sprintByTap) {
        this.input.sprint = false;
        this.sprintByTap = false;
      }
    };
    this.root.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Case sous le doigt (grille 3x3 centrée sur la croix). */
  private cellAt(x: number, y: number, start: boolean): Cell {
    const r = this.root.getBoundingClientRect();
    const cx = Math.floor(((x - r.left) / r.width) * 3), cy = Math.floor(((y - r.top) / r.height) * 3);
    if (!start) {
      // en glissant, on garde une direction même un peu hors de la croix
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d < r.width / 6) return this.current === 'center' ? 'center' : null;
      if (d > r.width * 1.2) return null;
      const a = Math.atan2(-dy, dx);
      const deg = (a * 180) / Math.PI;
      if (deg > 112.5 && deg <= 157.5) return this.current === 'up' || this.current === 'upleft' || this.current === 'upright' ? 'upleft' : 'left';
      if (deg > 22.5 && deg <= 67.5) return this.current === 'up' || this.current === 'upleft' || this.current === 'upright' ? 'upright' : 'right';
      if (deg > 67.5 && deg <= 112.5) return 'up';
      if (deg > -45 && deg <= 22.5) return 'right';
      if (deg > 157.5 || deg <= -135) return 'left';
      return 'down';
    }
    const map: (Cell)[][] = [
      ['upleft', 'up', 'upright'],
      ['left', 'center', 'right'],
      [null, 'down', null],
    ];
    const c = map[cy]?.[cx] ?? null;
    if ((c === 'upleft' || c === 'upright') && start) return 'up';
    return c;
  }

  private set(cell: Cell) {
    if (cell === this.current) return;
    if (this.current) this.cells.get(this.current)?.classList.remove('pressed');
    this.current = cell;
    if (cell && cell !== 'center') this.cells.get(cell)!.classList.add('pressed');
    const forward = cell === 'up' || cell === 'upleft' || cell === 'upright';
    this.root.classList.toggle('forward', forward);
    const d = cell && cell !== 'center' ? DIRS[cell] : [0, 0];
    this.input.moveX = d[0];
    this.input.moveY = d[1];
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
    if (!v) this.release();
  }

  setScale(k: number, leftHanded: boolean) {
    const size = Math.round(168 * k);
    this.root.style.width = this.root.style.height = `${size}px`;
    this.root.style.left = leftHanded ? '' : `calc(var(--safe-left) + ${Math.round(16 * k)}px)`;
    this.root.style.right = leftHanded ? `calc(var(--safe-right) + ${Math.round(16 * k)}px)` : '';
    this.root.style.fontSize = `${Math.round(22 * k)}px`;
  }

  private flying = false;
  /** En vol : la case centrale devient « descendre ». */
  setFlying(on: boolean) {
    this.flying = on;
    this.cells.get('center')!.style.backgroundImage = touchIcon(on ? 'down' : 'sneak');
    if (on) this.cells.get('center')!.classList.remove('active');
  }

  syncSneak() {
    this.cells.get('center')!.classList.toggle('active', this.input.sneak);
  }

  release() {
    this.pointer = null;
    this.set(null);
  }
}
