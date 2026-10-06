import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { TextureManager } from './TextureManager';
import { extrudeIcon } from './ItemExtrude';

/**
 * Modèles 3D des objets tombés au sol, comme dans l'édition Java : les blocs pleins sont de petits
 * cubes texturés (1/4 de bloc), les autres objets des icônes plates (1/2 bloc) visibles des deux côtés.
 * Géométries et matériaux sont partagés par type d'objet.
 */
export class DroppedItemModels {
  private cache = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; half: number }>();
  private tiles = new Map<number, THREE.Texture>();
  private mats: THREE.Material[] = [];

  constructor(private tm: TextureManager, private icon: (id: string) => THREE.Texture) {}

  private tileTex(i: number, tinted: boolean): THREE.Texture {
    const key = i * 2 + (tinted ? 1 : 0);
    let t = this.tiles.get(key);
    if (!t) {
      t = new THREE.CanvasTexture(this.tm.tile(i, tinted ? [124, 189, 74] : undefined));
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Nouvel objet 3D pour l'objet `id` ; `userData.half` = demi-hauteur (pour le poser au sol). */
  create(id: string): THREE.Mesh {
    let c = this.cache.get(id);
    if (!c) {
      const def = ItemRegistry.get(id);
      const b = def && 'block' in def.icon ? BlockRegistry.byName(def.icon.block) : null;
      if (b && !this.tm.flatIcon(b)) {
        const tinted = b.key.endsWith('leaves') || b.key === 'grass_block';
        const mats = [0, 1, 2, 3, 4, 5].map((f) => {
          const m = new THREE.MeshBasicMaterial({ map: this.tileTex(b.faceTiles[f], tinted), transparent: b.render !== 'cube', alphaTest: 0.3 });
          this.mats.push(m);
          return m;
        });
        c = { geo: new THREE.BoxGeometry(0.25, 0.25, 0.25), mat: mats, half: 0.125 };
      } else {
        // objet : modèle extrudé d'un pixel (comme l'édition Java), demi-bloc de côté
        const m = new THREE.MeshBasicMaterial({ map: this.icon(id), alphaTest: 0.1 });
        this.mats.push(m);
        const geo = extrudeIcon(this.tm.iconCanvas(id));
        geo.scale(0.5, 0.5, 0.5);
        c = { geo, mat: m, half: 0.25 };
      }
      this.cache.set(id, c);
    }
    const mesh = new THREE.Mesh(c.geo, c.mat);
    mesh.userData.half = c.half;
    return mesh;
  }

  dispose() {
    this.cache.forEach((c) => c.geo.dispose());
    this.cache.clear();
    this.mats.forEach((m) => m.dispose());
    this.mats = [];
    this.tiles.forEach((t) => t.dispose());
    this.tiles.clear();
  }
}
