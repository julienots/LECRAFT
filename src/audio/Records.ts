/**
 * Pistes des disques de musique : chaque disque a sa propre pièce, composée à la volée de façon
 * déterministe (même disque = même pièce), avec une identité proche de l'original — tempo, gamme,
 * instruments et durée — sans en reprendre la musique (art original, aucune piste du jeu de
 * référence n'est incluse) :
 *  - morceaux mélodiques (cat joyeux, blocks enjoué, stal jazzy, pigstep lourd…) ;
 *  - pistes d'ambiance faites de bruitages synthétisés (13 : grotte inquiétante, 11 : pas dans le
 *    gravier, respiration, course et grésillement du disque fendu, 5 : cité antique et sculk) ;
 *  - disques de LeCraft qui font peur (murmures, toc, signal perdu, gouffre).
 * La lecture (WebAudio, son positionnel) est faite par AudioManager (playRecord).
 */
import type { SynthContext } from './Synth';
import type { Voice } from './Music';
import { DISCS } from '../data/discs';

export type RecordVoice = Voice | 'pluck' | 'lead' | 'organ' | 'drone' | 'sfx';
export interface RecordNote {
  /** Début (secondes depuis le début de la piste). */
  t: number;
  /** Note MIDI (ignorée pour les bruitages). */
  n: number;
  dur: number;
  vel: number;
  voice: RecordVoice;
  /** Bruitage joué (voice = 'sfx') : nom d'un tampon de buildRecordSfx. */
  sfx?: string;
  /** Vitesse de lecture du bruitage (hauteur). */
  rate?: number;
  /** Position stéréo propre au son (-1 gauche, 1 droite), ajoutée à celle du juke-box. */
  pan?: number;
  /** Vibrato de la voix « lead » (fraction de la fréquence). */
  wob?: number;
}
export interface RecordPiece {
  disc: string;
  notes: RecordNote[];
  /** Durée totale (secondes) : le juke-box s'arrête à la fin, il ne boucle pas. */
  length: number;
}

/** Générateur pseudo-aléatoire déterministe. */
class Rand {
  constructor(private s: number) {}
  next() {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number) {
    return a + this.next() * (b - a);
  }
  int(a: number, b: number) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick<T>(l: readonly T[]): T {
    return l[Math.floor(this.next() * l.length)];
  }
}

const hashKey = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------- morceaux mélodiques ----------
type Chord = [number, number[]];
const MAJ = [0, 4, 7], MIN = [0, 3, 7], MAJ7 = [0, 4, 7, 11], MIN7 = [0, 3, 7, 10], DOM7 = [0, 4, 7, 10], MAJ9 = [0, 4, 7, 14], MIN9 = [0, 3, 7, 14], ADD9 = [0, 4, 7, 14], SUS2 = [0, 2, 7];
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10], MIXO = [0, 2, 4, 5, 7, 9, 10], LYDIAN = [0, 2, 4, 6, 7, 9, 11], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

interface SongStyle {
  bpm: number;
  /** Tonique (note MIDI de l'octave grave, ~48). */
  key: number;
  scale: number[];
  /** Progressions des parties A et B (un accord par mesure). */
  progA: Chord[];
  progB?: Chord[];
  melody: RecordVoice | 'none';
  chords: 'pad' | 'piano' | 'organ' | 'pluck' | 'none';
  chordStyle: 'block' | 'arp' | 'stab' | 'pad';
  bass: 'long' | 'walk' | 'pulse' | 'none';
  drums: 'none' | 'soft' | 'beat' | 'four' | 'swing' | 'hiphop';
  density: number;
  /** Hauteur centrale de la mélodie. */
  center: number;
  beats?: 3 | 4;
  /** Croches inégales (0,5 = droites, 0,66 = ternaires). */
  swing?: number;
  /** Petites notes de cloche au-dessus de la mélodie. */
  sparkle?: boolean;
  /** Vibrato de la voix « lead ». */
  wob?: number;
  /** Graine du thème (deux disques peuvent partager un thème : creator / music box). */
  themeSeed?: number;
}

