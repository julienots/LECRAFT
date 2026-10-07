/**
 * Boucle principale (requestAnimationFrame) avec limitation de FPS (30/45/60)
 * et dt borné pour éviter les sauts après une mise en arrière-plan.
 */
export class GameLoop {
  private running = false;
  private last = 0;
  private acc = 0;
  private raf = 0;
  fpsCap = 60;

  constructor(private frame: (dt: number) => void) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const elapsed = now - this.last;
      const minFrame = 1000 / this.fpsCap - 1.5;
      this.acc += elapsed;
      this.last = now;
      if (this.fpsCap < 60 && this.acc < minFrame) return;
      const dt = Math.min(0.25, this.acc / 1000);
      this.acc = 0;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
