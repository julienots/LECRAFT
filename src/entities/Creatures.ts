import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { Animal } from './Animal';
import type { EntitySpawner, Mob } from './Mob';
import { AIState } from '../ai/StateMachine';
import { B, BlockRegistry, SHAPES } from '../blocks/BlockRegistry';
import { findBed, villagerWantsBed, type Cell } from '../ai/Behaviors';
import { raycastBlocks } from '../util/Raycast';
import { ENCHANT_BY_ID, randomEnchantedBook } from '../inventory/Enchantments';

/**
 * Enderman : neutre, se met en colère quand le joueur le regarde dans les yeux, se téléporte
 * quand il est blessé ou mouillé (l'eau le blesse), et déplace parfois des blocs de terre/sable.
 */
export class Enderman extends Animal {
  carried = 0;
  private stareTimer = 0;
  private wanderTp = 5 + Math.random() * 10;
  private chaseTp = 0;
  private dodgeTp = 0;

  /** Les projectiles ne le blessent pas (il les esquive en se téléportant, voir dodgeProjectiles). */
  get armored() {
    return true;
  }

  /** Mort : lâche le bloc qu'il transportait. */
  protected onDeath(_ctx: GameContext) {
    if (this.carried) {
      const key = BlockRegistry.get(this.carried)?.key;
      if (key) this.spawner.spawnItem(key, 1, this.x, this.y + 1, this.z);
      this.carried = 0;
    }
  }

  /** Le joueur regarde-t-il la tête de l'enderman (sans obstacle) ? */
  private lookedAt(ctx: GameContext): boolean {
    const p = ctx.player;
    const cp = Math.cos(p.pitch);
    const lx = -Math.sin(p.yaw) * cp, ly = Math.sin(p.pitch), lz = -Math.cos(p.yaw) * cp;
    const ex = p.x, ey = p.y + p.eyeHeight, ez = p.z;
    const hx = this.x - ex, hy = this.y + 2.55 - ey, hz = this.z - ez;
    const d = Math.hypot(hx, hy, hz) || 1;
    const dot = (hx * lx + hy * ly + hz * lz) / d;
    if (dot <= 1 - 0.025 / d) return false;
    const hit = raycastBlocks(ctx.world, ex, ey, ez, hx / d, hy / d, hz / d, d);
    return !hit || !BlockRegistry.opaque[hit.block];
  }

  /** Esquive : une flèche / un projectile du joueur arrive sur lui → téléportation. */
  private dodgeProjectiles(ctx: GameContext) {
    const list = (ctx as unknown as { entities?: { entities: { kind: string; fromPlayer?: boolean; removed: boolean; stuck?: boolean; x: number; y: number; z: number }[] } }).entities?.entities ?? [];
    for (const e of list) {
      if (e.kind !== 'projectile' || e.removed || e.stuck || !e.fromPlayer) continue;
      if (Math.hypot(e.x - this.x, e.y - (this.y + 1.45), e.z - this.z) < 2.5) {
        this.dodgeTp = 0.5;
        this.teleportRandom(ctx, 16);
        return;
      }
    }
  }

