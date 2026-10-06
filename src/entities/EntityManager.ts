import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { MOB_BY_KEY, MOB_DEFS, type MobDef } from '../data/mobs';
import { CHUNK_SIZE, SEA_LEVEL } from '../core/Config';
import { MobModel } from '../render/MobModels';
import { rayAABB } from '../util/Raycast';
import type { Entity } from './Entity';
import { Mob, type EntitySpawner } from './Mob';
import { Animal } from './Animal';
import { Enderman, Wolf, Villager } from './Creatures';
import { EnderDragon, EndCrystal } from './EnderDragon';
import { WitherBoss } from './Wither';
import { Monster } from './Monster';
import { GolemBoss, LichBoss, Boss } from './Boss';
import { ItemEntity } from './ItemEntity';
import { Projectile, type ProjectileKind, type ProjectileDef } from './Projectile';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { makeStack } from '../inventory/Inventory';
import { DamageSystem } from '../combat/DamageSystem';
import { CombatSystem } from '../combat/CombatSystem';
import { BOSS } from '../world/StructureGenerator';
import { hooks } from '../scripting/Hooks';
import type { SpecialBlock } from '../world/ChunkData';

export interface SavedMob {
  key: string;
  x: number;
  y: number;
  z: number;
  health: number;
  baby: boolean;
  wool?: string;
  sheared?: boolean;
  /** Données des add-ons (étiquettes, propriétés dynamiques, nom, effets). */
  tags?: string[];
  dp?: Record<string, unknown>;
  name?: string;
  effects?: import('./Effects').ActiveEffect[];
  yaw?: number;
}

/**
 * Gestion de toutes les entités : créatures (avec pool de modèles), objets au sol, projectiles.
 * - LOD : les entités lointaines sont mises à jour moins souvent ou gelées
 * - apparitions naturelles (jour/nuit, surface/grottes, biome), cages de donjon, autels de boss
 * - disparition des monstres éloignés, sauvegarde des animaux importants
 */
export class EntityManager implements EntitySpawner {
  readonly entities: Entity[] = [];
  readonly group = new THREE.Group();
  private pool = new Map<string, MobModel[]>();
  private itemMats = new Map<string, THREE.SpriteMaterial>();
  private spawnTimer = 0;
  private lodTick = 0;
  readonly damage: DamageSystem;
  readonly combat: CombatSystem;
  activeBoss: Boss | null = null;
  ctx!: GameContext;

  constructor(getCtx: () => GameContext) {
    this.damage = new DamageSystem(getCtx, this);
    this.combat = new CombatSystem(this.damage);
    this.group.name = 'entities';
  }

  get mobs(): Mob[] {
    return this.entities.filter((e): e is Mob => e.kind === 'mob');
  }

  // ---------- EntitySpawner ----------
  modelFor(key: string, scale: number): MobModel {
    const list = this.pool.get(key);
    const m = list?.pop() ?? new MobModel(key, scale, this.ctx?.shadowTexture ?? null, this.ctx.skins);
    m.group.scale.setScalar(scale);
    m.group.rotation.set(0, 0, 0);
    m.group.visible = true;
    return m;
  }

  private release(m: MobModel) {
    this.group.remove(m.group);
    let list = this.pool.get(m.type);
    if (!list) this.pool.set(m.type, (list = []));
    if (list.length < 8) list.push(m);
    else m.dispose();
  }

