import { describe, expect, it } from 'vitest';
import { EXTRA_BLOCKS, EXTRA_ITEMS, EXTRA_RECIPES } from '../src/data/vanillaExtra';
import { TileRegistry, ATLAS_COLS } from '../src/render/TileRegistry';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { BlockRegistry } from '../src/blocks/BlockRegistry';
import { MOB_DEFS } from '../src/data/mobs';
import { VANILLA_MODELS } from '../src/render/MobModels';
import { SKINS } from '../src/render/MobSkins';
import { ICON_TEMPLATES } from '../src/ui/IconTemplates';
import { composePiece, MUSIC_MOODS, moodFromPath } from '../src/audio/Music';
import { hasPainter } from '../src/render/TextureGenerator';

describe('Contenu v2.19', () => {
  it('blocs supplémentaires : clés uniques, textures peintes, atlas suffisant', () => {
    const keys = new Set<string>();
    const tiles = new Set(TileRegistry.names);
    for (const d of EXTRA_BLOCKS) {
      expect(keys.has(d.key) || BlockRegistry.has(d.key), d.key).toBe(false);
      keys.add(d.key);
      const t = d.textures!;
      for (const n of [t.all, t.top, t.bottom, t.side, t.front, ...(t.byMeta ?? [])]) if (n) {
        tiles.add(n);
        expect(hasPainter(n) || TileRegistry.names.includes(n), `${d.key} → ${n}`).toBe(true);
      }
    }
    expect(EXTRA_BLOCKS.length).toBeGreaterThan(550);
    // marge pour les add-ons
    expect(tiles.size).toBeLessThan(ATLAS_COLS * ATLAS_COLS - 200);
  });
  it('recettes : ingrédients et résultats connus ; sprites d’icônes présents', () => {
    const known = new Set([...EXTRA_BLOCKS.map((b) => b.key), ...EXTRA_ITEMS.map((i) => i.key)]);
    const has = (k: string) => k.startsWith('tag:') || ItemRegistry.has(k) || known.has(k);
    const bad = EXTRA_RECIPES.filter((r) => r.id.startsWith('more:') && (!has(r.result.item) || (r.type === 'shaped' ? Object.values(r.key!) : r.ingredients!).some((k) => !has(k))));
    expect(bad.map((r) => r.id)).toEqual([]);
    for (const it of EXTRA_ITEMS) if ('sprite' in it.icon) expect(ICON_TEMPLATES[it.icon.sprite], `${it.key} → ${it.icon.sprite}`).toBeTruthy();
    for (const k of ['wooden', 'stone', 'iron', 'diamond', 'netherite']) {
      expect(EXTRA_ITEMS.find((i) => i.key === `${k}_hammer`)?.area).toBe('hammer');
      expect(EXTRA_ITEMS.find((i) => i.key === `${k}_excavator`)?.area).toBe('excavator');
    }
  });
  it('chaque créature a un modèle et une skin ; un œuf d’apparition', () => {
    for (const d of MOB_DEFS) {
      if ((d.category === 'boss' && !VANILLA_MODELS[d.key]) || d.key === 'end_crystal') continue;
      const m = VANILLA_MODELS[d.key];
      expect(m, d.key).toBeTruthy();
      if (d.category !== 'boss' && d.key !== 'end_crystal') {
        expect(SKINS[m.skin] ?? m.skin === 'player', `${d.key} skin ${m.skin}`).toBeTruthy();
        expect(EXTRA_ITEMS.some((i) => i.key === `${d.key}_spawn_egg`), d.key).toBe(true);
      }
    }
    expect(MOB_DEFS.length).toBeGreaterThanOrEqual(60);
  });
  it('musique : pièces composées dans la tessiture, ambiance déduite des chemins', () => {
    for (const m of MUSIC_MOODS)
      for (let seed = 0; seed < 5; seed++) {
        const p = composePiece(m, seed);
        expect(p.notes.length).toBeGreaterThan(20);
        expect(p.length).toBeGreaterThan(30);
        for (const n of p.notes) {
          expect(n.n).toBeGreaterThanOrEqual(28);
          expect(n.n).toBeLessThanOrEqual(100);
          expect(n.t).toBeLessThanOrEqual(p.length);
        }
      }
    expect(moodFromPath('music/game/nether/chrysopoeia.ogg')).toBe('nether');
    expect(moodFromPath('music/menu/menu1.ogg')).toBe('menu');
    expect(moodFromPath('music/game/calm1.ogg')).toBe('day');
    expect(moodFromPath('music/game/end/boss.ogg')).toBe('end');
  });
});