  protected customUpdate(ctx: GameContext, dt: number) {
    super.customUpdate(ctx, dt);
    const p = ctx.player;
    // regard du joueur sur la tête (à moins de 64 blocs, sans obstacle) ; une citrouille sculptée portée protège
    const pumpkin = p.inventory.armor.head?.id === 'carved_pumpkin';
    if (!p.dead && !p.creative && this.anger <= 0 && this.distToPlayer < 64 && !pumpkin) {
      if (this.lookedAt(ctx)) {
        this.stareTimer += dt;
        if (this.stareTimer > 0.25) {
          this.anger = 30;
          this.ai.lastSeenX = p.x;
          this.ai.lastSeenZ = p.z;
          this.ai.fsm.set(AIState.CHASE);
          ctx.audio.play('enderman_scream', { x: this.x, y: this.y + 2, z: this.z });
        }
      } else this.stareTimer = 0;
    }
    // en colère : se téléporte si on le fixe de près (< 4 blocs), et vers le joueur s'il est à plus de 16 blocs
    this.chaseTp -= dt;
    if (this.anger > 0 && !p.dead && this.chaseTp <= 0) {
      if (this.distToPlayer < 4 && this.lookedAt(ctx)) {
        this.chaseTp = 1;
        this.teleportRandom(ctx, 16);
      } else if (this.distToPlayer > 16) {
        this.chaseTp = 1.5;
        this.teleportNear(ctx, p.x, p.z, 4);
      }
    }
    this.dodgeTp -= dt;
    if (this.dodgeTp <= 0) this.dodgeProjectiles(ctx);
    // en plein jour à découvert : téléportation aléatoire de temps en temps (il abandonne sa cible)
    if (ctx.dimension === 'overworld' && ctx.dayCycle.daylight > 0.8 && Math.random() < dt * 0.15 && ctx.world.getLight(Math.floor(this.x), Math.floor(this.y + 2), Math.floor(this.z)).sky >= 15) {
      this.anger = 0;
      this.teleportRandom(ctx, 32);
    }
    // l'eau (et la pluie) le blessent : il se téléporte
    if (this.body.inWater || (ctx.raining() && ctx.world.getLight(Math.floor(this.x), Math.floor(this.y + 2), Math.floor(this.z)).sky >= 15 && ctx.dimension === 'overworld')) {
      ctx.combat.damageMob(this, dt, { kind: 'environment' });
      this.teleportRandom(ctx, 32);
    }
    // téléportations spontanées et vers le joueur quand il est en colère et loin
    this.wanderTp -= dt;
    if (this.wanderTp <= 0) {
      this.wanderTp = 8 + Math.random() * 20;
      if (this.anger <= 0 && Math.random() < 0.3) this.teleportRandom(ctx, 16);
    }
    // ramasse / pose des blocs (herbe, terre, sable, gravier, citrouille, melon)
    if (ctx.gamerules.mobGriefing !== false && Math.random() < dt / 30) {
      const bx = Math.floor(this.x + (Math.random() - 0.5) * 4), by = Math.floor(this.y + Math.random() * 3 - 1), bz = Math.floor(this.z + (Math.random() - 0.5) * 4);
      const b = ctx.world.getBlock(bx, by, bz);
      if (!this.carried && [B.GRASS_BLOCK, B.DIRT, B.SAND, B.GRAVEL, B.PUMPKIN, B.MELON, B.CLAY].includes(b) && ctx.world.getBlock(bx, by + 1, bz) === B.AIR) {
        this.carried = b === B.GRASS_BLOCK ? B.DIRT : b;
        ctx.world.setBlock(bx, by, bz, B.AIR);
      } else if (this.carried && b === B.AIR && ctx.world.isSolid(bx, by - 1, bz)) {
        ctx.world.setBlock(bx, by, bz, this.carried);
        this.carried = 0;
      }
    }
  }

  /**
   * Blessé : comme le jeu Java, il se téléporte (9 fois sur 10) quand les dégâts ne viennent pas d'une
   * créature (feu, lave, eau…) ; un coup d'épée ne le fait pas fuir.
   */
  onHurt(ctx: GameContext) {
    if (!this.dead && (this.fireTime > 0 || this.body.inLava || this.body.inWater) && Math.random() < 0.9) this.teleportRandom(ctx, 32);
  }

  teleportRandom(ctx: GameContext, r: number) {
    this.teleportNear(ctx, this.x + (Math.random() - 0.5) * 2 * r, this.z + (Math.random() - 0.5) * 2 * r, 4);
  }

  teleportNear(ctx: GameContext, cx: number, cz: number, spread: number): boolean {
    const w = ctx.world;
    for (let t = 0; t < 16; t++) {
      const x = Math.floor(cx + (Math.random() - 0.5) * 2 * spread), z = Math.floor(cz + (Math.random() - 0.5) * 2 * spread);
      if (!w.isLoaded(x, z)) continue;
      for (let y = Math.floor(this.y) + 8; y > Math.floor(this.y) - 12; y--) {
        if (!w.isSolid(x, y - 1, z) || BlockRegistry.liquid[w.getBlock(x, y - 1, z)]) continue;
        if (w.getBlock(x, y, z) !== B.AIR || w.getBlock(x, y + 1, z) !== B.AIR || w.getBlock(x, y + 2, z) !== B.AIR) continue;
        ctx.particles.burst('magic', this.x, this.y + 1.4, this.z, 16);
        this.body.setPos(x + 0.5, y, z + 0.5);
        this.body.vx = this.body.vz = 0;
        ctx.particles.burst('magic', this.x, this.y + 1.4, this.z, 16);
        ctx.audio.play('enderman_tp', { x: this.x, y: this.y, z: this.z });
        return true;
      }
    }
    return false;
  }
}

