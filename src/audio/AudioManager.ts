import type { SoundFx } from '../core/GameContext';
import type { Settings } from '../core/Settings';
import { buildAmbience, buildSounds, SynthContext } from './Synth';
import { mapSound } from './SoundMap';

const SCALES = {
  day: [0, 2, 4, 7, 9, 12, 14, 16],
  night: [0, 3, 5, 7, 10, 12, 15],
  menu: [0, 2, 4, 7, 9, 11, 12],
};

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
  private musicTimer = 20;
  private musicMood: keyof typeof SCALES = 'menu';
  private musicPlaying = false;
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
    if (!buf) return;
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

  setMusicMood(m: keyof typeof SCALES) {
    this.musicMood = m;
  }

  /** Musique générative : de courtes pièces pentatoniques espacées de silences. */
  updateMusic(dt: number) {
    if (!this.ctx || !this.ready || this.settings.musicVolume <= 0) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0 || this.musicPlaying) return;
    this.musicPlaying = true;
    const c = this.ctx;
    const scale = SCALES[this.musicMood];
    const root = this.musicMood === 'night' ? 196 : this.musicMood === 'menu' ? 220 : 261.6;
    const t0 = c.currentTime + 0.1;
    const notes = 28 + Math.floor(Math.random() * 16);
    let t = t0;
    let deg = Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      deg = Math.max(0, Math.min(scale.length - 1, deg + Math.floor(Math.random() * 5) - 2));
      const f = root * Math.pow(2, scale[deg] / 12);
      this.note(f, t, 1.8, 0.09);
      if (i % 4 === 0) this.note(root / 2 * Math.pow(2, scale[(deg + 2) % scale.length] / 12), t, 3.2, 0.06);
      t += [0.5, 0.75, 1, 1, 1.5][Math.floor(Math.random() * 5)];
    }
    const total = t - t0 + 3;
    setTimeout(() => {
      this.musicPlaying = false;
      this.musicTimer = 90 + Math.random() * 150;
    }, total * 1000);
  }

  private note(freq: number, at: number, dur: number, gain: number) {
    const c = this.ctx!;
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = 'sine';
    o2.type = 'triangle';
    o1.frequency.value = freq;
    o2.frequency.value = freq * 2.001;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    o1.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.music);
    o1.start(at);
    o2.start(at);
    o1.stop(at + dur + 0.05);
    o2.stop(at + dur + 0.05);
  }

  dispose() {
    this.stopAmbience();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.buffers.clear();
  }
}
