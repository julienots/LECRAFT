import type { Game } from '../core/Game';
import type { Session } from '../core/Session';
import { ARMOR_SLOTS, HOTBAR_SIZE, Inventory } from '../inventory/Inventory';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ArmorSlot, ItemStack } from '../inventory/Item';
import type { Recipe } from '../crafting/Recipe';
import { RecipeRegistry } from '../crafting/RecipeRegistry';
import type { Screen } from './UIManager';
import { button, el } from './dom';

export type InventoryMode = 'hand' | 'table' | 'furnace' | 'chest';

type Pick = { inv: Inventory; index: number } | { armor: ArmorSlot } | null;

const ARMOR_LABEL: Record<ArmorSlot, string> = { head: 'Tête', chest: 'Torse', legs: 'Jambes', feet: 'Pieds' };

/**
 * Inventaire complet adapté au tactile :
 * - toucher un objet pour le prendre, toucher un autre emplacement pour déplacer/échanger/empiler
 * - appui long pour séparer un stack ; boutons Jeter, Équiper, Manger, Détruire, Transférer
 * - onglet Fabrication (livre de recettes) filtré selon la station (main, établi, four)
 */
export class InventoryUI {
  readonly screen: Screen;
  private tab: 'inv' | 'craft';
  private body: HTMLElement;
  private tabsEl: HTMLElement;
  private info: HTMLElement;
  private pick: Pick = null;
  private onlyCraftable = false;
  private unsub: (() => void)[] = [];
  private chestInv: Inventory | null = null;

  constructor(private game: Game, private s: Session, private mode: InventoryMode, chest?: { x: number; y: number; z: number }) {
    this.tab = mode === 'table' || mode === 'furnace' ? 'craft' : 'inv';
    if (mode === 'chest' && chest) this.chestInv = s.world.getChest(chest.x, chest.y, chest.z);
    this.body = el('div', { class: 'scroll' });
    this.tabsEl = el('div', { class: 'tabs' });
    this.info = el('div', { class: 'item-info muted' });
    const title = mode === 'chest' ? 'Coffre' : mode === 'table' ? 'Établi' : mode === 'furnace' ? 'Four' : 'Inventaire';
    const close = button('✕', () => game.closeInventory(), 'small', () => game.audio.play('click', { volume: 0.5 }));
    const panel = el('div', { class: 'panel' }, el('div', { class: 'title-bar' }, el('h2', {}, title), close), this.tabsEl, this.body);
    this.screen = { el: el('div', { class: 'screen dim' }, panel), onBack: () => (game.closeInventory(), true) };
    const rerender = () => this.render();
    this.unsub.push(s.player.inventory.onChange(rerender));
    if (this.chestInv) this.unsub.push(this.chestInv.onChange(rerender));
    this.render();
  }

  private click() {
    this.game.audio.play('click', { volume: 0.4 });
  }

  private render() {
    this.tabsEl.innerHTML = '';
    const stationName = this.mode === 'furnace' ? 'Four' : this.mode === 'table' ? 'Établi' : 'Fabrication (main)';
    const tabs: ['inv' | 'craft', string][] = [['inv', this.mode === 'chest' ? 'Coffre & sac' : 'Sac'], ['craft', stationName]];
    for (const [k, label] of tabs) {
      const t = el('div', { class: `tab${this.tab === k ? ' active' : ''}` }, label);
      t.addEventListener('click', () => {
        this.tab = k;
        this.pick = null;
        this.click();
        this.render();
      });
      this.tabsEl.append(t);
    }
    this.body.innerHTML = '';
    if (this.tab === 'inv') this.renderInventory();
    else this.renderCrafting();
  }

