/**
 * Synthèse procédurale des effets sonores (aucun fichier audio externe : 100 % original, hors ligne).
 * Chaque recette produit un Float32Array mono.
 */
type Gen = (t: number, i: number) => number;

class Rand {
  constructor(private s = 12345) {}
  next() {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
}

export class SynthContext {
  constructor(readonly sr: number) {}

  buf(dur: number, gen: Gen): Float32Array {
    const n = Math.max(1, Math.floor(dur * this.sr));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = gen(i / this.sr, i);
    return out;
  }

  /** Bruit filtré (passe-bas/haut à un pôle) avec enveloppe exponentielle. */
  noise(dur: number, opts: { lp?: number; hp?: number; decay?: number; attack?: number; gain?: number; seed?: number; crackle?: number }) {
    const r = new Rand(opts.seed ?? 7);
    const lpA = opts.lp ? Math.exp((-2 * Math.PI * opts.lp) / this.sr) : 0;
    const hpA = opts.hp ? Math.exp((-2 * Math.PI * opts.hp) / this.sr) : 0;
    let lp = 0, hpPrev = 0, hpOut = 0;
    const decay = opts.decay ?? 10, attack = opts.attack ?? 0.003, gain = opts.gain ?? 1;
    return this.buf(dur, (t) => {
      let v = r.next() * 2 - 1;
      if (opts.crackle && r.next() > opts.crackle) v *= 0.1;
      if (opts.lp) v = lp = lp * lpA + v * (1 - lpA);
      if (opts.hp) {
        hpOut = hpA * (hpOut + v - hpPrev);
        hpPrev = v;
        v = hpOut;
      }
      const env = Math.min(1, t / attack) * Math.exp(-t * decay);
      return v * env * gain;
    });
  }

  tone(dur: number, f0: number, f1: number, opts: { wave?: 'sine' | 'saw' | 'square' | 'tri'; decay?: number; attack?: number; gain?: number; vibrato?: number; vibRate?: number }) {
    let ph = 0;
    const wave = opts.wave ?? 'sine', decay = opts.decay ?? 4, attack = opts.attack ?? 0.01, gain = opts.gain ?? 0.6;
    return this.buf(dur, (t) => {
      const k = t / dur;
      const f = f0 * Math.pow(f1 / f0, k) * (1 + (opts.vibrato ?? 0) * Math.sin(2 * Math.PI * (opts.vibRate ?? 6) * t));
      ph += f / this.sr;
      const p = ph % 1;
      let v: number;
      switch (wave) {
        case 'saw': v = 2 * p - 1; break;
        case 'square': v = p < 0.5 ? 1 : -1; break;
        case 'tri': v = 4 * Math.abs(p - 0.5) - 1; break;
        default: v = Math.sin(2 * Math.PI * p);
      }
      return v * Math.min(1, t / attack) * Math.exp(-t * decay) * gain;
    });
  }

  /** Corde pincée (Karplus-Strong). */
  pluck(dur: number, freq: number, gain = 0.6) {
    const r = new Rand(3);
    const N = Math.max(2, Math.floor(this.sr / freq));
    const ring = new Float32Array(N).map(() => r.next() * 2 - 1);
    let idx = 0;
    return this.buf(dur, () => {
      const v = ring[idx];
      const nxt = ring[(idx + 1) % N];
      ring[idx] = (v + nxt) * 0.5 * 0.996;
      idx = (idx + 1) % N;
      return v * gain;
    });
  }

  mix(...parts: { buf: Float32Array; at?: number; gain?: number }[]) {
    const len = Math.max(...parts.map((p) => p.buf.length + Math.floor((p.at ?? 0) * this.sr)));
    const out = new Float32Array(len);
    for (const p of parts) {
      const off = Math.floor((p.at ?? 0) * this.sr), g = p.gain ?? 1;
      for (let i = 0; i < p.buf.length; i++) out[off + i] += p.buf[i] * g;
    }
    return out;
  }

