import { detectDevice, AdaptiveQuality, type DeviceInfo } from './DeviceProfiler';
import { applyQuality, loadSettings, saveSettings, type Settings } from './Settings';
import { GameLoop } from './GameLoop';
import { Session, type WorldState } from './Session';
import { TextureManager } from '../render/TextureManager';
import { Renderer } from '../render/Renderer';
import { AudioManager } from '../audio/AudioManager';
import { SaveManager, type WorldMeta } from '../save/SaveManager';
import { InputState } from '../input/InputState';
import { TouchController } from '../input/TouchController';
import { KeyboardMouse } from '../input/KeyboardMouse';
import { UIManager } from '../ui/UIManager';
import { HUD } from '../ui/HUD';
import { Platform } from '../platform/Platform';
import { mainMenu, worldsScreen, newWorldScreen, pauseScreen, deathScreen, loadingScreen, helpScreen, creditsScreen, progressScreen } from '../ui/Screens';
import { settingsScreen } from '../ui/SettingsUI';
import { InventoryUI, type InventoryMode } from '../ui/InventoryUI';
import type { Difficulty, GameMode } from './Config';
import { seedFromString } from '../util/math';
import { DebugTools } from './DebugTools';

export type GameState = 'menu' | 'loading' | 'playing' | 'paused';

/**
 * Application : ressources globales (rendu, audio, sauvegardes, entrées, interface)
 * et transitions entre menu, chargement, jeu et pause.
 */
export class Game {
  readonly device: DeviceInfo;
  readonly settings: Settings;
  readonly textures: TextureManager;
  readonly renderer: Renderer;
  readonly audio: AudioManager;
  readonly saves = new SaveManager();
  readonly input = new InputState();
  readonly ui: UIManager;
  readonly hud: HUD;
  readonly touch: TouchController;
  readonly keyboard: KeyboardMouse;
  readonly platform = new Platform();
  private loop: GameLoop;
  private adaptive: AdaptiveQuality;
  session: Session | null = null;
  state: GameState = 'menu';
  lastThumbnail: string | null = null;
  private inventoryUI: InventoryUI | null = null;
  readonly debug = new DebugTools(this);

