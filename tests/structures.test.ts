import { describe, expect, it } from 'vitest';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS } from '../src/data/vanillaExtra';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { rollLoot } from '../src/blocks/BlockBehaviors';
import { BiomeManager } from '../src/world/BiomeManager';
import { MORE_LOOT, MORE_LOOT_TABLES, MORE_STRUCTURES } from '../src/world/MoreStructures';
import { STRUCTURE_KEYS, type StructWriter, type TerrainQuery } from '../src/world/StructureGenerator';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { idx } from '../src/world/ChunkData';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../src/core/Config';
import { MOB_DEFS } from '../src/data/mobs';
import { Rng } from '../src/util/math';
import { NetherGenerator } from '../src/world/NetherGenerator';

registerAddonBlocks(EXTRA_BLOCKS);
const id = (k: string) => (BlockRegistry.has(k) ? BlockRegistry.byName(k).id : -1);

/** Monde en mémoire (Map) pour construire une structure entière. */
function memWorld() {
  const blocks = new Map<string, { b: number; m: number }>();
  const w: StructWriter = {
    set: (x, y, z, b, m = 0) => {
      if (y > 0 && y < WORLD_HEIGHT) blocks.set(`${x},${y},${z}`, { b, m });
    },
    setIfAir: (x, y, z, b, m = 0) => {
      const k = `${x},${y},${z}`;
      if (!blocks.has(k) || blocks.get(k)!.b === B.AIR) blocks.set(k, { b, m });
    },
  };
  const count = (b: number) => [...blocks.values()].filter((v) => v.b === b).length;
  const chests = () => [...blocks.values()].filter((v) => v.b === B.CHEST).map((v) => v.m >> 2);
  return { w, blocks, count, chests };
}
const flat = (h: number, biome: string): TerrainQuery => ({ heightAt: () => h, biomeAt: () => BiomeManager.byName(biome).id });
const type = (k: string) => MORE_STRUCTURES.find((t) => t.key === k)!;
const build = (k: string, t: TerrainQuery, seed = 1) => {
  const mw = memWorld();
  type(k).build(mw.w, 0, 0, new Rng(seed), t);
  return mw;
};

