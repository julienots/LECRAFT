/**
 * Construction des quads des modèles de blocs (format des modèles du jeu de référence, voir
 * src/data/blockModels.ts). Le résultat est au même format que les blocs d'add-ons Bedrock
 * (BedrockVisual) : le mesher, les collisions et le contour visé réutilisent le même chemin.
 */
import type { BedrockVisual, BlockQuad } from '../addons/BedrockBlocks';
import type { FaceName, JModel } from '../data/blockModels';
import type { Box } from './Shapes';
import { TileRegistry } from '../render/TileRegistry';

type V3 = [number, number, number];
const FACE_DIR: Record<FaceName, number> = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 };
const NORMAL: Record<FaceName, V3> = { east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0], south: [0, 0, 1], north: [0, 0, -1] };
/** Quarts de tour horaires selon la méta d'orientation (0 sud, 1 ouest, 2 nord, 3 est) : modèle face au nord. */
const STEPS = [2, 3, 0, 1];

function defaultUv(f: FaceName, a: V3, b: V3): number[] {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  switch (f) {
    case 'down': return [x0, 16 - z1, x1, 16 - z0];
    case 'up': return [x0, z0, x1, z1];
    case 'north': return [16 - x1, 16 - y1, 16 - x0, 16 - y0];
    case 'south': return [x0, 16 - y1, x1, 16 - y0];
    case 'west': return [z0, 16 - y1, z1, 16 - y0];
    default: return [16 - z1, 16 - y1, 16 - z0, 16 - y0];
  }
}

function corners(f: FaceName, a: V3, b: V3): V3[] {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  switch (f) {
    case 'east': return [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]];
    case 'west': return [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]];
    case 'up': return [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]];
    case 'down': return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    case 'south': return [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    default: return [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]];
  }
}

function rotateAxis(p: V3, o: number[], axis: 'x' | 'y' | 'z', deg: number, rescale: boolean): V3 {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const k = rescale ? 1 / Math.cos(Math.abs(r)) : 1;
  let x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
  if (axis === 'y') { x *= k; z *= k; return [x * c + z * s + o[0], y + o[1], -x * s + z * c + o[2]]; }
  if (axis === 'x') { y *= k; z *= k; return [x + o[0], y * c - z * s + o[1], y * s + z * c + o[2]]; }
  x *= k; y *= k;
  return [x * c - y * s + o[0], x * s + y * c + o[1], z + o[2]];
}

/** Rotation horaire (vue de dessus) d'un point autour du centre du bloc. */
function turn(p: V3, steps: number): V3 {
  let [x, y, z] = p;
  for (let i = 0; i < steps; i++) [x, z] = [16 - z, x];
  return [x, y, z];
}
function turnN(n: V3, steps: number): V3 {
  let [x, y, z] = n;
  for (let i = 0; i < steps; i++) [x, z] = [-z, x];
  return [x, y, z];
}

function tileOf(name: string): number {
  return TileRegistry.has(name) ? TileRegistry.index(name) : 0;
}

