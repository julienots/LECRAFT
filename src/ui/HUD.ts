import type { HudApi } from '../core/GameContext';
import { hasGlint, iconKey, stackName } from '../inventory/StackInfo';
import { setMcText } from './McText';
import type { Session } from '../core/Session';
import type { TextureManager } from '../render/TextureManager';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { el } from './dom';
import { bhTouchIcon } from './TouchIcons';
import { buildHudSprites, type HudSprites } from './HudArt';
import { rarityColor } from './Rarity';
import { customName } from '../inventory/Enchantments';

/**
 * Affichage tête haute : réticule, indice d'interaction, progression du minage, santé, faim,
 * armure, air, XP, hotbar (tactile), nom de l'objet, barre de boss, boussole, toasts, debug.
 */
export class HUD implements HudApi {
  readonly root: HTMLElement;
  private icons: HudSprites = {};
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
  private portalFx: HTMLElement;
  private compass: HTMLElement;
  private compassArrow: HTMLElement;
  private compassText: HTMLElement;
  private compassTarget: { x: number; z: number; until: number; name: string; autoHide?: boolean } | null = null;
  private last = { xp: -1, lvl: -1 };
  /** Signatures des rangées d'icônes (évite de reconstruire le DOM à chaque image). */
  private sig = { hearts: '', food: '', armor: '', air: '' };
  /** Horloge du HUD à 20 tics/s (clignotement des cœurs, tremblements, régénération). */
  private tick = 0;
  private tickAcc = 0;
  /** Clignotement des cœurs après une blessure / un soin (comme le jeu original). */
  private hp = { last: -1, display: 0, changedAt: 0, blinkUntil: 0 };
  /** Décalages aléatoires tirés à chaque tic (cœurs : santé basse, faim : saturation nulle). */
  private shakeH: number[] = [];
  private shakeF: number[] = [];
  private underwaterNow = false;
  private crosshair: HTMLElement;
  private attackBg: HTMLElement;
  private attackFill: HTMLElement;
  private attackMax = 0.4;
  private packKey: unknown = undefined;
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
  private sidebarEl: HTMLElement;
  private coordsEl: HTMLElement;
  private titleTimer = 0;
  private actionTimer = 0;
  /** Message « Lecture en cours » du juke-box : couleurs arc-en-ciel animées (secondes restantes). */
  private rainbow = 0;
  stats: () => string = () => '';

