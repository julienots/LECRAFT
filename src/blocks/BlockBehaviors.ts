import { BlockRegistry, B } from './BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemStack } from '../inventory/Item';
import { makeStack } from '../inventory/Inventory';
import type { World } from '../world/World';
import { LOOT } from '../world/StructureGenerator';
import { Rng } from '../util/math';

/** Temps de minage en secondes (Infinity = incassable). */
export function breakTime(blockId: number, itemId: string | undefined, creative: boolean, underwater: boolean): number {
  const b = BlockRegistry.get(blockId);
  if (creative) return 0.05;
  if (b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0.05;
  const tool = itemId ? ItemRegistry.get(itemId)?.tool : undefined;
  const correct = !!tool && !!b.tool && tool.type === b.tool;
  const harvest = canHarvest(blockId, itemId);
  let speed = correct ? tool!.speed : 1;
  if (tool?.type === 'sword' && (b.render === 'cutout' || b.key === 'cactus')) speed = 1.5;
  let t = (b.hardness * (harvest ? 1.5 : 5)) / speed;
  if (underwater) t *= 3;
  return Math.max(0.05, t);
}

export function canHarvest(blockId: number, itemId: string | undefined): boolean {
  const b = BlockRegistry.get(blockId);
  if (b.minTier <= 0) return true;
  const tool = itemId ? ItemRegistry.get(itemId)?.tool : undefined;
  return !!tool && tool.type === b.tool && tool.tier >= b.minTier;
}

/** Objets obtenus en cassant un bloc. */
export function getDrops(blockId: number, meta: number, itemId: string | undefined, rng: () => number = Math.random): ItemStack[] {
  const b = BlockRegistry.get(blockId);
  if (!canHarvest(blockId, itemId)) return [];
  const out: ItemStack[] = [];
  const add = (id: string, n: number) => n > 0 && ItemRegistry.has(id) && out.push(makeStack(id, n));
  if (blockId === B.WHEAT) {
    if (meta >= 7) {
      add('wheat', 1);
      add('seeds', 1 + Math.floor(rng() * 3));
    } else add('seeds', 1);
    return out;
  }
  if (blockId === B.CARROTS) {
    add('carrot', meta >= 3 ? 2 + Math.floor(rng() * 3) : 1);
    return out;
  }
  for (const d of b.drops) {
    if (d.chance !== undefined && rng() > d.chance) continue;
    const min = d.min ?? 1, max = d.max ?? min;
    add(d.item, min + Math.floor(rng() * (max - min + 1)));
  }
  return out;
}

/** XP donnée par certains blocs (minerais). */
export function blockXp(blockId: number): number {
  switch (blockId) {
    case B.COAL_ORE: return 1;
    case B.COPPER_ORE: return 1;
    case B.IRON_ORE: return 2;
    case B.GOLD_ORE: return 3;
    case B.CRYSTAL_ORE: return 5;
    case B.AURITE_ORE: return 8;
    default: return 0;
  }
}

/** Vérifie qu'un bloc peut tenir à cet endroit (plantes, torches...). */
export function hasSupport(world: World, x: number, y: number, z: number, blockId: number): boolean {
  const b = BlockRegistry.get(blockId);
  if (!b.needsSupport) return true;
  const below = world.getBlock(x, y - 1, z);
  if (below < 0) return true;
  if (b.supportBlocks) return b.supportBlocks.some((k) => BlockRegistry.byName(k).id === below);
  if (b.key === 'torch') {
    if (BlockRegistry.solid[below]) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (world.isSolid(x + dx, y, z + dz)) return true;
    return false;
  }
  return BlockRegistry.solid[below] === 1;
}

interface LootEntry {
  item: string;
  min: number;
  max: number;
  weight: number;
}
const T = (item: string, min: number, max: number, weight: number): LootEntry => ({ item, min, max, weight });
const LOOT_TABLES: Record<number, { rolls: [number, number]; entries: LootEntry[] }> = {
  [LOOT.VILLAGE]: { rolls: [3, 6], entries: [T('bread', 1, 3, 10), T('apple', 1, 3, 8), T('wheat', 2, 6, 8), T('carrot', 1, 4, 6), T('iron_ingot', 1, 3, 4), T('torch', 2, 8, 6), T('seeds', 2, 6, 6), T('compass_village', 1, 1, 1), T('stone_pickaxe', 1, 1, 2), T('leather', 1, 3, 4)] },
  [LOOT.RUINS]: { rolls: [2, 5], entries: [T('coal', 1, 6, 10), T('copper_ingot', 1, 3, 6), T('iron_ingot', 1, 2, 4), T('bone', 1, 4, 6), T('string', 1, 3, 5), T('gold_ingot', 1, 2, 2), T('ancient_relic', 1, 1, 1), T('flint', 1, 3, 4)] },
  [LOOT.TOWER]: { rolls: [3, 6], entries: [T('arrow', 4, 12, 8), T('bow', 1, 1, 3), T('iron_ingot', 1, 4, 6), T('gold_ingot', 1, 3, 4), T('iron_helmet', 1, 1, 2), T('iron_sword', 1, 1, 2), T('crystal_shard', 1, 2, 2), T('compass_golem', 1, 1, 2)] },
  [LOOT.TEMPLE]: { rolls: [4, 7], entries: [T('gold_ingot', 2, 6, 8), T('iron_ingot', 2, 5, 6), T('crystal_shard', 1, 3, 4), T('ancient_relic', 1, 1, 3), T('gold_sword', 1, 1, 2), T('bone', 2, 6, 6), T('raw_aurite', 1, 2, 2), T('compass_golem', 1, 1, 2)] },
  [LOOT.MINE]: { rolls: [3, 6], entries: [T('coal', 3, 10, 10), T('raw_iron', 1, 4, 8), T('raw_copper', 2, 6, 8), T('torch', 4, 12, 6), T('iron_pickaxe', 1, 1, 2), T('raw_gold', 1, 3, 3), T('bread', 1, 3, 4), T('crystal_shard', 1, 2, 2)] },
  [LOOT.DUNGEON]: { rolls: [4, 8], entries: [T('iron_ingot', 2, 6, 8), T('gold_ingot', 1, 4, 6), T('bone', 2, 6, 6), T('string', 2, 5, 5), T('crystal_shard', 1, 3, 4), T('raw_aurite', 1, 2, 3), T('ancient_relic', 1, 1, 3), T('iron_chestplate', 1, 1, 2), T('compass_golem', 1, 1, 3), T('arrow', 4, 10, 4), T('cooked_meat', 2, 5, 5)] },
  [LOOT.BOSS]: { rolls: [5, 8], entries: [T('aurite_ingot', 2, 5, 8), T('crystal_shard', 3, 8, 8), T('gold_block', 1, 2, 4), T('ancient_relic', 1, 2, 5), T('aurite_sword', 1, 1, 2), T('aurite_helmet', 1, 1, 2)] },
  [LOOT.CAMP]: { rolls: [2, 5], entries: [T('cooked_meat', 1, 4, 8), T('bread', 1, 3, 6), T('torch', 2, 6, 6), T('coal', 2, 6, 6), T('leather', 1, 3, 4), T('copper_ingot', 1, 3, 4)] },
};

/** Génère le contenu d'un coffre de structure de façon déterministe (seed + position). */
export function rollLoot(table: number, seed: number): ItemStack[] {
  const t = LOOT_TABLES[table];
  if (!t) return [];
  const rng = new Rng(seed);
  const entries = t.entries.filter((e) => e.weight > 0 && ItemRegistry.has(e.item));
  const total = entries.reduce((a, e) => a + e.weight, 0);
  const n = rng.int(t.rolls[0], t.rolls[1]);
  const out: ItemStack[] = [];
  for (let i = 0; i < n; i++) {
    let r = rng.next() * total;
    for (const e of entries) {
      r -= e.weight;
      if (r < 0) {
        out.push(makeStack(e.item, rng.int(e.min, e.max)));
        break;
      }
    }
  }
  return out;
}
