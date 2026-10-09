import * as THREE from 'three';
import { ADDON_BLOCKS, ADDON_TILES } from '../addons/AddonRegistry';
import { CHUNK_SIZE } from '../core/Config';
import { chunkKey } from '../util/math';
import type { MeshArrays } from '../render/ChunkMesher';
import type { FromWorker, ToWorker } from '../workers/protocol';
import type { SaveManager, SavedChunk } from '../save/SaveManager';
import { Chunk } from './Chunk';
import type { World } from './World';
import type { SpecialBlock } from './ChunkData';

export interface ChunkManagerOptions {
  renderDistance: number;
  jobsInFlight: number;
  meshUploadsPerFrame: number;
}

interface PendingMesh {
  cx: number;
  cz: number;
  job: number;
  opaque: MeshArrays;
  trans: MeshArrays;
  light: Uint8Array;
}

/**
 * Gestion des chunks autour du joueur :
 * file de chargement (sauvegarde → sinon génération dans le worker), file de meshing
 * (priorité : modifications du joueur, puis distance), upload des meshes avec budget par frame,
 * déchargement (avec sauvegarde des chunks modifiés) et libération des ressources WebGL.
 */
export class ChunkManager {
  private worker: Worker;
  private loading = new Set<string>();
  private loadsInFlight = 0;
  private meshesInFlight = 0;
  private pendingMeshes: PendingMesh[] = [];
  private jobCounter = 0;
  readonly group = new THREE.Group();
  stats = { meshMs: 0, meshCount: 0, generated: 0, loadedFromSave: 0 };
  private locateCallbacks = new Map<number, (r: { x: number; z: number; found: boolean }) => void>();
  onSpecials: (s: SpecialBlock[]) => void = () => {};
  onError: (msg: string) => void = (m) => console.error('[worker]', m);
  private centerCX = 0;
  private centerCZ = 0;
  disposed = false;
  /** Multijoueur (invité) : chunks fournis par l'hôte (null = non modifié, généré localement). */
  remote: ((cx: number, cz: number) => Promise<{ blocks: Uint16Array; meta: Uint8Array } | null>) | null = null;
  /** Multijoueur (hôte) : positions des joueurs distants, autour desquelles le terrain reste chargé. */
  extraCenters: { x: number; z: number }[] = [];

  constructor(
    private world: World,
    private materials: { opaque: THREE.Material; trans: THREE.Material },
    private saves: SaveManager | null,
    private worldId: string | null,
    public opts: ChunkManagerOptions,
    readonly dimension: 'overworld' | 'nether' | 'end' | 'paper' | 'server' = 'overworld',
  ) {
    this.worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.onError(e.message);
    this.post({ type: 'init', seed: world.seed, dimension, addonBlocks: ADDON_BLOCKS, addonTiles: ADDON_TILES });
    this.group.name = 'chunks';
  }

  private post(m: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }

  get loadRadius() {
    return this.opts.renderDistance + 1;
  }

