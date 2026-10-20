import type { Difficulty, GameMode } from '../core/Config';
import { enchLevel, protectionFactor } from '../inventory/Enchantments';
import { ARMOR_SLOTS, Inventory } from '../inventory/Inventory';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { clamp } from '../util/math';
import { PlayerPhysics, EYE_HEIGHT, SNEAK_EYE_HEIGHT } from './PlayerPhysics';
import { EffectList, type ActiveEffect } from '../entities/Effects';
import { hooks, damageCause, type Actor } from '../scripting/Hooks';
import type { Entity } from '../entities/Entity';

/**
 * Formule d'armure du jeu de référence (CombatRules.getDamageAfterAbsorb, Java 1.21) :
 * dégâts × (1 − min(20, max(armure/5, armure − 4·dégâts/(robustesse + 8)))/25).
 */
export function armorReduce(damage: number, armor: number, toughness = 0): number {
  const eff = Math.min(20, Math.max(armor / 5, armor - (4 * damage) / (toughness + 8)));
  return damage * (1 - eff / 25);
}

/** Dégâts de chute (LivingEntity.calculateFallDamage) : ⌈(distance − 3 − Saut amélioré) × facteur⌉. */
export function fallDamage(distance: number, jumpBoost = 0, multiplier = 1): number {
  const d = (distance - 3 - jumpBoost) * multiplier;
  return d > 1e-6 ? Math.ceil(d - 1e-6) : 0;
}

/** Points d'expérience pour passer au niveau suivant (Player.getXpNeededForNextLevel). */
export function xpForLevel(level: number): number {
  return level >= 30 ? 112 + (level - 30) * 9 : level >= 15 ? 37 + (level - 15) * 5 : 7 + level * 2;
}

/** Dégâts des créatures selon la difficulté (Player.hurt) : facile min(d/2+1, d), difficile ×1,5. */
export function difficultyScale(amount: number, difficulty: Difficulty): number {
  if (difficulty === 'peaceful') return 0;
  if (difficulty === 'easy') return Math.min(amount / 2 + 1, amount);
  if (difficulty === 'hard') return amount * 1.5;
  return amount;
}

/** Robustesse d'armure par matériau (diamant 2, netherite 3 par pièce). */
const TOUGHNESS: Record<string, number> = { diamond: 2, netherite: 3 };
/** Résistance au recul par matériau (netherite 0,1 par pièce). */
const KB_RESIST: Record<string, number> = { netherite: 0.1 };

export type DamageSource = 'mob' | 'fall' | 'lava' | 'drown' | 'starve' | 'contact' | 'void' | 'projectile' | 'boss' | 'fire' | 'explosion' | 'player';

export interface PlayerSnapshot {
  x: number; y: number; z: number; yaw: number; pitch: number;
  health: number; hunger: number; saturation: number; exhaustion: number; air: number;
  xp: number; level: number; spawn: [number, number, number];
  inventory: ReturnType<Inventory['serialize']>; flying: boolean;
  effects?: ActiveEffect[]; tags?: string[]; dynProps?: Record<string, unknown>;
  enderChest?: (import('../inventory/Item').ItemStack | null)[]; enchantSeed?: number;
}

/**
 * Joueur : état de survie (santé, faim, air), progression (XP/niveaux), inventaire.
 * La physique est dans PlayerPhysics, les contrôles dans PlayerController,
 * les interactions (minage, pose, attaque) dans PlayerInteraction.
 */
