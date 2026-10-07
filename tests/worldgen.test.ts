import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { BlockRegistry } from '../src/blocks/BlockRegistry';
import { BiomeManager } from '../src/world/BiomeManager';
import { idx } from '../src/world/ChunkData';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS } from '../src/data/vanillaExtra';
import { WORLD_HEIGHT } from '../src/core/Config';

registerAddonBlocks(EXTRA_BLOCKS);
const id = (k: string) => BlockRegistry.byName(k).id;

describe('Génération de surface', () => {
  const gen = new WorldGenerator(12345);

  it('les nouveaux biomes apparaissent (échantillonnage large)', () => {
    const seen = new Set<string>();
    for (let z = -6000; z <= 6000; z += 48) for (let x = -6000; x <= 6000; x += 48) seen.add(BiomeManager.get(gen.biomeAt(x, z)).key);
    for (const k of ['birch_forest', 'flower_forest', 'meadow', 'snowy_taiga', 'badlands', 'deep_ocean', 'plains', 'forest', 'desert']) expect(seen.has(k), k).toBe(true);
  });

  it('plantes hautes complètes (moitié haute au-dessus de la basse) et nénuphars sur l’eau', () => {
    const tall = new Set(['tall_grass', 'large_fern', 'lilac', 'rose_bush', 'peony'].map(id));
    let n = 0;
    for (let cx = -10; cx < 10; cx++)
      for (let cz = -10; cz < 10; cz++) {
        const c = gen.generateChunk(cx, cz).data;
        for (let y = 1; y < WORLD_HEIGHT - 1; y++)
          for (let z = 0; z < 16; z++)
            for (let x = 0; x < 16; x++) {
              const i = idx(x, y, z), b = c.blocks[i];
              if (!tall.has(b) || c.meta[i] & 1) continue;
              n++;
              expect(c.blocks[idx(x, y + 1, z)]).toBe(b);
              expect(c.meta[idx(x, y + 1, z)] & 1).toBe(1);
            }
      }
    expect(n).toBeGreaterThan(20);
  });

  it('badlands : sable rouge et strates de terre cuite', () => {
    let found: [number, number] | null = null;
    for (let z = -6000; z <= 6000 && !found; z += 32) for (let x = -6000; x <= 6000 && !found; x += 32) if (BiomeManager.get(gen.biomeAt(x, z)).key === 'badlands' && BiomeManager.get(gen.biomeAt(x + 40, z + 40)).key === 'badlands') found = [x, z];
    expect(found).not.toBeNull();
    const [x, z] = found!;
    const c = gen.generateChunk(Math.floor(x / 16), Math.floor(z / 16)).data;
    const terracotta = new Set(BlockRegistry.blocks.filter((b) => b.key.endsWith('terracotta')).map((b) => b.id));
    let tc = 0, red = 0;
    for (let i = 0; i < c.blocks.length; i++) {
      if (terracotta.has(c.blocks[i])) tc++;
      if (c.blocks[i] === id('red_sand')) red++;
    }
    expect(tc).toBeGreaterThan(500);
    expect(red).toBeGreaterThan(10);
  });
});
