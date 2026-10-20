import { enchantRandomly, randomEnchantedBook } from '../inventory/Enchantments';
import { BlockRegistry, B } from './BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemStack } from '../inventory/Item';
import { makeStack } from '../inventory/Inventory';
import type { World } from '../world/World';
import { LOOT } from '../world/StructureGenerator';
import { MORE_LOOT, MORE_LOOT_TABLES } from '../world/MoreStructures';
import { VANILLA_CHEST_LOOT, type LootPool } from '../data/vanillaLoot';
import { Rng } from '../util/math';
import { FACING_DIR } from './Shapes';

/** Feuilles (outil réel : cisailles ou houe ; épée efficace). */
const isLeaves = (key: string) => key.endsWith('_leaves');

/**
 * Temps de minage en secondes (Infinity = incassable), formule du jeu original :
 * vitesse de l'outil (bois 2, pierre 4, fer 6, diamant 8, netherite 9, or 12) si c'est le bon type
 * d'outil, + Efficacité (niveau² + 1) ; dureté × 1,5 si le bloc peut être récolté, × 5 sinon ;
 * × 5 sous l'eau (sans Affinité aquatique) et × 5 en l'air ; Célérité +20 %/niveau,
 * Fatigue ×0,3 / ×0,09 / ×0,0027 / ×0,00081 ; arrondi au tick (1/20 s).
 */