  constructor(parent: HTMLElement, private textures: TextureManager) {
    this.icons = buildHudSprites(textures);
    this.root = el('div', { class: 'hud-root hidden' });
    this.hint = el('div', { class: 'hint hidden' });
    this.ring = el('canvas', { class: 'mining-ring', width: '46', height: '46' });
    // rangées d'icônes de l'interface mobile : cœurs et armure à gauche, faim et air à droite
    this.hearts = el('div', { class: 'bh-icons left', style: '--b:36' });
    this.food = el('div', { class: 'bh-icons right', style: '--b:36' });
    this.armor = el('div', { class: 'bh-icons left', style: '--b:46' });
    this.air = el('div', { class: 'bh-icons right', style: '--b:46' });
    // réticule (sprite inversant les couleurs) et indicateur de recharge d'attaque en dessous
    this.attackFill = el('div', { class: 'mc-attack-fill' });
    this.attackBg = el('div', { class: 'mc-attack hidden' }, this.attackFill);
    this.crosshair = el('div', { class: 'crosshair' });
    this.xpFill = el('div', { class: 'mc-xpfill' });
    this.xpBg = el('div', { class: 'mc-xp bh-xp' }, this.xpFill);
    this.xpLevel = el('div', { class: 'mc-level' });
    this.hotbar = el('div', { class: 'mc-hotbar bh-hotbar' });
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
    const invBtn = el('div', { class: 'mc-invbtn bh-invbtn', role: 'button', 'aria-label': 'Inventaire' }, el('i', {}), el('i', {}), el('i', {}));
    invBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onInventory();
    });
    this.bossName = el('div');
    this.bossFill = el('div');
    this.boss = el('div', { class: 'boss-bar hidden' }, this.bossName, el('div', { class: 'bar' }, this.bossFill));
    this.bossBar = this.boss.querySelector('.bar') as HTMLElement;
    this.toasts = el('div', { class: 'toasts' });
    this.debug = el('div', { class: 'debug hidden' });
    this.vignette = el('div', { class: 'vignette' });
    this.underwater = el('div', { class: 'underwater hidden' });
    this.inlava = el('div', { class: 'inlava hidden' });
    this.portalFx = el('div', { class: 'portal-fx hidden' });
    this.compassArrow = el('span', { class: 'arrow' }, '➤');
    this.compassText = el('span');
    this.compass = el('div', { class: 'compass hidden' }, this.compassArrow, this.compassText);
    // boutons du haut de l'écran (comme l'édition mobile) : gestes, tchat, menu de pause
    const topBtn = (cls: string, icon: string, label: string, fn: () => void) => {
      const b = el('button', { class: `bh-tbtn ${cls}`, 'aria-label': label, type: 'button' });
      b.style.backgroundImage = bhTouchIcon(icon);
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        fn();
      });
      return b;
    };
    const emoteBtn = topBtn('bh-emote', 'bh_emote', 'Gestes', () => this.toast('Les gestes ne sont pas disponibles dans LeCraft.'));
    const chatBtn = topBtn('bh-chat', 'bh_chat', 'Tchat', () => this.onChat());
    this.titleEl = el('div', { class: 'mc-title-big' });
    this.subtitleEl = el('div', { class: 'mc-subtitle' });
    this.actionbarEl = el('div', { class: 'mc-actionbar' });
    this.sidebarEl = el('div', { class: 'mc-sidebar hidden' });
    this.coordsEl = el('div', { class: 'mc-coords bh-coords hidden' }, el('div', {}), el('div', {}));
    const pause = topBtn('bh-menu', 'bh_menu', 'Menu', () => this.onPause());
    this.root.append(
      this.underwater,
      this.inlava,
      this.portalFx,
      this.vignette,
      this.crosshair,
      this.attackBg,
      this.ring,
      this.hint,
      this.boss,
      this.compass,
      this.toasts,
      this.debug,
      el('div', { class: 'bh-top' }, emoteBtn, chatBtn, pause),
      el('div', { class: 'mc-titles' }, this.titleEl, this.subtitleEl),
      this.actionbarEl,
      this.sidebarEl,
      this.coordsEl,
      el('div', { class: 'mc-hud bh-hud' }, this.itemName, this.armor, this.hearts, this.air, this.food, this.xpBg, this.xpLevel, this.hotbar, invBtn),
    );
    parent.append(this.root);
    this.applySprites();
  }

  private applySprites() {
    // barre d'objets, sélection et barre d'XP : dessinées en CSS (interface mobile), pas de sprite
    this.crosshair.style.backgroundImage = `url(${this.icons.crosshair})`;
    this.attackBg.style.backgroundImage = `url(${this.icons.attack_bg})`;
    this.attackFill.style.backgroundImage = `url(${this.icons.attack_progress})`;
    this.paintBoss();
  }

  /** Recharge les sprites (changement de pack de ressources). */
  refreshTheme() {
    this.icons = buildHudSprites(this.textures);
    this.applySprites();
    this.last = { xp: -1, lvl: -1 };
    this.sig = { hearts: '', food: '', armor: '', air: '' };
    this.hotbarDirty = true;
  }

  private sidebarKey = '';
  /** Tableau de scores latéral (serveur de mini-jeux) ; null le masque. */
  setSidebar(title: string | null, lines: string[] = []) {
    const key = title === null ? '' : title + '\n' + lines.join('\n');
    if (key === this.sidebarKey) return;
    this.sidebarKey = key;
    this.sidebarEl.classList.toggle('hidden', title === null);
    if (title === null) return;
    const t = el('div', { class: 'sb-title' });
    setMcText(t, title);
    const rows = lines.map((l) => {
      const r = el('div', { class: 'sb-line' });
      setMcText(r, l || '\u00a0');
      return r;
    });
    this.sidebarEl.replaceChildren(t, ...rows);
  }

  /** /title : titre, sous-titre ou barre d'action. */
  showTitle(text: string, kind: 'title' | 'subtitle' | 'actionbar') {
    if (kind === 'actionbar') {
      setMcText(this.actionbarEl, text);
      this.actionTimer = 3;
      this.rainbow = 0;
      this.actionbarEl.style.color = this.actionbarEl.style.opacity = '';
      return;
    }
    if (!text) {
      this.titleEl.textContent = this.subtitleEl.textContent = '';
      return;
    }
    setMcText(kind === 'title' ? this.titleEl : this.subtitleEl, text);
    this.titleTimer = 4;
  }

  /**
   * Juke-box : « Lecture en cours : C418 - cat » au-dessus de la barre d'objets pendant 3 s, la
   * teinte tournant comme dans le jeu original (HSV, saturation 0,7, valeur 0,6 ; un tour en 2,5 s)
   * et un fondu à la fin.
   */
  nowPlaying(text: string) {
    this.actionbarEl.textContent = text;
    this.actionTimer = 3;
    this.rainbow = 3;
    this.paintRainbow();
  }

  private paintRainbow() {
    const h = ((this.rainbow / 2.5) % 1) * 6, s = 0.7, v = 0.6;
    const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    // le jeu original éclaircit le texte de la barre d'action ; ici la teinte reste lisible sur fond clair
    const k = (x: number) => Math.round(Math.min(255, (x / v) * 255));
    this.actionbarEl.style.color = `rgb(${k(r)},${k(g)},${k(b)})`;
    this.actionbarEl.style.opacity = String(Math.min(1, this.rainbow / 1));
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
    // notification du jeu original (coin supérieur droit) : progrès = titre jaune + nom en blanc
    const m = /^🏆\s*(.+?)(?:\s+[—–-]\s+(.*))?$/u.exec(text);
    const t = m
      ? el('div', { class: `toast ${kind}`, title: m[2] ?? '' }, el('div', { class: 'toast-title' }, 'Progrès réalisé !'), el('div', { class: 'toast-text' }, m[1]))
      : el('div', { class: `toast ${kind}` }, el('div', { class: 'toast-text' }, text));
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), kind === 'achievement' ? 5000 : 3500);
  }

  private bossBar: HTMLElement;
  private bossColor: 'pink' | 'purple' = 'pink';
  /** Barre de boss du jeu original : nom blanc centré, barre 182 × 5 (rose ; violette pour le Wither). */
  setBoss(name: string | null, frac = 1, phase = 1) {
    if (!name) {
      this.boss.classList.add('hidden');
      return;
    }
    this.boss.classList.remove('hidden');
    const color = /wither/i.test(name) ? 'purple' : 'pink';
    if (color !== this.bossColor) {
      this.bossColor = color;
      this.paintBoss();
    }
    const label = phase > 1 ? `${name} (${phase})` : name;
    if (this.bossName.textContent !== label) this.bossName.textContent = label;
    // largeur en pixels d'interface entiers, comme le jeu original
    this.bossFill.style.width = `${(Math.floor(Math.max(0, Math.min(1, frac)) * 183) / 182) * 100}%`;
  }

  private paintBoss() {
    const c = this.bossColor;
    this.bossBar.style.backgroundImage = `url(${this.icons[`boss_${c}_bg`]})`;
    this.bossFill.style.backgroundImage = `url(${this.icons[`boss_${c}`]})`;
  }

  showCompass(x: number, z: number, target: string, seconds = 45) {
    const names: Record<string, string> = { spawn: "Point d'apparition", golem_lair: 'Repaire du Golem', ice_temple: 'Sanctuaire de givre', village: 'Village', death: 'Lieu de votre mort' };
    this.compassTarget = { x, z, until: performance.now() + seconds * 1000, name: names[target] ?? target, autoHide: target === 'death' };
    this.compass.classList.remove('hidden');
  }

  flashDamage() {
    this.vignette.style.opacity = '1';
    setTimeout(() => (this.vignette.style.opacity = '0'), 180);
  }

  /** Voile violet ondulant pendant le passage d'un portail (0..1). */
  setPortal(f: number) {
    this.portalFx.style.opacity = String(Math.min(0.85, f));
    this.portalFx.classList.toggle('hidden', f <= 0);
  }

  setOverlays(underwater: boolean, lava: boolean) {
    this.underwaterNow = underwater;
    this.underwater.classList.toggle('hidden', !underwater);
    this.inlava.classList.toggle('hidden', !lava);
  }

  /** Icône 9 × 9 placée en pixels d'interface ; `layers` : du dessus vers le dessous. */
  private ico(x: number, y: number, ...layers: (string | undefined)[]) {
    const bg = layers.filter(Boolean).map((u) => `url(${u})`).join(',');
    return `<i style="left:calc(var(--bs)*${(x * 1.1125).toFixed(3)});top:calc(var(--bs)*${(y * 1.1125).toFixed(3)});background-image:${bg}"></i>`;
  }

  private setRow(row: HTMLElement, key: 'hearts' | 'food' | 'armor' | 'air', sig: string, build: () => string) {
    if (this.sig[key] === sig) return;
    this.sig[key] = sig;
    row.innerHTML = build();
  }

  /**
   * Cœurs du jeu original : conteneurs, cœurs clignotants après une blessure (ancienne santé en
   * blanc pendant 1 s), cœur qui saute avec Régénération, tremblement quand la santé est basse,
   * rangées supplémentaires (absorption) qui se resserrent. Retourne le nombre de rangées.
   */
  private renderHearts(p: Session['player'], hp: number, regen: boolean) {
    const ic = this.icons;
    const max = p.maxHealth;
    const abs = Math.ceil(p.absorption);
    const maxH = Math.ceil(max / 2), absH = Math.ceil(abs / 2);
    const rows = Math.ceil((max + abs) / 2 / 10);
    const rowH = Math.max(10 - (rows - 2), 3);
    const variant = p.effects.level('wither') ? 'withered_' : p.effects.level('poison') || p.effects.level('fatal_poison') ? 'poisoned_' : '';
    const H = this.hp;
    const blink = H.blinkUntil > this.tick && Math.floor((H.blinkUntil - this.tick) / 3) % 2 === 1;
    const regenIdx = regen ? this.tick % Math.ceil(max + 5) : -1;
    const low = hp + abs <= 4;
    const items: [number, number, string[]][] = [];
    for (let i = maxH + absH - 1; i >= 0; i--) {
      const x = (i % 10) * 8;
      let y = -Math.floor(i / 10) * rowH;
      if (low) y += this.shakeH[i] ?? 0;
      if (i < maxH && i === regenIdx) y -= 2;
      const layers: string[] = [];
      if (i >= maxH) {
        const a = i * 2 - maxH * 2;
        if (a < abs) layers.push(a + 1 === abs ? 'heart_absorbing_half' : 'heart_absorbing_full');
      } else {
        if (i * 2 < hp) layers.push(`heart_${variant}${i * 2 + 1 === hp ? 'half' : 'full'}`);
        if (blink && i * 2 < H.display) layers.push(`heart_${variant}${i * 2 + 1 === H.display ? 'half' : 'full'}_blinking`);
      }
      layers.push(blink ? 'heart_container_blinking' : 'heart_container');
      items.push([x, y, layers]);
    }
    const sig = items.map(([x, y, l]) => `${x},${y},${l.join('+')}`).join(';');
    this.setRow(this.hearts, 'hearts', sig, () => items.map(([x, y, l]) => this.ico(x, y, ...l.map((k) => ic[k] ?? ic[k.replace(/(poisoned|withered|absorbing)_/, '')] ?? ic[k.replace('_blinking', '')]))).join(''));
    return { rows, rowH };
  }

  /** Faim (de droite à gauche), avec tremblement quand la saturation est nulle et effet Faim (vert). */
  private renderFood(p: Session['player']) {
    const food = Math.ceil(p.hunger);
    const hunger = p.effects.level('hunger') ? '_hunger' : '';
    const shake = p.saturation <= 0 && this.tick % (food * 3 + 1) === 0;
    const items: [number, number, string[]][] = [];
    for (let i = 0; i < 10; i++) {
      const x = 81 - i * 8 - 9;
      const y = shake ? this.shakeF[i] ?? 0 : 0;
      const l: string[] = [];
      if (i * 2 + 1 < food) l.push(`food_full${hunger}`);
      else if (i * 2 + 1 === food) l.push(`food_half${hunger}`);
      l.push(`food_empty${hunger}`);
      items.push([x, y, l]);
    }
    const sig = items.map(([x, y, l]) => `${x},${y},${l.join('+')}`).join(';');
    this.setRow(this.food, 'food', sig, () => items.map(([x, y, l]) => this.ico(x, y, ...l.map((k) => this.icons[k] ?? this.icons[k.replace('_hunger', '')]))).join(''));
  }

  private renderArmor(def: number, bottom: number) {
    this.armor.style.setProperty('--b', String(bottom));
    this.setRow(this.armor, 'armor', `${def}`, () => {
      if (def <= 0) return '';
      let html = '';
      for (let i = 0; i < 10; i++) html += this.ico(i * 8, 0, this.icons[i * 2 + 1 < def ? 'armor_full' : i * 2 + 1 === def ? 'armor_half' : 'armor_empty']);
      return html;
    });
  }

  /** Bulles d'air (1.21) : pleines, la bulle qui éclate, puis bulles vides sous l'eau. */
  private renderAir(air: number, show: boolean) {
    const full = show ? Math.max(0, Math.ceil(((air - 2) * 10) / 300)) : 0;
    const pop = show ? Math.max(0, Math.ceil((air * 10) / 300)) : 0;
    this.setRow(this.air, 'air', show ? `${full},${pop},${this.underwaterNow}` : '', () => {
      if (!show) return '';
      let html = '';
      for (let i = 1; i <= 10; i++) {
        const x = 81 - (i - 1) * 8 - 9;
        if (i <= full) html += this.ico(x, 0, this.icons.air);
        else if (i === pop && pop !== full) html += this.ico(x, 0, this.icons.air_bursting ?? this.icons.air);
        else if (this.icons.air_empty) html += this.ico(x, 0, this.icons.air_empty);
      }
      return html;
    });
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
      const src = this.textures.iconURL(iconKey(st));
      slot.append(el('img', { src, alt: '' }));
      if (hasGlint(st)) slot.append(el('div', { class: 'glint hud', style: `-webkit-mask-image:url(${src});mask-image:url(${src})` }));
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
        // écran de débogage : une ligne par fond gris translucide, comme F3
        const lines = (this.debugOn ? this.stats() : `${this.fps} FPS`).split('\n');
        this.debug.replaceChildren(...lines.map((l) => el('div', {}, l || '\u00a0')));
      } else this.debug.classList.add('hidden');
    }
    const L = this.last;
    // titres, barre d'action et coordonnées (règle showCoordinates)
    if (this.titleTimer > 0 && (this.titleTimer -= dt) <= 0) this.titleEl.textContent = this.subtitleEl.textContent = '';
    if (this.actionTimer > 0 && (this.actionTimer -= dt) <= 0) {
      this.actionbarEl.textContent = '';
      this.rainbow = 0;
      this.actionbarEl.style.color = this.actionbarEl.style.opacity = '';
    }
    if (this.rainbow > 0) {
      this.rainbow = Math.max(0, this.rainbow - dt);
      this.paintRainbow();
    }
    const showC = s.gamerules.showCoordinates;
    // coordonnées et jours joués (options « Afficher les coordonnées » / « Afficher le nombre de jours joués »)
    const showD = !!s.settings.showDaysPlayed;
    this.coordsEl.classList.toggle('hidden', !showC && !showD);
    const [lineC, lineD] = [this.coordsEl.children[0] as HTMLElement, this.coordsEl.children[1] as HTMLElement];
    lineC.style.display = showC ? '' : 'none';
    lineD.style.display = showD ? '' : 'none';
    if (showC) {
      const t = `Position : ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
      if (lineC.textContent !== t) lineC.textContent = t;
    }
    if (showD) {
      const t = `Nombre de jours joués : ${s.dayCycle.day}`;
      if (lineD.textContent !== t) lineD.textContent = t;
    }
    // sprites du pack de ressources chargé après la création du HUD (démarrage) : on les reprend
    const pk = this.textures.packImage('gui/sprites/hud/hotbar.png', 'gui/widgets.png', 'gui/icons.png') ?? null;
    if (pk !== this.packKey) {
      if (this.packKey !== undefined) this.refreshTheme();
      else {
        this.icons = buildHudSprites(this.textures);
        this.applySprites();
      }
      this.packKey = pk;
    }
    // horloge à 20 tics/s
    this.tickAcc += dt;
    let ticked = false;
    while (this.tickAcc >= 0.05) {
      this.tickAcc -= 0.05;
      this.tick++;
      ticked = true;
    }
    if (this.tickAcc > 1) this.tickAcc = 0;
    if (ticked) {
      for (let i = 0; i < 40; i++) this.shakeH[i] = Math.floor(Math.random() * 2);
      for (let i = 0; i < 10; i++) this.shakeF[i] = Math.floor(Math.random() * 3) - 1;
    }
    const hp = Math.ceil(p.health);
    const H = this.hp;
    const now = performance.now();
    if (H.last < 0) H.last = H.display = hp;
    if (hp < H.last && p.invulnerable > 0) H.blinkUntil = this.tick + 20;
    else if (hp > H.last && p.invulnerable > 0) H.blinkUntil = this.tick + 10;
    if (hp !== H.last) {
      H.changedAt = now;
      H.last = hp;
    }
    if (now - H.changedAt > 1000) {
      H.display = hp;
      H.changedAt = now;
    }
    const creative = p.creative;
    this.hearts.style.visibility = this.food.style.visibility = this.xpBg.style.visibility = this.armor.style.visibility = this.air.style.visibility = creative ? 'hidden' : '';
    this.xpLevel.style.visibility = creative ? 'hidden' : '';
    // nom de l'objet : 59 px au-dessus du bas de l'écran (14 de moins en créatif, sans barres)
    this.itemName.style.bottom = `calc(var(--bs) * ${creative ? 29 : 58})`;
    const { rows, rowH } = this.renderHearts(p, hp, p.effects.level('regeneration') > 0);
    this.renderFood(p);
    this.renderArmor(p.inventory.defense(), 36 + (rows - 1) * rowH + 10.5);
    this.air.style.setProperty('--b', String(36 + (rows - 1) * rowH + 10.5));
    this.renderAir(Math.max(0, p.air), p.air < 300 || this.underwaterNow);
    // recharge de l'attaque : petite barre sous le réticule tant que l'attaque n'est pas prête
    const cd = s.entities?.combat?.cooldown ?? 0;
    if (cd > this.attackMax || cd <= 0) this.attackMax = Math.max(0.05, cd);
    const showAtk = cd > 0.05 && !creative;
    this.attackBg.classList.toggle('hidden', !showAtk);
    if (showAtk) this.attackFill.style.width = `${Math.floor((1 - cd / this.attackMax) * 17) / 16 * 100}%`;
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
      this.itemName.textContent = st ? stackName(st) : '';
      // couleur de rareté, nom personnalisé en italique (comme le jeu original)
      this.itemName.style.color = st ? rarityColor(st) : '';
      this.itemName.style.fontStyle = st && customName(st) ? 'italic' : '';
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
    // comme le jeu original : pas d'indication permanente au centre, seulement l'interaction
    // possible avec une créature (nourrir)
    const showHint = h === 'feed' && s.game.input.mode === 'touch';
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
      const t = this.compassTarget;
      if (performance.now() > t.until || (t.autoHide && Math.hypot(t.x - p.x, t.z - p.z) < 3)) {
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
