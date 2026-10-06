import * as THREE from 'three';
import { build, VOXEL_MODELS } from './VoxelModels';

/**
 * Modèles des créatures.
 * - Créatures vanilla : boîtes texturées reprenant les dimensions, pivots et la disposition UV
 *   standard des modèles du jeu (texture 64x32 ou 64x64), compatibles avec les skins d'un pack.
 * - Boss propres à LeCraft : modèles voxel à couleurs de sommets (VoxelModels.ts).
 *
 * Repère « modèle vanilla » : pixels, y vers le bas, sol à y = 24, l'avant vers -Z.
 * Conversion vers notre repère (y vers le haut, avant vers +Z) : (x, 24 - y, -z) — une rotation.
 */
interface CubePart {
  uv: [number, number];
  box: [number, number, number, number, number, number]; // x0, y0, z0, w, h, d (relatif au pivot)
  pivot: [number, number, number];
  rot?: [number, number, number];
  mirror?: boolean;
  inflate?: number;
  anim?: string;
  /** UV par face (format « per-face » des modèles de l'édition Bedrock) : [u, v, largeur, hauteur]. */
  faceUV?: Partial<Record<'top' | 'bottom' | 'right' | 'front' | 'left' | 'back', [number, number, number, number]>>;
  /** Couche séparée (laine du mouton). */
  layer?: 'fur';
  /** Nom d'os (modèles d'add-ons : animations Bedrock). */
  bone?: string;
  children?: CubePart[];
}
export type { CubePart };
export interface VanillaModel {
  skin: string;
  texW: number;
  texH: number;
  parts: CubePart[];
  furSkin?: string;
}

const P = (uv: [number, number], box: CubePart['box'], pivot: CubePart['pivot'], extra: Partial<CubePart> = {}): CubePart => ({ uv, box, pivot, ...extra });
const HALF_PI = Math.PI / 2;

function quadLegs(uv: [number, number], w: number, h: number, pivots: [number, number, number][], layer?: 'fur', inflate = 0): CubePart[] {
  const names = ['legBR', 'legBL', 'legFR', 'legFL'];
  return pivots.map((p, i) => P(uv, [-w / 2, 0, -w / 2, w, h, w], p, { anim: names[i], mirror: i % 2 === 1, layer, inflate }));
}

