import { describe, expect, it } from 'vitest';
import { BlockRegistry } from '../src/blocks/BlockRegistry';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS, EXTRA_ITEMS } from '../src/data/vanillaExtra';
import { PACK_BLOCKS, PACK_FACES, PACK_ITEMS } from '../src/data/vanillaPack';
import { ATLAS_COLS, TileRegistry } from '../src/render/TileRegistry';
import { drawTiles, hasPainter } from '../src/render/TextureGenerator';
import { MOB_DEFS } from '../src/data/mobs';
import { VANILLA_MODELS } from '../src/render/MobModels';
import { SKINS } from '../src/render/MobSkins';

registerAddonBlocks(EXTRA_BLOCKS);

describe('Textures du pack', () => {
  it('chaque texture de bloc restante devient un bloc, avec des tuiles dessinables', () => {
    expect(PACK_BLOCKS.length).toBeGreaterThan(300);
    for (const [key] of PACK_BLOCKS) expect(BlockRegistry.has(key)).toBe(true);
    for (const n of TileRegistry.names) expect(hasPainter(n.split('#')[0]) || n.startsWith('destroy_stage') || n === 'missing').toBe(true);
    expect(TileRegistry.count).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_COLS);
    expect(() => drawTiles()).not.toThrow();
  });
  it('faces multiples appliquées aux blocs existants (dessus, dessous, avant)', () => {
    const t = (k: string, f: number) => TileRegistry.names[BlockRegistry.byName(k).faceTiles[f]];
    expect(Object.keys(PACK_FACES).length).toBeGreaterThan(50);
    expect(t('quartz_block', 2)).toBe('quartz_block_top');
    expect(t('quartz_block', 3)).toBe('quartz_block_bottom');
    expect(t('mycelium', 3)).toBe('dirt');
    expect(t('blast_furnace', 2)).toBe('blast_furnace_top');
    expect(BlockRegistry.byName('blast_furnace').orientable).toBe(true);
    expect(t('glass_pane', 2)).toBe('glass_pane_top');
  });
  it('chaque texture d’objet restante devient un objet', () => {
    const keys = new Set(EXTRA_ITEMS.map((i) => i.key));
    for (const it of PACK_ITEMS) expect(keys.has(it.key)).toBe(true);
    expect(keys.has('oak_boat') && keys.has('music_disc_cat') && keys.has('iron_spear')).toBe(true);
  });
  it('nouvelles créatures avec modèle et skin', () => {
    for (const k of ['bogged', 'parched', 'piglin_brute', 'evoker', 'wandering_trader', 'mule', 'zoglin', 'cat', 'pufferfish', 'elder_guardian']) {
      expect(MOB_DEFS.some((d) => d.key === k)).toBe(true);
      expect(VANILLA_MODELS[k]).toBeTruthy();
      expect(SKINS[k]).toBeTruthy();
    }
  });
});
