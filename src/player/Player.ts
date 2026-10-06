import { DIFFICULTY_DAMAGE, type Difficulty, type GameMode } from '../core/Config';
import { Inventory } from '../inventory/Inventory';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { clamp } from '../util/math';
import { PlayerPhysics, EYE_HEIGHT, SNEAK_EYE_HEIGHT } from './PlayerPhysics';
import { EffectList, type ActiveEffect } from '../entities/Effects';
import { hooks, damageCause, type Actor } from '../scripting/Hooks';
import type { Entity } from '../entities/Entity';

export type DamageSource = 'mob' | 'fall' | 'lava' | 'drown' | 'starve' | 'contact' | 'void' | 'projectile' | 'boss' | 'fire' | 'explosion';

export interface PlayerSnapshot {
  x: number; y: number; z: number; yaw: number; pitch: number;
  health: number; hunger: number; saturation: number; exhaustion: number; air: number;
  xp: number; level: number; spawn: [number, number, number];
  inventory: ReturnType<Inventory['serialize']>; flying: boolean;
  effects?: ActiveEffect[]; tags?: string[]; dynProps?: Record<string, unknown>;
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
  regenTimer = 0;
  starveTimer = 0;
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
    return 20 + 2 * Math.min(5, Math.floor(this.level / 5));
  }
  get eyeHeight() {
    return this.swimming || this.crawling ? 0.4 : this.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
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
    if (source !== 'drown' && source !== 'starve' && source !== 'void' && this.invulnerable > 0) return 0;
    let dmg = amount;
    if (source === 'mob' || source === 'projectile' || source === 'boss') {
      dmg *= DIFFICULTY_DAMAGE[this.difficulty];
      if (this.difficulty === 'peaceful') return 0;
    }
    if (source === 'mob' || source === 'projectile' || source === 'boss' || source === 'contact') {
      const def = this.inventory.defense();
      dmg *= 1 - Math.min(0.8, def * 0.04);
      this.inventory.damageArmor(1);
    }
    dmg *= this.effects.damageMul(source === 'lava' || source === 'fire');
    dmg = Math.max(0, Math.round(dmg * 2) / 2);
    if (dmg <= 0) return 0;
    this.health = Math.max(0, this.health - dmg);
    this.invulnerable = 0.5;
    this.hurtFlash = 0.35;
    this.addExhaustion(0.1);
    if (knockX || knockZ) {
      this.body.vx += knockX;
      this.body.vz += knockZ;
      this.body.vy = Math.max(this.body.vy, 5);
    }
    if (attacker) {
      this.lastAttacker = attacker;
      this.lastAttackedAt = performance.now();
    }
    this.onDamage(dmg, source);
    hooks.afterHurt?.(this, dmg, { cause: damageCause(source), attacker, projectile });
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
      if (this.health <= 0) {
        this.dead = true;
        this.deathCause = 'contact';
        this.onDeath();
      }
    },
    hp: () => this.health,
    body: this.body,
    feed: (h: number, sat: number) => {
      this.hunger = Math.min(20, this.hunger + h);
      this.saturation = Math.min(this.hunger, this.saturation + sat);
    },
    exhaust: (n: number) => this.addExhaustion(n),
  };

  heal(n: number) {
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  addExhaustion(n: number) {
    if (this.creative || this.difficulty === 'peaceful') return;
    this.exhaustion += n;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
  }

  /** Mange l'objet tenu ; retourne vrai si consommé. */
  eat(itemId: string): boolean {
    const food = ItemRegistry.get(itemId)?.food;
    if (!food) return false;
    if (this.hunger >= 20 && !this.creative && itemId !== 'golden_apple') return false;
    this.hunger = Math.min(20, this.hunger + food.hunger);
    if (food.effect === 'regen') this.regenEffect = 5;
    this.saturation = Math.min(this.hunger, this.saturation + food.saturation);
    return true;
  }

  addXp(n: number) {
    this.xp += n;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.onLevelUp(this.level);
    }
  }
  get xpToNext() {
    return 10 + this.level * 5;
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
      return;
    }
    // faim / régénération
    if (this.difficulty === 'peaceful') {
      this.regenTimer += dt;
      if (this.regenTimer > 1) {
        this.regenTimer = 0;
        this.heal(1);
        this.hunger = Math.min(20, this.hunger + 1);
      }
    } else if (this.naturalRegen && this.hunger >= 18 && this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer >= 4) {
        this.regenTimer = 0;
        this.heal(1);
        this.addExhaustion(3);
      }
    } else if (this.hunger <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        const floor = this.difficulty === 'hard' ? 0 : this.difficulty === 'normal' ? 1 : 10;
        if (this.health > floor) this.damage(1, 'starve');
      }
    }
    // air
    if (this.body.headInWater && !this.effects.level('water_breathing')) {
      this.air -= dt * 20;
      if (this.air <= -20) {
        this.air = 0;
        this.damage(2, 'drown');
      }
    } else this.air = clamp(this.air + dt * 100, 0, 300);
    // lave
    if (this.body.inLava) this.damage(4, 'lava');
    // vide
    if (this.body.y < -20) this.damage(4, 'void');
    // dégâts de chute
    if (this.body.landed > 0) {
      const d = Math.floor(this.body.landed - 3);
      this.body.landed = 0;
      if (d > 0 && !this.body.inWater && this.fallDamage) this.damage(d, 'fall');
    }
    // effort
    if (this.sprinting) this.addExhaustion(dt * 0.2);
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
    this.body.flying = !!s.flying && this.creative;
    this.effects.load(s.effects);
    this.tags.clear();
    for (const t of s.tags ?? []) this.tags.add(t);
    this.dynProps.clear();
    for (const [k, v] of Object.entries(s.dynProps ?? {})) this.dynProps.set(k, v);
    if (this.health <= 0) this.respawn();
  }
}
