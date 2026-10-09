/**
 * Meshing des chunks (exécuté dans le worker) :
 * - face culling (aucune face entre deux blocs opaques)
 * - greedy meshing des faces uniformes (même tuile, même lumière, même AO, même teinte)
 * - occlusion ambiante par sommet + lumière lissée
 * - plantes en croix, liquides avec hauteur variable
 * Sortie : deux géométries (opaque/cutout et translucide) en tableaux typés compacts.
 */
import { BlockRegistry, SHAPES } from '../blocks/BlockRegistry';
import { modelBoxes } from '../blocks/Shapes';
import { CHUNK_SIZE, WORLD_HEIGHT, LIGHT_PADDING } from '../core/Config';
import { TileRegistry } from './TileRegistry';

export const FLAG_SWAY = 1;
export const FLAG_ANIM = 4;
export const FLAG_WAVE = 8;
export const FLAG_LIQUID = 16;

export interface MeshArrays {
  pos: Int16Array; // xyz * 16
  uv: Uint16Array; // en 1/256 de tuile (1/16 de pixel)
  info: Uint16Array; // tile, flags, sky*16, block*16
  tint: Uint8Array; // r, g, b, shade
  index: Uint16Array | Uint32Array;
  vertexCount: number;
}

class Builder {
  pos: Int16Array;
  uv: Uint16Array;
  info: Uint16Array;
  tint: Uint8Array;
  idx: Uint32Array;
  v = 0;
  i = 0;
  constructor(cap = 65536) {
    this.pos = new Int16Array(cap * 3);
    this.uv = new Uint16Array(cap * 2);
    this.info = new Uint16Array(cap * 4);
    this.tint = new Uint8Array(cap * 4);
    this.idx = new Uint32Array(cap * 1.5);
  }
  reset() {
    this.v = 0;
    this.i = 0;
  }
  private grow() {
    const g = <T extends Int16Array | Uint8Array | Uint16Array | Uint32Array>(a: T): T => {
      const n = new (a.constructor as { new (n: number): T })(a.length * 2);
      n.set(a);
      return n;
    };
    this.pos = g(this.pos);
    this.uv = g(this.uv);
    this.info = g(this.info);
    this.tint = g(this.tint);
    this.idx = g(this.idx);
  }
  vertex(x: number, y: number, z: number, u: number, v: number, tile: number, flags: number, sky: number, blk: number, r: number, g: number, b: number, shade: number) {
    if ((this.v + 1) * 3 > this.pos.length) this.grow();
    const k = this.v;
    this.pos[k * 3] = Math.round(x * 16);
    this.pos[k * 3 + 1] = Math.round(y * 16);
    this.pos[k * 3 + 2] = Math.round(z * 16);
    this.uv[k * 2] = Math.round(u * 16);
    this.uv[k * 2 + 1] = Math.round(v * 16);
    this.info[k * 4] = tile;
    this.info[k * 4 + 1] = flags;
    this.info[k * 4 + 2] = sky;
    this.info[k * 4 + 3] = blk;
    this.tint[k * 4] = r;
    this.tint[k * 4 + 1] = g;
    this.tint[k * 4 + 2] = b;
    this.tint[k * 4 + 3] = shade;
    this.v++;
    return k;
  }
  quad(a: number, b: number, c: number, d: number, flip: boolean) {
    if (this.i + 6 > this.idx.length) this.grow();
    const I = this.idx;
    if (!flip) {
      I[this.i++] = a; I[this.i++] = b; I[this.i++] = c;
      I[this.i++] = a; I[this.i++] = c; I[this.i++] = d;
    } else {
      I[this.i++] = b; I[this.i++] = c; I[this.i++] = d;
      I[this.i++] = b; I[this.i++] = d; I[this.i++] = a;
    }
  }
  output(): MeshArrays {
    const vc = this.v;
    return {
      pos: this.pos.slice(0, vc * 3),
      uv: this.uv.slice(0, vc * 2),
      info: this.info.slice(0, vc * 4),
      tint: this.tint.slice(0, vc * 4),
      index: vc > 65535 ? this.idx.slice(0, this.i) : Uint16Array.from(this.idx.subarray(0, this.i)),
      vertexCount: vc,
    };
  }
}

