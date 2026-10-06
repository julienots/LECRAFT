import * as THREE from 'three';
import type { TextureManager } from './TextureManager';
import { TileRegistry } from './TileRegistry';

/** Contour du bloc visé et fissures de minage (comme le jeu de référence : pas de bloc fantôme de pose). */
export class BlockHighlight {
  readonly group = new THREE.Group();
  private outline: THREE.LineSegments;
  private crack: THREE.Mesh;
  private crackTex: THREE.Texture[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(textures: TextureManager) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });
    this.outline = new THREE.LineSegments(edges, lineMat);
    for (let i = 0; i < 10; i++) {
      const t = new THREE.CanvasTexture(textures.tile(TileRegistry.index(`destroy_stage_${i}`)));
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      this.crackTex.push(t);
    }
    const crackMat = new THREE.MeshBasicMaterial({ map: this.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), crackMat);
    this.group.add(this.outline, this.crack);
    this.disposables.push(edges, lineMat, crackMat, this.crack.geometry, ...this.crackTex);
    this.hide();
  }

  hide() {
    this.outline.visible = this.crack.visible = false;
  }

  update(target: { x: number; y: number; z: number; box?: [number, number, number, number, number, number] } | null, progress: number) {
    if (target) {
      this.outline.visible = true;
      const b = target.box ?? [0, 0, 0, 16, 16, 16];
      this.outline.position.set(target.x + (b[0] + b[3]) / 32, target.y + (b[1] + b[4]) / 32, target.z + (b[2] + b[5]) / 32);
      this.outline.scale.set(Math.max(0.01, (b[3] - b[0]) / 16), Math.max(0.01, (b[4] - b[1]) / 16), Math.max(0.01, (b[5] - b[2]) / 16));
      if (progress > 0) {
        this.crack.visible = true;
        this.crack.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
        (this.crack.material as THREE.MeshBasicMaterial).map = this.crackTex[Math.min(9, Math.floor(progress * 10))];
      } else this.crack.visible = false;
    } else {
      this.outline.visible = false;
      this.crack.visible = false;
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
