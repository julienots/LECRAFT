export type Station = 'hand' | 'table' | 'furnace';

export interface Ingredient {
  /** Clé d'objet, ou « tag:<nom> » (ex. tag:log). */
  item: string;
  count: number;
}

export interface Recipe {
  id: string;
  result: { item: string; count: number };
  ingredients: Ingredient[];
  station: Station;
  /** Unités de combustible consommées (four). */
  fuel?: number;
}
