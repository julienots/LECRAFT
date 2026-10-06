import { describe, expect, it } from 'vitest';
import { EndGenerator, END_ISLAND_Y, endPillars } from '../src/world/EndGenerator';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { idx } from '../src/world/ChunkData';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS } from '../src/data/vanillaExtra';

registerAddonBlocks(EXTRA_BLOCKS);

describe("L'End", () => {
  it('10 piliers d’obsidienne en cercle, sommets en bedrock, 2 cages', () => {
    const ps = endPillars(42);
    expect(ps.length).toBe(10);
    for (const p of ps) expect(Math.abs(Math.hypot(p.x, p.z) - 43)).toBeLessThan(1.5);
    expect(ps.filter((p) => p.caged).length).toBe(2);
    const g = new EndGenerator(42);
    const p = ps[0];
    const c = g.generateChunk(Math.floor(p.x / 16), Math.floor(p.z / 16)).data;
    const lx = p.x - c.cx * 16, lz = p.z - c.cz * 16;
    expect(c.blocks[idx(lx, p.top, lz)]).toBe(B.BEDROCK);
    expect(c.blocks[idx(lx, p.top - 5, lz)]).toBe(B.OBSIDIAN);
  });
  it('île de pierre de l’End au centre, vide au-delà, fontaine de bedrock', () => {
    const g = new EndGenerator(42);
    const end = BlockRegistry.byName('end_stone').id;
    const c = g.generateChunk(1, 1).data;
    let stone = 0;
    for (let y = 1; y < 127; y++) if (c.blocks[idx(8, y, 8)] === end) stone++;
    expect(stone).toBeGreaterThan(5);
    const far = g.generateChunk(12, 0).data; // ~200 blocs : grand vide
    expect(far.blocks.every((b) => b === 0)).toBe(true);
    const center = g.generateChunk(0, 0).data;
    expect(center.blocks[idx(0, END_ISLAND_Y + 2, 0)]).toBe(B.BEDROCK); // colonne centrale
    expect(center.blocks[idx(1, END_ISLAND_Y - 1, 1)]).toBe(B.BEDROCK); // fond de la fontaine
  });
});
