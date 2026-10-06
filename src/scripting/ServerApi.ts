/**
 * Implémentation du module « @minecraft/server » (API de script des add-ons Bedrock) au-dessus
 * du moteur LeCraft : monde, dimensions, blocs et permutations, entités et joueur, objets,
 * conteneurs, composants, effets, propriétés dynamiques, tableau des scores, événements,
 * composants personnalisés de blocs et d'objets, planification (system.run…).
 *
 * Une instance est créée par pack (les versions 1.x et 2.x diffèrent sur quelques points,
 * ex. `isValid()` méthode en 1.x et propriété en 2.x). Les objets renvoyés aux scripts sont des
 * enveloppes ; les modifications passent toujours par le moteur.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Session } from '../core/Session';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemStack as EngineStack } from '../inventory/Item';
import { Entity as EngineEntity } from '../entities/Entity';
import { Mob } from '../entities/Mob';
import { ItemEntity } from '../entities/ItemEntity';
import { Projectile, PROJECTILE_DEFS } from '../entities/Projectile';
import { PLAYER_PROPERTIES, STRUCTURES } from '../addons/AddonRegistry';
import { placeStructure, resolveNamedBlock } from '../addons/StructurePlacer';
import { closestBlock } from '../blocks/BlockAliases';
import { Player as EnginePlayer } from '../player/Player';
import { MOB_BY_KEY, MOB_DEFS, familiesOf } from '../data/mobs';
import { EFFECTS, effectId } from '../entities/Effects';
import { decodeStates, encodeStates } from '../addons/BedrockBlocks';
import { WORLD_HEIGHT } from '../core/Config';
import { damageTarget, effectTargetOf, rawTextToString, setTimeTicks, RULE_ALIASES, type Target, type GameRules } from '../commands/Commands';
import { mapParticle } from '../audio/SoundMap';
import type { Actor, DamageEvent } from './Hooks';
import { rayAABB } from '../util/Raycast';

type Any = any;
type V3 = { x: number; y: number; z: number };

/** Services fournis par l'hôte de scripts. */
export interface HostServices {
  readonly s: Session;
  readonly tick: number;
  schedule(fn: () => void, delay: number, interval?: number): number;
  clearRun(id: number): void;
  runCommand(line: string, executor: Target | null, origin?: { x: number; y: number; z: number; yaw: number; pitch: number }): number;
  reportError(e: unknown, where: string): void;
  /** Clé moteur d'un identifiant d'objet (crée un objet de remplacement si inconnu). */
  ensureItem(typeId: string): string;
  cooldowns: Map<string, number>;
  offhand: EngineStack | null;
  sendScriptEvent(id: string, message: string, source: Actor | null): void;
  reportWarning?(m: string): void;
  readonly instances: ServerApiInstance[];
  /** Lance un écran de formulaire ; résout avec la réponse. */
  readonly forms: unknown;
}

export interface ServerApiInstance {
  readonly exports: Record<string, unknown>;
  readonly pack: string;
  readonly fire: Record<string, (...args: Any[]) => Any>;
  readonly blockComponents: Map<string, Record<string, (...a: Any[]) => unknown>>;
  readonly itemComponents: Map<string, Record<string, (...a: Any[]) => unknown>>;
  wrapEntity(e: Actor): Any;
  wrapBlock(x: number, y: number, z: number): Any;
  wrapItem(st: EngineStack | null | undefined): Any;
  permutation(id: number, meta: number): Any;
}

const DEG = 180 / Math.PI;
const NS = (k: string) => (k.includes(':') ? k : `minecraft:${k}`);
const strip = (id: string) => String(id).replace(/^minecraft:/, '');

/** États « vanilla » minimaux des blocs de base (eau, cultures…). */
function vanillaStates(id: number, meta: number): Record<string, string | number | boolean> {
  const b = BlockRegistry.get(id);
  if (!b) return {};
  if (b.liquid) return { liquid_depth: meta & 15 };
  if (/wheat|carrots|potatoes|beetroot|crop/.test(b.key)) return { growth: meta };
  if (b.def.orientable || b.shape === 'stairs' || b.shape === 'door' || b.shape === 'chest' || b.shape === 'bed') {
    const dir = ['south', 'west', 'north', 'east'][meta & 3];
    return { 'minecraft:cardinal_direction': dir, direction: meta & 3, ...(b.shape === 'door' ? { open_bit: !!(meta & 4), upper_block_bit: !!(meta & 8) } : {}) };
  }
  return {};
}

const BLOCK_TAGS: [RegExp, string[]][] = [
  [/log|wood|planks|stairs_wood/, ['wood', 'log', 'minecraft:is_axe_item_destructible']],
  [/stone|cobble|brick|ore|deepslate|granite|diorite|andesite|tuff|basalt|obsidian/, ['stone', 'minecraft:is_pickaxe_item_destructible']],
  [/dirt|grass_block|mud|farmland|podzol|mycelium/, ['dirt', 'grass', 'minecraft:is_shovel_item_destructible']],
  [/sand|gravel|clay|snow/, ['sand', 'minecraft:is_shovel_item_destructible']],
  [/leaves/, ['leaves', 'minecraft:is_hoe_item_destructible']],
  [/wheat|carrot|potato|beetroot|crop/, ['crop', 'plant']],
  [/flower|poppy|dandelion|grass|fern|sapling|bush|vine/, ['plant']],
  [/iron|gold|diamond|copper|metal/, ['metal']],
];

function blockTags(id: number): string[] {
  const b = BlockRegistry.get(id);
  if (!b) return [];
  const out = new Set<string>(b.def.bedrock?.tags ?? []);
  for (const [r, tags] of BLOCK_TAGS) if (r.test(b.key)) tags.forEach((t) => out.add(t));
  if (b.tool === 'pickaxe') out.add('minecraft:is_pickaxe_item_destructible');
  if (b.tool === 'axe') out.add('minecraft:is_axe_item_destructible');
  if (b.tool === 'shovel') out.add('minecraft:is_shovel_item_destructible');
  return [...out];
}

