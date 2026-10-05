import * as THREE from 'three';

/**
 * Modèles voxel des créatures, construits à partir de boîtes colorées (couleurs de sommets
 * avec ombrage par face). Les géométries sont partagées entre instances d'un même type ;
 * chaque instance possède un matériau (teinte lumineuse / dégâts).
 */
interface PartDef {
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

function build(def: PartDef, parts: Map<string, THREE.Object3D[]>, material: THREE.Material): THREE.Object3D {
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

interface QuadOpts {
  body: [number, number, number];
  bodyY: number;
  bodyColor: string;
  leg: [number, number];
  legColor: string;
  legInset: [number, number];
  head: [number, number, number];
  headColor: string;
  headPos: [number, number];
  extras?: PartDef[];
  headExtras?: PartDef[];
}
function quadruped(o: QuadOpts): PartDef {
  const [bw, , bd] = o.body;
  const legs: PartDef[] = [];
  const lx = bw / 2 - o.legInset[0], lz = bd / 2 - o.legInset[1];
  const names = ['legFL', 'legFR', 'legBL', 'legBR'];
  [[-lx, lz], [lx, lz], [-lx, -lz], [lx, -lz]].forEach(([x, z], i) =>
    legs.push({ size: [o.leg[0], o.leg[1], o.leg[0]], at: [0, -o.leg[1] / 2, 0], pivot: [x, o.leg[1], z], color: o.legColor, anim: names[i] }),
  );
  return {
    size: [0.01, 0.01, 0.01],
    color: '#000000',
    children: [
      { size: o.body, at: [0, o.bodyY, 0], color: o.bodyColor, children: o.extras },
      ...legs,
      { size: o.head, at: [0, 0, o.head[2] / 2], pivot: [0, o.headPos[0], o.headPos[1]], color: o.headColor, anim: 'head', children: o.headExtras },
    ],
  };
}

interface HumOpts {
  skin: string;
  shirt: string;
  pants: string;
  height?: number;
  armsForward?: boolean;
  thin?: boolean;
  headExtras?: PartDef[];
  rightHand?: PartDef[];
}
function humanoid(o: HumOpts): PartDef {
  const t = o.thin ? 2 : 4;
  return {
    size: [0.01, 0.01, 0.01],
    color: '#000000',
    children: [
      { size: [8, 12, 4], at: [0, 18, 0], color: o.shirt },
      { size: [t, 12, t], at: [0, -6, 0], pivot: [-2, 12, 0], color: o.pants, anim: 'legFL' },
      { size: [t, 12, t], at: [0, -6, 0], pivot: [2, 12, 0], color: o.pants, anim: 'legFR' },
      { size: [t, 12, t], at: [0, -5, 0], pivot: [-6, 23, 0], color: o.skin, anim: o.armsForward ? 'armL_fwd' : 'armL' },
      { size: [t, 12, t], at: [0, -5, 0], pivot: [6, 23, 0], color: o.skin, anim: o.armsForward ? 'armR_fwd' : 'armR', children: o.rightHand },
      { size: [8, 8, 8], at: [0, 4, 0], pivot: [0, 24, 0], color: o.skin, anim: 'head', children: o.headExtras },
    ],
  };
}

const MODELS: Record<string, () => PartDef> = {
  vachette: () =>
    quadruped({
      body: [14, 12, 20], bodyY: 17, bodyColor: '#5a3a22', leg: [4, 11], legColor: '#4a2e1a', legInset: [3, 3], head: [9, 8, 6], headColor: '#5a3a22', headPos: [19, 9],
      extras: [{ size: [6, 6, 0.5], at: [3, 18, 10.1], color: '#f2efe6' }, { size: [8, 7, 0.5], at: [7.1, 16, 0], color: '#f2efe6' }, { size: [0.5, 5, 9], at: [-7.1, 19, -3], color: '#f2efe6' }],
      headExtras: [...eyes(1.5, 6.2, 2.4), { size: [5, 3, 1], at: [0, -2, 6.5], color: '#e8a0a0' }, { size: [1, 3, 1], at: [-4, 5, 2], color: '#e8e0c8' }, { size: [1, 3, 1], at: [4, 5, 2], color: '#e8e0c8' }],
    }),
  laineux: () =>
    quadruped({
      body: [14, 12, 18], bodyY: 17, bodyColor: '#ecebe2', leg: [4, 11], legColor: '#8a8478', legInset: [3, 3], head: [7, 7, 6], headColor: '#8a8478', headPos: [20, 8],
      extras: [{ size: [15, 3, 19], at: [0, 23, 0], color: '#f4f3ea' }],
      headExtras: [...eyes(1.5, 6.2, 2), { size: [8, 3, 3], at: [0, 4, 1], color: '#ecebe2' }],
    }),
  porcelet: () =>
    quadruped({
      body: [12, 9, 16], bodyY: 11, bodyColor: '#f0a8a8', leg: [4, 6], legColor: '#e89898', legInset: [2, 2], head: [8, 8, 7], headColor: '#f0a8a8', headPos: [11, 8],
      headExtras: [...eyes(1.5, 7.2, 2.5), { size: [4, 3, 1.5], at: [0, -1, 7.6], color: '#e07a80' }, { size: [1, 1, 0.5], at: [-1, -1, 8.4], color: '#802830' }, { size: [1, 1, 0.5], at: [1, -1, 8.4], color: '#802830' }],
    }),
  plumeau: () => ({
    size: [0.01, 0.01, 0.01],
    color: '#000',
    children: [
      { size: [6, 6, 8], at: [0, 8, 0], color: '#f4f4f0' },
      { size: [1, 5, 6], at: [0, -2, 0], pivot: [-3.5, 10, 0], color: '#e8e8e0', anim: 'wingL' },
      { size: [1, 5, 6], at: [0, -2, 0], pivot: [3.5, 10, 0], color: '#e8e8e0', anim: 'wingR' },
      { size: [1, 5, 1], at: [0, -2.5, 0], pivot: [-1.5, 5, 0], color: '#e8b830', anim: 'legFL' },
      { size: [1, 5, 1], at: [0, -2.5, 0], pivot: [1.5, 5, 0], color: '#e8b830', anim: 'legFR' },
      {
        size: [4, 6, 3], at: [0, 3, 1], pivot: [0, 10, 3.5], color: '#f4f4f0', anim: 'head',
        children: [...eyes(4, 2.6, 1.4, '#101010', 1, false), { size: [3, 2, 2], at: [0, 3, 3.5], color: '#f0a020' }, { size: [2, 2, 1], at: [0, 1, 3], color: '#d82020' }],
      },
    ],
  }),
  rodeur: () => humanoid({ skin: '#5f7d5a', shirt: '#3a4f7a', pants: '#3a3050', armsForward: true, headExtras: eyes(4, 4.1, 2, '#c8ff40', 2, false) }),
  chef: () => humanoid({ skin: '#56704f', shirt: '#8a2a2a', pants: '#2a2030', armsForward: true, headExtras: [...eyes(4, 4.1, 2, '#ff6020', 2, false), { size: [9, 2, 9], at: [0, 9, 0], color: '#f8d848' }, { size: [1, 2, 1], at: [-3.5, 11, -3.5], color: '#f8d848' }, { size: [1, 2, 1], at: [3.5, 11, 3.5], color: '#f8d848' }] }),
  archer: () => humanoid({ skin: '#d8d4c4', shirt: '#c8c4b0', pants: '#bab49c', thin: true, headExtras: eyes(4, 4.1, 2, '#202020', 2, false), rightHand: [{ size: [1, 14, 2], at: [0, -10, 2], color: '#8a6a3c' }] }),
  arachne: () => {
    const legs: PartDef[] = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1, z = (i % 4) * 3.5 - 5;
      legs.push({ size: [12, 1.5, 1.5], at: [side * 6, 0, 0], pivot: [side * 4, 7, z], color: '#2a2228', anim: i % 2 ? 'legFL' : 'legFR' });
    }
    return {
      size: [0.01, 0.01, 0.01], color: '#000',
      children: [
        { size: [10, 8, 12], at: [0, 7, -5], color: '#2e2630' },
        { size: [8, 7, 7], at: [0, 0, 3.5], pivot: [0, 7, 1], color: '#3a3038', anim: 'head', children: eyes(1, 7.2, 2, '#ff2020', 1.5, false) },
        ...legs,
      ],
    };
  },
  gelee: () => ({
    size: [0.01, 0.01, 0.01], color: '#000',
    children: [{ size: [14, 14, 14], at: [0, 7, 0], color: '#6ad850', anim: 'squash', children: [{ size: [6, 6, 6], at: [0, 7, 0], color: '#3a9a30' }, ...eyes(10, 7.2, 3, '#103010', 2, false)] }],
  }),
  ours: () =>
    quadruped({
      body: [18, 16, 26], bodyY: 18, bodyColor: '#5a3a1e', leg: [6, 10], legColor: '#4a2e16', legInset: [3, 4], head: [11, 10, 9], headColor: '#5a3a1e', headPos: [20, 12],
      headExtras: [...eyes(2, 9.2, 3, '#101010', 2, false), { size: [6, 4, 3], at: [0, -1.5, 10], color: '#8a6a4a' }, { size: [3, 3, 2], at: [-4.5, 6, 2], color: '#4a2e16' }, { size: [3, 3, 2], at: [4.5, 6, 2], color: '#4a2e16' }],
    }),
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
  spectre: () => ({
    size: [0.01, 0.01, 0.01], color: '#000',
    children: [
      { size: [8, 16, 6], at: [0, 14, 0], color: '#62e8f0', children: [{ size: [6, 6, 4], at: [0, 4, 0], color: '#a0f8ff' }] },
      { size: [3, 10, 3], at: [0, -4, 0], pivot: [-6, 20, 0], color: '#40c8d8', anim: 'armL_fwd' },
      { size: [3, 10, 3], at: [0, -4, 0], pivot: [6, 20, 0], color: '#40c8d8', anim: 'armR_fwd' },
      { size: [7, 7, 7], at: [0, 3.5, 0], pivot: [0, 22, 0], color: '#d0ffff', anim: 'head', children: eyes(3.5, 3.6, 1.8, '#204060', 2, false) },
    ],
  }),
};

export class MobModel {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshBasicMaterial;
  readonly parts = new Map<string, THREE.Object3D[]>();
  private shadow: THREE.Mesh | null = null;

