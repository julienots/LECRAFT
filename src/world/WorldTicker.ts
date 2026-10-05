import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { hooks } from '../scripting/Hooks';
import { hasSupport, getDrops } from '../blocks/BlockBehaviors';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/Config';
import type { GameContext } from '../core/GameContext';
import type { EntitySpawner } from '../entities/Mob';
import { buildTree } from './Trees';
import { FluidSimulator } from './FluidSimulator';
import { idx } from './ChunkData';
import { updatedConnectionMeta } from '../addons/BlockRuntime';
import type { TreeType } from '../data/biomes';

const IS_LOG = new Uint8Array(BlockRegistry.blocks.length);
const IS_LEAVES = new Uint8Array(BlockRegistry.blocks.length);
for (const b of BlockRegistry.blocks) {
  if (b.key.endsWith('_log')) IS_LOG[b.id] = 1;
  if (b.key.endsWith('_leaves')) IS_LEAVES[b.id] = 1;
}

const SAPLING_TREES: Record<string, TreeType> = { oak_sapling: 'oak', spruce_sapling: 'spruce', birch_sapling: 'birch', jungle_sapling: 'jungle', acacia_sapling: 'acacia', dark_oak_sapling: 'dark_oak' };

/**
 * Mises à jour du monde à 20 Hz :
 * - file des mises à jour voisines (liquides, gravité du sable/gravier, plantes sans support)
 * - ticks aléatoires (croissance des cultures selon lumière/eau/pluie, pousses → arbres,
 *   propagation de l'herbe, hydratation de la terre cultivable)
 */
export class WorldTicker {
  readonly fluids = new FluidSimulator();
  randomTicksPerChunk = 12;

  /** Feuilles à vérifier (décomposition après la coupe d'un tronc), avec délai aléatoire. */
  private decay: { x: number; y: number; z: number; t: number }[] = [];

  /** Branché par la session : démarre la chute animée d'un bloc. */
  onFall: ((x: number, y: number, z: number, id: number) => void) | null = null;

  constructor(private spawner: EntitySpawner) {}

  /** Appelé à chaque modification de bloc : un tronc retiré programme la vérification des feuilles voisines. */
  blockChanged(e: { x: number; y: number; z: number; prev: number; id: number }, world: { getBlock(x: number, y: number, z: number): number }) {
    if (!IS_LOG[e.prev] || e.id === e.prev) return;
    for (let dy = -4; dy <= 5; dy++)
      for (let dz = -5; dz <= 5; dz++)
        for (let dx = -5; dx <= 5; dx++) {
          const b = world.getBlock(e.x + dx, e.y + dy, e.z + dz);
          if (b > 0 && IS_LEAVES[b]) this.decay.push({ x: e.x + dx, y: e.y + dy, z: e.z + dz, t: 1 + Math.random() * 12 });
        }
    if (this.decay.length > 4000) this.decay.splice(0, this.decay.length - 4000);
  }

