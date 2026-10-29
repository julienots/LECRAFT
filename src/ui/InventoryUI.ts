import type { Game } from '../core/Game';
import { language, t as tr } from './i18n';
import { hasGlint, iconKey, stackName } from '../inventory/StackInfo';
import { customName, enchLevel, enchantLines } from '../inventory/Enchantments';
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
import { rarityColor } from './Rarity';
import { BLAYOUT, BODY_Y, LEFT_W, PANEL_W, RIGHT_X, bedrockBackground, bedrockBodyH, bedrockInvTop, drawFigure, drawArmor, drawFlame, packSprite, type ContainerKind } from './ContainerArt';
import {
  BC, drawBArrow, drawBButton, drawBField, drawBHeader, drawBListArea, drawBPanel, drawBSlot, drawBTab, drawBToggle, drawChestIcon, drawCraftIcon, drawCross, drawMagnifier, drawOpenBook,
  drawQuestion, drawSmallMagnifier, drawTrash,
} from './BedrockArt';
import { pixelText, textWidth } from './PixelFont';
import { CREATIVE_TABS, creativeEntries, creativeItems, recipeCategory, type CreativeTabKey } from './CreativeTabs';

export type InventoryMode = 'hand' | 'table' | 'furnace' | 'chest' | 'ender' | 'enchant' | 'anvil' | 'brewing' | 'dispenser' | 'dropper' | 'hopper';

type Group = 'main' | 'hotbar' | 'armor' | 'container' | 'grid' | 'result' | 'input' | 'fuel' | 'trash';
/** Disposition : deux panneaux (liste à gauche, inventaire à droite), inventaire seul, ou grand panneau du catalogue créatif. */
type View = 'split' | 'solo' | 'book';

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
  /** Silhouette affichée dans la case vide (sprite gui/sprites/container/slot/…). */
  ph?: string;
}

/** Entrée d'une liste défilante (objet du catalogue créatif ou recette du livre). */
interface ListEntry {
  item: string;
  stack: ItemStack;
  /** Recette dont les ingrédients manquent (fond rouge). */
  red?: boolean;
  tap(kind: 'tap' | 'long' | 'double' | 'right' | 'shift'): void;
}

const LONG_MS = 380;
const DOUBLE_MS = 320;
/** Colonnes de la liste : le catalogue plein écran en a 17, le panneau gauche 7. */
const SPLIT_COLS = 7;
const BOOK_COLS = 17;
const TAB_X = [1, 29, 56, 84];
const SEARCH_TAB_X = 136;

/** Mémoire de la disposition, des onglets et du filtre entre deux ouvertures. */
const memory = {
  view: 'split' as View,
  crView: 'book' as View,
  ctab: 'construction' as CreativeTabKey,
  rtab: 'search' as CreativeTabKey,
  query: '',
  rquery: '',
  craftableOnly: false,
};

/** Recettes connues du joueur : on découvre une recette en possédant l'un de ses ingrédients (l'établi est connu d'emblée). */
const knownRecipes = new WeakMap<object, Set<string>>();
function knownOf(owner: object): Set<string> {
  let k = knownRecipes.get(owner);
  if (!k) {
    k = new Set(RecipeRegistry.crafting.filter((r) => r.result.item === 'crafting_table').map((r) => r.id));
    knownRecipes.set(owner, k);
  }
  return k;
}

