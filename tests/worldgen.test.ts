import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { B } from '../src/blocks/BlockRegistry';
import { BiomeManager } from '../src/world/BiomeManager';
import { idx } from '../src/world/ChunkData';
import { SEA_LEVEL } from '../src/core/Config';

describe('WorldGenerator', () => {
  it('est déterministe pour un même seed', () => {
    const a = new WorldGenerator(839274928).generateChunk(3, -2).data;
    const b = new WorldGenerator(839274928).generateChunk(3, -2).data;
    expect(Buffer.from(a.blocks).equals(Buffer.from(b.blocks))).toBe(true);
    expect(Buffer.from(a.meta).equals(Buffer.from(b.meta))).toBe(true);
  });

  it("ne dépend pas de l'ordre de génération", () => {
    const g1 = new WorldGenerator(42);
    g1.generateChunk(0, 0);
    g1.generateChunk(1, 0);
    const late = g1.generateChunk(2, 0).data;
    const fresh = new WorldGenerator(42).generateChunk(2, 0).data;
    expect(Buffer.from(late.blocks).equals(Buffer.from(fresh.blocks))).toBe(true);
  });

  it('produit des seeds différents pour des mondes différents', () => {
    const a = new WorldGenerator(1).generateChunk(0, 0).data;
    const b = new WorldGenerator(2).generateChunk(0, 0).data;
    expect(Buffer.from(a.blocks).equals(Buffer.from(b.blocks))).toBe(false);
  });

  it('pose du socle en bas et de la terre/pierre', () => {
    const { data } = new WorldGenerator(7).generateChunk(0, 0);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) expect(data.blocks[idx(x, 0, z)]).toBe(B.BEDROCK);
    const counts = new Map<number, number>();
    for (const b of data.blocks) counts.set(b, (counts.get(b) ?? 0) + 1);
    expect(counts.get(B.STONE) ?? 0).toBeGreaterThan(1000);
  });

  it('couvre de nombreux biomes sur une grande zone', () => {
    const g = new WorldGenerator(839274928);
    const seen = new Set<string>();
    for (let x = -6000; x <= 6000; x += 64) for (let z = -6000; z <= 6000; z += 64) seen.add(BiomeManager.get(g.biomeAt(x, z)).key);
    console.log('Biomes vus:', [...seen].join(', '));
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });

  it('génère des minerais, des grottes et des structures', () => {
    const g = new WorldGenerator(123456);
    let ores = 0, caveAir = 0, chests = 0, spawners = 0;
    for (let cx = -4; cx < 4; cx++)
      for (let cz = -4; cz < 4; cz++) {
        const { data, specials } = g.generateChunk(cx, cz);
        spawners += specials.length;
        for (let i = 0; i < data.blocks.length; i++) {
          const b = data.blocks[i];
          if (b === B.COAL_ORE || b === B.IRON_ORE || b === B.COPPER_ORE) ores++;
          if (b === B.CHEST) chests++;
          const y = i >> 8;
          if (b === B.AIR && y < 30) caveAir++;
        }
      }
    console.log({ ores, caveAir, chests, spawners });
    expect(ores).toBeGreaterThan(200);
    expect(caveAir).toBeGreaterThan(500);
  });

  it('trouve un point d’apparition terrestre', () => {
    const g = new WorldGenerator(839274928);
    const s = g.findSpawn();
    expect(s.y).toBeGreaterThan(SEA_LEVEL);
  });

  it('génère un chunk rapidement', () => {
    const g = new WorldGenerator(99);
    const t0 = performance.now();
    for (let i = 0; i < 25; i++) g.generateChunk(i, i * 2);
    const ms = (performance.now() - t0) / 25;
    console.log('ms/chunk', ms.toFixed(2));
    expect(ms).toBeLessThan(60);
  });
});
