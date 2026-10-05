/** État d'entrée abstrait, alimenté par le tactile ou le clavier/souris. */
export class InputState {
  moveX = 0; // droite +
  moveY = 0; // avant +
  lookDX = 0; // pixels accumulés depuis la dernière frame
  lookDY = 0;
  jump = false;
  sneak = false;
  sprint = false;
  /** Maintenu : miner / attaquer. */
  attack = false;
  /** Maintenu : utiliser (placement continu). */
  useHeld = false;
  /** Événements ponctuels (consommés par le jeu). */
  private queue: string[] = [];
  /** Source de la dernière entrée (pour l'interface). */
  mode: 'touch' | 'keyboard' = 'touch';

  push(ev: 'use' | 'attackTap' | 'inventory' | 'pause' | 'drop' | 'debug' | `slot:${number}` | 'slotNext' | 'slotPrev') {
    this.queue.push(ev);
  }
  consume(): string[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }
  reset() {
    this.moveX = this.moveY = 0;
    this.lookDX = this.lookDY = 0;
    this.jump = this.attack = this.useHeld = false;
    this.queue = [];
  }
}
