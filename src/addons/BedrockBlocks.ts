/**
 * Blocs des add-ons Bedrock : états (et traits de placement), permutations à conditions Molang,
 * géométries personnalisées (os, cubes, rotations, UV par face ou « box »), matériaux par face,
 * transformations (rotation/translation/échelle), boîtes de collision et de sélection.
 *
 * Chaque combinaison d'états est codée dans la méta du bloc (8 bits, base mixte) ; pour chacune,
 * on précalcule une liste de quads (repère du bloc en pixels 0..16) partagée avec le worker.
 */
import type { Box } from '../blocks/Shapes';
import { molang, molangBool, type MolangValue } from './Molang';

export type StateValue = string | number | boolean;
export interface StateDef {
  name: string;
  values: StateValue[];
}

export interface BlockQuad {
  /** 4 sommets (x, y, z en pixels, repère du bloc 0..16). */
  p: number[];
  /** UV par sommet en pixels de tuile (0..16), v vers le haut. */
  uv: number[];
  tile: number;
  /** Direction de la face si elle est sur le bord du bloc (masquage par un voisin opaque), sinon -1. */
  edge: number;
  /** Ombrage directionnel (0..5) ou -1 pour une face oblique. */
  shade: number;
  trans: boolean;
}

export interface BedrockVisual {
  quads: BlockQuad[];
  collision: Box[];
  selection: Box[];
}

export interface BedrockBlockInfo {
  states: StateDef[];
  /** Multiplicateurs de la base mixte (méta = Σ index × mult). */
  mult: number[];
  visuals: BedrockVisual[];
  /** Traits de placement. */
  placement: { cardinal?: number; facing?: boolean; half?: boolean; face?: boolean; connections?: boolean };
  /** Composants personnalisés (scripts) : noms. */
  custom: string[];
  /** Paramètres des composants personnalisés (2e argument des gestionnaires de script). */
  customParams?: Record<string, unknown>;
  /** Intervalle de tick (minecraft:tick) en ticks, ou 0. */
  tick: [number, number] | null;
  randomTick: boolean;
  tags: string[];
}

// ---------- états ----------

const CARDINAL = ['south', 'west', 'north', 'east'];
const FACES = ['down', 'up', 'north', 'south', 'west', 'east'];

/** États ajoutés par les traits de la description (placement_direction, placement_position, connection…). */
export function traitStates(traits: Record<string, { enabled_states?: string[]; y_rotation_offset?: number }> | undefined): { states: StateDef[]; placement: BedrockBlockInfo['placement'] } {
  const states: StateDef[] = [];
  const placement: BedrockBlockInfo['placement'] = {};
  const pd = traits?.['minecraft:placement_direction'];
  if (pd?.enabled_states?.includes('minecraft:cardinal_direction')) {
    states.push({ name: 'minecraft:cardinal_direction', values: CARDINAL });
    placement.cardinal = pd.y_rotation_offset ?? 0;
  }
  if (pd?.enabled_states?.includes('minecraft:facing_direction')) {
    states.push({ name: 'minecraft:facing_direction', values: FACES });
    placement.facing = true;
  }
  const pp = traits?.['minecraft:placement_position'];
  if (pp?.enabled_states?.includes('minecraft:vertical_half')) {
    states.push({ name: 'minecraft:vertical_half', values: ['bottom', 'top'] });
    placement.half = true;
  }
  if (pp?.enabled_states?.includes('minecraft:block_face')) {
    states.push({ name: 'minecraft:block_face', values: FACES });
    placement.face = true;
  }
  const cc = traits?.['minecraft:connection'];
  if (cc?.enabled_states?.includes('minecraft:cardinal_connections')) {
    for (const d of ['north', 'east', 'south', 'west']) states.push({ name: `minecraft:connection_${d}`, values: [false, true] });
    placement.connections = true;
  }
  const cac = traits?.['minecraft:multi_block'];
  void cac;
  const corner = traits?.['minecraft:corner_and_cardinal_direction'];
  if (corner?.enabled_states?.includes('minecraft:corner_and_cardinal_direction')) {
    if (!states.some((s) => s.name === 'minecraft:cardinal_direction')) {
      states.push({ name: 'minecraft:cardinal_direction', values: CARDINAL });
      placement.cardinal = corner.y_rotation_offset ?? 0;
    }
    states.push({ name: 'minecraft:corner', values: ['none', 'inner_left', 'inner_right', 'outer_left', 'outer_right'] });
  }
  return { states, placement };
}

