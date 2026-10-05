import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import type { TextureManager } from './TextureManager';

/** Géométrie cubique partagée des blocs « entités » (TNT amorcée, sable qui tombe…). */
export const BLOCK_BOX = new THREE.BoxGeometry(0.98, 0.98, 0.98);

const cache = new Map<number, THREE.MeshBasicMaterial[]>();

/** Matériaux des 6 faces d'un bloc (ordre BoxGeometry : +X, -X, +Y, -Y, +Z, -Z), mis en cache. */
export function blockMaterials(textures: TextureManager, id: number): THREE.MeshBasicMaterial[] {
  let m = cache.get(id);
  if (m) return m;
  const b = BlockRegistry.get(id);
  const tex = new Map<number, THREE.MeshBasicMaterial>();
  const mk = (ti: number) => {
    let mat = tex.get(ti);
    if (mat) return mat;
    const t = new THREE.CanvasTexture(textures.tile(ti));
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    mat = new THREE.MeshBasicMaterial({ map: t, color: 0xffffff });
    tex.set(ti, mat);
    return mat;
  };
  const f = b.faceTiles;
  m = [mk(f[0]), mk(f[1]), mk(f[2]), mk(f[3]), mk(f[4]), mk(f[5])];
  cache.set(id, m);
  return m;
}

/** Libère le cache (changement de pack de ressources, fin de partie). */
export function disposeBlockMaterials() {
  const seen = new Set<THREE.Material>();
  for (const list of cache.values())
    for (const m of list) {
      if (seen.has(m)) continue;
      seen.add(m);
      m.map?.dispose();
      m.dispose();
    }
  cache.clear();
}