  spawnMob(key: string, x: number, y: number, z: number, opts: { baby?: boolean; persistent?: boolean; altar?: string; cause?: 'Spawned' | 'Born' | 'Loaded' } = {}): Mob | null {
    const info = MOB_BY_KEY.get(key);
    if (!info) return null;
    const { def, index } = info;
    let m: Mob;
    if (key === 'ender_dragon') m = new EnderDragon(def, index, x, y, z, this, 'end_dragon');
    else if (key === 'wither') m = new WitherBoss(def, index, x, y, z, this, 'wither');
    else if (key === 'end_crystal') m = new EndCrystal(def, index, x, y, z, this);
    else if (def.category === 'boss') m = key === 'golem' ? new GolemBoss(def, index, x, y, z, this, opts.altar ?? '') : new LichBoss(def, index, x, y, z, this, opts.altar ?? '');
    else if (def.category === 'hostile') m = new Monster(def, index, x, y, z, this);
    else if (key === 'enderman') m = new Enderman(def, index, x, y, z, this);
    else if (key === 'wolf') m = new Wolf(def, index, x, y, z, this);
    else if (key === 'villager') m = new Villager(def, index, x, y, z, this);
    else m = new Animal(def, index, x, y, z, this);
    m.yaw = Math.random() * Math.PI * 2;
    if (opts.baby) m.setBaby(true);
    if (opts.persistent) m.persistent = true;
    this.entities.push(m);
    this.group.add(m.object3d);
    hooks.spawned?.(m, opts.cause ?? (opts.baby ? 'Born' : 'Spawned'));
    return m;
  }

  spawnItem(id: string, count: number, x: number, y: number, z: number, durability?: number) {
    if (!ItemRegistry.has(id) || count <= 0) return;
    let mat = this.itemMats.get(id);
    if (!mat) {
      mat = new THREE.SpriteMaterial({ map: this.ctx.iconTexture(id), transparent: true, alphaTest: 0.3 });
      this.itemMats.set(id, mat);
    }
    const e = new ItemEntity(id, count, x, y, z, mat, durability);
    this.entities.push(e);
    this.group.add(e.object3d);
  }

  spawnProjectile(kind: ProjectileKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, damage: number, fromPlayer: boolean, def?: ProjectileDef) {
    const p = new Projectile(kind, x, y, z, vx, vy, vz, damage, fromPlayer, def);
    this.entities.push(p);
    this.group.add(p.object3d);
    return p;
  }

  // ---------- requêtes ----------
  /** Entité visée par un rayon (créatures vivantes uniquement). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): { mob: Mob; distance: number } | null {
    let best: { mob: Mob; distance: number } | null = null;
    for (const e of this.entities) {
      if (e.kind !== 'mob' || (e as Mob).dead || e.distToPlayer > maxDist + 4) continue;
      const [a, b, c, d, f, g] = e.aabb();
      const pad = 0.1;
      const t = rayAABB(ox, oy, oz, dx, dy, dz, a - pad, b - pad, c - pad, d + pad, f + pad, g + pad);
      if (t >= 0 && t <= maxDist && (!best || t < best.distance)) best = { mob: e as Mob, distance: t };
    }
    return best;
  }

  /** Vrai si une entité solide occupe la cellule (empêche de poser un bloc dessus). */
  occupies(x: number, y: number, z: number): boolean {
    for (const e of this.entities) {
      if (e.kind !== 'mob' || (e as Mob).dead) continue;
      const [a, b, c, d, f, g] = e.aabb();
      if (a < x + 1 && d > x && b < y + 1 && f > y && c < z + 1 && g > z) return true;
    }
    return false;
  }

  count(category: string): number {
    let n = 0;
    for (const e of this.entities) if (e.kind === 'mob' && (e as Mob).def.category === category && !(e as Mob).dead) n++;
    return n;
  }

