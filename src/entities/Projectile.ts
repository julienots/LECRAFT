import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { raycastBlocks } from '../util/Raycast';
import { Entity } from './Entity';

export type ProjectileKind = 'arrow' | 'ice' | 'crystal' | 'boulder' | 'player_arrow' | 'frost_bolt' | 'custom';

/** Projectile défini par un add-on (ou projectile du jeu de référence demandé par un script). */
export interface ProjectileDef {
  id: string;
  color: string;
  size: number;
  /** Gravité en blocs/s². */
  gravity: number;
  damage: number;
  /** Puissance d'explosion à l'impact. */
  explode?: number;
  fire?: boolean;
  effect?: { id: string; duration: number; amplifier: number };
  /** Recul (souffle) à l'impact, en blocs/s. */
  knockback?: number;
  /** Reste planté dans le sol (flèches). */
  stick?: boolean;
  /** Téléporte le lanceur à l'impact (perle). */
  teleport?: boolean;
  /** Durée de vie maximale (s). */
  life?: number;
  /** Objet lâché à la fin de sa course (œil de l'Ender), avec une probabilité. */
  dropItem?: string;
  dropChance?: number;
}

/** Projectiles connus (add-ons et équivalents des projectiles du jeu de référence). */
export const PROJECTILE_DEFS = new Map<string, ProjectileDef>([
  ['minecraft:snowball', { id: 'minecraft:snowball', color: '#f4f8ff', size: 0.25, gravity: 12, damage: 0, knockback: 2 }],
  ['minecraft:egg', { id: 'minecraft:egg', color: '#e8dcc0', size: 0.25, gravity: 12, damage: 0, knockback: 2 }],
  ['minecraft:fireball', { id: 'minecraft:fireball', color: '#ff8a20', size: 0.6, gravity: 0, damage: 6, explode: 1.2, fire: true, life: 10 }],
  ['minecraft:small_fireball', { id: 'minecraft:small_fireball', color: '#ffa030', size: 0.3, gravity: 0, damage: 5, fire: true }],
  ['minecraft:dragon_fireball', { id: 'minecraft:dragon_fireball', color: '#c040ff', size: 0.5, gravity: 0, damage: 6, explode: 1, life: 10 }],
  ['minecraft:wither_skull', { id: 'minecraft:wither_skull', color: '#2a2a2a', size: 0.35, gravity: 0, damage: 8, explode: 1, effect: { id: 'wither', duration: 200, amplifier: 1 } }],
  ['minecraft:wither_skull_dangerous', { id: 'minecraft:wither_skull_dangerous', color: '#3a6ad0', size: 0.35, gravity: 0, damage: 8, explode: 1.5, effect: { id: 'wither', duration: 200, amplifier: 1 } }],
  ['minecraft:llama_spit', { id: 'minecraft:llama_spit', color: '#f0f0e0', size: 0.2, gravity: 6, damage: 1 }],
  ['minecraft:breeze_wind_charge_projectile', { id: 'minecraft:breeze_wind_charge_projectile', color: '#c8f0ff', size: 0.35, gravity: 0, damage: 1, knockback: 10 }],
  ['minecraft:wind_charge_projectile', { id: 'minecraft:wind_charge_projectile', color: '#c8f0ff', size: 0.35, gravity: 0, damage: 1, knockback: 10 }],
  ['minecraft:shulker_bullet', { id: 'minecraft:shulker_bullet', color: '#f0e8a0', size: 0.3, gravity: 0, damage: 4, effect: { id: 'levitation', duration: 200, amplifier: 0 } }],
  ['minecraft:thrown_trident', { id: 'minecraft:thrown_trident', color: '#5ad0c8', size: 0.12, gravity: 12, damage: 8, stick: true }],
  ['minecraft:ender_pearl', { id: 'minecraft:ender_pearl', color: '#1a6a5a', size: 0.25, gravity: 12, damage: 0, teleport: true }],
  ['minecraft:xp_bottle', { id: 'minecraft:xp_bottle', color: '#a0e060', size: 0.25, gravity: 12, damage: 0 }],
  ['minecraft:splash_potion', { id: 'minecraft:splash_potion', color: '#d04060', size: 0.25, gravity: 12, damage: 0 }],
  ['lecraft:stray_arrow', { id: 'lecraft:stray_arrow', color: '#7a8a8a', size: 0.1, gravity: 12, damage: 3, stick: true, effect: { id: 'slowness', duration: 600, amplifier: 0 } }],
  ['lecraft:witch_potion', { id: 'lecraft:witch_potion', color: '#6a2a9a', size: 0.25, gravity: 12, damage: 2, effect: { id: 'poison', duration: 140, amplifier: 0 } }],
  ['lecraft:eye_of_ender', { id: 'lecraft:eye_of_ender', color: '#3aa070', size: 0.3, gravity: 3, damage: 0, life: 1.8, dropItem: 'ender_eye', dropChance: 0.8 }],
  ['lecraft:guardian_beam', { id: 'lecraft:guardian_beam', color: '#f0a040', size: 0.15, gravity: 0, damage: 6 }],
  ['minecraft:arrow', { id: 'minecraft:arrow', color: '#8a6a3c', size: 0.1, gravity: 12, damage: 4, stick: true }],
]);

