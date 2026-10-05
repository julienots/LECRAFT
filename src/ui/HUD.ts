import type { HudApi } from '../core/GameContext';
import type { Session } from '../core/Session';
import type { TextureManager } from '../render/TextureManager';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { el } from './dom';
import { buildHudSprites, type HudSprites } from './HudArt';

/**
 * Affichage tête haute : réticule, indice d'interaction, progression du minage, santé, faim,
 * armure, air, XP, hotbar (tactile), nom de l'objet, barre de boss, boussole, toasts, debug.
 */
export class HUD implements HudApi {
  readonly root: HTMLElement;
  private icons: HudSprites = {};
  private hotbarBg: HTMLElement;
  private selEl: HTMLElement;
  private xpBg: HTMLElement;
  private hearts: HTMLElement;
  private food: HTMLElement;
  private armor: HTMLElement;
  private air: HTMLElement;
  private xpFill: HTMLElement;
  private xpLevel: HTMLElement;
  private hotbar: HTMLElement;
  private itemName: HTMLElement;
  private hint: HTMLElement;
  private ring: HTMLCanvasElement;
  private boss: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;
  private toasts: HTMLElement;
  private debug: HTMLElement;
  private vignette: HTMLElement;
  private underwater: HTMLElement;
  private inlava: HTMLElement;
  private compass: HTMLElement;
  private compassArrow: HTMLElement;
  private compassText: HTMLElement;
  private compassTarget: { x: number; z: number; until: number; name: string } | null = null;
  private last = { h: -1, f: -1, a: -1, air: -1, maxH: -1, xp: -1, lvl: -1 };
  private hotbarDirty = true;
  private nameTimer = 0;
  private lastSelected = -1;
  private debugOn = false;
  private fps = 0;
  private frames = 0;
  private fpsTime = 0;
  onSlotTap: (i: number) => void = () => {};
  onPause: () => void = () => {};
  onInventory: () => void = () => {};
  onChat: () => void = () => {};
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private actionbarEl: HTMLElement;
  private coordsEl: HTMLElement;
  private titleTimer = 0;
  private actionTimer = 0;
  stats: () => string = () => '';

