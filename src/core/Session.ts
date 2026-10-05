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
import { CraftingSystem } from '../crafting/CraftingSystem';
import { Progression } from './Progression';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { WorldMeta } from '../save/SaveManager';
import type { ItemStack } from '../inventory/Item';
import { createShadowTexture } from '../render/MobModels';
import { clamp } from '../util/math';
import type { Boss } from '../entities/Boss';

export interface WorldState {
  version: number;
  player: PlayerSnapshot;
  time: { time: number; day: number };
  weather: { state: WeatherState; timer: number };
  chests: Record<string, (ItemStack | null)[]>;
  spawners: Record<string, number>;
  defeatedBosses: string[];
  progression: ReturnType<Progression['serialize']>;
  fuel: number;
  mobs: SavedMob[];
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
  readonly crafting = new CraftingSystem();
  readonly progression = new Progression();
  readonly defeatedBosses = new Set<string>();
  readonly scene: THREE.Scene;
  readonly shadowTexture: THREE.Texture;
  private iconTex = new Map<string, THREE.Texture>();
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
  elapsed = 0;
  saving: Promise<void> | null = null;
  readonly stats: StatsApi;

  constructor(readonly game: Game, readonly meta: WorldMeta, state: WorldState | null) {
    const r = game.renderer;
    this.scene = r.scene;
    this.world = new World(meta.seed);
    this.player = new Player(meta.gameMode, meta.difficulty);
    this.player.difficulty = game.settings.difficulty;
    this.stats = { inc: (s, n) => this.progression.inc(s, n) };
    this.shadowTexture = createShadowTexture();
    this.entities = new EntityManager(() => this);
    this.entities.ctx = this;
    this.ticker = new WorldTicker(this.entities);
    this.chunks = new ChunkManager(this.world, r.materials, game.saves, meta.id, {
      renderDistance: game.settings.renderDistance,
      jobsInFlight: this.profile.workerJobsInFlight,
      meshUploadsPerFrame: this.profile.chunkBudgetPerFrame,
    });
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
    this.scene.add(this.chunks.group, this.entities.group, this.particles.points, this.weatherFx.mesh, this.highlight.group);
    this.controller = new PlayerController(this.player, game.input, game.settings);
    this.controller.onStep = (below) => {
      if (below > 0) this.audio.blockSound('step', BlockRegistry.get(below).sound, this.player.x, this.player.y, this.player.z);
    };
    this.controller.onJump = () => this.audio.play('jump', { volume: 0.4 });
    this.interaction = new PlayerInteraction(this, game.input, this.entities, {
      openStation: (k) => game.openInventory(k === 'crafting' ? 'table' : 'furnace'),
      openChest: (x, y, z) => game.openInventory('chest', { x, y, z }),
      useCompass: (t) => this.useCompass(t),
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
    const kit = ['grass', 'dirt', 'stone', 'cobblestone', 'planks', 'log', 'glass', 'torch', 'bricks', 'stone_bricks', 'sand', 'wool', 'lantern', 'crafting_table', 'chest', 'furnace', 'aurite_pickaxe', 'aurite_sword', 'bow', 'arrow', 'seeds', 'golem_mace'];
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
    // place le joueur sur le sol s'il est dans un bloc (nouveau monde ou terrain modifié)
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    if (p.body.collides(this.world, p.x, p.y, p.z) || this.isNew) {
      let y = this.world.surfaceBelow(bx, WORLD_HEIGHT - 1, bz) + 1;
      while (y < WORLD_HEIGHT - 2 && p.body.collides(this.world, p.x, y, p.z)) y++;
      p.body.setPos(p.x, y, p.z);
      if (this.isNew) p.spawn = [p.x, y, p.z];
    }
    this.loaded = true;
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
    this.crafting.fuel = s.fuel ?? 0;
    if (s.mobs) this.pendingMobs = s.mobs;
  }
  private pendingMobs: SavedMob[] | null = null;

  snapshot(): WorldState {
    const chests: WorldState['chests'] = {};
    for (const [k, inv] of this.world.chests) if (inv.slots.some((x) => x)) chests[k] = inv.serialize().slots;
    const spawners: Record<string, number> = { ...this.savedSpawners };
    for (const [k, s] of this.world.specials) if (s.spawned) spawners[k] = s.spawned;
    return {
      version: 1,
      player: this.player.snapshot(),
      time: { time: this.dayCycle.time, day: this.dayCycle.day },
      weather: this.weather.serialize(),
      chests,
      spawners,
      defeatedBosses: [...this.defeatedBosses],
      progression: this.progression.serialize(),
      fuel: this.crafting.fuel,
      mobs: this.entities.serialize(),
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
      .save(meta, state, chunks)
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
      else if (ev === 'drop') this.dropSelected(false);
      else if (ev === 'slotNext' || ev === 'slotPrev') this.selectSlot((this.player.inventory.selected + (ev === 'slotNext' ? 1 : 8)) % 9);
      else if (ev.startsWith('slot:')) this.selectSlot(Number(ev.slice(5)));
      else remaining.push(ev);
    }
    if (this.paused || !this.loaded) return;
    const p = this.player;
    this.controller.look();
    this.controller.update(this.world, dt);
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
    this.dayCycle.update(dt);
    this.weather.update(dt, this.biomeWeather() !== 'none');
    p.tick(dt);
    this.entities.update(this, dt);
    this.ticker.tick(this);
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
    const targetFov = s.fov + (p.sprinting ? 8 : 0) - (this.interaction.bowCharge > 0 ? this.interaction.bowCharge * 10 : 0);
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, dt * 8);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.05) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    r.shake = this.shakeAmt;
    // ciel, brouillard, lumière
    const rain = this.biomeWeather() === 'none' ? 0 : this.weather.intensity;
    r.sky.update(this.dayCycle.time, cam.position, rain, this.weather.flash, this.elapsed, s.clouds);
    const u = r.materials.uniforms;
    u.uTime.value = this.elapsed;
    u.uDaylight.value = Math.max(0.3, this.dayCycle.daylight * (1 - rain * 0.3) + this.weather.flash * 0.5);
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
    else r.setFog(far * (rain > 0.3 ? 0.35 : 0.6), far, r.sky.horizon);
    game.hud.setOverlays(underwater, inLava);
    // météo
    const light = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1.6), Math.floor(p.z));
    const sheltered = light.sky < 12;
    this.weatherFx.update(this.elapsed, cam.position, rain, this.biomeWeather() === 'snow', sheltered);
    // surbrillance & objet en main
    this.highlight.update(this.interaction.target, this.interaction.miningProgress, this.interaction.preview, true);
    const held = p.inventory.selectedStack?.id ?? '';
    this.held.setItem(held);
    const br = Math.max(0.15, Math.pow(Math.max((light.sky / 15) * this.dayCycle.daylight, light.block / 15), 1.2));
    this.held.update(cam.aspect, this.entities.combat.swing, this.controller.bobPhase * 2, Math.min(1, Math.hypot(p.body.vx, p.body.vz) / 4), br, p.sneaking);
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
    if (p.difficulty === 'normal' || p.difficulty === 'hard') {
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
    this.game.showDeath();
  }

  respawn() {
    this.player.respawn();
    this.game.input.reset();
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

  dispose() {
    this.chunks.dispose();
    this.entities.dispose();
    this.particles.dispose();
    this.weatherFx.dispose();
    this.highlight.dispose();
    this.held.dispose();
    this.shadowTexture.dispose();
    this.iconTex.forEach((t) => t.dispose());
    this.scene.remove(this.chunks.group, this.entities.group, this.particles.points, this.weatherFx.mesh, this.highlight.group);
    this.audio.stopAmbience();
  }
}

export type { WorldState as SessionState };
