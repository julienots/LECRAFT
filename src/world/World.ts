import { newFurnace, type FurnaceState } from '../crafting/CraftingSystem';
import { isRailKey, updateRailsAround } from './Rails';
import { updateDripstoneColumn } from './Dripstone';
import type { ItemStack } from '../inventory/Item';
import { newBrewing, type BrewingState } from '../crafting/Brewing';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/Config';
import { Emitter } from '../core/Events';
import { Inventory } from '../inventory/Inventory';
import { chunkKey } from '../util/math';
import { BiomeManager, type Biome } from './BiomeManager';
import type { Chunk } from './Chunk';
import { idx } from './ChunkData';

export interface BlockChange {
  x: number;
  y: number;
  z: number;
  prev: number;
  id: number;
  meta: number;
}

export interface SpecialEntry {
  x: number;
  y: number;
  z: number;
  block: number;
  meta: number;
  /** Données de jeu (cooldown de cage, compteur d'apparitions...). */
  timer: number;
  spawned: number;
}

type WorldEvents = { blockChanged: BlockChange };

/**
 * Accès aux blocs du monde (coordonnées monde) côté thread principal.
 * Toutes les modifications passent par setBlock() : mise à jour locale, envoi au worker,
 * marquage des chunks à remesher et planification des mises à jour voisines.
 */
