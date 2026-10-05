/**
 * Blocs ajoutés par les add-ons, dans l'ordre de leurs identifiants numériques.
 * Partagé avec le worker (qui doit enregistrer exactement les mêmes blocs pour le maillage).
 */
import type { BlockDef } from '../blocks/Block';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { TileRegistry } from '../render/TileRegistry';

export const ADDON_BLOCKS: BlockDef[] = [];
/** Tuiles ajoutées par les add-ons, dans l'ordre d'enregistrement (identique dans le worker). */
export const ADDON_TILES: string[] = [];

/** Enregistre (si besoin) une tuile d'add-on et retourne son index dans l'atlas. */
export function addonTile(name: string): number {
  if (!TileRegistry.has(name)) {
    TileRegistry.addTile(name);
    ADDON_TILES.push(name);
  }
  return TileRegistry.index(name);
}

/** Tuiles référencées par une définition de bloc. */
export function tilesOf(def: BlockDef): string[] {
  const t = def.textures ?? {};
  return [t.all, t.top, t.bottom, t.side, t.front, ...(t.byMeta ?? [])].filter((n): n is string => !!n);
}

/** Enregistre tuiles puis blocs (thread principal et worker, même ordre). */
export function registerAddonBlocks(defs: BlockDef[], tiles: string[] = []) {
  for (const n of tiles) if (!TileRegistry.has(n)) TileRegistry.addTile(n);
  for (const d of defs) {
    for (const n of tilesOf(d)) addonTile(n);
    if (!BlockRegistry.has(d.key)) BlockRegistry.register(d);
  }
}

export interface LootDrop {
  item: string;
  min: number;
  max: number;
  chance?: number;
}
/** Tables de butin des add-ons (chemin « loot_tables/… » sans extension, minuscules) → objets. */
export const LOOT_TABLES = new Map<string, LootDrop[]>();

/** Tire le butin d'une table (chemin avec ou sans « loot_tables/ » et « .json »). */
export function rollLoot(name: string): { item: string; count: number }[] {
  const k = name.toLowerCase().replace(/\\/g, '/').replace(/^loot_tables\//, '').replace(/\.json$/, '');
  const t = LOOT_TABLES.get(k);
  if (!t) return [];
  const out: { item: string; count: number }[] = [];
  for (const d of t) {
    if (d.chance !== undefined && Math.random() > d.chance) continue;
    const n = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
    if (n > 0) out.push({ item: d.item, count: n });
  }
  return out;
}
