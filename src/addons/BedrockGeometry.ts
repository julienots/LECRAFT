/**
 * Conversion des géométries d'entités de l'édition Bedrock (fichiers *.geo.json, formats 1.8 et
 * 1.12+) vers le format de modèle à cubes du moteur (MobModels), animations de marche comprises.
 *
 * Repère Bedrock : pixels, y vers le haut, sol à y = 0, X inversé par rapport au format Java.
 * Repère du format interne (Java) : y vers le bas, sol à y = 24. D'où : Java = (-x, 24 - y, z).
 */
import type { CubePart, VanillaModel } from '../render/MobModels';

interface BedrockCube {
  origin?: number[];
  size?: number[];
  uv?: number[] | Record<string, { uv: number[]; uv_size?: number[] }>;
  inflate?: number;
  mirror?: boolean;
  pivot?: number[];
  rotation?: number[];
}
interface BedrockBone {
  name: string;
  parent?: string;
  pivot?: number[];
  rotation?: number[];
  bind_pose_rotation?: number[];
  mirror?: boolean;
  inflate?: number;
  cubes?: BedrockCube[];
  neverRender?: boolean;
}
export interface BedrockGeo {
  id: string;
  texW: number;
  texH: number;
  bones: BedrockBone[];
}

/** Extrait toutes les géométries d'un fichier .geo.json (anciens et nouveaux formats). */
export function readGeometries(json: unknown): BedrockGeo[] {
  const out: BedrockGeo[] = [];
  const j = json as Record<string, unknown>;
  const list = j['minecraft:geometry'];
  if (Array.isArray(list)) {
    for (const g of list as Record<string, unknown>[]) {
      const d = (g.description ?? {}) as Record<string, unknown>;
      out.push({ id: String(d.identifier ?? ''), texW: Number(d.texture_width ?? 64), texH: Number(d.texture_height ?? 64), bones: (g.bones ?? []) as BedrockBone[] });
    }
  }
  for (const [k, v] of Object.entries(j)) {
    if (!k.startsWith('geometry.')) continue;
    const g = v as Record<string, unknown>;
    // « geometry.nom:geometry.parent » : on garde le nom propre
    out.push({ id: k.split(':')[0], texW: Number(g.texturewidth ?? 64), texH: Number(g.textureheight ?? 64), bones: (g.bones ?? []) as BedrockBone[] });
  }
  return out;
}

const DEG = Math.PI / 180;

/** Nom d'animation interne selon le nom de l'os (conventions des modèles du jeu). */
function animName(bone: string): string | undefined {
  const n = bone.toLowerCase();
  if (n === 'head' || n === 'skull') return 'head';
  if (n === 'leg0') return 'legFL';
  if (n === 'leg3') return 'legBR';
  if (n === 'leg1') return 'legFR';
  if (n === 'leg2') return 'legBL';
  if (/right_?leg|rightleg|leg_?r\b/.test(n)) return 'legR';
  if (/left_?leg|leftleg|leg_?l\b/.test(n)) return 'legL';
  if (/right_?arm|rightarm|arm_?r\b/.test(n)) return 'armR';
  if (/left_?arm|leftarm|arm_?l\b/.test(n)) return 'armL';
  if (/(right_?wing|wing_?r\b|rightwing)/.test(n)) return 'wingR';
  if (/(left_?wing|wing_?l\b|leftwing)/.test(n)) return 'wingL';
  return undefined;
}

const v3 = (a: number[] | undefined, d = 0): [number, number, number] => [a?.[0] ?? d, a?.[1] ?? d, a?.[2] ?? d];