export class Player {
  readonly body = new PlayerPhysics();
  readonly inventory = new Inventory();
  /** Effets de statut, étiquettes (/tag) et propriétés dynamiques (scripts d'add-ons). */
  readonly effects = new EffectList();
  readonly tags = new Set<string>();
  readonly dynProps = new Map<string, unknown>();
  readonly id = 0;
  name = 'Joueur';
  nameTag = '';
  private tickNo = 0;
  yaw = 0;
  pitch = 0;
  health = 20;
  hunger = 20;
  saturation = 5;
  exhaustion = 0;
  air = 300; // ticks
  xp = 0;
  level = 0;
  /** Graine des propositions de la table d'enchantement (change après chaque enchantement). */
  enchantSeed = (Math.random() * 2 ** 31) | 0;
  /** Coffre de l'Ender : inventaire personnel partagé par tous les coffres de l'Ender. */
  readonly enderChest = new Inventory(27);
  spawn: [number, number, number] = [0.5, 80, 0.5];
  dead = false;
  invulnerable = 0; // secondes d'invincibilité restantes
  hurtFlash = 0;
  /** Ralentissement (givre) restant en secondes. */
  slowTimer = 0;
  /** Poison (araignée venimeuse) et régénération (pomme dorée), en secondes. */
  poisonTimer = 0;
  regenEffect = 0;
  /** Règles du jeu appliquées par la session. */
  naturalRegen = true;
  fallDamage = true;
  private effectTick = 0;
  /** Minuteries de la faim (FoodData.tickTimer, en ticks). */
  regenTimer = 0;
  starveTimer = 0;
  /** Feu sur le joueur (ticks restants), comme Entity.remainingFireTicks. */
  fireTicks = 0;
  /** Facteur des dégâts de chute du bloc d'atterrissage (foin, miel 0,2 ; lit 0,5 ; slime 0). */
  fallMultiplier = 1;
  /** Dégâts du dernier coup encaissé (règle des coups pendant l'invincibilité). */
  private lastHurt = 0;
  private bypassArmor = false;
  private peacefulTick = 0;
  sneaking = false;
  sprinting = false;
  /** Nage rapide (sprint sous l'eau) : corps à l'horizontale, 0,6 bloc de haut. */
  swimming = false;
  /** Rampe (sortie de nage sous un plafond bas). */
  crawling = false;
  /** Dernière cause de mort (écran de mort). */
  deathCause: DamageSource | null = null;
  /** Dernière créature qui a blessé le joueur (loups apprivoisés). */
  lastAttacker: Actor | null = null;
  lastAttackedAt = 0;
  onDamage: (amount: number, source: DamageSource) => void = () => {};
  onDeath: () => void = () => {};
  onLevelUp: (level: number) => void = () => {};

  constructor(public gameMode: GameMode, public difficulty: Difficulty) {}

  get maxHealth() {
    // 20 PV comme le jeu de référence (+4 par niveau de Bonus de vie)
    return 20 + 4 * this.effects.level('health_boost');
  }
  private lastMaxHealth = 20;
  /** Vol plané en élytres (tenu à jour par le contrôleur). */
  gliding = false;
  /** Bouclier levé : les coups et projectiles venus de face sont bloqués. */
  blocking = false;
  /** Bouclier désactivé par un coup de hache (secondes). */
  shieldCooldown = 0;
  /** Objet en cours d'utilisation (manger, boire, arc, bouclier…) : le joueur ralentit, comme le jeu original. */
  usingItem = false;
  /** Coup bloqué par le bouclier (son, recul de l'attaquant ; branché par la session). */
  onShieldBlock: (attacker: Actor | null, broken: boolean) => void = () => {};
  /** Points de vie d'absorption (cœurs dorés), consommés avant la santé. */
  absorption = 0;
  /** Épines : l'attaquant au corps à corps est blessé (branché par la session). */
  onThorns: (attacker: Actor, dmg: number) => void = () => {};
  /** Totem d'immortalité utilisé (effets visuels et sonores, branchés par la session). */
  onTotem: () => void = () => {};

  /** La source du coup est devant le joueur (position de l'attaquant, sinon sens du recul). */
  private facesSource(src: { x: number; z: number } | null, knockX: number, knockZ: number): boolean {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (src) return (src.x - this.x) * fx + (src.z - this.z) * fz > 0;
    // sans position : le recul pousse vers l'arrière quand le coup vient de face
    return knockX * fx + knockZ * fz < 0;
  }

  /** Coup bloqué : usure du bouclier (1 + dégâts, à partir de 3), une hache le désactive 5 s. */
  private blockWithShield(amount: number, attacker: Actor | null) {
    const inv = this.inventory;
    let i = inv.selectedStack?.id === 'shield' ? inv.selected : inv.slots.slice(0, 9).findIndex((st) => st?.id === 'shield');
    if (i < 0) i = inv.selected;
    const st = inv.slots[i];
    if (st?.id === 'shield' && amount >= 3 && st.durability !== undefined) {
      st.durability -= 1 + Math.floor(amount);
      if (st.durability <= 0) inv.slots[i] = null;
      inv.changed();
    }
    const axe = !!attacker && 'def' in attacker && /^(vindicator|piglin_brute)$/.test((attacker as { def: { key: string } }).def.key);
    if (axe) {
      this.shieldCooldown = 5;
      this.blocking = false;
    }
    this.onShieldBlock(attacker, axe);
  }

