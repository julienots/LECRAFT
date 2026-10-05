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

export interface PlacementPreview {
  x: number;
  y: number;
  z: number;
  valid: boolean;
  block: number;
}

export interface InteractionHost {
  openStation(kind: 'crafting' | 'furnace'): void;
  openChest(x: number, y: number, z: number): void;
  useCompass(target: string): void;
}

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
    if (!this.targetMob && this.target && heldDef?.place) {
      const tb = BlockRegistry.get(this.target.block);
      const replace = tb.replaceable && tb.id !== B.AIR;
      const x = replace ? this.target.x : this.target.x + this.target.nx;
      const y = replace ? this.target.y : this.target.y + this.target.ny;
      const z = replace ? this.target.z : this.target.z + this.target.nz;
      const block = BlockRegistry.byName(heldDef.place).id;
      this.preview = { x, y, z, block, valid: this.canPlace(x, y, z, block) };
    }
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
      if (this.input.useHeld) this.bowCharge = Math.min(1, this.bowCharge + dt);
      else if (this.bowCharge > 0) {
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
      this.breakBlock(t.x, t.y, t.z, itemId);
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

  canPlace(x: number, y: number, z: number, block: number): boolean {
    const w = this.ctx.world;
    if (y < 1 || y >= WORLD_HEIGHT) return false;
    const cur = w.getBlock(x, y, z);
    if (cur < 0 || !BlockRegistry.replaceable[cur]) return false;
    if (BlockRegistry.solid[block]) {
      // ne pas se poser dans le joueur ou une créature
      const pb = this.ctx.player.body;
      const hw = pb.halfWidth;
      if (pb.x + hw > x && pb.x - hw < x + 1 && pb.y + pb.height > y && pb.y < y + 1 && pb.z + hw > z && pb.z - hw < z + 1) return false;
      if (this.entities.occupies(x, y, z)) return false;
    }
    return hasSupport(w, x, y, z, block);
  }

  private orientationMeta(): number {
    // face avant tournée vers le joueur
    const yaw = this.ctx.player.yaw;
    const a = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4; // 0 regarde -Z
    return [0, 1, 2, 3][a];
  }

  use(repeat = false) {
    const ctx = this.ctx;
    const p = ctx.player;
    const inv = p.inventory;
    const held = inv.selectedStack;
    const def = held ? ItemRegistry.get(held.id) : undefined;
    const t = this.target;
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
      if (b.interact === 'crafting') return this.host.openStation('crafting');
      if (b.interact === 'furnace') return this.host.openStation('furnace');
      if (b.interact === 'chest') {
        this.ensureChestLoot(t.x, t.y, t.z);
        ctx.audio.play('chest_open', { x: t.x, y: t.y, z: t.z });
        return this.host.openChest(t.x, t.y, t.z);
      }
    }
    if (!def || !held) return;
    // 3) utilisations spéciales
    if (!repeat && def.use === 'till' && t && t.ny === 1 && (t.block === B.DIRT || t.block === B.GRASS || t.block === B.DIRT_PATH)) {
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
      ctx.world.setBlock(pv.x, pv.y, pv.z, pv.block, blk.orientable ? this.orientationMeta() : 0);
      ctx.audio.blockSound('place', blk.sound, pv.x + 0.5, pv.y + 0.5, pv.z + 0.5);
      if (!p.creative) inv.takeFromSlot(inv.selected, 1);
      ctx.stats.inc('blocksPlaced');
      this.entities.combat.swing = 0.7;
      ctx.haptic('light');
      return;
    }
    // 5) manger
    if (!repeat && def.food) {
      if (p.eat(held.id)) {
        if (!p.creative) inv.takeFromSlot(inv.selected, 1);
        ctx.audio.play('eat');
        ctx.particles.burst('dust', p.x, p.y + 1.4, p.z, 4);
        ctx.stats.inc('eaten');
      }
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
    this.entities.spawnProjectile('player_arrow', ox + dx * 0.5, oy + dy * 0.5 - 0.1, oz + dz * 0.5, dx * sp, dy * sp, dz * sp, 2 + charge * 7, true);
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