// Directions : 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z
const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const FACE_SHADE = [0.78, 0.78, 1.0, 0.55, 0.9, 0.9];
const AO_CURVE = [1.0, 0.78, 0.62, 0.48];
// face avant selon la méta d'orientation : 0 sud(+Z), 1 ouest(-X), 2 nord(-Z), 3 est(+X)
const FRONT_FACE = [4, 1, 5, 0];
/** Tuile d'une face latérale d'un bloc orientable : avant, dos, puis côtés droit / gauche. */
function orientTile(ft: number[], d: number, meta: number): number {
  const rel = (FRONT_FACE.indexOf(d) - (meta & 3)) & 3;
  return rel === 0 ? ft[4] : rel === 2 ? ft[5] : rel === 1 ? ft[1] : ft[0];
}

export interface MeshInput {
  /** Volume padded (W x H x W) des ID de blocs. */
  blocks: Uint16Array;
  /** Méta du chunk central uniquement (16x128x16). */
  meta: Uint8Array;
  sky: Uint8Array;
  blk: Uint8Array;
  /** Teinte herbe/feuillage par colonne du chunk central (16x16 x 3 octets chacun). */
  grassTint: Uint8Array;
  foliageTint: Uint8Array;
  maxY: number;
}

const P = LIGHT_PADDING;
const W = CHUNK_SIZE + 2 * P;
const AREA = W * W;

export class ChunkMesher {
  private opaque = new Builder(32768);
  private trans = new Builder(8192);
  // masques greedy réutilisés
  private maskKey = new Int32Array(CHUNK_SIZE * WORLD_HEIGHT);
  private maskLight = new Int32Array(CHUNK_SIZE * WORLD_HEIGHT);
  private maskTint = new Int32Array(CHUNK_SIZE * WORLD_HEIGHT);
  private maskCorner = new Int32Array(CHUNK_SIZE * WORLD_HEIGHT * 4);

  mesh(inp: MeshInput): { opaque: MeshArrays; trans: MeshArrays } {
    this.opaque.reset();
    this.trans.reset();
    const maxY = Math.min(WORLD_HEIGHT - 1, inp.maxY + 1);
    for (let d = 0; d < 6; d++) this.greedyDir(inp, d, maxY);
    this.specials(inp, maxY);
    return { opaque: this.opaque.output(), trans: this.trans.output() };
  }

  /** Visibilité de la face d'un bloc « cubique » vers un voisin. */
  private faceVisible(b: number, n: number): boolean {
    const R = BlockRegistry;
    if (R.opaque[n]) return false;
    const rt = R.renderType[b];
    if (rt === 1) return true; // cube opaque : visible contre tout non-opaque
    // translucide (glace, verre…) contre de l'eau : seule la face de l'eau est dessinée (pas de double paroi)
    if (rt === 5 && R.renderType[n] === 4 && R.blocks[n].liquid === 'water') return false;
    return n !== b; // cutout/translucide : masqué contre lui-même
  }

