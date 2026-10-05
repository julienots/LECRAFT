/**
 * Add-ons de l'édition Bedrock (.mcaddon, .mcpack, .zip) importés par l'utilisateur.
 *
 * Pris en charge (contenu « data-driven », la grande majorité des add-ons simples) :
 *  - packs de ressources : textures des blocs/objets/entités (remplacent celles du jeu), textures
 *    propres aux add-ons (terrain_texture.json, item_texture.json, blocks.json), géométries
 *    d'entités (*.geo.json), entités client, textes de langue (fr_FR / en_US) ;
 *  - packs de comportement : objets (nourriture, outils, armes, armures, combustible, poseurs de
 *    blocs), blocs (texture, dureté, lumière, rendu, butin), recettes (fabrication avec motif,
 *    sans forme, fourneau), entités (santé, vitesse, attaque, hostilité, reproduction, butin,
 *    taille, vol, brûlure au soleil), règles d'apparition, tables de butin, fonctions .mcfunction
 *    (dont tick.json).
 * Non pris en charge : scripts JavaScript (@minecraft/server), formulaires, animations Molang
 * complexes, géométries de blocs personnalisées (rendues en cube), dimensions personnalisées.
 */
import type { BlockDef } from '../blocks/Block';
import type { ItemDef } from '../inventory/Item';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { RecipeRegistry } from '../crafting/RecipeRegistry';
import type { CraftingRecipe, SmeltingRecipe } from '../crafting/Recipe';
import { MOB_BY_KEY, registerMob, type MobDef } from '../data/mobs';
import { BIOME_DEFS } from '../data/biomes';
import { VANILLA_MODELS } from '../render/MobModels';
import { SKIN_PATHS } from '../render/TextureManager';
import { extract, readEntries } from '../render/ResourcePack';
import { TileRegistry } from '../render/TileRegistry';
import { ADDON_BLOCKS, registerAddonBlocks } from './AddonRegistry';
import { parseLenientJson } from './Json';
import { BEDROCK_BLOCK_TEXTURES, BEDROCK_ENTITY_TEXTURES, BEDROCK_ITEM_TEXTURES, BIOME_TAGS } from './BedrockMaps';
import { geometryToModel, readGeometries, type BedrockGeo } from './BedrockGeometry';
import { resolveItem } from '../commands/Commands';

// ---------- stockage ----------

const DB = 'lecraft-addons';
const STORE = 'addons';

export interface PackSummary {
  uuid: string;
  name: string;
  description: string;
  type: 'resources' | 'data' | 'script' | 'skin_pack' | 'world_template' | 'unknown';
  version: string;
  hasScripts: boolean;
}

export interface InstalledAddon {
  id: string;
  fileName: string;
  name: string;
  packs: PackSummary[];
  enabled: boolean;
  installedAt: number;
  data: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      res(r ? (r.result as T) : undefined);
    };
    t.onerror = () => rej(t.error);
  });
}

export async function listAddons(): Promise<InstalledAddon[]> {
  try {
    const all = (await tx<InstalledAddon[]>('readonly', (s) => s.getAll() as IDBRequest<InstalledAddon[]>)) ?? [];
    return all.sort((a, b) => a.installedAt - b.installedAt);
  } catch {
    return [];
  }
}

export async function setAddonEnabled(id: string, enabled: boolean) {
  const all = await listAddons();
  const a = all.find((x) => x.id === id);
  if (!a) return;
  a.enabled = enabled;
  await tx('readwrite', (s) => void s.put(a));
}

export async function removeAddon(id: string) {
  await tx('readwrite', (s) => void s.delete(id));
}

// ---------- système de fichiers virtuel (ZIP, packs imbriqués) ----------

class VFS {
  readonly files = new Map<string, Uint8Array>();
  private lower = new Map<string, string>();
  add(path: string, data: Uint8Array) {
    const p = path.replace(/\\/g, '/').replace(/^\/+/, '');
    this.files.set(p, data);
    this.lower.set(p.toLowerCase(), p);
  }
  get(path: string): Uint8Array | undefined {
    const p = this.lower.get(path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase());
    return p ? this.files.get(p) : undefined;
  }
  text(path: string): string | undefined {
    const d = this.get(path);
    return d ? new TextDecoder().decode(d) : undefined;
  }
  json(path: string): unknown {
    const t = this.text(path);
    if (t === undefined) return undefined;
    try {
      return parseLenientJson(t);
    } catch {
      return undefined;
    }
  }
  /** Fichiers d'un dossier (récursif) se terminant par `ext`. */
  list(dir: string, ext: string): string[] {
    const d = dir.toLowerCase().replace(/\/?$/, '/');
    return [...this.files.keys()].filter((p) => p.toLowerCase().startsWith(d) && p.toLowerCase().endsWith(ext));
  }
}

async function unzipInto(vfs: VFS, buf: ArrayBuffer, prefix: string, depth = 0) {
  const entries = readEntries(buf);
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const data = await extract(buf, e);
    const lower = e.name.toLowerCase();
    if (depth < 2 && (lower.endsWith('.mcpack') || lower.endsWith('.mcaddon') || lower.endsWith('.zip'))) {
      await unzipInto(vfs, data.slice().buffer, `${prefix}${e.name.replace(/\.[^.]+$/, '')}/`, depth + 1);
    } else vfs.add(prefix + e.name, data);
  }
}

interface Pack {
  root: string;
  summary: PackSummary;
}

