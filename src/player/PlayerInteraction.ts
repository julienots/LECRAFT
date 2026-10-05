import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { breakTime, getDrops, blockXp, hasSupport, rollLoot } from '../blocks/BlockBehaviors';
import type { GameContext } from '../core/GameContext';
import type { InputState } from '../input/InputState';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { EntityManager } from '../entities/EntityManager';
import { Animal } from '../entities/Animal';
import type { Mob } from '../entities/Mob';
import { raycastBlocks, type RayHit } from '../util/Raycast';
import { hash3 } from '../util/math';
import { WORLD_HEIGHT } from '../core/Config';
import { FACING_DIR, facingFromYaw, opposite } from '../blocks/Shapes';
import { encodeStates, type BedrockBlockInfo } from '../addons/BedrockBlocks';
import { connectionStates } from '../addons/BlockRuntime';
import { hooks } from '../scripting/Hooks';

/** Face moteur (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z) d'une normale. */
const faceOf = (t: RayHit) => (t.nx > 0 ? 0 : t.nx < 0 ? 1 : t.ny > 0 ? 2 : t.ny < 0 ? 3 : t.nz > 0 ? 4 : 5);

export interface PlacementPreview {
  x: number;
  y: number;
  z: number;
  valid: boolean;
  block: number;
  meta: number;
  /** Blocs supplémentaires posés en même temps (moitié haute d'une porte, tête d'un lit). */
  extra: [number, number, number, number, number][];
}

export interface InteractionHost {
  openStation(kind: 'crafting' | 'furnace', x: number, y: number, z: number): void;
  openChest(x: number, y: number, z: number): void;
  useCompass(target: string): void;
  primeTnt(x: number, y: number, z: number): void;
  sleep(x: number, y: number, z: number): void;
  growSapling(x: number, y: number, z: number, id: number): boolean;
  spawnCompass(): void;
}

/** Index d'orientation correspondant à une direction horizontale (dx, dz). */
function facingOf(dx: number, dz: number): number {
  return FACING_DIR.findIndex(([x, z]) => x === dx && z === dz);
}

const CROP_MAX: Record<string, number> = { wheat: 7, carrots: 3, potatoes: 3 };

/**
 * Interactions du joueur via la caméra : rayon → bloc/créature visé →
 * minage (progression, outil, drops), pose (prévisualisation valide/invalide), utilisation
 * (établi, four, coffre, nourriture, houe, graines, arc, sceptre), attaque.
 */
export class PlayerInteraction {
  target: RayHit | null = null;
  targetMob: Mob | null = null;
  miningProgress = 0;
  private miningKey = '';
  private hitSoundTimer = 0;
  preview: PlacementPreview | null = null;
  private useRepeat = 0;
  /** Indicateur d'interaction pour le HUD. */
  hint: '' | 'mine' | 'attack' | 'open' | 'place' | 'eat' | 'feed' = '';
  eatTimer = 0;
  bowCharge = 0;

  constructor(private ctx: GameContext, private input: InputState, private entities: EntityManager, private host: InteractionHost) {}

  get reach() {
    return this.ctx.player.creative ? 6 : 5;
  }