/** Compose un morceau mélodique de `length` secondes (intro, A, A', B, … , coda). */
function song(st: SongStyle, length: number, seed: number, notes: RecordNote[] = [], start = 0) {
  const r = new Rand(seed);
  const tr = new Rand(st.themeSeed ?? seed ^ 0x9e3779b9);
  const beat = 60 / st.bpm;
  const beats = st.beats ?? 4;
  const bar = beats * beat;
  const swing = st.swing ?? 0.5;
  const eighth = (i: number) => (i % 2 === 0 ? 0 : (swing - 0.5) * 2 * beat * 0.5) + i * beat * 0.5;
  const scaleNotes: number[] = [];
  for (let o = -1; o <= 4; o++) for (const s of st.scale) scaleNotes.push(st.key + o * 12 + s);
  const nearest = (n: number, pool: number[]) => pool.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), pool[0]);
  const push = (n: RecordNote) => {
    if (n.t >= start && n.t < start + length - 0.3) notes.push({ ...n, dur: Math.min(n.dur, start + length - 0.2 - n.t) });
  };
  // thèmes : rythme (en temps, sur deux mesures) et pas dans la gamme
  const RHYTHMS4 = [[1, 1, 2, 1, 1, 2], [1.5, 0.5, 1, 1, 2, 2], [0.5, 0.5, 1, 2, 1, 1, 2], [2, 1, 1, 1.5, 0.5, 2], [1, 0.5, 0.5, 2, 1, 1, 2]];
  const RHYTHMS3 = [[2, 1, 3], [1, 1, 1, 2, 1], [1.5, 0.5, 1, 3], [3, 2, 1]];
  const theme = () => {
    const rhythm = tr.pick(beats === 3 ? RHYTHMS3 : RHYTHMS4);
    const steps = [0];
    for (let i = 1; i < rhythm.length; i++) steps.push(steps[i - 1] + tr.pick([-2, -1, -1, 1, 1, 2, 3, -3, 0, 2]));
    return { rhythm, steps };
  };
  const themes = [theme(), theme(), theme()];
  const chordAt = (prog: Chord[], b: number) => prog[b % prog.length];
  const chordBar = (c: Chord, at: number, vel: number, b: number) => {
    const root = st.key + c[0];
    const tones = c[1].map((iv) => root + 12 + iv);
    // basse
    if (st.bass === 'long') push({ t: at, n: root + (c[0] > 6 ? -12 : 0), dur: bar * 1.02, vel: vel * 0.85, voice: 'bass' });
    else if (st.bass === 'pulse') for (let i = 0; i < beats * 2; i++) push({ t: at + i * beat * 0.5, n: root + (c[0] > 6 ? -12 : 0), dur: beat * 0.45, vel: vel * (i % 2 ? 0.55 : 0.8), voice: 'bass' });
    else if (st.bass === 'walk') {
      const walk = [0, c[1][1], c[1][2], r.pick([c[1][1] + 2, 12 - 1, c[1][2] + 2])];
      for (let i = 0; i < beats; i++) push({ t: at + i * beat, n: root + (c[0] > 6 ? -12 : 0) + walk[i % walk.length], dur: beat * 0.9, vel: vel * 0.75, voice: 'bass' });
    }
    // accords
    if (st.chords === 'none') return;
    const v: RecordVoice = st.chords;
    if (st.chordStyle === 'pad' || st.chords === 'pad') for (const n of tones) push({ t: at, n, dur: bar * 1.05, vel: vel * 0.5, voice: v === 'pad' ? 'pad' : v });
    else if (st.chordStyle === 'block') for (const n of tones) push({ t: at + r.next() * 0.02, n, dur: bar * 0.95, vel: vel * 0.45, voice: v });
    else if (st.chordStyle === 'stab')
      for (let i = 0; i < beats; i++) {
        if (i % 2 === 0 && beats === 4) continue;
        for (const n of tones) push({ t: at + i * beat + (st.drums === 'swing' ? 0 : beat * 0.5 * (b % 2)), n, dur: beat * 0.4, vel: vel * 0.42, voice: v });
      }
    else {
      const pattern = r.pick([[0, 1, 2, 3, 2, 1, 2, 1], [0, 2, 1, 3, 0, 2, 1, 3], [0, 1, 2, 1, 3, 2, 1, 2]]);
      const steps = beats * 2;
      for (let i = 0; i < steps; i++) push({ t: at + eighth(i), n: tones[pattern[i % pattern.length] % tones.length] + (i >= steps / 2 && b % 2 ? 12 : 0), dur: beat * 1.2, vel: vel * (i === 0 ? 0.6 : 0.42), voice: v });
    }
  };
  const drumBar = (at: number, vel: number, fill: boolean) => {
    const d = st.drums;
    if (d === 'none') return;
    const hit = (t: number, sfx: string, v: number, rate = 1) => push({ t: at + t, n: 0, dur: 0.3, vel: vel * v, voice: 'sfx', sfx, rate });
    if (d === 'soft') {
      hit(0, 'kick', 0.5);
      for (let i = 0; i < beats; i++) hit(i * beat, 'hat', 0.25 + (i % 2) * 0.1, 1.1);
      if (beats === 4) hit(2 * beat, 'snare', 0.25, 1.2);
    } else if (d === 'four') {
      for (let i = 0; i < beats; i++) {
        hit(i * beat, 'kick', 0.75);
        hit(eighth(i * 2 + 1), 'hat', 0.35);
      }
      hit(beat, 'snare', 0.55);
      if (beats === 4) hit(3 * beat, 'snare', fill ? 0.7 : 0.55);
    } else if (d === 'beat') {
      hit(0, 'kick', 0.75);
      hit(2.5 * beat, 'kick', 0.55);
      hit(beat, 'snare', 0.6);
      hit(3 * beat, 'snare', 0.6);
      for (let i = 0; i < 8; i++) hit(eighth(i), 'hat', i % 2 ? 0.22 : 0.32);
      if (fill) for (let i = 0; i < 4; i++) hit(3 * beat + i * beat * 0.25, 'snare', 0.3 + i * 0.1, 1 + i * 0.05);
    } else if (d === 'swing') {
      for (let i = 0; i < beats; i++) hit(i * beat, 'hat', 0.3, 0.9);
      for (let i = 0; i < beats; i += 2) hit(i * beat + beat * 0.66 + beat, 'hat', 0.22, 0.9);
      hit(0, 'kick', 0.35);
      hit(beat, 'snare', 0.18, 0.8);
      hit(3 * beat, 'snare', 0.18, 0.8);
    } else if (d === 'hiphop') {
      hit(0, 'kick', 0.9, 0.9);
      hit(0.75 * beat, 'kick', 0.5, 0.9);
      hit(2.5 * beat, 'kick', 0.7, 0.9);
      hit(beat, 'snare', 0.8, 0.85);
      hit(3 * beat, 'snare', 0.8, 0.85);
      for (let i = 0; i < 8; i++) hit(eighth(i), 'hat', i % 2 ? 0.2 : 0.3, 1.05);
    }
  };
  const melodyBars = (th: { rhythm: number[]; steps: number[] }, at: number, prog: Chord[], b0: number, vary: boolean, octave: number) => {
    if (st.melody === 'none') return;
    const c = chordAt(prog, b0);
    const chordTones = c[1].map((iv) => st.key + c[0] + 12 + iv).flatMap((x) => [x, x + 12, x + 24]);
    const pool = scaleNotes.filter((n) => Math.abs(n - st.center - octave) <= 10);
    const anchor = nearest(st.center + octave, chordTones);
    const idx0 = pool.indexOf(nearest(anchor, pool));
    const tonesOf = (k: number) => {
      const ck = chordAt(prog, k);
      return ck[1].map((iv) => st.key + ck[0] + 12 + iv).flatMap((x) => [x, x + 12, x + 24]);
    };
    let pos = 0;
    let secondBar = false;
    th.rhythm.forEach((len, i) => {
      const p = pos;
      pos += len;
      if (p >= 2 * beats - 0.01) return;
      if (i > 0 && r.next() > st.density + 0.2) return;
      let step = th.steps[i];
      if (vary && i >= th.rhythm.length - 2) step += r.pick([-1, 1, 2]);
      let n = pool[Math.max(0, Math.min(pool.length - 1, idx0 + step))];
      if (i === 0) n = nearest(n, chordTones);
      // première note de la deuxième mesure : sur l'accord suivant
      if (p >= beats - 0.01 && !secondBar) {
        secondBar = true;
        n = nearest(n, tonesOf(b0 + 1));
      }
      // croches inégales (swing) : les contretemps sont retardés
      const off = Math.abs((p * 2) % 2 - 1) < 0.01 ? (swing - 0.5) * beat : 0;
      const t = at + p * beat + off;
      push({ t, n, dur: Math.max(beat * 0.6, len * beat * 1.3), vel: 0.6 + r.next() * 0.25, voice: st.melody as RecordVoice, wob: st.wob });
      if (st.sparkle && r.next() < 0.18) push({ t: t + beat * 0.5, n: n + 12, dur: beat, vel: 0.3, voice: 'bell' });
    });
  };

  const tail = bar * 2.5;
  const nBars = Math.max(4, Math.floor((length - tail) / bar));
  let t = start;
  // intro : deux mesures d'accords
  for (let b = 0; b < 2; b++) {
    chordBar(chordAt(st.progA, b), t, 0.5, b);
    if (b === 1) drumBar(t, 0.6, true);
    t += bar;
  }
  let b = 2;
  // parties de 8 mesures : A, A', B, A'', B', …
  const plan = ['A', 'A2', 'B', 'A3', 'B2', 'A', 'B', 'A2'];
  let part = 0;
  while (b < nBars) {
    const name = plan[part % plan.length];
    const isB = name.startsWith('B') && !!st.progB;
    const prog = isB ? st.progB! : st.progA;
    const th = themes[isB ? 1 : name === 'A3' ? 2 : 0];
    const len = Math.min(8, nBars - b);
    for (let i = 0; i < len; i++) {
      chordBar(chordAt(prog, i), t + i * bar, isB ? 0.45 : 0.5, i);
      drumBar(t + i * bar, part === 0 && i < 4 ? 0.7 : 1, i === len - 1);
      if (i % 2 === 0 && i + 1 < len) melodyBars(th, t + i * bar, prog, i, name !== 'A' || i >= 4, isB ? 5 : 0);
    }
    t += len * bar;
    b += len;
    part++;
  }
  // coda : tonique tenue jusqu'à la fin de la piste
  const end = start + length;
  const tonic: Chord = [0, st.progA[0][1]];
  const root = st.key;
  for (const iv of tonic[1]) push({ t, n: root + 12 + iv, dur: end - t - 0.3, vel: 0.35, voice: st.chords === 'none' || st.chords === 'pluck' ? 'pad' : st.chords });
  if (st.bass !== 'none') push({ t, n: root, dur: end - t - 0.3, vel: 0.4, voice: 'bass' });
  if (st.melody !== 'none') push({ t: t + beat, n: nearest(st.center, scaleNotes.filter((n) => (n - st.key) % 12 === 0)), dur: end - t - beat - 0.3, vel: 0.45, voice: st.melody });
  return notes;
}

