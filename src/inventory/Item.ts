import type { ToolType } from '../blocks/Block';

export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';
export type ItemUse = 'till' | 'plant' | 'shoot' | 'compass' | 'cast' | 'eat';

export interface ItemDef {
  key: string;
  name: string;
  /** Icône : rendu isométrique d'un bloc, ou sprite pixel-art procédural. */
  icon: { block: string } | { sprite: string; colors: string[] };
  maxStack?: number;
  /** Bloc posé par cet item. */
  place?: string;
  tool?: { type: ToolType; tier: number; speed: number; durability: number; material: string };
  damage?: number;
  attackCooldown?: number;
  food?: { hunger: number; saturation: number };
  armor?: { slot: ArmorSlot; defense: number; durability: number; material: string };
  use?: ItemUse;
  /** Pour use='plant' : bloc culture posé sur terre cultivable. */
  plants?: string;
  /** Pour use='compass' : clé de structure ciblée. */
  target?: string;
  /** Unités de combustible pour le four. */
  fuel?: number;
  /** Objet de collection (comptabilisé dans la progression). */
  rare?: boolean;
  /** Bonus de dégâts contre certaines créatures. */
  bonusVs?: Record<string, number>;
  description?: string;
}

export interface ItemStack {
  id: string;
  count: number;
  durability?: number;
  meta?: Record<string, unknown>;
}
