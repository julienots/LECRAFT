import * as THREE from 'three';
import type { TextureManager } from './TextureManager';
import { TileRegistry } from './TileRegistry';

/** Contour du bloc visé, fissures de minage et prévisualisation de pose (vert = valide, rouge = invalide). */
export class BlockHighlight {
  readonly group = new THREE.Group();
  private outline: THREE.LineSegments;
  private crack: THREE.Mesh;
  private crackTex: THREE.Texture[] = [];
  private preview: THREE.Mesh;
  private previewEdges: THREE.LineSegments;
  private disposables: { dispose(): void }[] = [];

  constructor(textures: TextureManager) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 });
    this.outline = new THREE.LineSegments(edges, lineMat);
    for (let i = 0; i < 10; i++) {
      const t = new THREE.CanvasTexture(textures.tile(TileRegistry.index(`destroy_${i}`)));
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      this.crackTex.push(t);
    }
    const crackMat = new THREE.MeshBasicMaterial({ map: this.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), crackMat);
    const pmat = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.18, depthWrite: false });
    this.preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pmat);
    this.previewEdges = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.7 }));
    this.preview.add(this.previewEdges);
    this.group.add(this.outline, this.crack, this.preview);
    this.disposables.push(edges, lineMat, crackMat, this.crack.geometry, pmat, this.preview.geometry, this.previewEdges.material as THREE.Material, ...this.crackTex);
    this.hide();
  }

  hide() {
    this.outline.visible = this.crack.visible = this.preview.visible = false;
  }

  update(target: { x: number; y: number; z: number } | null, progress: number, preview: { x: number; y: number; z: number; valid: boolean } | null, showPreview: boolean) {
    if (target) {
      this.outline.visible = true;
      this.outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      if (progress > 0) {
        this.crack.visible = true;
        this.crack.position.copy(this.outline.position);
        (this.crack.material as THREE.MeshBasicMaterial).map = this.crackTex[Math.min(9, Math.floor(progress * 10))];
      } else this.crack.visible = false;
    } else {
      this.outline.visible = false;
      this.crack.visible = false;
    }
    if (preview && showPreview) {
      this.preview.visible = true;
      this.preview.position.set(preview.x + 0.5, preview.y + 0.5, preview.z + 0.5);
      const c = preview.valid ? 0x40ff60 : 0xff4040;
      (this.preview.material as THREE.MeshBasicMaterial).color.setHex(c);
      (this.previewEdges.material as THREE.LineBasicMaterial).color.setHex(c);
    } else this.preview.visible = false;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