// ---------- pistes d'ambiance et bruitages ----------
/** Ajoute un bruitage. */
const fx = (notes: RecordNote[], t: number, sfx: string, vel: number, rate = 1, pan = 0) => notes.push({ t, n: 0, dur: 0.5, vel, voice: 'sfx', sfx, rate, pan });

/** Grésillement du disque (tampon de 2 s répété) entre deux instants. */
function crackleBed(notes: RecordNote[], from: number, to: number, vel: number) {
  for (let t = from; t < to - 0.05; t += 2) notes.push({ t, n: 0, dur: Math.min(2, to - t), vel, voice: 'sfx', sfx: 'crackle', rate: 1 });
}

/** Battements de cœur dont le tempo passe de bpm0 à bpm1. */
function heartbeat(notes: RecordNote[], from: number, to: number, bpm0: number, bpm1: number, vel0: number, vel1: number) {
  let t = from;
  while (t < to) {
    const k = (t - from) / Math.max(0.01, to - from);
    fx(notes, t, 'heartbeat', vel0 + (vel1 - vel0) * k, 1 + k * 0.08);
    t += 60 / (bpm0 + (bpm1 - bpm0) * k);
  }
}

/** Pas (gravier, bois) réguliers de `from` à `to`. */
function steps(notes: RecordNote[], r: Rand, from: number, to: number, every: number, sfx: string, vel0: number, vel1 = vel0, pan = 0) {
  let i = 0;
  for (let t = from; t < to; t += every * r.range(0.92, 1.08), i++) {
    const k = (t - from) / Math.max(0.01, to - from);
    fx(notes, t, `${sfx}${i % 4}`, vel0 + (vel1 - vel0) * k, r.range(0.9, 1.1), pan);
  }
}

/** 13 : grotte inquiétante — nappe grave, gouttes, souffles, grondements, cloches dissonantes. */
function disc13(len: number, r: Rand): RecordNote[] {
  const n: RecordNote[] = [];
  for (let t = 0; t < len - 6; t += 22) {
    n.push({ t, n: 38, dur: Math.min(26, len - t - 1), vel: 0.55, voice: 'drone' });
    n.push({ t: t + 6, n: 45 + r.pick([0, 1, -1]), dur: Math.min(18, len - t - 7), vel: 0.35, voice: 'drone' });
  }
  let t = 3;
  while (t < len - 4) {
    const k = r.next();
    if (k < 0.32) fx(n, t, 'drip', r.range(0.3, 0.6), r.range(0.8, 1.4), r.range(-0.8, 0.8));
    else if (k < 0.5) fx(n, t, 'wind', r.range(0.25, 0.45), r.range(0.8, 1.1), r.range(-0.5, 0.5));
    else if (k < 0.64) fx(n, t, 'groan', r.range(0.3, 0.5), r.range(0.6, 0.9), r.range(-0.7, 0.7));
    else if (k < 0.76) fx(n, t, 'rumble', r.range(0.4, 0.7), r.range(0.7, 1));
    else if (k < 0.84) fx(n, t, 'stone_fall', r.range(0.25, 0.45), r.range(0.8, 1.2), r.range(-0.8, 0.8));
    else if (k < 0.92) for (const [i, d] of [0, 1, 6].entries()) n.push({ t: t + i * 0.7, n: 62 + d + r.pick([0, 12]), dur: 4, vel: 0.35, voice: 'bell' });
    else steps(n, r, t, t + 3, 0.6, 'step_gravel', 0.12, 0.2, r.range(-0.9, 0.9));
    t += r.range(3, 8.5);
  }
  // moment de tension : souffle tout près, puis plus rien
  fx(n, len * 0.72, 'breath_in', 0.35, 0.8, 0.4);
  fx(n, len * 0.72 + 2.2, 'breath_out', 0.3, 0.8, 0.4);
  return n;
}

