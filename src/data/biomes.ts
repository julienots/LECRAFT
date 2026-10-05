/**
 * Définitions des biomes (data-driven). L'ordre détermine l'ID stocké : ajouter à la FIN.
 * temperature/humidity : valeurs « idéales » indicatives (-1..1) utilisées pour la sélection.
 */
export type TreeType = 'oak' | 'big_oak' | 'birch' | 'spruce' | 'jungle' | 'acacia' | 'dark_oak' | 'cactus' | 'swamp_oak';
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

const FLOWERS = (k = 1) => [
  { block: 'short_grass', chance: 0.18 * k },
  { block: 'dandelion', chance: 0.012 },
  { block: 'poppy', chance: 0.012 },
  { block: 'oxeye_daisy', chance: 0.005 },
  { block: 'cornflower', chance: 0.005 },
];
const FARM = ['cow', 'sheep', 'pig', 'chicken'];
const NIGHT = ['zombie', 'skeleton', 'spider'];

export const BIOME_DEFS: BiomeDef[] = [
  { key: 'plains', name: 'Plaines', temperature: 0.2, humidity: 0, terrainHeight: 0, surfaceBlock: 'grass_block', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.002, trees: [{ type: 'oak', weight: 1 }], vegetation: [...FLOWERS(1.2), { block: 'pumpkin', chance: 0.0008 }], animals: FARM, hostiles: NIGHT, structures: ['village', 'camp', 'abandoned_house'], weather: 'rain', grassColor: '#91bd59', foliageColor: '#77ab2f' },
  { key: 'forest', name: 'Forêt', temperature: 0.1, humidity: 0.25, terrainHeight: 1, surfaceBlock: 'grass_block', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.05, trees: [{ type: 'oak', weight: 4 }, { type: 'birch', weight: 2 }, { type: 'big_oak', weight: 1 }], vegetation: [...FLOWERS(0.7), { block: 'brown_mushroom', chance: 0.002 }, { block: 'red_mushroom', chance: 0.002 }], animals: ['sheep', 'pig', 'chicken', 'cow'], hostiles: NIGHT, structures: ['abandoned_house', 'ruins', 'camp'], weather: 'rain', grassColor: '#79c05a', foliageColor: '#59ae30' },
  { key: 'dense_forest', name: 'Forêt noire', temperature: 0.15, humidity: 0.5, terrainHeight: 2, surfaceBlock: 'grass_block', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.12, trees: [{ type: 'dark_oak', weight: 4 }, { type: 'big_oak', weight: 1 }, { type: 'birch', weight: 1 }], vegetation: [{ block: 'short_grass', chance: 0.12 }, { block: 'brown_mushroom', chance: 0.01 }, { block: 'red_mushroom', chance: 0.01 }], animals: ['pig', 'chicken'], hostiles: NIGHT, structures: ['ruins'], weather: 'rain', grassColor: '#507a32', foliageColor: '#59ae30' },
  { key: 'desert', name: 'Désert', temperature: 0.9, humidity: -0.6, terrainHeight: 0, surfaceBlock: 'sand', undergroundBlock: 'sandstone', underDepth: 4, treeDensity: 0.003, trees: [{ type: 'cactus', weight: 1 }], vegetation: [{ block: 'dead_bush', chance: 0.012 }], animals: [], hostiles: NIGHT, structures: ['temple', 'village', 'ruins'], weather: 'none', grassColor: '#bfb755', foliageColor: '#aea42a' },
  { key: 'jungle', name: 'Jungle', temperature: 0.85, humidity: 0.7, terrainHeight: 3, surfaceBlock: 'grass_block', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.13, trees: [{ type: 'jungle', weight: 3 }, { type: 'oak', weight: 1 }], vegetation: [{ block: 'short_grass', chance: 0.35 }, { block: 'fern', chance: 0.1 }, { block: 'melon', chance: 0.003 }, { block: 'dandelion', chance: 0.01 }], animals: ['chicken', 'pig'], hostiles: NIGHT, structures: ['temple', 'ruins'], weather: 'rain', grassColor: '#59c93c', foliageColor: '#30bb0b' },
  { key: 'savanna', name: 'Savane', temperature: 0.7, humidity: -0.2, terrainHeight: 1, surfaceBlock: 'grass_block', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.006, trees: [{ type: 'acacia', weight: 1 }], vegetation: [{ block: 'short_grass', chance: 0.32 }], animals: ['cow', 'sheep', 'chicken'], hostiles: NIGHT, structures: ['village', 'camp'], weather: 'none', grassColor: '#bfb755', foliageColor: '#aea42a' },
  { key: 'swamp', name: 'Marais', temperature: 0.3, humidity: 0.8, terrainHeight: -2, surfaceBlock: 'grass_block', undergroundBlock: 'mud', underDepth: 3, treeDensity: 0.02, trees: [{ type: 'swamp_oak', weight: 1 }], vegetation: [{ block: 'short_grass', chance: 0.15 }, { block: 'brown_mushroom', chance: 0.006 }, { block: 'red_mushroom', chance: 0.004 }], animals: ['chicken'], hostiles: [...NIGHT, 'slime'], structures: ['abandoned_house'], weather: 'rain', grassColor: '#6a7039', foliageColor: '#6a7039' },
  { key: 'mountain', name: 'Pics enneigés', temperature: -0.1, humidity: 0, terrainHeight: 0, surfaceBlock: 'grass_block', undergroundBlock: 'stone', underDepth: 1, treeDensity: 0.006, trees: [{ type: 'spruce', weight: 1 }], vegetation: [{ block: 'short_grass', chance: 0.06 }], animals: ['sheep'], hostiles: NIGHT, structures: ['tower', 'ruins'], weather: 'snow', grassColor: '#8ab689', foliageColor: '#6da36b' },
  { key: 'taiga', name: 'Taïga', temperature: -0.45, humidity: 0.3, terrainHeight: 1, surfaceBlock: 'grass_block', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.06, trees: [{ type: 'spruce', weight: 1 }], vegetation: [{ block: 'fern', chance: 0.1 }, { block: 'short_grass', chance: 0.06 }, { block: 'brown_mushroom', chance: 0.002 }], animals: ['sheep', 'pig', 'chicken'], hostiles: NIGHT, structures: ['camp', 'tower', 'village'], weather: 'snow', grassColor: '#86b783', foliageColor: '#68a464' },
  { key: 'tundra', name: 'Plaines enneigées', temperature: -0.7, humidity: -0.2, terrainHeight: 0, surfaceBlock: 'snowy_grass_block', undergroundBlock: 'dirt', underDepth: 3, treeDensity: 0.002, trees: [{ type: 'spruce', weight: 1 }], vegetation: [], animals: ['sheep'], hostiles: NIGHT, structures: ['ice_temple', 'camp', 'village'], weather: 'snow', grassColor: '#80b497', foliageColor: '#60a17b', frozen: true },
  { key: 'beach', name: 'Plage', temperature: 0.4, humidity: 0, terrainHeight: 0, surfaceBlock: 'sand', undergroundBlock: 'sand', underDepth: 3, treeDensity: 0, trees: [], vegetation: [], animals: [], hostiles: NIGHT, structures: [], weather: 'rain', grassColor: '#91bd59', foliageColor: '#77ab2f' },
  { key: 'ocean', name: 'Océan', temperature: 0.3, humidity: 0.3, terrainHeight: 0, surfaceBlock: 'sand', undergroundBlock: 'sand', underDepth: 3, treeDensity: 0, trees: [], vegetation: [], animals: [], hostiles: [], structures: [], weather: 'rain', grassColor: '#8eb971', foliageColor: '#71a74d' },
  { key: 'river', name: 'Rivière', temperature: 0.3, humidity: 0.3, terrainHeight: 0, surfaceBlock: 'sand', undergroundBlock: 'dirt', underDepth: 2, treeDensity: 0, trees: [], vegetation: [], animals: [], hostiles: [], structures: [], weather: 'rain', grassColor: '#8eb971', foliageColor: '#71a74d' },
  { key: 'ice_zone', name: 'Pics de glace', temperature: -0.95, humidity: 0, terrainHeight: 1, surfaceBlock: 'snow_block', undergroundBlock: 'packed_ice', underDepth: 4, treeDensity: 0, trees: [], vegetation: [], animals: [], hostiles: ['zombie', 'skeleton'], structures: ['ice_temple'], weather: 'snow', grassColor: '#80b497', foliageColor: '#60a17b', frozen: true },
];