/**
 * Interfaces de conteneurs fidèles à l'édition Bedrock : objet tenu au curseur, grille de
 * fabrication 2x2 / 3x3, fourneau, coffre, armure, livre de recettes (liste de gauche) et
 * catalogue créatif (onglets, « Tous les objets », recherche).
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
  /** Mode créatif : catalogue du jeu à la place du livre de recettes. */
  private creative = false;
  private furnaceKind: 'furnace' | 'blast_furnace' | 'smoker' = 'furnace';
  private view: View = 'solo';
  private rx = 0;
  private compW = PANEL_W;
  private compH = 210;
  private rows = 3;
  private cols = BOOK_COLS;
  private title = '';
  private hasRecipePanel = false;
  private building = false;

  // liste défilante (catalogue créatif ou recettes)
  private listEl: HTMLElement | null = null;
  private listRect = { x: 7, y: 49, w: 148, h: 155, cols: SPLIT_COLS };
  private listEntries: ListEntry[] = [];
  private listFirst = -1;
  private thumb: HTMLElement | null = null;
  private recipeSig = '';
  private unlockSig = '';

  constructor(private game: Game, private s: Session, mode: InventoryMode, pos?: { x: number; y: number; z: number }) {
    const pinv = s.player.inventory;
    this.kind = mode === 'hand' ? 'inventory' : mode === 'ender' ? 'chest' : mode === 'dropper' ? 'dispenser' : mode;
    if (mode === 'chest' && pos) this.chestInv = s.world.getChest(pos.x, pos.y, pos.z);
    if (mode === 'ender') this.chestInv = s.player.enderChest;
    if (pos) this.station = this.makeStation(mode, pos);
    if (mode === 'furnace' && pos) this.furnace = s.world.getFurnace(pos.x, pos.y, pos.z);
    this.creative = mode === 'hand' && s.player.creative;
    if (mode === 'hand') this.grid = new CraftingGrid(2);
    if (mode === 'table') this.grid = new CraftingGrid(3);
    const blockDef = pos ? BlockRegistry.get(s.world.getBlock(pos.x, pos.y, pos.z)) : null;
    const blockName = blockDef?.name ?? '';
    const blockKey = blockDef?.key ?? '';
    // haut fourneau et fumoir : titre et jauges propres (comme le jeu original)
    this.furnaceKind = blockKey === 'blast_furnace' ? 'blast_furnace' : blockKey === 'smoker' ? 'smoker' : 'furnace';
    const furnaceTitle = { furnace: 'Fourneau', blast_furnace: 'Haut fourneau', smoker: 'Fumoir' }[this.furnaceKind];
    this.title = this.station?.title ?? (mode === 'ender' ? "Coffre de l'Ender" : mode === 'chest' ? (blockName && !/^Coffre/.test(blockName) ? blockName : 'Coffre') : mode === 'table' ? 'Fabrication' : mode === 'furnace' ? furnaceTitle : '');
    this.rows = this.chestInv ? Math.max(1, Math.ceil(this.chestInv.size / 9)) : 3;
    this.hasRecipePanel = mode === 'hand' || mode === 'table' || mode === 'furnace';

    this.gui = el('div', { class: 'gui' });
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

    document.body.classList.add('bi-open');
    this.view = this.hasRecipePanel ? (this.creative ? memory.crView : memory.view === 'book' ? 'split' : memory.view) : 'solo';
    this.build();

    const refresh = () => this.refresh();
    this.unsub.push(pinv.onChange(refresh));
    if (this.chestInv) this.unsub.push(this.chestInv.onChange(refresh));
    const onResize = () => {
      const c = this.wantedCols();
      if (c !== this.cols) {
        this.build();
        this.refresh();
      }
      this.layout();
    };
    window.addEventListener('resize', onResize);
    this.unsub.push(() => window.removeEventListener('resize', onResize));
    if (this.furnace || this.station?.ticking) this.timer = window.setInterval(() => this.refresh(), 100);
    requestAnimationFrame(() => this.layout());
    this.layout();
    this.refresh();
  }

  // ---------- construction ----------

  /** Nombre de colonnes du catalogue plein écran : 17 comme le jeu, moins sur un petit écran. */
  private wantedCols() {
    if (this.view !== 'book') return SPLIT_COLS;
    const maxW = (window.innerWidth - 12) / 1.5;
    return Math.max(SPLIT_COLS, Math.min(BOOK_COLS, Math.floor((maxW - 22) / 20)));
  }

  /** Construit (ou reconstruit après un changement de disposition ou d'onglet) tout le contenu de la fenêtre. */
  private build() {
    this.building = true;
    const gui = this.gui;
    gui.replaceChildren();
    this.slots = [];
    this.slotByEl = new WeakMap();
    this.listEl = null;
    this.thumb = null;
    this.figure = null;
    this.flameCtx = this.arrowCtx = null;
    this.listEntries = [];
    this.listFirst = -1;
    this.recipeSig = '';
    const view = this.view;
    const book = view === 'book';
    const split = view === 'split';
    this.cols = this.wantedCols();
    const bodyH = book ? 184 : bedrockBodyH(this.kind, this.rows);
    this.rx = split ? RIGHT_X : 0;
    this.compW = book ? this.cols * 20 + 22 : split ? RIGHT_X + PANEL_W : PANEL_W;
    const trashRow = this.creative && !book;
    this.compH = BODY_Y + bodyH + (book ? 25 : trashRow ? 26 : 0);
    gui.style.width = `${this.compW}px`;
    gui.style.height = `${this.compH}px`;

    // panneau gauche (liste) ou grand panneau du catalogue
    if (book || split) this.buildLeft(bodyH);
    // panneau droit : inventaire, fabrication, conteneur
    if (!book) this.buildRight(bodyH);
    else this.buildTray();
    this.buildHeader();
    if (book || split) this.buildTabs();
    this.building = false;
  }

  /** Panneau de gauche : fond, titre, recherche, liste défilante. */
  private buildLeft(bodyH: number) {
    const book = this.view === 'book';
    const w = book ? this.compW : LEFT_W;
    const bg = this.canvasAt(0, 0, book ? w : RIGHT_X, BODY_Y + bodyH);
    bg.className = 'gui-bg gui-side';
    const g = bg.getContext('2d')!;
    drawBPanel(g, 0, BODY_Y, w, bodyH);
    if (!book) {
      g.fillStyle = '#606060';
      g.fillRect(w, 32, RIGHT_X - w, bodyH - 11);
    }
    this.gui.append(bg);
    const key = this.creative ? memory.ctab : memory.rtab;
    const search = key === 'search';
    const cols = this.cols;
    const listW = cols * 20 + 8;
    const x = 7;
    const y = search ? 67 : 49;
    const h = BODY_Y + bodyH - 6 - y;
    this.listRect = { x, y, w: listW, h, cols };
    // titre, aligné à droite du panneau
    const tab = CREATIVE_TABS.find((t) => t.key === key) ?? CREATIVE_TABS[CREATIVE_TABS.length - 1];
    const toggleOn = !this.creative && memory.craftableOnly;
    const title = this.creative ? tab.name : search ? (toggleOn ? 'Recettes fabricables' : 'Toutes les recettes') : tab.name;
    const lbl = pixelText(tr(title), { color: BC.text, cls: 'gui-abs bi-title' });
    lbl.style.left = `${x + listW - 3 - textWidth(tr(title))}px`;
    lbl.style.top = '33px';
    this.gui.append(lbl);
    const barW = !this.creative ? listW - 36 : listW;
    if (search) {
      const f = this.canvasAt(x, 47, barW, 18);
      drawBField(f.getContext('2d')!, 0, 0, barW, 18);
      drawSmallMagnifier(f.getContext('2d')!, 4, 4);
      this.gui.append(f);
      const q = this.creative ? memory.query : memory.rquery;
      const input = el('input', { class: 'cr-search bi-search', type: 'text', value: q, placeholder: '', spellcheck: 'false', style: `left:${x + 19}px;top:50px;width:${barW - 24}px;height:11px` }) as HTMLInputElement;
      input.addEventListener('input', () => {
        if (this.creative) memory.query = input.value;
        else memory.rquery = input.value;
        if (this.creative) this.fillCreativeList();
        else {
          this.recipeSig = '';
          this.refreshRecipes();
        }
      });
      // les touches tapées ne doivent pas commander le jeu (E, Échap…)
      input.addEventListener('keydown', (e) => e.stopPropagation());
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
      input.addEventListener('pointerup', (e) => e.stopPropagation());
      this.gui.append(input);
    }
    // filtre « recettes fabricables »
    if (!this.creative) {
      const tg = this.canvasAt(x + listW - 28, search ? 47 : 30, 28, 17);
      tg.className = 'gui-layer gui-btn bi-toggle';
      tg.dataset.btn = 'filter';
      drawBToggle(tg.getContext('2d')!, 0, 0, toggleOn);
      tg.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        memory.craftableOnly = !memory.craftableOnly;
        this.click();
        this.build();
        this.refresh();
      });
      const ico = el('img', { class: 'gui-layer', src: this.game.textures.iconURL('crafting_table') ?? '', alt: '', style: `left:${x + listW - 26}px;top:${(search ? 47 : 30) + 2}px;width:13px;height:13px;image-rendering:pixelated` });
      this.gui.append(tg, ico);
    }
    // zone de la liste
    const area = this.canvasAt(x, y, listW, h);
    drawBListArea(area.getContext('2d')!, 0, 0, listW, h);
    this.gui.append(area);
    const list = el('div', { class: `bi-list ${this.creative ? 'cr-grid' : 'book'}`, style: `left:${x}px;top:${y}px;width:${cols * 20}px;height:${h}px` });
    list.addEventListener('scroll', () => this.renderRows());
    list.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      // poser un objet sur la liste le supprime (comme le jeu original)
      if (e.target === list && this.carried && this.creative) {
        this.carried = null;
        this.refresh();
      }
    });
    this.gui.append(list);
    this.listEl = list;
    // ascenseur
    const track = el('div', { class: 'bi-track gui-btn', style: `left:${x + cols * 20}px;top:${y}px;width:8px;height:${h}px` });
    const thumb = el('div', { class: 'bi-thumb', style: 'left:1px;top:0;width:5px;height:14px' });
    track.append(thumb);
    let dragging = false;
    const scrollTo = (clientY: number) => {
      const r = track.getBoundingClientRect();
      const th = this.thumbHeight();
      const f = Math.max(0, Math.min(1, (clientY - r.top - ((th / 2) * r.height) / h) / (r.height - (th * r.height) / h)));
      list.scrollTop = f * Math.max(0, list.scrollHeight - list.clientHeight);
    };
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
    this.gui.append(track);
    this.thumb = thumb;
    if (this.creative) this.fillCreativeList();
    else this.refreshRecipes();
  }

  /** Panneau de droite : inventaire du joueur, fabrication, fourneau, coffre ou station. */
  private buildRight(bodyH: number) {
    const rx = this.rx;
    const pinv = this.s.player.inventory;
    const stCells: [number, number][] = (this.station?.slots ?? []).map((st) => [st.x + 9 - 2, st.y + 30 - 2]);
    const bg = bedrockBackground(this.kind, tr(this.title), this.game.textures, this.rows, `player_${this.game.settings.playerSkin ?? 'steve'}`, stCells);
    bg.className = 'gui-bg';
    bg.style.left = `${rx}px`;
    this.gui.append(bg);
    if (this.kind === 'inventory') {
      const f = BLAYOUT.inventory.figure;
      this.addFigure(rx + f[0] + 12, f[1] + 9, 2);
    }
    this.buildSlots(pinv);
    for (const sl of this.slots) this.gui.append(this.slotEl(sl));
    // éléments propres à la station (boutons de la table d'enchantement, champ de l'enclume, jauges de l'alambic)
    if (this.station) {
      const layer = el('div', { class: 'gui-layer', style: `left:${rx + 9}px;top:30px;width:1px;height:1px;overflow:visible` });
      this.station.decorate(layer);
      this.gui.append(layer);
    }
    if (this.furnace) {
      const L = BLAYOUT.furnace;
      const fc = this.canvasAt(rx + L.flame[0], L.flame[1], 14, 14);
      const ac = this.canvasAt(rx + L.arrow[0], L.arrow[1], 24, 16);
      this.flameCtx = fc.getContext('2d');
      this.arrowCtx = ac.getContext('2d');
      this.gui.append(fc, ac);
    }
    if (this.grid) {
      const [ax, ay] = this.kind === 'inventory' ? BLAYOUT.inventory.arrow : BLAYOUT.table.arrow;
      if (this.kind === 'table') {
        // flèche de la table : repère propre (le fond la dessine déjà)
      }
      void ax;
      void ay;
    }
    // poubelle du catalogue créatif (sous le panneau, à droite)
    if (this.creative) {
      const tw = 32, th = 28;
      const tx = rx + PANEL_W - tw - 6, ty = BODY_Y + bodyH - 4;
      const t = this.canvasAt(tx, ty, tw, th);
      const g = t.getContext('2d')!;
      drawBPanel(g, 0, 0, tw, th);
      drawBPanel(g, 0, 0, tw, 6);
      g.fillStyle = BC.panel;
      g.fillRect(2, 0, tw - 4, 6);
      drawBSlot(g, 6, 4);
      drawTrash(g, 8, 4);
      t.style.zIndex = '0';
      this.gui.insertBefore(t, this.gui.firstChild);
      const sl: GuiSlot = { x: tx + 8, y: ty + 6, group: 'trash', get: () => null, set: () => {}, key: 'trash' };
      this.slots.push(sl);
      this.gui.append(this.slotEl(sl));
    }
  }

  /** Barre d'objets (9 cases) sous le grand panneau du catalogue créatif. */
  private buildTray() {
    const pinv = this.s.player.inventory;
    const w = 193, x0 = Math.round((this.compW - w) / 2), y0 = BODY_Y + 184 - 14;
    const c = this.canvasAt(x0, y0, w, 39);
    const g = c.getContext('2d')!;
    drawBPanel(g, 0, 0, w, 39);
    // le plateau rejoint le grand panneau : on efface le trait du bas du panneau sur sa largeur
    g.fillStyle = BC.panel;
    g.fillRect(2, 0, w - 4, 20);
    for (let i = 0; i < 9; i++) drawBSlot(g, 7 + i * 20, 13);
    c.className = 'gui-bg bi-tray';
    // placé sous le panneau du catalogue mais au-dessus de son trait du bas
    this.gui.insertBefore(c, this.gui.firstChild);
    const mask = this.canvasAt(x0 + 2, BODY_Y + 184 - 5, w - 4, 5);
    mask.className = 'gui-bg';
    const mg = mask.getContext('2d')!;
    mg.fillStyle = BC.panel;
    mg.fillRect(0, 0, w - 4, 5);
    this.gui.append(mask);
    for (let i = 0; i < 9; i++) {
      this.slots.push({ x: x0 + 7 + i * 20 + 2, y: y0 + 13 + 2, group: 'hotbar', get: () => pinv.slots[i], set: (v) => (pinv.slots[i] = v), key: `inv${i}` });
    }
    for (const sl of this.slots) this.gui.append(this.slotEl(sl));
  }

  /** En-tête sombre en haut à droite : boutons de disposition, aide et fermeture. */
  private buildHeader() {
    const book = this.view === 'book';
    const buttons: ('book' | 'craft' | 'chest')[] = !this.hasRecipePanel ? [] : this.creative ? ['book', 'craft', 'chest'] : ['craft', 'chest'];
    const hw = buttons.length === 3 ? 139 : buttons.length === 2 ? 110 : 40;
    const right = book ? this.compW : this.rx + PANEL_W;
    const hx = right - hw;
    const bg = this.canvasAt(hx, 0, hw, 27);
    bg.className = 'gui-bg bi-header';
    drawBHeader(bg.getContext('2d')!, 0, 0, hw, 27);
    this.gui.append(bg);
    const sel = book ? 'book' : this.view === 'split' ? 'craft' : 'chest';
    buttons.forEach((b, i) => {
      const bx = hx + 8 + i * 29;
      const c = this.canvasAt(bx, 5, 27, 19);
      c.className = 'gui-layer gui-btn bi-hbtn';
      c.dataset.btn = b;
      const g = c.getContext('2d')!;
      drawBButton(g, 0, 0, 27, 19, b === sel);
      if (b === 'book') drawOpenBook(g, 4, 3);
      else if (b === 'craft') drawCraftIcon(g, 4, 3);
      else drawChestIcon(g, 6, 4);
      c.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        const next: View = b === 'book' ? 'book' : b === 'craft' ? 'split' : 'solo';
        if (next === this.view) return;
        this.view = next;
        if (this.creative) memory.crView = next;
        else memory.view = next;
        this.click();
        this.build();
        this.refresh();
        this.layout();
      });
      this.gui.append(c);
    });
    const off = hw - (buttons.length ? 33 : 20);
    if (buttons.length) {
      const q = this.canvasAt(hx + off - 2, 8, 5, 7);
      drawQuestion(q.getContext('2d')!, 0, 0);
      const qb = el('div', { class: 'gui-btn bi-hbtn', 'data-btn': 'help', style: `position:absolute;left:${hx + off - 20}px;top:3px;width:17px;height:21px` });
      qb.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.game.hud.toast('Toucher : prendre / poser. Appui long : moitié. Double toucher : transfert rapide.');
      });
      this.gui.append(q, qb);
    }
    const x = this.canvasAt(hx + hw - 18, 9, 5, 5);
    drawCross(x.getContext('2d')!, 0, 0);
    const xb = el('div', { class: 'gui-btn bi-hbtn', 'data-btn': 'close', style: `position:absolute;left:${hx + hw - 24}px;top:3px;width:17px;height:21px` });
    xb.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.game.closeInventory();
    });
    this.gui.append(x, xb);
  }

  /** Onglets au-dessus du panneau gauche : catégories (catalogue ou recettes connues) et recherche. */
  private buildTabs() {
    const tm = this.game.textures;
    const cur = this.creative ? memory.ctab : memory.rtab;
    let keys: CreativeTabKey[];
    if (this.creative) keys = CREATIVE_TABS.filter((t) => t.key !== 'search').map((t) => t.key);
    else {
      const have = new Set(this.recipeEntriesAll().map((e) => recipeCategory(e.item)));
      keys = CREATIVE_TABS.filter((t) => t.key !== 'search' && have.has(t.key as never)).map((t) => t.key);
    }
    const place = (key: CreativeTabKey, x: number) => {
      const sel = key === cur;
      const c = this.canvasAt(x, 0, 27, sel ? 29 : 27);
      c.className = 'gui-layer gui-btn cr-tab bi-tab';
      c.dataset.tab = key;
      const t = CREATIVE_TABS.find((v) => v.key === key)!;
      c.title = tr(t.name);
      drawBTab(c.getContext('2d')!, 0, 0, 27, sel ? 29 : 27, sel);
      const icon = el('div', { class: 'gui-layer', style: `left:${x}px;top:${sel ? 1 : 2}px;width:27px;height:26px` });
      const add = (id: string, l: number, tp: number, sz: number) => {
        const src = tm.iconURL(ItemRegistry.has(id) ? id : 'stick');
        if (src) icon.append(el('img', { src, alt: '', style: `position:absolute;left:${l}px;top:${tp}px;width:${sz}px;height:${sz}px;image-rendering:pixelated` }));
      };
      if (key === 'construction') add('bricks', 5, 4, 17);
      else if (key === 'equipment') {
        add('diamond_sword', 3, 2, 17);
        add('iron_helmet', 11, 11, 12);
      } else if (key === 'items') {
        add(ItemRegistry.has('red_bed') ? 'red_bed' : 'white_bed', 4, 3, 17);
        add('water_bucket', 4, 13, 9);
      } else if (key === 'nature') add('grass_block', 5, 4, 17);
      else {
        const m = this.canvasAt(5, 4, 17, 17);
        drawMagnifier(m.getContext('2d')!, 0, 0, 17);
        icon.append(m);
      }
      c.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        if (cur === key) return;
        if (this.creative) memory.ctab = key;
        else memory.rtab = key;
        this.click();
        this.build();
        this.refresh();
      });
      return [c, icon];
    };
    // les onglets non sélectionnés d'abord (derrière), le sélectionné devant
    keys.forEach((k, i) => k !== cur && this.gui.append(...place(k, TAB_X[i])));
    if ('search' !== cur) this.gui.append(...place('search', SEARCH_TAB_X));
    keys.forEach((k, i) => k === cur && this.gui.append(...place(k, TAB_X[i])));
    if ('search' === cur) this.gui.append(...place('search', SEARCH_TAB_X));
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

  /** Calque du personnage (skin + armure portée), à la position du dessin du fond. */
  private figure: { c: HTMLCanvasElement; k: number; sig: string } | null = null;
  private addFigure(x: number, y: number, k: number) {
    const c = this.canvasAt(x - 1, y - 1, Math.ceil(16 * k) + 2, Math.ceil(32 * k) + 2);
    c.style.pointerEvents = 'none';
    this.gui.append(c);
    this.figure = { c, k, sig: '?' };
    this.drawFigureLayer();
  }
  private drawFigureLayer() {
    const f = this.figure;
    if (!f || !f.c.isConnected) return;
    const a = this.s.player.inventory.armor;
    const armor = { head: a.head?.id, chest: a.chest?.id, legs: a.legs?.id, feet: a.feet?.id };
    const sig = JSON.stringify(armor);
    if (sig === f.sig) return;
    f.sig = sig;
    const ctx = f.c.getContext('2d')!;
    ctx.clearRect(0, 0, f.c.width, f.c.height);
    const tm = this.game.textures;
    drawFigure(ctx, 1, 1, tm.skin(`player_${this.game.settings.playerSkin ?? 'steve'}`).image as HTMLCanvasElement, f.k);
    drawArmor(ctx, 1, 1, tm, armor, f.k);
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

  private playerSlots(pinv: Inventory) {
    const rx = this.rx;
    const py = bedrockInvTop(this.kind, this.rows) + 2;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 9; c++) {
        const i = HOTBAR_SIZE + r * 9 + c;
        this.slots.push({ x: rx + 10 + c * 20, y: py + r * 20, group: 'main', get: () => pinv.slots[i], set: (v) => (pinv.slots[i] = v), key: `inv${i}` });
      }
    for (let c = 0; c < 9; c++) this.slots.push({ x: rx + 10 + c * 20, y: py + 63, group: 'hotbar', get: () => pinv.slots[c], set: (v) => (pinv.slots[c] = v), key: `inv${c}` });
  }

  private buildSlots(pinv: Inventory) {
    const s = this.slots;
    const rx = this.rx;
    if (this.kind === 'inventory') {
      BLAYOUT.inventory.armor.forEach(([x, y], i) => {
        const a: ArmorSlot = ARMOR_SLOTS[i];
        s.push({ x: rx + x + 2, y: y + 2, group: 'armor', max: 1, get: () => pinv.armor[a], set: (v) => (pinv.armor[a] = v), accept: (st) => ItemRegistry.get(st.id)?.armor?.slot === a, key: `armor_${a}` });
      });
    }
    if (this.grid) {
      const g = this.grid;
      const pos = this.kind === 'inventory' ? BLAYOUT.inventory : BLAYOUT.table;
      pos.grid.forEach(([x, y], i) => s.push({ x: rx + x + 2, y: y + 2, group: 'grid', get: () => g.slots[i], set: (v) => (g.slots[i] = v), key: `grid${i}` }));
      s.push({ x: rx + pos.result[0] + 2, y: pos.result[1] + 2, group: 'result', get: () => g.result, set: () => {}, take: () => this.onCraft(), key: 'result' });
    }
    if (this.furnace) {
      const f = this.furnace;
      const L = BLAYOUT.furnace;
      s.push({ x: rx + L.input[0] + 2, y: L.input[1] + 2, group: 'input', get: () => f.input, set: (v) => (f.input = v), key: 'f_in' });
      s.push({ x: rx + L.fuel[0] + 2, y: L.fuel[1] + 2, group: 'fuel', get: () => f.fuel, set: (v) => (f.fuel = v), accept: (st) => (ItemRegistry.get(st.id)?.burnTime ?? 0) > 0 || st.id === 'bucket', key: 'f_fuel' });
      s.push({
        x: rx + L.result[0] + 2, y: L.result[1] + 2, group: 'result',
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
        s.push({ x: rx + st.x + 9, y: st.y + 30, group: st.take ? 'result' : 'container', big: false, max: st.max, get: st.get, set: st.set, accept: st.accept, take: st.take, canTake: st.canTake, key: st.key, ph: st.ph });
    if (this.chestInv) {
      const ci = this.chestInv;
      for (let i = 0; i < ci.size; i++) s.push({ x: rx + 10 + (i % 9) * 20, y: 48 + Math.floor(i / 9) * 20, group: 'container', get: () => ci.slots[i], set: (v) => (ci.slots[i] = v), key: `chest${i}` });
    }
    this.playerSlots(pinv);
  }

  private slotEl(sl: GuiSlot): HTMLElement {
    const d = el('div', { class: 'gslot', style: `left:${sl.x - 2}px;top:${sl.y - 2}px;width:20px;height:20px` });
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
    if (!sl || sl.take || sl.group === 'trash' || this.drag.slots.includes(sl)) return;
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
    // le doigt qui glisse n'est pas un appui long : on annule dès que le contact s'éloigne de son point de départ
    let sx = 0, sy = 0;
    d.addEventListener('pointerdown', (e) => ((sx = e.clientX), (sy = e.clientY)));
    d.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' && Math.hypot(e.clientX - sx, e.clientY - sy) > 6 && this.drag) {
        clearTimeout(t);
        this.drag.one = false;
        fired = false;
        released = true;
      }
    });
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
    // corbeille de l'inventaire créatif : l'objet tenu y est détruit ; Maj + clic (double toucher) vide tout l'inventaire
    if (sl.key === 'trash') {
      if (kind === 'double' || kind === 'shift') {
        const inv = this.s.player.inventory;
        inv.slots.fill(null);
        for (const a of ARMOR_SLOTS) inv.armor[a] = null;
        inv.changed();
      }
      this.carried = null;
      this.click();
      this.afterChange();
      return;
    }
    if ((kind === 'double' || kind === 'shift') && this.bound(sl)) return;
    if (kind === 'double' || kind === 'shift') this.quickMove(sl);
    else if (sl.take) this.takeResult(sl);
    else if (kind === 'tap') this.leftClick(sl);
    else this.rightClick(sl);
    this.afterChange();
    this.showTooltip(sl);
  }
  private undoLast: (() => void) | null = null;

  /** Malédiction du lien éternel : l'armure portée ne s'enlève plus (sauf en créatif). */
  private bound(sl: GuiSlot) {
    const st = sl.get();
    return sl.group === 'armor' && !this.s.player.creative && !!st && enchLevel(st, 'binding_curse') > 0;
  }

  private leftClick(sl: GuiSlot) {
    const cur = sl.get();
    if (this.bound(sl)) return;
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
    if (this.bound(sl)) return;
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
    // contenants rendus (fiole de la bouteille de miel…) : dans l'inventaire, sinon au sol
    const inv = this.s.player.inventory;
    for (const st of g.consume()) {
      const left = inv.add(st);
      if (left > 0) this.s.entities.spawnItem(st.id, left, this.s.player.x, this.s.player.y + 1, this.s.player.z);
    }
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
    this.drawFigureLayer();
    for (const sl of this.slots) {
      const st = sl.get();
      const sig = st ? `${st.id}:${st.count}:${st.durability ?? ''}${st.meta ? JSON.stringify(st.meta) : ''}` : '';
      if (sl.el!.dataset.sig !== sig) {
        sl.el!.dataset.sig = sig;
        this.stackHTML(sl.el!, st);
        // silhouette de la case vide (lapis, fiole…)
        const ph = !st && sl.ph ? packSprite(this.game.textures, sl.ph) : null;
        sl.el!.style.backgroundImage = ph ? `url(${ph})` : '';
        sl.el!.classList.toggle('ph', !!ph);
      }
    }
    this.stackHTML(this.cursorEl, this.carried);
    this.placeCursor();
    if (this.furnace && this.flameCtx && this.arrowCtx) {
      const f = this.furnace;
      const fc = this.flameCtx, ac = this.arrowCtx;
      fc.clearRect(0, 0, 14, 14);
      ac.clearRect(0, 0, 24, 16);
      const flame = f.burnMax > 0 && f.burn > 0 ? Math.min(1, f.burn / f.burnMax) : 0;
      const prog = f.input ? Math.min(1, f.cook / (RecipeRegistry.smeltingFor(f.input.id)?.time ?? 10)) : 0;
      const sprites = this.game.textures;
      const fk = this.furnaceKind;
      const lit = sprites.packImage(`gui/sprites/container/${fk}/lit_progress.png`, 'gui/sprites/container/furnace/lit_progress.png');
      // comme le jeu original : flamme de ceil(13 × reste) + 1 px, flèche de ceil(24 × progression) px
      const h = flame > 0 ? Math.ceil(13 * flame) + 1 : 0;
      const w = Math.ceil(24 * prog);
      if (lit) {
        if (h > 0) fc.drawImage(lit, 0, (lit.height * (14 - h)) / 14, lit.width, (lit.height * h) / 14, 0, 14 - h, 14, h);
      } else drawFlame(fc, 0, 0, flame);
      if (w > 0) {
        ac.fillStyle = '#ffffff';
        const tmp = document.createElement('canvas');
        tmp.width = 24;
        tmp.height = 16;
        drawBArrow(tmp.getContext('2d')!, 0, 1, 1, 24);
        ac.drawImage(tmp, 0, 0, w, 16, 0, 0, w, 16);
      }
    }
    this.station?.update();
    if (!this.creative && this.listEl) this.refreshRecipes();
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
    // nom coloré selon la rareté (enchanté : un cran au-dessus), comme le jeu original
    const lines: [string, string][] = [[stackName(st), rarityColor(st)]];
    // malédictions en rouge, autres enchantements en gris
    for (const t of enchantLines(st)) lines.push([t, /^Malédiction|Curse/.test(t) ? '#ff5555' : '#aaaaaa']);
    const pl = potionOf(st) || st.id === 'tipped_arrow' ? potionLine(st) : null;
    if (pl) lines.push([pl, '#5555ff']);
    // boîte de shulker remplie : aperçu du contenu
    const inside = (st.meta?.items as (ItemStack | null)[] | undefined)?.filter((x): x is ItemStack => !!x) ?? [];
    for (const it of inside.slice(0, 5)) lines.push([`${stackName(it)} x${it.count}`, '#ffffff']);
    if (inside.length > 5) lines.push([language() === 'en' ? `and ${inside.length - 5} more...` : `et ${inside.length - 5} de plus…`, '#ffffff']);
    const en = language() === 'en';
    if (def.description && !en) lines.push([def.description, '#aaaaaa']);
    const num = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', en ? '.' : ',');
    // attributs : ligne vide, « Dans la main principale : », puis valeurs en vert foncé
    if (def.damage && def.tool) {
      const speed = 1 / (def.attackCooldown ?? 0.4);
      lines.push(['', '#aaaaaa'], [tr('Dans la main principale :'), '#aaaaaa']);
      lines.push([en ? ` ${num(def.damage)} Attack Damage` : ` ${num(def.damage)} de dégâts d'attaque`, '#00aa00']);
      lines.push([en ? ` ${num(speed)} Attack Speed` : ` ${num(speed)} de vitesse d'attaque`, '#00aa00']);
    }
    if (def.armor) {
      const where = { head: 'Sur la tête :', chest: 'Sur le corps :', legs: 'Sur les jambes :', feet: 'Sur les pieds :' }[def.armor.slot];
      lines.push(['', '#aaaaaa'], [tr(where), '#aaaaaa'], [en ? `+${def.armor.defense} Armor` : `+${def.armor.defense} d'armure`, '#5555ff']);
    }
    if (st.durability !== undefined && st.durability < ItemRegistry.maxDurability(st.id)) lines.push([en ? `Durability: ${st.durability} / ${ItemRegistry.maxDurability(st.id)}` : `Durabilité : ${st.durability} / ${ItemRegistry.maxDurability(st.id)}`, '#ffffff']);
    const k = this.scale;
    this.tooltip.style.setProperty('--k', String(k));
    lines.forEach(([t, c], i) => {
      const line = el('div', { class: i === 0 ? 'tt-first' : '' }, t ? pixelText(t, { color: c, shadow: shadowOf(c), px: k }) : '');
      // nom personnalisé en italique
      if (i === 0 && named && line.firstElementChild) (line.firstElementChild as HTMLElement).style.transform = 'skewX(-12deg)';
      this.tooltip.append(line);
    });
    const r = sl.el!.getBoundingClientRect();
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${Math.min(window.innerWidth - 10, r.right + 4 * k)}px`;
    this.tooltip.style.top = `${Math.max(4, r.top - 12 * k)}px`;
    requestAnimationFrame(() => {
      const tr = this.tooltip.getBoundingClientRect();
      if (tr.right > window.innerWidth - 4) this.tooltip.style.left = `${Math.max(4, r.left - tr.width - 4)}px`;
      if (tr.bottom > window.innerHeight - 4) this.tooltip.style.top = `${Math.max(4, window.innerHeight - tr.height - 4)}px`;
    });
    this.tooltipTimer = window.setTimeout(() => (this.tooltip.style.display = 'none'), 2200);
  }

  /** Mise à l'échelle entière (ou demi-entière) si possible, pixels nets ; la même pour tous les écrans d'une même taille d'appareil. */
  private layout() {
    const w = this.compW;
    const h = this.compH;
    const fitK = (cw: number, ch: number) => {
      const fit = Math.min((window.innerWidth - 12) / cw, (window.innerHeight - 8) / ch);
      return fit >= 2 ? Math.floor(fit * 2) / 2 : Math.max(0.5, fit);
    };
    // échelle de référence : celle du plus grand écran (catalogue créatif de 362 × 235), pour que tous les écrans aient la même taille
    const k = Math.min(fitK(Math.max(w, 362), Math.max(h, 235)), fitK(w, h));
    this.scale = k;
    this.wrap.style.transform = `scale(${k})`;
    this.wrap.style.width = `${w}px`;
    this.wrap.style.height = `${h}px`;
    this.wrap.style.left = `${Math.round((window.innerWidth - w * k) / 2)}px`;
    // le haut des panneaux reste au même endroit d'une disposition à l'autre (la hauteur de référence est celle du catalogue)
    const ref = Math.max(h, 235);
    this.wrap.style.top = `${Math.round((window.innerHeight - ref * k) / 2) - 1}px`;
    this.drawFigureLayer();
  }

  // ---------- liste défilante (catalogue créatif, livre de recettes) ----------

  /** Hauteur de la poignée de l'ascenseur. */
  private thumbHeight() {
    const l = this.listEl;
    if (!l || !l.scrollHeight) return 14;
    return Math.max(14, Math.min(this.listRect.h, (l.clientHeight / l.scrollHeight) * this.listRect.h));
  }

  /** Remplace les entrées de la liste (retour en haut). */
  private setEntries(entries: ListEntry[]) {
    const list = this.listEl;
    if (!list) return;
    this.listEntries = entries;
    const { cols, h } = this.listRect;
    const total = Math.max(Math.ceil(h / 20), Math.ceil(entries.length / cols));
    list.replaceChildren(el('div', { class: 'bi-spacer', style: `height:${total * 20}px` }));
    list.scrollTop = 0;
    this.listFirst = -1;
    this.renderRows();
  }

  /** Dessine les rangées visibles seulement (le catalogue compte des milliers d'objets). */
  private renderRows() {
    const list = this.listEl;
    if (!list) return;
    const { cols, h } = this.listRect;
    const first = Math.floor(list.scrollTop / 20);
    const th = this.thumb;
    if (th) {
      const max = list.scrollHeight - list.clientHeight;
      const hh = this.thumbHeight();
      th.style.height = `${hh}px`;
      th.style.top = `${max > 0 ? (list.scrollTop / max) * (h - hh) : 0}px`;
      th.style.display = max > 0 ? '' : 'none';
    }
    if (first === this.listFirst) return;
    this.listFirst = first;
    const last = first + Math.ceil(h / 20) + 1;
    const total = Math.max(Math.ceil(h / 20), Math.ceil(this.listEntries.length / cols));
    const spacer = list.firstElementChild;
    list.replaceChildren(...(spacer ? [spacer] : []));
    const frag = document.createDocumentFragment();
    for (let r = first; r <= Math.min(last, total - 1); r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const e = this.listEntries[i];
        if (!e) break;
        const cell = el('div', { class: `bi-cell${e.red ? ' miss' : ''}${this.creative ? '' : ' brecipe'}`, style: `left:${c * 20}px;top:${r * 20}px` });
        cell.dataset.item = e.item;
        this.stackHTML(cell, e.stack);
        const tip = () => this.showTooltip({ get: () => e.stack, el: cell } as unknown as GuiSlot);
        cell.addEventListener('pointerenter', (ev) => ev.pointerType === 'mouse' && tip());
        cell.addEventListener('pointerleave', () => (this.tooltip.style.display = 'none'));
        this.bindPress(cell, (kind) => {
          if (kind === 'long' && this.creative) return tip();
          e.tap(kind);
        });
        frag.append(cell);
      }
    list.append(frag);
  }

  /** Objets disponibles dans la clé d'inventaire créatif : liste de leurs clés (tests, recherche). */
  listKeys(): string[] {
    return this.listEntries.map((e) => e.item);
  }

  /** Remplit la liste de l'onglet créatif courant (ou des résultats de la recherche). */
  private fillCreativeList() {
    const entries = creativeEntries(memory.ctab, memory.query);
    this.setEntries(
      entries.map(({ def: d, stack }) => ({
        item: d.key,
        stack,
        tap: (kind) => {
          const full = (): ItemStack => ({ ...stack, ...(stack.meta ? { meta: structuredClone(stack.meta) } : {}), count: ItemRegistry.maxStack(d.key), ...(ItemRegistry.maxDurability(d.key) > 0 ? { durability: ItemRegistry.maxDurability(d.key) } : {}) });
          if (kind === 'double' || kind === 'shift') {
            // Maj + clic : une pile complète directement dans l'inventaire
            this.s.player.inventory.add(full());
          } else if (this.carried && (this.carried.id !== d.key || JSON.stringify(this.carried.meta ?? null) !== JSON.stringify(stack.meta ?? null))) this.carried = null; // poser sur la liste : supprime l'objet tenu
          else if (this.carried) this.carried.count = Math.min(ItemRegistry.maxStack(d.key), this.carried.count + 1);
          else this.carried = kind === 'tap' ? full() : { ...full(), count: 1 };
          this.click();
          this.refresh();
        },
      })),
    );
  }

  // ---------- livre de recettes ----------

  /** Découvre les recettes dont le joueur possède un ingrédient. */
  private scanUnlocks() {
    const inv = this.s.player.inventory;
    const ids = new Set<string>();
    for (const st of inv.slots) if (st) ids.add(st.id);
    for (const a of ARMOR_SLOTS) if (inv.armor[a]) ids.add(inv.armor[a]!.id);
    const sig = [...ids].sort().join(',');
    if (sig === this.unlockSig) return;
    this.unlockSig = sig;
    const known = knownOf(this.s.player);
    const have = [...ids];
    for (const r of RecipeRegistry.crafting) {
      if (known.has(r.id)) continue;
      const ing = r.type === 'shaped' ? Object.values(r.key ?? {}) : r.ingredients ?? [];
      if (ing.some((i) => have.some((id) => RecipeRegistry.matches(id, i)))) known.add(r.id);
    }
    for (const r of RecipeRegistry.smelting) if (!known.has(r.id) && ids.has(r.input)) known.add(r.id);
  }

  /** Recettes connues de la station, une par objet fabriqué, dans l'ordre des objets du jeu. */
  private recipeEntriesAll(): { item: string; count: number; ok: boolean; use: (kind: 'tap' | 'long' | 'double' | 'right' | 'shift') => void }[] {
    this.scanUnlocks();
    const known = knownOf(this.s.player);
    const inv = this.s.player.inventory;
    const cs = this.s.crafting;
    const seen = new Set<string>();
    const out: { item: string; count: number; ok: boolean; use: (kind: 'tap' | 'long' | 'double' | 'right' | 'shift') => void }[] = [];
    if (this.furnace) {
      for (const r of RecipeRegistry.smelting) {
        if (!known.has(r.id) || seen.has(r.result) || !ItemRegistry.has(r.result)) continue;
        seen.add(r.result);
        out.push({
          item: r.result,
          count: 1,
          ok: inv.count(r.input) > 0,
          use: () => {
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
          },
        });
      }
      return out;
    }
    const size = this.grid?.size ?? 2;
    for (const r of RecipeRegistry.crafting as CraftingRecipe[]) {
      if (r.width > size || r.height > size || !known.has(r.id) || seen.has(r.result.item)) continue;
      seen.add(r.result.item);
      const ok = this.grid ? cs.canCraft(inv, r, size, this.grid) : false;
      out.push({
        item: r.result.item,
        count: r.result.count,
        ok,
        use: (kind) => {
          if (!this.grid || this.carried) return;
          const times = kind === 'long' || kind === 'shift' || kind === 'double' ? 64 : 1;
          if (!cs.fillGrid(inv, this.grid, r, times)) this.game.hud.toast('Ingrédients manquants', 'warn');
          this.click();
          this.afterChange();
          this.recipeSig = '';
        },
      });
    }
    return out;
  }

  /** Réaffiche la liste des recettes selon l'onglet, la recherche et le filtre « fabricables ». */
  private refreshRecipes() {
    if (this.creative || !this.listEl) return;
    const all = this.recipeEntriesAll();
    const tab = memory.rtab;
    const q = memory.rquery.trim().toLowerCase();
    let shown = all.filter((e) => tab === 'search' || recipeCategory(e.item) === tab);
    if (tab === 'search' && q) shown = shown.filter((e) => e.item.includes(q.replace(/\s+/g, '_')) || (ItemRegistry.get(e.item)?.name ?? '').toLowerCase().includes(q));
    if (memory.craftableOnly) shown = shown.filter((e) => e.ok);
    const rank = orderIndex();
    shown.sort((a, b) => (rank.get(a.item) ?? 1e9) - (rank.get(b.item) ?? 1e9));
    const sig = `${tab}|${q}|${memory.craftableOnly}|${shown.map((e) => `${e.item}${e.ok ? 1 : 0}`).join(',')}`;
    if (sig === this.recipeSig) return;
    this.recipeSig = sig;
    const keep = this.listEl.scrollTop;
    this.setEntries(
      shown.map((e) => ({
        item: e.item,
        stack: { id: e.item, count: e.count },
        red: !e.ok,
        tap: (kind) => {
          if (!e.ok && !this.furnace) this.game.hud.toast('Ingrédients manquants', 'warn');
          else e.use(kind);
        },
      })),
    );
    this.listEl.scrollTop = keep;
    // un onglet de catégorie peut apparaître quand une recette est découverte
    const tabs = this.gui.querySelectorAll('.bi-tab').length;
    const need = new Set(all.map((e) => recipeCategory(e.item))).size + 1;
    if (!this.building && tabs !== need && this.view !== 'solo') {
      const sc = this.listEl.scrollTop;
      this.build();
      this.refresh();
      if (this.listEl) this.listEl.scrollTop = sc;
    }
  }

  dispose() {
    this.disposed = true;
    document.body.classList.remove('bi-open');
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

/** Rang des objets dans « Tous les objets » (pour ranger les recettes dans le même ordre que le jeu). */
let ORDER: Map<string, number> | null = null;
let ORDER_N = 0;
function orderIndex(): Map<string, number> {
  const n = ItemRegistry.all().length;
  if (!ORDER || ORDER_N !== n) {
    ORDER = new Map(creativeItems('search').map((d, i) => [d.key, i]));
    ORDER_N = n;
  }
  return ORDER;
}

/** Ombre portée du texte : couleur divisée par 4, comme la police du jeu original. */
function shadowOf(c: string): string {
  const n = parseInt(c.slice(1), 16);
  const f = (v: number) => ((v >> 2) & 0x3f).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

