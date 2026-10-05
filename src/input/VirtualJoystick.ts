/** Joystick virtuel dynamique : apparaît là où le doigt touche la zone gauche. */
export class VirtualJoystick {
  readonly base: HTMLDivElement;
  readonly knob: HTMLDivElement;
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  x = 0;
  y = 0;

  constructor(private parent: HTMLElement, public radius = 60) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    this.parent.appendChild(this.base);
    this.setSize(radius * 2);
    this.hide();
  }

  setSize(px: number) {
    this.radius = px / 2;
    this.base.style.width = this.base.style.height = `${px}px`;
    this.knob.style.width = this.knob.style.height = `${px * 0.42}px`;
  }

  get active() {
    return this.pointerId !== null;
  }

  start(id: number, cx: number, cy: number) {
    this.pointerId = id;
    this.ox = cx;
    this.oy = cy;
    this.base.style.left = `${cx - this.radius}px`;
    this.base.style.top = `${cy - this.radius}px`;
    this.base.style.display = 'block';
    this.move(id, cx, cy);
  }

  move(id: number, cx: number, cy: number) {
    if (id !== this.pointerId) return false;
    let dx = cx - this.ox, dy = cy - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      dx = (dx / d) * this.radius;
      dy = (dy / d) * this.radius;
    }
    const dead = 0.12;
    const nx = dx / this.radius, ny = -dy / this.radius;
    const mag = Math.hypot(nx, ny);
    const k = mag < dead ? 0 : (mag - dead) / (1 - dead) / mag;
    this.x = nx * k;
    this.y = ny * k;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    return true;
  }

  end(id: number) {
    if (id !== this.pointerId) return false;
    this.pointerId = null;
    this.x = this.y = 0;
    this.hide();
    return true;
  }

  hide() {
    this.base.style.display = 'none';
    this.knob.style.transform = '';
  }

  dispose() {
    this.base.remove();
  }
}