const VANILLA: Record<string, VanillaModel> = {
  pig: {
    skin: 'pig', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-4, -4, -8, 8, 8, 8], [0, 12, -6], { anim: 'head', children: [P([16, 16], [-2, 0, -9, 4, 3, 1], [0, 0, 0])] }),
      P([28, 8], [-5, -10, -7, 10, 16, 8], [0, 11, 2], { rot: [HALF_PI, 0, 0] }),
      ...quadLegs([0, 16], 4, 6, [[-3, 18, 7], [3, 18, 7], [-3, 18, -5], [3, 18, -5]]),
    ],
  },
  cow: {
    skin: 'cow', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-4, -4, -6, 8, 8, 6], [0, 4, -8], { anim: 'head', children: [P([22, 0], [-5, -5, -4, 1, 3, 1], [0, 0, 0]), P([22, 0], [4, -5, -4, 1, 3, 1], [0, 0, 0])] }),
      P([18, 4], [-6, -10, -7, 12, 18, 10], [0, 5, 2], { rot: [HALF_PI, 0, 0], children: [P([52, 0], [-2, 2, -8, 4, 6, 1], [0, 0, 0])] }),
      ...quadLegs([0, 16], 4, 12, [[-4, 12, 7], [4, 12, 7], [-4, 12, -6], [4, 12, -6]]),
    ],
  },
  sheep: {
    skin: 'sheep', texW: 64, texH: 32, furSkin: 'sheep_fur',
    parts: [
      P([0, 0], [-3, -4, -6, 6, 6, 8], [0, 6, -8], { anim: 'head', children: [P([0, 0], [-3, -4, -4, 6, 6, 6], [0, 0, 0], { layer: 'fur', inflate: 0.6 })] }),
      P([28, 8], [-4, -10, -7, 8, 16, 6], [0, 5, 2], { rot: [HALF_PI, 0, 0] }),
      P([28, 8], [-4, -10, -7, 8, 16, 6], [0, 5, 2], { rot: [HALF_PI, 0, 0], layer: 'fur', inflate: 1.75 }),
      ...quadLegs([0, 16], 4, 12, [[-3, 12, 7], [3, 12, 7], [-3, 12, -5], [3, 12, -5]]),
      ...quadLegs([0, 16], 4, 6, [[-3, 12, 7], [3, 12, 7], [-3, 12, -5], [3, 12, -5]], 'fur', 0.5),
    ],
  },
  chicken: {
    skin: 'chicken', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-2, -6, -2, 4, 6, 3], [0, 15, -4], { anim: 'head', children: [P([14, 0], [-2, -4, -4, 4, 2, 2], [0, 0, 0]), P([14, 4], [-1, -2, -3, 2, 2, 2], [0, 0, 0])] }),
      P([0, 9], [-3, -4, -3, 6, 8, 6], [0, 16, 0], { rot: [HALF_PI, 0, 0] }),
      P([26, 0], [-1, 0, -3, 3, 5, 3], [-2, 19, 1], { anim: 'legBR' }),
      P([26, 0], [-1, 0, -3, 3, 5, 3], [1, 19, 1], { anim: 'legBL', mirror: true }),
      P([24, 13], [0, 0, -3, 1, 4, 6], [-4, 13, 0], { anim: 'wingR' }),
      P([24, 13], [-1, 0, -3, 1, 4, 6], [4, 13, 0], { anim: 'wingL' }),
    ],
  },
  zombie: humanoid('zombie', 64, 64, 4),
  zombie_chief: humanoid('zombie_chief', 64, 64, 4),
  skeleton: humanoid('skeleton', 64, 32, 2),
  player: playerModel(),
  zombified_piglin: piglinModel('zombified_piglin'),
  ghast: {
    skin: 'ghast', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-8, -8, -8, 16, 16, 16], [0, 16, 0]),
      ...[9, 12, 10, 13, 8, 11, 10, 9, 12].map((len, i) => {
        const fx = ((i % 3) - (Math.floor(i / 3) % 2) * 0.5 + 0.25 - 1) * 5;
        const fz = (Math.floor(i / 3) - 1) * 5;
        return P([0, 0], [-1, 0, -1, 2, len, 2], [fx, 24, fz], { anim: 'tentacle' });
      }),
    ],
  },
  magma_cube: {
    skin: 'magma_cube', texW: 64, texH: 32,
    parts: [
      ...Array.from({ length: 8 }, (_, i) => P(i === 2 ? [24, 10] : i === 3 ? [24, 19] : [0, i], [-4, 16 + i, -4, 8, 1, 8], [0, 0, 0], { anim: 'squash' })),
      P([0, 16], [-2, 18, -2, 4, 4, 4], [0, 0, 0], { anim: 'squash' }),
    ],
  },
  blaze: {
    skin: 'blaze', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-4, -4, -4, 8, 8, 8], [0, 4, 0], { anim: 'head' }),
      ...[[9, -4], [7, 3], [5, 10]].map(([r, y], ring) =>
        P([0, 0], [0, 0, 0, 0, 0, 0], [0, 24, 0], {
          anim: `spin${ring}`,
          children: [0, 1, 2, 3].map((k) => {
            const a = (k / 4) * Math.PI * 2 + ring * 0.6;
            return P([0, 16], [-1, 0, -1, 2, 8, 2], [Math.cos(a) * r, y - 20, Math.sin(a) * r]);
          }),
        }),
      ),
    ],
  },
  creeper: {
    skin: 'creeper', texW: 64, texH: 32,
    parts: [
      P([0, 0], [-4, -8, -4, 8, 8, 8], [0, 6, 0], { anim: 'head' }),
      P([16, 16], [-4, 0, -2, 8, 12, 4], [0, 6, 0]),
      ...quadLegs([0, 16], 4, 6, [[-2, 18, 4], [2, 18, 4], [-2, 18, -4], [2, 18, -4]]),
    ],
  },
  spider: spider('spider'),
  cave_spider: spider('cave_spider'),
  slime: {
    skin: 'slime', texW: 64, texH: 32,
    parts: [
      P([0, 16], [-3, 17, -3, 6, 6, 6], [0, 0, 0], { anim: 'squash' }),
      P([32, 0], [-3.25, 18, -3.5, 2, 2, 2], [0, 0, 0]),
      P([32, 4], [1.25, 18, -3.5, 2, 2, 2], [0, 0, 0]),
      P([32, 8], [0, 21, -3.5, 1, 1, 1], [0, 0, 0]),
      P([0, 0], [-4, 16, -4, 8, 8, 8], [0, 0, 0], { anim: 'squash' }),
    ],
  },
};

