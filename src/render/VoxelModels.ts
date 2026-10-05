import * as THREE from 'three';

/**
 * Anciens modèles « voxel » à couleurs de sommets, conservés pour les boss propres à LeCraft
 * (Golem des profondeurs, Liche de givre).
 */
export interface PartDef {
  size: [number, number, number]; // pixels (1/16 bloc)
  at?: [number, number, number]; // centre de la boîte relatif au pivot (pixels)
  pivot?: [number, number, number]; // position du pivot relative au parent (pixels)
  color: string;
  anim?: string;
  children?: PartDef[];
}

const px = (v: number) => v / 16;
const geoCache = new Map<string, THREE.BufferGeometry>();

function boxGeo(size: [number, number, number], at: [number, number, number], color: string): THREE.BufferGeometry {
  const key = `${size}|${at}|${color}`;
  let g = geoCache.get(key);
  if (g) return g;
  g = new THREE.BoxGeometry(px(size[0]), px(size[1]), px(size[2]));
  g.translate(px(at[0]), px(at[1]), px(at[2]));
  const c = new THREE.Color(color);
  const n = g.getAttribute('normal');
  const cols = new Float32Array(n.count * 3);
  // variation de teinte légère par sommet pour un rendu « texturé »
  let seed = size[0] * 13 + size[1] * 7 + size[2] * 3 + c.r * 100;
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i), nx = n.getX(i);
    const shade = ny > 0.5 ? 1 : ny < -0.5 ? 0.55 : Math.abs(nx) > 0.5 ? 0.78 : 0.9;
    seed = (seed * 9301 + 49297) % 233280;
    const v = 0.94 + (seed / 233280) * 0.12;
    cols[i * 3] = c.r * shade * v;
    cols[i * 3 + 1] = c.g * shade * v;
    cols[i * 3 + 2] = c.b * shade * v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geoCache.set(key, g);
  return g;
}

export function build(def: PartDef, parts: Map<string, THREE.Object3D[]>, material: THREE.Material): THREE.Object3D {
  const pivot = new THREE.Group();
  if (def.pivot) pivot.position.set(px(def.pivot[0]), px(def.pivot[1]), px(def.pivot[2]));
  const mesh = new THREE.Mesh(boxGeo(def.size, def.at ?? [0, 0, 0], def.color), material);
  pivot.add(mesh);
  if (def.anim) {
    const list = parts.get(def.anim) ?? [];
    list.push(pivot);
    parts.set(def.anim, list);
  }
  for (const c of def.children ?? []) pivot.add(build(c, parts, material));
  return pivot;
}

function eyes(y: number, z: number, spread: number, color = '#101010', size = 2, white = true): PartDef[] {
  const out: PartDef[] = [];
  for (const s of [-1, 1]) {
    if (white) out.push({ size: [size + 1, size, 0.6], at: [s * spread, y, z], color: '#f0f0f0' });
    out.push({ size: [size, size, 0.8], at: [s * spread + (white ? s * 0.5 : 0), y, z + 0.1], color });
  }
  return out;
}

export const VOXEL_MODELS: Record<string, () => PartDef> = {
  golem: () => ({
    size: [0.01, 0.01, 0.01], color: '#000',
    children: [
      { size: [24, 20, 14], at: [0, 34, 0], color: '#6e6f74', children: [{ size: [8, 8, 1], at: [0, 36, 7.3], color: '#ff9a3a' }, { size: [10, 4, 15], at: [-6, 44, 0], color: '#4f7a3a' }] },
      { size: [8, 22, 8], at: [0, -11, 0], pivot: [-6, 24, 0], color: '#5f6064', anim: 'legFL' },
      { size: [8, 22, 8], at: [0, -11, 0], pivot: [6, 24, 0], color: '#5f6064', anim: 'legFR' },
      { size: [8, 28, 8], at: [0, -12, 0], pivot: [-16, 42, 0], color: '#7a7b80', anim: 'armL', children: [{ size: [10, 8, 10], at: [0, -27, 0], color: '#5a5b60' }] },
      { size: [8, 28, 8], at: [0, -12, 0], pivot: [16, 42, 0], color: '#7a7b80', anim: 'armR', children: [{ size: [10, 8, 10], at: [0, -27, 0], color: '#5a5b60' }] },
      { size: [12, 10, 10], at: [0, 5, 1], pivot: [0, 44, 0], color: '#6a6b70', anim: 'head', children: eyes(5, 6.2, 3, '#ffb040', 3, false) },
    ],
  }),
  liche: () => ({
    size: [0.01, 0.01, 0.01], color: '#000',
    children: [
      { size: [12, 26, 8], at: [0, 19, 0], color: '#5a7aa8', children: [{ size: [14, 6, 10], at: [0, 8, 0], color: '#3a5a88' }, { size: [6, 14, 1], at: [0, 22, 4.2], color: '#a8c8f0' }] },
      { size: [3, 14, 3], at: [0, -6, 0], pivot: [-7.5, 31, 0], color: '#3a5a88', anim: 'armL_fwd' },
      { size: [3, 14, 3], at: [0, -6, 0], pivot: [7.5, 31, 0], color: '#3a5a88', anim: 'armR_fwd', children: [{ size: [1.5, 30, 1.5], at: [0, -12, 4], color: '#6a5a8a' }, { size: [4, 4, 4], at: [0, 3, 4], color: '#c0f0ff' }] },
      { size: [8, 8, 8], at: [0, 4, 0], pivot: [0, 32, 0], color: '#e8e8f0', anim: 'head', children: [...eyes(4, 4.1, 2, '#40e0ff', 2, false), { size: [10, 3, 10], at: [0, 9, 0], color: '#a8e0ff' }, { size: [2, 4, 2], at: [-3, 12, 0], color: '#d0f4ff' }, { size: [2, 5, 2], at: [0, 12.5, 0], color: '#d0f4ff' }, { size: [2, 4, 2], at: [3, 12, 0], color: '#d0f4ff' }] },
    ],
  }),
};
