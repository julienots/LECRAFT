import type { HudApi } from '../core/GameContext';
import type { Session } from '../core/Session';
import type { TextureManager } from '../render/TextureManager';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { el } from './dom';

const ICONS: Record<string, string[]> = {
  heart: ['.kk.kk..', 'krrkrrk.', 'krwrrrk.', 'krrrrrk.', '.krrrk..', '..krk...', '...k....', '........'],
  heart_half: ['.kk.kk..', 'krrk..k.', 'krwk..k.', 'krrk..k.', '.krk.k..', '..kkk...', '...k....', '........'],
  heart_empty: ['.kk.kk..', 'k..k..k.', 'k.....k.', 'k.....k.', '.k...k..', '..k.k...', '...k....', '........'],
  food: ['....kk..', '...kbbk.', '..kbbbk.', '.kbbbbk.', 'kbbbbk..', 'kwkkk...', 'kwk.....', '.k......'],
  food_half: ['....kk..', '...k..k.', '..k...k.', '.kbb..k.', 'kbbbbk..', 'kwkkk...', 'kwk.....', '.k......'],
  food_empty: ['....kk..', '...k..k.', '..k...k.', '.k....k.', 'k....k..', 'k.kkk...', 'k.k.....', '.k......'],
  bubble: ['..kkk...', '.kcccck.', 'kcwcccck', 'kcccccck', 'kcccccck', '.kcccck.', '..kkkk..', '........'],
  armor: ['kk...kk.', 'kakkkak.', 'kaaaaak.', 'kaaaaak.', 'kaaaaak.', '.kaaak..', '..kkk...', '........'],
};
const PAL: Record<string, string> = { k: '#1a0c0c', r: '#e3302d', w: '#ffd0d0', b: '#b8743a', c: '#6ab8ff', a: '#c8ccd4' };

function iconURL(name: string): string {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ICONS[name].forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = PAL[ch];
      ctx.fillRect(x * 2, y * 2, 2, 2);
    }),
  );
  return c.toDataURL();
}

/**
 * Affichage tête haute : réticule, indice d'interaction, progression du minage, santé, faim,
 * armure, air, XP, hotbar (tactile), nom de l'objet, barre de boss, boussole, toasts, debug.
 */
export class HUD implements HudApi {
  readonly root: HTMLElement;
  private icons: Record<string, string> = {};
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
  stats: () => string = () => '';

  constructor(parent: HTMLElement, private textures: TextureManager) {
    for (const k of Object.keys(ICONS)) this.icons[k] = iconURL(k);
    this.root = el('div', { class: 'hud-root hidden' });
    this.hint = el('div', { class: 'hint hidden' });
    this.ring = el('canvas', { class: 'mining-ring', width: '46', height: '46' });
    this.hearts = el('div', { class: 'icons' });
    this.food = el('div', { class: 'icons', style: 'flex-direction:row-reverse' });
    this.armor = el('div', { class: 'icons' });
    this.air = el('div', { class: 'icons', style: 'flex-direction:row-reverse' });
    this.xpFill = el('div');
    this.xpLevel = el('div', { class: 'xp-level' });
    this.hotbar = el('div', { class: 'hotbar' });
    this.itemName = el('div', { class: 'item-name' });
    for (let i = 0; i < 9; i++) {
      const s = el('div', { class: 'slot', 'data-slot': String(i) });
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.onSlotTap(i);
      });
      this.hotbar.append(s);
    }
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
      el(
        'div',
        { class: 'hud-bottom' },
        this.itemName,
        el('div', { class: 'stats-row' }, el('div', { class: 'col', style: 'gap:2px' }, this.armor, this.hearts), el('div', { class: 'col', style: 'gap:2px;align-items:flex-end' }, this.air, this.food)),
        el('div', { class: 'xpbar' }, this.xpFill, this.xpLevel),
        this.hotbar,
      ),
    );
    parent.append(this.root);
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
    const names: Record<string, string> = { golem_lair: 'Repaire du Golem', ice_temple: 'Sanctuaire de givre', village: 'Village' };
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

  private renderIcons(container: HTMLElement, value: number, max: number, full: string, half: string, empty: string) {
    const n = Math.ceil(max / 2);
    let html = '';
    for (let i = 0; i < n; i++) {
      const v = value - i * 2;
      const icon = v >= 2 ? full : v === 1 ? half : empty;
      html += `<i style="background-image:url(${this.icons[icon]})"></i>`;
    }
    container.innerHTML = html;
  }

  private renderHotbar(s: Session) {
    const inv = s.player.inventory;
    const slots = this.hotbar.children;
    for (let i = 0; i < 9; i++) {
      const slot = slots[i] as HTMLElement;
      const st = inv.slots[i];
      slot.classList.toggle('sel', i === inv.selected);
      slot.innerHTML = '';
      if (!st) continue;
      slot.append(el('img', { src: this.textures.iconURL(st.id), alt: '' }));
      if (st.count > 1) slot.append(el('span', { class: 'count' }, String(st.count)));
      const max = ItemRegistry.maxDurability(st.id);
      if (st.durability !== undefined && max > 0 && st.durability < max) {
        const f = st.durability / max;
        slot.append(el('div', { class: 'dur' }, el('div', { style: `width:${f * 100}%;background:hsl(${f * 120},80%,50%)` })));
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
    const hp = Math.ceil(p.health);
    if (hp !== L.h || p.maxHealth !== L.maxH) {
      L.h = hp;
      L.maxH = p.maxHealth;
      this.renderIcons(this.hearts, hp, p.maxHealth, 'heart', 'heart_half', 'heart_empty');
    }
    const creative = p.creative;
    this.hearts.style.visibility = this.food.style.visibility = creative ? 'hidden' : '';
    if (p.hunger !== L.f) {
      L.f = p.hunger;
      this.renderIcons(this.food, p.hunger, 20, 'food', 'food_half', 'food_empty');
    }
    const def = p.inventory.defense();
    if (def !== L.a) {
      L.a = def;
      if (def > 0) this.renderIcons(this.armor, def, 20, 'armor', 'armor', 'heart_empty');
      else this.armor.innerHTML = '';
      this.armor.querySelectorAll('i').forEach((i, k) => (k * 2 >= def ? ((i as HTMLElement).style.visibility = 'hidden') : null));
    }
    const air = p.air < 300 ? Math.ceil(p.air / 30) : -1;
    if (air !== L.air) {
      L.air = air;
      this.air.innerHTML = air >= 0 ? `${'<i></i>'.repeat(0)}${Array.from({ length: Math.max(0, air) }, () => `<i style="background-image:url(${this.icons.bubble})"></i>`).join('')}` : '';
    }
    if (p.xp !== L.xp || p.level !== L.lvl) {
      L.xp = p.xp;
      L.lvl = p.level;
      this.xpFill.style.width = `${(p.xp / p.xpToNext) * 100}%`;
      this.xpLevel.textContent = p.level > 0 ? String(p.level) : '';
    }
    if (this.hotbarDirty) {
      this.hotbarDirty = false;
      this.renderHotbar(s);
    }
    const sel = p.inventory.selected;
    if (sel !== this.lastSelected) {
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
