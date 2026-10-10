/**
 * Interfaces des blocs fonctionnels qui s'ajoutent à l'interface de conteneur (InventoryUI) :
 * table d'enchantement, enclume, alambic, distributeur / dropper et entonnoir. Chaque station
 * fournit ses cases (avec leurs règles) et ses éléments propres (boutons, champ de nom,
 * jauges) ; le curseur, les gestes et l'inventaire du joueur restent ceux d'InventoryUI.
 */
import type { Game } from '../core/Game';
import type { Session } from '../core/Session';
import type { Inventory } from '../inventory/Inventory';
import type { ItemStack } from '../inventory/Item';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { BlockRegistry } from '../blocks/BlockRegistry';
import {
  ENCHANT_BY_ID, canEnchant, compatible, countBookshelves, customName, enchantOffers, enchantable, enchantsOf, isEnchanted, roman, setEnchants,
  type EnchantOffer,
} from '../inventory/Enchantments';
import { isBrewIngredient, isBrewBottle } from '../inventory/Potions';
import type { BrewingState } from '../crafting/Brewing';
import type { ContainerKind } from './ContainerArt';
import { el } from './dom';
import { pixelText } from './PixelFont';

export interface StationSlot {
  x: number;
  y: number;
  get(): ItemStack | null;
  set(s: ItemStack | null): void;
  accept?(s: ItemStack): boolean;
  max?: number;
  /** Case de résultat (on ne peut qu'y prendre l'objet). */
  take?(): void;
  /** Résultat disponible (enclume : assez de niveaux). */
  canTake?(): boolean;
  big?: boolean;
  key: string;
}

export interface StationHost {
  game: Game;
  s: Session;
  /** Réaffiche les cases et les éléments de la station. */
  refresh(): void;
  click(): void;
  canvasAt(x: number, y: number, w: number, h: number): HTMLCanvasElement;
}

export abstract class Station {
  abstract readonly kind: ContainerKind;
  abstract readonly title: string;
  readonly slots: StationSlot[] = [];
  constructor(protected host: StationHost) {}
  /** Éléments propres (boutons, champ texte, jauges) ajoutés sur l'interface. */
  decorate(_gui: HTMLElement) {}
  /** Mise à jour de l'affichage (après chaque changement). */
  update() {}
  /** Fermeture : objets non conservés par le bloc rendus au joueur. */
  dispose(_give: (st: ItemStack) => void) {}
  /** La station se met à jour seule (cuisson de l'alambic) : rafraîchissement régulier. */
  get ticking() {
    return false;
  }
  /** Cases de fond dessinées sans pack de ressources : [x, y, taille]. */
  get artSlots(): [number, number, number][] {
    return this.slots.map((s) => [s.x, s.y, s.big ? 26 : 18]);
  }
}

/** Petit bouton d'interface (DOM) avec texte en police pixel. */
function guiButton(x: number, y: number, w: number, h: number) {
  const b = el('div', { class: 'gui-optbtn', style: `left:${x}px;top:${y}px;width:${w}px;height:${h}px` });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}

// =====================================================================================
// Table d'enchantement
// =====================================================================================
export class EnchantStation extends Station {
  readonly kind = 'enchant' as const;
  readonly title = 'Enchanter';
  private item: ItemStack | null = null;
  private lapis: ItemStack | null = null;
  private buttons: HTMLElement[] = [];
  private offers: EnchantOffer[] = [];
  private shelves: number;

  constructor(host: StationHost, private pos: { x: number; y: number; z: number }) {
    super(host);
    const w = host.s.world;
    this.shelves = countBookshelves((x, y, z) => BlockRegistry.get(w.getBlock(x, y, z)).key, pos.x, pos.y, pos.z);
    this.slots.push(
      { x: 15, y: 47, key: 'ench_item', max: 1, get: () => this.item, set: (v) => (this.item = v), accept: (st) => enchantable(st.id) && !isEnchanted(st) },
      { x: 35, y: 47, key: 'ench_lapis', get: () => this.lapis, set: (v) => (this.lapis = v), accept: (st) => st.id === 'lapis_lazuli' },
    );
  }