/** PV d'un loup apprivoisé. */
export const WOLF_TAMED_HEALTH = 40;

/**
 * Loup : neutre (la meute attaque si on en frappe un). Apprivoisé avec des os (1 chance sur 3) :
 * suit son maître, se téléporte près de lui s'il est loin, s'assoit / se relève quand on
 * interagit, attaque les créatures qui blessent son maître ou que son maître attaque.
 */
export class Wolf extends Animal {
  tamed = false;
  sitting = false;
  target: Mob | null = null;
  private biteTimer = 0;
  private following = false;

  constructor(def: MobDef, index: number, x: number, y: number, z: number, spawner: EntitySpawner) {
    super(def, index, x, y, z, spawner);
  }

  get skinKey() {
    return this.tamed ? 'wolf_tame' : this.anger > 0 ? 'wolf_angry' : 'wolf';
  }

  /** Os : tentative d'apprivoisement. Viande : soigne un loup apprivoisé. */
  interact(ctx: GameContext, itemId: string | null): 'tamed' | 'failed' | 'sit' | 'healed' | null {
    if (this.dead) return null;
    if (!this.tamed) {
      if (itemId !== 'bone' || this.anger > 0) return null;
      if (Math.random() < 1 / 3) {
        this.tame(ctx);
        return 'tamed';
      }
      ctx.particles.burst('smoke', this.x, this.y + 0.8, this.z, 6);
      return 'failed';
    }
    if (itemId && this.def.food?.includes(itemId)) {
      // en pleine santé, la viande le met en mode « amour » (reproduction, voir Animal.feed)
      if (this.health >= this.maxHealth) return null;
      this.health = Math.min(this.maxHealth, this.health + 4);
      ctx.particles.burst('hearts', this.x, this.y + 0.8, this.z, 3);
      return 'healed';
    }
    this.sitting = !this.sitting;
    this.target = null;
    return 'sit';
  }

  tame(ctx: GameContext) {
    this.tamed = true;
    this.persistent = true;
    this.anger = 0;
    // 40 PV une fois apprivoisé (Java 1.20.5+)
    this.maxHealthOverride = WOLF_TAMED_HEALTH;
    this.health = WOLF_TAMED_HEALTH;
    this.sitting = true;
    this.dynProps.set('__tamed', true);
    ctx.particles.burst('hearts', this.x, this.y + 0.8, this.z, 7);
    ctx.audio.play('bark', { x: this.x, y: this.y, z: this.z });
  }

  private skinShown = '';
  render(ctx: GameContext, alpha: number, t: number) {
    super.render(ctx, alpha, t);
    const k = this.skinKey;
    if (k !== this.skinShown) {
      this.skinShown = k;
      this.model.material.map = ctx.skins.skin(k);
      this.model.material.needsUpdate = true;
    }
    // assis : arrière-train abaissé
    this.model.group.rotation.x = this.sitting ? -0.45 : 0;
    if (this.sitting) this.model.group.position.y -= 0.12;
  }

