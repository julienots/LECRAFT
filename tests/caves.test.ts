import { describe, expect, it } from 'vitest';
import { WorldGenerator, DEEPSLATE_Y } from '../src/world/WorldGenerator';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { idx } from '../src/world/ChunkData';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS } from '../src/data/vanillaExtra';
import { WORLD_HEIGHT } from '../src/core/Config';

registerAddonBlocks(EXTRA_BLOCKS);
const id = (k: string) => BlockRegistry.byName(k).id;

describe('Grottes et sous-sol', () => {
  const gen = new WorldGenerator(777);
  const counts = new Map<number, number[]>();
  const add = (b: number, y: number) => {
    let a = counts.get(b);
    if (!a) counts.set(b, (a = []));
    a.push(y);
  };
  for (let cx = -6; cx < 6; cx++)
    for (let cz = -6; cz < 6; cz++) {
      const c = gen.generateChunk(cx, cz).data;
      for (let y = 1; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) add(c.blocks[idx(x, y, z)], y);
    }
  const n = (k: string) => counts.get(id(k))?.length ?? 0;
  const avgY = (k: string) => {
    const a = counts.get(id(k)) ?? [];
    return a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  };

  it('couche d’ardoise des abîmes en profondeur, minerais d’ardoise', () => {
    expect(n('deepslate')).toBeGreaterThan(10000);
    expect(avgY('deepslate')).toBeLessThan(DEEPSLATE_Y + 2);
    expect(n('deepslate_diamond_ore') + n('deepslate_redstone_ore') + n('deepslate_iron_ore')).toBeGreaterThan(50);
  });
  it('minerais répartis selon l’altitude (diamant profond, charbon haut)', () => {
    const dia = [...(counts.get(B.DIAMOND_ORE) ?? []), ...(counts.get(id('deepslate_diamond_ore')) ?? [])];
    expect(dia.length).toBeGreaterThan(20);
    expect(Math.max(...dia)).toBeLessThanOrEqual(26);
    expect(avgY('coal_ore')).toBeGreaterThan(50);
  });
  it('grottes luxuriantes, spéléothèmes et géodes d’améthyste', () => {
    expect(n('cave_vines') + n('cave_vines_lit')).toBeGreaterThan(0);
    expect(n('pointed_dripstone')).toBeGreaterThan(0);
    expect(n('dripstone_block')).toBeGreaterThan(0);
    expect(n('calcite')).toBeGreaterThan(0);
    expect(n('budding_amethyst')).toBeGreaterThan(0);
  });
});