  decorate(gui: HTMLElement) {
    for (let i = 0; i < 3; i++) {
      const b = guiButton(60, 14 + i * 19, 108, 19);
      b.dataset.enchant = String(i);
      b.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.choose(i);
      });
      gui.append(b);
      this.buttons.push(b);
    }
    // livre ouvert (illustration à gauche des boutons, sans pack)
    if (!this.host.game.textures.packImage('gui/container/enchanting_table.png')) {
      const c = this.host.canvasAt(14, 14, 36, 28);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#6b3a1e';
      ctx.fillRect(2, 6, 32, 18);
      ctx.fillStyle = '#e8e0c8';
      ctx.fillRect(4, 4, 13, 18);
      ctx.fillRect(19, 4, 13, 18);
      ctx.fillStyle = '#8a8070';
      for (let r = 0; r < 5; r++) ctx.fillRect(6, 7 + r * 3, 9, 1), ctx.fillRect(21, 7 + r * 3, 9, 1);
      gui.append(c);
    }
  }

  update() {
    const p = this.host.s.player;
    this.offers = this.item ? enchantOffers(this.item.id, this.shelves, p.enchantSeed) : [];
    this.buttons.forEach((b, i) => {
      const o = this.offers[i];
      b.replaceChildren();
      const ok = !!o && (p.creative || (p.level >= o.level && (this.lapis?.count ?? 0) >= o.cost));
      b.classList.toggle('off', !ok);
      if (!o) return;
      const first = Object.entries(o.ench)[0];
      const d = first && ENCHANT_BY_ID.get(first[0]);
      // comme le jeu original : un indice (un enchantement) et le niveau requis
      const hint = d ? `${d.name}${d.max > 1 ? ' ' + roman(first[1]) : ''}${Object.keys(o.ench).length > 1 ? ' . . . ?' : ''}` : '?';
      const t1 = pixelText(hint, { color: ok ? '#685e4a' : '#342f25', cls: 'gui-abs' });
      t1.style.left = '20px';
      t1.style.top = '2px';
      const t2 = pixelText(String(o.level), { color: ok ? '#80ff20' : '#407f10', shadow: '#000', cls: 'gui-abs' });
      t2.style.right = '3px';
      t2.style.top = '10px';
      const gem = el('div', { class: 'gui-lapis', style: `left:2px;top:2px` }, pixelText(String(o.cost), { color: ok ? '#a0c8ff' : '#406080', shadow: '#000' }));
      b.append(t1, t2, gem);
    });
  }

  private choose(i: number) {
    const o = this.offers[i];
    const p = this.host.s.player;
    if (!o || !this.item) return;
    if (!p.creative && (p.level < o.level || (this.lapis?.count ?? 0) < o.cost)) return;
    const st = this.item.id === 'book' ? { id: 'enchanted_book', count: 1 } : { ...this.item };
    setEnchants(st, o.ench);
    this.item = st;
    if (!p.creative) {
      p.level -= o.cost;
      this.lapis!.count -= o.cost;
      if (this.lapis!.count <= 0) this.lapis = null;
    }
    // nouvelle graine : les propositions suivantes changent (comme le jeu original)
    p.enchantSeed = (Math.random() * 2 ** 31) | 0;
    this.host.s.progression.inc('itemsEnchanted');
    this.host.game.audio.play('levelup', { volume: 0.5, pitch: 1.3 });
    this.host.s.particles.burst('magic', this.pos.x + 0.5, this.pos.y + 1.2, this.pos.z + 0.5, 30);
    this.host.refresh();
  }

  dispose(give: (st: ItemStack) => void) {
    if (this.item) give(this.item);
    if (this.lapis) give(this.lapis);
    this.item = this.lapis = null;
  }
}

// =====================================================================================
// Enclume
// =====================================================================================
/** Matériau de réparation d'un objet (lingot, diamant…) selon son nom. */
function repairMaterial(id: string): string | null {
  const def = ItemRegistry.get(id);
  const m = def?.tool?.material ?? def?.armor?.material ?? (/^([a-z]+)_/.exec(id)?.[1] ?? '');
  const table: Record<string, string> = {
    wood: 'oak_planks', wooden: 'oak_planks', stone: 'cobblestone', iron: 'iron_ingot', gold: 'gold_ingot', golden: 'gold_ingot', diamond: 'diamond',
    netherite: 'netherite_ingot', leather: 'leather', chainmail: 'iron_ingot', copper: 'copper_ingot', turtle: 'turtle_scute',
  };
  if (id === 'elytra') return 'phantom_membrane';
  const r = table[m];
  return r && ItemRegistry.has(r) ? r : null;
}

export class AnvilStation extends Station {
  readonly kind = 'anvil' as const;
  readonly title = 'Réparer et nommer';
  private a: ItemStack | null = null;
  private b: ItemStack | null = null;
  private name = '';
  private input: HTMLInputElement | null = null;
  private costEl: HTMLElement | null = null;
  private result: { stack: ItemStack; cost: number; useB: number } | null = null;

