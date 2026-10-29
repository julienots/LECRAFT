import { bedrockScale } from '../ui/Bedrock';

/**
 * Joystick virtuel de l'édition mobile : un carré translucide fixe en bas à gauche avec un petit
 * carré mobile. Le déplacement se mesure à partir de l'endroit où le doigt se pose dans la moitié
 * gauche de l'écran (le carré suit le doigt sans bouger lui-même).
 */
export class VirtualJoystick {
  readonly base: HTMLDivElement;
  readonly knob: HTMLDivElement;
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  /** Rayon de course du doigt (pixels écran) et débattement visuel du petit carré. */
  private reach = 96;
  private travel = 114;
  x = 0;
  y = 0;

  constructor(private parent: HTMLElement, size = 120) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    this.parent.appendChild(this.base);
    this.layout(size, false);
  }

  /** Taille et position (dimensions mesurées sur le jeu original : carré de 79, bouton de 39). */
  layout(size: number, leftHanded: boolean) {
    const u = bedrockScale(), k = size / 120;
    const pad = 79 * u * k;
    this.base.style.width = this.base.style.height = `${pad}px`;
    this.base.style.bottom = `${69 * u}px`;
    this.base.style.top = 'auto';
    this.base.style.left = leftHanded ? 'auto' : `${40 * u}px`;
    this.base.style.right = leftHanded ? `${40 * u}px` : 'auto';
    this.knob.style.width = this.knob.style.height = `${pad * 0.49}px`;
    this.reach = 32 * u * k;
    this.travel = pad * 0.48;
  }

  setShown(on: boolean) {
    this.base.style.display = on ? 'block' : 'none';
  }

  get active() {
    return this.pointerId !== null;
  }

  start(id: number, cx: number, cy: number) {
    this.pointerId = id;
    this.ox = cx;
    this.oy = cy;
    this.move(id, cx, cy);
  }

  move(id: number, cx: number, cy: number) {
    if (id !== this.pointerId) return false;
    let dx = cx - this.ox, dy = cy - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > this.reach) {
      dx = (dx / d) * this.reach;
      dy = (dy / d) * this.reach;
    }
    const dead = 0.12;
    const nx = dx / this.reach, ny = -dy / this.reach;
    const mag = Math.hypot(nx, ny);
    const k = mag < dead ? 0 : (mag - dead) / (1 - dead) / mag;
    this.x = nx * k;
    this.y = ny * k;
    this.knob.style.transform = `translate(${nx * this.travel}px, ${-ny * this.travel}px)`;
    return true;
  }

  end(id: number) {
    if (id !== this.pointerId) return false;
    this.pointerId = null;
    this.reset();
    return true;
  }

  /** Remet le petit carré au centre (fin de toucher, pause, ouverture d'un écran). */
  reset() {
    this.pointerId = null;
    this.x = this.y = 0;
    this.knob.style.transform = '';
  }

  dispose() {
    this.base.remove();
  }
}
