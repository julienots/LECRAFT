/**
 * Musique : pièces composées à la volée dans l'esprit des musiques calmes du jeu de référence
 * (piano feutré, accords de septième, longues résonances, silences), une ambiance par contexte
 * (menu, jour, nuit, grottes, sous l'eau, créatif, Nether, End) — et bibliothèque de musiques
 * importées par l'utilisateur (fichiers audio ou dossier « sounds/music » d'un pack de
 * ressources), conservées sur l'appareil et jouées en priorité dans leur ambiance.
 *
 * Aucune musique d'un autre jeu n'est incluse : les mélodies sont générées (art original).
 */

export type MusicMood = 'menu' | 'day' | 'night' | 'cave' | 'underwater' | 'creative' | 'nether' | 'end';
export const MUSIC_MOODS: MusicMood[] = ['menu', 'day', 'night', 'cave', 'underwater', 'creative', 'nether', 'end'];

export type Voice = 'piano' | 'pad' | 'bass' | 'bell';
export interface MusicNote {
  /** Début (secondes depuis le début de la pièce). */
  t: number;
  /** Note MIDI. */
  n: number;
  dur: number;
  vel: number;
  voice: Voice;
}
export interface Piece {
  title: string;
  mood: MusicMood;
  notes: MusicNote[];
  length: number;
}

/** Générateur pseudo-aléatoire déterministe (une graine = une pièce). */
class Rand {
  constructor(private s: number) {}
  next() {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  int(a: number, b: number) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick<T>(l: readonly T[]): T {
    return l[Math.floor(this.next() * l.length)];
  }
}

// accords : fondamentale (demi-tons depuis la tonique) et intervalles
type Chord = [number, number[]];
const MAJ7 = [0, 4, 7, 11], MIN7 = [0, 3, 7, 10], MAJ9 = [0, 4, 7, 14], SUS2 = [0, 2, 7], ADD9 = [0, 4, 7, 14], MIN9 = [0, 3, 7, 14], MAJ = [0, 4, 7], MIN = [0, 3, 7], MIN6 = [0, 3, 7, 9];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11], MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10], LYDIAN = [0, 2, 4, 6, 7, 9, 11], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

interface Style {
  tempo: [number, number];
  keys: number[];
  scale: number[];
  progressions: Chord[][];
  voices: { melody: Voice; chords: Voice; bass: boolean; sparkle?: boolean };
  density: number;
  /** Octave de la mélodie (note MIDI centrale). */
  center: number;
  names: string[];
}

const STYLES: Record<MusicMood, Style> = {
  menu: {
    tempo: [66, 74], keys: [0, 2, 5], scale: MAJOR_SCALE,
    progressions: [[[0, MAJ7], [4, MIN7], [5, MAJ7], [5, MIN6]], [[0, ADD9], [9, MIN7], [5, MAJ7], [7, SUS2]]],
    voices: { melody: 'piano', chords: 'pad', bass: true }, density: 0.55, center: 72, names: ['Panorama', 'Premiers pas', 'Écran titre', 'Souvenir de cubes'],
  },
  day: {
    tempo: [68, 82], keys: [0, 2, 5, 7], scale: MAJOR_SCALE,
    progressions: [[[0, MAJ7], [9, MIN7], [5, MAJ7], [7, SUS2]], [[0, MAJ9], [5, MAJ7], [0, MAJ9], [5, MAJ7]], [[0, MAJ], [4, MIN7], [5, MAJ7], [5, MAJ7]], [[9, MIN7], [5, MAJ7], [0, ADD9], [7, SUS2]]],
    voices: { melody: 'piano', chords: 'piano', bass: true }, density: 0.6, center: 72, names: ['Prairie', 'Matin clair', 'Herbes hautes', 'Clairière', 'Petit ruisseau', 'Village tranquille'],
  },
  creative: {
    tempo: [84, 96], keys: [0, 7, 2], scale: LYDIAN,
    progressions: [[[0, MAJ9], [2, MAJ], [0, MAJ9], [2, MAJ]], [[0, MAJ7], [7, ADD9], [9, MIN7], [5, MAJ9]]],
    voices: { melody: 'piano', chords: 'piano', bass: true, sparkle: true }, density: 0.7, center: 76, names: ['Bâtisseurs', 'Ciel sans fin', 'Vol libre'],
  },
  night: {
    tempo: [54, 62], keys: [9, 4, 2], scale: MINOR_SCALE,
    progressions: [[[0, MIN9], [8, MAJ7], [3, MAJ7], [10, SUS2]], [[0, MIN7], [5, MIN7], [8, MAJ7], [7, MIN]]],
    voices: { melody: 'piano', chords: 'pad', bass: true }, density: 0.4, center: 69, names: ['Clair de lune', 'Étoiles', 'Veillée', 'Grillons'],
  },
  cave: {
    tempo: [48, 56], keys: [2, 9], scale: MINOR_SCALE,
    progressions: [[[0, MIN], [1, MAJ], [0, MIN], [8, MAJ]], [[0, SUS2], [3, SUS2], [0, SUS2], [10, SUS2]]],
    voices: { melody: 'bell', chords: 'pad', bass: true }, density: 0.25, center: 67, names: ['Profondeurs', 'Gouttes', 'Galeries'],
  },
  underwater: {
    tempo: [50, 58], keys: [5, 0], scale: LYDIAN,
    progressions: [[[0, MAJ9], [2, MAJ], [0, MAJ9], [7, SUS2]]],
    voices: { melody: 'bell', chords: 'pad', bass: false }, density: 0.35, center: 74, names: ['Bulles', 'Récif', 'Courants'],
  },
  nether: {
    tempo: [46, 54], keys: [4, 1], scale: PHRYGIAN,
    progressions: [[[0, MIN], [1, MAJ], [0, MIN], [8, MAJ]], [[0, MIN6], [1, MAJ7], [10, MIN], [1, MAJ]]],
    voices: { melody: 'bell', chords: 'pad', bass: true }, density: 0.3, center: 62, names: ['Braises', 'Âmes perdues', 'Forteresse'],
  },
  end: {
    tempo: [44, 52], keys: [11, 6], scale: MINOR_SCALE,
    progressions: [[[0, SUS2], [10, SUS2], [8, MAJ7], [10, SUS2]]],
    voices: { melody: 'bell', chords: 'pad', bass: true }, density: 0.28, center: 70, names: ['Vide', 'Pierre du bout du monde', 'Ailes'],
  },
};

