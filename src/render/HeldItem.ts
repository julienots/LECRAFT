import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { TextureManager } from './TextureManager';

/** Objet tenu en main (vue à la première personne), rendu dans une scène dédiée au-dessus du monde. */
export class HeldItem {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private holder = new THREE.Group();
  private current = '';
  private obj: THREE.Object3D | null = null;
  private cache = new Map<string, THREE.Object3D>();
  private textures = new Map<number, THREE.Texture>();
  private tint = new THREE.Color(1, 1, 1);
  private mats: THREE.MeshBasicMaterial[] = [];

  constructor(private tm: TextureManager) {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(this.holder);
  }

  private tileTex(i: number): THREE.Texture {
    let t = this.textures.get(i);
    if (!t) {
      t = new THREE.CanvasTexture(this.tm.tile(i, BlockRegistry.blocks.find((b) => b.faceTiles.includes(i) && (b.key.endsWith('leaves') || b.key === 'grass')) ? [124, 189, 74] : undefined));
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      this.textures.set(i, t);
    }
    return t;
  }

  private build(id: string): THREE.Object3D {
    const def = ItemRegistry.get(id);
    if (!id || !def) {
      const m = new THREE.MeshBasicMaterial({ color: 0xd8a888 });
      this.mats.push(m);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), m);
      arm.position.set(0.12, -0.1, 0.15);
      arm.rotation.set(0.15, -0.1, 0);
      return arm;
    }
    if ('block' in def.icon) {
      const b = BlockRegistry.byName(def.icon.block);
      if (b.render !== 'cross') {
        const order = [0, 1, 2, 3, 4, 5];
        const mats = order.map((f) => {
          const m = new THREE.MeshBasicMaterial({ map: this.tileTex(b.faceTiles[f]), transparent: b.render !== 'cube', alphaTest: 0.3 });
          this.mats.push(m);
          return m;
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), mats);
        mesh.rotation.set(0.2, 0.7, 0);
        return mesh;
      }
    }
    const tex = new THREE.CanvasTexture(this.tm.iconCanvas(id));
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
    this.mats.push(m);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), m);
    plane.rotation.set(0, -0.55, 0.15);
    return plane;
  }

  setItem(id: string) {
    if (id === this.current) return;
    this.current = id;
    if (this.obj) this.holder.remove(this.obj);
    let o = this.cache.get(id);
    if (!o) {
      o = this.build(id);
      this.cache.set(id, o);
    }
    this.obj = o;
    this.holder.add(o);
  }

  update(aspect: number, swing: number, bob: number, moving: number, light: number, sneak: boolean) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const s = Math.sin(swing * Math.PI);
    const bx = Math.sin(bob) * 0.025 * moving, by = Math.abs(Math.cos(bob)) * 0.02 * moving;
    this.holder.position.set(0.42 + bx - s * 0.12, -0.36 + by - s * 0.06 - (sneak ? 0.03 : 0), -0.72 - s * 0.12);
    this.holder.rotation.set(-s * 0.9, -0.15, 0);
    this.tint.setScalar(light);
    for (const m of this.mats) m.color.copy(this.tint);
  }

  dispose() {
    this.cache.forEach((o) => o.traverse((c) => (c as THREE.Mesh).geometry?.dispose()));
    this.mats.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
    this.textures.forEach((t) => t.dispose());
  }
}
