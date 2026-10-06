import * as THREE from 'three';
import type { Game } from './Game';
import type { GameContext, StatsApi } from './GameContext';
import { CHUNK_SIZE, QUALITY_PROFILES, SEA_LEVEL, TICK_DT, WORLD_HEIGHT, type QualityProfile } from './Config';
import { World } from '../world/World';
import { ChunkManager } from '../world/ChunkManager';
import { DayCycle } from '../world/DayCycle';
import { Weather, type WeatherState } from '../world/Weather';
import { WorldTicker } from '../world/WorldTicker';
import { WorldGenerator } from '../world/WorldGenerator';
import { Player, type PlayerSnapshot } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { PlayerInteraction } from '../player/PlayerInteraction';
import { EntityManager, type SavedMob } from '../entities/EntityManager';
import { ParticleSystem } from '../render/ParticleSystem';
import { WeatherRenderer } from '../render/WeatherRenderer';
import { BlockHighlight } from '../render/BlockHighlight';
import { HeldItem } from '../render/HeldItem';
import { Explosions } from '../world/Explosions';
import { FallingBlocks } from '../world/FallingBlocks';
import { Monster } from '../entities/Monster';
import { FACING_DIR, boundsOf, modelBoxes } from '../blocks/Shapes';
import { DEFAULT_RULES, execute, type GameRules } from '../commands/Commands';
import { CraftingSystem, tickFurnace, type FurnaceState } from '../crafting/CraftingSystem';
import { Progression } from './Progression';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { WorldMeta } from '../save/SaveManager';
import type { ItemStack } from '../inventory/Item';
import { createShadowTexture } from '../render/MobModels';
import { PlayerAvatar } from '../render/PlayerAvatar';
import { openTrades } from '../ui/TradeUI';
import * as Portals from '../world/Portals';
import type { Dimension } from '../world/Portals';
import { NETHER_LAVA_LEVEL } from '../world/NetherGenerator';

/** Couleur du brouillard des biomes du Nether (valeurs du jeu de référence). */
const NETHER_FOG: Record<string, number> = { nether_wastes: 0x330808, crimson_forest: 0x330303, warped_forest: 0x1a051a, soul_sand_valley: 0x1b4745, basalt_deltas: 0x685f70 };

/** Données propres à une dimension (l'autre dimension est conservée telle quelle dans la sauvegarde). */
export interface DimState {
  chests: WorldState['chests'];
  spawners: Record<string, number>;
  furnaces?: Record<string, FurnaceState>;
  mobs: SavedMob[];
}
import { clamp } from '../util/math';
import type { Boss } from '../entities/Boss';
import { Scoreboard, type ScoreboardSnapshot } from '../scripting/Scoreboard';
import { Mob } from '../entities/Mob';
import { ScriptHost } from '../scripting/ScriptHost';

export interface WorldState {
  version: number;
  player: PlayerSnapshot;
  time: { time: number; day: number };
  weather: { state: WeatherState; timer: number };
  chests: Record<string, (ItemStack | null)[]>;
  spawners: Record<string, number>;
  defeatedBosses: string[];
  progression: ReturnType<Progression['serialize']>;
  fuel?: number;
  gamerules?: Partial<GameRules>;
  furnaces?: Record<string, FurnaceState>;
  mobs: SavedMob[];
  /** Dimension où se trouve le joueur (les champs coffres/fourneaux/créatures la concernent). */
  dimension?: Dimension;
  /** États des autres dimensions. */
  dims?: Partial<Record<Dimension, DimState>>;
  /** Registre des portails connus par dimension (blocs de portail). */
  portals?: Partial<Record<Dimension, { x: number; y: number; z: number }[]>>;
  /** Arrivée par un portail : position visée (coordonnées converties). */
  arrival?: { x: number; y: number; z: number };
  /** Données des scripts d'add-ons : propriétés dynamiques du monde, tableau des scores, règles. */
  scripting?: { dynProps?: Record<string, unknown>; scoreboard?: ScoreboardSnapshot; extraRules?: Record<string, string> };
}

/**
 * Partie en cours : relie le monde, le joueur, les entités, la météo, le cycle jour/nuit,
 * les effets et la sauvegarde. Implémente le GameContext partagé par les sous-systèmes.
 */
export class Session implements GameContext {
  readonly world: World;
  readonly chunks: ChunkManager;
  readonly player: Player;
  readonly controller: PlayerController;
  readonly interaction: PlayerInteraction;
  readonly entities: EntityManager;
  readonly ticker: WorldTicker;
  readonly dayCycle = new DayCycle();
  readonly weather = new Weather();
  readonly particles: ParticleSystem;
  readonly weatherFx = new WeatherRenderer();
  readonly highlight: BlockHighlight;
  readonly held: HeldItem;
  readonly explosions: Explosions;
  readonly falling: FallingBlocks;
  private plateTimer = 0;
  readonly crafting = new CraftingSystem();
  readonly progression = new Progression();
  readonly defeatedBosses = new Set<string>();
  readonly scene: THREE.Scene;
  readonly shadowTexture: THREE.Texture;
  private iconTex = new Map<string, THREE.Texture>();
  /** Dimension de cette partie (un changement de dimension recrée la session). */
  readonly dimension: Dimension;
  private dims: Partial<Record<Dimension, DimState>> = {};
  readonly portals: Record<Dimension, { x: number; y: number; z: number }[]> = { overworld: [], nether: [] };
  private arrival: { x: number; y: number; z: number } | null = null;
  /** Temps passé dans un portail (s) ; le joueur doit en sortir avant de pouvoir repartir. */
  portalTime = 0;
  private portalBlocked = true;
  /** Vue : 0 = 1re personne, 1 = 3e personne arrière, 2 = 3e personne avant (F5). */
  perspective: 0 | 1 | 2 = 0;
  private avatar: PlayerAvatar | null = null;
  private tickAcc = 0;
  private autosaveTimer = 60;
  private progressTimer = 1;
  private savedSpawners: Record<string, number> = {};
  private fovCurrent: number;
  private shakeAmt = 0;
  private contactTimer = 0;
  private swimSoundTimer = 0;
  private wasInWater = false;
  loaded = false;
  paused = false;
  /** Règles du jeu (/gamerule). */
  readonly gamerules: GameRules = { ...DEFAULT_RULES };
  /** Règles du jeu de référence sans équivalent local (mémorisées pour les scripts). */
  readonly extraRules = new Map<string, string>();
  /** Tableau des scores (/scoreboard, scripts). */
  readonly scoreboard = new Scoreboard();
  /** Propriétés dynamiques du monde (world.setDynamicProperty). */
  readonly worldProps = new Map<string, unknown>();
  /** Fonctions (.mcfunction) fournies par les add-ons. */
  readonly functions: Map<string, string[]>;
  /** Option « Coffre bonus » à la création du monde. */
  bonusChest = false;
  elapsed = 0;
  saving: Promise<void> | null = null;
  readonly stats: StatsApi;