  /**
   * Totem d'immortalité : tenu en main (ou dans la barre d'objets, le jeu n'ayant pas de seconde
   * main), il évite la mort comme le jeu original — 1 PV, Régénération II, Absorption II, Résistance
   * au feu — et se consomme. Retourne vrai si la mort est évitée.
   */
  private tryTotem(): boolean {
    const inv = this.inventory;
    const i = inv.selectedStack?.id === 'totem_of_undying' ? inv.selected : inv.slots.slice(0, 9).findIndex((st) => st?.id === 'totem_of_undying');
    if (i < 0) return false;
    const st = inv.slots[i]!;
    st.count--;
    if (st.count <= 0) inv.slots[i] = null;
    inv.changed();
    this.health = 1;
    this.effects.clear();
    this.effects.add('regeneration', 900, 1, true, this.effectTarget);
    this.effects.add('absorption', 100, 1, true, this.effectTarget);
    this.effects.add('fire_resistance', 800, 0, true, this.effectTarget);
    this.onTotem();
    return true;
  }
  get eyeHeight() {
    return this.swimming || this.crawling || this.gliding ? 0.4 : this.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
  }
  get creative() {
    return this.gameMode === 'creative';
  }
  get x() {
    return this.body.x;
  }
  get y() {
    return this.body.y;
  }
  get z() {
    return this.body.z;
  }

  /** Applique des dégâts (armure, difficulté, invincibilité). Retourne les dégâts effectifs. */
  damage(amount: number, source: DamageSource, knockX = 0, knockZ = 0, attacker: Actor | null = null, projectile: Entity | null = null): number {
    if (this.dead || this.creative) return 0;
    if (hooks.beforeHurt) {
      amount = hooks.beforeHurt(this, amount, { cause: damageCause(source), attacker, projectile });
      if (!(amount > 0)) return 0;
    }
    let dmg = amount;
    const scaled = source === 'mob' || source === 'projectile' || source === 'boss';
    if (scaled) {
      dmg = difficultyScale(dmg, this.difficulty);
      if (dmg <= 0) return 0;
    }
    // bouclier levé : bloque tout ce qui vient de face (coups, projectiles, explosions)
    if (this.blocking && (source === 'mob' || source === 'projectile' || source === 'boss' || source === 'explosion') && this.facesSource(projectile ?? attacker, knockX, knockZ)) {
      if (this.invulnerable > 0) return 0;
      this.blockWithShield(amount, attacker);
      return 0;
    }
    // invincibilité (10 ticks) : un coup plus fort n'inflige que la différence, sans recul
    let fresh = true;
    if (this.invulnerable > 1e-6 && source !== 'void') {
      if (dmg <= this.lastHurt) return 0;
      const d = dmg - this.lastHurt;
      this.lastHurt = dmg;
      dmg = d;
      fresh = false;
    } else this.lastHurt = dmg;
    // armure (avec robustesse) : tout sauf chute, noyade, faim, vide et brûlure
    const burn = this.bypassArmor;
    const physical = !burn && source !== 'fall' && source !== 'drown' && source !== 'starve' && source !== 'void';
    if (physical) {
      let def = 0, tough = 0;
      for (const k of ARMOR_SLOTS) {
        const st = this.inventory.armor[k];
        const a = st ? ItemRegistry.get(st.id)?.armor : undefined;
        if (!a) continue;
        def += a.defense;
        tough += TOUGHNESS[a.material ?? ''] ?? 0;
      }
      if (def > 0) {
        dmg = armorReduce(dmg, def, tough);
        this.inventory.damageArmor(Math.max(1, Math.floor(amount / 4)));
      }
    }
    // Résistance (−20 % par niveau) puis enchantements de protection (EPF plafonné à 20)
    dmg *= this.effects.damageMul(source === 'lava' || source === 'fire');
    if (source !== 'void' && source !== 'starve' && source !== 'drown') {
      const kind = source === 'fall' ? 'fall' : source === 'lava' || source === 'fire' ? 'fire' : source === 'explosion' ? 'explosion' : source === 'projectile' ? 'projectile' : 'any';
      dmg *= 1 - protectionFactor(ARMOR_SLOTS.map((k) => this.inventory.armor[k]), kind);
    }
    if (dmg <= 1e-4) return 0;
    // les cœurs d'absorption encaissent d'abord
    const soak = Math.min(this.absorption, dmg);
    this.absorption -= soak;
    this.health = Math.max(0, this.health - (dmg - soak));
    if (fresh) this.invulnerable = 0.5;
    this.hurtFlash = 0.35;
    if (physical) this.addExhaustion(0.1);
    if (fresh && (knockX || knockZ)) {
      let res = 0;
      for (const k of ARMOR_SLOTS) res += KB_RESIST[ItemRegistry.get(this.inventory.armor[k]?.id ?? '')?.armor?.material ?? ''] ?? 0;
      const kr = 1 - Math.min(1, res);
      if (source === 'explosion') {
        // souffle : vitesse ajoutée (Protection contre les explosions : −15 % par niveau)
        let bp = 0;
        for (const k of ARMOR_SLOTS) bp = Math.max(bp, enchLevel(this.inventory.armor[k], 'blast_protection'));
        const f = Math.max(0, 1 - 0.15 * bp);
        this.body.vx += knockX * f;
        this.body.vz += knockZ * f;
        this.body.vy = Math.max(this.body.vy, 5 * f);
      } else if (kr > 0) {
        // LivingEntity.knockback : vitesse/2 + 0,4 bloc/tick (8 blocs/s) vers l'extérieur ;
        // un recul de 5 (coup de créature) correspond à la force 0,4 du jeu de référence
        const s = Math.hypot(knockX, knockZ) / 5;
        this.body.vx = this.body.vx / 2 + knockX * 1.6 * kr;
        this.body.vz = this.body.vz / 2 + knockZ * 1.6 * kr;
        if (this.body.onGround) this.body.vy = Math.min(8, this.body.vy / 2 + 8 * s * kr);
      }
    }
    // Épines : 15 % de chance par niveau et par pièce de renvoyer 1 à 4 dégâts à l'attaquant
    if (attacker && source === 'mob') {
      let thorns = 0;
      for (const k of ARMOR_SLOTS) {
        const l = enchLevel(this.inventory.armor[k], 'thorns');
        if (l && Math.random() < 0.15 * l) thorns += 1 + Math.floor(Math.random() * 4);
      }
      if (thorns) {
        this.inventory.damageArmor(2);
        this.onThorns(attacker, thorns);
      }
    }
    if (attacker) {
      this.lastAttacker = attacker;
      this.lastAttackedAt = performance.now();
    }
    this.onDamage(dmg, source);
    hooks.afterHurt?.(this, dmg, { cause: damageCause(source), attacker, projectile });
    if (this.health <= 0 && source !== 'void' && this.tryTotem()) return dmg;
    if (this.health <= 0) {
      this.dead = true;
      this.deathCause = source;
      hooks.died?.(this, { cause: damageCause(source), attacker, projectile });
      this.onDeath();
    }
    return dmg;
  }

