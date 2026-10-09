import type { SoundFx } from '../core/GameContext';
import type { Settings } from '../core/Settings';
import { buildAmbience, buildSounds, SynthContext } from './Synth';
import { mapSound } from './SoundMap';

import { composePiece, MusicLibrary, type MusicMood, type MusicNote, type TrackInfo } from './Music';

/**
 * Gestionnaire audio (WebAudio) : effets spatialisés (panoramique + atténuation),
 * ambiances en boucle mixées selon le contexte, musique générative.
 * Bus séparés Musique / Effets / Ambiance réglables dans les paramètres.
 */
export class AudioManager implements SoundFx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private ambNodes = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private musicTimer = 4;
  private musicMood: MusicMood = 'menu';
  private musicPlaying = false;
  /** Pièce en cours : bus dédié (fondu de sortie), fin prévue, ambiance. */
  private current: { gain: GainNode; end: number; mood: MusicMood; title: string; sources: AudioScheduledSourceNode[]; queue?: MusicNote[]; t0?: number } | null = null;
  private reverb: ConvolverNode | null = null;
  private pieceSeed = (Math.random() * 1e6) | 0;
  /** Musiques importées par l'utilisateur (titres par ambiance). */
  private tracks: TrackInfo[] = [];
  private trackBuffers = new Map<string, AudioBuffer>();
  /** Titre en cours (affiché dans les options et utilisé par les tests). */
  nowPlaying = '';
  private recent = new Map<string, number>();
  ready = false;
  /** Sons fournis par les add-ons : identifiant → fichiers audio (une variante tirée au hasard). */
  private external = new Map<string, { data: Uint8Array[]; volume: number; pitch: number }>();
  private decoded = new Map<string, AudioBuffer[]>();
  private decoding = new Set<string>();

  constructor(private settings: Settings) {}

  /** À appeler lors d'une interaction utilisateur (politique d'autoplay). */
  unlock() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.connect(c.destination);
      this.sfx = c.createGain();
      this.music = c.createGain();
      this.amb = c.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.amb.connect(this.master);
      const s = new SynthContext(c.sampleRate);
      const all = { ...buildSounds(s), ...buildAmbience(s) };
      for (const [k, data] of Object.entries(all)) {
        const b = c.createBuffer(1, data.length, c.sampleRate);
        b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
        this.buffers.set(k, b);
      }
      this.applyVolumes();
      this.ready = true;
      void this.reloadTracks();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.sfx.gain.value = this.settings.sfxVolume;
    this.music.gain.value = this.settings.musicVolume * 0.6;
    this.amb.gain.value = this.settings.ambientVolume * 0.7;
  }

  suspend() {
    this.ctx?.suspend().catch(() => {});
  }
  resume() {
    this.ctx?.resume().catch(() => {});
  }

  setListener(x: number, y: number, z: number, yaw: number) {
    this.listener = { x, y, z, yaw };
  }

  /** Enregistre un son d'add-on (fichiers .ogg/.wav/.mp3). */
  addExternal(id: string, data: Uint8Array[], volume = 1, pitch = 1) {
    this.external.set(id.toLowerCase(), { data, volume, pitch });
    this.decoded.delete(id.toLowerCase());
  }
  clearExternal() {
    this.external.clear();
    this.decoded.clear();
  }
  hasSound(id: string): boolean {
    return this.external.has(id.toLowerCase()) || mapSound(id) !== null;
  }

  /** Joue un son par identifiant du jeu de référence (son d'add-on, sinon équivalent synthétisé). */
  playId(id: string, opts: { x?: number; y?: number; z?: number; volume?: number; pitch?: number } = {}) {
    const k = id.toLowerCase().replace(/^minecraft:/, '');
    const ext = this.external.get(k);
    if (ext && this.ctx && this.ready) {
      const bufs = this.decoded.get(k);
      if (bufs?.length) {
        this.playBuffer(bufs[Math.floor(Math.random() * bufs.length)], { ...opts, volume: (opts.volume ?? 1) * ext.volume, pitch: (opts.pitch ?? 1) * ext.pitch });
        return;
      }
      if (!this.decoding.has(k)) {
        this.decoding.add(k);
        const c = this.ctx;
        Promise.all(ext.data.map((d) => c.decodeAudioData(d.slice().buffer as ArrayBuffer).catch(() => null)))
          .then((list) => {
            const ok = list.filter((b): b is AudioBuffer => !!b);
            this.decoded.set(k, ok);
            if (ok.length) this.playBuffer(ok[Math.floor(Math.random() * ok.length)], { ...opts, volume: (opts.volume ?? 1) * ext.volume, pitch: (opts.pitch ?? 1) * ext.pitch });
          })
          .finally(() => this.decoding.delete(k));
        return;
      }
    }
    const m = mapSound(k);
    if (m) this.play(m, opts);
  }

  play(name: string, opts: { x?: number; y?: number; z?: number; volume?: number; pitch?: number } = {}) {
    if (!this.ctx || !this.ready || this.ctx.state !== 'running') return;
    const buf = this.buffers.get(name);
    if (!buf) {
      // son d'add-on (créatures d'add-ons, scripts)
      if (this.external.has(name.toLowerCase())) this.playId(name, opts);
      return;
    }
    // limite les doublons dans la même frame
    const now = this.ctx.currentTime;
    const last = this.recent.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.recent.set(name, now);
    let vol = opts.volume ?? 1;
    let pan = 0;
    if (opts.x !== undefined) {
      const dx = opts.x - this.listener.x, dy = (opts.y ?? this.listener.y) - this.listener.y, dz = (opts.z ?? this.listener.z) - this.listener.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 40) return;
      vol *= Math.max(0, 1 - d / 40) ** 1.5;
      const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
      pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.8 : 0;
    }
    if (vol < 0.01) return;
    this.output(buf, vol, pan, (opts.pitch ?? 1) * (0.92 + Math.random() * 0.16));
  }

  private playBuffer(buf: AudioBuffer, opts: { x?: number; y?: number; z?: number; volume?: number; pitch?: number }) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    let vol = opts.volume ?? 1;
    let pan = 0;
    if (opts.x !== undefined) {
      const dx = opts.x - this.listener.x, dy = (opts.y ?? this.listener.y) - this.listener.y, dz = (opts.z ?? this.listener.z) - this.listener.z;
      const d = Math.hypot(dx, dy, dz);
      const range = 16 * Math.max(1, vol);
      if (d > range) return;
      vol = Math.min(1, vol) * Math.max(0, 1 - d / range);
      const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
      pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.8 : 0;
    }
    if (vol < 0.01) return;
    this.output(buf, vol, pan, opts.pitch ?? 1);
  }

  private output(buf: AudioBuffer, vol: number, pan: number, rate: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.max(0.1, Math.min(4, rate));
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.sfx);
    src.start();
  }

  blockSound(kind: 'break' | 'place' | 'step' | 'hit', material: string, x?: number, y?: number, z?: number) {
    this.play(`${kind}_${material}`, { x, y, z, volume: kind === 'step' ? 0.5 : 1 });
  }

  /** Volume cible de chaque boucle d'ambiance (0..1). */
  setAmbience(levels: Record<string, number>, dt: number) {
    if (!this.ctx || !this.ready) return;
    for (const name of ['wind', 'rain', 'cave', 'crickets', 'birds']) {
      const target = levels[name] ?? 0;
      let node = this.ambNodes.get(name);
      if (!node && target > 0.01) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers.get(name)!;
        src.loop = true;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(this.amb);
        src.start();
        node = { src, gain };
        this.ambNodes.set(name, node);
      }
      if (node) {
        const g = node.gain.gain.value;
        node.gain.gain.value = g + (target - g) * Math.min(1, dt * 1.5);
        if (target < 0.01 && node.gain.gain.value < 0.005) {
          node.src.stop();
          node.src.disconnect();
          this.ambNodes.delete(name);
        }
      }
    }
  }

  stopAmbience() {
    for (const n of this.ambNodes.values()) {
      try {
        n.src.stop();
      } catch {
        /* déjà arrêté */
      }
      n.src.disconnect();
    }
    this.ambNodes.clear();
  }

  /** Change l'ambiance musicale ; un changement de dimension coupe la pièce en cours (fondu). */
  setMusicMood(m: MusicMood) {
    if (m === this.musicMood) return;
    const big = (x: MusicMood) => (x === 'nether' || x === 'end' || x === 'menu' || x === 'paper' ? x : 'overworld');
    const prev = this.musicMood;
    this.musicMood = m;
    if (big(prev) !== big(m) && this.current) {
      this.stopMusic(2);
      this.musicTimer = m === 'menu' ? 1.5 : 6 + Math.random() * 10;
    }
  }

  /** Recharge la liste des musiques importées. */
  async reloadTracks() {
    this.tracks = await MusicLibrary.list();
    this.trackBuffers.clear();
    return this.tracks;
  }

  /** Arrête la musique en cours (fondu en secondes). */
  stopMusic(fade = 1) {
    const c = this.ctx, cur = this.current;
    if (!c || !cur) return;
    const now = c.currentTime;
    cur.gain.gain.cancelScheduledValues(now);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
    cur.gain.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => {
      for (const src of cur.sources)
        try {
          src.stop();
        } catch {
          /* déjà arrêté */
        }
      cur.gain.disconnect();
    }, fade * 1000 + 100);
    this.current = null;
    this.musicPlaying = false;
    this.nowPlaying = '';
  }

  /** Passe immédiatement à une autre pièce (options : « Morceau suivant »). */
  skipMusic() {
    this.stopMusic(0.5);
    this.musicTimer = 0.6;
  }

  /** Musique : pièce importée (si l'ambiance en a) ou composée, puis un silence de 1 à 3 minutes. */
  updateMusic(dt: number) {
    if (!this.ctx || !this.ready || this.settings.musicVolume <= 0) return;
    if (this.current && this.ctx.currentTime >= this.current.end) {
      this.current = null;
      this.musicPlaying = false;
      this.nowPlaying = '';
      this.musicTimer = this.musicMood === 'menu' ? 8 + Math.random() * 8 : 60 + Math.random() * 120;
    }
    // notes de la pièce composée programmées par petites fenêtres (pas de pic de création de nœuds)
    const cur = this.current;
    if (cur?.queue?.length) {
      const horizon = this.ctx.currentTime + 2.5;
      const late = this.ctx.currentTime - 0.05;
      while (cur.queue.length && cur.t0! + cur.queue[0].t < horizon) {
        const n = cur.queue.shift()!;
        if (cur.t0! + n.t >= late) this.voice(n, cur.t0!, cur.gain, cur.sources);
      }
      // les sources terminées sont oubliées
      if (cur.sources.length > 400) cur.sources.splice(0, cur.sources.length - 200);
    }
    if (this.musicPlaying) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicPlaying = true;
    const mood = this.musicMood;
    const own = this.tracks.filter((t) => t.mood === mood || (t.mood === 'any' && mood !== 'nether' && mood !== 'end') || (t.mood === 'day' && (mood === 'night' || mood === 'creative')));
    if (own.length && Math.random() < 0.75) void this.playImported(own[Math.floor(Math.random() * own.length)], mood);
    else this.playPiece(mood);
  }

  private musicBus(): GainNode {
    const c = this.ctx!;
    if (!this.reverb) {
      // réverbération de salle (réponse impulsionnelle générée : bruit à décroissance exponentielle)
      const len = Math.floor(c.sampleRate * 3.2);
      const ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        let seed = 1234 + ch * 77;
        for (let i = 0; i < len; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          d[i] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - i / len, 3.2);
        }
      }
      this.reverb = c.createConvolver();
      this.reverb.buffer = ir;
      const wet = c.createGain();
      wet.gain.value = 0.32;
      this.reverb.connect(wet).connect(this.music);
    }
    const g = c.createGain();
    g.gain.value = 1;
    g.connect(this.music);
    g.connect(this.reverb);
    return g;
  }

  private playPiece(mood: MusicMood) {
    const c = this.ctx!;
    const piece = composePiece(mood, this.pieceSeed++);
    const bus = this.musicBus();
    const t0 = c.currentTime + 0.2;
    this.current = { gain: bus, end: t0 + piece.length + 3, mood, title: piece.title, sources: [], queue: piece.notes.slice(), t0 };
    this.nowPlaying = piece.title;
  }

  private async playImported(t: TrackInfo, mood: MusicMood) {
    const c = this.ctx!;
    let buf = this.trackBuffers.get(t.name);
    if (!buf) {
      const blob = await MusicLibrary.get(t.name);
      if (!blob) return this.playPiece(mood);
      try {
        buf = await c.decodeAudioData(await blob.arrayBuffer());
      } catch {
        return this.playPiece(mood);
      }
      if (this.trackBuffers.size > 3) this.trackBuffers.clear();
      this.trackBuffers.set(t.name, buf);
    }
    if (this.musicMood !== mood || !this.musicPlaying) return;
    const g = c.createGain();
    g.connect(this.music);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.start(c.currentTime + 0.1);
    this.current = { gain: g, end: c.currentTime + buf.duration + 1, mood, title: t.name, sources: [src] };
    this.nowPlaying = t.name.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '');
  }

  /** Instruments synthétisés : piano feutré, nappe, basse, cloche. */
  private voice(n: MusicNote, t0: number, out: AudioNode, sources: AudioScheduledSourceNode[]) {
    const c = this.ctx!;
    const at = t0 + n.t;
    const f = 440 * Math.pow(2, (n.n - 69) / 12);
    const g = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    g.connect(lp).connect(out);
    const mine: OscillatorNode[] = [];
    const osc = (type: OscillatorType, freq: number, gain: number, detune = 0) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const og = c.createGain();
      og.gain.value = gain;
      o.connect(og).connect(g);
      sources.push(o);
      mine.push(o);
      return o;
    };
    let stopAt = at + n.dur + 0.1;
    if (n.voice === 'piano') {
      // attaque franche, décroissance plus rapide dans l'aigu, harmoniques qui s'éteignent vite
      const decay = Math.max(1.2, 5.5 - (n.n - 48) * 0.07);
      const v = 0.11 * n.vel;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + 0.006);
      g.gain.exponentialRampToValueAtTime(v * 0.35, at + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(decay, n.dur + 1.5));
      lp.frequency.setValueAtTime(Math.min(9000, f * 8), at);
      lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2), at + 1.2);
      osc('sine', f, 1, -3);
      osc('sine', f, 0.6, 4);
      osc('triangle', f * 2, 0.22);
      osc('sine', f * 3, 0.08);
      stopAt = at + Math.min(decay, n.dur + 1.5) + 0.05;
    } else if (n.voice === 'pad') {
      const v = 0.035 * n.vel;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + Math.min(1.5, n.dur * 0.4));
      g.gain.setValueAtTime(v, at + n.dur * 0.7);
      g.gain.linearRampToValueAtTime(0, at + n.dur + 1);
      lp.frequency.value = 900;
      osc('sawtooth', f, 0.5, -7);
      osc('sawtooth', f, 0.5, 7);
      osc('sine', f / 2, 0.6);
      stopAt = at + n.dur + 1.1;
    } else if (n.voice === 'bass') {
      const v = 0.09 * n.vel;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, at + n.dur + 0.5);
      lp.frequency.value = 500;
      osc('sine', f, 1);
      osc('triangle', f, 0.3);
      stopAt = at + n.dur + 0.55;
    } else {
      // cloche : partiels inharmoniques
      const v = 0.07 * n.vel;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(2.5, n.dur));
      lp.frequency.value = 7000;
      osc('sine', f, 1);
      osc('sine', f * 2.76, 0.25);
      osc('sine', f * 5.4, 0.08);
      stopAt = at + Math.max(2.5, n.dur) + 0.05;
    }
    for (const o of mine) {
      o.start(at);
      o.stop(stopAt);
      o.onended = () => o.disconnect();
    }
  }

  dispose() {
    this.stopAmbience();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.buffers.clear();
  }
}