  eye(): [number, number, number, number, number, number] {
    const p = this.ctx.player;
    const cp = Math.cos(p.pitch);
    return [p.x, p.y + p.eyeHeight, p.z, -Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
  }

  update(dt: number, events: string[]) {
    const ctx = this.ctx;
    const p = ctx.player;
    const inv = p.inventory;
    this.hitSoundTimer -= dt;
    this.useRepeat -= dt;
    if (p.dead) {
      this.target = null;
      this.targetMob = null;
      this.preview = null;
      this.miningProgress = 0;
      return;
    }
    const [ox, oy, oz, dx, dy, dz] = this.eye();
    this.target = raycastBlocks(ctx.world, ox, oy, oz, dx, dy, dz, this.reach);
    const mobHit = this.entities.raycast(ox, oy, oz, dx, dy, dz, this.reach);
    this.targetMob = mobHit && (!this.target || mobHit.distance < this.target.distance) ? mobHit.mob : null;
    const held = inv.selectedStack;
    const heldDef = held ? ItemRegistry.get(held.id) : undefined;

    // prévisualisation de pose
    this.preview = null;
    if (!this.targetMob && this.target && heldDef?.place) this.preview = this.computePlacement(this.target, BlockRegistry.byName(heldDef.place).id);
    // indice
    const tb = this.target ? BlockRegistry.get(this.target.block) : null;
    if (this.targetMob) this.hint = this.targetMob instanceof Animal && heldDef && this.targetMob.def.food?.includes(held!.id) ? 'feed' : 'attack';
    else if (tb?.interact && !p.sneaking) this.hint = 'open';
    else if (heldDef?.food && p.hunger < 20) this.hint = 'eat';
    else if (this.preview) this.hint = 'place';
    else if (tb) this.hint = 'mine';
    else this.hint = '';

    // événements ponctuels
    for (const ev of events) {
      if (ev === 'use') this.use();
      else if (ev === 'attackTap' && this.targetMob) this.entities.combat.playerAttack(ctx, this.targetMob);
    }
    // placement continu en maintenant « utiliser »
    if (this.input.useHeld && this.useRepeat <= 0 && this.preview) {
      this.useRepeat = 0.28;
      this.use(true);
    }
    // arc : maintenir utiliser charge, relâcher tire
    if (held?.id === 'bow') {
      if (this.input.useHeld) {
        if (this.bowCharge === 0) hooks.startUse?.({ ...held });
        this.bowCharge = Math.min(1, this.bowCharge + dt);
      } else if (this.bowCharge > 0) {
        hooks.releaseUse?.({ ...held }, Math.round(this.bowCharge * 20));
        this.shootBow(this.bowCharge);
        this.bowCharge = 0;
      }
    } else this.bowCharge = 0;

    // attaque / minage maintenus
    if (this.input.attack) {
      if (this.targetMob) {
        this.entities.combat.playerAttack(ctx, this.targetMob);
        this.resetMining();
      } else if (this.target) this.mine(dt, held?.id);
      else this.resetMining();
    } else this.resetMining();
  }

  private resetMining() {
    this.miningProgress = 0;
    this.miningKey = '';
  }

  private mine(dt: number, itemId: string | undefined) {
    const ctx = this.ctx;
    const t = this.target!;
    const key = `${t.x},${t.y},${t.z}`;
    if (key !== this.miningKey) {
      this.miningKey = key;
      this.miningProgress = 0;
      hooks.hitBlock?.(t.x, t.y, t.z, faceOf(t));
    }
    const p = ctx.player;
    const time = breakTime(t.block, itemId, p.creative, p.body.headInWater || (!p.body.onGround && p.body.inWater));
    if (!isFinite(time)) return;
    this.miningProgress += dt / time;
    this.entities.combat.swing = Math.max(this.entities.combat.swing, 0.6);
    if (this.hitSoundTimer <= 0) {
      this.hitSoundTimer = 0.25;
      const b = BlockRegistry.get(t.block);
      ctx.audio.blockSound('hit', b.sound, t.x + 0.5, t.y + 0.5, t.z + 0.5);
      ctx.particles.blockHit(t.x, t.y, t.z, t.block, t.nx, t.ny, t.nz);
    }
    if (this.miningProgress >= 1) {
      const stack = p.inventory.selectedStack ? { ...p.inventory.selectedStack } : null;
      const meta = ctx.world.getMeta(t.x, t.y, t.z);
      if (hooks.beforeBreak?.(t.x, t.y, t.z, t.block, meta, stack)) {
        this.resetMining();
        this.hitSoundTimer = 0.3;
        return;
      }
      this.breakBlock(t.x, t.y, t.z, itemId);
      hooks.afterBreak?.(t.x, t.y, t.z, t.block, meta, stack);
      this.resetMining();
      // en créatif, petit délai entre deux cassages
      if (p.creative) this.hitSoundTimer = 0.2;
    }
  }

  breakBlock(x: number, y: number, z: number, itemId: string | undefined) {
    const ctx = this.ctx;
    const w = ctx.world;
    const p = ctx.player;
    const id = w.getBlock(x, y, z);
    if (id <= 0) return;
    const meta = w.getMeta(x, y, z);
    const b = BlockRegistry.get(id);
    // contenu des coffres
    if (id === B.CHEST) {
      this.ensureChestLoot(x, y, z);
      const inv = w.getChest(x, y, z, false);
      inv?.slots.forEach((s) => s && this.entities.spawnItem(s.id, s.count, x + 0.5, y + 0.5, z + 0.5, s.durability));
    }
    w.setBlock(x, y, z, B.AIR);
    ctx.particles.blockBreak(x, y, z, id);
    ctx.audio.blockSound('break', b.sound, x + 0.5, y + 0.5, z + 0.5);
    ctx.stats.inc('blocksMined');
    ctx.stats.inc(`mine:${b.key}`);
    if (!p.creative) {
      for (const d of getDrops(id, meta, itemId)) this.entities.spawnItem(d.id, d.count, x + 0.5, y + 0.3, z + 0.5);
      const xp = blockXp(id);
      if (xp) p.addXp(xp);
      const tool = itemId ? ItemRegistry.get(itemId)?.tool : undefined;
      if (tool && b.hardness > 0) p.inventory.damageSelected(1);
      p.addExhaustion(0.005);
    }
    // les plantes au-dessus tombent (vérifié par le WorldTicker)
    if (y + 1 < WORLD_HEIGHT) w.scheduleUpdate(x, y + 1, z);
  }

  /** Génère le butin d'un coffre de structure lors de la première ouverture. */
  ensureChestLoot(x: number, y: number, z: number) {
    const w = this.ctx.world;
    const meta = w.getMeta(x, y, z);
    const table = meta >> 2;
    if (table > 0) {
      const inv = w.getChest(x, y, z)!;
      const loot = rollLoot(table, hash3(w.seed, x, y, z));
      loot.forEach((s, i) => {
        let slot = (i * 7 + 3) % inv.size;
        while (inv.slots[slot]) slot = (slot + 1) % inv.size;
        inv.slots[slot] = s;
      });
      w.setBlock(x, y, z, B.CHEST, meta & 3, false);
      this.ctx.stats.inc('lootChests');
      if (table === 6 || table === 7) this.ctx.stats.inc('dungeonChests');
    }
  }

  /** `meta` = -1 : pas de vérification de support (partie secondaire d'un bloc double). */
  canPlace(x: number, y: number, z: number, block: number, meta = 0): boolean {
    const w = this.ctx.world;
    if (y < 1 || y >= WORLD_HEIGHT) return false;
    const cur = w.getBlock(x, y, z);
    if (cur < 0 || !BlockRegistry.replaceable[cur]) return false;
    if (!this.free(x, y, z, block)) return false;
    if (meta < 0) return true;
    const b = BlockRegistry.get(block);
    if (b.shape === 'torch' || b.shape === 'ladder') {
      if (b.shape === 'torch' && meta === 0) return w.isSolid(x, y - 1, z);
      const [dx, dz] = FACING_DIR[(b.shape === 'torch' ? meta - 1 : meta) & 3];
      return w.isSolid(x + dx, y, z + dz);
    }
    if (b.shape === 'door' || b.shape === 'bed') return w.isSolid(x, y - 1, z);
    return hasSupport(w, x, y, z, block);
  }

  use(repeat = false) {
    const ctx = this.ctx;
    const p = ctx.player;
    const inv = p.inventory;
    const held = inv.selectedStack;
    const def = held ? ItemRegistry.get(held.id) : undefined;
    const t = this.target;
    // 0) scripts d'add-ons : interaction avec une créature ou un bloc (peut annuler la suite)
    if (!repeat && this.targetMob && hooks.interactEntity?.(this.targetMob, held ? { ...held } : null)) return;
    if (!repeat && t && !this.targetMob && hooks.interactBlock) {
      const [ox, oy, oz, dx, dy, dz] = this.eye();
      const hit: [number, number, number] = [ox + dx * t.distance, oy + dy * t.distance, oz + dz * t.distance];
      if (hooks.interactBlock(t.x, t.y, t.z, faceOf(t), hit, held ? { ...held } : null)) return;
    }
    // 1) nourrir un animal
    if (!repeat && this.targetMob instanceof Animal && held && this.targetMob.def.food?.includes(held.id)) {
      if (this.targetMob.feed(ctx, held.id)) {
        if (!p.creative) inv.takeFromSlot(inv.selected, 1);
        ctx.stats.inc('animalsFed');
      }
      return;
    }
    // 2) blocs interactifs
    if (!repeat && t && !p.sneaking) {
      const b = BlockRegistry.get(t.block);
      if (b.interact === 'crafting') return this.host.openStation('crafting', t.x, t.y, t.z);
      if (b.interact === 'furnace') return this.host.openStation('furnace', t.x, t.y, t.z);
      if (b.interact === 'door') return this.toggleDoor(t.x, t.y, t.z);
      if (b.interact === 'bed') return this.host.sleep(t.x, t.y, t.z);
      if (b.interact === 'tnt' && held && (held.id === 'flint_and_steel' || held.id === 'fire_charge')) {
        this.host.primeTnt(t.x, t.y, t.z);
        ctx.audio.play('ignite', { x: t.x, y: t.y, z: t.z });
        if (!p.creative) inv.damageSelected(1);
        return;
      }
      if (b.interact === 'chest') {
        this.ensureChestLoot(t.x, t.y, t.z);
        ctx.audio.play('chest_open', { x: t.x, y: t.y, z: t.z });
        return this.host.openChest(t.x, t.y, t.z);
      }
    }
    if (!def || !held) return;
    // objet utilisé dans le vide (ou sur un bloc sans pose) : événements de script
    if (!repeat && hooks.useItem && (!t || !def.place) && hooks.useItem({ ...held })) return;
    // 3) utilisations spéciales
    if (!repeat && def.use === 'till' && t && t.ny === 1 && (t.block === B.DIRT || t.block === B.GRASS_BLOCK || t.block === B.DIRT_PATH)) {
      if (ctx.world.getBlock(t.x, t.y + 1, t.z) === B.AIR || BlockRegistry.replaceable[ctx.world.getBlock(t.x, t.y + 1, t.z)]) {
        ctx.world.setBlock(t.x, t.y + 1, t.z, B.AIR);
        ctx.world.setBlock(t.x, t.y, t.z, B.FARMLAND, 0);
        ctx.audio.blockSound('place', 'dirt', t.x, t.y, t.z);
        if (!p.creative) inv.damageSelected(1);
        ctx.stats.inc('tilled');
      }
      return;
    }
    if (def.use === 'plant' && def.plants && t && t.block === B.FARMLAND && t.ny === 1) {
      const crop = BlockRegistry.byName(def.plants).id;
      if (ctx.world.getBlock(t.x, t.y + 1, t.z) === B.AIR) {
        ctx.world.setBlock(t.x, t.y + 1, t.z, crop, 0);
        ctx.audio.blockSound('place', 'grass', t.x, t.y + 1, t.z);
        if (!p.creative) inv.takeFromSlot(inv.selected, 1);
        ctx.stats.inc('planted');
      }
      return;
    }
    if (!repeat && def.use === 'compass' && def.target) return this.host.useCompass(def.target);
    if (!repeat && def.use === 'spawn_compass') return this.host.spawnCompass();
    if (!repeat && this.useSpecial(def.use, held.id)) return;
    if (!repeat && def.use === 'cast') return this.castScepter();
    if (def.use === 'shoot') return; // géré par la charge de l'arc
    // 4) pose de bloc
    if (def.place && this.preview) {
      const pv = this.preview;
      if (!pv.valid) {
        if (!repeat) ctx.audio.play('deny', { volume: 0.4 });
        return;
      }
      const blk = BlockRegistry.get(pv.block);
      let placeMeta = pv.meta;
      if (hooks.beforePlace && t) {
        const m = hooks.beforePlace(pv.x, pv.y, pv.z, pv.block, pv.meta, faceOf(t));
        if (m === null) {
          if (!repeat) ctx.audio.play('deny', { volume: 0.4 });
          return;
        }
        placeMeta = m;
      }
      const prevId = Math.max(0, ctx.world.getBlock(pv.x, pv.y, pv.z));
      ctx.world.setBlock(pv.x, pv.y, pv.z, pv.block, placeMeta);
      for (const [ex, ey, ez, eid, em] of pv.extra) ctx.world.setBlock(ex, ey, ez, eid, em);
      ctx.audio.blockSound('place', blk.sound, pv.x + 0.5, pv.y + 0.5, pv.z + 0.5);
      if (!p.creative) inv.takeFromSlot(inv.selected, 1);
      ctx.stats.inc('blocksPlaced');
      hooks.afterPlace?.(pv.x, pv.y, pv.z, pv.block, prevId);
      this.entities.combat.swing = 0.7;
      ctx.haptic('light');
      return;
    }
    // 5) manger
    if (!repeat && def.food) {
      if (p.eat(held.id)) {
        const eaten = { ...held };
        if (!p.creative) inv.takeFromSlot(inv.selected, 1);
        hooks.consumed?.(eaten);
        ctx.audio.play('eat');
        ctx.particles.burst('dust', p.x, p.y + 1.4, p.z, 4);
        ctx.stats.inc('eaten');
      }
    }
  }

  /** Bloc posé, orientation et blocs associés selon la face visée (comme dans le jeu de référence). */
  private computePlacement(t: RayHit, block: number): PlacementPreview {
    const w = this.ctx.world;
    const b = BlockRegistry.get(block);
    const tb = BlockRegistry.get(t.block);
    const look = facingFromYaw(this.ctx.player.yaw);
    const fy = t.py - Math.floor(t.py);
    const mk = (x: number, y: number, z: number, meta: number, extra: PlacementPreview['extra'] = []): PlacementPreview => ({ x, y, z, block, meta, extra, valid: true });
    // dalle sur une dalle identique : dalle double
    if (b.shape === 'slab' && t.block === block) {
      const m = w.getMeta(t.x, t.y, t.z) & 3;
      if ((m === 0 && t.ny === 1) || (m === 1 && t.ny === -1)) return this.validate(mk(t.x, t.y, t.z, 2), true);
    }
    const replace = tb.replaceable && tb.id !== B.AIR;
    const x = replace ? t.x : t.x + t.nx;
    const y = replace ? t.y : t.y + t.ny;
    const z = replace ? t.z : t.z + t.nz;
    if (b.def.bedrock) return this.validate(mk(x, y, z, this.bedrockPlacementMeta(b.def.bedrock, t, x, y, z, block)));
    if (b.shape === 'slab') {
      if (w.getBlock(x, y, z) === block && (w.getMeta(x, y, z) & 3) !== 2) return this.validate(mk(x, y, z, 2), true);
      const top = t.ny === -1 || (t.ny === 0 && fy > 0.5);
      return this.validate(mk(x, y, z, top ? 1 : 0));
    }
    if (b.shape === 'stairs') {
      const upside = t.ny === -1 || (t.ny === 0 && fy > 0.5);
      return this.validate(mk(x, y, z, look | (upside ? 4 : 0)));
    }
    if (b.shape === 'torch') {
      if (t.ny === 1 || replace) return this.validate(mk(x, y, z, 0));
      if (t.ny === -1) return { ...mk(x, y, z, 0), valid: false };
      return this.validate(mk(x, y, z, facingOf(-t.nx, -t.nz) + 1));
    }
    if (b.shape === 'ladder') {
      const f = t.ny === 0 && !replace ? facingOf(-t.nx, -t.nz) : look;
      return this.validate(mk(x, y, z, f));
    }
    if (b.shape === 'door') {
      // charnière : porte voisine à gauche → double porte en miroir ; sinon côté du clic
      const [dx, dz] = FACING_DIR[look];
      const lx = dz, lz = -dx; // gauche du joueur
      const w2 = this.ctx.world;
      let right: boolean;
      if (w2.getBlock(x + lx, y, z + lz) === block && !(w2.getMeta(x + lx, y, z + lz) & 16)) right = true;
      else if (w2.getBlock(x - lx, y, z - lz) === block) right = false;
      else {
        const fx = t.px - Math.floor(t.px), fz = t.pz - Math.floor(t.pz);
        const along = -lx !== 0 ? (-lx > 0 ? fx : 1 - fx) : -lz > 0 ? fz : 1 - fz;
        right = along > 0.5;
      }
      const h = right ? 16 : 0;
      return this.validate(mk(x, y, z, look | h, [[x, y + 1, z, block, look | 8 | h]]));
    }
    if (b.shape === 'bed') {
      const [dx, dz] = FACING_DIR[look];
      return this.validate(mk(x, y, z, look, [[x + dx, y, z + dz, block, look | 4]]));
    }
    // feuilles posées par le joueur : persistantes (ne se décomposent pas)
    return this.validate(mk(x, y, z, b.orientable ? opposite(look) : b.key.endsWith('_leaves') ? 1 : 0));
  }

  /** États initiaux d'un bloc d'add-on selon ses traits de placement (comme le jeu de référence). */
  private bedrockPlacementMeta(info: BedrockBlockInfo, t: RayHit, x: number, y: number, z: number, block: number): number {
    const p = this.ctx.player;
    const v: Record<string, string | boolean> = {};
    const pl = info.placement;
    if (pl.cardinal !== undefined) {
      // direction regardée (+ décalage de rotation du trait, par pas de 90°)
      const steps = Math.round((pl.cardinal ?? 0) / 90);
      v['minecraft:cardinal_direction'] = ['south', 'west', 'north', 'east'][(facingFromYaw(p.yaw) + steps + 400) & 3];
    }
    const faceName = t.ny > 0 ? 'up' : t.ny < 0 ? 'down' : t.nz > 0 ? 'south' : t.nz < 0 ? 'north' : t.nx > 0 ? 'east' : 'west';
    if (pl.face) v['minecraft:block_face'] = faceName;
    if (pl.facing) {
      if (p.pitch > 0.8) v['minecraft:facing_direction'] = 'down';
      else if (p.pitch < -0.8) v['minecraft:facing_direction'] = 'up';
      else v['minecraft:facing_direction'] = ['north', 'east', 'south', 'west'][(facingFromYaw(p.yaw) + 2) & 3];
    }
    if (pl.half) {
      const fy = t.py - Math.floor(t.py);
      v['minecraft:vertical_half'] = t.ny < 0 || (t.ny === 0 && fy > 0.5) ? 'top' : 'bottom';
    }
    if (pl.connections) Object.assign(v, connectionStates(this.ctx.world, x, y, z, block));
    return encodeStates(info, v);
  }

  private validate(pv: PlacementPreview, merging = false): PlacementPreview {
    pv.valid = merging ? this.free(pv.x, pv.y, pv.z, pv.block) : this.canPlace(pv.x, pv.y, pv.z, pv.block, pv.meta);
    for (const [x, y, z] of pv.extra) if (pv.valid && !this.canPlace(x, y, z, pv.block, -1)) pv.valid = false;
    if (pv.valid && pv.extra.length && BlockRegistry.get(pv.block).shape === 'bed') {
      const [x, y, z] = pv.extra[0];
      if (!this.ctx.world.isSolid(x, y - 1, z)) pv.valid = false;
    }
    return pv;
  }

  /** Personne (joueur, créature) ne gêne la pose d'un bloc solide. */
  private free(x: number, y: number, z: number, block: number): boolean {
    if (!BlockRegistry.solid[block] && !BlockRegistry.shape[block]) return true;
    const pb = this.ctx.player.body;
    const hw = pb.halfWidth;
    if (pb.x + hw > x && pb.x - hw < x + 1 && pb.y + pb.height > y && pb.y < y + 1 && pb.z + hw > z && pb.z - hw < z + 1) {
      const sh = BlockRegistry.get(block).shape;
      if (!(sh === 'torch' || sh === 'ladder' || sh === 'plate')) return false;
    }
    return !this.entities.occupies(x, y, z);
  }

  private toggleDoor(x: number, y: number, z: number) {
    const w = this.ctx.world;
    const id = w.getBlock(x, y, z);
    const meta = w.getMeta(x, y, z);
    const by = meta & 8 ? y - 1 : y;
    const open = !(w.getMeta(x, by, z) & 4);
    for (const yy of [by, by + 1]) {
      if (w.getBlock(x, yy, z) !== id) continue;
      const m = w.getMeta(x, yy, z);
      w.setBlock(x, yy, z, id, open ? m | 4 : m & ~4, false);
    }
    this.ctx.audio.play(open ? 'door_open' : 'door_close', { x: x + 0.5, y: by + 1, z: z + 0.5 });
    this.entities.combat.swing = 0.7;
  }

  /** Seaux, lait, poudre d'os, cisailles, briquet. Retourne vrai si l'action a eu lieu. */
  private useSpecial(use: string | undefined, itemId: string): boolean {
    const ctx = this.ctx;
    const p = ctx.player;
    const inv = p.inventory;
    const w = ctx.world;
    const t = this.target;
    const replaceHeld = (id: string) => {
      if (p.creative) return;
      const s = inv.selectedStack!;
      if (s.count <= 1) inv.slots[inv.selected] = { id, count: 1 };
      else {
        s.count--;
        const rest = inv.add({ id, count: 1 });
        if (rest > 0) this.entities.spawnItem(id, 1, p.x, p.y + 1, p.z);
      }
      inv.changed();
    };
    switch (use) {
      case 'bucket': {
        const [ox, oy, oz, dx, dy, dz] = this.eye();
        const hit = raycastBlocks(w, ox, oy, oz, dx, dy, dz, this.reach, true);
        if (!hit || !BlockRegistry.liquid[hit.block] || w.getMeta(hit.x, hit.y, hit.z) !== 0) return false;
        const lava = hit.block === B.LAVA;
        w.setBlock(hit.x, hit.y, hit.z, B.AIR);
        ctx.audio.play('bucket_fill', { x: hit.x, y: hit.y, z: hit.z });
        replaceHeld(lava ? 'lava_bucket' : 'water_bucket');
        return true;
      }
      case 'water_bucket':
      case 'lava_bucket': {
        if (!t) return false;
        const tb = BlockRegistry.get(t.block);
        const [x, y, z] = tb.replaceable ? [t.x, t.y, t.z] : [t.x + t.nx, t.y + t.ny, t.z + t.nz];
        const cur = w.getBlock(x, y, z);
        if (cur < 0 || !BlockRegistry.replaceable[cur]) return false;
        w.setBlock(x, y, z, use === 'water_bucket' ? B.WATER : B.LAVA, 0);
        ctx.audio.play('bucket_empty', { x, y, z });
        if (!p.creative) {
          inv.slots[inv.selected] = { id: 'bucket', count: 1 };
          inv.changed();
        }
        return true;
      }
      case 'milk':
        p.poisonTimer = 0;
        p.regenEffect = 0;
        ctx.audio.play('eat');
        if (!p.creative) {
          inv.slots[inv.selected] = { id: 'bucket', count: 1 };
          inv.changed();
        }
        return true;
      case 'bone_meal': {
        if (!t) return false;
        const b = BlockRegistry.get(t.block);
        let ok = false;
        if (CROP_MAX[b.key] !== undefined) {
          const m = w.getMeta(t.x, t.y, t.z);
          if (m < CROP_MAX[b.key]) {
            w.setMeta(t.x, t.y, t.z, Math.min(CROP_MAX[b.key], m + 2 + Math.floor(Math.random() * 3)));
            ok = true;
          }
        } else if (b.key.endsWith('_sapling')) {
          ok = true;
          if (Math.random() < 0.45) this.host.growSapling(t.x, t.y, t.z, t.block);
        } else if (t.block === B.GRASS_BLOCK && t.ny === 1) {
          ok = true;
          const plants = [B.SHORT_GRASS, B.SHORT_GRASS, B.SHORT_GRASS, B.SHORT_GRASS, B.DANDELION, B.POPPY];
          for (let i = 0; i < 24; i++) {
            const x = t.x + Math.round((Math.random() - 0.5) * 6), z = t.z + Math.round((Math.random() - 0.5) * 6);
            for (let dy = 1; dy >= -1; dy--) {
              const y = t.y + dy;
              if (w.getBlock(x, y, z) === B.GRASS_BLOCK && w.getBlock(x, y + 1, z) === B.AIR) {
                w.setBlock(x, y + 1, z, plants[Math.floor(Math.random() * plants.length)]);
                break;
              }
            }
          }
        }
        if (!ok) return false;
        ctx.particles.burst('magic', t.x + 0.5, t.y + 1, t.z + 0.5, 10);
        if (!p.creative) inv.takeFromSlot(inv.selected, 1);
        return true;
      }
      case 'shear': {
        const m = this.targetMob;
        if (m instanceof Animal && m.def.traits?.includes('shearable') && !m.sheared && !m.baby) {
          m.shear(ctx);
          ctx.audio.play('shear', { x: m.x, y: m.y, z: m.z });
          if (!p.creative) inv.damageSelected(1);
          return true;
        }
        return false;
      }
      case 'spawn_egg': {
        const def = ItemRegistry.get(itemId);
        if (!t || !def?.target) return false;
        const m = this.entities.spawnMob(def.target, t.x + 0.5 + t.nx, t.y + Math.max(0, t.ny) + (t.ny < 0 ? -2 : 0), t.z + 0.5 + t.nz, { persistent: true });
        if (m && !p.creative) inv.takeFromSlot(inv.selected, 1);
        return !!m;
      }
      case 'ignite':
        // le briquet n'a d'effet que sur la TNT (pas de feu dans cette version)
        return false;
      default:
        void itemId;
        return false;
    }
  }

  private shootBow(charge: number) {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p.creative && !p.inventory.remove('arrow', 1)) {
      ctx.hud.toast('Pas de flèches', 'warn');
      return;
    }
    const [ox, oy, oz, dx, dy, dz] = this.eye();
    const sp = 12 + charge * 22;
    const arrow = this.entities.spawnProjectile('player_arrow', ox + dx * 0.5, oy + dy * 0.5 - 0.1, oz + dz * 0.5, dx * sp, dy * sp, dz * sp, 2 + charge * 7, true);
    arrow.pickable = !p.creative;
    ctx.audio.play('bow');
    if (!p.creative) p.inventory.damageSelected(1);
  }

  private castScepter() {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!this.entities.combat.ready) return;
    this.entities.combat.cooldown = 0.8;
    const [ox, oy, oz, dx, dy, dz] = this.eye();
    this.entities.spawnProjectile('frost_bolt', ox + dx * 0.6, oy + dy * 0.6 - 0.1, oz + dz * 0.6, dx * 24, dy * 24, dz * 24, 7, true);
    ctx.audio.play('cast');
    ctx.particles.burst('ice', ox + dx, oy + dy - 0.2, oz + dz, 5);
    if (!p.creative) p.inventory.damageSelected(1);
  }
}