  constructor(readonly game: Game, readonly meta: WorldMeta, state: WorldState | null) {
    const r = game.renderer;
    this.scene = r.scene;
    this.dimension = state?.dimension ?? 'overworld';
    this.world = new World(meta.seed);
    this.player = new Player(meta.gameMode, meta.difficulty);
    this.functions = game.addonFunctions;
    this.player.difficulty = game.settings.difficulty;
    this.stats = { inc: (s, n) => this.progression.inc(s, n) };
    this.shadowTexture = createShadowTexture();
    this.entities = new EntityManager(() => this);
    this.entities.ctx = this;
    this.ticker = new WorldTicker(this.entities);
    this.world.events.on('blockChanged', (e) => this.ticker.blockChanged(e, this.world));
    this.chunks = new ChunkManager(this.world, r.materials, game.saves, this.chunkPrefix, {
      renderDistance: game.settings.renderDistance,
      jobsInFlight: this.profile.workerJobsInFlight,
      meshUploadsPerFrame: this.profile.chunkBudgetPerFrame,
    }, this.dimension);
    this.world.events.on('blockChanged', (e) => Portals.onBlockChanged(this.world, e.x, e.y, e.z));
    this.chunks.onSpecials = (list) => {
      this.entities.registerSpecials(this, list);
      for (const s of list) {
        const k = `${s.x},${s.y},${s.z}`;
        const e = this.world.specials.get(k);
        if (e && this.savedSpawners[k]) e.spawned = this.savedSpawners[k];
      }
    };
    this.chunks.onError = (m) => {
      console.error('[worker]', m);
      game.hud.toast('Erreur du générateur (voir console)', 'warn');
    };
    this.particles = new ParticleSystem(QUALITY_PROFILES.HIGH.maxParticles, game.textures);
    this.particles.limit = this.particleLimit();
    this.highlight = new BlockHighlight(game.textures);
    this.held = new HeldItem(game.textures);
    this.explosions = new Explosions(game.textures);
    this.falling = new FallingBlocks(game.textures);
    this.ticker.onFall = (x, y, z, id) => this.falling.spawn(this, x, y, z, id);
    this.scene.add(this.chunks.group, this.entities.group, this.particles.points, this.weatherFx.mesh, this.highlight.group, this.explosions.group, this.falling.group);
    this.controller = new PlayerController(this.player, game.input, game.settings);
    this.controller.onStep = (below) => {
      if (below > 0) this.audio.blockSound('step', BlockRegistry.get(below).sound, this.player.x, this.player.y, this.player.z);
    };
    this.controller.onJump = () => this.audio.play('jump', { volume: 0.4 });
    this.interaction = new PlayerInteraction(this, game.input, this.entities, {
      openStation: (k, x, y, z) => game.openInventory(k === 'crafting' ? 'table' : 'furnace', { x, y, z }),
      openChest: (x, y, z) => game.openInventory('chest', { x, y, z }),
      useCompass: (t) => this.useCompass(t),
      primeTnt: (x, y, z) => this.explosions.prime(this, x, y, z),
      sleep: (x, y, z) => this.trySleep(x, y, z),
      growSapling: (x, y, z, id) => this.ticker.growSapling(this, x, y, z, id),
      spawnCompass: () => this.hud.showCompass(this.player.spawn[0], this.player.spawn[2], 'spawn'),
      portalLit: (pos) => this.registerPortal(pos),
      fireLit: (x, y, z) => this.noteFire(x, y, z),
      trade: (v) => openTrades(game, this, v),
    });
    this.fovCurrent = game.settings.fov;
    // événements joueur
    this.player.onDamage = (_dmg, src) => {
      this.game.hud.flashDamage();
      if (src === 'fall') this.audio.play('hurt');
    };
    this.player.onDeath = () => this.onDeath();
    this.player.onLevelUp = (lvl) => {
      this.audio.play('levelup');
      this.hud.toast(`Niveau ${lvl} atteint !${lvl % 5 === 0 ? ' +1 cœur' : ''}`, 'achievement');
    };
    this.progression.onUnlock = (a) => {
      this.audio.play('achievement');
      this.hud.toast(`🏆 ${a.name} — ${a.desc}`, 'achievement');
    };
    this.entities.damage.onBossDefeated = (b: Boss) => {
      this.defeatedBosses.add(b.altarKey);
      this.progression.inc(`boss:${b.def.key}`);
      this.hud.toast(`${b.def.name} est vaincu !`, 'achievement');
      this.audio.play('achievement');
      this.shake(1);
      void this.save();
    };
    this.weather.onThunder = (delay) => setTimeout(() => this.audio.play('thunder', { volume: 1 }), delay * 1000);
    // état initial
    if (state) this.restore(state);
    else {
      const spawn = new WorldGenerator(meta.seed).findSpawn();
      this.player.spawn = [spawn.x, spawn.y + 1, spawn.z];
      this.player.body.setPos(spawn.x, spawn.y + 1, spawn.z);
      this.player.yaw = Math.PI * 0.75;
      if (meta.gameMode === 'creative') this.giveCreativeKit();
      else this.player.inventory.add({ id: 'apple', count: 3 });
    }
    this.held.setItem(this.player.inventory.selectedStack?.id ?? '');
  }

