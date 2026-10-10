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
import { BlockRegistry, MAX_BLOCKS } from '../blocks/BlockRegistry';
import { RecipeRegistry } from '../crafting/RecipeRegistry';
import type { CraftingRecipe, SmeltingRecipe } from '../crafting/Recipe';
import { MOB_BY_KEY, registerMob, type MobDef } from '../data/mobs';
import { BIOME_DEFS } from '../data/biomes';
import { VANILLA_MODELS } from '../render/MobModels';
import { SKIN_PATHS, SKIN_FALLBACK } from '../render/TextureManager';

/** Géométries vanilla (référencées par les entités clientes sans être fournies) → modèle du jeu. */
const VANILLA_GEOMETRY: [RegExp, string][] = [
  [/humanoid\.custom|geometry\.player|humanoid\.customslim/, 'player'],
  [/zombie\.husk|geometry\.husk/, 'husk'],
  [/drowned/, 'drowned'],
  [/zombie|humanoid/, 'zombie'],
  [/stray/, 'stray'],
  [/skeleton/, 'skeleton'],
  [/creeper/, 'creeper'],
  [/cave_spider/, 'cave_spider'],
  [/spider/, 'spider'],
  [/snowgolem|snow_golem/, 'snow_golem'],
  [/minecart/, 'minecart'],
  [/enderman/, 'enderman'],
  [/witch/, 'witch'],
  [/villager|evoker|vindicator|pillager|illager|wandering_trader/, 'villager'],
  [/sheep/, 'sheep'],
  [/cow|mooshroom/, 'cow'],
  [/chicken/, 'chicken'],
  [/pig/, 'pig'],
  [/wolf/, 'wolf'],
  [/squid/, 'squid'],
  [/blaze/, 'blaze'],
  [/ghast/, 'ghast'],
  [/magmacube|magma_cube/, 'magma_cube'],
  [/slime/, 'slime'],
];
import { extract, readEntries } from '../render/ResourcePack';
import { TileRegistry } from '../render/TileRegistry';
import { ADDON_BLOCKS, ADDON_TILES, addonTile, registerAddonBlocks, LOOT_TABLES, PLAYER_PROPERTIES, STRUCTURES } from './AddonRegistry';
import { buildVisual, readBlockGeometries, stateMult, traitStates, metaCount, decodeStates, conditionTrue, type BedrockBlockInfo, type BedrockVisual, type BlockGeo, type StateDef, type Material } from './BedrockBlocks';
import { parseLenientJson } from './Json';
import { BEDROCK_BLOCK_TEXTURES, BEDROCK_ENTITY_TEXTURES, BEDROCK_ITEM_TEXTURES, BIOME_TAGS } from './BedrockMaps';
import { geometryToModel, readGeometries, type BedrockGeo } from './BedrockGeometry';
import { resolveItem, LANG } from '../commands/Commands';
import { PROJECTILE_DEFS } from '../entities/Projectile';
import { parseMcStructure } from './McStructure';
import { readAnimations, readControllers, ENTITY_ANIMS } from './BedrockAnimation';
import { EXTRA_BLOCKS, EXTRA_ITEMS, EXTRA_RECIPES, EXTRA_SMELTING, EXTRA_TAGS } from '../data/vanillaExtra';

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
    // nom et description traduits (« pack.name » → texts/fr_FR.lang ou en_US.lang)
    const tr = (k: string) => {
      if (!/^[\w.]+$/.test(k) || !k.includes('.')) return k;
      for (const f of ['texts/fr_FR.lang', 'texts/en_US.lang']) {
        const t = vfs.text(root + f);
        const line = t?.split(/\r?\n/).find((l) => l.startsWith(`${k}=`));
        if (line) return line.slice(k.length + 1).replace(/\t#.*$/, '');
      }
      return k;
    };
    m.header.name = tr(String(m.header.name ?? ''));
    m.header.description = tr(String(m.header.description ?? ''));
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

/** Blocs supplémentaires du jeu de référence : identifiants stables (comme les add-ons). */
function addExtraBlocks(ids: Record<string, number>, byId: Map<number, BlockDef>, next: number): number {
  for (const d of EXTRA_BLOCKS) {
    if (ids[d.key] === undefined) {
      if (next >= MAX_BLOCKS) break;
      ids[d.key] = next++;
    }
    byId.set(ids[d.key], d);
  }
  return next;
}

/**
 * Comme dans l'inventaire créatif du jeu original, les états et morceaux de blocs créés pour
 * chaque texture du pack (« repeater_on », « cake_inner », « redstone_dust_line0 »,
 * « cocoa_stage1 »…) ne sont pas proposés : ils restent posables par commande (/give, /setblock).
 * Pour une famille sans objet de base, seule la première variante reste visible.
 */
const PART = /_(inner|dot|line\d|side|head|decor|singleleaf|base|tip|particle|overlay|moving|bottom|top|end|corner|post|noside|noside_alt)$|^(pink_petals|wildflowers|small_dripleaf|attached_melon|attached_pumpkin|melon|pumpkin)_stem$/;
const STATE = /_(on|off|lit|unlit|powered|active|inactive|triggered|crafting|ejecting|ejecting_reward|ominous|on_ominous|off_ominous|ejecting_ominous|active_ominous|inactive_ominous|ejecting_reward_ominous|ready|compost|inverted|can_summon_inner|stage\d+|hydration_\d+|not_cracked|slightly_cracked|very_cracked|cracked|\d+)$/;
function hideTechnicalBlocks() {
  const families = new Map<string, string[]>();
  for (const d of EXTRA_BLOCKS) {
    const it = ItemRegistry.get(d.key);
    if (!it || it.hidden) continue;
    if (PART.test(d.key) && !/_(slab|stairs|wall)$/.test(d.key)) {
      it.hidden = true;
      continue;
    }
    if (!STATE.test(d.key)) continue;
    let base = d.key;
    while (STATE.test(base)) base = base.replace(STATE, '');
    if (ItemRegistry.has(base) && base !== d.key) it.hidden = true;
    else families.set(base, [...(families.get(base) ?? []), d.key]);
  }
  // famille sans objet de base (œufs de renifleur, ghast desséché…) : la première variante reste
  for (const keys of families.values()) for (const k of keys.slice(1)) ItemRegistry.get(k)!.hidden = true;
}

/** Objets, tags et recettes des blocs/objets supplémentaires (après l'enregistrement des blocs). */
function registerExtraContent(byId: Map<number, BlockDef>) {
  for (const d of byId.values()) if (EXTRA_BLOCKS.includes(d) && !ItemRegistry.has(d.key) && BlockRegistry.has(d.key)) ItemRegistry.register({ key: d.key, name: d.name, icon: { block: d.key }, place: d.key, tab: d.render === 'cross' ? 'nature' : 'building' });
  for (const it of EXTRA_ITEMS) if (!ItemRegistry.has(it.key)) ItemRegistry.register(it);
  hideTechnicalBlocks();
  for (const [t, list] of Object.entries(EXTRA_TAGS)) {
    const cur = (RecipeRegistry.tags as Record<string, string[]>)[t];
    if (cur) for (const k of list) if (!cur.includes(k) && ItemRegistry.has(k)) cur.push(k);
  }
  for (const r of EXTRA_RECIPES) {
    try {
      RecipeRegistry.register(r);
    } catch {
      /* ingrédient indisponible */
    }
  }
  for (const r of EXTRA_SMELTING) if (!RecipeRegistry.smeltingFor(r.input) && ItemRegistry.has(r.input) && ItemRegistry.has(r.result)) RecipeRegistry.registerSmelting(r);
}

/** Lit le module de script d'un pack (point d'entrée, fichiers .js, versions des modules). */
function readScriptPack(vfs: VFS, root: string, name: string): ScriptPack | null {
  const m = vfs.json(root + 'manifest.json') as { modules?: { type?: string; entry?: string }[]; dependencies?: { module_name?: string; version?: string | number[] }[] } | undefined;
  const mod = m?.modules?.find((x) => x.type === 'script' || x.type === 'javascript');
  if (!mod?.entry) return null;
  const files = new Map<string, string>();
  const lowRoot = root.toLowerCase();
  for (const f of vfs.files.keys()) {
    const lf = f.toLowerCase();
    if (!lf.startsWith(lowRoot) || !(lf.endsWith('.js') || lf.endsWith('.mjs') || lf.endsWith('.json'))) continue;
    const rel = f.slice(root.length);
    if (lf.endsWith('.json') && !rel.toLowerCase().startsWith('scripts/')) continue;
    files.set(rel, vfs.text(f) ?? '');
  }
  const modules: Record<string, string> = {};
  for (const d of m?.dependencies ?? []) if (d.module_name) modules[d.module_name] = Array.isArray(d.version) ? d.version.join('.') : String(d.version ?? '');
  return { name, entry: mod.entry.replace(/^\.?\//, ''), files, modules };
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
  counts: { blocks: number; items: number; recipes: number; mobs: number; functions: number; textures: number; permutations?: number; structures?: number; sounds?: number };
  functions: Map<string, string[]>;
  tickFunctions: string[];
  /** Scripts JavaScript des packs de comportement (API de script). */
  scripts: ScriptPack[];
  /** Sons des packs de ressources : identifiant → fichiers audio. */
  sounds: Map<string, { data: Uint8Array[]; volume: number; pitch: number }>;
}

export interface ScriptPack {
  name: string;
  /** Point d'entrée, relatif à la racine du pack (« scripts/main.js »). */
  entry: string;
  /** Fichiers .js du pack : chemin relatif → source. */
  files: Map<string, string>;
  /** Versions demandées des modules (« @minecraft/server » → « 1.8.0 »). */
  modules: Record<string, string>;
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

/** Anciennes valeurs de données des colorants (édition mobile). */
const DYE_BY_DATA = ['black', 'red', 'green', 'brown', 'blue', 'purple', 'cyan', 'light_gray', 'gray', 'pink', 'lime', 'yellow', 'light_blue', 'magenta', 'orange', 'white'];
/** Anciens identifiants d'objets → identifiants actuels. */
const ITEM_ALIASES: Record<string, string> = { netherbrick: 'nether_brick', speckled_melon: 'glistering_melon_slice', melon_block: 'melon', end_bricks: 'end_stone_bricks', snow: 'snow_block', reeds: 'sugar_cane', golden_rail: 'iron_ingot', red_nether_brick: 'red_nether_bricks', quartz_ore: 'quartz', magma_block: 'magma', slime: 'slime_block', web: 'string', noteblock: 'noteblock', carpet: 'white_wool', stained_glass: 'white_stained_glass', concrete: 'white_concrete', stained_hardened_clay: 'white_terracotta', hardened_clay: 'terracotta', fish: 'cooked_beef', lit_pumpkin: 'jack_o_lantern' };

/** Ingrédients introuvables lors du dernier chargement (diagnostic). */
const missingIngredients = new Map<string, number>();

/** Ingrédient Bedrock → clé d'objet ou tag du jeu (null si inconnu). */
function ingredient(x: unknown): string | null {
  const r = ingredient0(x);
  if (!r && x) {
    const name = typeof x === 'string' ? x : String((x as { item?: string; tag?: string }).item ?? `#${(x as { tag?: string }).tag}`);
    missingIngredients.set(name, (missingIngredients.get(name) ?? 0) + 1);
  }
  return r;
}

function ingredient0(x: unknown): string | null {
  if (!x) return null;
  if (typeof x === 'string') {
    // « minecraft:coal:1 » : valeur de données
    const m = /^(.*?):(\d+)$/.exec(x);
    if (m) return ingredient0({ item: m[1], data: Number(m[2]) });
    return itemKey(x);
  }
  const o = x as Record<string, unknown>;
  if (typeof o.tag === 'string') return TAG_ALIASES[o.tag.replace(/^minecraft:/, '')] ?? null;
  if (typeof o.item === 'string') {
    const k = o.item.replace(/^minecraft:/, '');
    // anciens identifiants avec valeur de données
    if (k === 'planks') return 'tag:planks';
    if (k === 'log' || k === 'log2') return 'tag:logs';
    if (k === 'wool') return 'tag:wool';
    if (k === 'coal') return o.data === 1 ? 'charcoal' : 'coal';
    if (k === 'dye') return itemKey(`${DYE_BY_DATA[Number(o.data ?? 0)] ?? 'black'}_dye`);
    if (/^stone_slab\d?$/.test(k)) return itemKey('stone_slab');
    if (ITEM_ALIASES[k]) return itemKey(ITEM_ALIASES[k]);
    return itemKey(o.item);
  }
  return null;
}

function itemKey(id: string): string | null {
  if (!id.startsWith('minecraft:') && id.includes(':')) return ItemRegistry.has(id) ? id : ItemRegistry.has(id.toLowerCase()) ? id.toLowerCase() : null;
  try {
    return resolveItem(id);
  } catch {
    const k = id.replace(/^minecraft:/, '');
    if (ITEM_ALIASES[k] && ItemRegistry.has(ITEM_ALIASES[k])) return ITEM_ALIASES[k];
    if (/^stone_slab\d$/.test(k)) return 'stone_slab';
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
  registerAddonBlocks(ADDON_BLOCKS, ADDON_TILES);
}

/** États, permutations et géométrie d'un bloc d'add-on (null si c'est un simple cube). */
async function buildBedrockInfo(
  b: { id: string; c: Record<string, unknown>; desc: Record<string, unknown>; perms: { condition?: string; components?: Record<string, unknown> }[] },
  base: Record<string, unknown>,
  tile: (short: string | undefined) => Promise<string>,
  terrain: Map<string, string>,
  blockGeos: Map<string, BlockGeo>,
  report: string[],
): Promise<BedrockBlockInfo | null> {
  const ts = traitStates(b.desc.traits as Parameters<typeof traitStates>[0]);
  const states: StateDef[] = [...ts.states];
  for (const [name, v] of Object.entries((b.desc.states ?? b.desc.properties ?? {}) as Record<string, unknown>)) {
    if (states.some((s) => s.name === name)) continue;
    let values: (string | number | boolean)[] = [];
    if (Array.isArray(v)) values = v as (string | number | boolean)[];
    else if (v && typeof v === 'object' && 'values' in (v as object)) {
      const r = (v as { values: { min?: number; max?: number } }).values;
      for (let i = r.min ?? 0; i <= (r.max ?? 0); i++) values.push(i);
    }
    if (values.length) states.push({ name, values });
  }
  const geoC = base['minecraft:geometry'];
  const geoId = typeof geoC === 'string' ? geoC : (geoC as { identifier?: string } | undefined)?.identifier;
  const custom = Object.keys(base).filter((k) => !k.startsWith('minecraft:') && !k.startsWith('tag:') && k.includes(':'));
  const customParams: Record<string, unknown> = {};
  for (const k of custom) customParams[k] = base[k];
  // composants personnalisés ajoutés par des permutations
  for (const p of b.perms) for (const k of Object.keys(p.components ?? {})) if (!k.startsWith('minecraft:') && !k.startsWith('tag:') && k.includes(':') && !custom.includes(k)) {
    custom.push(k);
    customParams[k] = p.components![k];
  }
  const legacyCustom = (base['minecraft:custom_components'] as string[] | undefined) ?? [];
  const tick = base['minecraft:tick'] as { interval_range?: [number, number] } | undefined;
  const plain = !states.length && !b.perms.length && (!geoId || geoId.includes('full_block')) && !base['minecraft:transformation'] && base['minecraft:collision_box'] === undefined;
  const tags = Object.keys(base).filter((k) => k.startsWith('tag:')).map((k) => k.slice(4));
  if (plain && !custom.length && !legacyCustom.length && !tick) return null;
  const mult = stateMult(states);
  const info: BedrockBlockInfo = { states, mult, visuals: [], placement: ts.placement, custom: [...custom, ...legacyCustom], customParams, tick: tick ? tick.interval_range ?? [1, 1] : null, randomTick: !!base['minecraft:random_ticking'], tags };
  if (mult.some((m) => m === 0)) report.push(`Bloc « ${b.id} » : trop d'états, certains sont figés.`);
  const count = metaCount(info);
  const tileCache = new Map<string, Material | null>();
  const cache = new Map<string, BedrockVisual>();
  const matFor = async (mi: Record<string, unknown>, inst: string, face: string): Promise<Material | null> => {
    let e = mi[inst] ?? mi[face] ?? (['north', 'south', 'east', 'west'].includes(face) ? mi.side : undefined) ?? mi['*'];
    for (let i = 0; i < 4 && typeof e === 'string'; i++) e = mi[e as string];
    const m = e as { texture?: string; render_method?: string } | undefined;
    if (!m?.texture) return null;
    const key = `${m.texture}|${m.render_method ?? ''}`;
    if (tileCache.has(key)) return tileCache.get(key)!;
    const name = await tile(m.texture);
    const out: Material | null = name === 'missing' ? null : { tile: addonTile(name), trans: m.render_method === 'blend', w: 16, h: 16 };
    tileCache.set(key, out);
    return out;
  };
  for (let meta = 0; meta < count; meta++) {
    const st = decodeStates(info, meta);
    const comp: Record<string, unknown> = { ...base };
    for (const p of b.perms) if (p.condition && conditionTrue(p.condition, st)) Object.assign(comp, p.components ?? {});
    const g = comp['minecraft:geometry'];
    const gid = typeof g === 'string' ? g : (g as { identifier?: string } | undefined)?.identifier;
    const boneVis = typeof g === 'object' ? (g as { bone_visibility?: Record<string, string | boolean> }).bone_visibility : undefined;
    const geometry = !gid || gid.includes('full_block') ? 'full' : gid.includes('geometry.cross') ? 'cross' : blockGeos.get(gid) ?? null;
    if (gid && geometry === null) {
      const msg = `Bloc « ${b.id} » : géométrie « ${gid} » introuvable (cube).`;
      if (!report.includes(msg)) report.push(msg);
    }
    const mi = (comp['minecraft:material_instances'] ?? {}) as Record<string, unknown>;
    // matériaux résolus d'avance (fonction synchrone pour buildVisual)
    const mats = new Map<string, Material | null>();
    const insts = new Set<string>(['*', 'up', 'down', 'north', 'south', 'east', 'west', 'side', ...Object.keys(mi)]);
    for (const inst of insts) for (const face of ['up', 'down', 'north', 'south', 'east', 'west']) mats.set(`${inst}|${face}`, await matFor(mi, inst, face));
    const boneEval: Record<string, boolean> = {};
    if (boneVis) for (const [k, v] of Object.entries(boneVis)) boneEval[k] = typeof v === 'boolean' ? v : conditionTrue(String(v), st);
    const key = JSON.stringify([gid, boneEval, mi, comp['minecraft:transformation'], comp['minecraft:collision_box'], comp['minecraft:selection_box']]);
    let vis = cache.get(key);
    if (!vis) {
      vis = buildVisual({
        geometry: geometry ?? 'full',
        boneVisibility: boneEval,
        materials: (inst, face) => mats.get(`${inst}|${face}`) ?? mats.get(`*|${face}`) ?? null,
        transformation: comp['minecraft:transformation'] as { rotation?: number[] } | undefined,
        collision: comp['minecraft:collision_box'],
        selection: comp['minecraft:selection_box'],
        states: st,
      });
      cache.set(key, vis);
    }
    info.visuals.push(vis);
  }
  void terrain;
  return info;
}

/** Charge et enregistre tous les add-ons activés. À appeler avant la création de tout monde. */
export async function loadEnabledAddons(): Promise<AddonLoadResult> {
  const result: AddonLoadResult = { images: new Map(), report: [], counts: { blocks: 0, items: 0, recipes: 0, mobs: 0, functions: 0, textures: 0 }, functions: new Map(), tickFunctions: [], scripts: [], sounds: new Map() };
  const addons = (await listAddons()).filter((a) => a.enabled);
  if (!addons.length) {
    // aucun add-on actif : blocs supplémentaires du jeu de référence ; les identifiants
    // déjà attribués aux add-ons restent réservés (« bloc inconnu »)
    const ids = readIds();
    const byId = new Map<number, BlockDef>();
    addExtraBlocks(ids, byId, Math.max(VANILLA_BLOCK_COUNT, ...Object.values(ids).map((v) => v + 1)));
    localStorage.setItem(ID_KEY, JSON.stringify(ids));
    reserveBlockIds(byId);
    registerExtraContent(byId);
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
        if (p.summary.hasScripts) {
          const sp = readScriptPack(vfs, p.root, p.summary.name);
          if (sp) result.scripts.push(sp);
          else result.report.push(`« ${p.summary.name} » : point d'entrée de script introuvable.`);
        }
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
  const blockGeos = new Map<string, BlockGeo>();
  const rpItemIcons = new Map<string, string>(); // anciens objets : icône définie côté ressources
  const imageSources = new Map<string, { vfs: VFS; path: string }>(); // chemin sans extension → fichier
  const shortTex = (x: unknown): string | undefined => {
    if (typeof x === 'string') return x;
    if (Array.isArray(x)) return shortTex(x[0]);
    if (x && typeof x === 'object') return shortTex((x as Record<string, unknown>).path);
    return undefined;
  };
  const entitySounds = new Map<string, Record<string, string>>();
  for (const rp of rps) {
    const { vfs, root } = rp;
    // sons : sound_definitions.json (fichiers .ogg/.wav) et sons des entités (sounds.json)
    const sd = vfs.json(root + 'sounds/sound_definitions.json') as Record<string, unknown> | undefined;
    const defs = (sd?.sound_definitions ?? sd ?? {}) as Record<string, { sounds?: (string | { name?: string; volume?: number; pitch?: number })[] }>;
    for (const [id, d] of Object.entries(defs)) {
      if (!d || typeof d !== 'object' || !Array.isArray(d.sounds)) continue;
      const data: Uint8Array[] = [];
      let volume = 1, pitch = 1;
      for (const e of d.sounds) {
        const name = typeof e === 'string' ? e : e?.name;
        if (!name) continue;
        if (typeof e === 'object') {
          volume = e.volume ?? volume;
          pitch = e.pitch ?? pitch;
        }
        for (const ext of ['.ogg', '.wav', '.mp3', '']) {
          const f = vfs.get(root + name + ext);
          if (f) {
            data.push(f);
            break;
          }
        }
      }
      if (data.length) {
        result.sounds.set(id.toLowerCase(), { data, volume, pitch });
        result.counts.sounds = (result.counts.sounds ?? 0) + 1;
      }
    }
    const sj = vfs.json(root + 'sounds.json') as { entity_sounds?: { entities?: Record<string, { events?: Record<string, unknown> }> } } | undefined;
    for (const [eid, e] of Object.entries(sj?.entity_sounds?.entities ?? {})) {
      const ev: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.events ?? {})) {
        const sid = typeof v === 'string' ? v : (v as { sound?: string })?.sound;
        if (sid) ev[k] = sid.toLowerCase();
      }
      entitySounds.set(eid, ev);
    }
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
    for (const f of vfs.list(root + 'animations', '.json')) readAnimations(vfs.json(f));
    for (const f of vfs.list(root + 'animation_controllers', '.json')) readControllers(vfs.json(f));
    const bj = vfs.json(root + 'blocks.json') as Record<string, unknown> | undefined;
    for (const [k, v] of Object.entries(bj ?? {})) if (k !== 'format_version') blockJson.set(k.includes(':') ? k : `minecraft:${k}`, v);
    for (const f of [...vfs.list(root + 'entity', '.json'), ...vfs.list(root + 'entities', '.json')]) {
      const j = vfs.json(f) as Record<string, { description?: Record<string, unknown> }> | undefined;
      const d = j?.['minecraft:client_entity']?.description;
      if (!d?.identifier) continue;
      const tex = d.textures as Record<string, string> | undefined;
      const geo = d.geometry as Record<string, string> | undefined;
      clientEntities.set(String(d.identifier), { texture: tex?.default ?? Object.values(tex ?? {})[0], geometry: geo?.default ?? Object.values(geo ?? {})[0] });
      // animations : noms courts → animation/contrôleur, scripts animate/initialize/pre_animation
      const scr = (d.scripts ?? {}) as { animate?: (string | Record<string, string>)[]; initialize?: string[]; pre_animation?: string[] };
      if (d.animations && scr.animate?.length)
        ENTITY_ANIMS.set(String(d.identifier), { map: d.animations as Record<string, string>, animate: scr.animate, initialize: scr.initialize ?? [], preAnimation: scr.pre_animation ?? [] });
    }
    for (const f of vfs.list(root + 'models', '.json')) {
      const j = vfs.json(f) ?? {};
      for (const g of readGeometries(j)) if (g.id) geos.set(g.id, g);
      readBlockGeometries(j, blockGeos);
    }
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
  const blockDefs: { id: string; def: BlockDef; c: Record<string, unknown>; desc: Record<string, unknown>; perms: { condition?: string; components?: Record<string, unknown> }[] }[] = [];
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
      const b = j?.['minecraft:block'] as { description?: Record<string, unknown>; components?: Record<string, unknown>; permutations?: { condition?: string; components?: Record<string, unknown> }[] } | undefined;
      const id = b?.description?.identifier as string | undefined;
      if (!id) continue;
      blockDefs.push({ id, def: undefined as unknown as BlockDef, c: b!.components ?? {}, desc: b!.description ?? {}, perms: b!.permutations ?? [] });
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
    // structures (.mcstructure) : « dossier:nom » ou « mystructure:nom » à la racine
    for (const f of vfs.list(root + 'structures', '.mcstructure')) {
      try {
        const data = parseMcStructure(vfs.get(f)!);
        const rel = f.slice(root.length + 'structures/'.length).replace(/\.mcstructure$/i, '');
        const parts = rel.split('/');
        const name = parts.pop()!;
        const ns = parts.length ? parts.join('/') : 'mystructure';
        for (const k of [`${ns}:${name}`, ...(parts.length ? [] : [name])]) STRUCTURES.set(k.toLowerCase(), data);
        result.counts.structures = (result.counts.structures ?? 0) + 1;
      } catch (e) {
        result.report.push(`Structure « ${f} » illisible : ${(e as Error).message}`);
      }
    }
    for (const f of vfs.list(root + 'entities', '.json')) {
      const j = vfs.json(f) as Record<string, { description?: Record<string, unknown>; components?: Record<string, unknown>; component_groups?: Record<string, Record<string, unknown>>; events?: Record<string, unknown> }> | undefined;
      const e = j?.['minecraft:entity'];
      const id = e?.description?.identifier as string | undefined;
      // entités du jeu de référence redéfinies : seuls le joueur (propriétés) et les projectiles sont utilisés
      if (!id || (id.startsWith('minecraft:') && id !== 'minecraft:player' && !e!.components?.['minecraft:projectile'])) continue;
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
  next = addExtraBlocks(ids, byId, next);
  const lateLoot: [string, unknown][] = [];
  for (const b of blockDefs) {
    if (ids[b.id] === undefined) {
      if (next >= MAX_BLOCKS) {
        result.report.push(`Bloc « ${b.id} » ignoré : limite de ${MAX_BLOCKS} blocs atteinte.`);
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
      addonTile(name);
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
    // le butin est résolu après l'enregistrement des objets (il peut en référencer)
    const drops = c['minecraft:loot'] !== undefined ? [] : [{ item: b.id }];
    if (c['minecraft:loot'] !== undefined) lateLoot.push([b.id, c['minecraft:loot']]);
    const bedrock = await buildBedrockInfo(b, c, tile, terrain, blockGeos, result.report);
    const def: BlockDef = {
      key: b.id,
      name,
      textures: { top, bottom, side },
      ...(bedrock ? { bedrock, shape: 'custom' as const } : {}),
      hardness: Math.max(-1, Math.min(50, hardness)),
      render: bedrock ? 'model' : method === 'blend' ? 'translucent' : method === 'alpha_test' || method === 'double_sided' ? 'cutout' : 'cube',
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
    if (d.bedrock) result.counts.permutations = (result.counts.permutations ?? 0) + d.bedrock.visuals.length;
    if (EXTRA_BLOCKS.includes(d)) continue;
    if (!ItemRegistry.has(d.key)) ItemRegistry.register({ key: d.key, name: d.name, icon: { block: d.key }, place: d.key, tab: 'building' });
    result.counts.blocks++;
  }

  registerExtraContent(byId);

  // 5) objets
  const SAT: Record<string, number> = { poor: 0.1, low: 0.3, normal: 0.6, good: 0.8, max: 1, supernatural: 1.2 };
  for (const raw of itemDefs) {
    const r = raw as unknown as { key: string; _c: Record<string, unknown>; _d: Record<string, unknown> };
    const c = r._c;
    // composants personnalisés (API de script) : « espace:nom »: {params} ou minecraft:custom_components
    const scriptComponents: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c)) if (k.includes(':') && !k.startsWith('minecraft:') && !k.startsWith('tag:')) scriptComponents[k] = v;
    for (const k of (c['minecraft:custom_components'] as string[] | undefined) ?? []) scriptComponents[k] = {};
    const itemTags = [...((c['minecraft:tags'] as { tags?: string[] } | undefined)?.tags ?? []), ...Object.keys(c).filter((k) => k.startsWith('tag:')).map((k) => k.slice(4))];
    const cd = c['minecraft:cooldown'] as { category?: string; duration?: number } | undefined;
    const scriptExtras = {
      ...(Object.keys(scriptComponents).length ? { scriptComponents } : {}),
      ...(itemTags.length ? { tags: itemTags } : {}),
      ...(cd ? { cooldown: { category: String(cd.category ?? r.key), duration: Number(cd.duration ?? 0) } } : {}),
    };
    if (ItemRegistry.has(r.key)) {
      // objet déjà créé par son bloc : on y ajoute les données de script
      Object.assign(ItemRegistry.get(r.key)!, scriptExtras);
      continue;
    }
    const iconC = c['minecraft:icon'];
    const iconShort = typeof iconC === 'string' ? iconC : (iconC as { texture?: string; textures?: { default?: string } } | undefined)?.texture ?? (iconC as { textures?: { default?: string } } | undefined)?.textures?.default ?? rpItemIcons.get(r.key);
    const iconKey = await addonImage(iconShort ? itemTex.get(iconShort) ?? iconShort : undefined);
    const dn = c['minecraft:display_name'] as { value?: string } | undefined;
    const name = lang.get(`item.${r.key}.name`) ?? lang.get(`item.${r.key}`) ?? (dn?.value ? lang.get(dn.value) ?? cleanText(dn.value) : undefined) ?? prettify(r.key);
    const def: ItemDef = { key: r.key, name, icon: iconKey ? { image: iconKey } : { sprite: 'lump', colors: ['#c070ff', '#ffffff'] }, ...scriptExtras };
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
  missingIngredients.clear();
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
        if (!item) {
          missingIngredients.set(`→${typeof res === 'string' ? res : (res as { item: string }).item}`, (missingIngredients.get(`→${typeof res === 'string' ? res : (res as { item: string }).item}`) ?? 0) + 1);
          throw new Error('résultat inconnu');
        }
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
  if (skipped) {
    const top = [...missingIngredients.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([k, n]) => `${k.replace(/^minecraft:/, '')} (${n})`);
    result.report.push(`${skipped} recette(s) ignorée(s) : ingrédients inconnus du jeu — ${top.join(', ')}${missingIngredients.size > 12 ? '…' : ''}.`);
  }

  // textes traduits (formulaires des scripts, tellraw « translate »)
  for (const [k, v] of lang) if (!LANG.has(k)) LANG.set(k, v);

  // tables de butin (commande /loot, API de script)
  LOOT_TABLES.clear();
  for (const k of loot.keys()) LOOT_TABLES.set(k.replace(/^loot_tables\//, '').replace(/\.json$/, ''), lootDrops(k));

  // 7) entités
  PLAYER_PROPERTIES.clear();
  const avgColor = (bmp: ImageBitmap | undefined): string | null => {
    if (!bmp) return null;
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 8;
      const g = cv.getContext('2d')!;
      g.drawImage(bmp, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) (r += d[i], gg += d[i + 1], b += d[i + 2], n++);
      return n ? `rgb(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)})` : null;
    } catch {
      return null;
    }
  };
  for (const e of entities) {
    if (MOB_BY_KEY.has(e.id)) continue;
    const c = e.c;
    // joueur : seules les propriétés d'entité (minecraft:properties) sont utilisées (scripts)
    if (e.id === 'minecraft:player') {
      for (const [k, v] of Object.entries((e.desc.properties ?? {}) as Record<string, { type?: string; default?: unknown; values?: unknown[]; range?: number[] }>)) {
        const d = v.default;
        PLAYER_PROPERTIES.set(k, typeof d === 'number' || typeof d === 'boolean' ? d : typeof d === 'string' && !/[qv]\.|query|math/.test(d) ? d : v.type === 'bool' ? false : v.type === 'enum' ? String(v.values?.[0] ?? '') : (v.range?.[0] ?? 0));
      }
      continue;
    }
    // créature du jeu de référence redéfinie par l'add-on : la version du jeu est conservée
    if (e.id.startsWith('minecraft:') && MOB_BY_KEY.has(e.id.slice(10))) continue;
    // projectiles (minecraft:projectile) : gérés comme projectiles, pas comme créatures
    const projC = c['minecraft:projectile'] as { on_hit?: Record<string, Record<string, unknown>>; gravity?: number; power?: number } | undefined;
    if (projC) {
      const hit = projC.on_hit ?? {};
      const dmg = hit.impact_damage?.damage;
      const eff = (hit.mob_effect ?? {}) as { effect?: string; duration?: number; amplifier?: number };
      const ce0 = clientEntities.get(e.id);
      const texKey = await addonImage(ce0?.texture);
      const base = PROJECTILE_DEFS.get(e.id);
      PROJECTILE_DEFS.set(e.id, {
        id: e.id,
        color: avgColor(texKey ? result.images.get(texKey) : undefined) ?? base?.color ?? '#d0d0d0',
        size: base?.size ?? Math.max(0.15, Math.min(0.8, val((c['minecraft:collision_box'] as { width?: number } | undefined)?.width, 0.25))),
        gravity: (projC.gravity ?? 0.05) * 240,
        damage: Array.isArray(dmg) ? Number(dmg[0]) : val(dmg, base?.damage ?? 0),
        ...(hit.explode ? { explode: val(hit.explode.power, 1) } : base?.explode ? { explode: base.explode } : {}),
        ...(hit.catch_fire || base?.fire ? { fire: true } : {}),
        ...(eff.effect ? { effect: { id: eff.effect, duration: val(eff.duration, 5) * 20, amplifier: val(eff.amplifier, 0) } } : base?.effect ? { effect: base.effect } : {}),
        ...(hit.stick_in_ground || base?.stick ? { stick: true } : {}),
        ...(base?.knockback ? { knockback: base.knockback } : {}),
        ...(hit.teleport_owner || base?.teleport ? { teleport: true } : {}),
      });
      continue;
    }
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
      ranged: ranged ? { projectile: 'arrow', range: 15, damage: Math.max(2, val(attack?.damage, 3)), speed: 1.5, ...((c['minecraft:shooter'] as { def?: string } | undefined)?.def ? { customId: String((c['minecraft:shooter'] as { def?: string }).def) } : {}) } : undefined,
      traits,
      sounds: {
        idle: entitySounds.get(e.id)?.ambient ?? (hostile ? 'groan' : 'oink'),
        hurt: entitySounds.get(e.id)?.hurt ?? (hostile ? 'groan_hurt' : 'oink_hurt'),
        death: entitySounds.get(e.id)?.death ?? entitySounds.get(e.id)?.hurt ?? (hostile ? 'groan_death' : 'oink_hurt'),
      },
      scale: val(c['minecraft:scale'], 1),
      families: ((c['minecraft:type_family'] as { family?: string[] } | undefined)?.family ?? []).map(String),
      properties: Object.fromEntries(
        Object.entries((e.desc.properties ?? {}) as Record<string, { type?: string; default?: unknown; values?: unknown[]; range?: number[] }>).map(([k, v]) => {
          const d = v.default;
          const val = typeof d === 'number' || typeof d === 'boolean' ? d : typeof d === 'string' && !/[qv]\.|query|math/.test(d) ? d : v.type === 'bool' ? false : v.type === 'enum' ? String(v.values?.[0] ?? '') : (v.range?.[0] ?? 0);
          return [k, val as number | string | boolean];
        }),
      ),
      variant: val((c['minecraft:variant'] as { value?: number } | undefined)?.value, 0),
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
    // texture : celle de l'add-on, sinon une texture du jeu (pack de ressources ou texture générée)
    const vanillaTex = (p: string | undefined): string[] => {
      if (!p) return [];
      const rel = p.replace(/\.(png|tga)$/i, '');
      const blk = /^textures\/blocks?\/(.+)$/.exec(rel);
      if (blk) return [`block/${blk[1]}.png`, `tile:${blk[1]}`];
      const ent = /^textures\/entity\/(.+)$/.exec(rel);
      if (ent) return [`entity/${ent[1]}.png`];
      return [];
    };
    // géométrie vanilla référencée (non fournie par l'add-on) → modèle équivalent du jeu
    const vanillaGeo = ce?.geometry && !geo ? VANILLA_GEOMETRY.find(([re]) => re.test(ce.geometry!))?.[1] : undefined;
    const runtime = String(e.desc.runtime_identifier ?? '').replace(/^minecraft:/, '');
    const texPaths = tex ? [tex] : vanillaTex(ce?.texture);
    if (geo) {
      VANILLA_MODELS[e.id] = geometryToModel(geo, e.id);
      SKIN_PATHS[e.id] = texPaths;
      if (!texPaths.length) result.report.push(`Entité « ${e.id} » : texture introuvable.`);
    } else if (vanillaGeo && VANILLA_MODELS[vanillaGeo]) {
      VANILLA_MODELS[e.id] = { ...VANILLA_MODELS[vanillaGeo], skin: e.id };
      SKIN_PATHS[e.id] = [...texPaths, ...(SKIN_PATHS[vanillaGeo] ?? [])];
      SKIN_FALLBACK[e.id] = vanillaGeo;
    } else if (!ce) {
      // sans entité cliente : invisible dans le jeu de référence (entités techniques)
      const rt = VANILLA_MODELS[runtime] && !/arrow|snowball|egg|potion/.test(runtime) ? runtime : null;
      VANILLA_MODELS[e.id] = rt ? { ...VANILLA_MODELS[rt] } : { ...VANILLA_MODELS.invisible };
    } else {
      // géométrie inconnue : modèle du jeu le plus proche de l'identifiant d'exécution, sinon invisible
      const rt = VANILLA_MODELS[runtime] ? runtime : null;
      VANILLA_MODELS[e.id] = rt ? { ...VANILLA_MODELS[rt], skin: e.id } : { ...VANILLA_MODELS.invisible };
      if (rt) {
        SKIN_PATHS[e.id] = [...texPaths, ...(SKIN_PATHS[rt] ?? [])];
        SKIN_FALLBACK[e.id] = rt;
      }
      result.report.push(`Entité « ${e.id} » : géométrie « ${ce.geometry} » introuvable${rt ? `, modèle de ${rt}` : ', invisible'}.`);
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