  protected customUpdate(ctx: GameContext, dt: number) {
    super.customUpdate(ctx, dt);
    if (!this.tamed && this.dynProps.get('__tamed')) {
      this.sitting = !!this.dynProps.get('__sitting');
      this.tamed = true;
      this.maxHealthOverride = WOLF_TAMED_HEALTH;
    }
    if (!this.tamed) return;
    this.dynProps.set('__sitting', this.sitting);
    const p = ctx.player;
    // l'IA de base est neutralisée : comportement de compagnon
    this.anger = 0;
    this.ai.fsm.set(AIState.IDLE);
    this.idleTime = 1e9;
    this.biteTimer -= dt;
    if (this.sitting) {
      this.ai.stop();
      return;
    }
    // défend son maître contre ce qui l'a blessé
    const la = p.lastAttacker as Mob | null;
    if (la && la !== (this as unknown as Mob) && !la.dead && performance.now() - p.lastAttackedAt < 5000 && 'def' in la && la.def.key !== 'wolf') this.target = la;
    if (this.target && (this.target.dead || this.target.removed || Math.hypot(this.target.x - this.x, this.target.z - this.z) > 24)) this.target = null;
    if (this.target) {
      const t = this.target;
      const d = Math.hypot(t.x - this.x, t.z - this.z);
      if (d > 1.3) this.ai.navigateTo(t.x, t.y, t.z, 1.2);
      else {
        this.ai.stop();
        this.yaw = Math.atan2(t.x - this.x, t.z - this.z);
        if (this.biteTimer <= 0) {
          this.biteTimer = 0.8;
          this.attackAnim = 1;
          ctx.combat.damageMob(t, this.def.damage, { kind: 'environment', knockX: (t.x - this.x) / (d || 1) * 3, knockZ: (t.z - this.z) / (d || 1) * 3 });
        }
      }
      return;
    }
    const d = this.distToPlayer;
    // FollowOwnerGoal(1.0, 10, 2) : suit à partir de 10 blocs jusqu'à 2 blocs ; téléportation au-delà de 12
    if (d > 12 && !p.dead) {
      // trop loin : se téléporte près du maître
      const x = Math.floor(p.x + (Math.random() - 0.5) * 3), z = Math.floor(p.z + (Math.random() - 0.5) * 3);
      if (ctx.world.isSolid(x, Math.floor(p.y) - 1, z) && ctx.world.getBlock(x, Math.floor(p.y), z) === B.AIR) this.body.setPos(x + 0.5, Math.floor(p.y), z + 0.5);
      this.following = false;
    } else if (d > 10 || (this.following && d > 2)) {
      this.following = true;
      this.ai.navigateTo(p.x, p.y, p.z, 1.1);
    } else {
      this.following = false;
      this.ai.stop();
    }
  }
}