  // ---------- GameContext ----------
  get settings() {
    return this.game.settings;
  }
  get profile(): QualityProfile {
    const base = QUALITY_PROFILES[this.game.settings.quality];
    return { ...base, renderDistance: this.game.settings.renderDistance, simulationDistance: Math.min(base.simulationDistance, this.game.settings.renderDistance) };
  }
  get audio() {
    return this.game.audio;
  }
  /** Commandes de triche autorisées dans ce monde. */
  get cheats() {
    return this.meta.cheats ?? true;
  }

  /** Exécute une commande de chat ; les messages vont dans le chat. */
  runCommand(line: string): boolean {
    return execute(this, line, (m, err) => this.game.chat.add(m, err ? 'error' : 'info'));
  }

  /** Scripts JavaScript des add-ons (API de script), démarrés au chargement du monde. */
  scripts: ScriptHost | null = null;

  async startScripts() {
    const packs = this.game.addonResult?.scripts ?? [];
    if (!packs.length) return;
    this.scripts = new ScriptHost(this, packs, {
      open: (b) => this.game.openScriptForm(b),
      closeAll: () => this.game.closeScriptForms(),
      icon: (p) => this.game.addonIcon(p),
    });
    try {
      const n = await this.scripts.start();
      if (n < packs.length) this.hud.toast(`Scripts : ${n}/${packs.length} add-on(s) démarré(s) (voir le rapport)`, 'warn');
    } catch (e) {
      console.error('Scripts', e);
    }
  }

  /** Message dans le chat (say, tellraw, scripts). */
  chatMessage(text: string) {
    this.game.chat.add(text, 'chat');
  }

  /** Éclair : dégâts et feu autour du point d'impact. */
  lightning(x: number, y: number, z: number) {
    this.audio.play('thunder', { x, y, z, volume: 1 });
    this.particles.burst('explosion', x, y + 1, z, 10);
    this.weather.flash = 1;
    const p = this.player;
    if (Math.hypot(p.x - x, p.y - y, p.z - z) < 3) p.damage(5, 'fire');
    for (const e of this.entities.entities) if (e instanceof Mob && !e.dead && Math.hypot(e.x - x, e.y - y, e.z - z) < 3) this.combat.damageMob(e, 5, { kind: 'environment', fire: true });
  }

  get skins() {
    return this.game.textures;
  }
  get hud() {
    return this.game.hud;
  }
  get combat() {
    return this.entities.combat;
  }
  iconTexture(itemId: string): THREE.Texture {
    let t = this.iconTex.get(itemId);
    if (!t) {
      t = new THREE.CanvasTexture(this.game.textures.iconCanvas(itemId));
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      this.iconTex.set(itemId, t);
    }
    return t;
  }
  raining() {
    return this.weather.raining && this.biomeWeather() === 'rain';
  }
  haptic(kind: 'light' | 'medium' | 'heavy') {
    if (this.settings.haptics) this.game.platform.haptic(kind);
  }
  shake(amount: number) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  particleLimit() {
    const s = this.game.settings.particles;
    return s === 'off' ? 0 : s === 'low' ? Math.min(150, this.profile.maxParticles) : this.profile.maxParticles;
  }

  private biomeWeather() {
    return this.world.biomeAt(Math.floor(this.player.x), Math.floor(this.player.z)).weather;
  }

  private giveCreativeKit() {
    const kit = ['grass_block', 'dirt', 'stone', 'cobblestone', 'oak_planks', 'oak_log', 'glass', 'torch', 'bricks', 'stone_bricks', 'sand', 'white_wool', 'lantern', 'crafting_table', 'chest', 'furnace', 'diamond_pickaxe', 'diamond_sword', 'bow', 'arrow', 'wheat_seeds', 'oak_door', 'oak_stairs', 'oak_slab', 'ladder', 'red_bed', 'water_bucket'];
    for (const k of kit) if (ItemRegistry.has(k)) this.player.inventory.add({ id: k, count: ItemRegistry.maxStack(k) });
  }