  constructor(readonly root: HTMLElement) {
    this.device = detectDevice();
    const { settings, fresh } = loadSettings(this.device.level);
    this.settings = settings;
    if (fresh) applyQuality(this.settings, this.device.level);
    const canvas = root.querySelector('#game-canvas') as HTMLCanvasElement;
    this.textures = new TextureManager();
    this.renderer = new Renderer(canvas, this.textures, this.settings);
    this.audio = new AudioManager(this.settings);
    this.ui = new UIManager(root.querySelector('#ui') as HTMLElement);
    this.ui.onClick = () => this.audio.play('click', { volume: 0.5 });
    this.hud = new HUD(root.querySelector('#hud') as HTMLElement, this.textures);
    this.hud.onSlotTap = (i) => this.input.push(`slot:${i}`);
    this.hud.onPause = () => this.pause();
    this.hud.onInventory = () => this.input.push('inventory');
    this.hud.stats = () => this.debugText();
    this.touch = new TouchController(root.querySelector('#hud') as HTMLElement, this.input, this.settings);
    this.touch.setVisible(false);
    this.keyboard = new KeyboardMouse(canvas, this.input, this.settings);
    this.keyboard.onBack = () => this.back();
    this.loop = new GameLoop((dt) => this.frame(dt));
    this.loop.fpsCap = this.settings.fpsCap;
    this.adaptive = new AdaptiveQuality((dir) => this.adjustQuality(dir));
    window.addEventListener('resize', () => this.renderer.resize());
    // premier contact : déverrouille l'audio (politique d'autoplay)
    const unlock = () => {
      this.audio.unlock();
      this.platform.requestFullscreen();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'playing' && this.input.mode === 'keyboard' && !this.inventoryUI) this.pause();
    });
  }

  async boot() {
    await this.platform.init({ onBack: () => this.back(), onPause: () => this.onAppPause(), onResume: () => this.onAppResume() });
    await this.platform.setOrientation(this.settings.orientation);
    try {
      await this.saves.open();
    } catch (e) {
      console.error('IndexedDB indisponible', e);
    }
    this.showMainMenu();
    this.loop.start();
    await this.platform.hideSplash();
  }

  // ---------- navigation ----------
  showMainMenu() {
    this.state = 'menu';
    this.hud.show(false);
    this.touch.setVisible(false);
    this.ui.set(mainMenu(this));
    this.audio.setMusicMood('menu');
  }
  showWorlds() {
    this.ui.push(worldsScreen(this));
  }
  showNewWorld() {
    this.ui.push(newWorldScreen(this));
  }
  showSettings() {
    this.ui.push(settingsScreen(this));
  }
  showHelp() {
    this.ui.push(helpScreen(this));
  }
  showCredits() {
    this.ui.push(creditsScreen(this));
  }
  showProgress() {
    if (this.session) this.ui.push(progressScreen(this, this.session));
  }

  /** Bouton retour Android / Échap. */
  back() {
    this.audio.play('click', { volume: 0.4 });
    if (this.state === 'playing') {
      if (this.inventoryUI) {
        this.closeInventory();
        return;
      }
      if (this.ui.size > 0 && this.ui.back()) return;
      this.pause();
      return;
    }
    if (this.state === 'paused') {
      if (this.ui.size > 1) this.ui.back();
      else this.resume();
      return;
    }
    if (this.state === 'menu') {
      if (this.ui.size > 1) {
        this.ui.back();
        return;
      }
      this.ui.confirm('Quitter LeCraft ?', 'Voulez-vous fermer le jeu ?', 'Quitter').then((ok) => ok && this.platform.exit());
    }
  }

  // ---------- mondes ----------
  async createWorld(name: string, seedText: string, mode: GameMode, difficulty: Difficulty) {
    const seed = seedText.trim() ? seedFromString(seedText) : (Math.random() * 2 ** 31) | 0;
    const meta = await this.saves.createWorld(name.trim() || 'Nouveau monde', seed, mode, difficulty);
    await this.startWorld(meta, null);
  }

  async playWorld(meta: WorldMeta) {
    let state: WorldState | null = null;
    try {
      state = await this.saves.load<WorldState>(meta.id);
      if (this.saves.lastLoadUsedBackup) this.hud.toast('Sauvegarde principale corrompue : copie de secours chargée', 'warn');
    } catch (e) {
      console.error(e);
    }
    await this.startWorld(meta, state);
  }

  async continueLast() {
    const list = await this.saves.listWorlds().catch(() => []);
    if (list.length) await this.playWorld(list[0]);
    else this.showNewWorld();
  }

  private async startWorld(meta: WorldMeta, state: WorldState | null) {
    this.audio.unlock();
    this.state = 'loading';
    this.settings.difficulty = state ? meta.difficulty : meta.difficulty;
    const loading = loadingScreen(meta.name);
    this.ui.set(loading.screen);
    this.session?.dispose();
    this.session = new Session(this, meta, state);
    this.hud.markHotbarDirty();
    this.session.player.inventory.onChange(() => this.hud.markHotbarDirty());
    await this.session.waitForSpawn((f) => loading.progress(f));
    this.ui.clear();
    this.state = 'playing';
    this.hud.show(true);
    this.touch.setVisible(true);
    this.touch.syncToggles();
    this.hud.toast(state ? `Bon retour dans « ${meta.name} »` : `Monde « ${meta.name} » créé (seed ${meta.seed})`);
    if (!state) await this.session.save(true).catch(() => {});
  }

  pause() {
    if (this.state !== 'playing' || !this.session) return;
    this.closeInventory();
    this.state = 'paused';
    this.session.paused = true;
    this.input.reset();
    this.touch.releaseAll();
    this.keyboard.releaseAll();
    this.keyboard.exitPointerLock();
    this.lastThumbnail = this.renderer.thumbnail();
    this.touch.setVisible(false);
    this.ui.set(pauseScreen(this));
    this.audio.stopAmbience();
  }

  resume() {
    if (this.state !== 'paused' || !this.session) return;
    this.ui.clear();
    this.state = 'playing';
    this.session.paused = false;
    this.touch.setVisible(true);
    this.touch.syncToggles();
    this.input.reset();
  }

  async saveNow() {
    if (!this.session) return;
    try {
      await this.session.save(true);
      this.hud.toast('Partie sauvegardée');
    } catch {
      /* toast déjà affiché */
    }
  }

  async quitToMenu() {
    if (this.session) {
      await this.session.save(true).catch(() => {});
      this.session.dispose();
      this.session = null;
    }
    this.closeInventory();
    this.showMainMenu();
  }

  showDeath() {
    this.touch.setVisible(false);
    this.closeInventory();
    this.ui.set(deathScreen(this, this.session!));
  }

  respawn() {
    if (!this.session) return;
    this.session.respawn();
    this.ui.clear();
    this.touch.setVisible(true);
  }

  // ---------- inventaire ----------
  openInventory(mode: InventoryMode, chest?: { x: number; y: number; z: number }) {
    if (!this.session || this.state !== 'playing') return;
    if (this.inventoryUI) {
      this.closeInventory();
      if (mode === 'hand') return;
    }
    this.input.reset();
    this.touch.releaseAll();
    this.keyboard.releaseAll();
    this.keyboard.exitPointerLock();
    this.touch.setVisible(false);
    this.inventoryUI = new InventoryUI(this, this.session, mode, chest);
    this.ui.push(this.inventoryUI.screen);
  }

  closeInventory() {
    if (!this.inventoryUI) return;
    const ui = this.inventoryUI;
    this.inventoryUI = null;
    ui.dispose();
    this.ui.remove(ui.screen);
    if (this.state === 'playing') this.touch.setVisible(true);
    this.hud.markHotbarDirty();
  }

  // ---------- cycle de vie Android ----------
  private onAppPause() {
    if (this.state === 'playing') this.pause();
    if (this.session) void this.session.save(false).catch(() => {});
    this.audio.suspend();
    this.loop.stop();
  }
  private onAppResume() {
    this.audio.resume();
    this.loop.start();
  }

  // ---------- qualité ----------
  applySettings(remesh = false) {
    saveSettings(this.settings);
    this.loop.fpsCap = this.settings.fpsCap;
    this.renderer.camera.fov = this.settings.fov;
    this.renderer.camera.updateProjectionMatrix();
    this.renderer.resize();
    this.audio.applyVolumes();
    this.touch.applyLayout();
    if (this.session) {
      this.session.chunks.opts.renderDistance = this.settings.renderDistance;
      this.session.particles.limit = this.session.particleLimit();
      this.session.player.difficulty = this.settings.difficulty;
      if (remesh) this.session.chunks.remeshAll();
    }
  }

  private adjustQuality(dir: -1 | 1) {
    if (!this.settings.autoQuality || !this.session) return;
    if (dir < 0) {
      if (!this.renderer.adjustDynamicScale(-1) && this.settings.renderDistance > 2) {
        this.settings.renderDistance--;
        this.applySettings();
      }
    } else this.renderer.adjustDynamicScale(1);
  }

  private debugText(): string {
    const s = this.session;
    if (!s) return '';
    const p = s.player;
    const r = this.renderer.gl.info;
    const biome = s.world.biomeAt(Math.floor(p.x), Math.floor(p.z));
    return [
      `${this.hud.currentFps} FPS  (cible ${this.settings.fpsCap})  qualité ${this.settings.quality}`,
      `XYZ ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  biome ${biome.name}`,
      `chunks ${s.world.chunks.size}  meshing ${s.chunks.stats.meshMs.toFixed(1)} ms  en attente ${s.chunks.pendingCount}`,
      `draw calls ${r.render.calls}  triangles ${r.render.triangles}  géométries ${r.memory.geometries}  textures ${r.memory.textures}`,
      `entités ${s.entities.entities.length}  particules ${s.particles.active}  liquides ${s.ticker.fluids.pending}`,
      `heure ${(s.dayCycle.time * 24 + 6) % 24 | 0}h  jour ${s.dayCycle.day}  météo ${s.weather.state}`,
      `GPU ${this.device.gpu.slice(0, 40)}  (${this.device.level})`,
    ].join('\n');
  }

  private frame(dt: number) {
    if (this.state === 'playing' || this.state === 'paused') {
      const s = this.session!;
      s.update(dt);
      if (this.state === 'playing') {
        this.renderer.render({ scene: s.held.scene, camera: s.held.camera });
        this.adaptive.update(dt, this.settings.fpsCap);
      }
      // en pause : rendu figé (aucune simulation, aucun rendu → économie batterie)
    } else if (this.state === 'menu') {
      this.audio.updateMusic(dt);
    }
  }
}
