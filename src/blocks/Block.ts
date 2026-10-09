/** Définition data-driven d'un bloc. Voir src/data/blocks.ts et README « Ajouter un bloc ». */
export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';
export type RenderType = 'none' | 'cube' | 'cutout' | 'cross' | 'liquid' | 'translucent' | 'model';
export type SoundType = 'stone' | 'dirt' | 'grass' | 'wood' | 'sand' | 'gravel' | 'glass' | 'leaves' | 'snow' | 'metal' | 'wool';
/** Formes non cubiques (rendu par boîtes + collisions dédiées). */
export type ShapeKind =
  | 'slab'
  | 'stairs'
  | 'door'
  | 'ladder'
  | 'fence'
  | 'pane'
  | 'bed'
  | 'torch'
  | 'chest'
  | 'farmland'
  | 'snow_layer'
  | 'cactus'
  | 'plate'
  | 'lantern' | 'custom'
  | 'trapdoor'
  | 'fence_gate'
  | 'lever'
  | 'button'
  | 'lily_pad'
  | 'wall'
  | 'carpet'
  | 'end_frame'
  | 'end_portal';

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
  /** Face avant (établi, fourneau, citrouille...). */
  front?: string;
  /** Face arrière (-Z, ou opposée à la face avant). */
  back?: string;
  /** Faces latérales distinctes (+X / -X). */
  east?: string;
  west?: string;
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
  render?: RenderType; // défaut 'cube' (ou 'model' si shape)
  shape?: ShapeKind;
  /** Bloc d'add-on Bedrock : états, permutations et géométrie précalculés. */
  bedrock?: import('../addons/BedrockBlocks').BedrockBlockInfo;
  solid?: boolean;
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
  /** Dégâts infligés au contact (cactus, lave). */
  contactDamage?: number;
  /** Ralentissement à la traversée (0..1). */
  friction?: number;
  /** Glissant (glace). */
  slippery?: boolean;
  /** Interaction (« utiliser ») : interface ou action. */
  interact?: 'crafting' | 'furnace' | 'chest' | 'door' | 'bed' | 'tnt' | 'lever' | 'button';
  /** Ne s'ouvre pas à la main (portes et trappes en fer : redstone seulement). */
  redstoneOnly?: boolean;
  /** Doit reposer sur un bloc solide (plantes, torches). */
  needsSupport?: boolean;
  /** Plante haute sur deux blocs (méta bit 0 : moitié haute). */
  doublePlant?: boolean;
  /** Blocs autorisés sous une plante. */
  supportBlocks?: string[];
  /** Le bloc s'oriente vers le joueur lors du placement (face avant). */
  orientable?: boolean;
  /** Teinte de biome : herbe ou feuillage ; ou couleur fixe (#rrggbb). */
  tint?: 'grass' | 'foliage' | string;
  /** Escalade (échelles). */
  climbable?: boolean;
  /** Couleur de teinte pour les particules (fallback). */
  color?: string;
}

export interface Block extends Required<Pick<BlockDef, 'key' | 'name' | 'hardness'>> {
  id: number;
  def: BlockDef;
  render: RenderType;
  shape: ShapeKind | null;
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
  /** Index de tuile par face : 0 +X, 1 -X, 2 +Y, 3 -Y, 4 avant(+Z), 5 -Z. */
  faceTiles: number[];
  metaTiles: number[] | null;
  sway: boolean;
  contactDamage: number;
  friction: number;
  interact: BlockDef['interact'] | null;
  needsSupport: boolean;
  supportBlocks: string[] | null;
  orientable: boolean;
  climbable: boolean;
  drops: DropDef[];
  color: string;
}
