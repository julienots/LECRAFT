/**
 * Vue à travers les portails : quand un portail du Nether (ou de la Pâte à papier) est proche,
 * la dimension d'arrivée est chargée autour du portail de destination (petit monde à part, sans
 * créatures, en lecture seule) et filmée par une caméra virtuelle qui reproduit la position du
 * joueur devant le portail. L'image est rendue dans une texture que le shader des blocs affiche
 * sur les faces du portail (render/ChunkMaterial.ts, uPortalView) : on voit l'autre côté en direct.
 */
import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/Config';
import { NETHER_LAVA_LEVEL } from '../world/NetherGenerator';
import type { SaveManager } from '../save/SaveManager';
import { ChunkManager } from '../world/ChunkManager';
import { World } from '../world/World';
import { buildArrivalPortal, portalId, type PortalKind } from '../world/Portals';
import { TileRegistry } from './TileRegistry';
import type { createChunkMaterials } from './ChunkMaterial';

type Dim = 'overworld' | 'nether' | 'end' | 'paper';
interface PortalRef {
  kind: PortalKind;
  /** Centre du plan du portail (coordonnées monde). */
  cx: number;
  cy: number;
  cz: number;
  /** 0 : plan X (normale Z), 1 : plan Z (normale X). */
  axis: 0 | 1;
}

/** Ce que la vue demande à la session. */
export interface PortalViewHost {
  world: World;
  dimension: Dim;
  portals: Record<Dim, { x: number; y: number; z: number }[]>;
  saves: SaveManager | null;
  worldId: string;
  daylight: number;
}

const SCAN_R = 14;