/** Compose une pièce (intro, thème A, variation, thème B, reprise, coda). */
export function composePiece(mood: MusicMood, seed: number): Piece {
  const st = STYLES[mood];
  const r = new Rand(seed * 7919 + mood.length * 104729);
  const bpm = r.int(st.tempo[0], st.tempo[1]);
  const beat = 60 / bpm;
  const key = 48 + r.pick(st.keys);
  const prog = r.pick(st.progressions);
  const notes: MusicNote[] = [];
  const scaleNotes: number[] = [];
  for (let o = -2; o <= 3; o++) for (const s of st.scale) scaleNotes.push(key + 12 + o * 12 + s);
  const nearest = (n: number, pool: number[]) => pool.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), pool[0]);

  // motif : 4 à 6 notes (degrés relatifs) et rythme en temps
  const RHYTHMS = [[2, 1, 1, 2, 2], [1, 1, 2, 4], [1.5, 0.5, 2, 1, 3], [3, 1, 2, 2], [1, 1, 1, 1, 4], [2, 2, 1, 3]];
  const motif = (): { steps: number[]; rhythm: number[] } => {
    const rhythm = r.pick(RHYTHMS);
    const steps: number[] = [0];
    for (let i = 1; i < rhythm.length; i++) steps.push(steps[i - 1] + r.pick([-2, -1, -1, 1, 1, 2, 3, -3, 0]));
    return { steps, rhythm };
  };
  const themeA = motif(), themeB = motif();
  let t = 0;
  const bar = 4 * beat;

  const chordBar = (c: Chord, at: number, style: 'block' | 'arp' | 'pad', vel: number) => {
    const root = key + c[0];
    const tones = c[1].map((iv) => root + iv + 12);
    if (st.voices.bass) notes.push({ t: at, n: root - 12 + (c[0] > 6 ? -12 : 0) + 12, dur: bar * 1.05, vel: vel * 0.8, voice: 'bass' });
    if (style === 'pad' || st.voices.chords === 'pad') for (const n of tones) notes.push({ t: at, n, dur: bar * 1.1, vel: vel * 0.45, voice: 'pad' });
    if (style === 'arp' && st.voices.chords !== 'pad') {
      // arpège brisé et clairsemé (croches avec silences)
      const pattern = r.pick([[0, 1, 2, 3, 2, 1], [0, 2, 1, 3], [0, 1, 2, 1, 3, 2, 1, 0]]);
      const step = (bar / pattern.length) * (pattern.length > 6 ? 1 : 1);
      pattern.forEach((k, i) => {
        if (r.next() < 0.18) return;
        notes.push({ t: at + i * step, n: tones[Math.min(k, tones.length - 1)], dur: step * 3, vel: vel * (i === 0 ? 0.75 : 0.5), voice: 'piano' });
      });
    } else if (style === 'block' && st.voices.chords !== 'pad') for (const n of tones) notes.push({ t: at + r.next() * 0.03, n, dur: bar, vel: vel * 0.5, voice: 'piano' });
  };

  const melodyBars = (theme: { steps: number[]; rhythm: number[] }, bars: number, at: number, vary: boolean, octave = 0) => {
    for (let b = 0; b < bars; b++) {
      const c = prog[b % prog.length];
      const chordTones = c[1].map((iv) => key + c[0] + iv + 12);
      const pool = scaleNotes.filter((n) => Math.abs(n - st.center - octave) <= 9);
      const anchor = nearest(st.center + octave + (c[0] % 12 > 6 ? -2 : 1), chordTones.flatMap((n) => [n - 12, n, n + 12]));
      let ti = at + b * bar;
      const idx0 = pool.indexOf(nearest(anchor, pool));
      theme.rhythm.forEach((len, i) => {
        if (ti >= at + (b + 1) * bar - 0.01) return;
        if (r.next() > st.density + 0.25) {
          ti += len * beat;
          return;
        }
        let step = theme.steps[i];
        if (vary && i >= theme.rhythm.length - 2) step += r.pick([-1, 1, 2]);
        const n = pool[Math.max(0, Math.min(pool.length - 1, idx0 + step))];
        // le premier temps tombe sur une note de l'accord
        const note = i === 0 ? nearest(n, chordTones.flatMap((x) => [x - 12, x, x + 12])) : n;
        notes.push({ t: ti, n: note, dur: Math.max(beat, len * beat * 1.6), vel: 0.62 + r.next() * 0.2, voice: st.voices.melody });
        if (st.voices.sparkle && r.next() < 0.2) notes.push({ t: ti + beat / 2, n: note + 12, dur: beat, vel: 0.3, voice: 'bell' });
        ti += len * beat;
      });
    }
  };

  // intro : accords seuls
  for (let b = 0; b < 2; b++) chordBar(prog[b % prog.length], t + b * bar, 'arp', 0.55);
  t += 2 * bar;
  // A
  for (let b = 0; b < 4; b++) chordBar(prog[b % prog.length], t + b * bar, 'arp', 0.5);
  melodyBars(themeA, 4, t, false);
  t += 4 * bar;
  // A'
  for (let b = 0; b < 4; b++) chordBar(prog[b % prog.length], t + b * bar, b % 2 ? 'arp' : 'block', 0.5);
  melodyBars(themeA, 4, t, true);
  t += 4 * bar;
  // B (une octave plus haut, plus clairsemé)
  for (let b = 0; b < 4; b++) chordBar(prog[(b + 2) % prog.length], t + b * bar, 'pad', 0.45);
  melodyBars(themeB, 4, t, false, 5);
  t += 4 * bar;
  // A (reprise)
  for (let b = 0; b < 4; b++) chordBar(prog[b % prog.length], t + b * bar, 'arp', 0.45);
  melodyBars(themeA, 4, t, r.next() < 0.5);
  t += 4 * bar;
  // coda : tonique tenue
  chordBar([0, prog[0][1]], t, 'block', 0.4);
  notes.push({ t: t + beat * 2, n: key + 24, dur: bar * 2, vel: 0.35, voice: st.voices.melody });
  t += bar * 2.5;
  notes.sort((a, b) => a.t - b.t);
  return { title: r.pick(st.names), mood, notes, length: t };
}

