/** Recette de fabrication en grille (avec motif) ou sans forme. */
export interface CraftingRecipe {
  id: string;
  type: 'shaped' | 'shapeless';
  result: { item: string; count: number };
  /** Motif (lignes de la grille, espaces = case vide) pour les recettes avec forme. */
  pattern?: string[];
  /** Symbole du motif → objet ou « tag:<nom> ». */
  key?: Record<string, string>;
  /** Ingrédients des recettes sans forme (une entrée par case). */
  ingredients?: string[];
  /** Largeur/hauteur minimales de la grille (2 = possible dans l'inventaire). */
  width: number;
  height: number;
}

/** Recette de cuisson au fourneau (10 secondes par objet, comme le jeu vanilla). */
export interface SmeltingRecipe {
  id: string;
  input: string;
  result: string;
  xp: number;
  time: number;
}

// Compatibilité : ancien nom utilisé par certains modules
export type Recipe = CraftingRecipe;
export type Station = 'hand' | 'table' | 'furnace';