export class PortalView {
  private world: World | null = null;
  private chunks: ChunkManager | null = null;
  private target: Dim | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.08, 400);
  private rt: THREE.WebGLRenderTarget | null = null;
  private src: PortalRef | null = null;
  private dest: PortalRef | null = null;
  private destGuess: { x: number; y: number; z: number; known: boolean; built?: boolean } | null = null;
  private scanTimer = 0;
  private lostTime = 0;
  /** Image rendue ce tour-ci (tests). */
  rendered = 0;

  constructor(private materials: ReturnType<typeof createChunkMaterials>) {
    this.camera.rotation.order = 'YXZ';
  }

  get active() {
    return !!this.src && !!this.chunks;
  }

  /** Portail le plus proche du joueur (plan, centre) ou null. */
  private scan(w: World, px: number, py: number, pz: number): PortalRef | null {
    const ids: [number, PortalKind][] = [[portalId('nether'), 'nether'], [portalId('paper'), 'paper']];
    let best: { x: number; y: number; z: number; kind: PortalKind; id: number } | null = null, bd = Infinity;
    const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz);
    for (let y = y0 - 6; y <= y0 + 8; y++)
      for (let z = z0 - SCAN_R; z <= z0 + SCAN_R; z++)
        for (let x = x0 - SCAN_R; x <= x0 + SCAN_R; x++) {
          const b = w.getBlock(x, y, z);
          if (b <= 0) continue;
          for (const [id, kind] of ids)
            if (id > 0 && b === id) {
              const d = (x + 0.5 - px) ** 2 + (y - py) ** 2 + (z + 0.5 - pz) ** 2;
              if (d < bd) {
                bd = d;
                best = { x, y, z, kind, id };
              }
            }
        }
    return best ? extent(w, best.x, best.y, best.z, best.id, best.kind) : null;
  }

  /** Mise à jour (chaque image) puis rendu de la vue si un portail est visible. */
  update(host: PortalViewHost, gl: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, dt: number, enabled: boolean) {
    const u = this.materials.uniforms;
    u.uPortalViewOn.value = 0;
    if (!enabled || (host.dimension !== 'overworld' && host.dimension !== 'nether' && host.dimension !== 'paper')) {
      this.release();
      return;
    }
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.5;
      this.src = this.scan(host.world, cam.position.x, cam.position.y - 1.6, cam.position.z);
      if (this.src) {
        this.lostTime = 0;
        const target = destinationOf(host.dimension, this.src.kind);
        if (!target) this.src = null;
        else if (target !== this.target) this.open(host, target);
        if (this.src) this.locateDestination(host);
      }
    }
    if (!this.src) {
      this.lostTime += dt;
      // plus de portail à proximité : le monde d'aperçu est libéré au bout de 20 s
      if (this.lostTime > 20) this.release();
      return;
    }
    if (!this.chunks || !this.world || !this.destGuess) return;
    const g = this.destGuess;
    this.chunks.update(g.x, g.z);
    // pas encore de portail de l'autre côté : il est construit dans le monde d'aperçu (jamais
    // sauvegardé) exactement comme à l'arrivée (Session.arrive), dès que le terrain est chargé
    if (!g.known && this.areaLoaded(g.x, g.z)) {
      const w = this.world, tx = Math.floor(g.x), tz = Math.floor(g.z);
      const prefer = this.target === 'nether' ? Math.max(NETHER_LAVA_LEVEL + 8, Math.min(100, Math.round(g.y))) : w.surfaceBelow(tx, WORLD_HEIGHT - 2, tz) + 1;
      const spot = buildArrivalPortal(w, tx, tz, this.target!, prefer, this.src.kind);
      const id = portalId(this.src.kind);
      if (w.getBlock(spot.x, spot.y, spot.z) === id) this.dest = extent(w, spot.x, spot.y, spot.z, id, this.src.kind);
      g.known = true;
      g.built = true;
    }
    if (!this.dest || this.chunks.group.children.length === 0) return;
    // portail hors du champ de vision : rien à dessiner
    const s = this.src;
    const toPortal = new THREE.Vector3(s.cx - cam.position.x, s.cy - cam.position.y, s.cz - cam.position.z);
    const dist = toPortal.length();
    if (dist > SCAN_R + 8) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    if (dist > 2 && fwd.dot(toPortal) / dist < Math.cos(((cam.fov * cam.aspect) / 2 + 20) * (Math.PI / 180))) return;
    this.render(host, gl, cam);
    u.uPortalViewOn.value = 1;
    u.uPortalView.value = this.rt!.texture;
    u.uViewTileA.value = TileRegistry.has('nether_portal') ? TileRegistry.index('nether_portal') : -1;
    u.uViewTileB.value = TileRegistry.has('paper_portal') ? TileRegistry.index('paper_portal') : -1;
  }

  /** Charge (sans sauvegarde) la dimension d'arrivée. */
  private open(host: PortalViewHost, target: Dim) {
    this.release();
    this.target = target;
    this.world = new World(host.world.seed);
    const prefix = target === 'overworld' ? host.worldId : `${host.worldId}:${target}`;
    // lecture seule : aucun bloc n'est modifié dans ce monde, rien n'est jamais réécrit
    this.chunks = new ChunkManager(this.world, this.materials, host.saves, prefix, { renderDistance: 2, jobsInFlight: 1, meshUploadsPerFrame: 2 }, target);
    this.chunks.onError = () => {};
    this.scene.add(this.chunks.group);
  }

  /** Terrain d'aperçu chargé autour du point d'arrivée (3 × 3 chunks). */
  private areaLoaded(x: number, z: number) {
    const w = this.world!;
    for (let dz = -16; dz <= 16; dz += 16) for (let dx = -16; dx <= 16; dx += 16) if (!w.isLoaded(Math.floor(x + dx), Math.floor(z + dz))) return false;
    return true;
  }

  /** Portail d'arrivée : portail connu le plus proche du point correspondant, sinon point estimé. */
  private locateDestination(host: PortalViewHost) {
    const s = this.src!, target = this.target!;
    const k = target === 'nether' ? 1 / 8 : host.dimension === 'nether' ? 8 : 1;
    const tx = s.cx * k, tz = s.cz * k;
    const radius = target === 'nether' ? 16 : 128;
    let best: { x: number; y: number; z: number } | null = null, bd = radius;
    for (const p of host.portals[target] ?? []) {
      const d = Math.hypot(p.x - tx, p.z - tz);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const w = this.world!;
    if (best) {
      // portail réel de l'autre côté : son plan exact une fois le terrain chargé
      const id = portalId(s.kind);
      const real = w.getBlock(best.x, best.y, best.z) === id ? extent(w, best.x, best.y, best.z, id, s.kind) : null;
      this.dest = real ?? { kind: s.kind, cx: best.x + 1, cy: best.y + 1.5, cz: best.z + 0.5, axis: 0 };
      this.destGuess = { x: this.dest.cx, y: this.dest.cy, z: this.dest.cz, known: true };
      return;
    }
    // pas encore de portail : celui que le voyage construira (calculé une fois le terrain chargé)
    if (this.destGuess?.built && Math.hypot(this.destGuess.x - tx, this.destGuess.z - tz) <= 2) return;
    if (!this.destGuess || Math.hypot(this.destGuess.x - tx, this.destGuess.z - tz) > 2) {
      // le joueur arrive à sa hauteur, bornée comme dans Game.changeDimension
      this.destGuess = { x: tx, y: Math.min(120, Math.max(40, s.cy)), z: tz, known: false };
      this.dest = null;
    }
  }

  private render(host: PortalViewHost, gl: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera) {
    const s = this.src!, d = this.dest!;
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.round(size.x / 2)), h = Math.max(1, Math.round(size.y / 2));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
      this.rt.texture.colorSpace = THREE.NoColorSpace;
    }
    // caméra virtuelle : même position relative au portail (tournée si les plans diffèrent)
    let rx = cam.position.x - s.cx, ry = cam.position.y - s.cy, rz = cam.position.z - s.cz;
    let yaw = cam.rotation.y;
    if (s.axis !== d.axis) {
      [rx, rz] = s.axis === 0 ? [-rz, rx] : [rz, -rx];
      yaw += s.axis === 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    const c = this.camera;
    c.position.set(d.cx + rx, d.cy + ry, d.cz + rz);
    c.rotation.set(cam.rotation.x, yaw, 0);
    c.fov = cam.fov;
    c.aspect = cam.aspect;
    c.near = 0.08;
    c.far = 2 * CHUNK_SIZE * 2 + 24;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    // plan de coupe oblique sur la surface du portail d'arrivée (technique des miroirs) : ce qui se
    // trouve entre la caméra virtuelle et le portail n'est pas dessiné, le reste l'est en entier
    const n = d.axis === 0 ? new THREE.Vector3(0, 0, Math.sign(d.cz - c.position.z) || 1) : new THREE.Vector3(Math.sign(d.cx - c.position.x) || 1, 0, 0);
    const point = new THREE.Vector3(d.cx, d.cy, d.cz).addScaledVector(n, 0.15);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, point).applyMatrix4(c.matrixWorldInverse);
    const cp = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = c.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(cp.x) + pm[8]) / pm[0], (Math.sign(cp.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    cp.multiplyScalar(2 / cp.dot(q));
    pm[2] = cp.x;
    pm[6] = cp.y;
    pm[10] = cp.z + 1;
    pm[14] = cp.w;
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    // éclairage, brouillard et ciel de la dimension d'arrivée
    const u = this.materials.uniforms;
    const saved = { day: u.uDaylight.value, amb: u.uAmbient.value, near: u.uFogNear.value, far: u.uFogFar.value, fog: u.uFogColor.value.clone(), sh: u.uShaders.value };
    const t = this.target;
    const fog = t === 'nether' ? new THREE.Color(0x330808) : t === 'paper' ? new THREE.Color(0xe8eef8) : new THREE.Color(0x87b8f0).multiplyScalar(Math.max(0.12, host.daylight));
    u.uDaylight.value = t === 'nether' ? 0 : t === 'paper' ? 1 : Math.max(0.3, host.daylight);
    u.uAmbient.value = t === 'nether' ? 0.3 : t === 'paper' ? 0.28 : 0.035;
    u.uFogNear.value = t === 'nether' ? 4 : 20;
    u.uFogFar.value = t === 'nether' ? 40 : 2 * CHUNK_SIZE * 2;
    u.uFogColor.value.copy(fog);
    u.uShaders.value = Math.min(1, saved.sh);
    const clear = new THREE.Color();
    gl.getClearColor(clear);
    const clearA = gl.getClearAlpha();
    // la texture de la vue ne doit pas être lue pendant qu'on la dessine (boucle interdite par WebGL :
    // tout le dessin serait ignoré)
    u.uPortalView.value = null;
    u.uPortalViewOn.value = 0;
    gl.setRenderTarget(this.rt);
    gl.setClearColor(fog, 1);
    gl.clear();
    gl.render(this.scene, c);
    gl.setRenderTarget(null);
    gl.setClearColor(clear, clearA);
    u.uDaylight.value = saved.day;
    u.uAmbient.value = saved.amb;
    u.uFogNear.value = saved.near;
    u.uFogFar.value = saved.far;
    u.uFogColor.value.copy(saved.fog);
    u.uShaders.value = saved.sh;
    this.rendered++;
  }

  /** Libère le monde d'aperçu (plus de portail proche, autre dimension, fermeture). */
  release() {
    if (this.chunks) {
      this.scene.remove(this.chunks.group);
      this.chunks.dispose();
    }
    this.chunks = null;
    this.world = null;
    this.target = null;
    this.dest = null;
    this.destGuess = null;
  }

  dispose() {
    this.release();
    this.rt?.dispose();
    this.rt = null;
    this.materials.uniforms.uPortalViewOn.value = 0;
    this.materials.uniforms.uPortalView.value = null;
  }
}