// ---------- bibliothèque des musiques importées (IndexedDB, sur l'appareil) ----------
const DB = 'lecraft-music';
const STORE = 'tracks';
export interface TrackInfo {
  name: string;
  mood: MusicMood | 'any';
  size: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** Ambiance déduite du chemin ou du nom du fichier (dossiers du pack : game, nether, end, menu…). */
export function moodFromPath(path: string): MusicMood | 'any' {
  const p = path.toLowerCase();
  if (/nether/.test(p)) return 'nether';
  if (/(^|\/|_|\b)end(\b|\/|_)|the_end|boss/.test(p)) return 'end';
  if (/menu/.test(p)) return 'menu';
  if (/creative/.test(p)) return 'creative';
  if (/water|ocean|aqua/.test(p)) return 'underwater';
  if (/cave|deep|grotte/.test(p)) return 'cave';
  if (/night|nuit/.test(p)) return 'night';
  if (/music\/game\/|\/game\//.test(p)) return 'day';
  return 'any';
}

export const MusicLibrary = {
  async list(): Promise<TrackInfo[]> {
    try {
      const db = await openDb();
      return await new Promise((res) => {
        const out: TrackInfo[] = [];
        const tx = db.transaction(STORE, 'readonly');
        const c = tx.objectStore(STORE).openCursor();
        c.onsuccess = () => {
          const cur = c.result;
          if (!cur) return;
          const v = cur.value as { mood: TrackInfo['mood']; blob: Blob };
          out.push({ name: String(cur.key), mood: v.mood, size: v.blob.size });
          cur.continue();
        };
        tx.oncomplete = () => (db.close(), res(out));
        tx.onerror = () => (db.close(), res(out));
      });
    } catch {
      return [];
    }
  },
  async add(entries: { name: string; mood: TrackInfo['mood']; blob: Blob }[]): Promise<number> {
    if (!entries.length) return 0;
    const db = await openDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      for (const e of entries) tx.objectStore(STORE).put({ mood: e.mood, blob: e.blob }, e.name);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return entries.length;
  },
  async get(name: string): Promise<Blob | null> {
    const db = await openDb();
    return new Promise((res) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(name);
      r.onsuccess = () => (db.close(), res((r.result as { blob: Blob } | undefined)?.blob ?? null));
      r.onerror = () => (db.close(), res(null));
    });
  },
  async clear(): Promise<void> {
    const db = await openDb();
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
    db.close();
  },
};
