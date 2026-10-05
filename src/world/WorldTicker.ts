import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { hasSupport, getDrops } from '../blocks/BlockBehaviors';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/Config';
import type { GameContext } from '../core/GameContext';
import type { EntitySpawner } from '../entities/Mob';
import { buildTree } from './Trees';
import { FluidSimulator } from './FluidSimulator';
import { idx } from './ChunkData';
import type { TreeType } from '../data/biomes';

/**
 * Mises à jour du monde à 20 Hz :
 * - file des mises à jour voisines (liquides, gravité du sable/gravier, plantes sans support)
 * - ticks aléatoires (croissance des cultures selon lumière/eau/pluie, pousses → arbres,
 *   propagation de l'herbe, hydratation de la terre cultivable)
 */
export class WorldTicker {
  readonly fluids = new FluidSimulator();
  randomTicksPerChunk = 12;

  constructor(private spawner: EntitySpawner) {}

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
    // gravité (chute instantanée jusqu'au premier support)
    if (b.gravity) {
      const below = w.getBlock(x, y - 1, z);
      if (below === B.AIR || (below > 0 && BlockRegistry.liquid[below])) {
        let ty = y - 1;
        while (ty > 0) {
          const bb = w.getBlock(x, ty - 1, z);
          if (bb !== B.AIR && !(bb > 0 && BlockRegistry.liquid[bb])) break;
          ty--;
        }
        w.setBlock(x, y, z, B.AIR);
        w.setBlock(x, ty, z, id);
        ctx.particles.burst('dust', x + 0.5, ty + 0.5, z + 0.5, 4);
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
    // terre cultivable écrasée
    if (id === B.FARMLAND && BlockRegistry.solid[Math.max(0, w.getBlock(x, y + 1, z))]) w.setBlock(x, y, z, B.DIRT);
    // herbe recouverte
    if (id === B.GRASS && BlockRegistry.opaque[Math.max(0, w.getBlock(x, y + 1, z))]) w.setBlock(x, y, z, B.DIRT);
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

  private randomTick(ctx: GameContext, x: number, y: number, z: number, id: number) {
    const w = ctx.world;
    const rain = ctx.raining();
    switch (id) {
      case B.WHEAT:
      case B.CARROTS: {
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
            if (above !== B.WHEAT && above !== B.CARROTS && Math.random() < 0.1) w.setBlock(x, y, z, B.DIRT);
          }
        }
        return;
      }
      case B.SAPLING: {
        if (this.lightAt(ctx, x, y, z) < 9 || Math.random() > 0.12) return;
        const biome = w.biomeAt(x, z);
        const type: TreeType = (biome.trees[0]?.type && biome.trees[0].type !== 'cactus' ? biome.trees[0].type : 'oak') as TreeType;
        // espace libre au-dessus
        for (let dy = 1; dy < 7; dy++) if (w.getBlock(x, y + dy, z) !== B.AIR && w.getBlock(x, y + dy, z) > 0 && !BlockRegistry.replaceable[w.getBlock(x, y + dy, z)] && !BlockRegistry.get(w.getBlock(x, y + dy, z)).key.endsWith('leaves')) return;
        w.setBlock(x, y, z, B.AIR, 0, false);
        w.setBlock(x, y - 1, z, B.DIRT, 0, false);
        buildTree(type === 'jungle' ? 'oak' : type, x, y, z, (Math.random() * 1e9) | 0, (tx, ty, tz, b, onlyIfAir) => {
          const cur = w.getBlock(tx, ty, tz);
          if (cur < 0) return;
          if (onlyIfAir && cur !== B.AIR && !BlockRegistry.replaceable[cur]) return;
          w.setBlock(tx, ty, tz, b, 0, false);
        });
        ctx.particles.burst('hearts', x + 0.5, y + 1, z + 0.5, 3);
        ctx.stats.inc('treesGrown');
        return;
      }
      case B.DIRT: {
        if (BlockRegistry.opaque[Math.max(0, w.getBlock(x, y + 1, z))]) return;
        if (this.lightAt(ctx, x, y + 1, z) < 9) return;
        for (let i = 0; i < 4; i++) {
          const dx = ((Math.random() * 3) | 0) - 1, dy = ((Math.random() * 3) | 0) - 1, dz = ((Math.random() * 3) | 0) - 1;
          if (w.getBlock(x + dx, y + dy, z + dz) === B.GRASS) {
            w.setBlock(x, y, z, B.GRASS, 0, false);
            return;
          }
        }
        return;
      }
      case B.GRASS: {
        if (BlockRegistry.opaque[Math.max(0, w.getBlock(x, y + 1, z))]) w.setBlock(x, y, z, B.DIRT, 0, false);
        return;
      }
    }
  }
}
