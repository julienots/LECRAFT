import { describe, expect, it } from 'vitest';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { idx } from '../src/world/ChunkData';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS, EXTRA_ITEMS, EXTRA_RECIPES } from '../src/data/vanillaExtra';
import { PaperGenerator } from '../src/world/PaperGenerator';
import { BiomeManager } from '../src/world/BiomeManager';
import { MOB_DEFS } from '../src/data/mobs';
import { VANILLA_MODELS } from '../src/render/MobModels';
import { drawTiles } from '../src/render/TextureGenerator';

registerAddonBlocks(EXTRA_BLOCKS);
const id = (k: string) => BlockRegistry.byName(k).id;

describe('Pâte à papier', () => {
  it('toutes les textures (base + blocs supplémentaires) se dessinent sans erreur', () => {
    expect(() => drawTiles()).not.toThrow();
  });
  it('terrain de papier : bedrock, sous-sol en carton/papier froissé, surfaces de papier', () => {
    const g = new PaperGenerator(4242);
    const a = g.generateChunk(2, -3).data, b = new PaperGenerator(4242).generateChunk(2, -3).data;
    expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))).toBe(true);
    const paperish = new Set(['paper_block', 'lined_paper', 'squared_paper', 'newspaper_block', 'cardboard', 'crumpled_paper', 'ink_block', 'graphite_ore', 'cardboard_tube', 'origami_leaves', 'origami_blossom'].map(id));
    let solid = 0, paper = 0;
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        expect(a.blocks[idx(x, 0, z)]).toBe(B.BEDROCK);
        for (let y = 1; y < 128; y++) {
          const k = a.blocks[idx(x, y, z)];
          if (k && BlockRegistry.solid[k]) {
            solid++;
            if (paperish.has(k)) paper++;
          }
        }
      }
    expect(paper / solid).toBeGreaterThan(0.97);
  });
  it('quatre biomes, temples d’origami avec coffre et cage', () => {
    const g = new PaperGenerator(77);
    const seen = new Set<string>();
    for (let x = -3000; x <= 3000; x += 113) for (let z = -3000; z <= 3000; z += 127) seen.add(BiomeManager.get(g.biomeAt(x, z)).key);
    expect([...seen].sort()).toEqual(['cardboard_canyon', 'ink_marsh', 'origami_forest', 'paper_plains']);
    const t = g.locateTemple(0, 0)!;
    expect(t).not.toBeNull();
    const c = g.generateChunk(Math.floor(t.x / 16), Math.floor(t.z / 16));
    expect(c.specials.some((s) => s.block === B.SPAWNER)).toBe(true);
    let chest = false;
    for (const cx of [-1, 0, 1]) for (const cz of [-1, 0, 1]) {
      const d = g.generateChunk(Math.floor(t.x / 16) + cx, Math.floor((t.z + 3) / 16) + cz).data;
      if (d.blocks.includes(B.CHEST)) chest = true;
    }
    expect(chest).toBe(true);
  });
  it('créatures, objets et portail', () => {
    for (const k of ['paper_crane', 'origami_frog', 'scribble', 'crumpled_ball', 'paper_plane', 'cardboard_golem']) {
      const d = MOB_DEFS.find((m) => m.key === k)!;
      expect(d?.spawn?.where, k).toBe('paper');
      expect(VANILLA_MODELS[k], k).toBeTruthy();
      expect(BiomeManager.biomes.some((b) => b.animals.includes(k) || b.hostiles.includes(k)), k).toBe(true);
    }
    for (const k of ['quill', 'graphite', 'graphite_pickaxe', 'cardboard_chestplate', 'paper_plane_item', 'giant_scissors', 'origami_fruit']) expect(EXTRA_ITEMS.some((i) => i.key === k), k).toBe(true);
    expect(EXTRA_ITEMS.find((i) => i.key === 'quill')?.use).toBe('ignite');
    expect(EXTRA_RECIPES.some((r) => r.result.item === 'papier_mache')).toBe(true);
    expect(BlockRegistry.has('paper_portal') && BlockRegistry.has('papier_mache')).toBe(true);
  });
});
