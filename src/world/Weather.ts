import { lerp } from '../util/math';

export type WeatherState = 'clear' | 'rain' | 'storm';

/**
 * Météo : alternance dégagé / pluie / orage. La forme (pluie ou neige) dépend du biome
 * du joueur ; les biomes arides (désert, savane) n'ont pas de précipitations.
 */
export class Weather {
  state: WeatherState = 'clear';
  timer = 240 + Math.random() * 300;
  intensity = 0; // 0..1 lissé
  flash = 0;
  private boltTimer = 6;
  onThunder: (delay: number) => void = () => {};

  update(dt: number, biomeAllows: boolean) {
    this.timer -= dt;
    if (this.timer <= 0) {
      const r = Math.random();
      if (this.state === 'clear') {
        this.state = r < 0.25 ? 'storm' : 'rain';
        this.timer = 90 + Math.random() * 180;
      } else {
        this.state = 'clear';
        this.timer = 300 + Math.random() * 600;
      }
    }
    const target = this.state === 'clear' || !biomeAllows ? 0 : this.state === 'storm' ? 1 : 0.7;
    this.intensity = lerp(this.intensity, target, Math.min(1, dt * 0.25));
    this.flash = Math.max(0, this.flash - dt * 3);
    if (this.state === 'storm' && biomeAllows && this.intensity > 0.6) {
      this.boltTimer -= dt;
      if (this.boltTimer <= 0) {
        this.boltTimer = 5 + Math.random() * 15;
        this.flash = 1;
        this.onThunder(0.3 + Math.random() * 1.5);
      }
    }
  }

  get raining() {
    return this.intensity > 0.2;
  }
  /** Facteur d'assombrissement de la lumière du jour. */
  get dim() {
    return 1 - this.intensity * (this.state === 'storm' ? 0.45 : 0.3);
  }

  serialize() {
    return { state: this.state, timer: this.timer };
  }
  load(d: { state: WeatherState; timer: number }) {
    this.state = d.state;
    this.timer = d.timer;
    this.intensity = d.state === 'clear' ? 0 : 0.7;
  }
}