  /** Vrai si un tronc est atteignable à moins de 6 pas à travers les feuilles (règle du jeu de référence). */
  private connectedToLog(ctx: GameContext, x: number, y: number, z: number): boolean {
    const w = ctx.world;
    const seen = new Set<string>([`${x},${y},${z}`]);
    let frontier: [number, number, number][] = [[x, y, z]];
    for (let d = 0; d < 6 && frontier.length; d++) {
      const next: [number, number, number][] = [];
      for (const [cx, cy, cz] of frontier)
        for (const [ox, oy, oz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = cx + ox, ny = cy + oy, nz = cz + oz;
          const k = `${nx},${ny},${nz}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const b = w.getBlock(nx, ny, nz);
          if (b < 0) return true; // chunk non chargé : prudence
          if (IS_LOG[b]) return true;
          if (IS_LEAVES[b]) next.push([nx, ny, nz]);
        }
      frontier = next;
    }
    return false;
  }

  private tryDecay(ctx: GameContext, x: number, y: number, z: number) {
    const w = ctx.world;
    const id = w.getBlock(x, y, z);
    if (id <= 0 || !IS_LEAVES[id] || w.getMeta(x, y, z) & 1) return;
    if (this.connectedToLog(ctx, x, y, z)) return;
    w.setBlock(x, y, z, B.AIR);
    for (const d of getDrops(id, 0, undefined)) this.spawner.spawnItem(d.id, d.count, x + 0.5, y + 0.3, z + 0.5);
    if (Math.random() < 0.3) ctx.particles.blockBreak(x, y, z, id);
  }

  tick(ctx: GameContext) {
    const w = ctx.world;
    // 1) mises à jour voisines
    const q = w.updateQueue;
    w.updateQueue = [];
    const seen = new Set<string>();
    for (let i = 0; i < q.length; i += 3) {
      const x = q[i], y = q[i + 1], z = q[i + 2];
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      this.neighborUpdate(ctx, x, y, z);
    }
    // 2) liquides
    this.fluids.tick(w);
    // 2b) décomposition des feuilles (quelques vérifications par tick)
    if (this.decay.length) {
      let budget = 24;
      for (let i = this.decay.length - 1; i >= 0 && budget > 0; i--) {
        const d = this.decay[i];
        d.t -= 0.05;
        if (d.t > 0) continue;
        this.decay.splice(i, 1);
        budget--;
        this.tryDecay(ctx, d.x, d.y, d.z);
      }
    }
    // 3) ticks aléatoires autour du joueur
    const p = ctx.player;
    const R = ctx.profile.simulationDistance;
    const pcx = Math.floor(p.x / CHUNK_SIZE), pcz = Math.floor(p.z / CHUNK_SIZE);
    for (let cz = pcz - R; cz <= pcz + R; cz++)
      for (let cx = pcx - R; cx <= pcx + R; cx++) {
        const c = w.getChunk(cx, cz);
        if (!c) continue;
        let maxH = 0;
        for (let i = 0; i < 256; i += 17) maxH = Math.max(maxH, c.heights[i]);
        maxH = Math.min(WORLD_HEIGHT - 2, maxH + 8);
        for (let n = 0; n < this.randomTicksPerChunk; n++) {
          const lx = (Math.random() * 16) | 0, lz = (Math.random() * 16) | 0, y = 1 + ((Math.random() * maxH) | 0);
          const b = c.blocks[idx(lx, y, lz)];
          if (b === B.AIR || b === B.STONE) continue;
          this.randomTick(ctx, cx * CHUNK_SIZE + lx, y, cz * CHUNK_SIZE + lz, b);
        }
      }
  }

  private neighborUpdate(ctx: GameContext, x: number, y: number, z: number) {
    const w = ctx.world;
    const id = w.getBlock(x, y, z);
    if (id <= 0) return;
    const b = BlockRegistry.get(id);
    if (b.liquid) {
      this.fluids.schedule(x, y, z, id);
      return;
    }
    // gravité : le bloc devient une entité qui tombe (FallingBlocks)
    if (b.gravity) {
      const below = w.getBlock(x, y - 1, z);
      if (below === B.AIR || (below > 0 && (BlockRegistry.liquid[below] || BlockRegistry.replaceable[below]))) {
        if (this.onFall) this.onFall(x, y, z, id);
        return;
      }
    }
    // support (plantes, torches, cultures)
    if (b.needsSupport && !hasSupport(w, x, y, z, id)) {
      const meta = w.getMeta(x, y, z);
      w.setBlock(x, y, z, B.AIR);
      for (const d of getDrops(id, meta, undefined)) this.spawner.spawnItem(d.id, d.count, x + 0.5, y + 0.3, z + 0.5);
      return;
    }
    // blocs d'add-ons à connexions (barrières, murs…)
    if (b.def.bedrock?.placement.connections) {
      const m = updatedConnectionMeta(w, x, y, z, id);
      if (m !== null) w.setBlock(x, y, z, id, m, false);
    }
    // terre cultivable écrasée
    if (id === B.FARMLAND && BlockRegistry.solid[Math.max(0, w.getBlock(x, y + 1, z))]) w.setBlock(x, y, z, B.DIRT);
    // herbe recouverte
    if (id === B.GRASS_BLOCK && BlockRegistry.opaque[Math.max(0, w.getBlock(x, y + 1, z))]) w.setBlock(x, y, z, B.DIRT);
  }

  /** Lumière effective (0..15) d'une cellule (jour/nuit pris en compte). */
  private lightAt(ctx: GameContext, x: number, y: number, z: number) {
    const l = ctx.world.getLight(x, y, z);
    return Math.max(Math.round(l.sky * ctx.dayCycle.daylight), l.block);
  }

  private nearWater(ctx: GameContext, x: number, y: number, z: number) {
    const w = ctx.world;
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) for (let dy = 0; dy <= 1; dy++) if (w.getBlock(x + dx, y + dy, z + dz) === B.WATER) return true;
    return false;
  }

  /** Fait pousser une pousse en arbre (tick aléatoire ou poudre d'os). Retourne vrai si réussi. */
  growSapling(ctx: GameContext, x: number, y: number, z: number, id: number): boolean {
    const w = ctx.world;
    const kind = SAPLING_TREES[BlockRegistry.get(id).key];
    if (!kind) return false;
    for (let dy = 1; dy < 7; dy++) {
      const b = w.getBlock(x, y + dy, z);
      if (b !== B.AIR && b > 0 && !BlockRegistry.replaceable[b] && !BlockRegistry.get(b).key.endsWith('leaves')) return false;
    }
    w.setBlock(x, y, z, B.AIR, 0, false);
    w.setBlock(x, y - 1, z, B.DIRT, 0, false);
    buildTree(kind, x, y, z, (Math.random() * 1e9) | 0, (tx, ty, tz, b, onlyIfAir) => {
      const cur = w.getBlock(tx, ty, tz);
      if (cur < 0) return;
      if (onlyIfAir && cur !== B.AIR && !BlockRegistry.replaceable[cur]) return;
      w.setBlock(tx, ty, tz, b, 0, false);
    });
    ctx.particles.burst('hearts', x + 0.5, y + 1, z + 0.5, 3);
    ctx.stats.inc('treesGrown');
    return true;
  }

  private randomTick(ctx: GameContext, x: number, y: number, z: number, id: number) {
    if (hooks.randomTick && BlockRegistry.get(id).def.bedrock?.custom.length) hooks.randomTick(x, y, z, id);
    const w = ctx.world;
    const rain = ctx.raining();
    if (IS_LEAVES[id]) {
      if (Math.random() < 0.25) this.tryDecay(ctx, x, y, z);
      return;
    }
    if (SAPLING_TREES[BlockRegistry.get(id).key]) {
      if (this.lightAt(ctx, x, y, z) >= 9 && Math.random() < 0.12) this.growSapling(ctx, x, y, z, id);
      return;
    }
    switch (id) {
      case B.WHEAT:
      case B.CARROTS:
      case B.POTATOES: {
        const max = id === B.WHEAT ? 7 : 3;
        const meta = w.getMeta(x, y, z);
        if (meta >= max) return;
        if (this.lightAt(ctx, x, y, z) < 9) return;
        const wet = w.getBlock(x, y - 1, z) === B.FARMLAND && w.getMeta(x, y - 1, z) === 1;
        let chance = wet ? 0.35 : 0.12;
        if (rain) chance *= 1.5;
        if (Math.random() < chance) w.setBlock(x, y, z, id, meta + 1, false);
        return;
      }
      case B.FARMLAND: {
        const wet = this.nearWater(ctx, x, y, z) || (rain && w.getLight(x, y + 1, z).sky >= 14);
        const meta = w.getMeta(x, y, z);
        if (wet && meta !== 1) w.setBlock(x, y, z, B.FARMLAND, 1, false);
        else if (!wet) {
          if (meta === 1) w.setBlock(x, y, z, B.FARMLAND, 0, false);
          else {
            const above = w.getBlock(x, y + 1, z);
            if (above !== B.WHEAT && above !== B.CARROTS && above !== B.POTATOES && Math.random() < 0.1) w.setBlock(x, y, z, B.DIRT);
          }
        }
        return;
      }
      case B.SUGAR_CANE: {
        // pousse jusqu'à 3 blocs si de l'eau touche la base
        let base = y;
        while (w.getBlock(x, base - 1, z) === B.SUGAR_CANE) base--;
        if (y - base >= 2 || w.getBlock(x, y + 1, z) !== B.AIR || Math.random() > 0.15) return;
        const g = base - 1;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => w.getBlock(x + dx, g, z + dz) === B.WATER)) w.setBlock(x, y + 1, z, B.SUGAR_CANE, 0, false);
        return;
      }
      case B.DIRT: {
        if (BlockRegistry.opaque[Math.max(0, w.getBlock(x, y + 1, z))]) return;
        if (this.lightAt(ctx, x, y + 1, z) < 9) return;
        for (let i = 0; i < 4; i++) {
          const dx = ((Math.random() * 3) | 0) - 1, dy = ((Math.random() * 3) | 0) - 1, dz = ((Math.random() * 3) | 0) - 1;
          if (w.getBlock(x + dx, y + dy, z + dz) === B.GRASS_BLOCK) {
            w.setBlock(x, y, z, B.GRASS_BLOCK, 0, false);
            return;
          }
        }
        return;
      }
      case B.GRASS_BLOCK: {
        if (BlockRegistry.opaque[Math.max(0, w.getBlock(x, y + 1, z))]) w.setBlock(x, y, z, B.DIRT, 0, false);
        return;
      }
    }
  }
}