function humanoid(skin: string, texW: number, texH: number, limb: number): VanillaModel {
  const lo = limb === 4 ? -2 : -1;
  return {
    skin, texW, texH,
    parts: [
      P([0, 0], [-4, -8, -4, 8, 8, 8], [0, 0, 0], { anim: 'head' }),
      P([16, 16], [-4, 0, -2, 8, 12, 4], [0, 0, 0]),
      P([40, 16], [limb === 4 ? -3 : -1, -2, lo, limb, 12, limb], [-5, 2, 0], { anim: 'armR' }),
      P([40, 16], [-1, -2, lo, limb, 12, limb], [5, 2, 0], { anim: 'armL', mirror: true }),
      P([0, 16], [lo, 0, lo, limb, 12, limb], [limb === 4 ? -1.9 : -2, 12, 0], { anim: 'legR' }),
      P([0, 16], [lo, 0, lo, limb, 12, limb], [limb === 4 ? 1.9 : 2, 12, 0], { anim: 'legL', mirror: true }),
    ],
  };
}

/** Joueur (vue à la 3e personne) : skin 64x64 avec bras/jambe gauches distincts et seconde couche. */
function playerModel(): VanillaModel {
  const o = (uv: [number, number], box: CubePart['box'], inflate: number) => P(uv, box, [0, 0, 0], { inflate });
  const limb: CubePart['box'] = [-2, 0, -2, 4, 12, 4];
  return {
    skin: 'player', texW: 64, texH: 64,
    parts: [
      P([0, 0], [-4, -8, -4, 8, 8, 8], [0, 0, 0], { anim: 'head', children: [o([32, 0], [-4, -8, -4, 8, 8, 8], 0.5)] }),
      P([16, 16], [-4, 0, -2, 8, 12, 4], [0, 0, 0], { children: [o([16, 32], [-4, 0, -2, 8, 12, 4], 0.25)] }),
      P([40, 16], [-3, -2, -2, 4, 12, 4], [-5, 2, 0], { anim: 'armR', children: [o([40, 32], [-3, -2, -2, 4, 12, 4], 0.25)] }),
      P([32, 48], [-1, -2, -2, 4, 12, 4], [5, 2, 0], { anim: 'armL', children: [o([48, 48], [-1, -2, -2, 4, 12, 4], 0.25)] }),
      P([0, 16], limb, [-1.9, 12, 0], { anim: 'legR', children: [o([0, 32], limb, 0.25)] }),
      P([16, 48], limb, [1.9, 12, 0], { anim: 'legL', children: [o([0, 48], limb, 0.25)] }),
    ],
  };
}

/** Piglin (tête large, groin, défenses, oreilles) sur le corps du modèle joueur 64x64. */
function piglinModel(skin: string): VanillaModel {
  const base = playerModel();
  const o = (uv: [number, number], box: CubePart['box'], extra: Partial<CubePart> = {}) => P(uv, box, [0, 0, 0], extra);
  base.skin = skin;
  base.parts[0] = P([0, 0], [-5, -8, -4, 10, 8, 8], [0, 0, 0], {
    anim: 'head',
    children: [
      o([31, 1], [-2, -4, -5, 4, 4, 1]),
      o([2, 4], [2, -2, -5, 1, 2, 1]),
      o([2, 0], [-3, -2, -5, 1, 2, 1]),
      P([51, 6], [0, 0, -2, 1, 5, 4], [4.5, -6, 0], { rot: [0, 0, -0.5236] }),
      P([39, 6], [-1, 0, -2, 1, 5, 4], [-4.5, -6, 0], { rot: [0, 0, 0.5236] }),
    ],
  });
  return base;
}

function spider(skin: string): VanillaModel {
  const legs: CubePart[] = [];
  const yRots = [Math.PI / 4, Math.PI / 8, -Math.PI / 8, -Math.PI / 4];
  const zs = [2, 1, 0, -1];
  for (let i = 0; i < 4; i++) {
    const zr = i === 0 || i === 3 ? Math.PI / 4 : Math.PI / 4 * 0.74;
    legs.push(P([18, 0], [-15, -1, -1, 16, 2, 2], [-4, 15, zs[i]], { rot: [0, yRots[i], -zr], anim: `spiderR${i}` }));
    legs.push(P([18, 0], [-1, -1, -1, 16, 2, 2], [4, 15, zs[i]], { rot: [0, -yRots[i], zr], anim: `spiderL${i}` }));
  }
  return {
    skin, texW: 64, texH: 32,
    parts: [
      P([32, 4], [-4, -4, -8, 8, 8, 8], [0, 15, -3], { anim: 'head' }),
      P([0, 0], [-3, -3, -3, 6, 6, 6], [0, 15, 0]),
      P([0, 12], [-5, -4, -6, 10, 8, 12], [0, 15, 9]),
      ...legs,
    ],
  };
}

