/**
 * Couvercles animés des coffres (comme le jeu original) : à l'ouverture, le bloc passe en
 * « couvercle ouvert » (bit 128 de la méta : le maillage ne contient que le corps) et un
 * couvercle 3D texturé pivote autour de sa charnière arrière ; à la fermeture il redescend,
 * puis le bloc reprend son maillage complet. Coffre de l'Ender : même couvercle. Boîte de
 * shulker : le couvercle monte d'un demi-bloc en tournant de trois quarts de tour. Tonneau : le
 * dessus passe à la texture « ouvert » tant que l'interface est ouverte.
 */
import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { rotate, type Box } from '../blocks/Shapes';
import type { TextureManager } from './TextureManager';
import type { World } from '../world/World';

const OPEN_FLAG = 128;
const SPEED = 4; // ouverture complète en 0,25 s
const MAX_ANGLE = 1.25;
const SHULKER_SPEED = 2; // 10 ticks comme le jeu original
type Kind = 'chest' | 'shulker' | 'barrel';

function kindOf(world: World, x: number, y: number, z: number): Kind | null {
  const id = world.getBlock(x, y, z);
  if (id <= 0) return null;
  const b = BlockRegistry.get(id);
  if (b.shape === 'chest') return 'chest';
  if (b.shape === 'shulker') return 'shulker';
  if (b.key === 'barrel' && b.metaTiles) return 'barrel';
  return null;
}

interface Lid {
  x: number; y: number; z: number;
  t: number;
  target: number;
  kind: Kind;
  /** Couvercle (null pour le tonneau, dont seule la texture change). */
  pivot: THREE.Group | null;
  /** Axe de rotation et sens (charnière à l'arrière, côté opposé au loquet). */
  axis: 'x' | 'z';
  sign: number;
}

export class ChestLids {
  readonly group = new THREE.Group();
  private lids = new Map<string, Lid>();
  private mats = new Map<number, THREE.MeshBasicMaterial>();

  constructor(private tex: TextureManager) {}