/** 11 : disque fendu — grésillement, pas dans le gravier, respiration, course, chute, coupure. */
function disc11(len: number, r: Rand): RecordNote[] {
  const n: RecordNote[] = [];
  crackleBed(n, 0, len - 1.2, 0.5);
  fx(n, 1.2, 'glitch', 0.5);
  // marche
  steps(n, r, 3, 27.5, 0.56, 'step_gravel', 0.45, 0.55);
  for (let t = 3.5; t < 27; t += 3.3) {
    fx(n, t, 'breath_in', 0.3, r.range(0.95, 1.05));
    fx(n, t + 1.5, 'breath_out', 0.28, r.range(0.95, 1.05));
  }
  fx(n, 19.5, 'groan', 0.25, 0.7, -0.7);
  fx(n, 24, 'static', 0.3);
  // arrêt : on écoute
  heartbeat(n, 28, 33, 75, 95, 0.25, 0.4);
  fx(n, 30.5, 'whoosh', 0.45, 0.8, 0.6);
  fx(n, 31.2, 'glitch', 0.4);
  // course
  steps(n, r, 33, 59.5, 0.3, 'step_gravel', 0.6, 0.7);
  for (let t = 33.2; t < 59; t += 0.62) fx(n, t, 'pant', r.range(0.35, 0.45), r.range(0.95, 1.1));
  heartbeat(n, 33, 60, 120, 165, 0.35, 0.55);
  fx(n, 45, 'scream', 0.18, 0.75, -0.8);
  fx(n, 47.5, 'static', 0.35);
  fx(n, 52, 'stone_fall', 0.4, 1, 0.5);
  fx(n, 55.5, 'glitch', 0.45);
  // chute
  fx(n, 60, 'stumble', 0.8);
  fx(n, 60.3, 'thud', 0.7);
  for (let t = 61; t < 66; t += 0.75) fx(n, t, 'pant', 0.45, r.range(0.85, 0.95));
  heartbeat(n, 60.5, 69.5, 170, 180, 0.5, 0.6);
  fx(n, 62.5, 'static', 0.5);
  fx(n, 64, 'static', 0.45);
  // quelque chose approche
  steps(n, r, 64.5, 69.3, 0.62, 'step_gravel', 0.15, 0.75, 0.3);
  fx(n, 69.4, 'whoosh', 0.7, 1.1);
  fx(n, 69.6, 'glitch', 0.8);
  fx(n, len - 1.1, 'click_end', 0.8);
  return n;
}

/** 5 : cité antique — sculk qui claque, battements sourds, échos, cloches phrygiennes. */
function disc5(len: number, r: Rand): RecordNote[] {
  const n: RecordNote[] = [];
  for (let t = 0; t < len - 8; t += 24) n.push({ t, n: 35, dur: Math.min(28, len - t - 1), vel: 0.55, voice: 'drone' });
  for (let t = 12; t < len - 8; t += 24) n.push({ t, n: 42, dur: Math.min(16, len - t - 2), vel: 0.3, voice: 'drone' });
  let t = 2;
  while (t < len - 6) {
    const k = r.next();
    if (k < 0.35) for (let i = 0, m = r.int(2, 6); i < m; i++) fx(n, t + i * r.range(0.08, 0.25), 'sculk', r.range(0.3, 0.55), r.range(0.8, 1.3), r.range(-0.8, 0.8));
    else if (k < 0.55) {
      // phrase de cloches (gamme phrygienne) avec son écho
      const base = 59;
      const ph = Array.from({ length: r.int(3, 5) }, () => base + r.pick(PHRYGIAN) + r.pick([0, 12]));
      ph.forEach((p, i) => {
        n.push({ t: t + i * 0.9, n: p, dur: 3, vel: 0.45, voice: 'bell' });
        n.push({ t: t + i * 0.9 + 0.45, n: p, dur: 3, vel: 0.18, voice: 'bell' });
      });
    } else if (k < 0.7) for (let i = 0; i < r.int(4, 8); i++) fx(n, t + i * 1.1, 'thud', 0.45 + i * 0.03, 0.9);
    else if (k < 0.8) fx(n, t, 'whisper1', 0.22, r.range(0.7, 0.9), r.range(-0.7, 0.7));
    else if (k < 0.88) fx(n, t, 'shriek', 0.25, r.range(0.8, 1));
    else n.push({ t, n: r.pick([47, 50, 52]), dur: 6, vel: 0.4, voice: 'pad' }, { t, n: r.pick([48, 53]), dur: 6, vel: 0.35, voice: 'pad' });
    t += r.range(3, 7);
  }
  return n;
}

/** murmures : chuchotements de plus en plus proches, cœur qui s'emballe, cri final. */
function discMurmures(len: number, r: Rand): RecordNote[] {
  const n: RecordNote[] = [];
  crackleBed(n, 0, len - 9, 0.3);
  n.push({ t: 0, n: 40, dur: 40, vel: 0.4, voice: 'drone' }, { t: 30, n: 41, dur: 55, vel: 0.45, voice: 'drone' }, { t: 45, n: 46, dur: 40, vel: 0.3, voice: 'drone' });
  let t = 4;
  while (t < len - 10) {
    const k = (t - 4) / (len - 14);
    fx(n, t, `whisper${r.int(0, 2)}`, 0.15 + k * 0.4, r.range(0.85, 1.15), r.pick([-0.9, -0.5, 0.5, 0.9]));
    if (r.next() < 0.3) fx(n, t + r.range(0.4, 1.5), 'creak', 0.2 + k * 0.2, r.range(0.7, 1.2), r.range(-0.8, 0.8));
    if (r.next() < 0.25) fx(n, t + r.range(0.2, 1), 'breath_in', 0.25 + k * 0.3, 0.85, r.range(-0.4, 0.4));
    t += r.range(4, 7) * (1 - k * 0.6);
  }
  heartbeat(n, 20, len - 9, 58, 150, 0.15, 0.6);
  // silence, puis le chuchotement tout près et le cri
  fx(n, len - 6.5, 'whisper2', 0.8, 0.8, 0.95);
  fx(n, len - 5, 'scream', 0.7, 1.1);
  fx(n, len - 4.8, 'static', 0.7);
  fx(n, len - 4.2, 'glitch', 0.8);
  fx(n, len - 1.2, 'click_end', 0.7);
  return n;
}

