import { DAY_LENGTH_SECONDS } from '../core/Config';
import { clamp, smoothstep } from '../util/math';

export type DayPhase = 'aube' | 'jour' | 'crépuscule' | 'nuit';

/**
 * Cycle jour/nuit. time ∈ [0,1) : 0 = lever du soleil, 0.25 = midi, 0.5 = coucher, 0.75 = minuit.
 */
export class DayCycle {
  time = 0.05;
  day = 0;
  constructor(public lengthSeconds = DAY_LENGTH_SECONDS) {}

  update(dt: number) {
    this.time += dt / this.lengthSeconds;
    if (this.time >= 1) {
      this.time -= 1;
      this.day++;
    }
  }
  /** Hauteur du soleil (-1..1). */
  get sunHeight() {
    return Math.sin(this.time * Math.PI * 2);
  }
  /** Lumière du jour 0..1 (appliquée à la lumière du ciel). */
  get daylight() {
    return clamp(0.18 + 0.82 * smoothstep(-0.18, 0.3, this.sunHeight), 0.18, 1);
  }
  get isNight() {
    return this.sunHeight < -0.08;
  }
  get phase(): DayPhase {
    const t = this.time;
    if (t < 0.04 || t > 0.97) return 'aube';
    if (t < 0.46) return 'jour';
    if (t < 0.54) return 'crépuscule';
    return 'nuit';
  }
}
