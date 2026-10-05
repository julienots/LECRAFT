/** Définition data-driven d'un bloc. Voir src/data/blocks.ts et README « Ajouter un bloc ». */
export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword';
export type RenderType = 'none' | 'cube' | 'cutout' | 'cross' | 'liquid' | 'translucent';
export type SoundType = 'stone' | 'dirt' | 'grass' | 'wood' | 'sand' | 'gravel' | 'glass' | 'leaves' | 'snow' | 'metal' | 'wool';

export interface DropDef {
  item: string;
  min?: number;
  max?: number;
  /** Probabilité 0..1 (défaut 1). */
  chance?: number;
}

export interface BlockTextures {
  all?: string;
  top?: string;
  bottom?: string;
  side?: string;
  /** Face avant (établi, four, citrouille...). */
  front?: string;
  /** Texture choisie selon la métadonnée (stades de culture). */
  byMeta?: string[];
}

export interface BlockDef {
  key: string;
  name: string;
  textures?: BlockTextures;
  hardness: number; // < 0 : incassable
  tool?: ToolType;
  /** Tier minimal de l'outil pour obtenir les drops (0 = aucun). */
  minTier?: number;
  render?: RenderType; // défaut 'cube'
  solid?: boolean; // défaut true sauf none/cross/liquid
  liquid?: 'water' | 'lava';
  /** Niveau de lumière émis 0..15. */
  light?: number;
  flammable?: boolean;
  gravity?: boolean;
  /** Drops ; défaut = le bloc lui-même. [] = rien. */
  drops?: DropDef[];
  sound?: SoundType;
  /** Atténuation de la lumière du ciel en traversant (feuilles, eau). */
  lightFilter?: number;
  /** Peut être remplacé par un placement (herbes, air, liquides). */
  replaceable?: boolean;
  /** Animation de végétation (balancement). */
  sway?: boolean;
  /** Dégâts infligés au contact (cactus, pièges, lave). */
  contactDamage?: number;
  /** Ralentissement à la traversée (0..1). */
  friction?: number;
  /** Interaction (clic « utiliser ») : ouvre une interface. */
  interact?: 'crafting' | 'furnace' | 'chest';
  /** Doit reposer sur un bloc solide (plantes, torches). */
  needsSupport?: boolean;
  /** Blocs autorisés sous une plante. */
  supportBlocks?: string[];
  /** Le bloc s'oriente vers le joueur lors du placement (face avant). */
  orientable?: boolean;
  /** Couleur de teinte pour les particules (fallback). */
  color?: string;
}

export interface Block extends Required<Pick<BlockDef, 'key' | 'name' | 'hardness'>> {
  id: number;
  def: BlockDef;
  render: RenderType;
  solid: boolean;
  opaque: boolean; // bloque totalement la vue et la lumière
  transparent: boolean;
  liquid: 'water' | 'lava' | null;
  light: number;
  lightFilter: number;
  replaceable: boolean;
  gravity: boolean;
  flammable: boolean;
  tool: ToolType | null;
  minTier: number;
  sound: SoundType;
  /** Index de tuile par face : 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. */
  faceTiles: number[];
  metaTiles: number[] | null;
  sway: boolean;
  contactDamage: number;
  friction: number;
  interact: BlockDef['interact'] | null;
  needsSupport: boolean;
  supportBlocks: string[] | null;
  orientable: boolean;
  drops: DropDef[];
  color: string;
}
