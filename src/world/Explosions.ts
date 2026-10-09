import * as THREE from 'three';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { getDrops, rollLoot } from '../blocks/BlockBehaviors';
import { hash3 } from '../util/math';
import type { GameContext } from '../core/GameContext';
import type { EntityManager } from '../entities/EntityManager';
import { Mob } from '../entities/Mob';
import type { TextureManager } from '../render/TextureManager';

interface Primed {
  x: number;
  y: number;
  z: number;
  fuse: number;
  mesh: THREE.Mesh;
}

/** Puissance d'une TNT (rayon d'effet ~ 4 blocs). */
const POWER = 4;

/**
 * TNT amorcée (mèche de 4 s, clignotement blanc) et explosions : destruction sphérique selon la
 * résistance des blocs, objets lâchés, dégâts et projection des entités, réaction en chaîne.
 */
export class Explosions {
  private primed: Primed[] = [];
  private geo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
  private mats: THREE.MeshBasicMaterial[] | null = null;
  readonly group = new THREE.Group();

  constructor(private textures: TextureManager) {}

  private materials(): THREE.MeshBasicMaterial[] {
    if (this.mats) return this.mats;
    const b = BlockRegistry.get(B.TNT);
    const mk = (ti: number) => {
      const t = new THREE.CanvasTexture(this.textures.tile(ti));
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      return new THREE.MeshBasicMaterial({ map: t, color: 0xffffff });
    };
    // ordre BoxGeometry : +X, -X, +Y, -Y, +Z, -Z
    const side = mk(b.faceTiles[0]), top = mk(b.faceTiles[2]), bottom = mk(b.faceTiles[3]);
    this.mats = [side, side, top, bottom, side, side];
    return this.mats;
  }

  get count() {
    return this.primed.length;
  }

