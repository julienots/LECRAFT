import { ItemRegistry } from './ItemRegistry';
import { unbreakingSaves } from './Enchantments';
import type { ArmorSlot, ItemStack } from './Item';

export const HOTBAR_SIZE = 9;
export const MAIN_SIZE = 27;
export const ARMOR_SLOTS: ArmorSlot[] = ['head', 'chest', 'legs', 'feet'];

export function makeStack(id: string, count = 1): ItemStack {
  const s: ItemStack = { id, count };
  const dur = ItemRegistry.maxDurability(id);
  if (dur > 0) s.durability = dur;
  return s;
}

export function canMerge(a: ItemStack, b: ItemStack) {
  return a.id === b.id && a.durability === undefined && b.durability === undefined && !a.meta && !b.meta;
}

/**
 * Inventaire générique (joueur, coffres).
 * Les slots 0..8 constituent la hotbar pour l'inventaire du joueur.
 */
export class Inventory {
  slots: (ItemStack | null)[];
  armor: Record<ArmorSlot, ItemStack | null> = { head: null, chest: null, legs: null, feet: null };
  selected = 0;
  private listeners = new Set<() => void>();

  constructor(size = HOTBAR_SIZE + MAIN_SIZE) {
    this.slots = new Array(size).fill(null);
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  changed() {
    this.listeners.forEach((f) => f());
  }

  get size() {
    return this.slots.length;
  }
  get selectedStack(): ItemStack | null {
    return this.slots[this.selected];
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Ajoute un stack ; retourne la quantité restante qui n'a pas pu être ajoutée. */
  add(stack: ItemStack): number {
    let remaining = stack.count;
    const max = ItemRegistry.maxStack(stack.id);
    // 1) compléter les stacks existants (hotbar d'abord)
    if (max > 1)
      for (let i = 0; i < this.slots.length && remaining > 0; i++) {
        const s = this.slots[i];
        if (s && canMerge(s, stack) && s.count < max) {
          const n = Math.min(max - s.count, remaining);
          s.count += n;
          remaining -= n;
        }
      }
    // 2) slots vides
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(max, remaining);
        this.slots[i] = { ...stack, count: n, meta: stack.meta ? { ...stack.meta } : undefined };
        if (this.slots[i]!.meta === undefined) delete this.slots[i]!.meta;
        remaining -= n;
      }
    }
    if (remaining !== stack.count) this.changed();
    return remaining;
  }

  /** Retire n objets d'un type (n'importe quels slots). Retourne vrai si possible. */
  remove(id: string, n: number): boolean {
    if (this.count(id) < n) return false;
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const k = Math.min(s.count, n);
        s.count -= k;
        n -= k;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return true;
  }

  /** Retire n objets d'un slot précis. */
  takeFromSlot(i: number, n = 1): ItemStack | null {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(n, s.count);
    const out = { ...s, count: k };
    s.count -= k;
    if (s.count <= 0) this.slots[i] = null;
    this.changed();
    return out;
  }

  /** Sépare un stack en deux (moitié dans le premier slot libre). */
  split(i: number): boolean {
    const s = this.slots[i];
    if (!s || s.count < 2) return false;
    const free = this.slots.findIndex((x) => x === null);
    if (free < 0) return false;
    const half = Math.floor(s.count / 2);
    s.count -= half;
    this.slots[free] = { ...s, count: half };
    this.changed();
    return true;
  }

  /** Déplace/fusionne/échange le contenu du slot a vers b (éventuellement dans un autre inventaire). */
  move(a: number, b: number, other: Inventory = this): void {
    const sa = this.slots[a];
    const sb = other.slots[b];
    if (!sa) return;
    if (sb && canMerge(sa, sb)) {
      const max = ItemRegistry.maxStack(sa.id);
      const n = Math.min(max - sb.count, sa.count);
      sb.count += n;
      sa.count -= n;
      if (sa.count <= 0) this.slots[a] = null;
    } else {
      this.slots[a] = sb;
      other.slots[b] = sa;
    }
    this.changed();
    if (other !== this) other.changed();
  }

  /** Use de durabilité ; retourne vrai si l'objet s'est cassé. */
  damageSelected(amount = 1): boolean {
    const s = this.selectedStack;
    if (!s || s.durability === undefined) return false;
    // Solidité : chaque point d'usure peut être évité
    for (let i = amount; i > 0; i--) if (unbreakingSaves(s)) amount--;
    if (amount <= 0) return false;
    s.durability -= amount;
    if (s.durability <= 0) {
      this.slots[this.selected] = null;
      this.changed();
      return true;
    }
    this.changed();
    return false;
  }

  equipArmor(slotIndex: number): boolean {
    const s = this.slots[slotIndex];
    const def = s && ItemRegistry.get(s.id);
    if (!s || !def?.armor) return false;
    const prev = this.armor[def.armor.slot];
    this.armor[def.armor.slot] = s;
    this.slots[slotIndex] = prev;
    this.changed();
    return true;
  }
  unequipArmor(slot: ArmorSlot): boolean {
    const s = this.armor[slot];
    if (!s) return false;
    const free = this.slots.findIndex((x) => x === null);
    if (free < 0) return false;
    this.slots[free] = s;
    this.armor[slot] = null;
    this.changed();
    return true;
  }
  /** Points de défense totaux. */
  defense(): number {
    let d = 0;
    for (const k of ARMOR_SLOTS) {
      const s = this.armor[k];
      if (s) d += ItemRegistry.get(s.id)?.armor?.defense ?? 0;
    }
    return d;
  }
  damageArmor(amount: number) {
    for (const k of ARMOR_SLOTS) {
      const s = this.armor[k];
      if (!s || s.durability === undefined) continue;
      if (unbreakingSaves(s, true)) continue;
      s.durability -= amount;
      if (s.durability <= 0) this.armor[k] = null;
    }
    this.changed();
  }

  clear() {
    this.slots.fill(null);
    for (const k of ARMOR_SLOTS) this.armor[k] = null;
    this.changed();
  }

  serialize() {
    return { slots: this.slots.map((s) => (s ? { ...s } : null)), armor: { ...this.armor }, selected: this.selected };
  }
  load(data: { slots: (ItemStack | null)[]; armor?: Record<ArmorSlot, ItemStack | null>; selected?: number }) {
    this.slots = new Array(this.slots.length).fill(null);
    data.slots.forEach((s, i) => {
      if (i < this.slots.length && s && ItemRegistry.has(s.id) && s.count > 0) this.slots[i] = { ...s };
    });
    if (data.armor) for (const k of ARMOR_SLOTS) this.armor[k] = data.armor[k] && ItemRegistry.has(data.armor[k]!.id) ? { ...data.armor[k]! } : null;
    this.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, data.selected ?? 0));
    this.changed();
  }
}