  /** Boucle d'ambiance avec fondu enchaîné aux extrémités pour éviter les clics. */
  loop(dur: number, gen: Gen) {
    const b = this.buf(dur, gen);
    const f = Math.floor(0.05 * this.sr);
    for (let i = 0; i < f; i++) {
      const k = i / f;
      b[i] = b[i] * k + b[b.length - f + i] * (1 - k);
    }
    return b.slice(0, b.length - f);
  }
}

export type MaterialSound = 'stone' | 'dirt' | 'grass' | 'wood' | 'sand' | 'gravel' | 'glass' | 'leaves' | 'snow' | 'metal' | 'wool';

/** Recettes des effets sonores. */
export function buildSounds(s: SynthContext): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = {};
  const mat: Record<MaterialSound, (dur: number, g: number, seed: number) => Float32Array> = {
    stone: (d, g, sd) => s.mix({ buf: s.noise(d, { lp: 2200, hp: 200, decay: 22, gain: g, seed: sd }) }, { buf: s.tone(d, 180, 120, { decay: 30, gain: g * 0.3 }) }),
    dirt: (d, g, sd) => s.noise(d, { lp: 700, decay: 18, gain: g * 1.4, seed: sd }),
    grass: (d, g, sd) => s.noise(d, { lp: 3500, hp: 800, decay: 16, gain: g, seed: sd, crackle: 0.6 }),
    wood: (d, g, sd) => s.mix({ buf: s.noise(d, { lp: 1200, decay: 25, gain: g * 0.7, seed: sd }) }, { buf: s.tone(d, 240, 200, { wave: 'tri', decay: 22, gain: g * 0.6 }) }),
    sand: (d, g, sd) => s.noise(d, { lp: 5000, hp: 1500, decay: 14, gain: g * 0.8, seed: sd }),
    gravel: (d, g, sd) => s.noise(d, { lp: 1800, hp: 300, decay: 15, gain: g * 1.2, seed: sd, crackle: 0.45 }),
    glass: (d, g, sd) => s.mix({ buf: s.noise(d, { hp: 3000, decay: 18, gain: g * 0.6, seed: sd }) }, { buf: s.tone(d, 2400, 2300, { decay: 12, gain: g * 0.25 }) }, { buf: s.tone(d, 3300, 3100, { decay: 15, gain: g * 0.2 }), at: 0.02 }),
    leaves: (d, g, sd) => s.noise(d, { lp: 4500, hp: 1200, decay: 12, gain: g * 0.8, seed: sd, crackle: 0.5 }),
    snow: (d, g, sd) => s.noise(d, { lp: 1500, hp: 400, decay: 14, gain: g, seed: sd }),
    metal: (d, g, sd) => s.mix({ buf: s.noise(d, { hp: 1500, decay: 30, gain: g * 0.4, seed: sd }) }, { buf: s.tone(d * 2, 820, 800, { decay: 8, gain: g * 0.3 }) }, { buf: s.tone(d * 2, 1310, 1300, { decay: 9, gain: g * 0.2 }) }),
    wool: (d, g, sd) => s.noise(d, { lp: 500, decay: 25, gain: g, seed: sd }),
  };
  for (const [m, fn] of Object.entries(mat)) {
    out[`break_${m}`] = fn(0.28, 0.9, 11);
    out[`place_${m}`] = fn(0.14, 0.7, 23);
    out[`hit_${m}`] = fn(0.08, 0.45, 37);
    out[`step_${m}`] = fn(0.09, 0.3, 51);
  }
  out.moo = s.mix({ buf: s.tone(0.9, 140, 100, { wave: 'saw', decay: 1.5, attack: 0.08, gain: 0.25, vibrato: 0.03 }) }, { buf: s.noise(0.9, { lp: 300, decay: 2, gain: 0.2 }) });
  out.moo_hurt = s.tone(0.35, 180, 120, { wave: 'saw', decay: 5, gain: 0.3 });
  out.baa = s.tone(0.6, 320, 280, { wave: 'square', decay: 3, attack: 0.03, gain: 0.15, vibrato: 0.08, vibRate: 22 });
  out.oink = s.mix({ buf: s.tone(0.12, 220, 170, { wave: 'saw', decay: 10, gain: 0.3 }) }, { buf: s.tone(0.12, 230, 180, { wave: 'saw', decay: 10, gain: 0.3 }), at: 0.16 });
  out.oink_hurt = s.tone(0.25, 300, 200, { wave: 'saw', decay: 8, gain: 0.35 });
  out.cluck = s.mix({ buf: s.tone(0.06, 900, 700, { wave: 'square', decay: 30, gain: 0.15 }) }, { buf: s.tone(0.06, 950, 720, { wave: 'square', decay: 30, gain: 0.15 }), at: 0.09 });
  out.cluck_hurt = s.tone(0.18, 1200, 800, { wave: 'square', decay: 12, gain: 0.18 });
  out.groan = s.mix({ buf: s.tone(1.0, 95, 70, { wave: 'saw', decay: 1.6, attack: 0.15, gain: 0.25, vibrato: 0.04, vibRate: 4 }) }, { buf: s.noise(1.0, { lp: 400, decay: 2, gain: 0.25 }) });
  out.groan_hurt = s.tone(0.3, 140, 90, { wave: 'saw', decay: 7, gain: 0.35 });
  out.groan_death = s.tone(0.9, 120, 50, { wave: 'saw', decay: 3, gain: 0.35 });
  out.enderman_idle = s.tone(1.0, 180, 120, { wave: 'saw', decay: 2, attack: 0.2, gain: 0.18, vibrato: 0.2, vibRate: 9 });
  out.enderman_hurt = s.tone(0.4, 300, 160, { wave: 'saw', decay: 7, gain: 0.25, vibrato: 0.15, vibRate: 30 });
  out.enderman_scream = s.mix({ buf: s.tone(1.1, 900, 400, { wave: 'saw', decay: 2, gain: 0.25, vibrato: 0.25, vibRate: 40 }) }, { buf: s.noise(1.1, { hp: 1500, decay: 2, gain: 0.2 }) });
  out.enderman_tp = s.mix({ buf: s.tone(0.5, 200, 900, { wave: 'sine', decay: 5, gain: 0.25 }) }, { buf: s.noise(0.5, { lp: 2000, decay: 6, gain: 0.15 }) });
  out.bark = s.mix({ buf: s.tone(0.12, 420, 300, { wave: 'saw', decay: 14, gain: 0.3 }) }, { buf: s.noise(0.12, { lp: 1200, decay: 14, gain: 0.3 }) });
  out.whine = s.tone(0.5, 900, 700, { wave: 'sine', decay: 4, gain: 0.25, vibrato: 0.05, vibRate: 10 });
  out.squeak = s.tone(0.08, 3200, 2600, { wave: 'square', decay: 20, gain: 0.08 });
  // créatures ajoutées : hennissement, grognement, miaulement, gazouillis, bourdonnement
  out.neigh = s.mix({ buf: s.tone(0.7, 520, 380, { wave: 'saw', decay: 3, attack: 0.04, gain: 0.18, vibrato: 0.12, vibRate: 18 }) }, { buf: s.noise(0.7, { lp: 1400, hp: 300, decay: 4, gain: 0.12 }) });
  out.growl = s.mix({ buf: s.tone(0.8, 85, 60, { wave: 'saw', decay: 2, attack: 0.1, gain: 0.3, vibrato: 0.06, vibRate: 9 }) }, { buf: s.noise(0.8, { lp: 300, decay: 2.5, gain: 0.3 }) });
  out.meow = s.tone(0.35, 700, 520, { wave: 'tri', decay: 5, attack: 0.04, gain: 0.18, vibrato: 0.05, vibRate: 6 });
  out.chirp = s.mix({ buf: s.tone(0.07, 2600, 3400, { wave: 'sine', decay: 25, gain: 0.12 }) }, { buf: s.tone(0.07, 2800, 3600, { wave: 'sine', decay: 25, gain: 0.1 }), at: 0.1 });
  out.buzz = s.tone(0.6, 210, 200, { wave: 'saw', decay: 2, attack: 0.1, gain: 0.08, vibrato: 0.04, vibRate: 30 });
  out.snow = s.noise(0.2, { lp: 1500, hp: 400, decay: 14, gain: 0.5 });
  // Pâte à papier : froissement, déchirure, gribouillis au crayon, avion qui fend l'air
  out.paper_rustle = s.noise(0.35, { lp: 6000, hp: 1800, decay: 8, gain: 0.35, crackle: 0.7 });
  out.paper_tear = s.mix({ buf: s.noise(0.3, { lp: 5000, hp: 900, decay: 9, gain: 0.5, crackle: 0.9 }) }, { buf: s.noise(0.15, { lp: 2500, hp: 600, decay: 14, gain: 0.3, crackle: 0.5 }), at: 0.12 });
  out.scribble = s.mix({ buf: s.noise(0.12, { lp: 4000, hp: 1200, decay: 12, gain: 0.3, crackle: 0.4 }) }, { buf: s.noise(0.12, { lp: 4200, hp: 1400, decay: 12, gain: 0.3, crackle: 0.4 }), at: 0.16 }, { buf: s.noise(0.12, { lp: 3800, hp: 1100, decay: 12, gain: 0.3, crackle: 0.4 }), at: 0.32 });
  out.paper_whoosh = s.noise(0.6, { lp: 1800, hp: 300, decay: 4, attack: 0.15, gain: 0.3 });
  out.cackle = s.mix(...[0, 0.09, 0.18, 0.27].map((at) => ({ buf: s.tone(0.08, 700, 500, { wave: 'saw', decay: 15, gain: 0.2 }), at })));
  out.hmm = s.tone(0.45, 160, 140, { wave: 'saw', decay: 3, attack: 0.05, gain: 0.25, vibrato: 0.05, vibRate: 6 });
  out.hmm_hurt = s.tone(0.3, 220, 150, { wave: 'saw', decay: 8, gain: 0.3 });
  out.villager_yes = s.mix({ buf: s.tone(0.18, 170, 190, { wave: 'saw', decay: 8, gain: 0.25 }) }, { buf: s.tone(0.18, 200, 220, { wave: 'saw', decay: 8, gain: 0.25 }), at: 0.2 });
  out.dragon_growl = s.mix({ buf: s.tone(2.2, 90, 50, { wave: 'saw', decay: 1, attack: 0.3, gain: 0.35, vibrato: 0.15, vibRate: 7 }) }, { buf: s.noise(2.2, { lp: 600, decay: 1.2, attack: 0.3, gain: 0.35 }) });
  out.dragon_hurt = s.mix({ buf: s.tone(0.7, 160, 80, { wave: 'saw', decay: 4, gain: 0.35 }) }, { buf: s.noise(0.7, { lp: 900, decay: 4, gain: 0.3 }) });
  out.dragon_death = s.mix({ buf: s.tone(4, 120, 30, { wave: 'saw', decay: 0.6, attack: 0.2, gain: 0.4, vibrato: 0.2, vibRate: 5 }) }, { buf: s.noise(4, { lp: 700, decay: 0.7, gain: 0.4 }) });
  out.wither_idle = s.mix({ buf: s.tone(1.4, 110, 80, { wave: 'saw', decay: 1.5, attack: 0.2, gain: 0.25, vibrato: 0.2, vibRate: 11 }) }, { buf: s.noise(1.4, { lp: 500, decay: 1.6, gain: 0.25 }) });
  out.wither_hurt = s.mix({ buf: s.tone(0.5, 220, 120, { wave: 'saw', decay: 6, gain: 0.3, vibrato: 0.2, vibRate: 25 }) }, { buf: s.noise(0.5, { hp: 800, decay: 6, gain: 0.25 }) });
  out.wither_death = s.mix({ buf: s.tone(3, 160, 40, { wave: 'saw', decay: 0.8, gain: 0.4, vibrato: 0.3, vibRate: 6 }) }, { buf: s.noise(3, { lp: 600, decay: 0.9, gain: 0.4 }) });
  out.wither_spawn = s.mix({ buf: s.tone(2.5, 60, 30, { wave: 'saw', decay: 1, gain: 0.45 }) }, { buf: s.noise(2.5, { lp: 400, decay: 1.2, gain: 0.5, crackle: 0.3 }) });
  out.wither_shoot = s.mix({ buf: s.tone(0.4, 300, 150, { wave: 'saw', decay: 8, gain: 0.25 }) }, { buf: s.noise(0.4, { lp: 1500, decay: 8, gain: 0.2 }) });
  out.portal = s.mix({ buf: s.tone(2.4, 70, 140, { wave: 'saw', decay: 0.6, attack: 0.6, gain: 0.18, vibrato: 0.12, vibRate: 3 }) }, { buf: s.noise(2.4, { lp: 900, decay: 0.8, attack: 0.5, gain: 0.25 }) });
  out.extinguish = s.noise(0.6, { hp: 1800, decay: 6, gain: 0.45, crackle: 0.3 });
  out.ghast_moan = s.tone(1.6, 520, 380, { wave: 'tri', decay: 1.5, attack: 0.25, gain: 0.22, vibrato: 0.06, vibRate: 6 });
  out.ghast_hurt = s.tone(0.6, 900, 600, { wave: 'tri', decay: 5, gain: 0.3, vibrato: 0.1, vibRate: 12 });
  out.ghast_shoot = s.mix({ buf: s.tone(0.5, 700, 300, { wave: 'saw', decay: 6, gain: 0.25 }) }, { buf: s.noise(0.5, { lp: 1200, decay: 5, gain: 0.3 }) });
  out.grunt = s.mix({ buf: s.tone(0.35, 150, 110, { wave: 'saw', decay: 6, gain: 0.3, vibrato: 0.08, vibRate: 25 }) }, { buf: s.noise(0.35, { lp: 500, decay: 6, gain: 0.25 }) });
  out.grunt_hurt = s.tone(0.25, 220, 140, { wave: 'saw', decay: 9, gain: 0.35 });
  out.blaze_breath = s.noise(1.2, { lp: 700, decay: 1.4, attack: 0.3, gain: 0.3, crackle: 0.5 });
  out.blaze_hurt = s.mix({ buf: s.noise(0.3, { hp: 1200, decay: 9, gain: 0.35, crackle: 0.4 }) }, { buf: s.tone(0.3, 400, 260, { wave: 'square', decay: 9, gain: 0.15 }) });
  out.hiss = s.noise(0.5, { hp: 2500, decay: 5, gain: 0.35, attack: 0.05 });
  out.hiss_hurt = s.noise(0.25, { hp: 2000, decay: 10, gain: 0.45 });
  out.squish = s.mix({ buf: s.noise(0.25, { lp: 600, decay: 12, gain: 0.5 }) }, { buf: s.tone(0.2, 300, 120, { decay: 12, gain: 0.3 }) });
  out.rattle = s.mix(...[0, 0.05, 0.1, 0.16].map((at) => ({ buf: s.noise(0.04, { hp: 1500, lp: 4000, decay: 60, gain: 0.5, seed: at * 100 }), at })));
  out.growl = s.mix({ buf: s.tone(0.8, 70, 55, { wave: 'saw', decay: 2, attack: 0.1, gain: 0.3, vibrato: 0.1, vibRate: 18 }) }, { buf: s.noise(0.8, { lp: 300, decay: 2, gain: 0.4 }) });
  out.golem_idle = s.mix({ buf: s.noise(1.4, { lp: 150, decay: 1.5, gain: 1.2, attack: 0.2 }) }, { buf: s.tone(1.4, 50, 40, { wave: 'tri', decay: 1.5, gain: 0.4 }) });
  out.golem_death = s.mix({ buf: s.noise(2.5, { lp: 200, decay: 1.2, gain: 1.2 }) }, { buf: s.tone(2.5, 80, 30, { wave: 'saw', decay: 1.2, gain: 0.3 }) });
  out.lich_idle = s.mix({ buf: s.tone(1.5, 440, 430, { decay: 1.5, attack: 0.3, gain: 0.12, vibrato: 0.02, vibRate: 5 }) }, { buf: s.tone(1.5, 523, 515, { decay: 1.5, attack: 0.3, gain: 0.1 }) }, { buf: s.tone(1.5, 659, 650, { decay: 1.5, attack: 0.3, gain: 0.08 }) });
  out.lich_death = s.mix({ buf: s.tone(2, 880, 110, { decay: 1.5, gain: 0.25 }) }, { buf: s.noise(2, { hp: 3000, decay: 2, gain: 0.3 }) });
  out.whisper = s.noise(0.9, { lp: 2500, hp: 900, decay: 2, attack: 0.3, gain: 0.3 });
  out.roar = s.mix({ buf: s.tone(1.2, 160, 60, { wave: 'saw', decay: 1.6, attack: 0.05, gain: 0.35, vibrato: 0.05, vibRate: 25 }) }, { buf: s.noise(1.2, { lp: 900, decay: 2, gain: 0.5 }) });
  out.slam = s.mix({ buf: s.tone(0.8, 90, 35, { decay: 4, gain: 0.9 }) }, { buf: s.noise(0.8, { lp: 400, decay: 5, gain: 1 }) });
  out.glass_hit = mat.glass(0.15, 0.6, 5);
  out.glass_break = mat.glass(0.45, 0.9, 9);
  out.stone_hit = mat.stone(0.2, 0.9, 13);
  out.teleport = s.mix({ buf: s.tone(0.5, 300, 1600, { decay: 3, gain: 0.25 }) }, { buf: s.noise(0.5, { hp: 2000, decay: 4, gain: 0.2 }) });
  out.cast = s.mix({ buf: s.noise(0.4, { hp: 1200, lp: 6000, decay: 6, gain: 0.4 }) }, { buf: s.tone(0.4, 900, 1800, { decay: 6, gain: 0.15 }) });
  out.bow = s.mix({ buf: s.pluck(0.35, 180, 0.5) }, { buf: s.noise(0.15, { hp: 2000, decay: 20, gain: 0.3 }) });
  out.hit = s.mix({ buf: s.noise(0.12, { lp: 1200, decay: 30, gain: 0.8 }) }, { buf: s.tone(0.12, 160, 80, { decay: 25, gain: 0.5 }) });
  out.crit = s.mix({ buf: out.hit }, { buf: s.tone(0.25, 1800, 1700, { decay: 12, gain: 0.25 }) });
  out.hurt = s.mix({ buf: s.tone(0.22, 330, 200, { wave: 'tri', decay: 10, gain: 0.45 }) }, { buf: s.noise(0.15, { lp: 1500, decay: 20, gain: 0.4 }) });
  out.pop = s.tone(0.09, 520, 980, { decay: 25, gain: 0.35 });
  out.eat = s.mix(...[0, 0.12, 0.24].map((at, i) => ({ buf: s.noise(0.08, { lp: 2500, hp: 400, decay: 30, gain: 0.6, seed: i + 3, crackle: 0.5 }), at })));
  out.chest_open = s.mix({ buf: s.tone(0.35, 110, 160, { wave: 'saw', decay: 4, gain: 0.15, vibrato: 0.1, vibRate: 30 }) }, { buf: mat.wood(0.12, 0.6, 2), at: 0.25 });
  out.deny = s.tone(0.12, 200, 160, { wave: 'square', decay: 15, gain: 0.12 });
  out.click = s.tone(0.04, 1200, 900, { wave: 'tri', decay: 60, gain: 0.25 });
  out.levelup = s.mix(...[523, 659, 784, 1046].map((f, i) => ({ buf: s.tone(0.35, f, f, { wave: 'tri', decay: 6, gain: 0.25 }), at: i * 0.09 })));
  out.achievement = s.mix(...[784, 988, 1175, 1568].map((f, i) => ({ buf: s.tone(0.6, f, f, { decay: 4, gain: 0.2 }), at: i * 0.07 })));
  out.thunder = s.mix({ buf: s.noise(3.5, { lp: 180, decay: 1.1, attack: 0.02, gain: 2.2, seed: 99 }) }, { buf: s.noise(1.2, { lp: 900, decay: 4, gain: 0.8, seed: 98 }) });
  out.splash = s.noise(0.45, { lp: 3000, hp: 300, decay: 7, gain: 0.7 });
  out.swim = s.noise(0.3, { lp: 1200, hp: 200, decay: 8, gain: 0.3, attack: 0.05 });
  out.fizz = s.noise(0.5, { hp: 3000, decay: 6, gain: 0.4 });
  out.jump = s.noise(0.06, { lp: 900, decay: 40, gain: 0.25 });
  out.xp = s.mix({ buf: s.tone(0.12, 1400, 1700, { decay: 18, gain: 0.18 }) }, { buf: s.tone(0.1, 2100, 2300, { decay: 20, gain: 0.1 }), at: 0.03 });
  out.door_open = s.mix({ buf: s.noise(0.25, { lp: 900, hp: 120, decay: 9, gain: 0.5, crackle: 0.3 }) }, { buf: s.tone(0.22, 180, 260, { wave: 'saw', decay: 9, gain: 0.08 }) });
  out.door_close = s.mix({ buf: s.noise(0.18, { lp: 700, decay: 16, gain: 0.7 }) }, { buf: s.tone(0.12, 120, 80, { decay: 20, gain: 0.3 }) });
  out.explode = s.mix({ buf: s.noise(1.6, { lp: 500, decay: 2.2, gain: 1.4, crackle: 0.4 }) }, { buf: s.tone(1.2, 70, 25, { decay: 3, gain: 0.9 }) });
  out.fuse = s.noise(1.2, { hp: 3000, decay: 0.5, gain: 0.25, attack: 0.05, crackle: 0.6 });
  out.bucket_fill = s.mix({ buf: s.noise(0.35, { lp: 1800, hp: 300, decay: 6, gain: 0.5 }) }, { buf: s.tone(0.3, 300, 600, { decay: 8, gain: 0.12 }) });
  out.bucket_empty = s.mix({ buf: s.noise(0.4, { lp: 1600, hp: 200, decay: 5, gain: 0.5 }) }, { buf: s.tone(0.35, 600, 250, { decay: 7, gain: 0.12 }) });
  out.shear = s.mix({ buf: s.noise(0.08, { hp: 3500, decay: 40, gain: 0.5 }) }, { buf: s.noise(0.08, { hp: 3500, decay: 40, gain: 0.5 }), at: 0.1 });
  out.ignite = s.noise(0.3, { hp: 2500, lp: 7000, decay: 12, gain: 0.4, crackle: 0.8 });
  out.burp = s.tone(0.3, 160, 110, { wave: 'saw', decay: 6, gain: 0.25, vibrato: 0.1, vibRate: 30 });
  return out;
}