/** toc : l'horloge, des coups à la porte, la porte qui grince, des pas qui approchent. */
function discToc(len: number, r: Rand): RecordNote[] {
  const n: RecordNote[] = [];
  for (let t = 0.5; t < 72; t += 1) fx(n, t, 'tick', t % 2 < 1 ? 0.35 : 0.28, t % 2 < 1 ? 1 : 0.92);
  n.push({ t: 0, n: 43, dur: 72, vel: 0.35, voice: 'drone' });
  const knocks = (at: number, count: number, gap: number, vel: number) => {
    for (let i = 0; i < count; i++) fx(n, at + i * gap, 'knock', vel, r.range(0.95, 1.05), -0.4);
  };
  knocks(8, 3, 0.45, 0.4);
  knocks(20, 3, 0.4, 0.55);
  knocks(34, 4, 0.33, 0.7);
  knocks(46, 10, 0.18, 0.8);
  heartbeat(n, 38, 72, 70, 140, 0.2, 0.55);
  fx(n, 56, 'creak', 0.7, 0.6, -0.3);
  fx(n, 57.5, 'wind', 0.35, 0.9);
  steps(n, r, 59, 70.5, 0.8, 'step_wood', 0.2, 0.75, -0.3);
  // l'horloge s'arrête
  fx(n, 76, 'knock', 1, 0.9, 0.1);
  fx(n, 79, 'whisper0', 0.75, 0.8, 0.7);
  fx(n, 80.5, 'breath_out', 0.6, 0.7, 0.6);
  fx(n, len - 1.2, 'click_end', 0.6);
  return n;
}

/** signal perdu : statique, balayage radio, bips d'une station de chiffres, mélodie déformée. */
function discSignal(len: number, r: Rand): RecordNote[] {
  const n: RecordNote[] = [];
  for (let t = 0; t < len - 2; t += 1) fx(n, t, 'static', 0.18 + 0.12 * Math.abs(Math.sin(t * 0.21)), r.range(0.9, 1.1));
  let t = 2;
  const chime = [72, 75, 79, 74, 72];
  let section = 0;
  while (t < len - 12) {
    const kind = section % 4;
    if (kind === 0) {
      fx(n, t, 'sweep', 0.5, r.range(0.8, 1.2));
      t += 2;
    } else if (kind === 1) {
      // chiffres : groupes de bips
      for (let g = 0; g < 4; g++) {
        const digit = r.int(1, 9);
        for (let i = 0; i < digit; i++) fx(n, t + i * 0.22, 'beep', 0.35, 1 + (g % 2) * 0.25);
        t += digit * 0.22 + 0.8;
      }
    } else if (kind === 2) {
      // mélodie de boîte à musique, de plus en plus faussée
      const slow = 1 + section * 0.04;
      chime.forEach((p, i) => n.push({ t: t + i * 0.55 * slow, n: p - Math.floor(section / 3), dur: 2, vel: 0.4, voice: 'bell' }));
      if (section > 4) fx(n, t + 1.5, 'glitch', 0.5);
      t += chime.length * 0.55 * slow + 1;
    } else {
      for (let i = 0; i < r.int(3, 6); i++) fx(n, t + i * 0.12, 'glitch', 0.45, r.range(0.7, 1.4));
      if (r.next() < 0.6) fx(n, t + 1, `whisper${r.int(0, 2)}`, 0.3, 0.6, r.range(-0.5, 0.5));
      t += 2.5;
    }
    t += r.range(1.5, 4);
    section++;
  }
  n.push({ t: 10, n: 50, dur: 50, vel: 0.3, voice: 'drone' }, { t: 55, n: 49, dur: len - 66, vel: 0.4, voice: 'drone' });
  // signal plat, puis coupure
  fx(n, len - 10, 'beep', 0.5, 1);
  for (let i = 1; i < 14; i++) fx(n, len - 10 + i * 0.2, 'beep', 0.5, 1);
  fx(n, len - 7, 'static', 0.8, 0.8);
  fx(n, len - 1.2, 'click_end', 0.7);
  return n;
}

/** gouffre : nappes très graves, gouttes, chaînes, cris lointains qui se rapprochent. */
function discGouffre(len: number, r: Rand): RecordNote[] {
  const n: RecordNote[] = [];
  for (let t = 0; t < len - 10; t += 26) {
    n.push({ t, n: 33, dur: Math.min(30, len - t - 3), vel: 0.6, voice: 'drone' });
    n.push({ t: t + 8, n: 34, dur: Math.min(20, len - t - 10), vel: 0.35, voice: 'drone' });
  }
  for (let t = 15; t < len - 20; t += r.range(18, 24)) {
    // cloches qui descendent chromatiquement
    for (let i = 0; i < 5; i++) n.push({ t: t + i * 1.4, n: 70 - i, dur: 4, vel: 0.3, voice: 'bell' });
  }
  let t = 2;
  const screams = [30, 58, 84, 106];
  while (t < len - 8) {
    const k = r.next();
    if (k < 0.35) {
      fx(n, t, 'drip', r.range(0.35, 0.55), r.range(0.7, 1.1), r.range(-0.8, 0.8));
      fx(n, t + 0.5, 'drip', 0.15, r.range(0.7, 1.1), r.range(-0.8, 0.8));
    } else if (k < 0.5) fx(n, t, 'chain', r.range(0.25, 0.45), r.range(0.8, 1.1), r.range(-0.8, 0.8));
    else if (k < 0.65) fx(n, t, 'rumble', r.range(0.5, 0.8), r.range(0.6, 0.9));
    else if (k < 0.78) fx(n, t, 'stone_fall', r.range(0.3, 0.5), r.range(0.7, 1), r.range(-0.8, 0.8));
    else if (k < 0.9) fx(n, t, 'wind', r.range(0.3, 0.5), r.range(0.6, 0.8));
    else fx(n, t, 'groan', r.range(0.35, 0.55), r.range(0.5, 0.8), r.range(-0.6, 0.6));
    t += r.range(2.5, 6);
  }
  screams.forEach((s, i) => fx(n, s, 'scream', 0.15 + i * 0.15, 0.7 + i * 0.08, i % 2 ? 0.7 : -0.7));
  // chute dans le noir
  fx(n, len - 7, 'whoosh', 0.8, 0.6);
  fx(n, len - 5.5, 'whoosh', 0.9, 0.5);
  fx(n, len - 3.6, 'thud', 1, 0.7);
  fx(n, len - 3.5, 'stone_fall', 0.6, 0.8);
  return n;
}

