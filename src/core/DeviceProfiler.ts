import type { QualityLevel } from './Config';

export interface DeviceInfo {
  level: QualityLevel;
  gpu: string;
  cores: number;
  memoryGB: number;
  maxTexture: number;
  screen: string;
  reason: string;
}

/**
 * Détection heuristique des capacités du téléphone (GPU, cœurs CPU, mémoire, écran).
 * Complétée à l'exécution par l'ajustement dynamique (AdaptiveQuality) selon les FPS mesurés.
 */
export function detectDevice(): DeviceInfo {
  let gpu = 'inconnu';
  let maxTexture = 2048;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* ignore */
  }
  const cores = navigator.hardwareConcurrency || 4;
  const memoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const g = gpu.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  // GPU mobiles connus
  const adreno = /adreno[^\d]*(\d{3})/.exec(g);
  const mali = /mali-?([gt]?)(\d+)/.exec(g);
  if (adreno) {
    const n = Number(adreno[1]);
    score += n >= 640 ? 3 : n >= 610 ? 2 : n >= 500 ? 1 : 0;
    reasons.push(`Adreno ${n}`);
  } else if (mali) {
    const n = Number(mali[2]);
    score += mali[1] === 'g' ? (n >= 76 ? 3 : n >= 57 ? 2 : 1) : 0;
    reasons.push(`Mali ${mali[1]}${n}`);
  } else if (/powervr|sgx|videocore/.test(g)) {
    score += 0;
    reasons.push('GPU faible');
  } else if (/swiftshader|llvmpipe|software/.test(g)) {
    score += 0;
    reasons.push('rendu logiciel');
  } else {
    score += 2; // GPU de bureau ou inconnu performant
    reasons.push('GPU générique');
  }
  score += cores >= 8 ? 1 : 0;
  score += memoryGB >= 6 ? 1 : memoryGB <= 2 ? -1 : 0;
  const px = screen.width * screen.height * (window.devicePixelRatio || 1) ** 2;
  if (px > 3_500_000) score -= 0.5; // écrans très haute résolution : coût de fill-rate
  const level: QualityLevel = score >= 4 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW';
  return { level, gpu, cores, memoryGB, maxTexture, screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`, reason: reasons.join(', ') };
}

/**
 * Ajustement dynamique : si les FPS restent sous la cible, on réduit d'abord la résolution
 * puis la distance de rendu ; on remonte prudemment si la marge est confortable.
 */
export class AdaptiveQuality {
  private samples: number[] = [];
  private cooldown = 3;
  constructor(private onAdjust: (dir: -1 | 1) => void) {}
  update(dt: number, target: number) {
    this.cooldown -= dt;
    this.samples.push(dt);
    if (this.samples.length > 90) this.samples.shift();
    if (this.cooldown > 0 || this.samples.length < 45) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const fps = 1 / avg;
    if (fps < target * 0.85) {
      this.onAdjust(-1);
      this.cooldown = 3;
      this.samples.length = 0;
    } else if (fps > target * 0.98) {
      this.onAdjust(1);
      this.cooldown = 20;
      this.samples.length = 0;
    }
  }
}
