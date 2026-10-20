import { ITEM_DEFS } from '../data/items';
import type { ItemDef } from './Item';
import { javaItemProps } from '../data/javaItemProps';

/** Registre des objets (clé texte → définition). Les sauvegardes stockent les clés texte. */
class ItemRegistryImpl {
  private map = new Map<string, ItemDef>();
  constructor(defs: ItemDef[]) {
    defs.forEach((d) => this.register(d));
  }
  register(def: ItemDef) {
    if (this.map.has(def.key)) throw new Error(`Objet dupliqué: ${def.key}`);
    // piles, usure, nourriture et combustible du jeu original (objets-blocs compris)
    const fix = javaItemProps(def);
    if (Object.keys(fix).length) Object.assign(def, fix);
    this.map.set(def.key, def);
  }
  get(key: string): ItemDef | undefined {
    return this.map.get(key);
  }
  require(key: string): ItemDef {
    const d = this.map.get(key);
    if (!d) throw new Error(`Objet inconnu: ${key}`);
    return d;
  }
  has(key: string) {
    return this.map.has(key);
  }
  maxStack(key: string) {
    const d = this.map.get(key);
    return d?.maxStack ?? (d?.tool || d?.armor ? 1 : 64);
  }
  maxDurability(key: string) {
    const d = this.map.get(key);
    return d?.tool?.durability ?? d?.armor?.durability ?? d?.durability ?? 0;
  }
  all(): ItemDef[] {
    return [...this.map.values()];
  }
}

export const ItemRegistry = new ItemRegistryImpl(ITEM_DEFS);
