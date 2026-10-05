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
  resolutionScale: number; // 0.5..1
  clouds: boolean;
  sensitivity: number; // 0.2..3
  joystickSize: number; // px
  buttonScale: number; // 0.7..1.4
  invertY: boolean;
  leftHanded: boolean;
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
    resolutionScale: p.pixelRatio,
    clouds: p.clouds,
    sensitivity: 1,
    joystickSize: 120,
    buttonScale: 1,
    invertY: false,
    leftHanded: false,
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
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { settings: { ...def, ...parsed, layout: { ...(parsed.layout ?? {}) } }, fresh: false };
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
