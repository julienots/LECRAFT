import type { ItemStack } from '../inventory/Item';
import { setOpen, updatePowerAround } from '../world/Redstone';
import { applyPotion, makePotion, potionColor, potionOf } from '../inventory/Potions';
import { enchLevel, enchantsOf } from '../inventory/Enchantments';
import { ArmorStand } from '../entities/ArmorStand';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { breakTime, getDrops, blockXp, hasSupport, plantSoil, rollLoot } from '../blocks/BlockBehaviors';
import type { GameContext } from '../core/GameContext';
import type { InputState } from '../input/InputState';
import { STRIPPED } from '../data/vanillaMore';
import { PROJECTILE_DEFS } from '../entities/Projectile';
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
import { tryLight, insertEye } from '../world/Portals';
import { Wolf, Villager } from '../entities/Creatures';

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
  openStation(kind: 'crafting' | 'furnace' | 'enchant' | 'anvil' | 'brewing' | 'dispenser' | 'dropper' | 'hopper' | 'ender', x: number, y: number, z: number): void;
  openChest(x: number, y: number, z: number): void;
  useCompass(target: string): void;
  primeTnt(x: number, y: number, z: number): void;
  sleep(x: number, y: number, z: number): void;
  growSapling(x: number, y: number, z: number, id: number): boolean;
  spawnCompass(): void;
  /** Portail du Nether allumé (registre des portails). */
  portalLit?(pos: { x: number; y: number; z: number }): void;
  /** Feu posé au briquet. */
  fireLit?(x: number, y: number, z: number): void;
  /** Échanges avec un villageois. */
  trade?(v: Villager): void;
  /** Œil de l'Ender lancé vers le fort le plus proche. */
  throwEye?(): void;
  /** Champ de vision vertical (degrés) et rapport largeur/hauteur de la caméra (visée au doigt). */
  view?(): { fov: number; aspect: number };
  /** Bouton enfoncé : relâché après `seconds` (1 s pierre, 1,5 s bois). */
  pressButton?(x: number, y: number, z: number, seconds: number): void;
  /** Règles du lieu (serveur de mini-jeux) : casser / poser autorisé à cet endroit ? */
  canEdit?(x: number, y: number, z: number, action: 'break' | 'place', block: number): boolean;
  /** Utilisation d'un objet interceptée (menu des jeux…) : vrai si traitée. */
  useItem?(itemId: string): boolean;
  /** Bloc cassé par le joueur (mods du serveur de survie : abattage d'arbre, filons). */
  afterBreak?(x: number, y: number, z: number, block: number, itemId: string | undefined): void;
  /** Interaction avec une créature particulière (PNJ du serveur) : vrai si traitée. */
  mobInteract?(m: Mob): boolean;
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

  eye(aim: { x: number; y: number } | null = null): [number, number, number, number, number, number] {
    const p = this.ctx.player;
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch), cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const v = aim ? this.host.view?.() : undefined;
    if (!aim || !v) return [p.x, p.y + p.eyeHeight, p.z, fx, fy, fz];
    // rayon passant par le point touché : avant + droite·x·tan(fov/2)·aspect + haut·y·tan(fov/2)
    const t = Math.tan((v.fov * Math.PI) / 360);
    const ax = aim.x * t * v.aspect, ay = aim.y * t;
    const rx = cy, rz = -sy; // droite
    const ux = sy * sp, uy = cp, uz = cy * sp; // haut
    let dx = fx + rx * ax + ux * ay, dy = fy + uy * ay, dz = fz + rz * ax + uz * ay;
    const n = Math.hypot(dx, dy, dz);
    dx /= n;
    dy /= n;
    dz /= n;
    return [p.x, p.y + p.eyeHeight, p.z, dx, dy, dz];
  }

  /** La créature a-t-elle une interaction avec l'objet tenu (sinon un toucher la frappe) ? */
  private mobInteractable(m: Mob, held: string | null): boolean {
    if ((m as unknown as { npc?: unknown }).npc) return true;
    if (m instanceof Villager) return !m.baby;
    if (m instanceof ArmorStand) return true;
    if (m instanceof Wolf) return held === 'bone' || (m as unknown as { tamed?: boolean }).tamed === true;
    if (m instanceof Animal) {
      if (held && m.def.food?.includes(held)) return true;
      if (held === 'shears' && m.def.key === 'sheep') return true;
      if (held === 'bucket' && (m.def.key === 'cow' || m.def.key === 'mooshroom')) return true;
    }
    return false;
  }

  /** Bloc et créature visés le long d'un rayon. */
  private aimTargets(aim: { x: number; y: number } | null) {
    const [ox, oy, oz, dx, dy, dz] = this.eye(aim);
    this.target = raycastBlocks(this.ctx.world, ox, oy, oz, dx, dy, dz, this.reach);
    const mobHit = this.entities.raycast(ox, oy, oz, dx, dy, dz, this.reach);
    this.targetMob = mobHit && (!this.target || mobHit.distance < this.target.distance) ? mobHit.mob : null;
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
    // visée : au doigt pendant un appui long (miner), sinon au viseur ; un toucher bref vise son point
    const tap = events.includes('use') ? this.input.tapAim : null;
    this.aimTargets(tap ?? this.input.holdAim);
    this.input.tapAim = null;
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
      // toucher bref sur une créature (commandes tactiles) : on la frappe, sauf interaction possible
      // (nourrir, échanger, apprivoiser, tondre, traire…), comme l'édition mobile
      if (ev === 'use' && tap && this.targetMob && !this.mobInteractable(this.targetMob, held?.id ?? null)) this.entities.combat.playerAttack(ctx, this.targetMob);
      else if (ev === 'use') this.use();
      else if (ev === 'attackTap' && this.targetMob) this.entities.combat.playerAttack(ctx, this.targetMob);
      else if (ev === 'attackTap') this.deflectProjectile();
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
    if (this.host.canEdit && !this.host.canEdit(t.x, t.y, t.z, 'break', t.block)) return;
    const held = p.inventory.selectedStack;
    // Affinité aquatique (casque) : pas de pénalité sous l'eau
    const wet = (p.body.headInWater || (!p.body.onGround && p.body.inWater)) && !enchLevel(p.inventory.armor.head, 'aqua_affinity');
    const time = breakTime(t.block, itemId, p.creative, wet, enchLevel(held, 'efficiency'));
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
      this.host.afterBreak?.(t.x, t.y, t.z, t.block, itemId);
      this.breakArea(t, itemId);
      this.resetMining();
      // en créatif, petit délai entre deux cassages
      if (p.creative) this.hitSoundTimer = 0.2;
    }
  }

  /**
   * Marteau / excavateur : casse aussi les 8 blocs autour du bloc miné, dans le plan de la face
   * visée (3×3), s'ils se minent avec ce type d'outil et ne sont pas beaucoup plus durs.
   * Accroupi : un seul bloc (pour les finitions).
   */
  private breakArea(t: { x: number; y: number; z: number; block: number; nx: number; ny: number; nz: number }, itemId: string | undefined) {
    const def = itemId ? ItemRegistry.get(itemId) : undefined;
    if (!def?.area || !def.tool || this.ctx.player.sneaking) return;
    const w = this.ctx.world, p = this.ctx.player;
    const center = BlockRegistry.get(t.block);
    // axes du plan perpendiculaire à la face
    const [ux, uy, uz, vx, vy, vz] = t.ny !== 0 ? [1, 0, 0, 0, 0, 1] : t.nx !== 0 ? [0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, 1, 0];
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        if (!a && !b) continue;
        const x = t.x + ux * a + vx * b, y = t.y + uy * a + vy * b, z = t.z + uz * a + vz * b;
        const id = w.getBlock(x, y, z);
        if (id <= 0 || BlockRegistry.liquid[id]) continue;
        const bd = BlockRegistry.get(id);
        if (bd.hardness < 0 || bd.def.tool !== def.tool.type || bd.hardness > Math.max(center.hardness, 0.5) * 1.5 + 0.5) continue;
        if (this.host.canEdit && !this.host.canEdit(x, y, z, 'break', id)) continue;
        if (!p.inventory.selectedStack || p.inventory.selectedStack.id !== itemId) return; // outil cassé
        const meta = w.getMeta(x, y, z);
        this.breakBlock(x, y, z, itemId);
        hooks.afterBreak?.(x, y, z, id, meta, { ...p.inventory.selectedStack });
        this.host.afterBreak?.(x, y, z, id, itemId);
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
    if (b.interact === 'chest') this.ensureChestLoot(x, y, z);
    const shulker = w.shulkerItem(x, y, z);
    // contenu des coffres, tonneaux, boîtes de shulker et fourneaux (entrée, combustible, résultat)
    for (const s of w.containerItems(x, y, z)) this.entities.spawnItem(s.id, s.count, x + 0.5, y + 0.5, z + 0.5, s.durability, s.meta);
    w.setBlock(x, y, z, B.AIR);
    ctx.particles.blockBreak(x, y, z, id);
    ctx.audio.blockSound('break', b.sound, x + 0.5, y + 0.5, z + 0.5);
    ctx.stats.inc('blocksMined');
    ctx.stats.inc(`mine:${b.key}`);
    // boîte de shulker : un seul objet qui garde le contenu (même en créatif s'il n'est pas vide)
    if (shulker && (!p.creative || shulker.meta)) this.entities.spawnItem(shulker.id, 1, x + 0.5, y + 0.3, z + 0.5, undefined, shulker.meta);
    if (!p.creative && !shulker) {
      const ench = enchantsOf(p.inventory.selectedStack);
      for (const d of getDrops(id, meta, itemId, Math.random, ench)) this.entities.spawnItem(d.id, d.count, x + 0.5, y + 0.3, z + 0.5);
      const xp = ench.silk_touch ? 0 : blockXp(id);
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
    if (b.def.doublePlant) return plantSoil(b, w.getBlock(x, y - 1, z));
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
    if (!repeat && this.targetMob && this.host.mobInteract?.(this.targetMob)) return;
    if (!repeat && held && this.host.useItem?.(held.id)) return;
    if (!repeat && t && !this.targetMob && hooks.interactBlock) {
      const [ox, oy, oz, dx, dy, dz] = this.eye();
      const hit: [number, number, number] = [ox + dx * t.distance, oy + dy * t.distance, oz + dz * t.distance];
      if (hooks.interactBlock(t.x, t.y, t.z, faceOf(t), hit, held ? { ...held } : null)) return;
    }
    // 1) nourrir un animal
    // loup (os : apprivoiser ; apprivoisé : assis / debout, viande : soigner) et villageois (échanges)
    if (!repeat && this.targetMob instanceof Wolf) {
      const r = this.targetMob.interact(ctx, held?.id ?? null);
      if (r === 'tamed' || r === 'failed' || r === 'healed') {
        if (!p.creative) inv.takeFromSlot(inv.selected, 1);
        return;
      }
      if (r === 'sit') return;
    }
    // support d'armure : une pièce d'armure en main s'y équipe (échange), main vide : on la reprend
    if (!repeat && this.targetMob instanceof ArmorStand) {
      const st = this.targetMob;
      const slot = def?.armor?.slot;
      if (held && slot) {
        const old = st.armor[slot];
        st.armor[slot] = { ...held, count: 1 };
        if (!p.creative) {
          inv.slots[inv.selected] = old ? { ...old, count: 1 } : held.count > 1 ? { ...held, count: held.count - 1 } : null;
          inv.changed();
        }
      } else if (!held) {
        const s = (['head', 'chest', 'legs', 'feet'] as const).find((k) => st.armor[k]);
        if (!s) return;
        const it = st.armor[s]!;
        delete st.armor[s];
        if (inv.add({ ...it, count: 1 }) > 0) this.entities.spawnItem(it.id, 1, p.x, p.y + 1, p.z, it.durability, it.meta);
        inv.changed();
      } else return;
      ctx.audio.play('equip', { x: st.x, y: st.y, z: st.z });
      return;
    }
    // pose d'un support d'armure sur le dessus d'un bloc, face au joueur
    if (!repeat && held?.id === 'armor_stand' && t && t.ny > 0) {
      const x = t.x + 0.5, y = t.y + 1, z = t.z + 0.5;
      if (ctx.world.isSolid(t.x, t.y + 1, t.z) || ctx.world.isSolid(t.x, t.y + 2, t.z)) return;
      this.entities.spawnArmorStand(x, y, z, Math.round((p.yaw + Math.PI) / (Math.PI / 4)) * (Math.PI / 4));
      ctx.audio.blockSound('place', 'wood', x, y, z);
      if (!p.creative) inv.takeFromSlot(inv.selected, 1);
      return;
    }
    if (!repeat && this.targetMob instanceof Villager && !this.targetMob.baby) {
      this.host.trade?.(this.targetMob);
      return;
    }
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
      if (b.interact === 'enchanting') return this.host.openStation('enchant', t.x, t.y, t.z);
      if (b.interact === 'anvil') return this.host.openStation('anvil', t.x, t.y, t.z);
      if (b.interact === 'brewing') return this.host.openStation('brewing', t.x, t.y, t.z);
      if (b.interact === 'dispenser') return this.host.openStation(b.key === 'dropper' ? 'dropper' : 'dispenser', t.x, t.y, t.z);
      if (b.interact === 'hopper') return this.host.openStation('hopper', t.x, t.y, t.z);
      if (b.interact === 'ender_chest') {
        ctx.audio.play('chest_open', { x: t.x, y: t.y, z: t.z });
        ctx.particles.burst('magic', t.x + 0.5, t.y + 1, t.z + 0.5, 10);
        return this.host.openStation('ender', t.x, t.y, t.z);
      }
      if (b.interact === 'door') {
        // portes et trappes en fer : seulement avec la redstone (le jeu original ne les ouvre pas à la main)
        if (b.def.redstoneOnly) return;
        if (b.shape === 'door') return this.toggleDoor(t.x, t.y, t.z);
        return this.toggleOpenable(t.x, t.y, t.z);
      }
      if (b.interact === 'lever') return this.toggleLever(t.x, t.y, t.z);
      // cisailles sur une citrouille : citrouille sculptée + 4 graines (comme le jeu original)
      if (held?.id === 'shears' && b.key === 'pumpkin' && BlockRegistry.has('carved_pumpkin')) {
        const w = ctx.world;
        w.setBlock(t.x, t.y, t.z, BlockRegistry.byName('carved_pumpkin').id, opposite(facingFromYaw(p.yaw)));
        this.entities.spawnItem('pumpkin_seeds', 4, t.x + 0.5, t.y + 1.1, t.z + 0.5);
        ctx.audio.play('shear', { x: t.x, y: t.y, z: t.z });
        if (!p.creative) inv.damageSelected(1);
        return;
      }
      if (b.interact === 'button') return this.pressButton(t.x, t.y, t.z, b.sound === 'wood' ? 1.5 : 1);
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
    // hache sur une bûche : écorce
    if (!repeat && def.tool?.type === 'axe' && t && STRIPPED[BlockRegistry.get(t.block).key] && BlockRegistry.has(STRIPPED[BlockRegistry.get(t.block).key])) {
      ctx.world.setBlock(t.x, t.y, t.z, BlockRegistry.byName(STRIPPED[BlockRegistry.get(t.block).key]).id, ctx.world.getMeta(t.x, t.y, t.z));
      ctx.audio.blockSound('place', 'wood', t.x + 0.5, t.y + 0.5, t.z + 0.5);
      ctx.particles.blockHit(t.x, t.y, t.z, t.block, t.nx, t.ny, t.nz);
      if (!p.creative) inv.damageSelected(1);
      this.entities.combat.swing = 1;
      return;
    }
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
      // boîte de shulker posée : son contenu revient dans le bloc
      const carried = held.meta?.items as (ItemStack | null)[] | undefined;
      if (carried && blk.key.endsWith('shulker_box')) ctx.world.getChest(pv.x, pv.y, pv.z)!.load({ slots: carried });
      for (const [ex, ey, ez, eid, em] of pv.extra) ctx.world.setBlock(ex, ey, ez, eid, em);
      ctx.audio.blockSound('place', blk.sound, pv.x + 0.5, pv.y + 0.5, pv.z + 0.5);
      if (!p.creative) inv.takeFromSlot(inv.selected, 1);
      ctx.stats.inc('blocksPlaced');
      hooks.afterPlace?.(pv.x, pv.y, pv.z, pv.block, prevId);
      this.entities.combat.swing = 0.7;
      ctx.haptic('light');
      return;
    }
    // 5) potions : fiole remplie à l'eau, potion bue, potion jetable lancée
    if (!repeat && held.id === 'glass_bottle') {
      const [ox, oy, oz, dx, dy, dz] = this.eye();
      const hit = raycastBlocks(ctx.world, ox, oy, oz, dx, dy, dz, this.reach, true);
      if (hit && hit.block === B.WATER) {
        if (!p.creative) inv.takeFromSlot(inv.selected, 1);
        if (inv.add(makePotion('water')) > 0) this.entities.spawnItem('potion', 1, p.x, p.y + 1, p.z);
        inv.changed();
        ctx.audio.play('bucket_fill', { x: hit.x, y: hit.y, z: hit.z });
        return;
      }
    }
    if (!repeat && held.id === 'potion') {
      const pot = potionOf(held)!;
      applyPotion(p.effects, p.effectTarget, pot);
      if (!p.creative) {
        inv.slots[inv.selected] = { id: 'glass_bottle', count: 1 };
        inv.changed();
      }
      ctx.audio.play('eat', { pitch: 0.8 });
      ctx.particles.burst('magic', p.x, p.y + 1.4, p.z, 8);
      ctx.stats.inc('potionsDrunk');
      return;
    }
    if (!repeat && held.id === 'splash_potion') {
      const pot = potionOf(held)!;
      const [ox, oy, oz, dx, dy, dz] = this.eye();
      const pd = { id: `splash_potion${potionColor(held)}`, color: potionColor(held), size: 0.3, gravity: 20, damage: 0, splash: pot };
      const pr = this.entities.spawnProjectile('custom', ox + dx * 0.6, oy + dy * 0.6, oz + dz * 0.6, dx * 14, dy * 14 + 3, dz * 14, 0, true, pd);
      pr.owner = p;
      ctx.audio.play('paper_whoosh', { x: ox, y: oy, z: oz });
      this.entities.combat.swing = 1;
      if (!p.creative) inv.takeFromSlot(inv.selected, 1);
      return;
    }
    // 6) manger
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
    if (b.shape === 'trapdoor') {
      // posée sur le côté d'un bloc : charnière contre ce bloc ; dessus/dessous : selon le regard
      const top = t.ny === -1 || (t.ny === 0 && fy > 0.5);
      const f = t.ny === 0 && !replace ? facingOf(t.nx, t.nz) : look;
      return this.validate(mk(x, y, z, f | (top ? 8 : 0)));
    }
    if (b.shape === 'fence_gate') return this.validate(mk(x, y, z, look));
    if (b.shape === 'lever' || b.shape === 'button') {
      if (t.ny === 1 || replace) return this.validate(mk(x, y, z, 0));
      if (t.ny === -1) return { ...mk(x, y, z, 0), valid: false };
      return this.validate(mk(x, y, z, facingOf(-t.nx, -t.nz) + 1));
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
    if (b.def.doublePlant) return this.validate(mk(x, y, z, 0, [[x, y + 1, z, block, 1]]));
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
    if (pv.valid && this.host.canEdit && !this.host.canEdit(pv.x, pv.y, pv.z, 'place', pv.block)) pv.valid = false;
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
      if (!(sh === 'torch' || sh === 'ladder' || sh === 'plate' || sh === 'lever' || sh === 'button')) return false;
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
  /** Trappe ou portillon : ouvert / fermé. */
  private toggleOpenable(x: number, y: number, z: number) {
    const w = this.ctx.world;
    const open = !(w.getMeta(x, y, z) & 4);
    setOpen(w, x, y, z, open);
    this.ctx.audio.play(open ? 'door_open' : 'door_close', { x: x + 0.5, y: y + 0.5, z: z + 0.5, pitch: 1.15 });
    this.entities.combat.swing = 0.7;
  }

  /** Levier : bascule et alimente les ouvrants voisins. */
  private toggleLever(x: number, y: number, z: number) {
    const w = this.ctx.world;
    const id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
    w.setBlock(x, y, z, id, m ^ 8, false);
    this.ctx.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5, pitch: m & 8 ? 0.5 : 0.6 });
    updatePowerAround(w, x, y, z, (ox, oy, oz, open) => this.ctx.audio.play(open ? 'door_open' : 'door_close', { x: ox + 0.5, y: oy + 0.5, z: oz + 0.5 }));
    this.entities.combat.swing = 0.7;
  }

  /** Bouton : enfoncé un instant, alimente les ouvrants voisins. */
  private pressButton(x: number, y: number, z: number, seconds: number) {
    const w = this.ctx.world;
    const id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
    if (m & 8) return;
    w.setBlock(x, y, z, id, m | 8, false);
    this.ctx.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5, pitch: 0.6 });
    updatePowerAround(w, x, y, z, (ox, oy, oz, open) => this.ctx.audio.play(open ? 'door_open' : 'door_close', { x: ox + 0.5, y: oy + 0.5, z: oz + 0.5 }));
    this.host.pressButton?.(x, y, z, seconds);
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
        if (use === 'water_bucket' && ctx.dimension === 'nether') {
          // l'eau s'évapore instantanément dans le Nether
          ctx.audio.play('extinguish', { x, y, z });
          ctx.particles.burst('smoke', x + 0.5, y + 0.5, z + 0.5, 12);
        } else w.setBlock(x, y, z, use === 'water_bucket' ? B.WATER : B.LAVA, 0);
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
      case 'ender_eye': {
        // sur un cadre de portail de l'End : l'œil s'y insère (les 12 ouvrent le portail)
        if (t) {
          const r = insertEye(w, t.x, t.y, t.z);
          if (r) {
            if (!p.creative) inv.takeFromSlot(inv.selected, 1);
            ctx.audio.play(r === 'opened' ? 'portal' : 'pop', { x: t.x, y: t.y, z: t.z, volume: 1 });
            if (r === 'opened') ctx.hud.toast("Le portail de l'End s'ouvre !", 'achievement');
            return true;
          }
        }
        if (ctx.dimension !== 'overworld' || !this.host.throwEye) return false;
        this.host.throwEye();
        if (!p.creative) inv.takeFromSlot(inv.selected, 1);
        return true;
      }
      case 'spawn_egg': {
        const def = ItemRegistry.get(itemId);
        if (!t || !def?.target) return false;
        const m = this.entities.spawnMob(def.target, t.x + 0.5 + t.nx, t.y + Math.max(0, t.ny) + (t.ny < 0 ? -2 : 0), t.z + 0.5 + t.nz, { persistent: true });
        if (m && !p.creative) inv.takeFromSlot(inv.selected, 1);
        return !!m;
      }
      case 'throw': {
        // objet lancé (avion en papier, boule de neige…) dans la direction du regard
        const def = ItemRegistry.get(itemId);
        const pd = def?.projectile ? PROJECTILE_DEFS.get(def.projectile) : undefined;
        if (!pd) return false;
        const [ox, oy, oz, dx, dy, dz] = this.eye();
        const pr = this.entities.spawnProjectile('custom', ox + dx * 0.6, oy + dy * 0.6, oz + dz * 0.6, dx * 18, dy * 18 + 1.5, dz * 18, pd.damage, true, pd);
        pr.owner = p;
        ctx.audio.play('paper_whoosh', { x: ox, y: oy, z: oz });
        this.entities.combat.swing = 1;
        if (!p.creative) inv.takeFromSlot(inv.selected, 1);
        return true;
      }
      case 'ignite': {
        // briquet : allume un portail dans un cadre d'obsidienne, sinon pose du feu
        if (!t) return false;
        const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
        if (w.getBlock(x, y, z) !== B.AIR) return false;
        // plume encrée : ouvre un cadre de papier mâché (la Pâte à papier), jamais de feu
        if (itemId === 'quill') {
          const open = tryLight(w, x, y, z, 'paper');
          if (!open) return false;
          this.host.portalLit?.(open);
          ctx.audio.play('portal', { x, y, z, volume: 0.7, pitch: 1.6 });
          ctx.particles.burst('magic', x + 0.5, y + 1, z + 0.5, 20);
          if (!p.creative) inv.damageSelected(1);
          return true;
        }
        const lit = tryLight(w, x, y, z);
        if (lit) {
          this.host.portalLit?.(lit);
          ctx.audio.play('portal', { x, y, z, volume: 0.7 });
        } else {
          if (!BlockRegistry.has('fire') || !BlockRegistry.solid[t.block]) return false;
          w.setBlock(x, y, z, BlockRegistry.byName('fire').id, 0);
          this.host.fireLit?.(x, y, z);
        }
        ctx.audio.play('ignite', { x, y, z });
        if (!p.creative) inv.damageSelected(1);
        return true;
      }
      default:
        void itemId;
        return false;
    }
  }

  /** Frapper une boule de feu (ghast, blaze) la renvoie dans la direction visée. */
  private deflectProjectile() {
    const ctx = this.ctx;
    const [ox, oy, oz, dx, dy, dz] = this.eye();
    for (const e of this.entities.entities) {
      if (e.kind !== 'projectile') continue;
      const pr = e as unknown as { fromPlayer: boolean; def?: { explode?: number; fire?: boolean }; x: number; y: number; z: number; body: { vx: number; vy: number; vz: number }; owner: unknown };
      if (pr.fromPlayer || !pr.def || !(pr.def.explode || pr.def.fire)) continue;
      const vx = pr.x - ox, vy = pr.y - oy, vz = pr.z - oz;
      const t = vx * dx + vy * dy + vz * dz;
      if (t < 0 || t > 4.5) continue;
      const px = ox + dx * t - pr.x, py = oy + dy * t - pr.y, pz = oz + dz * t - pr.z;
      if (Math.hypot(px, py, pz) > 1.2) continue;
      const sp = Math.max(12, Math.hypot(pr.body.vx, pr.body.vy, pr.body.vz));
      pr.body.vx = dx * sp;
      pr.body.vy = dy * sp;
      pr.body.vz = dz * sp;
      pr.fromPlayer = true;
      pr.owner = ctx.player;
      ctx.audio.play('hit', { x: pr.x, y: pr.y, z: pr.z });
      return;
    }
  }

  private shootBow(charge: number) {
    const ctx = this.ctx;
    const p = ctx.player;
    const bow = p.inventory.selectedStack;
    // Infinité : une flèche suffit (elle n'est pas consommée)
    const infinite = enchLevel(bow, 'infinity') > 0 && p.inventory.count('arrow') > 0;
    if (!p.creative && !infinite && !p.inventory.remove('arrow', 1)) {
      ctx.hud.toast('Pas de flèches', 'warn');
      return;
    }
    const [ox, oy, oz, dx, dy, dz] = this.eye();
    const sp = 12 + charge * 22;
    // Puissance : +25 % de dégâts par niveau (+25 %)
    const power = enchLevel(bow, 'power');
    const dmg = (2 + charge * 7) * (power ? 1 + 0.25 * (power + 1) : 1);
    const arrow = this.entities.spawnProjectile('player_arrow', ox + dx * 0.5, oy + dy * 0.5 - 0.1, oz + dz * 0.5, dx * sp, dy * sp, dz * sp, dmg, true);
    arrow.pickable = !p.creative && !infinite;
    arrow.punch = enchLevel(bow, 'punch');
    arrow.flame = enchLevel(bow, 'flame') > 0;
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
