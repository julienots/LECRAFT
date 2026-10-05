import * as THREE from 'three';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { getDrops } from '../blocks/BlockBehaviors';
import type { GameContext } from '../core/GameContext';
import type { EntitySpawner } from '../entities/Mob';
import type { TextureManager } from '../render/TextureManager';
import { BLOCK_BOX, blockMaterials } from '../render/BlockMeshes';

interface Falling {
  x: number;
  y: number;
  z: number;
  vy: number;
  id: number;
  meta: number;
  mesh: THREE.Mesh;
}

/**
 * Blocs soumis à la gravité (sable, gravier) : le bloc devient une entité qui tombe avec une
 * accélération réelle puis se repose au premier support ; s'il tombe dans une case occupée
 * (torche, herbe…), il est lâché comme objet, comme dans le jeu de référence.
 */
export class FallingBlocks {
  readonly group = new THREE.Group();
  private list: Falling[] = [];

  constructor(private textures: TextureManager) {}

  get count() {
    return this.list.length;
  }

  spawn(ctx: GameContext, x: number, y: number, z: number, id: number) {
    const meta = ctx.world.getMeta(x, y, z);
    ctx.world.setBlock(x, y, z, B.AIR);
    const mesh = new THREE.Mesh(BLOCK_BOX, blockMaterials(this.textures, id));
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.group.add(mesh);
    this.list.push({ x, y, z, vy: 0, id, meta, mesh });
  }

  update(ctx: GameContext, spawner: EntitySpawner, dt: number) {
    const w = ctx.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.vy = Math.max(-40, f.vy - 32 * dt);
      const ny = f.y + f.vy * dt;
      const by = Math.floor(ny);
      const below = w.getBlock(f.x, by, f.z);
      const blocked = below < 0 || by < 1 || (below > 0 && !BlockRegistry.liquid[below] && !BlockRegistry.replaceable[below]);
      if (blocked) {
        // se pose au-dessus du bloc rencontré
        const ty = by + 1;
        this.list.splice(i, 1);
        this.group.remove(f.mesh);
        const cur = w.getBlock(f.x, ty, f.z);
        if (cur === B.AIR || (cur > 0 && (BlockRegistry.liquid[cur] || BlockRegistry.replaceable[cur]))) w.setBlock(f.x, ty, f.z, f.id, f.meta);
        else for (const d of getDrops(f.id, f.meta, 'diamond_shovel')) spawner.spawnItem(d.id, d.count, f.x + 0.5, ty + 0.3, f.z + 0.5);
        ctx.particles.burst('dust', f.x + 0.5, ty + 0.1, f.z + 0.5, 4);
        ctx.audio.blockSound('place', BlockRegistry.get(f.id).sound, f.x + 0.5, ty + 0.5, f.z + 0.5);
        continue;
      }
      // une case non remplaçable traversée (torche) casse la chute en objet
      const inside = w.getBlock(f.x, by, f.z);
      if (inside > 0 && BlockRegistry.shape[inside] && !BlockRegistry.replaceable[inside]) {
        this.list.splice(i, 1);
        this.group.remove(f.mesh);
        for (const d of getDrops(f.id, f.meta, 'diamond_shovel')) spawner.spawnItem(d.id, d.count, f.x + 0.5, by + 0.6, f.z + 0.5);
        continue;
      }
      f.y = ny;
      f.mesh.position.y = ny + 0.5;
      // dégâts d'étouffement simples : le joueur pris dessous est repoussé
      const p = ctx.player;
      if (Math.abs(p.x - (f.x + 0.5)) < 0.8 && Math.abs(p.z - (f.z + 0.5)) < 0.8 && ny < p.y + p.body.height && ny + 1 > p.y && f.vy < -2) p.damage(1, 'contact');
    }
  }

  clear() {
    for (const f of this.list) this.group.remove(f.mesh);
    this.list.length = 0;
  }
}