  private greedyDir(inp: MeshInput, d: number, maxY: number) {
    const R = BlockRegistry;
    const [dx, dy, dz] = DIRS[d];
    const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
    // axes (u, v) du plan de la face
    const uAxis = axis === 0 ? 2 : 0;
    const vAxis = axis === 1 ? 2 : 1;
    const dims = [CHUNK_SIZE, maxY + 1, CHUNK_SIZE];
    const U = dims[uAxis], V = dims[vAxis], S = dims[axis];
    const { blocks, sky, blk, meta } = inp;
    const mk = this.maskKey, ml = this.maskLight, mt = this.maskTint, mc = this.maskCorner;
    const pos = [0, 0, 0];
    const step = (a: number) => (a === 0 ? 1 : a === 1 ? AREA : W);
    const du = step(uAxis), dv = step(vAxis), dn = dx + dy * AREA + dz * W;
    const sign = dx + dy + dz;

    for (let s = 0; s < S; s++) {
      pos[axis] = s;
      // --- construction du masque ---
      for (let v = 0; v < V; v++)
        for (let u = 0; u < U; u++) {
          pos[uAxis] = u;
          pos[vAxis] = v;
          const m = u + v * U;
          mk[m] = -1;
          const x = pos[0], y = pos[1], z = pos[2];
          const pi = x + P + (z + P) * W + y * AREA;
          const b = blocks[pi];
          const rt = R.renderType[b];
          if (rt !== 1 && rt !== 2 && rt !== 5) continue;
          const ny = y + dy;
          let nb = 0;
          if (ny >= 0 && ny < WORLD_HEIGHT) nb = blocks[pi + dn];
          else if (ny < 0) continue;
          if (!this.faceVisible(b, nb)) continue;
          const block = R.blocks[b];
          const li = (x + z * CHUNK_SIZE + y * 256);
          const bm = meta[li];
          let tile = block.faceTiles[d];
          if (block.orientable && d !== 2 && d !== 3) tile = orientTile(block.faceTiles, d, bm);
          else if (block.metaTiles && d === 2) tile = block.metaTiles[Math.min(bm, block.metaTiles.length - 1)];
          const flags = (block.sway && R.renderType[b] === 2 ? FLAG_SWAY : 0) | (TileRegistry.animFrames[tile] > 1 ? FLAG_ANIM : 0);
          const layer = rt === 5 ? 1 : 0;
          // lumière + AO aux 4 coins
          const ni = ny < WORLD_HEIGHT ? pi + dn : pi;
          let uniform = true;
          let first = -1;
          for (let c = 0; c < 4; c++) {
            const su = c === 1 || c === 2 ? 1 : -1;
            const sv = c >= 2 ? 1 : -1;
            const side1 = ni + su * du, side2 = ni + sv * dv, corner = ni + su * du + sv * dv;
            const o1 = this.occ(blocks, side1);
            const o2 = this.occ(blocks, side2);
            const o3 = this.occ(blocks, corner);
            const ao = o1 && o2 ? 3 : o1 + o2 + o3;
            const N = blocks.length;
            let ss = sky[ni], bb = blk[ni], cnt = 1;
            if (!o1) { ss += side1 < N ? sky[side1] : 15; bb += side1 < N ? blk[side1] : 0; cnt++; }
            if (!o2) { ss += side2 < N ? sky[side2] : 15; bb += side2 < N ? blk[side2] : 0; cnt++; }
            if (!o3 && !(o1 && o2)) { ss += corner < N ? sky[corner] : 15; bb += corner < N ? blk[corner] : 0; cnt++; }
            const sl = Math.round((ss * 16) / cnt), bl = Math.round((bb * 16) / cnt);
            const packed = (ao << 18) | (Math.min(255, sl) << 9) | Math.min(255, bl);
            mc[m * 4 + c] = packed;
            if (first < 0) first = packed;
            else if (packed !== first) uniform = false;
          }
          const tint = this.tintOf(inp, b, x, z);
          mk[m] = tile | (flags << 12) | (layer << 20) | ((uniform ? 1 : 0) << 21); // tuile sur 12 bits (atlas 64×64)
          ml[m] = uniform ? first : -2 - m; // valeurs uniques pour empêcher la fusion
          mt[m] = tint;
        }
      // --- fusion greedy ---
      for (let v = 0; v < V; v++)
        for (let u = 0; u < U; ) {
          const m = u + v * U;
          const key = mk[m];
          if (key < 0) {
            u++;
            continue;
          }
          const light = ml[m], tint = mt[m];
          const canMerge = (key >> 21) & 1;
          let w = 1;
          if (canMerge) while (u + w < U && mk[m + w] === key && ml[m + w] === light && mt[m + w] === tint) w++;
          let h = 1;
          if (canMerge) {
            outer: while (v + h < V) {
              for (let k = 0; k < w; k++) {
                const mm = m + k + h * U;
                if (mk[mm] !== key || ml[mm] !== light || mt[mm] !== tint) break outer;
              }
              h++;
            }
          }
          this.emitFace(d, axis, uAxis, vAxis, s, u, v, w, h, key, m, tint, sign);
          for (let hh = 0; hh < h; hh++) for (let ww = 0; ww < w; ww++) mk[m + ww + hh * U] = -1;
          u += w;
        }
    }
  }

  /** Occlusion : vrai si la cellule est opaque. */
  private occ(blocks: Uint16Array, i: number): number {
    if (i < 0) return 1; // sous le monde : considéré plein
    if (i >= blocks.length) return 0;
    return BlockRegistry.opaque[blocks[i]];
  }