const GEOS = new Map<ProjectileKind, THREE.BufferGeometry>();
const MATS = new Map<ProjectileKind, THREE.Material>();
const LOOK: Record<ProjectileKind, { size: [number, number, number]; color: string; gravity: number }> = {
  arrow: { size: [0.06, 0.06, 0.6], color: '#8a6a3c', gravity: 12 },
  player_arrow: { size: [0.06, 0.06, 0.6], color: '#b08a50', gravity: 12 },
  ice: { size: [0.3, 0.3, 0.3], color: '#a8e0ff', gravity: 0 },
  frost_bolt: { size: [0.25, 0.25, 0.25], color: '#c8f0ff', gravity: 0 },
  crystal: { size: [0.25, 0.25, 0.25], color: '#62e8f0', gravity: 0 },
  boulder: { size: [0.7, 0.7, 0.7], color: '#6e6f74', gravity: 12 },
  custom: { size: [0.3, 0.3, 0.3], color: '#ffffff', gravity: 0 },
};
const CUSTOM_GEO = new Map<string, THREE.BufferGeometry>();
const CUSTOM_MAT = new Map<string, THREE.Material>();

/** Projectile (flèches, éclats de glace, rochers...). Collision blocs + cibles AABB. */
export class Projectile extends Entity {
  readonly kind = 'projectile' as const;
  object3d: THREE.Mesh;
  life = 6;
  stuck = false;
  /** Flèche tirée par le joueur en survie : récupérable une fois plantée. */
  pickable = false;
  /** Lanceur (API de script : composant projectile.owner). */
  owner: import('../scripting/Hooks').Actor | null = null;
  constructor(readonly type: ProjectileKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, public damage: number, public fromPlayer: boolean, readonly def?: ProjectileDef) {
    super(0.15, 0.3);
    if (def?.life) this.life = def.life;
    this.body.setPos(x, y, z);
    this.body.vx = vx;
    this.body.vy = vy;
    this.body.vz = vz;
    if (type === 'custom' && def) {
      let g = CUSTOM_GEO.get(def.id);
      if (!g) CUSTOM_GEO.set(def.id, (g = def.stick ? new THREE.BoxGeometry(def.size * 0.6, def.size * 0.6, def.size * 5) : new THREE.BoxGeometry(def.size, def.size, def.size)));
      let m = CUSTOM_MAT.get(def.id);
      if (!m) CUSTOM_MAT.set(def.id, (m = new THREE.MeshBasicMaterial({ color: def.color })));
      this.object3d = new THREE.Mesh(g, m);
      return;
    }
    const look = LOOK[type];
    let g = GEOS.get(type);
    if (!g) {
      g = new THREE.BoxGeometry(...look.size);
      GEOS.set(type, g);
    }
    let m = MATS.get(type);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: look.color });
      MATS.set(type, m);
    }
    this.object3d = new THREE.Mesh(g, m);
  }

  update(ctx: GameContext, dt: number) {
    this.age += dt;
    if (this.age > this.life) {
      this.removed = true;
      const d = this.def;
      if (d?.dropItem) {
        if (Math.random() < (d.dropChance ?? 1)) (ctx as unknown as { entities?: { spawnItem(id: string, n: number, x: number, y: number, z: number): void } }).entities?.spawnItem(d.dropItem, 1, this.x, this.y, this.z);
        else {
          ctx.particles.burst('magic', this.x, this.y, this.z, 12);
          ctx.audio.play('glass_break', { x: this.x, y: this.y, z: this.z });
        }
      }
      return;
    }
    if (this.def?.dropItem) ctx.particles.burst('magic', this.x, this.y, this.z, 1);
    if (this.stuck) {
      if (this.pickable && !ctx.player.dead) {
        const p = ctx.player;
        if (Math.abs(p.x - this.x) < 1.3 && Math.abs(p.z - this.z) < 1.3 && this.y > p.y - 0.8 && this.y < p.y + 2.2 && p.inventory.add({ id: 'arrow', count: 1 }) === 0) {
          this.removed = true;
          ctx.audio.play('pop', { x: this.x, y: this.y, z: this.z, volume: 0.5, pitch: 1.4 });
        }
      }
      return;
    }
    const b = this.body;
    b.vy -= (this.def ? this.def.gravity : LOOK[this.type].gravity) * dt;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (sp < 1e-6) return;
    const step = sp * dt;
    const hit = raycastBlocks(ctx.world, b.x, b.y, b.z, b.vx / sp, b.vy / sp, b.vz / sp, step);
    if (hit) {
      b.x += (b.vx / sp) * hit.distance;
      b.y += (b.vy / sp) * hit.distance;
      b.z += (b.vz / sp) * hit.distance;
      this.impact(ctx);
      return;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
  }

  impact(ctx: GameContext) {
    if (this.def) {
      this.customImpact(ctx);
      return;
    }
    if (this.type === 'arrow' || this.type === 'player_arrow') {
      this.stuck = true;
      // comme dans le jeu de référence, une flèche plantée reste une minute
      this.life = this.age + (this.pickable ? 60 : 4);
    } else {
      this.removed = true;
      ctx.particles.burst(this.type === 'boulder' ? 'dust' : this.type === 'crystal' ? 'crystal' : 'ice', this.x, this.y, this.z, 8);
      ctx.audio.play(this.type === 'boulder' ? 'stone_hit' : 'glass_hit', { x: this.x, y: this.y, z: this.z, volume: 0.7 });
    }
  }

  /** Effets d'impact d'un projectile défini (explosion, souffle, téléportation…). */
  customImpact(ctx: GameContext) {
    const d = this.def!;
    if (d.dropItem) {
      this.age = this.life + 1; // l'œil retombe à l'endroit de l'impact
      this.update(ctx, 0);
      return;
    }
    if (d.stick) {
      this.stuck = true;
      this.life = this.age + 4;
      return;
    }
    this.removed = true;
    if (d.explode) {
      const s = ctx as unknown as { explosions?: { explode(c: GameContext, e: unknown, x: number, y: number, z: number, p: number): void }; entities?: unknown };
      s.explosions?.explode(ctx, s.entities, this.x, this.y, this.z, d.explode);
    } else ctx.particles.burst(d.fire ? 'fire' : d.knockback ? 'dust' : 'smoke', this.x, this.y, this.z, 8);
    if (d.knockback) {
      const p = ctx.player;
      const dx = p.x - this.x, dz = p.z - this.z, dist = Math.hypot(dx, p.y - this.y, dz);
      if (dist < 2.5 && !this.fromPlayer) {
        p.body.vx += (dx / (dist || 1)) * d.knockback;
        p.body.vz += (dz / (dist || 1)) * d.knockback;
        p.body.vy = Math.max(p.body.vy, d.knockback * 0.6);
      }
    }
    if (d.teleport && this.owner && 'body' in this.owner) this.owner.body.setPos(this.x, this.y + 0.2, this.z);
    ctx.audio.play(d.explode ? 'explode' : d.knockback ? 'slam' : 'pop', { x: this.x, y: this.y, z: this.z, volume: 0.6 });
  }

  syncObject() {
    const b = this.body;
    this.object3d.position.set(b.x, b.y, b.z);
    if (!this.stuck) this.object3d.lookAt(b.x + b.vx, b.y + b.vy, b.z + b.vz);
  }

  dispose() {
    /* géométries/matériaux partagés */
  }
}

export function disposeProjectileCache() {
  GEOS.forEach((g) => g.dispose());
  MATS.forEach((m) => m.dispose());
  GEOS.clear();
  MATS.clear();
  CUSTOM_GEO.forEach((g) => g.dispose());
  CUSTOM_MAT.forEach((m) => m.dispose());
  CUSTOM_GEO.clear();
  CUSTOM_MAT.clear();
}