  constructor(readonly type: string, scale = 1, shadowTex: THREE.Texture | null) {
    const def = MODELS[type];
    if (!def) throw new Error(`Modèle inconnu: ${type}`);
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: type === 'gelee' || type === 'spectre', opacity: type === 'gelee' ? 0.85 : type === 'spectre' ? 0.8 : 1 });
    this.group.add(build(def(), this.parts, this.material));
    this.group.scale.setScalar(scale);
    if (shadowTex) {
      this.shadow = new THREE.Mesh(SHADOW_GEO, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 }));
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.02;
      this.shadow.renderOrder = 1;
      this.group.add(this.shadow);
    }
  }

  setShadowSize(w: number, visible: boolean) {
    if (!this.shadow) return;
    this.shadow.visible = visible;
    this.shadow.scale.setScalar(w * 1.3);
  }

  /** Anime : phase de marche, amplitude (0..1), temps, attaque (0..1), état spécial. */
  animate(phase: number, amp: number, t: number, attack: number, headYaw: number, headPitch: number) {
    const s = Math.sin(phase) * 0.7 * amp;
    for (const p of this.parts.get('legFL') ?? []) p.rotation.x = s;
    for (const p of this.parts.get('legFR') ?? []) p.rotation.x = -s;
    for (const p of this.parts.get('legBL') ?? []) p.rotation.x = -s;
    for (const p of this.parts.get('legBR') ?? []) p.rotation.x = s;
    for (const p of this.parts.get('armL') ?? []) p.rotation.x = -s - attack * 1.6;
    for (const p of this.parts.get('armR') ?? []) p.rotation.x = s - attack * 1.6;
    const fwd = -Math.PI / 2 + Math.sin(t * 2) * 0.05;
    for (const p of this.parts.get('armL_fwd') ?? []) p.rotation.x = fwd - attack * 0.8 + s * 0.3;
    for (const p of this.parts.get('armR_fwd') ?? []) p.rotation.x = fwd - attack * 0.8 - s * 0.3;
    for (const p of this.parts.get('wingL') ?? []) p.rotation.z = amp > 0.1 ? Math.sin(t * 25) * 0.6 : 0;
    for (const p of this.parts.get('wingR') ?? []) p.rotation.z = amp > 0.1 ? -Math.sin(t * 25) * 0.6 : 0;
    for (const p of this.parts.get('head') ?? []) {
      p.rotation.y = headYaw;
      p.rotation.x = -headPitch;
    }
    for (const p of this.parts.get('squash') ?? []) {
      const k = 1 + Math.sin(t * 6) * 0.06 * (0.3 + amp);
      p.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));
    }
  }

  setTint(r: number, g: number, b: number) {
    this.material.color.setRGB(r, g, b);
  }

  dispose() {
    this.material.dispose();
    if (this.shadow) (this.shadow.material as THREE.Material).dispose();
  }
}

const SHADOW_GEO = new THREE.PlaneGeometry(1, 1);

/** Texture d'ombre circulaire (ombre « blob » bon marché sous les entités). */
export function createShadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
  g.addColorStop(0, 'rgba(0,0,0,0.8)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function disposeModelCache() {
  geoCache.forEach((g) => g.dispose());
  geoCache.clear();
}
