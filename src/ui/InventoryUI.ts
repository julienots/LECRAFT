import type { Game } from '../core/Game';
import { language, t as tr } from './i18n';
import { hasGlint, iconKey, stackName } from '../inventory/StackInfo';
import { customName, enchantLines, isEnchanted } from '../inventory/Enchantments';
import { potionLine, potionOf } from '../inventory/Potions';
import { AnvilStation, BrewingStation, DispenserStation, EnchantStation, type Station, type StationHost } from './Stations';
import { BlockRegistry } from '../blocks/BlockRegistry';
import type { Session } from '../core/Session';
import { ARMOR_SLOTS, HOTBAR_SIZE, Inventory, canMerge } from '../inventory/Inventory';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ArmorSlot, ItemStack } from '../inventory/Item';
import type { CraftingRecipe } from '../crafting/Recipe';
import { CraftingGrid, type FurnaceState } from '../crafting/CraftingSystem';
import { RecipeRegistry } from '../crafting/RecipeRegistry';
import type { Screen } from './UIManager';
import { el } from './dom';
import { GUI_W, LAYOUT, containerBackground, drawFigure, drawArrow, drawFlame, drawPanel, drawSlot, guiHeight, playerInvY, type ContainerKind } from './ContainerArt';
import { pixelText } from './PixelFont';
import { CREATIVE_TABS, creativeItems, tabIcon, type CreativeTabKey } from './CreativeTabs';

export type InventoryMode = 'hand' | 'table' | 'furnace' | 'chest' | 'ender' | 'enchant' | 'anvil' | 'brewing' | 'dispenser' | 'dropper' | 'hopper';

type Group = 'main' | 'hotbar' | 'armor' | 'container' | 'grid' | 'result' | 'input' | 'fuel' | 'trash';

interface GuiSlot {
  canTake?(): boolean;
  x: number;
  y: number;
  group: Group;
  get(): ItemStack | null;
  set(s: ItemStack | null): void;
  accept?(s: ItemStack): boolean;
  max?: number;
  /** Case de résultat : on ne peut qu'y prendre l'objet (take() consomme les ingrédients). */
  take?(): void;
  big?: boolean;
  el?: HTMLElement;
  key?: string;
}

const LONG_MS = 380;
const DOUBLE_MS = 320;

/** Mémoire de l'état du livre de recettes / onglet créatif entre deux ouvertures. */
const memory = { book: false, craftableOnly: true, ctab: 'building' as CreativeTabKey, query: '' };
/** Inventaire créatif (fenêtre du jeu original : 195 × 136, onglets de 26 × 32 au-dessus et en dessous). */
const CR_W = 195, CR_H = 136, CR_TOP = 28;

/**
 * Interfaces de conteneurs fidèles aux jeux de blocs « Java » : objet tenu au curseur,
 * grille de fabrication 2x2 / 3x3, fourneau, coffre, armure, livre de recettes et inventaire créatif.
 *
 * Gestes (tactile) :
 *  - toucher : prendre / poser / échanger le stack (comme un clic gauche)
 *  - appui long : prendre la moitié / poser un seul objet (clic droit)
 *  - double toucher : transfert rapide (Maj + clic)
 *  - toucher hors de l'interface : jeter l'objet tenu
 * Souris : clic gauche, clic droit, Maj + clic.
 */
export class InventoryUI {
  readonly screen: Screen;
  private carried: ItemStack | null = null;
  private slots: GuiSlot[] = [];
  private grid: CraftingGrid | null = null;
  private furnace: FurnaceState | null = null;
  private chestInv: Inventory | null = null;
  private kind: ContainerKind;
  private wrap: HTMLElement;
  private gui: HTMLElement;
  private side: HTMLElement | null = null;
  private cursorEl: HTMLElement;
  private tooltip: HTMLElement;
  private flameCtx: CanvasRenderingContext2D | null = null;
  private arrowCtx: CanvasRenderingContext2D | null = null;
  private unsub: (() => void)[] = [];
  private timer = 0;
  private lastTap = { slot: null as GuiSlot | null, t: 0 };
  /** Instant (horodatage de l'événement) du dernier toucher transmis. */
  private eventTime: number | null = null;
  private pointer = { x: 0, y: 0 };
  private scale = 2;
  private tooltipTimer = 0;
  private disposed = false;
  /** Bloc fonctionnel (table d'enchantement, enclume, alambic, distributeur, entonnoir). */
  private station: Station | null = null;
  /** Mode créatif : inventaire créatif du jeu original à la place de l'inventaire de survie. */
  private creative = false;
  /** Taille de la fenêtre quand elle diffère d'un conteneur standard (inventaire créatif). */
  private guiW = 0;
  private guiH = 0;
  private crList: HTMLElement | null = null;
  private crThumb: HTMLCanvasElement | null = null;