  private slotEl(stack: ItemStack | null, picked: boolean, onTap: () => void, onLong?: () => void, placeholder?: string): HTMLElement {
    const d = el('div', { class: `slot${picked ? ' picked' : ''}` });
    if (stack) {
      d.append(el('img', { src: this.game.textures.iconURL(stack.id), alt: '' }));
      if (stack.count > 1) d.append(el('span', { class: 'count' }, String(stack.count)));
      const max = ItemRegistry.maxDurability(stack.id);
      if (stack.durability !== undefined && max > 0 && stack.durability < max) {
        const f = stack.durability / max;
        d.append(el('div', { class: 'dur' }, el('div', { style: `width:${f * 100}%;background:hsl(${f * 120},80%,50%)` })));
      }
    } else if (placeholder) d.append(el('span', { class: 'muted', style: 'font-size:10px' }, placeholder));
    let timer = 0;
    let long = false;
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      long = false;
      if (onLong)
        timer = window.setTimeout(() => {
          long = true;
          onLong();
        }, 420);
    });
    d.addEventListener('pointerup', (e) => {
      e.preventDefault();
      clearTimeout(timer);
      if (!long) onTap();
    });
    d.addEventListener('pointerleave', () => clearTimeout(timer));
    return d;
  }

  private isPicked(inv: Inventory, i: number) {
    return !!this.pick && 'inv' in this.pick && this.pick.inv === inv && this.pick.index === i;
  }

  private pickedStack(): ItemStack | null {
    if (!this.pick) return null;
    if ('armor' in this.pick) return this.s.player.inventory.armor[this.pick.armor];
    return this.pick.inv.slots[this.pick.index];
  }

  private tapSlot(inv: Inventory, i: number) {
    const pinv = this.s.player.inventory;
    this.click();
    if (!this.pick) {
      if (inv.slots[i]) this.pick = { inv, index: i };
    } else if ('armor' in this.pick) {
      // retirer l'armure vers cet emplacement (s'il est libre)
      const a = this.pick.armor;
      if (!inv.slots[i]) {
        inv.slots[i] = pinv.armor[a];
        pinv.armor[a] = null;
        inv.changed();
        pinv.changed();
      }
      this.pick = null;
    } else {
      const from = this.pick;
      this.pick = null;
      if (!(from.inv === inv && from.index === i)) from.inv.move(from.index, i, inv);
    }
    this.render();
  }

  private tapArmor(slot: ArmorSlot) {
    const pinv = this.s.player.inventory;
    this.click();
    if (this.pick && 'inv' in this.pick && this.pick.inv === pinv) {
      const st = pinv.slots[this.pick.index];
      const def = st && ItemRegistry.get(st.id);
      if (def?.armor?.slot === slot) pinv.equipArmor(this.pick.index);
      else this.game.hud.toast('Cet objet ne va pas ici', 'warn');
      this.pick = null;
    } else if (pinv.armor[slot]) this.pick = { armor: slot };
    else this.pick = null;
    this.render();
  }

  private renderInventory() {
    const pinv = this.s.player.inventory;
    if (this.chestInv) {
      const cg = el('div', { class: 'inv-grid' });
      this.chestInv.slots.forEach((st, i) => cg.append(this.slotEl(st, this.isPicked(this.chestInv!, i), () => this.tapSlot(this.chestInv!, i), () => this.chestInv!.split(i))));
      this.body.append(el('div', { class: 'inv-section' }, el('h3', {}, 'Coffre'), cg));
    }
    const armorCol = el('div', { class: 'armor-col' });
    for (const a of ARMOR_SLOTS) armorCol.append(this.slotEl(pinv.armor[a], !!this.pick && 'armor' in this.pick && this.pick.armor === a, () => this.tapArmor(a), undefined, ARMOR_LABEL[a]));
    const main = el('div', { class: 'inv-grid' });
    for (let i = HOTBAR_SIZE; i < pinv.size; i++) main.append(this.slotEl(pinv.slots[i], this.isPicked(pinv, i), () => this.tapSlot(pinv, i), () => pinv.split(i)));
    const hot = el('div', { class: 'inv-grid', style: 'margin-top:6px' });
    for (let i = 0; i < HOTBAR_SIZE; i++) hot.append(this.slotEl(pinv.slots[i], this.isPicked(pinv, i), () => this.tapSlot(pinv, i), () => pinv.split(i)));
    const p = this.s.player;
    this.body.append(
      el('div', { class: 'inv-layout' }, this.chestInv ? null : armorCol, el('div', {}, el('h3', { class: 'muted', style: 'margin:0 0 6px;font-size:14px' }, `Sac · Défense ${p.inventory.defense()} · Niveau ${p.level}`), main, hot)),
    );
    // infos + actions
    const st = this.pickedStack();
    const def = st ? ItemRegistry.get(st.id) : undefined;
    this.info.textContent = st && def ? `${def.name}${st.count > 1 ? ` ×${st.count}` : ''}${def.food ? ` — nourriture +${def.food.hunger}` : ''}${def.damage ? ` — dégâts ${def.damage}` : ''}${def.armor ? ` — armure +${def.armor.defense}` : ''}${st.durability !== undefined ? ` — usure ${st.durability}/${ItemRegistry.maxDurability(st.id)}` : ''}${def.description ? ` — ${def.description}` : ''}` : 'Touchez un objet pour le sélectionner. Appui long : diviser le stack.';
    const actions = el('div', { class: 'inv-actions' });
    if (st && this.pick && 'inv' in this.pick) {
      const pk = this.pick;
      if (def?.armor) actions.append(button('Équiper', () => (pinv.equipArmor(pk.index), (this.pick = null), this.render()), 'blue small'));
      if (def?.food && pk.inv === pinv)
        actions.append(button('Manger', () => {
          if (p.eat(st.id)) {
            pk.inv.takeFromSlot(pk.index, 1);
            this.game.audio.play('eat');
          } else this.game.hud.toast('Vous n’avez pas faim', 'info');
          this.render();
        }, 'small'));
      if (st.count > 1) actions.append(button('Diviser', () => (pk.inv.split(pk.index), this.render()), 'small'));
      if (this.chestInv) {
        const other = pk.inv === pinv ? this.chestInv : pinv;
        actions.append(button('Transférer', () => {
          const s2 = pk.inv.slots[pk.index];
          if (s2) {
            const rest = other.add(s2);
            if (rest > 0) s2.count = rest;
            else pk.inv.slots[pk.index] = null;
            pk.inv.changed();
          }
          this.pick = null;
          this.render();
        }, 'blue small'));
      }
      actions.append(button('Jeter 1', () => {
        const t = pk.inv.takeFromSlot(pk.index, 1);
        if (t) this.s.throwStack(t);
        if (!pk.inv.slots[pk.index]) this.pick = null;
        this.render();
      }, 'small'));
      actions.append(button('Jeter tout', () => {
        const t = pk.inv.takeFromSlot(pk.index, st.count);
        if (t) this.s.throwStack(t);
        this.pick = null;
        this.render();
      }, 'small'));
      actions.append(button('Détruire', async () => {
        if (await this.game.ui.confirm('Détruire ?', `${def?.name} ×${st.count} sera supprimé définitivement.`, 'Détruire')) {
          pk.inv.slots[pk.index] = null;
          pk.inv.changed();
          this.pick = null;
          this.render();
        }
      }, 'danger small'));
    } else if (st && this.pick && 'armor' in this.pick) {
      const a = this.pick.armor;
      actions.append(button('Retirer', () => (pinv.unequipArmor(a), (this.pick = null), this.render()), 'blue small'));
    }
    this.body.append(this.info, actions);
  }

  private station(): 'hand' | 'table' | 'furnace' {
    return this.mode === 'table' ? 'table' : this.mode === 'furnace' ? 'furnace' : 'hand';
  }

  private renderCrafting() {
    const inv = this.s.player.inventory;
    const cs = this.s.crafting;
    const station = this.station();
    const header = el(
      'div',
      { class: 'row', style: 'margin-bottom:8px' },
      el('span', { class: 'muted' }, station === 'furnace' ? `Combustible disponible : ${cs.fuelAvailable(inv)} unités (charbon = 8, bois = 2)` : station === 'hand' ? 'Fabrication de base. Posez un établi pour plus de recettes.' : 'Toutes les recettes d’établi.'),
      el('span', { class: 'spacer' }),
      button(this.onlyCraftable ? 'Toutes' : 'Disponibles', () => ((this.onlyCraftable = !this.onlyCraftable), this.render()), 'small'),
    );
    this.body.append(header);
    const list = cs.available(inv, station).sort((a, b) => Number(b.craftable) - Number(a.craftable));
    for (const { recipe, craftable } of list) {
      if (this.onlyCraftable && !craftable) continue;
      this.body.append(this.recipeRow(recipe, craftable));
    }
  }

  private recipeRow(r: Recipe, ok: boolean): HTMLElement {
    const inv = this.s.player.inventory;
    const cs = this.s.crafting;
    const def = ItemRegistry.require(r.result.item);
    const ings = el('div', { class: 'ings' });
    for (const ing of r.ingredients) {
      const have = cs.countFor(inv, ing.item);
      const id = ing.item.startsWith('tag:') ? RecipeRegistry.tags[ing.item.slice(4)][0] : ing.item;
      const name = ing.item.startsWith('tag:') ? `(${ing.item.slice(4) === 'log' ? 'tout tronc' : 'charbon'})` : '';
      ings.append(el('span', { class: `ing${have < ing.count ? ' miss' : ''}` }, el('img', { src: this.game.textures.iconURL(id), alt: '' }), `${have}/${ing.count} ${name}`));
    }
    if (r.fuel) ings.append(el('span', { class: 'muted' }, `+${r.fuel} 🔥`));
    const craft = (n: number) => {
      const done = cs.craft(inv, r, n);
      if (done > 0) {
        this.game.audio.play(r.station === 'furnace' ? 'fizz' : 'place_wood', { volume: 0.6 });
        this.s.progression.inc(`craft:${r.result.item}`, done);
        for (const o of cs.overflow.splice(0)) this.s.throwStack({ id: o.id, count: o.count });
        this.s.progression.check(this.s.player.level);
      }
      this.render();
    };
    const actions = el('div', { class: 'col', style: 'gap:4px' }, button('Fabriquer', () => craft(1), ok ? 'primary small' : 'small'), button('×5', () => craft(5), 'small'));
    (actions.firstChild as HTMLButtonElement).disabled = !ok;
    (actions.lastChild as HTMLButtonElement).disabled = !ok;
    return el(
      'div',
      { class: `recipe${ok ? ' ok' : ''}` },
      this.slotEl({ id: r.result.item, count: r.result.count }, false, () => (this.info.textContent = def.name)),
      el('div', {}, el('div', { class: 'rname' }, `${def.name}${r.result.count > 1 ? ` ×${r.result.count}` : ''}`), ings),
      actions,
    );
  }

  dispose() {
    this.unsub.forEach((u) => u());
    if (this.pick && 'inv' in this.pick) this.pick = null;
  }
}