  constructor(host: StationHost, private pos: { x: number; y: number; z: number }) {
    super(host);
    this.slots.push(
      { x: 27, y: 47, key: 'anvil_a', max: 1, get: () => this.a, set: (v) => ((this.a = v), this.syncName()) },
      { x: 76, y: 47, key: 'anvil_b', get: () => this.b, set: (v) => (this.b = v) },
      { x: 134, y: 47, key: 'anvil_out', get: () => this.result?.stack ?? null, set: () => {}, take: () => this.takeResult(), canTake: () => this.canTake() },
    );
  }

  private syncName() {
    this.name = this.a ? customName(this.a) ?? '' : '';
    if (this.input) this.input.value = this.name;
  }

  decorate(gui: HTMLElement) {
    const input = el('input', { class: 'gui-name', maxlength: '35', placeholder: '', style: 'left:62px;top:24px;width:103px;height:12px' }) as HTMLInputElement;
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('pointerup', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      this.name = input.value;
      this.host.refresh();
    });
    input.dataset.anvilName = '1';
    this.input = input;
    this.costEl = el('div', { class: 'gui-abs', style: 'right:8px;top:69px' });
    gui.append(input, this.costEl);
  }

  /** Calcul du résultat : réparation (matériau ou objet identique), enchantements, nom. */
  private compute(): { stack: ItemStack; cost: number; useB: number } | null {
    const a = this.a, b = this.b;
    if (!a) return null;
    const out: ItemStack = { ...a, meta: a.meta ? { ...a.meta } : undefined };
    let cost = 0, useB = 0;
    const max = ItemRegistry.maxDurability(a.id);
    if (b) {
      const mat = repairMaterial(a.id);
      if (max > 0 && mat === b.id && out.durability !== undefined && out.durability < max) {
        // chaque matériau répare un quart de la durabilité
        const n = Math.min(b.count, Math.ceil((max - out.durability) / Math.ceil(max / 4)));
        out.durability = Math.min(max, out.durability + n * Math.ceil(max / 4));
        cost += n;
        useB = n;
      } else if (b.id === a.id || b.id === 'enchanted_book') {
        // fusion : durabilités additionnées (+12 %) et enchantements combinés
        if (b.id === a.id && max > 0 && out.durability !== undefined && b.durability !== undefined) {
          out.durability = Math.min(max, out.durability + b.durability + Math.floor(max * 0.12));
          cost += 2;
        }
        const ench = enchantsOf(a);
        let added = false;
        for (const [id, lvl] of Object.entries(enchantsOf(b))) {
          const d = ENCHANT_BY_ID.get(id);
          if (!d || !(a.id === 'enchanted_book' || canEnchant(a.id, d)) || !compatible(ench, id)) continue;
          const cur = ench[id] ?? 0;
          const next = cur === lvl ? Math.min(d.max, lvl + 1) : Math.max(cur, lvl);
          if (next !== cur) {
            ench[id] = next;
            cost += next * (b.id === 'enchanted_book' ? 1 : 2);
            added = true;
          }
        }
        setEnchants(out, ench);
        if (!added && b.id === 'enchanted_book') return null;
        if (cost === 0) return null;
        useB = 1;
      } else return null;
    }
    const name = this.name.trim();
    if (name !== (customName(a) ?? '')) {
      const meta = { ...(out.meta ?? {}) };
      if (name) meta.name = name;
      else delete meta.name;
      out.meta = Object.keys(meta).length ? meta : undefined;
      cost += 1;
    }
    if (cost === 0) return null;
    return { stack: out, cost: Math.min(39, cost), useB };
  }

  update() {
    this.result = this.compute();
    const p = this.host.s.player;
    if (!this.costEl) return;
    this.costEl.replaceChildren();
    if (!this.result) return;
    const ok = p.creative || p.level >= this.result.cost;
    this.costEl.append(pixelText(`Coût : ${this.result.cost} niveau${this.result.cost > 1 ? 'x' : ''}`, { color: ok ? '#80ff20' : '#ff6060', shadow: '#3f3f3f' }));
  }

  private takeResult() {
    const r = this.result;
    const p = this.host.s.player;
    if (!r) return;
    if (!p.creative) p.level -= r.cost;
    this.a = null;
    if (this.b && r.useB) {
      this.b.count -= r.useB;
      if (this.b.count <= 0) this.b = null;
    }
    this.name = '';
    if (this.input) this.input.value = '';
    // l'enclume s'abîme parfois (12 %) : intacte → ébréchée → endommagée → détruite
    if (!p.creative && Math.random() < 0.12) {
      const w = this.host.s.world;
      const id = w.getBlock(this.pos.x, this.pos.y, this.pos.z);
      const key = BlockRegistry.get(id).key;
      const next = key === 'anvil' ? 'chipped_anvil' : key === 'chipped_anvil' ? 'damaged_anvil' : null;
      if (next && BlockRegistry.has(next)) w.setBlock(this.pos.x, this.pos.y, this.pos.z, BlockRegistry.byName(next).id, w.getMeta(this.pos.x, this.pos.y, this.pos.z));
      else if (key === 'damaged_anvil') {
        w.setBlock(this.pos.x, this.pos.y, this.pos.z, 0);
        this.host.game.audio.play('explode', { volume: 0.3 });
      }
    }
    this.host.game.audio.blockSound('place', 'metal', this.pos.x + 0.5, this.pos.y + 0.5, this.pos.z + 0.5);
  }

  /** Le résultat n'est disponible que si le joueur a assez de niveaux. */
  canTake() {
    const p = this.host.s.player;
    return !!this.result && (p.creative || p.level >= this.result.cost);
  }

  dispose(give: (st: ItemStack) => void) {
    if (this.a) give(this.a);
    if (this.b) give(this.b);
    this.a = this.b = null;
  }
}

