import type { ToolType } from '../blocks/Block';

export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';
export type ItemUse =
  | 'ender_eye'
  | 'till'
  | 'plant'
  | 'shoot'
  | 'compass'
  | 'cast'
  | 'bucket'
  | 'water_bucket'
  | 'lava_bucket'
  | 'milk'
  | 'bone_meal'
  | 'ignite'
  | 'shear'
  | 'spawn_compass'
  | 'spawn_egg'
  | 'throw';

export interface ItemDef {
  key: string;
  name: string;
  /** Icône : rendu isométrique d'un bloc, tuile plate de l'atlas, ou sprite pixel-art procédural. */
  icon: { block: string } | { tile: string } | { sprite: string; colors: string[] } | { image: string };
  maxStack?: number;
  /** Bloc posé par cet item. */
  place?: string;
  tool?: { type: ToolType; tier: number; speed: number; durability: number; material: string };
  damage?: number;
  /** Délai de recharge de l'attaque (secondes). */
  attackCooldown?: number;
  food?: { hunger: number; saturation: number; effect?: 'regen' };
  armor?: { slot: ArmorSlot; defense: number; durability: number; material: string };
  use?: ItemUse;
  /** Pour use='plant' : bloc culture posé sur terre labourée. */
  plants?: string;
  /** Pour use='compass' : clé de structure ciblée. */
  target?: string;
  /** Durée de combustion dans un fourneau (secondes). */
  burnTime?: number;
  /** Objet rare de collection. */
  rare?: boolean;
  /** Bonus de dégâts contre certaines créatures. */
  bonusVs?: Record<string, number>;
  /** Onglet de l'inventaire créatif. */
  tab?: 'building' | 'nature' | 'functional' | 'tools' | 'combat' | 'food' | 'ingredients';
  /** Nom de texture dans un pack de ressources (sinon = clé). */
  packTexture?: string;
  description?: string;
  /** Pour use='throw' : projectile lancé (PROJECTILE_DEFS). */
  projectile?: string;
  /** Outil de zone : marteau (minage 3×3) ou excavateur (pelletage 3×3). */
  area?: 'hammer' | 'excavator';
  /** Add-ons : composants personnalisés (scripts) → paramètres. */
  scriptComponents?: Record<string, unknown>;
  /** Add-ons : étiquettes d'objet (minecraft:tags). */
  tags?: string[];
  /** Add-ons : temps de recharge (minecraft:cooldown). */
  cooldown?: { category: string; duration: number };
}

export interface ItemStack {
  id: string;
  count: number;
  durability?: number;
  meta?: Record<string, unknown>;
}