function findPacks(vfs: VFS): Pack[] {
  const packs: Pack[] = [];
  for (const p of vfs.files.keys()) {
    if (!/(^|\/)manifest\.json$/i.test(p)) continue;
    const m = vfs.json(p) as { header?: Record<string, unknown>; modules?: { type?: string }[] } | undefined;
    if (!m?.header) continue;
    const root = p.slice(0, p.length - 'manifest.json'.length);
    const types = (m.modules ?? []).map((x) => String(x.type ?? ''));
    const type = (types.find((t) => t === 'resources' || t === 'data' || t === 'skin_pack' || t === 'world_template') ?? (types.includes('script') ? 'script' : 'unknown')) as PackSummary['type'];
    const v = m.header.version;
    packs.push({
      root,
      summary: {
        uuid: String(m.header.uuid ?? p),
        name: cleanText(String(m.header.name ?? root ?? 'Pack')),
        description: cleanText(String(m.header.description ?? '')),
        type,
        version: Array.isArray(v) ? v.join('.') : String(v ?? ''),
        hasScripts: types.includes('script') || types.includes('javascript'),
      },
    });
  }
  return packs;
}

/** Retire les codes de mise en forme (§a, §l…). */
function cleanText(s: string) {
  return s.replace(/§./g, '').trim();
}

/** Importe un fichier .mcaddon / .mcpack / .zip ; retourne l'add-on enregistré. */
export async function importAddon(file: File): Promise<InstalledAddon> {
  const buf = await file.arrayBuffer();
  const vfs = new VFS();
  await unzipInto(vfs, buf, '');
  const packs = findPacks(vfs);
  if (!packs.length) throw new Error('Aucun manifest.json trouvé : ce fichier n’est pas un add-on Bedrock');
  const id = packs.map((p) => p.summary.uuid).sort().join('+');
  const addon: InstalledAddon = {
    id,
    fileName: file.name,
    name: packs.find((p) => p.summary.type === 'data')?.summary.name ?? packs[0].summary.name,
    packs: packs.map((p) => p.summary),
    enabled: true,
    installedAt: Date.now(),
    data: new Blob([buf]),
  };
  await tx('readwrite', (s) => void s.put(addon));
  return addon;
}

// ---------- chargement et enregistrement ----------

export interface AddonLoadResult {
  images: Map<string, ImageBitmap>;
  report: string[];
  counts: { blocks: number; items: number; recipes: number; mobs: number; functions: number; textures: number };
  functions: Map<string, string[]>;
  tickFunctions: string[];
}

const ID_KEY = 'lecraft.addonBlockIds';
const VANILLA_BLOCK_COUNT = BlockRegistry.blocks.length;

function prettify(id: string) {
  const n = id.split(':').pop() ?? id;
  return n.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function decodeImage(data: Uint8Array, path: string): Promise<ImageBitmap | null> {
  try {
    if (path.toLowerCase().endsWith('.tga')) {
      const img = decodeTga(data);
      return img ? await createImageBitmap(img) : null;
    }
    return await createImageBitmap(new Blob([data as BlobPart], { type: 'image/png' }));
  } catch {
    return null;
  }
}

/** Décodeur TGA minimal (24/32 bits, brut ou RLE), format courant des textures Bedrock. */
function decodeTga(d: Uint8Array): ImageData | null {
  const idLen = d[0], type = d[2], w = d[12] | (d[13] << 8), h = d[14] | (d[15] << 8), bpp = d[16], desc = d[17];
  if ((type !== 2 && type !== 10) || (bpp !== 24 && bpp !== 32) || !w || !h) return null;
  const px = bpp / 8;
  const out = new Uint8ClampedArray(w * h * 4);
  let p = 18 + idLen, i = 0;
  const put = (o: number) => {
    out[i * 4] = d[o + 2];
    out[i * 4 + 1] = d[o + 1];
    out[i * 4 + 2] = d[o];
    out[i * 4 + 3] = px === 4 ? d[o + 3] : 255;
    i++;
  };
  while (i < w * h && p < d.length) {
    if (type === 2) {
      put(p);
      p += px;
    } else {
      const hdr = d[p++];
      const n = (hdr & 0x7f) + 1;
      if (hdr & 0x80) {
        for (let k = 0; k < n; k++) put(p);
        p += px;
      } else for (let k = 0; k < n; k++, p += px) put(p);
    }
  }
  // origine en bas à gauche par défaut
  if (!(desc & 0x20)) {
    const row = w * 4, tmp = new Uint8ClampedArray(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row, b = (h - 1 - y) * row;
      tmp.set(out.subarray(a, a + row));
      out.copyWithin(a, b, b + row);
      out.set(tmp, b);
    }
  }
  return new ImageData(out, w, h);
}

/** Valeur d'un composant (nombre direct ou { value }). */
function val(c: unknown, d = 0): number {
  if (typeof c === 'number') return c;
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    if (typeof o.value === 'number') return o.value;
    if (typeof o.max === 'number') return o.max;
    if (typeof o.range_max === 'number') return ((o.range_min as number) + o.range_max) / 2;
    if (Array.isArray(o.value)) return (Number(o.value[0]) + Number(o.value[1])) / 2;
  }
  if (Array.isArray(c)) return (Number(c[0]) + Number(c[1])) / 2;
  return d;
}

const TAG_ALIASES: Record<string, string> = { planks: 'tag:planks', logs: 'tag:logs', wool: 'tag:wool', coals: 'tag:coals', stone_tool_materials: 'tag:stone_tool', stone_crafting_materials: 'tag:stone_tool' };

