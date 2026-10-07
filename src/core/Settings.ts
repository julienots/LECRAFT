import { QUALITY_PROFILES, type Difficulty, type QualityLevel } from './Config';

export interface ControlLayout {
  [button: string]: { x: number; y: number }; // position en % de l'écran (coin du bouton)
}

export interface Settings {
  quality: QualityLevel;
  autoQuality: boolean;
  renderDistance: number;
  fpsCap: 30 | 45 | 60;
  shadows: 'off' | 'blob' | 'blob+ao';
  particles: 'off' | 'low' | 'high';
  waterQuality: 'simple' | 'animated';
  /** Shaders : lumière du soleil, eau réfléchissante, brouillard, couleurs ; « ultra » ajoute les ombres projetées. */
  shaders: 'off' | 'on' | 'ultra';
  resolutionScale: number; // 0.5..1
  clouds: boolean;
  sensitivity: number; // 0.2..3
  joystickSize: number; // px
  buttonScale: number; // 0.7..1.4
  invertY: boolean;
  leftHanded: boolean;
  /** Schéma tactile : joystick ou croix directionnelle classique. */
  controlScheme: 'joystick' | 'dpad';
  /** Visée tactile : au doigt (on pose/casse là où on touche) ou au viseur (centre de l'écran). */
  touchAim: 'finger' | 'crosshair';
  autoJump: boolean;
  layout: ControlLayout;
  musicVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  difficulty: Difficulty;
  fov: number;
  orientation: 'landscape' | 'portrait' | 'auto';
  showFps: boolean;
  viewBobbing: boolean;
  haptics: boolean;
}

const KEY = 'lecraft.settings.v1';

export function defaultSettings(q: QualityLevel = 'MEDIUM'): Settings {
  const p = QUALITY_PROFILES[q];
  return {
    quality: q,
    autoQuality: true,
    renderDistance: p.renderDistance,
    fpsCap: q === 'LOW' ? 30 : 60,
    shadows: p.shadows,
    particles: q === 'LOW' ? 'low' : 'high',
    waterQuality: p.waterQuality,
    shaders: 'on',
    resolutionScale: p.pixelRatio,
    clouds: p.clouds,
    sensitivity: 1,
    joystickSize: 120,
    buttonScale: 1,
    invertY: false,
    leftHanded: false,
    controlScheme: 'joystick',
    touchAim: 'finger',
    autoJump: true,
    layout: {},
    musicVolume: 0.5,
    sfxVolume: 0.8,
    ambientVolume: 0.6,
    difficulty: 'normal',
    fov: 72,
    orientation: 'landscape',
    showFps: false,
    viewBobbing: true,
    haptics: true,
  };
}

/** Applique un profil de qualité aux réglages graphiques. */
export function applyQuality(s: Settings, q: QualityLevel) {
  const p = QUALITY_PROFILES[q];
  s.quality = q;
  s.renderDistance = p.renderDistance;
  s.shadows = p.shadows;
  s.waterQuality = p.waterQuality;
  s.resolutionScale = p.pixelRatio;
  s.clouds = p.clouds;
  s.particles = q === 'LOW' ? 'low' : 'high';
  s.fpsCap = q === 'LOW' ? 30 : q === 'MEDIUM' ? 45 : 60;
}

export function loadSettings(fallbackQuality: QualityLevel): { settings: Settings; fresh: boolean } {
  const def = defaultSettings(fallbackQuality);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { settings: def, fresh: true };
    const parsed = JSON.parse(raw) as Partial<Settings> & { gfxV?: number };
    const settings = { ...def, ...parsed, layout: { ...(parsed.layout ?? {}) } };
    // réglages graphiques d'avant la v2.16 : pleine résolution et distance de vue plus longue
    if ((parsed.gfxV ?? 0) < 2) {
      const p = QUALITY_PROFILES[settings.quality] ?? QUALITY_PROFILES.MEDIUM;
      if (parsed.resolutionScale === undefined || parsed.resolutionScale < p.pixelRatio) settings.resolutionScale = p.pixelRatio;
      if (parsed.renderDistance === undefined || parsed.renderDistance < p.renderDistance) settings.renderDistance = p.renderDistance;
      (settings as Settings & { gfxV?: number }).gfxV = 2;
    }
    return { settings, fresh: false };
  } catch {
    return { settings: def, fresh: true };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible : réglages non persistés */
  }
}