/** Quads, collisions et contour d'un modèle pour une orientation (méta). */
export function buildJavaVisual(model: JModel, meta: number): BedrockVisual {
  const steps = model.facing ? STEPS[meta & 3] : 0;
  const quads: BlockQuad[] = [];
  const eps = 0.01;
  for (const el of model.els) {
    const a = el.from as V3, b = el.to as V3;
    const xf = (p: V3): V3 => turn(el.rot ? rotateAxis(p, el.rot.o, el.rot.axis, el.rot.a, !!el.rot.rescale) : p, steps);
    for (const f of Object.keys(el.faces) as FaceName[]) {
      const face = el.faces[f]!;
      const [u0, v0, u1, v1] = face.uv ?? defaultUv(f, a, b);
      // coins (bas-gauche, bas-droite, haut-droite, haut-gauche) ; v des tuiles vers le haut
      const base = [[u0, 16 - v1], [u1, 16 - v1], [u1, 16 - v0], [u0, 16 - v0]];
      const k = (((face.rot ?? 0) / 90) | 0) & 3;
      const uv: number[] = [];
      for (let i = 0; i < 4; i++) uv.push(...base[(i + k) & 3]);
      const pts = corners(f, a, b).map(xf);
      const p: number[] = [];
      for (const q of pts) p.push(q[0], q[1], q[2]);
      let edge = -1;
      const all = (i: number, v: number) => pts.every((q) => Math.abs(q[i] - v) < eps);
      if (!el.rot) {
        if (all(0, 16)) edge = 0;
        else if (all(0, 0)) edge = 1;
        else if (all(1, 16)) edge = 2;
        else if (all(1, 0)) edge = 3;
        else if (all(2, 16)) edge = 4;
        else if (all(2, 0)) edge = 5;
      }
      let n = NORMAL[f];
      if (el.rot) n = rotateAxis(n, [0, 0, 0], el.rot.axis, el.rot.a, false);
      n = turnN(n, steps);
      const shade = Math.abs(n[0]) > 0.7 ? (n[0] > 0 ? 0 : 1) : Math.abs(n[1]) > 0.7 ? (n[1] > 0 ? 2 : 3) : Math.abs(n[2]) > 0.7 ? (n[2] > 0 ? 4 : 5) : -1;
      // une face sur le bord n'est masquée par le voisin que si elle regarde vers lui
      if (edge >= 0 && edge !== turnFace(FACE_DIR[f], steps)) edge = -1;
      const tile = tileOf(face.t);
      quads.push({ p, uv, tile, edge, shade, trans: !!face.trans });
      if (el.both) {
        const bp: number[] = [], buv: number[] = [];
        for (const i of [1, 0, 3, 2]) {
          bp.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
          buv.push(uv[i * 2], uv[i * 2 + 1]);
        }
        quads.push({ p: bp, uv: buv, tile, edge: -1, shade, trans: !!face.trans });
      }
    }
  }
  const boxes: Box[] = model.els.map((e) => {
    const p0 = turn(e.from as V3, steps), p1 = turn(e.to as V3, steps);
    const bx: Box = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]), Math.max(p0[2], p1[2])];
    // éléments plats ou inclinés : boîte d'au moins 1 px pour le contour
    if (bx[4] - bx[1] < 1) bx[4] = Math.min(16, bx[1] + 1);
    if (bx[3] - bx[0] < 1) { bx[0] = Math.max(0, bx[0] - 0.5); bx[3] = Math.min(16, bx[3] + 0.5); }
    if (bx[5] - bx[2] < 1) { bx[2] = Math.max(0, bx[2] - 0.5); bx[5] = Math.min(16, bx[5] + 0.5); }
    return bx.map((v) => Math.max(0, Math.min(16, v))) as Box;
  });
  const collision = model.collision ? model.collision.map((c) => rotBox(c as Box, steps)) : boxes;
  return { quads, collision, selection: boxes.length ? boxes : [[0, 0, 0, 16, 16, 16]] };
}

function rotBox(b: Box, steps: number): Box {
  const p0 = turn([b[0], b[1], b[2]], steps), p1 = turn([b[3], b[4], b[5]], steps);
  return [Math.min(p0[0], p1[0]), b[1], Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), b[4], Math.max(p0[2], p1[2])];
}

/** Direction (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z) après quarts de tour horaires. */
function turnFace(d: number, steps: number): number {
  if (d === 2 || d === 3) return d;
  const ring = [5, 0, 4, 1]; // nord, est, sud, ouest (sens horaire)
  return ring[(ring.indexOf(d) + steps) & 3];
}

/** Les quatre orientations (ou une seule) d'un modèle. */
export function buildJavaVisuals(model: JModel): BedrockVisual[] {
  return model.facing ? [0, 1, 2, 3].map((m) => buildJavaVisual(model, m)) : [buildJavaVisual(model, 0)];
}