  constructor(private game: Game, private s: Session, private mode: InventoryMode, pos?: { x: number; y: number; z: number }) {
    const pinv = s.player.inventory;
    this.kind = mode === 'hand' ? 'inventory' : mode === 'ender' ? 'chest' : mode === 'dropper' ? 'dispenser' : mode;
    if (mode === 'chest' && pos) this.chestInv = s.world.getChest(pos.x, pos.y, pos.z);
    if (mode === 'ender') this.chestInv = s.player.enderChest;
    if (pos) this.station = this.makeStation(mode, pos);
    if (mode === 'furnace' && pos) this.furnace = s.world.getFurnace(pos.x, pos.y, pos.z);
    this.creative = mode === 'hand' && s.player.creative;
    if (mode === 'hand' && !this.creative) this.grid = new CraftingGrid(2);
    if (mode === 'table') this.grid = new CraftingGrid(3);
    const blockName = pos ? BlockRegistry.get(s.world.getBlock(pos.x, pos.y, pos.z)).name : '';
    const title = this.station?.title ?? (mode === 'ender' ? "Coffre de l'Ender" : mode === 'chest' ? (blockName && !/^Coffre/.test(blockName) ? blockName : 'Coffre') : mode === 'table' ? 'Fabrication' : mode === 'furnace' ? 'Fourneau' : '');
    const h = guiHeight(this.kind);

    if (this.creative) {
      this.guiW = CR_W;
      this.guiH = CR_TOP * 2 + CR_H;
    }
    this.gui = el('div', { class: 'gui', style: `width:${this.guiW || GUI_W}px;height:${this.guiH || h}px` });
    if (this.creative) this.buildCreativeScreen();
    else this.buildContainer(pinv, mode, title);
    this.wrap = el('div', { class: 'gui-wrap' }, this.gui);
    this.cursorEl = el('div', { class: 'gui-cursor' });
    this.tooltip = el('div', { class: 'gui-tooltip' });
    const root = el('div', { class: 'screen gui-screen' }, this.wrap, this.cursorEl, this.tooltip);
    // toucher hors de l'interface : jette l'objet tenu (comme en dehors de la fenêtre)
    root.addEventListener('pointerup', (e) => {
      if (e.target !== root) return;
      if (this.carried) {
        const st = this.carried;
        this.carried = null;
        if (e.button === 2 && st.count > 1) {
          this.s.throwStack({ ...st, count: 1 });
          this.carried = { ...st, count: st.count - 1 };
        } else this.s.throwStack(st);
        this.refresh();
      } else this.game.closeInventory();
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      this.placeCursor();
      this.dragOver(e.clientX, e.clientY);
    });
    this.screen = { el: root, onBack: () => (game.closeInventory(), true) };
    this.buildSide();

    const refresh = () => this.refresh();
    this.unsub.push(pinv.onChange(refresh));
    if (this.chestInv) this.unsub.push(this.chestInv.onChange(refresh));
    const onResize = () => this.layout();
    window.addEventListener('resize', onResize);
    this.unsub.push(() => window.removeEventListener('resize', onResize));
    if (this.furnace || this.station?.ticking) this.timer = window.setInterval(() => this.refresh(), 100);
    requestAnimationFrame(() => this.layout());
    this.layout();
    this.refresh();
  }

  // ---------- construction ----------

