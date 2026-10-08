/**
 * Import de packs de ressources au format Java (.zip ou .jar) fournis par l'utilisateur.
 * Les fichiers restent sur l'appareil (IndexedDB) : rien n'est distribué avec le jeu.
 *
 * Lecture ZIP minimale (répertoire central + inflate natif via DecompressionStream).
 */

import { MusicLibrary, moodFromPath } from '../audio/Music';

const DB = 'lecraft-packs';
const STORE = 'files';

export interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  offset: number;
}

export function readEntries(buf: ArrayBuffer): ZipEntry[] {
  const dv = new DataView(buf);
  // fin du répertoire central
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('Fichier ZIP invalide');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    out.push({ name, method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function extract(buf: ArrayBuffer, e: ZipEntry): Promise<Uint8Array> {
  const dv = new DataView(buf);
  const nameLen = dv.getUint16(e.offset + 26, true), extraLen = dv.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = new Uint8Array(buf, start, e.compSize);
  if (e.method === 0) return data.slice();
  if (e.method !== 8) throw new Error(`Compression non supportée (${e.method})`);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Dossiers de textures utiles du pack. */
const WANTED = /^assets\/minecraft\/textures\/(block|item|entity|environment|gui\/sprites\/hud|gui\/sprites\/container|gui\/container|gui\/sprites\/widget|gui\/widgets|gui\/icons)\/.+\.png$/;

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export interface PackInfo {
  name: string;
  files: number;
  /** Musiques importées depuis le pack. */
  music?: number;
}

/** Importe un pack : extrait les PNG utiles et les enregistre localement. */
export async function importPack(file: File, onProgress?: (f: number) => void): Promise<PackInfo> {
  const buf = await file.arrayBuffer();
  // le pack peut être rangé dans un dossier (« MonPack/assets/minecraft/… ») : préfixe retiré
  const all = readEntries(buf).map((e) => {
    const i = e.name.indexOf('assets/minecraft/textures/');
    return i > 0 ? { ...e, name: e.name.slice(i) } : e;
  });
  const entries = all.filter((e) => WANTED.test(e.name));
  // musiques du pack (assets/minecraft/sounds/music/… et records/…) : bibliothèque musicale de l'appareil
  const music = readEntries(buf).filter((e) => /assets\/minecraft\/sounds\/(music|records)\/.+\.(ogg|mp3|wav)$/i.test(e.name));
  let musicCount = 0;
  if (music.length) {
    const tracks: { name: string; mood: ReturnType<typeof moodFromPath>; blob: Blob }[] = [];
    for (const e of music) {
      const bytes = await extract(buf, e);
      const rel = e.name.slice(e.name.indexOf('sounds/') + 7);
      tracks.push({ name: rel, mood: rel.startsWith('records/') ? 'any' : moodFromPath(rel), blob: new Blob([bytes as BlobPart], { type: 'audio/ogg' }) });
    }
    musicCount = await MusicLibrary.add(tracks);
  }
  if (!entries.length && musicCount) return { name: file.name, files: 0, music: musicCount };
  if (!entries.length) throw new Error('Aucune texture trouvée (dossier assets/minecraft/textures attendu)');
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  let n = 0;
  const batch: [string, Blob][] = [];
  const flush = async () => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const [k, v] of batch) tx.objectStore(STORE).put(v, k);
    batch.length = 0;
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  };
  for (const e of entries) {
    const bytes = await extract(buf, e);
    batch.push([e.name.replace('assets/minecraft/textures/', ''), new Blob([bytes as BlobPart], { type: 'image/png' })]);
    if (batch.length >= 64) await flush();
    onProgress?.(++n / entries.length);
  }
  await flush();
  const info: PackInfo = { name: file.name, files: entries.length, music: musicCount };
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(new Blob([JSON.stringify(info)], { type: 'application/json' }), '__info');
  db.close();
  return info;
}

export async function removePack(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
  });
  db.close();
}

/** Images du pack installé (chemin relatif à textures/ → bitmap). */
export class LoadedPack {
  constructor(readonly info: PackInfo, readonly images: Map<string, ImageBitmap>) {}

  get(path: string): ImageBitmap | undefined {
    return this.images.get(path);
  }
  has(path: string) {
    return this.images.has(path);
  }
  first(...paths: string[]): ImageBitmap | undefined {
    for (const p of paths) {
      const i = this.images.get(p);
      if (i) return i;
    }
    return undefined;
  }
  /** Image redimensionnée en ImageData (une image d'une bande animée : `frame`). */
  imageData(img: ImageBitmap, size = 16, frame = 0): ImageData {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const fw = img.width, fh = img.width; // images carrées, bandes verticales pour les animations
    const frames = Math.max(1, Math.floor(img.height / fh));
    const f = frame % frames;
    ctx.drawImage(img, 0, f * fh, fw, fh, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
  }
}

export async function loadInstalledPack(): Promise<LoadedPack | null> {
  try {
    const db = await openDb();
    const all = await new Promise<{ keys: string[]; values: Blob[] }>((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const s = tx.objectStore(STORE);
      const kr = s.getAllKeys(), vr = s.getAll();
      tx.oncomplete = () => res({ keys: kr.result as string[], values: vr.result as Blob[] });
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    if (!all.keys.length) return null;
    const images = new Map<string, ImageBitmap>();
    let info: PackInfo = { name: 'Pack', files: 0 };
    await Promise.all(
      all.keys.map(async (k, i) => {
        if (k === '__info') {
          info = JSON.parse(await all.values[i].text());
          return;
        }
        try {
          images.set(k, await createImageBitmap(all.values[i]));
        } catch {
          /* image illisible : ignorée */
        }
      }),
    );
    return new LoadedPack(info, images);
  } catch (e) {
    console.warn('Pack de ressources illisible', e);
    return null;
  }
}

const BUNDLED_OFF = 'lecraft.bundledPackOff';

/**
 * Pack par défaut intégré à SA PROPRE copie de l'application (fichier `public/default-pack.zip`,
 * ajouté localement par `npm run pack:embed`, jamais versionné) : importé au premier lancement
 * si aucun pack n'est installé et que l'utilisateur ne l'a pas retiré.
 */
export async function loadBundledPack(): Promise<LoadedPack | null> {
  try {
    if (localStorage.getItem(BUNDLED_OFF)) return null;
    const r = await fetch('default-pack.zip');
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (b[0] !== 0x50 || b[1] !== 0x4b) return null; // pas un ZIP (fichier absent)
    await importPack(new File([buf], 'Pack par défaut'));
    return await loadInstalledPack();
  } catch {
    return null;
  }
}

/** L'utilisateur a retiré le pack : le pack intégré n'est plus réimporté. */
export function declineBundledPack() {
  try {
    localStorage.setItem(BUNDLED_OFF, '1');
  } catch {
    /* stockage indisponible */
  }
}