  /** Adaptateur pour les effets de statut. */
  readonly effectTarget = {
    heal: (n: number) => this.heal(n),
    hurt: (n: number) => {
      if (this.creative || this.dead) return;
      this.health = Math.max(0, this.health - n);
      this.hurtFlash = 0.25;
      this.onDamage(n, 'contact');
      if (this.health <= 0 && this.tryTotem()) return;
      if (this.health <= 0) {
        this.dead = true;
        this.deathCause = 'contact';
        this.onDeath();
      }
    },
    hp: () => this.health,
    body: this.body,
    // Chute lente : gravité réduite gérée par le contrôleur (formule Java)
    ownFallPhysics: true,
    feed: (h: number, sat: number) => {
      this.hunger = Math.min(20, this.hunger + h);
      this.saturation = Math.min(this.hunger, this.saturation + sat);
    },
    exhaust: (n: number) => this.addExhaustion(n),
    absorb: (n: number) => (this.absorption = Math.max(this.absorption, n)),
  };

  heal(n: number) {
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  /** Épuisement (FoodData.addExhaustion, plafonné à 40) ; chaque tranche de 4 coûte 1 de saturation, puis de faim. */
  addExhaustion(n: number) {
    if (this.creative) return;
    this.exhaustion = Math.min(40, this.exhaustion + n);
  }

  /** Met le joueur en feu pour au moins `ticks` ticks (lave 300, feu 160). */
  setOnFire(ticks: number) {
    if (this.creative) return;
    this.fireTicks = Math.max(this.fireTicks, ticks);
  }
  get onFire() {
    return this.fireTicks > 0;
  }

  /** Mange l'objet tenu ; retourne vrai si consommé. */
  eat(itemId: string): boolean {
    const food = ItemRegistry.get(itemId)?.food;
    if (!food) return false;
    if (this.hunger >= 20 && !this.creative && !/^(golden_apple|enchanted_golden_apple|chorus_fruit|suspicious_stew|honey_bottle)$/.test(itemId)) return false;
    this.hunger = Math.min(20, this.hunger + food.hunger);
    if (food.effect === 'regen') this.regenEffect = 5;
    this.saturation = Math.min(this.hunger, this.saturation + food.saturation);
    return true;
  }

  addXp(n: number) {
    // Raccommodage : l'expérience répare d'abord un objet porté ou tenu (2 points par point d'XP)
    for (const st of [this.inventory.selectedStack, ...ARMOR_SLOTS.map((k) => this.inventory.armor[k])]) {
      if (n <= 0 || !st || st.durability === undefined || !enchLevel(st, 'mending')) continue;
      const max = ItemRegistry.maxDurability(st.id);
      const fix = Math.min(max - st.durability, n * 2);
      if (fix <= 0) continue;
      st.durability += fix;
      n -= Math.ceil(fix / 2);
      this.inventory.changed();
    }
    if (n <= 0) return;
    this.xp += n;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.onLevelUp(this.level);
    }
  }
  get xpToNext() {
    return xpForLevel(this.level);
  }