/** Ingrédient Bedrock → clé d'objet ou tag du jeu (null si inconnu). */
function ingredient(x: unknown): string | null {
  if (!x) return null;
  if (typeof x === 'string') return itemKey(x);
  const o = x as Record<string, unknown>;
  if (typeof o.tag === 'string') return TAG_ALIASES[o.tag.replace(/^minecraft:/, '')] ?? null;
  if (typeof o.item === 'string') {
    const k = o.item.replace(/^minecraft:/, '');
    // anciens identifiants avec valeur de données
    if (k === 'planks') return 'tag:planks';
    if (k === 'log' || k === 'log2') return 'tag:logs';
    if (k === 'wool') return 'tag:wool';
    if (k === 'coal') return o.data === 1 ? 'charcoal' : 'coal';
    return itemKey(o.item);
  }
  return null;
}

function itemKey(id: string): string | null {
  if (!id.startsWith('minecraft:') && id.includes(':')) return ItemRegistry.has(id) ? id : null;
  try {
    return resolveItem(id);
  } catch {
    const k = id.replace(/^minecraft:/, '');
    return BEDROCK_ITEM_TEXTURES[k] && ItemRegistry.has(BEDROCK_ITEM_TEXTURES[k]) ? BEDROCK_ITEM_TEXTURES[k] : null;
  }
}