  private mat(tile: number) {
    let m = this.mats.get(tile);
    if (!m) {
      const t = new THREE.CanvasTexture(this.tex.tile(tile));
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.NoColorSpace;
      m = new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.1 });
      this.mats.set(tile, m);
    }
    return m;
  }

  /** Boîte texturée (coordonnées en pixels du bloc), UV comme le maillage des blocs. */
  private box(b: Box, tiles: { top: number; side: number; front: number; bottom: number }, frontDir: number): THREE.Mesh[] {
    const [x0, y0, z0, x1, y1, z1] = b.map((v) => v / 16);
    const out: THREE.Mesh[] = [];
    // faces : [normale, coins (4), tuile]
    const faces: [number, [number, number, number][], number][] = [
      [0, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], frontDir === 0 ? tiles.front : tiles.side], // est
      [1, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], frontDir === 1 ? tiles.front : tiles.side], // ouest
      [2, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], tiles.top],
      [3, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], tiles.bottom],
      [4, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], frontDir === 4 ? tiles.front : tiles.side], // sud
      [5, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], frontDir === 5 ? tiles.front : tiles.side], // nord
    ];
    for (const [d, c, tile] of faces) {
      const pos: number[] = [], uv: number[] = [];
      for (const [x, y, z] of c) {
        pos.push(x, y, z);
        // UV : comme le maillage (u selon x ou z, v selon y ; dessus : x et z)
        if (d === 2 || d === 3) uv.push(x, 1 - z);
        else if (d === 0 || d === 1) uv.push(d === 0 ? 1 - z : z, y);
        else uv.push(d === 4 ? x : 1 - x, y);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new THREE.Mesh(g, this.mat(tile));
      out.push(m);
    }
    return out;
  }

  /** Ouvre le coffre, la boîte de shulker ou le tonneau en (x, y, z) (sans effet sur un autre bloc). */
  open(world: World, x: number, y: number, z: number) {
    const kind = kindOf(world, x, y, z);
    if (!kind) return;
    const id = world.getBlock(x, y, z);
    const b = BlockRegistry.get(id);
    const k = `${x},${y},${z}`;
    const cur = this.lids.get(k);
    if (cur) {
      cur.target = 1;
      return;
    }
    const meta = world.getMeta(x, y, z);
    if (kind === 'barrel') {
      this.lids.set(k, { x, y, z, t: 0, target: 1, kind, pivot: null, axis: 'x', sign: 1 });
      world.setBlock(x, y, z, id, meta | OPEN_FLAG, false);
      return;
    }
    if (kind === 'shulker') {
      // couvercle (moitié haute) : pivote autour de l'axe vertical du centre du bloc
      const tiles = { top: b.faceTiles[2], bottom: b.faceTiles[3], side: b.faceTiles[0], front: b.faceTiles[0] };
      const pivot = new THREE.Group();
      pivot.position.set(x + 0.5, y, z + 0.5);
      const inner = new THREE.Group();
      inner.position.set(-0.5, 0, -0.5);
      for (const m of this.box([0, 8, 0, 16, 16, 16], tiles, -1)) inner.add(m);
      pivot.add(inner);
      this.group.add(pivot);
      this.lids.set(k, { x, y, z, t: 0, target: 1, kind, pivot, axis: 'x', sign: 1 });
      world.setBlock(x, y, z, id, meta | OPEN_FLAG, false);
      return;
    }
    const f = meta & 3;
    // loquet tourné comme dans Shapes : il indique la façade
    const latch = rotate([7, 7, 0, 9, 11, 1], f);
    const frontDir = latch[2] < 1 ? 5 : latch[5] > 15 ? 4 : latch[0] < 1 ? 1 : 0;
    const tiles = { top: b.faceTiles[2], bottom: b.faceTiles[3], side: b.faceTiles[0], front: b.faceTiles[4] };
    // charnière : arête arrière en haut du corps (y = 10)
    const hinge: [number, number, number] =
      frontDir === 5 ? [8, 10, 15] : frontDir === 4 ? [8, 10, 1] : frontDir === 1 ? [15, 10, 8] : [1, 10, 8];
    const pivot = new THREE.Group();
    pivot.position.set(x + hinge[0] / 16, y + hinge[1] / 16, z + hinge[2] / 16);
    const inner = new THREE.Group();
    inner.position.set(-hinge[0] / 16, -hinge[1] / 16, -hinge[2] / 16);
    for (const m of [...this.box([1, 10, 1, 15, 14, 15], tiles, frontDir), ...this.box(latch, tiles, frontDir)]) inner.add(m);
    pivot.add(inner);
    this.group.add(pivot);
    const axis = frontDir === 4 || frontDir === 5 ? 'x' : 'z';
    const sign = frontDir === 5 ? 1 : frontDir === 4 ? -1 : frontDir === 1 ? -1 : 1;
    this.lids.set(k, { x, y, z, t: 0, target: 1, kind, pivot, axis, sign });
    world.setBlock(x, y, z, id, meta | OPEN_FLAG, false);
  }

  close(x: number, y: number, z: number) {
    const l = this.lids.get(`${x},${y},${z}`);
    if (l) l.target = 0;
  }

  /** Animation (chaque image) et luminosité selon l'éclairage du bloc. */
  update(world: World, dt: number, daylight: number) {
    for (const [k, l] of this.lids) {
      const sp = l.kind === 'shulker' ? SHULKER_SPEED : SPEED;
      l.t = l.target > l.t ? Math.min(1, l.t + dt * sp) : Math.max(0, l.t - dt * sp);
      const e = l.t * l.t * (3 - 2 * l.t);
      if (!l.pivot) {
        // tonneau : rien à animer, la texture revient à la fermeture
        if (l.target === 0) this.finish(world, k, l);
        continue;
      }
      if (l.kind === 'shulker') {
        l.pivot.position.y = l.y + e * 0.5;
        l.pivot.rotation.y = e * Math.PI * 1.5;
      } else if (l.axis === 'x') l.pivot.rotation.x = l.sign * e * MAX_ANGLE;
      else l.pivot.rotation.z = l.sign * e * MAX_ANGLE;
      const li = world.getLight(l.x, l.y, l.z);
      const v = 0.18 + 0.82 * Math.max(li.block / 15, (li.sky / 15) * daylight);
      l.pivot.traverse((o) => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setScalar(v));
      if (l.t <= 0 && l.target === 0) this.finish(world, k, l);
    }
  }

  private finish(world: World, k: string, l: Lid) {
    if (l.pivot) {
      this.group.remove(l.pivot);
      l.pivot.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
    }
    this.lids.delete(k);
    const id = world.getBlock(l.x, l.y, l.z);
    if (id > 0 && kindOf(world, l.x, l.y, l.z) === l.kind) world.setBlock(l.x, l.y, l.z, id, world.getMeta(l.x, l.y, l.z) & ~OPEN_FLAG, false);
  }

  /** Avant une sauvegarde : tous les couvercles refermés (la méta enregistrée reste normale). */
  closeAll(world: World) {
    for (const [k, l] of [...this.lids]) this.finish(world, k, l);
  }

  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
    for (const m of this.mats.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.mats.clear();
    this.lids.clear();
  }
}
