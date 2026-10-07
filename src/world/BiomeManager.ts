import { BIOME_DEFS, type BiomeDef } from '../data/biomes';

export interface Biome extends BiomeDef {
  id: number;
  grassRGB: [number, number, number];
  foliageRGB: [number, number, number];
}

const toRGB = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Registre des biomes + règles de sélection climatique. */
class BiomeManagerImpl {
  readonly biomes: Biome[] = [];
  private byKey = new Map<string, Biome>();
  constructor() {
    BIOME_DEFS.forEach((d) => this.register(d));
  }
  register(def: BiomeDef) {
    const b: Biome = { ...def, id: this.biomes.length, grassRGB: toRGB(def.grassColor), foliageRGB: toRGB(def.foliageColor) };
    this.biomes.push(b);
    this.byKey.set(def.key, b);
    return b;
  }
  get(id: number) {
    return this.biomes[id] ?? this.biomes[0];
  }
  byName(key: string) {
    const b = this.byKey.get(key);
    if (!b) throw new Error(`Biome inconnu: ${key}`);
    return b;
  }

  /**
   * Sélection d'un biome terrestre selon température/humidité.
   * Les biomes « géographiques » (océan, plage, rivière, montagne) sont décidés par le générateur.
   */
  selectLand(temp: number, hum: number, height: number, seaLevel: number, variant = 0): Biome {
    // `variant` (-1..1, bruit lent indépendant) choisit les variantes comme la « bizarrerie » du jeu original
    const high = height > seaLevel + 24;
    // pics de glace : variante rare des plaines enneigées
    if (temp < -0.62) return variant > 0.25 ? this.byName('ice_zone') : hum > 0.1 ? this.byName('snowy_taiga') : this.byName('tundra');
    if (temp < -0.45) return hum > 0 ? this.byName('snowy_taiga') : this.byName('tundra');
    if (temp < -0.25) return hum > 0 ? this.byName('taiga') : high ? this.byName('meadow') : this.byName('plains');
    if (temp > 0.42) {
      if (hum < -0.12) return variant > 0.35 ? this.byName('badlands') : this.byName('desert');
      if (hum > 0.3) return this.byName('jungle');
      return this.byName('savanna');
    }
    if (hum > 0.45) return height < seaLevel + 6 ? this.byName('swamp') : this.byName('dense_forest');
    if (hum > 0.08) {
      if (height > seaLevel + 16 && variant < -0.25) return this.byName('cherry_grove');
      if (variant > 0.3) return this.byName('birch_forest');
      if (variant < -0.4) return this.byName('flower_forest');
      return this.byName('forest');
    }
    if (high) return this.byName('meadow');
    return this.byName('plains');
  }
}

export const BiomeManager = new BiomeManagerImpl();