/** Boucles d'ambiance. */
export function buildAmbience(s: SynthContext): Record<string, Float32Array> {
  const r = new Rand(77);
  let lp = 0, lp2 = 0;
  const wind = s.loop(6, (t) => {
    const v = r.next() * 2 - 1;
    lp = lp * 0.985 + v * 0.015;
    return lp * (2.2 + Math.sin(t * 0.9) * 1.2 + Math.sin(t * 2.3) * 0.4);
  });
  const rain = s.loop(4, () => {
    const v = r.next() * 2 - 1;
    lp2 = lp2 * 0.6 + v * 0.4;
    return (v - lp2) * 0.35 + (r.next() > 0.9985 ? (r.next() - 0.5) * 1.4 : 0);
  });
  let lp3 = 0;
  const cave = s.loop(8, (t) => {
    const v = r.next() * 2 - 1;
    lp3 = lp3 * 0.995 + v * 0.005;
    const drip = Math.max(0, Math.sin(t * 1.3) > 0.999 ? 1 : 0);
    return lp3 * 6 + Math.sin(2 * Math.PI * 55 * t) * 0.04 + drip * Math.sin(2 * Math.PI * 1400 * t) * 0.3;
  });
  const crickets = s.loop(4, (t) => {
    const chirp = (Math.sin(t * 2 * Math.PI * 2.1) > 0.6 ? 1 : 0) * (Math.sin(t * 2 * Math.PI * 28) > 0 ? 1 : 0);
    return chirp * Math.sin(2 * Math.PI * 4300 * t) * 0.08 + (Math.sin(t * 2 * Math.PI * 1.3 + 1) > 0.85 ? 1 : 0) * Math.sin(2 * Math.PI * 3900 * t) * 0.05;
  });
  const birds = s.loop(8, (t) => {
    const ph = t % 2.7;
    if (ph > 0.35) return 0;
    const f = 2600 + Math.sin(ph * 40) * 500;
    return Math.sin(2 * Math.PI * f * t) * 0.07 * Math.sin((ph / 0.35) * Math.PI);
  });
  return { wind, rain, cave, crickets, birds };
}