function readIds(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ID_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Enregistre les blocs d'add-ons par identifiant ; les trous (add-ons retirés) deviennent « bloc inconnu ». */
function reserveBlockIds(byId: Map<number, BlockDef>) {
  const ids = readIds();
  const maxId = Math.max(VANILLA_BLOCK_COUNT - 1, ...Object.values(ids), ...byId.keys());
  ADDON_BLOCKS.length = 0;
  for (let id = VANILLA_BLOCK_COUNT; id <= maxId; id++) ADDON_BLOCKS.push(byId.get(id) ?? { key: `unknown_block_${id}`, name: 'Bloc inconnu', textures: { all: 'missing' }, hardness: 1, drops: [], color: '#ff00ff' });
  registerAddonBlocks(ADDON_BLOCKS);
}

/** Charge et enregistre tous les add-ons activés. À appeler avant la création de tout monde. */
export async function loadEnabledAddons(): Promise<AddonLoadResult> {
  const result: AddonLoadResult = { images: new Map(), report: [], counts: { blocks: 0, items: 0, recipes: 0, mobs: 0, functions: 0, textures: 0 }, functions: new Map(), tickFunctions: [] };
  const addons = (await listAddons()).filter((a) => a.enabled);
  if (!addons.length) {
    // aucun add-on actif : les identifiants déjà attribués restent réservés (« bloc inconnu »)
    reserveBlockIds(new Map());
    return result;
  }

  // 1) lecture de tous les packs
  const rps: { vfs: VFS; root: string; name: string }[] = [];
  const bps: { vfs: VFS; root: string; name: string }[] = [];
  for (const a of addons) {
    try {
      const vfs = new VFS();
      await unzipInto(vfs, await a.data.arrayBuffer(), '');
      for (const p of findPacks(vfs)) {
        if (p.summary.type === 'resources') rps.push({ vfs, root: p.root, name: p.summary.name });
        else if (p.summary.type === 'data') bps.push({ vfs, root: p.root, name: p.summary.name });
        if (p.summary.hasScripts) result.report.push(`« ${p.summary.name} » : les scripts JavaScript ne sont pas pris en charge (le reste du contenu est chargé).`);
      }
    } catch (e) {
      result.report.push(`Add-on « ${a.name} » illisible : ${(e as Error).message}`);
    }
  }

  // 2) packs de ressources
  const lang = new Map<string, string>();
  const terrain = new Map<string, string>(); // nom court → chemin de texture
  const itemTex = new Map<string, string>();
  const blockJson = new Map<string, unknown>(); // blocks.json
  const clientEntities = new Map<string, { texture?: string; geometry?: string }>();
  const geos = new Map<string, BedrockGeo>();
  const rpItemIcons = new Map<string, string>(); // anciens objets : icône définie côté ressources
  const imageSources = new Map<string, { vfs: VFS; path: string }>(); // chemin sans extension → fichier
  const shortTex = (x: unknown): string | undefined => {
    if (typeof x === 'string') return x;
    if (Array.isArray(x)) return shortTex(x[0]);
    if (x && typeof x === 'object') return shortTex((x as Record<string, unknown>).path);
    return undefined;
  };
  for (const rp of rps) {
    const { vfs, root } = rp;
    for (const f of ['texts/fr_FR.lang', 'texts/en_US.lang']) {
      const t = vfs.text(root + f);
      if (!t) continue;
      for (const line of t.split(/\r?\n/)) {
        const m = /^([^=#]+)=(.*?)(\t#.*)?$/.exec(line);
        if (m && !lang.has(m[1].trim())) lang.set(m[1].trim(), cleanText(m[2]));
      }
    }
    const tt = vfs.json(root + 'textures/terrain_texture.json') as { texture_data?: Record<string, { textures?: unknown }> } | undefined;
    for (const [k, v] of Object.entries(tt?.texture_data ?? {})) {
      const p = shortTex(v.textures);
      if (p) terrain.set(k, p);
    }
    const it = vfs.json(root + 'textures/item_texture.json') as { texture_data?: Record<string, { textures?: unknown }> } | undefined;
    for (const [k, v] of Object.entries(it?.texture_data ?? {})) {
      const p = shortTex(v.textures);
      if (p) itemTex.set(k, p);
    }
    const bj = vfs.json(root + 'blocks.json') as Record<string, unknown> | undefined;
    for (const [k, v] of Object.entries(bj ?? {})) if (k !== 'format_version') blockJson.set(k.includes(':') ? k : `minecraft:${k}`, v);
    for (const f of [...vfs.list(root + 'entity', '.json'), ...vfs.list(root + 'entities', '.json')]) {
      const j = vfs.json(f) as Record<string, { description?: Record<string, unknown> }> | undefined;
      const d = j?.['minecraft:client_entity']?.description;
      if (!d?.identifier) continue;
      const tex = d.textures as Record<string, string> | undefined;
      const geo = d.geometry as Record<string, string> | undefined;
      clientEntities.set(String(d.identifier), { texture: tex?.default ?? Object.values(tex ?? {})[0], geometry: geo?.default ?? Object.values(geo ?? {})[0] });
    }
    for (const f of vfs.list(root + 'models', '.json')) for (const g of readGeometries(vfs.json(f) ?? {})) if (g.id) geos.set(g.id, g);
    for (const f of vfs.list(root + 'items', '.json')) {
      const j = vfs.json(f) as Record<string, { description?: { identifier?: string }; components?: Record<string, unknown> }> | undefined;
      const item = j?.['minecraft:item'];
      const icon = item?.components?.['minecraft:icon'];
      if (item?.description?.identifier && icon) rpItemIcons.set(item.description.identifier, typeof icon === 'string' ? icon : String((icon as Record<string, unknown>).texture ?? ''));
    }
    // index des images (sans extension), et remplacement des textures du jeu
    for (const p of vfs.files.keys()) {
      if (!p.startsWith(root) || !/\.(png|tga)$/i.test(p)) continue;
      const rel = p.slice(root.length).replace(/\.(png|tga)$/i, '');
      if (!imageSources.has(rel)) imageSources.set(rel, { vfs, path: p });
    }
  }
  // textures du jeu remplacées (convention Java pour TextureManager)
  const vanillaImg = async (rel: string, javaPath: string) => {
    if (result.images.has(javaPath)) return;
    const src = imageSources.get(rel);
    if (!src) return;
    const img = await decodeImage(src.vfs.get(src.path)!, src.path);
    if (img) {
      result.images.set(javaPath, img);
      result.counts.textures++;
    }
  };
  for (const rel of imageSources.keys()) {
    const m = /^textures\/(blocks|items|entity)\/(.+)$/.exec(rel);
    if (!m) continue;
    const name = m[2];
    if (m[1] === 'blocks') {
      const j = BEDROCK_BLOCK_TEXTURES[name] ?? (TileRegistry.has(name) ? name : null);
      if (j) await vanillaImg(rel, `block/${j === 'water' ? 'water_still' : j === 'lava' ? 'lava_still' : j}.png`);
    } else if (m[1] === 'items') {
      const j = BEDROCK_ITEM_TEXTURES[name] ?? (ItemRegistry.has(name) ? name : null);
      if (j) await vanillaImg(rel, `item/${j}.png`);
    } else {
      const j = BEDROCK_ENTITY_TEXTURES[name];
      if (j) await vanillaImg(rel, `${j}.png`);
    }
  }
  /** Image propre à l'add-on : enregistrée sous « addon/<chemin> ». */
  const addonImage = async (path: string | undefined): Promise<string | null> => {
    if (!path) return null;
    const rel = path.replace(/\.(png|tga)$/i, '');
    const key = `addon/${rel}`;
    if (result.images.has(key)) return key;
    const src = imageSources.get(rel);
    if (!src) return null;
    const img = await decodeImage(src.vfs.get(src.path)!, src.path);
    if (!img) return null;
    result.images.set(key, img);
    return key;
  };

  // 3) packs de comportement : lecture des définitions
  const blockDefs: { id: string; def: BlockDef; c: Record<string, unknown> }[] = [];
  const itemDefs: ItemDef[] = [];
  const recipes: unknown[] = [];
  const entities: { id: string; c: Record<string, unknown>; desc: Record<string, unknown> }[] = [];
  const loot = new Map<string, unknown>();
  const spawnRules = new Map<string, unknown>();
  for (const bp of bps) {
    const { vfs, root } = bp;
    for (const f of vfs.list(root + 'loot_tables', '.json')) loot.set(f.slice(root.length).toLowerCase(), vfs.json(f));
    for (const f of vfs.list(root + 'spawn_rules', '.json')) {
      const j = vfs.json(f) as Record<string, { description?: { identifier?: string } }> | undefined;
      const r = j?.['minecraft:spawn_rules'];
      if (r?.description?.identifier) spawnRules.set(r.description.identifier, r);
    }
    for (const f of vfs.list(root + 'functions', '.mcfunction')) {
      const name = f.slice((root + 'functions/').length).replace(/\.mcfunction$/i, '');
      result.functions.set(name.toLowerCase(), (vfs.text(f) ?? '').split(/\r?\n/));
      result.counts.functions++;
    }
    const tick = vfs.json(root + 'functions/tick.json') as { values?: string[] } | undefined;
    for (const v of tick?.values ?? []) result.tickFunctions.push(v.toLowerCase());
    for (const f of vfs.list(root + 'blocks', '.json')) {
      const j = vfs.json(f) as Record<string, { description?: Record<string, unknown>; components?: Record<string, unknown> }> | undefined;
      const b = j?.['minecraft:block'];
      const id = b?.description?.identifier as string | undefined;
      if (!id) continue;
      blockDefs.push({ id, def: undefined as unknown as BlockDef, c: b!.components ?? {} });
    }
    for (const f of vfs.list(root + 'items', '.json')) {
      const j = vfs.json(f) as Record<string, { description?: Record<string, unknown>; components?: Record<string, unknown> }> | undefined;
      const it = j?.['minecraft:item'];
      const id = it?.description?.identifier as string | undefined;
      if (!id) continue;
      itemDefs.push({ key: id, name: '', icon: { sprite: 'lump', colors: ['#f0f'] }, _c: it!.components ?? {}, _d: it!.description } as unknown as ItemDef);
    }
    for (const f of vfs.list(root + 'recipes', '.json')) {
      const j = vfs.json(f);
      if (j) recipes.push(j);
    }
    for (const f of vfs.list(root + 'entities', '.json')) {
      const j = vfs.json(f) as Record<string, { description?: Record<string, unknown>; components?: Record<string, unknown>; component_groups?: Record<string, Record<string, unknown>>; events?: Record<string, unknown> }> | undefined;
      const e = j?.['minecraft:entity'];
      const id = e?.description?.identifier as string | undefined;
      if (!id || id.startsWith('minecraft:')) continue;
      // composants de base + groupes ajoutés à l'apparition (adulte, variantes…)
      const c = { ...(e!.components ?? {}) };
      const spawned = e!.events?.['minecraft:entity_spawned'] as Record<string, unknown> | undefined;
      const groups: string[] = [];
      const collect = (ev: unknown) => {
        if (!ev || typeof ev !== 'object') return;
        const o = ev as Record<string, unknown>;
        const add = (o.add as { component_groups?: string[] } | undefined)?.component_groups;
        if (add) groups.push(...add);
        if (Array.isArray(o.randomize)) collect(o.randomize[0]);
        if (Array.isArray(o.sequence)) for (const s of o.sequence) collect(s);
      };
      collect(spawned);
      for (const g of groups) Object.assign(c, e!.component_groups?.[g] ?? {});
      entities.push({ id, c, desc: e!.description ?? {} });
    }
  }

  const lootDrops = (path: unknown): { item: string; min: number; max: number; chance?: number }[] => {
    if (typeof path !== 'string') return [];
    const t = loot.get(path.toLowerCase()) as { pools?: { rolls?: unknown; entries?: { type?: string; name?: string; weight?: number; functions?: { function?: string; count?: unknown }[] }[] }[] } | undefined;
    const out: { item: string; min: number; max: number; chance?: number }[] = [];
    for (const pool of t?.pools ?? []) {
      const entries = (pool.entries ?? []).filter((e) => (e.type ?? 'item') === 'item' && e.name);
      const total = entries.reduce((a, e) => a + (e.weight ?? 1), 0) || 1;
      for (const e of entries) {
        const key = itemKey(e.name!) ?? (BlockRegistry.has(e.name!) ? e.name! : null);
        if (!key) continue;
        const cnt = e.functions?.find((f) => (f.function ?? '').endsWith('set_count'))?.count;
        const min = typeof cnt === 'number' ? cnt : Number((cnt as { min?: number })?.min ?? 1);
        const max = typeof cnt === 'number' ? cnt : Number((cnt as { max?: number })?.max ?? min);
        const chance = entries.length > 1 ? (e.weight ?? 1) / total : undefined;
        out.push({ item: key, min, max, ...(chance !== undefined ? { chance } : {}) });
      }
    }
    return out;
  };

  // 4) blocs : identifiants numériques stables entre les sessions
  const ids = readIds();
  let next = Math.max(VANILLA_BLOCK_COUNT, ...Object.values(ids).map((v) => v + 1));
  const byId = new Map<number, BlockDef>();
  const lateLoot: [string, unknown][] = [];
  for (const b of blockDefs) {
    if (ids[b.id] === undefined) {
      if (next > 255) {
        result.report.push(`Bloc « ${b.id} » ignoré : limite de 256 blocs atteinte.`);
        continue;
      }
      ids[b.id] = next++;
    }
    const c = b.c;
    const mi = (c['minecraft:material_instances'] ?? {}) as Record<string, { texture?: string; render_method?: string }>;
    const bj = blockJson.get(b.id) as { textures?: unknown } | undefined;
    const texOf = (face: string): string | undefined => {
      const m = mi[face] ?? (['north', 'south', 'east', 'west'].includes(face) ? mi.side : undefined) ?? mi['*'];
      if (m?.texture) return m.texture;
      const t = bj?.textures;
      if (typeof t === 'string') return t;
      if (t && typeof t === 'object') {
        const o = t as Record<string, string>;
        return o[face] ?? (face === 'north' || face === 'south' || face === 'east' || face === 'west' ? o.side : undefined) ?? o.side ?? o.up;
      }
      return undefined;
    };
    const tile = async (short: string | undefined) => {
      const path = short ? terrain.get(short) ?? short : undefined;
      const key = await addonImage(path);
      if (!key) return 'missing';
      const name = key; // « addon/textures/blocks/… »
      result.images.set(`block/${name}.png`, result.images.get(key)!);
      return name;
    };
    const top = await tile(texOf('up')), bottom = await tile(texOf('down')), side = await tile(texOf('north'));
    const method = (mi['*'] ?? Object.values(mi)[0])?.render_method ?? 'opaque';
    const destr = c['minecraft:destructible_by_mining'] ?? c['minecraft:destroy_time'];
    let hardness = 1;
    if (destr === false) hardness = -1;
    else if (typeof destr === 'number') hardness = destr;
    else if (destr && typeof destr === 'object') hardness = Number((destr as { seconds_to_destroy?: number; value?: number }).seconds_to_destroy ?? (destr as { value?: number }).value ?? 1.5) / 1.5;
    const lightRaw = c['minecraft:light_emission'] ?? c['minecraft:block_light_emission'];
    const light = typeof lightRaw === 'number' ? (lightRaw <= 1 && c['minecraft:block_light_emission'] !== undefined ? Math.round(lightRaw * 15) : lightRaw) : val(lightRaw, 0);
    const collision = c['minecraft:collision_box'];
    const name = lang.get(`tile.${b.id}.name`) ?? (typeof c['minecraft:display_name'] === 'object' ? lang.get(String((c['minecraft:display_name'] as { value?: string }).value)) : undefined) ?? prettify(b.id);
    if (c['minecraft:geometry'] && !String(typeof c['minecraft:geometry'] === 'string' ? c['minecraft:geometry'] : (c['minecraft:geometry'] as { identifier?: string }).identifier).includes('full_block'))
      result.report.push(`Bloc « ${b.id} » : géométrie personnalisée affichée en cube.`);
    // le butin est résolu après l'enregistrement des objets (il peut en référencer)
    const drops = c['minecraft:loot'] !== undefined ? [] : [{ item: b.id }];
    if (c['minecraft:loot'] !== undefined) lateLoot.push([b.id, c['minecraft:loot']]);
    const def: BlockDef = {
      key: b.id,
      name,
      textures: { top, bottom, side },
      hardness: Math.max(-1, Math.min(50, hardness)),
      render: method === 'blend' ? 'translucent' : method === 'alpha_test' || method === 'double_sided' ? 'cutout' : 'cube',
      solid: collision === false ? false : undefined,
      light: Math.max(0, Math.min(15, Math.round(light))),
      friction: typeof c['minecraft:friction'] === 'number' ? Math.max(0, 0.6 - (c['minecraft:friction'] as number)) : undefined,
      sound: 'stone',
      drops,
      color: '#9a7ad0',
    };
    byId.set(ids[b.id], def);
  }
  localStorage.setItem(ID_KEY, JSON.stringify(ids));
  reserveBlockIds(byId);
  for (const d of byId.values()) {
    if (!ItemRegistry.has(d.key)) ItemRegistry.register({ key: d.key, name: d.name, icon: { block: d.key }, place: d.key, tab: 'building' });
    result.counts.blocks++;
  }

  // 5) objets
  const SAT: Record<string, number> = { poor: 0.1, low: 0.3, normal: 0.6, good: 0.8, max: 1, supernatural: 1.2 };
  for (const raw of itemDefs) {
    const r = raw as unknown as { key: string; _c: Record<string, unknown>; _d: Record<string, unknown> };
    const c = r._c;
    if (ItemRegistry.has(r.key)) continue;
    const iconC = c['minecraft:icon'];
    const iconShort = typeof iconC === 'string' ? iconC : (iconC as { texture?: string; textures?: { default?: string } } | undefined)?.texture ?? (iconC as { textures?: { default?: string } } | undefined)?.textures?.default ?? rpItemIcons.get(r.key);
    const iconKey = await addonImage(iconShort ? itemTex.get(iconShort) ?? iconShort : undefined);
    const dn = c['minecraft:display_name'] as { value?: string } | undefined;
    const name = lang.get(`item.${r.key}.name`) ?? lang.get(`item.${r.key}`) ?? (dn?.value ? lang.get(dn.value) ?? cleanText(dn.value) : undefined) ?? prettify(r.key);
    const def: ItemDef = { key: r.key, name, icon: iconKey ? { image: iconKey } : { sprite: 'lump', colors: ['#c070ff', '#ffffff'] } };
    const ms = c['minecraft:max_stack_size'];
    if (ms !== undefined) def.maxStack = Math.max(1, Math.min(64, val(ms, 64)));
    const food = c['minecraft:food'] as { nutrition?: number; saturation_modifier?: number | string; can_always_eat?: boolean } | undefined;
    if (food) {
      const n = food.nutrition ?? 1;
      const mod = typeof food.saturation_modifier === 'number' ? food.saturation_modifier : SAT[String(food.saturation_modifier ?? 'normal')] ?? 0.6;
      def.food = { hunger: n, saturation: n * mod * 2 };
    }
    const dmg = c['minecraft:damage'];
    if (dmg !== undefined) def.damage = val(dmg, 1);
    const dur = c['minecraft:durability'] as { max_durability?: number } | undefined;
    const tags = ((c['minecraft:tags'] as { tags?: string[] } | undefined)?.tags ?? []).join(' ');
    const digger = c['minecraft:digger'] as { destroy_speeds?: { block?: unknown; speed?: number }[] } | undefined;
    let toolType: 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | null = /is_pickaxe/.test(tags) ? 'pickaxe' : /is_axe/.test(tags) ? 'axe' : /is_shovel/.test(tags) ? 'shovel' : /is_hoe/.test(tags) ? 'hoe' : /is_sword/.test(tags) ? 'sword' : null;
    let speed = 1;
    if (digger?.destroy_speeds?.length) {
      const all = JSON.stringify(digger.destroy_speeds);
      speed = Math.max(...digger.destroy_speeds.map((d) => d.speed ?? 1));
      if (!toolType) toolType = /stone|metal|ore|rock/.test(all) ? 'pickaxe' : /wood|log/.test(all) ? 'axe' : /dirt|sand|gravel|grass/.test(all) ? 'shovel' : 'pickaxe';
    }
    if (!toolType && (dur || c['minecraft:hand_equipped']) && def.damage) toolType = 'sword';
    if (toolType) {
      const tier = speed >= 8 ? 4 : speed >= 6 ? 3 : speed >= 4 ? 2 : 1;
      def.tool = { type: toolType, tier: toolType === 'sword' ? 0 : tier, speed: Math.max(1, speed), durability: dur?.max_durability ?? 250, material: 'addon' };
      def.maxStack = 1;
      if (toolType === 'hoe') def.use = 'till';
    }
    const wear = c['minecraft:wearable'] as { slot?: string; protection?: number } | undefined;
    const slots: Record<string, 'head' | 'chest' | 'legs' | 'feet'> = { 'slot.armor.head': 'head', 'slot.armor.chest': 'chest', 'slot.armor.legs': 'legs', 'slot.armor.feet': 'feet' };
    if (wear?.slot && slots[wear.slot]) {
      def.armor = { slot: slots[wear.slot], defense: wear.protection ?? 1, durability: dur?.max_durability ?? 200, material: 'addon' };
      def.maxStack = 1;
    }
    const fuel = c['minecraft:fuel'] as { duration?: number } | undefined;
    if (fuel?.duration) def.burnTime = fuel.duration;
    const placer = c['minecraft:block_placer'] as { block?: string } | undefined;
    if (placer?.block) {
      const bk = placer.block.startsWith('minecraft:') ? placer.block.slice(10) : placer.block;
      if (BlockRegistry.has(bk)) def.place = bk;
    }
    const cat = String((r._d?.menu_category as { category?: string } | undefined)?.category ?? (r._d?.category as string | undefined) ?? '');
    def.tab = cat === 'construction' ? 'building' : cat === 'nature' ? 'nature' : cat === 'equipment' ? (def.armor || def.tool?.type === 'sword' ? 'combat' : 'tools') : def.food ? 'food' : def.tool ? 'tools' : 'ingredients';
    ItemRegistry.register(def);
    result.counts.items++;
  }

  for (const [key, path] of lateLoot) (BlockRegistry.byName(key) as { drops: unknown }).drops = lootDrops(path);

  // 6) recettes
  let skipped = 0;
  for (const j of recipes) {
    const o = j as Record<string, Record<string, unknown>>;
    try {
      if (o['minecraft:recipe_shaped']) {
        const r = o['minecraft:recipe_shaped'];
        const tagsR = (r.tags as string[] | undefined) ?? ['crafting_table'];
        if (!tagsR.includes('crafting_table')) continue;
        const pattern = (r.pattern as string[]).map((row) => row);
        const key: Record<string, string> = {};
        for (const [ch, v] of Object.entries(r.key as Record<string, unknown>)) {
          const k = ingredient(v);
          if (!k) throw new Error('ingrédient inconnu');
          key[ch] = k;
        }
        const res = Array.isArray(r.result) ? r.result[0] : r.result;
        const item = itemKey(typeof res === 'string' ? res : (res as { item: string }).item);
        if (!item) throw new Error('résultat inconnu');
        const width = Math.max(...pattern.map((p) => p.length));
        const rec: CraftingRecipe = { id: String((r.description as { identifier?: string })?.identifier ?? `addon:${item}`), type: 'shaped', result: { item, count: Number((res as { count?: number }).count ?? 1) }, pattern: pattern.map((p) => p.padEnd(width, ' ')), key, width, height: pattern.length };
        RecipeRegistry.register(rec);
        result.counts.recipes++;
      } else if (o['minecraft:recipe_shapeless']) {
        const r = o['minecraft:recipe_shapeless'];
        const tagsR = (r.tags as string[] | undefined) ?? ['crafting_table'];
        if (!tagsR.includes('crafting_table')) continue;
        const ings: string[] = [];
        for (const v of r.ingredients as unknown[]) {
          const k = ingredient(v);
          if (!k) throw new Error('ingrédient inconnu');
          const n = Number((v as { count?: number }).count ?? 1);
          for (let i = 0; i < n; i++) ings.push(k);
        }
        const res = Array.isArray(r.result) ? r.result[0] : r.result;
        const item = itemKey(typeof res === 'string' ? res : (res as { item: string }).item);
        if (!item) throw new Error('résultat inconnu');
        const w = ings.length <= 4 ? 2 : 3;
        RecipeRegistry.register({ id: String((r.description as { identifier?: string })?.identifier ?? `addon:${item}`), type: 'shapeless', result: { item, count: Number((res as { count?: number }).count ?? 1) }, ingredients: ings, width: w, height: Math.ceil(ings.length / w) });
        result.counts.recipes++;
      } else if (o['minecraft:recipe_furnace']) {
        const r = o['minecraft:recipe_furnace'];
        const input = ingredient(r.input);
        const out = ingredient(r.output);
        if (!input || !out || input.startsWith('tag:')) throw new Error('ingrédient inconnu');
        const rec: SmeltingRecipe = { id: String((r.description as { identifier?: string })?.identifier ?? `addon:smelt:${input}`), input, result: out, xp: 0.2, time: 10 };
        if (!RecipeRegistry.smeltingFor(input)) {
          RecipeRegistry.registerSmelting(rec);
          result.counts.recipes++;
        }
      }
    } catch {
      skipped++;
    }
  }
  if (skipped) result.report.push(`${skipped} recette(s) ignorée(s) (ingrédients inconnus du jeu).`);

  // 7) entités
  for (const e of entities) {
    if (MOB_BY_KEY.has(e.id)) continue;
    const c = e.c;
    const fam = ((c['minecraft:type_family'] as { family?: string[] } | undefined)?.family ?? []).join(' ');
    const hostile = /monster/.test(fam) || !!c['minecraft:behavior.nearest_attackable_target'] && JSON.stringify(c['minecraft:behavior.nearest_attackable_target']).includes('player');
    const attack = c['minecraft:attack'] as { damage?: unknown } | undefined;
    const box = c['minecraft:collision_box'] as { width?: number; height?: number } | undefined;
    const breed = c['minecraft:breedable'] as { breed_items?: string | string[] } | undefined;
    const ranged = !!c['minecraft:behavior.ranged_attack'];
    const items = breed?.breed_items ? (Array.isArray(breed.breed_items) ? breed.breed_items : [breed.breed_items]) : [];
    const lootTable = (c['minecraft:loot'] as { table?: string } | undefined)?.table;
    const traits: NonNullable<MobDef['traits']> = [];
    if (c['minecraft:burns_in_daylight']) traits.push('burnsInSun');
    if (c['minecraft:can_fly'] || c['minecraft:navigation.fly'] || c['minecraft:flying_speed']) traits.push('flies');
    if (c['minecraft:navigation.climb']) traits.push('climbs');
    const def: MobDef = {
      key: e.id,
      name: lang.get(`entity.${e.id}.name`) ?? prettify(e.id),
      category: hostile ? 'hostile' : 'passive',
      health: Math.max(1, val(c['minecraft:health'], 10)),
      damage: attack ? val(attack.damage, 2) : 0,
      speed: Math.max(0.5, val(c['minecraft:movement'], 0.25) * 10),
      detectionRange: hostile ? 16 : 8,
      attackRange: hostile ? 1.6 : 0,
      attackCooldown: 1,
      width: box?.width ?? 0.6,
      height: box?.height ?? 1.8,
      drops: lootDrops(lootTable),
      xp: hostile ? 5 : 2,
      food: items.map((i) => itemKey(i)).filter((x): x is string => !!x),
      ranged: ranged ? { projectile: 'arrow', range: 15, damage: Math.max(2, val(attack?.damage, 3)), speed: 1.5 } : undefined,
      traits,
      sounds: hostile ? { idle: 'groan', hurt: 'groan_hurt', death: 'groan_death' } : { idle: 'oink', hurt: 'oink_hurt', death: 'oink_hurt' },
      scale: val(c['minecraft:scale'], 1),
    };
    // apparition naturelle (règles d'apparition)
    const sr = spawnRules.get(e.id) as { conditions?: Record<string, unknown>[] } | undefined;
    const cond = sr?.conditions?.[0];
    let biomes: string[] = [];
    if (cond) {
      const br = cond['minecraft:brightness_filter'] as { min?: number; max?: number } | undefined;
      const herd = cond['minecraft:herd'] as { min_size?: number; max_size?: number } | undefined;
      def.spawn = {
        where: cond['minecraft:spawns_underground'] ? 'cave' : 'surface',
        light: br ? ((br.max ?? 15) <= 7 ? 'dark' : (br.min ?? 0) >= 7 ? 'day' : 'any') : hostile ? 'dark' : 'day',
        group: [herd?.min_size ?? 1, herd?.max_size ?? (hostile ? 2 : 3)],
        weight: val(cond['minecraft:weight'] && (cond['minecraft:weight'] as { default?: number }).default, 10),
      };
      const tagsFound = JSON.stringify(cond['minecraft:biome_filter'] ?? {}).match(/"value"\s*:\s*"([^"]+)"/g)?.map((x) => x.replace(/.*"([^"]+)"$/, '$1')) ?? ['overworld'];
      biomes = [...new Set(tagsFound.flatMap((t) => BIOME_TAGS[t] ?? []))];
      if (!biomes.length) biomes = BIOME_TAGS.overworld;
    }
    // modèle et texture (entité client du pack de ressources)
    const ce = clientEntities.get(e.id);
    const geo = ce?.geometry ? geos.get(ce.geometry) ?? geos.get(ce.geometry.split(':')[0]) : undefined;
    const tex = await addonImage(ce?.texture);
    if (geo && tex) {
      VANILLA_MODELS[e.id] = geometryToModel(geo, e.id);
      SKIN_PATHS[e.id] = [tex];
    } else {
      const base = hostile ? 'zombie' : 'pig';
      VANILLA_MODELS[e.id] = { ...VANILLA_MODELS[base] };
      if (tex && !geo) SKIN_PATHS[e.id] = [tex];
      else VANILLA_MODELS[e.id] = { ...VANILLA_MODELS[base], skin: base };
      result.report.push(`Entité « ${e.id} » : ${geo ? 'texture' : 'géométrie'} introuvable, modèle de remplacement.`);
    }
    registerMob(def);
    if (def.spawn) for (const b of BIOME_DEFS) if (biomes.includes(b.key)) {
      const list = hostile ? b.hostiles : b.animals;
      if (!list.includes(def.key)) list.push(def.key);
    }
    result.counts.mobs++;
  }
  // œufs d'apparition (pour les créatures des add-ons, comme dans le jeu de référence)
  for (const e of entities) {
    const key = `${e.id}_spawn_egg`;
    if (!MOB_BY_KEY.has(e.id) || ItemRegistry.has(key)) continue;
    ItemRegistry.register({ key, name: `Œuf d'apparition de ${MOB_BY_KEY.get(e.id)!.def.name}`, icon: { sprite: 'egg', colors: ['#7a5ad0', '#e0d0ff'] }, use: 'spawn_egg', target: e.id, tab: 'ingredients' });
  }
  if (result.counts.blocks + result.counts.items + result.counts.mobs + result.counts.recipes + result.counts.textures + result.counts.functions === 0 && addons.length)
    result.report.push('Aucun contenu compatible trouvé dans les add-ons activés.');
  return result;
}