  constructor(parent: HTMLElement, private textures: TextureManager) {
    this.icons = buildHudSprites(textures);
    this.root = el('div', { class: 'hud-root hidden' });
    this.hint = el('div', { class: 'hint hidden' });
    this.ring = el('canvas', { class: 'mining-ring', width: '46', height: '46' });
    this.hearts = el('div', { class: 'mc-icons gp', style: '--x:0;--y:10' });
    this.food = el('div', { class: 'mc-icons gp rev', style: '--x:101;--y:10' });
    this.armor = el('div', { class: 'mc-icons gp', style: '--x:0;--y:0' });
    this.air = el('div', { class: 'mc-icons gp rev', style: '--x:101;--y:0' });
    this.xpFill = el('div', { class: 'mc-xpfill' });
    this.xpBg = el('div', { class: 'mc-xp gp', style: '--x:0;--y:20;--w:182;--h:5' }, this.xpFill);
    this.xpLevel = el('div', { class: 'mc-level' });
    this.hotbar = el('div', { class: 'mc-hotbar gp', style: '--x:0;--y:27;--w:182;--h:22' });
    this.hotbarBg = this.hotbar;
    this.selEl = el('div', { class: 'mc-hsel' });
    this.itemName = el('div', { class: 'mc-itemname' });
    for (let i = 0; i < 9; i++) {
      const s = el('div', { class: 'mc-hslot', 'data-slot': String(i), style: `--i:${i}` });
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.onSlotTap(i);
      });
      this.hotbar.append(s);
    }
    this.hotbar.append(this.selEl);
    const invBtn = el('div', { class: 'mc-invbtn gp', style: '--x:184;--y:27;--w:22;--h:22', role: 'button', 'aria-label': 'Inventaire' }, '•••');
    invBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onInventory();
    });
    this.applySprites();
    this.bossName = el('div');
    this.bossFill = el('div');
    this.boss = el('div', { class: 'boss-bar hidden' }, this.bossName, el('div', { class: 'bar' }, this.bossFill));
    this.toasts = el('div', { class: 'toasts' });
    this.debug = el('div', { class: 'debug hidden' });
    this.vignette = el('div', { class: 'vignette' });
    this.underwater = el('div', { class: 'underwater hidden' });
    this.inlava = el('div', { class: 'inlava hidden' });
    this.compassArrow = el('span', { class: 'arrow' }, '➤');
    this.compassText = el('span');
    this.compass = el('div', { class: 'compass hidden' }, this.compassArrow, this.compassText);
    const chatBtn = el('button', { class: 'btn-chat', 'aria-label': 'Chat' }, '💬');
    chatBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onChat();
    });
    this.titleEl = el('div', { class: 'mc-title-big' });
    this.subtitleEl = el('div', { class: 'mc-subtitle' });
    this.actionbarEl = el('div', { class: 'mc-actionbar' });
    this.coordsEl = el('div', { class: 'mc-coords hidden' });
    const pause = el('button', { class: 'btn-pause', 'aria-label': 'Pause' }, '❚❚');
    pause.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onPause();
    });
    this.root.append(
      this.underwater,
      this.inlava,
      this.vignette,
      el('div', { class: 'crosshair' }),
      this.ring,
      this.hint,
      this.boss,
      this.compass,
      this.toasts,
      this.debug,
      pause,
      chatBtn,
      el('div', { class: 'mc-titles' }, this.titleEl, this.subtitleEl),
      this.actionbarEl,
      this.coordsEl,
      el('div', { class: 'mc-hud' }, this.itemName, this.armor, this.hearts, this.air, this.food, this.xpBg, this.xpLevel, this.hotbar, invBtn),
    );
    parent.append(this.root);
  }

  private applySprites() {
    this.hotbarBg.style.backgroundImage = `url(${this.icons.hotbar})`;
    this.selEl.style.backgroundImage = `url(${this.icons.selection})`;
    this.xpBg.style.backgroundImage = `url(${this.icons.xp_bg})`;
    this.xpFill.style.backgroundImage = `url(${this.icons.xp_fill})`;
  }

  /** Recharge les sprites (changement de pack de ressources). */
  refreshTheme() {
    this.icons = buildHudSprites(this.textures);
    this.applySprites();
    this.last = { h: -1, f: -1, a: -1, air: -1, maxH: -1, xp: -1, lvl: -1 };
    this.hotbarDirty = true;
  }

  /** /title : titre, sous-titre ou barre d'action. */
  showTitle(text: string, kind: 'title' | 'subtitle' | 'actionbar') {
    if (kind === 'actionbar') {
      this.actionbarEl.textContent = text;
      this.actionTimer = 3;
      return;
    }
    if (!text) {
      this.titleEl.textContent = this.subtitleEl.textContent = '';
      return;
    }
    (kind === 'title' ? this.titleEl : this.subtitleEl).textContent = text;
    this.titleTimer = 4;
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  markHotbarDirty() {
    this.hotbarDirty = true;
  }

  toggleDebug() {
    this.debugOn = !this.debugOn;
    this.debug.classList.toggle('hidden', !this.debugOn);
  }
  setDebug(on: boolean) {
    this.debugOn = on;
    this.debug.classList.toggle('hidden', !on);
  }

  toast(text: string, kind: 'info' | 'achievement' | 'warn' = 'info') {
    const t = el('div', { class: `toast ${kind}` }, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), kind === 'achievement' ? 5000 : 3500);
  }

  setBoss(name: string | null, frac = 1, phase = 1) {
    if (!name) {
      this.boss.classList.add('hidden');
      return;
    }
    this.boss.classList.remove('hidden');
    this.bossName.textContent = `${name} — phase ${phase}`;
    this.bossFill.style.width = `${Math.round(frac * 100)}%`;
  }

  showCompass(x: number, z: number, target: string) {
    const names: Record<string, string> = { spawn: "Point d'apparition", golem_lair: 'Repaire du Golem', ice_temple: 'Sanctuaire de givre', village: 'Village' };
    this.compassTarget = { x, z, until: performance.now() + 45000, name: names[target] ?? target };
    this.compass.classList.remove('hidden');
  }

  flashDamage() {
    this.vignette.style.opacity = '1';
    setTimeout(() => (this.vignette.style.opacity = '0'), 180);
  }

  setOverlays(underwater: boolean, lava: boolean) {
    this.underwater.classList.toggle('hidden', !underwater);
    this.inlava.classList.toggle('hidden', !lava);
  }

  /** Rangée d'icônes 9x9 (2 points par icône) : pleine / moitié / vide. */
  private renderIcons(container: HTMLElement, value: number, max: number, prefix: string, hideEmpty = false) {
    const n = Math.ceil(max / 2);
    let html = '';
    for (let i = 0; i < n; i++) {
      const v = value - i * 2;
      const kind = v >= 2 ? 'full' : v === 1 ? 'half' : 'empty';
      if (hideEmpty && kind === 'empty') {
        html += '<i style="visibility:hidden"></i>';
        continue;
      }
      html += `<i style="background-image:url(${this.icons[`${prefix}_${kind}`]})"></i>`;
    }
    container.innerHTML = html;
  }

  private renderHotbar(s: Session) {
    const inv = s.player.inventory;
    const slots = this.hotbar.querySelectorAll<HTMLElement>('.mc-hslot');
    this.selEl.style.setProperty('--i', String(inv.selected));
    for (let i = 0; i < 9; i++) {
      const slot = slots[i];
      const st = inv.slots[i];
      slot.innerHTML = '';
      if (!st) continue;
      slot.append(el('img', { src: this.textures.iconURL(st.id), alt: '' }));
      if (st.count > 1) slot.append(el('span', { class: 'mc-count' }, String(st.count)));
      const max = ItemRegistry.maxDurability(st.id);
      if (st.durability !== undefined && max > 0 && st.durability < max) {
        const f = st.durability / max;
        slot.append(el('div', { class: 'mc-dur' }, el('div', { style: `width:${Math.round(f * 13) / 13 * 100}%;background:hsl(${f * 120},100%,50%)` })));
      }
    }
  }

  update(s: Session, dt: number) {
    const p = s.player;
    // FPS
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
      if (this.debugOn || s.settings.showFps) {
        this.debug.classList.remove('hidden');
        this.debug.textContent = this.debugOn ? this.stats() : `${this.fps} FPS`;
      } else this.debug.classList.add('hidden');
    }
    const L = this.last;
    // titres, barre d'action et coordonnées (règle showCoordinates)
    if (this.titleTimer > 0 && (this.titleTimer -= dt) <= 0) this.titleEl.textContent = this.subtitleEl.textContent = '';
    if (this.actionTimer > 0 && (this.actionTimer -= dt) <= 0) this.actionbarEl.textContent = '';
    const showC = s.gamerules.showCoordinates;
    this.coordsEl.classList.toggle('hidden', !showC);
    if (showC) this.coordsEl.textContent = `Position : ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
    const hp = Math.ceil(p.health);
    if (hp !== L.h || p.maxHealth !== L.maxH) {
      L.h = hp;
      L.maxH = p.maxHealth;
      this.renderIcons(this.hearts, hp, p.maxHealth, 'heart');
    }
    const creative = p.creative;
    this.hearts.style.visibility = this.food.style.visibility = this.xpBg.style.visibility = this.armor.style.visibility = creative ? 'hidden' : '';
    this.xpLevel.style.visibility = creative ? 'hidden' : '';
    if (p.hunger !== L.f) {
      L.f = p.hunger;
      this.renderIcons(this.food, p.hunger, 20, 'food');
    }
    const def = p.inventory.defense();
    if (def !== L.a) {
      L.a = def;
      if (def > 0) this.renderIcons(this.armor, def, 20, 'armor');
      else this.armor.innerHTML = '';
    }
    const air = p.air < 300 ? Math.ceil(p.air / 30) : -1;
    if (air !== L.air) {
      L.air = air;
      this.air.innerHTML = air >= 0 ? Array.from({ length: Math.max(0, air) }, () => `<i style="background-image:url(${this.icons.air})"></i>`).join('') : '';
    }
    if (p.xp !== L.xp || p.level !== L.lvl) {
      L.xp = p.xp;
      L.lvl = p.level;
      this.xpFill.style.width = `${Math.floor((p.xp / p.xpToNext) * 182) / 1.82}%`;
      this.xpLevel.textContent = p.level > 0 ? String(p.level) : '';
    }
    if (this.hotbarDirty) {
      this.hotbarDirty = false;
      this.renderHotbar(s);
    }
    const sel = p.inventory.selected;
    if (sel !== this.lastSelected) {
      this.selEl.style.setProperty('--i', String(sel));
      this.lastSelected = sel;
      const st = p.inventory.slots[sel];
      this.itemName.textContent = st ? ItemRegistry.get(st.id)?.name ?? st.id : '';
      this.itemName.style.opacity = '1';
      this.nameTimer = 2;
    }
    if (this.nameTimer > 0) {
      this.nameTimer -= dt;
      if (this.nameTimer <= 0) this.itemName.style.opacity = '0';
    }
    // indice & anneau de minage
    const hints: Record<string, string> = { mine: '⛏ appui long : miner', attack: '⚔ attaquer', open: '✋ toucher : ouvrir', place: '▣ toucher : poser', eat: '🍖 toucher : manger', feed: '♥ toucher : nourrir' };
    const h = s.interaction.hint;
    const showHint = h && s.game.input.mode === 'touch';
    this.hint.classList.toggle('hidden', !showHint);
    if (showHint) this.hint.textContent = hints[h];
    const prog = s.interaction.miningProgress;
    const ctx = this.ring.getContext('2d')!;
    ctx.clearRect(0, 0, 46, 46);
    if (prog > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(23, 23, 18, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.stroke();
    }
    // boussole
    if (this.compassTarget) {
      if (performance.now() > this.compassTarget.until) {
        this.compassTarget = null;
        this.compass.classList.add('hidden');
      } else {
        const dx = this.compassTarget.x - p.x, dz = this.compassTarget.z - p.z;
        const ang = Math.atan2(dx, -dz) + p.yaw; // 0 = devant
        this.compassArrow.style.transform = `rotate(${ang - Math.PI / 2}rad)`;
        this.compassText.textContent = `${this.compassTarget.name} : ${Math.round(Math.hypot(dx, dz))} m`;
      }
    }
  }

  get currentFps() {
    return this.fps;
  }
}
