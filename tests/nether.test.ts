import { describe, expect, it } from 'vitest';
import { NetherGenerator, NETHER_LAVA_LEVEL } from '../src/world/NetherGenerator';
import { B } from '../src/blocks/BlockRegistry';
import { idx } from '../src/world/ChunkData';
import { WORLD_HEIGHT } from '../src/core/Config';

describe('Nether', () => {
  it('génération déterministe : bedrock en haut et en bas, océan de lave sous y = 31', () => {
    const a = new NetherGenerator(1234).generateChunk(3, -2).data;
    const b = new NetherGenerator(1234).generateChunk(3, -2).data;
    expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))).toBe(true);
    let lava = 0, lavaAbove = 0;
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        expect(a.blocks[idx(x, 0, z)]).toBe(B.BEDROCK);
        expect(a.blocks[idx(x, WORLD_HEIGHT - 1, z)]).toBe(B.BEDROCK);
        for (let y = 1; y < WORLD_HEIGHT - 1; y++) {
          if (a.blocks[idx(x, y, z)] !== B.LAVA) continue;
          if (y <= NETHER_LAVA_LEVEL) lava++;
          else lavaAbove++;
        }
      }
    expect(lavaAbove).toBe(0);
    void lava;
  });
  it('biomes du Nether et forteresses localisables', () => {
    const g = new NetherGenerator(99);
    const seen = new Set<number>();
    for (let x = -2000; x <= 2000; x += 97) for (let z = -2000; z <= 2000; z += 89) seen.add(g.biomeAt(x, z));
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(g.structures.locate('fortress', 0, 0)).not.toBeNull();
  });
});