const STYLES: Record<string, SongStyle> = {
  cat: { bpm: 110, key: 48, scale: MAJOR, progA: [[0, MAJ], [9, MIN], [5, MAJ], [7, MAJ]], progB: [[5, MAJ7], [7, MAJ], [4, MIN7], [9, MIN]], melody: 'pluck', chords: 'piano', chordStyle: 'arp', bass: 'pulse', drums: 'soft', density: 0.85, center: 74 },
  blocks: { bpm: 122, key: 50, scale: MIXO, progA: [[0, MAJ], [10, MAJ], [5, MAJ], [0, MAJ]], progB: [[7, MIN7], [5, MAJ], [10, MAJ], [0, SUS2]], melody: 'organ', chords: 'pluck', chordStyle: 'stab', bass: 'walk', drums: 'beat', density: 0.75, center: 72 },
  chirp: { bpm: 92, key: 52, scale: MAJOR, progA: [[0, MAJ7], [5, MAJ7], [9, MIN7], [7, SUS2]], progB: [[2, MIN7], [7, DOM7], [0, MAJ7], [9, MIN7]], melody: 'lead', chords: 'pad', chordStyle: 'pad', bass: 'long', drums: 'soft', density: 0.65, center: 76, sparkle: true, wob: 0.006 },
  far: { bpm: 70, key: 53, scale: LYDIAN, progA: [[0, MAJ9], [2, MAJ], [7, ADD9], [4, MIN7]], melody: 'piano', chords: 'pad', chordStyle: 'pad', bass: 'long', drums: 'none', density: 0.45, center: 76, sparkle: true },
  mall: { bpm: 100, key: 55, scale: MAJOR, progA: [[0, MAJ7], [9, MIN7], [2, MIN7], [7, DOM7]], progB: [[5, MAJ7], [4, MIN7], [9, MIN7], [2, DOM7]], melody: 'lead', chords: 'organ', chordStyle: 'block', bass: 'walk', drums: 'soft', density: 0.7, center: 72, wob: 0.004 },
  mellohi: { bpm: 60, key: 50, scale: MINOR, beats: 3, progA: [[0, MIN], [8, MAJ], [3, MAJ], [10, MAJ]], melody: 'lead', chords: 'pad', chordStyle: 'pad', bass: 'long', drums: 'none', density: 0.55, center: 70, wob: 0.02 },
  stal: { bpm: 112, key: 50, scale: DORIAN, swing: 0.66, progA: [[0, MIN7], [5, DOM7], [0, MIN7], [7, MIN7]], progB: [[3, MAJ7], [8, DOM7], [2, MIN7], [7, DOM7]], melody: 'lead', chords: 'piano', chordStyle: 'stab', bass: 'walk', drums: 'swing', density: 0.75, center: 70, wob: 0.008 },
  strad: { bpm: 118, key: 55, scale: MAJOR, progA: [[0, MAJ], [7, MAJ], [9, MIN], [5, MAJ]], progB: [[5, MAJ], [0, MAJ], [7, SUS2], [7, MAJ]], melody: 'bell', chords: 'pluck', chordStyle: 'arp', bass: 'pulse', drums: 'four', density: 0.8, center: 76 },
  ward: { bpm: 104, key: 50, scale: DORIAN, progA: [[0, MIN7], [10, MAJ], [5, MAJ], [7, MIN7]], progB: [[3, MAJ7], [10, MAJ], [0, MIN9], [5, DOM7]], melody: 'organ', chords: 'pluck', chordStyle: 'arp', bass: 'pulse', drums: 'beat', density: 0.75, center: 72 },
  wait: { bpm: 96, key: 52, scale: MAJOR, progA: [[0, ADD9], [7, MAJ], [9, MIN7], [5, MAJ7]], progB: [[5, MAJ7], [7, SUS2], [4, MIN7], [9, MIN7]], melody: 'piano', chords: 'piano', chordStyle: 'arp', bass: 'long', drums: 'soft', density: 0.65, center: 74, sparkle: true },
  pigstep: { bpm: 85, key: 46, scale: MINOR, progA: [[0, MIN], [0, MIN], [8, MAJ], [7, MIN]], progB: [[5, MIN], [3, MAJ], [8, MAJ], [7, DOM7]], melody: 'lead', chords: 'organ', chordStyle: 'stab', bass: 'pulse', drums: 'hiphop', density: 0.6, center: 64, wob: 0.01 },
  otherside: { bpm: 92, key: 45, scale: DORIAN, progA: [[0, MIN7], [5, DOM7], [3, MAJ7], [10, MAJ]], progB: [[8, MAJ7], [10, MAJ], [0, MIN9], [7, MIN7]], melody: 'lead', chords: 'pluck', chordStyle: 'arp', bass: 'walk', drums: 'beat', density: 0.75, center: 72, wob: 0.005 },
  relic: { bpm: 74, key: 50, scale: MINOR, progA: [[0, MIN9], [8, MAJ7], [3, MAJ7], [10, SUS2]], progB: [[5, MIN7], [8, MAJ7], [10, SUS2], [7, MIN7]], melody: 'piano', chords: 'pad', chordStyle: 'pad', bass: 'long', drums: 'none', density: 0.55, center: 72 },
  precipice: { bpm: 100, key: 47, scale: MINOR, progA: [[0, MIN], [8, MAJ], [3, MAJ], [10, MAJ]], progB: [[5, MIN], [8, MAJ], [10, SUS2], [7, MIN]], melody: 'pluck', chords: 'pad', chordStyle: 'pad', bass: 'pulse', drums: 'soft', density: 0.7, center: 71 },
  creator: { bpm: 104, key: 53, scale: LYDIAN, progA: [[0, MAJ9], [2, MAJ], [9, MIN7], [7, SUS2]], progB: [[4, MIN7], [2, MAJ], [0, MAJ9], [7, SUS2]], melody: 'bell', chords: 'pluck', chordStyle: 'arp', bass: 'long', drums: 'soft', density: 0.7, center: 77, themeSeed: 0xc4ea7 },
  creator_music_box: { bpm: 84, key: 65, scale: LYDIAN, progA: [[0, MAJ9], [2, MAJ], [9, MIN7], [7, SUS2]], progB: [[4, MIN7], [2, MAJ], [0, MAJ9], [7, SUS2]], melody: 'bell', chords: 'none', chordStyle: 'arp', bass: 'none', drums: 'none', density: 0.75, center: 84, themeSeed: 0xc4ea7 },
  tears: { bpm: 68, key: 52, scale: MINOR, progA: [[0, MIN7], [5, MIN7], [8, MAJ7], [7, SUS2]], progB: [[3, MAJ7], [10, SUS2], [8, MAJ7], [7, MIN]], melody: 'lead', chords: 'pad', chordStyle: 'pad', bass: 'long', drums: 'none', density: 0.5, center: 72, wob: 0.012 },
  lava_chicken: { bpm: 128, key: 53, scale: MIXO, progA: [[0, MAJ], [10, MAJ], [5, MAJ], [0, MAJ]], progB: [[5, MAJ], [7, MAJ], [10, MAJ], [7, DOM7]], melody: 'lead', chords: 'organ', chordStyle: 'stab', bass: 'pulse', drums: 'four', density: 0.9, center: 76, wob: 0.003 },
};