  /** Nombre de chunks prêts à l'affichage dans un rayon donné (écran de chargement). */
  readyCount(radius: number): { ready: number; total: number } {
    let ready = 0, total = 0;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        total++;
        const c = this.world.getChunk(this.centerCX + dx, this.centerCZ + dz);
        if (c && c.appliedJob >= 0) ready++;
      }
    return { ready, total };
  }

  update(px: number, pz: number) {
    if (this.disposed) return;
    this.flushEdits();
    const ccx = Math.floor(px / CHUNK_SIZE), ccz = Math.floor(pz / CHUNK_SIZE);
    this.centerCX = ccx;
    this.centerCZ = ccz;
    const R = this.loadRadius;
    // 1) chargements, du plus proche au plus lointain
    if (this.loadsInFlight < this.opts.jobsInFlight + 2) {
      outer: for (let r = 0; r <= R; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const cx = ccx + dx, cz = ccz + dz;
            const k = chunkKey(cx, cz);
            if (this.world.chunks.has(k) || this.loading.has(k)) continue;
            this.requestLoad(cx, cz, k);
            if (this.loadsInFlight >= this.opts.jobsInFlight + 2) break outer;
          }
    }
    // 2) meshing : urgents d'abord, puis par distance
    if (this.meshesInFlight < this.opts.jobsInFlight) {
      const candidates: Chunk[] = [];
      for (const c of this.world.chunks.values()) {
        if (!c.dirty || c.meshInFlight) continue;
        const d = Math.max(Math.abs(c.cx - ccx), Math.abs(c.cz - ccz));
        if (d > this.opts.renderDistance) continue;
        if (!this.neighborsLoaded(c.cx, c.cz)) continue;
        candidates.push(c);
      }
      candidates.sort((a, b) => {
        if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
        const da = (a.cx - ccx) ** 2 + (a.cz - ccz) ** 2, db = (b.cx - ccx) ** 2 + (b.cz - ccz) ** 2;
        return da - db;
      });
      for (const c of candidates) {
        if (this.meshesInFlight >= this.opts.jobsInFlight && !c.urgent) break;
        this.requestMesh(c);
      }
    }
    // 3) upload des meshes reçus (budget par frame ; les urgents passent toujours)
    let budget = this.opts.meshUploadsPerFrame;
    this.pendingMeshes.sort((a, b) => {
      const ua = this.world.getChunk(a.cx, a.cz)?.urgent ? 0 : 1, ub = this.world.getChunk(b.cx, b.cz)?.urgent ? 0 : 1;
      return ua - ub;
    });
    while (this.pendingMeshes.length && budget > 0) {
      this.applyMesh(this.pendingMeshes.shift()!);
      budget--;
    }
    // 1 bis) terrain autour des joueurs distants (simulation, pas d'affichage)
    const EXTRA_R = 3;
    for (const e of this.extraCenters) {
      if (this.loadsInFlight >= this.opts.jobsInFlight + 2) break;
      const ex = Math.floor(e.x / CHUNK_SIZE), ez = Math.floor(e.z / CHUNK_SIZE);
      for (let dz = -EXTRA_R; dz <= EXTRA_R && this.loadsInFlight < this.opts.jobsInFlight + 2; dz++)
        for (let dx = -EXTRA_R; dx <= EXTRA_R; dx++) {
          const k = chunkKey(ex + dx, ez + dz);
          if (this.world.chunks.has(k) || this.loading.has(k)) continue;
          this.requestLoad(ex + dx, ez + dz, k);
          if (this.loadsInFlight >= this.opts.jobsInFlight + 2) break;
        }
    }
    // 4) déchargement
    const nearExtra = (c: Chunk) => this.extraCenters.some((e) => Math.max(Math.abs(c.cx - Math.floor(e.x / CHUNK_SIZE)), Math.abs(c.cz - Math.floor(e.z / CHUNK_SIZE))) <= EXTRA_R + 1);
    for (const c of this.world.chunks.values()) {
      const d = Math.max(Math.abs(c.cx - ccx), Math.abs(c.cz - ccz));
      if (d > R + 1 && !nearExtra(c)) this.unload(c);
      else if (d > this.opts.renderDistance && (c.opaqueMesh || c.transMesh)) this.disposeMeshes(c, true);
    }
  }

  private neighborsLoaded(cx: number, cz: number) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.world.chunks.has(chunkKey(cx + dx, cz + dz))) return false;
    return true;
  }

  private async requestLoad(cx: number, cz: number, k: string) {
    this.loading.add(k);
    this.loadsInFlight++;
    let saved: SavedChunk | null = null;
    const pendingSave = this.unloadedToSave.get(k);
    if (pendingSave) saved = { cx, cz, blocks: pendingSave.blocks.slice(), meta: pendingSave.meta.slice() };
    else if (this.remote) {
      try {
        const r = await this.remote(cx, cz);
        if (r) saved = { cx, cz, blocks: r.blocks, meta: r.meta };
      } catch (e) {
        console.warn('Chunk de l’hôte indisponible', e);
      }
    } else if (this.saves && this.worldId) {
      try {
        saved = await this.saves.loadChunk(this.worldId, cx, cz);
      } catch (e) {
        console.warn('Lecture chunk impossible', e);
      }
    }
    if (this.disposed) return;
    if (saved) {
      this.stats.loadedFromSave++;
      this.post({ type: 'load', cx, cz, saved: { blocks: saved.blocks, meta: saved.meta } }, [saved.blocks.buffer, saved.meta.buffer]);
    } else this.post({ type: 'load', cx, cz });
  }

  private requestMesh(c: Chunk) {
    this.flushEdits();
    c.dirty = false;
    c.meshInFlight = true;
    c.meshJob = ++this.jobCounter;
    this.meshesInFlight++;
    this.post({ type: 'mesh', cx: c.cx, cz: c.cz, job: c.meshJob });
  }

  /** Envoie au worker les modifications de blocs accumulées. */
  flushEdits() {
    if (this.world.pendingEdits.length === 0) return;
    const edits = Int32Array.from(this.world.pendingEdits);
    this.world.pendingEdits.length = 0;
    this.post({ type: 'set', edits }, [edits.buffer]);
  }

  private onMessage(m: FromWorker) {
    if (this.disposed) return;
    switch (m.type) {
      case 'chunk': {
        const k = chunkKey(m.cx, m.cz);
        this.loading.delete(k);
        this.loadsInFlight--;
        if (this.world.chunks.has(k)) return;
        const c = new Chunk({ cx: m.cx, cz: m.cz, blocks: m.blocks, meta: m.meta, biomes: m.biomes, heights: m.heights }, k);
        c.modified = !m.generated;
        if (m.generated) this.stats.generated++;
        this.world.chunks.set(k, c);
        // les voisins doivent être remeshés (bords + lumière)
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const n = this.world.getChunk(m.cx + dx, m.cz + dz);
            if (n && n !== c && n.appliedJob >= 0) n.dirty = true;
          }
        c.specialKeys = m.specials.map((s) => `${s.x},${s.y},${s.z}`);
        this.onSpecials(m.specials);
        break;
      }
      case 'mesh': {
        this.meshesInFlight--;
        const c = this.world.getChunk(m.cx, m.cz);
        if (!c) return;
        c.meshInFlight = false;
        this.stats.meshMs = this.stats.meshMs * 0.9 + m.ms * 0.1;
        this.stats.meshCount++;
        this.pendingMeshes = this.pendingMeshes.filter((p) => !(p.cx === m.cx && p.cz === m.cz));
        this.pendingMeshes.push(m);
        break;
      }
      case 'meshSkipped': {
        this.meshesInFlight--;
        const c = this.world.getChunk(m.cx, m.cz);
        if (c) {
          c.meshInFlight = false;
          c.dirty = true;
        }
        break;
      }
      case 'located':
        this.locateCallbacks.get(m.req)?.({ x: m.x, z: m.z, found: m.found });
        this.locateCallbacks.delete(m.req);
        break;
      case 'error':
        this.onError(m.message);
        break;
    }
  }

  private buildGeometry(a: MeshArrays): THREE.BufferGeometry | null {
    if (a.vertexCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
    g.setAttribute('aUv', new THREE.BufferAttribute(a.uv, 2));
    g.setAttribute('aInfo', new THREE.BufferAttribute(a.info, 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(a.tint, 4, true));
    g.setIndex(new THREE.BufferAttribute(a.index, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  private applyMesh(m: PendingMesh) {
    const c = this.world.getChunk(m.cx, m.cz);
    if (!c || m.job < c.appliedJob) return;
    c.appliedJob = m.job;
    c.light = m.light;
    if (!c.dirty) c.urgent = false;
    this.disposeMeshes(c, false);
    const og = this.buildGeometry(m.opaque);
    if (og) {
      c.opaqueMesh = this.makeMesh(og, this.materials.opaque, c);
      this.group.add(c.opaqueMesh);
    }
    const tg = this.buildGeometry(m.trans);
    if (tg) {
      c.transMesh = this.makeMesh(tg, this.materials.trans, c);
      c.transMesh.renderOrder = 1;
      this.group.add(c.transMesh);
    }
  }

  private makeMesh(g: THREE.BufferGeometry, mat: THREE.Material, c: Chunk) {
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(c.worldX, 0, c.worldZ);
    mesh.scale.setScalar(1 / 16);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `chunk ${c.key}`;
    return mesh;
  }

  private disposeMeshes(c: Chunk, markDirty: boolean) {
    for (const mesh of [c.opaqueMesh, c.transMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    if (markDirty && (c.opaqueMesh || c.transMesh)) {
      c.dirty = true;
      c.appliedJob = -1;
    }
    c.opaqueMesh = null;
    c.transMesh = null;
  }

  /** Chunks modifiés non sauvegardés en attente d'écriture (déchargés). */
  private unloadedToSave = new Map<string, Chunk>();

  private unload(c: Chunk) {
    this.disposeMeshes(c, false);
    this.world.chunks.delete(c.key);
    for (const k of c.specialKeys) this.world.specials.delete(k);
    this.post({ type: 'unload', cx: c.cx, cz: c.cz });
    if (c.modified && c.unsaved) this.unloadedToSave.set(c.key, c);
  }

  /**
   * Multijoueur (hôte) : données actuelles d'un chunk s'il diffère de la génération (chargé et
   * modifié, en attente d'écriture, ou sauvegardé), sinon null.
   */
  async modifiedChunk(cx: number, cz: number): Promise<{ blocks: Uint16Array; meta: Uint8Array } | null> {
    const k = chunkKey(cx, cz);
    const c = this.world.chunks.get(k);
    if (c) return c.modified ? { blocks: c.blocks, meta: c.meta } : null;
    const pending = this.unloadedToSave.get(k);
    if (pending) return { blocks: pending.blocks, meta: pending.meta };
    if (this.saves && this.worldId) {
      try {
        const s = await this.saves.loadChunk(this.worldId, cx, cz);
        if (s) return { blocks: s.blocks, meta: s.meta };
      } catch {
        /* illisible : généré */
      }
    }
    return null;
  }

  /** Récupère les chunks à sauvegarder (déchargés + chargés modifiés). */
  collectUnsaved(): Chunk[] {
    const out = [...this.unloadedToSave.values()];
    for (const c of this.world.chunks.values()) if (c.modified && c.unsaved) out.push(c);
    return out;
  }

  /** À appeler après une sauvegarde réussie. */
  markSaved(list: Chunk[], versions: number[]) {
    list.forEach((c, i) => {
      if (c.version !== versions[i]) return;
      c.unsaved = false;
      if (this.unloadedToSave.get(c.key) === c) this.unloadedToSave.delete(c.key);
    });
  }

  locate(key: string, x: number, z: number): Promise<{ x: number; z: number; found: boolean }> {
    const req = ++this.jobCounter;
    return new Promise((res) => {
      this.locateCallbacks.set(req, res);
      this.post({ type: 'locate', key, x, z, req });
    });
  }

  /** Force le remesh de tous les chunks (changement de qualité). */
  remeshAll() {
    for (const c of this.world.chunks.values()) c.dirty = true;
  }

  dispose() {
    this.disposed = true;
    for (const c of this.world.chunks.values()) this.disposeMeshes(c, false);
    this.worker.terminate();
    this.pendingMeshes.length = 0;
  }

  get pendingCount() {
    return this.loading.size + this.pendingMeshes.length + this.meshesInFlight;
  }
}