  /** Tick de survie (20 Hz). */
  tick(dt: number) {
    if (this.dead) return;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.effects.tick(this.effectTarget, this.tickNo++);
    this.effectTick += dt;
    if (this.effectTick >= 1.25) {
      this.effectTick = 0;
      if (this.poisonTimer > 0 && this.health > 1 && !this.creative) {
        this.health = Math.max(1, this.health - 1);
        this.hurtFlash = 0.2;
      }
      if (this.regenEffect > 0) this.heal(1);
    }
    this.poisonTimer = Math.max(0, this.poisonTimer - dt);
    this.regenEffect = Math.max(0, this.regenEffect - dt);
    if (this.creative) {
      this.health = this.maxHealth;
      this.hunger = 20;
      this.air = 300;
      this.fireTicks = 0;
      return;
    }
    // faim / régénération (FoodData.tick, Java 1.21) ; n = ticks écoulés
    const n = dt * 20;
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (this.difficulty !== 'peaceful') this.hunger = Math.max(0, this.hunger - 1);
    }
    const hurt = this.health > 0 && this.health < this.maxHealth;
    if (this.naturalRegen && this.saturation > 0 && hurt && this.hunger >= 20) {
      // régénération rapide : toutes les 10 ticks, jusqu'à 1 PV pour 6 d'épuisement
      this.regenTimer += n;
      if (this.regenTimer >= 10 - 1e-6) {
        const f = Math.min(this.saturation, 6);
        this.heal(f / 6);
        this.addExhaustion(f);
        this.regenTimer = 0;
      }
    } else if (this.naturalRegen && this.hunger >= 18 && hurt) {
      // régénération lente : 1 PV toutes les 4 s (80 ticks), 6 d'épuisement
      this.regenTimer += n;
      if (this.regenTimer >= 80 - 1e-6) {
        this.heal(1);
        this.addExhaustion(6);
        this.regenTimer = 0;
      }
    } else if (this.hunger <= 0) {
      // famine : 1 dégât toutes les 4 s (jusqu'à 10 PV en facile, 1 PV en normal, la mort en difficile)
      this.regenTimer += n;
      if (this.regenTimer >= 80 - 1e-6) {
        if (this.health > 10 || this.difficulty === 'hard' || (this.health > 1 && this.difficulty === 'normal')) this.damage(1, 'starve');
        this.regenTimer = 0;
      }
    } else this.regenTimer = 0;
    // paisible : +1 PV par seconde et +1 de faim toutes les 10 ticks
    if (this.difficulty === 'peaceful' && this.naturalRegen) {
      const before = this.peacefulTick;
      this.peacefulTick += n;
      if (Math.floor(this.peacefulTick / 20) > Math.floor(before / 20) && hurt) this.heal(1);
      if (Math.floor(this.peacefulTick / 10) > Math.floor(before / 10) && this.hunger < 20) this.hunger++;
    }
    if (this.shieldCooldown > 0) this.shieldCooldown = Math.max(0, this.shieldCooldown - dt);
    // fin de l'absorption ou du bonus de vie
    if (this.absorption > 0 && !this.effects.level('absorption')) this.absorption = 0;
    // le maximum baisse (fin du Bonus de vie) : la santé en trop est perdue
    const max = this.maxHealth;
    if (max < this.lastMaxHealth && this.health > max) this.health = max;
    this.lastMaxHealth = max;
    // air : −1 par tick sous l'eau (Apnée : une chance sur niveau+1 de ne rien perdre),
    // à −20 : 2 dégâts et retour à 0 (donc 2 dégâts par seconde après 15 s) ; +4 par tick à l'air
    if (this.body.headInWater && !this.effects.level('water_breathing') && !this.effects.level('conduit_power')) {
      this.air -= n / (1 + enchLevel(this.inventory.armor.head, 'respiration'));
      if (this.air <= -20) {
        this.air = 0;
        this.damage(2, 'drown');
      }
    } else this.air = clamp(this.air + n * 4, -20, 300);
    // lave : 4 dégâts (toutes les 10 ticks avec l'invincibilité)
    if (this.body.inLava) this.damage(4, 'lava');
    // feu : 1 dégât par seconde (brûlure, ignore l'armure) ; Résistance au feu l'éteint 4× plus vite
    if (this.fireTicks > 0) {
      if (this.body.inWater) this.fireTicks = 0;
      else if (this.effects.level('fire_resistance')) this.fireTicks = Math.max(0, this.fireTicks - 4 * n);
      else {
        const before = this.fireTicks;
        this.fireTicks = Math.max(0, this.fireTicks - n);
        if (Math.floor(before / 20) > Math.floor(this.fireTicks / 20) && !this.body.inLava) {
          this.bypassArmor = true;
          try {
            this.damage(1, 'fire');
          } finally {
            this.bypassArmor = false;
          }
        }
      }
    }
    // vide
    if (this.body.y < -20) this.damage(4, 'void');
    // dégâts de chute : ⌈distance − 3⌉ (Saut amélioré +1 bloc par niveau, facteur du bloc)
    if (this.body.landed > 0) {
      const d = fallDamage(this.body.landed, this.effects.level('jump_boost'), this.fallMultiplier);
      this.body.landed = 0;
      this.fallMultiplier = 1;
      if (d > 0 && !this.body.inWater && this.fallDamage && !this.effects.level('slow_falling')) this.damage(d, 'fall');
    }
  }

  respawn() {
    this.dead = false;
    this.deathCause = null;
    this.effects.clear();
    this.health = this.maxHealth;
    this.hunger = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.fireTicks = 0;
    this.regenTimer = 0;
    this.invulnerable = 3;
    this.body.setPos(this.spawn[0], this.spawn[1], this.spawn[2]);
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.body.fallDistance = 0;
    this.body.landed = 0;
  }

  snapshot(): PlayerSnapshot {
    return {
      x: this.body.x, y: this.body.y, z: this.body.z, yaw: this.yaw, pitch: this.pitch,
      health: this.health, hunger: this.hunger, saturation: this.saturation, exhaustion: this.exhaustion, air: this.air,
      xp: this.xp, level: this.level, spawn: this.spawn, inventory: this.inventory.serialize(), flying: this.body.flying,
      effects: this.effects.serialize(), tags: [...this.tags], dynProps: Object.fromEntries(this.dynProps),
      enderChest: this.enderChest.serialize().slots, enchantSeed: this.enchantSeed,
    };
  }

  restore(s: PlayerSnapshot) {
    this.body.setPos(s.x, s.y, s.z);
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.health = s.health;
    this.hunger = s.hunger;
    this.saturation = s.saturation;
    this.exhaustion = s.exhaustion ?? 0;
    this.air = s.air ?? 300;
    this.xp = s.xp ?? 0;
    this.level = s.level ?? 0;
    this.spawn = s.spawn;
    this.inventory.load(s.inventory);
    if (s.enderChest) this.enderChest.load({ slots: s.enderChest });
    if (s.enchantSeed !== undefined) this.enchantSeed = s.enchantSeed;
    this.body.flying = !!s.flying && this.creative;
    this.effects.load(s.effects);
    this.tags.clear();
    for (const t of s.tags ?? []) this.tags.add(t);
    this.dynProps.clear();
    for (const [k, v] of Object.entries(s.dynProps ?? {})) this.dynProps.set(k, v);
    if (this.health <= 0) this.respawn();
  }
}