/** Convertit une géométrie en modèle interne (texture `skin`). */
export function geometryToModel(geo: BedrockGeo, skin: string): VanillaModel {
  const byName = new Map(geo.bones.map((b) => [b.name, b]));
  const children = new Map<string, BedrockBone[]>();
  const roots: BedrockBone[] = [];
  for (const b of geo.bones) {
    if (b.parent && byName.has(b.parent)) {
      const l = children.get(b.parent) ?? [];
      l.push(b);
      children.set(b.parent, l);
    } else roots.push(b);
  }
  // pivot d'un os (Bedrock, absolu)
  const pv = (b: BedrockBone) => v3(b.pivot);

  const cubePart = (c: BedrockCube, bonePivot: [number, number, number], bone: BedrockBone, relPivot: [number, number, number], rot: [number, number, number] | undefined, anim?: string): CubePart => {
    const [ox, oy, oz] = v3(c.origin);
    const [w, h, d] = v3(c.size);
    const [px, py, pz] = bonePivot;
    const part: CubePart = {
      uv: [0, 0],
      // coin minimal en Java, relatif au pivot : x0 = px - ox - w, y0 = py - oy - h, z0 = oz - pz
      box: [px - ox - w, py - oy - h, oz - pz, w, h, d],
      pivot: relPivot,
      rot,
      mirror: c.mirror ?? bone.mirror,
      inflate: c.inflate ?? bone.inflate,
      anim,
    };
    if (Array.isArray(c.uv)) part.uv = [c.uv[0] ?? 0, c.uv[1] ?? 0];
    else if (c.uv && typeof c.uv === 'object') {
      const map: Record<string, keyof NonNullable<CubePart['faceUV']>> = { north: 'front', south: 'back', east: 'right', west: 'left', up: 'top', down: 'bottom' };
      part.faceUV = {};
      for (const [face, f] of Object.entries(c.uv)) {
        const k = map[face];
        if (!k || !f?.uv) continue;
        part.faceUV[k] = [f.uv[0], f.uv[1], f.uv_size?.[0] ?? w, f.uv_size?.[1] ?? h];
      }
      const fr = c.uv.north?.uv;
      if (fr) part.uv = [fr[0], fr[1]];
    }
    return part;
  };

  const toRot = (r: number[] | undefined): [number, number, number] | undefined => {
    if (!r || (!r[0] && !r[1] && !r[2])) return undefined;
    // rotation Bedrock (degrés) → format Java (radians) : X et Y inversés
    return [-(r[0] ?? 0) * DEG, -(r[1] ?? 0) * DEG, (r[2] ?? 0) * DEG];
  };

  const build = (b: BedrockBone, parentPivot: [number, number, number] | null): CubePart => {
    const p = pv(b);
    const relPivot: [number, number, number] = parentPivot ? [-(p[0] - parentPivot[0]), parentPivot[1] - p[1], p[2] - parentPivot[2]] : [-p[0], 24 - p[1], p[2]];
    const anim = animName(b.name);
    // l'os lui-même est un pivot sans géométrie ; ses cubes et sous-os sont ses enfants
    const node: CubePart = { uv: [0, 0], box: [0, 0, 0, 0, 0, 0], pivot: relPivot, rot: toRot(b.rotation ?? b.bind_pose_rotation), anim, children: [] };
    if (!b.neverRender)
      for (const c of b.cubes ?? []) {
        if (c.rotation && (c.rotation[0] || c.rotation[1] || c.rotation[2])) {
          // cube tourné autour de son propre pivot : nœud intermédiaire
          const cp = v3(c.pivot ?? b.pivot);
          const rel: [number, number, number] = [-(cp[0] - p[0]), p[1] - cp[1], cp[2] - p[2]];
          const inner = cubePart(c, cp, b, [0, 0, 0], undefined);
          node.children!.push({ uv: [0, 0], box: [0, 0, 0, 0, 0, 0], pivot: rel, rot: toRot(c.rotation), children: [inner] });
        } else node.children!.push(cubePart(c, p, b, [0, 0, 0], undefined));
      }
    for (const ch of children.get(b.name) ?? []) node.children!.push(build(ch, p));
    return node;
  };

  return { skin, texW: geo.texW, texH: geo.texH, parts: roots.map((r) => build(r, null)) };
}
