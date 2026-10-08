import { CHUNK_VOLUME, SAVE_VERSION, type Difficulty, type GameMode } from '../core/Config';
import { checksumBytes, checksumString, rleDecode, rleDecode16, rleEncode, rleEncode16 } from './WorldSerializer';

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  creationDate: number;
  lastPlayed: number;
  playTime: number; // secondes
  thumbnail: string | null; // dataURL JPEG
  gameMode: GameMode;
  difficulty: Difficulty;
  version: number;
  /** Commandes de triche autorisées (option « Activer les triches »). */
  cheats?: boolean;
  /** Monde du serveur de mini-jeux (jamais enregistré). */
  server?: boolean;
  /** Monde du serveur de survie moddé (masqué de la liste Solo). */
  smp?: boolean;
  /** Bots joueurs dans un monde ordinaire (option « Bots joueurs »). */
  bots?: boolean;
  /** Partie en réseau rejointe (monde de l'hôte, jamais enregistré localement). */
  remote?: boolean;
  /** Partie en réseau : point d'apparition et dimension de l'hôte. */
  netSpawn?: [number, number, number];
  netDim?: 'overworld' | 'nether' | 'end';
}

interface StateRecord {
  id: string;
  version: number;
  checksum: number;
  savedAt: number;
  data: string;
}
interface ChunkRecord {
  key: string;
  world: string;
  /** RLE des blocs : 8 bits (format 1) ou 16 bits (fmt = 16). */
  blocks: Uint8Array;
  fmt?: number;
  meta: Uint8Array;
  checksum: number;
}

export interface SavedChunk {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  meta: Uint8Array;
}

const DB_NAME = 'lecraft';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('Transaction annulée'));
  });
}

/**
 * Sauvegardes locales (IndexedDB du WebView Android, stockage privé de l'application).
 * - Écritures atomiques (une transaction pour état + méta + chunks)
 * - Checksum de chaque enregistrement ; l'état précédent valide est conservé en copie de secours
 * - Chargement : si l'état est corrompu, bascule automatique sur la copie de secours
 */
export class SaveManager {
  private db: IDBDatabase | null = null;
  lastLoadUsedBackup = false;

  constructor(private factory: IDBFactory = indexedDB) {}

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise<IDBDatabase>((res, rej) => {
      const r = this.factory.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('states')) db.createObjectStore('states', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) {
          const s = db.createObjectStore('chunks', { keyPath: 'key' });
          s.createIndex('world', 'world');
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* non supporté */
    }
  }

  private store(name: string, mode: IDBTransactionMode = 'readonly') {
    if (!this.db) throw new Error('Base non ouverte');
    return this.db.transaction(name, mode).objectStore(name);
  }

  async listWorlds(): Promise<WorldMeta[]> {
    return (await this.listAllWorlds()).filter((w) => !w.smp);
  }