/** Base mixte : multiplicateurs ; les états au-delà de 256 combinaisons sont figés à leur 1re valeur. */
export function stateMult(states: StateDef[]): number[] {
  const mult: number[] = [];
  let m = 1;
  for (const s of states) {
    if (m * s.values.length > 256) {
      mult.push(0);
      continue;
    }
    mult.push(m);
    m *= s.values.length;
  }
  return mult;
}

export function metaCount(info: Pick<BedrockBlockInfo, 'states' | 'mult'>) {
  let n = 1;
  info.states.forEach((s, i) => info.mult[i] && (n *= s.values.length));
  return n;
}

export function decodeStates(info: Pick<BedrockBlockInfo, 'states' | 'mult'>, meta: number): Record<string, StateValue> {
  const out: Record<string, StateValue> = {};
  info.states.forEach((s, i) => {
    const m = info.mult[i];
    out[s.name] = m ? s.values[Math.floor(meta / m) % s.values.length] : s.values[0];
  });
  return out;
}

export function encodeStates(info: Pick<BedrockBlockInfo, 'states' | 'mult'>, values: Record<string, StateValue>, base = 0): number {
  let meta = 0;
  const cur = decodeStates(info, base);
  info.states.forEach((s, i) => {
    const m = info.mult[i];
    if (!m) return;
    const v = s.name in values ? values[s.name] : cur[s.name];
    let idx = s.values.findIndex((x) => x === v || String(x) === String(v));
    if (idx < 0) idx = 0;
    meta += idx * m;
  });
  return meta;
}

/** Évalue une condition de permutation pour un jeu d'états. */
export function conditionTrue(cond: string, states: Record<string, StateValue>): boolean {
  return molangBool(cond, {
    query: (name, args) => {
      if (name === 'block_state' || name === 'block_property') {
        const v = states[String(args[0])];
        return typeof v === 'boolean' ? (v ? 1 : 0) : (v as MolangValue);
      }
      return 0;
    },
  });
}

// ---------- géométrie ----------

interface GeoCube {
  origin?: number[];
  size?: number[];
  uv?: number[] | Record<string, { uv?: number[]; uv_size?: number[]; material_instance?: string } | undefined>;
  rotation?: number[];
  pivot?: number[];
  mirror?: boolean;
  inflate?: number;
}
interface GeoBone {
  name: string;
  parent?: string;
  pivot?: number[];
  rotation?: number[];
  cubes?: GeoCube[];
  mirror?: boolean;
}
export interface BlockGeo {
  texW: number;
  texH: number;
  bones: GeoBone[];
}

export interface Material {
  tile: number;
  trans: boolean;
  /** Taille de la texture d'origine (pour l'échelle des UV). */
  w: number;
  h: number;
}

type V3 = [number, number, number];
type Mat = number[]; // 3x3 ligne par ligne