// =====================================================================================
// Alambic
// =====================================================================================
export class BrewingStation extends Station {
  readonly kind = 'brewing' as const;
  readonly title = 'Alambic';
  private bubbles: CanvasRenderingContext2D | null = null;
  private arrow: CanvasRenderingContext2D | null = null;
  private fuelBar: CanvasRenderingContext2D | null = null;

  constructor(host: StationHost, private state: BrewingState) {
    super(host);
    const st = state;
    const bottle = (i: number, x: number, y: number) =>
      this.slots.push({ x, y, key: `brew_${i}`, max: 1, get: () => st.bottles[i], set: (v) => (st.bottles[i] = v), accept: (s) => isBrewBottle(s) });
    bottle(0, 56, 51);
    bottle(1, 79, 58);
    bottle(2, 102, 51);
    this.slots.push(
      { x: 79, y: 17, key: 'brew_ingredient', get: () => st.ingredient, set: (v) => (st.ingredient = v), accept: (s) => isBrewIngredient(s.id) },
      { x: 17, y: 17, key: 'brew_fuel', get: () => st.fuelItem, set: (v) => (st.fuelItem = v), accept: (s) => s.id === 'blaze_powder' },
    );
  }

  get ticking() {
    return true;
  }

  decorate(gui: HTMLElement) {
    const a = this.host.canvasAt(97, 16, 9, 28);
    const f = this.host.canvasAt(60, 44, 18, 4);
    const bub = this.host.canvasAt(63, 14, 12, 29);
    this.arrow = a.getContext('2d');
    this.fuelBar = f.getContext('2d');
    this.bubbles = bub.getContext('2d');
    gui.append(a, f, bub);
  }

  update() {
    const st = this.state;
    const a = this.arrow, f = this.fuelBar, b = this.bubbles;
    if (!a || !f || !b) return;
    a.clearRect(0, 0, 9, 28);
    f.clearRect(0, 0, 18, 4);
    b.clearRect(0, 0, 12, 29);
    // flèche de progression (descend), jauge de poudre de blaze, bulles
    const prog = st.time > 0 ? 1 - st.time / 20 : 0;
    a.fillStyle = '#3b3b3b';
    a.fillRect(3, 0, 3, 28);
    if (prog > 0) {
      a.fillStyle = '#ffffff';
      a.fillRect(3, 0, 3, Math.round(28 * prog));
    }
    f.fillStyle = '#3b3b3b';
    f.fillRect(0, 0, 18, 4);
    if (st.fuel > 0) {
      f.fillStyle = '#e8a020';
      f.fillRect(0, 0, Math.round((18 * st.fuel) / 20), 4);
    }
    if (st.time > 0) {
      const t = performance.now() / 120;
      b.fillStyle = '#e0f0ff';
      for (let i = 0; i < 5; i++) {
        const y = 28 - ((t * 3 + i * 6) % 28);
        b.fillRect(2 + ((i * 5) % 8), Math.round(y), 2, 2);
      }
    }
  }
}

// =====================================================================================
// Distributeur, dropper (9 cases) et entonnoir (5 cases)
// =====================================================================================
export class DispenserStation extends Station {
  readonly kind: 'dispenser' | 'hopper';
  readonly title: string;
  constructor(host: StationHost, inv: Inventory, title: string, hopper: boolean) {
    super(host);
    this.kind = hopper ? 'hopper' : 'dispenser';
    this.title = title;
    for (let i = 0; i < inv.size; i++) {
      const x = hopper ? 44 + i * 18 : 62 + (i % 3) * 18;
      const y = hopper ? 20 : 17 + Math.floor(i / 3) * 18;
      this.slots.push({ x, y, key: `disp${i}`, get: () => inv.slots[i], set: (v) => (inv.slots[i] = v) });
    }
  }
}