  /** Amorce la TNT en (x,y,z) : le bloc devient une entité qui explose après `fuse` secondes. */
  prime(ctx: GameContext, x: number, y: number, z: number, fuse = 4) {
    if (this.primed.some((p) => p.x === x && p.y === y && p.z === z)) return;
    if (!ctx.gamerules.tntExplodes) return;
    ctx.world.setBlock(x, y, z, B.AIR);
    const mesh = new THREE.Mesh(this.geo, this.materials().map((m) => m.clone()));
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.group.add(mesh);
    this.primed.push({ x, y, z, fuse, mesh });
    ctx.audio.play('fuse', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  }

  update(ctx: GameContext, entities: EntityManager, dt: number) {
    for (let i = this.primed.length - 1; i >= 0; i--) {
      const p = this.primed[i];
      p.fuse -= dt;
      // clignotement blanc et léger gonflement avant l'explosion
      const flash = Math.floor(p.fuse * 5) % 2 === 0;
      for (const m of p.mesh.material as THREE.MeshBasicMaterial[]) m.color.setScalar(flash ? 2.2 : 1);
      const s = p.fuse < 0.4 ? 1 + (0.4 - p.fuse) * 0.5 : 1;
      p.mesh.scale.setScalar(s);
      if (p.fuse <= 0) {
        this.primed.splice(i, 1);
        this.group.remove(p.mesh);
        for (const m of p.mesh.material as THREE.MeshBasicMaterial[]) m.dispose();
        this.explode(ctx, entities, p.x + 0.5, p.y + 0.5, p.z + 0.5, POWER);
      }
    }
  }

  /** Explosion : rayons depuis le centre, intensité diminuée par la résistance des blocs traversés. */
  explode(ctx: GameContext, entities: EntityManager, cx: number, cy: number, cz: number, power: number, breakBlocks = true) {
    const w = ctx.world;
    const destroyed = new Set<string>();
    const chain: [number, number, number][] = [];
    const n = 16;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++) {
          if (i > 0 && i < n - 1 && j > 0 && j < n - 1 && k > 0 && k < n - 1) continue;
          let dx = (i / (n - 1)) * 2 - 1, dy = (j / (n - 1)) * 2 - 1, dz = (k / (n - 1)) * 2 - 1;
          const len = Math.hypot(dx, dy, dz);
          dx /= len;
          dy /= len;
          dz /= len;
          let intensity = power * (0.7 + Math.random() * 0.6);
          let x = cx, y = cy, z = cz;
          while (intensity > 0) {
            const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
            const id = w.getBlock(bx, by, bz);
            if (id < 0) break;
            if (id > 0) {
              const b = BlockRegistry.get(id);
              const resist = b.hardness < 0 || id === B.OBSIDIAN ? 1e9 : BlockRegistry.liquid[id] ? 100 : b.hardness * 3 + 0.3;
              intensity -= (resist + 0.3) * 0.3;
              if (intensity > 0) destroyed.add(`${bx},${by},${bz}`);
            }
            x += dx * 0.3;
            y += dy * 0.3;
            z += dz * 0.3;
            intensity -= 0.225;
          }
        }
    if (!breakBlocks) destroyed.clear();
    for (const key of destroyed) {
      const [x, y, z] = key.split(',').map(Number);
      const id = w.getBlock(x, y, z);
      if (id <= 0) continue;
      if (id === B.TNT) {
        chain.push([x, y, z]);
        continue;
      }
      // coffre de structure jamais ouvert : son butin est tiré et lâché lui aussi
      const meta = w.getMeta(x, y, z);
      if (id === B.CHEST && meta >> 2 > 0) for (const st of rollLoot(meta >> 2, hash3(w.seed, x, y, z))) entities.spawnItem(st.id, st.count, x + 0.5, y + 0.5, z + 0.5, st.durability);
      for (const s of w.containerItems(x, y, z)) entities.spawnItem(s.id, s.count, x + 0.5, y + 0.5, z + 0.5, s.durability);
      w.setBlock(x, y, z, B.AIR);
      // comme dans le jeu de référence : chaque bloc détruit a 1 chance sur `power` de lâcher son objet
      if (Math.random() < 1 / power) for (const d of getDrops(id, meta, 'diamond_pickaxe')) entities.spawnItem(d.id, d.count, x + 0.5, y + 0.5, z + 0.5);
    }
    for (const [x, y, z] of chain) this.prime(ctx, x, y, z, 0.5 + Math.random());
    // dégâts et projection
    const radius = power * 2;
    const hurt = (ex: number, ey: number, ez: number) => {
      const d = Math.hypot(ex - cx, ey - cy, ez - cz);
      if (d >= radius) return null;
      const impact = 1 - d / radius;
      const len = d || 1;
      return { dmg: Math.floor((impact * impact + impact) * 3.5 * power + 1), kx: ((ex - cx) / len) * impact * 14, ky: impact * 8, kz: ((ez - cz) / len) * impact * 14 };
    };
    const p = ctx.player;
    const ph = hurt(p.x, p.y + 0.9, p.z);
    if (ph && !p.creative) {
      p.damage(ph.dmg, 'explosion', ph.kx * 0.3, ph.kz * 0.3);
      p.body.vy = Math.max(p.body.vy, ph.ky);
    }
    for (const e of entities.entities) {
      const h = hurt(e.x, e.y + 0.5, e.z);
      if (!h) continue;
      e.body.vx += h.kx;
      e.body.vy = Math.max(e.body.vy, h.ky);
      e.body.vz += h.kz;
      if (e instanceof Mob) ctx.combat.damageMob(e, h.dmg, { kind: 'environment' });
    }
    ctx.particles.burst('explosion', cx, cy, cz, 40);
    ctx.particles.burst('smoke', cx, cy, cz, 30);
    ctx.audio.play('explode', { x: cx, y: cy, z: cz, volume: 1 });
    ctx.shake(Math.max(0, 1 - Math.hypot(p.x - cx, p.y - cy, p.z - cz) / 24));
    ctx.haptic('heavy');
    ctx.stats.inc('explosions');
  }

  clear() {
    for (const p of this.primed) this.group.remove(p.mesh);
    this.primed.length = 0;
  }

  dispose() {
    this.clear();
    this.geo.dispose();
    this.mats?.forEach((m) => (m.map?.dispose(), m.dispose()));
  }
}