describe('Structures du jeu de référence', () => {
  it('sont enregistrées dans le générateur et listées par des biomes', () => {
    for (const s of MORE_STRUCTURES) {
      expect(STRUCTURE_KEYS).toContain(s.key);
      if (!s.anyBiome) expect(BiomeManager.biomes.some((b) => b.structures.includes(s.key)), s.key).toBe(true);
    }
  });

  it('pyramide du désert : terre cuite, 4 coffres et piège à TNT sous la plaque', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const p = build('desert_pyramid', flat(64, 'desert'), seed);
      expect(p.count(B.SANDSTONE)).toBeGreaterThan(800);
      expect(p.count(id('orange_terracotta'))).toBeGreaterThan(10);
      expect(p.count(id('blue_terracotta'))).toBeGreaterThanOrEqual(1);
      expect(p.chests().filter((l) => l === MORE_LOOT.DESERT_PYRAMID).length).toBe(4);
      expect(p.count(B.TNT)).toBe(9);
      // la plaque est à 2 blocs au-dessus de la TNT (déclenchée par Session.checkPressurePlate)
      const plate = [...p.blocks.entries()].find(([, v]) => v.b === B.STONE_PRESSURE_PLATE)![0].split(',').map(Number);
      expect(p.blocks.get(`${plate[0]},${plate[1] - 2},${plate[2]}`)?.b).toBe(B.TNT);
    }
  });

  it('temple de la jungle : distributeurs piégés, fil, leviers et 2 coffres', () => {
    const p = build('jungle_temple', flat(70, 'jungle'));
    expect(p.count(B.MOSSY_COBBLESTONE)).toBeGreaterThan(100);
    expect(p.chests().filter((l) => l === MORE_LOOT.JUNGLE_TEMPLE).length).toBe(2);
    expect(p.count(id('dispenser'))).toBe(2);
    expect([...p.blocks.values()].filter((v) => v.b === id('dispenser')).every((v) => v.m & 16)).toBe(true);
    expect(p.count(id('tripwire'))).toBe(1);
    expect(p.count(id('lever'))).toBe(3);
  });

  it('igloo : dôme de neige, lit, fourneau, établi ; sous-sol avec alambic et coffre', () => {
    let basements = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const p = build('igloo', flat(64, 'tundra'), seed);
      expect(p.count(id('snow_block'))).toBeGreaterThan(60);
      expect(p.count(id('red_bed'))).toBe(2);
      expect(p.count(id('furnace'))).toBe(1);
      if (p.count(id('brewing_stand'))) {
        basements++;
        expect(p.chests()).toEqual([MORE_LOOT.IGLOO]);
        expect(p.count(id('ladder'))).toBeGreaterThan(4);
      }
    }
    expect(basements).toBeGreaterThan(0);
  });

  it('cabane de sorcière sur pilotis au-dessus de l’eau', () => {
    const p = build('witch_hut', flat(SEA_LEVEL - 2, 'swamp'));
    expect(p.count(id('cauldron'))).toBe(1);
    expect(p.count(id('crafting_table'))).toBe(1);
    const logs = [...p.blocks.entries()].filter(([, v]) => v.b === B.OAK_LOG).map(([k]) => +k.split(',')[1]);
    expect(Math.min(...logs)).toBeLessThanOrEqual(SEA_LEVEL - 1);
  });

  it('avant-poste : tour de chêne noir, coffre au sommet, générateur de pillards', () => {
    const p = build('pillager_outpost', flat(64, 'plains'));
    expect(p.count(id('dark_oak_log'))).toBeGreaterThan(40);
    expect(p.chests()).toEqual([MORE_LOOT.OUTPOST]);
    const sp = [...p.blocks.values()].find((v) => v.b === B.SPAWNER);
    expect(MOB_DEFS[sp!.m].key).toBe('pillager');
  });

  it('épave immergée (coffres carte/ravitaillement/trésor), ruines sous-marines', () => {
    const kinds = new Set<number>();
    for (let seed = 1; seed <= 10; seed++) {
      const p = build('shipwreck', flat(SEA_LEVEL - 10, 'ocean'), seed);
      p.chests().forEach((c) => kinds.add(c));
      expect(p.chests().length).toBeGreaterThan(0);
      expect(p.count(B.WATER)).toBeGreaterThan(20);
    }
    expect([...kinds].sort()).toEqual([MORE_LOOT.SHIPWRECK_MAP, MORE_LOOT.SHIPWRECK_SUPPLY, MORE_LOOT.SHIPWRECK_TREASURE].sort());
    const r = build('ocean_ruins', flat(SEA_LEVEL - 12, 'ocean'));
    expect(r.chests().length).toBeGreaterThan(0);
    expect(r.count(B.STONE_BRICKS) + r.count(B.SANDSTONE)).toBeGreaterThan(10);
  });

  it('portail en ruine : obsidienne (pleureuse), netherrack, coffre', () => {
    let crying = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const p = build('ruined_portal', flat(64, 'plains'), seed);
      expect(p.count(B.OBSIDIAN)).toBeGreaterThan(5);
      expect(p.count(id('netherrack'))).toBeGreaterThan(10);
      expect(p.chests()).toEqual([MORE_LOOT.RUINED_PORTAL]);
      crying += p.count(id('crying_obsidian'));
    }
    expect(crying).toBeGreaterThan(0);
  });

  it('ruines de piste enfouies (terre cuite, briques de boue)', () => {
    const p = build('trail_ruins', flat(64, 'taiga'));
    expect(p.count(id('mud_bricks'))).toBeGreaterThan(10);
    // tout reste sous la surface
    expect(Math.max(...[...p.blocks.keys()].map((k) => +k.split(',')[1]))).toBeLessThanOrEqual(64);
  });

  it('tables de butin : non vides, objets connus', () => {
    for (const k of Object.values(MORE_LOOT)) {
      expect(MORE_LOOT_TABLES[k]).toBeTruthy();
      expect(rollLoot(k, 1234).length).toBeGreaterThan(0);
    }
  });

  it('dans le monde : localisées, écrites dans les chunks de façon indépendante de l’ordre', () => {
    const gen = new WorldGenerator(12345);
    const found: string[] = [];
    for (const s of MORE_STRUCTURES) {
      const r = gen.structures.locate(s.key, 0, 0, 30);
      if (!r) continue;
      found.push(s.key);
      // le chunk contenant l'origine est identique, qu'il soit généré seul ou après ses voisins
      const cx = Math.floor(r.x / CHUNK_SIZE), cz = Math.floor(r.z / CHUNK_SIZE);
      const a = gen.generateChunk(cx, cz).data.blocks;
      gen.generateChunk(cx + 1, cz);
      const b = gen.generateChunk(cx, cz).data.blocks;
      expect(a).toEqual(b);
      if (s.key === 'desert_pyramid') {
        // la terre cuite bleue au centre de la salle
        let blue = 0;
        for (let y = 1; y < WORLD_HEIGHT; y++) if (a[idx(r.x - cx * CHUNK_SIZE, y, r.z - cz * CHUNK_SIZE)] === id('blue_terracotta')) blue++;
        expect(blue).toBe(1);
      }
    }
    for (const k of ['desert_pyramid', 'jungle_temple', 'igloo', 'witch_hut', 'shipwreck', 'ocean_ruins', 'ruined_portal', 'pillager_outpost']) expect(found).toContain(k);
  }, 60000);
  it('aucune petite structure de surface dans un village', () => {
    const gen = new WorldGenerator(12345);
    const near = gen.structures.structuresNear(-1500, -1500, 1500, 1500);
    const villages = near.filter((s) => s.type.key === 'village').map((s) => s.inst);
    expect(villages.length).toBeGreaterThan(0);
    const small = ['abandoned_house', 'ruins', 'camp', 'desert_pyramid', 'igloo', 'pillager_outpost', 'ruined_portal'];
    for (const s of near) if (small.includes(s.type.key)) for (const v of villages) expect(Math.hypot(v.x - s.inst.x, v.z - s.inst.z), s.type.key).toBeGreaterThanOrEqual(56);
  }, 60000);
  it('portails en ruine dans le Nether (localisables, obsidienne + coffre)', () => {
    const g = new NetherGenerator(4242);
    const p = g.structures.locate('ruined_portal', 0, 0)!;
    expect(p).not.toBeNull();
    let obs = 0, chests = 0;
    for (let cx = Math.floor((p.x - 8) / 16); cx <= Math.floor((p.x + 8) / 16); cx++)
      for (let cz = Math.floor((p.z - 8) / 16); cz <= Math.floor((p.z + 8) / 16); cz++) {
        const c = g.generateChunk(cx, cz).data;
        for (let i = 0; i < c.blocks.length; i++) {
          if (c.blocks[i] === B.OBSIDIAN || c.blocks[i] === id('crying_obsidian')) obs++;
          if (c.blocks[i] === B.CHEST && c.meta[i] >> 2 === MORE_LOOT.RUINED_PORTAL) chests++;
        }
      }
    expect(obs).toBeGreaterThan(4);
    expect(chests).toBe(1);
  }, 60000);
});