/** Pièce d'un disque (clé d'objet « music_disc_… ») ; null si ce n'est pas un disque. */
export function composeRecord(disc: string): RecordPiece | null {
  const info = DISCS[disc];
  if (!info) return null;
  const name = disc.replace(/^music_disc_/, '');
  const len = info.length;
  const seed = hashKey(disc);
  const r = new Rand(seed);
  let notes: RecordNote[];
  switch (name) {
    case '13': notes = disc13(len, r); break;
    case '11': notes = disc11(len, r); break;
    case '5': notes = disc5(len, r); break;
    case 'murmures': notes = discMurmures(len, r); break;
    case 'toc': notes = discToc(len, r); break;
    case 'signal_perdu': notes = discSignal(len, r); break;
    case 'gouffre': notes = discGouffre(len, r); break;
    case 'ward': {
      // ward : introduction étrange (nappe, cloches phrygiennes), puis le morceau enjoué
      notes = [{ t: 0, n: 38, dur: 30, vel: 0.5, voice: 'drone' }];
      for (let i = 0; i < 9; i++) notes.push({ t: 2 + i * 3, n: 62 + r.pick(PHRYGIAN), dur: 4, vel: 0.35, voice: 'bell' });
      fx(notes, 12, 'wind', 0.3, 0.8);
      song(STYLES.ward, len - 30, seed, notes, 30);
      break;
    }
    default:
      notes = song(STYLES[name] ?? STYLES.cat, len, seed);
  }
  notes = notes.filter((x) => x.t >= 0 && x.t < len - 0.05).map((x) => ({ ...x, dur: Math.max(0.05, Math.min(x.dur, len - x.t)) }));
  notes.sort((a, b) => a.t - b.t);
  return { disc, notes, length: len };
}