/** Échanges d'un villageois : [ce que le joueur donne (n), ce qu'il reçoit (n)]. */
export type Trade = { give: [string, number]; get: [string, number]; give2?: [string, number]; meta?: Record<string, unknown> };
export const PROFESSIONS: Record<string, { name: string; trades: Trade[] }> = {
  farmer: { name: 'Fermier', trades: [{ give: ['wheat', 20], get: ['emerald', 1] }, { give: ['carrot', 22], get: ['emerald', 1] }, { give: ['potato', 26], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['bread', 6] }, { give: ['emerald', 1], get: ['apple', 4] }, { give: ['pumpkin', 6], get: ['emerald', 1] }] },
  librarian: { name: 'Bibliothécaire', trades: [{ give: ['paper', 24], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['bookshelf', 1] }, { give: ['book', 4], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['lantern', 1] }, { give: ['emerald', 5], get: ['compass', 1] }] },
  armorer: { name: 'Armurier', trades: [{ give: ['coal', 15], get: ['emerald', 1] }, { give: ['emerald', 5], get: ['iron_helmet', 1] }, { give: ['emerald', 9], get: ['iron_chestplate', 1] }, { give: ['iron_ingot', 4], get: ['emerald', 1] }, { give: ['emerald', 13], get: ['diamond_chestplate', 1] }] },
  toolsmith: { name: 'Fabricant d’outils', trades: [{ give: ['coal', 15], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['stone_axe', 1] }, { give: ['emerald', 1], get: ['stone_pickaxe', 1] }, { give: ['iron_ingot', 4], get: ['emerald', 1] }, { give: ['emerald', 6], get: ['iron_pickaxe', 1] }, { give: ['emerald', 17], get: ['diamond_pickaxe', 1] }] },
  cleric: { name: 'Prêtre', trades: [{ give: ['rotten_flesh', 32], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['redstone', 2] }, { give: ['gold_ingot', 3], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['lapis_lazuli', 1] }, { give: ['emerald', 5], get: ['ender_pearl', 1] }] },
  butcher: { name: 'Boucher', trades: [{ give: ['chicken', 14], get: ['emerald', 1] }, { give: ['porkchop', 7], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['cooked_porkchop', 5] }, { give: ['coal', 15], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['cooked_chicken', 8] }] },
  fletcher: { name: 'Archer', trades: [{ give: ['stick', 32], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['arrow', 16] }, { give: ['flint', 26], get: ['emerald', 1] }, { give: ['emerald', 2], get: ['bow', 1] }, { give: ['string', 14], get: ['emerald', 1] }] },
  cartographer: { name: 'Cartographe', trades: [{ give: ['paper', 24], get: ['emerald', 1] }, { give: ['emerald', 7], get: ['map', 1] }, { give: ['glass_pane', 11], get: ['emerald', 1] }, { give: ['compass', 1], get: ['emerald', 1] }, { give: ['emerald', 5], get: ['item_frame', 1] }] },
  fisherman: { name: 'Pêcheur', trades: [{ give: ['string', 20], get: ['emerald', 1] }, { give: ['coal', 10], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['cooked_cod', 6] }, { give: ['cod', 15], get: ['emerald', 1] }, { give: ['emerald', 3], get: ['campfire', 1] }, { give: ['salmon', 13], get: ['emerald', 1] }] },
  mason: { name: 'Maçon', trades: [{ give: ['clay_ball', 10], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['bricks', 10] }, { give: ['stone', 20], get: ['emerald', 1] }, { give: ['emerald', 1], get: ['chiseled_stone_bricks', 4] }, { give: ['emerald', 1], get: ['polished_andesite', 4] }, { give: ['quartz', 12], get: ['emerald', 1] }] },
  shepherd: { name: 'Berger', trades: [{ give: ['white_wool', 18], get: ['emerald', 1] }, { give: ['emerald', 2], get: ['shears', 1] }, { give: ['emerald', 1], get: ['red_wool', 1] }, { give: ['emerald', 3], get: ['white_bed', 1] }, { give: ['emerald', 1], get: ['blue_carpet', 4] }] },
  leatherworker: { name: 'Maroquinier', trades: [{ give: ['leather', 6], get: ['emerald', 1] }, { give: ['emerald', 3], get: ['leather_chestplate', 1] }, { give: ['emerald', 5], get: ['leather_helmet', 1] }, { give: ['flint', 26], get: ['emerald', 1] }, { give: ['emerald', 6], get: ['saddle', 1] }] },
  weaponsmith: { name: 'Forgeron d’armes', trades: [{ give: ['coal', 15], get: ['emerald', 1] }, { give: ['emerald', 3], get: ['iron_axe', 1] }, { give: ['iron_ingot', 4], get: ['emerald', 1] }, { give: ['emerald', 7], get: ['iron_sword', 1] }, { give: ['diamond', 1], get: ['emerald', 1] }, { give: ['emerald', 17], get: ['diamond_sword', 1] }] },
};

/** Lits réservés (clé de case → identifiant du villageois). */
const BED_CLAIMS = new Map<string, number>();
const bedKey = (c: Cell) => `${c[0]},${c[1]},${c[2]}`;

/** Villageois : erre dans le village, regarde le joueur, propose des échanges selon sa profession. */
export class Villager extends Animal {
  /**
   * Échanges du villageois. Le bibliothécaire vend en plus un livre enchanté qui lui est propre
   * (comme le jeu original : émeraudes selon le niveau, plus un livre).
   */
  trades(): Trade[] {
    const list = [...PROFESSIONS[this.profession].trades];
    if (this.profession === 'librarian') {
      let book = this.dynProps.get('__book') as string | undefined;
      if (!book) {
        const st = randomEnchantedBook(true);
        const [id, lvl] = Object.entries(st.meta!.ench as Record<string, number>)[0];
        const treasure = ENCHANT_BY_ID.get(id)?.treasure ?? false;
        const price = Math.min(64, (2 + 3 * lvl + Math.floor(Math.random() * (5 + lvl * 10))) * (treasure ? 2 : 1));
        book = JSON.stringify({ id, lvl, price });
        this.dynProps.set('__book', book);
        this.persistent = true;
      }
      const b = JSON.parse(book) as { id: string; lvl: number; price: number };
      list.push({ give: ['emerald', b.price], give2: ['book', 1], get: ['enchanted_book', 1], meta: { ench: { [b.id]: b.lvl } } });
    }
    return list;
  }