  // ---------- chargement ----------
  /** Attend que les chunks autour du joueur soient prêts. */
  async waitForSpawn(onProgress: (f: number) => void): Promise<void> {
    const r = Math.min(2, this.settings.renderDistance);
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        this.chunks.update(this.player.x, this.player.z);
        const { ready, total } = this.chunks.readyCount(r);
        onProgress(ready / total);
        if (ready >= total || performance.now() - t0 > 30000) resolve();
        else setTimeout(step, 30);
      };
      step();
    });
    const p = this.player;
    if (this.arrival) {
      const a = this.arrival;
      this.arrival = null;
      this.arrive(a);
    } else if (this.isNew) {
      // nouveau monde : colonne de sol naturel (pas sur un arbre ni dans l'eau) proche du point prévu
      const spot = this.findGroundSpot(Math.floor(p.x), Math.floor(p.z));
      p.body.setPos(spot.x + 0.5, spot.y, spot.z + 0.5);
      p.spawn = [spot.x + 0.5, spot.y, spot.z + 0.5];
      if (this.bonusChest) this.placeBonusChest(spot.x, spot.z);
    } else if (p.body.collides(this.world, p.x, p.y, p.z)) {
      // terrain modifié sous le joueur : remonte jusqu'à un espace libre
      let y = Math.floor(p.y);
      while (y < WORLD_HEIGHT - 2 && p.body.collides(this.world, p.x, y, p.z)) y++;
      p.body.setPos(p.x, y, p.z);
    }
    this.loaded = true;
  }

  /** Coffre bonus près du point d'apparition (bois, outils en bois, pommes, pain). */
  private placeBonusChest(cx: number, cz: number) {
    const w = this.world;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) {
      const x = cx + dx, z = cz + dz;
      let y = w.surfaceBelow(x, WORLD_HEIGHT - 2, z);
      while (y > 1 && !BlockRegistry.solid[w.getBlock(x, y, z)]) y--;
      if (BlockRegistry.liquid[w.getBlock(x, y + 1, z)] || w.getBlock(x, y + 1, z) > 0 && !BlockRegistry.replaceable[w.getBlock(x, y + 1, z)]) continue;
      w.setBlock(x, y + 1, z, B.CHEST, 0);
      const inv = w.getChest(x, y + 1, z)!;
      const r = () => Math.random();
      const loot: [string, number][] = [['oak_log', 1 + Math.floor(r() * 3)], ['oak_planks', 1 + Math.floor(r() * 12)], ['stick', 1 + Math.floor(r() * 12)], ['apple', 1 + Math.floor(r() * 3)], ['bread', 1 + Math.floor(r() * 3)], [r() < 0.5 ? 'wooden_axe' : 'stone_axe', 1], [r() < 0.5 ? 'wooden_pickaxe' : 'stone_pickaxe', 1]];
      loot.forEach(([id, n], i) => ItemRegistry.has(id) && (inv.slots[(i * 5 + 2) % inv.size] = { id, count: n, ...(ItemRegistry.maxDurability(id) > 0 ? { durability: ItemRegistry.maxDurability(id) } : {}) }));
      for (const [tx, tz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.getBlock(x + tx, y + 1, z + tz) === B.AIR && w.isSolid(x + tx, y, z + tz)) w.setBlock(x + tx, y + 1, z + tz, B.TORCH, 0);
      return;
    }
  }

  clearIconCache() {
    this.iconTex.forEach((t) => t.dispose());
    this.iconTex.clear();
    this.held.setItem('');
  }

  /** Cherche en spirale une colonne dont le sommet est du sol (herbe, sable, neige, terre...). */
  private findGroundSpot(cx: number, cz: number): { x: number; y: number; z: number } {
    const w = this.world;
    const ground = new Set([B.GRASS_BLOCK, B.SAND, B.SNOWY_GRASS_BLOCK, B.SNOW, B.DIRT, B.STONE, B.GRAVEL, B.MUD, B.MOSS_BLOCK, B.SANDSTONE]);
    for (let r = 0; r <= 12; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx, z = cz + dz;
          if (!w.isLoaded(x, z)) continue;
          let y = WORLD_HEIGHT - 2;
          while (y > 1 && (w.getBlock(x, y, z) === B.AIR || !BlockRegistry.solid[w.getBlock(x, y, z)]) && !BlockRegistry.liquid[w.getBlock(x, y, z)]) y--;
          if (ground.has(w.getBlock(x, y, z)) && w.getBlock(x, y + 1, z) === B.AIR && w.getBlock(x, y + 2, z) === B.AIR) return { x, y: y + 1, z };
        }
    let y = w.surfaceBelow(cx, WORLD_HEIGHT - 1, cz) + 1;
    while (y < WORLD_HEIGHT - 2 && this.player.body.collides(w, cx + 0.5, y, cz + 0.5)) y++;
    return { x: cx, y, z: cz };
  }

  get isNew() {
    return !this.restored;
  }
  private restored = false;

  private restore(s: WorldState) {
    this.restored = true;
    this.player.restore(s.player);
    this.dayCycle.time = s.time?.time ?? 0.05;
    this.dayCycle.day = s.time?.day ?? 0;
    if (s.weather) this.weather.load(s.weather);
    for (const [k, slots] of Object.entries(s.chests ?? {})) {
      const [x, y, z] = k.split(',').map(Number);
      this.world.getChest(x, y, z)!.load({ slots });
    }
    this.savedSpawners = s.spawners ?? {};
    for (const b of s.defeatedBosses ?? []) this.defeatedBosses.add(b);
    if (s.progression) this.progression.load(s.progression);
    Object.assign(this.gamerules, s.gamerules ?? {});
    for (const [k, f] of Object.entries(s.furnaces ?? {})) this.world.furnaces.set(k, f);
    if (s.mobs) this.pendingMobs = s.mobs;
    for (const [k, v] of Object.entries(s.scripting?.dynProps ?? {})) this.worldProps.set(k, v);
    this.scoreboard.load(s.scripting?.scoreboard);
    for (const [k, v] of Object.entries(s.scripting?.extraRules ?? {})) this.extraRules.set(k, v);
    this.dims = s.dims ?? {};
    for (const d of ['overworld', 'nether'] as const) this.portals[d] = s.portals?.[d] ?? [];
    this.arrival = s.arrival ?? null;
  }

  /** Préfixe des chunks sauvegardés de la dimension. */
  get chunkPrefix() {
    return this.dimension === 'nether' ? `${this.meta.id}:nether` : this.meta.id;
  }
  private pendingMobs: SavedMob[] | null = null;

  snapshot(): WorldState {
    const chests: WorldState['chests'] = {};
    for (const [k, inv] of this.world.chests) if (inv.slots.some((x) => x)) chests[k] = inv.serialize().slots;
    const spawners: Record<string, number> = { ...this.savedSpawners };
    for (const [k, s] of this.world.specials) if (s.spawned) spawners[k] = s.spawned;
    return {
      version: 2,
      player: this.player.snapshot(),
      time: { time: this.dayCycle.time, day: this.dayCycle.day },
      weather: this.weather.serialize(),
      chests,
      spawners,
      defeatedBosses: [...this.defeatedBosses],
      progression: this.progression.serialize(),
      furnaces: Object.fromEntries(this.world.furnaces),
      gamerules: { ...this.gamerules },
      mobs: this.entities.serialize(),
      scripting: { dynProps: Object.fromEntries(this.worldProps), scoreboard: this.scoreboard.serialize(), extraRules: Object.fromEntries(this.extraRules) },
      dimension: this.dimension,
      dims: this.dims,
      portals: this.portals,
    };
  }

  /** Sauvegarde atomique (état + chunks modifiés + miniature). */
  async save(withThumbnail = true): Promise<void> {
    if (!this.loaded) return;
    if (this.saving) await this.saving;
    const list = this.chunks.collectUnsaved();
    const versions = list.map((c) => c.version);
    const chunks = list.map((c) => ({ cx: c.cx, cz: c.cz, blocks: c.blocks.slice(), meta: c.meta.slice() }));
    const state = this.snapshot();
    const meta = { ...this.meta };
    meta.lastPlayed = Date.now();
    meta.playTime = Math.round(this.meta.playTime);
    meta.difficulty = this.player.difficulty;
    if (withThumbnail && !this.paused) {
      const t = this.game.renderer.thumbnail();
      if (t) meta.thumbnail = t;
    } else if (withThumbnail && this.game.lastThumbnail) meta.thumbnail = this.game.lastThumbnail;
    this.meta.thumbnail = meta.thumbnail;
    this.saving = this.game.saves
      .save(meta, state, chunks, this.chunkPrefix)
      .then(() => this.chunks.markSaved(list, versions))
      .catch((e) => {
        console.error('Sauvegarde échouée', e);
        this.hud.toast('⚠ Échec de la sauvegarde', 'warn');
        throw e;
      })
      .finally(() => (this.saving = null));
    return this.saving;
  }

  // ---------- boucle ----------
  update(dt: number) {
    const game = this.game;
    const input = game.input;
    this.elapsed += dt;
    const events = input.consume();
    const remaining: string[] = [];
    for (const ev of events) {
      if (ev === 'pause') game.pause();
      else if (ev === 'inventory') game.openInventory('hand');
      else if (ev === 'debug') game.hud.toggleDebug();
      else if (ev === 'perspective') {
        this.perspective = ((this.perspective + 1) % 3) as 0 | 1 | 2;
        document.documentElement.classList.toggle('view-front', this.perspective === 2);
      }
      else if (ev === 'chat') game.openChat('');
      else if (ev === 'command') game.openChat('/');
      else if (ev === 'drop') this.dropSelected(false);
      else if (ev === 'slotNext' || ev === 'slotPrev') this.selectSlot((this.player.inventory.selected + (ev === 'slotNext' ? 1 : 8)) % 9);
      else if (ev.startsWith('slot:')) this.selectSlot(Number(ev.slice(5)));
      else remaining.push(ev);
    }
    if (this.paused || !this.loaded) return;
    const p = this.player;
    this.controller.look();
    this.controller.update(this.world, dt);
    this.updatePortal(dt);
    this.updateFires();
    // poussière de sprint et bulles de nage
    if (p.sprinting && p.body.onGround && Math.random() < dt * 25) {
      const below = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z));
      if (below > 0 && BlockRegistry.solid[below]) this.particles.sprintDust(p.x, p.y, p.z, below);
    }
    if (p.swimming && Math.random() < dt * 12) this.particles.burst('water', p.x, p.y + 0.3, p.z, 1);
    this.interaction.update(dt, remaining);
    // ticks fixes 20 Hz
    this.tickAcc += dt;
    let n = 0;
    while (this.tickAcc >= TICK_DT && n < 3) {
      this.tick();
      this.tickAcc -= TICK_DT;
      n++;
    }
    if (n === 3) this.tickAcc = 0;
    this.chunks.update(p.x, p.z);
    this.particles.update(dt);
    this.entities.render(this, this.elapsed);
    this.meta.playTime += dt;
    // sons d'eau
    const inWater = p.body.inWater;
    if (inWater && !this.wasInWater && p.body.vy < -4) {
      this.audio.play('splash');
      this.particles.burst('water', p.x, p.y + 0.5, p.z, 12);
    }
    this.wasInWater = inWater;
    if (inWater && Math.hypot(p.body.vx, p.body.vz) > 1) {
      this.swimSoundTimer -= dt;
      if (this.swimSoundTimer <= 0) {
        this.swimSoundTimer = 0.7;
        this.audio.play('swim', { volume: 0.5 });
      }
    }
    this.updateView(dt);
  }

  /** Portail : 4 s dedans (1 s en créatif) pour changer de dimension ; il faut en sortir pour repartir. */
  private updatePortal(dt: number) {
    const p = this.player;
    const inside = !p.dead && Portals.touchesPortal(this.world, p.x, p.y, p.z, p.body.halfWidth, p.body.height);
    if (!inside) {
      this.portalBlocked = false;
      this.portalTime = Math.max(0, this.portalTime - dt * 2);
    } else if (!this.portalBlocked) {
      if (this.portalTime === 0) this.audio.play('portal', { volume: 0.8 });
      this.portalTime += dt;
      if (this.portalTime >= (p.creative ? 1 : 4)) {
        this.portalBlocked = true;
        this.portalTime = 0;
        void this.game.changeDimension(this.dimension === 'nether' ? 'overworld' : 'nether');
      }
    }
    this.hud.setPortal(this.portalTime / (p.creative ? 1 : 4));
  }

  /** Feux posés hors du Nether : s'éteignent au bout de quelques secondes (sauf sur netherrack / magma). */
  private fires = new Map<string, number>();
  private updateFires() {
    if (!this.fires.size) return;
    const now = this.elapsed;
    const fire = BlockRegistry.has('fire') ? BlockRegistry.byName('fire').id : -1;
    for (const [k, t] of this.fires) {
      if (now < t) continue;
      this.fires.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      if (this.world.getBlock(x, y, z) === fire) this.world.setBlock(x, y, z, B.AIR);
    }
  }

  /** Arrivée par un portail : portail existant proche (registre), sinon nouveau portail. */
  private arrive(a: { x: number; y: number; z: number }) {
    const w = this.world, p = this.player;
    const nether = this.dimension === 'nether';
    let spot = Portals.findNearbyPortal(w, a.x, a.z, nether ? 16 : 128, this.portals[this.dimension]);
    if (!spot) {
      const tx = Math.floor(a.x), tz = Math.floor(a.z);
      const prefer = nether ? clamp(Math.round(a.y), NETHER_LAVA_LEVEL + 8, 100) : w.surfaceBelow(tx, WORLD_HEIGHT - 2, tz) + 1;
      spot = Portals.buildArrivalPortal(w, tx, tz, this.dimension, prefer);
      this.portals[this.dimension].push(spot);
    }
    p.body.setPos(spot.x + 0.5, spot.y, spot.z + 0.5);
    p.body.vx = p.body.vy = p.body.vz = 0;
    p.body.fallDistance = 0;
    this.portalBlocked = true;
  }

  /** Portail allumé par le joueur : mémorisé pour relier les dimensions. */
  registerPortal(pos: { x: number; y: number; z: number }) {
    const list = this.portals[this.dimension];
    if (!list.some((q) => Math.abs(q.x - pos.x) < 3 && Math.abs(q.y - pos.y) < 4 && Math.abs(q.z - pos.z) < 3)) list.push(pos);
  }

  /** Feu posé (briquet) : éphémère hors netherrack. */
  noteFire(x: number, y: number, z: number) {
    const below = this.world.getBlock(x, y - 1, z);
    const eternal = (BlockRegistry.has('netherrack') && below === BlockRegistry.byName('netherrack').id) || (BlockRegistry.has('magma') && below === BlockRegistry.byName('magma').id);
    if (!eternal) this.fires.set(`${x},${y},${z}`, this.elapsed + 4 + Math.random() * 4);
  }

  private selectSlot(i: number) {
    this.player.inventory.selected = clamp(i, 0, 8);
    this.player.inventory.changed();
    this.audio.play('click', { volume: 0.3 });
  }

  dropSelected(all: boolean) {
    const p = this.player;
    const inv = p.inventory;
    const s = inv.selectedStack;
    if (!s) return;
    const taken = inv.takeFromSlot(inv.selected, all ? s.count : 1)!;
    this.throwStack(taken);
  }

  throwStack(s: ItemStack) {
    const p = this.player;
    const [, , , dx, dy, dz] = this.interaction.eye();
    this.entities.spawnItem(s.id, s.count, p.x + dx * 0.8, p.y + p.eyeHeight - 0.3, p.z + dz * 0.8, s.durability);
    const it = this.entities.entities[this.entities.entities.length - 1];
    it.body.vx = dx * 6;
    it.body.vy = dy * 6 + 2;
    it.body.vz = dz * 6;
    (it as unknown as { pickupDelay: number }).pickupDelay = 1.5;
  }

  private tick() {
    const p = this.player;
    const dt = TICK_DT;
    if (this.gamerules.doDaylightCycle) this.dayCycle.update(dt);
    if (!this.gamerules.doWeatherCycle) this.weather.timer = Math.max(this.weather.timer, 10);
    this.weather.update(dt, this.biomeWeather() !== 'none');
    p.naturalRegen = this.gamerules.naturalRegeneration;
    p.fallDamage = this.gamerules.fallDamage;
    p.tick(dt);
    this.entities.update(this, dt);
    this.ticker.tick(this);
    this.tickFurnaces(dt);
    this.explosions.update(this, this.entities, dt);
    // fonctions « tick » des add-ons
    for (const f of this.game.addonTickFunctions) execute(this, `function ${f}`, () => {}, 0, undefined, true);
    this.falling.update(this, this.entities, dt);
    this.scripts?.update();
    this.checkPressurePlate(dt);
    if (this.pendingMobs && this.world.isLoaded(Math.floor(p.x), Math.floor(p.z))) {
      this.entities.load(this.pendingMobs.filter((m) => this.world.isLoaded(Math.floor(m.x), Math.floor(m.z))));
      this.pendingMobs = null;
    }
    // dégâts de contact (cactus, pièges)
    this.contactTimer -= dt;
    if (this.contactTimer <= 0 && !p.dead) {
      const b = p.body;
      let dmg = 0;
      for (let y = Math.floor(b.y - 0.05); y <= Math.floor(b.y + b.height); y++)
        for (const [ox, oz] of [[-0.31, -0.31], [0.31, -0.31], [-0.31, 0.31], [0.31, 0.31]]) {
          const id = this.world.getBlock(Math.floor(b.x + ox), y, Math.floor(b.z + oz));
          if (id > 0 && id !== B.LAVA) dmg = Math.max(dmg, BlockRegistry.get(id).contactDamage);
        }
      if (dmg > 0) {
        p.damage(dmg, 'contact');
        this.contactTimer = 0.5;
      }
    }
    // progression
    this.progressTimer -= dt;
    if (this.progressTimer <= 0) {
      this.progressTimer = 1;
      const biome = this.world.biomeAt(Math.floor(p.x), Math.floor(p.z));
      if (this.world.isLoaded(Math.floor(p.x), Math.floor(p.z)) && !this.progression.biomes.has(biome.key)) {
        this.progression.biomes.add(biome.key);
        this.hud.toast(`Biome découvert : ${biome.name}`);
      }
      this.progression.min('deepest', Math.floor(p.y));
      this.progression.check(p.level);
    }
    // sauvegarde automatique
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = 60;
      this.save(true).catch(() => {});
    }
  }

  /** Plaque de pression : déclenche la TNT cachée en dessous (piège des temples). */
  private checkPressurePlate(dt: number) {
    this.plateTimer -= dt;
    const p = this.player;
    if (this.plateTimer > 0 || p.dead || !p.body.onGround) return;
    const x = Math.floor(p.x), y = Math.floor(p.y + 0.05), z = Math.floor(p.z);
    if (this.world.getBlock(x, y, z) !== B.STONE_PRESSURE_PLATE) return;
    this.plateTimer = 1;
    this.audio.play('click', { x, y, z, pitch: 0.6 });
    for (let dy = -4; dy <= -1; dy++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) if (this.world.getBlock(x + dx, y + dy, z + dz) === B.TNT) this.explosions.prime(this, x + dx, y + dy, z + dz, 1 + Math.random());
  }

  /** Lit : dormir la nuit (passe au matin) et définir le point de réapparition. */
  private trySleep(x: number, y: number, z: number) {
    const w = this.world;
    if (this.dimension === 'nether') {
      // comme dans le jeu de référence : un lit explose dans le Nether
      w.setBlock(x, y, z, B.AIR);
      this.explosions.explode(this, this.entities, x + 0.5, y + 0.5, z + 0.5, 5);
      this.shake(1);
      return;
    }
    const meta = w.getMeta(x, y, z);
    // coordonnées de la tête du lit
    let hx = x, hz = z;
    if (!(meta & 4)) {
      const [dx, dz] = FACING_DIR[meta & 3];
      hx += dx;
      hz += dz;
    }
    const p = this.player;
    if (Math.hypot(p.x - (hx + 0.5), p.z - (hz + 0.5)) > 3.5 || Math.abs(p.y - y) > 2.5) {
      this.hud.toast('Vous êtes trop loin du lit', 'warn');
      return;
    }
    p.spawn = [hx + 0.5, y + 0.6, hz + 0.5];
    if (!this.dayCycle.isNight && !this.weather.raining) {
      this.hud.toast('Point de réapparition défini. Vous ne pouvez dormir que la nuit ou pendant un orage.');
      return;
    }
    const near = this.entities.entities.some((e) => e instanceof Monster && !e.dead && Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) < 8);
    if (near) {
      this.hud.toast('Vous ne pouvez pas dormir, des monstres rôdent à proximité', 'warn');
      return;
    }
    this.hud.toast('Point de réapparition défini');
    this.game.sleepTransition(() => {
      if (this.dayCycle.time > 0.3) this.dayCycle.day++;
      this.dayCycle.time = 0.0;
      if (this.weather.state !== 'clear') this.weather.load({ state: 'clear', timer: 300 + Math.random() * 600 });
      this.progression.inc('nightsSlept');
    });
  }

  /** Fourneaux : cuisson et bascule allumé/éteint du bloc (en conservant l'orientation). */
  private tickFurnaces(dt: number) {
    for (const [k, f] of this.world.furnaces) {
      if (!f.input && f.burn <= 0) continue;
      if (!tickFurnace(f, dt)) continue;
      const [x, y, z] = k.split(',').map(Number);
      const id = this.world.getBlock(x, y, z);
      if (id !== B.FURNACE && id !== B.LIT_FURNACE) continue;
      this.world.setBlock(x, y, z, f.burn > 0 ? B.LIT_FURNACE : B.FURNACE, this.world.getMeta(x, y, z), false);
    }
  }

  private updateView(dt: number) {
    const game = this.game;
    const r = game.renderer;
    const p = this.player;
    const cam = r.camera;
    const s = this.settings;
    // caméra
    const bob = s.viewBobbing && p.body.onGround ? Math.sin(this.controller.bobPhase * 2) * 0.04 * Math.min(1, Math.hypot(p.body.vx, p.body.vz) / 4) : 0;
    cam.position.set(p.x, p.y + p.eyeHeight + bob - (p.dead ? 1.2 : 0), p.z);
    cam.rotation.set(p.pitch, p.yaw, p.dead ? 0.6 : 0);
    if (this.perspective && !p.dead) this.placeThirdPersonCamera(cam);
    const targetFov = s.fov + (p.sprinting ? 8 : 0) - (this.interaction.bowCharge > 0 ? this.interaction.bowCharge * 10 : 0);
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, dt * 8);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.05) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    r.shake = this.shakeAmt;
    // ciel, brouillard, lumière
    const nether = this.dimension === 'nether';
    const rain = nether || this.biomeWeather() === 'none' ? 0 : this.weather.intensity;
    const netherFog = nether ? new THREE.Color(NETHER_FOG[this.world.biomeAt(Math.floor(p.x), Math.floor(p.z)).key] ?? 0x330808) : null;
    if (netherFog) r.sky.updateNether(cam.position, netherFog);
    else r.sky.update(this.dayCycle.time, cam.position, rain, this.weather.flash, this.elapsed, s.clouds);
    const u = r.materials.uniforms;
    u.uTime.value = this.elapsed;
    u.uDaylight.value = nether ? 0 : Math.max(0.3, this.dayCycle.daylight * (1 - rain * 0.3) + this.weather.flash * 0.5);
    u.uAmbient.value = nether ? 0.3 : 0.035;
    u.uSkyColor.value.copy(r.sky.skyLightColor);
    u.uSway.value = this.profile.foliageAnimation ? 1 : 0;
    u.uWaterAnim.value = s.waterQuality === 'animated' ? 1 : 0;
    u.uAO.value = s.shadows === 'off' ? 0.65 : 1;
    const headBlock = this.world.getBlock(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z));
    const underwater = headBlock === B.WATER;
    const inLava = headBlock === B.LAVA;
    const far = Math.max(24, s.renderDistance * CHUNK_SIZE - 6);
    if (underwater) r.setFog(1, 18, new THREE.Color(0.12, 0.25, 0.55).multiplyScalar(Math.max(0.3, this.dayCycle.daylight)));
    else if (inLava) r.setFog(0.2, 3, new THREE.Color(0.9, 0.35, 0.05));
    else if (netherFog) r.setFog(Math.min(far, 64) * 0.1, Math.min(far, 64), netherFog);
    else r.setFog(far * (rain > 0.3 ? 0.35 : 0.6), far, r.sky.horizon);
    game.hud.setOverlays(underwater, inLava);
    // météo
    const light = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1.6), Math.floor(p.z));
    const sheltered = light.sky < 12;
    this.weatherFx.update(this.elapsed, cam.position, rain, this.biomeWeather() === 'snow', sheltered);
    // surbrillance & objet en main
    const tg = this.interaction.target;
    let box: [number, number, number, number, number, number] | undefined;
    if (tg && BlockRegistry.shape[tg.block]) {
      const w = this.world;
      box = boundsOf(modelBoxes(tg.block, w.getMeta(tg.x, tg.y, tg.z), (dx, dy, dz) => Math.max(0, w.getBlock(tg.x + dx, tg.y + dy, tg.z + dz))));
    } else if (tg && BlockRegistry.get(tg.block).render === 'cross') box = [2, 0, 2, 14, 13, 14];
    this.highlight.update(tg ? { x: tg.x, y: tg.y, z: tg.z, box } : null, this.interaction.miningProgress, this.interaction.preview, true);
    const held = p.inventory.selectedStack?.id ?? '';
    this.held.setItem(held);
    const br = Math.max(nether ? 0.45 : 0.15, Math.pow(Math.max((light.sky / 15) * this.dayCycle.daylight, light.block / 15), 1.2));
    this.held.update(cam.aspect, this.entities.combat.swing, this.controller.bobPhase * 2, Math.min(1, Math.hypot(p.body.vx, p.body.vz) / 4), br, p.sneaking);
    // modèle du joueur (vues à la 3e personne)
    if (this.perspective && !this.avatar) {
      this.avatar = new PlayerAvatar(this.shadowTexture, this.skins, (id) => this.iconTexture(id));
      this.scene.add(this.avatar.group);
    }
    this.avatar?.update({
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, phase: this.controller.bobPhase, speed: Math.hypot(p.body.vx, p.body.vz),
      swing: this.entities.combat.swing, sneaking: p.sneaking, held, light: br, hurt: p.hurtFlash > 0, prone: p.swimming || p.crawling,
      visible: this.perspective !== 0 && !p.dead && !p.effects.level('invisibility'),
    });
    // audio
    this.audio.setListener(p.x, p.y + p.eyeHeight, p.z, p.yaw);
    const underground = light.sky < 5 && p.y < SEA_LEVEL + 4;
    const night = this.dayCycle.isNight;
    this.audio.setAmbience(
      {
        cave: underground ? 0.9 : 0,
        wind: underground ? 0 : 0.25 + clamp((p.y - SEA_LEVEL - 20) / 40, 0, 0.6),
        rain: sheltered ? rain * 0.4 : rain,
        crickets: !underground && night && rain < 0.2 ? 0.5 : 0,
        birds: !underground && !night && rain < 0.2 ? 0.45 : 0,
      },
      dt,
    );
    this.audio.setMusicMood(night ? 'night' : 'day');
    this.audio.updateMusic(dt);
    game.hud.update(this, dt);
  }

  private onDeath() {
    const p = this.player;
    this.audio.play('hurt', { pitch: 0.7 });
    this.haptic('heavy');
    // perte de l'inventaire (sauf en facile/paisible)
    if ((p.difficulty === 'normal' || p.difficulty === 'hard') && !this.gamerules.keepInventory) {
      for (let i = 0; i < p.inventory.size; i++) {
        const s = p.inventory.slots[i];
        if (s) this.entities.spawnItem(s.id, s.count, p.x, p.y + 1, p.z, s.durability);
      }
      for (const k of ['head', 'chest', 'legs', 'feet'] as const) {
        const s = p.inventory.armor[k];
        if (s) this.entities.spawnItem(s.id, s.count, p.x, p.y + 1, p.z, s.durability);
      }
      p.inventory.clear();
      const lost = Math.floor(p.level / 2);
      p.level -= lost;
      p.xp = 0;
    }
    this.progression.inc('deaths');
    if (this.gamerules.doImmediateRespawn) {
      this.respawn();
      return;
    }
    this.game.showDeath();
  }

  respawn() {
    this.player.respawn();
    this.game.input.reset();
    // le point de réapparition est à la surface
    if (this.dimension === 'nether') void this.game.changeDimension('overworld', { x: this.player.x, y: this.player.y, z: this.player.z });
  }

  private async useCompass(target: string) {
    const p = this.player;
    this.hud.toast('La boussole cherche…');
    const r = await this.chunks.locate(target, p.x, p.z);
    if (!r.found) {
      this.hud.toast('Aucune structure trouvée à proximité', 'warn');
      return;
    }
    this.hud.showCompass(r.x, r.z, target);
  }

  /** Recule (ou avance, vue de face) la caméra de 4 blocs, sans traverser les blocs. */
  private placeThirdPersonCamera(cam: THREE.PerspectiveCamera) {
    const p = this.player;
    const cp = Math.cos(p.pitch);
    const sign = this.perspective === 1 ? 1 : -1;
    // direction depuis les yeux vers la caméra (opposée au regard en vue arrière)
    const dx = Math.sin(p.yaw) * cp * sign, dy = -Math.sin(p.pitch) * sign, dz = Math.cos(p.yaw) * cp * sign;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let d = 4;
    // plusieurs rayons légèrement décalés (le plan proche de la caméra ne doit pas entrer dans un mur)
    const w = this.world;
    const solid = (x: number, y: number, z: number) => BlockRegistry.solid[Math.max(0, w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)))] === 1;
    for (let t = 0.3; t <= 4.25; t += 0.05) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (solid(x, y, z) || solid(x + 0.12, y + 0.12, z + 0.12) || solid(x - 0.12, y - 0.12, z - 0.12) || solid(x + 0.12, y - 0.12, z - 0.12) || solid(x - 0.12, y + 0.12, z + 0.12)) {
        d = Math.max(0, t - 0.3);
        break;
      }
    }
    cam.position.set(ox + dx * d, oy + dy * d, oz + dz * d);
    if (this.perspective === 2) cam.rotation.set(-p.pitch, p.yaw + Math.PI, 0);
  }

  dispose() {
    this.scripts?.dispose();
    document.documentElement.classList.remove('view-front');
    if (this.avatar) {
      this.scene.remove(this.avatar.group);
      this.avatar.dispose();
      this.avatar = null;
    }
    this.scripts = null;
    this.chunks.dispose();
    this.entities.dispose();
    this.particles.dispose();
    this.weatherFx.dispose();
    this.highlight.dispose();
    this.held.dispose();
    this.explosions.dispose();
    this.falling.clear();
    this.shadowTexture.dispose();
    this.iconTex.forEach((t) => t.dispose());
    this.scene.remove(this.chunks.group, this.entities.group, this.particles.points, this.weatherFx.mesh, this.highlight.group, this.explosions.group, this.falling.group);
    this.audio.stopAmbience();
  }
}

export type { WorldState as SessionState };