  // ---------- mise à jour ----------
  update(ctx: GameContext, dt: number) {
    this.ctx = ctx;
    this.combat.update(dt);
    const p = ctx.player;
    const prof = ctx.profile;
    const simDist = ctx.profile.simulationDistance * CHUNK_SIZE + 8;
    this.lodTick++;
    const mobs: Mob[] = [];
    for (const e of this.entities) {
      if (e.removed) continue;
      e.distToPlayer = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
      // les entités hors des chunks chargés sont gelées
      const roaming = e.kind === 'mob' && ((e as Mob).def.key === 'ender_dragon' || (e as Mob).def.key === 'wither');
      if (!roaming && !ctx.world.isLoaded(Math.floor(e.x), Math.floor(e.z))) {
        if (e.kind !== 'mob') e.removed = true;
        continue;
      }
      if (e.kind === 'mob') {
        const m = e as Mob;
        mobs.push(m);
        // LOD de simulation
        const far = e.distToPlayer > simDist;
        const mid = e.distToPlayer > 32;
        m.sim = roaming || (!far && (!mid || (this.lodTick + m.id) % 4 === 0));
        if (m.sim) m.update(ctx, mid && !roaming ? dt * 4 : dt);
        // disparition des monstres
        if (m instanceof Monster && !m.persistent && (e.distToPlayer > 80 || m.farTime > 60) && !m.origin) m.removed = true;
        if (m instanceof Boss && !roaming && (e.distToPlayer > 48 || p.dead) && !m.dead) {
          m.removed = true;
          ctx.hud.toast(`${m.def.name} retourne au silence…`, 'info');
        }
      } else if (e.kind === 'item') {
        const it = e as ItemEntity;
        it.update(ctx, dt);
        if (!it.removed && it.pickupDelay <= 0 && !p.dead && Math.hypot(it.x - p.x, it.y - (p.y + 0.6), it.z - p.z) < 1.3) {
          const stack = makeStack(it.itemId, it.count);
          if (it.durability !== undefined) stack.durability = it.durability;
          const rest = p.inventory.add(stack);
          if (rest < it.count) {
            ctx.audio.play('pop', { volume: 0.5, pitch: 0.9 + Math.random() * 0.4 });
            ctx.stats.inc(`collect:${it.itemId}`, it.count - rest);
          }
          it.count = rest;
          if (rest <= 0) it.removed = true;
        }
      } else {
        const pr = e as Projectile;
        pr.update(ctx, dt);
        if (!pr.removed && !pr.stuck) this.projectileHits(ctx, pr);
      }
    }
    // reproduction
    for (const m of mobs) if (m instanceof Animal && m.loveTimer > 0) m.tryBreed(ctx, mobs);
    // chute dans le vide (l'End)
    for (const e of this.entities) if (e.y < -64) e.removed = true;
    // nettoyage
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (!e.removed) continue;
      this.entities.splice(i, 1);
      if (e.kind === 'mob') hooks.removed?.(e);
      if (e.kind === 'mob') {
        const m = e as Mob;
        if (this.activeBoss === m) this.activeBoss = null;
        this.release(m.model);
      } else this.group.remove(e.object3d);
      e.dispose();
    }
    // boss actif
    const boss = mobs.find((m): m is Boss => m instanceof Boss && !m.removed);
    this.activeBoss = boss ?? null;
    if (boss && !boss.dead) ctx.hud.setBoss(boss.def.name, boss.healthFrac, boss.phase);
    else ctx.hud.setBoss(null);
    // apparitions
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1;
      this.naturalSpawns(ctx, prof.maxEntities);
      this.specialSpawns(ctx);
    }
  }

  private projectileHits(ctx: GameContext, pr: Projectile) {
    const p = ctx.player;
    if (!pr.fromPlayer) {
      const b = p.body;
      if (pr.x > b.x - 0.4 && pr.x < b.x + 0.4 && pr.z > b.z - 0.4 && pr.z < b.z + 0.4 && pr.y > b.y && pr.y < b.y + b.height) {
        const v = Math.hypot(pr.body.vx, pr.body.vz) || 1;
        const dealt = pr.damage > 0 ? p.damage(pr.damage, pr.def?.fire ? 'fire' : 'projectile', (pr.body.vx / v) * 4, (pr.body.vz / v) * 4, pr.owner, pr) : 0;
        if (pr.type === 'ice') p.slowTimer = 2;
        if (pr.def?.effect) p.effects.add(pr.def.effect.id, pr.def.effect.duration, pr.def.effect.amplifier, true, p.effectTarget);
        if (pr.def) {
          pr.customImpact(ctx);
          return;
        }
        if (dealt > 0) {
          ctx.audio.play('hurt');
          ctx.haptic('medium');
        }
        pr.removed = true;
      }
      return;
    }
    for (const e of this.entities) {
      if (e.kind !== 'mob' || (e as Mob).dead) continue;
      const [a, b, c, d, f, g] = e.aabb();
      if (pr.x > a - 0.1 && pr.x < d + 0.1 && pr.y > b && pr.y < f && pr.z > c - 0.1 && pr.z < g + 0.1) {
        const v = Math.hypot(pr.body.vx, pr.body.vz) || 1;
        if (pr.owner === e) continue;
        if (pr.damage > 0 || !pr.def) this.damage.damageMob(e as Mob, pr.damage, { kind: 'projectile', fromPlayer: true, knockX: (pr.body.vx / v) * 4, knockZ: (pr.body.vz / v) * 4, itemId: pr.type === 'frost_bolt' ? 'frost_scepter' : 'bow', projectile: pr, attacker: pr.owner ?? ctx.player, fire: pr.def?.fire });
        if (pr.type === 'frost_bolt') (e as Mob).slowTimer = 3;
        if (pr.def) {
          const m = e as Mob;
          if (pr.def.effect) m.effects.add(pr.def.effect.id, pr.def.effect.duration, pr.def.effect.amplifier);
          if (pr.def.knockback) {
            m.body.vx += (pr.body.vx / v) * pr.def.knockback;
            m.body.vz += (pr.body.vz / v) * pr.def.knockback;
            m.body.vy = Math.max(m.body.vy, pr.def.knockback * 0.5);
          }
          pr.customImpact(ctx);
          return;
        }
        pr.removed = true;
        return;
      }
    }
  }

  /** Apparitions naturelles autour du joueur selon l'heure, la lumière et le biome. */
  private naturalSpawns(ctx: GameContext, cap: number) {
    const p = ctx.player;
    const w = ctx.world;
    const peaceful = ctx.player.difficulty === 'peaceful';
    if (!ctx.gamerules.doMobSpawning) return;
    if (ctx.dimension !== 'overworld') {
      if (!peaceful) this.netherSpawns(ctx, cap);
      return;
    }
    const hostileCap = Math.round(cap * 0.6), passiveCap = Math.round(cap * 0.4);
    const pick = (minR: number, maxR: number) => {
      const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (maxR - minR);
      return [Math.floor(p.x + Math.cos(a) * r), Math.floor(p.z + Math.sin(a) * r)];
    };
    // animaux (rarement, ils persistent)
    if (this.count('passive') + this.count('neutral') < passiveCap && Math.random() < 0.15) {
      const [x, z] = pick(24, 48);
      if (w.isLoaded(x, z)) {
        const y = w.heightAt(x, z);
        const ground = w.getBlock(x, y, z);
        if ((ground === B.GRASS_BLOCK || ground === B.SNOWY_GRASS_BLOCK || ground === B.PODZOL) && w.getBlock(x, y + 1, z) === B.AIR && w.getBlock(x, y + 2, z) === B.AIR) {
          const biome = w.biomeAt(x, z);
          const list = biome.animals.map((k) => MOB_BY_KEY.get(k)!.def).filter(Boolean);
          const def = weighted(list);
          if (def?.spawn) {
            const n = def.spawn.group[0] + Math.floor(Math.random() * (def.spawn.group[1] - def.spawn.group[0] + 1));
            for (let i = 0; i < n; i++) this.spawnMob(def.key, x + 0.5 + (Math.random() - 0.5) * 3, y + 1, z + 0.5 + (Math.random() - 0.5) * 3);
          }
        }
      }
    }
    // créatures aquatiques (calamars ; noyés la nuit) et chauves-souris / calamars luisants des grottes
    if (Math.random() < 0.25) this.waterAndCaveSpawns(ctx, peaceful);
    if (peaceful || this.count('hostile') >= hostileCap) return;
    // monstres de surface (nuit ou obscurité)
    for (let attempt = 0; attempt < 2; attempt++) {
      const [x, z] = pick(20, 44);
      if (!w.isLoaded(x, z)) continue;
      const surface = Math.random() < 0.5;
      let y: number;
      if (surface) y = w.heightAt(x, z) + 1;
      else {
        y = 5 + Math.floor(Math.random() * Math.max(6, Math.min(60, p.y + 12) - 5));
        // remonte jusqu'à une cellule d'air posée sur un sol
        let found = false;
        for (let k = 0; k < 12; k++, y++) {
          if (w.getBlock(x, y, z) === B.AIR && w.getBlock(x, y + 1, z) === B.AIR && w.isSolid(x, y - 1, z)) {
            found = true;
            break;
          }
        }
        if (!found) continue;
      }
      if (y < 2 || w.getBlock(x, y, z) !== B.AIR || w.getBlock(x, y + 1, z) !== B.AIR || !w.isSolid(x, y - 1, z)) continue;
      const below = w.getBlock(x, y - 1, z);
      if (below === B.WATER || BlockRegistry.blocks[below]?.liquid) continue;
      const l = w.getLight(x, y, z);
      const effective = Math.max(Math.round(l.sky * ctx.dayCycle.daylight), l.block);
      if (effective > 6) continue;
      const underground = l.sky < 4 && y < SEA_LEVEL;
      const biome = w.biomeAt(x, z);
      const candidates = MOB_DEFS.filter((d) => {
        if (!d.spawn || d.category !== 'hostile') return false;
        if (d.spawn.where === 'cave' && !underground) return false;
        if (d.traits?.includes('waterSpawn') || d.spawn.where === 'nether') return false;
        if (d.spawn.where === 'surface' && underground && !biome.hostiles.includes(d.key)) return d.key === 'rodeur';
        if (d.spawn.where === 'surface' && !biome.hostiles.includes(d.key)) return false;
        if (d.spawn.maxY !== undefined && y > d.spawn.maxY) return false;
        return true;
      });
      const def = weighted(candidates);
      if (!def) continue;
      if (Math.hypot(x - p.x, z - p.z) < 18) continue;
      this.spawnMob(def.key, x + 0.5, y, z + 0.5);
    }
  }

  private waterAndCaveSpawns(ctx: GameContext, peaceful: boolean) {
    const p = ctx.player, w = ctx.world;
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 24;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (!w.isLoaded(x, z)) return;
    const count = (k: string) => this.mobs.filter((m) => m.def.key === k && !m.dead).length;
    const biome = w.biomeAt(x, z);
    // eau de surface
    if (w.getBlock(x, SEA_LEVEL, z) === B.WATER && w.getBlock(x, SEA_LEVEL - 3, z) === B.WATER) {
      const night = ctx.dayCycle.daylight < 0.35;
      if (!peaceful && night && biome.hostiles.includes('drowned') && count('drowned') < 4) this.spawnMob('drowned', x + 0.5, SEA_LEVEL - 4, z + 0.5);
      else if (biome.animals.includes('squid') && count('squid') < 5) for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.spawnMob('squid', x + 0.5 + Math.random() * 2, SEA_LEVEL - 2 - Math.random() * 3, z + 0.5 + Math.random() * 2);
      return;
    }
    // grottes : chauves-souris dans l'obscurité, calamars luisants dans l'eau profonde
    const y = 8 + Math.floor(Math.random() * 40);
    if (y > p.y + 24) return;
    const b = w.getBlock(x, y, z);
    const l = w.getLight(x, y, z);
    if (l.sky > 3 || l.block > 3) return;
    if (b === B.AIR && w.getBlock(x, y + 1, z) === B.AIR && count('bat') < 4) this.spawnMob('bat', x + 0.5, y, z + 0.5);
    else if (b === B.WATER && w.getBlock(x, y + 1, z) === B.WATER && y < 45 && count('glow_squid') < 3) this.spawnMob('glow_squid', x + 0.5, y, z + 0.5);
  }

  /** Nether : apparitions selon le biome à toute hauteur (pas de cycle jour/nuit). */
  private netherSpawns(ctx: GameContext, cap: number) {
    const p = ctx.player, w = ctx.world;
    // forteresses : squelettes wither et blazes sur les briques du Nether
    if (ctx.dimension === 'nether' && BlockRegistry.has('nether_bricks') && Math.random() < 0.4 && this.mobs.filter((m) => !m.dead && (m.def.key === 'wither_skeleton' || m.def.key === 'blaze')).length < 6) {
      const bricks = BlockRegistry.byName('nether_bricks').id;
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 30;
      const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
      if (w.isLoaded(x, z))
        for (let y = 60; y < 76; y++)
          if (w.getBlock(x, y - 1, z) === bricks && w.getBlock(x, y, z) === B.AIR && w.getBlock(x, y + 1, z) === B.AIR && w.getBlock(x, y + 2, z) === B.AIR) {
            this.spawnMob(Math.random() < 0.6 ? 'wither_skeleton' : 'blaze', x + 0.5, y, z + 0.5);
            return;
          }
    }
    const nether = this.mobs.filter((m) => !m.dead && m.def.category !== 'passive' && m.def.category !== 'boss').length;
    if (nether >= Math.round(cap * 0.7) || Math.random() > 0.5) return;
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 28;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (!w.isLoaded(x, z)) return;
    const biome = w.biomeAt(x, z);
    const def = weighted(biome.hostiles.map((k) => MOB_BY_KEY.get(k)?.def).filter((d): d is MobDef => !!d && !!d.spawn));
    if (!def) return;
    const tall = def.key === 'ghast' ? 5 : 2;
    let y = 32 + Math.floor(Math.random() * 80);
    for (let k = 0; k < 40; k++, y--) {
      if (y < 32) return;
      if (!w.isSolid(x, y - 1, z) || BlockRegistry.liquid[w.getBlock(x, y - 1, z)]) continue;
      let free = true;
      for (let h = 0; h < tall && free; h++) if (w.getBlock(x, y + h, z) !== B.AIR) free = false;
      if (!free) continue;
      const n = def.spawn!.group[0] + Math.floor(Math.random() * (def.spawn!.group[1] - def.spawn!.group[0] + 1));
      for (let i = 0; i < n; i++) this.spawnMob(def.key, x + 0.5 + (Math.random() - 0.5) * 2, y + (def.key === 'ghast' ? 2 : 0), z + 0.5 + (Math.random() - 0.5) * 2);
      return;
    }
  }

  /** Cages à monstres (donjons) et autels de boss. */
  private specialSpawns(ctx: GameContext) {
    const p = ctx.player;
    const peaceful = ctx.player.difficulty === 'peaceful';
    for (const [key, s] of ctx.world.specials) {
      const d = Math.hypot(s.x + 0.5 - p.x, s.y - p.y, s.z + 0.5 - p.z);
      if (s.block === B.SPAWNER) {
        if (peaceful || d > 18) continue;
        s.timer -= 1;
        if (s.timer > 0) continue;
        s.timer = 6 + Math.floor(Math.random() * 6);
        const def = MOB_DEFS[s.meta] ?? MOB_DEFS[4];
        const linked = this.mobs.filter((m) => m.origin === key && !m.dead).length;
        if (def.key === 'zombie_chief') {
          if (s.spawned > 0 || linked > 0) continue;
        } else if (linked >= 3) continue;
        // position libre autour de la cage
        for (let t = 0; t < 6; t++) {
          const x = s.x + Math.floor(Math.random() * 5) - 2, z = s.z + Math.floor(Math.random() * 5) - 2;
          const y = s.y;
          const w = ctx.world;
          if (w.getBlock(x, y, z) === B.AIR && w.getBlock(x, y + 1, z) === B.AIR && w.isSolid(x, y - 1, z)) {
            const m = this.spawnMob(def.key, x + 0.5, y, z + 0.5);
            if (m) {
              m.origin = key;
              s.spawned++;
              ctx.particles.burst('smoke', x + 0.5, y + 0.5, z + 0.5, 8);
            }
            break;
          }
        }
      } else if (BlockRegistry.has('bell') && s.block === BlockRegistry.byName('bell').id) {
        // cloche de village : les villageois apparaissent une seule fois
        if (s.spawned > 0 || d > 64) continue;
        const w = ctx.world;
        let n = 0;
        const want = 3 + Math.floor(Math.random() * 3);
        for (let t = 0; t < 60 && n < want; t++) {
          const x = s.x + Math.floor(Math.random() * 21) - 10, z = s.z + Math.floor(Math.random() * 21) - 10;
          if (!w.isLoaded(x, z)) continue;
          const y = w.heightAt(x, z) + 1;
          if (w.getBlock(x, y, z) !== B.AIR || w.getBlock(x, y + 1, z) !== B.AIR || BlockRegistry.liquid[w.getBlock(x, y - 1, z)]) continue;
          const v = this.spawnMob('villager', x + 0.5, y, z + 0.5, { persistent: true });
          if (v) {
            v.homeX = s.x;
            v.homeZ = s.z;
            n++;
          }
        }
        s.spawned = Math.max(1, n);
      } else if (s.block === B.BOSS_ALTAR) {
        if (d > 14 || ctx.defeatedBosses.has(key) || this.activeBoss || p.dead) continue;
        const bossKey = s.meta === BOSS.LICH ? 'liche' : 'golem';
        const m = this.spawnMob(bossKey, s.x + 0.5, s.y + 1.2, s.z + 3.5, { altar: key, persistent: true });
        if (m) {
          ctx.hud.toast(`${m.def.name} s'éveille !`, 'warn');
          ctx.audio.play('roar', { volume: 1 });
          ctx.particles.burst('magic', s.x + 0.5, s.y + 1.5, s.z + 0.5, 30);
          ctx.shake(0.8);
        }
      }
    }
  }

  /** Enregistre les blocs spéciaux d'un chunk chargé. */
  registerSpecials(ctx: GameContext, list: SpecialBlock[]) {
    for (const s of list) {
      const key = `${s.x},${s.y},${s.z}`;
      if (!ctx.world.specials.has(key)) ctx.world.specials.set(key, { ...s, timer: 2, spawned: 0 });
    }
  }

  /** Synchronise les objets 3D (chaque frame). */
  render(ctx: GameContext, t: number) {
    const maxD = ctx.profile.entityDistance;
    for (const e of this.entities) {
      const vis = e.distToPlayer < maxD;
      e.object3d.visible = vis;
      if (!vis) continue;
      if (e.kind === 'mob') (e as Mob).render(ctx, 1, t);
      else if (e.kind === 'item') (e as ItemEntity).syncObject(t);
      else (e as Projectile).syncObject();
    }
  }

  serialize(): SavedMob[] {
    return this.mobs
      .filter((m) => !m.dead && !m.removed && m.def.category !== 'boss' && (m.def.category === 'passive' || m.def.category === 'neutral' || m.persistent || m.nameTag || m.tags.size || m.dynProps.size))
      .map((m) => ({
        key: m.def.key, x: m.x, y: m.y, z: m.z, health: m.health, baby: m.baby, wool: m instanceof Animal ? m.woolColor : undefined, sheared: m instanceof Animal ? m.sheared : undefined,
        ...(m.tags.size ? { tags: [...m.tags] } : {}), ...(m.dynProps.size ? { dp: Object.fromEntries(m.dynProps) } : {}), ...(m.nameTag ? { name: m.nameTag } : {}),
        ...(m.effects.map.size ? { effects: m.effects.serialize() } : {}), yaw: m.yaw,
      }));
  }

  load(list: SavedMob[]) {
    for (const s of list) {
      const m = this.spawnMob(s.key, s.x, s.y + 0.1, s.z, { baby: s.baby, persistent: true, cause: 'Loaded' });
      if (!m) continue;
      m.health = s.health;
      if (m instanceof Animal && s.wool) m.setWool(s.wool, !!s.sheared);
      for (const t of s.tags ?? []) m.tags.add(t);
      for (const [k, v] of Object.entries(s.dp ?? {})) m.dynProps.set(k, v);
      if (s.name) m.nameTag = s.name;
      if (s.effects) m.effects.load(s.effects);
      if (s.yaw !== undefined) m.yaw = s.yaw;
    }
  }

  clear() {
    for (const e of this.entities) {
      if (e.kind === 'mob') this.release((e as Mob).model);
      else this.group.remove(e.object3d);
      e.dispose();
    }
    this.entities.length = 0;
    this.activeBoss = null;
  }

  dispose() {
    this.clear();
    this.pool.forEach((l) => l.forEach((m) => m.dispose()));
    this.pool.clear();
    this.itemMats.forEach((m) => m.dispose());
    this.itemMats.clear();
  }
}

function weighted<T extends { spawn?: { weight: number } }>(list: T[]): T | null {
  const total = list.reduce((a, d) => a + (d.spawn?.weight ?? 0), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const d of list) {
    r -= d.spawn?.weight ?? 0;
    if (r < 0) return d;
  }
  return list[list.length - 1];
}
