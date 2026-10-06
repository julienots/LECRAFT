import { BlockRegistry } from '../blocks/BlockRegistry';
import type { Game } from './Game';
import { WorldGenerator } from '../world/WorldGenerator';
import { BiomeManager } from '../world/BiomeManager';
import { makeStack } from '../inventory/Inventory';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { MOB_DEFS } from '../data/mobs';
import { hooks } from '../scripting/Hooks';

/**
 * Outils de diagnostic (console / tests automatisés). Exposés sur window.__lecraft.debug.
 * N'altèrent jamais la sauvegarde d'eux-mêmes.
 */
export class DebugTools {
  private gen: WorldGenerator | null = null;
  constructor(private game: Game) {}

  private generator() {
    const s = this.game.session!;
    if (!this.gen || this.gen.seed !== s.world.seed) this.gen = new WorldGenerator(s.world.seed);
    return this.gen;
  }

  /** Identifiant numérique d'un bloc (tests automatisés). */
  blockId(key: string): number {
    return BlockRegistry.byName(key).id;
  }

  teleport(x: number, z: number, y?: number) {
    const p = this.game.session!.player;
    const h = y ?? this.generator().heightAt(Math.floor(x), Math.floor(z)) + 2;
    p.body.setPos(x + 0.5, h, z + 0.5);
    p.body.vx = p.body.vy = p.body.vz = 0;
  }

  findBiome(key: string, radius = 4000): { x: number; z: number } | null {
    const g = this.generator();
    const id = BiomeManager.byName(key).id;
    for (let r = 64; r < radius; r += 64)
      for (let a = 0; a < Math.PI * 2; a += 0.2) {
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        if (g.biomeAt(x, z) === id && g.biomeAt(x + 24, z) === id && g.biomeAt(x - 24, z) === id) return { x, z };
      }
    return null;
  }

  findStructure(key: string) {
    const p = this.game.session!.player;
    return this.generator().structures.locate(key, p.x, p.z, 16);
  }

  give(id: string, count = 1) {
    this.game.session!.player.inventory.add(makeStack(id, count));
  }

  /** Accès en lecture aux registres et aux crochets de script (tests automatisés). */
  get registries() {
    return { blocks: BlockRegistry, items: ItemRegistry, mobs: MOB_DEFS, hooks };
  }

  setTime(t: number) {
    this.game.session!.dayCycle.time = t;
  }
}