function destinationOf(dim: Dim, kind: PortalKind): Dim | null {
  if (kind === 'nether') return dim === 'overworld' ? 'nether' : dim === 'nether' ? 'overworld' : null;
  return dim === 'overworld' ? 'paper' : dim === 'paper' ? 'overworld' : null;
}

/** Plan et centre du portail qui contient (x, y, z). */
function extent(w: World, x: number, y: number, z: number, id: number, kind: PortalKind): PortalRef {
  const axis = (w.getMeta(x, y, z) & 1) as 0 | 1;
  const ax = axis === 0 ? 1 : 0, az = axis === 0 ? 0 : 1;
  let lo = 0, hi = 0, bottom = y, top = y;
  while (lo > -22 && w.getBlock(x + (lo - 1) * ax, y, z + (lo - 1) * az) === id) lo--;
  while (hi < 22 && w.getBlock(x + (hi + 1) * ax, y, z + (hi + 1) * az) === id) hi++;
  while (bottom > y - 22 && w.getBlock(x, bottom - 1, z) === id) bottom--;
  while (top < y + 22 && w.getBlock(x, top + 1, z) === id) top++;
  const mid = (lo + hi + 1) / 2;
  return { kind, axis, cx: x + (axis === 0 ? mid : 0.5), cy: (bottom + top + 1) / 2, cz: z + (axis === 0 ? 0.5 : mid) };
}

void BlockRegistry;