  get profession(): string {
    let p = this.dynProps.get('__profession') as string | undefined;
    if (!p || !PROFESSIONS[p]) {
      const keys = Object.keys(PROFESSIONS);
      p = keys[Math.floor(Math.random() * keys.length)];
      this.dynProps.set('__profession', p);
      this.persistent = true;
    }
    return p;
  }

  /** Lit réservé (clé de case) et état de sommeil. */
  private bed: Cell | null = null;
  sleeping = false;
  private bedSearch = Math.random() * 3;

  protected customUpdate(ctx: GameContext, dt: number) {
    super.customUpdate(ctx, dt);
    if (this.dead) return this.releaseBed();
    if (this.routine(ctx, dt)) return;
    // reste près de son village (point d'origine)
    if (Math.hypot(this.x - this.homeX, this.z - this.homeZ) > 24 && this.ai.state === AIState.WANDER) this.ai.navigateTo(this.homeX, this.y, this.homeZ, 0.6);
    if (this.distToPlayer < 4 && !ctx.player.dead && this.ai.state === AIState.IDLE) this.ai.facePlayer();
  }

  private releaseBed() {
    if (this.bed && BED_CLAIMS.get(bedKey(this.bed)) === this.id) BED_CLAIMS.delete(bedKey(this.bed));
    this.bed = null;
    this.sleeping = false;
  }

  /**
   * Routine de la nuit (Activity.REST du jeu Java) : le villageois rejoint un lit libre du village et s'y
   * couche jusqu'au jour ; une panique, un coup ou un monstre proche le réveille. Vrai s'il garde la main.
   */
  private routine(ctx: GameContext, dt: number): boolean {
    const w = ctx.world;
    const panicking = this.fleeTimer > 0 || this.hurtTimer > 0 || this.ai.state === AIState.FLEE;
    const wants = ctx.dimension === 'overworld' && villagerWantsBed(ctx.dayCycle.isNight, panicking);
    if (!wants) {
      if (this.bed) {
        const wasAsleep = this.sleeping;
        this.releaseBed();
        if (wasAsleep) this.ai.fsm.set(AIState.IDLE);
      }
      return false;
    }
    this.bedSearch -= dt;
    if (!this.bed) {
      if (this.bedSearch > 0) return false;
      this.bedSearch = 3 + Math.random() * 3;
      const near = Math.hypot(this.x - this.homeX, this.z - this.homeZ) < 40;
      if (!near) return false;
      // les lits proches du villageois, libres (réservés par un autre = exclus)
      const spot = findBed(w, this.x, this.y, this.z, 24, (k) => {
        const c = BED_CLAIMS.get(k);
        return c !== undefined && c !== this.id;
      });
      if (!spot) return false;
      this.bed = spot;
      BED_CLAIMS.set(bedKey(spot), this.id);
    }
    const [bx, by, bz] = this.bed;
    // lit détruit : on en cherchera un autre
    const cur = w.getBlock(bx, by, bz);
    if (cur <= 0 || BlockRegistry.shape[cur] !== SHAPES.indexOf('bed') + 1) {
      this.releaseBed();
      return false;
    }
    if (this.sleeping) {
      this.ai.fsm.set(AIState.IDLE);
      this.idleTime = 1e9;
      this.ai.stop();
      this.body.vx = this.body.vz = 0;
      return true;
    }
    const d = Math.hypot(bx + 0.5 - this.x, bz + 0.5 - this.z);
    if (d < 1.1 && Math.abs(by - this.y) < 1.6) {
      this.sleeping = true;
      this.body.setPos(bx + 0.5, by + 0.5625, bz + 0.5);
      return true;
    }
    this.ai.fsm.set(AIState.IDLE);
    this.idleTime = 1e9;
    this.ai.navigateTo(bx + 0.5, by, bz + 0.5, 0.7);
    // chemin impossible vers ce lit : il l'abandonne après quelques essais
    if (this.ai.stuckCount >= 3) {
      this.releaseBed();
      this.bedSearch = 10;
    }
    return true;
  }

  render(ctx: GameContext, alpha: number, t: number) {
    super.render(ctx, alpha, t);
    // couché dans son lit : corps à l'horizontale
    if (this.sleeping) {
      this.model.group.rotation.x = -Math.PI / 2;
      this.model.group.position.y += 0.15;
    } else this.model.group.rotation.x = 0;
  }
}