export function breakTime(blockId: number, itemId: string | undefined, creative: boolean, underwater: boolean, efficiency = 0, airborne = false, haste = 0, fatigue = 0): number {
  const b = BlockRegistry.get(blockId);
  if (creative) return 0.05;
  if (b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0.05;
  const tool = itemId ? ItemRegistry.get(itemId)?.tool : undefined;
  const correct = !!tool && !!b.tool && (tool.type === b.tool || (tool.type === 'hoe' && isLeaves(b.key)));
  const harvest = canHarvest(blockId, itemId);
  let speed = correct ? tool!.speed : 1;
  // cisailles : 15 sur les feuilles et la toile, 5 sur la laine ; épée : 15 sur la toile, 1,5 sur les plantes
  if (tool?.type === 'shears') {
    if (isLeaves(b.key) || b.key === 'cobweb') speed = 15;
    else if (b.key.endsWith('_wool')) speed = 5;
    else if (b.key === 'vine' || b.key === 'glow_lichen') speed = 2;
  } else if (tool?.type === 'sword') {
    if (b.key === 'cobweb') speed = 15;
    else if (b.render === 'cutout' || b.render === 'cross' || b.key === 'cactus' || b.key === 'pumpkin' || b.key === 'melon' || isLeaves(b.key)) speed = 1.5;
  }
  // Efficacité : seulement avec un outil efficace (vitesse > 1)
  if (efficiency > 0 && speed > 1) speed += efficiency * efficiency + 1;
  if (haste > 0) speed *= 1 + 0.2 * haste;
  if (fatigue > 0) speed *= [0.3, 0.09, 0.0027, 0.00081][Math.min(fatigue, 4) - 1];
  if (underwater) speed /= 5;
  if (airborne) speed /= 5;
  // dégâts par tick ≥ 1 : cassé instantanément
  const perTick = speed / b.hardness / (harvest ? 30 : 100);
  if (perTick >= 1) return 0.05;
  return Math.max(0.05, Math.ceil(1 / perTick) / 20);
}

export function canHarvest(blockId: number, itemId: string | undefined): boolean {
  const b = BlockRegistry.get(blockId);
  if (b.minTier <= 0) return true;
  const tool = itemId ? ItemRegistry.get(itemId)?.tool : undefined;
  // toile d'araignée : épée ou cisailles
  if (b.key === 'cobweb' && tool?.type === 'shears') return true;
  return !!tool && tool.type === b.tool && tool.tier >= b.minTier;
}

/** Blocs que le Toucher de soie ne permet pas d'obtenir dans le jeu original. */
const NO_SILK = new Set(['spawner', 'budding_amethyst', 'reinforced_deepslate', 'vault', 'trial_spawner', 'powder_snow', 'farmland', 'dirt_path', 'snowy_grass_block', 'lit_furnace', 'frosted_ice']);
/** Chances par niveau de Fortune (0 à 3) : pousses, bâtons, pommes, silex (jeu original). */
const SAPLING_CHANCE = [1 / 20, 1 / 16, 1 / 12, 1 / 10];
const SAPLING_CHANCE_JUNGLE = [1 / 40, 1 / 36, 1 / 32, 1 / 24];
const STICK_CHANCE = [1 / 50, 1 / 45, 1 / 40, 1 / 30];
const APPLE_CHANCE = [1 / 200, 1 / 180, 1 / 160, 1 / 120];
const FLINT_CHANCE = [0.1, 1 / 7, 0.25, 1];
/** Fortune « bonus uniforme » (+0..niveau) plafonné : redstone, pierre lumineuse, pastèque, lanterne aquatique. */
const UNIFORM_BONUS: Record<string, number> = { redstone_ore: 99, deepslate_redstone_ore: 99, glowstone: 4, melon: 9, sea_lantern: 5 };

/** Objets obtenus en cassant un bloc. */
export function getDrops(blockId: number, meta: number, itemId: string | undefined, rng: () => number = Math.random, ench?: Record<string, number>): ItemStack[] {
  const b = BlockRegistry.get(blockId);
  if (!canHarvest(blockId, itemId)) return [];
  // Toucher de soie : le bloc lui-même (minerais, verre, herbe…), sauf blocs en deux parties
  if (ench?.silk_touch && ItemRegistry.has(b.key) && !NO_SILK.has(b.key) && !b.def.doublePlant && b.shape !== 'door' && b.shape !== 'bed' && b.shape !== 'slab' && b.interact !== 'chest') return [makeStack(b.key, 1)];
  // plante haute : seule la moitié basse donne quelque chose (la haute la fait tomber)
  if (b.def.doublePlant && meta & 1) return [];
  const out: ItemStack[] = [];
  const add = (id: string, n: number) => n > 0 && ItemRegistry.has(id) && out.push(makeStack(id, n));
  const tool = itemId ? ItemRegistry.get(itemId)?.tool : undefined;
  // cisailles : feuilles, herbes, toiles... récupérées telles quelles
  if (tool?.type === 'shears' && (b.key.endsWith('_leaves') || b.key === 'short_grass' || b.key === 'fern' || b.key === 'tall_grass' || b.key === 'large_fern' || b.key === 'dead_bush' || b.key === 'glow_lichen' || b.key === 'cobweb' || b.key === 'vine' || b.key === 'seagrass' || b.key === 'hanging_roots')) {
    add(b.key, 1);
    return out;
  }
  // cultures mûres : 1 + loi binomiale (3 + Fortune essais, p = 4/7), comme le jeu original
  const cropFortune = Math.min(3, ench?.fortune ?? 0);
  const binom = (n: number) => {
    let k = 0;
    for (let i = 0; i < n; i++) if (rng() < 4 / 7) k++;
    return k;
  };
  if (blockId === B.WHEAT) {
    if (meta >= 7) {
      add('wheat', 1);
      add('wheat_seeds', 1 + binom(3 + cropFortune));
    } else add('wheat_seeds', 1);
    return out;
  }
  if (blockId === B.CARROTS || blockId === B.POTATOES) {
    const ripe = meta >= 3;
    const crop = blockId === B.CARROTS ? 'carrot' : 'potato';
    add(crop, ripe ? 1 + binom(3 + cropFortune) : 1);
    if (ripe && crop === 'potato' && rng() < 0.02) add('poisonous_potato', 1);
    return out;
  }
  // porte : seule la moitié basse donne l'objet ; lit : seul le pied
  if (b.shape === 'door') {
    if (!(meta & 8)) add(b.key, 1);
    return out;
  }
  if (b.shape === 'bed') {
    if (!(meta & 4)) add(b.key, 1);
    return out;
  }
  if (b.shape === 'slab') {
    add(b.key, (meta & 3) === 2 ? 2 : 1);
    return out;
  }
  if (b.shape === 'snow_layer') {
    if (tool?.type === 'shovel') add('snowball', (meta & 7) + 1);
    return out;
  }
  // Fortune : minerais qui lâchent un objet (charbon, diamant, lapis…) multipliés
  const fortune = Math.min(3, ench?.fortune ?? 0);
  // feuilles : pousse, bâtons, pommes (chances augmentées par Fortune, comme le jeu original)
  if (isLeaves(b.key)) {
    for (const d of b.drops) {
      let chance = d.chance ?? 1;
      if (d.item.endsWith('_sapling') || d.item.endsWith('_propagule')) chance = (chance < 0.04 ? SAPLING_CHANCE_JUNGLE : SAPLING_CHANCE)[fortune];
      else if (d.item === 'stick') chance = STICK_CHANCE[fortune];
      else if (d.item === 'apple') chance = APPLE_CHANCE[fortune];
      if (rng() >= chance) continue;
      const min = d.min ?? 1, max = d.max ?? min;
      add(d.item, min + Math.floor(rng() * (max - min + 1)));
    }
    return out;
  }
  // gravier : silex 10 % (14 %, 25 %, 100 % avec Fortune), sinon le gravier
  if (blockId === B.GRAVEL) {
    add(rng() < FLINT_CHANCE[fortune] ? 'flint' : 'gravel', 1);
    return out;
  }
  for (const d of b.drops) {
    if (d.chance !== undefined && rng() > d.chance) continue;
    const min = d.min ?? 1, max = d.max ?? min;
    let n = min + Math.floor(rng() * (max - min + 1));
    if (fortune && d.item !== b.key) {
      const cap = UNIFORM_BONUS[b.key];
      if (cap !== undefined) n = Math.min(cap, n + Math.floor(rng() * (fortune + 1)));
      // minerais (charbon, cuivre, fer, or, diamant, émeraude, lapis, quartz) : ×max(1, aléa(0..niveau+1))
      else if (b.key.includes('_ore')) n *= Math.max(1, Math.floor(rng() * (fortune + 2)));
    }
    add(d.item, n);
  }
  return out;
}

/** XP donnée par les blocs du jeu original (minerais, générateur, sculk) : [min, max]. Les minerais bruts (fer, or, cuivre) n'en donnent pas. */
const BLOCK_XP: Record<string, [number, number]> = {
  coal_ore: [0, 2], deepslate_coal_ore: [0, 2], diamond_ore: [3, 7], deepslate_diamond_ore: [3, 7], emerald_ore: [3, 7], deepslate_emerald_ore: [3, 7],
  lapis_ore: [2, 5], deepslate_lapis_ore: [2, 5], redstone_ore: [1, 5], deepslate_redstone_ore: [1, 5], nether_quartz_ore: [2, 5], nether_gold_ore: [0, 1],
  spawner: [15, 43], sculk: [1, 1], sculk_catalyst: [5, 5], sculk_shrieker: [5, 5], sculk_sensor: [5, 5], calibrated_sculk_sensor: [5, 5],
};

/** XP donnée par certains blocs (minerais). */
export function blockXp(blockId: number, rng: () => number = Math.random): number {
  const r = BLOCK_XP[BlockRegistry.get(blockId).key];
  return r ? r[0] + Math.floor(rng() * (r[1] - r[0] + 1)) : 0;
}

/** Vérifie qu'un bloc peut tenir à cet endroit (plantes, torches...). */
/** Sol accepté sous une plante. */
export function plantSoil(b: { supportBlocks: string[] | null }, below: number) {
  if (!b.supportBlocks) return BlockRegistry.solid[below] === 1;
  return b.supportBlocks.some((k) => BlockRegistry.has(k) && BlockRegistry.byName(k).id === below);
}

export function hasSupport(world: World, x: number, y: number, z: number, blockId: number): boolean {
  const b = BlockRegistry.get(blockId);
  if (!b.needsSupport) return true;
  const below = world.getBlock(x, y - 1, z);
  if (below < 0) return true;
  if (b.def.doublePlant) {
    // moitié haute : la moitié basse dessous ; moitié basse : le sol dessous et la moitié haute dessus
    if (world.getMeta(x, y, z) & 1) return below === blockId;
    const above = world.getBlock(x, y + 1, z);
    return plantSoil(b, below) && (above < 0 || above === blockId);
  }
  if (b.supportBlocks) return plantSoil(b, below);
  if (b.shape === 'lever' || b.shape === 'button') {
    // au sol : bloc plein dessous ; au mur : bloc plein derrière (comme les torches murales)
    const att = world.getMeta(x, y, z) & 7;
    if (att === 0) return BlockRegistry.solid[below] === 1;
    const [dx, dz] = FACING_DIR[(att - 1) & 3];
    return world.isSolid(x + dx, y, z + dz);
  }
  if (b.shape === 'torch' || b.shape === 'ladder') {
    const meta = world.getMeta(x, y, z);
    // torche murale / échelle : bloc solide derrière (sens opposé à l'orientation)
    const facing = b.shape === 'torch' ? meta - 1 : meta & 3;
    if (b.shape === 'torch' && meta === 0) return BlockRegistry.solid[below] === 1;
    const [dx, dz] = FACING_DIR[facing & 3];
    return world.isSolid(x + dx, y, z + dz);
  }
  if (b.shape === 'bed') {
    const meta = world.getMeta(x, y, z);
    const [dx, dz] = FACING_DIR[meta & 3];
    const s = meta & 4 ? -1 : 1;
    return world.getBlock(x + dx * s, y, z + dz * s) === blockId;
  }
  if (b.shape === 'door') {
    const meta = world.getMeta(x, y, z);
    if (meta & 8) return world.getBlock(x, y - 1, z) === blockId;
    return BlockRegistry.solid[below] === 1 && world.getBlock(x, y + 1, z) === blockId;
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
  [LOOT.VILLAGE]: { rolls: [3, 6], entries: [T('bread', 1, 3, 10), T('apple', 1, 3, 8), T('wheat', 2, 6, 8), T('carrot', 1, 4, 6), T('potato', 1, 4, 6), T('iron_ingot', 1, 3, 4), T('torch', 2, 8, 6), T('wheat_seeds', 2, 6, 6), T('emerald', 1, 2, 2), T('oak_sapling', 1, 2, 4), T('stone_pickaxe', 1, 1, 2), T('leather', 1, 3, 4)] },
  [LOOT.RUINS]: { rolls: [2, 5], entries: [T('coal', 1, 6, 10), T('copper_ingot', 1, 3, 6), T('iron_ingot', 1, 2, 4), T('bone', 1, 4, 6), T('string', 1, 3, 5), T('gold_ingot', 1, 2, 2), T('ancient_relic', 1, 1, 1), T('flint', 1, 3, 4), T('gold_nugget', 2, 6, 4)] },
  [LOOT.TOWER]: { rolls: [3, 6], entries: [T('arrow', 4, 12, 8), T('bow', 1, 1, 3), T('iron_ingot', 1, 4, 6), T('gold_ingot', 1, 3, 4), T('iron_helmet', 1, 1, 2), T('iron_sword', 1, 1, 2), T('diamond', 1, 2, 2), T('compass_golem', 1, 1, 2), T('enchanted_book', 1, 1, 3)] },
  [LOOT.TEMPLE]: { rolls: [4, 7], entries: [T('gold_ingot', 2, 6, 8), T('iron_ingot', 2, 5, 6), T('emerald', 1, 3, 4), T('diamond', 1, 3, 3), T('ancient_relic', 1, 1, 3), T('golden_sword', 1, 1, 2), T('enchanted_book', 1, 1, 4), T('bone', 2, 6, 6), T('rotten_flesh', 2, 6, 6), T('golden_apple', 1, 1, 1), T('compass_golem', 1, 1, 2)] },
  [LOOT.MINE]: { rolls: [3, 6], entries: [T('coal', 3, 10, 10), T('raw_iron', 1, 4, 8), T('raw_copper', 2, 6, 8), T('torch', 4, 12, 6), T('iron_pickaxe', 1, 1, 2), T('raw_gold', 1, 3, 3), T('bread', 1, 3, 4), T('lapis_lazuli', 4, 9, 3), T('redstone', 4, 9, 3), T('diamond', 1, 2, 1), T('enchanted_book', 1, 1, 3)] },
  [LOOT.DUNGEON]: { rolls: [4, 8], entries: [T('iron_ingot', 2, 6, 8), T('gold_ingot', 1, 4, 6), T('bone', 2, 6, 6), T('string', 2, 5, 5), T('gunpowder', 1, 4, 5), T('rotten_flesh', 2, 6, 6), T('wheat', 2, 4, 5), T('bucket', 1, 1, 3), T('ancient_relic', 1, 1, 3), T('iron_chestplate', 1, 1, 2), T('golden_apple', 1, 1, 2), T('compass_golem', 1, 1, 3), T('arrow', 4, 10, 4), T('bread', 2, 5, 5), T('enchanted_book', 1, 1, 5)] },
  [LOOT.PAPER]: { rolls: [3, 6], entries: [T('paper', 4, 16, 10), T('graphite', 2, 6, 8), T('origami_fruit', 1, 4, 8), T('quill', 1, 1, 3), T('giant_scissors', 1, 1, 2), T('paper_crown', 1, 1, 1), T('graphite_pickaxe', 1, 1, 2), T('red_paper', 2, 8, 4), T('paper_lantern', 1, 3, 4), T('diamond', 1, 2, 2)] },
  [LOOT.FORTRESS]: { rolls: [2, 5], entries: [T('diamond', 1, 3, 5), T('iron_ingot', 1, 5, 5), T('gold_ingot', 1, 3, 15), T('golden_sword', 1, 1, 5), T('saddle', 1, 1, 10), T('flint_and_steel', 1, 1, 5), T('nether_wart', 3, 7, 5), T('obsidian', 2, 4, 2), T('blaze_rod', 1, 2, 3)] },
  [LOOT.BOSS]: { rolls: [5, 8], entries: [T('diamond', 2, 5, 8), T('emerald', 3, 8, 8), T('gold_block', 1, 2, 4), T('ancient_relic', 1, 2, 5), T('diamond_sword', 1, 1, 2), T('diamond_helmet', 1, 1, 2), T('golden_apple', 1, 2, 3)] },
  [LOOT.CAMP]: { rolls: [2, 5], entries: [T('cooked_beef', 1, 4, 8), T('bread', 1, 3, 6), T('torch', 2, 6, 6), T('coal', 2, 6, 6), T('leather', 1, 3, 4), T('copper_ingot', 1, 3, 4)] },
  // pyramide, temple de la jungle, igloo, épaves, ruines sous-marines, portail en ruine, avant-poste
  ...MORE_LOOT_TABLES,
};

/**
 * Coffres dont la table officielle (plusieurs tirages indépendants) remplace la table simplifiée.
 * Le donjon garde en plus le contenu propre à LeCraft (relique, boussole du golem).
 */
const OFFICIAL_CHESTS: Record<number, { table: string; extra?: LootPool[] }> = {
  [LOOT.DUNGEON]: { table: 'simple_dungeon', extra: [[[0, 1], [['ancient_relic', 3, 1, 1], ['compass_golem', 3, 1, 1], ['', 4, 0, 0]]]] },
  [LOOT.MINE]: { table: 'abandoned_mineshaft' },
  [LOOT.FORTRESS]: { table: 'nether_bridge' },
  [MORE_LOOT.DESERT_PYRAMID]: { table: 'desert_pyramid' },
  [MORE_LOOT.JUNGLE_TEMPLE]: { table: 'jungle_temple' },
  [MORE_LOOT.IGLOO]: { table: 'igloo_chest' },
  [MORE_LOOT.SHIPWRECK_MAP]: { table: 'shipwreck' },
  [MORE_LOOT.SHIPWRECK_SUPPLY]: { table: 'shipwrecksupply' },
  [MORE_LOOT.SHIPWRECK_TREASURE]: { table: 'shipwrecktreasure' },
  [MORE_LOOT.OCEAN_RUIN_SMALL]: { table: 'underwater_ruin_small' },
  [MORE_LOOT.OCEAN_RUIN_BIG]: { table: 'underwater_ruin_big' },
  [MORE_LOOT.RUINED_PORTAL]: { table: 'ruined_portal' },
  [MORE_LOOT.OUTPOST]: { table: 'pillager_outpost' },
};

/** Tire les pools d'une table officielle (objets absents ignorés). */
function rollPools(pools: LootPool[], rng: Rng): ItemStack[] {
  const out: ItemStack[] = [];
  for (const [[rmin, rmax], all] of pools) {
    const entries = all.filter(([id, w]) => w > 0 && (id === '' || ItemRegistry.has(id)));
    const total = entries.reduce((a, e) => a + e[1], 0);
    const n = rng.int(rmin, rmax);
    for (let i = 0; i < n && total > 0; i++) {
      let r = rng.next() * total;
      for (const [id, w, min, max, flags = 0] of entries) {
        r -= w;
        if (r >= 0) continue;
        if (!id) break;
        if (id === 'enchanted_book') out.push(randomEnchantedBook(true, () => rng.next()));
        else {
          let st = makeStack(id, rng.int(min, max));
          const dur = ItemRegistry.maxDurability(id);
          if (flags & 2 && dur > 0) st.durability = Math.max(1, Math.round(dur * (0.15 + rng.next() * 0.65)));
          if (flags & 1) st = enchantRandomly(st, 30, () => rng.next());
          out.push(st);
        }
        break;
      }
    }
  }
  return out;
}

/** Génère le contenu d'un coffre de structure de façon déterministe (seed + position). */
export function rollLoot(table: number, seed: number): ItemStack[] {
  const off = OFFICIAL_CHESTS[table];
  if (off && VANILLA_CHEST_LOOT[off.table]) return rollPools([...VANILLA_CHEST_LOOT[off.table], ...(off.extra ?? [])], new Rng(seed));
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
        // livre enchanté : un enchantement au hasard (trésors compris), comme le jeu original
        out.push(e.item === 'enchanted_book' ? randomEnchantedBook(true, () => rng.next()) : makeStack(e.item, rng.int(e.min, e.max)));
        break;
      }
    }
  }
  return out;
}
