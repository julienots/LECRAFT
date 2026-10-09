import * as THREE from 'three';
import type { Settings } from '../core/Settings';
import { createChunkMaterials } from './ChunkMaterial';
import { Sky } from './Sky';
import type { TextureManager } from './TextureManager';

/**
 * Renderer WebGL (Three.js) : scène du monde, caméra première personne, matériaux de chunks,
 * ciel, brouillard, résolution dynamique et capture de miniature.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly materials: ReturnType<typeof createChunkMaterials>;
  readonly sky = new Sky();
  /** Échelle dynamique (réduite par la qualité automatique ; mémorisée dans les réglages). */
  private dynamicScale: number;
  shake = 0;

  constructor(readonly canvas: HTMLCanvasElement, textures: TextureManager, private settings: Settings) {
    THREE.ColorManagement.enabled = false;
    this.dynamicScale = Math.max(0.8, Math.min(1, settings.dynScale ?? 1));
    // anticrénelage (MSAA) dès le profil moyen : arêtes lisses comme le jeu original
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'LOW', alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.autoClear = false;
    this.gl.info.autoReset = false;
    this.gl.setClearColor(0x87b8f0, 1);
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 800);
    this.camera.rotation.order = 'YXZ';
    this.materials = createChunkMaterials(textures.atlas);
    this.scene.add(this.sky.group);
    this.scene.add(this.sky.cloudMesh);
    this.resize();
  }

  get pixelRatio() {
    // résolution native de l'écran (plafonnée selon le profil), jamais en dessous d'un pixel
    // d'image par pixel CSS : une image agrandie paraît floue et « pixelisée »
    const dpr = window.devicePixelRatio || 1;
    const cap = this.settings.quality === 'HIGH' ? 3 : this.settings.quality === 'MEDIUM' ? 2 : 1.5;
    const want = Math.min(cap, dpr) * Math.max(0.75, Math.min(1, this.settings.resolutionScale)) * this.dynamicScale;
    return Math.max(Math.min(1, dpr), want);
  }

  /** Ajustement dynamique (résolution) pour tenir la cible FPS. */
  adjustDynamicScale(dir: -1 | 1): boolean {
    const next = Math.max(0.8, Math.min(1, this.dynamicScale + dir * 0.1));
    if (next === this.dynamicScale) return false;
    this.dynamicScale = next;
    this.settings.dynScale = next;
    this.resize();
    return true;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setFog(near: number, far: number, color: THREE.Color) {
    const u = this.materials.uniforms;
    u.uFogNear.value = near;
    u.uFogFar.value = far;
    u.uFogColor.value.copy(color);
    this.gl.setClearColor(color, 1);
  }

  render(extra?: { scene: THREE.Scene; camera: THREE.Camera }) {
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.15;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.15;
    }
    this.gl.info.reset();
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    if (extra) {
      this.gl.clearDepth();
      this.gl.render(extra.scene, extra.camera);
    }
  }

  /** Miniature JPEG du dernier rendu (sélection de monde). */
  thumbnail(): string | null {
    try {
      this.gl.render(this.scene, this.camera);
      const src = this.gl.domElement;
      const c = document.createElement('canvas');
      c.width = 192;
      c.height = 108;
      const ctx = c.getContext('2d')!;
      const sw = src.width, sh = src.height;
      const ratio = 192 / 108;
      let cw = sw, ch = sw / ratio;
      if (ch > sh) {
        ch = sh;
        cw = sh * ratio;
      }
      ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, 192, 108);
      return c.toDataURL('image/jpeg', 0.7);
    } catch {
      return null;
    }
  }

  dispose() {
    this.sky.dispose();
    this.materials.opaque.dispose();
    this.materials.trans.dispose();
    this.gl.dispose();
  }
}