const DEG = Math.PI / 180;
function rotMat(r: number[] | undefined): Mat {
  const [x, y, z] = [(r?.[0] ?? 0) * DEG, (r?.[1] ?? 0) * DEG, (r?.[2] ?? 0) * DEG];
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // R = Rz · Ry · Rx (X appliqué en premier)
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}
const apply = (m: Mat, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

/** Rotation d'un fichier Bedrock exprimée dans le repère du monde (axe X inversé). */
const mirrorRot = (r: number[]): number[] => [-(r[0] ?? 0), -(r[1] ?? 0), r[2] ?? 0];

/** Transformation affine d'un point (rotation autour d'un pivot). */
type Xform = (p: V3) => V3;
const around = (m: Mat, pivot: V3, inner: Xform): Xform => (p) => {
  const q = inner(p);
  const r = apply(m, [q[0] - pivot[0], q[1] - pivot[1], q[2] - pivot[2]]);
  return [r[0] + pivot[0], r[1] + pivot[1], r[2] + pivot[2]];
};

const FULL_CUBE: BlockGeo = { texW: 16, texH: 16, bones: [{ name: 'block', cubes: [{ origin: [-8, 0, -8], size: [16, 16, 16], uv: { north: { uv: [0, 0], uv_size: [16, 16] }, south: { uv: [0, 0], uv_size: [16, 16] }, east: { uv: [0, 0], uv_size: [16, 16] }, west: { uv: [0, 0], uv_size: [16, 16] }, up: { uv: [0, 0], uv_size: [16, 16] }, down: { uv: [0, 0], uv_size: [16, 16] } } }] }] };

export interface VisualInput {
  geometry: BlockGeo | 'full' | 'cross' | null;
  boneVisibility?: Record<string, MolangValue>;
  materials: (instance: string, face: string) => Material | null;
  transformation?: { rotation?: number[]; translation?: number[]; scale?: number[] };
  collision?: unknown;
  selection?: unknown;
  states: Record<string, StateValue>;
}

/** Faces : direction (0 +X est, 1 -X ouest, 2 +Y haut, 3 -Y bas, 4 +Z sud, 5 -Z nord) → nom Bedrock. */
const FACE_NAME = ['east', 'west', 'up', 'down', 'south', 'north'];

function boxFromComponent(c: unknown, fallback: Box[]): Box[] {
  if (c === false) return [];
  if (c === true || c === undefined || c === null) return fallback;
  const o = c as { origin?: number[]; size?: number[] };
  const org = o.origin ?? [-8, 0, -8], sz = o.size ?? [16, 16, 16];
  // l'axe X des fichiers Bedrock est inversé (comme dans Blockbench) : x monde = 8 - x
  return [[8 - org[0] - sz[0], org[1], org[2] + 8, 8 - org[0], org[1] + sz[1], org[2] + 8 + sz[2]]];
}

/** Rotation (multiple de 90°) d'une boîte autour du centre du bloc. */
function rotateBox(b: Box, xf: Xform): Box {
  const pts: V3[] = [[b[0], b[1], b[2]], [b[3], b[4], b[5]], [b[0], b[4], b[5]], [b[3], b[1], b[2]]];
  const t = pts.map(xf);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return [r(Math.min(...t.map((p) => p[0]))), r(Math.min(...t.map((p) => p[1]))), r(Math.min(...t.map((p) => p[2]))), r(Math.max(...t.map((p) => p[0]))), r(Math.max(...t.map((p) => p[1]))), r(Math.max(...t.map((p) => p[2])))].map((v) => Math.max(0, Math.min(16, v))) as Box;
}

/** Calcule les quads, collisions et sélection d'une combinaison d'états. */
export function buildVisual(inp: VisualInput): BedrockVisual {
  const quads: BlockQuad[] = [];
  const tr = inp.transformation;
  // transformation du bloc : échelle, rotation autour du centre, translation (en blocs)
  const tm = rotMat(tr?.rotation);
  const sc = tr?.scale ?? [1, 1, 1];
  const tt = tr?.translation ?? [0, 0, 0];
  const blockXf: Xform = (p) => {
    const q: V3 = [(p[0] - 8) * sc[0], (p[1] - 8) * sc[1], (p[2] - 8) * sc[2]];
    const r = apply(tm, q);
    return [r[0] + 8 + tt[0] * 16, r[1] + 8 + tt[1] * 16, r[2] + 8 + tt[2] * 16];
  };
  const geo: BlockGeo = inp.geometry === 'full' || inp.geometry === null || inp.geometry === 'cross' ? FULL_CUBE : inp.geometry;
  if (inp.geometry === 'cross') {
    const m = inp.materials('*', 'north');
    if (m)
      for (const [a, b] of [[[0.8, 0.8], [15.2, 15.2]], [[0.8, 15.2], [15.2, 0.8]]] as [number, number][][]) {
        const p = [a[0], 0, a[1], b[0], 0, b[1], b[0], 16, b[1], a[0], 16, a[1]];
        const pts: number[] = [];
        for (let i = 0; i < 4; i++) pts.push(...blockXf([p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]));
        quads.push({ p: pts, uv: [0, 0, 16, 0, 16, 16, 0, 16], tile: m.tile, edge: -1, shade: -1, trans: m.trans });
        const back: number[] = [];
        for (const i of [1, 0, 3, 2]) back.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
        quads.push({ p: back, uv: [16, 0, 0, 0, 0, 16, 16, 16], tile: m.tile, edge: -1, shade: -1, trans: m.trans });
      }
  } else {
    const byName = new Map(geo.bones.map((b) => [b.name, b]));
    const visible = (bone: GeoBone): boolean => {
      for (let b: GeoBone | undefined = bone; b; b = b.parent ? byName.get(b.parent) : undefined) {
        const v = inp.boneVisibility?.[b.name];
        if (v !== undefined && !molangBool(v, { query: (n, a) => (n === 'block_state' || n === 'block_property' ? (inp.states[String(a[0])] as MolangValue) : 0) })) return false;
      }
      return true;
    };
    // transformation cumulée d'un os (rotations des parents)
    const boneXf = (bone: GeoBone): Xform => {
      const chain: GeoBone[] = [];
      for (let b: GeoBone | undefined = bone; b; b = b.parent ? byName.get(b.parent) : undefined) chain.push(b);
      let xf: Xform = (p) => p;
      for (const b of chain) {
        if (!b.rotation || (!b.rotation[0] && !b.rotation[1] && !b.rotation[2])) continue;
        const pv = b.pivot ?? [0, 0, 0];
        xf = around(rotMat(mirrorRot(b.rotation)), [8 - pv[0], pv[1], pv[2] + 8], xf);
      }
      return xf;
    };
    for (const bone of geo.bones) {
      if (!visible(bone)) continue;
      const bxf = boneXf(bone);
      for (const c of bone.cubes ?? []) {
        const [ox, oy, oz] = [c.origin?.[0] ?? 0, c.origin?.[1] ?? 0, c.origin?.[2] ?? 0];
        const [w, h, d] = [c.size?.[0] ?? 0, c.size?.[1] ?? 0, c.size?.[2] ?? 0];
        const g = c.inflate ?? 0;
        const x0 = 8 - ox - w - g, x1 = 8 - ox + g, y0 = oy - g, y1 = oy + h + g, z0 = oz + 8 - g, z1 = oz + 8 + d + g;
        let cxf: Xform = (p) => p;
        if (c.rotation && (c.rotation[0] || c.rotation[1] || c.rotation[2])) {
          const pv = c.pivot ?? [0, 0, 0];
          cxf = around(rotMat(mirrorRot(c.rotation)), [8 - pv[0], pv[1], pv[2] + 8], cxf);
        }
        const xf = (p: V3) => blockXf(bxf(cxf(p)));
        // UV « box » (format entité)
        const boxUv = Array.isArray(c.uv) ? c.uv : null;
        const mirror = c.mirror ?? bone.mirror;
        const regions: Record<string, [number, number, number, number] | null> = {};
        if (boxUv) {
          const [u, v] = boxUv;
          const fw = Math.floor(w), fh = Math.floor(h), fd = Math.floor(d);
          regions.up = [u + fd, v, fw, fd];
          regions.down = [u + fd + fw, v, fw, fd];
          regions.east = [u, v + fd, fd, fh];
          regions.north = [u + fd, v + fd, fw, fh];
          regions.west = [u + fd + fw, v + fd, fd, fh];
          regions.south = [u + 2 * fd + fw, v + fd, fw, fh];
          if (mirror) [regions.east, regions.west] = [regions.west, regions.east];
        }
        const corners: Record<string, V3[]> = {
          east: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
          west: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
          up: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
          down: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
          south: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
          north: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
        };
        FACE_NAME.forEach((face, dir) => {
          let reg = regions[face] ?? null;
          let inst = face;
          if (!boxUv && c.uv && typeof c.uv === 'object') {
            const f = (c.uv as Record<string, { uv?: number[]; uv_size?: number[]; material_instance?: string } | undefined>)[face];
            if (!f) return; // face absente
            const sz = f.uv_size ?? [face === 'east' || face === 'west' ? d : w, face === 'up' || face === 'down' ? d : h];
            reg = [f.uv?.[0] ?? 0, f.uv?.[1] ?? 0, sz[0], sz[1]];
            if (f.material_instance) inst = f.material_instance;
          }
          if (!reg) reg = [0, 0, 16, 16];
          // faces nulles (cubes plats) : on ne garde que les faces utiles
          if ((face === 'east' || face === 'west') && d === 0 && h === 0) return;
          const mat = inp.materials(inst, face);
          if (!mat) return;
          const ku = 16 / (inp.geometry === 'full' || inp.geometry === null ? 16 : geo.texW), kv = 16 / (inp.geometry === 'full' || inp.geometry === null ? 16 : geo.texH);
          const [ru, rv, rw, rh] = reg;
          let u0 = ru * ku, u1 = (ru + rw) * ku;
          if (mirror && boxUv) [u0, u1] = [u1, u0];
          const v0 = 16 - rv * kv, v1 = 16 - (rv + rh) * kv; // v vers le haut
          const uv = [u0, v1, u1, v1, u1, v0, u0, v0];
          const pts: number[] = [];
          const tp = corners[face].map(xf);
          for (const p of tp) pts.push(p[0], p[1], p[2]);
          // face sur le bord du bloc (après transformation) → peut être masquée
          let edge = -1;
          const eps = 0.01;
          const all = (k: number, v: number) => tp.every((p) => Math.abs(p[k] - v) < eps);
          if (all(0, 16)) edge = 0;
          else if (all(0, 0)) edge = 1;
          else if (all(1, 16)) edge = 2;
          else if (all(1, 0)) edge = 3;
          else if (all(2, 16)) edge = 4;
          else if (all(2, 0)) edge = 5;
          // ombrage selon la normale réelle
          const n = apply(tm, dir === 0 ? [1, 0, 0] : dir === 1 ? [-1, 0, 0] : dir === 2 ? [0, 1, 0] : dir === 3 ? [0, -1, 0] : dir === 4 ? [0, 0, 1] : [0, 0, -1]);
          const ax = Math.abs(n[0]) > 0.7 ? (n[0] > 0 ? 0 : 1) : Math.abs(n[1]) > 0.7 ? (n[1] > 0 ? 2 : 3) : Math.abs(n[2]) > 0.7 ? (n[2] > 0 ? 4 : 5) : -1;
          quads.push({ p: pts, uv, tile: mat.tile, edge, shade: ax, trans: mat.trans });
        });
      }
    }
  }
  // boîtes (pixels 0..16) transformées par la rotation du bloc
  const full: Box[] = [[0, 0, 0, 16, 16, 16]];
  const collision = boxFromComponent(inp.collision, full).map((b) => rotateBox(b, blockXf));
  const selection = boxFromComponent(inp.selection ?? inp.collision, full).map((b) => rotateBox(b, blockXf));
  return { quads, collision, selection: selection.length ? selection : [[0, 0, 0, 16, 16, 16]] };
}

/** Lecture d'une géométrie de bloc (formats 1.12+ et 1.8). */
export function readBlockGeometries(json: unknown, into: Map<string, BlockGeo>) {
  const j = json as Record<string, unknown>;
  const list = j?.['minecraft:geometry'];
  if (Array.isArray(list))
    for (const g of list as { description?: { identifier?: string; texture_width?: number; texture_height?: number }; bones?: GeoBone[] }[]) {
      const id = g.description?.identifier;
      if (id) into.set(id, { texW: g.description?.texture_width ?? 16, texH: g.description?.texture_height ?? 16, bones: g.bones ?? [] });
    }
  for (const [k, v] of Object.entries(j ?? {})) {
    if (!k.startsWith('geometry.')) continue;
    const g = v as { texturewidth?: number; textureheight?: number; bones?: GeoBone[] };
    into.set(k.split(':')[0], { texW: g.texturewidth ?? 16, texH: g.textureheight ?? 16, bones: g.bones ?? [] });
  }
}

export { molang };