/** Crée l'API « @minecraft/server » pour un pack. */
export function createServerApi(host: HostServices, pack: string, version: string): ServerApiInstance {
  const major = Number(version.split('.')[0]) || 1;
  const v2 = major >= 2;
  const S = () => host.s;
  const W = () => host.s.world;

  // ---------- erreurs ----------
  class ScriptError extends Error {}
  class InvalidEntityError extends Error {}
  class LocationOutOfWorldBoundariesError extends Error {}
  class LocationInUnloadedChunkError extends Error {}
  class CommandError extends Error {}
  class InvalidContainerSlotError extends Error {}
  class EngineError extends Error {}
  class UnloadedChunksError extends Error {}

  // ---------- événements ----------
  class EventSignal {
    readonly handlers: { fn: (e: Any) => void; opts?: Any }[] = [];
    subscribe(fn: (e: Any) => void, opts?: Any) {
      if (typeof fn !== 'function') throw new TypeError('Callback attendu');
      this.handlers.push({ fn, opts });
      return fn;
    }
    unsubscribe(fn: (e: Any) => void) {
      const i = this.handlers.findIndex((h) => h.fn === fn);
      if (i >= 0) this.handlers.splice(i, 1);
    }
    get count() {
      return this.handlers.length;
    }
    emit(ev: Any, filter?: (opts: Any) => boolean) {
      for (const h of [...this.handlers]) {
        if (filter && h.opts && !filter(h.opts)) continue;
        try {
          h.fn(ev);
        } catch (e) {
          host.reportError(e, `événement ${(ev && ev.constructor?.name) || ''}`);
        }
      }
    }
  }
  const signals = <T extends string>(names: readonly T[]) => Object.fromEntries(names.map((n) => [n, new EventSignal()])) as Record<T, EventSignal>;
  const AFTER = ['blockExplode', 'buttonPush', 'chatSend', 'dataDrivenEntityTrigger', 'effectAdd', 'entityDie', 'entityHealthChanged', 'entityHitBlock', 'entityHitEntity', 'entityHurt', 'entityLoad', 'entityRemove', 'entitySpawn', 'explosion', 'gameRuleChange', 'itemCompleteUse', 'itemReleaseUse', 'itemStartUse', 'itemStartUseOn', 'itemStopUse', 'itemStopUseOn', 'itemUse', 'itemUseOn', 'leverAction', 'pistonActivate', 'playerBreakBlock', 'playerButtonInput', 'playerDimensionChange', 'playerEmote', 'playerGameModeChange', 'playerHotbarSelectedSlotChange', 'playerInputModeChange', 'playerInputPermissionCategoryChange', 'playerInteractWithBlock', 'playerInteractWithEntity', 'playerInventoryItemChange', 'playerJoin', 'playerLeave', 'playerPlaceBlock', 'playerSpawn', 'pressurePlatePop', 'pressurePlatePush', 'projectileHitBlock', 'projectileHitEntity', 'targetBlockHit', 'tripWireTrip', 'weatherChange', 'worldLoad', 'worldInitialize', 'messageReceive', 'blockContainerOpened', 'blockContainerClosed', 'entityContainerOpened', 'entityContainerClosed', 'playerUseNameTag', 'entityItemPickup', 'playerHotbarSlotChange'] as const;
  const BEFORE = ['chatSend', 'effectAdd', 'entityRemove', 'explosion', 'itemUse', 'itemUseOn', 'playerBreakBlock', 'playerGameModeChange', 'playerInteractWithBlock', 'playerInteractWithEntity', 'playerLeave', 'weatherChange', 'worldInitialize', 'entityHurt', 'playerPlaceBlock', 'entityItemPickup'] as const;
  const afterEvents = signals(AFTER);
  const beforeEvents = signals(BEFORE);
  const systemAfter = signals(['scriptEventReceive'] as const);
  const systemBefore = signals(['startup', 'watchdogTerminate', 'shutdown'] as const);

  // ---------- types ----------
  class BlockType {
    constructor(readonly id: string) {}
    get canBeWaterlogged() {
      return false;
    }
  }
  class ItemType {
    constructor(readonly id: string) {}
  }
  class EntityType {
    constructor(readonly id: string) {}
  }
  class EffectType {
    constructor(private readonly id: string) {}
    getName() {
      return this.id;
    }
  }
  class EnchantmentType {
    constructor(readonly id: string, readonly maxLevel = 5) {}
  }
  const ENCH_MAX: Record<string, number> = { mending: 1, unbreaking: 3, sharpness: 5, smite: 5, bane_of_arthropods: 5, fire_aspect: 2, knockback: 2, looting: 3, power: 5, flame: 1, punch: 2, infinity: 1, piercing: 4, multishot: 1, quick_charge: 3, impaling: 5, channeling: 1, riptide: 3, loyalty: 3, protection: 4, projectile_protection: 4, blast_protection: 4, fire_protection: 4, feather_falling: 4, respiration: 3, aqua_affinity: 1, thorns: 3, depth_strider: 3, frost_walker: 2, efficiency: 5, silk_touch: 1, fortune: 3, luck_of_the_sea: 3, lure: 3, soul_speed: 3, swift_sneak: 3, binding: 1, vanishing: 1, density: 5, breach: 4, wind_burst: 3 };

  // ---------- vecteurs ----------
  const vec = (x: number, y: number, z: number): V3 => ({ x, y, z });
  const toV = (v: Any): V3 => ({ x: Number(v?.x ?? 0), y: Number(v?.y ?? 0), z: Number(v?.z ?? 0) });

  // ---------- permutations ----------
  class BlockPermutation {
    /** @internal */ constructor(readonly _id: number, readonly _meta: number) {}
    get type() {
      return new BlockType(typeIdOfBlock(this._id));
    }
    getAllStates() {
      const info = BlockRegistry.get(this._id)?.def.bedrock;
      return info ? decodeStates(info, this._meta) : vanillaStates(this._id, this._meta);
    }
    getState(name: string) {
      return (this.getAllStates() as Any)[name];
    }
    withState(name: string, value: Any) {
      const info = BlockRegistry.get(this._id)?.def.bedrock;
      if (!info) return this;
      if (!info.states.some((st) => st.name === name)) throw new Error(`État inconnu « ${name} » pour ${typeIdOfBlock(this._id)}`);
      return new BlockPermutation(this._id, encodeStates(info, { [name]: value }, this._meta));
    }
    matches(typeId: string, states?: Record<string, Any>) {
      if (blockIdOf(typeId) !== this._id) return false;
      if (!states) return true;
      const all = this.getAllStates() as Any;
      return Object.entries(states).every(([k, v]) => String(all[k]) === String(v));
    }
    equals(o: Any) {
      return o instanceof BlockPermutation && o._id === this._id && o._meta === this._meta;
    }
    getTags() {
      return blockTags(this._id);
    }
    hasTag(t: string) {
      return blockTags(this._id).includes(t);
    }
    getItemStack(amount = 1) {
      const k = BlockRegistry.get(this._id)?.key;
      return k && ItemRegistry.has(k) ? new ItemStack(NS(k), amount) : undefined;
    }
    canBeDestroyedByLiquidSpread() {
      return false;
    }
    canContainLiquid() {
      return false;
    }
    isLiquidBlocking() {
      return true;
    }
    get localizationKey() {
      return `tile.${strip(typeIdOfBlock(this._id))}.name`;
    }
    static resolve(typeId: string, states?: Record<string, Any>) {
      const id = blockIdOf(typeId);
      if (id < 0) throw new Error(`Type de bloc inconnu : ${typeId}`);
      const info = BlockRegistry.get(id).def.bedrock;
      return new BlockPermutation(id, info && states ? encodeStates(info, states, 0) : 0);
    }
  }

  function typeIdOfBlock(id: number): string {
    if (id <= 0) return 'minecraft:air';
    const b = BlockRegistry.get(id);
    return b ? NS(b.key) : 'minecraft:air';
  }
  function blockIdOf(typeId: string | Any): number {
    const t = typeof typeId === 'string' ? typeId : typeId?.id ?? String(typeId);
    const k = strip(t);
    if (k === 'air' || k === 'cave_air' || k === 'void_air' || k === 'structure_void') return B.AIR;
    if (BlockRegistry.has(t)) return BlockRegistry.byName(t).id;
    if (BlockRegistry.has(k)) return BlockRegistry.byName(k).id;
    const alias: Record<string, string> = { grass: 'grass_block', flowing_water: 'water', flowing_lava: 'lava', stonebrick: 'stone_bricks', planks: 'oak_planks', log: 'oak_log', leaves: 'oak_leaves', wool: 'white_wool', tallgrass: 'short_grass', short_grass: 'short_grass' };
    if (alias[k] && BlockRegistry.has(alias[k])) return BlockRegistry.byName(alias[k]).id;
    const near = closestBlock(k);
    if (near >= 0) {
      warnSubst(t, near);
      return near;
    }
    return -1;
  }
  const substituted = new Set<string>();
  function warnSubst(t: string, id: number) {
    if (substituted.has(t)) return;
    substituted.add(t);
    host.reportWarning?.(`Bloc « ${t} » absent du jeu : remplacé par « ${BlockRegistry.get(id).key} ».`);
  }

  // ---------- objets ----------
  class ItemStack {
    _id: string;
    amount: number;
    _dur: number | undefined;
    _meta: Record<string, Any>;
    constructor(type: string | ItemType, amount = 1) {
      const t = typeof type === 'string' ? type : type?.id;
      if (!t) throw new TypeError("Type d'objet attendu");
      this._id = host.ensureItem(t);
      if (amount < 1 || amount > 255) throw new RangeError('Quantité invalide');
      this.amount = Math.floor(amount);
      const d = ItemRegistry.maxDurability(this._id);
      this._dur = d > 0 ? d : undefined;
      this._meta = {};
    }
    static _from(st: EngineStack): ItemStack {
      const it = Object.create(ItemStack.prototype) as ItemStack;
      it._id = st.id;
      it.amount = st.count;
      it._dur = st.durability;
      it._meta = st.meta ? JSON.parse(JSON.stringify(st.meta)) : {};
      return it;
    }
    _toEngine(): EngineStack {
      const st: EngineStack = { id: this._id, count: Math.max(1, Math.min(255, Math.floor(this.amount))) };
      if (this._dur !== undefined) st.durability = this._dur;
      const m: Record<string, Any> = {};
      for (const [k, v] of Object.entries(this._meta)) if (v !== undefined && !(Array.isArray(v) && !v.length) && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) m[k] = v;
      if (Object.keys(m).length) st.meta = m;
      return st;
    }
    get typeId() {
      return NS(this._id);
    }
    get type() {
      return new ItemType(this.typeId);
    }
    get maxAmount() {
      return ItemRegistry.maxStack(this._id);
    }
    get isStackable() {
      return this.maxAmount > 1;
    }
    get nameTag(): string | undefined {
      return this._meta.name;
    }
    set nameTag(v: string | undefined) {
      this._meta.name = v || undefined;
    }
    get keepOnDeath() {
      return !!this._meta.keep;
    }
    set keepOnDeath(v: boolean) {
      this._meta.keep = v || undefined;
    }
    get lockMode() {
      return this._meta.lock ?? 'none';
    }
    set lockMode(v: string) {
      this._meta.lock = v === 'none' ? undefined : v;
    }
    get localizationKey() {
      return `item.${strip(this.typeId)}.name`;
    }
    getLore(): string[] {
      return [...(this._meta.lore ?? [])];
    }
    getRawLore() {
      return this.getLore().map((t) => ({ text: t }));
    }
    setLore(lore?: (string | Any)[]) {
      this._meta.lore = (lore ?? []).map((l) => (typeof l === 'string' ? l : rawTextToString(l))).slice(0, 100);
    }
    getTags() {
      const d = ItemRegistry.get(this._id);
      const t = [...(d?.tags ?? [])];
      if (d?.tool) t.push(`minecraft:is_${d.tool.type}`, 'minecraft:is_tool');
      if (d?.food) t.push('minecraft:is_food');
      if (d?.armor) t.push('minecraft:is_armor');
      return t;
    }
    hasTag(t: string) {
      return this.getTags().includes(t);
    }
    hasComponent(id: string) {
      return !!this.getComponent(id);
    }
    getComponents() {
      return ['durability', 'enchantable', 'cooldown', 'food'].map((c) => this.getComponent(c)).filter(Boolean);
    }
    getComponent(id: string): Any {
      const k = strip(id);
      const def = ItemRegistry.get(this._id);
      if (k === 'durability') {
        const max = ItemRegistry.maxDurability(this._id);
        if (max <= 0) return undefined;
        const self = this;
        return {
          typeId: 'minecraft:durability',
          isValid: true,
          get maxDurability() {
            return max;
          },
          get damage() {
            return Math.max(0, max - (self._dur ?? max));
          },
          set damage(v: number) {
            self._dur = Math.max(0, Math.min(max, max - Math.round(v)));
          },
          unbreakable: false,
          getDamageChance: (unbreaking = 0) => 100 / (unbreaking + 1),
          getDamageChanceRange: () => ({ min: 0, max: 100 }),
        };
      }
      if (k === 'enchantable' || k === 'enchantments') {
        const self = this;
        const ench = () => (self._meta.ench ??= {}) as Record<string, number>;
        const tid = (t: Any) => strip(typeof t === 'string' ? t : t?.id ?? '');
        const comp = {
          typeId: 'minecraft:enchantable',
          isValid: true,
          slots: [],
          getEnchantments: () => Object.entries(ench()).map(([id, level]) => ({ type: new EnchantmentType(id, ENCH_MAX[id] ?? 5), level })),
          getEnchantment: (t: Any) => {
            const l = ench()[tid(t)];
            return l ? { type: new EnchantmentType(tid(t), ENCH_MAX[tid(t)] ?? 5), level: l } : undefined;
          },
          hasEnchantment: (t: Any) => ench()[tid(t)] ?? 0,
          addEnchantment: (e: Any) => void (ench()[tid(e.type)] = Number(e.level ?? 1)),
          addEnchantments: (list: Any[]) => list.forEach((e) => (ench()[tid(e.type)] = Number(e.level ?? 1))),
          removeEnchantment: (t: Any) => void delete ench()[tid(t)],
          removeAllEnchantments: () => void (self._meta.ench = {}),
          canAddEnchantment: () => true,
        };
        if (k === 'enchantments') return { ...comp, enchantments: { getEnchantment: comp.getEnchantment, hasEnchantment: comp.hasEnchantment, addEnchantment: comp.addEnchantment, removeEnchantment: comp.removeEnchantment, [Symbol.iterator]: function* () { yield* comp.getEnchantments(); } } };
        return comp;
      }
      if (k === 'cooldown') {
        const cd = def?.cooldown;
        if (!cd) return undefined;
        return {
          typeId: 'minecraft:cooldown',
          isValid: true,
          cooldownCategory: cd.category,
          cooldownTicks: Math.round(cd.duration * 20),
          startCooldown: () => host.cooldowns.set(cd.category, host.tick + Math.round(cd.duration * 20)),
          getCooldownTicksRemaining: () => Math.max(0, (host.cooldowns.get(cd.category) ?? 0) - host.tick),
          isCooldownCategory: (c: string) => c === cd.category,
        };
      }
      if (k === 'food') {
        if (!def?.food) return undefined;
        return { typeId: 'minecraft:food', isValid: true, nutrition: def.food.hunger, saturationModifier: def.food.saturation / Math.max(1, def.food.hunger * 2), canAlwaysEat: false, usingConvertsTo: undefined };
      }
      // composant personnalisé (« espace:nom ») déclaré par l'objet
      const custom = def?.scriptComponents;
      if (custom && id in custom) return { typeId: id, isValid: true, customComponentParameters: { params: custom[id] } };
      return undefined;
    }
    getDynamicProperty(id: string) {
      return (this._meta.dp ?? {})[id];
    }
    setDynamicProperty(id: string, v?: Any) {
      const dp = (this._meta.dp ??= {});
      if (v === undefined) delete dp[id];
      else dp[id] = serializeProp(v);
    }
    getDynamicPropertyIds() {
      return Object.keys(this._meta.dp ?? {});
    }
    getDynamicPropertyTotalByteCount() {
      return JSON.stringify(this._meta.dp ?? {}).length;
    }
    clearDynamicProperties() {
      this._meta.dp = {};
    }
    clone() {
      const c = ItemStack._from(this._toEngine());
      c.amount = this.amount;
      return c;
    }
    isStackableWith(o: Any) {
      return o instanceof ItemStack && o._id === this._id && JSON.stringify(o._meta) === JSON.stringify(this._meta) && this._dur === o._dur && this.isStackable;
    }
    matches(typeId: string) {
      return NS(strip(typeId)) === this.typeId || typeId === this.typeId;
    }
    getCanDestroy() {
      return [...(this._meta.canDestroy ?? [])];
    }
    getCanPlaceOn() {
      return [...(this._meta.canPlaceOn ?? [])];
    }
    setCanDestroy(l?: string[]) {
      this._meta.canDestroy = l ?? [];
    }
    setCanPlaceOn(l?: string[]) {
      this._meta.canPlaceOn = l ?? [];
    }
  }

  function serializeProp(v: Any): Any {
    if (v && typeof v === 'object') return { x: Number(v.x), y: Number(v.y), z: Number(v.z) };
    return v;
  }
  const wrapItem = (st: EngineStack | null | undefined): ItemStack | undefined => (st ? ItemStack._from(st) : undefined);
  const toEngineItem = (it: Any): EngineStack | null => {
    if (!it) return null;
    if (it instanceof ItemStack) return it._toEngine();
    if (typeof it === 'object' && typeof it.typeId === 'string' && '_toEngine' in it) return (it as ItemStack)._toEngine();
    throw new TypeError('ItemStack attendu');
  };

  // ---------- conteneurs ----------
  interface SlotStore {
    size: number;
    get(i: number): EngineStack | null;
    set(i: number, st: EngineStack | null): void;
    valid(): boolean;
  }
  class ContainerSlot {
    constructor(private readonly store: SlotStore, private readonly i: number) {}
    get isValid() {
      return this.store.valid();
    }
    getItem() {
      return wrapItem(this.store.get(this.i));
    }
    setItem(it?: Any) {
      this.store.set(this.i, toEngineItem(it));
    }
    hasItem() {
      return !!this.store.get(this.i);
    }
    private edit(fn: (it: ItemStack) => void) {
      const it = this.getItem();
      if (!it) throw new InvalidContainerSlotError('Emplacement vide');
      fn(it);
      this.setItem(it);
    }
    get typeId() {
      return this.getItem()?.typeId;
    }
    get type() {
      return this.getItem()?.type;
    }
    get amount() {
      return this.store.get(this.i)?.count ?? 0;
    }
    set amount(v: number) {
      this.edit((it) => (it.amount = v));
    }
    get nameTag() {
      return this.getItem()?.nameTag;
    }
    set nameTag(v: string | undefined) {
      this.edit((it) => (it.nameTag = v));
    }
    get maxAmount() {
      return this.getItem()?.maxAmount ?? 64;
    }
    get isStackable() {
      return this.getItem()?.isStackable ?? false;
    }
    get keepOnDeath() {
      return this.getItem()?.keepOnDeath ?? false;
    }
    set keepOnDeath(v: boolean) {
      this.edit((it) => (it.keepOnDeath = v));
    }
    get lockMode() {
      return this.getItem()?.lockMode ?? 'none';
    }
    set lockMode(v: string) {
      this.edit((it) => (it.lockMode = v));
    }
    getLore() {
      return this.getItem()?.getLore() ?? [];
    }
    setLore(l?: string[]) {
      this.edit((it) => it.setLore(l));
    }
    getTags() {
      return this.getItem()?.getTags() ?? [];
    }
    hasTag(t: string) {
      return this.getItem()?.hasTag(t) ?? false;
    }
    getDynamicProperty(id: string) {
      return this.getItem()?.getDynamicProperty(id);
    }
    setDynamicProperty(id: string, v?: Any) {
      this.edit((it) => it.setDynamicProperty(id, v));
    }
    getDynamicPropertyIds() {
      return this.getItem()?.getDynamicPropertyIds() ?? [];
    }
    clearDynamicProperties() {
      this.edit((it) => it.clearDynamicProperties());
    }
    isStackableWith(o: Any) {
      return this.getItem()?.isStackableWith(o) ?? false;
    }
    getCanDestroy() {
      return this.getItem()?.getCanDestroy() ?? [];
    }
    getCanPlaceOn() {
      return this.getItem()?.getCanPlaceOn() ?? [];
    }
    setCanDestroy(l?: string[]) {
      this.edit((it) => it.setCanDestroy(l));
    }
    setCanPlaceOn(l?: string[]) {
      this.edit((it) => it.setCanPlaceOn(l));
    }
  }
  class Container {
    constructor(readonly _store: SlotStore) {}
    get isValid() {
      return this._store.valid();
    }
    get size() {
      return this._store.size;
    }
    get emptySlotsCount() {
      let n = 0;
      for (let i = 0; i < this.size; i++) if (!this._store.get(i)) n++;
      return n;
    }
    getItem(i: number) {
      this.check(i);
      return wrapItem(this._store.get(i));
    }
    setItem(i: number, it?: Any) {
      this.check(i);
      this._store.set(i, toEngineItem(it));
    }
    getSlot(i: number) {
      this.check(i);
      return new ContainerSlot(this._store, i);
    }
    private check(i: number) {
      if (!(i >= 0 && i < this.size)) throw new RangeError(`Emplacement ${i} hors du conteneur (${this.size})`);
    }
    addItem(it: Any): ItemStack | undefined {
      const st = toEngineItem(it);
      if (!st) return undefined;
      let left = st.count;
      const max = ItemRegistry.maxStack(st.id);
      const same = (a: EngineStack) => a.id === st.id && a.durability === st.durability && JSON.stringify(a.meta ?? null) === JSON.stringify(st.meta ?? null);
      for (let i = 0; i < this.size && left > 0; i++) {
        const cur = this._store.get(i);
        if (cur && same(cur) && cur.count < max) {
          const n = Math.min(max - cur.count, left);
          this._store.set(i, { ...cur, count: cur.count + n });
          left -= n;
        }
      }
      for (let i = 0; i < this.size && left > 0; i++) {
        if (this._store.get(i)) continue;
        const n = Math.min(max, left);
        this._store.set(i, { ...st, count: n });
        left -= n;
      }
      if (left <= 0) return undefined;
      const rest = ItemStack._from({ ...st, count: left });
      return rest;
    }
    moveItem(from: number, to: number, other: Container) {
      const a = this._store.get(from);
      if (!a) return;
      const b = other._store.get(to);
      if (b && b.id === a.id && JSON.stringify(b.meta ?? null) === JSON.stringify(a.meta ?? null)) {
        const max = ItemRegistry.maxStack(a.id);
        const n = Math.min(max - b.count, a.count);
        other._store.set(to, { ...b, count: b.count + n });
        this._store.set(from, a.count - n > 0 ? { ...a, count: a.count - n } : null);
      } else if (!b) {
        other._store.set(to, a);
        this._store.set(from, null);
      }
    }
    swapItems(slot: number, otherSlot: number, other: Container) {
      const a = this._store.get(slot), b = other._store.get(otherSlot);
      this._store.set(slot, b);
      other._store.set(otherSlot, a);
    }
    transferItem(from: number, to: Container) {
      const a = this.getItem(from);
      if (!a) return undefined;
      this._store.set(from, null);
      const rest = to.addItem(a);
      if (rest) this._store.set(from, rest._toEngine());
      return rest;
    }
    clearAll() {
      for (let i = 0; i < this.size; i++) this._store.set(i, null);
    }
    contains(it: Any) {
      const st = toEngineItem(it);
      if (!st) return false;
      let n = 0;
      for (let i = 0; i < this.size; i++) {
        const c = this._store.get(i);
        if (c && c.id === st.id) n += c.count;
      }
      return n >= st.count;
    }
    find(it: Any) {
      const st = toEngineItem(it);
      for (let i = 0; i < this.size; i++) if (st && this._store.get(i)?.id === st.id) return i;
      return undefined;
    }
    findLast(it: Any) {
      const st = toEngineItem(it);
      for (let i = this.size - 1; i >= 0; i--) if (st && this._store.get(i)?.id === st.id) return i;
      return undefined;
    }
    reverseFind(it: Any) {
      return this.findLast(it);
    }
    firstEmptySlot() {
      for (let i = 0; i < this.size; i++) if (!this._store.get(i)) return i;
      return undefined;
    }
    firstItem() {
      for (let i = 0; i < this.size; i++) if (this._store.get(i)) return i;
      return undefined;
    }
  }

  const playerStore = (): SlotStore => {
    const inv = S().player.inventory;
    return {
      size: inv.size,
      get: (i) => inv.slots[i] ?? null,
      set: (i, st) => {
        inv.slots[i] = st && st.count > 0 ? st : null;
        inv.changed();
      },
      valid: () => true,
    };
  };
  const chestStore = (x: number, y: number, z: number): SlotStore | null => {
    const inv = W().getChest(x, y, z, false) ?? (W().getBlock(x, y, z) === B.CHEST ? W().getChest(x, y, z, true) : null);
    if (!inv) return null;
    return {
      size: inv.size,
      get: (i) => inv.slots[i] ?? null,
      set: (i, st) => {
        inv.slots[i] = st && st.count > 0 ? st : null;
        inv.changed();
      },
      valid: () => W().getBlock(x, y, z) === B.CHEST,
    };
  };

  // ---------- dimensions et blocs ----------
  class Dimension {
    constructor(readonly id: string, private readonly real: boolean) {}
    get heightRange() {
      return { min: 0, max: WORLD_HEIGHT };
    }
    get localizationKey() {
      return `dimension.${strip(this.id)}`;
    }
    get isValid() {
      return true;
    }
    private loaded(x: number, z: number) {
      return this.real && W().isLoaded(Math.floor(x), Math.floor(z));
    }
    getBlock(loc: Any) {
      const p = toV(loc);
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      if (!this.loaded(x, z)) return undefined;
      if (y < 0 || y >= WORLD_HEIGHT) {
        if (v2) return undefined;
        throw new LocationOutOfWorldBoundariesError('Position hors du monde');
      }
      return new Block(this, x, y, z);
    }
    getBlockAbove(loc: Any, opts?: Any) {
      const p = toV(loc);
      for (let y = Math.floor(p.y) + 1; y < WORLD_HEIGHT; y++) {
        const id = W().getBlock(Math.floor(p.x), y, Math.floor(p.z));
        if (id > 0 && (opts?.includeLiquid || !BlockRegistry.liquid[id]) && (opts?.includePassableBlocks || BlockRegistry.solid[id])) return this.getBlock(vec(p.x, y, p.z));
      }
      return undefined;
    }
    getBlockBelow(loc: Any, opts?: Any) {
      const p = toV(loc);
      for (let y = Math.floor(p.y) - 1; y >= 0; y--) {
        const id = W().getBlock(Math.floor(p.x), y, Math.floor(p.z));
        if (id > 0 && (opts?.includeLiquid || !BlockRegistry.liquid[id]) && (opts?.includePassableBlocks || BlockRegistry.solid[id])) return this.getBlock(vec(p.x, y, p.z));
      }
      return undefined;
    }
    getTopmostBlock(loc: Any, minHeight?: number) {
      const p = toV(loc);
      if (!this.loaded(p.x, p.z)) return undefined;
      for (let y = WORLD_HEIGHT - 1; y >= (minHeight ?? 0); y--) if (W().getBlock(Math.floor(p.x), y, Math.floor(p.z)) > 0) return this.getBlock(vec(p.x, y, p.z));
      return undefined;
    }
    getBlocks(volume: Any, filter?: Any) {
      const out: Any[] = [];
      const a = toV(volume?.from ?? volume?.getMin?.()), b = toV(volume?.to ?? volume?.getMax?.());
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
        for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++)
          for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
            const bl = this.getBlock(vec(x, y, z));
            if (bl && (!filter || bl.matchesFilter(filter))) out.push(bl);
          }
      return { getBlockLocationIterator: () => out.map((bl) => bl.location)[Symbol.iterator](), getCapacity: () => out.length, isValid: true };
    }
    containsBlock(volume: Any, filter: Any) {
      return this.getBlocks(volume, filter).getCapacity() > 0;
    }
    setBlockType(loc: Any, type: Any) {
      const bl = this.getBlock(loc);
      if (!bl) throw new LocationInUnloadedChunkError('Chunk non chargé');
      bl.setType(type);
    }
    setBlockPermutation(loc: Any, perm: BlockPermutation) {
      const bl = this.getBlock(loc);
      if (!bl) throw new LocationInUnloadedChunkError('Chunk non chargé');
      bl.setPermutation(perm);
    }
    fillBlocks(volume: Any, block: Any, opts?: Any) {
      const a = toV(volume?.from ?? volume?.getMin?.() ?? volume?.begin), b = toV(volume?.to ?? volume?.getMax?.() ?? volume?.end);
      const perm = block instanceof BlockPermutation ? block : BlockPermutation.resolve(typeof block === 'string' ? block : block.id);
      let n = 0;
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
        for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++)
          for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
            const cur = W().getBlock(x, y, z);
            if (cur < 0) continue;
            if (opts?.ignoreChunkBoundErrors === false && cur < 0) continue;
            if (opts?.blockFilter && !new Block(this, x, y, z).matchesFilter(opts.blockFilter)) continue;
            if (W().setBlock(x, y, z, perm._id, perm._meta)) n++;
          }
      return v2 ? { getCapacity: () => n, isValid: true, getBlockLocationIterator: () => [][Symbol.iterator]() } : n;
    }
    getEntities(q?: Any): Any[] {
      if (!this.real) return [];
      const list: Any[] = [];
      const p = S().player;
      if (!p.dead && entityMatches(p, q)) list.push(wrapEntity(p));
      for (const e of S().entities.entities) if (!e.removed && !(e instanceof Mob && e.dead) && entityMatches(e, q)) list.push(wrapEntity(e));
      return sortQuery(list, q);
    }
    getEntitiesAtBlockLocation(loc: Any) {
      const p = toV(loc);
      return this.getEntities().filter((e: Any) => Math.floor(e.location.x) === Math.floor(p.x) && Math.floor(e.location.y) === Math.floor(p.y) && Math.floor(e.location.z) === Math.floor(p.z));
    }
    getPlayers(q?: Any) {
      if (!this.real) return [];
      const p = S().player;
      return entityMatches(p, q) ? [wrapEntity(p)] : [];
    }
    getEntitiesFromRay(loc: Any, dir: Any, opts?: Any) {
      const o = toV(loc), d = toV(dir);
      const len = Math.hypot(d.x, d.y, d.z) || 1;
      const max = opts?.maxDistance ?? 64;
      const out: { entity: Any; distance: number }[] = [];
      for (const e of S().entities.entities) {
        if (e.removed || !(e instanceof Mob) || e.dead) continue;
        const [a, b, c, dd, f, g] = e.aabb();
        const t = rayAABB(o.x, o.y, o.z, d.x / len, d.y / len, d.z / len, a, b, c, dd, f, g);
        if (t >= 0 && t <= max && entityMatches(e, opts)) out.push({ entity: wrapEntity(e), distance: t });
      }
      return out.sort((x, y) => x.distance - y.distance);
    }
    getBlockFromRay(loc: Any, dir: Any, opts?: Any) {
      return rayBlock(this, toV(loc), toV(dir), opts);
    }
    spawnEntity(typeId: Any, loc: Any, opts?: Any) {
      if (!this.real) throw new Error('Dimension non disponible');
      const id = typeof typeId === 'string' ? typeId : typeId?.id;
      const p = toV(loc);
      const k = strip(id);
      if (k === 'lightning_bolt') {
        S().lightning(p.x, p.y, p.z);
        return fakeEntity(id, p);
      }
      if (k === 'xp_orb' || k === 'experience_orb') {
        S().player.addXp(3);
        return fakeEntity(id, p);
      }
      if (k === 'tnt') {
        const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
        W().setBlock(bx, by, bz, B.TNT);
        S().explosions.prime(S(), bx, by, bz);
        return fakeEntity(id, p);
      }
      const pdef = PROJECTILE_DEFS.get(id) ?? PROJECTILE_DEFS.get(NS(k));
      if (pdef) {
        const pr = S().entities.spawnProjectile('custom', p.x, p.y, p.z, 0, 0, 0, pdef.damage, true, pdef);
        pr.owner = null;
        return wrapEntity(pr);
      }
      if (k === 'evocation_fang') {
        // crocs : morsure après un court délai sur les créatures proches
        host.schedule(() => {
          S().particles.burst('crystal', p.x, p.y + 0.5, p.z, 8);
          S().audio.playId('mob.evocation_fangs.attack', { x: p.x, y: p.y, z: p.z });
          for (const m of S().entities.mobs) if (!m.dead && Math.hypot(m.x - p.x, m.z - p.z) < 1.2 && Math.abs(m.y - p.y) < 2) S().combat.damageMob(m, 6, { kind: 'environment', cause: 'magic' });
        }, 10);
        return fakeEntity(id, p);
      }
      const key = MOB_BY_KEY.has(id) ? id : MOB_BY_KEY.has(k) ? k : MOB_DEFS.find((d) => d.key === k || NS(d.key) === id)?.key;
      if (!key) throw new Error(`Type d'entité inconnu : ${id}`);
      const m = S().entities.spawnMob(key, p.x, p.y, p.z, { persistent: true });
      if (!m) throw new Error(`Impossible de faire apparaître ${id}`);
      if (opts?.initialRotation !== undefined) m.yaw = Math.PI - opts.initialRotation / DEG;
      return wrapEntity(m);
    }
    spawnItem(item: Any, loc: Any) {
      const st = toEngineItem(item);
      if (!st) throw new TypeError('ItemStack attendu');
      const p = toV(loc);
      S().entities.spawnItem(st.id, st.count, p.x, p.y, p.z, st.durability);
      const e = S().entities.entities[S().entities.entities.length - 1];
      if (e instanceof ItemEntity && st.meta) (e as Any).meta = st.meta;
      return e ? wrapEntity(e) : undefined;
    }
    spawnParticle(id: string, loc: Any, _vars?: Any) {
      const p = toV(loc);
      const m = mapParticle(id);
      S().particles.burst(m.kind, p.x, p.y, p.z, Math.max(1, Math.round(m.count / 2)));
    }
    playSound(id: string, loc: Any, opts?: Any) {
      const p = toV(loc);
      S().audio.playId(id, { x: p.x, y: p.y, z: p.z, volume: opts?.volume ?? 1, pitch: opts?.pitch ?? 1 });
    }
    runCommand(cmd: string) {
      const n = host.runCommand(cmd, null, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
      return { successCount: n };
    }
    runCommandAsync(cmd: string) {
      return Promise.resolve(this.runCommand(cmd));
    }
    createExplosion(loc: Any, radius: number, opts?: Any) {
      const p = toV(loc);
      S().explosions.explode(S(), S().entities, p.x, p.y, p.z, Math.max(0.5, Number(radius) || 1));
      void opts;
      return true;
    }
    getWeather() {
      const st = S().weather.state;
      return st === 'storm' ? 'Thunder' : st === 'rain' ? 'Rain' : 'Clear';
    }
    setWeather(type: string, duration?: number) {
      const t = String(type).toLowerCase();
      S().weather.load({ state: t === 'thunder' ? 'storm' : t === 'rain' ? 'rain' : 'clear', timer: duration ? duration / 20 : 300 + Math.random() * 600 });
    }
    getLightLevel(loc: Any) {
      const p = toV(loc);
      const l = W().getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      return Math.max(l.block, Math.round(l.sky * S().dayCycle.daylight));
    }
    getSkyLightLevel(loc: Any) {
      const p = toV(loc);
      return W().getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)).sky;
    }
    isChunkLoaded(loc: Any) {
      const p = toV(loc);
      return this.loaded(p.x, p.z);
    }
    getGeneratedStructures() {
      return [];
    }
    getBiome(loc: Any) {
      const p = toV(loc);
      return { id: NS(W().biomeAt(Math.floor(p.x), Math.floor(p.z)).key) };
    }
  }
  const overworld = new Dimension('minecraft:overworld', true);
  const nether = new Dimension('minecraft:nether', false);
  const theEnd = new Dimension('minecraft:the_end', false);
  const dimById = (id: string) => {
    const k = strip(String(id).toLowerCase());
    if (k === 'nether') return nether;
    if (k === 'the_end' || k === 'end') return theEnd;
    if (k === 'overworld') return overworld;
    throw new Error(`Dimension inconnue : ${id}`);
  };

  /** Face moteur (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z) → Direction. */
  const faceDir = (face: number) => ['East', 'West', 'Up', 'Down', 'South', 'North'][face] ?? 'Up';

  class Block {
    constructor(readonly dimension: Dimension, readonly x: number, readonly y: number, readonly z: number) {}
    get location() {
      return vec(this.x, this.y, this.z);
    }
    private get _id() {
      return Math.max(0, W().getBlock(this.x, this.y, this.z));
    }
    get isValid(): Any {
      const ok = W().isLoaded(this.x, this.z);
      return v2 ? ok : () => ok;
    }
    get typeId() {
      return typeIdOfBlock(this._id);
    }
    get type() {
      return new BlockType(this.typeId);
    }
    get permutation() {
      return new BlockPermutation(this._id, W().getMeta(this.x, this.y, this.z));
    }
    get isAir() {
      return this._id === B.AIR;
    }
    get isLiquid() {
      return !!BlockRegistry.liquid[this._id];
    }
    get isSolid() {
      return !!BlockRegistry.solid[this._id];
    }
    get isWaterlogged() {
      return false;
    }
    get localizationKey() {
      return this.permutation.localizationKey;
    }
    get redstonePower() {
      return 0;
    }
    getRedstonePower() {
      return 0;
    }
    setWaterlogged(_v: boolean) {}
    setType(type: Any) {
      const id = blockIdOf(type);
      if (id < 0) throw new Error(`Type de bloc inconnu : ${typeof type === 'string' ? type : type?.id}`);
      W().setBlock(this.x, this.y, this.z, id, 0);
    }
    setPermutation(p: BlockPermutation) {
      if (!(p instanceof BlockPermutation)) throw new TypeError('BlockPermutation attendue');
      W().setBlock(this.x, this.y, this.z, p._id, p._meta);
    }
    trySetPermutation(p: BlockPermutation) {
      this.setPermutation(p);
      return true;
    }
    above(n = 1) {
      return this.dimension.getBlock(vec(this.x, this.y + n, this.z));
    }
    below(n = 1) {
      return this.dimension.getBlock(vec(this.x, this.y - n, this.z));
    }
    north(n = 1) {
      return this.dimension.getBlock(vec(this.x, this.y, this.z - n));
    }
    south(n = 1) {
      return this.dimension.getBlock(vec(this.x, this.y, this.z + n));
    }
    east(n = 1) {
      return this.dimension.getBlock(vec(this.x + n, this.y, this.z));
    }
    west(n = 1) {
      return this.dimension.getBlock(vec(this.x - n, this.y, this.z));
    }
    offset(o: Any) {
      const d = toV(o);
      return this.dimension.getBlock(vec(this.x + d.x, this.y + d.y, this.z + d.z));
    }
    center() {
      return vec(this.x + 0.5, this.y + 0.5, this.z + 0.5);
    }
    bottomCenter() {
      return vec(this.x + 0.5, this.y, this.z + 0.5);
    }
    getTags() {
      return blockTags(this._id);
    }
    hasTag(t: string) {
      return blockTags(this._id).includes(t);
    }
    matches(typeId: string, states?: Any) {
      return this.permutation.matches(typeId, states);
    }
    matchesFilter(f: Any) {
      const t = this.typeId;
      if (f.includeTypes && !f.includeTypes.some((x: string) => NS(strip(x)) === t)) return false;
      if (f.excludeTypes && f.excludeTypes.some((x: string) => NS(strip(x)) === t)) return false;
      if (f.includeTags && !f.includeTags.every((x: string) => this.hasTag(x))) return false;
      if (f.excludeTags && f.excludeTags.some((x: string) => this.hasTag(x))) return false;
      if (f.includePermutations && !f.includePermutations.some((p: BlockPermutation) => this.permutation.equals(p))) return false;
      return true;
    }
    getItemStack(amount = 1) {
      return this.permutation.getItemStack(amount);
    }
    canPlace(_perm: Any) {
      return this.isAir || !!BlockRegistry.replaceable[this._id];
    }
    getLightLevel() {
      return this.dimension.getLightLevel(this.location);
    }
    getSkyLightLevel() {
      return this.dimension.getSkyLightLevel(this.location);
    }
    getComponent(id: string): Any {
      const k = strip(id);
      if (k === 'inventory') {
        const st = chestStore(this.x, this.y, this.z);
        return st ? { typeId: 'minecraft:inventory', isValid: true, container: new Container(st), block: this } : undefined;
      }
      const info = BlockRegistry.get(this._id)?.def.bedrock;
      if (info?.custom.includes(id)) return { typeId: id, isValid: true, block: this, customComponentParameters: { params: info.customParams?.[id] ?? {} } };
      return undefined;
    }
    hasComponent(id: string) {
      return !!this.getComponent(id);
    }
    getMapColor() {
      return { red: 0.5, green: 0.5, blue: 0.5, alpha: 1 };
    }
    get [Symbol.toStringTag]() {
      return 'Block';
    }
  }

  function rayBlock(dim: Dimension, o: V3, d: V3, opts?: Any) {
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const dx = d.x / len, dy = d.y / len, dz = d.z / len;
    const max = opts?.maxDistance ?? 64;
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
    let tx = dx > 0 ? (x + 1 - o.x) * tdx : (o.x - x) * tdx;
    let ty = dy > 0 ? (y + 1 - o.y) * tdy : (o.y - y) * tdy;
    let tz = dz > 0 ? (z + 1 - o.z) * tdz : (o.z - z) * tdz;
    let face = 2, t = 0;
    for (let i = 0; i < 512 && t <= max; i++) {
      const id = W().getBlock(x, y, z);
      if (id > 0 && (opts?.includeLiquidBlocks || !BlockRegistry.liquid[id]) && (opts?.includePassableBlocks || BlockRegistry.solid[id] || BlockRegistry.renderType[id] !== 0)) {
        const bl = dim.getBlock(vec(x, y, z));
        if (bl && (!opts?.includeTypes || bl.matchesFilter(opts))) {
          const hit = vec(o.x + dx * t, o.y + dy * t, o.z + dz * t);
          return { block: bl, face: faceDir(face), faceLocation: vec(hit.x - x, hit.y - y, hit.z - z) };
        }
      }
      if (tx < ty && tx < tz) {
        x += sx;
        t = tx;
        tx += tdx;
        face = sx > 0 ? 1 : 0;
      } else if (ty < tz) {
        y += sy;
        t = ty;
        ty += tdy;
        face = sy > 0 ? 3 : 2;
      } else {
        z += sz;
        t = tz;
        tz += tdz;
        face = sz > 0 ? 5 : 4;
      }
    }
    return undefined;
  }

  // ---------- entités ----------
  const cache = new WeakMap<object, Any>();
  const targetOf = (e: Actor): Target => (e instanceof EnginePlayer ? { kind: 'player' } : { kind: 'entity', e: e as EngineEntity });
  function engineTypeId(e: Actor): string {
    if (e instanceof EnginePlayer) return 'minecraft:player';
    if (e instanceof Mob) return NS(e.def.key);
    if (e instanceof ItemEntity) return 'minecraft:item';
    if (e instanceof Projectile) return e.def ? e.def.id : e.type === 'arrow' || e.type === 'player_arrow' ? 'minecraft:arrow' : e.type === 'ice' ? 'minecraft:snowball' : `minecraft:${e.type}`;
    return 'minecraft:unknown';
  }
  function families(e: Actor): string[] {
    if (e instanceof EnginePlayer) return ['player', 'mob'];
    if (e instanceof Mob) return familiesOf(e.def);
    return [strip(engineTypeId(e))];
  }
  function entityMatches(e: Actor, q?: Any): boolean {
    if (!q) return true;
    const tid = engineTypeId(e);
    const eq = (a: string) => NS(strip(String(a))) === tid || a === tid;
    if (q.type !== undefined) {
      const neg = String(q.type).startsWith('!');
      if (eq(String(q.type).replace(/^!/, '')) === neg) return false;
    }
    if (q.excludeTypes?.some(eq)) return false;
    if (q.families && !q.families.every((f: string) => families(e).includes(f))) return false;
    if (q.excludeFamilies?.some((f: string) => families(e).includes(f))) return false;
    const tags = e instanceof EnginePlayer ? e.tags : (e as EngineEntity).tags;
    if (q.tags && !q.tags.every((t: string) => tags.has(t))) return false;
    if (q.excludeTags?.some((t: string) => tags.has(t))) return false;
    const name = e instanceof EnginePlayer ? e.name : (e as EngineEntity).nameTag;
    if (q.name !== undefined && name !== q.name) return false;
    if (q.excludeNames?.includes(name)) return false;
    if (q.location) {
      const l = toV(q.location);
      const d = Math.hypot(e.x - l.x, e.y - l.y, e.z - l.z);
      if (q.maxDistance !== undefined && d > q.maxDistance) return false;
      if (q.minDistance !== undefined && d < q.minDistance) return false;
      if (q.volume) {
        const v = toV(q.volume);
        if (e.x < Math.min(l.x, l.x + v.x) || e.x > Math.max(l.x, l.x + v.x) + 1 || e.y < Math.min(l.y, l.y + v.y) - 1 || e.y > Math.max(l.y, l.y + v.y) + 1 || e.z < Math.min(l.z, l.z + v.z) || e.z > Math.max(l.z, l.z + v.z) + 1) return false;
      }
    }
    if (q.gameMode !== undefined) {
      if (!(e instanceof EnginePlayer)) return false;
      if (String(q.gameMode).toLowerCase() !== e.gameMode) return false;
    }
    if (q.excludeGameModes) {
      if (e instanceof EnginePlayer && q.excludeGameModes.some((g: string) => String(g).toLowerCase() === e.gameMode)) return false;
    }
    if (q.scoreOptions) {
      for (const so of q.scoreOptions) {
        const v = S().scoreboard.score(so.objective, e instanceof EnginePlayer ? 'player' : `e:${(e as EngineEntity).id}`);
        const ok = v !== undefined && (so.minScore === undefined || v >= so.minScore) && (so.maxScore === undefined || v <= so.maxScore);
        if (ok === !!so.exclude) return false;
      }
    }
    if (q.minLevel !== undefined || q.maxLevel !== undefined) {
      if (!(e instanceof EnginePlayer)) return false;
      if (q.minLevel !== undefined && e.level < q.minLevel) return false;
      if (q.maxLevel !== undefined && e.level > q.maxLevel) return false;
    }
    if (q.propertyOptions) {
      for (const po of q.propertyOptions) {
        const v = getProp(e, po.propertyId);
        if (po.value !== undefined) {
          const pv = po.value;
          const ok = typeof pv === 'object' && pv !== null ? (pv.lowerBound === undefined || v >= pv.lowerBound) && (pv.upperBound === undefined || v <= pv.upperBound) && (pv.equals === undefined || v === pv.equals) && (pv.notEquals === undefined || v !== pv.notEquals) : v === pv;
          if (ok === !!po.exclude) return false;
        }
      }
    }
    return true;
  }
  function sortQuery(list: Any[], q?: Any) {
    if (q?.location && (q.closest || q.farthest)) {
      const l = toV(q.location);
      list.sort((a, b) => Math.hypot(a.location.x - l.x, a.location.y - l.y, a.location.z - l.z) - Math.hypot(b.location.x - l.x, b.location.y - l.y, b.location.z - l.z));
      if (q.farthest) list.reverse();
      return list.slice(0, q.closest ?? q.farthest);
    }
    return list;
  }
  function getProp(e: Actor, id: string): Any {
    const dp = e instanceof EnginePlayer ? e.dynProps : (e as EngineEntity).dynProps;
    const k = `__prop:${id}`;
    if (dp.has(k)) return dp.get(k);
    if (e instanceof EnginePlayer) return PLAYER_PROPERTIES.get(id);
    return e instanceof Mob ? e.def.properties?.[id] : undefined;
  }

  function fakeEntity(typeId: string, p: V3): Any {
    return { id: `-${Math.floor(Math.random() * 1e9)}`, typeId: NS(strip(typeId)), location: p, dimension: overworld, isValid: v2 ? false : () => false, nameTag: '', remove() {}, kill() { return false; }, getComponent() { return undefined; }, addTag() { return false; }, hasTag() { return false; }, getTags() { return []; } };
  }

  class Entity {
    constructor(readonly _e: Actor) {}
    get _engine(): Actor {
      return this._e;
    }
    get id() {
      return this._e instanceof EnginePlayer ? '-4294967295' : String((this._e as EngineEntity).id);
    }
    get typeId() {
      return engineTypeId(this._e);
    }
    get dimension() {
      return overworld;
    }
    get location() {
      return vec(this._e.x, this._e.y, this._e.z);
    }
    get isValid(): Any {
      const e = this._e;
      const ok = e instanceof EnginePlayer ? true : !(e as EngineEntity).removed && S().entities.entities.includes(e as EngineEntity);
      return v2 ? ok : () => ok;
    }
    get lifetimeState() {
      return 'Loaded';
    }
    get localizationKey() {
      return `entity.${strip(this.typeId)}.name`;
    }
    get nameTag() {
      return this._e instanceof EnginePlayer ? this._e.nameTag || '' : (this._e as EngineEntity).nameTag;
    }
    set nameTag(v: string) {
      if (this._e instanceof EnginePlayer) this._e.nameTag = String(v ?? '');
      else (this._e as EngineEntity).nameTag = String(v ?? '');
    }
    get scoreboardIdentity() {
      return identityFor(this._e instanceof EnginePlayer ? 'player' : `e:${(this._e as EngineEntity).id}`, this.nameTag || this.typeId, this);
    }
    get isSneaking() {
      return this._e instanceof EnginePlayer ? this._e.sneaking : false;
    }
    set isSneaking(v: boolean) {
      if (this._e instanceof EnginePlayer) this._e.sneaking = !!v;
    }
    get isSprinting() {
      return this._e instanceof EnginePlayer ? this._e.sprinting : false;
    }
    get isOnGround() {
      return this._e.body.onGround;
    }
    get isInWater() {
      return this._e.body.inWater;
    }
    get isFalling() {
      return !this._e.body.onGround && this._e.body.vy < 0;
    }
    get isSwimming() {
      return this._e.body.inWater && !this._e.body.onGround;
    }
    get isClimbing() {
      return false;
    }
    get isSleeping() {
      return false;
    }
    get target() {
      if (this._e instanceof Mob) {
        const st = String(this._e.ai.state);
        if (/chase|attack/i.test(st)) return wrapEntity(S().player);
      }
      return undefined;
    }
    // --- composants ---
    getComponent(id: string): Any {
      return entityComponent(this, strip(id));
    }
    hasComponent(id: string) {
      return !!this.getComponent(id);
    }
    getComponents() {
      return ['health', 'type_family', 'inventory', 'equippable', 'movement'].map((c) => this.getComponent(c)).filter(Boolean);
    }
    // --- étiquettes ---
    private get _tags() {
      return this._e instanceof EnginePlayer ? this._e.tags : (this._e as EngineEntity).tags;
    }
    addTag(t: string) {
      if (this._tags.has(t)) return false;
      this._tags.add(String(t));
      return true;
    }
    removeTag(t: string) {
      return this._tags.delete(t);
    }
    hasTag(t: string) {
      return this._tags.has(t);
    }
    getTags() {
      return [...this._tags];
    }
    // --- propriétés dynamiques et d'entité ---
    private get _dp() {
      return this._e instanceof EnginePlayer ? this._e.dynProps : (this._e as EngineEntity).dynProps;
    }
    getDynamicProperty(id: string) {
      return this._dp.get(String(id));
    }
    setDynamicProperty(id: string, v?: Any) {
      if (v === undefined) this._dp.delete(String(id));
      else this._dp.set(String(id), serializeProp(v));
    }
    getDynamicPropertyIds() {
      return [...this._dp.keys()].filter((k) => !k.startsWith('__prop:'));
    }
    getDynamicPropertyTotalByteCount() {
      return JSON.stringify(Object.fromEntries(this._dp)).length;
    }
    clearDynamicProperties() {
      for (const k of [...this._dp.keys()]) if (!k.startsWith('__prop:')) this._dp.delete(k);
    }
    getProperty(id: string) {
      return getProp(this._e, id);
    }
    setProperty(id: string, v: Any) {
      this._dp.set(`__prop:${id}`, v);
    }
    resetProperty(id: string) {
      this._dp.delete(`__prop:${id}`);
      return getProp(this._e, id);
    }
    // --- effets ---
    private get _fx() {
      return this._e instanceof EnginePlayer ? this._e.effects : (this._e as EngineEntity).effects;
    }
    addEffect(type: Any, duration: number, opts?: Any) {
      const id = effectId(typeof type === 'string' ? type : type?.getName?.() ?? String(type));
      if (!id) throw new Error(`Effet inconnu : ${typeof type === 'string' ? type : type?.getName?.()}`);
      const ok = this._fx.add(id, Math.max(1, Math.floor(duration)), opts?.amplifier ?? 0, opts?.showParticles ?? true, effectTargetOf(S(), targetOf(this._e)));
      if (ok) host.instances.forEach((inst) => inst.fire.effectAdd(this._e, id));
      return v2 ? this.getEffect(id) : ok;
    }
    removeEffect(type: Any) {
      return this._fx.remove(typeof type === 'string' ? type : type?.getName?.() ?? '');
    }
    getEffect(type: Any) {
      const e = this._fx.get(typeof type === 'string' ? type : type?.getName?.() ?? '');
      return e ? effectObj(e) : undefined;
    }
    getEffects() {
      return this._fx.list.map(effectObj);
    }
    // --- mouvement ---
    applyImpulse(v: Any) {
      const d = toV(v);
      const b = this._e.body;
      b.vx += clampV(d.x * 20);
      b.vy += clampV(d.y * 20);
      b.vz += clampV(d.z * 20);
    }
    applyKnockback(a: Any, b?: Any, c?: number, d?: number) {
      const body = this._e.body;
      if (typeof a === 'object' && a !== null) {
        body.vx = clampV(Number(a.x ?? 0) * 20);
        body.vz = clampV(Number(a.z ?? 0) * 20);
        body.vy = clampV(Number(b ?? 0) * 20);
      } else {
        const len = Math.hypot(Number(a), Number(b)) || 1;
        body.vx = clampV((Number(a) / len) * (c ?? 0) * 20);
        body.vz = clampV((Number(b) / len) * (c ?? 0) * 20);
        body.vy = clampV((d ?? 0) * 20);
      }
    }
    clearVelocity() {
      const b = this._e.body;
      b.vx = b.vy = b.vz = 0;
    }
    getVelocity() {
      const b = this._e.body;
      return vec(b.vx / 20, b.vy / 20, b.vz / 20);
    }
    getHeadLocation() {
      const h = this._e instanceof EnginePlayer ? this._e.eyeHeight : this._e.body.height * 0.85;
      return vec(this._e.x, this._e.y + h, this._e.z);
    }
    getViewDirection() {
      const yaw = this._e.yaw;
      const pitch = this._e instanceof EnginePlayer ? this._e.pitch : 0;
      return vec(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    }
    getRotation() {
      const yaw = this._e.yaw;
      const pitch = this._e instanceof EnginePlayer ? this._e.pitch : 0;
      let ry = ((Math.PI - yaw) * DEG) % 360;
      if (ry >= 180) ry -= 360;
      if (ry < -180) ry += 360;
      return { x: -pitch * DEG, y: ry };
    }
    setRotation(r: Any) {
      if (r?.y !== undefined) this._e.yaw = Math.PI - Number(r.y) / DEG;
      if (r?.x !== undefined && this._e instanceof EnginePlayer) this._e.pitch = Math.max(-1.55, Math.min(1.55, -Number(r.x) / DEG));
    }
    lookAt(loc: Any) {
      const p = toV(loc);
      const h = this.getHeadLocation();
      const dx = p.x - h.x, dy = p.y - h.y, dz = p.z - h.z;
      this._e.yaw = Math.atan2(-dx, -dz);
      if (this._e instanceof EnginePlayer) this._e.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    teleport(loc: Any, opts?: Any) {
      const p = toV(loc);
      if (opts?.dimension && opts.dimension !== overworld && !(opts.dimension instanceof Dimension && opts.dimension.id === 'minecraft:overworld')) return;
      const b = this._e.body;
      b.setPos(p.x, p.y, p.z);
      if (!opts?.keepVelocity) b.vx = b.vy = b.vz = 0;
      b.fallDistance = 0;
      if (opts?.rotation) this.setRotation(opts.rotation);
      if (opts?.facingLocation) this.lookAt(opts.facingLocation);
    }
    tryTeleport(loc: Any, opts?: Any) {
      this.teleport(loc, opts);
      return true;
    }
    // --- vie ---
    applyDamage(amount: number, opts?: Any) {
      const cause = opts?.cause ?? (opts?.damagingProjectile ? 'projectile' : opts?.damagingEntity ? 'entityAttack' : 'none');
      const attacker = opts?.damagingEntity?._e ?? null;
      const proj = opts?.damagingProjectile?._e ?? null;
      const e = this._e;
      if (e instanceof EnginePlayer) {
        const src = cause === 'fall' ? 'fall' : cause === 'lava' ? 'lava' : /fire/.test(cause) ? 'fire' : cause === 'drowning' ? 'drown' : cause === 'void' ? 'void' : cause === 'projectile' ? 'projectile' : /xplosion/.test(cause) ? 'explosion' : cause === 'starve' ? 'starve' : attacker ? 'mob' : 'contact';
        e.invulnerable = 0;
        return e.damage(amount, src, 0, 0, attacker, proj) > 0;
      }
      if (e instanceof Mob) {
        e.iframes = 0;
        return S().combat.damageMob(e, amount, { kind: attacker instanceof EnginePlayer ? 'player' : proj ? 'projectile' : 'environment', fromPlayer: attacker instanceof EnginePlayer, cause, attacker, projectile: proj, fire: /fire|lava/.test(cause) }) > 0;
      }
      return damageTarget(S(), targetOf(e), amount, cause);
    }
    kill() {
      const e = this._e;
      if (e instanceof EnginePlayer) e.damage(1e6, 'void');
      else if (e instanceof Mob) S().combat.damageMob(e, 1e6, { kind: 'environment', cause: 'selfDestruct' });
      else (e as EngineEntity).removed = true;
      return true;
    }
    remove() {
      const e = this._e;
      if (e instanceof EnginePlayer) throw new Error('Impossible de retirer le joueur');
      (e as EngineEntity).removed = true;
    }
    setOnFire(seconds: number, _useEffects = true) {
      const e = this._e;
      if (e instanceof Mob) e.dynProps.set('__fire', host.tick + Math.round(seconds * 20));
      else if (e instanceof EnginePlayer) e.dynProps.set('__fire', host.tick + Math.round(seconds * 20));
      return true;
    }
    extinguishFire(_useEffects = true) {
      this._dp.delete('__fire');
      return true;
    }
    // --- divers ---
    runCommand(cmd: string) {
      const e = this._e;
      const rot = { yaw: e.yaw, pitch: e instanceof EnginePlayer ? e.pitch : 0 };
      return { successCount: host.runCommand(cmd, targetOf(e), { x: e.x, y: e.y, z: e.z, ...rot }) };
    }
    runCommandAsync(cmd: string) {
      return Promise.resolve(this.runCommand(cmd));
    }
    triggerEvent(_name: string) {}
    playAnimation(_name: string, _opts?: Any) {}
    matches(q: Any) {
      return entityMatches(this._e, q);
    }
    getBlockFromViewDirection(opts?: Any) {
      return rayBlock(overworld, this.getHeadLocation(), this.getViewDirection(), opts);
    }
    getEntitiesFromViewDirection(opts?: Any) {
      return overworld.getEntitiesFromRay(this.getHeadLocation(), this.getViewDirection(), opts).filter((h) => h.entity._e !== this._e);
    }
    getAllBlocksStandingOn() {
      const b = this.dimension.getBlock(vec(this._e.x, this._e.y - 0.05, this._e.z));
      return b && !b.isAir ? [b] : [];
    }
    getBlockStandingOn() {
      return this.getAllBlocksStandingOn()[0];
    }
  }
  const clampV = (v: number) => Math.max(-60, Math.min(60, v));
  function effectObj(e: { id: string; amplifier: number; duration: number }) {
    return { typeId: e.id, amplifier: e.amplifier, duration: e.duration < 0 ? 20000000 : e.duration, displayName: `${EFFECTS[e.id] ?? e.id}${e.amplifier ? ` ${['I', 'II', 'III', 'IV', 'V'][e.amplifier] ?? e.amplifier + 1}` : ''}`, isValid: true };
  }

  function entityComponent(ent: Entity, k: string): Any {
    const e = ent._e;
    const base = { typeId: `minecraft:${k}`, entity: ent, isValid: true };
    const s = S();
    if (k === 'health') {
      const get = () => (e instanceof EnginePlayer ? e.health : e instanceof Mob ? e.health : 1);
      const max = () => (e instanceof EnginePlayer ? e.maxHealth : e instanceof Mob ? e.maxHealth : 1);
      const set = (v: number) => {
        const nv = Math.max(0, Math.min(max(), v));
        if (e instanceof EnginePlayer) {
          e.health = nv;
          if (nv <= 0) e.damage(1e6, 'void');
        } else if (e instanceof Mob) {
          e.health = nv;
          if (nv <= 0) s.combat.damageMob(e, 1e6, { kind: 'environment' });
        }
        return true;
      };
      return {
        ...base,
        get currentValue() {
          return get();
        },
        get effectiveMax() {
          return max();
        },
        get effectiveMin() {
          return 0;
        },
        get defaultValue() {
          return max();
        },
        setCurrentValue: set,
        resetToMaxValue: () => set(max()),
        resetToDefaultValue: () => set(max()),
        resetToMinValue: () => set(0),
      };
    }
    if (k === 'type_family') return { ...base, hasTypeFamily: (f: string) => families(e).includes(f), getTypeFamilies: () => families(e) };
    if (k === 'movement') {
      const v = e instanceof Mob ? e.def.speed / 10 : 0.1;
      return { ...base, currentValue: v, defaultValue: v, effectiveMax: v, effectiveMin: 0, setCurrentValue: () => true, resetToDefaultValue: () => true, resetToMaxValue: () => true, resetToMinValue: () => true };
    }
    if (k === 'onfire') {
      const until = (e instanceof EnginePlayer ? e.dynProps : (e as EngineEntity).dynProps).get('__fire') as number | undefined;
      return until && until > host.tick ? { ...base, onFireTicksRemaining: until - host.tick } : undefined;
    }
    if (k === 'scale') return { ...base, value: e instanceof Mob ? (e.def.scale ?? 1) * (e.baby ? 0.55 : 1) : 1 };
    if (k === 'variant' || k === 'mark_variant' || k === 'skin_id') return e instanceof Mob ? { ...base, value: Number(e.dynProps.get(`__${k}`) ?? (k === 'variant' ? e.def.variant ?? 0 : 0)) } : undefined;
    if (k === 'is_baby') return e instanceof Mob && e.baby ? base : undefined;
    if (k === 'can_fly') return e instanceof Mob && e.has('flies') ? base : undefined;
    if (k === 'can_climb') return e instanceof Mob && e.has('climbs') ? base : undefined;
    if (k === 'item') return e instanceof ItemEntity ? { ...base, itemStack: ItemStack._from({ id: e.itemId, count: e.count, ...(e.durability !== undefined ? { durability: e.durability } : {}), ...((e as Any).meta ? { meta: (e as Any).meta } : {}) }) } : undefined;
    if (k === 'projectile') {
      if (!(e instanceof Projectile)) return undefined;
      return {
        ...base,
        get owner() {
          return e.owner ? wrapEntity(e.owner) : e.fromPlayer && !e.def ? wrapEntity(s.player) : undefined;
        },
        set owner(o: Any) {
          e.owner = o?._e ?? null;
          e.fromPlayer = !(o?._e instanceof Mob);
        },
        shoot: (v: Any, opts?: Any) => {
          const d = toV(v);
          const u = Number(opts?.uncertainty ?? 0) * 0.01;
          e.body.vx = clampV((d.x + (Math.random() - 0.5) * u) * 20);
          e.body.vy = clampV((d.y + (Math.random() - 0.5) * u) * 20);
          e.body.vz = clampV((d.z + (Math.random() - 0.5) * u) * 20);
        },
        gravity: (e.def?.gravity ?? 12) / 240,
        airInertia: 0.99,
        catchFireOnHurt: false,
        critParticlesOnProjectileHurt: false,
        destroyOnProjectileHurt: false,
        hitEntitySound: undefined,
        hitGroundSound: undefined,
        lightningStrikeOnHit: false,
        liquidInertia: 0.6,
        onFireTime: 0,
        shouldBounceOnHit: false,
        stopOnHit: false,
      };
    }
    if (k === 'rideable') return e instanceof Mob ? { ...base, seatCount: 1, controllingSeat: 0, crouchingSkipInteract: true, family: [], interactText: '', passengerMaxWidth: 0, pullInEntities: false, riderCanInteract: false, addRider: () => false, ejectRider() {}, ejectRiders() {}, getFamilyTypes: () => [], getRiders: () => [], getSeats: () => [] } : undefined;
    if (k === 'riding') return undefined;
    if (e instanceof EnginePlayer) {
      if (k === 'inventory') return { ...base, container: new Container(playerStore()), inventorySize: e.inventory.size, containerType: 'inventory', canBeSiphonedFrom: false, private: false, restrictToOwner: false, additionalSlotsPerStrength: 0 };
      if (k === 'equippable') return equippable(base);
      if (k === 'cursor_inventory') return { ...base, item: undefined, clear() {} };
      if (k === 'player.hunger' || k === 'player.saturation' || k === 'player.exhaustion' || k === 'breathable') {
        const field = k === 'player.hunger' ? 'hunger' : k === 'player.saturation' ? 'saturation' : k === 'player.exhaustion' ? 'exhaustion' : 'air';
        const max = field === 'air' ? 300 : 20;
        return {
          ...base,
          get currentValue() {
            return (e as Any)[field];
          },
          effectiveMax: max,
          effectiveMin: 0,
          defaultValue: max,
          setCurrentValue: (v: number) => ((e as Any)[field] = Math.max(0, Math.min(max, v))) >= 0,
          resetToDefaultValue: () => ((e as Any)[field] = max) >= 0,
          resetToMaxValue: () => ((e as Any)[field] = max) >= 0,
          resetToMinValue: () => ((e as Any)[field] = 0) >= 0,
          airSupply: e.air,
          totalSupply: 300,
          suffocateTime: 0,
        };
      }
    }
    return undefined;
  }

  function equippable(base: Any) {
    const s = S();
    const inv = s.player.inventory;
    const armor: Record<string, 'head' | 'chest' | 'legs' | 'feet'> = { Head: 'head', Chest: 'chest', Legs: 'legs', Feet: 'feet', head: 'head', chest: 'chest', legs: 'legs', feet: 'feet' };
    const store = (slot: string): SlotStore => ({
      size: 1,
      get: () => (/mainhand/i.test(slot) ? inv.slots[inv.selected] ?? null : /offhand/i.test(slot) ? host.offhand : armor[slot] ? inv.armor[armor[slot]] : null),
      set: (_i, st) => {
        const v = st && st.count > 0 ? st : null;
        if (/mainhand/i.test(slot)) inv.slots[inv.selected] = v;
        else if (/offhand/i.test(slot)) host.offhand = v;
        else if (armor[slot]) inv.armor[armor[slot]] = v;
        inv.changed();
      },
      valid: () => true,
    });
    return {
      ...base,
      totalArmor: inv.defense(),
      totalToughness: 0,
      getEquipment: (slot: string) => wrapItem(store(slot).get(0)),
      setEquipment: (slot: string, it?: Any) => {
        store(slot).set(0, toEngineItem(it));
        return true;
      },
      getEquipmentSlot: (slot: string) => new ContainerSlot(store(slot), 0),
    };
  }

  class Player extends Entity {
    get name() {
      return S().player.name;
    }
    get level() {
      return S().player.level;
    }
    get totalXpNeededForNextLevel() {
      return S().player.xpToNext;
    }
    get xpEarnedAtCurrentLevel() {
      return S().player.xp;
    }
    getTotalXp() {
      const p = S().player;
      let t = p.xp;
      for (let l = 0; l < p.level; l++) t += 10 + l * 5;
      return t;
    }
    addLevels(n: number) {
      const p = S().player;
      p.level = Math.max(0, p.level + Math.trunc(n));
      return p.level;
    }
    addExperience(n: number) {
      const p = S().player;
      if (n >= 0) p.addXp(n);
      else p.xp = Math.max(0, p.xp + n);
      return this.getTotalXp();
    }
    resetLevel() {
      const p = S().player;
      p.level = 0;
      p.xp = 0;
    }
    get selectedSlotIndex() {
      return S().player.inventory.selected;
    }
    set selectedSlotIndex(i: number) {
      const inv = S().player.inventory;
      inv.selected = Math.max(0, Math.min(8, Math.floor(i)));
      inv.changed();
    }
    get selectedSlot() {
      return this.selectedSlotIndex;
    }
    set selectedSlot(i: number) {
      this.selectedSlotIndex = i;
    }
    get isOp() {
      const v = S().cheats;
      return (() => v) as Any;
    }
    setOp(_v: boolean) {}
    get commandPermissionLevel() {
      return S().cheats ? 2 : 0;
    }
    get playerPermissionLevel() {
      return S().cheats ? 2 : 1;
    }
    get isFlying() {
      return S().player.body.flying;
    }
    get isGliding() {
      return false;
    }
    get isJumping() {
      return !S().player.body.onGround && S().player.body.vy > 0;
    }
    get isEmoting() {
      return false;
    }
    get graphicsMode() {
      return 'Fancy';
    }
    get clientSystemInfo() {
      return { maxRenderDistance: S().settings.renderDistance * 16, memoryTier: 2, platformType: 'Mobile', graphicsMode: 'Fancy' };
    }
    get onScreenDisplay() {
      const hud = S().hud;
      return {
        isValid: true,
        setTitle: (t: Any, opts?: Any) => {
          hud.showTitle?.(typeof t === 'string' ? t : rawTextToString(t), 'title');
          if (opts?.subtitle !== undefined) hud.showTitle?.(typeof opts.subtitle === 'string' ? opts.subtitle : rawTextToString(opts.subtitle), 'subtitle');
        },
        updateSubtitle: (t: Any) => hud.showTitle?.(typeof t === 'string' ? t : rawTextToString(t), 'subtitle'),
        setActionBar: (t: Any) => hud.showTitle?.(Array.isArray(t) ? t.map((x) => (typeof x === 'string' ? x : rawTextToString(x))).join('') : typeof t === 'string' ? t : rawTextToString(t), 'actionbar'),
        clearTitle: () => hud.showTitle?.('', 'title'),
        resetHudElements: () => {},
        setHudVisibility: () => {},
        hideAllExcept: () => {},
        isForcedHidden: () => false,
      };
    }
    get camera() {
      return { isValid: true, clear() {}, fade() {}, setCamera() {}, setFov() {}, playAnimation() {}, attachToEntity() {}, setDefaultCamera() {} };
    }
    get inputInfo() {
      return { lastInputModeUsed: 'Touch', touchOnlyAffectsHotbar: false, getButtonState: () => 'Released', getMovementVector: () => ({ x: S().game.input.moveX ?? 0, y: S().game.input.moveY ?? 0 }) };
    }
    get inputPermissions() {
      return { cameraEnabled: true, movementEnabled: true, isPermissionCategoryEnabled: () => true, setPermissionCategory() {} };
    }
    sendMessage(m: Any) {
      const text = Array.isArray(m) ? m.map((x) => (typeof x === 'string' ? x : rawTextToString(x))).join('') : typeof m === 'string' ? m : rawTextToString(m);
      S().chatMessage(text);
    }
    playSound(id: string, opts?: Any) {
      const p = opts?.location ? toV(opts.location) : undefined;
      S().audio.playId(id, { ...(p ? { x: p.x, y: p.y, z: p.z } : {}), volume: opts?.volume ?? 1, pitch: opts?.pitch ?? 1 });
    }
    playMusic() {}
    queueMusic() {}
    stopMusic() {}
    getGameMode() {
      const m = S().player.gameMode;
      return v2 ? (m === 'creative' ? 'Creative' : 'Survival') : m;
    }
    setGameMode(m?: string) {
      const v = String(m ?? 'survival').toLowerCase();
      host.runCommand(`gamemode ${v === 'creative' || v === 'spectator' ? 'creative' : 'survival'}`, { kind: 'player' });
    }
    getSpawnPoint() {
      const sp = S().player.spawn;
      return { x: sp[0], y: sp[1], z: sp[2], dimension: overworld };
    }
    setSpawnPoint(p?: Any) {
      if (p) S().player.spawn = [p.x, p.y, p.z];
    }
    startItemCooldown(cat: string, ticks: number) {
      host.cooldowns.set(cat, host.tick + ticks);
    }
    getItemCooldown(cat: string) {
      return Math.max(0, (host.cooldowns.get(cat) ?? 0) - host.tick);
    }
    spawnParticle(id: string, loc: Any, vars?: Any) {
      overworld.spawnParticle(id, loc, vars);
    }
    eatItem(item: Any) {
      const st = toEngineItem(item);
      if (st) S().player.eat(st.id);
    }
    postClientMessage() {}
    clearPropertyOverridesForEntity() {}
    setPropertyOverrideForEntity() {}
    removePropertyOverrideForEntity() {}
  }

  function wrapEntity(e: Actor): Any {
    let w = cache.get(e);
    if (!w) {
      w = e instanceof EnginePlayer ? new Player(e) : new Entity(e);
      cache.set(e, w);
    }
    return w;
  }

  // ---------- tableau des scores ----------
  const identities = new Map<string, Any>();
  function identityFor(id: string, display: string, ent?: Entity) {
    let i = identities.get(id);
    if (!i) {
      const type = id === 'player' ? 'Player' : id.startsWith('e:') ? 'Entity' : 'FakePlayer';
      i = { id: identities.size + 1, displayName: display, type, _key: id, getEntity: () => ent ?? findEntity(id), isValid: true };
      identities.set(id, i);
    }
    return i;
  }
  const findEntity = (key: string) => {
    if (key === 'player') return wrapEntity(S().player);
    if (key.startsWith('e:')) {
      const e = S().entities.entities.find((x) => String(x.id) === key.slice(2));
      return e ? wrapEntity(e) : undefined;
    }
    return undefined;
  };
  const participantKey = (p: Any): string => {
    if (typeof p === 'string') return p === S().player.name ? 'player' : `f:${p}`;
    if (p instanceof Entity) return p._e instanceof EnginePlayer ? 'player' : `e:${(p._e as EngineEntity).id}`;
    if (p && p._key) return p._key;
    throw new TypeError('Participant invalide');
  };
  class ScoreboardObjective {
    constructor(readonly id: string) {}
    private get o() {
      const o = S().scoreboard.get(this.id);
      if (!o) throw new Error(`Objectif supprimé : ${this.id}`);
      return o;
    }
    get displayName() {
      return this.o.displayName;
    }
    get isValid() {
      return !!S().scoreboard.get(this.id);
    }
    getScore(p: Any) {
      return this.o.scores.get(participantKey(p));
    }
    setScore(p: Any, v: number) {
      S().scoreboard.set(this.id, participantKey(p), v);
      return true;
    }
    addScore(p: Any, v: number) {
      return S().scoreboard.addTo(this.id, participantKey(p), v);
    }
    removeParticipant(p: Any) {
      const k = participantKey(p);
      const had = this.o.scores.has(k);
      S().scoreboard.resetParticipant(k, this.id);
      return had;
    }
    hasParticipant(p: Any) {
      return this.o.scores.has(participantKey(p));
    }
    getParticipants() {
      return [...this.o.scores.keys()].map((k) => identityFor(k, k.startsWith('f:') ? k.slice(2) : k === 'player' ? S().player.name : k));
    }
    getScores() {
      return [...this.o.scores.entries()].map(([k, score]) => ({ participant: identityFor(k, k.startsWith('f:') ? k.slice(2) : k === 'player' ? S().player.name : k), score }));
    }
  }
  const scoreboard = {
    addObjective: (id: string, displayName?: string) => {
      S().scoreboard.add(id, displayName ?? id);
      return new ScoreboardObjective(id);
    },
    removeObjective: (o: Any) => S().scoreboard.remove(typeof o === 'string' ? o : o.id),
    getObjective: (id: string) => (S().scoreboard.get(id) ? new ScoreboardObjective(id) : undefined),
    getObjectives: () => [...S().scoreboard.objectives.keys()].map((id) => new ScoreboardObjective(id)),
    getParticipants: () => S().scoreboard.participants().map((k) => identityFor(k, k)),
    setObjectiveAtDisplaySlot: (slot: string, opts: Any) => {
      const id = opts?.objective?.id ?? opts?.objective;
      S().scoreboard.display.set(String(slot).toLowerCase(), { id, sort: opts?.sortOrder === 0 || opts?.sortOrder === 'Ascending' ? 'ascending' : 'descending' });
      S().scoreboard.version++;
      return new ScoreboardObjective(id);
    },
    getObjectiveAtDisplaySlot: (slot: string) => {
      const d = S().scoreboard.display.get(String(slot).toLowerCase());
      return d ? { objective: new ScoreboardObjective(d.id), sortOrder: d.sort === 'ascending' ? 0 : 1 } : undefined;
    },
    clearObjectiveAtDisplaySlot: (slot: string) => {
      const d = S().scoreboard.display.get(String(slot).toLowerCase());
      S().scoreboard.display.delete(String(slot).toLowerCase());
      S().scoreboard.version++;
      return d ? new ScoreboardObjective(d.id) : undefined;
    },
  };

  // ---------- structures (en mémoire : copie/rotation de zones du monde) ----------
  class Structure {
    blocks: { x: number; y: number; z: number; id: number; meta: number }[] = [];
    constructor(readonly id: string, public size: V3) {}
    get isValid() {
      return structures.has(this.id);
    }
    getBlockPermutation(p: Any) {
      const v = toV(p);
      const b = this.blocks.find((q) => q.x === v.x && q.y === v.y && q.z === v.z);
      return b ? new BlockPermutation(b.id, b.meta) : undefined;
    }
    setBlockPermutation(p: Any, perm?: BlockPermutation) {
      const v = toV(p);
      this.blocks = this.blocks.filter((q) => !(q.x === v.x && q.y === v.y && q.z === v.z));
      if (perm) this.blocks.push({ ...v, id: perm._id, meta: perm._meta });
    }
    getIsWaterlogged() {
      return false;
    }
    saveAs() {
      return this;
    }
    saveToWorld() {}
  }
  const structures = new Map<string, Structure>();
  /** Structure d'un fichier .mcstructure d'add-on (copie modifiable). */
  function fileStructure(id: string): Structure | undefined {
    const d = STRUCTURES.get(String(id).toLowerCase()) ?? STRUCTURES.get(`mystructure:${String(id).toLowerCase()}`);
    if (!d) return undefined;
    const st = new Structure(id, vec(d.size[0], d.size[1], d.size[2]));
    for (const b of d.blocks) {
      const [bid, meta] = resolveNamedBlock(b.name, b.states);
      if (bid >= 0) st.blocks.push({ x: b.x, y: b.y, z: b.z, id: bid, meta });
    }
    structures.set(id, st);
    return st;
  }
  const structureManager = {
    createEmpty: (id: string, size: Any) => {
      const st = new Structure(id, toV(size));
      structures.set(id, st);
      return st;
    },
    createFromWorld: (id: string, _dim: Any, from: Any, to: Any) => {
      const a = toV(from), b = toV(to);
      const min = vec(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
      const max = vec(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
      if ((max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1) > 65536) throw new Error('Structure trop grande');
      const st = new Structure(id, vec(max.x - min.x + 1, max.y - min.y + 1, max.z - min.z + 1));
      for (let y = min.y; y <= max.y; y++)
        for (let z = min.z; z <= max.z; z++)
          for (let x = min.x; x <= max.x; x++) st.blocks.push({ x: x - min.x, y: y - min.y, z: z - min.z, id: Math.max(0, W().getBlock(x, y, z)), meta: W().getMeta(x, y, z) });
      structures.set(id, st);
      return st;
    },
    get: (id: string) => structures.get(id) ?? fileStructure(id),
    getWorldStructureIds: () => [...structures.keys()],
    delete: (st: Any) => structures.delete(typeof st === 'string' ? st : st?.id),
    place: (st: Any, _dim: Any, loc: Any, opts?: Any) => {
      const s0: Structure | undefined = typeof st === 'string' ? structures.get(st) ?? fileStructure(st) : st;
      if (!s0) throw new Error(`Structure inconnue : ${typeof st === 'string' ? st : st?.id}`);
      const o = toV(loc);
      const steps = { Rotate90: 1, Rotate180: 2, Rotate270: 3 }[String(opts?.rotation ?? 'None')] ?? 0;
      const mirror = String(opts?.mirror ?? 'None');
      const data = { size: [s0.size.x, s0.size.y, s0.size.z] as [number, number, number], blocks: s0.blocks.map((b) => ({ x: b.x, y: b.y, z: b.z, name: BlockRegistry.get(b.id)?.key ?? 'air', states: b.id > 0 && BlockRegistry.get(b.id).def.bedrock ? (decodeStates(BlockRegistry.get(b.id).def.bedrock!, b.meta) as Record<string, string | number | boolean>) : {} })) };
      placeStructure(W(), data, Math.floor(o.x), Math.floor(o.y), Math.floor(o.z), steps, mirror, opts?.includeBlocks !== false);
    },
    placeJigsaw: () => undefined,
    placeJigsawStructure: () => undefined,
  };

  // ---------- monde ----------
  const gameRules = new Proxy({} as Record<string, Any>, {
    get(_t, k: string) {
      const key = RULE_ALIASES[String(k).toLowerCase()];
      if (key) return S().gamerules[key];
      const v = S().extraRules.get(String(k).toLowerCase());
      return v === undefined ? (/spawnradius|maxcommandchainlength|randomtickspeed|functioncommandlimit/i.test(String(k)) ? 3 : true) : v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v;
    },
    set(_t, k: string, v: Any) {
      const key = RULE_ALIASES[String(k).toLowerCase()] as keyof GameRules | undefined;
      if (key) S().gamerules[key] = !!v;
      else S().extraRules.set(String(k).toLowerCase(), String(v));
      return true;
    },
  });

  const world = {
    afterEvents,
    beforeEvents,
    scoreboard,
    gameRules,
    structureManager,
    isHardcore: false,
    seed: undefined as Any,
    getDimension: (id: string) => dimById(id),
    getAllPlayers: () => [wrapEntity(S().player)],
    getPlayers: (q?: Any) => overworld.getPlayers(q),
    getEntity: (id: string) => (id === '-4294967295' ? wrapEntity(S().player) : findEntity(`e:${id}`)),
    getDynamicProperty: (id: string) => S().worldProps.get(String(id)),
    setDynamicProperty: (id: string, v?: Any) => {
      if (v === undefined) S().worldProps.delete(String(id));
      else S().worldProps.set(String(id), serializeProp(v));
    },
    setDynamicProperties: (o: Record<string, Any>) => Object.entries(o).forEach(([k, v]) => world.setDynamicProperty(k, v)),
    getDynamicPropertyIds: () => [...S().worldProps.keys()],
    getDynamicPropertyTotalByteCount: () => JSON.stringify(Object.fromEntries(S().worldProps)).length,
    clearDynamicProperties: () => S().worldProps.clear(),
    getTimeOfDay: () => Math.floor(S().dayCycle.time * 24000) % 24000,
    setTimeOfDay: (t: number) => setTimeTicks(S(), Number(t)),
    getAbsoluteTime: () => S().dayCycle.day * 24000 + Math.floor(S().dayCycle.time * 24000),
    setAbsoluteTime: (t: number) => {
      S().dayCycle.day = Math.floor(t / 24000);
      S().dayCycle.time = (t % 24000) / 24000;
    },
    getDay: () => S().dayCycle.day,
    getMoonPhase: () => S().dayCycle.day % 8,
    getDifficulty: () => {
      const d = S().player.difficulty;
      return v2 ? d[0].toUpperCase() + d.slice(1) : d;
    },
    setDifficulty: (d: string) => host.runCommand(`difficulty ${String(d).toLowerCase()}`, null),
    sendMessage: (m: Any) => S().chatMessage(Array.isArray(m) ? m.map((x) => (typeof x === 'string' ? x : rawTextToString(x))).join('') : typeof m === 'string' ? m : rawTextToString(m)),
    playSound: (id: string, loc: Any, opts?: Any) => overworld.playSound(id, loc, opts),
    playMusic() {},
    queueMusic() {},
    stopMusic() {},
    getDefaultSpawnLocation: () => {
      const sp = S().player.spawn;
      return vec(Math.floor(sp[0]), Math.floor(sp[1]), Math.floor(sp[2]));
    },
    setDefaultSpawnLocation: (p: Any) => (S().player.spawn = [p.x, p.y, p.z]),
    broadcastClientMessage() {},
    getLootTableManager: () => undefined,
  };
  Object.defineProperty(world, 'seed', { get: () => String(S().world.seed) });

  // ---------- système ----------
  const system = {
    afterEvents: systemAfter,
    beforeEvents: systemBefore,
    get currentTick() {
      return host.tick;
    },
    isEditorWorld: false,
    serverSystemInfo: { memoryTier: 2 },
    run: (fn: () => void) => host.schedule(fn, 0),
    runTimeout: (fn: () => void, ticks = 1) => host.schedule(fn, Math.max(0, Math.floor(Number(ticks) || 0))),
    runInterval: (fn: () => void, ticks = 1) => host.schedule(fn, Math.max(1, Math.floor(Number(ticks) || 1)), Math.max(1, Math.floor(Number(ticks) || 1))),
    runJob: (gen: Generator) => {
      const id = host.schedule(
        () => {
          const t0 = performance.now();
          try {
            while (performance.now() - t0 < 4) {
              const r = gen.next();
              if (r.done) {
                host.clearRun(id);
                return;
              }
            }
          } catch (e) {
            host.clearRun(id);
            throw e;
          }
        },
        0,
        1,
      );
      return id;
    },
    clearJob: (id: number) => host.clearRun(id),
    clearRun: (id: number) => host.clearRun(id),
    waitTicks: (n: number) => new Promise<void>((res) => host.schedule(res, Math.max(1, Math.floor(n)))),
    sendScriptEvent: (id: string, msg: string) => host.sendScriptEvent(id, msg, null),
  };

  // ---------- composants personnalisés ----------
  const blockComponents = new Map<string, Record<string, (...a: Any[]) => unknown>>();
  const itemComponents = new Map<string, Record<string, (...a: Any[]) => unknown>>();
  const commands: { name: string; cb: (...a: Any[]) => Any; params: Any[] }[] = [];
  const registries = {
    blockComponentRegistry: { registerCustomComponent: (name: string, c: Any) => void blockComponents.set(name, c) },
    itemComponentRegistry: { registerCustomComponent: (name: string, c: Any) => void itemComponents.set(name, c) },
    customCommandRegistry: {
      registerCommand: (def: Any, cb: Any) => void commands.push({ name: String(def?.name ?? ''), cb, params: [...(def?.mandatoryParameters ?? []), ...(def?.optionalParameters ?? [])] }),
      registerEnum: () => {},
    },
    dimensionRegistry: { registerCustomDimension() {} },
  };

  // ---------- enums ----------
  const E = (o: Record<string, string | number>) => Object.freeze(o);
  const GameMode = v2 ? E({ Adventure: 'Adventure', Creative: 'Creative', Spectator: 'Spectator', Survival: 'Survival' }) : E({ adventure: 'adventure', creative: 'creative', spectator: 'spectator', survival: 'survival' });
  const EntityDamageCause = E(Object.fromEntries(['anvil', 'blockExplosion', 'campfire', 'charging', 'contact', 'drowning', 'entityAttack', 'entityExplosion', 'fall', 'fallingBlock', 'fire', 'fireTick', 'fireworks', 'flyIntoWall', 'freezing', 'lava', 'lightning', 'maceSmash', 'magic', 'magma', 'none', 'override', 'piston', 'projectile', 'ramAttack', 'selfDestruct', 'sonicBoom', 'soulCampfire', 'stalactite', 'stalagmite', 'starve', 'suffocation', 'suicide', 'temperature', 'thorns', 'void', 'wither'].map((k) => [k, k])));
  const Direction = E({ Down: 'Down', East: 'East', North: 'North', South: 'South', Up: 'Up', West: 'West' });
  const EquipmentSlot = E({ Chest: 'Chest', Feet: 'Feet', Head: 'Head', Legs: 'Legs', Mainhand: 'Mainhand', Offhand: 'Offhand' });
  const ItemLockMode = E({ inventory: 'inventory', none: 'none', slot: 'slot' });
  const EntityComponentTypes = E(Object.fromEntries(['AddRider', 'Ageable', 'Breathable', 'CanClimb', 'CanFly', 'CanPowerJump', 'Color', 'Color2', 'CursorInventory', 'Equippable', 'FireImmune', 'FloatsInLiquid', 'FlyingSpeed', 'FrictionModifier', 'Healable', 'Health', 'Inventory', 'IsBaby', 'IsCharged', 'IsChested', 'IsDyeable', 'IsHiddenWhenInvisible', 'IsIgnited', 'IsIllagerCaptain', 'IsSaddled', 'IsShaking', 'IsSheared', 'IsStackable', 'IsStunned', 'IsTamed', 'Item', 'LavaMovement', 'Leashable', 'MarkVariant', 'Movement', 'OnFire', 'Projectile', 'PushThrough', 'Rideable', 'Riding', 'Scale', 'SkinId', 'Strength', 'Tameable', 'TameMount', 'TypeFamily', 'UnderwaterMovement', 'Variant', 'WantsJockey'].map((k) => [k, `minecraft:${k.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase())}`])));
  const ItemComponentTypes = E({ Cooldown: 'minecraft:cooldown', Durability: 'minecraft:durability', Enchantable: 'minecraft:enchantable', Food: 'minecraft:food', Compostable: 'minecraft:compostable', Dyeable: 'minecraft:dyeable', Potion: 'minecraft:potion' });
  const BlockComponentTypes = E({ Inventory: 'minecraft:inventory', Piston: 'minecraft:piston', RecordPlayer: 'minecraft:record_player', Sign: 'minecraft:sign', FluidContainer: 'minecraft:fluid_container' });
  const ScoreboardIdentityType = E({ Entity: 'Entity', FakePlayer: 'FakePlayer', Player: 'Player' });
  const DisplaySlotId = E({ BelowName: 'BelowName', List: 'List', Sidebar: 'Sidebar' });
  const ObjectiveSortOrder = E({ Ascending: 0, Descending: 1 });
  const WeatherType = E({ Clear: 'Clear', Rain: 'Rain', Thunder: 'Thunder' });
  const Difficulty = v2 ? E({ Easy: 'Easy', Hard: 'Hard', Normal: 'Normal', Peaceful: 'Peaceful' }) : E({ Easy: 0, Hard: 3, Normal: 2, Peaceful: 1 });
  const CommandPermissionLevel = E({ Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 });
  const CustomCommandStatus = E({ Success: 0, Failure: 1 });
  const CustomCommandParamType = E({ BlockType: 'BlockType', Boolean: 'Boolean', EntitySelector: 'EntitySelector', EntityType: 'EntityType', Enum: 'Enum', Float: 'Float', Integer: 'Integer', ItemType: 'ItemType', Location: 'Location', PlayerSelector: 'PlayerSelector', String: 'String' });
  const InputButton = E({ Jump: 'Jump', Sneak: 'Sneak' });
  const ButtonState = E({ Pressed: 'Pressed', Released: 'Released' });
  const InputMode = E({ Gamepad: 'Gamepad', KeyboardAndMouse: 'KeyboardAndMouse', MotionController: 'MotionController', Touch: 'Touch' });
  const LiquidType = E({ Water: 'Water' });
  const EntityInitializationCause = E({ Born: 'Born', Event: 'Event', Loaded: 'Loaded', Spawned: 'Spawned', Transformed: 'Transformed' });
  const BlockPistonState = E({ Expanded: 'Expanded', Expanding: 'Expanding', Retracted: 'Retracted', Retracting: 'Retracting' });
  const MemoryTier = E({ SuperLow: 0, Low: 1, Mid: 2, High: 3, SuperHigh: 4 });
  const PlatformType = E({ Console: 'Console', Desktop: 'Desktop', Mobile: 'Mobile' });
  const GraphicsMode = E({ Deferred: 'Deferred', Fancy: 'Fancy', RayTraced: 'RayTraced', Simple: 'Simple' });
  const TimeOfDay = E({ Day: 1000, Midnight: 18000, Night: 13000, Noon: 6000, Sunrise: 23000, Sunset: 12000 });
  const FluidType = E({ Lava: 'Lava', Potion: 'Potion', PowderSnow: 'PowderSnow', Water: 'Water' });
  const SignSide = E({ Back: 'Back', Front: 'Front' });
  const StructureRotation = E({ None: 'None', Rotate90: 'Rotate90', Rotate180: 'Rotate180', Rotate270: 'Rotate270' });
  const StructureMirrorAxis = E({ None: 'None', X: 'X', XZ: 'XZ', Z: 'Z' });
  const StructureSaveMode = E({ Memory: 'Memory', World: 'World' });
  const EntityLifetimeState = E({ Loaded: 'Loaded', Unloaded: 'Unloaded' });
  const HudElement = E({ PaperDoll: 0, Armor: 1, ToolTips: 2, TouchControls: 3, Crosshair: 4, Hotbar: 5, Health: 6, ProgressBar: 7, Hunger: 8, AirBubbles: 9, HorseHealth: 10, StatusEffects: 11, ItemText: 12 });
  const HudVisibility = E({ Hide: 0, Reset: 1 });
  const EasingType = E({ Linear: 'Linear', InSine: 'InSine', OutSine: 'OutSine', InOutSine: 'InOutSine' });
  const InputPermissionCategory = E({ Camera: 1, Movement: 2, LateralMovement: 4, Sneak: 5, Jump: 6, Mount: 7, Dismount: 8, MoveForward: 9, MoveBackward: 10, MoveLeft: 11, MoveRight: 12 });
  const PlayerPermissionLevel = E({ Visitor: 0, Member: 1, Operator: 2, Custom: 3 });
  const ScriptEventSource = E({ Block: 'Block', Entity: 'Entity', NPCDialogue: 'NPCDialogue', Server: 'Server' });
  const ItemCooldownCategory = E({});
  const EnchantmentSlot = E({ ArmorFeet: 'ArmorFeet', ArmorHead: 'ArmorHead', ArmorLegs: 'ArmorLegs', ArmorTorso: 'ArmorTorso', Sword: 'Sword', Bow: 'Bow', Pickaxe: 'Pickaxe', Axe: 'Axe', Shovel: 'Shovel', Hoe: 'Hoe', All: 'All' });

  // ---------- registres de types ----------
  const BlockTypes = { get: (id: string) => (blockIdOf(id) >= 0 ? new BlockType(typeIdOfBlock(blockIdOf(id))) : undefined), getAll: () => BlockRegistry.blocks.map((b) => new BlockType(NS(b.key))) };
  const ItemTypes = { get: (id: string) => (ItemRegistry.has(strip(id)) || ItemRegistry.has(id) ? new ItemType(NS(strip(id))) : undefined), getAll: () => ItemRegistry.all().map((d) => new ItemType(NS(d.key))) };
  const EntityTypes = { get: (id: string) => (MOB_BY_KEY.has(id) || MOB_BY_KEY.has(strip(id)) || strip(id) === 'player' ? new EntityType(NS(strip(id))) : undefined), getAll: () => MOB_DEFS.map((d) => new EntityType(NS(d.key))) };
  const EffectTypes = { get: (id: string) => (effectId(id) ? new EffectType(effectId(id)!) : undefined), getAll: () => Object.keys(EFFECTS).map((k) => new EffectType(k)) };
  const EnchantmentTypes = { get: (id: string) => new EnchantmentType(strip(id), ENCH_MAX[strip(id)] ?? 5), getAll: () => Object.keys(ENCH_MAX).map((k) => new EnchantmentType(k, ENCH_MAX[k])) };

  class MolangVariableMap {
    readonly vars = new Map<string, Any>();
    setFloat(k: string, v: number) {
      this.vars.set(k, v);
    }
    setVector3(k: string, v: V3) {
      this.vars.set(k, v);
    }
    setColorRGB(k: string, v: Any) {
      this.vars.set(k, v);
    }
    setColorRGBA(k: string, v: Any) {
      this.vars.set(k, v);
    }
    setSpeedAndDirection(k: string, s: number, d: V3) {
      this.vars.set(k, { s, d });
    }
  }
  class BlockVolumeBase {
    constructor(public from: V3, public to: V3) {}
    getMin() {
      return vec(Math.min(this.from.x, this.to.x), Math.min(this.from.y, this.to.y), Math.min(this.from.z, this.to.z));
    }
    getMax() {
      return vec(Math.max(this.from.x, this.to.x), Math.max(this.from.y, this.to.y), Math.max(this.from.z, this.to.z));
    }
    getSpan() {
      const a = this.getMin(), b = this.getMax();
      return vec(b.x - a.x + 1, b.y - a.y + 1, b.z - a.z + 1);
    }
    getCapacity() {
      const s = this.getSpan();
      return s.x * s.y * s.z;
    }
    isInside(p: V3) {
      const a = this.getMin(), b = this.getMax();
      return p.x >= a.x && p.x <= b.x && p.y >= a.y && p.y <= b.y && p.z >= a.z && p.z <= b.z;
    }
    translate(d: V3) {
      this.from = vec(this.from.x + d.x, this.from.y + d.y, this.from.z + d.z);
      this.to = vec(this.to.x + d.x, this.to.y + d.y, this.to.z + d.z);
    }
    *getBlockLocationIterator() {
      const a = this.getMin(), b = this.getMax();
      for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) for (let z = a.z; z <= b.z; z++) yield vec(x, y, z);
    }
    intersects(o: Any) {
      const a = this.getMin(), b = this.getMax(), c = o.getMin(), d = o.getMax();
      return a.x <= d.x && b.x >= c.x && a.y <= d.y && b.y >= c.y && a.z <= d.z && b.z >= c.z;
    }
  }
  class BlockVolume extends BlockVolumeBase {}

  /** Classe « bouchon » renvoyée pour un export non implémenté (évite l'échec du chargement). */
  const stub = (name: string) =>
    new Proxy(function () {} as Any, {
      get: (_t, k) => (k === 'name' ? name : k === Symbol.toPrimitive ? () => name : stubValue),
      construct: () => ({}),
      apply: () => undefined,
    });
  const stubValue: Any = undefined;

  const exports: Record<string, unknown> = {
    world,
    system,
    Block,
    BlockPermutation,
    BlockType,
    BlockTypes,
    BlockVolume,
    BlockVolumeBase,
    Container,
    ContainerSlot,
    Dimension,
    Entity,
    EntityType,
    EntityTypes,
    EffectType,
    EffectTypes,
    EnchantmentType,
    EnchantmentTypes,
    ItemStack,
    ItemType,
    ItemTypes,
    MolangVariableMap,
    Player,
    ScoreboardObjective,
    GameMode,
    EntityDamageCause,
    Direction,
    EquipmentSlot,
    ItemLockMode,
    EntityComponentTypes,
    ItemComponentTypes,
    BlockComponentTypes,
    ScoreboardIdentityType,
    DisplaySlotId,
    ObjectiveSortOrder,
    WeatherType,
    Difficulty,
    CommandPermissionLevel,
    CustomCommandStatus,
    CustomCommandParamType,
    InputButton,
    ButtonState,
    InputMode,
    LiquidType,
    EntityInitializationCause,
    BlockPistonState,
    MemoryTier,
    PlatformType,
    GraphicsMode,
    TimeOfDay,
    FluidType,
    SignSide,
    StructureRotation,
    StructureMirrorAxis,
    StructureSaveMode,
    EntityLifetimeState,
    HudElement,
    HudVisibility,
    EasingType,
    InputPermissionCategory,
    PlayerPermissionLevel,
    ScriptEventSource,
    ItemCooldownCategory,
    EnchantmentSlot,
    ScriptError,
    InvalidEntityError,
    LocationOutOfWorldBoundariesError,
    LocationInUnloadedChunkError,
    CommandError,
    InvalidContainerSlotError,
    EngineError,
    UnloadedChunksError,
    TicksPerSecond: 20,
    TicksPerDay: 24000,
    MoonPhase: E({ FullMoon: 0, WaningGibbous: 1, FirstQuarter: 2, WaningCrescent: 3, NewMoon: 4, WaxingCrescent: 5, LastQuarter: 6, WaxingGibbous: 7 }),
    __stub: stub,
  };

  // ---------- déclenchement des événements (appelé par l'hôte) ----------
  const ent = (a: Actor | null | undefined) => (a ? wrapEntity(a) : undefined);
  const blockAt = (x: number, y: number, z: number) => new Block(overworld, x, y, z);
  const typeFilter = (e: Actor) => (o: Any) => {
    if (o.entityTypes && !o.entityTypes.some((t: string) => NS(strip(t)) === engineTypeId(e))) return false;
    if (o.entities && !o.entities.some((w: Any) => w?._e === e)) return false;
    if (o.entityFilter && !entityMatches(e, o.entityFilter)) return false;
    return true;
  };
  const damageSource = (ev: DamageEvent) => ({ cause: ev.cause, damagingEntity: ent(ev.attacker), damagingProjectile: ent(ev.projectile) });
  const fire: Record<string, (...args: Any[]) => Any> = {
    startup() {
      const ev = { ...registries };
      systemBefore.startup.emit(ev);
      beforeEvents.worldInitialize.emit(ev);
    },
    worldLoad() {
      afterEvents.worldLoad.emit({});
      afterEvents.worldInitialize.emit({ propertyRegistry: { registerEntityTypeDynamicProperties() {}, registerWorldDynamicProperties() {} } });
    },
    playerJoin() {
      afterEvents.playerJoin.emit({ playerId: '-4294967295', playerName: S().player.name });
    },
    playerSpawn(initial: boolean) {
      afterEvents.playerSpawn.emit({ player: wrapEntity(S().player), initialSpawn: initial });
    },
    beforeHurt(target: Actor, amount: number, ev: DamageEvent) {
      if (!beforeEvents.entityHurt.count) return amount;
      const e = { hurtEntity: wrapEntity(target), damageSource: damageSource(ev), damage: amount, cancel: false };
      beforeEvents.entityHurt.emit(e, typeFilter(target));
      return e.cancel ? 0 : Number(e.damage);
    },
    afterHurt(target: Actor, amount: number, ev: DamageEvent) {
      if (afterEvents.entityHurt.count) afterEvents.entityHurt.emit({ hurtEntity: wrapEntity(target), damageSource: damageSource(ev), damage: amount }, typeFilter(target));
      if (afterEvents.entityHealthChanged.count) {
        const hp = target instanceof EnginePlayer ? target.health : (target as Mob).health;
        afterEvents.entityHealthChanged.emit({ entity: wrapEntity(target), oldValue: hp + amount, newValue: hp }, typeFilter(target));
      }
      if (ev.projectile && afterEvents.projectileHitEntity.count) {
        const hitEnt = wrapEntity(target);
        const p = ev.projectile;
        afterEvents.projectileHitEntity.emit({ projectile: wrapEntity(p), source: ent(ev.attacker), dimension: overworld, location: vec(p.x, p.y, p.z), hitVector: vec(p.body.vx / 20, p.body.vy / 20, p.body.vz / 20), getEntityHit: () => ({ entity: hitEnt }) });
      }
    },
    died(target: Actor, ev: DamageEvent) {
      if (afterEvents.entityDie.count) afterEvents.entityDie.emit({ deadEntity: wrapEntity(target), damageSource: damageSource(ev) }, typeFilter(target));
    },
    entitySpawn(e: Actor, cause: string) {
      if (afterEvents.entitySpawn.count) afterEvents.entitySpawn.emit({ entity: wrapEntity(e), cause });
    },
    entityRemove(e: Actor) {
      if (afterEvents.entityRemove.count) afterEvents.entityRemove.emit({ removedEntityId: String((e as EngineEntity).id), typeId: engineTypeId(e) });
    },
    hitEntity(target: Actor) {
      if (afterEvents.entityHitEntity.count) afterEvents.entityHitEntity.emit({ damagingEntity: wrapEntity(S().player), hitEntity: wrapEntity(target) });
    },
    hitBlock(x: number, y: number, z: number, face: number) {
      if (afterEvents.entityHitBlock.count) afterEvents.entityHitBlock.emit({ damagingEntity: wrapEntity(S().player), hitBlock: blockAt(x, y, z), blockFace: faceDir(face), hitBlockPermutation: blockAt(x, y, z).permutation });
    },
    effectAdd(e: Actor, id: string) {
      if (!afterEvents.effectAdd.count) return;
      const fx = (e instanceof EnginePlayer ? e.effects : (e as EngineEntity).effects).get(id);
      if (fx) afterEvents.effectAdd.emit({ entity: wrapEntity(e), effect: effectObj(fx) });
    },
    beforeInteractBlock(x: number, y: number, z: number, face: number, hit: number[], st: EngineStack | null, first: boolean) {
      if (!beforeEvents.playerInteractWithBlock.count) return false;
      const e = { player: wrapEntity(S().player), block: blockAt(x, y, z), blockFace: faceDir(face), faceLocation: vec(hit[0] - x, hit[1] - y, hit[2] - z), itemStack: wrapItem(st), isFirstEvent: first, cancel: false };
      beforeEvents.playerInteractWithBlock.emit(e);
      return !!e.cancel;
    },
    afterInteractBlock(x: number, y: number, z: number, face: number, hit: number[], st: EngineStack | null, before: EngineStack | null) {
      if (afterEvents.playerInteractWithBlock.count) afterEvents.playerInteractWithBlock.emit({ player: wrapEntity(S().player), block: blockAt(x, y, z), blockFace: faceDir(face), faceLocation: vec(hit[0] - x, hit[1] - y, hit[2] - z), itemStack: wrapItem(st), beforeItemStack: wrapItem(before), isFirstEvent: true });
    },
    beforeInteractEntity(target: Actor, st: EngineStack | null) {
      if (!beforeEvents.playerInteractWithEntity.count) return false;
      const e = { player: wrapEntity(S().player), target: wrapEntity(target), itemStack: wrapItem(st), cancel: false };
      beforeEvents.playerInteractWithEntity.emit(e);
      return !!e.cancel;
    },
    afterInteractEntity(target: Actor, st: EngineStack | null) {
      if (afterEvents.playerInteractWithEntity.count) afterEvents.playerInteractWithEntity.emit({ player: wrapEntity(S().player), target: wrapEntity(target), itemStack: wrapItem(st), beforeItemStack: wrapItem(st) });
    },
    beforeItemUse(st: EngineStack) {
      if (!beforeEvents.itemUse.count) return false;
      const e = { source: wrapEntity(S().player), itemStack: wrapItem(st), cancel: false };
      beforeEvents.itemUse.emit(e);
      return !!e.cancel;
    },
    afterItemUse(st: EngineStack) {
      if (afterEvents.itemUse.count) afterEvents.itemUse.emit({ source: wrapEntity(S().player), itemStack: wrapItem(st) });
    },
    beforeItemUseOn(st: EngineStack, x: number, y: number, z: number, face: number, hit: number[]) {
      if (!beforeEvents.itemUseOn.count) return false;
      const e = { source: wrapEntity(S().player), itemStack: wrapItem(st), block: blockAt(x, y, z), blockFace: faceDir(face), faceLocation: vec(hit[0] - x, hit[1] - y, hit[2] - z), isFirstEvent: true, cancel: false };
      beforeEvents.itemUseOn.emit(e);
      return !!e.cancel;
    },
    afterItemUseOn(st: EngineStack, x: number, y: number, z: number, face: number, hit: number[]) {
      const e = { source: wrapEntity(S().player), itemStack: wrapItem(st), block: blockAt(x, y, z), blockFace: faceDir(face), faceLocation: vec(hit[0] - x, hit[1] - y, hit[2] - z), isFirstEvent: true };
      if (afterEvents.itemUseOn.count) afterEvents.itemUseOn.emit(e);
      if (afterEvents.itemStartUseOn.count) afterEvents.itemStartUseOn.emit(e);
      if (afterEvents.itemStopUseOn.count) afterEvents.itemStopUseOn.emit(e);
    },
    startUse(st: EngineStack) {
      if (afterEvents.itemStartUse.count) afterEvents.itemStartUse.emit({ source: wrapEntity(S().player), itemStack: wrapItem(st), useDuration: 72000 });
    },
    releaseUse(st: EngineStack, ticks: number) {
      if (afterEvents.itemReleaseUse.count) afterEvents.itemReleaseUse.emit({ source: wrapEntity(S().player), itemStack: wrapItem(st), useDuration: ticks });
      if (afterEvents.itemStopUse.count) afterEvents.itemStopUse.emit({ source: wrapEntity(S().player), itemStack: wrapItem(st), useDuration: ticks });
    },
    consumed(st: EngineStack) {
      if (afterEvents.itemCompleteUse.count) afterEvents.itemCompleteUse.emit({ source: wrapEntity(S().player), itemStack: wrapItem(st), useDuration: 0 });
      if (afterEvents.itemStopUse.count) afterEvents.itemStopUse.emit({ source: wrapEntity(S().player), itemStack: wrapItem(st), useDuration: 0 });
    },
    beforeBreak(x: number, y: number, z: number, st: EngineStack | null) {
      if (!beforeEvents.playerBreakBlock.count) return false;
      const e = { player: wrapEntity(S().player), block: blockAt(x, y, z), dimension: overworld, itemStack: wrapItem(st), cancel: false };
      beforeEvents.playerBreakBlock.emit(e);
      return !!e.cancel;
    },
    afterBreak(x: number, y: number, z: number, id: number, meta: number, st: EngineStack | null) {
      if (afterEvents.playerBreakBlock.count) afterEvents.playerBreakBlock.emit({ player: wrapEntity(S().player), block: blockAt(x, y, z), dimension: overworld, brokenBlockPermutation: new BlockPermutation(id, meta), itemStackBeforeBreak: wrapItem(st), itemStackAfterBreak: wrapItem(S().player.inventory.selectedStack) });
    },
    beforePlace(x: number, y: number, z: number, id: number, meta: number, face: number) {
      if (!beforeEvents.playerPlaceBlock.count) return meta;
      const e = { player: wrapEntity(S().player), block: blockAt(x, y, z), dimension: overworld, face: faceDir(face), faceLocation: vec(0.5, 0.5, 0.5), permutationBeingPlaced: new BlockPermutation(id, meta), cancel: false };
      beforeEvents.playerPlaceBlock.emit(e);
      return e.cancel ? null : meta;
    },
    afterPlace(x: number, y: number, z: number) {
      if (afterEvents.playerPlaceBlock.count) afterEvents.playerPlaceBlock.emit({ player: wrapEntity(S().player), block: blockAt(x, y, z), dimension: overworld });
    },
    beforeChat(message: string) {
      if (!beforeEvents.chatSend.count) return false;
      const e = { sender: wrapEntity(S().player), message, cancel: false, getTargets: () => [], sendToTargets: false, setTargets() {}, targets: [] };
      beforeEvents.chatSend.emit(e);
      return !!e.cancel;
    },
    afterChat(message: string) {
      if (afterEvents.chatSend.count) afterEvents.chatSend.emit({ sender: wrapEntity(S().player), message, getTargets: () => [], sendToTargets: false, targets: [] });
    },
    scriptEvent(id: string, message: string, source: Actor | null) {
      if (systemAfter.scriptEventReceive.count)
        systemAfter.scriptEventReceive.emit({ id, message, sourceEntity: ent(source), sourceType: source ? 'Entity' : 'Server', sourceBlock: undefined, initiator: undefined }, (o: Any) => !o.namespaces || o.namespaces.includes(id.split(':')[0]));
    },
    inventoryChange(slot: number, st: EngineStack | null, before: EngineStack | null) {
      if (afterEvents.playerInventoryItemChange.count) afterEvents.playerInventoryItemChange.emit({ player: wrapEntity(S().player), slot, itemStack: wrapItem(st), beforeItemStack: wrapItem(before), inventoryType: 'Inventory' });
    },
    hotbarChange(prev: number, next: number) {
      if (afterEvents.playerHotbarSelectedSlotChange.count) afterEvents.playerHotbarSelectedSlotChange.emit({ player: wrapEntity(S().player), previousSlotSelected: prev, newSlotSelected: next, itemStack: wrapItem(S().player.inventory.selectedStack) });
    },
    gameModeChange(from: string, to: string) {
      const g = (m: string) => (v2 ? (m === 'creative' ? 'Creative' : 'Survival') : m);
      if (afterEvents.playerGameModeChange.count) afterEvents.playerGameModeChange.emit({ player: wrapEntity(S().player), fromGameMode: g(from), toGameMode: g(to) });
    },
    weatherChange(prev: string, next: string) {
      const g = (w: string) => (w === 'storm' ? 'Thunder' : w === 'rain' ? 'Rain' : 'Clear');
      if (afterEvents.weatherChange.count) afterEvents.weatherChange.emit({ dimension: 'minecraft:overworld', previousWeather: g(prev), newWeather: g(next), lightning: next === 'storm', raining: next !== 'clear' });
    },
    /** Commande personnalisée (/espace:nom). Retourne vrai si trouvée. */
    customCommand(name: string, args: string[]) {
      const c = commands.find((x) => x.name === name || x.name.split(':')[1] === name);
      if (!c) return false;
      const values = c.params.map((p: Any, i: number) => {
        const a = args[i];
        if (a === undefined) return undefined;
        const t = String(p.type);
        if (t === 'Integer' || t === 'Float') return Number(a);
        if (t === 'Boolean') return a === 'true';
        if (t === 'EntitySelector' || t === 'PlayerSelector') return [wrapEntity(S().player)];
        return a;
      });
      const r = c.cb({ sourceEntity: wrapEntity(S().player), sourceType: 'Entity', initiator: wrapEntity(S().player) }, ...values);
      if (r?.message) S().chatMessage(String(r.message));
      return true;
    },
    customCommandNames() {
      return commands.map((c) => c.name);
    },
  };

  return {
    exports,
    pack,
    fire,
    blockComponents,
    itemComponents,
    wrapEntity,
    wrapBlock: blockAt,
    wrapItem,
    permutation: (id: number, meta: number) => new BlockPermutation(id, meta),
  };
}