  async listAllWorlds(): Promise<WorldMeta[]> {
    await this.open();
    const all = await req(this.store('worlds').getAll() as IDBRequest<WorldMeta[]>);
    return all.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async getWorld(id: string): Promise<WorldMeta | undefined> {
    await this.open();
    return req(this.store('worlds').get(id) as IDBRequest<WorldMeta | undefined>);
  }

  async createWorld(name: string, seed: number, gameMode: GameMode, difficulty: Difficulty): Promise<WorldMeta> {
    await this.open();
    const now = Date.now();
    const meta: WorldMeta = {
      id: `w${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      name,
      seed,
      creationDate: now,
      lastPlayed: now,
      playTime: 0,
      thumbnail: null,
      gameMode,
      difficulty,
      version: SAVE_VERSION,
    };
    await req(this.store('worlds', 'readwrite').put(meta));
    return meta;
  }

  async updateMeta(meta: WorldMeta) {
    await this.open();
    await req(this.store('worlds', 'readwrite').put(meta));
  }

  /** Sauvegarde atomique : état du monde + méta + chunks modifiés. */
  async save(meta: WorldMeta, state: unknown, chunks: SavedChunk[], chunkPrefix = meta.id): Promise<void> {
    await this.open();
    const data = JSON.stringify(state);
    const rec: StateRecord = { id: meta.id, version: SAVE_VERSION, checksum: checksumString(data), savedAt: Date.now(), data };
    const tx = this.db!.transaction(['worlds', 'states', 'chunks'], 'readwrite');
    const states = tx.objectStore('states');
    // conserve l'état précédent (s'il est valide) comme copie de secours
    const prevReq = states.get(meta.id);
    prevReq.onsuccess = () => {
      const prev = prevReq.result as StateRecord | undefined;
      if (prev && checksumString(prev.data) === prev.checksum) states.put({ ...prev, id: `${meta.id}#backup` });
      states.put(rec);
    };
    tx.objectStore('worlds').put(meta);
    const cs = tx.objectStore('chunks');
    for (const c of chunks) {
      const blocks = rleEncode16(c.blocks), m = rleEncode(c.meta);
      const record: ChunkRecord = { key: `${chunkPrefix}:${c.cx}:${c.cz}`, world: meta.id, blocks, fmt: 16, meta: m, checksum: (checksumBytes(blocks) ^ checksumBytes(m)) >>> 0 };
      cs.put(record);
    }
    await done(tx);
  }

  /** Charge l'état ; bascule sur la copie de secours si l'état principal est corrompu. */
  async load<T>(worldId: string): Promise<T | null> {
    await this.open();
    this.lastLoadUsedBackup = false;
    const tryRec = (r: StateRecord | undefined): T | null => {
      if (!r) return null;
      if (checksumString(r.data) !== r.checksum) return null;
      try {
        return JSON.parse(r.data) as T;
      } catch {
        return null;
      }
    };
    const main = await req(this.store('states').get(worldId) as IDBRequest<StateRecord | undefined>);
    const ok = tryRec(main);
    if (ok) return ok;
    const backup = await req(this.store('states').get(`${worldId}#backup`) as IDBRequest<StateRecord | undefined>);
    const b = tryRec(backup);
    if (b) {
      this.lastLoadUsedBackup = true;
      console.warn(`[SaveManager] état principal invalide pour ${worldId}, copie de secours utilisée`);
    }
    return b;
  }

  async loadChunk(worldId: string, cx: number, cz: number): Promise<SavedChunk | null> {
    await this.open();
    const r = await req(this.store('chunks').get(`${worldId}:${cx}:${cz}`) as IDBRequest<ChunkRecord | undefined>);
    if (!r) return null;
    if (((checksumBytes(r.blocks) ^ checksumBytes(r.meta)) >>> 0) !== r.checksum) {
      console.warn(`[SaveManager] chunk ${cx},${cz} corrompu : régénéré`);
      return null;
    }
    try {
      return { cx, cz, blocks: r.fmt === 16 ? rleDecode16(r.blocks, CHUNK_VOLUME) : Uint16Array.from(rleDecode(r.blocks, CHUNK_VOLUME)), meta: rleDecode(r.meta, CHUNK_VOLUME) };
    } catch (e) {
      console.warn('[SaveManager] décodage impossible', e);
      return null;
    }
  }

  async deleteSave(worldId: string): Promise<void> {
    await this.open();
    const tx = this.db!.transaction(['worlds', 'states', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(worldId);
    tx.objectStore('states').delete(worldId);
    tx.objectStore('states').delete(`${worldId}#backup`);
    const idx = tx.objectStore('chunks').index('world');
    const cur = idx.openKeyCursor(IDBKeyRange.only(worldId));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        tx.objectStore('chunks').delete(c.primaryKey);
        c.continue();
      }
    };
    await done(tx);
  }

  /** Copie complète d'un monde (état + chunks) sous un nouveau nom : sauvegarde de secours manuelle. */
  async backupSave(worldId: string): Promise<WorldMeta> {
    await this.open();
    const meta = await this.getWorld(worldId);
    if (!meta) throw new Error('Monde introuvable');
    const state = await req(this.store('states').get(worldId) as IDBRequest<StateRecord | undefined>);
    const chunks = await req(this.store('chunks').index('world').getAll(IDBKeyRange.only(worldId)) as IDBRequest<ChunkRecord[]>);
    const now = Date.now();
    const copy: WorldMeta = { ...meta, id: `w${now.toString(36)}b${Math.floor(Math.random() * 1e6).toString(36)}`, name: `${meta.name} (copie)`, lastPlayed: now - 1 };
    const tx = this.db!.transaction(['worlds', 'states', 'chunks'], 'readwrite');
    tx.objectStore('worlds').put(copy);
    if (state) tx.objectStore('states').put({ ...state, id: copy.id });
    for (const c of chunks) tx.objectStore('chunks').put({ ...c, key: c.key.replace(`${worldId}:`, `${copy.id}:`), world: copy.id });
    await done(tx);
    return copy;
  }

  /** Statistiques de stockage (pour l'écran Mondes). */
  async countChunks(worldId: string): Promise<number> {
    await this.open();
    return req(this.store('chunks').index('world').count(IDBKeyRange.only(worldId)));
  }
}