export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly events = new Emitter<WorldEvents>();
  /** Modifications à transmettre au worker (x,y,z,id,meta). */
  pendingEdits: number[] = [];
  /** Positions à mettre à jour au prochain tick (liquides, gravité, supports). */
  updateQueue: number[] = [];
  readonly chests = new Map<string, Inventory>();
  /** Fourneaux (entités de bloc) : contenu et progression de cuisson. */
  readonly furnaces = new Map<string, FurnaceState>();
  /** Alambics (fioles, ingrédient, poudre de blaze, infusion en cours). */
  readonly brewing = new Map<string, BrewingState>();
  private dripBusy = false;
  readonly specials = new Map<string, SpecialEntry>();

  constructor(readonly seed: number) {}

  getChunk(cx: number, cz: number) {
    return this.chunks.get(chunkKey(cx, cz));
  }
  chunkAt(x: number, z: number) {
    return this.chunks.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
  }

  /** Vide sous y = 0 (l'End) au lieu d'un plancher de bedrock. */
  voidBelow = false;

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return this.voidBelow ? B.AIR : B.BEDROCK;
    if (y >= WORLD_HEIGHT) return B.AIR;
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    return c.blocks[idx(x - c.cx * CHUNK_SIZE, y, z - c.cz * CHUNK_SIZE)];
  }
  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return c.meta[idx(x - c.cx * CHUNK_SIZE, y, z - c.cz * CHUNK_SIZE)];
  }
  isLoaded(x: number, z: number) {
    return !!this.chunkAt(x, z);
  }
  /** Bloc solide pour la physique ; les chunks non chargés sont considérés solides (sécurité). */
  isSolid(x: number, y: number, z: number): boolean {
    const b = this.getBlock(x, y, z);
    if (b < 0) return true;
    return BlockRegistry.solid[b] === 1;
  }

  /** Lumière du ciel (0..15) et des blocs (0..15) au point donné. */
  getLight(x: number, y: number, z: number): { sky: number; block: number } {
    if (y >= WORLD_HEIGHT) return { sky: 15, block: 0 };
    if (y < 0) return { sky: 0, block: 0 };
    const c = this.chunkAt(x, z);
    if (!c || !c.light) return { sky: 15, block: 0 };
    const v = c.light[idx(x - c.cx * CHUNK_SIZE, y, z - c.cz * CHUNK_SIZE)];
    return { sky: v >> 4, block: v & 15 };
  }

  biomeAt(x: number, z: number): Biome {
    const c = this.chunkAt(x, z);
    if (!c) return BiomeManager.get(0);
    return BiomeManager.get(c.biomes[(x - c.cx * CHUNK_SIZE) + (z - c.cz * CHUNK_SIZE) * CHUNK_SIZE]);
  }

  heightAt(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return c.heights[(x - c.cx * CHUNK_SIZE) + (z - c.cz * CHUNK_SIZE) * CHUNK_SIZE];
  }

  /** Hauteur du premier bloc solide sous (x, yStart, z). */
  surfaceBelow(x: number, yStart: number, z: number): number {
    for (let y = Math.min(WORLD_HEIGHT - 1, yStart); y > 0; y--) if (BlockRegistry.solid[Math.max(0, this.getBlock(x, y, z))]) return y;
    return 0;
  }

  setBlock(x: number, y: number, z: number, id: number, meta = 0, scheduleUpdates = true): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const lx = x - c.cx * CHUNK_SIZE, lz = z - c.cz * CHUNK_SIZE;
    const i = idx(lx, y, lz);
    const prev = c.blocks[i];
    if (prev === id && c.meta[i] === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    const col = lx + lz * CHUNK_SIZE;
    if (id !== B.AIR && y > c.heights[col]) c.heights[col] = y;
    else if (id === B.AIR && y === c.heights[col]) {
      let yy = y;
      while (yy > 0 && c.blocks[idx(lx, yy, lz)] === B.AIR) yy--;
      c.heights[col] = yy;
    }
    c.modified = true;
    c.unsaved = true;
    c.version++;
    this.pendingEdits.push(x, y, z, id, meta);
    // mise à jour de l'éclairage local approximatif (sera recalculé au remesh)
    this.markDirty(x, z, lx, lz, prev !== id);
    if (prev > 0 && prev !== id) {
      // contenu d'un conteneur remplacé (coffre, tonneau, fourneau…) : les objets ont déjà été
      // lâchés par le code qui casse le bloc (joueur, explosion) ; l'état est retiré ici
      const kind = BlockRegistry.get(prev).interact;
      const furnaceLike = (b: number) => b === B.FURNACE || b === B.LIT_FURNACE;
      if (kind === 'chest' || kind === 'dispenser' || kind === 'hopper') this.chests.delete(`${x},${y},${z}`);
      if (kind === 'brewing') this.brewing.delete(`${x},${y},${z}`);
      if (kind === 'furnace' && !(furnaceLike(prev) && furnaceLike(id))) this.furnaces.delete(`${x},${y},${z}`);
    }
    // rails : raccordement automatique aux voisins (pose, casse)
    if (!this.dripBusy && (isRailKey(BlockRegistry.get(id).key) || (prev > 0 && isRailKey(BlockRegistry.get(prev).key)))) {
      this.dripBusy = true;
      updateRailsAround(this, x, y, z);
      this.dripBusy = false;
    }
    // spéléothèmes : segments recalculés quand la colonne (ou son support) change
    if (!this.dripBusy && (BlockRegistry.get(id).key === 'pointed_dripstone' || BlockRegistry.get(Math.max(0, prev)).key === 'pointed_dripstone' || id === 0)) {
      this.dripBusy = true;
      updateDripstoneColumn(this, x, y, z);
      if (id === 0) {
        updateDripstoneColumn(this, x, y - 1, z);
        updateDripstoneColumn(this, x, y + 1, z);
      }
      this.dripBusy = false;
    }
    // entonnoir, distributeur, dropper posés : inventaire créé tout de suite (ils agissent même vides)
    if (id > 0 && prev !== id) {
      const kind = BlockRegistry.get(id).interact;
      if (kind === 'hopper') this.getChest(x, y, z, true, 5);
      else if (kind === 'dispenser') this.getChest(x, y, z, true, 9);
    }
    if ((prev === B.SPAWNER || prev === B.BOSS_ALTAR) && id !== prev) this.specials.delete(`${x},${y},${z}`);
    if (scheduleUpdates) {
      this.scheduleUpdate(x, y, z);
      this.scheduleUpdate(x + 1, y, z);
      this.scheduleUpdate(x - 1, y, z);
      this.scheduleUpdate(x, y + 1, z);
      this.scheduleUpdate(x, y - 1, z);
      this.scheduleUpdate(x, y, z + 1);
      this.scheduleUpdate(x, y, z - 1);
    }
    this.events.emit('blockChanged', { x, y, z, prev, id, meta });
    return true;
  }

  setMeta(x: number, y: number, z: number, meta: number) {
    const b = this.getBlock(x, y, z);
    if (b < 0) return;
    this.setBlock(x, y, z, b, meta, false);
  }

  scheduleUpdate(x: number, y: number, z: number) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.updateQueue.push(x, y, z);
  }

  private markDirty(x: number, z: number, lx: number, lz: number, lightChange: boolean) {
    const c = this.chunkAt(x, z)!;
    c.dirty = true;
    c.urgent = true;
    const near = (d: number) => d <= 1;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        if (!n) continue;
        const edgeX = dx === 0 || (dx < 0 ? near(lx) : near(15 - lx));
        const edgeZ = dz === 0 || (dz < 0 ? near(lz) : near(15 - lz));
        if (edgeX && edgeZ) {
          n.dirty = true;
          n.urgent = true;
        } else if (lightChange) n.dirty = true;
      }
  }

  getFurnace(x: number, y: number, z: number, create = true): FurnaceState | null {
    const k = `${x},${y},${z}`;
    let f = this.furnaces.get(k);
    if (!f && create) {
      f = newFurnace();
      this.furnaces.set(k, f);
    }
    return f ?? null;
  }

  /**
   * Boîte de shulker cassée : l'objet garde son contenu (méta « items »), comme le jeu original.
   * Retourne null si ce n'est pas une boîte de shulker.
   */
  shulkerItem(x: number, y: number, z: number): ItemStack | null {
    const b = BlockRegistry.get(this.getBlock(x, y, z));
    if (!b.key.endsWith('shulker_box')) return null;
    const inv = this.getChest(x, y, z, false);
    const items = inv?.slots.some((s) => s) ? inv.serialize().slots : null;
    return { id: b.key, count: 1, ...(items ? { meta: { items } } : {}) };
  }

  /** Objets contenus dans le conteneur en (x, y, z) : coffre, tonneau, shulker, fourneaux. */
  containerItems(x: number, y: number, z: number): ItemStack[] {
    const kind = BlockRegistry.get(this.getBlock(x, y, z)).interact;
    // boîte de shulker : son contenu reste dans l'objet (voir shulkerItem)
    if (BlockRegistry.get(this.getBlock(x, y, z)).key.endsWith('shulker_box')) return [];
    if (kind === 'chest' || kind === 'dispenser' || kind === 'hopper') return (this.getChest(x, y, z, false)?.slots ?? []).filter((s) => !!s) as ItemStack[];
    if (kind === 'brewing') {
      const b = this.brewing.get(`${x},${y},${z}`);
      return b ? ([...b.bottles, b.ingredient, b.fuelItem].filter((s) => !!s) as ItemStack[]) : [];
    }
    if (kind === 'furnace') {
      const f = this.getFurnace(x, y, z, false);
      return f ? [f.input, f.fuel, f.output].filter((s) => !!s) as ItemStack[] : [];
    }
    return [];
  }

  getBrewing(x: number, y: number, z: number, create = true): BrewingState | null {
    const k = `${x},${y},${z}`;
    let b = this.brewing.get(k);
    if (!b && create) this.brewing.set(k, (b = newBrewing()));
    return b ?? null;
  }

  /** Inventaire d'un conteneur (coffre 27 cases, distributeur 9, entonnoir 5). */
  getChest(x: number, y: number, z: number, create = true, size = 27): Inventory | null {
    const k = `${x},${y},${z}`;
    let inv = this.chests.get(k);
    if (!inv && create) {
      inv = new Inventory(size);
      this.chests.set(k, inv);
    }
    return inv ?? null;
  }
}