  private emitFace(d: number, axis: number, uAxis: number, vAxis: number, s: number, u: number, v: number, w: number, h: number, key: number, m: number, tint: number, sign: number) {
    const tile = key & 4095;
    const flags = (key >> 12) & 255;
    const layer = (key >> 20) & 1;
    const builder = layer ? this.trans : this.opaque;
    const mc = this.maskCorner;
    const plane = s + (sign > 0 ? 1 : 0);
    const r = (tint >> 16) & 255, g = (tint >> 8) & 255, b = tint & 255;
    const corners = [
      [u, v], [u + w, v], [u + w, v + h], [u, v + h],
    ];
    const uvs = [
      [0, 0], [w * 16, 0], [w * 16, h * 16], [0, h * 16],
    ];
    const ids: number[] = [];
    const aos: number[] = [];
    for (let c = 0; c < 4; c++) {
      const p = [0, 0, 0];
      p[axis] = plane;
      p[uAxis] = corners[c][0];
      p[vAxis] = corners[c][1];
      const packed = mc[m * 4 + c];
      const ao = (packed >> 18) & 3;
      const sl = (packed >> 9) & 511, bl = packed & 511;
      aos.push(ao);
      const shade = Math.round(255 * FACE_SHADE[d] * AO_CURVE[ao]);
      // orientation de la texture : sur les faces latérales, v suit l'axe Y
      ids.push(builder.vertex(p[0], p[1], p[2], uvs[c][0], uvs[c][1], tile, flags, Math.min(255, sl), Math.min(255, bl), r, g, b, shade));
    }
    // ordre CCW vu de l'extérieur
    const n = [0, 0, 0];
    n[axis] = sign;
    const ua = [0, 0, 0], va = [0, 0, 0];
    ua[uAxis] = 1;
    va[vAxis] = 1;
    const cr = [ua[1] * va[2] - ua[2] * va[1], ua[2] * va[0] - ua[0] * va[2], ua[0] * va[1] - ua[1] * va[0]];
    const dot = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2];
    const flip = aos[0] + aos[2] > aos[1] + aos[3];
    if (dot > 0) builder.quad(ids[0], ids[1], ids[2], ids[3], flip);
    else builder.quad(ids[0], ids[3], ids[2], ids[1], flip);
  }

  /** Plantes en croix et liquides. */
  private specials(inp: MeshInput, maxY: number) {
    const R = BlockRegistry;
    const { blocks, meta, sky, blk } = inp;
    for (let y = 0; y <= maxY; y++)
      for (let z = 0; z < CHUNK_SIZE; z++)
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const pi = x + P + (z + P) * W + y * AREA;
          const b = blocks[pi];
          const rt = R.renderType[b];
          if (rt === 3) this.cross(inp, x, y, z, pi, b);
          else if (rt === 4) this.liquid(blocks, meta, sky, blk, x, y, z, pi, b);
          else if (rt === 6) this.model(inp, x, y, z, pi, b);
        }
  }

  private cross(inp: MeshInput, x: number, y: number, z: number, pi: number, b: number) {
    const block = BlockRegistry.blocks[b];
    const m = inp.meta[x + z * 16 + y * 256];
    const tile = block.metaTiles ? block.metaTiles[Math.min(m, block.metaTiles.length - 1)] : block.faceTiles[0];
    const sl = inp.sky[pi] * 16, bl = inp.blk[pi] * 16;
    const tint = this.tintOf(inp, b, x, z);
    const r = (tint >> 16) & 255, g = (tint >> 8) & 255, bb = tint & 255;
    const sway = block.sway ? FLAG_SWAY : 0;
    // moitié haute d'une plante haute : sa base suit le haut de la moitié basse
    const swayLow = sway && block.def.doublePlant && m & 1 ? sway : 0;
    const o = 0.15, e = 0.85;
    const quads = [
      [x + o, z + o, x + e, z + e],
      [x + o, z + e, x + e, z + o],
    ];
    const B = this.opaque;
    for (const [x0, z0, x1, z1] of quads) {
      const a = B.vertex(x0, y, z0, 0, 0, tile, swayLow, sl, bl, r, g, bb, 230);
      const c = B.vertex(x1, y, z1, 16, 0, tile, swayLow, sl, bl, r, g, bb, 230);
      const d = B.vertex(x1, y + 1, z1, 16, 16, tile, sway, sl, bl, r, g, bb, 230);
      const f = B.vertex(x0, y + 1, z0, 0, 16, tile, sway, sl, bl, r, g, bb, 230);
      B.quad(a, c, d, f, false);
      B.quad(a, f, d, c, false);
    }
  }

  /** Couleur de teinte (biome ou fixe) d'un bloc dans une colonne. */
  private tintOf(inp: MeshInput, b: number, x: number, z: number): number {
    const t = BlockRegistry.tintType[b];
    if (t === 0) return 0xffffff;
    if (t === 3) return BlockRegistry.tintColor[b];
    const col = (x + z * CHUNK_SIZE) * 3;
    const src = t === 2 ? inp.foliageTint : inp.grassTint;
    return (src[col] << 16) | (src[col + 1] << 8) | src[col + 2];
  }

  /** Bloc à forme : rendu de chaque boîte (faces au bord masquées par un voisin opaque). */
  private model(inp: MeshInput, x: number, y: number, z: number, pi: number, b: number) {
    const R = BlockRegistry;
    const block = R.blocks[b];
    const { blocks, sky, blk } = inp;
    const m = inp.meta[x + z * 16 + y * 256];
    const kind = SHAPES[R.shape[b] - 1];
    if (kind === 'custom' || block.visuals) return this.custom(inp, x, y, z, pi, b, m);
    const nb = (dx: number, dy: number, dz: number) => {
      const yy = y + dy;
      if (yy < 0 || yy >= WORLD_HEIGHT) return 0;
      return blocks[pi + dx + dy * AREA + dz * W];
    };
    const boxes = modelBoxes(b, m, nb);
    const tint = this.tintOf(inp, b, x, z);
    const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
    // vitres teintées : translucides comme le verre teinté
    const builder = block.key.includes('stained_glass') ? this.trans : this.opaque;
    const flags = 0;
    // cadre du portail de l'End : socle avec le dessus du cadre vide, œil (texture à transparence
    // dans les packs) sur la boîte du dessus uniquement — sinon le dessus du socle serait percé
    const frame = kind === 'end_frame' && R.has('end_portal_frame') ? R.byName('end_portal_frame') : null;
    for (let bi = 0; bi < boxes.length; bi++) {
      const bx = boxes[bi];
      const x0 = bx[0] / 16, y0 = bx[1] / 16, z0 = bx[2] / 16, x1 = bx[3] / 16, y1 = bx[4] / 16, z1 = bx[5] / 16;
      for (let d = 0; d < 6; d++) {
        const [dx, dy, dz] = DIRS[d];
        const onEdge = (d === 0 && bx[3] === 16) || (d === 1 && bx[0] === 0) || (d === 2 && bx[4] === 16) || (d === 3 && bx[1] === 0) || (d === 4 && bx[5] === 16) || (d === 5 && bx[2] === 0);
        let li = pi;
        if (onEdge) {
          if (y + dy < 0 || y + dy >= WORLD_HEIGHT) {
            if (dy < 0) continue;
          } else {
            const ni = pi + dx + dy * AREA + dz * W;
            if (R.opaque[blocks[ni]]) continue;
            li = ni;
          }
        }
        // tuile de la face
        let tile = block.faceTiles[d];
        if (kind === 'door' && block.metaTiles) tile = block.metaTiles[(m >> 3) & 1];
        else if (kind === 'bed' && block.metaTiles && d === 2) tile = block.metaTiles[(m >> 2) & 1];
        else if (kind === 'farmland' && block.metaTiles && d === 2) tile = block.metaTiles[m & 1];
        else if (block.orientable && d !== 2 && d !== 3) tile = orientTile(block.faceTiles, d, m);
        if (frame) {
          if (bi === 0 && d === 2) tile = frame.faceTiles[2];
          else if (bi === 1) tile = block.faceTiles[2];
        }
        const sl = li < blocks.length ? sky[li] * 16 : 240, bl = li < blocks.length ? blk[li] * 16 : 0;
        const shade = Math.round(255 * FACE_SHADE[d]);
        // sommets (même ordre CCW que les liquides) et UV en pixels de texture
        let c: number[][];
        let uv: number[][];
        const X0 = x + x0, X1 = x + x1, Y0 = y + y0, Y1 = y + y1, Z0 = z + z0, Z1 = z + z1;
        const px0 = bx[0], px1 = bx[3], py0 = bx[1], py1 = bx[4], pz0 = bx[2], pz1 = bx[5];
        switch (d) {
          case 0: c = [[X1, Y0, Z1], [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1]]; uv = [[16 - pz1, py0], [16 - pz0, py0], [16 - pz0, py1], [16 - pz1, py1]]; break;
          case 1: c = [[X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0]]; uv = [[pz0, py0], [pz1, py0], [pz1, py1], [pz0, py1]]; break;
          case 2: c = [[X0, Y1, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [X0, Y1, Z0]]; uv = [[px0, 16 - pz1], [px1, 16 - pz1], [px1, 16 - pz0], [px0, 16 - pz0]]; break;
          case 3: c = [[X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1]]; uv = [[px0, pz0], [px1, pz0], [px1, pz1], [px0, pz1]]; break;
          case 4: c = [[X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1]]; uv = [[px0, py0], [px1, py0], [px1, py1], [px0, py1]]; break;
          default: c = [[X1, Y0, Z0], [X0, Y0, Z0], [X0, Y1, Z0], [X1, Y1, Z0]]; uv = [[16 - px1, py0], [16 - px0, py0], [16 - px0, py1], [16 - px1, py1]]; break;
        }
        const ids = c.map((p, k) => builder.vertex(p[0], p[1], p[2], uv[k][0], uv[k][1], tile, flags, sl, bl, tr, tg, tb, shade));
        builder.quad(ids[0], ids[1], ids[2], ids[3], false);
      }
    }
  }

  /** Bloc d'add-on : quads précalculés de la permutation (méta). */
  private custom(inp: MeshInput, x: number, y: number, z: number, pi: number, b: number, m: number) {
    const R = BlockRegistry;
    const all = R.blocks[b].visuals ?? R.blocks[b].def.bedrock?.visuals;
    const vis = all?.[m & (all.length > 4 ? 255 : 3)] ?? all?.[0];
    if (!vis) return;
    const { blocks, sky, blk } = inp;
    for (const q of vis.quads) {
      let li = pi;
      if (q.edge >= 0) {
        const [dx, dy, dz] = DIRS[q.edge];
        if (y + dy >= 0 && y + dy < WORLD_HEIGHT) {
          const ni = pi + dx + dy * AREA + dz * W;
          if (R.opaque[blocks[ni]]) continue;
          li = ni;
        } else if (dy < 0) continue;
      }
      const sl = li < blocks.length ? Math.max(sky[li], sky[pi]) * 16 : 240, bl = li < blocks.length ? Math.max(blk[li], blk[pi]) * 16 : 0;
      const shade = Math.round(255 * (q.shade >= 0 ? FACE_SHADE[q.shade] : 0.85));
      const builder = q.trans ? this.trans : this.opaque;
      const p = q.p, uv = q.uv;
      const ids = [0, 1, 2, 3].map((k) => builder.vertex(x + p[k * 3] / 16, y + p[k * 3 + 1] / 16, z + p[k * 3 + 2] / 16, uv[k * 2], uv[k * 2 + 1], q.tile, 0, sl, bl, 255, 255, 255, shade));
      builder.quad(ids[0], ids[1], ids[2], ids[3], false);
    }
  }

  /** Hauteur d'une case de liquide (source 0,875, puis -0,1 par niveau ; 1 si le même liquide est au-dessus). */
  private liquidHeight(blocks: Uint16Array, meta: Uint8Array, x: number, y: number, z: number, pi: number, b: number) {
    if (y + 1 < WORLD_HEIGHT && blocks[pi + AREA] === b) return 1;
    const m = meta[x + z * 16 + y * 256];
    if (m === 0 || m >= 8) return 0.875;
    return Math.max(0.15, 0.875 - m * 0.1);
  }

  /**
   * Hauteur d'un coin de la surface, comme le jeu original : moyenne des 4 cases qui partagent le coin
   * (les sources pèsent 10 fois plus, une case vide tire vers le bas, un bloc plein est ignoré ;
   * 1 si du même liquide est au-dessus de l'une d'elles). Les surfaces voisines se raccordent en pente.
   */
  private cornerHeight(blocks: Uint16Array, meta: Uint8Array, x: number, y: number, z: number, pi: number, b: number, own: number, cx: number, cz: number) {
    let sum = 0, wsum = 0;
    for (let dz = cz - 1; dz <= cz; dz++)
      for (let dx = cx - 1; dx <= cx; dx++) {
        const ni = pi + dx + dz * W;
        const nb = blocks[ni];
        if (nb === b) {
          if (y + 1 < WORLD_HEIGHT && blocks[ni + AREA] === b) return 1;
          const nx = x + dx, nz = z + dz;
          const inside = nx >= 0 && nx < 16 && nz >= 0 && nz < 16;
          const h = inside ? this.liquidHeight(blocks, meta, nx, y, nz, ni, b) : own;
          const wgt = h >= 0.87 ? 10 : 1;
          sum += h * wgt;
          wsum += wgt;
        } else if (!BlockRegistry.solid[nb]) {
          wsum += 1;
        }
      }
    return wsum > 0 ? sum / wsum : own;
  }

  private liquid(blocks: Uint16Array, meta: Uint8Array, sky: Uint8Array, blk: Uint8Array, x: number, y: number, z: number, pi: number, b: number) {
    const R = BlockRegistry;
    const block = R.blocks[b];
    const isWater = block.liquid === 'water';
    const builder = isWater ? this.trans : this.opaque;
    const tile = block.faceTiles[0];
    const h = this.liquidHeight(blocks, meta, x, y, z, pi, b);
    // hauteurs des coins : (x, z), (x+1, z), (x, z+1), (x+1, z+1)
    const full = h >= 1;
    const h00 = full ? 1 : this.cornerHeight(blocks, meta, x, y, z, pi, b, h, 0, 0);
    const h10 = full ? 1 : this.cornerHeight(blocks, meta, x, y, z, pi, b, h, 1, 0);
    const h01 = full ? 1 : this.cornerHeight(blocks, meta, x, y, z, pi, b, h, 0, 1);
    const h11 = full ? 1 : this.cornerHeight(blocks, meta, x, y, z, pi, b, h, 1, 1);
    const top = Math.max(h00, h10, h01, h11);
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = DIRS[d];
      if (y + dy < 0 || y + dy >= WORLD_HEIGHT) continue;
      const ni = pi + dx + dy * AREA + dz * W;
      const n = blocks[ni];
      if (n === b) continue;
      if (d !== 2 && R.opaque[n]) continue;
      if (d === 2 && R.opaque[n] && top >= 1) continue;
      const sl = Math.max(sky[ni], sky[pi]) * 16, bl = Math.max(blk[ni], blk[pi]) * 16;
      const flags = FLAG_ANIM | FLAG_LIQUID | (d === 2 && top < 1 && isWater ? FLAG_WAVE : 0);
      const shade = Math.round(255 * FACE_SHADE[d]);
      const y0 = y;
      // 4 sommets [x, y, z] (y = hauteur relative du sommet ; 0 = bas du bloc)
      let c: [number, number, number][];
      switch (d) {
        case 0: c = [[x + 1, 0, z + 1], [x + 1, 0, z], [x + 1, h10, z], [x + 1, h11, z + 1]]; break;
        case 1: c = [[x, 0, z], [x, 0, z + 1], [x, h01, z + 1], [x, h00, z]]; break;
        case 2: c = [[x, h01, z + 1], [x + 1, h11, z + 1], [x + 1, h10, z], [x, h00, z]]; break;
        case 3: c = [[x, 0, z], [x + 1, 0, z], [x + 1, 0, z + 1], [x, 0, z + 1]]; break;
        case 4: c = [[x, 0, z + 1], [x + 1, 0, z + 1], [x + 1, h11, z + 1], [x, h01, z + 1]]; break;
        default: c = [[x + 1, 0, z], [x, 0, z], [x, h00, z], [x + 1, h10, z]]; break;
      }
      const ids = c.map((p, k) => {
        const v = d === 2 || d === 3 ? (k >= 2 ? 16 : 0) : Math.round(p[1] * 16);
        return builder.vertex(p[0], y0 + p[1], p[2], k === 1 || k === 2 ? 16 : 0, v, tile, flags, sl, bl, 255, 255, 255, shade);
      });
      builder.quad(ids[0], ids[1], ids[2], ids[3], false);
    }
  }
}

export const PADDED_W = W;

export const PADDED_AREA = AREA;