/** Géométrie d'un cube au format vanilla (UV standard), convertie dans notre repère. */
function cubeGeometry(part: CubePart, texW: number, texH: number): THREE.BufferGeometry {
  const [bx, by, bz, w, h, d] = part.box;
  const g = part.inflate ?? 0;
  const x0 = bx - g, y0 = by - g, z0 = bz - g, x1 = bx + w + g, y1 = by + h + g, z1 = bz + d + g;
  const [u, v] = part.uv;
  // régions de texture (vanilla) : [u0, v0, largeur, hauteur]
  const R = {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + 2 * d + w, v + d, w, h],
  };
  if (part.mirror) [R.right, R.left] = [R.left, R.right];
  if (part.faceUV) Object.assign(R, part.faceUV);
  // faces : 4 coins (repère vanilla) + coordonnées texture (u relatif, v relatif) de chaque coin
  type C = [number, number, number, number, number];
  const faces: { r: number[]; n: [number, number, number]; c: C[] }[] = [
    // avant (-Z vanilla) : u croît avec x, v avec y
    { r: R.front, n: [0, 0, -1], c: [[x0, y0, z0, 0, 0], [x1, y0, z0, 1, 0], [x1, y1, z0, 1, 1], [x0, y1, z0, 0, 1]] },
    // arrière (+Z) : u croît quand x décroît
    { r: R.back, n: [0, 0, 1], c: [[x1, y0, z1, 0, 0], [x0, y0, z1, 1, 0], [x0, y1, z1, 1, 1], [x1, y1, z1, 0, 1]] },
    // côté droit (-X) : u croît quand z décroît
    { r: R.right, n: [-1, 0, 0], c: [[x0, y0, z1, 0, 0], [x0, y0, z0, 1, 0], [x0, y1, z0, 1, 1], [x0, y1, z1, 0, 1]] },
    // côté gauche (+X) : u croît avec z
    { r: R.left, n: [1, 0, 0], c: [[x1, y0, z0, 0, 0], [x1, y0, z1, 1, 0], [x1, y1, z1, 1, 1], [x1, y1, z0, 0, 1]] },
    // dessus (-Y vanilla) : v croît quand z décroît (l'avant en bas de la région)
    { r: R.top, n: [0, -1, 0], c: [[x0, y0, z1, 0, 0], [x1, y0, z1, 1, 0], [x1, y0, z0, 1, 1], [x0, y0, z0, 0, 1]] },
    // dessous (+Y)
    { r: R.bottom, n: [0, 1, 0], c: [[x0, y1, z0, 0, 0], [x1, y1, z0, 1, 0], [x1, y1, z1, 1, 1], [x0, y1, z1, 0, 1]] },
  ];
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (const f of faces) {
    const base = pos.length / 3;
    const [ru, rv, rw, rh] = f.r;
    for (const [x, y, z, fu, fv] of f.c) {
      // conversion : (x, -y, -z) en pixels → blocs
      pos.push(x / 16, -y / 16, -z / 16);
      let uu = ru + fu * rw;
      if (part.mirror) uu = ru + (1 - fu) * rw;
      uvs.push(uu / texW, 1 - (rv + fv * rh) / texH);
    }
    // ordre anti-horaire vu de l'extérieur (dans notre repère)
    const n: [number, number, number] = [f.n[0], -f.n[1], -f.n[2]];
    const p = (i: number) => [pos[(base + i) * 3], pos[(base + i) * 3 + 1], pos[(base + i) * 3 + 2]];
    const a = p(0), b = p(1), c = p(2);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ccw = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0;
    if (ccw) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedCube(part: CubePart, texW: number, texH: number) {
  const k = `${part.uv}|${part.box}|${part.inflate ?? 0}|${part.mirror ? 1 : 0}|${texW}x${texH}|${part.faceUV ? JSON.stringify(part.faceUV) : ''}`;
  let g = geoCache.get(k);
  if (!g) {
    g = cubeGeometry(part, texW, texH);
    geoCache.set(k, g);
  }
  return g;
}

/** Fournisseur de textures de skins (générées ou issues d'un pack). */
export interface SkinProvider {
  skin(key: string): THREE.Texture;
}

const SHADOW_GEO = new THREE.PlaneGeometry(1, 1);

export class MobModel {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshBasicMaterial;
  /** Matériau de la laine (moutons), teinté selon la couleur. */
  readonly furMaterial: THREE.MeshBasicMaterial | null = null;
  readonly parts = new Map<string, THREE.Object3D[]>();
  readonly furParts: THREE.Object3D[] = [];
  private shadow: THREE.Mesh | null = null;
  readonly vanilla: boolean;
  private animPhase = new Map<THREE.Object3D, THREE.Euler>();
  /** Os nommés (modèles d'add-ons) avec leur pose de repos. */
  readonly bones = new Map<string, { o: THREE.Object3D; rot: THREE.Euler; pos: THREE.Vector3 }>();

  constructor(readonly type: string, scale: number, shadowTex: THREE.Texture | null, skins: SkinProvider) {
    const def = VANILLA[type];
    this.vanilla = !!def;
    if (def) {
      this.material = new THREE.MeshBasicMaterial({ map: skins.skin(def.skin), transparent: type === 'slime', alphaTest: type === 'slime' ? 0.05 : 0.5, side: type === 'slime' ? THREE.DoubleSide : THREE.FrontSide, depthWrite: type !== 'slime' });
      if (def.furSkin) this.furMaterial = new THREE.MeshBasicMaterial({ map: skins.skin(def.furSkin), alphaTest: 0.5 });
      const root = new THREE.Group();
      for (const p of def.parts) root.add(this.buildPart(p, def));
      this.group.add(root);
    } else {
      const voxel = VOXEL_MODELS[type];
      if (!voxel) throw new Error(`Modèle inconnu: ${type}`);
      this.material = new THREE.MeshBasicMaterial({ vertexColors: true });
      this.group.add(build(voxel(), this.parts, this.material));
    }
    this.group.scale.setScalar(scale);
    if (shadowTex) {
      this.shadow = new THREE.Mesh(SHADOW_GEO, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 }));
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.02;
      this.shadow.renderOrder = 1;
      this.group.add(this.shadow);
    }
  }

  private buildPart(p: CubePart, def: VanillaModel, child = false): THREE.Object3D {
    const pivot = new THREE.Group();
    // pivot converti : (x, 24 - y, -z) ; les enfants sont relatifs au pivot parent (sans décalage du sol)
    pivot.position.set(p.pivot[0] / 16, (child ? -p.pivot[1] : 24 - p.pivot[1]) / 16, -p.pivot[2] / 16);
    if (p.rot) pivot.rotation.set(p.rot[0], -p.rot[1], -p.rot[2]);
    const fur = p.layer === 'fur';
    const mat = fur ? this.furMaterial! : this.material;
    // nœud sans géométrie (os d'un modèle Bedrock) : seulement un pivot
    if (p.box[3] || p.box[4] || p.box[5]) {
      const mesh = new THREE.Mesh(cachedCube(p, def.texW, def.texH), mat);
      pivot.add(mesh);
      if (fur) this.furParts.push(mesh);
    }
    if (p.bone) this.bones.set(p.bone, { o: pivot, rot: pivot.rotation.clone(), pos: pivot.position.clone() });
    if (p.anim) {
      const list = this.parts.get(p.anim) ?? [];
      list.push(pivot);
      this.parts.set(p.anim, list);
      this.animPhase.set(pivot, pivot.rotation.clone());
    }
    for (const c of p.children ?? []) pivot.add(this.buildPart(c, def, true));
    return pivot;
  }

  setShadowSize(w: number, visible: boolean) {
    if (!this.shadow) return;
    this.shadow.visible = visible;
    this.shadow.scale.setScalar(w * 1.3);
  }

  /** Couleur de la laine (mouton) ; null = tondu. */
  setFur(color: number | null) {
    for (const f of this.furParts) f.visible = color !== null;
    if (color !== null && this.furMaterial) this.furMaterial.userData.base = color;
  }

  private rot(name: string, fn: (base: THREE.Euler, o: THREE.Object3D) => void) {
    for (const o of this.parts.get(name) ?? []) fn(this.animPhase.get(o) ?? new THREE.Euler(), o);
  }

  /** Anime : phase de marche, amplitude (0..1), temps, attaque (0..1), orientation de la tête. */
  animate(phase: number, amp: number, t: number, attack: number, headYaw: number, headPitch: number) {
    const s = Math.cos(phase * 0.6662 * 2) * 1.2 * amp;
    for (const k of ['legFL', 'legBR', 'legR']) this.rot(k, (b, o) => (o.rotation.x = b.x + s));
    for (const k of ['legFR', 'legBL', 'legL']) this.rot(k, (b, o) => (o.rotation.x = b.x - s));
    // bras : zombies tendus vers l'avant, squelettes balancés
    const zombieArms = this.type.startsWith('zombi');
    this.rot('armR', (b, o) => (o.rotation.x = zombieArms ? -HALF_PI + Math.sin(t * 2) * 0.05 - attack * 0.6 : b.x - s * 0.7 - attack * 1.4));
    this.rot('armL', (b, o) => (o.rotation.x = zombieArms ? -HALF_PI - Math.sin(t * 2) * 0.05 - attack * 0.6 : b.x + s * 0.7));
    // anciens modèles (boss)
    for (const p of this.parts.get('armL_fwd') ?? []) p.rotation.x = -HALF_PI - attack * 0.8 + s * 0.3;
    for (const p of this.parts.get('armR_fwd') ?? []) p.rotation.x = -HALF_PI - attack * 0.8 - s * 0.3;
    this.rot('wingR', (b, o) => (o.rotation.z = b.z + (amp > 0.1 || attack > 0 ? Math.sin(t * 25) * 0.7 : 0)));
    this.rot('wingL', (b, o) => (o.rotation.z = b.z - (amp > 0.1 || attack > 0 ? Math.sin(t * 25) * 0.7 : 0)));
    this.rot('head', (b, o) => {
      o.rotation.y = b.y + headYaw;
      o.rotation.x = b.x - headPitch;
    });
    for (let i = 0; i < 4; i++) {
      const sw = Math.cos(phase * 1.3 + (i % 2) * Math.PI) * 0.4 * amp;
      this.rot(`spiderR${i}`, (b, o) => (o.rotation.y = b.y + sw));
      this.rot(`spiderL${i}`, (b, o) => (o.rotation.y = b.y - sw));
    }
    this.rot('tentacle', (b, o) => (o.rotation.x = b.x + 0.15 + Math.sin(t * 2.2 + o.position.x * 3 + o.position.z * 5) * 0.25));
    for (let r = 0; r < 3; r++) this.rot(`spin${r}`, (b, o) => (o.rotation.y = b.y + t * (r === 1 ? -1.4 : 1.1 + r * 0.3)));
    this.rot('squash', (_b, o) => {
      const k = 1 + Math.sin(t * 6) * 0.06 * (0.3 + amp);
      o.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));
    });
  }

  /** Applique des poses d'animation Bedrock (degrés et pixels, repère Bedrock) aux os. */
  applyPoses(poses: Map<string, { rot: [number, number, number]; pos: [number, number, number]; scale: [number, number, number] }>) {
    const D = Math.PI / 180;
    for (const [name, b] of this.bones) {
      const p = poses.get(name);
      const o = b.o;
      if (!p) {
        o.rotation.copy(b.rot);
        o.position.copy(b.pos);
        o.scale.set(1, 1, 1);
        continue;
      }
      o.rotation.set(b.rot.x - p.rot[0] * D, b.rot.y + p.rot[1] * D, b.rot.z - p.rot[2] * D);
      o.position.set(b.pos.x - p.pos[0] / 16, b.pos.y + p.pos[1] / 16, b.pos.z - p.pos[2] / 16);
      o.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    }
  }

  setTint(r: number, g: number, b: number) {
    this.material.color.setRGB(r, g, b);
    if (this.furMaterial) {
      const base = (this.furMaterial.userData.base as number | undefined) ?? 0xffffff;
      this.furMaterial.color.setRGB((((base >> 16) & 255) / 255) * r, (((base >> 8) & 255) / 255) * g, ((base & 255) / 255) * b);
    }
  }

  dispose() {
    this.material.dispose();
    this.furMaterial?.dispose();
    if (this.shadow) (this.shadow.material as THREE.Material).dispose();
  }
}

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

export const VANILLA_MODELS = VANILLA;