// ---------- bruitages des disques (synthétisés) ----------
export function buildRecordSfx(s: SynthContext): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = {};
  const sr = s.sr;
  // pas : gravier (craquant) et plancher
  for (let i = 0; i < 4; i++) {
    out[`step_gravel${i}`] = s.mix({ buf: s.noise(0.16, { lp: 2400, hp: 250, decay: 16, gain: 0.9, seed: 31 + i * 7, crackle: 0.42 }) }, { buf: s.noise(0.08, { lp: 900, decay: 30, gain: 0.5, seed: 77 + i }), at: 0.02 });
    out[`step_wood${i}`] = s.mix({ buf: s.noise(0.12, { lp: 800, decay: 22, gain: 0.9, seed: 51 + i }) }, { buf: s.tone(0.12, 120 + i * 9, 90, { wave: 'tri', decay: 20, gain: 0.5 }) }, { buf: s.tone(0.3, 300 + i * 25, 260, { wave: 'saw', decay: 9, gain: 0.05, vibrato: 0.08, vibRate: 30 }), at: 0.03 });
  }
  // respiration : bruit filtré à attaque lente
  out.breath_in = s.noise(1.1, { lp: 2200, hp: 500, decay: 1.2, attack: 0.5, gain: 0.5, seed: 9 });
  out.breath_out = s.noise(1.2, { lp: 1400, hp: 250, decay: 2.2, attack: 0.08, gain: 0.55, seed: 13 });
  out.pant = s.mix({ buf: s.noise(0.28, { lp: 2000, hp: 400, decay: 6, attack: 0.06, gain: 0.6, seed: 17 }) }, { buf: s.noise(0.3, { lp: 1300, hp: 250, decay: 7, attack: 0.04, gain: 0.55, seed: 19 }), at: 0.3 });
  // cœur : « boum-boum » sourd
  out.heartbeat = s.mix({ buf: s.tone(0.18, 62, 42, { decay: 14, gain: 1 }) }, { buf: s.tone(0.16, 55, 38, { decay: 16, gain: 0.75 }), at: 0.24 }, { buf: s.noise(0.1, { lp: 180, decay: 25, gain: 0.8 }) });
  // grésillement du disque : souffle + craquements épars (boucle de 2 s)
  {
    let seed = 4242, lp = 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    out.crackle = s.buf(2, () => {
      const w = rnd() * 2 - 1;
      lp = lp * 0.7 + w * 0.3;
      const pop = rnd() > 0.9985 ? (rnd() - 0.5) * 1.6 : 0;
      return (w - lp) * 0.06 + pop;
    });
  }
  out.static = s.noise(1, { hp: 600, decay: 0.6, attack: 0.02, gain: 0.5, seed: 61, crackle: 0.35 });
  out.glitch = s.mix(...[0, 0.05, 0.1, 0.17].map((at, i) => ({ buf: s.tone(0.045, 180 + i * 140, 160 + i * 120, { wave: 'square', decay: 6, gain: 0.25 }), at })), { buf: s.noise(0.22, { hp: 1500, decay: 8, gain: 0.35, crackle: 0.5 }) });
  // chuchotements : bruit passe-bande modulé comme des syllabes
  for (let v = 0; v < 3; v++) {
    let seed = 900 + v * 31, a = 0, b = 0, prev = 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const rate = 5 + v * 1.7, form = 0.25 + v * 0.08;
    out[`whisper${v}`] = s.buf(1.8, (t) => {
      const w = rnd() * 2 - 1;
      a = a * (1 - form) + w * form;
      const hp = a - b;
      b = b * 0.92 + a * 0.08;
      const syl = Math.max(0, Math.sin(t * Math.PI * rate + Math.sin(t * 3.1 + v) * 1.5)) ** 2;
      const env = Math.min(1, t / 0.15) * Math.min(1, (1.8 - t) / 0.3);
      const sib = Math.sin(t * 2.2 + v) > 0.7 ? (w - prev) * 0.4 : 0;
      prev = w;
      return (hp * 1.6 * syl + sib) * env * 0.6;
    });
  }
  // porte qui grince : frottement à hauteur instable
  {
    let ph = 0, seed = 77;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    out.creak = s.buf(1.8, (t) => {
      const f = 180 + Math.sin(t * 2.1) * 60 + Math.sin(t * 13) * 15 + t * 40;
      ph += f / sr;
      const stick = (Math.sin(t * Math.PI * 2 * 23) > 0.2 ? 1 : 0.35) * (0.6 + rnd() * 0.4);
      const env = Math.min(1, t / 0.2) * Math.min(1, (1.8 - t) / 0.4);
      return ((ph % 1) * 2 - 1) * stick * env * 0.22;
    });
  }
  out.knock = s.mix({ buf: s.tone(0.12, 140, 90, { decay: 28, gain: 0.9 }) }, { buf: s.noise(0.06, { lp: 1600, decay: 45, gain: 0.8 }) });
  out.tick = s.mix({ buf: s.noise(0.03, { hp: 2500, decay: 120, gain: 0.7 }) }, { buf: s.tone(0.04, 3200, 3000, { decay: 90, gain: 0.25 }) });
  out.drip = s.mix({ buf: s.tone(0.18, 900, 2200, { decay: 18, gain: 0.45 }) }, { buf: s.tone(0.4, 1500, 1400, { decay: 9, gain: 0.08 }), at: 0.05 });
  out.rumble = s.noise(3.2, { lp: 120, decay: 0.9, attack: 0.8, gain: 2.2, seed: 5 });
  out.wind = s.noise(3, { lp: 700, hp: 120, decay: 0.8, attack: 1, gain: 0.9, seed: 23 });
  out.whoosh = s.noise(0.9, { lp: 2500, hp: 200, decay: 3.5, attack: 0.35, gain: 0.8, seed: 29 });
  out.scream = s.mix({ buf: s.tone(1.5, 820, 560, { wave: 'saw', decay: 1.5, attack: 0.12, gain: 0.18, vibrato: 0.05, vibRate: 7 }) }, { buf: s.tone(1.5, 1240, 900, { wave: 'tri', decay: 1.6, attack: 0.1, gain: 0.1, vibrato: 0.06, vibRate: 6 }) }, { buf: s.noise(1.5, { hp: 1200, lp: 4000, decay: 1.8, attack: 0.1, gain: 0.2 }) });
  out.groan = s.mix({ buf: s.tone(2.4, 110, 70, { wave: 'saw', decay: 1, attack: 0.4, gain: 0.16, vibrato: 0.04, vibRate: 3 }) }, { buf: s.noise(2.4, { lp: 400, decay: 1.2, attack: 0.4, gain: 0.5 }) });
  out.chain = s.mix(...[0, 0.07, 0.15, 0.21, 0.3].map((at, i) => ({ buf: s.mix({ buf: s.noise(0.06, { hp: 2500, decay: 50, gain: 0.4, seed: 3 + i }) }, { buf: s.tone(0.12, 1900 + i * 230, 1850 + i * 230, { decay: 25, gain: 0.12 }) }), at })));
  out.stone_fall = s.mix(...[0, 0.11, 0.19, 0.33, 0.41, 0.6].map((at, i) => ({ buf: s.mix({ buf: s.noise(0.1, { lp: 1800, hp: 200, decay: 30, gain: 0.7, seed: 40 + i }) }, { buf: s.tone(0.08, 220 - i * 15, 150, { decay: 35, gain: 0.3 }) }), at, gain: 1 - i * 0.12 })));
  out.stumble = s.mix({ buf: s.noise(0.5, { lp: 2200, hp: 200, decay: 5, gain: 0.9, crackle: 0.45, seed: 71 }) }, { buf: s.noise(0.2, { lp: 1500, decay: 12, gain: 0.7, crackle: 0.4, seed: 73 }), at: 0.25 });
  out.thud = s.mix({ buf: s.tone(0.6, 70, 35, { decay: 6, gain: 1 }) }, { buf: s.noise(0.3, { lp: 250, decay: 10, gain: 1 }) });
  out.sculk = s.mix({ buf: s.noise(0.04, { hp: 1800, decay: 80, gain: 0.8 }) }, { buf: s.tone(0.18, 520, 480, { wave: 'tri', decay: 25, gain: 0.3 }) }, { buf: s.tone(0.12, 1250, 1200, { decay: 30, gain: 0.12 }), at: 0.02 });
  out.shriek = s.mix({ buf: s.tone(1.3, 1500, 900, { wave: 'saw', decay: 2, attack: 0.05, gain: 0.12, vibrato: 0.12, vibRate: 35 }) }, { buf: s.noise(1.3, { hp: 2500, decay: 2.5, gain: 0.25 }) });
  out.beep = s.tone(0.16, 1000, 1000, { decay: 2, attack: 0.005, gain: 0.35 });
  out.sweep = s.mix({ buf: s.tone(1.4, 400, 2600, { decay: 0.8, gain: 0.15, vibrato: 0.02, vibRate: 9 }) }, { buf: s.noise(1.4, { hp: 900, decay: 1, gain: 0.4, crackle: 0.5 }) });
  out.click_end = s.mix({ buf: s.noise(0.05, { hp: 800, decay: 60, gain: 1 }) }, { buf: s.tone(0.5, 300, 40, { wave: 'saw', decay: 6, gain: 0.25 }) });
  // batterie
  out.kick = s.mix({ buf: s.tone(0.35, 120, 42, { decay: 9, gain: 1 }) }, { buf: s.noise(0.02, { lp: 2000, decay: 80, gain: 0.4 }) });
  out.snare = s.mix({ buf: s.noise(0.22, { hp: 900, lp: 7000, decay: 16, gain: 0.7, seed: 87 }) }, { buf: s.tone(0.12, 220, 170, { wave: 'tri', decay: 25, gain: 0.35 }) });
  out.hat = s.noise(0.07, { hp: 6000, decay: 55, gain: 0.45, seed: 91 });
  return out;
}

/** Noms des bruitages utilisés par les pistes (pour vérifier qu'ils existent tous). */
export function recordSfxNames(piece: RecordPiece): string[] {
  return [...new Set(piece.notes.filter((n) => n.voice === 'sfx').map((n) => n.sfx!))];
}
