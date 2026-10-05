/**
 * Blocs ajoutés par les add-ons, dans l'ordre de leurs identifiants numériques.
 * Partagé avec le worker (qui doit enregistrer exactement les mêmes blocs pour le maillage).
 */
import type { BlockDef } from '../blocks/Block';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { TileRegistry } from '../render/TileRegistry';

export const ADDON_BLOCKS: BlockDef[] = [];

/** Tuiles référencées par une définition de bloc. */
export function tilesOf(def: BlockDef): string[] {
  const t = def.textures ?? {};
  return [t.all, t.top, t.bottom, t.side, t.front, ...(t.byMeta ?? [])].filter((n): n is string => !!n);
}

/** Enregistre tuiles puis blocs (thread principal et worker, même ordre). */
export function registerAddonBlocks(defs: BlockDef[]) {
  for (const d of defs) {
    for (const n of tilesOf(d)) if (!TileRegistry.has(n)) TileRegistry.addTile(n);
    if (!BlockRegistry.has(d.key)) BlockRegistry.register(d);
  }
}
