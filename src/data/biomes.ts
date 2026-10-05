/**
 * Définitions des biomes (data-driven). L'ordre détermine l'ID stocké : ajouter à la FIN.
 * temperature/humidity : valeurs « idéales » indicatives (-1..1) utilisées pour la sélection.
 */
export type TreeType = 'oak' | 'big_oak' | 'birch' | 'spruce' | 'jungle' | 'acacia' | 'cactus' | 'swamp_oak';
export type WeatherType = 'rain' | 'snow' | 'none';

export interface BiomeDef {
  key: string;
  name: string;
  temperature: number;
  humidity: number;
  /** Décalage de hauteur appliqué au terrain (douceur). */
  terrainHeight: number;
  surfaceBlock: string;
  undergroundBlock: string;
  /** Profondeur de la couche intermédiaire. */
  underDepth: number;
  treeDensity: number; // probabilité par colonne
  trees: { type: TreeType; weight: number }[];
  vegetation: { block: string; chance: number }[];
  animals: string[];
  hostiles: string[];
  structures: string[];
  weather: WeatherType;
  grassColor: string;
  foliageColor: string;
  /** Surface d'eau gelée (glace) en surface. */
  frozen?: boolean;
}

export const BIOME_DEFS: BiomeDef[] = [
  { key: 'plains', name: 'Plaine', temperature: 0.2, humidity: 0, terrainHeight: 0, surfaceBlock: 'grass', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.002, trees: [{ type: 'oak', weight: 1 }], vegetation: [{ block: 'tall_grass', chance: 0.18 }, { block: 'flower_red', chance: 0.012 }, { block: 'flower_yellow', chance: 0.012 }], animals: ['vachette', 'laineux', 'porcelet', 'plumeau'], hostiles: ['rodeur', 'arachne'], structures: ['village', 'camp', 'abandoned_house'], weather: 'rain', grassColor: '#7cbd4a', foliageColor: '#5fa83a' },
  { key: 'forest', name: 'Forêt', temperature: 0.1, humidity: 0.25, terrainHeight: 1, surfaceBlock: 'grass', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.04, trees: [{ type: 'oak', weight: 4 }, { type: 'birch', weight: 2 }, { type: 'big_oak', weight: 1 }], vegetation: [{ block: 'tall_grass', chance: 0.12 }, { block: 'flower_red', chance: 0.01 }], animals: ['porcelet', 'plumeau', 'ours'], hostiles: ['rodeur', 'arachne'], structures: ['abandoned_house', 'ruins', 'camp'], weather: 'rain', grassColor: '#62a83c', foliageColor: '#4f9a30' },
  { key: 'dense_forest', name: 'Forêt dense', temperature: 0.15, humidity: 0.5, terrainHeight: 2, surfaceBlock: 'grass', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.1, trees: [{ type: 'big_oak', weight: 3 }, { type: 'oak', weight: 2 }], vegetation: [{ block: 'tall_grass', chance: 0.2 }], animals: ['ours', 'porcelet'], hostiles: ['rodeur', 'arachne'], structures: ['ruins'], weather: 'rain', grassColor: '#4f9a34', foliageColor: '#3c8a28' },
  { key: 'desert', name: 'Désert', temperature: 0.9, humidity: -0.6, terrainHeight: 0, surfaceBlock: 'sand', undergroundBlock: 'sandstone', underDepth: 4, treeDensity: 0.003, trees: [{ type: 'cactus', weight: 1 }], vegetation: [{ block: 'dead_bush', chance: 0.01 }], animals: [], hostiles: ['rodeur', 'arachne'], structures: ['temple', 'village', 'ruins'], weather: 'none', grassColor: '#bfb35a', foliageColor: '#aea42a' },
  { key: 'jungle', name: 'Jungle', temperature: 0.85, humidity: 0.7, terrainHeight: 3, surfaceBlock: 'grass', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.12, trees: [{ type: 'jungle', weight: 3 }, { type: 'oak', weight: 1 }], vegetation: [{ block: 'tall_grass', chance: 0.35 }, { block: 'flower_yellow', chance: 0.02 }], animals: ['plumeau', 'porcelet'], hostiles: ['rodeur', 'arachne'], structures: ['temple', 'ruins'], weather: 'rain', grassColor: '#3fbf2a', foliageColor: '#30b020' },
  { key: 'savanna', name: 'Savane', temperature: 0.7, humidity: -0.2, terrainHeight: 1, surfaceBlock: 'grass', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.006, trees: [{ type: 'acacia', weight: 1 }], vegetation: [{ block: 'tall_grass', chance: 0.3 }], animals: ['vachette', 'laineux'], hostiles: ['rodeur', 'arachne'], structures: ['village', 'camp'], weather: 'none', grassColor: '#b5b048', foliageColor: '#a0a030' },
  { key: 'swamp', name: 'Marais', temperature: 0.3, humidity: 0.8, terrainHeight: -2, surfaceBlock: 'grass', undergroundBlock: 'mud', underDepth: 3, treeDensity: 0.02, trees: [{ type: 'swamp_oak', weight: 1 }], vegetation: [{ block: 'tall_grass', chance: 0.15 }, { block: 'glow_mushroom', chance: 0.004 }], animals: ['plumeau'], hostiles: ['rodeur', 'gelee'], structures: ['abandoned_house'], weather: 'rain', grassColor: '#6a7a3a', foliageColor: '#5a6a2a' },
  { key: 'mountain', name: 'Montagne', temperature: -0.1, humidity: 0, terrainHeight: 0, surfaceBlock: 'grass', undergroundBlock: 'stone', underDepth: 1, treeDensity: 0.006, trees: [{ type: 'spruce', weight: 1 }], vegetation: [{ block: 'tall_grass', chance: 0.06 }], animals: ['laineux'], hostiles: ['rodeur', 'arachne'], structures: ['tower', 'ruins'], weather: 'snow', grassColor: '#7aa070', foliageColor: '#5a8a5a' },
  { key: 'taiga', name: 'Taïga', temperature: -0.45, humidity: 0.3, terrainHeight: 1, surfaceBlock: 'grass', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.05, trees: [{ type: 'spruce', weight: 1 }], vegetation: [{ block: 'tall_grass', chance: 0.08 }], animals: ['ours', 'laineux'], hostiles: ['rodeur', 'arachne'], structures: ['camp', 'tower', 'village'], weather: 'snow', grassColor: '#5f8a5a', foliageColor: '#3f6a4a' },
  { key: 'tundra', name: 'Toundra', temperature: -0.7, humidity: -0.2, terrainHeight: 0, surfaceBlock: 'snowy_grass', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.002, trees: [{ type: 'spruce', weight: 1 }], vegetation: [], animals: ['laineux'], hostiles: ['rodeur', 'arachne'], structures: ['ice_temple', 'camp'], weather: 'snow', grassColor: '#80a090', foliageColor: '#608a70', frozen: true },
  { key: 'beach', name: 'Plage', temperature: 0.4, humidity: 0, terrainHeight: 0, surfaceBlock: 'sand', undergroundBlock: 'sand', underDepth: 3, treeDensity: 0, trees: [], vegetation: [], animals: [], hostiles: ['rodeur'], structures: [], weather: 'rain', grassColor: '#7cbd4a', foliageColor: '#5fa83a' },
  { key: 'ocean', name: 'Océan', temperature: 0.3, humidity: 0.3, terrainHeight: 0, surfaceBlock: 'sand', undergroundBlock: 'sand', underDepth: 3, treeDensity: 0, trees: [], vegetation: [], animals: [], hostiles: [], structures: [], weather: 'rain', grassColor: '#7cbd4a', foliageColor: '#5fa83a' },
  { key: 'river', name: 'Rivière', temperature: 0.3, humidity: 0.3, terrainHeight: 0, surfaceBlock: 'sand', undergroundBlock: 'dirt', underDepth: 2, treeDensity: 0, trees: [], vegetation: [], animals: [], hostiles: [], structures: [], weather: 'rain', grassColor: '#7cbd4a', foliageColor: '#5fa83a' },
  { key: 'ice_zone', name: 'Zone glacée', temperature: -0.95, humidity: 0, terrainHeight: 1, surfaceBlock: 'snow', undergroundBlock: 'packed_ice', underDepth: 4, treeDensity: 0, trees: [], vegetation: [], animals: [], hostiles: ['rodeur'], structures: ['ice_temple'], weather: 'snow', grassColor: '#a0c0c8', foliageColor: '#80a0a8', frozen: true },
];