  /** Interface d'un conteneur ordinaire (inventaire de survie, coffre, fourneau, stations…). */
  private buildContainer(pinv: Inventory, mode: InventoryMode, title: string) {
    const bg = containerBackground(this.kind, title, this.game.textures, 3, `player_${this.game.settings.playerSkin ?? 'steve'}`, this.station?.artSlots ?? []);
    bg.className = 'gui-bg';
    this.gui.append(bg);
    this.buildSlots(pinv);
    for (const sl of this.slots) this.gui.append(this.slotEl(sl));
    this.station?.decorate(this.gui);
    if (this.furnace) {
      const L = LAYOUT.furnace;
      const fc = this.canvasAt(L.flame[0], L.flame[1], 14, 14);
      const ac = this.canvasAt(L.arrow[0], L.arrow[1], 24, 17);
      this.flameCtx = fc.getContext('2d');
      this.arrowCtx = ac.getContext('2d');
      this.gui.append(fc, ac);
    }
    if (this.grid) {
      const [ax, ay] = this.kind === 'inventory' ? LAYOUT.inventory.arrow : LAYOUT.table.arrow;
      if (!this.game.textures.packImage(`gui/container/${this.kind === 'inventory' ? 'inventory' : 'crafting_table'}.png`)) {
        const c = this.canvasAt(ax, ay, 22, 15);
        drawArrow(c.getContext('2d')!, 0, 0, 0);
        this.gui.append(c);
      }
    }
    // bouton du livre de recettes / de l'inventaire créatif
    if (mode === 'hand' || mode === 'table' || mode === 'furnace') {
      const [bx, by] = mode === 'hand' ? LAYOUT.inventory.book : mode === 'table' ? LAYOUT.table.book : LAYOUT.furnace.book;
      const btn = this.canvasAt(bx, by, 20, 18);
      this.drawBookButton(btn.getContext('2d')!);
      btn.classList.add('gui-btn');
      btn.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        memory.book = !memory.book;
        this.click();
        this.buildSide();
        this.layout();
      });
      this.gui.append(btn);
    }

  }
  private makeStation(mode: InventoryMode, pos: { x: number; y: number; z: number }): Station | null {
    const host: StationHost = { game: this.game, s: this.s, refresh: () => this.refresh(), click: () => this.click(), canvasAt: (x, y, w, h) => this.canvasAt(x, y, w, h) };
    const w = this.s.world;
    if (mode === 'enchant') return new EnchantStation(host, pos);
    if (mode === 'anvil') return new AnvilStation(host, pos);
    if (mode === 'brewing') return new BrewingStation(host, w.getBrewing(pos.x, pos.y, pos.z)!);
    if (mode === 'dispenser' || mode === 'dropper') return new DispenserStation(host, w.getChest(pos.x, pos.y, pos.z, true, 9)!, mode === 'dropper' ? 'Dropper' : 'Distributeur', false);
    if (mode === 'hopper') return new DispenserStation(host, w.getChest(pos.x, pos.y, pos.z, true, 5)!, 'Entonnoir', true);
    return null;
  }

  private canvasAt(x: number, y: number, w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.className = 'gui-layer';
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    return c;
  }

  private drawBookButton(ctx: CanvasRenderingContext2D) {
    drawPanel(ctx, 0, 0, 20, 18);
    const px = (x: number, y: number, w: number, h: number, c: string) => ((ctx.fillStyle = c), ctx.fillRect(x, y, w, h));
    px(5, 4, 10, 11, '#2f6b2a');
    px(6, 5, 8, 9, '#4f9a3a');
    px(13, 5, 1, 9, '#e8e8d8');
    px(7, 7, 4, 1, '#a8d870');
    px(7, 9, 4, 1, '#a8d870');
  }

  private playerSlots(pinv: Inventory) {
    const py = playerInvY(this.kind);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 9; c++) {
        const i = HOTBAR_SIZE + r * 9 + c;
        this.slots.push({ x: 8 + c * 18, y: py + r * 18, group: 'main', get: () => pinv.slots[i], set: (v) => (pinv.slots[i] = v), key: `inv${i}` });
      }
    for (let c = 0; c < 9; c++) this.slots.push({ x: 8 + c * 18, y: py + 58, group: 'hotbar', get: () => pinv.slots[c], set: (v) => (pinv.slots[c] = v), key: `inv${c}` });
  }

  private buildSlots(pinv: Inventory) {
    const s = this.slots;
    if (this.kind === 'inventory') {
      LAYOUT.inventory.armor.forEach(([x, y], i) => {
        const a: ArmorSlot = ARMOR_SLOTS[i];
        s.push({ x, y, group: 'armor', max: 1, get: () => pinv.armor[a], set: (v) => (pinv.armor[a] = v), accept: (st) => ItemRegistry.get(st.id)?.armor?.slot === a, key: `armor_${a}` });
      });
    }
    if (this.grid) {
      const g = this.grid;
      const pos = this.kind === 'inventory' ? LAYOUT.inventory : LAYOUT.table;
      pos.grid.forEach(([x, y], i) => s.push({ x, y, group: 'grid', get: () => g.slots[i], set: (v) => (g.slots[i] = v), key: `grid${i}` }));
      s.push({ x: pos.result[0], y: pos.result[1], group: 'result', big: this.kind === 'table', get: () => g.result, set: () => {}, take: () => this.onCraft(), key: 'result' });
    }
    if (this.furnace) {
      const f = this.furnace;
      const L = LAYOUT.furnace;
      s.push({ x: L.input[0], y: L.input[1], group: 'input', get: () => f.input, set: (v) => (f.input = v), key: 'f_in' });
      s.push({ x: L.fuel[0], y: L.fuel[1], group: 'fuel', get: () => f.fuel, set: (v) => (f.fuel = v), accept: (st) => (ItemRegistry.get(st.id)?.burnTime ?? 0) > 0 || st.id === 'bucket', key: 'f_fuel' });
      s.push({
        x: L.result[0], y: L.result[1], group: 'result', big: true,
        get: () => f.output,
        set: (v) => (f.output = v),
        take: () => {
          f.output = null;
          if (f.xp >= 1) {
            this.s.player.addXp(Math.floor(f.xp));
            f.xp -= Math.floor(f.xp);
            this.game.audio.play('xp', { volume: 0.5 });
          }
        },
        key: 'f_out',
      });
    }
    if (this.station)
      for (const st of this.station.slots)
        s.push({ x: st.x, y: st.y, group: st.take ? 'result' : 'container', big: st.big, max: st.max, get: st.get, set: st.set, accept: st.accept, take: st.take, canTake: st.canTake, key: st.key });
    if (this.chestInv) {
      const ci = this.chestInv;
      for (let i = 0; i < ci.size; i++) s.push({ x: 8 + (i % 9) * 18, y: 18 + Math.floor(i / 9) * 18, group: 'container', get: () => ci.slots[i], set: (v) => (ci.slots[i] = v), key: `chest${i}` });
    }
    this.playerSlots(pinv);
  }

  private slotEl(sl: GuiSlot): HTMLElement {
    const size = sl.big ? 26 : 18;
    const o = (size - 16) / 2;
    const d = el('div', { class: 'gslot', style: `left:${sl.x - o}px;top:${sl.y - o}px;width:${size}px;height:${size}px` });
    if (sl.big) d.style.padding = `${o}px`;
    sl.el = d;
    if (sl.key) d.dataset.key = sl.key;
    this.bindPress(d, (kind) => this.onSlot(sl, kind), sl);
    this.slotByEl.set(d, sl);
    return d;
  }

  // ---------- glisser pour répartir (comme le glisser du jeu de référence) ----------
  private slotByEl = new WeakMap<Element, GuiSlot>();
  private drag: { slots: GuiSlot[]; one: boolean; firstDone?: boolean } | null = null;

  private dragOver(x: number, y: number) {
    if (!this.drag || !this.carried) return;
    let e = document.elementFromPoint(x, y);
    while (e && !this.slotByEl.has(e)) e = e.parentElement;
    const sl = e ? this.slotByEl.get(e) : undefined;
    if (!sl || sl.take || this.drag.slots.includes(sl)) return;
    const cur = sl.get();
    if (sl.accept && !sl.accept(this.carried)) return;
    if (cur && !canMerge(cur, this.carried)) return;
    if (this.drag.slots.length >= this.carried.count && !this.drag.one) return;
    this.drag.slots.push(sl);
    for (const d of this.drag.slots) d.el?.classList.add('dragged');
  }

  /** Termine un glisser sur plusieurs cases ; retourne vrai s'il a eu lieu. */
  private finishDrag(): boolean {
    const d = this.drag;
    this.drag = null;
    this.slots.forEach((s) => s.el?.classList.remove('dragged'));
    if (!d || d.slots.length < 2 || !this.carried) return false;
    const c = this.carried;
    const per = d.one ? 1 : Math.max(1, Math.floor(c.count / d.slots.length));
    for (const [i, sl] of d.slots.entries()) {
      if (c.count <= 0) break;
      if (i === 0 && d.firstDone) continue;
      const cur = sl.get();
      const room = cur ? this.maxFor(sl, cur) - cur.count : this.maxFor(sl, c);
      const k = Math.min(per, room, c.count);
      if (k <= 0) continue;
      if (cur) cur.count += k;
      else sl.set({ ...c, count: k });
      c.count -= k;
    }
    if (c.count <= 0) this.carried = null;
    this.lastTap.slot = null;
    this.click();
    this.afterChange();
    return true;
  }

  /** Gestion unifiée toucher / souris : 'tap' | 'long' | 'double' | 'right' | 'shift'. */
  private bindPress(d: HTMLElement, cb: (kind: 'tap' | 'long' | 'double' | 'right' | 'shift', e: PointerEvent) => void, target?: GuiSlot) {
    let t = 0;
    let fired = false;
    let downAt = 0;
    let released = false;
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.pointer = { x: e.clientX, y: e.clientY };
      fired = false;
      // horodatages réels des événements (une image en retard ne fausse pas la durée)
      downAt = e.timeStamp;
      if (target && !target.take && this.carried) this.drag = { slots: [target], one: e.button === 2 };
      if (e.pointerType === 'mouse') return;
      released = false;
      // le minuteur peut passer avant un relâchement déjà en file (image lente) : on laisse
      // d'abord passer les événements en attente, puis on vérifie que le doigt est toujours posé
      t = window.setTimeout(() => (t = window.setTimeout(() => {
        if (released) return;
        if (this.drag && this.drag.slots.length >= 2) return;
        // appui long sans glisser : clic droit ; s'il y a ensuite un glisser, il dépose un objet par case
        if (this.drag) {
          this.drag.one = true;
          this.drag.firstDone = true;
        }
        fired = true;
        cb('long', e);
        this.game.platform.haptic('light');
      }, 0)), LONG_MS);
    });
    const cancel = () => clearTimeout(t);
    d.addEventListener('pointerleave', cancel);
    d.addEventListener('pointercancel', cancel);
    d.addEventListener('pointerup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      released = true;
      clearTimeout(t);
      if (this.finishDrag()) return;
      if (fired) return;
      if (e.pointerType === 'mouse') {
        if (e.button === 2) cb('right', e);
        else if (e.shiftKey) cb('shift', e);
        else cb('tap', e);
        return;
      }
      if (e.timeStamp - downAt > LONG_MS) return;
      this.eventTime = e.timeStamp;
      cb('tap', e);
    });
    void target;
  }

  // ---------- logique des cases ----------
  private maxFor(sl: GuiSlot, st: ItemStack) {
    return Math.min(sl.max ?? 64, ItemRegistry.maxStack(st.id));
  }

  private onSlot(sl: GuiSlot, kind: 'tap' | 'long' | 'double' | 'right' | 'shift') {
    // double toucher mesuré entre les instants réels des touchers
    const now = this.eventTime ?? performance.now();
    this.eventTime = null;
    if (kind === 'tap' && this.lastTap.slot === sl && now - this.lastTap.t < DOUBLE_MS) {
      // le premier toucher a déjà pris/posé le stack : on l'annule avant le transfert rapide
      this.lastTap.slot = null;
      this.undoLast?.();
      kind = 'double';
    } else if (kind === 'tap') this.lastTap = { slot: sl, t: now };
    this.undoLast = null;
    // corbeille de l'inventaire créatif : Maj + clic (double toucher) vide tout l'inventaire
    if (sl.key === 'trash' && (kind === 'double' || kind === 'shift')) {
      const inv = this.s.player.inventory;
      inv.slots.fill(null);
      for (const a of ARMOR_SLOTS) inv.armor[a] = null;
      inv.changed();
      this.carried = null;
      this.afterChange();
      return;
    }
    if (kind === 'double' || kind === 'shift') this.quickMove(sl);
    else if (sl.take) this.takeResult(sl);
    else if (kind === 'tap') this.leftClick(sl);
    else this.rightClick(sl);
    this.afterChange();
    this.showTooltip(sl);
  }
  private undoLast: (() => void) | null = null;

  private leftClick(sl: GuiSlot) {
    const cur = sl.get();
    const before = { slot: cur ? { ...cur } : null, carried: this.carried ? { ...this.carried } : null };
    this.undoLast = () => {
      sl.set(before.slot);
      this.carried = before.carried;
    };
    if (!this.carried) {
      if (cur) {
        this.carried = cur;
        sl.set(null);
        this.click();
      }
      return;
    }
    if (sl.accept && !sl.accept(this.carried)) return;
    if (!cur) {
      const n = Math.min(this.carried.count, this.maxFor(sl, this.carried));
      sl.set({ ...this.carried, count: n });
      this.carried.count -= n;
      if (this.carried.count <= 0) this.carried = null;
    } else if (canMerge(cur, this.carried)) {
      const n = Math.min(this.carried.count, this.maxFor(sl, cur) - cur.count);
      cur.count += n;
      this.carried.count -= n;
      if (this.carried.count <= 0) this.carried = null;
    } else if (this.carried.count <= this.maxFor(sl, this.carried)) {
      sl.set(this.carried);
      this.carried = cur;
    }
    this.click();
  }

  private rightClick(sl: GuiSlot) {
    const cur = sl.get();
    if (!this.carried) {
      if (!cur) return;
      const half = Math.ceil(cur.count / 2);
      this.carried = { ...cur, count: half };
      cur.count -= half;
      if (cur.count <= 0) sl.set(null);
      this.click();
      return;
    }
    if (sl.accept && !sl.accept(this.carried)) return;
    if (!cur) sl.set({ ...this.carried, count: 1 });
    else if (canMerge(cur, this.carried) && cur.count < this.maxFor(sl, cur)) cur.count++;
    else return this.leftClick(sl);
    this.carried.count--;
    if (this.carried.count <= 0) this.carried = null;
    this.click();
  }

  private takeResult(sl: GuiSlot) {
    const r = sl.get();
    if (!r) return;
    if (sl.canTake && !sl.canTake()) return;
    if (this.carried && !(canMerge(this.carried, r) && this.carried.count + r.count <= ItemRegistry.maxStack(r.id))) return;
    if (this.carried) this.carried.count += r.count;
    else this.carried = { ...r };
    sl.take!();
    // double toucher : ce qui vient d'être pris rejoint l'inventaire avant de tout fabriquer
    this.undoLast = () => {
      const c = this.carried;
      if (!c) return;
      const left = this.insert(c, this.group('hotbar', 'main'), true);
      this.carried = left > 0 ? { ...c, count: left } : null;
    };
  }

  /** Transfert rapide (Maj + clic) entre les zones, comme dans le jeu de référence. */
  private quickMove(sl: GuiSlot) {
    if (sl.take) {
      // fabrique autant que possible directement dans l'inventaire
      for (let n = 0; n < 64; n++) {
        const r = sl.get();
        if (!r) break;
        if (!this.fits(r, this.group('main', 'hotbar'))) break;
        this.insert({ ...r }, this.group('hotbar', 'main'), true);
        sl.take!();
        if (sl.group === 'result' && this.furnace) break;
      }
      return;
    }
    const st = sl.get();
    if (!st) return;
    let targets: GuiSlot[];
    const def = ItemRegistry.get(st.id);
    if (sl.group === 'main' || sl.group === 'hotbar') {
      if (this.chestInv || this.station) targets = this.group('container');
      else if (this.furnace) targets = RecipeRegistry.smeltingFor(st.id) ? this.group('input') : (def?.burnTime ?? 0) > 0 ? this.group('fuel') : this.group(sl.group === 'main' ? 'hotbar' : 'main');
      else if (def?.armor && this.group('armor').some((a) => a.accept!(st) && !a.get())) targets = this.group('armor');
      else targets = this.group(sl.group === 'main' ? 'hotbar' : 'main');
    } else targets = this.group('main', 'hotbar');
    const left = this.insert(st, targets, sl.group !== 'main' && sl.group !== 'hotbar');
    if (left <= 0) sl.set(null);
    else st.count = left;
    this.click();
  }

  private group(...g: Group[]): GuiSlot[] {
    return g.flatMap((k) => this.slots.filter((s) => s.group === k));
  }

  private fits(st: ItemStack, slots: GuiSlot[]): boolean {
    let room = 0;
    for (const s of slots) {
      const c = s.get();
      if (!c) room += ItemRegistry.maxStack(st.id);
      else if (canMerge(c, st)) room += ItemRegistry.maxStack(st.id) - c.count;
      if (room >= st.count) return true;
    }
    return false;
  }

  /** Range un stack dans des cases (complète d'abord, puis cases vides) ; retourne le reste. */
  private insert(st: ItemStack, slots: GuiSlot[], reverse = false): number {
    let n = st.count;
    const list = reverse ? [...slots].reverse() : slots;
    for (const s of list) {
      const c = s.get();
      if (n <= 0) break;
      if (c && canMerge(c, st)) {
        const k = Math.min(n, this.maxFor(s, c) - c.count);
        if (k > 0) {
          c.count += k;
          n -= k;
        }
      }
    }
    for (const s of list) {
      if (n <= 0) break;
      if (s.get() || (s.accept && !s.accept(st))) continue;
      const k = Math.min(n, this.maxFor(s, st));
      s.set({ ...st, count: k });
      n -= k;
    }
    return n;
  }

  private onCraft() {
    const g = this.grid!;
    const r = g.recipe;
    if (!r) return;
    g.consume();
    this.s.progression.inc(`craft:${r.result.item}`, r.result.count);
    this.s.progression.check(this.s.player.level);
    this.game.audio.play('click', { volume: 0.5, pitch: 1.2 });
  }

  private afterChange() {
    this.s.player.inventory.changed();
    this.chestInv?.changed();
    this.refresh();
  }

  private click() {
    this.game.audio.play('click', { volume: 0.25, pitch: 1.4 });
  }

  // ---------- rendu ----------
  private stackHTML(d: HTMLElement, st: ItemStack | null) {
    d.replaceChildren();
    if (!st) return;
    const src = this.game.textures.iconURL(iconKey(st));
    d.append(el('img', { class: 'gicon', src, alt: '', draggable: 'false' }));
    // reflet limité à la forme de l'objet (masque = icône)
    if (hasGlint(st)) d.append(el('div', { class: 'glint', style: `-webkit-mask-image:url(${src});mask-image:url(${src});mask-size:16px 16px` }));
    if (st.count > 1) {
      const t = pixelText(String(st.count), { color: '#ffffff', shadow: '#3f3f3f', cls: 'gcount' });
      d.append(t);
    }
    const max = ItemRegistry.maxDurability(st.id);
    if (st.durability !== undefined && max > 0 && st.durability < max) {
      const f = st.durability / max;
      d.append(el('div', { class: 'gdur' }, el('div', { style: `width:${Math.round(f * 13)}px;background:hsl(${f * 120},100%,50%)` })));
    }
  }

  private refresh() {
    if (this.disposed) return;
    for (const sl of this.slots) {
      const st = sl.get();
      const sig = st ? `${st.id}:${st.count}:${st.durability ?? ''}${st.meta ? JSON.stringify(st.meta) : ''}` : '';
      if (sl.el!.dataset.sig !== sig) {
        sl.el!.dataset.sig = sig;
        this.stackHTML(sl.el!, st);
      }
    }
    this.stackHTML(this.cursorEl, this.carried);
    this.placeCursor();
    if (this.furnace && this.flameCtx && this.arrowCtx) {
      const f = this.furnace;
      const fc = this.flameCtx, ac = this.arrowCtx;
      fc.clearRect(0, 0, 14, 14);
      ac.clearRect(0, 0, 24, 17);
      const flame = f.burnMax > 0 ? f.burn / f.burnMax : 0;
      const prog = f.input ? f.cook / (RecipeRegistry.smeltingFor(f.input.id)?.time ?? 10) : 0;
      const sprites = this.game.textures;
      const lit = sprites.packImage('gui/sprites/container/furnace/lit_progress.png');
      const burn = sprites.packImage('gui/sprites/container/furnace/burn_progress.png');
      const legacy = sprites.packImage('gui/container/furnace.png');
      if (lit && burn) {
        const h = Math.round(14 * flame);
        if (h > 0) fc.drawImage(lit, 0, (lit.height * (14 - h)) / 14, lit.width, (lit.height * h) / 14, 0, 14 - h, 14, h);
        const w = Math.round(24 * prog);
        if (w > 0) ac.drawImage(burn, 0, 0, (burn.width * w) / 24, burn.height, 0, 0, w, 17);
      } else if (legacy) {
        const k = legacy.width / 256;
        const h = Math.round(14 * flame);
        if (h > 0) fc.drawImage(legacy, 176 * k, (14 - h) * k, 14 * k, h * k, 0, 14 - h, 14, h);
        const w = Math.round(24 * prog);
        if (w > 0) ac.drawImage(legacy, 176 * k, 14 * k, w * k, 17 * k, 0, 0, w, 17);
      } else {
        drawFlame(fc, 0, 0, flame);
        drawArrow(ac, 0, 1, prog);
      }
    }
    this.station?.update();
    if (this.side && (this.mode === 'hand' || this.mode === 'table' || this.mode === 'furnace') && memory.book && !this.s.player.creative) this.refreshBook();
  }

  private placeCursor() {
    const k = this.scale;
    this.cursorEl.style.transform = `translate(${this.pointer.x - 8 * k}px, ${this.pointer.y - 8 * k}px) scale(${k})`;
    this.cursorEl.style.display = this.carried ? 'block' : 'none';
  }

  private showTooltip(sl: GuiSlot) {
    const st = sl.get() ?? null;
    clearTimeout(this.tooltipTimer);
    this.tooltip.replaceChildren();
    if (!st || this.carried) {
      this.tooltip.style.display = 'none';
      return;
    }
    const def = ItemRegistry.get(st.id);
    if (!def) return;
    const named = !!customName(st);
    const lines: [string, string][] = [[stackName(st), named ? '#55ffff' : def.rare || isEnchanted(st) ? '#ffff55' : '#ffffff']];
    for (const t of enchantLines(st)) lines.push([t, '#aaaaaa']);
    const pl = potionOf(st) ? potionLine(st) : null;
    if (pl) lines.push([pl, '#5555ff']);
    // boîte de shulker remplie : aperçu du contenu
    const inside = (st.meta?.items as (ItemStack | null)[] | undefined)?.filter((x): x is ItemStack => !!x) ?? [];
    for (const it of inside.slice(0, 5)) lines.push([`${stackName(it)} x${it.count}`, '#aaaaaa']);
    if (inside.length > 5) lines.push([`et ${inside.length - 5} autres…`, '#aaaaaa']);
    const en = language() === 'en';
    if (def.food) lines.push([en ? `Food: +${def.food.hunger}` : `Nourriture : +${def.food.hunger}`, '#aaaaaa']);
    if (def.damage && def.tool) lines.push([en ? `${def.damage} Attack Damage` : `${def.damage} de dégâts d'attaque`, '#00aa00']);
    if (def.armor) lines.push([en ? `+${def.armor.defense} Armor` : `+${def.armor.defense} d'armure`, '#5555ff']);
    if (st.durability !== undefined) lines.push([en ? `Durability: ${st.durability} / ${ItemRegistry.maxDurability(st.id)}` : `Durabilité : ${st.durability} / ${ItemRegistry.maxDurability(st.id)}`, '#aaaaaa']);
    if (def.description && !en) lines.push([def.description, '#aaaaaa']);
    for (const [t, c] of lines) this.tooltip.append(el('div', {}, pixelText(t, { color: c, shadow: '#3f3f3f', px: this.scale })));
    const r = sl.el!.getBoundingClientRect();
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${Math.min(window.innerWidth - 10, r.right + 4)}px`;
    this.tooltip.style.top = `${Math.max(4, r.top - 12 * this.scale)}px`;
    requestAnimationFrame(() => {
      const tr = this.tooltip.getBoundingClientRect();
      if (tr.right > window.innerWidth - 4) this.tooltip.style.left = `${Math.max(4, r.left - tr.width - 4)}px`;
    });
    this.tooltipTimer = window.setTimeout(() => (this.tooltip.style.display = 'none'), 2200);
  }

  /** Mise à l'échelle entière si possible (pixels nets), centrée. */
  private layout() {
    const sideW = this.side ? this.side.offsetWidth / (this.scale || 1) || 0 : 0;
    const w = (this.guiW || GUI_W) + (this.side ? (parseFloat(this.side.dataset.w ?? '0') || sideW) + 2 : 0);
    const h = this.guiH || guiHeight(this.kind);
    const fit = Math.min((window.innerWidth - 16) / w, (window.innerHeight - 12) / h);
    const k = fit >= 2 ? Math.floor(fit * 2) / 2 : Math.max(1, fit);
    this.scale = k;
    this.wrap.style.transform = `scale(${k})`;
    this.wrap.style.width = `${w}px`;
    this.wrap.style.height = `${h}px`;
    this.wrap.style.left = `${Math.round((window.innerWidth - w * k) / 2)}px`;
    this.wrap.style.top = `${Math.round((window.innerHeight - h * k) / 2)}px`;
  }

  // ---------- panneau latéral : livre de recettes / créatif ----------
  private buildSide() {
    this.side?.remove();
    this.side = null;
    if (!memory.book || !(this.mode === 'hand' || this.mode === 'table' || this.mode === 'furnace')) return;
    if (this.creative) return;
    const w = 147;
    const h = guiHeight(this.kind);
    const side = el('div', { class: 'gui-side', style: `width:${w}px;height:${h}px` });
    side.dataset.w = String(w);
    const bg = document.createElement('canvas');
    bg.width = w;
    bg.height = h;
    bg.className = 'gui-bg';
    drawPanel(bg.getContext('2d')!, 0, 0, w, h);
    side.append(bg);
    this.wrap.prepend(side);
    this.side = side;
    this.buildBook(side, w, h);
  }


  // ---------- inventaire créatif (comme le jeu original) ----------
  private buildCreativeScreen() {
    const tm = this.game.textures;
    const gui = this.gui;
    gui.replaceChildren();
    this.slots = [];
    this.crList = null;
    this.crThumb = null;
    const pinv = this.s.player.inventory;
    const cur = CREATIVE_TABS.find((t) => t.key === memory.ctab) ?? CREATIVE_TABS[0];
    const Y = CR_TOP;
    // onglets : non sélectionnés derrière la fenêtre, sélectionné devant
    const tabEl = (t: (typeof CREATIVE_TABS)[number]) => {
      const sel = t === cur;
      const x = t.right ? CR_W - 27 * (7 - t.col) + 1 : 27 * t.col;
      const y = t.row === 'top' ? Y - 28 : Y + CR_H - 4;
      const c = this.canvasAt(x, y, 26, 32);
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      const img = tm.packImage(`gui/sprites/container/creative_inventory/tab_${t.row}_${sel ? 'selected' : 'unselected'}_${t.col + 1}.png`);
      if (img) g.drawImage(img, 0, 0, 26, 32);
      else drawPanel(g, 0, t.row === 'top' ? 0 : 0, 26, 32);
      c.classList.add('gui-btn', 'cr-tab');
      c.dataset.tab = t.key;
      c.title = tr(t.name);
      const icon = el('img', { class: 'gui-layer', src: tm.iconURL(tabIcon(t)), alt: '', style: `left:${x + 5}px;top:${y + (t.row === 'top' ? 9 : 7)}px;width:16px;height:16px;image-rendering:pixelated;pointer-events:none` });
      const pick = (e: Event) => {
        e.stopPropagation();
        if (memory.ctab === t.key) return;
        memory.ctab = t.key;
        this.click();
        this.buildCreativeScreen();
        this.refresh();
      };
      c.addEventListener('pointerup', pick);
      return [c, icon];
    };
    for (const t of CREATIVE_TABS) if (t !== cur) gui.append(...tabEl(t));
    // fond de la fenêtre (texture du pack, sinon panneau dessiné)
    const bg = this.canvasAt(0, Y, CR_W, CR_H);
    bg.className = 'gui-bg';
    bg.style.top = `${Y}px`;
    bg.style.left = '0px';
    const ctx = bg.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const file = cur.key === 'search' ? 'tab_item_search' : cur.key === 'inventory' ? 'tab_inventory' : 'tab_items';
    const img = tm.packImage(`gui/container/creative_inventory/${file}.png`);
    if (img) {
      const k = img.width / 256;
      ctx.drawImage(img, 0, 0, CR_W * k, CR_H * k, 0, 0, CR_W, CR_H);
    } else {
      drawPanel(ctx, 0, 0, CR_W, CR_H);
      if (cur.key !== 'inventory') for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) drawSlot(ctx, 8 + c * 18, 17 + r * 18);
      for (let c = 0; c < 9; c++) drawSlot(ctx, 8 + c * 18, 111);
      if (cur.key === 'inventory') drawSlot(ctx, 172, 111);
    }
    // onglet survie : le joueur dans son cadre (comme le jeu original)
    if (cur.key === 'inventory') {
      if (!img) {
        ctx.fillStyle = '#000';
        ctx.fillRect(73, 6, 32, 43);
      }
      drawFigure(ctx, 79, 7, tm.skin(`player_${this.game.settings.playerSkin ?? 'steve'}`).image as HTMLCanvasElement, 1.3);
    }
    gui.append(bg);
    gui.append(...tabEl(cur));
    // barre d'objets (toujours visible) et corbeille
    for (let c = 0; c < 9; c++) this.slots.push({ x: 9 + c * 18, y: Y + 112, group: 'hotbar', get: () => pinv.slots[c], set: (v) => (pinv.slots[c] = v), key: `inv${c}` });
    // corbeille : seulement dans l'onglet « Inventaire de survie » (ailleurs, l'ascenseur occupe la place
    // et on supprime un objet en le reposant sur la grille, comme le jeu original)
    if (cur.key === 'inventory') this.slots.push({ x: 173, y: Y + 112, group: 'trash', get: () => null, set: () => {}, key: 'trash' });
    if (!img && cur.key === 'inventory') {
      const tc = this.canvasAt(173, Y + 112, 16, 16);
      const g = tc.getContext('2d')!;
      g.fillStyle = '#b02020';
      g.fillRect(3, 3, 10, 2);
      g.fillRect(5, 5, 6, 8);
      tc.style.pointerEvents = 'none';
      gui.append(tc);
    }
    if (cur.key === 'inventory') {
      // onglet « Inventaire de survie » : armure et inventaire complet
      const armorPos: [number, number][] = [[54, 6], [54, 33], [108, 6], [108, 33]];
      ARMOR_SLOTS.forEach((a, i) => {
        const [x, y] = armorPos[i];
        this.slots.push({ x, y: Y + y, group: 'armor', max: 1, get: () => pinv.armor[a], set: (v) => (pinv.armor[a] = v), accept: (st) => ItemRegistry.get(st.id)?.armor?.slot === a, key: `armor_${a}` });
      });
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 9; c++) {
          const i = HOTBAR_SIZE + r * 9 + c;
          this.slots.push({ x: 9 + c * 18, y: Y + 54 + r * 18, group: 'main', get: () => pinv.slots[i], set: (v) => (pinv.slots[i] = v), key: `inv${i}` });
        }
    } else {
      // titre de l'onglet
      if (cur.key !== 'search') {
        const label = pixelText(tr(cur.name), { color: '#404040', cls: 'gui-abs' });
        label.style.left = '8px';
        label.style.top = `${Y + 6}px`;
        gui.append(label);
      } else {
        const input = el('input', { class: 'cr-search', type: 'text', value: memory.query, placeholder: '', spellcheck: 'false', style: `left:82px;top:${Y + 6}px;width:89px;height:9px` }) as HTMLInputElement;
        input.addEventListener('input', () => {
          memory.query = input.value;
          this.fillCreativeList();
        });
        // les touches tapées ne doivent pas commander le jeu (E, Échap…)
        input.addEventListener('keydown', (e) => e.stopPropagation());
        input.addEventListener('pointerup', (e) => e.stopPropagation());
        gui.append(input);
      }
      // grille de 9 × 5 cases qui défile, et son ascenseur
      const list = el('div', { class: 'gui-scroll cr-grid', style: `left:8px;top:${Y + 17}px;width:${9 * 18}px;height:${5 * 18}px` });
      list.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        if (e.target === list && this.carried) {
          this.carried = null;
          this.refresh();
        }
      });
      list.addEventListener('scroll', () => this.placeThumb());
      gui.append(list);
      this.crList = list;
      const track = el('div', { class: 'gui-layer cr-track', style: `left:175px;top:${Y + 18}px;width:12px;height:112px` });
      const thumb = this.canvasAt(175, Y + 18, 12, 15);
      thumb.style.pointerEvents = 'none';
      this.crThumb = thumb;
      const scrollTo = (clientY: number) => {
        const r = track.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (clientY - r.top - (r.height * 7.5) / 112) / (r.height * (97 / 112))));
        list.scrollTop = f * Math.max(0, list.scrollHeight - list.clientHeight);
      };
      let dragging = false;
      track.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        dragging = true;
        track.setPointerCapture(e.pointerId);
        scrollTo(e.clientY);
      });
      track.addEventListener('pointermove', (e) => dragging && scrollTo(e.clientY));
      track.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        dragging = false;
      });
      gui.append(track, thumb);
      this.fillCreativeList();
    }
    for (const sl of this.slots) gui.append(this.slotEl(sl));
  }

  /** Remplit la grille de l'onglet créatif courant (ou les résultats de la recherche). */
  private fillCreativeList() {
    const list = this.crList;
    if (!list) return;
    list.replaceChildren();
    for (const d of creativeItems(memory.ctab, memory.query)) {
      const cell = el('div', { class: 'gslot static', 'data-item': d.key });
      this.stackHTML(cell, { id: d.key, count: 1 });
      this.bindPress(cell, (kind) => {
        const full = (): ItemStack => ({ id: d.key, count: ItemRegistry.maxStack(d.key), ...(ItemRegistry.maxDurability(d.key) > 0 ? { durability: ItemRegistry.maxDurability(d.key) } : {}) });
        if (kind === 'double' || kind === 'shift') {
          // Maj + clic : une pile complète directement dans l'inventaire
          this.s.player.inventory.add(full());
        } else if (this.carried && this.carried.id !== d.key) this.carried = null; // poser sur la palette : supprime l'objet tenu
        else if (this.carried) this.carried.count = Math.min(ItemRegistry.maxStack(d.key), this.carried.count + 1);
        else this.carried = kind === 'tap' ? full() : { ...full(), count: 1 };
        this.click();
        this.refresh();
      });
      list.append(cell);
    }
    list.scrollTop = 0;
    this.placeThumb();
  }

  private placeThumb() {
    const list = this.crList, th = this.crThumb;
    if (!list || !th) return;
    const max = list.scrollHeight - list.clientHeight;
    const f = max > 0 ? list.scrollTop / max : 0;
    th.style.top = `${CR_TOP + 18 + Math.round(f * (112 - 15))}px`;
    const g = th.getContext('2d')!;
    g.clearRect(0, 0, 12, 15);
    g.imageSmoothingEnabled = false;
    const img = this.game.textures.packImage(`gui/sprites/container/creative_inventory/${max > 0 ? 'scroller' : 'scroller_disabled'}.png`);
    if (img) g.drawImage(img, 0, 0, 12, 15);
    else drawPanel(g, 0, 0, 12, 15);
  }

  private bookList: HTMLElement | null = null;
  private bookSig = '';

  private buildBook(side: HTMLElement, w: number, h: number) {
    const title = pixelText('Livre de recettes', { color: '#404040', cls: 'gui-abs' });
    title.style.left = '8px';
    title.style.top = '6px';
    const toggle = el('div', { class: 'gui-toggle', style: 'left:8px;top:18px' });
    const setT = () => toggle.replaceChildren(pixelText(memory.craftableOnly ? '[x] Fabricables' : '[ ] Toutes', { color: '#404040' }));
    setT();
    toggle.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      memory.craftableOnly = !memory.craftableOnly;
      setT();
      this.bookSig = '';
      this.refreshBook();
    });
    this.bookList = el('div', { class: 'gui-scroll book', style: `left:7px;top:32px;width:${w - 14}px;height:${h - 40}px` });
    side.append(title, toggle, this.bookList);
    this.bookSig = '';
    this.refreshBook();
  }

  private recipesHere(): CraftingRecipe[] {
    if (this.furnace) return [];
    const size = this.grid?.size ?? 2;
    const seen = new Set<string>();
    const out: CraftingRecipe[] = [];
    for (const r of RecipeRegistry.crafting) {
      if (r.width > size || r.height > size) continue;
      if (seen.has(r.result.item)) continue;
      seen.add(r.result.item);
      out.push(r);
    }
    return out;
  }

  private refreshBook() {
    const list = this.bookList;
    if (!list) return;
    const inv = this.s.player.inventory;
    const cs = this.s.crafting;
    if (this.furnace) {
      const sig = 'furnace';
      if (this.bookSig === sig) return;
      this.bookSig = sig;
      list.replaceChildren();
      for (const r of RecipeRegistry.smelting) {
        const cell = el('div', { class: `brecipe${inv.count(r.input) > 0 ? '' : ' miss'}`, 'data-item': r.result });
        this.stackHTML(cell, { id: r.result, count: 1 });
        this.bindPress(cell, () => {
          const idx = inv.slots.findIndex((x) => x?.id === r.input);
          if (idx < 0 || !this.furnace) return;
          const st = inv.slots[idx]!;
          const f = this.furnace;
          if (f.input && f.input.id !== r.input) return;
          const n = Math.min(st.count, 64 - (f.input?.count ?? 0));
          if (f.input) f.input.count += n;
          else f.input = { ...st, count: n };
          inv.takeFromSlot(idx, n);
          this.click();
          this.afterChange();
        });
        list.append(cell);
      }
      return;
    }
    const recipes = this.recipesHere().map((r) => ({ r, ok: cs.canCraft(inv, r, this.grid!.size, this.grid!) }));
    const shown = recipes.filter((x) => x.ok || !memory.craftableOnly).sort((a, b) => Number(b.ok) - Number(a.ok));
    const sig = shown.map((x) => `${x.r.id}${x.ok ? 1 : 0}`).join(',');
    if (sig === this.bookSig) return;
    this.bookSig = sig;
    list.replaceChildren();
    if (!shown.length) list.append(pixelText(tr('Aucune recette'), { color: '#606060' }));
    for (const { r, ok } of shown) {
      const cell = el('div', { class: `brecipe${ok ? '' : ' miss'}`, 'data-item': r.result.item });
      this.stackHTML(cell, { id: r.result.item, count: r.result.count });
      this.bindPress(cell, (kind) => {
        if (!this.grid) return;
        const times = kind === 'long' || kind === 'shift' || kind === 'double' ? 64 : 1;
        if (this.carried) return;
        if (!cs.fillGrid(inv, this.grid, r, times)) this.game.hud.toast('Ingrédients manquants', 'warn');
        this.click();
        this.afterChange();
        this.bookSig = '';
      });
      list.append(cell);
    }
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    clearTimeout(this.tooltipTimer);
    this.unsub.forEach((u) => u());
    const inv = this.s.player.inventory;
    // les objets de la grille et celui tenu retournent dans l'inventaire (sinon tombent au sol)
    if (this.grid) for (const left of this.grid.clearInto(inv)) this.s.throwStack(left);
    this.station?.dispose((st) => {
      const rest = inv.add(st);
      if (rest > 0) this.s.throwStack({ ...st, count: rest });
    });
    if (this.carried) {
      const rest = inv.add(this.carried);
      if (rest > 0) this.s.throwStack({ ...this.carried, count: rest });
      this.carried = null;
    }
    inv.changed();
  }
}

export { drawSlot };
